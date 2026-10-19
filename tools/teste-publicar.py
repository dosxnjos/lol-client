# prova do tools/publicar.py (P1 do roadmap/2026-10-19-publicacao-e-complemento-publico.md). Tudo numa pasta temporária:
# repositório falso com a lista de inclusão inteira, remote falso (repositório bare local) e gh falso (só anota os
# argumentos). Nada vai à rede, ao GitHub nem ao origin deste repositório. No fim, o ensaio do repositório real (só leitura,
# zips na pasta temporária): aprovado, sem achado nenhum (desde a P4: gameIds fora dos comentários, os .cmd e o EDICAO no
# commit).
#   python -I tools/teste-publicar.py
import importlib.util
import io
import os
import subprocess
import sys
import tempfile
import zipfile
from contextlib import redirect_stdout
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
_s = importlib.util.spec_from_file_location("publicar", RAIZ / "tools" / "publicar.py")
P = importlib.util.module_from_spec(_s)
_s.loader.exec_module(P)
V = P.V
falhas = []


def caso(nome, cond, detalhe=""):
    print(("ok   " if cond else "FALHA") + f" {nome}" + (f": {detalhe}" if detalhe and not cond else ""))
    if not cond:
        falhas.append(nome)


def sh(cwd, *args, ok=True):
    r = subprocess.run(["git", "-c", "core.autocrlf=false", *args], cwd=cwd, capture_output=True, text=True,
                       encoding="utf-8")
    if ok and r.returncode:
        raise RuntimeError(f"git {args}: {r.stderr}")
    return r.stdout


def escrever(raiz, rel, texto):
    p = Path(raiz) / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(texto.encode("utf-8") if isinstance(texto, str) else texto)


def commitar(raiz, msg="x"):
    sh(raiz, "add", "--all", "--", ".")
    sh(raiz, "commit", "-q", "-m", msg)


def calado(fn, *a, **k):
    buf = io.StringIO()
    with redirect_stdout(buf):
        r = fn(*a, **k)
    return r, buf.getvalue()


def cats(rel):
    return sorted({c.split(" ")[0] for v in rel["achados"].values() for c, _ in v})


tmp = Path(tempfile.mkdtemp(prefix="teste-publicar-"))
repo = tmp / "repo"
repo.mkdir()
sh(repo, "init", "-q", "-b", "main")
sh(repo, "config", "user.name", "Teste")
sh(repo, "config", "user.email", "teste@exemplo.invalid")
sh(repo, "config", "commit.gpgsign", "false")

# plugin falso: import estático, import() por mapa (como TELAS de compacto/index.js), ?raw e caminho com ../
PLUGIN = {
    "pengu/index.js": "// entrada do Gabriel (comentário passa)\nimport './estilo.css';\nimport { a } from './a.js';\n"
                      "import { iniciar } from './compacto/index.js';\nexport function init() { a(); iniciar(); }\n",
    "pengu/a.js": "export const a = () => 1;\n",
    "pengu/b.js": "export const b = 2;\n",
    "pengu/estilo.css": "/* estilo */ a { color: #fff }\n",
    "pengu/versao.js": "export const VERSAO = '0.1.0';\nexport const REPO = 'dosxnjos/lol-ultra-client';\n",
    "pengu/compacto/index.js": "import { a } from '../a.js';\nexport const TELAS = { lobby: './tela-lobby.js' };\n"
                               "export const iniciar = () => import(TELAS.lobby);\n",
    "pengu/compacto/tela-lobby.js": "import md from '../posjogo/licoes.md?raw';\nexport const t = md;\n",
    "pengu/posjogo/licoes.md": "# lições\n",
}
for rel, texto in PLUGIN.items():
    escrever(repo, rel, texto)
for rel in V.COMPLEMENTO:
    if rel not in PLUGIN:
        escrever(repo, rel, "# limpo\n" if rel.endswith(".py") else "limpo\n")
escrever(repo, "LICENSE", "MIT License\n\nCopyright (c) 2026 dosxnjos\n")
escrever(repo, "TERCEIROS.md", "# terceiros\n")
escrever(repo, "publico/LEIA-ME.md", "# lol-ultra-client\n\nplugin do Pengu Loader.\n")
escrever(repo, "publico/instalar.cmd", b"@echo off\r\necho instalar\r\n")
escrever(repo, "publico/atualizar.cmd", b"@echo off\r\necho atualizar\r\n")
escrever(repo, "publico/desinstalar.cmd", b"@echo off\r\necho desinstalar\r\n")
escrever(repo, "publico/EDICAO", "publica\n")
# fora da lista: nunca entram
FORA = ["coletor/mentor.py", "coletor/riotapi.py", "tools/coletar-meta.py", "roadmap/plano.md", "mcp/servidor.py",
        "README.md", "CLAUDE.md"]
for rel in FORA:
    escrever(repo, rel, "# privado\n")
escrever(repo, ".gitignore", "dados/\ndist/\n")
escrever(repo, "dados/lol.db", b"banco")
commitar(repo, "base")
escrever(repo, "pengu/nao-commitado.js", "export const x = 1;\n")    # fora do git

saida = tmp / "dist"
# --sem-voz: o pacote de voz tem a sua parte (7), com um pacote falso; sem a opção, o main leria a pasta de verdade
ARGS = ["--raiz", str(repo), "--saida", str(saida), "--sem-banco", "--resumo", "--sem-voz"]

# 1. ensaio limpo: aprova, zips e SHA256SUMS, nada do que está fora da lista
rc, out = calado(P.main, ARGS)
pasta = saida / "v0.1.0"
zp, zc = pasta / "lol-ultra-client-plugin-0.1.0.zip", pasta / "lol-ultra-client-complemento-0.1.0.zip"
caso("ensaio limpo aprova (rc 0) e gera os 2 zips", rc == 0 and zp.exists() and zc.exists(), out[-600:])
somas = (pasta / "SHA256SUMS.txt").read_text(encoding="utf-8") if (pasta / "SHA256SUMS.txt").exists() else ""
caso("SHA256SUMS.txt no formato do sha256sum e com o hash de cada zip",
     somas == f"{P.sha256(zc)}  {zc.name}\n{P.sha256(zp)}  {zp.name}\n", somas)
caso("ensaio não cria dist/publico (nada de clone nem remote)", not (saida / "publico").exists())
with zipfile.ZipFile(zp) as z:
    nomes_p = set(z.namelist())
    dados_p = {n[len("lol-ultra-client/"):]: z.read(n) for n in nomes_p}
with zipfile.ZipFile(zc) as z:
    nomes_c = set(z.namelist())
esperado_p = {f"lol-ultra-client/{r[len('pengu/'):]}" for r in PLUGIN} | {
    f"lol-ultra-client/{n}" for n in ("LICENSE", "TERCEIROS.md", "LEIA-ME.md", "atualizar.cmd")}
caso("zip do plugin: exatamente pengu/ do commit + LICENSE, TERCEIROS, LEIA-ME e atualizar.cmd",
     nomes_p == esperado_p, sorted(nomes_p ^ esperado_p))
esperado_c = {f"lol-ultra-client-complemento/{r}" for r in list(V.COMPLEMENTO) + list(PLUGIN)} | {
    f"lol-ultra-client-complemento/{n}" for n in ("LICENSE", "TERCEIROS.md", "LEIA-ME.md", "atualizar.cmd", "instalar.cmd",
                                                  "desinstalar.cmd", "EDICAO")}
caso("zip do complemento: a lista de inclusão e o plugin inteiro em pengu/ (o instalar.cmd copia), com os caminhos do "
     "repo, + os 7 do público (EDICAO na raiz: edição pública)", nomes_c == esperado_c, sorted(nomes_c ^ esperado_c))
with zipfile.ZipFile(zc) as z:
    plugin_no_c = {n[len("lol-ultra-client-complemento/"):]: z.read(n) for n in z.namelist()
                   if n.startswith("lol-ultra-client-complemento/pengu/")}
caso("complemento reaberto: o plugin dentro dele é o mesmo do zip do plugin e todo import resolve",
     P.imports_quebrados(plugin_no_c) == [] and {k[len("pengu/"):]: v for k, v in plugin_no_c.items()}
     == {k: v for k, v in dados_p.items() if k not in ("LICENSE", "TERCEIROS.md", "LEIA-ME.md", "atualizar.cmd")})
todos = {n.split("/", 1)[1] for n in nomes_p | nomes_c} | set(P.montar(repo, "HEAD", tmp / "d2")["foto"])
caso("nada de fora da lista entra (mentor, riotapi, tools, roadmap, mcp, README e CLAUDE do privado, dados, não commitado)",
     not ({"coletor/mentor.py", "coletor/riotapi.py", "tools/coletar-meta.py", "roadmap/plano.md", "mcp/servidor.py",
           "CLAUDE.md", "dados/lol.db", "nao-commitado.js", "pengu/nao-commitado.js"} & todos), sorted(todos))
caso("zip reaberto: todo import do plugin resolve dentro dele (estático, import() do mapa, ?raw, ../)",
     P.imports_quebrados(dados_p) == [] and len(dados_p) == len(esperado_p))
with zipfile.ZipFile(zp) as z:
    caso(".cmd sai do blob cru (CRLF preservado)", z.read("lol-ultra-client/atualizar.cmd") == b"@echo off\r\necho atualizar\r\n")
    caso("LEIA-ME no zip, README.md na foto", "lol-ultra-client/LEIA-ME.md" in nomes_p
         and (pasta / "foto" / "README.md").exists() and not (pasta / "foto" / "publico").exists())
caso("aviso do arquivo fora do git", "pengu/nao-commitado.js" in out)

# 2. reprodutível: o mesmo commit dá os mesmos bytes
h1 = (P.sha256(zp), P.sha256(zc))
calado(P.main, ARGS)
caso("zips reprodutíveis (mesmo commit, mesmo sha256)", (P.sha256(zp), P.sha256(zc)) == h1)

# 3. plantados reprovam; nenhum zip sai
def plantar(rel, texto, esperado, nome):
    original = (repo / rel).read_bytes()
    escrever(repo, rel, texto)
    commitar(repo, f"planta {nome}")
    rc, out = calado(P.main, ARGS)
    r = P.montar(repo, "HEAD", tmp / "d3", None)
    caso(f"reprova {nome} ({esperado}), rc 1 e sem zip", rc == 1 and esperado in cats(r) and not zp.exists(),
         (rc, cats(r)))
    escrever(repo, rel, original)
    commitar(repo, f"tira {nome}")


plantar("coletor/avisos.py", "K = 'RGAPI-0000-1111'\n", "credencial", "chave da Riot plantada")
plantar("coletor/coach_vivo.py", "# partida 3293149183\nA = 1\n", "partida", "gameId em comentário")
plantar("coletor/banco.py", "P = 'C:\\\\Users\\\\fulano\\\\x'\n", "caminho", "caminho de usuário")
plantar("publico/LEIA-ME.md", "# lol-ultra-client\n\ncoach do Gabriel\n", "nome_literal", "nome no LEIA-ME")
plantar("pengu/index.js", "import { z } from './falta.js';\n", "import", "import quebrado no plugin")
plantar("pengu/compacto/index.js", "export const TELAS = { x: './tela-sumiu.js' };\n", "import", "tela do mapa que falta")
plantar("pengu/a.js", b"\xff\xfe\x00bin", "tipo", "arquivo binário com extensão de texto")
plantar("coletor/sugestoes.py", "# replay em temp/gravacao/partida_3293149183/\n", "partida", "gameId colado em _")
plantar("coletor/ao_vivo.py", "# inclusive a 3293149183.\n", "partida", "gameId no fim da frase")

# revisão do P1: o CAMINHO vai para a árvore pública e para os zips; arquivo novo em pengu/ entra sozinho na lista
escrever(repo, "pengu/posjogo/xerekton-3293149183.md", "limpo\n")
commitar(repo, "planta nome")
rc, out = calado(P.main, ARGS)
r = P.montar(repo, "HEAD", tmp / "d3", None)
caso("arquivo limpo com gameId e Xerek no nome reprova (rc 1, sem zip)", rc == 1 and not zp.exists()
     and {"partida (nome)", "xerek (nome)"} <= {c for c, _ in r["achados"].get("pengu/posjogo/xerekton-3293149183.md", [])},
     r["achados"])
(repo / "pengu/posjogo/xerekton-3293149183.md").unlink()
commitar(repo, "tira nome")

# revisão do P1: o texto do release (--notas) vai a público; varrido como a foto, no ensaio e no --publicar
notas_ruins = tmp / "notas-ruins.md"
notas_ruins.write_text("corrigido o bug da partida 3293149183 (C:\\Users\\fulano\\x)\n", encoding="utf-8")
notas_boas = tmp / "notas-boas.md"
notas_boas.write_text("Primeira versão pública.\n", encoding="utf-8")
rc, out = calado(P.main, ARGS + ["--notas", str(notas_ruins)])
r = P.montar(repo, "HEAD", tmp / "d3", None, notas_ruins)
caso("notas do release com gameId e caminho reprovam o ensaio (rc 1, sem zip)", rc == 1 and not zp.exists()
     and {c for c, _ in r["achados"].get("NOTAS.md (release)", [])} == {"partida", "caminho"}, r["achados"])

# link simbólico guardado no git (modo 120000) nunca entra, mesmo sem link no disco
blob = subprocess.run(["git", "hash-object", "-w", "--stdin"], cwd=repo, input="a.js", capture_output=True,
                      text=True).stdout.strip()
sh(repo, "update-index", "--add", "--cacheinfo", f"120000,{blob},pengu/link.js")
sh(repo, "commit", "-q", "-m", "link")
r = P.montar(repo, "HEAD", tmp / "d4", None)
caso("link simbólico no commit reprova (tipo)", ("tipo", 0) in r["achados"].get("pengu/link.js", []), r["achados"])
sh(repo, "rm", "-q", "--cached", "pengu/link.js")
sh(repo, "commit", "-q", "-m", "tira link")

# pendente que falta reprova com a fase
(repo / "publico/instalar.cmd").unlink()
commitar(repo, "sem instalar")
r = P.montar(repo, "HEAD", tmp / "d5", None)
caso("instalar.cmd ausente = falta (P4.3)", r["achados"].get("instalar.cmd") == [("falta (P4.3)", 0)], r["achados"])
escrever(repo, "publico/instalar.cmd", b"@echo off\r\necho instalar\r\n")
commitar(repo, "volta instalar")
r = P.montar(repo, "HEAD", tmp / "d6", None)
caso("árvore de volta limpa", not r["achados"], r["achados"])

# 4. --publicar com remote falso (bare local) e gh falso
bare = tmp / "remote.git"
sh(tmp, "init", "-q", "--bare", "-b", "main", str(bare))
chamadas = []
releases = {}          # tag -> texto das notas, como o GitHub guardaria


def gh_falso(args):
    chamadas.append(list(args))
    if args[:2] == ["release", "view"] and args[2] not in releases:
        raise RuntimeError("gh release view: release not found")
    if args[:2] == ["release", "create"]:
        releases[args[2]] = Path(args[args.index("--notes-file") + 1]).read_text(encoding="utf-8")
    return "dosxnjos\n" if args[:2] == ["api", "user"] else ""


def gh_cai_no_release(args):
    """o push sai e o upload do release cai (rede, 422, token sem escopo)"""
    if args[:2] == ["release", "create"]:
        raise RuntimeError("gh release create: HTTP 422: upload falhou")
    return gh_falso(args)


PUB = ARGS + ["--publicar", "--remote", str(bare)]

# recusas antes de qualquer rede
rc, out = calado(P.main, ARGS + ["--publicar", "--remote", "git@github.com:dosxnjos/lol-client.git"], rodar_gh=gh_falso)
caso("recusa o repositório privado como destino (rc 2, nenhum gh)", rc == 2 and "privado" in out and not chamadas, out[-200:])
rc, out = calado(P.main, ARGS + ["--publicar", "--remote", "git@github.com:outro/lol-ultra-client.git"], rodar_gh=gh_falso)
caso("recusa remote do GitHub que não é o REPO", rc == 2 and "outro/lol-ultra-client" in out and not chamadas, out[-200:])
rc, out = calado(P.main, PUB)
caso("remote local sem gh falso: recusa (o release iria ao GitHub de verdade)", rc == 2 and "gh falso" in out, out[-200:])


def gh_outra_conta(args):
    return "outraconta\n"


rc, out = calado(P.main, ARGS + ["--publicar", "--remote", "git@github.com:dosxnjos/lol-ultra-client.git"],
                 rodar_gh=gh_outra_conta)
caso("recusa com o gh logado em outra conta", rc == 2 and "outraconta" in out, out[-200:])
caso("nenhuma recusa tocou o remote falso", sh(bare, "for-each-ref").strip() == "")

# arquivo da lista mexido e não commitado: o ensaio avisa e usa o commit; o --publicar recusa
escrever(repo, "pengu/a.js", "export const a = () => 'mexido';\n")
rc, out = calado(P.main, ARGS)
with zipfile.ZipFile(zp) as z:
    caso("ensaio com arquivo mexido: avisa e o zip leva o do commit", rc == 0 and "pengu/a.js" in out
         and z.read("lol-ultra-client/a.js") == PLUGIN["pengu/a.js"].encode())
rc, out = calado(P.main, PUB, rodar_gh=gh_falso)
caso("--publicar recusa com arquivo mexido", rc == 2 and "não commitados" in out and not chamadas, out[-200:])
sh(repo, "checkout", "-q", "--", "pengu/a.js")

# varredura reprovada: --publicar não publica
escrever(repo, "coletor/selva.py", "# partida 3293149183\n")
commitar(repo, "planta")
rc, out = calado(P.main, PUB, rodar_gh=gh_falso)
caso("--publicar recusa foto reprovada (rc 1 do ensaio vira recusa, remote intocado)",
     rc == 2 and "reprovou" in out and sh(bare, "for-each-ref").strip() == "" and not chamadas, out[-200:])
escrever(repo, "coletor/selva.py", "# limpo\n")
commitar(repo, "tira")

# notas ruins: o --publicar recusa antes de qualquer rede
rc, out = calado(P.main, PUB + ["--notas", str(notas_ruins)], rodar_gh=gh_falso)
caso("--publicar com notas reprovadas: recusa, remote intocado, nenhum gh", rc == 2 and "reprovou" in out
     and sh(bare, "for-each-ref").strip() == "" and not chamadas, out[-200:])

# publica v0.1.0, e o release cai depois do push: rc 3, a tag fica no remote sem release
rc, out = calado(P.main, PUB + ["--notas", str(notas_boas)], rodar_gh=gh_cai_no_release)
caso("release cai depois do push: rc 3, diz como retomar, tag no remote, nenhum release",
     rc == 3 and "FALHOU" in out and "mesmo comando" in out and "v0.1.0" in sh(bare, "tag").split() and not releases,
     out[-400:])
# rodar de novo: retoma só o release (nenhum commit, tag nem push novos)
rc, out = calado(P.main, PUB + ["--notas", str(notas_boas)], rodar_gh=gh_falso)
caso("rodar de novo retoma só o release: rc 0, 1 commit no remote, release com as notas varridas",
     rc == 0 and "retomado" in out and sh(bare, "rev-list", "--count", "main").strip() == "1"
     and releases.get("v0.1.0") == "Primeira versão pública.\n", out[-400:])
caso("--publicar com remote falso: rc 0", rc == 0, out[-400:])
arquivos_remote = set(sh(bare, "ls-tree", "-r", "--name-only", "main").split())
foto = set(P.montar(repo, "HEAD", tmp / "d7", None)["foto"])
caso("o remote recebeu exatamente a foto (nada do privado)", arquivos_remote == foto and "README.md" in foto
     and "CLAUDE.md" not in foto and not any(f.startswith(("publico/", "tools/", "roadmap/", "mcp/")) for f in foto),
     sorted(arquivos_remote ^ foto))
caso("tag v0.1.0 no remote", "v0.1.0" in sh(bare, "tag").split())
autor = sh(bare, "log", "-1", "--format=%an <%ae>|%cn <%ce>", "main").strip()
caso("autor e committer = dosxnjos noreply (nunca o e-mail desta máquina)",
     autor == "dosxnjos <dosxnjos@users.noreply.github.com>|dosxnjos <dosxnjos@users.noreply.github.com>", autor)
caso("conteúdo no remote igual ao do commit (blob cru)",
     sh(bare, "show", "main:atualizar.cmd") == "@echo off\r\necho atualizar\r\n"
     or subprocess.run(["git", "show", "main:atualizar.cmd"], cwd=bare, capture_output=True).stdout
     == b"@echo off\r\necho atualizar\r\n")
rel_ = [c for c in chamadas if c[:2] == ["release", "create"]]
caso("gh release create v0.1.0 no REPO com os 2 zips e o SHA256SUMS", len(rel_) == 1 and rel_[0][2] == "v0.1.0"
     and rel_[0][rel_[0].index("--repo") + 1] == "dosxnjos/lol-ultra-client" and "--verify-tag" in rel_[0]
     and [Path(x).name for x in rel_[0][-3:]] == ["lol-ultra-client-complemento-0.1.0.zip",
                                                 "lol-ultra-client-plugin-0.1.0.zip", "SHA256SUMS.txt"], rel_)

# a mesma versão de novo: recusa (tag e release já existem), nenhum release a mais
n = len([c for c in chamadas if c[:2] == ["release", "create"]])
rc, out = calado(P.main, PUB, rodar_gh=gh_falso)
caso("mesma versão de novo: recusa (já publicado), nenhum release a mais", rc == 2 and "já publicado" in out
     and len([c for c in chamadas if c[:2] == ["release", "create"]]) == n, out[-200:])
# a mesma versão com a foto mudada: recusa (a tag aponta outra foto), remote intocado
escrever(repo, "pengu/b.js", "export const b = 3;\n")
commitar(repo, "muda sem subir versão")
rc, out = calado(P.main, PUB, rodar_gh=gh_falso)
caso("mesma versão com outra foto: recusa (suba VERSAO), 1 commit no remote", rc == 2 and "outra foto" in out
     and sh(bare, "rev-list", "--count", "main").strip() == "1", out[-200:])

# versão nova com um arquivo a menos: o remote perde o arquivo
(repo / "pengu/b.js").unlink()
escrever(repo, "pengu/versao.js", "export const VERSAO = '0.1.1';\nexport const REPO = 'dosxnjos/lol-ultra-client';\n")
commitar(repo, "0.1.1")
rc, out = calado(P.main, PUB, rodar_gh=gh_falso)
arquivos_remote = set(sh(bare, "ls-tree", "-r", "--name-only", "main").split())
caso("v0.1.1: arquivo apagado some do remote, histórico com 2 commits e 2 tags",
     rc == 0 and "pengu/b.js" not in arquivos_remote and "pengu/a.js" in arquivos_remote
     and sh(bare, "rev-list", "--count", "main").strip() == "2" and set(sh(bare, "tag").split()) == {"v0.1.0", "v0.1.1"},
     out[-300:])

# 5. LEIA-ME real: tom de produto e nada pessoal
leia = (RAIZ / "publico" / "LEIA-ME.md").read_text(encoding="utf-8")
import re as _re
ruins = [p for p in (r"\btu\b", r"\bpra\b", r"\bteu\b", r"\btua\b", r"gabriel", r"xerek", r"nomura", r"@")
         if _re.search(p, leia, _re.I)]
caso("LEIA-ME.md real: sem tu/pra/teu, nome, Riot ID, Nomura ou e-mail", not ruins, ruins)
caso("LEIA-ME.md real: Pengu Loader 1.1.6, riscos e Termos, não endossado pela Riot, complemento opcional, voz",
     all(t in leia for t in ("1.1.6", "Termos de Serviço", "não é endossado pela Riot Games", "opcional", "voz",
                             "ddragon.leagueoflegends.com", "api.github.com")))
lic = (RAIZ / "LICENSE").read_text(encoding="utf-8")
caso("LICENSE: MIT, 2026, dosxnjos", lic.startswith("MIT License") and "Copyright (c) 2026 dosxnjos" in lic)
ter = (RAIZ / "TERCEIROS.md").read_text(encoding="utf-8")
caso("TERCEIROS.md: better-lol-chat (MIT) e Lucide (ISC)", "better-lol-chat" in ter and "Lucide" in ter and "ISC" in ter)

# 6. ensaio do repositório real (só leitura; zips na pasta temporária): desde a P4 (gameIds fora dos comentários, .cmd e
# EDICAO no commit) aprova inteiro, e o complemento leva a edição pública e os 2 módulos novos
real = P.montar(RAIZ, "HEAD", tmp / "real", RAIZ / "dados" / "lol.db")
plugin_reais = {d: a for d, a in real["achados"].items() if d.startswith("pengu/")}
caso("repositório real: o plugin passa na varredura e nos imports", not plugin_reais, plugin_reais)
caso("repositório real: aprovado, nenhum achado, os 2 zips gerados", not real["achados"] and len(real["zips"]) == 2,
     real["achados"])
pc = set(real["pacotes"]["complemento"])
caso("repositório real: complemento com EDICAO, instalar.cmd, desinstalar.cmd, instalacao.py e relancador.py",
     {f"lol-ultra-client-complemento/{n}" for n in ("EDICAO", "instalar.cmd", "desinstalar.cmd", "coletor/instalacao.py",
                                                     "coletor/relancador.py")} <= pc
     and not any(n.endswith(("/mentor.py", "/riotapi.py", "/carregamento.py", "/draft.py", "/travadas.py",
                             "/expansoes.py", "/vitrine.py")) for n in pc), sorted(pc)[:5])
print(f"repositório real (HEAD {real['commit'][:10]}): plugin {len(real['pacotes']['plugin'])} arquivos, complemento "
      f"{len(real['pacotes']['complemento'])}, foto {len(real['foto'])}; achados "
      f"{sum(len(v) for v in real['achados'].values())} em {len(real['achados'])} arquivos")

# 7. pacote de voz (P5): pacote falso no temp, catálogo do commit pelo avisos.py da foto, varredura das falas, zip enxuto,
# anexado só quando nenhum release anterior tem o nome; o complemento (coletor/voz_pacote.py) aceita o que sai daqui
sys.path.insert(0, str(RAIZ / "coletor"))
import atualizar as A  # noqa: E402
import voz_pacote as VP  # noqa: E402

AVISOS_FALSO = ('import hashlib\n\n'
                '# catálogo falso: as duas pessoais montadas por partes (a varredura da foto não as vê; a das falas, sim)\n'
                'FALAS = ["gank no top", "mid sumiu", "Xe" + "rek no rio", "fala de an" + "jos", "fala suspeita", '
                '"fala que falta"]\n\n\n'
                'def catalogo():\n    return sorted(FALAS)\n\n\n'
                'def versao_catalogo(frases=None):\n    frases = catalogo() if frases is None else frases\n'
                '    return hashlib.sha1("\\n".join(sorted(frases)).encode("utf-8")).hexdigest()[:12]\n')
escrever(repo, "coletor/avisos.py", AVISOS_FALSO)
escrever(repo, "pengu/versao.js", "export const VERSAO = '0.1.2';\nexport const REPO = 'dosxnjos/lol-ultra-client';\n")
commitar(repo, "catálogo falso e 0.1.2")
import hashlib as _hl  # noqa: E402
VERSAO_CAT = _hl.sha1("\n".join(sorted(["gank no top", "mid sumiu", "Xerek no rio", "fala de anjos", "fala suspeita",
                                         "fala que falta"])).encode()).hexdigest()[:12]
pac = tmp / "pacotes" / "aoede"
pac.mkdir(parents=True)
WAVS = {"gank no top": "aa01.wav", "mid sumiu": "aa02.wav", "Xerek no rio": "aa03.wav", "fala de anjos": "aa04.wav",
        "fala suspeita": "aa05.wav", "fala velha": "aa06.wav"}
for fala, arq in WAVS.items():
    (pac / arq).write_bytes(b"RIFF" + arq.encode() * 50)
(pac / "notas-da-geracao.txt").write_text("fora\n", encoding="utf-8")


def indice_voz(versao=VERSAO_CAT, extra=None):
    fs = {f: {"arquivo": a, "auditoria": {"texto": f, "nota": 1.0}, "em": "2026-10-16 13:23", "lote": 3}
          for f, a in WAVS.items()}
    fs["fala suspeita"]["suspeita"] = True
    fs.update(extra or {})
    (pac / "indice.json").write_text(json.dumps({"voz": "aoede", "versao_catalogo": versao, "modelo": "m-tts",
                                                 "progresso_alvo": {"x": 1}, "falhas": {}, "frases": fs},
                                                ensure_ascii=False), encoding="utf-8")


import json  # noqa: E402
ARGS_V = ["--raiz", str(repo), "--saida", str(saida), "--sem-banco", "--resumo", "--voz", str(pac)]
pasta12 = saida / "v0.1.2"
zv = pasta12 / f"voz-aoede-{VERSAO_CAT}.zip"

indice_voz()                                       # sem "fala que falta": incompleto
rc, out = calado(P.main, ARGS_V)
caso("voz: pacote local sem uma fala do catálogo reprova (voz-incompleto), rc 1, nenhum zip",
     rc == 1 and "voz-incompleto" in out and not zv.exists() and not (pasta12 / "SHA256SUMS.txt").exists(), out[-300:])
indice_voz("0123456789ab", {"fala que falta": {"arquivo": "aa01.wav"}})
rc, out = calado(P.main, ARGS_V)
caso("voz: pacote de outro catálogo reprova (voz-catalogo)", rc == 1 and "voz-catalogo" in out and not zv.exists(), out[-300:])
indice_voz(extra={"fala que falta": {"arquivo": "..\\fora.wav"}})
rc, out = calado(P.main, ARGS_V)
caso("voz: arquivo com caminho no índice local conta como falta (reprova)", rc == 1 and "voz-incompleto" in out, out[-300:])
(pac / "aa07.wav").write_bytes(b"RIFF" + b"aa07" * 50)
indice_voz(extra={"fala que falta": {"arquivo": "aa07.wav"}})
rc, out = calado(P.main, ARGS_V)
caso("voz: pacote completo aprova (rc 0) com 3 zips", rc == 0 and zv.exists(), out[-400:])
somas = (pasta12 / "SHA256SUMS.txt").read_text(encoding="utf-8") if (pasta12 / "SHA256SUMS.txt").exists() else ""
caso("voz: SHA256SUMS com a linha do zip da voz", f"{P.sha256(zv)}  {zv.name}\n" in somas and len(somas.splitlines()) == 3, somas)
caso("voz: o resumo diz quantas falas e quantas saíram, nunca o texto delas",
     "3 falas" in out and "pessoal 1" in out and "xerek 1" in out and "Xerek no rio" not in out and "anjos" not in out, out[-400:])
with zipfile.ZipFile(zv) as z:
    nomes_v = sorted(z.namelist())
    ind_v = json.loads(z.read("aoede/indice.json"))
    wav_ok = z.read("aoede/aa01.wav") == (pac / "aa01.wav").read_bytes()
caso("voz: zip só com aoede/indice.json e os .wav das falas que passaram (sem suspeita, sem a fala fora do catálogo, sem o "
     "resto da pasta)", nomes_v == ["aoede/aa01.wav", "aoede/aa02.wav", "aoede/aa07.wav", "aoede/indice.json"] and wav_ok,
     nomes_v)
caso("voz: índice enxuto (voz, versão do catálogo do commit, modelo, origem release, frases só com arquivo)",
     set(ind_v) == {"voz", "versao_catalogo", "modelo", "origem", "frases"} and ind_v["origem"] == "release"
     and ind_v["versao_catalogo"] == VERSAO_CAT and ind_v["frases"] == {"gank no top": {"arquivo": "aa01.wav"},
                                                                      "mid sumiu": {"arquivo": "aa02.wav"},
                                                                      "fala que falta": {"arquivo": "aa07.wav"}}, ind_v)
h_voz = P.sha256(zv)
calado(P.main, ARGS_V)
caso("voz: zip reprodutível (mesmo pacote e commit, mesmo sha256)", P.sha256(zv) == h_voz)
dest_v = tmp / "extraido-voz"
dest_v.mkdir()
esp_v = A.extrair(zv.read_bytes(), "aoede", dest_v)
try:
    n_v = VP.conferir_indice(dest_v, esp_v, "aoede", VERSAO_CAT)
except A.Falha as e:
    n_v = str(e)
caso("voz: o complemento (voz_pacote.conferir_indice) aceita o zip que sai daqui", n_v == 3, n_v)
rc, out = calado(P.main, ["--raiz", str(repo), "--saida", str(saida), "--sem-banco", "--resumo", "--voz",
                          str(tmp / "pacotes" / "nao-existe")])
caso("voz: sem pacote na pasta, aprova sem o zip da voz e avisa", rc == 0 and "nenhum pacote" in out
     and len((pasta12 / "SHA256SUMS.txt").read_text(encoding="utf-8").splitlines()) == 2, out[-300:])

publicados = []   # releases do repositório falso, o mais novo primeiro: (rascunho, pré-lançamento, [nomes dos assets])


def gh_voz(args):
    chamadas.append(list(args))
    if args[:2] == ["api", "--paginate"]:
        if args[-1] == ".[].assets[].name":   # o --jq de antes da revisão: todos os nomes, de todas as páginas
            return "".join(n + "\n" for _r, _p, ns in publicados for n in ns)
        return "".join(("pre" if p else "rel") + "".join("\t" + n for n in ns) + "\n" for r, p, ns in publicados if not r)
    if args[:2] == ["release", "view"] and args[2] not in releases:
        raise RuntimeError("gh release view: release not found")
    if args[:2] == ["release", "create"]:
        releases[args[2]] = Path(args[args.index("--notes-file") + 1]).read_text(encoding="utf-8")
        publicados.insert(0, (False, False, [Path(x).name for x in args[args.index("--verify-tag") + 1:]]))
    return "dosxnjos\n" if args[:2] == ["api", "user"] else ""


rc, out = calado(P.main, ARGS_V + ["--publicar", "--remote", str(bare)], rodar_gh=gh_voz)
cria = [c for c in chamadas if c[:3] == ["release", "create", "v0.1.2"]]
caso("voz: --publicar com catálogo novo anexa o zip da voz e o SHA256SUMS com 3 linhas", rc == 0 and len(cria) == 1
     and zv.name in [Path(x).name for x in cria[0]]
     and len((pasta12 / "SHA256SUMS.txt").read_text(encoding="utf-8").splitlines()) == 3, out[-300:])
escrever(repo, "pengu/versao.js", "export const VERSAO = '0.1.3';\nexport const REPO = 'dosxnjos/lol-ultra-client';\n")
commitar(repo, "0.1.3 com o mesmo catálogo")
rc, out = calado(P.main, ARGS_V + ["--publicar", "--remote", str(bare)], rodar_gh=gh_voz)
cria = [c for c in chamadas if c[:3] == ["release", "create", "v0.1.3"]]
s13 = (saida / "v0.1.3" / "SHA256SUMS.txt").read_text(encoding="utf-8")
caso("voz: mesmo catálogo na versão seguinte = o zip da voz não sobe de novo e sai do SHA256SUMS (2 zips + SHA256SUMS)",
     rc == 0 and len(cria) == 1 and [Path(x).name for x in cria[0][-3:]] == [
         "lol-ultra-client-complemento-0.1.3.zip", "lol-ultra-client-plugin-0.1.3.zip", "SHA256SUMS.txt"]
     and zv.name not in s13 and len(s13.splitlines()) == 2, (out[-300:], s13))

# revisão adversarial da P5: o complemento (voz_pacote.achar) lê só a 1ª página de 100 releases. Com o release do zip da voz
# empurrado para fora dessa janela (95 releases mais novos sem ele, um rascunho com ele que a API sem login não mostra), a
# versão seguinte com o mesmo catálogo anexa o zip de novo
for i in range(95):
    publicados.insert(0, (False, i == 3, ["SHA256SUMS.txt"]))
publicados.insert(0, (True, False, [zv.name, "SHA256SUMS.txt"]))
escrever(repo, "pengu/versao.js", "export const VERSAO = '0.1.4';\nexport const REPO = 'dosxnjos/lol-ultra-client';\n")
commitar(repo, "0.1.4 com o mesmo catálogo, 95 releases depois")
rc, out = calado(P.main, ARGS_V + ["--publicar", "--remote", str(bare)], rodar_gh=gh_voz)
cria = [c for c in chamadas if c[:3] == ["release", "create", "v0.1.4"]]
s14 = (saida / "v0.1.4" / "SHA256SUMS.txt").read_text(encoding="utf-8")
caso("voz: o release com o zip da voz fora dos 90 mais novos (rascunho não conta) = anexa de novo, SHA256SUMS com 3 linhas",
     rc == 0 and len(cria) == 1 and zv.name in [Path(x).name for x in cria[0]] and zv.name in s14
     and len(s14.splitlines()) == 3, (out[-300:], s14))

print(f"\n{len(falhas)} falha(s)" if falhas else "\ntudo ok")
sys.exit(1 if falhas else 0)
