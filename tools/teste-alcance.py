# prova do passo 15b (plano v2): área alcançável pela grade de caminhável do próprio minimapa.
#   python tools/teste-alcance.py
# A grade é REGERADA aqui a partir dos recortes reais de tests/fixtures/minimapa (mediana), como na
# partida. Cenários: parede bloqueia sem dash; Kayn cruza; Flash vira "talvez"; fog tira o iluminado.
# O alinhamento ao vivo do overlay é prova de partida (python coletor/overlay_minimapa.py --demo
# confere estilo click-through, retângulo e desenho sem partida).
import glob
import sys
from pathlib import Path

import cv2
import numpy as np

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import alcance as al  # noqa: E402
import minimapa as mm  # noqa: E402
import overlay_minimapa as ov  # noqa: E402

FIX = RAIZ / "tests" / "fixtures" / "minimapa"
VERMELHO_CHAOS, BARAO = (7101, 10900), (5007, 10471)


def quadros():
    out = []
    for p in sorted(glob.glob(str(FIX / "*.png"))):
        img = cv2.imread(p)
        r = mm.achar_mapa(img)
        out.append(np.ascontiguousarray(r.recorte(img)))
    return out


def principal():
    qs = quadros()
    g = al.Grade.de_quadros(qs)
    mob = al.ler_mobilidade()
    res = []

    def caso(nome, ok, detalhe):
        res.append(ok)
        print(f"{'ok' if ok else 'FALHOU'}  {nome}: {detalhe}")

    n = g.lado
    yy, xx = np.mgrid[0:n, 0:n]
    c, r = g.ponto(*BARAO)

    # 1) sem dash: 10 s a 345 do vermelho inimigo -> raio <= 3450 e o covil do barão (atrás da parede) fora
    a = al.Area(g, *VERMELHO_CHAOS, 0, 345, None, mob)
    m = a.em(10)
    u, v = mm.mundo_para_px(*VERMELHO_CHAOS, n)
    eu = np.hypot(xx + 0.5 - u, yy + 0.5 - v) * g.upx
    raio = eu[m == 1].max()
    caso("parede bloqueia sem dash", raio <= 3450 + g.upx and m[r, c] != 1,
         f"raio máx andando {raio:.0f} (<= 3450), covil do barão: andando {a.d[r, c]:.0f} unidades, valor {m[r, c]}")

    # 2) Kayn (E anda dentro da parede, docs/MOBILIDADE.md) cruza a mesma parede
    k = al.Area(g, *VERMELHO_CHAOS, 0, 345, "Kayn", mob)
    mk = k.em(10)
    caso("Kayn cruza a parede", mk[r, c] == 1 and (mk == 1).sum() > (m == 1).sum(),
         f"covil do barão: {k.d[r, c]:.0f} unidades, valor {mk[r, c]}; área {(m == 1).sum()} -> {(mk == 1).sum()} px")

    # 3) Flash (400) por cima da parede vira "talvez" (0,5), nunca certeza
    so_flash = m == 0.5
    caso("Flash vira talvez", m[r, c] == 0.5 and so_flash.any() and a.df[so_flash].max() <= 3450,
         f"covil com Flash: {a.df[r, c]:.0f} unidades -> valor {m[r, c]}; {so_flash.sum()} px só com Flash")

    # 4) o que está iluminado no quadro e sem o ícone dele, ele não está (área ∩ fog)
    t = mm.terreno(qs[4])
    mf = a.em(10, t["fog"])
    caso("fog tira o iluminado", (mf[t["aceso"]] == 0).all() and 0 < (mf > 0).sum() < (m > 0).sum(),
         f"área {(m > 0).sum()} px -> {(mf > 0).sum()} px na fog; iluminado com área: {(mf[t['aceso']] > 0).sum()}")

    print(f"{sum(res)}/{len(res)} ok")

    # extras: grade regerada é estável e conecta as duas fontes; overlay transparente fora da área
    um = mm.caminhavel([qs[0]])
    conc = (um == g.m).mean()
    df = g.distancia(400, 400)
    cf, rf = g.ponto(14400, 14450)
    vazio = ov.renderizar(np.zeros((n, n)), n)
    # mapa dinâmico: grade nova ~20 s depois do 2º DragonKill, só com quadros posteriores
    gts = [float(Path(p).stem) for p in sorted(glob.glob(str(FIX / "*.png")))]
    gv = al.GradeViva(lambda: list(zip(gts, qs)), "16.20", salvar=False)
    regen = [t for t in (500, 600, 900, 1250, 1300, 1700) if
             (gv.eventos([{"EventID": 1, "EventName": "DragonKill", "EventTime": 507.9, "DragonType": "Water"},
                          {"EventID": 2, "EventName": "DragonKill", "EventTime": 1230.0, "DragonType": "Fire"}]
                         if t >= 1250 else []) or gv.atualizar(t)) is not None]
    extras = [conc >= 0.95, np.isfinite(df[rf, cf]), (vazio[..., 3] == 0).all(), regen == [500, 900, 1250, 1700]]
    print(f"extras: grade regerada em gt {regen} (1ª, 2º dragão + 20 s com quadros posteriores, 5 min); tipo {gv.tipo}")
    print(f"extras: 1 quadro x mediana concordam {conc:.1%}; fonte azul -> vermelha andando {df[rf, cf]:.0f} "
          f"unidades; overlay sem calor 100% transparente: {bool(extras[2])} -> {'ok' if all(extras) else 'FALHOU'}")
    return 0 if all(res) and all(extras) else 1


if __name__ == "__main__":
    sys.exit(principal())
