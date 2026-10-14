# banco SQLite do lol-client (dados/lol.db): esquema, gravação e leitura
# só stdlib; o coletor grava, o MCP e a análise leem (modo ro)
import json
import sqlite3
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DB_PADRAO = RAIZ / "dados" / "lol.db"
# credencial que a LCU põe em blocos que o coletor grava (eog: sala do chat do pós-jogo). Nunca vai ao banco
# (sem_segredos); chat_janelas.PROIBIDOS contém todos (teste-banco confere). Achado de 14/10/2026.
SEGREDOS = ("password", "multiUserChatPassword", "mucJwtDto", "jwt")
_SEGREDOS_MIN = {k.lower() for k in SEGREDOS}

ESQUEMA = """
create table if not exists meta (chave text primary key, valor text);
create table if not exists partidas (
  game_id integer primary key, criacao integer, duracao integer, mapa integer, fila integer,
  versao text, eu integer, campeao integer, time integer, vitoria integer,
  tem_timeline integer default 0, json text, gravado_em integer);
create table if not exists participantes (
  game_id integer, participant_id integer, time integer, campeao integer, puuid text,
  eu integer, vitoria integer, kills integer, deaths integer, assists integer,
  cs_tropas integer, cs_selva integer, ouro integer, json text,
  primary key (game_id, participant_id));
create table if not exists frames (
  game_id integer, idx integer, ts integer, participant_id integer, x integer, y integer,
  ouro_total integer, xp integer, tropas integer, selva integer, nivel integer,
  primary key (game_id, idx, participant_id));
create table if not exists eventos (
  game_id integer, seq integer, frame_idx integer, tipo text, ts integer,
  killer_id integer, victim_id integer, assistentes text, team_id integer, x integer, y integer,
  monster_type text, monster_sub_type text, building_type text, lane_type text, tower_type text,
  json text, primary key (game_id, seq));
create table if not exists lp (
  id integer primary key autoincrement, ts integer, fase text, fila text, tier text,
  divisao text, pontos integer, vitorias integer, derrotas integer);
create table if not exists sessoes (
  id integer primary key autoincrement, ts integer, fase text, game_id integer, fila integer);
create table if not exists eog (
  id integer primary key autoincrement, ts integer, game_id integer, json text);
create table if not exists campeoes (id integer primary key, nome text);
create table if not exists champ_select (
  chave text primary key, ts integer, game_id integer, fila integer, posicao text, preferidas text,
  autofill integer, autofill_riot integer, campeao integer, aliados text, inimigos text,
  bans_aliados text, bans_inimigos text, runa_id integer, runa_nome text, feiticos text,
  seg_ate_travar real, desfeita integer default 0);
create index if not exists ix_partidas_criacao on partidas (criacao);
create index if not exists ix_part_eu on participantes (eu, campeao);
"""


def agora_ms():
    return int(time.time() * 1000)


def abrir(caminho=DB_PADRAO):
    """conexão de escrita (coletor, sincronizar); cria o esquema"""
    caminho = Path(caminho)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(caminho, timeout=30)
    c.execute("pragma journal_mode=wal")
    c.execute("pragma busy_timeout=30000")
    c.executescript(ESQUEMA)
    limpar_segredos(c)   # banco gravado antes de 14/10/2026 (eog com senha e token da sala): limpa ao abrir
    return c


def abrir_leitura(caminho=DB_PADRAO):
    """conexão só leitura (MCP, análise); FileNotFoundError se o banco não existe"""
    caminho = Path(caminho)
    if not caminho.exists():
        raise FileNotFoundError(str(caminho))
    c = sqlite3.connect(f"file:{caminho.as_posix()}?mode=ro", uri=True, timeout=30)
    c.execute("pragma busy_timeout=30000")
    return c


def meta(c, chave, valor=None):
    if valor is None:
        r = c.execute("select valor from meta where chave=?", (chave,)).fetchone()
        return r and r[0]
    c.execute("insert or replace into meta values (?,?)", (chave, str(valor)))


def ids_completos(c):
    """game_ids que já têm partida e linha do tempo"""
    return {r[0] for r in c.execute("select game_id from partidas where tem_timeline=1")}


def ids_partidas(c):
    return {r[0] for r in c.execute("select game_id from partidas")}


def gravar_partida(c, g, puuid, timeline=None):
    """grava games/{id} (+ timeline, se veio) numa transação; substitui o que havia"""
    gid = g["gameId"]
    ids = {i["participantId"]: (i.get("player") or {}).get("puuid") for i in g.get("participantIdentities", [])}
    eu = next((pid for pid, pu in ids.items() if pu and pu == puuid), None)
    meu = next((p for p in g.get("participants", []) if p["participantId"] == eu), None)
    with c:
        c.execute("delete from participantes where game_id=?", (gid,))
        c.execute(
            "insert or replace into partidas values (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (gid, g.get("gameCreation"), g.get("gameDuration"), g.get("mapId"), g.get("queueId"),
             g.get("gameVersion"), eu, meu and meu["championId"], meu and meu["teamId"],
             meu and int(bool(meu["stats"].get("win"))), int(timeline is not None),
             json.dumps(g, ensure_ascii=False, separators=(",", ":")), agora_ms()))
        for p in g.get("participants", []):
            s = p.get("stats", {})
            pid = p["participantId"]
            c.execute(
                "insert into participantes values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (gid, pid, p.get("teamId"), p.get("championId"), ids.get(pid), int(pid == eu),
                 int(bool(s.get("win"))), s.get("kills"), s.get("deaths"), s.get("assists"),
                 s.get("totalMinionsKilled"), s.get("neutralMinionsKilled"), s.get("goldEarned"),
                 json.dumps(p, ensure_ascii=False, separators=(",", ":"))))
        if timeline is not None:
            gravar_timeline(c, gid, timeline)


def gravar_timeline(c, gid, t):
    c.execute("delete from frames where game_id=?", (gid,))
    c.execute("delete from eventos where game_id=?", (gid,))
    seq = 0
    for i, f in enumerate(t.get("frames", [])):
        for chave, pf in (f.get("participantFrames") or {}).items():
            pos = pf.get("position") or {}
            c.execute("insert into frames values (?,?,?,?,?,?,?,?,?,?,?)",
                      (gid, i, f["timestamp"], int(chave), pos.get("x"), pos.get("y"),
                       pf.get("totalGold"), pf.get("xp"), pf.get("minionsKilled"),
                       pf.get("jungleMinionsKilled"), pf.get("level")))
        for e in f.get("events", []):
            pos = e.get("position") or {}
            c.execute("insert into eventos values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (gid, seq, i, e.get("type"), e.get("timestamp"), e.get("killerId"),
                       e.get("victimId"), json.dumps(e.get("assistingParticipantIds") or []),
                       e.get("teamId"), pos.get("x"), pos.get("y"), e.get("monsterType"),
                       e.get("monsterSubType"), e.get("buildingType"), e.get("laneType"),
                       e.get("towerType"), json.dumps(e, ensure_ascii=False, separators=(",", ":"))))
            seq += 1
    c.execute("update partidas set tem_timeline=1 where game_id=?", (gid,))


def ler_partida(c, gid):
    r = c.execute("select json from partidas where game_id=?", (gid,)).fetchone()
    return r and json.loads(r[0])


def ler_frames(c, gid):
    """reconstrói timeline.frames no formato da LCU (participantFrames com chave string;
    events na ordem original); [] se não há linha do tempo"""
    frames = {}
    for idx, ts, pid, x, y, ouro, xp, trop, selva, nivel in c.execute(
            "select idx, ts, participant_id, x, y, ouro_total, xp, tropas, selva, nivel "
            "from frames where game_id=? order by idx, participant_id", (gid,)):
        f = frames.setdefault(idx, {"timestamp": ts, "participantFrames": {}, "events": []})
        f["participantFrames"][str(pid)] = {
            "participantId": pid, "position": {"x": x, "y": y}, "totalGold": ouro, "xp": xp,
            "minionsKilled": trop, "jungleMinionsKilled": selva, "level": nivel}
    for idx, ej in c.execute("select frame_idx, json from eventos where game_id=? order by seq", (gid,)):
        if idx in frames:
            frames[idx]["events"].append(json.loads(ej))
    return [frames[i] for i in sorted(frames)]


def gravar_lp(c, fase, ranked):
    """snapshot de LP das filas ranqueadas de Summoner's Rift; pula se nada mudou"""
    fm = (ranked or {}).get("queueMap") or {}
    with c:
        for fila in ("RANKED_SOLO_5x5", "RANKED_FLEX_SR"):
            q = fm.get(fila)
            if not q:
                continue
            linha = (q.get("tier"), q.get("division"), q.get("leaguePoints"), q.get("wins"), q.get("losses"))
            ult = c.execute("select tier, divisao, pontos, vitorias, derrotas from lp where fila=? "
                            "order by id desc limit 1", (fila,)).fetchone()
            if ult == linha and fase == "evento":
                continue
            c.execute("insert into lp (ts, fase, fila, tier, divisao, pontos, vitorias, derrotas) "
                      "values (?,?,?,?,?,?,?,?)", (agora_ms(), fase, fila, *linha))


def gravar_fase(c, fase, game_id=None, fila=None):
    with c:
        c.execute("insert into sessoes (ts, fase, game_id, fila) values (?,?,?,?)",
                  (agora_ms(), fase, game_id, fila))


def sem_segredos(dado):
    """cópia do JSON sem as chaves de SEGREDOS, em qualquer profundidade (dict/list); o resto intacto"""
    if isinstance(dado, dict):
        return {k: sem_segredos(v) for k, v in dado.items() if k.lower() not in _SEGREDOS_MIN}
    if isinstance(dado, list):
        return [sem_segredos(v) for v in dado]
    return dado


def gravar_eog(c, dado):
    # o bloco do fim de partida traz a senha e o token da sala do chat do pós-jogo: nunca vão ao banco (14/10/2026)
    with c:
        c.execute("insert into eog (ts, game_id, json) values (?,?,?)",
                  (agora_ms(), (dado or {}).get("gameId"), json.dumps(sem_segredos(dado), ensure_ascii=False)))


def limpar_segredos(c):
    """tira SEGREDOS do JSON já gravado no `eog` (gravado assim até 14/10/2026). Com `secure_delete` os bytes
    antigos não ficam nas páginas livres; o checkpoint TRUNCATE esvazia o -wal (que também tinha a versão antiga).
    Devolve quantas linhas mudaram. Idempotente: sem linha suspeita, só o SELECT."""
    linhas = c.execute("select id, json from eog where " +
                       " or ".join("json like ?" for _ in SEGREDOS), [f'%"{k}"%' for k in SEGREDOS]).fetchall()
    if not linhas:
        return 0
    n = 0
    c.execute("pragma secure_delete=on")
    with c:
        for i, txt in linhas:
            try:
                d = json.loads(txt)
            except (TypeError, ValueError):
                continue
            limpo = json.dumps(sem_segredos(d), ensure_ascii=False)
            if limpo != txt:
                c.execute("update eog set json=? where id=?", (limpo, i))
                n += 1
    if n == 0:
        # o LIKE casou só por acaso (ex.: a string "password" dentro de uma lista): sem checkpoint, que pode esperar
        # o busy_timeout (30 s) com o MCP lendo, a cada abrir() (revisão 14/10/2026)
        return 0
    try:
        c.execute("pragma wal_checkpoint(TRUNCATE)")
    except sqlite3.OperationalError:
        pass   # leitor segurando o WAL: o próximo checkpoint automático leva a página nova
    return n


CS_COLUNAS = ("chave", "ts", "game_id", "fila", "posicao", "preferidas", "autofill", "autofill_riot",
              "campeao", "aliados", "inimigos", "bans_aliados", "bans_inimigos", "runa_id", "runa_nome",
              "feiticos", "seg_ate_travar", "desfeita")


def gravar_champ_select(c, r):
    """retrato do champ select (coletor.RetratoChampSelect.retrato()); substitui pela chave.
    listas viram json; preferidas vira 'TOP,JUNGLE'; booleanos viram 0/1 (None fica null)"""
    def col(k):
        v = r.get(k)
        if k == "preferidas":
            return ",".join(v) if v else None
        if isinstance(v, bool):
            return int(v)
        if isinstance(v, (list, dict)):
            return json.dumps(v, separators=(",", ":"))
        return v
    with c:
        c.execute(f"insert or replace into champ_select ({','.join(CS_COLUNAS)}) values "
                  f"({','.join('?' * len(CS_COLUNAS))})", tuple(col(k) for k in CS_COLUNAS))


def ligar_game_id(c, chave, game_id):
    """preenche o game_id do retrato quando a partida aparece (só se ainda está vazio)"""
    with c:
        c.execute("update champ_select set game_id=? where chave=? and game_id is null and desfeita=0",
                  (game_id, chave))


def gravar_campeoes(c, lista):
    with c:
        for ch in lista or []:
            if ch.get("id", -1) > 0:
                c.execute("insert or replace into campeoes values (?,?)", (ch["id"], ch.get("name")))


# ---------- ao vivo (plano v2, passo 8; quem grava é coletor/ao_vivo.py) ----------
# amostra a cada 10 s de gameTime, só o resumo por participante (o allgamedata bruto tem
# 33 KB/amostra). slot = índice em allPlayers (0–9). Nenhum Riot ID: campeão, time e rota.
# visto_gt: gameTime da última mudança observada em nível/itens/farm (inimigo congela na fog).
ESQUEMA_AO_VIVO = """
create table if not exists ao_vivo (
  game_id integer, gt real, slot integer, time integer, campeao integer, nome text, rota text,
  nivel integer, itens text, ouro_est integer, kills integer, deaths integer, assists integer,
  cs integer, morto integer, renascer real, visto_gt real, eu integer,
  primary key (game_id, gt, slot));
create table if not exists eventos_ao_vivo (
  game_id integer, event_id integer, nome text, gt real, killer text, vitima text,
  assistentes text, json text, primary key (game_id, event_id));
"""
AO_VIVO_COLUNAS = ("game_id", "gt", "slot", "time", "campeao", "nome", "rota", "nivel", "itens",
                   "ouro_est", "kills", "deaths", "assists", "cs", "morto", "renascer", "visto_gt", "eu")


def criar_ao_vivo(c):
    c.executescript(ESQUEMA_AO_VIVO)


def gravar_amostra_ao_vivo(c, game_id, gt, linhas):
    """uma amostra: linhas = dicts com as chaves de AO_VIVO_COLUNAS (menos game_id e gt)"""
    with c:
        for r in linhas:
            v = {**r, "game_id": game_id, "gt": round(gt, 1)}
            v["itens"] = json.dumps(v.get("itens") or [], separators=(",", ":"))
            c.execute(f"insert or replace into ao_vivo ({','.join(AO_VIVO_COLUNAS)}) values "
                      f"({','.join('?' * len(AO_VIVO_COLUNAS))})",
                      tuple(int(v[k]) if isinstance(v.get(k), bool) else v.get(k) for k in AO_VIVO_COLUNAS))


def gravar_eventos_ao_vivo(c, game_id, eventos):
    """eventos da Live Client já sem Riot ID (nomes trocados pelo campeão); dedupe pela chave"""
    with c:
        for e in eventos:
            c.execute("insert or ignore into eventos_ao_vivo values (?,?,?,?,?,?,?,?)",
                      (game_id, e.get("EventID"), e.get("EventName"), e.get("EventTime"),
                       e.get("KillerName"), e.get("VictimName"),
                       json.dumps(e.get("Assisters") or [], ensure_ascii=False),
                       json.dumps(e, ensure_ascii=False, separators=(",", ":"))))


def backup(c, destino):
    """cópia consistente com o WAL aberto pelo coletor vivo (Connection.backup; cópia de arquivo sai inconsistente)"""
    destino = Path(destino)
    destino.parent.mkdir(parents=True, exist_ok=True)
    d = sqlite3.connect(destino)
    try:
        c.backup(d)
    finally:
        d.close()
    return destino


def _principal(argv=None):
    import argparse
    import sys
    ap = argparse.ArgumentParser(description="manutenção do banco do coletor")
    ap.add_argument("--limpar-segredos", action="store_true",
                    help="backup em dados/ e tira senha/token da sala do chat do pós-jogo do eog")
    ap.add_argument("--db", default=str(DB_PADRAO))
    a = ap.parse_args(argv)
    sys.stdout.reconfigure(encoding="utf-8")
    if not a.limpar_segredos:
        ap.print_help()
        return 1
    db = Path(a.db)
    c = sqlite3.connect(db, timeout=30)
    c.execute("pragma busy_timeout=30000")
    conta = "select count(*) from eog where " + " or ".join("json like ?" for _ in SEGREDOS)
    pad = [f'%"{k}"%' for k in SEGREDOS]
    antes = c.execute(conta, pad).fetchone()[0]
    if antes:
        # o backup TEM os segredos (é a cópia de antes): apagar depois de conferir o banco limpo (ARMADILHAS)
        b = backup(c, db.parent / f"{db.stem}-antes-de-limpar-segredos-{time.strftime('%Y-%m-%d')}.db")
        print(f"backup: {b}")
    n = limpar_segredos(c)
    depois = c.execute(conta, pad).fetchone()[0]
    c.close()
    print(f"eog com segredo: {antes} antes, {n} limpas, {depois} depois")
    return 0 if depois == 0 else 2


if __name__ == "__main__":
    raise SystemExit(_principal())
