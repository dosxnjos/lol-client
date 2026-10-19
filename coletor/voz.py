# voz do coach (plano v2, passo 12): um PowerShell persistente com System.Speech (voz Maria
# pt-BR) lendo frases do stdin; abrir um PowerShell por frase custa ~1 s. Fila com prioridade:
# urgente (gank) corta a fala em curso. O intervalo mínimo entre avisos é do motor (avisos.py),
# não daqui. Protocolo só ASCII (frase em base64 UTF-8): acento não quebra e texto nunca vira código.
# Voz pré-gravada (plano voz pré-gravada, passo 7): frase que está no pacote ativo
# (%LOCALAPPDATA%\lol-client\voz\pacotes\<nome>\, gerado por tools/gerar-pacote-voz.py) toca o .wav na
# mesma fila (prioridade, urgente corta, validade igual); fora do pacote, Maria ao vivo + registro em
# dados/voz-faltou.jsonl (a próxima geração completa). Sem a pasta do pacote: só Maria, como antes.
# uso: python -c "from coletor.voz import falar; falar('teste do coach')"
import atexit
import base64
import ctypes
import heapq
import itertools
import json
import os
import queue
import subprocess
import threading
import time
import wave
from pathlib import Path

VOZ_PADRAO = "Microsoft Maria Desktop"
RAIZ = Path(__file__).resolve().parent.parent
PACOTES_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "lol-client" / "voz" / "pacotes"
# pacote ativo: escolha do Gabriel em 13/10/2026 ("quero a aoede do gemini"). Config local do coletor (sem
# chave no plugin nesta rodada); LOL_VOZ_PACOTE troca ("" = só Maria). Pasta ausente = Maria.
PACOTE_PADRAO = os.environ.get("LOL_VOZ_PACOTE", "aoede")
FALTOU_PADRAO = RAIZ / "dados" / "voz-faltou.jsonl"
_PADRAO = object()   # sentinela: "o pacote padrão" (só fora do teste seco)


def normalizar(texto):
    """mesma regra do avisos.normalizar_fala (chave do pacote): espaços colapsados"""
    return " ".join(str(texto).split())


def duracao_wav(caminho):
    with wave.open(str(caminho), "rb") as w:
        return w.getnframes() / float(w.getframerate() or 1)


class Pacote:
    """índice de um pacote de voz: indice.json = {"voz", "modelo", "versao_catalogo", "frases": {fala:
    {"arquivo": "<hash>.wav", ...}}}. arquivo(texto) -> Path do .wav ou None (fora do pacote / arquivo sumiu).
    O gerador agendado (tools/voz-agendada.py) acrescenta e troca falas entre as partidas: um Voz novo por partida
    já abre o pacote de novo, e relido() pega a troca no meio de uma (antes de uma fala, nunca durante)."""

    def __init__(self, pasta):
        self.pasta = Path(pasta)
        self._indice = self.pasta / "indice.json"
        self.mtime = self._indice.stat().st_mtime_ns     # antes de ler: troca no meio = relê na próxima fala
        ind = json.loads(self._indice.read_text(encoding="utf-8"))
        self.nome = ind.get("voz") or self.pasta.name
        self.versao = ind.get("versao_catalogo")
        self.modelo = ind.get("modelo")
        self.frases = {}
        self.suspeitas = 0
        for fala, v in (ind.get("frases") or {}).items():
            arq = v.get("arquivo") if isinstance(v, dict) else v
            if isinstance(v, dict) and v.get("suspeita"):   # o Whisper ouviu outra coisa: Maria ao vivo
                self.suspeitas += 1
                continue
            # nome simples, nunca caminho: o pacote público vem do release (coletor/voz_pacote.py confere também)
            if isinstance(arq, str) and arq and "/" not in arq and "\\" not in arq and ":" not in arq and arq not in (".", ".."):
                self.frases[normalizar(fala)] = self.pasta / arq

    @classmethod
    def abrir(cls, nome=None, raiz=None, log=None):
        """o pacote `nome` (padrão PACOTE_PADRAO) ou None (sem nome, sem pasta, índice ilegível)"""
        nome = PACOTE_PADRAO if nome is None else nome
        if not nome:
            return None
        pasta = Path(raiz or PACOTES_DIR) / nome
        if not (pasta / "indice.json").exists():
            if log:
                log.info("voz: sem pacote %s (%s); Maria ao vivo", nome, pasta)
            return None
        try:
            p = cls(pasta)
        except (OSError, ValueError) as e:
            if log:
                log.warning("voz: pacote %s ilegível (%s); Maria ao vivo", nome, e)
            return None
        if log:
            log.info("voz: pacote %s com %d frases (catálogo %s, modelo %s; %d suspeita(s) na Maria)", p.nome,
                     len(p.frases), p.versao, p.modelo, p.suspeitas)
        return p

    def arquivo(self, texto):
        arq = self.frases.get(normalizar(texto))
        return arq if arq is not None and arq.exists() else None

    def relido(self, log=None):
        """o pacote relido se o indice.json mudou desde a leitura (o gerador acrescentou ou trocou falas, com
        arquivo novo por versão); senão self. Índice ilegível ou sumido no meio da troca: fica o que estava."""
        try:
            if self._indice.stat().st_mtime_ns == self.mtime:
                return self
            novo = type(self)(self.pasta)
        except (OSError, ValueError):
            return self
        if log:
            log.info("voz: pacote %s relido (%d -> %d frases)", self.nome, len(self.frases), len(novo.frases))
        return novo
CREATE_NO_WINDOW = 0x08000000
BELOW_NORMAL_PRIORITY_CLASS = 0x00004000
NORMAL_PRIORITY_CLASS = 0x00000020

# sem acento (o PowerShell 5.1 lê script sem BOM como ANSI); vai por -EncodedCommand
_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$escolhida = 'padrao'
try { $s.SelectVoice('__VOZ__'); $escolhida = $s.Voice.Name } catch { $escolhida = 'padrao:' + $s.Voice.Name }
$s.SetOutputToDefaultAudioDevice()
$s.Rate = __RATE__
$s.Volume = __VOL__
$p = $null
[Console]::Out.WriteLine('pronto ' + $escolhida); [Console]::Out.Flush()
while ($true) {
  $l = [Console]::In.ReadLine()
  if ($l -eq $null -or $l -eq 'Q') { break }
  if ($l -eq 'C') { $s.SpeakAsyncCancelAll(); continue }
  if ($l -eq 'S') {
    if ($p -eq $null -or $p.IsCompleted) { $r = 'livre' } else { $r = 'falando' }
    [Console]::Out.WriteLine($r); [Console]::Out.Flush(); continue
  }
  if ($l.StartsWith('F ')) {
    $t = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($l.Substring(2)))
    $p = $s.SpeakAsync($t)
  }
}
$s.SpeakAsyncCancelAll()
$s.Dispose()
"""


def prioridade_do_processo(abaixo=True):
    """Coletor abaixo do normal durante a partida (passo 12); False volta ao normal."""
    k = ctypes.windll.kernel32
    return bool(k.SetPriorityClass(k.GetCurrentProcess(),
                                   BELOW_NORMAL_PRIORITY_CLASS if abaixo else NORMAL_PRIORITY_CLASS))


class Voz:
    """falar(texto, urgente, prioridade) enfileira; um fio diz uma frase por vez (o .wav do pacote, ou a
    Maria pelo PowerShell) e espera ela acabar. Frase que esperou mais que `validade_s` é descartada (aviso
    velho não serve). `saida` = função(texto) troca o PowerShell por um registro (teste seco, sem som); no
    teste seco o pacote padrão NÃO é aberto (pacote= explícito liga) e frase do pacote também vai para a
    `saida` quando não há `tocar` (nunca som de verdade num teste). `tocar` = função(caminho, corte: Event)
    que toca o .wav e volta no fim ou quando `corte` acende (urgente). `faltou` = .jsonl das frases fora do
    pacote (1 linha por frase distinta por processo)."""
    MAX_FILA = 3

    def __init__(self, voz=VOZ_PADRAO, velocidade=1, volume=100, validade_s=10.0, saida=None, log=None,
                 pacote=_PADRAO, tocar=None, faltou=FALTOU_PADRAO):
        self.voz, self.velocidade, self.volume = voz, int(velocidade), int(volume)
        self.validade_s, self.saida, self.log = validade_s, saida, log
        if pacote is _PADRAO:
            pacote = None if saida is not None else Pacote.abrir(log=log)
        elif isinstance(pacote, (str, Path)):
            pacote = Pacote(pacote)
        self.pacote, self.tocar, self.faltou = pacote, tocar, faltou
        self.ligado = True
        self.escolhida = None           # nome da voz que o Windows usou (pronto <nome>)
        self.faladas = []               # (monotonic, texto) do que saiu
        self.fontes = []                # (texto, "pacote"|"maria") na mesma ordem
        self._faltas = set()            # frases fora do pacote já registradas neste processo
        self._heap, self._seq = [], itertools.count()
        self._cv, self._wlock = threading.Condition(), threading.Lock()
        self._proc, self._linhas = None, queue.Queue()
        self._fio, self._parar = None, False
        self._falando_urgente = None    # None = calado; True/False = urgência da fala em curso
        self._ocupado = False
        self._corte = threading.Event()  # acende = corta o .wav em curso (urgente, desligar, parar)
        self._tocando = False

    # ---- processo de fala
    def _abrir(self):
        if self.saida is not None or (self._proc and self._proc.poll() is None):
            return
        script = (_SCRIPT.replace("__VOZ__", self.voz.replace("'", ""))
                  .replace("__RATE__", str(max(-10, min(10, self.velocidade))))
                  .replace("__VOL__", str(max(0, min(100, self.volume)))))
        enc = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
        self._proc = subprocess.Popen(
            ["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", enc],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            creationflags=CREATE_NO_WINDOW | BELOW_NORMAL_PRIORITY_CLASS, text=True, encoding="ascii",
            errors="replace", bufsize=1)
        self._linhas = queue.Queue()
        proc, fila = self._proc, self._linhas

        def ler():
            for l in proc.stdout:
                fila.put(l.strip())
            fila.put(None)
        threading.Thread(target=ler, daemon=True, name="voz-leitor").start()
        r = self._ler(20.0)
        if not r or not r.startswith("pronto"):
            raise RuntimeError(f"PowerShell de fala não respondeu ({r!r})")
        self.escolhida = r[len("pronto "):]
        if self.log:
            self.log.info("voz pronta: %s", self.escolhida)

    def _ler(self, timeout):
        try:
            return self._linhas.get(timeout=timeout)
        except queue.Empty:
            return None

    def _mandar(self, linha):
        with self._wlock:                # "C" vem de outro fio: uma linha inteira por vez
            self._proc.stdin.write(linha + "\n")
            self._proc.stdin.flush()

    # ---- API
    def iniciar(self):
        with self._cv:
            if self._fio and self._fio.is_alive():
                return self
            self._parar = False
            self._fio = threading.Thread(target=self._laco, daemon=True, name="voz")
            self._fio.start()
        return self

    def falar(self, texto, urgente=False, prioridade=0):
        texto = " ".join(str(texto).split())
        if not texto or not self.ligado:
            return False
        self.iniciar()
        with self._cv:
            heapq.heappush(self._heap, (-(1000 if urgente else 0) - int(prioridade), next(self._seq),
                                        time.monotonic(), texto, bool(urgente)))
            while len(self._heap) > self.MAX_FILA:      # fila cheia: sai a de menor prioridade
                self._heap.remove(max(self._heap))
                heapq.heapify(self._heap)
            if urgente and self._falando_urgente is False:
                self._cortar()                           # gank corta a frase comum em curso
            self._cv.notify_all()
        return True

    def _cortar(self):
        """cala o que está saindo: o .wav do pacote (acende o corte) ou a Maria ("C" ao PowerShell)"""
        self._corte.set()
        if self._proc and self._proc.poll() is None:
            try:
                self._mandar("C")
            except OSError:
                pass

    def desligar(self):
        """Cala agora e esvazia a fila (liga de novo com .ligado = True)."""
        self.ligado = False
        with self._cv:
            self._heap.clear()
            self._cortar()

    def esperar(self, timeout=20.0):
        """Bloqueia até a fila esvaziar e a fala acabar (True) ou estourar o tempo (False)."""
        fim = time.monotonic() + timeout
        with self._cv:
            while self._heap or self._ocupado:
                resta = fim - time.monotonic()
                if resta <= 0:
                    return False
                self._cv.wait(min(resta, 0.1))
        return True

    def parar(self):
        with self._cv:
            self._parar = True
            self._heap.clear()
            self._corte.set()
            self._cv.notify_all()
        p = self._proc
        if p and p.poll() is None:
            try:
                self._mandar("Q")
                p.wait(3)
            except (OSError, subprocess.TimeoutExpired):
                p.kill()
        self._proc = None

    # ---- fio
    def _laco(self):
        while True:
            with self._cv:
                while not self._heap and not self._parar:
                    self._cv.wait()
                if self._parar:
                    return
                _, _, criado, texto, urgente = heapq.heappop(self._heap)
                if time.monotonic() - criado > self.validade_s:
                    self._cv.notify_all()
                    continue
                self._ocupado, self._falando_urgente = True, urgente
                self._corte.clear()          # sob a trava: um urgente que chega depois daqui corta esta
            try:
                self._dizer(texto)
            except Exception as e:  # processo morreu ou travou: mata o que sobrou e reabre na próxima frase
                if self.log:
                    self.log.warning("voz falhou: %s", e)
                p, self._proc = self._proc, None
                if p is not None and p.poll() is None:
                    try:
                        p.kill()
                    except OSError:
                        pass
            finally:
                with self._cv:
                    self._ocupado, self._falando_urgente = False, None
                    self._cv.notify_all()

    def _dizer(self, texto):
        if hasattr(self.pacote, "relido"):     # entre falas (fio da voz): nunca troca o .wav no meio de uma
            self.pacote = self.pacote.relido(self.log)
        arq = self.pacote.arquivo(texto) if self.pacote is not None else None
        self.faladas.append((time.monotonic(), texto))
        self.fontes.append((texto, "pacote" if arq else "maria"))
        if arq is not None:
            self._tocando = True
            try:
                if self.tocar is not None:
                    self.tocar(arq, self._corte)
                elif self.saida is not None:      # teste seco: nunca som de verdade
                    self.saida(texto)
                else:
                    self._tocar_wav(arq)
                return
            except Exception as e:   # .wav ruim (wave.Error), winsound sem dispositivo: a fala não se perde
                if self.log:
                    self.log.warning("voz: %s não tocou (%s); Maria ao vivo: %s", arq.name, e, texto)
                self.fontes[-1] = (texto, "maria")
            finally:
                self._tocando = False
            if self._corte.is_set() or self._parar:
                return
        elif self.pacote is not None:
            self._registrar_falta(texto)
        if self.saida is not None:
            self.saida(texto)
            return
        self._dizer_maria(texto)

    def _tocar_wav(self, arq):
        """toca o .wav sem travar (winsound assíncrono) e espera a duração ou o corte"""
        import winsound
        dur = duracao_wav(arq)
        winsound.PlaySound(str(arq), winsound.SND_FILENAME | winsound.SND_ASYNC | winsound.SND_NODEFAULT)
        if self._corte.wait(dur + 0.05):
            winsound.PlaySound(None, 0)          # corta o som em curso

    def _registrar_falta(self, texto):
        if texto in self._faltas:
            return
        self._faltas.add(texto)
        if self.log:
            self.log.info("voz: fora do pacote %s, Maria ao vivo: %s", self.pacote.nome, texto)
        try:
            Path(self.faltou).parent.mkdir(parents=True, exist_ok=True)
            with open(self.faltou, "a", encoding="utf-8") as f:
                f.write(json.dumps({"em": time.strftime("%Y-%m-%d %H:%M:%S"), "fala": texto, "pacote": self.pacote.nome,
                                    "versao_catalogo": self.pacote.versao}, ensure_ascii=False) + "\n")
        except OSError as e:   # registro é conveniência: nunca derruba a fala
            if self.log:
                self.log.warning("voz: não gravou %s (%s)", self.faltou, e)

    def _dizer_maria(self, texto):
        self._abrir()
        while not self._linhas.empty():   # resposta atrasada de um "S" antigo não vale para esta frase
            self._linhas.get_nowait()
        self._mandar("F " + base64.b64encode(texto.encode("utf-8")).decode("ascii"))
        fim = time.monotonic() + 3 + 0.12 * len(texto)
        while time.monotonic() < fim and not self._parar:
            time.sleep(0.1)
            self._mandar("S")
            if self._ler(2.0) == "livre":
                return


_padrao = None


def voz_padrao():
    global _padrao
    if _padrao is None:
        _padrao = Voz().iniciar()
        atexit.register(_padrao.parar)
    return _padrao


def falar(texto, esperar=True, urgente=False):
    """Atalho de linha de comando e de teste: fala com a voz padrão e (por padrão) espera acabar."""
    v = voz_padrao()
    v.falar(texto, urgente=urgente)
    if esperar:
        v.esperar()
    return v


if __name__ == "__main__":
    import sys
    v = falar(" ".join(sys.argv[1:]) or "teste do coach")
    print("voz:", v.escolhida, "| faladas:", len(v.faladas))
