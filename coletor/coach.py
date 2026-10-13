# motor de lições do coach (plano v2, passo 6). Regras: pengu/posjogo/licoes.md (dono, o mesmo
# arquivo que o pengu/posjogo/licoes.js lê); métricas: docs/INSIGHTS.md § Métricas das lições.
# Os dois motores seguem a mesma spec: mudou aqui, muda lá (prova: tools/teste-licoes.py e .mjs).
# uso: python coletor/coach.py [gameId] [--contexto]   (sem gameId: a última partida do Rift)
import json
import math
import re
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import analise  # noqa: E402
import banco  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
ARQ_REGRAS = RAIZ / "pengu" / "posjogo" / "licoes.md"
N_LICOES = 3
TIPOS = ("atencao", "positiva")
SESSAO_GAP_MS = 2 * 3600 * 1000  # mesma regra do tilt no MCP: pausa >= 2 h abre sessão nova
MS_10, MS_15 = 600000, 900000

# nome -> (tipo, fonte). A tabela de docs/INSIGHTS.md § Métricas das lições tem de bater (validar-licoes.py)
METRICAS = {
    "vitoria": ("número", "partida"), "duracao_min": ("número", "partida"),
    "campeao_nome": ("texto", "partida"), "adversario_nome": ("texto", "partida"),
    "adversario_incerto": ("número", "partida"),
    "ouro10": ("número", "partida"), "xp10": ("número", "partida"), "farm10": ("número", "partida"),
    "ouro15": ("número", "partida"), "xp15": ("número", "partida"), "farm15": ("número", "partida"),
    "mortes": ("número", "partida"), "mortes10": ("número", "partida"), "mortes15": ("número", "partida"),
    "primeira_morte": ("número", "partida"), "mortes_1x1_adversario": ("número", "partida"),
    "mortes_sozinho_inimigo": ("número", "partida"), "mortes_desvantagem": ("número", "partida"),
    "mortes_objetivo": ("número", "partida"), "objetivos_pos_morte": ("número", "partida"),
    "farm_min": ("número", "partida"),
    "farm_media": ("número", "histórico"), "farm_n": ("número", "histórico"), "farm_dif": ("número", "histórico"),
    "sessao_partida": ("número", "histórico"), "derrotas_antes": ("número", "histórico"),
    "vitorias_antes": ("número", "histórico"), "hora": ("número", "histórico"), "faixa": ("texto", "histórico"),
    "matchup_n": ("número", "coletor"), "matchup_v": ("número", "coletor"), "matchup_d": ("número", "coletor"),
    "matchup_wr": ("número", "coletor"), "matchup_ouro10": ("número", "coletor"),
    "trauma_nome": ("texto", "coletor"), "trauma_lift": ("número", "coletor"), "trauma_n": ("número", "coletor"),
    "trauma_v": ("número", "coletor"), "trauma_d": ("número", "coletor"),
    "geral_wr": ("número", "coletor"), "faixa_wr": ("número", "coletor"), "faixa_n": ("número", "coletor"),
    "apos_derrotas_wr": ("número", "coletor"), "apos_derrotas_n": ("número", "coletor"),
}


# ---------- regras (licoes.md) ----------

_BLOCO = re.compile(r"^###\s+(\S+)\s*$")
_CHAVE = re.compile(r"^-\s+([a-z_]+):\s*(.*?)\s*$")
_PLACEHOLDER = re.compile(r"\{([a-z0-9_]+)(?::([+a-z]+))?\}")
FORMATOS = ("", "abs", "int", "pct", "mmss")


def carregar_regras(texto=None):
    """lista de regras na ordem do arquivo: {id, quando, prioridade, tipo, grupo, uso, texto, ...}.
    Só os blocos ### dentro de seções "## Regras…"; chave desconhecida fica no dict"""
    if texto is None:
        texto = ARQ_REGRAS.read_text(encoding="utf-8")
    regras, atual, dentro = [], None, False
    for linha in texto.splitlines():
        if linha.startswith("## "):
            dentro = linha[3:].strip().lower().startswith("regras")
            atual = None
            continue
        if not dentro:
            continue
        m = _BLOCO.match(linha)
        if m:
            atual = {"id": m.group(1)}
            regras.append(atual)
            continue
        m = atual is not None and _CHAVE.match(linha)
        if m:
            v = m.group(2)
            if m.group(1) == "quando" and len(v) >= 2 and v[0] == "`" and v[-1] == "`":
                v = v[1:-1].strip()
            atual[m.group(1)] = v
    for r in regras:
        r.setdefault("uso", "posjogo")
        r.setdefault("grupo", None)
        try:
            r["prioridade"] = int(r.get("prioridade"))
        except (TypeError, ValueError):
            r["prioridade"] = None
    return regras


# ---------- expressão do `quando` ----------

_TOKEN = re.compile(r"\s*(?:(\d+(?:\.\d+)?)|(não|[A-Za-z_][A-Za-z0-9_]*)|(>=|<=|==|!=|[<>()+\-*/]))")
_COMP = ("==", "!=", ">=", "<=", ">", "<")


def _tokens(expr):
    out, i = [], 0
    while i < len(expr):
        if expr[i:].strip() == "":
            break
        m = _TOKEN.match(expr, i)
        if not m or m.end() == i:
            raise ValueError(f"caractere inesperado em {expr!r}, posição {i}")
        num, nome, op = m.groups()
        out.append(("num", float(num)) if num else ("nome", nome) if nome else ("op", op))
        i = m.end()
    return out


def compilar(expr):
    """árvore da expressão: ("num", v) | ("var", nome) | ("existe", nome) | ("un", op, a) | ("bin", op, a, b)"""
    toks = _tokens(expr)
    pos = [0]

    def ver(k=0):
        return toks[pos[0] + k] if pos[0] + k < len(toks) else (None, None)

    def comer(tipo=None, valor=None):
        t = ver()
        if t[0] is None or (tipo and t[0] != tipo) or (valor and t[1] != valor):
            raise ValueError(f"esperava {valor or tipo} em {expr!r}, veio {t[1]!r}")
        pos[0] += 1
        return t

    def ou():
        a = e()
        while ver() == ("nome", "ou"):
            comer()
            a = ("bin", "ou", a, e())
        return a

    def e():
        a = nao()
        while ver() == ("nome", "e"):
            comer()
            a = ("bin", "e", a, nao())
        return a

    def nao():
        if ver() in (("nome", "não"), ("nome", "nao")):
            comer()
            return ("un", "não", nao())
        return comp()

    def comp():
        a = soma()
        if ver()[0] == "op" and ver()[1] in _COMP:
            op = comer()[1]
            a = ("bin", op, a, soma())
            if ver()[0] == "op" and ver()[1] in _COMP:
                raise ValueError(f"comparação encadeada em {expr!r}")
        return a

    def soma():
        a = prod()
        while ver()[0] == "op" and ver()[1] in "+-":
            op = comer()[1]
            a = ("bin", op, a, prod())
        return a

    def prod():
        a = un()
        while ver()[0] == "op" and ver()[1] in "*/":
            op = comer()[1]
            a = ("bin", op, a, un())
        return a

    def un():
        if ver() == ("op", "-"):
            comer()
            return ("un", "-", un())
        return prim()

    def prim():
        t = ver()
        if t[0] == "num":
            comer()
            return ("num", t[1])
        if t == ("op", "("):
            comer()
            a = ou()
            comer("op", ")")
            return a
        if t[0] == "nome" and t[1] not in ("e", "ou", "não", "nao"):
            comer()
            if t[1] == "existe":
                comer("op", "(")
                nome = comer("nome")[1]
                comer("op", ")")
                return ("existe", nome)
            return ("var", t[1])
        raise ValueError(f"termo inesperado em {expr!r}: {t[1]!r}")

    arv = ou()
    if pos[0] != len(toks):
        raise ValueError(f"sobrou {ver()[1]!r} em {expr!r}")
    return arv


def nomes_da_expressao(arv):
    """métricas citadas numa árvore (para o validador)"""
    if arv[0] in ("var", "existe"):
        return {arv[1]}
    if arv[0] == "un":
        return nomes_da_expressao(arv[2])
    if arv[0] == "bin":
        return nomes_da_expressao(arv[2]) | nomes_da_expressao(arv[3])
    return set()


def _num(v):
    """valor de conta/comparação: None fica None; bool vira 1/0"""
    if v is None:
        return None
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (int, float)):
        return v
    raise ValueError(f"valor não numérico na expressão: {v!r}")


def _logico(v):
    if v is None or isinstance(v, bool):
        return v
    return _num(v) != 0


def avaliar_expr(arv, m):
    """True / False / None (lógica de três valores; spec no cabeçalho do licoes.md)"""
    k = arv[0]
    if k == "num":
        return arv[1]
    if k == "var":
        if arv[1] not in m:
            raise KeyError(f"métrica desconhecida: {arv[1]}")
        return m[arv[1]]
    if k == "existe":
        return m.get(arv[1]) is not None
    if k == "un":
        a = avaliar_expr(arv[2], m)
        if arv[1] == "-":
            a = _num(a)
            return None if a is None else -a
        a = _logico(a)
        return None if a is None else not a
    op, a, b = arv[1], avaliar_expr(arv[2], m), avaliar_expr(arv[3], m)
    if op == "e":
        a, b = _logico(a), _logico(b)
        if a is False or b is False:
            return False
        return None if a is None or b is None else True
    if op == "ou":
        a, b = _logico(a), _logico(b)
        if a is True or b is True:
            return True
        return None if a is None or b is None else False
    a, b = _num(a), _num(b)
    if a is None or b is None:
        return None
    if op == "+":
        return a + b
    if op == "-":
        return a - b
    if op == "*":
        return a * b
    if op == "/":
        return None if b == 0 else a / b
    return {"==": a == b, "!=": a != b, ">=": a >= b, "<=": a <= b, ">": a > b, "<": a < b}[op]


# ---------- texto ----------

def arred(v, casas=0):
    f = 10 ** casas
    return math.floor(v * f + 0.5) / f


def formatar(v, fmt=""):
    """placeholder → texto (spec no cabeçalho do licoes.md); igual ao formatar() do licoes.js"""
    if isinstance(v, str):
        return v
    v = _num(v)
    sinal = fmt.startswith("+")
    base = fmt[1:] if sinal else fmt
    if base not in FORMATOS:
        raise ValueError(f"formato desconhecido: {fmt!r}")
    if base == "mmss":  # sobre o valor absoluto: % de negativo difere entre Python e JS
        s = int(math.floor(abs(v) / 1000))
        return ("−" if v < 0 and s > 0 else "") + f"{s // 60:02d}:{s % 60:02d}"
    if base == "abs":
        v = abs(v)
    if base in ("int", "pct"):
        v = arred(v, 0)
    inteiro = float(v).is_integer()
    r = v if inteiro else arred(v, 1)
    corpo = str(int(abs(r))) if inteiro else f"{abs(r):.1f}".replace(".", ",")
    pre = "−" if r < 0 else ("+" if sinal and r > 0 else "")
    return pre + corpo + ("%" if base == "pct" else "")


def placeholders(texto):
    """[(métrica, formato)] do texto"""
    return [(a, b or "") for a, b in _PLACEHOLDER.findall(texto or "")]


def renderizar(texto, m):
    """texto com os placeholders preenchidos; None se algum placeholder está sem valor"""
    if any(m.get(nome) is None for nome, _ in placeholders(texto)):
        return None
    return _PLACEHOLDER.sub(lambda x: formatar(m[x.group(1)], x.group(2) or ""), texto)


# ---------- escolha ----------

def escolher(regras, m, n=N_LICOES, uso="posjogo"):
    """as n lições da partida: [{id, tipo, prioridade, texto}] (regra de escolha no licoes.md).
    Regra quebrada (expressão inválida, métrica desconhecida) não dispara."""
    disparou = []
    for i, r in enumerate(regras):
        if r.get("uso", "posjogo") != uso or r.get("prioridade") is None:
            continue
        try:
            ok = avaliar_expr(compilar(r["quando"]), m) is True
            texto = ok and renderizar(r["texto"], m)
        except (KeyError, ValueError):
            continue
        if ok and texto is not None:
            disparou.append((-r["prioridade"], i, r, texto))
    disparou.sort(key=lambda x: (x[0], x[1]))
    grupos, unicas = set(), []
    for d in disparou:
        g = d[2].get("grupo")
        if g:
            if g in grupos:
                continue
            grupos.add(g)
        unicas.append(d)
    escolhidas = unicas[:n]
    if n > 0 and not any(d[2]["tipo"] == "positiva" for d in escolhidas):
        pos = next((d for d in unicas[n:] if d[2]["tipo"] == "positiva"), None)
        if pos:
            escolhidas = sorted(escolhidas[:n - 1] + [pos], key=lambda x: (x[0], x[1]))
    return [{"id": r["id"], "tipo": r["tipo"], "prioridade": r["prioridade"], "texto": t}
            for _, _, r, t in escolhidas]


# ---------- métricas ----------

def faixa(h):
    return "00-06" if h < 6 else "06-12" if h < 12 else "12-18" if h < 18 else "18-24"


def _valida(p, alvo_id, alvo_criacao):
    return (p["mapa"] == 11 and p["fila"] not in analise.FORA_DAS_CONTAS and p["duracao"] >= analise.REMAKE_S
            and p["criacao"] < alvo_criacao and p["gameId"] != alvo_id)


def sessao(historico, game_id, criacao):
    """posição da partida na sessão e sequência antes dela. historico: [{gameId, criacao (ms), duracao (s),
    fila, mapa, vitoria}] (qualquer ordem); só entram partidas do Rift, fora remake/personalizada/treino,
    anteriores à analisada. Sessão = pausa < 2 h entre o fim de uma e o início da outra"""
    ps = sorted((p for p in historico if _valida(p, game_id, criacao)), key=lambda p: p["criacao"])
    corrente, ant = [], None
    for p in ps:
        if ant is None or p["criacao"] - (ant["criacao"] + ant["duracao"] * 1000) >= SESSAO_GAP_MS:
            corrente = []
        corrente.append(p)
        ant = p
    if ant is None or criacao - (ant["criacao"] + ant["duracao"] * 1000) >= SESSAO_GAP_MS:
        corrente = []
    derrotas = vitorias = 0
    for p in reversed(corrente):  # sequência que termina na partida anterior a esta
        if p["vitoria"]:
            break
        derrotas += 1
    for p in reversed(corrente):
        if not p["vitoria"]:
            break
        vitorias += 1
    h = datetime.fromtimestamp(criacao / 1000).hour
    return {"partida": len(corrente) + 1, "derrotas_antes": derrotas, "vitorias_antes": vitorias,
            "hora": h, "faixa": faixa(h)}


def _wr(v, n):
    return 100 * v / n if n else None


def montar_metricas(r, ses, contexto=None, nomes=None):
    """dict métrica -> valor (None = sem dado). r = resultado do analisar() com vitoria e duracaoS;
    ses = sessao(); contexto = contexto_partida() (fonte coletor; None/{} = sem); nomes = {id: nome}"""
    ctx, nomes = contexto or {}, nomes or {}
    nome = lambda cid: None if cid is None else nomes.get(str(cid), f"campeão {cid}")
    adv = r.get("adversario")
    mortes = r["mortes"]
    d10, d15 = r["diffs"].get("10"), r["diffs"].get("15")
    objs = {(o["tipo"], o["detalhe"], o["rota"], o["ms"]) for mo in mortes for o in mo["objetivos"]}
    f = r["farm"]
    m = {
        "vitoria": 1 if r["vitoria"] else 0, "duracao_min": r["duracaoS"] / 60,
        "campeao_nome": nome(r["campeao"]), "adversario_nome": adv and nome(adv["campeao"]),
        "adversario_incerto": None if not adv else (1 if adv["incerto"] else 0),
        "ouro10": d10 and d10["ouro"], "xp10": d10 and d10["xp"], "farm10": d10 and d10["farm"],
        "ouro15": d15 and d15["ouro"], "xp15": d15 and d15["xp"], "farm15": d15 and d15["farm"],
        "mortes": len(mortes),
        "mortes10": sum(mo["ms"] < MS_10 for mo in mortes), "mortes15": sum(mo["ms"] < MS_15 for mo in mortes),
        "primeira_morte": mortes[0]["ms"] if mortes else None,
        "mortes_1x1_adversario": None if not adv else sum(
            mo["matador"] == adv["participantId"] and mo["inimigos"] == 1 for mo in mortes),
        "mortes_sozinho_inimigo": sum(mo["lado"] == "inimigo" and not mo["aliadosPerto"] for mo in mortes),
        "mortes_desvantagem": sum(mo["inimigos"] > len(mo["aliadosPerto"]) + 1 for mo in mortes),
        "mortes_objetivo": sum(bool(mo["objetivos"]) for mo in mortes), "objetivos_pos_morte": len(objs),
        "farm_min": f["valor"], "farm_media": f["media"], "farm_n": f["n"], "farm_dif": f["diferenca"],
        "sessao_partida": ses["partida"], "derrotas_antes": ses["derrotas_antes"],
        "vitorias_antes": ses["vitorias_antes"], "hora": ses["hora"], "faixa": ses["faixa"],
    }
    mu = ctx.get("matchup") if adv and not adv["incerto"] else None
    m["matchup_n"] = mu and mu["n"]
    m["matchup_v"] = mu and mu["vitorias"]
    m["matchup_d"] = mu and mu["n"] - mu["vitorias"]
    m["matchup_wr"] = mu and mu.get("winrate")
    m["matchup_ouro10"] = mu and mu.get("ouro10")
    tr = sorted(ctx.get("traumas") or [], key=lambda t: (-t["lift"], t["campeao"]))
    t = tr[0] if tr else None
    m["trauma_nome"] = t and nome(t["campeao"])
    m["trauma_lift"] = t and t["lift"]
    m["trauma_n"] = t and t["n"]
    m["trauma_v"] = t and t["vitorias"]
    m["trauma_d"] = t and t["derrotas"]
    hist = ctx.get("historico") or {}
    m["geral_wr"] = (hist.get("geral") or {}).get("wr")
    fx = (hist.get("faixas") or {}).get(ses["faixa"]) or {}
    m["faixa_wr"], m["faixa_n"] = fx.get("wr"), fx.get("n")
    k = min(ses["derrotas_antes"], 3)
    ad = (hist.get("apos_derrotas") or {}).get(str(k)) if k else None
    m["apos_derrotas_wr"], m["apos_derrotas_n"] = (ad or {}).get("wr"), (ad or {}).get("n")
    return m


# ---------- contexto (fonte coletor: só o banco tem) ----------

def historico_banco(c):
    """minhas partidas do banco no formato que sessao() e historico_tilt() recebem"""
    cols = ("gameId", "criacao", "duracao", "fila", "mapa", "vitoria")
    return [dict(zip(cols, r)) for r in c.execute(
        "select game_id, criacao, duracao, fila, mapa, vitoria from partidas where eu is not null")]


def historico_tilt(historico, game_id, criacao):
    """winrate geral, por faixa de horário e depois de k derrotas seguidas (1, 2, 3+), só das partidas
    anteriores à analisada (mesma regra do tilt() do MCP: sequência zera numa pausa >= 2 h)"""
    ps = sorted((p for p in historico if _valida(p, game_id, criacao)), key=lambda p: p["criacao"])
    geral, faixas, apos = [0, 0], {}, {}
    seq, ant = 0, None
    for p in ps:
        if ant is None or p["criacao"] - (ant["criacao"] + ant["duracao"] * 1000) >= SESSAO_GAP_MS:
            seq = 0
        v = 1 if p["vitoria"] else 0
        for b in (geral, faixas.setdefault(faixa(datetime.fromtimestamp(p["criacao"] / 1000).hour), [0, 0]),
                  apos.setdefault(str(min(seq, 3)), [0, 0])):
            b[0] += v
            b[1] += 1
        seq = 0 if v else seq + 1
        ant = p
    bloco = lambda b: {"n": b[1], "wr": _wr(b[0], b[1])}
    return {"geral": bloco(geral), "faixas": {k: bloco(b) for k, b in sorted(faixas.items())},
            "apos_derrotas": {k: bloco(b) for k, b in sorted(apos.items()) if k != "0"}}


def _traumas(c, campeao, inimigos, antes_de=None):
    """traumas (passo 19, analise.traumas) dos campeões inimigos desta partida, só com as partidas de
    ANTES dela (antes_de = gameCreation): a derrota/vitória analisada não decide se X "é trauma" (uma
    vitória sobre um 0V/3D tirava X do trauma e sumia com a lição `venceu-trauma`). Contrato:
    analise.traumas(c, campeao=None, min_partidas=3, antes_de=None) -> {"traumas": [{campeao, n, vitorias,
    derrotas, lift, ...}]} (ou a lista direto). Sem a função → [] e as métricas de trauma ficam nulas"""
    fn = getattr(analise, "traumas", None)
    if fn is None:
        return []
    try:
        out = fn(c, campeao=campeao, antes_de=antes_de)
    except Exception:  # noqa: BLE001  (outra frente; erro nela não derruba a lição)
        return []
    lista = out.get("traumas", []) if isinstance(out, dict) else (out or [])
    norm = []
    for t in lista:
        try:
            cid, n, lift = int(t["campeao"]), int(t["n"]), t.get("lift")
        except (KeyError, TypeError, ValueError):
            continue
        if cid not in inimigos or lift is None or n < analise.MIN_MATCHUP or t.get("trauma") is False:
            continue
        v = t.get("vitorias")
        d = t.get("derrotas")
        norm.append({"campeao": cid, "n": n, "lift": float(lift),
                     "vitorias": v if v is not None else n - d, "derrotas": d if d is not None else n - v})
    return norm


def contexto_partida(c, game_id, r=None, puuid=None):
    """o que só o banco sabe, para os dois motores (o JS pede pelo servidor do coletor):
    {matchup, traumas, historico}. Matchup = grupo (meu campeão, papel, adversário) do
    analise.matchups com todo o banco (inclui esta partida); traumas e historico = só as anteriores"""
    r = r or analise.analisar(c, game_id, puuid)
    g = banco.ler_partida(c, r["gameId"])
    meu_time = r["time"]
    inimigos = {p["championId"] for p in g["participants"] if p["teamId"] != meu_time}
    mu = None
    adv = r.get("adversario")
    if adv and not adv["incerto"] and r.get("papel"):
        grupo = next((x for x in analise.matchups(c, r["campeao"], puuid)["matchups"]
                      if x["papel"] == r["papel"] and x["adversario"] == adv["campeao"]), None)
        if grupo:
            mu = {k: grupo[k] for k in ("n", "vitorias", "winrate", "ouro10", "xp10", "farm10", "mortes10")}
    return {"matchup": mu, "traumas": _traumas(c, r["campeao"], inimigos, antes_de=g["gameCreation"]),
            "historico": historico_tilt(historico_banco(c), r["gameId"], g["gameCreation"])}


def nomes_banco(c):
    return {str(i): n for i, n in c.execute("select id, nome from campeoes")}


def analisar(c, game_id=None, puuid=None, amostra_ids=None):
    """analise.analisar + vitoria, duracaoS e criacao (o JS já devolve os dois primeiros)"""
    r = analise.analisar(c, game_id, puuid, amostra_ids)
    if "erro" in r:
        return r
    g = banco.ler_partida(c, r["gameId"])
    me = next(p for p in g["participants"] if p["participantId"] == r["participantId"])
    r.update(vitoria=bool(me["stats"]["win"]), duracaoS=g["gameDuration"], criacao=g["gameCreation"])
    return r


def licoes_partida(c, game_id=None, puuid=None, n=N_LICOES, regras=None):
    """as n lições de uma partida do banco: {gameId, licoes: [{id, tipo, prioridade, texto}], metricas}
    (ou {"erro": ...}). Para o MCP, o pós-jogo do coletor e o mentor (passo 20)"""
    r = analisar(c, game_id, puuid)
    if "erro" in r:
        return r
    ses = sessao(historico_banco(c), r["gameId"], r["criacao"])
    m = montar_metricas(r, ses, contexto_partida(c, r["gameId"], r, puuid), nomes_banco(c))
    return {"gameId": r["gameId"], "licoes": escolher(regras if regras is not None else carregar_regras(), m, n),
            "metricas": m}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    conn = banco.abrir_leitura()
    gid = int(args[0]) if args else None
    if "--contexto" in sys.argv:
        gid = gid or analise.ultima_partida(conn)
        print(json.dumps(contexto_partida(conn, gid), ensure_ascii=False))
    else:
        print(json.dumps(licoes_partida(conn, gid), ensure_ascii=False, indent=1))
