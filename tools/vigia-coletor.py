# vigia do coletor (15/10/2026): a tarefa "lol-client-vigia" roda isto a cada 3 min (pythonw, oculta, só logado, sem
# admin). Com o client do LoL aberto e o coletor morto, sobe o coletor pela PRÓPRIA tarefa dele
# (`schtasks /run /tn lol-client-coletor`): IgnoreNew da tarefa + a trava dados/coletor.lock = nunca dois coletores.
# Nunca mata nada (nem coletor vivo, nem quem ocupa a 8765); nunca sobe com porta de teste ouvindo (ensaio 8766/2996,
# simulador 2998), com um teste do projeto rodando (linha de comando de python com rodar-testes/ensaio/teste-...)
# ou pausado (`pausar`). Motivo: o coletor morreu calado em 15/10/2026 02:37 no meio de uma partida (outra sessão
# matou quem ouvia na 8765) e ficou fora até alguém notar, 30 min depois. Docs: docs/COLETOR.md § Vigia.
#   python tools/vigia-coletor.py conferir | estado | instalar | remover | pausar [min] | retomar
# Prova: python tools/teste-vigia.py (decisão, sem tarefa) e --real (tarefas de teste com outro nome, removidas no fim)
from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as wt
import datetime as dt
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DADOS = RAIZ / "dados"
TAREFA = "lol-client-vigia"
TAREFA_COLETOR = "lol-client-coletor"
PORTA = 8765                           # servidor local do coletor
PORTAS_TESTE = (8766, 2996, 2998)      # ensaio (painel, simulador) e simulador avulso: teste em curso
CLIENT_EXE = "LeagueClientUx.exe"
REPETIR_MIN = 3
MARCAS_TESTE = ("rodar-testes.py", "ensaio-coach.py", "servidor-teste-plugin.py", "simular-liveclient.py",
                "gravador.py", "tools\\teste-", "tools/teste-", "--porta-painel", "--liveclient")
SUBIDAS_JANELA_S, SUBIDAS_MAX, SUBIDAS_ESPERA_S = 30 * 60, 3, 15 * 60   # 3 subidas em 30 min: só 1 a cada 15 min
SEM_BATIMENTO_S = 5 * 60               # coletor vivo sem batimento há mais que isso: aviso (nunca mata)
AVISO_REPETIR_S = 30 * 60
ESPERA_TRAVA_S = 20.0                  # depois do /run: quanto esperar a trava nova aparecer
CREATE_NO_WINDOW = 0x08000000


def _oculto():
    return CREATE_NO_WINDOW if os.name == "nt" else 0


# ---------- o que o Windows diz (sem abrir console: Toolhelp e iphlpapi por ctypes) ----------

class _PE32(ctypes.Structure):
    _fields_ = [("dwSize", wt.DWORD), ("cntUsage", wt.DWORD), ("th32ProcessID", wt.DWORD),
                ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wt.DWORD), ("cntThreads", wt.DWORD),
                ("th32ParentProcessID", wt.DWORD), ("pcPriClassBase", ctypes.c_long), ("dwFlags", wt.DWORD),
                ("szExeFile", ctypes.c_wchar * 260)]


def processos():
    """{pid: nome do executável} de todos os processos"""
    k = ctypes.WinDLL("kernel32", use_last_error=True)
    k.CreateToolhelp32Snapshot.restype = wt.HANDLE
    k.Process32FirstW.argtypes = k.Process32NextW.argtypes = [wt.HANDLE, ctypes.POINTER(_PE32)]
    k.CloseHandle.argtypes = [wt.HANDLE]
    h = k.CreateToolhelp32Snapshot(0x2, 0)            # TH32CS_SNAPPROCESS
    out = {}
    if not h or h == wt.HANDLE(-1).value:
        return out
    try:
        e = _PE32()
        e.dwSize = ctypes.sizeof(_PE32)
        ok = k.Process32FirstW(h, ctypes.byref(e))
        while ok:
            out[e.th32ProcessID] = e.szExeFile
            ok = k.Process32NextW(h, ctypes.byref(e))
    finally:
        k.CloseHandle(h)
    return out


def ouvintes(porta):
    """pids que ouvem TCP na `porta` (IPv4, qualquer endereço), pela tabela do Windows: nada conecta na porta"""
    ip = ctypes.WinDLL("iphlpapi")
    tam = wt.DWORD(0)
    ip.GetExtendedTcpTable(None, ctypes.byref(tam), False, 2, 3, 0)    # AF_INET, TCP_TABLE_OWNER_PID_LISTENER
    for _ in range(3):
        buf = ctypes.create_string_buffer(tam.value + 4096)
        tam = wt.DWORD(len(buf))
        if ip.GetExtendedTcpTable(buf, ctypes.byref(tam), False, 2, 3, 0) == 0:
            break
    else:
        return []
    n = ctypes.c_uint32.from_buffer(buf, 0).value
    pids = []
    for i in range(n):                                  # MIB_TCPROW_OWNER_PID: 6 DWORDs
        base = 4 + i * 24
        estado, _, porta_be, _, _, pid = (ctypes.c_uint32.from_buffer(buf, base + 4 * j).value for j in range(6))
        if ((porta_be & 0xFF) << 8 | (porta_be >> 8) & 0xFF) == porta:
            pids.append(pid)
    return sorted(set(pids))


def pid_vivo(pid, trava_ts=None):
    """o mesmo critério do coletor (python vivo nascido antes da trava); coletor.py que não importa = fallback"""
    try:
        if str(RAIZ / "coletor") not in sys.path:
            sys.path.insert(0, str(RAIZ / "coletor"))
        from coletor import pid_vivo as pv
        return pv(pid, trava_ts)
    except Exception:
        k = ctypes.windll.kernel32
        h = k.OpenProcess(0x1000, False, pid)
        if not h:
            return False
        try:
            c = ctypes.c_ulong()
            return bool(k.GetExitCodeProcess(h, ctypes.byref(c))) and c.value == 259
        finally:
            k.CloseHandle(h)


def ler_trava(arq):
    """(pid, mtime) da trava ou (None, None)"""
    try:
        return int(Path(arq).read_text().strip() or 0) or None, Path(arq).stat().st_mtime
    except (OSError, ValueError):
        return None, None


def linhas_de_comando():
    """{pid: linha de comando} dos python*.exe (PowerShell oculto; só no caminho de subir, nunca a cada rodada)"""
    ps = ("[Console]::OutputEncoding=[Text.UTF8Encoding]::new();"
          "Get-CimInstance Win32_Process -Filter \"Name like 'python%'\" | "
          "ForEach-Object { \"$($_.ProcessId)`t$($_.CommandLine)\" }")
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True,
                           encoding="utf-8", errors="replace", timeout=30, creationflags=_oculto())
    except Exception:
        return {}
    out = {}
    for ln in r.stdout.splitlines():
        pid, _, cmd = ln.partition("\t")
        if pid.strip().isdigit():
            out[int(pid)] = cmd
    return out


def schtasks(*args):
    # saída na página OEM (cp850 no pt-BR): ARMADILHAS § Windows
    r = subprocess.run(["schtasks", *args], capture_output=True, text=True, errors="replace", creationflags=_oculto(),
                       encoding="oem" if os.name == "nt" else None)
    return r.returncode, (r.stdout + r.stderr).strip()


def estado_tarefa(nome):
    ps = (f"$t = Get-ScheduledTask -TaskName '{nome}' -ErrorAction SilentlyContinue; if ($t) {{ "
          "$i = $t | Get-ScheduledTaskInfo; $f = 'yyyy-MM-dd HH:mm'; [pscustomobject]@{ estado = [string]$t.State; "
          "proxima = $(if ($i.NextRunTime) { $i.NextRunTime.ToString($f) } else { '' }); "
          "ultima = $(if ($i.LastRunTime -and $i.LastRunTime.Year -gt 2000) { $i.LastRunTime.ToString($f) } else "
          "{ '' }); resultado = $i.LastTaskResult } | ConvertTo-Json -Compress }")
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True,
                           text=True, errors="replace", timeout=30, creationflags=_oculto())
        return json.loads(r.stdout.strip()) if r.stdout.strip() else None
    except Exception:
        return None


# ---------- decisão (pura: o teste chama com observações montadas) ----------

def decidir(o, agora):
    """o: {pausado_ate, client, testes (portas de teste ouvindo), coletor_vivo, porta_dono [(pid, exe)],
    subidas [epoch], marcas (linhas de comando de teste; None = ainda não lidas)}.
    -> ("nada"|"adiar"|"subir"|"ler_marcas", motivo). "ler_marcas" = quase subir: falta conferir os testes."""
    if o.get("pausado_ate") and agora < o["pausado_ate"]:
        return "adiar", f"vigia pausado até {dt.datetime.fromtimestamp(o['pausado_ate']):%H:%M}"
    if not o.get("client"):
        return "nada", "client fechado"
    if o.get("coletor_vivo"):
        return "nada", "coletor vivo"
    if o.get("testes"):
        return "adiar", "porta de teste ouvindo (" + ", ".join(map(str, o["testes"])) + "): teste em curso"
    recentes = [t for t in o.get("subidas") or [] if agora - t < SUBIDAS_JANELA_S]
    if len(recentes) >= SUBIDAS_MAX and agora - max(recentes) < SUBIDAS_ESPERA_S:
        return "adiar", (f"{len(recentes)} subidas em {SUBIDAS_JANELA_S // 60} min (o coletor cai ao subir?): "
                         f"próxima tentativa {SUBIDAS_ESPERA_S // 60} min depois da última")
    if o.get("marcas") is None:
        return "ler_marcas", "client aberto e coletor fora"
    if o["marcas"]:
        return "adiar", "teste do projeto rodando: " + "; ".join(o["marcas"])[:200]
    if o.get("sem_trava"):
        # coletor.py vivo sem trava viva: subindo (antes do travar()) ou preso. Outro /run poderia virar 2 coletores
        # (o que nasceu fora da tarefa não é barrado pelo IgnoreNew): espera, nunca mata
        return "adiar", "coletor rodando sem trava viva (" + "; ".join(o["sem_trava"])[:200] + "): não duplico"
    if o.get("tarefa_rodando"):
        return "adiar", "tarefa do coletor marcada rodando com a trava morta: o /run seria ignorado (IgnoreNew)"
    return "subir", "client aberto e coletor fora"


_SEGREDO = re.compile(r"(?i)((?:senha|password|token|secret|auth|key|jwt)\w*[=: ]+)\S+")
_COLETOR_PY = re.compile(r"(?i)(?:^|[\\/\s\"'])coletor\.py\b")      # coletor\coletor.py, nunca vigia-coletor.py


def _curta(cmd):
    """linha de comando para o log: espaços juntos, valor de --senha/--token/… trocado por ***, só o fim"""
    return _SEGREDO.sub(r"\1***", re.sub(r"\s+", " ", cmd or ""))[-120:]


def marcas_de_teste(cmds, eu=None, marcas=MARCAS_TESTE):
    """linhas de comando (encurtadas) de python que são prova do projeto, menos o próprio vigia"""
    out = []
    for pid, cmd in (cmds or {}).items():
        if pid == eu or "vigia-coletor.py" in (cmd or ""):
            continue
        if any(m in (cmd or "") for m in marcas):
            out.append(f"pid {pid}: {_curta(cmd)}")
    return out


def coletores_sem_trava(cmds, eu=None):
    """python com coletor\\coletor.py na linha de comando (o coletor de verdade, não prova: essa já adiou antes)"""
    return [f"pid {pid}" for pid, cmd in (cmds or {}).items()
            if pid != eu and _COLETOR_PY.search(cmd or "") and not any(m in cmd for m in MARCAS_TESTE)]


# ---------- registro ----------

def abrir_log(dados):
    log = logging.getLogger("vigia-coletor")
    if not log.handlers:
        Path(dados).mkdir(parents=True, exist_ok=True)
        h = RotatingFileHandler(Path(dados) / "vigia.log", maxBytes=256_000, backupCount=2, encoding="utf-8")
        h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        log.addHandler(h)
        if sys.stderr and not Path(sys.executable).name.lower().startswith("pythonw"):
            log.addHandler(logging.StreamHandler(sys.stderr))
        log.setLevel(logging.INFO)
    return log


def anotar_no_coletor(arq, texto):
    """uma linha no dados/coletor.log, no formato dele. Só com o coletor MORTO (ninguém com o arquivo aberto
    girando): é o rastro, ao lado do "iniciado" seguinte, de que quem subiu foi o vigia"""
    agora = dt.datetime.now()
    try:
        with open(arq, "a", encoding="utf-8") as f:
            f.write(f"{agora:%Y-%m-%d %H:%M:%S},{agora.microsecond // 1000:03d} WARNING {texto}\n")
    except OSError:
        pass


def ler_estado(arq):
    try:
        return json.loads(Path(arq).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def gravar_estado(arq, d):
    try:
        tmp = Path(str(arq) + ".tmp")
        tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, arq)
    except OSError:
        pass


def ler_pausa(arq):
    try:
        return float(Path(arq).read_text().strip())
    except (OSError, ValueError):
        return None


# ---------- uma rodada ----------

def conferir(a, log=None):
    """observa, decide e (se for o caso) sobe o coletor pela tarefa. Devolve (ação, motivo)."""
    dados = Path(a.dados)
    log = log or abrir_log(dados)
    agora = time.time()
    est = ler_estado(dados / "vigia.json")
    procs = processos()
    nomes = {n.lower() for n in procs.values()}
    pid, ts = ler_trava(a.trava)
    vivo = bool(pid) and pid_vivo(pid, ts)
    o = {"pausado_ate": ler_pausa(dados / "vigia.pausa"), "client": a.client_exe.lower() in nomes,
         "coletor_vivo": vivo, "subidas": est.get("subidas") or [], "marcas": None,
         "testes": [p for p in a.portas_teste if ouvintes(p)]}
    acao, motivo = decidir(o, agora)
    if acao == "ler_marcas":
        cmds = {} if a.sem_marcas else linhas_de_comando()
        o["marcas"] = marcas_de_teste(cmds, os.getpid())
        o["sem_trava"] = coletores_sem_trava(cmds, os.getpid())
        if not o["marcas"] and not o["sem_trava"]:
            o["tarefa_rodando"] = (estado_tarefa(a.tarefa_coletor) or {}).get("estado") == "Running"
        acao, motivo = decidir(o, agora)
    est.update(ultima=dt.datetime.now().isoformat(timespec="seconds"), acao=acao, motivo=motivo)

    if acao == "nada" and vivo:
        _conferir_batimento(a, est, agora, ts, log)
    elif acao == "adiar":
        if est.get("ultimo_adiar") != motivo:          # o mesmo motivo a cada 3 min não enche o log
            log.info("adiado: %s", motivo)
        est["ultimo_adiar"] = motivo
    elif acao == "subir":
        est.pop("ultimo_adiar", None)
        donos = [(p, procs.get(p, "?")) for p in ouvintes(a.porta)]
        ultima, bat = _ultimo_registro(a.log_coletor)
        texto = (f"vigia: coletor fora com o client aberto (trava: {f'pid {pid} morto' if pid else 'nenhuma'}; "
                 f"última linha do log {ultima or '?'}; último batimento {bat or 'nenhum'}"
                 + (f"; porta {a.porta} ocupada por " + ", ".join(f"pid {p} ({n})" for p, n in donos) +
                    ": ele sobe sem o servidor local" if donos else "") + f"); subindo pela tarefa {a.tarefa_coletor}")
        log.warning(texto)
        anotar_no_coletor(a.log_coletor, texto)
        rc, out = schtasks("/run", "/tn", a.tarefa_coletor)
        est["subidas"] = [t for t in (est.get("subidas") or []) if agora - t < SUBIDAS_JANELA_S] + [agora]
        if rc != 0:
            log.error("schtasks /run %s falhou (rc %d): %s", a.tarefa_coletor, rc, out[-200:])
            acao, motivo = "erro", f"schtasks /run rc {rc}"
        else:
            novo = _esperar_trava(a.trava, pid, a.espera)
            if novo:
                log.info("coletor subiu pelo vigia (pid %d)", novo)
                est["ultima_subida"] = {"em": dt.datetime.now().isoformat(timespec="seconds"), "pid": novo}
            else:
                t = estado_tarefa(a.tarefa_coletor) or {}
                log.error("a tarefa %s rodou mas nenhuma trava viva em %.0f s (tarefa: %s, resultado %s); "
                          "a próxima rodada tenta de novo", a.tarefa_coletor, a.espera, t.get("estado", "?"),
                          t.get("resultado", "?"))
                acao, motivo = "erro", "sem trava depois do /run"
    gravar_estado(dados / "vigia.json", est)
    return acao, motivo


def _ultimo_registro(arq):
    try:
        if str(RAIZ / "coletor") not in sys.path:
            sys.path.insert(0, str(RAIZ / "coletor"))
        import vida
        ultima, bat = vida.ultimo_registro(arq)
        return (ultima[0] if ultima else None), bat
    except Exception:
        return None, None


def _esperar_trava(trava, pid_antigo, espera):
    fim = time.monotonic() + espera
    while time.monotonic() < fim:
        pid, ts = ler_trava(trava)
        if pid and pid != pid_antigo and pid_vivo(pid, ts):
            return pid
        time.sleep(0.5)
    return None


def _conferir_batimento(a, est, agora, trava_ts, log):
    """coletor vivo há > 5 min sem batimento no log = travado ou sem o vida.py (código antigo): avisa, nunca mata"""
    if trava_ts is None or agora - trava_ts < SEM_BATIMENTO_S:
        return
    _, bat = _ultimo_registro(a.log_coletor)
    try:
        idade = agora - dt.datetime.strptime(bat, "%Y-%m-%d %H:%M:%S").timestamp() if bat else None
    except ValueError:
        idade = None
    if idade is not None and idade < SEM_BATIMENTO_S:
        return
    if agora - (est.get("aviso_batimento") or 0) < AVISO_REPETIR_S:
        return
    est["aviso_batimento"] = agora
    log.warning("coletor vivo (trava de %s) sem batimento %s: travado, ou rodando código de antes do batimento "
                "(15/10/2026). Não mexo", dt.datetime.fromtimestamp(trava_ts).strftime("%H:%M"),
                f"há {idade / 60:.0f} min" if idade is not None else "nenhum no log")


# ---------- tarefa ----------

def _sid():
    r = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"], capture_output=True, text=True, errors="replace",
                       creationflags=_oculto())
    m = re.search(r"(S-1-[0-9-]+)", r.stdout)
    if not m:
        raise RuntimeError("SID do usuário não veio do whoami")
    return m.group(1)


def _x(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def xml_tarefa(pythonw, sid, nome, argumentos, inicio, repetir_min=REPETIR_MIN):
    """mesmo molde das outras tarefas do projeto: InteractiveToken + LeastPrivilege (só logado, sem senha nem admin),
    oculta, uma instância por vez, prioridade 7, 2 min no máximo; repete a cada `repetir_min` sem fim"""
    desc = ("lol-client: com o client do LoL aberto e o coletor fora, sobe o coletor pela tarefa lol-client-coletor "
            "(nunca mata nada; nunca com teste rodando). Estado: python tools\\vigia-coletor.py estado. "
            "Remover: python tools\\vigia-coletor.py remover")
    return f"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>{_x(desc)}</Description>
    <URI>\\{_x(nome)}</URI>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>{inicio:%Y-%m-%dT%H:%M:%S}</StartBoundary>
      <Enabled>true</Enabled>
      <Repetition>
        <Interval>PT{int(repetir_min)}M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>{sid}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT2M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{_x(pythonw)}</Command>
      <Arguments>{_x(argumentos)}</Arguments>
      <WorkingDirectory>{_x(RAIZ)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"""


def instalar(nome=TAREFA, extra="", repetir_min=REPETIR_MIN, saida=print):
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    if not pythonw.exists():
        saida(f"pythonw não encontrado ao lado de {sys.executable}")
        return 1
    args = f'"{Path(__file__).resolve()}" conferir {extra}'.strip()
    inicio = dt.datetime.now().replace(microsecond=0) + dt.timedelta(minutes=1)
    with tempfile.TemporaryDirectory() as d:
        arq = Path(d) / "tarefa.xml"
        arq.write_text(xml_tarefa(pythonw, _sid(), nome, args, inicio, repetir_min), encoding="utf-16")
        rc, out = schtasks("/create", "/tn", nome, "/xml", str(arq), "/f")
    saida(out)
    return 0 if rc == 0 else 1


def remover(nome=TAREFA, saida=print):
    rc, out = schtasks("/delete", "/tn", nome, "/f")
    saida(out)
    return 0 if rc == 0 else 1


_RESULTADOS = {0: "ok", 1: "erro", 267009: "rodando agora", 267011: "nunca rodou",
               2147946720: "pulada pelo Windows (instância já em curso)"}


def estado(a, saida=print):
    dados = Path(a.dados)
    t = estado_tarefa(TAREFA)
    if t is None:
        saida(f"tarefa {TAREFA}: não instalada (python tools\\vigia-coletor.py instalar)")
    else:
        r = t.get("resultado")
        saida(f"tarefa {TAREFA}: {t.get('estado')}; última {t.get('ultima') or '-'} "
              f"({_RESULTADOS.get(r, r)}); próxima {t.get('proxima') or '-'}")
    p = ler_pausa(dados / "vigia.pausa")
    if p and p > time.time():
        saida(f"pausado até {dt.datetime.fromtimestamp(p):%Y-%m-%d %H:%M} (retomar: ... retomar)")
    e = ler_estado(dados / "vigia.json")
    if e:
        saida(f"última rodada {e.get('ultima')}: {e.get('acao')} ({e.get('motivo')})")
        if e.get("ultima_subida"):
            saida(f"última vez que subiu o coletor: {e['ultima_subida']['em']} (pid {e['ultima_subida']['pid']})")
    pid, ts = ler_trava(a.trava)
    saida(f"coletor: {'vivo, pid ' + str(pid) if pid and pid_vivo(pid, ts) else 'fora'}; "
          f"porta {a.porta}: " + (", ".join(f"pid {p}" for p in ouvintes(a.porta)) or "ninguém ouvindo"))
    saida(f"log: {dados / 'vigia.log'}")
    return 0


def args_parser():
    ap = argparse.ArgumentParser(description="vigia do coletor do lol-client")
    ap.add_argument("acao", choices=("conferir", "estado", "instalar", "remover", "pausar", "retomar"))
    ap.add_argument("minutos", nargs="?", type=float, default=60.0, help="pausar: por quantos minutos (padrão 60)")
    # para a prova (tools/teste-vigia.py --real): tudo trocável, nada do coletor real é tocado
    ap.add_argument("--dados", default=str(DADOS), help="pasta do vigia.log/vigia.json/vigia.pausa")
    ap.add_argument("--trava", default=str(DADOS / "coletor.lock"))
    ap.add_argument("--log-coletor", default=str(DADOS / "coletor.log"))
    ap.add_argument("--tarefa-coletor", default=TAREFA_COLETOR)
    ap.add_argument("--porta", type=int, default=PORTA)
    ap.add_argument("--portas-teste", type=lambda s: tuple(int(x) for x in s.split(",") if x), default=PORTAS_TESTE)
    ap.add_argument("--client-exe", default=CLIENT_EXE)
    ap.add_argument("--espera", type=float, default=ESPERA_TRAVA_S)
    ap.add_argument("--sem-marcas", action="store_true", help="não procura teste rodando pela linha de comando")
    return ap


def main(argv=None):
    a = args_parser().parse_args(argv)
    dados = Path(a.dados)
    for f in (sys.stdout, sys.stderr):       # console cp1252 do Windows: "não" sairia quebrado
        if f and hasattr(f, "reconfigure"):
            f.reconfigure(encoding="utf-8")
    if a.acao == "conferir":
        log = abrir_log(dados)
        try:
            acao, motivo = conferir(a, log)
        except Exception as e:     # pythonw: sem isto a falha some
            log.exception("rodada do vigia falhou: %s", e)
            return 1
        return {"erro": 1}.get(acao, 0)
    if a.acao == "estado":
        return estado(a)
    if a.acao == "instalar":
        return instalar()
    if a.acao == "remover":
        return remover()
    if a.acao == "pausar":
        dados.mkdir(parents=True, exist_ok=True)
        ate = time.time() + a.minutos * 60
        (dados / "vigia.pausa").write_text(f"{ate:.0f}")
        abrir_log(dados).info("pausado por %.0f min (até %s)", a.minutos, dt.datetime.fromtimestamp(ate))
        print(f"vigia pausado até {dt.datetime.fromtimestamp(ate):%H:%M}")
        return 0
    if a.acao == "retomar":
        (dados / "vigia.pausa").unlink(missing_ok=True)
        abrir_log(dados).info("retomado")
        print("vigia retomado")
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
