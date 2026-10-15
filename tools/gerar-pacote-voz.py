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
marca `suspeita` (o tocador pula: Maria ao vivo; a fase (b) refaz no alvo, 1 vez por dia, e `--refazer-suspeitas`
pede de novo já na fase (a) com a fila inteira). Conferência que falha
(processo morto, resposta curta) para a rodada sem gravar o lote (saída 1). Com `--sem-conferir` sobra o
corte só pelo silêncio (`segmentar`: n-1 maiores pausas, claramente maiores que as de dentro), que recusa
muito lote. Frase sozinha com duração absurda fica fora do pacote, em `falhas` no índice (cai na Maria).
Dois-pontos e "?" no meio da frase vão ao TTS como vírgula (`texto_falado`; a pausa de vírgula continua).

Recusa rodar com `League of Legends.exe` aberto e para limpo se ele abrir no meio (o processador e a rede
são do jogo). No 429 diário de todos os modelos, para limpo e diz quantas faltam (retomar no dia seguinte).

**Convergência para um modelo só** (passo 6b, pedido do Gabriel em 13/10/2026: "vamos misturando mas baixando o
modelo completo ao longo dos dias"): o `modelo_alvo` (1º da fila na 1ª rodada; fixo no índice depois;
`--modelo-alvo` troca) abre a fila. Cada rodada: (a) as falas que faltam, com a fila inteira; (b) só se (a)
esvaziou a fila, refaz no alvo as falas de outro modelo, SÓ com o alvo (o 429 diário dele para a rodada). A fala
refeita ganha arquivo novo (`<hash>-<n>.wav`) e só troca no índice depois de passar na mesma conferência; o arquivo
antigo é apagado depois do índice. Recusada, a antiga fica (e ganha `tentativas_alvo`; no máximo 1 tentativa por
dia, e com MAX_TENTATIVAS_ALVO sai da convergência: "presa"; trocar o alvo zera). Fala com duração absurda
(`falhas`) também volta só 1 vez por dia. Suspeitas (do gerador ou da auditoria, `tools/auditar-pacote-voz.py`) entram
na convergência primeiro, de qualquer modelo, com a mesma regra de recusa e presa (passo 6c). O Whisper só
sobe no 1º áudio; as esperas da API olham o `--parar-se`. `progresso_alvo` no índice.
Quem roda isso todo dia: `tools/voz-agendada.py` (tarefa `lol-client-voz`).
Saída do processo: 0 nada mais a fazer hoje, 2 parou antes do fim (cota, --max-pedidos ou a API caiu 4 vezes
seguidas: a próxima rodada retoma), 3 jogo aberto (ou --parar-se),
4 outro gerador rodando no mesmo pacote, 1 erro. A última linha `RESUMO {json}` é para o agendador.
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
MAX_TENTATIVAS_ALVO = 3           # recusas no alvo (no máximo 1 por dia) até a fala sair da convergência ("presa")
_replace = os.replace             # trocável no teste (indice.json aberto por outro processo)


def _hoje():
    return time.strftime("%Y-%m-%d")


class Parado(RuntimeError):
    """pediram parada (jogo abriu, client saiu do lobby) durante uma espera da API: parar limpo, sem gravar"""


class CotaEsgotada(RuntimeError):
    """429 diário em todos os modelos de TTS: parar limpo e retomar no dia seguinte"""


class ConferenciaFalhou(RuntimeError):
    """o processo do Whisper morreu ou respondeu torto: nada do lote entra sem conferência"""


class RedeFalhou(RuntimeError):
    """a API caiu repetidas vezes (desconexão, timeout, 5xx): parar limpo e retomar na próxima rodada"""


ESPERAS_REDE = (10, 30, 90)       # segundos entre as tentativas depois de uma falha passageira
_PASSAGEIROS = {"ServerError", "RemoteProtocolError", "ConnectError", "ConnectTimeout", "ReadTimeout", "ReadError",
                "WriteError", "WriteTimeout", "PoolTimeout", "TimeoutException", "ConnectionError", "TimeoutError",
                "ConnectionResetError", "ConnectionAbortedError"}


def passageiro(e):
    """falha que vale tentar de novo: rede (httpx/socket) ou 5xx da API; 4xx (pedido ruim, chave) não"""
    return (type(e).__name__ in _PASSAGEIROS or re.search(
        r"\b(500|502|503|504)\b|UNAVAILABLE|INTERNAL|DEADLINE_EXCEEDED|disconnected|timed out", str(e)) is not None)


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


def nome_novo(fala, pasta, indice):
    """arquivo de uma gravação nova da fala: `<hash>.wav` se livre, senão `<hash>-<n>.wav`. Nunca o arquivo
    atual da fala nem um que já exista: regravar não sobrescreve o .wav que o tocador pode estar tocando"""
    base = nome_arquivo(fala)[:-4]
    atual = ((indice.get("frases") or {}).get(fala) or {}).get("arquivo")
    nome, n = base + ".wav", 1
    while nome == atual or (pasta / nome).exists() or (pasta / ("_" + nome)).exists():
        n += 1
        nome = f"{base}-{n}.wav"
    return nome


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


class ConferidorSobDemanda:
    """o Conferidor (Whisper) só sobe no 1º áudio a conferir: rodada que leva 429 no 1º pedido (cota morta, ~9
    rodadas agendadas por dia) não carrega o modelo à toa (revisão 13/10, item 9). Se não sobe:
    ConferenciaFalhou (a rodada para sem gravar; o corte só pelo silêncio gastaria a cota recusando lote)."""

    def __init__(self, fabrica=None):
        self.fabrica, self.c = fabrica or Conferidor, None

    def __call__(self, caminhos):
        if self.c is None:
            try:
                self.c = self.fabrica()
            except Exception as e:
                raise ConferenciaFalhou(f"Whisper indisponível ({e})") from None
            log("conferência pelo Whisper pronta")
        return self.c(caminhos)

    def fechar(self):
        if self.c is not None:
            self.c.fechar()


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

    def __init__(self, voz_api, deve_parar=None):
        self.deve_parar = deve_parar      # () -> bool: olhado a cada segundo das esperas (429 por minuto, rede)
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

    def priorizar(self, alvo):
        """fase das que faltam: o alvo abre a fila, os outros seguem na ordem; False se a API não lista o alvo"""
        if alvo not in self.fila:
            return False
        self.fila = [alvo] + [m for m in self.fila if m != alvo]
        self.modelo = next((m for m in self.fila if m not in self.esgotados), self.fila[-1])
        return True

    def so(self, alvo):
        """convergência: só o alvo (o 429 diário dele vira CotaEsgotada, nunca passa para outro modelo);
        False se a cota dele já acabou nesta rodada ou a API não o lista (nenhum pedido é feito)"""
        if alvo in self.esgotados or alvo not in self.fila:
            return False
        self.fila, self.modelo = [alvo], alvo
        return True

    def _dormir(self, seg):
        """sono em fatias de 1 s olhando deve_parar: a espera de 60 s do 429 ou de 90 s da rede não segura o
        gerador com o jogo abrindo (revisão 13/10, item 2) -> Parado"""
        fim = time.monotonic() + seg
        while True:
            parar = getattr(self, "deve_parar", None)
            if parar is not None and parar():
                raise Parado("parada pedida durante a espera da API")
            resta = fim - time.monotonic()
            if resta <= 0:
                return
            time.sleep(min(1.0, resta))

    def _pedir(self, prompt, cfg, dormir=None):
        """generate_content com a fila de modelos: 429 diário passa para o próximo (todos acabados ->
        CotaEsgotada); 429 por minuto espera e tenta de novo (6 vezes); falha passageira de rede ou 5xx
        ("Server disconnected without sending a response", 13/10/2026 na 1ª rodada agendada) espera
        ESPERAS_REDE e tenta de novo, depois RedeFalhou (a rodada para limpo, a próxima retoma). Outro erro sobe.
        As esperas olham deve_parar (Parado)."""
        dormir = dormir or self._dormir
        n429, nrede = 0, 0
        while True:
            espera = self.intervalo - (time.time() - self.ultima)
            if espera > 0:
                dormir(espera)
            try:
                self.ultima = time.time()
                return self.cli.models.generate_content(model=self.modelo, contents=prompt, config=cfg)
            except Exception as e:
                txt = str(e)
                if "429" in txt or "RESOURCE_EXHAUSTED" in txt:
                    cotas = sorted(set(re.findall(r"'quotaId': '([A-Za-z0-9_-]+)'", txt)))
                    if any("PerDay" in c for c in cotas):
                        self.esgotados.append(self.modelo)
                        if self.modelo in self.fila[:-1]:
                            self.modelo = self.fila[self.fila.index(self.modelo) + 1]
                            log(f"[gemini] cota diária de {self.esgotados[-1]} acabou; seguindo com {self.modelo}")
                            continue
                        raise CotaEsgotada(f"cota diária esgotada em {', '.join(self.esgotados)}") from None
                    n429 += 1
                    if n429 >= 6:
                        raise CotaEsgotada(f"429 repetido (cota {', '.join(cotas) or '?'})") from None
                    atraso = re.search(r"'retryDelay': '(\d+)s'", txt)
                    seg = int(atraso.group(1)) + 2 if atraso else 60
                    self.intervalo = min(30, self.intervalo + 5)
                    log(f"[gemini] 429 (cota {', '.join(cotas) or '?'}); esperando {seg} s")
                    dormir(seg)
                    continue
                if passageiro(e):
                    nrede += 1
                    if nrede > len(ESPERAS_REDE):
                        raise RedeFalhou(f"{type(e).__name__}: {txt[:200]}") from None
                    log(f"[gemini] falha passageira ({type(e).__name__}: {txt[:120]}); de novo em "
                        f"{ESPERAS_REDE[nrede - 1]} s")
                    dormir(ESPERAS_REDE[nrede - 1])
                    continue
                raise RuntimeError(txt[:300]) from None

    def __call__(self, frases, destino):
        from google.genai import types
        cfg = types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=self.voz_api))))
        resp = self._pedir(prompt_do_lote(frases), cfg)
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


def substituir(origem, destino, tentativas=6, pausa=0.15):
    """os.replace que tenta de novo no PermissionError: no Windows o open() do Python não compartilha a exclusão,
    então o coletor relendo o índice, o `estado` ou o antivírus seguram o MoveFileEx por um instante (revisão
    13/10, item 3: sem isso a rodada morria com os .wav novos fora do índice e o pedido gasto à toa)"""
    for i in range(tentativas):
        try:
            return _replace(origem, destino)
        except PermissionError:
            if i == tentativas - 1:
                raise
            time.sleep(pausa * (i + 1))


def gravar_indice(pasta, indice):
    tmp = pasta / "indice.json.tmp"
    tmp.write_text(json.dumps(indice, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    substituir(tmp, pasta / "indice.json")


def suspeitas(frases, indice):
    """falas do pacote marcadas `suspeita` (o Whisper ouviu outra coisa, mesmo refeita sozinha): o tocador
    pula (Maria ao vivo); a fase (b) as refaz no alvo, 1 tentativa por dia (para_convergir; passo 6c)"""
    fs = indice.get("frases") or {}
    return [f for f in frases if (fs.get(f) or {}).get("suspeita")]


def _tem_arquivo(pasta, v):
    return bool(isinstance(v, dict) and v.get("arquivo")) and (pasta / v["arquivo"]).is_file()


def pendentes(frases, pasta, indice, refazer_suspeitas=False, hoje=None):
    """falas sem arquivo no pacote. Com `hoje` (a fila de pedidos de uma rodada): a fala em `falhas` (duração
    absurda) tentada hoje fica para amanhã, senão gastaria 1 pedido a cada 2 h para sempre (revisão 13/10,
    item 5). Sem `hoje` (o critério de "faltam"): ela conta, e a tarefa não desliga com fala faltando."""
    fs = indice.get("frases") or {}
    feitas = {f for f, v in fs.items() if _tem_arquivo(pasta, v) and not (refazer_suspeitas and v.get("suspeita"))}
    falhas = indice.get("falhas") or {}
    hoje_falhou = {f for f, v in falhas.items() if hoje and isinstance(v, dict) and (v.get("em") or "")[:10] == hoje}
    return [f for f in frases if f not in feitas and f not in hoje_falhou]


def tentativas_no_alvo(v, alvo):
    """recusas da fala no alvo ATUAL: trocar o alvo zera as do antigo (revisão 13/10, item 6)"""
    return v.get("tentativas_alvo", 0) if v.get("alvo_tentado", alvo) == alvo else 0


MODELOS_PRIMEIRO = ("gemini-3.1-flash-tts-preview",)   # timbre mais distante do alvo, ouvido pelo Gabriel


def para_convergir(frases, pasta, indice, alvo, max_tentativas=MAX_TENTATIVAS_ALVO, hoje=None):
    """falas da fase (b), só com o alvo: as `suspeita` (de qualquer modelo, inclusive o alvo; PRIMEIRO na fila: tocam
    na Maria até serem refeitas; passo 6c, 15/10/2026) e as gravadas por outro modelo que não o alvo. Fora: as presas
    (recusadas no alvo max_tentativas vezes). Com `hoje` (a fila da rodada): a recusada no alvo hoje fica para amanhã,
    então 3 recusas = 3 dias, não um dia ruim (revisão 13/10, item 4); sem `hoje` (o critério de concluir) ela conta."""
    if not alvo:
        return []
    fs = indice.get("frases") or {}
    ok = [f for f in frases if _tem_arquivo(pasta, fs.get(f)) and (fs[f].get("suspeita") or fs[f].get("modelo") != alvo)
          and tentativas_no_alvo(fs[f], alvo) < max_tentativas
          and not (hoje and fs[f].get("alvo_tentado", alvo) == alvo and (fs[f].get("tentado_em") or "")[:10] == hoje)]
    # depois das suspeitas, os modelos que mais destoam do alvo (Gabriel, 15/10/2026: "o mid chegando no top", do 3.1
    # preview, "ficou muito diferente das outras [...] a tonalidade"); dentro de cada grupo, a ordem da fila de antes
    def grupo(f):
        return 0 if fs[f].get("suspeita") else 1 if fs[f].get("modelo") in MODELOS_PRIMEIRO else 2
    return sorted(ok, key=grupo)


def progresso(frases, pasta, indice, alvo):
    """meta do agendador e do estado: falas no alvo / total do catálogo. concluido = nada falta e nada para refazer
    no alvo (fora do alvo ou suspeita refazível: desde o passo 6c a suspeita é refeita na fase b). Presas
    (MAX_TENTATIVAS_ALVO recusas no alvo, em dias diferentes; suspeita presa segue na Maria) ficam fora do critério
    e saem contadas, junto das suspeitas, para o log e o estado não dizerem "100%"."""
    fs = indice.get("frases") or {}
    com = [f for f in frases if _tem_arquivo(pasta, fs.get(f))]
    boas = [f for f in com if not fs[f].get("suspeita")]
    no_alvo = sum(1 for f in boas if alvo and fs[f].get("modelo") == alvo)
    presas = sum(1 for f in com if alvo and (fs[f].get("modelo") != alvo or fs[f].get("suspeita"))
                 and tentativas_no_alvo(fs[f], alvo) >= MAX_TENTATIVAS_ALVO)
    falta = len(pendentes(frases, pasta, indice))
    fora = len(para_convergir(frases, pasta, indice, alvo))
    return {"modelo_alvo": alvo, "total": len(frases), "no_pacote": len(com), "no_alvo": no_alvo,
            "faltam": falta, "fora_do_alvo": fora, "presas": presas, "suspeitas": len(com) - len(boas),
            "concluido": bool(alvo) and falta == 0 and fora == 0, "em": time.strftime("%Y-%m-%d %H:%M:%S")}


def atualizar_progresso(pasta, frases, alvo):
    """grava modelo_alvo e progresso_alvo no índice (atômico) e devolve o progresso"""
    pasta.mkdir(parents=True, exist_ok=True)
    indice = ler_indice(pasta)
    indice.setdefault("frases", {})
    if alvo:
        indice["modelo_alvo"] = alvo
    prog = progresso(frases, pasta, indice, alvo)
    indice["progresso_alvo"] = prog
    gravar_indice(pasta, indice)
    return prog


def escolher_alvo(indice, fila, forcado=None):
    """(alvo, origem): --modelo-alvo vence; senão o do índice (fixo depois da 1ª rodada, mesmo que a lista da
    API mude); senão o 1º da fila (o melhor: não-pro, não-lite, mais novo)"""
    if forcado:
        return forcado, "--modelo-alvo"
    if indice.get("modelo_alvo"):
        return indice["modelo_alvo"], "índice"
    return (fila[0] if fila else None), "1º da fila"


def limpar_orfaos(pasta, idade_s=600):
    """apaga .wav da pasta que o índice não cita (antigo que não saiu porque estava aberto, temporário de rodada
    morta), com mais de idade_s (nunca o de uma rodada em curso). Lê o índice na hora: chamar só com a trava
    (um índice lido antes dela apagaria o que outro gerador acabou de gravar; revisão 13/10, item 8)."""
    usados = {v.get("arquivo") for v in (ler_indice(pasta).get("frases") or {}).values() if isinstance(v, dict)}
    n, agora = 0, time.time()
    for p in pasta.glob("*.wav"):
        try:
            if p.name not in usados and agora - p.stat().st_mtime > idade_s:
                p.unlink()
                n += 1
        except OSError:
            pass
    return n


def gerar(frases, pasta, sintetizar, lote=8, max_pedidos=None, conferir=None, aberto=jogo_aberto, meta=None,
          brutos=BRUTOS, refazer_suspeitas=False, alvo=None, hoje=None):
    """grava as frases que faltam em `pasta`. sintetizar(frases, destino_wav) -> modelo. Com `alvo`: fase de
    convergência, refaz as falas de outro modelo (para_convergir); só aceita áudio do alvo e, recusada a
    gravação nova, a antiga fica (tentativas_alvo + 1, no máximo 1 por dia), nunca vira falha nem suspeita.
    `hoje` (AAAA-MM-DD, padrão a data local): falha e recusa tentadas nesse dia ficam fora da fila. Devolve o
    resumo {status: completo|falhas|cota|max_pedidos|jogo_aberto|conferidor|rede, pedidos, geradas, recusados,
    faltam, falhas, suspeitas (desta rodada), suspeitas_total (no índice), mantidas (convergência recusada),
    fora_do_alvo}."""
    convergir = alvo is not None
    hoje = hoje or _hoje()
    pasta.mkdir(parents=True, exist_ok=True)
    brutos.mkdir(parents=True, exist_ok=True)
    indice = ler_indice(pasta)
    indice.setdefault("frases", {})
    indice.setdefault("falhas", {})
    indice.update(meta or {})
    if convergir:
        falta = para_convergir(frases, pasta, indice, alvo, hoje=hoje)
    else:
        falta = pendentes(frases, pasta, indice, refazer_suspeitas, hoje=hoje)
    fila = [falta[i:i + lote] for i in range(0, len(falta), lote)]
    res = {"status": "completo", "pedidos": 0, "geradas": 0, "recusados": 0, "falhas": {}, "suspeitas": 0,
           "mantidas": 0}
    refeitas = set()

    def manter(f, motivo):
        """convergência: a gravação nova não serviu; a antiga fica intacta no índice e no disco"""
        v = indice["frases"][f]
        v["tentativas_alvo"] = tentativas_no_alvo(v, alvo) + 1
        v["alvo_tentado"], v["tentado_em"] = alvo, time.strftime("%Y-%m-%d %H:%M")
        res["mantidas"] += 1
        gravar_indice(pasta, indice)
        log(f"convergência: {f!r} mantém a gravação de {v.get('modelo')} ({motivo}; recusa "
            f"{v['tentativas_alvo']} de {MAX_TENTATIVAS_ALVO})")

    def recusar(grupo, motivo, modelo):
        res["recusados"] += 1
        log(f"lote de {len(grupo)} recusado: {motivo}")
        if len(grupo) > 1:
            meio = len(grupo) // 2
            fila[:0] = [grupo[:meio], grupo[meio:]]
        elif convergir:
            manter(grupo[0], motivo)
        else:
            res["falhas"][grupo[0]] = motivo
            n = ((indice["falhas"].get(grupo[0]) or {}).get("tentativas") or 0) + 1
            indice["falhas"][grupo[0]] = {"motivo": motivo, "em": time.strftime("%Y-%m-%d %H:%M"), "modelo": modelo,
                                          "tentativas": n}
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
        except RedeFalhou as e:
            fila.insert(0, grupo)
            res["status"] = "rede"
            log(f"parando: a API caiu {len(ESPERAS_REDE) + 1} vezes seguidas ({e}); a próxima rodada retoma")
            break
        except Parado:
            fila.insert(0, grupo)
            res["status"] = "jogo_aberto"
            log("parando limpo: parada pedida durante a espera da API (jogo abriu ou o client saiu do lobby)")
            break
        res["pedidos"] += 1
        if convergir and modelo != alvo:   # nunca grava outro modelo na convergência (o sintetizador errou a fila)
            fila.insert(0, grupo)
            res["status"] = "cota"
            bruto.unlink(missing_ok=True)
            log(f"parando: a convergência pediu {alvo} e veio {modelo}; nada gravado")
            break
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
            # arquivo novo (nome livre: nunca o .wav atual da fala) em nome temporário; entra no índice só
            # quando o lote inteiro deu certo, e o antigo sai depois do índice
            arq = nome_novo(f, pasta, indice)
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
                    elif convergir:      # nunca troca uma fala boa por uma suspeita
                        (pasta / ("_" + novos.pop(f)["arquivo"])).unlink(missing_ok=True)
                        manter(f, f"ouvido como {t!r} ({nota})")
                    else:
                        novos[f]["suspeita"] = True
                        res["suspeitas"] += 1
                        log(f"conferência: {f!r} ouvido como {t!r} ({nota}); fica marcada suspeita (Maria ao vivo)")
        antigos = []
        for f in novos:
            substituir(pasta / ("_" + novos[f]["arquivo"]), pasta / novos[f]["arquivo"])
            velho = (indice["frases"].get(f) or {}).get("arquivo")
            if velho and velho != novos[f]["arquivo"]:
                antigos.append(velho)
            indice["falhas"].pop(f, None)
        indice["frases"].update(novos)
        indice["atualizado_em"] = time.strftime("%Y-%m-%d %H:%M:%S")
        indice["modelo"] = modelo
        gravar_indice(pasta, indice)
        for velho in antigos:   # só depois do índice: até aqui o tocador ainda achava o antigo
            try:
                (pasta / velho).unlink(missing_ok=True)
            except OSError as e:   # aberto por quem toca: a próxima rodada limpa (limpar_orfaos)
                log(f"{velho} não saiu agora ({e}); fica para a próxima rodada")
        res["geradas"] += len(novos)
        bruto.unlink(missing_ok=True)   # lote aceito: o bruto não serve mais (recusado fica para inspeção)
        if convergir:
            log(f"lote de {len(grupo)} no alvo: {len(novos)} trocada(s); fora do alvo "
                f"{len(para_convergir(frases, pasta, indice, alvo))}")
        else:
            log(f"lote de {len(grupo)}: {len(novos)} trecho(s) aceito(s); faltam {len(pendentes(frases, pasta, indice))}")
    res["faltam"] = len(pendentes(frases, pasta, indice))
    res["fora_do_alvo"] = len(para_convergir(frases, pasta, indice, alvo)) if convergir else None
    res["suspeitas_total"] = len(suspeitas(frases, indice))
    if not convergir and res["faltam"] and res["status"] == "completo":
        res["status"] = "falhas"
    return res


def rodada(frases, pasta, tts, alvo, lote=8, max_pedidos=None, conferir=None, aberto=jogo_aberto, meta=None,
           brutos=BRUTOS, refazer_suspeitas=False, hoje=None):
    """uma rodada do passo 6b: (a) as falas que faltam, fila inteira com o alvo primeiro; (b) se a fila de (a)
    esvaziou, a convergência, só com o alvo. `tts` = sintetizador com priorizar(alvo) e so(alvo) (o Gemini).
    Devolve {"status", "a": resumo de (a), "b": resumo de (b) ou None, "motivo_b": por que (b) não rodou}."""
    hoje = hoje or _hoje()
    alvo_ok = bool(alvo) and tts.priorizar(alvo)
    res_a = gerar(frases, pasta, tts, lote=lote, max_pedidos=max_pedidos, conferir=conferir, aberto=aberto,
                  meta=meta, brutos=brutos, refazer_suspeitas=refazer_suspeitas, hoje=hoje)
    out = {"status": res_a["status"], "a": res_a, "b": None, "motivo_b": None}
    if res_a["status"] not in ("completo", "falhas"):
        out["motivo_b"] = f"fase (a) parou ({res_a['status']})"
        return out
    if not alvo_ok:
        out["motivo_b"] = f"modelo-alvo {alvo!r} fora da lista da API"
        log(f"sem convergência: {out['motivo_b']}")
        return out
    if not para_convergir(frases, pasta, ler_indice(pasta), alvo, hoje=hoje):
        out["motivo_b"] = "nada fora do alvo para hoje"
        return out
    resto = None if max_pedidos is None else max_pedidos - res_a["pedidos"]
    if resto is not None and resto <= 0:
        out["status"], out["motivo_b"] = "max_pedidos", "--max-pedidos gasto na fase (a)"
        return out
    if not tts.so(alvo):
        out["status"], out["motivo_b"] = "cota", f"cota diária de {alvo} já acabou nesta rodada"
        log(f"convergência fica para amanhã: {out['motivo_b']}")
        return out
    log(f"convergência: refazendo no {alvo} as falas de outros modelos (só ele; a cota dele acabou = para)")
    res_b = gerar(frases, pasta, tts, lote=lote, max_pedidos=resto, conferir=conferir, aberto=aberto, meta=meta,
                  brutos=brutos, alvo=alvo, hoje=hoje)
    out["b"], out["status"] = res_b, res_b["status"]
    return out


def travar(pasta):
    """um gerador por pacote (o agendado e um manual não se atropelam no índice): trava de arquivo do Windows,
    que o sistema solta se o processo morrer. Devolve o arquivo aberto (segurar até o fim) ou None (ocupado)."""
    pasta.mkdir(parents=True, exist_ok=True)
    f = open(pasta / ".gerando", "a+")
    try:
        import msvcrt
        f.seek(0)
        msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
    except ImportError:
        pass
    except OSError:
        f.close()
        return None
    return f


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
                    help="pede de novo as falas marcadas suspeita já na fase (a), com a fila inteira (padrão: a fase b as "
                         "refaz só no alvo, 1 vez por dia)")
    ap.add_argument("--modelo-alvo", help="troca o modelo-alvo da convergência (padrão: o do índice; na 1ª rodada, "
                                          "o 1º da fila da API)")
    ap.add_argument("--parar-se", help="arquivo que, se existir, para a rodada limpo antes do próximo pedido "
                                       "(o agendador cria quando o client entra em fila)")
    a = ap.parse_args()

    tons = avisos.TONS if a.tom == "ambos" else (a.tom,)
    textos, fonte = avisos.carregar_textos()
    frases = ordem_de_geracao(textos, tons)
    assert sorted(frases) == avisos.catalogo(textos, tons=tons)
    todas = avisos.catalogo(textos)                 # os dois tons: o denominador do progresso
    versao = avisos.versao_catalogo(todas)
    pasta = PACOTES / a.voz
    indice = ler_indice(pasta)
    hoje = _hoje()
    falta = pendentes(frases, pasta, indice, a.refazer_suspeitas)
    falta_hoje = pendentes(frases, pasta, indice, a.refazer_suspeitas, hoje=hoje)
    fora = avisos.moldes_fora_do_catalogo(textos)
    susp = suspeitas(frases, indice)
    alvo_visto = a.modelo_alvo or indice.get("modelo_alvo")      # só para o log: vai ao índice depois de validado
    conv = para_convergir(frases, pasta, indice, alvo_visto, hoje=hoje)
    prog = progresso(todas, pasta, indice, alvo_visto)
    log(f"catálogo {versao} ({fonte}): {len(frases)} falas no(s) tom(ns) {', '.join(tons)}; no pacote "
        f"{len(frases) - len(falta)}; faltam {len(falta)} (~{-(-len(falta) // max(1, a.lote))} pedido(s) de {a.lote})"
        + (f", {len(falta) - len(falta_hoje)} já tentada(s) hoje (amanhã de novo)" if len(falta_hoje) < len(falta) else "")
        + (f"; {len(susp)} suspeita(s) na Maria (a convergência refaz no alvo primeiro)" if susp else ""))
    log(f"modelo-alvo {alvo_visto or '(definido na 1ª rodada com a API: o 1º da fila)'}: {prog['no_alvo']} de "
        f"{prog['total']} falas no alvo; {prog['fora_do_alvo']} a refazer nele ({len(conv)} hoje)"
        + (f"; {prog['presas']} presa(s)" if prog["presas"] else ""))
    if fora:
        log(f"moldes fora do catálogo (Maria ao vivo): {fora}")
    if a.seco:
        for i in range(0, min(len(falta), 3 * a.lote), a.lote):
            print(" | ".join(falta[i:i + a.lote]))
        return 0
    alvo_ok = None      # o alvo que pode ir ao índice: o do índice ou um validado contra a lista da API (revisão 1)

    def alvo_gravar():
        return alvo_ok or ler_indice(pasta).get("modelo_alvo")

    def resumo(status, out=None, t0=None):
        ra, rb = (out or {}).get("a") or {}, (out or {}).get("b") or {}
        d = {"status": status, "pedidos": ra.get("pedidos", 0) + rb.get("pedidos", 0),
             "geradas": ra.get("geradas", 0), "trocadas": rb.get("geradas", 0), "mantidas": rb.get("mantidas", 0),
             "recusados": ra.get("recusados", 0) + rb.get("recusados", 0), "motivo_b": (out or {}).get("motivo_b"),
             "segundos": round(time.time() - t0) if t0 else 0, "progresso": progresso(todas, pasta, ler_indice(pasta),
                                                                                       alvo_gravar())}
        print("RESUMO " + json.dumps(d, ensure_ascii=False), flush=True)

    if jogo_aberto():
        log("League of Legends.exe aberto: o gerador só roda com o jogo fechado")
        return 3
    if a.voz not in VOZES_GEMINI:
        log(f"voz {a.voz!r} desconhecida (vozes: {', '.join(VOZES_GEMINI)})")
        return 1
    trava = travar(pasta)
    if trava is None:
        log(f"outro gerador já está gravando em {pasta}: saindo sem fazer nada")
        return 4
    indice = ler_indice(pasta)         # relido com a trava: outro gerador pode ter acabado de gravar (revisão 8)
    if not falta_hoje and indice.get("modelo_alvo") and (not a.modelo_alvo or a.modelo_alvo == indice["modelo_alvo"]) \
            and not para_convergir(frases, pasta, indice, indice["modelo_alvo"], hoje=hoje):
        p = atualizar_progresso(pasta, todas, indice["modelo_alvo"])
        if p["concluido"]:
            log("nada a fazer: pacote completo e no modelo-alvo"
                + (f", fora {p['presas']} presa(s) no modelo antigo e {p['suspeitas']} suspeita(s) na Maria"
                   if p["presas"] or p["suspeitas"] else ""))
        else:
            log(f"nada a fazer hoje: o que falta ({p['faltam']}) ou está fora do alvo ({p['fora_do_alvo']}) já foi "
                f"tentado hoje; amanhã de novo")
        resumo("completo" if p["concluido"] else "nada_hoje")
        return 0
    try:   # prioridade baixa: o processador é de quem estiver usando a máquina
        import psutil
        psutil.Process().nice(psutil.BELOW_NORMAL_PRIORITY_CLASS)
    except Exception:
        pass
    n = limpar_orfaos(pasta)
    if n:
        log(f"{n} .wav órfão(s) apagado(s) (fora do índice: antigo de uma troca ou temporário de rodada morta)")
    parar = Path(a.parar_se) if a.parar_se else None

    def aberto():
        if parar is not None and parar.exists():
            log(f"{parar.name} apareceu (o client saiu do lobby): parando limpo")
            return True
        return jogo_aberto()
    conferir = None
    t0 = time.time()
    try:
        # o Gemini antes do Whisper (revisão 9): com a cota morta a rodada leva 429 sem carregar o modelo
        tts = Gemini(VOZES_GEMINI[a.voz], deve_parar=aberto)
        if a.modelo_alvo and a.modelo_alvo not in tts.fila:
            log(f"--modelo-alvo {a.modelo_alvo} não está na lista da API ({', '.join(tts.fila)}); nada mudou")
            return 1
        alvo, origem = escolher_alvo(indice, tts.fila, a.modelo_alvo)
        if indice.get("modelo_alvo") and alvo != indice["modelo_alvo"]:
            log(f"modelo-alvo trocado: {indice['modelo_alvo']} -> {alvo} ({origem}); recusas no antigo não contam")
        log(f"fila da API: {', '.join(tts.fila)}; modelo-alvo {alvo} ({origem})")
        alvo_ok = alvo
        atualizar_progresso(pasta, todas, alvo)       # fixa o alvo no índice já na 1ª rodada
        if not a.sem_conferir:
            conferir = ConferidorSobDemanda()
        meta = {"voz": a.voz, "voz_api": tts.voz_api, "motor": "gemini-tts", "versao_catalogo": versao,
                "total_catalogo": len(frases), "tons": list(tons), "conferido": conferir is not None,
                "modelo_alvo": alvo}
        out = rodada(frases, pasta, tts, alvo, lote=max(1, a.lote), max_pedidos=a.max_pedidos, conferir=conferir,
                     aberto=aberto, meta=meta, refazer_suspeitas=a.refazer_suspeitas, hoje=hoje)
    finally:
        if conferir is not None:
            conferir.fechar()
        if alvo_gravar():       # até num erro: o progresso do índice não fica para trás do que foi gravado
            try:
                atualizar_progresso(pasta, todas, alvo_gravar())
            except Exception as e:
                log(f"progresso não atualizou ({e})")
    prog = progresso(todas, pasta, ler_indice(pasta), alvo)
    res, rb = out["a"], out["b"]
    log(f"fim ({out['status']}): faltavam: {res['pedidos']} pedido(s), {res['geradas']} fala(s) gravada(s), "
        f"{res['recusados']} lote(s) recusado(s), {res['suspeitas']} suspeita(s) nova(s) "
        f"({res['suspeitas_total']} no pacote, tocam na Maria), faltam {res['faltam']}; "
        + (f"convergência: {rb['pedidos']} pedido(s), {rb['geradas']} trocada(s) para o alvo, {rb['mantidas']} "
           f"mantida(s) no modelo antigo; " if rb else f"convergência não rodou ({out['motivo_b']}); ")
        + f"{prog['no_alvo']} de {prog['total']} falas no {alvo}; {time.time() - t0:.0f} s; "
          f"pacote {tamanho_pasta(pasta) / 1e6:.1f} MB em {pasta}")
    if res["falhas"]:
        log(f"fora do pacote por duração absurda: {res['falhas']}")
    if out["status"] == "cota":
        log(f"cota do Gemini acabou: faltam {prog['faltam']} falas e {prog['fora_do_alvo']} fora do alvo; a tarefa "
            f"lol-client-voz roda de novo depois das 05:15 (a cota grátis renova à meia-noite do Pacífico)")
    resumo(out["status"], out, t0)
    del trava
    return {"completo": 0, "falhas": 0, "cota": 2, "max_pedidos": 2, "rede": 2, "jogo_aberto": 3}.get(out["status"], 1)


if __name__ == "__main__":
    sys.exit(main())
