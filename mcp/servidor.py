# servidor MCP do lol-client (stdio): perguntas sobre as partidas do Gabriel no dados/lol.db
# registro: claude mcp add --scope user lol-client -- python C:\Dev\lol-client\mcp\servidor.py
# só leitura no banco (mode=ro), exceto sincronizar(). Nunca print em stdout: é o canal do MCP.
import sys
import time
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "coletor"))
import analise  # noqa: E402
import banco  # noqa: E402
from mcp.server.fastmcp import FastMCP  # noqa: E402

mcp = FastMCP("lol-client")

FILAS = {420: "Ranqueada Solo/Duo", 440: "Ranqueada Flex", 400: "Normal Escolha", 430: "Normal Às Cegas",
         490: "Partida Rápida", 450: "ARAM", 700: "Clash", 900: "URF", 1700: "Arena", 1900: "URF",
         3100: "Personalizada", 3140: "Treino"}
REMAKE_S = analise.REMAKE_S
FORA_DAS_CONTAS = analise.FORA_DAS_CONTAS  # personalizada e treino não entram em winrate, tilt, campeões
NORMAIS = (400, 430, 490)  # fila="normal": escolha, às cegas e partida rápida
SESSAO_GAP_MS = 2 * 3600 * 1000  # derrotas seguidas só contam dentro de uma sessão (pausa < 2 h)


def _conn():
    return banco.abrir_leitura()


def _sem_banco():
    return {"erro": "banco vazio: abra o client do LoL (o coletor roda sozinho) ou chame sincronizar()"}


def _nomes(c):
    return dict(c.execute("select id, nome from campeoes"))


def _campeao_id(c, campeao):
    """aceita id ou nome (sem caixa nem acento exato: prefixo)"""
    if campeao is None:
        return None
    if str(campeao).isdigit():
        return int(campeao)
    alvo = str(campeao).strip().lower()
    for cid, nome in c.execute("select id, nome from campeoes"):
        if nome and nome.lower().startswith(alvo):
            return cid
    return -1


def _fila_id(fila):
    """None (todas), tupla de queueIds, ou -1 (não reconhecida)"""
    if fila is None:
        return None
    if str(fila).isdigit():
        return (int(fila),)
    alvo = str(fila).lower()
    if "solo" in alvo:
        return (420,)
    if "flex" in alvo:
        return (440,)
    if alvo == "normal":
        return NORMAIS
    ids = tuple(k for k, v in FILAS.items() if alvo in v.lower())
    return ids or -1


def _data(ms):
    return datetime.fromtimestamp(ms / 1000).strftime("%d/%m/%Y %H:%M")


def _minhas(c, desde_ms=0, so_fila=True):
    """minhas partidas do Rift (mais antiga primeiro); so_fila tira personalizada e treino"""
    sql = ("select pa.game_id, pa.criacao, pa.duracao, pa.fila, pa.mapa, pp.campeao, pp.vitoria, "
           "pp.kills, pp.deaths, pp.assists, pp.cs_tropas, pp.cs_selva from partidas pa "
           "join participantes pp on pp.game_id = pa.game_id and pp.eu = 1 where pa.criacao >= ? and pa.mapa = 11"
           + (f" and pa.fila not in {FORA_DAS_CONTAS}" if so_fila else "") + " order by pa.criacao")
    cols = ("game_id", "criacao", "duracao", "fila", "mapa", "campeao", "vitoria", "k", "d", "a", "cs1", "cs2")
    return [dict(zip(cols, r)) for r in c.execute(sql, (desde_ms,))]


def _papel(c, gid):
    g = banco.ler_partida(c, gid)
    fr = banco.ler_frames(c, gid)
    eu = c.execute("select participant_id from participantes where game_id=? and eu=1", (gid,)).fetchone()
    p = g and fr and eu and analise.papeis(g, fr)
    return p and p["papel"].get(eu[0])


def _wr(v, n):
    return round(100 * v / n, 1) if n else None


@mcp.tool()
def resumo(dias: int = 7) -> dict:
    """Resumo do desempenho do Gabriel no LoL nos últimos `dias` dias (padrão 7):
    partidas, vitórias, derrotas, winrate, LP ganho/perdido na Solo/Duo (quando houver
    snapshots do coletor), campeões e posições mais jogadas. Use para "como fui essa semana?"."""
    try:
        c = _conn()
    except FileNotFoundError:
        return _sem_banco()
    desde = int((time.time() - dias * 86400) * 1000)
    ps = [p for p in _minhas(c, desde) if p["duracao"] >= REMAKE_S]
    nomes = _nomes(c)
    v = sum(p["vitoria"] for p in ps)
    lps = c.execute("select ts, tier, divisao, pontos from lp where fila='RANKED_SOLO_5x5' and ts >= ? "
                    "order by id", (desde,)).fetchall()
    atual = c.execute("select tier, divisao, pontos, vitorias, derrotas from lp where fila='RANKED_SOLO_5x5' "
                      "order by id desc limit 1").fetchone()
    posicoes = Counter(_papel(c, p["game_id"]) or "?" for p in ps)
    return {
        "periodo": f"últimos {dias} dias", "partidas": len(ps), "vitorias": v, "derrotas": len(ps) - v,
        "winrate": _wr(v, len(ps)),
        "por_fila": dict(Counter(FILAS.get(p["fila"], str(p["fila"])) for p in ps)),
        "campeoes": [{"campeao": nomes.get(k, k), "partidas": n} for k, n in Counter(p["campeao"] for p in ps).most_common(8)],
        "posicoes": dict(posicoes.most_common()),
        "lp_solo": {"inicio": f"{lps[0][1]} {lps[0][2]} {lps[0][3]} LP", "fim": f"{lps[-1][1]} {lps[-1][2]} {lps[-1][3]} LP"}
        if len(lps) >= 2 else None,
        "elo_atual_solo": atual and f"{atual[0]} {atual[1]} {atual[2]} LP ({atual[3]}V {atual[4]}D na temporada)",
        "obs": "remakes (< 5 min), personalizada e treino fora; LP só existe a partir das sessões em que o coletor rodou",
    }


@mcp.tool()
def partidas(limite: int = 20, campeao: str | None = None, fila: str | None = None) -> list | dict:
    """Lista as partidas mais recentes do Gabriel (todas as filas, só Summoner's Rift),
    da mais nova para a mais velha. Filtros opcionais: `campeao` (nome, ex. "Renekton", ou id)
    e `fila` ("solo", "flex", "normal" = escolha + às cegas + partida rápida, ou o queueId). Cada item traz game_id (use em
    analise_partida), data, fila, campeão, resultado, KDA, CS e CS/min."""
    try:
        c = _conn()
    except FileNotFoundError:
        return _sem_banco()
    nomes = _nomes(c)
    cid, fid = _campeao_id(c, campeao), _fila_id(fila)
    if cid == -1:
        return {"erro": f"campeão '{campeao}' não encontrado (use o nome como aparece no client, ex. 'Renekton', ou o id)"}
    if fid == -1:
        return {"erro": f"fila '{fila}' não reconhecida (use 'solo', 'flex', 'normal', 'treino' ou o queueId; só Summoner's Rift)"}
    out = []
    for p in reversed(_minhas(c, so_fila=False)):
        if (cid is not None and p["campeao"] != cid) or (fid is not None and p["fila"] not in fid):
            continue
        cs = p["cs1"] + p["cs2"]
        out.append({
            "game_id": p["game_id"], "data": _data(p["criacao"]), "fila": FILAS.get(p["fila"], p["fila"]),
            "campeao": nomes.get(p["campeao"], p["campeao"]),
            "resultado": "remake" if p["duracao"] < REMAKE_S else ("vitória" if p["vitoria"] else "derrota"),
            "kda": f"{p['k']}/{p['d']}/{p['a']}", "cs": cs,
            "cs_min": round(cs / (p["duracao"] / 60), 1), "duracao": analise.mmss(p["duracao"] * 1000)})
        if len(out) >= limite:
            break
    return out


@mcp.tool()
def analise_partida(game_id: int | None = None) -> dict:
    """Análise pós-jogo de uma partida (padrão: a última do Summoner's Rift): papel e adversário
    de rota, cada morte (tempo, região do mapa, quantos inimigos, aliados perto, objetivo que o
    inimigo pegou até 90 s depois), diferença de ouro/xp/farm contra o adversário aos 10 e 15 min
    e farm por minuto contra a média das últimas 20 partidas com o mesmo campeão. Heurística sobre
    1 frame por minuto (regras em docs/INSIGHTS.md): mostra padrões, não veredito."""
    try:
        c = _conn()
    except FileNotFoundError:
        return _sem_banco()
    r = analise.analisar(c, game_id)
    if "erro" in r:
        return r
    nomes = _nomes(c)
    g = banco.ler_partida(c, r["gameId"])
    r["campeao_nome"] = nomes.get(r["campeao"], r["campeao"])
    r["data"] = _data(g["gameCreation"])
    r["fila"] = FILAS.get(g["queueId"], g["queueId"])
    r["duracao"] = analise.mmss(g["gameDuration"] * 1000)
    r["vitoria"] = bool(next(p for p in g["participants"] if p["participantId"] == r["participantId"])["stats"]["win"])
    if r["adversario"]:
        r["adversario"]["nome"] = nomes.get(r["adversario"]["campeao"], r["adversario"]["campeao"])
    for m in r["mortes"]:
        m["matador_campeao"] = next((nomes.get(p["championId"], p["championId"]) for p in g["participants"]
                                     if p["participantId"] == m["matador"]), "execução")
    f = r["farm"]
    for k in ("valor", "media", "diferenca"):
        if f[k] is not None:
            f[k] = round(f[k], 2)
    return r


@mcp.tool()
def tilt() -> dict:
    """Mede tilt: winrate da partida seguinte depois de 0, 1, 2 e 3+ derrotas seguidas (a
    sequência zera numa pausa de 2 h ou mais, que conta como nova sessão), winrate por posição
    da partida na sessão e por faixa de horário. Só Summoner's Rift, com todas as filas juntas
    numa sequência só (ranqueada, normal, partida rápida, URF, Clash); remakes, personalizada e
    treino fora."""
    try:
        c = _conn()
    except FileNotFoundError:
        return _sem_banco()
    ps = [p for p in _minhas(c) if p["duracao"] >= REMAKE_S]
    apos, ordem, horario = defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0])
    seq = pos = 0
    ant = None
    for p in ps:
        if ant is None or p["criacao"] - (ant["criacao"] + ant["duracao"] * 1000) >= SESSAO_GAP_MS:
            seq, pos = 0, 0
        pos += 1
        for chave, d in ((min(seq, 3), apos), (min(pos, 5), ordem)):
            d[chave][0] += p["vitoria"]
            d[chave][1] += 1
        h = datetime.fromtimestamp(p["criacao"] / 1000).hour
        faixa = "00-06" if h < 6 else "06-12" if h < 12 else "12-18" if h < 18 else "18-24"
        horario[faixa][0] += p["vitoria"]
        horario[faixa][1] += 1
        seq = 0 if p["vitoria"] else seq + 1
        ant = p
    return {
        "partidas": len(ps),
        "apos_derrotas_seguidas": [{"derrotas_antes": "3+" if k == 3 else k, "partidas": n, "winrate": _wr(v, n)}
                                   for k, (v, n) in sorted(apos.items())],
        "por_ordem_na_sessao": [{"partida_da_sessao": "5+" if k == 5 else k, "partidas": n, "winrate": _wr(v, n)}
                                for k, (v, n) in sorted(ordem.items())],
        "por_horario": [{"faixa": k, "partidas": n, "winrate": _wr(v, n)} for k, (v, n) in sorted(horario.items())],
        "obs": "amostra pequena por balde (< 15) é ruído; horário local do PC",
    }


@mcp.tool()
def campeoes(min_partidas: int = 3) -> list | dict:
    """Desempenho por campeão (só Summoner's Rift; remakes, personalizada e treino fora), com pelo menos `min_partidas`
    jogos: partidas, winrate, KDA médio, CS/min médio e última vez jogado. Ordenado por partidas."""
    try:
        c = _conn()
    except FileNotFoundError:
        return _sem_banco()
    nomes = _nomes(c)
    por = defaultdict(list)
    for p in _minhas(c):
        if p["duracao"] >= REMAKE_S:
            por[p["campeao"]].append(p)
    out = []
    for cid, ps in por.items():
        n = len(ps)
        if n < min_partidas:
            continue
        k, d, a = (sum(p[x] for p in ps) for x in ("k", "d", "a"))
        out.append({"campeao": nomes.get(cid, cid), "partidas": n, "winrate": _wr(sum(p["vitoria"] for p in ps), n),
                    "kda": round((k + a) / max(d, 1), 2), "kda_medio": f"{k / n:.1f}/{d / n:.1f}/{a / n:.1f}",
                    "cs_min": round(sum((p["cs1"] + p["cs2"]) / (p["duracao"] / 60) for p in ps) / n, 1),
                    "ultima": _data(max(p["criacao"] for p in ps))})
    return sorted(out, key=lambda x: -x["partidas"])


@mcp.tool()
def sincronizar() -> dict:
    """Baixa para o banco as partidas do histórico do client que ainda faltam (partida + linha
    do tempo). Só funciona com o client do LoL aberto. Use quando uma partida recente não
    aparece nas outras ferramentas. É a única ferramenta que escreve no banco. Baixa no máximo
    40 partidas por chamada (as mais recentes primeiro); se `restam` > 0, chame de novo."""
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "coletor"))
    import coletor
    lcu = coletor.conectar()
    if not lcu:
        return {"erro": "client do LoL fechado: abra o client e tente de novo"}
    c = banco.abrir()
    try:
        return coletor.backfill(lcu, c, trabalhadores=6, limite=40)
    finally:
        c.close()


if __name__ == "__main__":
    mcp.run()
