# prova do passo 1 (plano v2): retrato do champ select contra tests/fixtures/champselect-*.json
# cada fixture é uma sequência de eventos no formato do champselect.jsonl do tools/gravador.py:
#   {"ts", "lobby": {"preferidas"}} | {"ts", "session": {...}} | {"ts", "runa": {"id", "nome"}} | {"ts", "fase", "gameId"}
# grava num banco de teste em temp/ (nunca no dados/lol.db) e confere o que voltou do SQLite.
# extra: seleção desfeita antes da finalização não grava; e o fluxo pelo Coletor real com uma LCU falsa.
import asyncio
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import banco  # noqa: E402
import coletor  # noqa: E402

FIXTURES = sorted((RAIZ / "tests" / "fixtures").glob("champselect-*.json"))
DB = RAIZ / "temp" / "teste-champselect.db"
PROIBIDO = ("dummy-chat", "JWT-FALSO", "sala-falsa", "puuid-falso", "Jogador")  # chat e identidade


def abrir_limpo():
    for sufixo in ("", "-wal", "-shm"):
        Path(str(DB) + sufixo).unlink(missing_ok=True)
    return banco.abrir(DB)


def ler(c, chave):
    c.row_factory = None
    r = c.execute(f"select {','.join(banco.CS_COLUNAS)} from champ_select where chave=?", (chave,)).fetchone()
    return r and dict(zip(banco.CS_COLUNAS, r))


def conferir(nome, linha, esp, falhas):
    if not linha:
        falhas.append(f"{nome}: nada gravado")
        return
    j = lambda k: json.loads(linha[k]) if linha[k] else []  # noqa: E731
    bol = lambda v: None if v is None else bool(v)  # noqa: E731
    obtido = {"chave": linha["chave"], "game_id": linha["game_id"], "fila": linha["fila"],
              "posicao": linha["posicao"],
              "preferidas": linha["preferidas"].split(",") if linha["preferidas"] else None,
              "autofill": bol(linha["autofill"]), "autofill_riot": bol(linha["autofill_riot"]),
              "campeao": linha["campeao"], "campeoes_aliados": [p["campeao"] for p in j("aliados")],
              "campeoes_inimigos": [p["campeao"] for p in j("inimigos")],
              "bans_aliados": j("bans_aliados"), "bans_inimigos": j("bans_inimigos"),
              "runa_id": linha["runa_id"], "feiticos": j("feiticos"),
              "seg_ate_travar": linha["seg_ate_travar"], "desfeita": bool(linha["desfeita"])}
    for k, v in esp.items():
        if obtido.get(k) != v:
            falhas.append(f"{nome}.{k}: obtido {obtido.get(k)!r}, esperado {v!r}")
    texto = json.dumps(linha, ensure_ascii=False)
    for p in PROIBIDO:
        if p in texto:
            falhas.append(f"{nome}: '{p}' vazou para o banco")


def tocar_puro(c, eventos):
    """o mesmo caminho do coletor, sem websocket: RetratoChampSelect + banco"""
    cs = coletor.RetratoChampSelect()
    for e in eventos:
        if "lobby" in e:
            cs.preferidas(e["lobby"]["preferidas"])
        elif "runa" in e:
            cs.runa(e["runa"]["id"], e["runa"]["nome"])
        elif "session" in e:
            if cs.sessao(e["session"], e["ts"]):
                banco.gravar_champ_select(c, cs.retrato())
        elif e.get("fase") in coletor.FASES_JOGO:
            r = cs.fechar(e.get("gameId"))
            if r:
                banco.gravar_champ_select(c, r)


class LCUFalsa:
    """responde só GET, a partir do estado da fixture; qualquer outro uso quebra o teste"""
    porta = "0"

    def __init__(self):
        self.lobby, self.runa, self.fase, self.gid = None, None, "Lobby", None

    def get(self, caminho, timeout=30):
        if caminho == "/lol-lobby/v2/lobby":
            if self.lobby is None:
                raise OSError("404 sem lobby")
            return {"localMember": {"firstPositionPreference": (self.lobby + ["", ""])[0],
                                    "secondPositionPreference": (self.lobby + ["", ""])[1]}}
        if caminho == "/lol-perks/v1/currentpage":
            return self.runa
        if caminho == "/lol-gameflow/v1/session":
            return {"gameData": {"gameId": self.gid or 0, "queue": {"id": 0}}}
        if caminho == "/lol-ranked/v1/current-ranked-stats":
            return {}
        raise AssertionError(f"GET inesperado: {caminho}")


async def tocar_coletor(eventos):
    """mesma fixture pelo Coletor real (evento() + fase()) com LCU falsa e banco de teste"""
    args = type("A", (), {"ocioso_min": 10, "db": str(DB), "lockfile": None})()
    col = coletor.Coletor(args)
    col.lcu = LCUFalsa()
    relogio = [0]
    coletor.banco.agora_ms = lambda: relogio[0]  # o coletor carimba pelo relógio; aqui, pelo ts da fixture
    for e in eventos:
        relogio[0] = e["ts"]
        if "lobby" in e:
            col.lcu.lobby = e["lobby"]["preferidas"]
            await col.fase("Lobby")
        elif "runa" in e:
            col.lcu.runa = {"id": e["runa"]["id"], "name": e["runa"]["nome"]}
        elif "session" in e:
            await col.evento("OnJsonApiEvent", {"uri": "/lol-champ-select/v1/session", "eventType": "Update",
                                                 "data": e["session"]})
        elif "fase" in e:
            col.lcu.gid = e.get("gameId")
            await col.fase(e["fase"])
    await col.evento("OnJsonApiEvent", {"uri": "/lol-champ-select/v1/session", "eventType": "Delete", "data": None})
    return col.c


def principal():
    if len(FIXTURES) < 4:
        print(f"FALHOU: esperava 4 fixtures em tests/fixtures/champselect-*.json, achei {len(FIXTURES)}")
        return 1
    c = abrir_limpo()
    ok = 0
    for f in FIXTURES:
        fx = json.loads(f.read_text(encoding="utf-8"))
        falhas = []
        tocar_puro(c, fx["eventos"])
        conferir(f.stem, ler(c, fx["esperado"]["chave"]), fx["esperado"], falhas)
        print(f"{f.stem}: " + ("ok" if not falhas else "FALHOU\n  " + "\n  ".join(falhas)))
        ok += not falhas
    print(f"{ok}/{len(FIXTURES)} ok")

    # extras (não contam no N/N, mas falham o processo)
    extras = []
    cs = coletor.RetratoChampSelect()
    preferida = RAIZ / "tests" / "fixtures" / "champselect-preferida.json"
    fx = json.loads(preferida.read_text(encoding="utf-8"))
    sess = [e for e in fx["eventos"] if "session" in e]
    for e in sess[:2]:  # antes da FINALIZATION
        cs.sessao(e["session"], e["ts"])
    if cs.fechar(desfeita=True) is not None or cs.ativo:
        extras.append("desfeita antes da finalização: não devia gravar")
    if cs.sessao(sess[-1]["session"], 4) or cs.ativo:  # Update atrasado da sessão já fechada
        extras.append("Update atrasado de sessão fechada: não devia reabrir")
    cs = coletor.RetratoChampSelect()  # sessão com id vazio: a chave vem do gameId e o tardio segue ignorado
    sem_id = [{**e["session"], "id": ""} for e in sess]
    for i, s in enumerate(sem_id):
        cs.sessao(s, 1000 * i)
    r = cs.fechar(3300000001)
    if not r or r["chave"] != f"g{sem_id[0]['gameId']}" or cs.sessao(sem_id[-1], 9000) or cs.ativo:
        extras.append(f"sessão sem id: chave {r and r['chave']!r} ou Update atrasado reabriu")
    cs = coletor.RetratoChampSelect()  # coletor reconectado = processo novo, estado zerado
    cs.sessao(sess[-1]["session"], 5)  # 1ª sessão vista já com o pick travado
    if cs.retrato()["seg_ate_travar"] is not None:
        extras.append("reconexão no meio: seg_ate_travar devia ser null")
    c.close()
    for f in FIXTURES:
        fx = json.loads(f.read_text(encoding="utf-8"))
        cc = abrir_limpo()
        cc.close()
        cc = asyncio.run(tocar_coletor(fx["eventos"]))
        falhas = []
        conferir(f"coletor/{f.stem}", ler(cc, fx["esperado"]["chave"]), fx["esperado"], falhas)
        cc.close()
        extras += falhas
    # dodge depois da FINALIZATION, pelo Coletor: a linha já gravada vira desfeita=1, sem game_id,
    # e um Update atrasado da mesma sessão (FINALIZATION) depois do Lobby não a regrava
    fx = json.loads(preferida.read_text(encoding="utf-8"))
    fin = [e for e in fx["eventos"] if "session" in e][-1]
    ev = [e for e in fx["eventos"] if e.get("fase") is None] + [{"ts": 200000, "fase": "Lobby"},
                                                                 {**fin, "ts": 201000}]
    cc = abrir_limpo()
    cc.close()
    cc = asyncio.run(tocar_coletor(ev))
    linha = ler(cc, fx["esperado"]["chave"])
    if not linha or linha["desfeita"] != 1 or linha["game_id"] is not None:
        extras.append(f"dodge após a finalização: esperado desfeita=1 e game_id null, veio {linha and (linha['desfeita'], linha['game_id'])}")
    cc.close()
    print("extras (desfeita antes e depois da finalização, reconexão, fluxo pelo Coletor com LCU falsa): " + ("ok" if not extras else "FALHOU\n  " + "\n  ".join(extras)))
    return 0 if ok == len(FIXTURES) and not extras else 1


if __name__ == "__main__":
    sys.exit(principal())
