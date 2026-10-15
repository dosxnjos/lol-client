# prova do vigia do coletor (tools/vigia-coletor.py, 15/10/2026). Nada do coletor real: trava, logs e pasta do vigia
# em temp/, portas livres sorteadas (nunca a 8765), tarefas de teste com outro nome.
#   python tools/teste-vigia.py          decisão, XML da tarefa, leitura de processos e portas, rodada sem schtasks
#   python tools/teste-vigia.py --real   + tarefas "lol-client-vigia-teste" e "lol-client-coletor-teste" (um coletor
#                                         FALSO que só grava a trava e dorme 40 s): o vigia da tarefa adia com teste
#                                         rodando, sobe o falso pela tarefa dele, não duplica; as duas tarefas saem no fim
import argparse
import importlib.util
import json
import os
import socket
import sys
import tempfile
import textwrap
import time
import xml.etree.ElementTree as ET
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PYW = str(Path(sys.executable).with_name("pythonw.exe"))
CREATE_NO_WINDOW = 0x08000000
T_VIGIA, T_COLETOR = "lol-client-vigia-teste", "lol-client-coletor-teste"
falhas = []

_s = importlib.util.spec_from_file_location("vigia_coletor", RAIZ / "tools" / "vigia-coletor.py")
V = importlib.util.module_from_spec(_s)
_s.loader.exec_module(V)


def conferir(cond, nome, detalhe=""):
    print(("ok   " if cond else "FALHA") + f" {nome}" + (f": {detalhe}" if detalhe and not cond else ""))
    if not cond:
        falhas.append(nome)


def porta_livre():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def teste_decidir():
    agora = 1_800_000_000.0
    base = {"client": True, "coletor_vivo": False, "testes": [], "subidas": [], "marcas": []}
    d = V.decidir
    conferir(d({**base, "pausado_ate": agora + 60}, agora)[0] == "adiar", "pausado = adiar")
    conferir(d({**base, "pausado_ate": agora - 60}, agora)[0] == "subir", "pausa vencida = segue")
    conferir(d({**base, "client": False}, agora)[0] == "nada", "client fechado = nada")
    conferir(d({**base, "coletor_vivo": True}, agora)[0] == "nada", "coletor vivo = nada (nunca mexe)")
    conferir(d({**base, "testes": [8766]}, agora) == ("adiar", "porta de teste ouvindo (8766): teste em curso"),
             "porta de teste ouvindo = adiar")
    conferir(d({**base, "marcas": None}, agora)[0] == "ler_marcas", "antes de subir lê as linhas de comando")
    conferir(d({**base, "marcas": ["pid 1: python tools/rodar-testes.py"]}, agora)[0] == "adiar",
             "teste do projeto rodando = adiar")
    conferir(d(base, agora) == ("subir", "client aberto e coletor fora"), "client aberto e coletor fora = subir")
    tres = [agora - 600, agora - 400, agora - 200]
    conferir(d({**base, "subidas": tres}, agora)[0] == "adiar", "3 subidas em 30 min = espera")
    conferir(d({**base, "subidas": [agora - 1700, agora - 1500, agora - 16 * 60]}, agora)[0] == "subir",
             "15 min depois da última, tenta de novo")
    m = V.marcas_de_teste({1: r"C:\Python314\python.exe tools\rodar-testes.py", 2: "pythonw coletor\\coletor.py",
                           3: r"pythonw C:\Dev\lol-client\tools\vigia-coletor.py conferir",
                           4: r"python C:\Dev\lol-client\tools\teste-coach.py", 5: "python servidor.py"}, eu=99)
    conferir(len(m) == 2 and "pid 1" in m[0] and "pid 4" in m[1], "marcas: teste do projeto sim, coletor e vigia não",
             str(m))
    # revisão adversarial (15/10/2026): coletor.py vivo sem trava (subindo antes do travar(), ou lançado fora da
    # tarefa) = adiar, senão o /run vira um segundo coletor; tarefa "Running" com trava morta = adiar sem contar subida
    conferir(d({**base, "sem_trava": ["pid 7"]}, agora)[0] == "adiar", "coletor.py vivo sem trava = adiar (não duplica)")
    conferir(d({**base, "tarefa_rodando": True}, agora)[0] == "adiar", "tarefa rodando com trava morta = adiar")
    cmds = {1: r'"C:\Python314\pythonw.exe" "C:\Dev\lol-client\coletor\coletor.py"',
            2: r"pythonw C:\Dev\lol-client\tools\vigia-coletor.py conferir",
            3: r"python coletor\coletor.py --liveclient http://127.0.0.1:2998 --porta-painel 8766",
            4: r"python C:\Dev\lol-client\tools\teste-vida.py", 5: "python coletor.py --so-backfill", 6: None}
    conferir(V.coletores_sem_trava(cmds, eu=99) == ["pid 1", "pid 5"],
             "coletor sem trava: o real sim; vigia, prova (porta de teste) e teste não", str(V.coletores_sem_trava(cmds)))
    s = V.marcas_de_teste({8: r"python tools\teste-x.py --token abc123 --senha=xyz password: p4ss"})
    conferir(s and "abc123" not in s[0] and "xyz" not in s[0] and "p4ss" not in s[0] and s[0].count("***") == 3,
             "linha de comando no log sem o valor de --token/--senha", str(s))


def teste_xml():
    x = V.xml_tarefa(r"C:\Python314\pythonw.exe", "S-1-5-21-1-2-3-1001", "lol-client-vigia", '"x.py" conferir',
                     __import__("datetime").datetime(2026, 10, 15, 3, 0))
    ns = {"t": "http://schemas.microsoft.com/windows/2004/02/mit/task"}
    r = ET.fromstring(x.replace('encoding="UTF-16"', ""))
    g = lambda p: (r.find(p, ns).text if r.find(p, ns) is not None else None)   # noqa: E731
    conferir(g(".//t:LogonType") == "InteractiveToken", "só logado (InteractiveToken)")
    conferir(g(".//t:RunLevel") == "LeastPrivilege", "sem admin (LeastPrivilege)")
    conferir(g(".//t:Hidden") == "true" and g(".//t:Command").endswith("pythonw.exe"), "oculta e sem console (pythonw)")
    conferir(g(".//t:MultipleInstancesPolicy") == "IgnoreNew", "uma instância por vez")
    conferir(g(".//t:Repetition/t:Interval") == "PT3M" and r.find(".//t:Repetition/t:Duration", ns) is None,
             "a cada 3 min, sem fim")
    conferir(g(".//t:ExecutionTimeLimit") == "PT2M", "rodada de no máximo 2 min")


def teste_windows():
    p = V.processos()
    conferir(p.get(os.getpid(), "").lower().startswith("python"), "processos() acha o próprio python")
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen()
        porta = s.getsockname()[1]
        conferir(V.ouvintes(porta) == [os.getpid()], "ouvintes() acha quem ouve na porta (sem conectar)")
    conferir(V.ouvintes(porta) == [], "porta fechada = ninguém")


def args_vigia(pasta, **kw):
    a = V.args_parser().parse_args(["conferir"])
    a.dados, a.trava, a.log_coletor = str(pasta), str(pasta / "coletor.lock"), str(pasta / "coletor.log")
    a.porta, a.portas_teste, a.client_exe, a.tarefa_coletor = porta_livre(), (porta_livre(),), "nao-existe.exe", "x"
    a.sem_marcas, a.espera = True, 1.0
    for k, v in kw.items():
        setattr(a, k, v)
    return a


def teste_rodada_sem_tarefa():
    """conferir() de verdade (processos, portas, trava, vigia.json), em caminhos que não chamam o schtasks"""
    import logging
    log = logging.getLogger("teste-vigia")
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        eu = Path(sys.executable).name
        conferir(V.conferir(args_vigia(d), log)[0] == "nada", "rodada: client fechado = nada")
        (d / "coletor.lock").write_text(str(os.getpid()))
        os.utime(d / "coletor.lock", (time.time() + 5, time.time() + 5))     # trava depois de eu nascer: vivo
        conferir(V.conferir(args_vigia(d, client_exe=eu), log)[0] == "nada", "rodada: trava viva = nada")
        # coletor vivo há 10 min sem batimento no log (o caso da 1ª rodada depois de instalar, com o coletor ainda no
        # código antigo): nada, um aviso só, e o aviso não repete na rodada seguinte (30 min)
        (d / "coletor.log").write_text("2026-10-15 03:07:15,747 INFO ao vivo iniciado\n", encoding="utf-8")
        (d / "coletor.lock").write_text(str(os.getpid()))
        agora = time.time() - 1                  # depois de eu nascer (senão é pid reaproveitado); limiar zerado abaixo
        os.utime(d / "coletor.lock", (agora, agora))
        vl = V.abrir_log(d)
        limiar, V.SEM_BATIMENTO_S = V.SEM_BATIMENTO_S, 0
        try:
            ac1 = V.conferir(args_vigia(d, client_exe=eu), vl)[0]
            av = json.loads((d / "vigia.json").read_text(encoding="utf-8")).get("aviso_batimento")
            ac2 = V.conferir(args_vigia(d, client_exe=eu), vl)[0]
            av2 = json.loads((d / "vigia.json").read_text(encoding="utf-8")).get("aviso_batimento")
        finally:
            V.SEM_BATIMENTO_S = limiar
        texto = (d / "vigia.log").read_text(encoding="utf-8")
        conferir(ac1 == ac2 == "nada" and av and av == av2 and texto.count("sem batimento nenhum no log") == 1,
                 "rodada: vivo sem batimento = aviso uma vez (nunca mata)", texto[-300:])
        (d / "coletor.lock").write_text("4")                                 # pid do System: não é python = órfã
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            s.listen()
            ac, mot = V.conferir(args_vigia(d, client_exe=eu, portas_teste=(s.getsockname()[1],)), log)
        conferir(ac == "adiar" and "teste em curso" in mot, "rodada: porta de teste ouvindo = adiar", mot)
        V.main(["pausar", "5", "--dados", str(d)])
        ac, mot = V.conferir(args_vigia(d, client_exe=eu), log)
        conferir(ac == "adiar" and "pausado" in mot, "rodada: pausado = adiar", mot)
        V.main(["retomar", "--dados", str(d)])
        conferir(not (d / "vigia.pausa").exists(), "retomar apaga a pausa")
        e = json.loads((d / "vigia.json").read_text(encoding="utf-8"))
        conferir(e.get("acao") == "adiar" and e.get("ultima"), "vigia.json guarda a última rodada")
        vl = logging.getLogger("vigia-coletor")
        for h in list(vl.handlers):          # o arquivo aberto seguraria a pasta temporária no Windows
            h.close()
            vl.removeHandler(h)
        conferir("pausado por 5 min" in (d / "vigia.log").read_text(encoding="utf-8"), "vigia.log registra a pausa")


def esperar(cond, s):
    fim = time.monotonic() + s
    while time.monotonic() < fim:
        if cond():
            return True
        time.sleep(0.5)
    return False


def schtasks(*a):
    return V.schtasks(*a)


def teste_real():
    pasta = RAIZ / "temp" / "teste-vigia"
    pasta.mkdir(parents=True, exist_ok=True)
    for n in ("coletor.lock", "coletor.log", "vigia.json", "vigia.log", "falso-subidas.txt", "vigia.pausa"):
        (pasta / n).unlink(missing_ok=True)
    falso = pasta / "coletor-falso.py"
    falso.write_text(textwrap.dedent(f"""
        # coletor FALSO da prova do vigia: grava a trava, anota que subiu e dorme 40 s
        import os, time
        from pathlib import Path
        p = Path({str(pasta)!r})
        (p / "coletor.lock").write_text(str(os.getpid()))
        with open(p / "falso-subidas.txt", "a") as f:
            f.write(f"{{os.getpid()}}\\n")
        time.sleep(40)
        (p / "coletor.lock").unlink(missing_ok=True)
    """), encoding="utf-8")
    extra = (f'--dados "{pasta}" --trava "{pasta / "coletor.lock"}" --log-coletor "{pasta / "coletor.log"}" '
             f"--tarefa-coletor {T_COLETOR} --porta {porta_livre()} --portas-teste {porta_livre()} "
             f"--client-exe explorer.exe --espera 20")

    def estado():
        try:
            return json.loads((pasta / "vigia.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def rodar_vigia(antes):
        schtasks("/run", "/tn", T_VIGIA)
        return esperar(lambda: estado().get("ultima") not in (None, antes), 60)

    try:
        rc, out = schtasks("/create", "/tn", T_COLETOR, "/tr", f'"{PYW}" "{falso}"', "/sc", "once", "/st", "23:59",
                           "/f", "/it")
        conferir(rc == 0, "tarefa do coletor falso criada", out)
        # 1) com marcas: este teste (tools/teste-vigia.py) está rodando -> o vigia da tarefa ADIA
        conferir(V.instalar(T_VIGIA, extra, repetir_min=60, saida=lambda *_: None) == 0, "tarefa do vigia de teste "
                 "criada (sem admin)")
        conferir(rodar_vigia(None) and estado().get("acao") == "adiar" and "teste do projeto rodando" in
                 estado().get("motivo", ""), "pela tarefa: teste do projeto rodando = adia", str(estado()))
        conferir(not (pasta / "falso-subidas.txt").exists(), "adiado não subiu nada")
        # 2) sem marcas: sobe o falso pela tarefa dele
        V.instalar(T_VIGIA, extra + " --sem-marcas", repetir_min=60, saida=lambda *_: None)
        antes = estado().get("ultima")
        time.sleep(1.1)                                   # "ultima" tem resolução de 1 s
        conferir(rodar_vigia(antes) and esperar(lambda: estado().get("acao") in ("subir", "erro"), 40)
                 and estado().get("acao") == "subir", "pela tarefa: client aberto e coletor fora = sobe", str(estado()))
        sub = (pasta / "falso-subidas.txt").read_text().split() if (pasta / "falso-subidas.txt").exists() else []
        conferir(len(sub) == 1 and estado().get("ultima_subida", {}).get("pid") == int(sub[0]),
                 "o coletor (falso) subiu pela tarefa dele, e o vigia viu a trava nova", f"{sub} {estado()}")
        clog = (pasta / "coletor.log").read_text(encoding="utf-8") if (pasta / "coletor.log").exists() else ""
        conferir("WARNING vigia: coletor fora com o client aberto" in clog and T_COLETOR in clog,
                 "linha do vigia no log do coletor", clog[-300:])
        # 3) de novo, com o falso vivo: nada (nunca duplica, nunca mata)
        antes = estado().get("ultima")
        time.sleep(1.1)
        conferir(rodar_vigia(antes) and estado().get("acao") == "nada" and estado().get("motivo") == "coletor vivo",
                 "pela tarefa: coletor vivo = nada", str(estado()))
        sub2 = (pasta / "falso-subidas.txt").read_text().split()
        conferir(sub2 == sub, "sem segunda instância", str(sub2))
        conferir(V.pid_vivo(int(sub[0])), "o coletor falso segue vivo (o vigia não mata)")
        vlog = (pasta / "vigia.log").read_text(encoding="utf-8")
        conferir("coletor subiu pelo vigia (pid" in vlog, "vigia.log: subiu", vlog[-300:])
    finally:
        for t in (T_VIGIA, T_COLETOR):
            schtasks("/delete", "/tn", t, "/f")
            conferir(schtasks("/query", "/tn", t)[0] != 0, f"tarefa {t} removida")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--real", action="store_true", help=f"também pelas tarefas {T_VIGIA} e {T_COLETOR} (removidas)")
    a = ap.parse_args()
    for f in (sys.stdout, sys.stderr):
        if f and hasattr(f, "reconfigure"):
            f.reconfigure(encoding="utf-8")
    teste_decidir()
    teste_xml()
    teste_windows()
    teste_rodada_sem_tarefa()
    if a.real:
        teste_real()
    print(f"{'ok' if not falhas else 'FALHOU'}: {len(falhas)} falha(s)" + (f" ({', '.join(falhas)})" if falhas else ""))
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
