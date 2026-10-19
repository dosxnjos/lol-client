# Prova do botão "atualizar" do lado do complemento e do atualizar.cmd (P3 de roadmap/2026-10-19-publicacao-e-complemento-publico.md).
# Nada aqui fala com o GitHub nem com o client: um servidor de release falso em 127.0.0.1:8831-8840 faz o papel do GitHub e um
# segundo servidor na mesma faixa é "o de fora" (conta acessos: tem de ficar em 0). Pastas de plugin e de complemento falsas no
# temp, LOCALAPPDATA apontado para o temp. Nunca toca a pasta do Pengu, o %LOCALAPPDATA%\lol-client de verdade nem a 8765.
#   (a) coletor/atualizar.py: sucesso (plugin e complemento iguais aos zips, dados/ intacto, .atualizacao/anterior com a versão
#       velha, redirecionamento dentro da origem seguido, reinício pedido depois do "pronto" segurado e só em None/Lobby);
#   (b) hash: linha errada no SHA256SUMS, digest nulo, digest diferente, SHA256SUMS que não bate com o digest dele: nada troca;
#   (c) queda: conexão cortada no meio do download; arquivo preso no meio da troca (devolve a anterior, o plugin inclusive);
#   (d) recusas antes da rede: junção, .git (na pasta e acima), versão que não é mais nova, fora de None/Lobby, plugin ausente;
#   (e) origem: URL do asset fora da origem e redirecionamento para fora (o servidor de fora com 0 acessos); origem trocada fora
#       de loopback = ValueError; zip com ".." e zip que traz dados/ recusados;
#   (f) rotas num ServidorLocal de verdade em porta de teste: /ola anuncia "atualizar", Origin de site = 403, Origin do Pengu e
#       do client = aceita, preflight, GET /atualizar/estado;
#   (g) coletor.py: comando do sucessor, esperar_pid com um processo filho de mentira, pedir_saida faz o rodar() devolver;
#   (h) publico/atualizar.cmd por cmd /c com a pasta atual dentro da pasta dele (como no duplo clique): as mesmas regras;
#   (i) revisão adversarial da P3: fila que anda durante o download, extração que falha no meio, troca que não volta inteira,
#       complemento numa junção importado pelo link, .git na pasta do usuário (dotfiles), complemento que sobe durante o
#       download do .cmd, '!' no caminho do .cmd.
# uso: python tools/teste-atualizar.py
import hashlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import atualizar as A  # noqa: E402

PORTAS = range(8831, 8841)
REPO = "dono/lol-ultra-client"
CMD = (RAIZ / "publico" / "atualizar.cmd").read_bytes()
casos = []


def caso(nome, passou, detalhe=""):
    casos.append((nome, bool(passou), detalhe))
    print(("ok " if passou else "FALHOU ") + nome + ("" if passou else f"  [{detalhe}]"), flush=True)


# ---------- servidores falsos ----------

class _H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        g = self.server.g
        g.hits.append(self.path)
        if g.gancho:   # o caso mexe no mundo no meio do pedido (fase muda, complemento sobe)
            g.gancho(self.path)
        if g.atraso:
            time.sleep(g.atraso)
        p = self.path.split("?")[0]
        if p.startswith(f"/repos/{REPO}/releases/tags/") or p == f"/repos/{REPO}/releases/latest":
            tag = p.rsplit("/", 1)[1]
            rel = g.latest if tag == "latest" else g.rels.get(tag)
            return self._json(rel) if rel else self._enviar(404, b"{}")
        if p.startswith(f"/{REPO}/releases/download/"):
            nome = p.rsplit("/", 1)[1]
            if g.redir == "dentro":
                return self._ir(f"/blob/{nome}")
            if g.redir:
                return self._ir(f"{g.redir}/blob/{nome}")
            return self._blob(nome)
        if p.startswith("/blob/"):
            return self._blob(p.rsplit("/", 1)[1])
        self._enviar(404, b"{}")

    def _ir(self, destino):
        self.send_response(302)
        self.send_header("Location", destino)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _json(self, d):
        self._enviar(200, json.dumps(d).encode(), "application/json")

    def _blob(self, nome):
        g = self.server.g
        dados = g.blobs.get(nome)
        if dados is None:
            return self._enviar(404, b"")
        if nome in g.cortar:   # queda no meio: anuncia o tamanho inteiro, manda a metade e fecha
            self.send_response(200)
            self.send_header("Content-Length", str(len(dados)))
            self.end_headers()
            self.wfile.write(dados[: len(dados) // 2])
            self.wfile.flush()
            self.close_connection = True
            return
        self._enviar(200, dados, "application/octet-stream")

    def _enviar(self, cod, corpo, tipo="application/octet-stream"):
        self.send_response(cod)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)


class Falso:
    """servidor HTTP falso numa porta livre de 8831-8840"""

    def __init__(self, ocupadas=()):
        self.rels, self.blobs, self.hits, self.cortar = {}, {}, [], set()
        self.latest = None
        self.redir = None
        self.atraso = 0
        self.gancho = None
        for p in PORTAS:
            if p in ocupadas:
                continue
            try:
                self.srv = ThreadingHTTPServer(("127.0.0.1", p), _H)
                break
            except OSError:
                continue
        else:
            raise SystemExit("nenhuma porta livre em 8831-8840")
        self.srv.daemon_threads = True
        self.srv.g = self
        self.porta = p
        self.base = f"http://127.0.0.1:{p}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def limpar(self):
        self.rels, self.blobs, self.hits, self.cortar = {}, {}, [], set()
        self.latest, self.redir, self.atraso, self.gancho = None, None, 0, None

    def parar(self):
        self.srv.shutdown()
        self.srv.server_close()


def sha(b):
    return hashlib.sha256(b).hexdigest()


def zipar(prefixo, arquivos):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for rel, dados in sorted(arquivos.items()):
            z.writestr(f"{prefixo}/{rel}" if prefixo else rel, dados)
    return buf.getvalue()


def versao_js(v):
    return f"export const VERSAO = '{v}';\nexport const REPO = '{REPO}';\n".encode()


PLUGIN_VELHO = {"index.js": b"// velho", "versao.js": versao_js("0.1.0"), "velho.js": b"// sai na 0.2.0", "sub/a.js": b"a1",
                "atualizar.cmd": CMD}
PLUGIN_NOVO = {"index.js": b"// novo", "versao.js": versao_js("0.2.0"), "novo.js": b"// entra", "sub/a.js": b"a2",
               "atualizar.cmd": CMD, "LEIA-ME.md": b"leia"}
COMP_VELHO = {"coletor/coletor.py": b"# velho", "coletor/velho.py": b"# sai", "pengu/versao.js": versao_js("0.1.0"),
              "pengu/index.js": b"// velho", "LEIA-ME.md": b"velho", "atualizar.cmd": CMD}
COMP_NOVO = {"coletor/coletor.py": b"# novo", "pengu/versao.js": versao_js("0.2.0"), "pengu/index.js": b"// novo",
             "LEIA-ME.md": b"novo", "atualizar.cmd": CMD, "requirements-complemento.txt": b"numpy==2.4.4\n"}
DADOS = {"dados/lol.db": b"BANCO DE QUEM INSTALOU", "dados/coletor.log": b"log", "dados/calibracao-chat.json": b"{}"}


def publicar(g, versao="0.2.0", plugin=None, comp=None, mexer=None, base_download=None):
    """release falso v<versao> com os 2 zips e o SHA256SUMS.txt; mexer(rel, blobs, sums) estraga o que o caso pede"""
    tag = f"v{versao}"
    blobs = {f"lol-ultra-client-plugin-{versao}.zip": zipar("lol-ultra-client", plugin or PLUGIN_NOVO),
             f"lol-ultra-client-complemento-{versao}.zip": zipar("lol-ultra-client-complemento", comp or COMP_NOVO)}
    sums = {n: sha(b) for n, b in blobs.items()}
    base = base_download or g.base
    rel = {"tag_name": tag, "draft": False, "prerelease": False, "assets": []}
    if mexer:
        mexer(rel, blobs, sums)
    blobs["SHA256SUMS.txt"] = "".join(f"{h}  {n}\n" for n, h in sorted(sums.items())).encode()
    for n, b in blobs.items():
        rel["assets"].append({"name": n, "browser_download_url": f"{base}/{REPO}/releases/download/{tag}/{n}",
                              "digest": f"sha256:{sha(b)}"})
    g.blobs.update(blobs)
    g.rels[tag] = rel
    g.latest = rel
    return rel


def asset(rel, nome_parcial):
    return next(a for a in rel["assets"] if nome_parcial in a["name"])


def arvore(p):
    p = Path(p)
    saida = {}
    if not p.exists():
        return saida
    for raiz, dirs, arqs in os.walk(p):
        dirs[:] = [d for d in dirs if d != ".atualizacao"]
        for a in arqs:
            f = Path(raiz) / a
            saida[f.relative_to(p).as_posix()] = sha(f.read_bytes())
    return saida


def esperado(arquivos):
    return {k: sha(v) for k, v in arquivos.items()}


class Instalacao:
    """plugins\\lol-ultra-client e %LOCALAPPDATA%\\lol-client\\complemento\\lol-ultra-client-complemento falsos no temp"""

    criadas = []

    def __init__(self, base):
        self.base = Path(tempfile.mkdtemp(prefix="luc-", dir=base))
        Instalacao.criadas.append(self.base)
        self.plugins = self.base / "pluginsPengu" / "plugins"
        self.plug = self.plugins / "lol-ultra-client"
        self.local = self.base / "local"
        self.comp = self.local / "lol-client" / "complemento" / "lol-ultra-client-complemento"
        for pasta, arqs in ((self.plug, PLUGIN_VELHO), (self.comp, {**COMP_VELHO, **DADOS})):
            for rel, dados in arqs.items():
                f = pasta / rel
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_bytes(dados)

    def fotos(self):
        return arvore(self.plug), arvore(self.comp)


ANTES_PLUGIN, ANTES_COMP = esperado(PLUGIN_VELHO), esperado({**COMP_VELHO, **DADOS})


def novo_at(inst, g, fase=lambda: "None", reiniciar=None, **kw):
    return A.Atualizador(raiz=inst.comp, plugins=inst.plugins, fase=fase, reiniciar=reiniciar, api=g.base, download=g.base,
                         origens=(g.base,), segurar_s=0.2, **kw)


def rodar(at, versao="0.2.0", limite=30):
    st, est = at.pedir(versao)
    if st == 202:
        at.thread.join(limite)
    return st, at.estado()


def intacta(inst):
    p, c = inst.fotos()
    return p == ANTES_PLUGIN and c == ANTES_COMP


def principal():
    base = Path(tempfile.gettempdir())
    g = Falso()
    fora = Falso(ocupadas={g.porta})
    print(f"servidor falso em {g.base}; o de fora em {fora.base}")
    try:
        parte_a(base, g)
        parte_b(base, g)
        parte_c(base, g)
        parte_d(base, g)
        parte_e(base, g, fora)
        parte_f(base, g)
        parte_g(base)
        parte_h(base, g, fora)
        parte_i(base, g)
    finally:
        g.parar()
        fora.parar()
        for p in Instalacao.criadas:   # as junções do teste já saíram (os.rmdir); rmtree não segue junção
            shutil.rmtree(p, ignore_errors=True)
    ok = sum(1 for _, p, _ in casos if p)
    print(f"{ok}/{len(casos)} ok")
    return 0 if ok == len(casos) else 1


# ---------- (a) sucesso ----------

def parte_a(base, g):
    g.limpar()
    publicar(g)
    g.redir = "dentro"
    inst = Instalacao(base)
    reinicios = []
    fase = {"v": "None"}
    at = novo_at(inst, g, fase=lambda: fase["v"], reiniciar=lambda: reinicios.append(time.monotonic()))
    t0 = time.monotonic()
    st, est = rodar(at)
    p, c = inst.fotos()
    caso("(a) POST 202 e estado final 'pronto' com reiniciar", st == 202 and est["estado"] == "pronto" and est["reiniciar"]
         and est["versao"] == "0.2.0" and est["instalada"] == "0.1.0", (st, est))
    caso("(a) plugin igual ao zip novo (velho.js saiu, novo.js entrou)", p == esperado(PLUGIN_NOVO), sorted(p))
    caso("(a) complemento igual ao zip novo + dados/ intacto (banco, log e calibração byte a byte)",
         c == esperado({**COMP_NOVO, **DADOS}), sorted(c))
    caso("(a) .atualizacao/anterior guarda a versão velha (plugin e complemento sem dados/), .atualizacao/nova apagada",
         arvore(inst.plug / ".atualizacao" / "anterior") == ANTES_PLUGIN
         and arvore(inst.comp / ".atualizacao" / "anterior") == esperado(COMP_VELHO)
         and not (inst.plug / ".atualizacao" / "nova").exists() and not (inst.comp / ".atualizacao" / "nova").exists())
    downloads = [h for h in g.hits if "/releases/download/" in h]
    blobs = [h for h in g.hits if h.startswith("/blob/")]
    caso("(a) 1 GET do release por tag, 3 downloads (2 zips + SHA256SUMS), cada um seguindo o 302 dentro da origem",
         sum(1 for h in g.hits if "/releases/tags/v0.2.0" in h) == 1 and len(downloads) == 3 and len(blobs) == 3, g.hits)
    time.sleep(0.6)
    caso("(a) reinício pedido 1 vez, depois do 'pronto' segurado (>= 0,2 s)", len(reinicios) == 1 and reinicios[0] - t0 >= 0.2,
         reinicios)
    st2, est2 = at.pedir("0.2.0")
    caso("(a) 2º POST depois do pronto: 409 com o estado 'pronto' (nada roda de novo)", st2 == 409 and est2["estado"] == "pronto")

    # a fila andou nos SEGURAR_S do 'pronto' (troca já feita): reinicia logo assim mesmo. Esperar o lobby deixaria o processo
    # velho rodando a partida inteira em cima dos arquivos novos (import tardio mistura versões; revisão adversarial da P3)
    g.limpar()
    publicar(g)
    inst = Instalacao(base)
    reinicios = []
    fase = {"v": "Lobby"}
    at = novo_at(inst, g, fase=lambda: fase["v"], reiniciar=lambda: reinicios.append(fase["v"]))
    st, est = at.pedir("0.2.0")
    at.thread.join(30)
    fase["v"] = "ChampSelect"     # entrou na fila (personalizada) logo depois do 'pronto'
    time.sleep(0.8)
    caso("(a) fila andou durante o 'pronto' segurado: reinicia logo depois dele, sem esperar o lobby",
         at.estado()["estado"] == "pronto" and reinicios == ["ChampSelect"], reinicios)

    # 2º POST com a troca em curso: 409 com o estado de agora
    g.limpar()
    publicar(g)
    g.atraso = 0.4
    inst = Instalacao(base)
    at = novo_at(inst, g)
    st1, _ = at.pedir("0.2.0")
    st2, est2 = at.pedir("0.2.0")
    at.thread.join(30)
    caso("(a) 2º POST com a troca em curso: 409 com 'baixando' (uma troca por vez)", st1 == 202 and st2 == 409
         and est2["estado"] == "baixando" and at.estado()["estado"] == "pronto", (st1, st2, est2))


# ---------- (b) hash ----------

def parte_b(base, g):
    def linha_errada(rel, blobs, sums):
        sums["lol-ultra-client-plugin-0.2.0.zip"] = "0" * 64

    for nome, mexer, depois in (
            ("linha do plugin errada no SHA256SUMS", linha_errada, None),
            ("digest nulo no zip do complemento", None, lambda r: asset(r, "complemento").update(digest=None)),
            ("digest diferente do SHA256SUMS (zip do plugin)", None, lambda r: asset(r, "plugin").update(digest="sha256:" + "1" * 64)),
            ("SHA256SUMS.txt que não bate com o digest dele", None, lambda r: asset(r, "SHA256SUMS").update(digest="sha256:" + "2" * 64)),
            ("digest sem o prefixo sha256:", None, lambda r: asset(r, "plugin").update(digest=asset(r, "plugin")["digest"][7:]))):
        g.limpar()
        rel = publicar(g, mexer=mexer)
        if depois:
            depois(rel)
        inst = Instalacao(base)
        st, est = rodar(novo_at(inst, g))
        caso(f"(b) {nome}: erro 'hash', plugin e complemento intactos", est["estado"] == "erro" and est["motivo"] == "hash"
             and intacta(inst), est)
    # digest nulo: recusa antes de baixar qualquer zip
    g.limpar()
    rel = publicar(g)
    asset(rel, "plugin")["digest"] = None
    inst = Instalacao(base)
    rodar(novo_at(inst, g))
    caso("(b) digest nulo: nenhum download (recusa no JSON do release)", not [h for h in g.hits if "/download/" in h], g.hits)


# ---------- (c) queda ----------

def parte_c(base, g):
    g.limpar()
    publicar(g)
    g.cortar.add("lol-ultra-client-complemento-0.2.0.zip")
    inst = Instalacao(base)
    st, est = rodar(novo_at(inst, g))
    caso("(c) conexão cortada no meio do zip do complemento: erro 'rede', nada trocado", est["estado"] == "erro"
         and est["motivo"] == "rede" and intacta(inst), est)

    # arquivo preso no meio da troca: o plugin já trocou, o complemento falha no coletor/ -> tudo volta
    g.limpar()
    publicar(g)
    inst = Instalacao(base)
    preso = open(inst.comp / "coletor" / "coletor.py", "rb")   # noqa: SIM115 (fica aberto durante a troca)
    try:
        st, est = rodar(novo_at(inst, g))
    finally:
        preso.close()
    caso("(c) arquivo preso no complemento no meio da troca: erro 'troca' e a anterior devolvida (plugin inclusive)",
         est["estado"] == "erro" and est["motivo"] == "troca" and intacta(inst), (est, inst.fotos()))
    caso("(c) depois da falha, nada sobra na raiz: só os itens de antes e .atualizacao",
         sorted(os.listdir(inst.plug)) == sorted([".atualizacao", "atualizar.cmd", "index.js", "sub", "velho.js", "versao.js"]),
         os.listdir(inst.plug))
    # a mesma instalação, sem o arquivo preso: atualiza
    st, est = rodar(novo_at(inst, g))
    caso("(c) de novo, sem o arquivo preso: pronto", est["estado"] == "pronto" and inst.fotos()[0] == esperado(PLUGIN_NOVO), est)


# ---------- (d) recusas antes da rede ----------

def parte_d(base, g):
    def recusa(nome, inst, motivo, versao="0.2.0", fase="None", plugins=None):
        g.limpar()
        publicar(g)
        at = novo_at(inst, g, fase=lambda: fase)
        if plugins is not None:
            at._plugins = plugins
        st, est = at.pedir(versao)
        caso(f"(d) {nome}: 409 recusado '{motivo}', 0 pedido ao servidor, nada trocado", st == 409 and est["estado"] == "recusado"
             and est["motivo"] == motivo and g.hits == [] and intacta(inst), (st, est, g.hits))

    # junção no lugar do plugin (a instalação do mantenedor: plugins\lol-client -> pasta de trabalho)
    inst = Instalacao(base)
    alvo = inst.base / "trabalho" / "pengu"
    shutil.copytree(inst.plug, alvo)
    shutil.rmtree(inst.plug)
    r = subprocess.run(["cmd", "/c", "mklink", "/J", str(inst.plug), str(alvo)], capture_output=True)
    juncao = r.returncode == 0 and A.reparse(inst.plug)
    caso("(d) junção criada no temp (mklink /J)", juncao, r.stdout + r.stderr)
    if juncao:
        g.limpar()
        publicar(g)
        st, est = novo_at(inst, g).pedir("0.2.0")
        caso("(d) plugin que é junção: 409 'desenvolvimento', 0 pedido, o alvo da junção intacto",
             st == 409 and est["motivo"] == "desenvolvimento" and g.hits == [] and arvore(alvo) == ANTES_PLUGIN, (st, est))
        os.rmdir(inst.plug)   # só o link

    inst = Instalacao(base)
    (inst.comp / ".git").mkdir()
    recusa("complemento com .git (pasta de trabalho)", inst, "desenvolvimento")
    shutil.rmtree(inst.comp / ".git")
    (inst.plugins.parent / ".git").write_text("gitdir: x")
    recusa("plugin dentro de um repositório (.git numa pasta acima)", inst, "desenvolvimento")
    (inst.plugins.parent / ".git").unlink()
    for v in ("0.1.0", "0.0.9", "1.0", "v0.2.0", "../0.2.0", None, 3):
        recusa(f"versão {v!r}", inst, "versao", versao=v)
    for fase in ("Matchmaking", "ReadyCheck", "ChampSelect", "InProgress", "EndOfGame"):
        recusa(f"fase {fase}", inst, "partida", fase=fase)
    recusa("pasta plugins sem lol-ultra-client", inst, "sem-plugin", plugins=inst.base / "outra")
    recusa("Pengu não encontrado", inst, "sem-plugin", plugins=lambda: None)


# ---------- (e) origem e pacote ----------

def parte_e(base, g, fora):
    fora.limpar()
    publicar(fora)   # o de fora também tem os arquivos: se fosse acessado, a troca aconteceria
    g.limpar()
    rel = publicar(g)
    asset(rel, "complemento")["browser_download_url"] = f"{fora.base}/{REPO}/releases/download/v0.2.0/lol-ultra-client-complemento-0.2.0.zip"
    inst = Instalacao(base)
    st, est = rodar(novo_at(inst, g))
    caso("(e) URL do asset noutro host: erro 'origem', 0 acesso ao de fora, 0 download", est["motivo"] == "origem"
         and fora.hits == [] and not [h for h in g.hits if "/download/" in h] and intacta(inst), (est, fora.hits))

    fora.hits.clear()
    g.limpar()
    publicar(g)
    g.redir = fora.base
    inst = Instalacao(base)
    st, est = rodar(novo_at(inst, g))
    caso("(e) redirecionamento para fora da origem: erro 'origem', 0 acesso ao de fora", est["motivo"] == "origem"
         and fora.hits == [] and intacta(inst), (est, fora.hits))

    fora.hits.clear()
    for nome, kw in (("api de fora", {"api": "https://exemplo.com"}),
                     ("download de fora", {"download": "https://exemplo.com"}),
                     ("origem de fora", {"origens": ("https://exemplo.com",)}),
                     ("loopback em https", {"api": "https://127.0.0.1:8831"})):
        try:
            A.Atualizador(raiz=inst.comp, plugins=inst.plugins, **kw)
            caso(f"(e) origem trocada ({nome}): ValueError", False)
        except ValueError:
            caso(f"(e) origem trocada ({nome}): ValueError", True)
    padrao = A.Atualizador(raiz=inst.comp, plugins=inst.plugins)
    caso("(e) sem trocar nada: a origem fixa (api.github.com, github.com e os 2 hosts de asset do GitHub)",
         padrao.api == "https://api.github.com" and padrao.download == "https://github.com"
         and padrao.origens == ("https://github.com", "https://objects.githubusercontent.com",
                                "https://release-assets.githubusercontent.com"))

    for nome, arqs in (("zip com ../ (escapa da pasta)", {**PLUGIN_NOVO, "../../fora.js": b"x"}),
                       ("zip com caminho absoluto", {**PLUGIN_NOVO, "/abs.js": b"x"})):
        g.limpar()
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            for rel_, dados in arqs.items():
                z.writestr(rel_ if rel_.startswith("/") else f"lol-ultra-client/{rel_}", dados)
        ruim = buf.getvalue()

        def mexer(rel, blobs, sums, ruim=ruim):
            blobs["lol-ultra-client-plugin-0.2.0.zip"] = ruim
            sums["lol-ultra-client-plugin-0.2.0.zip"] = sha(ruim)
        publicar(g, mexer=mexer)
        inst = Instalacao(base)
        st, est = rodar(novo_at(inst, g))
        caso(f"(e) {nome} com hash certo: erro 'pacote', nada escrito fora, nada trocado", est["motivo"] == "pacote"
             and intacta(inst) and not (inst.plug.parent / "fora.js").exists() and not (inst.plug / "fora.js").exists(), est)
    g.limpar()
    publicar(g, comp={**COMP_NOVO, "dados/lol.db": b"banco de outra pessoa"})
    inst = Instalacao(base)
    st, est = rodar(novo_at(inst, g))
    caso("(e) zip do complemento que traz dados/: erro 'pacote', o banco de quem instalou intacto", est["motivo"] == "pacote"
         and intacta(inst), est)


# ---------- (f) rotas HTTP ----------

def parte_f(base, g):
    import servidor_local as S
    g.limpar()
    publicar(g)
    inst = Instalacao(base)
    at = novo_at(inst, g)
    porta = next(p for p in PORTAS if p != g.porta and _livre(p))
    srv = S.ServidorLocal(porta=porta, db=inst.base / "nao-existe.db", config=inst.base / "config.json")
    srv.rotas_post["/atualizar"] = at.rota_post
    srv.rotas_get["/atualizar/estado"] = at.rota_get
    if not srv.iniciar():
        caso("(f) servidor local de teste no ar", False, porta)
        return
    url = f"http://127.0.0.1:{porta}"
    try:
        _, ola = _req(f"{url}/ola")
        caso("(f) /ola anuncia 'atualizar' (rota pendurada)", "atualizar" in ola.get("recursos", []), ola)
        srv2 = S.ServidorLocal(porta=0, db=inst.base / "x.db", config=inst.base / "c.json")
        caso("(f) sem a rota pendurada, /ola não anuncia", "atualizar" not in srv2.recursos())
        for origem in ("https://evil.example", f"http://127.0.0.1:{porta}", "http://localhost:3000", "null"):
            st, d = _req(f"{url}/atualizar", {"versao": "0.2.0"}, origem)
            caso(f"(f) POST /atualizar com Origin {origem}: 403, nada começa", st == 403 and at.estado()["estado"] == "parado", (st, d))
        st, d = _req(f"{url}/atualizar", {"versao": "0.2.0"})
        caso("(f) POST /atualizar sem Origin (curl, outro processo): 403, nada começa, 0 pedido de rede",
             st == 403 and at.estado()["estado"] == "parado" and g.hits == [], (st, d, g.hits))
        st, d = _req(f"{url}/atualizar/estado")
        caso("(f) GET /atualizar/estado sem Origin (diagnóstico por curl): 200", st == 200 and d.get("estado") == "parado", (st, d))
        st, h = _req(f"{url}/atualizar", None, "https://plugins", metodo="OPTIONS")
        caso("(f) preflight do Pengu: 204", st == 204, st)
        st, d = _req(f"{url}/atualizar", "não é json", "https://plugins")
        caso("(f) corpo que não é JSON: 400", st == 400, (st, d))
        st, d = _req(f"{url}/atualizar", {"versao": "0.2.0"}, "https://plugins")
        caso("(f) POST com Origin https://plugins: 202 'baixando'", st == 202 and d.get("estado") == "baixando", (st, d))
        at.thread.join(30)
        st, d = _req(f"{url}/atualizar/estado", origem="https://127.0.0.1:51234")
        caso("(f) GET /atualizar/estado com Origin do client: 200 'pronto'", st == 200 and d.get("estado") == "pronto", (st, d))
        st, d = _req(f"{url}/atualizar/estado", origem="https://evil.example")
        caso("(f) GET /atualizar/estado com Origin de site: 403", st == 403, st)
    finally:
        srv.parar()


def _livre(p):
    import socket
    s = socket.socket()
    try:
        s.bind(("127.0.0.1", p))
        return True
    except OSError:
        return False
    finally:
        s.close()


def _req(url, corpo=None, origem=None, metodo=None):
    dados = None if corpo is None else (corpo.encode() if isinstance(corpo, str) else json.dumps(corpo).encode())
    req = urllib.request.Request(url, data=dados, method=metodo or ("POST" if dados is not None else "GET"))
    if dados is not None:
        req.add_header("Content-Type", "application/json")
    if origem:
        req.add_header("Origin", origem)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            b = r.read()
            return r.status, (json.loads(b) if b else {})
    except urllib.error.HTTPError as e:
        b = e.read()
        try:
            return e.code, json.loads(b) if b else {}
        except ValueError:
            return e.code, {}


# ---------- (g) coletor.py: reinício ----------

def parte_g(base):
    import asyncio
    import coletor as C
    cmd = C.comando_sucessor(["x\\coletor.py", "--ocioso-min", "inf", "--esperar-pid", "11", "--porta-painel", "8831"], 4242,
                             executavel="pythonw.exe")
    caso("(g) comando do sucessor: mesmos argumentos, sem o --esperar-pid antigo, com o desta instância",
         cmd[0] == "pythonw.exe" and cmd[1].endswith("coletor.py") and cmd[2:] == ["--ocioso-min", "inf", "--porta-painel", "8831",
                                                                                   "--esperar-pid", "4242"], cmd)
    # argv[0] relativo e a pasta atual mudada depois da partida (a troca sai das pastas: _sair_das_pastas faz chdir)
    pasta_atual = os.getcwd()
    outra = Path(tempfile.mkdtemp(prefix="luc-cwd-", dir=base))
    Instalacao.criadas.append(outra)
    os.chdir(outra)
    try:
        cmd_rel = C.comando_sucessor(["coletor.py", "--ocioso-min", "inf"], 7)
    finally:
        os.chdir(pasta_atual)
    caso("(g) argv[0] relativo ('coletor.py') e a pasta atual mudada: o sucessor aponta para o coletor.py que existe",
         Path(cmd_rel[1]).is_file() and Path(cmd_rel[1]).name == "coletor.py" and cmd_rel[2:] == ["--ocioso-min", "inf",
                                                                                                 "--esperar-pid", "7"], cmd_rel)
    filho = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(1.5)"], creationflags=0x08000000)
    t0 = time.monotonic()
    saiu = C.esperar_pid(filho.pid, limite_s=10, passo_s=0.05)
    dt = time.monotonic() - t0
    caso("(g) esperar_pid: volta quando o processo filho de mentira sai (~1,5 s)", saiu and 0.8 <= dt <= 6, round(dt, 2))
    filho2 = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"], creationflags=0x08000000)
    try:
        t0 = time.monotonic()
        nao = C.esperar_pid(filho2.pid, limite_s=0.5, passo_s=0.05)
        caso("(g) esperar_pid: processo que não sai = False no limite", not nao and time.monotonic() - t0 < 3)
    finally:
        filho2.terminate()   # o próprio filho deste teste, pelo handle (nunca pela porta)
        filho2.wait(10)

    # lancar_sucessor de verdade (flags do Windows aceitas: CREATE_NO_WINDOW, grupo próprio, fora do job se ele deixar)
    p = C.lancar_sucessor([sys.executable, "-c", "pass"])
    caso("(g) lancar_sucessor: sobe o processo solto (Popen) e ele termina com 0", p is not None and p.wait(30) == 0,
         getattr(p, "returncode", None))

    # pedir_saida: o rodar() devolve o motivo e marca reiniciar
    pasta = Path(tempfile.mkdtemp(prefix="luc-col-", dir=base))
    Instalacao.criadas.append(pasta)
    args = SimpleNamespace(lockfile=str(pasta / "sem-lockfile"), db=str(pasta / "lol.db"), ocioso_min=60)
    srv = SimpleNamespace(rotas_post={}, rotas_get={}, recursos_declarados=set())
    col = C.Coletor(args, coach=SimpleNamespace(srv=srv, servidor_no_ar=False), fab_aviso=lambda *a, **k: None)
    caso("(g) Coletor pendura POST /atualizar e GET /atualizar/estado no servidor do coach",
         "/atualizar" in srv.rotas_post and "/atualizar/estado" in srv.rotas_get and col.atualizador is not None)
    sem = C.Coletor(args, None)
    caso("(g) Coletor sem servidor (--sem-coach): sem atualizador", sem.atualizador is None)
    sem.c.close()
    threading.Timer(0.5, lambda: col.pedir_saida("atualizado: reiniciando", reiniciar=True)).start()
    t0 = time.monotonic()
    motivo = asyncio.run(asyncio.wait_for(col.rodar(), 15))
    caso("(g) pedir_saida de outra thread: rodar() devolve o motivo e reiniciar fica marcado",
         motivo == "atualizado: reiniciando" and col.reiniciar and time.monotonic() - t0 < 5, (motivo, col.reiniciar))
    col.c.close()


# ---------- (h) publico/atualizar.cmd ----------

def rodar_cmd(pasta_cmd, inst, g, extra=None, pagina=None):
    """pagina: página de código do console antes do .cmd (chcp; 65001 = UTF-8, a opção do Windows ou o terminal)"""
    env = {**os.environ, "LUC_API": g.base, "LUC_PLUGINS": str(inst.plugins), "LOCALAPPDATA": str(inst.local),
           "LUC_SEM_PAUSA": "1", **(extra or {})}
    arq = Path(pasta_cmd) / "atualizar.cmd"
    linha = f'cmd /c "chcp {pagina} >nul & "{arq}""' if pagina else ["cmd", "/c", str(arq)]
    antes = pagina_do_console() if pagina else None
    try:
        r = subprocess.run(linha, cwd=str(pasta_cmd), env=env, capture_output=True, timeout=120)
    finally:
        if antes:   # o chcp muda o console que este processo divide com os próximos .cmd: volta a de antes
            subprocess.run(f"cmd /c chcp {antes} >nul", capture_output=True)
    return r.returncode, (r.stdout + r.stderr).decode("utf-8" if pagina == "65001" else "cp850", "replace")


def pagina_do_console():
    """número da página de código ativa do console (chcp), ou None"""
    import re
    m = re.search(rb"(\d{3,5})", subprocess.run("cmd /c chcp", capture_output=True).stdout)
    return m.group(1).decode() if m else None


def parte_h(base, g, fora):
    g.limpar()
    publicar(g)
    g.redir = "dentro"
    inst = Instalacao(base)
    rc, out = rodar_cmd(inst.plug, inst, g)
    p, c = inst.fotos()
    caso("(h) cmd da pasta do plugin (pasta atual dentro dela): rc 0, 'Atualizado para a versão 0.2.0'",
         rc == 0 and "Atualizado para a versão 0.2.0" in out, (rc, out))
    caso("(h) cmd: plugin e complemento iguais aos zips, dados/ intacto, anterior guardada",
         p == esperado(PLUGIN_NOVO) and c == esperado({**COMP_NOVO, **DADOS})
         and arvore(inst.plug / ".atualizacao" / "anterior") == ANTES_PLUGIN, (sorted(p), sorted(c)))
    caso("(h) cmd: releases/latest 1 vez, 3 downloads pelo 302 dentro da origem",
         sum(1 for h in g.hits if h.endswith("/releases/latest")) == 1 and len([h for h in g.hits if h.startswith("/blob/")]) == 3,
         g.hits)
    rc, out = rodar_cmd(inst.plug, inst, g)
    caso("(h) cmd de novo, já na 0.2.0: rc 0, 'já é a mais nova', nada baixado", rc == 0 and "já é a mais nova" in out
         and len([h for h in g.hits if h.startswith("/blob/")]) == 3, (rc, out))

    g.limpar()
    publicar(g)
    inst = Instalacao(base)
    rc, out = rodar_cmd(inst.comp, inst, g)
    caso("(h) cmd da pasta do complemento (acha o plugin por LUC_PLUGINS): rc 0, os 2 trocados",
         rc == 0 and inst.fotos() == (esperado(PLUGIN_NOVO), esperado({**COMP_NOVO, **DADOS})), (rc, out))

    g.limpar()
    publicar(g)
    inst = Instalacao(base)
    shutil.rmtree(inst.comp.parent.parent.parent)   # sem complemento instalado: só o plugin
    rc, out = rodar_cmd(inst.plug, inst, g)
    caso("(h) cmd sem complemento instalado: só o plugin, sem baixar o zip do complemento", rc == 0
         and arvore(inst.plug) == esperado(PLUGIN_NOVO) and not [h for h in g.hits if "complemento" in h], (rc, out, g.hits))

    for nome, depois in (("digest nulo", lambda r: asset(r, "plugin").update(digest=None)),
                         ("digest diferente", lambda r: asset(r, "complemento").update(digest="sha256:" + "3" * 64)),
                         ("SHA256SUMS que não bate com o digest dele", lambda r: asset(r, "SHA256SUMS").update(digest="sha256:" + "4" * 64))):
        g.limpar()
        depois(publicar(g))
        inst = Instalacao(base)
        rc, out = rodar_cmd(inst.plug, inst, g)
        caso(f"(h) cmd, {nome}: rc 1 'não conferem', nada trocado", rc == 1 and "não conferem" in out and intacta(inst), (rc, out))

    def linha_errada(rel, blobs, sums):
        sums["lol-ultra-client-complemento-0.2.0.zip"] = "5" * 64
    g.limpar()
    publicar(g, mexer=linha_errada)
    inst = Instalacao(base)
    rc, out = rodar_cmd(inst.plug, inst, g)
    caso("(h) cmd, linha errada no SHA256SUMS: rc 1, nada trocado", rc == 1 and intacta(inst), (rc, out))

    g.limpar()
    publicar(g)
    g.cortar.add("lol-ultra-client-plugin-0.2.0.zip")
    inst = Instalacao(base)
    rc, out = rodar_cmd(inst.plug, inst, g)
    caso("(h) cmd, conexão cortada no meio do download: rc 1, nada trocado", rc == 1 and intacta(inst), (rc, out))

    g.limpar()
    publicar(g)
    inst = Instalacao(base)
    preso = open(inst.comp / "coletor" / "coletor.py", "rb")   # noqa: SIM115
    try:
        rc, out = rodar_cmd(inst.plug, inst, g)
    finally:
        preso.close()
    caso("(h) cmd, arquivo preso no complemento no meio da troca: rc 1 e a anterior devolvida (plugin inclusive)",
         rc == 1 and "continua instalada" in out and intacta(inst), (rc, out, inst.fotos()))

    inst = Instalacao(base)
    alvo = inst.base / "trabalho" / "pengu"
    shutil.copytree(inst.plug, alvo)
    shutil.rmtree(inst.plug)
    subprocess.run(["cmd", "/c", "mklink", "/J", str(inst.plug), str(alvo)], capture_output=True)
    g.limpar()
    publicar(g)
    rc2, out2 = rodar_cmd(inst.comp, inst, g)   # o cmd do complemento acha plugins\lol-ultra-client = junção
    caso("(h) cmd com o plugin numa junção: rc 2 'Instalação de desenvolvimento', 0 pedido, o alvo intacto",
         rc2 == 2 and "desenvolvimento" in out2 and g.hits == [] and arvore(alvo) == ANTES_PLUGIN, (rc2, out2, g.hits))
    os.rmdir(inst.plug)

    inst = Instalacao(base)
    (inst.comp / ".git").mkdir()
    g.limpar()
    publicar(g)
    rc, out = rodar_cmd(inst.plug, inst, g)
    caso("(h) cmd com o complemento numa pasta com .git: rc 2, 0 pedido, nada trocado", rc == 2 and "desenvolvimento" in out
         and g.hits == [] and arvore(inst.plug) == ANTES_PLUGIN, (rc, out))

    inst = Instalacao(base)
    (inst.comp / "dados" / "coletor.lock").write_text(str(os.getpid()))   # este python vivo = complemento em execução
    g.limpar()
    publicar(g)
    rc, out = rodar_cmd(inst.plug, inst, g)
    caso("(h) cmd com o complemento em execução (trava com pid vivo de python): rc 2, 0 pedido", rc == 2
         and "em execução" in out and g.hits == [] and arvore(inst.plug) == ANTES_PLUGIN, (rc, out))

    fora.limpar()
    publicar(fora)
    g.limpar()
    rel = publicar(g)
    asset(rel, "plugin")["browser_download_url"] = f"{fora.base}/{REPO}/releases/download/v0.2.0/lol-ultra-client-plugin-0.2.0.zip"
    inst = Instalacao(base)
    rc, out = rodar_cmd(inst.plug, inst, g)
    caso("(h) cmd, URL do asset noutro host: rc 1, 0 acesso ao de fora", rc == 1 and "endereço oficial" in out and fora.hits == []
         and intacta(inst), (rc, out, fora.hits))
    g.limpar()
    publicar(g)
    g.redir = fora.base
    inst = Instalacao(base)
    rc, out = rodar_cmd(inst.plug, inst, g)
    caso("(h) cmd, redirecionamento para fora: rc 1, 0 acesso ao de fora", rc == 1 and fora.hits == [] and intacta(inst),
         (rc, out, fora.hits))

    g.limpar()
    inst = Instalacao(base)
    rc, out = rodar_cmd(inst.plug, inst, g, {"LUC_API": "https://api.github.com"})
    caso("(h) cmd com LUC_API fora de loopback: rc 2, nada pedido", rc == 2 and g.hits == [] and intacta(inst), (rc, out))

    # o .cmd que vai no pacote: tudo na 1ª linha, que sai nela mesma (P4, 19/10/2026: com o console na página de código UTF-8
    # o cmd errava o deslocamento da 2ª linha num arquivo com acento e executava pedaços do PowerShell como lote, rc 255)
    texto = CMD.decode("utf-8")
    cab = texto.split("#PS-INICIO#")[0]
    l1 = cab.splitlines()[0].strip().lower()
    caso("(h) cabeçalho do .cmd só ASCII, sem rótulo nem goto; a 1ª linha faz tudo (LUC_CMD, cd para o TEMP, PowerShell) e sai "
         "nela (call exit /b %%errorlevel%%), sem EnableDelayedExpansion ('!' no caminho sobrevive)",
         cab.isascii() and ":" not in "".join(l[:1] for l in cab.splitlines()) and "goto" not in cab.lower()
         and l1.startswith('@echo off & setlocal & set "luc_cmd=%~f0" & cd /d "%temp%" & powershell ')
         and l1.endswith("& call exit /b %%errorlevel%%") and "enabledelayedexpansion" not in cab.lower(), cab)

    g.limpar()
    publicar(g)
    g.redir = "dentro"
    inst = Instalacao(base)
    rc, out = rodar_cmd(inst.plug, inst, g, pagina="65001")
    p, c = inst.fotos()
    caso("(h) cmd com o console na página de código UTF-8 (chcp 65001): rc 0 e os 2 trocados (antes: rc 255, pedaços do "
         "PowerShell rodando como lote)", rc == 0 and "Atualizado para a versão 0.2.0" in out and p == esperado(PLUGIN_NOVO)
         and c == esperado({**COMP_NOVO, **DADOS}), (rc, out[-600:]))
    g.limpar()
    inst = Instalacao(base)
    rc, out = rodar_cmd(inst.plug, inst, g, {"LUC_API": "https://api.github.com"}, pagina="65001")
    caso("(h) cmd na página UTF-8 com recusa (LUC_API fora de loopback): o código de saída 2 chega ao chamador",
         rc == 2 and g.hits == [] and intacta(inst), (rc, out[-300:]))


# ---------- (i) revisão adversarial da P3 (19/10/2026) ----------

def sem_nova(inst):
    return not (inst.plug / ".atualizacao" / "nova").exists() and not (inst.comp / ".atualizacao" / "nova").exists()


def parte_i(base, g):
    # achados 1 e 5: a fila andou durante o download -> nada troca (o processo velho não roda a partida em cima de arquivo novo)
    g.limpar()
    publicar(g)
    inst = Instalacao(base)
    fase = {"v": "Lobby"}
    reinicios = []
    g.gancho = lambda p: fase.update(v="ChampSelect") if "/releases/download/" in p else None
    at = novo_at(inst, g, fase=lambda: fase["v"], reiniciar=lambda: reinicios.append(1))
    st, est = rodar(at)
    time.sleep(0.4)
    caso("(i) fila andou durante o download (Lobby -> ChampSelect): erro 'partida', 0 item trocado, nova/ apagada, 0 reinício",
         st == 202 and est["estado"] == "erro" and est["motivo"] == "partida" and intacta(inst) and sem_nova(inst)
         and reinicios == [], (st, est, reinicios))

    # achado 7: extração que falha no meio (o plugin já extraído, o complemento esbarra num arquivo e numa pasta de mesmo nome)
    g.limpar()
    publicar(g, comp={**COMP_NOVO, "sub": b"arquivo", "sub/a.py": b"pasta com o mesmo nome"})
    inst = Instalacao(base)
    st, est = rodar(novo_at(inst, g))
    caso("(i) extração que falha no meio do complemento: erro 'pacote', nada trocado, nenhuma .atualizacao/nova sobrando",
         est["estado"] == "erro" and est["motivo"] == "pacote" and intacta(inst) and sem_nova(inst), est)

    # achado 8: troca que não volta inteira -> a marca fica e a 2ª tentativa recusa antes de apagar a única cópia velha
    g.limpar()
    publicar(g)
    inst = Instalacao(base)
    ant_plug = inst.plug / ".atualizacao" / "anterior"

    def mover_ruim(de, para):
        d = Path(de)
        if d == inst.comp / "coletor":
            raise OSError("preso (teste)")
        if d.parent == ant_plug and d.name == "index.js":
            raise OSError("não volta (teste)")
        os.rename(de, para)
    at = novo_at(inst, g)
    at.mover = mover_ruim
    st, est = rodar(at)
    marca = inst.plug / ".atualizacao" / "troca-em-curso"
    caso("(i) troca que não volta inteira: erro 'troca-incompleta', a marca troca-em-curso fica",
         est["motivo"] == "troca-incompleta" and marca.exists(), (est, marca.exists()))
    g.hits.clear()
    st2, est2 = rodar(novo_at(inst, g))
    caso("(i) 2ª tentativa depois da troca incompleta: 409 'troca-incompleta' antes da rede, anterior/ (a única cópia) intacta",
         st2 == 409 and est2["motivo"] == "troca-incompleta" and g.hits == []
         and (ant_plug / "index.js").exists() and (ant_plug / "index.js").read_bytes() == b"// velho", (st2, est2, g.hits))

    # achado 2: complemento que é junção, com o atualizar.py importado pelo caminho do link (o caminho de produção)
    inst = Instalacao(base)
    alvo = inst.base / "fora-do-git" / "complemento"
    shutil.copytree(inst.comp, alvo)
    shutil.copy2(RAIZ / "coletor" / "atualizar.py", alvo / "coletor" / "atualizar.py")
    shutil.rmtree(inst.comp)
    r = subprocess.run(["cmd", "/c", "mklink", "/J", str(inst.comp), str(alvo)], capture_output=True)
    if r.returncode == 0 and A.reparse(inst.comp):
        spec = importlib.util.spec_from_file_location("atualizar_pelo_link", inst.comp / "coletor" / "atualizar.py")
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        antes = arvore(alvo)   # depois do import (o __pycache__ dele entra no alvo)
        g.limpar()
        publicar(g)
        at = mod.Atualizador(plugins=inst.plugins, fase=lambda: "None", api=g.base, download=g.base, origens=(g.base,),
                             segurar_s=0.2)
        st, est = at.pedir("0.2.0")
        if st == 202:
            at.thread.join(30)
        caso("(i) complemento numa junção, importado pelo link: RAIZ = o link, 409 'desenvolvimento', 0 pedido, alvo intacto",
             mod.RAIZ == inst.comp and st == 409 and est["motivo"] == "desenvolvimento" and g.hits == [] and arvore(alvo) == antes,
             (str(mod.RAIZ), st, est, g.hits))
        os.rmdir(inst.comp)   # só o link
    else:
        caso("(i) junção do complemento criada no temp", False, r.stdout + r.stderr)

    # achado 4: .git na pasta do usuário (repositório de dotfiles) não faz da instalação comum uma de desenvolvimento
    casa = os.environ.get("USERPROFILE")
    try:
        inst = Instalacao(base)
        os.environ["USERPROFILE"] = str(inst.base)
        (inst.base / ".git").mkdir()
        g.limpar()
        publicar(g)
        st, est = rodar(novo_at(inst, g))
        caso("(i) .git na pasta do usuário (dotfiles): não é desenvolvimento, atualiza", est["estado"] == "pronto", est)
        inst = Instalacao(base)
        os.environ["USERPROFILE"] = str(inst.base)
        (inst.local / ".git").mkdir()
        g.limpar()
        publicar(g)
        st, est = rodar(novo_at(inst, g))
        caso("(i) .git entre a pasta do usuário e o complemento: segue 'desenvolvimento'", st == 409
             and est["motivo"] == "desenvolvimento" and g.hits == [], est)
        caso("(i) a pasta de trabalho do mantenedor (fora da pasta do usuário, com .git) segue 'desenvolvimento'",
             A.desenvolvimento(RAIZ))
        inst = Instalacao(base)
        (inst.base / ".git").mkdir()
        g.limpar()
        publicar(g)
        rc, out = rodar_cmd(inst.plug, inst, g, {"USERPROFILE": str(inst.base)})
        caso("(i) cmd com .git na pasta do usuário: rc 0, os 2 trocados", rc == 0
             and inst.fotos() == (esperado(PLUGIN_NOVO), esperado({**COMP_NOVO, **DADOS})), (rc, out))
    finally:
        if casa is None:
            os.environ.pop("USERPROFILE", None)
        else:
            os.environ["USERPROFILE"] = casa

    # achado 10: o complemento sobe durante o download do .cmd -> recusa antes de trocar
    g.limpar()
    publicar(g)
    inst = Instalacao(base)
    trava = inst.comp / "dados" / "coletor.lock"
    g.gancho = lambda p: trava.write_text(str(os.getpid())) if "/releases/download/" in p and not trava.exists() else None
    rc, out = rodar_cmd(inst.plug, inst, g)
    subiu = trava.exists()
    trava.unlink(missing_ok=True)
    caso("(i) cmd: complemento subiu durante o download: rc 2 'em execução', nada trocado, nenhuma nova/ sobrando",
         subiu and rc == 2 and "em execução" in out and intacta(inst) and sem_nova(inst), (rc, out))

    # achado 7 no .cmd: extração que falha no meio
    g.limpar()
    publicar(g, comp={**COMP_NOVO, "sub": b"arquivo", "sub/a.py": b"pasta com o mesmo nome"})
    inst = Instalacao(base)
    rc, out = rodar_cmd(inst.plug, inst, g)
    caso("(i) cmd: extração que falha no meio: rc 1, nada trocado, nenhuma nova/ sobrando", rc == 1 and intacta(inst)
         and sem_nova(inst), (rc, out))

    # achado 8 no .cmd: a marca de troca incompleta (do botão ou do .cmd) recusa antes da rede
    g.limpar()
    publicar(g)
    inst = Instalacao(base)
    (inst.comp / ".atualizacao").mkdir()
    (inst.comp / ".atualizacao" / "troca-em-curso").write_text("x")
    rc, out = rodar_cmd(inst.plug, inst, g)
    caso("(i) cmd com a marca de troca incompleta no complemento: rc 1 'parou no meio', 0 pedido, nada trocado",
         rc == 1 and "parou no meio" in out and g.hits == [] and intacta(inst), (rc, out, g.hits))

    # achado 11: '!' no caminho (EnableDelayedExpansion comeria o '!' do LUC_CMD)
    exclamacao = Path(tempfile.mkdtemp(prefix="luc!-", dir=base))
    Instalacao.criadas.append(exclamacao)
    g.limpar()
    publicar(g)
    inst = Instalacao(exclamacao)
    rc, out = rodar_cmd(inst.plug, inst, g)
    caso("(i) cmd numa pasta com '!' no caminho: rc 0, os 2 trocados", rc == 0
         and inst.fotos() == (esperado(PLUGIN_NOVO), esperado({**COMP_NOVO, **DADOS})), (rc, out))
    g.gancho = None


if __name__ == "__main__":
    sys.exit(principal())
