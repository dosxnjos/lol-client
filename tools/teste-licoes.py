# prova do passo 6 (plano v2), lado Python: as 3 lições do coletor/coach.py na partida de referência
# (3292712362, fixtures de tests/fixtures/ num SQLite em memória) e na partida real 3292746609 (dados/lol.db).
# Grava em temp/licoes/<gameId>.json o que o node precisa para refazer do lado JS (contexto do coletor,
# nomes, as métricas daqui para comparar; na real, também partida, timeline e histórico tirados do banco).
# O par é tools/teste-licoes.mjs: as linhas "licoes <id>: …" das duas saídas têm de ser iguais.
# uso: python tools/teste-licoes.py
import functools
import json
import random
import sqlite3
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import banco  # noqa: E402
import coach  # noqa: E402

REF, REAL = 3292712362, 3292746609
ESPERADO_REF = ["mortes-1x1-adversario", "virada-10-15", "farm-acima"]  # fixtures congeladas: não deriva
SAIDA = RAIZ / "temp" / "licoes"
FIX = RAIZ / "tests" / "fixtures"
falhas = []


def nomes_reais():
    try:
        return coach.nomes_banco(banco.abrir_leitura())
    except FileNotFoundError:
        return {}


def rodar(c, gid, nomes, regras):
    r = coach.analisar(c, gid)
    if "erro" in r:
        raise SystemExit(f"FALHOU: {gid}: {r['erro']}")
    ses = coach.sessao(coach.historico_banco(c), gid, r["criacao"])
    ctx = coach.contexto_partida(c, gid, r)
    m = coach.montar_metricas(r, ses, ctx, nomes)
    return r, ctx, m, coach.escolher(regras, m)


def imprimir(gid, lic):
    print(f"licoes {gid}: " + " > ".join(x["id"] for x in lic))
    for x in lic:
        print(f"  [{x['tipo']}] {x['texto']}")


def salvar(gid, dado):
    SAIDA.mkdir(parents=True, exist_ok=True)
    (SAIDA / f"{gid}.json").write_text(json.dumps(dado, ensure_ascii=False), encoding="utf-8")


regras = coach.carregar_regras()
nomes = nomes_reais()

# referência: só fixtures (como tools/teste-analise.py)
ler = lambda n: json.loads((FIX / n).read_text(encoding="utf-8"))
puuid = ler("summoner.json")["puuid"]
c = sqlite3.connect(":memory:")
c.executescript(banco.ESQUEMA)
banco.meta(c, "puuid", puuid)
for g in ler("historico.json")["games"]["games"]:
    if g["gameId"] != REF:
        banco.gravar_partida(c, g, puuid)
banco.gravar_partida(c, ler(f"game-{REF}.json"), puuid, ler(f"timeline-{REF}.json"))
r, ctx, m, lic = rodar(c, REF, nomes, regras)
salvar(REF, {"gameId": REF, "fonte": "fixtures", "contexto": ctx, "nomes": nomes, "metricas": m, "licoes": lic})
imprimir(REF, lic)
if [x["id"] for x in lic] != ESPERADO_REF:
    falhas.append(f"{REF}: esperado {ESPERADO_REF}")

# real: do banco
try:
    db = banco.abrir_leitura()
except FileNotFoundError:
    db = None
    falhas.append(f"{REAL}: dados/lol.db não existe")
if db is not None:
    r, ctx, m, lic = rodar(db, REAL, nomes, regras)
    g = banco.ler_partida(db, REAL)
    hist = []  # formato do current-summoner/matches da LCU: participants[0] = o próprio
    for gid, ej, pj in db.execute(
            "select pa.game_id, pa.json, pp.json from partidas pa join participantes pp "
            "on pp.game_id = pa.game_id and pp.eu = 1"):
        pa = json.loads(ej)
        hist.append({k: pa.get(k) for k in ("gameId", "gameCreation", "gameDuration", "mapId", "queueId")}
                    | {"participants": [json.loads(pj)]})
    salvar(REAL, {"gameId": REAL, "fonte": "dados/lol.db", "puuid": banco.meta(db, "puuid"), "partida": g,
                  "timeline": {"frames": banco.ler_frames(db, REAL)}, "historico": hist,
                  "contexto": ctx, "nomes": nomes, "metricas": m, "licoes": lic})
    imprimir(REAL, lic)
    if len(lic) != 3:
        falhas.append(f"{REAL}: {len(lic)} lições")

    # cruzado: o motor (expressão, nulo, formato, grupo, troca pela positiva) em mais casos que as 2 partidas:
    # as métricas de todas as partidas do banco + conjuntos sorteados (semente fixa). O node refaz cada um.
    analise = coach.analise
    analise.matchups = functools.lru_cache(None)(analise.matchups)  # 1 por campeão, não 1 por partida
    if hasattr(analise, "traumas"):
        analise.traumas = functools.lru_cache(None)(analise.traumas)
    hist_db = coach.historico_banco(db)
    casos, disparos = [], {}
    for (gid,) in db.execute("select game_id from partidas where mapa=11 and tem_timeline=1 and eu is not null "
                             f"and fila not in {analise.FORA_DAS_CONTAS} and duracao >= {analise.REMAKE_S}"):
        r = coach.analisar(db, gid)
        if "erro" in r:
            continue
        m = coach.montar_metricas(r, coach.sessao(hist_db, gid, r["criacao"]), coach.contexto_partida(db, gid, r), nomes)
        casos.append({"origem": gid, "metricas": m})
    n_banco = len(casos)
    rnd = random.Random(20261013)
    POOL = [None, 0, 1, 2, 3, 5, 8, 10, 15, 20, 0.3, 0.4424, -0.5, -0.25, 0.25, 2.5, 40, 45, 47.6, 52.3,
            -435, -368, -1000, 171, 500, 1.26, 289069, 33.37]
    for i in range(400):
        m = {k: (rnd.choice([None, "Zac", "06-12"]) if tipo == "texto" else rnd.choice(POOL))
             for k, (tipo, _) in coach.METRICAS.items()}
        m["vitoria"] = rnd.choice([0, 1])
        casos.append({"origem": f"sorteio {i}", "metricas": m})
    for caso in casos:
        m = caso["metricas"]
        caso["licoes"] = coach.escolher(regras, m)
        caso["regras"] = {}
        for rg in regras:
            v = coach.avaliar_expr(coach.compilar(rg["quando"]), m)
            caso["regras"][rg["id"]] = [v, coach.renderizar(rg["texto"], m)]
            disparos[rg["id"]] = disparos.get(rg["id"], 0) + (v is True)
        for x in caso["licoes"]:
            disparos.setdefault("escolhida:" + x["id"], 0)
            disparos["escolhida:" + x["id"]] += 1
    salvar("cruzado", casos)
    nunca = [rg["id"] for rg in regras if not disparos.get(rg["id"])]
    nunca_banco = [rg["id"] for rg in regras
                   if not any(c_["regras"][rg["id"]][0] is True for c_ in casos[:n_banco])]
    print(f"cruzado: {n_banco} partidas do banco + 400 sorteios; regras que nunca disparam: {nunca or 'nenhuma'}; "
          f"no banco nunca disparam: {nunca_banco or 'nenhuma'}")
    if nunca:
        falhas.append(f"regras que nunca disparam nem no sorteio: {nunca}")

print("\n".join(f"FALHOU: {f}" for f in falhas) if falhas else f"ok (dados do node em {SAIDA.relative_to(RAIZ)})")
sys.exit(1 if falhas else 0)
