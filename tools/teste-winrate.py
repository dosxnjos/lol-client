# contagem independente do winrate (par do tools/teste-winrate.mjs): lê o histórico salvo da LCU e
# imprime JSON {"<championId>|<posicao>": {...}} pela regra de docs/INSIGHTS.md § Winrate no champ select.
# uso: python tools/teste-winrate.py temp/historico.json
import json
import math
import sys

ITEM = {}
for pos, ids in {"TOP": (1200, 1220, 1221, 1222), "MIDDLE": (1201, 1206), "BOTTOM": (1202, 1207),
                 "UTILITY": (1203, 1208, 2055), "JUNGLE": (1204, 1205, 1209, 1210)}.items():
    for i in ids:
        ITEM[i] = pos


def posicao(p):
    pos = ITEM.get(p["stats"].get("roleBoundItem"))
    if pos:
        return pos
    return "JUNGLE" if 11 in (p["spell1Id"], p["spell2Id"]) else ""


def resumo(stats):
    n = len(stats)
    if not n:
        return {"n": 0}
    v = sum(1 for s in stats if s["win"])
    k = sum(s["kills"] for s in stats)
    d = sum(s["deaths"] for s in stats)
    a = sum(s["assists"] for s in stats)
    um = lambda x: math.floor(x * 10 + 0.5) / 10  # noqa: E731  meia unidade para cima, como Math.round (round() do Python é bancário)
    return {"n": n, "vitorias": v, "winrate": math.floor(v / n * 100 + 0.5), "k": um(k / n), "d": um(d / n),
            "a": um(a / n), "kda": um((k + a) / d) if d else None}  # sem morte: None ("perfeito")


def main():
    h = json.load(open(sys.argv[1], encoding="utf-8"))
    jogos = h["games"]["games"] if isinstance(h, dict) else h
    validos = [g for g in jogos if g["mapId"] == 11 and g["gameType"] == "MATCHED_GAME"
               and not g["participants"][0]["stats"]["gameEndedInEarlySurrender"]]
    out = {}
    campeoes = sorted({g["participants"][0]["championId"] for g in jogos}) + [103]  # 103 (Ahri): nunca jogado
    for c in campeoes:
        meus = [g["participants"][0] for g in validos if g["participants"][0]["championId"] == c]
        out[f"{c}|"] = resumo([p["stats"] for p in meus])
        for pos in ("TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"):
            out[f"{c}|{pos}"] = resumo([p["stats"] for p in meus if posicao(p) == pos])
    print(json.dumps(out))


main()
