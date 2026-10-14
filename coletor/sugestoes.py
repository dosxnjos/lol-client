# sugestões aceitas pelo Gabriel em 13/10/2026 (plano v2, passo 15f): preparo de objetivo, revisão da
# previsão do jungler no pós-jogo, picos de força do adversário, composição no carregamento e modo
# treino. Tudo função pura sobre o allgamedata da Live Client (+ o que as outras frentes dão: últimas
# posições vistas do minimapa, área provável do jungler); IO só no carregar/montar do dado estático.
import json
import operator
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

RAIZ = Path(__file__).resolve().parent.parent
ITENS_MD = RAIZ / "docs" / "ITENS.md"
CACHE_ESTATICO = RAIZ / "dados" / "cache" / "jogo-estatico.json"
FILA_TREINO = 3140
try:
    from analise import FORA_DAS_CONTAS  # noqa: E402  (dona: docs/INSIGHTS.md)
except ImportError:  # pragma: no cover
    FORA_DAS_CONTAS = (0, 3100, 3140)
from avisos import rota_fala  # noqa: E402  (a fala dos picos diz a rota, não o campeão: pacote de voz)

# horários de objetivo (s de jogo): dono é o coletor/ao_vivo.py (medidos no banco, 202 partidas);
# a partida 3292746609 confere (dragão a cada 326–364 s; vastilarvas 8:50, arauto 17:20, barão 23:45)
try:
    from ao_vivo import (ANCIAO_RENASCE, ARAUTO_1, BARAO_1, BARAO_RENASCE, DRAGAO_1,  # noqa: E402
                         DRAGAO_RENASCE, VASTILARVAS_1)
except ImportError:  # pragma: no cover
    DRAGAO_1, DRAGAO_RENASCE, VASTILARVAS_1, ARAUTO_1, BARAO_1, BARAO_RENASCE, ANCIAO_RENASCE = 300, 300, 480, 900, 1200, 360, 360
OBJETIVOS = {
    "dragao": {"nome": "dragão", "nasce": DRAGAO_1, "renasce": DRAGAO_RENASCE, "evento": "DragonKill"},
    "vastilarvas": {"nome": "vastilarvas", "nasce": VASTILARVAS_1, "renasce": None, "evento": "HordeKill"},
    "arauto": {"nome": "arauto", "nasce": ARAUTO_1, "renasce": None, "evento": "HeraldKill", "some": BARAO_1},
    "barao": {"nome": "barão", "nasce": BARAO_1, "renasce": BARAO_RENASCE, "evento": "BaronKill"},
}
RENASCE_ANCIAO = ANCIAO_RENASCE   # depois da alma (4 dragões de um time), o próximo é o ancião
ANTECEDENCIA = 60      # preparo: 60 s antes de nascer
VISTO_AGORA = 5        # visto no minimapa há <= 5 s = "visto"; mais que isso = "sumido há X"
NIVEIS_PICO = (6, 11, 16)
RAIO_PREVISAO = 1000   # timeline 1/min e recorte ~2 s depois: <= 600 tem teto ~82% (MEDICAO § 3)


def mmss(s):
    s = max(0, int(round(s)))
    return f"{s // 60}:{s % 60:02d}"


# ---------- dado estático do jogo (LCU, guardado em cache) ----------

_DANO = {"kPhysical": "AD", "kMagic": "AP", "kMixed": "misto"}


def montar_estatico(lcu):
    """LCU -> dado compacto que o coach usa: recarga dos feitiços (CLASSIC), itens lendários,
    campeões (alias -> id, nome pt-BR, dano, controle, papéis). ~175 GETs só leitura, 1 vez por patch."""
    versao = lcu.get("/lol-patch/v1/game-version")
    feiticos = {s["name"]: s["cooldown"] for s in lcu.get("/lol-game-data/assets/v1/summoner-spells.json")
                if "CLASSIC" in (s.get("gameModes") or []) and s.get("name") and s.get("cooldown")}
    lendarios = sorted(i["id"] for i in lcu.get("/lol-game-data/assets/v1/items.json")
                       if i.get("from") and not i.get("to") and (i.get("priceTotal") or 0) >= 2000
                       and "Boots" not in (i.get("categories") or []) and i.get("inStore")
                       and not i.get("requiredChampion") and i["id"] < 10000)
    campeoes = {}
    for c in lcu.get("/lol-game-data/assets/v1/champion-summary.json"):
        if not 0 < c["id"] < 10000:
            continue
        d = lcu.get(f"/lol-game-data/assets/v1/champions/{c['id']}.json")
        campeoes[d["alias"]] = {"id": d["id"], "nome": d["name"],
                                "dano": _DANO.get((d.get("tacticalInfo") or {}).get("damageType"), "?"),
                                "controle": (d.get("playstyleInfo") or {}).get("crowdControl", 0),
                                "papeis": d.get("roles") or []}
    return {"versao": versao, "feiticos": feiticos, "lendarios": lendarios, "campeoes": campeoes}


def carregar_estatico(caminho=CACHE_ESTATICO, lcu=None):
    """lê o cache; com lcu, remonta quando a versão do jogo mudou (ou não há cache)"""
    caminho = Path(caminho)
    d = None
    try:
        d = json.loads(caminho.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    if lcu is not None and (d is None or d.get("versao") != lcu.get("/lol-patch/v1/game-version")):
        d = montar_estatico(lcu)
        caminho.parent.mkdir(parents=True, exist_ok=True)
        # grava ao lado e troca: quem lê no meio (o _Partida no InProgress) nunca pega o arquivo pela metade
        tmp = caminho.with_name(caminho.name + ".tmp")
        tmp.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
        tmp.replace(caminho)
    if d is None:
        raise FileNotFoundError(f"sem dado estático em {caminho} e sem LCU para montar")
    d["por_nome"] = {v["nome"]: k for k, v in d["campeoes"].items()}
    d["por_id"] = {v["id"]: k for k, v in d["campeoes"].items()}
    d["lendarios_set"] = set(d["lendarios"])
    return d


# ---------- Live Client: quem é quem ----------

def _eu(live):
    ap = live.get("activePlayer") or {}
    chave = ap.get("riotId") or ap.get("riotIdGameName") or ap.get("summonerName")
    for p in live.get("allPlayers") or []:
        if chave and chave in (p.get("riotId"), p.get("riotIdGameName"), p.get("summonerName")):
            return p
    return None


def _times(live):
    eu = _eu(live)
    if not eu:
        return None, [], []
    ps = live.get("allPlayers") or []
    return eu, [p for p in ps if p.get("team") == eu.get("team")], [p for p in ps if p.get("team") != eu.get("team")]


def _eventos(live):
    return (live.get("events") or {}).get("Events") or []


# ---------- 2. preparo de objetivo ----------

def proximos_objetivos(live, tabela=None):
    """[{objetivo, nome, nasce_em, faltam}] pelos eventos da partida (o que já morreu e quando)"""
    tab = tabela or OBJETIVOS
    gt = float((live.get("gameData") or {}).get("gameTime") or 0)
    ev = _eventos(live)
    eu, aliados, inimigos = _times(live)
    time_de = {p.get("championName"): p.get("team") for p in aliados + inimigos}
    out = []
    for chave, o in tab.items():
        mortes = [e for e in ev if e.get("EventName") == o["evento"]]
        if chave == "dragao":
            por_time = {}
            for e in mortes:
                if e.get("DragonType") != "Elder":
                    t = time_de.get(e.get("KillerName"))
                    por_time[t] = por_time.get(t, 0) + 1
            alma = any(n >= 4 for t, n in por_time.items() if t)
            if not mortes:
                nasce, nome = o["nasce"], o["nome"]
            else:
                ult = max(float(e["EventTime"]) for e in mortes)
                nasce = ult + (RENASCE_ANCIAO if alma else o["renasce"])
                nome = "dragão ancião" if alma else o["nome"]
        else:
            if mortes and not o.get("renasce"):
                continue
            nasce = (max(float(e["EventTime"]) for e in mortes) + o["renasce"]) if mortes else o["nasce"]
            nome = o["nome"]
            if o.get("some") and gt >= o["some"] and not mortes:
                continue
        out.append({"objetivo": chave, "nome": nome, "nasce_em": nasce, "faltam": nasce - gt})
    return sorted(out, key=lambda x: x["nasce_em"])


def preparo_objetivo(live, vistos=None, area_jungler=None, antecedencia=ANTECEDENCIA, tabela=None):
    """blocos para os objetivos que nascem em <= antecedencia s: inimigos mortos (e se voltam antes),
    vistos ou sumidos (vistos = {campeão: gameTime visto} do minimapa, passo 13; sem ele: '?') e a área
    provável do jungler (passo 14/15b, repassada como veio)."""
    gt = float((live.get("gameData") or {}).get("gameTime") or 0)
    eu, _, inimigos = _times(live)
    blocos = []
    for o in proximos_objetivos(live, tabela):
        if not 0 < o["faltam"] <= antecedencia:
            continue
        lista = []
        for p in inimigos:
            nome = p.get("championName")
            if p.get("isDead"):
                rt = float(p.get("respawnTimer") or 0)
                lista.append({"campeao": nome, "estado": "morto", "volta_em_s": round(rt, 1),
                              "perde_objetivo": rt > o["faltam"]})
            elif vistos and nome in vistos:
                ha = gt - vistos[nome]
                lista.append({"campeao": nome, "estado": "visto" if ha <= VISTO_AGORA else "sumido", "ha_s": round(ha, 1)})
            else:
                lista.append({"campeao": nome, "estado": "?" if vistos is None else "sumido", "ha_s": None})
        mortos = [x for x in lista if x["estado"] == "morto"]
        texto = f"{o['nome']} em {mmss(o['faltam'])}"
        if mortos:
            texto += f" · {len(mortos)} morto{'s' if len(mortos) > 1 else ''} (" + ", ".join(
                f"{x['campeao']} {mmss(x['volta_em_s'])}" for x in mortos) + ")"
        blocos.append({"objetivo": o["objetivo"], "nome": o["nome"], "faltam": round(o["faltam"], 1),
                       "inimigos": lista, "mortos": len(mortos), "jungler": area_jungler, "texto": texto})
    return blocos


# ---------- 3. revisão da previsão do jungler (pós-jogo) ----------

def posicoes_timeline(timeline, participant_id):
    """game-timelines/{id} da LCU -> [(t_s, x, y)] do participante, 1 por minuto"""
    out = []
    for fr in timeline.get("frames") or []:
        pf = (fr.get("participantFrames") or {}).get(str(participant_id)) or {}
        pos = pf.get("position") or {}
        if "x" in pos:
            out.append((fr.get("timestamp", 0) / 1000.0, pos["x"], pos["y"]))
    return out


def revisar_previsao(previsoes, reais, raio=RAIO_PREVISAO, folga=12.0, so_na_fog=True):
    """previsoes: [{gt, x, y, visto_ha?}] gravadas a cada 10 s (centro da área provável); reais:
    [(t_s, x, y)] da timeline. Para cada minuto, pega a última previsão feita até t (no máximo `folga` s
    antes) e confere a distância. so_na_fog: previsão feita com o jungler visto há < 10 s não conta
    (aí é posição, não previsão). Minuto 0 (todos na base) fica fora."""
    prev = sorted(previsoes, key=lambda p: p["gt"])
    pontos, n_visto = [], 0
    for t, x, y in reais:
        if t < 60:
            continue
        cand = [p for p in prev if t - folga <= p["gt"] <= t + 2]
        if not cand:
            continue
        p = cand[-1]
        if so_na_fog and (p.get("visto_ha") is not None and p["visto_ha"] < 10):
            n_visto += 1
            continue
        d = ((p["x"] - x) ** 2 + (p["y"] - y) ** 2) ** 0.5
        pontos.append({"t": t, "dist": round(d), "acerto": d <= raio})
    ac = sum(p["acerto"] for p in pontos)
    return {"n": len(pontos), "acertos": ac, "precisao": round(ac / len(pontos), 3) if pontos else None,
            "n_visto": n_visto, "raio": raio, "pontos": pontos}


def precisao_acumulada(revisoes):
    """junta as revisões de várias partidas (soma de acertos / soma de n)"""
    n = sum(r["n"] for r in revisoes)
    ac = sum(r["acertos"] for r in revisoes)
    return {"partidas": len(revisoes), "n": n, "acertos": ac, "precisao": round(ac / n, 3) if n else None}


# ---------- 4. picos de força do adversário e do jungler ----------

class PicosDeForca:
    """atualizar(allgamedata) -> avisos novos ("Ekko nível 6", "Riven fechou Dança da Morte").
    Alvo: o adversário de rota (mesma rota declarada) e o jungler inimigo. Nível e item do inimigo só
    atualizam quando ele é visto (MEDICAO § 1): salto de mais de 1 nível vira 'visto nível N'.
    A 1ª leitura de cada um só guarda (coach ligado no meio da partida não dispara tudo de uma vez)."""

    def __init__(self, lendarios):
        self.lendarios = set(lendarios)
        self.nivel = {}
        self.fechou = {}

    def alvos(self, live):
        eu, _, inimigos = _times(live)
        if not eu:
            return []
        minha = (eu.get("position") or "").upper()
        out = [p for p in inimigos if (p.get("position") or "").upper() == minha and minha]
        out += [p for p in inimigos if (p.get("position") or "").upper() == "JUNGLE" and p not in out]
        return out

    def atualizar(self, live):
        avisos = []
        for p in self.alvos(live):
            nome = p.get("championName")
            nv = int(p.get("level") or 0)
            ant = self.nivel.get(nome)
            lend = [i for i in p.get("items") or [] if i.get("itemID") in self.lendarios]
            if ant is None:
                self.nivel[nome] = nv
                self.fechou[nome] = bool(lend)
                continue
            if nv > ant:
                cruzou = [n for n in NIVEIS_PICO if ant < n <= nv]
                if cruzou:
                    direto = nv - ant == 1
                    txt = f"{nome} nível {nv}" if direto else f"{nome} visto nível {nv}"
                    # fala pelo molde do avisos.TEXTOS ("o mid chegou no nível 6"): o pico cruzado, não o
                    # nível real (finito: cabe no pacote de voz); o rótulo mostra o nível real com o nome
                    avisos.append({"tipo": "pico_nivel", "campeao": nome, "nivel": nv, "texto": txt,
                                   "chave": f"{nome}:{cruzou[-1]}",
                                   "molde": "pico_nivel" if direto else "pico_nivel_visto",
                                   "dados": {"campeao": nome, "rota": rota_fala(p.get("position")), "nivel": nv,
                                             "pico": cruzou[-1]}})
                self.nivel[nome] = nv
            if lend and not self.fechou.get(nome):
                self.fechou[nome] = True
                txt = f"{nome} fechou {lend[0].get('displayName')}"
                avisos.append({"tipo": "pico_item", "campeao": nome, "item": lend[0].get("itemID"), "texto": txt,
                               "chave": f"{nome}:lendario",
                               "dados": {"campeao": nome, "rota": rota_fala(p.get("position")),
                                         "item": lend[0].get("displayName")}})
        return avisos


# ---------- 5. composição inimiga na tela de carregamento ----------

def em_carregamento(live):
    """tela de carregamento: Live Client respondendo com os 10, gameTime parado (~0,025) e sem GameStart.
    A fase GameStart do gameflow dura ~50 ms e não serve de gatilho (MEDICAO § 5)."""
    gt = float((live.get("gameData") or {}).get("gameTime") or 0)
    sem_inicio = not any(e.get("EventName") == "GameStart" for e in _eventos(live))
    return len(live.get("allPlayers") or []) == 10 and gt < 0.1 and sem_inicio


_OPS = {">=": operator.ge, ">": operator.gt, "<=": operator.le, "<": operator.lt, "==": operator.eq}
METRICAS = ("ad", "ap", "misto", "cura", "controle", "tanques")


def ler_itens_md(caminho=ITENS_MD):
    """docs/ITENS.md -> {"lembretes": [{campeao, quando, texto}], "cura": set(alias)}"""
    texto = Path(caminho).read_text(encoding="utf-8")
    lembretes, cura, secao = [], set(), None
    for linha in texto.splitlines():
        if linha.startswith("## "):
            secao = linha[3:].strip().lower()
            continue
        if secao == "lembretes" and linha.startswith("|"):
            cel = [c.strip() for c in linha.strip().strip("|").split("|")]
            if len(cel) == 3 and cel[0] not in ("campeão", "") and not set(cel[0]) <= set("- "):
                lembretes.append({"campeao": cel[0], "quando": cel[1], "texto": cel[2]})
        elif secao == "cura":
            m = re.match(r"^- (\w+)\s*$", linha)
            if m:
                cura.add(m.group(1))
    for r in lembretes:
        condicao(r["quando"], {k: 0 for k in METRICAS})   # valida já na leitura
    return {"lembretes": lembretes, "cura": cura}


def condicao(expr, comp):
    m = re.fullmatch(r"\s*(\w+)\s*(>=|<=|==|>|<)\s*(\d+)\s*", expr or "")
    if not m or m.group(1) not in METRICAS:
        raise ValueError(f"condição inválida em docs/ITENS.md: {expr!r}")
    return _OPS[m.group(2)](comp[m.group(1)], int(m.group(3)))


def composicao(aliases, estatico, cura):
    camps = [estatico["campeoes"].get(a) or {} for a in aliases]
    return {"ad": sum(c.get("dano") == "AD" for c in camps),
            "ap": sum(c.get("dano") == "AP" for c in camps),
            "misto": sum(c.get("dano") == "misto" for c in camps),
            "cura": sum(a in cura for a in aliases),
            "controle": sum(int(c.get("controle") or 0) for c in camps),
            "tanques": sum("tank" in (c.get("papeis") or []) for c in camps),
            "campeoes": list(aliases)}


def lembretes_build(meu_alias, comp, regras, maximo=2):
    return [r["texto"] for r in regras["lembretes"] if r["campeao"] == meu_alias and condicao(r["quando"], comp)][:maximo]


def bloco_carregamento(live, estatico, regras=None):
    """bloco do painel na tela de carregamento: composição inimiga, tua página de runa e o lembrete
    de build do teu campeão (docs/ITENS.md). None quando não dá para montar."""
    regras = regras or ler_itens_md()
    eu, _, inimigos = _times(live)
    if not eu:
        return None
    alias = lambda p: estatico["por_nome"].get(p.get("championName"))  # noqa: E731
    meu = alias(eu)
    comp = composicao([a for a in map(alias, inimigos) if a], estatico, regras["cura"])
    fr = (live.get("activePlayer") or {}).get("fullRunes") or {}
    runa = {"keystone": (fr.get("keystone") or {}).get("displayName"),
            "primaria": (fr.get("primaryRuneTree") or {}).get("displayName"),
            "secundaria": (fr.get("secondaryRuneTree") or {}).get("displayName")}
    resumo = f"{comp['ad']} AD · {comp['ap']} AP" + (f" · {comp['misto']} misto" if comp["misto"] else "")
    if comp["cura"]:
        resumo += f" · cura {comp['cura']}"
    resumo += f" · controle {comp['controle']}"
    return {"meu": meu, "composicao": comp, "runa": runa, "lembretes": lembretes_build(meu, comp, regras),
            "texto": resumo}


# ---------- 6. modo treino (fila 3140) ----------

def modo_treino(fila=None, live=None):
    modo = ((live or {}).get("gameData") or {}).get("gameMode")
    return fila == FILA_TREINO or modo == "PRACTICETOOL"


def coach_ativo(fila=None, live=None):
    """o coach (painel, overlay, alertas, voz) liga em qualquer partida, treino incluído: o modo treino
    existe para calibrar sem partida valendo. Só a amostragem do banco fica de fora (amostrar)."""
    return True


def amostrar(fila=None, live=None):
    """grava amostra ao vivo no banco? Não para personalizada e treino (FORA_DAS_CONTAS, dono analise.py)"""
    return not (fila in FORA_DAS_CONTAS or modo_treino(fila, live))
