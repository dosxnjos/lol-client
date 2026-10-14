# medidor PASSIVO do client compacto (roadmap/2026-10-13-client-compacto.md, passo 1): o Gabriel (ou o orquestrador)
# deixa rodando numa partida real e ele grava o que só uma ranqueada responde: estados das trocas a cada mudança,
# skin-carousel dentro da seleção, a busca na fila, o PDL do pós-jogo, isLeader, convites e o status dos amigos.
# Só GET na LCU (lockfile como o coletor; a credencial vive só em memória) e na Live Client; nada de POST, tecla,
# clique, foco ou janela. Grava SÓ sinais (enum, bool, contagem, id numérico de campeão/troca): nunca nome, puuid,
# summonerId nem texto de chat (so_sinais()).
# Prints: no carregamento e aos ~3, 8 e 15 min de partida tira print SÓ do painel da 2ª tela pela URL dele
# (http://127.0.0.1:8765/, servido pelo coletor) com Edge headless; nunca captura de tela, nunca foco.
#   python tools/medir-compacto.py              até 10 min depois do EndOfGame (ou o client fechar)
#   python tools/medir-compacto.py --continuo   todas as partidas até o client fechar
#   python tools/medir-compacto.py --ensaio     5 s da fase atual (sem prints) e sai
# saída: dados/medicao-compacto-<AAAA-MM-DD>.jsonl (uma linha por sinal) e temp/prints-partida/*.png
import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))

PAINEL = "http://127.0.0.1:8765/"
LIVE_STATS = "https://127.0.0.1:2999/liveclientdata/gamestats"
MARCOS_S = (("03min", 180), ("08min", 480), ("15min", 900))
ESPERA_CARREGAMENTO_S = 15   # o painel do carregamento enche depois que a Live Client responde (Riot API, ~10 s)
POS_FIM_S = 600              # depois do EndOfGame (PDL chega atrasado; jogar de novo)
LP_JANELA_S = 180            # lê o PDL a cada 5 s por 3 min depois do EndOfGame
SEM_CLIENT_S = 60
NAO_JANELA = 0x08000000      # CREATE_NO_WINDOW
EDGES = (Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe",
         Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Microsoft/Edge/Application/msedge.exe")

# ---------- só sinais ----------
# chave com identidade ou texto livre: some inteira (comparação em minúsculas, por trecho)
NEGAR = ("puuid", "summonerid", "summonername", "accountid", "playerid", "gamename", "tagline", "riotid", "displayname",
         "name", "icon", "jwt", "password", "token", "obfuscated", "message", "body", "note", "profile", "chatdetails",
         "muc", "pid", "statusmessage", "invitationid", "fromsummoner", "tosummoner")
PERMITIR = {"nameVisibilityType", "playerResponse"}  # passam mesmo casando com NEGAR
# chaves de enum: o texto passa (curto, sem espaço)
ENUM = {"phase", "state", "searchState", "availability", "gameStatus", "assignedPosition", "firstPositionPreference",
        "secondPositionPreference", "restrictionCode", "type", "nameVisibilityType", "requesterPosition",
        "responderPosition", "activeActionType", "tradeState", "swapState", "positionSwapState", "playerResponse",
        "gameMode", "category", "tier", "division", "rank", "queueType", "reason", "penaltyType", "errorType",
        "pickSnipedClass", "actingBackgroundAnimationState", "position", "role", "lane", "mapSide", "dodgeState",
        "ratedTier", "highestTier", "previousSeasonEndTier", "mode", "leaguePointsDeltaType", "notifyReason"}
RE_ENUM = re.compile(r"^[A-Za-z0-9_.\-]{1,40}$")
RE_CAPS = re.compile(r"^[A-Z][A-Z0-9_]{0,40}$")
MAX_LISTA, MAX_PROF = 12, 5


def negada(chave):
    if chave in PERMITIR:
        return False
    k = str(chave).lower()
    return any(n in k for n in NEGAR)


def so_sinais(v, chave=None, prof=0):
    """bool, número, enum e estrutura; texto livre vira "<texto>" (sabe que o campo existe, não o conteúdo)"""
    if v is None or isinstance(v, bool) or isinstance(v, (int, float)):
        return v
    if isinstance(v, str):
        if chave in ENUM and RE_ENUM.match(v):
            return v
        return v if RE_CAPS.match(v) else ("" if v == "" else "<texto>")
    if prof >= MAX_PROF:
        return "<fundo>"
    if isinstance(v, list):
        out = [so_sinais(x, chave, prof + 1) for x in v[:MAX_LISTA]]
        return out + ([f"<+{len(v) - MAX_LISTA}>"] if len(v) > MAX_LISTA else [])
    if isinstance(v, dict):
        return {k: so_sinais(x, k, prof + 1) for k, x in v.items() if not negada(k)}
    return "<?>"


def jogador_cs(p, meu_time=True):
    """sinais de um jogador do myTeam/theirTeam da sessão (temNome = Riot ID visível, sem o nome)"""
    p = p or {}
    out = {"cellId": p.get("cellId"), "championId": p.get("championId"), "assignedPosition": p.get("assignedPosition"),
           "nameVisibilityType": p.get("nameVisibilityType"), "temNome": bool(p.get("gameName") or p.get("summonerName")),
           "temPuuid": bool(p.get("puuid")), "isAutofilled": p.get("isAutofilled")}
    if meu_time:  # hover do inimigo não se grava (só a ação completa, plano § guardrails)
        out.update({"championPickIntent": p.get("championPickIntent"), "selectedSkinId": p.get("selectedSkinId"),
                    "spell1Id": p.get("spell1Id"), "spell2Id": p.get("spell2Id")})
    return out


def sessao_cs(s):
    s = s or {}
    t = s.get("timer") or {}
    acoes = [a for turno in (s.get("actions") or []) for a in (turno if isinstance(turno, list) else [turno])]
    return {
        "timer": {"phase": t.get("phase"), "totalTimeInPhase": t.get("totalTimeInPhase"), "isInfinite": t.get("isInfinite")},
        "localPlayerCellId": s.get("localPlayerCellId"), "isCustomGame": s.get("isCustomGame"),
        "allowSkinSelection": s.get("allowSkinSelection"), "benchEnabled": s.get("benchEnabled"),
        "allowRerolling": s.get("allowRerolling"), "rerollsRemaining": s.get("rerollsRemaining"),
        # as 2 bandeiras que a tela 3 lê no ban (fixture de 14/10/2026 teve de supor as duas)
        "hasSimultaneousBans": s.get("hasSimultaneousBans"),
        "disallowBanningTeammateHoveredChampions": s.get("disallowBanningTeammateHoveredChampions"),
        "trocas": {"posicao": so_sinais(s.get("positionSwaps") or []), "ordem": so_sinais(s.get("pickOrderSwaps") or []),
                   "campeao": so_sinais(s.get("trades") or [])},
        "meuTime": [jogador_cs(p) for p in s.get("myTeam") or []],
        "inimigos": [jogador_cs(p, meu_time=False) for p in s.get("theirTeam") or []],
        "acoes": [{"id": a.get("id"), "actorCellId": a.get("actorCellId"), "type": a.get("type"), "completed": a.get("completed"),
                   "isInProgress": a.get("isInProgress"), "championId": a.get("championId") if a.get("completed") else None}
                  for a in acoes if isinstance(a, dict)],
    }


def lobby_sinais(lb):
    lb = lb or {}
    m = lb.get("localMember") or {}
    return {"queueId": (lb.get("gameConfig") or {}).get("queueId"), "membros": len(lb.get("members") or []),
            "isLeader": m.get("isLeader"), "canStartActivity": lb.get("canStartActivity"),
            "restricoes": [r.get("restrictionCode") for r in lb.get("restrictions") or [] if isinstance(r, dict)],
            "restricaoTemPrazo": any(bool(r.get("expiredTimestamp")) for r in lb.get("restrictions") or [] if isinstance(r, dict)),
            "convitesPendentes": sum(1 for i in lb.get("invitations") or [] if isinstance(i, dict) and i.get("state") == "Pending"),
            "pos1": m.get("firstPositionPreference"), "pos2": m.get("secondPositionPreference"),
            "camposLocalMember": sorted(k for k in m.keys() if not negada(k))}


def amigos_sinais(lista, agora_ms):
    """histograma do status dos amigos: availability, lol.gameStatus, idade do lol.timeStamp (s). Sem nome."""
    disp, status, com_ts, idades = {}, {}, 0, {}
    for f in lista or []:
        if not isinstance(f, dict):
            continue
        a = str(f.get("availability") or "?")
        disp[a] = disp.get(a, 0) + 1
        lol = f.get("lol") or {}
        g = lol.get("gameStatus")
        if g:
            g = g if RE_ENUM.match(str(g)) else "<texto>"
            status[g] = status.get(g, 0) + 1
        ts = lol.get("timeStamp")
        if ts:
            com_ts += 1
            try:
                idade = round((agora_ms - int(ts)) / 1000)
                if g and len(idades.setdefault(g, [])) < 10:
                    idades[g].append(idade)
            except (TypeError, ValueError):
                pass
    return {"n": len(lista or []), "availability": disp, "gameStatus": status, "comTimeStamp": com_ts,
            "idadeS": {k: sorted(v) for k, v in idades.items()}}


def skins_sinais(lst):
    lst = [x for x in lst or [] if isinstance(x, dict)]
    return {"n": len(lst), "desbloqueadas": sum(1 for x in lst if x.get("unlocked")),
            "comChromas": sum(1 for x in lst if x.get("childSkins")),
            "chromas": sum(len(x.get("childSkins") or []) for x in lst),
            "desabilitadas": sum(1 for x in lst if x.get("disabled")),
            "campos": sorted(k for k in (lst[0].keys() if lst else []) if not negada(k))}


def sem_relogio(d, tirar=("adjustedTimeLeftInPhase", "internalNowInEpochMs", "timeInQueue", "estimatedQueueTime", "timer")):
    if isinstance(d, dict):
        return {k: sem_relogio(v, tirar) for k, v in d.items() if k not in tirar}
    if isinstance(d, list):
        return [sem_relogio(x, tirar) for x in d]
    return d


# ---------- Live Client, painel, Edge headless ----------
def _ctx_tls():
    import ssl
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # certificado próprio da Riot, só 127.0.0.1
    return ctx


def ler_game_time():
    """gameTime (s) da Live Client; None fora da partida ou recusada"""
    try:
        with urllib.request.urlopen(urllib.request.Request(LIVE_STATS, headers={"Accept": "application/json"}),
                                    context=_ctx_tls(), timeout=3) as r:
            return float((json.loads(r.read() or b"null") or {}).get("gameTime") or 0)
    except Exception:
        return None


def painel_no_ar(url=PAINEL):
    try:
        with urllib.request.urlopen(url.rstrip("/") + "/estado", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


def achar_edge():
    return next((p for p in EDGES if p.exists()), None)


def comando_print(edge, png, perfil, url=PAINEL):
    """Edge headless (sem janela, sem foco) com perfil próprio em temp/ (o dados/edge-painel é do painel aberto)"""
    return [str(edge), "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run", "--mute-audio",
            f"--screenshot={png}", "--window-size=1536,960", "--virtual-time-budget=3000", f"--user-data-dir={perfil}", url]


def print_painel(png, perfil, url=PAINEL, rodar=subprocess.run):
    edge = achar_edge()
    if not edge:
        return False, "msedge.exe não encontrado"
    try:
        r = rodar(comando_print(edge, png, perfil, url), capture_output=True, timeout=60, creationflags=NAO_JANELA)
    except Exception as e:
        return False, type(e).__name__
    ok = r.returncode == 0 and Path(png).exists()
    return ok, None if ok else f"rc {r.returncode}"


# ---------- medidor ----------
class Medidor:
    def __init__(self, saida, prints, conectar=None, game_time=ler_game_time, printar=print_painel, painel_ok=painel_no_ar,
                 agora=time.time, executar=None, continuo=False, sem_prints=False, painel=PAINEL, log=None):
        if conectar is None:
            import coletor  # só conectar/LCU (sem o log nem a trava do coletor), como o gravador
            conectar = coletor.conectar
        self.saida, self.prints = Path(saida), Path(prints)
        self.conectar, self.game_time, self.printar, self.painel_ok = conectar, game_time, printar, painel_ok
        self.agora, self.continuo, self.sem_prints, self.painel = agora, continuo, sem_prints, painel
        self.executar = executar or (lambda fn: threading.Thread(target=fn, daemon=True).start())
        self.log = log or (lambda m: print(f"{datetime.now():%H:%M:%S} {m}", flush=True))
        self.lcu = None
        self.fase = None
        self.ultimo = {}       # dedupe por evento
        self.prox = {}         # próxima leitura por tipo
        self.n = {}
        self.visto_client = None
        self.sem_client_desde = None
        self.inicio = agora()
        self.fim_em = None     # EndOfGame + POS_FIM_S
        self.eog_em = None
        self.partida = None    # {gameId, inicio, marcos feitos, carregamento_em}
        self.parar = False

    # ---- escrita ----
    def escrever(self, ev, dados=None, **extra):
        self.saida.parent.mkdir(parents=True, exist_ok=True)
        # dados null é sinal (404 = sem troca em curso, PDL que ainda não chegou)
        linha = {"t": datetime.now().isoformat(timespec="milliseconds"), "ev": ev, "fase": self.fase, **extra, "dados": dados}
        with open(self.saida, "a", encoding="utf-8") as f:
            f.write(json.dumps(linha, ensure_ascii=False, separators=(",", ":")) + "\n")
        self.n[ev] = self.n.get(ev, 0) + 1

    def mudou(self, ev, valor):
        chave = json.dumps(valor, sort_keys=True, ensure_ascii=False)
        if self.ultimo.get(ev) == chave:
            return False
        self.ultimo[ev] = chave
        return True

    def gravar_se_mudou(self, ev, dados, comparar=None, **extra):
        if self.mudou(ev, comparar if comparar is not None else dados):
            self.escrever(ev, dados, **extra)

    def vez(self, tipo, cada_s):
        t = self.agora()
        if t < self.prox.get(tipo, 0):
            return False
        self.prox[tipo] = t + cada_s
        return True

    # ---- LCU (só GET) ----
    def get(self, caminho, timeout=8):
        if self.lcu is None:
            return None
        try:
            return self.lcu.get(caminho, timeout=timeout)
        except urllib.error.HTTPError:
            return None   # 404 fora da fila / sem troca em curso é o normal
        except Exception as e:  # timeout, conexão caída, corpo cortado
            self.n["erro_lcu"] = self.n.get("erro_lcu", 0) + 1
            if self.n["erro_lcu"] <= 5:
                self.log(f"LCU falhou ({caminho.split('?')[0]}): {type(e).__name__}")
            return None

    def ler_fase(self):
        for _ in range(2):
            if self.lcu is None:
                self.lcu = self.conectar()
                if self.lcu is None:
                    return None
            try:
                return self.lcu.get("/lol-gameflow/v1/gameflow-phase", timeout=5)
            except urllib.error.HTTPError:
                return "?"
            except Exception:
                self.lcu = None
        return None

    # ---- um passo do laço: -> segundos até o próximo (None = acabou) ----
    def passo(self):
        agora = self.agora()
        fase = self.ler_fase()
        if fase is None:
            if self.visto_client is None:
                return None if agora - self.inicio > 2 * 3600 else 5.0
            self.sem_client_desde = self.sem_client_desde or agora
            if agora - self.sem_client_desde > SEM_CLIENT_S:
                self.escrever("fim", {"motivo": "client fechado", "contagens": dict(self.n)})
                return None
            return 2.0
        self.sem_client_desde = None
        self.visto_client = self.visto_client or agora
        if fase != self.fase:
            de, self.fase = self.fase, fase
            self.escrever("fase", {"de": de})
            self.ao_mudar_fase(fase, agora)
        if self.fim_em and agora >= self.fim_em and not self.continuo:
            self.escrever("fim", {"motivo": "10 min depois do EndOfGame", "contagens": dict(self.n)})
            return None
        # PDL depois do EndOfGame: segue lendo mesmo se ele já voltou ao lobby (jogar de novo)
        if fase not in ("WaitingForStats", "PreEndOfGame", "EndOfGame"):
            self.posjogo(agora)
        if fase in ("None", "Lobby"):
            self.lobby()
            return 1.0
        if fase == "Matchmaking":
            self.busca()
            return 1.0
        if fase == "ReadyCheck":
            self.readycheck()
            return 0.5
        if fase == "ChampSelect":
            self.champselect()
            return 0.5
        if fase in ("GameStart", "InProgress", "Reconnect"):
            self.em_partida(agora)
            return 2.0
        if fase in ("WaitingForStats", "PreEndOfGame", "EndOfGame"):
            self.posjogo(agora)
            return 1.0
        return 1.0

    def ao_mudar_fase(self, fase, agora):
        if fase in ("ChampSelect", "InProgress", "EndOfGame", "Lobby"):
            s = self.get("/lol-gameflow/v1/session") or {}
            gd = s.get("gameData") or {}
            self.gravar_se_mudou("gameflow", {"queueId": (gd.get("queue") or {}).get("id"), "mapId": (s.get("map") or {}).get("id"),
                                              "isCustomGame": gd.get("isCustomGame"), "gameMode": (gd.get("queue") or {}).get("gameMode")})
            if fase == "InProgress" and gd.get("gameId") and (self.partida or {}).get("gameId") != gd.get("gameId"):
                self.partida = {"gameId": gd.get("gameId"), "inicio": agora, "feitos": set(), "carregamento_em": None}
        if fase == "ChampSelect":
            self.ranked("antes")
            self.ultimo.pop("trocas", None)
            self.fim_em = None  # outra partida: mede até 10 min depois do EndOfGame dela
        if fase in ("InProgress", "GameStart") and self.partida is None:
            self.partida = {"gameId": None, "inicio": agora, "feitos": set(), "carregamento_em": None}
        if fase == "EndOfGame":
            self.eog_em = agora
            self.fim_em = agora + POS_FIM_S
            st = self.get("/lol-gameflow/v1/gameflow-metadata/player-status") or {}
            self.escrever("jogar_de_novo", so_sinais({"lastQueuedLobbyStatus": st.get("lastQueuedLobbyStatus")}))
            eog = self.get("/lol-end-of-game/v1/eog-stats-block") or {}
            self.escrever("eog", {k: so_sinais(v, k) for k, v in eog.items()
                                  if not negada(k) and (v is None or isinstance(v, (bool, int, float, str)))})
        if fase in ("None", "Lobby") and self.continuo:
            self.partida = None

    # ---- por fase ----
    def lobby(self):
        if self.vez("lobby", 3):
            lb = self.get("/lol-lobby/v2/lobby")
            self.gravar_se_mudou("lobby", lobby_sinais(lb) if lb else {"semLobby": True})
            conv = self.get("/lol-lobby/v2/received-invitations")
            if isinstance(conv, list):
                self.gravar_se_mudou("convites", {"n": len(conv), "lista": so_sinais(conv)})
        self.amigos()

    def amigos(self):
        if self.vez("amigos", 15):
            lst = self.get("/lol-chat/v1/friends")
            if isinstance(lst, list):
                d = amigos_sinais(lst, int(self.agora() * 1000))
                self.gravar_se_mudou("amigos", d, comparar={k: v for k, v in d.items() if k != "idadeS"})

    def busca(self):
        s = self.get("/lol-matchmaking/v1/search")
        if s is not None:
            d = so_sinais(s)
            # o relógio da fila anda todo segundo: grava quando o resto muda ou a cada 10 s
            if self.mudou("busca", sem_relogio(d)) or self.vez("busca_relogio", 10):
                self.escrever("busca", d)
        if self.vez("search_state", 2):
            st = self.get("/lol-lobby/v2/lobby/matchmaking/search-state")
            if st is not None:
                self.gravar_se_mudou("search_state", so_sinais(st))
        if self.vez("lobby_fila", 5):
            lb = self.get("/lol-lobby/v2/lobby")
            if lb:
                self.gravar_se_mudou("lobby", lobby_sinais(lb))
        self.amigos()

    def readycheck(self):
        rc = self.get("/lol-matchmaking/v1/ready-check", timeout=3)
        if rc:
            self.gravar_se_mudou("readycheck", so_sinais(rc))

    def champselect(self):
        s = self.get("/lol-champ-select/v1/session", timeout=5)
        if s:
            d = sessao_cs(s)
            self.gravar_se_mudou("sessao_cs", d, comparar=sem_relogio(d, ("totalTimeInPhase",)))
            # trocas: estado × momento (a tabela do plano), uma linha a cada mudança, com a fase do timer
            self.gravar_se_mudou("trocas", {"timerPhase": d["timer"]["phase"], **d["trocas"]}, comparar=d["trocas"])
        if self.vez("summoners", 1):
            for slot in range(5):
                p = self.get(f"/lol-champ-select/v1/summoners/{slot}", timeout=3)
                if p:
                    d = so_sinais(p)
                    d["temNome"] = bool(p.get("gameName") or p.get("summonerName") or p.get("displayName"))
                    self.gravar_se_mudou(f"jogador_cs_{slot}", d, slot=slot)
            for tipo, rota in (("posicao", "ongoing-position-swap"), ("ordem", "ongoing-pick-order-swap"), ("campeao", "ongoing-champion-swap")):
                o = self.get(f"/lol-champ-select/v1/{rota}", timeout=3)
                self.gravar_se_mudou(f"troca_em_curso_{tipo}", so_sinais(o) if o else None, tipo=tipo)
        if self.vez("listas", 2):
            # só o tamanho das listas de pick e ban, por fase do timer: a grade de ban do compacto veio vazia na
            # ranqueada de 14/10/2026 e o conteúdo do bannable-champion-ids não foi medido (ARMADILHAS § LCU)
            li = {"timerPhase": ((s or {}).get("timer") or {}).get("phase")}
            for nome, rota in (("pickable", "pickable-champion-ids"), ("bannable", "bannable-champion-ids")):
                lst = self.get(f"/lol-champ-select/v1/{rota}", timeout=3)
                li[nome] = len(lst) if isinstance(lst, list) else None
            self.gravar_se_mudou("listas", li)
        if self.vez("skins", 5):
            lst = self.get("/lol-champ-select/v1/skin-carousel-skins", timeout=5)
            self.gravar_se_mudou("skins", skins_sinais(lst) if isinstance(lst, list) else {"semResposta": True})

    def ranked(self, momento):
        r = self.get("/lol-ranked/v1/current-ranked-stats")
        if r:
            filas = (r.get("queueMap") or {})
            d = {q: so_sinais({k: v for k, v in (filas.get(q) or {}).items()
                               if k in ("tier", "division", "leaguePoints", "wins", "losses", "isProvisional", "miniSeriesProgress")})
                 for q in ("RANKED_SOLO_5x5", "RANKED_FLEX_SR")}
            seg = round(self.agora() - self.eog_em, 1) if self.eog_em and momento == "depois" else None
            self.gravar_se_mudou(f"ranked_{momento}", d, momento=momento, desdeFimS=seg)

    def em_partida(self, agora):
        if not self.partida:
            self.partida = {"gameId": None, "inicio": agora, "feitos": set(), "carregamento_em": None}
        gt = self.game_time()
        if gt is None:
            return
        p = self.partida
        if "inicio_jogo" not in p and gt > 0.1:
            p["inicio_jogo"] = agora
            self.escrever("partida", {"gameTime": round(gt, 1), "carregamentoS": round(agora - p["inicio"], 1)})
        # carregamento: a Live Client responde com gameTime parado (~0,025) por ~99 s; dá 15 s ao painel encher
        if gt < 1 and "carregamento" not in p["feitos"]:
            p["carregamento_em"] = p["carregamento_em"] or agora
            if agora - p["carregamento_em"] >= ESPERA_CARREGAMENTO_S:
                self.tirar_print("carregamento")
        elif gt >= 1 and "carregamento" not in p["feitos"]:
            p["feitos"].add("carregamento")
            self.escrever("print", {"marco": "carregamento", "ok": False, "motivo": "carregamento passou antes do print"})
        for marco, seg in MARCOS_S:
            if gt >= seg and marco not in p["feitos"]:
                self.tirar_print(marco, gt)

    def posjogo(self, agora):
        if self.eog_em and agora - self.eog_em <= LP_JANELA_S and self.vez("lp", 5):
            n = self.get("/lol-ranked/v1/current-lp-change-notification")
            self.gravar_se_mudou("lp_notificacao", so_sinais(n) if n else None, desdeFimS=round(agora - self.eog_em, 1))
            self.ranked("depois")

    # ---- print do painel (thread: o laço não espera o Edge) ----
    def tirar_print(self, marco, gt=None):
        p = self.partida
        p["feitos"].add(marco)
        if self.sem_prints:
            return
        nome = f"{datetime.now():%Y-%m-%d-%H%M%S}-{p.get('gameId') or 'sem-id'}-{marco}.png"
        png = self.prints / nome
        perfil = self.prints / ".edge-headless"
        gt_txt = None if gt is None else round(gt, 1)

        def fazer():
            if not self.painel_ok(self.painel):
                self.escrever("print", {"marco": marco, "ok": False, "motivo": "painel fora do ar", "gameTime": gt_txt})
                return
            self.prints.mkdir(parents=True, exist_ok=True)
            ok, motivo = self.printar(png, perfil, self.painel)
            self.escrever("print", {"marco": marco, "ok": ok, "arquivo": str(png.relative_to(RAIZ)) if png.is_relative_to(RAIZ) else nome,
                                    "motivo": motivo, "gameTime": gt_txt})
        self.executar(fazer)

    def rodar(self, ensaio_s=None):
        self.escrever("inicio", {"saida": str(self.saida.name), "continuo": self.continuo, "semPrints": self.sem_prints})
        fim = self.agora() + ensaio_s if ensaio_s else None
        while True:
            espera = self.passo()
            if espera is None:
                break
            if fim and self.agora() >= fim:
                self.escrever("fim", {"motivo": "ensaio", "contagens": dict(self.n)})
                break
            time.sleep(espera)
        self.log(f"fim: {dict(self.n)} -> {self.saida}")


def principal():
    ap = argparse.ArgumentParser(description="medidor passivo do client compacto (só GET, só sinais)")
    ap.add_argument("--saida", help="jsonl (padrão dados/medicao-compacto-<data>.jsonl)")
    ap.add_argument("--prints", default=str(RAIZ / "temp" / "prints-partida"))
    ap.add_argument("--sem-prints", action="store_true")
    ap.add_argument("--continuo", action="store_true", help="não para 10 min depois do EndOfGame")
    ap.add_argument("--painel", default=PAINEL)
    ap.add_argument("--lockfile", help="caminho do lockfile (desliga a busca pelo processo)")
    ap.add_argument("--ensaio", action="store_true", help="5 s da fase atual, sem prints")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    saida = Path(a.saida) if a.saida else RAIZ / "dados" / f"medicao-compacto-{datetime.now():%Y-%m-%d}.jsonl"
    import coletor
    m = Medidor(saida, a.prints, conectar=lambda: coletor.conectar(a.lockfile), continuo=a.continuo,
                sem_prints=a.sem_prints or a.ensaio, painel=a.painel)
    m.rodar(ensaio_s=5 if a.ensaio else None)
    return 0


if __name__ == "__main__":
    sys.exit(principal())
