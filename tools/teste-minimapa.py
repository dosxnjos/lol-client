# prova do passo 13 (plano v2): detecção do minimapa contra recortes reais anotados à mão.
#   python tools/teste-minimapa.py [tests/fixtures/minimapa/*.png] [--folha temp/minimapa-prova.png]
# Mede: retângulo achado sozinho (347 px em (134,133) no recorte), filtro "jogo na tela", acerto
# dos ícones a <= 600 unidades (meta >= 80%), falsos positivos e tempo por quadro.
import argparse
import glob
import json
import math
import sys
import time
from pathlib import Path

import cv2
import numpy as np

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import minimapa as mm  # noqa: E402

FIX = RAIZ / "tests" / "fixtures" / "minimapa"


def principal():
    ap = argparse.ArgumentParser()
    ap.add_argument("pngs", nargs="*")
    ap.add_argument("--folha", help="grava as detecções desenhadas sobre os recortes (conferência visual)")
    ap.add_argument("--telas", default=str(RAIZ / "temp" / "gravacao" / "*" / "telas" / "*.png"))
    a = ap.parse_args()
    pngs = sorted(a.pngs or glob.glob(str(FIX / "*.png")))
    partida = json.loads((FIX / "partida.json").read_text(encoding="utf-8"))
    eu = next(c for c in partida["campeoes"] if c["campeao"] == partida["eu"])
    falhas = []

    # 1) retângulo achado sozinho nos recortes
    rets = {}
    for p in pngs:
        img = cv2.imread(p)
        r = mm.achar_mapa(img)
        rets[p] = r
        if r is None or abs(r.left - 134) > 1 or abs(r.top - 133) > 1 or abs(r.lado - 347) > 1:
            falhas.append(f"retângulo {Path(p).name}: {r}")
    print(f"retângulo nos recortes: {sum(1 for r in rets.values() if r and r.lado == 347)}/{len(pngs)} com 347 px",
          "| exemplo", next(iter(rets.values())))

    # 1b) telas inteiras da gravação, se estiverem na máquina (temp/, fora do git)
    telas = sorted(glob.glob(a.telas))
    if telas:
        achados, vistos = {}, 0
        for t in telas:
            img = cv2.imread(t)
            r = mm.achar_mapa(img)
            if r is None:
                continue
            vistos += 1
            achados[(r.left, r.top, r.lado)] = achados.get((r.left, r.top, r.lado), 0) + 1
        print(f"telas inteiras: mapa achado em {vistos}/{len(telas)}; retângulos {achados}")
        if achados and max(achados, key=achados.get) != (2197, 716, 347):
            falhas.append(f"telas: retângulo mais comum {max(achados, key=achados.get)} != (2197, 716, 347)")

    # 2) filtro "jogo na tela": recortes reais passam; o mesmo recorte sem a faixa (outra janela) não
    img = cv2.imread(pngs[0])
    r = rets[pngs[0]]
    falso = np.full_like(img, 200)
    falso[r.top:r.top + r.lado, r.left:r.left + r.lado] = img[r.top:r.top + r.lado, r.left:r.left + r.lado]
    passa = sum(mm.jogo_na_tela(cv2.imread(p), rets[p]) for p in pngs if rets[p])
    nega = not mm.jogo_na_tela(falso, r) and mm.achar_mapa(falso) is None
    print(f"jogo na tela: {passa}/{len(pngs)} recortes reais aceitos; janela sem a faixa recusada: {nega}")
    if passa != len(pngs) or not nega:
        falhas.append("filtro jogo na tela")

    # 3) detecção contra a anotação à mão
    tot = ok = enc_tot = enc_ok = fp = 0
    yuumi_ok = yuumi_tot = 0
    tempos, folhas = [], []
    for p in pngs:
        anot = json.loads(Path(p).with_suffix(".json").read_text(encoding="utf-8"))
        ret = rets[p]
        if ret is None:
            continue
        img = cv2.imread(p)
        mapa = np.ascontiguousarray(ret.recorte(img))
        det = mm.Detector(partida["campeoes"], eu["time"], ret.lado, FIX / "icones")
        t0 = time.perf_counter()
        ds = det.detectar(mapa, anot.get("mortos", []))
        tempos.append((time.perf_counter() - t0) * 1000)
        por = {d.campeao: d for d in ds}
        linha = []
        anotados = {i["campeao"] for i in anot["icones"]}
        for ic in anot["icones"]:
            ax, ay = mm.px_para_mundo(ic["px"][0], ic["px"][1], 347)
            d = por.get(ic["campeao"])
            dist = math.hypot(d.x - ax, d.y - ay) if d else None
            acerto = dist is not None and dist <= 600
            if ic.get("marca") == "encoberto":
                enc_tot += 1
                enc_ok += acerto
            else:
                tot += 1
                ok += acerto
            if ic.get("marca") == "yuumi":
                yuumi_tot += 1
                y = por.get("Yuumi")
                yuumi_ok += bool(y and math.hypot(y.x - ax, y.y - ay) <= 600)
            linha.append(f"{ic['campeao']}{'*' if ic.get('marca') == 'encoberto' else ''}:"
                         f"{'ok' if acerto else 'X'}({'-' if dist is None else int(dist)})")
        presa = [i for i in anot["icones"] if i.get("marca") == "yuumi"]
        for d in ds:
            if d.yuumi:
                # Yuumi deduzida pelo anel grosso: só vale se a anotação diz que ela estava presa ali
                if not presa:
                    fp += 1
                    linha.append(f"FP Yuumi deduzida ({d.u:.0f},{d.v:.0f}): anel grosso sem Yuumi")
            elif d.campeao not in anotados:
                fp += 1
                linha.append(f"FP {d.campeao}({d.u:.0f},{d.v:.0f} anel {d.anel} rosto {d.rosto})")
            elif d.campeao in anotados:
                ic = next(i for i in anot["icones"] if i["campeao"] == d.campeao)
                ax, ay = mm.px_para_mundo(ic["px"][0], ic["px"][1], 347)
                if math.hypot(d.x - ax, d.y - ay) > 600:
                    fp += 1
        print(f"  {Path(p).stem}: " + " ".join(linha))
        if a.folha:
            f = cv2.resize(mapa, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
            for ic in anot["icones"]:
                cv2.circle(f, (int(ic["px"][0] * 2), int(ic["px"][1] * 2)), 4, (0, 255, 255), -1)
            for d in ds:
                cv2.circle(f, (int(d.u * 2), int(d.v * 2)), 29, (0, 255, 0) if not d.yuumi else (255, 0, 255), 2)
                cv2.putText(f, d.campeao[:4], (int(d.u * 2) - 20, int(d.v * 2) - 32), cv2.FONT_HERSHEY_SIMPLEX,
                            0.5, (255, 255, 255), 2)
            folhas.append(f)
    pct = 100 * ok / max(1, tot)
    print(f"ícones visíveis: {ok}/{tot} a <= 600 ({pct:.0f}%) | encobertos: {enc_ok}/{enc_tot} | "
          f"Yuumi presa achada: {yuumi_ok}/{yuumi_tot} | falsos positivos: {fp}")
    print(f"tempo por quadro: mediana {np.median(tempos):.1f} ms, máx {max(tempos):.1f} ms "
          f"(a 6 fps: {np.median(tempos) * 6 / 10:.1f}% de um núcleo)")
    if pct < 80:
        falhas.append(f"acerto {pct:.0f}% < 80%")
    if a.folha and folhas:
        lin = [np.hstack(folhas[i:i + 4] + [np.zeros_like(folhas[0])] * (4 - len(folhas[i:i + 4])))
               for i in range(0, len(folhas), 4)]
        cv2.imwrite(a.folha, np.vstack(lin))
        print("folha:", a.folha)
    # 4) interface para o motor de avisos: Captura.processar -> deteccoes() [{campeao, time, x, y, visto_em, grande}]
    info = {"meu_time": eu["time"], "campeoes": partida["campeoes"], "mortos": []}
    cap = mm.Captura(lambda: info, relogio=lambda: 503.0, pasta_icones=FIX / "icones")
    p = str(FIX / "00502.0.png")
    cap.ret = rets[p]
    cap.processar(np.ascontiguousarray(rets[p].recorte(cv2.imread(p))), info, 502.0)
    ds = cap.deteccoes()
    chaves_ok = ds and all(set(d) == {"campeao", "time", "x", "y", "visto_em", "grande"} for d in ds)
    velhos = cap.deteccoes(max_idade=0.5)
    print(f"interface: {len(ds)} detecções, ex. {ds[0] if ds else None}; max_idade 0,5 s -> {len(velhos)}")
    if not chaves_ok or velhos:
        falhas.append("interface deteccoes()")
    # 5) laço ao vivo sem o jogo em primeiro plano: não captura nada e não quebra
    if "--sem-laco" not in sys.argv:
        cap2 = mm.Captura(lambda: info, relogio=lambda: 0.0, pasta_icones=FIX / "icones")
        cap2.iniciar()
        time.sleep(1.5)
        cap2.parar()
        print(f"laço sem o jogo na frente: ret={cap2.ret} no_ar={cap2.no_ar} detecções={len(cap2.deteccoes())}")
        if cap2.ret is not None or cap2.no_ar:
            falhas.append("laço capturou sem o jogo em primeiro plano")
    print("FALHOU: " + "; ".join(falhas) if falhas else "ok")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(principal())
