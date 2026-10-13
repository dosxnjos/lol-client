# teste do mentor (plano v2, passo 20) com a partida de referência 3292746609 (temp/gravacao/20261013-071040)
#   python tools/teste-mentor.py --seco       monta o prompt do pós-jogo e mostra o comando, sem chamar o Claude
#   python tools/teste-mentor.py --offline    fila de 1, --resume e rotas HTTP com um Claude falso
#   python tools/teste-mentor.py              1 chamada real (pós-jogo, <= 60 s) + 1 pergunta com --resume,
#                                             gravadas na tabela mentor de temp/mentor-teste.db (cópia do banco)
#   python tools/teste-mentor.py --comparar   matriz sonnet/haiku x low/medium (advisor opus) nos 3 usos
#                                             -> temp/mentor/*.json e temp/mentor/comparacao-bruta.md
# O banco real (dados/lol.db) só é lido; toda escrita vai para temp/.
import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import banco  # noqa: E402
import mentor  # noqa: E402

GAME = 3292746609
GRAVACAO = RAIZ / "temp" / "gravacao" / "20261013-071040"
DB_TESTE = RAIZ / "temp" / "mentor-teste.db"
SAIDA = RAIZ / "temp" / "mentor"
MATRIZ = [("sonnet", "low"), ("sonnet", "medium"), ("haiku", "low"), ("haiku", "medium")]
MOMENTOS = (480, 1200)   # ao vivo: min 8 e min 20


def amostra_live(gt):
    with open(GRAVACAO / "live.jsonl", encoding="utf-8") as f:
        for linha in f:
            d = json.loads(linha)["dados"]
            if d["gameData"]["gameTime"] >= gt:
                return d
    raise SystemExit(f"sem amostra com gameTime >= {gt}")


def amostra_com_nomes(gt):
    """a amostra gravada (já anonimizada) com Riot IDs falsos de volta, como a Live Client entrega"""
    d = json.loads(json.dumps(amostra_live(gt)))
    nome = {}
    for i, p in enumerate(d["allPlayers"]):
        nome[p["championName"]] = f"Fulano{i}"
        p.update(riotId=f"Fulano{i}#BR1", riotIdGameName=f"Fulano{i}", riotIdTagLine="BR1", summonerName=f"Fulano{i}")
    ap = d["activePlayer"]
    ap.update(riotId=f"{nome[ap['riotId']]}#BR1", riotIdGameName=nome[ap["riotId"]], riotIdTagLine="BR1",
              summonerName=nome[ap["riotId"]])
    for e in d["events"]["Events"]:
        for k in ("KillerName", "VictimName"):
            if e.get(k) in nome:
                e[k] = nome[e[k]]
        if e.get("Assisters"):
            e["Assisters"] = [nome.get(x, x) for x in e["Assisters"]]
    return d


def criacao(c):
    return c.execute("select criacao from partidas where game_id=?", (GAME,)).fetchone()[0]


def prompts(c):
    """os 3 usos da comparação: pós-jogo e ao vivo nos minutos 8 e 20 (histórico só de antes da partida)"""
    hist = mentor.historico_aovivo(c, "Zac", antes_de=criacao(c))
    out = {"posjogo": mentor.prompt_posjogo(c, GAME)}
    for gt in MOMENTOS:
        out[f"aovivo-{gt // 60}min"] = mentor.prompt_aovivo(amostra_live(gt), hist)
    return out


def dentro_de_dev(p):
    try:
        Path(p).resolve().relative_to(Path("C:/Dev").resolve())
        return True
    except ValueError:
        return False


def seco():
    c = banco.abrir_leitura()
    p = mentor.prompt_posjogo(c, GAME)
    cmd = mentor.comando()
    env = mentor.ambiente()
    vis = [a if a != mentor.SISTEMA else "<sistema: %d caracteres>" % len(a) for a in cmd]
    print("comando:", " ".join(json.dumps(a, ensure_ascii=False) if (" " in a or a == "") else a for a in vis))
    print(f"prompt: stdin, {len(p.encode('utf-8'))} bytes; 1ª linha: {p.splitlines()[1]}")
    print("cwd:", mentor.PASTA)
    print("env isolado:", {k: env[k] for k in ("BACKUP_RAIZ", "SESSOES_ABERTAS_IGNORAR", "CENTRAL_ORIGEM")})
    print("env CLAUDE* herdado:", sorted(k for k in env if k.upper().startswith("CLAUDE")) or "nenhum")
    falhas = []
    i = cmd.index("--tools")
    if cmd[i + 1] != "":
        falhas.append("ferramenta liberada (--tools não vazio)")
    if any(a in cmd for a in ("--allowedTools", "--allowed-tools", "--mcp-config", "--bare")):
        falhas.append("flag proibida no comando")
    for f in ("--safe-mode", "--strict-mcp-config", "--disable-slash-commands"):
        if f not in cmd:
            falhas.append(f"falta {f}")
    if cmd[cmd.index("--model") + 1] != "sonnet" or cmd[cmd.index("--advisor") + 1] != "opus":
        falhas.append("modelo ou advisor diferente de sonnet + opus")
    if dentro_de_dev(mentor.PASTA) or dentro_de_dev(env["BACKUP_RAIZ"]):
        falhas.append("cwd ou BACKUP_RAIZ dentro de C:\\Dev")
    if env["SESSOES_ABERTAS_IGNORAR"] != "1" or env["CENTRAL_ORIGEM"] != "ia:lol-client-mentor":
        falhas.append("env de isolamento errado")
    if any(k.upper().startswith("CLAUDE") for k in env):
        falhas.append("env CLAUDE* vazando")
    print("FALHOU: " + "; ".join(falhas) if falhas else "ok")
    return not falhas


def copiar_banco():
    """cópia consistente de dados/lol.db (WAL) para temp/, onde a tabela mentor pode ser escrita"""
    if DB_TESTE.exists():
        DB_TESTE.unlink()
    src, dst = banco.abrir_leitura(), sqlite3.connect(DB_TESTE)
    src.backup(dst)
    src.close()
    dst.close()


def offline():
    """Claude falso: confere fila de 1, --resume, gravação e rotas sem gastar cota"""
    import threading
    copiar_banco()
    chamadas, liberar = [], threading.Event()

    def falso(prompt, modelo, effort, advisor, resume=None, timeout=None):
        chamadas.append({"resume": resume, "prompt": prompt[:40]})
        liberar.wait(10)
        return {"texto": f"resposta {len(chamadas)}", "session_id": resume or "sessao-falsa-1", "duracao_ms": 5,
                "duracao_api_ms": 4, "modelo_usado": "falso", "custo_usd": 0, "erro": None}
    ok = []
    m = mentor.Mentor(DB_TESTE, ler_live=lambda: amostra_live(480), chamador=falso)
    s, r = m.rota_http("POST", f"/mentor/{GAME}")                     # 1: roda (preso no liberar)
    ok.append(("POST pós-jogo → 202", s == 202))
    time.sleep(0.3)
    s, r = m.rota_http("POST", f"/mentor/{GAME}/pergunta", json.dumps({"pergunta": "e o Ekko?"}).encode())
    ok.append(("pergunta com o pós-jogo rodando → 202 (fila)", s == 202))
    s, r = m.rota_http("POST", "/mentor/aovivo", b"{}")
    ok.append(("3º pedido com fila cheia → 429", s == 429))
    s, r = m.rota_http("GET", f"/mentor/{GAME}")
    ok.append(("GET → pensando, ocupado, 1 na fila", s == 200 and r["status"] == "pensando" and r["ocupado"]
               and r["na_fila"] == 1))
    liberar.set()
    m.esperar(10)
    s, r = m.rota_http("GET", f"/mentor/{GAME}")
    ok.append(("GET depois → pronto com 2 linhas", r["status"] == "pronto" and len(r["conversa"]) == 2
               and r["texto"] == "resposta 1"))
    ok.append(("pergunta usou --resume do pós-jogo", len(chamadas) == 2 and chamadas[1]["resume"] == "sessao-falsa-1"))
    ok.append(("pós-jogo não usa --resume", chamadas[0]["resume"] is None))
    s, r = m.rota_http("POST", "/mentor/123/pergunta", json.dumps({"pergunta": "oi"}).encode())
    m.esperar(10)
    st = m.estado(123)["conversa"][-1]
    ok.append(("pergunta sem pós-jogo → linha com erro", s == 202 and st["status"] == "erro" and "sem pós-jogo" in st["erro"]))
    ok.append(("pergunta vazia → 400", m.rota_http("POST", f"/mentor/{GAME}/pergunta", b'{"pergunta": " "}')[0] == 400))
    ok.append(("pergunta longa → 400", m.rota_http("POST", f"/mentor/{GAME}/pergunta",
                                                  json.dumps({"pergunta": "x" * 2000}).encode())[0] == 400))
    ok.append(("corpo inválido → 400", m.rota_http("POST", f"/mentor/{GAME}/pergunta", b"[1]")[0] == 400))
    ok.append(("rota desconhecida → 404", m.rota_http("GET", "/mentor/abc")[0] == 404))
    m.ler_live = lambda: amostra_com_nomes(480)
    s, r = m.rota_http("POST", "/mentor/aovivo", b"{}")
    m.esperar(10)
    p = sqlite3.connect(DB_TESTE).execute("select prompt from mentor where uso='aovivo' order by id desc").fetchone()[0]
    ok.append(("ao vivo com Riot ID na amostra → 202 e prompt só com campeões",
               s == 202 and "Fulano" not in p and "BR1" not in p and "Gabriel: Zac" in p))
    sem_live = mentor.Mentor(DB_TESTE, chamador=falso)
    ok.append(("ao vivo sem partida → 409", sem_live.rota_http("POST", "/mentor/aovivo")[0] == 409))
    c = sqlite3.connect(DB_TESTE)
    n = c.execute("select count(*) from mentor where game_id=? and status='pronto' and session_id is not null",
                  (GAME,)).fetchone()[0]
    ok.append(("tabela mentor com 2 linhas prontas e session_id", n == 2))
    for nome, v in ok:
        print(("ok     " if v else "FALHOU ") + nome)
    falhas = sum(not v for _, v in ok)
    print(f"{len(ok) - falhas}/{len(ok)} ok" if not falhas else f"FALHOU {falhas}/{len(ok)}")
    return not falhas


def real():
    copiar_banco()
    m = mentor.Mentor(DB_TESTE)
    t0 = time.time()
    rid = m.posjogo(GAME, bloquear=True)
    seg = time.time() - t0
    c = sqlite3.connect(DB_TESTE)
    linha = c.execute("select status, resposta, session_id, modelo_usado, duracao_ms, duracao_api_ms, custo_usd, erro "
                      "from mentor where id=?", (rid,)).fetchone()
    st, txt, sid, mod, dur, api, custo, erro = linha
    print(f"pós-jogo: status={st} em {seg:.1f} s (API {api and api / 1000:.1f} s), modelo={mod}, "
          f"custo lista US$ {custo or 0:.4f}, session_id={'sim' if sid else 'não'}, erro={erro}")
    print("-" * 60)
    print(txt)
    print("-" * 60)
    t1 = time.time()
    s, r = m.rota_http("POST", f"/mentor/{GAME}/pergunta",
                       json.dumps({"pergunta": "Qual das minhas mortes custou mais caro e por quê?"}).encode())
    m.esperar(180)
    est = m.estado(GAME)
    perg = est["conversa"][-1]
    print(f"pergunta: HTTP {s}, status={perg['status']} em {time.time() - t1:.1f} s, --resume da mesma sessão: "
          f"{c.execute('select count(distinct session_id) from mentor where game_id=?', (GAME,)).fetchone()[0] == 1}")
    print(perg["resposta"] or perg["erro"])
    ok = st == "pronto" and bool(txt) and seg <= 60
    print("ok" if ok else f"FALHOU (status {st}, {seg:.1f} s, texto {'vazio' if not txt else 'ok'})")
    return ok


def comparar(rodadas=1):
    """cada célula da matriz roda `rodadas` vezes (a rodada 1 em <uso>-<modelo>-<effort>.json, as outras com
    -r<k>); arquivo que já existe é reaproveitado, então rodar de novo com --rodadas 2 só faz a 2ª"""
    c = banco.abrir_leitura()
    ps = prompts(c)
    SAIDA.mkdir(parents=True, exist_ok=True)
    for uso, p in ps.items():
        (SAIDA / f"prompt-{uso}.txt").write_text(p, encoding="utf-8")
    res = {}
    for k in range(1, rodadas + 1):
        for uso, p in ps.items():
            for modelo, effort in MATRIZ:
                arq = SAIDA / f"{uso}-{modelo}-{effort}{'' if k == 1 else f'-r{k}'}.json"
                if arq.exists():
                    r = json.loads(arq.read_text(encoding="utf-8"))
                else:
                    r = mentor.chamar(p, modelo=modelo, effort=effort)
                    arq.write_text(json.dumps(r, ensure_ascii=False, indent=1), encoding="utf-8")
                res[(uso, modelo, effort, k)] = r
                print(f"r{k} {uso:14} {modelo:6} {effort:6} {(r['duracao_ms'] or 0) / 1000:5.1f} s  "
                      f"{r['modelo_usado']}  erro={r['erro']}", flush=True)
    L = ["# Mentor: saídas brutas da comparação (gerado por tools/teste-mentor.py --comparar)", ""]
    for uso in ps:
        L += [f"## {uso}", "", f"Prompt: `temp/mentor/prompt-{uso}.txt`", ""]
        for modelo, effort in MATRIZ:
            for k in range(1, rodadas + 1):
                r = res[(uso, modelo, effort, k)]
                L += [f"### {modelo} / {effort} · rodada {k} · {(r['duracao_ms'] or 0) / 1000:.1f} s (API "
                      f"{(r['duracao_api_ms'] or 0) / 1000:.1f} s) · {r['modelo_usado']}", "",
                      r["texto"] or f"(erro: {r['erro']})", ""]
    (SAIDA / "comparacao-bruta.md").write_text("\n".join(L), encoding="utf-8")
    print("->", SAIDA / "comparacao-bruta.md")
    return all(r["texto"] for r in res.values())


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--seco", action="store_true")
    g.add_argument("--offline", action="store_true")
    g.add_argument("--comparar", action="store_true")
    ap.add_argument("--rodadas", type=int, default=1, help="com --comparar: amostras por célula")
    a = ap.parse_args()
    if a.comparar:
        sys.exit(0 if comparar(a.rodadas) else 1)
    fn = seco if a.seco else offline if a.offline else real
    sys.exit(0 if fn() else 1)
