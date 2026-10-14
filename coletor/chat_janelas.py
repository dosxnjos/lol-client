# chat fora do client (plano do client compacto, passo 6 / tela 5): lista de amigos e uma janela por conversa,
# cada uma uma janela do Edge em modo app servida pelo servidor local (127.0.0.1:8765, rotas /chat/*).
# Quem fala com a LCU é o coletor (credencial do lockfile, só em memória); as páginas só veem JSON limpo:
# sem senha da LCU, sem password/mucJwtDto das salas, sem sala de grupo (champ select, pós-jogo, personalizada).
#
# Regras (plano § Abordagem, tela 5):
#   - até MAX_CONVERSAS conversas abertas; a 4ª fecha a mais antiga;
#   - mensagem nova de quem não tem janela abre a dele SOZINHA só em FASES_ABRE_SOZINHO e só com o client
#     compacto ligado (o plugin avisa por POST /chat/plugin); sem aviso do plugin ainda (coletor reiniciou), vale a
#     lista de amigos já aberta nesta sessão; {compacto: false} nunca abre (abre_sozinha_ligado). Nas outras fases
#     (fila, ready check, seleção, partida) só conta no 💬 e abre quando a fase deixar;
#   - nunca abre sozinha com uma janela do chat em primeiro plano (ele está digitando: a nova roubaria o foco);
#   - escrita na LCU só por ação dele numa página (enviar e convidar por clique/Enter; marcar como lida só depois de
#     um clique ou tecla na janela, ou na janela que ele mesmo abriu: painel/chat/chat.js); nada aqui escreve sozinho.
#     As rotas que escrevem (enviar, convidar, lida) só aceitam a origem das próprias páginas (servidor_local);
#   - nada de SetForegroundWindow (ARMADILHAS § Windows): o foco fica com o Windows.
# Rotas: GET /chat/amigos | /chat/conversa/<k> (páginas), /chat/chat.css|js, /chat/api/amigos,
# /chat/api/conversa/<k>, /chat/estado; POST /chat/abrir/<k|amigos>, /chat/fechar/<k|amigos>,
# /chat/minimizar/<k|amigos>, /chat/enviar/<k> {texto}, /chat/convidar/<k>, /chat/lida/<k>, /chat/plugin {compacto}.
# <k> = chave opaca (sha1 do pid do amigo): o pid não vai para url, histórico do Edge nem log.
#   prova: python tools/teste-chat-janelas.py  (LCU e janelas falsas; --real abre uma janela do Edge de verdade)
import ctypes
import ctypes.wintypes as wt
import hashlib
import json
import logging
import re
import subprocess
import sys
import threading
import time
import urllib.error
from datetime import datetime
from pathlib import Path
from urllib.parse import quote, unquote

sys.path.insert(0, str(Path(__file__).resolve().parent))
import banco  # noqa: E402

log = logging.getLogger("coletor.chat")

PAGINAS = banco.RAIZ / "painel" / "chat"
PERFIL = banco.RAIZ / "dados" / "edge-chat"       # perfil próprio: nunca o do painel (o 2º --app iria para ele)
PIDFILE = banco.RAIZ / "dados" / "edge-chat.pid"
BASE = "http://127.0.0.1:8765"
MARCA = " · chat lol"                 # fim do título de toda janela do chat (acha a janela de um Edge órfão)
MAX_CONVERSAS = 3
TAM_AMIGOS = (300, 560)               # área da página em px lógicos (protótipo aprovado, tela 5)
TAM_CONVERSA = (360, 420)
MOLDURA = (16, 40)                    # [S] barra de título e bordas do Edge app, somadas ao tamanho da página
FASES_ABRE_SOZINHO = ("None", "Lobby", "EndOfGame")
CACHE_S = 1.5                         # leituras da LCU reaproveitadas (3 janelas + lista consultando)
SEM_CLIENT_FECHA_S = 60               # client fechado há isso: fecha as janelas (sem LCU elas não servem)
CONVITE_VALE_S = 60                   # "convidado" fica no botão por isso
TEXTO_MAX = 500
MSGS_MAX = 100
# campos que nunca saem para a página (sala de grupo: senha e jwt; a sessão do champ select tem os mesmos)
PROIBIDOS = ("password", "mucJwtDto", "inviterId", "multiUserChatPassword", "jwt")   # ⊇ banco.SEGREDOS
FILAS = {420: "Solo/Duo", 440: "Flex", 400: "Normal", 430: "Normal", 490: "Rápida", 450: "ARAM", 1700: "Arena",
         1900: "URF", 900: "ARURF", 700: "Clash", 830: "Co-op", 840: "Co-op", 850: "Co-op", 870: "Co-op",
         880: "Co-op", 890: "Co-op", 0: "Personalizada", 3100: "Personalizada", 1090: "TFT", 1100: "TFT ranqueada",
         1130: "TFT", 1160: "TFT duplas"}
TIPOS_FILA = {"RANKED_SOLO_5x5": "Solo/Duo", "RANKED_FLEX_SR": "Flex", "NORMAL": "Normal", "BLIND_PICK": "Normal",
              "DRAFT_PICK": "Normal", "ARAM_UNRANKED_5x5": "ARAM", "ARAM": "ARAM", "CHERRY": "Arena",
              "RANKED_TFT": "TFT ranqueada", "NORMAL_TFT": "TFT", "CUSTOM": "Personalizada", "SWIFTPLAY": "Rápida"}
_RE_MSG = re.compile(r"^/lol-chat/v1/conversations/([^/]+)/messages/([^/]+)$")
_RE_SALA = re.compile(r"@(champ-select|post-game|lol-post-game|sec|lol-lobby|lobby|club|cs)\.", re.I)


class SemClient(Exception):
    pass


def chave(pid):
    """chave opaca e estável (sobrevive ao coletor reiniciar: a janela aberta continua achando a conversa)"""
    return hashlib.sha1(str(pid or "").lower().encode("utf-8")).hexdigest()[:12]


def _status_http(e):
    return getattr(e, "code", None) or getattr(e, "status", None)


def limpo(v):
    """cópia sem os campos proibidos, em qualquer profundidade (defesa extra: as visões já escolhem campo a campo)"""
    if isinstance(v, dict):
        return {k: limpo(x) for k, x in v.items() if k not in PROIBIDOS}
    if isinstance(v, list):
        return [limpo(x) for x in v]
    return v


def eh_conversa_direta(c):
    """só conversa 1:1 com amigo: sala de grupo (champ select, pós-jogo, lobby, clube) traz senha e nome oculto"""
    if not isinstance(c, dict):
        return False
    tipo = str(c.get("type") or "").lower()
    return tipo == "chat" and not _RE_SALA.search(str(c.get("id") or ""))


def nome_fila(lol):
    lol = lol or {}
    try:
        q = int(lol.get("queueId"))
    except (TypeError, ValueError):
        q = None
    if q in FILAS and q not in (0,):
        return FILAS[q]
    tipo = str(lol.get("gameQueueType") or "")
    g = str(lol.get("gameStatus") or "")
    if not tipo and g.startswith("hosting_"):
        tipo = g[len("hosting_"):]
    return TIPOS_FILA.get(tipo, "")


def status_amigo(f, agora_ms=None):
    """{online, dot, txt, cls, ocupado}: dot = chat|jogo|fila|away|mobile|off (cores do protótipo), cls = cor do texto.
    lol.gameStatus "inQueue"/"championSelect" e o tempo de partida (lol.timeStamp) são [S] (plano, Fatos medidos)"""
    disp = str(f.get("availability") or "").lower()
    lol = f.get("lol") if isinstance(f.get("lol"), dict) else {}
    produto = str(f.get("product") or "").lower()
    if disp in ("", "offline"):
        return {"online": False, "dot": "off", "txt": "offline", "cls": "", "ocupado": True}
    if disp == "mobile":
        return {"online": True, "dot": "mobile", "txt": "no celular", "cls": "", "ocupado": True}
    if produto and produto not in ("league_of_legends", "lol"):
        nome = str(f.get("productName") or produto)
        return {"online": True, "dot": "away" if disp == "away" else "chat", "txt": f"no {nome}", "cls": "",
                "ocupado": True}
    if disp == "away":
        return {"online": True, "dot": "away", "txt": "ausente", "cls": "", "ocupado": False}
    g = str(lol.get("gameStatus") or "")
    fila = nome_fila(lol)
    sufixo = f" · {fila}" if fila else ""
    if g == "inGame":
        txt = "em partida" + sufixo
        try:
            ts = int(lol.get("timeStamp") or 0)
            agora_ms = agora_ms if agora_ms is not None else time.time() * 1000
            minutos = (agora_ms - ts) / 60000
            if ts > 0 and 0 <= minutos < 180:
                txt += f" · {int(minutos)} min"
        except (TypeError, ValueError):
            pass
        return {"online": True, "dot": "jogo", "txt": txt, "cls": "jogo", "ocupado": True}
    if g == "championSelect":
        return {"online": True, "dot": "jogo", "txt": "na seleção" + sufixo, "cls": "jogo", "ocupado": True}
    if g == "inQueue":
        return {"online": True, "dot": "fila", "txt": "na fila" + sufixo, "cls": "fila", "ocupado": True}
    if g.startswith("hosting"):
        return {"online": True, "dot": "chat", "txt": "no lobby" + sufixo, "cls": "fila", "ocupado": False}
    if g == "spectating":
        return {"online": True, "dot": "jogo", "txt": "assistindo", "cls": "jogo", "ocupado": True}
    if disp == "dnd":
        return {"online": True, "dot": "jogo", "txt": "ocupado", "cls": "jogo", "ocupado": True}
    return {"online": True, "dot": "chat", "txt": "online", "cls": "", "ocupado": False}


_ORDEM = {"chat": 0, "fila": 1, "jogo": 2, "away": 3, "mobile": 4, "off": 5}


def grupo_do_amigo(f):
    g = str(f.get("displayGroupName") or f.get("groupName") or "").strip()
    return "geral" if not g or g.startswith("**") else g


def layout(util, escala, alvo, slot=0):
    """retângulo (x, y, w, h) em px físicos dentro da área útil `util` (x, y, w, h físicos) do monitor.
    Lista de amigos no canto de cima à direita; conversas lado a lado à esquerda dela; sem espaço, em cascata."""
    ux, uy, uw, uh = util
    e = escala or 1
    m, gap, passo = round(12 * e), round(8 * e), round(28 * e)
    tam = TAM_AMIGOS if alvo == "amigos" else TAM_CONVERSA
    w, h = round((tam[0] + MOLDURA[0]) * e), round((tam[1] + MOLDURA[1]) * e)
    aw = round((TAM_AMIGOS[0] + MOLDURA[0]) * e)
    if alvo == "amigos":
        x, y = ux + uw - w - m, uy + m
    else:
        x, y = ux + uw - aw - m - gap - (slot + 1) * w - slot * gap, uy + m
        if x < ux + m:   # monitor estreito: cascata a partir do canto de cima à esquerda
            x, y = ux + m + slot * passo, uy + m + slot * passo
    w, h = min(w, uw), min(h, uh)
    x = min(max(x, ux), ux + uw - w)
    y = min(max(y, uy), uy + uh - h)
    return (int(x), int(y), int(w), int(h))


def _hora(ts):
    """timestamp ISO da LCU -> o mesmo ISO (a página formata na hora local); inválido -> ''"""
    try:
        datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        return str(ts)
    except ValueError:
        return ""


# ---------- janelas do Edge (Windows) ----------

class JanelasEdge:
    """um processo do Edge (perfil dados/edge-chat) com N janelas --app; cada janela é achada pelo hwnd novo do
    processo depois do lançamento (o 2º msedge com o mesmo perfil entrega a URL ao 1º e sai: o pid dele não serve).
    Nunca chama SetForegroundWindow."""

    def __init__(self, perfil=PERFIL, pidfile=PIDFILE):
        self.perfil, self.pidfile = Path(perfil), Path(pidfile)
        self.pid = self.desde = None
        self._trava = threading.Lock()
        self.ultimo_foco = None    # diagnóstico: a última janela aberta nasceu em primeiro plano?

    # -- processo --
    def _jp(self):
        import janela_painel
        return janela_painel

    def _vivo(self):
        jp = self._jp()
        if self.pid and jp.pid_existe(self.pid, self.desde):
            return True
        try:
            d = json.loads(self.pidfile.read_text())
            pid, desde = int(d["pid"]), float(d["ts"]) / 1000
        except (OSError, ValueError, KeyError, TypeError):
            pid = desde = None
        if pid and jp.pid_existe(pid, desde):
            self.pid, self.desde = pid, desde
            return True
        self.pid = self.desde = None
        return False

    def _guardar(self, pid):
        self.pid, self.desde = pid, time.time()
        try:
            self.pidfile.parent.mkdir(parents=True, exist_ok=True)
            self.pidfile.write_text(json.dumps({"pid": pid, "ts": int(self.desde * 1000)}))
        except OSError:
            pass

    def _hwnds(self):
        if not self._vivo():
            return set()
        return {h for h, _ in self._jp()._hwnds_do_pid(self.pid)}

    def _adotar_orfao(self):
        """Edge com o perfil do chat vivo sem pid guardado (coletor reiniciado): acha pelo título das janelas"""
        jp = self._jp()
        u = ctypes.windll.user32
        achados = []
        PROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)

        def cb(hwnd, lp):
            if u.IsWindowVisible(hwnd):
                n = u.GetWindowTextLengthW(hwnd)
                if n:
                    buf = ctypes.create_unicode_buffer(n + 1)
                    u.GetWindowTextW(hwnd, buf, n + 1)
                    if buf.value.endswith(MARCA):
                        dono = wt.DWORD()
                        u.GetWindowThreadProcessId(hwnd, ctypes.byref(dono))
                        achados.append(dono.value)
            return True
        u.EnumWindows(PROC(cb), 0)
        for pid in achados:
            if jp.pid_existe(pid):
                self.pid, self.desde = pid, None
                return True
        return False

    # -- monitor --
    def area(self):
        """(util físico (x, y, w, h), escala) do monitor das janelas: o da 2ª tela se houver, senão o principal"""
        jp = self._jp()
        lista = jp.monitores()
        mon = jp.monitor_do_painel(lista) or next((m for m in lista if m["primario"]), lista[0] if lista else None)
        if not mon:
            return (0, 0, 1280, 720), 1
        return tuple(mon.get("util") or (mon["x"], mon["y"], mon["w"], mon["h"])), mon.get("escala") or 1

    # -- janelas --
    def abrir(self, url, rect, espera_s=8.0, sem_foco=False):
        """abre a janela em `rect` (px físicos); devolve o hwnd ou None. sem_foco (janela aberta sozinha): se ela
        nascer em primeiro plano, minimiza e restaura sem ativar; o Windows devolve a ativação à janela de antes
        (sem SetForegroundWindow: ARMADILHAS § Windows)"""
        jp = self._jp()
        edge = jp.achar_edge()
        if not edge:
            log.warning("chat: msedge.exe não encontrado")
            return None
        with self._trava:
            antes = self._hwnds()
            fg_antes = ctypes.windll.user32.GetForegroundWindow()
            x, y, w, h = rect
            _, e = self.area()
            self.perfil.mkdir(parents=True, exist_ok=True)
            args = [str(edge), f"--app={url}", f"--user-data-dir={self.perfil}", "--no-first-run",
                    "--no-default-browser-check", "--disable-sync", f"--window-position={round(x / e)},{round(y / e)}",
                    f"--window-size={round(w / e)},{round(h / e)}"]
            si = subprocess.STARTUPINFO()
            si.dwFlags |= 0x1          # STARTF_USESHOWWINDOW
            si.wShowWindow = 4         # SW_SHOWNOACTIVATE (vale só para o 1º processo; a entrega ao Edge vivo ignora)
            p = subprocess.Popen(args, creationflags=jp.NAO_JANELA, close_fds=True, startupinfo=si)
            fim = time.monotonic() + espera_s
            hwnd = None
            while time.monotonic() < fim:
                time.sleep(0.2)
                if not self.pid or not jp.pid_existe(self.pid, self.desde):
                    if p.poll() is None and time.monotonic() > fim - espera_s + 1.0:
                        self._guardar(p.pid)          # 1º lançamento: este é o processo do navegador
                    elif p.poll() is not None:
                        self._adotar_orfao()          # entregou a um Edge do perfil que não conhecíamos
                novos = self._hwnds() - antes
                if novos:
                    hwnd = next(iter(novos))
                    break
            if not hwnd:
                log.warning("chat: a janela não apareceu em %.0f s", espera_s)
                return None
            self.posicionar(hwnd, rect)
            u = ctypes.windll.user32
            fg = u.GetForegroundWindow()
            self.ultimo_foco = bool(fg == hwnd and fg_antes != hwnd)
            if sem_foco and self.ultimo_foco and fg_antes:
                u.ShowWindow(wt.HWND(hwnd), 6)      # SW_MINIMIZE: a ativação volta para a janela de antes
                u.ShowWindow(wt.HWND(hwnd), 4)      # SW_SHOWNOACTIVATE: reaparece no lugar, sem o foco
                time.sleep(0.3)
                self.ultimo_foco = u.GetForegroundWindow() == hwnd
                log.info("chat: a janela nasceu com o foco; devolvido: %s", "não" if self.ultimo_foco else "sim")
            return hwnd

    def posicionar(self, hwnd, rect):
        jp = self._jp()
        jp._dpi_fisico()
        x, y, w, h = rect
        # SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER
        ctypes.windll.user32.SetWindowPos(wt.HWND(hwnd), None, int(x), int(y), int(w), int(h), 0x10 | 0x4 | 0x200)

    def existe(self, hwnd):
        u = ctypes.windll.user32
        if not hwnd or not u.IsWindow(wt.HWND(hwnd)):
            return False
        dono = wt.DWORD()
        u.GetWindowThreadProcessId(wt.HWND(hwnd), ctypes.byref(dono))
        return bool(self.pid) and dono.value == self.pid

    def fechar(self, hwnd):
        if self.existe(hwnd):
            ctypes.windll.user32.PostMessageW(wt.HWND(hwnd), 0x0010, 0, 0)   # WM_CLOSE

    def minimizar(self, hwnd):
        if self.existe(hwnd):
            ctypes.windll.user32.ShowWindowAsync(wt.HWND(hwnd), 6)          # SW_MINIMIZE

    def mostrar(self, hwnd):
        """janela minimizada volta (clique dele na lista); sem forçar primeiro plano"""
        u = ctypes.windll.user32
        if self.existe(hwnd) and u.IsIconic(wt.HWND(hwnd)):
            u.ShowWindowAsync(wt.HWND(hwnd), 9)                              # SW_RESTORE

    def primeiro_plano(self):
        return ctypes.windll.user32.GetForegroundWindow() or None


# ---------- o chat ----------

class ChatJanelas:
    """lcu: f() -> LCU do coletor (get/post) ou None. janelas: JanelasEdge (ou a falsa do teste).
    instalar(srv) pendura as rotas no ServidorLocal; evento()/fase() vêm do coletor (websocket);
    processar() abre/fecha janelas (thread própria com ticker=True; o teste chama na mão)."""

    def __init__(self, lcu, janelas=None, base=BASE, ticker=True, relogio=time.monotonic, agora_ms=None):
        self.lcu = lcu
        self.janelas = janelas or JanelasEdge()
        self.base = base.rstrip("/")
        self.relogio = relogio
        self.agora_ms = agora_ms or (lambda: time.time() * 1000)
        self._trava = threading.RLock()
        self._acordar = threading.Event()
        self._cache = {}             # caminho -> (relogio, valor)
        self._alvos = {}             # k -> {"pid", "conv", "nome", "sid", "puuid"}
        self.abertas = {}            # k (ou "amigos") -> {"hwnd", "desde", "slot", "auto"}
        self.pendentes = []          # k de mensagem nova esperando poder abrir sozinha
        self.pedidos = []            # ("abrir"|"fechar"|"minimizar", k) dos cliques
        self.convidados = {}         # k -> relogio do convite
        self._fase = None
        self.compacto = None         # o plugin diz se o client compacto está ligado (POST /chat/plugin)
        self.lista_aberta = False    # a lista de amigos foi aberta nesta sessão do client
        self._porta = None
        self._me = None
        self._sem_client_desde = None
        self._naolidas = None        # conversa -> não lidas na última olhada (None = sem base ainda)
        self._thread = None
        if ticker:
            self._thread = threading.Thread(target=self._laco, name="chat-janelas", daemon=True)
            self._thread.start()

    # -- infraestrutura --
    def instalar(self, srv):
        srv.rotas_get["/chat/"] = self.rota_get
        if not hasattr(srv, "rotas_post"):
            srv.rotas_post = {}
        srv.rotas_post["/chat/"] = self.rota_post
        return self

    def _laco(self):
        while True:
            ocupado = bool(self.pendentes or self.abertas or self.pedidos)
            # com o compacto ligado a rede das não lidas olha a cada 5 s (a mensagem nova abre em até 5 s sem o evento)
            self._acordar.wait(1.0 if ocupado else 5.0 if (self.compacto or self.lista_aberta) else 15.0)
            self._acordar.clear()
            try:
                self.processar()
            except Exception as e:
                log.warning("chat: %s: %s", type(e).__name__, e)

    def _lcu(self):
        lcu = self.lcu()
        if lcu is None:
            raise SemClient()
        porta = getattr(lcu, "porta", None)
        if porta != self._porta:
            if self._porta is not None:   # outro client (patch, reabriu): estado da sessão anterior não vale
                with self._trava:
                    self._cache.clear()
                    self._me = None
                    self.compacto = None
                    self.lista_aberta = False
                    self._naolidas = None
            self._porta = porta
        return lcu

    def _get(self, caminho, cache=True):
        agora = self.relogio()
        if cache:
            c = self._cache.get(caminho)
            if c and agora - c[0] < CACHE_S:
                return c[1]
        v = self._lcu().get(caminho, timeout=8)
        self._cache[caminho] = (agora, v)
        return v

    def _get_ou(self, caminho, padrao=None):
        """GET que devolve `padrao` em 404 (sem lobby, conversa ainda não criada)"""
        try:
            return self._get(caminho)
        except urllib.error.HTTPError as e:
            if _status_http(e) == 404:
                return padrao
            raise

    def _escrever(self, metodo, caminho, corpo):
        """única escrita: chamada só pelas rotas POST que a página manda num clique dele"""
        lcu = self._lcu()
        if metodo == "POST":
            r = lcu.post(caminho, corpo)
        else:
            r = lcu.post(caminho, corpo, metodo=metodo)
        self._cache.clear()
        return r

    def invalidar(self):
        self._cache.clear()

    # -- leitura --
    def eu(self):
        if self._me is None:
            try:
                m = self._get("/lol-chat/v1/me") or {}
            except (urllib.error.HTTPError, OSError, ValueError):
                m = {}
            self._me = {k: str(m.get(k) or "") for k in ("pid", "id", "puuid")}
        return self._me

    def conversas(self):
        lista = self._get("/lol-chat/v1/conversations") or []
        return [c for c in lista if eh_conversa_direta(c)]

    def amigos_brutos(self):
        return [f for f in (self._get("/lol-chat/v1/friends") or []) if isinstance(f, dict)]

    def _lobby(self):
        """{tem, pode, motivo, membros}: convidar só no lobby, como líder (ou com convite liberado)"""
        try:
            lob = self._get_ou("/lol-lobby/v2/lobby")
        except (urllib.error.HTTPError, OSError, ValueError, SemClient):
            return {"tem": None, "pode": False, "motivo": "não consegui ler o lobby", "membros": set()}
        if not isinstance(lob, dict):
            return {"tem": False, "pode": False, "motivo": "abre o lobby antes (botão JOGAR)", "membros": set()}
        eu = lob.get("localMember") or {}
        membros = set()
        for m in lob.get("members") or []:
            for campo in ("puuid", "summonerId"):
                if m.get(campo):
                    membros.add(str(m[campo]))
        pode = bool(eu.get("isLeader") or eu.get("allowedInviteOthers"))
        return {"tem": True, "pode": pode, "motivo": "" if pode else "só o líder do grupo convida", "membros": membros}

    def _lembrar(self, k, **campos):
        a = self._alvos.setdefault(k, {"pid": "", "conv": "", "nome": "", "sid": 0, "puuid": ""})
        for c, v in campos.items():
            if v:
                a[c] = v
        return a

    def _conv_por_pid(self, convs):
        out = {}
        for c in convs:
            pid = str(c.get("pid") or c.get("id") or "")
            out[pid.lower()] = c
            self._lembrar(chave(pid), pid=pid, conv=str(c.get("id") or ""),
                          nome=str(c.get("gameName") or c.get("name") or ""))
        return out

    def ver_amigos(self):
        """dados da lista de amigos (só o que a página mostra)"""
        try:
            brutos = self.amigos_brutos()
            convs = self.conversas()
        except SemClient:
            return {"ok": False, "motivo": "client fechado"}
        except (urllib.error.HTTPError, OSError, ValueError) as e:
            return {"ok": False, "motivo": f"o client não respondeu ({_status_http(e) or type(e).__name__})"}
        por_pid = self._conv_por_pid(convs)
        lobby = self._lobby()
        agora_ms, agora = self.agora_ms(), self.relogio()
        online, offline = [], []
        for f in brutos:
            pid = str(f.get("pid") or f.get("id") or "")
            if not pid:
                continue
            k = chave(pid)
            nome = str(f.get("gameName") or f.get("name") or "?")
            self._lembrar(k, pid=pid, nome=nome, sid=f.get("summonerId") or 0, puuid=str(f.get("puuid") or ""))
            st = status_amigo(f, agora_ms)
            conv = por_pid.get(pid.lower())
            un = int((conv or {}).get("unreadMessageCount") or 0)
            item = {"k": k, "nome": nome, "dot": st["dot"], "txt": st["txt"], "cls": st["cls"], "un": un,
                    "grupo": grupo_do_amigo(f), "aberta": k in self.abertas}
            if not st["online"]:
                offline.append(item)
                continue
            no_grupo = bool({str(f.get("puuid") or ""), str(f.get("summonerId") or "")} & lobby["membros"] - {""})
            if no_grupo:
                item["convidar"] = {"mostra": False}
            elif st["ocupado"]:
                item["convidar"] = {"mostra": False}
            elif k in self.convidados and agora - self.convidados[k] < CONVITE_VALE_S:
                item["convidar"] = {"mostra": True, "ok": False, "rotulo": "convidado", "motivo": "convite enviado"}
            else:
                item["convidar"] = {"mostra": True, "ok": bool(lobby["pode"]), "rotulo": "convidar",
                                    "motivo": lobby["motivo"] or "convidar para o teu grupo"}
            online.append(item)
        online.sort(key=lambda a: (-min(a["un"], 1), _ORDEM.get(a["dot"], 9), a["nome"].casefold()))
        offline.sort(key=lambda a: (-min(a["un"], 1), a["nome"].casefold()))
        grupos = []
        for a in online:
            if a["grupo"] not in grupos:
                grupos.append(a["grupo"])
        grupos.sort(key=lambda g: (g != "geral", g.casefold()))
        return {"ok": True, "online": online, "offline": offline, "grupos": grupos,
                "naoLidas": sum(a["un"] for a in online + offline)}

    def _alvo(self, k):
        """alvo da chave, relendo amigos e conversas se o coletor ainda não conhece (reiniciou)"""
        if k not in self._alvos:
            try:
                self._conv_por_pid(self.conversas())
                for f in self.amigos_brutos():
                    pid = str(f.get("pid") or f.get("id") or "")
                    if pid and chave(pid) == k:
                        self._lembrar(k, pid=pid, nome=str(f.get("gameName") or f.get("name") or ""),
                                      sid=f.get("summonerId") or 0, puuid=str(f.get("puuid") or ""))
            except (urllib.error.HTTPError, OSError, ValueError):
                pass
        return self._alvos.get(k)

    def _amigo(self, k):
        for f in self.amigos_brutos():
            pid = str(f.get("pid") or f.get("id") or "")
            if pid and chave(pid) == k:
                return f
        return None

    def ver_conversa(self, k):
        try:
            alvo = self._alvo(k)
            if not alvo:
                return {"ok": False, "k": k, "motivo": "conversa não encontrada (não é amigo?)"}
            f = self._amigo(k) or {}
            st = status_amigo(f, self.agora_ms()) if f else {"txt": "", "cls": ""}
            conv_id = alvo["conv"] or alvo["pid"]
            convs = {str(c.get("id") or ""): c for c in self.conversas()}
            c = convs.get(conv_id) or {}
            brutas = self._get_ou(f"/lol-chat/v1/conversations/{quote(conv_id, safe='')}/messages", []) or []
        except SemClient:
            return {"ok": False, "k": k, "motivo": "client fechado"}
        except (urllib.error.HTTPError, OSError, ValueError) as e:
            return {"ok": False, "k": k, "motivo": f"o client não respondeu ({_status_http(e) or type(e).__name__})"}
        eu = self.eu()
        meus = {v for v in eu.values() if v}
        msgs = []
        for m in brutas[-MSGS_MAX:]:
            if not isinstance(m, dict):
                continue
            tipo = str(m.get("type") or "chat").lower()
            de = {str(m.get(x) or "") for x in ("fromPid", "fromId", "fromPuuid")} - {""}
            msgs.append({"eu": bool(de & meus), "texto": str(m.get("body") or ""), "ts": _hora(m.get("timestamp")),
                         "sis": tipo not in ("chat", "groupchat")})
        return {"ok": True, "k": k, "nome": alvo["nome"] or str(c.get("gameName") or c.get("name") or "?"),
                "txt": st.get("txt", ""), "cls": st.get("cls", ""), "msgs": msgs,
                "naoLidas": int(c.get("unreadMessageCount") or 0)}

    def estado(self):
        """para o 💬 do plugin: não lidas das conversas diretas, janelas abertas e pendentes"""
        try:
            nl = sum(int(c.get("unreadMessageCount") or 0) for c in self.conversas())
            ok, motivo = True, ""
        except SemClient:
            nl, ok, motivo = 0, False, "client fechado"
        except (urllib.error.HTTPError, OSError, ValueError):
            nl, ok, motivo = 0, False, "o client não respondeu"
        with self._trava:
            return {"ok": ok, "motivo": motivo, "naoLidas": nl, "abertas": [k for k in self.abertas if k != "amigos"],
                    "lista": "amigos" in self.abertas, "pendentes": len(self.pendentes)}

    # -- eventos (websocket do coletor; rápido, sem IO) --
    def fase(self, fase):
        self._fase = fase if isinstance(fase, str) else None
        self._acordar.set()

    def evento(self, uri, tipo, dado):
        if not str(uri).startswith("/lol-chat/"):
            return
        self.invalidar()
        m = _RE_MSG.match(str(uri))
        if not m or tipo != "Create" or not isinstance(dado, dict):
            return
        conv_id = unquote(m.group(1))
        if _RE_SALA.search(conv_id) or str(dado.get("type") or "chat").lower() != "chat" or dado.get("isHistorical"):
            return
        de = {str(dado.get(x) or "") for x in ("fromPid", "fromId", "fromPuuid")} - {""}
        me = self._me or {}
        if de & {v for v in me.values() if v}:
            return                                  # mensagem minha (enviada daqui ou do client)
        with self._trava:
            self.pendentes = [p for p in self.pendentes if p != conv_id] + [conv_id]
        self._acordar.set()

    # -- janelas --
    def abre_sozinha_ligado(self):
        """conversa nova pode abrir sozinha: compacto ligado (o plugin disse) ou, sem o plugin ter dito nada ainda
        (coletor reiniciou: compacto=None), a lista de amigos aberta nesta sessão. {compacto: false} vence sempre: é o
        que o bloco "Client compacto" das Configurações promete ("o coletor deixa de abrir conversa nova sozinho")"""
        return self.compacto is True or (self.compacto is None and self.lista_aberta)

    def pode_abrir_sozinha(self):
        """(bool, motivo)"""
        if not self.abre_sozinha_ligado():
            return False, "client compacto desligado (o chat do client mostra)"
        fase = self._fase
        if fase is None:
            try:
                fase = self._get("/lol-gameflow/v1/gameflow-phase", cache=False)
            except Exception:
                return False, "fase desconhecida"
        if fase not in FASES_ABRE_SOZINHO:
            return False, f"fase {fase}: só conta"
        fg = self.janelas.primeiro_plano()
        if fg and any(fg == a["hwnd"] for a in self.abertas.values()):
            return False, "janela do chat em primeiro plano (ele está digitando)"
        return True, ""

    def _url(self, k, auto=False):
        if k == "amigos":
            return f"{self.base}/chat/amigos"
        return f"{self.base}/chat/conversa/{k}" + ("?auto=1" if auto else "")

    def abrir(self, k, auto=False):
        """abre (ou devolve) a janela de k ("amigos" ou chave de conversa); a 4ª conversa fecha a mais antiga"""
        with self._trava:
            a = self.abertas.get(k)
            if a and self.janelas.existe(a["hwnd"]):
                if not auto:
                    self.janelas.mostrar(a["hwnd"])
                return a["hwnd"]
            self.abertas.pop(k, None)
            if k != "amigos":
                convs = {kk: v for kk, v in self.abertas.items() if kk != "amigos"}
                while len(convs) >= MAX_CONVERSAS:
                    velha = min(convs, key=lambda kk: convs[kk]["desde"])
                    self.janelas.fechar(convs.pop(velha)["hwnd"])
                    self.abertas.pop(velha, None)
                usados = {v["slot"] for v in convs.values()}
                slot = next(i for i in range(MAX_CONVERSAS + 1) if i not in usados)
            else:
                slot = 0
        util, escala = self.janelas.area()
        rect = layout(util, escala, "amigos" if k == "amigos" else "conversa", slot)
        hwnd = self.janelas.abrir(self._url(k, auto), rect, sem_foco=auto)
        if not hwnd:
            return None
        with self._trava:
            self.abertas[k] = {"hwnd": hwnd, "desde": self.relogio(), "slot": slot, "auto": auto}
            if k == "amigos":
                self.lista_aberta = True
        log.info("chat: janela %s aberta (%s, %d conversas)", "da lista" if k == "amigos" else "de conversa",
                 "sozinha" if auto else "clique", len([x for x in self.abertas if x != "amigos"]))
        if auto and getattr(self.janelas, "ultimo_foco", None):
            log.info("chat: a janela aberta sozinha ficou em primeiro plano")
        return hwnd

    def fechar(self, k):
        with self._trava:
            a = self.abertas.pop(k, None)
        if a:
            self.janelas.fechar(a["hwnd"])

    def fechar_tudo(self):
        with self._trava:
            todas, self.abertas = list(self.abertas.values()), {}
            self.pendentes = []
        for a in todas:
            self.janelas.fechar(a["hwnd"])

    def _olhar_nao_lidas(self):
        """rede do evento [S] (formato da uri de mensagem nova não medido): não lida que subiu numa conversa direta
        sem janela também vira pendente. 1ª leitura só guarda a base (o que já estava não lido não abre)"""
        try:
            convs = self.conversas()
        except Exception:
            return
        vistos = {}
        for c in convs:
            cid = str(c.get("id") or "")
            n = int(c.get("unreadMessageCount") or 0)
            vistos[cid] = n
            if self._naolidas is not None and n > self._naolidas.get(cid, 0) \
                    and chave(c.get("pid") or cid) not in self.abertas:
                with self._trava:
                    if cid not in self.pendentes:
                        self.pendentes.append(cid)
        self._naolidas = vistos

    def processar(self):
        """um passo do laço: janelas fechadas pelo ✕ do Windows saem da conta, cliques, pendentes, client fechado"""
        with self._trava:
            for k in [k for k, a in self.abertas.items() if not self.janelas.existe(a["hwnd"])]:
                self.abertas.pop(k, None)
            pedidos, self.pedidos = self.pedidos, []
        for acao, k in pedidos:
            if acao == "abrir":
                self.abrir(k)
            elif acao == "fechar":
                self.fechar(k)
            elif acao == "minimizar" and k in self.abertas:
                self.janelas.minimizar(self.abertas[k]["hwnd"])
        if self.lcu() is None:
            if self._sem_client_desde is None:
                self._sem_client_desde = self.relogio()
            elif self.relogio() - self._sem_client_desde >= SEM_CLIENT_FECHA_S and (self.abertas or self.pendentes):
                log.info("chat: client fechado; janelas do chat fechadas")
                self.fechar_tudo()
            return
        self._sem_client_desde = None
        if self.abre_sozinha_ligado():
            self._olhar_nao_lidas()
        if not self.pendentes:
            return
        ok, motivo = self.pode_abrir_sozinha()
        if not ok:
            return
        with self._trava:
            pendentes, self.pendentes = self.pendentes, []
        try:
            diretas = {str(c.get("id") or ""): c for c in self.conversas()}
        except Exception:
            with self._trava:
                self.pendentes = pendentes + self.pendentes
            return
        meus = {v for v in self.eu().values() if v}
        for conv_id in pendentes[-MAX_CONVERSAS:]:
            c = diretas.get(conv_id)
            if not c:
                continue                          # não é conversa direta (sala) ou sumiu: nada abre
            ultima = c.get("lastMessage") if isinstance(c.get("lastMessage"), dict) else {}
            if {str(ultima.get(x) or "") for x in ("fromPid", "fromId", "fromPuuid")} & meus:
                continue                          # a última é minha (enviada pelo chat do client): nada abre
            pid = str(c.get("pid") or c.get("id") or "")
            k = chave(pid)
            self._lembrar(k, pid=pid, conv=conv_id, nome=str(c.get("gameName") or c.get("name") or ""))
            if k not in self.abertas:
                self.abrir(k, auto=True)

    # -- ações dos cliques --
    def enviar(self, k, texto):
        texto = str(texto or "").strip()
        if not texto:
            return 400, {"ok": False, "motivo": "mensagem vazia"}
        if len(texto) > TEXTO_MAX:
            return 400, {"ok": False, "motivo": f"mensagem longa demais (máx. {TEXTO_MAX})"}
        alvo = self._alvo(k)
        if not alvo:
            return 404, {"ok": False, "motivo": "conversa não encontrada"}
        conv_id = alvo["conv"] or alvo["pid"]
        caminho = f"/lol-chat/v1/conversations/{quote(conv_id, safe='')}/messages"
        corpo = {"body": texto, "type": "chat"}       # [S] corpo mínimo (plano, Fatos medidos)
        try:
            try:
                self._escrever("POST", caminho, corpo)
            except urllib.error.HTTPError as e:
                if _status_http(e) != 404 or alvo["conv"]:
                    raise
                # amigo sem conversa ainda: abre a conversa e tenta uma vez [S]
                self._escrever("POST", "/lol-chat/v1/conversations", {"id": alvo["pid"], "type": "chat"})
                self._escrever("POST", caminho, corpo)
        except SemClient:
            return 503, {"ok": False, "motivo": "client fechado"}
        except (urllib.error.HTTPError, OSError, ValueError) as e:
            log.info("chat: envio recusado (%s)", _status_http(e) or type(e).__name__)
            return 502, {"ok": False, "motivo": f"o client recusou ({_status_http(e) or type(e).__name__})"}
        log.info("chat: mensagem enviada")
        return 200, {"ok": True}

    def convidar(self, k):
        alvo = self._alvo(k)
        if not alvo:
            return 404, {"ok": False, "motivo": "amigo não encontrado"}
        lobby = self._lobby()
        if not lobby["tem"] or not lobby["pode"]:
            return 409, {"ok": False, "motivo": lobby["motivo"]}
        try:
            sid = int(alvo.get("sid") or 0)
        except (TypeError, ValueError):
            sid = 0
        if sid <= 0:
            return 409, {"ok": False, "motivo": "sem o id do amigo para convidar"}
        try:
            self._escrever("POST", "/lol-lobby/v2/lobby/invitations", [{"toSummonerId": sid}])   # [S] corpo
        except SemClient:
            return 503, {"ok": False, "motivo": "client fechado"}
        except (urllib.error.HTTPError, OSError, ValueError) as e:
            log.info("chat: convite recusado (%s)", _status_http(e) or type(e).__name__)
            return 502, {"ok": False, "motivo": f"o client recusou ({_status_http(e) or type(e).__name__})"}
        self.convidados[k] = self.relogio()
        log.info("chat: convite enviado")
        return 200, {"ok": True}

    def marcar_lida(self, k):
        """a janela da conversa ganhou o foco com mensagem não lida: a conversa vira a ativa do client [S]"""
        alvo = self._alvo(k)
        if not alvo or not (alvo["conv"] or alvo["pid"]):
            return 404, {"ok": False}
        try:
            self._escrever("PUT", "/lol-chat/v1/conversations/active", {"id": alvo["conv"] or alvo["pid"]})
        except SemClient:
            return 503, {"ok": False, "motivo": "client fechado"}
        except (urllib.error.HTTPError, OSError, ValueError) as e:
            return 502, {"ok": False, "motivo": f"o client recusou ({_status_http(e) or type(e).__name__})"}
        return 200, {"ok": True}

    # -- rotas HTTP --
    def _pagina(self, modo, k=""):
        html = (PAGINAS / "chat.html").read_text(encoding="utf-8")
        if modo == "amigos":
            dados, titulo = self.ver_amigos(), "amigos"
        else:
            dados = self.ver_conversa(k)
            titulo = dados.get("nome") or "conversa"
        dados = limpo(dados)
        embut = json.dumps(dados, ensure_ascii=False).replace("<", "\\u003c").replace(">", "\\u003e")
        titulo = (titulo.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))
        html = (html.replace("<!--TITULO-->", titulo + MARCA)
                .replace("data-modo=\"\"", f"data-modo=\"{modo}\"").replace("data-k=\"\"", f"data-k=\"{k}\"")
                .replace("<!--DADOS-->", f"<script>window.__chat = {embut};</script>"))
        return 200, html, "text/html; charset=utf-8"

    def rota_get(self, rota):
        partes = [p for p in rota.split("/") if p]          # ["chat", ...]
        if rota == "/chat/amigos":
            return self._pagina("amigos")
        if len(partes) == 3 and partes[1] == "conversa" and re.fullmatch(r"[0-9a-f]{12}", partes[2]):
            return self._pagina("conversa", partes[2])
        if rota in ("/chat/chat.css", "/chat/chat.js"):
            nome = rota.rsplit("/", 1)[1]
            tipo = "text/css; charset=utf-8" if nome.endswith(".css") else "text/javascript; charset=utf-8"
            return 200, (PAGINAS / nome).read_bytes(), tipo
        if rota == "/chat/api/amigos":
            return 200, limpo(self.ver_amigos())
        if len(partes) == 4 and partes[1:3] == ["api", "conversa"]:
            return 200, limpo(self.ver_conversa(partes[3]))
        if rota == "/chat/estado":
            return 200, self.estado()
        return 404, {"erro": "não existe"}

    def rota_post(self, rota, bruto=b""):
        partes = [p for p in rota.split("/") if p]
        try:
            corpo = json.loads(bruto or b"{}")
        except ValueError:
            return 400, {"ok": False, "motivo": "json inválido"}
        if not isinstance(corpo, dict):
            corpo = {}
        if rota == "/chat/plugin":
            self.compacto = bool(corpo.get("compacto"))
            self._acordar.set()
            return 200, {"ok": True}
        if len(partes) != 3:
            return 404, {"erro": "não existe"}
        acao, k = partes[1], partes[2]
        if k != "amigos" and not re.fullmatch(r"[0-9a-f]{12}", k):
            return 400, {"ok": False, "motivo": "chave inválida"}
        if acao in ("abrir", "fechar", "minimizar"):
            with self._trava:
                self.pedidos.append((acao, k))
            self._acordar.set()
            return 202, {"ok": True}
        if k == "amigos":
            return 404, {"erro": "não existe"}
        if acao == "enviar":
            return self.enviar(k, corpo.get("texto"))
        if acao == "convidar":
            return self.convidar(k)
        if acao == "lida":
            return self.marcar_lida(k)
        return 404, {"erro": "não existe"}
