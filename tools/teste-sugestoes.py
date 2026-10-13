"""prova das sugestões aceitas (plano v2, passo 15f): um teste por item, com estados sintéticos, e a
gravação real 20261013-071040 tocada em ordem como conferência.
uso: python tools/teste-sugestoes.py [--sem-gravacao]   ->  "5/5 ok"
  2 preparo de objetivo · 3 revisão da previsão · 4 picos de força · 5 composição no carregamento ·
  6 modo treino (o item 1, flash por atalho, é o tools/teste-feiticos.py)
"""
import json
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import analise  # noqa: E402
import banco  # noqa: E402
import sugestoes as S  # noqa: E402

FIX = RAIZ / "tests" / "fixtures"
GRAVACAO = RAIZ / "temp" / "gravacao" / "20261013-071040"
EST = S.carregar_estatico(FIX / "jogo-estatico.json")


def jog(nome, time_, rota, nivel=1, itens=(), morto=False, renasce=0.0):
    return {"championName": nome, "team": time_, "position": rota, "riotId": nome, "level": nivel,
            "isDead": morto, "respawnTimer": renasce, "scores": {},
            "items": [{"itemID": i, "displayName": EST_NOMES.get(i, str(i))} for i in itens]}


EST_NOMES = {6333: "Dança da Morte", 3047: "Botas Galvanizadas de Aço", 1055: "Lâmina de Doran"}


def live(gt, eu, inimigos, eventos=(), aliados=()):
    return {"activePlayer": {"riotId": eu["riotId"]}, "gameData": {"gameTime": gt},
            "allPlayers": [eu, *aliados, *inimigos], "events": {"Events": list(eventos)}}


def item2():
    """2 inimigos mortos 40 s antes do dragão -> o bloco lista os 2"""
    eu = jog("Zac", "ORDER", "JUNGLE")
    ini = [jog("Riven", "CHAOS", "TOP", morto=True, renasce=30.0), jog("Ekko", "CHAOS", "JUNGLE"),
           jog("Yasuo", "CHAOS", "MIDDLE", morto=True, renasce=55.0), jog("Tristana", "CHAOS", "BOTTOM"),
           jog("Seraphine", "CHAOS", "UTILITY")]
    ev = [{"EventName": "GameStart", "EventTime": 0.0}]
    b = S.preparo_objetivo(live(260.0, eu, ini, ev), vistos={"Ekko": 255.0, "Tristana": 200.0},
                           area_jungler={"zona": "selva bot inimiga", "confianca": 0.6})
    dr = [x for x in b if x["objetivo"] == "dragao"]
    ok = (len(dr) == 1 and dr[0]["faltam"] == 40.0 and dr[0]["mortos"] == 2
          and {x["campeao"] for x in dr[0]["inimigos"] if x["estado"] == "morto"} == {"Riven", "Yasuo"}
          and next(x for x in dr[0]["inimigos"] if x["campeao"] == "Yasuo")["perde_objetivo"]
          and next(x for x in dr[0]["inimigos"] if x["campeao"] == "Ekko")["estado"] == "visto"
          and next(x for x in dr[0]["inimigos"] if x["campeao"] == "Tristana")["estado"] == "sumido"
          and dr[0]["jungler"]["zona"] == "selva bot inimiga")
    # dragão depois de uma morte: renasce 300 s depois; alma (4 do mesmo time) -> ancião em 360 s
    ev2 = ev + [{"EventName": "DragonKill", "EventTime": 508.0, "KillerName": "Zac", "DragonType": "Water"}]
    p = {o["objetivo"]: o for o in S.proximos_objetivos(live(600.0, eu, ini, ev2))}
    ev3 = ev + [{"EventName": "DragonKill", "EventTime": t, "KillerName": "Ekko", "DragonType": "Air"} for t in (300, 700, 1100, 1500)]
    p3 = {o["objetivo"]: o for o in S.proximos_objetivos(live(1600.0, eu, ini, ev3))}
    ok = ok and p["dragao"]["nasce_em"] == 808.0 and p3["dragao"]["nome"] == "dragão ancião" and p3["dragao"]["nasce_em"] == 1860.0
    return ok, dr[0]["texto"] if dr else "sem bloco"


def item3():
    """precisão da previsão do jungler sobre a timeline da fixture (jungler inimigo = pid 7, Ekko)"""
    tl = json.loads((FIX / "timeline-3292712362.json").read_text(encoding="utf-8"))
    reais = S.posicoes_timeline(tl, 7)
    prev = []
    for t, x, y in reais:
        m = round(t / 60)
        if m < 1:
            continue
        dx = 300 if m % 2 == 0 else 1500           # minuto par: acerto (300 < 1000); ímpar: erro (1500)
        for k in range(6):                          # previsão a cada 10 s no minuto que acaba em t
            prev.append({"gt": t - 50 + 10 * k, "x": x + dx, "y": y, "visto_ha": 3 if m == 5 else 30})
    r = S.revisar_previsao(prev, reais)
    minutos = [round(t / 60) for t, _, _ in reais if t >= 60]
    contam = [m for m in minutos if m != 5]
    esperado = sum(m % 2 == 0 for m in contam) / len(contam)
    acc = S.precisao_acumulada([r, {"n": 10, "acertos": 9}])
    ok = (r["n"] == len(contam) and r["n_visto"] == 1 and abs(r["precisao"] - round(esperado, 3)) < 1e-9
          and acc["n"] == r["n"] + 10 and acc["acertos"] == r["acertos"] + 9)
    return ok, f"{r['acertos']}/{r['n']} = {r['precisao']} (esperado {esperado:.3f}; 1 minuto com o jungler visto fora); acumulada {acc['precisao']}"


def item4():
    """nível 5 -> 6 do adversário de rota: 1 aviso; repetir a amostra: nenhum; salto 4 -> 7: 'visto'"""
    eu = jog("Renekton", "ORDER", "TOP", nivel=5)
    pk = S.PicosDeForca(EST["lendarios"])
    seq = [(5, 4, ()), (6, 4, ()), (6, 4, ()), (6, 7, ()), (6, 7, (6333,)), (6, 7, (6333, 3047))]
    avisos = []
    for nr, ne, it in seq:
        ini = [jog("Riven", "CHAOS", "TOP", nivel=nr, itens=it), jog("Ekko", "CHAOS", "JUNGLE", nivel=ne),
               jog("Yasuo", "CHAOS", "MIDDLE", nivel=9)]
        avisos.append([a["texto"] for a in pk.atualizar(live(100.0, eu, ini))])
    esperado = [[], ["Riven nível 6"], [], ["Ekko visto nível 7"], ["Riven fechou Dança da Morte"], []]
    return avisos == esperado and 6333 in EST["lendarios_set"] and 3047 not in EST["lendarios_set"], str(avisos)


def item5():
    """composição com 4 AD no carregamento -> lembrete de armadura para o Renekton"""
    eu = jog("Renekton", "ORDER", "TOP")
    ini = [jog(n, "CHAOS", r) for n, r in (("Darius", "TOP"), ("Riven", "JUNGLE"), ("Yasuo", "MIDDLE"),
                                            ("Tristana", "BOTTOM"), ("Seraphine", "UTILITY"))]
    aliados = [jog(n, "ORDER", "") for n in ("Zac", "Annie", "Nilah", "Yuumi")]
    lv = live(0.025, eu, ini, aliados=aliados)
    lv["activePlayer"]["fullRunes"] = {"keystone": {"displayName": "Conquistador"},
                                       "primaryRuneTree": {"displayName": "Precisão"},
                                       "secondaryRuneTree": {"displayName": "Determinação"}}
    carregando = S.em_carregamento(lv)
    b = S.bloco_carregamento(lv, EST)
    lv2 = dict(lv, gameData={"gameTime": 12.0}, events={"Events": [{"EventName": "GameStart", "EventTime": 0.0}]})
    ok = (carregando and not S.em_carregamento(lv2) and b["composicao"]["ad"] == 4 and b["composicao"]["ap"] == 1
          and any("armadura" in x for x in b["lembretes"]) and b["runa"]["keystone"] == "Conquistador")
    return ok, f"{b['texto']} -> {b['lembretes']}"


def item6():
    """fila 3140: painel/coach ativo, amostra do banco desligada, e a partida fora das contas"""
    lv = {"gameData": {"gameMode": "PRACTICETOOL", "gameTime": 30.0}}
    ok = (S.coach_ativo(3140) and not S.amostrar(3140) and not S.amostrar(None, lv) and S.modo_treino(live=lv)
          and S.amostrar(420) and S.amostrar(400) and 3140 in analise.FORA_DAS_CONTAS)
    # o banco: uma partida de treino gravada não entra na "última partida" nem nas contas
    g = json.loads((FIX / "game-3292712362.json").read_text(encoding="utf-8"))
    tl = json.loads((FIX / "timeline-3292712362.json").read_text(encoding="utf-8"))
    puuid = json.loads((FIX / "summoner.json").read_text(encoding="utf-8"))["puuid"]
    with tempfile.TemporaryDirectory(dir=RAIZ / "temp") as d:
        c = banco.abrir(Path(d) / "treino.db")
        g["queueId"] = 3140
        banco.gravar_partida(c, g, puuid, tl)
        ult_treino = analise.ultima_partida(c)
        g["queueId"] = 420
        g["gameId"] += 1
        banco.gravar_partida(c, g, puuid, tl)
        ult_normal = analise.ultima_partida(c)
        c.close()
    ok = ok and ult_treino is None and ult_normal == g["gameId"]
    return ok, f"coach_ativo(3140)={S.coach_ativo(3140)} amostrar(3140)={S.amostrar(3140)} última com só treino={ult_treino}"


def gravacao():
    """conferência com a partida real: avisos que sairiam ao longo dela (não conta no placar)"""
    pk = S.PicosDeForca(EST["lendarios"])
    vistos_obj, bloco_carr = set(), None
    with open(GRAVACAO / "live.jsonl", encoding="utf-8") as f:
        for linha in f:
            d = json.loads(linha).get("dados") or {}
            if len(d.get("allPlayers") or []) != 10:
                continue
            gt = d["gameData"]["gameTime"]
            if bloco_carr is None and S.em_carregamento(d):
                bloco_carr = S.bloco_carregamento(d, EST)
                print(f"      carregamento ({S.mmss(gt)}): {bloco_carr['texto']} · runa {bloco_carr['runa']['keystone']}"
                      f" -> {bloco_carr['lembretes']}")
            for b in S.preparo_objetivo(d):
                chave = (b["objetivo"], round((gt + b["faltam"]) / 10))   # 1 linha por nascimento
                if chave not in vistos_obj and (b["faltam"] <= 40 or b["mortos"]):
                    vistos_obj.add(chave)
                    print(f"      {S.mmss(gt)} preparo: {b['texto']}")
            for a in pk.atualizar(d):
                print(f"      {S.mmss(gt)} pico: {a['texto']}")
    return bloco_carr is not None


def main():
    itens = [("2 preparo de objetivo", item2), ("3 revisão da previsão", item3), ("4 picos de força", item4),
             ("5 composição no carregamento", item5), ("6 modo treino", item6)]
    ok_n = 0
    for nome, fn in itens:
        try:
            ok, det = fn()
        except Exception as e:  # noqa: BLE001
            ok, det = False, f"{type(e).__name__}: {e}"
        ok_n += ok
        print(f"{'ok' if ok else 'FALHOU'}  {nome} · {det}")
    if "--sem-gravacao" not in sys.argv and (GRAVACAO / "live.jsonl").exists():
        print("gravação 20261013-071040 (conferência, fora do placar):")
        gravacao()
    print(f"{ok_n}/{len(itens)} {'ok' if ok_n == len(itens) else 'FALHOU'}")
    return 0 if ok_n == len(itens) else 1


if __name__ == "__main__":
    for s in (sys.stdout, sys.stderr):
        s.reconfigure(encoding="utf-8")
    sys.exit(main())
