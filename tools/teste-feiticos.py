"""prova do cronômetro de feitiços inimigos (plano v2, passo 15e).
uso: python tools/teste-feiticos.py [--sem-gravacao]
- recarga com bota e Perspicácia Cósmica (300 × 100/110 = 272,7; 3158 + 8347 = 234,4);
- leitura das linhas de ping (formato real, ruído de OCR, descartes), dedupe de aliados repetindo;
- atalho F9 + 1..5 (máquina de estado simulada, sem tecla nenhuma) e RegisterHotKey real do F9;
- marcar(): marcado / desfeito / sem inimigo (modo treino) / sem feitiço, com a rota da fala; ganchos
  ao_armar/ao_expirar do retorno ao jogador (a voz e a moldura do retorno: teste-alertas.py);
- com a gravação 20261013-071040: OCR das telas + Live Client tocadas em ordem -> cronômetros.
"""
import json
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import feiticos as F  # noqa: E402

GRAVACAO = RAIZ / "temp" / "gravacao" / "20261013-071040"
falhas = []


def confere(nome, cond, detalhe=""):
    print(f"{'ok' if cond else 'FALHOU'}  {nome}{(' · ' + detalhe) if detalhe else ''}")
    if not cond:
        falhas.append(nome)


def jogador(nome, time_, rota, feit, itens=(), arvores=(8000, 8400), nivel=1, cs=0):
    return {"championName": nome, "team": time_, "position": rota, "riotId": nome, "level": nivel,
            "scores": {"creepScore": cs}, "items": [{"itemID": i, "displayName": str(i)} for i in itens],
            "summonerSpells": {"summonerSpellOne": {"displayName": feit[0]}, "summonerSpellTwo": {"displayName": feit[1]}},
            "runes": {"primaryRuneTree": {"id": arvores[0]}, "secondaryRuneTree": {"id": arvores[1]}}}


def live(gt, inimigos):
    eu = jogador("Zac", "ORDER", "JUNGLE", ("Golpear", "Flash"))
    return {"activePlayer": {"riotId": "Zac"}, "gameData": {"gameTime": gt}, "allPlayers": [eu] + inimigos}


def main():
    # 1. fórmula
    confere("recarga Flash com 3158 = 300 × 100/110", abs(F.recarga(300, 10) - 300 * 100 / 110) < 1e-9,
            f"{F.recarga(300, 10):.1f} s")
    confere("recarga Flash 3158 + Perspicácia = 234,4", round(F.recarga(300, 28), 1) == 234.4, f"{F.recarga(300, 28):.1f} s")
    confere("recarga Flash só runa = 254,2", round(F.recarga(300, 18), 1) == 254.2)
    confere("recarga Flash 3171 + runa = 217,4", round(F.recarga(300, 38), 1) == 217.4)

    # 2. cronômetro com a Live Client (bota visível) e o spectator (runa)
    ini = [jogador("Riven", "CHAOS", "TOP", ("Flash", "Incendiar")),
           jogador("Ekko", "CHAOS", "JUNGLE", ("Flash", "Golpe Primordial"), arvores=(8100, 8300)),
           jogador("Yasuo", "CHAOS", "MIDDLE", ("Flash", "Incendiar"), itens=(3158,)),
           jogador("Tristana", "CHAOS", "BOTTOM", ("Barreira", "Flash")),
           jogador("Seraphine", "CHAOS", "UTILITY", ("Exaustão", "Flash"), itens=(3171,))]
    espectador = {"participants": [{"championId": 157, "puuid": "x", "riotId": "alguem#BR1", "perks": {"perkIds": [8010, 8347]}},
                                   {"championId": 147, "puuid": "y", "riotId": "outra#BR1", "perks": {"perkIds": [8214, 8000]}}]}
    runas = F.runas_do_espectador(espectador)
    confere("spectator guarda só campeão -> runas", runas == {157: [8010, 8347], 147: [8214, 8000]}
            and "riotId" not in json.dumps(runas))
    f = F.Feiticos(runas_por_campeao=runas, campeao_id={"Yasuo": 157, "Seraphine": 147})
    f.atualizar(live(420.0, ini))
    u = f.registrar("Yasuo", "Flash", 426, "chat")
    confere("Yasuo (3158 + runa do spectator): volta em 234,4 s", round(u["volta_em"] - 426, 1) == 234.4 and not u["incerto"],
            f"{u['volta_em'] - 426:.1f} s, {u['motivos']}")
    u = f.registrar("Seraphine", "Exaustão", 430, "chat")
    confere("Seraphine Exaustão com 3171 sem runa: 240 × 100/120 = 200", round(u["volta_em"] - 430, 1) == 200.0 and not u["incerto"])
    u = f.registrar("Ekko", "Flash", 430, "chat")
    confere("Ekko com Inspiração e sem spectator: '±', faixa 254,2–300", u["incerto"]
            and round(u["volta_em"] - 430, 1) == 254.2 and round(u["volta_max"] - 430, 1) == 300.0, str(u["motivos"]))
    u = f.registrar("Riven", "Flash", 440, "chat")
    confere("Riven sem bota e sem Inspiração: 300 s cravado", u["volta_em"] - 440 == 300 and not u["incerto"])
    est = f.estado(500)
    confere("estado do painel em ordem de volta, com texto", [e["inimigo"] for e in est] == ["Seraphine", "Yasuo", "Ekko", "Riven"]
            and est[1]["texto"] == "Yasuo sem Flash 2:40", est[1]["texto"])
    confere("voz: nada voltou ainda aos 8:20", f.voltaram(500) == [])
    v = f.voltaram(631)
    confere("voz: Seraphine com Exaustão aos 10:31 (e só uma vez)", [x["texto"] for x in v] == ["Seraphine com Exaustão"]
            and f.voltaram(632) == [])
    import avisos as A   # a fala sai do molde genérico (pacote de voz): rota, não campeão; o rótulo mantém o nome
    m = A.MotorAvisos(textos=A.TEXTOS)
    m.publicar(A.aviso_de(v[0]), 0.0)
    av = next(x for _, d, x in m.emitidos if d == "voz")
    confere("voz genérica: 'exaustão do suporte voltou', rótulo 'Seraphine com Exaustão', fala no catálogo",
            av.fala == "exaustão do suporte voltou" and av.rotulo == "Seraphine com Exaustão"
            and av.fala in A.catalogo(A.TEXTOS), f"{av.fala!r} / {av.rotulo!r}")
    confere("feitiços com cronômetro = os da fala do catálogo",
            {k.split()[0].lower() for k in F.RECARGA_BASE} == set(A.FEITICOS_FALA), str(sorted(F.RECARGA_BASE)))

    # 3. leitura das linhas (formato real + ruído de OCR medido nas telas)
    nomes = ["Riven", "Ekko", "Yasuo", "Tristana", "Seraphine"]
    casos = [("07:05 Amo (Annie): Yasuo usou Incendiar", ("Yasuo", "Incendiar", True, 425)),
             ("0/:06 Amo (Annie): Yasuo usou Hash", ("Yasuo", "Flash", True, 426)),
             ("0/:06 Amo (Annie): Yasuo usou 1-lash", ("Yasuo", "Flash", True, 426)),
             ("07:24 CelestiaFromHell (Yuumi): Seraphine Exaustão", ("Seraphine", "Exaustão", False, 444)),
             ("[Todos] 19:14 Amo (Annie): Tristana usou Flash", None),   # canal antes do horário não existe
             ("19:14 [Todos] Amo (Annie): Tristana usou Flash", ("Tristana", "Flash", True, 1154)),
             ("07: 18 X (Annie): Riven usou Teleporte Desencadeado", ("Riven", "Teleporte", True, 438)),
             ("07:06 Amo (Annie): Yasuo usou R- Último Suspiro", None),
             ("16:25 syphon filter (Nilah): Seraphine - Vivo(a)", None),
             ("17:01 Amo (Annie): Espere por R - 2s", None),
             ("31:50 C3 (Illaoi): Dança da Morte - Precisa de 347 de ouro", None),
             ("06:36 Xerekton (Zac) está a caminho", None),
             ("08:27 Xerekton (Zac) derrotou o Dragão do Oceano!", None)]
    for texto, esperado in casos:
        p = F.ler_ping(texto, nomes)
        obtido = (p["inimigo"], p["feitico"], p["usou"], p["ts"]) if p else None
        confere(f"linha {texto[:46]!r}", obtido == esperado, f"{obtido}")

    # 4. dedupe: aliado repete o ping (19:14 e 19:15 = o mesmo Flash) e a linha aparece em vários prints
    f2 = F.Feiticos()
    f2.atualizar(live(1162.0, ini))
    f2.processar_linhas(["19:14 Amo (Annie): Tristana usou Flash", "19:15 Amo (Annie): Tristana usou Flash"], 1162.0)
    f2.processar_linhas(["19:14 Amo (Annie): Tristana usou Flash"], 1165.0)
    us = f2.usos[("Tristana", "Flash")]
    confere("dedupe: 2 linhas + reprint = 1 gasto às 19:14", len(us) == 1 and us[0]["ts"] == 1154, f"{[u['ts'] for u in us]}")
    f2.processar_linhas(["01:06 Amo (Annie): Yasuo usou Flash"], 1162.0)
    confere("linha com horário velho (> 300 s) é descartada", ("Yasuo", "Flash") not in f2.usos)
    f5 = F.Feiticos()
    f5.atualizar(live(562.0, ini))
    f5.processar_linhas(["07:06 Amo (Annie): Yasuo usou Flash"], 562.0)
    confere("linha de 136 s atrás ainda na tela (00562.0) liga o cronômetro", [u["ts"] for u in f5.usos.get(("Yasuo", "Flash"), [])] == [426])
    f2.processar_linhas(["19:20 Amo (Annie): Seraphine Exaustão"], 1162.0)
    confere("sem 'usou' não liga cronômetro", ("Seraphine", "Exaustão") not in f2.usos)

    # 5. atalho F9 + n (inimigo por rota) e desfazer
    f3 = F.Feiticos()
    f3.atualizar(live(300.0, list(reversed(ini))))
    confere("ordem do atalho = TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY", f3.ordem == nomes, str(f3.ordem))
    u = f3.atalho(2, 300.0)
    confere("F9 + 2 = Flash do Ekko agora", u and u["inimigo"] == "Ekko" and u["feitico"] == "Flash" and u["ts"] == 300.0)
    confere("F9 + 2 de novo em 4 s desfaz", f3.atalho(2, 304.0) is None and not f3.usos[("Ekko", "Flash")])
    confere("F9 + 9 (sem inimigo) não faz nada", f3.atalho(9, 305.0) is None)

    # 5b. marcar(): resultado para o retorno ao jogador (rota genérica, sem nome de campeão na fala)
    r = f3.marcar(4, 310.0)
    confere("marcar 4 = marcado, rota 'atirador', Flash", r["resultado"] == "marcado" and r["rota"] == "atirador"
            and r["feitico"] == "Flash" and r["uso"] and r["uso"]["inimigo"] == "Tristana", str({k: r[k] for k in ("resultado", "rota", "feitico")}))
    r = f3.marcar(4, 315.0)
    confere("marcar 4 de novo em 5 s = desfeito", r["resultado"] == "desfeito" and r["uso"] is None
            and not f3.usos[("Tristana", "Flash")])
    rotas = [f3.marcar(n, 400.0 + 20 * n)["rota"] for n in range(1, 6)]
    confere("rotas da fala: top, jungler, mid, atirador, suporte", rotas == ["top", "jungler", "mid", "atirador", "suporte"], str(rotas))
    treino = F.Feiticos()
    treino.atualizar(live(120.0, []))   # modo treino: só eu na partida
    r = treino.marcar(3, 120.0)
    confere("modo treino (sem inimigo): marcar 3 = sem_inimigo, rota 'mid' pela tecla", r["resultado"] == "sem_inimigo"
            and r["rota"] == "mid" and r["uso"] is None, str(r))
    so_smite = F.Feiticos()
    so_smite.atualizar(live(120.0, [jogador("Ekko", "CHAOS", "JUNGLE", ("Golpear", "Golpe Primordial"))]))
    confere("inimigo só com Smite: sem_feitico", so_smite.marcar(1, 120.0)["resultado"] == "sem_feitico")
    blind = F.Feiticos()   # Live Client sem position (blind, ARAM, personalizada): ordem = a do allPlayers
    blind.atualizar(live(120.0, [jogador("Riven", "CHAOS", "", ("Flash", "Teleporte")),
                                 jogador("Ekko", "CHAOS", "", ("Golpear", "Flash"))]))
    r = blind.marcar(2, 120.0)
    confere("inimigo sem posição: fala 'inimigo', nunca a rota da tecla (2 = jungler)",
            r["resultado"] == "marcado" and r["rota"] == "inimigo", str({k: r[k] for k in ("resultado", "rota", "inimigo")}))

    # 6. máquina do hotkey (mensagens simuladas: nada de tecla enviada)
    marcados, reg = [], []
    a = F.Atalhos(marcados.append)
    confere("número sem F9 antes: ignorado", a.tratar(F.WM_HOTKEY, 12) is None and not marcados)
    a.tratar(F.WM_HOTKEY, F.ID_ARMAR, lambda: reg.append("+"), lambda: reg.append("-"))
    n = a.tratar(F.WM_HOTKEY, 13, lambda: reg.append("+"), lambda: reg.append("-"))
    confere("F9 arma (registra 1..5), 3 escolhe e desarma", n == 3 and marcados == [3] and reg == ["+", "-"])
    a.tratar(F.WM_HOTKEY, F.ID_ARMAR, lambda: reg.append("+"), lambda: reg.append("-"))
    a.tratar(F.WM_TIMER, 0, lambda: reg.append("+"), lambda: reg.append("-"))
    confere("F9 sem número em 2 s: desarma (1..5 voltam para o jogo)", not a.armado and reg[-1] == "-")
    armou, expirou = [], []
    import logging

    class Captura(logging.Handler):   # o aviso do callback quebrado vai para cá, não para o stderr
        def __init__(self):
            super().__init__()
            self.linhas = []

        def emit(self, rec):
            self.linhas.append(rec.getMessage())
    cap_log = Captura()
    F.log.addHandler(cap_log)
    F.log.propagate = False
    nivel = F.log.level
    F.log.setLevel(logging.INFO)   # no coletor quem põe INFO é o logger "coletor"; aqui ele não existe
    b = F.Atalhos(lambda n: 1 / 0, ao_armar=lambda: armou.append(1), ao_expirar=lambda: expirou.append(1))
    b.tratar(F.WM_HOTKEY, F.ID_ARMAR)
    b.tratar(F.WM_HOTKEY, F.ID_ARMAR)   # F9 de novo armado: não chama o retorno 2 vezes
    n = b.tratar(F.WM_HOTKEY, 11)        # ao_marcar quebra: a máquina segue (exceção vira log, não mata a thread)
    b.tratar(F.WM_HOTKEY, F.ID_ARMAR)
    b.tratar(F.WM_TIMER, 0)
    F.log.removeHandler(cap_log)
    F.log.propagate = True
    F.log.setLevel(nivel)
    confere("retorno: ao_armar 1 vez por F9, ao_expirar no tempo; callback quebrado não derruba", armou == [1, 1]
            and expirou == [1] and n == 1 and not b.armado, f"armou {armou}, expirou {expirou}")
    confere("log do atalho: F9 recebido, F9 + 1 recebido, retorno quebrado avisado, expirou",
            any("F9 recebido" in x for x in cap_log.linhas) and any("F9 + 1 recebido" in x for x in cap_log.linhas)
            and any("retorno falhou: ZeroDivisionError" in x for x in cap_log.linhas)
            and any("expirou" in x for x in cap_log.linhas), str(len(cap_log.linhas)))
    try:
        real = F.Atalhos(lambda n: None).iniciar()
        time.sleep(0.2)
        real.parar()
        confere("RegisterHotKey do F9 real (registra e solta, sem tecla)", True)
    except RuntimeError as e:
        confere("RegisterHotKey do F9 real", False, str(e))
    # iniciar() estourou os 5 s: a thread que registra depois solta o F9 e sai (não prende a tecla)
    import threading
    orfa = F.Atalhos(lambda n: None)
    orfa._desistiu = True
    pronto_orfa = threading.Event()
    t_orfa = threading.Thread(target=orfa._rodar, args=(pronto_orfa,), daemon=True)
    F.log.disabled = True   # o aviso "registrou depois do prazo" é esperado aqui
    t_orfa.start()
    t_orfa.join(3)
    F.log.disabled = False
    try:
        de_novo = F.Atalhos(lambda n: None).iniciar()
        de_novo.parar()
        livre = True
    except RuntimeError:
        livre = False
    confere("thread órfã do atalho (iniciar desistiu) solta o F9: o próximo registra",
            not t_orfa.is_alive() and not pronto_orfa.is_set() and livre)

    # 6b. monitor do print: o do jogo, não o monitors[1] do mss (nesta máquina, a 2ª tela)
    import minimapa
    mons = [{"left": 0, "top": 0, "width": 4480, "height": 1795},
            {"left": 2560, "top": 595, "width": 1920, "height": 1200, "is_primary": False},
            {"left": 0, "top": 0, "width": 2560, "height": 1080, "is_primary": True}]
    cfg = {"General": {"Width": "2560", "Height": "1080"}}
    escolhido = minimapa.monitor_do_jogo(mons, cfg)
    sem_cfg = minimapa.monitor_do_jogo(mons, {})
    confere("monitor do chat = o do jogo (game.cfg 2560×1080; sem cfg, o principal), nunca monitors[1]",
            escolhido is mons[2] and sem_cfg is mons[2], f"{escolhido['width']}×{escolhido['height']} em "
            f"({escolhido['left']}, {escolhido['top']})")

    # 6c. OCR travado: o readline tem prazo, o PowerShell é morto e o próximo ler() sobe outro
    import threading as th

    class ProcTravado:
        def __init__(self):
            self.morto = th.Event()
            self.stdout = self
            self.stdin = self

        def readline(self):
            self.morto.wait(5)
            return b""

        def write(self, b):
            pass

        def flush(self):
            pass

        def poll(self):
            return 1 if self.morto.is_set() else None

        def kill(self):
            self.morto.set()

    ocr_t = F.OcrChat(timeout=0.3)
    ocr_t.proc = ProcTravado()
    t0 = time.monotonic()
    try:
        ocr_t._resposta()
        erro = None
    except RuntimeError as e:
        erro = str(e)
    dt = time.monotonic() - t0
    confere("OCR sem resposta em 0,3 s: mata o processo e avisa (thread não fica presa)",
            erro is not None and "sem resposta" in erro and dt < 2 and ocr_t.proc is None, f"{dt:.2f} s · {erro}")

    # 7. gravação real: OCR das telas + Live Client tocadas na ordem
    if "--sem-gravacao" not in sys.argv and (GRAVACAO / "telas").exists():
        from PIL import Image
        telas = {float(p.stem): p for p in sorted((GRAVACAO / "telas").glob("*.png"))}
        f4 = F.Feiticos()
        ocr = F.OcrChat().iniciar()
        caixa = None
        try:
            with open(GRAVACAO / "live.jsonl", encoding="utf-8") as arq:
                pend = sorted(telas)
                for linha in arq:
                    d = json.loads(linha).get("dados") or {}
                    if not d.get("allPlayers"):
                        continue
                    f4.atualizar(d)
                    while pend and f4.gt >= pend[0]:
                        im = Image.open(telas[pend.pop(0)]).convert("RGB")
                        caixa = caixa or F.calibrar_chat(im, ocr)
                        if caixa:
                            f4.processar_linhas([ln["t"] for ln in ocr.ler(im.crop(caixa), 3)], f4.gt)
        finally:
            ocr.parar()
        usos = sorted((u["ts"], u["inimigo"], u["feitico"], round(u["volta_em"] - u["ts"], 1), u["incerto"])
                      for lst in f4.usos.values() for u in lst)
        for x in usos:
            print(f"      gasto {F.mmss(x[0])} {x[1]} {x[2]}: volta em {x[3]} s{' ±' if x[4] else ''}")
        confere("gravação: Yasuo Incendiar 7:05, Yasuo Flash 7:06, Tristana Flash 19:14 (1 vez)",
                [(F.mmss(x[0]), x[1], x[2]) for x in usos] == [("7:05", "Yasuo", "Incendiar"), ("7:06", "Yasuo", "Flash"),
                                                              ("19:14", "Tristana", "Flash")])

    print(f"{'ok' if not falhas else 'FALHOU'} ({len(falhas)} falhas)")
    return 1 if falhas else 0


if __name__ == "__main__":
    for s in (sys.stdout, sys.stderr):
        s.reconfigure(encoding="utf-8")
    sys.exit(main())
