# prova do passo 14 (plano v2): estado do jungler inimigo com cenários sintéticos.
#   python tools/teste-jungler.py
# Pistas: avistamento no minimapa, objetivo com KillerName (global, chega na fog), abate com ele,
# morte/renascer. O farm do inimigo não entra (congela na fog: passo 9). A grade de caminhável sai
# dos recortes reais de tests/fixtures/minimapa (a mesma do teste-alcance).
import glob
import sys
from pathlib import Path

import cv2
import numpy as np

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import alcance as al  # noqa: E402
import jungler as jg  # noqa: E402
import minimapa as mm  # noqa: E402

FIX = RAIZ / "tests" / "fixtures" / "minimapa"


def grade():
    qs = []
    for p in sorted(glob.glob(str(FIX / "*.png"))):
        img = cv2.imread(p)
        r = mm.achar_mapa(img)
        qs.append(np.ascontiguousarray(r.recorte(img)))
    return al.Grade.de_quadros(qs)


def jogador(camp, time, pos, morto=False, resp=0.0):
    return {"championName": camp, "riotIdGameName": camp, "team": time, "position": pos,
            "isDead": morto, "respawnTimer": resp, "summonerSpells": {}}


def principal():
    g = grade()
    res = []

    def caso(nome, ok, detalhe):
        res.append(ok)
        print(f"{'ok' if ok else 'FALHOU'}  {nome}: {detalhe}")

    # 1) Gabriel CHAOS, jungler ORDER visto no azul dele (3821, 8101) aos 3:15 -> aos 3:40 provável rio top
    e = jg.EstadoJungler("CHAOS", g)
    e.jogadores([jogador("Ekko", "ORDER", "JUNGLE")], 190)
    e.observar([{"campeao": "Ekko", "time": "ORDER", "x": 3821, "y": 8101, "visto_em": 195}])
    s = e.estado(220)
    caso("visto no azul 3:15 -> 3:40", s["status"] == "provavel" and s["zonas"][0][0] == "rio top",
         f"{s['texto']} | conf {s['confianca']} | {[(z, round(p, 2)) for z, p in s['zonas'][:3]]}")

    # 2) sem pista nenhuma -> sumido
    e = jg.EstadoJungler("ORDER", g)
    e.jogadores([jogador("Ekko", "CHAOS", "JUNGLE")], 300)
    s = e.estado(300)
    caso("sem dado", s["status"] == "sumido" and not s["zonas"], s["texto"])

    # 3) objetivo do jungler inimigo na fog (HordeKill com KillerName) -> posição fixada no covil
    e = jg.EstadoJungler("ORDER", g)
    e.jogadores([jogador("Ekko", "CHAOS", "JUNGLE")], 500)
    e.observar([{"campeao": "Ekko", "time": "CHAOS", "x": 11032, "y": 6990, "visto_em": 480}])
    e.eventos([{"EventID": 40, "EventName": "HordeKill", "EventTime": 530.4, "KillerName": "Ekko", "Assisters": []}])
    s = e.estado(533)
    caso("objetivo na fog", s["pista"]["fonte"] == "objetivo" and (s["pista"]["x"], s["pista"]["y"]) == (5007, 10471)
         and s["zonas"][0][0] == "rio top", f"{s['texto']} | pista {s['pista']}")

    # 4) morto: sem gank até renascer; depois renasce na fonte dele
    e = jg.EstadoJungler("ORDER", g)
    e.jogadores([jogador("Ekko", "CHAOS", "JUNGLE")], 590)
    e.observar([{"campeao": "Ekko", "time": "CHAOS", "x": 4400, "y": 9600, "visto_em": 595}])
    e.eventos([{"EventID": 50, "EventName": "ChampionKill", "EventTime": 600, "KillerName": "Zac", "VictimName": "Ekko",
                "Assisters": []}])
    e.jogadores([jogador("Ekko", "CHAOS", "JUNGLE", True, 25.0)], 600)
    s1 = e.estado(610)
    g1 = e.gank(610, "top", (3500, 13300))
    e.jogadores([jogador("Ekko", "CHAOS", "JUNGLE", False)], 626)
    s2 = e.estado(630)
    caso("morto e renascer", s1["status"] == "morto" and g1 is None and s2["pista"]["fonte"] == "renasceu"
         and s2["zonas"][0][0] == "base inimiga", f"{s1['texto']} | depois: {s2['texto']}")

    # 5) gank: visto no rio top há 6 s e eu adiantado no top -> aviso; visto no bot -> nada; eu recuado -> nada
    e = jg.EstadoJungler("ORDER", g)
    e.jogadores([jogador("Ekko", "CHAOS", "JUNGLE")], 400)
    e.observar([{"campeao": "Ekko", "time": "CHAOS", "x": 4400, "y": 9600, "visto_em": 400}])
    gk = e.gank(406, "top", (3500, 13300))
    recuado = e.gank(406, "top", (1200, 7000))
    e2 = jg.EstadoJungler("ORDER", g)
    e2.jogadores([jogador("Ekko", "CHAOS", "JUNGLE")], 400)
    e2.observar([{"campeao": "Ekko", "time": "CHAOS", "x": 10500, "y": 5170, "visto_em": 400}])
    longe = e2.gank(406, "top", (3500, 13300))
    na_tela = e.gank(401, "top", (3500, 13300))   # visto há 1 s: posição, quem avisa é o AlertasPosicao
    caso("gank provável top", gk is not None and recuado is None and longe is None and na_tela is None,
         f"adiantado: {gk} | recuado: {recuado} | jungler no bot: {longe} | ainda na tela: {na_tela}")

    print(f"{sum(res)}/{len(res)} ok")

    # extras: abate com assistência dele vira pista na posição da vítima; sem grade (linha reta) também roda
    # (Live Client crua: eventos citam o nome do jogador, não o campeão)
    e = jg.EstadoJungler("ORDER", None)
    e.jogadores([{**jogador("Ekko", "CHAOS", "JUNGLE"), "riotIdGameName": "Jogador7"},
                 {**jogador("Illaoi", "ORDER", "TOP"), "riotIdGameName": "Jogador1"}], 280)
    e.observar([{"campeao": "Illaoi", "time": "ORDER", "x": 2000, "y": 11500, "visto_em": 286}])
    e.eventos([{"EventID": 9, "EventName": "ChampionKill", "EventTime": 289.1, "KillerName": "Jogador6",
                "VictimName": "Jogador1", "Assisters": ["Jogador7"]}])
    s = e.estado(292)
    calor = e.calor(292)
    sumiu = e.calor(330)
    ex = [s["pista"]["fonte"] == "abate" and s["pista"]["x"] == 2000, calor is not None and calor.max() == 1.0,
          sumiu is None]
    # fonte do overlay: Captura (recorte real 00502.0, Ekko visto) + EstadoJungler -> calor e depois "sumido"
    import json
    import overlay_minimapa as ov
    partida = json.loads((FIX / "partida.json").read_text(encoding="utf-8"))
    info = {"meu_time": "ORDER", "campeoes": partida["campeoes"], "mortos": []}
    relogio = [502.0]
    cap = mm.Captura(lambda: info, relogio=lambda: relogio[0], pasta_icones=FIX / "icones")
    img = cv2.imread(str(FIX / "00502.0.png"))
    cap.ret = mm.achar_mapa(img)
    cap.processar(np.ascontiguousarray(cap.ret.recorte(img)), info, 502.0)
    e = jg.EstadoJungler("ORDER", g)
    e.jogadores([jogador("Ekko", "CHAOS", "JUNGLE")], 502)
    e.observar(cap.deteccoes())
    f = ov.fonte_jungler(cap, e, lambda: relogio[0])
    relogio[0] = 512.0
    f1 = f()
    relogio[0] = 540.0
    f2 = f()
    relogio[0] = 545.0
    f3 = f()
    ex.append(f1["calor"] is not None and f1["calor"].shape == (347, 347) and f2["calor"] is None
              and f2["texto"] == "jungler sumido há 38 s" and f3["calor"] is None and f3["texto"] is None)
    # revisão 13/10/2026: a caixa do texto não cobre a largura toda do mapa
    img_txt = ov.renderizar(None, 347, "jungler sumido há 42 s")
    opaco = (img_txt != np.array(ov.CHAVE, np.uint8)).any(axis=2)
    larg = int(opaco.any(axis=0).sum())
    ex.append(larg < 347 * 0.6 and opaco[30:].sum() == 0)
    print(f"extras: abate com assistência -> {s['texto']}; calor do overlay some após 30 s: {sumiu is None}; "
          f"overlay aos 10 s: calor {f1['calor'] is not None}, aos 38 s: {f2['texto']!r}, aos 43 s: "
          f"{f3['texto']!r} (some); caixa do texto {larg}/347 px de largura -> {'ok' if all(ex) else 'FALHOU'}")
    if "--real" in sys.argv:
        replay(g)
    return 0 if all(res) and all(ex) else 1


def replay(g, pasta=RAIZ / "temp" / "gravacao" / "20261013-071040"):
    """medição (não prova): toca a partida real (recortes a cada 10 s + live.jsonl) e compara a zona
    mais provável do Ekko com a posição dele na timeline a cada minuto"""
    import json
    if not (pasta / "live.jsonl").exists():
        print("replay: gravação ausente (temp/ fica fora do git)")
        return
    partida = json.loads((FIX / "partida.json").read_text(encoding="utf-8"))
    det = mm.Detector(partida["campeoes"], "ORDER", 347, FIX / "icones")
    e = jg.EstadoJungler("ORDER", g)
    lives = []
    for ln in open(pasta / "live.jsonl", encoding="utf-8"):
        d = json.loads(ln).get("dados")
        if isinstance(d, dict) and "gameData" in d:
            lives.append((d["gameData"]["gameTime"], d))
    crops = sorted((float(Path(p).stem), p) for p in glob.glob(str(pasta / "minimapa" / "*.png")))
    tl = json.loads((pasta / "timeline-3292746609.json").read_text(encoding="utf-8"))["frames"]
    eventos = sorted([(gt, "live", d) for gt, d in lives] + [(gt, "crop", p) for gt, p in crops]
                     + [(m * 60.0, "minuto", m) for m in range(2, len(tl))], key=lambda x: (x[0], x[1] != "live"))
    top1 = top3 = cob = n = 0
    mortos = []
    for gt, tipo, obj in eventos:
        if tipo == "live":
            e.jogadores(obj["allPlayers"], gt)
            e.eventos(obj["events"]["Events"])
            mortos = [p["championName"] for p in obj["allPlayers"] if p.get("isDead")]
        elif tipo == "crop":
            img = cv2.imread(obj)
            r = mm.achar_mapa(img)
            if r is None or not mm.jogo_na_tela(img, r):
                continue
            ds = det.detectar(np.ascontiguousarray(r.recorte(img)), mortos)
            e.observar([{"campeao": d.campeao, "time": d.time, "x": d.x, "y": d.y, "visto_em": gt} for d in ds])
        else:
            s = e.estado(gt)
            if s["status"] in ("morto",) or not s["zonas"]:
                continue
            p = tl[obj]["participantFrames"]["7"]["position"]
            real = jg.nome_zona(jg.zona(p["x"], p["y"]), "ORDER")
            zs = [z for z, _ in s["zonas"]]
            _, calor = e.distribuicao(gt)
            c, rr = g.ponto(p["x"], p["y"])
            n += 1
            top1 += zs[0] == real
            top3 += real in zs[:3]
            cob += bool(calor is not None and calor[rr, c] > 0)
    print(f"replay da partida real (Ekko, 1/min): zona certa {top1}/{n} ({100 * top1 / max(1, n):.0f}%), "
          f"entre as 3 mais prováveis {top3}/{n} ({100 * top3 / max(1, n):.0f}%), "
          f"posição real dentro da área {cob}/{n} ({100 * cob / max(1, n):.0f}%)")


if __name__ == "__main__":
    sys.exit(principal())
