# prova da janelinha de "partida encontrada" (plano voz/foco, passo 2b; coletor/aviso_partida.py), sem client:
#   A. contagem (texto_aviso): aceite em min(atraso, 10) pelo timer, sem atraso = até o ready check expirar;
#      alvo + folga sem resposta = o aceite não veio: volta a "expira em" com alerta
#   B. config: coach.aceiteFlutuante e coach.aceiteAtrasoS (padrão, número, null, inválido)
#   C. LCU.post monta POST com a credencial (urlopen trocado: nada vai à rede)
#   D. Coletor.fase com janelinha falsa: abre no ReadyCheck, não duplica, fecha ao sair, chave desligada
#      não abre, erro na janelinha não derruba a fase
#   F. reserva do aceite sem janela (LCU falsa): aceita no alvo + folga, relê antes do POST, não aceita se já
#      Accepted/Declined, "não aceitar" ou desligado no plugin, aceite desligado no espelho, ready check acabado,
#      clique em voo; POST que falha não repete
#   G. rota POST /aceite/plugin num servidor local de teste (porta 8797): origem, sinal gravado, linha no log
#   E. janela real com LCU falsa: estilo sem foco, canto inferior direito, GetForegroundWindow intocado,
#      contagem, botões chamam accept/decline, some ao sair do ReadyCheck sem deixar thread nem janela,
#      fecha sozinha se ninguém fechar, reserva com a janela. Pulado com o jogo aberto ou com --sem-janela.
# uso: python tools/teste-aviso-partida.py [--sem-janela]
import argparse
import asyncio
import ctypes
import ctypes.wintypes as wt
import json
import logging
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from types import SimpleNamespace

sys.stdout.reconfigure(encoding="utf-8")
RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import aviso_partida  # noqa: E402
import coletor  # noqa: E402
import servidor_local  # noqa: E402
from aviso_partida import texto_aviso  # noqa: E402

logging.getLogger("coletor").addHandler(logging.NullHandler())   # o D7 loga de propósito: sem eco no stderr
resultados = []
TMP = Path(tempfile.mkdtemp(prefix="teste-aviso-"))


def caso(nome, ok, detalhe=""):
    resultados.append(bool(ok))
    print(f"{'ok' if ok else 'FALHOU'}  {nome}" + (f"  ({detalhe})" if detalhe else ""), flush=True)


# ---------- A. contagem ----------
def contagem():
    rc = {"state": "InProgress", "playerResponse": "None", "timer": 3}
    e = texto_aviso(rc, 10, 3)
    caso("A1 atraso 10, 3 s decorridos -> aceito em 7 s", e["linha"] == "aceito em 7 s" and e["botoes"], e)
    e = texto_aviso(rc, 10, 3.4)
    caso("A2 3,4 s -> arredonda para cima (7 s)", e["segundos"] == 7, e)
    e = texto_aviso(rc, 15, 0)
    caso("A3 atraso 15 limita a 10 (limite 12 − 2, como o plugin)", e["segundos"] == 10, e)
    e = texto_aviso(rc, None, 3)
    caso("A4 sem aceite automático -> expira em 9 s", e["linha"] == "expira em 9 s" and e["botoes"], e)
    e = texto_aviso(rc, 5, 5.5)
    caso("A5 passou do atraso (dentro da folga) -> aceitando…, botões ficam",
         e["fase"] == "aceitando" and e["botoes"] and "alerta" not in e, e)
    e = texto_aviso(None, 10, 0)
    caso("A6 sem payload ainda (404) -> conta pelo relógio", e["linha"] == "aceito em 10 s", e)
    e = texto_aviso({**rc, "playerResponse": "Accepted"}, 10, 4)
    caso("A7 aceita -> sem botões", not e["botoes"] and e["fase"] == "aceita", e)
    e = texto_aviso({**rc, "playerResponse": "Declined"}, 10, 4)
    caso("A8 recusada -> sem botões", not e["botoes"] and e["fase"] == "recusada", e)
    e = texto_aviso(rc, None, 20)
    caso("A9 depois de 12 s -> expira em 0 s (nunca negativo)", e["segundos"] == 0, e)
    # o espelho do atraso pode mentir (plugin fora do ar, "não aceitar" no overlay): lê o efeito
    e = texto_aviso(rc, 10, 11)
    caso("A10 atraso 10, 11 s sem resposta -> expira em 1 s + alerta (para de prometer)",
         e["fase"] == "sem_aceite" and e["linha"] == "expira em 1 s" and e["botoes"] and e.get("alerta"), e)
    e = texto_aviso(rc, 5, 7)
    caso("A11 atraso 5, 7 s sem resposta -> expira em 5 s + alerta",
         e["fase"] == "sem_aceite" and e["segundos"] == 5 and e.get("alerta"), e)
    e = texto_aviso({**rc, "playerResponse": "Accepted"}, 10, 11)
    caso("A12 aceita depois do alvo -> aceita (sem alerta)", e["fase"] == "aceita" and "alerta" not in e, e)
    e = texto_aviso(rc, None, 11)
    caso("A13 sem aceite automático nunca mostra o alerta", e["fase"] == "expirando" and "alerta" not in e, e)
    av = aviso_partida.AvisoPartida(None, 10, relogio=lambda: 111.0)
    av.inicio, av.rc, av.clicado = 100.0, rc, "aceitar"
    e = av.estado()
    caso("A14 depois do clique o alerta some (POST em voo)", not e["botoes"] and "alerta" not in e, e)


# ---------- B. config ----------
def config():
    arq = TMP / "config.json"
    cfg = servidor_local.ler_config(arq)
    caso("B1 padrões: aceiteFlutuante true, aceiteAtrasoS 10",
         cfg["aceiteFlutuante"] is True and cfg["aceiteAtrasoS"] == 10, (cfg["aceiteFlutuante"], cfg["aceiteAtrasoS"]))
    cfg = servidor_local.salvar_config({"coach": {"aceiteFlutuante": False, "aceiteAtrasoS": 7}}, arq)
    caso("B2 POST do plugin (dentro de coach) grava os dois", cfg["aceiteFlutuante"] is False and cfg["aceiteAtrasoS"] == 7)
    caso("B3 relido do disco", servidor_local.ler_config(arq)["aceiteAtrasoS"] == 7)
    for ruim in ("8", True, -1, 61, float("nan"), [3]):
        cfg = servidor_local.salvar_config({"aceiteAtrasoS": ruim}, arq)
        caso(f"B4 inválido {ruim!r} mantém o atual (7)", cfg["aceiteAtrasoS"] == 7, cfg["aceiteAtrasoS"])
    cfg = servidor_local.salvar_config({"coach": {"aceiteAtrasoS": None}}, arq)
    caso("B5 null = aceite automático desligado", cfg["aceiteAtrasoS"] is None)
    caso("B6 null relido do disco continua null", servidor_local.ler_config(arq)["aceiteAtrasoS"] is None)
    cfg = servidor_local.salvar_config({"aceiteAtrasoS": 4.5}, arq)
    caso("B7 fracionário aceito", cfg["aceiteAtrasoS"] == 4.5)
    arq.write_text(json.dumps({"aceiteAtrasoS": "lixo", "aceiteFlutuante": "sim"}), encoding="utf-8")
    cfg = servidor_local.ler_config(arq)
    caso("B8 arquivo com lixo volta ao padrão", cfg["aceiteAtrasoS"] == 10 and cfg["aceiteFlutuante"] is True, cfg)


# ---------- C. LCU.post ----------
def lcu_post():
    pedidos = []

    class Resp:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b""

    original = coletor.urllib.request.urlopen
    coletor.urllib.request.urlopen = lambda req, context=None, timeout=None: (pedidos.append(req), Resp())[1]
    try:
        lcu = coletor.LCU("4321", "segredo")
        r = lcu.post("/lol-matchmaking/v1/ready-check/accept")
    finally:
        coletor.urllib.request.urlopen = original
    req = pedidos[0] if pedidos else None
    caso("C1 POST na rota certa, com Basic auth, sem corpo",
         req is not None and req.get_method() == "POST"
         and req.full_url == "https://127.0.0.1:4321/lol-matchmaking/v1/ready-check/accept"
         and req.get_header("Authorization", "").startswith("Basic ") and r is None,
         req and (req.get_method(), req.full_url))


# ---------- D. Coletor.fase com janelinha falsa ----------
class LCUFalsa:
    """ready check falso: timer pelo relógio a partir de `timer0`; 1ª leitura dá 404 (como antes do payload)"""

    def __init__(self, timer0=3):
        self.t0 = time.monotonic() - timer0
        self.resp = "None"
        self.posts = []
        self.leituras = 0

    def get(self, caminho, timeout=None):
        if caminho == aviso_partida.ROTA:
            self.leituras += 1
            if self.leituras == 1:
                raise OSError("404 Not attached to a matchmaking queue")
            return {"state": "InProgress", "playerResponse": self.resp, "timer": int(time.monotonic() - self.t0)}
        return None

    def post(self, caminho, corpo=None, timeout=None):
        self.posts.append(caminho)
        if caminho.endswith("/accept"):
            self.resp = "Accepted"
        elif caminho.endswith("/decline"):
            self.resp = "Declined"


def novo_coletor(cfg, fab_aviso=None, lcu=None, rota=False):
    """rota=True: como se o servidor do coach estivesse no ar com /aceite/ pendurado (sinal do plugin, reserva armada);
    sem coach (o padrão destes testes) a reserva fica desarmada"""
    arq = TMP / f"cfg-{time.monotonic_ns()}.json"
    arq.write_text(json.dumps(cfg), encoding="utf-8")
    args = SimpleNamespace(db=str(TMP / "teste.db"), ocioso_min=10, lockfile=None, config=str(arq))
    col = coletor.Coletor(args, None, fab_aviso=fab_aviso)
    if rota:
        col.sinal = aviso_partida.SinalPlugin()
    col.lcu = lcu or LCUFalsa()
    return col


def integracao():
    criados = []

    class AvisoFalso:
        def __init__(self, lcu, atraso, sinal=None, janela=True, reserva=True):
            self.atraso, self.aberto, self.fechado = atraso, False, False
            self.sinal, self.janela, self.reserva = sinal, janela, reserva
            criados.append(self)

        def mostrar(self):
            self.aberto = True

        def fechar(self):
            self.fechado = True

    async def roteiro():
        col = novo_coletor({"aceiteFlutuante": True, "aceiteAtrasoS": 8}, AvisoFalso, rota=True)
        await col.fase("Matchmaking")
        caso("D1 Matchmaking não abre", not criados)
        await col.fase("ReadyCheck")
        await col.fase("ReadyCheck")   # websocket reconectado replica a fase
        caso("D2 ReadyCheck abre uma vez só, com o atraso da config",
             len(criados) == 1 and criados[0].aberto and criados[0].atraso == 8, len(criados))
        await col.fase("ChampSelect")
        caso("D3 sair do ReadyCheck fecha", criados[0].fechado and col.aviso is None)
        await col.fase("Matchmaking")
        await col.fase("ReadyCheck")
        await col.fase("Matchmaking")   # um terceiro recusou: volta à fila
        caso("D4 ready check seguinte abre outra e fecha ao voltar à fila",
             len(criados) == 2 and criados[1].fechado)
        caso("D3b janelinha recebe o sinal do plugin do coletor, janela=True e reserva armada (rota no ar)",
             criados[0].sinal is col.sinal and col.sinal is not None and criados[0].janela is True
             and criados[0].reserva is True)
        col2 = novo_coletor({"aceiteFlutuante": False}, AvisoFalso, rota=True)
        await col2.fase("ReadyCheck")
        caso("D5 aceiteFlutuante false: sem janela, mas a reserva roda (janela=False, atraso 10)",
             len(criados) == 3 and criados[2].janela is False and criados[2].atraso == 10 and criados[2].aberto
             and criados[2].reserva is True)
        await col2.fase("Lobby")
        col2b = novo_coletor({"aceiteFlutuante": False, "aceiteAtrasoS": None}, AvisoFalso, rota=True)
        await col2b.fase("ReadyCheck")
        caso("D5b aceiteFlutuante false e aceite automático desligado: nada abre", len(criados) == 3)
        # sem a rota do plugin no ar (--sem-coach, porta 8765 ocupada): o "não aceitar" não chegaria -> sem reserva
        n = len(criados)
        col2c = novo_coletor({"aceiteFlutuante": False, "aceiteAtrasoS": 10}, AvisoFalso)
        await col2c.fase("ReadyCheck")
        caso("D5c sem rota do plugin e sem janelinha: nada abre (a reserva não roda sozinha)",
             col2c.sinal is None and len(criados) == n and col2c.aviso is None)
        col2d = novo_coletor({"aceiteFlutuante": True, "aceiteAtrasoS": 10}, AvisoFalso)
        await col2d.fase("ReadyCheck")
        caso("D5d sem rota do plugin com janelinha: abre só a janela, reserva=False",
             len(criados) == n + 1 and criados[n].janela is True and criados[n].reserva is False)
        await col2d.fase("Lobby")
        col3 = novo_coletor({"aceiteAtrasoS": None}, AvisoFalso)
        await col3.fase("ReadyCheck")
        caso("D6 padrão liga; null passa None (sem aceite automático)",
             len(criados) == n + 2 and criados[n + 1].atraso is None)
        await col3.fase("Lobby")
        # "não aceitar" do plugin não passa para o próximo ready check: sair da fase zera
        col.sinal.registrar({"evento": "nao-aceitar", "desligadoNestaVez": True})
        await col.fase("Lobby")
        caso("D8 sair do ReadyCheck zera o 'não aceitar' do plugin", col.sinal.nao_aceitar_em is None)

        def quebra(lcu, atraso, **kw):
            raise RuntimeError("janela não nasceu")
        col4 = novo_coletor({}, quebra)
        await col4.fase("ReadyCheck")
        linha = col4.c.execute("select fase from sessoes order by rowid desc limit 1").fetchone()
        caso("D7 janelinha quebrada não derruba a fase (gravada no banco)", linha and linha[0] == "ReadyCheck", linha)
    asyncio.run(roteiro())


# ---------- F. reserva do aceite (sem janela: roda com o jogo aberto) ----------
class LCURegistro(LCUFalsa):
    """LCUFalsa que registra a ordem das chamadas ao ready check ("GET"/"POST <rota>", segundos desde a criação) e
    simula o resto: resposta que muda num instante (o plugin aceitando), ready check que acaba (404) e POST que falha"""

    def __init__(self, timer0=0, resp_em=None, fim_em=None, post_falha=False, reinicio_em=None, reinicio_404=True):
        super().__init__(timer0)
        self.c0 = time.monotonic()
        self.resp_em = resp_em or {}     # {segundos: "Accepted"|"Declined"}
        self.fim_em = fim_em
        self.post_falha = post_falha
        self.reinicio_em = reinicio_em   # outro ready check começa aqui (timer volta a 0), com um 404 antes se reinicio_404
        self.reinicio_404 = reinicio_404
        self.post_timeout = None
        self.ops = []

    def get(self, caminho, timeout=None):
        dt = time.monotonic() - self.c0
        for t, r in self.resp_em.items():
            if dt >= t:
                self.resp = r
        if caminho == aviso_partida.ROTA:
            self.ops.append(("GET", round(dt, 2)))
            if self.fim_em is not None and dt >= self.fim_em:
                raise OSError("404 Not attached to a matchmaking queue")
            if self.reinicio_em is not None and dt >= self.reinicio_em:
                self.reinicio_em = None
                self.t0 = time.monotonic()
                if self.reinicio_404:
                    raise OSError("404 Not attached to a matchmaking queue")
        return super().get(caminho, timeout)

    def post(self, caminho, corpo=None, timeout=None):
        self.post_timeout = timeout
        self.ops.append(("POST " + caminho.rsplit("/", 1)[1], round(time.monotonic() - self.c0, 2)))
        if self.post_falha:
            self.posts.append(caminho)
            raise OSError("500 Internal Server Error")
        return super().post(caminho, corpo, timeout)


def rodar_reserva(lcu, atraso=0.3, sinal=None, s=1.8, antes=None, idade_min_s=0):
    """AvisoPartida sem janela por `s` segundos; alvo 0,3 + folga 0,7 = aceite da reserva em ~1 s. antes(av) roda
    logo depois de mostrar() (ex.: clique em voo). idade_min_s 0: sem a espera do aviso recém-nascido (F26 testa ela)"""
    av = aviso_partida.AvisoPartida(lcu, atraso, sinal=sinal, janela=False, idade_min_s=idade_min_s).mostrar()
    if antes:
        antes(av)
    time.sleep(s)
    av.fechar()
    return av


def reserva():
    from aviso_partida import FOLGA_S, SinalPlugin, alvo_aceite, decidir_reserva
    rc = {"state": "InProgress", "playerResponse": "None", "timer": 3}
    # pura
    caso("F1 decidir: antes do alvo + folga espera (alvo 10, 10,5 s -> 0,2 s)",
         decidir_reserva(rc, 10, 10.5) == {"acao": "esperar", "emS": 10 + FOLGA_S - 10.5})
    caso("F2 decidir: passou do alvo + folga com None -> aceitar", decidir_reserva(rc, 10, 10.8)["acao"] == "aceitar")
    caso("F3 decidir: Accepted/Declined/fora de InProgress/aceite desligado/bloqueio -> parar",
         all(decidir_reserva(r, a, 11, b)["acao"] == "parar" for r, a, b in (
             ({**rc, "playerResponse": "Accepted"}, 10, None), ({**rc, "playerResponse": "Declined"}, 10, None),
             ({**rc, "state": "Invalid"}, 10, None), (rc, None, None), (rc, 10, "não aceitar nesta vez (plugin)"))))
    caso("F4 decidir: sem leitura nenhuma (404) nunca aceita direto", decidir_reserva(None, 10, 11)["acao"] == "esperar")
    caso("F5 alvo igual ao do plugin: min(atraso, 12 − 2)", alvo_aceite(15) == 10 and alvo_aceite(7) == 7
         and alvo_aceite(None) is None)
    caso("F6 folga dentro de [0,5; 1,0] (medição de 14/10/2026 no cabeçalho)", 0.5 <= FOLGA_S <= 1.0, FOLGA_S)
    s = SinalPlugin()
    s.registrar({"atrasoS": 5, "limiteS": 12})
    caso("F7 alvo da reserva = o mais tardio entre espelho e plugin", s.alvo(10) == 10 and s.alvo(3) == 5
         and s.alvo(None) is None)

    # com a LCU falsa e o relógio de verdade
    lcu = LCURegistro()
    av = rodar_reserva(lcu)
    t_post = next((t for o, t in lcu.ops if o.startswith("POST")), None)
    caso("F8 plugin calado: a reserva aceita uma vez, no alvo + folga (~1,0 s, não 0,5 s depois)",
         lcu.posts == ["/lol-matchmaking/v1/ready-check/accept"] and t_post is not None and 0.95 <= t_post <= 1.3
         and av.reserva_fim == "aceitou", (lcu.ops, av.reserva_fim))
    caso("F8b POST da reserva com prazo curto (não congela a consulta)", lcu.post_timeout == aviso_partida.POST_RESERVA_S
         and aviso_partida.POST_RESERVA_S <= 3, lcu.post_timeout)
    i = next(i for i, (o, _) in enumerate(lcu.ops) if o.startswith("POST"))
    caso("F9 GET do ready check logo antes do POST (releitura)", i > 0 and lcu.ops[i - 1][0] == "GET"
         and t_post - lcu.ops[i - 1][1] < 0.1, lcu.ops)
    lcu = LCURegistro(resp_em={0.6: "Accepted"})
    av = rodar_reserva(lcu)
    caso("F10 o plugin aceitou antes: nenhum POST, a reserva registra 'já aceita'",
         lcu.posts == [] and av.reserva_fim == "já aceita", (lcu.ops, av.reserva_fim))
    lcu = LCURegistro(resp_em={0.3: "Declined"})
    av = rodar_reserva(lcu)
    caso("F11 recusada (janelinha ou client): nenhum POST", lcu.posts == [] and av.reserva_fim == "recusada",
         av.reserva_fim)
    # o plugin aceita entre a última consulta e a releitura: a releitura vê e não posta (relógio parado, um passo só)
    lcu = LCURegistro()
    lcu.leituras = 1        # sem o 404 da 1ª leitura
    lcu.resp = "Accepted"   # o que a releitura vai ler
    av = aviso_partida.AvisoPartida(lcu, 0.3, relogio=lambda: 1.5, janela=False)
    av._t0 = av.inicio = 0.0
    av.rc = {"state": "InProgress", "playerResponse": "None", "timer": 1}   # a última consulta ainda dizia None
    av._reserva_passo()
    caso("F12 aceite do plugin no último instante: a releitura vê e não posta",
         lcu.posts == [] and [o for o, _ in lcu.ops] == ["GET"] and av.reserva_fim == "já aceita", (lcu.ops, av.reserva_fim))
    sinal = SinalPlugin()
    lcu = LCURegistro()
    av = rodar_reserva(lcu, sinal=sinal, antes=lambda a: sinal.registrar({"evento": "nao-aceitar", "desligadoNestaVez": True}))
    caso("F13 'não aceitar' do plugin neste ready check: nenhum POST",
         lcu.posts == [] and av.reserva_fim == "não aceitar nesta vez (plugin)", av.reserva_fim)
    caso("F14 com 'não aceitar' a janelinha não promete aceite (conta até expirar, sem alerta)",
         av.estado()["fase"] in ("expirando",) and "alerta" not in av.estado(), av.estado())
    sinal = SinalPlugin()
    sinal.registrar({"desligadoNestaVez": True})
    sinal.nao_aceitar_em -= 5   # chegou 5 s antes deste ready check: era do anterior
    lcu = LCURegistro()
    rodar_reserva(lcu, sinal=sinal)
    caso("F15 'não aceitar' velho (de outro ready check) não trava a reserva",
         lcu.posts == ["/lol-matchmaking/v1/ready-check/accept"], lcu.ops)
    sinal = SinalPlugin()
    lcu = LCURegistro()
    av = rodar_reserva(lcu, sinal=sinal, antes=lambda a: sinal.registrar({"evento": "evento", "ligado": False}))
    caso("F16 aceite desligado no plugin durante o ready check: nenhum POST", lcu.posts == [], av.reserva_fim)
    sinal.zerar()
    lcu = LCURegistro()
    rodar_reserva(lcu, sinal=sinal)
    caso("F17 ligado false de um ready check anterior (zerado na troca de fase) não trava o seguinte",
         lcu.posts == ["/lol-matchmaking/v1/ready-check/accept"], lcu.ops)
    lcu = LCURegistro()
    av = rodar_reserva(lcu, atraso=None)
    caso("F18 aceite automático desligado no espelho (null): nenhum POST", lcu.posts == [], av.reserva_fim)
    lcu = LCURegistro(fim_em=0.75)
    av = rodar_reserva(lcu)
    caso("F19 ready check acabou (404) com a última leitura ainda 'None': a releitura barra, nenhum POST",
         lcu.posts == [] and str(av.reserva_fim).startswith("releitura falhou"), (lcu.ops[-3:], av.reserva_fim))
    lcu = LCURegistro(post_falha=True)
    av = rodar_reserva(lcu)
    caso("F20 POST da reserva falhou: uma tentativa só, botões voltam com o erro",
         len(lcu.posts) == 1 and av.reserva_fim == "falhou" and av.clicado is None and av.erro, (lcu.ops, av.erro))
    lcu = LCURegistro()
    av = rodar_reserva(lcu, antes=lambda a: setattr(a, "clicado", "recusar"))
    caso("F21 clique do Gabriel em voo: a reserva não posta por cima", lcu.posts == [], lcu.ops)
    lcu = LCURegistro(post_falha=True)

    def recusar(a):
        a.exibido = {"botoes": True}   # sem janela não há exibido: o clique exige os botões à vista
        a._clicar("recusar")
    av = rodar_reserva(lcu, antes=recusar)
    caso("F23 'recusar' da janelinha cujo POST falhou: a reserva não aceita por cima",
         lcu.posts == ["/lol-matchmaking/v1/ready-check/decline"] and str(av.reserva_fim).startswith("recusar"),
         (lcu.ops, av.reserva_fim))
    # outro ready check na mesma instância (fase Matchmaking perdida): o início antigo faria a reserva aceitar cedo
    # (alvo 2: sem a correção, POST ~1,2 s depois do 2º ready check começar, em vez de 2,7 s)
    lcu = LCURegistro(reinicio_em=1.2)
    av = rodar_reserva(lcu, atraso=2, s=3.2)
    caso("F24 404 e timer de volta a 0 (outro ready check): a reserva para, nenhum POST",
         lcu.posts == [] and av.reserva_fim == "outro ready check", (lcu.ops, av.reserva_fim))
    lcu = LCURegistro(reinicio_em=1.2, reinicio_404=False)
    av = rodar_reserva(lcu, atraso=2, s=3.2)
    caso("F25 timer que volta sem 404 também é outro ready check: nenhum POST",
         lcu.posts == [] and av.reserva_fim == "outro ready check", (lcu.ops, av.reserva_fim))
    # aviso criado tarde (coletor subiu ou reconectou com o ready check em ~11 s, alvo + folga já passou)
    lcu = LCURegistro(timer0=11)
    av = rodar_reserva(lcu, atraso=10, s=2.2, idade_min_s=1.5)
    t_post = next((t for o, t in lcu.ops if o.startswith("POST")), None)
    caso("F26 aviso criado depois do alvo + folga: espera a idade mínima (1,5 s) antes do POST",
         lcu.posts == ["/lol-matchmaking/v1/ready-check/accept"] and t_post is not None and t_post >= 1.45,
         (lcu.ops, av.reserva_fim))
    sinal = SinalPlugin()
    lcu = LCURegistro(timer0=11)
    av = rodar_reserva(lcu, atraso=10, s=2.2, idade_min_s=1.5, sinal=sinal, antes=lambda a: threading.Timer(
        0.8, sinal.registrar, args=({"evento": "evento", "desligadoNestaVez": True},)).start())
    caso("F26b ... e o 'não aceitar' que chega nessa espera ainda barra", lcu.posts == [], (lcu.ops, av.reserva_fim))
    # "não aceitar" de antes do aviso nascer (websocket reconectado no meio): vale pelo início do ready check
    relo = [100.0]
    sinal = SinalPlugin(relogio=lambda: relo[0])
    sinal.registrar({"evento": "nao-aceitar", "desligadoNestaVez": True})
    av = aviso_partida.AvisoPartida(LCURegistro(), 10, relogio=lambda: relo[0], sinal=sinal, janela=False)
    relo[0] = 105.0
    av._t0, av.inicio = 105.0, 100.2   # aviso nasceu em 105, o timer da LCU diz que o ready check começou em ~100
    caso("F27 bloqueio pelo início do ready check (timer da LCU), não pela hora do aviso",
         av._bloqueio() == "não aceitar nesta vez (plugin)", av._bloqueio())
    # ligado true fora de ordem não desfaz o ligado false (POSTs concorrentes do plugin)
    s = SinalPlugin()
    s.registrar({"evento": "agendou", "ligado": False})
    s.registrar({"evento": "evento", "ligado": True})
    b1 = s.bloqueio(s.relogio() - 5)
    s.registrar({"evento": "fim", "ligado": True, "desligadoNestaVez": False})
    caso("F28 ligado true atrasado não destrava; só o fim do ready check (ou zerar) destrava",
         b1 == "aceite automático desligado no plugin" and s.bloqueio(s.relogio() - 5) is None, b1)
    caso("F29 linha do log sem \\r nem \\n vindos do plugin",
         not any(c in aviso_partida.linha_diag({"evento": "a\rb\nc", "detalhe": "x\r\ny"}) for c in "\r\n"))
    caso("F22 nenhuma thread da reserva viva depois de fechar", not threads_do_aviso(), threads_do_aviso())


# ---------- G. rota /aceite/plugin (servidor local numa porta de teste) ----------
def rota_plugin():
    import urllib.error
    import urllib.request
    from aviso_partida import SinalPlugin
    linhas = []

    class Coletar(logging.Handler):
        def emit(self, rec):
            linhas.append(rec.getMessage())
    h = Coletar(logging.INFO)
    lg = logging.getLogger("coletor.aceite")
    lg.addHandler(h)
    lg.setLevel(logging.INFO)
    coach = SimpleNamespace(srv=servidor_local.ServidorLocal(porta=8797, config=TMP / "cfg-rota.json"),
                            servidor_no_ar=False)
    col = novo_coletor({}, lambda *a, **k: None)
    caso("G0 sem coach (--sem-coach) ou servidor fora do ar (porta ocupada): sem sinal, nada pendurado",
         coletor._sinal_aceite(None) is None and coletor._sinal_aceite(coach) is None
         and "/aceite/" not in coach.srv.rotas_post)
    coach.servidor_no_ar = coach.srv.iniciar()
    if not coach.servidor_no_ar:
        caso("G2 porta de teste 8797 livre", False)
        return
    sinal = coletor._sinal_aceite(coach)
    caso("G1 o coletor pendura /aceite/ no servidor do coach", "/aceite/" in coach.srv.rotas_post and sinal is not None)
    try:
        def post(corpo, origem=None, rota="/aceite/plugin"):
            dados = corpo if isinstance(corpo, bytes) else json.dumps(corpo).encode()
            req = urllib.request.Request(f"http://127.0.0.1:8797{rota}", data=dados, method="POST",
                                         headers={"Content-Type": "application/json", **({"Origin": origem} if origem else {})})
            try:
                with urllib.request.urlopen(req, timeout=5) as r:
                    return r.status
            except urllib.error.HTTPError as e:
                return e.code
        corpo = {"evento": "nao-aceitar", "desligadoNestaVez": True, "ligado": True, "atrasoS": 10, "limiteS": 12,
                 "timer": 4, "hidden": False, "visibilityState": "visible", "foco": False, "lixo": {"x": 1}}
        caso("G2 página do client (https://127.0.0.1:<porta da LCU>) grava o sinal",
             post(corpo, "https://127.0.0.1:54321") == 200 and sinal.nao_aceitar_em is not None)
        caso("G3 Pengu (https://plugins) e pedido sem Origin passam",
             post({"evento": "evento"}, "https://plugins") == 200 and post({"evento": "evento"}) == 200)
        caso("G4 página do próprio coletor (http://127.0.0.1:8797) e outra página local em http são recusadas",
             post(corpo, "http://127.0.0.1:8797") == 403 and post(corpo, "http://localhost:3000") == 403)
        caso("G5 site de fora recusado", post(corpo, "https://exemplo.com") == 403)
        caso("G6 json inválido -> 400; rota desconhecida -> 404",
             post(b"{nao", "https://plugins") == 400 and post({}, "https://plugins", "/aceite/outra") == 404)
        diag = next((ln for ln in linhas if "evento=nao-aceitar" in ln), "")
        caso("G7 diagnóstico vira uma linha no log do coletor (campos conhecidos, sem o resto)",
             "desligadoNestaVez=True" in diag and "visibilityState=visible" in diag and "timer=4" in diag
             and "lixo" not in diag, diag)
    finally:
        coach.srv.parar()
        lg.removeHandler(h)
        col.c.close()


# ---------- E. janela real ----------
u = ctypes.WinDLL("user32", use_last_error=True)
u.GetForegroundWindow.restype = wt.HWND
u.FindWindowW.argtypes = [wt.LPCWSTR, wt.LPCWSTR]
u.FindWindowW.restype = wt.HWND
u.GetWindowLongW.argtypes = [wt.HWND, ctypes.c_int]
u.GetWindowRect.argtypes = [wt.HWND, ctypes.POINTER(wt.RECT)]
u.IsWindowVisible.argtypes = [wt.HWND]
u.GetWindowThreadProcessId.argtypes = [wt.HWND, ctypes.POINTER(wt.DWORD)]
u.GetWindowTextW.argtypes = [wt.HWND, wt.LPWSTR, ctypes.c_int]
u.SystemParametersInfoW.argtypes = [wt.UINT, wt.UINT, ctypes.c_void_p, wt.UINT]


def jogo_aberto():
    try:
        saida = subprocess.run(["tasklist", "/FI", "IMAGENAME eq League of Legends.exe", "/NH"], capture_output=True,
                               text=True, errors="replace", timeout=15,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
    except Exception:
        return True   # na dúvida, não abre janela por cima de quem pode estar jogando
    return "League of Legends.exe" in saida


class Vigia:
    """GetForegroundWindow a cada 20 ms enquanto a janela vive. O Gabriel pode trocar de janela no meio
    (13/10: um teste pegou WhatsApp + uma janela que sumiu): o que reprova é o primeiro plano ir para uma
    janela DESTE processo; troca entre janelas de outros processos só é listada."""

    def __init__(self):
        self.vistos, self.nossos, self._parar = {}, set(), threading.Event()
        self.fio = threading.Thread(target=self._laco, daemon=True)

    def _laco(self):
        meu = os.getpid()
        while not self._parar.is_set():
            h = u.GetForegroundWindow() or 0
            if h not in self.vistos:
                pid = wt.DWORD()
                u.GetWindowThreadProcessId(h, ctypes.byref(pid))
                buf = ctypes.create_unicode_buffer(80)
                u.GetWindowTextW(h, buf, 80)
                self.vistos[h] = (pid.value, buf.value)
                if pid.value == meu:
                    self.nossos.add(h)
            time.sleep(0.02)

    def lista(self):
        return [f"{h:#x} pid {p} {t!r}" for h, (p, t) in self.vistos.items()]

    def __enter__(self):
        self.fio.start()
        return self

    def __exit__(self, *a):
        self._parar.set()
        self.fio.join()


def esperar(cond, s=4.0):
    fim = time.monotonic() + s
    while time.monotonic() < fim:
        if cond():
            return True
        time.sleep(0.05)
    return cond()


def threads_do_aviso():
    return [t.name for t in threading.enumerate() if t.name.startswith("aviso-partida") and t.is_alive()]


def janela_real():
    feitos = []

    def fab(lcu, atraso, **kw):
        a = aviso_partida.AvisoPartida(lcu, atraso, **kw)
        feitos.append(a)
        return a

    async def roteiro():
        # --- aceitar ---
        lcu = LCUFalsa(timer0=3)
        col = novo_coletor({"aceiteFlutuante": True, "aceiteAtrasoS": 10}, fab, lcu)
        frente0 = u.GetForegroundWindow() or 0
        with Vigia() as vg:
            await col.fase("ReadyCheck")
            av = feitos[0]
            caso("E1 janela nasce", av.esperar_pronto(5) and av.hwnd and esperar(lambda: u.IsWindowVisible(av.hwnd)),
                 av.hwnd)
            hwnd = av.hwnd
            ex = u.GetWindowLongW(hwnd, -20) & 0xFFFFFFFF
            caso("E2 estilo NOACTIVATE | TOPMOST | TOOLWINDOW",
                 ex & aviso_partida.ESTILO_EX == aviso_partida.ESTILO_EX, hex(ex))
            caso("E3 achável pelo título", u.FindWindowW(None, aviso_partida.TITULO) == hwnd)
            r, area = wt.RECT(), wt.RECT()
            u.GetWindowRect(hwnd, ctypes.byref(r))
            u.SystemParametersInfoW(0x30, 0, ctypes.byref(area), 0)
            larg, alt = r.right - r.left, r.bottom - r.top
            caso("E4 canto inferior direito da tela principal (até 80 px da borda), tamanho para clicar",
                 0 <= area.right - r.right <= 80 and 0 <= area.bottom - r.bottom <= 80 and larg >= 250 and alt >= 120,
                 f"janela {r.left},{r.top} {larg}x{alt}; área útil até {area.right},{area.bottom}")
            esperar(lambda: lcu.leituras >= 3, 3)
            e = av.exibido or {}
            caso("E5 contagem do aceite (atraso 10, ready check com ~3–5 s)", e.get("fase") == "contando"
                 and 4 <= (e.get("segundos") or 0) <= 7, e.get("linha"))
            av.clicar_por_mensagem("aceitar")
            caso("E6 'aceitar agora' chama POST .../ready-check/accept",
                 esperar(lambda: lcu.posts == ["/lol-matchmaking/v1/ready-check/accept"]), lcu.posts)
            caso("E7 depois de aceitar: 'esperando os outros', sem botões",
                 esperar(lambda: (av.exibido or {}).get("fase") == "aceita"), (av.exibido or {}).get("linha"))
            av.clicar_por_mensagem("recusar")   # botão sumiu: segundo clique não manda nada
            time.sleep(0.4)
            caso("E8 só um POST por ready check", len(lcu.posts) == 1, lcu.posts)
            await col.fase("ChampSelect")
        caso("E9 primeiro plano nunca foi a janelinha nem outra janela deste processo",
             not vg.nossos and hwnd not in vg.vistos, vg.lista())
        if set(vg.vistos) - {frente0}:
            print(f"      aviso: o primeiro plano trocou entre outros programas no meio (usuário?): {vg.lista()}")
        caso("E10 sair do ReadyCheck: nenhuma thread nem janela viva",
             not threads_do_aviso() and not u.FindWindowW(None, aviso_partida.TITULO) and not av.vivo(),
             threads_do_aviso())

        # --- recusar, sem aceite automático ---
        lcu = LCUFalsa(timer0=1)
        col = novo_coletor({"aceiteFlutuante": True, "aceiteAtrasoS": None}, fab, lcu)
        frente0 = u.GetForegroundWindow() or 0
        with Vigia() as vg:
            await col.fase("ReadyCheck")
            av = feitos[1]
            av.esperar_pronto(5)
            esperar(lambda: lcu.leituras >= 3, 3)
            e = av.exibido or {}
            caso("E11 sem aceite automático: conta até o ready check expirar",
                 e.get("fase") == "expirando" and 8 <= (e.get("segundos") or 0) <= 11, e.get("linha"))
            av.clicar_por_mensagem("recusar")
            caso("E12 'recusar' chama POST .../ready-check/decline",
                 esperar(lambda: lcu.posts == ["/lol-matchmaking/v1/ready-check/decline"]), lcu.posts)
            caso("E13 depois de recusar: 'recusada', sem botões",
                 esperar(lambda: (av.exibido or {}).get("fase") == "recusada"), (av.exibido or {}).get("linha"))
            await col.fase("Lobby")
        caso("E14 primeiro plano intocado também no recusar", not vg.nossos, vg.lista())
        if set(vg.vistos) - {frente0}:
            print(f"      aviso: o primeiro plano trocou entre outros programas no meio (usuário?): {vg.lista()}")
        caso("E15 nada vivo depois do Lobby", not threads_do_aviso() and not u.FindWindowW(None, aviso_partida.TITULO))

    asyncio.run(roteiro())

    # --- ninguém fechou (websocket caiu no meio): fecha sozinha ---
    av = aviso_partida.AvisoPartida(LCUFalsa(), 10, vida_max_s=1.5).mostrar()
    av.esperar_pronto(5)
    caso("E16 sem fechar() a janelinha some sozinha depois da vida máxima",
         esperar(lambda: not av.vivo(), 6) and not u.FindWindowW(None, aviso_partida.TITULO))

    # --- o aceite automático prometido não veio (plugin fora do ar): para de prometer e pinta o alerta ---
    avisos_log = []

    class Coletar(logging.Handler):
        def emit(self, rec):
            avisos_log.append(rec.getMessage())
    h = Coletar(logging.WARNING)
    logging.getLogger("coletor.aviso").addHandler(h)
    try:
        # reserva=False: a janela sozinha (o alerta aparece quando a reserva também não aceitou)
        av = aviso_partida.AvisoPartida(LCUFalsa(timer0=5), 2, reserva=False).mostrar()
        av.esperar_pronto(5)
        caso("E17 alvo passou sem resposta: 'expira em', com alerta, botões ficam",
             esperar(lambda: (av.exibido or {}).get("fase") == "sem_aceite", 3)
             and (av.exibido or {}).get("botoes") and (av.exibido or {}).get("alerta"), (av.exibido or {}).get("linha"))
        u.UpdateWindow(av.hwnd)   # força o WM_PAINT com o alerta
        time.sleep(0.3)
        av.fechar()
        caso("E18 pintar o alerta não gera erro na janela", not avisos_log, avisos_log)
        # reserva com a janela: o alvo passou, a reserva aceita e a janelinha mostra "aceita"
        lcu = LCUFalsa(timer0=5)
        av = aviso_partida.AvisoPartida(lcu, 2).mostrar()
        av.esperar_pronto(5)
        caso("E19 reserva com a janela: accept sozinho e a janelinha vai a 'aceita' sem alerta",
             esperar(lambda: (av.exibido or {}).get("fase") == "aceita", 4)
             and lcu.posts == ["/lol-matchmaking/v1/ready-check/accept"], (lcu.posts, (av.exibido or {}).get("linha")))
        av.fechar()
        caso("E20 sem erro na janela com a reserva", not avisos_log, avisos_log)
    finally:
        logging.getLogger("coletor.aviso").removeHandler(h)


def principal():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sem-janela", action="store_true", help="não abre a janela real (parte E)")
    a = ap.parse_args()
    contagem()
    config()
    lcu_post()
    integracao()
    reserva()
    rota_plugin()
    if a.sem_janela:
        print("parte E pulada (--sem-janela)")
    elif jogo_aberto():
        print("parte E pulada: League of Legends.exe aberto (a janelinha apareceria por cima do jogo)")
    else:
        janela_real()
    ok = all(resultados)
    print(f"{sum(resultados)}/{len(resultados)} " + ("ok" if ok else "FALHOU"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(principal())
