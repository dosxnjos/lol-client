# prova do passo 17 (plano v2), parte de dados: coletor/draft.py.
# 1) 3 drafts sintéticos (WR injetado) -> faixa e termos esperados -> 3/3 ok
# 2) rota provável dos 5 inimigos da partida real 3292746609 (fixture champselect-real.json),
#    com prior só da meta (sem o histórico, para não vazar a própria partida) -> 5/5 rotas
# 3) retrocesso: rota provável de cada time das partidas do banco, prior só da meta (informativo)
# 4) Draft() de verdade na sessão final da fixture (meta + histórico) e a evolução pick a pick
# uso: python tools/teste-draft.py
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import analise  # noqa: E402
import banco  # noqa: E402
import draft  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")


def tabela(d):
    return lambda c, r: d.get((c, r), (0, 0))


def sinteticos(falhas):
    casos = []
    # 1: nada sabido -> 50%, equilibrada, nenhum termo
    al = [{"campeao": c, "rota": r} for c, r in zip((1, 2, 3, 4, 5), draft.ROTAS)]
    ini = [{"campeao": c, "rota": r} for c, r in zip((6, 7, 8, 9, 10), draft.ROTAS)]
    casos.append(("sem dado", draft.forca_draft(al, ini, tabela({})), "equilibrada", []))
    # 2: dois aliados fortes na meta (53%, n=10000) -> leve vantagem, os dois no topo
    wr2 = {(1, "TOP"): (5300, 10000), (3, "MIDDLE"): (5300, 10000), (8, "MIDDLE"): (500, 1000)}
    casos.append(("aliados fortes", draft.forca_draft(al, ini, tabela(wr2)), "leve vantagem", [1, 3]))
    # 3: jungler inimigo forte (54%, n=5000) + teu histórico ruim contra o top inimigo (3V/5D) -> leve desvantagem
    wr3 = {(7, "JUNGLE"): (2700, 5000)}
    r3 = draft.forca_draft(al, ini, tabela(wr3), meu={"campeao": 1, "rota": "TOP"},
                           pessoal=lambda c, r: (0, 0), matchup=lambda c, a: (3, 8) if (c, a) == (1, 6) else (0, 0))
    casos.append(("inimigo forte + matchup ruim", r3, "leve desvantagem", ["matchup", 7]))
    ok = 0
    for nome, r, faixa, termos in casos:
        obtidos = [t["tipo"] if t["tipo"] != "meta" else t["campeao"] for t in r["termos"]]
        bate = r["faixa"] == faixa and obtidos == termos
        ok += bate
        print(f"  {nome}: p={100 * r['p']:.1f}% {r['faixa']} termos {[(t['texto'], t['pp']) for t in r['termos']]}"
              f" -> {'ok' if bate else 'FALHOU'}")
        if not bate:
            falhas.append(f"sintético '{nome}': faixa {r['faixa']} termos {obtidos}, esperado {faixa} {termos}")
    print(f"drafts sintéticos: {ok}/{len(casos)} ok")


def sessao_final():
    fx = json.loads((RAIZ / "tests" / "fixtures" / "champselect-real.json").read_text(encoding="utf-8"))
    return [e["session"] for e in fx["eventos"] if "session" in e]


def papeis_reais(c, gid):
    g = banco.ler_partida(c, gid)
    pap = analise.papeis(g, banco.ler_frames(c, gid))
    return {p["championId"]: (p["teamId"], pap["papel"][p["participantId"]]) for p in g["participants"]}


def principal():
    falhas = []
    sinteticos(falhas)
    lol = banco.abrir_leitura()
    meta = draft.abrir_meta()
    if meta is None:
        print("FALHOU: dados/meta.db não existe (rodar tools/coletar-meta.py)")
        return 1
    n_meta = meta.execute("select count(*) from partidas where remake=0").fetchone()[0]
    cont_meta = draft.contagens_rota(meta)  # só a meta: sem vazar a própria partida
    nomes = dict(lol.execute("select id, nome from campeoes"))

    sessoes = sessao_final()
    s = draft.ler_sessao(sessoes[-1])
    real = papeis_reais(lol, 3292746609)
    rot = draft.rotas_provaveis(s["inimigos"], cont_meta)
    certas = sum(rot["rotas"][c] == real[c][1] for c in s["inimigos"])
    print(f"rota provável dos inimigos da partida 3292746609 (prior: meta, {n_meta} partidas): {certas}/5")
    for c in s["inimigos"]:
        print(f"  {nomes.get(c)}: {rot['rotas'][c]} (conf. {rot['confianca'][c]:.2f}), real {real[c][1]}")
    if certas != 5:
        falhas.append(f"rota provável real: {certas}/5")

    # retrocesso no banco inteiro (cada time da partida resolvido sozinho)
    hist = draft.historico_lol(lol)
    camp_ok = camp_n = time_ok = time_n = 0
    for h in hist:
        for t in (0, 1):
            par = h["rotas"][5 * t:5 * t + 5]
            r = draft.rotas_provaveis([c for c, _ in par], cont_meta)["rotas"]
            acertos = sum(r[c] == rota for c, rota in par)
            camp_ok, camp_n = camp_ok + acertos, camp_n + 5
            time_ok, time_n = time_ok + (acertos == 5), time_n + 1
    print(f"retrocesso ({len(hist)} partidas do banco, prior só da meta): campeão na rota certa "
          f"{100 * camp_ok / camp_n:.1f}% ({camp_ok}/{camp_n}), time inteiro certo {100 * time_ok / time_n:.1f}%")

    d = draft.Draft(conn_lol=lol, conn_meta=meta)
    print(f"Draft carregado em {d.carregou_s:.1f} s ({len(d.hist)} partidas do histórico, meta {d.n_meta})")
    vistos = None
    for i, sess in enumerate(sessoes):
        inim = draft.ler_sessao(sess)["inimigos"]
        if inim != vistos and inim:
            r = d.analisar_sessao(sess)
            adv = r["adversario"]
            print(f"  evento {i}: inimigos travados {[nomes.get(c) for c in inim]} -> "
                  f"{[(nomes.get(j['campeao']), j['rota'], j['confianca']) for j in r['inimigos']]}; "
                  f"adversário {adv and nomes.get(adv['campeao'])}; {r['faixa']} ({100 * r['p']:.1f}%)")
            vistos = inim
    r = d.analisar_sessao(sessoes[-1])
    print("sessão final:", json.dumps({k: r[k] for k in ("faixa", "p", "termos")}, ensure_ascii=False))
    if r["faixa"] not in [f for _, f in draft.FAIXAS]:
        falhas.append("faixa inválida na sessão real")
    dez = r["aliados"] + r["inimigos"]
    print("C2, WR na rota (meta):", [(nomes.get(j["campeao"]), j["rota"], j["wr"], j["n"]) for j in dez])
    if len(dez) != 10 or any("n" not in j or "wr_enc" not in j for j in dez):
        falhas.append("WR por campeão ausente no resultado")
    print("FALHOU: " + "; ".join(falhas) if falhas else "3/3 ok + rota provável real 5/5 ok")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(principal())
