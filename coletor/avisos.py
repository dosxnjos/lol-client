# motor de avisos ao vivo do coach (plano v2, passos 12 e 15c): prioridade, validade, anti-spam
# e quem consome (voz, painel da 2ª tela, moldura na tela do jogo). Gatilhos: GatilhosLive (Live
# Client, 1 s) e AlertasPosicao (detecções do minimapa). Contrato: docs/COLETOR.md § Avisos ao vivo.
# Tempo em tudo = gameTime em segundos (RelogioJogo extrapola entre as leituras da Live Client).
# Só stdlib; nada aqui lê memória do jogo nem toca no processo dele.
import math
import re
import sys
import threading
import time
from collections import Counter, deque
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analise  # noqa: E402  (regiões do mapa: dona é docs/INSIGHTS.md)

RAIZ = Path(__file__).resolve().parent.parent
TONS = ("serio", "descontraido")
CORES = {"vermelho": (235, 45, 45), "amarelo": (245, 200, 40), "azul": (60, 145, 255), "verde": (60, 200, 110)}

# tipo -> prio (maior fala antes), validade (s esperando a vez na voz/moldura), repetir (s em que a
# mesma chave é descartada), urgente (fura o intervalo de 20 s da voz), destinos (v voz, p painel,
# m moldura), cor e ícone (o painel desenha). Ajuste aqui, não espalhado pelo código.
# Opcionais, por TIPO e independentes da chave (calibração de 14/10/2026: a chave do mid_sumiu mudava a cada
# sumiço e o `repetir` nunca valia; 25 molduras numa partida): intervalo (s mínimos entre dois avisos aceitos do
# tipo com os mesmos destinos) e teto (avisos aceitos por partida; o motor é um por partida).
TIPOS = {
    "gank":              dict(prio=100, validade=6, repetir=60, urgente=True, destinos="vpm", cor="vermelho", icone="perigo"),
    "intruso_grupo":     dict(prio=95, validade=6, repetir=15, urgente=True, destinos="vpm", cor="vermelho", icone="perigo"),
    "intruso":           dict(prio=85, validade=6, repetir=15, urgente=False, destinos="vpm", cor="amarelo", icone="perigo"),
    "jungler_apareceu":  dict(prio=80, validade=5, repetir=20, urgente=False, destinos="vpm", cor="vermelho", icone="olho",
                              intervalo=20),
    "mid_indo":          dict(prio=70, validade=6, repetir=20, urgente=False, destinos="vpm", cor="amarelo", icone="seta",
                              intervalo=30),
    "mid_sumiu":         dict(prio=60, validade=8, repetir=30, urgente=False, destinos="vpm", cor="amarelo", icone="interrogacao",
                              intervalo=120, teto=4),
    "janela_objetivo":   dict(prio=55, validade=10, repetir=45, urgente=False, destinos="vp", cor="verde", icone="objetivo"),
    "objetivo_60s":      dict(prio=50, validade=20, repetir=120, urgente=False, destinos="vp", cor="azul", icone="relogio"),
    "mortes_cedo":       dict(prio=45, validade=30, repetir=900, urgente=False, destinos="vp", cor="amarelo", icone="caveira"),
    "adversario_voltou": dict(prio=40, validade=6, repetir=30, urgente=False, destinos="vpm", cor="azul", icone="olho"),
    "inimigo_fed":       dict(prio=35, validade=20, repetir=120, urgente=False, destinos="vp", cor="amarelo", icone="espada"),
    "ouro_guardado":     dict(prio=30, validade=20, repetir=120, urgente=False, destinos="vp", cor="amarelo", icone="moeda"),
    # retorno dos atalhos (o próprio Gabriel apertou a tecla), nunca vermelho (vermelho é perigo; foi o que
    # confundiu no treino de 13/10/2026). retorno=True: só preenche tempo ocioso (MotorAvisos._distribuir):
    # sai na hora sem alerta na moldura, nunca apaga nem passa na frente de alerta, não corta fala e não
    # conta no intervalo da voz. Cada evento sai com o destino dele (Aviso.destinos): F9 armado e "sem
    # inimigo" só na moldura; marcado e desfeito, voz + moldura.
    "feitico_marcado":   dict(prio=45, validade=3, repetir=1, urgente=False, retorno=True, destinos="vm", cor="verde", icone="relogio"),
    "overlay_f8":        dict(prio=45, validade=3, repetir=1, urgente=False, retorno=True, destinos="m", cor="azul", icone="olho"),
}
CORES_RETORNO = ("azul", "verde")   # cores permitidas no retorno de atalho (teste-alertas confere)
# regra do coach.py que chega pelo motor sem tipo próprio usa este molde
TIPO_REGRA = dict(prio=20, validade=15, repetir=180, urgente=False, destinos="vp", cor="azul", icone="dica")

# chave por tipo e por destino na configuração (plugin: pengu/blocos.js AVISOS, mesma lista). "tela" =
# painel + moldura. Tipo publicado fora desta lista conta como "regra". Formato: {"voz": [...], "tela": [...]}
DESTINOS_CONFIG = ("voz", "tela")
TIPOS_LIGAVEIS = tuple(TIPOS) + ("feitico_voltou", "pico_nivel", "pico_item", "regra")


def normalizar_desligados(v):
    """{'voz': set, 'tela': set} de tipos calados. Lista/conjunto (formato até 13/10/2026) = calado nos dois."""
    def tipos(x):
        return {t for t in x if isinstance(t, str)} if isinstance(x, (list, tuple, set, frozenset)) else set()
    if isinstance(v, dict):
        return {d: tipos(v.get(d)) for d in DESTINOS_CONFIG}
    return {d: tipos(v) for d in DESTINOS_CONFIG}

# textos padrão: tipo -> tom -> (fala, rótulo ≤ 3 palavras). A FALA é genérica (plano voz pré-gravada,
# passo 3): diz a rota ("o jungler", "o mid"), nunca o campeão, e nenhum número aberto (ouro, nível real),
# para o conjunto de falas ser finito e caber num pacote gravado (catalogo()). O RÓTULO (painel e moldura)
# pode ter o nome: texto na tela não precisa ser gravado. Placeholders da fala: {zona} ("no rio top"),
# {rota} (ROTA_FALA: "top", "jungler", "mid", "atirador", "suporte"; "inimigo" sem posição), {objetivo},
# {n}, {feitico} ("flash", minúsculo), {pico} (6/11/16). Só do rótulo: {campeao}, {zc} ("rio top"),
# {zt} ("rio"), {nivel}, {feitico_nome}, {ouro}. A versão editável mora no arquivo de lições (seção
# "Avisos ao vivo", formato em carregar_textos); fala com placeholder fora de VALORES sai do pacote
# (moldes_fora_do_catalogo) e cai na Maria ao vivo.
TEXTOS = {
    "gank": {"serio": ("gank provável {zona}", "gank {zc}"),
             "descontraido": ("olha o gank {zona}, sai daí", "gank {zc}")},
    "intruso_grupo": {"serio": ("{n} inimigos {zona}", "{n} inimigos {zt}"),
                      "descontraido": ("{n} vindo {zona}, recua", "{n} inimigos {zt}")},
    "intruso": {"serio": ("o {rota} chegando {zona}", "intruso {zc}"),
                "descontraido": ("visita: o {rota} {zona}", "visita {zc}")},
    "jungler_apareceu": {"serio": ("jungler {zona}", "jungler {zc}"),
                         "descontraido": ("achei o jungler: {zona}", "jungler {zc}")},
    "mid_indo": {"serio": ("o mid saiu da rota: {zona}", "mid indo {zt}"),
                 "descontraido": ("o mid largou a rota, tá {zona}", "mid indo {zt}")},
    "mid_sumiu": {"serio": ("mid sumiu", "mid sumiu"),
                  "descontraido": ("cadê o mid? sumiu", "mid sumiu")},
    "janela_objetivo": {"serio": ("{n} inimigos mortos: {objetivo}", "janela {objetivo}"),
                        "descontraido": ("{n} mortos, bora {objetivo}", "bora {objetivo}")},
    "objetivo_60s": {"serio": ("{objetivo} em um minuto", "{objetivo} 1 min"),
                     "descontraido": ("{objetivo} nasce em um minuto, se prepara", "{objetivo} 1 min")},
    "mortes_cedo": {"serio": ("duas mortes antes dos dez, joga seguro", "joga seguro"),
                    "descontraido": ("tu tá duas mortes antes dos dez, segura a onda", "segura a onda")},
    "adversario_voltou": {"serio": ("o {rota} voltou pra rota", "{campeao} voltou"),
                          "descontraido": ("o {rota} voltou, cuidado", "{campeao} voltou")},
    "inimigo_fed": {"serio": ("o {rota} tá forte, evita o um contra um", "evita 1x1"),
                    "descontraido": ("o {rota} tá fed, nada de um contra um", "evita 1x1")},
    "ouro_guardado": {"serio": ("ouro guardado, hora de voltar?", "hora de voltar"),
                      "descontraido": ("tá rico, volta e gasta", "hora de voltar")},
    # feitiço do inimigo que voltou (feiticos.Feiticos.voltaram): "flash do mid voltou"; o "talvez" (horário
    # incerto) fica só no painel (±), para não dobrar o pacote
    "feitico_voltou": {"serio": ("{feitico} do {rota} voltou", "{campeao} com {feitico_nome}"),
                       "descontraido": ("{feitico} do {rota} voltou, cuidado", "{campeao} com {feitico_nome}")},
    # picos de força (sugestoes.PicosDeForca): a fala diz o pico cruzado (6/11/16), o rótulo o nível real
    "pico_nivel": {"serio": ("o {rota} chegou no nível {pico}", "{campeao} nível {nivel}"),
                   "descontraido": ("o {rota} chegou no nível {pico}, respeita", "{campeao} nível {nivel}")},
    "pico_nivel_visto": {"serio": ("o {rota} já passou do nível {pico}", "{campeao} nível {nivel}"),
                         "descontraido": ("o {rota} já passou do nível {pico}, respeita", "{campeao} nível {nivel}")},
    "pico_item": {"serio": ("o {rota} fechou item", "{campeao} fechou item"),
                  "descontraido": ("o {rota} fechou item, ficou forte", "{campeao} fechou item")},
    # retorno do F9 (tipo feitico_marcado; molde por evento, ver aviso_atalho). {rota} = top, jungler,
    # mid, atirador, suporte (frase genérica, sem nome de campeão); {feitico} = "flash" (minúsculo)
    "feitico_marcado": {"serio": ("{feitico} do {rota} marcado", "{rota} sem {feitico}"),
                        "descontraido": ("anotado: {rota} sem {feitico}", "{rota} sem {feitico}")},
    "feitico_desfeito": {"serio": ("marcação desfeita", "marcação desfeita"),
                         "descontraido": ("beleza, desfiz a marcação", "marcação desfeita")},
    "feitico_armado": {"serio": ("flash: 1 a 5", "flash: 1-5"), "descontraido": ("flash: 1 a 5", "flash: 1-5")},
    "feitico_sem_inimigo": {"serio": ("sem inimigo nessa posição", "sem inimigo"),
                            "descontraido": ("ninguém nessa posição", "sem inimigo")},
    "feitico_sem_feitico": {"serio": ("{rota} sem feitiço para marcar", "sem feitiço"),
                            "descontraido": ("{rota} sem feitiço para marcar", "sem feitiço")},
    "overlay_f8": {"serio": ("overlay {estado}", "overlay {estado}"), "descontraido": ("overlay {estado}", "overlay {estado}")},
}
ARQUIVOS_TEXTOS = (RAIZ / "pengu" / "posjogo" / "licoes.md", RAIZ / "docs" / "LICOES.md")
_LINHA_TEXTO = re.compile(r"^\s*-\s*`?([a-z0-9_]+)`?\s*\|(.+)$")
_TOM = {"sério": "serio", "serio": "serio", "descontraído": "descontraido", "descontraido": "descontraido"}


def carregar_textos(caminhos=ARQUIVOS_TEXTOS):
    """(textos, fonte). Lê a seção "## Avisos ao vivo" do 1º arquivo que a tiver, linhas no formato
    `- tipo | sério: fala / rótulo | descontraído: fala / rótulo`; o que faltar fica com o padrão."""
    textos = {t: dict(v) for t, v in TEXTOS.items()}
    for c in caminhos:
        try:
            linhas = Path(c).read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        dentro, achou = False, 0
        for l in linhas:
            if l.startswith("#"):
                dentro = l.lstrip("#").strip().lower() == "avisos ao vivo"
                continue
            m = dentro and _LINHA_TEXTO.match(l)
            if not m:
                continue
            tipo = m.group(1)
            for parte in m.group(2).split("|"):
                tom, _, resto = parte.partition(":")
                tom = _TOM.get(tom.strip().lower())
                fala, _, rotulo = resto.partition(" / ")
                if tom and fala.strip():
                    textos.setdefault(tipo, {})[tom] = (fala.strip(), (rotulo or fala).strip())
                    achou += 1
        if achou:
            return textos, str(c)
    return textos, "padrão (coletor/avisos.py)"


class _Seguro(dict):
    def __missing__(self, k):
        return "?"


def _formatar(molde, dados):
    try:
        return molde.format_map(_Seguro(dados))
    except (ValueError, IndexError):
        return molde


def _curto(rotulo, n=3):
    return " ".join(rotulo.split()[:n])


def normalizar_fala(texto):
    """a mesma regra do voz.Voz.falar: espaços colapsados. Chave do pacote de voz e do catálogo."""
    return " ".join(str(texto).split())


# --------------------------------------------------------------------------------------------
# catálogo da voz pré-gravada (plano voz pré-gravada, passos 3 e 3b): todas as falas possíveis =
# molde de fala × tom × valores finitos de cada placeholder. O gerador de pacote (tools/gerar-pacote-voz.py)
# grava uma por uma; o voz.Voz toca o arquivo quando a fala está no pacote e cai na Maria quando não está.

# posição da Live Client -> como a rota sai na fala (dona desta tabela; feiticos.py e sugestoes.py importam)
ROTA_FALA = {"TOP": "top", "JUNGLE": "jungler", "MIDDLE": "mid", "BOTTOM": "atirador", "UTILITY": "suporte"}
ROTA_SEM_POSICAO = "inimigo"         # blind, ARAM, personalizada: a Live Client não dá a posição
ROTAS_FALA = tuple(ROTA_FALA.values()) + (ROTA_SEM_POSICAO,)
ROTAS_COM_POSICAO = tuple(ROTA_FALA.values())
ROTAS_DE_ROTA = ("top", "mid", "atirador", "suporte")   # quem "mora" numa rota (adversário que voltou)
# feitiços com cronômetro (feiticos.RECARGA_BASE, 1ª palavra minúscula; Golpear não tem cronômetro)
FEITICOS_FALA = ("flash", "teleporte", "incendiar", "barreira", "exaustão", "curar", "fantasma", "purificar")
OBJETIVOS_FALA = ("dragão", "ancião", "vastilarvas", "arauto", "barão")   # ao_vivo._OBJ_AVISOS + OBJETIVOS
PICOS = (6, 11, 16)                                                       # sugestoes.NIVEIS_PICO
N_INIMIGOS = (2, 3, 4, 5)   # intruso_grupo e janela_objetivo só disparam com 2+; o time inimigo tem 5
REGIOES = ("rota_top", "rota_meio", "rota_bot", "rio", "selva_aliada", "selva_inimiga", "base_aliada", "base_inimiga")


def rota_fala(posicao):
    """'MIDDLE' -> 'mid'; sem posição (ou desconhecida) -> 'inimigo'."""
    return ROTA_FALA.get(str(posicao or "").upper(), ROTA_SEM_POSICAO)


def zonas_fala(regioes=REGIOES):
    """as falas de {zona} que zona() pode devolver nessas regiões ("no top", "no rio bot"...)."""
    return tuple(sorted({_zona_textos(r, m)[2] for r in regioes for m in ("top", "bot")}))


def valores_catalogo():
    """molde de fala -> {placeholder: valores possíveis}. Molde fora daqui não é falado (só moldura)."""
    rotas = zonas_fala(("rota_top", "rota_meio", "rota_bot"))   # gank (coach_vivo) e intruso (centro da rota)
    return {
        "gank": {"zona": rotas},
        "intruso_grupo": {"zona": rotas, "n": N_INIMIGOS},
        "intruso": {"zona": rotas, "rota": ROTAS_FALA},
        "jungler_apareceu": {"zona": zonas_fala()},
        "mid_indo": {"zona": zonas_fala(tuple(r for r in REGIOES if r not in ("rota_meio", "base_inimiga")))},
        "mid_sumiu": {},
        "janela_objetivo": {"n": N_INIMIGOS, "objetivo": OBJETIVOS_FALA + ("torre",)},
        "objetivo_60s": {"objetivo": OBJETIVOS_FALA},
        "mortes_cedo": {},
        "adversario_voltou": {"rota": ROTAS_DE_ROTA},
        "inimigo_fed": {"rota": ROTAS_COM_POSICAO},
        "ouro_guardado": {},
        "feitico_marcado": {"rota": ROTAS_FALA, "feitico": FEITICOS_FALA},
        "feitico_desfeito": {},
        "feitico_voltou": {"rota": ROTAS_FALA, "feitico": FEITICOS_FALA},
        "pico_nivel": {"rota": ROTAS_COM_POSICAO, "pico": PICOS},
        "pico_nivel_visto": {"rota": ROTAS_COM_POSICAO, "pico": PICOS},
        "pico_item": {"rota": ROTAS_COM_POSICAO},
    }


# tipos cuja fala é texto livre (não entram no pacote, caem na Maria): regra do coach.py publicada ao vivo
# (hoje nenhuma: `uso` além de posjogo não está ligado ao motor)
LIVRES = ("regra",)
_CAMPO = re.compile(r"\{([a-z_]+)[^}]*\}")


def moldes_fora_do_catalogo(textos=None):
    """[(molde, tom, placeholder)] de falas faladas cujo placeholder não tem valores finitos (ex.: alguém pôs
    {campeao} na fala no docs/LICOES.md): essas falas não entram no pacote."""
    textos = carregar_textos()[0] if textos is None else textos
    valores = valores_catalogo()
    out = []
    for molde in valores:
        for tom in TONS:
            fala = (textos.get(molde) or {}).get(tom, (None,))[0]
            for campo in _CAMPO.findall(fala or ""):
                if campo not in valores[molde]:
                    out.append((molde, tom, campo))
    return out


def catalogo(textos=None, tons=TONS, por_molde=False):
    """todas as falas que a voz pode dizer (tipos com destino voz × tom × valores finitos), normalizadas
    e sem repetição, em ordem. textos=None lê como o motor lê (carregar_textos: docs/LICOES.md vence o
    padrão). por_molde=True -> {molde: [falas]} (para contar por tipo)."""
    import itertools
    textos = carregar_textos()[0] if textos is None else textos
    fora = {(m, t) for m, t, _ in moldes_fora_do_catalogo(textos)}
    grupos = {}
    for molde, campos in valores_catalogo().items():
        nomes = sorted(campos)
        falas = set()
        for tom in tons:
            fala = (textos.get(molde) or {}).get(tom, (None,))[0]
            if not fala or (molde, tom) in fora:
                continue
            for combo in itertools.product(*(campos[n] for n in nomes)):
                falas.add(normalizar_fala(_formatar(fala, dict(zip(nomes, combo)))))
        grupos[molde] = sorted(falas)
    if por_molde:
        return grupos
    return sorted({f for fs in grupos.values() for f in fs})


def versao_catalogo(frases=None):
    """impressão digital do catálogo (12 hex): muda quando qualquer fala muda."""
    import hashlib
    frases = catalogo() if frases is None else frases
    return hashlib.sha1("\n".join(sorted(frases)).encode("utf-8")).hexdigest()[:12]


@dataclass
class Aviso:
    """O que um gatilho publica. `textos` (opcional) = {tom: (fala, rótulo)} já prontos (regra do
    coach.py); sem ele o motor usa TEXTOS[tipo] com `dados`. prio/cor/urgente sobrepõem TIPOS."""
    tipo: str
    dados: dict = field(default_factory=dict)
    chave: str = ""
    em: float | None = None
    prio: int | None = None
    cor: str | None = None
    urgente: bool | None = None
    textos: dict | None = None
    molde: str = ""       # chave de TEXTOS quando o tipo tem falas por evento (feitico_marcado); vazio = o tipo
    # destinos: vazio = os do tipo; preenchido = só esses DENTRO dos do tipo (o F9 armado só na moldura)
    destinos: str = ""
    tom: str = ""         # vazio = o tom do motor; "serio" força (gank de outra rota: "sai daí" é para outro)
    # grupo: contagem própria do `intervalo` do tipo (o jungler longe com junglerLonge="tudo" sai com os destinos do
    # de perto e, sem grupo, calava o de perto por 20 s: revisão de 14/10/2026)
    grupo: str = ""
    # preenchidos pelo motor (validade > 0 posta pelo gatilho sobrepõe a do tipo: gank de outra rota)
    fala: str = ""
    rotulo: str = ""
    validade: float = 0.0
    repetir: float = 0.0
    icone: str = ""
    furou: bool = False   # falou antes dos 20 s por passar à frente de uma fala informativa (MotorAvisos)

    def json(self):
        return {"tipo": self.tipo, "chave": self.chave, "texto": self.rotulo, "fala": self.fala,
                "cor": self.cor, "rgb": CORES.get(self.cor), "icone": self.icone, "em": self.em,
                "prio": self.prio, "urgente": self.urgente}


class RelogioJogo:
    """gameTime agora: última leitura da Live Client + tempo real desde então (no máx. 5 s, para
    pausa ou Live Client parada não inventarem tempo). Sem leitura ainda → 0."""
    MAX_EXTRAPOLA = 5.0

    def __init__(self):
        self._gt, self._t = None, 0.0
        self._lock = threading.Lock()

    def atualizar(self, game_time):
        with self._lock:
            self._gt, self._t = float(game_time), time.monotonic()

    def __call__(self):
        with self._lock:
            if self._gt is None:
                return 0.0
            return self._gt + min(time.monotonic() - self._t, self.MAX_EXTRAPOLA)


class MotorAvisos:
    """Recebe avisos (publicar), descarta repetidos e desligados, e entrega: voz (1 por vez, intervalo
    mínimo de 20 s entre falas, exceto urgente), moldura (1 por vez, 2,5 s entre elas) e painel (o
    aviso de maior prioridade ainda válido). Consumidores: voz.falar(texto, urgente=, prioridade=) e
    moldura.mostrar(cor, rotulo); sem eles, só registra em `emitidos` (é o que os testes leem)."""
    INTERVALO_VOZ = 20.0
    # fala informativa (prio < PRIO_INFO: feitiço voltou, pico, objetivo, ouro, regra) não segura alerta
    # de posição (prio >= PRIO_FURA: jungler apareceu, intruso, mid indo) por 20 s: ele fala depois de
    # FURA_S. Revisão 13/10/2026: o Flash da Tristana calou "jungler rio top", que venceu na fila.
    PRIO_INFO, PRIO_FURA, FURA_S = 50, 70, 5.0
    GAP_MOLDURA = 2.5
    PAINEL_S = 8.0
    # a mesma fala (texto normalizado) não sai de novo na voz dentro disto, qualquer tipo e chave (calibração
    # 14/10/2026: gank top a 31 s do anterior; chaves diferentes com a mesma frase). Retorno de atalho fica fora.
    REPETIR_FALA_S = 60.0
    # urgente: só barra o eco imediato (revisão 14/10/2026: com 60 s o gank urgente da minha rota saía mudo
    # depois de um "gank provável no bot" de outra rota, e o 2º mergulho "2 inimigos no top" também)
    REPETIR_FALA_URGENTE_S = 10.0

    def __init__(self, tom="serio", textos=None, relogio=None, voz=None, moldura=None, log=None):
        self.tom = tom if tom in TONS else "serio"
        self.textos = textos if textos is not None else carregar_textos()[0]
        self.relogio = relogio or time.monotonic
        self.voz, self.moldura, self.log = voz, moldura, log
        self.ligado = {"voz": True, "moldura": True, "painel": True}
        self.desligados = normalizar_desligados(None)
        # corte da mesma frase na voz (REPETIR_FALA_S / _URGENTE_S); False = como antes de 14/10/2026 (config
        # cortarFalaRepetida, pedido do Gabriel de 14/10/2026: toda regra nova de aviso é escolha dele)
        self.cortar_repetida = True
        self.emitidos = deque(maxlen=500)   # (em, destino, Aviso)
        self.suprimidos = Counter()
        self._lock = threading.RLock()
        self._ultimo = {}                   # tipo:chave -> em do último aceito
        self._ultimo_tipo = {}              # (tipo, destinos, grupo) -> em do último aceito (TIPOS["intervalo"])
        self._n_tipo = Counter()            # tipo -> aceitos nesta partida (TIPOS["teto"])
        self._falas = {}                    # fala normalizada -> em da última vez que saiu na voz
        self._fila_voz, self._fila_moldura, self._painel = [], [], []
        self._ultima_fala = self._ultima_moldura = float("-inf")
        self._prio_fala = None              # prio da última fala (a regra do FURA_S olha para ela)

    def configurar(self, tom=None, voz=None, moldura=None, painel=None, desligados=None, cortar_repetida=None):
        """Liga/desliga pela seção do 7b: tom ('serio'|'descontraido'), destinos, tipos desligados e o corte
        da frase repetida. None = mantém."""
        with self._lock:
            if tom in TONS:
                self.tom = tom
            for k, v in (("voz", voz), ("moldura", moldura), ("painel", painel)):
                if v is not None:
                    self.ligado[k] = bool(v)
            if desligados is not None:
                self.desligados = normalizar_desligados(desligados)
            if cortar_repetida is not None:
                self.cortar_repetida = bool(cortar_repetida)

    def _preparar(self, a, agora):
        p = TIPOS.get(a.tipo, TIPO_REGRA)
        a.em = agora if a.em is None else a.em
        a.prio = p["prio"] if a.prio is None else a.prio
        a.cor = a.cor or p["cor"]
        a.urgente = p["urgente"] if a.urgente is None else a.urgente
        a.validade = a.validade if a.validade and a.validade > 0 else p["validade"]
        a.repetir, a.icone = p["repetir"], p["icone"]
        # destinos do aviso só restringem os do tipo (nunca acrescentam: a config é por tipo)
        a.destinos = "".join(d for d in a.destinos if d in p["destinos"]) if a.destinos else p["destinos"]
        if not a.chave.startswith(f"{a.tipo}:"):     # republicar o mesmo Aviso não prefixa de novo
            a.chave = f"{a.tipo}:{a.chave or '-'}"
        moldes = a.textos or self.textos.get(a.molde or a.tipo) or {}
        tom = a.tom if a.tom in TONS else self.tom
        fala, rotulo = moldes.get(tom) or moldes.get("serio") or (a.tipo, a.tipo)
        a.fala = _formatar(fala, a.dados)
        a.rotulo = _curto(_formatar(rotulo, a.dados))

    def publicar(self, aviso, agora=None):
        """True = aceito (vai para as filas); False = desligado ou repetido dentro de `repetir`."""
        with self._lock:
            agora = self.relogio() if agora is None else agora
            tipo_cfg = aviso.tipo if aviso.tipo in TIPOS_LIGAVEIS else "regra"
            sem_voz, sem_tela = (tipo_cfg in self.desligados[d] for d in DESTINOS_CONFIG)
            if sem_voz and sem_tela:
                self.suprimidos["desligado"] += 1
                return False
            self._preparar(aviso, agora)
            ult = self._ultimo.get(aviso.chave)
            if ult is not None and agora - ult < aviso.repetir:
                self.suprimidos["repetido"] += 1
                return False
            p = TIPOS.get(aviso.tipo, TIPO_REGRA)
            ct = (aviso.tipo, aviso.destinos, aviso.grupo)
            if p.get("intervalo") and agora - self._ultimo_tipo.get(ct, float("-inf")) < p["intervalo"]:
                self.suprimidos["intervalo"] += 1
                return False
            if p.get("teto") is not None and self._n_tipo[aviso.tipo] >= p["teto"]:
                self.suprimidos["teto"] += 1
                return False
            self._ultimo[aviso.chave] = agora
            self._ultimo_tipo[ct] = agora
            self._n_tipo[aviso.tipo] += 1
            if "p" in aviso.destinos and self.ligado["painel"] and not sem_tela:
                self._painel.append(aviso)
            if "v" in aviso.destinos and self.ligado["voz"] and not sem_voz:
                self._fila_voz.append(aviso)
            if "m" in aviso.destinos and self.ligado["moldura"] and not sem_tela:
                self._fila_moldura.append(aviso)
            self._distribuir(agora)
            return True

    def tick(self, agora=None):
        """Chamar ~1/s (laço ao vivo): solta a fala que esperava o intervalo e descarta o vencido."""
        with self._lock:
            self._distribuir(self.relogio() if agora is None else agora)

    @staticmethod
    def _melhor(fila):
        return max(fila, key=lambda a: (a.prio, -a.em))

    @staticmethod
    def _e_retorno(a):
        return bool(TIPOS.get(a.tipo, {}).get("retorno"))

    def _distribuir(self, agora):
        for fila in (self._fila_voz, self._fila_moldura):
            vencidos = [a for a in fila if agora - a.em > a.validade]
            for a in vencidos:
                fila.remove(a)
                self.suprimidos["vencido"] += 1
        alertas = [a for a in self._fila_moldura if not self._e_retorno(a)]
        if alertas:
            a = self._melhor(alertas)
            if agora - self._ultima_moldura >= self.GAP_MOLDURA or a.urgente:
                self._fila_moldura.remove(a)
                self._ultima_moldura = agora
                self._emitir(agora, "moldura", a)
        # retorno de atalho (TIPOS retorno=True) só preenche tempo ocioso: sai quando nenhum alerta está na
        # tela (GAP_MOLDURA desde o último), o mais novo substitui os anteriores, e não mexe em
        # _ultima_moldura (um alerta que chega depois apaga o retorno na hora, nunca o contrário)
        retornos = [a for a in self._fila_moldura if self._e_retorno(a)]
        if retornos and agora - self._ultima_moldura >= self.GAP_MOLDURA:
            a = max(retornos, key=lambda x: x.em)
            for x in retornos:
                self._fila_moldura.remove(x)
            if len(retornos) > 1:
                self.suprimidos["substituido"] += len(retornos) - 1
            self._emitir(agora, "moldura", a)
        # na voz o retorno sai na hora, em ordem, sem urgência (não corta fala; a fila do voz.py põe atrás
        # do que está tocando) e fora do intervalo de 20 s: não atrasa nem vence alerta de posição
        for a in sorted((a for a in self._fila_voz if self._e_retorno(a)), key=lambda x: x.em):
            self._fila_voz.remove(a)
            self._emitir(agora, "voz", a)
        while self._fila_voz:
            a = self._melhor(self._fila_voz)
            desde = agora - self._ultima_fala
            fura = (not a.urgente and desde < self.INTERVALO_VOZ and a.prio >= self.PRIO_FURA and desde >= self.FURA_S
                    and self._prio_fala is not None and self._prio_fala < self.PRIO_INFO)
            if not (desde >= self.INTERVALO_VOZ or a.urgente or fura):
                break
            self._fila_voz.remove(a)
            chave_fala = normalizar_fala(a.fala)
            # urgente (gank onde estou, intruso vermelho) usa janela curta: o mesmo texto pode ser OUTRO perigo
            # (gank de outra rota virou o da minha; 2º mergulho); a repetição do mesmo evento a chave já barra
            janela = self.REPETIR_FALA_URGENTE_S if a.urgente else self.REPETIR_FALA_S
            if self.cortar_repetida and agora - self._falas.get(chave_fala, float("-inf")) < janela:
                self.suprimidos["fala_repetida"] += 1      # a mesma frase há pouco: cai e o próximo da fila tenta
                continue
            self._falas[chave_fala] = agora
            self._ultima_fala, self._prio_fala = agora, a.prio
            a.furou = fura
            self._emitir(agora, "voz", a)
            break

    def _emitir(self, agora, destino, a):
        self.emitidos.append((agora, destino, a))
        if self.log and destino in ("voz", "moldura"):
            # rastro do que o coach disse/pintou: "a borda ficou vermelha" se confere no log (13/10/2026)
            self.log.info("aviso %s %s/%s: %s", destino, a.tipo, a.cor,
                          a.rotulo if destino == "moldura" else a.fala)
        try:
            if destino == "voz" and self.voz is not None:
                self.voz.falar(a.fala, urgente=a.urgente, prioridade=a.prio)
            elif destino == "moldura" and self.moldura is not None:
                self.moldura.mostrar(a.cor, a.rotulo)
        except Exception as e:  # consumidor quebrado não derruba o laço ao vivo
            if self.log:
                self.log.warning("aviso %s → %s falhou: %s", a.chave, destino, e)

    def painel(self, agora=None):
        """O aviso da faixa do painel (dict de Aviso.json) ou None."""
        with self._lock:
            agora = self.relogio() if agora is None else agora
            self._painel = [a for a in self._painel if agora - a.em <= max(a.validade, self.PAINEL_S)]
            return self._melhor(self._painel).json() if self._painel else None

    def estado(self, agora=None):
        """Bloco para o /estado do servidor do passo 8."""
        return {"aviso": self.painel(agora), "tom": self.tom, "ligado": dict(self.ligado),
                "desligados": {d: sorted(s) for d, s in self.desligados.items()}}


def aviso_de(d):
    """dict de feiticos.voltaram / sugestoes.PicosDeForca -> Aviso. Com `dados`, a fala sai do molde do
    TEXTOS (`molde` ou o tipo: genérica, no pacote de voz); `textos` prontos só sem `dados` (texto livre)."""
    return Aviso(d["tipo"], dict(d.get("dados") or {}), chave=d["chave"], molde=d.get("molde") or "",
                 textos=None if d.get("dados") else d.get("textos"))


_RETORNO_F9 = {   # evento do F9 -> (molde em TEXTOS, destinos, cor)
    "armado": ("feitico_armado", "m", "azul"),
    "marcado": ("feitico_marcado", "vm", "verde"),
    "desfeito": ("feitico_desfeito", "vm", "azul"),
    "sem_inimigo": ("feitico_sem_inimigo", "m", "azul"),
    "sem_feitico": ("feitico_sem_feitico", "m", "azul"),
}


def aviso_atalho(evento, chave, rota=None, feitico=None, estado=None):
    """retorno ao jogador de um atalho que ELE apertou -> Aviso para o MotorAvisos.
    evento do F9: "armado" (rótulo "flash: 1-5"), "marcado" (voz "flash do <rota> marcado" + rótulo
    "<rota> sem flash"), "desfeito" (voz "marcação desfeita"), "sem_inimigo", "sem_feitico" (feiticos.
    Feiticos.marcar); "overlay" = F8 (estado "ligado"/"desligado"). rota = ROTA_FALA (top,
    jungler, mid, atirador, suporte; "inimigo" quando a Live Client não deu a posição dele). chave única
    por aperto (repetir do tipo = 1 s). Cor: azul ou verde."""
    if evento == "overlay":
        return Aviso("overlay_f8", {"estado": estado or "?"}, str(chave), cor="azul")
    molde, destinos, cor = _RETORNO_F9[evento]
    f = (str(feitico or "flash").split() or ["flash"])[0].lower()
    return Aviso("feitico_marcado", {"rota": rota or "?", "feitico": f}, f"{evento}:{chave}", cor=cor,
                 molde=molde, destinos=destinos)


# --------------------------------------------------------------------------------------------
# zonas (regiões de docs/INSIGHTS.md + metade top/bot pela diagonal do meio)

def time_num(t):
    """'ORDER'/100/'100' -> 100; 'CHAOS'/200 -> 200; senão None."""
    s = str(t).upper()
    return 100 if s in ("ORDER", "100") else 200 if s in ("CHAOS", "200") else None


def zona(x, y, meu_time):
    reg = analise.regiao(x, y, meu_time)
    return reg, _zona_textos(reg, "top" if y > x else "bot")


def _zona_textos(reg, m):
    """(rótulo, 1 palavra, fala) da região; m = metade do mapa ("top"/"bot") pela diagonal do meio"""
    return {
        "rota_top": ("top", "top", "no top"),
        "rota_meio": ("mid", "mid", "no mid"),
        "rota_bot": ("bot", "bot", "no bot"),
        "rio": (f"rio {m}", "rio", f"no rio {m}"),
        "selva_aliada": ("tua selva", "selva", f"na tua selva {m}"),
        "selva_inimiga": (f"selva {m}", "selva", f"na selva {m} deles"),
        "base_aliada": ("tua base", "base", "na tua base"),
        "base_inimiga": ("base deles", "base", "na base deles"),
    }[reg]


MARGEM_ROTA = 1500  # "perto da rota" = faixa da rota (INSIGHTS) alargada por isto, fora das bases


def perto_da_rota(rota, x, y, margem=MARGEM_ROTA, com_base=False):
    """(x, y) na faixa da rota alargada por `margem`; dentro das bases é sempre False, salvo com_base=True
    (onde_estou com o meu ícone fundo na base deles: split push na torre do inibidor)"""
    a = analise
    if not com_base and (x * x + y * y < a.R_BASE ** 2 or (a.XMAX - x) ** 2 + (a.YMAX - y) ** 2 < a.R_BASE ** 2):
        return False
    # a faixa do meio é só do mid: com a margem, as rotas laterais (x < 3800, y > 11180) engoliam a frente das
    # bases no meio (torre do inibidor do mid, a ~5300 do canto, fora do R_BASE): 3 inimigos defendendo o mid
    # deles viravam "4 inimigos no top" (partida 3293137136, 14/10/2026). Fora com_base: o nexo (as 3 faixas)
    # segue sem rota em onde_estou (D14)
    if not com_base and rota != "rota_meio" and abs(y - x) <= a.M_MEIO:
        return False
    if rota == "rota_top":
        return x < a.F_ROTA + margem or y > a.YMAX - a.F_ROTA - margem or y - x > a.D_QUINA - margem
    if rota == "rota_bot":
        return y < a.F_ROTA + margem or x > a.XMAX - a.F_ROTA - margem or x - y > a.D_QUINA - margem
    if rota == "rota_meio":
        return abs(y - x) <= a.M_MEIO + margem
    return False


ROTA_DA_POSICAO = {"TOP": "rota_top", "MIDDLE": "rota_meio", "BOTTOM": "rota_bot", "UTILITY": "rota_bot"}
_RIVAIS = {"TOP": {"TOP"}, "MIDDLE": {"MIDDLE"}, "BOTTOM": {"BOTTOM", "UTILITY"},
           "UTILITY": {"BOTTOM", "UTILITY"}, "JUNGLE": {"JUNGLE"}}
_SMITE = ("golpe", "smite")


def jogadores_do_live(dados):
    """(eu, {nome: {campeao, time (100/200), posicao, eu}}) de um allgamedata (bruto ou limpo pelo
    coletor.limpar_live). nome = campeão (ou "Campeão ORDER" se o campeão se repete), como no
    limpar_live; `por_nome` mapeia riotId/summonerName -> nome para ler os eventos."""
    jogadores = (dados or {}).get("allPlayers") or []
    campeoes = [str(p.get("championName") or "?") for p in jogadores]
    ativo = (dados or {}).get("activePlayer") or {}
    ids_ativo = {ativo.get(k) for k in ("riotId", "summonerName", "riotIdGameName") if ativo.get(k)}
    out, por_nome, eu = {}, {}, None
    for p, camp in zip(jogadores, campeoes):
        nome = camp if campeoes.count(camp) == 1 else f"{camp} {p.get('team') or '?'}"
        feiticos = " ".join(str(f.get("displayName", "")) for f in (p.get("summonerSpells") or {}).values()
                            if isinstance(f, dict)).lower()
        sou = bool(ids_ativo & {p.get(k) for k in ("riotId", "summonerName", "riotIdGameName") if p.get(k)})
        out[nome] = {"campeao": camp, "time": time_num(p.get("team")), "posicao": str(p.get("position") or "").upper(),
                     "eu": sou, "smite": any(s in feiticos for s in _SMITE)}
        for k in ("riotId", "summonerName", "riotIdGameName"):
            if p.get(k):
                por_nome[p[k]] = nome
                por_nome[str(p[k]).split("#", 1)[0]] = nome
        if sou:
            eu = nome
    return eu, out, por_nome


# --------------------------------------------------------------------------------------------
# gatilhos da Live Client (passo 12)

# Conferir a cada patch. Medido em 13/10/2026 (partida 3292746609): dragões abatidos a 508, 845,
# 1181, 1545 e 1871 s (renascer de ~300 s confere: 337/336/364/326 entre abates); vastilarvas a
# 530 s, arauto 1041 s, barão 1425 s: os primeiros nascimentos de vastilarvas/arauto/barão são só
# limite superior (valores do patch, não medidos). Dragão ancião (depois da alma) não modelado.
OBJETIVOS = {
    "dragão": dict(evento="DragonKill", primeiro=300, renasce=300),
    "vastilarvas": dict(evento="HordeKill", primeiro=480, renasce=None),
    "arauto": dict(evento="HeraldKill", primeiro=900, renasce=None),   # = ARAUTO_1 do ao_vivo.py
    "barão": dict(evento="BaronKill", primeiro=1200, renasce=360),
}


class GatilhosLive:
    """Avisos que saem só da Live Client: objetivo em 60 s, janela de objetivo (2+ inimigos mortos),
    2 mortes antes dos 10, ouro guardado ≥ 2000, adversário de rota fed. Chamar atualizar() a cada
    leitura (1 s); antes do evento GameStart (tela de carregamento) não avisa nada."""
    AVISO_ANTES = 60
    OURO_VOLTAR, OURO_REARMA = 2000, 1000
    MORTES_CEDO, CEDO_S = 2, 600
    FED_KILLS, FED_SALDO = 3, 2
    JANELA_MORTOS, JANELA_RENASCER = 2, 10.0

    def __init__(self, motor):
        self.motor = motor
        self.eventos = {}            # EventID -> evento (dedupe)
        self.mortos = set()          # nomes mortos agora (para AlertasPosicao.observar)
        self.eu, self.jogadores = None, {}
        self.game_time = 0.0
        self._ouro_armado, self._n_mortos, self._fed = True, 0, {}

    def _abates(self, evento):
        return sorted(e.get("EventTime", 0) for e in self.eventos.values() if e.get("EventName") == evento)

    def objetivos(self, gt=None):
        """[{objetivo, nasce_em, vivo}] pelo último abate de cada um; nasce_em None = não volta."""
        gt = self.game_time if gt is None else gt
        out = []
        for nome, o in OBJETIVOS.items():
            abates = self._abates(o["evento"])
            nasce = o["primeiro"] if not abates else (abates[-1] + o["renasce"] if o["renasce"] else None)
            out.append({"objetivo": nome, "nasce_em": nasce, "vivo": nasce is not None and nasce <= gt})
        return out

    def atualizar(self, dados, agora=None, objetivos=None):
        """objetivos (opcional): [{objetivo, nasce_em, vivo}] de quem já calcula os timers (o
        EstadoPartida do ao_vivo.py, que modela também o ancião); sem ele, usa a tabela OBJETIVOS."""
        if not isinstance(dados, dict) or not dados.get("allPlayers"):
            return []
        gt = float((dados.get("gameData") or {}).get("gameTime") or 0.0)
        self.game_time = gt
        agora = gt if agora is None else agora
        for e in (dados.get("events") or {}).get("Events") or []:
            if isinstance(e, dict) and "EventID" in e:
                self.eventos.setdefault(e["EventID"], e)
        self.eu, self.jogadores, _ = jogadores_do_live(dados)
        jog = self.jogadores
        por_nome = dict(zip(jog, dados["allPlayers"]))   # mesma ordem do allPlayers
        self.mortos = {n for n, p in por_nome.items() if p.get("isDead")}
        if not any(e.get("EventName") == "GameStart" for e in self.eventos.values()):
            return []                                   # carregando: nada de aviso
        avisos = []
        eu = jog.get(self.eu)
        meu_time = eu["time"] if eu else None
        inimigos = {n: p for n, p in por_nome.items() if jog[n]["time"] != meu_time}

        objs = list(objetivos) if objetivos is not None else self.objetivos(gt)
        for o in objs:
            if o.get("nasce_em") is not None and 0 < o["nasce_em"] - gt <= self.AVISO_ANTES:
                avisos.append(Aviso("objetivo_60s", {"objetivo": o["objetivo"]}, f"{o['objetivo']}:{int(o['nasce_em'])}"))

        n = sum(1 for p in inimigos.values() if p.get("isDead") and float(p.get("respawnTimer") or 0) >= self.JANELA_RENASCER)
        if n >= self.JANELA_MORTOS and self._n_mortos < self.JANELA_MORTOS:
            peso = ("barão", "ancião", "dragão", "arauto", "vastilarvas")   # o mais valioso vivo primeiro
            vivos = [o["objetivo"] for o in objs if o.get("vivo")]
            vivo = min(vivos, key=lambda x: peso.index(x) if x in peso else 99, default="torre")
            avisos.append(Aviso("janela_objetivo", {"n": n, "objetivo": vivo}, f"{int(gt) // 30}"))
        self._n_mortos = n

        if eu:
            meu = por_nome.get(self.eu) or {}
            mortes = int((meu.get("scores") or {}).get("deaths") or 0)
            if mortes >= self.MORTES_CEDO and gt < self.CEDO_S:
                avisos.append(Aviso("mortes_cedo", {"n": mortes}, "cedo"))
            ouro = float((dados.get("activePlayer") or {}).get("currentGold") or 0)
            if ouro < self.OURO_REARMA:
                self._ouro_armado = True
            elif ouro >= self.OURO_VOLTAR and self._ouro_armado and not meu.get("isDead"):
                avisos.append(Aviso("ouro_guardado", {"ouro": int(ouro // 100) * 100}, f"{int(gt)}"))
                self._ouro_armado = False
            rivais = _RIVAIS.get(eu["posicao"], set())
            for nome, p in inimigos.items():
                if jog[nome]["posicao"] not in rivais:
                    continue
                s = p.get("scores") or {}
                k, d = int(s.get("kills") or 0), int(s.get("deaths") or 0)
                if k >= self.FED_KILLS and k - d >= self.FED_SALDO and k >= self._fed.get(nome, -99) + 2:
                    self._fed[nome] = k
                    avisos.append(Aviso("inimigo_fed", {"campeao": jog[nome]["campeao"],
                                                        "rota": rota_fala(jog[nome]["posicao"])}, f"{nome}:{k}"))

        return [a for a in avisos if self.motor.publicar(a, agora)]


# --------------------------------------------------------------------------------------------
# alertas de posição (passo 15c) sobre as detecções do minimapa

@dataclass
class _Visto:
    visto: float | None = None      # gameTime da última detecção
    pos: tuple | None = None
    reg: str = ""
    visivel: bool = False
    perto: set = field(default_factory=set)   # rotas (das 3) de que estava perto no último quadro visível
    # o sumiço passou na relevância (ou foi calado só por luta, eu morto ou na base): libera o "mid indo X" na
    # volta, ACEITO ou não o "mid sumiu" pelo motor (revisão 14/10/2026: barrado pelo intervalo/teto, o roam
    # do mid para outra rota sumia junto, e é o aviso que o Gabriel repassa aos colegas)
    sumiu_avisado: bool = False
    sumiu_tratado: bool = False     # o sumiço já foi avaliado (avisado ou calado): 1 decisão por sumiço


ROTAS = ("rota_top", "rota_meio", "rota_bot")
PRIO_JUNGLER_LONGE = 15   # jungler longe de mim: só painel, abaixo de toda informativa (objetivo 50, regra 20)
# o que fazer com o jungler que aparece longe de mim (config junglerLonge; mesma lista em servidor_local.ESCOLHAS)
JUNGLER_LONGE = ("painel", "tudo", "nada")
# zona de gank de cada rota para o "jungler apareceu" (calibração 14/10/2026: o Gabriel no top não quer saber do
# jungler na selva bot deles, mas quer a selva top). Chave = região de analise.regiao (relativa ao meu time) +
# metade do mapa pela diagonal do meio (absoluta: a rota top é a mesma para os dois times). Casa com
# jungler.zonas_de_gank; o mid é cercado pelos dois rios.
ZONAS_DA_ROTA = {
    "rota_top": ("rota_top", "rio top", "selva_aliada top", "selva_inimiga top"),
    "rota_meio": ("rota_meio", "rio top", "rio bot"),
    "rota_bot": ("rota_bot", "rio bot", "selva_aliada bot", "selva_inimiga bot"),
}


def chave_zona(x, y, meu_time):
    """'rota_top' | 'rio top' | 'selva_inimiga bot' | 'base_aliada top'… (região + metade do mapa)"""
    reg = analise.regiao(x, y, meu_time)
    return reg if reg in ROTAS else f"{reg} {'top' if y > x else 'bot'}"


# estruturas pelo nome da Live Client (ARMADILHAS § Live Client: a torre é do time que PERDEU). Medido nas
# partidas 3292746609 e 3293092537: Turret_T{Order|Chaos}_L{0 bot, 1 mid, 2 top}_P{3 externa, 2 interna,
# 1 inibidor, 4/5 nexo}_…; Inhib_T{Order|Chaos}_L{n}_P1_…
def estruturas(eventos, meu_time):
    """{'mid_externa': torre externa do mid (de qualquer time) caiu, 'cerco': torre de inibidor, de nexo ou
    inibidor MEU caiu} a partir da lista de eventos da Live Client."""
    meu = "_TOrder_" if time_num(meu_time) == 100 else "_TChaos_"
    out = {"mid_externa": False, "cerco": False}
    for e in eventos or ():
        nome = str(e.get("TurretKilled") or e.get("InhibKilled") or "")
        if e.get("EventName") == "TurretKilled" and "_L1_P3_" in nome:
            out["mid_externa"] = True
        if meu in nome and (e.get("EventName") == "InhibKilled" or re.search(r"_P[145]_", nome)):
            out["cerco"] = True
    return out


class AlertasPosicao:
    """Recebe as detecções do minimapa quadro a quadro e publica no motor: jungler apareceu, mid
    sumiu / mid indo X, intruso na minha rota (vermelho: jungler ou 2+; amarelo: 1 laner) e
    adversário voltou (azul).

    Interface do minimapa (passo 13) → observar(deteccoes, agora, quadro_valido, mortos):
      deteccoes: lista de {"campeao": str, "time": "ORDER"|"CHAOS"|100|200, "x": float, "y": float,
                 "visto_em": float}; conta como visível agora só o que tem visto_em a ≤ FRESCO_S
                 (0,6 s) de `agora`, então serve a lista do quadro ou a de última posição
                 (minimapa.Captura.deteccoes(max_idade=1)); x/y em unidades do mapa
                 (0–14870 × 0–14980, origem na base azul); visto_em = gameTime do quadro.
                 `campeao` = championName da Live Client (ou o nome do limpar_live).
      quadro_valido: False quando o jogo não está na tela (print do monitor com outra janela):
                 pausa tudo; ausência num quadro inválido não conta como sumiço.
      mortos: nomes mortos agora (GatilhosLive.mortos): morto não "some".
      eventos: lista de eventos da Live Client (GatilhosLive.eventos.values()): torres e inibidores caídos.

    Relevância (calibração de 14/10/2026, roadmap/2026-10-14-calibrar-avisos.md): "onde estou" (onde_estou)
    = meu ícone visto há ≤ MINHA_POS_S; morto, na minha base ou sem ícone → a rota do champ select (reserva).
    Jungler que aparece longe de mim (fora de RAIO_PERTO e da ZONAS_DA_ROTA da minha rota) vai só ao painel.
    "Mid sumiu" só na fase de rotas e calado em cerco, luta, comigo morto ou na base (_mid_sumiu_calado).
    """
    SUMIR_S = 3.0      # sem detecção por 3 s = fora de vista (a detecção pisca entre quadros)
    APARECEU_S = 8.0   # jungler: só "apareceu" depois de 8 s fora de vista (ou o 1º avistamento)
    MID_SUMIU_S = 6.0  # mid sem detecção por 6 s (visto por último na rota do meio e vivo) = "mid sumiu"
    VOLTOU_S = 20.0   # adversário fora de vista ≥ 20 s que reaparece perto da rota = voltou
    RESYNC_S = 2.0     # depois de uma pausa (quadros inválidos) só observa, sem alertar
    FRESCO_S = 0.6     # detecção com visto_em mais velho que isto = posição antiga, não visível agora
    MINHA_POS_S = 4.0  # meu ícone visto há mais que isto = não sei onde estou (vale a rota do champ select)
    # sem ícone fresco, mas a última pista diz "fui para a base" (morri e renasci, o ícone sumiu com o anel grosso
    # de "voltando à base", ou foi visto por último na minha base): estou na base por até isto (a fonte fica no
    # canto do minimapa e o ícone lá mal passa no LIMIAR_ANEL: 0,301 contra 0,30). Antes valia a rota do champ
    # select e o gank dela saía urgente comigo na base (Gabriel, partida 3293137136, 14/10/2026). Da fonte à
    # torre externa do top são ~25 s a pé: passado isto sem ícone, volta a valer a reserva
    BASE_PRESUMIDA_S = 45.0
    RAIO_PERTO = 4000  # jungler a até isto de mim importa onde quer que eu esteja (~11 s a 345 de velocidade)
    # "mid sumiu" só na fase de rotas: os minions chegam ao mid ~1:00; aos 14:00 caem as placas e os times
    # agrupam. Medido 14/10/2026: o aviso saía aos 0:37 e 7 vezes com a base do Gabriel caindo (22–24 min)
    MID_JANELA = (90.0, 840.0)
    CERCO_N = 2        # inimigos vistos na minha base nos últimos CERCO_S = cerco
    CERCO_S = 10.0
    LUTA_N = 3         # inimigos à vista juntos (a até LUTA_RAIO de um deles) = luta/agrupamento: "mid sumiu" não diz nada
    LUTA_RAIO = 2500
    # motivos de calar o "mid sumiu" que NÃO calam o "mid indo X" na volta: o roam dele para outra rota ainda é
    # recado para os colegas (luta no bot = o mid indo para ela; eu morto ou na base ainda aviso o time)
    LIBERA_MID_INDO = ("luta", "eu_morto", "eu_na_base")

    def __init__(self, motor, meu_campeao, meu_time, jogadores):
        """jogadores: {nome: {"time": 100|200|"ORDER"|"CHAOS", "posicao": "TOP"|...|"UTILITY"|"JUNGLE"}}
        (jogadores_do_live devolve neste formato)."""
        self.motor, self.eu, self.meu_time = motor, meu_campeao, time_num(meu_time)
        self.jog = {n: {**p, "time": time_num(p.get("time"))} for n, p in jogadores.items()}
        self.minha_posicao = str(self.jog.get(meu_campeao, {}).get("posicao") or "").upper()
        self.inimigos = {n for n, p in self.jog.items() if p["time"] and p["time"] != self.meu_time}
        self.jungler = next((n for n in self.inimigos if self.jog[n].get("posicao") == "JUNGLE"), None) \
            or next((n for n in self.inimigos if self.jog[n].get("smite")), None)
        # quem "mora" em cada rota (o top inimigo no top, atirador e suporte no bot): não é intruso
        # nela. O jungler inimigo não mora em rota nenhuma, nem quando eu sou o jungler.
        self.ocupantes = {r: {n for n in self.inimigos if n != self.jungler
                              and ROTA_DA_POSICAO.get(self.jog[n].get("posicao")) == r}
                          for r in ("rota_top", "rota_meio", "rota_bot")}
        self.minha_rota = ROTA_DA_POSICAO.get(self.minha_posicao)
        self.rivais = self.ocupantes.get(self.minha_rota, set())   # adversários da rota do champ select
        self.mid = next((n for n in self.inimigos if self.jog[n].get("posicao") == "MIDDLE"), None)
        self.st = {n: _Visto() for n in self.inimigos}
        self.aliados = {n for n, p in self.jog.items() if p["time"] == self.meu_time and n != meu_campeao}
        self.aliados_pos = {}             # nome -> (gameTime, x, y) do último quadro em que o aliado foi visto
        self.minha_pos = None
        self.minha_pos_t = None           # gameTime em que o meu ícone foi visto por último
        self.base_t = None                # gameTime da última pista de que fui para a minha base (BASE_PRESUMIDA_S)
        self.eu_morto = False
        self.agora = 0.0                  # gameTime do último observar (para quem lê de fora: coach_vivo)
        self.calados = Counter()          # motivo -> "mid sumiu" calado pela relevância (prova e diagnóstico)
        self._estr, self._n_eventos = {"mid_externa": False, "cerco": False}, -1
        self._invalido = False
        self._resync_ate = float("-inf")
        # escolhas do Gabriel (config midSumiuFiltro e junglerLonge; padrão = a calibração de 14/10/2026)
        self.filtro_mid = True            # False: "mid sumiu" como antes (só não conta o mid visto por último
        #                                   na base dele); teto e intervalo do tipo seguem valendo no motor
        self.jungler_longe = "painel"     # JUNGLER_LONGE: "painel" só a 2ª tela, "tudo" voz e borda, "nada" nem isso

    def configurar(self, filtro_mid=None, jungler_longe=None):
        """escolhas das Configurações (coach_vivo); None = mantém; valor desconhecido do jungler = 'painel'"""
        if filtro_mid is not None:
            self.filtro_mid = bool(filtro_mid)
        if jungler_longe is not None:
            self.jungler_longe = jungler_longe if jungler_longe in JUNGLER_LONGE else "painel"

    @classmethod
    def do_live(cls, motor, dados):
        eu, jog, _ = jogadores_do_live(dados)
        return cls(motor, eu, (jog.get(eu) or {}).get("time"), jog)

    def onde_estou(self, agora=None):
        """{'fonte': 'icone'|'base'|'morto'|'reserva', 'pos': (x, y)|None, 'reg': região|None, 'rota': rota_*|None}.
        Ícone fresco numa rota → ela; no rio/selva → a única rota cuja faixa (MARGEM_ROTA) me contém, senão
        nenhuma; na minha base, morto ou sem ícone → a rota do champ select (vou voltar para ela). Sem ícone
        fresco depois de morrer, de sumir voltando à base ou de ser visto nela (há ≤ BASE_PRESUMIDA_S) = 'base'
        com pos None (revisão 14/10/2026: antes era 'reserva', e o gank da rota do champ select saía urgente)."""
        agora = self.agora if agora is None else agora
        reserva = ROTA_DA_POSICAO.get(self.minha_posicao)
        if self.eu_morto:
            return {"fonte": "morto", "pos": None, "reg": None, "rota": reserva}
        if self.minha_pos is None or self.minha_pos_t is None or agora - self.minha_pos_t > self.MINHA_POS_S:
            if self.base_t is not None and agora - self.base_t <= self.BASE_PRESUMIDA_S:
                return {"fonte": "base", "pos": None, "reg": "base_aliada", "rota": reserva}
            return {"fonte": "reserva", "pos": None, "reg": None, "rota": reserva}
        x, y = self.minha_pos
        reg = analise.regiao(x, y, self.meu_time)
        if reg == "base_aliada":
            return {"fonte": "base", "pos": (x, y), "reg": reg, "rota": reserva}
        if reg in ROTAS:
            return {"fonte": "icone", "pos": (x, y), "reg": reg, "rota": reg}
        if reg == "base_inimiga":
            # split push fundo (torre do inibidor deles): a rota pela faixa sem a margem, dentro da base; no
            # meio da base (perto do nexo) as 3 faixas se cruzam = nenhuma (revisão 14/10/2026)
            perto = [r for r in ROTAS if perto_da_rota(r, x, y, margem=0, com_base=True)]
            return {"fonte": "icone", "pos": (x, y), "reg": reg, "rota": perto[0] if len(perto) == 1 else None}
        perto = [r for r in ROTAS if perto_da_rota(r, x, y)]
        return {"fonte": "icone", "pos": (x, y), "reg": reg, "rota": perto[0] if len(perto) == 1 else None}

    def rotas_vigiadas(self, agora=None):
        """A rota de onde estou (onde_estou): ícone numa rota, senão a do champ select; no rio ou na selva
        longe das rotas, nenhuma (jungler sem ícone numa rota não vigia nada)."""
        r = self.onde_estou(agora)["rota"]
        return {r} if r else set()

    def importa_para_mim(self, x, y, agora=None):
        """o jungler em (x, y) importa para onde estou? Perto de mim (RAIO_PERTO) ou na zona de gank da minha
        rota (ZONAS_DA_ROTA). Eu jungler: tudo importa (o jungler deles é o meu adversário direto: invasão,
        contra-selva, objetivo; decisão D11 de 14/10/2026). Sem ícone e sem rota (ARAM): tudo importa."""
        if self.minha_posicao == "JUNGLE":
            return True
        o = self.onde_estou(agora)
        if o["fonte"] == "icone" and math.hypot(x - o["pos"][0], y - o["pos"][1]) <= self.RAIO_PERTO:
            return True
        if o["rota"] is None:
            return o["pos"] is None
        return chave_zona(x, y, self.meu_time) in ZONAS_DA_ROTA[o["rota"]]

    def aliados_na_rota(self, rota, agora=None, max_idade=5.0):
        """[(x, y)] dos aliados (fora eu) vistos há ≤ max_idade na faixa da rota ('rota_top'...), o mais
        adiantado (mais longe da minha fonte) primeiro: é quem o jungler deles ganka"""
        agora = self.agora if agora is None else agora
        out = [(x, y) for t, x, y in self.aliados_pos.values() if agora - t <= max_idade and perto_da_rota(rota, x, y)]
        fx, fy = (0.0, 0.0) if time_num(self.meu_time) == 100 else (analise.XMAX, analise.YMAX)
        return sorted(out, key=lambda p: -math.hypot(p[0] - fx, p[1] - fy))

    def aliado_na_rota(self, rota, agora=None, max_idade=5.0):
        """(x, y) do aliado mais adiantado na faixa da rota, ou None (aliados_na_rota)"""
        lista = self.aliados_na_rota(rota, agora, max_idade)
        return lista[0] if lista else None

    def _mid_sumiu_calado(self, s, agora, n_visiveis):
        """motivo para NÃO avisar "mid sumiu" agora, ou None (avisa)"""
        if not self.filtro_mid:          # filtro desligado nas Configurações: a regra de antes de 14/10/2026
            return "base_dele" if s.reg == "base_inimiga" else None
        if agora < self.MID_JANELA[0]:
            return "cedo"
        if agora >= self.MID_JANELA[1]:
            return "fim_das_rotas"
        if self._estr["mid_externa"]:
            return "torre_do_mid"
        if s.reg not in ("rota_meio", "rio"):
            return "fora_da_rota"        # visto por último já fundo (selva, base): "sumiu" não diz nada; o rio
            #                              conta (o mid que entra na moita do rio e some é o roam clássico)
        na_base = sum(1 for n in self.inimigos if self.st[n].reg == "base_aliada" and self.st[n].visto is not None
                      and agora - self.st[n].visto <= self.CERCO_S)
        if self._estr["cerco"] or na_base >= self.CERCO_N:
            return "cerco"
        # daqui para baixo, LIBERA_MID_INDO: o contexto do jogo passou, só o momento não serve para o "sumiu"
        if self.eu_morto:
            return "eu_morto"
        if self.onde_estou(agora)["fonte"] == "base":
            return "eu_na_base"
        if n_visiveis >= self.LUTA_N:
            return "luta"                # n_visiveis = o maior grupo de inimigos à vista JUNTOS (_agrupados)
        return None

    def _agrupados(self, vistos, mortos):
        """o maior número de inimigos à vista a até LUTA_RAIO de um deles (luta, agrupamento). Na fase de
        rotas o top, o mid e a dupla do bot à vista ao mesmo tempo, cada um na sua rota, não é luta."""
        pos = [vistos[n] for n in self.inimigos if n in vistos and n not in mortos]
        return max((sum(1 for q in pos if math.hypot(p[0] - q[0], p[1] - q[1]) <= self.LUTA_RAIO) for p in pos),
                   default=0)

    def _nome(self, d):
        c = d.get("campeao")
        if c in self.jog:
            return c
        t = time_num(d.get("time"))
        alvo = [n for n, p in self.jog.items() if (p.get("campeao") or n) == c and (t is None or p["time"] == t)]
        return alvo[0] if alvo else None

    def observar(self, deteccoes, agora=None, quadro_valido=True, mortos=(), eventos=None):
        agora = self.motor.relogio() if agora is None else agora
        self.agora = agora
        if eventos is not None:
            eventos = list(eventos)
            if len(eventos) != self._n_eventos:   # a lista é acumulativa: só recalcula quando cresce
                self._n_eventos, self._estr = len(eventos), estruturas(eventos, self.meu_time)
        self.eu_morto = self.eu in mortos
        if self.eu_morto:
            self.base_t = agora               # renasço na fonte: base presumida até o ícone aparecer (onde_estou)
        if not quadro_valido:
            self._invalido = True
            return []
        if self._invalido:
            self._invalido = False
            self._resync_ate = agora + self.RESYNC_S
        quieto = agora < self._resync_ate
        vistos, voltando = {}, False
        for d in deteccoes or []:
            if d.get("visto_em") is not None and agora - float(d["visto_em"]) > self.FRESCO_S:
                continue                      # última posição antiga (Captura.deteccoes()): não está visível agora
            n = self._nome(d)
            if n and n not in vistos:
                vistos[n] = (float(d["x"]), float(d["y"]))
                voltando = voltando or (n == self.eu and bool(d.get("grande")))
        if self.eu in vistos:
            self.minha_pos, self.minha_pos_t = vistos[self.eu], agora
            # o nome pode vir com sufixo (campeão repetido: "Yuumi ORDER"), por isso a 1ª palavra
            yu = next((n for n in self.aliados if n.split()[0].lower() == "yuumi" and n in vistos), None)
            if voltando and yu and math.hypot(vistos[yu][0] - vistos[self.eu][0], vistos[yu][1] - vistos[self.eu][1]) < 300:
                voltando = False              # o anel grosso é a Yuumi aliada presa em mim (minimapa.Detector._yuumi)
            # anel grosso no meu ícone = voltando à base: se ele sumir agora, fui para a fonte; visto na minha base,
            # idem; visto fora dela sem o anel grosso, não estou na base
            na_base = analise.regiao(*vistos[self.eu], self.meu_time) == "base_aliada"
            self.base_t = agora if (voltando or na_base) else None
        for n in self.aliados & set(vistos):
            self.aliados_pos[n] = (agora, *vistos[n])
        n_visiveis = self._agrupados(vistos, mortos)
        vigiadas = self.rotas_vigiadas(agora)
        avisos, intrusos = [], []
        for n in sorted(self.inimigos):
            s = self.st[n]
            if n in mortos:
                # morto não "some" nem "vai" a lugar nenhum: o renascer na fonte não vira "mid indo selva"
                s.visivel, s.perto, s.sumiu_tratado, s.sumiu_avisado = False, set(), True, False
                continue
            if n not in vistos:
                if s.visivel and s.visto is not None and agora - s.visto >= self.SUMIR_S:
                    s.visivel, s.perto = False, set()
                if (n == self.mid and not quieto and s.visto is not None and not s.sumiu_tratado
                        and agora - s.visto >= self.MID_SUMIU_S):
                    s.sumiu_tratado = True
                    motivo = self._mid_sumiu_calado(s, agora, n_visiveis)
                    # libera o "mid indo X" independente do motor aceitar o "sumiu" (intervalo, teto)
                    s.sumiu_avisado = motivo is None or motivo in self.LIBERA_MID_INDO
                    if motivo:
                        self.calados[motivo] += 1
                    else:   # chave fixa: o teto e o intervalo do tipo (TIPOS) valem por partida
                        avisos.append(Aviso("mid_sumiu", {"campeao": self.jog[n].get("campeao", n)}, "mid"))
                continue
            x, y = vistos[n]
            reg, (zc, zt, zf) = zona(x, y, self.meu_time)
            estava_fora = not s.visivel
            fora_s = agora - s.visto if s.visto is not None else None
            # "chegou" = o INIMIGO entrou na faixa (ou reapareceu nela), não eu: quem já estava parado
            # na rota quando o meu ícone chega nela não é intruso (achado de revisão, 13/10/2026)
            perto_todas = {r for r in ("rota_top", "rota_meio", "rota_bot") if perto_da_rota(r, x, y)}
            perto = sorted(r for r in vigiadas if r in perto_todas and (estava_fora or r not in s.perto))
            chegou = bool(perto)
            mid_tinha_sumido = s.sumiu_avisado
            s.visto, s.pos, s.reg, s.visivel, s.perto = agora, (x, y), reg, True, perto_todas
            s.sumiu_avisado = s.sumiu_tratado = False
            if quieto:
                continue
            camp = self.jog[n].get("campeao", n)
            # rota = como a fala chama este inimigo ("o jungler"); o jungler achado pelo Golpear sem posição
            # também é "jungler"
            rota = "jungler" if n == self.jungler else rota_fala(self.jog[n].get("posicao"))
            dados = {"campeao": camp, "rota": rota, "zona": zf, "zc": zc, "zt": zt}
            if chegou and n in self.ocupantes.get(perto[0], ()):
                # morador da rota: só o adversário da MINHA rota (champ select) "voltou"; na rota em que
                # eu só estou de passagem (gank, rotação) ele não é aviso
                if perto[0] == self.minha_rota and estava_fora and fora_s is not None and fora_s >= self.VOLTOU_S:
                    avisos.append(Aviso("adversario_voltou", dados, n))
                continue
            if chegou:
                rz = zona(x, y, self.meu_time)[1] if reg in ("rota_top", "rota_meio", "rota_bot") else \
                    zona(*_centro_rota(perto[0]), self.meu_time)[1]
                intrusos.append((n, {**dados, "zc": rz[0], "zt": rz[1], "zona": rz[2]}, perto[0]))
                continue
            if n == self.jungler and estava_fora and (fora_s is None or fora_s >= self.APARECEU_S):
                if self.importa_para_mim(x, y, agora):
                    avisos.append(Aviso("jungler_apareceu", dados, zc))
                elif self.jungler_longe == "tudo":
                    # longe, falado como o de perto, mas com contagem de intervalo própria (grupo): senão o "longe"
                    # de agora calava o "perto" dos próximos 20 s, o aviso que importa
                    avisos.append(Aviso("jungler_apareceu", dados, f"longe:{zc}", grupo="longe"))
                elif self.jungler_longe == "painel":
                    # longe de onde estou: só a faixa do painel (2ª tela), sem voz nem borda, e abaixo das
                    # informativas (prio < PRIO_INFO): não tira "dragão em um minuto" da faixa
                    avisos.append(Aviso("jungler_apareceu", dados, f"longe:{zc}", destinos="p", cor="azul",
                                        prio=PRIO_JUNGLER_LONGE, grupo="longe"))
            elif n == self.mid and mid_tinha_sumido and reg not in ("rota_meio", "base_inimiga"):
                avisos.append(Aviso("mid_indo", dados, zt))
        # eu na base ou morto (onde_estou: inclui a base presumida da D20): intruso na MINHA rota só com aliado lá, a
        # mesma regra do gank (revisão do passo 8: "nem tinha aliado nenhum meu no top, então não fazia sentido se
        # preocupar"). Quem chegou enquanto eu estava fora já está na rota quando eu voltar: não vira intruso (13/10)
        longe = self.onde_estou(agora)["fonte"] in ("base", "morto") if intrusos else False
        for n, dados, rota in intrusos:
            if longe and not self.aliados_na_rota(rota, agora):
                continue
            perto_agora =[m for m in self.inimigos if m not in self.ocupantes.get(rota, ())
                           and self.st[m].visivel and rota in self.st[m].perto]
            if len(perto_agora) >= 2:
                avisos.append(Aviso("intruso_grupo", {**dados, "n": len(perto_agora)}, rota))
            elif n == self.jungler:
                avisos.append(Aviso("intruso", dados, f"{n}:{rota}", cor="vermelho", urgente=True, prio=95))
            else:
                avisos.append(Aviso("intruso", dados, f"{n}:{rota}"))
        return [a for a in avisos if self.motor.publicar(a, agora)]


ROTA_CURTA_DE = {"rota_top": "top", "rota_meio": "mid", "rota_bot": "bot"}
PRIO_GANK_OUTRA = 75   # gank em outra rota: passa à frente de fala informativa (PRIO_FURA), nunca corta fala
VALIDADE_GANK_OUTRA = MotorAvisos.INTERVALO_VOZ + 2   # s na fila da voz (revisão 14/10/2026: com 6 s vencia mudo)


def decidir_gank(gank, pos=None, reserva=None, agora=None, outras=True):
    """O gank da vez (Aviso) ou None. Calibração 14/10/2026: o gank é de onde o Gabriel ESTÁ, não da rota do
    champ select, e o das outras rotas também fala (ele avisa os colegas).
    gank(rota_curta, alvo_pos) -> dict com "prob" ou None: jungler.EstadoJungler.gank com t e fog já postos;
    alvo_pos = quem seria gankado (o "adiantado" do jungler.py olha para ele; None = não confere).
    pos: AlertasPosicao (onde_estou, aliados_na_rota) ou None; reserva: rota curta do champ select, usada só
    sem `pos`. A minha rota (ícone numa rota, ou a do champ select sem ícone) vence: urgente, vermelho, prio
    100. Morto ou na base, eu não sou alvo. Outra rota só com aliado visto nela (ele é o alvo): a de maior
    massa, amarelo, prio PRIO_GANK_OUTRA, não urgente. Um gank por vez: o jungler não ganka duas rotas.
    outras=False (config gankOutraRota desligada): só a minha rota."""
    minha, minha_pos = reserva, None
    if pos is not None:
        o = pos.onde_estou(agora)
        minha = None if o["fonte"] in ("base", "morto") else ROTA_CURTA_DE.get(o["rota"])
        minha_pos = o["pos"] if o["fonte"] == "icone" else None
    if minha and gank(minha, minha_pos):
        return Aviso("gank", {"zona": f"no {minha}", "zc": minha, "zt": minha}, chave=minha)
    if pos is None or not outras:
        return None
    melhor = None
    for rota, curta in ROTA_CURTA_DE.items():
        if curta == minha:
            continue
        # cada aliado da rota, o mais adiantado primeiro: basta um passar no "adiantado" do jungler.gank
        g = next((g for g in (gank(curta, alvo) for alvo in pos.aliados_na_rota(rota, agora)) if g), None)
        if g and (melhor is None or g.get("prob", 0) > melhor[1].get("prob", 0)):
            melhor = (curta, g)
    if melhor is None:
        return None
    curta = melhor[0]
    # validade ≥ o intervalo da voz: sem urgência ele espera a fala anterior acabar (20 s) em vez de vencer
    # na fila sem ser dito; tom sério sempre ("sai daí" do descontraído é para quem está na rota)
    return Aviso("gank", {"zona": f"no {curta}", "zc": curta, "zt": curta}, chave=f"outra:{curta}",
                 prio=PRIO_GANK_OUTRA, urgente=False, cor="amarelo", tom="serio", validade=VALIDADE_GANK_OUTRA)


def _centro_rota(rota):
    return {"rota_top": (1500, 13500), "rota_meio": (7400, 7400), "rota_bot": (13400, 1500)}[rota]
