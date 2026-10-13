# voz do coach (plano v2, passo 12): um PowerShell persistente com System.Speech (voz Maria
# pt-BR) lendo frases do stdin; abrir um PowerShell por frase custa ~1 s. Fila com prioridade:
# urgente (gank) corta a fala em curso. O intervalo mínimo entre avisos é do motor (avisos.py),
# não daqui. Protocolo só ASCII (frase em base64 UTF-8): acento não quebra e texto nunca vira código.
# uso: python -c "from coletor.voz import falar; falar('teste do coach')"
import atexit
import base64
import ctypes
import heapq
import itertools
import queue
import subprocess
import threading
import time

VOZ_PADRAO = "Microsoft Maria Desktop"
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
    """falar(texto, urgente, prioridade) enfileira; um fio manda uma frase por vez ao PowerShell e
    espera ela acabar. Frase que esperou mais que `validade_s` é descartada (aviso velho não serve).
    `saida` = função(texto) troca o PowerShell por um registro (teste seco, sem som)."""
    MAX_FILA = 3

    def __init__(self, voz=VOZ_PADRAO, velocidade=1, volume=100, validade_s=10.0, saida=None, log=None):
        self.voz, self.velocidade, self.volume = voz, int(velocidade), int(volume)
        self.validade_s, self.saida, self.log = validade_s, saida, log
        self.ligado = True
        self.escolhida = None           # nome da voz que o Windows usou (pronto <nome>)
        self.faladas = []               # (monotonic, texto) do que saiu
        self._heap, self._seq = [], itertools.count()
        self._cv, self._wlock = threading.Condition(), threading.Lock()
        self._proc, self._linhas = None, queue.Queue()
        self._fio, self._parar = None, False
        self._falando_urgente = None    # None = calado; True/False = urgência da fala em curso
        self._ocupado = False

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
            if urgente and self._falando_urgente is False and self._proc:
                try:
                    self._mandar("C")                    # gank corta a frase comum em curso
                except OSError:
                    pass
            self._cv.notify_all()
        return True

    def desligar(self):
        """Cala agora e esvazia a fila (liga de novo com .ligado = True)."""
        self.ligado = False
        with self._cv:
            self._heap.clear()
            if self._proc and self._proc.poll() is None:
                try:
                    self._mandar("C")
                except OSError:
                    pass

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
            try:
                self._dizer(texto)
            except Exception as e:  # processo morreu: tenta reabrir na próxima frase
                if self.log:
                    self.log.warning("voz falhou: %s", e)
                self._proc = None
            finally:
                with self._cv:
                    self._ocupado, self._falando_urgente = False, None
                    self._cv.notify_all()

    def _dizer(self, texto):
        self.faladas.append((time.monotonic(), texto))
        if self.saida is not None:
            self.saida(texto)
            return
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
