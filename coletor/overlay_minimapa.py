# overlay do minimapa (plano v2, passo 15b): janela própria, transparente, sempre no topo e que
# IGNORA clique (WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW), posta em cima
# do retângulo do minimapa achado pelo passo 13. Não toca no processo do jogo, não manda tecla nem
# clique: é uma janela do Windows por cima de outra (só funciona com o jogo sem borda, WindowMode=2).
# Mostra o mapa de calor de onde o jungler pode estar; some ~30 s depois da última pista e troca por
# "sumido há X s" por 10 s, depois some de vez até a próxima pista. F8 liga/desliga (RegisterHotKey: só escuta o atalho).
#   python coletor/overlay_minimapa.py --demo [--left 2197 --top 716 --lado 347]   prova sem partida
import ctypes
import ctypes.wintypes as wt
import logging
import threading
import time

import cv2
import numpy as np

log = logging.getLogger("coletor")

CHAVE = (1, 0, 1)                  # cor que vira transparente (RGB)
ALPHA = 0.55
GWL_EXSTYLE = -20
WS_EX_LAYERED, WS_EX_TRANSPARENT = 0x00080000, 0x00000020
WS_EX_TOPMOST, WS_EX_TOOLWINDOW, WS_EX_NOACTIVATE = 0x00000008, 0x00000080, 0x08000000
ESTILO = WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
VK_F8, WM_HOTKEY, ID_ATALHO = 0x77, 0x0312, 0x4C43
MOD_NOREPEAT = 0x4000              # segurar o F8 = 1 alternância (sem ele o autorrepeat piscava o overlay)
WDA_EXCLUIR = 0x11                 # WDA_EXCLUDEFROMCAPTURE


def renderizar(calor, lado, texto=None):
    """imagem RGB lado×lado: calor (0–1) em amarelo→vermelho, resto = CHAVE (transparente).
    texto vai numa faixa no topo ("sumido há 42 s")."""
    img = np.zeros((lado, lado, 3), np.uint8)
    img[:] = CHAVE
    if calor is not None:
        c = cv2.resize(calor.astype(np.float32), (lado, lado), interpolation=cv2.INTER_NEAREST) \
            if calor.shape[0] != lado else calor.astype(np.float32)
        m = c >= 0.05
        # amarelo (pouca chance) -> vermelho (mais provável); verde vira 0 no topo
        img[m, 0] = 255
        img[m, 1] = np.clip(220 * (1 - c[m]), 0, 220).astype(np.uint8)
        img[m, 2] = 0
        # contorno da área para ler de relance
        borda = cv2.morphologyEx(m.astype(np.uint8), cv2.MORPH_GRADIENT, np.ones((3, 3), np.uint8)) > 0
        img[borda] = (255, 255, 255)
    if texto:
        # caixa do tamanho do texto, não uma faixa na largura toda (cobria o topo do mapa)
        (w, h), base = cv2.getTextSize(texto, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
        cv2.rectangle(img, (0, 0), (min(lado - 1, w + 8), h + base + 6), (20, 20, 20), -1)
        cv2.putText(img, texto, (4, h + 3), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
    return img


def _dpi_fisico():
    """janela em px físicos (o mss e o retângulo do minimapa são físicos; escala de 125% aqui)"""
    try:
        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except Exception:
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            pass


class OverlayMinimapa:
    """fonte() -> {"ret": (left, top, lado) em px físicos da tela, "calor": float lado×lado ou None,
    "texto": str|None, "mostrar": bool (jogo em primeiro plano)}. Roda numa thread com o próprio Tk."""

    def __init__(self, fonte, intervalo_ms=400, atalho=True, excluir_do_print=True):
        self.fonte = fonte
        self.intervalo = intervalo_ms
        self.ligado = True
        self.atalho = atalho
        self.ao_alternar = None   # callback(ligado) do F8: retorno ao jogador ("overlay ligado" na moldura)
        # o overlay fica EM CIMA do minimapa que o passo 13 captura: sem isto o print veria o próprio
        # mapa de calor (fog e ícones errados). WDA_EXCLUDEFROMCAPTURE: some do print, segue na tela.
        self.excluir = excluir_do_print
        self.excluida = None
        self.hwnd = None
        self._root = None
        self._thread = None
        self._parar = threading.Event()
        self._pronto = threading.Event()

    def iniciar(self):
        if self._thread and self._thread.is_alive():
            return
        self._parar.clear()
        self._thread = threading.Thread(target=self._laco, name="overlay-minimapa", daemon=True)
        self._thread.start()
        if self.atalho:
            threading.Thread(target=self._escutar_atalho, name="overlay-f8", daemon=True).start()
        if not self._pronto.wait(5):   # Tk morto na thread não deixava rastro no log
            log.warning("overlay: janela do Tk não nasceu em 5 s")

    def parar(self):
        self._parar.set()

    def alternar(self):
        self.ligado = not self.ligado
        log.info("overlay do minimapa %s (F8)", "ligado" if self.ligado else "desligado")
        if self.ao_alternar is not None:
            try:
                self.ao_alternar(self.ligado)
            except Exception as e:
                log.warning("overlay: retorno do F8 falhou: %s: %s", type(e).__name__, e)

    def _laco(self):
        try:
            self._laco_tk()
        except Exception as e:   # exceção na thread do Tk ia para o stderr (nenhum, na tarefa agendada)
            log.warning("overlay: janela morreu: %s: %s", type(e).__name__, e)
            self._pronto.set()

    def _laco_tk(self):
        import tkinter as tk
        from PIL import Image, ImageTk
        _dpi_fisico()
        root = tk.Tk()
        self._root = root
        root.overrideredirect(True)
        root.attributes("-topmost", True)
        root.attributes("-alpha", ALPHA)
        root.attributes("-transparentcolor", "#%02x%02x%02x" % CHAVE)
        root.configure(bg="#%02x%02x%02x" % CHAVE)
        rot = tk.Label(root, bd=0, bg="#%02x%02x%02x" % CHAVE)
        rot.pack()
        root.withdraw()
        root.update_idletasks()
        self._filhos = (root.winfo_id(), rot.winfo_id())
        self.hwnd = ctypes.windll.user32.GetParent(root.winfo_id()) or root.winfo_id()
        u = ctypes.windll.user32
        u.SetWindowLongW(self.hwnd, GWL_EXSTYLE, u.GetWindowLongW(self.hwnd, GWL_EXSTYLE) | ESTILO)
        self.fora_do_print(self.excluir)
        self._pronto.set()
        estado = {"geo": None, "img": None}

        def passo():
            if self._parar.is_set():
                root.destroy()
                return
            try:
                f = self.fonte() or {}
                ret = f.get("ret")
                if not (self.ligado and f.get("mostrar") and ret and (f.get("calor") is not None or f.get("texto"))):
                    root.withdraw()
                else:
                    left, top, lado = ret
                    geo = f"{lado}x{lado}+{left}+{top}"
                    if geo != estado["geo"]:
                        root.geometry(geo)
                        estado["geo"] = geo
                    foto = ImageTk.PhotoImage(Image.fromarray(renderizar(f.get("calor"), lado, f.get("texto"))))
                    rot.configure(image=foto)
                    estado["img"] = foto
                    root.deiconify()
                    root.attributes("-topmost", True)
            except Exception as e:
                log.warning("overlay: %s", e)
            root.after(self.intervalo, passo)

        root.after(0, passo)
        root.mainloop()
        # objetos do Tk morrem nesta thread (senão o Tcl reclama "async handler deleted by the wrong thread")
        estado.clear()
        self._root = None
        rot = root = None  # noqa: F841 (solta as referências nesta thread)
        import gc
        gc.collect()

    def _escutar_atalho(self):
        # WinDLL próprio com use_last_error: o GetLastError depois de uma chamada do ctypes não é confiável
        u = ctypes.WinDLL("user32", use_last_error=True)
        if not u.RegisterHotKey(None, ID_ATALHO, MOD_NOREPEAT, VK_F8):
            log.warning("overlay: RegisterHotKey do F8 falhou (erro %d; 1409 = outro programa já tem o F8)",
                        ctypes.get_last_error())
            return
        log.info("overlay: F8 registrado (RegisterHotKey, thread %d)", threading.get_native_id())
        msg = wt.MSG()
        try:
            while not self._parar.is_set():
                if u.PeekMessageW(ctypes.byref(msg), None, WM_HOTKEY, WM_HOTKEY, 1):
                    if msg.message == WM_HOTKEY and msg.wParam == ID_ATALHO:
                        self.alternar()   # loga "overlay do minimapa ligado/desligado (F8)"
                time.sleep(0.05)
        except Exception as e:
            log.warning("overlay: escuta do F8 morreu: %s: %s", type(e).__name__, e)
        finally:
            u.UnregisterHotKey(None, ID_ATALHO)
            log.info("overlay: F8 solto")

    def fora_do_print(self, sim=True):
        """liga/desliga WDA_EXCLUDEFROMCAPTURE (Windows 10 2004+); True se o Windows aceitou"""
        if self.hwnd:
            self.excluida = bool(ctypes.windll.user32.SetWindowDisplayAffinity(self.hwnd, WDA_EXCLUIR if sim else 0)) \
                and sim
        return self.excluida

    def conferir(self):
        """(estilos ok, retângulo da janela em px físicos, clique atravessa) para a prova; o clique
        atravessa quando WindowFromPoint no meio da janela devolve OUTRA janela (a de baixo)"""
        u = ctypes.windll.user32
        u.WindowFromPoint.argtypes = [wt.POINT]
        u.WindowFromPoint.restype = wt.HWND
        ex = u.GetWindowLongW(self.hwnd, GWL_EXSTYLE)
        r = wt.RECT()
        u.GetWindowRect(self.hwnd, ctypes.byref(r))
        meio = u.WindowFromPoint(wt.POINT((r.left + r.right) // 2, (r.top + r.bottom) // 2))
        atravessa = meio not in (self.hwnd, *self._filhos)
        return (ex & ESTILO) == ESTILO, (r.left, r.top, r.right - r.left, r.bottom - r.top), atravessa


def fonte_jungler(captura, jungler, relogio, some_s=30, texto_s=10):
    """liga Captura (passo 13) + EstadoJungler (passo 14) ao overlay: calor da área provável ∩ fog;
    depois de some_s sem pista nova o calor some e fica só "sumido há X s" por texto_s; depois disso o
    overlay some (o painel já mostra o "sumido há X s"; a caixa não fica cobrindo o mapa o jogo todo)."""
    def f():
        ret = captura.ret
        if ret is None:
            return None
        t = relogio()
        terr = captura.ultimo_terreno() if captura.no_ar else None
        fog = terr["fog"] if terr is not None and terr["fog"].shape[0] == jungler.lado else None
        calor = jungler.calor(t, fog, some_s)
        texto = None
        morto = jungler.morto_ate is not None and t < jungler.morto_ate
        if calor is None and jungler.pista and not morto and t - jungler.pista["t"] <= some_s + texto_s:
            texto = f"jungler sumido há {int(t - jungler.pista['t'])} s"
        return {"ret": (ret.left, ret.top, ret.lado), "calor": calor, "texto": texto, "mostrar": captura.no_ar}
    return f


def _demo(left, top, lado, segundos):
    """abre o overlay com um calor sintético, confere estilo/retângulo e o desenho por print, fecha"""
    import mss

    def grab():  # um MSS por print: o overlay muda o DPI do processo no meio
        with mss.MSS() as s:
            return np.asarray(s.grab({"left": left, "top": top, "width": lado, "height": lado}))[:, :, :3].astype(int)

    yy, xx = np.mgrid[0:lado, 0:lado]
    calor = np.clip(1 - np.hypot(xx - lado * 0.3, yy - lado * 0.35) / (lado * 0.25), 0, 1)
    ov = OverlayMinimapa(lambda: {"ret": (left, top, lado), "calor": calor, "texto": "teste do overlay",
                                  "mostrar": True}, atalho=False, excluir_do_print=False)
    antes = grab()
    ov.iniciar()
    time.sleep(segundos)
    estilos, rect, atravessa = ov.conferir()
    depois = grab()
    excluida = ov.fora_do_print(True)   # o normal: o print do minimapa não vê o overlay
    time.sleep(0.5)
    excl = grab()
    ov.parar()
    time.sleep(0.8)
    quente = calor >= 0.05
    dif = lambda b: np.abs(b - antes).max(axis=2) > 25  # noqa: E731
    mudou_quente, mudou_frio = dif(depois)[quente].mean(), dif(depois)[~quente & (yy > 30)].mean()
    no_print = dif(excl)[quente].mean()
    print(f"estilos click-through/topo/sem foco: {estilos} | clique atravessa (WindowFromPoint): {atravessa} | "
          f"janela {rect} (pedido {left},{top},{lado})")
    print(f"px da área quente que mudaram: {mudou_quente:.0%} | px fora da área que mudaram: {mudou_frio:.0%}")
    print(f"fora do print (WDA_EXCLUDEFROMCAPTURE): {excluida} | área quente vista pelo print depois: {no_print:.0%}")
    ok = (estilos and atravessa and rect == (left, top, lado, lado) and mudou_quente > 0.8 and mudou_frio < 0.05
          and excluida and no_print < 0.05)
    print("ok" if ok else "FALHOU")
    return 0 if ok else 1


if __name__ == "__main__":
    import argparse
    import sys
    ap = argparse.ArgumentParser()
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--left", type=int, default=2197)
    ap.add_argument("--top", type=int, default=716)
    ap.add_argument("--lado", type=int, default=347)
    ap.add_argument("--segundos", type=float, default=2.0)
    a = ap.parse_args()
    if a.demo:
        sys.exit(_demo(a.left, a.top, a.lado, a.segundos))
