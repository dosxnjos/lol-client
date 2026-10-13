# prova do passo 18 (plano v2), parte de dados: coletor/carregamento.py com uma Riot API falsa.
# 10 jogadores sintéticos, cada um montado para uma tag (streak, fora da rota, OTP, primeira vez,
# pouca experiência, KDA bom, perde a rota, agressivo, morre cedo), 1 oculto (sem puuid) e 2 premades
# com partidas em comum -> todas as tags certas; chamadas por partida <= orçamento (contador no log);
# o oculto não gera chamada; o estado público não tem puuid. E o gatilho na gravação real.
# uso: python tools/teste-tags.py
import io
import json
import logging
import sys
import urllib.error
import urllib.parse
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import banco  # noqa: E402
import carregamento  # noqa: E402
import riotapi  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
GRAVACAO = RAIZ / "temp" / "gravacao" / "20261013-071040" / "live.jsonl"
ESPECTADOR = [False]

# (puuid, time, campeão, rota da partida, maestria no campeão (None = 404), top de maestria,
#  partidas: lista de (campeão, rota, vitória, k, d, a, rota_ganha, solo_kills), mortes antes dos 10 por partida,
#  tags esperadas)
R = ("TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY")
P = lambda c, r, v, k=2, d=4, a=5, rg=None, sk=None: (c, r, v, k, d, a, rg, sk)  # noqa: E731
MUNDO = [
    ("p0", 100, 58, "TOP", 90000, [(58, 90000), (154, 60000)],
     [P(58, "TOP", True), P(154, "JUNGLE", False), P(58, "TOP", True), P(154, "JUNGLE", False), P(58, "TOP", True)],
     None, set()),
    ("p1", 100, 154, "JUNGLE", 50000, [(154, 50000), (64, 40000)],
     [P(154, "JUNGLE", False)] * 3 + [P(64, "JUNGLE", True), P(64, "JUNGLE", True)], None, {"derrotas_seguidas"}),
    ("p2", 100, 1, "MIDDLE", 30000, [(1, 30000), (103, 25000)],
     [P(1, "BOTTOM", True), P(103, "BOTTOM", False), P(103, "BOTTOM", True), P(1, "UTILITY", False), P(1, "MIDDLE", True)],
     None, {"fora_da_rota"}),
    ("p3", 100, 222, "BOTTOM", 300000, [(222, 300000), (51, 40000)],
     None, None, {"otp"}),  # premade com p4: partidas em comum (montadas abaixo)
    ("p4", 100, 53, "UTILITY", 50000, [(412, 60000), (53, 50000)], None, None, set()),
    ("p5", 200, 122, "TOP", None, [(266, 80000), (86, 70000)],
     [P(266, "TOP", True), P(86, "TOP", False), P(266, "TOP", True), P(86, "TOP", False), P(266, "TOP", True)],
     [2, 1, 2, 2, 1], {"primeira_vez", "morre_cedo"}),
    ("p6", 200, 64, "JUNGLE", 70000, [(64, 70000), (254, 60000)],
     [P(64, "JUNGLE", True, rg=1, sk=3), P(64, "JUNGLE", False, rg=0, sk=2), P(254, "JUNGLE", True, rg=1, sk=4),
      P(64, "JUNGLE", False, rg=0, sk=3), P(254, "JUNGLE", True, rg=0, sk=1)], [0, 1, 0, 0, 1], {"domina_rota", "agressivo"}),
    ("p7", 200, 103, "MIDDLE", 45000, [(103, 45000), (7, 30000)],
     [P(103, "MIDDLE", True, 8, 2, 6), P(103, "MIDDLE", True, 6, 3, 9), P(7, "MIDDLE", True), P(103, "MIDDLE", True, 9, 1, 4),
      P(7, "MIDDLE", False)], None, {"vitorias_seguidas", "kda_bom"}),
    (None, 200, 51, "BOTTOM", None, [], [], None, set()),  # oculto (modo streamer)
    ("p9", 200, 267, "UTILITY", 3000, [(40, 50000), (267, 3000)],
     [P(40, "UTILITY", True), P(40, "UTILITY", False), P(267, "UTILITY", True), P(40, "UTILITY", False)], None,
     {"pouca_experiencia"}),
]


def montar():
    partidas, ids, timelines = {}, {}, {}
    n = [0]

    def partida(jogadores):  # jogadores: [(puuid, campeão, rota, vitória, k, d, a, rg, sk)]
        n[0] += 1
        mid = f"BR1_{9000 + n[0]}"
        parts = []
        for i, (pu, c, r, v, k, d, a, rg, sk) in enumerate(jogadores, start=1):
            parts.append({"puuid": pu, "participantId": i, "championId": c, "teamPosition": r, "win": v, "kills": k,
                          "deaths": d, "assists": a, "gameEndedInEarlySurrender": False,
                          "challenges": {"laningPhaseGoldExpAdvantage": rg, "soloKills": sk}})
        partidas[mid] = {"metadata": {"matchId": mid}, "info": {"mapId": 11, "queueId": 420, "gameDuration": 1800,
                                                                 "gameCreation": 1000 + n[0], "participants": parts}}
        return mid

    for pu, _t, _c, _r, _m, _top, ps, mc, _e in MUNDO:
        if not pu or ps is None:
            continue
        ids[pu] = [partida([(pu, *x)]) for x in ps]
        for mid, mortes in zip(ids[pu], mc or []):
            timelines[mid] = {"info": {"frames": [{"events": [
                {"type": "CHAMPION_KILL", "victimId": 1, "timestamp": 120000 * (k + 1)} for k in range(mortes)] + [
                {"type": "CHAMPION_KILL", "victimId": 1, "timestamp": 900000}]}]}}
    # premade p3 + p4: as mesmas 5 partidas
    comuns = [partida([("p3", 222, "BOTTOM", v, 2, 4, 5, None, None), ("p4", 412, "UTILITY", v, 1, 3, 15, None, None)])
              for v in (True, False, True, False, True)]
    ids["p3"] = ids["p4"] = comuns
    return partidas, ids, timelines


class Resposta(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def falsa(partidas, ids, timelines, vistos):
    mundo = {m[0]: m for m in MUNDO if m[0]}

    def abrir(req, timeout=None):
        url = req.full_url
        vistos.append(url)
        cam = url.split(".riotgames.com", 1)[1].split("?")[0]
        partes = cam.split("/")

        def ok(d):
            return Resposta(json.dumps(d).encode())

        def nf():
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
        if "/spectator/" in cam:
            if not ESPECTADOR[0]:
                return nf()
            return ok({"gameId": 77, "gameQueueConfigId": 420, "participants": [
                {"puuid": m[0], "championId": m[2], "teamId": m[1], "spell1Id": 11 if m[3] == "JUNGLE" else 4,
                 "spell2Id": 4, "perks": {"perkIds": [8010]}} for m in MUNDO]})
        if "/riot/account/" in cam:
            nome = urllib.parse.unquote(partes[-2])
            return ok({"puuid": nome if nome in mundo else "p0"})
        if "/league/v4/entries/by-puuid/" in cam:
            pu = partes[-1]
            return ok([{"queueType": "RANKED_SOLO_5x5", "tier": "EMERALD", "rank": "III", "leaguePoints": 40,
                        "wins": 60, "losses": 50, "hotStreak": pu == "p7"}])
        if "/by-champion/" in cam:
            m = mundo[partes[-3]]
            return ok({"championId": m[2], "championPoints": m[4], "championLevel": 7}) if m[4] is not None else nf()
        if cam.endswith("/top"):
            return ok([{"championId": c, "championPoints": p} for c, p in mundo[partes[-2]][5]])
        if cam.endswith("/ids"):
            return ok(ids.get(partes[-2], []))
        if cam.endswith("/timeline"):
            return ok(timelines.get(partes[-2], {"info": {"frames": []}}))
        if "/matches/" in cam:
            return ok(partidas[partes[-1]])
        return nf()
    return abrir


def tags_ids(partidas, maestria=50000):
    pf = {"partidas": partidas, "maestria": maestria, "maestria_top": [(1, 50000), (2, 40000)], "mortes_cedo": None}
    return sorted(t["id"] for t in carregamento.tags(pf, 1, "TOP"))


def principal():
    falhas = []
    logging.basicConfig(level=logging.INFO, format="log: %(message)s", stream=sys.stdout)
    partidas, ids, timelines = montar()
    vistos = []
    api = riotapi.RiotAPI(chave="falsa", cache_disco=None, abrir=falsa(partidas, ids, timelines, vistos))
    car = carregamento.Carregamento(api=api, conn_lol=banco.abrir_leitura())
    jog = [{"puuid": pu, "campeao": c, "time": t, "rota": r, "smite": r == "JUNGLE", "eu": pu == "p0"}
           for pu, t, c, r, *_ in MUNDO]
    camadas = []
    car.ao_atualizar = lambda e: camadas.append(e["camada"])
    est = car.analisar(jog, fila=420, game_id=1)
    ok_tags = 0
    for m, pj in zip(MUNDO, est["jogadores"]):
        obtidas = {t["id"] for t in pj["tags"]}
        bate = obtidas == m[8]
        ok_tags += bate
        print(f"  {pj['nome']:<10} {pj['lado']:<7} {pj['rota']:<8} {'oculto' if pj['oculto'] else pj['elo']:<20} "
              f"{pj['recentes']:<6} tags {[t['texto'] for t in pj['tags']]} {'ok' if bate else 'FALHOU esperado ' + str(m[8])}")
        if not bate:
            falhas.append(f"{pj['nome']}: {obtidas} != {m[8]}")
    print(f"tags: {ok_tags}/{len(MUNDO)} jogadores certos")
    # negativos diretos em tags(): abaixo dos limiares nada aparece; remake não conta na sequência
    def r(v, rg=None, sk=None, remake=False, c=1, rota="TOP"):
        return {"vitoria": v, "rota": rota, "campeao": c, "k": 1, "d": 5, "a": 1, "rota_ganha": rg, "solo_kills": sk,
                "remake": remake}
    neg = {
        "1 domínio em 5, 2 abates solo/jogo": tags_ids([r(True, 1, 2), r(False, 0, 2, c=2), r(True, 0, 2, c=2),
                                                         r(False, 0, 2), r(True, 0, 2, c=3)]),
        "2 derrotas + remake": tags_ids([r(False), r(False, remake=True), r(False)]),
        "2 jogos de rota (n < 3)": tags_ids([r(True, rota="MIDDLE"), r(False, rota="MIDDLE")]),
        "maestria sem dado (erro)": tags_ids([], maestria=None),
    }
    print(f"negativos: {neg}")
    if any(neg.values()):
        falhas.append(f"negativos com tag: {neg}")
    ch = est["chamadas"]
    print(f"chamadas: {ch} (orçamento {est['orcamento']}), camadas {camadas}, sem cota {est['sem_cota']}, erros {est['erros']}")
    for h, lim in carregamento.ORCAMENTO.items():
        if ch.get(h, 0) > lim:
            falhas.append(f"orçamento estourado em {h}: {ch.get(h)} > {lim}")
    if any("None" in u for u in vistos):
        falhas.append("o oculto gerou chamada")
    if camadas != ["L1", "L2", "L3", "pronto"]:
        falhas.append(f"camadas {camadas}")
    txt = json.dumps(est)
    if any(f'"{pu}"' in txt for pu, *_ in MUNDO if pu):
        falhas.append("puuid no estado público")
    prem = sum(1 for u in vistos if any(u.endswith(f"/matches/{mid}") for mid in ids["p3"]))
    print(f"premade: {prem} downloads das 5 partidas em comum (esperado 5, não 10)")
    if prem != 5:
        falhas.append(f"premade baixado {prem} vezes")
    print(f"previsão: {est['previsao']['faixa']} ({100 * est['previsao']['p']:.1f}%), "
          f"termos {[t['texto'] for t in est['previsao']['termos']]}")
    print(f"adversário {est['adversario']}, jungler inimigo {est['jungler_inimigo']}")
    if (est["adversario"], est["jungler_inimigo"]) != (122, 64):
        falhas.append("adversário/jungler errados")

    # caminho de produção: analisar_live (spectator ligado e desligado -> Riot ID da Live Client)
    nomes = car.nomes()
    live = {"gameData": {"gameTime": 0.025}, "events": {"Events": []},
            "activePlayer": {"riotIdGameName": "p0", "riotIdTagLine": "BR1"},
            "allPlayers": [{"championName": nomes[m[2]], "team": "ORDER" if m[1] == 100 else "CHAOS",
                            "position": m[3], "riotIdGameName": m[0] or "", "riotIdTagLine": "BR1" if m[0] else "",
                            "summonerSpells": {"summonerSpellOne": {"displayName": "Golpear" if m[3] == "JUNGLE" else "Flash"}}}
                           for m in MUNDO]}
    for modo in (True, False):
        ESPECTADOR[0] = modo
        api2 = riotapi.RiotAPI(chave="falsa", cache_disco=None, abrir=falsa(partidas, ids, timelines, vistos2 := []))
        car2 = carregamento.Carregamento(api=api2, conn_lol=banco.abrir_leitura())
        e2 = car2.analisar_live(live)
        iguais = [{t["id"] for t in a["tags"]} for a in e2["jogadores"]] == [{t["id"] for t in a["tags"]} for a in est["jogadores"]]
        print(f"analisar_live com spectator {'ligado' if modo else 'desligado (Riot ID -> account-v1)'}: chamadas "
              f"{e2['chamadas']}, game_id {e2['game_id']}, tags iguais às de cima: {iguais}, sem cota {e2['sem_cota']}")
        if not iguais or any(e2["chamadas"].get(h, 0) > lim for h, lim in carregamento.ORCAMENTO.items()):
            falhas.append(f"analisar_live (spectator={modo}): tags diferentes ou orçamento estourado {e2['chamadas']}")
        if any("None" in u or "/by-riot-id//" in u for u in vistos2):
            falhas.append("oculto gerou chamada no analisar_live")
        car2.encerrar()
        if car2.estado() != {"partida": False} or api2.mem:
            falhas.append("encerrar não esqueceu o estado")

    # gatilho e Live Client na gravação real
    with GRAVACAO.open(encoding="utf-8") as f:
        primeira = json.loads(f.readline())["dados"]
        n_carr = 1
        depois = None
        for linha in f:
            d = json.loads(linha)["dados"]
            if carregamento.em_carregamento(d):
                n_carr += 1
            else:
                depois = d
                break
    lv = carregamento.jogadores_live(primeira, car.ids_por_nome())
    print(f"gravação real: {n_carr} amostras em carregamento, depois gameTime {depois['gameData']['gameTime']:.1f}; "
          f"Live: {[(j['nome'], j['time'], j['rota'], 'smite' if j['smite'] else '') for j in lv]}")
    if not (90 <= n_carr <= 110) or any(j["campeao"] is None for j in lv) or sum(j["smite"] for j in lv) != 2:
        falhas.append("gatilho ou leitura da Live Client real errados")
    print("FALHOU: " + "; ".join(falhas) if falhas else f"ok: tags {ok_tags}/{len(MUNDO)}, orçamento ok")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(principal())
