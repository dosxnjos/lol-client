# gancho do medidor de travadas (15/10/2026): no InProgress o coletor lança tools/medir-travadas.py num processo
# próprio (pythonw, sem janela, prioridade abaixo do normal) e esquece: o medidor sai sozinho quando o jogo fecha,
# um por vez (mutex; o Reconnect que volta ao InProgress não abre outro). Nada aqui espera, lê rede ou mexe no jogo.
# Desligar: criar dados/medidor-travadas.desligado. Docs: docs/COLETOR.md § Medidor de travadas.
# Prova: tools/teste-medir-travadas.py (E9).
import logging
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
FERRAMENTA = RAIZ / "tools" / "medir-travadas.py"
DESLIGADO = RAIZ / "dados" / "medidor-travadas.desligado"
DB_REAL = RAIZ / "dados" / "lol.db"      # = banco.DB_PADRAO (sem importar o banco aqui)
CREATE_NO_WINDOW = 0x08000000
BELOW_NORMAL = 0x00004000
log = logging.getLogger("coletor")


def _pythonw(exe=None):
    exe = Path(exe or sys.executable)
    w = exe.with_name("pythonw.exe")
    return str(w if exe.name.lower() == "python.exe" and w.exists() else exe)


def _banco_real(db):
    try:
        return bool(db) and Path(db).resolve() == DB_REAL.resolve()
    except OSError:
        return False


def iniciar(partida=None, db=None, popen=subprocess.Popen, desligado=DESLIGADO, ferramenta=FERRAMENTA):
    """lança o medidor; devolve o pid ou None (outro banco = ensaio/teste, desligado, sem a ferramenta ou erro:
    só loga, nunca levanta)"""
    try:
        if not _banco_real(db):
            return None      # ensaio-coach e coletor contra o simulador passam pelo InProgress com banco de teste
        if Path(desligado).exists():
            log.info("medidor de travadas desligado (%s)", Path(desligado).name)
            return None
        if not Path(ferramenta).exists():
            return None
        cmd = [_pythonw(), str(ferramenta), "medir"] + (["--partida", str(partida)] if partida else [])
        p = popen(cmd, cwd=str(RAIZ), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                  stderr=subprocess.DEVNULL, close_fds=True, creationflags=CREATE_NO_WINDOW | BELOW_NORMAL)
        log.info("medidor de travadas iniciado (pid %s, partida %s): dados\\travadas-<data>.jsonl", p.pid, partida)
        return p.pid
    except Exception as e:
        log.warning("medidor de travadas não iniciou: %s: %s", type(e).__name__, e)
        return None
