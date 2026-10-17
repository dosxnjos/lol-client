# prova da D2 de 17/10/2026 (roadmap/2026-10-17-telas-que-expandem.md, etapa 7): partida assistida (ele clicou em "Assistir"
# num amigo) não liga coach, voz, painel, overlay, medidor de travadas nem grava ao_vivo/eventos_ao_vivo, e nada vira partida
# dele. Sem client, sem rede, banco em pasta temporária (nunca dados/lol.db), nenhuma porta aberta, nenhuma janela.
#   1. Coletor real com LCU falsa (só GET) reconstruindo 16/10/2026 20:45:30–20:51:41 (medidor + coletor.log): 3 seleções
#      assistidas (None -> ChampSelect, isSpectating, localPlayerCellId -1, GAME_STARTING) e a ARAM Mayhem 3293888206 até o fim
#      (GameStart -> InProgress -> WaitingForStats -> None). Controle: ranqueada dele (ReadyCheck -> ChampSelect, cellId 4)
#   2. Coach com assistida=True: nada liga, painel fechado; Reconnect/InProgress repetido da mesma partida também não
#   3. Reserva da Live Client (coletor religado no meio da partida assistida, seleção não vista): 5 leituras em jogo sem o
#      jogador ativo desligam tudo e não gravam previsões; controle: partida dele (activePlayer casa) e carregamento seguem
#   4. AoVivo: nada vai para ao_vivo/eventos_ao_vivo sem o jogador ativo; com ele, grava como antes
# uso: python tools/teste-assistida.py
import asyncio
import json
import logging
import sqlite3
import sys
import tempfile
import threading
import time
import types
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import ao_vivo  # noqa: E402
import banco  # noqa: E402
import coach_vivo  # noqa: E402
import coletor  # noqa: E402

resultados = []
GID = 3293888206
# tolerantes ao código de antes da D2 (o teste falha com FALHOU em vez de quebrar): prova de que falhava antes
SEM_EU = getattr(coach_vivo, "SEM_EU_LEITURAS", 5)
assistidas = lambda c: getattr(c, "assistidas", set())  # noqa: E731
marcada = lambda p: bool(getattr(p, "assistida", False))  # noqa: E731


def caso(nome, ok, detalhe=""):
    resultados.append(bool(ok))
    print(f"{'ok' if ok else 'FALHOU'}  {nome}" + (f"  ({detalhe})" if detalhe and not ok else ""))


# ---------- peças falsas ----------
class LCUFalsa:
    """só GET; qualquer outra coisa quebra o teste"""
    porta = "0"

    def __init__(self):
        self.fila, self.mapa, self.gid = None, None, None

    def get(self, caminho, timeout=30):
        if caminho == "/lol-gameflow/v1/session":
            return {"gameData": {"gameId": self.gid or 0, "queue": {"id": self.fila or 0, "mapId": self.mapa or 0}},
                    "map": {"id": self.mapa or 0}}
        if caminho in ("/lol-ranked/v1/current-ranked-stats", "/lol-lobby/v2/lobby", "/lol-perks/v1/currentpage"):
            return {}
        raise AssertionError(f"GET inesperado: {caminho}")


class CoachFalso:
    """anota cada chamada do Coletor; sem srv (nada de rota, nenhuma porta)"""

    def __init__(self):
        self.fases, self.selecoes, self.fim_cs, self.proprias = [], 0, 0, []

    async def fase(self, fase, game_id=None, fila=None, lcu=None, **kw):
        self.fases.append((fase, game_id, bool(kw.get("assistida"))))
        self.proprias.append((fase, game_id, bool(kw.get("propria"))))

    def champ_select(self, s):
        self.selecoes += 1

    def fim_champ_select(self):
        self.fim_cs += 1


class AvisoFalso:
    def mostrar(self):
        pass

    def fechar(self):
        pass


def travadas_falso():
    """o coletor importa travadas dentro de fase(): a versão falsa anota em vez de lançar processo"""
    m = types.ModuleType("travadas")
    m.chamadas = []
    m.iniciar = lambda partida=None, db=None, **k: m.chamadas.append(partida)
    return m


def sessao_cs(espectador, cell, fase_timer, total=None):
    t = {"phase": fase_timer}
    if total:
        t["totalTimeInPhase"] = total
    return {"isSpectating": espectador, "localPlayerCellId": cell, "isCustomGame": espectador, "benchEnabled": False,
            "timer": t, "myTeam": [{"cellId": c, "championId": 40 + c} for c in range(5)],
            "theirTeam": [{"cellId": 5 + c, "championId": 60 + c} for c in range(5)], "actions": [], "gameId": 0}


async def rodar_coletor(passos, db):
    mod = travadas_falso()
    sys.modules["travadas"] = mod
    args = types.SimpleNamespace(ocioso_min=10, db=str(db), lockfile=None, config=None)
    co = CoachFalso()
    col = coletor.Coletor(args, coach=co, fab_aviso=lambda *a, **k: AvisoFalso())
    col.lcu = LCUFalsa()
    ligados, buscas = [], []
    real_ligar = banco.ligar_game_id
    banco.ligar_game_id = lambda c, chave, gid: ligados.append((chave, gid))
    col.buscar_partida = lambda gid: buscas.append(gid)
    try:
        for p in passos:
            if p[0] == "fase":
                _, fase, fila, mapa, gid = p
                col.lcu.fila, col.lcu.mapa, col.lcu.gid = fila, mapa, gid
                await col.fase(fase)
            else:
                await col.evento("OnJsonApiEvent", {"uri": "/lol-champ-select/v1/session", "eventType": "Update", "data": p[1]})
    finally:
        banco.ligar_game_id = real_ligar
        sys.modules.pop("travadas", None)
    cs = col.c.execute("select count(*) from champ_select").fetchone()[0]
    col.c.close()
    return {"coach": co, "travadas": mod.chamadas, "ligados": ligados, "buscas": buscas, "champ_select": cs,
            "fila_atual": col.fila_atual, "assistindo": getattr(col, "assistindo", None)}


def caso_coletor():
    """1. reconstrução de 16/10/2026 20:45–20:51 pelo Coletor real"""
    assist = lambda total: sessao_cs(True, -1, "GAME_STARTING", total)  # noqa: E731
    passos = [
        ("fase", "Lobby", 420, 11, None), ("fase", "None", None, None, None),           # 20:45:30 (vinha do lobby dele)
        ("fase", "ChampSelect", 2400, 12, None), ("sessao", assist(75000)),              # 20:45:34 ARAM Mayhem assistida
        ("fase", "None", None, None, None),                                              # 20:46:49
        ("fase", "ChampSelect", 420, 11, None), ("sessao", assist(170000)),              # 20:48:19 ranqueada de um amigo
        ("fase", "None", None, None, None),                                              # 20:48:23
        ("fase", "ChampSelect", 2400, 12, None), ("sessao", assist(89000)),              # 20:48:28
        ("fase", "GameStart", 2400, 12, GID), ("fase", "InProgress", 2400, 12, GID),    # 20:50:00
        ("sessao", {**assist(89000), "isSpectating": False}),                            # Update atrasado: não muda nada
        ("fase", "WaitingForStats", 2400, 12, GID), ("fase", "None", None, None, None),  # 20:51:39–41
    ]
    with tempfile.TemporaryDirectory() as tmp:
        r = asyncio.run(rodar_coletor(passos, Path(tmp) / "lol.db"))
    jogo = [f for f in r["coach"].fases if f[0] in coletor.FASES_JOGO]
    caso("16/10 20:50 (3293888206, ARAM Mayhem assistida): medidor de travadas não liga",
         not r["travadas"], f"travadas {r['travadas']}")
    caso("16/10 20:50: GameStart/InProgress/WaitingForStats chegam ao coach como assistida (nada de coach, voz, painel, overlay)",
         len(jogo) == 3 and all(a for _, _, a in jogo), f"{r['coach'].fases}")
    caso("16/10: nada vira partida dele (sem game_id ligado a retrato, sem busca no histórico, sem retrato, sem draft do coach)",
         not r["ligados"] and not r["buscas"] and r["champ_select"] == 0 and r["coach"].selecoes == 0,
         f"ligados {r['ligados']} buscas {r['buscas']} cs {r['champ_select']} draft {r['coach'].selecoes}")
    caso("16/10: a fase None zera o espectador (volta a 'não sei': a próxima seleção diz de quem é)", r["assistindo"] is None,
         f"assistindo {r['assistindo']}")
    caso("16/10: a partida assistida nunca chega ao coach como sabida dele",
         not any(pr for f, _, pr in r["coach"].proprias if f in coletor.FASES_JOGO), f"{r['coach'].proprias}")

    # controle: a ranqueada dele (15/10 13:50, cellId 4, PLANNING) liga tudo como antes, mesmo logo depois de uma assistida
    propria = sessao_cs(False, 4, "PLANNING")
    passos2 = passos + [
        ("fase", "Lobby", 420, 11, None), ("fase", "Matchmaking", 420, 11, None), ("fase", "ReadyCheck", 420, 11, None),
        ("fase", "ChampSelect", 420, 11, 3293436866), ("sessao", propria),
        ("fase", "GameStart", 420, 11, 3293436866), ("fase", "InProgress", 420, 11, 3293436866),
    ]
    with tempfile.TemporaryDirectory() as tmp:
        r2 = asyncio.run(rodar_coletor(passos2, Path(tmp) / "lol.db"))
    dele = [f for f in r2["coach"].fases if f[1] == 3293436866 and f[0] in coletor.FASES_JOGO]
    caso("controle: ranqueada dele depois da assistida liga medidor e coach (assistida False) e o draft do coach",
         r2["travadas"] == [3293436866] and len(dele) == 2 and not any(a for _, _, a in dele) and r2["coach"].selecoes == 1,
         f"travadas {r2['travadas']} fases {dele} draft {r2['coach'].selecoes}")

    # revisão adversarial de 17/10: a reserva da Live Client (sem jogador ativo) nunca pode calar partida que o coletor sabe que
    # é dele. O coletor diz "é dele" ao coach (propria=True) na ranqueada, na personalizada, no TFT (busca/ready check sem
    # seleção) e no Reconnect da mesma partida depois de um None (client reaberto); só o coletor religado no meio não sabe
    def proprias_de(r, gid):
        return [pr for f, g, pr in r["coach"].proprias if g == gid and f in coletor.FASES_JOGO]
    caso("revisão: ranqueada dele (ReadyCheck -> seleção isSpectating false) chega ao coach como sabida dele (reserva desarmada)",
         proprias_de(r2, 3293436866) == [True, True], f"{r2['coach'].proprias[-3:]}")
    pers = [("fase", "Lobby", 3100, 11, None), ("fase", "ChampSelect", 3100, 11, None), ("sessao", sessao_cs(False, 0, "PLANNING")),
            ("fase", "GameStart", 3100, 11, 3293500001), ("fase", "InProgress", 3100, 11, 3293500001)]
    tft = [("fase", "Lobby", 1100, 22, None), ("fase", "Matchmaking", 1100, 22, None), ("fase", "ReadyCheck", 1100, 22, None),
           ("fase", "GameStart", 1100, 22, 3293500002), ("fase", "InProgress", 1100, 22, 3293500002)]
    reconn = passos2 + [("fase", "None", None, None, None), ("fase", "Reconnect", 420, 11, 3293436866),
                        ("fase", "InProgress", 420, 11, 3293436866)]
    religado = [("fase", "InProgress", 420, 11, 3293500003)]
    with tempfile.TemporaryDirectory() as tmp:
        rp = asyncio.run(rodar_coletor(pers, Path(tmp) / "a.db"))
        rt = asyncio.run(rodar_coletor(tft, Path(tmp) / "b.db"))
        rr = asyncio.run(rodar_coletor(reconn, Path(tmp) / "c.db"))
        rg = asyncio.run(rodar_coletor(religado, Path(tmp) / "d.db"))
    caso("revisão: personalizada dele (Lobby -> seleção isSpectating false) e TFT (ready check sem seleção) também",
         proprias_de(rp, 3293500001) == [True, True] and proprias_de(rt, 3293500002) == [True, True],
         f"pers {rp['coach'].proprias} tft {rt['coach'].proprias}")
    caso("revisão: Reconnect da ranqueada depois de um None (client reaberto) segue sabida dele",
         proprias_de(rr, 3293436866) == [True, True, True, True], f"{rr['coach'].proprias[-4:]}")
    caso("revisão: coletor religado no meio da partida (seleção não vista): não sabe, a reserva fica armada",
         proprias_de(rg, 3293500003) == [False] and rg["travadas"] == [3293500003], f"{rg['coach'].proprias}")


# ---------- coach de verdade com peças falsas ----------
class Peca:
    ligado = True
    ao_mostrar = ao_desenhar = ao_alternar = _thread = None

    def __init__(self, *a, **k):
        pass

    def __getattr__(self, nome):
        return lambda *a, **k: None


class Janela:
    def __init__(self):
        self.fases, self.fechou = [], 0

    def fase(self, f):
        self.fases.append(f)

    def fechar(self):
        self.fechou += 1


def sem(*a):
    raise RuntimeError("fora do teste")


def novo_coach(tmp):
    arq = Path(tmp) / "config.json"
    arq.write_text(json.dumps({"voz": False, "minimapa": False, "feiticos": False, "carregamento": False, "mentor": False,
                               "amostrasAoVivo": False, "painelAoVivo": False}), encoding="utf-8")
    jan = Janela()
    fab = {"voz": Peca, "moldura": Peca, "overlay": Peca, "estatico": sem, "mentor": sem, "captura": sem,
           "janela": lambda url, ligado: jan}
    c = coach_vivo.Coach(db=Path(tmp) / "lol.db", config=arq, liveclient="http://127.0.0.1:9", fabricas=fab)
    return c, jan


def amostra(gt, ativo, eventos=True):
    """allgamedata mínimo: ativo = Riot ID do jogador ativo (None = sem jogador ativo, como na partida assistida)"""
    return {"activePlayer": ({"riotId": ativo, "currentGold": 500} if ativo else {}),
            "gameData": {"gameTime": gt},
            "events": {"Events": [{"EventID": 0, "EventName": "GameStart", "EventTime": 0.0}] if eventos else []},
            "allPlayers": [
                {"championName": "Ahri", "team": "ORDER", "position": "", "riotId": "Eu#BR1", "level": 9, "items": [],
                 "scores": {"creepScore": 80}},
                {"championName": "Lux", "team": "CHAOS", "position": "", "riotId": "Ele#BR1", "level": 9, "items": [],
                 "scores": {"creepScore": 70}}]}


def esperar(cond, s=5.0):
    fim = time.monotonic() + s
    while time.monotonic() < fim:
        if cond():
            return True
        time.sleep(0.02)
    return cond()


def caso_coach():
    """2. assistida=True pelo Coletor; 3. reserva da Live Client"""
    log_coach = logging.getLogger("coletor.coach")
    log_coach.propagate = False
    linhas = []

    class Coleta(logging.Handler):
        def emit(self, r):
            linhas.append(r.getMessage())
    h = Coleta()
    log_coach.addHandler(h)
    nivel = log_coach.level
    log_coach.setLevel(logging.INFO)
    try:
        with tempfile.TemporaryDirectory() as tmp:
            c, jan = novo_coach(tmp)
            erro = None
            try:
                for f in ("GameStart", "InProgress", "Reconnect", "InProgress"):
                    asyncio.run(c.fase(f, GID, 2400, None, assistida=(f != "Reconnect")))
            except TypeError as e:   # código de antes da D2: Coach.fase sem assistida
                erro = e
            caso("coach com assistida: partida nunca liga, painel nunca abre (fechado), Reconnect da mesma partida também não",
                 erro is None and c.partida is None and not c.av.ativo() and "InProgress" not in jan.fases and "Reconnect" not in jan.fases
                 and jan.fechou >= 3 and GID in assistidas(c), f"erro {erro} partida {c.partida} jan {jan.fases} fechou {jan.fechou}")
            c.encerrar_partida()

        # reserva: coletor religado no meio da partida assistida (3292972402, 13/10 22:06, entrou aos 241 s de jogo)
        with tempfile.TemporaryDirectory() as tmp:
            c, jan = novo_coach(tmp)
            p = c.iniciar_partida(3292972402, 420)
            p.previsoes = [{"gt": 250.0, "campeao": "Lux", "x": 1, "y": 1, "visto_ha": 0, "zona": "z", "p": 0.5}]
            ep = ao_vivo.EstadoPartida()
            estados = []
            for i in range(SEM_EU):
                b = amostra(241.3 + i, None)
                est = ep.atualizar(b)
                antes = c.partida
                c._ao_ler(b, b, est)
                estados.append((est["fase"], est["eu"], antes is p))
            desligou = esperar(lambda: c.partida is None and not c.av.ativo() and jan.fechou >= 1)
            db = Path(tmp) / "lol.db"
            n_prev = 0
            if db.exists():
                cc = sqlite3.connect(db)
                try:
                    n_prev = cc.execute("select count(*) from previsoes_jungler").fetchone()[0]
                except sqlite3.Error:
                    n_prev = 0
                cc.close()
            caso(f"reserva (3292972402, coletor sem a seleção): {SEM_EU} leituras em jogo sem o jogador "
                 "ativo desligam coach e painel e não gravam as previsões do jungler",
                 desligou and marcada(p) and 3292972402 in assistidas(c) and jan.fechou >= 1 and n_prev == 0
                 and all(f == "jogo" and e is None for f, e, _ in estados),
                 f"desligou {desligou} estados {estados} prev {n_prev}")
            asyncio.run(c.fase("InProgress", 3292972402, 420, None))
            caso("reserva: InProgress/Reconnect seguinte da mesma partida não religa nada nem abre o painel",
                 c.partida is None and c.iniciar_partida(3292972402, 420) is None and "InProgress" not in jan.fases,
                 f"jan {jan.fases}")
            caso("reserva: o log diz por que desligou", any("partida assistida" in x for x in linhas), f"{linhas[-3:]}")

        # controles: a partida dele (activePlayer casa) e o carregamento (gameTime ~0, sem GameStart) nunca disparam
        with tempfile.TemporaryDirectory() as tmp:
            c, jan = novo_coach(tmp)
            p = c.iniciar_partida(3293149183, 420)
            ep = ao_vivo.EstadoPartida()
            for i in range(10):    # carregamento: gameTime parado em ~0,025 e sem eventos
                b = amostra(0.025, None, eventos=False)
                c._ao_ler(b, b, ep.atualizar(b))
            no_carregamento = c.partida is p and not marcada(p)
            ep = ao_vivo.EstadoPartida()
            for i in range(10):    # 3293149183: coletor religado aos 80 s de jogo, o jogador ativo casa
                b = amostra(80.3 + i, "Eu#BR1")
                c._ao_ler(b, b, ep.atualizar(b))
            time.sleep(0.1)
            caso("controle: carregamento sem jogador ativo e partida dele (activePlayer casa) seguem ligados",
                 no_carregamento and c.partida is p and not marcada(p) and 3293149183 not in assistidas(c),
                 f"carregamento {no_carregamento} partida {c.partida is p}")
            c.encerrar_partida()

        # revisão adversarial de 17/10: partida sabida dele (propria=True do Coletor) nunca é calada pela reserva, mesmo com a
        # Live Client sem o jogador ativo (ex.: um patch muda o formato do activePlayer). Antes: 5 leituras calavam a ranqueada
        def sem_eu_por(c, n, gt0=300.0):
            ep = ao_vivo.EstadoPartida()
            for i in range(n):
                b = amostra(gt0 + i, None)
                c._ao_ler(b, b, ep.atualizar(b))
            time.sleep(0.2)   # o desligar da reserva roda em outra thread
        with tempfile.TemporaryDirectory() as tmp:
            c, jan = novo_coach(tmp)
            erro = None
            try:
                asyncio.run(c.fase("InProgress", 3293436866, 420, None, propria=True))
            except TypeError as e:   # código de antes da revisão: Coach.fase sem propria
                erro = e
                c.iniciar_partida(3293436866, 420)
            p = c.partida
            sem_eu_por(c, 3 * SEM_EU)
            caso(f"revisão: ranqueada sabida dele com {3 * SEM_EU} leituras sem o jogador ativo segue ligada (coach, voz, painel)",
                 erro is None and p is not None and c.partida is p and not marcada(p) and 3293436866 not in assistidas(c)
                 and c.av.ativo(), f"erro {erro} partida {c.partida is p} marcada {marcada(p)}")
            c.encerrar_partida()
        with tempfile.TemporaryDirectory() as tmp:
            c, jan = novo_coach(tmp)
            p = c.iniciar_partida(3293436866, 420)   # coletor religado no meio: não sabe
            erro = None
            try:   # o Reconnect seguinte chega do Coletor como sabida dele (gameId conhecido): a mesma partida desarma a reserva
                asyncio.run(c.fase("Reconnect", 3293436866, 420, None, propria=True))
            except TypeError as e:
                erro = e
            sem_eu_por(c, 3 * SEM_EU)
            caso("revisão: Reconnect sabido dele desarma a reserva na partida que já estava ligada",
                 erro is None and c.partida is p and not marcada(p) and getattr(c.av, "exigir_eu", True) is False,
                 f"erro {erro} partida {c.partida is p} marcada {marcada(p)}")
            c.encerrar_partida()
    finally:
        log_coach.removeHandler(h)
        log_coach.setLevel(nivel)
        log_coach.propagate = True


class LiveFalsa:
    def __init__(self, amostras):
        self.amostras, self.i = amostras, 0

    def allgamedata(self, timeout=2):
        if self.i >= len(self.amostras):
            return None
        a = self.amostras[self.i]
        self.i += 1
        return a


def gravar_com(amostras, db, gid, **kw):
    av = ao_vivo.AoVivo(liveclient="http://127.0.0.1:9", db=str(db), catalogo={}, padrao=lambda est: None,
                        avisador=lambda est: None, intervalo=0.005)
    av.cliente = LiveFalsa(amostras)
    av.iniciar(gid, 420, gravar=True, **kw)
    esperar(lambda: av.cliente.i >= len(amostras))
    time.sleep(0.05)
    av.parar()
    c = sqlite3.connect(db)
    try:
        return (c.execute("select count(*) from ao_vivo where game_id=?", (gid,)).fetchone()[0],
                c.execute("select count(*) from eventos_ao_vivo where game_id=?", (gid,)).fetchone()[0])
    finally:
        c.close()


def caso_ao_vivo():
    """4. o laço ao vivo não grava partida sem o jogador ativo (reserva também da gravação)"""
    log_av = logging.getLogger("coletor.ao_vivo")
    nivel = log_av.level
    log_av.setLevel(logging.WARNING)
    try:
        def com_eventos(gt, ativo):
            b = amostra(gt, ativo)
            b["events"]["Events"].append({"EventID": 1, "EventName": "TurretKilled", "EventTime": 60.0,
                                          "KillerName": "Minion_T100L1S34N0211", "TurretKilled": "Turret_TChaos_L1_P3"})
            return b
        with tempfile.TemporaryDirectory() as tmp:
            n = gravar_com([com_eventos(gt, None) for gt in (0.1, 10.2, 20.3, 30.4)], Path(tmp) / "lol.db", GID)
        caso("ao vivo: partida assistida (sem jogador ativo, como as 9 amostras da 3293888206) não grava ao_vivo nem eventos_ao_vivo",
             n == (0, 0), f"{n}")
        with tempfile.TemporaryDirectory() as tmp:
            n2 = gravar_com([com_eventos(gt, "Eu#BR1") for gt in (0.1, 10.2, 20.3, 30.4)], Path(tmp) / "lol.db", 3293746098)
        caso("ao vivo, controle: partida dele grava como antes (amostras e eventos)", n2[0] > 0 and n2[1] == 2, f"{n2}")
        # revisão adversarial de 17/10: partida sabida dele (exigir_eu=False) grava mesmo sem o jogador ativo na Live Client
        try:
            with tempfile.TemporaryDirectory() as tmp:
                n3 = gravar_com([com_eventos(gt, None) for gt in (0.1, 10.2, 20.3, 30.4)], Path(tmp) / "lol.db", 3293746099,
                                exigir_eu=False)
        except TypeError as e:   # código de antes da revisão: iniciar sem exigir_eu
            n3 = repr(e)
        caso("revisão: ao vivo da partida sabida dele grava mesmo sem o jogador ativo (nada some se o formato mudar)",
             isinstance(n3, tuple) and n3[0] > 0 and n3[1] == 2, f"{n3}")
    finally:
        log_av.setLevel(nivel)


def principal():
    caso_coletor()
    caso_coach()
    caso_ao_vivo()
    print(f"{sum(resultados)}/{len(resultados)} ok")
    return 0 if all(resultados) else 1


if __name__ == "__main__":
    sys.exit(principal())
