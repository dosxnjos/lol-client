# Atualização do lol-ultra-client pelo complemento coach (P3 de roadmap/2026-10-19-publicacao-e-complemento-publico.md).
#   POST /atualizar {"versao": "x.y.z"}   (Origin do client ou do Pengu, a regra do /aceite/plugin: servidor_local.ROTAS_SO_PLUGIN)
#   GET  /atualizar/estado                {estado, versao, instalada, motivo, reiniciar}
# O plugin manda só a versão; a URL o complemento acha sozinho, sempre na origem fixa (decisão 4 do plano):
#   release   https://api.github.com/repos/<REPO>/releases/tags/v<versao> (REPO e VERSAO de pengu/versao.js)
#   assets    browser_download_url == https://github.com/<REPO>/releases/download/v<versao>/<nome>, exato; cada
#             redirecionamento conferido (https e host em ORIGENS_DOWNLOAD; medido em 19/10/2026: github.com -> 302 para
#             release-assets.githubusercontent.com)
# Hash (decisão 3): sha256 calculado == linha do SHA256SUMS.txt == digest da API, nos 2 zips; o SHA256SUMS.txt também confere
# com o digest dele. digest nulo é falha (release nosso é novo: o GitHub calcula; P0-b, ARMADILHAS § Client e Pengu).
# Troca com volta (decisão 5): extrai os 2 zips em <pasta>/.atualizacao/nova, confere que todo arquivo chegou com o tamanho
# certo e só então troca, ITEM A ITEM da raiz de cada pasta (o que estava vai para <pasta>/.atualizacao/anterior, guarda 1).
# Item a item porque o dados/ do complemento mora dentro da pasta dele (P0, achado 1) e fica aberto (coletor.log, trava,
# banco): renomear a pasta inteira falharia no Windows e levaria os dados de quem instalou. PRESERVAR nunca sai do lugar. O
# estágio mora DENTRO da pasta trocada: mesmo volume sempre (os.rename; o shutil.move cairia em cópia + rmtree e apagaria
# metade de um item preso), e nunca ao lado do plugin (pasta irmã em plugins\ do Pengu carregaria como outro plugin). Falha
# no meio desfaz tudo (o plugin também volta se o complemento falhar: saem sempre juntos).
# Recusa antes de qualquer rede: pasta que é junção (ponto de reparse) ou que está num repositório git (.git nela ou acima) é
# instalação de desenvolvimento (a do mantenedor: plugins\lol-client é junção para a pasta de trabalho). Fora de None/Lobby
# também recusa: trocar e reiniciar no meio da fila ou da partida derrubaria o coach.
# Depois da troca: estado "pronto" com reiniciar=True, segurado SEGURAR_S para o plugin ler, e o dono (coletor.py) reinicia o
# complemento só em None/Lobby (o código novo só vale depois do reinício; até lá, nenhum import tardio fica pela metade: o
# reinício vem logo).
# Prova: tools/teste-atualizar.py (servidor de release falso em 8831-8840, pastas no temp).
import hashlib
import json
import logging
import os
import re
import shutil
import stat
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile
from io import BytesIO
from pathlib import Path
from urllib.parse import urljoin, urlsplit

RAIZ = Path(__file__).resolve().parent.parent
PASTA_PLUGIN = "lol-ultra-client"                    # pasta em plugins\ do Pengu (tools/publicar.py PASTA_PLUGIN)
PASTA_COMPLEMENTO = "lol-ultra-client-complemento"   # pasta-raiz do zip do complemento (tools/publicar.py)
NOME = "lol-ultra-client"
API = "https://api.github.com"
DOWNLOAD = "https://github.com"
ORIGENS_DOWNLOAD = ("https://github.com", "https://objects.githubusercontent.com",
                    "https://release-assets.githubusercontent.com")
SUMS = "SHA256SUMS.txt"
ESTAGIO = ".atualizacao"                             # <pasta>/.atualizacao/{nova,anterior}
PRESERVAR = {"plugin": frozenset({ESTAGIO}), "complemento": frozenset({ESTAGIO, "dados"})}
LIMITE_API = 2 << 20
LIMITE_SUMS = 64 << 10
LIMITE_ZIP = 200 << 20
LIMITE_EXTRAIDO = 500 << 20
LIMITE_ARQUIVOS = 5000
MAX_REDIRECIONAMENTOS = 5
PRAZO_S = 30
SEGURAR_S = 5          # "pronto" segurado antes do reinício: o plugin lê o estado e mostra "Atualizado"
ESPERA_FASE_S = 5
FASES_OK = (None, "None", "Lobby")
IFEO = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options\LeagueClientUx.exe"
_TESTE = re.compile(r"^http://127\.0\.0\.1:\d{1,5}$")   # origem trocada só em loopback (tools/teste-atualizar.py)
_VERSAO = re.compile(r"^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$")
_HEX = re.compile(r"^[0-9a-f]{64}$")
log = logging.getLogger("coletor.atualizar")


class Falha(Exception):
    """motivo: palavra que o plugin traduz (pengu/atualizador.js TEXTOS)"""
    def __init__(self, motivo, detalhe=""):
        super().__init__(f"{motivo}: {detalhe}" if detalhe else motivo)
        self.motivo = motivo


def versao_tupla(v):
    m = _VERSAO.match(v) if isinstance(v, str) else None
    return tuple(int(x) for x in m.groups()) if m else None


def ler_versao(raiz=RAIZ):
    """(VERSAO, REPO) de <raiz>/pengu/versao.js (a mesma constante do plugin e do tools/publicar.py); None no que faltar"""
    try:
        t = (Path(raiz) / "pengu" / "versao.js").read_text(encoding="utf-8")
    except OSError:
        return None, None
    v = re.search(r"\bVERSAO\s*=\s*'(\d+\.\d+\.\d+)'", t)
    r = re.search(r"\bREPO\s*=\s*'([A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100})'", t)
    return (v.group(1) if v else None), (r.group(1) if r else None)


def pasta_plugins_pengu():
    """plugins\\ do Pengu Loader pela ativação dele (IFEO do LeagueClientUx.exe: Debugger = rundll32 "<pasta>\\core.dll",
    #6000; só leitura do registro). None sem Pengu ativado"""
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, IFEO) as k:
            dbg, _ = winreg.QueryValueEx(k, "Debugger")
    except (OSError, ImportError):
        return None
    m = re.search(r'"([^"]+core\.dll)"', dbg or "", re.I) or re.search(r"(\S+core\.dll)", dbg or "", re.I)
    return Path(m.group(1)).parent / "plugins" if m else None


def reparse(p):
    """True se p é junção ou link (ponto de reparse)"""
    try:
        st = os.lstat(p)
    except OSError:
        return False
    return stat.S_ISLNK(st.st_mode) or bool(getattr(st, "st_file_attributes", 0) & 0x400)   # FILE_ATTRIBUTE_REPARSE_POINT


def em_git(p):
    """True se p ou uma pasta acima tem .git (a mesma busca do git)"""
    p = Path(os.path.abspath(p))
    for q in (p, *p.parents):
        if (q / ".git").exists():
            return True
    return False


def desenvolvimento(p):
    return reparse(p) or em_git(p)


def ler_sums(texto):
    """{nome: hash} do formato do sha256sum ("<hash>  <nome>" ou "<hash> *<nome>")"""
    saida = {}
    for linha in texto.splitlines():
        m = re.match(r"^([0-9a-fA-F]{64}) [ *](\S.*)$", linha.strip())
        if m:
            saida[m.group(2).strip()] = m.group(1).lower()
    return saida


class _SemRedirecionar(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):   # cada salto passa pela conferência de origem em Rede.pegar
        return None


class Rede:
    """GET com redirecionamento conferido salto a salto: só https nas origens dadas (ou a origem de teste em loopback)"""

    def __init__(self, prazo_s=PRAZO_S, agente=NOME):
        self.prazo_s = prazo_s
        self.agente = agente
        self.abrir = urllib.request.build_opener(_SemRedirecionar()).open

    @staticmethod
    def origem(url):
        u = urlsplit(url)
        if u.username or u.password or "@" in u.netloc or not u.netloc:
            return None
        return f"{u.scheme.lower()}://{u.netloc.lower()}"

    def pegar(self, url, origens, limite, aceitar="*/*"):
        for _ in range(MAX_REDIRECIONAMENTOS + 1):
            if self.origem(url) not in origens:
                raise Falha("origem", f"fora da origem fixa: {self.origem(url)}")
            req = urllib.request.Request(url, headers={"User-Agent": self.agente, "Accept": aceitar})
            try:
                with self.abrir(req, timeout=self.prazo_s) as r:
                    n = r.headers.get("Content-Length")
                    if n and n.isdigit() and int(n) > limite:
                        raise Falha("rede", f"grande demais ({n} bytes)")
                    dados = r.read(limite + 1)
                    if len(dados) > limite:
                        raise Falha("rede", "grande demais")
                    if n and n.isdigit() and len(dados) != int(n):
                        raise Falha("rede", "download incompleto")
                    return dados
            except urllib.error.HTTPError as e:
                if e.code in (301, 302, 303, 307, 308) and e.headers.get("Location"):
                    url = urljoin(url, e.headers["Location"])
                    continue
                raise Falha("release" if e.code == 404 else "rede", f"HTTP {e.code}") from None
            except Falha:
                raise
            except Exception as e:   # rede, prazo, conexão cortada no meio (IncompleteRead)
                raise Falha("rede", f"{type(e).__name__}") from None
        raise Falha("origem", "redirecionamentos demais")


def _nome_seguro(nome, prefixo):
    """caminho relativo dentro de prefixo/, ou Falha (zip com .., absoluto, letra de disco, contrabarra, fora da pasta)"""
    if "\\" in nome or nome.startswith("/") or re.match(r"^[A-Za-z]:", nome) or "\0" in nome:
        raise Falha("pacote", "caminho inválido no zip")
    partes = nome.split("/")
    if partes[0] != prefixo or any(p in ("..", ".") for p in partes) or any(":" in p for p in partes):
        raise Falha("pacote", "caminho fora da pasta do pacote")
    return "/".join(partes[1:])


def extrair(dados_zip, prefixo, destino, preservar=frozenset()):
    """extrai o zip (pasta-raiz `prefixo`) em destino (vazio); devolve {relativo: tamanho} dos arquivos"""
    destino = Path(destino)
    try:
        z = zipfile.ZipFile(BytesIO(dados_zip))
    except zipfile.BadZipFile:
        raise Falha("pacote", "zip inválido") from None
    with z:
        infos = z.infolist()
        if len(infos) > LIMITE_ARQUIVOS or sum(i.file_size for i in infos) > LIMITE_EXTRAIDO:
            raise Falha("pacote", "zip grande demais")
        esperados = {}
        for i in infos:
            rel = _nome_seguro(i.filename, prefixo)
            if not rel or i.is_dir():
                continue
            if rel.split("/")[0].lower() in preservar:
                raise Falha("pacote", f"o pacote traz {rel.split('/')[0]}/")
            esperados[rel] = i.file_size
        if not esperados:
            raise Falha("pacote", "zip vazio")
        for rel, tam in esperados.items():
            alvo = destino.joinpath(*rel.split("/"))
            alvo.parent.mkdir(parents=True, exist_ok=True)
            try:
                with z.open(f"{prefixo}/{rel}") as fonte, open(alvo, "wb") as f:
                    shutil.copyfileobj(fonte, f)   # o CRC confere na leitura (BadZipFile se não bater)
            except (zipfile.BadZipFile, OSError) as e:
                raise Falha("pacote", f"{type(e).__name__}") from None
    return esperados


def conferir_extraido(destino, esperados):
    """todo arquivo do zip chegou com o tamanho certo e nada a mais"""
    destino = Path(destino)
    achados = {}
    for raiz, _dirs, arqs in os.walk(destino):
        for a in arqs:
            p = Path(raiz) / a
            achados[p.relative_to(destino).as_posix()] = p.stat().st_size
    if achados != esperados:
        raise Falha("pacote", "extração não confere com o zip")


def _apagar(p):
    p = Path(p)
    if reparse(p):
        os.unlink(p) if not p.is_dir() else os.rmdir(p)   # junção: tira o link, nunca o conteúdo do alvo
        return
    if not p.exists():
        return

    def soltar(func, alvo, *_):
        os.chmod(alvo, stat.S_IWRITE)
        func(alvo)
    if sys.version_info >= (3, 12):
        shutil.rmtree(p, onexc=soltar)
    else:
        shutil.rmtree(p, onerror=soltar)


class Troca:
    """troca item a item da raiz de `pasta` pelo conteúdo de `nova`; o que sai vai para `anterior`. desfazer() devolve.
    os.rename e nada de shutil.move: rename que falha (item preso) falha inteiro, sem cópia nem apagar pela metade"""

    def __init__(self, pasta, nova, anterior, preservar=frozenset(), mover=os.rename):
        self.pasta, self.nova, self.anterior = Path(pasta), Path(nova), Path(anterior)
        self.preservar = frozenset(x.lower() for x in preservar)
        self.mover = mover
        self.feitos = []   # [(de, para)] na ordem

    def _mv(self, de, para):
        self.mover(str(de), str(para))
        self.feitos.append((de, para))

    def fazer(self):
        _apagar(self.anterior)
        self.anterior.mkdir(parents=True)
        velhos = sorted(e for e in os.listdir(self.pasta) if e.lower() not in self.preservar)
        novos = sorted(os.listdir(self.nova))
        for e in velhos:
            self._mv(self.pasta / e, self.anterior / e)
        for e in novos:
            self._mv(self.nova / e, self.pasta / e)

    def desfazer(self):
        erros = 0
        for de, para in reversed(self.feitos):
            try:
                self.mover(str(para), str(de))
            except OSError as e:
                erros += 1
                log.error("atualização: não devolveu %s (%s)", de.name, e)
        self.feitos = []
        return erros == 0


class Atualizador:
    """estado e rotas do /atualizar. plugins: pasta plugins\\ do Pengu (Path, função ou None = pelo registro). fase(): fase
    do gameflow que o dono vê (None = sem client). reiniciar(): chamado depois do "pronto" segurado, em None/Lobby.
    api/download/origens: só a origem fixa, ou http://127.0.0.1:<porta> nos testes (outra coisa = ValueError)"""

    def __init__(self, raiz=RAIZ, plugins=None, fase=lambda: None, reiniciar=None, api=API, download=DOWNLOAD,
                 origens=ORIGENS_DOWNLOAD, rede=None, segurar_s=SEGURAR_S, espera_fase_s=ESPERA_FASE_S):
        trocada = (api, download, tuple(origens)) != (API, DOWNLOAD, ORIGENS_DOWNLOAD)
        if trocada and not (_TESTE.match(api) and _TESTE.match(download) and all(_TESTE.match(o) for o in origens)):
            raise ValueError("origem trocada só em loopback (teste)")
        self.raiz = Path(raiz)
        self._plugins = plugins
        self.fase = fase
        self.reiniciar = reiniciar
        self.api, self.download, self.origens = api, download, tuple(origens)
        self.rede = rede or Rede()
        self.segurar_s, self.espera_fase_s = segurar_s, espera_fase_s
        self.instalada, self.repo = ler_versao(self.raiz)
        self._trava = threading.Lock()
        self._est = {"estado": "parado", "versao": None, "motivo": None, "reiniciar": False}
        self.thread = None

    def plugins(self):
        p = self._plugins() if callable(self._plugins) else self._plugins
        if p is None and self._plugins is None:
            p = pasta_plugins_pengu()
        return Path(p) if p else None

    def estado(self):
        with self._trava:
            return {**self._est, "instalada": self.instalada}

    def _por(self, estado, **kw):
        with self._trava:
            self._est.update(estado=estado, **kw)
        log.info("atualização: %s%s", estado, f" ({kw['motivo']})" if kw.get("motivo") else "")

    def _ocupado(self):
        return self._est["estado"] in ("baixando", "conferindo", "trocando", "pronto")

    # ---- conferências antes de qualquer rede ----
    def conferir(self, versao):
        """(pasta do plugin) ou Falha: versão, fase, instalação de desenvolvimento, plugin ausente"""
        alvo = versao_tupla(versao)
        if not alvo or not self.repo or not versao_tupla(self.instalada or ""):
            raise Falha("versao", "versão inválida")
        if alvo <= versao_tupla(self.instalada):
            raise Falha("versao", f"{versao} não é mais nova que {self.instalada}")
        if self.fase() not in FASES_OK:
            raise Falha("partida", str(self.fase()))
        if desenvolvimento(self.raiz):
            raise Falha("desenvolvimento", "complemento")
        plugins = self.plugins()
        pasta = plugins / PASTA_PLUGIN if plugins else None
        if pasta is not None and desenvolvimento(pasta):   # antes do exists(): junção quebrada também é de desenvolvimento
            raise Falha("desenvolvimento", "plugin")
        if pasta is None or not pasta.is_dir():
            raise Falha("sem-plugin", str(pasta) if pasta else "Pengu não encontrado")
        return pasta

    def pedir(self, versao):
        """POST /atualizar -> (status, estado). Começa numa thread; recusa = 409 com o motivo no estado"""
        with self._trava:
            if self._ocupado():
                return 409, {**self._est, "instalada": self.instalada}
        try:
            pasta = self.conferir(versao)
        except Falha as f:
            self._por("recusado", versao=versao if isinstance(versao, str) else None, motivo=f.motivo, reiniciar=False)
            return 409, self.estado()
        with self._trava:
            if self._ocupado():
                return 409, {**self._est, "instalada": self.instalada}
            self._est.update(estado="baixando", versao=versao, motivo=None, reiniciar=False)
        self.thread = threading.Thread(target=self._rodar, args=(versao, pasta), name="atualizar", daemon=True)
        self.thread.start()
        return 202, self.estado()

    def _rodar(self, versao, pasta):
        try:
            self.executar(versao, pasta)
        except Falha as f:
            self._por("erro", motivo=f.motivo, reiniciar=False)
            log.warning("atualização %s: %s", versao, f)
            return
        except Exception as e:
            self._por("erro", motivo="troca", reiniciar=False)
            log.exception("atualização %s: %s", versao, type(e).__name__)
            return
        self._por("pronto", motivo=None, reiniciar=True)
        if self.reiniciar:
            threading.Thread(target=self._reiniciar_quando_puder, name="atualizar-reinicio", daemon=True).start()

    def _reiniciar_quando_puder(self):
        time.sleep(self.segurar_s)
        while self.fase() not in FASES_OK:      # fila ou partida começou depois do clique: reinicia na volta ao lobby
            time.sleep(self.espera_fase_s)
        try:
            self.reiniciar()
        except Exception as e:
            log.warning("atualização: reinício falhou: %s", e)

    # ---- o trabalho (síncrono; tools/teste-atualizar.py chama direto também) ----
    def baixar(self, versao):
        """{nome: bytes} dos 2 zips, conferidos (sha256 == SHA256SUMS == digest)"""
        tag = f"v{versao}"
        bruto = self.rede.pegar(f"{self.api}/repos/{self.repo}/releases/tags/{tag}", (self.api,), LIMITE_API,
                                "application/vnd.github+json")
        try:
            rel = json.loads(bruto)
        except ValueError:
            raise Falha("release", "resposta não é JSON") from None
        if not isinstance(rel, dict) or rel.get("tag_name") != tag or rel.get("draft") or rel.get("prerelease"):
            raise Falha("release", "release não confere")
        nomes = [f"{NOME}-plugin-{versao}.zip", f"{NOME}-complemento-{versao}.zip"]
        assets = {a.get("name"): a for a in rel.get("assets") or [] if isinstance(a, dict)}
        digests = {}
        for nome in [*nomes, SUMS]:
            a = assets.get(nome)
            if not a:
                raise Falha("release", f"sem o asset {nome}")
            if a.get("browser_download_url") != f"{self.download}/{self.repo}/releases/download/{tag}/{nome}":
                raise Falha("origem", f"URL do asset {nome} fora da origem fixa")
            d = a.get("digest")
            m = re.match(r"^sha256:([0-9a-f]{64})$", d) if isinstance(d, str) else None
            if not m:
                raise Falha("hash", f"digest ausente em {nome}")   # release nosso é novo: o GitHub calcula (P0-b)
            digests[nome] = m.group(1)
        self._por("baixando")
        sums_b = self._baixar(SUMS, tag, LIMITE_SUMS)
        if hashlib.sha256(sums_b).hexdigest() != digests[SUMS]:
            raise Falha("hash", f"{SUMS} não confere com o digest")
        sums = ler_sums(sums_b.decode("utf-8", "replace"))
        saida = {}
        for nome in nomes:
            dados = self._baixar(nome, tag, LIMITE_ZIP)
            h = hashlib.sha256(dados).hexdigest()
            if not _HEX.match(sums.get(nome, "")) or h != sums[nome] or h != digests[nome]:
                raise Falha("hash", f"{nome} não confere")
            saida[nome] = dados
        return saida

    def _baixar(self, nome, tag, limite):
        return self.rede.pegar(f"{self.download}/{self.repo}/releases/download/{tag}/{nome}", self.origens, limite)

    def executar(self, versao, pasta):
        zips = self.baixar(versao)
        self._por("conferindo")
        pacotes = (("plugin", pasta, zips[f"{NOME}-plugin-{versao}.zip"], PASTA_PLUGIN),
                   ("complemento", self.raiz, zips[f"{NOME}-complemento-{versao}.zip"], PASTA_COMPLEMENTO))
        trocas = []
        for nome, destino, dados, prefixo in pacotes:
            estagio = destino / ESTAGIO
            if reparse(estagio):
                raise Falha("troca", f"{ESTAGIO} é junção")
            nova = estagio / "nova"
            _apagar(nova)
            nova.mkdir(parents=True)
            esperados = extrair(dados, prefixo, nova, PRESERVAR[nome])
            conferir_extraido(nova, esperados)
            trocas.append(Troca(destino, nova, estagio / "anterior", PRESERVAR[nome]))
        self._por("trocando")
        self._sair_das_pastas([t.pasta for t in trocas])
        feitas = []
        try:
            for t in trocas:
                feitas.append(t)
                t.fazer()
        except Exception as e:
            ok = all([t.desfazer() for t in reversed(feitas)])
            raise Falha("troca" if ok else "troca-incompleta", f"{type(e).__name__}: {e}") from None
        for t in trocas:
            _apagar(t.nova)
        log.info("atualização: versão %s instalada (a anterior em %s/anterior de cada pasta)", versao, ESTAGIO)

    def _sair_das_pastas(self, pastas):
        """processo com a pasta atual dentro de um item trocado: o rename falharia ("em uso por outro processo"); a raiz da
        pasta não se move (só os itens), então ela serve"""
        try:
            atual = Path(os.getcwd()).resolve()
        except OSError:
            return
        for p in pastas:
            p = Path(p).resolve()
            if atual != p and p in atual.parents:
                os.chdir(p)
                return

    # ---- rotas do servidor_local ----
    def rota_post(self, rota, bruto):
        if rota.rstrip("/") != "/atualizar":
            return 404, {"erro": "não existe"}
        try:
            corpo = json.loads(bruto or b"{}")
        except ValueError:
            return 400, {"erro": "json inválido"}
        if not isinstance(corpo, dict):
            return 400, {"erro": "corpo não é objeto"}
        return self.pedir(corpo.get("versao"))

    def rota_get(self, rota):
        return 200, self.estado()
