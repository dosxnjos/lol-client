# ensaio ponta a ponta do coach (plano v2, integração) sem o client: o coletor de verdade (Coletor +
# coach_vivo.Coach) com uma LCU falsa, o simulador da Live Client tocando a partida gravada
# 3292746609 inteira (temp/gravacao/20261013-071040) e as peças que tocariam tela, som, teclado ou rede
# trocadas por registros:
#   voz        Voz(saida=registro): a fila e o fio são os de verdade, sem som
#   moldura    registro (nada desenha na tela do Gabriel)
#   minimapa   Captura de verdade processando os recortes gravados (1 a cada 10 s de jogo)
#   overlay    OverlayMinimapa de verdade (Tk), escondido (mostrar=False) e sem F8
#   feitiços   LeitorChat de verdade (OCR do Windows) lendo os prints gravados; atalho F9 falso
#   Riot API   carregamento.py de verdade com respostas falsas (nada sai da máquina)
#   mentor     Mentor de verdade com o Claude falso; janela do painel: registro (não abre o Edge)
# Banco: cópia do dados/lol.db em temp/ensaio/ (sem a partida 3292746609, que "chega" pelo backfill no
# EndOfGame como numa partida de verdade). Porta 8766 e simulador em 2996: o coletor real fica intocado.
#   python tools/ensaio-coach.py [--velocidade 10] [--sem-prints] [--seg-1x 30]
import argparse
import asyncio
import io
import json
import logging
import shutil
import sqlite3
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import banco  # noqa: E402
import coach_vivo  # noqa: E402
import coletor  # noqa: E402
import servidor_local  # noqa: E402

GRAV = RAIZ / "temp" / "gravacao" / "20261013-071040"
GID = 3292746609
FIXTURES = RAIZ / "tests" / "fixtures"
SAIDA = RAIZ / "temp" / "ensaio"
log = logging.getLogger("coletor")


# ---------- peças falsas ----------

class LCUFalsa:
    """só GET, com o que a partida gravada tem; o resto dá 404 (como a LCU fora de contexto)"""
    porta = 0
    auth = ""
    ctx = None

    def __init__(self, db):
        c = sqlite3.connect(db)
        meta = dict(c.execute("select chave, valor from meta"))
        c.close()
        nome, _, tag = (meta.get("jogador") or "eu#br1").partition("#")
        self.eu = {"puuid": meta.get("puuid"), "gameName": nome, "tagLine": tag}
        self.partida = json.loads((GRAV / f"partida-{GID}.json").read_text(encoding="utf-8"))
        self.timeline = json.loads((GRAV / f"timeline-{GID}.json").read_text(encoding="utf-8"))
        self.chamadas = []

    def get(self, caminho, timeout=30):
        self.chamadas.append(caminho.split("?")[0])
        if caminho == "/lol-gameflow/v1/session":
            return {"gameData": {"gameId": GID, "queue": {"id": 400}}}
        if caminho == "/lol-ranked/v1/current-ranked-stats":
            return {}
        if caminho == "/lol-patch/v1/game-version":
            return "16.20.1"
        if caminho == "/lol-summoner/v1/current-summoner":
            return self.eu
        if caminho.startswith("/lol-match-history/v1/products/lol/current-summoner/matches"):
            return {"games": {"games": [{"gameId": GID, "gameCreation": self.partida.get("gameCreation")}]}}
        if caminho == f"/lol-match-history/v1/games/{GID}":
            return self.partida
        if caminho == f"/lol-match-history/v1/game-timelines/{GID}":
            return self.timeline
        raise urllib.error.HTTPError(caminho, 404, "Not Found", {}, None)

    def vivo(self):
        return True


class Resposta(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def riot_falsa(campeoes_ids):
    """Riot API falsa: eu = p-eu; spectator com os 10 (runa Perspicácia Cósmica 8347 no Yasuo);
    liga EMERALD para todos; o resto 404 (sem partidas: as tags de histórico ficam vazias)"""
    import riotapi
    chamadas = []

    def abrir(req, timeout=None):
        url = req.full_url
        cam = url.split(".riotgames.com", 1)[1].split("?")[0]
        chamadas.append(cam.rsplit("/", 1)[0])
        ok = lambda d: Resposta(json.dumps(d).encode())  # noqa: E731
        if "/riot/account/" in cam:
            return ok({"puuid": "p-eu"})
        if "/spectator/" in cam:
            ps = [{"puuid": "p-eu" if nome == "Zac" else f"p{i}", "championId": cid, "teamId": tm,
                   "spell1Id": 4, "spell2Id": 11 if nome in ("Zac", "Ekko") else 14,
                   "perks": {"perkIds": [8010, 9111, 9104, 8299, 8347 if nome == "Yasuo" else 8304, 8410]}}
                  for i, (nome, cid, tm) in enumerate(campeoes_ids)]
            return ok({"gameId": GID, "gameQueueConfigId": 400, "participants": ps})
        if "/league/v4/entries/by-puuid/" in cam:
            return ok([{"queueType": "RANKED_SOLO_5x5", "tier": "EMERALD", "rank": "III", "leaguePoints": 40,
                        "wins": 60, "losses": 50, "hotStreak": False}])
        raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
    return riotapi.RiotAPI(chave="RGAPI-ensaio", cache_disco=None, abrir=abrir), chamadas


class Registro:
    """moldura, janela e atalho falsos: só anotam"""

    def __init__(self, nome):
        self.nome, self.eventos, self.ligado = nome, [], True

    def __getattr__(self, k):
        if k.startswith("_"):
            raise AttributeError(k)

        def f(*a, **kw):
            self.eventos.append((time.monotonic(), k, a))
            return self
        return f


def captura_gravada(campeoes_fn, relogio, recortes):
    """minimapa.Captura de verdade, mas o 'print' é o recorte gravado mais recente até o gameTime
    (1 a cada 10 s de jogo). Cada recorte vale como visto naquele instante (visto_em = relógio)."""
    import cv2
    import minimapa

    class CapturaGravada(minimapa.Captura):
        def _laco(self):
            ultimo = None
            loc = None
            while not self._parar.is_set():
                gt = self.relogio()
                cand = [r for r in recortes if r[0] <= gt]
                if cand and cand[-1] is not ultimo:
                    ultimo = cand[-1]
                    img = cv2.imread(str(ultimo[1]), cv2.IMREAD_COLOR)
                    if loc is None:
                        loc = minimapa.achar_mapa(img)
                        self.ret = minimapa.Retangulo(2197, 716, loc.lado) if loc else None
                    if loc is not None and minimapa.jogo_na_tela(img, loc):
                        t0 = time.perf_counter()
                        self.processar(img[loc.top:loc.top + loc.lado, loc.left:loc.left + loc.lado].copy(),
                                       self.campeoes_fn(), gt)
                        dt = (time.perf_counter() - t0) * 1000
                        self.tempo_medio_ms = dt if not self.tempo_medio_ms else 0.9 * self.tempo_medio_ms + 0.1 * dt
                        self.no_ar = True
                    else:
                        self.no_ar = False
                self._parar.wait(0.02)

    return CapturaGravada(campeoes_fn, relogio, pasta_icones=FIXTURES / "minimapa" / "icones")


def leitor_gravado(f, relogio_fn, telas):
    """LeitorChat de verdade (OCR do Windows num PowerShell), lendo o print de tela gravado mais recente"""
    import feiticos
    from PIL import Image

    def captura(caixa=None, monitor=None):
        gt = relogio_fn()
        cand = [t for t in telas if t[0] <= gt] or telas[:1]
        im = Image.open(cand[-1][1]).convert("RGB")
        return im.crop(caixa) if caixa else im
    return feiticos.LeitorChat(f, captura=captura, na_tela=lambda: True,
                               calibracao=SAIDA / "calibracao-chat.json")


def claude_falso(prompt, modelo=None, effort=None, advisor=None, resume=None, timeout=None):
    time.sleep(0.5)
    return {"texto": f"(mentor falso do ensaio) prompt de {len(prompt)} caracteres", "session_id": "sessao-ensaio",
            "duracao_ms": 500, "duracao_api_ms": 400, "modelo_usado": modelo, "custo_usd": 0.0, "erro": None}


# ---------- utilidades ----------

def http(porta, caminho, metodo="GET", corpo=None, cabecalhos=None):
    req = urllib.request.Request(f"http://127.0.0.1:{porta}{caminho}", method=metodo,
                                 data=json.dumps(corpo).encode() if corpo is not None else None,
                                 headers={"Content-Type": "application/json", **(cabecalhos or {})})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            txt = r.read()
            return r.status, (json.loads(txt) if txt else None), dict(r.headers)
    except urllib.error.HTTPError as e:
        txt = e.read()
        return e.code, (json.loads(txt) if txt else None), dict(e.headers)


def sim(porta, comando):
    with urllib.request.urlopen(f"http://127.0.0.1:{porta}{comando}", timeout=5) as r:
        return json.loads(r.read())


def copiar_banco(destino):
    """backup do SQLite (o real está em WAL e aberto pelo coletor): cópia consistente; tira a partida do
    ensaio para ela chegar pelo backfill no EndOfGame"""
    destino.unlink(missing_ok=True)
    src = sqlite3.connect(f"file:{(RAIZ / 'dados' / 'lol.db').as_posix()}?mode=ro", uri=True)
    dst = sqlite3.connect(destino)
    src.backup(dst)
    src.close()
    with dst:
        for t in ("partidas", "participantes", "frames", "eventos", "eog"):
            dst.execute(f"delete from {t} where game_id=?", (GID,))
        for t in ("ao_vivo", "eventos_ao_vivo", "mentor", "previsoes_jungler", "revisoes_jungler"):
            try:
                dst.execute(f"delete from {t} where game_id=?", (GID,))
            except sqlite3.OperationalError:
                pass
    dst.close()


def print_painel(porta, png):
    """print headless do painel (o servidor embute o estado no HTML)"""
    import janela_painel
    edge = janela_painel.achar_edge()
    if not edge:
        return False
    perfil = SAIDA / "edge-headless"
    r = subprocess.run([str(edge), "--headless=new", "--disable-gpu", "--hide-scrollbars", f"--screenshot={png}",
                        "--window-size=1536,960", "--virtual-time-budget=3000", f"--user-data-dir={perfil}",
                        f"http://127.0.0.1:{porta}/"], capture_output=True, timeout=60)
    return r.returncode == 0 and Path(png).exists()


# ---------- ensaio ----------

async def ensaio(a):
    SAIDA.mkdir(parents=True, exist_ok=True)
    db = SAIDA / "lol.db"
    copiar_banco(db)
    cfg_arq = SAIDA / "config.json"
    cfg_arq.unlink(missing_ok=True)
    servidor_local.salvar_config({"painelAoVivo": True, "tomVoz": "serio"}, cfg_arq)

    falas, molduras = [], Registro("moldura")
    janela, atalhos = Registro("janela"), Registro("atalhos")
    recortes = sorted((float(p.stem), p) for p in (GRAV / "minimapa").glob("*.png"))
    telas = sorted((float(p.stem), p) for p in (GRAV / "telas").glob("*.png"))
    primeira = json.loads(open(GRAV / "live.jsonl", encoding="utf-8").readline())
    primeira = primeira.get("dados", primeira)
    c = sqlite3.connect(db)
    ids = {str(n).lower(): i for i, n in c.execute("select id, nome from campeoes where id < 10000")}
    c.close()
    camp_ids = [(p["championName"], ids.get(p["championName"].lower()), 100 if p["team"] == "ORDER" else 200)
                for p in primeira["allPlayers"]]
    api, riot_chamadas = riot_falsa(camp_ids)
    coach_ref = {}

    import carregamento
    import mentor
    import sugestoes
    from overlay_minimapa import OverlayMinimapa
    from voz import Voz
    fab = {
        "voz": lambda lg: Voz(saida=falas.append, log=lg),
        "moldura": lambda lg: molduras,
        "captura": lambda fn, rel: captura_gravada(fn, rel, recortes),
        "overlay": lambda fonte: OverlayMinimapa(lambda: {**(fonte() or {}), "mostrar": False}, atalho=False),
        "atalhos": lambda ao_marcar: atalhos,
        "leitor_chat": lambda f: leitor_gravado(f, lambda: coach_ref["c"].partida.relogio()
                                                if coach_ref["c"].partida else 0, telas),
        "carregamento": lambda **kw: carregamento.Carregamento(api=api, **kw),
        "mentor": lambda d, ler: mentor.Mentor(db=d, ler_live=ler, chamador=claude_falso),
        "janela": lambda url, ligado: janela,
        "estatico": lambda lcu: sugestoes.carregar_estatico(FIXTURES / "jogo-estatico.json"),
        "icones": lambda lcu, ids_: None,
    }
    co = coach_vivo.Coach(db=db, liveclient=f"http://127.0.0.1:{a.porta_sim}", porta=a.porta, config=cfg_arq,
                          fabricas=fab, intervalo=1.0, previsoes_db=SAIDA / "previsoes.db", salvar_mapas=False)
    coach_ref["c"] = co
    assert co.iniciar(), f"porta {a.porta} ocupada"
    args = SimpleNamespace(db=str(db), ocioso_min=10, lockfile=None)
    col = coletor.Coletor(args, co)
    col.lcu = LCUFalsa(db)
    falhas, rel = [], {}

    def conferir(cond, msg):
        print(("ok     " if cond else "FALHOU ") + msg, flush=True)
        if not cond:
            falhas.append(msg)

    # champ select: as sessões gravadas pelo coletor (draft no GET /draft)
    await col.fase("ChampSelect")
    sessoes = [json.loads(ln) for ln in open(GRAV / "champselect.jsonl", encoding="utf-8")]
    for s in [s["session"] for s in sessoes if "session" in s][-25:]:
        await col.evento("x", {"uri": "/lol-champ-select/v1/session", "data": s, "eventType": "Update"})
    st, d, _ = http(a.porta, "/draft")
    dr = (d or {}).get("draft") or {}
    conferir(st == 200 and dr.get("faixa"), f"GET /draft: faixa {dr.get('faixa')}, inimigos "
             f"{[(i.get('campeao'), i.get('rota')) for i in dr.get('inimigos') or []]}")

    # carregamento
    simu = subprocess.Popen([sys.executable, str(RAIZ / "tools" / "simular-liveclient.py"), "--porta", str(a.porta_sim),
                             "--inicio", "carregando", "--velocidade", "1", "--pausado"],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8")
    simu.stdout.readline()
    try:
        await col.fase("InProgress")
        p = co.partida
        conferir(janela.eventos and janela.eventos[-1][1] == "fase", "janela do painel recebeu InProgress")
        sim(a.porta_sim, "/sim/tocar")
        fim = time.time() + 30
        est = {}
        while time.time() < fim:
            await asyncio.sleep(0.5)
            est = co.estado()
            if est.get("partida") and (est.get("carregamento") or {}).get("camada") == "pronto":
                break
        rel["carregando_ok"] = est.get("fase") == "carregando" and len(est.get("jogadores") or []) == 10
        conferir(rel["carregando_ok"], f"carregando: fase {est.get('fase')}, {len(est.get('jogadores') or [])} jogadores")
        car = est.get("carregamento") or {}
        conferir(car.get("camada") == "pronto", f"carregamento.py: camada {car.get('camada')}, previsão "
                 f"{(car.get('previsao') or {}).get('faixa')}, chamadas Riot falsas {len(riot_chamadas)}")
        conferir(bool(est.get("composicao")), f"composição no carregamento: {(est.get('composicao') or {}).get('texto')}")
        conferir(bool(p.f.runas), f"runas do spectator no Feiticos: {len(p.f.runas)} campeões")
        if not a.sem_prints:
            conferir(print_painel(a.porta, SAIDA / "painel-carregamento.png"), "print do painel no carregamento")

        # 1x por um trecho (CPU em tempo real), depois acelera
        sim(a.porta_sim, "/sim/ir?gt=60")
        await asyncio.sleep(2)
        cpu0, w0 = time.process_time(), time.time()
        n0 = len(p.ticks)
        await asyncio.sleep(a.seg_1x)
        cpu1x = (time.process_time() - cpu0) / (time.time() - w0)
        ticks1x = p.ticks[n0:]
        rel["cpu_1x_pct"] = round(100 * cpu1x, 1)
        conferir(cpu1x < 0.25, f"CPU a 1x ({a.seg_1x} s de jogo, 1 leitura/s): {100 * cpu1x:.1f}% de um núcleo; "
                 f"passo do laço p50 {statistics.median(ticks1x):.1f} ms, máx {max(ticks1x):.1f} ms")

        co.av.intervalo = 1.0 / a.velocidade
        sim(a.porta_sim, f"/sim/vel?x={a.velocidade}")
        cpu0, w0 = time.process_time(), time.time()
        alvo_prints = [300, 900, 1500] if not a.sem_prints else []
        mudou_cfg = False
        fases_vistas, avisos_painel = {"carregando"} if rel.get("carregando_ok") else set(), []
        ult_aviso = None
        chaves = set()
        parado_desde = None
        while True:
            await asyncio.sleep(0.25)
            s_ = sim(a.porta_sim, "/sim/estado")
            if s_["indice"] >= s_["total"] - 1:  # a gravação acabou (sem GameEnd): mais 3 s e sai
                parado_desde = parado_desde or time.time()
                if time.time() - parado_desde > 3:
                    break
            est = co.estado()
            if not est.get("partida"):
                continue
            fases_vistas.add(est.get("fase"))
            chaves |= set(est)
            av = est.get("aviso")
            if av and (av.get("tipo"), av.get("chave")) != ult_aviso:
                ult_aviso = (av.get("tipo"), av.get("chave"))
                avisos_painel.append((est.get("gt"), av.get("texto"), av.get("cor")))
            gt = est.get("gt") or 0
            if alvo_prints and gt >= alvo_prints[0]:
                sim(a.porta_sim, "/sim/pausar")
                await asyncio.sleep(1.5)
                conferir(print_painel(a.porta, SAIDA / f"painel-{int(alvo_prints[0])}.png"),
                         f"print do painel aos {int(gt)} s")
                alvo_prints.pop(0)
                sim(a.porta_sim, "/sim/tocar")
            if not mudou_cfg and gt >= 1000:
                mudou_cfg = True
                st, cfg, _ = http(a.porta, "/config", "POST", {"esconderTft": True, "coach": {
                    "tomVoz": "descontraido", "avisosDesligados": {"voz": ["ouro_guardado"], "tela": []}}})
                desl = p.motor.desligados
                conferir(st == 200 and p.motor.tom == "descontraido" and "ouro_guardado" in desl["voz"]
                         and "ouro_guardado" not in desl["tela"],
                         f"POST /config com o cfg do plugin aplicado ao vivo: tom {p.motor.tom}, "
                         f"desligados { {d: sorted(s) for d, s in desl.items()} }")
            if est.get("fase") == "fim":
                break
        cpu_rapido = (time.process_time() - cpu0) / (time.time() - w0)
        ticks = p.ticks
        rel["cpu_rapido_pct"] = round(100 * cpu_rapido, 1)
        conferir(True, f"replay a {a.velocidade}x ({a.velocidade} leituras/s): CPU {100 * cpu_rapido:.1f}% de um núcleo "
                 f"(~{100 * cpu_rapido / a.velocidade:.1f}% por leitura/s); passo p50 {statistics.median(ticks):.1f} ms, "
                 f"p95 {sorted(ticks)[int(0.95 * len(ticks))]:.1f} ms, máx {max(ticks):.0f} ms em {len(ticks)} passos")
        conferir({"carregando", "jogo", "fim"} <= fases_vistas, f"fases vistas no /estado: {sorted(fases_vistas)}")
        faltam = {"aviso", "avisos", "jungler", "selva", "feiticos", "preparo", "carregamento", "jogadores",
                  "objetivos", "rota", "ameaca", "padrao"} - chaves
        conferir(not faltam, f"chaves do /estado: {sorted(chaves & {'aviso', 'avisos', 'jungler', 'selva', 'feiticos', 'preparo', 'carregamento', 'composicao'})}"
                 + (f"; faltam {sorted(faltam)}" if faltam else ""))
        jog = est.get("jogadores") or []
        conferir(len(jog) == 10 and all(j["ouroEstimado"] > 0 for j in jog),
                 f"10 jogadores com ouroEstimado > 0 no fim ({min(j['ouroEstimado'] for j in jog)}–{max(j['ouroEstimado'] for j in jog)})")
        cap = p.cap
        conferir(cap is not None and cap.ultimas, f"minimapa: {len(cap.ultimas) if cap else 0} campeões já vistos, "
                 f"{cap.tempo_medio_ms if cap else 0:.1f} ms/recorte, retângulo {cap.ret.__dict__ if cap and cap.ret else None}")
        conferir(len(p.previsoes) > 50, f"previsões do jungler gravadas a cada 10 s: {len(p.previsoes)}")
        usos = sum(len(v) for v in p.f.usos.values())
        conferir(usos > 0, f"feitiços pelo OCR dos prints gravados: {usos} gasto(s) "
                 f"{sorted({(k[0], k[1]) for k in p.f.usos})}")

        # avisos: sem repetição dentro do `repetir`, voz com >= 20 s entre falas (urgente fura)
        emit = list(p.motor.emitidos)
        voz = [(t, av) for t, dst, av in emit if dst == "voz"]
        rep = []
        for dst in ("voz", "moldura"):
            ult = {}
            for t, d_, av in emit:
                if d_ != dst:
                    continue
                if av.chave in ult and t - ult[av.chave] < av.repetir:
                    rep.append((dst, av.chave, round(t - ult[av.chave], 1)))
                ult[av.chave] = t
        # exceção única aos 20 s (revisão 13/10/2026): alerta de posição passando à frente de fala informativa
        mot = type(p.motor)
        furou = lambda t0, a_, t1, b: (b.furou and a_.prio < mot.PRIO_INFO and b.prio >= mot.PRIO_FURA  # noqa: E731
                                      and t1 - t0 >= mot.FURA_S - 1e-6)
        curtos = [(round(t1), b.tipo) for (t0, a_), (t1, b) in zip(voz, voz[1:])
                  if t1 - t0 < 20 - 1e-6 and not b.urgente and not furou(t0, a_, t1, b)]
        n_furou = sum(1 for (t0, a_), (t1, b) in zip(voz, voz[1:]) if furou(t0, a_, t1, b))
        tipos = {}
        for _, av in voz:
            tipos[av.tipo] = tipos.get(av.tipo, 0) + 1
        conferir(not rep, f"nenhum aviso repetido dentro do intervalo ({len(emit)} emissões)" + (f": {rep[:5]}" if rep else ""))
        conferir(not curtos, f"voz: {len(voz)} falas em {int(est.get('gt', 0)) // 60} min, menor intervalo não urgente "
                 f"{min((t1 - t0 for (t0, a_), (t1, b) in zip(voz, voz[1:]) if not b.urgente and not furou(t0, a_, t1, b)), default=0):.1f} s"
                 f", {n_furou} alerta(s) de posição à frente de fala informativa"
                 + (f"; curtos: {curtos[:5]}" if curtos else ""))
        rel["falas_por_tipo"] = tipos
        rel["faixa_do_painel"] = len(avisos_painel)
        rel["falas"] = [(round(t), av.tipo, av.fala) for t, av in voz]
        # voz pré-gravada (plano voz pré-gravada, passo 3): toda fala sai do catálogo do pacote, fora o texto
        # livre (avisos.LIVRES: regra do coach.py, hoje nenhuma ao vivo); o catálogo é o que o motor leu
        import avisos as A
        cat = set(A.catalogo(p.motor.textos))
        tipo_cfg = lambda t: t if t in A.TIPOS_LIGAVEIS else "regra"  # noqa: E731
        fora = [(round(t), av.tipo, av.fala) for t, av in voz if av.fala not in cat and tipo_cfg(av.tipo) not in A.LIVRES]
        livres = [(round(t), av.tipo, av.fala) for t, av in voz if tipo_cfg(av.tipo) in A.LIVRES]
        rel["falas_fora_do_catalogo"], rel["falas_livres"] = fora, livres
        conferir(bool(voz) and not fora, f"voz: {len(voz) - len(livres)} de {len(voz)} falas dentro do catálogo "
                 f"({len(cat)} falas, versão {A.versao_catalogo(sorted(cat))}); texto livre listado: {livres}"
                 + (f"; FORA: {fora[:5]}" if fora else ""))
        conferir(len(falas) == len(voz) or len(falas) >= len(voz) - 3,
                 f"Voz (fila real, sem som) disse {len(falas)} de {len(voz)} falas emitidas (descartadas por validade: "
                 f"{len(voz) - len(falas)})")
        drag = [t for t, av in voz if av.tipo == "objetivo_60s" and "drag" in av.fala.lower()]
        conferir(bool(drag), f"aviso de dragão 60 s antes: {[round(t) for t in drag]} (abates gravados 508, 845, 1181, 1545, 1871)")

        # fim da partida
        t0 = time.monotonic()
        await col.fase("WaitingForStats")
        conferir(p.cap is None and p.leitor is None and p.ov is None,
                 f"WaitingForStats: captura, OCR e overlay parados em {time.monotonic() - t0:.1f} s")
        t0 = time.monotonic()
        await col.fase("EndOfGame")
        dt = time.monotonic() - t0
        conferir(co.partida is None and not co.av.ativo() and dt < 10, f"EndOfGame: coach desligado em {dt:.1f} s")
        st, d, _ = http(a.porta, "/estado")
        conferir(d == {"partida": False}, f"/estado depois do EndOfGame: {d}")
        sim(a.porta_sim, "/sim/desligar")
        vivas = [t.name for t in threading.enumerate() if t.name.startswith(("ao-vivo", "minimapa", "coach-", "voz",
                                                                              "overlay", "mentor-", "carregamento"))]
        conferir(not vivas, f"threads da partida depois do EndOfGame: {vivas or 'nenhuma'}")
        conferir(janela.eventos[-1][2] == ("EndOfGame",), "janela do painel recebeu EndOfGame (fecha)")
        # o pós-jogo do client pede o contexto no EndOfGame, antes do backfill (5–160 s): o coletor busca na hora
        t0 = time.monotonic()
        st, ctx, _ = http(a.porta, f"/contexto/{GID}")
        conferir(st == 200 and "historico" in (ctx or {}),
                 f"GET /contexto/{GID} logo no EndOfGame (antes do backfill): {st} em {time.monotonic() - t0:.1f} s")

        # partida chega no banco pelo backfill (LCU falsa) -> mentor + revisão
        if col.buscando:
            await asyncio.wait_for(col.buscando, 60)
        await asyncio.sleep(1)
        if co.mentor:
            co.mentor.esperar(10)
        st, m, _ = http(a.porta, f"/mentor/{GID}")
        conferir(st == 200 and m.get("status") == "pronto", f"GET /mentor/{GID}: {st} status {m.get('status')}")
        st, r, _ = http(a.porta, f"/revisao/{GID}")
        rv = (r or {}).get("revisao") or {}
        conferir(st == 200 and rv.get("n"), f"revisão da previsão do jungler: {rv.get('acertos')}/{rv.get('n')} a <= "
                 f"{rv.get('raio')} (precisão {rv.get('precisao')}; {rv.get('n_visto')} minutos com ele visto)")
        st, ctx, _ = http(a.porta, f"/contexto/{GID}")
        conferir(st == 200 and "historico" in (ctx or {}), f"GET /contexto/{GID}: {st}, chaves {sorted(ctx or {})}")
        st, li, _ = http(a.porta, f"/licoes/{GID}")
        conferir(st == 200 and len(li.get("licoes") or []) == 3,
                 f"GET /licoes/{GID}: {[x['id'] for x in (li or {}).get('licoes') or []]}")
        st, _, cab = http(a.porta, "/estado", cabecalhos={"Origin": "https://plugins"})
        conferir(cab.get("Access-Control-Allow-Origin") == "https://plugins", f"CORS da página do client: {cab.get('Access-Control-Allow-Origin')}")
        st, _, cab = http(a.porta, "/config", "OPTIONS", cabecalhos={"Origin": "https://127.0.0.1:61234",
                                                                      "Access-Control-Request-Method": "POST",
                                                                      "Access-Control-Request-Private-Network": "true"})
        conferir(st == 204 and cab.get("Access-Control-Allow-Private-Network") == "true",
                 f"preflight do POST /config: {st}, allow-origin {cab.get('Access-Control-Allow-Origin')}")
        st, _, _ = http(a.porta, "/estado", cabecalhos={"Origin": "https://site-qualquer.com"})
        conferir(st == 403, f"origem de fora recusada: {st}")
        conferir(not any("riotgames" in str(x) for x in col.lcu.chamadas), "LCU falsa só com GET")
        rel["lcu"] = sorted(set(col.lcu.chamadas))
    finally:
        try:
            sim(a.porta_sim, "/sim/desligar")
        except Exception:
            pass
        simu.terminate()
        co.encerrar()
    restos = [t.name for t in threading.enumerate() if t is not threading.main_thread() and not t.daemon
              and not t.name.startswith("asyncio_")]  # asyncio_N = executor do to_thread, fecha no asyncio.run
    conferir(not restos, f"threads não daemon no fim: {restos or 'nenhuma'}")
    (SAIDA / "relatorio.json").write_text(json.dumps(rel, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"falas por tipo: {rel.get('falas_por_tipo')}")
    print(f"{'ok' if not falhas else 'FALHOU'} ({len(falhas)} falha(s)); detalhe em {SAIDA / 'relatorio.json'} e "
          f"{SAIDA / 'ensaio.log'}")
    return 1 if falhas else 0


def principal():
    ap = argparse.ArgumentParser(description="ensaio ponta a ponta do coach com o simulador (sem o client)")
    ap.add_argument("--velocidade", type=float, default=10.0)
    ap.add_argument("--seg-1x", type=float, default=30.0, help="segundos tocados a 1x para medir a CPU")
    ap.add_argument("--porta", type=int, default=8766)
    ap.add_argument("--porta-sim", type=int, default=2996)
    ap.add_argument("--sem-prints", action="store_true", help="não tira os prints headless do painel")
    ap.add_argument("--com-jogo", action="store_true", help="roda mesmo com o jogo aberto (a janela Tk pode roubar foco)")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    # chamado direto, o ensaio escapava da trava do rodar-testes e rodou na partida do Gabriel (13/10/2026)
    if not a.com_jogo and "League of Legends.exe" in subprocess.run(
            ["tasklist", "/FI", "IMAGENAME eq League of Legends.exe"],
            capture_output=True, text=True, errors="replace").stdout:
        print("League of Legends.exe aberto: o ensaio fica para depois da partida (--com-jogo força)")
        return 2
    if (SAIDA / "ensaio.log").exists():
        (SAIDA / "ensaio.log").unlink()
    SAIDA.mkdir(parents=True, exist_ok=True)
    h = logging.FileHandler(SAIDA / "ensaio.log", encoding="utf-8")
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    log.addHandler(h)
    log.setLevel(logging.INFO)
    shutil.rmtree(SAIDA / "edge-headless", ignore_errors=True)
    return asyncio.run(ensaio(a))


if __name__ == "__main__":
    sys.exit(principal())
