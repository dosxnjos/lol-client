# feitiços de invocador do inimigo (plano v2, passo 15e): quem gastou o quê e quando volta.
# Fontes, nesta ordem (API primeiro; a Live Client não tem recarga de feitiço de ninguém):
#   1. ping de feitiço dos aliados no chat do jogo, lido por OCR do Windows (Windows.Media.Ocr pt-BR)
#      num recorte do chat calibrado sozinho; o chat não passa pela LCU (medido em 13/10/2026);
#   2. atalho manual F7 quando o próprio Gabriel vê o flash: 1 batida = o adversário da minha rota, cada batida a mais
#      passa para a próxima rota (top, jungler, mid, atirador, suporte, e volta), parado 1,2 s marca; segurar F7
#      desfaz. Numérico 1..5 opcional (quem tiver); números de cima nunca (são itens no LoL).
# Linha que não se cruza: só print do monitor (mss) e LEITURA do teclado (teclas.py, GetAsyncKeyState);
# nada de enviar tecla, ler memória ou mexer no processo do jogo. Nada de imagem em disco.
# Formato real do ping (MEDICAO § 4): "mm:ss <aliado> (<campeão>): <inimigo> usou <feitiço>".
import base64
import ctypes
import difflib
import io
import json
import logging
import re
import subprocess
import threading
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CALIBRACAO_PADRAO = RAIZ / "dados" / "calibracao-chat.json"
log = logging.getLogger("coletor.feiticos")   # cai no dados\coletor.log (handler do logger "coletor")

# recarga base (s) do summoner-spells.json da LCU, modo CLASSIC (13/10/2026); a LCU manda quando houver
RECARGA_BASE = {"Flash": 300, "Teleporte": 300, "Incendiar": 180, "Barreira": 180, "Exaustão": 240,
                "Curar": 240, "Fantasma": 240, "Purificar": 240}
SEM_CRONOMETRO = ("Golpear", "Golpe Irrestrito", "Golpe Primordial")  # Smite: 2 cargas, não vale cronômetro
RUNA_PERSPICACIA = 8347          # Perspicácia Cósmica: +18 de aceleração de feitiço de invocador
ARVORE_INSPIRACAO = 8300         # a runa só existe nessa árvore
ACEL_RUNA = 18
ACEL_BOTA = {3158: 10, 3171: 20}  # Botas Ionianas da Lucidez, Lucidez Escarlate (3171 vem de 3158)
ROTAS = ("TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY")  # atalho 1..5 (ordem das batidas do F7)
# como a rota sai na fala/rótulo do retorno do F7 e do feitiço que voltou (frase genérica: sem nome de
# campeão, que a voz pré-gravada não tem). Dona da tabela: avisos.py (catálogo do pacote de voz)
from avisos import ROTA_FALA, rota_fala  # noqa: E402
JANELA_DEDUPE = 60    # mesmo (inimigo, feitiço) com horário a <= 60 s = o mesmo gasto (aliados repetem o ping)
LINHA_VELHA = 300     # linha de chat > 300 s antes do gameTime (maior recarga): leitura errada ou inútil.
                      # a linha fica na tela bem mais que 90 s (00562.0: ping de 7:06 lido aos 9:22)
ITEM_VELHO = 60       # item do inimigo sem mudança visível há > 60 s na hora do ping: bota "±"
# desfazer (segurar F7) = a última AÇÃO do atalho (pilha Feiticos._pilha_f7), até DESFAZ_PRAZO_S depois dela: errou a
# rota, percebe quando ouve "flash do mid marcado". Gasto que o chat viu (antes ou depois do F7) nunca se apaga. Até
# 14/10 ~20:30 era "mesmo número de novo em 10 s", que com o F7 sozinho viraria armadilha (marcar o top de novo em 10 s
# apagaria a marcação); a 1ª versão do segurar procurava "a mais nova do atalho" em usos e tirava a de OUTRO inimigo
# quando a última batida tinha caído num gasto do chat (revisão do passo 10, D37).
DESFAZ_PRAZO_S = 60

# Medidas da HUD em 2560x1080 (MEDICAO § 4, a tela do mantenedor), a referência: em outra resolução tudo escala pela
# ALTURA (a HUD do LoL cresce com a altura da tela) e as faixas saem de faixas_calibrar(largura, altura). Até 19/10/2026
# eram coordenadas absolutas desta tela: em 2560x1440 ou 3840x2160 o chat padrão fica abaixo de y=1080 e a calibração
# devolvia None para sempre (revisão do P0 da publicação; prova em tools/teste-instalacao.py). A antiga CAIXA_RESERVA
# (1400, 815, 1900, 985) saiu: ninguém a lia.
ALTURA_REF = 1080
FAIXA_CALIBRAR = (1000, 620, 2150, 1080)   # onde procurar o chat (fora do minimapa, x >= 2179)
# onde procurar, em ordem: a faixa da HUD dele (chat movido para a direita do meio) e o canto de baixo à esquerda (onde
# o LoL põe o chat por padrão: HUD reiniciada). Cada faixa × a escala do OCR fica abaixo de 2600 px, o máximo do
# Windows.Media.Ocr (OcrEngine.MaxImageDimension): escala_ocr baixa a escala quando a faixa é maior
FAIXAS_CALIBRAR = (FAIXA_CALIBRAR, (0, 620, 1150, 1080))   # = faixas_calibrar(2560, 1080)
OCR_MAX_PX = 2600


def faixas_calibrar(largura, altura):
    """as FAIXAS_CALIBRAR desta tela: a direita do meio (HUD do mantenedor) e o canto de baixo à esquerda (padrão do
    LoL), em px da tela. Em 2560x1080 dá exatamente as FAIXAS_CALIBRAR. A faixa da direita para antes do minimapa
    (410 px de referência da borda direita)."""
    k = altura / ALTURA_REF
    meio = largura / 2
    topo = altura - 460 * k
    direita = (meio - 280 * k, topo, min(meio + 870 * k, largura - 410 * k), altura)
    esquerda = (0, topo, min(1150 * k, largura), altura)
    return tuple(tuple(int(round(v)) for v in f) for f in (direita, esquerda))


def escala_ocr(caixa, base):
    """a escala do OCR para um recorte: `base` (2 na calibração, 3 na leitura), menor quando recorte × base passaria de
    OCR_MAX_PX (o Windows.Media.Ocr recusa imagem maior). Em 1080 de altura é sempre a base"""
    lado = max(caixa[2] - caixa[0], caixa[3] - caixa[1], 1)
    return base if lado * base < OCR_MAX_PX else (OCR_MAX_PX - 1) / lado
# recorte sem nenhuma linha "mm:ss" por este número de prints seguidos com o jogo na tela (~60 s a 3 s por print) =
# chat fora do recorte: recalibra. Partida de 15/10/2026: o recorte de 13/10 era usado para sempre e, de
# 14/10 ~19h em diante, 9 ranqueadas seguidas sem um único ping lido e nada no log que dissesse por quê
RECALIBRAR_PRINTS = 20
RECALIBRAR_MAX = 160    # entre tentativas que não acharam outro recorte, a espera dobra até isto (~8 min)
TITULO_JOGO = "League of Legends (TM) Client"


def recarga(base, aceleracao):
    """base × 100/(100 + aceleração): Flash 300 com 3158 = 272,7; 3158 + runa = 234,4"""
    return base * 100.0 / (100.0 + aceleracao)


def mmss(s):
    s = max(0, int(round(s)))
    return f"{s // 60}:{s % 60:02d}"


# ---------- OCR do Windows (processo PowerShell persistente) ----------

# só ASCII: o PowerShell 5.1 lê script sem BOM como ANSI (ARMADILHAS § Windows)
_PS_OCR = r"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$t) {
  $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result
}
$eng = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language 'pt-BR'))
if ($eng -eq $null) { [Console]::Out.WriteLine('{"erro":"sem OCR pt-BR"}'); exit 1 }
[Console]::Out.WriteLine('{"pronto":true}'); [Console]::Out.Flush()
while ($true) {
  $l = [Console]::In.ReadLine()
  if ($l -eq $null -or $l -eq '') { break }
  try {
    $bytes = [Convert]::FromBase64String($l)
    $ms = New-Object System.IO.MemoryStream(,$bytes)
    $ras = [System.IO.WindowsRuntimeStreamExtensions]::AsRandomAccessStream($ms)
    $d = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($ras)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $b = Await ($d.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $r = Await ($eng.RecognizeAsync($b)) ([Windows.Media.Ocr.OcrResult])
    $linhas = New-Object System.Collections.ArrayList
    foreach ($ln in $r.Lines) {
      $ps = New-Object System.Collections.ArrayList
      foreach ($w in $ln.Words) {
        $q = $w.BoundingRect
        [void]$ps.Add(@{ t = $w.Text; x = [int]$q.X; y = [int]$q.Y; w = [int]$q.Width; h = [int]$q.Height })
      }
      [void]$linhas.Add(@{ t = $ln.Text; p = $ps })
    }
    $json = ConvertTo-Json -InputObject @{ linhas = $linhas } -Compress -Depth 6
    $b.Dispose(); $ras.Dispose(); $ms.Dispose()
  } catch { $json = ConvertTo-Json -InputObject @{ erro = $_.Exception.Message } -Compress }
  [Console]::Out.WriteLine($json); [Console]::Out.Flush()
}
"""


class OcrChat:
    """OCR do Windows em pt-BR num PowerShell que fica de pé (abrir um por print custa ~1 s).
    A imagem vai em base64 pelo stdin (sem arquivo: o chat tem nome de terceiros).
    ler(imagem PIL, escala) -> [{"t": texto, "p": [{"t","x","y","w","h"}]}] em px da imagem original."""

    def __init__(self, timeout=10.0):
        self.timeout = timeout
        self.proc = None
        self.trava = threading.Lock()

    def iniciar(self):
        if self.proc and self.proc.poll() is None:
            return self
        cmd = base64.b64encode(_PS_OCR.encode("utf-16-le")).decode()
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "BELOW_NORMAL_PRIORITY_CLASS", 0)
        self.proc = subprocess.Popen(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", cmd],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, creationflags=flags)
        r = self._resposta(max(self.timeout, 30.0))   # 1ª carga do WinRT leva alguns segundos
        if not r.get("pronto"):
            self.parar()
            raise RuntimeError(f"OCR do Windows indisponível: {r.get('erro', r)}")
        return self

    def _resposta(self, timeout=None):
        """uma linha do PowerShell com prazo: travou (RecognizeAsync/decoder sem fim) → mata o processo,
        que solta o readline; o próximo ler() sobe outro. Sem isso a thread do OCR ficava presa calada."""
        proc, prazo = self.proc, timeout or self.timeout
        estourou = threading.Event()

        def matar():
            estourou.set()
            try:
                proc.kill()
            except Exception:
                pass
        t = threading.Timer(prazo, matar)
        t.daemon = True
        t.start()
        try:
            linha = proc.stdout.readline()
        finally:
            t.cancel()
        if estourou.is_set():
            self.proc = None
            raise RuntimeError(f"OCR: sem resposta em {prazo:g} s (PowerShell encerrado; sobe outro no próximo print)")
        if not linha:
            raise RuntimeError("OCR: processo do PowerShell morreu")
        return json.loads(linha.decode("utf-8", "replace").lstrip("\ufeff"))

    def ler(self, imagem, escala=3):
        from PIL import Image
        im = imagem.convert("RGB")
        if escala != 1:
            im = im.resize((round(im.width * escala), round(im.height * escala)), Image.LANCZOS)
        buf = io.BytesIO()
        im.save(buf, format="PNG", compress_level=1)
        with self.trava:
            if not self.proc or self.proc.poll() is not None:
                self.iniciar()
            self.proc.stdin.write(base64.b64encode(buf.getvalue()) + b"\n")
            self.proc.stdin.flush()
            r = self._resposta()
        if "erro" in r:
            raise RuntimeError(f"OCR: {r['erro']}")
        linhas = r.get("linhas") or []
        if isinstance(linhas, dict):   # PowerShell 5.1 desembrulha lista de 1
            linhas = [linhas]
        for ln in linhas:
            ps = ln.get("p") or []
            ln["p"] = [ps] if isinstance(ps, dict) else ps
            for w in ln["p"]:
                for k in ("x", "y", "w", "h"):
                    w[k] = w[k] / escala
        return linhas

    def parar(self):
        p, self.proc = self.proc, None
        if p and p.poll() is None:
            try:
                p.stdin.write(b"\n")
                p.stdin.flush()
                p.wait(timeout=3)
            except Exception:
                p.kill()


# ---------- calibração do recorte do chat ----------

_TS = re.compile(r"^\W{0,2}([0-9OoIlS/]{2})\s?[:;.,]\s?([0-9OoIlS/]{2})\b")


def _ts_norm(texto):
    """'O7;O6 ...' -> '07:06' (confusões comuns do OCR), ou None. '/' = 7 com o topo cortado
    (linha mais velha do chat sai pela borda de cima: '0/:06')"""
    m = _TS.match(texto or "")
    if not m:
        return None
    t = (m.group(1) + ":" + m.group(2)).translate(str.maketrans("OoIlS/", "001157"))
    return t if re.fullmatch(r"\d\d:\d\d", t) and int(t[3:]) < 60 else None


def calibrar_chat(tela, ocr, faixa=None):
    """tela = print inteiro do monitor do jogo (PIL). Acha as linhas do chat pelo horário mm:ss no
    começo e devolve a caixa (x0, y0, x1, y1) em px da tela, ou None (sem linha de chat: jogo fora da
    tela, chat vazio). O chat cresce para cima a partir da base: a caixa vai da base até 170 px acima.
    faixa None = faixas_calibrar(tamanho da tela) em ordem (a 1ª que achar). As medidas em px (margem da coluna, piso
    de largura, altura da caixa) são de 1080 de altura e escalam pela altura da tela, como a HUD."""
    if faixa is None:
        for f in faixas_calibrar(tela.width, tela.height):
            c = calibrar_chat(tela, ocr, f)
            if c:
                return c
        return None
    k = tela.height / ALTURA_REF
    px = lambda v: int(round(v * k))  # noqa: E731
    x0, y0, x1, y1 = faixa
    x1, y1 = min(x1, tela.width), min(y1, tela.height)
    linhas = ocr.ler(tela.crop((x0, y0, x1, y1)), escala=escala_ocr((x0, y0, x1, y1), 2))
    caixas = []
    for ln in linhas:
        ps = ln["p"]
        if ps and _ts_norm(ln["t"]):
            esq = min(w["x"] for w in ps)
            caixas.append((esq, min(w["y"] for w in ps), max(w["x"] + w["w"] for w in ps),
                           max(w["y"] + w["h"] for w in ps)))
    if len(caixas) < 2:
        return None
    # o chat é uma coluna: fica com o grupo de linhas de mesma margem esquerda (±12 px)
    esq = sorted(c[0] for c in caixas)[len(caixas) // 2]
    col = [c for c in caixas if abs(c[0] - esq) <= px(12)]
    if len(col) < 2:
        return None
    base = max(c[3] for c in col)
    esq = min(c[0] for c in col)
    # linha longa quebra na largura do chat; o print da calibração pode só ter linhas curtas: piso de 460 px
    dir_ = max(max(c[2] for c in col) + px(40), esq + px(460))
    cx0 = int(x0 + esq - px(12))
    cx1 = int(min(x0 + dir_, x0 + esq + px(520), x1))
    cy1 = int(min(y0 + base + px(8), y1))
    return (cx0, max(0, cy1 - px(170)), cx1, cy1)


def ler_calibracao(caminho=CALIBRACAO_PADRAO, tamanho=None):
    try:
        d = json.loads(Path(caminho).read_text(encoding="utf-8"))
        if tamanho and tuple(d.get("tela", ())) != tuple(tamanho):
            return None
        return tuple(d["chat"])
    except (OSError, ValueError, KeyError):
        return None


def gravar_calibracao(caixa, tamanho, caminho=CALIBRACAO_PADRAO):
    Path(caminho).parent.mkdir(parents=True, exist_ok=True)
    Path(caminho).write_text(json.dumps({"tela": list(tamanho), "chat": list(caixa),
                                         "ts": time.strftime("%Y-%m-%d %H:%M:%S")}), encoding="utf-8")


# ---------- leitura das linhas do chat ----------

_DESCARTE = re.compile(r"Vivo|Espere|Precisa|\bR\s*[-–]|ouro", re.I)
_CANAL = re.compile(r"^\s*\[(Todos|Equipe|All|Team)\]\s*", re.I)


def _norm(s):
    return re.sub(r"[^\wÀ-ÿ' ]+", "", (s or "").lower()).strip()


def _sim(a, b):
    return difflib.SequenceMatcher(None, _norm(a), _norm(b)).ratio()


def juntar_linhas(textos):
    """linha que não começa com horário é continuação (o chat quebra linha longa)"""
    out = []
    for t in textos:
        t = (t or "").strip()
        if not t:
            continue
        if _ts_norm(_CANAL.sub("", t)) or not out:
            out.append(t)
        else:
            out[-1] += " " + t
    return out


def ler_ping(texto, inimigos, feiticos=None):
    """uma linha do chat -> {"ts": s, "aliado", "inimigo", "feitico", "usou"} ou None.
    inimigos: nomes dos 5 inimigos como a Live Client dá (mesma língua do chat);
    feiticos: nomes aceitos (padrão: RECARGA_BASE + Smite). Descarta Vivo(a), Espere por R,
    'usou R - <ult>' e '<item> - Precisa de N de ouro'."""
    feiticos = list(feiticos or (list(RECARGA_BASE) + list(SEM_CRONOMETRO)))
    t = (texto or "").strip()
    ts = _ts_norm(t)
    if not ts:
        return None
    resto = _TS.sub("", t, count=1).strip()
    resto = _CANAL.sub("", resto)
    m = re.search(r"\(([^()]{2,24})\)\s*[:;.,]?\s*", resto)
    if not m:
        return None
    aliado, msg = m.group(1).strip(), resto[m.end():].strip()
    if not msg or _DESCARTE.search(msg):
        return None
    pal = msg.split()
    melhor = (0.0, None, 0)
    for nome in inimigos:
        k = len(nome.split())
        if len(pal) > k:
            s = _sim(" ".join(pal[:k]), nome)
            if s > melhor[0]:
                melhor = (s, nome, k)
    if melhor[0] < 0.75:
        return None
    rest = pal[melhor[2]:]
    usou = bool(rest) and _sim(rest[0], "usou") >= 0.75
    if usou:
        rest = rest[1:]
    if not rest:
        return None
    alvo = " ".join(rest)
    f = max(feiticos, key=lambda n: _sim(alvo, n))
    if _sim(alvo, f) < 0.6:
        # "Teleporte Desencadeado" e afins: aceita pelo prefixo
        f = next((n for n in feiticos if _norm(alvo).startswith(_norm(n))), None)
        if not f:
            return None
    mm, ss = ts.split(":")
    return {"ts": int(mm) * 60 + int(ss), "aliado": aliado, "inimigo": melhor[1], "feitico": f, "usou": usou}


# ---------- estado dos feitiços inimigos ----------

def _eu(live):
    ap = live.get("activePlayer") or {}
    chave = ap.get("riotId") or ap.get("riotIdGameName") or ap.get("summonerName")
    for p in live.get("allPlayers") or []:
        if chave and chave in (p.get("riotId"), p.get("riotIdGameName"), p.get("summonerName")):
            return p
    return None


class Feiticos:
    """Cronômetro dos feitiços de invocador dos 5 inimigos.
    atualizar(allgamedata) a cada amostra da Live Client (1 s); processar_linhas(textos, gt) com o OCR
    do chat; marcar(n, gt)/desfazer(gt) com o atalho F7; estado(gt) para o painel; voltaram(gt) para a voz.
    runas_por_campeao: {championId: [perkIds]} do spectator-v5 (riotapi), opcional;
    campeao_id: {nome da Live Client: championId} (champion-summary da LCU), para casar os dois."""

    def __init__(self, recarga_base=None, runas_por_campeao=None, campeao_id=None):
        self.base = dict(recarga_base or RECARGA_BASE)
        self.runas = runas_por_campeao or {}
        self.campeao_id = campeao_id or {}
        self.inimigos = {}      # nome -> {rota, feiticos, arvores, itens, visto_em, assinatura}
        self.ordem = []         # nomes na ordem do atalho (TOP..UTILITY)
        self.gt = 0.0
        self.usos = {}          # (inimigo, feitiço) -> [uso, ...]; uso = dict
        self.anunciados = set()
        self.ultima_leitura = {"novos": 0, "confirmados": 0, "sem_usou": []}   # resumo do último processar_linhas
        self.minha_posicao = ""  # TOP..UTILITY do activePlayer (a 1ª batida do F7 seleciona o adversário dela)
        self._sem_usou = set()  # (inimigo, feitiço, ts) de pings sem "usou" já logados
        self._pilha_f7 = []     # ações do atalho (desfazer), a mais nova no fim: {"uso", "em" (gt do aperto)}

    def definir_runas(self, runas_por_campeao):
        """as runas do spectator chegam depois (thread do carregamento): vale para os próximos gastos"""
        self.runas = dict(runas_por_campeao or {})

    # -- Live Client --
    def atualizar(self, live):
        gd = live.get("gameData") or {}
        self.gt = float(gd.get("gameTime") or 0.0)
        eu = _eu(live)
        if not eu:
            return
        self.minha_posicao = (eu.get("position") or "").upper()
        for p in live.get("allPlayers") or []:
            if p.get("team") == eu.get("team"):
                continue
            nome = p.get("championName")
            itens = sorted(i.get("itemID") for i in p.get("items") or [])
            sc = p.get("scores") or {}
            assinatura = (p.get("level"), tuple(itens), sc.get("creepScore"))
            atual = self.inimigos.get(nome)
            runes = p.get("runes") or {}
            reg = {
                "rota": (p.get("position") or "").upper(),
                "feiticos": [s.get("displayName") for s in (p.get("summonerSpells") or {}).values()],
                "arvores": {(runes.get("primaryRuneTree") or {}).get("id"), (runes.get("secondaryRuneTree") or {}).get("id")},
                "itens": itens,
                "assinatura": assinatura,
                "visto_em": self.gt if not atual or atual["assinatura"] != assinatura else atual["visto_em"],
            }
            self.inimigos[nome] = reg
        ordem = sorted(self.inimigos, key=lambda n: ROTAS.index(self.inimigos[n]["rota"])
                       if self.inimigos[n]["rota"] in ROTAS else 9)
        self.ordem = ordem

    # -- aceleração --
    def _aceleracao(self, inimigo, gt):
        reg = self.inimigos.get(inimigo) or {}
        motivos, incerto, acel_runa_talvez = [], False, False
        acel = 0
        cid = self.campeao_id.get(inimigo)
        perks = self.runas.get(cid) if cid is not None else None
        if perks is not None:
            if RUNA_PERSPICACIA in perks:
                acel += ACEL_RUNA
                motivos.append("Perspicácia Cósmica")
        elif ARVORE_INSPIRACAO in (reg.get("arvores") or set()):
            incerto, acel_runa_talvez = True, True
            motivos.append("runa ±")
        bota = max((ACEL_BOTA.get(i, 0) for i in reg.get("itens") or []), default=0)
        if bota:
            acel += bota
            motivos.append(f"bota +{bota}")
        if reg and gt - reg.get("visto_em", gt) > ITEM_VELHO:
            incerto = True
            motivos.append("item ±")
        return acel, acel_runa_talvez, incerto, motivos

    def _novo_uso(self, inimigo, feitico, ts, fonte):
        base = self.base.get(feitico)
        if base is None:
            base = next((v for k, v in self.base.items() if feitico.startswith(k)), None)
        if base is None or feitico in SEM_CRONOMETRO:
            return None
        acel, talvez, incerto, motivos = self._aceleracao(inimigo, ts)
        volta_max = ts + recarga(base, acel)
        volta = ts + recarga(base, acel + ACEL_RUNA) if talvez else volta_max
        return {"inimigo": inimigo, "feitico": feitico, "ts": ts, "volta_em": volta, "volta_max": volta_max,
                "incerto": incerto, "motivos": motivos, "fonte": fonte, "votos": {ts: 1}}

    def registrar(self, inimigo, feitico, ts, fonte="chat"):
        """gasto visto: devolve o uso (novo ou o mesmo de antes, se for repetição do ping)"""
        return self._registrar(inimigo, feitico, ts, fonte)[0]

    def _registrar(self, inimigo, feitico, ts, fonte="chat"):
        """(uso, novo?): novo = False quando é repetição de um gasto já registrado (dedupe)"""
        lista = self.usos.setdefault((inimigo, feitico), [])
        for u in lista:
            if abs(u["ts"] - ts) <= JANELA_DEDUPE:
                if fonte == "chat":
                    u["chat"] = True   # o chat viu este gasto: o segurar F7 não apaga (Feiticos.desfazer)
                u["votos"][ts] = u["votos"].get(ts, 0) + 1
                novo_ts = min(u["votos"], key=lambda t: (-u["votos"][t], t))   # moda; empate = o mais cedo
                if novo_ts != u["ts"] and u["fonte"] == "chat":
                    d = novo_ts - u["ts"]
                    u["ts"], u["volta_em"], u["volta_max"] = novo_ts, u["volta_em"] + d, u["volta_max"] + d
                return u, False
        u = self._novo_uso(inimigo, feitico, ts, fonte)
        if u:
            lista.append(u)
        return u, bool(u)

    def processar_linhas(self, textos, gt=None):
        """linhas do OCR de um print do chat -> só os usos NOVOS (a linha fica na tela 2 min ou mais e é relida a
        cada print: devolver também os confirmados fazia o coach logar "N gasto(s)" a cada 3 s pelo mesmo ping e
        não deixava saber quando um gasto entrou, partida de 14/10/2026 15:48). O resumo do print fica em `ultima_leitura`:
        novos, confirmados (repetição) e os pings sem "usou" vistos pela 1ª vez (não ligam cronômetro, mas vão ao
        log: é o candidato a "marquei e não funcionou" que ainda não tem prova)."""
        gt = self.gt if gt is None else gt
        out, confirmados, sem_usou, pings = [], 0, [], 0
        for e in juntar_linhas(textos):
            p = ler_ping(e, list(self.inimigos), list(self.base) + list(SEM_CRONOMETRO))
            if not p:
                continue
            pings += 1   # ping de feitiço reconhecido no print (novo, repetido, velho ou sem "usou"): o resumo do log
            if not (-2 <= gt - p["ts"] <= LINHA_VELHA):
                continue
            if not p["usou"]:
                chave = (p["inimigo"], p["feitico"], p["ts"])
                if chave not in self._sem_usou:   # sem "usou" não diz que gastou: não liga cronômetro
                    self._sem_usou.add(chave)
                    sem_usou.append({"inimigo": p["inimigo"], "feitico": p["feitico"], "ts": p["ts"]})
                continue
            u, novo = self._registrar(p["inimigo"], p["feitico"], p["ts"], "chat")
            if u and novo:
                out.append(u)
            elif u:
                confirmados += 1
        self.ultima_leitura = {"novos": len(out), "confirmados": confirmados, "sem_usou": sem_usou, "pings": pings}
        return out

    def previa(self, n):
        """o que a batida do F7 seleciona antes de marcar: {"n", "rota", "inimigo", "feitico"} para o rótulo
        "flash: mid?". rota = ROTA_FALA do inimigo nessa posição; sem posição na Live Client (blind, ARAM) a ordem é a
        do allPlayers e a rota seria mentira, então vai o nome do campeão (o rótulo pode ter nome; a voz, não); sem
        inimigo (treino) = a rota da tecla. feitico = o que marcar(n) marcaria ("flash", minúsculo)"""
        r = {"n": n, "rota": ROTA_FALA[ROTAS[n - 1]] if 1 <= n <= len(ROTAS) else "?", "inimigo": None,
             "feitico": "flash"}
        if 1 <= n <= len(self.ordem):
            nome = self.ordem[n - 1]
            reg = self.inimigos[nome]
            rota = rota_fala(reg.get("rota"))
            fs = [f for f in reg["feiticos"] if f not in SEM_CRONOMETRO]
            f = "Flash" if "Flash" in fs else (fs[0] if fs else "Flash")
            r.update(inimigo=nome, rota=nome if rota == "inimigo" else rota, feitico=(str(f).split() or ["flash"])[0].lower())
        return r

    def marcar(self, n, gt=None):
        """atalho n (1..5 = TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY): Flash dele gasto agora. Marcar de novo o mesmo
        (aliado no chat ou outra batida) é o mesmo gasto (dedupe de 60 s), nunca desfaz: desfazer é desfazer().
        Devolve sempre o resultado, para o retorno ao jogador:
        {"resultado": "marcado"|"sem_inimigo"|"sem_feitico", "n", "rota" (ROTA_FALA: top,
        jungler, mid, atirador, suporte; "inimigo" se ele veio sem posição), "inimigo", "feitico", "uso"}. Sem inimigo na posição n (modo
        treino, personalizada sozinho) = "sem_inimigo"."""
        gt = self.gt if gt is None else gt
        r = {"resultado": "sem_inimigo", "n": n, "rota": ROTA_FALA[ROTAS[n - 1]] if 1 <= n <= len(ROTAS) else None,
             "inimigo": None, "feitico": None, "uso": None}
        if not (1 <= n <= len(self.ordem)):
            return r
        nome = self.ordem[n - 1]
        reg = self.inimigos[nome]
        # rota de verdade do inimigo (a Live Client dá). Sem posição (blind, ARAM, personalizada) a ordem
        # é a do allPlayers, então a rota da tecla seria mentira: a fala diz só "inimigo"
        r.update(inimigo=nome, rota=rota_fala(reg.get("rota")))
        fs = [f for f in reg["feiticos"] if f not in SEM_CRONOMETRO]
        f = "Flash" if "Flash" in fs else (fs[0] if fs else None)
        if not f:
            r["resultado"] = "sem_feitico"
            return r
        r["feitico"] = f
        u = self.registrar(nome, f, gt, "atalho")
        if u:   # novo ou o mesmo gasto de antes (dedupe): a ação vai à pilha do desfazer do mesmo jeito
            self._pilha_f7.append({"uso": u, "em": gt})
        r.update(resultado="marcado" if u else "sem_feitico", uso=u)   # sem recarga conhecida: nada a marcar
        return r

    def _vivo(self, u, gt):
        """o uso segue em usos (não foi desfeito) e o cronômetro ainda corre"""
        return any(x is u for x in self.usos.get((u["inimigo"], u["feitico"]), [])) and u["volta_em"] > gt

    def desfazer(self, gt=None):
        """segurar F7: desfaz a última AÇÃO do atalho (pilha _pilha_f7), até DESFAZ_PRAZO_S depois dela.
        - o gasto que ela marcou foi visto no chat (antes, ou um aliado pingou depois) -> "do_chat": fica, só sai o voto
          dela (não foi ele quem decidiu sozinho; a 1ª versão apagava a marcação de OUTRO inimigo nesse caso);
        - senão -> "desfeito": o uso sai de usos, com todas as ações que caíram nele (duas batidas lentas no mesmo = 1
          gasto: 1 segurar desfaz, o seguinte vai à ação anterior);
        - nada vivo na pilha, ou a última ação tem mais de DESFAZ_PRAZO_S -> "nada_a_desfazer" (F7 segurado sem querer
          minutos depois não apaga a marcação certa).
        {"resultado", "rota" (ROTA_FALA), "inimigo", "feitico", "uso"}"""
        gt = self.gt if gt is None else gt
        r = {"resultado": "nada_a_desfazer", "rota": None, "inimigo": None, "feitico": None, "uso": None}
        while self._pilha_f7 and not self._vivo(self._pilha_f7[-1]["uso"], gt):
            self._pilha_f7.pop()           # desfeita antes, ou o cronômetro já venceu
        if not self._pilha_f7 or gt - self._pilha_f7[-1]["em"] > DESFAZ_PRAZO_S:
            return r
        acao = self._pilha_f7.pop()
        u = acao["uso"]
        r.update(rota=self.rota_de(u["inimigo"]), inimigo=u["inimigo"], feitico=u["feitico"], uso=u)
        if u["fonte"] == "chat" or u.get("chat"):
            votos, t = u["votos"], acao["em"]   # o voto desta ação (marcar vota no horário em que ele apertou)
            if votos.get(t, 0) > 1:
                votos[t] -= 1
            elif t in votos and len(votos) > 1:
                del votos[t]
            r["resultado"] = "do_chat"
            return r
        self.usos[(u["inimigo"], u["feitico"])] = [x for x in self.usos[(u["inimigo"], u["feitico"])] if x is not u]
        self._pilha_f7 = [a for a in self._pilha_f7 if a["uso"] is not u]
        r["resultado"] = "desfeito"
        return r

    def n_adversario(self):
        """o número do atalho do meu adversário direto (a minha posição: TOP = 1 ... UTILITY = 5), onde a 1ª batida
        do F7 começa; None sem posição (blind, ARAM) ou sem inimigo nela"""
        pos = getattr(self, "minha_posicao", "")
        if pos not in ROTAS:
            return None
        n = ROTAS.index(pos) + 1
        return n if n <= len(self.ordem) and self.inimigos[self.ordem[n - 1]].get("rota") == pos else None

    def rota_de(self, inimigo):
        """como a fala chama o inimigo (ROTA_FALA: top, jungler, mid, atirador, suporte; 'inimigo' sem posição)"""
        return rota_fala((self.inimigos.get(inimigo) or {}).get("rota"))

    def atalho(self, n, gt=None):
        """como marcar(), devolvendo só o uso (None = sem inimigo ou sem feitiço)"""
        return self.marcar(n, gt)["uso"]

    def estado(self, gt=None):
        """para o painel: só o que está em recarga, do que volta antes para o que volta depois"""
        gt = self.gt if gt is None else gt
        out = []
        for lista in self.usos.values():
            for u in lista:
                if u["volta_em"] > gt:
                    rest = u["volta_em"] - gt
                    out.append({"inimigo": u["inimigo"], "feitico": u["feitico"], "desde": u["ts"],
                                "volta_em": round(u["volta_em"], 1), "restante": round(rest, 1),
                                "incerto": u["incerto"], "fonte": u["fonte"],
                                "texto": f"{u['inimigo']} sem {u['feitico']} {mmss(rest)}" + (" ±" if u["incerto"] else "")})
        return sorted(out, key=lambda x: x["volta_em"])

    def voltaram(self, gt=None):
        """feitiços que voltaram desde a última chamada (para a voz: 'Yasuo com Flash')"""
        gt = self.gt if gt is None else gt
        out = []
        for lista in self.usos.values():
            for u in lista:
                chave = (u["inimigo"], u["feitico"], u["ts"])
                if u["volta_em"] <= gt and chave not in self.anunciados:
                    self.anunciados.add(chave)
                    txt = f"{u['inimigo']} com {u['feitico']}"
                    # tipo/chave/dados no formato do avisos.Aviso: a fala sai do molde "feitico_voltou" do
                    # avisos.TEXTOS ("flash do mid voltou", genérica, no pacote de voz); o rótulo leva o nome
                    reg = self.inimigos.get(u["inimigo"]) or {}
                    f = (str(u["feitico"]).split() or ["?"])[0].lower()
                    out.append({"inimigo": u["inimigo"], "feitico": u["feitico"], "texto": txt,
                                "tipo": "feitico_voltou", "chave": f"{u['inimigo']}:{u['feitico']}:{int(u['ts'])}",
                                "dados": {"rota": rota_fala(reg.get("rota")), "feitico": f, "feitico_nome": u["feitico"],
                                          "campeao": u["inimigo"], "incerto": u["incerto"]}})
        return out


# ---------- runas dos inimigos (spectator-v5, frente riot-api) ----------

def runas_do_espectador(partida_ativa):
    """resposta do spectator-v5 (active-games/by-summoner/{puuid}) -> {championId: [perkIds]}.
    Guarda só campeão e runas: nunca riotId nem puuid (MEDICAO § 4)."""
    out = {}
    for p in (partida_ativa or {}).get("participants") or []:
        cid = p.get("championId")
        perks = (p.get("perks") or {}).get("perkIds")
        if cid and perks:
            out[int(cid)] = [int(x) for x in perks]
    return out


def buscar_runas(puuid_api):
    """1 chamada br1 ao spectator-v5 por riotapi.cliente().partida_ativa(puuid). O puuid é o da Riot
    API (carregamento.Carregamento.meu_puuid_api), não o da LCU. Melhor ainda: reaproveitar o `ativa`
    que o Carregamento já buscou (runas_do_espectador(ativa)) e não gastar outra chamada.
    Sem chave, sem partida ou erro -> {} e o cronômetro marca '±'."""
    try:
        import riotapi  # noqa: PLC0415  (coletor/ no sys.path, como banco)
        return runas_do_espectador(riotapi.cliente().partida_ativa(puuid_api))
    except Exception:
        return {}


def ids_por_nome(estatico):
    """{nome da Live Client (pt-BR): championId} a partir do sugestoes.carregar_estatico()"""
    return {v["nome"]: v["id"] for v in estatico["campeoes"].values()}


# ---------- tela: jogo em primeiro plano e captura ----------

def jogo_na_tela():
    """a janela em primeiro plano é o jogo? (o print é do monitor: 11% dos recortes eram outra janela)"""
    u = ctypes.windll.user32
    h = u.GetForegroundWindow()
    buf = ctypes.create_unicode_buffer(256)
    u.GetWindowTextW(h, buf, 256)
    return buf.value == TITULO_JOGO


def capturar(caixa=None, monitor=None):
    """print (PIL) de uma caixa (x0, y0, x1, y1) do monitor do jogo, ou dele inteiro. Só em memória.
    Monitor = o do jogo (minimapa.monitor_do_jogo: resolução do game.cfg, senão o principal); o
    `sct.monitors[1]` do mss nesta máquina é a 2ª tela (painel, navegador, conversas)."""
    import mss
    from PIL import Image
    with mss.MSS() as sct:
        if monitor is None:
            import minimapa  # tardio: cv2 só quando captura de verdade
            monitor = minimapa.monitor_do_jogo(sct.monitors)
        mon = monitor
        if caixa:
            x0, y0, x1, y1 = caixa
            reg = {"left": mon["left"] + x0, "top": mon["top"] + y0, "width": x1 - x0, "height": y1 - y0}
        else:
            reg = mon
        g = sct.grab(reg)
        return Image.frombytes("RGB", g.size, g.bgra, "raw", "BGRX")


def com_horario(textos):
    """quantas linhas (já juntadas) de um print começam com "mm:ss": chat dentro do recorte. Kill, objetivo e ping
    têm horário; recorte sem nenhuma por RECALIBRAR_PRINTS prints = o chat não está ali"""
    return sum(1 for e in juntar_linhas(textos) if _ts_norm(_CANAL.sub("", e)))


def _mesma_caixa(a, b, tol=12):
    return bool(a and b) and all(abs(p - q) <= tol for p, q in zip(a, b))


class LeitorChat:
    """laço do OCR do chat: passo(gt) a cada ~3 s durante a partida (o integrador chama).
    Pausa sem o jogo em primeiro plano; calibra o recorte no 1º print com linha de chat e guarda em
    dados/calibracao-chat.json (a posição do chat é da HUD, não está no game.cfg). Recorte sem linha "mm:ss" por
    RECALIBRAR_PRINTS prints seguidos (chat movido, escala trocada, HUD reiniciada) = recalibra pelas FAIXAS_CALIBRAR;
    sem outro recorte, a espera dobra até RECALIBRAR_MAX. `contagem` (prints, fora da tela, linhas, com horário,
    recalibrações) vai ao resumo do coach no log: antes, OCR que não lia nada não deixava rastro nenhum."""

    def __init__(self, feiticos, ocr=None, calibracao=CALIBRACAO_PADRAO, captura=capturar, na_tela=jogo_na_tela):
        self.f = feiticos
        self.ocr = ocr or OcrChat()
        self.calibracao = calibracao
        self.captura, self.na_tela = captura, na_tela
        self.caixa = None
        self.contagem = {"prints": 0, "fora_da_tela": 0, "sem_recorte": 0, "linhas": 0, "com_horario": 0,
                         "recalibrou": 0, "recalibrar_falhou": 0}
        self._sem_horario = 0               # prints seguidos com o jogo na tela e nenhuma linha "mm:ss" no recorte
        self._espera = RECALIBRAR_PRINTS

    def passo(self, gt=None):
        if not self.na_tela():
            self.contagem["fora_da_tela"] += 1
            return []
        if not self.caixa:
            tela = self.captura()
            self.caixa = ler_calibracao(self.calibracao, tela.size)
            if self.caixa:
                log.info("chat: recorte %s da calibração salva (tela %dx%d)", self.caixa, *tela.size)
            else:
                c = calibrar_chat(tela, self.ocr)
                if not c:
                    self.contagem["sem_recorte"] += 1
                    return []
                self.caixa = c
                gravar_calibracao(c, tela.size, self.calibracao)
                log.info("chat: recorte %s calibrado agora (tela %dx%d)", c, *tela.size)
        im = self.captura(self.caixa)
        textos = [ln["t"] for ln in self.ocr.ler(im, escala=escala_ocr(self.caixa, 3))]
        n = com_horario(textos)
        self.contagem["prints"] += 1
        self.contagem["linhas"] += len(textos)
        self.contagem["com_horario"] += n
        if n:
            self._sem_horario, self._espera = 0, RECALIBRAR_PRINTS
        else:
            self._sem_horario += 1
            if self._sem_horario >= self._espera:
                self._recalibrar()
        return self.f.processar_linhas(textos, gt)

    def _recalibrar(self):
        """o recorte não vê o chat há _espera prints: procura de novo nas FAIXAS_CALIBRAR (print inteiro, só em
        memória). Achou outro = troca e grava; o mesmo ou nenhum = segue e dobra a espera (chat vazio de verdade)"""
        sem, antes = self._sem_horario, self.caixa
        self._sem_horario = 0
        tela = self.captura()
        c = calibrar_chat(tela, self.ocr)
        if c and not _mesma_caixa(c, antes):
            self.caixa, self._espera = c, RECALIBRAR_PRINTS
            gravar_calibracao(c, tela.size, self.calibracao)
            self.contagem["recalibrou"] += 1
            log.warning("chat: recorte %s sem linha com horário em %d prints seguidos: recalibrado para %s",
                        antes, sem, c)
            return c
        self.contagem["recalibrar_falhou"] += 1
        self._espera = min(self._espera * 2, RECALIBRAR_MAX)
        log.warning("chat: recorte %s sem linha com horário em %d prints seguidos; a calibração %s (próxima tentativa "
                    "em %d prints)", antes, sem, "achou o mesmo recorte" if c else "não achou o chat na tela",
                    self._espera)
        return None

    def parar(self):
        self.ocr.parar()


# ---------- atalho F7 (só OBSERVA o teclado: coletor/teclas.py) ----------
# Até 14/10/2026 era F9 + 1..5 por RegisterHotKey, que nunca disparou com o jogo na frente (partidas de 13/10/2026
# 14:00 e 14/10/2026 15:48): o F9 ia para o jogo (no LoL dele é evtToggleMouseClip, a "borda vermelha fina") e 1, 2, 3 e 5 são
# teclas de item. Observar não come tecla: número de cima dispararia o item junto. Depois, F7 + numérico; o note do
# Gabriel não tem numérico (14/10 ~20:30), então o atalho é só o F7 (D34 do plano de calibração):
#   1 batida  = seleciona o adversário da minha rota (rótulo "flash: top?" na moldura);
#   + batidas = a próxima rota (top, jungler, mid, atirador, suporte, dando a volta), cada uma com o rótulo;
#   parado JANELA_BATIDAS_S depois de SOLTAR = marca o selecionado (voz "flash do mid marcado");
#   segurar SEGURAR_S = desfaz a última marcação (sem seleção em curso) ou cancela a seleção (com ela; nada marca).
# A janela conta da soltura e é maior que o segurar: segurando, nada marca antes de o desfazer valer.
# Numérico 1..5 (opcional, quem tiver): dentro da seleção, marca na hora aquele número.

JANELA_BATIDAS_S = 1.2   # parado este tempo depois de soltar o F7 = marca o selecionado
SEGURAR_S = 1.0          # F7 apertado este tempo sem soltar = desfazer/cancelar (< janela, ver acima)
TECLA_ARMAR = "F7"
VK_ARMAR = 0x76
VK_NUMERO = {0x61 + i: i + 1 for i in range(5)}  # numérico 1..5 (VK_NUMPAD1..5; com o NumLock desligado o numérico
#                                                  manda setas/End, e as setas mexem a câmera do LoL: não contam)


class Atalhos:
    """F7 em batidas (ver o comentário da seção): a 1ª seleciona o adversário da minha rota (n_proprio(), atributo
    opcional; sem rota conhecida, o top), cada outra passa para a próxima rota, e parado janela_s depois de soltar
    chama ao_marcar(n); segurar segurar_s chama ao_desfazer() (nada sendo escolhido) ou ao_cancelar() (com seleção).
    ao_selecionar(n) a cada batida é o retorno ao jogador ("flash: mid?" na moldura). Numérico 1..5 dentro da seleção
    marca na hora. Lê o teclado por teclas.Observador (GetAsyncKeyState: só leitura, a tecla segue para o jogo) e só
    conta aperto com o jogo em primeiro plano (na_tela). relogio é injetável (teste: tempo simulado).
    Cada tecla vai para o log: sem "F7 recebido" depois de apertar = o coach não viu (ARMADILHAS § Windows)."""

    def __init__(self, ao_marcar, tecla=VK_ARMAR, janela_s=JANELA_BATIDAS_S, segurar_s=SEGURAR_S, ao_selecionar=None,
                 ao_desfazer=None, ao_cancelar=None, na_tela=None, estado=None, relogio=None):
        self.ao_marcar, self.tecla, self.janela_s, self.segurar_s = ao_marcar, tecla, janela_s, segurar_s
        self.ao_selecionar, self.ao_desfazer, self.ao_cancelar = ao_selecionar, ao_desfazer, ao_cancelar
        self.n_proprio = None              # () -> n da minha rota (1..5) ou None: onde a 1ª batida começa
        self.na_tela = na_tela if na_tela is not None else jogo_na_tela
        self.estado = estado               # vk -> bool (teste); None = GetAsyncKeyState
        self.relogio = relogio or time.monotonic
        self.nome = TECLA_ARMAR if tecla == VK_ARMAR else hex(tecla)
        self.selecionado = None            # 1..5 da 1ª batida até marcar/cancelar; None = nada sendo escolhido
        self.batidas = 0
        self._baixo_em = None              # F7 apertado (contou) e ainda não solto: o segurar conta daqui
        self._solto_em = None              # última soltura na seleção: a janela de marcar conta daqui
        self._antes_do_aperto = None       # seleção antes deste aperto (None = o aperto começou do zero)
        self.thread = None
        self._parar = None
        self.obs = None

    @property
    def armado(self):
        """há uma seleção em curso (nome antigo, do F7 que armava)"""
        return self.selecionado is not None

    @staticmethod
    def _chamar(f, *a):
        """callback do retorno não derruba a thread do atalho (exceção aqui sumiria calada)"""
        if f is None:
            return
        try:
            f(*a)
        except Exception as e:
            log.warning("atalho: retorno falhou: %s: %s", type(e).__name__, e)

    def _inicio(self):
        """onde a 1ª batida começa: o adversário da minha rota; sem rota (blind, ARAM, treino) ou erro, o top"""
        n = None
        if self.n_proprio is not None:
            try:
                n = self.n_proprio()
            except Exception as e:
                log.warning("atalho: rota própria falhou: %s: %s", type(e).__name__, e)
        return n if isinstance(n, int) and 1 <= n <= len(ROTAS) else 1

    def _limpar(self):
        self.selecionado, self.batidas = None, 0
        self._baixo_em = self._solto_em = self._antes_do_aperto = None

    # máquina de estado (pura: o teste chama direto com o tempo que quiser, sem tecla nenhuma)
    def apertou(self, agora=None):
        """borda do F7 (só com o jogo na frente): seleciona o próximo; devolve o n selecionado"""
        agora = self.relogio() if agora is None else agora
        self._antes_do_aperto = self.selecionado
        self._baixo_em, self._solto_em = agora, None
        if self.selecionado is None:
            n, self.batidas = self._inicio(), 1
            log.info("atalho: %s recebido, batida 1 seleciona %d (%s); parado %.1f s marca, mais batidas trocam a "
                     "rota, segurar %.1f s desfaz", self.nome, n, ROTA_FALA[ROTAS[n - 1]], self.janela_s, self.segurar_s)
        else:
            n = self.selecionado % len(ROTAS) + 1
            self.batidas += 1
            log.info("atalho: %s batida %d seleciona %d (%s)", self.nome, self.batidas, n, ROTA_FALA[ROTAS[n - 1]])
        self.selecionado = n
        self._chamar(self.ao_selecionar, n)
        return n

    def soltou(self, agora=None):
        """borda de soltura do F7: a janela de marcar começa (soltura de aperto que não contou: nada)"""
        if self._baixo_em is None:
            return
        self._baixo_em = None
        if self.selecionado is not None:
            self._solto_em = self.relogio() if agora is None else agora

    def numero(self, n):
        """numérico 1..5 (opcional): dentro da seleção marca n na hora; fora dela, nada (não marca sem o F7)"""
        if self.selecionado is None:
            return None
        self._limpar()
        log.info("atalho: %s + numérico %d recebido", self.nome, n)
        self._chamar(self.ao_marcar, n)
        return n

    def tique(self, agora=None):
        """a cada volta do Observador: segurou -> desfazer/cancelar; parado depois de soltar -> marcar.
        Devolve o que fez: n marcado, "desfazer", "cancelado" ou None"""
        agora = self.relogio() if agora is None else agora
        if self._baixo_em is not None and agora - self._baixo_em >= self.segurar_s:
            estava = self._antes_do_aperto
            self._limpar()   # a soltura deste aperto já não conta (_baixo_em None)
            if estava is None:
                log.info("atalho: %s segurado %.1f s: desfazer a última marcação", self.nome, self.segurar_s)
                self._chamar(self.ao_desfazer)
                return "desfazer"
            log.info("atalho: %s segurado %.1f s: seleção cancelada, nada marcado", self.nome, self.segurar_s)
            self._chamar(self.ao_cancelar)
            return "cancelado"
        if self.selecionado is not None and self._solto_em is not None and agora - self._solto_em >= self.janela_s:
            n, batidas = self.selecionado, self.batidas
            self._limpar()
            log.info("atalho: %s parado %.1f s depois de %d batida(s): marca %d (%s)", self.nome, self.janela_s,
                     batidas, n, ROTA_FALA[ROTAS[n - 1]])
            self._chamar(self.ao_marcar, n)
            return n
        return None

    # adaptador: tecla observada -> evento da máquina; a janela fecha pelo tique do Observador
    def _apertou(self, vk):
        if vk == self.tecla:
            self.apertou()
        elif vk in VK_NUMERO:
            self.numero(VK_NUMERO[vk])

    def _soltou(self, vk):
        if vk == self.tecla:
            self.soltou()

    def _tique(self):
        self.tique()

    def observador(self):
        """o teclas.Observador ligado nesta máquina (o teste roda passo() na mão, sem thread)"""
        import teclas
        return teclas.Observador([self.tecla, *VK_NUMERO], self._apertou, na_tela=self.na_tela,
                                 estado=self.estado, tique=self._tique, ao_soltar=self._soltou)

    def iniciar(self):
        import teclas
        teclas.avisar_conflitos([self.nome, "Num 1", "Num 2", "Num 3", "Num 4", "Num 5"], "atalho")
        self.obs = self.observador()
        self._parar, self.thread = teclas.em_thread(self.obs, "atalhos-feiticos")
        log.info("atalho: %s observado (batidas escolhem a rota, parado %.1f s marca, segurar %.1f s desfaz; "
                 "numérico 1..5 opcional; GetAsyncKeyState, só leitura: a tecla segue para o jogo)",
                 self.nome, self.janela_s, self.segurar_s)
        return self

    def parar(self):
        if self._parar is not None:
            self._parar.set()
            self.thread.join(3)
            self._parar = None
            log.info("atalho: %s solto", self.nome)


def sonda(segundos=30.0):
    """imprime cada F7/F8/F9/numérico 1..5 observado (coletor/teclas.py: só lê o teclado, em qualquer janela).
    F9 e numérico ficam na sonda para separar "teclado não manda" de "coach não vê"; o atalho é o F7"""
    import teclas
    return teclas.sonda(segundos)


if __name__ == "__main__":
    import argparse
    import sys
    ap = argparse.ArgumentParser(description="ferramentas do feiticos.py")
    ap.add_argument("--sonda", type=float, metavar="S",
                    help="observa F7/F8/F9/numérico 1-5 por S segundos e imprime o que vir")
    a = ap.parse_args()
    for s in (sys.stdout, sys.stderr):
        s.reconfigure(encoding="utf-8")
    if a.sonda:
        sys.exit(sonda(a.sonda))
    ap.print_help()
