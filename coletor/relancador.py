# Relançador do complemento coach público (P4.3 de roadmap/2026-10-19-publicacao-e-complemento-publico.md). O atalho que o
# instalar.cmd cria na pasta Inicializar do Windows roda
#   <venv>\Scripts\pythonw.exe <complemento>\coletor\relancador.py
# e este laço sobe o coletor.py com --ocioso-min inf (espera o client abrir, para sempre) e o sobe de novo se ele sair, com
# espera crescente de ESPERA_MIN a ESPERA_MAX (rodou RODOU_OK_S ou mais: volta à mínima). É o que, na instalação do
# mantenedor, fazem o gatilho do evento 4688 (pede admin) e o vigia (tarefa agendada): nada disso vai no pacote público.
# Nunca dois coletores: com a trava dados\coletor.lock de dono vivo (o sucessor da atualização, um lançado à mão), espera
# ele sair sem lançar outro; e a trava do próprio coletor recusa a 2ª instância de qualquer jeito. Nunca dois relançadores:
# dados\relancador.lock com o pid (trava órfã de pid morto ou reaproveitado é removida, como a do coletor).
# Log: dados\relancador.log. Sem janela: o coletor sobe com CREATE_NO_WINDOW (ARMADILHAS § Windows).
#   pythonw coletor\relancador.py                         o atalho
#   python coletor\relancador.py --coletor X --voltas 3 --espera-min 0.2   prova (tools/teste-instalar.py; X = coletor falso)
import argparse
import logging
import os
import subprocess
import sys
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path

AQUI = Path(os.path.abspath(__file__)).parent
sys.path.insert(0, str(AQUI))
import coletor  # noqa: E402  (DADOS, TRAVA e pid_vivo: a mesma regra de trava; o import não abre client nem rede)

SCRIPT_COLETOR = AQUI / "coletor.py"
TRAVA = coletor.DADOS / "relancador.lock"
LOG = coletor.DADOS / "relancador.log"
ESPERA_MIN = 5.0
ESPERA_MAX = 300.0
RODOU_OK_S = 60.0
SEM_JANELA = 0x08000000   # CREATE_NO_WINDOW
log = logging.getLogger("relancador")


def dono_vivo(trava):
    """pid vivo (python) dono da trava, ou None (sem trava, pid morto, pid reaproveitado)"""
    try:
        pid = int(Path(trava).read_text().strip() or 0)
        ts = Path(trava).stat().st_mtime
    except (OSError, ValueError):
        return None
    return pid if pid and pid != os.getpid() and coletor.pid_vivo(pid, ts) else None


def travar(trava=TRAVA):
    """True se este é o único relançador; remove trava órfã"""
    Path(trava).parent.mkdir(parents=True, exist_ok=True)
    for _ in range(2):
        try:
            fd = os.open(trava, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return True
        except FileExistsError:
            outro = dono_vivo(trava)
            if outro:
                log.info("outro relançador em execução (pid %d); saindo", outro)
                return False
            Path(trava).unlink(missing_ok=True)
    return False


def destravar(trava=TRAVA):
    try:
        if Path(trava).read_text().strip() == str(os.getpid()):
            Path(trava).unlink()
    except OSError:
        pass


def comando(script=SCRIPT_COLETOR, executavel=None):
    """o coletor pelo caminho absoluto (nunca relativo à pasta atual) e esperando o client para sempre"""
    return [executavel or sys.executable, str(script), "--ocioso-min", "inf"]


def lancar(cmd):
    try:
        return subprocess.Popen(cmd, creationflags=SEM_JANELA, close_fds=True, cwd=str(AQUI.parent),
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as e:
        log.warning("não lançou o coletor: %s", e)
        return None


def laco(cmd, lancar=lancar, dormir=time.sleep, agora=time.monotonic, voltas=None, trava_coletor=coletor.TRAVA,
         espera_min=ESPERA_MIN, espera_max=ESPERA_MAX, rodou_ok_s=RODOU_OK_S):
    """sobe o coletor e o sobe de novo; devolve [(rc, segundos, espera)] (a prova lê). voltas None = para sempre"""
    espera, feitas, hist = espera_min, 0, []
    while voltas is None or feitas < voltas:
        outro = dono_vivo(trava_coletor)
        if outro:
            log.info("coletor já em execução (pid %d): esperando ele sair", outro)
            while dono_vivo(trava_coletor):
                dormir(2.0)
            continue
        feitas += 1
        t0 = agora()
        p = lancar(cmd)
        rc = p.wait() if p is not None else None
        durou = agora() - t0
        if durou >= rodou_ok_s:
            espera = espera_min
        log.info("coletor saiu (rc %s, %.0f s): de novo em %g s", rc, durou, espera)
        hist.append((rc, durou, espera))
        if voltas is not None and feitas >= voltas:
            break
        dormir(espera)
        if durou < rodou_ok_s:
            espera = min(espera * 2, espera_max)
    return hist


def principal():
    ap = argparse.ArgumentParser(description="relançador do complemento coach (atalho da pasta Inicializar)")
    ap.add_argument("--coletor", default=str(SCRIPT_COLETOR), help="script do coletor (padrão: o coletor.py ao lado)")
    ap.add_argument("--voltas", type=int, default=None, help="para depois de N subidas (prova)")
    ap.add_argument("--espera-min", type=float, default=ESPERA_MIN)
    a = ap.parse_args()
    coletor.DADOS.mkdir(parents=True, exist_ok=True)
    h = RotatingFileHandler(LOG, maxBytes=200_000, backupCount=1, encoding="utf-8")
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    log.addHandler(h)
    log.setLevel(logging.INFO)
    if not travar():
        return 0
    log.info("relançador iniciado (pid %d, coletor %s)", os.getpid(), a.coletor)
    try:
        laco(comando(Path(os.path.abspath(a.coletor))), voltas=a.voltas, espera_min=a.espera_min,
             espera_max=max(a.espera_min, ESPERA_MAX))
    except KeyboardInterrupt:
        pass
    finally:
        log.info("relançador encerrado")
        destravar()
    return 0


if __name__ == "__main__":
    sys.exit(principal())
