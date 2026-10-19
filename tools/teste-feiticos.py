"""prova do cronômetro de feitiços inimigos (plano v2, passo 15e).
uso: python tools/teste-feiticos.py [--sem-gravacao]
- recarga com bota e Perspicácia Cósmica (300 × 100/110 = 272,7; 3158 + 8347 = 234,4);
- leitura das linhas de ping (formato real, ruído de OCR, descartes), dedupe de aliados repetindo;
- atalho só com o F7 (teclado observado com estado falso e relógio simulado, sem tecla nenhuma): 1, 2, 5 e 6
  batidas a partir da minha rota, janela que recomeça na soltura, segurar = desfazer/cancelar, jogo fora da frente,
  números de cima nunca, numérico opcional; teclas livres no LoL do Gabriel, observador real liga e para;
- marcar() (marcar de novo não desfaz), desfazer() (a última do atalho com cronômetro correndo, nunca a do chat),
  previa() (rótulo da batida); sem inimigo (modo treino) / sem feitiço, com a rota da fala (a voz e a moldura do
  retorno: teste-alertas.py; o caminho inteiro no coach: teste-coach.py caso_atalho_f7);
- com a gravação 20261013-071040: OCR das telas + Live Client tocadas em ordem -> cronômetros.
"""
import json
import sys
import tempfile
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


def recorte_chat(live_fn):
    """LeitorChat com tela, captura e OCR falsos: recorte sem linha "mm:ss" por RECALIBRAR_PRINTS prints = recalibra
    pelas FAIXAS_CALIBRAR; chat vazio de verdade = espera dobrando; recorte certo = nunca recalibra"""
    import logging

    from PIL import Image
    VELHA = (1405, 791, 1877, 961)            # dados/calibracao-chat.json de 13/10 (o recorte em uso em 15/10)
    ESQUERDA = (20, 800, 500, 975)            # o chat no canto de baixo à esquerda (onde o LoL põe por padrão)
    marca = {(0, 620): "esquerda", (1000, 620): "direita"}   # pixel de canto de cada faixa: diz qual faixa o OCR lê

    def tela_falsa():
        im = Image.new("RGB", (2560, 1080))
        im.putpixel((0, 620), (0, 255, 0))
        im.putpixel((1000, 620), (0, 0, 255))
        return im

    class Cena:
        """chat: retângulo onde o chat está (None = chat vazio, sem linha nenhuma); conta as leituras"""
        def __init__(self, chat):
            self.chat, self.ultimo, self.faixas, self.recortes = chat, None, [], 0

        def captura(self, caixa=None):
            self.ultimo = caixa
            t = tela_falsa()
            return t if caixa is None else t.crop(caixa)

        def dentro(self, caixa):
            if not self.chat or not caixa:
                return False
            cx, cy = (caixa[0] + caixa[2]) / 2, (caixa[1] + caixa[3]) / 2
            return self.chat[0] <= cx <= self.chat[2] and self.chat[1] <= cy <= self.chat[3]

        def ler(self, im, escala=3):
            if im.size == (1150, 460):            # faixa da calibração (as duas têm este tamanho em 2560×1080)
                qual = "esquerda" if im.getpixel((0, 0)) == (0, 255, 0) else "direita"
                self.faixas.append(qual)
                x0, y0 = next(k for k, v in marca.items() if v == qual)
                if not self.chat or not (x0 <= self.chat[0] < x0 + 1150):
                    return [{"t": "Renekton 166", "p": [{"t": "Renekton", "x": 5, "y": 5, "w": 60, "h": 12}]}]
                y = self.chat[3] - 30 - y0
                return [{"t": f"09:1{i} Eu (Renekton): Malphite usou Flash",
                         "p": [{"t": f"09:1{i}", "x": self.chat[0] + 10 - x0, "y": y - 20 * (1 - i), "w": 40, "h": 14},
                               {"t": "Flash", "x": self.chat[0] + 380 - x0, "y": y - 20 * (1 - i), "w": 50, "h": 14}]}
                        for i in (0, 1)]
            self.recortes += 1
            if self.dentro(self.ultimo):
                return [{"t": "09:15 Eu (Renekton): Malphite usou Flash", "p": []}]
            return [{"t": "Renekton", "p": []}] if self.chat else []

        def parar(self):
            pass

    log_f = logging.getLogger("coletor.feiticos")
    msgs = []

    class Coleta(logging.Handler):
        def emit(self, r):
            msgs.append(r.getMessage())
    h = Coleta()
    log_f.addHandler(h)
    nivel = log_f.level
    log_f.setLevel(logging.INFO)
    malphite = [jogador("Malphite", "CHAOS", "TOP", ("Flash", "Teleporte"))]

    def leitor(cena, pasta):
        cal = Path(pasta) / "calibracao-chat.json"
        F.gravar_calibracao(VELHA, (2560, 1080), cal)
        f = F.Feiticos()
        f.atualizar(live_fn(560.0, malphite))
        return F.LeitorChat(f, ocr=cena, calibracao=cal, captura=cena.captura, na_tela=lambda: True), f, cal
    try:
        # A. chat no canto esquerdo, recorte velho no meio: 19 prints nada; no 20º recalibra; no 21º lê o ping
        with tempfile.TemporaryDirectory() as tmp:
            cena = Cena(ESQUERDA)
            lt, f, cal = leitor(cena, tmp)
            novos = [len(lt.passo(560.0 + 3 * i)) for i in range(22)]
            salvo = F.ler_calibracao(cal, (2560, 1080))
        confere("3293420970: recorte velho sem o chat por 20 prints recalibra para o canto esquerdo e lê o ping",
                lt.caixa == (18, 797, 490, 967) and salvo == lt.caixa and novos.index(1) == 20 and sum(novos) == 1
                and lt.contagem["recalibrou"] == 1 and cena.faixas == ["direita", "esquerda"],
                f"caixa {lt.caixa}, salvo {salvo}, novos por print {novos}, faixas {cena.faixas}, {lt.contagem}")
        confere("3293420970: o log diz o recorte em uso e a troca (sem texto do chat)",
                any("calibração salva" in m and str(VELHA) in m for m in msgs)
                and any("recalibrado para (18, 797, 490, 967)" in m for m in msgs)
                and not any("Malphite" in m for m in msgs), str(msgs[-3:]))
        # B. lado oposto: chat no lugar mas vazio (início da partida): tenta aos 20, aos 60 (espera dobrou), não aos 40
        msgs.clear()
        with tempfile.TemporaryDirectory() as tmp:
            cena = Cena(None)
            lt, f, cal = leitor(cena, tmp)
            for i in range(100):
                lt.passo(560.0 + 3 * i)
        confere("3293420970: chat vazio de verdade: o recorte fica e a espera dobra (tentativas aos 20 e 60 prints)",
                lt.caixa == VELHA and lt.contagem["recalibrar_falhou"] == 2 and len(cena.faixas) == 4
                and lt.contagem["prints"] == 100 and lt._espera == 80,
                f"caixa {lt.caixa}, faixas lidas {cena.faixas}, {lt.contagem}, espera {lt._espera}")
        # C. lado oposto: recorte certo (chat onde a calibração diz) = nunca recalibra, lê no 1º print
        with tempfile.TemporaryDirectory() as tmp:
            cena = Cena(VELHA)
            lt, f, cal = leitor(cena, tmp)
            novos = [len(lt.passo(560.0 + 3 * i)) for i in range(50)]
        confere("3293420970: recorte certo: 50 prints sem recalibrar, gasto no 1º print, contagem de linhas com horário",
                cena.faixas == [] and novos[0] == 1 and sum(novos) == 1 and lt.contagem["com_horario"] == 50,
                f"faixas {cena.faixas}, novos {novos[:3]}…, {lt.contagem}")
        # D. jogo fora da tela: não lê e conta
        with tempfile.TemporaryDirectory() as tmp:
            cena = Cena(VELHA)
            lt, f, cal = leitor(cena, tmp)
            lt.na_tela = lambda: False
            r = [lt.passo(560.0 + 3 * i) for i in range(5)]
        confere("3293420970: jogo fora da tela = nada lido, conta no resumo", r == [[]] * 5 and cena.recortes == 0
                and lt.contagem["fora_da_tela"] == 5, f"{lt.contagem}")
        # E. a calibração procura nas duas faixas, cada uma abaixo do máximo do OCR do Windows (2600 px com a escala 2)
        confere("faixas da calibração cabem no OCR do Windows (≤ 2600 px na escala 2)",
                all((f_[2] - f_[0]) * 2 <= 2600 and (f_[3] - f_[1]) * 2 <= 2600 for f_ in F.FAIXAS_CALIBRAR)
                and F.FAIXAS_CALIBRAR[0] == F.FAIXA_CALIBRAR, str(F.FAIXAS_CALIBRAR))
        # F. processar_linhas conta os pings reconhecidos (o resumo do coach no log)
        f = F.Feiticos()
        f.atualizar(live_fn(560.0, malphite))
        f.processar_linhas(["09:15 Eu (Renekton): Malphite usou Flash", "09:16 Amigo (Ahri): Malphite Flash",
                            "09:17 Renekton abateu Malphite"], 560.0)
        confere("processar_linhas: 'pings' conta os reconhecidos (com e sem 'usou'), não as outras linhas",
                f.ultima_leitura.get("pings") == 2 and F.com_horario(["09:15 a", "continua", "x", "[Equipe] 09:16 b"]) == 2,
                str(f.ultima_leitura))
    finally:
        log_f.removeHandler(h)
        log_f.setLevel(nivel)


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
    relido = f2.processar_linhas(["19:14 Amo (Annie): Tristana usou Flash"], 1165.0)
    confere("reprint da mesma linha devolve 0 novos (só confirma: partida 3293149183 logava 'N gastos' a cada 3 s)",
            relido == [] and f2.ultima_leitura["confirmados"] == 1 and f2.ultima_leitura["novos"] == 0,
            f"{len(relido)} novos, {f2.ultima_leitura}")
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

    # 5. atalho n (inimigo por rota): marcar de novo NÃO desfaz (o F7 sozinho marcaria o top 2 vezes seguidas);
    #    desfazer é o segurar F7 (Feiticos.desfazer: a última marcação do atalho com o cronômetro correndo)
    f3 = F.Feiticos()
    f3.atualizar(live(300.0, list(reversed(ini))))
    confere("ordem do atalho = TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY", f3.ordem == nomes, str(f3.ordem))
    u = f3.atalho(2, 300.0)
    confere("atalho 2 = Flash do Ekko agora", u and u["inimigo"] == "Ekko" and u["feitico"] == "Flash" and u["ts"] == 300.0)
    r = f3.marcar(2, 304.0)
    confere("marcar 2 de novo em 4 s = o mesmo gasto, nunca desfaz (antes desfazia: com o F7 só, armadilha)",
            r["resultado"] == "marcado" and len(f3.usos[("Ekko", "Flash")]) == 1 and f3.usos[("Ekko", "Flash")][0]["ts"] == 300.0,
            f"{r['resultado']}, {[x['ts'] for x in f3.usos[('Ekko', 'Flash')]]}")
    confere("atalho 9 (sem inimigo) não faz nada", f3.atalho(9, 305.0) is None)
    f3.registrar("Yasuo", "Flash", 306.0, "chat")   # gasto lido no chat: o segurar F7 não apaga o que ele não marcou
    r = f3.desfazer(308.0)
    confere("desfazer = a última marcação do atalho (Ekko), não a do chat (Yasuo)",
            r["resultado"] == "desfeito" and r["inimigo"] == "Ekko" and r["rota"] == "jungler"
            and not f3.usos[("Ekko", "Flash")] and f3.usos[("Yasuo", "Flash")], str({k: r[k] for k in ("resultado", "inimigo", "rota")}))
    confere("desfazer sem marcação do atalho = nada_a_desfazer (o do chat fica)",
            f3.desfazer(309.0)["resultado"] == "nada_a_desfazer" and f3.usos[("Yasuo", "Flash")])
    f3.marcar(1, 310.0)
    f3.marcar(4, 320.0)
    r = f3.desfazer(330.0)
    confere("duas marcações: desfazer tira a mais nova (atirador), a outra fica (top)",
            r["inimigo"] == "Tristana" and r["rota"] == "atirador" and f3.usos[("Riven", "Flash")]
            and not f3.usos[("Tristana", "Flash")], str(r["inimigo"]))
    r = f3.marcar(3, 331.0)   # o Yasuo já tem o Flash do chat às 306: a marcação é o mesmo gasto, e o chat não se desfaz
    rd = f3.desfazer(332.0)
    # revisão adversarial do passo 10 (achado 1): antes o desfazer procurava "a mais nova do atalho" em usos e tirava
    # a do top (Riven, certa), com a voz dizendo só "marcação desfeita"; o que ele desfaz é a última AÇÃO dele
    confere("marcar quem o chat já pegou = o mesmo gasto; segurar depois NÃO tira a do top: responde 'veio do chat'",
            r["resultado"] == "marcado" and [x["fonte"] for x in f3.usos[("Yasuo", "Flash")]] == ["chat"]
            and rd["resultado"] == "do_chat" and rd["rota"] == "mid" and f3.usos[("Riven", "Flash")]
            and f3.usos[("Yasuo", "Flash")], str({k: rd[k] for k in ("resultado", "inimigo", "rota")}))
    f3.marcar(1, 340.0)
    confere("marcação com o cronômetro vencido não se desfaz (Riven 340 + 300 s)",
            f3.desfazer(641.0)["resultado"] == "nada_a_desfazer" and f3.usos[("Riven", "Flash")])
    # pilha das ações do F7 (achado 1 da revisão): marcado pelo F7 e depois pingado no chat = confirmado, não se apaga;
    # duas batidas lentas no mesmo = 1 gasto, 1 segurar desfaz e o 2º não acha nada; prazo DESFAZ_PRAZO_S
    f6 = F.Feiticos()
    f6.atualizar(live(500.0, ini))
    f6.marcar(1, 500.0)                                          # F7: Flash da Riven
    f6.processar_linhas(["08:22 Amo (Annie): Riven usou Flash"], 503.0)   # aliado pinga o mesmo Flash (502)
    rd = f6.desfazer(504.0)
    confere("marcado pelo F7 e confirmado no chat: segurar não apaga ('veio do chat'), o cronômetro fica",
            rd["resultado"] == "do_chat" and len(f6.usos[("Riven", "Flash")]) == 1, f"{rd['resultado']} {f6.usos[('Riven', 'Flash')]}")
    f6.marcar(2, 510.0)
    f6.marcar(2, 513.0)                                          # duas batidas lentas no jungler: o mesmo gasto
    r1, r2 = f6.desfazer(514.0), f6.desfazer(515.0)
    confere("duas marcações lentas do mesmo = 1 gasto: 1º segurar desfaz (rota no retorno), o 2º não acha nada (a "
            "ação da Riven já foi respondida) e a Riven fica",
            r1["resultado"] == "desfeito" and r1["rota"] == "jungler" and not f6.usos[("Ekko", "Flash")]
            and r2["resultado"] == "nada_a_desfazer" and f6.usos[("Riven", "Flash")], f"{r1['resultado']} {r2['resultado']}")
    f6.marcar(3, 600.0)
    rp = f6.desfazer(600.0 + F.DESFAZ_PRAZO_S - 1)
    confere("dentro do prazo: desfaz o mid", rp["resultado"] == "desfeito" and rp["rota"] == "mid"
            and not f6.usos[("Yasuo", "Flash")], rp["resultado"])
    f6.marcar(4, 700.0)
    rv = f6.desfazer(700.0 + F.DESFAZ_PRAZO_S + 1)
    confere(f"segurar mais de {F.DESFAZ_PRAZO_S} s depois da marcação: nada a desfazer (F7 segurado sem querer minutos "
            "depois não apaga a certa)", rv["resultado"] == "nada_a_desfazer" and f6.usos[("Tristana", "Flash")], rv["resultado"])
    f3.usos.clear()
    pv = [f3.previa(n) for n in range(1, 6)]
    confere("prévia da batida: rota da fala e 'flash' (Tristana: barreira e flash -> flash)",
            [(p["rota"], p["feitico"]) for p in pv] == [(x, "flash") for x in ("top", "jungler", "mid", "atirador", "suporte")],
            str([(p["rota"], p["feitico"]) for p in pv]))

    # 5b. marcar(): resultado para o retorno ao jogador (rota genérica, sem nome de campeão na fala)
    r = f3.marcar(4, 310.0)
    confere("marcar 4 = marcado, rota 'atirador', Flash", r["resultado"] == "marcado" and r["rota"] == "atirador"
            and r["feitico"] == "Flash" and r["uso"] and r["uso"]["inimigo"] == "Tristana", str({k: r[k] for k in ("resultado", "rota", "feitico")}))
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
    p = blind.previa(2)
    confere("prévia sem posição: o rótulo leva o nome do campeão (a rota seria mentira); sem inimigo, a rota da tecla",
            p["rota"] == "Ekko" and treino.previa(3)["rota"] == "mid", f"{p['rota']} / {treino.previa(3)['rota']}")

    # 6. atalho só com o F7 (14/10 ~20:30: o note do Gabriel não tem numérico e os números de cima são itens).
    #    Teclado OBSERVADO com estado falso e relógio simulado (passos de 25 ms, como a thread): nada de tecla enviada
    import logging
    import teclas

    class Teclado:
        """F7/numérico apertados à mão sobre o Observador de verdade (Atalhos.observador), tempo simulado"""

        def __init__(self, proprio=1, jogo=True, ao_marcar=None):
            self.t, self.baixas, self.jogo = 0.0, set(), jogo
            self.marcas, self.sel, self.desf, self.canc = [], [], [], []
            self.a = F.Atalhos(ao_marcar or (lambda n: self.marcas.append((n, self.t))), ao_selecionar=self.sel.append,
                               ao_desfazer=lambda: self.desf.append(self.t), ao_cancelar=lambda: self.canc.append(self.t),
                               estado=lambda vk: vk in self.baixas, na_tela=lambda: self.jogo, relogio=lambda: self.t)
            self.a.n_proprio = lambda: proprio
            self.obs = self.a.observador()
            self.obs.passo()            # 1ª leitura com tudo solto (tecla já segura ao ligar não conta)

        def andar(self, s):
            for _ in range(int(round(s / 0.025))):
                self.t = round(self.t + 0.025, 3)
                self.obs.passo()

        def bater(self, vk=F.VK_ARMAR, segura=0.1, depois=0.2, vezes=1):
            for _ in range(vezes):
                self.baixas.add(vk)
                self.andar(segura)
                self.baixas.discard(vk)
                self.andar(depois)

        def n_marcados(self):
            return [n for n, _ in self.marcas]

    k = Teclado()
    k.bater()
    k.andar(0.9)        # 1,1 s depois de soltar: ainda escolhendo
    antes = list(k.marcas)
    k.andar(0.3)
    confere("1 batida: seleciona o adversário da minha rota (top) e só marca parado 1,2 s depois de soltar",
            k.sel == [1] and antes == [] and k.n_marcados() == [1] and not k.a.armado, f"sel {k.sel}, marcas {k.marcas}")
    k = Teclado()
    k.bater(vezes=2)
    k.andar(1.5)
    confere("2 batidas: top -> jungler, marca o jungler", k.sel == [1, 2] and k.n_marcados() == [2], f"{k.sel} {k.marcas}")
    k = Teclado()
    k.bater(vezes=5)
    k.andar(1.5)
    confere("5 batidas: top, jungler, mid, atirador, suporte; marca o suporte", k.sel == [1, 2, 3, 4, 5]
            and k.n_marcados() == [5], f"{k.sel} {k.marcas}")
    k = Teclado()
    k.bater(vezes=6)
    k.andar(1.5)
    confere("6 batidas: dá a volta e marca o top de novo", k.sel == [1, 2, 3, 4, 5, 1] and k.n_marcados() == [1],
            f"{k.sel} {k.marcas}")
    k = Teclado(proprio=3)
    k.bater(vezes=6)
    k.andar(1.5)
    k2 = Teclado(proprio=3)
    k2.bater(vezes=2)
    k2.andar(1.5)
    confere("eu no mid: começa no mid e dá a volta (mid, atirador, suporte, top, jungler, mid); 2 batidas = atirador",
            k.sel == [3, 4, 5, 1, 2, 3] and k.n_marcados() == [3] and k2.n_marcados() == [4], f"{k.sel} {k2.marcas}")
    k = Teclado(proprio=None)
    k.bater()
    k.andar(1.5)
    confere("sem rota conhecida (blind, treino): a 1ª batida é o top", k.sel == [1] and k.n_marcados() == [1], str(k.sel))
    k = Teclado()
    k.bater(segura=0.1, depois=0.05)
    k.bater(segura=0.1, depois=1.0)   # batida dentro da janela: a janela recomeça na soltura
    meio = list(k.marcas)
    k.andar(0.3)
    confere("a janela recomeça a cada batida (1,0 s depois da 2ª: nada; 1,3 s: jungler)",
            meio == [] and k.n_marcados() == [2], f"{meio} {k.marcas}")

    # segurar: sem seleção = desfazer; no meio das batidas = cancelar; o desfazer vem antes de qualquer marcação
    k = Teclado()
    k.bater(segura=1.1, depois=2.0)
    confere("segurar F7 1 s (do zero) = desfazer, e nada marca depois de soltar",
            len(k.desf) == 1 and abs(k.desf[0] - 1.05) < 1e-9 and k.marcas == [] and not k.canc and not k.a.armado,
            f"desf {k.desf}, marcas {k.marcas}, sel {k.sel}")
    k = Teclado()
    k.bater(vezes=2)
    k.bater(segura=1.1, depois=2.0)
    confere("bater 2 e segurar na 3ª = cancela a seleção: nada marcado, nada desfeito",
            len(k.canc) == 1 and k.marcas == [] and not k.desf, f"canc {k.canc}, marcas {k.marcas}")
    k = Teclado()
    k.bater(segura=0.9, depois=1.5)
    confere("segurar 0,9 s (menos que 1 s) é batida: marca o top", k.n_marcados() == [1] and not k.desf, str(k.marcas))
    k = Teclado()
    k.bater(segura=3.0, depois=0.0)    # segurado muito tempo: 1 desfazer só, nada marca segurando
    k.andar(2.0)
    confere("segurar 3 s: 1 desfazer só, nenhuma marcação (a janela conta da soltura)",
            len(k.desf) == 1 and k.marcas == [], f"{k.desf} {k.marcas}")

    # jogo fora da frente, números de cima, numérico opcional
    k = Teclado(jogo=False)
    k.bater(vezes=2)
    k.bater(segura=1.2)
    k.andar(1.5)
    confere("F7 com outro programa na frente: nada (nem seleção, nem marcação, nem desfazer)",
            k.sel == [] and k.marcas == [] and not k.desf and not k.canc, f"{k.sel} {k.marcas}")
    k = Teclado()
    k.bater()
    k.jogo = False                     # foi para o navegador no meio: a escolha feita no jogo vale
    k.andar(1.5)
    confere("seleção feita no jogo marca mesmo se o jogo sair da frente na janela", k.n_marcados() == [1], str(k.marcas))
    k = Teclado()
    for vk in (0x31, 0x32, 0x33, 0x34, 0x35):   # 1..5 de cima: itens/sentinela no LoL dele, nunca do coach
        k.bater(vk)
    k.andar(1.5)
    confere("números de cima (1..5) não fazem nada: nem observados", k.sel == [] and k.marcas == []
            and not ({0x31, 0x32, 0x33, 0x34, 0x35} & set(k.obs.teclas)), str(k.obs.teclas))
    k = Teclado()
    k.bater()
    k.bater(0x63)                      # numérico 3 dentro da seleção: marca o mid na hora
    k.andar(1.5)
    k.bater(0x61)                      # numérico sem F7 antes: nada
    k.andar(1.5)
    confere("numérico (opcional) dentro da seleção marca na hora; sem F7 antes, nada",
            k.n_marcados() == [3] and k.marcas[0][1] < 0.5, str(k.marcas))
    k = Teclado()
    k.bater()
    k.andar(1.5)
    k.bater()
    k.andar(1.5)
    confere("duas batidas lentas (> 1,2 s) = duas marcações do top (o Feiticos trata como o mesmo gasto)",
            k.n_marcados() == [1, 1], str(k.marcas))

    # soltura vista pelo Observador mesmo fora do jogo (o aperto, não)
    vistos = []
    est = {"f7": False}
    o = teclas.Observador([F.VK_ARMAR], lambda vk: vistos.append(("aperto", vk)), na_tela=lambda: False,
                          estado=lambda vk: est["f7"], ao_soltar=lambda vk: vistos.append(("solta", vk)))
    o.passo()
    vistos.clear()
    est["f7"] = True
    o.passo()
    est["f7"] = False
    o.passo()
    confere("Observador: aperto só com o jogo na frente; soltura sempre (o Atalhos ignora a de aperto que não contou)",
            vistos == [("solta", F.VK_ARMAR)], str(vistos))

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
    k = Teclado(ao_marcar=lambda n: 1 / 0)   # ao_marcar quebra: a máquina segue (exceção vira log, não mata a thread)
    k.bater(vezes=2)
    k.andar(1.5)
    k.bater(segura=1.1)
    k.bater()
    k.bater(segura=1.1, depois=0.5)
    k.bater()
    k.andar(1.5)
    F.log.removeHandler(cap_log)
    F.log.propagate = True
    F.log.setLevel(nivel)
    confere("callback quebrado não derruba: depois dele, segurar desfaz, cancela e a batida seguinte seleciona",
            k.sel == [1, 2, 1, 1, 2, 1] and len(k.desf) == 1 and len(k.canc) == 1 and not k.a.armado,
            f"sel {k.sel}, desf {k.desf}, canc {k.canc}")
    confere("log do atalho: F7 recebido, batida 2, parado marca, segurado desfaz/cancela, retorno quebrado avisado",
            any("F7 recebido, batida 1 seleciona 1 (top)" in x for x in cap_log.linhas)
            and any("F7 batida 2 seleciona 2 (jungler)" in x for x in cap_log.linhas)
            and any("parado 1.2 s depois de 2 batida(s): marca 2 (jungler)" in x for x in cap_log.linhas)
            and any("segurado 1.0 s: desfazer" in x for x in cap_log.linhas)
            and any("seleção cancelada" in x for x in cap_log.linhas)
            and any("retorno falhou: ZeroDivisionError" in x for x in cap_log.linhas), str(cap_log.linhas[:3]))
    confere("o observador só lê: nada de RegisterHotKey/SendInput/keybd_event no código dos atalhos",
            not any(p in (RAIZ / "coletor" / m).read_text(encoding="utf-8")
                    for m in ("teclas.py", "feiticos.py") for p in ("RegisterHotKey(", "SendInput", "keybd_event")))
    real = F.Atalhos(lambda n: None, na_tela=lambda: False).iniciar()
    time.sleep(0.2)
    vivo = real.thread.is_alive()
    real.parar()
    confere("observador real liga e para (GetAsyncKeyState, sem tecla nenhuma)", vivo and not real.thread.is_alive())
    # teclas do LoL do Gabriel (Config\input.ini e PersistedSettings.json): o F9 é dele (trava o cursor); F7, F8 e o
    # numérico estão livres. Sem a pasta (outra máquina) a prova é pulada
    if teclas.config_lol() is not None:
        conf = teclas.conflitos_no_lol(["F7", "F8", "F9", "F10", "Num 1", "Num 3"])
        confere("LoL do Gabriel: F9 = evtToggleMouseClip; F7, F8, F10 sozinho e numérico livres",
                "evtToggleMouseClip" in conf.get("F9", []) and not set(conf) - {"F9"}, str(conf))
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "input.ini").write_text("[GameEvents]\nevtX=[F7]\nevtY=[Ctrl][F8]\nevtZ=[a],[Num 2]\n", encoding="utf-8")
        conf = teclas.conflitos_no_lol(["F7", "F8", "Num 2"], tmp)
        confere("conflito: tecla sozinha conta, com Ctrl não", conf == {"F7": ["evtX"], "Num 2": ["evtZ"]}, str(conf))

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

    # 6b. partida 3293420970 (15/10/2026): de 14/10 ~19h em diante, 9 ranqueadas sem um ping lido, nenhum erro no log e
    #     nada que dissesse se o recorte via o chat. O recorte calibrado em 13/10 valia para sempre: chat movido = OCR
    #     lendo nada calado. Tela falsa: cada região com uma cor; o OCR falso "lê" o chat só onde ele está de verdade
    recorte_chat(live)

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
