# estado do jungler inimigo (plano v2, passo 14): última posição vista no minimapa + tempo desde
# então + eventos globais da Live Client (objetivo com KillerName, abate com ele, morte e renascer).
# O farm do inimigo NÃO é pista: congela na fog (passo 9, MEDICAO-2026-10-13 § 1). A saída é uma
# distribuição sobre zonas com confiança, nunca uma posição "certa" (falácia da previsão).
import math

import numpy as np

try:
    from . import minimapa as mm
    from . import selva as sv
except ImportError:
    import minimapa as mm
    import selva as sv

ORDER, CHAOS = sv.ORDER, sv.CHAOS
SMITE = ("golpear", "golpe irrestrito", "golpe primordial", "smite")
DIAG = 14800                  # x + y no meio do rio
MEIA_RIO, MEIA_MID, LARG_ROTA, RAIO_BASE = 1200, 900, 2300, 5000
PONTO_ROTA = {"TOP": (1800, 12800), "MIDDLE": (7400, 7400), "BOTTOM": (12900, 1900)}
VEL_PADRAO = 345
SUMIDO_S = 45                 # sem pista nova há mais que isso: "sumido há X s"
GANK_MASSA, GANK_MAX_S = 0.5, 40
VISIVEL_S = 3                 # visto há <= 3 s (a detecção pisca entre quadros) = está na tela


def outro(time):
    return CHAOS if time == ORDER else ORDER


def zona(x, y):
    """(tipo, qual): ('base', time) | ('rota', top/mid/bot) | ('rio', top/bot) | ('selva', time, metade)"""
    if math.hypot(x, y) < RAIO_BASE:
        return ("base", ORDER)
    if math.hypot(14870 - x, 14980 - y) < RAIO_BASE:
        return ("base", CHAOS)
    if x < LARG_ROTA or y > 14870 - LARG_ROTA:
        return ("rota", "top")
    if y < LARG_ROTA or x > 14870 - LARG_ROTA:
        return ("rota", "bot")
    if abs(x - y) < MEIA_MID:
        return ("rota", "mid")
    m = "top" if y > x else "bot"
    if abs(x + y - DIAG) < MEIA_RIO:
        return ("rio", m)
    return ("selva", ORDER if x + y < DIAG else CHAOS, m)


def nome_zona(z, meu_time):
    if z[0] == "base":
        return "base aliada" if z[1] == meu_time else "base inimiga"
    if z[0] in ("rota", "rio"):
        return f"{z[0]} {z[1]}"
    return f"selva {z[2]} {'aliada' if z[1] == meu_time else 'inimiga'}"


def zonas_de_gank(rota):
    """zonas de onde sai o gank em cada rota (nome sem time: casa com nome_zona)"""
    return {"top": ("rota top", "rio top", "selva top inimiga", "selva top aliada"),
            "mid": ("rota mid", "rio top", "rio bot"),
            "bot": ("rota bot", "rio bot", "selva bot inimiga", "selva bot aliada")}.get(rota, ())


class Mapa:
    """rótulo de zona por px do mapa (lado×lado), calculado uma vez"""

    def __init__(self, lado, meu_time):
        self.lado = lado
        c = np.arange(lado) + 0.5
        uu, vv = np.meshgrid(c, c)
        xs, ys = mm.px_para_mundo(uu, vv, lado)
        nomes = np.empty((lado, lado), dtype=object)
        for i in range(lado):
            for j in range(lado):
                nomes[i, j] = nome_zona(zona(xs[i, j], ys[i, j]), meu_time)
        self.rotulos = sorted(set(nomes.ravel()))
        self.idx = np.vectorize(self.rotulos.index)(nomes).astype(np.int16)
        self.xs, self.ys = xs, ys


class EstadoJungler:
    """meu_time: ORDER/CHAOS do Gabriel. grade: alcance.Grade (opcional; sem ela, linha reta).
    Entradas: jogadores(allPlayers) a cada amostra da Live Client, eventos(lista inteira) e
    observar(deteccoes do minimapa). Saída: estado(t) e gank(t, rota)."""

    def __init__(self, meu_time, grade=None, lado=347, mobilidade=None):
        self.meu_time = meu_time
        self.time = outro(meu_time)
        self.grade = grade
        self.lado = grade.lado if grade is not None else lado
        self.mapa = Mapa(self.lado, meu_time)
        self.mobilidade = mobilidade
        self.campeao = None
        self.nomes = set()
        self.vel = VEL_PADRAO
        self.pista = None             # {"x", "y", "t", "fonte"}
        self.morto_ate = None
        self._vistos_ids = set()
        self._area = None             # alcance.Area da pista atual (cache)
        self.posicoes = {}            # campeao/nome -> (t, x, y) de todo mundo (para abates)
        self.rota_de = {}             # nome -> rota declarada (TOP/MIDDLE/BOTTOM/...)
        self.campeao_de = {}          # nome de jogador ou campeão -> campeão (chave das detecções)
        self._avistados = set()       # (campeao, visto_em) já passados para a selva
        self.selva = sv.EstadoSelva(self.time)

    # ---------- entradas ----------
    def trocar_grade(self, grade):
        """grade regerada (alcance.GradeViva: mapa dinâmico); refaz a área da pista atual"""
        if grade is not None and grade.lado == self.lado:
            self.grade = grade
            self._area = None

    def jogadores(self, all_players, t=None, velocidade=None):
        """identifica o jungler inimigo (rota JUNGLE; senão quem leva Smite) e lê morte/renascer"""
        inimigos = [p for p in all_players or [] if p.get("team") == self.time]
        for p in all_players or []:
            # os eventos da Live Client crua citam o NOME do jogador; o minimapa, o campeão
            for k in ("championName", "riotIdGameName", "summonerName", "riotId"):
                if p.get(k):
                    self.rota_de[p[k]] = p.get("position") or ""
                    self.campeao_de[p[k]] = p.get("championName") or p[k]
        j = next((p for p in inimigos if p.get("position") == "JUNGLE"), None)
        if j is None:
            j = next((p for p in inimigos if any(
                str((p.get("summonerSpells") or {}).get(s, {}).get("displayName", "")).lower() in SMITE
                for s in ("summonerSpellOne", "summonerSpellTwo"))), None)
        if j is None:
            return
        if self.campeao != j.get("championName"):
            self.campeao = j.get("championName")
            self.nomes = {j[k] for k in ("championName", "riotIdGameName", "summonerName", "riotId") if j.get(k)}
            self.selva.nomes = set(self.nomes)
            self._area = None
        if velocidade:
            self.vel = velocidade
        if t is not None:
            if j.get("isDead"):
                self.morto_ate = t + float(j.get("respawnTimer") or 0)
            elif self.morto_ate is not None:
                # renasceu: está na fonte dele naquele instante
                self._nova_pista(*sv.FONTE[self.time], self.morto_ate if self.morto_ate <= t else t, "renasceu")
                self.morto_ate = None

    def eventos(self, lista):
        """lista inteira de events.Events (acumulativa): dedupe por EventID"""
        for e in lista or []:
            eid = e.get("EventID")
            if eid in self._vistos_ids:
                continue
            self._vistos_ids.add(eid)
            self.selva.evento(e)
            nome, t = e.get("EventName"), float(e.get("EventTime") or 0)
            if nome in sv.OBJETIVOS and e.get("KillerName") in self.nomes:
                self._nova_pista(*sv.OBJETIVOS[nome][1], t, "objetivo")
            elif nome == "ChampionKill":
                vit = e.get("VictimName")
                if vit in self.nomes:
                    continue  # morte dele: isDead/respawnTimer cuidam (vem na mesma amostra)
                if e.get("KillerName") in self.nomes or self.nomes & set(e.get("Assisters") or []):
                    pos = self.posicoes.get(self.campeao_de.get(vit, vit))
                    if pos and t - pos[0] <= 10:
                        self._nova_pista(pos[1], pos[2], t, "abate")
                    elif self.rota_de.get(vit) in PONTO_ROTA:
                        self._nova_pista(*PONTO_ROTA[self.rota_de[vit]], t, "abate (rota da vítima)")

    def observar(self, deteccoes):
        """deteccoes do minimapa: [{campeao, time, x, y, visto_em}]"""
        for d in deteccoes or []:
            self.posicoes[d["campeao"]] = (d["visto_em"], d["x"], d["y"])
            if d["campeao"] in self.nomes or d["campeao"] == self.campeao:
                chave = (d["campeao"], d["visto_em"])
                if chave in self._avistados:
                    continue   # Captura.deteccoes() sem max_idade repete a última posição a cada chamada
                self._avistados.add(chave)
                self._nova_pista(d["x"], d["y"], d["visto_em"], "visto")
                self.selva.avistamento(d["visto_em"], d["x"], d["y"])

    def _nova_pista(self, x, y, t, fonte):
        if self.pista and t < self.pista["t"]:
            return
        mudou = not self.pista or (x, y) != (self.pista["x"], self.pista["y"])
        self.pista = {"x": float(x), "y": float(y), "t": float(t), "fonte": fonte}
        if mudou:
            self._area = None

    # ---------- leituras ----------
    def _alcance(self, t):
        """float lado×lado: 1 alcança, 0,5 só com Flash; sem grade: disco em linha reta"""
        p = self.pista
        if self.grade is not None:
            try:
                from . import alcance as al
            except ImportError:
                import alcance as al
            if self._area is None:
                self._area = al.Area(self.grade, p["x"], p["y"], p["t"], self.vel, self.campeao, self.mobilidade)
            return self._area.em(t)
        lim = self.vel * max(0.0, t - p["t"])
        d = np.hypot(self.mapa.xs - p["x"], self.mapa.ys - p["y"])
        a = (d <= lim).astype(np.float32)
        a[(a == 0) & (d <= lim + 400)] = 0.5
        return a

    def _prior(self, rotulo, t, dt, rotulo_pista):
        if rotulo.startswith("base"):
            w = 0.25 if rotulo == ("base inimiga") else 0.0
        elif rotulo.startswith("selva"):
            w = 1.0 if rotulo.endswith("inimiga") else 0.35
        elif rotulo.startswith("rio"):
            # caranguejo (2:55) e os objetivos do rio puxam o jungler
            w = 2.5 if sv.CARANGUEJO_NASCE - 10 <= t <= sv.CARANGUEJO_NASCE + 80 else 1.0
        else:
            w = 0.7
        if rotulo == rotulo_pista and dt > 5:
            w *= math.exp(-(dt - 5) / 20)   # um campo leva ~20 s: depois disso ele já saiu
        return w

    def distribuicao(self, t, fog=None):
        """(zonas [(rotulo, p)] desc., calor lado×lado somando 1) ou (None, None) sem pista.
        fog: bool lado×lado do quadro atual (o que está iluminado e sem ele, ele não está)"""
        if not self.pista:
            return None, None
        dt = max(0.0, t - self.pista["t"])
        a = self._alcance(t)
        if fog is not None:
            a = a * fog
        if a.sum() == 0:
            a = self._alcance(t)
        rot_pista = nome_zona(zona(self.pista["x"], self.pista["y"]), self.meu_time)
        idx = self.mapa.idx
        n = len(self.mapa.rotulos)
        cont = np.bincount(idx.ravel(), minlength=n).astype(float)
        soma = np.bincount(idx.ravel(), weights=a.ravel(), minlength=n)
        # área alcançável da zona ÷ raiz da área da zona: meio-termo entre "área" (zona grande sempre
        # ganha) e "fração" (zona pequena sempre ganha)
        frac = np.divide(soma, np.sqrt(cont), out=np.zeros(n), where=cont > 0)
        w = np.array([self._prior(r, t, dt, rot_pista) for r in self.mapa.rotulos]) * frac
        if w.sum() == 0:
            w[self.mapa.rotulos.index(rot_pista)] = 1.0
        p = w / w.sum()
        # calor: a massa da zona espalhada pelos px alcançáveis dela
        por_px = np.divide(p, soma, out=np.zeros(n), where=soma > 0)
        calor = a * por_px[idx]
        zonas = sorted(((r, float(v)) for r, v in zip(self.mapa.rotulos, p) if v > 0.005), key=lambda z: -z[1])
        return zonas, calor

    def preparar(self, t):
        """calcula a área da pista atual (Dijkstra, 40–470 ms) na thread de quem chama: chamar no laço
        do coletor depois de observar/eventos, para o overlay (thread do Tk) só ler o cache"""
        if self.pista:
            self._alcance(t)

    def estado(self, t, fog=None):
        """{campeao, status (visto|provavel|sumido|morto|sem pista), texto, zonas, confianca, pista, segundos}"""
        base = {"campeao": self.campeao, "pista": self.pista, "zonas": [], "confianca": 0.0, "segundos": None}
        if self.morto_ate is not None and t < self.morto_ate:
            return {**base, "status": "morto", "texto": f"jungler morto até {sv.mmss(self.morto_ate)}",
                    "morto_ate": self.morto_ate}
        if not self.pista:
            return {**base, "status": "sumido", "texto": "jungler sumido (sem pista)"}
        dt = t - self.pista["t"]
        zonas, _ = self.distribuicao(t, fog)
        decai = 1.0 if dt <= 10 else math.exp(-(dt - 10) / 30)
        conf = round(zonas[0][1] * decai, 2) if zonas else 0.0
        if dt <= 2 and self.pista["fonte"] == "visto":
            st, txt = "visto", f"jungler visto: {zonas[0][0]}"
        elif dt > SUMIDO_S:
            st, txt = "sumido", f"jungler sumido há {int(dt)} s (provável: {zonas[0][0]})"
        else:
            st, txt = "provavel", f"provável: {zonas[0][0]} ({'visto' if self.pista['fonte'] == 'visto' else self.pista['fonte']} há {int(dt)} s)"
        return {**base, "status": st, "texto": txt, "zonas": zonas, "confianca": conf, "segundos": round(dt, 1)}

    def gank(self, t, minha_rota, minha_pos=None, fog=None, zonas=None):
        """aviso "gank provável <rota>" ou None. minha_rota: top/mid/bot; minha_pos (x, y) de quem seria
        gankado (meu ícone, ou o do aliado da rota) para saber se está adiantado (mais perto da base inimiga
        que da dele). zonas: a distribuicao(t, fog)[0] já calculada no passo (o coach pergunta das 3 rotas)"""
        if not self.pista or (self.morto_ate is not None and t < self.morto_ate):
            return None
        dt = t - self.pista["t"]
        if dt > GANK_MAX_S:
            return None
        if self.pista["fonte"] == "visto" and dt <= VISIVEL_S:
            # na tela agora: é posição, não previsão; quem avisa é o AlertasPosicao (intruso/jungler
            # apareceu). Sem isto o mesmo evento saía 2× urgente e repetia a cada 30 s com ele parado
            return None
        if zonas is None:
            zonas, _ = self.distribuicao(t, fog)
        massa = sum(p for r, p in zonas if r in zonas_de_gank(minha_rota))
        if massa < GANK_MASSA:
            return None
        if minha_pos is not None:
            minha = math.hypot(minha_pos[0] - sv.FONTE[self.meu_time][0], minha_pos[1] - sv.FONTE[self.meu_time][1])
            deles = math.hypot(minha_pos[0] - sv.FONTE[self.time][0], minha_pos[1] - sv.FONTE[self.time][1])
            if deles >= minha:
                return None
        return {"rota": minha_rota, "prob": round(massa, 2), "texto": f"gank provável {minha_rota}",
                "segundos": round(dt, 1)}

    def calor(self, t, fog=None, some_s=30):
        """mapa de calor (float lado×lado, 0–1) para o overlay, ou None depois de some_s sem pista nova"""
        if not self.pista or t - self.pista["t"] > some_s or (self.morto_ate is not None and t < self.morto_ate):
            return None
        _, c = self.distribuicao(t, fog)
        return None if c is None or c.max() <= 0 else c / c.max()
