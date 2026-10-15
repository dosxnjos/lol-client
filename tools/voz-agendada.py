"""Agendador do pacote de voz pré-gravada (plano 2026-10-13-voz-pregravada-e-foco, passo 6b).

Pedido do Gabriel (13/10/2026): "vamos misturando mas baixando o modelo completo ao longo dos dias. deixa o
agendamento aí". A tarefa `lol-client-voz` do Agendador do Windows chama `rodar` às 05:15 e a cada 2 h até
23:15 (a cota grátis do Gemini TTS renova à meia-noite do Pacífico: 04:00 BRT, 05:00 depois de 01/11). Cada
rodada roda o `tools/gerar-pacote-voz.py` (venv do TTS, os dois tons): primeiro as falas que faltam, depois a
convergência para o modelo-alvo. Pacote completo e 100% no alvo: a tarefa se desativa e registra.

    pythonw tools\\voz-agendada.py rodar        o que a tarefa chama (sem janela; log em dados\\voz-agendada.log)
    python  tools\\voz-agendada.py estado       falas no pacote, no alvo, suspeitas, próxima rodada, última
    python  tools\\voz-agendada.py instalar     registra (ou refaz) a tarefa; não pede senha nem admin
    python  tools\\voz-agendada.py remover      apaga a tarefa

Regras (CLAUDE.md, ARMADILHAS § Voz pré-gravada e § Windows):
- sai na hora com `League of Legends.exe` aberto ou o client fora de None/Lobby/EndOfGame (fase pela LCU como o
  coletor: a credencial do lockfile só vive em memória, nunca no log); se o client entra em fila no meio, cria
  `dados\\voz-agendada.parar` e o gerador para limpo antes do próximo pedido (jogo aberto há 2 min: mata);
- nunca abre janela: roda no `pythonw` e o gerador nasce com CREATE_NO_WINDOW (console oculto, que os filhos
  doppler/ffmpeg/py herdam); prioridade abaixo do normal;
- a chave do Gemini vem do Doppler (harness/dev) dentro do gerador; o log passa por um filtro de chave mesmo assim.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DADOS = RAIZ / "dados"
LOG = DADOS / "voz-agendada.log"
ULTIMA = DADOS / "voz-agendada.json"
PARAR = DADOS / "voz-agendada.parar"
TAREFA = "lol-client-voz"
VOZ = "aoede"
VOZ_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "lol-client" / "voz"
VENV_PY = VOZ_DIR / "venv" / "Scripts" / "python.exe"
GERADOR = RAIZ / "tools" / "gerar-pacote-voz.py"
PACOTE = VOZ_DIR / "pacotes" / VOZ
FASES_OK = (None, "None", "Lobby", "EndOfGame")      # None = client fechado
HORA, REPETIR_H, ATE = "05:15", 2, "23:15"
VIGIA_S = 15                     # de quanto em quanto o vigia olha o jogo e a fase durante a rodada
MATAR_S = 0                      # jogo aberto: mata a árvore na hora (revisão 13/10, item 2: um lote leva ~2 min
#                                  de Whisper e ffmpeg, que cairiam na tela de carregamento; o índice é atômico e
#                                  os órfãos se limpam, só se perde o pedido em curso). Client em fila: só `parar`.
LIMITE_S = 100 * 60              # rodada longa demais (a tarefa mata em 2 h): pede para parar...
CARENCIA_S = 180                 # ...e mata se o gerador não saiu nesse tempo (um lote leva ~2 min)
CREATE_NO_WINDOW = 0x08000000
BELOW_NORMAL = 0x00004000
CHAVE = re.compile(r"AIza[0-9A-Za-z_-]{30,}")
RC = {"ok": 0, "erro": 1, "jogo": 10, "fase": 11}


def _oculto():
    return CREATE_NO_WINDOW if os.name == "nt" else 0


def sem_chave(texto):
    """filtro de último recurso: nenhuma chave de API do Google vai para o log (o gerador nunca imprime a chave,
    mas corpo de erro da API é texto de fora)"""
    return CHAVE.sub("AIza…(cortada)", texto)


def abrir_log():
    DADOS.mkdir(parents=True, exist_ok=True)
    log = logging.getLogger("voz-agendada")
    if not log.handlers:
        h = RotatingFileHandler(LOG, maxBytes=256_000, backupCount=3, encoding="utf-8")
        h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S"))
        log.addHandler(h)
        log.setLevel(logging.INFO)
    return log


# ---------------------------------------------------------------- jogo e client

def jogo_aberto():
    r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq League of Legends.exe", "/NH"], capture_output=True,
                       text=True, errors="replace", creationflags=_oculto())
    return "league of legends.exe" in r.stdout.lower()


class Fase:
    """fase do gameflow pela LCU, pelo mesmo caminho do coletor (coletor.conectar: lockfile lido em memória).
    Chamável: None = client fechado; "?" = client de pé mas a fase não veio (conta como "não rodar").
    Se o coletor.py nem importa (outra frente mexendo nele), `sem_rota` fica True e a fase vira None: sobra
    a checagem do processo do jogo, que o gerador também faz antes de cada pedido."""

    def __init__(self, log=None):
        self.log, self.lcu, self.sem_rota = log, None, False

    def __call__(self):
        if self.sem_rota:
            return None
        try:
            if str(RAIZ / "coletor") not in sys.path:      # uma vez só (o vigia chama a cada 15 s)
                sys.path.insert(0, str(RAIZ / "coletor"))
            import coletor
        except Exception as e:
            self.sem_rota = True
            if self.log:
                self.log.warning("fase do client indisponível (coletor.py não importa: %s); só o processo do jogo "
                                 "decide", type(e).__name__)
            return None
        for _ in range(2):
            if self.lcu is None:
                self.lcu = coletor.conectar()
                if self.lcu is None:
                    return None
            try:
                return self.lcu.get("/lol-gameflow/v1/gameflow-phase", timeout=10)
            except Exception:
                self.lcu = None
        return "?"


# ---------------------------------------------------------------- gerador

def matar_arvore(pid):
    subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], capture_output=True, creationflags=_oculto())


def executar(log, aberto=jogo_aberto, fase=None, cmd=None, parar=None, vigia_s=VIGIA_S, matar_s=MATAR_S,
             limite_s=LIMITE_S):
    """roda o gerador com console oculto e prioridade baixa, cada linha da saída no log (filtrada); vigia o
    jogo e a fase: saiu do lobby -> cria `parar` (o gerador para limpo antes do próximo pedido ou no meio de uma
    espera da API); fase ilegível ("?") só conta na 2ª leitura seguida; jogo aberto há matar_s (padrão: na
    hora) -> mata a árvore. Devolve (rc, resumo do gerador ou None)."""
    parar = Path(parar or PARAR)
    parar.unlink(missing_ok=True)
    cmd = cmd or [str(VENV_PY), "-u", str(GERADOR), "--voz", VOZ, "--tom", "ambos", "--parar-se", str(parar)]
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"}
    p = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, cwd=str(RAIZ),
                         env=env, text=True, encoding="utf-8", errors="replace",
                         creationflags=_oculto() | (BELOW_NORMAL if os.name == "nt" else 0))
    resumo = {}

    def ler():
        for linha in p.stdout:
            linha = sem_chave(linha.rstrip())
            if linha.startswith("RESUMO "):
                try:
                    resumo.update(json.loads(linha[7:]))
                except ValueError:
                    pass
            if linha:
                log.info("gerador | %s", linha)
    leitor = threading.Thread(target=ler, daemon=True, name="voz-agendada-leitor")
    leitor.start()
    t0, jogo_desde, duvida, morto = time.monotonic(), None, 0, False
    while True:
        try:
            p.wait(vigia_s)
            break
        except subprocess.TimeoutExpired:
            pass
        jogo = aberto()
        f = fase() if (fase is not None and not jogo) else None
        duvida = duvida + 1 if f == "?" else 0
        if f == "?" and duvida < 2:      # uma leitura falha da LCU não encerra a rodada (revisão 13/10, item 11)
            f = None
        motivo = ("League of Legends.exe abriu" if jogo else f"client em {f}" if f not in FASES_OK
                  else "rodada passou do limite" if time.monotonic() - t0 > limite_s else None)
        if motivo and not parar.exists():
            parar.touch()
            log.info("%s: pedindo ao gerador para parar limpo", motivo)
        if jogo:
            jogo_desde = jogo_desde or time.monotonic()
            if time.monotonic() - jogo_desde >= matar_s and not morto:
                log.warning("jogo aberto e o gerador ainda de pé: matando o processo (o índice é atômico; os órfãos "
                            "saem na próxima rodada)")
                matar_arvore(p.pid)
                morto = True
        elif time.monotonic() - t0 > limite_s + CARENCIA_S and not morto:
            log.warning("rodada passou do limite e o gerador não saiu: matando o processo")
            matar_arvore(p.pid)
    leitor.join(5)
    parar.unlink(missing_ok=True)
    return p.returncode, (resumo or None)


def ler_progresso():
    """progresso_alvo do indice.json, como o gerador gravou no fim da rodada"""
    try:
        return json.loads((PACOTE / "indice.json").read_text(encoding="utf-8")).get("progresso_alvo") or {}
    except (OSError, ValueError):
        return {}


def schtasks(*args):
    # a saída do schtasks vem na página OEM (cp850 no pt-BR): sem isso "ÊXITO" vira "ÒXITO"
    r = subprocess.run(["schtasks", *args], capture_output=True, text=True, errors="replace", creationflags=_oculto(),
                       encoding="oem" if os.name == "nt" else None)
    return r.returncode, (r.stdout + r.stderr).strip()


def desativar():
    rc, out = schtasks("/change", "/tn", TAREFA, "/disable")
    return rc == 0, out


def gravar_ultima(d):
    try:
        DADOS.mkdir(parents=True, exist_ok=True)
        tmp = ULTIMA.with_suffix(".tmp")
        tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
        os.replace(tmp, ULTIMA)
    except OSError:
        pass


def descrever_conclusao(prog):
    """o "100%" honesto (revisão 13/10, item 4): presas (recusadas no alvo em MAX_TENTATIVAS_ALVO dias, inclusive
    suspeita presa, que segue na Maria) ficam fora do critério de desligar, e aparecem aqui. Suspeita refazível não
    deixa concluir (a fase b a refaz no alvo; passo 6c)"""
    alvo = prog.get("modelo_alvo")
    presas, susp = prog.get("presas") or 0, prog.get("suspeitas") or 0
    if not presas and not susp:
        return f"completo e 100% no modelo-alvo {alvo}"
    return (f"completo; {prog.get('no_alvo')} de {prog.get('total')} no modelo-alvo {alvo} (100% do que o alvo "
            f"aceitou: {presas} presa(s), {susp} suspeita(s) na Maria; refazer: gerador com --refazer-suspeitas ou "
            f"--modelo-alvo)")


def rodar(log, aberto=jogo_aberto, fase=None, executar_fn=executar, progresso_fn=ler_progresso,
          desativar_fn=desativar):
    """uma rodada agendada. Devolve o código de saída (RC): 0 rodou (ou nada a fazer), 10 jogo aberto,
    11 client fora do lobby, 1 erro do gerador."""
    fase = fase if fase is not None else Fase(log)
    inicio = time.strftime("%Y-%m-%d %H:%M:%S")
    ultima = {"inicio": inicio}
    if aberto():
        log.info("League of Legends.exe aberto: rodada pulada (o processador é do jogo)")
        gravar_ultima({**ultima, "fim": inicio, "resultado": "pulada: jogo aberto", "rc": RC["jogo"]})
        return RC["jogo"]
    f = fase()
    if f not in FASES_OK:
        log.info("client em %s (fila, seleção ou partida): rodada pulada", f)
        gravar_ultima({**ultima, "fim": inicio, "resultado": f"pulada: client em {f}", "rc": RC["fase"]})
        return RC["fase"]
    log.info("rodada: jogo fechado, client em %s; doppler em %s; gerador no %s", f or "(fechado)",
             shutil.which("doppler") or "(não achado no PATH)", VENV_PY)
    rc, resumo = executar_fn(log, aberto=aberto, fase=fase)
    prog = progresso_fn() or (resumo or {}).get("progresso") or {}
    status = (resumo or {}).get("status") or f"erro (rc {rc}; traceback acima no log)"
    log.info("gerador saiu (rc %s, %s): %s de %s falas no pacote, %s no alvo %s, faltam %s, fora do alvo %s, "
             "suspeitas %s, presas %s", rc, status, prog.get("no_pacote"), prog.get("total"), prog.get("no_alvo"),
             prog.get("modelo_alvo"), prog.get("faltam"), prog.get("fora_do_alvo"), prog.get("suspeitas"),
             prog.get("presas"))
    desativada = None
    if rc == 0 and prog.get("concluido"):
        ok, out = desativar_fn()
        desativada = ok
        if ok:
            log.info("pacote %s: tarefa %s desativada (reativar: python tools\\voz-agendada.py instalar)",
                     descrever_conclusao(prog), TAREFA)
        else:
            log.warning("pacote concluído, mas a tarefa não desativou: %s", out[:200])
    gravar_ultima({**ultima, "fim": time.strftime("%Y-%m-%d %H:%M:%S"), "resultado": status, "rc": rc,
                   "resumo": resumo, "progresso": prog, "desativada": desativada})
    return RC["ok"] if rc in (0, 2, 3, 4) else RC["erro"]


# ---------------------------------------------------------------- instalar, remover, estado

def _sid():
    r = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"], capture_output=True, text=True, errors="replace",
                       creationflags=_oculto())
    m = re.search(r"(S-1-[0-9-]+)", r.stdout)
    if not m:
        raise RuntimeError("SID do usuário não veio do whoami")
    return m.group(1)


def _xml_escape(s):
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;"))


def xml_tarefa(pythonw, sid, inicio):
    """XML da tarefa (o mesmo molde da lol-client-coletor: InteractiveToken + LeastPrivilege = só logado, sem
    senha nem admin). Diária em `inicio`, repetindo a cada REPETIR_H h por 18 h (05:15 ... 23:15); oculta; uma
    instância por vez; prioridade 7 (abaixo do normal); 2 h no máximo."""
    h0, m0 = map(int, HORA.split(":"))
    h1, m1 = map(int, ATE.split(":"))
    dur_min = (h1 * 60 + m1) - (h0 * 60 + m0) + 1
    desc = ("lol-client: completa o pacote de voz Aoede e refaz no modelo-alvo as falas de outros modelos, com o "
            "jogo fechado; desativa sozinha ao concluir. Estado: python tools\\voz-agendada.py estado. "
            "Remover: python tools\\voz-agendada.py remover")
    return f"""<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>{_xml_escape(desc)}</Description>
    <URI>\\{TAREFA}</URI>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>{inicio:%Y-%m-%dT%H:%M:%S}</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
      <Repetition>
        <Interval>PT{REPETIR_H}H</Interval>
        <Duration>PT{dur_min // 60}H{dur_min % 60}M</Duration>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </CalendarTrigger>
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
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>true</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT2H</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>{_xml_escape(str(pythonw))}</Command>
      <Arguments>"{_xml_escape(str(Path(__file__).resolve()))}" rodar</Arguments>
      <WorkingDirectory>{_xml_escape(str(RAIZ))}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"""


def proximo_inicio(agora=None):
    """próximo HORA (hoje, se ainda não passou; senão amanhã): registrar à noite não dispara rodada hoje"""
    agora = agora or dt.datetime.now()
    h, m = map(int, HORA.split(":"))
    alvo = agora.replace(hour=h, minute=m, second=0, microsecond=0)
    return alvo if alvo > agora else alvo + dt.timedelta(days=1)


def instalar():
    pythonw = Path(sys.executable).with_name("pythonw.exe")
    if not pythonw.exists():
        print(f"pythonw não encontrado ao lado de {sys.executable}")
        return 1
    if not VENV_PY.exists():
        print(f"venv do TTS ausente: {VENV_PY}")
        return 1
    xml = xml_tarefa(pythonw, _sid(), proximo_inicio())
    with tempfile.TemporaryDirectory() as d:
        arq = Path(d) / "tarefa.xml"
        arq.write_text(xml, encoding="utf-16")
        rc, out = schtasks("/create", "/tn", TAREFA, "/xml", str(arq), "/f")
    print(out)
    return 0 if rc == 0 else 1


def remover():
    rc, out = schtasks("/delete", "/tn", TAREFA, "/f")
    print(out)
    return 0 if rc == 0 else 1


def info_tarefa():
    """estado da tarefa pelo PowerShell (o texto do `schtasks /query` é traduzido: pt-BR aqui) ou None"""
    ps = (f"$t = Get-ScheduledTask -TaskName '{TAREFA}' -ErrorAction SilentlyContinue; if ($t) {{ "
          "$i = $t | Get-ScheduledTaskInfo; $f = 'yyyy-MM-dd HH:mm'; "
          "[pscustomobject]@{ estado = [string]$t.State; "
          "proxima = $(if ($i.NextRunTime) { $i.NextRunTime.ToString($f) } else { '' }); "
          "ultima = $(if ($i.LastRunTime -and $i.LastRunTime.Year -gt 2000) { $i.LastRunTime.ToString($f) } else { '' }); "
          "resultado = $i.LastTaskResult } | ConvertTo-Json -Compress }")
    r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True,
                       text=True, errors="replace", creationflags=_oculto())
    try:
        return json.loads(r.stdout.strip()) if r.stdout.strip() else None
    except ValueError:
        return None


_RESULTADOS = {0: "ok", 2: "parou na cota (ok)", 10: "pulada: jogo aberto", 11: "pulada: client fora do lobby",
               1: "erro", 267009: "rodando agora", 267011: "nunca rodou", 2147946720: "pulada pelo Windows "
               "(instância já em curso)"}


def estado(saida=print):
    """resumo legível: pacote (do catálogo atual + índice, sem rede), tarefa, última rodada"""
    import importlib.util
    from collections import Counter
    sys.path.insert(0, str(RAIZ / "coletor"))
    spec = importlib.util.spec_from_file_location("gerar_pacote_voz", GERADOR)
    G = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(G)
    textos, _ = G.avisos.carregar_textos()
    todas = G.avisos.catalogo(textos)
    ind = G.ler_indice(PACOTE)
    alvo = ind.get("modelo_alvo")
    p = G.progresso(todas, PACOTE, ind, alvo)
    fs = ind.get("frases") or {}
    modelos = Counter(v.get("modelo") for f, v in fs.items() if f in set(todas) and isinstance(v, dict))
    saida(f"pacote {VOZ} ({PACOTE})")
    saida(f"  falas no pacote: {p['no_pacote']} de {p['total']} (faltam {p['faltam']}; os dois tons)")
    saida(f"  modelo-alvo: {alvo or '(definido na 1ª rodada com a API)'}; no alvo {p['no_alvo']}; fora do alvo a "
          f"refazer {p['fora_do_alvo']} (inclui suspeitas); presas {p['presas']}")
    saida(f"  suspeitas (tocam na Maria até a fase b refazer no alvo): {p['suspeitas']}")
    saida("  por modelo: " + (", ".join(f"{m} {n}" for m, n in modelos.most_common()) or "nenhum"))
    falhas = [f for f in (ind.get("falhas") or {}) if f in set(todas)]
    if falhas:
        saida(f"  fora do pacote por duração absurda (tentadas 1 vez por dia): {len(falhas)}")
    saida(f"  concluído: {'sim: ' + descrever_conclusao(p) if p['concluido'] else 'não'}")
    t = info_tarefa()
    if t is None:
        saida(f"tarefa {TAREFA}: não registrada (python tools\\voz-agendada.py instalar)")
    else:
        res = t.get("resultado")
        saida(f"tarefa {TAREFA}: {t.get('estado')}; próxima {t.get('proxima') or '-'}; última {t.get('ultima') or '-'} "
              f"({_RESULTADOS.get(res, res)})")
        if t.get("estado") == "Disabled" and not p["concluido"]:   # revisão 13/10, item 7: o catálogo cresceu
            saida(f"  ATENÇÃO: a tarefa está desativada mas faltam {p['faltam']} e {p['fora_do_alvo']} estão fora do "
                  "alvo (o catálogo mudou?): python tools\\voz-agendada.py instalar")
    try:
        u = json.loads(ULTIMA.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        u = None
    if u:
        r = u.get("resumo") or {}
        extra = (f"; {r.get('pedidos', 0)} pedido(s), {r.get('geradas', 0)} gravada(s), {r.get('trocadas', 0)} "
                 f"trocada(s) para o alvo, {r.get('mantidas', 0)} mantida(s)") if r else ""
        saida(f"última rodada: {u.get('inicio')} -> {u.get('fim')}: {u.get('resultado')}{extra}"
              + ("; tarefa desativada (concluído)" if u.get("desativada") else ""))
    saida(f"log: {LOG}")
    return 0


def main():
    ap = argparse.ArgumentParser(description="agendador do pacote de voz (tarefa lol-client-voz)")
    ap.add_argument("acao", nargs="?", default="estado", choices=("rodar", "estado", "instalar", "remover"))
    a = ap.parse_args()
    if sys.stdout is not None:
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass
    if a.acao == "rodar":
        log = abrir_log()
        try:
            return rodar(log)
        except Exception:
            log.exception("rodada caiu")
            return RC["erro"]
    if sys.stdout is None:          # pythonw sem console: estado/instalar não têm onde escrever
        return 1
    return {"estado": estado, "instalar": instalar, "remover": remover}[a.acao]()


if __name__ == "__main__":
    sys.exit(main())
