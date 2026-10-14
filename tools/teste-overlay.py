# prova do desenho do overlay do minimapa (calibração de 14/10/2026, roadmap/2026-10-14-calibrar-avisos.md)
# sem abrir janela: o que o coletor/overlay_minimapa.py manda ao UpdateLayeredWindow. Casos:
#   1. sem calor = 100% transparente; uma cor só (COR) em todo px pintado fora da caixa do texto
#   2. probabilidade = opacidade: ALPHA no mais provável, cai até ~ALPHA_MIN na borda, nunca acima de ALPHA
#   3. borda suave (anti-aliasing): maior salto de opacidade entre px vizinhos, contra o corte seco antigo
#      (cor-chave: 0 → 140 de um px para o outro)
#   4. transição: a área crescendo (alvo novo a cada 400 ms) muda no máximo um pouco por quadro e para de
#      redesenhar quando converge; sem a transição o salto era o do alvo inteiro
#   5. premultiplicar / compor_sobre = a conta do UpdateLayeredWindow, refeita aqui à parte
#   6. custo por quadro (347 px) → % de um núcleo a ~15 quadros/s enquanto anima (parado não desenha)
# uso: python tools/teste-overlay.py
import sys
import time
from pathlib import Path

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import overlay_minimapa as ov  # noqa: E402

resultados = []
LADO = 347


def caso(nome, ok, detalhe=""):
    resultados.append(bool(ok))
    print(f"{'ok' if ok else 'FALHOU'}  {nome}" + (f"  ({detalhe})" if detalhe else ""))


def calor_disco(raio, cx=0.35, cy=0.4, lado=LADO):
    yy, xx = np.mgrid[0:lado, 0:lado]
    return np.clip(1 - np.hypot(xx - lado * cx, yy - lado * cy) / max(raio, 1), 0, 1).astype(np.float32)


def salto_vizinho(a8):
    a = a8.astype(int)
    return int(max(np.abs(np.diff(a, axis=0)).max(), np.abs(np.diff(a, axis=1)).max()))


def principal():
    vazio = ov.renderizar(None, LADO)
    caso("sem calor: 100% transparente", (vazio[..., 3] == 0).all())

    c = calor_disco(LADO * 0.25)
    img = ov.renderizar(c, LADO)
    a = img[..., 3]
    pintado = a > 0
    caso("uma cor só em todo px pintado (COR, sem amarelo/laranja nem contorno branco)",
         pintado.any() and (img[pintado][:, :3] == np.array(ov.COR, np.uint8)).all(),
         f"{int(pintado.sum())} px pintados, cores {np.unique(img[pintado][:, :3], axis=0).tolist()}")
    a_max = int(a.max())
    centro = int(a[int(LADO * 0.4), int(LADO * 0.35)])
    borda = a[(c > 0.04) & (c < 0.08)]
    caso("probabilidade = opacidade: o mais provável no ALPHA, a borda bem mais clara",
         abs(a_max - round(ov.ALPHA * 255)) <= 4 and centro == a_max and 0 < int(np.median(borda)) <= round(ov.ALPHA_MIN * 255) + 4,
         f"máx {a_max}/255 (ALPHA {ov.ALPHA}), centro {centro}, borda mediana {int(np.median(borda))} "
         f"(ALPHA_MIN {ov.ALPHA_MIN} = {round(ov.ALPHA_MIN * 255)})")

    # revisão 14/10/2026: o calor é constante dentro de cada zona; zona de pouca chance (calor = LIMIAR, 0,05)
    # tem de sair inteira no piso ALPHA_MIN (antes da correção saía a ~7%, e a 0,04 a ~3%: a área "até onde
    # ele conseguiria ter ido", que o contorno branco mostrava, sumia)
    zona = np.zeros((LADO, LADO), np.float32)
    zona[60:200, 60:200] = ov.LIMIAR
    zona[100:160, 100:160] = 1.0
    az = ov.renderizar(zona, LADO)[..., 3]
    miolo_fraco = az[70:90, 70:190]                     # dentro da zona fraca, longe da borda e da forte
    caso("zona de pouca chance (calor = LIMIAR) inteira no piso ALPHA_MIN, não quase invisível",
         int(miolo_fraco.min()) >= round(ov.ALPHA_MIN * 255) - 1,
         f"mín {int(miolo_fraco.min())}/255, piso {round(ov.ALPHA_MIN * 255)}/255")

    # mesmo calor com a fog recortando (borda reta e dura vinda da máscara): o desfoque também a suaviza
    fog = np.ones((LADO, LADO), np.float32)
    fog[:, int(LADO * 0.4):] = 0
    s_novo = salto_vizinho(ov.renderizar(c * fog, LADO)[..., 3])
    s_antigo = round(0.55 * 255)            # versão Tk: px fora da chave = 100% da cor com alfa global 0,55
    caso("borda suave (anti-aliasing), inclusive no corte da fog: maior salto entre px vizinhos",
         s_novo <= 25, f"{s_novo}/255 agora; antes {s_antigo}/255 (cor-chave serrilhada)")

    # a área cresce de 15% a 30% do lado em 4 s (alvo novo a cada 400 ms), quadros a 66 ms
    tr = ov.Transicao()
    saltos_com, saltos_sem, ultimo_alvo, mostrado_ant = [], [], None, None
    alvo, busca = None, -1
    for i in range(int(4.0 / 0.066) + 1):
        t = i * 0.066
        if int(t // 0.4) != busca:              # a fonte é lida a cada 400 ms
            busca = int(t // 0.4)
            raio = LADO * (0.15 + 0.15 * min(1.0, t / 4.0))
            novo = ov.alfa_alvo(calor_disco(raio), LADO)
            if ultimo_alvo is not None:
                saltos_sem.append(float(np.abs(novo - ultimo_alvo).max()))
            alvo = ultimo_alvo = novo
        m, _ = tr.passo(alvo, 0.066)
        if mostrado_ant is not None:
            saltos_com.append(float(np.abs(m - mostrado_ant).max()))
        mostrado_ant = m.copy()
    quadros_ate_parar = 0
    for _ in range(200):
        quadros_ate_parar += 1
        if tr.passo(alvo, 0.066)[1]:
            break
    entrada = max(saltos_com[:15])               # o 1º segundo: a mancha aparece esmaecendo (fade-in)
    cresce = max(saltos_com[15:])
    caso("transição: crescendo, cada quadro muda bem menos que o salto do alvo; para de redesenhar ao convergir",
         cresce < max(saltos_sem) / 3 and entrada * 255 <= 25 and quadros_ate_parar < 60,
         f"crescendo: maior mudança por quadro {cresce * 255:.1f}/255 (sem transição {max(saltos_sem) * 255:.1f}/255 "
         f"de uma vez a cada 400 ms); aparecendo: {entrada * 255:.1f}/255 por quadro; parado em "
         f"{quadros_ate_parar} quadros ({quadros_ate_parar * 0.066:.1f} s)")

    rgba = ov.renderizar(c, LADO, "jungler sumido há 12 s")
    p = ov.premultiplicar(rgba)
    a16 = rgba[..., 3].astype(int)
    pm_ok = all(np.array_equal(p[..., i], (rgba[..., j].astype(int) * a16 + 127) // 255) for i, j in ((0, 2), (1, 1), (2, 0)))
    fundo = np.random.default_rng(3).integers(0, 256, (LADO, LADO, 3), dtype=np.uint8)
    comp = ov.compor_sobre(fundo, rgba).astype(int)
    esperado = (rgba[..., :3].astype(int) * a16[..., None] + 127) // 255 + (fundo.astype(int) * (255 - a16[..., None]) + 127) // 255
    caso("premultiplicar e compor_sobre = conta do UpdateLayeredWindow (alfa 0 = o fundo intacto)",
         pm_ok and np.array_equal(comp, esperado) and np.array_equal(comp[a16 == 0], fundo[a16 == 0]))
    m = ov.alfa_alvo(c, LADO) * np.float32(0.83)
    caso("caminho rápido da janela (tabela) = premultiplicar(camada) byte a byte (o que a vitrine compõe)",
         np.array_equal(ov.bgra_rapido(m), ov.premultiplicar(ov.camada(m))))

    # escolhas das Configurações (overlayCor/overlayForca/overlaySuave, pedido do Gabriel de 14/10/2026): o padrão é
    # o desenho de cima; cada escolha muda só o que diz
    e0 = ov.estilo()
    caso("escolhas: padrão (vermelho, normal, suave) = as constantes do módulo; nome desconhecido = padrão",
         e0 == ov.Estilo(tuple(ov.COR), ov.ALPHA, ov.ALPHA_MIN, ov.TAU_S) and ov.estilo("azul", "x", True) == e0
         and np.array_equal(ov.renderizar(c, LADO, estilo=e0), ov.renderizar(c, LADO)), f"{e0}")
    lar = ov.estilo("laranja")
    il = ov.renderizar(c, LADO, estilo=lar)
    pint = il[..., 3] > 0
    caso("escolhas: cor laranja pinta tudo em laranja com a mesma opacidade do vermelho",
         (il[pint][:, :3] == np.array(ov.CORES["laranja"], np.uint8)).all() and np.array_equal(il[..., 3], img[..., 3]))
    maxs = {f: int(ov.renderizar(c, LADO, estilo=ov.estilo(forca=f))[..., 3].max()) for f in ov.FORCAS}
    pisos = {f: int(ov.renderizar(zona, LADO, estilo=ov.estilo(forca=f))[..., 3][70:90, 70:190].min()) for f in ov.FORCAS}
    caso("escolhas: força sutil < normal < forte, no ponto mais provável e no piso da área",
         maxs["sutil"] < maxs["normal"] < maxs["forte"] and pisos["sutil"] < pisos["normal"] < pisos["forte"]
         and all(abs(maxs[f] - round(ov.FORCAS[f][0] * 255)) <= 4 for f in ov.FORCAS), f"máx {maxs}, piso {pisos}")
    mr = ov.alfa_alvo(c, LADO, lar) * np.float32(0.83)
    caso("escolhas: caminho rápido (tabela por cor) = premultiplicar(camada) também em laranja e roxo",
         all(np.array_equal(ov.bgra_rapido(mr, cor=ov.CORES[k]), ov.premultiplicar(ov.camada(mr, cor=ov.CORES[k])))
             for k in ("laranja", "roxo")))
    seca = ov.Transicao(ov.estilo(suave=False).tau)
    a1 = ov.alfa_alvo(calor_disco(LADO * 0.15), LADO)
    a2 = ov.alfa_alvo(calor_disco(LADO * 0.30), LADO)
    passos = [seca.passo(a1, 0.1), seca.passo(a1, 0.1), seca.passo(a2, 0.1)]
    caso("escolhas: sem transição o alvo vai à tela no 1º quadro (redesenha) e para no seguinte",
         np.array_equal(passos[0][0], a1) and passos[0][1] is False and passos[1][1] is True
         and np.array_equal(passos[2][0], a2) and passos[2][1] is False)
    jan = ov.OverlayMinimapa(lambda: None, atalho=False)
    caso("escolhas: a janela nasce no padrão e troca em voo (tau da transição e releitura da fonte)",
         jan.estilo == e0 and jan._trans.tau == ov.TAU_S
         and (jan.aplicar_estilo(ov.estilo("roxo", "forte", False)), jan.estilo.cor == ov.CORES["roxo"]
              and jan._trans.tau == 0 and jan._ult_busca == float("-inf"))[1])

    # custo: o quadro animado (passo da transição + BGRA pela tabela) e o alvo (a cada 400 ms)
    tr = ov.Transicao()
    alvo = ov.alfa_alvo(c, LADO)
    calores = [calor_disco(LADO * 0.2 + i * 0.3) for i in range(0, 120, 6)]
    q, b, buf = [], [], None
    for i in range(120):
        t0 = time.perf_counter()
        m, _ = tr.passo(alvo if i % 6 else alvo * np.float32(0.9), 0.066)
        buf = bgra = ov.bgra_rapido(m, buf)
        q.append((time.perf_counter() - t0) * 1000)
        if i % 6 == 0:
            t0 = time.perf_counter()
            ov.alfa_alvo(calores[i // 6], LADO)
            b.append((time.perf_counter() - t0) * 1000)
    pq, pb = float(np.median(q)), float(np.median(b))
    nucleo = (pq * 1000 / ov.QUADRO_MS + pb * 1000 / ov.BUSCA_MS) / 10   # ms por s → % de um núcleo
    caso("custo do desenho por quadro (347 px) enquanto anima, sem contar o UpdateLayeredWindow",
         nucleo < 5.0, f"quadro {pq:.2f} ms mediana (p95 {np.percentile(q, 95):.2f}), alvo {pb:.2f} ms; "
         f"~{nucleo:.1f}% de um núcleo a {1000 / ov.QUADRO_MS:.0f} quadros/s; parado: 0 (não redesenha); bgra {bgra.shape}")

    n = sum(resultados)
    print(f"\n{'ok' if n == len(resultados) else 'FALHOU'} ({n}/{len(resultados)})")
    return 0 if n == len(resultados) else 1


if __name__ == "__main__":
    sys.exit(principal())
