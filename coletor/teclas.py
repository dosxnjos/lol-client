# atalhos do coach por OBSERVAÇÃO do teclado (partida de 14/10/2026 15:48): o RegisterHotKey nunca dispara com o
# LoL em primeiro plano. Certo: nenhum "F9 recebido" nem "overlay ... (F8)" em duas partidas, e o F8 não tem tecla no
# LoL do Gabriel, então o F9 ligado no jogo (evtToggleMouseClip, a "borda vermelha fina" do cursor travado) não explica
# o silêncio. Hipótese: o jogo registra raw input com RIDEV_NOHOTKEYS, que desliga hotkey de aplicativo com ele na
# frente. Risco que sobra (UIPI): GetAsyncKeyState devolve 0 se o jogo roda com integridade maior que o coletor (Riot
# Client aberto como administrador); o log diz no início se o coletor está elevado. Aqui só se LÊ o estado da tecla
# (GetAsyncKeyState, o que o OBS faz para os atalhos dele) numa thread própria: nada é enviado ao jogo, nenhuma tecla é
# comida (a tecla segue para quem tem o foco), nada entra no processo do jogo. Sem hook de teclado (WH_KEYBOARD_LL):
# com o GIL ocupado (minimapa, overlay) o hook atrasaria TODA tecla do jogo; o polling não atrasa nada.
# Por isso o atalho usa teclas que o LoL do Gabriel não usa (Config\input.ini e PersistedSettings.json, 14/10/2026:
# F1–F5 câmera, F9 trava o cursor, Ctrl+F10 HUD; 1, 2, 3, 5, t, y itens, 4 sentinela; numérico nenhum). Os números
# de cima NUNCA são do coach: ler não tira a tecla do jogo, então o número dispararia o item junto (o note dele nem
# tem numérico: desde 14/10 ~20:30 o atalho é só o F7, batidas e segurar; o numérico fica opcional).
import ctypes
import json
import logging
import re
import threading
import time
from pathlib import Path

log = logging.getLogger("coletor.teclas")   # cai no dados\coletor.log (handler do logger "coletor")

VK = {"F7": 0x76, "F8": 0x77, "F9": 0x78, "F10": 0x79, "F11": 0x7A, "F12": 0x7B,
      **{f"Num {i}": 0x60 + i for i in range(10)}}
NOME = {v: k for k, v in VK.items()}
INTERVALO_S = 0.025   # aperto de tecla dura ~80–150 ms: 25 ms não perde nenhum e custa ~0 de CPU


def _estado_real():
    u = ctypes.WinDLL("user32", use_last_error=True)
    u.GetAsyncKeyState.argtypes = [ctypes.c_int]
    u.GetAsyncKeyState.restype = ctypes.c_short
    return lambda vk: bool(u.GetAsyncKeyState(vk) & 0x8000)   # só o bit "apertada agora" (o 0x0001 não é confiável)


class Observador:
    """passo() lê as `teclas` (vk) e chama ao_apertar(vk) na borda solta -> apertada, só com na_tela() verdadeiro (o
    jogo em primeiro plano: F7 no navegador com o Gabriel morto não marca nada). Segurar a tecla = 1 aperto.
    estado(vk) -> bool é injetável (teste, sem tecla nenhuma). rodar(parar) é o laço da thread; tique() (opcional)
    roda a cada volta, depois das bordas (a janela das batidas do F7 fecha por ele). ao_soltar(vk) (opcional) na
    borda apertada -> solta, em qualquer janela (quem usa ignora a soltura de um aperto que não contou): é o que
    separa bater de segurar."""

    def __init__(self, teclas, ao_apertar, na_tela=None, estado=None, intervalo=INTERVALO_S, tique=None,
                 ao_soltar=None):
        self.teclas = tuple(teclas)
        self.ao_apertar, self.na_tela, self.tique, self.ao_soltar = ao_apertar, na_tela, tique, ao_soltar
        self.estado = estado or _estado_real()
        self.intervalo = intervalo
        self._antes = {vk: True for vk in self.teclas}   # começa "apertada": tecla já segura ao ligar não conta
        self.apertos = 0

    def passo(self):
        out, soltas = [], []
        for vk in self.teclas:
            agora = self.estado(vk)
            if agora and not self._antes[vk]:
                out.append(vk)
            elif not agora and self._antes[vk]:
                soltas.append(vk)
            self._antes[vk] = agora
        if out and (self.na_tela is None or self.na_tela()):
            for vk in out:
                self.apertos += 1
                self._chamar(self.ao_apertar, vk)
        if self.ao_soltar is not None:
            for vk in soltas:
                self._chamar(self.ao_soltar, vk)
        if self.tique is not None:
            self.tique()
        return out

    @staticmethod
    def _chamar(f, vk):
        try:
            f(vk)
        except Exception as e:   # callback quebrado não mata a thread (exceção na thread some calada)
            log.warning("teclas: tratamento de %s falhou: %s: %s", NOME.get(vk, vk), type(e).__name__, e)

    def rodar(self, parar):
        try:
            while not parar.wait(self.intervalo):
                self.passo()
        except Exception as e:   # a tecla ficaria muda sem rastro (a thread só iria ao excepthook genérico)
            log.warning("teclas: observação de %s morreu: %s: %s", "/".join(NOME.get(v, hex(v)) for v in self.teclas),
                        type(e).__name__, e)
            raise


def elevado():
    """True = o coletor roda como administrador; None = não deu para saber"""
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return None


def em_thread(obs, nome):
    """liga o Observador numa thread daemon; devolve o Event que para"""
    log.info("teclas: %s observando %s (coletor como administrador: %s; jogo elevado e coletor não = tecla não vista)",
             nome, "/".join(NOME.get(v, hex(v)) for v in obs.teclas), {True: "sim", False: "não"}.get(elevado(), "?"))
    parar = threading.Event()
    t = threading.Thread(target=obs.rodar, args=(parar,), daemon=True, name=nome)
    t.start()
    return parar, t


def config_lol():
    """<pasta do LoL>\\Config (instalacao.arquivo_lol: a do client aberto, a do Riot Client, a padrão da Riot; ao lado do
    game.cfg), ou None. Antes era C:\\Games\\Riot Games fixo (P4 da publicação)"""
    try:
        import instalacao
        return instalacao.arquivo_lol("Config")
    except Exception:
        return None


def _ligacoes(pasta=None):
    """[(evento, valor)] das teclas do LoL: input.ini (o que o Gabriel mudou) e PersistedSettings.json (tudo)"""
    out = []
    pasta = pasta or config_lol()
    if pasta is None:
        return out
    try:
        for ln in (Path(pasta) / "input.ini").read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.match(r"\s*(ev\w+)\s*=\s*(.+)$", ln)
            if m:
                out.append((m.group(1), m.group(2)))
    except OSError:
        pass
    try:
        d = json.loads((Path(pasta) / "PersistedSettings.json").read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError):
        d = None

    def andar(o):
        if isinstance(o, dict):
            if isinstance(o.get("name"), str) and isinstance(o.get("value"), str) and o["name"].startswith("ev"):
                out.append((o["name"], o["value"]))
            for v in o.values():
                andar(v)
        elif isinstance(o, list):
            for v in o:
                andar(v)
    andar(d)
    return out


def conflitos_no_lol(nomes, pasta=None):
    """{nome: [eventos do LoL ligados a essa tecla SOZINHA]} ("[Ctrl][F10]" não conflita com F10). Sem a pasta = {}"""
    out = {}
    for evento, valor in _ligacoes(pasta):
        for combo in valor.split(","):
            combo = combo.strip()
            for nome in nomes:
                if combo == f"[{nome}]":
                    out.setdefault(nome, [])
                    if evento not in out[nome]:
                        out[nome].append(evento)
    return out


def avisar_conflitos(nomes, quem):
    """log de aviso se o Gabriel ligou no LoL alguma tecla que o coach observa (a tecla faria as duas coisas)"""
    try:
        c = conflitos_no_lol(nomes)
    except Exception as e:
        log.warning("%s: não deu para ler as teclas do LoL: %s", quem, e)
        return {}
    for nome, eventos in c.items():
        log.warning("%s: %s também é tecla do LoL (%s): apertar faz as duas coisas", quem, nome, ", ".join(eventos))
    return c


def sonda(segundos=30.0, nomes=("F7", "F8", "F9", "Num 1", "Num 2", "Num 3", "Num 4", "Num 5")):
    """imprime cada tecla observada (em qualquer janela) por `segundos`: separa "o teclado não manda" (camada Fn) de
    "o coach não vê". Com o jogo aberto também funciona: só lê."""
    vistos = []

    def apertou(vk):
        vistos.append(vk)
        print(f"{time.strftime('%H:%M:%S')} {NOME.get(vk, vk)} observado")
    obs = Observador([VK[n] for n in nomes], apertou)
    print(f"aperte {', '.join(nomes)} nos próximos {segundos:.0f} s (Ctrl+C sai)")
    fim = time.monotonic() + segundos
    try:
        while time.monotonic() < fim:
            obs.passo()
            time.sleep(obs.intervalo)
    except KeyboardInterrupt:
        pass
    print(f"{len(vistos)} tecla(s) observada(s)" + ("" if vistos else ": nada (tecla Fn/multimídia? NumLock desligado?)"))
    return 0
