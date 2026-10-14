# servidor HTTP local do lol-client (plano v2, passos 8, 10 e 20): 127.0.0.1:8765, só loopback.
#   GET  /                 painel da 2ª tela (painel/index.html, com o estado atual embutido)
#   GET  /painel.css|js    arquivos do painel
#   GET  /estado           estado ao vivo (JSON); sem partida -> {"partida": false}
#   GET  /mentor/<gameId>  texto do mentor (Mentor.rota_http do passo 20; sem ele, tabela `mentor`)
#   POST /mentor/...       encaminhado ao Mentor.rota_http (gerar de novo, pergunta, ao vivo)
#   GET  /config           preferências do coach (dados/config.json)
#   POST /config           mescla as chaves conhecidas e devolve a config inteira; aceita o cfg inteiro do
#                          plugin (as chaves do coach dentro de "coach") ou só as chaves soltas
#   GET  /contexto/<gameId> contexto do coletor para as lições do pós-jogo (coach.contexto_partida)
#   GET  /licoes/<gameId>  as 3 lições da partida (coach.licoes_partida)
#   GET  <rotas extras>    o coletor pendura outras (ex.: /draft, /revisao/<gameId>)
#   GET/POST /chat/...     janelas do chat fora do client (coletor/chat_janelas.py pendura em rotas_get/rotas_post)
#   POST /aceite/plugin    sinal e diagnóstico do aceite do plugin (aviso_partida.rota_aceite; coletor.py pendura)
# CORS: só origem local (o client roda em https://127.0.0.1:<porta da LCU>; o Pengu em
# https://plugins); site qualquer no navegador não lê nem muda nada. Host fora de 127.0.0.1/localhost
# é recusado (rebinding de DNS).
import json
import logging
import sqlite3
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import avisos  # noqa: E402
import banco  # noqa: E402

PORTA = 8765
PAINEL = banco.RAIZ / "painel"
CONFIG = banco.RAIZ / "dados" / "config.json"
ARQUIVOS = {"/painel.css": ("painel.css", "text/css; charset=utf-8"),
            "/painel.js": ("painel.js", "text/javascript; charset=utf-8")}
HOSTS_OK = {"127.0.0.1", "localhost", "plugins", "riot"}
# chaves e tipos aceitos no POST /config; quem liga cada módulo é a seção do 7b (Pengu)
CONFIG_PADRAO = {
    "painelAoVivo": True,      # janela do painel na 2ª tela (passo 11)
    "amostrasAoVivo": True,    # amostra de 10 s no banco (passo 8)
    "voz": True,               # passo 12
    "tomVoz": "serio",         # "serio" | "descontraido"
    "minimapa": True,          # passos 13–15c: captura, jungler e alertas de posição
    "overlayMinimapa": True,   # passo 15b: área provável do jungler por cima do minimapa (F8 alterna)
    "alertasTela": True,       # passo 15c: moldura na borda da tela
    "feiticos": True,          # passo 15e: OCR do chat e atalho F7 + numérico 1..5
    "carregamento": True,      # passo 18: os 10 pela Riot API na tela de carregamento
    "mentor": True,            # passo 20
    "mentorModelo": "sonnet",  # passo 20: vencedor da comparação de 13/10/2026 (sonnet, effort medium)
    "mentorEffort": "medium",
    # tipos calados por destino (avisos.TIPOS_LIGAVEIS; "tela" = painel + moldura); lista antiga = os dois
    "avisosDesligados": {"voz": [], "tela": []},
    # plano voz/foco, passo 2b: janelinha de "partida encontrada" fora do client (coletor/aviso_partida.py)
    "aceiteFlutuante": True,
    # atraso do aceite automático do plugin, espelhado (cfg.aceite.atrasoS); None = aceite automático
    # desligado (a janelinha conta até o ready check expirar). Padrão = PADRAO.aceite.atrasoS do plugin
    "aceiteAtrasoS": 10,
    # escolhas das regras de aviso da calibração de 14/10/2026 (roadmap/2026-10-14-calibrar-avisos.md, passo 7);
    # padrão = o comportamento daquele dia. Mesmos nomes e padrões no PADRAO.coach do plugin (pengu/config.js)
    "gankOutraRota": True,         # gank nas outras rotas (amarelo, o Gabriel avisa os colegas); o da minha rota fica
    "junglerLonge": "painel",      # jungler longe de mim: "painel" (só a 2ª tela) | "tudo" (voz e borda) | "nada"
    "midSumiuFiltro": True,        # "mid sumiu" só na fase de rotas e sem cerco/luta/eu morto ou na base (D1/D2)
    "cortarFalaRepetida": True,    # a voz pula a mesma frase dita há < 60 s (urgente < 10 s) (D4/D12)
    "overlayCor": "vermelho",      # cor da mancha do jungler: overlay_minimapa.CORES
    "overlayForca": "normal",      # opacidade: overlay_minimapa.FORCAS (normal = ALPHA/ALPHA_MIN)
    "overlaySuave": True,          # a mancha cresce e some aos poucos (TAU_S); desligado = muda na hora
}
ATRASO_MAX_S = 60
# valores aceitos das chaves de texto; fora disto = o padrão (na leitura do arquivo e no POST). As do overlay
# são as chaves de overlay_minimapa.CORES/FORCAS (conferido pelo teste-alertas.py; o servidor não importa o
# overlay, que carrega cv2 e a user32)
ESCOLHAS = {"tomVoz": ("serio", "descontraido"), "mentorModelo": ("sonnet", "haiku", "opus"),
            "mentorEffort": ("low", "medium", "high"), "junglerLonge": ("painel", "tudo", "nada"),
            "overlayCor": ("vermelho", "laranja", "roxo"), "overlayForca": ("sutil", "normal", "forte")}
log = logging.getLogger("coletor.servidor")
_trava_cfg = threading.Lock()


def ler_config(caminho=CONFIG):
    """config do coach: o padrão mesclado com o salvo (chave desconhecida ou de tipo errado some)"""
    try:
        salvo = json.loads(Path(caminho).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        salvo = {}
    cfg = {k: (salvo[k] if isinstance(salvo, dict) and type(salvo.get(k)) is type(v) else v)
           for k, v in CONFIG_PADRAO.items()}
    cfg["avisosDesligados"] = _desligados(salvo.get("avisosDesligados") if isinstance(salvo, dict) else None)
    if isinstance(salvo, dict) and "aceiteAtrasoS" in salvo:   # número ou null: o teste de tipo acima não serve
        a = _atraso(salvo["aceiteAtrasoS"])
        cfg["aceiteAtrasoS"] = CONFIG_PADRAO["aceiteAtrasoS"] if a is _INVALIDO else a
    _escolhas_validas(cfg)
    return {k: list(v) if isinstance(v, list) else v for k, v in cfg.items()}  # lista do padrão não vaza


def _escolhas_validas(cfg):
    """valor de texto fora de ESCOLHAS volta ao padrão (antes só o POST conferia: arquivo editado à mão ou
    gravado por versão futura chegava à partida)"""
    for k, validos in ESCOLHAS.items():
        if cfg[k] not in validos:
            cfg[k] = CONFIG_PADRAO[k]


_INVALIDO = object()


def _atraso(v):
    """aceiteAtrasoS: None (aceite automático desligado) ou número 0–ATRASO_MAX_S; outra coisa = _INVALIDO"""
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or not 0 <= v <= ATRASO_MAX_S:
        return _INVALIDO
    return v


def _desligados(v):
    """formato salvo de avisosDesligados: {voz: [...], tela: [...]} ordenado; migra a lista antiga"""
    return {d: sorted(s) for d, s in avisos.normalizar_desligados(v).items()}


def salvar_config(parcial, caminho=CONFIG):
    parcial = dict(parcial or {})
    if isinstance(parcial.get("coach"), dict):  # cfg inteiro do plugin: as chaves do coach vêm em "coach"
        parcial.update(parcial["coach"])
    with _trava_cfg:
        cfg = ler_config(caminho)
        for k, v in parcial.items():
            if k == "avisosDesligados":    # plugin antigo ainda manda a lista: migra em vez de descartar
                if isinstance(v, (list, dict)):
                    cfg[k] = _desligados(v)
            elif k == "aceiteAtrasoS":         # null = aceite desligado; valor inválido mantém o atual
                a = _atraso(v)
                if a is not _INVALIDO:
                    cfg[k] = a
            elif k in CONFIG_PADRAO and type(v) is type(CONFIG_PADRAO[k]):
                cfg[k] = [x for x in v if isinstance(x, str)] if isinstance(v, list) else v
        _escolhas_validas(cfg)
        caminho = Path(caminho)
        caminho.parent.mkdir(parents=True, exist_ok=True)
        tmp = caminho.with_suffix(".tmp")
        tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(caminho)
        return cfg


def mentor_do_banco(db):
    """f(game_id) -> última linha da tabela `mentor` da partida como dict, ou None
    (sem tabela ainda: o passo 20 cria)"""
    def f(game_id):
        try:
            c = banco.abrir_leitura(db)
        except FileNotFoundError:
            return None
        try:
            cur = c.execute("select * from mentor where game_id = ? order by rowid desc limit 1", (game_id,))
            linha = cur.fetchone()
            return dict(zip([d[0] for d in cur.description], linha)) if linha else None
        except sqlite3.OperationalError:
            return None
        finally:
            c.close()
    return f


def origem_ok(origem):
    if not origem:
        return True  # sem Origin: navegação direta, curl, o próprio painel
    try:
        return urlsplit(origem).hostname in HOSTS_OK
    except ValueError:
        return False


# /chat/*: as janelas do chat escrevem na LCU em nome dele (enviar, convidar, lida) e leem conversas. Só as próprias
# páginas (mesma origem: http://127.0.0.1|localhost:<esta porta>) ou pedido sem Origin (navegação, GET de mesma
# origem). Outra página local ou outro plugin do Pengu não lê as chaves nem manda mensagem. O plugin só usa estas:
CHAT_ORIGEM_LIVRE = ("/chat/plugin", "/chat/abrir/amigos", "/chat/estado")


def origem_chat_ok(rota, origem, porta):
    if not rota.startswith("/chat/") or rota in CHAT_ORIGEM_LIVRE or not origem:
        return True
    try:
        u = urlsplit(origem)
        return u.scheme == "http" and u.hostname in ("127.0.0.1", "localhost") and u.port == porta
    except ValueError:
        return False


# /aceite/*: o plugin diz "não aceitar nesta vez" e manda o diagnóstico do aceite (aviso_partida.rota_aceite); a
# reserva do coletor aceita a partida sozinha com base nisso. Inverso do /chat/: só a página do client (https em
# 127.0.0.1/localhost, a porta da LCU), o Pengu (https://plugins, riot) ou pedido sem Origin. As páginas do próprio
# coletor (http://127.0.0.1:<esta porta>) e qualquer outra página local em http não escrevem aqui.
def origem_aceite_ok(rota, origem):
    if not rota.startswith("/aceite/") or not origem:
        return True
    try:
        u = urlsplit(origem)
        return u.hostname in ("plugins", "riot") or (u.scheme == "https" and u.hostname in ("127.0.0.1", "localhost"))
    except ValueError:
        return False


class _Handler(BaseHTTPRequestHandler):
    server_version = "lol-client"
    sys_version = ""

    def log_message(self, fmt, *args):  # sem log por requisição (o painel consulta 1/s)
        pass

    # -- respostas --
    def _cors(self):
        o = self.headers.get("Origin")
        if o and origem_ok(o):
            self.send_header("Access-Control-Allow-Origin", o)
            self.send_header("Vary", "Origin")

    def _enviar(self, codigo, corpo, tipo="application/json; charset=utf-8"):
        if isinstance(corpo, (dict, list)) or corpo is None:
            corpo = json.dumps(corpo, ensure_ascii=False)
        dados = corpo.encode("utf-8") if isinstance(corpo, str) else corpo
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(dados)))
        self.send_header("Cache-Control", "no-store")
        self._cors()
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(dados)

    def _barrar(self):
        """True se a requisição não pode seguir (host de fora ou origem de site)"""
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
        if host not in ("127.0.0.1", "localhost"):
            self._enviar(403, {"erro": "host"})
            return True
        if not origem_ok(self.headers.get("Origin")):
            self._enviar(403, {"erro": "origem"})
            return True
        if not origem_chat_ok(urlsplit(self.path).path, self.headers.get("Origin"), self.server.server_address[1]):
            self._enviar(403, {"erro": "origem"})
            return True
        if not origem_aceite_ok(urlsplit(self.path).path, self.headers.get("Origin")):
            self._enviar(403, {"erro": "origem"})
            return True
        return False

    # -- verbos --
    def do_OPTIONS(self):
        if self._barrar():
            return
        self.send_response(204)
        self._cors()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if self.headers.get("Access-Control-Request-Private-Network"):  # Chromium: acesso à rede local
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        if self._barrar():
            return
        srv = self.server.dono
        rota = urlsplit(self.path).path
        try:
            if rota in ("/", "/index.html"):
                html = (PAINEL / "index.html").read_text(encoding="utf-8")
                # estado embutido: o 1º quadro já desenha (print headless e abertura da janela)
                embut = json.dumps(srv.estado(), ensure_ascii=False).replace("</", "<\\/")
                html = html.replace("<!--ESTADO-->", f"<script>window.__estado = {embut};</script>")
                self._enviar(200, html, "text/html; charset=utf-8")
            elif rota in ARQUIVOS:
                nome, tipo = ARQUIVOS[rota]
                self._enviar(200, (PAINEL / nome).read_bytes(), tipo)
            elif rota == "/estado":
                self._enviar(200, srv.estado())
            elif rota == "/config":
                self._enviar(200, ler_config(srv.config))
            elif rota.startswith("/mentor/") and srv.mentor_http:
                codigo, corpo = srv.mentor_http("GET", self.path, b"")
                self._enviar(codigo, corpo)
            elif rota.startswith("/mentor/"):
                try:
                    gid = int(rota.split("/")[2])
                except (IndexError, ValueError):
                    self._enviar(400, {"erro": "gameId inválido"})
                    return
                r = srv.mentor(gid) if srv.mentor else None
                self._enviar(200 if r else 404, {"gameId": gid, "mentor": r})
            elif rota.startswith(("/contexto/", "/licoes/")):
                self._enviar(*srv.licoes_ou_contexto(rota))
            elif any(rota.startswith(p) for p in srv.rotas_get):
                prefixo = next(p for p in srv.rotas_get if rota.startswith(p))
                self._enviar(*srv.rotas_get[prefixo](rota))
            elif rota == "/favicon.ico":
                self._enviar(204, b"", "image/x-icon")
            else:
                self._enviar(404, {"erro": "não existe"})
        except Exception as e:
            log.warning("GET %s: %s", rota, e)
            self._enviar(500, {"erro": "interno"})

    do_HEAD = do_GET

    def do_POST(self):
        rota = urlsplit(self.path).path
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = 0
        # lê o corpo ANTES de recusar: responder 403 com o corpo ainda no socket faz o Windows abortar a conexão do
        # cliente (WinError 10053) em vez de entregar o 403
        bruto = self.rfile.read(min(n, 65536)) if n > 0 else b""
        if self._barrar():
            return
        srv = self.server.dono
        prefixo = next((p for p in srv.rotas_post if rota.startswith(p)), None)
        if prefixo:  # ex.: /chat/ (coletor/chat_janelas.py): f(rota, corpo bruto) -> (status, corpo[, tipo])
            try:
                self._enviar(*srv.rotas_post[prefixo](rota, bruto))
            except Exception as e:
                log.warning("POST %s: %s", rota, e)
                self._enviar(500, {"erro": "interno"})
            return
        if rota.startswith("/mentor/") and srv.mentor_http:
            try:
                codigo, corpo = srv.mentor_http("POST", self.path, bruto)
            except Exception as e:
                log.warning("POST %s: %s", rota, e)
                codigo, corpo = 500, {"erro": "interno"}
            self._enviar(codigo, corpo)
            return
        if rota != "/config":
            self._enviar(404, {"erro": "não existe"})
            return
        try:
            corpo = json.loads(bruto or b"{}")
            if not isinstance(corpo, dict):
                raise ValueError("corpo não é objeto")
        except ValueError as e:
            self._enviar(400, {"erro": f"json inválido: {e}"})
            return
        cfg = salvar_config(corpo, srv.config)
        log.info("config do coach: %s", cfg)
        if srv.ao_config:  # aplica na partida em andamento, sem esperar a próxima
            try:
                srv.ao_config(cfg)
            except Exception as e:
                log.warning("config não aplicada ao vivo: %s", e)
        self._enviar(200, cfg)


class ServidorLocal:
    """estado: f() -> dict (AoVivo.estado). /mentor…: mentor_http(metodo, caminho, corpo) -> (status, dict)
    (Mentor.rota_http, GET e POST); sem ele, GET lê a última linha da tabela `mentor` em `db`
    (mentor: f(game_id) -> dict|None troca essa leitura). iniciar() sobe numa thread; False = porta ocupada."""

    def __init__(self, estado=None, mentor=None, db=banco.DB_PADRAO, porta=PORTA, config=CONFIG, mentor_http=None,
                 ao_config=None, rotas_get=None, garantir_partida=None, rotas_post=None):
        self.estado = estado or (lambda: {"partida": False})
        self.db = db
        self.mentor = mentor or mentor_do_banco(db)
        self.mentor_http = mentor_http
        self.porta = porta
        self.config = config
        self.ao_config = ao_config            # f(cfg) depois de cada POST /config
        self.rotas_get = dict(rotas_get or {})  # {prefixo: f(caminho) -> (status, dict)}
        self.rotas_post = dict(rotas_post or {})  # {prefixo: f(caminho, corpo bruto) -> (status, dict)} (/chat/)
        # f(gameId) -> bool: o pós-jogo pede o contexto no EndOfGame, antes do backfill (5–160 s depois)
        # gravar a partida; o coletor busca na LCU na hora (só GET)
        self.garantir_partida = garantir_partida
        self.httpd = None
        self.thread = None

    def licoes_ou_contexto(self, rota):
        """GET /contexto/<gameId> (o JSON que o pós-jogo do client junta às lições) e /licoes/<gameId>"""
        try:
            gid = int(rota.rstrip("/").split("/")[2])
        except (IndexError, ValueError):
            return 400, {"erro": "gameId inválido"}
        import coach  # noqa: PLC0415 (só quando pedem: o servidor sobe sem ele)

        def no_banco():
            c_ = banco.abrir_leitura(self.db)
            try:
                return c_.execute("select 1 from partidas where game_id=? and tem_timeline=1", (gid,)).fetchone()
            finally:
                c_.close()
        try:
            if not no_banco() and not (self.garantir_partida and self.garantir_partida(gid)):
                # sem a partida (ou a linha do tempo) no banco ainda: o pós-jogo tenta de novo em alguns s
                return 404, {"erro": "partida ainda fora do banco", "gameId": gid, "tentarDeNovoS": 5}
            c = banco.abrir_leitura(self.db)
        except FileNotFoundError:
            return 404, {"erro": "sem banco"}
        try:
            if rota.startswith("/licoes/"):
                r = coach.licoes_partida(c, gid)
                return (404 if "erro" in r else 200), r
            return 200, coach.contexto_partida(c, gid)
        finally:
            c.close()

    def iniciar(self):
        try:
            self.httpd = ThreadingHTTPServer(("127.0.0.1", self.porta), _Handler)
        except OSError as e:
            log.warning("servidor local: porta %s ocupada (%s)", self.porta, e)
            return False
        self.httpd.daemon_threads = True
        self.httpd.dono = self
        self.thread = threading.Thread(target=self.httpd.serve_forever, name="servidor-local", daemon=True)
        self.thread.start()
        log.info("servidor local em http://127.0.0.1:%s", self.porta)
        return True

    def parar(self):
        if self.httpd:
            self.httpd.shutdown()
            self.httpd.server_close()
            self.httpd = None
