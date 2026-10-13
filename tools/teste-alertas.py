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
from avisos import TEXTOS, AlertasPosicao, MotorAvisos  # noqa: E402

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


def rodar(eu, roteiro, dur, quadros_invalidos=(), mortos=None):
    """roteiro(t) -> lista de (campeao, pos) visíveis no quadro t. Devolve (motor, moldura, alertas)."""
    moldura = MolduraFalsa()
    motor = MotorAvisos(textos=TEXTOS, moldura=moldura)
    al = AlertasPosicao(motor, eu, JOGADORES[eu]["time"], JOGADORES)
    saida = []
    for t in range(dur):
        t = float(t)
        valido = t not in quadros_invalidos
        dets = [det(c, p, t) for c, p in roteiro(t)] if valido else []
        for a in al.observar(dets, t, quadro_valido=valido, mortos=(mortos(t) if mortos else ())):
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
    # Yasuo no mid 0–5, some 6–13 (8 s), reaparece no top em 14 (eu na selva: sem rota vigiada)
    def r(t):
        return [("Yasuo", MID)] if t <= 5 else [("Yasuo", TOP_ROTA)] if t >= 14 else []
    m, mol, s = rodar("Zac", r, 24)
    esp = [(11, "mid_sumiu", "mid sumiu", "amarelo"), (14, "mid_indo", "mid indo top", "amarelo")]
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
    ok = len(s) == 1 and a.tipo == "intruso" and a.cor == "vermelho" and a.urgente and "Ekko" in a.fala
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


def janela_real():
    import ctypes
    import mss
    import numpy as np
    from moldura import ESTILO_EX, Moldura, janela_do_jogo
    ret = (40, 40, 480, 270)
    vermelho = lambda p: p[0] > 180 and p[1] < 90 and p[2] < 90  # noqa: E731

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
    extra_pausa()
    extra_morto()
    extra_lista_acumulada()
    extra_eu_entro_na_rota()
    extra_contra_gank()
    extra_destinos()
    if not a.sem_janela:
        janela_real()
    n = sum(resultados)
    print(f"\n{'ok' if n == len(resultados) else 'FALHOU'} ({n}/{len(resultados)})")
    return 0 if n == len(resultados) else 1


if __name__ == "__main__":
    sys.exit(principal())
