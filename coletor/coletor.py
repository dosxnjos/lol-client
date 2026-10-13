# coletor do lol-client: backfill do histórico + websocket da LCU -> dados/lol.db
# nasce com o LeagueClientUx (tarefa "lol-client-coletor") e sai sozinho após
# --ocioso-min minutos sem client. A credencial do lockfile só vive em memória.
import argparse
import asyncio
import base64
import ctypes
import json
import logging
import os
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from logging.handlers import RotatingFileHandler
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import banco  # noqa: E402

LOCKFILE_PADRAO = Path(r"C:\Games\Riot Games\League of Legends\lockfile")
DADOS = banco.RAIZ / "dados"
TRAVA = DADOS / "coletor.lock"
LOG = DADOS / "coletor.log"
EVENTOS = (
    "OnJsonApiEvent_lol-gameflow_v1_gameflow-phase",
    "OnJsonApiEvent_lol-end-of-game_v1_eog-stats-block",
    "OnJsonApiEvent_lol-ranked_v1_current-ranked-stats",
)
log = logging.getLogger("coletor")


class SemSegredo(logging.Filter):
    """defesa extra: nenhuma linha de log sai com a credencial atual"""
    segredos = set()

    def filter(self, rec):
        msg = rec.getMessage()
        for s in self.segredos:
            if s and s in msg:
                rec.msg, rec.args = msg.replace(s, "***"), ()
        return True


def configurar_log(console=False):
    DADOS.mkdir(parents=True, exist_ok=True)
    h = RotatingFileHandler(LOG, maxBytes=1_000_000, backupCount=3, encoding="utf-8")
    h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    h.addFilter(SemSegredo())
    log.addHandler(h)
    if console and sys.stderr:
        for f in (sys.stdout, sys.stderr):
            if f and hasattr(f, "reconfigure"):
                f.reconfigure(encoding="utf-8")
        s = logging.StreamHandler(sys.stderr)
        s.addFilter(SemSegredo())
        log.addHandler(s)
    log.setLevel(logging.INFO)


# ---------- lockfile e LCU ----------

_ultima_busca = [-60.0]
_achado = [None]


def achar_lockfile():
    """lockfile padrão; senão, pelo --install-directory do LeagueClientUx.exe em execução
    (no máximo 1 busca por minuto: é um powershell novo a cada vez)"""
    if LOCKFILE_PADRAO.exists():
        return LOCKFILE_PADRAO
    if _achado[0] and _achado[0].exists():
        return _achado[0]
    if time.monotonic() - _ultima_busca[0] < 60:
        return None
    _ultima_busca[0] = time.monotonic()
    try:
        saida = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             # sem isso o PowerShell 5.1 escreve no pipe em cp850 e caminho com acento chega quebrado
             "[Console]::OutputEncoding=[Text.UTF8Encoding]::new();"
             "(Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\").CommandLine"],
            capture_output=True, encoding="utf-8", errors="replace", timeout=20,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
    except Exception:
        return None
    marca = "--install-directory="
    if marca in saida:
        resto = saida.split(marca, 1)[1]
        pasta = resto[1:].split('"', 1)[0] if resto.startswith('"') else resto.split('"', 1)[0].split(" --", 1)[0]
        cand = Path(pasta.strip()) / "lockfile"
        if cand.exists():
            _achado[0] = cand
            return cand
    return None


def ler_lockfile(caminho):
    """(porta, credencial) ou None"""
    try:
        partes = Path(caminho).read_text(encoding="utf-8").strip().split(":")
        if len(partes) >= 5:
            SemSegredo.segredos.add(partes[3])
            return partes[2], partes[3]
    except OSError:
        pass
    return None


class LCU:
    def __init__(self, porta, cred):
        self.porta = porta
        self.auth = "Basic " + base64.b64encode(f"riot:{cred}".encode()).decode()
        # TLS sem verificação: o certificado da LCU é autoassinado e só vale 127.0.0.1
        self.ctx = ssl.create_default_context()
        self.ctx.check_hostname = False
        self.ctx.verify_mode = ssl.CERT_NONE

    def get(self, caminho, timeout=30):
        req = urllib.request.Request(f"https://127.0.0.1:{self.porta}{caminho}",
                                     headers={"Authorization": self.auth, "Accept": "application/json"})
        with urllib.request.urlopen(req, context=self.ctx, timeout=timeout) as r:
            corpo = r.read()
        return json.loads(corpo) if corpo else None

    def vivo(self):
        """True se a LCU responde (qualquer status HTTP conta)"""
        try:
            self.get("/lol-gameflow/v1/gameflow-phase", timeout=10)
            return True
        except urllib.error.HTTPError:
            return True
        except Exception:
            return False


def conectar(lockfile=None):
    """LCU do client aberto, ou None. lockfile explícito desliga o fallback"""
    caminho = lockfile or achar_lockfile()
    dados = caminho and ler_lockfile(caminho)
    if not dados:
        return None
    lcu = LCU(*dados)
    return lcu if lcu.vivo() else None


# ---------- backfill ----------

def backfill(lcu, c, trabalhadores=4, limite=None):
    """grava as partidas do histórico da LCU que faltam no banco (partida + linha do tempo),
    as mais recentes primeiro, no máximo `limite` por chamada. Idempotente."""
    eu = lcu.get("/lol-summoner/v1/current-summoner")
    puuid = eu["puuid"]
    banco.meta(c, "puuid", puuid)
    banco.meta(c, "jogador", f"{eu.get('gameName')}#{eu.get('tagLine')}")
    c.commit()
    if not c.execute("select 1 from campeoes limit 1").fetchone():
        try:
            banco.gravar_campeoes(c, lcu.get("/lol-game-data/assets/v1/champion-summary.json"))
        except Exception as e:
            log.warning("lista de campeões indisponível: %s", e)
    # a LCU ignora begIndex/endIndex e devolve o que tem em cache (20 ou 200); 1ª chamada lenta
    hist = lcu.get("/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=199",
                   timeout=120)
    jogos = (hist.get("games") or {}).get("games") or []
    completos, existentes = banco.ids_completos(c), banco.ids_partidas(c)
    # nunca baixadas primeiro, depois as que só esperam a linha do tempo (pode não vir nunca:
    # sem isso elas ocupariam as vagas do `limite` para sempre)
    todas = [g["gameId"] for g in sorted(jogos, key=lambda g: (g["gameId"] in existentes,
                                                               -(g.get("gameCreation") or 0)))
             if g["gameId"] not in completos]
    faltam = todas[:limite] if limite else todas

    def baixar(gid):
        g = t = None
        try:
            g = lcu.get(f"/lol-match-history/v1/games/{gid}", timeout=60)
            t = lcu.get(f"/lol-match-history/v1/game-timelines/{gid}", timeout=60)
            if not (t and t.get("frames")):
                t = None
        except Exception as e:
            log.warning("partida %s: %s", gid, e)
        return gid, g, t

    novas = sem_tl = 0
    with ThreadPoolExecutor(trabalhadores) as ex:
        for gid, g, t in ex.map(baixar, faltam):
            if not g:
                continue
            banco.gravar_partida(c, g, puuid, t)
            novas += gid not in existentes
            sem_tl += t is None
    total = c.execute("select count(*) from partidas").fetchone()[0]
    log.info("backfill: %d no histórico, %d baixadas (%d novas, %d sem linha do tempo), %d no banco",
             len(jogos), len(faltam), novas, sem_tl, total)
    return {"historico": len(jogos), "baixadas": len(faltam), "novas": novas,
            "sem_timeline": sem_tl, "restam": len(todas) - len(faltam), "total": total}


# ---------- instância única ----------

def pid_vivo(pid, trava_ts=None):
    """sem os.kill: no Windows ele mata o processo. trava_ts (epoch da trava): processo
    criado depois dela é pid reaproveitado (o dono gravou a trava depois de nascer)"""
    k = ctypes.windll.kernel32
    h = k.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return False
    try:
        codigo = ctypes.c_ulong()
        k.GetExitCodeProcess(h, ctypes.byref(codigo))
        if codigo.value != 259:  # STILL_ACTIVE
            return False
        buf = ctypes.create_unicode_buffer(1024)
        n = ctypes.c_ulong(1024)
        if k.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n)) and "python" not in buf.value.lower():
            return False  # pid reaproveitado por outro programa = trava órfã
        if trava_ts is not None:
            t = [ctypes.c_ulonglong() for _ in range(4)]  # criação, saída, kernel, usuário (FILETIME)
            if k.GetProcessTimes(h, *(ctypes.byref(x) for x in t)):
                criado = (t[0].value - 116444736000000000) / 1e7
                if criado > trava_ts + 2:
                    return False  # outro python nasceu com o pid depois da trava
        return True
    finally:
        k.CloseHandle(h)


def travar():
    """True se esta é a única instância; remove trava órfã"""
    DADOS.mkdir(parents=True, exist_ok=True)
    for _ in range(2):
        try:
            fd = os.open(TRAVA, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            return True
        except FileExistsError:
            try:
                pid = int(TRAVA.read_text().strip() or 0)
                ts = TRAVA.stat().st_mtime
            except (OSError, ValueError):
                pid, ts = 0, None
            if pid and pid != os.getpid() and pid_vivo(pid, ts):
                log.info("outra instância em execução (pid %d); saindo", pid)
                return False
            log.info("trava órfã (pid %s) removida", pid or "?")
            TRAVA.unlink(missing_ok=True)
    return False


def destravar():
    try:
        if TRAVA.read_text().strip() == str(os.getpid()):
            TRAVA.unlink()
    except OSError:
        pass


# ---------- laço principal ----------

class Coletor:
    def __init__(self, args):
        self.args = args
        self.ocioso_s = args.ocioso_min * 60
        self.ultimo_ok = time.monotonic()
        self.c = banco.abrir(args.db)
        self.lcu = None
        self.backfill_feito = False
        self.inicial = None   # task do backfill da conexão
        self.buscando = None  # task da partida nova após EndOfGame

    def ocioso(self):
        return time.monotonic() - self.ultimo_ok >= self.ocioso_s

    async def rodar(self):
        while True:
            lcu = await asyncio.to_thread(conectar, self.args.lockfile)
            if not lcu:
                if self.ocioso():
                    return f"ocioso {self.args.ocioso_min:g} min sem client"
                await asyncio.sleep(max(0.5, min(5, self.ocioso_s - (time.monotonic() - self.ultimo_ok))))
                continue
            self.ultimo_ok = time.monotonic()
            if not self.lcu or self.lcu.porta != lcu.porta:
                log.info("conectado ao client (porta %s)", lcu.porta)
                self.backfill_feito = False
            self.lcu = lcu
            if not self.backfill_feito and not (self.inicial and not self.inicial.done()):
                # em paralelo ao websocket: o 1º backfill (200 partidas) leva minutos
                self.inicial = asyncio.create_task(self.backfill_inicial())
            await self.escutar()

    async def backfill_inicial(self):
        try:
            await asyncio.to_thread(self.backfill_isolado)
            self.backfill_feito = True
        except Exception as e:
            log.warning("backfill falhou: %s", e)

    def backfill_isolado(self):
        c = banco.abrir(self.args.db)  # conexão própria: roda em outra thread
        try:
            return backfill(self.lcu, c)
        finally:
            c.close()

    async def escutar(self):
        """websocket WAMP até cair; volta para o laço reconectar"""
        from websockets.asyncio.client import connect
        uri = f"wss://127.0.0.1:{self.lcu.porta}/"
        try:
            async with connect(uri, ssl=self.lcu.ctx, subprotocols=["wamp"], max_size=None,
                               additional_headers={"Authorization": self.lcu.auth},
                               ping_interval=None, open_timeout=15) as ws:
                for ev in EVENTOS:
                    await ws.send(json.dumps([5, ev]))
                log.info("websocket assinado (%d eventos)", len(EVENTOS))
                await self.fase(await asyncio.to_thread(self.lcu.get, "/lol-gameflow/v1/gameflow-phase"))
                while True:
                    try:
                        bruto = await asyncio.wait_for(ws.recv(), 30)
                    except asyncio.TimeoutError:
                        if await asyncio.to_thread(self.lcu.vivo):
                            self.ultimo_ok = time.monotonic()
                            continue
                        log.info("LCU sem resposta; websocket abandonado")
                        return
                    self.ultimo_ok = time.monotonic()
                    if not bruto:
                        continue
                    try:
                        msg = json.loads(bruto)
                    except ValueError:
                        continue
                    if isinstance(msg, list) and len(msg) >= 3 and msg[0] == 8:
                        await self.evento(msg[1], msg[2] or {})
        except Exception as e:
            log.info("websocket caiu: %s: %s", type(e).__name__, e)
        await asyncio.sleep(2)

    async def evento(self, nome, corpo):
        # despacha pela uri, não pelo nome: assinatura genérica ("OnJsonApiEvent") chega com o nome genérico
        uri, dado = corpo.get("uri") or "", corpo.get("data")
        if uri == "/lol-gameflow/v1/gameflow-phase":
            await self.fase(dado)
        elif uri == "/lol-end-of-game/v1/eog-stats-block" and dado and corpo.get("eventType") != "Delete":
            banco.gravar_eog(self.c, dado)
            log.info("eog gravado (partida %s)", dado.get("gameId"))
            self.buscar_partida(dado.get("gameId"))
        elif uri == "/lol-ranked/v1/current-ranked-stats" and dado:
            banco.gravar_lp(self.c, "evento", dado)

    async def fase(self, fase):
        if not isinstance(fase, str):
            return
        gid = fila = None
        try:
            s = await asyncio.to_thread(self.lcu.get, "/lol-gameflow/v1/session")
            gd = (s or {}).get("gameData") or {}
            gid = gd.get("gameId") or None
            fila = ((gd.get("queue") or {}).get("id")) or None
        except Exception:
            pass
        banco.gravar_fase(self.c, fase, gid, fila)
        try:
            banco.gravar_lp(self.c, fase, await asyncio.to_thread(self.lcu.get, "/lol-ranked/v1/current-ranked-stats"))
        except Exception as e:
            log.warning("snapshot de LP falhou: %s", e)
        log.info("fase %s (partida %s)", fase, gid)
        if fase == "EndOfGame":
            self.buscar_partida(gid)

    def buscar_partida(self, gid):
        if self.buscando and not self.buscando.done():
            return
        self.buscando = asyncio.create_task(self.partida_nova(gid))

    async def partida_nova(self, gid):
        """o histórico demora a mostrar a partida: tenta com espera crescente"""
        for espera in (5, 10, 20, 40, 80, 160):
            await asyncio.sleep(espera)
            try:
                r = await asyncio.to_thread(self.backfill_isolado)
            except Exception as e:
                log.warning("busca da partida nova: %s", e)
                continue
            if not gid or banco.ids_completos(self.c) >= {gid}:
                log.info("partida nova %s no banco (%d novas)", gid, r["novas"])
                return
        log.warning("partida %s não apareceu no histórico; o próximo backfill recupera", gid)


def principal():
    ap = argparse.ArgumentParser(description="coletor de partidas do lol-client")
    ap.add_argument("--ocioso-min", type=float, default=10, help="sai após N min sem client (padrão 10)")
    ap.add_argument("--lockfile", help="caminho do lockfile (desliga a busca pelo processo)")
    ap.add_argument("--db", default=str(banco.DB_PADRAO))
    ap.add_argument("--so-backfill", action="store_true", help="só baixa o histórico e sai (sem trava)")
    args = ap.parse_args()
    configurar_log(console=bool(sys.stderr) and not sys.executable.lower().endswith("pythonw.exe"))

    if args.so_backfill:
        lcu = conectar(args.lockfile)
        if not lcu:
            log.info("so-backfill: client fechado")
            return 1
        c = banco.abrir(args.db)
        r = backfill(lcu, c, trabalhadores=6)
        c.close()
        if sys.stdout:
            print(json.dumps(r, ensure_ascii=False))
        return 0

    if not travar():
        return 0
    log.info("iniciado (pid %d, ocioso %g min)", os.getpid(), args.ocioso_min)
    motivo = "erro"
    try:
        motivo = asyncio.run(Coletor(args).rodar())
    except KeyboardInterrupt:
        motivo = "interrompido"
    except Exception:
        log.exception("falha no laço principal")
    finally:
        log.info("encerrado (%s)", motivo)
        destravar()
    return 0


if __name__ == "__main__":
    sys.exit(principal())
