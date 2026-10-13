# minimapa do jogo por print de tela (plano v2, passo 13). "API primeiro": só existe porque a Live
# Client não tem posição. Nada lê memória, injeta ou clica: só captura o monitor (mss) com o jogo em
# primeiro plano e olha os pixels que o Gabriel já vê. Detalhe e números: docs/COLETOR.md § Minimapa.
#
#   achar_mapa(img)            quadrado do mapa achado pela faixa (16,28,27) em volta (não por fórmula)
#   jogo_na_tela(img, ret)     a faixa está lá? (11% dos prints da partida medida eram outra janela)
#   Detector(...).detectar()   anéis vermelho/azul -> candidatos -> classificação entre os 5 do time
#   terreno(mapa) / caminhavel(quadros)   fog e paredes por brilho (HSV V)
#   Captura                    laço ~6 fps -> deteccoes() = [{campeao, time, x, y, visto_em}]
import ctypes
import json
import logging
import math
import threading
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

log = logging.getLogger("coletor")

RAIZ = Path(__file__).resolve().parent.parent
PASTA_ICONES = RAIZ / "dados" / "icones"
GAME_CFG = Path(r"C:\Games\Riot Games\League of Legends\Config\game.cfg")
TITULO_JOGO = "League of Legends (TM) Client"

FAIXA_BGR = (27, 28, 16)        # RGB (16, 28, 27): faixa entre o mapa e a moldura dourada
FAIXA_TOL = 4
# mundo -> px do mapa, normalizado pelo lado (medido 13/10/2026 com lado 347 em (2197, 716):
# X = 2196,7 + 0,02345·x; Y = 1064,0 − 0,02361·y, 79 pontos; docs/COLETOR.md § Minimapa)
AX, BX = 0.02345 / 347, -0.3 / 347
AY, BY = -0.02361 / 347, 348.0 / 347
MUNDO_X, MUNDO_Y = 14870, 14980
# ícone no mapa de 347 px: rosto de raio ~12,5 e anel de 2 px no raio ~14,5 (medido nos recortes)
RAIO_ANEL_347 = 14.5
LIMIAR_ANEL = 0.30              # fração do anel com a cor do time (anel encoberto em luta ~0,3–0,5)
LIMIAR_ROSTO = 0.45             # correlação rosto × ícone da LCU (TM_CCOEFF com máscara)
V_PAREDE, V_FOG = 30, 100       # HSV V: parede 0–10, chão na fog ~56, iluminado ~154
BURACO_MAX = 40                 # mancha preta menor que isso (px) é ícone/texto, não parede


def mundo_para_px(x, y, lado):
    """posição do mundo (0–14870) -> px contínuo dentro do mapa (canto de cima à esquerda = 0,0)"""
    return (BX + AX * x) * lado, (BY + AY * y) * lado


def px_para_mundo(u, v, lado):
    return (u / lado - BX) / AX, (v / lado - BY) / AY


@dataclass
class Retangulo:
    left: int       # px físicos da imagem onde foi achado (tela inteira ou recorte)
    top: int
    lado: int

    def recorte(self, img, margem=0):
        m = margem
        return img[self.top - m:self.top + self.lado + m, self.left - m:self.left + self.lado + m]


# ---------- retângulo e "jogo na tela" ----------

def _faixa(img):
    return (np.abs(img[:, :, :3].astype(np.int16) - np.array(FAIXA_BGR, np.int16)).max(axis=2)
            <= FAIXA_TOL).astype(np.uint8)


def achar_mapa(img, flip=False):
    """Retangulo do quadrado do mapa, ou None. Procura o anel da faixa (16,28,27) que contorna o mapa
    no canto de baixo (direito; FlipMiniMap=1: esquerdo) e devolve o buraco de dentro dele."""
    h, w = img.shape[:2]
    if w > 800:  # tela inteira: só o quadrante do minimapa
        x0 = 0 if flip else w // 2
        y0 = h // 4
        sub = img[y0:, x0:x0 + w // 2]
    else:
        x0 = y0 = 0
        sub = img
    f = _faixa(sub)
    n, lab, st, _ = cv2.connectedComponentsWithStats(f, connectivity=8)
    melhor = None
    for i in range(1, n):
        bx, by, bw, bh, area = st[i]
        if bw < 80 or bh < 80 or abs(bw - bh) > 8 or area > 0.3 * bw * bh:
            continue
        if melhor is None or area > st[melhor][4]:
            melhor = i
    if melhor is None:
        return None
    bx, by, bw, bh, _ = st[melhor]
    c = lab == melhor
    esq, dir_, cima, baixo = [], [], [], []
    faixa_w, faixa_h = max(3, bw // 8), max(3, bh // 8)
    for y in range(by + bh // 5, by + 4 * bh // 5, 3):
        xs = np.nonzero(c[y, bx:bx + faixa_w])[0]
        if len(xs):
            esq.append(bx + xs.max() + 1)
        xs = np.nonzero(c[y, bx + bw - faixa_w:bx + bw])[0]
        if len(xs):
            dir_.append(bx + bw - faixa_w + xs.min())
    for x in range(bx + bw // 5, bx + 4 * bw // 5, 3):
        ys = np.nonzero(c[by:by + faixa_h, x])[0]
        if len(ys):
            cima.append(by + ys.max() + 1)
        ys = np.nonzero(c[by + bh - faixa_h:by + bh, x])[0]
        if len(ys):
            baixo.append(by + bh - faixa_h + ys.min())
    if min(len(esq), len(dir_), len(cima), len(baixo)) < 5:
        return None
    e, d, t, b = (int(np.median(v)) for v in (esq, dir_, cima, baixo))
    lado = int(round(np.median([d - e, b - t])))
    if lado < 60:
        return None
    return Retangulo(x0 + e, y0 + t, lado)


def jogo_na_tela(img, ret):
    """True se a faixa em volta do mapa está no lugar (o print é do monitor, não da janela)"""
    L, T, n = ret.left, ret.top, ret.lado
    if L < 5 or T < 5:
        return False
    esq = _faixa(img[T + n // 5:T + 4 * n // 5, L - 5:L - 1])
    cima = _faixa(img[T - 5:T - 1, L + n // 5:L + 4 * n // 5])
    return max(esq.mean() if esq.size else 0, cima.mean() if cima.size else 0) > 0.5


def janela_do_jogo_em_primeiro_plano():
    """título da janela em primeiro plano = o do jogo (só leitura do título; nenhum acesso ao processo)"""
    try:
        u = ctypes.windll.user32
        hwnd = u.GetForegroundWindow()
        buf = ctypes.create_unicode_buffer(256)
        u.GetWindowTextW(hwnd, buf, 256)
        return buf.value == TITULO_JOGO
    except Exception:
        return False


# ---------- terreno: fog e paredes por brilho ----------

def terreno(mapa_bgr):
    """{'parede', 'chao', 'fog', 'aceso'} (bool lado×lado) de UM quadro; fog = chão escuro"""
    v = cv2.cvtColor(mapa_bgr, cv2.COLOR_BGR2HSV)[:, :, 2]
    chao = v > V_PAREDE
    return {"parede": ~chao, "chao": chao, "fog": chao & (v < V_FOG), "aceso": chao & (v >= V_FOG)}


def caminhavel(quadros):
    """grade de caminhável (uint8 0/1) pela mediana de vários quadros do mapa (BGR, mesmo lado);
    tira parede com < 3 px de espessura e preenche mancha preta < BURACO_MAX px (ícone, texto)"""
    if not quadros:
        return None
    m = np.mean([terreno(q)["chao"] for q in quadros], axis=0) > 0.5
    # contorno preto de ícone (torre, inibidor) tem 1–2 px; parede de verdade tem 3+ (~130 unidades)
    parede = cv2.morphologyEx((~m).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    m = parede == 0
    n, lab, st, _ = cv2.connectedComponentsWithStats(parede, connectivity=4)
    pequenos = np.nonzero(st[:, 4] < BURACO_MAX)[0]
    pequenos = pequenos[pequenos > 0]
    if len(pequenos):
        m = m | np.isin(lab, pequenos)
    return m.astype(np.uint8)


# ---------- ícones (LCU) ----------

def ids_por_alias(lcu):
    """{alias minúsculo: id} de /lol-game-data/assets/v1/champion-summary.json (só GET)"""
    dados = lcu.get("/lol-game-data/assets/v1/champion-summary.json") or []
    return {str(c.get("alias", "")).lower(): int(c["id"]) for c in dados if c.get("id", -1) > 0}


def id_do_jogador(p, mapa_alias):
    """id do campeão de um allPlayers[] da Live Client (rawChampionName = ..._displayname_<Alias>)"""
    raw = str(p.get("rawChampionName") or "")
    alias = raw.rsplit("_", 1)[-1].lower() if raw else str(p.get("championName", "")).lower()
    return mapa_alias.get(alias)


def baixar_icones(lcu, ids, pasta=PASTA_ICONES):
    """ícone BASE de cada campeão (a skin não muda o minimapa) em cache local; só GET na LCU"""
    pasta.mkdir(parents=True, exist_ok=True)
    for cid in ids:
        arq = pasta / f"{cid}.png"
        if arq.exists():
            continue
        req = urllib.request.Request(f"https://127.0.0.1:{lcu.porta}/lol-game-data/assets/v1/champion-icons/{cid}.png",
                                     headers={"Authorization": lcu.auth})
        with urllib.request.urlopen(req, context=lcu.ctx, timeout=15) as r:
            arq.write_bytes(r.read())


# ---------- detecção ----------

@dataclass
class Deteccao:
    campeao: str
    id: int
    time: str
    u: float          # px contínuo no mapa
    v: float
    x: float          # mundo
    y: float
    anel: float       # fração do anel com a cor do time
    rosto: float      # correlação com o ícone
    grande: bool = False   # anel grosso (Yuumi presa ou voltando à base)
    yuumi: bool = False    # posição herdada do hospedeiro (Yuumi presa)


def _cor_time(mapa_bgr):
    """máscaras float do anel: aliado (azul) e inimigo (vermelho), medidas nos recortes de 13/10/2026"""
    a = mapa_bgr.astype(np.int16)
    b, g, r = a[:, :, 0], a[:, :, 1], a[:, :, 2]
    azul = (b > 160) & (r < 140) & (b - r > 70) & (b - g > 25)
    verm = (r > 160) & (g < 120) & (b < 120) & (r - g > 90)
    return azul.astype(np.float32), verm.astype(np.float32)


def _anel(raio, esp=1.0):
    k = int(np.ceil(raio + esp + 1))
    yy, xx = np.mgrid[-k:k + 1, -k:k + 1]
    d = np.hypot(xx, yy)
    m = (np.abs(d - raio) <= esp).astype(np.float32)
    return m / m.sum()


def _picos(resp, limiar, dist):
    """máximos locais acima do limiar, separados por >= dist px (NMS gulosa)"""
    dil = cv2.dilate(resp, np.ones((3, 3), np.uint8))
    ys, xs = np.nonzero((resp >= dil) & (resp >= limiar))
    ordem = np.argsort(-resp[ys, xs])
    out = []
    for i in ordem:
        p = (int(xs[i]), int(ys[i]))
        if all((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 >= dist * dist for q, _ in out):
            out.append((p, float(resp[ys[i], xs[i]])))
    return out


class Detector:
    """campeoes: [{campeao, id, time}] (time = ORDER/CHAOS como na Live Client); meu_time decide a cor
    do anel (aliado azul, inimigo vermelho). icones: pasta com {id}.png (ícone base da LCU)."""

    def __init__(self, campeoes, meu_time, lado, pasta_icones=PASTA_ICONES):
        self.lado = lado
        self.meu_time = meu_time
        e = lado / 347
        self.r_anel = RAIO_ANEL_347 * e
        self.D = int(round(28 * e)) | 1                      # ímpar: centro inteiro
        self.k_meio = _anel(self.r_anel / 2, 0.75 * max(1, e))
        self.k_grande = _anel(self.r_anel + 3.0 * e, 1.0 * max(1, e))
        D, c = self.D, self.D // 2
        self.mask = np.zeros((D, D), np.uint8)
        cv2.circle(self.mask, (c, c), int(round(12 * e)), 255, -1)   # só o rosto, sem o anel
        self.campeoes = []
        for cp in campeoes:
            arq = Path(pasta_icones) / f"{cp['id']}.png"
            ic = cv2.imread(str(arq), cv2.IMREAD_COLOR)
            if ic is None:
                log.warning("minimapa: sem ícone de %s (%s)", cp.get("campeao"), arq.name)
                continue
            # ícone inteiro reduzido ao diâmetro do rosto+anel (o minimapa recorta o mesmo quadrado em círculo)
            t = cv2.resize(ic, (D, D), interpolation=cv2.INTER_AREA).astype(np.float32)[self.mask > 0]
            t = (t - t.mean(axis=0)).ravel()
            self.campeoes.append({**cp, "vet": t / (np.linalg.norm(t) + 1e-6)})

    def _candidatos(self, mapa):
        azul, verm = _cor_time(mapa)
        sep = self.r_anel * 0.9
        out = []
        h, w = azul.shape
        for cor, tm in ((azul, "aliado"), (verm, "inimigo")):  # anel: aliado azul, inimigo vermelho
            # anel procurado em meia resolução (4x menos px, kernel 4x menor; o rosto refina ±3 px)
            meio = cv2.resize(cor, (w // 2, h // 2), interpolation=cv2.INTER_AREA)
            r = cv2.filter2D(meio, -1, self.k_meio, borderType=cv2.BORDER_CONSTANT)
            for (x, y), s in _picos(r, LIMIAR_ANEL, sep / 2):
                p = (min(w - 1, 2 * x), min(h - 1, 2 * y))
                # anel grosso (Yuumi presa ou voltando à base): cor também 3 px para fora. Medido só
                # em aliado (azul); no vermelho é a mesma conta, sem teste com Yuumi inimiga
                grande = self._grande(cor, p) >= 0.5
                out.append({"p": p, "anel": s, "lado": tm, "grande": bool(grande)})
        return out

    def _grande(self, cor, p, busca=2):
        k = self.k_grande
        m = k.shape[0] // 2 + busca
        pad = cv2.copyMakeBorder(cor[max(0, p[1] - m):p[1] + m + 1, max(0, p[0] - m):p[0] + m + 1],
                                 max(0, m - p[1]), max(0, p[1] + m + 1 - cor.shape[0]),
                                 max(0, m - p[0]), max(0, p[0] + m + 1 - cor.shape[1]), cv2.BORDER_CONSTANT, value=0)
        return float(cv2.matchTemplate(pad, k, cv2.TM_CCORR).max())

    def _rostos(self, img, pad, p, tpls, busca=3):
        """correlação normalizada (média tirada por canal, só os px do rosto) de cada template em
        volta de p (±busca px): [(score, centro)] na ordem de tpls. img = mapa com borda de pad px.
        Feita à mão em numpy: o matchTemplate com máscara custa ~1 ms por chamada."""
        D, c = self.D, self.D // 2
        x0, y0 = p[0] - c - busca, p[1] - c - busca
        reg = img[y0 + pad:y0 + pad + D + 2 * busca, x0 + pad:x0 + pad + D + 2 * busca].astype(np.float32)
        n = 2 * busca + 1
        sel = self.mask > 0
        jan = np.stack([reg[dy:dy + D, dx:dx + D][sel] for dy in range(n) for dx in range(n)])  # (n², px, 3)
        jan = jan - jan.mean(axis=1, keepdims=True)
        jan = jan.reshape(len(jan), -1)
        jan /= np.linalg.norm(jan, axis=1, keepdims=True) + 1e-6
        s = jan @ tpls.T                                    # (n², k)
        out = []
        for k in range(tpls.shape[0]):
            i = int(np.argmax(s[:, k]))
            out.append((float(s[i, k]), (x0 + i % n + D / 2, y0 + i // n + D / 2)))
        return out

    def detectar(self, mapa, mortos=()):
        """lista de Deteccao no quadro (mapa BGR lado×lado já recortado). mortos: nomes a ignorar"""
        cands = self._candidatos(mapa)
        vivos = [c for c in self.campeoes if c["campeao"] not in set(mortos)]
        pad = self.D + 4
        img = cv2.copyMakeBorder(mapa, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=0)
        grupos = {}
        for cp in vivos:
            grupos.setdefault("aliado" if cp["time"] == self.meu_time else "inimigo", []).append(cp)
        mats = {k: np.stack([c["vet"] for c in v]) for k, v in grupos.items()}
        pares = []
        for i, cd in enumerate(cands):
            if cd["lado"] not in grupos:
                continue
            for cp, (s, centro) in zip(grupos[cd["lado"]], self._rostos(img, pad, cd["p"], mats[cd["lado"]])):
                pares.append((s, i, cp, centro))
        pares.sort(key=lambda t: -t[0])
        usados_c, usados_k, out = set(), set(), []
        for s, i, cp, centro in pares:
            if s < LIMIAR_ROSTO or i in usados_c or cp["campeao"] in usados_k:
                continue
            # dois candidatos quase no mesmo centro (anel normal e grosso) contam como um só
            if any((centro[0] - d.u) ** 2 + (centro[1] - d.v) ** 2 < (self.r_anel * 0.6) ** 2 for d in out):
                continue
            usados_c.add(i)
            usados_k.add(cp["campeao"])
            cd = cands[i]
            x, y = px_para_mundo(centro[0], centro[1], self.lado)
            out.append(Deteccao(cp["campeao"], cp["id"], cp["time"], centro[0], centro[1], x, y,
                                round(cd["anel"], 3), round(s, 3), cd["grande"]))
        self._yuumi(out, vivos)
        return out

    def _yuumi(self, out, vivos):
        """Yuumi presa: o minimapa mostra só o hospedeiro com anel grosso. Se a Yuumi do time não foi
        vista e há exatamente um anel grosso do time dela, ela está ali (hospedeiro por eliminação)."""
        yu = [c for c in vivos if c["campeao"].lower() == "yuumi"]
        if not yu or any(d.campeao == yu[0]["campeao"] for d in out):
            return
        grossos = [d for d in out if d.grande and d.time == yu[0]["time"]]
        if len(grossos) == 1:
            g = grossos[0]
            out.append(Deteccao(yu[0]["campeao"], yu[0]["id"], g.time, g.u, g.v, g.x, g.y, g.anel, 0.0,
                                True, True))


# ---------- captura ao vivo ----------

def ler_game_cfg(caminho=GAME_CFG):
    out, sec = {}, None
    try:
        for ln in caminho.read_text(encoding="utf-8", errors="replace").splitlines():
            ln = ln.strip()
            if ln.startswith("[") and ln.endswith("]"):
                sec = out.setdefault(ln[1:-1], {})
            elif "=" in ln and sec is not None:
                k, v = ln.split("=", 1)
                sec[k.strip()] = v.strip()
    except OSError:
        pass
    return out


def monitor_do_jogo(monitores, cfg=None):
    """o monitor do jogo na lista do mss (`sct.monitors`: [0] = todos juntos): o da resolução do
    game.cfg; senão o principal (em (0, 0)). `monitors[1]` NÃO é o principal nesta máquina (é a 2ª tela)."""
    g = (ler_game_cfg() if cfg is None else cfg).get("General", {})
    w, h = int(float(g.get("Width", 0) or 0)), int(float(g.get("Height", 0) or 0))
    mons = monitores[1:] or monitores
    return next((m for m in mons if (m["width"], m["height"]) == (w, h)), None) or \
        next((m for m in mons if m.get("is_primary")), None) or \
        next((m for m in mons if m["left"] == 0 and m["top"] == 0), mons[0])


class Captura:
    """Laço de captura do minimapa (~6 fps) numa thread. Só captura com a janela do jogo em primeiro
    plano e a faixa do mapa no lugar; o retângulo é achado no 1º print de tela inteira e logado.

    campeoes_fn() -> {"meu_time": "ORDER"|"CHAOS", "campeoes": [{campeao, id, time}], "mortos": [nomes]}
    relogio() -> gameTime atual em s (estimado pelo laço ao vivo); visto_em usa esse relógio."""

    def __init__(self, campeoes_fn, relogio, fps=6.0, pasta_icones=PASTA_ICONES, guardar_quadros=60):
        self.campeoes_fn = campeoes_fn
        self.relogio = relogio
        self.intervalo = 1.0 / fps
        self.pasta_icones = pasta_icones
        self.ret = None
        self.monitor = None
        self.detector = None
        self._chave_det = None
        self.ultimas = {}           # campeao -> dict {campeao, time, x, y, visto_em}
        self.ultimo_quadro = None   # mapa BGR lado×lado do último quadro válido
        self.quadros = []           # [(gt, mapa)] 1 quadro válido a cada ~5 s, para regerar a grade
        self._max_quadros = guardar_quadros
        self._t_amostra = 0.0
        self.no_ar = False          # o último ciclo viu o jogo na tela
        self._lock = threading.Lock()
        self._parar = threading.Event()
        self._thread = None
        self.tempo_medio_ms = 0.0

    def iniciar(self):
        if self._thread and self._thread.is_alive():
            return
        self._parar.clear()
        self._thread = threading.Thread(target=self._laco, name="minimapa", daemon=True)
        self._thread.start()

    def parar(self):
        self._parar.set()

    def deteccoes(self, max_idade=None):
        """[{campeao, time, x, y, visto_em}] última posição vista de cada campeão (mundo 0–14870,
        visto_em = gameTime). max_idade em s filtra posições velhas."""
        agora = self.relogio()
        with self._lock:
            v = list(self.ultimas.values())
        return [dict(d) for d in v if max_idade is None or agora - d["visto_em"] <= max_idade]

    def _monitor(self, sct):
        return monitor_do_jogo(sct.monitors)

    def _detector(self, info, lado):
        chave = (info.get("meu_time"), lado,
                 tuple((c["campeao"], c["id"], c["time"]) for c in info.get("campeoes", [])))
        if self.detector is None or chave != self._chave_det:
            self.detector = Detector(info.get("campeoes", []), info.get("meu_time"), lado, self.pasta_icones)
            self._chave_det = chave
        return self.detector

    def processar(self, mapa, info, gt):
        """detecta num quadro já recortado e atualiza as últimas posições (separado para teste)"""
        det = self._detector(info, mapa.shape[0]).detectar(mapa, info.get("mortos", ()))
        # o anel grosso também é o de "voltando à base": Yuumi deduzida onde ela não teria como chegar
        # desde a última vez que foi vista (450 unidades/s) é descartada (recorte 442 da partida medida:
        # a Nilah voltava sozinha; a Yuumi estava na fonte 20 s antes, a 10 mil unidades)
        ant = self.ultimas.get("Yuumi")
        det = [d for d in det if not (d.yuumi and ant and gt - ant["visto_em"] <= 60 and
                                      math.hypot(d.x - ant["x"], d.y - ant["y"]) > 1000 + 450 * (gt - ant["visto_em"]))]
        with self._lock:
            for d in det:
                self.ultimas[d.campeao] = {"campeao": d.campeao, "time": d.time, "x": round(d.x), "y": round(d.y),
                                           "visto_em": round(gt, 1)}
            self.ultimo_quadro = mapa
            if gt - self._t_amostra >= 5:
                self._t_amostra = gt
                self.quadros = (self.quadros + [(gt, mapa)])[-self._max_quadros:]
        return det

    def _laco(self):
        import mss  # só aqui: o resto do módulo (testes, overlay) não precisa do mss
        cfg = ler_game_cfg().get("HUD", {})
        flip = cfg.get("FlipMiniMap", "0") == "1"
        with mss.MSS() as sct:
            while not self._parar.is_set():
                t0 = time.perf_counter()
                try:
                    self._ciclo(sct, flip)
                except Exception as e:  # nunca derruba o coletor
                    log.warning("minimapa: %s", e)
                    self.no_ar = False
                dt = time.perf_counter() - t0
                self.tempo_medio_ms = 0.9 * self.tempo_medio_ms + 0.1 * dt * 1000
                self._parar.wait(max(0.02, self.intervalo - dt))

    def _ciclo(self, sct, flip):
        if not janela_do_jogo_em_primeiro_plano():
            self.no_ar = False
            self._parar.wait(0.5)
            return
        if self.ret is None:
            self.monitor = self._monitor(sct)
            tela = np.asarray(sct.grab(self.monitor))[:, :, :3]
            ret = achar_mapa(tela, flip)
            if ret is None:
                self._parar.wait(1.0)
                return
            self.ret = Retangulo(self.monitor["left"] + ret.left, self.monitor["top"] + ret.top, ret.lado)
            log.info("minimapa: mapa %d px em (%d, %d)", ret.lado, self.ret.left, self.ret.top)
        m = 6
        reg = {"left": self.ret.left - m, "top": self.ret.top - m,
               "width": self.ret.lado + 2 * m, "height": self.ret.lado + 2 * m}
        img = np.ascontiguousarray(np.asarray(sct.grab(reg))[:, :, :3])
        local = Retangulo(m, m, self.ret.lado)
        if not jogo_na_tela(img, local):
            self.no_ar = False
            return
        self.no_ar = True
        self.processar(np.ascontiguousarray(local.recorte(img)), self.campeoes_fn(), self.relogio())

    def ultimo_terreno(self):
        q = self.ultimo_quadro
        return terreno(q) if q is not None else None

    def salvar_estado(self, caminho):
        """para depurar: últimas posições e retângulo (nada de imagem, nada de identidade)"""
        Path(caminho).write_text(json.dumps({"ret": self.ret.__dict__ if self.ret else None,
                                             "ultimas": list(self.ultimas.values())}, ensure_ascii=False))
