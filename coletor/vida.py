# registro de vida e de queda do coletor (15/10/2026). O coletor morreu calado às 02:37:27 no meio de uma partida:
# sem "encerrado", sem Traceback, sem evento no log do Windows. A causa provada foi de FORA: outra sessão rodou
# `Get-NetTCPConnection -LocalPort 8791,8765 -State Listen | Stop-Process -Force` e matou quem ouvia na 8765 (o
# servidor local do coletor). TerminateProcess não roda atexit, finally nem faulthandler: desse jeito de morrer só o
# BATIMENTO diz a hora (a morte foi até 1 min depois do último). O resto daqui cobre as quedas de dentro:
#   - faulthandler em dados/coletor-falha.log (queda nativa: access violation, estouro de pilha num fio ctypes);
#   - stderr do CRT apontado para o mesmo arquivo: o "Fatal Python error" sai em fileno(stderr), que no pythonw não
#     existe (o faulthandler sozinho NÃO pega o Py_FatalError, medido em 15/10/2026);
#   - sys.excepthook, threading.excepthook e sys.unraisablehook (exceção num callback ctypes da janela) no log, com a
#     mesma exceção repetida calada por 1 min (wndproc que lança a cada mensagem não enche o log);
#   - atexit com "coletor saindo (motivo)": saída normal ou exceção no fio principal;
#   - teto do coletor-falha.log com o coletor vivo (o faulthandler do Windows imprime até exceção TRATADA): _vigiar_falha.
# Sem IO no import; tudo é ligado por ligar(). Prova: tools/teste-vida.py.
import atexit
import ctypes
import faulthandler
import logging
import os
import sys
import threading
import time
from pathlib import Path

INTERVALO_S = 60.0              # batimento: a hora da morte fica com no máximo 1 min de erro
FALHA_MAX = 256_000             # coletor-falha.log: passou disso (ao ligar ou num batimento), vira .1 (só uma cópia)
REPETIDA_S = 60.0               # a mesma exceção de thread/ignorada: no máximo 1 linha com pilha por minuto
AVISO_FALHA_S = 600.0           # "coletor-falha.log cresceu com o coletor vivo": no máximo 1 aviso a cada 10 min

_estado = {"ligado": False, "inicio": None, "motivo": None, "arquivo": None, "falha": None, "batimentos": 0,
           "parar": None, "fio": None, "log": None, "anteriores": {}, "falha_arq": None, "falha_tam": 0,
           "falha_aviso": None, "stderr_falha": False, "repetidas": {}}


# ---------- números do processo (sem psutil) ----------

class _PMC(ctypes.Structure):
    _fields_ = [("cb", ctypes.c_ulong), ("PageFaultCount", ctypes.c_ulong), ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t), ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t), ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t), ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t)]


def numeros_do_processo():
    """{mem_mb, handles, gdi, user} do próprio processo (o que um vazamento de GDI/handle das janelas
    UpdateLayeredWindow mostraria crescendo); chave ausente = o Windows não respondeu"""
    out = {}
    if os.name != "nt":
        return out
    try:
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.GetCurrentProcess.restype = ctypes.c_void_p
        eu = ctypes.c_void_p(k.GetCurrentProcess())
        pmc = _PMC()
        pmc.cb = ctypes.sizeof(_PMC)
        k.K32GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(_PMC), ctypes.c_ulong]
        if k.K32GetProcessMemoryInfo(eu, ctypes.byref(pmc), pmc.cb):
            out["mem_mb"] = round(pmc.WorkingSetSize / 1048576)
        n = ctypes.c_ulong()
        k.GetProcessHandleCount.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
        if k.GetProcessHandleCount(eu, ctypes.byref(n)):
            out["handles"] = n.value
        u = ctypes.WinDLL("user32")
        u.GetGuiResources.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
        out["gdi"], out["user"] = u.GetGuiResources(eu, 0), u.GetGuiResources(eu, 1)
    except Exception:
        pass
    return out


def linha_batimento(estado=None, agora=None):
    """'batimento: fase X, partida Y, threads N, mem M MB, handles H, gdi G, user U, vivo há Z min' (estado() do
    coletor: {fase, partida}; quebrado ou ausente = '?')"""
    agora = time.monotonic() if agora is None else agora
    try:
        e = estado() if estado else {}
    except Exception as ex:
        e = {"fase": f"? ({type(ex).__name__})"}
    e = e or {}
    n = numeros_do_processo()
    partes = [f"fase {e.get('fase') or '-'}", f"partida {e.get('partida') or '-'}",
              f"threads {threading.active_count()}"]
    partes += [f"mem {n['mem_mb']} MB"] if "mem_mb" in n else []
    partes += [f"{k} {n[k]}" for k in ("handles", "gdi", "user") if k in n]
    ini = _estado["inicio"]
    if ini is not None:
        partes.append(f"vivo há {(agora - ini) / 60:.0f} min")
    return "batimento: " + ", ".join(partes)


# ---------- arquivo de falha (faulthandler + stderr do CRT) ----------

def _girar(arq, maximo=FALHA_MAX):
    try:
        if arq.exists() and arq.stat().st_size > maximo:
            os.replace(arq, arq.with_name(arq.name + ".1"))
    except OSError:
        pass


def _stderr_do_crt_para(arq):
    """aponta o stderr do C (o FILE* que o Py_FatalError usa) para `arq`; devolve o fd ou None. No pythonw o stderr
    do C nasce sem arquivo (fileno -2): o "Fatal Python error" e a pilha dele iam para lugar nenhum."""
    if os.name != "nt":
        return None
    try:
        crt = ctypes.CDLL("ucrtbase")
        crt.__acrt_iob_func.restype = ctypes.c_void_p
        crt.__acrt_iob_func.argtypes = [ctypes.c_uint]
        crt._wfreopen.restype = ctypes.c_void_p
        crt._wfreopen.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_void_p]
        crt._fileno.argtypes = [ctypes.c_void_p]
        crt.setvbuf.argtypes = [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_int, ctypes.c_size_t]
        err = crt.__acrt_iob_func(2)
        if not crt._wfreopen(str(arq), "a", err):
            return None
        crt.setvbuf(err, None, 4, 0)            # _IONBF: sem buffer, a linha chega ao disco antes de o processo cair
        fd = crt._fileno(err)
        return fd if fd >= 0 else None
    except Exception:
        return None


def ligar_falha(arq):
    """faulthandler (todos os fios) + stderr do C + sys.stderr do Python no arquivo de falha; devolve o fd usado.
    Com console de verdade (python.exe no terminal) o stderr fica onde está e só o faulthandler vai ao arquivo."""
    arq = Path(arq)
    arq.parent.mkdir(parents=True, exist_ok=True)
    _girar(arq)
    sem_console = sys.stderr is None or Path(sys.executable).name.lower() == "pythonw.exe"
    fd = _stderr_do_crt_para(arq) if sem_console else None
    if fd is not None:
        f = open(fd, "a", encoding="utf-8", errors="replace", buffering=1, closefd=False)
        sys.stderr = f                         # warnings e prints de biblioteca também param aqui, não no vazio
    else:
        f = open(arq, "a", encoding="utf-8", errors="replace", buffering=1)
    f.write(f"=== {time.strftime('%Y-%m-%d %H:%M:%S')} pid {os.getpid()}: faulthandler ligado "
            f"({Path(sys.executable).name}, stderr do C {'aqui' if fd is not None else 'intocado'})\n")
    f.flush()
    faulthandler.enable(file=f, all_threads=True)
    _estado.update(falha=f, falha_arq=arq, stderr_falha=fd is not None, falha_tam=_tamanho(arq))
    return fd


def _tamanho(arq):
    try:
        return arq.stat().st_size
    except OSError:
        return 0


def _vigiar_falha(log, agora=None):
    """a cada batimento: o coletor-falha.log cresceu com o processo vivo? No Windows o faulthandler é um handler
    VETORIAL: imprime a pilha de todos os fios a cada access violation, mesmo a que o ctypes trata e vira OSError
    (medido em 15/10/2026: `ctypes.string_at(0)` num try = um dump por chamada, processo segue). Sem isto o arquivo
    cresce sem teto num coletor de horas. Avisa no log (1 vez a cada 10 min: pilha com o coletor vivo não é queda) e,
    passou de FALHA_MAX, copia para .1 e zera no lugar (o fd fica o mesmo: faulthandler e stderr do C seguem nele)."""
    arq, f = _estado["falha_arq"], _estado["falha"]
    if arq is None or f is None:
        return
    agora = time.monotonic() if agora is None else agora
    tam = _tamanho(arq)
    cresceu = tam - _estado["falha_tam"]
    if cresceu > 0 and (_estado["falha_aviso"] is None or agora - _estado["falha_aviso"] >= AVISO_FALHA_S):
        _estado["falha_aviso"] = agora
        log.warning("%s cresceu %d bytes com o coletor vivo: exceção tratada (o faulthandler do Windows imprime até "
                    "access violation que o ctypes vira OSError) ou aviso no stderr; não é queda", arq.name, cresceu)
    if tam > FALHA_MAX:
        try:
            f.flush()
            import shutil
            shutil.copyfile(arq, arq.with_name(arq.name + ".1"))
            os.ftruncate(f.fileno(), 0)        # mesmo fd (append): quem escreve nele segue escrevendo do zero
            f.write(f"=== {time.strftime('%Y-%m-%d %H:%M:%S')} pid {os.getpid()}: girado com o coletor vivo "
                    f"({tam} bytes foram para {arq.name}.1)\n")
            f.flush()
            log.warning("%s passou de %d bytes com o coletor vivo: copiado para %s.1 e zerado", arq.name, FALHA_MAX,
                        arq.name)
        except Exception as e:
            log.warning("%s passou de %d bytes e não girou (%s: %s): faulthandler desligado até o coletor reiniciar",
                        arq.name, FALHA_MAX, type(e).__name__, e)
            try:
                faulthandler.disable()
                if _estado["stderr_falha"]:
                    sys.stderr = None
            except Exception:
                pass
            _estado["falha_arq"] = None
        tam = _tamanho(arq)
    _estado["falha_tam"] = tam


# ---------- ganchos de exceção ----------

_PADROES = (sys.__excepthook__, threading.__excepthook__, sys.__unraisablehook__)


def _encadear(anterior):
    """chama o gancho de antes? Não quando é o padrão do Python e o stderr virou o coletor-falha.log: a pilha já está
    no log (que tem o filtro SemSegredo) e repetir no arquivo de falha só o enche e esconde a queda nativa"""
    return not (_estado["stderr_falha"] and anterior in _PADROES)


def _repetida(chave, agora=None):
    """None = logar com pilha; n > 0 = calar (n-ésima igual dentro de REPETIDA_S). Um wndproc que lança a cada
    mensagem da janela (dezenas por segundo) não pode virar dezenas de pilhas por segundo no log"""
    agora = time.monotonic() if agora is None else agora
    rep = _estado["repetidas"]
    t, n = rep.get(chave, (None, 0))
    if t is not None and agora - t < REPETIDA_S:
        rep[chave] = (t, n + 1)
        return n + 1
    if len(rep) > 500:
        rep.clear()
    rep[chave] = (agora, 0)
    return None if not n else -n          # -n: houve n caladas na janela anterior (vai no texto da próxima)


def _chave(tipo, tb, extra=""):
    while tb is not None and tb.tb_next is not None:
        tb = tb.tb_next
    onde = f"{tb.tb_frame.f_code.co_filename}:{tb.tb_lineno}" if tb is not None else "?"
    return (getattr(tipo, "__name__", "?"), extra, onde)


def ganchos(log):
    """sys.excepthook, threading.excepthook e sys.unraisablehook no log (idempotente: encadeia sempre nos de antes
    da 1ª chamada). A mesma exceção repetida (tipo + onde) sai com pilha 1 vez por minuto e as caladas são contadas"""
    ant = _estado["anteriores"]
    ant.setdefault("sys", sys.excepthook)
    ant.setdefault("thread", threading.excepthook)
    ant.setdefault("unraisable", sys.unraisablehook)

    def principal(tipo, valor, tb):
        if not issubclass(tipo, (KeyboardInterrupt, SystemExit)):
            log.critical("exceção não tratada no fio principal: %s: %s", tipo.__name__, valor,
                         exc_info=(tipo, valor, tb))
        if _encadear(ant["sys"]) or issubclass(tipo, (KeyboardInterrupt, SystemExit)):
            ant["sys"](tipo, valor, tb)

    def fio(args):
        if args.exc_type is not SystemExit:
            n = _repetida(_chave(args.exc_type, args.exc_traceback, "thread"))
            if n is not None and n > 0:
                return
            log.error("thread %s morreu: %s: %s%s", getattr(args.thread, "name", "?"), args.exc_type.__name__,
                      args.exc_value, f" (+{-n} iguais caladas no minuto anterior)" if n else "",
                      exc_info=(args.exc_type, args.exc_value, args.exc_traceback))
        if _encadear(ant["thread"]):
            try:
                ant["thread"](args)
            except Exception:
                pass

    def ignorada(u):
        # exceção que o Python só "ignora": __del__, callback ctypes (wndproc das janelas) que deixou escapar
        n = _repetida(_chave(u.exc_type, u.exc_traceback, u.err_msg or ""))
        if n is not None and n > 0:
            return
        log.warning("exceção ignorada (%s): %s: %s%s", u.err_msg or "unraisable", getattr(u.exc_type, "__name__", "?"),
                    u.exc_value, f" (+{-n} iguais caladas no minuto anterior)" if n else "",
                    exc_info=(u.exc_type, u.exc_value, u.exc_traceback) if u.exc_type else None)
        if _encadear(ant["unraisable"]):
            try:
                ant["unraisable"](u)
            except Exception:
                pass

    sys.excepthook, threading.excepthook, sys.unraisablehook = principal, fio, ignorada


# ---------- motivo e saída ----------

def saindo(motivo):
    """o principal() diz por que está saindo; o atexit escreve"""
    _estado["motivo"] = motivo


def _ao_sair():
    log = _estado["log"]
    parar = _estado["parar"]
    if parar is not None:
        parar.set()
    if log is None:
        return
    vivo = time.monotonic() - _estado["inicio"] if _estado["inicio"] is not None else 0
    log.info("coletor saindo (%s; vivo há %.0f min, %d batimento(s))",
             _estado["motivo"] or "sem motivo: saída fora do principal()", vivo / 60, _estado["batimentos"])


# ---------- batimento ----------

def _bater(log, estado, parar, intervalo):
    while not parar.wait(intervalo):
        try:
            log.info(linha_batimento(estado))
            _estado["batimentos"] += 1
            _vigiar_falha(log)
        except Exception as e:    # nunca derruba nada: o batimento é diagnóstico
            try:
                log.warning("batimento falhou: %s: %s", type(e).__name__, e)
            except Exception:
                pass


def ligar(log, falha=None, estado=None, intervalo=None, batimento=True):
    """liga tudo uma vez por processo: ganchos, faulthandler/stderr em `falha`, atexit e o fio do batimento
    (a cada `intervalo` s; None = INTERVALO_S). estado() -> {fase, partida}. Devolve o Event que para o batimento."""
    if _estado["ligado"]:
        return _estado["parar"]
    intervalo = INTERVALO_S if intervalo is None else intervalo
    _estado.update(ligado=True, inicio=time.monotonic(), log=log, motivo=None, batimentos=0)
    if falha is not None:
        try:
            ligar_falha(falha)
        except Exception as e:
            log.warning("vida: arquivo de falha não ligou (%s: %s)", type(e).__name__, e)
    ganchos(log)
    atexit.register(_ao_sair)
    parar = threading.Event()
    _estado["parar"] = parar
    if batimento:
        t = threading.Thread(target=_bater, args=(log, estado, parar, intervalo), daemon=True, name="batimento")
        t.start()
        _estado["fio"] = t
    log.info("vida: batimento a cada %.0f s, falha nativa em %s", intervalo, falha or "(desligado)")
    return parar


# ---------- leitura do log (quem sobe depois) ----------

def ultimo_registro(arq, ler=65536):
    """(hora 'AAAA-MM-DD HH:MM:SS', texto) da última linha com hora do log, e a hora do último batimento (ou None):
    ((hora, texto), hora_batimento). Lê só o fim do arquivo."""
    try:
        with open(arq, "rb") as f:
            f.seek(0, 2)
            f.seek(max(0, f.tell() - ler))
            linhas = f.read().decode("utf-8", errors="replace").splitlines()
    except OSError:
        return None, None
    ultima, bat = None, None
    for ln in reversed(linhas):
        if len(ln) >= 19 and ln[4] == "-" and ln[10] == " " and ln[13] == ":":
            if ultima is None:
                ultima = (ln[:19], ln[24:].split(" ", 1)[-1].strip())   # sem o "INFO"/"WARNING"
            if bat is None and "batimento: " in ln:
                bat = ln[:19]
            if ultima is not None and bat is not None:
                break
    return ultima, bat


def _zerar_para_teste():
    """só para os testes: desfaz ligar() (ganchos voltam, batimento para)"""
    if _estado["parar"] is not None:
        _estado["parar"].set()
    ant = _estado["anteriores"]
    if ant:
        sys.excepthook = ant.get("sys", sys.__excepthook__)
        threading.excepthook = ant.get("thread", threading.__excepthook__)
        sys.unraisablehook = ant.get("unraisable", sys.__unraisablehook__)
    try:
        atexit.unregister(_ao_sair)
    except Exception:
        pass
    if _estado["falha"] is not None:
        try:
            faulthandler.disable()
        except Exception:
            pass
    _estado.update(ligado=False, inicio=None, motivo=None, falha=None, batimentos=0, parar=None, fio=None, log=None,
                   anteriores={}, falha_arq=None, falha_tam=0, falha_aviso=None, stderr_falha=False, repetidas={})


logging.getLogger("coletor.vida").addHandler(logging.NullHandler())
