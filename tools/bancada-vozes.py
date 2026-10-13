"""Bancada de vozes (plano 2026-10-13-voz-pregravada-e-foco, passo 4).

Gera as mesmas 6 frases em todas as vozes candidatas (Coqui inteiro em português, Piper, Microsoft
neurais via edge-tts, Gemini TTS, Kyutai Pocket TTS, Windows) e monta um HTML standalone para o
Gabriel ouvir lado a lado: `temp/vozes/2026-10-13-vozes.html` (áudio Opus em data URI, zero rede).

Roda SÓ com o python do venv isolado (nunca o Python 3.14 do coletor):

    %LOCALAPPDATA%\\lol-client\\voz\\venv\\Scripts\\python.exe tools\\bancada-vozes.py
    ... --motores xtts,bark     só esses motores
    ... --html                  só remonta o HTML com os clipes que já existem

Regras: prioridade baixa (BELOW_NORMAL, herdada pelos filhos); antes de carregar modelo e antes de
cada clipe confere se `League of Legends.exe` está aberto e, se estiver, espera em laço de 30 s
(pausas em `temp/vozes/pausas.jsonl`). Retomável: clipe com `.ogg` + `.json` não é refeito. Cada
motor roda num subprocesso próprio: motor que falha não derruba os outros. O volume é normalizado
(`ffmpeg loudnorm` em duas passadas) para a comparação ser justa.
"""

from __future__ import annotations

import argparse
import base64
import html
import json
import os
import re
import subprocess
import sys
import time
import traceback
import unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
SAIDA = RAIZ / "temp" / "vozes"
CLIPES = SAIDA / "clipes"
HTML_SAIDA = SAIDA / "2026-10-13-vozes.html"
PAUSAS = SAIDA / "pausas.jsonl"
LOG = SAIDA / "bancada.log"
VOZ_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "lol-client" / "voz"

FRASES = [
    "gank provável no rio top",
    "flash do mid voltou",
    "o jungler apareceu na selva inimiga",
    "dragão em um minuto",
    "três inimigos mortos, bora barão",
    "o caçador inimigo foi visto pela última vez no rio de cima há vinte segundos, "
    "então joga com cuidado e guarda o teu flash para a fuga.",
]

ORDEM = ["windows", "piper", "edge", "pocket", "gemini", "coqui_vits", "yourtts", "xtts", "bark"]

# cabeçalho de cada motor no HTML: 1 linha (onde roda, velocidade, licença)
MOTORES = {
    "xtts": ("Coqui", "XTTS-v2", "local, no processador; lento; licença CPML (uso pessoal, não comercial)"),
    "yourtts": ("Coqui", "YourTTS", "local; rápido; licença CC BY-NC 4.0 (não comercial)"),
    "coqui_vits": ("Coqui", "VITS pt (Common Voice)", "local; rápido; licença CC BY-NC-ND 4.0"),
    "bark": ("Coqui", "Bark (Suno)", "local; muito lento no processador e às vezes inventa; licença MIT"),
    "piper": ("Piper", "Piper pt-BR", "local; muito rápido (feito para Raspberry Pi); licença MIT, vozes com licença própria"),
    "edge": ("Microsoft", "Microsoft neurais (edge-tts)", "nuvem da Microsoft, grátis e sem chave; rápido; serviço de leitura do Edge, não oficial para uso por código"),
    "gemini": ("Gemini", "Gemini TTS", "nuvem do Google, com a chave da conta; rápido; só o texto da frase sai da máquina"),
    "pocket": ("Kyutai", "Kyutai Pocket TTS", "local, no processador; rápido; licença CC BY 4.0 (modelo) e própria por voz"),
    "windows": ("Windows", "Windows (controle)", "local, já instalado; instantâneo; é a voz de hoje (Maria)"),
}
SECOES = ["Coqui", "Piper", "Microsoft", "Gemini", "Kyutai", "Windows"]

# gênero dos locutores embutidos do XTTS-v2, pelo nome (a altura da voz medida confere depois)
XTTS_GENERO = {
    **{n: "F" for n in [
        "Claribel Dervla", "Daisy Studious", "Gracie Wise", "Tammie Ema", "Alison Dietlinde",
        "Ana Florence", "Annmarie Nele", "Asya Anara", "Brenda Stern", "Gitta Nikolina",
        "Henriette Usha", "Sofia Hellen", "Tammy Grit", "Tanja Adelina", "Vjollca Johnnie",
        "Nova Hogarth", "Maja Ruoho", "Uta Obando", "Lidiya Szekeres", "Chandra MacFarland",
        "Szofi Granger", "Camilla Holmström", "Lilya Stainthorpe", "Zofija Kendrick",
        "Narelle Moon", "Barbora MacLean", "Alexandra Hisakawa", "Alma María", "Rosemary Okafor"]},
    **{n: "M" for n in [
        "Andrew Chipper", "Badr Odhiambo", "Dionisio Schuyler", "Royston Min", "Viktor Eka",
        "Abrahan Mack", "Adde Michal", "Baldur Sanjin", "Craig Gutsy", "Damien Black",
        "Gilberto Mathias", "Ilkin Urbano", "Kazuhiko Atallah", "Ludvig Milivoj", "Suad Qasim",
        "Torcull Diarmuid", "Viktor Menelaos", "Zacharie Aimilios", "Ige Behringer",
        "Filip Traverse", "Damjan Chapman", "Wulf Carlevaro", "Aaron Dreschner", "Kumar Dahl",
        "Eugenio Mataracı", "Ferran Simen", "Xavier Hayasaka", "Luis Moray", "Marcos Rudaski"]},
}


# ---------------------------------------------------------------- utilidades

def log(msg: str) -> None:
    linha = f"{time.strftime('%H:%M:%S')} {msg}"
    print(linha, flush=True)
    SAIDA.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(linha + "\n")


def slug(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-") or "voz"


def prioridade_baixa() -> None:
    try:
        import psutil
        psutil.Process().nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
    except Exception as e:  # sem psutil: segue, mas registra
        log(f"aviso: não baixou a prioridade ({e})")


def jogo_aberto() -> bool:
    try:
        import psutil
        for p in psutil.process_iter(["name"]):
            if (p.info.get("name") or "").lower() == "league of legends.exe":
                return True
        return False
    except Exception:
        r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq League of Legends.exe", "/NH"],
                           capture_output=True, text=True, errors="replace")
        return "league of legends.exe" in r.stdout.lower()


def esperar_jogo(onde: str) -> None:
    """O processador é do jogo: com o LoL aberto, espera em laço de 30 s e registra a pausa."""
    if not jogo_aberto():
        return
    inicio = time.time()
    log(f"PAUSA: League of Legends.exe aberto ({onde}); esperando fechar")
    while jogo_aberto():
        time.sleep(30)
    fim = time.time()
    with PAUSAS.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"inicio": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(inicio)),
                            "fim": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(fim)),
                            "dur_s": round(fim - inicio), "onde": onde}, ensure_ascii=False) + "\n")
    log(f"jogo fechou; retomando depois de {round(fim - inicio)} s")


def duracao(caminho: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                        "default=nw=1:nk=1", str(caminho)], capture_output=True, text=True)
    return float(r.stdout.strip())


def normalizar(bruto: Path, destino: Path) -> None:
    """loudnorm em duas passadas (medir, depois aplicar linear) e Opus mono 32 kbps."""
    alvo = "I=-16:TP=-1.5:LRA=11"
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-i", str(bruto), "-af",
                        f"loudnorm={alvo}:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True, errors="replace")
    filtro = f"loudnorm={alvo}"
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr)
    if m:
        d = json.loads(m.group(0))
        if d.get("input_i") not in (None, "-inf") and d.get("input_tp") != "-inf":
            filtro += (f":measured_I={d['input_i']}:measured_TP={d['input_tp']}"
                       f":measured_LRA={d['input_lra']}:measured_thresh={d['input_thresh']}"
                       f":offset={d['target_offset']}:linear=true")
    subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-i", str(bruto),
                    "-af", filtro, "-ar", "48000", "-ac", "1", "-c:a", "libopus", "-b:a", "32k",
                    str(destino)], check=True)


def altura_media(caminho: Path) -> float | None:
    """Mediana da frequência fundamental (Hz): confere o gênero rotulado pelo nome."""
    try:
        import librosa
        import numpy as np
        y, sr = librosa.load(str(caminho), sr=16000, mono=True)
        f0, voz, _ = librosa.pyin(y, fmin=60, fmax=400, sr=sr)
        f0 = f0[voz & ~np.isnan(f0)]
        return round(float(np.median(f0)), 0) if len(f0) else None
    except Exception:
        return None


class Motor:
    """Um motor = uma lista de vozes + uma função que sintetiza um texto num arquivo de áudio."""

    nome = ""
    por_frase = False  # True: frase por frase em todas as vozes (motor lento)
    limite_s = 0  # teto de tempo de geração do motor (0 = sem teto)

    def __init__(self) -> None:
        self.pasta = CLIPES / self.nome
        self.pasta.mkdir(parents=True, exist_ok=True)
        self.info: dict = {"motor": self.nome, "vozes": [], "fora": [], "falhas": [], "carga_s": None}

    def vozes(self) -> list[dict]:  # {id, nome, genero, nota, modelo}
        raise NotImplementedError

    def carregar(self) -> None:
        pass

    def sintetizar(self, voz: dict, texto: str, destino: Path) -> Path:
        """Escreve o áudio cru; devolve o caminho (a extensão pode mudar). Pode devolver t_ger medido."""
        raise NotImplementedError

    def gravar_info(self) -> None:
        (self.pasta / "_motor.json").write_text(json.dumps(self.info, ensure_ascii=False, indent=1),
                                                encoding="utf-8")

    def falha(self, onde: str, e: BaseException) -> None:
        msg = f"{type(e).__name__}: {str(e)[:300]}"
        self.info["falhas"].append({"onde": onde, "erro": msg})
        log(f"[{self.nome}] FALHA {onde}: {msg}")

    def rodar(self) -> None:
        esperar_jogo(f"{self.nome}: antes de carregar")
        t0 = time.perf_counter()
        try:
            self.carregar()
            lista = self.vozes()
        except Exception as e:
            self.falha("carregar", e)
            log(traceback.format_exc())
            self.gravar_info()
            return
        self.info["carga_s"] = round(time.perf_counter() - t0, 1)
        self.info["vozes"] = lista
        self.gravar_info()
        log(f"[{self.nome}] {len(lista)} vozes; carga {self.info['carga_s']} s")
        # motor lento (Bark) vai frase por frase em todas as vozes, com a frase longa logo depois da 1ª:
        # se o tempo acabar, toda voz tem ao menos as mesmas frases para comparar
        if self.por_frase:
            ordem_n = [1, len(FRASES)] + list(range(2, len(FRASES)))
            pares = [(v, n) for n in ordem_n for v in lista]
        else:
            pares = [(v, n) for v in lista for n in range(1, len(FRASES) + 1)]
        inicio = time.time()
        seguidas: dict[str, int] = {}
        for voz, n in pares:
            pasta = self.pasta / voz["id"]
            pasta.mkdir(parents=True, exist_ok=True)
            ogg, meta = pasta / f"{n}.ogg", pasta / f"{n}.json"
            if ogg.exists() and meta.exists():
                continue
            if getattr(self, "parar", False) or seguidas.get(voz["id"], 0) >= 3:
                continue
            if self.limite_s and time.time() - inicio > self.limite_s:
                self.info["tempo_esgotado"] = f"parou no limite de {self.limite_s // 60} min de geração"
                log(f"[{self.nome}] limite de {self.limite_s // 60} min: parando (o resto fica para outra rodada)")
                break
            esperar_jogo(f"{self.nome}/{voz['id']}/{n}")
            try:
                self.clipe(voz, n, pasta, ogg, meta)
                seguidas[voz["id"]] = 0
            except Exception as e:
                seguidas[voz["id"]] = seguidas.get(voz["id"], 0) + 1
                self.falha(f"{voz['id']}/{n}", e)
                for p in pasta.glob(f"{n}.bruto.*"):
                    p.unlink(missing_ok=True)
                if seguidas[voz["id"]] >= 3:
                    log(f"[{self.nome}] {voz['id']}: 3 falhas seguidas, pulando a voz")
            self.gravar_info()
        self.gravar_info()

    def clipe(self, voz: dict, n: int, pasta: Path, ogg: Path, meta: Path) -> None:
        """Gera 1 frase: mede só a síntese (t_ger), normaliza para Opus e grava o .json ao lado."""
        t0 = time.perf_counter()
        r = self.sintetizar(voz, FRASES[n - 1], pasta / f"{n}.bruto.wav")
        t_ger = time.perf_counter() - t0
        if isinstance(r, tuple):  # motor que mede a si mesmo (PowerShell, Pocket, Gemini)
            r, t_ger = r
        bruto = Path(r)
        dur = duracao(bruto)
        f0 = altura_media(bruto) if n == len(FRASES) else None
        normalizar(bruto, ogg)
        bruto.unlink(missing_ok=True)
        dados = {"t_ger": round(t_ger, 2), "dur": round(dur, 2), "rtf": round(t_ger / dur, 3) if dur else None}
        if f0:
            dados["f0"] = f0
        dados.update(getattr(self, "ultimo_extra", {}))
        meta.write_text(json.dumps(dados), encoding="utf-8")
        log(f"[{self.nome}] {voz['id']} {n}: {dados['t_ger']} s para {dados['dur']} s")


# ---------------------------------------------------------------- Windows

_PS_WIN = r"""
$ErrorActionPreference = 'Stop'
$p = Get-Content -Raw -Encoding UTF8 $args[0] | ConvertFrom-Json
$sw = [Diagnostics.Stopwatch]::StartNew()
if ($p.api -eq 'sapi') {
  Add-Type -AssemblyName System.Speech
  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $s.SelectVoice($p.voz); $sw.Restart()
  $s.SetOutputToWaveFile($p.saida); $s.Speak($p.texto); $s.Dispose()
} else {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [void][Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
  $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $syn = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
  $syn.Voice = ([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -eq $p.voz })[0]
  $sw.Restart()
  $t = $asTask.MakeGenericMethod([Windows.Media.SpeechSynthesis.SpeechSynthesisStream]).Invoke($null, @($syn.SynthesizeTextToStreamAsync($p.texto)))
  $t.Wait(-1) | Out-Null; $st = $t.Result
  $ns = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($st)
  $fs = [IO.File]::Create($p.saida); $ns.CopyTo($fs); $fs.Close()
}
$sw.Stop(); [Console]::Out.WriteLine($sw.Elapsed.TotalSeconds.ToString([Globalization.CultureInfo]::InvariantCulture))
"""


class Windows(Motor):
    nome = "windows"

    def vozes(self):
        self.info["fora"] = [{"modelo": "Microsoft Zira Desktop", "motivo": "voz en-US, não fala português"}]
        return [
            {"id": "maria-desktop", "nome": "Maria (Desktop, a de hoje)", "genero": "F", "nota": "System.Speech (SAPI)",
             "modelo": "Windows", "_voz": "Microsoft Maria Desktop", "_api": "sapi"},
            {"id": "maria-onecore", "nome": "Maria (OneCore)", "genero": "F", "nota": "Windows.Media.SpeechSynthesis",
             "modelo": "Windows", "_voz": "Microsoft Maria", "_api": "onecore"},
            {"id": "daniel-onecore", "nome": "Daniel (OneCore)", "genero": "M", "nota": "Windows.Media.SpeechSynthesis",
             "modelo": "Windows", "_voz": "Microsoft Daniel", "_api": "onecore"},
        ]

    def sintetizar(self, voz, texto, destino):
        ps1 = SAIDA / "_win.ps1"
        ps1.write_text(_PS_WIN, encoding="ascii")
        pedido = destino.with_suffix(".pedido.json")
        pedido.write_text(json.dumps({"api": voz["_api"], "voz": voz["_voz"], "texto": texto,
                                      "saida": str(destino)}, ensure_ascii=False), encoding="utf-8")
        try:
            r = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                                str(ps1), str(pedido)], capture_output=True, text=True, errors="replace",
                               timeout=120)
        finally:
            pedido.unlink(missing_ok=True)
        if r.returncode != 0 or not destino.exists():
            raise RuntimeError((r.stderr or r.stdout).strip()[-300:])
        return destino, float(r.stdout.strip().splitlines()[-1])


# ---------------------------------------------------------------- Piper

class Piper(Motor):
    nome = "piper"
    VOZES = [("pt_BR-faber-medium", "pt/pt_BR/faber/medium"), ("pt_BR-cadu-medium", "pt/pt_BR/cadu/medium"),
             ("pt_BR-jeff-medium", "pt/pt_BR/jeff/medium"), ("pt_BR-edresson-low", "pt/pt_BR/edresson/low"),
             ("pt_PT-tugão-medium", "pt/pt_PT/tugão/medium")]

    def carregar(self):
        import urllib.parse
        import urllib.request
        from piper import PiperVoice
        base = "https://huggingface.co/rhasspy/piper-voices/resolve/main/"
        pasta = VOZ_DIR / "piper"
        pasta.mkdir(parents=True, exist_ok=True)
        self.modelos = {}
        for nome, caminho in self.VOZES:
            for ext in (".onnx", ".onnx.json"):
                arq = pasta / f"{nome}{ext}"
                if not arq.exists():
                    url = base + urllib.parse.quote(f"{caminho}/{nome}{ext}")
                    log(f"[piper] baixando {nome}{ext}")
                    urllib.request.urlretrieve(url, arq)
            self.modelos[nome] = PiperVoice.load(str(pasta / f"{nome}.onnx"))

    def vozes(self):
        out = []
        for nome, _ in self.VOZES:
            quem = nome.split("-")[1]
            pt = "sotaque de Portugal" if nome.startswith("pt_PT") else "pt-BR"
            out.append({"id": slug(nome), "nome": quem.capitalize(), "genero": "M",
                        "nota": f"{nome} ({pt})", "modelo": "Piper", "_m": nome})
        return out

    def sintetizar(self, voz, texto, destino):
        import wave
        with wave.open(str(destino), "wb") as w:
            self.modelos[voz["_m"]].synthesize_wav(texto, w)
        return destino


# ---------------------------------------------------------------- edge-tts

class Edge(Motor):
    nome = "edge"

    def carregar(self):
        import asyncio
        import edge_tts
        todas = asyncio.run(edge_tts.list_voices())
        self.lista = [v for v in todas if v["Locale"].startswith("pt-")]

    def vozes(self):
        out = []
        for v in sorted(self.lista, key=lambda v: (v["Locale"] != "pt-BR", v["ShortName"])):
            nome = v["ShortName"].split("-", 2)[2].replace("Neural", "")
            pt = "pt-BR" if v["Locale"] == "pt-BR" else "sotaque de Portugal"
            out.append({"id": slug(v["ShortName"]), "nome": nome, "genero": "M" if v["Gender"] == "Male" else "F",
                        "nota": f"{v['ShortName']} ({pt})", "modelo": "Microsoft", "_v": v["ShortName"]})
        return out

    def sintetizar(self, voz, texto, destino):
        import asyncio
        import edge_tts
        mp3 = destino.with_suffix(".mp3")
        asyncio.run(edge_tts.Communicate(texto, voz["_v"]).save(str(mp3)))
        return mp3


# ---------------------------------------------------------------- Kyutai Pocket TTS

class Pocket(Motor):
    nome = "pocket"

    def carregar(self):
        from pocket_tts import TTSModel
        self.TTSModel = TTSModel
        self.modelos = {}
        self.estados = {}

    def vozes(self):
        self.info["fora"] = [{"modelo": "outras 20+ vozes do catálogo (alba, anna, charles...)",
                              "motivo": "gravadas em inglês; a de português é a rafael (incluídas 2 de outro idioma como amostra)"}]
        return [
            {"id": "rafael", "nome": "Rafael", "genero": "M", "nota": "voz pt do catálogo, modelo portuguese (6 camadas)",
             "modelo": "Pocket TTS", "_l": "portuguese", "_v": "rafael"},
            {"id": "rafael-24l", "nome": "Rafael (24 camadas)", "genero": "M",
             "nota": "mesma voz, modelo portuguese_24l (melhor e mais lento)", "modelo": "Pocket TTS",
             "_l": "portuguese_24l", "_v": "rafael"},
            {"id": "lola", "nome": "Lola", "genero": "F", "nota": "voz espanhola falando pelo modelo português",
             "modelo": "Pocket TTS", "_l": "portuguese", "_v": "lola"},
            {"id": "estelle", "nome": "Estelle", "genero": "F", "nota": "voz francesa falando pelo modelo português",
             "modelo": "Pocket TTS", "_l": "portuguese", "_v": "estelle"},
        ]

    def sintetizar(self, voz, texto, destino):
        import soundfile as sf
        lang = voz["_l"]
        if lang not in self.modelos:
            esperar_jogo(f"pocket: carregar {lang}")
            self.modelos[lang] = self.TTSModel.load_model(language=lang)
        m = self.modelos[lang]
        chave = (lang, voz["_v"])
        if chave not in self.estados:
            self.estados[chave] = m.get_state_for_audio_prompt(voz["_v"])
        t0 = time.perf_counter()
        audio = m.generate_audio(self.estados[chave], texto)
        t = time.perf_counter() - t0
        sf.write(str(destino), audio.squeeze().cpu().numpy(), m.sample_rate)
        return destino, t


# ---------------------------------------------------------------- Gemini TTS

class Gemini(Motor):
    nome = "gemini"
    VOZES = [("Aoede", "F", "a do Jarvis (escolhida em 25/09)"), ("Kore", "F", ""), ("Leda", "F", ""),
             ("Charon", "M", ""), ("Puck", "M", ""), ("Orus", "M", "")]

    def carregar(self):
        # chave do Doppler só dentro do processo; nunca impressa nem gravada
        r = subprocess.run(["doppler", "secrets", "get", "GEMINI_API_KEY", "--plain", "--project", "harness",
                            "--config", "dev"], capture_output=True, text=True)
        chave = r.stdout.strip()
        if r.returncode != 0 or not chave:
            raise RuntimeError("GEMINI_API_KEY não veio do Doppler (harness/dev)")
        from google import genai
        self.cli = genai.Client(api_key=chave)
        nomes = [m.name for m in self.cli.models.list() if "tts" in m.name.lower()]
        if not nomes:
            raise RuntimeError("nenhum modelo de TTS listado")

        def versao(n):
            m = re.search(r"gemini-(\d+)\.(\d+)", n)
            return (int(m.group(1)), int(m.group(2))) if m else (0, 0)
        # a cota grátis diária é por modelo: quando uma acaba, passa para o próximo (flash novo primeiro)
        fila = sorted((n.removeprefix("models/") for n in nomes),
                      key=lambda n: ("pro" in n, "lite" in n, tuple(-x for x in versao(n))))
        self.fila_modelos = fila
        self.modelo = fila[0]
        self.info["modelo_api"] = self.modelo
        self.info["modelos_tts_listados"] = [n.removeprefix("models/") for n in nomes]
        self.ultima = 0.0
        self.intervalo = 7
        self.parar = False

    def vozes(self):
        return [{"id": slug(n), "nome": n, "genero": g, "nota": nota or self.modelo, "modelo": "Gemini",
                 "_v": n} for n, g, nota in self.VOZES]

    def sintetizar(self, voz, texto, destino):
        from google.genai import types
        cfg = types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voz["_v"]))))
        # só a frase: com instrução na frente ("Fale em português...:") o modelo LÊ a instrução em voz
        # alta (13/10: clipe de 6 s para 1,3 s de frase, medido por silencedetect)
        prompt = texto
        for tentativa in range(1, 7):
            espera = self.intervalo - (time.time() - self.ultima)
            if espera > 0:
                time.sleep(espera)
            try:
                t0 = time.perf_counter()
                self.ultima = time.time()
                resp = self.cli.models.generate_content(model=self.modelo, contents=prompt, config=cfg)
                t = time.perf_counter() - t0
                break
            except Exception as e:
                txt = str(e)
                if "429" not in txt and "RESOURCE_EXHAUSTED" not in txt:
                    raise RuntimeError(txt[:200]) from None
                cotas = sorted(set(re.findall(r"'quotaId': '([A-Za-z0-9_-]+)'", txt)))
                atraso = re.search(r"'retryDelay': '(\d+)s'", txt)
                self.info.setdefault("cotas_429", [])
                self.info["cotas_429"] = sorted(set(self.info["cotas_429"]) | set(cotas))
                if any("PerDay" in c for c in cotas) and self.modelo in self.fila_modelos[:-1]:
                    velho = self.modelo
                    self.modelo = self.fila_modelos[self.fila_modelos.index(velho) + 1]
                    self.info.setdefault("cota_diaria_esgotada", []).append(velho)
                    self.info["modelo_api"] = self.modelo
                    log(f"[gemini] cota diária de {velho} acabou; seguindo com {self.modelo}")
                    continue
                if any("PerDay" in c for c in cotas) or tentativa == 6:
                    self.parar = True
                    raise RuntimeError(f"limite da API (429, cota {', '.join(cotas) or '?'}); resto do Gemini pulado") from None
                seg = int(atraso.group(1)) + 2 if atraso else 60
                self.intervalo = min(30, self.intervalo + 5)
                log(f"[gemini] 429 (cota {', '.join(cotas) or '?'}); esperando {seg} s, intervalo agora {self.intervalo} s")
                time.sleep(seg)
        parte = resp.candidates[0].content.parts[0].inline_data
        taxa = 24000
        m = re.search(r"rate=(\d+)", parte.mime_type or "")
        if m:
            taxa = int(m.group(1))
        self.ultimo_extra = {"modelo": self.modelo}
        pcm = destino.with_suffix(".pcm")
        pcm.write_bytes(parte.data)
        subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-f", "s16le", "-ar",
                        str(taxa), "-ac", "1", "-i", str(pcm), str(destino)], check=True)
        pcm.unlink(missing_ok=True)
        return destino, t


# ---------------------------------------------------------------- Coqui

def _coqui_env() -> None:
    os.environ["COQUI_TOS_AGREED"] = "1"  # licença CPML do XTTS (uso pessoal); sem isso o download pergunta


class CoquiBase(Motor):
    modelo_id = ""
    lingua: str | None = None

    def carregar(self):
        _coqui_env()
        import torch
        from TTS.api import TTS
        torch.set_num_threads(max(4, (os.cpu_count() or 8) - 2))
        self.tts = TTS(self.modelo_id, progress_bar=False)
        self.sr = self.tts.synthesizer.output_sample_rate

    def sintetizar(self, voz, texto, destino):
        import numpy as np
        import soundfile as sf
        kw = {}
        if voz.get("_s") is not None:
            kw["speaker"] = voz["_s"]
        if self.lingua:
            kw["language"] = self.lingua
        kw.update(voz.get("_kw", {}))
        wav = self.tts.tts(texto, **kw)
        sf.write(str(destino), np.asarray(wav, dtype="float32"), self.sr)
        return destino


class Xtts(CoquiBase):
    nome = "xtts"
    modelo_id = "tts_models/multilingual/multi-dataset/xtts_v2"
    lingua = "pt"

    def vozes(self):
        nomes = list(self.tts.speakers or [])
        self.info["total_catalogo"] = len(nomes)
        return [{"id": slug(n), "nome": n, "genero": XTTS_GENERO.get(n, "?"), "nota": "locutor embutido",
                 "modelo": "XTTS-v2", "_s": n} for n in nomes]


class YourTTS(CoquiBase):
    nome = "yourtts"
    modelo_id = "tts_models/multilingual/multi-dataset/your_tts"
    lingua = "pt-br"

    def vozes(self):
        crus = list(self.tts.speakers or [])
        self.info["locutores_crus"] = crus
        # 'female-en-5' e 'female-en-5\n' são locutores diferentes no speakers.json (embeddings distintos,
        # cosseno 0,83): todos entram; o com "\n" vira "variante 2" quando o nome limpo já existe
        out, vistos = [], set()
        for s in sorted(crus, key=lambda s: (s.strip(), s.endswith("\n") and s.strip() in crus)):
            limpo = s.strip()
            dup = limpo in vistos
            vistos.add(limpo)
            genero = "F" if limpo.startswith("female") else "M" if limpo.startswith("male") else "?"
            origem = "treinada em português" if "-pt-" in limpo else "treinada em inglês, falando pt-br"
            out.append({"id": slug(limpo) + ("-v2" if dup else ""), "nome": limpo + (" (variante 2)" if dup else ""),
                        "genero": genero, "nota": origem, "modelo": "YourTTS", "_s": s})
        return out


class CoquiVits(CoquiBase):
    nome = "coqui_vits"
    modelo_id = "tts_models/pt/cv/vits"

    def vozes(self):
        falantes = list(self.tts.speakers or []) if self.tts.is_multi_speaker else []
        if not falantes:
            return [{"id": "cv-vits", "nome": "Common Voice pt", "genero": "?", "nota": "voz única",
                     "modelo": "VITS pt", "_s": None}]
        return [{"id": slug(s), "nome": s, "genero": "?", "nota": "", "modelo": "VITS pt", "_s": s}
                for s in falantes]


class Bark(CoquiBase):
    nome = "bark"
    modelo_id = "tts_models/multilingual/multi-dataset/bark"
    por_frase = True
    limite_s = 90 * 60  # Bark no processador leva minutos por frase: teto de 1,5 h, retomável depois

    def carregar(self):
        import urllib.request
        self.vdir = VOZ_DIR / "bark-vozes"
        self.vdir.mkdir(parents=True, exist_ok=True)
        for i in range(10):
            arq = self.vdir / f"pt_speaker_{i}.npz"
            if not arq.exists():
                urllib.request.urlretrieve(
                    f"https://github.com/suno-ai/bark/raw/main/bark/assets/prompts/v2/pt_speaker_{i}.npz", arq)
        super().carregar()

    def vozes(self):
        # gênero sem rótulo de origem: sai da altura medida da voz (montar_html)
        return [{"id": f"pt-speaker-{i}", "nome": f"pt_speaker_{i}", "genero": "?",
                 "nota": "preset português da Suno", "modelo": "Bark",
                 "_s": f"pt_speaker_{i}", "_kw": {"voice_dir": str(self.vdir)}} for i in range(10)]


MOTOR_CLASSE = {"windows": Windows, "piper": Piper, "edge": Edge, "pocket": Pocket, "gemini": Gemini,
                "coqui_vits": CoquiVits, "yourtts": YourTTS, "xtts": Xtts, "bark": Bark}


def catalogo_coqui() -> None:
    """Todo modelo do catálogo Coqui: o que entrou e por que o resto ficou fora (nada escondido)."""
    _coqui_env()
    from TTS.api import TTS
    from TTS.utils.manage import ModelManager
    usados = {"tts_models/multilingual/multi-dataset/xtts_v2", "tts_models/multilingual/multi-dataset/your_tts",
              "tts_models/pt/cv/vits", "tts_models/multilingual/multi-dataset/bark"}
    fora = []
    for m in TTS().list_models():
        if m in usados:
            continue
        partes = m.split("/")
        if m.endswith("xtts_v1.1"):
            urls = ModelManager().models_dict["tts_models"]["multilingual"]["multi-dataset"]["xtts_v1.1"].get("hf_url", [])
            arqs = ", ".join(u.rsplit("/", 1)[-1] for u in urls)
            motivo = f"fala português, mas não tem locutor embutido (arquivos: {arqs}): só clona de um áudio de referência; o v2 é o sucessor"
        elif partes[0] == "vocoder_models":
            motivo = "vocoder (peça interna de outro modelo), não é uma voz"
        elif partes[0] == "voice_conversion_models":
            motivo = "conversão de voz (troca a voz de um áudio pronto), não lê texto"
        else:
            motivo = f"só fala {partes[1]}"
        fora.append({"modelo": m, "motivo": motivo})
    (CLIPES / "_coqui_catalogo.json").write_text(json.dumps({"usados": sorted(usados), "fora": fora},
                                                            ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"catálogo Coqui: {len(usados)} modelos com português usados, {len(fora)} fora")


# ---------------------------------------------------------------- HTML

def montar_html() -> Path:
    motores = []
    # no HTML o XTTS abre a seção do Coqui (é o que o Gabriel lembrava); a geração segue ORDEM
    for nome in ["xtts", "yourtts", "coqui_vits", "bark", "piper", "edge", "gemini", "pocket", "windows"]:
        arq = CLIPES / nome / "_motor.json"
        if not arq.exists():
            motores.append({"motor": nome, "vozes": [], "fora": [], "falhas": [],
                            "tempo_esgotado": "ainda não rodou"})
            continue
        motores.append(json.loads(arq.read_text(encoding="utf-8")))
    cat = {}
    if (CLIPES / "_coqui_catalogo.json").exists():
        cat = json.loads((CLIPES / "_coqui_catalogo.json").read_text(encoding="utf-8"))
    pausas = []
    if PAUSAS.exists():
        pausas = [json.loads(l) for l in PAUSAS.read_text(encoding="utf-8").splitlines() if l.strip()]

    audio: dict[str, str] = {}
    dados = []
    for m in motores:
        secao, titulo, desc = MOTORES[m["motor"]]
        vozes_out = []
        tg, dr = [], []
        for v in m.get("vozes", []):
            frases = []
            f0 = None
            modelos: set[str] = set()
            for n in range(1, len(FRASES) + 1):
                ogg = CLIPES / m["motor"] / v["id"] / f"{n}.ogg"
                meta = CLIPES / m["motor"] / v["id"] / f"{n}.json"
                if ogg.exists() and meta.exists():
                    md = json.loads(meta.read_text(encoding="utf-8"))
                    chave = f"{m['motor']}/{v['id']}/{n}"
                    audio[chave] = base64.b64encode(ogg.read_bytes()).decode()
                    frases.append({"k": chave, "t": md["t_ger"], "d": md["dur"]})
                    tg.append(md["t_ger"])
                    dr.append(md["dur"])
                    f0 = md.get("f0", f0)
                    if md.get("modelo"):
                        modelos.add(md["modelo"])
                else:
                    frases.append(None)
            if not any(frases):
                continue
            nota = v.get("nota", "")
            if modelos:
                nota = (nota + " · " if nota and nota not in modelos else "") + "modelo " + " + ".join(sorted(modelos))
            genero = v.get("genero", "?")
            # altura: homem ~85-155 Hz, mulher ~165-255 Hz; voz sintética expressiva sobe, então só
            # contradiz o rótulo quando a diferença é clara
            if f0 and genero in ("M", "F") and ((genero == "M" and f0 > 195) or (genero == "F" and f0 < 145)):
                genero_nota = f"rótulo {genero}, mas a altura medida ({f0:.0f} Hz) sugere o contrário"
                genero = "?"
            elif f0 and genero == "?" and (f0 < 155 or f0 > 175):
                genero = "M" if f0 < 155 else "F"
                genero_nota = "gênero pela altura medida da voz"
            else:
                genero_nota = ""
            vozes_out.append({"id": f"{m['motor']}/{v['id']}", "nome": v["nome"], "g": genero,
                              "gnota": genero_nota, "nota": nota, "f0": f0, "frases": frases})
        total = len(m.get("vozes", []))
        if m["motor"] == "xtts" and m.get("total_catalogo"):
            total = m["total_catalogo"]
        dados.append({"motor": m["motor"], "secao": secao, "titulo": titulo, "desc": desc,
                      "modeloApi": None if m["motor"] == "gemini" else m.get("modelo_api"), "total": total, "ok": len(vozes_out),
                      "tMedio": round(sum(tg) / len(tg), 2) if tg else None,
                      "rtf": round(sum(tg) / sum(dr), 2) if dr and sum(dr) else None,
                      "carga": m.get("carga_s"), "fora": m.get("fora", []),
                      "obs": "; ".join(x for x in [
                          m.get("tempo_esgotado"),
                          ("cota grátis diária esgotada em " + ", ".join(m["cota_diaria_esgotada"])
                           + " (o Google limita por modelo; cada voz mostra o modelo usado)")
                          if m.get("cota_diaria_esgotada") else None] if x),
                      "falhas": m.get("falhas", [])[:12], "nFalhas": len(m.get("falhas", [])),
                      "vozes": vozes_out})

    pagina = (_HTML.replace("__FRASES__", json.dumps(FRASES, ensure_ascii=False))
              .replace("__DADOS__", json.dumps(dados, ensure_ascii=False))
              .replace("__CAT__", json.dumps(cat, ensure_ascii=False))
              .replace("__PAUSAS__", json.dumps(pausas, ensure_ascii=False))
              .replace("__SECOES__", json.dumps(SECOES))
              .replace("__GERADO__", time.strftime("%d/%m/%Y %H:%M"))
              .replace("__AUDIO__", json.dumps(audio)))
    HTML_SAIDA.write_text(pagina, encoding="utf-8")
    log(f"HTML: {HTML_SAIDA} ({HTML_SAIDA.stat().st_size / 1e6:.1f} MB, {len(audio)} clipes)")
    return HTML_SAIDA


_HTML = r"""<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bancada de vozes</title>
<link rel="icon" href="data:,">
<style>
:root{--bg:#f6f5f2;--card:#fff;--tx:#1d1d1f;--mut:#6b6b70;--lin:#e2e0db;--ac:#2f6fdb;--ac2:#e8f0fd;--est:#d99a00;--m:#2f6fdb;--f:#c2417a;--ok:#2e8b57}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#141416;--card:#1e1e22;--tx:#ececef;--mut:#9a9aa2;--lin:#2e2e34;--ac:#6ea2ff;--ac2:#1e2a40;--est:#ffc23d;--m:#6ea2ff;--f:#ff7fb1;--ok:#5fd08e}}
:root[data-theme="dark"]{--bg:#141416;--card:#1e1e22;--tx:#ececef;--mut:#9a9aa2;--lin:#2e2e34;--ac:#6ea2ff;--ac2:#1e2a40;--est:#ffc23d;--m:#6ea2ff;--f:#ff7fb1;--ok:#5fd08e}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1100px;margin:0 auto;padding:20px 16px 80px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:19px;margin:34px 0 8px}h3{font-size:16px;margin:18px 0 4px}
.mut{color:var(--mut)}.peq{font-size:13px}
.barra{position:sticky;top:0;z-index:5;background:var(--bg);border-bottom:1px solid var(--lin);padding:10px 0;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
button,select,input{font:inherit;color:inherit}
.bt{border:1px solid var(--lin);background:var(--card);border-radius:8px;padding:6px 10px;cursor:pointer}
.bt:hover{border-color:var(--ac)}.bt.on{background:var(--ac2);border-color:var(--ac)}
input[type=search]{border:1px solid var(--lin);background:var(--card);border-radius:8px;padding:6px 10px;min-width:0;flex:1 1 160px}
.frases{margin:8px 0 0;padding-left:20px}.frases li{margin:2px 0}
.motor{border-top:1px solid var(--lin);padding-top:6px}
.resumo{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13px;color:var(--mut);margin:2px 0 8px}
.grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}
.voz{background:var(--card);border:1px solid var(--lin);border-radius:10px;padding:10px 12px}
.voz.fav{border-color:var(--est)}
.topo{display:flex;align-items:center;gap:8px}
.nome{font-weight:600;flex:1;min-width:0;overflow-wrap:anywhere}
.g{font-size:12px;font-weight:700;border-radius:5px;padding:1px 6px;border:1px solid currentColor}
.g.M{color:var(--m)}.g.F{color:var(--f)}.g.x{color:var(--mut)}
.est{border:0;background:none;font-size:20px;line-height:1;cursor:pointer;color:var(--mut);padding:0 2px}
.fav .est{color:var(--est)}
.nota{font-size:12px;color:var(--mut);margin:2px 0 6px}
.linha{display:flex;align-items:center;gap:8px;padding:2px 0;font-size:13px}
.play{width:30px;height:30px;flex:0 0 30px;border-radius:50%;border:1px solid var(--lin);background:var(--bg);cursor:pointer;font-size:12px}
.play.toca{background:var(--ac);color:#fff;border-color:var(--ac)}
.txt{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.t{color:var(--mut);font-variant-numeric:tabular-nums;white-space:nowrap}
.seis{margin-top:6px;width:100%}
details{margin:6px 0}summary{cursor:pointer;color:var(--mut);font-size:13px}
details ul{margin:4px 0;padding-left:20px;font-size:13px;color:var(--mut)}
.falhas{font-size:12px;color:var(--mut)}
#aviso{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:var(--tx);color:var(--bg);padding:8px 14px;border-radius:8px;display:none;max-width:90vw}
table{border-collapse:collapse;font-size:13px;width:100%;margin-top:8px}td,th{border-bottom:1px solid var(--lin);padding:4px 6px;text-align:left}
.tabela{overflow-x:auto}
textarea{position:absolute;left:-9999px}
code{overflow-wrap:anywhere}
@media (max-width:600px){.barra{position:static}.grade{grid-template-columns:1fr}}
</style>
</head>
<body>
<main>
<h1>Bancada de vozes do coach</h1>
<div class="mut peq">gerado em __GERADO__ · as mesmas 6 frases em todas as vozes · volume igualado · tudo dentro deste arquivo, funciona sem internet</div>
<ol class="frases" id="frases"></ol>
<p class="peq mut">Como usar: ▶ toca uma frase; "tocar as 6" toca a voz inteira; ☆ marca favorita (fica guardada neste navegador); no fim, "copiar minhas favoritas" e cola no chat. O número ao lado de cada frase é quanto tempo a voz levou para gerar a frase (importa para o pacote completo, ~500 frases).</p>
<div class="tabela"><table id="tab"></table></div>
<div class="barra">
 <span class="peq mut">gênero:</span>
 <button class="bt on" data-g="todos">todos</button><button class="bt" data-g="M">masculino</button><button class="bt" data-g="F">feminino</button>
 <button class="bt" id="sofav">só favoritas</button>
 <input type="search" id="busca" placeholder="buscar voz pelo nome">
 <button class="bt" id="copiar">copiar minhas favoritas (<span id="nfav">0</span>)</button>
</div>
<div id="conteudo"></div>
<h2>Pausas por causa do jogo</h2>
<div id="pausas" class="peq mut"></div>
</main>
<div id="aviso"></div>
<textarea id="area"></textarea>
<script>
const FRASES=__FRASES__;const DADOS=__DADOS__;const CAT=__CAT__;const PAUSAS=__PAUSAS__;const SECOES=__SECOES__;
const AUDIO=__AUDIO__;
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=v=>v==null?"–":(v<10?v.toFixed(2):v.toFixed(1)).replace(".",",");
let favs=new Set();try{favs=new Set(JSON.parse(localStorage.getItem("vozesFav")||"[]"))}catch(e){}
function salvar(){try{localStorage.setItem("vozesFav",JSON.stringify([...favs]))}catch(e){}$("#nfav").textContent=favs.size}
let filtroG="todos",soFav=false,busca="";
FRASES.forEach(f=>{const li=document.createElement("li");li.textContent=f;$("#frases").appendChild(li)});
// tabela-resumo
(function(){let h="<tr><th>motor</th><th>vozes</th><th>s por frase</th><th>RTF</th><th>falhas</th></tr>";
for(const m of DADOS){h+=`<tr><td>${esc(m.titulo)}</td><td>${m.ok} de ${m.total}</td><td>${fmt(m.tMedio)}</td><td>${fmt(m.rtf)}</td><td>${m.nFalhas}</td></tr>`}
h+=`<tr><td colspan="5" class="mut">RTF = tempo para gerar ÷ duração do áudio. Abaixo de 1 dá para gerar ao vivo; acima, só pré-gravado. Carga do modelo não entra.</td></tr>`;
$("#tab").innerHTML=h})();
const toc=new Audio();let fila=[],botaoAtual=null;
function marcar(b){if(botaoAtual){botaoAtual.classList.remove("toca");botaoAtual.textContent="▶"}botaoAtual=b;if(b){b.classList.add("toca");b.textContent="■"}}
function tocar(k,b){if(botaoAtual===b&&!toc.paused){toc.pause();fila=[];marcar(null);return}fila=[];iniciar(k,b)}
function iniciar(k,b){toc.src="data:audio/ogg;codecs=opus;base64,"+AUDIO[k];marcar(b);toc.play().catch(e=>aviso("não tocou: "+e.message))}
toc.addEventListener("ended",()=>{if(fila.length){const [k,b]=fila.shift();iniciar(k,b)}else marcar(null)});
function tocarSeis(card){const bs=[...card.querySelectorAll(".play")];fila=bs.map(b=>[b.dataset.k,b]);if(fila.length){const [k,b]=fila.shift();iniciar(k,b)}}
function aviso(t){const a=$("#aviso");a.textContent=t;a.style.display="block";clearTimeout(aviso.t);aviso.t=setTimeout(()=>a.style.display="none",2500)}
function cartao(m,v){const fav=favs.has(v.id);const g=v.g==="M"||v.g==="F"?v.g:"x";
let h=`<div class="voz${fav?" fav":""}" data-id="${esc(v.id)}" data-g="${esc(v.g)}" data-nome="${esc((v.nome+" "+v.nota).toLowerCase())}">
<div class="topo"><span class="nome">${esc(v.nome)}</span><span class="g ${g}" title="${esc(v.gnota||"")}">${esc(v.g==="M"?"masc":v.g==="F"?"fem":"?")}</span><button class="est" title="favorita">${fav?"★":"☆"}</button></div>
<div class="nota">${esc(m.titulo)}${v.nota?" · "+esc(v.nota):""}${v.f0?" · tom médio "+v.f0+" Hz":""}${v.gnota?" · "+esc(v.gnota):""}</div>`;
v.frases.forEach((f,i)=>{if(f)h+=`<div class="linha"><button class="play" data-k="${f.k}">▶</button><span class="txt" title="${esc(FRASES[i])}">${i+1}. ${esc(FRASES[i])}</span><span class="t" title="gerou em ${fmt(f.t)} s um áudio de ${fmt(f.d)} s">${fmt(f.t)} s</span></div>`;
 else h+=`<div class="linha mut"><span class="play" style="border:0"></span><span class="txt">${i+1}. não gerou</span></div>`});
return h+`<button class="bt seis">tocar as 6</button></div>`}
function montar(){let h="";
for(const sec of SECOES){const ms=DADOS.filter(m=>m.secao===sec);if(!ms.length)continue;h+=`<h2>${esc(sec)}</h2>`;
 if(sec==="Coqui"){const cont=ms.map(m=>`${esc(m.titulo)}: ${m.ok} de ${m.total} vozes`).join(" · ");h+=`<div class="peq">${cont}</div>`;
  if(CAT.fora){h+=`<details><summary>Modelos do Coqui que ficaram fora (${CAT.fora.length}) e por quê</summary><ul>${CAT.fora.map(f=>`<li><code>${esc(f.modelo)}</code>: ${esc(f.motivo)}</li>`).join("")}</ul></details>`}}
 for(const m of ms){h+=`<div class="motor"><h3>${esc(m.titulo)} <span class="mut peq">· ${m.ok} de ${m.total} vozes</span></h3><div class="peq mut">${esc(m.desc)}${m.modeloApi?" · modelo "+esc(m.modeloApi):""}</div>
  <div class="resumo"><span>média ${fmt(m.tMedio)} s por frase</span><span>RTF ${fmt(m.rtf)}</span>${m.carga!=null?`<span>carga do modelo ${fmt(m.carga)} s</span>`:""}${m.obs?`<span>${esc(m.obs)}</span>`:""}</div>`;
  if(m.fora&&m.fora.length)h+=`<details><summary>fora desta seção</summary><ul>${m.fora.map(f=>`<li>${esc(f.modelo)}: ${esc(f.motivo)}</li>`).join("")}</ul></details>`;
  if(m.nFalhas)h+=`<details><summary>${m.nFalhas} falha(s)</summary><ul class="falhas">${m.falhas.map(f=>`<li>${esc(f.onde)}: ${esc(f.erro)}</li>`).join("")}</ul></details>`;
  h+=`<div class="grade">${m.vozes.map(v=>cartao(m,v)).join("")}</div></div>`}}
$("#conteudo").innerHTML=h;filtrar()}
function filtrar(){document.querySelectorAll(".voz").forEach(c=>{
 let ok=true;if(filtroG!=="todos"&&c.dataset.g!==filtroG)ok=false;if(busca&&!c.dataset.nome.includes(busca))ok=false;if(soFav&&!favs.has(c.dataset.id))ok=false;c.style.display=ok?"":"none"})}
document.addEventListener("click",e=>{const b=e.target.closest("button");if(!b)return;
 if(b.classList.contains("play")){tocar(b.dataset.k,b);return}
 const card=b.closest(".voz");
 if(b.classList.contains("seis")&&card){tocarSeis(card);return}
 if(b.classList.contains("est")&&card){const id=card.dataset.id;if(favs.has(id))favs.delete(id);else favs.add(id);card.classList.toggle("fav",favs.has(id));b.textContent=favs.has(id)?"★":"☆";salvar();return}
 if(b.dataset.g){filtroG=b.dataset.g;document.querySelectorAll("[data-g].bt").forEach(x=>x.classList.toggle("on",x===b));filtrar();return}
 if(b.id==="sofav"){soFav=!soFav;b.classList.toggle("on",soFav);filtrar();return}
 if(b.id==="copiar"){copiar()}});
$("#busca").addEventListener("input",e=>{busca=e.target.value.trim().toLowerCase();filtrar()});
function copiar(){if(!favs.size){aviso("nenhuma favorita marcada");return}
 const linhas=[...favs].map(id=>{const [mo,vid]=id.split("/");const m=DADOS.find(x=>x.motor===mo);const v=m&&m.vozes.find(x=>x.id===id);return v?`- ${m.titulo} · ${v.nome}${v.g==="M"||v.g==="F"?" ("+v.g+")":""} [${id}]`:`- ${id}`});
 const txt="minhas favoritas da bancada de vozes:\n"+linhas.join("\n");
 const fim=()=>aviso("copiado: cola no chat");
 if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(txt).then(fim,()=>manual(txt,fim))}else manual(txt,fim)}
function manual(txt,fim){const a=$("#area");a.value=txt;a.select();try{document.execCommand("copy");fim()}catch(e){prompt("copia daqui:",txt)}}
$("#pausas").textContent=PAUSAS.length?PAUSAS.map(p=>`${p.inicio} até ${p.fim} (${Math.round(p.dur_s/60)} min, em ${p.onde})`).join(" · "):"nenhuma: o jogo não abriu durante a geração.";
salvar();montar();
</script>
</body>
</html>
"""


# ---------------------------------------------------------------- principal

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--motores", default=",".join(ORDEM), help="lista separada por vírgula (padrão: todos)")
    ap.add_argument("--motor", help=argparse.SUPPRESS)  # filho: roda um motor só
    ap.add_argument("--html", action="store_true", help="só monta o HTML com os clipes existentes")
    a = ap.parse_args()
    SAIDA.mkdir(parents=True, exist_ok=True)
    CLIPES.mkdir(parents=True, exist_ok=True)
    prioridade_baixa()
    if a.html:
        montar_html()
        return 0
    if a.motor:
        if a.motor == "_catalogo":
            catalogo_coqui()
        else:
            MOTOR_CLASSE[a.motor]().rodar()
        return 0
    if "venv" not in sys.executable.lower():
        log(f"aviso: rodando fora do venv isolado ({sys.executable})")
    pedidos = [m.strip() for m in a.motores.split(",") if m.strip()]
    for m in pedidos:
        if m not in MOTOR_CLASSE:
            log(f"motor desconhecido: {m}")
            return 2
    # UTF-8 no filho: o pocket-tts lê o YAML de config com o codec padrão (cp1252 aqui) e morre
    amb = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    subprocess.run([sys.executable, __file__, "--motor", "_catalogo"], env=amb)
    for m in pedidos:
        log(f"=== motor {m}")
        t0 = time.time()
        r = subprocess.run([sys.executable, __file__, "--motor", m], env=amb)
        log(f"=== motor {m} terminou (código {r.returncode}) em {round(time.time() - t0)} s")
        try:
            montar_html()
        except Exception:
            log(traceback.format_exc())
    return 0


if __name__ == "__main__":
    sys.exit(main())
