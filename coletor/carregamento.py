# tela de carregamento (plano v2, passo 18: C4 + L1–L4; contrato em docs/MERCADO.md § 2 e § 7).
# Gatilho medido em 13/10/2026: a Live Client responde ~7 s após InProgress com gameTime parado em
# ~0,025 e sem o evento GameStart; são ~100 s de janela (docs/MEDICAO-2026-10-13.md § 1).
# Os 10 vêm do spectator-v5 pelo puuid da Riot API do Gabriel (o puuid da LCU NÃO serve na Riot API);
# sem spectator, pelo Riot ID da Live Client -> account-v1. Jogador sem puuid (modo streamer) = oculto,
# nenhuma chamada. Identidade de terceiros (puuid, Riot ID) só em memória: o que sai daqui (estado,
# log, previsão gravada) fala só de campeão. Tags com número, sem score composto.
import json
import logging
import ssl
import sqlite3
import sys
import threading
import time
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import banco  # noqa: E402
import draft  # noqa: E402
import riotapi  # noqa: E402

LIVE_PADRAO = "https://127.0.0.1:2999"
GT_CARREGANDO = 0.1          # gameTime parado em ~0,025 no carregamento
FILAS_SR = (400, 420, 430, 440, 490, 700)
ROTAS = draft.ROTAS
TIMES = {"ORDER": 100, "CHAOS": 200}
SMITES = ("Golpear", "Golpe Irrestrito", "Golpe Primordial", "Smite")  # o nome muda com o upgrade
# orçamento por partida (MERCADO § 7): br1 = spectator + 10 × (liga + maestria + maestria top);
# americas = conta do Gabriel + 10 ids + ≤ 50 partidas (5 por jogador, premade baixado 1 vez) + 10 timelines
ORCAMENTO = {"br1": 31, "americas": 72}
PARTIDAS_POR_JOGADOR = 5
IDS_POR_JOGADOR = 10
TIMELINES_POR_ALVO = 5
FALHA = object()             # sentinela de _chamar: erro ou sem cota (≠ 404)
TRABALHADORES = 6           # chamadas em paralelo (a latência domina: sequencial levou 35 s na partida real)
# limiares das tags (MERCADO § 2; os marcados "proposta" lá são ponto de partida a calibrar)
MIN_STREAK = 3
MIN_JOGOS_ROTA = 3
FATIA_FORA = 0.25
OTP_RAZAO, OTP_MIN_PONTOS, OTP_FRACAO = 5.0, 20000, 0.8
POUCA_EXP = 5000
KDA_BOM, MIN_JOGOS_KDA = 3.0, 2
# `laningPhaseGoldExpAdvantage` = 1 só com vantagem GRANDE de ouro+xp na rota (medido 13/10/2026: 12% dos
# jogos; com 1, +24% ou mais aos 14 min; com 0, 42% estavam à frente): mede "domina a rota", nunca "perde"
DOMINA_ROTA, MIN_JOGOS_ROTA_ADV = 2, 3
SOLO_KILLS = 2.5             # média de 5 jogos (p50 1,4, p85 ~2,5 na meta coletada, EMERALD)
MORRE_CEDO, MIN_TIMELINES = 1.5, 3
MS_10 = 600000
# peso fixo e pequeno de cada tag na previsão (pp, do ponto de vista do time do jogador); L4
PESO_TAG = {"primeira_vez": -4.0, "pouca_experiencia": -2.0, "otp": 2.0, "fora_da_rota": -2.0,
            "derrotas_seguidas": -1.0, "vitorias_seguidas": 1.0}
log = logging.getLogger("coletor.carregamento")


# ---------- Live Client ----------

def ler_live(url=LIVE_PADRAO, caminho="/liveclientdata/allgamedata", timeout=2):
    """allgamedata da Live Client ou None (fora de partida a porta recusa)"""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        with urllib.request.urlopen(url + caminho, context=ctx if url.startswith("https") else None,
                                    timeout=timeout) as r:
            return json.loads(r.read())
    except Exception:
        return None


def em_carregamento(dados):
    """True na tela de carregamento: Live Client respondendo, gameTime parado e sem GameStart"""
    if not isinstance(dados, dict) or not dados.get("allPlayers"):
        return False
    gt = (dados.get("gameData") or {}).get("gameTime")
    ev = (dados.get("events") or {}).get("Events") or []
    return gt is not None and gt < GT_CARREGANDO and not any(e.get("EventName") == "GameStart" for e in ev)


def jogadores_live(dados, ids_por_nome):
    """os 10 da Live Client: campeão (id pelo nome localizado), time, rota declarada, smite.
    `riot_id` (nome, tag) fica só em memória, para o fallback sem spectator."""
    ativo = dados.get("activePlayer") or {}
    eu = (ativo.get("riotIdGameName") or ativo.get("summonerName"), ativo.get("riotIdTagLine"))
    out = []
    for p in dados.get("allPlayers") or []:
        nome = p.get("championName") or ""
        cid = ids_por_nome.get(nome.lower())
        feit = [((p.get("summonerSpells") or {}).get(k) or {}).get("displayName") for k in
                ("summonerSpellOne", "summonerSpellTwo")]
        pos = str(p.get("position") or "").upper()
        rid = (p.get("riotIdGameName") or "", p.get("riotIdTagLine") or "")
        out.append({"campeao": cid, "nome": nome, "time": TIMES.get(p.get("team")), "rota": pos if pos in ROTAS else None,
                    "smite": any(f in SMITES for f in feit if f), "riot_id": rid if all(rid) else None,
                    "eu": bool(eu[0]) and rid[0] == eu[0] and (not eu[1] or rid[1] == eu[1])})
    return out


def jogadores_spectator(ativa):
    """os 10 do spectator-v5: puuid da Riot API (None = oculto), campeão, time, feitiços, runas"""
    out = []
    for p in (ativa or {}).get("participants") or []:
        out.append({"puuid": p.get("puuid") or None, "campeao": p.get("championId"), "time": p.get("teamId"),
                    "feiticos": [p.get("spell1Id"), p.get("spell2Id")],
                    "smite": draft.SMITE in (p.get("spell1Id"), p.get("spell2Id")),
                    "perks": (p.get("perks") or {}).get("perkIds")})
    return out


def mesclar(spec, live):
    """junta spectator (puuid, ids) e Live Client (rota declarada) por (campeão, time)"""
    por = {(j["campeao"], j["time"]): j for j in live or [] if j.get("campeao")}
    out = []
    for j in spec:
        l = por.get((j["campeao"], j["time"])) or {}
        out.append({**j, "rota": l.get("rota"), "smite": j.get("smite") or l.get("smite", False)})
    return out


# ---------- resumo e tags (puros) ----------

def resumo_partida(m, puuid):
    """o participante `puuid` numa partida match-v5 (só agregados), ou None"""
    info = (m or {}).get("info") or {}
    p = next((x for x in info.get("participants") or [] if x.get("puuid") == puuid), None)
    if not p or info.get("mapId") != 11:
        return None
    ch = p.get("challenges") or {}
    return {"match_id": ((m.get("metadata") or {}).get("matchId")), "fila": info.get("queueId"),
            "criacao": info.get("gameCreation"), "participante": p.get("participantId"),
            "campeao": p.get("championId"), "rota": p.get("teamPosition") or None, "vitoria": bool(p.get("win")),
            "k": p.get("kills", 0), "d": p.get("deaths", 0), "a": p.get("assists", 0),
            "remake": bool(p.get("gameEndedInEarlySurrender")) or info.get("gameDuration", 0) < 300,
            "rota_ganha": ch.get("laningPhaseGoldExpAdvantage"), "solo_kills": ch.get("soloKills")}


def mortes_cedo(timeline, participante):
    """mortes antes dos 10 min do participante numa timeline do match-v5"""
    n = 0
    for f in ((timeline or {}).get("info") or {}).get("frames") or []:
        for e in f.get("events") or []:
            if e.get("type") == "CHAMPION_KILL" and e.get("victimId") == participante and e.get("timestamp", 0) < MS_10:
                n += 1
    return n


def _num(x, casas=1):
    return f"{x:.{casas}f}".replace(".", ",")


def _mil(p):
    return f"{_num(p / 1000, 1 if p < 10000 else 0)} mil"


def tags(perfil, campeao, rota, nomes=None):
    """tags da MERCADO § 2 com número ao lado. perfil = {"partidas": [resumo_partida, mais nova
    primeiro], "maestria": pontos|0 (nunca jogou)|None (sem dado), "maestria_top": [(campeao, pontos)],
    "mortes_cedo": [n por partida]|None}. sinal: "+" bom para o jogador, "-" ruim, "=" neutro."""
    nomes = nomes or {}
    nc = nomes.get(campeao, str(campeao))
    ps = [p for p in perfil.get("partidas") or [] if not p.get("remake")]
    out = []

    def tag(i, texto, sinal):
        out.append({"id": i, "texto": texto, "sinal": sinal})

    if ps:
        seq = 0
        for p in ps:
            if p["vitoria"] != ps[0]["vitoria"]:
                break
            seq += 1
        if seq >= MIN_STREAK:
            if ps[0]["vitoria"]:
                tag("vitorias_seguidas", f"{seq} vitórias seguidas", "+")
            else:
                tag("derrotas_seguidas", f"{seq} derrotas seguidas", "-")
    com_rota = [p for p in ps if p.get("rota")]
    if rota and len(com_rota) >= MIN_JOGOS_ROTA:
        k = sum(p["rota"] == rota for p in com_rota)
        if k / len(com_rota) < FATIA_FORA:
            tag("fora_da_rota", f"fora da rota: {k} de {len(com_rota)} jogos de {rota.lower()}", "-")
    pontos = perfil.get("maestria")
    top = sorted(perfil.get("maestria_top") or [], key=lambda x: -x[1])
    no_camp = [p for p in ps if p["campeao"] == campeao]
    if top and top[0][0] == campeao and top[0][1] >= OTP_MIN_PONTOS and (
            len(top) == 1 or top[0][1] >= OTP_RAZAO * max(top[1][1], 1)):
        razao = f" ({_num(top[0][1] / max(top[1][1], 1))}× o 2º)" if len(top) > 1 else ""
        tag("otp", f"OTP de {nc}: {_mil(top[0][1])} de maestria{razao}", "+")
    elif len(ps) >= 4 and len(no_camp) / len(ps) >= OTP_FRACAO:
        tag("otp", f"OTP de {nc}: {len(no_camp)} de {len(ps)} jogos", "+")
    if pontos == 0:
        tag("primeira_vez", f"primeira vez de {nc}", "-")
    elif pontos is not None and pontos < POUCA_EXP:
        tag("pouca_experiencia", f"pouca experiência de {nc}: {_mil(pontos)} de maestria", "-")
    if len(no_camp) >= MIN_JOGOS_KDA:
        k, d, a = (sum(p[x] for p in no_camp) for x in ("k", "d", "a"))
        kda = (k + a) / max(d, 1)
        if kda >= KDA_BOM:
            tag("kda_bom", f"KDA {_num(kda)} de {nc} em {len(no_camp)} jogos", "+")
    rg = [p["rota_ganha"] for p in ps if p.get("rota_ganha") is not None]
    if len(rg) >= MIN_JOGOS_ROTA_ADV:
        g = sum(1 for x in rg if x >= 1)
        if g >= DOMINA_ROTA:
            tag("domina_rota", f"dominou a rota em {g} de {len(rg)}", "+")
    sk = [p["solo_kills"] for p in ps if p.get("solo_kills") is not None]
    if len(sk) >= MIN_JOGOS_ROTA_ADV and sum(sk) / len(sk) >= SOLO_KILLS:
        tag("agressivo", f"{_num(sum(sk) / len(sk))} abate solo por jogo", "=")
    mc = perfil.get("mortes_cedo")
    if mc is not None and len(mc) >= MIN_TIMELINES and sum(mc) / len(mc) >= MORRE_CEDO:
        tag("morre_cedo", f"morre cedo: {_num(sum(mc) / len(mc))} morte antes dos 10 ({len(mc)} jogos)", "-")
    return out


def logit_pp(pp):
    return draft.logit(0.5 + pp / 100)


# ---------- análise ----------

class Carregamento:
    """Uma análise de carregamento por partida, em memória. Uso pela integração:
        car = Carregamento()                     # um por processo (os baldes da Riot API são do processo)
        car.verificar(allgamedata)               # a cada leitura da Live Client; dispara 1 vez por partida, em thread
        car.estado()                             # dict público (sem identidade) para o painel, /estado, MCP
        car.encerrar()                           # EndOfGame: esquece a identidade de todo mundo
    `ao_atualizar(estado)` é chamado a cada camada (L1, L2, L3, pronto)."""

    def __init__(self, api=None, conn_lol=None, caminho_lol=None, conn_meta=None, gravar_em=None,
                 ao_atualizar=None, orcamento=None, draft_obj=None):
        self.api = api or riotapi.cliente()
        self.caminho_lol = caminho_lol or banco.DB_PADRAO
        self._lol = conn_lol
        self._meta = conn_meta
        self.gravar_em = gravar_em
        self.ao_atualizar = ao_atualizar
        self.orcamento = dict(orcamento or ORCAMENTO)
        self._draft = draft_obj
        self.trava = threading.Lock()
        self.thread = None
        self.chave_partida = None
        self.meu_puuid = None
        self.runas = {}  # {championId: [perkIds]} do spectator (feiticos.Feiticos.definir_runas); sem identidade
        self._estado = {"partida": False}
        self._trava_orc = threading.Lock()
        self._zerar_contagem()

    # --- infraestrutura ---

    @staticmethod
    def _ro(caminho):
        """conexão só leitura usável de outra thread (a análise roda em thread própria)"""
        caminho = Path(caminho)
        if not caminho.exists():
            raise FileNotFoundError(str(caminho))
        return sqlite3.connect(f"file:{caminho.as_posix()}?mode=ro", uri=True, timeout=30, check_same_thread=False)

    @property
    def lol(self):
        if self._lol is None:
            self._lol = self._ro(self.caminho_lol)
        return self._lol

    def nomes(self):
        return dict(self.lol.execute("select id, nome from campeoes"))

    def ids_por_nome(self):
        return {str(n).lower(): i for i, n in self.lol.execute("select id, nome from campeoes") if n and i < 10000}

    def _draft_obj(self):
        if self._draft is None:
            try:
                if self._meta is None and draft.DB_META.exists():
                    self._meta = self._ro(draft.DB_META)
                self._draft = draft.Draft(conn_lol=self.lol, conn_meta=self._meta)
            except Exception as e:  # sem meta.db ou banco incompleto: previsão só com tags
                log.warning("draft indisponível: %s", type(e).__name__)
                self._draft = False
        return self._draft or None

    def _chamar(self, host, f, *args, padrao=None, falha=None):
        """chamada com orçamento: reserva a vaga sob trava (várias threads), e recusa se a partida ou o
        balde de 2 min não comportam mais uma. Erro da Riot vira item em `erros`, nunca exceção.
        404 -> padrao; erro ou sem cota -> falha (padrao se não dado): distingue "nunca jogou" de "sem dado"."""
        falha = padrao if falha is None else falha
        with self._trava_orc:
            if self._reservas[host] + 1 > self.orcamento[host] or self.api.saldo(host) < 1:
                self._sem_cota[host] += 1
                return falha
            self._reservas[host] += 1  # conta a tentativa (cache em memória também; retry de 429 não)
        try:
            r = f(*args)
            return padrao if r is None and padrao is not None else r
        except riotapi.ErroRiot as e:
            self._erros.append(str(e))
            return falha

    def _paralelo(self, f, itens):
        with ThreadPoolExecutor(max_workers=TRABALHADORES) as ex:
            return list(ex.map(f, itens))

    def meu_puuid_api(self):
        """puuid da Riot API do Gabriel (Riot ID da tabela meta -> account-v1), em memória"""
        if self.meu_puuid is None:
            r = self.lol.execute("select valor from meta where chave='jogador'").fetchone()
            if r and "#" in r[0]:
                conta = self._chamar("americas", self.api.conta, *r[0].split("#", 1))
                self.meu_puuid = (conta or {}).get("puuid")
        return self.meu_puuid

    # --- gatilho ---

    def verificar(self, dados, fila=None):
        """chamar a cada allgamedata: no carregamento de uma partida nova, dispara a análise em thread"""
        if not em_carregamento(dados):
            return False
        chave = tuple(sorted((p.get("championName"), p.get("team")) for p in dados.get("allPlayers") or []))
        with self.trava:
            if chave == self.chave_partida or (self.thread and self.thread.is_alive()):
                return False
            self.chave_partida = chave
            self.thread = threading.Thread(target=self._rodar_seguro, args=(dados, fila), daemon=True)
            self.thread.start()
        return True

    def _rodar_seguro(self, dados, fila):
        try:
            self.analisar_live(dados, fila)
        except Exception as e:
            log.exception("carregamento falhou: %s", type(e).__name__)
            with self.trava:
                self.chave_partida = None  # a próxima leitura ainda no carregamento tenta de novo
            self._publicar({**self._estado, "erro": type(e).__name__})

    def estado(self):
        with self.trava:
            return json.loads(json.dumps(self._estado))

    def _publicar(self, est):
        with self.trava:
            self._estado = est
        if self.ao_atualizar:
            try:
                self.ao_atualizar(json.loads(json.dumps(est)))
            except Exception:
                log.exception("ao_atualizar falhou")

    def encerrar(self):
        """fim da partida: esquece puuid/Riot ID de todo mundo (memória) e o cache da Riot API"""
        with self.trava:
            self._estado = {"partida": False}
            self.chave_partida = None
            self.runas = {}
        self.api.esquecer()

    # --- montagem dos 10 ---

    def _zerar_contagem(self):
        self._base = Counter(self.api.contador)
        self._erros, self._sem_cota, self._reservas = [], Counter(), Counter()

    def analisar_live(self, dados, fila=None):
        """a partir de um allgamedata do carregamento: os 10 pelo spectator (ou Riot ID) e a análise"""
        self._zerar_contagem()
        live = jogadores_live(dados, self.ids_por_nome())
        meu = self.meu_puuid_api()
        ativa = self._chamar("br1", self.api.partida_ativa, meu) if meu else None
        if ativa:
            import feiticos  # noqa: PLC0415 (só a função pura: campeão -> perkIds, sem riotId/puuid)
            self.runas = feiticos.runas_do_espectador(ativa)
            jog = mesclar(jogadores_spectator(ativa), live)
            fila = fila or ativa.get("gameQueueConfigId")
            game_id = ativa.get("gameId")
            for j in jog:
                j["eu"] = bool(meu) and j["puuid"] == meu
        else:  # sem spectator: Riot ID da Live Client -> account-v1 (custa 1 americas por jogador)
            game_id = None
            contas = self._paralelo(lambda j: self._chamar("americas", self.api.conta, *j["riot_id"])
                                    if j.get("riot_id") else None, live)
            jog = [{**{k: v for k, v in j.items() if k != "riot_id"}, "puuid": (c or {}).get("puuid")}
                   for j, c in zip(live, contas)]
        return self.analisar(jog, fila=fila, game_id=game_id, zerar=False)

    def analisar(self, jogadores, fila=None, game_id=None, zerar=True):
        """jogadores: [{"puuid" (Riot API; None = oculto), "campeao", "time", "rota" (None = inferir),
        "smite", "eu"}]. Devolve o estado público; puuids ficam só em self._perfis (memória)."""
        if zerar:
            self._zerar_contagem()
        t0 = time.time()
        nomes = self.nomes()
        eu = next((j for j in jogadores if j.get("eu")), None)
        meu_time = eu["time"] if eu else 100
        # rota: a declarada; faltando, inferida por time (smite fixa o jungler)
        for t in (100, 200):
            lado = [j for j in jogadores if j["time"] == t and j.get("campeao")]
            if any(not j.get("rota") for j in lado):
                d = self._draft_obj()
                fixos = {j["campeao"]: j["rota"] for j in lado if j.get("rota")}
                fixos.update({j["campeao"]: "JUNGLE" for j in lado if j.get("smite") and not j.get("rota")})
                cont = d.cont if d else {}
                r = draft.rotas_provaveis([j["campeao"] for j in lado], cont, fixos)
                for j in lado:
                    if not j.get("rota"):
                        j["rota"], j["fonte_rota"] = r["rotas"].get(j["campeao"]), "inferida"
        for j in jogadores:
            j.setdefault("fonte_rota", "declarada")
        minha_rota = eu and eu.get("rota")
        adv = next((j for j in jogadores if j["time"] != meu_time and minha_rota and j.get("rota") == minha_rota), None)
        jg = next((j for j in jogadores if j["time"] != meu_time and j.get("rota") == "JUNGLE"), None)
        self._perfis = {id(j): {"partidas": [], "maestria": None, "maestria_top": [], "mortes_cedo": None,
                                "liga": None} for j in jogadores}
        base = {"partida": True, "fase": "carregamento", "game_id": game_id, "fila": fila,
                "adversario": adv and adv["campeao"], "jungler_inimigo": jg and jg["campeao"]}

        dobj = self._draft_obj()
        meta_wr = {id(j): dobj.wr_rota(j["campeao"], j.get("rota")) if dobj else None for j in jogadores}

        def publico(camada):
            js = []
            for j in jogadores:
                pf = self._perfis[id(j)]
                js.append({"campeao": j["campeao"], "nome": nomes.get(j["campeao"], str(j["campeao"])),
                           "meta_rota": meta_wr[id(j)],
                           "time": j["time"], "lado": "aliado" if j["time"] == meu_time else "inimigo",
                           "eu": bool(j.get("eu")), "rota": j.get("rota"), "fonte_rota": j.get("fonte_rota"),
                           "oculto": not j.get("puuid"), **self._resumo_publico(pf),
                           "tags": tags(pf, j["campeao"], j.get("rota"), nomes) if j.get("puuid") else []})
            usado = {h: self.api.contador[h] - self._base[h] for h in self.orcamento}
            return {**base, "camada": camada, "jogadores": js, "chamadas": usado, "orcamento": self.orcamento,
                    "sem_cota": dict(self._sem_cota), "erros": self._erros[-5:], "segundos": round(time.time() - t0, 1)}

        visiveis = [j for j in jogadores if j.get("puuid")]
        # L1 (br1): elo, WR da fila, maestria no campeão e top 3 (em paralelo; o balde segura a taxa)
        fila_liga = "RANKED_FLEX_SR" if fila == 440 else "RANKED_SOLO_5x5"

        def l1(j):
            pf = self._perfis[id(j)]
            entradas = self._chamar("br1", self.api.liga, j["puuid"], padrao=[])
            pf["liga"] = next((e for e in entradas if e.get("queueType") == fila_liga), None) or \
                next((e for e in entradas if e.get("queueType") == "RANKED_SOLO_5x5"), None)
            m = self._chamar("br1", self.api.maestria, j["puuid"], j["campeao"], falha=FALHA)
            if m is not FALHA:
                pf["maestria"] = (m or {}).get("championPoints", 0)  # 404 = nunca jogou = 0; erro = None
                pf["maestria_nivel"] = (m or {}).get("championLevel")
            top = self._chamar("br1", self.api.maestria_top, j["puuid"], 3, padrao=[])
            pf["maestria_top"] = [(x.get("championId"), x.get("championPoints", 0)) for x in top]
        self._paralelo(l1, visiveis)
        self._publicar(publico("L1"))
        # L2 (americas): ids de cada um, depois as partidas (premade baixado uma vez: dedupe por matchId)
        tipo = "ranked" if fila in (420, 440) else None
        alvos = [x for x in dict.fromkeys(id(a) for a in (adv, jg) if a and a.get("puuid"))]
        lista = self._paralelo(lambda j: self._chamar("americas", self.api.ids_partidas, j["puuid"],
                                                      IDS_POR_JOGADOR, None, tipo, padrao=[]), visiveis)
        livre = self.orcamento["americas"] - self._reservas["americas"] - TIMELINES_POR_ALVO * len(alvos)
        cota = max(1, min(PARTIDAS_POR_JOGADOR, livre // max(len(visiveis), 1)))
        baixar = list(dict.fromkeys(mid for ids in lista for mid in ids[:cota]))
        partidas = dict(zip(baixar, self._paralelo(lambda mid: self._chamar("americas", self.api.partida, mid), baixar)))
        for j, ids in zip(visiveis, lista):
            pf = self._perfis[id(j)]
            for mid in ids[:cota]:
                r = resumo_partida(partidas.get(mid), j["puuid"])
                if r and r["fila"] in FILAS_SR:
                    pf["partidas"].append(r)
        self._publicar(publico("L2"))
        # L3 (americas): "morre cedo" do adversário de rota e do jungler inimigo
        tarefas = [(alvo, r) for alvo in (adv, jg) if alvo and alvo.get("puuid") for r in
                   [p for p in self._perfis[id(alvo)]["partidas"] if not p["remake"]][:TIMELINES_POR_ALVO]]
        tarefas = list({(id(a), r["match_id"]): (a, r) for a, r in tarefas}.values())
        tls = self._paralelo(lambda t: self._chamar("americas", self.api.timeline, t[1]["match_id"]), tarefas)
        for alvo in (adv, jg):
            if alvo and alvo.get("puuid"):
                self._perfis[id(alvo)]["mortes_cedo"] = [mortes_cedo(tl, r["participante"])
                                                         for (a, r), tl in zip(tarefas, tls) if a is alvo and tl]
        est = publico("L3")
        self._publicar(est)
        # L4: previsão em faixa (draft + jogadores), sem identidade
        est["previsao"] = self.previsao(jogadores, meu_time, eu, est["jogadores"], nomes)
        est["camada"] = "pronto"
        usado = est["chamadas"]
        log.info("carregamento: chamadas br1=%d americas=%d (orçamento %d/%d), sem cota %s, erros %d, %.1f s",
                 usado.get("br1", 0), usado.get("americas", 0), self.orcamento["br1"], self.orcamento["americas"],
                 dict(self._sem_cota), len(self._erros), time.time() - t0)
        if self.gravar_em and est["previsao"]:
            try:
                c = sqlite3.connect(self.gravar_em, timeout=30)
                draft.gravar_previsao(c, game_id or "?", "carregamento", est["previsao"], game_id)
                c.close()
            except sqlite3.Error as e:
                log.warning("previsão não gravada: %s", e)
        self._publicar(est)
        return est

    @staticmethod
    def _resumo_publico(pf):
        lg = pf.get("liga")
        ps = [p for p in pf.get("partidas") or [] if not p.get("remake")]
        mc = pf.get("mortes_cedo")
        return {
            "elo": f"{lg['tier']} {lg['rank']} {lg['leaguePoints']} PdL" if lg else None,
            "fila_liga": lg and lg.get("queueType"),
            "wr_fila": {"v": lg["wins"], "d": lg["losses"],
                        "wr": round(100 * lg["wins"] / max(lg["wins"] + lg["losses"], 1), 1)} if lg else None,
            "hot_streak": bool(lg and lg.get("hotStreak")),
            "maestria": pf.get("maestria"), "maestria_nivel": pf.get("maestria_nivel"),
            "partidas_lidas": len(ps),
            "recentes": "".join("V" if p["vitoria"] else "D" for p in ps),
            "mortes_cedo": {"media": round(sum(mc) / len(mc), 2), "n": len(mc)} if mc else None,
        }

    def previsao(self, jogadores, meu_time, eu, publicos, nomes):
        """L4: termos do draft (meta + teu histórico) + peso fixo de cada tag de jogador"""
        d = self._draft_obj()
        termos = []
        if d:
            al = [{"campeao": j["campeao"], "rota": j.get("rota")} for j in jogadores if j["time"] == meu_time]
            ini = [{"campeao": j["campeao"], "rota": j.get("rota")} for j in jogadores if j["time"] != meu_time]
            f = draft.forca_draft(al, ini, d.wr, eu and {"campeao": eu["campeao"], "rota": eu.get("rota")},
                                  d.pessoal, d.matchup, nomes)
            termos = f["todos"]
        for pj in publicos:
            sinal = 1 if pj["lado"] == "aliado" else -1
            for t in pj["tags"]:
                pp = PESO_TAG.get(t["id"])
                if pp:
                    lg = sinal * logit_pp(pp)
                    termos.append({"tipo": "jogador", "lado": pj["lado"], "campeao": pj["campeao"], "rota": pj["rota"],
                                   "logit": lg, "pp": round(100 * (draft.sigmoide(lg) - 0.5), 2),
                                   "texto": f"{pj['nome']}: {t['texto']}"})
        total = sum(t["logit"] for t in termos)
        p = draft.sigmoide(total)
        pesaram = sorted((t for t in termos if abs(t["pp"]) >= draft.PP_MINIMO), key=lambda t: -abs(t["pp"]))[:3]
        return {"p": round(p, 4), "faixa": draft.faixa(p),
                "termos": [{k: t.get(k) for k in ("tipo", "lado", "campeao", "rota", "pp", "texto")} for t in pesaram],
                "obs": "faixa calibrável: draft + jogadores acerta 55–60% no mercado (docs/MERCADO.md § 3)"}


_global = [None]


def analisar_agora(live_url=LIVE_PADRAO, esperar=True):
    """para o MCP: lê a Live Client; fora de partida -> {"partida": false}; no carregamento (ou já em
    jogo) roda a análise uma vez por partida, no processo, e devolve o estado público"""
    dados = ler_live(live_url)
    if not dados or not dados.get("allPlayers"):
        return {"partida": False}
    if _global[0] is None:
        _global[0] = Carregamento()
    car = _global[0]
    chave = tuple(sorted((p.get("championName"), p.get("team")) for p in dados.get("allPlayers") or []))
    if chave != car.chave_partida:
        car.encerrar()
        if not car.api.tem_chave():
            return {"partida": True, "erro": "LOL_RIOT_API_KEY ausente: rodar o MCP com doppler run ou ter o Doppler pessoal logado"}
        car.analisar_live(dados)
        car.chave_partida = chave  # só depois do sucesso: falhou, a próxima chamada tenta de novo
    est = car.estado()
    est["em_carregamento"] = em_carregamento(dados)
    return est
