# Prova da P4.3 e da P4.5 do plano da publicação (roadmap/2026-10-19-publicacao-e-complemento-publico.md): instalação limpa
# do complemento coach público, do zip que o tools/publicar.py monta do HEAD, com tudo no temp:
#   LOCALAPPDATA, a pasta plugins do Pengu (LUC_PLUGINS) e a pasta Inicializar (LUC_INICIALIZAR) em pastas temporárias; o zip
#   extraído numa pasta com espaço e "!" (o duplo clique: cmd /c com a pasta atual dentro dela); o pip sem rede
#   (LUC_PIP_RODAS: pacotes .whl remontados das bibliotecas instaladas nesta máquina, nas versões do requirements; nada do
#   PyPI); LUC_SEM_INICIAR (o relançador não sobe o coletor de verdade, que procuraria o client aberto desta máquina).
#   (a) recusas antes de instalar: Python 3.11 (o único abaixo de 3.12 aqui), Python que não existe, destino junção, destino
#       com .git; nada criado
#   (b) instalação limpa: o complemento = o zip byte a byte (EDICAO incluso), venv com as 6 bibliotecas nas versões fixas,
#       plugin = o layout do zip do plugin, atalho com o pythonw do venv e o relancador.py
#   (c) relançador de verdade (python do venv) com um coletor falso: --ocioso-min inf, espera dobrando, um só relançador,
#       espera o coletor de trava viva sair antes de subir outro
#   (d) ensaio do coach contra o complemento instalado: <venv>\python.exe -I tools/ensaio-coach.py --publico <destino>
#       --porta 8833 --porta-sim 8834 (código só da pasta instalada e bibliotecas só do venv)
#   (e) reinstalar por cima: dados\ fica, .atualizacao\ e arquivo velho saem, venv reaproveitado, complemento "em execução"
#       (python com a pasta na linha de comando, pid na trava) fechado, pid de outro programa na trava intocado
#   (f) pip que falha (sem pacote): rc 1 e nada copiado; plugins\lol-client ao lado: plugin não copiado
#   (g) desinstalar.cmd da pasta instalada: fecha, apaga atalho, plugin e complemento; plugin de desenvolvimento (junção) fica
# Portas: só 8833 e 8834 (o ensaio). Nada toca a 8765, o Pengu de verdade nem o %LOCALAPPDATA%\lol-client real.
#   python tools/teste-instalar.py [--zip <complemento.zip>] [--sem-ensaio] [--manter]
import argparse
import base64
import hashlib
import importlib.metadata as md
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
RODAS = RAIZ / "temp" / "rodas-complemento"
PY311 = None   # achado por `py -0p`
falhas = []
n_ok = [0]


def caso(nome, cond, detalhe=""):
    print(("ok     " if cond else "FALHOU ") + nome + (f"  [{str(detalhe)[:400]}]" if detalhe and not cond else ""), flush=True)
    if cond:
        n_ok[0] += 1
    else:
        falhas.append(nome)


# ---------- pacotes .whl sem rede: remontados das bibliotecas instaladas nesta máquina ----------

def _b64(h):
    return base64.urlsafe_b64encode(h).rstrip(b"=").decode()


def roda(nome, destino):
    """.whl de uma distribuição instalada (arquivos do RECORD, dist-info com o WHEEL original); cache por versão"""
    d = md.distribution(nome)
    tags = [ln.split(":", 1)[1].strip() for ln in (d.read_text("WHEEL") or "").splitlines() if ln.startswith("Tag:")]
    norm = d.metadata["Name"].replace("-", "_")
    arq = destino / f"{norm}-{d.version}-{tags[0]}.whl"
    if arq.exists():
        return arq
    base = Path(d.locate_file(""))
    info = d._path.name
    tmp = arq.with_suffix(".tmp")
    record = []
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as z:
        for f in d.files or []:
            s = str(f).replace("\\", "/")
            if s.startswith("..") or "__pycache__/" in s or s.endswith(".pyc"):
                continue
            if s.startswith(info + "/") and s.split("/")[-1] in ("INSTALLER", "REQUESTED", "direct_url.json", "RECORD"):
                continue
            p = base / f
            if not p.is_file():
                continue
            b = p.read_bytes()
            z.writestr(s, b)
            record.append(f"{s},sha256={_b64(hashlib.sha256(b).digest())},{len(b)}")
        record.append(f"{info}/RECORD,,")
        z.writestr(f"{info}/RECORD", "\n".join(record) + "\n")
    tmp.replace(arq)
    return arq


def rodas():
    """as 6 do requirements-complemento.txt (numpy é dependência de scipy e opencv), nas versões instaladas = as fixas"""
    RODAS.mkdir(parents=True, exist_ok=True)
    fixas = {}
    for ln in (RAIZ / "requirements-complemento.txt").read_text(encoding="utf-8").splitlines():
        ln = ln.split("#", 1)[0].strip()
        if "==" in ln:
            n, v = ln.split("==")
            fixas[n.strip()] = v.strip()
    for n, v in fixas.items():
        caso(f"biblioteca instalada nesta máquina = versão fixa: {n} {v}", md.version(n) == v, md.version(n))
        roda(n, RODAS)
    return fixas


# ---------- utilidades ----------

REGISTRO = []


def pagina_do_console():
    import re
    m = re.search(rb"(\d{3,5})", subprocess.run("cmd /c chcp", capture_output=True).stdout)
    return m.group(1).decode() if m else None


def cmd(arquivo, env, cwd, timeout=900, pagina=None):
    """pagina: página de código do console antes do .cmd (65001 = UTF-8); a de antes volta no fim (o console é dividido)"""
    t0 = time.time()
    linha = f'cmd /c "chcp {pagina} >nul & "{arquivo}""' if pagina else ["cmd", "/c", str(arquivo)]
    antes = pagina_do_console() if pagina else None
    try:
        r = subprocess.run(linha, cwd=cwd, env=env, capture_output=True, timeout=timeout)
    finally:
        if antes:
            subprocess.run(f"cmd /c chcp {antes} >nul", capture_output=True)
    saida = (r.stdout + r.stderr).decode("utf-8" if pagina == "65001" else "cp850", "replace")
    REGISTRO.append(f"===== {arquivo} (cwd {cwd}, rc {r.returncode})\n{saida}\n")
    return r.returncode, saida, time.time() - t0


def arvore(p):
    p = Path(p)
    return {str(f.relative_to(p)).replace("\\", "/"): f.read_bytes() for f in p.rglob("*")
            if f.is_file() and "__pycache__" not in f.parts}


def junção(link, alvo):
    subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(alvo)], capture_output=True, check=True)


def vivo(pid):
    r = subprocess.run(["tasklist", "/FI", f"PID eq {pid}", "/NH"], capture_output=True, text=True, errors="replace")
    return str(pid) in r.stdout


def processo_falso(argumento, segundos=120):
    """python que só dorme, com `argumento` na linha de comando (a pasta do complemento ou não)"""
    return subprocess.Popen([sys.executable, "-c", f"import time; time.sleep({segundos})", str(argumento)],
                            creationflags=0x08000000)


def ler_atalho(lnk):
    # sem [Console]::OutputEncoding: ele muda a página de código do console que este processo divide com os .cmd seguintes
    # (foi assim que o defeito da página UTF-8 apareceu; ARMADILHAS § Windows)
    ps = ("$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LNK); "
          "Write-Output ($s.TargetPath + '|' + $s.Arguments + '|' + $s.WorkingDirectory)")
    r = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, encoding="cp850",
                       errors="replace", env={**os.environ, "LNK": str(lnk)})
    return r.stdout.strip().split("|")


def achar_py311():
    import re
    r = subprocess.run(["py", "-0p"], capture_output=True, text=True, errors="replace")
    for ln in r.stdout.splitlines():
        m = re.search(r"3\.11\S*\s+\*?\s*([A-Za-z]:\\.+?\.exe)\s*$", ln)
        if m and Path(m.group(1)).exists():
            return m.group(1)
    return None


# ---------- prova ----------

def principal():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", default=None, help="zip do complemento (padrão: o tools/publicar.py monta do HEAD)")
    ap.add_argument("--sem-ensaio", action="store_true")
    ap.add_argument("--manter", action="store_true", help="não apaga a pasta temporária")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    if "League of Legends.exe" in subprocess.run(["tasklist", "/FI", "IMAGENAME eq League of Legends.exe"],
                                                 capture_output=True, text=True, errors="replace").stdout:
        print("League of Legends.exe aberto: a prova fica para depois da partida")
        return 2
    tmp = Path(tempfile.mkdtemp(prefix="teste-instalar-")).resolve()
    print(f"pasta da prova: {tmp}")
    falsos = []
    try:
        return _prova(a, tmp, falsos)
    finally:
        for p in falsos:
            if p.poll() is None:
                p.kill()
        if a.manter:
            (tmp / "saidas.txt").write_text("".join(REGISTRO), encoding="utf-8")
            print(f"saídas dos .cmd em {tmp / 'saidas.txt'}")
        else:
            time.sleep(1)
            shutil.rmtree(tmp, ignore_errors=True)


def _prova(a, tmp, falsos):
    # pacote: o zip do complemento do HEAD (aprovado pela varredura)
    if a.zip:
        zc = Path(a.zip)
    else:
        spec = importlib.util.spec_from_file_location("publicar", RAIZ / "tools" / "publicar.py")
        P = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(P)
        rel = P.montar(RAIZ, "HEAD", tmp / "dist", RAIZ / "dados" / "lol.db")
        caso("publicar.py (ensaio do HEAD) aprova e monta os zips", not rel["achados"] and rel["zips"], rel["achados"])
        if not rel["zips"]:
            return 1
        zc = Path(rel["pasta"]) / next(n for n in rel["zips"] if "complemento" in n)
        zp = Path(rel["pasta"]) / next(n for n in rel["zips"] if "plugin" in n)
    baixado = tmp / "Meus Downloads!" / "pacote"
    with zipfile.ZipFile(zc) as z:
        z.extractall(baixado)
        do_zip = {n.split("/", 1)[1]: z.read(n) for n in z.namelist() if not n.endswith("/")}
    origem = baixado / "lol-ultra-client-complemento"
    plugin_esperado = None
    if not a.zip:
        with zipfile.ZipFile(zp) as z:
            plugin_esperado = {n.split("/", 1)[1]: z.read(n) for n in z.namelist() if not n.endswith("/")}
    caso("zip do complemento traz instalar.cmd, desinstalar.cmd, EDICAO e o relancador.py",
         all(n in do_zip for n in ("instalar.cmd", "desinstalar.cmd", "EDICAO", "coletor/relancador.py",
                                   "coletor/instalacao.py")), sorted(do_zip)[:8])

    t0 = time.time()
    fixas = rodas()
    print(f"      pacotes .whl sem rede em {RODAS} ({time.time() - t0:.0f} s)")

    local = tmp / "local"
    plugins = tmp / "Pengu Loader" / "plugins"
    ini = tmp / "inicializar"
    plugins.mkdir(parents=True)
    base_env = {**os.environ, "LOCALAPPDATA": str(local), "LUC_PLUGINS": str(plugins), "LUC_INICIALIZAR": str(ini),
                "LUC_PIP_RODAS": str(RODAS), "LUC_SEM_PAUSA": "1", "LUC_SEM_INICIAR": "1"}
    base_env.pop("LUC_PYTHON", None)
    destino = local / "lol-client" / "complemento" / "lol-ultra-client-complemento"
    venv = local / "lol-client" / "complemento" / "venv"
    instalar = origem / "instalar.cmd"

    # (a) recusas
    py311 = achar_py311()
    if py311:
        rc, out, _ = cmd(instalar, {**base_env, "LUC_PYTHON": py311}, origem)
        caso("(a) só Python 3.11: rc 2, diz a versão achada e onde baixar, nada criado",
             rc == 2 and "3.11" in out and "python.org/downloads" in out and not (local / "lol-client").exists(), out[-500:])
    else:
        caso("(a) Python 3.11 desta máquina (py -0p) para a recusa de versão velha", False, "não achado")
    rc, out, _ = cmd(instalar, {**base_env, "LUC_PYTHON": str(tmp / "nao-existe" / "python.exe")}, origem)
    caso("(a) Python que não existe: rc 2 e onde baixar", rc == 2 and "python.org/downloads" in out, out[-400:])
    for nome, preparar in (("junção", "j"), (".git", "g")):
        loc = tmp / f"local-{preparar}"
        dest = loc / "lol-client" / "complemento" / "lol-ultra-client-complemento"
        dest.parent.mkdir(parents=True)
        alvo = tmp / f"alvo-{preparar}"
        alvo.mkdir()
        (alvo / "meu.txt").write_text("não apagar", encoding="utf-8")
        if preparar == "j":
            junção(dest, alvo)
        else:
            dest.mkdir()
            (dest / ".git").mkdir()
            (dest / "meu.txt").write_text("não apagar", encoding="utf-8")
        rc, out, _ = cmd(instalar, {**base_env, "LOCALAPPDATA": str(loc)}, origem)
        intacto = (alvo / "meu.txt").exists() if preparar == "j" else (dest / "meu.txt").exists()
        caso(f"(a) destino com {nome} (instalação de desenvolvimento): rc 2, nada trocado, sem venv",
             rc == 2 and "desenvolvimento" in out and intacto and not (dest.parent / "venv").exists(), out[-400:])

    # (b) instalação limpa
    rc, out, dt = cmd(instalar, base_env, origem)
    print(f"      instalação limpa: rc {rc} em {dt:.0f} s")
    caso("(b) instalar.cmd limpo: rc 0 e 'Pronto'", rc == 0 and "Pronto." in out, out[-1500:])
    instalado = arvore(destino) if destino.exists() else {}
    caso("(b) complemento instalado = o zip byte a byte (com EDICAO: edição pública)",
         instalado == do_zip and instalado.get("EDICAO", b"").strip() == b"publica",
         sorted(set(instalado) ^ set(do_zip))[:8])
    vpy, vpyw = venv / "Scripts" / "python.exe", venv / "Scripts" / "pythonw.exe"
    versoes = {}
    if vpy.exists():
        r = subprocess.run([str(vpy), "-I", "-c", "import json, importlib.metadata as m; print(json.dumps({n: m.version(n) "
                            f"for n in {sorted(fixas)!r}}})); import numpy, scipy, cv2, mss, PIL, websockets"],
                           capture_output=True, text=True)
        versoes = json.loads(r.stdout.strip().splitlines()[-1]) if r.returncode == 0 else {"erro": r.stderr[-300:]}
    caso("(b) venv do complemento com as 6 bibliotecas nas versões fixas (import com -I)",
         vpyw.exists() and versoes == fixas, versoes)
    r = subprocess.run([str(vpy), "-c", "import sys; print(sys.version_info[:2] >= (3, 12))"], capture_output=True,
                       text=True) if vpy.exists() else None
    caso("(b) venv num Python 3.12 ou mais novo (py -3.14 nesta máquina)", r is not None and r.stdout.strip() == "True")
    plug = plugins / "lol-ultra-client"
    caso("(b) plugin em plugins\\lol-ultra-client = o zip do plugin byte a byte (pengu + LICENSE, TERCEIROS, LEIA-ME, "
         "atualizar.cmd)", plug.exists() and (plugin_esperado is None or arvore(plug) == plugin_esperado),
         sorted(set(arvore(plug) if plug.exists() else {}) ^ set(plugin_esperado or {}))[:8])
    lnk = ini / "lol-ultra-client.lnk"
    alvo_lnk = ler_atalho(lnk) if lnk.exists() else []
    caso("(b) atalho na Inicializar: pythonw do venv + relancador.py, pasta do complemento",
         len(alvo_lnk) == 3 and Path(alvo_lnk[0]) == vpyw and alvo_lnk[1] == f'"{destino / "coletor" / "relancador.py"}"'
         and Path(alvo_lnk[2]) == destino, alvo_lnk)
    caso("(b) nada sobe sozinho com LUC_SEM_INICIAR (nenhuma trava em dados\\)",
         not (destino / "dados" / "relancador.lock").exists() and not (destino / "dados" / "coletor.lock").exists())

    # (c) relançador de verdade com um coletor falso
    falso = tmp / "coletor-falso.py"
    anot = tmp / "subidas.txt"
    falso.write_text("import os, sys, time\n"
                     f"open(r'{anot}', 'a', encoding='utf-8').write(' '.join(sys.argv[1:]) + '\\n')\n"
                     "time.sleep(float(os.environ.get('FALSO_S', '0.1')))\n", encoding="utf-8")
    rel = destino / "coletor" / "relancador.py"
    t0 = time.time()
    r = subprocess.run([str(vpy), str(rel), "--coletor", str(falso), "--voltas", "3", "--espera-min", "0.3"],
                       cwd=destino, capture_output=True, text=True, timeout=60)
    dt = time.time() - t0
    subidas = anot.read_text(encoding="utf-8").splitlines() if anot.exists() else []
    logr = (destino / "dados" / "relancador.log").read_text(encoding="utf-8") if (destino / "dados" / "relancador.log").exists() else ""
    caso("(c) relançador: 3 subidas com --ocioso-min inf, espera dobrando (0,3 e 0,6 s), trava solta no fim",
         r.returncode == 0 and subidas == ["--ocioso-min inf"] * 3 and "de novo em 0.3 s" in logr
         and "de novo em 0.6 s" in logr and 0.8 < dt < 20 and not (destino / "dados" / "relancador.lock").exists(),
         f"rc {r.returncode} {subidas} {dt:.1f}s {logr[-300:]}")
    anot.unlink(missing_ok=True)
    env_lento = {**os.environ, "FALSO_S": "4"}
    p1 = subprocess.Popen([str(vpy), str(rel), "--coletor", str(falso), "--voltas", "1"], cwd=destino, env=env_lento)
    falsos.append(p1)
    time.sleep(2)
    r2 = subprocess.run([str(vpy), str(rel), "--coletor", str(falso), "--voltas", "1"], cwd=destino, capture_output=True,
                        timeout=30, env=env_lento)
    p1.wait(30)
    logr = (destino / "dados" / "relancador.log").read_text(encoding="utf-8")
    n_sub = anot.read_text(encoding="utf-8").count("--ocioso-min inf") if anot.exists() else 0
    caso("(c) 2º relançador com o 1º de pé: sai na hora sem subir coletor",
         r2.returncode == 0 and "outro relançador em execução" in logr and n_sub == 1,
         f"rc {r2.returncode} subidas {n_sub} {r2.stdout[-200:]!r} {r2.stderr[-400:]!r} | {logr[-600:]}")
    anot.unlink(missing_ok=True)
    dono = processo_falso("coletor-de-pe", 4)
    falsos.append(dono)
    (destino / "dados" / "coletor.lock").write_text(str(dono.pid), encoding="utf-8")
    t0 = time.time()
    r = subprocess.run([str(vpy), str(rel), "--coletor", str(falso), "--voltas", "1"], cwd=destino, capture_output=True,
                       timeout=60)
    dt = time.time() - t0
    logr = (destino / "dados" / "relancador.log").read_text(encoding="utf-8")
    caso("(c) coletor de trava viva (o sucessor da atualização): espera ele sair e só então sobe 1",
         r.returncode == 0 and dt >= 2.5 and "esperando ele sair" in logr
         and anot.read_text(encoding="utf-8").count("--ocioso-min inf") == 1, f"{dt:.1f}s {logr[-300:]}")
    (destino / "dados" / "coletor.lock").unlink(missing_ok=True)

    # (d) ensaio do coach contra o complemento instalado
    if not a.sem_ensaio:
        t0 = time.time()
        r = subprocess.run([str(vpy), "-I", str(RAIZ / "tools" / "ensaio-coach.py"), "--publico", str(destino),
                            "--porta", "8833", "--porta-sim", "8834", "--sem-prints", "--seg-1x", "5", "--velocidade", "20"],
                           cwd=tmp, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900,
                           env={**os.environ, "PYTHONIOENCODING": "utf-8"})
        linhas = [ln for ln in r.stdout.splitlines() if ln.startswith(("ok ", "FALHOU"))]
        for ln in linhas:
            print("      " + ln[:170])
        ruins = [ln for ln in linhas if ln.startswith("FALHOU")]
        caso(f"(d) ensaio-coach --publico com o python do venv e -I: rc 0, {len(linhas) - len(ruins)}/{len(linhas)} "
             f"conferências ({time.time() - t0:.0f} s)", r.returncode == 0 and not ruins and len(linhas) >= 20,
             (ruins or r.stdout[-800:] + r.stderr[-800:]))

    # (e) reinstalar por cima
    dados = destino / "dados"
    dados.mkdir(exist_ok=True)
    (dados / "lol.db").write_bytes(b"banco de quem instalou")
    (dados / "config.json").write_text('{"voz": false}', encoding="utf-8")
    (destino / ".atualizacao").mkdir(exist_ok=True)
    (destino / ".atualizacao" / "troca-em-curso").write_text("0.2.0", encoding="utf-8")
    (destino / "velho.txt").write_text("sobra de uma versão antiga", encoding="utf-8")
    (plug / ".atualizacao").mkdir(exist_ok=True)
    rodando = processo_falso(destino / "coletor" / "coletor.py")
    outro = processo_falso("outro-programa")
    falsos += [rodando, outro]
    (dados / "coletor.lock").write_text(str(rodando.pid), encoding="utf-8")
    (dados / "relancador.lock").write_text(str(outro.pid), encoding="utf-8")
    time.sleep(0.5)
    mtime_venv = vpy.stat().st_mtime
    # com o console na página de código UTF-8 (chcp 65001): antes da 1ª linha fazer tudo, o cmd executava pedaços do
    # PowerShell como lote aqui (rc 255)
    rc, out, dt = cmd(instalar, base_env, origem, pagina="65001")
    caso("(e) reinstalar (console na página UTF-8): rc 0, venv reaproveitado, complemento em execução fechado", rc == 0
         and "reaproveitado" in out and "fechado" in out and vpy.stat().st_mtime == mtime_venv, out[-800:])
    time.sleep(1)
    caso("(e) o python com a pasta do complemento na linha de comando foi fechado; o de outro programa na trava, não",
         not vivo(rodando.pid) and vivo(outro.pid), f"rodando {vivo(rodando.pid)} outro {vivo(outro.pid)}")
    outro.kill()
    agora = arvore(destino)
    caso("(e) dados\\ intacto, .atualizacao\\ e arquivo velho fora, o resto = o zip",
         (dados / "lol.db").read_bytes() == b"banco de quem instalou" and not (destino / ".atualizacao").exists()
         and not (destino / "velho.txt").exists()
         and {k: v for k, v in agora.items() if not k.startswith("dados/")} == do_zip
         and not (plug / ".atualizacao").exists(), sorted(set(agora) ^ set(do_zip))[:6])

    # (f) pip que falha e plugins\lol-client ao lado
    vazio = tmp / "sem-pacotes"
    vazio.mkdir()
    loc2 = tmp / "local-pip"
    rc, out, _ = cmd(instalar, {**base_env, "LOCALAPPDATA": str(loc2), "LUC_PIP_RODAS": str(vazio)}, origem)
    caso("(f) pip sem os pacotes: rc 1, diz que as bibliotecas não instalaram, complemento não copiado",
         rc == 1 and "bibliotecas" in out and not (loc2 / "lol-client" / "complemento" / "lol-ultra-client-complemento").exists(),
         out[-500:])
    plugins2 = tmp / "plugins-com-lol-client"
    (plugins2 / "lol-client").mkdir(parents=True)
    rc, out, _ = cmd(instalar, {**base_env, "LUC_PLUGINS": str(plugins2)}, origem)
    caso("(f) plugins\\lol-client ao lado: rc 0, plugin não copiado (carregaria duas vezes) e o aviso diz por quê",
         rc == 0 and not (plugins2 / "lol-ultra-client").exists() and "plugins\\lol-client" in out, out[-500:])

    # (g) desinstalar da pasta instalada
    rodando = processo_falso(destino / "coletor" / "relancador.py")
    falsos.append(rodando)
    (dados / "relancador.lock").write_text(str(rodando.pid), encoding="utf-8")
    time.sleep(0.5)
    rc, out, _ = cmd(destino / "desinstalar.cmd", base_env, destino)
    fim = time.time() + 15   # o último arquivo (o próprio desinstalar.cmd) sai por um cmd solto, 2 s depois
    while (local / "lol-client").exists() and time.time() < fim:
        time.sleep(0.5)
    caso("(g) desinstalar.cmd (de dentro da pasta que ele apaga): rc 0 sem erro do cmd, fecha o complemento, apaga atalho, "
         "plugin e complemento, e a pasta lol-client vazia some",
         rc == 0 and "caminho especificado" not in out and not vivo(rodando.pid) and not lnk.exists()
         and not plug.exists() and not (local / "lol-client").exists() and "desinstalado" in out, out[-800:])
    alvo = tmp / "plugin-dev"
    alvo.mkdir()
    (alvo / "index.js").write_text("// código de trabalho", encoding="utf-8")
    junção(plug, alvo)
    rc, out, _ = cmd(instalar, base_env, origem)
    caso("(g) instalar com o plugin de desenvolvimento (junção): plugin não copiado, código intacto",
         rc == 0 and (alvo / "index.js").read_text(encoding="utf-8") == "// código de trabalho"
         and "desenvolvimento" in out, out[-400:])
    rc, out, _ = cmd(destino / "desinstalar.cmd", base_env, destino)
    fim = time.time() + 15
    while destino.exists() and time.time() < fim:
        time.sleep(0.5)
    caso("(g) desinstalar com o plugin de desenvolvimento: plugin mantido, código intacto, complemento apagado",
         rc == 0 and (alvo / "index.js").exists() and plug.exists() and not destino.exists(), out[-400:])

    print(f"{'ok' if not falhas else 'FALHOU'}: {n_ok[0]}/{n_ok[0] + len(falhas)}" + (f"; falhas: {falhas}" if falhas else ""))
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(principal())
