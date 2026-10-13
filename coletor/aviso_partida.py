# aviso de partida encontrada fora do client (plano voz/foco, passo 2b): janelinha Win32 (ctypes, como a
# moldura.py) no canto inferior direito da tela principal, sempre por cima e SEM roubar o foco
# (WS_EX_NOACTIVATE | TOPMOST | TOOLWINDOW, mostrada com SWP_NOACTIVATE, WM_MOUSEACTIVATE -> MA_NOACTIVATE).
# Não é Tk: medido em 13/10/2026, o Tk ativa a própria janela ao nascer (com wrapper ou embutido em janela
# NOACTIVATE) e, num processo com direito de primeiro plano, a 1ª janelinha roubava o foco.
# Vive só no ReadyCheck: o coletor.py liga na fase e fecha quando ela sai (e ela se fecha sozinha em 20 s: o
# ready check dura 12). Mostra a contagem até o aceite automático do plugin (coach.aceiteAtrasoS, espelhado)
# ou, sem ele, até o ready check expirar; o espelho pode estar velho (plugin fora do ar, "não aceitar" no
# overlay), então passado o alvo + TOLERANCIA_S sem playerResponse a janelinha para de prometer, volta a
# "expira em N s" e avisa em vermelho que o aceite não veio. Dois botões: "aceitar agora" (POST .../accept) e
# "recusar" (POST .../decline). É a única escrita do coletor na LCU, e só por clique do Gabriel.
#   python coletor/aviso_partida.py --demo [--atraso 10] [--segundos 12]   (LCU falsa, nada sai da máquina)
import ctypes
import ctypes.wintypes as wt
import logging
import math
import threading
import time

log = logging.getLogger("coletor.aviso")

TITULO = "lol-client aviso de partida"
ROTA = "/lol-matchmaking/v1/ready-check"
LIMITE_S = 12          # janela do ready check (ARMADILHAS § ready-check; espelha PADRAO.aceite.limiteS)
VIDA_MAX_S = 20        # se o coletor não fechar (websocket caiu), a janela se fecha sozinha
# folga depois do alvo do aceite automático antes de concluir que ele não veio: o início estimado pelo
# `timer` inteiro erra até 1 s e a consulta é a cada 0,5 s; com o alvo padrão (10 s de 12), 2 s de folga
# só avisaria na hora de expirar
TOLERANCIA_S = 1.0
CONSULTA_S = 0.5
# cores do painel (painel/painel.css :root)
COR = {"fundo": "#0b0e13", "bloco": "#141922", "borda": "#2e3848", "texto": "#eef2f7", "suave": "#8d97a6",
       "verde": "#3ccf6e", "vermelho": "#ff5a52", "verde_claro": "#5ee08a", "cinza": "#232b38",
       "cinza_claro": "#3a2326"}
# medidas em px lógicos (96 dpi); a janela escala pelo DPI do monitor
LARG, ALT, MARGEM, BORDA, PAD = 340, 168, 24, 2, 18
BOT_ALT, BOT_ESPACO = 46, 12

GWL_EXSTYLE = -20
WS_POPUP = 0x80000000
WS_EX_TOPMOST, WS_EX_TOOLWINDOW, WS_EX_NOACTIVATE = 0x00000008, 0x00000080, 0x08000000
ESTILO_EX = WS_EX_NOACTIVATE | WS_EX_TOPMOST | WS_EX_TOOLWINDOW
SWP_NOACTIVATE, SWP_SHOWWINDOW = 0x10, 0x40
SPI_GETWORKAREA = 0x30
DPI_PER_MONITOR_V2 = -4
WM_DESTROY, WM_PAINT, WM_CLOSE, WM_ERASEBKGND, WM_SETCURSOR = 0x0002, 0x000F, 0x0010, 0x0014, 0x0020
WM_MOUSEACTIVATE, WM_TIMER, WM_MOUSEMOVE, WM_LBUTTONDOWN, WM_LBUTTONUP = 0x0021, 0x0113, 0x0200, 0x0201, 0x0202
WM_MOUSELEAVE, WM_APP = 0x02A3, 0x8000
MA_NOACTIVATE = 3
IDC_ARROW, IDC_HAND = 32512, 32649
TME_LEAVE = 0x2
DT_CENTER, DT_VCENTER, DT_SINGLELINE, DT_LEFT, DT_END_ELLIPSIS = 0x1, 0x4, 0x20, 0x0, 0x8000

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


class TRACKMOUSEEVENT(ctypes.Structure):
    _fields_ = [("cbSize", wt.DWORD), ("dwFlags", wt.DWORD), ("hwndTrack", wt.HWND), ("dwHoverTime", wt.DWORD)]


user32.DefWindowProcW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
user32.DefWindowProcW.restype = LRESULT
user32.CreateWindowExW.argtypes = [wt.DWORD, wt.LPCWSTR, wt.LPCWSTR, wt.DWORD, ctypes.c_int, ctypes.c_int,
                                   ctypes.c_int, ctypes.c_int, wt.HWND, wt.HMENU, wt.HINSTANCE, wt.LPVOID]
user32.CreateWindowExW.restype = wt.HWND
user32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASSW)]
user32.RegisterClassW.restype = wt.ATOM
user32.UnregisterClassW.argtypes = [wt.LPCWSTR, wt.HINSTANCE]
user32.SetWindowPos.argtypes = [wt.HWND, wt.HWND, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int, wt.UINT]
user32.PostMessageW.argtypes = [wt.HWND, wt.UINT, wt.WPARAM, wt.LPARAM]
user32.SetTimer.argtypes = [wt.HWND, ctypes.c_size_t, wt.UINT, wt.LPVOID]
user32.BeginPaint.argtypes = [wt.HWND, ctypes.POINTER(PAINTSTRUCT)]
user32.BeginPaint.restype = wt.HDC
user32.EndPaint.argtypes = [wt.HWND, ctypes.POINTER(PAINTSTRUCT)]
user32.FillRect.argtypes = [wt.HDC, ctypes.POINTER(wt.RECT), wt.HBRUSH]
user32.DrawTextW.argtypes = [wt.HDC, wt.LPCWSTR, ctypes.c_int, ctypes.POINTER(wt.RECT), wt.UINT]
user32.DestroyWindow.argtypes = [wt.HWND]
user32.GetMessageW.argtypes = [ctypes.POINTER(wt.MSG), wt.HWND, wt.UINT, wt.UINT]
user32.TranslateMessage.argtypes = [ctypes.POINTER(wt.MSG)]
user32.DispatchMessageW.argtypes = [ctypes.POINTER(wt.MSG)]
user32.InvalidateRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT), wt.BOOL]
user32.GetClientRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
user32.PostQuitMessage.argtypes = [ctypes.c_int]
user32.SystemParametersInfoW.argtypes = [wt.UINT, wt.UINT, ctypes.c_void_p, wt.UINT]
user32.LoadCursorW.argtypes = [wt.HINSTANCE, wt.LPVOID]
user32.LoadCursorW.restype = wt.HANDLE
user32.SetCursor.argtypes = [wt.HANDLE]
user32.TrackMouseEvent.argtypes = [ctypes.POINTER(TRACKMOUSEEVENT)]
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
    user32.GetDpiForWindow.argtypes = [wt.HWND]
except AttributeError:  # Windows antigo: fica em 96 dpi
    pass


def _ref(hexa):
    """'#rrggbb' -> COLORREF (0x00BBGGRR)"""
    r, g, b = int(hexa[1:3], 16), int(hexa[3:5], 16), int(hexa[5:7], 16)
    return r | (g << 8) | (b << 16)


def texto_aviso(rc, atraso_s, decorrido_s, limite_s=LIMITE_S):
    """o que a janelinha mostra -> {"linha": str, "botoes": bool, "segundos": int|None, "fase": str[, "sub": str]}
    ("sub" = 2ª linha menor, no lugar dos botões).
    rc = payload de GET /lol-matchmaking/v1/ready-check (None = ainda não leu ou 404);
    atraso_s = coach.aceiteAtrasoS (None = aceite automático desligado); decorrido_s = segundos desde o
    início do ready check. O alvo do aceite espelha o plugin (pengu/aceite.js decidir): min(atraso, limite − 2)."""
    resp = (rc or {}).get("playerResponse") or "None"
    if resp == "Accepted":
        return {"linha": "aceita", "sub": "esperando os outros", "botoes": False, "segundos": None, "fase": "aceita"}
    if resp == "Declined":
        return {"linha": "recusada", "botoes": False, "segundos": None, "fase": "recusada"}
    decorrido = max(0.0, float(decorrido_s or 0))
    falhou = False
    if atraso_s is not None:
        alvo = max(0.0, min(float(atraso_s), limite_s - 2))
        falta = math.ceil(alvo - decorrido - 1e-9)
        if falta > 0:
            return {"linha": f"aceito em {falta} s", "botoes": True, "segundos": falta, "fase": "contando"}
        if decorrido < alvo + TOLERANCIA_S:
            return {"linha": "aceitando…", "botoes": True, "segundos": 0, "fase": "aceitando"}
        # o alvo passou e o ready check segue sem resposta: o aceite automático não veio (plugin fora do ar,
        # POST /config que nunca chegou, "não aceitar" no overlay). Para de prometer e conta até expirar.
        falhou = True
    falta = max(0, math.ceil(limite_s - decorrido - 1e-9))
    e = {"linha": f"expira em {falta} s", "botoes": True, "segundos": falta, "fase": "expirando"}
    if falhou:
        e.update(fase="sem_aceite", alerta="o aceite automático não veio: clique")
    return e


class AvisoPartida:
    """mostrar() sobe a janela numa thread própria (laço de mensagens do Windows) e a consulta do ready check
    noutra; fechar() para as duas e espera. Uma instância por ready check. lcu: get(caminho) e post(caminho)."""

    def __init__(self, lcu, atraso_s=None, relogio=time.monotonic, vida_max_s=VIDA_MAX_S, consulta_s=CONSULTA_S):
        self.lcu = lcu
        self.atraso_s = atraso_s
        self.relogio = relogio
        self.vida_max_s = vida_max_s
        self.consulta_s = consulta_s
        self.hwnd = None
        self.rc = None              # último payload lido
        self.inicio = None          # relógio local do início do ready check (min de t_leitura − timer)
        self.clicado = None         # "aceitar" | "recusar" depois do clique
        self.erro = None            # texto curto quando o POST falhou
        self.postados = []          # rotas que o clique chamou (prova)
        self.exibido = None         # último estado desenhado
        self.botoes = {}            # nome -> RECT em px do cliente (o teste clica no meio)
        self._hover = None
        self._parar = threading.Event()
        self._pronto = threading.Event()
        self._fio_tk = self._fio_lcu = None
        self._t0 = None
        self._proc = WNDPROC(self._wndproc)   # referência viva: o GC não pode levar o callback

    # -- ciclo de vida --
    def mostrar(self):
        """não bloqueia: a janela aparece em ~0,1 s"""
        if self._fio_tk and self._fio_tk.is_alive():
            return self
        self._t0 = self.relogio()
        self.inicio = self._t0
        self._parar.clear()
        self._fio_lcu = threading.Thread(target=self._consultar, name="aviso-partida-lcu", daemon=True)
        self._fio_tk = threading.Thread(target=self._laco, name="aviso-partida", daemon=True)
        self._fio_lcu.start()
        self._fio_tk.start()
        return self

    def esperar_pronto(self, s=5):
        return self._pronto.wait(s)

    def fechar(self, espera_s=3):
        self._parar.set()
        if self.hwnd:
            user32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)
        for f in (self._fio_tk, self._fio_lcu):
            if f is not None and f is not threading.current_thread():
                f.join(espera_s)

    def vivo(self):
        return any(f is not None and f.is_alive() for f in (self._fio_tk, self._fio_lcu))

    def estado(self):
        decorrido = self.relogio() - (self.inicio if self.inicio is not None else self.relogio())
        e = texto_aviso(self.rc, self.atraso_s, decorrido)
        if self.clicado and e["botoes"]:   # POST em voo: botões somem até o client responder
            e = {**e, "linha": "aceitando…" if self.clicado == "aceitar" else "recusando…", "botoes": False}
            e.pop("alerta", None)
        return e

    # -- LCU --
    def _consultar(self):
        while not self._parar.is_set():
            if self.relogio() - self._t0 > self.vida_max_s:
                log.info("aviso de partida: fechado sozinho após %d s", self.vida_max_s)
                self._parar.set()
                if self.hwnd:
                    user32.PostMessageW(self.hwnd, WM_CLOSE, 0, 0)
                break
            try:
                rc = self.lcu.get(ROTA, timeout=3)
                if isinstance(rc, dict):
                    t = rc.get("timer")
                    if isinstance(t, (int, float)) and not isinstance(t, bool):
                        # timer em segundos inteiros: o início real fica no máximo 1 s antes deste
                        self.inicio = min(self.inicio, self.relogio() - float(t))
                    self.rc = rc
            except Exception:
                pass   # 404 antes do payload chegar ou client recarregando: a contagem segue pelo relógio
            self._parar.wait(self.consulta_s)

    def _clicar(self, acao):
        if self.clicado or not (self.exibido or {}).get("botoes", True):
            return
        self.clicado = acao
        self.erro = None
        rota = f"{ROTA}/{'accept' if acao == 'aceitar' else 'decline'}"
        self.postados.append(rota)

        def postar():
            try:
                self.lcu.post(rota)
                log.info("aviso de partida: %s pela janelinha", "aceita" if acao == "aceitar" else "recusada")
            except Exception as e:
                self.erro = "o client não respondeu"
                self.clicado = None   # deixa tentar de novo
                log.warning("aviso de partida: POST %s falhou: %s: %s", rota, type(e).__name__, e)
        threading.Thread(target=postar, name="aviso-partida-post", daemon=True).start()

    # -- janela --
    def _laco(self):
        try:
            self._laco_win()
        except Exception as e:   # thread morta sem rastro: registrar (ARMADILHAS § Windows)
            log.warning("aviso de partida: janela morreu: %s: %s", type(e).__name__, e)
        finally:
            self.hwnd = None
            self._pronto.set()

    def _laco_win(self):
        try:   # px físicos só nesta thread (o processo do coletor fica como está)
            user32.SetThreadDpiAwarenessContext(wt.HANDLE(DPI_PER_MONITOR_V2))
        except AttributeError:
            pass
        inst = kernel32.GetModuleHandleW(None)
        nome = f"lol-client-aviso-{id(self)}"
        wc = WNDCLASSW(lpfnWndProc=self._proc, hInstance=inst, lpszClassName=nome,
                       hCursor=user32.LoadCursorW(None, wt.LPVOID(IDC_ARROW)))
        user32.RegisterClassW(ctypes.byref(wc))
        area = wt.RECT()
        user32.SystemParametersInfoW(SPI_GETWORKAREA, 0, ctypes.byref(area), 0)   # tela principal sem a barra
        # nasce escondida já com o estilo sem foco; tamanho final depois de saber o DPI do monitor
        self.hwnd = user32.CreateWindowExW(ESTILO_EX, nome, TITULO, WS_POPUP, area.right - 10, area.bottom - 10,
                                           1, 1, None, None, inst, None)
        try:
            dpi = user32.GetDpiForWindow(self.hwnd) or 96
        except AttributeError:
            dpi = 96
        self.esc = dpi / 96.0
        px = self._px
        larg, alt = px(LARG), px(ALT)
        x, y = area.right - larg - px(MARGEM), area.bottom - alt - px(MARGEM)
        self._fontes = {k: gdi32.CreateFontW(-int(round(pt * dpi / 72)), 0, 0, 0, peso, 0, 0, 0, 0, 0, 0, 5, 0,
                                             "Segoe UI")
                        for k, pt, peso in (("titulo", 10, 700), ("linha", 21, 700), ("botao", 13, 700),
                                            ("erro", 9, 400))}
        topo_bot = alt - px(PAD) - px(BOT_ALT)
        meio = (larg - 2 * px(PAD) - px(BOT_ESPACO)) * 58 // 100
        self.botoes = {"aceitar": wt.RECT(px(PAD), topo_bot, px(PAD) + meio, topo_bot + px(BOT_ALT)),
                       "recusar": wt.RECT(px(PAD) + meio + px(BOT_ESPACO), topo_bot, larg - px(PAD),
                                          topo_bot + px(BOT_ALT))}
        self.exibido = self.estado()
        user32.SetTimer(self.hwnd, 1, 100, None)
        # mostra e põe no topo sem ativar (nada de ShowWindow: o 1º do processo segue o STARTUPINFO)
        user32.SetWindowPos(self.hwnd, wt.HWND(-1), x, y, larg, alt, SWP_NOACTIVATE | SWP_SHOWWINDOW)
        self._pronto.set()
        msg = wt.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))
        for f in self._fontes.values():
            gdi32.DeleteObject(f)
        user32.UnregisterClassW(nome, inst)

    def _px(self, v):
        return int(round(v * getattr(self, "esc", 1.0)))

    def _no_botao(self, lp):
        x, y = ctypes.c_short(lp & 0xFFFF).value, ctypes.c_short((lp >> 16) & 0xFFFF).value
        if not (self.exibido or {}).get("botoes"):
            return None
        return next((n for n, r in self.botoes.items() if r.left <= x < r.right and r.top <= y < r.bottom), None)

    def _pintar(self, hwnd):
        ps = PAINTSTRUCT()
        hdc = user32.BeginPaint(hwnd, ctypes.byref(ps))
        try:
            r = wt.RECT()
            user32.GetClientRect(hwnd, ctypes.byref(r))
            px = self._px

            def caixa(ret, cor):
                b = gdi32.CreateSolidBrush(_ref(cor))
                user32.FillRect(hdc, ctypes.byref(ret), b)
                gdi32.DeleteObject(b)

            def texto(t, ret, fonte, cor, fmt):
                antiga = gdi32.SelectObject(hdc, self._fontes[fonte])
                gdi32.SetTextColor(hdc, _ref(cor))
                user32.DrawTextW(hdc, t, -1, ctypes.byref(ret), fmt)
                gdi32.SelectObject(hdc, antiga)

            caixa(r, COR["borda"])
            caixa(wt.RECT(px(BORDA), px(BORDA), r.right - px(BORDA), r.bottom - px(BORDA)), COR["bloco"])
            gdi32.SetBkMode(hdc, 1)   # TRANSPARENT
            e = self.exibido or {}
            x0, x1 = px(PAD), r.right - px(PAD)
            texto("PARTIDA ENCONTRADA", wt.RECT(x0, px(14), x1, px(34)), "titulo", COR["suave"],
                  DT_LEFT | DT_VCENTER | DT_SINGLELINE)
            texto(e.get("linha", ""), wt.RECT(x0, px(36), x1, px(80)), "linha", COR["texto"],
                  DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS)
            if e.get("sub") and not e.get("botoes"):
                b = self.botoes["aceitar"]
                texto(e["sub"], wt.RECT(x0, b.top, x1, b.bottom), "botao", COR["suave"],
                      DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS)
            aviso = self.erro or e.get("alerta")   # mesmo espaço, acima dos botões ("sub" só aparece sem eles)
            if aviso:
                texto(aviso, wt.RECT(x0, px(80), x1, px(98)), "erro", COR["vermelho"],
                      DT_LEFT | DT_VCENTER | DT_SINGLELINE | DT_END_ELLIPSIS)
            if e.get("botoes"):
                for nome, rot, cor, cor_hover, cor_txt in (
                        ("aceitar", "aceitar agora", COR["verde"], COR["verde_claro"], COR["fundo"]),
                        ("recusar", "recusar", COR["cinza"], COR["cinza_claro"], COR["texto"])):
                    ret = self.botoes[nome]
                    caixa(ret, cor_hover if self._hover == nome else cor)
                    texto(rot, wt.RECT(ret.left, ret.top, ret.right, ret.bottom), "botao", cor_txt,
                          DT_CENTER | DT_VCENTER | DT_SINGLELINE)
        finally:
            user32.EndPaint(hwnd, ctypes.byref(ps))

    def _wndproc(self, hwnd, msg, wp, lp):
        try:
            if msg == WM_MOUSEACTIVATE:
                return MA_NOACTIVATE        # clique não ativa a janela (o foco fica onde estava)
            if msg == WM_TIMER:
                if self._parar.is_set():
                    user32.DestroyWindow(hwnd)
                    return 0
                e = self.estado()
                if e != self.exibido:
                    self.exibido = e
                    user32.InvalidateRect(hwnd, None, False)
                return 0
            if msg == WM_ERASEBKGND:
                return 1                    # o WM_PAINT pinta tudo (sem piscar)
            if msg == WM_PAINT:
                self._pintar(hwnd)
                return 0
            if msg == WM_SETCURSOR:
                pos = wt.POINT()
                user32.GetCursorPos(ctypes.byref(pos))
                user32.ScreenToClient(hwnd, ctypes.byref(pos))
                sobre = self._no_botao((pos.x & 0xFFFF) | ((pos.y & 0xFFFF) << 16))
                user32.SetCursor(user32.LoadCursorW(None, wt.LPVOID(IDC_HAND if sobre else IDC_ARROW)))
                return 1
            if msg == WM_MOUSEMOVE:
                sobre = self._no_botao(lp)
                if sobre != self._hover:
                    self._hover = sobre
                    user32.InvalidateRect(hwnd, None, False)
                    tme = TRACKMOUSEEVENT(ctypes.sizeof(TRACKMOUSEEVENT), TME_LEAVE, hwnd, 0)
                    user32.TrackMouseEvent(ctypes.byref(tme))
                return 0
            if msg == WM_MOUSELEAVE:
                if self._hover:
                    self._hover = None
                    user32.InvalidateRect(hwnd, None, False)
                return 0
            if msg == WM_LBUTTONUP:
                alvo = self._no_botao(lp)
                if alvo:
                    self._clicar(alvo)
                    self.exibido = self.estado()
                    user32.InvalidateRect(hwnd, None, False)
                return 0
            if msg == WM_CLOSE:
                self._parar.set()
                user32.DestroyWindow(hwnd)
                return 0
            if msg == WM_DESTROY:
                user32.PostQuitMessage(0)
                return 0
        except Exception as e:   # exceção num callback do Windows some calada: registrar
            log.warning("aviso de partida: %s: %s", type(e).__name__, e)
        return user32.DefWindowProcW(hwnd, msg, wp, lp)

    def clicar_por_mensagem(self, botao):
        """prova: manda WM_LBUTTONDOWN/UP no meio do botão (mesmo caminho do clique real, sem mexer no mouse)"""
        r = self.botoes[botao]
        lp = ((r.left + r.right) // 2) | (((r.top + r.bottom) // 2) << 16)
        # o Windows reescala as coordenadas do clique postado por thread sem DPI para a janela com DPI
        # (125% aqui: o meio do botão caía 25% mais abaixo); posta no mesmo contexto da janela
        antigo = None
        try:
            antigo = user32.SetThreadDpiAwarenessContext(wt.HANDLE(DPI_PER_MONITOR_V2))
        except AttributeError:
            pass
        try:
            user32.PostMessageW(self.hwnd, WM_LBUTTONDOWN, 1, lp)
            user32.PostMessageW(self.hwnd, WM_LBUTTONUP, 0, lp)
        finally:
            if antigo:
                user32.SetThreadDpiAwarenessContext(antigo)


user32.GetCursorPos.argtypes = [ctypes.POINTER(wt.POINT)]
user32.ScreenToClient.argtypes = [wt.HWND, ctypes.POINTER(wt.POINT)]


class _LCUDemo:
    """ready check falso para o --demo: nada vai ao client"""

    def __init__(self):
        self.t0 = time.monotonic()
        self.resp = "None"

    def get(self, caminho, timeout=None):
        return {"state": "InProgress", "playerResponse": self.resp, "timer": int(time.monotonic() - self.t0)}

    def post(self, caminho, corpo=None, timeout=None):
        print("POST (falso):", caminho)
        self.resp = "Accepted" if caminho.endswith("accept") else "Declined"


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser(description="mostra a janelinha com um ready check falso")
    ap.add_argument("--demo", action="store_true")
    ap.add_argument("--atraso", type=float, default=10, help="atraso do aceite automático (-1 = desligado)")
    ap.add_argument("--segundos", type=float, default=12)
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO)
    av = AvisoPartida(_LCUDemo(), None if a.atraso < 0 else a.atraso).mostrar()
    av.esperar_pronto()
    time.sleep(a.segundos)
    av.fechar()
    print("vivo depois de fechar:", av.vivo())
