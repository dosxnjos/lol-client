# prova da rota GET /resumos (Fase 4 de roadmap/2026-10-17-plugin-pengu-primeiro.md): as partidas próprias do banco no
# formato do acumulador do plugin (pengu/historico.js). Banco de teste numa pasta temporária, feito das fixtures
# versionadas (tests/fixtures: a partida 3292712362 com linha do tempo e o Riot ID e o puuid dos 10, mais o histórico
# da LCU); servidor de teste na porta 0 (o sistema escolhe uma livre). Nada aqui toca dados/ nem a 8765.
#   A. campos iguais aos CAMPOS de pengu/historico.js (mesma ordem)
#   B. a linha da 3292712362 igual à que o plugin calcula em JS (linhaDe, via node) para a mesma partida
#   C. só partidas que entram nas contas (ARAM, personalizada, treino e remake fora), mais recentes primeiro, desde e teto
#   D. privacidade: JSON sem gameName, tagLine, summonerName nem puuid/nome de outro jogador
#   E. pela rede: 200 com Origin do client, desde inválido = 400, sem banco = 404; recurso "resumos" só com banco
#   F. conta: partida gravada sob outra conta (outra conta logada neste PC) não sai; sem puuid no meta, nenhuma linha
# --real: mede também no dados/lol.db (só leitura, banco.abrir_leitura; imprime só contagem, tempo e bytes) e varre
# a privacidade nele.
# uso: python tools/teste-resumos.py [--real]
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import banco  # noqa: E402
import servidor_local  # noqa: E402

sys.stdout.reconfigure(encoding="utf-8")
FIX = RAIZ / "tests" / "fixtures"
ID = 3292712362
casos = []


def caso(nome, ok, detalhe=""):
    casos.append((nome, bool(ok)))
    print("ok" if ok else "FALHOU", nome, "" if ok else detalhe)


def ler(n):
    return json.loads((FIX / n).read_text(encoding="utf-8"))


def campos_js():
    m = re.search(r"export const CAMPOS = \[([^\]]*)\]", (RAIZ / "pengu" / "historico.js").read_text(encoding="utf-8"))
    return re.findall(r"'([^']+)'", m.group(1)) if m else None


def linha_js(game, timeline, puuid):
    """linhaDe do plugin (pengu/historico.js) na mesma partida, pelo node"""
    url = (RAIZ / "pengu" / "historico.js").as_uri()
    codigo = ("import { readFileSync } from 'node:fs';"
              f"const {{ linhaDe }} = await import({json.dumps(url)});"
              "const a = JSON.parse(readFileSync(0, 'utf8'));"
              "process.stdout.write(JSON.stringify(linhaDe(a.game, a.puuid, a.timeline)));")
    r = subprocess.run(["node", "--input-type=module", "-e", codigo], input=json.dumps({"game": game, "timeline": timeline, "puuid": puuid}),
                       capture_output=True, text=True, encoding="utf-8", timeout=60)
    if r.returncode:
        print(r.stderr[-800:])
        return None
    return json.loads(r.stdout)


def varrer(texto, outros_puuid, nomes):
    achados = [k for k in ("gameName", "tagLine", "summonerName", "participantIdentities") if k in texto]
    achados += ["puuid alheio" for p in outros_puuid if p and p in texto]
    achados += [f"nome ({len(n)})" for n in nomes if n in texto]
    return achados


def montar(caminho, game, timeline, puuid):
    c = banco.abrir(caminho)
    banco.meta(c, "puuid", puuid)
    for g in ler("historico.json")["games"]["games"]:   # só o próprio participante, sem linha do tempo
        if g["gameId"] != ID:
            banco.gravar_partida(c, g, puuid)
    banco.gravar_partida(c, game, puuid, timeline)
    # fora das contas: ARAM, personalizada, treino e remake (a mesma partida com outro id)
    for gid, extra in ((ID + 1, {"mapId": 12, "queueId": 450}), (ID + 2, {"queueId": 0}), (ID + 3, {"queueId": 3140}),
                       (ID + 4, {"gameDuration": 200})):
        banco.gravar_partida(c, {**game, "gameId": gid, "gameCreation": game["gameCreation"] + 1000 * (gid - ID), **extra}, puuid, timeline)
    return c


def principal():
    game, timeline, puuid = ler(f"game-{ID}.json"), ler(f"timeline-{ID}.json"), ler("summoner.json")["puuid"]
    outros = [i["player"]["puuid"] for i in game["participantIdentities"] if i["player"].get("puuid") not in (None, puuid)]
    nomes = [x for i in game["participantIdentities"] for x in (i["player"].get("gameName"), i["player"].get("summonerName"),
                                                                 i["player"].get("tagLine")) if isinstance(x, str) and len(x) >= 3]
    tmp = Path(tempfile.mkdtemp(prefix="teste-resumos-"))
    try:
        c = montar(tmp / "lol.db", game, timeline, puuid)

        # A
        cj = campos_js()
        caso("A campos de /resumos = CAMPOS de pengu/historico.js (mesma ordem)", cj == list(servidor_local.CAMPOS_RESUMO),
             [cj, servidor_local.CAMPOS_RESUMO])

        # B
        r = servidor_local.resumos_do_banco(c)
        por = {l[0]: dict(zip(r["campos"], l)) for l in r["linhas"]}
        js = linha_js(game, timeline, puuid)
        caso("B linha da 3292712362 igual à do plugin (linhaDe em JS, mesma partida)", js is not None and [por.get(ID, {}).get(k) for k in r["campos"]] == js,
             [js, por.get(ID)])
        o = por.get(ID, {})
        caso("B valores do teste-analise.py: 58 TOP contra 83, ouro10 171, ouro15 −368",
             (o.get("campeao"), o.get("papel"), o.get("adversario"), o.get("incerto"), o.get("ouro10"), o.get("ouro15")) == (58, "TOP", 83, 0, 171, -368), o)
        sem = next((x for g, x in por.items() if g != ID), {})
        caso("B partida sem linha do tempo no banco: papel, adversário, diferenças e mortes null; cs e vitória presentes",
             sem.get("papel") is None and sem.get("ouro10") is None and sem.get("mortes10") is None and isinstance(sem.get("cs"), int)
             and sem.get("vitoria") in (0, 1), sem)

        # C
        validas = sum(1 for g in ler("historico.json")["games"]["games"] if g["gameId"] != ID and g["mapId"] == 11
                      and g["queueId"] not in (0, 3100, 3140) and g["gameDuration"] >= 300) + 1
        ids = [l[0] for l in r["linhas"]]
        caso(f"C só as que entram nas contas ({validas}): ARAM, personalizada, treino e remake fora", len(ids) == validas
             and not any(i in ids for i in (ID + 1, ID + 2, ID + 3, ID + 4)), [len(ids), validas])
        cri = [l[1] for l in r["linhas"]]
        caso("C mais recentes primeiro", cri == sorted(cri, reverse=True))
        caso("C dono = puuid desta conta; v = 1", r["dono"] == puuid and r["v"] == 1)
        corte = sorted(ids)[len(ids) // 2]
        caso("C desde=<gameId>: só os maiores", all(l[0] > corte for l in servidor_local.resumos_do_banco(c, corte)["linhas"])
             and len(servidor_local.resumos_do_banco(c, corte)["linhas"]) == sum(1 for i in ids if i > corte))
        t3 = servidor_local.resumos_do_banco(c, 0, teto=3)["linhas"]
        caso("C teto: as 3 mais recentes", [l[0] for l in t3] == ids[:3])
        caso("C linha com no máximo 160 bytes", max(len(json.dumps(l, separators=(",", ":"))) for l in r["linhas"]) <= 160)

        # D
        texto = json.dumps(r, ensure_ascii=False)
        caso("D a fixture tem o que a varredura procura (9 puuids alheios, nomes)", len(outros) == 9 and len(nomes) >= 10)
        caso("D JSON de /resumos sem gameName, tagLine, summonerName nem puuid/nome de outro jogador", not varrer(texto, outros, nomes),
             varrer(texto, outros, nomes))
        mut = json.loads(texto)
        mut["linhas"][0].append(game["participantIdentities"])
        caso("D mutação (identidades na linha) deixa a varredura vermelha", varrer(json.dumps(mut, ensure_ascii=False), outros, nomes))

        # F. conta: outra conta que jogou neste PC (o coletor grava `eu` pelo puuid da sessão daquele momento e reescreve
        # o meta puuid a cada login) nunca sai no /resumos desta conta com dono = esta (revisão adversarial da Fase 4)
        b, gid_b = outros[0], ID + 10
        banco.gravar_partida(c, {**game, "gameId": gid_b, "gameCreation": game["gameCreation"] + 10_000}, b, timeline)
        ra = servidor_local.resumos_do_banco(c)
        ids_a = [l[0] for l in ra["linhas"]]
        caso("F partida gravada sob outra conta não sai no /resumos desta conta (o resto igual)", gid_b not in ids_a and ids_a == ids
             and ra["dono"] == puuid, [gid_b in ids_a, len(ids_a), len(ids)])
        banco.meta(c, "puuid", b)
        rb = servidor_local.resumos_do_banco(c)
        meu_b = next(p for p in game["participants"] if p["participantId"] == next(
            i["participantId"] for i in game["participantIdentities"] if i["player"].get("puuid") == b))
        caso("F com a outra conta logada (meta = B): só a partida dela, com o campeão dela",
             [l[0] for l in rb["linhas"]] == [gid_b] and rb["dono"] == b and rb["linhas"][0][4] == meu_b["championId"],
             [[l[0] for l in rb["linhas"]], rb["dono"] == b])
        c.execute("delete from meta where chave = 'puuid'")
        r0 = servidor_local.resumos_do_banco(c)
        caso("F sem puuid no meta: nenhuma linha", r0["linhas"] == [] and r0["dono"] is None, len(r0["linhas"]))
        banco.meta(c, "puuid", puuid)
        c.commit()
        c.close()

        # E
        srv = servidor_local.ServidorLocal(porta=0, config=tmp / "cfg.json", db=tmp / "lol.db")
        nu = servidor_local.ServidorLocal(porta=0, config=tmp / "cfg.json", db=tmp / "nao.db")
        caso("E recurso 'resumos' só com banco", "resumos" in srv.recursos() and "resumos" not in nu.recursos(), [srv.recursos(), nu.recursos()])
        if not (srv.iniciar() and nu.iniciar()):
            caso("E portas de teste livres", False)
        else:
            def get(s, caminho, origem="https://127.0.0.1:54321"):
                req = urllib.request.Request(f"http://127.0.0.1:{s.httpd.server_address[1]}{caminho}", headers={"Origin": origem})
                try:
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        return resp.status, json.loads(resp.read())
                except urllib.error.HTTPError as e:
                    return e.code, None
            try:
                st, d = get(srv, "/resumos?desde=0")
                caso("E GET /resumos?desde=0 com Origin do client: 200 e o mesmo da função", st == 200 and d == json.loads(texto), st)
                caso("E desde inválido: 400", get(srv, "/resumos?desde=abc")[0] == 400)
                caso("E sem banco: 404", get(nu, "/resumos?desde=0")[0] == 404)
                caso("E site qualquer (Origin de fora): recusado", get(srv, "/resumos?desde=0", "https://exemplo.com")[0] == 403)
            finally:
                srv.parar()
                nu.parar()

        if "--real" in sys.argv and banco.DB_PADRAO.exists():
            cr = banco.abrir_leitura()
            try:
                t = time.perf_counter()
                rr = servidor_local.resumos_do_banco(cr)
                s = time.perf_counter() - t
                tr = json.dumps(rr, ensure_ascii=False)
                alheios = [p for (p,) in cr.execute("select distinct puuid from participantes where puuid is not null and puuid <> ?",
                                                    (rr["dono"],))]
                print(f"real: {len(rr['linhas'])} partidas, {sum(1 for l in rr['linhas'] if l[5])} com papel, {s:.2f} s, {len(tr)} bytes")
                caso("real: sem gameName/tagLine/summonerName nem puuid alheio", not varrer(tr, alheios, []))
            finally:
                cr.close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    ok = sum(1 for _, p in casos if p)
    print(f"{ok}/{len(casos)} ok")
    return 0 if ok == len(casos) else 1


if __name__ == "__main__":
    sys.exit(principal())
