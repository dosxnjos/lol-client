# inteligência de selva inimiga (plano v2, passo 15d). Só o que o Gabriel PODE saber: horário dos
# campos (tabela dona: docs/SELVA.md), onde o jungler foi visto no minimapa e os eventos globais da
# Live Client (objetivo com KillerName). O farm do inimigo NÃO entra: ele congela na fog (passo 9).
# Tudo aqui é estimativa com confiança, nunca "certo".
import math

ORDER, CHAOS = "ORDER", "CHAOS"
FONTE = {ORDER: (400, 400), CHAOS: (14400, 14450)}

# campos do lado de cada time (coordenadas da comunidade conferidas no minimapa da partida de
# 13/10/2026: caem nos ícones/timers dos campos). Metade: top = acima da diagonal do mid (y > x).
# nasce/renasce em s, patch 26.20 (client 16.20); fonte e data em docs/SELVA.md.
CAMPOS = {
    ORDER: {"azul": (3821, 8101), "gromp": (2288, 8448), "lobos": (3783, 6495),
            "aves": (6823, 5507), "vermelho": (7765, 4020), "krugs": (8394, 2641)},
    CHAOS: {"azul": (11032, 6990), "gromp": (12703, 6443), "lobos": (11008, 8387),
            "aves": (7986, 9471), "vermelho": (7101, 10900), "krugs": (6317, 12146)},
}
TEMPOS = {"azul": (55, 300), "vermelho": (55, 300), "gromp": (67, 135), "lobos": (67, 135),
          "aves": (67, 135), "krugs": (67, 135)}
CARANGUEJO = {"top": (4400, 9600), "bot": (10500, 5170)}
CARANGUEJO_NASCE, CARANGUEJO_RENASCE = 175, 150
# objetivos: posição medida na timeline da partida de 13/10/2026 07:18 (ELITE_MONSTER_KILL) e nascimento
OBJETIVOS = {"DragonKill": ("dragão", (9866, 4414)), "HordeKill": ("vastilarvas", (5007, 10471)),
             "HeraldKill": ("arauto", (5007, 10471)), "BaronKill": ("barão", (5007, 10471)),
             "AtakhanKill": ("atakhan", (5007, 10471))}
NASCE_OBJ = {"dragão": 300, "vastilarvas": 480, "arauto": 900, "barão": 1200}

# modelo de limpeza: 1º campo acaba ~15 s depois de nascer (com ajuda da rota), cada campo seguinte
# leva LIMPA_S + caminhada. Calibrado na partida real: Zac nível 2 em 74,9 s e nível 3 em 123,9 s
# (1º campo dá o nível 2; o 3º, o nível 3: wiki "Jungling", conferido 13/10/2026).
PRIMEIRO_S, LIMPA_S, VEL_SELVA = 15, 18, 345
JANELA_N3 = (-10, 45)
PERTO_CAMPO = 900


def metade(x, y):
    return "top" if y > x else "bot"


def _dist(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def campo_mais_perto(time_selva, x, y):
    nome, pos = min(CAMPOS[time_selva].items(), key=lambda kv: _dist(kv[1], (x, y)))
    return nome, _dist(pos, (x, y))


def rota_de_limpeza(time_selva, inicio):
    """ordem provável dos 6 campos a partir do campo inicial: os da mesma metade por proximidade, depois
    a outra metade a partir do campo mais perto (vermelho -> krugs -> aves -> lobos -> azul -> gromp)"""
    c = CAMPOS[time_selva]
    m0 = metade(*c[inicio])
    ordem, atual = [inicio], inicio
    for alvo in (m0, "top" if m0 == "bot" else "bot"):
        resto = [k for k in c if k not in ordem and metade(*c[k]) == alvo]
        while resto:
            prox = min(resto, key=lambda k: _dist(c[k], c[atual]))
            ordem.append(prox)
            resto.remove(prox)
            atual = prox
    return ordem


def tempos_da_rota(time_selva, ordem, vistos=None):
    """[(campo, fim estimado em s)] pelo modelo de limpeza; vistos = {campo: t} ancora (ele estava
    lá em t, então aquele campo não acabou antes disso) e empurra os seguintes"""
    c, vistos = CAMPOS[time_selva], vistos or {}
    t = max(TEMPOS[ordem[0]][0] + PRIMEIRO_S, vistos.get(ordem[0], 0))
    out = [(ordem[0], t)]
    for a, b in zip(ordem, ordem[1:]):
        t = max(t + _dist(c[a], c[b]) / VEL_SELVA + LIMPA_S, TEMPOS[b][0] + LIMPA_S, vistos.get(b, 0))
        out.append((b, t))
    return out


def mmss(t):
    t = max(0, int(round(t)))
    return f"{t // 60}:{t % 60:02d}"


class EstadoSelva:
    """estado da selva do time `time_inimigo` (a do jungler inimigo)."""

    def __init__(self, time_inimigo, nomes_jungler=()):
        self.time = time_inimigo
        self.nomes = set(nomes_jungler)
        self.avistamentos = []        # [(t, x, y)]
        self.eventos = {}             # EventID -> evento
        self.limpos = {}              # campo -> (t limpo, origem: "visto"|"estimado"|"evento")

    # --- entradas ---
    def avistamento(self, t, x, y):
        self.avistamentos.append((t, x, y))
        nome, d = campo_mais_perto(self.time, x, y)
        if d <= PERTO_CAMPO and t >= TEMPOS[nome][0]:
            self.limpos[nome] = (t, "visto")

    def evento(self, e):
        eid = e.get("EventID")
        if eid in self.eventos:
            return
        self.eventos[eid] = e

    # --- leituras ---
    def lado_inicio(self):
        """(campo inicial, metade, confiança) pelo 1º avistamento antes de 1:50 na selva dele"""
        for t, x, y in sorted(self.avistamentos):
            if t > 110:
                break
            nome, d = campo_mais_perto(self.time, x, y)
            if d <= 2000:
                # o avistamento perto de um buff é o início; perto de um campo pequeno, o buff da mesma metade
                if nome not in ("azul", "vermelho"):
                    nome = next(k for k in ("azul", "vermelho") if metade(*CAMPOS[self.time][k]) ==
                                metade(*CAMPOS[self.time][nome]))
                return nome, metade(*CAMPOS[self.time][nome]), ("alta" if t <= 80 else "média")
        return None, None, "sem pista"

    def objetivos_dele(self):
        out = []
        for e in sorted(self.eventos.values(), key=lambda e: e.get("EventTime", 0)):
            if e.get("EventName") in OBJETIVOS and e.get("KillerName") in self.nomes:
                nome, pos = OBJETIVOS[e["EventName"]]
                out.append((e["EventTime"], nome, pos))
        return out

    def estado(self, t):
        """{lado_inicio, metade_inicio, confianca_lado, rota: [(campo, fim)], campos: {campo: {...}},
        nivel3: (de, ate) ou None, previsoes: [texto]}"""
        inicio, meia, conf = self.lado_inicio()
        out = {"lado_inicio": inicio, "metade_inicio": meia, "confianca_lado": conf, "rota": [],
               "campos": {}, "nivel3": None, "previsoes": []}
        limpos = dict(self.limpos)
        if inicio:
            vistos = {c: tv for c, (tv, origem) in self.limpos.items() if origem == "visto" and tv < 240}
            rota = tempos_da_rota(self.time, rota_de_limpeza(self.time, inicio), vistos)
            out["rota"] = [(c, round(f)) for c, f in rota]
            n3 = rota[2][1]
            out["nivel3"] = (round(n3 + JANELA_N3[0]), round(n3 + JANELA_N3[1]))
            for c, f in rota:
                if f <= t and c not in limpos:
                    limpos[c] = (f, "estimado")
            if t < out["nivel3"][1]:
                onde = metade(*CAMPOS[self.time][rota[2][0]])
                out["previsoes"].append(f"jungler nível 3 por volta de {mmss(n3)} perto do {onde}")
        for c, pos in CAMPOS[self.time].items():
            nasce, renasce = TEMPOS[c]
            if c in limpos:
                tl, origem = limpos[c]
                volta = tl + renasce
                st = "limpo" if t < volta else "vivo"
                out["campos"][c] = {"status": st, "limpo_em": round(tl), "volta_em": round(volta), "origem": origem}
            else:
                out["campos"][c] = {"status": "vivo" if t >= nasce else "nasce", "nasce_em": nasce, "origem": "horário"}
        # objetivo feito por ele: posição exata naquele instante + campos do outro lado livres
        objs = self.objetivos_dele()
        if objs:
            te, nome, pos = objs[-1]
            m = metade(*pos)
            outra = "bot" if m == "top" else "top"
            out["ultimo_objetivo"] = {"t": te, "objetivo": nome, "x": pos[0], "y": pos[1], "metade": m}
            if t - te <= 60:
                prep = "nas" if nome == "vastilarvas" else "no"
                out["previsoes"].append(f"jungler {prep} {nome} às {mmss(te)}: campos {outra} dele livres")
                out["campos_proximos"] = [c for c, p in CAMPOS[self.time].items() if metade(*p) == m]
        # visto numa metade agora: a outra metade dele está livre (contra-selva)
        if self.avistamentos:
            tv, x, y = self.avistamentos[-1]
            if t - tv <= 20 and _dist((x, y), FONTE[self.time]) > 5000:
                m = metade(x, y)
                out["previsoes"].append(f"campos {'bot' if m == 'top' else 'top'} inimigos livres")
        if CARANGUEJO_NASCE - 30 <= t < CARANGUEJO_NASCE:
            out["previsoes"].append(f"caranguejo do rio nasce em {int(CARANGUEJO_NASCE - t)} s")
        return out
