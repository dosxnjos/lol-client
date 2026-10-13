# prova do passo 19 (plano v2): traumas() com histórico sintético num banco em temp/.
# X em 6 de 8 derrotas e 1 de 8 vitórias -> trauma; Y em todas -> lift 1, não é trauma;
# Z em 2 derrotas (n < 3) -> não; remake e treino com X não contam; filtro por campeão.
# Depois roda no banco real (dados/lol.db, só leitura) e mostra os traumas do Gabriel.
# uso: python tools/teste-traumas.py
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import analise  # noqa: E402
import banco  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
EU = "puuid-eu"
MEU_A, MEU_B = 58, 154          # Renekton, Zac
X, Y, Z, W = 122, 266, 86, 54   # trauma, popular, pouca amostra, freguês
OUTROS = [1, 2, 3, 4, 5, 6, 7]


def montar(caminho):
    if caminho.exists():
        caminho.unlink()
    c = banco.abrir(caminho)
    banco.meta(c, "puuid", EU)
    jogos = []
    # 8 derrotas: X em 6, Z em 2 (as que não têm X); 8 vitórias: X em 1, W em 4
    for i in range(8):
        inimigos = [Y] + ([X] if i < 6 else [Z]) + OUTROS[:3]
        jogos.append((False, inimigos, MEU_A if i % 2 else MEU_B, 420, 1800))
    for i in range(8):
        inimigos = [Y] + ([X] if i == 0 else []) + ([W] if 1 <= i <= 4 else []) + OUTROS[:5 - 1 - (i == 0) - (1 <= i <= 4)]
        jogos.append((True, inimigos[:5], MEU_A if i % 2 else MEU_B, 420, 1800))
    # fora das contas: remake e treino com X em derrota
    jogos.append((False, [X, Y, 1, 2, 3], MEU_A, 420, 200))
    jogos.append((False, [X, Y, 1, 2, 3], MEU_A, 3140, 1800))
    with c:
        for gid, (vit, inimigos, meu, fila, dur) in enumerate(jogos, start=1000):
            c.execute("insert into partidas (game_id, criacao, duracao, mapa, fila, eu, campeao, time, vitoria, "
                      "tem_timeline, json) values (?,?,?,?,?,?,?,?,?,0,'{}')",
                      (gid, gid * 1000, dur, 11, fila, 1, meu, 100, int(vit)))
            c.execute("insert into participantes (game_id, participant_id, time, campeao, puuid, eu, vitoria) "
                      "values (?,?,?,?,?,?,?)", (gid, 1, 100, meu, EU, 1, int(vit)))
            for k, cid in enumerate(OUTROS[3:7], start=2):
                c.execute("insert into participantes (game_id, participant_id, time, campeao, puuid, eu, vitoria) "
                          "values (?,?,?,?,?,?,?)", (gid, k, 100, 900 + k, f"a{k}", 0, int(vit)))
            for k, cid in enumerate(inimigos, start=6):
                c.execute("insert into participantes (game_id, participant_id, time, campeao, puuid, eu, vitoria) "
                          "values (?,?,?,?,?,?,?)", (gid, k, 200, cid, f"i{k}", 0, int(not vit)))
    return c


def principal():
    falhas = []
    c = montar(RAIZ / "temp" / "teste-traumas.db")
    r = analise.traumas(c)
    por = {x["campeao"]: x for x in r["campeoes"]}
    print(f"sintético: {r['partidas']} partidas, {r['derrotas']} derrotas, taxa {r['taxa_derrota']:.2f}, K={r['k']}")
    for cid, nome in ((X, "X"), (Y, "Y popular"), (Z, "Z n=2"), (W, "W freguês")):
        x = por.get(cid)
        print(f"  {nome}: n={x['n']} {x['vitorias']}V/{x['derrotas']}D lift {x['lift']:.3f} "
              f"(bruto {x['lift_bruto']:.3f}) trauma={x['trauma']}")
    if r["partidas"] != 16:
        falhas.append(f"remake/treino entraram: {r['partidas']} partidas")
    if [t["campeao"] for t in r["traumas"]] != [X]:
        falhas.append(f"traumas = {[t['campeao'] for t in r['traumas']]}, esperado só X")
    if abs(por[Y]["lift"] - 1.0) > 1e-9 or por[Y]["trauma"]:
        falhas.append("campeão popular virou trauma ou lift != 1")
    if por[Z]["trauma"]:
        falhas.append("n < 3 virou trauma")
    if por[X]["n"] != 7 or por[X]["derrotas"] != 6:
        falhas.append(f"X contado errado: {por[X]}")
    rf = analise.traumas(c, campeao=MEU_A)
    fx = next(x for x in rf["campeoes"] if x["campeao"] == X)
    print(f"  filtro Renekton: {rf['partidas']} partidas, X n={fx['n']} {fx['vitorias']}V/{fx['derrotas']}D")
    if rf["partidas"] != 8 or fx["n"] != 3:  # derrotas ímpares (1,3,5) com X; vitória 0 é Zac
        falhas.append(f"filtro por campeão: {rf['partidas']} partidas, X n={fx['n']}")
    c.close()

    real = banco.abrir_leitura()
    nomes = dict(real.execute("select id, nome from campeoes"))
    for camp in (None, 58, 154):
        rr = analise.traumas(real, campeao=camp)
        rotulo = "geral" if camp is None else nomes.get(camp)
        tops = ", ".join(f"{nomes.get(t['campeao'])} {t['vitorias']}V/{t['derrotas']}D lift {t['lift']:.2f}"
                         for t in rr["traumas"][:5]) or "nenhum"
        print(f"real ({rotulo}): {rr['partidas']} partidas, derrota {100 * (rr['taxa_derrota'] or 0):.0f}%, "
              f"{len(rr['traumas'])} traumas; top: {tops}")
    print("FALHOU: " + "; ".join(falhas) if falhas else "ok")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(principal())
