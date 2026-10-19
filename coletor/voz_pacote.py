# Pacote de voz pelo botão do plugin (P5 de roadmap/2026-10-19-publicacao-e-complemento-publico.md). A geração continua só na
# máquina do mantenedor (tools/gerar-pacote-voz.py, chave dele); quem instala o complemento público baixa o pacote pronto.
#   GET  /voz/estado   {estado, motivo, pacote, instalada, esperada, disponivel, acao, baixados, total}
#   POST /voz/baixar   {} (Origin do client ou do Pengu obrigatório: servidor_local.ROTAS_SO_PLUGIN_ESTRITO)
# Qual pacote: voz-<pacote>-<versao>.zip, com <versao> = avisos.versao_catalogo() do código instalado (as falas que este coach
# diz). O tools/publicar.py só anexa o zip ao release em que o catálogo mudou (decisão 3 do plano), então ele mora num release
# qualquer: UMA consulta à lista (https://api.github.com/repos/<REPO>/releases?per_page=100, origem fixa) e o release mais novo
# que tem o asset com esse nome EXATO. Download e hash como o atualizar.py (mesma Rede, mesmas origens): sha256 == linha do
# SHA256SUMS.txt daquele release == digest da API (nulo = falha).
# Troca com volta (decisão 5): extrai em %LOCALAPPDATA%\lol-client\voz\pacotes\<pacote>.nova, confere o zip e o indice.json
# (voz, versão, origem "release", todo arquivo citado é um .wav do zip com nome simples, nada a mais), renomeia a pasta atual
# para <pacote>.anterior (guarda 1) e a nova para o lugar. Aqui a pasta inteira troca (não há dados dentro dela). Falha no meio
# devolve a anterior; queda do processo entre os dois renames se recupera na próxima vez (recuperar()).
# Fala em curso: o pacote só se pede em None/Lobby (não há voz tocando), mas a troca pode cair numa partida se a fila andou no
# download. Ela não atrapalha: o voz.Voz lê o pacote ENTRE falas (Pacote.relido, pelo mtime do indice.json), nunca no meio de
# uma, e o rename de uma pasta com um .wav aberto falha no Windows e tenta de novo (TENTATIVAS x PAUSA_S) até a fala acabar.
# Nunca troca: instalação de desenvolvimento (complemento numa pasta com .git ou junção: a do mantenedor) nem pacote que não
# veio do release (indice.json sem "origem": "release" = gerado neste computador; o botão apagaria a geração dele).
# Prova: tools/teste-voz-baixar.py (release falso em 8831-8840, LOCALAPPDATA no temp).
import hashlib
import json
import logging
import os
import re
import threading
import time
from pathlib import Path

import atualizar as A
import voz as V

NOME_PADRAO = V.PACOTE_PADRAO or "aoede"
ORIGEM_RELEASE = "release"          # indice.json do pacote público (tools/publicar.py montar_voz)
LIMITE_LISTA = 8 << 20
TENTATIVAS = 40                     # rename de pasta com arquivo aberto (fala tocando, antivírus): 40 x 0,25 s = 10 s
PAUSA_S = 0.25
RECONSULTA_S = 6 * 3600             # GET /voz/estado consulta o GitHub no máximo 1 vez nesse intervalo (falha: 10 min)
RECONSULTA_FALHA_S = 600
_ARQUIVO = re.compile(r"^[0-9A-Za-z_-]{1,80}\.wav$")
_CATALOGO = re.compile(r"^[0-9a-f]{12}$")
log = logging.getLogger("coletor.voz_pacote")


def nome_asset(pacote, versao):
    return f"voz-{pacote}-{versao}.zip"


def versao_do_codigo():
    """avisos.versao_catalogo() do código instalado; None se o catálogo não carrega"""
    try:
        import avisos
        return avisos.versao_catalogo()
    except Exception as e:   # noqa: BLE001 (nunca derruba as rotas)
        log.warning("voz: catálogo não calculado: %s", e)
        return None


def ler_indice(pasta):
    try:
        d = json.loads((Path(pasta) / "indice.json").read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else None
    except (OSError, ValueError):
        return None


def conferir_indice(pasta, esperados, pacote, versao):
    """o indice.json extraído é de um pacote público desta versão e cita só .wav do zip, com nome simples (o voz.Pacote junta
    o nome à pasta: '..\\' num valor seria leitura fora dela); nada a mais no zip além do índice e dos .wav citados"""
    d = ler_indice(pasta)
    if d is None:
        raise A.Falha("pacote", "indice.json ilegível")
    if d.get("voz") != pacote or d.get("versao_catalogo") != versao or d.get("origem") != ORIGEM_RELEASE:
        raise A.Falha("pacote", "indice.json de outro pacote")
    frases = d.get("frases")
    if not isinstance(frases, dict) or not frases:
        raise A.Falha("pacote", "indice.json sem falas")
    citados = set()
    for fala, v in frases.items():
        arq = v.get("arquivo") if isinstance(v, dict) else None
        if not isinstance(fala, str) or not isinstance(arq, str) or not _ARQUIVO.match(arq) or arq not in esperados:
            raise A.Falha("pacote", "fala com arquivo inválido")
        citados.add(arq)
    if set(esperados) - citados - {"indice.json"}:
        raise A.Falha("pacote", "arquivo fora do índice")
    return len(frases)


class PacoteVoz:
    """estado e rotas do /voz. pacotes: pasta dos pacotes (padrão voz.PACOTES_DIR); raiz: pasta do complemento (para a recusa
    de desenvolvimento e o REPO de pengu/versao.js); fase(): fase do gameflow. api/download/origens: só a origem fixa, ou
    http://127.0.0.1:<porta> nos testes (como o atualizar.Atualizador). esperada: versão do catálogo (padrão: a do código)"""

    def __init__(self, raiz=A.RAIZ, pacotes=None, pacote=NOME_PADRAO, fase=lambda: None, api=A.API, download=A.DOWNLOAD,
                 origens=A.ORIGENS_DOWNLOAD, rede=None, esperada=None, agora=time.monotonic):
        trocada = (api, download, tuple(origens)) != (A.API, A.DOWNLOAD, A.ORIGENS_DOWNLOAD)
        if trocada and not (A._TESTE.match(api) and A._TESTE.match(download) and all(A._TESTE.match(o) for o in origens)):
            raise ValueError("origem trocada só em loopback (teste)")
        self.raiz = Path(raiz)
        self.pacotes = Path(pacotes or V.PACOTES_DIR)
        self.pacote = pacote
        self.fase = fase
        self.api, self.download, self.origens = api, download, tuple(origens)
        self.rede = rede or A.Rede()
        self.agora = agora
        self.repo = A.ler_versao(self.raiz)[1]
        self._esperada = esperada
        self.mover = os.rename   # tools/teste-voz-baixar.py troca para simular a pasta presa
        self._trava = threading.Lock()
        self._est = {"estado": "parado", "motivo": None, "baixados": 0, "total": None}
        self._disp = None          # {versao, tamanho, tag} do release, ou None
        self._consulta = None      # (monotonic, ok) da última consulta
        self._pendente = False     # POST chegou durante a consulta: o download sai no fim dela
        self.thread = None
        self.recuperar()

    # ---- pastas ----
    @property
    def pasta(self):
        return self.pacotes / self.pacote

    @property
    def nova(self):
        return self.pacotes / f"{self.pacote}.nova"

    @property
    def anterior(self):
        return self.pacotes / f"{self.pacote}.anterior"

    def esperada(self):
        if self._esperada is None:
            self._esperada = versao_do_codigo()
        return self._esperada

    def recuperar(self):
        """queda do processo entre os dois renames: a pasta sumiu e a anterior está inteira -> volta; .nova solta sai"""
        try:
            if not self.pasta.exists() and (self.anterior / "indice.json").exists() and not A.reparse(self.anterior):
                self.mover(str(self.anterior), str(self.pasta))
                log.warning("voz: troca interrompida antes; o pacote anterior voltou para %s", self.pasta.name)
            if self.nova.exists() and not self._ocupado():
                A._apagar(self.nova)
        except OSError as e:
            log.warning("voz: recuperação do pacote: %s", e)

    def instalada(self):
        """{versao, falas, release} do pacote instalado, ou None"""
        d = ler_indice(self.pasta)
        if d is None:
            return None
        fs = d.get("frases") if isinstance(d.get("frases"), dict) else {}
        return {"versao": d.get("versao_catalogo") if isinstance(d.get("versao_catalogo"), str) else None,
                "falas": sum(1 for v in fs.values() if not (isinstance(v, dict) and v.get("suspeita"))),
                "release": d.get("origem") == ORIGEM_RELEASE}

    def recusa(self):
        """motivo para o botão não trocar este pacote (antes de qualquer rede), ou None"""
        if A.desenvolvimento(self.raiz):
            return "desenvolvimento"
        if A.reparse(self.pacotes) or A.reparse(self.pasta):
            return "desenvolvimento"
        ins = self.instalada()
        if self.pasta.exists() and not (ins and ins["release"]):
            return "gerado-aqui"
        if not self.repo or not self.esperada() or not _CATALOGO.match(self.esperada()):
            return "versao"
        return None

    # ---- estado ----
    def _ocupado(self):
        return self._est["estado"] in ("consultando", "baixando", "conferindo", "trocando")

    def _por(self, estado, **kw):
        with self._trava:
            self._est.update(estado=estado, **kw)
        if estado in ("erro", "recusado", "pronto"):
            log.info("voz: %s%s", estado, f" ({kw['motivo']})" if kw.get("motivo") else "")

    def acao(self, ins=None, recusa=None):
        """'baixar' | 'atualizar' | 'nada' (em dia, ou o botão não troca este pacote)"""
        if recusa:
            return "nada"
        if ins is None:
            return "baixar"
        return "nada" if ins["versao"] == self.esperada() else "atualizar"

    def estado(self):
        ins, rec = self.instalada(), self.recusa()
        with self._trava:
            e = dict(self._est)
            disp = dict(self._disp) if self._disp else None
        return {**e, "pacote": self.pacote, "instalada": ins, "esperada": self.esperada(), "disponivel": disp,
                "acao": self.acao(ins, rec), "recusa": rec, "consultado": self._consulta is not None}

    # ---- release ----
    def achar(self):
        """(tag, {nome: asset}) do release mais novo com voz-<pacote>-<esperada>.zip e o SHA256SUMS.txt; Falha se nenhum"""
        nome = nome_asset(self.pacote, self.esperada())
        bruto = self.rede.pegar(f"{self.api}/repos/{self.repo}/releases?per_page=100", (self.api,), LIMITE_LISTA,
                                "application/vnd.github+json")
        try:
            lista = json.loads(bruto)
        except ValueError:
            raise A.Falha("release", "resposta não é JSON") from None
        if not isinstance(lista, list):
            raise A.Falha("release", "resposta não é lista")
        for rel in lista:
            if not isinstance(rel, dict) or rel.get("draft") or rel.get("prerelease"):
                continue
            tag = rel.get("tag_name")
            if not isinstance(tag, str) or not A.versao_tupla(tag[1:] if tag.startswith("v") else ""):
                continue
            assets = {a.get("name"): a for a in rel.get("assets") or [] if isinstance(a, dict)}
            if nome in assets:
                if A.SUMS not in assets:
                    raise A.Falha("release", f"{tag} sem {A.SUMS}")
                return tag, {n: assets[n] for n in (nome, A.SUMS)}
        raise A.Falha("release", f"nenhum release com {nome}")

    def _digest(self, tag, nome, a):
        if a.get("browser_download_url") != f"{self.download}/{self.repo}/releases/download/{tag}/{nome}":
            raise A.Falha("origem", f"URL do asset {nome} fora da origem fixa")
        d = a.get("digest")
        m = re.match(r"^sha256:([0-9a-f]{64})$", d) if isinstance(d, str) else None
        if not m:
            raise A.Falha("hash", f"digest ausente em {nome}")
        return m.group(1)

    def consultar(self):
        """GET /voz/estado: 1 consulta da lista de releases para o tamanho do botão (em segundo plano; nunca com recusa,
        nem com o pacote em dia, nem mais de 1 vez em RECONSULTA_S)"""
        with self._trava:
            if self._ocupado():
                return False
            ult = self._consulta
            if ult and self.agora() - ult[0] < (RECONSULTA_S if ult[1] else RECONSULTA_FALHA_S):
                return False
        if self.acao(self.instalada(), self.recusa()) == "nada":
            return False
        with self._trava:
            if self._ocupado():
                return False
            self._est.update(estado="consultando", motivo=None)
            self._consulta = (self.agora(), False)
        self.thread = threading.Thread(target=self._consultar, name="voz-consulta", daemon=True)
        self.thread.start()
        return True

    def _consultar(self):
        disp, motivo, ok = None, None, False
        try:
            tag, assets = self.achar()
            tam = assets[nome_asset(self.pacote, self.esperada())].get("size")
            disp = {"versao": self.esperada(), "tag": tag, "tamanho": tam if isinstance(tam, int) and tam > 0 else None}
            ok = True
        except A.Falha as f:
            motivo = f.motivo
        except Exception as e:   # noqa: BLE001
            log.warning("voz: consulta: %s", type(e).__name__)
            motivo = "rede"
        # fim da consulta e o POST que chegou durante ela (pedir: _pendente) decididos sob a mesma trava: o plugin nunca lê um
        # "parado" entre a consulta e o download que ele pediu
        with self._trava:
            self._disp = disp
            if ok:
                self._consulta = (self.agora(), True)
            pendente, self._pendente = self._pendente, False
            if pendente:
                self._est.update(estado="baixando", motivo=None, baixados=0, total=None)
            elif self._est["estado"] == "consultando":   # nunca por cima de um estado que não é desta consulta
                self._est.update(estado="parado", motivo=motivo)
        if pendente:
            self._rodar()

    # ---- POST /voz/baixar ----
    def pedir(self):
        with self._trava:
            if self._ocupado() and self._est["estado"] != "consultando":
                return 409, {**self._est}
        motivo = self.recusa()
        if not motivo and self.fase() not in A.FASES_OK:
            motivo = "partida"
        if not motivo and self.acao(self.instalada()) == "nada":
            motivo = "em-dia"
        if motivo:
            # com a consulta do GET em voo, a recusa vai só na resposta: gravá-la por cima do "consultando" soltava o _ocupado()
            # com a thread da consulta viva, e o fim dela pisava ("parado") no download aceito logo depois (2º download em
            # paralelo sobre a mesma .nova; revisão adversarial da P5)
            with self._trava:
                if not self._ocupado():
                    self._est.update(estado="recusado", motivo=motivo, baixados=0, total=None)
            log.info("voz: recusado (%s)", motivo)
            return 409, {**self.estado(), "estado": "recusado", "motivo": motivo, "baixados": 0, "total": None}
        with self._trava:
            if self._est["estado"] == "consultando" and not self._pendente:
                # a consulta do GET /voz/estado ainda em voo (GitHub lento: até PRAZO_S): responde já e o download sai no fim
                # dela, na mesma thread (o plugin desiste do POST em 8 s; esperar aqui daria "sem resposta" com o download
                # começando depois)
                self._pendente = True
                self._est.update(motivo=None, baixados=0, total=None)
                return 202, {**self._est}
            if self._ocupado():
                return 409, {**self._est}
            self._est.update(estado="baixando", motivo=None, baixados=0, total=None)
        self.thread = threading.Thread(target=self._rodar, name="voz-baixar", daemon=True)
        self.thread.start()
        return 202, self.estado()

    def _rodar(self):
        try:
            self.executar()
        except A.Falha as f:
            self._por("erro", motivo=f.motivo)
            log.warning("voz: %s", f)
            return
        except Exception as e:   # noqa: BLE001
            self._por("erro", motivo="troca")
            log.exception("voz: %s", type(e).__name__)
            return
        self._por("pronto", motivo=None)

    def executar(self):
        versao = self.esperada()
        nome = nome_asset(self.pacote, versao)
        tag, assets = self.achar()
        dig_zip, dig_sums = self._digest(tag, nome, assets[nome]), self._digest(tag, A.SUMS, assets[A.SUMS])
        tam = assets[nome].get("size")
        with self._trava:
            self._disp = {"versao": versao, "tag": tag, "tamanho": tam if isinstance(tam, int) and tam > 0 else None}
            self._consulta = (self.agora(), True)
        base = f"{self.download}/{self.repo}/releases/download/{tag}"
        sums_b = self.rede.pegar(f"{base}/{A.SUMS}", self.origens, A.LIMITE_SUMS)
        if hashlib.sha256(sums_b).hexdigest() != dig_sums:
            raise A.Falha("hash", f"{A.SUMS} não confere com o digest")
        linha = A.ler_sums(sums_b.decode("utf-8", "replace")).get(nome, "")

        def progresso(lidos, total):
            with self._trava:
                self._est.update(baixados=lidos, total=total)
        dados = self.rede.pegar(f"{base}/{nome}", self.origens, A.LIMITE_ZIP, progresso=progresso)
        h = hashlib.sha256(dados).hexdigest()
        if not A._HEX.match(linha) or h != linha or h != dig_zip:
            raise A.Falha("hash", f"{nome} não confere")
        self._por("conferindo")
        if A.reparse(self.pacotes) or A.reparse(self.nova):
            raise A.Falha("troca", "pasta de pacotes é junção")
        try:
            A._apagar(self.nova)
            self.nova.mkdir(parents=True)
            esperados = A.extrair(dados, self.pacote, self.nova)
            A.conferir_extraido(self.nova, esperados)
            falas = conferir_indice(self.nova, esperados, self.pacote, versao)
        except OSError as e:
            self._apagar_nova()
            raise A.Falha("pacote", type(e).__name__) from None
        except BaseException:
            self._apagar_nova()
            raise
        self._por("trocando")
        self.trocar()
        log.info("voz: pacote %s versão %s instalado (%d falas; o anterior em %s)", self.pacote, versao, falas,
                 self.anterior.name)

    def _apagar_nova(self):
        try:
            A._apagar(self.nova)
        except OSError as e:
            log.warning("voz: %s ficou (%s)", self.nova.name, e)

    def _mv(self, de, para):
        """rename que tenta de novo no PermissionError (um .wav tocando segura a pasta; o rename nunca vira cópia)"""
        for i in range(TENTATIVAS):
            try:
                return self.mover(str(de), str(para))
            except PermissionError:
                if i == TENTATIVAS - 1:
                    raise
                time.sleep(PAUSA_S)

    def trocar(self):
        tinha = self.pasta.exists()
        try:
            if tinha:
                A._apagar(self.anterior)
                self._mv(self.pasta, self.anterior)
        except OSError as e:
            self._apagar_nova()
            raise A.Falha("troca", f"{type(e).__name__}: {e}") from None
        try:
            self._mv(self.nova, self.pasta)
        except OSError as e:
            volta = True
            if tinha:
                try:
                    self._mv(self.anterior, self.pasta)
                except OSError as e2:
                    volta = False
                    log.error("voz: o pacote anterior não voltou (%s): fica em %s", e2, self.anterior)
            self._apagar_nova()
            raise A.Falha("troca" if volta else "troca-incompleta", f"{type(e).__name__}: {e}") from None

    # ---- rotas do servidor_local ----
    def rota_post(self, rota, bruto):
        if rota.rstrip("/") != "/voz/baixar":
            return 404, {"erro": "não existe"}
        return self.pedir()

    def rota_get(self, rota):
        if rota.rstrip("/") != "/voz/estado":
            return 404, {"erro": "não existe"}
        self.consultar()
        return 200, self.estado()
