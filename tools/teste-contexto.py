# Prova da Fase 5 (roadmap/2026-10-17-plugin-pengu-primeiro.md), lado Python: o contexto do pós-jogo que o coletor serve
# (analise.matchups, analise.traumas, coach.historico_tilt, coach._traumas, coach.contexto_partida), SEM MUDANÇA, sobre a
# fixture do acumulador do plugin (tools/fixtures/historico-1.json). Monta um SQLite temporário com as linhas da fixture
# (partida, eu e os 5 inimigos) e troca só o analise.analisar por um que devolve, da própria linha, o papel, o adversário, as
# diferenças e as mortes antes dos 10 min (a linha não tem frames). Hora local fixa em UTC-3 (America/Sao_Paulo) nos dois
# lados: as faixas horárias dependem da hora local do PC.
# Confere com tools/fixtures/contexto-esperado.json (a saída gravada, comparada campo a campo); o lado JS é o
# tools/teste-contexto.mjs, que roda este com --json e compara JS = Python ao vivo e JS = esperado.
# uso: python tools/teste-contexto.py [--json]   (--json: só imprime {casos, saidas} no stdout)
import json
import math
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import analise  # noqa: E402
import banco  # noqa: E402
import coach  # noqa: E402

FIXTURE = RAIZ / "tools" / "fixtures" / "historico-1.json"
ESPERADO = RAIZ / "tools" / "fixtures" / "contexto-esperado.json"
EU = "puuid-eu"
BR = timezone(timedelta(hours=-3))


class DataHoraBR(datetime):
    """coach.faixa(datetime.fromtimestamp(...).hour) com a hora de Brasília, qualquer que seja o fuso do PC"""
    @classmethod
    def fromtimestamp(cls, ts, tz=None):
        return datetime.fromtimestamp(ts, tz or BR)


def linhas_da_fixture():
    d = json.loads(FIXTURE.read_text(encoding="utf-8"))
    return [dict(zip(d["campos"], l)) for l in d["linhas"]]


def montar(caminho, linhas):
    c = banco.abrir(caminho)
    banco.meta(c, "puuid", EU)
    with c:
        for l in linhas:
            gid = l["gameId"]
            tem_tl = 0 if l["mortes10"] is None else 1
            parts = [{"participantId": 1, "teamId": 100, "championId": l["campeao"]}]
            parts += [{"participantId": 6 + i, "teamId": 200, "championId": cid} for i, cid in enumerate(l["inimigos"])]
            g = {"gameId": gid, "gameCreation": l["criacao"], "gameDuration": l["duracao"], "mapId": 11, "queueId": l["fila"],
                 "participants": parts,
                 "participantIdentities": [{"participantId": 1, "player": {"puuid": EU}}]}
            c.execute("insert into partidas (game_id, criacao, duracao, mapa, fila, eu, campeao, time, vitoria, tem_timeline, json) "
                      "values (?,?,?,?,?,?,?,?,?,?,?)",
                      (gid, l["criacao"], l["duracao"], 11, l["fila"], 1, l["campeao"], 100, l["vitoria"], tem_tl, json.dumps(g)))
            c.execute("insert into participantes (game_id, participant_id, time, campeao, puuid, eu, vitoria) values (?,?,?,?,?,?,?)",
                      (gid, 1, 100, l["campeao"], EU, 1, l["vitoria"]))
            for i, cid in enumerate(l["inimigos"]):
                c.execute("insert into participantes (game_id, participant_id, time, campeao, puuid, eu, vitoria) values (?,?,?,?,?,?,?)",
                          (gid, 6 + i, 200, cid, f"puuid-inimigo-{i}", 0, 1 - l["vitoria"]))
    return c


def r_da_linha(l):
    """o que o analise.analisar devolveria desta partida, reconstruído da linha (papel, adversário, diffs e mortes cedo)"""
    adv = None if not l["papel"] or l["adversario"] is None else {
        "participantId": 6, "campeao": l["adversario"], "incerto": bool(l["incerto"])}
    diffs = {}
    for m in ("10", "15"):
        if adv and l[f"ouro{m}"] is not None:
            diffs[m] = {"ouro": l[f"ouro{m}"], "xp": l[f"xp{m}"], "farm": l[f"farm{m}"]}
    mortes = []
    if l["mortes10"] is not None:
        mortes += [{"ms": 100000, "inimigos": 1}] * l["solo10"]
        mortes += [{"ms": 100000, "inimigos": 2}] * l["gank10"]
        mortes += [{"ms": 100000, "inimigos": 0}] * (l["mortes10"] - l["solo10"] - l["gank10"])
    return {"gameId": l["gameId"], "participantId": 1, "time": 100, "campeao": l["campeao"],
            "papel": l["papel"] if adv else None, "adversario": adv, "diffs": diffs, "mortes": mortes}


ALVOS = [3302400577, 3302392505, 3301743313, 3301672475, 3301585211, 3300028128, 3301394666]


def casos(linhas):
    por = {l["gameId"]: l for l in linhas}
    out = [{"id": "matchups", "fn": "matchups", "campeao": None},
           {"id": "matchups-58", "fn": "matchups", "campeao": 58},
           {"id": "matchups-154", "fn": "matchups", "campeao": 154},
           {"id": "traumas", "fn": "traumas", "campeao": None, "antes_de": None},
           {"id": "traumas-58-antes", "fn": "traumas", "campeao": 58, "antes_de": por[3301896347]["criacao"]},
           {"id": "tilt-tudo", "fn": "historico_tilt", "game_id": 0, "criacao": 9000000000000},
           {"id": "tilt-meio", "fn": "historico_tilt", "game_id": 3301098535, "criacao": por[3301098535]["criacao"]}]
    out += [{"id": f"contexto-{g}", "fn": "contexto_partida", "game_id": g} for g in ALVOS]
    return out


def rodar(c, linhas, cs):
    por = {l["gameId"]: l for l in linhas}
    hist = coach.historico_banco(c)
    saidas = {}
    for k in cs:
        if k["fn"] == "matchups":
            saidas[k["id"]] = analise.matchups(c, k["campeao"], EU)
        elif k["fn"] == "traumas":
            saidas[k["id"]] = analise.traumas(c, campeao=k["campeao"], puuid=EU, antes_de=k["antes_de"])
        elif k["fn"] == "historico_tilt":
            saidas[k["id"]] = coach.historico_tilt(hist, k["game_id"], k["criacao"])
        elif k["fn"] == "contexto_partida":
            saidas[k["id"]] = coach.contexto_partida(c, k["game_id"], r_da_linha(por[k["game_id"]]), EU)
    return saidas


def diferencas(a, b, caminho=""):
    """lista de diferenças campo a campo (número com tolerância 1e-9; int e float iguais valem)"""
    if isinstance(a, bool) or isinstance(b, bool):
        return [] if a is b or (isinstance(a, bool) and isinstance(b, bool) and a == b) else [f"{caminho}: {a!r} x {b!r}"]
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return [] if math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9) else [f"{caminho}: {a!r} x {b!r}"]
    if isinstance(a, dict) and isinstance(b, dict):
        out = [f"{caminho}.{k}: só de um lado" for k in sorted(set(a) ^ set(b))]
        for k in sorted(set(a) & set(b)):
            out += diferencas(a[k], b[k], f"{caminho}.{k}")
        return out
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return [f"{caminho}: {len(a)} itens x {len(b)}"]
        out = []
        for i, (x, y) in enumerate(zip(a, b)):
            out += diferencas(x, y, f"{caminho}[{i}]")
        return out
    return [] if a == b else [f"{caminho}: {a!r} x {b!r}"]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    so_json = "--json" in sys.argv
    linhas = linhas_da_fixture()
    analise_original, datetime_original = analise.analisar, coach.datetime
    por = {l["gameId"]: l for l in linhas}

    def analisar_falso(c, game_id=None, puuid=None, amostra_ids=None):
        return r_da_linha(por[game_id])
    analise.analisar = analisar_falso
    coach.datetime = DataHoraBR
    try:
        with tempfile.TemporaryDirectory() as tmp:
            c = montar(Path(tmp) / "contexto.db", linhas)
            try:
                cs = casos(linhas)
                saidas = rodar(c, linhas, cs)
            finally:
                c.close()
    finally:
        analise.analisar, coach.datetime = analise_original, datetime_original
    if so_json:
        print(json.dumps({"casos": cs, "saidas": saidas}, ensure_ascii=False))
        return 0

    falhas = []

    def caso(nome, ok, detalhe=""):
        print(("ok    " if ok else "FALHA ") + nome + ("" if ok else f" -- {detalhe}"))
        if not ok:
            falhas.append(nome)

    esperado = json.loads(ESPERADO.read_text(encoding="utf-8")) if ESPERADO.exists() else None
    caso("contexto-esperado.json existe", esperado is not None, str(ESPERADO))
    if esperado:
        caso("mesmos casos que o esperado", [k["id"] for k in esperado["casos"]] == [k["id"] for k in cs])
        for k in cs:
            d = diferencas(saidas[k["id"]], esperado["saidas"].get(k["id"]), k["id"])
            caso(f"{k['id']}: Python = esperado, campo a campo", not d, "; ".join(d[:5]))
    # sanidade da fixture: o que a prova cobre de fato (sem isto, uma fixture pobre passaria igual)
    mu = saidas["matchups"]
    caso("fixture: grupos com n >= 3 e com n < 3", any(g["n"] >= 3 for g in mu["matchups"]) and any(g["n"] < 3 for g in mu["matchups"]))
    caso("fixture: fora.sem_papel e fora.incerto > 0", mu["fora"]["sem_papel"] > 0 and mu["fora"]["incerto"] > 0, json.dumps(mu["fora"]))
    caso("fixture: grupo sem f(15) em alguma partida (n15 < n)", any(g["n15"] < g["n"] for g in mu["matchups"]))
    caso("fixture: remake e personalizada fora das contas", mu["partidas"] == sum(1 for l in linhas if l["mortes10"] is not None) - 2,
         f"{mu['partidas']} partidas")
    tr = saidas["traumas"]
    caso("fixture: há trauma (lift >= 1,2, n >= 3) e campeão popular sem trauma",
         bool(tr["traumas"]) and any(not t["trauma"] and t["n"] >= 10 for t in tr["campeoes"]), json.dumps(tr["traumas"][:2]))
    ti = saidas["tilt-tudo"]
    caso("fixture: as 4 faixas horárias e 1, 2 e 3+ derrotas seguidas", sorted(ti["faixas"]) == ["00-06", "06-12", "12-18", "18-24"]
         and sorted(ti["apos_derrotas"]) == ["1", "2", "3"], json.dumps(ti))
    ctxs = {k: v for k, v in saidas.items() if k.startswith("contexto-")}
    caso("fixture: contexto com matchup, sem matchup (incerto, sem linha do tempo) e com trauma da partida",
         any(v["matchup"] for v in ctxs.values()) and sum(1 for v in ctxs.values() if v["matchup"] is None) >= 2
         and any(v["traumas"] for v in ctxs.values()), json.dumps({k: [bool(v["matchup"]), len(v["traumas"])] for k, v in ctxs.items()}))
    print(f"\n{len(falhas)} falha(s)" if falhas else f"\nteste-contexto.py: tudo ok ({len(cs)} casos de paridade)")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
