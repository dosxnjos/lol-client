# champ select (plano v2, passo 17): rota provável do inimigo (C2) e força do draft em faixa (C3).
# Na normal draft a rota do inimigo NÃO vem do LCU (theirTeam[].assignedPosition = "",
# docs/MEDICAO-2026-10-13.md § 2): é inferência pelo campeão, resolvida como atribuição dos 5
# inimigos às 5 rotas. No carregamento a Live Client traz a rota declarada e o smite: `fixos`.
# Força: modelo aditivo em log-odds (docs/MERCADO.md § 3), faixa e não %, com os termos que mais pesaram.
# Fontes: dados/meta.db (tools/coletar-meta.py) + histórico do Gabriel (dados/lol.db). Nada de identidade.
import itertools
import json
import math
import sqlite3
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analise  # noqa: E402
import banco  # noqa: E402

ROTAS = ("TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY")
DB_META = banco.RAIZ / "dados" / "meta.db"
SMITE = 11
ALFA = 0.5          # suavização da contagem campeão→rota (campeão nunca visto = uniforme)
K_META = 1000       # WR de campeão na rota encolhido para 50% com 1000 jogos fictícios (MERCADO § 3)
K_PESSOAL = 50      # teu WR com o campeão encolhido para o WR do campeão na meta
K_MATCHUP = 20      # teu histórico contra o adversário encolhido para o teu WR com o campeão
FAIXAS = ((58, "vantagem clara"), (53, "leve vantagem"), (47, "equilibrada"), (42, "leve desvantagem"),
          (0, "desvantagem clara"))
PP_MINIMO = 0.5     # termo abaixo disso (em pontos percentuais) não aparece entre os que pesaram


def abrir_meta(caminho=DB_META):
    caminho = Path(caminho)
    if not caminho.exists():
        return None
    return sqlite3.connect(f"file:{caminho.as_posix()}?mode=ro", uri=True, timeout=30)


# ---------- histórico ----------

def historico_lol(c, puuid=None):
    """das minhas partidas com linha do tempo (fora treino/personalizada/remake): papel dos 10 pela
    regra de docs/INSIGHTS.md, meu campeão/papel, adversário de rota e resultado"""
    puuid = puuid or banco.meta(c, "puuid")
    ids = [r[0] for r in c.execute(
        "select game_id from partidas where mapa=11 and tem_timeline=1 and eu is not null "
        f"and fila not in {analise.FORA_DAS_CONTAS} and duracao >= {analise.REMAKE_S} order by criacao")]
    out = []
    for gid in ids:
        g = banco.ler_partida(c, gid)
        pap = analise.papeis(g, banco.ler_frames(c, gid))
        if not pap:
            continue
        eu = next((i["participantId"] for i in g["participantIdentities"]
                   if (i.get("player") or {}).get("puuid") == puuid), None)
        ps = {p["participantId"]: p for p in g["participants"]}
        if eu not in ps:
            continue
        meu_papel = pap["papel"][eu]
        adv = next((p["championId"] for pid, p in ps.items()
                    if p["teamId"] != ps[eu]["teamId"] and pap["papel"].get(pid) == meu_papel), None)
        out.append({"game_id": gid, "vitoria": bool(ps[eu]["stats"]["win"]), "campeao": ps[eu]["championId"],
                    "papel": meu_papel, "adversario": adv,
                    "rotas": [(p["championId"], pap["papel"][pid]) for pid, p in ps.items()]})
    return out


def contagens_rota(conn_meta=None, hist=None):
    """{campeao: {rota: n}} somando a meta coletada e o histórico do Gabriel (papéis pela linha do tempo)"""
    cont = defaultdict(lambda: defaultdict(int))
    if conn_meta is not None:
        for cid, rota, n in conn_meta.execute(
                "select p.campeao, p.rota, count(*) from picks p join partidas m on m.match_id = p.match_id "
                "where m.remake = 0 and p.rota is not null group by p.campeao, p.rota"):
            cont[cid][rota] += n
    for h in hist or []:
        for cid, rota in h["rotas"]:
            cont[cid][rota] += 1
    return cont


def prob_rotas(contagens, campeao):
    c = contagens.get(campeao) or {}
    tot = sum(c.values()) + ALFA * len(ROTAS)
    return {r: (c.get(r, 0) + ALFA) / tot for r in ROTAS}


def rotas_provaveis(campeoes, contagens, fixos=None):
    """atribui cada campeão (≤ 5, de um time) a uma rota distinta maximizando ∏ P(rota|campeão).
    fixos: {campeao: rota} (rota declarada ou smite no carregamento). Devolve {"rotas": {campeao: rota},
    "confianca": {campeao: P marginal da rota escolhida}, "fonte": {campeao: "fixo"|"inferido"}}"""
    campeoes = [c for c in campeoes if c and c > 0]
    fixos = {c: r for c, r in (fixos or {}).items() if c in campeoes and r in ROTAS}
    probs = {c: prob_rotas(contagens, c) for c in campeoes}
    perms = []
    for rs in itertools.permutations(ROTAS, len(campeoes)):
        if any(fixos.get(c, r) != r for c, r in zip(campeoes, rs)):
            continue
        perms.append((math.prod(probs[c][r] if c not in fixos else 1.0 for c, r in zip(campeoes, rs)), rs))
    if not perms:  # fixos conflitantes (duas rotas iguais): ignora os fixos
        return rotas_provaveis(campeoes, contagens)
    total = sum(p for p, _ in perms) or 1.0
    melhor = max(perms)[1]
    marg = defaultdict(float)
    for p, rs in perms:
        for c, r in zip(campeoes, rs):
            marg[(c, r)] += p / total
    return {"rotas": dict(zip(campeoes, melhor)),
            "confianca": {c: round(marg[(c, r)], 3) for c, r in zip(campeoes, melhor)},
            "fonte": {c: "fixo" if c in fixos else "inferido" for c in campeoes}}


# ---------- força do draft ----------

def logit(p):
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def sigmoide(x):
    return 1 / (1 + math.exp(-x))


def encolher(v, n, k, base=0.5):
    return (v + k * base) / (n + k)


def faixa(p):
    pct = 100 * p
    return next(nome for corte, nome in FAIXAS if pct >= corte)


def wr_meta(conn_meta):
    """função (campeao, rota) -> (vitórias, jogos) na meta coletada (sem remake)"""
    tab = {}
    if conn_meta is not None:
        for cid, rota, v, n in conn_meta.execute(
                "select p.campeao, p.rota, sum(p.vitoria), count(*) from picks p join partidas m "
                "on m.match_id = p.match_id where m.remake = 0 and p.rota is not null group by p.campeao, p.rota"):
            tab[(cid, rota)] = (v, n)
    return lambda campeao, rota: tab.get((campeao, rota), (0, 0))


def indices_pessoais(hist):
    """(pessoal(campeao, rota) -> (v, n), matchup(meu, adversario) -> (v, n)) do histórico do Gabriel"""
    pes, mat = defaultdict(lambda: [0, 0]), defaultdict(lambda: [0, 0])
    for h in hist or []:
        for d, ch in ((pes, (h["campeao"], h["papel"])), (mat, (h["campeao"], h["adversario"]))):
            d[ch][0] += h["vitoria"]
            d[ch][1] += 1
    return (lambda c, r: tuple(pes.get((c, r), (0, 0))), lambda c, a: tuple(mat.get((c, a), (0, 0))))


def forca_draft(aliados, inimigos, wr, meu=None, pessoal=None, matchup=None, nomes=None):
    """aliados/inimigos: [{"campeao": id, "rota": "TOP"...}] (rota None = sem termo de meta).
    wr(campeao, rota) -> (v, n) da meta; meu = {"campeao", "rota"} do Gabriel; pessoal(campeao, rota)
    e matchup(meu, adversario) -> (v, n) do histórico dele. Devolve p, faixa e os termos (pp = efeito
    do termo sozinho em pontos percentuais, sinal do ponto de vista do Gabriel)."""
    nomes = nomes or {}
    termos = []

    def nome(c):
        return nomes.get(c, str(c))

    def termo(tipo, lado, campeao, rota, v, n, delta, texto):
        termos.append({"tipo": tipo, "lado": lado, "campeao": campeao, "rota": rota, "v": v, "n": n,
                       "logit": delta, "pp": round(100 * (sigmoide(delta) - 0.5), 2), "texto": texto})

    base_meu = None
    for lado, time_, sinal in (("aliado", aliados, 1), ("inimigo", inimigos, -1)):
        for j in time_:
            c, r = j.get("campeao"), j.get("rota")
            if not c or r not in ROTAS:
                continue
            v, n = wr(c, r)
            w = encolher(v, n, K_META)
            if meu and lado == "aliado" and c == meu.get("campeao"):
                base_meu = w
            wr_txt = f"{100 * v / n:.1f}%" if n else "sem dado"
            termo("meta", lado, c, r, v, n, sinal * logit(w), f"{nome(c)} {r.lower()} {wr_txt} (n={n})")
    if meu and meu.get("campeao"):
        c, r = meu["campeao"], meu.get("rota")
        base = base_meu if base_meu is not None else 0.5
        if pessoal is not None and r in ROTAS:
            v, n = pessoal(c, r)
            if n >= analise.MIN_MATCHUP:  # n < 3 não tira conclusão (plano v2, "matchup só com n ≥ 3")
                w = encolher(v, n, K_PESSOAL, base)
                termo("pessoal", "aliado", c, r, v, n, logit(w) - logit(base),
                      f"teu {nome(c)} {r.lower()}: {v}V/{n - v}D")
                base = w
        adv = next((j["campeao"] for j in inimigos if j.get("rota") == r and j.get("campeao")), None)
        if matchup is not None and adv:
            v, n = matchup(c, adv)
            if n >= analise.MIN_MATCHUP:
                w = encolher(v, n, K_MATCHUP, base)
                termo("matchup", "aliado", c, r, v, n, logit(w) - logit(base),
                      f"teu {nome(c)} contra {nome(adv)}: {v}V/{n - v}D")
    total = sum(t["logit"] for t in termos)
    p = sigmoide(total)
    pesaram = sorted((t for t in termos if abs(t["pp"]) >= PP_MINIMO), key=lambda t: -abs(t["pp"]))[:3]
    return {"p": p, "faixa": faixa(p), "logit": total, "termos": pesaram, "todos": termos}


# ---------- sessão do champ select (LCU) ----------

def _acoes(s):
    out = []
    for a in s.get("actions") or []:
        out.extend(a if isinstance(a, list) else [a])
    return [a for a in out if isinstance(a, dict)]


def ler_sessao(s):
    """da sessão /lol-champ-select/v1/session: meu cell, aliados {cell: (campeao, rota)} e campeões
    inimigos travados. Inimigo só com a ação de pick `completed` (o hover vaza 0,5–2,2 s antes)."""
    acoes = _acoes(s)
    cells_inim = {p.get("cellId") for p in s.get("theirTeam") or []}
    inimigos = [a["championId"] for a in acoes
                if a.get("type") == "pick" and a.get("completed") and (a.get("championId") or 0) > 0
                and a.get("actorCellId") in cells_inim]
    travado = {a.get("actorCellId"): a["championId"] for a in acoes
               if a.get("type") == "pick" and a.get("completed") and (a.get("championId") or 0) > 0}
    aliados = []
    for p in s.get("myTeam") or []:
        c = p.get("championId") or travado.get(p.get("cellId")) or 0
        rota = str(p.get("assignedPosition") or "").upper()
        aliados.append({"cell": p.get("cellId"), "campeao": c if c > 0 else None,
                        "rota": rota if rota in ROTAS else None})
    return {"meu_cell": s.get("localPlayerCellId"), "aliados": aliados, "inimigos": list(dict.fromkeys(inimigos))}


class Draft:
    """carrega meta + histórico uma vez e responde por sessão. Uso:
    d = Draft(); d.analisar_sessao(sessao) ou d.analisar(aliados, inimigos, meu)"""

    def __init__(self, conn_lol=None, conn_meta=None, caminho_lol=None, caminho_meta=None):
        t0 = time.time()
        self.lol = conn_lol or banco.abrir_leitura(caminho_lol or banco.DB_PADRAO)
        self.meta = conn_meta if conn_meta is not None else abrir_meta(caminho_meta or DB_META)
        self.hist = historico_lol(self.lol)
        self.cont = contagens_rota(self.meta, self.hist)
        self.wr = wr_meta(self.meta)
        self.pessoal, self.matchup = indices_pessoais(self.hist)
        self.nomes = dict(self.lol.execute("select id, nome from campeoes"))
        self.n_meta = self.meta.execute("select count(*) from partidas where remake=0").fetchone()[0] if self.meta else 0
        self.carregou_s = time.time() - t0

    def rotas(self, campeoes, fixos=None):
        return rotas_provaveis(campeoes, self.cont, fixos)

    def wr_rota(self, campeao, rota):
        """{"wr": % bruto ou None, "n": jogos, "wr_enc": % encolhido para 50 (K_META)} na meta"""
        v, n = self.wr(campeao, rota) if rota in ROTAS else (0, 0)
        return {"wr": round(100 * v / n, 1) if n else None, "n": n,
                "wr_enc": round(100 * encolher(v, n, K_META), 1)}

    def analisar(self, aliados, inimigos_campeoes, meu=None, fixos_inimigos=None):
        """aliados: [{"campeao", "rota"|None}] (rota None = inferida); inimigos: ids (rota inferida)"""
        sem_rota = [a["campeao"] for a in aliados if a.get("campeao") and not a.get("rota")]
        fixos_al = {a["campeao"]: a["rota"] for a in aliados if a.get("campeao") and a.get("rota")}
        rot_al = self.rotas([a["campeao"] for a in aliados if a.get("campeao")], fixos_al) if sem_rota else None
        al = [{"campeao": a["campeao"],
               "rota": a.get("rota") or (rot_al and rot_al["rotas"].get(a["campeao"]))} for a in aliados if a.get("campeao")]
        rot_in = self.rotas(inimigos_campeoes, fixos_inimigos)
        ini = [{"campeao": c, "rota": rot_in["rotas"].get(c), "confianca": rot_in["confianca"].get(c),
                "fonte": rot_in["fonte"].get(c)} for c in inimigos_campeoes]
        if meu and not meu.get("rota") and meu.get("campeao"):
            meu = {**meu, "rota": next((a["rota"] for a in al if a["campeao"] == meu["campeao"]), None)}
        f = forca_draft(al, ini, self.wr, meu, self.pessoal, self.matchup, self.nomes)
        for j in al + ini:  # C2: WR de cada um dos 10 na rota (provável), com o n sempre ao lado
            j.update(self.wr_rota(j["campeao"], j.get("rota")))
        adv = meu and next((j for j in ini if j["rota"] == meu.get("rota")), None)
        return {"aliados": al, "inimigos": ini, "adversario": adv, "p": round(f["p"], 4), "faixa": f["faixa"],
                "termos": [{k: t[k] for k in ("tipo", "lado", "campeao", "rota", "v", "n", "pp", "texto")}
                           for t in f["termos"]],
                "amostra_meta": self.n_meta,
                "obs": "faixa, não %: só draft acerta 52–57% (docs/MERCADO.md § 3); rota do inimigo é palpite até o carregamento"}

    def analisar_sessao(self, sessao):
        s = ler_sessao(sessao)
        meu = next(({"campeao": a["campeao"], "rota": a["rota"]} for a in s["aliados"]
                    if a["cell"] == s["meu_cell"] and a["campeao"]), None)
        return self.analisar(s["aliados"], s["inimigos"], meu)


def gravar_previsao(c, chave, fase, resultado, game_id=None):
    """grava a previsão (sem identidade: campeões, faixa, termos) em `previsoes` do dados/meta.db para
    calibrar contra o resultado (MERCADO § 3, item 3). c = conexão de escrita do meta.db."""
    with c:
        c.execute("create table if not exists previsoes (chave text, fase text, ts integer, game_id integer, "
                  "p real, faixa text, termos text, primary key (chave, fase))")
        c.execute("insert or replace into previsoes values (?,?,?,?,?,?,?)",
                  (str(chave), fase, int(time.time() * 1000), game_id, resultado.get("p"), resultado.get("faixa"),
                   json.dumps(resultado.get("termos") or [], ensure_ascii=False)))
