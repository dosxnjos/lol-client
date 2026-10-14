# coach ao vivo (plano v2, integração): liga os módulos das frentes ao gameflow do coletor e ao laço
# de 1 s do ao_vivo.py. Uma instância por processo (o coletor); um _Partida por partida.
#   carregamento (Live Client com gameTime ~0) -> carregamento.py (Riot API) + composição/build no painel
#   InProgress -> laço ao vivo, minimapa/jungler/selva/overlay, avisos/voz/moldura, feitiços, sugestões,
#                 processo abaixo do normal
#   WaitingForStats/PreEndOfGame -> para o que olha a tela (captura, overlay, OCR, atalho, moldura)
#   EndOfGame (ou qualquer fase fora do jogo) -> para tudo, grava as previsões do jungler
#   partida no banco -> mentor (pós-jogo) e revisão da previsão do jungler
# Cada módulo respeita a sua chave da config (servidor_local.CONFIG_PADRAO), lida em cada InProgress
# e reaplicada quando o plugin faz POST /config. Linha que não se cruza: nada lê memória do jogo,
# injeta, envia tecla ou mostra o que está na fog (os módulos só leem API local, LCU e print do monitor).
import asyncio
import json
import logging
import queue
import sqlite3
import threading
import time
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ao_vivo  # noqa: E402
import avisos  # noqa: E402
import banco  # noqa: E402
import janela_painel  # noqa: E402
import servidor_local  # noqa: E402

log = logging.getLogger("coletor.coach")
FASES_LIGA = ("InProgress", "Reconnect")
FASES_TELA_FORA = ("WaitingForStats", "PreEndOfGame")   # jogo acabou, client ainda no fim da partida
OCR_S = 3.0              # passo do OCR do chat (feitiços)
PREVISAO_S = 10          # uma previsão do jungler gravada a cada 10 s de gameTime (revisão no pós-jogo)
ROTA_CURTA = {"TOP": "top", "MIDDLE": "mid", "BOTTOM": "bot", "UTILITY": "bot"}
GANK_OUTRA_S = 30.0   # gank de outra rota: no máximo 1 a cada 30 s de jogo (o da minha rota não espera)
ESQUEMA_PREVISAO = """
create table if not exists previsoes_jungler (
  game_id integer, gt real, campeao text, x real, y real, visto_ha real, zona text, p real,
  primary key (game_id, gt));
create table if not exists revisoes_jungler (
  game_id integer primary key, ts integer, campeao text, n integer, acertos integer, precisao real,
  n_visto integer, raio integer, json text);
"""


def _time_str(t):
    return "ORDER" if t in (100, "100", "ORDER") else "CHAOS"


def _resumo_estatico(est):
    v = str((est or {}).get("versao") or "?").split("+")[0]
    return f"versão {v}, {len((est or {}).get('campeoes') or {})} campeões, {len((est or {}).get('feiticos') or {})} feitiços"


class _Avisa:
    """warning de uma seção no máximo 1 vez por minuto (o laço roda a 1 Hz: sem isso o log enche)"""

    def __init__(self):
        self.ultimo = {}

    def __call__(self, secao, e):
        agora = time.monotonic()
        if agora - self.ultimo.get(secao, -1e9) >= 60:
            self.ultimo[secao] = agora
            log.warning("coach: %s falhou: %s: %s", secao, type(e).__name__, e)


# ---------- fábricas (o ensaio troca por versões que não tocam a tela, o som nem o teclado) ----------

def _voz(log_):
    from voz import Voz
    return Voz(log=log_)


def _moldura(log_):
    from moldura import Moldura
    return Moldura(log=log_)


def _captura(campeoes_fn, relogio):
    import minimapa
    return minimapa.Captura(campeoes_fn, relogio)


def _overlay(fonte):
    import overlay_minimapa
    return overlay_minimapa.OverlayMinimapa(fonte)


def _atalhos(ao_marcar):
    import feiticos
    return feiticos.Atalhos(ao_marcar)


def _leitor_chat(f):
    import feiticos
    return feiticos.LeitorChat(f)


def _carregamento(**kw):
    import carregamento
    return carregamento.Carregamento(**kw)


def _mentor(db, ler_live):
    import mentor
    return mentor.Mentor(db=db, ler_live=ler_live)


def _janela(url, ligado):
    return janela_painel.JanelaPainel(url=url, ligado=ligado)


def _estatico(lcu):
    import sugestoes
    return sugestoes.carregar_estatico(lcu=lcu)


def _icones(lcu, ids):
    import minimapa
    minimapa.baixar_icones(lcu, ids)


def _vitrine(coach, game_id, relogio):
    """modo vitrine (tools/vitrine.py): marca na pasta do banco (dados/ no coletor; o ensaio e os testes
    usam banco em temp/ e nunca consomem a marca do Gabriel). None = desligada"""
    import vitrine
    return vitrine.da_partida(Path(coach.db).parent / vitrine.MARCA_NOME, game_id, relogio)


FABRICAS = {"voz": _voz, "moldura": _moldura, "captura": _captura, "overlay": _overlay, "atalhos": _atalhos,
            "leitor_chat": _leitor_chat, "carregamento": _carregamento, "mentor": _mentor, "janela": _janela,
            "estatico": _estatico, "icones": _icones, "vitrine": _vitrine}


# ---------- uma partida ----------

class _FeiticosTravado:
    """o LeitorChat só chama processar_linhas: aqui ele passa pela trava (o laço e o atalho mexem junto)
    e sempre na tabela atual (o dado estático pode refazer o Feiticos no meio da partida)"""

    def __init__(self, p):
        self.p = p

    def processar_linhas(self, textos, gt=None):
        with self.p.trava_f:
            return self.p.f.processar_linhas(textos, gt)


class _Partida:
    """o que vive só durante uma partida; criado em Coach.iniciar_partida, desfeito em parar()"""

    def __init__(self, coach, game_id, fila, cfg):
        self.coach, self.game_id, self.fila, self.cfg = coach, game_id, fila, cfg
        fab = coach.fab
        self.relogio = avisos.RelogioJogo()
        self.voz = fab["voz"](log)
        self.moldura = fab["moldura"](log)
        self.motor = avisos.MotorAvisos(tom=cfg["tomVoz"], relogio=self.relogio, voz=self.voz,
                                        moldura=self.moldura, log=log)
        self.vitrine = None
        try:
            self.vitrine = fab["vitrine"](coach, game_id, self.relogio)
            if self.vitrine is not None:
                self.vitrine.tipo_aviso = self._tipo_na_moldura
                self.moldura.ao_mostrar = self.vitrine.moldura
        except Exception as e:
            coach.avisa("vitrine", e)
        self.live = avisos.GatilhosLive(self.motor)
        self.pos = None                   # AlertasPosicao: no 1º allgamedata com GameStart
        self.estatico = None              # sugestoes.carregar_estatico (cache; LCU refaz por patch em thread)
        self.f = None                     # feiticos.Feiticos
        self.trava_f = threading.Lock()   # Feiticos é tocado pelo laço, pelo OCR e pelo atalho
        self.picos = None
        self.leitor = self.atalhos = None
        self.cap = self.gv = self.jg = self.ov = None
        self.vel_base = None
        self.campeoes = {"meu_time": None, "campeoes": [], "mortos": []}
        self.icones_pedidos = False
        self.previsoes = []
        self.balde_prev = None
        self.gank_outra_em = float("-inf")   # gameTime do último gank de OUTRA rota publicado (1 a cada GANK_OUTRA_S)
        self.runas_ok = False
        self.parando = threading.Event()
        self.tela_parada = threading.Event()
        self.threads = []
        self.ticks = []                   # duração de cada passo do laço (ms), para o ensaio medir
        self._fonte_ov = None             # overlay_minimapa.fonte_jungler, quando cap e jungler existem
        self._n_retorno = 0               # chave única de cada retorno de atalho (F8/F7) e do chat
        # o retorno sai da thread que observa a tecla por esta fila: publicar pode esperar a janela da moldura
        # nascer (até 5 s), e a thread do F7 parada perderia batidas, o segurar e o fim da janela de 1,2 s
        self._fila_retorno = queue.Queue()
        self._thread(self._laco_retorno, "coach-retorno")
        self._carregar_estatico()        # antes da config: o OCR e o atalho precisam do Feiticos
        self.configurar(cfg, inicio=True)

    # -- montagem --
    def _thread(self, alvo, nome):
        t = threading.Thread(target=alvo, name=nome, daemon=True)
        self.threads.append(t)
        t.start()
        return t

    def _carregar_estatico(self):
        """cache na hora; com LCU, refaz em thread quando o patch muda (~175 GETs só leitura)"""
        try:
            self.estatico = self.coach.fab["estatico"](None)
        except Exception as e:
            # o Coach.fase já monta o cache antes da partida (1ª fase com client); chegar aqui sem ele =
            # coletor ligado no meio do carregamento ou LCU fora: o refazer abaixo grava em segundos
            log.info("coach: dado estático sem cache (%s); feitiços com recarga padrão até a LCU montar",
                     type(e).__name__)
        self._montar_feiticos()
        if self.coach.lcu is not None:
            def atualizar():
                try:
                    with self.coach.trava_estatico:   # o aquecimento do Coach.fase pode estar montando agora
                        est = self.coach.fab["estatico"](self.coach.lcu)
                    if not self.parando.is_set():
                        veio_agora = self.estatico is None
                        self.estatico = est
                        self._montar_feiticos()
                        if veio_agora:
                            log.info("coach: dado estático da LCU pronto no meio da partida (%s)", _resumo_estatico(est))
                except Exception as e:
                    self.coach.avisa("dado estático", e)
            self._thread(atualizar, "coach-estatico")

    def _montar_feiticos(self):
        import feiticos
        import sugestoes
        est = self.estatico
        with self.trava_f:
            novo = feiticos.Feiticos(recarga_base=est["feiticos"] if est else None,
                                     campeao_id=feiticos.ids_por_nome(est) if est else None)
            if self.f is not None:  # troca a tabela sem perder o que já foi marcado
                novo.usos, novo.anunciados, novo.runas = self.f.usos, self.f.anunciados, self.f.runas
                novo._sem_usou = self.f._sem_usou
                novo._pilha_f7 = self.f._pilha_f7   # sem ela o segurar F7 não desfaz nada depois da troca
                # a rota onde a 1ª batida do F7 começa e a última leitura do chat (sem elas, o atalho fica mudo até o próximo laço)
                novo.minha_posicao, novo.ultima_leitura = self.f.minha_posicao, self.f.ultima_leitura
            self.f = novo
        self.picos = sugestoes.PicosDeForca(est["lendarios"]) if est else None

    def configurar(self, cfg, inicio=False):
        """aplica a config: no início e a cada POST /config (thread do servidor)"""
        self.cfg = cfg
        self.motor.configurar(tom=cfg["tomVoz"], voz=cfg["voz"], moldura=cfg["alertasTela"],
                              desligados=cfg["avisosDesligados"],
                              cortar_repetida=cfg.get("cortarFalaRepetida", True))
        self._configurar_pos()
        if not cfg["voz"] and not inicio:
            try:
                self.voz.desligar()
            except Exception:
                pass
        elif cfg["voz"] and hasattr(self.voz, "ligado"):
            self.voz.ligado = True
        self._ligar_minimapa(cfg["minimapa"])
        if self.ov is not None:
            self.ov.ligado = bool(cfg["overlayMinimapa"])
            self._estilo_overlay()
        elif cfg["minimapa"] and cfg["overlayMinimapa"] and self.cap is not None:
            self._ligar_overlay()
        self._ligar_feiticos(cfg["feiticos"])

    def _configurar_pos(self):
        """escolhas do "mid sumiu" e do jungler longe no AlertasPosicao, que nasce só no 1º allgamedata com
        GameStart (depois do configurar do início): chamado no configurar e ao criar o self.pos"""
        if self.pos is not None:
            self.pos.configurar(filtro_mid=self.cfg.get("midSumiuFiltro", True),
                                jungler_longe=self.cfg.get("junglerLonge", "painel"))

    def _estilo_overlay(self):
        """cor, força e transição da mancha (overlayCor/overlayForca/overlaySuave) na janela do overlay"""
        try:
            import overlay_minimapa
            self.ov.aplicar_estilo(overlay_minimapa.estilo(self.cfg.get("overlayCor", "vermelho"),
                                                           self.cfg.get("overlayForca", "normal"),
                                                           self.cfg.get("overlaySuave", True)))
        except Exception as e:
            self.coach.avisa("estilo do overlay", e)

    def _ligar_minimapa(self, sim):
        if sim and self.cap is None and not self.tela_parada.is_set():
            try:
                import alcance
                self.cap = self.coach.fab["captura"](lambda: self.campeoes, self.relogio)
                self.gv = alcance.GradeViva(lambda: self.cap.quadros, self.coach.patch or "?",
                                            salvar=self.coach.salvar_mapas)
                self.vel_base = alcance.velocidades_base()
                self.cap.iniciar()
                log.info("coach: minimapa ligado")
            except Exception as e:
                self.coach.avisa("minimapa", e)
                self.cap = None
        elif not sim and self.cap is not None:
            self._parar_minimapa()

    def _parar_minimapa(self):
        cap, self.cap = self.cap, None
        ov, self.ov = self.ov, None
        for peca in (ov, cap):   # a janela do overlay fecha no WM_CLOSE (na hora); a captura no próximo ciclo
            if peca is None:
                continue
            peca.parar()
            t = getattr(peca, "_thread", None)
            if t is not None and t is not threading.current_thread():
                t.join(3)
        self.jg = self.gv = None
        self._fonte_ov = None

    def _ligar_overlay(self):
        def fonte():
            if self.cap is None or self.jg is None or self._fonte_ov is None:
                return None
            return self._fonte_ov()
        try:
            self.ov = self.coach.fab["overlay"](fonte)
            self.ov.ligado = bool(self.cfg["overlayMinimapa"])
            self._estilo_overlay()
            self.ov.ao_alternar = self._overlay_alternado   # F8: "overlay ligado/desligado" na moldura
            if self.vitrine is not None:
                self.ov.ao_desenhar = self.vitrine.overlay
            self.ov.iniciar()
        except Exception as e:
            self.coach.avisa("overlay", e)
            self.ov = None

    def _ligar_feiticos(self, sim):
        if sim and self.leitor is None and not self.tela_parada.is_set():
            try:
                self.leitor = self.coach.fab["leitor_chat"](_FeiticosTravado(self))
                self._thread(self._laco_ocr, "coach-ocr")
            except Exception as e:
                self.coach.avisa("OCR do chat", e)
            try:
                at = self.coach.fab["atalhos"](self._atalho)
                at.ao_selecionar = self._selecionado   # cada batida do F7: "flash: mid?" na moldura
                at.ao_desfazer = self._desfazer          # segurar F7 sem seleção
                at.ao_cancelar = self._cancelado         # segurar F7 no meio das batidas
                at.n_proprio = self._n_proprio   # a 1ª batida seleciona o adversário da minha rota
                self.atalhos = at.iniciar()
            except Exception as e:  # sem o atalho a partida segue (o chat continua)
                self.coach.avisa("atalho F7", e)
                self.atalhos = None
        elif not sim:
            self._parar_feiticos()

    def _parar_feiticos(self):
        leitor, self.leitor = self.leitor, None
        at, self.atalhos = self.atalhos, None
        if at is not None:
            try:
                at.parar()
            except Exception as e:
                self.coach.avisa("atalho F7", e)
        if leitor is not None:
            try:
                leitor.parar()
            except Exception as e:
                self.coach.avisa("OCR do chat", e)

    # -- atalhos (threads que observam o teclado, teclas.py): todo aperto tem retorno na moldura (e voz, quando marca) --
    def _retorno(self, evento, **kw):
        """chamado das threads do F7/F8 e do OCR: só enfileira (nunca bloqueia quem observa a tecla), em ordem"""
        self._n_retorno += 1
        self._fila_retorno.put(avisos.aviso_atalho(evento, self._n_retorno, **kw))

    def _laco_retorno(self):
        while not self.parando.is_set():
            try:
                a = self._fila_retorno.get(timeout=0.5)
            except queue.Empty:
                continue
            try:
                self.motor.publicar(a)
            except Exception as e:
                self.coach.avisa("retorno do atalho", e)

    def _selecionado(self, n):
        with self.trava_f:
            p = self.f.previa(n) if self.f is not None else {"rota": "?", "feitico": "flash"}
        self._retorno("selecionado", rota=p["rota"], feitico=p["feitico"])

    def _desfazer(self):
        with self.trava_f:
            r = self.f.desfazer(self.relogio()) if self.f is not None else {"resultado": "nada_a_desfazer"}
        log.info("coach: F7 segurado -> %s (%s, %s)", r["resultado"], r.get("inimigo"), r.get("feitico"))
        self._retorno(r["resultado"], rota=r.get("rota"), feitico=r.get("feitico"))

    def _cancelado(self):
        self._retorno("cancelado")

    def _n_proprio(self):
        with self.trava_f:
            return self.f.n_adversario() if self.f is not None else None

    def _atalho(self, n):
        with self.trava_f:
            r = self.f.marcar(n, self.relogio())
        log.info("coach: atalho %d -> %s (%s, %s, %s)", n, r["resultado"], r["rota"], r["inimigo"], r["feitico"])
        self._retorno(r["resultado"], rota=r["rota"], feitico=r["feitico"])

    def _overlay_alternado(self, ligado):
        self._retorno("overlay", estado="ligado" if ligado else "desligado")

    def _laco_ocr(self):
        while not self.parando.wait(OCR_S):
            leitor = self.leitor
            if leitor is None:
                return
            if self.relogio() <= 0:
                continue
            try:
                novos = leitor.passo(self.relogio())   # OCR fora da trava; só o registro do gasto a usa
                self._lido_no_chat(novos)
            except Exception as e:
                self.coach.avisa("OCR do chat", e)

    def _lido_no_chat(self, novos):
        """gasto NOVO lido no chat (o processar_linhas já tira a repetição da linha que segue na tela): log com o
        ping interpretado (campeão inimigo e feitiço, nunca a linha crua: tem nome de jogador) e retorno na moldura,
        como o do F7 ("top sem flash", verde, só no tempo ocioso). Antes só havia "N gasto(s)" a cada 3 s pelo mesmo
        ping e nada na tela: o Gabriel não tinha como saber se o coach pegou (partida 3293149183)."""
        from feiticos import mmss
        with self.trava_f:
            leitura = dict(getattr(self.f, "ultima_leitura", None) or {})
            # consome: o LeitorChat.passo volta [] sem ler (jogo fora da tela) e a leitura velha relogaria a cada 3 s
            self.f.ultima_leitura = {"novos": 0, "confirmados": 0, "sem_usou": []}
            rotas = {u["inimigo"]: self.f.rota_de(u["inimigo"]) for u in novos or []}
        for p in leitura.get("sem_usou") or []:
            log.info("coach: chat -> ping sem 'usou' ignorado: %s %s às %s", p["inimigo"], p["feitico"], mmss(p["ts"]))
        for u in novos or []:
            log.info("coach: chat -> gasto novo: %s %s às %s (%s; %d repetido(s) no mesmo print)", u["inimigo"],
                     u["feitico"], mmss(u["ts"]), rotas[u["inimigo"]], leitura.get("confirmados", 0))
            self._retorno("chat", rota=rotas[u["inimigo"]], feitico=u["feitico"])

    # -- passo do laço (thread do ao_vivo, 1 Hz) --
    def passo(self, bruto, limpo, est):
        t0 = time.perf_counter()
        extra = {}
        av = self.coach.avisa
        gt = float(est.get("gt") or 0)
        fase = est.get("fase")
        self.relogio.atualizar(gt)
        jog = est.get("jogadores") or []
        self.campeoes = {"meu_time": _time_str(est.get("meuTime")),
                         "campeoes": [{"campeao": j["nome"], "id": j["campeao"], "time": _time_str(j["time"])}
                                      for j in jog if j.get("campeao")],
                         "mortos": [j["nome"] for j in jog if j.get("morto")]}
        if not self.icones_pedidos and self.cap is not None and self.coach.lcu is not None and self.campeoes["campeoes"]:
            self.icones_pedidos = True
            ids = [c["id"] for c in self.campeoes["campeoes"]]
            cap = self.cap

            def icones():
                try:
                    self.coach.fab["icones"](self.coach.lcu, ids)
                    cap.detector = None  # ícone novo: o detector refaz os modelos
                    cap._chave_det = None
                except Exception as e:
                    av("ícones do minimapa", e)
            self._thread(icones, "coach-icones")

        car = self.coach.car
        if car is not None and self.cfg["carregamento"]:
            try:
                car.verificar(bruto, self.fila)
                extra["carregamento"] = car.estado()
                if not self.runas_ok and getattr(car, "runas", None):
                    with self.trava_f:
                        self.f.definir_runas(car.runas)
                    self.runas_ok = True
            except Exception as e:
                av("carregamento", e)

        import sugestoes
        if fase == "carregando":
            if self.estatico:
                try:
                    bloco = sugestoes.bloco_carregamento(limpo, self.estatico)
                    if bloco:
                        extra["composicao"] = bloco
                        self._item_curado(est, bloco)
                except Exception as e:
                    av("composição", e)
            self._medir(t0)
            return extra

        try:
            self.live.atualizar(limpo, objetivos=ao_vivo.objetivos_para_avisos(est))
        except Exception as e:
            av("avisos da Live Client", e)
        if self.pos is None and self.live.eu and fase == "jogo":
            try:
                self.pos = avisos.AlertasPosicao.do_live(self.motor, limpo)
                self._configurar_pos()
            except Exception as e:
                av("alertas de posição", e)

        dets = []
        cap = self.cap
        if cap is not None:
            try:
                dets = cap.deteccoes(max_idade=1)
                if self.pos is not None:
                    self.pos.observar(dets, self.relogio(), quadro_valido=cap.no_ar, mortos=self.live.mortos,
                                      eventos=self.live.eventos.values())
            except Exception as e:
                av("detecções do minimapa", e)
            extra["jungler"], extra["selva"] = self._jungler(limpo, est, gt, dets)

        if self.f is not None:
            try:
                with self.trava_f:
                    self.f.atualizar(limpo)
                    extra["feiticos"] = self.f.estado(gt)
                    voltaram = self.f.voltaram(gt)
                for a in voltaram:
                    self.motor.publicar(avisos.aviso_de(a))
            except Exception as e:
                av("feitiços", e)
        if self.picos is not None:
            try:
                for a in self.picos.atualizar(limpo):
                    self.motor.publicar(avisos.aviso_de(a))
            except Exception as e:
                av("picos de força", e)

        try:
            inimigo = {"ORDER": "CHAOS", "CHAOS": "ORDER"}[self.campeoes["meu_time"]]
            # última posição vista de cada um, de qualquer idade: o sugestoes decide "visto" (<= 5 s) ou
            # "sumido há X s" (o corte de 1 s do `dets` jogava fora o tempo desde que ele sumiu)
            vistos = {d["campeao"]: d["visto_em"] for d in cap.deteccoes() if _time_str(d.get("time")) == inimigo} \
                if cap is not None else None
            try:   # o minimapa também conta como "visto" no painel (adversário de rota, "dados dele parados");
                #      antes só a assinatura da Live Client, que anda de 10 em 10 de farm (14/10/2026)
                ao_vivo.mesclar_vistos(est, vistos)
            except Exception as e:
                av("visto pelo minimapa", e)
            area = None
            if extra.get("jungler"):
                area = {"texto": extra["jungler"].get("texto"), "zonas": extra["jungler"].get("zonas", [])[:3]}
            extra["preparo"] = sugestoes.preparo_objetivo(limpo, vistos=vistos, area_jungler=area)
        except Exception as e:
            av("preparo de objetivo", e)
        if self.estatico:
            try:
                eu = sugestoes._eu(limpo)
                ini = [p for p in limpo.get("allPlayers") or [] if eu and p.get("team") != eu.get("team")]
                por = self.estatico["por_nome"]
                aliases = [a for a in (por.get(p.get("championName")) for p in ini) if a]
                regras = self.coach.itens_md()
                comp = sugestoes.composicao(aliases, self.estatico, regras["cura"])
                lemb = sugestoes.lembretes_build(por.get((eu or {}).get("championName")), comp, regras)
                self._item_curado(est, {"lembretes": lemb, "composicao": comp})
            except Exception as e:
                av("item sugerido", e)

        try:
            self.motor.tick()
            extra["aviso"] = self.motor.painel()
            extra["avisos"] = self.motor.estado()
        except Exception as e:
            av("motor de avisos", e)
        self._medir(t0)
        return extra

    @staticmethod
    def _item_curado(est, bloco):
        """troca a sugestão genérica do ao_vivo.py (AD/AP) pelo lembrete de docs/ITENS.md, quando há"""
        ob = est.get("objetivos")
        lemb = bloco.get("lembretes") or []
        if isinstance(ob, dict) and lemb:
            comp = bloco.get("composicao") or {}
            ob["sugestaoItem"] = {"texto": lemb[0], "motivo": f"{comp.get('ad', 0)} AD · {comp.get('ap', 0)} AP",
                                  "fonte": "ITENS.md", "outros": lemb[1:]}

    def _jungler(self, limpo, est, gt, dets):
        av = self.coach.avisa
        try:
            import alcance
            import jungler
            meu = self.campeoes["meu_time"]
            ret = self.cap.ret if self.cap is not None else None
            if self.jg is None or (ret is not None and ret.lado != self.jg.lado):
                # o retângulo do mapa costuma chegar depois do 1º passo (o 347 é só reserva): refaz no
                # tamanho certo, senão grade e fog (outra HUD/MinimapScale) ficam recusadas a partida
                # inteira. Nada se perde: eventos e allPlayers chegam inteiros a cada leitura
                if self.jg is not None:
                    log.info("coach: jungler refeito no mapa de %d px (era %d)", ret.lado, self.jg.lado)
                self.jg = jungler.EstadoJungler(meu, grade=None, lado=ret.lado if ret else 347)
                self._fonte_ov = None
            jg = self.jg
            itens = next(([i.get("itemID") for i in p.get("items") or []] for p in limpo.get("allPlayers") or []
                          if p.get("championName") == jg.campeao), [])
            vel = alcance.velocidade(jg.campeao, itens, base=self.vel_base) if jg.campeao else None
            jg.jogadores(limpo.get("allPlayers"), gt, velocidade=vel)
            evs = (limpo.get("events") or {}).get("Events") or []
            jg.eventos(evs)
            if self.gv is not None:
                self.gv.eventos(evs)
            jg.observar(dets)
            if self.gv is not None:
                jg.trocar_grade(self.gv.atualizar(gt))
            jg.preparar(gt)
            # fog só do quadro de AGORA: com o jogo fora da tela (morto, trocou de janela) o último quadro
            # é velho e a visão dele excluiria zonas que já voltaram para a fog
            terr = self.cap.ultimo_terreno() if self.cap is not None and self.cap.no_ar else None
            fog = terr["fog"] if terr is not None and terr["fog"].shape[0] == jg.lado else None
            estado = jg.estado(gt, fog)
            # gank de onde estou (meu ícone; a rota do champ select só sem ícone) e, com aliado visto nela, de
            # outra rota (o Gabriel avisa os colegas): avisos.decidir_gank, calibração de 14/10/2026
            eu = est.get("euJogador") or {}
            reserva = ROTA_CURTA.get(str(eu.get("rota") or "").upper())
            # a distribuição do jungler sai 1 vez por passo, não 1 por rota perguntada (custo do Dijkstra/bincount)
            zonas = estado.get("zonas") if estado.get("status") in ("visto", "provavel", "sumido") else None
            a = avisos.decidir_gank(lambda r, alvo: jg.gank(gt, r, alvo, fog, zonas=zonas or None), self.pos,
                                    reserva, self.relogio() if self.pos is not None else None,
                                    outras=self.cfg.get("gankOutraRota", True))
            if a is not None and (a.urgente is not False or gt - self.gank_outra_em >= GANK_OUTRA_S):
                if self.motor.publicar(a) and a.urgente is False:
                    self.gank_outra_em = gt
            if self.ov is not None and self._fonte_ov is None:
                import overlay_minimapa
                self._fonte_ov = overlay_minimapa.fonte_jungler(self.cap, jg, self.relogio)
            self._prever(jg, gt, fog)
            return ({k: v for k, v in estado.items() if k != "pista"} | {"fonte": (estado.get("pista") or {}).get("fonte")},
                    jg.selva.estado(gt))
        except Exception as e:
            av("jungler", e)
            return None, None

    def _prever(self, jg, gt, fog):
        """centro da área provável a cada 10 s de gameTime (revisão contra a timeline no pós-jogo)"""
        balde = int(gt // PREVISAO_S)
        if balde == self.balde_prev or not jg.pista:
            return
        self.balde_prev = balde
        zonas, calor = jg.distribuicao(gt, fog)
        if calor is None or calor.sum() <= 0 or not zonas:
            return
        # centro do calor DENTRO da zona mais provável: o centro da área inteira cai no meio do mapa
        # assim que ela cresce (medido no ensaio: 2/26 a <= 1000 com o centro da área inteira)
        w = calor * (jg.mapa.idx == jg.mapa.rotulos.index(zonas[0][0]))
        if w.sum() <= 0:
            w = calor
        s = float(w.sum())
        x = float((w * jg.mapa.xs).sum() / s)
        y = float((w * jg.mapa.ys).sum() / s)
        self.previsoes.append({"gt": round(gt, 1), "campeao": jg.campeao, "x": round(x), "y": round(y),
                               "visto_ha": round(gt - jg.pista["t"], 1),
                               "zona": zonas[0][0] if zonas else None, "p": round(zonas[0][1], 3) if zonas else None})

    def _medir(self, t0):
        self.ticks.append((time.perf_counter() - t0) * 1000)
        if len(self.ticks) > 20000:
            del self.ticks[:10000]

    # -- fim --
    def parar_tela(self):
        """o jogo saiu da tela (WaitingForStats): para captura, overlay, OCR, atalho e moldura"""
        self.tela_parada.set()   # POST /config depois disso não religa nada desta partida
        self._parar_minimapa()
        self._parar_feiticos()
        try:
            self.moldura.parar()
        except Exception as e:
            self.coach.avisa("moldura", e)

    def _tipo_na_moldura(self, rotulo):
        """tipo do aviso que pintou este rótulo (thread da vitrine; o deque muda junto: falha = None)"""
        try:
            return next((a.tipo for _, d, a in reversed(list(self.motor.emitidos))
                         if d == "moldura" and a.rotulo == rotulo), None)
        except RuntimeError:
            return None

    def parar(self, fim=True):
        self.parando.set()
        self.parar_tela()
        if self.vitrine is not None:   # fim da partida: a vitrine desliga sozinha (apaga a marca); recomeço não
            try:
                self.vitrine.parar(apagar_marca=fim)
            except Exception as e:
                self.coach.avisa("vitrine", e)
        try:
            self.voz.parar()
        except Exception as e:
            self.coach.avisa("voz", e)
        for t in self.threads:
            if t is not threading.current_thread():
                t.join(3)
        self._gravar_previsoes()

    def _gravar_previsoes(self):
        if not self.previsoes or not self.game_id:
            return
        try:
            c = banco.abrir(self.coach.db)
            try:
                c.executescript(ESQUEMA_PREVISAO)
                with c:
                    c.executemany("insert or replace into previsoes_jungler values (?,?,?,?,?,?,?,?)",
                                  [(self.game_id, p["gt"], p["campeao"], p["x"], p["y"], p["visto_ha"], p["zona"],
                                    p["p"]) for p in self.previsoes])
            finally:
                c.close()
            log.info("coach: %d previsões do jungler gravadas (partida %s)", len(self.previsoes), self.game_id)
        except sqlite3.Error as e:
            self.coach.avisa("previsões do jungler", e)


# ---------- o coach do processo ----------

class Coach:
    """Uma por processo. iniciar() sobe o servidor local; fase() segue o gameflow; pos_partida() roda
    depois que a partida está no banco; encerrar() no fim do coletor. `fab` troca as peças que tocam
    tela, som, teclado ou rede (o ensaio usa isso; o coletor usa as de verdade)."""

    def __init__(self, db=banco.DB_PADRAO, liveclient=ao_vivo.LIVECLIENT_PADRAO, porta=servidor_local.PORTA,
                 config=servidor_local.CONFIG, fabricas=None, intervalo=1.0, previsoes_db=None, salvar_mapas=True):
        self.db = str(db)
        self.config = config
        self.porta = porta
        self.fab = {**FABRICAS, **(fabricas or {})}
        self.avisa = _Avisa()
        self.lcu = None
        self.patch = None
        self.partida = None
        self.trava = threading.RLock()
        self._bruto = None
        self._itens_md = None
        self.draft_atual = None
        self._draft = None
        self.previsoes_db = previsoes_db   # onde o carregamento grava a previsão (padrão: dados/meta.db)
        self.salvar_mapas = salvar_mapas   # grade de caminhável em dados/mapas/ (o ensaio não grava)
        # dado estático (dados\cache\jogo-estatico.json) montado ANTES da 1ª partida: na 1ª fase com LCU
        # (13/10/2026: só nascia no InProgress, e a 1ª partida rodava com recarga padrão e sem picos)
        self.trava_estatico = threading.Lock()
        self.estatico_pronto = threading.Event()
        self._estatico_tentou = float("-inf")
        self._estatico_porta = None        # client (porta da LCU) que já aqueceu: client reaberto = confere de novo
        self.av = ao_vivo.AoVivo(liveclient=liveclient, db=self.db, avisador=lambda est: None, intervalo=intervalo)
        self.av.ao_ler(self._ao_ler)   # uma vez só: cada partida troca o _Partida, não o ouvinte
        self.car = None
        self.mentor = None
        try:
            self.mentor = self.fab["mentor"](self.db, self.ultimo_bruto)
            self.mentor.ler_estado = self.estado   # quem está parado na fog vai marcado no prompt ao vivo
        except Exception as e:
            self.avisa("mentor", e)
        self.srv = servidor_local.ServidorLocal(
            self.estado, db=self.db, porta=porta, config=config,
            mentor_http=self.mentor.rota_http if self.mentor else None, ao_config=self.configurar,
            rotas_get={"/draft": self._rota_draft, "/revisao/": self._rota_revisao},
            garantir_partida=self.garantir_partida)
        self._busca = {}   # gameId -> monotonic da última busca avulsa na LCU (no máximo 1 a cada 3 s)
        self._trava_busca = threading.Lock()
        self.jan = self.fab["janela"](f"http://127.0.0.1:{porta}/", lambda: self.cfg()["painelAoVivo"])
        self.servidor_no_ar = False
        self._selo = {}    # campeão -> (monotonic, matchups, traumas) do GET /draft/<campeão>
        self._mentor_cfg(self.cfg())

    def _mentor_cfg(self, cfg):
        """modelo e effort do mentor pela seção do 7b (o plugin manda; padrão = vencedor da comparação)"""
        if self.mentor is not None:
            self.mentor.modelo, self.mentor.effort = cfg["mentorModelo"], cfg["mentorEffort"]

    # -- infraestrutura --
    def cfg(self):
        return servidor_local.ler_config(self.config)

    def iniciar(self):
        """servidor local de pé com o coletor (/config precisa responder fora da partida)"""
        self.servidor_no_ar = self.srv.iniciar()
        if not self.servidor_no_ar:
            log.warning("coach: servidor local fora (porta %s ocupada); painel e plugin sem dados ao vivo", self.porta)
        return self.servidor_no_ar

    def encerrar(self):
        self.encerrar_partida()
        try:
            self.jan.fechar()
        except Exception as e:
            self.avisa("janela do painel", e)
        self.srv.parar()
        if self.mentor is not None:
            self.mentor.esperar(5)

    def estado(self):
        return self.av.estado()

    def ultimo_bruto(self):
        """último allgamedata cru (com Riot ID, só memória) para o POST /mentor/aovivo; None sem partida"""
        return self._bruto if self.av.estado().get("partida") else None

    def itens_md(self):
        if self._itens_md is None:
            import sugestoes
            self._itens_md = sugestoes.ler_itens_md()
        return self._itens_md

    def configurar(self, cfg):
        """POST /config: aplica na partida em andamento (a janela do painel também)"""
        p = self.partida
        if p is not None:
            p.configurar(cfg)
        self._mentor_cfg(cfg)
        if not cfg["painelAoVivo"]:
            try:
                self.jan.fechar()
            except Exception as e:
                self.avisa("janela do painel", e)

    # -- gameflow --
    async def fase(self, fase, game_id=None, fila=None, lcu=None):
        """chamado pelo Coletor.fase() a cada mudança; nada aqui bloqueia o laço do websocket"""
        self.lcu = lcu or self.lcu
        if fase not in FASES_LIGA:
            self.aquecer_estatico()
        if fase in FASES_LIGA:
            await asyncio.to_thread(self.iniciar_partida, game_id, fila)
        elif fase in FASES_TELA_FORA:
            await asyncio.to_thread(self.parar_tela)
        elif fase != "GameStart":
            await asyncio.to_thread(self.encerrar_partida)
        try:
            await asyncio.to_thread(self.jan.fase, fase)
        except Exception as e:
            self.avisa("janela do painel", e)

    def aquecer_estatico(self, espera_s=60):
        """monta/confere o cache do dado estático em thread, fora da partida (lobby, champ select, fim):
        a 1ª partida com o client aberto já lê o cache. Uma vez por client aberto (porta da LCU: o client
        que atualiza de patch fecha e reabre com porta nova, e o carregar_estatico remonta se a versão
        mudou; mesma versão = 1 GET); falhou = tenta de novo na próxima fase depois de espera_s.
        Devolve a thread ou None."""
        if self.lcu is None:
            return None
        porta = getattr(self.lcu, "porta", None) or id(self.lcu)
        if porta != self._estatico_porta:
            self._estatico_porta = porta
            self.estatico_pronto.clear()
            self._estatico_tentou = float("-inf")
        if self.estatico_pronto.is_set():
            return None
        agora = time.monotonic()
        if agora - self._estatico_tentou < espera_s:
            return None
        self._estatico_tentou = agora
        lcu = self.lcu

        def montar():
            try:
                with self.trava_estatico:
                    t0 = time.monotonic()
                    est = self.fab["estatico"](lcu)
                self.estatico_pronto.set()
                log.info("coach: dado estático pronto antes da partida (%s, %.1f s)", _resumo_estatico(est),
                         time.monotonic() - t0)
            except Exception as e:
                self.avisa("dado estático (antes da partida)", e)
        t = threading.Thread(target=montar, name="coach-estatico-antes", daemon=True)
        t.start()
        return t

    def iniciar_partida(self, game_id=None, fila=None):
        from voz import prioridade_do_processo
        with self.trava:
            if self.partida is not None and self.partida.game_id == game_id and self.av.ativo():
                return self.partida  # Reconnect/InProgress repetido: segue a mesma
            if self.partida is not None:   # mesma partida recomeçada (ou id desconhecido): a vitrine retoma
                velho = self.partida.game_id
                self._encerrar_partida(fim=velho is not None and game_id is not None and velho != game_id)
            cfg = self.cfg()
            import sugestoes
            if cfg["carregamento"] and self.car is None:
                try:
                    import draft
                    self.car = self.fab["carregamento"](caminho_lol=self.db,
                                                        gravar_em=str(self.previsoes_db or draft.DB_META))
                except Exception as e:
                    self.avisa("carregamento", e)
            if self.lcu is not None and self.patch is None:
                try:
                    self.patch = str(self.lcu.get("/lol-patch/v1/game-version") or "?")
                except Exception:
                    self.patch = "?"
            try:
                prioridade_do_processo(True)
            except Exception as e:
                self.avisa("prioridade do processo", e)
            self.partida = _Partida(self, game_id, fila, cfg)
            self.av.lcu = self.lcu
            self.av.iniciar(game_id, fila, gravar=cfg["amostrasAoVivo"] and sugestoes.amostrar(fila))
            log.info("coach: partida %s (fila %s) ligada: voz %s, minimapa %s, feitiços %s, carregamento %s",
                     game_id, fila, cfg["voz"], cfg["minimapa"], cfg["feiticos"], cfg["carregamento"])
            return self.partida

    def parar_tela(self):
        p = self.partida
        if p is not None:
            p.parar_tela()

    def encerrar_partida(self):
        with self.trava:
            self._encerrar_partida()

    def _encerrar_partida(self, fim=True):
        from voz import prioridade_do_processo
        p, self.partida = self.partida, None
        if p is None and not self.av.ativo():
            return
        t0 = time.monotonic()
        self.av.parar()
        if p is not None:
            p.parar(fim=fim)
        if self.car is not None:
            try:
                self.car.encerrar()  # esquece puuid e Riot ID de todo mundo
            except Exception as e:
                self.avisa("carregamento", e)
        self._bruto = None
        try:
            prioridade_do_processo(False)
        except Exception as e:
            self.avisa("prioridade do processo", e)
        log.info("coach: partida encerrada em %.1f s", time.monotonic() - t0)

    def _ao_ler(self, bruto, limpo, est):
        p = self.partida
        if p is None:
            return None
        self._bruto = bruto
        return p.passo(bruto, limpo, est)

    # -- champ select --
    def champ_select(self, sessao):
        """rota provável e força do draft a cada sessão (o selo do plugin lê GET /draft)"""
        try:
            if self._draft is None:
                import draft
                lol = sqlite3.connect(f"file:{Path(self.db).as_posix()}?mode=ro", uri=True, timeout=30,
                                      check_same_thread=False)
                meta_p = Path(draft.DB_META)   # meta coletada (tools/coletar-meta.py), só leitura
                meta = sqlite3.connect(f"file:{meta_p.as_posix()}?mode=ro", uri=True, timeout=30,
                                       check_same_thread=False) if meta_p.exists() else None
                self._draft = draft.Draft(conn_lol=lol, conn_meta=meta)
            r = self._draft.analisar_sessao(sessao)
            self.draft_atual = {"ts": banco.agora_ms(), "gameId": (sessao or {}).get("gameId"), **r}
        except Exception as e:
            self.avisa("draft", e)

    def fim_champ_select(self):
        self.draft_atual = None

    def _rota_draft(self, caminho):
        """GET /draft (o draft da sessão) e /draft/<meu campeão>: + matchups e traumas dele contra os inimigos
        travados, para o selo do plugin (passos 4, 17 e 19; o histórico do client não tem adversário nem timeline)"""
        out = {"draft": self.draft_atual}
        partes = caminho.rstrip("/").split("/")
        if len(partes) < 3:
            return 200, out
        try:
            meu = int(partes[2])
        except ValueError:
            return 400, {"erro": "campeão inválido"}
        cache = self._selo.get(meu)
        if not cache or time.monotonic() - cache[0] > 600:
            import analise
            c = banco.abrir_leitura(self.db)
            try:
                cache = (time.monotonic(), analise.matchups(c, meu)["matchups"], analise.traumas(c, campeao=meu)["campeoes"])
            finally:
                c.close()
            self._selo[meu] = cache
        inimigos = {j["campeao"] for j in (self.draft_atual or {}).get("inimigos") or []}
        out.update(meu=meu, matchups=cache[1], traumas=[t for t in cache[2] if t["campeao"] in inimigos])
        return 200, out

    # -- depois da partida --
    def garantir_partida(self, game_id):
        """GET /contexto ou /licoes antes do backfill: busca a partida e a linha do tempo na LCU agora
        (só GET) e grava como o backfill grava. False sem client, sem a partida no histórico ainda ou
        sem linha do tempo (o pós-jogo tenta de novo). O backfill do EndOfGame segue igual (idempotente)."""
        lcu = self.lcu
        if lcu is None:
            return False
        with self._trava_busca:
            agora = time.monotonic()
            if agora - self._busca.get(game_id, -1e9) < 3:
                return False
            self._busca[game_id] = agora
            try:
                g = lcu.get(f"/lol-match-history/v1/games/{game_id}", timeout=20)
                t = lcu.get(f"/lol-match-history/v1/game-timelines/{game_id}", timeout=20)
            except Exception:
                return False
            if not (isinstance(g, dict) and g.get("gameId") == game_id and isinstance(t, dict) and t.get("frames")):
                return False
            c = banco.abrir(self.db)
            try:
                puuid = banco.meta(c, "puuid")
                if not puuid:
                    return False
                banco.gravar_partida(c, g, puuid, t)
            finally:
                c.close()
            log.info("coach: partida %s gravada na hora (pedido do pós-jogo antes do backfill)", game_id)
            return True

    def pos_partida(self, game_id, fila=None):
        """partida + timeline já no banco: mentor (se ligado) e revisão da previsão do jungler"""
        if not game_id:
            return None
        # a fila vem da partida gravada, não do `fila_atual` do coletor: ele é lido 5–315 s depois do
        # EndOfGame e já pode ser a do lobby seguinte (personalizada contando cota, ou ranqueada sem mentor)
        try:
            c = banco.abrir_leitura(self.db)
            try:
                r = c.execute("select fila from partidas where game_id=?", (game_id,)).fetchone()
            finally:
                c.close()
            if r and r[0] is not None:
                fila = r[0]
        except Exception as e:
            self.avisa("fila da partida", e)
        cfg = self.cfg()
        out = {}
        out["revisao"] = self.revisar(game_id)
        if cfg["mentor"] and self.mentor is not None and fila not in ao_vivo.FORA_DAS_CONTAS:
            try:
                out["mentor"] = self.mentor.posjogo(game_id)
                log.info("coach: mentor pensando no pós-jogo da partida %s", game_id)
            except Exception as e:
                self.avisa("mentor", e)
        return out

    def revisar(self, game_id):
        """previsão do jungler (a cada 10 s) contra a posição real dele na timeline (1/min)"""
        import sugestoes
        try:
            c = banco.abrir(self.db)
        except sqlite3.Error as e:
            self.avisa("revisão", e)
            return None
        try:
            c.executescript(ESQUEMA_PREVISAO)
            prev = [{"gt": gt, "x": x, "y": y, "visto_ha": vh, "campeao": camp} for gt, x, y, vh, camp in c.execute(
                "select gt, x, y, visto_ha, campeao from previsoes_jungler where game_id=? order by gt", (game_id,))]
            if not prev:
                return None
            campeao = prev[-1]["campeao"]
            # id < 10000: 77 campeões têm uma variante de modo (60064 = Lee Sin) que, por vir depois,
            # tomava o nome; nenhum participante usa esses ids (ARMADILHAS § Client e Pengu)
            nomes = {n: i for i, n in c.execute("select id, nome from campeoes where id < 10000")}
            r = c.execute("select time from partidas where game_id=?", (game_id,)).fetchone()
            pid = None
            if r and campeao in nomes:
                linha = c.execute("select participant_id from participantes where game_id=? and campeao=? and time!=?",
                                  (game_id, nomes[campeao], r[0])).fetchone()
                pid = linha and linha[0]
            frames = banco.ler_frames(c, game_id)
            if not pid or not frames:
                return None
            rev = sugestoes.revisar_previsao(prev, sugestoes.posicoes_timeline({"frames": frames}, pid))
            todas = [json.loads(j) for (j,) in c.execute("select json from revisoes_jungler where game_id!=?", (game_id,))]
            acum = sugestoes.precisao_acumulada(todas + [rev])
            with c:
                c.execute("insert or replace into revisoes_jungler values (?,?,?,?,?,?,?,?,?)",
                          (game_id, banco.agora_ms(), campeao, rev["n"], rev["acertos"], rev["precisao"],
                           rev["n_visto"], rev["raio"], json.dumps(rev, ensure_ascii=False)))
            log.info("coach: revisão do jungler (%s) partida %s: %s/%s a <= %d (acumulada %s em %d partidas)",
                     campeao, game_id, rev["acertos"], rev["n"], rev["raio"], acum["precisao"], acum["partidas"])
            return {**rev, "campeao": campeao, "acumulada": acum}
        except Exception as e:
            self.avisa("revisão", e)
            return None
        finally:
            c.close()

    def _rota_revisao(self, caminho):
        try:
            gid = int(caminho.rstrip("/").split("/")[2])
        except (IndexError, ValueError):
            return 400, {"erro": "gameId inválido"}
        try:
            c = banco.abrir_leitura(self.db)
        except FileNotFoundError:
            return 404, {"erro": "sem banco"}
        try:
            r = c.execute("select json from revisoes_jungler where game_id=?", (gid,)).fetchone()
            todas = [json.loads(j) for (j,) in c.execute("select json from revisoes_jungler")]
        except sqlite3.OperationalError:
            r, todas = None, []
        finally:
            c.close()
        if not r:
            return 404, {"gameId": gid, "revisao": None}
        import sugestoes
        return 200, {"gameId": gid, "revisao": json.loads(r[0]), "acumulada": sugestoes.precisao_acumulada(todas)}
