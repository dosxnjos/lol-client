# modo vitrine (pedido do Gabriel, 13/10/2026): prints que MOSTRAM o overlay do minimapa e a moldura
# funcionando numa partida de verdade. As duas janelas ficam fora do print de propósito
# (WDA_EXCLUDEFROMCAPTURE: senão o próprio coach leria o overlay ao capturar o minimapa; ARMADILHAS §
# Tela), então a vitrine NÃO liga a exclusão: grava o print do jogo (que não vê as janelas) e compõe por
# cima a camada que o coach desenhou naquele instante (overlay: a imagem do `renderizar`, na mesma
# posição, chave e alfa; moldura: a mesma rotina GDI da janela, `moldura.renderizar`).
#
# Liga para UMA partida (`python tools/vitrine.py ligar`): marca em dados/vitrine.json (pasta do banco),
# válida por 3 h até a partida começar; a partida que começa consome e, ao acabar, apaga a marca.
# Só grava com o jogo JÁ em primeiro plano: nunca traz janela para a frente, nunca manda tecla ou clique
# (incidente de foco de 13/10/2026, ARMADILHAS § Tela). Tudo numa thread própria: o laço do coach, o Tk
# do overlay e o fio da moldura só enfileiram. Falha de disco ou de print só vai para o log.
# Saída: temp/vitrine/<AAAA-MM-DD>/ (pngs + vitrine.jsonl); passa por revisão de privacidade antes de
# entrar em qualquer resumo (LEIA-ME-privacidade.txt na pasta).
import datetime
import json
import logging
import os
import queue
import threading
import time
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parent.parent
MARCA_NOME = "vitrine.json"
MARCA_PADRAO = RAIZ / "dados" / MARCA_NOME
PASTA_PADRAO = RAIZ / "temp" / "vitrine"
VALIDADE_H = 3.0
INTERVALO_S = 90.0          # 1 print a cada 90 s por tipo: com 20 s os 25 acabaram aos 8 min (14/10/2026)
MAXIMO = 25                 # por partida
MARGEM = 40                 # px em volta do minimapa no recorte
LARGURA_TELA = 1280         # tela inteira (moldura) reduzida para esta largura
BLOCO_PRIVACIDADE = 24      # px do pixelado nas regiões com nome de jogador
# regiões da tela inteira (frações da janela do jogo: x0, y0, x1, y1) pixeladas antes de gravar:
#   chat medido nesta HUD (x 1400–1800, y 830–975 em 2560×1080; ARMADILHAS § Tela), canto de baixo à
#   esquerda (onde o chat fica na HUD padrão) e o topo central (placar). Nome sobre a barra de vida não
#   tem lugar fixo: a redução para 1280 px borra, a revisão de privacidade confere.
PRIVACIDADE = ((0.53, 0.74, 0.72, 0.92), (0.0, 0.62, 0.30, 1.0), (0.30, 0.0, 0.70, 0.10))
LEIA_ME = ("Prints do modo vitrine (coletor/vitrine.py). Antes de usar em resumo, apresentação ou mensagem:\n"
           "revisão de privacidade. Nomes de outros jogadores podem aparecer (barras de vida, placar com Tab,\n"
           "avisos de abate no canto superior direito, chat fora da posição medida). O recorte do minimapa quase não tem nome; a tela inteira já vai\n"
           "reduzida e com chat e topo central pixelados, mas não é garantia. Campo revisao_privacidade no\n"
           "vitrine.jsonl: 'pendente' até alguém olhar.\n")

log = logging.getLogger("coletor.vitrine")


# ---------- marca (liga para uma partida) ----------

def ler(caminho=MARCA_PADRAO):
    try:
        m = json.loads(Path(caminho).read_text(encoding="utf-8"))
        return m if isinstance(m, dict) else None
    except (OSError, ValueError):
        return None


def _gravar(caminho, m):
    caminho = Path(caminho)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    tmp = caminho.with_name(caminho.name + ".tmp")
    tmp.write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, caminho)


EM_USO_H = 2.0   # marca consumida há menos que isto = partida em andamento (mais velha = sobra de queda)


def em_uso(m, agora=None):
    """game_id (ou "?") da partida que está gravando com esta marca agora; None se nenhuma"""
    agora = time.time() if agora is None else agora
    c = (m or {}).get("consumida_por")
    if c and agora - float(c.get("em") or 0) < EM_USO_H * 3600:
        return c.get("game_id") or "?"
    return None


def ligar(caminho=MARCA_PADRAO, horas=VALIDADE_H, agora=None):
    """grava a marca; com uma partida gravando agora (marca consumida há < 2 h) recusa e devolve None:
    sobrescrever faria o fim dessa partida apagar a marca nova (a próxima não gravaria)"""
    agora = time.time() if agora is None else agora
    if em_uso(ler(caminho), agora) is not None:
        return None
    m = {"ligada_em": agora, "expira_em": agora + horas * 3600, "consumida_por": None, "gravados": 0}
    _gravar(caminho, m)
    return m


def desligar(caminho=MARCA_PADRAO):
    try:
        Path(caminho).unlink()
        return True
    except FileNotFoundError:
        return False


def estado(caminho=MARCA_PADRAO, agora=None):
    """{"ligada": bool, "motivo": str, "marca": dict|None} para o tools/vitrine.py estado"""
    agora = time.time() if agora is None else agora
    m = ler(caminho)
    if not m:
        return {"ligada": False, "motivo": "desligada (sem marca)", "marca": None}
    c = m.get("consumida_por")
    if c and em_uso(m, agora) is not None:
        return {"ligada": True, "motivo": f"em uso na partida {c.get('game_id')} ({m.get('gravados', 0)} prints)",
                "marca": m}
    if c:
        return {"ligada": False, "motivo": f"sobra da partida {c.get('game_id')} (coletor caiu?); `ligar` sobrescreve",
                "marca": m}
    if agora > float(m.get("expira_em") or 0):
        return {"ligada": False, "motivo": "expirada (nenhuma partida começou em 3 h)", "marca": m}
    resta = (float(m["expira_em"]) - agora) / 60
    return {"ligada": True, "motivo": f"esperando a próxima partida (expira em {resta:.0f} min)", "marca": m}


def da_partida(caminho, game_id, relogio, agora=None, **kw):
    """chamado quando a partida começa: Vitrine se a marca vale para ela (e consome a marca), senão None.
    Coletor que CAIU no meio da partida (sem parar()), ou a mesma partida recomeçada no processo (Reconnect,
    fase relida), retoma; reinício limpo passa pelo parar() e encerra a vitrine. Consumida sem game_id (o
    GET da sessão falhou no InProgress) vale para a partida que vier com id, e o id real é gravado. Marca
    de outra partida (sobra de queda) é apagada."""
    agora = time.time() if agora is None else agora
    m = ler(caminho)
    if not m:
        return None
    c = m.get("consumida_por")
    sem_id = c is not None and c.get("game_id") is None
    if c and ((sem_id and em_uso(m, agora) is None) or (not sem_id and game_id is not None
                                                          and c.get("game_id") != game_id)):
        desligar(caminho)
        log.info("vitrine: marca da partida %s sobrou (coletor caiu?); apagada", c.get("game_id"))
        return None
    if sem_id and game_id is not None:
        c["game_id"] = game_id
        _gravar(caminho, m)
    if c and game_id is None:
        game_id = c.get("game_id")   # mesma partida, o GET da sessão é que falhou agora
    if not c and agora > float(m.get("expira_em") or 0):
        desligar(caminho)
        log.info("vitrine: marca expirou sem partida; apagada")
        return None
    if not c:
        m["consumida_por"] = {"game_id": game_id, "em": agora}
        _gravar(caminho, m)
    log.info("vitrine ligada na partida %s (até %d prints, 1 a cada %.0f s por tipo)", game_id,
             kw.get("maximo", MAXIMO), kw.get("intervalo_s", INTERVALO_S))
    return Vitrine(relogio, game_id=game_id, marca=caminho, gravados=int(m.get("gravados") or 0), **kw)


# ---------- composição ----------

def compor(fundo, camada, x, y, alfa, chave):
    """o que aparece na tela: `camada` (RGB) em (x, y) sobre `fundo` (RGB), com os px da `chave`
    transparentes e o resto misturado com alfa 0–255 (o mesmo byte da janela layered).
    A camada pode passar da borda do fundo (é cortada)."""
    out = fundo.copy()
    h, w = camada.shape[:2]
    H, W = fundo.shape[:2]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if x0 >= x1 or y0 >= y1:
        return out
    c = camada[y0 - y:y1 - y, x0 - x:x1 - x].astype(np.uint16)
    f = out[y0:y1, x0:x1].astype(np.uint16)
    m = np.any(c != np.array(chave, np.uint16), axis=2)
    mist = (c * alfa + f * (255 - alfa) + 127) // 255
    f[m] = mist[m]
    out[y0:y1, x0:x1] = f.astype(np.uint8)
    return out


def pixelar(img, regioes=PRIVACIDADE, bloco=BLOCO_PRIVACIDADE):
    """regiões (frações da imagem) viram mosaico de blocos: texto ilegível, cor geral preservada"""
    import cv2
    out = img.copy()
    H, W = out.shape[:2]
    for fx0, fy0, fx1, fy1 in regioes:
        x0, y0, x1, y1 = int(fx0 * W), int(fy0 * H), int(fx1 * W), int(fy1 * H)
        if x1 - x0 < 2 or y1 - y0 < 2:
            continue
        r = out[y0:y1, x0:x1]
        p = cv2.resize(r, (max(1, (x1 - x0) // bloco), max(1, (y1 - y0) // bloco)), interpolation=cv2.INTER_AREA)
        out[y0:y1, x0:x1] = cv2.resize(p, (x1 - x0, y1 - y0), interpolation=cv2.INTER_NEAREST)
    return out


def _cortar(reg, mon):
    """interseção de (left, top, w, h) com o monitor do mss; None se vazia. `mon` pode ser a lista de
    monitores: vale o que tem a maior área da região (a geometria do overlay e da moldura já é a da tela
    onde o jogo está, em px físicos; o recorte não vaza para a outra tela)"""
    if isinstance(mon, (list, tuple)):
        cortes = [c for c in (_cortar(reg, m) for m in mon) if c]
        return max(cortes, key=lambda c: c["width"] * c["height"], default=None)
    L, T, w, h = reg
    x0, y0 = max(L, mon["left"]), max(T, mon["top"])
    x1, y1 = min(L + w, mon["left"] + mon["width"]), min(T + h, mon["top"] + mon["height"])
    if x0 >= x1 or y0 >= y1:
        return None
    return {"left": x0, "top": y0, "width": x1 - x0, "height": y1 - y0}


# ---------- peças de verdade (o teste troca) ----------

def _print(reg):
    """RGB da região (px físicos). Um MSS por print, criado nesta thread (o do mss é preso à thread)"""
    import mss
    with mss.MSS() as s:
        return np.ascontiguousarray(np.asarray(s.grab(reg))[:, :, 2::-1])


def _monitor():
    """todos os monitores (px físicos: o mss liga o DPI por monitor antes de listar). Não usa o
    minimapa.monitor_do_jogo: ele acha a tela pela resolução do game.cfg e, com 2 telas, pode escolher a
    errada; aí o recorte saía vazio e nada era gravado (revisão de 13/10/2026)"""
    import mss
    with mss.MSS() as s:
        return [dict(m) for m in s.monitors[1:]]


def _primeiro_plano():
    import minimapa   # só lê o título da janela da frente; nunca muda a janela da frente
    return minimapa.janela_do_jogo_em_primeiro_plano()


def _camada_moldura(l, a, cor, rotulo, espessura):
    import moldura
    return moldura.renderizar(l, a, cor, rotulo, espessura)


def _salvar_png(caminho, rgb_ou_rgba):
    from PIL import Image
    Image.fromarray(rgb_ou_rgba).save(caminho, optimize=False, compress_level=3)


# ---------- a vitrine de uma partida ----------

class Vitrine:
    """overlay(img, ret, quadro) e moldura(cor, rotulo, geo, espessura) são os ganchos (chamados do Tk
    do overlay e do fio da moldura): só conferem a taxa e enfileiram. A thread "vitrine" confere o jogo
    em primeiro plano, tira o print, compõe e grava. parar() fecha a thread e apaga a marca."""

    def __init__(self, relogio, game_id=None, marca=None, pasta=PASTA_PADRAO, intervalo_s=INTERVALO_S,
                 maximo=MAXIMO, gravados=0, primeiro_plano=_primeiro_plano, capturar=_print, monitor=_monitor,
                 camada_moldura=_camada_moldura, agora=time.monotonic, alfa_overlay=None, chave_overlay=None):
        import overlay_minimapa
        self.relogio, self.game_id, self.marca, self.pasta = relogio, game_id, marca, Path(pasta)
        self.intervalo, self.maximo, self.n = intervalo_s, maximo, gravados
        self.primeiro_plano, self.capturar, self.monitor = primeiro_plano, capturar, monitor
        self.camada_moldura, self.agora = camada_moldura, agora
        # o mesmo byte que o Tk passa ao SetLayeredWindowAttributes (-alpha 0.55 -> 140) e a mesma chave
        self.alfa_overlay = int((overlay_minimapa.ALPHA if alfa_overlay is None else alfa_overlay) * 255)
        self.chave_overlay = tuple(overlay_minimapa.CHAVE if chave_overlay is None else chave_overlay)
        self.tipo_aviso = None            # f(rotulo) -> tipo do aviso (o coach liga ao motor); None = sem
        self.descartados = 0              # jogo fora do primeiro plano antes ou logo depois do print
        self.sem_recorte = 0              # região fora de todo monitor
        self.falhas = 0
        self._ultimo = {}                 # tipo -> agora() do último print gravado
        self._pendente = set()            # tipo na fila (o overlay chama a cada 0,4 s)
        self._fila = queue.Queue(maxsize=4)
        self._parar = threading.Event()
        self._avisado = {}
        self._thread = threading.Thread(target=self._laco, name="vitrine", daemon=True)
        self._thread.start()

    # -- ganchos (threads dos outros: só enfileiram) --
    def _livre(self, tipo):
        return (not self._parar.is_set() and self.n < self.maximo and tipo not in self._pendente
                and self.agora() - self._ultimo.get(tipo, float("-inf")) >= self.intervalo)

    def _por(self, tipo, item):
        self._pendente.add(tipo)
        try:
            self._fila.put_nowait((tipo, item, self.agora(), self._gt()))
        except queue.Full:
            self._pendente.discard(tipo)

    def _gt(self):
        try:
            return round(float(self.relogio()), 1)
        except Exception:
            return None

    def overlay(self, img, ret, quadro=None):
        q = quadro or {}
        tipo = "overlay-calor" if q.get("calor") is not None else "overlay-texto"
        if self._livre(tipo):
            self._por(tipo, {"img": img, "ret": tuple(int(v) for v in ret), "texto": q.get("texto")})

    def moldura(self, cor, rotulo, geo, espessura):
        tipo = f"moldura-{cor}"
        if self._livre(tipo):
            self._por(tipo, {"cor": cor, "rotulo": rotulo, "geo": tuple(int(v) for v in geo),
                             "espessura": int(espessura)})

    # -- thread da vitrine --
    def _laco(self):
        while not self._parar.is_set():
            try:
                tipo, item, quando, gt = self._fila.get(timeout=0.5)
            except queue.Empty:
                continue
            if tipo is None:
                break
            try:
                self._processar(tipo, item, quando, gt)
            except Exception as e:   # disco cheio, mss fora, numpy: só loga; o coach segue
                self.falhas += 1
                self._avisar("falha", "vitrine: print %s falhou: %s: %s", tipo, type(e).__name__, e)
            finally:
                self._pendente.discard(tipo)

    def _avisar(self, chave, msg, *a):
        agora = time.monotonic()
        if agora - self._avisado.get(chave, -1e9) >= 60:
            self._avisado[chave] = agora
            log.warning(msg, *a)

    def _processar(self, tipo, item, quando, gt):
        if self.n >= self.maximo:
            return
        mon = self.monitor()   # antes da conferência: entre ela e o print fica só o grab
        if not self.primeiro_plano():
            self.descartados += 1
            self._avisar("fora", "vitrine: jogo fora do primeiro plano na hora do print (%s); pulado", tipo)
            return
        if tipo.startswith("overlay"):
            arquivos, extra = self._overlay(item, mon)
        else:
            arquivos, extra = self._moldura(item, mon)
        if arquivos is None:   # região fora de todo monitor: espera o intervalo do tipo (sem tentar a cada 0,4 s)
            self._ultimo[tipo] = quando
            self.sem_recorte += 1
            self._avisar("recorte", "vitrine: %s fora de todo monitor (%s); pulado", tipo, extra)
            return
        if not arquivos:       # alt-tab entre a conferência e o print: o print pode ter outra janela
            self.descartados += 1
            self._avisar("fora", "vitrine: jogo saiu da frente durante o print (%s); descartado", tipo)
            return
        self._ultimo[tipo] = quando
        self.n += 1
        linha = {"ts": datetime.datetime.now().isoformat(timespec="seconds"), "game_id": self.game_id,
                 "gameTime": gt, "tipo": tipo, **extra, "arquivos": arquivos, "revisao_privacidade": "pendente"}
        with open(self._dia() / "vitrine.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(linha, ensure_ascii=False) + "\n")
        self._contar()
        log.info("vitrine: %s gravado (%d/%d): %s", tipo, self.n, self.maximo, ", ".join(arquivos))

    def _dia(self):
        d = self.pasta / datetime.date.today().isoformat()
        if not d.exists():
            d.mkdir(parents=True, exist_ok=True)
        leia = d / "LEIA-ME-privacidade.txt"
        if not leia.exists():
            leia.write_text(LEIA_ME, encoding="utf-8")
        return d

    def _nome(self, tipo, sufixo):
        return f"{datetime.datetime.now():%H%M%S}-{self.n + 1:02d}-{tipo}-{sufixo}.png"

    def _overlay(self, item, mon):
        img, (L, T, lado) = item["img"], item["ret"]
        reg = _cortar((L - MARGEM, T - MARGEM, lado + 2 * MARGEM, lado + 2 * MARGEM), mon)
        if reg is None:
            return None, f"ret {L},{T},{lado}"
        fundo = self.capturar(reg)
        if not self.primeiro_plano():
            return [], None
        comp = compor(fundo, img, L - reg["left"], T - reg["top"], self.alfa_overlay, self.chave_overlay)
        # a camada exata do renderizar (px da chave = transparente), para conferir e recompor depois
        camada = np.dstack([img, np.where(np.all(img == np.array(self.chave_overlay, np.uint8), axis=2), 0, 255)
                            .astype(np.uint8)])
        d = self._dia()
        a1, a2 = self._nome("minimapa", "composto"), self._nome("minimapa", "camada")
        _salvar_png(d / a1, comp)
        _salvar_png(d / a2, camada)
        return [a1, a2], {"texto": item["texto"], "ret": [L, T, lado],
                          "recorte": [reg["left"], reg["top"], reg["width"], reg["height"]],
                          "alfa": self.alfa_overlay}

    def _moldura(self, item, mon):
        x, y, l, a = item["geo"]
        reg = _cortar((x, y, l, a), mon)
        if reg is None:
            return None, f"geo {x},{y},{l}x{a}"
        fundo = self.capturar(reg)
        if not self.primeiro_plano():
            return [], None
        fundo = pixelar(fundo)   # privacidade antes de compor: a borda e o rótulo ficam nítidos
        camada = self.camada_moldura(l, a, item["cor"], item["rotulo"], item["espessura"])
        # alfa 255: no instante do aviso o pulso começa no máximo (moldura._pulsar com agora == t0)
        comp = compor(fundo, camada, x - reg["left"], y - reg["top"], 255, (255, 0, 255))
        if comp.shape[1] > LARGURA_TELA:
            import cv2
            comp = cv2.resize(comp, (LARGURA_TELA, round(comp.shape[0] * LARGURA_TELA / comp.shape[1])),
                              interpolation=cv2.INTER_AREA)
        tipo_aviso = None
        if self.tipo_aviso is not None:
            try:
                tipo_aviso = self.tipo_aviso(item["rotulo"])
            except Exception:
                pass
        nome = self._nome(f"moldura-{item['cor']}", "tela")
        _salvar_png(self._dia() / nome, comp)
        return [nome], {"aviso": tipo_aviso, "cor": item["cor"], "rotulo": item["rotulo"], "geo": [x, y, l, a],
                        "espessura": item["espessura"], "alfa": 255}

    def _minha(self):
        """a marca no disco é a que esta partida consumiu (um `ligar` novo não é tocado nem apagado)"""
        m = ler(self.marca) if self.marca is not None else None
        c = (m or {}).get("consumida_por")
        return m if c and c.get("game_id") == self.game_id else None

    def _contar(self):
        m = self._minha()
        if m:
            m["gravados"] = self.n
            _gravar(self.marca, m)

    def parar(self, apagar_marca=True):
        """fim da partida: fecha a thread (o que estava na fila é descartado) e desliga a vitrine.
        apagar_marca=False: a mesma partida recomeça no processo (o coach passa fim=False) e retoma"""
        if not self._parar.is_set():
            self._parar.set()
            try:
                self._fila.put_nowait((None, None, None, None))
            except queue.Full:
                pass
            if self._thread is not threading.current_thread():
                self._thread.join(3)
            log.info("vitrine: %d print(s) na partida %s em %s (fora do primeiro plano: %d, fora do monitor: %d, "
                     "falhas: %d)", self.n, self.game_id, self.pasta, self.descartados, self.sem_recorte, self.falhas)
        if apagar_marca and self._minha() is not None:
            desligar(self.marca)
