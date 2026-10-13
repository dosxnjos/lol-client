# mentor do coach: o Claude do Gabriel em modo headless (plano v2, passo 20).
# Monta o prompt com os DADOS da partida (pós-jogo: partida inteira do banco; ao vivo: uma amostra
# da Live Client), chama `claude -p` isolado (fora de C:\Dev, sem ferramenta, sem MCP, sem hook,
# sem CLAUDE.md) e grava a resposta na tabela `mentor` com o session_id (a conversa segue com --resume).
# Fila de 1: uma chamada por vez, mais uma esperando; a terceira é recusada.
# uso manual: python coletor/mentor.py <gameId> [--db X] [--aovivo live.jsonl --gt 480]   (só mostra o prompt)
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analise  # noqa: E402
import banco  # noqa: E402

# padrão escolhido pela comparação de 13/10/2026 com a partida real (plano v2, passo 20): sonnet/medium foi o
# mais específico sem inferência fora dos dados (1 erro de leitura em 6); low errou 2 em 7, haiku menos específico
MODELO_PADRAO = "sonnet"
EFFORT_PADRAO = "medium"
ADVISOR = "opus"
TIMEOUT_S = 120
MAX_PERGUNTA = 1000      # caracteres
PASTA = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local") / "lol-client-mentor"
FILAS = {420: "Ranqueada Solo/Duo", 440: "Ranqueada Flex", 400: "Normal Escolha", 430: "Normal Às Cegas",
         490: "Partida Rápida", 450: "ARAM", 700: "Clash", 900: "URF", 3100: "Personalizada", 3140: "Treino"}
PAPEL_PT = {"TOP": "topo", "JUNGLE": "selva", "MIDDLE": "meio", "BOTTOM": "atirador", "UTILITY": "suporte"}
REGIAO_PT = {"base_aliada": "na base aliada", "base_inimiga": "na base inimiga", "rota_top": "na rota do topo",
             "rota_meio": "na rota do meio", "rota_bot": "na rota de baixo", "rio": "no rio",
             "selva_aliada": "na selva aliada", "selva_inimiga": "na selva inimiga"}
MONSTRO_PT = {"DRAGON": "dragão", "HORDE": "vastilarva", "RIFTHERALD": "arauto", "BARON_NASHOR": "barão",
              "ELDER_DRAGON": "dragão ancião", "ATAKHAN": "atakhan"}
DRAGAO_PT = {"WATER_DRAGON": "oceano", "EARTH_DRAGON": "montanha", "AIR_DRAGON": "nuvem", "FIRE_DRAGON": "infernal",
             "HEXTECH_DRAGON": "hextec", "CHEMTECH_DRAGON": "quimtec", "ELDER_DRAGON": "ancião"}
PREDIO_PT = {"OUTER_TURRET": "torre externa", "INNER_TURRET": "torre interna", "BASE_TURRET": "torre da base",
             "NEXUS_TURRET": "torre do nexus"}
ROTA_PT = {"TOP_LANE": "topo", "MID_LANE": "meio", "BOT_LANE": "baixo"}
DRAGAO_LIVE_PT = {"Water": "oceano", "Earth": "montanha", "Air": "nuvem", "Fire": "infernal",
                  "Hextech": "hextec", "Chemtech": "quimtec", "Elder": "ancião"}
EVENTO_LIVE_PT = {"DragonKill": "dragão", "HordeKill": "vastilarva", "HeraldKill": "arauto",
                  "BaronKill": "barão", "TurretKilled": "torre", "InhibKilled": "inibidor"}

SISTEMA = """Você é o mentor de League of Legends do Gabriel (conta dele, jogador de topo e selva).
Tom: mentor ácido e direto, sem ofensa, sem elogio vazio. Português do Brasil, prosa completa, sem abreviar palavras.
Regras duras:
- Use SÓ o que está no bloco DADOS. Todo número que você citar tem de estar nos dados. Não invente fato
  (flash, ward, visão, build, habilidade, recarga, posição, intenção de jogador): se o dado não existe, diga
  "não tenho esse dado".
- Separe fato de conselho: o fato vem com o número que o sustenta; o conselho é teu, curto e acionável.
- Heurística não é veredito: "morte sozinho no lado inimigo" é padrão a olhar, não "você errou".
- Respeite as observações sobre os limites dos dados (ex.: o que a Live Client não vê na névoa)."""

FORMATO_POSJOGO = """Responda em no máximo 220 palavras, neste formato:
Veredito: uma frase.
Lições: 3 itens numerados, cada um com o fato (número dos dados) e o que fazer na próxima.
Próxima partida: uma única coisa para focar."""

FORMATO_AOVIVO = """Responda em no máximo 90 palavras: até 3 itens curtos, do mais urgente para o menos,
dizendo o que fazer nos próximos 2 minutos e por quê (com o dado que sustenta)."""


# ---------- banco ----------

def garantir_tabela(c):
    """tabela `mentor` (fica aqui, não em banco.ESQUEMA, enquanto o passo 20 é a única dona)"""
    c.executescript("""
create table if not exists mentor (
  id integer primary key autoincrement, ts integer, game_id integer, uso text, game_time real,
  pergunta text, modelo text, effort text, advisor text, prompt text, resposta text, session_id text,
  modelo_usado text, duracao_ms integer, duracao_api_ms integer, custo_usd real, erro text,
  status text);
create index if not exists ix_mentor_game on mentor (game_id, id);
""")


def _nomes(c):
    return dict(c.execute("select id, nome from campeoes"))


def _mmss(s):
    s = int(s)
    return f"{s // 60:02d}:{s % 60:02d}"


# ---------- prompt do pós-jogo (partida inteira, do banco) ----------

def _objetivos(c, gid, meu_time, nomes_pid):
    """linhas de objetivo na ordem: monstro (time de quem matou) e prédio (teamId = dono do prédio)"""
    out, placar = [], {"nós": {}, "eles": {}}
    times = dict(c.execute("select participant_id, time from participantes where game_id=?", (gid,)))
    for ts, tipo, killer, team, mt, mst, bt, lane, tt, ass in c.execute(
            "select ts, tipo, killer_id, team_id, monster_type, monster_sub_type, building_type, lane_type, "
            "tower_type, assistentes from eventos where game_id=? and tipo in "
            "('ELITE_MONSTER_KILL','BUILDING_KILL') order by seq", (gid,)):
        if tipo == "ELITE_MONSTER_KILL":
            quem = killer or (json.loads(ass or "[]") or [0])[0]
            if not quem:
                continue
            lado = "nós" if times.get(quem) == meu_time else "eles"
            nome = MONSTRO_PT.get(mt, mt.lower())
            if mt == "DRAGON" and mst:
                nome += f" {DRAGAO_PT.get(mst, mst.lower())}"
            out.append(f"{_mmss(ts / 1000)} {nome} para {lado} ({nomes_pid.get(quem, '?')})")
            chave = MONSTRO_PT.get(mt, mt.lower())
        else:
            lado = "eles" if team == meu_time else "nós"   # teamId do BUILDING_KILL = dono do prédio
            predio = PREDIO_PT.get(tt, "inibidor" if bt == "INHIBITOR_BUILDING" else (tt or bt).lower())
            genero = "derrubado" if predio == "inibidor" else "derrubada"
            out.append(f"{_mmss(ts / 1000)} {predio} do {ROTA_PT.get(lane, lane)} {genero} por {lado}")
            chave = "inibidor" if bt == "INHIBITOR_BUILDING" else "torre"
        placar[lado][chave] = placar[lado].get(chave, 0) + 1
    return out, placar


def _objetivo_morte(o):
    """item de `objetivos` de uma morte (analise.analisar) em português"""
    if o["tipo"] in MONSTRO_PT:
        return MONSTRO_PT[o["tipo"]] + (f" {DRAGAO_PT.get(o['detalhe'], '')}" if o["detalhe"] else "")
    nome = "inibidor" if o["tipo"] == "INHIBITOR_BUILDING" else PREDIO_PT.get(o["detalhe"], o["detalhe"] or "prédio")
    return f"{nome} do {ROTA_PT.get(o['rota'], o['rota'])}" if o["rota"] else nome


def _historico(c, puuid, campeao, antes_de, nomes):
    """últimas 20 partidas com o campeão antes desta (fora treino, personalizada e remake)"""
    rows = c.execute(
        "select pa.game_id, pp.vitoria, pp.kills, pp.deaths, pp.assists, pp.cs_tropas + pp.cs_selva, pa.duracao, "
        "pp.participant_id from partidas pa join participantes pp on pp.game_id = pa.game_id and pp.puuid = ? "
        f"where pp.campeao = ? and pa.mapa = 11 and pa.duracao >= {analise.REMAKE_S} "
        f"and pa.fila not in {analise.FORA_DAS_CONTAS} and pa.criacao < ? order by pa.criacao desc limit 20",
        (puuid, campeao, antes_de)).fetchall()
    if not rows:
        return None
    n = len(rows)
    cedo = []
    for gid, *_, pid in rows:
        cedo.append(c.execute("select count(*) from eventos where game_id=? and tipo='CHAMPION_KILL' "
                              "and victim_id=? and ts < 600000", (gid, pid)).fetchone()[0])
    k, d, a = (sum(r[i] for r in rows) for i in (2, 3, 4))
    return {"n": n, "vitorias": sum(r[1] for r in rows), "k": k / n, "d": d / n, "a": a / n,
            "csmin": sum(r[5] / (r[6] / 60) for r in rows) / n,
            "mortes10": sum(cedo) / n, "zero_antes_10": sum(1 for x in cedo if x == 0),
            "duas_ou_mais_antes_10": sum(1 for x in cedo if x >= 2)}


def _sessao(c, puuid, criacao):
    """partidas da mesma sessão até esta (pausa < 2 h encadeia, como o tilt do MCP)"""
    rows = c.execute(
        "select pa.criacao, pa.duracao, pp.vitoria, pp.campeao from partidas pa join participantes pp "
        "on pp.game_id = pa.game_id and pp.puuid = ? where pa.mapa = 11 and pa.criacao <= ? "
        f"and pa.duracao >= {analise.REMAKE_S} and pa.fila not in {analise.FORA_DAS_CONTAS} "
        "order by pa.criacao desc limit 15", (puuid, criacao)).fetchall()
    sess = []
    for i, r in enumerate(rows):
        if i and rows[i - 1][0] - (r[0] + r[1] * 1000) >= 2 * 3600 * 1000:
            break
        sess.append(r)
    return list(reversed(sess))


def dados_posjogo(c, game_id, extras=None):
    """bloco DADOS do pós-jogo (texto). Só nomes de campeão: nada de Riot ID nem puuid de ninguém."""
    nomes = _nomes(c)
    puuid = banco.meta(c, "puuid")
    r = analise.analisar(c, game_id, puuid)
    if "erro" in r:
        raise ValueError(r["erro"])
    g = banco.ler_partida(c, game_id)
    meu_time, eu = r["time"], r["participantId"]
    frames = banco.ler_frames(c, game_id)
    pap = analise.papeis(g, frames) or {"papel": {}}
    camp = {p["participantId"]: nomes.get(p["championId"], str(p["championId"])) for p in g["participants"]}
    me = next(p for p in g["participants"] if p["participantId"] == eu)
    st = me["stats"]
    dur = g["gameDuration"]
    L = []
    L.append(f"Partida {game_id}: {FILAS.get(g['queueId'], g['queueId'])}, duração {_mmss(dur)}, "
             f"{'VITÓRIA' if st['win'] else 'DERROTA'}.")
    L.append(f"Gabriel: {camp[eu]} na {PAPEL_PT.get(r['papel'], r['papel'] or '?')}, KDA {st['kills']}/{st['deaths']}/"
             f"{st['assists']}, farm {st['totalMinionsKilled'] + st['neutralMinionsKilled']} "
             f"({r['farm']['valor']:.2f}/min), ouro {st['goldEarned']}, dano em campeões "
             f"{st['totalDamageDealtToChampions']}, placar de visão {st['visionScore']}.")
    L.append("")
    L.append("Os 10 jogadores (campeão, papel, KDA, farm, ouro, dano em campeões):")
    for time_, rot in ((meu_time, "Aliados"), (300 - meu_time, "Inimigos")):
        L.append(f"{rot}:")
        for p in g["participants"]:
            if p["teamId"] != time_:
                continue
            s = p["stats"]
            marca = " (Gabriel)" if p["participantId"] == eu else ""
            L.append(f"- {camp[p['participantId']]}{marca}, {PAPEL_PT.get(pap['papel'].get(p['participantId']), '?')}, "
                     f"{s['kills']}/{s['deaths']}/{s['assists']}, farm {s['totalMinionsKilled'] + s['neutralMinionsKilled']}, "
                     f"ouro {s['goldEarned']}, dano {s['totalDamageDealtToChampions']}")
    L.append("")
    adv = r["adversario"]
    if adv:
        L.append(f"Adversário direto (mesmo papel no time inimigo, pela posição na linha do tempo): "
                 f"{nomes.get(adv['campeao'], adv['campeao'])}{' (provável)' if adv['incerto'] else ''}.")
        for m in ("10", "15"):
            d = r["diffs"].get(m)
            if d:
                L.append(f"Aos {m} min, Gabriel menos adversário: ouro {d['ouro']:+d}, xp {d['xp']:+d}, farm {d['farm']:+d} "
                         f"(Gabriel {d['eu']['ouro']} de ouro, adversário {d['adv']['ouro']}).")
    # ouro dos times a cada 5 min
    if frames:
        times = {p["participantId"]: p["teamId"] for p in g["participants"]}
        pts = []
        for m in range(5, dur // 60 + 1, 5):
            f = analise.frame_do_minuto(frames, m)
            if not f:
                continue
            nos = sum(v["totalGold"] for k, v in f["participantFrames"].items() if times[int(k)] == meu_time)
            eles = sum(v["totalGold"] for k, v in f["participantFrames"].items() if times[int(k)] != meu_time)
            pts.append(f"{m} min {nos - eles:+d}")
        if pts:
            L.append("Diferença de ouro do time (nós menos eles): " + ", ".join(pts) + ".")
    L.append("")
    mortes = r["mortes"]
    L.append(f"Mortes do Gabriel ({len(mortes)}), com o lugar, quantos inimigos participaram, aliados a menos de "
             "2000 unidades e objetivo que o inimigo pegou até 90 s depois:")
    for m in mortes:
        mat = camp.get(m["matador"], "execução (torre ou tropa)")
        objs = ", ".join(f"{_objetivo_morte(o)} aos {_mmss(o['ms'] / 1000)}" for o in m["objetivos"])
        L.append(f"- {m['t']} {REGIAO_PT.get(m['regiao'], m['regiao'])} (lado {m['lado']}), matador {mat}, "
                 f"{m['inimigos']} inimigo(s), {len(m['aliadosPerto'])} aliado(s) perto"
                 + (f"; depois: {objs}" if objs else ""))
    cedo = [m for m in mortes if m["ms"] < 600000]
    L.append(f"Mortes antes dos 10 min: {len(cedo)}.")
    f = r["farm"]
    if f["media"] is not None:
        L.append(f"Farm por minuto {f['valor']:.2f} contra média de {f['media']:.2f} nas últimas {f['n']} partidas "
                 f"com {camp[eu]}.")
    L.append("")
    nomes_pid = {pid: n for pid, n in camp.items()}
    objs, placar = _objetivos(c, game_id, meu_time, nomes_pid)
    L.append("Objetivos e prédios (tempo, o quê, quem):")
    L.extend(f"- {o}" for o in objs)
    L.append("Placar de objetivos: nós " + (", ".join(f"{v} {k}" for k, v in placar["nós"].items()) or "nada")
             + "; eles " + (", ".join(f"{v} {k}" for k, v in placar["eles"].items()) or "nada") + ".")
    L.append("")
    # histórico
    if adv:
        mu = analise.matchups(c, me["championId"], puuid)
        linha = next((x for x in mu["matchups"] if x["papel"] == r["papel"] and x["adversario"] == adv["campeao"]), None)
        rival = nomes.get(adv["campeao"], adv["campeao"])
        quem = f"Histórico {camp[eu]} contra {rival} como adversário direto ({PAPEL_PT.get(r['papel'])}), incluindo esta"
        if linha and linha["conclusao"]:
            L.append(f"{quem}: n={linha['n']}, {linha['vitorias']} vitórias ({linha['winrate']:.0f}%), ouro aos 10 médio "
                     f"{linha['ouro10']:+.0f}, mortes antes dos 10 médias {linha['mortes10']:.1f}.")
        else:
            n = linha["n"] if linha else 0
            vit = linha["vitorias"] if linha else 0
            L.append(f"{quem}: n={n}, {vit} vitórias (pouca amostra, sem conclusão).")
    h = _historico(c, puuid, me["championId"], g["gameCreation"], nomes)
    if h:
        L.append(f"Últimas {h['n']} partidas com {camp[eu]} antes desta: {h['vitorias']} vitórias "
                 f"({100 * h['vitorias'] / h['n']:.0f}%), KDA médio {h['k']:.1f}/{h['d']:.1f}/{h['a']:.1f}, "
                 f"farm {h['csmin']:.1f}/min, mortes antes dos 10 em média {h['mortes10']:.1f} "
                 f"({h['zero_antes_10']} partidas com 0, {h['duas_ou_mais_antes_10']} com 2 ou mais).")
    sess = _sessao(c, puuid, g["gameCreation"])
    if sess:
        seq = " ".join("V" if s[2] else "D" for s in sess)
        L.append(f"Sessão até esta partida ({len(sess)} {'partida' if len(sess) == 1 else 'partidas'}, pausa "
                 f"< 2 h encadeia, mais antiga primeiro): {seq}.")
    L.append("Referência do histórico do Gabriel (172 partidas): ouro aos 10 +500 → 70% de vitórias, −500 → 41%; "
             "0 mortes antes dos 10 → 70%, 2 ou mais → 43%.")
    blocos = _licoes_e_traumas(c, game_id, me["championId"], puuid, g, meu_time, nomes)
    blocos.update(extras or {})
    for titulo, texto in blocos.items():
        L.append("")
        L.append(f"{titulo}:")
        L.append(texto if isinstance(texto, str) else json.dumps(texto, ensure_ascii=False))
    L.append("")
    L.append("Limites dos dados: sem itens, wards, compras, habilidades, feitiços nem posições finas (linha do tempo "
             "com 1 posição por minuto).")
    return "\n".join(L)


def _licoes_e_traumas(c, game_id, campeao, puuid, g, meu_time, nomes):
    """lições do motor (passo 6, coletor/coach.py) e traumas (passo 19, analise.traumas), quando existem.
    Falha de um deles não derruba o mentor: o bloco só some."""
    out = {}
    try:
        import coach
        r = coach.licoes_partida(c, game_id, puuid)
        if r.get("licoes"):
            out["Lições do motor de regras (docs/LICOES.md), por prioridade"] = "\n".join(
                f"- {x['texto']}" for x in r["licoes"])
    except Exception:  # noqa: BLE001 — módulo de outra frente; o mentor segue sem ele
        pass
    try:
        t = analise.traumas(c, campeao, puuid)
        inimigos = {p["championId"] for p in g["participants"] if p["teamId"] != meu_time}
        linhas = []
        for x in t.get("traumas") or []:
            nesta = " (estava no time inimigo nesta partida)" if x["campeao"] in inimigos else ""
            linhas.append(f"- {nomes.get(x['campeao'], x['campeao'])}: n={x['n']}, {x['vitorias']}V/{x['derrotas']}D "
                          f"com ele no time inimigo, lift de derrota {x['lift']:.2f}{nesta}")
        if linhas:
            out[f"Traumas com {nomes.get(campeao, campeao)} (derrota acima da tua taxa geral de "
                f"{100 * t['taxa_derrota']:.0f}%, n ≥ {t.get('min_partidas', 3)}; inclui esta partida)"] = "\n".join(linhas)
    except Exception:  # noqa: BLE001
        pass
    return out


def prompt_posjogo(c, game_id, extras=None):
    return (f"DADOS\n{dados_posjogo(c, game_id, extras)}\nFIM DOS DADOS\n\n"
            f"Faça a análise pós-jogo desta partida para o Gabriel.\n{FORMATO_POSJOGO}")


# ---------- prompt ao vivo (uma amostra do allgamedata) ----------

def _itens(p):
    return ", ".join(i.get("displayName", str(i.get("itemID"))) for i in p.get("items") or []
                     if i.get("itemID") not in (3340, 3363, 3364, 2055)) or "nenhum"


def dados_aovivo(amostra, historico=None, parados=None):
    """bloco DADOS de um momento da partida. `amostra` = allgamedata da Live Client (bruto ou já limpo:
    passa por coletor.limpar_live, então só o nome do campeão chega ao prompt). `parados` = {campeão
    inimigo: s desde que foi visto (None = não se sabe)} do ao_vivo: a linha dele avisa que nível, farm
    e itens são de quando sumiu (o farm do Ekko saía 10 aos 8 min contra 58 reais)."""
    parados = parados or {}
    import coletor  # import tardio: o mentor não depende do laço do coletor
    d = coletor.limpar_live(amostra)
    gt = d["gameData"]["gameTime"]
    eu_nome = (d.get("activePlayer") or {}).get("riotId")
    jog = d.get("allPlayers") or []
    eu = next((p for p in jog if p.get("riotId") == eu_nome), None)
    meu_time = eu["team"] if eu else "ORDER"
    ap = d.get("activePlayer") or {}
    cs = ap.get("championStats") or {}
    L = [f"Tempo de jogo: {_mmss(gt)}."]
    if eu:
        sc = eu["scores"]
        L.append(f"Gabriel: {eu['championName']} ({PAPEL_PT.get(eu.get('position'), eu.get('position') or '?')}), "
                 f"nível {ap.get('level', eu['level'])}, KDA {sc['kills']}/{sc['deaths']}/{sc['assists']}, "
                 f"farm {sc['creepScore']}, ouro no bolso {ap.get('currentGold', 0):.0f}, vida "
                 f"{cs.get('currentHealth', 0):.0f}/{cs.get('maxHealth', 0):.0f}"
                 + (f", MORTO (renasce em {eu['respawnTimer']:.0f} s)" if eu.get("isDead") else "") + ".")
        L.append(f"Itens do Gabriel: {_itens(eu)}.")
    L.append("")
    for rot, cond in (("Aliados", lambda p: p["team"] == meu_time), ("Inimigos", lambda p: p["team"] != meu_time)):
        L.append(f"{rot} (campeão, rota declarada, nível, KDA, farm, itens):")
        for p in jog:
            if not cond(p) or p is eu:
                continue
            sc = p["scores"]
            morto = f", MORTO por mais {p['respawnTimer']:.0f} s" if p.get("isDead") else ""
            parado = ""
            if p["team"] != meu_time and p["championName"] in parados:
                ha = parados[p["championName"]]
                parado = (f" [na névoa: nível, farm e itens são de quando foi visto, há {ha:.0f} s; o real pode ser bem maior]"
                          if ha is not None else " [na névoa: nível, farm e itens parados desde não se sabe quando]")
            L.append(f"- {p['championName']}, {PAPEL_PT.get(p.get('position'), p.get('position') or '?')}, nível "
                     f"{p['level']}, {sc['kills']}/{sc['deaths']}/{sc['assists']}, farm {sc['creepScore']}{morto}; "
                     f"itens: {_itens(p)}{parado}")
    L.append("")
    times = {p["championName"]: p["team"] for p in jog}
    times.update({p.get("riotId"): p["team"] for p in jog})
    ev = {e["EventID"]: e for e in (d.get("events") or {}).get("Events") or []}
    abates = {"nós": 0, "eles": 0}
    objs, recentes = [], []
    for e in sorted(ev.values(), key=lambda e: e["EventID"]):
        nome = e.get("EventName")
        t = _mmss(e.get("EventTime", 0))
        killer = e.get("KillerName", "")
        lado = None
        if killer in times:
            lado = "nós" if times[killer] == meu_time else "eles"
        elif "T100" in killer or "T200" in killer:   # tropa derrubando torre
            lado = "nós" if ("T100" in killer) == (meu_time == "ORDER") else "eles"
        if nome == "ChampionKill":
            if lado:
                abates[lado] += 1
            if e.get("EventTime", 0) >= gt - 120:
                recentes.append(f"{t} {killer} matou {e.get('VictimName')}"
                                + (f" (assistência {', '.join(e.get('Assisters') or [])})" if e.get("Assisters") else ""))
        elif nome in EVENTO_LIVE_PT:
            o = EVENTO_LIVE_PT[nome]
            if nome == "DragonKill":
                o += f" {DRAGAO_LIVE_PT.get(e.get('DragonType'), str(e.get('DragonType', '')).lower())}"
            predio = e.get("TurretKilled") or e.get("InhibKilled") or ""
            if "_TOrder_" in predio or "_TChaos_" in predio:   # nome do prédio = time que PERDEU
                dono = "ORDER" if "_TOrder_" in predio else "CHAOS"
                lado = "eles" if dono == meu_time else "nós"
            roubo = " (roubado)" if str(e.get("Stolen")) == "True" else ""
            objs.append(f"{t} {o}{roubo} para {lado or '?'}" + (f" ({killer})" if killer in times else ""))
    L.append(f"Abates: nós {abates['nós']}, eles {abates['eles']}.")
    L.append("Objetivos até agora: " + ("; ".join(objs) if objs else "nenhum") + ".")
    L.append("Abates dos últimos 2 min: " + ("; ".join(recentes) if recentes else "nenhum") + ".")
    if historico:
        L.append("")
        L.append(f"Padrão do Gabriel (histórico): {historico}")
    L.append("")
    L.append("Limites dos dados (Live Client): não há posição de ninguém no mapa; farm, nível e itens de inimigo "
             "congelam enquanto ele está na névoa (podem estar velhos); farm anda de 10 em 10; não há recarga de "
             "feitiço nem de habilidade de ninguém; ouro no bolso só o do Gabriel.")
    return "\n".join(L)


def historico_aovivo(c, campeao_nome, antes_de=None):
    """uma linha do padrão do Gabriel com o campeão (para o prompt ao vivo); None sem histórico.
    antes_de (ms epoch): só partidas criadas antes (o teste com partida gravada não vê o próprio resultado)"""
    cid = next((i for i, n in c.execute("select id, nome from campeoes") if n == campeao_nome), None)
    puuid = banco.meta(c, "puuid")
    if cid is None or not puuid:
        return None
    h = _historico(c, puuid, cid, antes_de or int(time.time() * 1000), None)
    if not h:
        return None
    return (f"nas últimas {h['n']} partidas de {campeao_nome}, {h['vitorias']} vitórias, mortes antes dos 10 em média "
            f"{h['mortes10']:.1f}; no geral, 0 mortes antes dos 10 → 70% de vitórias e 2 ou mais → 43%.")


def prompt_aovivo(amostra, historico=None, pergunta=None, parados=None):
    pedido = pergunta or "O que o Gabriel deve fazer agora?"
    return f"DADOS\n{dados_aovivo(amostra, historico, parados)}\nFIM DOS DADOS\n\n{pedido}\n{FORMATO_AOVIVO}"


# ---------- chamada isolada ----------

def claude_bin():
    return shutil.which("claude") or str(Path.home() / ".local" / "bin" / "claude.exe")


def ambiente():
    """env do processo filho: o do coletor sem nada de sessão do Claude Code (CLAUDECODE, CLAUDE_EFFORT…
    vazariam de quem roda o teste) + o isolamento do passo 20"""
    env = {k: v for k, v in os.environ.items() if not k.upper().startswith("CLAUDE")}
    env.update({"BACKUP_RAIZ": str(PASTA), "SESSOES_ABERTAS_IGNORAR": "1",
                "CENTRAL_ORIGEM": "ia:lol-client-mentor"})
    return env


def comando(modelo=MODELO_PADRAO, effort=EFFORT_PADRAO, advisor=ADVISOR, resume=None, sistema=SISTEMA):
    """argv do claude -p. Prompt vai pelo stdin (tamanho e linha de comando no log 4688).
    --safe-mode: sem CLAUDE.md, hook, skill e plugin; --tools "": nenhuma ferramenta (o advisor é do servidor);
    --strict-mcp-config sem --mcp-config: nenhum MCP. --bare não serve (pula o login)."""
    cmd = [claude_bin(), "-p", "--safe-mode", "--model", modelo, "--advisor", advisor, "--effort", effort,
           "--tools", "", "--strict-mcp-config", "--disable-slash-commands",
           "--settings", '{"disableAllHooks":true}', "--system-prompt", sistema, "--output-format", "json"]
    if resume:
        cmd += ["--resume", resume]
    return cmd


def chamar(prompt, modelo=MODELO_PADRAO, effort=EFFORT_PADRAO, advisor=ADVISOR, resume=None, timeout=TIMEOUT_S):
    """uma chamada. {texto, session_id, duracao_ms, duracao_api_ms, modelo_usado, custo_usd, erro}"""
    PASTA.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    out = {"texto": None, "session_id": None, "duracao_ms": None, "duracao_api_ms": None,
           "modelo_usado": None, "custo_usd": None, "erro": None}
    try:
        p = subprocess.run(comando(modelo, effort, advisor, resume), input=prompt.encode("utf-8"),
                           capture_output=True, cwd=str(PASTA), env=ambiente(), timeout=timeout,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.TimeoutExpired:
        out.update(erro=f"timeout de {timeout} s", duracao_ms=int((time.time() - t0) * 1000))
        return out
    except OSError as e:
        out.update(erro=f"claude não rodou: {e}")
        return out
    out["duracao_ms"] = int((time.time() - t0) * 1000)
    try:
        j = json.loads(p.stdout.decode("utf-8", "replace"))
    except ValueError:
        out["erro"] = f"saída inválida (rc {p.returncode}): {p.stderr.decode('utf-8', 'replace')[-300:]}"
        return out
    out.update(texto=(j.get("result") or "").strip() or None, session_id=j.get("session_id"),
               duracao_api_ms=j.get("duration_api_ms"), custo_usd=j.get("total_cost_usd"),
               modelo_usado=",".join(j.get("modelUsage") or {}) or None)
    if j.get("is_error") or not out["texto"]:
        out["erro"] = (j.get("result") or j.get("subtype") or "resposta vazia")[:300]
    return out


# ---------- serviço: fila de 1 + tabela + rotas HTTP ----------

class Ocupado(Exception):
    pass


class Mentor:
    """uma chamada por vez e uma esperando (fila de 1). Cada pedido vira linha na tabela `mentor`
    (status pensando → pronto/erro). `db` = caminho do banco (abre conexão própria por thread);
    `ler_live` = função que devolve o último allgamedata (servidor do passo 8), para POST /mentor/aovivo;
    `chamador` = troca o chamar() no teste."""

    def __init__(self, db=banco.DB_PADRAO, ler_live=None, chamador=None, modelo=MODELO_PADRAO,
                 effort=EFFORT_PADRAO, advisor=ADVISOR):
        self.db, self.ler_live = db, ler_live
        self.ler_estado = None   # () -> /estado do ao_vivo (o coach liga): marca no prompt quem está parado na fog
        self.chamador = chamador or chamar
        self.modelo, self.effort, self.advisor = modelo, effort, advisor
        self._trava = threading.Lock()
        self._rodando = None
        self._fila = []          # no máximo 1
        self._threads = []
        c = banco.abrir(self.db)
        garantir_tabela(c)
        with c:  # coletor morto no meio de uma chamada (schtasks /end) deixa a linha "pensando" para sempre
            c.execute("update mentor set status='erro', erro='coletor reiniciou no meio da chamada' "
                      "where status='pensando'")
        c.close()

    def _abrir(self):
        c = banco.abrir(self.db)
        garantir_tabela(c)
        return c

    # pedido -> linha + fila
    def _pedir(self, game_id, uso, montar, pergunta=None, game_time=None, bloquear=False):
        """montar(c) -> (prompt, resume). Devolve o id da linha; com bloquear=True roda nesta thread e
        passa por fora da fila (só teste e linha de comando; o coletor usa sempre o padrão)."""
        with self._trava:
            if self._rodando is not None and len(self._fila) >= 1 and not bloquear:
                raise Ocupado("mentor ocupado: uma chamada rodando e outra na fila")
            c = self._abrir()
            with c:
                cur = c.execute("insert into mentor (ts, game_id, uso, game_time, pergunta, modelo, effort, advisor, "
                                "status) values (?,?,?,?,?,?,?,?,?)",
                                (banco.agora_ms(), game_id, uso, game_time, pergunta, self.modelo, self.effort,
                                 self.advisor, "pensando"))
            rid = cur.lastrowid
            c.close()
            tarefa = (rid, montar)
            if bloquear:
                pass
            elif self._rodando is None:
                self._rodando = rid
                t = threading.Thread(target=self._laco, args=(tarefa,), daemon=True, name=f"mentor-{rid}")
                self._threads.append(t)
                t.start()
            else:
                self._fila.append(tarefa)
        if bloquear:
            self._executar(*tarefa)
        return rid

    def _laco(self, tarefa):
        while tarefa:
            self._executar(*tarefa)
            with self._trava:
                tarefa = self._fila.pop(0) if self._fila else None
                self._rodando = tarefa[0] if tarefa else None

    def _executar(self, rid, montar):
        c = self._abrir()
        try:
            try:
                prompt, resume = montar(c)
            except Exception as e:  # dado faltando (partida sem timeline, sem pós-jogo para a pergunta)
                with c:
                    c.execute("update mentor set status='erro', erro=? where id=?", (str(e)[:300], rid))
                return
            with c:
                c.execute("update mentor set prompt=? where id=?", (prompt, rid))
            r = self.chamador(prompt, modelo=self.modelo, effort=self.effort, advisor=self.advisor, resume=resume)
            with c:
                c.execute("update mentor set resposta=?, session_id=?, modelo_usado=?, duracao_ms=?, duracao_api_ms=?, "
                          "custo_usd=?, erro=?, status=? where id=?",
                          (r["texto"], r["session_id"] or resume, r["modelo_usado"], r["duracao_ms"],
                           r["duracao_api_ms"], r["custo_usd"], r["erro"], "erro" if r["erro"] else "pronto", rid))
        finally:
            c.close()

    def esperar(self, timeout=None):
        """espera as threads do mentor terminarem (teste e encerramento do coletor)"""
        fim = time.time() + (timeout or 1e9)
        for t in list(self._threads):
            t.join(max(0, fim - time.time()))

    # usos
    def posjogo(self, game_id, extras=None, bloquear=False):
        """análise da partida inteira (chamar no EndOfGame, depois que partida + timeline estão no banco).
        Não bloqueia por padrão: ~20–40 s numa thread própria."""
        return self._pedir(game_id, "posjogo", lambda c: (prompt_posjogo(c, game_id, extras), None),
                           bloquear=bloquear)

    def aovivo(self, amostra, game_id=None, pergunta=None, bloquear=False, antes_de=None, parados=None):
        """resumo sob demanda de um momento (atalho na tela de morte); amostra = allgamedata.
        parados = {campeão inimigo: s desde que foi visto, ou None} (dados dele congelados na fog)"""
        gt = (amostra.get("gameData") or {}).get("gameTime")
        if pergunta is not None:   # mesmo teto do perguntar(): sem ele o único limite era o corpo de 64 KB
            if not isinstance(pergunta, str):
                raise ValueError("pergunta tem de ser texto")
            pergunta = pergunta.strip() or None
            if pergunta and len(pergunta) > MAX_PERGUNTA:
                raise ValueError(f"pergunta longa demais (máximo {MAX_PERGUNTA} caracteres)")

        def montar(c):
            eu = next((p for p in amostra.get("allPlayers") or []
                       if p.get("riotId") == (amostra.get("activePlayer") or {}).get("riotId")), None)
            hist = historico_aovivo(c, eu["championName"], antes_de) if eu else None
            return prompt_aovivo(amostra, hist, pergunta, parados), None
        return self._pedir(game_id, "aovivo", montar, pergunta=pergunta, game_time=gt, bloquear=bloquear)

    def perguntar(self, game_id, texto, bloquear=False):
        """pergunta na conversa do pós-jogo (--resume com o session_id guardado)"""
        texto = (texto or "").strip()
        if not texto:
            raise ValueError("pergunta vazia")
        if len(texto) > MAX_PERGUNTA:
            raise ValueError(f"pergunta longa demais (máximo {MAX_PERGUNTA} caracteres)")

        def montar(c):
            r = c.execute("select session_id from mentor where game_id=? and uso in ('posjogo','pergunta') "
                          "and status='pronto' and session_id is not null order by id desc limit 1",
                          (game_id,)).fetchone()
            if not r:
                raise ValueError("sem pós-jogo do mentor para esta partida (gere primeiro)")
            return (f"Pergunta do Gabriel sobre esta mesma partida (responda com os DADOS da primeira mensagem, "
                    f"no máximo 120 palavras): {texto}"), r[0]
        return self._pedir(game_id, "pergunta", montar, pergunta=texto, bloquear=bloquear)

    def estado(self, game_id):
        """o que o painel mostra: status do pós-jogo e a conversa, mais antiga primeiro"""
        c = self._abrir()
        try:
            rows = c.execute("select id, ts, uso, pergunta, resposta, status, erro, duracao_ms from mentor "
                             "where game_id=? order by id", (game_id,)).fetchall()
        finally:
            c.close()
        conversa = [{"id": i, "ts": ts, "uso": uso, "pergunta": p, "resposta": r, "status": s, "erro": e,
                     "segundos": d and round(d / 1000, 1)} for i, ts, uso, p, r, s, e, d in rows]
        pos = [x for x in conversa if x["uso"] == "posjogo"]
        ult = pos[-1] if pos else None
        return {"game_id": game_id, "status": ult["status"] if ult else "nada",
                "texto": ult and ult["resposta"], "conversa": conversa,
                "ocupado": self._rodando is not None, "na_fila": len(self._fila)}

    def _parados(self):
        """{campeão: vistoHaS} dos inimigos com dado parado na fog (atual = falso no /estado); {} sem estado"""
        try:
            est = self.ler_estado() if self.ler_estado else None
        except Exception:
            return {}
        return {j.get("nome"): j.get("vistoHaS") for j in (est or {}).get("jogadores") or []
                if not j.get("aliado") and not j.get("atual") and j.get("nome")}

    # HTTP (o servidor do passo 8 encaminha para cá tudo que começa com /mentor)
    def rota_http(self, metodo, caminho, corpo=b""):
        """(status, dict). GET /mentor/<gameId> · POST /mentor/<gameId> (gera o pós-jogo de novo) ·
        POST /mentor/<gameId>/pergunta {"pergunta": "..."} · POST /mentor/aovivo {"pergunta"?: "..."}"""
        m = re.fullmatch(r"/mentor/(\d+|aovivo)(/pergunta)?/?", caminho.split("?", 1)[0])
        if not m:
            return 404, {"erro": "rota desconhecida"}
        alvo, sub = m.group(1), m.group(2)
        try:
            dados = json.loads(corpo.decode("utf-8")) if corpo else {}
            if not isinstance(dados, dict):
                raise ValueError
        except ValueError:
            return 400, {"erro": "corpo não é um objeto JSON"}
        try:
            if alvo == "aovivo":
                if metodo != "POST" or sub:
                    return 405, {"erro": "use POST /mentor/aovivo"}
                amostra = self.ler_live() if self.ler_live else None
                if not amostra:
                    return 409, {"erro": "sem partida ao vivo"}
                rid = self.aovivo(amostra, pergunta=dados.get("pergunta"), parados=self._parados())
                return 202, {"id": rid, "status": "pensando"}
            gid = int(alvo)
            if metodo == "GET" and not sub:
                return 200, self.estado(gid)
            if metodo == "POST" and sub:
                rid = self.perguntar(gid, dados.get("pergunta"))
                return 202, {"id": rid, "status": "pensando"}
            if metodo == "POST":
                return 202, {"id": self.posjogo(gid), "status": "pensando"}
            return 405, {"erro": "método não suportado"}
        except Ocupado as e:
            return 429, {"erro": str(e)}
        except ValueError as e:
            return 400, {"erro": str(e)}


if __name__ == "__main__":
    import argparse
    ap_ = argparse.ArgumentParser(description="mostra o prompt do mentor (não chama o Claude)")
    ap_.add_argument("game_id", type=int, nargs="?")
    ap_.add_argument("--db", default=str(banco.DB_PADRAO))
    ap_.add_argument("--aovivo", help="live.jsonl gravado")
    ap_.add_argument("--gt", type=float, default=480)
    a = ap_.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    con = banco.abrir_leitura(a.db)
    if a.aovivo:
        with open(a.aovivo, encoding="utf-8") as fh:
            amo = next(json.loads(lin)["dados"] for lin in fh if json.loads(lin)["dados"]["gameData"]["gameTime"] >= a.gt)
        print(prompt_aovivo(amo, historico_aovivo(con, "Zac")))
    else:
        print(prompt_posjogo(con, a.game_id or analise.ultima_partida(con)))
