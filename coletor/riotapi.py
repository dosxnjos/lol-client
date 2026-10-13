# cliente da Riot API (servidores da Riot, não a LCU): limite de taxa por host, User-Agent,
# cache em memória (TTL) e, só para o que não tem identidade, cache em disco (dados/riot-cache/).
# Chave: LOL_RIOT_API_KEY no ambiente (doppler run ...); sem ela, lê do Doppler pessoal em memória.
# A chave só vai no cabeçalho da Riot: nunca na URL, em log, em exceção ou em arquivo.
# Regras e pegadinhas: docs/MERCADO.md § 5 e § 7, docs/ARMADILHAS.md § Riot API.
import json
import logging
import os
import subprocess
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, deque
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CACHE_DISCO = RAIZ / "dados" / "riot-cache"
USER_AGENT = "lol-client/2.0 (coach pessoal)"  # sem User-Agent a Cloudflare da Riot devolve 403 (1010)
CABECALHO_CHAVE = "X-Riot-Token"
HOSTS = {"br1": "https://br1.api.riotgames.com", "americas": "https://americas.api.riotgames.com"}
# Personal API Key: 20 req/1 s e 100 req/2 min por host de roteamento (br1 e americas são baldes
# separados). Margem pequena contra relógio desalinhado com o servidor.
JANELAS = ((19, 1.05), (98, 121.0))
DOPPLER_SCOPE = Path.home() / ".doppler-pessoal"
RELER_CHAVE_S = 60     # chave não achada: tenta o Doppler de novo depois disso
log = logging.getLogger("coletor.riot")


def mascarar(caminho):
    """caminho sem identidade (puuid, Riot ID) e sem query: o que pode ir para log ou exceção"""
    partes = caminho.split("?")[0].split("/")
    for i, p in enumerate(partes):
        n = 2 if p == "by-riot-id" else 1 if p in ("by-puuid", "by-summoner") else 0
        for j in range(i + 1, min(i + 1 + n, len(partes))):
            partes[j] = "…"
    return "/".join(partes)


class ErroRiot(Exception):
    def __init__(self, status, caminho, msg=""):
        super().__init__(f"Riot API {status} em {mascarar(caminho)}{': ' + msg if msg else ''}")
        self.status = status


class SemChave(ErroRiot):
    def __init__(self):
        super().__init__(0, "-", "LOL_RIOT_API_KEY ausente (rodar com doppler run, ver docs/ARMADILHAS.md § Riot API)")


def ler_chave():
    """LOL_RIOT_API_KEY do ambiente; senão, do Doppler pessoal (subprocesso, valor só em memória).
    LOL_RIOT_DOPPLER=0 desliga o fallback. None se não achou."""
    k = os.environ.get("LOL_RIOT_API_KEY")
    if k:
        return k.strip()
    if os.environ.get("LOL_RIOT_DOPPLER") == "0":
        return None
    try:
        r = subprocess.run(["doppler", "secrets", "get", "LOL_RIOT_API_KEY", "--plain", "--project", "pessoal",
                            "--config", "prd", "--scope", str(DOPPLER_SCOPE)],
                           capture_output=True, text=True, timeout=30,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except (OSError, subprocess.SubprocessError):
        return None
    v = (r.stdout or "").strip()
    return v if r.returncode == 0 and v.startswith("RGAPI-") else None


class LimiteTaxa:
    """janelas deslizantes de um host; vive no processo inteiro (2ª partida em < 2 min degrada, não estoura)"""

    def __init__(self, janelas=JANELAS, relogio=time.monotonic, dormir=time.sleep):
        self.janelas = janelas
        self.hist = deque()
        self.relogio, self.dormir = relogio, dormir
        self.trava = threading.Lock()
        self.bloqueado_ate = 0.0

    def _limpar(self, agora):
        maior = max(j for _, j in self.janelas)
        while self.hist and agora - self.hist[0] > maior:
            self.hist.popleft()

    def espera(self, agora):
        """segundos até poder fazer mais uma chamada (0 = já)"""
        self._limpar(agora)
        w = max(0.0, self.bloqueado_ate - agora)
        for n, jan in self.janelas:
            dentro = [t for t in self.hist if agora - t < jan]
            if len(dentro) >= n:
                w = max(w, jan - (agora - dentro[-n]) + 0.01)
        return w

    def saldo(self, janela_idx=-1):
        """quantas chamadas cabem agora na janela longa (padrão: a de 2 min)"""
        n, jan = self.janelas[janela_idx]
        agora = self.relogio()
        with self.trava:
            self._limpar(agora)
            return max(0, n - sum(1 for t in self.hist if agora - t < jan))

    def tomar(self):
        while True:
            with self.trava:
                agora = self.relogio()
                w = self.espera(agora)
                if w <= 0:
                    self.hist.append(agora)
                    return
            self.dormir(min(w, 5.0))

    def bloquear(self, segundos):
        with self.trava:
            self.bloqueado_ate = max(self.bloqueado_ate, self.relogio() + segundos)

    def sincronizar(self, cabecalho):
        """X-App-Rate-Limit-Count ("5:1,60:120") da resposta: se o servidor contou mais que o processo na
        janela longa (outro processo usou a chave), preenche o histórico para não tomar 429"""
        try:
            contas = {int(j): int(n) for n, j in (x.split(":") for x in str(cabecalho or "").split(",") if ":" in x)}
        except ValueError:
            return
        n_srv = contas.get(int(self.janelas[-1][1]))
        if n_srv is None:
            n_srv = contas.get(120)
        if n_srv is None:
            return
        with self.trava:
            agora = self.relogio()
            local = sum(1 for t in self.hist if agora - t < self.janelas[-1][1])
            for _ in range(max(0, n_srv - local)):
                self.hist.append(agora)


class RiotAPI:
    """GET na Riot API. `host` = "br1" (plataforma: league, mastery, spectator, summoner) ou
    "americas" (regional: account, match). 404 → None. Contador de chamadas por host em
    `self.contador` (o carregamento loga contra o orçamento)."""

    def __init__(self, chave=None, cache_disco=CACHE_DISCO, abrir=None):
        self._chave = chave
        self._chave_fixa = chave is not None   # passada no construtor (testes): não relê
        self._tentou_em = None                  # monotonic da última leitura (Doppler) que não achou
        self.limites = {h: LimiteTaxa() for h in HOSTS}
        self.contador = Counter()
        self.mem = {}
        self.cache_disco = Path(cache_disco) if cache_disco else None
        self._abrir = abrir or urllib.request.urlopen

    def _valor_chave(self):
        """a chave, lida na 1ª vez; leitura que falhou (Doppler sem rede, CLI deslogado) é refeita depois
        de RELER_CHAVE_S, em vez de virar "" até o coletor reiniciar (o cliente é um só no processo)"""
        if self._chave_fixa or self._chave:
            return self._chave or ""
        agora = time.monotonic()
        if self._tentou_em is None or agora - self._tentou_em >= RELER_CHAVE_S:
            self._tentou_em = agora
            self._chave = ler_chave() or None
        return self._chave or ""

    def tem_chave(self):
        return bool(self._valor_chave())

    def saldo(self, host):
        return self.limites[host].saldo()

    def _cabecalhos(self):
        cab = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        cab[CABECALHO_CHAVE] = self._valor_chave()
        return cab

    def _arquivo(self, caminho):
        nome = urllib.parse.quote(caminho.strip("/"), safe="").replace("%", "_")
        return self.cache_disco / f"{nome}.json"

    def get(self, host, caminho, params=None, ttl=600, disco=None, tentativas=3):
        """dado da Riot ou None (404). ttl: segundos em memória (0 = sem cache).
        disco: função que tira a identidade do dado antes de gravar em dados/riot-cache/ (só para
        recurso chaveado por matchId; nunca por puuid). O que volta do disco é a versão anonimizada."""
        if params:
            caminho = caminho + "?" + urllib.parse.urlencode(params)
        chave_cache = (host, caminho)
        agora = time.time()
        if ttl and chave_cache in self.mem and agora - self.mem[chave_cache][0] < ttl:
            return self.mem[chave_cache][1]
        arq = self._arquivo(caminho) if (disco and self.cache_disco) else None
        if arq is not None and arq.exists():
            try:
                return json.loads(arq.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                pass
        if not self.tem_chave():
            raise SemChave()
        req = urllib.request.Request(HOSTS[host] + caminho, headers=self._cabecalhos())
        sem_query = mascarar(caminho)
        for tentativa in range(tentativas):
            self.limites[host].tomar()
            self.contador[host] += 1
            try:
                with self._abrir(req, timeout=20) as r:
                    dado = json.loads(r.read() or b"null")
                    cab = getattr(r, "headers", None)
                    if cab is not None:
                        self.limites[host].sincronizar(cab.get("X-App-Rate-Limit-Count"))
                break
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    dado = None
                    break
                if e.code == 429 or e.code >= 500:
                    ra = e.headers.get("Retry-After") if e.headers else None
                    espera = float(ra) if ra else 2.0 ** (tentativa + 1)
                    log.warning("riot %s %s em %s: esperando %.0f s", host, e.code, sem_query, espera)
                    self.limites[host].bloquear(espera)
                    if tentativa + 1 < tentativas:
                        continue
                raise ErroRiot(e.code, sem_query) from None
            except (urllib.error.URLError, TimeoutError, ConnectionError, ValueError) as e:
                if tentativa + 1 < tentativas:
                    time.sleep(1 + tentativa)
                    continue
                raise ErroRiot(-1, sem_query, type(e).__name__) from None
        if arq is not None and dado is not None:
            dado = disco(dado)
            try:
                arq.parent.mkdir(parents=True, exist_ok=True)
                arq.write_text(json.dumps(dado, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            except OSError:
                pass
        if ttl:
            self.mem[chave_cache] = (agora, dado)
        return dado

    def esquecer(self):
        """limpa o cache em memória (fim da partida: identidade de terceiros não sobrevive)"""
        self.mem.clear()

    # ---------- atalhos (rotas conferidas em docs/MERCADO.md § 5) ----------
    # o puuid da Riot API é cifrado por chave e NÃO é o puuid da LCU (UUID; dá 400 aqui):
    # Riot ID -> conta() -> puuid da API, ou os 10 do spectator-v5

    def conta(self, nome, tag):
        """account-v1 por Riot ID; None se não existe"""
        n, t = urllib.parse.quote(nome, safe=""), urllib.parse.quote(tag, safe="")
        return self.get("americas", f"/riot/account/v1/accounts/by-riot-id/{n}/{t}", ttl=3600)

    def liga(self, puuid):
        return self.get("br1", f"/lol/league/v4/entries/by-puuid/{puuid}") or []

    def maestria(self, puuid, campeao):
        """None = nunca jogou (404)"""
        return self.get("br1", f"/lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}/by-champion/{campeao}")

    def maestria_top(self, puuid, n=3):
        return self.get("br1", f"/lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}/top",
                        {"count": n}) or []

    def partida_ativa(self, puuid):
        """spectator-v5 (o parâmetro é PUUID); None fora de partida"""
        return self.get("br1", f"/lol/spectator/v5/active-games/by-summoner/{puuid}", ttl=30)

    def ids_partidas(self, puuid, n=10, fila=None, tipo=None, desde_s=None):
        """ids do match-v5, mais nova primeiro; desde_s = epoch em segundos (startTime)"""
        p = {"start": 0, "count": n}
        if fila:
            p["queue"] = fila
        if tipo:
            p["type"] = tipo
        if desde_s:
            p["startTime"] = int(desde_s)
        return self.get("americas", f"/lol/match/v5/matches/by-puuid/{puuid}/ids", p) or []

    def partida(self, match_id, disco=None):
        return self.get("americas", f"/lol/match/v5/matches/{match_id}", ttl=3600, disco=disco)

    def timeline(self, match_id, disco=None):
        return self.get("americas", f"/lol/match/v5/matches/{match_id}/timeline", ttl=3600, disco=disco)

    def entradas_liga(self, tier, divisao, pagina=1, fila="RANKED_SOLO_5x5"):
        return self.get("br1", f"/lol/league/v4/entries/{fila}/{tier}/{divisao}", {"page": pagina}, ttl=0) or []


_PART_OK = ("participantId", "teamId", "championId", "teamPosition", "individualPosition", "win", "kills",
            "deaths", "assists", "totalMinionsKilled", "neutralMinionsKilled", "visionScore", "goldEarned",
            "gameEndedInEarlySurrender", "champLevel")
_DESAFIOS_OK = ("laningPhaseGoldExpAdvantage", "earlyLaningPhaseGoldExpAdvantage", "soloKills",
                "takedownsFirstXMinutes")


def anonimizar_partida(m):
    """match-v5 sem identidade (sem puuid, Riot ID, summonerId): o que pode ir para disco"""
    info = (m or {}).get("info") or {}
    return {"metadata": {"matchId": ((m or {}).get("metadata") or {}).get("matchId")},
            "info": {**{k: info.get(k) for k in ("gameCreation", "gameDuration", "gameVersion", "queueId",
                                                  "mapId", "endOfGameResult")},
                     "participants": [{**{k: p.get(k) for k in _PART_OK},
                                       "challenges": {k: (p.get("challenges") or {}).get(k) for k in _DESAFIOS_OK}}
                                      for p in info.get("participants") or []]}}


_cliente = [None]


def cliente():
    """o cliente do processo (um só, para os baldes valerem entre partidas)"""
    if _cliente[0] is None:
        _cliente[0] = RiotAPI()
    return _cliente[0]
