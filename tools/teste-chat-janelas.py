# Testa coletor/chat_janelas.py (tela 5 do client compacto: chat fora do client) sem o client e sem abrir janela:
# LCU falsa (get/post como a do coletor, com uma credencial conhecida), janelas falsas e o servidor local numa porta
# livre (nunca 8765/8766). Prova: mensagem nova abre a janela da conversa só no lobby/fim de partida e com o compacto
# ligado; na fila, seleção e partida só conta e abre depois; com a janela do chat em primeiro plano espera; 3 conversas
# no máximo (a 4ª fecha a mais antiga); sala de grupo (champ select, pós-jogo) nunca aparece nem abre; senha da sala e
# credencial da LCU nunca saem em resposta, url de janela ou log; envio, convite e "lida" só pelas rotas POST (clique),
# com o corpo e a rota certos; origem de site recusada; janelas dentro da área útil do monitor.
#   python tools/teste-chat-janelas.py            (offline; o rodar-testes.py roda assim)
#   python tools/teste-chat-janelas.py --prints   (Edge headless: prints das 2 páginas em temp/chat-janelas/, sem janela)
#   python tools/teste-chat-janelas.py --real     (abre 2 janelas de verdade do Edge, mede foco e posição e fecha;
#                                                  só com o jogo fechado)
import base64
import io
import json
import logging
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from urllib.parse import quote

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import chat_janelas as cj  # noqa: E402
import servidor_local  # noqa: E402

SEGREDO = "lcu-teste-7f3a9c"   # credencial falsa da LCU falsa: não pode aparecer em lugar nenhum


def _achar(v, chave):
    if isinstance(v, dict):
        if chave in v:
            return v[chave]
        for x in v.values():
            r = _achar(x, chave)
            if r is not None:
                return r
    if isinstance(v, list):
        for x in v:
            r = _achar(x, chave)
            if r is not None:
                return r
    return None


# a sala do champ select da fixture versionada (valores falsos): os campos dela vão nas salas da LCU falsa
_SALA = _achar(json.loads((RAIZ / "tests" / "fixtures" / "champselect-autofill.json").read_text(encoding="utf-8")),
               "chatDetails")
_CAMPO_SENHA, _CAMPO_JWT = cj.PROIBIDOS[0], cj.PROIBIDOS[1]
CAMPOS_SALA = {_CAMPO_SENHA: _SALA["multiUserChatPassword"], _CAMPO_JWT: _SALA["mucJwtDto"]}
VALORES_SALA = [v for v in [_SALA["multiUserChatPassword"], *_SALA["mucJwtDto"].values()] if isinstance(v, str) and len(v) > 3]
CAMPOS_VAZIOS = {_CAMPO_SENHA: "", _CAMPO_JWT: {}, cj.PROIBIDOS[2]: ""}   # conversa direta também traz os campos
EU = {"pid": "eu-0000@br1.pvp.net", "id": "eu-0000@br1.pvp.net", "puuid": "eu-0000"}


def amigo(n, nome, disp="chat", lol=None, grupo="**Default", produto="league_of_legends", sid=None):
    pid = f"amigo-{n}@br1.pvp.net"
    return {"id": pid, "pid": pid, "puuid": f"amigo-{n}", "summonerId": sid if sid is not None else 1000 + n,
            "gameName": nome, "gameTag": "BR1", "name": nome, "availability": disp, "lol": lol or {},
            "groupName": grupo, "displayGroupName": "" if grupo.startswith("**") else grupo, "product": produto,
            "productName": "VALORANT" if produto == "valorant" else "League of Legends", "icon": 1}


AMIGOS = [
    amigo(1, "Fulano", lol={"gameStatus": "hosting_RANKED_SOLO_5x5", "queueId": "420"}),
    amigo(2, "Ciclano", disp="dnd", lol={"gameStatus": "inGame", "queueId": "420", "timeStamp": str(10_000_000 - 18 * 60000)}),
    amigo(3, "Beltrano", lol={"gameStatus": "inQueue", "queueId": "440"}),
    amigo(4, "Dona Bela", disp="away", lol={"gameStatus": "outOfGame"}),
    amigo(5, "Zé Celular", disp="mobile"),
    amigo(6, "Vava", produto="valorant"),
    amigo(7, "</script><img src=x onerror=alert(1)>", lol={"gameStatus": "outOfGame"}, grupo="duo"),
    amigo(8, "Off Um", disp="offline"),
    amigo(9, "Off Dois", disp="offline"),
]


def conversa(n, unread=0, ultima_de=None):
    pid = f"amigo-{n}@br1.pvp.net"
    c = {"id": pid, "pid": pid, "type": "chat", "gameName": AMIGOS[n - 1]["gameName"], "name": AMIGOS[n - 1]["gameName"],
         "unreadMessageCount": unread, **json.loads(json.dumps(CAMPOS_VAZIOS))}
    if ultima_de:
        c["lastMessage"] = {"fromPid": ultima_de, "body": "x", "type": "chat"}
    return c


SALAS = [  # salas de grupo: nunca aparecem, nunca abrem
    {"id": "abcd-1234@champ-select.br1.pvp.net", "type": "championSelect", "unreadMessageCount": 4, "name": "sala",
     "pid": "abcd-1234@champ-select.br1.pvp.net", **CAMPOS_SALA},
    {"id": "ef01@lol-post-game.br1.pvp.net", "type": "postGame", "unreadMessageCount": 2, **CAMPOS_SALA},
    # tipo "chat" mas id de sala: o filtro pelo id também segura
    {"id": "ffff@champ-select.br1.pvp.net", "type": "chat", "unreadMessageCount": 1, **CAMPOS_SALA},
]


def _erro(caminho, codigo):
    return urllib.error.HTTPError(f"https://127.0.0.1:1{caminho}", codigo, "erro", {}, io.BytesIO(b""))


class LCUFalsa:
    """get/post como coletor.LCU; credencial conhecida para provar que não vaza"""

    def __init__(self):
        self.porta = "51234"
        self.auth = "Basic " + base64.b64encode(f"riot:{SEGREDO}".encode()).decode()
        self.convs = [conversa(1, unread=2), conversa(4)] + json.loads(json.dumps(SALAS))
        self.msgs = {AMIGOS[0]["pid"]: [
            {"id": "m1", "type": "chat", "fromPid": AMIGOS[0]["pid"], "fromId": AMIGOS[0]["pid"], "body": "bora uma duo?",
             "timestamp": "2026-10-13T16:58:00.000Z", "isHistorical": True},
            {"id": "m2", "type": "chat", "fromPid": EU["pid"], "fromId": EU["id"], "body": "<b>bora</b>",
             "timestamp": "2026-10-13T16:59:00.000Z", "isHistorical": True},
            {"id": "m3", "type": "system", "body": "Fulano entrou", "timestamp": "2026-10-13T17:00:00.000Z"},
            # 15/10/2026: 1:1 reais terminam em "joined_room" de sistema; a conversa não mostra
            {"id": "m4", "type": "system", "body": "joined_room", "timestamp": "2026-10-13T17:01:00.000Z"}]}
        self.lobby = {"localMember": {"isLeader": True, "puuid": "eu-0000", "summonerId": 1},
                      "members": [{"puuid": "eu-0000", "summonerId": 1}]}
        self.fase = "Lobby"
        self.gets, self.escritas = [], []
        self.falha_envio_404 = False

    def get(self, caminho, timeout=30):
        self.gets.append(caminho)
        if caminho == "/lol-chat/v1/me":
            return dict(EU)
        if caminho == "/lol-chat/v1/friends":
            return json.loads(json.dumps(AMIGOS))
        if caminho == "/lol-chat/v1/conversations":
            return json.loads(json.dumps(self.convs))
        if caminho == "/lol-lobby/v2/lobby":
            if self.lobby is None:
                raise _erro(caminho, 404)
            return json.loads(json.dumps(self.lobby))
        if caminho == "/lol-gameflow/v1/gameflow-phase":
            return self.fase
        if caminho.startswith("/lol-chat/v1/conversations/") and caminho.endswith("/messages"):
            cid = urllib.parse.unquote(caminho.split("/")[4])
            if cid not in self.msgs:
                raise _erro(caminho, 404)
            return json.loads(json.dumps(self.msgs[cid]))
        raise _erro(caminho, 404)

    def post(self, caminho, corpo=None, timeout=10, metodo="POST"):
        self.escritas.append((metodo, caminho, json.loads(json.dumps(corpo))))
        if self.falha_envio_404 and caminho.endswith("/messages") and metodo == "POST":
            self.falha_envio_404 = False
            raise _erro(caminho, 404)
        return {}


class JanelasFalsas:
    def __init__(self, util=(1920, 0, 1920, 1160), escala=1.25):
        self.util, self.escala = util, escala
        self.abertas = {}      # hwnd -> (url, rect)
        self.lancadas = []     # urls
        self.sem_foco = []     # pedido de não ficar com o foco, por lançamento
        self.fechadas, self.minimizadas, self.mostradas = [], [], []
        self.fg = None
        self.prox = 100
        self.ultimo_foco = False

    def area(self):
        return self.util, self.escala

    def abrir(self, url, rect, sem_foco=False):
        self.prox += 1
        self.abertas[self.prox] = (url, rect)
        self.lancadas.append(url)
        self.sem_foco.append(sem_foco)
        return self.prox

    def existe(self, hwnd):
        return hwnd in self.abertas

    def fechar(self, hwnd):
        self.fechadas.append(hwnd)
        self.abertas.pop(hwnd, None)

    def minimizar(self, hwnd):
        self.minimizadas.append(hwnd)

    def mostrar(self, hwnd):
        self.mostradas.append(hwnd)

    def primeiro_plano(self):
        return self.fg


class Relogio:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


casos = []


def caso(nome, ok, detalhe=""):
    casos.append((nome, bool(ok)))
    print(("ok     " if ok else "FALHOU ") + nome + ("" if ok else f"  -> {detalhe}"))


def http(porta, metodo, caminho, corpo=None, origem=None):
    dados = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(f"http://127.0.0.1:{porta}{caminho}", data=dados, method=metodo)
    if dados is not None:
        req.add_header("Content-Type", "application/json")
    if origem:
        req.add_header("Origin", origem)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, r.read().decode("utf-8"), r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8"), e.headers.get("Content-Type", "")


def k_de(n):
    return cj.chave(AMIGOS[n - 1]["pid"])


# roda painel/chat/chat.js (modo conversa) no node com DOM e fetch falsos; conta os POST /chat/lida/<k>:
# antes = depois do evento focus; falso = depois de um pointerdown com isTrusted false; depois = com isTrusted true
_JS_LIDA = r"""
const vm = require('vm'), fs = require('fs');
const chamadas = [], ouv = { doc: {}, win: {} };
const el = () => ({ innerHTML: '', textContent: '', classList: { toggle() {}, add() {} }, dataset: {}, addEventListener() {}, focus() {},
  scrollTop: 0, scrollHeight: 0, clientHeight: 0, style: {} });
const els = {};
const document = { body: { dataset: { modo: 'conversa', k: 'abcdef012345' } }, getElementById: id => (els[id] ||= el()),
  addEventListener: (t, f) => { (ouv.doc[t] ||= []).push(f); }, hasFocus: () => true, hidden: false, title: '' };
const window = { __chat: { ok: true, naoLidas: 2, nome: 'Fulano', txt: '', msgs: [] }, addEventListener: (t, f) => { (ouv.win[t] ||= []).push(f); }, close() {} };
const fetch = async (u, o = {}) => { chamadas.push([o.method || 'GET', u]); return { status: 200, json: async () => ({ ok: true }) }; };
const ctx = { document, window, fetch, location: { search: process.argv[2] || '' }, URLSearchParams, setInterval: () => 0, setTimeout: () => 0, Date, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(process.argv[1], 'utf8'), ctx);
const lidas = () => chamadas.filter(c => c[0] === 'POST' && c[1].includes('/chat/lida/')).length;
(async () => {
  for (const f of ouv.win.focus || []) await f();
  const antes = lidas();
  for (const f of ouv.doc.pointerdown || []) f({ isTrusted: false });
  await new Promise(r => setImmediate(r));
  const falso = lidas();
  for (const f of ouv.doc.pointerdown || []) f({ isTrusted: true });
  await new Promise(r => setImmediate(r));
  console.log(JSON.stringify({ antes, falso, depois: lidas() }));
})();
"""


def _lida_chat_js(busca):
    p = subprocess.run(["node", "-e", _JS_LIDA, str(RAIZ / "painel" / "chat" / "chat.js"), busca],
                       capture_output=True, text=True, encoding="utf-8")
    try:
        return json.loads(p.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return {"erro": (p.stderr or p.stdout)[-300:]}


def evento_msg(chat, n_ou_id, de=None, tipo="Create", historico=False, tipo_msg="chat"):
    cid = n_ou_id if isinstance(n_ou_id, str) else AMIGOS[n_ou_id - 1]["pid"]
    dado = {"id": "mx", "type": tipo_msg, "fromPid": de or cid, "fromId": de or cid, "body": "oi", "isHistorical": historico}
    chat.evento(f"/lol-chat/v1/conversations/{quote(cid, safe='')}/messages/mx", tipo, dado)


def principal():
    sys.stdout.reconfigure(encoding="utf-8")
    logbuf = io.StringIO()
    h = logging.StreamHandler(logbuf)
    logging.getLogger().addHandler(h)
    logging.getLogger().setLevel(logging.DEBUG)

    lcu = LCUFalsa()
    jan = JanelasFalsas()
    rel = Relogio()
    tem_lcu = [True]
    chat = cj.ChatJanelas(lambda: lcu if tem_lcu[0] else None, janelas=jan, base="http://127.0.0.1:8799", ticker=False,
                          relogio=rel, agora_ms=lambda: 10_000_000)
    tmp = Path(tempfile.mkdtemp(prefix="teste-chat-"))
    srv = servidor_local.ServidorLocal(porta=0, config=tmp / "config.json", db=tmp / "nao.db")
    caso("servidor sobe numa porta livre (nunca 8765/8766)", srv.iniciar())
    porta = srv.httpd.server_address[1]
    chat.instalar(srv)
    respostas = []

    def get(caminho):
        s, corpo, tipo = http(porta, "GET", caminho)
        respostas.append(corpo)
        return s, corpo, tipo

    def post(caminho, corpo=None, origem=None):
        s, c, _ = http(porta, "POST", caminho, corpo if corpo is not None else {}, origem)
        respostas.append(c)
        return s, (json.loads(c) if c.startswith("{") else c)

    try:
        # ---- lista de amigos ----
        s, corpo, _ = get("/chat/api/amigos")
        d = json.loads(corpo)
        nomes = {a["nome"]: a for a in d["online"]}
        caso("lista: 200 e 7 online / 2 offline", s == 200 and d["ok"] and len(d["online"]) == 7 and len(d["offline"]) == 2, d)
        caso("status: lobby, partida com minutos, fila, ausente, celular, outro jogo",
             nomes["Fulano"]["txt"] == "no lobby · Solo/Duo" and nomes["Fulano"]["cls"] == "fila"
             and nomes["Ciclano"]["txt"] == "em partida · Solo/Duo · 18 min" and nomes["Ciclano"]["dot"] == "jogo"
             and nomes["Beltrano"]["txt"] == "na fila · Flex" and nomes["Dona Bela"]["txt"] == "ausente"
             and nomes["Zé Celular"]["txt"] == "no celular" and nomes["Vava"]["txt"] == "no VALORANT",
             {n: a["txt"] for n, a in nomes.items()})
        caso("não lidas por amigo vêm da conversa direta (Fulano 2) e o total ignora as salas",
             nomes["Fulano"]["un"] == 2 and d["naoLidas"] == 2, d["naoLidas"])
        caso("convidar: livre p/ quem está no lobby/online/ausente; some p/ partida, fila, celular, outro jogo",
             nomes["Fulano"]["convidar"]["ok"] and nomes["Dona Bela"]["convidar"]["ok"]
             and not nomes["Ciclano"]["convidar"]["mostra"] and not nomes["Beltrano"]["convidar"]["mostra"]
             and not nomes["Zé Celular"]["convidar"]["mostra"] and not nomes["Vava"]["convidar"]["mostra"])
        caso("grupos: geral primeiro, depois os do Gabriel", d["grupos"] == ["geral", "duo"], d["grupos"])
        dots = [a["dot"] for a in d["online"]]
        caso("ordem do protótipo: online/lobby, fila, partida, ausente, celular",
             dots.index("chat") < dots.index("fila") < dots.index("jogo") < dots.index("away") < dots.index("mobile"), dots)
        lcu.lobby = None
        chat.invalidar()
        d2 = json.loads(get("/chat/api/amigos")[1])
        b = {a["nome"]: a for a in d2["online"]}["Fulano"]["convidar"]
        caso("sem lobby: convidar cinza com o motivo", b["mostra"] and not b["ok"] and "lobby" in b["motivo"], b)
        lcu.lobby = {"localMember": {"isLeader": False, "allowedInviteOthers": False, "puuid": "eu-0000"},
                     "members": [{"puuid": "eu-0000"}, {"puuid": "amigo-4"}]}
        chat.invalidar()
        d3 = {a["nome"]: a for a in json.loads(get("/chat/api/amigos")[1])["online"]}
        caso("grupo de outro: cinza 'só o líder'; quem já está no grupo não tem botão",
             not d3["Fulano"]["convidar"]["ok"] and "líder" in d3["Fulano"]["convidar"]["motivo"]
             and not d3["Dona Bela"]["convidar"]["mostra"])
        lcu.lobby = {"localMember": {"isLeader": True, "puuid": "eu-0000", "summonerId": 1}, "members": [{"puuid": "eu-0000"}]}
        chat.invalidar()

        # ---- conversa ----
        s, corpo, _ = get(f"/chat/api/conversa/{k_de(1)}")
        c = json.loads(corpo)
        caso("conversa: 3 mensagens (o joined_room some), a minha marcada 'eu', a de sistema 'sis'",
             s == 200 and c["ok"] and [m["eu"] for m in c["msgs"]] == [False, True, False] and c["msgs"][2]["sis"]
             and c["nome"] == "Fulano" and c["naoLidas"] == 2, c)
        s, corpo, _ = get(f"/chat/api/conversa/{k_de(3)}")
        c3 = json.loads(corpo)
        caso("amigo sem conversa ainda: abre vazia (404 da LCU = sem mensagens)", c3["ok"] and c3["msgs"] == [], c3)
        s, corpo, _ = get("/chat/api/conversa/ffffffffffff")
        caso("chave desconhecida: ok false com motivo, sem 500", s == 200 and not json.loads(corpo)["ok"])
        sala_k = cj.chave(SALAS[0]["pid"])
        caso("sala do champ select não tem conversa servida", not json.loads(get(f"/chat/api/conversa/{sala_k}")[1])["ok"])

        # ---- páginas ----
        s, html, tipo = get("/chat/amigos")
        caso("página da lista: html com o título marcado e os dados embutidos",
             s == 200 and "text/html" in tipo and "<title>amigos · chat lol</title>" in html and "window.__chat" in html
             and 'data-modo="amigos"' in html)
        caso("nome com </script> não fecha o script embutido nem injeta tag",
             "</script><img" not in html and "<img src=x" not in html)
        s, html_c, _ = get(f"/chat/conversa/{k_de(1)}")
        caso("página da conversa: título com o nome e a marca", s == 200 and "<title>Fulano · chat lol</title>" in html_c
             and f'data-k="{k_de(1)}"' in html_c)
        s, js, tipo_js = get("/chat/chat.js")
        s2, css, tipo_css = get("/chat/chat.css")
        caso("chat.js e chat.css servidos com o tipo certo", s == 200 and "javascript" in tipo_js and s2 == 200 and "css" in tipo_css)
        externo = [t[:80] for t in (html, html_c, js, css) if "http://" in t.replace("http://127.0.0.1", "") or "https://" in t]
        caso("zero requisição externa nas páginas (só /chat/ do próprio coletor)", not externo, externo)
        caso("chave com caracteres fora do padrão = 404 (nada de caminho arbitrário)",
             get("/chat/conversa/..%2F..%2Fconfig")[0] == 404 and get("/chat/conversa/abc")[0] == 404)

        # ---- mensagem nova: abrir sozinha ----
        lcu.fase = "Lobby"
        chat.fase("Lobby")
        evento_msg(chat, 1)
        chat.processar()
        caso("compacto desconhecido: mensagem nova não abre janela (o chat do client mostra)", jan.lancadas == [], jan.lancadas)
        caso("POST /chat/plugin liga o compacto", post("/chat/plugin", {"compacto": True})[0] == 200 and chat.compacto is True)
        chat.processar()
        caso("no lobby com o compacto: a pendente abre a conversa (?auto=1)",
             jan.lancadas == [f"http://127.0.0.1:8799/chat/conversa/{k_de(1)}?auto=1"], jan.lancadas)
        evento_msg(chat, 1)
        chat.processar()
        caso("mensagem de quem já tem janela não abre outra", len(jan.lancadas) == 1)
        for fase in ("Matchmaking", "ReadyCheck", "ChampSelect", "GameStart", "InProgress", "Reconnect"):
            chat.fase(fase)
            evento_msg(chat, 4)
            chat.processar()
        caso("fila, ready check, seleção, partida, reconectar: nenhuma janela abre", len(jan.lancadas) == 1, jan.lancadas)
        lcu.convs[1]["unreadMessageCount"] = 3
        chat.invalidar()
        e = json.loads(get("/chat/estado")[1])
        caso("na partida o 💬 conta (não lidas das conversas diretas, sem as salas)",
             e["naoLidas"] == 5 and e["pendentes"] == 1, e)
        chat.fase("WaitingForStats")
        chat.processar()
        caso("carregando estatísticas: ainda só conta", len(jan.lancadas) == 1)
        chat.fase("EndOfGame")
        chat.processar()
        caso("fim de partida: a conversa pendente abre", jan.lancadas[-1].endswith(f"/chat/conversa/{k_de(4)}?auto=1"),
             jan.lancadas)
        abertas = {k: a["hwnd"] for k, a in chat.abertas.items()}
        jan.fg = abertas[k_de(4)]
        lcu.convs.append(conversa(7))
        evento_msg(chat, 7)
        chat.processar()
        caso("janela do chat em primeiro plano (ele digitando): a nova espera", len(jan.lancadas) == 2 and chat.pendentes)
        jan.fg = 999
        chat.invalidar()
        chat.processar()
        caso("foco saiu do chat: a pendente abre", len(jan.lancadas) == 3 and not chat.pendentes, jan.lancadas)
        caso("fase desconhecida (coletor sem evento): lê a fase na LCU antes de abrir",
             (chat.fase(None), chat.pode_abrir_sozinha()[0])[1] is True and "/lol-gameflow/v1/gameflow-phase" in lcu.gets)
        chat.fase("EndOfGame")

        # salas, minhas e históricas nunca abrem
        n = len(jan.lancadas)
        chat.fechar(k_de(7))
        evento_msg(chat, SALAS[0]["id"], tipo_msg="groupchat")
        evento_msg(chat, SALAS[2]["id"])
        evento_msg(chat, 2, de=EU["pid"])
        evento_msg(chat, 2, historico=True)
        evento_msg(chat, 2, tipo="Update")
        chat.processar()
        caso("sala do champ select, mensagem minha, histórica ou Update: nada abre", len(jan.lancadas) == n, jan.lancadas[n:])
        lcu.convs.append(conversa(2, ultima_de=EU["pid"]))
        chat._me = None    # o websocket chega antes de o coletor ler /me
        chat.invalidar()
        evento_msg(chat, 2, de="desconhecido@x")
        chat.processar()
        caso("última mensagem da conversa é minha (enviada pelo client): nada abre", len(jan.lancadas) == n)
        chat.fechar_tudo()
        chat.processar()                       # base das não lidas com tudo fechado
        lcu.convs[0]["unreadMessageCount"] += 1
        chat.invalidar()
        chat.processar()
        caso("sem o evento (formato [S]): não lida que sobe numa conversa sem janela abre ela",
             jan.lancadas[-1].endswith(f"/chat/conversa/{k_de(1)}?auto=1") and len(jan.lancadas) == n + 1, jan.lancadas[n:])
        chat.invalidar()
        chat.processar()
        caso("a mesma não lida não abre de novo", len(jan.lancadas) == n + 1)

        # ---- 3 conversas no máximo ----
        chat.fechar_tudo()
        jan.fechadas.clear()
        for i in (1, 3, 4, 5):
            rel.t += 1
            s, r = post(f"/chat/abrir/{k_de(i)}")
            chat.processar()
        convs = [k for k in chat.abertas if k != "amigos"]
        caso("clique abre (202) e a 4ª conversa fecha a mais antiga", s == 202 and len(convs) == 3 and k_de(1) not in convs
             and len(jan.fechadas) == 1, (convs, jan.fechadas))
        slots = sorted(a["slot"] for k, a in chat.abertas.items() if k != "amigos")
        caso("slots das 3 conversas: 0, 1, 2 (sem empilhar no mesmo lugar)", slots == [0, 1, 2], slots)
        caso("janela aberta por clique não leva ?auto=1 (o campo de texto ganha o cursor)",
             not any(u.endswith("auto=1") for u in jan.lancadas[-4:]))
        caso("só a janela aberta sozinha pede para devolver o foco",
             all(sf == u.endswith("auto=1") for u, sf in zip(jan.lancadas, jan.sem_foco)) and any(jan.sem_foco))
        post("/chat/abrir/amigos")
        chat.processar()
        caso("lista de amigos abre na própria janela e liga 'lista aberta'", "amigos" in chat.abertas and chat.lista_aberta
             and jan.lancadas[-1] == "http://127.0.0.1:8799/chat/amigos")
        # o bloco "Client compacto" promete: desligado, o coletor deixa de abrir conversa nova sozinho (mesmo com a lista
        # aberta antes); sem aviso do plugin ainda (coletor reiniciou: None), a lista aberta nesta sessão vale
        chat.compacto = False
        desligado = chat.pode_abrir_sozinha()
        chat.compacto = None
        sem_aviso = chat.pode_abrir_sozinha()
        chat.compacto = True
        caso("compacto desligado ({compacto:false}) não abre sozinho nem com a lista aberta; sem aviso (None) a lista vale",
             desligado[0] is False and "desligado" in desligado[1] and sem_aviso[0] is True, (desligado, sem_aviso))
        # chat ao lado do compacto (passo 13): {compacto:true, lateral:true} = o plugin mostra a conversa; aqui nada abre
        st = post("/chat/plugin", {"compacto": True, "lateral": True})[0]
        com_lateral = chat.pode_abrir_sozinha()
        post("/chat/plugin", {"compacto": True})
        caso("{compacto:true, lateral:true} não abre nada sozinho (senão a conversa abre em dobro); sem lateral volta a abrir",
             st == 200 and com_lateral[0] is False and "ao lado" in com_lateral[1] and not chat.lateral
             and chat.pode_abrir_sozinha()[0] is True, (com_lateral, chat.lateral))
        n = len(jan.lancadas)
        post(f"/chat/abrir/{k_de(5)}")
        chat.processar()
        caso("clicar em quem já tem janela: mostra a dela, não abre outra", len(jan.lancadas) == n and jan.mostradas)
        h5 = chat.abertas[k_de(5)]["hwnd"]
        post(f"/chat/minimizar/{k_de(5)}")
        post("/chat/fechar/amigos")
        chat.processar()
        caso("– minimiza e ✕ fecha pelo coletor", h5 in jan.minimizadas and "amigos" not in chat.abertas)
        jan.abertas.pop(h5)   # o ✕ do Windows fechou a janela
        chat.processar()
        caso("janela fechada pelo Windows sai da conta", k_de(5) not in chat.abertas)

        # ---- geometria ----
        dentro = True
        for util, esc_ in (((0, 0, 1920, 1040), 1.0), ((2560, 595, 1920, 1152), 1.25), ((0, 0, 1366, 728), 1.0),
                           ((-1280, 0, 1280, 984), 1.0), ((0, 0, 800, 560), 1.5)):
            rs = [cj.layout(util, esc_, "amigos")] + [cj.layout(util, esc_, "conversa", i) for i in range(3)]
            for x, y, w, h_ in rs:
                dentro &= util[0] <= x and util[1] <= y and x + w <= util[0] + util[2] and y + h_ <= util[1] + util[3]
        caso("toda janela cabe na área útil (5 monitores, inclusive à esquerda e pequeno)", dentro)
        rs = [cj.layout((0, 0, 1920, 1040), 1.0, "amigos")] + [cj.layout((0, 0, 1920, 1040), 1.0, "conversa", i) for i in range(3)]
        sobre = any(a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]
                    for i, a in enumerate(rs) for b in rs[i + 1:])
        caso("monitor de 1920: lista e 3 conversas lado a lado, sem sobrepor", not sobre, rs)
        caso("tamanho da lista e da conversa = protótipo (300×560, 360×420) + moldura do Edge",
             rs[0][2:] == (316, 600) and rs[1][2:] == (376, 460), rs[:2])

        # ---- envio, convite, lida: só por POST, rota e corpo certos ----
        lcu.escritas.clear()
        s, r = post(f"/chat/enviar/{k_de(1)}", {"texto": "  bora  "})
        caso("enviar: 1 POST na conversa com {body, type: chat}", s == 200 and r["ok"] and lcu.escritas == [
            ("POST", f"/lol-chat/v1/conversations/{quote(AMIGOS[0]['pid'], safe='')}/messages", {"body": "bora", "type": "chat"})],
             lcu.escritas)
        lcu.escritas.clear()
        s1, _ = post(f"/chat/enviar/{k_de(1)}", {"texto": "   "})
        s2, _ = post(f"/chat/enviar/{k_de(1)}", {"texto": "x" * 501})
        s3, _ = post(f"/chat/enviar/{k_de(1)}", [1, 2])
        caso("mensagem vazia, longa demais ou corpo errado: 400 e nada escrito", (s1, s2, s3) == (400, 400, 400)
             and lcu.escritas == [], (s1, s2, s3))
        lcu.falha_envio_404 = True
        s, r = post(f"/chat/enviar/{k_de(3)}", {"texto": "oi"})
        pid3 = AMIGOS[2]["pid"]
        caso("amigo sem conversa: 404, cria a conversa e manda de novo (uma vez)", s == 200 and [e[1] for e in lcu.escritas] == [
            f"/lol-chat/v1/conversations/{quote(pid3, safe='')}/messages", "/lol-chat/v1/conversations",
            f"/lol-chat/v1/conversations/{quote(pid3, safe='')}/messages"] and lcu.escritas[1][2] == {"id": pid3, "type": "chat"},
             lcu.escritas)
        lcu.escritas.clear()
        s, r = post(f"/chat/convidar/{k_de(4)}")
        caso("convidar: POST das convocações com o summonerId", s == 200 and lcu.escritas == [
            ("POST", "/lol-lobby/v2/lobby/invitations", [{"toSummonerId": 1004}])], lcu.escritas)
        chat.invalidar()
        b = {a["nome"]: a for a in json.loads(get("/chat/api/amigos")[1])["online"]}["Dona Bela"]["convidar"]
        caso("depois do convite o botão vira 'convidado' (cinza)", b["rotulo"] == "convidado" and not b["ok"], b)
        lcu.escritas.clear()
        lcu.lobby = None
        chat.invalidar()
        s, r = post(f"/chat/convidar/{k_de(1)}")
        caso("convidar sem lobby: 409 com o motivo e nada escrito (não cria lobby)", s == 409 and "lobby" in r["motivo"]
             and lcu.escritas == [], (s, r, lcu.escritas))
        lcu.lobby = {"localMember": {"isLeader": True}, "members": []}
        s, r = post(f"/chat/lida/{k_de(1)}")
        caso("lida: PUT na conversa ativa com o id", s == 200 and lcu.escritas == [
            ("PUT", "/lol-chat/v1/conversations/active", {"id": AMIGOS[0]["pid"]})], lcu.escritas)
        lcu.escritas.clear()
        s, _ = post(f"/chat/enviar/{k_de(1)}", {"texto": "de site"}, origem="https://site-qualquer.example")
        caso("POST com origem de site: 403 e nada escrito", s == 403 and lcu.escritas == [])
        # rotas do chat que escrevem/leem conversa: só as próprias páginas (mesma origem) ou sem Origin
        outras = ("http://localhost:3000", "http://127.0.0.1:5173", "https://plugins", f"https://127.0.0.1:{porta}")
        barradas = [(o, post(f"/chat/{acao}/{k_de(1)}", {"texto": "x"}, origem=o)[0])
                    for o in outras for acao in ("enviar", "convidar", "lida")]
        lidas = [(o, http(porta, "GET", "/chat/api/amigos", origem=o)[0]) for o in outras]
        caso("outra página local ou outro plugin: enviar/convidar/lida e a lista com as chaves dão 403, nada escrito",
             all(st == 403 for _, st in barradas + lidas) and lcu.escritas == [], (barradas, lidas, lcu.escritas))
        s_pr, _ = post(f"/chat/lida/{k_de(1)}", origem=f"http://127.0.0.1:{porta}")
        s_pl = post("/chat/plugin", {"compacto": True}, origem="https://plugins")[0]
        s_ab = post("/chat/abrir/amigos", origem="https://plugins")[0]
        s_es = http(porta, "GET", "/chat/estado", origem="https://plugins")[0]
        caso("a própria página (mesma origem) escreve; o plugin (https://plugins) segue com /chat/plugin, /chat/abrir/amigos e /chat/estado",
             s_pr == 200 and (s_pl, s_ab, s_es) == (200, 202, 200), (s_pr, s_pl, s_ab, s_es))
        lcu.escritas.clear()
        with chat._trava:
            chat.pedidos.clear()
        caso("ações desconhecidas e enviar para 'amigos': 404", post("/chat/apagar/amigos")[0] == 404
             and post("/chat/enviar/amigos", {"texto": "x"})[0] == 404 and lcu.escritas == [])

        # ---- client fechado ----
        tem_lcu[0] = False
        s, corpo, _ = get("/chat/api/amigos")
        caso("client fechado: a lista diz 'client fechado' (sem 500)", s == 200 and json.loads(corpo)["motivo"] == "client fechado")
        s, r = post(f"/chat/enviar/{k_de(1)}", {"texto": "x"})
        caso("enviar com o client fechado: 503", s == 503 and not r["ok"])
        post(f"/chat/abrir/{k_de(1)}")
        chat.processar()
        rel.t += cj.SEM_CLIENT_FECHA_S + 1
        chat.processar()
        caso("client fechado há 1 min: as janelas do chat fecham", chat.abertas == {} and len(jan.abertas) == 0, chat.abertas)
        tem_lcu[0] = True

        # ---- nada vaza ----
        tudo = "\n".join(respostas) + "\n".join(jan.lancadas) + logbuf.getvalue()
        vazou = [s for s in (SEGREDO, lcu.auth, *VALORES_SALA, *cj.PROIBIDOS, "champ-select", "post-game") if s in tudo]
        caso("credencial da LCU, senha/jwt da sala e ids de sala: em nenhuma resposta, url de janela ou log", not vazou, vazou)
        caso("log sem nome de amigo nem texto de mensagem",
             not any(s in logbuf.getvalue() for s in ("Fulano", "Dona Bela", "bora", "amigo-1")), logbuf.getvalue()[-400:])
        caso("limpo() tira os campos proibidos em qualquer profundidade",
             cj.limpo({"a": [{_CAMPO_SENHA: 1, "b": {_CAMPO_JWT: 2, "ok": 3}}]}) == {"a": [{"b": {"ok": 3}}]})

        # ---- ponte do plugin (node) ----
        ponte = (RAIZ / "pengu" / "compacto" / "chat-ponte.js").as_uri()
        script = f"""
import {{ estadoChat, abrirAmigos, avisarModo, naoLidasDaLcu, _zerarModo }} from '{ponte}';
const chamadas = [];
const f = (st, dados) => async (c, o = {{}}) => {{ chamadas.push([c, o.metodo || 'GET', o.corpo ?? null]); return {{ status: st, dados }}; }};
const r = {{}};
r.estado = await estadoChat(f(200, {{ ok: true, naoLidas: 3, abertas: ['a', 'b'], lista: true }}));
r.fora = await estadoChat(f(0, null));
r.abrir = await abrirAmigos(f(202, {{ ok: true }}));
r.abrirFora = await abrirAmigos(f(0, null));
r.modo = await avisarModo(1, f(200, {{ ok: true }}));
r.lcu = naoLidasDaLcu([{{ type: 'chat', id: 'a@br1.pvp.net', unreadMessageCount: 2 }},
  {{ type: 'championSelect', id: 's@champ-select.br1.pvp.net', unreadMessageCount: 9 }},
  {{ type: 'chat', id: 'x@champ-select.br1.pvp.net', unreadMessageCount: 5 }}, null, {{ type: 'chat', unreadMessageCount: -4 }}]);
r.chamadas = chamadas.slice();
const ch2 = [];
const g = st => async (c, o = {{}}) => {{ ch2.push([c, o.metodo || 'GET', o.corpo ?? null]); return {{ status: st, dados: {{ ok: true, naoLidas: 0 }} }}; }};
_zerarModo();
r.modoFora = await avisarModo(true, g(0));
await estadoChat(g(0));
await estadoChat(g(200));
await estadoChat(g(200));
r.ch2 = ch2;
console.log(JSON.stringify(r));
"""
        p = subprocess.run(["node", "--input-type=module", "-e", script], capture_output=True, text=True, encoding="utf-8")
        try:
            r = json.loads(p.stdout.strip().splitlines()[-1])
        except (ValueError, IndexError):
            r = {}
        caso("chat-ponte: 💬 com o contador e as janelas abertas", r.get("estado") == {
            "ok": True, "naoLidas": 3, "abertas": 2, "lista": True, "motivo": ""}, (r.get("estado"), p.stderr[-300:]))
        caso("chat-ponte: coletor fora = {ok:false, fora:true} (a tela expande e abre o chat nativo)",
             r.get("fora", {}).get("fora") is True and r.get("abrirFora", {}).get("fora") is True and r.get("abrir", {}).get("ok"))
        caso("chat-ponte: rotas e corpos certos", r.get("chamadas") == [
            ["/chat/estado", "GET", None], ["/chat/estado", "GET", None], ["/chat/abrir/amigos", "POST", {}],
            ["/chat/abrir/amigos", "POST", {}], ["/chat/plugin", "POST", {"compacto": True, "lateral": False}]] and r.get("modo") is True,
             r.get("chamadas"))
        caso("chat-ponte: não lidas pela LCU só das conversas diretas", r.get("lcu") == 2, r.get("lcu"))
        caso("chat-ponte: modo avisado com o coletor fora é reenviado pelo 💬 quando ele volta (uma vez)",
             r.get("modoFora") is False and r.get("ch2") == [
                 ["/chat/plugin", "POST", {"compacto": True, "lateral": False}], ["/chat/estado", "GET", None], ["/chat/estado", "GET", None],
                 ["/chat/plugin", "POST", {"compacto": True, "lateral": False}], ["/chat/estado", "GET", None]], r.get("ch2"))
        p = subprocess.run(["node", "--check", str(RAIZ / "painel" / "chat" / "chat.js")], capture_output=True, text=True)
        caso("chat.js sem erro de sintaxe (node --check)", p.returncode == 0, p.stderr[-300:])
        # "marcar como lida" (PUT conversations/active [S]) só depois de interação de verdade na janela aberta sozinha
        r_auto, r_clique = (_lida_chat_js("?auto=1"), _lida_chat_js(""))
        caso("chat.js: janela aberta sozinha (?auto=1) com o foco não marca lida; evento falso também não; clique de verdade marca",
             r_auto.get("antes") == 0 and r_auto.get("falso") == 0 and r_auto.get("depois") == 1, r_auto)
        caso("chat.js: janela aberta por clique dele marca lida ao ganhar o foco", r_clique.get("antes") == 1, r_clique)
    finally:
        srv.parar()

    ok = sum(p for _, p in casos)
    print(f"{ok}/{len(casos)} ok")
    return 0 if ok == len(casos) else 1


# ---------- com o Edge ----------

def _jogo_aberto():
    r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq League of Legends.exe"], capture_output=True, text=True,
                       errors="replace")
    return "League of Legends.exe" in r.stdout


def _servidor_falso():
    lcu = LCUFalsa()
    pasta = RAIZ / "temp" / "chat-janelas"
    chat = cj.ChatJanelas(lambda: lcu, janelas=cj.JanelasEdge(perfil=pasta / "perfil", pidfile=pasta / "edge.pid"),
                          ticker=False, agora_ms=lambda: 10_000_000)
    tmp = Path(tempfile.mkdtemp(prefix="teste-chat-"))
    srv = servidor_local.ServidorLocal(porta=0, config=tmp / "config.json", db=tmp / "nao.db")   # nunca 8765/8766
    if not srv.iniciar():
        raise SystemExit("servidor de teste não subiu")
    chat.base = f"http://127.0.0.1:{srv.httpd.server_address[1]}"
    chat.instalar(srv)
    chat.compacto = True
    return lcu, chat, srv


def prints():
    """Edge headless (sem janela): as duas páginas com a LCU falsa, para comparar com o protótipo (tela 5)"""
    import janela_painel
    edge = janela_painel.achar_edge()
    pasta = RAIZ / "temp" / "chat-janelas"
    pasta.mkdir(parents=True, exist_ok=True)
    _, chat, srv = _servidor_falso()
    try:
        # o headless não desce a janela abaixo de ~500 px de largura: as páginas vão em iframes do tamanho exato
        quadro = pasta / "quadro.html"
        quadro.write_text(
            "<!doctype html><body style='margin:0;background:#0d1117;display:flex;gap:24px;padding:16px;align-items:flex-start'>"
            f"<iframe src='{chat.base}/chat/amigos' width='{cj.TAM_AMIGOS[0]}' height='{cj.TAM_AMIGOS[1]}' style='border:0'></iframe>"
            f"<iframe src='{chat.base}/chat/conversa/{k_de(1)}?auto=1' width='{cj.TAM_CONVERSA[0]}' "
            f"height='{cj.TAM_CONVERSA[1]}' style='border:0'></iframe></body>", encoding="utf-8")
        saida = pasta / "tela-5.png"
        saida.unlink(missing_ok=True)
        subprocess.run([str(edge), "--headless=new", "--disable-gpu", "--hide-scrollbars",
                        f"--user-data-dir={pasta / 'perfil-headless'}", "--window-size=740,600",
                        "--virtual-time-budget=4000", f"--screenshot={saida}", quadro.as_uri()],
                       capture_output=True, timeout=60, creationflags=janela_painel.NAO_JANELA)
        print("tela 5", saida, saida.exists())
    finally:
        srv.parar()
    return 0


def real():
    """abre a lista e uma conversa em janelas de verdade do Edge (perfil em temp/), mede foco e posição e fecha"""
    if _jogo_aberto():
        print("League of Legends.exe aberto: a prova com janela fica para depois da partida")
        return 2
    import ctypes
    import janela_painel
    sys.stdout.reconfigure(encoding="utf-8")
    lcu, chat, srv = _servidor_falso()
    try:
        u = ctypes.windll.user32
        fg0 = u.GetForegroundWindow()
        t0 = time.monotonic()
        hwnd = chat.abrir("amigos")
        dt = time.monotonic() - t0
        if not hwnd:
            print("FALHOU: a janela não apareceu")
            return 1
        time.sleep(1.0)
        fg1 = u.GetForegroundWindow()
        util, esc_ = chat.janelas.area()
        alvo = cj.layout(util, esc_, "amigos")
        print(f"abriu em {dt:.1f} s; hwnd {hwnd}; pid do Edge {chat.janelas.pid}")
        print(f"área útil {util} escala {esc_}; alvo {alvo}; janelas do pid {janela_painel.janelas_do_pid(chat.janelas.pid)}")
        print(f"1ª janela: foco antes {fg0}, depois {fg1}: {'ROUBOU o foco' if fg1 == hwnd else 'não roubou o foco'}")
        hwnd2 = chat.abrir(cj.chave(AMIGOS[0]["pid"]), auto=True)
        time.sleep(1.5)
        fg2 = u.GetForegroundWindow()
        print(f"2ª janela (entregue ao mesmo Edge): hwnd {hwnd2}; {'ROUBOU o foco' if fg2 == hwnd2 else 'não roubou o foco'}")
        rects = janela_painel.janelas_do_pid(chat.janelas.pid)
        print("janelas do pid:", rects)
        dentro = bool(rects) and all(util[0] <= x and util[1] <= y and x + w <= util[0] + util[2] and y + h <= util[1] + util[3]
                                     for x, y, w, h in rects)
        print("dentro da área útil:", dentro)
        chat.fechar_tudo()
        time.sleep(2.0)
        sobrou = janela_painel.janelas_do_pid(chat.janelas.pid) if chat.janelas.pid else []
        print("depois de fechar, janelas do pid:", sobrou)
        return 0 if dentro and hwnd2 and not sobrou else 1
    finally:
        srv.parar()


if __name__ == "__main__":
    if "--real" in sys.argv:
        sys.exit(real())
    if "--prints" in sys.argv:
        sys.exit(prints())
    sys.exit(principal())
