# prova do registro de vida e de queda do coletor (coletor/vida.py, 15/10/2026). Tudo em pasta temporária: nada de
# dados/, da porta 8765 nem do coletor real.
#   python tools/teste-vida.py           ganchos, batimento, atexit, rotação e queda nativa num pythonw filho
#   python tools/teste-vida.py --real    + a queda num pythonw da TAREFA AGENDADA (sem stdin/stdout/stderr, como o
#                                         coletor de verdade); tarefa "lol-client-teste-queda", removida no fim
import argparse
import subprocess
import sys
import tempfile
import textwrap
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PY = sys.executable
PYW = str(Path(sys.executable).with_name("pythonw.exe"))
CREATE_NO_WINDOW = 0x08000000
TAREFA_TESTE = "lol-client-teste-queda"
falhas = []


def conferir(cond, nome, detalhe=""):
    print(("ok   " if cond else "FALHA") + f" {nome}" + (f": {detalhe}" if detalhe and not cond else ""))
    if not cond:
        falhas.append(nome)


def roda(codigo, pasta, exe=PY, **kw):
    """roda `codigo` num processo filho com coletor/ no path; log em pasta/c.log, falha em pasta/falha.log"""
    arq = Path(pasta) / "filho.py"
    arq.write_text(textwrap.dedent(f"""
        import logging, sys, threading, time
        sys.path.insert(0, {str(RAIZ / 'coletor')!r})
        import vida
        log = logging.getLogger("teste-vida")
        h = logging.FileHandler({str(Path(pasta) / 'c.log')!r}, encoding="utf-8")
        h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        log.addHandler(h); log.setLevel(logging.INFO)
    """) + textwrap.dedent(codigo), encoding="utf-8")
    return subprocess.run([exe, str(arq)], capture_output=True, text=True, timeout=60, creationflags=CREATE_NO_WINDOW,
                          **kw)


def ler(p):
    try:
        return Path(p).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def teste_ganchos():
    with tempfile.TemporaryDirectory() as d:
        r = roda(f"""
            import faulthandler
            vida.ligar(log, falha={str(Path(d) / 'falha.log')!r}, estado=lambda: {{"fase": "InProgress", "partida": 42}},
                       intervalo=0.2)
            print("faulthandler", faulthandler.is_enabled())
            def quebra():
                raise ValueError("thread de teste quebrou")
            t = threading.Thread(target=quebra, name="overlay-teste"); t.start(); t.join()
            class Ruim:
                def __del__(self):
                    raise RuntimeError("del de teste")
            Ruim()
            time.sleep(0.7)
            vida.saindo("ocioso de teste")
        """, d)
        c = ler(Path(d) / "c.log")
        conferir(r.returncode == 0, "filho saiu limpo", r.stderr[-300:])
        conferir("faulthandler True" in r.stdout, "faulthandler ligado", r.stdout)
        conferir("thread overlay-teste morreu: ValueError: thread de teste quebrou" in c, "thread que lança vira "
                 "linha no log", c[-400:])
        conferir("Traceback" in c and "quebra" in c, "a pilha da thread vai junto")
        conferir("exceção ignorada" in c and "RuntimeError: del de teste" in c, "exceção ignorada (unraisable) no log",
                 c[-400:])
        conferir("batimento: fase InProgress, partida 42, threads" in c, "batimento com fase e partida", c[-400:])
        conferir(c.count("batimento: ") >= 2, "batimento repete no intervalo")
        conferir(" handles " in c and " mem " in c, "batimento com memória e handles")
        conferir("coletor saindo (ocioso de teste; vivo há" in c, "atexit escreve 'coletor saindo (motivo)'", c[-300:])
        conferir("faulthandler ligado" in ler(Path(d) / "falha.log"), "cabeçalho no arquivo de falha")


def teste_fio_principal():
    with tempfile.TemporaryDirectory() as d:
        r = roda("""
            vida.ligar(log, batimento=False)
            raise KeyError("fio principal de teste")
        """, d)
        c = ler(Path(d) / "c.log")
        conferir(r.returncode != 0, "exceção no principal sai com rc != 0")
        conferir("exceção não tratada no fio principal: KeyError" in c, "sys.excepthook no log", c[-300:])
        conferir("coletor saindo (sem motivo: saída fora do principal()" in c, "atexit sem motivo", c[-300:])


def teste_queda_nativa_pythonw():
    """pythonw filho (stdin/stdout/stderr = NUL): access violation e Py_FatalError deixam a pilha no arquivo"""
    for nome, codigo, esperado in (
            ("access violation", "import faulthandler; faulthandler._read_null()",
             "Windows fatal exception: access violation"),
            ("Fatal Python error", "import ctypes; ctypes.pythonapi.Py_FatalError(b'queda de teste do vida')",
             "Fatal Python error: queda de teste do vida")):
        with tempfile.TemporaryDirectory() as d:
            falha = Path(d) / "falha.log"
            # SEM_NOGPFAULTERRORBOX: a queda de teste não vira evento 1000/1001 no log de Aplicativo (sujaria a
            # próxima investigação de queda de verdade, que procura exatamente esses eventos)
            r = roda(f"""
                import ctypes as _c; _c.windll.kernel32.SetErrorMode(0x0002)
                vida.ligar(log, falha={str(falha)!r}, batimento=False)
                {codigo}
            """, d, exe=PYW, stdin=subprocess.DEVNULL)
            f = ler(falha)
            conferir(r.returncode != 0 and esperado in f, f"pythonw: {nome} no coletor-falha.log",
                     f"rc {r.returncode}; arquivo: {f[-300:]!r}")
            conferir("filho.py" in f, f"pythonw: {nome} com a linha do Python")


def teste_repetida():
    """revisão adversarial (15/10/2026): wndproc/__del__ que lança a cada mensagem não vira uma pilha por mensagem"""
    with tempfile.TemporaryDirectory() as d:
        r = roda("""
            vida.REPETIDA_S = 0.5
            vida.ligar(log, batimento=False)
            class Ruim:
                def __del__(self):
                    raise RuntimeError("wndproc de teste")
            for _ in range(50):
                Ruim()
            def quebra():
                raise ValueError("thread em laço")
            for _ in range(5):
                t = threading.Thread(target=quebra, name="laco"); t.start(); t.join()
            time.sleep(0.6)
            Ruim()
        """, d)
        c = ler(Path(d) / "c.log")
        conferir(r.returncode == 0, "repetida: filho saiu limpo", r.stderr[-300:])
        conferir(c.count("exceção ignorada") == 2, "50 exceções ignoradas iguais = 1 linha (+1 depois da janela)",
                 f"{c.count('exceção ignorada')} linhas")
        conferir("(+49 iguais caladas no minuto anterior)" in c, "a linha seguinte conta as caladas", c[-300:])
        conferir(c.count("thread laco morreu") == 1, "5 threads iguais morrendo = 1 linha",
                 f"{c.count('thread laco morreu')} linhas")


def teste_falha_viva():
    """o faulthandler do Windows imprime até access violation TRATADA (ctypes -> OSError): com o coletor vivo o
    arquivo de falha não pode crescer sem teto. python e pythonw (stderr do C no arquivo)"""
    for exe, nome in ((PY, "python"), (PYW, "pythonw")):
        with tempfile.TemporaryDirectory() as d:
            falha = Path(d) / "falha.log"
            r = roda(f"""
                import ctypes
                ctypes.windll.kernel32.SetErrorMode(0x0002)
                vida.FALHA_MAX = 4000
                vida.ligar(log, falha={str(falha)!r}, intervalo=0.2)
                for _ in range(15):
                    try:
                        ctypes.string_at(0)
                    except OSError:
                        pass
                def quebra():
                    raise ValueError("thread de teste")
                t = threading.Thread(target=quebra, name="fio-x"); t.start(); t.join()
                time.sleep(0.7)
                print("vivo")
                vida.saindo("fim do teste")
            """, d, exe=exe, stdin=subprocess.DEVNULL)
            c, f, f1 = ler(Path(d) / "c.log"), ler(falha), ler(Path(d) / "falha.log.1")
            conferir(r.returncode == 0, f"{nome}: access violation tratada não derruba", r.stderr[-300:])
            conferir("cresceu" in c and "não é queda" in c, f"{nome}: aviso 'cresceu com o coletor vivo' no log",
                     c[-400:])
            conferir("girado com o coletor vivo" in f and len(f.encode()) < 4000 and
                     "Windows fatal exception: access violation" in f1,
                     f"{nome}: passou do teto = copiado para .1 e zerado no lugar",
                     f"atual {len(f)} bytes: {f[:200]!r}")
            conferir("thread fio-x morreu" in c and "Traceback" not in f.split("girado")[-1],
                     f"{nome}: pilha da thread no log, não repetida no arquivo de falha", f[-300:])
            conferir("coletor saindo (fim do teste" in c, f"{nome}: segue vivo e sai normal")


def teste_rotacao():
    sys.path.insert(0, str(RAIZ / "coletor"))
    import vida
    with tempfile.TemporaryDirectory() as d:
        arq = Path(d) / "falha.log"
        arq.write_bytes(b"x" * (vida.FALHA_MAX + 10))
        vida._girar(arq)
        conferir(not arq.exists() and (Path(d) / "falha.log.1").stat().st_size == vida.FALHA_MAX + 10,
                 "arquivo de falha grande vira .1")
        arq.write_bytes(b"y" * 10)
        vida._girar(arq)
        conferir(arq.exists(), "arquivo pequeno fica")


def teste_ultimo_registro():
    sys.path.insert(0, str(RAIZ / "coletor"))
    import vida
    with tempfile.TemporaryDirectory() as d:
        arq = Path(d) / "c.log"
        arq.write_text("2026-10-15 02:36:12,121 INFO batimento: fase InProgress, partida 1\n"
                       "2026-10-15 02:37:27,734 INFO aviso voz gank/amarelo: gank provável no bot\n"
                       "  linha de pilha sem hora\n", encoding="utf-8")
        (ultima, texto), bat = vida.ultimo_registro(arq)
        conferir(ultima == "2026-10-15 02:37:27" and texto.startswith("aviso voz"), "última linha com hora", texto)
        conferir(bat == "2026-10-15 02:36:12", "hora do último batimento", str(bat))
        conferir(vida.ultimo_registro(Path(d) / "nao-existe.log") == (None, None), "log ausente = (None, None)")


def teste_principal():
    """coletor.principal() de verdade, com dados/ trocado por pasta temporária, --sem-coach (nada na 8765) e lockfile
    inexistente: sai por ociosidade em ~3 s. Trava órfã de antes (pid 4, o System) = a linha da morte seca"""
    with tempfile.TemporaryDirectory() as d:
        dd = Path(d)
        (dd / "coletor.lock").write_text("4")
        (dd / "coletor.log").write_text("2026-10-15 02:36:27,000 INFO batimento: fase InProgress, partida 1\n"
                                        "2026-10-15 02:37:27,734 INFO aviso voz gank/amarelo: gank provável no bot\n",
                                        encoding="utf-8")
        arq = dd / "principal.py"
        arq.write_text(textwrap.dedent(f"""
            import sys
            from pathlib import Path
            sys.path.insert(0, {str(RAIZ / 'coletor')!r})
            import coletor, vida
            d = Path({str(dd)!r})
            coletor.DADOS, coletor.TRAVA, coletor.LOG, coletor.FALHA = d, d / "coletor.lock", d / "coletor.log", d / "falha.log"
            vida.INTERVALO_S = 1.0
            sys.argv = ["coletor.py", "--ocioso-min", "0.05", "--lockfile", r"C:\\nao\\existe", "--sem-coach",
                        "--db", str(d / "x.db")]
            sys.exit(coletor.principal())
        """), encoding="utf-8")
        r = subprocess.run([PY, str(arq)], capture_output=True, text=True, timeout=60, creationflags=CREATE_NO_WINDOW)
        c = ler(dd / "coletor.log")
        conferir(r.returncode == 0, "principal(): saiu com rc 0", r.stderr[-300:])
        conferir("a instância anterior (pid 4) parou sem 'encerrado': última linha às 2026-10-15 02:37:27 (aviso voz"
                 in c and "último batimento 2026-10-15 02:36:27" in c, "principal(): linha da morte seca da anterior",
                 c[-500:])
        conferir("vida: batimento a cada" in c, "principal(): vida ligada")
        conferir("batimento: fase -" in c, "principal(): batimento sem client (fase -)", c[-400:])
        i, s = c.find("encerrado (ocioso"), c.find("coletor saindo (ocioso")
        conferir(0 <= i < s, "principal(): 'encerrado' e depois 'coletor saindo (motivo)'", c[-300:])
        conferir("faulthandler ligado" in ler(dd / "falha.log"), "principal(): arquivo de falha aberto")
        conferir(not (dd / "coletor.lock").exists(), "principal(): trava solta ao sair")


def teste_tarefa_real():
    """pythonw lançado pelo Agendador (sem handle de stdin/stdout/stderr: o stderr do C nasce sem arquivo)"""
    pasta = RAIZ / "temp" / "teste-vida-tarefa"
    pasta.mkdir(parents=True, exist_ok=True)
    falha = pasta / "falha.log"
    falha.unlink(missing_ok=True)
    script = pasta / "queda.py"
    script.write_text(textwrap.dedent(f"""
        import sys, logging
        sys.path.insert(0, {str(RAIZ / 'coletor')!r})
        import vida, ctypes
        ctypes.windll.kernel32.SetErrorMode(0x0002)   # sem evento 1000 no log de Aplicativo pela queda de teste
        log = logging.getLogger("t"); log.addHandler(logging.FileHandler({str(pasta / 'c.log')!r}, encoding="utf-8"))
        vida.ligar(log, falha={str(falha)!r}, batimento=False)
        ctypes.pythonapi.Py_FatalError(b"queda de teste pela tarefa")
    """), encoding="utf-8")
    cmd = f'"{PYW}" "{script}"'
    try:
        r = subprocess.run(["schtasks", "/create", "/tn", TAREFA_TESTE, "/tr", cmd, "/sc", "once", "/st", "23:59",
                            "/f", "/it"], capture_output=True, text=True, encoding="oem", errors="replace",
                           creationflags=CREATE_NO_WINDOW)
        conferir(r.returncode == 0, "tarefa de teste criada", r.stdout + r.stderr)
        subprocess.run(["schtasks", "/run", "/tn", TAREFA_TESTE], capture_output=True, creationflags=CREATE_NO_WINDOW)
        fim = time.monotonic() + 30
        while time.monotonic() < fim and "queda de teste pela tarefa" not in ler(falha):
            time.sleep(0.5)
        f = ler(falha)
        conferir("Fatal Python error: queda de teste pela tarefa" in f and "queda.py" in f,
                 "pela tarefa: Fatal Python error + pilha no arquivo de falha", repr(f[-400:]))
    finally:
        subprocess.run(["schtasks", "/delete", "/tn", TAREFA_TESTE, "/f"], capture_output=True,
                       creationflags=CREATE_NO_WINDOW)
        q = subprocess.run(["schtasks", "/query", "/tn", TAREFA_TESTE], capture_output=True,
                           creationflags=CREATE_NO_WINDOW)
        conferir(q.returncode != 0, "tarefa de teste removida")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--real", action="store_true", help="também a queda pela tarefa agendada (cria e remove "
                    f"{TAREFA_TESTE})")
    a = ap.parse_args()
    for f in (sys.stdout, sys.stderr):
        if f and hasattr(f, "reconfigure"):
            f.reconfigure(encoding="utf-8")
    teste_ganchos()
    teste_fio_principal()
    teste_queda_nativa_pythonw()
    teste_repetida()
    teste_falha_viva()
    teste_rotacao()
    teste_ultimo_registro()
    teste_principal()
    if a.real:
        teste_tarefa_real()
    print(f"{'ok' if not falhas else 'FALHOU'}: {len(falhas)} falha(s)" + (f" ({', '.join(falhas)})" if falhas else ""))
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
