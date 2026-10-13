# par do tools/teste-matchup.mjs (plano v2, passos 4 e 19): saída de analise.matchups() e analise.traumas()
# no banco (só leitura) + as linhas esperadas do selo calculadas aqui, do lado do Python.
#   python tools/teste-matchup.py [banco] [campeão...]   (padrão: dados/lol.db, Renekton 58 e Zac 154)
import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "coletor"))
import analise  # noqa: E402
import banco  # noqa: E402


def sinal(v):
    v = math.floor(v + 0.5)
    return f"+{v}" if v > 0 else f"−{-v}" if v < 0 else "0"


def linha(g, nome):
    if g is None:
        return f"contra {nome}: sem histórico"
    if g["n"] < analise.MIN_MATCHUP:
        return f"contra {nome}: n={g['n']}"
    base = f"contra {nome}: {g['vitorias']}V/{g['n'] - g['vitorias']}D"
    return base if g["ouro10"] is None else f"{base} · ouro10 {sinal(g['ouro10'])}"


def principal():
    args = sys.argv[1:]
    db = args.pop(0) if args and not args[0].isdigit() else banco.DB_PADRAO
    campeoes = [int(a) for a in args] or [58, 154]
    c = banco.abrir_leitura(db)
    nomes = dict(c.execute("select id, nome from campeoes"))
    out = []
    for meu in campeoes:
        mu = analise.matchups(c, meu)
        tr = analise.traumas(c, campeao=meu)
        # casos: cada grupo (papel desempata) + um adversário que nunca apareceu
        casos = [{"meu": meu, "inimigo": g["adversario"], "papel": g["papel"], "nome": nomes.get(g["adversario"], str(g["adversario"])),
                  "esperado": linha(g, nomes.get(g["adversario"], str(g["adversario"])))} for g in mu["matchups"]]
        casos.append({"meu": meu, "inimigo": 99999, "papel": "", "nome": "Ninguém", "esperado": linha(None, "Ninguém")})
        top = next(iter(sorted(tr["traumas"], key=lambda t: (-t["lift"], t["campeao"]))), None)
        out.append({"meu": meu, "matchups": mu["matchups"], "traumas": tr["campeoes"], "casos": casos,
                    "trauma_esperado": top and f"{nomes.get(top['campeao'], str(top['campeao']))} é trauma: {top['vitorias']}V/{top['derrotas']}D",
                    "nomes": {str(k): v for k, v in nomes.items()}})
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    principal()
