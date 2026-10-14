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
# "recusar" (POST .../decline), por clique do Gabriel.
# Reserva do aceite (14/10/2026, o JS do plugin não aceitou com o timer em 10, 11 e 12): passado o mesmo alvo + FOLGA_S
# com playerResponse "None", o aceite automático ligado no espelho e sem "não aceitar" do plugin NESTE ready check
# (SinalPlugin, POST /aceite/plugin), o coletor relê o ready check e aceita sozinho, uma vez. É a única escrita
# automática do coletor na LCU. Com coach.aceiteFlutuante false a reserva roda sem janela (janela=False); sem a rota
# do plugin no ar (coletor.py _sinal_aceite None) ela nem arma (reserva=False). Outro ready check na mesma instância
# (timer que volta, 404 entre payloads) para a reserva: falha fechada.
#   python coletor/aviso_partida.py --demo [--atraso 10] [--segundos 12]   (LCU falsa, nada sai da máquina)
import ctypes
import ctypes.wintypes as wt
import json
import logging
import math
import threading
import time

log = logging.getLogger("coletor.aviso")

TITULO = "lol-client aviso de partida"
ROTA = "/lol-matchmaking/v1/ready-check"
LIMITE_S = 12          # janela do ready check (ARMADILHAS § ready-check; espelha PADRAO.aceite.limiteS)
VIDA_MAX_S = 20        # se o coletor não fechar (websocket caiu), a janela se fecha sozinha
# folga depois do alvo do aceite automático antes de concluir que ele não veio e a reserva aceitar (uma constante só
# para a tela e para a reserva). Medido em 14/10/2026 (dados/medicao-compacto-2026-10-13.jsonl, ready check das
# 10:10:21): o evento com timer 10 chega ~9,8 s depois da fase, o timer 12 em ~+12,0 s e a fase sai em ~+13,0 s.
# Estimado, não medido: o aceite do plugin aparece no GET até ~+10,4 s (13/10: o plugin aceitou com timer 10,0 em 3/3,
# mais uma consulta). A reserva tem de agir depois de ~10,5 (a releitura vê o Accepted do plugin) e antes de ~11,5
# (o POST chega antes do timer 12): folga em [0,5; 1,0], 0,7 no meio
FOLGA_S = 0.7
TOLERANCIA_S = FOLGA_S
CONSULTA_S = 0.5
# "não aceitar" do plugin vale para o ready check em que chegou: aceito até 1 s antes do coletor ver a fase (o plugin
# pode receber o evento antes); um "não aceitar" mais velho é de outro ready check
SINAL_ANTES_S = 1.0
# idade mínima do aviso antes da reserva aceitar: coletor que sobe (ou reconecta) já passado o alvo + folga espera ao
# menos um evento do plugin (~1/s) chegar, para um "não aceitar" dele ainda valer
IDADE_MIN_S = 1.5
# prazo do POST da reserva (a consulta e a janelinha param enquanto ele roda; fechar() espera 3 s)
POST_RESERVA_S = 3
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


def alvo_aceite(atraso_s, limite_s=LIMITE_S):
    """segundos do ready check em que o plugin aceita (pengu/aceite.js decidir): min(atraso, limite − 2); None = desligado"""
    if atraso_s is None:
        return None
    return max(0.0, min(float(atraso_s), limite_s - 2))


def decidir_reserva(rc, alvo_s, decorrido_s, bloqueio=None, folga_s=FOLGA_S):
    """reserva do aceite: o que fazer agora -> {"acao": "esperar", "emS": float} | {"acao": "aceitar"} |
    {"acao": "parar", "motivo": str}. rc = payload do GET do ready check (None = não leu: espera; quem decide o POST
    é a releitura logo antes dele); alvo_s = alvo_aceite do espelho (None = aceite automático desligado);
    bloqueio = motivo do plugin para não aceitar nesta vez (SinalPlugin.bloqueio), ou None."""
    if alvo_s is None:
        return {"acao": "parar", "motivo": "aceite automático desligado"}
    if bloqueio:
        return {"acao": "parar", "motivo": bloqueio}
    if rc is not None:
        if not isinstance(rc, dict) or rc.get("state") != "InProgress":
            return {"acao": "parar", "motivo": "sem ready check em andamento"}
        resp = rc.get("playerResponse")
        if resp != "None":
            return {"acao": "parar", "motivo": {"Accepted": "já aceita", "Declined": "recusada"}.get(resp, f"resposta {resp}")}
    em = float(alvo_s) + folga_s - max(0.0, float(decorrido_s or 0))
    if em > 0 or rc is None:
        return {"acao": "esperar", "emS": max(0.0, em)}
    return {"acao": "aceitar"}


class SinalPlugin:
    """o que o plugin (pengu/aceite.js) disse ao coletor por POST /aceite/plugin. atrasoS/limiteS: vale o último (só
    atrasa a reserva, ver alvo()). "não aceitar" (desligadoNestaVez) e "aceite desligado" (ligado false): valem só no
    ready check em que chegaram (recebidos depois do início dele menos SINAL_ANTES_S) e o coletor zera ao sair da fase
    (zerar()); o aceite desligado de forma duradoura chega pelo espelho da config (aceiteAtrasoS null), não por aqui,
    para um sinal velho nunca travar a reserva com o JS do plugin morto. Thread-safe: o servidor escreve, a reserva lê."""

    def __init__(self, relogio=time.monotonic):
        self.relogio = relogio
        self._trava = threading.Lock()
        self.atraso_s = None
        self.limite_s = None
        self.nao_aceitar_em = None   # relógio do último "não aceitar" (desligadoNestaVez true)
        self.desligado_em = None     # relógio do último ligado false
        self.ultimo_em = None        # relógio do último sinal qualquer (o JS do plugin estava vivo)

    def registrar(self, corpo):
        """corpo do POST (dict já validado em tipo pelo chamador ou não): guarda o que serve à reserva"""
        agora = self.relogio()
        with self._trava:
            self.ultimo_em = agora
            fim = corpo.get("evento") == "fim"
            # ligado false trava a reserva neste ready check; só o fim dele (ou zerar()) destrava: os POSTs do plugin
            # são concorrentes, e um evento com ligado true enviado antes do clique pode chegar depois do ligado false
            if corpo.get("ligado") is False:
                self.desligado_em = agora
            elif corpo.get("ligado") is True and fim:
                self.desligado_em = None
            a, lim = corpo.get("atrasoS"), corpo.get("limiteS")
            if isinstance(a, (int, float)) and not isinstance(a, bool) and 0 <= a <= 60:
                self.atraso_s = float(a)
            if isinstance(lim, (int, float)) and not isinstance(lim, bool) and 2 <= lim <= 60:
                self.limite_s = float(lim)
            d = corpo.get("desligadoNestaVez")
            if d is True:
                self.nao_aceitar_em = agora
            elif d is False and fim:
                self.nao_aceitar_em = None

    def zerar(self):
        """fim do ready check (fase saiu de ReadyCheck): o "não aceitar" não passa para o próximo"""
        with self._trava:
            self.nao_aceitar_em = self.desligado_em = None

    def bloqueio(self, inicio):
        """motivo para a reserva não aceitar neste ready check (iniciado em `inicio`, mesmo relógio), ou None"""
        with self._trava:
            if self.desligado_em is not None and self.desligado_em >= inicio - SINAL_ANTES_S:
                return "aceite automático desligado no plugin"
            if self.nao_aceitar_em is not None and self.nao_aceitar_em >= inicio - SINAL_ANTES_S:
                return "não aceitar nesta vez (plugin)"
        return None

    def idade_ultimo(self):
        """segundos desde o último sinal do plugin (diagnóstico do log da reserva), ou None se nunca veio"""
        with self._trava:
            return None if self.ultimo_em is None else self.relogio() - self.ultimo_em

    def alvo(self, atraso_s):
        """alvo da reserva: o mais tardio entre o espelho da config e o último que o plugin mandou (o espelho pode estar
        velho; esperar o mais tardio nunca aceita antes do que o Gabriel escolheu)"""
        a = alvo_aceite(atraso_s)
        with self._trava:
            if a is not None and self.atraso_s is not None:
                a = max(a, alvo_aceite(self.atraso_s, self.limite_s or LIMITE_S))
        return a


# diagnóstico do aceite do plugin (POST /aceite/plugin): cada decisão do pengu/aceite.js vira uma linha no coletor.log
# para a próxima falha dizer se o JS estava vivo no ready check. Só estas chaves, só valor simples, texto cortado.
CAMPOS_DIAG = ("evento", "timer", "playerResponse", "state", "emS", "status", "detalhe", "ligado", "desligadoNestaVez",
               "atrasoS", "limiteS", "hidden", "visibilityState", "foco")
log_plugin = logging.getLogger("coletor.aceite")


def linha_diag(corpo):
    """corpo do POST /aceite/plugin -> 'evento=x timer=3 ...' (só CAMPOS_DIAG presentes, valores simples)"""
    partes = []
    for k in CAMPOS_DIAG:
        v = corpo.get(k)
        if v is None or isinstance(v, (dict, list)):
            continue
        v = str(v).replace("\r", " ").replace("\n", " ")[:120]   # nada de linha forjada no log
        partes.append(f"{k}={v}")
    return " ".join(partes)


def rota_aceite(sinal):
    """POST /aceite/plugin {evento, desligadoNestaVez, ligado, atrasoS, limiteS, timer, ...} -> (status, dict).
    Pendurada em ServidorLocal.rotas_post["/aceite/"] (coletor.py); origem: servidor_local.origem_aceite_ok."""
    def f(rota, bruto):
        if rota != "/aceite/plugin":
            return 404, {"erro": "não existe"}
        try:
            corpo = json.loads(bruto or b"{}")
        except ValueError:
            return 400, {"erro": "json inválido"}
        if not isinstance(corpo, dict):
            return 400, {"erro": "corpo não é objeto"}
        sinal.registrar(corpo)
        log_plugin.info("aceite (plugin): %s", linha_diag(corpo))
        return 200, {"ok": True}
    return f


class AvisoPartida:
    """mostrar() sobe a janela numa thread própria (laço de mensagens do Windows) e a consulta do ready check
    noutra; fechar() para as duas e espera. Uma instância por ready check. lcu: get(caminho) e post(caminho).
    sinal: SinalPlugin compartilhado (None = sem sinal do plugin: vale só o espelho). janela=False: só a consulta e a
    reserva (coach.aceiteFlutuante desligado). reserva=False: só a janela (prova do alerta)."""

    def __init__(self, lcu, atraso_s=None, relogio=time.monotonic, vida_max_s=VIDA_MAX_S, consulta_s=CONSULTA_S,
                 sinal=None, janela=True, reserva=True, folga_s=FOLGA_S, idade_min_s=IDADE_MIN_S):
        self.lcu = lcu
        self.atraso_s = atraso_s
        self.relogio = relogio
        self.vida_max_s = vida_max_s
        self.consulta_s = consulta_s
        self.sinal = sinal
        self.janela = janela
        self.reserva = reserva
        self.folga_s = folga_s
        self.idade_min_s = idade_min_s
        self.hwnd = None
        self.rc = None              # último payload lido
        self.inicio = None          # relógio local do início do ready check (min de t_leitura − timer)
        self.clicado = None         # "aceitar" | "recusar" depois do clique (ou da reserva)
        self.erro = None            # texto curto quando o POST falhou
        self.postados = []          # rotas que o clique ou a reserva chamou (prova)
        self.reserva_fim = None     # None = armada; "aceitou" | "falhou" | motivo de não ter agido
        self.recusou = False        # o Gabriel clicou "recusar" neste ready check (a reserva não aceita por cima)
        self._ultimo_timer = None   # último timer lido: se voltar, é outro ready check (a reserva para)
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
        self._fio_lcu.start()
        if self.janela:
            self._fio_tk = threading.Thread(target=self._laco, name="aviso-partida", daemon=True)
            self._fio_tk.start()
        else:
            self._pronto.set()
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

    def _alvo(self):
        """alvo do aceite automático neste ready check (None = desligado no espelho)"""
        return self.sinal.alvo(self.atraso_s) if self.sinal else alvo_aceite(self.atraso_s)

    def _bloqueio(self):
        # pelo início do ready check (ancorado no timer da LCU), não pela hora em que este aviso nasceu: com o websocket
        # reconectado no meio, um "não aceitar" de antes do aviso ainda vale
        inicio = self.inicio if self.inicio is not None else self.relogio()
        return self.sinal.bloqueio(inicio) if self.sinal else None

    def estado(self):
        decorrido = self.relogio() - (self.inicio if self.inicio is not None else self.relogio())
        # "não aceitar" do plugin nesta vez ou aceite desligado nele: a janelinha não promete aceite (conta até expirar)
        alvo = None if self._bloqueio() else self._alvo()
        e = texto_aviso(self.rc, alvo, decorrido)
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
                        # outro ready check na mesma instância (fase Matchmaking perdida ou atrasada): o início abaixo
                        # nunca anda para frente, então a reserva aceitaria cedo demais. Falha fechada: para. Só o timer
                        # que volta conta: 404 passageiro no MESMO ready check acontece (14/10 11:27, logo depois do
                        # aceite do plugin) e, com o plugin morto, faria a reserva desistir sem aceitar
                        # o timer também recua 1 s logo depois do aceite (14/10 14:43, 10 -> 9): respondido não é outro
                        if (self.reserva_fim is None and self._ultimo_timer is not None and t < self._ultimo_timer
                                and rc.get("playerResponse") in (None, "None")):
                            self._reserva_fim("outro ready check", self.relogio() - self.inicio)
                        self._ultimo_timer = t
                        # timer em segundos inteiros: o início real fica no máximo 1 s antes deste
                        self.inicio = min(self.inicio, self.relogio() - float(t))
                    self.rc = rc
            except Exception:
                # 404 (passageiro ou fim do ready check) ou client recarregando: a contagem segue pelo relógio
                pass
            espera = self.consulta_s
            try:
                em = self._reserva_passo()
                if em is not None:   # acorda na hora do alvo + folga, não até 0,5 s depois
                    espera = max(0.02, min(espera, em))
            except Exception as e:   # a reserva nunca derruba a contagem da janelinha
                self.reserva_fim = self.reserva_fim or "falhou"
                log.warning("reserva do aceite: %s: %s", type(e).__name__, e)
            self._parar.wait(espera)

    def _reserva_passo(self):
        """um passo da reserva: None = nada mais a fazer; número = segundos até a próxima conferência"""
        if not self.reserva or self.reserva_fim is not None or self.clicado:
            return None
        decorrido = self.relogio() - self.inicio
        if self.recusou:   # "recusar" da janelinha cujo POST falhou: botões voltam, mas a reserva nunca aceita por cima
            self._reserva_fim("recusar da janelinha (POST falhou)", decorrido)
            return None
        d = decidir_reserva(self.rc, self._alvo(), decorrido, self._bloqueio(), self.folga_s)
        if d["acao"] == "esperar":   # 0 = passou do alvo sem nenhuma leitura ainda: segue o ritmo normal da consulta
            return d["emS"] or None
        if d["acao"] == "parar":     # final neste ready check; o log diz quando (ex.: "já aceita; 10.1 s" = o plugin agiu)
            self._reserva_fim(d["motivo"], decorrido)
            return None
        idade = self.relogio() - self._t0
        if idade < self.idade_min_s:   # aviso recém-nascido (coletor subiu tarde): dá tempo de um sinal do plugin chegar
            return self.idade_min_s - idade
        # passou do alvo + folga e o ready check segue sem resposta: relê agora (o plugin ou o Gabriel podem ter
        # respondido no último meio segundo; fora de InProgress, 404 ou leitura falha = não aceita)
        try:
            atual = self.lcu.get(ROTA, timeout=2)
        except Exception as e:
            self._reserva_fim(f"releitura falhou ({type(e).__name__})", decorrido)
            return None
        if not isinstance(atual, dict):
            self._reserva_fim("releitura vazia", decorrido)
            return None
        self.rc = atual
        d = decidir_reserva(atual, self._alvo(), decorrido, self._bloqueio(), folga_s=0)
        if d["acao"] != "aceitar" or self.clicado or self._parar.is_set():
            self._reserva_fim(d.get("motivo") or ("clique do Gabriel em voo" if self.clicado else "aviso fechado"),
                              decorrido)
            return None
        self.reserva_fim = "aceitando"
        ok = self._postar("aceitar", "reserva")
        self.reserva_fim = "aceitou" if ok else "falhou"
        return None

    def _reserva_fim(self, motivo, decorrido):
        self.reserva_fim = motivo
        log.info("reserva do aceite: não agiu (%s; %.1f s do ready check)", motivo, decorrido)

    def _postar(self, acao, origem):
        """POST accept/decline; origem "janelinha" (clique) ou "reserva". -> True se o client respondeu 2xx"""
        self.clicado = acao
        self.erro = None
        rota = f"{ROTA}/{'accept' if acao == 'aceitar' else 'decline'}"
        self.postados.append(rota)
        try:
            if origem == "reserva":   # na thread da consulta: prazo curto para não congelar a contagem nem o fechar()
                self.lcu.post(rota, timeout=POST_RESERVA_S)
            else:
                self.lcu.post(rota)
        except Exception as e:
            self.erro = "o client não respondeu"
            self.clicado = None   # deixa tentar de novo pelo botão
            log.warning("aviso de partida: POST %s (%s) falhou: %s: %s", rota, origem, type(e).__name__, e)
            return False
        if origem == "reserva":
            idade = self.sinal.idade_ultimo() if self.sinal else None
            log.info("aceite pela reserva do coletor (plugin não aceitou; %.1f s do ready check; %s)",
                     self.relogio() - self.inicio,
                     "nenhum sinal do plugin" if idade is None else f"último sinal do plugin há {idade:.1f} s")
        else:
            log.info("aviso de partida: %s pela janelinha", "aceita" if acao == "aceitar" else "recusada")
        return True

    def _clicar(self, acao):
        if self.clicado or not (self.exibido or {}).get("botoes", True):
            return
        self.clicado = acao   # já aqui: o 2º clique e a reserva veem o POST em voo antes da thread começar
        self.recusou = self.recusou or acao == "recusar"   # vale o ready check inteiro, mesmo se o POST falhar
        threading.Thread(target=self._postar, args=(acao, "janelinha"), name="aviso-partida-post", daemon=True).start()

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
