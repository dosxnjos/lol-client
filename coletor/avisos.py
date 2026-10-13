# motor de avisos ao vivo do coach (plano v2, passos 12 e 15c): prioridade, validade, anti-spam
# e quem consome (voz, painel da 2ª tela, moldura na tela do jogo). Gatilhos: GatilhosLive (Live
# Client, 1 s) e AlertasPosicao (detecções do minimapa). Contrato: docs/COLETOR.md § Avisos ao vivo.
# Tempo em tudo = gameTime em segundos (RelogioJogo extrapola entre as leituras da Live Client).
# Só stdlib; nada aqui lê memória do jogo nem toca no processo dele.
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
TIPOS = {
    "gank":              dict(prio=100, validade=6, repetir=30, urgente=True, destinos="vpm", cor="vermelho", icone="perigo"),
    "intruso_grupo":     dict(prio=95, validade=6, repetir=15, urgente=True, destinos="vpm", cor="vermelho", icone="perigo"),
    "intruso":           dict(prio=85, validade=6, repetir=15, urgente=False, destinos="vpm", cor="amarelo", icone="perigo"),
    "jungler_apareceu":  dict(prio=80, validade=5, repetir=20, urgente=False, destinos="vpm", cor="vermelho", icone="olho"),
    "mid_indo":          dict(prio=70, validade=6, repetir=20, urgente=False, destinos="vpm", cor="amarelo", icone="seta"),
    "mid_sumiu":         dict(prio=60, validade=8, repetir=30, urgente=False, destinos="vpm", cor="amarelo", icone="interrogacao"),
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

# textos padrão: tipo -> tom -> (fala, rótulo ≤ 3 palavras). Placeholders: {campeao}, {zona}
# (fala: "no rio top"), {zc} (rótulo: "rio top"), {zt} (1 palavra: "rio"), {objetivo}, {n}, {ouro}.
# A versão editável mora no arquivo de lições (seção "Avisos ao vivo", formato em carregar_textos).
TEXTOS = {
    "gank": {"serio": ("gank provável {zona}", "gank {zc}"),
             "descontraido": ("olha o gank {zona}, sai daí", "gank {zc}")},
    "intruso_grupo": {"serio": ("{n} inimigos {zona}", "{n} inimigos {zt}"),
                      "descontraido": ("{n} vindo {zona}, recua", "{n} inimigos {zt}")},
    "intruso": {"serio": ("{campeao} chegando {zona}", "intruso {zc}"),
                "descontraido": ("visita: {campeao} {zona}", "visita {zc}")},
    "jungler_apareceu": {"serio": ("jungler {zona}", "jungler {zc}"),
                         "descontraido": ("achei o {campeao}: {zona}", "jungler {zc}")},
    "mid_indo": {"serio": ("mid saiu da rota: {campeao} {zona}", "mid indo {zt}"),
                 "descontraido": ("{campeao} largou o mid, tá {zona}", "mid indo {zt}")},
    "mid_sumiu": {"serio": ("mid sumiu", "mid sumiu"),
                  "descontraido": ("cadê o {campeao}? mid sumiu", "mid sumiu")},
    "janela_objetivo": {"serio": ("{n} inimigos mortos: {objetivo}", "janela {objetivo}"),
                        "descontraido": ("{n} mortos, bora {objetivo}", "bora {objetivo}")},
    "objetivo_60s": {"serio": ("{objetivo} em um minuto", "{objetivo} 1 min"),
                     "descontraido": ("{objetivo} nasce em um minuto, se prepara", "{objetivo} 1 min")},
    "mortes_cedo": {"serio": ("duas mortes antes dos dez, joga seguro", "joga seguro"),
                    "descontraido": ("tu tá duas mortes antes dos dez, segura a onda", "segura a onda")},
    "adversario_voltou": {"serio": ("{campeao} voltou pra rota", "{campeao} voltou"),
                          "descontraido": ("{campeao} voltou, cuidado", "{campeao} voltou")},
    "inimigo_fed": {"serio": ("{campeao} forte, evita o um contra um", "evita 1x1"),
                    "descontraido": ("{campeao} tá fed, nada de um contra um", "evita 1x1")},
    "ouro_guardado": {"serio": ("{ouro} de ouro guardado, hora de voltar?", "hora de voltar"),
                      "descontraido": ("tá rico: {ouro} de ouro, volta e gasta", "hora de voltar")},
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
    # preenchidos pelo motor
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

    def __init__(self, tom="serio", textos=None, relogio=None, voz=None, moldura=None, log=None):
        self.tom = tom if tom in TONS else "serio"
        self.textos = textos if textos is not None else carregar_textos()[0]
        self.relogio = relogio or time.monotonic
        self.voz, self.moldura, self.log = voz, moldura, log
        self.ligado = {"voz": True, "moldura": True, "painel": True}
        self.desligados = normalizar_desligados(None)
        self.emitidos = deque(maxlen=500)   # (em, destino, Aviso)
        self.suprimidos = Counter()
        self._lock = threading.RLock()
        self._ultimo = {}                   # tipo:chave -> em do último aceito
        self._fila_voz, self._fila_moldura, self._painel = [], [], []
        self._ultima_fala = self._ultima_moldura = float("-inf")
        self._prio_fala = None              # prio da última fala (a regra do FURA_S olha para ela)

    def configurar(self, tom=None, voz=None, moldura=None, painel=None, desligados=None):
        """Liga/desliga pela seção do 7b: tom ('serio'|'descontraido'), destinos e tipos desligados."""
        with self._lock:
            if tom in TONS:
                self.tom = tom
            for k, v in (("voz", voz), ("moldura", moldura), ("painel", painel)):
                if v is not None:
                    self.ligado[k] = bool(v)
            if desligados is not None:
                self.desligados = normalizar_desligados(desligados)

    def _preparar(self, a, agora):
        p = TIPOS.get(a.tipo, TIPO_REGRA)
        a.em = agora if a.em is None else a.em
        a.prio = p["prio"] if a.prio is None else a.prio
        a.cor = a.cor or p["cor"]
        a.urgente = p["urgente"] if a.urgente is None else a.urgente
        a.validade, a.repetir, a.icone = p["validade"], p["repetir"], p["icone"]
        # destinos do aviso só restringem os do tipo (nunca acrescentam: a config é por tipo)
        a.destinos = "".join(d for d in a.destinos if d in p["destinos"]) if a.destinos else p["destinos"]
        if not a.chave.startswith(f"{a.tipo}:"):     # republicar o mesmo Aviso não prefixa de novo
            a.chave = f"{a.tipo}:{a.chave or '-'}"
        moldes = a.textos or self.textos.get(a.molde or a.tipo) or {}
        fala, rotulo = moldes.get(self.tom) or moldes.get("serio") or (a.tipo, a.tipo)
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
            self._ultimo[aviso.chave] = agora
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
        if self._fila_voz:
            a = self._melhor(self._fila_voz)
            desde = agora - self._ultima_fala
            fura = (not a.urgente and desde < self.INTERVALO_VOZ and a.prio >= self.PRIO_FURA and desde >= self.FURA_S
                    and self._prio_fala is not None and self._prio_fala < self.PRIO_INFO)
            if desde >= self.INTERVALO_VOZ or a.urgente or fura:
                self._fila_voz.remove(a)
                self._ultima_fala, self._prio_fala = agora, a.prio
                a.furou = fura
                self._emitir(agora, "voz", a)

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
    Feiticos.marcar); "overlay" = F8 (estado "ligado"/"desligado"). rota = feiticos.ROTA_FALA (top,
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
    m = "top" if y > x else "bot"
    return reg, {
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


def perto_da_rota(rota, x, y, margem=MARGEM_ROTA):
    a = analise
    if x * x + y * y < a.R_BASE ** 2 or (a.XMAX - x) ** 2 + (a.YMAX - y) ** 2 < a.R_BASE ** 2:
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
                    avisos.append(Aviso("inimigo_fed", {"campeao": jog[nome]["campeao"]}, f"{nome}:{k}"))

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
    sumiu_avisado: bool = False


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
    """
    SUMIR_S = 3.0      # sem detecção por 3 s = fora de vista (a detecção pisca entre quadros)
    APARECEU_S = 8.0   # jungler: só "apareceu" depois de 8 s fora de vista (ou o 1º avistamento)
    MID_SUMIU_S = 6.0  # mid sem detecção por 6 s (fora da base dele e vivo) = "mid sumiu"
    VOLTOU_S = 20.0   # adversário fora de vista ≥ 20 s que reaparece perto da rota = voltou
    RESYNC_S = 2.0     # depois de uma pausa (quadros inválidos) só observa, sem alertar
    FRESCO_S = 0.6     # detecção com visto_em mais velho que isto = posição antiga, não visível agora

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
        self.minha_pos = None
        self._invalido = False
        self._resync_ate = float("-inf")

    @classmethod
    def do_live(cls, motor, dados):
        eu, jog, _ = jogadores_do_live(dados)
        return cls(motor, eu, (jog.get(eu) or {}).get("time"), jog)

    def rotas_vigiadas(self):
        """Rota do meu ícone, se ele estiver numa rota; senão a posição do champ select; jungler
        sem ícone visto numa rota não vigia nada."""
        if self.minha_pos:
            reg, _ = zona(*self.minha_pos, self.meu_time)
            if reg in ("rota_top", "rota_meio", "rota_bot"):
                return {reg}
        r = ROTA_DA_POSICAO.get(self.minha_posicao)
        return {r} if r else set()

    def _nome(self, d):
        c = d.get("campeao")
        if c in self.jog:
            return c
        t = time_num(d.get("time"))
        alvo = [n for n, p in self.jog.items() if (p.get("campeao") or n) == c and (t is None or p["time"] == t)]
        return alvo[0] if alvo else None

    def observar(self, deteccoes, agora=None, quadro_valido=True, mortos=()):
        agora = self.motor.relogio() if agora is None else agora
        if not quadro_valido:
            self._invalido = True
            return []
        if self._invalido:
            self._invalido = False
            self._resync_ate = agora + self.RESYNC_S
        quieto = agora < self._resync_ate
        vistos = {}
        for d in deteccoes or []:
            if d.get("visto_em") is not None and agora - float(d["visto_em"]) > self.FRESCO_S:
                continue                      # última posição antiga (Captura.deteccoes()): não está visível agora
            n = self._nome(d)
            if n and n not in vistos:
                vistos[n] = (float(d["x"]), float(d["y"]))
        if self.eu in vistos:
            self.minha_pos = vistos[self.eu]
        vigiadas = self.rotas_vigiadas()
        avisos, intrusos = [], []
        for n in sorted(self.inimigos):
            s = self.st[n]
            if n in mortos:
                s.visivel, s.perto, s.sumiu_avisado = False, set(), True
                continue
            if n not in vistos:
                if s.visivel and s.visto is not None and agora - s.visto >= self.SUMIR_S:
                    s.visivel, s.perto = False, set()
                if (n == self.mid and not quieto and s.visto is not None and not s.sumiu_avisado
                        and agora - s.visto >= self.MID_SUMIU_S and s.reg != "base_inimiga"):
                    s.sumiu_avisado = True
                    avisos.append(Aviso("mid_sumiu", {"campeao": self.jog[n].get("campeao", n)}, f"{int(s.visto)}"))
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
            s.visto, s.pos, s.reg, s.visivel, s.perto, s.sumiu_avisado = agora, (x, y), reg, True, perto_todas, False
            if quieto:
                continue
            camp = self.jog[n].get("campeao", n)
            dados = {"campeao": camp, "zona": zf, "zc": zc, "zt": zt}
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
                avisos.append(Aviso("jungler_apareceu", dados, zc))
            elif n == self.mid and mid_tinha_sumido and reg not in ("rota_meio", "base_inimiga"):
                avisos.append(Aviso("mid_indo", dados, zt))
        for n, dados, rota in intrusos:
            perto_agora = [m for m in self.inimigos if m not in self.ocupantes.get(rota, ())
                           and self.st[m].visivel and rota in self.st[m].perto]
            if len(perto_agora) >= 2:
                avisos.append(Aviso("intruso_grupo", {**dados, "n": len(perto_agora)}, rota))
            elif n == self.jungler:
                avisos.append(Aviso("intruso", dados, f"{n}:{rota}", cor="vermelho", urgente=True, prio=95))
            else:
                avisos.append(Aviso("intruso", dados, f"{n}:{rota}"))
        return [a for a in avisos if self.motor.publicar(a, agora)]


def _centro_rota(rota):
    return {"rota_top": (1500, 13500), "rota_meio": (7400, 7400), "rota_bot": (13400, 1500)}[rota]
