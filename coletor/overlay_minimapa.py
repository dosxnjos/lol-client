# overlay do minimapa (plano v2, passo 15b): janela própria, transparente, sempre no topo e que
# IGNORA clique (WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE), posta
# em cima do retângulo do minimapa achado pelo passo 13. Não toca no processo do jogo, não manda tecla nem
# clique: é uma janela do Windows por cima de outra (só funciona com o jogo sem borda, WindowMode=2).
# Mostra o mapa de calor de onde o jungler pode estar; some ~30 s depois da última pista e troca por
# "sumido há X s" por 10 s, depois some de vez até a próxima pista. F8 liga/desliga (RegisterHotKey: só escuta o atalho).
# Calibração de 14/10/2026 (roadmap/2026-10-14-calibrar-avisos.md): uma cor só (COR) com a probabilidade na
# opacidade, borda suavizada e transição contínua. Janela Win32 com UpdateLayeredWindow e alfa POR PIXEL (a
# versão Tk com cor-chave + alfa global serrilhava: cada px era 100% cor ou 100% transparente) e sem Tk (que
# rouba o foco ao nascer, ARMADILHAS § Windows).
#   python coletor/overlay_minimapa.py --demo [--left 2197 --top 716 --lado 347]   prova sem partida
import ctypes
import ctypes.wintypes as wt
import functools
import logging
import math
import threading
import time
import unicodedata
from dataclasses import dataclass

import cv2
import numpy as np

log = logging.getLogger("coletor")

# ---------- aparência (ajuste aqui) ----------
COR = (230, 60, 60)        # vermelho da família do anel dos inimigos no minimapa (RGB), uma cor só
ALPHA = 0.45               # opacidade no ponto mais provável (calor 1); a vitrine lê daqui
ALPHA_MIN = 0.12           # opacidade na borda da área (pouca chance)
LIMIAR = 0.05              # calor abaixo disto não pinta (a borda é uma rampa em volta dele, não um corte)
SUAVE_PX = 2.0             # desfoque gaussiano (σ em px) da opacidade: borda sem serrilhado (corte da fog incluso)
TAU_S = 0.35               # transição: a imagem mostrada anda para a nova com esta constante de tempo
QUADRO_MS = 100            # 10 quadros/s só enquanto anima; parado (convergiu) não redesenha. Medido 14/10/2026:
#                            ~2,6 ms por quadro com o UpdateLayeredWindow; a 15/s o processo ia a ~3,5% de um núcleo
BUSCA_MS = 400             # fonte() (calor do jungler) lida a cada 400 ms
TOPO_S = 1.0               # reafirma "sempre no topo" a cada 1 s com a janela visível
TEXTO_FUNDO = (20, 20, 20, 215)
CHAVE = (1, 0, 1)          # legado (cor-chave da versão Tk): nada mais usa como transparência; transparente = alfa 0
# escolhas do Gabriel nas Configurações (config overlayCor/overlayForca/overlaySuave; pedido de 14/10/2026). O
# padrão de cada uma = as constantes acima; nome desconhecido = o padrão. Os nomes são os de
# servidor_local.ESCOLHAS (o teste-alertas.py confere). Sem azul: azul é a cor dos aliados no minimapa.
CORES = {"vermelho": COR, "laranja": (240, 140, 50), "roxo": (170, 90, 230)}
FORCAS = {"sutil": (0.30, 0.08), "normal": (ALPHA, ALPHA_MIN), "forte": (0.60, 0.18)}   # (ALPHA, ALPHA_MIN)

GWL_EXSTYLE = -20
WS_POPUP = 0x80000000
WS_EX_LAYERED, WS_EX_TRANSPARENT = 0x00080000, 0x00000020
WS_EX_TOPMOST, WS_EX_TOOLWINDOW, WS_EX_NOACTIVATE = 0x00000008, 0x00000080, 0x08000000
ESTILO = WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
VK_F8, WM_HOTKEY, ID_ATALHO = 0x77, 0x0312, 0x4C43
MOD_NOREPEAT = 0x4000              # segurar o F8 = 1 alternância (sem ele o autorrepeat piscava o overlay)
WDA_EXCLUIR = 0x11                 # WDA_EXCLUDEFROMCAPTURE
WM_DESTROY, WM_CLOSE, WM_TIMER, WM_NCHITTEST = 0x0002, 0x0010, 0x0113, 0x0084
HTTRANSPARENT = -1
SW_HIDE = 0
SWP_NOSIZE, SWP_NOMOVE, SWP_NOACTIVATE, SWP_SHOWWINDOW = 0x0001, 0x0002, 0x0010, 0x0040
HWND_TOPMOST = -1
ULW_ALPHA, AC_SRC_OVER, AC_SRC_ALPHA = 0x2, 0x0, 0x1
DPI_PER_MONITOR_V2 = -4


# ---------- desenho (puro: testes e vitrine usam o mesmo) ----------

@dataclass(frozen=True)
class Estilo:
    """aparência da mancha: cor RGB, opacidade no mais provável (alpha) e na borda (alpha_min), constante de
    tempo da transição (tau; 0 = muda na hora). None nos desenhos = as constantes do módulo, lidas na chamada."""
    cor: tuple
    alpha: float
    alpha_min: float
    tau: float


def estilo(cor="vermelho", forca="normal", suave=True):
    """Estilo das escolhas das Configurações (overlayCor, overlayForca, overlaySuave); nome desconhecido = padrão"""
    a, a_min = FORCAS.get(forca, FORCAS["normal"])
    return Estilo(tuple(CORES.get(cor, CORES["vermelho"])), a, a_min, TAU_S if suave else 0.0)


def _estilo(e):
    return e if e is not None else Estilo(tuple(COR), ALPHA, ALPHA_MIN, TAU_S)


def alfa_alvo(calor, lado, estilo=None):
    """opacidade 0–1 (float32 lado×lado) do calor 0–1: rampa macia em volta do LIMIAR, de ALPHA_MIN na
    borda a ALPHA no mais provável (os do `estilo`, se vier), e desfoque de SUAVE_PX (anti-aliasing).
    calor None = tudo 0."""
    if calor is None:
        return np.zeros((lado, lado), np.float32)
    e = _estilo(estilo)
    c = np.clip(np.asarray(calor, np.float32), 0, 1)
    if c.shape[0] != lado:
        c = cv2.resize(c, (lado, lado), interpolation=cv2.INTER_LINEAR)
    # piso ALPHA_MIN em TODA a área com calor ≥ LIMIAR (revisão 14/10/2026: a rampa sobre o valor do calor
    # deixava zona inteira de calor 0,05 a ~7%, quase invisível: é a "até onde ele conseguiria ter ido" que o
    # contorno branco mostrava). A rampa fica só no último quarto abaixo do LIMIAR; quem suaviza é o desfoque
    borda = np.clip((c - LIMIAR * 0.75) / (LIMIAR * 0.25), 0, 1)
    a = borda * (e.alpha_min + (e.alpha - e.alpha_min) * c)
    return cv2.GaussianBlur(a, (0, 0), SUAVE_PX) if SUAVE_PX > 0 else a


def camada(alfa, texto=None, cor=None):
    """imagem RGBA (alfa direto, não pré-multiplicado) h×w: a cor (COR sem `cor`) com a opacidade `alfa`
    (0–1); alfa 0 = transparente. texto vai numa caixa no topo ("jungler sumido há 42 s")."""
    h, w = alfa.shape
    img = np.empty((h, w, 4), np.uint8)
    img[..., :3] = COR if cor is None else cor
    img[..., 3] = _alfa8(alfa)
    if texto:
        img = _escrever(img, texto, w)
    return img


def _alfa8(alfa):
    return np.clip(alfa * np.float32(255) + np.float32(0.5), 0, 255).astype(np.uint8)


# pré-multiplicado da cor por alfa 0–255 (a mesma conta do premultiplicar), em tabela: o quadro sem texto vira
# 4 consultas de tabela em vez de multiplicações (custo por quadro medido no tools/teste-overlay.py). Uma
# tabela por cor escolhida (são 3), feita na 1ª vez
@functools.lru_cache(maxsize=8)
def _tabela(cor):
    return np.array([[(c * a + 127) // 255 for a in range(256)] for c in (cor[2], cor[1], cor[0])], np.uint8)


def bgra_rapido(alfa, saida=None, cor=None):
    """o BGRA pré-multiplicado de camada(alfa, cor=cor) sem texto, igual byte a byte a premultiplicar(camada(...))"""
    tab = _tabela(tuple(COR if cor is None else cor))
    a8 = _alfa8(alfa)
    out = saida if saida is not None and saida.shape[:2] == a8.shape else np.empty(a8.shape + (4,), np.uint8)
    for i in range(3):
        np.take(tab[i], a8, out=out[..., i])
    out[..., 3] = a8
    return out


def renderizar(calor, lado, texto=None, estilo=None):
    """o quadro estável (sem a transição) do calor: RGBA lado×lado. É o que a janela mostra depois de
    convergir; a vitrine e os testes usam este (o quadro animado é camada(alfa_mostrado))."""
    e = _estilo(estilo)
    return camada(alfa_alvo(calor, lado, e), texto, e.cor)


def premultiplicar(rgba):
    """RGBA direto -> BGRA pré-multiplicado (o formato do UpdateLayeredWindow com AC_SRC_ALPHA)"""
    a = rgba[..., 3].astype(np.uint16)
    out = np.empty(rgba.shape, np.uint8)
    for i, j in ((0, 2), (1, 1), (2, 0)):        # B, G, R
        out[..., i] = (rgba[..., j].astype(np.uint16) * a + 127) // 255
    out[..., 3] = rgba[..., 3]
    return out


def compor_sobre(fundo_rgb, rgba):
    """o que a tela mostra: a camada RGBA sobre o fundo RGB, pela regra do UpdateLayeredWindow (fonte
    pré-multiplicada + fundo × (1 − alfa)). A vitrine compõe o print com esta mesma conta."""
    p = premultiplicar(rgba)[..., 2::-1].astype(np.uint16)          # pré-multiplicado, de volta a RGB
    a = rgba[..., 3:4].astype(np.uint16)
    return (p + (fundo_rgb.astype(np.uint16) * (255 - a) + 127) // 255).clip(0, 255).astype(np.uint8)


_FONTE = None


def _fonte():
    """Segoe UI do Windows (tem acento); sem ela, None e o texto cai no cv2 sem acento"""
    global _FONTE
    if _FONTE is None:
        try:
            from PIL import ImageFont
            _FONTE = ImageFont.truetype(r"C:\Windows\Fonts\segoeui.ttf", 13)
        except Exception:
            _FONTE = False
    return _FONTE or None


def _escrever(img, texto, lado):
    """caixa do tamanho do texto no topo, não uma faixa na largura toda (cobria o topo do mapa).
    cv2.putText só tem ASCII ("há" saía "h??"): o texto vai pelo Pillow com fonte do sistema (com
    anti-aliasing no alfa da camada RGBA)."""
    fonte = _fonte()
    if fonte is None:
        texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
        (w, h), base = cv2.getTextSize(texto, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
        cv2.rectangle(img, (0, 0), (min(lado - 1, w + 8), h + base + 6), TEXTO_FUNDO, -1)
        cv2.putText(img, texto, (4, h + 3), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255, 255), 1, cv2.LINE_AA)
        return img
    from PIL import Image, ImageDraw
    base = Image.fromarray(img, "RGBA")
    cima = Image.new("RGBA", base.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(cima)
    x0, y0, x1, y1 = d.textbbox((4, 2), texto, font=fonte)
    d.rectangle((0, 0, min(lado - 1, x1 + 4), y1 + 3), fill=TEXTO_FUNDO)
    d.text((4, 2), texto, font=fonte, fill=(255, 255, 255, 255))
    return np.asarray(Image.alpha_composite(base, cima)).copy()


class Transicao:
    """a opacidade mostrada anda para a alvo com constante de tempo TAU_S (média móvel exponencial): o
    crescimento da área e a troca de lugar viram movimento contínuo, sem saltos. passo(alvo, dt) ->
    (alfa mostrado, parado); parado = chegou (diferença < 1/255 em todo px) e não precisa redesenhar."""

    def __init__(self, tau=TAU_S):
        self.tau = tau            # ≤ 0 = sem transição (overlaySuave desligado): o alvo vai à tela na hora
        self.mostrado = None

    def passo(self, alvo, dt):
        if self.mostrado is None or self.mostrado.shape != alvo.shape:
            self.mostrado = np.zeros_like(alvo)
        dif = alvo - self.mostrado
        if float(np.abs(dif).max(initial=0)) < 1 / 255:
            self.mostrado = alvo.copy()
            return self.mostrado, True
        if self.tau <= 0:                 # salto: mostra o alvo já, mas este quadro mudou (redesenha)
            self.mostrado = alvo.copy()
            return self.mostrado, False
        k = 1.0 - math.exp(-max(dt, 0.0) / self.tau)
        self.mostrado += dif * np.float32(k)
        return self.mostrado, False


# ---------- Win32 ----------

_u = ctypes.WinDLL("user32", use_last_error=True)
_g = ctypes.WinDLL("gdi32", use_last_error=True)
_k = ctypes.WinDLL("kernel32", use_last_error=True)
LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM)


class WNDCLASSW(ctypes.Structure):
    _fields_ = [("style", wt.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int),
                ("cbWndExtra", ctypes.c_int), ("hInstance", wt.HINSTANCE), ("hIcon", wt.HICON),
                ("hCursor", wt.HANDLE), ("hbrBackground", wt.HBRUSH), ("lpszMenuName", wt.LPCWSTR),
                ("lpszClassName", wt.LPCWSTR)]


class BLENDFUNCTION(ctypes.Structure):
    _fields_ = [("BlendOp", ctypes.c_ubyte), ("BlendFlags", ctypes.c_ubyte),
                ("SourceConstantAlpha", ctypes.c_ubyte), ("AlphaFormat", ctypes.c_ubyte)]


class _BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", wt.DWORD), ("biWidth", wt.LONG), ("biHeight", wt.LONG), ("biPlanes", wt.WORD),
                ("biBitCount", wt.WORD), ("biCompression", wt.DWORD), ("biSizeImage", wt.DWORD),
                ("biXPelsPerMeter", wt.LONG), ("biYPelsPerMeter", wt.LONG), ("biClrUsed", wt.DWORD),
                ("biClrImportant", wt.DWORD)]


_u.DefWindowProcW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
_u.DefWindowProcW.restype = LRESULT
_u.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASSW)]
_u.RegisterClassW.restype = wt.ATOM
_u.UnregisterClassW.argtypes = [wt.LPCWSTR, wt.HINSTANCE]
_u.CreateWindowExW.argtypes = [wt.DWORD, wt.LPCWSTR, wt.LPCWSTR, wt.DWORD, ctypes.c_int, ctypes.c_int,
                               ctypes.c_int, ctypes.c_int, wt.HWND, wt.HMENU, wt.HINSTANCE, wt.LPVOID]
_u.CreateWindowExW.restype = wt.HWND
_u.UpdateLayeredWindow.argtypes = [wt.HWND, wt.HDC, ctypes.POINTER(wt.POINT), ctypes.POINTER(wt.SIZE), wt.HDC,
                                   ctypes.POINTER(wt.POINT), wt.COLORREF, ctypes.POINTER(BLENDFUNCTION), wt.DWORD]
_u.UpdateLayeredWindow.restype = wt.BOOL
_u.SetWindowPos.argtypes = [wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.UINT]
_u.ShowWindow.argtypes = [wt.HWND, ctypes.c_int]
_u.SetTimer.argtypes = [wt.HWND, ctypes.c_size_t, wt.UINT, wt.LPVOID]
_u.KillTimer.argtypes = [wt.HWND, ctypes.c_size_t]
_u.GetMessageW.argtypes = [ctypes.POINTER(wt.MSG), wt.HWND, wt.UINT, wt.UINT]
_u.TranslateMessage.argtypes = [ctypes.POINTER(wt.MSG)]
_u.DispatchMessageW.argtypes = [ctypes.POINTER(wt.MSG)]
_u.PostMessageW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
_u.DestroyWindow.argtypes = [wt.HWND]
_u.PostQuitMessage.argtypes = [ctypes.c_int]
_u.SetWindowDisplayAffinity.argtypes = [wt.HWND, wt.DWORD]
_u.GetWindowLongW.argtypes = [wt.HWND, ctypes.c_int]
_u.GetWindowRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
_u.WindowFromPoint.argtypes = [wt.POINT]
_u.WindowFromPoint.restype = wt.HWND
_u.GetDC.argtypes = [wt.HWND]
_u.GetDC.restype = wt.HDC
_u.ReleaseDC.argtypes = [wt.HWND, wt.HDC]
_g.CreateCompatibleDC.argtypes = [wt.HDC]
_g.CreateCompatibleDC.restype = wt.HDC
_g.CreateDIBSection.argtypes = [wt.HDC, ctypes.c_void_p, wt.UINT, ctypes.POINTER(ctypes.c_void_p), wt.HANDLE, wt.DWORD]
_g.CreateDIBSection.restype = wt.HBITMAP
_g.SelectObject.argtypes = [wt.HDC, wt.HGDIOBJ]
_g.SelectObject.restype = wt.HGDIOBJ
_g.DeleteObject.argtypes = [wt.HGDIOBJ]
_g.DeleteDC.argtypes = [wt.HDC]
_k.GetModuleHandleW.argtypes = [wt.LPCWSTR]
_k.GetModuleHandleW.restype = wt.HMODULE
try:
    _u.SetThreadDpiAwarenessContext.argtypes = [wt.HANDLE]
    _u.SetThreadDpiAwarenessContext.restype = wt.HANDLE
except AttributeError:  # Windows antigo
    pass


def _dpi_fisico():
    """janela em px físicos (o mss e o retângulo do minimapa são físicos; escala de 125% aqui). O fio da
    janela fica per-monitor v2; o processo também, como na versão Tk (quem mais lê coordenada no processo
    se acostumou com isso)."""
    try:
        _u.SetThreadDpiAwarenessContext(wt.HANDLE(DPI_PER_MONITOR_V2))
    except Exception:
        pass
    try:
        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(DPI_PER_MONITOR_V2))
    except Exception:
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            pass


class _Superficie:
    """DIB de 32 bits (BGRA, de cima para baixo) num DC de memória: o que o UpdateLayeredWindow copia"""

    def __init__(self, lado):
        self.lado = lado
        self.tela = _u.GetDC(None)
        self.mem = _g.CreateCompatibleDC(self.tela)
        bih = _BITMAPINFOHEADER(biSize=ctypes.sizeof(_BITMAPINFOHEADER), biWidth=lado, biHeight=-lado, biPlanes=1,
                                biBitCount=32, biCompression=0)
        self.bits = ctypes.c_void_p()
        self.dib = _g.CreateDIBSection(self.mem, ctypes.byref(bih), 0, ctypes.byref(self.bits), None, 0)
        if not self.dib or not self.bits.value:
            self.fechar()
            raise OSError("CreateDIBSection falhou")
        self.antigo = _g.SelectObject(self.mem, self.dib)

    def mostrar(self, hwnd, left, top, bgra):
        ctypes.memmove(self.bits.value, np.ascontiguousarray(bgra).ctypes.data, self.lado * self.lado * 4)
        mistura = BLENDFUNCTION(AC_SRC_OVER, 0, 255, AC_SRC_ALPHA)
        return bool(_u.UpdateLayeredWindow(hwnd, self.tela, ctypes.byref(wt.POINT(left, top)),
                                           ctypes.byref(wt.SIZE(self.lado, self.lado)), self.mem,
                                           ctypes.byref(wt.POINT(0, 0)), 0, ctypes.byref(mistura), ULW_ALPHA))

    def fechar(self):
        if getattr(self, "antigo", None):
            _g.SelectObject(self.mem, self.antigo)
        if getattr(self, "dib", None):
            _g.DeleteObject(self.dib)
        if getattr(self, "mem", None):
            _g.DeleteDC(self.mem)
        if getattr(self, "tela", None):
            _u.ReleaseDC(None, self.tela)
        self.dib = self.mem = self.tela = self.antigo = None


class OverlayMinimapa:
    """fonte() -> {"ret": (left, top, lado) em px físicos da tela, "calor": float lado×lado ou None,
    "texto": str|None, "mostrar": bool (jogo em primeiro plano)}. Roda num fio com a própria janela Win32."""

    def __init__(self, fonte, intervalo_ms=BUSCA_MS, atalho=True, excluir_do_print=True, quadro_ms=QUADRO_MS):
        self.fonte = fonte
        self.intervalo = intervalo_ms      # de quanto em quanto a fonte é lida
        self.quadro_ms = quadro_ms
        self.ligado = True
        self.atalho = atalho
        self.ao_alternar = None   # callback(ligado) do F8: retorno ao jogador ("overlay ligado" na moldura)
        self.ao_desenhar = None   # callback(img RGBA, (left, top, lado), quadro) a cada quadro mostrado (vitrine)
        # o overlay fica EM CIMA do minimapa que o passo 13 captura: sem isto o print veria o próprio
        # mapa de calor (fog e ícones errados). WDA_EXCLUDEFROMCAPTURE: some do print, segue na tela.
        self.excluir = excluir_do_print
        self.excluida = None
        self.hwnd = None
        self._filhos = ()
        self._thread = None               # o coach_vivo dá join nele ao parar
        self._parar = threading.Event()
        self._pronto = threading.Event()
        self._proc = WNDPROC(self._wndproc)   # referência viva: o GC não pode levar o callback
        self.medidas = []                     # ms por quadro desenhado (prova de custo)
        self._ult_gancho = float("-inf")      # monotonic do último quadro entregue à vitrine (ao_desenhar)
        self.estilo = estilo()                # cor, força e transição (aplicar_estilo, vindo das Configurações)
        self._zerar()

    def aplicar_estilo(self, e):
        """troca cor/força/transição em voo (POST /config, outra thread): a próxima volta do fio relê a fonte e
        redesenha (o estilo entra no estado do quadro, então o "parado" não segura a imagem velha)"""
        self.estilo = e
        self._trans.tau = e.tau
        self._ult_busca = float("-inf")

    def _zerar(self):
        self._quadro = None
        self._alvo = None
        self._texto = None
        self._trans = Transicao(self.estilo.tau)
        self._sup = None
        self._bgra = None                 # buffer reaproveitado entre quadros
        self._visivel = False
        self._desenhado = None            # (texto, ret) do último quadro mandado à tela, com a imagem parada
        self._ult_busca = float("-inf")
        self._ult_quadro = None
        self._ult_topo = 0.0
        self._falha_ulw = False

    def iniciar(self):
        if self._thread and self._thread.is_alive():
            return
        self._parar.clear()
        self._pronto.clear()
        self._thread = threading.Thread(target=self._laco, name="overlay-minimapa", daemon=True)
        self._thread.start()
        if self.atalho:
            threading.Thread(target=self._escutar_atalho, name="overlay-f8", daemon=True).start()
        if not self._pronto.wait(5):   # janela morta no fio não deixava rastro no log
            log.warning("overlay: janela não nasceu em 5 s")

    def parar(self):
        self._parar.set()
        if self.hwnd:
            _u.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)

    def alternar(self):
        self.ligado = not self.ligado
        log.info("overlay do minimapa %s (F8)", "ligado" if self.ligado else "desligado")
        if self.ao_alternar is not None:
            try:
                self.ao_alternar(self.ligado)
            except Exception as e:
                log.warning("overlay: retorno do F8 falhou: %s: %s", type(e).__name__, e)

    # ---- fio da janela
    def _laco(self):
        nome = f"lol-client-overlay-{id(self)}"
        inst = _k.GetModuleHandleW(None)
        try:
            _dpi_fisico()
            wc = WNDCLASSW(lpfnWndProc=self._proc, hInstance=inst, lpszClassName=nome)
            _u.RegisterClassW(ctypes.byref(wc))
            self.hwnd = _u.CreateWindowExW(ESTILO, nome, "lol-client overlay", WS_POPUP, 0, 0, 1, 1,
                                           None, None, inst, None)
            if not self.hwnd:
                raise OSError(f"CreateWindowExW falhou (erro {ctypes.get_last_error()})")
            self._filhos = (self.hwnd,)
            self.fora_do_print(self.excluir)
            _u.SetTimer(self.hwnd, 1, int(self.quadro_ms), None)
            self._pronto.set()
            msg = wt.MSG()
            while _u.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
                _u.TranslateMessage(ctypes.byref(msg))
                _u.DispatchMessageW(ctypes.byref(msg))
        except Exception as e:   # exceção no fio da janela ia para o stderr (nenhum, na tarefa agendada)
            log.warning("overlay: janela morreu: %s: %s", type(e).__name__, e)
        finally:
            self._pronto.set()
            if self._sup is not None:
                self._sup.fechar()
            self.hwnd = None
            self._zerar()
            _u.UnregisterClassW(nome, inst)

    def _wndproc(self, hwnd, msg, wp, lp):
        try:
            if msg == WM_TIMER:
                if self._parar.is_set():
                    _u.DestroyWindow(hwnd)
                else:
                    self._passo()
                return 0
            if msg == WM_NCHITTEST:
                return HTTRANSPARENT
            if msg == WM_CLOSE:
                _u.DestroyWindow(hwnd)
                return 0
            if msg == WM_DESTROY:
                _u.KillTimer(hwnd, 1)
                _u.PostQuitMessage(0)
                return 0
        except Exception as e:   # exceção num callback do Windows some calada: registrar
            log.warning("overlay: %s: %s", type(e).__name__, e)
        return _u.DefWindowProcW(hwnd, msg, wp, lp)

    def _esconder(self):
        if self._visivel:
            _u.ShowWindow(self.hwnd, SW_HIDE)
            self._visivel = False
            self._desenhado = None

    def _passo(self):
        agora = time.monotonic()
        e = self.estilo                    # uma leitura por volta: a troca em voo vale inteira na próxima
        if agora - self._ult_busca >= self.intervalo / 1000:
            self._ult_busca = agora
            f = self.fonte() or {}
            ret = f.get("ret")
            self._quadro, self._texto = f, f.get("texto")
            if ret:
                self._alvo = alfa_alvo(f.get("calor"), int(ret[2]), e)   # sem calor: alvo 0 = some devagar
        f = self._quadro or {}
        ret = f.get("ret")
        if not (self.ligado and f.get("mostrar") and ret and self._alvo is not None):
            self._esconder()                       # F8 ou jogo fora da tela: some na hora, como antes
            self._ult_quadro = None
            return
        dt = agora - self._ult_quadro if self._ult_quadro is not None else self.quadro_ms / 1000
        self._ult_quadro = agora
        alfa, parado = self._trans.passo(self._alvo, dt)
        texto = self._texto
        if not texto and float(alfa.max(initial=0)) < 1 / 255:
            self._esconder()
            return
        estado = (texto, tuple(ret), e)
        if parado and self._desenhado == estado:
            if self._visivel and agora - self._ult_topo >= TOPO_S:
                self._ult_topo = agora
                _u.SetWindowPos(self.hwnd, wt.HWND(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)
            # parado não redesenha, mas a vitrine continua recebendo o quadro que está na tela no ritmo da
            # busca (antes da janela Win32 era a cada 400 ms; sem isto, overlay parado = vitrine sem print)
            if (self.ao_desenhar is not None and self._visivel
                    and agora - self._ult_gancho >= self.intervalo / 1000):
                self._gancho(camada(alfa, texto, e.cor), (int(ret[0]), int(ret[1]), int(ret[2])), f, agora)
            return
        t0 = time.perf_counter()
        left, top, lado = (int(v) for v in ret)
        # sem texto (o caso comum): tabela direto para BGRA; a imagem RGBA só se a vitrine pede (mesmos bytes)
        img = camada(alfa, texto, e.cor) if texto or self.ao_desenhar is not None else None
        bgra = premultiplicar(img) if texto else bgra_rapido(alfa, self._bgra, e.cor)
        self._bgra = bgra
        if self._sup is None or self._sup.lado != lado:
            if self._sup is not None:
                self._sup.fechar()
            self._sup = _Superficie(lado)
        if not self._sup.mostrar(self.hwnd, left, top, bgra):
            if not self._falha_ulw:
                self._falha_ulw = True
                log.warning("overlay: UpdateLayeredWindow falhou (erro %d)", ctypes.get_last_error())
            return
        if not self._visivel or agora - self._ult_topo >= TOPO_S:
            self._ult_topo = agora
            _u.SetWindowPos(self.hwnd, wt.HWND(HWND_TOPMOST), left, top, lado, lado, SWP_NOACTIVATE | SWP_SHOWWINDOW)
            self._visivel = True
        self._desenhado = estado if parado else None
        self.medidas.append((time.perf_counter() - t0) * 1000)
        if len(self.medidas) > 5000:
            del self.medidas[:2500]
        if self.ao_desenhar is not None and img is not None:   # só enfileira (vitrine): o pixel que acabou de ir à tela
            self._gancho(img, (left, top, lado), f, agora)

    def _gancho(self, img, ret, quadro, agora):
        self._ult_gancho = agora
        try:
            self.ao_desenhar(img, ret, quadro)
        except Exception as e:
            log.warning("overlay: gancho da vitrine falhou: %s", e)

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
            self.excluida = bool(_u.SetWindowDisplayAffinity(self.hwnd, WDA_EXCLUIR if sim else 0)) and sim
        return self.excluida

    def conferir(self):
        """(estilos ok, retângulo da janela em px físicos, clique atravessa) para a prova; o clique
        atravessa quando WindowFromPoint no meio da janela devolve OUTRA janela (a de baixo)"""
        ex = _u.GetWindowLongW(self.hwnd, GWL_EXSTYLE)
        r = wt.RECT()
        _u.GetWindowRect(self.hwnd, ctypes.byref(r))
        meio = _u.WindowFromPoint(wt.POINT((r.left + r.right) // 2, (r.top + r.bottom) // 2))
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
    """abre o overlay com um calor sintético que cresce, confere estilo/retângulo, o desenho por print
    (contra a conta da composição), a exclusão do print e o custo por quadro; fecha"""
    import mss

    def grab():  # um MSS por print: o overlay muda o DPI do processo no meio
        with mss.MSS() as s:
            return np.asarray(s.grab({"left": left, "top": top, "width": lado, "height": lado}))[:, :, :3].astype(int)

    yy, xx = np.mgrid[0:lado, 0:lado]
    t0 = time.monotonic()

    def calor():   # a área cresce de 15% a 30% do lado em `segundos`: prova a transição sem salto
        r = lado * (0.15 + 0.15 * min(1.0, (time.monotonic() - t0) / max(segundos, 0.1)))
        return np.clip(1 - np.hypot(xx - lado * 0.3, yy - lado * 0.35) / r, 0, 1)

    ov = OverlayMinimapa(lambda: {"ret": (left, top, lado), "calor": calor(), "texto": "teste do overlay",
                                  "mostrar": True}, atalho=False, excluir_do_print=False)
    antes = grab()
    ov.iniciar()
    time.sleep(segundos + 1.5)              # cresce e depois converge
    estilos, rect, atravessa = ov.conferir()
    depois = grab()
    excluida = ov.fora_do_print(True)   # o normal: o print do minimapa não vê o overlay
    time.sleep(0.5)
    excl = grab()
    ov.parar()
    time.sleep(0.8)
    final = calor()
    esperado = compor_sobre(antes[:, :, ::-1].astype(np.uint8), renderizar(final, lado, "teste do overlay"))[:, :, ::-1]
    quente = final >= 0.5
    dif = lambda b: np.abs(b - antes).max(axis=2) > 8  # noqa: E731
    mudou_quente = dif(depois)[quente].mean()
    mudou_frio = dif(depois)[(alfa_alvo(final, lado) == 0) & (yy > 30)].mean()
    erro = np.abs(depois - esperado.astype(int)).max(axis=2)[quente]
    no_print = dif(excl)[quente].mean()
    med = ov.medidas
    print(f"estilos click-through/topo/sem foco: {estilos} | clique atravessa (WindowFromPoint): {atravessa} | "
          f"janela {rect} (pedido {left},{top},{lado})")
    print(f"px da área quente que mudaram: {mudou_quente:.0%} | px fora da área que mudaram: {mudou_frio:.0%} | "
          f"tela x conta da composição na área quente: erro máx {int(erro.max(initial=0))}, mediana {int(np.median(erro)) if erro.size else 0}")
    print(f"fora do print (WDA_EXCLUDEFROMCAPTURE): {excluida} | área quente vista pelo print depois: {no_print:.0%}")
    if med:
        print(f"custo: {len(med)} quadros desenhados, {np.median(med):.2f} ms mediana, {np.percentile(med, 95):.2f} ms p95")
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
