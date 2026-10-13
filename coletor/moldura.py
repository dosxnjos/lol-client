# moldura de alerta (plano v2, passo 15c): janela própria de tela inteira, transparente, sempre no
# topo e que ignora clique (WS_EX_LAYERED | TRANSPARENT | TOPMOST | TOOLWINDOW | NOACTIVATE, via
# ctypes). Desenha só uma borda colorida pulsando + um rótulo de até 3 palavras no canto, por ~2 s.
# Não toca no processo do jogo, não rouba o foco e só desenha com o jogo em primeiro plano (print
# do monitor com outra janela na frente seria alerta sobre nada: ARMADILHAS § Tela).
# uso: python coletor/moldura.py vermelho "jungler rio top" [--forcar] [--retangulo x,y,l,a]
import ctypes
import ctypes.wintypes as wt
import math
import queue
import threading
import time

TITULO_JOGO = "League of Legends (TM) Client"
CORES = {"vermelho": (235, 45, 45), "amarelo": (245, 200, 40), "azul": (60, 145, 255), "verde": (60, 200, 110)}
TEXTO_ESCURO = {"amarelo", "verde"}           # rótulo preto nas cores claras

WS_POPUP = 0x80000000
WS_EX_LAYERED, WS_EX_TRANSPARENT, WS_EX_TOPMOST = 0x00080000, 0x00000020, 0x00000008
WS_EX_TOOLWINDOW, WS_EX_NOACTIVATE = 0x00000080, 0x08000000
ESTILO_EX = WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
LWA_COLORKEY, LWA_ALPHA = 0x1, 0x2
SW_HIDE = 0
SWP_NOACTIVATE, SWP_SHOWWINDOW = 0x0010, 0x0040
HWND_TOPMOST = wt.HWND(-1)
WM_DESTROY, WM_PAINT, WM_CLOSE, WM_TIMER, WM_NCHITTEST, WM_APP = 0x0002, 0x000F, 0x0010, 0x0113, 0x0084, 0x8000
HTTRANSPARENT = -1
GWL_EXSTYLE = -20
WDA_EXCLUDEFROMCAPTURE = 0x11                 # Windows 10 2004+: some de print/gravação, segue na tela
CHAVE = 0x00FF00FF                            # magenta = transparente (COLORREF 0x00BBGGRR)
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


class PAINTSTRUCT(ctypes.Structure):
    _fields_ = [("hdc", wt.HDC), ("fErase", wt.BOOL), ("rcPaint", wt.RECT), ("fRestore", wt.BOOL),
                ("fIncUpdate", wt.BOOL), ("rgbReserved", ctypes.c_byte * 32)]


user32.DefWindowProcW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
user32.DefWindowProcW.restype = LRESULT
user32.CreateWindowExW.argtypes = [wt.DWORD, wt.LPCWSTR, wt.LPCWSTR, wt.DWORD, ctypes.c_int, ctypes.c_int,
                                   ctypes.c_int, ctypes.c_int, wt.HWND, wt.HMENU, wt.HINSTANCE, wt.LPVOID]
user32.CreateWindowExW.restype = wt.HWND
user32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASSW)]
user32.RegisterClassW.restype = wt.ATOM
user32.SetLayeredWindowAttributes.argtypes = [wt.HWND, wt.COLORREF, wt.BYTE, wt.DWORD]
user32.SetWindowPos.argtypes = [wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.UINT]
user32.GetForegroundWindow.restype = wt.HWND
user32.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
user32.GetWindowRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
user32.PostMessageW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
user32.SetTimer.argtypes = [wt.HWND, ctypes.c_size_t, wt.UINT, wt.LPVOID]
user32.GetWindowLongW.argtypes = [wt.HWND, ctypes.c_int]
user32.BeginPaint.argtypes = [wt.HWND, ctypes.POINTER(PAINTSTRUCT)]
user32.BeginPaint.restype = wt.HDC
user32.EndPaint.argtypes = [wt.HWND, ctypes.POINTER(PAINTSTRUCT)]
user32.FillRect.argtypes = [wt.HDC, ctypes.POINTER(wt.RECT), wt.HBRUSH]
user32.DrawTextW.argtypes = [wt.HDC, wt.LPCWSTR, ctypes.c_int, ctypes.POINTER(wt.RECT), wt.UINT]
user32.ShowWindow.argtypes = [wt.HWND, ctypes.c_int]
user32.DestroyWindow.argtypes = [wt.HWND]
user32.GetMessageW.argtypes = [ctypes.POINTER(wt.MSG), wt.HWND, wt.UINT, wt.UINT]
user32.TranslateMessage.argtypes = [ctypes.POINTER(wt.MSG)]
user32.DispatchMessageW.argtypes = [ctypes.POINTER(wt.MSG)]
user32.GetSystemMetrics.argtypes = [ctypes.c_int]
user32.InvalidateRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT), wt.BOOL]
user32.GetClientRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
user32.PostQuitMessage.argtypes = [ctypes.c_int]
user32.SetWindowDisplayAffinity.argtypes = [wt.HWND, wt.DWORD]
gdi32.CreateSolidBrush.argtypes = [wt.COLORREF]
gdi32.CreateSolidBrush.restype = wt.HBRUSH
gdi32.DeleteObject.argtypes = [wt.HGDIOBJ]
gdi32.SelectObject.argtypes = [wt.HDC, wt.HGDIOBJ]
gdi32.SelectObject.restype = wt.HGDIOBJ
gdi32.SetBkMode.argtypes = [wt.HDC, ctypes.c_int]
gdi32.SetTextColor.argtypes = [wt.HDC, wt.COLORREF]
gdi32.CreateFontW.argtypes = [ctypes.c_int] * 5 + [wt.DWORD] * 8 + [wt.LPCWSTR]
gdi32.CreateFontW.restype = wt.HFONT
kernel32.GetModuleHandleW.argtypes = [wt.LPCWSTR]
kernel32.GetModuleHandleW.restype = wt.HMODULE
try:
    user32.SetThreadDpiAwarenessContext.argtypes = [wt.HANDLE]
    user32.SetThreadDpiAwarenessContext.restype = wt.HANDLE
except AttributeError:  # Windows antigo: fica sem
    pass


def _rgb(c):
    r, g, b = CORES.get(c, c) if not isinstance(c, tuple) else c
    return r | (g << 8) | (b << 16)


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


class Moldura:
    """mostrar(cor, rotulo) pede um alerta (assíncrono, de qualquer fio). A janela vive num fio
    próprio com laço de mensagens; o pulso é a opacidade da janela inteira (~0,7 s por ciclo).
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
        self._fila = queue.Queue()
        self._pronto = threading.Event()
        self._fio = None
        self._atual = None              # (cor, rotulo, t0, fim)
        self._proc = WNDPROC(self._wndproc)   # referência viva: o GC não pode levar o callback

    def iniciar(self):
        if self._fio and self._fio.is_alive():
            return self
        self._fio = threading.Thread(target=self._laco, daemon=True, name="moldura")
        self._fio.start()
        if not self._pronto.wait(5):
            raise RuntimeError("janela da moldura não nasceu")
        return self

    def mostrar(self, cor, rotulo, duracao=None):
        self.iniciar()
        self._fila.put((cor, " ".join(str(rotulo).split()[:3]), duracao or self.DURACAO))
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
        wc = WNDCLASSW(lpfnWndProc=self._proc, hInstance=inst, lpszClassName=nome)
        user32.RegisterClassW(ctypes.byref(wc))
        self.hwnd = user32.CreateWindowExW(ESTILO_EX, nome, "lol-client moldura", WS_POPUP,
                                           0, 0, 1, 1, None, None, inst, None)
        user32.SetLayeredWindowAttributes(self.hwnd, CHAVE, 0, LWA_COLORKEY | LWA_ALPHA)
        if self.fora_do_print:   # a borda passa por cima da faixa (16,28,27) que o minimapa procura
            self.excluida = bool(user32.SetWindowDisplayAffinity(self.hwnd, WDA_EXCLUDEFROMCAPTURE))
        user32.SetTimer(self.hwnd, 1, self.TICK_MS, None)
        self._fonte = gdi32.CreateFontW(-40, 0, 0, 0, 700, 0, 0, 0, 0, 0, 0, 4, 0, "Segoe UI")
        self._pronto.set()
        msg = wt.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))
        gdi32.DeleteObject(self._fonte)
        self.hwnd = None

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
        cor, rotulo, dur = pedido
        x, y, l, a = self._area()
        agora = time.monotonic()
        self._atual = (cor, rotulo, agora, agora + dur)
        self.exibidos.append((agora, cor, rotulo))
        user32.SetWindowPos(self.hwnd, HWND_TOPMOST, x, y, l, a, SWP_NOACTIVATE | SWP_SHOWWINDOW)
        user32.InvalidateRect(self.hwnd, None, True)
        self._pulsar(agora)

    def _pulsar(self, agora):
        cor, rotulo, t0, fim = self._atual
        if agora >= fim or (not self.forcar and not janela_do_jogo()):
            self._atual = None
            user32.ShowWindow(self.hwnd, SW_HIDE)
            return
        alfa = 0.45 + 0.55 * (0.5 + 0.5 * math.cos(2 * math.pi * (agora - t0) / self.CICLO))
        user32.SetLayeredWindowAttributes(self.hwnd, CHAVE, int(255 * alfa), LWA_COLORKEY | LWA_ALPHA)

    def _pintar(self, hwnd):
        ps = PAINTSTRUCT()
        hdc = user32.BeginPaint(hwnd, ctypes.byref(ps))
        r = wt.RECT()
        user32.GetClientRect(hwnd, ctypes.byref(r))
        fundo = gdi32.CreateSolidBrush(CHAVE)
        user32.FillRect(hdc, ctypes.byref(r), fundo)
        gdi32.DeleteObject(fundo)
        if self._atual:
            cor, rotulo = self._atual[0], self._atual[1]
            e, w, h = self.espessura, r.right, r.bottom
            pincel = gdi32.CreateSolidBrush(_rgb(cor))
            for ret in ((0, 0, w, e), (0, h - e, w, h), (0, 0, e, h), (w - e, 0, w, h)):
                user32.FillRect(hdc, ctypes.byref(wt.RECT(*ret)), pincel)
            if rotulo:
                antiga = gdi32.SelectObject(hdc, self._fonte)
                medida = wt.RECT(0, 0, 0, 0)
                user32.DrawTextW(hdc, rotulo, -1, ctypes.byref(medida), 0x400 | 0x20)   # DT_CALCRECT | DT_SINGLELINE
                cx, cy = e + 24, e + 24
                caixa = wt.RECT(cx, cy, cx + medida.right + 36, cy + medida.bottom + 16)
                user32.FillRect(hdc, ctypes.byref(caixa), pincel)
                gdi32.SetBkMode(hdc, 1)                                                # TRANSPARENT
                gdi32.SetTextColor(hdc, 0x00101010 if cor in TEXTO_ESCURO else 0x00FFFFFF)
                user32.DrawTextW(hdc, rotulo, -1, ctypes.byref(caixa), 0x1 | 0x4 | 0x20)  # centro, vcentro, 1 linha
                gdi32.SelectObject(hdc, antiga)
            gdi32.DeleteObject(pincel)
        user32.EndPaint(hwnd, ctypes.byref(ps))

    def _wndproc(self, hwnd, msg, wp, lp):
        try:
            if msg == WM_APP:
                self._novo()
                return 0
            if msg == WM_TIMER:
                if self._atual:
                    self._pulsar(time.monotonic())
                return 0
            if msg == WM_PAINT:
                self._pintar(hwnd)
                return 0
            if msg == WM_NCHITTEST:
                return HTTRANSPARENT
            if msg == WM_CLOSE:
                user32.DestroyWindow(hwnd)
                return 0
            if msg == WM_DESTROY:
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
    print("exibidos:", len(m.exibidos), "| descartados (jogo fora da tela):", m.descartados)
    m.parar()
