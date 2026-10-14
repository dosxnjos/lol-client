# prova dos alertas visuais (plano v2, passo 15c): AlertasPosicao (coletor/avisos.py) com sequências
# sintéticas de detecções do minimapa, 1 quadro por segundo, tempo simulado, sem som. Prova do plano:
#   A. jungler aparece no rio top              → "jungler rio top" (vermelho), 1 vez
#   B. mid some 8 s e reaparece no top          → "mid sumiu" e "mid indo top"
#   C. suporte inimigo entra na minha rota top  → "intruso top" (amarelo)
# e nenhum alerta repetido em 10 s. Extras: jungler na minha rota (vermelho, fura a fila), 2 intrusos
# (vermelho), adversário voltou (azul), pausa com o jogo fora da tela, inimigo morto não "some", e a
# janela real da moldura (estilo click-through + pixel da borda, por 2 s num canto da tela).
# uso: python tools/teste-alertas.py [--sem-janela]
import argparse
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
from avisos import TEXTOS, AlertasPosicao, Aviso, MotorAvisos  # noqa: E402

resultados = []
# partida de medição (3292746609): Zac na selva, ORDER; inimigos CHAOS
JOGADORES = {
    "Illaoi": {"time": "ORDER", "posicao": "TOP"}, "Zac": {"time": "ORDER", "posicao": "JUNGLE"},
    "Annie": {"time": "ORDER", "posicao": "MIDDLE"}, "Nilah": {"time": "ORDER", "posicao": "BOTTOM"},
    "Yuumi": {"time": "ORDER", "posicao": "UTILITY"}, "Riven": {"time": "CHAOS", "posicao": "TOP"},
    "Ekko": {"time": "CHAOS", "posicao": "JUNGLE"}, "Yasuo": {"time": "CHAOS", "posicao": "MIDDLE"},
    "Tristana": {"time": "CHAOS", "posicao": "BOTTOM"}, "Seraphine": {"time": "CHAOS", "posicao": "UTILITY"},
}
# pontos do mapa (unidades 0–14870); zona conferida pelas regras de docs/INSIGHTS.md
RIO_TOP = (4600, 9400)
MID = (7400, 7400)
TOP_ROTA = (1500, 11500)
TOP_ROTA_2 = (2200, 12400)
TOP_FUNDO = (3500, 13600)
SELVA_TOP_DELES = (7000, 11500)


class MolduraFalsa:
    def __init__(self):
        self.mostradas = []

    def mostrar(self, cor, rotulo):
        self.mostradas.append((cor, rotulo))


def caso(nome, ok, detalhe=""):
    resultados.append(ok)
    print(f"{'ok' if ok else 'FALHOU'}  {nome}" + (f"  ({detalhe})" if detalhe else ""))


def det(campeao, pos, t):
    return {"campeao": campeao, "time": JOGADORES[campeao]["time"], "x": pos[0], "y": pos[1], "visto_em": t}


def rodar(eu, roteiro, dur, quadros_invalidos=(), mortos=None, inicio=0, eventos=None, al_out=None, escolhas=None):
    """roteiro(t) -> lista de (campeao, pos) visíveis no quadro t. Devolve (motor, moldura, alertas).
    inicio: gameTime do 1º quadro ("mid sumiu" só vale na fase de rotas, 90–840 s); eventos(t) -> lista de
    eventos da Live Client; al_out: lista que recebe o AlertasPosicao (para ler `calados`); escolhas: kwargs de
    AlertasPosicao.configurar (filtro_mid, jungler_longe), as escolhas das Configurações."""
    moldura = MolduraFalsa()
    motor = MotorAvisos(textos=TEXTOS, moldura=moldura)
    al = AlertasPosicao(motor, eu, JOGADORES[eu]["time"], JOGADORES)
    if escolhas:
        al.configurar(**escolhas)
    if al_out is not None:
        al_out.append(al)
    saida = []
    for t in range(inicio, inicio + dur):
        t = float(t)
        valido = t not in quadros_invalidos
        dets = [det(c, p, t) for c, p in roteiro(t)] if valido else []
        for a in al.observar(dets, t, quadro_valido=valido, mortos=(mortos(t) if mortos else ()),
                             eventos=(eventos(t) if eventos else None)):
            saida.append((t, a))
        motor.tick(t)
    return motor, moldura, saida


def resumo(saida):
    return [(int(t), a.tipo, a.rotulo, a.cor) for t, a in saida]


def sem_repeticao(saida, janela=10):
    ult = {}
    for t, a in saida:
        if a.chave in ult and t - ult[a.chave] < janela:
            return False
        ult[a.chave] = t
    return True


def seq_a():
    # Ekko nunca visto até 12 s; aparece no rio top; pisca 1 s em 18 (não conta); some 20–29 e volta
    # ao rio top em 30 (mesma zona: o motor não repete em 20 s)
    def r(t):
        return [("Ekko", RIO_TOP)] if (12 <= t < 20 and t != 18) or t >= 30 else []
    m, mol, s = rodar("Zac", r, 40)
    ok = resumo(s) == [(12, "jungler_apareceu", "jungler rio top", "vermelho")] and sem_repeticao(s) \
        and mol.mostradas == [("vermelho", "jungler rio top")]
    caso("A. jungler aparece no rio top → 1 alerta vermelho", ok, f"{resumo(s)}; moldura {mol.mostradas}")


def seq_b():
    # Yasuo no mid 300–305, some 306–313 (8 s), reaparece no top em 314 (eu na selva: sem rota vigiada).
    # Em 300 s de jogo: o "mid sumiu" só vale na fase de rotas (90–840 s, calibração de 14/10/2026)
    def r(t):
        return [("Yasuo", MID)] if t <= 305 else [("Yasuo", TOP_ROTA)] if t >= 314 else []
    m, mol, s = rodar("Zac", r, 24, inicio=300)
    esp = [(311, "mid_sumiu", "mid sumiu", "amarelo"), (314, "mid_indo", "mid indo top", "amarelo")]
    caso("B. mid some 8 s e reaparece no top → 'mid sumiu' e 'mid indo top'", resumo(s) == esp and sem_repeticao(s),
         f"{resumo(s)}")


def seq_c():
    # eu = Illaoi (top). Riven (adversário) farmando na rota o tempo todo; Seraphine (suporte
    # inimigo) chega na rota top em 10 e fica
    def r(t):
        v = [("Riven", TOP_ROTA_2)]
        if t >= 10:
            v.append(("Seraphine", TOP_ROTA))
        return v
    m, mol, s = rodar("Illaoi", r, 25)
    ok = resumo(s) == [(10, "intruso", "intruso top", "amarelo")] and sem_repeticao(s)
    caso("C. suporte inimigo entra na rota top → 'intruso top' amarelo", ok, f"{resumo(s)}; fala {[a.fala for _, a in s]}")


def extra_jungler_na_rota():
    # eu top; Ekko aparece na minha rota → intruso vermelho e urgente (fura a fila da voz)
    def r(t):
        return [("Riven", TOP_ROTA_2)] + ([("Ekko", TOP_FUNDO)] if t >= 5 else [])
    m, mol, s = rodar("Illaoi", r, 12)
    a = s[0][1] if s else None
    # fala genérica (pacote de voz): diz "o jungler", nunca o campeão
    ok = (len(s) == 1 and a.tipo == "intruso" and a.cor == "vermelho" and a.urgente
          and a.fala == "o jungler chegando no top" and "Ekko" not in a.fala)
    caso("extra: jungler na minha rota → vermelho e urgente", ok, f"{resumo(s)}; fala {a and a.fala!r}")


def extra_dois_intrusos():
    def r(t):
        v = [("Riven", TOP_ROTA_2)]
        if t >= 5:
            v += [("Yasuo", TOP_ROTA), ("Tristana", TOP_FUNDO)]
        return v
    m, mol, s = rodar("Illaoi", r, 12)
    ok = [x[1:] for x in resumo(s)][-1:] == [("intruso_grupo", "2 inimigos top", "vermelho")] and \
        mol.mostradas and mol.mostradas[0][0] in ("amarelo", "vermelho") and mol.mostradas[-1] == ("vermelho", "2 inimigos top")
    caso("extra: 2 intrusos juntos → '2 inimigos top' vermelho", ok, f"{resumo(s)}; moldura {mol.mostradas}")


def extra_adversario_voltou():
    # Riven na rota 0–5, base (sumida) 6–39, volta à rota em 40 → azul; piscar curto não conta
    def r(t):
        return [("Riven", TOP_ROTA_2)] if t <= 5 or t >= 40 or t == 8 else []
    m, mol, s = rodar("Illaoi", r, 45)
    ok = resumo(s) == [(40, "adversario_voltou", "Riven voltou", "azul")]
    caso("extra: adversário volta da base → 'Riven voltou' azul", ok, f"{resumo(s)}")


def relato_3293149183_voltou():
    """partida 3293149183 (14/10/2026): "eu morto e sendo avisado que o malphite voltou pra lane"; "se eu estiver na
    base ou morto, não faz sentido avisar [...] tem que avisar se voltou e em qual lane voltou"; "mesma coisa para
    todas as lanes". O adversário da MINHA rota (champ select) sumido ≥ 20 s e de volta perto de uma rota."""
    BASE_EU = (600, 600)

    def volta(rival, onde, eu=None, eu_pos=TOP_ROTA, casa=TOP_ROTA_2):
        """o rival na rota dele até 5 s, some (base) e reaparece em `onde` aos 40"""
        def r(t):
            v = [(eu, eu_pos)] if eu else []
            return v + ([(rival, casa)] if t <= 5 else [(rival, onde)] if t >= 40 else [])
        return r
    # 1. eu morto (6–45), Riven volta ao top em 40: calado (antes: "Riven voltou" com a reserva = top)
    al1 = []
    m, mol, s = rodar("Illaoi", volta("Riven", TOP_ROTA_2), 45, mortos=lambda t: {"Illaoi"} if t >= 6 else set(),
                      al_out=al1)
    caso("3293149183: eu morto e o adversário volta à rota dele → calado", s == [] and al1[0].calados["voltou_eu_fora"] == 1,
         f"{resumo(s)}; calados {dict(al1[0].calados)}")
    # 2. eu na base (ícone visto na fonte): calado
    m, mol, s = rodar("Illaoi", volta("Riven", TOP_ROTA_2, "Illaoi", BASE_EU), 45)
    caso("3293149183: eu na base e o adversário volta → calado", s == [], f"{resumo(s)}")
    # 3. eu na rota: avisa (como antes), azul, fala genérica
    m, mol, s = rodar("Illaoi", volta("Riven", TOP_ROTA_2, "Illaoi", TOP_ROTA), 45)
    caso("3293149183: eu na rota e ele volta a ela → 'o top voltou pra rota' (azul)",
         resumo(s) == [(40, "adversario_voltou", "Riven voltou", "azul")] and s[0][1].fala == "o top voltou pra rota",
         f"{resumo(s)}; fala {[a.fala for _, a in s]}")
    # 4. eu no top, ele reaparece no mid: diz a rota
    m, mol, s = rodar("Illaoi", volta("Riven", MID, "Illaoi", TOP_ROTA), 45)
    caso("3293149183: o top reaparece no mid → 'o top apareceu no mid' (rótulo 'Riven mid')",
         resumo(s) == [(40, "adversario_voltou", "Riven mid", "azul")] and s[0][1].fala == "o top apareceu no mid",
         f"{resumo(s)}; fala {[a.fala for _, a in s]}")
    # 5. eu mid (Annie): o mid deles some e reaparece no top. Na fase de rotas o "mid sumiu"/"mid indo top" já diz
    #    para onde (sem "apareceu" em dobro); depois dela (revisão P5: todos agrupam no mid) fica calado
    def mid_roda(t0):
        return lambda t: [("Annie", MID)] + ([("Yasuo", MID)] if t < t0 + 6 else
                                             [("Yasuo", TOP_ROTA)] if t >= t0 + 40 else [])
    m, mol, s = rodar("Annie", mid_roda(300), 45, inicio=300)
    caso("3293149183: eu mid na fase de rotas, o mid deles vai ao top → 'mid indo' (não 'apareceu' em dobro)",
         "mid_indo" in [a.tipo for _, a in s] and "adversario_voltou" not in [a.tipo for _, a in s], f"{resumo(s)}")
    al5 = []
    m, mol, s = rodar("Annie", mid_roda(1000), 45, inicio=1000, al_out=al5)
    caso("revisão P5: depois da fase de rotas (16:40) o mid reaparecendo no top fica calado",
         s == [] and al5[0].calados["voltou_fim_das_rotas"] == 1, f"{resumo(s)}; {dict(al5[0].calados)}")
    # 5b. revisão P4: o top deles reaparece no rio entre mid e bot, mais perto do mid: "no mid" (antes: "no bot",
    #     a 1ª rota do alfabeto)
    m, mol, s = rodar("Illaoi", volta("Riven", (6250, 3750), "Illaoi", TOP_ROTA), 45)
    caso("revisão P4: rival entre duas rotas sai na de centro mais perto → 'o top apareceu no mid'",
         [a.fala for _, a in s if a.tipo == "adversario_voltou"] == ["o top apareceu no mid"], f"{resumo(s)}")
    # 6. eu atirador no bot: a Tristana (moradora do bot) reaparece no mid
    m, mol, s = rodar("Nilah", volta("Tristana", MID, "Nilah", BOT_EU, BOT_TRISTANA), 45)
    caso("3293149183: eu bot, o atirador deles reaparece no mid → 'o atirador apareceu no mid'",
         [(a.tipo, a.fala) for _, a in s] == [("adversario_voltou", "o atirador apareceu no mid")], f"{resumo(s)}")
    # 7. lado oposto: eu no mid (rotação), a Riven chega no mid = intruso (perigo), não o recado azul
    m, mol, s = rodar("Illaoi", volta("Riven", MID, "Illaoi", MID), 45)
    caso("3293149183: o adversário chega na rota onde EU estou → intruso, não 'apareceu'",
         [a.tipo for _, a in s] == ["intruso"], f"{resumo(s)}")
    # 8. a fala nova está no catálogo do pacote de voz (cai na Maria até a tarefa gravar)
    import avisos
    cat = set(avisos.catalogo())
    caso("3293149183: 'o top apareceu no mid' e 'o atirador apareceu no top' estão no catálogo",
         {"o top apareceu no mid", "o atirador apareceu no top"} <= cat, f"{len(cat)} falas")


def relato_3293149183_rajada():
    """partida 3293149183 (14/10/2026), ~15 min: "recebi um gank de umas duas pessoas diferentes e as bordas começaram a
    piscar em diferentes cores". As molduras do log (tipo, cor, prio e urgência como o AlertasPosicao publica), nos
    mesmos instantes. Regra: uma borda por vez, ≥ INTERVALO_MOLDURA entre elas; dentro dele só fura urgente de prio
    estritamente maior (a cor só sobe); nunca azul/amarela logo depois de vermelha."""
    def aviso(tipo, cor, chave, prio=None, urgente=None):
        return Aviso(tipo, {"zona": "no top", "zc": "top", "zt": "top", "n": 2, "campeao": "Malphite",
                            "rota": "jungler"}, chave, cor=cor, prio=prio, urgente=urgente)
    # 16:02:40,979 ... 16:03:32,458 (t = segundos desde a 1ª) e 16:12:42,842 ... 16:12:57,945 (+ 600 s)
    rajadas = [
        (0.0, aviso("gank", "vermelho", "top")),
        (12.1, aviso("intruso", "vermelho", "j1", 95, True)),
        (20.2, aviso("intruso_grupo", "vermelho", "top")),
        (32.3, aviso("intruso", "vermelho", "j2", 95, True)),
        (38.3, aviso("intruso_grupo", "vermelho", "top2")),
        (48.4, aviso("adversario_voltou", "azul", "Malphite")),
        (51.5, aviso("intruso", "amarelo", "mid1")),
        (600.0, aviso("jungler_apareceu", "vermelho", "base deles")),
        (601.0, aviso("intruso", "vermelho", "j3", 95, True)),
        (610.1, aviso("gank", "vermelho", "bot")),
        (614.1, aviso("intruso", "amarelo", "sup")),
        (615.1, aviso("intruso_grupo", "vermelho", "bot")),
    ]
    mol = MolduraFalsa()
    m = MotorAvisos(textos=TEXTOS, moldura=mol)
    fila = list(rajadas)
    t = 0.0
    while t <= 640.0:
        while fila and fila[0][0] <= t + 1e-9:
            m.publicar(fila.pop(0)[1], t)
        m.tick(t)
        t = round(t + 0.1, 1)
    bordas = [(round(em, 1), a.cor, a.prio, a.urgente) for em, d, a in m.emitidos if d == "moldura"]
    ruins = []
    intervalo = getattr(MotorAvisos, "INTERVALO_MOLDURA", 10.0)   # o código de antes não tinha (prova vermelha)
    grav = {"azul": 0, "verde": 1, "amarelo": 2, "vermelho": 3}
    for (t0, c0, p0, _), (t1, c1, p1, u1) in zip(bordas, bordas[1:]):
        # dentro do intervalo: só prio maior sem a cor descer, ou a MESMA cor depois da borda anterior acabar
        if t1 - t0 < intervalo and not ((p1 > p0 and grav[c1] >= grav[c0]) or (c1 == c0 and t1 - t0 >= 2.5)):
            ruins.append((t0, c0, t1, c1))
        if t1 - t0 < intervalo and grav[c1] < grav[c0]:
            ruins.append((t0, c0, t1, c1))
    trocas = sum(1 for (t0, c0, *_), (t1, c1, *_) in zip(bordas, bordas[1:]) if t1 - t0 < intervalo and c1 != c0)
    caso("3293149183: rajada de bordas (16:02:40–16:03:32): dentro de 10 s a cor só sobe e a mesma cor só repete "
         "depois da borda anterior acabar",
         not ruins and trocas <= 1 and len(bordas) < len(rajadas),
         f"{len(bordas)} bordas de {len(rajadas)}, {trocas} troca(s) de cor em < 10 s: {bordas}; ruins {ruins}")
    seg = [b for b in bordas if b[0] >= 600]
    caso("3293149183: 16:12:42–57 sem amarela entre vermelhas (o gank de 2 vence)",
         [b[1] for b in seg] and all(c == "vermelho" for _, c, _, _ in seg), f"{seg}")
    # lado oposto: o gank que chega logo depois de um recado azul aparece na hora (prio maior e urgente)
    mol2 = MolduraFalsa()
    m2 = MotorAvisos(textos=TEXTOS, moldura=mol2)
    m2.publicar(aviso("adversario_voltou", "azul", "x"), 0.0)
    m2.publicar(aviso("gank", "vermelho", "top"), 1.0)
    caso("3293149183: gank 1 s depois de uma borda azul sai na hora (não espera o intervalo)",
         mol2.mostradas == [("azul", "Malphite voltou"), ("vermelho", "gank top")], str(mol2.mostradas))

    def cena(passos, ate=12.0):
        """[(t, Aviso)] num motor novo, tique de 0,1 s -> (bordas [(t, cor, rotulo)], suprimidos)"""
        mm = MotorAvisos(textos=TEXTOS, moldura=MolduraFalsa())
        fila_c, tt = sorted(passos, key=lambda p: p[0]), 0.0
        while tt <= ate:
            while fila_c and fila_c[0][0] <= tt + 1e-9:
                mm.publicar(fila_c.pop(0)[1], tt)
            mm.tick(tt)
            tt = round(tt + 0.1, 1)
        return [(round(em, 1), a.cor, a.rotulo) for em, d, a in mm.emitidos if d == "moldura"], mm.suprimidos
    # revisão P1: intruso AMARELO (prio 85, não urgente) 1 s depois do "voltou" azul: antes calado (vencia esperando
    # os 10 s, só urgente furava); agora sai na hora (prio maior, a cor sobe)
    b, sup = cena([(0.0, aviso("adversario_voltou", "azul", "x")), (1.0, aviso("intruso", "amarelo", "sup"))])
    caso("revisão P1: intruso amarelo 1 s depois de um 'voltou' azul aparece na hora (não morre na fila)",
         [(t, c) for t, c, _ in b] == [(0.0, "azul"), (1.0, "amarelo")] and not sup["vencido"], f"{b}; {dict(sup)}")
    # revisão P2: "gank de umas duas pessoas": gank em 0 e o 2º (intruso_grupo, prio 95 < 100) em 4: sai em 4,
    # vermelho de novo (mesma cor, a borda anterior já acabou); e o 2º gank 1 s depois sai assim que a 1ª acaba
    b, sup = cena([(0.0, aviso("gank", "vermelho", "top")), (4.0, aviso("intruso_grupo", "vermelho", "top"))])
    caso("revisão P2: 2º perigo vermelho 4 s depois do gank sai em 4 s (antes: 10 s, ou calado)",
         [(t, c) for t, c, _ in b] == [(0.0, "vermelho"), (4.0, "vermelho")], f"{b}; {dict(sup)}")
    b, sup = cena([(0.0, aviso("gank", "vermelho", "top")), (1.0, aviso("gank", "vermelho", "bot"))])
    caso("revisão P2: 2º gank 1 s depois sai quando a 1ª borda acaba (2,5 s), sem trocar de cor",
         [(t, c) for t, c, _ in b] == [(0.0, "vermelho"), (2.5, "vermelho")], f"{b}; {dict(sup)}")
    # lado oposto: a cor não desce dentro do intervalo (jungler vermelho 80 -> intruso amarelo 85 cai), e o que
    # esperou além de IDADE_MOLDURA não vai à tela velho (gank de outra rota: validade 22 s para a voz)
    b, sup = cena([(0.0, aviso("jungler_apareceu", "vermelho", "rio")), (1.0, aviso("intruso", "amarelo", "sup"))])
    caso("revisão P1 (lado oposto): vermelha -> amarela dentro de 10 s não sai (a cor só sobe)",
         [(t, c) for t, c, _ in b] == [(0.0, "vermelho")], f"{b}; {dict(sup)}")
    outra = Aviso("gank", {"zona": "no bot", "zc": "bot", "zt": "bot"}, "outra:bot", prio=75, urgente=False,
                  cor="amarelo", validade=22)
    b, sup = cena([(0.0, aviso("jungler_apareceu", "vermelho", "rio")), (1.0, outra)], ate=25.0)
    caso("revisão P2: alerta de posição que esperou > IDADE_MOLDURA na borda cai (não aparece velho aos 10 s)",
         [(t, c) for t, c, _ in b] == [(0.0, "vermelho")] and sup["moldura_velho"] == 1, f"{b}; {dict(sup)}")


def relato_3293149183_moldura():
    """partida 3293149183 (14/10/2026): "um fade transparente em direção ao centro da tela [...] sai da borda colorido
    e vai em direção ao centro de forma transparente. e cores levemente mais escurecidas." Desenho puro (sem janela):
    beirada cheia na cor escurecida (lição do overlay: degradê não pode apagar o desenho), alfa caindo até 0 no
    miolo, rótulo opaco e legível; custo medido no tamanho da tela do Gabriel."""
    import numpy as np

    import moldura
    W, H, e = 2560, 1080, moldura.Moldura.ESPESSURA
    t0 = time.perf_counter()
    img = moldura.renderizar(W, H, "vermelho", "gank no top", e)
    bgra = moldura.premultiplicar(img) if img.shape[2] == 4 else None
    ms = (time.perf_counter() - t0) * 1000
    rgba = img.shape[2] == 4
    caso("moldura: RGBA (alfa por px, UpdateLayeredWindow) em vez da cor-chave", rgba, f"forma {img.shape}")
    if not rgba:
        return
    a = img[..., 3].astype(int)
    linha = a[H // 2, :W // 2]                       # da beirada esquerda ao centro
    escura = moldura.CORES_MOLDURA["vermelho"]
    caso("moldura: beirada de ESPESSURA px na cor cheia (alfa 255) e escurecida, também no rótulo",
         (a[:e, W // 2] == 255).all() and (a[H // 2, :e] == 255).all() and tuple(img[3, W // 2, :3]) == escura
         and all(c2 < c1 for c1, c2 in zip(moldura.CORES["vermelho"], escura) if c1 > 60)
         and tuple(img[e + 30, e + 30]) == (*escura, 255),
         f"beirada {a[0, W // 2]}..{a[e - 1, W // 2]}, cor {tuple(img[3, W // 2, :3])} (antes {moldura.CORES['vermelho']})")
    fade = int(moldura.FADE * min(W, H))
    caso("moldura: degradê para o centro (alfa nunca sobe, começa forte logo depois da beirada, 0 no miolo)",
         bool(np.all(np.diff(linha) <= 0)) and linha[e] >= 128 and 0 < linha[e + fade // 2] < linha[e]
         and linha[e + fade + 1] == 0 and a[H // 2, W // 2] == 0,
         f"alfa {linha[e]} logo dentro, {linha[e + fade // 2]} no meio do degradê ({fade} px), {linha[e + fade + 1]} depois")
    # revisão P7: o pulso é o alfa da janela inteira; no vale a beirada não pode apagar (com 0,45: 115 de 255 numa cor
    # já escurecida, o azul sumia no mapa escuro)
    piso = getattr(moldura, "PULSO_MIN", 0.45)
    caso("moldura: no vale do pulso a beirada fica ≥ 150 de 255 e o começo do degradê ≥ 0,35",
         255 * piso >= 150 and moldura.FADE_INICIO * piso >= 0.35,
         f"beirada {255 * piso:.0f}, degradê {moldura.FADE_INICIO * piso:.2f} no vale")
    texto = (a == 255) & np.all(img[..., :3] > 200, axis=2)
    caso("moldura: rótulo em caixa opaca com texto (branco no vermelho)", int(texto.sum()) > 300, f"{int(texto.sum())} px")
    amarelo = moldura.renderizar(400, 200, "amarelo", "intruso top", e)
    escuro = (amarelo[..., 3] == 255) & np.all(amarelo[..., :3] < 40, axis=2)
    caso("moldura: rótulo escuro no amarelo", int(escuro.sum()) > 100, f"{int(escuro.sum())} px")
    t1 = time.perf_counter()
    moldura.premultiplicar(moldura.renderizar(W, H, "azul", "jungler rio top", e))
    ms2 = (time.perf_counter() - t1) * 1000
    caso("moldura: custo por alerta em 2560×1080 (fio da moldura, 1 vez por alerta; o pulso não redesenha)",
         ms2 < 150 and bgra is not None, f"1º {ms:.0f} ms (monta o degradê), depois {ms2:.0f} ms")


def extra_pausa():
    # Yasuo no mid até 5; jogo fora da tela 6–30 (morto, trocou de janela): nada de 'mid sumiu' sobre
    # quadro inválido; volta em 31 com Ekko no rio top: 2 s só observando (sem alerta), depois normal
    def r(t):
        v = [("Yasuo", MID)] if t <= 5 or t >= 31 else []
        if t >= 31:
            v.append(("Ekko", RIO_TOP))
        return v
    m, mol, s = rodar("Zac", r, 45, quadros_invalidos=set(float(x) for x in range(6, 31)))
    caso("extra: jogo fora da tela pausa os alertas (e 2 s de ressincronia)", s == [], f"{resumo(s)}")


def extra_lista_acumulada():
    # a sequência A no formato do minimapa.Captura.deteccoes(): última posição de cada um (com o
    # visto_em antigo quando some) → mesmo resultado que a lista só do quadro
    moldura = MolduraFalsa()
    motor = MotorAvisos(textos=TEXTOS, moldura=moldura)
    al = AlertasPosicao(motor, "Zac", "ORDER", JOGADORES)
    ultimas, saida = {}, []
    for t in range(40):
        t = float(t)
        if (12 <= t < 20 and t != 18) or t >= 30:
            ultimas["Ekko"] = det("Ekko", RIO_TOP, t)
        saida += [(t, a) for a in al.observar(list(ultimas.values()), t)]
        motor.tick(t)
    caso("extra: lista de última posição (Captura.deteccoes) = lista do quadro",
         resumo(saida) == [(12, "jungler_apareceu", "jungler rio top", "vermelho")], f"{resumo(saida)}")


def extra_morto():
    # Yasuo morre em 6 (Live Client isDead): sumir do minimapa não vira 'mid sumiu'
    def r(t):
        return [("Yasuo", MID)] if t <= 5 else []
    m, mol, s = rodar("Zac", r, 30, mortos=lambda t: {"Yasuo"} if t >= 6 else set())
    caso("extra: inimigo morto não 'some'", s == [], f"{resumo(s)}")


BOT_TRISTANA, BOT_SERAPHINE, BOT_EU = (10600, 1300), (10900, 1100), (10000, 1700)


def extra_eu_entro_na_rota():
    # revisão 13/10/2026: eu (Zac, selva) entro na rota bot onde Tristana e Seraphine já estavam (vistas por
    # aliados desde o início): quem chegou fui eu, não eles → nada. E os moradores do bot que só aparecem
    # quando eu chego (eu trago a visão) também não são intrusos.
    def r(t):
        return [("Tristana", BOT_TRISTANA), ("Seraphine", BOT_SERAPHINE), ("Zac", (7000, 4000) if t < 20 else BOT_EU)]
    m, mol, s = rodar("Zac", r, 40)

    def r2(t):
        return [("Zac", (7000, 4000) if t < 20 else BOT_EU)] + \
            ([("Tristana", BOT_TRISTANA), ("Seraphine", BOT_SERAPHINE)] if t >= 21 else [])
    m2, mol2, s2 = rodar("Zac", r2, 40)
    caso("extra: eu entro numa rota com inimigos parados nela (ou trago a visão) → nada", s == [] and s2 == [],
         f"parados {resumo(s)}; na fog {resumo(s2)}")


def extra_contra_gank():
    # eu = Zac (selva) na rota bot; o Ekko (jungler deles) chega nela depois de 25 s ou de 10 s fora de vista
    # → vermelho urgente (antes: 'Ekko voltou pra rota' azul, ou nada)
    def roteiro(fora):
        def r(t):
            v = [("Zac", BOT_EU)]
            if t == 2:
                v.append(("Ekko", (9000, 9000)))
            if t >= 2 + fora:
                v.append(("Ekko", (9800, 2200)))
            return v
        return r
    res = []
    for fora in (25, 10):
        m, mol, s = rodar("Zac", roteiro(fora), 2 + fora + 5)
        res.append([(x[1], x[3], a.urgente) for x, (_, a) in zip(resumo(s), s) if x[0] == 2 + fora])
    caso("extra: contra-gank (eu jungler numa rota, jungler deles chega) → vermelho urgente",
         res == [[("intruso", "vermelho", True)]] * 2, f"{res}")


# ---------- calibração de 14/10/2026 (roadmap/2026-10-14-calibrar-avisos.md) ----------
BASE_MINHA = (2500, 2000)            # base ORDER (azul)
SELVA_BOT_DELES = (11000, 7000)      # selva CHAOS, metade bot
RIO_BOT = (9400, 4600)
SELVA_TOP_ORDER, SELVA_BOT_ORDER = (3500, 7000), (9000, 3500)
BOT_ROTA = (12000, 1500)


def destinos_de(motor, aviso):
    return sorted({d for _, d, a in motor.emitidos if a is aviso})


def calib_jungler_onde_estou():
    """jungler só com voz e borda quando importa para onde o Gabriel ESTÁ (ícone), senão só o painel"""
    def caso_j(eu, eu_pos, jg, jg_pos):
        def r(t):
            v = [(eu, eu_pos)] if eu_pos else []
            return v + ([(jg, jg_pos)] if t >= 12 else [])
        m, mol, s = rodar(eu, r, 15)
        a = s[0][1] if len(s) == 1 else None
        # o longe vai ao painel ABAIXO das informativas: um "dragão em um minuto" na faixa continua lá
        m.publicar(Aviso("objetivo_60s", {"objetivo": "dragão"}, "d"), 14.0)
        faixa = (m.painel(14.0) or {}).get("tipo")
        return a and (a.tipo, a.destinos, a.cor, destinos_de(m, a), faixa)
    longe = ("jungler_apareceu", "p", "azul", [], "objetivo_60s")
    perto = ("jungler_apareceu", "vpm", "vermelho", ["moldura", "voz"], "jungler_apareceu")
    SELVA_TOP_DELES, SELVA_TOP_ORDER = (8000, 10500), (4500, 6500)   # longe da faixa das rotas (não é intruso)
    tabela = [
        ("top no top, jungler na selva bot deles → só painel", ("Illaoi", TOP_ROTA, "Ekko", SELVA_BOT_DELES), longe),
        ("top no top, jungler no rio bot → só painel", ("Illaoi", TOP_ROTA, "Ekko", RIO_BOT), longe),
        ("top no top, jungler na selva top deles → voz e borda", ("Illaoi", TOP_ROTA, "Ekko", SELVA_TOP_DELES), perto),
        ("top andando no mid, jungler no rio bot → voz e borda", ("Illaoi", MID, "Ekko", RIO_BOT), perto),
        ("top sem ícone (reserva: rota do champ select), rio bot → só painel", ("Illaoi", None, "Ekko", RIO_BOT), longe),
        ("top sem ícone, selva top deles → voz e borda", ("Illaoi", None, "Ekko", SELVA_TOP_DELES), perto),
        ("espelho: top CHAOS no top, jungler ORDER na selva bot dele → só painel",
         ("Riven", TOP_ROTA, "Zac", SELVA_BOT_ORDER), longe),
        ("espelho: top CHAOS no top, jungler ORDER na selva top dele → voz e borda",
         ("Riven", TOP_ROTA, "Zac", SELVA_TOP_ORDER), perto),
        # revisão 14/10/2026 (D11): de selva, o jungler deles importa no mapa todo (invasão, objetivo)
        ("eu jungler na minha selva, jungler deles na selva bot dele (longe) → voz e borda",
         ("Zac", (3800, 7800), "Ekko", SELVA_BOT_DELES), perto),
    ]
    for nome, args, esp in tabela:
        got = caso_j(*args)
        caso(f"14/10 jungler: {nome}", got == esp, f"{got}")


def calib_mid_sumiu():
    """'mid sumiu' só na fase de rotas, sem cerco/luta/eu morto/eu na base, teto 4 e 120 s entre eles"""
    def some_em(t_some):
        return lambda t: [("Yasuo", MID)] if t < t_some else []

    def um(nome, eu, roteiro, inicio, dur, motivo, mortos=None, eventos=None):
        al = []
        m, mol, s = rodar(eu, roteiro, dur, inicio=inicio, mortos=mortos, eventos=eventos, al_out=al)
        sumiu = [x for x in resumo(s) if x[1] == "mid_sumiu"]
        caso(f"14/10 mid sumiu calado: {nome}", not sumiu and al[0].calados.get(motivo) == 1,
             f"{sumiu}; calados {dict(al[0].calados)}")

    um("aos 0:20 (minions nem chegaram)", "Illaoi", some_em(26), 20, 15, "cedo")
    um("aos 22 min (fim da fase de rotas)", "Illaoi", some_em(1325), 1320, 15, "fim_das_rotas")
    um("torre externa do mid caiu", "Illaoi", some_em(605), 600, 15, "torre_do_mid",
       eventos=lambda t: [{"EventID": 1, "EventName": "TurretKilled", "TurretKilled": "Turret_TChaos_L1_P3_2254202041_0"}])
    um("eu morto", "Illaoi", lambda t: some_em(605)(t) + [("Illaoi", TOP_ROTA)], 600, 15, "eu_morto",
       mortos=lambda t: {"Illaoi"} if t >= 606 else set())
    um("eu na minha base", "Illaoi", lambda t: some_em(605)(t) + [("Illaoi", BASE_MINHA)], 600, 15, "eu_na_base")
    um("2 inimigos na minha base (cerco)", "Illaoi",
       lambda t: some_em(605)(t) + [("Riven", BASE_MINHA), ("Tristana", (3000, 2500))], 600, 15, "cerco")
    um("inibidor meu caiu (cerco)", "Illaoi", some_em(605), 600, 15, "cerco",
       eventos=lambda t: [{"EventID": 9, "EventName": "InhibKilled", "InhibKilled": "Inhib_TOrder_L1_P1_1931666598_0"}])
    um("3 inimigos à vista (luta)", "Illaoi",
       lambda t: some_em(605)(t) + [("Riven", TOP_ROTA_2), ("Ekko", TOP_FUNDO), ("Seraphine", TOP_ROTA)], 600, 15, "luta")
    um("visto por último na selva dele (já estava fundo)", "Illaoi",
       lambda t: [("Yasuo", MID if t < 600 else (8000, 10500))] if t < 605 else [], 595, 20, "fora_da_rota")

    def avisa(nome, roteiro):
        al = []
        m, mol, s = rodar("Illaoi", roteiro, 20, inicio=595, al_out=al)
        sumiu = [x for x in resumo(s) if x[1] == "mid_sumiu"]
        caso(f"14/10 mid sumiu AVISA: {nome}", len(sumiu) == 1 and not al[0].calados, f"{sumiu}; calados {dict(al[0].calados)}")

    # revisão: top, mid e dupla do bot à vista, cada um na sua rota, é a fase de rotas normal (não é luta)
    avisa("top, mid e dupla do bot à vista cada um na sua rota (não é luta)",
          lambda t: [("Riven", TOP_ROTA_2), ("Tristana", BOT_TRISTANA), ("Seraphine", BOT_SERAPHINE)]
          + ([("Yasuo", MID)] if t < 600 else []))
    avisa("entrou na moita do rio e sumiu (o roam clássico)",
          lambda t: [("Yasuo", MID if t < 598 else RIO_TOP)] if t < 600 else [])

    # o mid some 10 s a cada 40 s de 100 a 840: 18 sumiços → no máximo 4, a ≥ 120 s um do outro, voz e borda iguais
    m, mol, s = rodar("Illaoi", lambda t: [("Yasuo", MID)] if (t % 40) < 30 else [], 740, inicio=100)
    ts = [t for t, a in s if a.tipo == "mid_sumiu"]
    bordas = [r for c, r in mol.mostradas if r == "mid sumiu"]
    caso("14/10 mid sumiu: teto 4 por partida e 120 s entre eles (18 sumiços na fase de rotas)",
         len(ts) == 4 and all(b - a >= 120 for a, b in zip(ts, ts[1:])) and len(bordas) == 4,
         f"aceitos em {ts}; bordas {len(bordas)}; suprimidos {dict(m.suprimidos)}")

    # revisão 14/10/2026 (P1): o "mid indo X" não depende de o motor ACEITAR o "mid sumiu". Sumiço aos 116 s
    # (aceito), volta ao mid, some de novo (barrado pelo intervalo de 120 s) e reaparece no bot aos 200 s
    def roam(destino):
        return lambda t: [("Yasuo", MID)] if t <= 110 or 130 <= t <= 150 else [("Yasuo", destino)] if t >= 200 else []
    m, mol, s = rodar("Illaoi", roam((11500, 1500)), 140, inicio=100)
    caso("14/10 mid indo: sai com o 2º 'mid sumiu' barrado pelo intervalo (roam para o bot, recado aos colegas)",
         [(int(t), a.tipo) for t, a in s] == [(116, "mid_sumiu"), (200, "mid_indo")] and m.suprimidos["intervalo"] == 1,
         f"{resumo(s)}; suprimidos {dict(m.suprimidos)}")
    # calado por LUTA (3 inimigos juntos no bot: a dupla e o jungler deles), o mid reaparece no bot: "mid indo bot"
    luta = [("Tristana", BOT_TRISTANA), ("Seraphine", BOT_SERAPHINE), ("Ekko", (BOT_TRISTANA[0] - 800, BOT_TRISTANA[1] + 600))]
    al = []
    m, mol, s = rodar("Illaoi", lambda t: luta + ([("Yasuo", MID)] if t < 600 else [("Yasuo", (11500, 1500))] if t >= 620 else []),
                      30, inicio=595, al_out=al)
    caso("14/10 mid indo: o 'sumiu' calado por luta ainda libera o 'mid indo bot' (o mid indo para a luta)",
         [a.tipo for _, a in s if a.tipo in ("mid_sumiu", "mid_indo")] == ["mid_indo"] and al[0].calados.get("luta") == 1,
         f"{resumo(s)}; calados {dict(al[0].calados)}")
    # calado por FIM DA FASE DE ROTAS (22 min): nem "sumiu" nem "mid indo" depois
    m, mol, s = rodar("Illaoi", lambda t: [("Yasuo", MID)] if t < 1325 else [("Yasuo", (11500, 1500))] if t >= 1345 else [],
                      30, inicio=1320)
    caso("14/10 mid indo: depois de 14:00 nem 'sumiu' nem 'mid indo' (o roam no meio de jogo não é notícia)",
         not [a for _, a in s if a.tipo in ("mid_sumiu", "mid_indo")], f"{resumo(s)}")

    # mid morre no mid, renasce e passa pela selva dele: nem "sumiu" nem "mid indo"
    def r(t):
        return [("Yasuo", MID)] if t <= 605 else [("Yasuo", (8000, 10500))] if t >= 640 else []   # selva dele
    m, mol, s = rodar("Illaoi", r, 50, inicio=600, mortos=lambda t: {"Yasuo"} if 606 <= t < 640 else set())
    caso("14/10 mid morto que renasce e passa pela selva: nem 'sumiu' nem 'mid indo'", s == [], f"{resumo(s)}")


def calib_gank():
    """gank de onde estou (urgente) e de outra rota com aliado nela (amarelo, sem urgência)"""
    from avisos import decidir_gank, catalogo

    def montar(eu_pos, aliados=(), mortos=()):
        motor = MotorAvisos(textos=TEXTOS, moldura=MolduraFalsa())
        al = AlertasPosicao(motor, "Illaoi", "ORDER", JOGADORES)
        dets = ([det("Illaoi", eu_pos, 500.0)] if eu_pos else []) + [det(n, p, 500.0) for n, p in aliados]
        al.observar(dets, 500.0, mortos=mortos)
        return motor, al

    def gank_de(*rotas):
        chamadas = []

        def g(rota, alvo):
            chamadas.append((rota, alvo))
            return {"prob": 0.6 + 0.1 * rotas.index(rota)} if rota in rotas else None
        return g, chamadas

    def roda(nome, eu_pos, rotas, esp, aliados=(), mortos=()):
        motor, al = montar(eu_pos, aliados, mortos)
        g, ch = gank_de(*rotas)
        a = decidir_gank(g, al, agora=500.0)
        got = None
        if a is not None:
            motor.publicar(a, 500.0)
            got = (a.zc if "zc" in a.__dict__ else a.dados["zc"], a.cor, a.urgente, a.prio, a.fala)
        caso(f"14/10 gank: {nome}", got == esp, f"{got}; chamadas {ch}")
        return ch

    fala_cat = set(catalogo())
    roda("eu no top, gank no top → urgente vermelho", TOP_ROTA, ("top",),
         ("top", "vermelho", True, 100, "gank provável no top"))
    roda("eu andando no mid → o gank é do mid, não do top do champ select", MID, ("mid", "top"),
         ("mid", "vermelho", True, 100, "gank provável no mid"))
    roda("eu sem ícone → rota do champ select (reserva)", None, ("top",),
         ("top", "vermelho", True, 100, "gank provável no top"))
    roda("gank no bot com aliado no bot, eu no top → amarelo, prio 75, sem urgência", TOP_ROTA, ("bot",),
         ("bot", "amarelo", False, 75, "gank provável no bot"), aliados=[("Nilah", BOT_ROTA)])
    roda("gank no bot sem aliado visto no bot → nada", TOP_ROTA, ("bot",), None)
    roda("minha rota vence a outra (top e mid com aliado no mid)", TOP_ROTA, ("mid", "top"),
              ("top", "vermelho", True, 100, "gank provável no top"), aliados=[("Annie", MID)])
    roda("eu morto: minha rota não é alvo; sem aliado lá, nada", TOP_ROTA, ("top",), None, mortos={"Illaoi"})
    roda("eu na base: outra rota com aliado ainda fala", BASE_MINHA, ("bot",),
         ("bot", "amarelo", False, 75, "gank provável no bot"), aliados=[("Nilah", BOT_ROTA)])
    # revisão 14/10/2026 (P2): split push na torre do inibidor top deles (dentro do raio da base inimiga): a rota
    # onde estou é o top (antes: nenhuma, e o gank sumia); no meio da base deles (nexo), nenhuma
    roda("split push na torre do inibidor top deles → gank no top urgente", (10481, 13650), ("top",),
         ("top", "vermelho", True, 100, "gank provável no top"))
    roda("perto do nexo deles (as 3 faixas se cruzam) → nenhuma rota minha", (13300, 13400), ("top",), None)
    # revisão (P3): 2 aliados no bot; o jungler.gank só aceita o adiantado. Antes o 1º em ordem alfabética
    # (Nilah, atrás) reprovava e o aviso sumia; agora cada aliado é tentado, o mais adiantado primeiro
    motor, al = montar(TOP_ROTA, [("Nilah", (6000, 1200)), ("Yuumi", (11800, 3000))])
    ch = []

    def so_adiantado(rota, alvo):
        ch.append((rota, alvo))
        return {"prob": 0.7} if rota == "bot" and alvo is not None and alvo[0] > 7400 else None
    a = decidir_gank(so_adiantado, al, agora=500.0)
    caso("14/10 gank: outra rota com 2 aliados, só o adiantado passa → avisa (testa o mais adiantado primeiro)",
         a is not None and a.dados["zc"] == "bot" and ch[1:2] == [("bot", (11800.0, 3000.0))],
         f"{a and a.dados}; chamadas {ch}")
    caso("14/10 gank: as falas das 3 rotas estão no catálogo do pacote (nenhuma frase nova)",
         {"gank provável no top", "gank provável no mid", "gank provável no bot"} <= fala_cat)


def revisao_3293137136():
    """relato do Gabriel depois da partida 3293137136 (14/10/2026, ~15:08): "4 inimigos no top" com só o mid deles
    no top (dois na base do mid deles, um no bot) e "gank provável no top" com ele na base e nenhum aliado no top
    (roadmap/2026-10-14-calibrar-avisos.md, passo 8)"""
    from avisos import decidir_gank, perto_da_rota
    # torres do inibidor do meio (a ~5300 do canto: fora do R_BASE 5000) e o meio das rotas
    inib_meio_deles, inib_meio_meu = (11134, 11207), (3651, 3696)
    geo = {p: tuple(r for r in ("rota_top", "rota_meio", "rota_bot") if perto_da_rota(r, *p))
           for p in (inib_meio_deles, inib_meio_meu, TOP_ROTA, TOP_FUNDO, BOT_ROTA, MID, (8500, 13800))}
    caso("3293137136: a frente das bases no meio é só do mid (antes: top, mid e bot ao mesmo tempo)",
         geo[inib_meio_deles] == ("rota_meio",) and geo[inib_meio_meu] == ("rota_meio",)
         and geo[TOP_ROTA] == ("rota_top",) and geo[TOP_FUNDO] == ("rota_top",) and geo[BOT_ROTA] == ("rota_bot",)
         and geo[MID] == ("rota_meio",) and geo[(8500, 13800)] == ("rota_top",), f"{geo}")

    # eu (Illaoi, top) e o mid deles (Yasuo) no top; jungler, atirador e suporte deles na frente da base do mid
    # deles. Antes: "4 inimigos no top" (vermelho, urgente). Agora: só o mid chegando no top (amarelo)
    def r(t):
        v = [("Illaoi", TOP_ROTA_2), ("Ekko", inib_meio_deles), ("Tristana", (10900, 11400)),
             ("Seraphine", (11300, 11250))]
        return v + ([("Yasuo", TOP_ROTA)] if t >= 1270 else [])
    # o mid chega 20 s depois (passado o intervalo do tipo): no código de antes sai o "4 inimigos top" do log
    m, mol, s = rodar("Illaoi", r, 25, inicio=1250)
    # o jungler deles longe de mim (na frente da base do mid) vai só ao painel (D6): azul, sem voz nem borda
    rotas = [x for x in resumo(s) if x[1] != "jungler_apareceu" or x[3] != "azul"]
    caso("3293137136: 3 inimigos na base do mid deles + o mid no top → 'intruso top' amarelo, nada de '4 inimigos'",
         rotas == [(1270, "intruso", "intruso top", "amarelo")] and mol.mostradas == [("amarelo", "intruso top")],
         f"{resumo(s)}; falas {[a.fala for _, a in s]}; moldura {mol.mostradas}")

    # base presumida (decisão D20): sem ícone fresco depois de morrer, de sumir com o anel grosso (voltando à
    # base) ou de ser visto na base, eu estou na base: o gank da minha rota só conta com aliado lá
    def montar(roteiro, ate, mortos=None):
        motor = MotorAvisos(textos=TEXTOS, moldura=MolduraFalsa())
        al = AlertasPosicao(motor, "Illaoi", "ORDER", JOGADORES)
        for t in range(0, ate + 1):
            dets = []
            for c, p, *g in roteiro(t):
                d = det(c, p, float(t))
                d["grande"] = bool(g and g[0])
                dets.append(d)
            al.observar(dets, float(t), mortos=(mortos(t) if mortos else ()))
        return al

    def gank_top(rota, alvo):
        return {"prob": 0.6} if rota == "top" else None

    def quem(al, t):
        a = decidir_gank(gank_top, al, agora=float(t))   # chave "top" = a minha rota (urgente); "outra:top" = com aliado
        return (al.onde_estou(float(t))["fonte"], a and (a.dados["zc"], a.chave))

    # morri no top aos 10 s, renasci aos 30 s; a fonte fica no canto e o meu ícone não aparece
    morte = montar(lambda t: [("Illaoi", TOP_ROTA_2)] if t < 10 else [], 50,
                   mortos=lambda t: {"Illaoi"} if 10 <= t < 30 else set())
    renasci = quem(morte, 50)
    expirou = quem(morte, 30 + 46)
    caso("3293137136 D20: renasci e o ícone não aparece → base; gank no top sem aliado lá = nada (antes: urgente)",
         renasci == ("base", None) and expirou == ("reserva", ("top", "top")),
         f"aos 20 s do renascer {renasci}; 46 s sem ícone {expirou}")
    # voltando à base: o ícone com o anel grosso some (teleportou para a fonte)
    volta = montar(lambda t: [("Illaoi", TOP_ROTA_2, t >= 5)] if t < 13 else [], 20)
    com_aliado = montar(lambda t: ([("Illaoi", TOP_ROTA_2, t >= 5)] if t < 13 else []) + [("Zac", TOP_ROTA)], 20)
    caso("3293137136 D20: sumi voltando à base → base; gank no top só com aliado no top, como o de outra rota",
         quem(volta, 20) == ("base", None) and quem(com_aliado, 20) == ("base", ("top", "outra:top")),
         f"sem aliado {quem(volta, 20)}; com o Zac no top {quem(com_aliado, 20)}")
    # o lado oposto: sumir NA ROTA (sem anel grosso, sem morrer) segue a reserva (D5): o gank da minha rota é urgente
    sumi = montar(lambda t: [("Illaoi", TOP_ROTA_2)] if t < 13 else [], 20)
    na_base = montar(lambda t: [("Illaoi", BASE_MINHA)] if t < 13 else [], 20)
    # a Yuumi aliada presa em mim também dá anel grosso (o detector põe ela na minha posição): não é voltar à base
    yuumi = montar(lambda t: [("Illaoi", TOP_ROTA_2, True), ("Yuumi", TOP_ROTA_2)] if t < 13 else [], 20)
    caso("3293137136 D20: sumir na rota (ou com a Yuumi presa) segue a reserva; visto por último na base = base",
         quem(sumi, 20) == ("reserva", ("top", "top")) and quem(na_base, 20) == ("base", None)
         and quem(yuumi, 20) == ("reserva", ("top", "top")),
         f"sumi na rota {quem(sumi, 20)}; visto na base {quem(na_base, 20)}; com a Yuumi {quem(yuumi, 20)}")

    # revisão do passo 8: a mesma regra vale para o intruso. Eu na base (visto nela, depois sem ícone) e o mid deles
    # entrando no top vazio: antes "intruso top" (o top seguia vigiado pela rota do champ select); agora nada. Com o
    # Zac no top, o intruso segue (é ele quem leva o gank). Visto na rota (sem base), segue como sempre
    def intrusos(eu, aliado=False, ate=25):
        motor = MotorAvisos(textos=TEXTOS, moldura=MolduraFalsa())
        al = AlertasPosicao(motor, "Illaoi", "ORDER", JOGADORES)
        out = []
        for t in range(0, ate + 1):
            dets = [det(c, p, float(t)) for c, p in eu(t)]
            dets += [det("Zac", TOP_ROTA, float(t))] if aliado else []
            dets += [det("Yasuo", TOP_ROTA_2, float(t))] if t >= 18 else []
            out += [(t, a.tipo) for a in al.observar(dets, float(t))]
        return out
    base_vazia = intrusos(lambda t: [("Illaoi", BASE_MINHA)] if t < 13 else [])
    base_aliado = intrusos(lambda t: [("Illaoi", BASE_MINHA)] if t < 13 else [], aliado=True)
    na_rota = intrusos(lambda t: [("Illaoi", TOP_ROTA)])
    caso("3293137136: eu na base e o top vazio → intruso no top calado; com aliado lá ou eu na rota, avisa",
         base_vazia == [] and (18, "intruso") in base_aliado and (18, "intruso") in na_rota,
         f"base, top vazio {base_vazia}; base, Zac no top {base_aliado}; eu no top {na_rota}")


def escolhas_config():
    """as regras de 14/10/2026 viram escolha nas Configurações (roadmap/2026-10-14-calibrar-avisos.md, passo 7):
    cada chave desligada muda o comportamento; ligada (o padrão) = o de hoje, já provado pelos casos 14/10 acima"""
    import json
    import re
    import tempfile
    from avisos import JUNGLER_LONGE, decidir_gank
    import servidor_local

    # 1. gank em outra rota (gankOutraRota): desligado, o do bot com aliado lá some; o da minha rota fica
    def gank_com(outras, eu_pos, rotas, aliados=()):
        motor = MotorAvisos(textos=TEXTOS, moldura=MolduraFalsa())
        al = AlertasPosicao(motor, "Illaoi", "ORDER", JOGADORES)
        al.observar(([det("Illaoi", eu_pos, 500.0)] if eu_pos else []) + [det(n, p, 500.0) for n, p in aliados], 500.0)
        a = decidir_gank(lambda r, alvo: {"prob": 0.7} if r in rotas else None, al, agora=500.0, outras=outras)
        if a is not None:
            motor.publicar(a, 500.0)      # cor e urgência do gank da minha rota vêm do tipo (TIPOS), no motor
        return a and (a.dados["zc"], a.cor, a.urgente)
    lig, desl = (gank_com(o, TOP_ROTA, ("bot",), [("Nilah", BOT_ROTA)]) for o in (True, False))
    caso("config gankOutraRota: ligado = gank do bot amarelo (hoje); desligado = nada",
         lig == ("bot", "amarelo", False) and desl is None, f"ligado {lig}, desligado {desl}")
    minha = gank_com(False, TOP_ROTA, ("top", "bot"), [("Nilah", BOT_ROTA)])
    caso("config gankOutraRota desligado: o gank da minha rota continua urgente", minha == ("top", "vermelho", True), f"{minha}")

    # 2. jungler longe (junglerLonge): painel = só a faixa (hoje); tudo = voz e borda; nada = nem o painel
    def jungler_longe(modo):
        m, mol, s = rodar("Illaoi", lambda t: [("Illaoi", TOP_ROTA)] + ([("Ekko", SELVA_BOT_DELES)] if t >= 12 else []), 15,
                          escolhas={"jungler_longe": modo} if modo else None)
        return [(a.tipo, a.destinos, a.cor, destinos_de(m, a)) for _, a in s], m.painel(14.0) is not None
    hoje = jungler_longe(None)
    got = {modo: jungler_longe(modo) for modo in JUNGLER_LONGE}
    caso("config junglerLonge 'painel' (padrão) = hoje: só a faixa do painel, azul",
         got["painel"] == hoje == ([("jungler_apareceu", "p", "azul", [])], True), f"{got['painel']}")
    caso("config junglerLonge 'tudo': o jungler longe fala e pisca a borda (vermelho)",
         got["tudo"] == ([("jungler_apareceu", "vpm", "vermelho", ["moldura", "voz"])], True), f"{got['tudo']}")
    caso("config junglerLonge 'nada': o jungler longe não aparece nem no painel", got["nada"] == ([], False), f"{got['nada']}")
    # revisão 14/10/2026: no 'tudo' o longe sai com os destinos do de perto; sem contagem própria (Aviso.grupo) o
    # longe de 0 s calava por 20 s (intervalo do tipo) o de perto aos 12 s. Os dois modos têm de deixar o perto falar
    for modo in ("tudo", "painel"):
        m, _, s = rodar("Illaoi", lambda t: [("Illaoi", TOP_ROTA)] + (
            [("Ekko", SELVA_BOT_DELES)] if t < 3 else [("Ekko", RIO_TOP)] if t >= 12 else []), 16,
            escolhas={"jungler_longe": modo})
        got_ = [(int(t), a.chave, a.destinos) for t, a in s]
        caso(f"config junglerLonge '{modo}': longe aos 0 s não cala o jungler PERTO aos 12 s (intervalo à parte)",
             len(got_) == 2 and got_[0][1].startswith("jungler_apareceu:longe:")
             and got_[1] == (12, "jungler_apareceu:rio top", "vpm") and not m.suprimidos["intervalo"],
             f"{got_}, suprimidos {dict(m.suprimidos)}")
    al = AlertasPosicao(MotorAvisos(textos=TEXTOS), "Illaoi", "ORDER", JOGADORES)
    al.configurar(jungler_longe="sempre")
    caso("config junglerLonge inválido = 'painel'", al.jungler_longe == "painel")

    # 3. filtro do "mid sumiu" (midSumiuFiltro): desligado = a regra antiga, com teto e intervalo do tipo
    def mid(filtro, roteiro, inicio, dur, eventos=None):
        al = []
        m, mol, s = rodar("Illaoi", roteiro, dur, inicio=inicio, eventos=eventos, al_out=al,
                          escolhas={"filtro_mid": filtro})
        return [int(t) for t, a in s if a.tipo == "mid_sumiu"], dict(al[0].calados), m
    cedo = lambda t: [("Yasuo", MID)] if t < 26 else []                                       # noqa: E731
    cerco = [{"EventID": 9, "EventName": "InhibKilled", "InhibKilled": "Inhib_TOrder_L1_P1_1931666598_0"}]
    for nome, args in (("aos 0:20", (cedo, 20, 15)), ("aos 22 min", (lambda t: [("Yasuo", MID)] if t < 1325 else [], 1320, 15)),
                       ("com o inibidor meu caído (cerco)", (lambda t: [("Yasuo", MID)] if t < 605 else [], 600, 15, lambda t: cerco))):
        on, off = mid(True, *args), mid(False, *args)
        caso(f"config midSumiuFiltro: {nome} → ligado calado, desligado avisa", not on[0] and on[1] and len(off[0]) == 1 and not off[1],
             f"ligado {on[:2]}, desligado {off[:2]}")
    base = mid(False, lambda t: [("Yasuo", MID if t < 600 else (13300, 13300))] if t < 603 else [], 595, 20)
    caso("config midSumiuFiltro desligado: mid visto por último na base dele não 'some' (regra antiga)",
         not base[0] and base[1] == {"base_dele": 1}, f"{base[:2]}")
    ts, _, m = mid(False, lambda t: [("Yasuo", MID)] if (t % 40) < 30 else [], 20, 1400)
    caso("config midSumiuFiltro desligado: teto 4 e 120 s entre eles continuam (limites de repetição)",
         len(ts) == 4 and all(b - a >= 120 for a, b in zip(ts, ts[1:])) and ts[0] < 90, f"aceitos em {ts}")

    # 4. corte da frase repetida (cortarFalaRepetida): duas chaves, a mesma frase, 30 s de distância
    def falas(cortar):
        m = MotorAvisos(textos=TEXTOS)
        if cortar is not None:
            m.configurar(cortar_repetida=cortar)
        for t, k in ((0.0, "a"), (30.0, "b")):
            m.publicar(Aviso("regra", {}, k, textos={"serio": ("mesma frase", "mesma")}), t)
            m.tick(t)
        return [round(t) for t, d, _ in m.emitidos if d == "voz"], m.suprimidos["fala_repetida"]
    hoje, on, off = falas(None), falas(True), falas(False)
    caso("config cortarFalaRepetida: ligado (padrão) = hoje, a 2ª fala igual em 30 s cai; desligado = as duas falam",
         hoje == on == ([0], 1) and off == ([0, 30], 0), f"hoje {hoje}, ligado {on}, desligado {off}")

    # 5. esquema no coletor: padrão, valores aceitos, inválido = padrão (na leitura do arquivo e no POST)
    novas = {"gankOutraRota": True, "junglerLonge": "painel", "midSumiuFiltro": True, "cortarFalaRepetida": True,
             "overlayCor": "vermelho", "overlayForca": "normal", "overlaySuave": True}
    with tempfile.TemporaryDirectory() as tmp:
        arq = Path(tmp) / "config.json"
        padrao = servidor_local.ler_config(arq)
        arq.write_text(json.dumps({"junglerLonge": "sempre", "overlayCor": "azul", "overlayForca": 3, "gankOutraRota": "x",
                                   "tomVoz": "gritando"}), encoding="utf-8")
        lido = servidor_local.ler_config(arq)
        salvo = servidor_local.salvar_config({"coach": {"junglerLonge": "nada", "overlayCor": "roxo", "overlayForca": "forte",
                                                         "overlaySuave": False, "midSumiuFiltro": False}}, arq)
        ruim = servidor_local.salvar_config({"junglerLonge": "talvez", "overlayCor": "verde"}, arq)
    caso("config coletor: padrão das chaves novas = calibração de 14/10", all(padrao[k] == v for k, v in novas.items()), f"{padrao}")
    caso("config coletor: arquivo com valor inválido lido = padrão (inclusive tomVoz, antes só o POST conferia)",
         all(lido[k] == v for k, v in novas.items()) and lido["tomVoz"] == "serio", f"{ {k: lido[k] for k in novas} }")
    caso("config coletor: POST guarda as escolhas válidas e devolve o padrão às inválidas",
         (salvo["junglerLonge"], salvo["overlayCor"], salvo["overlayForca"], salvo["overlaySuave"], salvo["midSumiuFiltro"])
         == ("nada", "roxo", "forte", False, False) and ruim["junglerLonge"] == "painel" and ruim["overlayCor"] == "vermelho"
         and ruim["overlayForca"] == "forte", f"{salvo}")
    # listas iguais nos três lugares: coletor (ESCOLHAS), overlay (CORES/FORCAS) e plugin (config.js)
    import overlay_minimapa
    cfg_js = (RAIZ / "pengu" / "config.js").read_text(encoding="utf-8")

    def lista_js(nome):
        m_ = re.search(rf"export const {nome} = \[(.*?)\];", cfg_js)
        return tuple(re.findall(r"\['([a-z]+)', '", m_.group(1))) if m_ else ()
    E = servidor_local.ESCOLHAS
    caso("config: valores iguais no coletor, no overlay e no plugin",
         E["junglerLonge"] == JUNGLER_LONGE == lista_js("JUNGLER_LONGE")
         and E["overlayCor"] == tuple(overlay_minimapa.CORES) == lista_js("OVERLAY_CORES")
         and E["overlayForca"] == tuple(overlay_minimapa.FORCAS) == lista_js("OVERLAY_FORCAS")
         and all(f"{k}: " in cfg_js for k in novas),
         f"coletor {E['overlayCor']}, overlay {tuple(overlay_minimapa.CORES)}, plugin {lista_js('OVERLAY_CORES')}")


def extra_destinos():
    """chave por tipo e destino (plano 2026-10-13-voz-pregravada-e-foco.md, passo 8)"""
    from avisos import Aviso, normalizar_desligados
    import servidor_local
    dados = {"zona": "no top", "zc": "top", "zt": "top"}

    def destinos(desligados, tipo="gank", d=dados):
        m = MotorAvisos(textos=TEXTOS)
        mol = MolduraFalsa()
        m.moldura = mol
        m.configurar(desligados=desligados)
        aceito = m.publicar(Aviso(tipo, dict(d), "k"), 0.0)
        return aceito, sorted({dst for _, dst, _ in m.emitidos}), m.painel(0.0) is not None, m

    aceito, dst, painel, _ = destinos({"voz": ["gank"], "tela": []})
    caso("extra: só a voz do gank desligada → moldura e painel continuam", aceito and dst == ["moldura"] and painel,
         f"aceito={aceito}, destinos {dst}, painel={painel}")
    aceito, dst, painel, _ = destinos({"voz": [], "tela": ["gank"]})
    caso("extra: só a tela do gank desligada → só a voz", aceito and dst == ["voz"] and not painel,
         f"aceito={aceito}, destinos {dst}, painel={painel}")
    aceito, dst, painel, m = destinos(["gank"])
    caso("extra: lista antiga ['gank'] migra para voz e tela (calado nos dois)",
         not aceito and dst == [] and not painel and m.suprimidos["desligado"] == 1
         and normalizar_desligados(["gank"]) == {"voz": {"gank"}, "tela": {"gank"}}, f"aceito={aceito}, destinos {dst}")
    aceito, dst, painel, _ = destinos({"voz": ["regra"], "tela": []}, tipo="dica_qualquer", d={})
    caso("extra: tipo fora da lista conta como 'regra'", aceito and dst == [] and painel,
         f"aceito={aceito}, destinos {dst}, painel={painel}")
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        arq = Path(tmp) / "config.json"
        arq.write_text('{"avisosDesligados": ["ouro_guardado", 7], "voz": false}', encoding="utf-8")
        lido = servidor_local.ler_config(arq)
        salvo = servidor_local.salvar_config({"coach": {"avisosDesligados": ["mid_sumiu"]}}, arq)
        salvo2 = servidor_local.salvar_config({"avisosDesligados": {"voz": ["gank"], "tela": "x"}}, arq)
        padrao = servidor_local.ler_config(Path(tmp) / "nao-existe.json")
    ok = (lido["avisosDesligados"] == {"voz": ["ouro_guardado"], "tela": ["ouro_guardado"]} and lido["voz"] is False
          and salvo["avisosDesligados"] == {"voz": ["mid_sumiu"], "tela": ["mid_sumiu"]}
          and salvo2["avisosDesligados"] == {"voz": ["gank"], "tela": []}
          and padrao["avisosDesligados"] == {"voz": [], "tela": []}
          and padrao["avisosDesligados"] is not servidor_local.CONFIG_PADRAO["avisosDesligados"])
    caso("extra: servidor_local migra a lista salva e a lista do plugin antigo para {voz, tela}", ok,
         f"lido {lido['avisosDesligados']}, salvo {salvo['avisosDesligados']}, salvo2 {salvo2['avisosDesligados']}")


def extra_retorno_atalho():
    """retorno ao jogador do F9 e do F8 (treino de 13/10/2026: nada aparecia e a borda vermelha confundiu)"""
    import re
    from avisos import CORES_RETORNO, TIPOS, TIPOS_LIGAVEIS, Aviso, aviso_atalho

    class VozFalsa:
        def __init__(self):
            self.faladas = []

        def falar(self, texto, urgente=False, prioridade=0):
            self.faladas.append((texto, urgente))

    def rodar_eventos(eventos, tom="serio", desligados=None, antes=None):
        voz, mol = VozFalsa(), MolduraFalsa()
        m = MotorAvisos(textos=TEXTOS, voz=voz, moldura=mol, tom=tom)
        if desligados:
            m.configurar(desligados=desligados)
        t = 100.0
        for a in antes or []:
            m.publicar(a, t)
        for i, (ev, kw) in enumerate(eventos):
            t += 0.5
            m.publicar(aviso_atalho(ev, i, **kw), t)
            m.tick(t)
        return m, voz, mol

    # batida → marcado → desfeito → nada a desfazer → cancelado → sem inimigo, em sequência rápida (< 2,5 s entre eles: retorno substitui
    # retorno na hora, sem alerta na tela)
    # (14/10 ~20:30: o F7 só; cada batida mostra a rota selecionada, segurar desfaz ou cancela)
    m, voz, mol = rodar_eventos([("selecionado", {"rota": "atirador", "feitico": "flash"}),
                                 ("marcado", {"rota": "atirador", "feitico": "Flash"}),
                                 ("desfeito", {"rota": "atirador", "feitico": "Flash"}), ("nada_a_desfazer", {}),
                                 ("cancelado", {}), ("sem_inimigo", {"rota": "mid"}),
                                 ("do_chat", {"rota": "mid", "feitico": "Flash"})])
    # o desfeito diz QUAL na moldura (revisão do passo 10: a voz "marcação desfeita" não tem rota, e o segurar podia
    # tirar a marcação de outro sem ele perceber); do_chat = segurou e o gasto veio do chat, fica
    caso("retorno F7: rótulos na moldura na hora (flash: atirador?, atirador sem flash, desfeito: atirador, "
         "nada a desfazer, nada marcado, sem inimigo, mid: chat confirmou)",
         [r for _, r in mol.mostradas] == ["flash: atirador?", "atirador sem flash", "desfeito: atirador",
                                           "nada a desfazer", "nada marcado", "sem inimigo", "mid: chat confirmou"],
         str(mol.mostradas))
    caso("retorno F9: voz só no marcado e no desfeito, na hora, sem urgência (não corta fala em curso)",
         voz.faladas == [("flash do atirador marcado", False), ("marcação desfeita", False)], str(voz.faladas))
    _, voz1, mol1 = rodar_eventos([("marcado", {"rota": "inimigo", "feitico": "Flash"})])
    caso("retorno F9 de inimigo sem posição: 'flash do inimigo marcado' (nunca a rota da tecla)",
         voz1.faladas == [("flash do inimigo marcado", False)] and mol1.mostradas == [("verde", "inimigo sem flash")],
         f"{voz1.faladas} {mol1.mostradas}")
    cores = {c for c, _ in mol.mostradas}
    caso("retorno F9: cor azul ou verde, nunca vermelho", cores <= set(CORES_RETORNO) and "vermelho" not in cores,
         str(sorted(cores)))
    nomes_campeao = re.compile(r"Tristana|Ekko|Yasuo|Riven|Seraphine")
    caso("retorno F9: fala sem nome de campeão", not any(nomes_campeao.search(f) for f, _ in voz.faladas))
    # rótulo ≤ 3 palavras: o "flash: 1 a 5" cortaria em "flash: 1 a"
    caso("retorno F9: todo rótulo cabe em 3 palavras (nada cortado)", all(len(r.split()) <= 3 for _, r in mol.mostradas))

    # tom descontraído e as 5 rotas
    _, voz2, mol2 = rodar_eventos([("marcado", {"rota": r, "feitico": "Flash"}) for r in
                                   ("top", "jungler", "mid", "atirador", "suporte")], tom="descontraido")
    caso("retorno F9 descontraído: 5 rotas, rótulo '<rota> sem flash'",
         [r for _, r in mol2.mostradas] == [f"{r} sem flash" for r in ("top", "jungler", "mid", "atirador", "suporte")]
         and voz2.faladas[0][0] == "anotado: top sem flash", f"{mol2.mostradas[:2]} {voz2.faladas[:1]}")

    # F8: rótulo do overlay
    _, voz3, mol3 = rodar_eventos([("overlay", {"estado": "desligado"}), ("overlay", {"estado": "ligado"})])
    caso("retorno F8: 'overlay desligado' / 'overlay ligado' só na moldura, azul",
         mol3.mostradas == [("azul", "overlay desligado"), ("azul", "overlay ligado")] and voz3.faladas == [],
         f"{mol3.mostradas} {voz3.faladas}")

    # tipo novo ligável, por destino, e na lista do plugin
    blocos = (RAIZ / "pengu" / "blocos.js").read_text(encoding="utf-8")
    lista_js = re.search(r"const AVISOS = \[(.*?)\n\];", blocos, re.S)
    tipos_js = re.findall(r"\['([a-z0-9_]+)', '", lista_js.group(1)) if lista_js else []   # não casa o ['tela']
    caso("tipos novos em TIPOS_LIGAVEIS e no plugin (blocos.js AVISOS = TIPOS_LIGAVEIS)",
         {"feitico_marcado", "overlay_f8"} <= set(TIPOS_LIGAVEIS) and sorted(tipos_js) == sorted(TIPOS_LIGAVEIS)
         and len(tipos_js) == len(set(tipos_js)),
         f"plugin {len(tipos_js)}, coletor {len(TIPOS_LIGAVEIS)}")
    caso("tipos do retorno sem vermelho na tabela", all(TIPOS[t]["cor"] in CORES_RETORNO for t in ("feitico_marcado", "overlay_f8")))
    _, voz4, mol4 = rodar_eventos([("marcado", {"rota": "top", "feitico": "Flash"})],
                                  desligados={"voz": ["feitico_marcado"], "tela": []})
    caso("retorno F9 com a voz desligada na config: só a moldura", voz4.faladas == [] and len(mol4.mostradas) == 1)
    _, voz5, mol5 = rodar_eventos([("marcado", {"rota": "top", "feitico": "Flash"})],
                                  desligados={"voz": ["feitico_marcado"], "tela": ["feitico_marcado"]})
    caso("retorno F9 desligado nos dois: nada", voz5.faladas == [] and mol5.mostradas == [])

    # plugin: tipo sem voz (overlay_f8, destinos "m") não desenha a caixa "voz" (ela não teria efeito)
    sem_voz_py = sorted(t for t in TIPOS if "v" not in TIPOS[t]["destinos"])
    sem_voz_js = sorted(re.findall(r"\['([a-z0-9_]+)', '[^']*', \['tela'\]\]", lista_js.group(1) if lista_js else ""))
    caso("plugin: só a caixa 'tela' nos tipos que não falam", sem_voz_py == sem_voz_js, f"py {sem_voz_py}, js {sem_voz_js}")

    # retorno só preenche tempo ocioso (revisão de 13/10/2026). Voz: sai na hora com um aviso comum
    # esperando os 20 s, e não conta no intervalo (o comum segue esperando)
    m6 = MotorAvisos(textos=TEXTOS, voz=VozFalsa(), moldura=MolduraFalsa())
    m6.publicar(Aviso("objetivo_60s", {"objetivo": "dragão"}, "d"), 0.0)        # fala em 0
    m6.publicar(Aviso("inimigo_fed", {"campeao": "Yasuo"}, "y"), 1.0)          # espera (20 s)
    m6.publicar(aviso_atalho("marcado", 1, rota="mid", feitico="Flash"), 2.0)
    for t in (3.0, 10.0, 19.9, 20.0):
        m6.tick(t)
    falas6 = [(round(t), a.fala) for t, d, a in m6.emitidos if d == "voz"]
    caso("retorno F9 sai na hora com aviso comum na fila e não mexe no intervalo (o comum sai em 20 s)",
         falas6[:2] == [(0, "dragão em um minuto"), (2, "flash do mid marcado")] and len(falas6) == 3
         and falas6[2][0] == 20,
         str(falas6))
    # voz: objetivo em 0, jungler apareceu em 17 (esperando os 20 s), atalho 3 em 18 → o jungler ainda fala em 20
    m7v = VozFalsa()
    m7 = MotorAvisos(textos=TEXTOS, voz=m7v, moldura=MolduraFalsa())
    m7.publicar(Aviso("objetivo_60s", {"objetivo": "dragão"}, "d"), 0.0)
    m7.publicar(Aviso("jungler_apareceu", {"zona": "no rio top", "zc": "rio top", "campeao": "Ekko"}, "rio"), 17.0)
    m7.publicar(aviso_atalho("marcado", 1, rota="mid", feitico="Flash"), 18.0)
    for t in (19.0, 20.0, 21.0):
        m7.tick(t)
    caso("retorno F9 não atrasa nem vence alerta de posição na fila da voz (jungler fala em 20 s)",
         [f for f, _ in m7v.faladas] == ["dragão em um minuto", "flash do mid marcado", "jungler no rio top"]
         and not m7.suprimidos["vencido"], f"{m7v.faladas} {dict(m7.suprimidos)}")
    # moldura: gank vermelho em 0, batida do F7 em 0,5, marca 2 em 1,2. A batida ("flash: jungler?") sai NA HORA por
    # cima do alerta: é a seleção que ele confere antes de a marcação sair 1,2 s depois de soltar (D34); antes ela
    # esperava o gap de 2,5 s e, com um alerta na tela, a marcação saía às cegas (revisão do passo 10, achado 2). O
    # marcado (tem voz) segue esperando o gap; a batida não mexe no relógio da moldura (o próximo alerta entra na hora)
    m8m = MolduraFalsa()
    m8 = MotorAvisos(textos=TEXTOS, voz=VozFalsa(), moldura=m8m)
    m8.publicar(Aviso("gank", {"zona": "no rio", "zc": "rio"}, "rio"), 0.0)
    m8.publicar(aviso_atalho("selecionado", 1, rota="jungler", feitico="flash"), 0.5)
    m8.publicar(aviso_atalho("marcado", 2, rota="jungler", feitico="Flash"), 1.2)
    for t in (1.5, 2.0, 2.5, 3.0):
        m8.tick(t)
    tempos8 = [(t, a.rotulo) for t, d, a in m8.emitidos if d == "moldura"]
    caso("batida do F7 com alerta na tela: 'flash: jungler?' na hora (por cima do gank); o marcado espera o gap",
         m8m.mostradas == [("vermelho", "gank rio"), ("azul", "flash: jungler?"), ("verde", "jungler sem flash")]
         and tempos8[1][0] == 0.5 and tempos8[2][0] >= 2.5, str(tempos8))
    m8.publicar(Aviso("jungler_apareceu", {"zona": "no rio top", "zc": "rio top", "campeao": "Ekko"}, "rio2"), 3.1)
    caso("depois da batida por cima, o alerta seguinte segue a regra de sempre (a batida não conta como borda)",
         m8m.mostradas[-1] == ("vermelho", "jungler rio top"), str(m8m.mostradas))
    # moldura: retorno na tela e um alerta chega → o alerta entra na hora (o retorno nunca segura alerta)
    m9m = MolduraFalsa()
    m9 = MotorAvisos(textos=TEXTOS, voz=VozFalsa(), moldura=m9m)
    m9.publicar(aviso_atalho("selecionado", 1, rota="top", feitico="flash"), 0.0)
    m9.publicar(Aviso("jungler_apareceu", {"zona": "no rio top", "zc": "rio top", "campeao": "Ekko"}, "rio"), 0.3)
    caso("alerta entra na moldura na hora com um retorno na tela",
         m9m.mostradas == [("azul", "flash: top?"), ("vermelho", "jungler rio top")], str(m9m.mostradas))


def janela_real():
    import ctypes
    import mss
    import numpy as np
    from moldura import ESTILO_EX, Moldura, janela_do_jogo
    ret = (40, 40, 480, 270)
    # cor escurecida (CORES_MOLDURA, 188/36/36 desde 14/10/2026) com o pulso começando no máximo
    vermelho = lambda p: p[0] > 150 and p[1] < 90 and p[2] < 90  # noqa: E731

    def mostrar_e_ler(fora_do_print):
        m = Moldura(forcar=True, retangulo=ret, fora_do_print=fora_do_print).iniciar()
        m.mostrar("vermelho", "jungler rio top")
        time.sleep(0.05)
        with mss.MSS() as s:   # BGRA, só em memória (o print pega o que estiver na tela)
            img = np.array(s.grab({"left": ret[0], "top": ret[1], "width": ret[2], "height": ret[3]}))
        borda = tuple(int(v) for v in img[3, ret[2] // 2, 2::-1])
        caixa = tuple(int(v) for v in img[12 + 24 + 4, 12 + 24 + 4, 2::-1])
        return m, borda, caixa

    # 1) sem a exclusão do print: o mss enxerga o desenho (prova que a janela desenha)
    m, borda, caixa = mostrar_e_ler(False)
    estilo = m.estilo_ex()
    time.sleep(Moldura.DURACAO + 0.3)
    visivel_depois = bool(ctypes.windll.user32.IsWindowVisible(m.hwnd))
    m.parar()
    caso("moldura real: WS_EX_LAYERED|TRANSPARENT|TOPMOST|TOOLWINDOW|NOACTIVATE, borda e rótulo vermelhos, some após ~2 s",
         estilo & ESTILO_EX == ESTILO_EX and vermelho(borda) and vermelho(caixa) and not visivel_depois,
         f"estilo {hex(estilo)}, borda {borda}, caixa {caixa}, visível depois {visivel_depois}")
    # 2) padrão de produção: fora do print (o minimapa não pode ver a borda por cima da faixa dele)
    m, borda, caixa = mostrar_e_ler(True)
    visivel = bool(ctypes.windll.user32.IsWindowVisible(m.hwnd))
    m.parar()
    caso("moldura real: fora do print (WDA_EXCLUDEFROMCAPTURE) com a janela visível",
         m.excluida and visivel and not vermelho(borda) and not vermelho(caixa),
         f"aceito pelo Windows={m.excluida}, visível={visivel}, borda no print {borda}")
    m2 = Moldura(retangulo=ret).iniciar()
    jogo = janela_do_jogo()
    m2.mostrar("amarelo", "teste")
    time.sleep(0.3)
    m2.parar()
    caso("moldura real: sem o jogo em primeiro plano não desenha", jogo is not None or (m2.exibidos == [] and m2.descartados == 1),
         f"jogo na frente={jogo is not None}, exibidos {len(m2.exibidos)}, descartados {m2.descartados}")


def principal():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sem-janela", action="store_true", help="não abre a janela real da moldura")
    a = ap.parse_args()
    seq_a()
    seq_b()
    seq_c()
    prova = sum(resultados)
    print(f"prova do plano: {'ok' if prova == 3 else 'FALHOU'} {prova}/3")
    extra_jungler_na_rota()
    extra_dois_intrusos()
    extra_adversario_voltou()
    relato_3293149183_voltou()
    relato_3293149183_rajada()
    relato_3293149183_moldura()
    extra_pausa()
    extra_morto()
    extra_lista_acumulada()
    extra_eu_entro_na_rota()
    extra_contra_gank()
    extra_destinos()
    extra_retorno_atalho()
    calib_jungler_onde_estou()
    calib_mid_sumiu()
    calib_gank()
    escolhas_config()
    revisao_3293137136()
    if not a.sem_janela:
        janela_real()
    n = sum(resultados)
    print(f"\n{'ok' if n == len(resultados) else 'FALHOU'} ({n}/{len(resultados)})")
    return 0 if n == len(resultados) else 1


if __name__ == "__main__":
    sys.exit(principal())
