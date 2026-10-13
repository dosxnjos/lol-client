# banco SQLite do lol-client (dados/lol.db): esquema, gravação e leitura
# só stdlib; o coletor grava, o MCP e a análise leem (modo ro)
import json
import sqlite3
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DB_PADRAO = RAIZ / "dados" / "lol.db"

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


def gravar_eog(c, dado):
    with c:
        c.execute("insert into eog (ts, game_id, json) values (?,?,?)",
                  (agora_ms(), (dado or {}).get("gameId"), json.dumps(dado, ensure_ascii=False)))


def gravar_campeoes(c, lista):
    with c:
        for ch in lista or []:
            if ch.get("id", -1) > 0:
                c.execute("insert or replace into campeoes values (?,?)", (ch["id"], ch.get("name")))
