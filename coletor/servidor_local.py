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
#   GET  /resumos?desde=<gameId> as partidas próprias no formato do acumulador do plugin (pengu/historico.js; só leitura,
#                          só agregado próprio; resumos_do_banco), para a importação uma vez por abertura do client
#   GET  <rotas extras>    o coletor pendura outras (ex.: /draft, /revisao/<gameId>); as /chat/* das janelas do chat
#                          fora do client saíram em 19/10/2026 (Fase 2 de roadmap/2026-10-17-plugin-pengu-primeiro.md)
#   POST /aceite/plugin    sinal e diagnóstico do aceite do plugin (aviso_partida.rota_aceite; coletor.py pendura)
#   POST /compacto/expansoes registro das saídas do client compacto (expansoes.rota_expansoes; coletor.py pendura)
#   POST /atualizar        {versao}: baixa da origem fixa, confere hash e troca plugin e complemento (atualizar.Atualizador;
#                          coletor.py pendura, junto com GET /atualizar/estado); recurso "atualizar" no /ola
#   GET  /ola              aperto de mão do plugin (pengu/coach.js): {app, versao, recursos, edicao, pacote}; recursos
#                          calculados na hora do que está pendurado (rotas e o que o dono declarou), nunca lista fixa, menos
#                          o que a edição pública não leva (instalacao.ocultos); versao = a da ponte (VERSAO_PONTE), pacote =
#                          a do pengu/versao.js. Com Origin do client ou do Pengu conta como contato do plugin (reserva do
#                          aceite, coletor.py _sinal_aceite)
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
from urllib.parse import parse_qs, urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import avisos  # noqa: E402
import banco  # noqa: E402
import instalacao  # noqa: E402

PORTA = 8765
# aperto de mão (GET /ola): o plugin só fala com quem responde este app (porta 8765 de outro programa = ausente)
APP = "lol-client-coletor"
VERSAO_PONTE = 1
# recursos que o dono do servidor (coach_vivo.Coach) declara: não são rotas, são módulos do coach ao vivo
RECURSOS_COACH = ("painel", "voz", "alertas", "minimapa", "feiticos", "carregamento")
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
    "feiticos": True,          # passo 15e: OCR do chat e atalho F7 (batidas; numérico 1..5 opcional)
    "carregamento": True,      # passo 18: os 10 pela Riot API na tela de carregamento
    "mentor": True,            # passo 20
    "mentorModelo": "sonnet",  # passo 20: vencedor da comparação de 13/10/2026 (sonnet, effort medium)
    "mentorEffort": "medium",
    # tipos calados por destino (avisos.TIPOS_LIGAVEIS; "tela" = painel + moldura); lista antiga = os dois.
    # "adversario_voltou" nasce sem voz (pedido do Gabriel, 15/10/2026: "não precisa nem de aviso de voz"); a caixa
    # da voz nas Configurações liga de novo. Mesmo padrão no PADRAO.coach do plugin (pengu/config.js, VERSAO 4)
    "avisosDesligados": {"voz": ["adversario_voltou"], "tela": []},
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
    # monitor do painel ao vivo (P4 da publicação): "" = o secundário de menor número (\\.\DISPLAY1 antes de DISPLAY2);
    # um nome de dispositivo (ex.: "\\.\DISPLAY3") escolhe outro secundário. Antes era DISPLAY1 fixo (o desta máquina)
    "monitorPainel": "",
}
# só na instalação do mantenedor (instalacao.SO_COMPLETA): na edição pública ficam desligadas mesmo que o plugin mande
# true (o PADRAO.coach do plugin liga as duas e o POST /config grava o cfg inteiro dele)
SO_COMPLETA_CFG = ("carregamento", "mentor")
ATRASO_MAX_S = 60
# valores aceitos das chaves de texto; fora disto = o padrão (na leitura do arquivo e no POST). As do overlay
# são as chaves de overlay_minimapa.CORES/FORCAS (conferido pelo teste-alertas.py; o servidor não importa o
# overlay, que carrega cv2 e a user32)
ESCOLHAS = {"tomVoz": ("serio", "descontraido"), "mentorModelo": ("sonnet", "haiku", "opus"),
            "mentorEffort": ("low", "medium", "high"), "junglerLonge": ("painel", "tudo", "nada"),
            "overlayCor": ("vermelho", "laranja", "roxo"), "overlayForca": ("sutil", "normal", "forte")}
log = logging.getLogger("coletor.servidor")
_trava_cfg = threading.Lock()


_avisados = set()   # (caminho, mtime, tamanho) de config.json inválido já avisado no log (ler_config roda a cada consulta)


def _ler_salvo(caminho):
    """(conteúdo, inválido): arquivo ausente = ({}, False); existe mas não é JSON (ex.: editado à mão com "\\." sem dobrar a
    barra) = ({}, True), com um aviso no log por versão do arquivo (antes: o padrão inteiro, calado)"""
    p = Path(caminho)
    try:
        texto = p.read_text(encoding="utf-8")
    except OSError:
        return {}, False
    try:
        return json.loads(texto), False
    except ValueError as e:
        try:
            st = p.stat()
            chave = (str(p), st.st_mtime_ns, st.st_size)
        except OSError:
            chave = (str(p), None, None)
        if chave not in _avisados:
            _avisados.add(chave)
            log.warning("config %s não é JSON válido (%s): valendo o padrão; ao salvar, o arquivo vai para %s", p, e,
                        p.with_name(p.stem + ".invalido.json").name)
        return {}, True


def ler_config(caminho=CONFIG):
    """config do coach: o padrão mesclado com o salvo (chave desconhecida ou de tipo errado some)"""
    salvo = _ler_salvo(caminho)[0]
    cfg = {k: (salvo[k] if isinstance(salvo, dict) and type(salvo.get(k)) is type(v) else v)
           for k, v in CONFIG_PADRAO.items()}
    d = salvo.get("avisosDesligados") if isinstance(salvo, dict) else None
    # nada salvo = o padrão (antes virava {[], []} e o padrão do CONFIG_PADRAO nunca valia); salvo = a escolha dele
    cfg["avisosDesligados"] = _desligados(CONFIG_PADRAO["avisosDesligados"] if d is None else d)
    if isinstance(salvo, dict) and "aceiteAtrasoS" in salvo:   # número ou null: o teste de tipo acima não serve
        a = _atraso(salvo["aceiteAtrasoS"])
        cfg["aceiteAtrasoS"] = CONFIG_PADRAO["aceiteAtrasoS"] if a is _INVALIDO else a
    _escolhas_validas(cfg)
    _edicao(cfg)
    return {k: list(v) if isinstance(v, list) else v for k, v in cfg.items()}  # lista do padrão não vaza


def _edicao(cfg):
    """edição pública: o que não vai no complemento fica desligado na leitura e na gravação"""
    if instalacao.PUBLICA:
        for k in SO_COMPLETA_CFG:
            cfg[k] = False


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
        _edicao(cfg)
        caminho = Path(caminho)
        caminho.parent.mkdir(parents=True, exist_ok=True)
        if _ler_salvo(caminho)[1]:   # editado à mão e inválido: guarda o texto dele antes de regravar a partir do padrão
            try:
                caminho.replace(caminho.with_name(caminho.stem + ".invalido.json"))
            except OSError as e:
                log.warning("config inválida não guardada à parte: %s", e)
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


# GET /resumos?desde=<gameId> (Fase 4 de roadmap/2026-10-17-plugin-pengu-primeiro.md): as partidas próprias do banco no
# formato do acumulador do plugin (pengu/historico.js, chave lol-client.historico), para a importação uma vez por abertura.
# Só leitura e só agregado próprio: o inimigo entra por campeão, nunca nome, Riot ID nem puuid de outro jogador. A ordem
# dos campos é a de pengu/historico.js CAMPOS (guarda: tools/teste-resumos.py), e o plugin mapeia pelo nome.
CAMPOS_RESUMO = ("gameId", "criacao", "duracao", "fila", "campeao", "papel", "adversario", "incerto", "vitoria",
                 "ouro10", "xp10", "farm10", "ouro15", "xp15", "farm15", "mortes10", "solo10", "gank10", "cs", "inimigos")
TETO_RESUMOS = 500      # pengu/historico.js TETO: as mais recentes
MS_10 = 600000
VERSAO_RESUMOS = 1


def resumos_do_banco(c, desde=0, teto=TETO_RESUMOS):
    """{v, dono, campos, linhas}: até `teto` partidas próprias com game_id > desde, mais recentes primeiro, só as que entram
    nas contas (mapa 11, fila fora de analise.FORA_DAS_CONTAS, duração >= analise.REMAKE_S). Com linha do tempo no banco,
    papel, adversário, diferenças aos 10/15 e mortes cedo saem do analise.analisar (o mesmo que o pós-jogo do plugin
    calcula em JS); sem ela, null. dono = puuid desta conta (meta), que o plugin confere antes de mesclar.
    Só as partidas desta conta: o `eu` de cada partida é o participante da conta logada quando ela foi gravada e o meta
    puuid muda a cada login, então o banco pode ter partidas de outra conta que jogou neste PC (revisão adversarial da
    Fase 4); o filtro é o participante `eu = 1` com o puuid do meta. Sem puuid no meta: nenhuma linha"""
    import analise  # noqa: PLC0415 (só quando pedem: o servidor sobe sem ele)
    puuid = banco.meta(c, "puuid")
    linhas = []
    if not puuid:
        return {"v": VERSAO_RESUMOS, "dono": None, "campos": list(CAMPOS_RESUMO), "linhas": linhas}
    sql = ("select game_id, criacao, duracao, fila, campeao, time, vitoria, tem_timeline from partidas "
           f"where eu is not null and mapa = 11 and fila not in {analise.FORA_DAS_CONTAS} and duracao >= {analise.REMAKE_S} "
           "and exists (select 1 from participantes p where p.game_id = partidas.game_id and p.eu = 1 and p.puuid = ?) "
           "and game_id > ? order by criacao desc, game_id desc limit ?")
    for gid, criacao, duracao, fila, campeao, time_, vitoria, tem_tl in c.execute(sql, (puuid, int(desde), int(teto))).fetchall():
        inimigos = [r[0] for r in c.execute(
            "select campeao from participantes where game_id = ? and time <> ? order by participant_id", (gid, time_))]
        cs = c.execute("select coalesce(cs_tropas, 0) + coalesce(cs_selva, 0) from participantes where game_id = ? and eu = 1",
                       (gid,)).fetchone()
        o = {"gameId": gid, "criacao": criacao, "duracao": duracao, "fila": fila, "campeao": campeao, "papel": None,
             "adversario": None, "incerto": None, "vitoria": 1 if vitoria else 0, "cs": cs[0] if cs else 0, "inimigos": inimigos}
        r = analise.analisar(c, gid, puuid) if tem_tl and puuid else {"erro": "sem linha do tempo"}
        if "erro" not in r:
            o["papel"] = r.get("papel")
            adv = r.get("adversario")
            if adv:
                o["adversario"], o["incerto"] = adv["campeao"], 1 if adv["incerto"] else 0
            for m in ("10", "15"):
                d = r["diffs"].get(m) or {}
                for k in ("ouro", "xp", "farm"):
                    o[f"{k}{m}"] = d.get(k)
            cedo = [x for x in r["mortes"] if x["ms"] < MS_10]
            o["mortes10"] = len(cedo)
            o["solo10"] = sum(x["inimigos"] == 1 for x in cedo)
            o["gank10"] = sum(x["inimigos"] >= 2 for x in cedo)
        linhas.append([o.get(k) for k in CAMPOS_RESUMO])
    return {"v": VERSAO_RESUMOS, "dono": puuid, "campos": list(CAMPOS_RESUMO), "linhas": linhas}


def origem_ok(origem):
    if not origem:
        return True  # sem Origin: navegação direta, curl, o próprio painel
    try:
        return urlsplit(origem).hostname in HOSTS_OK
    except ValueError:
        return False


# /aceite/*: o plugin diz "não aceitar nesta vez" e manda o diagnóstico do aceite (aviso_partida.rota_aceite); a
# reserva do coletor aceita a partida sozinha com base nisso. Só a página do client (https em
# 127.0.0.1/localhost, a porta da LCU), o Pengu (https://plugins, riot) ou pedido sem Origin. As páginas do próprio
# coletor (http://127.0.0.1:<esta porta>) e qualquer outra página local em http não escrevem aqui.
# /compacto/*: registro das expansões do client compacto (expansoes.rota_expansoes, passo 15 do plano do compacto): a
# mesma regra (só quem roda dentro do client escreve no registro).
# /atualizar (P3 da publicação, 19/10/2026): a mesma regra; um site no navegador nunca dispara a troca dos arquivos.
ROTAS_SO_PLUGIN = ("/aceite/", "/compacto/", "/atualizar")
# POST /atualizar troca arquivos e reinicia o complemento: ali nem o pedido SEM Origin passa (curl, outro processo, outra conta do
# Windows no mesmo loopback), só o Origin do client ou do Pengu (revisão adversarial da P3). Não é autenticação (um processo
# local forja o cabeçalho); tira o disparo por engano ou por ferramenta genérica. O GET /atualizar/estado segue a regra comum
ROTAS_SO_PLUGIN_ESTRITO = ("/atualizar",)


def origem_aceite_ok(rota, origem):
    if not rota.startswith(ROTAS_SO_PLUGIN) or not origem:
        return True
    try:
        u = urlsplit(origem)
        return u.hostname in ("plugins", "riot") or (u.scheme == "https" and u.hostname in ("127.0.0.1", "localhost"))
    except ValueError:
        return False


# contato do plugin (reserva do aceite: plano plugin Pengu primeiro, Fase 1): só pedido COM Origin do client ou do Pengu,
# a mesma forma de origem_aceite_ok. Sem Origin (curl, o painel, navegação) nunca conta: não prova que o plugin está vivo
ROTAS_CONTATO = ("/ola", "/aceite/")


def origem_plugin(origem):
    return bool(origem) and origem_aceite_ok("/aceite/", origem)


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
        if not origem_aceite_ok(urlsplit(self.path).path, self.headers.get("Origin")):
            self._enviar(403, {"erro": "origem"})
            return True
        if (self.command == "POST" and urlsplit(self.path).path.rstrip("/") in ROTAS_SO_PLUGIN_ESTRITO
                and not origem_plugin(self.headers.get("Origin"))):
            self._enviar(403, {"erro": "origem"})
            return True
        return False

    def _contato(self, rota):
        """GET /ola e POST /aceite/* com Origin do plugin: avisa o dono (SinalPlugin.contato). Nunca derruba o pedido"""
        f = getattr(self.server.dono, "contato_plugin", None)
        if f and rota.startswith(ROTAS_CONTATO) and origem_plugin(self.headers.get("Origin")):
            try:
                f()
            except Exception as e:
                log.warning("contato do plugin: %s", e)

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
            elif rota == "/ola":
                self._contato(rota)
                self._enviar(200, {"app": APP, "versao": VERSAO_PONTE, "recursos": srv.recursos(),
                                   "edicao": "publica" if instalacao.PUBLICA else "completa",
                                   "pacote": instalacao.versao()})
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
            elif rota == "/resumos" and "resumos" not in instalacao.ocultos():
                self._enviar(*srv.resumos(self.path))
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
        self._contato(rota)   # POST /aceite/plugin com Origin do plugin: ele falou (neste ready check, para a reserva)
        prefixo = next((p for p in srv.rotas_post if rota.startswith(p)), None)
        if prefixo:  # ex.: /aceite/, /compacto/: f(rota, corpo bruto) -> (status, corpo[, tipo])
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
    (mentor: f(game_id) -> dict|None troca essa leitura). iniciar() sobe numa thread; False = porta ocupada.
    recursos: o que o dono declara além das rotas (RECURSOS_COACH); quem pendura depois (coletor.py) soma em
    recursos_declarados. contato_plugin: f() chamada no GET /ola e no POST /aceite/* com Origin do plugin."""

    def __init__(self, estado=None, mentor=None, db=banco.DB_PADRAO, porta=PORTA, config=CONFIG, mentor_http=None,
                 ao_config=None, rotas_get=None, garantir_partida=None, rotas_post=None, recursos=None):
        self.estado_real = estado is not None   # /estado com a partida de verdade (sem ele, sempre {"partida": false})
        self.estado = estado or (lambda: {"partida": False})
        self.db = db
        self.mentor_real = mentor is not None or mentor_http is not None
        self.mentor = mentor or mentor_do_banco(db)
        self.mentor_http = mentor_http
        self.recursos_declarados = set(recursos or ())
        self.contato_plugin = None
        self.porta = porta
        self.config = config
        self.ao_config = ao_config            # f(cfg) depois de cada POST /config
        self.rotas_get = dict(rotas_get or {})  # {prefixo: f(caminho) -> (status, dict)}
        self.rotas_post = dict(rotas_post or {})  # {prefixo: f(caminho, corpo bruto) -> (status, dict)} (/aceite/, /compacto/)
        # f(gameId) -> bool: o pós-jogo pede o contexto no EndOfGame, antes do backfill (5–160 s depois)
        # gravar a partida; o coletor busca na LCU na hora (só GET)
        self.garantir_partida = garantir_partida
        self.httpd = None
        self.thread = None

    def recursos(self):
        """recursos do aperto de mão (GET /ola), calculados AGORA do que está pendurado: anunciar uma rota ausente faria o
        plugin chamá-la (ex.: aceite-reserva com a reserva desarmada, draft com --sem-coach)"""
        r = set(self.recursos_declarados)
        if self.ao_config is not None:   # POST /config chega a um coach ao vivo (coach_vivo.Coach.configurar)
            r.add("coach")
        if self.estado_real:
            r.add("estado-partida")
        if self.mentor_real:
            r.add("mentor")
        if Path(self.db).exists():       # /contexto, /licoes e /resumos leem o banco
            r.add("contexto")
            r.add("resumos")
        pendurados = [*self.rotas_get, *self.rotas_post]
        for prefixo, nome in (("/draft", "draft"), ("/revisao/", "revisao"),
                              ("/aceite/", "aceite-reserva"), ("/compacto/", "expansoes"), ("/atualizar", "atualizar")):
            if any(p.startswith(prefixo) for p in pendurados):
                r.add(nome)
        return sorted(r - instalacao.ocultos())   # edição pública: nada do que fica só na instalação do mantenedor

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

    def resumos(self, caminho):
        """GET /resumos?desde=<gameId>: resumos_do_banco (importação do acumulador do plugin). desde inválido = 400"""
        q = parse_qs(urlsplit(caminho).query)
        try:
            desde = int((q.get("desde") or ["0"])[0] or 0)
        except ValueError:
            return 400, {"erro": "desde inválido"}
        try:
            c = banco.abrir_leitura(self.db)
        except FileNotFoundError:
            return 404, {"erro": "sem banco"}
        try:
            return 200, resumos_do_banco(c, max(0, desde))
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
