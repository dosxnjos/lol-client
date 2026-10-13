# gravador passivo do lol-client (plano v2, passo 0): o Gabriel deixa rodando numa partida normal
# e ele grava o que só uma partida real responde. Só GET (LCU e Live Client), nada de POST, nada
# de tecla ou clique; a credencial do lockfile só vive em memória. Captura de tela pelo Windows (mss).
#   python tools/gravador.py            grava até o client fechar ou 10 min após o EndOfGame
#   python tools/gravador.py --ensaio   5 s da fase atual + 1 recorte do minimapa, e sai
# saída: temp/gravacao/<AAAAMMDD-HHMMSS>/ (formato em docs/COLETOR.md § Gravador)
import argparse
import ctypes
import json
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import coletor  # noqa: E402  (só conectar/LCU/limpar_sessao: sem o log nem a trava do coletor)

GAME_CFG = Path(r"C:\Games\Riot Games\League of Legends\Config\game.cfg")
LIVE = "https://127.0.0.1:2999/liveclientdata/allgamedata"
# minimapa: lado = altura × (MINI_A + MINI_B × MinimapScale). CHUTE INICIAL, não medido: calibrar
# pelos prints de tela cheia (telas/) e trocar aqui (docs/COLETOR.md § Minimapa). O recorte é um
# quadrado preso ao canto de baixo, MINI_FOLGA vezes maior que o lado, para caber mesmo com erro.
MINI_A, MINI_B, MINI_FOLGA = 0.194, 0.0648, 1.3
ESPERAS_TIMELINE = (5, 10, 20, 40, 80, 160)  # s após o EndOfGame (o histórico demora)
SEM_CLIENT_S = 30
POS_FIM_S = 600


def ler_cfg(caminho=GAME_CFG):
    """{secao: {chave: valor}} do game.cfg (ini simples; chave repetida: vale a última)"""
    out, sec = {}, None
    try:
        for ln in caminho.read_text(encoding="utf-8", errors="replace").splitlines():
            ln = ln.strip()
            if ln.startswith("[") and ln.endswith("]"):
                sec = out.setdefault(ln[1:-1], {})
            elif "=" in ln and sec is not None:
                k, v = ln.split("=", 1)
                sec[k.strip()] = v.strip()
    except OSError:
        pass
    return out


def retangulo_minimapa(cfg, monitores):
    """(monitor do jogo, recorte do minimapa {left, top, width, height} em px físicos, detalhe)"""
    g, h = cfg.get("General", {}), cfg.get("HUD", {})
    largura, altura = int(float(g.get("Width", 0) or 0)), int(float(g.get("Height", 0) or 0))
    escala = float(h.get("MinimapScale", 1) or 1)
    flip = h.get("FlipMiniMap", "0") == "1"
    mon = next((m for m in monitores[1:] if (m["width"], m["height"]) == (largura, altura)), None) \
        or next((m for m in monitores[1:] if m.get("is_primary")), monitores[1])
    largura, altura = mon["width"], mon["height"]  # sem borda (WindowMode=2): o jogo ocupa o monitor
    lado = round(altura * (MINI_A + MINI_B * escala))
    corte = min(altura, round(lado * MINI_FOLGA))
    left = mon["left"] if flip else mon["left"] + largura - corte
    ret = {"left": left, "top": mon["top"] + altura - corte, "width": corte, "height": corte}
    detalhe = {"Width": g.get("Width"), "Height": g.get("Height"), "WindowMode": g.get("WindowMode"),
               "MinimapScale": escala, "FlipMiniMap": int(flip), "lado_estimado": lado,
               "formula": f"lado = altura × ({MINI_A} + {MINI_B} × MinimapScale); recorte = lado × {MINI_FOLGA}, "
                          f"canto de baixo {'esquerdo' if flip else 'direito'}"}
    return mon, ret, detalhe


def contexto_tls():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # Live Client e LCU: certificado próprio da Riot, só 127.0.0.1
    return ctx


class Gravador:
    def __init__(self, saida, ensaio=False):
        self.saida = saida
        self.ensaio = ensaio
        self.lcu = None
        self.ctx = contexto_tls()
        self.n = {}             # contagem por arquivo
        self.sem_partida = 0    # Live Client recusada/indisponível
        self.ultimo = {}        # dedupe por arquivo
        self.prefs = None
        self.gid = None
        self.timeline_ok = set()
        self.cfg = ler_cfg()
        self.mss = None
        self.mon = self.ret = None

    # ---- escrita ----
    def escrever(self, nome, obj):
        self.saida.mkdir(parents=True, exist_ok=True)
        with open(self.saida / f"{nome}.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + "\n")
        self.n[nome] = self.n.get(nome, 0) + 1

    def mudou(self, nome, chave):
        if self.ultimo.get(nome) == chave:
            return False
        self.ultimo[nome] = chave
        return True

    # ---- LCU (só GET) ----
    def get(self, caminho, timeout=10):
        """None em qualquer falha: 404 fora da fila/sem lobby é o normal; timeout, conexão caída
        ou corpo truncado contam em erro_lcu e o laço segue (a fase seguinte reconecta)"""
        if self.lcu is None:
            return None
        try:
            return self.lcu.get(caminho, timeout=timeout)
        except urllib.error.HTTPError:
            return None
        except Exception as e:  # TimeoutError, URLError, ConnectionResetError, JSONDecodeError…
            self.n["erro_lcu"] = self.n.get("erro_lcu", 0) + 1
            if self.n["erro_lcu"] <= 5 or self.n["erro_lcu"] % 100 == 0:  # readycheck a cada 200 ms: sem inundar
                print(f"{datetime.now():%H:%M:%S} LCU falhou ({caminho.split('?')[0]}): {type(e).__name__}", flush=True)
            return None

    def fase(self):
        """fase atual; None se a LCU caiu (reconecta pelo lockfile)"""
        for _ in range(2):
            if self.lcu is None:
                self.lcu = coletor.conectar()
                if self.lcu is None:
                    return None
            try:
                return self.lcu.get("/lol-gameflow/v1/gameflow-phase", timeout=5)
            except urllib.error.HTTPError:
                return "?"
            except Exception:
                self.lcu = None
        return None

    # ---- por fase ----
    def lobby(self, ts):
        lb = self.get("/lol-lobby/v2/lobby")
        if not lb:
            return
        m = lb.get("localMember") or {}
        self.prefs = [p for p in (m.get("firstPositionPreference"), m.get("secondPositionPreference"))
                      if p and p not in ("UNSELECTED", "NONE")]
        snap = {"fila": (lb.get("gameConfig") or {}).get("queueId"), "preferidas": self.prefs,
                "membros": len(lb.get("members") or [])}
        if self.mudou("lobby", snap):
            self.escrever("lobby", {"ts": ts, **snap})

    def readycheck(self, ts):
        rc = self.get("/lol-matchmaking/v1/ready-check", timeout=3)
        if rc and rc.get("state") not in (None, "Invalid"):
            self.escrever("readycheck", {"ts": ts, "hora": datetime.now().strftime("%H:%M:%S.%f")[:-3],
                                         "timer": rc.get("timer"), "state": rc.get("state"),
                                         "playerResponse": rc.get("playerResponse")})

    def champselect(self, ts):
        s = self.get("/lol-champ-select/v1/session", timeout=5)
        if not s:
            return
        if "champselect" not in self.ultimo:  # 1º evento: as preferências do lobby (fixture do passo 1)
            if not self.prefs:  # gravador nasceu na fila/seleção ou o lobby foi lido sem posição
                self.lobby(ts)
            self.escrever("champselect", {"ts": ts, "lobby": {"preferidas": self.prefs or []}})
            self.ultimo["champselect"] = None
        s = coletor.limpar_sessao(s)
        sem_relogio = {**s, "timer": {k: v for k, v in (s.get("timer") or {}).items()
                                      if k not in ("adjustedTimeLeftInPhase", "internalNowInEpochMs")}}
        if self.mudou("champselect", json.dumps(sem_relogio, sort_keys=True)):
            self.escrever("champselect", {"ts": ts, "session": s})
        p = self.get("/lol-perks/v1/currentpage", timeout=5) or {}
        if p.get("id") and self.mudou("runa", p.get("id")):
            self.escrever("champselect", {"ts": ts, "runa": {"id": p.get("id"), "nome": p.get("name")}})

    def ao_vivo(self, ts, agora, prox):
        try:
            req = urllib.request.Request(LIVE, headers={"Accept": "application/json"})
            with urllib.request.urlopen(req, context=self.ctx, timeout=3) as r:
                dados = json.loads(r.read() or b"null")
        except Exception:  # recusada (sem partida), 404/500 na tela de carregamento
            self.sem_partida += 1
            return
        if not dados:
            self.sem_partida += 1
            return
        try:
            self.escrever("live", {"ts": ts, "dados": coletor.limpar_live(dados)})  # nome → campeão
        except Exception:  # formato inesperado: melhor perder a amostra que gravar nome de jogador
            self.n["erro_anonimizar"] = self.n.get("erro_anonimizar", 0) + 1
        t = ((dados.get("gameData") or {}).get("gameTime")) or 0
        if agora >= prox.get("minimapa", 0):
            prox["minimapa"] = agora + 10
            self.print_tela("minimapa", f"{t:07.1f}")
        if agora >= prox.get("tela", 0):
            prox["tela"] = agora + 60
            self.print_tela("telas", f"{t:07.1f}")

    def print_tela(self, pasta, nome):
        """pasta minimapa: recorte do minimapa; telas: o monitor do jogo inteiro (para calibrar)"""
        try:
            import mss
            import mss.tools
            if self.mss is None:
                self.mss = mss.MSS() if hasattr(mss, "MSS") else mss.mss()
            if self.ret is None:
                self.mon, self.ret, det = retangulo_minimapa(self.cfg, self.mss.monitors)
                self.saida.mkdir(parents=True, exist_ok=True)
                (self.saida / "calibracao.json").write_text(json.dumps(
                    {"monitor": {k: self.mon[k] for k in ("left", "top", "width", "height")},
                     "recorte_minimapa": self.ret, **det}, ensure_ascii=False, indent=1), encoding="utf-8")
                print(f"recorte do minimapa: {self.ret} (lado estimado {det['lado_estimado']} px)", flush=True)
            regiao = self.ret if pasta == "minimapa" else self.mon
            img = self.mss.grab({k: regiao[k] for k in ("left", "top", "width", "height")})
            d = self.saida / pasta
            d.mkdir(parents=True, exist_ok=True)
            mss.tools.to_png(img.rgb, img.size, output=str(d / f"{nome}.png"))
            self.n[pasta] = self.n.get(pasta, 0) + 1
        except Exception as e:
            self.n["erro_print"] = self.n.get("erro_print", 0) + 1
            print(f"print falhou ({pasta}): {type(e).__name__}: {e}", flush=True)

    def timeline(self):
        if not self.gid or self.gid in self.timeline_ok:
            return True
        t = self.get(f"/lol-match-history/v1/game-timelines/{self.gid}", timeout=60)
        g = self.get(f"/lol-match-history/v1/games/{self.gid}", timeout=60)
        if t and t.get("frames") and g:
            (self.saida / f"timeline-{self.gid}.json").write_text(json.dumps(t, ensure_ascii=False), encoding="utf-8")
            (self.saida / f"partida-{self.gid}.json").write_text(json.dumps(g, ensure_ascii=False), encoding="utf-8")
            self.timeline_ok.add(self.gid)
            self.n["timeline"] = self.n.get("timeline", 0) + 1
            return True
        return False

    # ---- laço ----
    def rodar(self):
        inicio = time.monotonic()
        sem_client = fim_jogo = None
        viu_client = False  # os 30 s só contam depois de ver o client: iniciar antes dele abrir é ok
        fase_ant, prox, tentativas = None, {}, []
        while True:
            agora = time.monotonic()
            if self.ensaio and agora - inicio >= 5:
                return "ensaio de 5 s"
            if fim_jogo and agora - fim_jogo >= POS_FIM_S and not tentativas:
                return "10 min após o EndOfGame"
            fase = self.fase()
            ts = int(time.time() * 1000)
            if fase is None:
                if self.ensaio:
                    return "client fechado"
                if not viu_client:
                    if sem_client is None:
                        print("aguardando o client do LoL abrir…", flush=True)
                        sem_client = agora
                    time.sleep(1)
                    continue
                sem_client = sem_client or agora
                if agora - sem_client >= SEM_CLIENT_S:
                    return "client fechado"
                time.sleep(1)
                continue
            sem_client, viu_client = None, True
            if fase != fase_ant:
                if fase_ant == "ChampSelect":  # fecha a sequência da fixture com a fase seguinte
                    self.escrever("champselect", {"ts": ts, "fase": fase, "gameId": self.gid_atual()})
                self.escrever("fases", {"ts": ts, "fase": fase})
                prox["lobby"] = 0  # relê as preferidas na entrada da fila
                print(f"{datetime.now():%H:%M:%S} fase {fase}", flush=True)
                if fase in ("InProgress", "GameStart", "Reconnect"):
                    self.gid = self.gid_atual() or self.gid
                if fase == "EndOfGame":
                    fim_jogo = agora
                    self.gid = self.gid or self.gid_atual() or (self.get("/lol-end-of-game/v1/eog-stats-block") or {}).get("gameId")
                    tentativas = [agora + s for s in ESPERAS_TIMELINE]
                if fase in ("Matchmaking", "ReadyCheck", "ChampSelect", "InProgress"):
                    fim_jogo = None  # jogou de novo: segue gravando
                if fase != "ChampSelect":
                    self.ultimo.pop("champselect", None)
                    self.ultimo.pop("runa", None)
                fase_ant = fase
            if tentativas and agora >= tentativas[0]:
                tentativas.pop(0)
                if self.timeline():
                    tentativas = []
            # na fila também (posição escolhida segundos antes de buscar); no ReadyCheck não: a
            # posição já não muda e um GET lento ali atrasaria a medição da janela do aceite
            if fase in ("Lobby", "None", "Matchmaking") and agora >= prox.get("lobby", 0):
                prox["lobby"] = agora + 5
                self.lobby(ts)
            if fase in ("Matchmaking", "ReadyCheck"):
                self.readycheck(ts)
                time.sleep(0.2)
                continue
            elif fase == "ChampSelect":
                self.champselect(ts)
                time.sleep(0.5)
                continue
            elif fase in ("InProgress", "GameStart", "Reconnect"):
                self.ao_vivo(ts, agora, prox)
            time.sleep(max(0.0, 1 - (time.monotonic() - agora)))

    def gid_atual(self):
        s = self.get("/lol-gameflow/v1/session") or {}
        return ((s.get("gameData") or {}).get("gameId")) or None

    def ensaio_extra(self):
        """sem partida: confere a Live Client (espera recusa) e tira 1 recorte do minimapa"""
        self.ao_vivo(int(time.time() * 1000), 0, {"minimapa": 1e18, "tela": 1e18})
        self.print_tela("minimapa", "ensaio")

    def credencial_nos_arquivos(self):
        """quantos arquivos da saída contêm a credencial (ou o Basic dela); nunca imprime o valor"""
        segredos = [s.encode() for s in coletor.SemSegredo.segredos if s]
        if self.lcu:
            segredos.append(self.lcu.auth.split(" ", 1)[1].encode())
        achados = 0
        for f in self.saida.rglob("*") if self.saida.exists() else []:
            if f.is_file():
                b = f.read_bytes()
                achados += any(s in b for s in segredos)
        return achados, len(segredos)


def principal():
    ap = argparse.ArgumentParser(description="gravador passivo de uma partida real (só GET)")
    ap.add_argument("--ensaio", action="store_true", help="grava 5 s da fase atual e sai")
    ap.add_argument("--saida", default=str(RAIZ / "temp" / "gravacao"))
    args = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    try:  # abaixo do normal: o jogo tem prioridade sobre a gravação
        k = ctypes.windll.kernel32
        k.SetPriorityClass(k.GetCurrentProcess(), 0x4000)  # BELOW_NORMAL_PRIORITY_CLASS
    except Exception:
        pass
    saida = Path(args.saida) / datetime.now().strftime("%Y%m%d-%H%M%S")
    g = Gravador(saida, args.ensaio)
    print(f"gravando em {saida} (prioridade abaixo do normal; Ctrl+C encerra)", flush=True)
    t0 = time.monotonic()
    falhou = False
    try:
        motivo = g.rodar()
        if args.ensaio:
            g.ensaio_extra()
    except KeyboardInterrupt:
        motivo = "interrompido"
    except Exception as e:  # o que já foi gravado fica; a conferência de credencial roda igual
        texto = str(e)
        for s in coletor.SemSegredo.segredos:
            texto = texto.replace(s, "***") if s else texto
        motivo, falhou = f"erro {type(e).__name__}: {texto}", True
    finally:
        if g.mss:
            g.mss.close()
    achados, nseg = g.credencial_nos_arquivos()
    partes = ", ".join(f"{k} {v}" for k, v in sorted(g.n.items())) or "nada"
    print(f"fim ({motivo}) após {time.monotonic() - t0:.0f} s: {partes}; Live Client sem partida {g.sem_partida}x")
    print(f"credencial nos arquivos: {achados} (conferidos {nseg} segredo(s) em memória)")
    return 1 if achados or falhou else 0


if __name__ == "__main__":
    sys.exit(principal())
