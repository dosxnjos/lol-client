# moldura de alerta (plano v2, passo 15c): janela própria de tela inteira, transparente, sempre no
# topo e que ignora clique (WS_EX_LAYERED | TRANSPARENT | TOPMOST | TOOLWINDOW | NOACTIVATE, via
# ctypes). Desenha só uma borda colorida pulsando + um rótulo de até 3 palavras no canto, por ~2 s.
# Não toca no processo do jogo, não rouba o foco e só desenha com o jogo em primeiro plano (print
# do monitor com outra janela na frente seria alerta sobre nada: ARMADILHAS § Tela).
# Desde 14/10/2026 (partida das 15:48, pedido do Gabriel: "um fade transparente em direção ao centro da tela [...]
# e cores levemente mais escurecidas") a janela é UpdateLayeredWindow com alfa POR PIXEL, como o overlay do minimapa:
# a beirada de ESPESSURA px fica na cor cheia (alfa 255: a lição do overlay, desfoque que deixava o desenho
# invisível) e de lá um degradê vai a transparente em direção ao centro (FADE). Antes: GDI com cor-chave magenta
# (cada px era 100% cor ou 100% transparente, sem degradê possível). O pulso é o alfa constante do
# UpdateLayeredWindow (sem redesenhar a imagem a cada tique).
# uso: python coletor/moldura.py vermelho "jungler rio top" [--forcar] [--retangulo x,y,l,a]
import ctypes
import ctypes.wintypes as wt
import math
import queue
import threading
import time

import numpy as np

TITULO_JOGO = "League of Legends (TM) Client"
CORES = {"vermelho": (235, 45, 45), "amarelo": (245, 200, 40), "azul": (60, 145, 255), "verde": (60, 200, 110)}
ESCURECER = 0.8                               # "cores levemente mais escurecidas" (Gabriel, 14/10/2026)
CORES_MOLDURA = {k: tuple(int(round(c * ESCURECER)) for c in v) for k, v in CORES.items()}
TEXTO_ESCURO = {"amarelo", "verde"}           # rótulo preto nas cores claras
FADE = 0.10                                   # degradê: fração do menor lado da tela (108 px em 1080)
FADE_INICIO = 0.6                             # alfa logo depois da beirada cheia; cai a 0 com curva suave
# piso do pulso (alfa da janela inteira): com 0,45 o azul escurecido no vale ficava apagado sobre o mapa escuro
# (revisão 14/10/2026; a lição do efe9087: degradê/pulso não podem sumir com a borda)
PULSO_MIN = 0.6
# um piscar só (mostrar(pulsos=1)): recado azul que não pede ação ("Malphite voltou"). Pedido do Gabriel, partida
# de 15/10/2026: "não precisa ficar tanto tempo, pode ser uma pulsada única". Cheio por UM_PULSO_CHEIO
# (dá para ler o rótulo) e some suave até UM_PULSO_S
UM_PULSO_S = 1.0
UM_PULSO_CHEIO = 0.45


def alfa_pulso(t, duracao, pulsos=None, ciclo=0.7):
    """alfa da janela inteira (0..1) t s depois de aparecer. pulsos=None: pulsa entre 1 e PULSO_MIN (~0,7 s por
    ciclo) até `duracao`; pulsos=1: cheio até UM_PULSO_CHEIO·duração e cai a 0 com curva suave em `duracao`"""
    if t >= duracao:
        return 0.0
    if pulsos == 1:
        cheio = UM_PULSO_CHEIO * duracao
        if t <= cheio:
            return 1.0
        return 0.5 + 0.5 * math.cos(math.pi * (t - cheio) / (duracao - cheio))
    return PULSO_MIN + (1 - PULSO_MIN) * (0.5 + 0.5 * math.cos(2 * math.pi * t / ciclo))

WS_POPUP = 0x80000000
WS_EX_LAYERED, WS_EX_TRANSPARENT, WS_EX_TOPMOST = 0x00080000, 0x00000020, 0x00000008
WS_EX_TOOLWINDOW, WS_EX_NOACTIVATE = 0x00000080, 0x08000000
ESTILO_EX = WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
SW_HIDE, SW_SHOWNOACTIVATE = 0, 4
SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE = 0x0010, 0x0002, 0x0001
HWND_TOPMOST = wt.HWND(-1)
WM_DESTROY, WM_CLOSE, WM_TIMER, WM_NCHITTEST, WM_APP = 0x0002, 0x0010, 0x0113, 0x0084, 0x8000
HTTRANSPARENT = -1
GWL_EXSTYLE = -20
WDA_EXCLUDEFROMCAPTURE = 0x11                 # Windows 10 2004+: some de print/gravação, segue na tela
ULW_ALPHA, AC_SRC_OVER, AC_SRC_ALPHA = 0x2, 0x0, 0x1
DPI_PER_MONITOR_V2 = wt.HANDLE(-4)

user32 = ctypes.WinDLL("user32", use_last_error=True)
gdi32 = ctypes.WinDLL("gdi32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
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


user32.DefWindowProcW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
user32.DefWindowProcW.restype = LRESULT
user32.CreateWindowExW.argtypes = [wt.DWORD, wt.LPCWSTR, wt.LPCWSTR, wt.DWORD, ctypes.c_int, ctypes.c_int,
                                   ctypes.c_int, ctypes.c_int, wt.HWND, wt.HMENU, wt.HINSTANCE, wt.LPVOID]
user32.CreateWindowExW.restype = wt.HWND
user32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASSW)]
user32.RegisterClassW.restype = wt.ATOM
user32.UnregisterClassW.argtypes = [wt.LPCWSTR, wt.HINSTANCE]
user32.UpdateLayeredWindow.argtypes = [wt.HWND, wt.HDC, ctypes.POINTER(wt.POINT), ctypes.POINTER(wt.SIZE), wt.HDC,
                                       ctypes.POINTER(wt.POINT), wt.COLORREF, ctypes.POINTER(BLENDFUNCTION), wt.DWORD]
user32.UpdateLayeredWindow.restype = wt.BOOL
user32.SetWindowPos.argtypes = [wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.UINT]
user32.GetForegroundWindow.restype = wt.HWND
user32.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
user32.GetWindowRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
user32.PostMessageW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
user32.SetTimer.argtypes = [wt.HWND, ctypes.c_size_t, wt.UINT, wt.LPVOID]
user32.KillTimer.argtypes = [wt.HWND, ctypes.c_size_t]
user32.GetWindowLongW.argtypes = [wt.HWND, ctypes.c_int]
user32.ShowWindow.argtypes = [wt.HWND, ctypes.c_int]
user32.DestroyWindow.argtypes = [wt.HWND]
user32.GetMessageW.argtypes = [ctypes.POINTER(wt.MSG), wt.HWND, wt.UINT, wt.UINT]
user32.TranslateMessage.argtypes = [ctypes.POINTER(wt.MSG)]
user32.DispatchMessageW.argtypes = [ctypes.POINTER(wt.MSG)]
user32.GetSystemMetrics.argtypes = [ctypes.c_int]
user32.PostQuitMessage.argtypes = [ctypes.c_int]
user32.SetWindowDisplayAffinity.argtypes = [wt.HWND, wt.DWORD]
user32.GetDC.argtypes = [wt.HWND]
user32.GetDC.restype = wt.HDC
user32.ReleaseDC.argtypes = [wt.HWND, wt.HDC]
gdi32.CreateCompatibleDC.argtypes = [wt.HDC]
gdi32.CreateCompatibleDC.restype = wt.HDC
gdi32.CreateDIBSection.argtypes = [wt.HDC, ctypes.c_void_p, wt.UINT, ctypes.POINTER(ctypes.c_void_p), wt.HANDLE,
                                   wt.DWORD]
gdi32.CreateDIBSection.restype = wt.HBITMAP
gdi32.SelectObject.argtypes = [wt.HDC, wt.HGDIOBJ]
gdi32.SelectObject.restype = wt.HGDIOBJ
gdi32.DeleteObject.argtypes = [wt.HGDIOBJ]
gdi32.DeleteDC.argtypes = [wt.HDC]
kernel32.GetModuleHandleW.argtypes = [wt.LPCWSTR]
kernel32.GetModuleHandleW.restype = wt.HMODULE
try:
    user32.SetThreadDpiAwarenessContext.argtypes = [wt.HANDLE]
    user32.SetThreadDpiAwarenessContext.restype = wt.HANDLE
except AttributeError:  # Windows antigo: fica sem
    pass


# ---------- desenho (puro: numpy + Pillow; a janela e a vitrine usam o mesmo) ----------

_ALFA_BORDA = {}   # (w, h, espessura) -> alfa uint8 h×w da borda com degradê (o mesmo para toda cor)
_FONTE = {}


def alfa_borda(w, h, espessura):
    """alfa 0–255 por px: ESPESSURA px da beirada em 255; daí para dentro um degradê de FADE_INICIO a 0 em
    FADE × menor lado, curva (1 − t)² (some suave, sem linha no fim); o miolo é 0. Em cache por tamanho."""
    chave = (w, h, espessura)
    if chave not in _ALFA_BORDA:
        if len(_ALFA_BORDA) > 4:
            _ALFA_BORDA.clear()
        x = np.minimum(np.arange(w), np.arange(w)[::-1]).astype(np.float32)
        y = np.minimum(np.arange(h), np.arange(h)[::-1]).astype(np.float32)
        d = np.minimum(y[:, None], x[None, :])                    # distância até a beirada mais perto
        fade = max(1.0, FADE * min(w, h))
        t = np.clip((d - espessura) / fade, 0.0, 1.0)
        a = np.where(d < espessura, 1.0, FADE_INICIO * (1.0 - t) ** 2)
        _ALFA_BORDA[chave] = np.round(a * 255).astype(np.uint8)
    return _ALFA_BORDA[chave]


def _fonte(px=40):
    if px not in _FONTE:
        try:
            from PIL import ImageFont
            _FONTE[px] = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", px)
        except Exception:
            try:
                from PIL import ImageFont
                _FONTE[px] = ImageFont.load_default()
            except Exception:
                _FONTE[px] = None
    return _FONTE[px]


def renderizar(w, h, cor, rotulo, espessura=None):
    """a moldura como imagem RGBA h×w (alfa direto, não pré-multiplicado): borda na cor escurecida
    (CORES_MOLDURA) com o degradê de alfa_borda e o rótulo numa caixa opaca no canto. É o que a janela mostra
    (premultiplicar -> UpdateLayeredWindow) e o que a vitrine compõe sobre o print (vitrine.compor, camada RGBA)."""
    e = espessura or Moldura.ESPESSURA
    img = np.zeros((h, w, 4), np.uint8)
    if cor is None:
        return img
    rgb = CORES_MOLDURA.get(cor, cor) if not isinstance(cor, tuple) else cor
    img[..., :3] = rgb
    img[..., 3] = alfa_borda(w, h, e)
    if rotulo:
        from PIL import Image, ImageDraw
        fonte = _fonte()
        cx, cy = e + 24, e + 24
        medida = ImageDraw.Draw(Image.new("L", (1, 1))).textbbox((0, 0), rotulo, font=fonte)
        cw, ch = medida[2] + 36, medida[3] + 16
        x1, y1 = min(w, cx + cw), min(h, cy + ch)
        if x1 > cx and y1 > cy:
            caixa = Image.new("RGBA", (x1 - cx, y1 - cy), (*rgb, 255))
            texto = (16, 16, 16, 255) if cor in TEXTO_ESCURO else (255, 255, 255, 255)
            ImageDraw.Draw(caixa).text((18, 8 - medida[1] // 2), rotulo, font=fonte, fill=texto)   # centrado
            img[cy:y1, cx:x1] = np.asarray(caixa)
    return img


def premultiplicar(rgba):
    """RGBA direto -> BGRA pré-multiplicado (o formato do UpdateLayeredWindow com AC_SRC_ALPHA)"""
    a = rgba[..., 3].astype(np.uint16)
    out = np.empty(rgba.shape, np.uint8)
    for i, j in ((0, 2), (1, 1), (2, 0)):        # B, G, R
        out[..., i] = (rgba[..., j].astype(np.uint16) * a + 127) // 255
    out[..., 3] = rgba[..., 3]
    return out


def janela_do_jogo():
    """(hwnd, (x, y, largura, altura)) da janela do jogo se ela está em primeiro plano; senão None.
    Coordenadas em px físicos (o fio da moldura é per-monitor DPI aware)."""
    h = user32.GetForegroundWindow()
    if not h:
        return None
    buf = ctypes.create_unicode_buffer(128)
    user32.GetWindowTextW(h, buf, 128)
    if buf.value != TITULO_JOGO:
        return None
    r = wt.RECT()
    user32.GetWindowRect(h, ctypes.byref(r))
    return h, (r.left, r.top, r.right - r.left, r.bottom - r.top)


class _Superficie:
    """DIB de 32 bits (BGRA, de cima para baixo) num DC de memória, refeito quando o tamanho muda"""

    def __init__(self):
        self.w = self.h = 0
        self.tela = user32.GetDC(None)
        self.mem = gdi32.CreateCompatibleDC(self.tela)
        self.dib = self.antigo = None
        self.bits = ctypes.c_void_p()

    def preparar(self, w, h):
        if (w, h) == (self.w, self.h) and self.dib:
            return
        self._soltar_dib()
        bih = _BITMAPINFOHEADER(biSize=ctypes.sizeof(_BITMAPINFOHEADER), biWidth=w, biHeight=-h, biPlanes=1,
                                biBitCount=32, biCompression=0)
        self.bits = ctypes.c_void_p()
        self.dib = gdi32.CreateDIBSection(self.mem, ctypes.byref(bih), 0, ctypes.byref(self.bits), None, 0)
        if not self.dib or not self.bits.value:
            self.dib = None
            raise OSError("CreateDIBSection falhou")
        self.antigo = gdi32.SelectObject(self.mem, self.dib)
        self.w, self.h = w, h

    def mostrar(self, hwnd, x, y, bgra, alfa=255):
        h, w = bgra.shape[:2]
        self.preparar(w, h)
        ctypes.memmove(self.bits.value, np.ascontiguousarray(bgra).ctypes.data, w * h * 4)
        mistura = BLENDFUNCTION(AC_SRC_OVER, 0, int(alfa), AC_SRC_ALPHA)
        return bool(user32.UpdateLayeredWindow(hwnd, self.tela, ctypes.byref(wt.POINT(x, y)),
                                               ctypes.byref(wt.SIZE(w, h)), self.mem, ctypes.byref(wt.POINT(0, 0)),
                                               0, ctypes.byref(mistura), ULW_ALPHA))

    @staticmethod
    def pulsar(hwnd, alfa):
        """só o alfa constante (o pulso): sem DC de origem o Windows mantém a imagem (UpdateLayeredWindow)"""
        mistura = BLENDFUNCTION(AC_SRC_OVER, 0, max(0, min(255, int(alfa))), AC_SRC_ALPHA)
        return bool(user32.UpdateLayeredWindow(hwnd, None, None, None, None, None, 0, ctypes.byref(mistura),
                                               ULW_ALPHA))

    def _soltar_dib(self):
        if self.antigo:
            gdi32.SelectObject(self.mem, self.antigo)
        if self.dib:
            gdi32.DeleteObject(self.dib)
        self.dib = self.antigo = None
        self.w = self.h = 0

    def fechar(self):
        self._soltar_dib()
        if self.mem:
            gdi32.DeleteDC(self.mem)
        if self.tela:
            user32.ReleaseDC(None, self.tela)
        self.mem = self.tela = None


class Moldura:
    """mostrar(cor, rotulo) pede um alerta (assíncrono, de qualquer fio). A janela vive num fio
    próprio com laço de mensagens; o pulso é o alfa constante da janela inteira (~0,7 s por ciclo).
    forcar=True ignora o teste de jogo em primeiro plano; retangulo=(x, y, l, a) fixa a área (testes)."""
    DURACAO = 2.0
    ESPESSURA = 12
    CICLO = 0.7
    TICK_MS = 30

    def __init__(self, forcar=False, retangulo=None, espessura=None, fora_do_print=True, log=None):
        self.forcar, self.retangulo, self.log = forcar, retangulo, log
        self.fora_do_print = fora_do_print   # WDA_EXCLUDEFROMCAPTURE: o print do minimapa não vê a moldura
        self.excluida = None                  # True se o Windows aceitou ficar fora do print
        self.espessura = espessura or self.ESPESSURA
        self.hwnd = None
        self.exibidos = []              # (monotonic, cor, rotulo) do que apareceu
        self.descartados = 0            # pedidos com o jogo fora da tela
        self.ultimo_bgra = None         # o BGRA entregue ao UpdateLayeredWindow no último alerta (prova)
        self.medidas = []               # ms do desenho + entrega de cada alerta (prova de custo)
        self._fila = queue.Queue()
        self._pronto = threading.Event()
        self._fio = None
        self._sup = None
        self._atual = None              # (cor, rotulo, t0, fim)
        self.ao_mostrar = None          # f(cor, rotulo, (x, y, l, a), espessura) a cada alerta exibido (vitrine)
        self._proc = WNDPROC(self._wndproc)   # referência viva: o GC não pode levar o callback

    def iniciar(self):
        if self._fio and self._fio.is_alive():
            return self
        self._fio = threading.Thread(target=self._laco, daemon=True, name="moldura")
        self._fio.start()
        if not self._pronto.wait(5) or not self.hwnd:
            raise RuntimeError("janela da moldura não nasceu")
        return self

    def mostrar(self, cor, rotulo, duracao=None, pulsos=None):
        """pulsos=1: um piscar só, UM_PULSO_S (o "voltou" azul); None: pulsando por `duracao` (DURACAO)"""
        self.iniciar()
        if pulsos == 1:
            duracao = duracao or UM_PULSO_S
        self._fila.put((cor, " ".join(str(rotulo).split()[:3]), duracao or self.DURACAO, pulsos))
        user32.PostMessageW(self.hwnd, WM_APP, 0, 0)

    def parar(self):
        if self.hwnd:
            user32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)
        if self._fio:
            self._fio.join(3)

    def estilo_ex(self):
        return user32.GetWindowLongW(self.hwnd, GWL_EXSTYLE) & 0xFFFFFFFF if self.hwnd else 0

    # ---- fio da janela
    def _laco(self):
        try:
            user32.SetThreadDpiAwarenessContext(DPI_PER_MONITOR_V2)
        except AttributeError:
            pass
        inst = kernel32.GetModuleHandleW(None)
        nome = f"lol-client-moldura-{id(self)}"
        try:
            wc = WNDCLASSW(lpfnWndProc=self._proc, hInstance=inst, lpszClassName=nome)
            user32.RegisterClassW(ctypes.byref(wc))
            # só UpdateLayeredWindow: misturar com SetLayeredWindowAttributes troca o modo da janela (ARMADILHAS)
            self.hwnd = user32.CreateWindowExW(ESTILO_EX, nome, "lol-client moldura", WS_POPUP,
                                               0, 0, 1, 1, None, None, inst, None)
            if not self.hwnd:
                raise OSError(f"CreateWindowExW falhou (erro {ctypes.get_last_error()})")
            if self.fora_do_print:   # a borda passa por cima da faixa (16,28,27) que o minimapa procura
                self.excluida = bool(user32.SetWindowDisplayAffinity(self.hwnd, WDA_EXCLUDEFROMCAPTURE))
            self._sup = _Superficie()
            user32.SetTimer(self.hwnd, 1, self.TICK_MS, None)
            self._pronto.set()
            msg = wt.MSG()
            while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
                user32.TranslateMessage(ctypes.byref(msg))
                user32.DispatchMessageW(ctypes.byref(msg))
        except Exception as e:   # exceção no fio da janela iria para o stderr (nenhum, na tarefa agendada)
            if self.log:
                self.log.warning("moldura: janela morreu: %s: %s", type(e).__name__, e)
        finally:
            self._pronto.set()
            if self._sup is not None:
                self._sup.fechar()
                self._sup = None
            self.hwnd = None
            user32.UnregisterClassW(nome, inst)

    def _area(self):
        if self.retangulo:
            return tuple(self.retangulo)
        j = janela_do_jogo()
        if j:
            return j[1]
        return (0, 0, user32.GetSystemMetrics(0), user32.GetSystemMetrics(1))   # forcar sem jogo: monitor principal

    def _novo(self):
        pedido = None
        while not self._fila.empty():           # vale o último pedido; o motor já escolheu a prioridade
            pedido = self._fila.get_nowait()
        if not pedido:
            return
        if not self.forcar and not janela_do_jogo():
            self.descartados += 1
            return
        cor, rotulo, dur, pulsos = pedido
        x, y, l, a = self._area()
        t0 = time.perf_counter()
        bgra = premultiplicar(renderizar(l, a, cor, rotulo, self.espessura))
        ok = self._sup.mostrar(self.hwnd, x, y, bgra, 255)
        self.ultimo_bgra = bgra
        if not ok and self.log:
            self.log.warning("moldura: UpdateLayeredWindow falhou (erro %d)", ctypes.get_last_error())
        user32.ShowWindow(self.hwnd, SW_SHOWNOACTIVATE)
        user32.SetWindowPos(self.hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE)
        self.medidas.append((time.perf_counter() - t0) * 1000)
        agora = time.monotonic()
        self._atual = (cor, rotulo, agora, agora + dur, pulsos)
        self.exibidos.append((agora, cor, rotulo))
        if self.ao_mostrar is not None:   # só enfileira (vitrine); nunca segura o fio da janela
            try:
                self.ao_mostrar(cor, rotulo, (x, y, l, a), self.espessura)
            except Exception as e:
                if self.log:
                    self.log.warning("moldura: gancho da vitrine falhou: %s", e)

    def _pulsar(self, agora):
        cor, rotulo, t0, fim, pulsos = self._atual
        if agora >= fim or (not self.forcar and not janela_do_jogo()):
            self._atual = None
            user32.ShowWindow(self.hwnd, SW_HIDE)
            return
        _Superficie.pulsar(self.hwnd, 255 * alfa_pulso(agora - t0, fim - t0, pulsos, self.CICLO))

    def _wndproc(self, hwnd, msg, wp, lp):
        try:
            if msg == WM_APP:
                self._novo()
                return 0
            if msg == WM_TIMER:
                if self._atual:
                    self._pulsar(time.monotonic())
                return 0
            if msg == WM_NCHITTEST:
                return HTTRANSPARENT
            if msg == WM_CLOSE:
                user32.DestroyWindow(hwnd)
                return 0
            if msg == WM_DESTROY:
                user32.KillTimer(hwnd, 1)
                user32.PostQuitMessage(0)
                return 0
        except Exception as e:   # exceção num callback do Windows some calada: registrar
            if self.log:
                self.log.warning("moldura: %s", e)
        return user32.DefWindowProcW(hwnd, msg, wp, lp)


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="mostra um alerta da moldura (teste manual)")
    ap.add_argument("cor", choices=sorted(CORES))
    ap.add_argument("rotulo")
    ap.add_argument("--forcar", action="store_true", help="desenha mesmo sem o jogo em primeiro plano")
    ap.add_argument("--retangulo", help="x,y,largura,altura em px físicos")
    a = ap.parse_args()
    ret = tuple(int(v) for v in a.retangulo.split(",")) if a.retangulo else None
    m = Moldura(forcar=a.forcar, retangulo=ret).iniciar()
    m.mostrar(a.cor, a.rotulo)
    time.sleep(Moldura.DURACAO + 0.5)
    print("exibidos:", len(m.exibidos), "| descartados (jogo fora da tela):", m.descartados,
          "| ms por alerta:", [round(x, 1) for x in m.medidas])
    m.parar()
