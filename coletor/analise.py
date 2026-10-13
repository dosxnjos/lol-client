# heurísticas do pós-jogo sobre o SQLite. Dona das regras: docs/INSIGHTS.md
# (o painel em pengu/posjogo/ implementa a mesma spec). Mudou lá, muda aqui.
# uso: python coletor/analise.py [gameId]   (sem gameId: a última partida do Rift, sem treino nem remake)
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import banco  # noqa: E402

XMAX, YMAX = 14870, 14980
C_RIO = 14925            # (XMAX + YMAX) / 2: x + y no eixo do rio
R_BASE = 5000
F_ROTA = 2300            # faixa das rotas laterais a partir da borda
D_QUINA = 9000           # quina das rotas laterais: |y - x| > 9000
M_MEIO = 1200            # rota do meio: |y - x| <= 1200
M_RIO = 1400             # rio: |x + y - C_RIO| <= 1400
R_PERTO = 2000           # aliado "perto": distância < 2000 (estrito)
JANELA_OBJ = 90000       # objetivo inimigo até 90 s depois da morte
FOLGA_INCERTA = 2000
FORA_DAS_CONTAS = (0, 3100, 3140)  # personalizada e treino: fora da amostra de farm, da "última" e das contas do MCP
REMAKE_S = 300


def regiao_abs(x, y):
    if x * x + y * y < R_BASE ** 2:
        return "base_100"
    if (XMAX - x) ** 2 + (YMAX - y) ** 2 < R_BASE ** 2:
        return "base_200"
    if x < F_ROTA or y > YMAX - F_ROTA or y - x > D_QUINA:
        return "top"
    if y < F_ROTA or x > XMAX - F_ROTA or x - y > D_QUINA:
        return "bot"
    if abs(y - x) <= M_MEIO:
        return "meio"
    if abs(x + y - C_RIO) <= M_RIO:
        return "rio"
    return "selva_100" if x + y < C_RIO else "selva_200"


def regiao(x, y, time):
    """uma das 8: base_aliada, base_inimiga, rota_top, rota_meio, rota_bot, rio, selva_aliada, selva_inimiga"""
    r = regiao_abs(x, y)
    if r.startswith(("base_", "selva_")):
        tipo, dono = r.split("_")
        return f"{tipo}_{'aliada' if int(dono) == time else 'inimiga'}"
    return {"top": "rota_top", "meio": "rota_meio", "bot": "rota_bot", "rio": "rio"}[r]


def lado(x, y, time):
    soma = x + y
    if soma == C_RIO:
        return "centro"
    return "aliado" if (soma < C_RIO) == (time == 100) else "inimigo"


def mmss(ms):
    s = ms // 1000
    return f"{s // 60:02d}:{s % 60:02d}"


def pf(frame, pid):
    return frame["participantFrames"][str(pid)]


def frame_do_minuto(frames, m):
    """f(m): frames[m] se não é o frame final e está a até 5 s de m·60000"""
    if m < len(frames) - 1 and abs(frames[m]["timestamp"] - m * 60000) <= 5000:
        return frames[m]
    return None


def papeis(g, frames):
    """{pid: papel} + folga por time; None se f(10) não existe ou time sem 5"""
    f10 = frame_do_minuto(frames, 10)
    if f10 is None:
        return None
    out, folgas = {}, {}
    for time in (100, 200):
        pids = sorted(p["participantId"] for p in g["participants"] if p["teamId"] == time)
        if len(pids) != 5:
            return None
        jg = max(pids, key=lambda p: (pf(f10, p)["jungleMinionsKilled"], -p))
        resto = [p for p in pids if p != jg]
        sup = min(resto, key=lambda p: (pf(f10, p)["minionsKilled"], p))
        resto = [p for p in resto if p != sup]

        def s(p):
            return sum(pf(frames[i], p)["position"]["y"] - pf(frames[i], p)["position"]["x"]
                       for i in range(3, 11)) / 8
        ordem = sorted(resto, key=lambda p: (-s(p), p))
        out.update({ordem[0]: "TOP", jg: "JUNGLE", ordem[1]: "MIDDLE", ordem[2]: "BOTTOM", sup: "UTILITY"})
        folgas[time] = min(s(ordem[0]) - s(ordem[1]), s(ordem[1]) - s(ordem[2]))
    return {"papel": out, "folga": folgas}


def _time_de(g, pid):
    return next((p["teamId"] for p in g["participants"] if p["participantId"] == pid), None)


def _farm(p):
    return p["minionsKilled"] + p["jungleMinionsKilled"]


def _fpm(cs_tropas, cs_selva, duracao):
    return (cs_tropas + cs_selva) / (duracao / 60)


def ultima_partida(c):
    r = c.execute("select game_id from partidas where mapa=11 and tem_timeline=1 and eu is not null "
                  f"and fila not in {FORA_DAS_CONTAS} and duracao >= {REMAKE_S} "
                  "order by criacao desc limit 1").fetchone()
    return r and r[0]


def analisar(c, game_id=None, puuid=None, amostra_ids=None):
    """resultado no formato de docs/INSIGHTS.md § Formato do resultado, ou {"erro": ...}.
    amostra_ids restringe a amostra de farm (conferência do caso de referência)."""
    game_id = game_id or ultima_partida(c)
    if not game_id:
        return {"erro": "nenhuma partida do Rift com linha do tempo no banco"}
    g = banco.ler_partida(c, game_id)
    if not g:
        return {"erro": f"partida {game_id} não está no banco"}
    if g.get("mapId") != 11:
        return {"erro": "só Summoner's Rift", "gameId": game_id}
    puuid = puuid or banco.meta(c, "puuid")
    eu = next((i["participantId"] for i in g["participantIdentities"]
               if (i.get("player") or {}).get("puuid") == puuid), None)
    if eu is None:
        return {"erro": "partida de outra conta", "gameId": game_id}
    frames = banco.ler_frames(c, game_id)
    if not frames:
        return {"erro": "partida sem linha do tempo no banco", "gameId": game_id}
    meu_time = _time_de(g, eu)
    inimigo = 300 - meu_time
    me_p = next(p for p in g["participants"] if p["participantId"] == eu)

    pap = papeis(g, frames)
    adv = None
    if pap:
        adv_pid = next(p for p, r in pap["papel"].items() if r == pap["papel"][eu] and _time_de(g, p) == inimigo)
        incerto = pap["papel"][eu] in ("TOP", "MIDDLE", "BOTTOM") and min(pap["folga"].values()) < FOLGA_INCERTA
        adv = {"participantId": adv_pid,
               "campeao": next(p["championId"] for p in g["participants"] if p["participantId"] == adv_pid),
               "incerto": incerto}

    eventos = [e for f in frames for e in f["events"]]
    mortes = []
    for e in eventos:
        if e["type"] != "CHAMPION_KILL" or e["victimId"] != eu:
            continue
        ms, x, y = e["timestamp"], e["position"]["x"], e["position"]["y"]
        assist = e.get("assistingParticipantIds") or []
        fr = min(frames, key=lambda f: (abs(f["timestamp"] - ms), f["timestamp"]))
        aliados = []
        for p in g["participants"]:
            pid = p["participantId"]
            if p["teamId"] != meu_time or pid == eu:
                continue
            q = pf(fr, pid)["position"]
            if (q["x"] - x) ** 2 + (q["y"] - y) ** 2 < R_PERTO ** 2:
                aliados.append(pid)
        objetivos = []
        for o in eventos:
            if not (ms <= o["timestamp"] <= ms + JANELA_OBJ):
                continue
            if o["type"] == "BUILDING_KILL" and o.get("teamId") == meu_time:
                objetivos.append({"tipo": o.get("buildingType"), "detalhe": o.get("towerType"),
                                  "rota": o.get("laneType"), "ms": o["timestamp"]})
            elif o["type"] == "ELITE_MONSTER_KILL":
                quem = o.get("killerId") or ((o.get("assistingParticipantIds") or [0])[0])
                if quem and _time_de(g, quem) == inimigo:
                    objetivos.append({"tipo": o.get("monsterType"), "detalhe": o.get("monsterSubType"),
                                      "rota": "", "ms": o["timestamp"]})
        mortes.append({"ms": ms, "t": mmss(ms), "x": x, "y": y,
                       "regiao": regiao(x, y, meu_time), "lado": lado(x, y, meu_time),
                       "matador": e["killerId"], "assistentes": assist,
                       "inimigos": (1 if e["killerId"] != 0 else 0) + len(assist),
                       "frameMs": fr["timestamp"], "aliadosPerto": sorted(aliados),
                       "objetivos": objetivos})

    diffs = {}
    for m in (10, 15):
        f = frame_do_minuto(frames, m)
        if f is None or adv is None:
            continue
        a, b = pf(f, eu), pf(f, adv["participantId"])
        diffs[str(m)] = {"ouro": a["totalGold"] - b["totalGold"], "xp": a["xp"] - b["xp"],
                         "farm": _farm(a) - _farm(b),
                         "eu": {"ouro": a["totalGold"], "xp": a["xp"], "farm": _farm(a)},
                         "adv": {"ouro": b["totalGold"], "xp": b["xp"], "farm": _farm(b)}}

    st = me_p["stats"]
    valor = _fpm(st["totalMinionsKilled"], st["neutralMinionsKilled"], g["gameDuration"])
    sql = ("select pa.game_id, pa.criacao, pa.duracao, pp.cs_tropas, pp.cs_selva from partidas pa "
           "join participantes pp on pp.game_id = pa.game_id and pp.puuid = ? "
           f"where pp.campeao = ? and pa.mapa = 11 and pa.duracao >= {REMAKE_S} and pa.fila not in {FORA_DAS_CONTAS} "
           "and pa.criacao < ? and pa.game_id <> ? "
           "order by pa.criacao desc")
    linhas = c.execute(sql, (puuid, me_p["championId"], g["gameCreation"], game_id)).fetchall()
    if amostra_ids is not None:
        linhas = [r for r in linhas if r[0] in set(amostra_ids)]
    amostra = [_fpm(r[3], r[4], r[2]) for r in linhas[:20]]
    media = sum(amostra) / len(amostra) if len(amostra) >= 3 else None
    farm = {"valor": valor, "media": media, "n": len(amostra),
            "diferenca": None if media is None else valor - media}

    return {"gameId": game_id, "participantId": eu, "time": meu_time, "campeao": me_p["championId"],
            "papel": pap and pap["papel"][eu], "adversario": adv, "mortes": mortes,
            "diffs": diffs, "farm": farm}


if __name__ == "__main__":
    conn = banco.abrir_leitura()
    gid = int(sys.argv[1]) if len(sys.argv) > 1 else None
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(analisar(conn, gid), ensure_ascii=False, indent=1))
