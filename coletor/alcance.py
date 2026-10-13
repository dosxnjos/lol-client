# área alcançável a partir da última posição vista (plano v2, passo 15b). A grade de caminhável sai
# do próprio minimapa (paredes = HSV V <= 30) e é regerada na partida; a distância é a de andar pelo
# chão (Dijkstra 8-vizinhos), não a linha reta. Dash e Flash: um salto por cima da parede de
# espessura <= alcance (tabela em docs/MOBILIDADE.md). Nada aqui olha o que está na fog: é só a
# conta "até onde ele PODE ter ido", e o que tu vê iluminado sem o ícone dele sai da área.
import json
import logging
import math
import re
import urllib.request
from pathlib import Path

import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra

try:
    from . import minimapa as mm
except ImportError:
    import minimapa as mm

log = logging.getLogger("coletor")

RAIZ = Path(__file__).resolve().parent.parent
PASTA_MAPAS = RAIZ / "dados" / "mapas"
DOC_MOBILIDADE = RAIZ / "docs" / "MOBILIDADE.md"
CACHE_DDRAGON = RAIZ / "dados" / "ddragon-campeoes.json"
FLASH = 400
VEL_PADRAO = 340
# bota pelo item da Live Client (o item do inimigo atrasa: mediana 25 s; ARMADILHAS § Live Client)
BOTAS = {1001: 25, 3005: 45, 3006: 45, 3009: 55, 3010: 45, 3020: 45, 3047: 45, 3111: 45, 3117: 25,
         3158: 45, 3170: 55, 3171: 55, 3172: 55, 3173: 55, 3174: 55, 3175: 55, 3176: 55}


def unid_por_px(lado):
    """unidades do mundo por px do mapa (média de x 42,6 e y 42,4 com lado 347)"""
    return 0.5 * (1 / (mm.AX * lado) + 1 / (-mm.AY * lado))


class Grade:
    """caminhavel: uint8 lado×lado (1 = chão). Gera o grafo uma vez e calcula distâncias."""

    def __init__(self, caminhavel, origem="minimapa"):
        self.m = np.ascontiguousarray(caminhavel.astype(np.uint8))
        self.lado = self.m.shape[0]
        self.origem = origem
        self.upx = unid_por_px(self.lado)
        self._grafo = None

    @classmethod
    def de_quadros(cls, quadros):
        m = mm.caminhavel(quadros)
        return cls(m, f"mediana de {len(quadros)} quadros") if m is not None else None

    # --- arquivo: dados/mapas/<patch>-<tipo>.npy (para comparar mapas dinâmicos entre patches) ---
    def salvar(self, patch, tipo="padrao", pasta=PASTA_MAPAS):
        pasta.mkdir(parents=True, exist_ok=True)
        arq = pasta / f"{re.sub(r'[^0-9A-Za-z._-]', '_', str(patch))}-{tipo}.npy"
        np.save(arq, self.m)
        return arq

    @classmethod
    def carregar(cls, arq):
        return cls(np.load(arq), Path(arq).name)

    def _arestas(self):
        """(origem, destino, peso) das arestas 8-vizinhas entre px de chão, nos dois sentidos"""
        if self._grafo is None:
            n = self.lado
            idx = np.arange(n * n).reshape(n, n)
            ok = self.m > 0
            o, d, p = [], [], []
            for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1)):
                r1, c0, c1 = n - dy, max(0, -dx), n - max(0, dx)
                sel = ok[0:r1, c0:c1] & ok[dy:r1 + dy, c0 + dx:c1 + dx]
                a, b = idx[0:r1, c0:c1][sel], idx[dy:r1 + dy, c0 + dx:c1 + dx][sel]
                w = math.hypot(dx, dy) * self.upx
                o += [a, b]
                d += [b, a]
                p += [np.full(len(a), w)] * 2
            self._grafo = (np.concatenate(o), np.concatenate(d), np.concatenate(p))
        return self._grafo

    def _g(self, fonte=None):
        """grafo esparso; fonte = vetor de distâncias iniciais (nó virtual n² ligado a cada px)"""
        o, d, p = self._arestas()
        n2 = self.lado * self.lado
        if fonte is not None:
            fin = np.nonzero(np.isfinite(fonte))[0]
            o = np.concatenate([o, np.full(len(fin), n2)])
            d = np.concatenate([d, fin])
            p = np.concatenate([p, fonte[fin] + 1e-6])
        return csr_matrix((p, (o, d)), shape=(n2 + 1, n2 + 1))

    def ponto(self, x, y):
        """px (col, linha) do chão mais perto da posição do mundo (até 6 px; ícone em cima de parede)"""
        u, v = mm.mundo_para_px(x, y, self.lado)
        c, r = int(np.clip(round(u - 0.5), 0, self.lado - 1)), int(np.clip(round(v - 0.5), 0, self.lado - 1))
        if self.m[r, c]:
            return c, r
        for raio in range(1, 7):
            ys, xs = np.nonzero(self.m[max(0, r - raio):r + raio + 1, max(0, c - raio):c + raio + 1])
            if len(xs):
                k = np.argmin((xs - min(raio, c)) ** 2 + (ys - min(raio, r)) ** 2)
                return max(0, c - raio) + int(xs[k]), max(0, r - raio) + int(ys[k])
        return c, r

    def distancia(self, x, y):
        """distância andando (unidades) de (x, y) até cada px; inf = não chega"""
        c, r = self.ponto(x, y)
        d = dijkstra(self._g(), indices=r * self.lado + c, directed=True)
        return d[:-1].reshape(self.lado, self.lado)

    def com_salto(self, d0, alcance, atravessa_tudo=False):
        """distância com UM salto de até `alcance` unidades em linha reta (por cima da parede) a partir
        de qualquer ponto já alcançado andando, e depois andando de novo. atravessa_tudo: o campeão anda
        dentro da parede (Kayn E) — o mesmo cálculo com alcance da tabela."""
        n, R = self.lado, alcance / self.upx
        k = int(math.floor(R))
        d1 = np.full((n, n), np.inf)
        for dy in range(-k, k + 1):
            for dx in range(-k, k + 1):
                L = math.hypot(dx, dy)
                if L > R or L == 0:
                    continue
                src = d0[max(0, -dy):n - max(0, dy), max(0, -dx):n - max(0, dx)]
                dst = d1[max(0, dy):n - max(0, -dy), max(0, dx):n - max(0, -dx)]
                np.minimum(dst, src + L * self.upx, out=dst)
        if not atravessa_tudo:
            d1[self.m == 0] = np.inf   # o salto pousa no chão
        d1 = np.minimum(d1, d0)
        d = dijkstra(self._g(np.where(self.m.ravel() > 0, d1.ravel(), np.inf)), indices=n * n, directed=True)
        d = d[:-1].reshape(n, n)
        return np.minimum(d, d1) if atravessa_tudo else d


class GradeViva:
    """grade regerada na partida (mapa dinâmico): 1ª com >= 3 quadros, de novo ~20 s depois do 2º
    DragonKill (a fenda vira a do elemento do 3º dragão; wiki "Elemental drake", 13/10/2026) e a cada
    5 min por garantia. Só usa quadros posteriores à mudança. Salva em dados/mapas/<patch>-<tipo>.npy.
    quadros_fn() -> [(gt, mapa BGR)] (Captura.quadros)."""

    def __init__(self, quadros_fn, patch="?", salvar=True):
        self.quadros_fn = quadros_fn
        self.patch = patch
        self.salvar = salvar
        self.grade = None
        self.t_grade = None
        self.dragoes = []        # [(t, DragonType)]
        self._ids = set()
        self.tipo = "padrao"

    def eventos(self, lista):
        for e in lista or []:
            if e.get("EventID") in self._ids:
                continue
            self._ids.add(e.get("EventID"))
            if e.get("EventName") == "DragonKill":
                self.dragoes.append((float(e.get("EventTime") or 0), e.get("DragonType")))

    def atualizar(self, t):
        """devolve a Grade nova quando regerou, senão None"""
        mudanca = self.dragoes[1][0] + 20 if len(self.dragoes) >= 2 else None
        if len(self.dragoes) >= 3:
            self.tipo = f"fenda-{str(self.dragoes[2][1] or '?').lower()}"
        elif mudanca is not None:
            self.tipo = "fenda-elemental"
        precisa = (self.grade is None or (mudanca is not None and t >= mudanca and self.t_grade < mudanca)
                   or t - self.t_grade >= 300)
        if not precisa:
            return None
        desde = mudanca if mudanca is not None and t >= mudanca else -1
        qs = [q for tq, q in self.quadros_fn() if tq >= desde]
        if len(qs) < 3:
            return None
        self.grade = Grade.de_quadros(qs[-30:])
        self.t_grade = t
        if self.salvar:
            try:
                self.grade.salvar(self.patch, self.tipo)
            except OSError as e:
                log.warning("alcance: não salvou a grade (%s)", e)
        return self.grade


def chave(campeao):
    """nome de campeão comparável: "Rek'Sai" = "RekSai" = "reksai" (Data Dragon usa o id sem espaço)"""
    return re.sub(r"[^a-z0-9]", "", str(campeao).lower())


def ler_mobilidade(arq=DOC_MOBILIDADE):
    """{campeao minúsculo: {alcance, atravessa, recarga}} da tabela de docs/MOBILIDADE.md"""
    out = {}
    try:
        linhas = arq.read_text(encoding="utf-8").splitlines()
    except OSError:
        return out
    for ln in linhas:
        cel = [c.strip() for c in ln.strip().strip("|").split("|")]
        if len(cel) < 5 or not cel[2].replace(".", "").isdigit():
            continue
        out[chave(cel[0])] = {"habilidade": cel[1], "alcance": float(cel[2]), "atravessa": cel[3].lower(),
                               "recarga": float(cel[4]) if cel[4].replace(".", "").isdigit() else None}
    return out


class Area:
    """área alcançável de UM campeão a partir de uma pista (posição + instante). As distâncias saem uma
    vez por pista; a cada quadro é só o limiar velocidade × tempo.

    em(t) -> float lado×lado: 1 = alcança andando (ou com o dash dele), 0,5 = só com Flash ("talvez")"""

    def __init__(self, grade, x, y, t0, velocidade=VEL_PADRAO, campeao=None, mobilidade=None, flash=True):
        self.grade, self.x, self.y, self.t0 = grade, x, y, t0
        self.vel = velocidade
        self.d0 = grade.distancia(x, y)
        self.d = self.d0
        mob = (mobilidade if mobilidade is not None else ler_mobilidade()).get(chave(campeao or ""))
        self.mob = mob
        if mob:
            self.d = grade.com_salto(self.d0, mob["alcance"], mob["atravessa"] == "livre")
        self.df = grade.com_salto(self.d, FLASH) if flash else None

    def em(self, t, fog=None):
        lim = self.vel * max(0.0, t - self.t0)
        a = (self.d <= lim).astype(np.float32)
        if self.df is not None:
            a[(a == 0) & (self.df <= lim)] = 0.5
        if fog is not None:   # o que está iluminado e sem o ícone dele, ele não está
            a *= fog
        return a


# ---------- velocidade ----------

def velocidades_base(cache=CACHE_DDRAGON):
    """{nome minúsculo e id: movespeed} do Data Dragon (a LCU não traz atributos; conferido 13/10/2026).
    Uma requisição por patch, em cache local."""
    try:
        return json.loads(cache.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    try:
        ua = {"User-Agent": "lol-client/1.0 (coach pessoal)"}
        with urllib.request.urlopen(urllib.request.Request("https://ddragon.leagueoflegends.com/api/versions.json",
                                                           headers=ua), timeout=10) as r:
            ver = json.loads(r.read())[0]
        url = f"https://ddragon.leagueoflegends.com/cdn/{ver}/data/en_US/champion.json"
        with urllib.request.urlopen(urllib.request.Request(url, headers=ua), timeout=20) as r:
            dados = json.loads(r.read())["data"]
        out = {"_versao": ver}
        for c in dados.values():
            out[chave(c["id"])] = c["stats"]["movespeed"]
            out[chave(c["name"])] = c["stats"]["movespeed"]
            out[str(c["key"])] = c["stats"]["movespeed"]
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(out), encoding="utf-8")
        return out
    except Exception as e:
        log.warning("alcance: sem Data Dragon (%s); velocidade padrão %d", e, VEL_PADRAO)
        return {}


def velocidade(campeao, itens=(), base=None):
    """base do campeão + bota visível (itens = ids da Live Client). Sem dado -> VEL_PADRAO."""
    base = base if base is not None else velocidades_base()
    v = base.get(chave(campeao), VEL_PADRAO)
    bota = max((BOTAS.get(int(i), 0) for i in itens), default=0)
    return v + bota
