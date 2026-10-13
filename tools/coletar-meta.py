# meta própria (plano v2, passo 17, C2): winrate de campeão por rota no elo do Gabriel, por
# amostragem: league-v4 entries do tier dele -> match-v5 ids de cada jogador -> partidas.
# Grava só agregável em dados/meta.db (campeão, rota, time, vitória, patch): nenhum puuid nem nome.
# Retomada: ids ainda não baixados ficam em `pendentes` e saem primeiro na próxima rodada.
# uso: doppler run --project pessoal --config prd --scope "C:/Users/Gabriel dos Anjos/.doppler-pessoal" --
#      python tools/coletar-meta.py [--partidas 300] [--tier EMERALD] [--divisoes I,II,III,IV] [--por-jogador 5]
# Custo: ~1,2 chamada de americas por partida nova (100 a cada 2 min): 300 partidas ≈ 7–8 min.
# Não rodar durante uma partida: divide o balde com o carregamento.
import argparse
import random
import sqlite3
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import riotapi  # noqa: E402

DB_META = RAIZ / "dados" / "meta.db"
ESQUEMA = """
create table if not exists partidas (
  match_id text primary key, criacao integer, duracao integer, patch text, fila integer, tier text,
  remake integer, gravado_em integer);
create table if not exists picks (
  match_id text, participante integer, campeao integer, rota text, time integer, vitoria integer,
  primary key (match_id, participante));
create table if not exists pendentes (match_id text primary key, tier text, ts integer);
create index if not exists ix_picks_campeao on picks (campeao, rota);
"""
ROTAS = ("TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY")
REMAKE_S = 300


def abrir(caminho=DB_META):
    caminho = Path(caminho)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(caminho, timeout=30)
    c.execute("pragma journal_mode=wal")
    c.executescript(ESQUEMA)
    return c


def patch_de(versao):
    p = str(versao or "").split(".")
    return ".".join(p[:2]) if len(p) >= 2 else None


def gravar(c, m, tier):
    """grava uma partida match-v5 (já anonimizada); False se não é Summoner's Rift 5x5"""
    info = m.get("info") or {}
    mid = (m.get("metadata") or {}).get("matchId")
    ps = info.get("participants") or []
    if info.get("mapId") != 11 or len(ps) != 10 or not mid:
        return False
    remake = int(info.get("gameDuration", 0) < REMAKE_S or any(p.get("gameEndedInEarlySurrender") for p in ps))
    with c:
        c.execute("insert or replace into partidas values (?,?,?,?,?,?,?,?)",
                  (mid, info.get("gameCreation"), info.get("gameDuration"), patch_de(info.get("gameVersion")),
                   info.get("queueId"), tier, remake, int(time.time() * 1000)))
        c.execute("delete from picks where match_id=?", (mid,))
        for p in ps:
            rota = p.get("teamPosition") or p.get("individualPosition") or ""
            c.execute("insert into picks values (?,?,?,?,?,?)",
                      (mid, p.get("participantId"), p.get("championId"), rota if rota in ROTAS else None,
                       p.get("teamId"), int(bool(p.get("win")))))
        c.execute("delete from pendentes where match_id=?", (mid,))
    return True


def tier_do_gabriel(api):
    """tier da Solo/Duo do Gabriel (Riot ID na tabela meta do lol.db -> account-v1 -> league-v4)"""
    db = RAIZ / "dados" / "lol.db"
    c = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
    r = c.execute("select valor from meta where chave='jogador'").fetchone()
    c.close()
    if not r or "#" not in r[0]:
        return None
    nome, tag = r[0].split("#", 1)
    conta = api.conta(nome, tag)
    for e in api.liga(conta["puuid"]) if conta else []:
        if e.get("queueType") == "RANKED_SOLO_5x5":
            return e.get("tier")
    return None


def principal():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--partidas", type=int, default=300, help="partidas novas nesta rodada (limite)")
    ap.add_argument("--tier", default=None, help="padrão: o da Solo/Duo do Gabriel")
    ap.add_argument("--divisoes", default="I,II,III,IV")
    ap.add_argument("--por-jogador", type=int, default=5)
    ap.add_argument("--fila", type=int, default=420)
    ap.add_argument("--paginas", type=int, default=10, help="sorteia jogadores das páginas 1..N de cada divisão")
    ap.add_argument("--dias", type=int, default=0,
                    help="só partidas dos últimos N dias (0 = sem corte; a 1ª coleta, sem corte, pegou 16.2 a 16.20)")
    ap.add_argument("--db", default=str(DB_META))
    a = ap.parse_args()
    api = riotapi.RiotAPI()
    if not api.tem_chave():
        print("LOL_RIOT_API_KEY ausente: rodar com doppler run (cabeçalho do arquivo)")
        return 2
    tier = (a.tier or tier_do_gabriel(api) or "").upper()
    if not tier:
        print("tier não descoberto: passe --tier")
        return 2
    c = abrir(a.db)
    t0 = time.time()
    novas = ignoradas = 0
    ja = {r[0] for r in c.execute("select match_id from partidas")}
    pend = [r[0] for r in c.execute("select match_id from pendentes")]
    print(f"tier {tier}, fila {a.fila}; no banco: {len(ja)} partidas, {len(pend)} pendentes; alvo +{a.partidas}")
    vistos = set()  # jogadores sorteados nesta rodada (só em memória)
    divisoes = [d.strip() for d in a.divisoes.split(",") if d.strip()]
    paginas = {}
    tentativas_vazias = 0

    def baixar(mid):
        nonlocal novas, ignoradas
        m = api.partida(mid, disco=riotapi.anonimizar_partida)
        if m and gravar(c, m, tier):
            novas += 1
            ja.add(mid)
        else:
            ignoradas += 1
            with c:
                c.execute("delete from pendentes where match_id=?", (mid,))
        if (novas + ignoradas) % 25 == 0:
            print(f"  {novas} novas, {ignoradas} ignoradas, chamadas {dict(api.contador)}, {time.time() - t0:.0f} s",
                  flush=True)

    try:
        while novas < a.partidas:
            pend = [r[0] for r in c.execute("select match_id from pendentes order by ts")]
            if pend:
                for mid in pend:
                    if novas >= a.partidas:
                        break
                    baixar(mid)
                continue
            div = random.choice(divisoes)
            pag = random.randint(1, a.paginas)
            chave = (div, pag)
            if chave not in paginas:
                paginas[chave] = [e.get("puuid") for e in api.entradas_liga(tier, div, pag) if e.get("puuid")]
                random.shuffle(paginas[chave])
            lista = [p for p in paginas[chave] if p not in vistos]
            if not lista:
                tentativas_vazias += 1
                if tentativas_vazias > 40:
                    print("sem jogadores novos para sortear")
                    break
                continue
            puuid = lista[0]
            vistos.add(puuid)
            ids = api.ids_partidas(puuid, n=a.por_jogador, fila=a.fila,
                                   desde_s=time.time() - a.dias * 86400 if a.dias else None)
            novos = [i for i in ids if i not in ja]
            with c:
                c.executemany("insert or ignore into pendentes values (?,?,?)",
                              [(i, tier, int(time.time() * 1000)) for i in novos])
    except KeyboardInterrupt:
        print("interrompido: o que faltou fica em pendentes")
    except riotapi.ErroRiot as e:
        print(f"parou: {e} (o que faltou fica em pendentes)")
    total = c.execute("select count(*), sum(remake=0) from partidas").fetchone()
    pend_n = c.execute("select count(*) from pendentes").fetchone()[0]
    print(f"fim: +{novas} novas ({ignoradas} ignoradas) em {time.time() - t0:.0f} s; chamadas {dict(api.contador)}; "
          f"banco: {total[0]} partidas ({total[1]} sem remake), {pend_n} pendentes")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
