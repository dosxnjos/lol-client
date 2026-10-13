# prova do modo vitrine (coletor/vitrine.py): prints do overlay e da moldura numa partida de verdade.
# Nada aqui tira print da tela de verdade (fonte de print falsa) nem traz janela para a frente. Casos:
#   1. marca: ligar -> a partida consome; mesma partida (coletor reiniciado) retoma; acabou -> apaga;
#      marca de outra partida ou expirada -> apagada e nada liga
#   2. overlay: a camada gravada é o `renderizar` pixel a pixel e o composto é a mistura exata
#      (chave = print; resto = alfa 140 da janela), com o recorte cortado na borda do monitor
#   3. moldura: composto = `moldura.renderizar` (mesma rotina GDI da janela) por cima do print com
#      chat/topo pixelados; borda e rótulo nítidos mesmo sobre a região pixelada
#   4. taxa: 1 por tipo a cada 20 s, no máximo 25 (aqui 3) por partida
#   5. jogo fora do primeiro plano: nada gravado, print nem chamado; SetForegroundWindow e afins
#      armados como armadilha e proibidos no código-fonte (vitrine e os três ganchos)
#   6. 2 telas, região fora de todo monitor (avisa, sem tentar a cada quadro) e alt-tab entre a
#      conferência e o print (descarta); custo do gancho no fio de quem chama
#   7. ganchos: Moldura de verdade chama ao_mostrar com a geometria; coach_vivo liga a vitrine na
#      partida (moldura e overlay), desliga no fim, mantém no recomeço da mesma partida, e banco em
#      outra pasta não consome a marca. Marca: ligar no meio de uma partida recusa; id None adotado
# uso: python tools/teste-vitrine.py
import ctypes
import json
import logging
import shutil
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import moldura  # noqa: E402
import overlay_minimapa  # noqa: E402
import vitrine  # noqa: E402

logging.getLogger("coletor.vitrine").addHandler(logging.NullHandler())
logging.getLogger("coletor.vitrine").propagate = False
resultados = []
PROIBIDAS = ("SetForegroundWindow", "AttachThreadInput", "BringWindowToTop", "SwitchToThisWindow",
             "SetActiveWindow", "keybd_event", "SendInput", "mouse_event", "AllowSetForegroundWindow")


def caso(nome, ok, detalhe=""):
    resultados.append(bool(ok))
    print(f"{'ok' if ok else 'FALHOU'}  {nome}" + (f"  ({detalhe})" if detalhe else ""))


class TelaFalsa:
    """monitor 2560×1080 em (0, 0) com ruído; capturar(reg) recorta e conta as chamadas"""

    def __init__(self, w=2560, h=1080, semente=7):
        self.img = np.random.default_rng(semente).integers(0, 256, (h, w, 3), dtype=np.uint8)
        self.mon = {"left": 0, "top": 0, "width": w, "height": h}
        self.chamadas = []

    def capturar(self, reg):
        self.chamadas.append(dict(reg))
        L, T = reg["left"] - self.mon["left"], reg["top"] - self.mon["top"]
        return self.img[T:T + reg["height"], L:L + reg["width"]].copy()


def esperar(v, n, s=5.0):
    fim = time.monotonic() + s
    while time.monotonic() < fim and (v.n < n or v._pendente):
        time.sleep(0.02)
    time.sleep(0.05)


def png(caminho):
    from PIL import Image
    return np.asarray(Image.open(caminho))


def linhas(pasta):
    return [json.loads(x) for p in sorted(Path(pasta).glob("*/vitrine.jsonl"))
            for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]


def imprimir_janela(hwnd, w, h):
    """RGB do que a janela pinta no próprio WM_PAINT (PrintWindow num bitmap; nada de tela); None se falhar"""
    import ctypes.wintypes as wt
    u, g = moldura.user32, moldura.gdi32
    g.CreateCompatibleDC.argtypes = [wt.HDC]
    g.CreateCompatibleDC.restype = wt.HDC
    g.CreateDIBSection.argtypes = [wt.HDC, ctypes.c_void_p, wt.UINT, ctypes.POINTER(ctypes.c_void_p), wt.HANDLE, wt.DWORD]
    g.CreateDIBSection.restype = wt.HBITMAP
    g.DeleteDC.argtypes = [wt.HDC]
    u.GetDC.restype = wt.HDC
    u.ReleaseDC.argtypes = [wt.HWND, wt.HDC]
    u.PrintWindow.argtypes = [wt.HWND, wt.HDC, wt.UINT]
    tela = u.GetDC(None)
    mem = g.CreateCompatibleDC(tela)
    bih = moldura._BITMAPINFOHEADER(biSize=ctypes.sizeof(moldura._BITMAPINFOHEADER), biWidth=w, biHeight=-h,
                                    biPlanes=1, biBitCount=32)
    bits = ctypes.c_void_p()
    dib = g.CreateDIBSection(mem, ctypes.byref(bih), 0, ctypes.byref(bits), None, 0)
    try:
        antigo = g.SelectObject(mem, dib)
        ok = u.PrintWindow(hwnd, mem, 0)
        g.GdiFlush()
        img = np.frombuffer((ctypes.c_ubyte * (w * h * 4)).from_address(bits.value), np.uint8) \
            .reshape(h, w, 4)[:, :, 2::-1].copy()
        g.SelectObject(mem, antigo)
        return img if ok else None
    finally:
        g.DeleteObject(dib)
        g.DeleteDC(mem)
        u.ReleaseDC(None, tela)


def calor_sintetico(lado):
    yy, xx = np.mgrid[0:lado, 0:lado]
    return np.clip(1 - np.hypot(xx - lado * 0.3, yy - lado * 0.35) / (lado * 0.25), 0, 1)


def caso_marca(tmp):
    marca = tmp / "dados" / "vitrine.json"
    t0 = 1_000_000.0
    vitrine.ligar(marca, agora=t0)
    e = vitrine.estado(marca, agora=t0 + 60)
    v = vitrine.da_partida(marca, 111, lambda: 0, agora=t0 + 120, pasta=tmp / "saida", primeiro_plano=lambda: False)
    m = vitrine.ler(marca)
    v2 = vitrine.da_partida(marca, 111, lambda: 0, agora=t0 + 200, pasta=tmp / "saida", primeiro_plano=lambda: False)
    v.parar(apagar_marca=False)
    v2.parar()
    depois = marca.exists()
    nada = vitrine.da_partida(marca, 222, lambda: 0, agora=t0 + 300)
    caso("marca: ligar -> partida consome, mesma partida retoma, fim apaga, partida seguinte não liga",
         e["ligada"] and v is not None and m["consumida_por"]["game_id"] == 111 and v2 is not None
         and not depois and nada is None and vitrine.estado(marca)["ligada"] is False,
         e["motivo"])
    vitrine.ligar(marca, agora=t0)
    exp = vitrine.da_partida(marca, 333, lambda: 0, agora=t0 + 3 * 3600 + 1)
    caso("marca expirada (3 h sem partida): não liga e é apagada", exp is None and not marca.exists())
    vitrine.ligar(marca, agora=t0)
    vitrine.da_partida(marca, 444, lambda: 0, agora=t0 + 10, primeiro_plano=lambda: False).parar(apagar_marca=False)
    sobra = vitrine.da_partida(marca, 555, lambda: 0, agora=t0 + 20)
    caso("marca consumida por outra partida (coletor caiu): não liga e é apagada", sobra is None and not marca.exists())
    # GET da sessão falhou no InProgress (game_id None): a partida com o id real adota a marca
    vitrine.ligar(marca, agora=t0)
    a = vitrine.da_partida(marca, None, lambda: 0, agora=t0 + 10, primeiro_plano=lambda: False)
    a.parar(apagar_marca=False)
    b = vitrine.da_partida(marca, 777, lambda: 0, agora=t0 + 20, primeiro_plano=lambda: False)
    adotada = (vitrine.ler(marca) or {}).get("consumida_por", {}).get("game_id")
    c = vitrine.da_partida(marca, None, lambda: 0, agora=t0 + 30, primeiro_plano=lambda: False)
    c_gid = c.game_id if c else None
    c.parar(apagar_marca=False)
    b.parar()
    caso("consumida sem game_id: a partida com id adota (grava o id), id que some de novo retoma a mesma",
         b is not None and adotada == 777 and c_gid == 777 and not marca.exists(), f"adotada {adotada}, {c_gid}")
    # sem id há mais de 2 h: sobra de queda, apagada
    vitrine.ligar(marca, agora=t0)
    vitrine.da_partida(marca, None, lambda: 0, agora=t0 + 10, primeiro_plano=lambda: False).parar(apagar_marca=False)
    velha = vitrine.da_partida(marca, 888, lambda: 0, agora=t0 + 10 + vitrine.EM_USO_H * 3600 + 1)
    caso("consumida sem game_id há mais de 2 h: sobra, apagada", velha is None and not marca.exists())
    # ligar com uma partida gravando: recusa; e o fim dela não apaga uma marca nova (gravada por fora)
    agora = time.time()
    vitrine.ligar(marca, agora=agora)
    em = vitrine.da_partida(marca, 999, lambda: 0, agora=agora, primeiro_plano=lambda: False)
    recusou = vitrine.ligar(marca) is None and vitrine.ler(marca)["consumida_por"]["game_id"] == 999
    vitrine._gravar(marca, {"ligada_em": agora, "expira_em": agora + 3600, "consumida_por": None, "gravados": 0})
    em.n = 2
    em._contar()
    em.parar()
    nova = vitrine.ler(marca) or {}
    caso("ligar no meio de uma partida com vitrine: recusa; o fim dela não apaga nem conta numa marca nova",
         recusou and nova.get("consumida_por") is None and nova.get("gravados") == 0,
         f"recusou {recusou}, marca nova {nova}")
    vitrine.desligar(marca)
    vitrine.ligar(marca, agora=agora)
    vitrine._gravar(marca, {**vitrine.ler(marca), "consumida_por": {"game_id": 1, "em": agora - 3 * 3600}})
    caso("ligar com marca consumida há mais de 2 h (sobra de queda): liga", vitrine.ligar(marca) is not None)
    vitrine.desligar(marca)


def caso_overlay(tmp):
    tela = TelaFalsa()
    saida = tmp / "overlay"
    v = vitrine.Vitrine(lambda: 754.3, game_id=1, pasta=saida, primeiro_plano=lambda: True,
                        capturar=tela.capturar, monitor=lambda: tela.mon)
    L, T, lado = 2197, 716, 347   # posição real do minimapa: o recorte com margem passa da borda do monitor
    img = overlay_minimapa.renderizar(calor_sintetico(lado), lado, "jungler sumido há 12 s")
    v.overlay(img, (L, T, lado), {"calor": 1, "texto": "jungler sumido há 12 s"})
    esperar(v, 1)
    v.parar()
    ln = linhas(saida)
    ok = len(ln) == 1 and len(tela.chamadas) == 1
    if ok:
        d = next(saida.iterdir())
        comp, camada = png(d / ln[0]["arquivos"][0]), png(d / ln[0]["arquivos"][1])
        x, y, w, h = ln[0]["recorte"]
        fundo = tela.img[y:y + h, x:x + w].astype(int)
        ox, oy = L - x, T - y
        chave = np.all(img == np.array(overlay_minimapa.CHAVE), axis=2)
        dentro = comp[oy:oy + lado, ox:ox + lado].astype(int)
        f_dentro = fundo[oy:oy + lado, ox:ox + lado]
        a = int(overlay_minimapa.ALPHA * 255)
        esperado = (img.astype(int) * a + f_dentro * (255 - a) + 127) // 255
        camada_ok = np.array_equal(camada[:, :, :3][~chave], img[~chave]) and \
            (camada[:, :, 3][chave] == 0).all() and (camada[:, :, 3][~chave] == 255).all()
        chave_ok = np.array_equal(dentro[chave], f_dentro[chave])
        mist_ok = np.array_equal(dentro[~chave], esperado[~chave])
        margem_ok = np.array_equal(comp[:oy].astype(int), fundo[:oy]) and np.array_equal(comp[:, :ox].astype(int), fundo[:, :ox])
        corte_ok = (x, y) == (L - vitrine.MARGEM, T - vitrine.MARGEM) and x + w == 2560 and y + h == 1080
        ok = camada_ok and chave_ok and mist_ok and margem_ok and corte_ok and ln[0]["gameTime"] == 754.3 \
            and ln[0]["revisao_privacidade"] == "pendente" and (d / "LEIA-ME-privacidade.txt").exists()
        det = (f"camada {camada_ok}, chave = print {chave_ok}, mistura alfa {a} {mist_ok}, margem {margem_ok}, "
               f"recorte {x},{y},{w}x{h} {corte_ok}, {(~chave).sum()} px desenhados")
    else:
        det = f"{len(ln)} linhas, {len(tela.chamadas)} prints"
    caso("overlay: camada = renderizar pixel a pixel; composto = mistura exata sobre o print", ok, det)


def caso_moldura(tmp):
    W, H = 1280, 540
    tela = TelaFalsa(W, H, semente=3)
    saida = tmp / "moldura"
    v = vitrine.Vitrine(lambda: 900.0, game_id=2, pasta=saida, primeiro_plano=lambda: True,
                        capturar=tela.capturar, monitor=lambda: tela.mon)
    v.tipo_aviso = lambda rot: "gank" if rot == "gank no top" else None
    v.moldura("vermelho", "gank no top", (0, 0, W, H), 12)
    esperar(v, 1)
    v.parar()
    ln = linhas(saida)
    camada = moldura.renderizar(W, H, "vermelho", "gank no top", 12)
    vermelho = np.array(moldura.CORES["vermelho"])
    desenho = ~np.all(camada == (255, 0, 255), axis=2)
    texto = desenho & np.all(camada > 200, axis=2)     # px brancos do rótulo (DrawTextW)
    ok = len(ln) == 1 and ln[0]["aviso"] == "gank" and ln[0]["rotulo"] == "gank no top"
    det = f"{len(ln)} linhas"
    if ok:
        comp = png(next(saida.iterdir()) / ln[0]["arquivos"][0]).astype(int)
        px_ok = np.array_equal(comp[desenho], camada[desenho].astype(int))
        borda_ok = (comp[2, W // 2] == vermelho).all() and (comp[H - 3, 5] == vermelho).all()  # sobre topo/chat pixelados
        meio_ok = np.array_equal(comp[H // 2, W // 3], tela.img[H // 2, W // 3].astype(int))   # fora das regiões: intacto
        cx, cy = int(0.62 * W), int(0.83 * H)          # chat medido, sem moldura por cima: pixelado
        pix_ok = not np.array_equal(comp[cy - 20:cy + 20, cx - 20:cx + 20], tela.img[cy - 20:cy + 20, cx - 20:cx + 20])
        ok = px_ok and borda_ok and meio_ok and pix_ok and texto.sum() > 50 and (camada[40, 40] == vermelho).all()
        det = f"px da moldura idênticos {px_ok}, borda sobre região pixelada {borda_ok}, fora intacto {meio_ok}, " \
              f"chat pixelado {pix_ok}, {int(texto.sum())} px de texto"
    caso("moldura: composto = moldura.renderizar (GDI da janela) sobre o print com chat e topo pixelados", ok, det)
    # reduzida para 1280 de largura quando a tela é maior
    tela2 = TelaFalsa(2560, 1080, semente=4)
    v2 = vitrine.Vitrine(lambda: 1.0, pasta=tmp / "moldura2", primeiro_plano=lambda: True,
                         capturar=tela2.capturar, monitor=lambda: tela2.mon)
    v2.moldura("azul", "dragão em 60s", (0, 0, 2560, 1080), 12)
    esperar(v2, 1)
    v2.parar()
    ln2 = linhas(tmp / "moldura2")
    forma = png(next((tmp / "moldura2").iterdir()) / ln2[0]["arquivos"][0]).shape if ln2 else None
    caso("tela inteira 2560×1080 sai reduzida para 1280×540", forma == (540, 1280, 3), str(forma))


def caso_taxa(tmp):
    tela = TelaFalsa(800, 600)
    relogio = {"t": 0.0}
    v = vitrine.Vitrine(lambda: relogio["t"], pasta=tmp / "taxa", primeiro_plano=lambda: True,
                        capturar=tela.capturar, monitor=lambda: tela.mon, agora=lambda: relogio["t"])
    img = overlay_minimapa.renderizar(calor_sintetico(100), 100)
    q = {"calor": 1}
    for _ in range(10):                     # o overlay chama a cada 0,4 s
        v.overlay(img, (300, 200, 100), q)
        esperar(v, 1, 0.3)
    n0 = v.n
    relogio["t"] = 19.0
    v.overlay(img, (300, 200, 100), q)
    esperar(v, 2, 0.5)
    n19 = v.n
    relogio["t"] = 21.0
    v.overlay(img, (300, 200, 100), q)
    v.moldura("verde", "baron em 60s", (0, 0, 800, 600), 12)   # outro tipo: taxa própria
    esperar(v, 3)
    n21 = v.n
    v.parar()
    caso("taxa: 10 quadros no mesmo instante = 1 print; 19 s depois nada; 21 s depois mais 1; outro tipo à parte",
         (n0, n19, n21) == (1, 1, 3), f"{n0}, {n19}, {n21}")
    tela2 = TelaFalsa(400, 300)
    v2 = vitrine.Vitrine(lambda: 0, pasta=tmp / "teto", primeiro_plano=lambda: True, capturar=tela2.capturar,
                         monitor=lambda: tela2.mon, intervalo_s=0, maximo=3)
    for i in range(8):
        v2.overlay(img, (10, 10, 100), q)
        esperar(v2, min(i + 1, 3), 0.5)
    v2.parar()
    caso("teto por partida: com intervalo 0 e máximo 3, só 3 prints", v2.n == 3 and len(linhas(tmp / "teto")) == 3,
         f"{v2.n}")


def caso_fora_do_plano(tmp):
    u = ctypes.windll.user32
    chamadas = []

    def armadilha(nome):
        def f(*a):
            chamadas.append(nome)
            raise AssertionError(f"{nome} chamado pela vitrine")
        return f
    antigas = {n: getattr(u, n, None) for n in PROIBIDAS[:6]}
    for n in antigas:
        setattr(u, n, armadilha(n))

    def print_proibido(reg):
        chamadas.append("print")
        raise AssertionError("print com o jogo fora do primeiro plano")
    try:
        # primeiro plano de verdade (minimapa.janela_do_jogo_em_primeiro_plano): com o jogo fechado,
        # quem está na frente é este terminal -> False; e uma falsa sempre False
        for nome, pp in (("de verdade", vitrine._primeiro_plano), ("falsa", lambda: False)):
            chamadas.clear()
            if nome == "de verdade" and pp():   # o jogo está mesmo na frente: este sub-caso não se aplica
                print("pulado  primeiro plano de verdade: o jogo está na frente agora (rodar com o jogo fechado)")
                continue
            pasta = tmp / f"fora-{nome}"
            v = vitrine.Vitrine(lambda: 1.0, pasta=pasta, primeiro_plano=pp, capturar=print_proibido,
                                monitor=lambda: {"left": 0, "top": 0, "width": 800, "height": 600})
            v.overlay(overlay_minimapa.renderizar(calor_sintetico(100), 100), (10, 10, 100), {"calor": 1})
            v.moldura("vermelho", "gank no top", (0, 0, 800, 600), 12)
            time.sleep(0.4)
            v.parar()
            caso(f"jogo fora do primeiro plano (função {nome}): nada gravado, nenhum print, nada de foco",
                 v.n == 0 and v.descartados == 2 and not chamadas and not pasta.exists(),
                 f"descartados {v.descartados}, chamadas {chamadas}")
    finally:
        for n, f in antigas.items():
            if f is not None:
                setattr(u, n, f)
    achados = []
    for arq in ("coletor/vitrine.py", "tools/vitrine.py", "coletor/overlay_minimapa.py", "coletor/moldura.py",
                "coletor/coach_vivo.py"):
        texto = (RAIZ / arq).read_text(encoding="utf-8")
        achados += [f"{arq}: {p}" for p in PROIBIDAS if p in texto]
    caso("nenhuma chamada que mexe no foco ou manda tecla no código da vitrine e dos ganchos",
         not achados, "; ".join(achados) or f"{len(PROIBIDAS)} nomes procurados em 5 arquivos")


def caso_recorte_e_alt_tab(tmp):
    # 2 telas: o overlay está na 2ª (à esquerda da principal); a lista de monitores acha a certa
    img = overlay_minimapa.renderizar(calor_sintetico(100), 100)
    principal = {"left": 0, "top": 0, "width": 1920, "height": 1080}
    esquerda = {"left": -2560, "top": 0, "width": 2560, "height": 1080}
    tela = TelaFalsa(2560, 1080)
    tela.mon = esquerda
    v = vitrine.Vitrine(lambda: 1.0, pasta=tmp / "duas", primeiro_plano=lambda: True, capturar=tela.capturar,
                        monitor=lambda: [principal, esquerda])
    v.overlay(img, (-400, 700, 100), {"calor": 1})
    esperar(v, 1)
    v.parar()
    reg = tela.chamadas[0] if tela.chamadas else {}
    caso("2 telas: o recorte sai da tela onde o overlay está (sem vazar para a outra)",
         v.n == 1 and reg.get("left") == -440 and reg.get("left", 0) + reg.get("width", 0) <= 0, str(reg))
    # região fora de todo monitor: avisa, não grava e espera o intervalo do tipo (sem tentar a cada 0,4 s)
    chamadas = {"monitor": 0}

    def mon():
        chamadas["monitor"] += 1
        return [principal]
    relogio = {"t": 0.0}
    v = vitrine.Vitrine(lambda: 1.0, pasta=tmp / "fora-mon", primeiro_plano=lambda: True, capturar=tela.capturar,
                        monitor=mon, agora=lambda: relogio["t"])
    n0 = len(tela.chamadas)
    for i in range(10):                     # o overlay chama a cada 0,4 s, sempre fora
        relogio["t"] = i * 0.4
        v.overlay(img, (5000, 5000, 100), {"calor": 1})
        esperar(v, 1, 0.2)
    v.parar()
    caso("região fora de todo monitor: nada gravado, contada e avisada, 1 tentativa por intervalo",
         v.n == 0 and v.sem_recorte == 1 and chamadas["monitor"] == 1 and len(tela.chamadas) == n0
         and not (tmp / "fora-mon").exists(), f"sem_recorte {v.sem_recorte}, monitor() {chamadas['monitor']}x")
    # alt-tab entre a conferência e o print: descartado (o print pode ter Discord/WhatsApp)
    for tipo in ("overlay", "moldura"):
        respostas = iter([True, False])
        tela2 = TelaFalsa(800, 600)
        pasta = tmp / f"alt-tab-{tipo}"
        v = vitrine.Vitrine(lambda: 1.0, pasta=pasta, primeiro_plano=lambda: next(respostas, False),
                            capturar=tela2.capturar, monitor=lambda: tela2.mon)
        if tipo == "overlay":
            v.overlay(img, (10, 10, 100), {"calor": 1})
        else:
            v.moldura("vermelho", "gank no top", (0, 0, 800, 600), 12)
        time.sleep(0.4)
        v.parar()
        caso(f"alt-tab durante o print ({tipo}): primeiro plano conferido de novo depois do grab, nada gravado",
             v.n == 0 and v.descartados == 1 and len(tela2.chamadas) == 1 and not pasta.exists(),
             f"descartados {v.descartados}, prints {len(tela2.chamadas)}")


def caso_custo(tmp):
    """o que roda no fio de quem chama (Tk do overlay, fio da moldura) é só o gancho: medido aqui com a tela
    inteira 2560×1080. A thread da vitrine divide o GIL com o coach: um laço de 50 ms em paralelo mede o atraso
    enquanto ela grava (aproximação do tick; o ensaio não liga a vitrine: banco em temp\\ e jogo fechado)."""
    tela = TelaFalsa(2560, 1080, semente=5)
    v = vitrine.Vitrine(lambda: 1.0, pasta=tmp / "custo", primeiro_plano=lambda: True, capturar=tela.capturar,
                        monitor=lambda: tela.mon, intervalo_s=0)
    img = overlay_minimapa.renderizar(calor_sintetico(347), 347, "jungler sumido")
    ganchos, atrasos = [], []
    t_fim = time.perf_counter() + 4.0
    prox = time.perf_counter()
    feitos = 0
    while time.perf_counter() < t_fim and feitos < 6:
        if not v._pendente and feitos < 6:
            t0 = time.perf_counter()
            if feitos % 2:
                v.overlay(img, (2197, 716, 347), {"calor": 1})
            else:
                v.moldura("vermelho", "gank no top", (0, 0, 2560, 1080), 12)
            ganchos.append((time.perf_counter() - t0) * 1000)
            feitos += 1
        prox += 0.05
        time.sleep(max(0.0, prox - time.perf_counter()))
        atrasos.append((time.perf_counter() - prox) * 1000)
    esperar(v, feitos)
    v.parar()
    pior = max(ganchos)
    caso("custo: o gancho (fio do overlay/moldura) leva < 2 ms com a tela inteira; laço de 50 ms em paralelo",
         pior < 2.0 and v.n == feitos and max(atrasos) < 100,
         f"gancho pior {pior:.2f} ms; {v.n} prints; atraso do laço paralelo: mediana "
         f"{sorted(atrasos)[len(atrasos) // 2]:.1f} ms, pior {max(atrasos):.1f} ms")


def caso_ganchos(tmp):
    # Moldura de verdade (janela Win32 NOACTIVATE, como no teste-alertas), posta FORA da área visível
    # (-4000, -4000): o gancho recebe o que foi mostrado e nada pisca na tela de quem estiver usando o PC
    vistos = []
    geo = (-4000, -4000, 600, 260)
    m = moldura.Moldura(forcar=True, retangulo=geo).iniciar()
    m.ao_mostrar = lambda *a: vistos.append(a)
    m.mostrar("amarelo", "intruso na selva azul")
    time.sleep(0.3)
    janela = imprimir_janela(m.hwnd, geo[2], geo[3])   # o que o WM_PAINT da janela pintou (PrintWindow)
    m.parar()
    caso("Moldura chama ao_mostrar(cor, rótulo de até 3 palavras, geometria, espessura)",
         vistos == [("amarelo", "intruso na selva", geo, 12)], str(vistos))
    ref = moldura.renderizar(geo[2], geo[3], "amarelo", "intruso na selva", 12)
    caso("janela da moldura (PrintWindow) = moldura.renderizar pixel a pixel (a camada da vitrine é a da tela)",
         janela is not None and np.array_equal(janela, ref),
         "sem PrintWindow" if janela is None else f"{int(np.any(janela != ref, axis=2).sum())} px diferentes")

    import coach_vivo
    log_coach = logging.getLogger("coletor.coach")
    log_coach.propagate = False
    log_coach.addHandler(logging.NullHandler())

    class Peca:
        ligado = True
        ao_mostrar = ao_desenhar = ao_alternar = _thread = None

        def __init__(self, *a, **k):
            pass

        def __getattr__(self, nome):   # falar, parar, desligar, mostrar, iniciar...
            return lambda *a, **k: None

    class Janela:
        def fase(self, f):
            pass

        def fechar(self):
            pass

    def sem(*a):
        raise RuntimeError("fora do teste")
    pasta = tmp / "coach"
    pasta.mkdir()
    (pasta / "config.json").write_text(json.dumps({"voz": False, "minimapa": False, "feiticos": False,
                                                   "carregamento": False, "mentor": False, "amostrasAoVivo": False,
                                                   "painelAoVivo": False}), encoding="utf-8")
    marca = pasta / vitrine.MARCA_NOME
    vitrine.ligar(marca)
    fab = {"voz": Peca, "moldura": Peca, "overlay": Peca, "estatico": sem, "mentor": sem,
           "janela": lambda url, ligado: Janela()}
    c = coach_vivo.Coach(db=pasta / "lol.db", config=pasta / "config.json", liveclient="http://127.0.0.1:9",
                         fabricas=fab)
    p = c.iniciar_partida(9001, 400)
    vt = p.vitrine
    consumida = (vitrine.ler(marca) or {}).get("consumida_por") or {}
    p.cap = Peca()                       # minimapa desligado no teste: o overlay nasce à mão
    p._ligar_overlay()
    ligados = vt is not None and p.moldura.ao_mostrar == vt.moldura and p.ov is not None \
        and p.ov.ao_desenhar == vt.overlay and vt.tipo_aviso is not None
    c.encerrar_partida()
    apagada = not marca.exists()
    p2 = c.iniciar_partida(9002, 400)
    sem_vitrine = p2.vitrine is None and p2.moldura.ao_mostrar is None
    c.encerrar_partida()
    caso("coach_vivo: marca na pasta do banco liga a vitrine na partida (moldura e overlay) e o fim apaga",
         ligados and consumida.get("game_id") == 9001 and apagada and sem_vitrine and vt._parar.is_set(),
         f"ligados {ligados}, consumida {consumida.get('game_id')}, apagada {apagada}, 2ª partida sem {sem_vitrine}")
    # recomeço da mesma partida no processo (GET da sessão falhou -> None; Reconnect com o id real; de novo
    # o mesmo id): a vitrine segue; outra partida com id diferente encerra; o fim apaga
    vitrine.ligar(marca)
    q1 = c.iniciar_partida(None, 400)
    q2 = c.iniciar_partida(9101, 400)
    gid_marca = ((vitrine.ler(marca) or {}).get("consumida_por") or {}).get("game_id")
    c.av.ativo = lambda: False             # thread do AoVivo morreu: o mesmo id recomeça a partida
    q3 = c.iniciar_partida(9101, 400)
    del c.av.ativo
    segue = q1.vitrine is not None and q2.vitrine is not None and q3 is not q2 and q3.vitrine is not None \
        and marca.exists()
    q4 = c.iniciar_partida(9102, 400)      # outra partida sem EndOfGame no meio: a 1ª acabou
    outra = q4.vitrine is None and not marca.exists()
    c.encerrar_partida()
    caso("coach_vivo: mesma partida recomeçada no processo (id None -> real, AoVivo morto) mantém a vitrine; "
         "outro id encerra e apaga",
         segue and gid_marca == 9101 and outra, f"segue {segue}, id na marca {gid_marca}, outra partida {outra}")
    log_coach.propagate = True
    marca_real = RAIZ / "dados" / vitrine.MARCA_NOME
    caso("a marca do coletor real (dados/vitrine.json) fica fora do alcance do teste (banco em outra pasta)",
         marca != marca_real and Path(c.db).parent != marca_real.parent)


def principal():
    tmp = Path(tempfile.mkdtemp(prefix="teste-vitrine-"))
    try:
        caso_marca(tmp)
        caso_overlay(tmp)
        caso_moldura(tmp)
        caso_taxa(tmp)
        caso_fora_do_plano(tmp)
        caso_recorte_e_alt_tab(tmp)
        caso_custo(tmp)
        caso_ganchos(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"{sum(resultados)}/{len(resultados)} ok")
    return 0 if all(resultados) else 1


if __name__ == "__main__":
    sys.exit(principal())
