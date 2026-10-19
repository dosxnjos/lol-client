# coletor do lol-client: backfill do histórico + websocket da LCU -> dados/lol.db
# nasce com o LeagueClientUx (tarefa "lol-client-coletor") e sai sozinho após
# --ocioso-min minutos sem client. A credencial do lockfile só vive em memória.
import argparse
import asyncio
import base64
import ctypes
import json
import logging
import os
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from logging.handlers import RotatingFileHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import banco  # noqa: E402

LOCKFILE_PADRAO = Path(r"C:\Games\Riot Games\League of Legends\lockfile")
DADOS = banco.RAIZ / "dados"
TRAVA = DADOS / "coletor.lock"
LOG = DADOS / "coletor.log"
FALHA = DADOS / "coletor-falha.log"   # faulthandler + "Fatal Python error" (vida.py); vazio = nenhuma queda nativa
EVENTOS = (
    "OnJsonApiEvent_lol-gameflow_v1_gameflow-phase",
    "OnJsonApiEvent_lol-end-of-game_v1_eog-stats-block",
    "OnJsonApiEvent_lol-ranked_v1_current-ranked-stats",
    "OnJsonApiEvent_lol-champ-select_v1_session",
)   # o evento das conversas do chat saiu em 19/10/2026 com as janelas do chat (Fase 2 do plano plugin Pengu primeiro)
FASES_LOBBY = ("Lobby", "Matchmaking", "ReadyCheck")
FASES_JOGO = ("GameStart", "InProgress", "Reconnect", "WaitingForStats", "PreEndOfGame", "EndOfGame")
log = logging.getLogger("coletor")


class SemSegredo(logging.Filter):
    """defesa extra: nenhuma linha de log sai com a credencial atual"""
    segredos = set()

    def filter(self, rec):
        msg = rec.getMessage()
        for s in self.segredos:
            if s and s in msg:
                rec.msg, rec.args = msg.replace(s, "***"), ()
        return True


def configurar_log(console=False):
    DADOS.mkdir(parents=True, exist_ok=True)
    h = RotatingFileHandler(LOG, maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    h.addFilter(SemSegredo())
    log.addHandler(h)
    if console and sys.stderr:
        for f in (sys.stdout, sys.stderr):
            if f and hasattr(f, "reconfigure"):
                f.reconfigure(encoding="utf-8")
        s = logging.StreamHandler(sys.stderr)
        s.addFilter(SemSegredo())
        log.addHandler(s)
    log.setLevel(logging.INFO)
    # thread que morre com exceção não tratada ia só para o stderr (nenhum, na tarefa agendada): sem isto
    # um atalho, overlay ou leitor morto não deixava rastro (13/10/2026, F8/F9 mudos no treino). Desde 15/10/2026
    # também o fio principal e a exceção "ignorada" de callback ctypes (vida.ganchos; o resto da vida: principal())
    import vida
    vida.ganchos(log)


# ---------- lockfile e LCU ----------

_ultima_busca = [-60.0]
_achado = [None]


def achar_lockfile():
    """lockfile padrão; senão, pelo --install-directory do LeagueClientUx.exe em execução
    (no máximo 1 busca por minuto: é um powershell novo a cada vez)"""
    if LOCKFILE_PADRAO.exists():
        return LOCKFILE_PADRAO
    if _achado[0] and _achado[0].exists():
        return _achado[0]
    if time.monotonic() - _ultima_busca[0] < 60:
        return None
    _ultima_busca[0] = time.monotonic()
    try:
        saida = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             # sem isso o PowerShell 5.1 escreve no pipe em cp850 e caminho com acento chega quebrado
             "[Console]::OutputEncoding=[Text.UTF8Encoding]::new();"
             "(Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\").CommandLine"],
            capture_output=True, encoding="utf-8", errors="replace", timeout=20,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
    except Exception:
        return None
    marca = "--install-directory="
    if marca in saida:
        resto = saida.split(marca, 1)[1]
        pasta = resto[1:].split('"', 1)[0] if resto.startswith('"') else resto.split('"', 1)[0].split(" --", 1)[0]
        cand = Path(pasta.strip()) / "lockfile"
        if cand.exists():
            _achado[0] = cand
            return cand
    return None


def ler_lockfile(caminho):
    """(porta, credencial) ou None"""
    try:
        partes = Path(caminho).read_text(encoding="utf-8").strip().split(":")
        if len(partes) >= 5:
            SemSegredo.segredos.add(partes[3])
            return partes[2], partes[3]
    except OSError:
        pass
    return None


class LCU:
    def __init__(self, porta, cred):
        self.porta = porta
        self.auth = "Basic " + base64.b64encode(f"riot:{cred}".encode()).decode()
        # TLS sem verificação: o certificado da LCU é autoassinado e só vale 127.0.0.1
        self.ctx = ssl.create_default_context()
        self.ctx.check_hostname = False
        self.ctx.verify_mode = ssl.CERT_NONE

    def get(self, caminho, timeout=30):
        req = urllib.request.Request(f"https://127.0.0.1:{self.porta}{caminho}",
                                     headers={"Authorization": self.auth, "Accept": "application/json"})
        with urllib.request.urlopen(req, context=self.ctx, timeout=timeout) as r:
            corpo = r.read()
        return json.loads(corpo) if corpo else None

    def post(self, caminho, corpo=None, timeout=10, metodo="POST"):
        """escrita do coletor na LCU: aceitar/recusar o ready check na janelinha, por clique do Gabriel (as janelas do
        chat, que também escreviam aqui, saíram em 19/10/2026). A única escrita sozinha é a reserva do aceite
        (aviso_partida.py): accept do ready check em andamento quando o plugin não aceitou no alvo dele, com o aceite automático ligado, sem "não aceitar" e com o plugin visto
        durante esse ready check (SinalPlugin.visto_desde)."""
        dados = json.dumps(corpo).encode() if corpo is not None else b""
        req = urllib.request.Request(f"https://127.0.0.1:{self.porta}{caminho}", data=dados, method=metodo,
                                     headers={"Authorization": self.auth, "Accept": "application/json",
                                              "Content-Type": "application/json"})
        with urllib.request.urlopen(req, context=self.ctx, timeout=timeout) as r:
            resp = r.read()
        try:
            return json.loads(resp) if resp else None
        except ValueError:
            return None

    def vivo(self):
        """True se a LCU responde (qualquer status HTTP conta)"""
        try:
            self.get("/lol-gameflow/v1/gameflow-phase", timeout=10)
            return True
        except urllib.error.HTTPError:
            return True
        except Exception:
            return False


def conectar(lockfile=None):
    """LCU do client aberto, ou None. lockfile explícito desliga o fallback"""
    caminho = lockfile or achar_lockfile()
    dados = caminho and ler_lockfile(caminho)
    if not dados:
        return None
    lcu = LCU(*dados)
    return lcu if lcu.vivo() else None


# ---------- backfill ----------

def backfill(lcu, c, trabalhadores=4, limite=None):
    """grava as partidas do histórico da LCU que faltam no banco (partida + linha do tempo),
    as mais recentes primeiro, no máximo `limite` por chamada. Idempotente."""
    eu = lcu.get("/lol-summoner/v1/current-summoner")
    puuid = eu["puuid"]
    banco.meta(c, "puuid", puuid)
    banco.meta(c, "jogador", f"{eu.get('gameName')}#{eu.get('tagLine')}")
    c.commit()
    if not c.execute("select 1 from campeoes limit 1").fetchone():
        try:
            banco.gravar_campeoes(c, lcu.get("/lol-game-data/assets/v1/champion-summary.json"))
        except Exception as e:
            log.warning("lista de campeões indisponível: %s", e)
    # a LCU ignora begIndex/endIndex e devolve o que tem em cache (20 ou 200); 1ª chamada lenta
    hist = lcu.get("/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=199",
                   timeout=120)
    jogos = (hist.get("games") or {}).get("games") or []
    completos, existentes = banco.ids_completos(c), banco.ids_partidas(c)
    # nunca baixadas primeiro, depois as que só esperam a linha do tempo (pode não vir nunca:
    # sem isso elas ocupariam as vagas do `limite` para sempre)
    todas = [g["gameId"] for g in sorted(jogos, key=lambda g: (g["gameId"] in existentes,
                                                               -(g.get("gameCreation") or 0)))
             if g["gameId"] not in completos]
    faltam = todas[:limite] if limite else todas

    def baixar(gid):
        g = t = None
        try:
            g = lcu.get(f"/lol-match-history/v1/games/{gid}", timeout=60)
            t = lcu.get(f"/lol-match-history/v1/game-timelines/{gid}", timeout=60)
            if not (t and t.get("frames")):
                t = None
        except Exception as e:
            log.warning("partida %s: %s", gid, e)
        return gid, g, t

    novas = sem_tl = 0
    with ThreadPoolExecutor(trabalhadores) as ex:
        for gid, g, t in ex.map(baixar, faltam):
            if not g:
                continue
            banco.gravar_partida(c, g, puuid, t)
            novas += gid not in existentes
            sem_tl += t is None
    total = c.execute("select count(*) from partidas").fetchone()[0]
    log.info("backfill: %d no histórico, %d baixadas (%d novas, %d sem linha do tempo), %d no banco",
             len(jogos), len(faltam), novas, sem_tl, total)
    return {"historico": len(jogos), "baixadas": len(faltam), "novas": novas,
            "sem_timeline": sem_tl, "restam": len(todas) - len(faltam), "total": total}


# ---------- champ select ----------

# campos de identidade de outros jogadores e o chat (senha + jwt da sala): nunca vão para disco
_IDENTIDADE = ("puuid", "summonerId", "gameName", "tagLine", "playerAlias", "internalName",
               "obfuscatedPuuid", "obfuscatedSummonerId", "nameVisibilityType")


def limpar_sessao(s):
    """cópia de /lol-champ-select/v1/session sem chatDetails nem identidade de jogador"""
    if not isinstance(s, dict):
        return s
    s = {k: v for k, v in s.items() if k != "chatDetails"}
    for lado in ("myTeam", "theirTeam"):
        s[lado] = [{k: v for k, v in (p or {}).items() if k not in _IDENTIDADE} for p in s.get(lado) or []]
    return s


_NOMES_LIVE = ("riotId", "riotIdGameName", "summonerName")


def limpar_live(dados):
    """allgamedata da Live Client com o nome de cada jogador trocado pelo campeão (espelho no
    mesmo time: "Campeão ORDER"); os eventos citam jogador só pelo nome (KillerName, VictimName,
    Assisters…) e passam pelo mesmo mapa. Nome que não é de jogador (torre, tropa) fica."""
    if not isinstance(dados, dict):
        return dados
    jogadores = dados.get("allPlayers") or []
    campeoes = [str(p.get("championName") or "?") for p in jogadores]
    mapa = {}
    for p, camp in zip(jogadores, campeoes):
        apelido = camp if campeoes.count(camp) == 1 else f"{camp} {p.get('team') or '?'}"
        for k in _NOMES_LIVE:
            if p.get(k):
                mapa[p[k]] = apelido
        if p.get("riotIdGameName") and p.get("riotIdTagLine"):
            mapa[f"{p['riotIdGameName']}#{p['riotIdTagLine']}"] = apelido

    def troca(v):
        if isinstance(v, str):
            return mapa.get(v) or mapa.get(v.split("#", 1)[0]) or v
        if isinstance(v, list):
            return [troca(x) for x in v]
        return v

    def jogador(p):
        p = {k: troca(v) if k in _NOMES_LIVE else v for k, v in p.items()}
        if "riotIdTagLine" in p:
            p["riotIdTagLine"] = ""
        return p
    out = {**dados, "allPlayers": [jogador(p) for p in jogadores]}
    if isinstance(dados.get("activePlayer"), dict):
        out["activePlayer"] = jogador(dados["activePlayer"])
    ev = dados.get("events")
    if isinstance(ev, dict) and isinstance(ev.get("Events"), list):
        out["events"] = {**ev, "Events": [{k: troca(v) for k, v in e.items()} if isinstance(e, dict) else e
                                          for e in ev["Events"]]}
    return out


def _acoes(s):
    """actions chega como lista de listas (um turno por lista); achata"""
    out = []
    for a in s.get("actions") or []:
        out.extend(a if isinstance(a, list) else [a])
    return [a for a in out if isinstance(a, dict)]


def _posicao(p):
    v = str((p or {}).get("assignedPosition") or "").upper()
    return v or None


class RetratoChampSelect:
    """retrato de uma seleção de campeões, sem IO: o coletor (e o teste) alimentam as sessões
    na ordem; `sessao()` devolve True ao entrar em FINALIZATION (hora de gravar a 1ª vez) e
    `fechar()` devolve o retrato final (início da partida ou seleção desfeita)"""

    def __init__(self):
        self.prefs = None  # preferências do lobby, guardadas entre seleções
        self.fechadas = []  # chaves já fechadas: Update atrasado delas não reabre a seleção
        self.limpar()

    def limpar(self):
        self.s = None
        self.ts0 = self.ts_trava = None
        self.finalizou = False
        self.runa_id = self.runa_nome = None
        self.chave = None

    @property
    def ativo(self):
        return self.s is not None

    def preferidas(self, lista):
        lista = [str(x).upper() for x in lista or [] if x and str(x).upper() not in ("UNSELECTED", "NONE")]
        self.prefs = lista or None  # lobby lido sem posição (às cegas, ARAM): sem preferidas

    def runa(self, rid, nome):
        self.runa_id, self.runa_nome = rid, nome

    def _local(self):
        cell = self.s.get("localPlayerCellId")
        return next((p for p in self.s.get("myTeam") or [] if p.get("cellId") == cell), {})

    def sessao(self, s, ts):
        if not isinstance(s, dict) or s.get("isSpectating"):
            return False
        # id é obrigatório no /help; vazio na prática → o gameId (também obrigatório) identifica
        sid = s.get("id") or (f"g{s['gameId']}" if s.get("gameId") else None)
        if sid and sid in self.fechadas:
            return False  # chegou depois da mudança de fase que fechou: regravar apagaria o retrato final
        if self.s is not None and sid and sid != self.chave:
            self.limpar()  # sessão nova sem o fim da anterior ter passado pelo gameflow
        primeira = self.s is None
        if primeira:
            self.ts0 = ts
            self.chave = sid or f"cs-{ts}"
        self.s = limpar_sessao(s)
        cell = s.get("localPlayerCellId")
        if self.ts_trava is None and any(a.get("actorCellId") == cell and a.get("type") == "pick"
                                         and a.get("completed") for a in _acoes(s)):
            # já travado na 1ª sessão vista (coletor reconectou no meio): tempo desconhecido (-1)
            self.ts_trava = -1 if primeira else ts
        fase = ((s.get("timer") or {}).get("phase") or "").upper()
        if fase == "FINALIZATION" and not self.finalizou:
            self.finalizou = True
            return True
        return False

    def retrato(self, game_id=None, desfeita=False):
        s, eu = self.s, self._local()
        pos = _posicao(eu)
        riot = eu.get("isAutofilled")
        if pos is None:
            auto = None  # às cegas / personalizada: não há posição
        elif self.prefs:
            auto = pos not in self.prefs and "FILL" not in self.prefs
        else:
            auto = None if riot is None else bool(riot)
        bans = {True: [], False: []}
        for a in _acoes(s):
            if a.get("type") == "ban" and a.get("completed") and (a.get("championId") or 0) > 0:  # -1 = sem ban
                bans[bool(a.get("isAllyAction"))].append(a["championId"])
        b = s.get("bans") or {}
        if not bans[True] and not bans[False]:  # sem ações de ban: usa o resumo da sessão
            bans = {True: list(b.get("myTeamBans") or []), False: list(b.get("theirTeamBans") or [])}
        aliados = [{"cell": p.get("cellId"), "campeao": p.get("championId") or 0, "posicao": _posicao(p)}
                for p in s.get("myTeam") or []]
        inimigos = [{"cell": p.get("cellId"), "campeao": p.get("championId") or 0, "posicao": _posicao(p)}
                    for p in s.get("theirTeam") or []]
        seg = None
        if self.ts_trava not in (None, -1):
            seg = round((self.ts_trava - self.ts0) / 1000, 1)
        gid = None if desfeita else (game_id or s.get("gameId") or None)  # dodge: a partida não existiu
        return {"chave": self.chave, "ts": self.ts0, "game_id": gid,
                "fila": s.get("queueId") or None, "posicao": pos, "preferidas": self.prefs,
                "autofill": auto, "autofill_riot": None if riot is None else bool(riot),
                "campeao": eu.get("championId") or None, "aliados": aliados, "inimigos": inimigos,
                "bans_aliados": bans[True], "bans_inimigos": bans[False],
                "runa_id": self.runa_id, "runa_nome": self.runa_nome,
                "feiticos": [eu.get("spell1Id"), eu.get("spell2Id")], "seg_ate_travar": seg,
                "desfeita": desfeita}

    def fechar(self, game_id=None, desfeita=False):
        """retrato final e zera o estado; None se não havia seleção (ou desfeita antes de finalizar)"""
        if self.chave:
            self.fechadas = (self.fechadas + [self.chave])[-50:]
        if not self.ativo or (desfeita and not self.finalizou):
            self.limpar()
            return None
        r = self.retrato(game_id, desfeita)
        self.limpar()
        return r


# ---------- instância única ----------

def pid_vivo(pid, trava_ts=None):
    """sem os.kill: no Windows ele mata o processo. trava_ts (epoch da trava): processo
    criado depois dela é pid reaproveitado (o dono gravou a trava depois de nascer)"""
    k = ctypes.windll.kernel32
    h = k.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return False
    try:
        codigo = ctypes.c_ulong()
        k.GetExitCodeProcess(h, ctypes.byref(codigo))
        if codigo.value != 259:  # STILL_ACTIVE
            return False
        buf = ctypes.create_unicode_buffer(1024)
        n = ctypes.c_ulong(1024)
        if k.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n)) and "python" not in buf.value.lower():
            return False  # pid reaproveitado por outro programa = trava órfã
        if trava_ts is not None:
            t = [ctypes.c_ulonglong() for _ in range(4)]  # criação, saída, kernel, usuário (FILETIME)
            if k.GetProcessTimes(h, *(ctypes.byref(x) for x in t)):
                criado = (t[0].value - 116444736000000000) / 1e7
                if criado > trava_ts + 2:
                    return False  # outro python nasceu com o pid depois da trava
        return True
    finally:
        k.CloseHandle(h)


_orfa = [None]   # pid da trava órfã que este processo removeu (a instância anterior morreu sem "encerrado")


def travar():
    """True se esta é a única instância; remove trava órfã"""
    DADOS.mkdir(parents=True, exist_ok=True)
    for _ in range(2):
        try:
            fd = os.open(TRAVA, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return True
        except FileExistsError:
            try:
                pid = int(TRAVA.read_text().strip() or 0)
                ts = TRAVA.stat().st_mtime
            except (OSError, ValueError):
                pid, ts = 0, None
            if pid and pid != os.getpid() and pid_vivo(pid, ts):
                log.info("outra instância em execução (pid %d); saindo", pid)
                return False
            log.info("trava órfã (pid %s) removida", pid or "?")
            _orfa[0] = pid or "?"
            TRAVA.unlink(missing_ok=True)
    return False


def destravar():
    try:
        if TRAVA.read_text().strip() == str(os.getpid()):
            TRAVA.unlink()
    except OSError:
        pass


# ---------- laço principal ----------

def _aviso_padrao(lcu, atraso_s, **kw):
    import aviso_partida
    return aviso_partida.AvisoPartida(lcu, atraso_s, **kw)


def _sinal_aceite(coach):
    """sinal do aceite do plugin (POST /aceite/plugin) pendurado no servidor do coach. None = sem a rota no ar
    (--sem-coach, porta 8765 ocupada, erro): o "não aceitar" do plugin não chegaria, então a reserva fica DESARMADA
    (só a janelinha, por clique). O coach.iniciar() roda antes do Coletor: servidor_no_ar já é o definitivo aqui."""
    srv = getattr(coach, "srv", None)
    if coach is None or srv is None or not getattr(coach, "servidor_no_ar", False):
        log.info("reserva do aceite desarmada: sem rota do plugin (%s)",
                 "sem coach" if coach is None else "servidor local fora do ar")
        return None
    try:
        import aviso_partida
        sinal = aviso_partida.SinalPlugin()
        srv.rotas_post["/aceite/"] = aviso_partida.rota_aceite(sinal)
        # GET /ola e POST /aceite/* com Origin do plugin: a reserva só age com o plugin visto desde a entrada na fila
        srv.contato_plugin = sinal.contato
        return sinal
    except Exception as e:
        log.warning("reserva do aceite desarmada: sinal fora: %s: %s", type(e).__name__, e)
        return None


def _registro_expansoes(coach):
    """POST /compacto/expansoes (registro das saídas do client compacto, passo 15 do plano do compacto) pendurado no
    servidor do coach. Sem servidor: o plugin guarda em memória e reenvia. Falha aqui nunca derruba o coletor."""
    srv = getattr(coach, "srv", None)
    if srv is None:
        return False
    try:
        import expansoes
        srv.rotas_post["/compacto/"] = expansoes.rota_expansoes()
        return True
    except Exception as e:
        log.warning("registro das expansões do compacto fora: %s: %s", type(e).__name__, e)
        return False


def _atualizador(coach, col):
    """POST /atualizar e GET /atualizar/estado (atualizar.py, P3 do plano da publicação) pendurados no servidor do coach: o
    botão "atualizar" do plugin troca plugin e complemento e o complemento reinicia (col.pedir_saida com reiniciar). Sem
    servidor, nada (o plugin mostra o atualizar.cmd). Falha aqui nunca derruba o coletor."""
    srv = getattr(coach, "srv", None)
    if srv is None:
        return None
    try:
        import atualizar
        at = atualizar.Atualizador(fase=lambda: col.fase_atual,
                                   reiniciar=lambda: col.pedir_saida("atualizado: reiniciando", reiniciar=True))
        srv.rotas_post["/atualizar"] = at.rota_post
        srv.rotas_get["/atualizar/estado"] = at.rota_get
        return at
    except Exception as e:
        log.warning("atualização pelo plugin fora: %s: %s", type(e).__name__, e)
        return None


def comando_sucessor(argv, pid, executavel=None):
    """linha de comando da instância que sobe depois desta (reinício da atualização): os mesmos argumentos, sem um
    --esperar-pid antigo, mais --esperar-pid <este pid> (a trava recusaria a 2ª instância com esta ainda viva)"""
    resto, pular = [], False
    for a in argv[1:]:
        if pular:
            pular = False
            continue
        if a == "--esperar-pid":
            pular = True
            continue
        if a.startswith("--esperar-pid="):
            continue
        resto.append(a)
    return [executavel or sys.executable, str(Path(argv[0]).resolve()), *resto, "--esperar-pid", str(pid)]


def lancar_sucessor(cmd):
    """sobe a próxima instância solta desta: sem janela (CREATE_NO_WINDOW, ARMADILHAS § Windows), grupo próprio e, se o
    job deixar, fora do job desta (tarefa agendada fecha o job e levaria o filho junto)"""
    base = 0x08000000 | 0x00000200   # CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP
    for flags in (base | 0x01000000, base):   # CREATE_BREAKAWAY_FROM_JOB; sem permissão do job: sem ele
        try:
            return subprocess.Popen(cmd, creationflags=flags, close_fds=True, cwd=str(banco.RAIZ),
                                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError:
            continue
    return None


def esperar_pid(pid, limite_s=120, passo_s=0.25):
    """espera o processo pid sair (a instância anterior encerrando limpo); True se saiu dentro do limite"""
    fim = time.monotonic() + limite_s
    while time.monotonic() < fim:
        if not pid_vivo(pid):
            return True
        time.sleep(passo_s)
    return not pid_vivo(pid)


class Coletor:
    def __init__(self, args, coach=None, fab_aviso=None):
        self.args = args
        self.coach = coach  # coach_vivo.Coach (ao vivo, painel, mentor); None nos testes do retrato
        # janelinha de "partida encontrada" + reserva do aceite (aviso_partida.py):
        # f(lcu, atraso_s, sinal=, janela=, reserva=) -> objeto com mostrar()/fechar()
        self.fab_aviso = fab_aviso or _aviso_padrao
        self.aviso = None
        self.sinal = _sinal_aceite(coach)   # "não aceitar" e diagnóstico do plugin (POST /aceite/plugin)
        _registro_expansoes(coach)          # saídas do client compacto (POST /compacto/expansoes)
        # a janelinha aceitar/recusar mora aqui (aviso_partida), não numa rota: anunciada no aperto de mão (GET /ola)
        declarados = getattr(getattr(coach, "srv", None), "recursos_declarados", None)
        if isinstance(declarados, set):
            declarados.add("aceite-flutuante")
        # saída pedida de outra thread (reinício depois da atualização): pedir_saida cancela a tarefa do rodar()
        self.saida = None
        self.reiniciar = False
        self.loop = self.tarefa = None
        self.atualizador = _atualizador(coach, self)   # POST /atualizar (botão "atualizar" do plugin)
        self.ocioso_s = args.ocioso_min * 60
        self.ultimo_ok = time.monotonic()
        self.c = banco.abrir(args.db)
        self.lcu = None
        self.backfill_feito = False
        self.inicial = None   # task do backfill da conexão
        self.buscando = None  # task da partida nova após EndOfGame
        self.cs = RetratoChampSelect()
        self.fila_atual = None
        self.fase_atual = self.partida_atual = None   # última fase do gameflow (batimento do vida.py)
        self.ultima_cs = None  # chave do último retrato, para ligar o game_id
        # partida assistida (espectador, D2 de 17/10/2026): isSpectating da sessão da seleção. Três estados: True = assistida
        # (as fases de jogo não ligam coach, voz, painel, medidor de travadas nem gravação, e nada vira partida dele); False =
        # dele (seleção com isSpectating false, ou busca/ready check: espectador não passa por eles); None = não sei (coletor
        # religado no meio, ou None/Lobby). Só com None a reserva da Live Client (coach_vivo.SEM_EU_LEITURAS) pode valer
        self.assistindo = None
        self.proprias = set()   # gameIds sabidos dele: o Reconnect depois de um None (client reaberto) segue sendo dele

    def ocioso(self):
        return time.monotonic() - self.ultimo_ok >= self.ocioso_s

    def pedir_saida(self, motivo, reiniciar=False):
        """de qualquer thread: o rodar() devolve `motivo` (encerramento limpo pelo principal); reiniciar = o principal sobe a
        próxima instância antes de sair (atualização)"""
        self.saida, self.reiniciar = motivo, bool(reiniciar)
        if self.loop is not None and self.tarefa is not None:
            self.loop.call_soon_threadsafe(self.tarefa.cancel)

    async def rodar(self):
        self.loop, self.tarefa = asyncio.get_running_loop(), asyncio.current_task()
        try:
            if self.saida:
                return self.saida
            return await self._rodar()
        except asyncio.CancelledError:
            if self.saida:
                if hasattr(self.tarefa, "uncancel"):
                    self.tarefa.uncancel()   # o cancelamento foi nosso (pedir_saida): a tarefa segue e devolve o motivo
                return self.saida
            raise

    async def _rodar(self):
        while True:
            lcu = await asyncio.to_thread(conectar, self.args.lockfile)
            if not lcu:
                if self.ocioso():
                    return f"ocioso {self.args.ocioso_min:g} min sem client"
                await asyncio.sleep(max(0.5, min(5, self.ocioso_s - (time.monotonic() - self.ultimo_ok))))
                continue
            self.ultimo_ok = time.monotonic()
            if not self.lcu or self.lcu.porta != lcu.porta:
                log.info("conectado ao client (porta %s)", lcu.porta)
                self.backfill_feito = False
            self.lcu = lcu
            if not self.backfill_feito and not (self.inicial and not self.inicial.done()):
                # em paralelo ao websocket: o 1º backfill (200 partidas) leva minutos
                self.inicial = asyncio.create_task(self.backfill_inicial())
            await self.escutar()

    async def backfill_inicial(self):
        try:
            await asyncio.to_thread(self.backfill_isolado)
            self.backfill_feito = True
        except Exception as e:
            log.warning("backfill falhou: %s", e)

    def backfill_isolado(self):
        c = banco.abrir(self.args.db)  # conexão própria: roda em outra thread
        try:
            return backfill(self.lcu, c)
        finally:
            c.close()

    async def escutar(self):
        """websocket WAMP até cair; volta para o laço reconectar"""
        from websockets.asyncio.client import connect
        uri = f"wss://127.0.0.1:{self.lcu.porta}/"
        try:
            async with connect(uri, ssl=self.lcu.ctx, subprotocols=["wamp"], max_size=None,
                               additional_headers={"Authorization": self.lcu.auth},
                               ping_interval=None, open_timeout=15) as ws:
                for ev in EVENTOS:
                    await ws.send(json.dumps([5, ev]))
                log.info("websocket assinado (%d eventos)", len(EVENTOS))
                await self.fase(await asyncio.to_thread(self.lcu.get, "/lol-gameflow/v1/gameflow-phase"))
                while True:
                    try:
                        bruto = await asyncio.wait_for(ws.recv(), 30)
                    except asyncio.TimeoutError:
                        if await asyncio.to_thread(self.lcu.vivo):
                            self.ultimo_ok = time.monotonic()
                            continue
                        log.info("LCU sem resposta; websocket abandonado")
                        return
                    self.ultimo_ok = time.monotonic()
                    if not bruto:
                        continue
                    try:
                        msg = json.loads(bruto)
                    except ValueError:
                        continue
                    if isinstance(msg, list) and len(msg) >= 3 and msg[0] == 8:
                        await self.evento(msg[1], msg[2] or {})
        except Exception as e:
            log.info("websocket caiu: %s: %s", type(e).__name__, e)
        await asyncio.sleep(2)

    async def evento(self, nome, corpo):
        # despacha pela uri, não pelo nome: assinatura genérica ("OnJsonApiEvent") chega com o nome genérico
        uri, dado = corpo.get("uri") or "", corpo.get("data")
        if uri == "/lol-gameflow/v1/gameflow-phase":
            await self.fase(dado)
        elif uri == "/lol-end-of-game/v1/eog-stats-block" and dado and corpo.get("eventType") != "Delete":
            banco.gravar_eog(self.c, dado)
            log.info("eog gravado (partida %s)", dado.get("gameId"))
            self.buscar_partida(dado.get("gameId"))
        elif uri == "/lol-ranked/v1/current-ranked-stats" and dado:
            banco.gravar_lp(self.c, "evento", dado)
        elif uri == "/lol-champ-select/v1/session" and dado and corpo.get("eventType") != "Delete":
            # o Delete não decide nada: a ordem dele contra o gameflow não é garantida; quem fecha é fase()
            self.marcar_assistindo(dado)
            if self.assistindo:
                return   # seleção de outro jogador: nem retrato (RetratoChampSelect já pula) nem draft do coach
            if self.cs.sessao(dado, banco.agora_ms()):
                await self.ler_runa()
                self.gravar_cs(self.cs.retrato())
            if self.coach:  # rota provável e força do draft para o selo (GET /draft do servidor local)
                await asyncio.to_thread(self.coach.champ_select, dado)

    def marcar_assistindo(self, s):
        """isSpectating (booleano) da sessão da seleção. Medido em 16/10/2026: assistir a um amigo passa por ChampSelect
        (timer GAME_STARTING) e InProgress, nunca WatchInProgress. Nas fases de jogo o sinal da seleção vale até zerar
        (Update atrasado não muda nada); sem o campo, nada muda"""
        esp = s.get("isSpectating") if isinstance(s, dict) else None
        if not isinstance(esp, bool) or self.fase_atual in FASES_JOGO or esp == self.assistindo:
            return
        self.assistindo = esp
        log.info("seleção: %s", "partida assistida (de outro jogador): coach, voz, painel, medidor e gravação ficam "
                 "desligados nela" if esp else "partida própria")

    async def ler_runa(self):
        try:
            p = await asyncio.to_thread(self.lcu.get, "/lol-perks/v1/currentpage")
            self.cs.runa((p or {}).get("id"), (p or {}).get("name"))
        except Exception:
            pass

    async def ler_preferidas(self):
        """posições do lobby (o GET dá 404 sem lobby: normal); guarda para o próximo champ select"""
        try:
            lobby = await asyncio.to_thread(self.lcu.get, "/lol-lobby/v2/lobby")
            m = (lobby or {}).get("localMember") or {}
            self.cs.preferidas([m.get("firstPositionPreference"), m.get("secondPositionPreference")])
        except Exception:
            pass

    def gravar_cs(self, r, final=False):
        if not r:
            return
        r["fila"] = r["fila"] or self.fila_atual
        banco.gravar_champ_select(self.c, r)
        self.ultima_cs = r["chave"]
        log.info("champ select %s (posição %s, autofill %s%s)", "final" if final else "gravado",
                 r["posicao"], r["autofill"], ", desfeito" if r["desfeita"] else "")

    def _cfg_aviso(self):
        """(aceiteFlutuante, aceiteAtrasoS) lidos na hora do ReadyCheck (o plugin pode ter mudado agora)"""
        import servidor_local
        try:
            cfg = self.coach.cfg() if self.coach else servidor_local.ler_config(
                getattr(self.args, "config", None) or servidor_local.CONFIG)
        except Exception:
            cfg = servidor_local.CONFIG_PADRAO
        return bool(cfg.get("aceiteFlutuante")), cfg.get("aceiteAtrasoS")

    async def aviso_partida(self, fase):
        """ReadyCheck liga a janelinha (se coach.aceiteFlutuante) e a reserva do aceite (se o aceite automático está
        ligado no espelho; sem a janelinha, roda sem janela); qualquer outra fase fecha. Nunca derruba fase()"""
        try:
            # a reserva só age com contato do plugin durante o próprio ready check (aviso_partida SinalPlugin.visto_desde,
            # conferido na hora de agir): nenhuma fronteira de fila a marcar aqui, nem com a fase Matchmaking perdida
            if fase == "ReadyCheck":
                ligado, atraso = self._cfg_aviso()
                reserva = self.sinal is not None   # sem a rota do plugin no ar, nunca aceita sozinho
                if (ligado or (atraso is not None and reserva)) and self.lcu is not None:
                    if self.aviso is None:   # websocket reconectado no meio do ReadyCheck: segue a mesma
                        self.aviso = self.fab_aviso(self.lcu, atraso, sinal=self.sinal, janela=ligado, reserva=reserva)
                        self.aviso.mostrar()
                        auto = "desligado" if atraso is None else f"em {atraso:g} s, reserva do coletor " + (
                            "armada se o plugin falar neste ready check" if reserva else "desarmada: sem rota do plugin")
                        log.info("aviso de partida aberto (aceite automático %s)" if ligado else
                                 "aviso de partida sem janela (aceite automático %s)", auto)
                    return
            elif self.sinal is not None:
                self.sinal.zerar()   # "não aceitar" vale só no ready check em que chegou
            a, self.aviso = self.aviso, None
            if a is not None:
                await asyncio.to_thread(a.fechar)
        except Exception as e:
            log.warning("aviso de partida: %s: %s", type(e).__name__, e)

    async def fase(self, fase):
        if not isinstance(fase, str):
            return
        await self.aviso_partida(fase)   # antes das leituras abaixo: o ready check dura 12 s
        gid = fila = None
        try:
            s = await asyncio.to_thread(self.lcu.get, "/lol-gameflow/v1/session")
            gd = (s or {}).get("gameData") or {}
            gid = gd.get("gameId") or None
            fila = ((gd.get("queue") or {}).get("id")) or None
        except Exception:
            pass
        if fase in ("None", "Lobby"):
            self.assistindo = None    # a partida assistida acabou (ou nunca houve); a próxima seleção diz de quem é
        elif fase in FASES_LOBBY:
            self.assistindo = False   # busca e ready check são da fila dele: espectador não passa por eles
        assistida = self.assistindo is True and fase in FASES_JOGO
        # partida sabida dele: a reserva da Live Client (sem jogador ativo) fica desarmada nela (revisão adversarial de 17/10)
        propria = fase in FASES_JOGO and not assistida and (self.assistindo is False or (gid is not None and gid in self.proprias))
        if propria and gid is not None:
            self.proprias.add(gid)
        banco.gravar_fase(self.c, fase, gid, fila)
        try:
            banco.gravar_lp(self.c, fase, await asyncio.to_thread(self.lcu.get, "/lol-ranked/v1/current-ranked-stats"))
        except Exception as e:
            log.warning("snapshot de LP falhou: %s", e)
        log.info("fase %s (partida %s%s)", fase, gid, ", assistida" if assistida else "")
        self.fase_atual, self.partida_atual = fase, gid   # o batimento (vida) lê
        self.fila_atual = fila or self.fila_atual
        if assistida:
            # partida de outro jogador: nada de medidor, retrato, game_id, histórico nem coach (D2 de 17/10/2026)
            if self.coach:
                await self.coach.fase(fase, gid, fila, self.lcu, assistida=True)
            return
        if fase == "InProgress":
            import travadas      # medidor de travadas: processo próprio, sai quando o jogo fecha (COLETOR § Medidor)
            travadas.iniciar(gid, db=getattr(self.args, "db", None))   # só com o banco real (ensaio/teste: não)
        if fase in FASES_LOBBY or (fase == "ChampSelect" and not self.cs.prefs):
            await self.ler_preferidas()
        if self.cs.ativo and fase in FASES_JOGO:
            await self.ler_runa()  # última página antes do jogo: pode ter mudado na finalização
            self.gravar_cs(self.cs.fechar(gid), final=True)
        elif self.cs.ativo and fase != "ChampSelect":  # voltou para lobby/fila/nada: seleção desfeita
            r = self.cs.fechar(desfeita=True)
            if r:
                self.gravar_cs(r, final=True)
            else:
                log.info("champ select desfeito antes da finalização (não gravado)")
        if fase in FASES_JOGO and gid and self.ultima_cs:
            banco.ligar_game_id(self.c, self.ultima_cs, gid)
            self.ultima_cs = None  # ligado: nenhuma partida seguinte cai neste retrato
        if fase == "EndOfGame":
            self.buscar_partida(gid)
        if self.coach:
            if fase != "ChampSelect":
                self.coach.fim_champ_select()
            # InProgress liga o ao vivo; WaitingForStats para o que olha a tela; EndOfGame ou fora do jogo
            # desliga tudo (o EndOfGame está em FASES_JOGO: quem decide é o coach_vivo, não esta lista)
            await self.coach.fase(fase, gid, self.fila_atual, self.lcu, propria=propria)

    def buscar_partida(self, gid):
        if self.buscando and not self.buscando.done():
            return
        self.buscando = asyncio.create_task(self.partida_nova(gid, self.fila_atual))

    async def partida_nova(self, gid, fila=None):
        """o histórico demora a mostrar a partida: tenta com espera crescente. `fila` = a do fim da
        partida (o fila_atual muda com o lobby seguinte; o coach ainda prefere a gravada no banco)"""
        for espera in (5, 10, 20, 40, 80, 160):
            await asyncio.sleep(espera)
            try:
                r = await asyncio.to_thread(self.backfill_isolado)
            except Exception as e:
                log.warning("busca da partida nova: %s", e)
                continue
            if not gid or banco.ids_completos(self.c) >= {gid}:
                log.info("partida nova %s no banco (%d novas)", gid, r["novas"])
                if self.coach and gid:  # mentor do pós-jogo e revisão da previsão do jungler
                    await asyncio.to_thread(self.coach.pos_partida, gid, fila)
                return
        log.warning("partida %s não apareceu no histórico; o próximo backfill recupera", gid)


def principal():
    ap = argparse.ArgumentParser(description="coletor de partidas do lol-client")
    ap.add_argument("--ocioso-min", type=float, default=10, help="sai após N min sem client (padrão 10)")
    ap.add_argument("--lockfile", help="caminho do lockfile (desliga a busca pelo processo)")
    ap.add_argument("--db", default=str(banco.DB_PADRAO))
    ap.add_argument("--so-backfill", action="store_true", help="só baixa o histórico e sai (sem trava)")
    ap.add_argument("--liveclient", default="https://127.0.0.1:2999",
                    help="URL da Live Client (o simulador: http://127.0.0.1:2998)")
    ap.add_argument("--porta-painel", type=int, default=8765, help="porta do servidor local (painel, /config, /mentor)")
    ap.add_argument("--config", default=None, help="config do coach (padrão dados/config.json)")
    ap.add_argument("--sem-coach", action="store_true", help="só o coletor de partidas (sem ao vivo nem servidor)")
    ap.add_argument("--esperar-pid", type=int, default=None,
                    help="espera este processo sair antes da trava (reinício depois da atualização; até 120 s)")
    args = ap.parse_args()
    configurar_log(console=bool(sys.stderr) and not sys.executable.lower().endswith("pythonw.exe"))

    if args.so_backfill:
        lcu = conectar(args.lockfile)
        if not lcu:
            log.info("so-backfill: client fechado")
            return 1
        c = banco.abrir(args.db)
        r = backfill(lcu, c, trabalhadores=6)
        c.close()
        if sys.stdout:
            print(json.dumps(r, ensure_ascii=False))
        return 0

    if args.esperar_pid and not esperar_pid(args.esperar_pid):
        log.info("reinício: a instância anterior (pid %d) não saiu em 120 s; seguindo (a trava decide)", args.esperar_pid)
    import vida
    anterior, bat_anterior = vida.ultimo_registro(LOG)   # antes de esta instância escrever no log
    if not travar():
        return 0
    log.info("iniciado (pid %d, ocioso %g min)", os.getpid(), args.ocioso_min)
    if _orfa[0] is not None and anterior:
        # a anterior morreu seca: TerminateProcess de fora (schtasks /end, Stop-Process, taskkill) ou queda nativa
        # (aí o dados/coletor-falha.log tem a pilha). O batimento é de 1 min: a morte foi até 1 min depois dele
        log.warning("a instância anterior (pid %s) parou sem 'encerrado': última linha às %s (%s), último batimento "
                    "%s; queda nativa deixaria pilha em %s", _orfa[0], anterior[0], anterior[1][:80],
                    bat_anterior or "nenhum", FALHA.name)
    motivo = "erro"
    coach = None
    col = None
    vida.ligar(log, falha=FALHA, estado=lambda: {"fase": getattr(col, "fase_atual", None),
                                                 "partida": getattr(col, "partida_atual", None)})
    try:
        if not args.sem_coach:
            import coach_vivo
            coach = coach_vivo.Coach(db=args.db, liveclient=args.liveclient, porta=args.porta_painel,
                                     **({"config": args.config} if args.config else {}))
            coach.iniciar()
        col = Coletor(args, coach)
        motivo = asyncio.run(col.rodar())
    except KeyboardInterrupt:
        motivo = "interrompido"
    except Exception as e:
        motivo = f"erro: {type(e).__name__}"
        log.exception("falha no laço principal")
    finally:
        vida.saindo(motivo)          # o atexit escreve "coletor saindo (motivo)" depois do "encerrado"
        if coach is not None:
            try:
                coach.encerrar()
            except Exception:
                log.exception("coach não encerrou limpo")
        log.info("encerrado (%s)", motivo)
        destravar()
        if col is not None and col.reiniciar:   # atualização: a próxima instância (código novo) espera esta sair
            p = lancar_sucessor(comando_sucessor(sys.argv, os.getpid()))
            log.info("reinício: %s", f"próxima instância pid {p.pid}" if p else "não lançou (o vigia ou o atalho sobe)")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
