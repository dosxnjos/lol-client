# Testa tools/medir-compacto.py sem o client: LCU falsa (só get, como a de verdade do coletor), relógio falso,
# Live Client falsa e print falso. Prova: passa pelas fases de uma ranqueada (lobby com convite, fila, ready check,
# champ select com troca pedida e aceita, partida, pós-jogo com PDL) e grava cada sinal; nada de nome, puuid,
# summonerId, dado da sala do chat ou texto de amigo no arquivo; prints só nos marcos (carregamento, 3, 8, 15 min) e
# só pelo Edge headless do painel. uso: python tools/teste-medir-compacto.py
import importlib.util
import json
import sys
import tempfile
import urllib.error
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("medir_compacto", RAIZ / "tools" / "medir-compacto.py")
mc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mc)


# sala do chat da seleção: a mesma da fixture versionada (valores falsos), para não repetir o formato aqui
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


SALA = _achar(json.loads((RAIZ / "tests" / "fixtures" / "champselect-autofill.json").read_text(encoding="utf-8")), "chatDetails")
VALORES_SALA = [v for v in (list(SALA.values()) + list((SALA.get("mucJwtDto") or {}).values())) if isinstance(v, str) and len(v) > 3]
SEGREDOS = ["Fulano", "Ciclano", "BR1", "puuid-aaaa-bbbb", "123456789", "987654321", "oi bora duo", "Beltrano", "Xerekton",
            "Lee Sin", "abc-123", *VALORES_SALA]


class LcuFalsa:
    """rotas por fase + comuns; caminho sem resposta = 404. Só get (como coletor.LCU)."""
    def __init__(self, estado):
        self.estado = estado
        self.pedidos = []

    def get(self, caminho, timeout=30):
        self.pedidos.append(caminho)
        if caminho == "/lol-gameflow/v1/gameflow-phase":
            return self.estado["fase"]
        rotas = {**ROTAS_COMUNS, **ROTAS.get(self.estado["fase"], {})}
        if caminho not in rotas:
            raise urllib.error.HTTPError(caminho, 404, "not found", {}, None)
        r = rotas[caminho]
        return r() if callable(r) else r


def jogador(cell, champ, nome, pos="top", vis="UNHIDDEN"):
    return {"cellId": cell, "championId": champ, "championPickIntent": 0, "assignedPosition": pos, "gameName": nome, "tagLine": "BR1",
            "puuid": "puuid-aaaa-bbbb", "summonerId": 123456789, "nameVisibilityType": vis, "isAutofilled": False,
            "selectedSkinId": champ * 1000, "spell1Id": 4, "spell2Id": 12}


ESTADO = {"fase": "Lobby", "t": 0, "rc": 0, "lp": 14, "lp_pronto": False, "gt": None}
TROCA = {"estado": "AVAILABLE"}
SESSAO_GAMEFLOW = {"gameData": {"gameId": 3300000001, "queue": {"id": 420, "gameMode": "CLASSIC"}, "isCustomGame": False,
                                "playerChampionSelections": [{"summonerInternalName": "Fulano", "championId": 58}]},
                   "map": {"id": 11}}
LP_NOTIF = lambda: ({"leaguePointsDelta": 18, "tier": "EMERALD", "division": "IV", "summonerName": "Xerekton"} if ESTADO["lp_pronto"] else None)
ROTAS_COMUNS = {
    "/lol-gameflow/v1/session": SESSAO_GAMEFLOW,
    "/lol-chat/v1/friends": [
        {"gameName": "Ciclano", "gameTag": "BR1", "puuid": "puuid-aaaa-bbbb", "availability": "chat", "id": "puuid-aaaa-bbbb@br1.pvp.net",
         "lol": {"gameStatus": "inQueue", "timeStamp": "0"}, "statusMessage": "oi bora duo"},
        {"gameName": "Beltrano", "availability": "dnd", "lol": {"gameStatus": "inGame", "timeStamp": "1000"}},
        {"gameName": "Outro", "availability": "offline", "lol": {}},
    ],
    "/lol-ranked/v1/current-ranked-stats": lambda: {"queueMap": {"RANKED_SOLO_5x5": {"tier": "EMERALD", "division": "IV",
                                                                                     "leaguePoints": ESTADO["lp"], "wins": 10, "losses": 9}}},
    "/lol-ranked/v1/current-lp-change-notification": LP_NOTIF,
}
ROTAS = {
    "Lobby": {
        "/lol-lobby/v2/lobby": {"gameConfig": {"queueId": 420}, "members": [{"summonerId": 123456789, "summonerName": "Xerekton"}],
                                "localMember": {"isLeader": True, "firstPositionPreference": "TOP", "secondPositionPreference": "JUNGLE",
                                                "summonerName": "Xerekton", "puuid": "puuid-aaaa-bbbb"},
                                "canStartActivity": False, "restrictions": [{"restrictionCode": "QUEUE_DODGER", "expiredTimestamp": 1}],
                                "invitations": []},
        "/lol-lobby/v2/received-invitations": [{"invitationId": "abc-123", "fromSummonerId": 987654321, "fromSummonerName": "Fulano",
                                                "state": "Pending", "gameConfig": {"queueId": 420}, "timestamp": "2026-10-13T20:00:00"}],
    },
    "Matchmaking": {
        "/lol-matchmaking/v1/search": lambda: {"searchState": "Searching", "timeInQueue": ESTADO["t"], "estimatedQueueTime": 90.0,
                                               "lowPriorityData": {"penaltyTime": 0, "penaltyTimeRemaining": 0, "reason": ""},
                                               "errors": [], "readyCheck": {"state": "Invalid"}},
        "/lol-lobby/v2/lobby/matchmaking/search-state": {"searchState": "Searching", "errors": []},
        "/lol-lobby/v2/lobby": {"gameConfig": {"queueId": 420}, "members": [{}], "localMember": {"isLeader": True}},
    },
    "ReadyCheck": {"/lol-matchmaking/v1/ready-check": lambda: {"state": "InProgress", "playerResponse": "None", "timer": ESTADO["rc"]}},
    "ChampSelect": {
        "/lol-champ-select/v1/session": lambda: {
            "timer": {"phase": "BAN_PICK", "adjustedTimeLeftInPhase": ESTADO["t"] * 7, "totalTimeInPhase": 30000},
            "localPlayerCellId": 0, "isCustomGame": False, "allowSkinSelection": True, "benchEnabled": False, "chatDetails": SALA,
            "myTeam": [jogador(0, 58, "Xerekton"), jogador(1, 64, "Fulano", "jungle", "HIDDEN")],
            "theirTeam": [{**jogador(5, 0, "Beltrano"), "championPickIntent": 122}],
            "actions": [[{"id": 1, "actorCellId": 0, "type": "pick", "completed": False, "isInProgress": True, "championId": 58}],
                        [{"id": 7, "actorCellId": 5, "type": "pick", "completed": False, "isInProgress": True, "championId": 122}]],
            "positionSwaps": [{"id": 11, "cellId": 1, "state": TROCA["estado"]}], "pickOrderSwaps": [{"id": 12, "cellId": 1, "state": "AVAILABLE"}],
            "trades": [{"id": 13, "cellId": 1, "state": "INVALID"}]},
        "/lol-champ-select/v1/summoners/0": {"slotId": 0, "cellId": 0, "isSelf": True, "gameName": "Xerekton", "puuid": "puuid-aaaa-bbbb",
                                             "showTrades": False, "showSwaps": False, "showPositionSwaps": False, "nameVisibilityType": "UNHIDDEN"},
        "/lol-champ-select/v1/summoners/1": lambda: {"slotId": 1, "cellId": 1, "isSelf": False, "gameName": "Fulano", "tagLine": "BR1",
                                                     "summonerId": 123456789, "obfuscatedPuuid": "x", "showTrades": True, "showSwaps": True,
                                                     "showPositionSwaps": True, "positionSwapId": 11, "positionSwapState": TROCA["estado"],
                                                     "tradeId": 13, "tradeState": "INVALID", "swapId": 12, "swapState": "AVAILABLE",
                                                     "nameVisibilityType": "HIDDEN", "championName": "Lee Sin"},
        "/lol-champ-select/v1/ongoing-position-swap": lambda: ({"id": 11, "initiatedByLocalPlayer": True, "requesterPosition": "TOP",
                                                                "responderPosition": "JUNGLE", "requestorIndex": 0, "responderIndex": 1}
                                                               if TROCA["estado"] == "SENT" else None),
        "/lol-champ-select/v1/ongoing-champion-swap": {"id": 13, "requesterChampionName": "Renekton", "responderChampionName": "Lee Sin", "responderIndex": 1},
        "/lol-champ-select/v1/skin-carousel-skins": [{"id": 58000, "name": "Renekton", "unlocked": True, "childSkins": []},
                                                     {"id": 58001, "name": "Renekton Galático", "unlocked": True, "childSkins": [{"id": 58010}, {"id": 58011}]},
                                                     {"id": 58002, "name": "Renekton Fora da Lei", "unlocked": False, "disabled": True}],
    },
    "InProgress": {},
    "EndOfGame": {
        "/lol-gameflow/v1/gameflow-metadata/player-status": {"lastQueuedLobbyStatus": {"queueId": 420, "isLeader": True,
                                                                                       "allowedPlayAgain": True, "memberSummonerIds": [123456789]}},
        "/lol-end-of-game/v1/eog-stats-block": {"gameId": 3300000001, "gameLength": 1800, "summonerName": "Xerekton", "queueType": "RANKED_SOLO_5x5",
                                                "localPlayer": {"summonerName": "Xerekton"}, "leaguePointsDelta": 18},
    },
}


def principal():
    sys.stdout.reconfigure(encoding="utf-8")
    casos = []

    def caso(nome, passou, detalhe=""):
        casos.append((nome, bool(passou)))
        print(("ok    " if passou else "FALHOU"), nome, "" if passou else detalhe)

    tmp = Path(tempfile.mkdtemp(prefix="medir-compacto-"))
    saida = tmp / "medicao.jsonl"
    relogio = {"t": 1000.0}
    prints = []
    lcu = LcuFalsa(ESTADO)
    m = mc.Medidor(saida, tmp / "prints", conectar=lambda: lcu, game_time=lambda: ESTADO["gt"],
                   printar=lambda png, perfil, url: (prints.append((Path(png).name, str(perfil), url)) or (True, None)),
                   painel_ok=lambda url: True, agora=lambda: relogio["t"], executar=lambda fn: fn(), log=lambda s: None)

    def rodar(fase, segundos, passo=0.5, antes=None):
        ESTADO["fase"] = fase
        fim = relogio["t"] + segundos
        while relogio["t"] < fim:
            if antes:
                antes()
            if m.passo() is None:
                return False
            relogio["t"] += passo
            ESTADO["t"] += passo
        return True

    rodar("Lobby", 5)
    rodar("Matchmaking", 25, 1.0)
    rodar("ReadyCheck", 3, 0.5, antes=lambda: ESTADO.__setitem__("rc", ESTADO["rc"] + 1))
    rodar("ChampSelect", 4)
    TROCA["estado"] = "SENT"
    rodar("ChampSelect", 3)
    TROCA["estado"] = "ACCEPTED"
    rodar("ChampSelect", 3)
    ESTADO["gt"] = None
    rodar("InProgress", 6, 2.0)                     # Live Client ainda recusa
    ESTADO["gt"] = 0.025
    rodar("InProgress", 20, 2.0)                    # tela de carregamento: gameTime parado (print aos 15 s)
    for gt in (0.5, 60, 181, 300, 481, 700, 901, 1000):
        ESTADO["gt"] = gt
        rodar("InProgress", 2, 2.0)
    ESTADO["gt"] = None
    rodar("WaitingForStats", 2)
    rodar("EndOfGame", 20, 1.0)
    rodar("Lobby", 10, 1.0)
    ESTADO["lp_pronto"] = True
    ESTADO["lp"] = 32
    rodar("Lobby", 20, 1.0)
    continua = rodar("Lobby", mc.POS_FIM_S + 10, 5.0)

    texto = saida.read_text(encoding="utf-8")
    linhas = [json.loads(ln) for ln in texto.splitlines()]
    evs = {}
    for ln in linhas:
        evs.setdefault(ln["ev"], []).append(ln)

    def dados(ev, i=0):
        return (evs.get(ev) or [{}])[i].get("dados") or {}

    caso("para sozinho 10 min depois do EndOfGame com a linha 'fim'", not continua and linhas[-1]["ev"] == "fim"
         and "EndOfGame" in linhas[-1]["dados"]["motivo"], linhas[-1])
    vazou = [s for s in SEGREDOS if s in texto]
    caso("nada de nome, puuid, summonerId, Riot ID, dado da sala do chat, nome de campeão do aliado nem texto de amigo",
         not vazou and len(VALORES_SALA) >= 2, vazou)
    fonte = (RAIZ / "tools" / "medir-compacto.py").read_text(encoding="utf-8")
    caso("só GET: o medidor não chama post/put/delete nem monta pedido com method", not any(p in fonte for p in (".post(", ".put(", ".delete(", "method=")))
    fases = [ln["fase"] for ln in evs.get("fase", [])]
    caso("fases gravadas na ordem", fases == ["Lobby", "Matchmaking", "ReadyCheck", "ChampSelect", "InProgress", "WaitingForStats", "EndOfGame", "Lobby"], fases)
    lb = dados("lobby")
    caso("lobby: isLeader, membros, penalidade (código e prazo), posições", lb.get("isLeader") is True and lb.get("membros") == 1
         and lb.get("restricoes") == ["QUEUE_DODGER"] and lb.get("restricaoTemPrazo") and lb.get("pos1") == "TOP", lb)
    cv = dados("convites")
    caso("convite recebido: estado e fila, sem quem convidou", cv.get("n") == 1 and cv["lista"][0].get("state") == "Pending"
         and cv["lista"][0]["gameConfig"]["queueId"] == 420 and "fromSummonerId" not in cv["lista"][0], cv)
    am = dados("amigos")
    caso("amigos: histograma de availability e gameStatus, idade do timeStamp", am.get("availability") == {"chat": 1, "dnd": 1, "offline": 1}
         and am.get("gameStatus") == {"inQueue": 1, "inGame": 1} and am.get("comTimeStamp") == 2, am)
    bs = evs.get("busca", [])
    caso("busca: searchState, tempo, estimativa e lowPriorityData; o relógio da fila não grava 1 linha por segundo",
         bs and bs[0]["dados"].get("searchState") == "Searching" and "lowPriorityData" in bs[0]["dados"]
         and "timeInQueue" in bs[0]["dados"] and 2 <= len(bs) <= 4, len(bs))
    rc = evs.get("readycheck", [])
    caso("ready check: estado e resposta a cada mudança do timer", len(rc) >= 3 and rc[0]["dados"]["playerResponse"] == "None", len(rc))
    tr = [ln["dados"]["posicao"][0]["state"] for ln in evs.get("trocas", [])]
    caso("trocas: estado × momento (AVAILABLE -> SENT -> ACCEPTED), uma linha por mudança", tr == ["AVAILABLE", "SENT", "ACCEPTED"], tr)
    caso("trocas: a linha leva a fase do timer", all(ln["dados"].get("timerPhase") == "BAN_PICK" for ln in evs.get("trocas", [])))
    j1 = [ln["dados"] for ln in evs.get("jogador_cs_1", [])]
    caso("summoners/1: botões e estados da Riot (showTrades, positionSwapState...) a cada mudança, nome só como bool",
         len(j1) == 3 and j1[0]["showPositionSwaps"] is True and [d["positionSwapState"] for d in j1] == ["AVAILABLE", "SENT", "ACCEPTED"]
         and j1[0]["temNome"] is True and j1[0]["nameVisibilityType"] == "HIDDEN" and "championName" not in j1[0], j1[:1])
    og = [ln["dados"] for ln in evs.get("troca_em_curso_posicao", [])]
    caso("troca em curso: 404 vira null e o pedido aparece com posições e índices", len(og) >= 2 and og[0] is None and og[1]
         and og[1]["requesterPosition"] == "TOP" and og[1]["initiatedByLocalPlayer"] is True, og)
    oc = dados("troca_em_curso_campeao")
    caso("troca de campeão em curso: sem o nome dos campeões (só id e índice)", oc.get("id") == 13 and "requesterChampionName" not in oc, oc)
    sk = dados("skins")
    caso("skin-carousel dentro da seleção: contagens (3, 2 desbloqueadas, 2 chromas, 1 desabilitada)", sk.get("n") == 3 and sk.get("desbloqueadas") == 2
         and sk.get("chromas") == 2 and sk.get("desabilitadas") == 1 and "name" not in sk.get("campos", []), sk)
    se = dados("sessao_cs")
    caso("sessão: inimigo sem hover (championPickIntent) e ação dele sem campeão antes de completar",
         se and "championPickIntent" not in se["inimigos"][0] and all(a["championId"] is None for a in se["acoes"]), se.get("inimigos"))
    caso("sessão: nameVisibilityType e temNome por jogador do meu time", se and [p["nameVisibilityType"] for p in se["meuTime"]] == ["UNHIDDEN", "HIDDEN"]
         and all(p["temNome"] for p in se["meuTime"]))
    caso("sessão: o timer que anda não gera linha nova (só as 3 mudanças de troca)", len(evs.get("sessao_cs", [])) == 3, len(evs.get("sessao_cs", [])))
    gf = [ln["dados"] for ln in evs.get("gameflow", [])]
    caso("gameflow: fila, mapa e personalizada", gf and gf[0] == {"queueId": 420, "mapId": 11, "isCustomGame": False, "gameMode": "CLASSIC"}, gf)
    marcos = [p[0].rsplit("-", 1)[1] for p in prints]
    caso("prints: carregamento, 03min, 08min e 15min, uma vez cada", marcos == ["carregamento.png", "03min.png", "08min.png", "15min.png"], marcos)
    caso("prints: nome com o gameId; perfil do Edge em pasta própria; URL do painel", all("3300000001" in p[0] for p in prints)
         and all(p[1].endswith(".edge-headless") for p in prints) and all(p[2] == mc.PAINEL for p in prints))
    pr = [ln["dados"] for ln in evs.get("print", [])]
    caso("prints: cada marco vira uma linha 'print' com ok e gameTime", len(pr) == 4 and all(d["ok"] for d in pr) and pr[1]["gameTime"] == 181, pr)
    pa = dados("partida")
    caso("partida: início real pela gameTime e duração do carregamento", pa.get("gameTime") == 0.5 and pa.get("carregamentoS", 0) > 20, pa)
    lp = evs.get("lp_notificacao", [])
    caso("PDL: notificação com o tempo desde o EndOfGame (null até chegar, depois +18, já no Lobby)", lp and lp[0]["dados"] is None
         and lp[-1]["dados"]["leaguePointsDelta"] == 18 and lp[-1]["desdeFimS"] > 25 and lp[-1]["fase"] == "Lobby",
         [(x["dados"], x.get("desdeFimS"), x["fase"]) for x in lp])
    ra, rd = evs.get("ranked_antes", []), evs.get("ranked_depois", [])
    caso("PDL: ranked antes (14) e depois (32) da partida", ra and ra[0]["dados"]["RANKED_SOLO_5x5"]["leaguePoints"] == 14
         and rd and rd[-1]["dados"]["RANKED_SOLO_5x5"]["leaguePoints"] == 32 and rd[-1]["desdeFimS"] is not None, (ra, rd[-1:]))
    jd = dados("jogar_de_novo")
    caso("jogar de novo: isLeader e allowedPlayAgain, sem memberSummonerIds", jd.get("lastQueuedLobbyStatus", {}).get("isLeader") is True
         and "memberSummonerIds" not in jd["lastQueuedLobbyStatus"], jd)
    eog = dados("eog")
    caso("eog: só escalares sem identidade (leaguePointsDelta, gameLength)", eog.get("leaguePointsDelta") == 18 and "summonerName" not in eog
         and "localPlayer" not in eog, eog)

    # client fechado: para sozinho
    m2 = mc.Medidor(tmp / "m2.jsonl", tmp / "prints", conectar=lambda: None, game_time=lambda: None, agora=lambda: relogio["t"],
                    executar=lambda fn: fn(), log=lambda s: None)
    m2.visto_client, m2.fase = relogio["t"], "Lobby"
    r1 = m2.passo()
    relogio["t"] += mc.SEM_CLIENT_S + 1
    r2 = m2.passo()
    caso("client fechou: espera 60 s e grava o fim", r1 == 2.0 and r2 is None and "client fechado" in (tmp / "m2.jsonl").read_text(encoding="utf-8"))

    # painel fora do ar: não chama o Edge, registra o motivo
    chamados = []
    m3 = mc.Medidor(tmp / "m3.jsonl", tmp / "prints", conectar=lambda: lcu, game_time=lambda: 200.0, printar=lambda *a: chamados.append(a) or (True, None),
                    painel_ok=lambda url: False, agora=lambda: relogio["t"], executar=lambda fn: fn(), log=lambda s: None)
    ESTADO["fase"] = "InProgress"
    m3.passo()
    caso("painel fora do ar: sem Edge, linha 'print' com o motivo", not chamados and "painel fora do ar" in (tmp / "m3.jsonl").read_text(encoding="utf-8"))

    # comando do Edge: headless, sem --app, perfil próprio, sem janela
    cmd = mc.comando_print(Path("msedge.exe"), tmp / "x.png", tmp / "perfil")
    caso("Edge: --headless=new --screenshot no painel, perfil próprio, nunca --app",
         "--headless=new" in cmd and any(c.startswith("--screenshot=") for c in cmd) and cmd[-1] == mc.PAINEL
         and any(c.startswith("--user-data-dir=") for c in cmd) and not any(c.startswith("--app") for c in cmd))
    visto = {}
    mc.achar_edge = lambda: Path("msedge.exe")
    ok, _ = mc.print_painel(tmp / "nao-existe.png", tmp / "perfil",
                            rodar=lambda cmd, **kw: visto.update(kw) or type("R", (), {"returncode": 0})())
    caso("Edge: sem janela (CREATE_NO_WINDOW) e com timeout; arquivo que não saiu = falha", visto.get("creationflags") == mc.NAO_JANELA
         and visto.get("timeout") == 60 and ok is False)

    s = mc.so_sinais({"state": "SENT", "gameName": "Fulano", "x": "texto com espaço", "phase": "BAN_PICK", "nested": [{"puuid": "p", "id": 3}],
                      "searchState": "Searching", "nameVisibilityType": "HIDDEN", "playerResponse": "Accepted"})
    caso("so_sinais: enum fica, nome some, texto livre vira <texto>", s == {"state": "SENT", "x": "<texto>", "phase": "BAN_PICK",
         "nested": [{"id": 3}], "searchState": "Searching", "nameVisibilityType": "HIDDEN", "playerResponse": "Accepted"}, s)

    ok = sum(p for _, p in casos)
    print(f"{ok}/{len(casos)} ok")
    return 0 if ok == len(casos) else 1


if __name__ == "__main__":
    sys.exit(principal())
