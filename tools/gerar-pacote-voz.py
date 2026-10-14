"""Gerador do pacote de voz pré-gravada (plano 2026-10-13-voz-pregravada-e-foco, passo 6).

Grava cada fala do catálogo (`coletor/avisos.catalogo()`) uma vez, fora da partida, para o coach só tocar
o arquivo durante o jogo (`coletor/voz.py`). Voz escolhida pelo Gabriel em 13/10/2026: **Aoede (Gemini)**.

Roda SÓ no venv do TTS (tem o `google-genai`; nunca o Python do coletor):

    %LOCALAPPDATA%\\lol-client\\voz\\venv\\Scripts\\python.exe tools\\gerar-pacote-voz.py --voz aoede
    ... --tom serio|descontraido|ambos   (padrão ambos)
    ... --lote 8 --max-pedidos 1          calibrar: 1 pedido só, ver se o corte bate
    ... --seco                            só conta o que falta e mostra os lotes (sem chave, sem rede)
    ... --sem-conferir                    não transcreve os trechos (Whisper do Reco)

Saída: `%LOCALAPPDATA%\\lol-client\\voz\\pacotes\\<voz>\\<hash>.wav` (PCM 16 bits, 24 kHz, mono,
`loudnorm` em duas passadas) + `indice.json` (fala -> arquivo, versão do catálogo, modelo usado, nota da
conferência). Retomável: fala com arquivo no índice não é refeita; o índice é regravado (atômico) a cada lote.

**Cota grátis pequena** (~10 pedidos/dia por modelo, ARMADILHAS § Voz pré-gravada): várias frases por
pedido, uma por parágrafo (sem número: o número seria falado; sem instrução: a instrução seria lida), em
rodízio de moldes (frases vizinhas diferentes). **Corte guiado pela transcrição** (padrão): o silêncio
(`ffmpeg silencedetect`) só separa os pedaços de som; o Whisper do Reco (`tools/conferir-trechos.py`,
`py -3.14`) transcreve cada pedaço e `alinhar` junta pedaços contíguos por frase (maior soma de semelhança),
largando até 2 pedaços soltos no começo/fim (o modelo põe um "E aí" no fim). Medido nos lotes reais de 13/10:
pausa entre frases 0,41-0,88 s e de vírgula 0,39-0,53 s se sobrepõem, então o silêncio sozinho não decide.
Trecho que soa mais como OUTRA frase do lote ou com texto a mais (frases grudadas) recusa o lote inteiro (é
dividido ao meio e pedido de novo); nota abaixo de NOTA_MIN refaz a frase sozinha uma vez e, se continuar,
marca `suspeita` (o tocador pula: Maria ao vivo; `--refazer-suspeitas` pede de novo). Conferência que falha
(processo morto, resposta curta) para a rodada sem gravar o lote (saída 1). Com `--sem-conferir` sobra o
corte só pelo silêncio (`segmentar`: n-1 maiores pausas, claramente maiores que as de dentro), que recusa
muito lote. Frase sozinha com duração absurda fica fora do pacote, em `falhas` no índice (cai na Maria).
Dois-pontos e "?" no meio da frase vão ao TTS como vírgula (`texto_falado`; a pausa de vírgula continua).

Recusa rodar com `League of Legends.exe` aberto e para limpo se ele abrir no meio (o processador e a rede
são do jogo). No 429 diário de todos os modelos, para limpo e diz quantas faltam (retomar no dia seguinte).
Saída do processo: 0 completo, 2 parou na cota ou no --max-pedidos, 3 jogo aberto, 1 erro.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import avisos  # noqa: E402  (catálogo: dono é o coletor/avisos.py)

VOZ_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "lol-client" / "voz"
PACOTES = VOZ_DIR / "pacotes"
BRUTOS = RAIZ / "temp" / "pacote-voz"
VOZES_GEMINI = {"aoede": "Aoede"}   # id do pacote -> voz do Gemini (outra voz do Gemini: o nome em minúsculas)
TAXA = 24000

# régua do corte, calibrada nos 6 clipes da Aoede da bancada (13/10/2026): 0,061 a 0,096 s por caractere de
# fala; pausa de vírgula dentro da frase até 0,38 s ("...pela última vez no rio de cima, há vinte segundos")
S_BASE, S_POR_CHAR = 0.35, 0.075
# trecho aceito entre 0,5× e 1,5× da duração esperada (revisão 13/10: 2× aceitava duas frases curtas grudadas)
DUR_MIN, DUR_MAX = 0.5, 1.5
PAUSA_MIN = 0.45                  # pausa de corte entre frases: no mínimo isto...
PAUSA_FOLGA = 1.3                 # ...e 1,3× a maior pausa que ficou dentro de um trecho
SILENCIO_DB, SILENCIO_S = -40, 0.12
PAD_S = 0.06                      # respiro antes e depois do trecho cortado
NOTA_MIN = 0.6                    # conferência pelo Whisper (0 a 1)
GRUDADO = 1.4                     # transcrição com mais de 1,4× os caracteres da frase = duas frases num trecho


class CotaEsgotada(RuntimeError):
    """429 diário em todos os modelos de TTS: parar limpo e retomar no dia seguinte"""


class ConferenciaFalhou(RuntimeError):
    """o processo do Whisper morreu ou respondeu torto: nada do lote entra sem conferência"""


def log(msg):
    print(f"{time.strftime('%H:%M:%S')} {msg}", flush=True)


# ---------------------------------------------------------------- jogo aberto

def jogo_aberto():
    try:
        import psutil
        return any((p.info.get("name") or "").lower() == "league of legends.exe" for p in psutil.process_iter(["name"]))
    except Exception:
        r = subprocess.run(["tasklist", "/FI", "IMAGENAME eq League of Legends.exe", "/NH"],
                           capture_output=True, text=True, errors="replace")
        return "league of legends.exe" in r.stdout.lower()


# ---------------------------------------------------------------- áudio

def nome_arquivo(fala):
    return hashlib.sha1(fala.encode("utf-8")).hexdigest()[:16] + ".wav"


def esperado(fala):
    return S_BASE + S_POR_CHAR * len(fala)


def plausivel(fala, dur):
    e = esperado(fala)
    return DUR_MIN * e <= dur <= DUR_MAX * e


def duracao(caminho):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1",
                        str(caminho)], capture_output=True, text=True)
    return float(r.stdout.strip())


def silencios(caminho):
    """(duração, [(início, fim)]) dos silêncios de pelo menos SILENCIO_S abaixo de SILENCIO_DB"""
    dur = duracao(caminho)
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-i", str(caminho), "-af",
                        f"silencedetect=noise={SILENCIO_DB}dB:d={SILENCIO_S}", "-f", "null", "-"],
                       capture_output=True, text=True, errors="replace")
    out, ini = [], None
    for m in re.finditer(r"silence_(start|end): (-?[0-9.]+)", r.stderr):
        v = max(0.0, float(m.group(2)))
        if m.group(1) == "start":
            ini = v
        elif ini is not None:
            out.append((ini, v))
            ini = None
    if ini is not None:
        out.append((ini, dur))
    return dur, out


def segmentar(dur, sil, frases):
    """corta o áudio de um lote em len(frases) trechos -> ([(início, fim)], None) ou (None, motivo)"""
    n = len(frases)
    ini_fala = sil[0][1] if sil and sil[0][0] <= 0.02 else 0.0
    fim_fala = sil[-1][0] if sil and sil[-1][1] >= dur - 0.02 else dur
    if fim_fala - ini_fala <= 0.05:
        return None, "áudio sem fala"
    internos = [s for s in sil if s[0] > ini_fala + 1e-3 and s[1] < fim_fala - 1e-3]
    if len(internos) < n - 1:
        return None, f"{len(internos) + 1} trecho(s) para {n} frases"
    por_tamanho = sorted(internos, key=lambda s: s[1] - s[0], reverse=True)
    cortes, resto = sorted(por_tamanho[:n - 1]), por_tamanho[n - 1:]
    if cortes:
        menor = min(b - a for a, b in cortes)
        maior_dentro = max((b - a for a, b in resto), default=0.0)
        if menor < PAUSA_MIN or menor < PAUSA_FOLGA * maior_dentro:
            return None, f"pausas ambíguas (menor entre frases {menor:.2f} s, maior dentro {maior_dentro:.2f} s)"
    bordas = [ini_fala] + [x for c in cortes for x in c] + [fim_fala]
    trechos = list(zip(bordas[0::2], bordas[1::2]))
    for f, (a, b) in zip(frases, trechos):
        if not plausivel(f, b - a):
            return None, f"{f!r} com {b - a:.2f} s (esperado {esperado(f):.2f} s)"
    return trechos, None


# corte guiado pela transcrição (13/10/2026, medido nos 3 primeiros lotes reais da Aoede): a pausa entre frases
# (0,41-0,88 s) e a de vírgula/dois-pontos (0,39-0,53 s) se sobrepõem, e o modelo põe um pedaço solto no fim
# ("E aí"). O silêncio só define os PEDAÇOS; o Whisper transcreve cada um e o alinhamento junta pedaços
# contíguos por frase (maior soma de semelhança), podendo largar até SOBRA_MAX pedaços no começo e no fim.
SOBRA_MAX = 2
DUR_MIN_TRANSCRITO = 0.35         # com a transcrição conferindo, a fala rápida (0,52× da esperada) passa


def pedacos(dur, sil):
    """[(início, fim)] de cada trecho de som entre os silêncios"""
    ini = sil[0][1] if sil and sil[0][0] <= 0.02 else 0.0
    fim = sil[-1][0] if sil and sil[-1][1] >= dur - 0.02 else dur
    internos = [s for s in sil if s[0] > ini + 1e-3 and s[1] < fim - 1e-3]
    bordas = [ini] + [x for c in internos for x in c] + [fim]
    return [(a, b) for a, b in zip(bordas[0::2], bordas[1::2]) if b - a > 0.02]


def alinhar(frases, textos, sobra_max=SOBRA_MAX):
    """[(i, j)] por frase: pedaços textos[i:j] contíguos, em ordem, maximizando a soma de semelhanca(frase,
    texto juntado); até sobra_max pedaços largados no começo e no fim (nunca no meio). None se não cabe."""
    n, m = len(frases), len(textos)
    melhor = None
    for a in range(min(sobra_max, m) + 1):
        for z in range(min(sobra_max, m - a) + 1):
            mm = m - a - z
            if mm < n:
                continue
            neg = float("-inf")
            dp = [[neg] * (mm + 1) for _ in range(n + 1)]
            volta = [[0] * (mm + 1) for _ in range(n + 1)]
            dp[0][0] = 0.0
            for j in range(1, n + 1):
                for i in range(j, mm - (n - j) + 1):
                    for k in range(j - 1, i):
                        if dp[j - 1][k] == neg:
                            continue
                        s = dp[j - 1][k] + semelhanca(frases[j - 1], " ".join(textos[a + k:a + i]))
                        if s > dp[j][i]:
                            dp[j][i], volta[j][i] = s, k
            if dp[n][mm] == neg:
                continue
            nota = dp[n][mm] - 0.01 * (a + z)          # empate: larga menos pedaços
            if melhor is None or nota > melhor[0]:
                grupos, i = [], mm
                for j in range(n, 0, -1):
                    k = volta[j][i]
                    grupos.append((a + k, a + i))
                    i = k
                melhor = (nota, grupos[::-1])
    return melhor[1] if melhor else None


def cortar_por_transcricao(bruto, frases, transcrever):
    """corta o lote pelos pedaços transcritos -> (trechos [(início, fim)], textos por frase, None) ou
    (None, None, motivo). transcrever(caminhos) -> textos (o Conferidor); ConferenciaFalhou sobe."""
    dur, sil = silencios(bruto)
    ps = pedacos(dur, sil)
    if len(ps) < len(frases):
        return None, None, f"{len(ps)} pedaço(s) de som para {len(frases)} frases"
    arquivos = [bruto.with_name(f"{bruto.stem}-p{i:02d}.wav") for i in range(len(ps))]
    try:
        for (a, b), arq in zip(ps, arquivos):
            subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-i", str(bruto),
                            "-ss", f"{a:.3f}", "-to", f"{b:.3f}", "-ac", "1", str(arq)], check=True)
        textos = checar_textos(transcrever(arquivos), arquivos)
    finally:
        for arq in arquivos:
            arq.unlink(missing_ok=True)
    grupos = alinhar(frases, textos)
    if grupos is None:
        return None, None, f"{len(ps)} pedaço(s) não alinham com {len(frases)} frases"
    trechos = [(ps[i][0], ps[j - 1][1]) for i, j in grupos]
    juntos = [" ".join(textos[i:j]) for i, j in grupos]
    for f, (a, b) in zip(frases, trechos):
        e = esperado(f)
        if not DUR_MIN_TRANSCRITO * e <= b - a <= DUR_MAX * e:
            return None, None, f"{f!r} com {b - a:.2f} s (esperado {e:.2f} s)"
    sobras = [textos[i] for i in range(len(textos)) if not any(x <= i < y for x, y in grupos)]
    if sobras:
        log(f"pedaço(s) largado(s) no lote: {sobras}")
    return trechos, juntos, None


def extrair(bruto, a, b, destino):
    """recorta [a, b] (com respiro) e normaliza o volume: loudnorm em duas passadas -> PCM 16 bits mono"""
    tmp = destino.with_name(destino.stem + ".corte.wav")
    subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-i", str(bruto),
                    "-ss", f"{max(0.0, a - PAD_S):.3f}", "-to", f"{b + PAD_S:.3f}", "-ac", "1", "-c:a", "pcm_s16le",
                    str(tmp)], check=True)
    alvo = "I=-16:TP=-1.5:LRA=11"
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-i", str(tmp), "-af", f"loudnorm={alvo}:print_format=json",
                        "-f", "null", "-"], capture_output=True, text=True, errors="replace")
    filtro = f"loudnorm={alvo}"
    m = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", r.stderr)
    if m:
        d = json.loads(m.group(0))
        if d.get("input_i") not in (None, "-inf") and d.get("input_tp") != "-inf":
            filtro += (f":measured_I={d['input_i']}:measured_TP={d['input_tp']}:measured_LRA={d['input_lra']}"
                       f":measured_thresh={d['input_thresh']}:offset={d['target_offset']}:linear=true")
    saida = destino.with_name(destino.stem + ".novo.wav")
    subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-i", str(tmp), "-af", filtro,
                    "-ar", str(TAXA), "-ac", "1", "-c:a", "pcm_s16le", str(saida)], check=True)
    os.replace(saida, destino)
    tmp.unlink(missing_ok=True)
    return duracao(destino)


# ---------------------------------------------------------------- conferência (Whisper do Reco)

_NUMEROS = {"um": "1", "uma": "1", "dois": "2", "duas": "2", "tres": "3", "quatro": "4", "cinco": "5", "seis": "6",
            "dez": "10", "onze": "11", "dezesseis": "16"}


def _norm(t):
    t = unicodedata.normalize("NFKD", str(t).lower()).encode("ascii", "ignore").decode()
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    return " ".join(_NUMEROS.get(p, p) for p in t.split())


def semelhanca(fala, transcrito):
    return difflib.SequenceMatcher(None, _norm(fala), _norm(transcrito)).ratio()


class Conferidor:
    """processo `py -3.14 tools/conferir-trechos.py` aberto uma vez; textos(caminhos) -> [texto]"""

    def __init__(self):
        self.p = subprocess.Popen(["py", "-3.14", str(RAIZ / "tools" / "conferir-trechos.py")], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8",
                                  creationflags=0x00004000 if os.name == "nt" else 0)   # BELOW_NORMAL
        pronto = json.loads(self.p.stdout.readline() or "{}")
        if not pronto.get("pronto"):
            self.fechar()
            raise RuntimeError(pronto.get("erro") or "conferir-trechos.py não respondeu")

    def __call__(self, caminhos):
        """um texto por caminho, ou ConferenciaFalhou (processo morto, resposta curta, erro num trecho)"""
        try:
            self.p.stdin.write(json.dumps([str(c) for c in caminhos]) + "\n")
            self.p.stdin.flush()
            linha = self.p.stdout.readline()
        except OSError as e:
            raise ConferenciaFalhou(f"conferir-trechos.py caiu ({e})") from None
        if not linha:
            raise ConferenciaFalhou(f"conferir-trechos.py não respondeu (saída {self.p.poll()})")
        try:
            textos = json.loads(linha)
        except ValueError:
            raise ConferenciaFalhou(f"resposta ilegível: {linha[:120]!r}") from None
        return checar_textos(textos, caminhos)

    def fechar(self):
        try:
            self.p.stdin.close()
            self.p.wait(10)
        except Exception:
            self.p.kill()


def checar_textos(textos, caminhos):
    """a resposta da conferência tem de ter um texto por trecho e nenhum <erro ...>"""
    if not isinstance(textos, list) or len(textos) != len(caminhos):
        raise ConferenciaFalhou(f"{len(textos) if isinstance(textos, list) else '?'} texto(s) para {len(caminhos)} trecho(s)")
    ruins = [t for t in textos if not isinstance(t, str) or t.startswith("<erro")]
    if ruins:
        raise ConferenciaFalhou(f"erro ao transcrever: {ruins[:2]}")
    return textos


def julgar_lote(grupo, textos):
    """(deslocado, ruins): deslocado = motivo se algum trecho soa mais como OUTRA frase do lote (corte fora do
    lugar: o lote inteiro sai) ou como duas frases grudadas; ruins = {frase: nota} dos trechos que não soam
    como nenhuma frase do lote (refaz sozinha). Frases do mesmo molde diferem numa palavra ("gank provável no
    top" / "no mid": semelhança 0,82-0,85), então a nota sozinha não basta: tem de ganhar das vizinhas."""
    ruins = {}
    for f, t in zip(grupo, textos):
        notas = {g: semelhanca(g, t) for g in grupo}
        propria = notas[f]
        outra, nota_outra = max(((g, n) for g, n in notas.items() if g != f), key=lambda x: x[1], default=(None, 0.0))
        if outra is not None and nota_outra >= NOTA_MIN and nota_outra >= propria:
            return f"{f!r} soa como {outra!r} ({t!r}: {propria:.2f} contra {nota_outra:.2f})", {}
        if len(grupo) > 1 and propria >= NOTA_MIN and len(_norm(t)) > GRUDADO * len(_norm(f)) + 4:
            return f"{f!r} com texto a mais ({t!r}): frases grudadas", {}
        if propria < NOTA_MIN:
            ruins[f] = round(propria, 2)
    return None, ruins


# ---------------------------------------------------------------- Gemini TTS

def texto_falado(fala):
    """o que vai ao TTS: dois-pontos e "?" no MEIO da frase viram vírgula ("o mid saiu da rota: no rio top" ->
    "..., no rio top"). Pausa de dois-pontos/interrogação compete com a pausa entre frases e o lote cai em
    "pausas ambíguas" (gasta a cota dividindo ao meio). A chave do pacote continua a fala original."""
    t = re.sub(r"\s*[:?]\s+(?=\S)", ", ", fala.strip())
    return t if t[-1:] in ".?!" else t + "."


def prompt_do_lote(frases):
    """uma frase por parágrafo, terminada em pontuação (entonação de fim de frase); sem número nem instrução"""
    return "\n\n".join(texto_falado(f) for f in frases)


class Gemini:
    """sintetizar(frases, destino) -> modelo usado; grava o .wav bruto do lote. A cota grátis diária é por
    modelo: quando uma acaba, passa para o próximo (como a bancada); todas acabadas -> CotaEsgotada."""

    def __init__(self, voz_api):
        # chave do Doppler só dentro do processo; nunca impressa nem gravada (mesma leitura da bancada-vozes.py)
        r = subprocess.run(["doppler", "secrets", "get", "GEMINI_API_KEY", "--plain", "--project", "harness",
                            "--config", "dev"], capture_output=True, text=True)
        chave = r.stdout.strip()
        if r.returncode != 0 or not chave:
            raise RuntimeError("GEMINI_API_KEY não veio do Doppler (harness/dev)")
        from google import genai
        self.cli = genai.Client(api_key=chave)
        del chave
        nomes = [m.name.removeprefix("models/") for m in self.cli.models.list() if "tts" in m.name.lower()]
        if not nomes:
            raise RuntimeError("nenhum modelo de TTS listado")

        def versao(n):
            m = re.search(r"gemini-(\d+)\.(\d+)", n)
            return (int(m.group(1)), int(m.group(2))) if m else (0, 0)
        self.fila = sorted(nomes, key=lambda n: ("pro" in n, "lite" in n, tuple(-x for x in versao(n))))
        self.modelo = self.fila[0]
        self.voz_api = voz_api
        self.ultima, self.intervalo = 0.0, 7
        self.esgotados = []

    def __call__(self, frases, destino):
        from google.genai import types
        cfg = types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=self.voz_api))))
        prompt = prompt_do_lote(frases)
        for tentativa in range(1, 7):
            espera = self.intervalo - (time.time() - self.ultima)
            if espera > 0:
                time.sleep(espera)
            try:
                self.ultima = time.time()
                resp = self.cli.models.generate_content(model=self.modelo, contents=prompt, config=cfg)
                break
            except Exception as e:
                txt = str(e)
                if "429" not in txt and "RESOURCE_EXHAUSTED" not in txt:
                    raise RuntimeError(txt[:300]) from None
                cotas = sorted(set(re.findall(r"'quotaId': '([A-Za-z0-9_-]+)'", txt)))
                if any("PerDay" in c for c in cotas):
                    self.esgotados.append(self.modelo)
                    if self.modelo in self.fila[:-1]:
                        self.modelo = self.fila[self.fila.index(self.modelo) + 1]
                        log(f"[gemini] cota diária de {self.esgotados[-1]} acabou; seguindo com {self.modelo}")
                        continue
                    raise CotaEsgotada(f"cota diária esgotada em {', '.join(self.esgotados)}") from None
                if tentativa == 6:
                    raise CotaEsgotada(f"429 repetido (cota {', '.join(cotas) or '?'})") from None
                atraso = re.search(r"'retryDelay': '(\d+)s'", txt)
                seg = int(atraso.group(1)) + 2 if atraso else 60
                self.intervalo = min(30, self.intervalo + 5)
                log(f"[gemini] 429 (cota {', '.join(cotas) or '?'}); esperando {seg} s")
                time.sleep(seg)
        parte = resp.candidates[0].content.parts[0].inline_data
        m = re.search(r"rate=(\d+)", parte.mime_type or "")
        pcm = destino.with_suffix(".pcm")
        pcm.write_bytes(parte.data)
        subprocess.run(["ffmpeg", "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-f", "s16le", "-ar",
                        m.group(1) if m else str(TAXA), "-ac", "1", "-i", str(pcm), str(destino)], check=True)
        pcm.unlink(missing_ok=True)
        return self.modelo


# ---------------------------------------------------------------- índice e laço

def ler_indice(pasta):
    try:
        return json.loads((pasta / "indice.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def gravar_indice(pasta, indice):
    tmp = pasta / "indice.json.tmp"
    tmp.write_text(json.dumps(indice, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    os.replace(tmp, pasta / "indice.json")


def suspeitas(frases, indice):
    """falas do pacote marcadas `suspeita` (o Whisper ouviu outra coisa, mesmo refeita sozinha): o tocador
    pula (Maria ao vivo); só voltam à fila com --refazer-suspeitas (refazer toda rodada gastaria a cota)"""
    fs = indice.get("frases") or {}
    return [f for f in frases if (fs.get(f) or {}).get("suspeita")]


def pendentes(frases, pasta, indice, refazer_suspeitas=False):
    fs = indice.get("frases") or {}
    feitas = {f for f, v in fs.items() if (pasta / v.get("arquivo", "")).is_file()
              and not (refazer_suspeitas and v.get("suspeita"))}
    return [f for f in frases if f not in feitas]


def gerar(frases, pasta, sintetizar, lote=8, max_pedidos=None, conferir=None, aberto=jogo_aberto, meta=None,
          brutos=BRUTOS, refazer_suspeitas=False):
    """grava as frases que faltam em `pasta`. sintetizar(frases, destino_wav) -> modelo. Devolve o resumo
    {status: completo|falhas|cota|max_pedidos|jogo_aberto|conferidor, pedidos, geradas, recusados, faltam,
    falhas, suspeitas (desta rodada), suspeitas_total (no índice)}."""
    pasta.mkdir(parents=True, exist_ok=True)
    brutos.mkdir(parents=True, exist_ok=True)
    indice = ler_indice(pasta)
    indice.setdefault("frases", {})
    indice.setdefault("falhas", {})
    indice.update(meta or {})
    falta = pendentes(frases, pasta, indice, refazer_suspeitas)
    fila = [falta[i:i + lote] for i in range(0, len(falta), lote)]
    res = {"status": "completo", "pedidos": 0, "geradas": 0, "recusados": 0, "falhas": {}, "suspeitas": 0}
    refeitas = set()

    def recusar(grupo, motivo, modelo):
        res["recusados"] += 1
        log(f"lote de {len(grupo)} recusado: {motivo}")
        if len(grupo) > 1:
            meio = len(grupo) // 2
            fila[:0] = [grupo[:meio], grupo[meio:]]
        else:
            res["falhas"][grupo[0]] = motivo
            indice["falhas"][grupo[0]] = {"motivo": motivo, "em": time.strftime("%Y-%m-%d %H:%M"), "modelo": modelo}
            gravar_indice(pasta, indice)
    while fila:
        if max_pedidos is not None and res["pedidos"] >= max_pedidos:
            res["status"] = "max_pedidos"
            break
        if aberto():
            res["status"] = "jogo_aberto"
            log("League of Legends.exe abriu: parando limpo")
            break
        grupo = fila.pop(0)
        bruto = brutos / f"lote-{time.strftime('%Y%m%d-%H%M%S')}-{res['pedidos']:03d}.wav"
        try:
            modelo = sintetizar(grupo, bruto)
        except CotaEsgotada as e:
            fila.insert(0, grupo)
            res["status"] = "cota"
            log(f"parando: {e}")
            break
        res["pedidos"] += 1
        textos = None
        if conferir is None:      # sem Whisper: só o silêncio (caminho fraco, recusa muito lote)
            trechos, motivo = segmentar(*silencios(bruto), grupo)
        else:                     # com Whisper: o corte é guiado pela transcrição dos pedaços
            try:
                trechos, textos, motivo = cortar_por_transcricao(bruto, grupo, conferir)
            except ConferenciaFalhou as e:
                fila.insert(0, grupo)
                res["status"] = "conferidor"
                log(f"parando: conferência falhou ({e}); o lote não entrou (bruto em {bruto})")
                break
        if trechos is None:
            recusar(grupo, motivo, modelo)
            continue
        if textos is not None:
            deslocado, ruins = julgar_lote(grupo, textos)
            if deslocado:
                recusar(grupo, f"conferência: {deslocado}", modelo)
                continue
        novos = {}
        for f, (a, b) in zip(grupo, trechos):
            # arquivo novo em nome temporário: troca o .wav de antes só quando o lote inteiro deu certo
            arq = nome_arquivo(f)
            dur = extrair(bruto, a, b, pasta / ("_" + arq))
            novos[f] = {"arquivo": arq, "dur": round(dur, 2), "modelo": modelo, "lote": len(grupo),
                        "em": time.strftime("%Y-%m-%d %H:%M")}
        if textos is not None:
            for f, t in zip(grupo, textos):
                nota = round(semelhanca(f, t), 2)
                novos[f]["conferencia"] = {"texto": t, "nota": nota}
                if f in ruins:
                    if len(grupo) > 1 and f not in refeitas:
                        refeitas.add(f)
                        (pasta / ("_" + novos.pop(f)["arquivo"])).unlink(missing_ok=True)
                        fila.insert(0, [f])
                        log(f"conferência: {f!r} ouvido como {t!r} ({nota}); refazendo sozinha")
                    else:
                        novos[f]["suspeita"] = True
                        res["suspeitas"] += 1
                        log(f"conferência: {f!r} ouvido como {t!r} ({nota}); fica marcada suspeita (Maria ao vivo)")
        for f in novos:
            os.replace(pasta / ("_" + novos[f]["arquivo"]), pasta / novos[f]["arquivo"])
            indice["falhas"].pop(f, None)
        indice["frases"].update(novos)
        indice["atualizado_em"] = time.strftime("%Y-%m-%d %H:%M:%S")
        indice["modelo"] = modelo
        gravar_indice(pasta, indice)
        res["geradas"] += len(novos)
        bruto.unlink(missing_ok=True)   # lote aceito: o bruto não serve mais (recusado fica para inspeção)
        log(f"lote de {len(grupo)}: {len(novos)} trecho(s) aceito(s); faltam {len(pendentes(frases, pasta, indice))}")
    res["faltam"] = len(pendentes(frases, pasta, indice))
    res["suspeitas_total"] = len(suspeitas(frases, indice))
    if res["faltam"] and res["status"] == "completo":
        res["status"] = "falhas"
    return res


def tom_em_uso():
    """o tom da config do coletor (dados/config.json tomVoz): ele é gravado primeiro"""
    try:
        t = json.loads((RAIZ / "dados" / "config.json").read_text(encoding="utf-8")).get("tomVoz")
    except (OSError, ValueError):
        t = None
    return t if t in avisos.TONS else "serio"


def ordem_de_geracao(textos, tons):
    """o catálogo na ordem em que vale gravar se a cota acabar no meio: o tom em uso primeiro e, dentro do
    tom, um rodízio entre os moldes (uma fala de cada molde por volta, os de maior prioridade primeiro). O
    rodízio põe moldes diferentes no mesmo lote: frases vizinhas do mesmo molde diferem numa palavra e um
    corte deslocado passaria ("gank provável no mid" gravado no arquivo de "no top"; revisão 13/10)."""
    tons = sorted(tons, key=lambda t: t != tom_em_uso())
    prio = lambda m: avisos.TIPOS.get(m, avisos.TIPO_REGRA)["prio"]  # noqa: E731
    out, vistos = [], set()
    for tom in tons:
        grupos = avisos.catalogo(textos, tons=(tom,), por_molde=True)
        filas = [list(grupos[m]) for m in sorted(grupos, key=lambda m: (-prio(m), m)) if grupos[m]]
        while filas:
            for fs in filas:
                f = fs.pop(0)
                if f not in vistos:
                    vistos.add(f)
                    out.append(f)
            filas = [fs for fs in filas if fs]
    return out


def tamanho_pasta(pasta):
    return sum(p.stat().st_size for p in pasta.glob("*.wav"))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="gera o pacote de voz pré-gravada do coach")
    ap.add_argument("--voz", required=True, help="id do pacote (aoede = voz Aoede do Gemini)")
    ap.add_argument("--tom", choices=("serio", "descontraido", "ambos"), default="ambos")
    ap.add_argument("--lote", type=int, default=8, help="frases por pedido (padrão 8)")
    ap.add_argument("--max-pedidos", type=int, default=None)
    ap.add_argument("--seco", action="store_true", help="só conta e mostra os lotes; sem chave nem rede")
    ap.add_argument("--sem-conferir", action="store_true", help="não transcreve os trechos pelo Whisper")
    ap.add_argument("--refazer-suspeitas", action="store_true",
                    help="pede de novo as falas marcadas suspeita (padrão: ficam na Maria, sem gastar cota)")
    a = ap.parse_args()

    tons = avisos.TONS if a.tom == "ambos" else (a.tom,)
    textos, fonte = avisos.carregar_textos()
    frases = ordem_de_geracao(textos, tons)
    assert sorted(frases) == avisos.catalogo(textos, tons=tons)
    versao = avisos.versao_catalogo(avisos.catalogo(textos))
    pasta = PACOTES / a.voz
    indice = ler_indice(pasta)
    falta = pendentes(frases, pasta, indice, a.refazer_suspeitas)
    fora = avisos.moldes_fora_do_catalogo(textos)
    susp = suspeitas(frases, indice)
    log(f"catálogo {versao} ({fonte}): {len(frases)} falas no(s) tom(ns) {', '.join(tons)}; no pacote "
        f"{len(frases) - len(falta)}; faltam {len(falta)} (~{-(-len(falta) // max(1, a.lote))} pedido(s) de {a.lote})"
        + (f"; {len(susp)} suspeita(s) na Maria (--refazer-suspeitas)" if susp else ""))
    if fora:
        log(f"moldes fora do catálogo (Maria ao vivo): {fora}")
    if a.seco:
        for i in range(0, min(len(falta), 3 * a.lote), a.lote):
            print(" | ".join(falta[i:i + a.lote]))
        return 0
    if not falta:
        return 0
    if jogo_aberto():
        log("League of Legends.exe aberto: o gerador só roda com o jogo fechado")
        return 3
    if a.voz not in VOZES_GEMINI:
        log(f"voz {a.voz!r} desconhecida (vozes: {', '.join(VOZES_GEMINI)})")
        return 1
    try:   # prioridade baixa: o processador é de quem estiver usando a máquina
        import psutil
        psutil.Process().nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
    except Exception:
        pass
    conferir = None
    if not a.sem_conferir:
        try:
            conferir = Conferidor()
        except Exception as e:
            log(f"conferência pelo Whisper indisponível ({e}); seguindo sem conferir")
    t0 = time.time()
    try:
        tts = Gemini(VOZES_GEMINI[a.voz])
        meta = {"voz": a.voz, "voz_api": tts.voz_api, "motor": "gemini-tts", "versao_catalogo": versao,
                "total_catalogo": len(frases), "tons": list(tons), "conferido": conferir is not None}
        res = gerar(frases, pasta, tts, lote=max(1, a.lote), max_pedidos=a.max_pedidos, conferir=conferir, meta=meta,
                    refazer_suspeitas=a.refazer_suspeitas)
    finally:
        if conferir is not None:
            conferir.fechar()
    log(f"fim ({res['status']}): {res['pedidos']} pedido(s), {res['geradas']} fala(s) gravada(s), "
        f"{res['recusados']} lote(s) recusado(s), {res['suspeitas']} suspeita(s) nova(s) "
        f"({res['suspeitas_total']} no pacote, tocam na Maria), faltam {res['faltam']}; "
        f"{time.time() - t0:.0f} s; pacote {tamanho_pasta(pasta) / 1e6:.1f} MB em {pasta}")
    if res["falhas"]:
        log(f"fora do pacote por duração absurda: {res['falhas']}")
    if res["status"] == "cota":
        log(f"cota do Gemini acabou: faltam {res['faltam']} falas; rodar de novo depois das 04:00 (meia-noite do "
            f"Pacífico, quando a cota grátis renova); retoma de onde parou")
    return {"completo": 0, "falhas": 0, "cota": 2, "max_pedidos": 2, "jogo_aberto": 3}.get(res["status"], 1)


if __name__ == "__main__":
    sys.exit(main())
