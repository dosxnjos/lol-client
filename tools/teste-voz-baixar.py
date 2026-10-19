# Prova do botão "baixar vozes" do lado do complemento (coletor/voz_pacote.py; P5 de
# roadmap/2026-10-19-publicacao-e-complemento-publico.md). Nada aqui fala com o GitHub nem com o client: um servidor de release
# falso em 127.0.0.1:8831-8840 faz o papel do GitHub e um segundo na mesma faixa é "o de fora" (conta acessos: fica em 0).
# LOCALAPPDATA apontado para o temp ANTES de importar o voz.py: o pacote de voz de verdade nunca é lido nem tocado.
#   (a) sucesso: sem pacote -> baixar (tamanho pela consulta do GET /voz/estado), pasta igual ao zip byte a byte, progresso em
#       bytes; pacote público velho -> atualizar, o velho em <pacote>.anterior
#   (b) hash: linha errada no SHA256SUMS, digest nulo, digest diferente, SHA256SUMS que não bate com o digest dele
#   (c) zip com ..\ e ../, caminho absoluto, índice que cita "..\x.wav", arquivo fora do índice, índice de outra versão ou sem
#       origem release: nada escrito fora, pacote de antes intacto, nenhuma .nova sobrando
#   (d) queda no meio do download (conexão cortada): erro rede, intacto
#   (e) troca: pasta presa por um arquivo aberto (fala tocando) espera e troca quando solta; presa para sempre = erro troca com o
#       de antes no lugar; 2º rename que falha devolve o anterior; queda entre os dois renames se recupera na próxima vez
#   (f) fala em curso: um voz.Voz falando do pacote quando a troca cai: a fala termina inteira e a seguinte já sai do pacote novo
#   (g) recusas antes da rede: desenvolvimento (.git, junção), pacote gerado aqui (sem origem release), fora de None/Lobby, em dia
#   (h) origem: URL do asset noutro host e redirecionamento para fora (o de fora com 0 acessos); origem trocada fora de loopback
#   (i) rotas num ServidorLocal de verdade (porta 0): /ola anuncia "voz-pacote", POST sem Origin e com Origin de site = 403,
#       Origin do Pengu = aceito; GET /voz/estado; coletor.py pendura as 2 rotas
# uso: python tools/teste-voz-baixar.py
import hashlib
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
BASE = Path(tempfile.mkdtemp(prefix="teste-voz-baixar-"))
os.environ["LOCALAPPDATA"] = str(BASE / "local")   # antes do import: voz.PACOTES_DIR no temp
os.environ.pop("LOL_VOZ_PACOTE", None)
sys.path.insert(0, str(RAIZ / "coletor"))
import atualizar as A  # noqa: E402
import voz as V  # noqa: E402
import voz_pacote as VP  # noqa: E402

PORTAS = range(8831, 8841)
REPO = "dono/lol-ultra-client"
VER = "0123456789ab"            # versão do catálogo "do código" nos testes (esperada=)
VELHA = "aaaaaaaaaaaa"
NOME = f"voz-aoede-{VER}.zip"
VP.TENTATIVAS, VP.PAUSA_S = 30, 0.1   # 3 s de espera por rename no teste (10 s no complemento)
casos = []


def caso(nome, passou, detalhe=""):
    casos.append((nome, bool(passou), detalhe))
    print(("ok " if passou else "FALHOU ") + nome + ("" if passou else f"  [{detalhe}]"), flush=True)


assert str(V.PACOTES_DIR).startswith(str(BASE)), V.PACOTES_DIR


# ---------- servidores falsos ----------

class _H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        g = self.server.g
        g.hits.append(self.path)
        p = self.path.split("?")[0]
        if p == f"/repos/{REPO}/releases":
            return self._enviar(200, json.dumps(g.lista).encode(), "application/json")
        if p.startswith(f"/{REPO}/releases/download/"):
            nome = p.rsplit("/", 1)[1]
            if g.redir:
                self.send_response(302)
                self.send_header("Location", f"{g.redir}/blob/{nome}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            return self._blob(nome)
        if p.startswith("/blob/"):
            return self._blob(p.rsplit("/", 1)[1])
        self._enviar(404, b"{}")

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
        self._enviar(200, dados)

    def _enviar(self, cod, corpo, tipo="application/octet-stream"):
        self.send_response(cod)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)


class Falso:
    def __init__(self, ocupadas=()):
        self.limpar()
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
        self.lista, self.blobs, self.hits, self.cortar, self.redir = [], {}, [], set(), None

    def parar(self):
        self.srv.shutdown()
        self.srv.server_close()


def sha(b):
    return hashlib.sha256(b).hexdigest()


def zipar(arquivos, prefixo="aoede"):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for rel, dados in sorted(arquivos.items()):
            zi = zipfile.ZipInfo(f"{prefixo}/{rel}" if prefixo else rel)
            zi.filename = f"{prefixo}/{rel}" if prefixo else rel   # o ZipInfo troca "\" por "/" no Windows: o "..\" fica cru
            zi.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(zi, dados)
    return buf.getvalue()


def nomes_no_zip(z):
    with zipfile.ZipFile(io.BytesIO(z)) as zz:
        return zz.namelist()


def wav(t):
    return b"RIFF" + t.encode() * 400


def pacote_publico(versao=VER, falas=None, origem="release"):
    falas = falas or {"gank no top": "a1.wav", "mid sumiu": "a2.wav"}
    ind = {"voz": "aoede", "versao_catalogo": versao, "modelo": "m", "frases": {f: {"arquivo": a} for f, a in falas.items()}}
    if origem:
        ind["origem"] = origem
    arqs = {"indice.json": json.dumps(ind, ensure_ascii=False).encode()}
    for f, a in falas.items():
        arqs[a] = wav(f + versao)
    return arqs


NOVO = pacote_publico()


def publicar(g, arquivos=None, zip_bytes=None, tag="v0.2.0", mexer=None, base_download=None, outros=()):
    """lista de releases falsa: o release `tag` com o zip da voz e o SHA256SUMS (+ releases sem voz mais novos em `outros`)"""
    z = zip_bytes if zip_bytes is not None else zipar(arquivos or NOVO)
    blobs = {NOME: z, "lol-ultra-client-plugin-0.2.0.zip": b"PK-plugin"}
    sums = {n: sha(b) for n, b in blobs.items()}
    rel = {"tag_name": tag, "draft": False, "prerelease": False, "assets": []}
    if mexer:
        mexer(rel, blobs, sums)
    blobs["SHA256SUMS.txt"] = "".join(f"{h}  {n}\n" for n, h in sorted(sums.items())).encode()
    base = base_download or g.base
    for n, b in blobs.items():
        rel["assets"].append({"name": n, "size": len(b), "digest": f"sha256:{sha(b)}",
                              "browser_download_url": f"{base}/{REPO}/releases/download/{tag}/{n}"})
    g.blobs.update(blobs)
    # releases mais novos sem o zip da voz (o catálogo não mudou neles), um rascunho com o nome certo, e o nosso
    g.lista = [{"tag_name": t, "draft": False, "prerelease": False, "assets": [{"name": "SHA256SUMS.txt"}]} for t in outros]
    g.lista.append({"tag_name": "v9.9.9", "draft": True, "prerelease": False, "assets": [{"name": NOME}]})
    g.lista.append(rel)
    return rel


class Inst:
    """complemento falso (pengu/versao.js com o REPO) e a pasta de pacotes, no temp"""
    n = 0

    def __init__(self, antes=None):
        Inst.n += 1
        self.base = BASE / f"i{Inst.n}"
        self.comp = self.base / "complemento"
        (self.comp / "pengu").mkdir(parents=True)
        (self.comp / "pengu" / "versao.js").write_text(f"export const VERSAO = '0.2.0';\nexport const REPO = '{REPO}';\n",
                                                       encoding="utf-8")
        self.pacotes = self.base / "pacotes"
        self.pacotes.mkdir(parents=True)
        if antes is not None:
            escrever_pasta(self.pacotes / "aoede", antes)

    def foto(self):
        return arvore(self.pacotes)


def escrever_pasta(p, arqs):
    for rel, d in arqs.items():
        f = Path(p) / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(d)


def arvore(p):
    saida = {}
    for raiz, _d, arqs in os.walk(p):
        for a in arqs:
            f = Path(raiz) / a
            saida[f.relative_to(p).as_posix()] = sha(f.read_bytes())
    return saida


def esperado(arqs, prefixo="aoede"):
    return {f"{prefixo}/{k}": sha(v) for k, v in arqs.items()}


def novo(inst, g, fase=lambda: "None", **kw):
    return VP.PacoteVoz(raiz=inst.comp, pacotes=inst.pacotes, fase=fase, api=g.base, download=g.base, origens=(g.base,),
                        esperada=VER, **kw)


def rodar(pv, limite=30):
    st, _ = pv.pedir()
    if st == 202:
        pv.thread.join(limite)
    return st, pv.estado()


VELHO = pacote_publico(VELHA, {"gank no top": "v1.wav"})


# ---------- (a) sucesso ----------

def parte_a(g):
    g.limpar()
    rel = publicar(g, outros=("v0.3.0", "v0.2.1"))
    inst = Inst()
    pv = novo(inst, g)
    e0 = pv.estado()
    caso("(a) sem pacote: acao baixar, nada instalado, esperada = a do código", e0["acao"] == "baixar"
         and e0["instalada"] is None and e0["esperada"] == VER and not g.hits, e0)
    st, e = pv.rota_get("/voz/estado")
    pv.thread.join(10)
    e2 = pv.estado()
    tam = next(a["size"] for a in rel["assets"] if a["name"] == NOME)
    caso("(a) GET /voz/estado consulta a lista 1 vez e traz o tamanho do zip e a tag do release que tem a voz (pula os sem voz "
         "e o rascunho)", st == 200 and e2["disponivel"] == {"versao": VER, "tag": "v0.2.0", "tamanho": tam}
         and [h.split("?")[0] for h in g.hits] == [f"/repos/{REPO}/releases"] and "per_page=100" in g.hits[0], (e2, g.hits))
    pv.rota_get("/voz/estado")
    caso("(a) 2º GET /voz/estado não consulta de novo", len(g.hits) == 1, g.hits)
    g.hits.clear()
    st, e = rodar(pv)
    caso("(a) POST: 202 e pronto", st == 202 and e["estado"] == "pronto", e)
    caso("(a) pasta do pacote = zip byte a byte", inst.foto() == esperado(NOVO), inst.foto())
    caso("(a) instalada = versão do código, 2 falas, do release; acao nada", e["instalada"] == {"versao": VER, "falas": 2,
                                                                                            "release": True}
         and e["acao"] == "nada", e)
    caso("(a) progresso em bytes até o tamanho do zip", e["baixados"] == tam and e["total"] == tam, e)
    caso("(a) 1 lista + SHA256SUMS + zip, nada mais", [h.split("?")[0] for h in g.hits] == [
        f"/repos/{REPO}/releases", f"/{REPO}/releases/download/v0.2.0/SHA256SUMS.txt",
        f"/{REPO}/releases/download/v0.2.0/{NOME}"], g.hits)
    p = V.Pacote(inst.pacotes / "aoede")
    caso("(a) voz.Pacote abre o pacote baixado e acha a fala", p.arquivo("gank no top") == inst.pacotes / "aoede" / "a1.wav"
         and p.versao == VER, p.frases)
    st, e = rodar(pv)
    caso("(a) de novo com o pacote em dia: 409 em-dia, 0 pedido", st == 409 and e["motivo"] == "em-dia"
         and len(g.hits) == 3, e)
    # atualizar: pacote público velho
    inst2 = Inst(VELHO)
    pv2 = novo(inst2, g)
    caso("(a) pacote público velho: acao atualizar", pv2.estado()["acao"] == "atualizar", pv2.estado())
    st, e = rodar(pv2)
    caso("(a) atualizar: pronto, o novo no lugar e o velho em aoede.anterior",
         e["estado"] == "pronto" and inst2.foto() == {**esperado(NOVO), **esperado(VELHO, "aoede.anterior")}, inst2.foto())


# ---------- (b) hash ----------

def parte_b(g):
    def linha_errada(rel, blobs, sums):
        sums[NOME] = "0" * 64

    def digest_nulo(rel, blobs, sums):
        rel["_nulo"] = True

    def digest_outro(rel, blobs, sums):
        rel["_outro"] = True

    for nome, mexer in (("linha errada no SHA256SUMS", linha_errada), ("digest nulo", digest_nulo),
                        ("digest diferente", digest_outro), ("SHA256SUMS que não bate com o digest dele", "sums")):
        g.limpar()
        rel = publicar(g, mexer=mexer if callable(mexer) else None)
        a = next(x for x in rel["assets"] if x["name"] == NOME)
        if rel.pop("_nulo", None):
            a["digest"] = None
        if rel.pop("_outro", None):
            a["digest"] = "sha256:" + "1" * 64
        if mexer == "sums":
            g.blobs["SHA256SUMS.txt"] = g.blobs["SHA256SUMS.txt"] + b"\n"
        inst = Inst(VELHO)
        antes = inst.foto()
        st, e = rodar(novo(inst, g))
        baixou_zip = any(h.endswith(NOME) for h in g.hits)
        caso(f"(b) {nome}: erro hash, pacote de antes intacto, nenhuma .nova",
             e["estado"] == "erro" and e["motivo"] == "hash" and inst.foto() == antes
             and not (inst.pacotes / "aoede.nova").exists()
             and (not baixou_zip if nome == "digest nulo" else True), (e, g.hits))


# ---------- (c) zip ruim ----------

def parte_c(g):
    ruins = {
        "zip com ..\\": zipar({**NOVO, "..\\fora.wav": b"x"}),
        "zip com ../": zipar({**NOVO, "../fora.wav": b"x"}),
        "zip com caminho absoluto": zipar({"aoede/indice.json": NOVO["indice.json"], "C:/fora.wav": b"x"}, prefixo=""),
        "índice que cita ..\\x.wav": zipar({"indice.json": json.dumps({"voz": "aoede", "versao_catalogo": VER,
                                                                       "origem": "release", "frases": {
                                                                           "gank": {"arquivo": "..\\a1.wav"}}}).encode(),
                                           "a1.wav": b"x"}),
        "arquivo fora do índice": zipar({**NOVO, "extra.exe": b"MZ"}),
        "índice de outra versão": zipar(pacote_publico(VELHA)),
        "índice sem origem release": zipar(pacote_publico(origem=None)),
        "zip de outra pasta-raiz": zipar(NOVO, prefixo="maria"),
    }
    # o zipfile do Windows lê "..\" como "../" (ZipInfo troca os.sep): o nome cru no arquivo é a contrabarra mesmo
    caso("(c) o zip com ..\\ leva a contrabarra crua nos bytes do nome", b"aoede/..\\fora.wav" in ruins["zip com ..\\"]
         and "aoede/../fora.wav" in nomes_no_zip(ruins["zip com ..\\"]), nomes_no_zip(ruins["zip com ..\\"]))
    for nome, z in ruins.items():
        g.limpar()
        publicar(g, zip_bytes=z)
        inst = Inst(VELHO)
        antes = inst.foto()
        st, e = rodar(novo(inst, g))
        fora = [p for p in inst.base.rglob("fora.wav")] + list(BASE.glob("fora.wav")) + list(Path("C:/").glob("fora.wav"))
        caso(f"(c) {nome}: erro pacote, intacto, nada escrito fora, nenhuma .nova",
             e["estado"] == "erro" and e["motivo"] == "pacote" and inst.foto() == antes and not fora
             and not (inst.pacotes / "aoede.nova").exists(), (e, inst.foto().keys() - antes.keys()))


# ---------- (d) queda ----------

def parte_d(g):
    g.limpar()
    publicar(g)
    g.cortar = {NOME}
    inst = Inst(VELHO)
    antes = inst.foto()
    st, e = rodar(novo(inst, g))
    caso("(d) conexão cortada no meio do zip: erro rede, intacto, nenhuma .nova", e["estado"] == "erro"
         and e["motivo"] == "rede" and inst.foto() == antes and not (inst.pacotes / "aoede.nova").exists(), e)
    g.cortar = set()
    st, e = rodar(novo(inst, g))
    caso("(d) de novo sem a queda: pronto", e["estado"] == "pronto" and inst.foto().keys() >= esperado(NOVO).keys(), e)


# ---------- (e) troca ----------

def segurar(arquivo, s):
    """abre o arquivo (como o tocador de uma fala) e solta depois de s segundos (None = até soltar.set())"""
    soltar = threading.Event()
    pronto = threading.Event()

    def f():
        with open(arquivo, "rb"):
            pronto.set()
            soltar.wait(s)
    t = threading.Thread(target=f, daemon=True)
    t.start()
    pronto.wait(5)
    return soltar, t


def parte_e(g):
    g.limpar()
    publicar(g)
    inst = Inst(VELHO)
    soltar, t = segurar(inst.pacotes / "aoede" / "v1.wav", 0.35)
    t0 = time.monotonic()
    st, e = rodar(novo(inst, g))
    dt = time.monotonic() - t0
    caso("(e) arquivo aberto na pasta (fala tocando) por 0,35 s: espera e troca", e["estado"] == "pronto"
         and inst.foto() == {**esperado(NOVO), **esperado(VELHO, "aoede.anterior")} and dt >= 0.3, (e, dt))
    t.join(2)

    inst = Inst(VELHO)
    antes = inst.foto()
    soltar, t = segurar(inst.pacotes / "aoede" / "v1.wav", None)
    st, e = rodar(novo(inst, g))
    soltar.set()
    t.join(2)
    caso("(e) arquivo aberto o tempo todo: erro troca, o de antes no lugar, nenhuma .nova", e["estado"] == "erro"
         and e["motivo"] == "troca" and inst.foto() == antes, (e, inst.foto().keys()))

    inst = Inst(VELHO)
    antes = inst.foto()
    pv = novo(inst, g)
    chamadas = []

    def mover(de, para):
        chamadas.append(Path(para).name)
        if Path(de).name == "aoede.nova":
            raise OSError("disco")
        os.rename(de, para)
    pv.mover = mover
    st, e = rodar(pv)
    caso("(e) 2º rename falha: o anterior volta, erro troca", e["estado"] == "erro" and e["motivo"] == "troca"
         and inst.foto() == antes and chamadas == ["aoede.anterior", "aoede", "aoede"], (e, chamadas))

    # queda do processo entre os dois renames: aoede sumiu, aoede.anterior inteira, .nova solta
    inst = Inst()
    escrever_pasta(inst.pacotes / "aoede.anterior", VELHO)
    escrever_pasta(inst.pacotes / "aoede.nova", NOVO)
    pv = novo(inst, g)
    caso("(e) queda entre os dois renames: o próximo PacoteVoz devolve o anterior e apaga a .nova",
         inst.foto() == esperado(VELHO) and pv.estado()["instalada"]["versao"] == VELHA, inst.foto())


# ---------- (f) fala em curso ----------

def parte_f(g):
    g.limpar()
    publicar(g, arquivos=pacote_publico(VER, {"gank no top": "n1.wav", "mid sumiu": "n2.wav"}))
    inst = Inst(pacote_publico(VELHA, {"gank no top": "v1.wav", "mid sumiu": "v2.wav"}))
    tocados = []
    comecou = threading.Event()

    def tocar(arq, corte):   # segura o .wav aberto pela duração, como um tocador de verdade faria
        with open(arq, "rb") as f:
            dados = f.read()
            comecou.set()
            interrompida = corte.wait(0.8)
        tocados.append((Path(arq).parent.name, Path(arq).name, dados[:4], interrompida))

    voz = V.Voz(saida=lambda t: tocados.append(("maria", t)), pacote=V.Pacote(inst.pacotes / "aoede"), tocar=tocar,
                faltou=inst.base / "faltou.jsonl", validade_s=30)
    voz.falar("gank no top")
    comecou.wait(5)
    pv = novo(inst, g, fase=lambda: "InProgress")   # a fila andou durante o download: a troca cai na partida
    t0 = time.monotonic()
    pv.executar()
    dt = time.monotonic() - t0
    voz.falar("mid sumiu")
    voz.esperar(10)
    voz.parar()
    caso("(f) fala em curso termina inteira (sem corte) e do pacote velho", tocados[:1] == [("aoede", "v1.wav", b"RIFF", False)],
         tocados)
    caso("(f) a troca esperou a fala soltar o arquivo", dt >= 0.3 and inst.foto().keys() >= esperado(
        pacote_publico(VER, {"gank no top": "n1.wav", "mid sumiu": "n2.wav"})).keys(), dt)
    caso("(f) a fala seguinte já sai do pacote novo (voz.Pacote.relido)", tocados[1:] == [("aoede", "n2.wav", b"RIFF", False)],
         tocados)


# ---------- (g) recusas antes da rede ----------

def parte_g(g):
    g.limpar()
    publicar(g)
    inst = Inst()
    (inst.comp / ".git").mkdir()
    st, e = rodar(novo(inst, g))
    caso("(g) complemento numa pasta com .git: 409 desenvolvimento, 0 pedido, acao nada, GET não consulta",
         st == 409 and e["motivo"] == "desenvolvimento" and e["acao"] == "nada" and not g.hits, e)
    novo(inst, g).rota_get("/voz/estado")
    caso("(g) GET /voz/estado na instalação de desenvolvimento: 0 pedido", not g.hits, g.hits)

    inst = Inst()
    alvo = inst.base / "alvo"
    alvo.mkdir()
    shutil.rmtree(inst.pacotes)
    subprocess.run(["cmd", "/c", "mklink", "/J", str(inst.pacotes), str(alvo)], capture_output=True)
    st, e = rodar(novo(inst, g))
    caso("(g) pasta de pacotes que é junção: 409 desenvolvimento, 0 pedido", st == 409 and e["motivo"] == "desenvolvimento"
         and not g.hits, e)
    os.rmdir(inst.pacotes)

    gerado = pacote_publico(VELHA, origem=None)
    inst = Inst(gerado)
    antes = inst.foto()
    st, e = rodar(novo(inst, g))
    caso("(g) pacote gerado neste computador (sem origem release): 409 gerado-aqui, intacto, 0 pedido",
         st == 409 and e["motivo"] == "gerado-aqui" and inst.foto() == antes and not g.hits and e["acao"] == "nada", e)

    for fase in ("Matchmaking", "ReadyCheck", "ChampSelect", "InProgress", "Reconnect"):
        inst = Inst()
        st, e = rodar(novo(inst, g, fase=lambda f=fase: f))
        caso(f"(g) fase {fase}: 409 partida, 0 pedido", st == 409 and e["motivo"] == "partida" and not g.hits, e)

    inst = Inst()
    (inst.comp / "pengu" / "versao.js").write_text("export const VERSAO = '0.2.0';\n", encoding="utf-8")
    st, e = rodar(novo(inst, g))
    caso("(g) sem REPO no versao.js: 409 versao, 0 pedido", st == 409 and e["motivo"] == "versao" and not g.hits, e)


# ---------- (h) origem ----------

def parte_h(g, fora):
    g.limpar()
    fora.limpar()
    publicar(g, base_download=fora.base)
    fora.blobs.update(g.blobs)
    inst = Inst(VELHO)
    antes = inst.foto()
    st, e = rodar(novo(inst, g))
    caso("(h) URL do asset noutro host: erro origem, 0 acesso ao de fora, intacto", e["motivo"] == "origem" and not fora.hits
         and inst.foto() == antes, (e, fora.hits))
    g.limpar()
    publicar(g)
    fora.blobs.update(g.blobs)
    g.redir = fora.base
    st, e = rodar(novo(inst, g))
    caso("(h) redirecionamento para fora: erro origem, 0 acesso ao de fora", e["motivo"] == "origem" and not fora.hits
         and inst.foto() == antes, (e, fora.hits))
    g.redir = None
    bloqueou = 0
    for api in ("https://evil.example", "http://192.168.0.2:8831", "http://localhost:8831", "https://api.github.com.evil"):
        try:
            VP.PacoteVoz(raiz=inst.comp, pacotes=inst.pacotes, api=api, download=api, origens=(api,), esperada=VER)
        except ValueError:
            bloqueou += 1
    caso("(h) origem trocada fora de 127.0.0.1: ValueError (4/4)", bloqueou == 4, bloqueou)
    pv = VP.PacoteVoz(raiz=inst.comp, pacotes=inst.pacotes, esperada=VER)
    caso("(h) origem padrão: api.github.com e os hosts de asset do atualizar", pv.api == "https://api.github.com"
         and pv.origens == A.ORIGENS_DOWNLOAD, (pv.api, pv.origens))
    g.limpar()
    g.lista = [{"tag_name": "v0.2.0", "draft": False, "prerelease": False, "assets": [{"name": "SHA256SUMS.txt"}]}]
    inst = Inst()
    pv = novo(inst, g)
    pv.rota_get("/voz/estado")
    pv.thread.join(10)
    e = pv.estado()
    caso("(h) nenhum release com a voz desta versão: estado sem disponível, motivo release", e["disponivel"] is None
         and e["motivo"] == "release" and e["acao"] == "baixar", e)
    st, e = rodar(pv)
    caso("(h) POST sem release com a voz: erro release", e["estado"] == "erro" and e["motivo"] == "release", e)


# ---------- (i) rotas ----------

def _req(url, corpo=None, origem=None):
    h = {"Content-Type": "application/json"}
    if origem:
        h["Origin"] = origem
    r = urllib.request.Request(url, data=None if corpo is None else json.dumps(corpo).encode(), headers=h,
                               method="POST" if corpo is not None else "GET")
    try:
        with urllib.request.urlopen(r, timeout=10) as resp:
            return resp.status, json.loads(resp.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


def parte_i(g):
    import servidor_local as S
    g.limpar()
    publicar(g)
    inst = Inst()
    pv = novo(inst, g)
    srv = S.ServidorLocal(porta=0, db=inst.base / "sem.db", config=inst.base / "config.json")
    srv.rotas_post["/voz/baixar"] = pv.rota_post
    srv.rotas_get["/voz/estado"] = pv.rota_get
    caso("(i) servidor de teste sobe na porta 0", srv.iniciar(), "")
    porta = srv.httpd.server_address[1]
    u = f"http://127.0.0.1:{porta}"
    try:
        st, d = _req(u + "/ola")
        caso("(i) /ola anuncia voz-pacote com a rota pendurada", st == 200 and "voz-pacote" in d["recursos"], d)
        st, d = _req(u + "/voz/baixar", {})
        caso("(i) POST /voz/baixar sem Origin: 403, nada começa", st == 403 and pv.estado()["estado"] in ("parado",)
             and not any(NOME in h for h in g.hits), (st, d))
        st, d = _req(u + "/voz/baixar", {}, "https://evil.example")
        caso("(i) POST com Origin de site: 403", st == 403, (st, d))
        st, d = _req(u + "/voz/estado", origem="https://evil.example")
        caso("(i) GET /voz/estado com Origin de site: 403", st == 403, (st, d))
        st, d = _req(u + "/voz/estado")
        caso("(i) GET /voz/estado sem Origin (curl): 200 com o estado", st == 200 and d["pacote"] == "aoede"
             and d["acao"] == "baixar", d)
        if pv.thread:
            pv.thread.join(10)
        st, d = _req(u + "/voz/baixar", {}, "https://plugins")
        caso("(i) POST com Origin do Pengu: 202", st == 202, (st, d))
        pv.thread.join(30)
        st, d = _req(u + "/voz/estado", origem="https://plugins")
        caso("(i) GET /voz/estado com Origin do Pengu: pronto", st == 200 and d["estado"] == "pronto", d)
    finally:
        srv.parar()
    import coletor as C
    falso = SimpleNamespace(srv=SimpleNamespace(rotas_post={}, rotas_get={}))
    vp = C._pacote_voz(falso, SimpleNamespace(fase_atual="None"))
    caso("(i) coletor.py pendura POST /voz/baixar e GET /voz/estado", isinstance(vp, VP.PacoteVoz)
         and set(falso.srv.rotas_post) == {"/voz/baixar"} and set(falso.srv.rotas_get) == {"/voz/estado"}, vp)
    caso("(i) sem servidor, nada", C._pacote_voz(SimpleNamespace(), None) is None)


def principal():
    g = Falso()
    fora = Falso(ocupadas={g.porta})
    print(f"servidor falso em {g.base}; o de fora em {fora.base}; LOCALAPPDATA = {os.environ['LOCALAPPDATA']}")
    try:
        parte_a(g)
        parte_b(g)
        parte_c(g)
        parte_d(g)
        parte_e(g)
        parte_f(g)
        parte_g(g)
        parte_h(g, fora)
        parte_i(g)
    finally:
        g.parar()
        fora.parar()
        shutil.rmtree(BASE, ignore_errors=True)
    ok = sum(1 for _, p, _ in casos if p)
    print(f"{ok}/{len(casos)} ok")
    return 0 if ok == len(casos) else 1


if __name__ == "__main__":
    sys.exit(principal())
