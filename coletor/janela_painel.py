# janela do painel ao vivo na 2ª tela (plano v2, passo 11): Edge em modo app no monitor secundário,
# aberto no InProgress (cobre o carregamento) e fechado no EndOfGame pelo pid guardado.
# --user-data-dir próprio (dados\edge-painel) é obrigatório: sem ele o msedge --app entrega a URL ao
# Edge já aberto, o pid devolvido morre na hora e a janela não fecha. Nada aqui toca o jogo.
#   teste: python coletor/janela_painel.py --teste   (abre, confere no tasklist, fecha, confere)
import argparse
import ctypes
import ctypes.wintypes as wt
import json
import logging
import os
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import banco  # noqa: E402

EDGES = (Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe",
         Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Microsoft/Edge/Application/msedge.exe")
PERFIL = banco.RAIZ / "dados" / "edge-painel"
PIDFILE = banco.RAIZ / "dados" / "edge-painel.pid"
URL = "http://127.0.0.1:8765/"
# medido em 13/10/2026: DISPLAY1 1920×1200 físicos em (2560, 595) (lógico 1536×960 em 2048, 476)
MONITOR_PREFERIDO = r"\\.\DISPLAY1"
FASES_ABRE = ("InProgress", "Reconnect")
FASES_MANTEM = ("GameStart", "InProgress", "Reconnect", "WaitingForStats", "PreEndOfGame")
NAO_JANELA = 0x08000000  # CREATE_NO_WINDOW (taskkill/tasklist sem console piscando)
log = logging.getLogger("coletor.janela")


# ---------- monitores (px físicos) ----------

class _MONITORINFOEXW(ctypes.Structure):
    _fields_ = [("cbSize", wt.DWORD), ("rcMonitor", wt.RECT), ("rcWork", wt.RECT),
                ("dwFlags", wt.DWORD), ("szDevice", wt.WCHAR * 32)]


def _dpi_fisico():
    """coordenadas em px físicos para esta thread (sem isso o Windows devolve px lógicos a 125%)"""
    try:
        ctypes.windll.user32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4))  # PER_MONITOR_AWARE_V2
    except Exception:
        pass


def monitores():
    """[{dispositivo, x, y, w, h, primario}] em px físicos"""
    _dpi_fisico()
    u = ctypes.windll.user32
    out = []
    PROC = ctypes.WINFUNCTYPE(ctypes.c_int, wt.HMONITOR, wt.HDC, ctypes.POINTER(wt.RECT), wt.LPARAM)

    def cb(hmon, hdc, rc, lp):
        mi = _MONITORINFOEXW()
        mi.cbSize = ctypes.sizeof(mi)
        if u.GetMonitorInfoW(hmon, ctypes.byref(mi)):
            r = mi.rcMonitor
            dx, dy = wt.UINT(96), wt.UINT(96)
            try:
                ctypes.windll.shcore.GetDpiForMonitor(hmon, 0, ctypes.byref(dx), ctypes.byref(dy))  # MDT_EFFECTIVE_DPI
            except Exception:
                pass
            t = mi.rcWork  # área útil: sem a barra de tarefas por cima do rodapé do painel
            out.append({"dispositivo": mi.szDevice, "x": r.left, "y": r.top, "w": r.right - r.left,
                        "h": r.bottom - r.top, "primario": bool(mi.dwFlags & 1),
                        "util": (t.left, t.top, t.right - t.left, t.bottom - t.top), "escala": dx.value / 96})
        return 1
    u.EnumDisplayMonitors(None, None, PROC(cb), 0)
    return out


def monitor_do_painel(lista=None):
    """o DISPLAY1 se não for o principal; senão o 1º secundário; None com um monitor só
    (o painel não abre por cima do jogo)"""
    lista = monitores() if lista is None else lista
    sec = [m for m in lista if not m["primario"]]
    return next((m for m in sec if m["dispositivo"] == MONITOR_PREFERIDO), sec[0] if sec else None)


def _hwnds_do_pid(pid):
    """janelas visíveis de topo do processo com mais de 100 px de largura: [(hwnd, (x, y, w, h))]"""
    _dpi_fisico()
    u = ctypes.windll.user32
    out = []
    PROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)

    def cb(hwnd, lp):
        dono = wt.DWORD()
        u.GetWindowThreadProcessId(hwnd, ctypes.byref(dono))
        if dono.value == pid and u.IsWindowVisible(hwnd):
            r = wt.RECT()
            u.GetWindowRect(hwnd, ctypes.byref(r))
            if r.right - r.left > 100:
                out.append((hwnd, (r.left, r.top, r.right - r.left, r.bottom - r.top)))
        return True
    u.EnumWindows(PROC(cb), 0)
    return out


def janelas_do_pid(pid):
    """retângulos (px físicos) das janelas visíveis do processo"""
    return [r for _, r in _hwnds_do_pid(pid)]


# ---------- processo ----------

def pid_existe(pid, desde=None):
    """True se o pid está vivo e é um msedge.exe. desde (epoch s em que o pid foi guardado): processo
    criado depois disso é pid reaproveitado (ex.: o Edge do Gabriel) e não conta, senão o fechar()
    derrubaria o navegador dele"""
    k = ctypes.windll.kernel32
    h = k.OpenProcess(0x1000, False, int(pid))  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return False
    try:
        codigo = wt.DWORD()
        k.GetExitCodeProcess(h, ctypes.byref(codigo))
        if codigo.value != 259:  # STILL_ACTIVE
            return False
        buf = ctypes.create_unicode_buffer(1024)
        n = wt.DWORD(1024)
        if not (k.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n)) and buf.value.lower().endswith("msedge.exe")):
            return False
        if desde is not None:
            t = [ctypes.c_ulonglong() for _ in range(4)]  # criação, saída, kernel, usuário (FILETIME)
            if not k.GetProcessTimes(h, *(ctypes.byref(x) for x in t)):
                return False
            if (t[0].value - 116444736000000000) / 1e7 > desde + 2:
                return False
        return True
    finally:
        k.CloseHandle(h)


def no_tasklist(pid):
    r = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH", "/FO", "CSV"], capture_output=True,
                       text=True, errors="replace", creationflags=NAO_JANELA)
    return f'"{pid}"' in r.stdout


def achar_edge():
    return next((p for p in EDGES if p.exists()), None)


class JanelaPainel:
    """abrir()/fechar() e fase(fase) para o coletor chamar a cada mudança do gameflow.
    ligado: f() -> bool (padrão: config painelAoVivo do servidor_local)."""

    def __init__(self, url=URL, perfil=PERFIL, pidfile=PIDFILE, ligado=None):
        self.url, self.perfil, self.pidfile = url, Path(perfil), Path(pidfile)
        self.ligado = ligado or _ligado_pela_config
        self.desde = None  # epoch s em que o pid foi guardado
        self.pid = self._pid_salvo()

    def _pid_salvo(self):
        try:
            d = json.loads(self.pidfile.read_text())
            pid, desde = int(d["pid"]), float(d["ts"]) / 1000
        except (OSError, ValueError, KeyError, TypeError):
            return None
        if pid_existe(pid, desde):
            self.desde = desde
            return pid
        return None

    def aberta(self):
        return bool(self.pid and pid_existe(self.pid, self.desde))

    def abrir(self):
        if self.aberta():
            return self.pid
        if not self.ligado():
            log.info("painel ao vivo desligado na config")
            return None
        edge = achar_edge()
        mon = monitor_do_painel()
        if not edge:
            log.warning("painel: msedge.exe não encontrado")
            return None
        if not mon:
            log.info("painel: sem monitor secundário, não abre por cima do jogo")
            return None
        self.perfil.mkdir(parents=True, exist_ok=True)
        # o Edge lê posição e tamanho em px lógicos (medido 13/10/2026: 2560,595 físicos viraram 3200,744)
        e = mon.get("escala") or 1
        x, y, w, h = (round(v / e) for v in mon.get("util") or (mon["x"], mon["y"], mon["w"], mon["h"]))
        args = [str(edge), f"--app={self.url}", f"--user-data-dir={self.perfil}", "--no-first-run",
                "--no-default-browser-check", "--disable-sync", f"--window-position={x},{y}",
                f"--window-size={w},{h}"]
        p = subprocess.Popen(args, creationflags=NAO_JANELA, close_fds=True)
        time.sleep(1.5)
        if p.poll() is not None:
            # o perfil já tinha um Edge vivo (pid órfão perdido): ele recebeu a URL e este saiu
            log.warning("painel: msedge saiu na hora (rc %s); perfil em uso por outro processo", p.returncode)
            return None
        self.pid, self.desde = p.pid, time.time()
        self.pidfile.write_text(json.dumps({"pid": p.pid, "ts": int(self.desde * 1000)}))
        log.info("painel aberto (pid %d, monitor %s)", p.pid, mon["dispositivo"])
        return p.pid

    def fechar(self):
        pid = self.pid or self._pid_salvo()
        if pid and pid_existe(pid, self.desde):
            # WM_CLOSE na janela (o taskkill sem /F não fecha o Edge: medido 13/10/2026)
            for hwnd, _ in _hwnds_do_pid(pid):
                ctypes.windll.user32.PostMessageW(hwnd, 0x0010, 0, 0)
            forcado = False
            for _ in range(30):
                if not pid_existe(pid, self.desde):
                    break
                time.sleep(0.1)
            else:
                forcado = True
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, creationflags=NAO_JANELA)
            log.info("painel fechado (pid %d%s)", pid, ", forçado" if forcado else "")
        self.pid = self.desde = None
        self.pidfile.unlink(missing_ok=True)

    def fase(self, fase):
        """InProgress/Reconnect abre; fora das fases de jogo (EndOfGame, Lobby, None…) fecha"""
        if fase in FASES_ABRE:
            return self.abrir()
        if fase not in FASES_MANTEM:
            self.fechar()
        return None


def _ligado_pela_config():
    try:
        import servidor_local
        return servidor_local.ler_config().get("painelAoVivo", True)
    except Exception:
        return True


def _teste():
    """com o servidor de pé (ou não: a janela abre igual), simula InProgress -> EndOfGame"""
    print("monitores:", monitores())
    print("monitor do painel:", monitor_do_painel())
    j = JanelaPainel(ligado=lambda: True)
    pid = j.fase("InProgress")
    print("InProgress -> pid", pid)
    if not pid:
        return 1
    time.sleep(2.5)
    print("tasklist com o pid:", no_tasklist(pid))
    print("janelas do pid (x, y, w, h):", janelas_do_pid(pid))
    print("WaitingForStats (mantém):", j.fase("WaitingForStats"), "aberta:", j.aberta())
    t = time.monotonic()
    j.fase("EndOfGame")
    print(f"EndOfGame: fechar levou {time.monotonic() - t:.1f} s")
    time.sleep(1)
    vivo = no_tasklist(pid)
    print("EndOfGame -> tasklist com o pid:", vivo, "| msedge com o perfil do painel:", _restos())
    return 0 if not vivo and not _restos() else 1


def _restos():
    """processos msedge ainda vivos com o perfil do painel (órfãos)"""
    r = subprocess.run(["powershell", "-NoProfile", "-Command",
                        "(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | "
                        "Where-Object { $_.CommandLine -like '*edge-painel*' }).Count"],
                       capture_output=True, text=True, errors="replace", creationflags=NAO_JANELA)
    try:
        return int(r.stdout.strip() or 0)
    except ValueError:
        return -1


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="janela do painel ao vivo (Edge --app na 2ª tela)")
    ap.add_argument("--teste", action="store_true", help="abre, confere, fecha e confere")
    ap.add_argument("--abrir", action="store_true")
    ap.add_argument("--fechar", action="store_true")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    sys.stdout.reconfigure(encoding="utf-8")
    if a.teste:
        sys.exit(_teste())
    j = JanelaPainel()
    if a.abrir:
        print(j.abrir())
    elif a.fechar:
        j.fechar()
