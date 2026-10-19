# Monta a foto pública do lol-ultra-client a partir de um commit deste repositório, varre e gera os zips do release (P1 do
# roadmap/2026-10-19-publicacao-e-complemento-publico.md). Lista de INCLUSÃO, nunca de exclusão: só entra o que está abaixo.
#   python -I tools/publicar.py                 ensaio (padrão): monta, varre, mostra o que entraria; zips só se passar
#   python -I tools/publicar.py --publicar      commit da foto em dist/publico/, tag vX.Y.Z, push e gh release create;
#                                               rc 3 se o release cair depois do push: rodar de novo retoma só o release
#                                               (tag no remote com a mesma foto e sem release)
# O --publicar só roda depois do portão do P6 (conta confirmada, provas no client real, ensaio sem reprovação), com o gh na
# conta dona do REPO (gh auth switch antes e de volta depois, regra de contas do C:\Dev). Nada daqui troca a conta do gh.
#
# O que sai (dist/v<versao>/, dist/ ignorado pelo git):
#   foto/                                    a árvore do repositório público (mesmos caminhos do privado; publico/X na raiz)
#   lol-ultra-client-plugin-<v>.zip          pasta lol-ultra-client/ = pengu/ + LICENSE, TERCEIROS.md, LEIA-ME.md, atualizar.cmd
#   lol-ultra-client-complemento-<v>.zip     pasta lol-ultra-client-complemento/ com os caminhos do repo (o código lê RAIZ/...):
#                                            a lista do complemento + o plugin inteiro em pengu/ (o instalar.cmd o copia), +
#                                            instalar.cmd, desinstalar.cmd e EDICAO (edição pública) na raiz (P4)
#   SHA256SUMS.txt                           formato do sha256sum ("<hash>  <arquivo>")
# Conteúdo = blob do commit (--ref, padrão HEAD), nunca a pasta de trabalho: arquivo mexido e não commitado sai como está no
# commit (o ensaio avisa; o --publicar recusa). Zip reprodutível: mesma ordem, data do commit, sem atributo da máquina.
# O pacote de voz (voz-aoede-*.zip) é do P5. Arquivo da lista que falta no commit reprova ("falta (<fase>)").
import argparse
import hashlib
import importlib.util
import os
import re
import shutil
import stat
import subprocess
import sys
import time
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
_s = importlib.util.spec_from_file_location("varrer_publico", RAIZ / "tools" / "varrer-publico.py")
V = importlib.util.module_from_spec(_s)
_s.loader.exec_module(V)

NOME = "lol-ultra-client"
PASTA_PLUGIN = "lol-ultra-client"                 # pasta em plugins\ do Pengu na instalação nova (decisão 6 do plano)
PASTA_COMPLEMENTO = "lol-ultra-client-complemento"
PRIVADO = "dosxnjos/lol-client"                   # nunca é destino do --publicar
# autor dos commits e da tag do repositório público: nunca o user.name/user.email desta máquina (e-mail pessoal)
AUTOR = ("dosxnjos", "dosxnjos@users.noreply.github.com")
DEV_PLUGIN = frozenset()                          # arquivos de pengu/ que não vão (desenvolvimento): hoje nenhum
# só do público: origem no privado -> (destino na foto, nome no zip)
COMUNS = {"LICENSE": ("LICENSE", "LICENSE"), "TERCEIROS.md": ("TERCEIROS.md", "TERCEIROS.md"),
          "publico/LEIA-ME.md": ("README.md", "LEIA-ME.md")}   # README.md na foto: é o que o GitHub mostra
PENDENTES = {"publico/atualizar.cmd": "P3.3", "publico/instalar.cmd": "P4.3",
             "publico/desinstalar.cmd": "P4.3", "publico/EDICAO": "P4"}   # o "falta" diz a fase que cria
TIPOS = {".js", ".mjs", ".css", ".html", ".md", ".py", ".txt", ".cmd", ".json", ""}
SAIDA = RAIZ / "dist"


def git(raiz, *args, entrada=None, texto=True, ok=True):
    r = subprocess.run(["git", "-c", "core.autocrlf=false", "-c", "core.safecrlf=false", *args], cwd=raiz,
                       input=entrada, capture_output=True, text=texto, encoding="utf-8" if texto else None)
    if ok and r.returncode:
        raise RuntimeError(f"git {' '.join(args[:3])}: {(r.stderr or '').strip()[:300]}")
    return r


def arvore(raiz, ref):
    """{caminho: (modo, sha)} de todo o commit"""
    saida = {}
    for linha in git(raiz, "ls-tree", "-r", "-z", ref).stdout.split("\0"):
        if linha:
            cab, caminho = linha.split("\t", 1)
            modo, _tipo, sha = cab.split()
            saida[caminho] = (modo, sha)
    return saida


def blobs(raiz, shas):
    """{sha: bytes} pelo git cat-file --batch (blob cru, sem conversão de fim de linha)"""
    shas = sorted(set(shas))
    if not shas:
        return {}
    out = git(raiz, "cat-file", "--batch", entrada="".join(s + "\n" for s in shas).encode(), texto=False).stdout
    res, i = {}, 0
    for s in shas:
        fim = out.index(b"\n", i)
        n = int(out[i:fim].split()[2])
        res[s] = out[fim + 1:fim + 1 + n]
        i = fim + 2 + n
    return res


def itens(arv):
    """[(origem, destino na foto, {pacote: nome no zip})] da lista de inclusão; caminhos que faltam no commit vão também"""
    lista = []
    plugin = sorted(c for c in arv if c.startswith("pengu/") and c not in DEV_PLUGIN)
    for c in plugin:
        # o complemento leva o plugin inteiro em pengu/ (caminho do repo): o instalar.cmd (P4.3) copia pengu\ para
        # plugins\lol-ultra-client, e quem baixa só o complemento não fica sem plugin (revisão do P1, 19/10/2026)
        lista.append((c, c, {"plugin": f"{PASTA_PLUGIN}/{c[len('pengu/'):]}", "complemento": f"{PASTA_COMPLEMENTO}/{c}"}))
    por_origem = {o: z for o, _, z in lista}
    for c in V.COMPLEMENTO:
        z = f"{PASTA_COMPLEMENTO}/{c}"
        if c in por_origem:
            por_origem[c]["complemento"] = z      # pengu/posjogo/licoes.md: dos dois pacotes
        else:
            lista.append((c, c, {"complemento": z}))
    for origem, (foto, nome) in COMUNS.items():
        lista.append((origem, foto, {"plugin": f"{PASTA_PLUGIN}/{nome}", "complemento": f"{PASTA_COMPLEMENTO}/{nome}"}))
    lista.append(("publico/atualizar.cmd", "atualizar.cmd", {"plugin": f"{PASTA_PLUGIN}/atualizar.cmd",
                                                            "complemento": f"{PASTA_COMPLEMENTO}/atualizar.cmd"}))
    lista.append(("publico/instalar.cmd", "instalar.cmd", {"complemento": f"{PASTA_COMPLEMENTO}/instalar.cmd"}))
    lista.append(("publico/desinstalar.cmd", "desinstalar.cmd", {"complemento": f"{PASTA_COMPLEMENTO}/desinstalar.cmd"}))
    # EDICAO na raiz = edição pública (coletor/instalacao.py): sem mentor, Riot API, draft, resumos, expansões nem medidor de
    # travadas. Na pasta de trabalho do mantenedor ele mora em publico/ e a instalação dele segue completa (P4)
    lista.append(("publico/EDICAO", "EDICAO", {"complemento": f"{PASTA_COMPLEMENTO}/EDICAO"}))
    return lista


def versao_de(conteudo):
    """(VERSAO, REPO) de pengu/versao.js; None no que não achar"""
    t = conteudo.decode("utf-8", "replace") if conteudo else ""
    v = re.search(r"\bVERSAO\s*=\s*'(\d+\.\d+\.\d+)'", t)
    r = re.search(r"\bREPO\s*=\s*'([\w.-]+/[\w.-]+)'", t)
    return (v.group(1) if v else None), (r.group(1) if r else None)


# especificador relativo em literal de string de JS ('./x.js', '../y.js', './licoes.md?raw'), fora de comentário: pega o
# import estático, o import() e o mapa TELAS de compacto/index.js (import(TELAS[nome]))
_REL = re.compile(r"""(['"`])(\.\.?/[^'"`\s?]+)(?:\?[a-z]+)?\1""")


def imports_quebrados(arquivos):
    """[(arquivo, especificador)] que não resolvem dentro do conjunto {caminho com /: bytes} (só .js/.mjs)"""
    nomes = set(arquivos)
    quebrados = []
    for nome, dados in arquivos.items():
        if not nome.endswith((".js", ".mjs")):
            continue
        texto = V._JS.sub(" ", dados.decode("utf-8", "replace"))
        base = nome.rsplit("/", 1)[0] if "/" in nome else ""
        for m in _REL.finditer(texto):
            partes = [p for p in base.split("/") if p]
            for p in m.group(2).split("/"):
                if p == "..":
                    if partes:
                        partes.pop()
                    else:
                        partes = None
                        break
                elif p != ".":
                    partes.append(p)
            if partes is None or "/".join(partes) not in nomes:
                quebrados.append((nome, m.group(2)))
    return quebrados


def _zip(caminho, entradas, data):
    """zip reprodutível: entradas ordenadas, data fixa (a do commit), atributo de arquivo comum"""
    with zipfile.ZipFile(caminho, "w", zipfile.ZIP_DEFLATED) as z:
        for nome in sorted(entradas):
            zi = zipfile.ZipInfo(nome, date_time=data)
            zi.create_system = 3
            zi.external_attr = 0o100644 << 16
            zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, entradas[nome], compresslevel=9)


def sha256(caminho):
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def _apagar(p):
    def soltar(func, alvo, _exc):
        os.chmod(alvo, stat.S_IWRITE)
        func(alvo)
    if Path(p).exists():
        if sys.version_info >= (3, 12):
            shutil.rmtree(p, onexc=soltar)
        else:
            shutil.rmtree(p, onerror=soltar)


def montar(raiz=RAIZ, ref="HEAD", saida=SAIDA, banco=None, notas=None):
    """monta a foto, varre e (só se passou) gera zips e SHA256SUMS. Devolve o relatório (dict). `notas`: arquivo com o
    texto do release, varrido como os arquivos da foto (vai a público no release; o P2 mostra no client)."""
    raiz, saida = Path(raiz), Path(saida)
    commit = git(raiz, "rev-parse", "--verify", f"{ref}^{{commit}}").stdout.strip()
    quando = int(git(raiz, "show", "-s", "--format=%ct", commit).stdout.strip())
    data = max(time.gmtime(quando)[:6], (1980, 1, 1, 0, 0, 0))
    arv = arvore(raiz, commit)
    lista = itens(arv)
    achados = {}                                   # {destino: [(categoria, linha)]}

    def achar(destino, cat, linha=0):
        achados.setdefault(destino, []).append((cat, linha))

    presentes = []
    for origem, destino, zips in lista:
        if origem not in arv:
            achar(destino, f"falta ({PENDENTES[origem]})" if origem in PENDENTES else "falta")
        elif arv[origem][0] not in ("100644", "100755"):
            achar(destino, "tipo")                 # link simbólico (120000) ou submódulo nunca entram
        elif Path(origem).suffix.lower() not in TIPOS:
            achar(destino, "tipo")
        else:
            presentes.append((origem, destino, zips))
    conteudo = blobs(raiz, [arv[o][1] for o, _, _ in presentes])
    dados = {destino: conteudo[arv[origem][1]] for origem, destino, _ in presentes}

    versao, repo = versao_de(conteudo.get(arv.get("pengu/versao.js", ("", ""))[1]))
    if not versao or not repo:
        achar("pengu/versao.js", "versao")
    versao = versao or "0.0.0"
    pasta = saida / f"v{versao}"
    _apagar(pasta)
    foto = pasta / "foto"
    for destino, b in dados.items():
        (foto / destino).parent.mkdir(parents=True, exist_ok=True)
        (foto / destino).write_bytes(b)

    texto_ok = []
    for destino, b in dados.items():
        try:
            b.decode("utf-8")
            texto_ok.append(destino)
        except UnicodeDecodeError:
            achar(destino, "tipo")
    for destino, ach in V.varrer(foto, texto_ok, banco).items():   # conteúdo e caminho na foto
        for cat, n in ach:
            achar(destino, cat, n)
    ids, textos = V.do_banco(banco)
    for origem, destino, zips in presentes:                          # caminho dentro de cada zip
        for nome in zips.values():
            for cat, n in V.varrer_nome(nome, ids, textos):
                achar(destino, cat, n)
    texto_notas = None
    if notas:
        texto_notas = Path(notas).read_text(encoding="utf-8")
        for cat, n in V.varrer_texto("NOTAS.md", texto_notas, ids, textos):
            achar("NOTAS.md (release)", cat, n)

    pacotes = {"plugin": {}, "complemento": {}}
    for origem, destino, zips in presentes:
        for pacote, nome in zips.items():
            pacotes[pacote][nome] = dados[destino]
    for arq, esp in imports_quebrados(pacotes["plugin"]):
        achar(arq, f"import {esp}")
    pre = f"{PASTA_COMPLEMENTO}/"                                   # o plugin dentro do complemento, em pengu/
    for arq, esp in imports_quebrados({n[len(pre):]: b for n, b in pacotes["complemento"].items()
                                       if n.startswith(pre + "pengu/")}):
        achar(arq, f"import {esp}")
    for destino in achados:                                         # o mesmo achado pelo zip e pela foto conta 1 vez
        achados[destino] = sorted(set(achados[destino]), key=lambda a: (a[1], a[0]))

    # pasta de trabalho diferente do commit: o ensaio avisa (vale o commit), o --publicar recusa
    origens = [o for o, _, _ in lista]
    st = git(raiz, "status", "--porcelain=v1", "-z", "--untracked-files=no", "--", *origens).stdout
    difere = sorted({e[3:] for e in st.split("\0") if len(e) > 3})
    fora = sorted(l for l in git(raiz, "ls-files", "--others", "--exclude-standard", "--", "pengu/", "publico/")
                  .stdout.splitlines() if l)

    rel = {"commit": commit, "versao": versao, "repo": repo, "pasta": pasta, "foto": sorted(dados),
           "pacotes": {p: sorted(z) for p, z in pacotes.items()}, "achados": achados, "difere": difere,
           "fora": fora, "zips": {}, "notas": texto_notas}
    if not achados:
        nomes = {"plugin": f"{NOME}-plugin-{versao}.zip", "complemento": f"{NOME}-complemento-{versao}.zip"}
        for p, nome in nomes.items():
            _zip(pasta / nome, pacotes[p], data)
            rel["zips"][nome] = sha256(pasta / nome)
        (pasta / "SHA256SUMS.txt").write_text("".join(f"{h}  {n}\n" for n, h in sorted(rel["zips"].items())),
                                              encoding="utf-8", newline="\n")
    return rel


def imprimir(rel, todos=True):
    print(f"{NOME} v{rel['versao']} ({rel['repo']}), commit {rel['commit'][:10]}")
    for p, nomes in rel["pacotes"].items():
        print(f"\n{p}: {len(nomes)} arquivos")
        if todos:
            for n in nomes:
                print(f"  {n}")
    print(f"\nfoto do repositório público: {len(rel['foto'])} arquivos")
    if rel["difere"]:
        print(f"\naviso: {len(rel['difere'])} arquivo(s) da lista mexidos e não commitados (entra o do commit): "
              + ", ".join(rel["difere"]))
    if rel["fora"]:
        print(f"aviso: fora do git, não entram: {', '.join(rel['fora'])}")
    n = sum(len(v) for v in rel["achados"].values())
    if n:
        print()
        for destino in sorted(rel["achados"]):
            for cat, linha in sorted(rel["achados"][destino], key=lambda a: (a[1], a[0])):
                print(f"REPROVA {cat:13} {destino}" + (f":{linha}" if linha else ""))
        cont = {}
        for v in rel["achados"].values():
            for cat, _ in v:
                cont[cat.split(" ")[0]] = cont.get(cat.split(" ")[0], 0) + 1
        print(f"\nREPROVADO: {n} achado(s) em {len(rel['achados'])} arquivo(s) {cont}; nenhum zip gerado")
    else:
        print()
        for nome, h in sorted(rel["zips"].items()):
            print(f"{h}  {nome}")
        print(f"\nAPROVADO: zips e SHA256SUMS.txt em {rel['pasta']}")


# ---------- --publicar ----------

def _github(remote):
    """'dono/nome' de uma URL do GitHub (ssh ou https); None se não for GitHub"""
    m = re.search(r"github\.com[:/]+([\w.-]+)/([\w.-]+?)(?:\.git)?/?$", remote.strip(), re.I)
    return f"{m.group(1)}/{m.group(2)}".lower() if m else None


def gh_real(args):
    r = subprocess.run(["gh", *args], capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        raise RuntimeError(f"gh {' '.join(args[:2])}: {r.stderr.strip()[:300]}")
    return r.stdout


class Recusa(Exception):
    pass


def conferir_destino(rel, remote, raiz, rodar_gh):
    """recusa antes de qualquer rede: privado, remote que não é o REPO, local sem gh falso, conta errada no gh"""
    repo = (rel["repo"] or "").lower()
    if repo == PRIVADO or _github(remote) == PRIVADO:
        raise Recusa(f"destino é o repositório privado ({PRIVADO})")
    try:
        origem = git(raiz, "remote", "get-url", "origin").stdout.strip()
    except RuntimeError:
        origem = ""
    if origem and remote.strip().rstrip("/").lower() == origem.rstrip("/").lower():
        raise Recusa("destino é o origin deste repositório")
    gh = _github(remote)
    if gh is None:
        if rodar_gh is None:
            raise Recusa("remote fora do GitHub só com o gh falso do teste (senão o release iria ao GitHub de verdade)")
        return rodar_gh
    if gh != repo:
        raise Recusa(f"remote aponta {gh}, mas pengu/versao.js diz {repo}")
    rodar_gh = rodar_gh or gh_real
    conta = rodar_gh(["api", "user", "--jq", ".login"]).strip().lower()
    if conta != repo.split("/")[0]:
        raise Recusa(f"gh logado em {conta or '?'}; a conta dona é {repo.split('/')[0]} (gh auth switch antes)")
    return rodar_gh


def _release_existe(rodar_gh, tag, repo):
    """True/False pelo gh release view; só o "not found" conta como ausente (rede ou login caído sobe o erro)"""
    try:
        rodar_gh(["release", "view", tag, "--repo", repo, "--json", "tagName"])
        return True
    except RuntimeError as e:
        if "not found" in str(e).lower():
            return False
        raise


def publicar(rel, remote, raiz=RAIZ, rodar_gh=None):
    """commit da foto num clone do remote (dist/publico), tag, push e release. Devolve (sha do commit público, retomou).
    Retomada: a tag já está no remote com a MESMA foto e sem release (o push saiu e o gh release create caiu) → só o
    release é criado, sem commit, tag nem push novos (os zips são reprodutíveis: mesmo commit, mesmos hashes)."""
    if rel["achados"]:
        raise Recusa("a foto reprovou na varredura")
    if rel["difere"]:
        raise Recusa("arquivos da lista mexidos e não commitados: " + ", ".join(rel["difere"]))
    rodar_gh = conferir_destino(rel, remote, raiz, rodar_gh)
    tag = f"v{rel['versao']}"
    tag_remota = bool(git(raiz, "ls-remote", "--tags", remote, f"refs/tags/{tag}").stdout.strip())
    clone = Path(rel["pasta"]).parent / "publico"
    _apagar(clone)
    git(raiz, "clone", "-q", remote, str(clone))
    tem_head = git(clone, "rev-parse", "-q", "--verify", "HEAD", ok=False).returncode == 0
    if not tem_head:
        git(clone, "symbolic-ref", "HEAD", "refs/heads/main")
    elif git(clone, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip() != "main":
        raise Recusa("o remote não está na main")
    git(clone, "rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", ".")
    for item in clone.iterdir():
        if item.name != ".git":
            _apagar(item) if item.is_dir() else item.unlink()
    foto = Path(rel["pasta"]) / "foto"
    for destino in rel["foto"]:
        (clone / destino).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(foto / destino, clone / destino)
    git(clone, "add", "--pathspec-from-file=-", "--pathspec-file-nul", entrada="\0".join(rel["foto"]))
    retomar = False
    if tag_remota:
        git(clone, "fetch", "-q", "origin", f"+refs/tags/{tag}:refs/tags/{tag}")
        if git(clone, "write-tree").stdout.strip() != git(clone, "rev-parse", f"refs/tags/{tag}^{{tree}}").stdout.strip():
            raise Recusa(f"{tag} já existe no remote com outra foto: suba VERSAO em pengu/versao.js")
        if _release_existe(rodar_gh, tag, rel["repo"]):
            raise Recusa(f"{tag} já publicado (tag e release no remote): suba VERSAO em pengu/versao.js")
        retomar = True                             # push feito numa rodada que caiu antes do release: só o release
    elif tem_head and git(clone, "diff", "--cached", "--quiet", ok=False).returncode == 0:
        raise Recusa("foto igual à última versão publicada")
    if retomar:
        sha = git(clone, "rev-parse", f"refs/tags/{tag}^{{commit}}").stdout.strip()
    else:
        env = {**os.environ, "GIT_AUTHOR_NAME": AUTOR[0], "GIT_AUTHOR_EMAIL": AUTOR[1],
               "GIT_COMMITTER_NAME": AUTOR[0], "GIT_COMMITTER_EMAIL": AUTOR[1]}
        sem_hooks = Path(rel["pasta"]) / "sem-hooks"   # pasta vazia: nenhum hook da máquina roda no commit público
        sem_hooks.mkdir(exist_ok=True)
        base = ["git", "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false",
                "-c", f"core.hooksPath={sem_hooks.as_posix()}"]
        for args in (["commit", "-q", "-m", f"{NOME} {tag}"], ["tag", "-a", tag, "-m", f"{NOME} {tag}"]):
            r = subprocess.run(base + args, cwd=clone, env=env, capture_output=True, text=True, encoding="utf-8")
            if r.returncode:
                raise RuntimeError(f"git {args[0]}: {r.stderr.strip()[:300]}")
        sha = git(clone, "rev-parse", "HEAD").stdout.strip()
        git(clone, "push", "-q", "--atomic", "origin", "main", f"refs/tags/{tag}")
    arq_notas = Path(rel["pasta"]) / "NOTAS.md"        # o texto que a varredura viu no montar(), nunca relido
    arq_notas.write_text(rel.get("notas") or f"{NOME} {tag}. Instalação e conferência do hash: README.\n",
                         encoding="utf-8")
    assets = [str(Path(rel["pasta"]) / n) for n in sorted(rel["zips"])] + [str(Path(rel["pasta"]) / "SHA256SUMS.txt")]
    try:
        rodar_gh(["release", "create", tag, "--repo", rel["repo"], "--title", tag, "--notes-file", str(arq_notas),
                  "--verify-tag", *assets])
    except RuntimeError as e:
        raise RuntimeError(f"{tag} está no remote, mas o gh release create falhou ({e}). Rode o mesmo comando de novo: "
                           "o publicar.py acha a tag com a mesma foto e cria só o release") from e
    return sha, retomar


def main(argv=None, rodar_gh=None):
    ap = argparse.ArgumentParser(description="foto pública do lol-ultra-client: ensaio (padrão) ou --publicar")
    ap.add_argument("--raiz", default=str(RAIZ), help="repositório de trabalho (teste: árvore falsa)")
    ap.add_argument("--ref", default="HEAD", help="commit de onde sai a foto")
    ap.add_argument("--saida", default=str(SAIDA), help="pasta dos zips (padrão dist/)")
    ap.add_argument("--banco", default=str(RAIZ / "dados" / "lol.db"), help="banco lido só para os game_ids (mode=ro)")
    ap.add_argument("--sem-banco", action="store_true")
    ap.add_argument("--resumo", action="store_true", help="sem a lista arquivo a arquivo")
    ap.add_argument("--publicar", action="store_true", help="commit, tag, push e release (só depois do portão do P6)")
    ap.add_argument("--remote", help="destino do --publicar (padrão git@github.com:<REPO>.git)")
    ap.add_argument("--notas", help="arquivo com o texto do release (varrido como a foto)")
    a = ap.parse_args(argv)
    rel = montar(a.raiz, a.ref, a.saida, None if a.sem_banco else a.banco, a.notas)
    imprimir(rel, not a.resumo)
    if not a.publicar:
        return 1 if rel["achados"] else 0
    remote = a.remote or f"git@github.com:{rel['repo']}.git"
    try:
        sha, retomou = publicar(rel, remote, Path(a.raiz), rodar_gh)
    except Recusa as e:
        print(f"\nRECUSADO: {e}")
        return 2
    except RuntimeError as e:                      # git ou gh caiu no meio: a mensagem diz o que já saiu e como seguir
        print(f"\nFALHOU: {e}")
        return 3
    print(f"\n{'retomado (só o release)' if retomou else 'publicado'}: v{rel['versao']} em {remote} "
          f"(commit {sha[:10]}), release com {len(rel['zips'])} zips")
    return 0


if __name__ == "__main__":
    sys.exit(main())
