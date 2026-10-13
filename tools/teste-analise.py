# prova do passo 13: confere coletor/analise.py contra o caso de referência de docs/INSIGHTS.md (gameId 3292712362)
import sys
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "coletor"))
import analise, banco

AMOSTRA = [3292673407, 3292656408, 3292611857, 3292592702, 3291749162, 3291733499, 3291720658,
           3291708550, 3291333732, 3291279167, 3291267798, 3291245839, 3291218155, 3291213848,
           3291213653, 3291211660]
ESPERADO = [  # t, regiao, lado, matador, assistentes, inimigos, frameMs, aliadosPerto, objetivos(tipo, detalhe, ms)
    ("09:21", "rota_bot", "inimigo", 10, [9], 2, 540210, [4, 5], [("HORDE", 566949), ("HORDE", 570923)]),
    ("11:07", "rota_top", "aliado", 6, [], 1, 660236, [], []),
    ("16:07", "rota_top", "aliado", 6, [], 1, 960324, [3], [("TOWER_BUILDING", 979933), ("DRAGON", 1038827)]),
    ("24:05", "rio", "inimigo", 9, [10], 2, 1440453, [4, 5], [("TOWER_BUILDING", 1475331)]),
    ("29:45", "base_inimiga", "inimigo", 9, [7, 8, 10], 4, 1800548, [3, 4, 5], []),
]
falhas = []
def conf(nome, obtido, esperado):
    if obtido != esperado:
        falhas.append(f"{nome}: obtido {obtido!r}, esperado {esperado!r}")

c = banco.abrir_leitura()
r = analise.analisar(c, 3292712362, amostra_ids=AMOSTRA)
conf("eu", (r["participantId"], r["time"], r["campeao"], r["papel"]), (1, 100, 58, "TOP"))
conf("adversario", r["adversario"], {"participantId": 6, "campeao": 83, "incerto": False})
conf("n mortes", len(r["mortes"]), 5)
for i, (m, e) in enumerate(zip(r["mortes"], ESPERADO), 1):
    conf(f"morte {i}", (m["t"], m["regiao"], m["lado"], m["matador"], m["assistentes"], m["inimigos"],
                        m["frameMs"], m["aliadosPerto"], [(o["tipo"], o["ms"]) for o in m["objetivos"]]), e)
conf("morte 3 detalhe", [(o["detalhe"], o["rota"]) for o in r["mortes"][2]["objetivos"]],
     [("OUTER_TURRET", "MID_LANE"), ("HEXTECH_DRAGON", "")])
d = {k: {x: v[x] for x in ("ouro", "xp", "farm")} for k, v in r["diffs"].items()}
conf("diffs", d, {"10": {"ouro": 171, "xp": -134, "farm": 0}, "15": {"ouro": -368, "xp": -554, "farm": 1}})
conf("diff10 abs", (r["diffs"]["10"]["eu"], r["diffs"]["10"]["adv"]),
     ({"ouro": 3334, "xp": 4670, "farm": 67}, {"ouro": 3163, "xp": 4804, "farm": 67}))
f = r["farm"]
conf("farm valor", abs(f["valor"] - 7.8861) < 0.01, True)
conf("farm media", f["media"] is not None and abs(f["media"] - 7.4437) < 0.01, True)
conf("farm n", f["n"], 16)
livre = analise.analisar(c, 3292712362)["farm"]
print(f"amostra livre (banco inteiro): n={livre['n']} media={livre['media']:.4f}")
print(f"farm: valor={f['valor']:.4f} media={f['media']:.4f} n={f['n']}")
print("mortes:", [(m["t"], m["regiao"]) for m in r["mortes"]], "| diffs 10:", d["10"], "| 15:", d["15"])
print("\n".join(falhas) if falhas else "referência ok (0 falhas)")
sys.exit(1 if falhas else 0)
