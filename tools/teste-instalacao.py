# Prova da P4 do plano da publicação (roadmap/2026-10-19-publicacao-e-complemento-publico.md), parte do código:
#   (a) edição: EDICAO na raiz = pública; a pasta de trabalho (sem EDICAO na raiz) segue completa
#   (b) /ola e /config de um Coach + Coletor de verdade (servidor local na porta 0): a pública não anuncia mentor, draft,
#       carregamento, resumos nem expansoes, prende carregamento/mentor em false mesmo com o plugin mandando true, e /resumos
#       dá 404; a completa anuncia como antes. /ola traz edicao e pacote (pengu/versao.js)
#   (c) Coletor.fase("InProgress"): a pública não importa o medidor de travadas; a completa importa, e um ImportError dele
#       não derruba a fase (P0-d: antes derrubava o coach em todo InProgress)
#   (d) pasta do LoL: RiotClientInstalls.json (VALORANT fica fora), a aprendida primeiro, lockfile, game.cfg e Config\ por
#       ela; sem o client aberto, achar_lockfile não lança PowerShell
#   (e) monitor do painel: secundário de menor número, monitorPainel escolhe outro, o principal nunca
#   (f) calibração do chat: faixas_calibrar(2560, 1080) = as de antes; nos 35 prints gravados (2560x1080) a calibração e a
#       leitura são iguais às do código de antes (commit cd4a7d7); em prints falsos de 2560x1440 e 3840x2160 (o chat de um
#       print gravado, escalado pela altura) o código de antes não acha o chat e o de agora acha e lê (OCR do Windows)
# Nada de rede, nada na 8765 (servidor na porta 0), pastas no temp. Sem o client nem o jogo. Uso:
#   python tools/teste-instalacao.py [--sem-ocr]
import importlib.util
import json
import logging
import subprocess
import sys
import tempfile
import types
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import instalacao  # noqa: E402

GRAV = RAIZ / "temp" / "gravacao" / "20261013-071040" / "telas"
ANTES = "cd4a7d7"   # último commit com as faixas fixas de 2560x1080 (P4.1)
falhas = []
n_ok = [0]


def caso(nome, cond, detalhe=""):
    print(("ok     " if cond else "FALHOU ") + nome + (f"  [{detalhe}]" if detalhe and not cond else ""), flush=True)
    if cond:
        n_ok[0] += 1
    else:
        falhas.append(nome)


def http(porta, caminho, metodo="GET", corpo=None, origem="https://plugins"):
    req = urllib.request.Request(f"http://127.0.0.1:{porta}{caminho}", method=metodo,
                                 data=json.dumps(corpo).encode() if corpo is not None else None,
                                 headers={"Content-Type": "application/json", "Origin": origem})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"null")


# ---------- (a) edição ----------

def parte_a():
    with tempfile.TemporaryDirectory() as tmp:
        sem = instalacao.edicao(tmp)
        (Path(tmp) / "EDICAO").write_text("publica\n", encoding="utf-8")
        com = instalacao.edicao(tmp)
        (Path(tmp) / "EDICAO").write_text("qualquer coisa", encoding="utf-8")
        torto = instalacao.edicao(tmp)
    caso("(a) EDICAO na raiz = publica; sem ele = completa; conteúdo torto segue publica",
         (sem, com, torto) == ("completa", "publica", "publica"), f"{sem} {com} {torto}")
    caso("(a) pasta de trabalho: sem EDICAO na raiz (completa, como antes) e publico/EDICAO existe para o publicar.py",
         not (RAIZ / "EDICAO").exists() and instalacao.EDICAO == "completa" and not instalacao.PUBLICA
         and (RAIZ / "publico" / "EDICAO").is_file(), instalacao.EDICAO)
    caso("(a) versao() = a do pengu/versao.js", instalacao.versao() and instalacao.versao() == instalacao.versao(RAIZ)
         and instalacao.versao("C:/nao/existe") is None, str(instalacao.versao()))


# ---------- (b) e (c): Coach + Coletor de verdade ----------

class MentorFalso:
    def __init__(self, *a, **kw):
        self.ler_estado = None

    def rota_http(self, metodo, caminho, corpo):
        return 200, {"ok": True}

    def esperar(self, s=0):
        pass


class JanelaFalsa:
    def __getattr__(self, k):
        return lambda *a, **kw: None


class LCUFalsa:
    porta = 0
    auth = ""
    ctx = None

    def get(self, caminho, timeout=30):
        if caminho == "/lol-gameflow/v1/session":
            return {"gameData": {"gameId": 77, "queue": {"id": 400}}}
        raise urllib.error.HTTPError(caminho, 404, "Not Found", {}, None)

    def vivo(self):
        return True


def montar(publica, tmp):
    import coach_vivo
    import coletor
    instalacao.PUBLICA = publica
    db = Path(tmp) / "lol.db"
    cfg = Path(tmp) / "config.json"
    fab = {"mentor": lambda d, ler: MentorFalso(), "janela": lambda url, ligado: JanelaFalsa()}
    co = coach_vivo.Coach(db=db, porta=0, config=cfg, fabricas=fab)
    assert co.iniciar()
    col = coletor.Coletor(SimpleNamespace(db=str(db), ocioso_min=10, lockfile=None), co)
    return co, col, co.srv.httpd.server_address[1]


def parte_b():
    tudo = {"mentor", "draft", "carregamento", "resumos", "expansoes"}
    sempre = {"coach", "painel", "voz", "alertas", "minimapa", "feiticos", "revisao", "estado-partida", "contexto",
              "aceite-reserva", "aceite-flutuante", "atualizar"}
    res = {}
    for publica in (True, False):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:   # o banco do AoVivo fecha com o processo
            co, col, porta = montar(publica, tmp)
            try:
                st, ola = http(porta, "/ola")
                st_cfg, cfg = http(porta, "/config", "POST", {"coach": {"carregamento": True, "mentor": True,
                                                                         "monitorPainel": "\\\\.\\DISPLAY3"}})
                _, lido = http(porta, "/config")
                st_res, _ = http(porta, "/resumos?desde=0")
                draft_rota = "/draft" in co.srv.rotas_get
                mentor = co.mentor is not None
                antes = "draft" in sys.modules
                co.champ_select({"gameId": 1, "myTeam": [], "theirTeam": [], "actions": []})
                importou_draft = "draft" in sys.modules and not antes
                res[publica] = (st, ola, st_cfg, cfg, lido, st_res, draft_rota, mentor, importou_draft)
            finally:
                co.encerrar()
                col.c.close()
    instalacao.PUBLICA = False
    st, ola, st_cfg, cfg, lido, st_res, draft_rota, mentor, importou = res[True]
    rec = set(ola.get("recursos") or [])
    caso("(b) pública: /ola sem mentor, draft, carregamento, resumos nem expansoes", st == 200 and not rec & tudo,
         str(sorted(rec)))
    caso("(b) pública: /ola com coach, painel, voz, alertas, minimapa, feitiços, revisão, estado, contexto, aceite e atualizar",
         sempre <= rec, str(sorted(sempre - rec)))
    caso("(b) pública: /ola com edicao=publica, pacote = pengu/versao.js e a versão da ponte de antes",
         ola.get("edicao") == "publica" and ola.get("pacote") == instalacao.versao() and ola.get("versao") == 1
         and ola.get("app") == "lol-client-coletor", str(ola))
    caso("(b) pública: POST /config com carregamento e mentor true grava false (GET também); monitorPainel aceito",
         st_cfg == 200 and cfg["carregamento"] is False and cfg["mentor"] is False and lido["carregamento"] is False
         and lido["mentor"] is False and lido["monitorPainel"] == "\\\\.\\DISPLAY3", str({k: lido[k] for k in
                                                                                       ("carregamento", "mentor", "monitorPainel")}))
    caso("(b) pública: GET /resumos = 404; sem /draft pendurado, sem mentor, seleção não importa draft",
         st_res == 404 and not draft_rota and not mentor and not importou, f"{st_res} {draft_rota} {mentor} {importou}")
    st, ola, st_cfg, cfg, lido, st_res, draft_rota, mentor, importou = res[False]
    rec = set(ola.get("recursos") or [])
    caso("(b) completa (a instalação do mantenedor): /ola segue com mentor, draft, carregamento, resumos e expansoes",
         st == 200 and tudo <= rec and sempre <= rec and ola.get("edicao") == "completa", str(sorted(rec)))
    caso("(b) completa: carregamento e mentor true ficam true; /resumos 200; /draft e mentor pendurados",
         lido["carregamento"] is True and lido["mentor"] is True and st_res == 200 and draft_rota and mentor,
         f"{lido['carregamento']} {lido['mentor']} {st_res} {draft_rota} {mentor}")


def parte_c():
    import banco
    import coletor
    chamadas = []
    falso = types.ModuleType("travadas")
    falso.iniciar = lambda gid, db=None: chamadas.append(gid)
    guardado = sys.modules.get("travadas")
    try:
        for publica, modulo, esperado in ((True, falso, []), (False, falso, [77]), (False, None, [])):
            chamadas.clear()
            instalacao.PUBLICA = publica
            sys.modules["travadas"] = modulo   # None: o import levanta ImportError
            with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
                col = coletor.Coletor(SimpleNamespace(db=str(Path(tmp) / "x.db"), ocioso_min=10, lockfile=None), None)
                col.lcu = LCUFalsa()
                import asyncio
                erro = None
                try:
                    asyncio.run(col.fase("InProgress"))
                except Exception as e:
                    erro = e
                fases = [f for (f,) in col.c.execute("select fase from sessoes")]
                col.c.close()
            rotulo = "pública" if publica else ("completa" if modulo else "completa sem o módulo")
            caso(f"(c) {rotulo}: InProgress chega ao fim da fase ({'nenhum' if not esperado else '1'} medidor lançado)",
                 erro is None and chamadas == esperado and fases == ["InProgress"] and col.fase_atual == "InProgress",
                 f"erro {erro!r}, chamadas {chamadas}, fases {fases}")
    finally:
        instalacao.PUBLICA = False
        if guardado is not None:
            sys.modules["travadas"] = guardado
        else:
            sys.modules.pop("travadas", None)
    _ = banco


# ---------- (d) pasta do LoL ----------

def parte_d():
    import coletor
    import minimapa
    import teclas
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        lol = t / "Riot Games" / "League of Legends"
        val = t / "Riot Games" / "VALORANT" / "live"
        (lol / "Config").mkdir(parents=True)
        val.mkdir(parents=True)
        (lol / "Config" / "game.cfg").write_text("[General]\nWidth=1920\nHeight=1080\n", encoding="utf-8")
        (lol / "Config" / "input.ini").write_text("[GameEvents]\nevtX=[F7]\n", encoding="utf-8")
        arq = t / "RiotClientInstalls.json"
        arq.write_text(json.dumps({"associated_client": {lol.as_posix() + "/": "x", val.as_posix() + "/": "y"}}),
                       encoding="utf-8")
        outra = t / "outra"
        guarda = (instalacao.INSTALACOES_RIOT, instalacao.PASTA_LOL_RIOT, instalacao._aprendida[0],
                  instalacao.processo_existe)
        try:
            instalacao.INSTALACOES_RIOT, instalacao.PASTA_LOL_RIOT = arq, t / "padrao"
            # o client desta máquina pode estar aberto: a busca pela linha de comando acharia o lockfile real. Aqui o
            # client "fechado" (sem LeagueClientUx.exe) isola o teste nas pastas falsas
            instalacao.processo_existe = lambda nome: False
            instalacao.aprender(None)
            ps = instalacao.pastas_lol()
            caso("(d) RiotClientInstalls.json: a pasta do LoL entra, a do VALORANT não, a padrão da Riot por último",
                 ps == [lol, t / "padrao"], str(ps))
            caso("(d) game.cfg e Config\\ achados pela pasta do Riot Client (minimapa e teclas, sem caminho fixo)",
                 minimapa.game_cfg() == lol / "Config" / "game.cfg"
                 and minimapa.ler_game_cfg().get("General", {}).get("Width") == "1920"
                 and teclas.config_lol() == lol / "Config" and teclas.conflitos_no_lol(["F7", "F8"]) == {"F7": ["evtX"]},
                 f"{minimapa.game_cfg()} {teclas.config_lol()}")
            caso("(d) sem lockfile em nenhuma pasta conhecida e sem o client aberto: nada achado, nenhum PowerShell",
                 coletor.achar_lockfile() is None, "")
            (lol / "lockfile").write_text("LeagueClient:1:2:x:https", encoding="utf-8")
            coletor._ultima_busca[0] = -60.0
            achado = coletor.achar_lockfile()
            caso("(d) lockfile achado na pasta do Riot Client e a pasta aprendida (vale primeiro dali em diante)",
                 achado == lol / "lockfile" and instalacao.pastas_lol()[0] == lol, str(achado))
            instalacao.aprender(outra)
            caso("(d) a aprendida vem antes das do Riot Client", instalacao.pastas_lol()[0] == outra, "")
            arq.write_text("{não é json", encoding="utf-8")
            instalacao.aprender(None)
            caso("(d) RiotClientInstalls.json torto = só a padrão", instalacao.pastas_lol() == [t / "padrao"]
                 and minimapa.ler_game_cfg() == {} and teclas.conflitos_no_lol(["F7"]) == {}, "")
        finally:
            (instalacao.INSTALACOES_RIOT, instalacao.PASTA_LOL_RIOT, instalacao._aprendida[0],
             instalacao.processo_existe) = guarda
    # nesta máquina (só leitura): o RiotClientInstalls.json da Riot aponta a pasta de sempre, e o game.cfg segue achado
    real = instalacao.pastas_lol()
    caso("(d) nesta máquina: a pasta do LoL vem do RiotClientInstalls.json e o game.cfg segue achado (como antes)",
         real and (real[0] / "Config" / "game.cfg").exists() and minimapa.game_cfg() == real[0] / "Config" / "game.cfg",
         str(real))
    lancou = []
    original = subprocess.run
    subprocess.run = lambda *a, **kw: lancou.append(a) or original(*a, **kw)
    try:
        guarda = (instalacao.INSTALACOES_RIOT, instalacao.PASTA_LOL_RIOT, instalacao._aprendida[0])
        instalacao.INSTALACOES_RIOT, instalacao.PASTA_LOL_RIOT = Path("C:/nao/existe.json"), Path("C:/nao/existe")
        instalacao.aprender(None)
        processo = instalacao.processo_existe
        instalacao.processo_existe = lambda nome: False
        coletor._ultima_busca[0] = -60.0
        r = coletor.achar_lockfile()
        instalacao.processo_existe = processo
    finally:
        subprocess.run = original
        instalacao.INSTALACOES_RIOT, instalacao.PASTA_LOL_RIOT, instalacao._aprendida[0] = guarda
    caso("(d) client fechado (sem LeagueClientUx.exe): a busca pela linha de comando não lança PowerShell",
         r is None and not lancou, str(lancou))
    caso("(d) processo_existe: python.exe sim, nome inventado não",
         instalacao.processo_existe(Path(sys.executable).name) is True
         and instalacao.processo_existe("nao-existe-p4.exe") is False, "")


# ---------- (e) monitor do painel ----------

def parte_e():
    import janela_painel as J

    def m(n, prim=False):
        return {"dispositivo": f"\\\\.\\DISPLAY{n}", "primario": prim, "x": 0, "y": 0, "w": 1, "h": 1}
    dois = [m(2, True), m(1)]
    tres = [m(1, True), m(3), m(2)]
    doze = [m(1, True), m(12), m(2)]
    casos = [
        ("2 monitores, DISPLAY1 secundário (esta máquina)", J.monitor_do_painel(dois), "\\\\.\\DISPLAY1"),
        ("3 monitores: o secundário de menor número", J.monitor_do_painel(tres), "\\\\.\\DISPLAY2"),
        ("DISPLAY12 não vem antes do DISPLAY2", J.monitor_do_painel(doze), "\\\\.\\DISPLAY2"),
        ("monitorPainel escolhe outro secundário", J.monitor_do_painel(tres, "\\\\.\\display3"), "\\\\.\\DISPLAY3"),
        ("monitorPainel no principal: ignorado", J.monitor_do_painel(tres, "\\\\.\\DISPLAY1"), "\\\\.\\DISPLAY2"),
        ("monitorPainel desligado agora: o automático", J.monitor_do_painel(tres, "\\\\.\\DISPLAY9"), "\\\\.\\DISPLAY2"),
    ]
    for nome, r, esp in casos:
        caso(f"(e) {nome}", r and r["dispositivo"] == esp, str(r and r["dispositivo"]))
    caso("(e) um monitor só: nenhum (o painel não abre por cima do jogo)", J.monitor_do_painel([m(1, True)]) is None, "")
    real = J.monitor_do_painel()
    caso("(e) nesta máquina (só leitura dos monitores): o mesmo de antes (DISPLAY1)",
         real is not None and real["dispositivo"] == "\\\\.\\DISPLAY1", str(real and real["dispositivo"]))
    import servidor_local
    caso("(e) monitorPainel nasce vazio (automático) na config", servidor_local.ler_config("C:/nao/existe.json")
         ["monitorPainel"] == "", "")


# ---------- (f) calibração do chat por resolução ----------

def feiticos_antes(tmp):
    alvo = Path(tmp) / "feiticos_antes.py"
    alvo.write_bytes(subprocess.run(["git", "show", f"{ANTES}:coletor/feiticos.py"], cwd=RAIZ, capture_output=True,
                                    check=True).stdout)
    spec = importlib.util.spec_from_file_location("feiticos_antes", alvo)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def parte_f(com_ocr):
    import feiticos as F
    caso("(f) faixas_calibrar(2560, 1080) = as FAIXAS_CALIBRAR de antes", F.faixas_calibrar(2560, 1080) ==
         ((1000, 620, 2150, 1080), (0, 620, 1150, 1080)) == F.FAIXAS_CALIBRAR, str(F.faixas_calibrar(2560, 1080)))
    telas = [(1920, 1080), (2560, 1080), (2560, 1440), (3440, 1440), (3840, 2160), (1366, 768)]
    cabem = all(max(f[2] - f[0], f[3] - f[1]) * F.escala_ocr(f, 2) < F.OCR_MAX_PX and f[3] == h and f[1] >= 0
                and f[2] <= w for w, h in telas for f in F.faixas_calibrar(w, h))
    caso("(f) em 6 resoluções toda faixa × escala do OCR fica abaixo de 2600 px e dentro da tela", cabem, "")
    caso("(f) escala do OCR em 1080: 2 na calibração e 3 na leitura (como antes); maior baixa",
         F.escala_ocr((0, 620, 1150, 1080), 2) == 2 and F.escala_ocr((1405, 806, 1877, 976), 3) == 3
         and F.escala_ocr((0, 1240, 2300, 2160), 2) < 2, "")
    if not com_ocr:
        return
    if not GRAV.exists():
        caso("(f) prints gravados (temp/gravacao) presentes", False, str(GRAV))
        return
    from PIL import Image
    with tempfile.TemporaryDirectory() as tmp:
        A = feiticos_antes(tmp)
        ocr = F.OcrChat().iniciar()
        try:
            iguais, n, achados = 0, 0, 0
            for p in sorted(GRAV.glob("*.png")):
                im = Image.open(p).convert("RGB")
                c_novo, c_velho = F.calibrar_chat(im, ocr), A.calibrar_chat(im, ocr)
                n += 1
                achados += bool(c_novo)
                if c_novo != c_velho:
                    continue
                if c_novo:
                    t_novo = [x["t"] for x in ocr.ler(im.crop(c_novo), escala=F.escala_ocr(c_novo, 3))]
                    t_velho = [x["t"] for x in ocr.ler(im.crop(c_velho), escala=3)]
                    if t_novo != t_velho:
                        continue
                iguais += 1
            caso(f"(f) 2560x1080: calibração e leitura iguais às de antes nos {n} prints gravados ({achados} com chat)",
                 n >= 30 and iguais == n and achados >= 15, f"{iguais}/{n} iguais, {achados} com chat")

            base = Image.open(GRAV / "00562.0.png").convert("RGB")
            recorte = base.crop((1390, 770, 1900, 990))
            n_linhas = F.com_horario([x["t"] for x in ocr.ler(base.crop((1405, 806, 1877, 976)), escala=3)])
            for (w, h), lado in (((2560, 1440), "esquerda"), ((2560, 1440), "direita"), ((3840, 2160), "esquerda"),
                                 ((3840, 2160), "direita"), ((1920, 1080), "esquerda")):
                k = h / 1080
                rc = recorte.resize((round(recorte.width * k), round(recorte.height * k)), Image.LANCZOS)
                tela = Image.new("RGB", (w, h))
                x = round(20 * k) if lado == "esquerda" else round(w / 2 + 110 * k)
                y = h - round(90 * k) - rc.height
                tela.paste(rc, (x, y))
                novo = F.calibrar_chat(tela, ocr)
                velho = A.calibrar_chat(tela, ocr)
                lidas = F.com_horario([t["t"] for t in ocr.ler(tela.crop(novo), escala=F.escala_ocr(novo, 3))]) if novo else 0
                cobre = bool(novo) and novo[0] <= x + 20 * k and novo[3] >= y + rc.height - 60 * k
                velho_lidas = F.com_horario([t["t"] for t in ocr.ler(tela.crop(velho), escala=3)]) if velho else 0
                ok_velho = (velho is None or velho_lidas < n_linhas) if h > 1080 else True
                caso(f"(f) print falso {w}x{h}, chat {lado}: acha o chat e lê {lidas} de {n_linhas} linhas com horário"
                     + (f" (antes: {'nada' if velho is None else f'{velho_lidas} linhas'})" if h > 1080 else ""),
                     cobre and lidas >= n_linhas - 1 and ok_velho, f"novo {novo} lidas {lidas}, velho {velho} {velho_lidas}")
        finally:
            ocr.parar()


def principal():
    sys.stdout.reconfigure(encoding="utf-8")
    logging.getLogger("coletor").addHandler(logging.NullHandler())
    logging.getLogger("coletor").propagate = False
    com_ocr = "--sem-ocr" not in sys.argv
    parte_a()
    parte_b()
    parte_c()
    parte_d()
    parte_e()
    parte_f(com_ocr)
    print(f"{'ok' if not falhas else 'FALHOU'}: {n_ok[0]}/{n_ok[0] + len(falhas)}" + (f"; falhas: {falhas}" if falhas else ""))
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(principal())
