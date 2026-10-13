# simulador da Live Client Data API: toca o live.jsonl gravado pelo gravador (1 amostra/s, nomes já
# trocados por campeão) como se fosse a API de 127.0.0.1:2999, em HTTP simples.
#   python tools/simular-liveclient.py [--porta 2998] [--inicio <gt>|carregando] [--velocidade 1] [--pausado]
#   ao vivo: python coletor/ao_vivo.py --liveclient http://127.0.0.1:2998
# controle: GET /sim/ir?gt=900 (pula para o gameTime; "carregando" = 1ª amostra), /sim/vel?x=20, /sim/pausar,
# /sim/tocar, /sim/desligar (a API passa a dar 404, como fora da partida), /sim/ligar, /sim/estado.
# Porta padrão 2998 para não brigar com a Live Client de verdade numa partida.
import argparse
import json
import re
import sys
import threading
import time
from bisect import bisect_left
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

RAIZ = Path(__file__).resolve().parent.parent
GRAVACAO = RAIZ / "temp" / "gravacao" / "20261013-071040" / "live.jsonl"
_GT = re.compile(r'"gameTime":\s*([0-9.eE+-]+)')


class Fita:
    """as amostras em texto (parse só na hora de servir) + o relógio do simulador"""

    def __init__(self, caminho):
        self.linhas, self.gts = [], []
        with open(caminho, encoding="utf-8") as f:
            for linha in f:
                m = _GT.search(linha)
                if m:
                    self.linhas.append(linha)
                    self.gts.append(float(m.group(1)))
        if not self.linhas:
            raise SystemExit(f"nenhuma amostra em {caminho}")
        self.trava = threading.Lock()
        self.idx0, self.t0, self.vel = 0, time.monotonic(), 1.0
        self.pausado, self.ligado = False, True
        self.inicio_jogo = next((i for i, g in enumerate(self.gts) if g > 0.1), 0)

    def indice(self):
        with self.trava:
            if self.pausado:
                return self.idx0
            passo = int((time.monotonic() - self.t0) * self.vel)
            return min(len(self.linhas) - 1, self.idx0 + passo)

    def ir(self, gt):
        """gt None ou < 0: carregamento (1ª amostra); senão a 1ª amostra de jogo com gameTime >= gt"""
        if gt is None or gt < 0:
            i = 0
        else:
            i = max(self.inicio_jogo, bisect_left(self.gts, gt, lo=self.inicio_jogo))
        with self.trava:
            self.idx0, self.t0 = min(i, len(self.linhas) - 1), time.monotonic()

    def pausar(self, sim):
        i = self.indice()
        with self.trava:
            self.idx0, self.t0, self.pausado = i, time.monotonic(), sim

    def amostra(self):
        dado = json.loads(self.linhas[self.indice()])
        return dado.get("dados", dado)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, codigo, obj):
        corpo = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self):
        fita = self.server.fita
        u = urlsplit(self.path)
        q = parse_qs(u.query)
        if u.path.startswith("/liveclientdata/"):
            if not fita.ligado:
                self._json(404, {"errorCode": "RESOURCE_NOT_FOUND", "message": "simulador desligado"})
                return
            d = fita.amostra()
            partes = {"/liveclientdata/allgamedata": d, "/liveclientdata/gamestats": d.get("gameData"),
                      "/liveclientdata/activeplayer": d.get("activePlayer"),
                      "/liveclientdata/playerlist": d.get("allPlayers"),
                      "/liveclientdata/eventdata": d.get("events")}
            if u.path in partes:
                self._json(200, partes[u.path])
            else:
                self._json(404, {"errorCode": "RESOURCE_NOT_FOUND"})
            return
        if u.path == "/sim/ir":
            v = (q.get("gt") or ["carregando"])[0]
            fita.ir(None if v == "carregando" else float(v))
        elif u.path == "/sim/vel":
            i = fita.indice()
            with fita.trava:
                fita.idx0, fita.t0 = i, time.monotonic()
                fita.vel = max(0.1, float((q.get("x") or ["1"])[0]))
        elif u.path == "/sim/pausar":
            fita.pausar(True)
        elif u.path == "/sim/tocar":
            fita.pausar(False)
        elif u.path == "/sim/desligar":
            fita.ligado = False
        elif u.path == "/sim/ligar":
            fita.ligado = True
        elif u.path != "/sim/estado":
            self._json(404, {"erro": "não existe"})
            return
        i = fita.indice()
        self._json(200, {"indice": i, "total": len(fita.linhas), "gameTime": round(fita.gts[i], 1),
                         "pausado": fita.pausado, "ligado": fita.ligado})


def principal():
    ap = argparse.ArgumentParser(description="simulador da Live Client (toca live.jsonl gravado)")
    ap.add_argument("--gravacao", default=str(GRAVACAO), help="live.jsonl do gravador")
    ap.add_argument("--porta", type=int, default=2998)
    ap.add_argument("--inicio", default="carregando", help="gameTime inicial em s, ou 'carregando'")
    ap.add_argument("--velocidade", type=float, default=1.0, help="amostras por segundo real")
    ap.add_argument("--pausado", action="store_true", help="fica parado no início (mude com /sim/ir)")
    args = ap.parse_args()
    fita = Fita(args.gravacao)
    fita.vel = args.velocidade
    fita.ir(None if args.inicio == "carregando" else float(args.inicio))
    fita.pausado = args.pausado
    srv = ThreadingHTTPServer(("127.0.0.1", args.porta), Handler)
    srv.daemon_threads = True
    srv.fita = fita
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"simulador: {len(fita.linhas)} amostras (gameTime {fita.gts[0]:.1f}–{fita.gts[-1]:.1f}) "
          f"em http://127.0.0.1:{args.porta}", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(principal())
