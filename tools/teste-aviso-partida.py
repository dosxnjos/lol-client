# prova da janelinha de "partida encontrada" (plano voz/foco, passo 2b; coletor/aviso_partida.py), sem client:
#   A. contagem (texto_aviso): aceite em min(atraso, 10) pelo timer, sem atraso = até o ready check expirar;
#      alvo + folga sem resposta = o aceite não veio: volta a "expira em" com alerta
#   B. config: coach.aceiteFlutuante e coach.aceiteAtrasoS (padrão, número, null, inválido)
#   C. LCU.post monta POST com a credencial (urlopen trocado: nada vai à rede)
#   D. Coletor.fase com janelinha falsa: abre no ReadyCheck, não duplica, fecha ao sair, chave desligada
#      não abre, erro na janelinha não derruba a fase
#   E. janela real com LCU falsa: estilo sem foco, canto inferior direito, GetForegroundWindow intocado,
#      contagem, botões chamam accept/decline, some ao sair do ReadyCheck sem deixar thread nem janela,
#      fecha sozinha se ninguém fechar. Pulado com o jogo aberto ou com --sem-janela.
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


def novo_coletor(cfg, fab_aviso=None, lcu=None):
    arq = TMP / f"cfg-{time.monotonic_ns()}.json"
    arq.write_text(json.dumps(cfg), encoding="utf-8")
    args = SimpleNamespace(db=str(TMP / "teste.db"), ocioso_min=10, lockfile=None, config=str(arq))
    col = coletor.Coletor(args, None, fab_aviso=fab_aviso)
    col.lcu = lcu or LCUFalsa()
    return col


def integracao():
    criados = []

    class AvisoFalso:
        def __init__(self, lcu, atraso):
            self.atraso, self.aberto, self.fechado = atraso, False, False
            criados.append(self)

        def mostrar(self):
            self.aberto = True

        def fechar(self):
            self.fechado = True

    async def roteiro():
        col = novo_coletor({"aceiteFlutuante": True, "aceiteAtrasoS": 8}, AvisoFalso)
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
        col2 = novo_coletor({"aceiteFlutuante": False}, AvisoFalso)
        await col2.fase("ReadyCheck")
        caso("D5 aceiteFlutuante false não abre", len(criados) == 2)
        col3 = novo_coletor({"aceiteAtrasoS": None}, AvisoFalso)
        await col3.fase("ReadyCheck")
        caso("D6 padrão liga; null passa None (sem aceite automático)",
             len(criados) == 3 and criados[2].atraso is None)
        await col3.fase("Lobby")

        def quebra(lcu, atraso):
            raise RuntimeError("janela não nasceu")
        col4 = novo_coletor({}, quebra)
        await col4.fase("ReadyCheck")
        linha = col4.c.execute("select fase from sessoes order by rowid desc limit 1").fetchone()
        caso("D7 janelinha quebrada não derruba a fase (gravada no banco)", linha and linha[0] == "ReadyCheck", linha)
    asyncio.run(roteiro())


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

    def fab(lcu, atraso):
        a = aviso_partida.AvisoPartida(lcu, atraso)
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
        av = aviso_partida.AvisoPartida(LCUFalsa(timer0=5), 2).mostrar()
        av.esperar_pronto(5)
        caso("E17 alvo passou sem resposta: 'expira em', com alerta, botões ficam",
             esperar(lambda: (av.exibido or {}).get("fase") == "sem_aceite", 3)
             and (av.exibido or {}).get("botoes") and (av.exibido or {}).get("alerta"), (av.exibido or {}).get("linha"))
        u.UpdateWindow(av.hwnd)   # força o WM_PAINT com o alerta
        time.sleep(0.3)
        av.fechar()
        caso("E18 pintar o alerta não gera erro na janela", not avisos_log, avisos_log)
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
