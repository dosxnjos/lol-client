# feitiços de invocador do inimigo (plano v2, passo 15e): quem gastou o quê e quando volta.
# Fontes, nesta ordem (API primeiro; a Live Client não tem recarga de feitiço de ninguém):
#   1. ping de feitiço dos aliados no chat do jogo, lido por OCR do Windows (Windows.Media.Ocr pt-BR)
#      num recorte do chat calibrado sozinho; o chat não passa pela LCU (medido em 13/10/2026);
#   2. atalho manual F9 + 1..5 (inimigo por rota) quando o próprio Gabriel vê o flash.
# Linha que não se cruza: só print do monitor (mss) e hotkey de LEITURA (RegisterHotKey);
# nada de enviar tecla, ler memória ou mexer no processo do jogo. Nada de imagem em disco.
# Formato real do ping (MEDICAO § 4): "mm:ss <aliado> (<campeão>): <inimigo> usou <feitiço>".
import base64
import ctypes
import difflib
import io
import json
import re
import subprocess
import threading
import time
from ctypes import wintypes
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CALIBRACAO_PADRAO = RAIZ / "dados" / "calibracao-chat.json"

# recarga base (s) do summoner-spells.json da LCU, modo CLASSIC (13/10/2026); a LCU manda quando houver
RECARGA_BASE = {"Flash": 300, "Teleporte": 300, "Incendiar": 180, "Barreira": 180, "Exaustão": 240,
                "Curar": 240, "Fantasma": 240, "Purificar": 240}
SEM_CRONOMETRO = ("Golpear", "Golpe Irrestrito", "Golpe Primordial")  # Smite: 2 cargas, não vale cronômetro
RUNA_PERSPICACIA = 8347          # Perspicácia Cósmica: +18 de aceleração de feitiço de invocador
ARVORE_INSPIRACAO = 8300         # a runa só existe nessa árvore
ACEL_RUNA = 18
ACEL_BOTA = {3158: 10, 3171: 20}  # Botas Ionianas da Lucidez, Lucidez Escarlate (3171 vem de 3158)
ROTAS = ("TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY")  # atalho 1..5
JANELA_DEDUPE = 60    # mesmo (inimigo, feitiço) com horário a <= 60 s = o mesmo gasto (aliados repetem o ping)
LINHA_VELHA = 300     # linha de chat > 300 s antes do gameTime (maior recarga): leitura errada ou inútil.
                      # a linha fica na tela bem mais que 90 s (00562.0: ping de 7:06 lido aos 9:22)
ITEM_VELHO = 60       # item do inimigo sem mudança visível há > 60 s na hora do ping: bota "±"
DESFAZ_ATALHO = 10    # F9 + mesmo número de novo em <= 10 s desfaz

# chat em 2560x1080 nesta HUD (MEDICAO § 4): reserva quando a calibração ainda não achou linha
CAIXA_RESERVA = (1400, 815, 1900, 985)
FAIXA_CALIBRAR = (1000, 620, 2150, 1080)   # onde procurar o chat (fora do minimapa, x >= 2179)
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


def calibrar_chat(tela, ocr, faixa=FAIXA_CALIBRAR):
    """tela = print inteiro do monitor do jogo (PIL). Acha as linhas do chat pelo horário mm:ss no
    começo e devolve a caixa (x0, y0, x1, y1) em px da tela, ou None (sem linha de chat: jogo fora da
    tela, chat vazio). O chat cresce para cima a partir da base: a caixa vai da base até 170 px acima."""
    x0, y0, x1, y1 = faixa
    x1, y1 = min(x1, tela.width), min(y1, tela.height)
    linhas = ocr.ler(tela.crop((x0, y0, x1, y1)), escala=2)
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
    col = [c for c in caixas if abs(c[0] - esq) <= 12]
    if len(col) < 2:
        return None
    base = max(c[3] for c in col)
    esq = min(c[0] for c in col)
    # linha longa quebra na largura do chat; o print da calibração pode só ter linhas curtas: piso de 460 px
    dir_ = max(max(c[2] for c in col) + 40, esq + 460)
    cx0 = int(x0 + esq - 12)
    cx1 = int(min(x0 + dir_, x0 + esq + 520, x1))
    cy1 = int(min(y0 + base + 8, y1))
    return (cx0, max(0, cy1 - 170), cx1, cy1)


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
    do chat; atalho(n, gt) com o F9 + n; estado(gt) para o painel; voltaram(gt) para a voz.
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
        lista = self.usos.setdefault((inimigo, feitico), [])
        for u in lista:
            if abs(u["ts"] - ts) <= JANELA_DEDUPE:
                u["votos"][ts] = u["votos"].get(ts, 0) + 1
                novo_ts = min(u["votos"], key=lambda t: (-u["votos"][t], t))   # moda; empate = o mais cedo
                if novo_ts != u["ts"] and u["fonte"] == "chat":
                    d = novo_ts - u["ts"]
                    u["ts"], u["volta_em"], u["volta_max"] = novo_ts, u["volta_em"] + d, u["volta_max"] + d
                return u
        u = self._novo_uso(inimigo, feitico, ts, fonte)
        if u:
            lista.append(u)
        return u

    def processar_linhas(self, textos, gt=None):
        """linhas do OCR de um print do chat -> usos novos/confirmados"""
        gt = self.gt if gt is None else gt
        out = []
        for e in juntar_linhas(textos):
            p = ler_ping(e, list(self.inimigos), list(self.base) + list(SEM_CRONOMETRO))
            if not p or not p["usou"]:
                continue   # sem "usou" não diz que gastou: não liga cronômetro
            if not (-2 <= gt - p["ts"] <= LINHA_VELHA):
                continue
            u = self.registrar(p["inimigo"], p["feitico"], p["ts"], "chat")
            if u:
                out.append(u)
        return out

    def atalho(self, n, gt=None):
        """F9 + n (1..5 = TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY): Flash dele gasto agora.
        Repetir o mesmo número em <= 10 s desfaz. Devolve o uso, ou None (desfeito / sem inimigo)."""
        gt = self.gt if gt is None else gt
        if not (1 <= n <= len(self.ordem)):
            return None
        nome = self.ordem[n - 1]
        fs = [f for f in self.inimigos[nome]["feiticos"] if f not in SEM_CRONOMETRO]
        f = "Flash" if "Flash" in fs else (fs[0] if fs else None)
        if not f:
            return None
        lista = self.usos.setdefault((nome, f), [])
        for u in list(lista):
            if u["fonte"] == "atalho" and 0 <= gt - u["ts"] <= DESFAZ_ATALHO:
                lista.remove(u)
                return None
        return self.registrar(nome, f, gt, "atalho")

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
                    # tipo/chave/textos no formato do avisos.Aviso (motor de voz e painel)
                    out.append({"inimigo": u["inimigo"], "feitico": u["feitico"], "texto": txt,
                                "tipo": "feitico_voltou", "chave": f"{u['inimigo']}:{u['feitico']}:{int(u['ts'])}",
                                "textos": {"serio": (txt + (", talvez" if u["incerto"] else ""), txt),
                                           "descontraido": (f"{txt} de novo, cuidado", txt)}})
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


class LeitorChat:
    """laço do OCR do chat: passo(gt) a cada ~3 s durante a partida (o integrador chama).
    Pausa sem o jogo em primeiro plano; calibra o recorte no 1º print com linha de chat e guarda em
    dados/calibracao-chat.json (a posição do chat é da HUD, não está no game.cfg)."""

    def __init__(self, feiticos, ocr=None, calibracao=CALIBRACAO_PADRAO, captura=capturar, na_tela=jogo_na_tela):
        self.f = feiticos
        self.ocr = ocr or OcrChat()
        self.calibracao = calibracao
        self.captura, self.na_tela = captura, na_tela
        self.caixa = None

    def passo(self, gt=None):
        if not self.na_tela():
            return []
        if not self.caixa:
            tela = self.captura()
            self.caixa = ler_calibracao(self.calibracao, tela.size)
            if not self.caixa:
                c = calibrar_chat(tela, self.ocr)
                if not c:
                    return []
                self.caixa = c
                gravar_calibracao(c, tela.size, self.calibracao)
        im = self.captura(self.caixa)
        linhas = self.ocr.ler(im, escala=3)
        return self.f.processar_linhas([ln["t"] for ln in linhas], gt)

    def parar(self):
        self.ocr.parar()


# ---------- atalho F9 + 1..5 (RegisterHotKey: só lê, não envia tecla) ----------

WM_HOTKEY, WM_TIMER, WM_QUIT = 0x0312, 0x0113, 0x0012
MOD_NOREPEAT = 0x4000
VK_F9 = 0x78
ID_ARMAR = 1
IDS_NUMERO = {11 + i: i + 1 for i in range(5)}   # id do hotkey -> 1..5 (VK '1'..'5' = 0x31..0x35)


class Atalhos:
    """F9 arma por janela_s; nesse tempo 1..5 escolhe o inimigo e chama ao_marcar(n).
    Só o F9 fica registrado o tempo todo: 1..5 são as teclas de item do jogo, então só ficam
    registradas (e não chegam ao jogo) nos ~2 s depois do F9. RegisterHotKey é por thread: tudo
    roda numa thread própria com GetMessage."""

    def __init__(self, ao_marcar, tecla=VK_F9, janela_s=2.0):
        self.ao_marcar, self.tecla, self.janela_ms = ao_marcar, tecla, int(janela_s * 1000)
        self.armado = False
        self.thread = None
        self.tid = None
        self.erro = None
        self._timer = 0

    # máquina de estado (pura: o teste chama direto, sem tecla nenhuma)
    def tratar(self, msg, wparam, registrar=None, desregistrar=None):
        registrar = registrar or (lambda: None)
        desregistrar = desregistrar or (lambda: None)
        if msg == WM_HOTKEY and wparam == ID_ARMAR:
            if not self.armado:
                self.armado = True
                registrar()
            return None
        if msg == WM_HOTKEY and wparam in IDS_NUMERO and self.armado:
            self.armado = False
            desregistrar()
            n = IDS_NUMERO[wparam]
            self.ao_marcar(n)
            return n
        if msg == WM_TIMER and self.armado:
            self.armado = False
            desregistrar()
        return None

    def _rodar(self, pronto):
        u = ctypes.windll.user32
        k = ctypes.windll.kernel32
        self.tid = k.GetCurrentThreadId()
        if not u.RegisterHotKey(None, ID_ARMAR, MOD_NOREPEAT, self.tecla):
            self.erro = f"RegisterHotKey falhou (tecla em uso por outro programa? erro {k.GetLastError()})"
            pronto.set()
            return
        pronto.set()

        def registrar():
            for hid, n in IDS_NUMERO.items():
                u.RegisterHotKey(None, hid, MOD_NOREPEAT, 0x30 + n)
            self._timer = u.SetTimer(None, 0, self.janela_ms, None)

        def desregistrar():
            for hid in IDS_NUMERO:
                u.UnregisterHotKey(None, hid)
            if self._timer:
                u.KillTimer(None, self._timer)
                self._timer = 0

        msg = wintypes.MSG()
        try:
            while u.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
                self.tratar(msg.message, msg.wParam, registrar, desregistrar)
        finally:
            desregistrar()
            u.UnregisterHotKey(None, ID_ARMAR)

    def iniciar(self):
        pronto = threading.Event()
        self.thread = threading.Thread(target=self._rodar, args=(pronto,), daemon=True, name="atalhos-feiticos")
        self.thread.start()
        pronto.wait(5)
        if self.erro:
            raise RuntimeError(self.erro)
        return self

    def parar(self):
        if self.tid:
            ctypes.windll.user32.PostThreadMessageW(self.tid, WM_QUIT, 0, 0)
            self.thread.join(3)
            self.tid = None
