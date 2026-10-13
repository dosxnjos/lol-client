# prova do anti-spam da voz (plano v2, passos 10 e 12): motor de avisos (coletor/avisos.py) com
# consumidores falsos, tempo simulado, nada de som. Casos:
#   1. 30 s simulados com avisos chegando a cada 0,5 s → no máximo 1 fala e nenhuma chave repetida
#   2. gank fura o intervalo de 20 s; o mesmo gank em 10 s não repete
#   3. aviso que esperou além da validade não é falado
#   4. tom descontraído troca o texto; tipo desligado não sai
#   5. textos lidos da seção "Avisos ao vivo" de um md (formato do arquivo de lições)
#   6. fila da voz (Voz com saída falsa): urgente/prioridade maior fala antes
#   7. replay da partida real 3292746609 (live.jsonl) pelos GatilhosLive: falas a ≥ 20 s, sem
#      repetição, e o gabarito (dragões, mortes antes dos 10) bate com os eventos gravados
# uso: python tools/teste-coach.py [--live temp/gravacao/<pasta>/live.jsonl]
import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
from avisos import TEXTOS, Aviso, GatilhosLive, MotorAvisos, RelogioJogo, carregar_textos  # noqa: E402
from voz import Voz  # noqa: E402

LIVE_PADRAO = RAIZ / "temp" / "gravacao" / "20261013-071040" / "live.jsonl"
resultados = []


def caso(nome, ok, detalhe=""):
    resultados.append(ok)
    print(f"{'ok' if ok else 'FALHOU'}  {nome}" + (f"  ({detalhe})" if detalhe else ""))


def falas(m):
    return [(t, a) for t, d, a in m.emitidos if d == "voz"]


def sem_repeticao(m, janela):
    vistos = {}
    for t, d, a in m.emitidos:
        if d != "voz":
            continue
        if a.chave in vistos and t - vistos[a.chave] < janela:
            return False
        vistos[a.chave] = t
    return True


def _inundar(m, avisos, dur=30.0, passo=0.5):
    t = 0.0
    while t < dur:
        for a in avisos():
            m.publicar(a, t)
        m.tick(t)
        t += passo


def caso_30s():
    # a régua do plano é "1 fala a cada 20 s, fora o gank": o mesmo aviso chegando 2×/s por 30 s
    # sai 1 vez; 5 avisos diferentes por 30 s saem no máximo 2 (t=0 e t=20), nunca repetidos
    m = MotorAvisos(textos=TEXTOS)
    _inundar(m, lambda: [Aviso("ouro_guardado", {"ouro": 2100}, "ouro")])
    f1 = falas(m)
    m = MotorAvisos(textos=TEXTOS)
    _inundar(m, lambda: [Aviso("objetivo_60s", {"objetivo": "dragão"}, "dragão:300"),
                         Aviso("ouro_guardado", {"ouro": 2100}, "ouro"),
                         Aviso("inimigo_fed", {"campeao": "Riven"}, "Riven:3"),
                         Aviso("mid_sumiu", {"campeao": "Yasuo"}, "m1"),
                         Aviso("janela_objetivo", {"n": 2, "objetivo": "dragão"}, "j")])
    f5 = falas(m)
    tempos = [t for t, _ in f5]
    caso("30 s simulados: mesmo aviso 60× → 1 fala; 5 avisos → falas a ≥ 20 s, nenhuma repetida",
         len(f1) == 1 and len(f5) <= 2 and all(b - a >= 20 for a, b in zip(tempos, tempos[1:])) and sem_repeticao(m, 30),
         f"1 aviso: {len(f1)} fala; 5 avisos: {[(t, a.fala) for t, a in f5]}; suprimidos {dict(m.suprimidos)}")


def caso_gank():
    m = MotorAvisos(textos=TEXTOS)
    m.publicar(Aviso("ouro_guardado", {"ouro": 2000}, "o"), 0.0)
    m.publicar(Aviso("gank", {"zona": "no top", "zc": "top"}, "top"), 5.0)
    m.publicar(Aviso("gank", {"zona": "no top", "zc": "top"}, "top"), 12.0)
    m.publicar(Aviso("mid_sumiu", {"campeao": "Yasuo"}, "m"), 13.0)
    m.tick(19.0)
    f = [(t, a.tipo) for t, a in falas(m)]
    caso("gank fura os 20 s, não repete em 10 s, e o comum espera", f == [(0.0, "ouro_guardado"), (5.0, "gank")],
         f"falas {f}")


def caso_fura_informativo():
    # revisão 13/10/2026: "Tristana com Flash" (informativo, prio 20) em 241 não cala "jungler rio top"
    # (prio 80) em 250; o comum seguinte volta a esperar 20 s da última fala
    m = MotorAvisos(textos=TEXTOS)
    m.publicar(Aviso("feitico_voltou", chave="Tristana:Flash",
                     textos={"serio": ("Tristana com Flash", "Tristana com Flash")}), 241.0)
    m.publicar(Aviso("jungler_apareceu", {"campeao": "Ekko", "zona": "no rio top", "zc": "rio top", "zt": "rio"},
                     "rio top"), 250.0)
    m.publicar(Aviso("ouro_guardado", {"ouro": 2000}, "o"), 252.0)
    m.publicar(Aviso("intruso", {"campeao": "Yasuo", "zona": "no top", "zc": "top", "zt": "top"}, "Yasuo:top"), 256.0)
    for t in range(250, 275):
        m.tick(float(t))
    f = [(t, a.tipo, a.furou) for t, a in falas(m)]
    caso("alerta de posição passa à frente de fala informativa (≥ 5 s); o resto espera 20 s",
         f == [(241.0, "feitico_voltou", False), (250.0, "jungler_apareceu", True), (270.0, "ouro_guardado", False)]
         and m.suprimidos["vencido"] == 1, f"falas {f}, vencidos {m.suprimidos['vencido']}")


def caso_validade():
    m = MotorAvisos(textos=TEXTOS)
    m.publicar(Aviso("ouro_guardado", {"ouro": 2000}, "o"), 0.0)
    m.publicar(Aviso("mid_sumiu", {"campeao": "Yasuo"}, "m"), 1.0)        # validade 8 s
    m.publicar(Aviso("objetivo_60s", {"objetivo": "barão"}, "b"), 2.0)    # validade 20 s
    for t in range(3, 25):
        m.tick(float(t))
    f = [(t, a.tipo) for t, a in falas(m)]
    caso("aviso vencido não fala; o válido fala quando abre a vez", f == [(0.0, "ouro_guardado"), (20.0, "objetivo_60s")]
         and m.suprimidos["vencido"] == 1, f"falas {f}, vencidos {m.suprimidos['vencido']}")


def caso_tom():
    m = MotorAvisos(tom="descontraido", textos=TEXTOS)
    m.publicar(Aviso("inimigo_fed", {"campeao": "Darius"}, "d"), 0.0)
    m2 = MotorAvisos(textos=TEXTOS)
    m2.configurar(desligados={"inimigo_fed"})
    aceito = m2.publicar(Aviso("inimigo_fed", {"campeao": "Darius"}, "d"), 0.0)
    fala = falas(m)[0][1].fala
    caso("tom descontraído e tipo desligado", fala == "Darius tá fed, nada de um contra um" and not aceito
         and falas(m)[0][1].rotulo == "evita 1x1", f"fala {fala!r}, desligado aceito={aceito}")


def caso_textos_md():
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "licoes.md"
        p.write_text("# Lições\n\n## Avisos ao vivo\n\n"
                     "- `ouro_guardado` | sério: volta pra base com {ouro} / volta já | descontraído: bora gastar {ouro} / gasta\n"
                     "- mid_sumiu | sério: o mid sumiu / mid sumiu\n\n## Outra seção\n- gank | sério: nao / nao\n",
                     encoding="utf-8")
        textos, fonte = carregar_textos([p])
    m = MotorAvisos(textos=textos)
    m.publicar(Aviso("ouro_guardado", {"ouro": 2300}, "o"), 0.0)
    a = falas(m)[0][1]
    caso("textos da seção 'Avisos ao vivo' do md", fonte.endswith("licoes.md") and a.fala == "volta pra base com 2300"
         and a.rotulo == "volta já" and textos["gank"]["serio"][0] == "gank provável {zona}"
         and textos["mid_sumiu"]["descontraido"][0].startswith("cadê"), f"fonte {Path(fonte).name}, fala {a.fala!r}")


def caso_fila_voz():
    ditas = []
    v = Voz(saida=lambda t: (ditas.append(t), time.sleep(0.2)))
    v.falar("primeira", prioridade=10)
    time.sleep(0.05)                       # o fio já pegou a primeira e está "falando"
    v.falar("comum", prioridade=30)
    v.falar("gank", urgente=True, prioridade=100)
    v.falar("mais importante que comum", prioridade=60)
    v.esperar(5)
    v.parar()
    caso("fila da voz por prioridade (urgente antes)", ditas == ["primeira", "gank", "mais importante que comum", "comum"],
         f"ordem {ditas}")


def caso_relogio():
    r = RelogioJogo()
    zero = r()
    r.atualizar(100.0)
    time.sleep(0.2)
    agora = r()
    caso("relógio do jogo extrapola entre leituras", zero == 0.0 and 100.15 < agora < 100.5, f"{agora:.2f}")


def caso_replay(caminho):
    if not caminho.exists():
        caso("replay da partida real", False, f"sem {caminho}")
        return
    m = MotorAvisos(textos=TEXTOS)
    g = GatilhosLive(m)
    publicados, carregando, ultimo = [], 0, None
    with open(caminho, encoding="utf-8") as f:
        for linha in f:
            d = json.loads(linha).get("dados")
            if not isinstance(d, dict):
                continue
            gt = float((d.get("gameData") or {}).get("gameTime") or 0)
            antes = len(publicados)
            publicados += [(gt, a) for a in g.atualizar(d)]
            if not any(e.get("EventName") == "GameStart" for e in g.eventos.values()):
                carregando += 1
                assert len(publicados) == antes
            m.tick(gt)
            ultimo = d
    f = falas(m)
    gaps = [b[0] - a[0] for a, b in zip(f, f[1:]) if not b[1].urgente]
    dragoes = [round(e["EventTime"]) for e in sorted(g.eventos.values(), key=lambda e: e["EventID"])
               if e["EventName"] == "DragonKill"]
    fim = g.game_time
    esperado_dragao = [t for t in [240] + [x + 300 - 60 for x in dragoes] if t < fim]
    obj_drag = [round(t) for t, a in publicados if a.tipo == "objetivo_60s" and a.dados["objetivo"] == "dragão"]
    eu = ultimo and next(p for p in ultimo["allPlayers"] if p["championName"] == g.eu)
    mortes_antes_10 = sum(1 for e in g.eventos.values() if e.get("EventName") == "ChampionKill"
                          and e.get("VictimName") == g.eu and e["EventTime"] < 600)
    tipos = sorted({a.tipo for _, a in publicados})
    print(f"     replay: eu={g.eu} ({eu and eu['position']}), {carregando} amostras de carregamento sem aviso,"
          f" {len(publicados)} avisos aceitos, {len(f)} falas; tipos {tipos}")
    for t, a in f:
        print(f"       {int(t) // 60:02d}:{int(t) % 60:02d}  [{a.tipo}] {a.fala}")
    caso("replay: falas a ≥ 20 s uma da outra e nenhuma chave repetida", all(x >= 20 for x in gaps) and sem_repeticao(m, 60),
         f"menor intervalo {min(gaps):.1f} s" if gaps else "")
    caso("replay: aviso de dragão 60 s antes de cada nascimento (gabarito = DragonKill gravados)",
         len(obj_drag) == len(esperado_dragao) and all(abs(o - e) <= 1 for o, e in zip(obj_drag, esperado_dragao)),
         f"esperado ~{esperado_dragao}, obtido {obj_drag}")
    sai_mortes = any(a.tipo == "mortes_cedo" for _, a in publicados)
    caso("replay: '2 mortes antes dos 10' só se houve 2 mortes antes dos 10",
         sai_mortes == (mortes_antes_10 >= 2), f"mortes antes dos 10 = {mortes_antes_10}, aviso = {sai_mortes}")
    # o mesmo momento real (gt ~400) com 2 mortes e 2500 de ouro → os dois avisos saem uma vez só
    amostra = None
    with open(caminho, encoding="utf-8") as f:
        for linha in f:
            d = json.loads(linha).get("dados")
            if isinstance(d, dict) and float((d.get("gameData") or {}).get("gameTime") or 0) >= 400:
                amostra = d
                break
    m2 = MotorAvisos(textos=TEXTOS)
    g2 = GatilhosLive(m2)
    for p in amostra["allPlayers"]:
        if p["championName"] == g.eu:
            p["scores"]["deaths"], p["isDead"] = 2, False
    amostra["activePlayer"]["currentGold"] = 2500
    tipos2 = [a.tipo for a in g2.atualizar(amostra)] + [a.tipo for a in g2.atualizar(amostra)]
    caso("amostra real alterada: 2 mortes aos 6:40 e 2500 de ouro → 1 aviso de cada",
         tipos2.count("mortes_cedo") == 1 and tipos2.count("ouro_guardado") == 1, f"{tipos2}")
    # timers vindos de fora (EstadoPartida do ao_vivo.py, que modela o ancião) trocam a tabela própria
    gt = float(amostra["gameData"]["gameTime"])
    g3 = GatilhosLive(MotorAvisos(textos=TEXTOS))
    fora = g3.atualizar(amostra, objetivos=[{"objetivo": "ancião", "nasce_em": gt + 30, "vivo": False}])
    caso("objetivos de fora: 'ancião em um minuto' e nada da tabela própria",
         [a.fala for a in fora if a.tipo == "objetivo_60s"] == ["ancião em um minuto"], f"{[a.fala for a in fora]}")


def caso_cache_estatico():
    """dado estático montado na 1ª fase com client, antes da partida (13/10/2026: a 1ª partida do coach
    rodou 'sem cache (FileNotFoundError)', o cache só nascia 3,5 s depois do InProgress)"""
    import asyncio
    import coach_vivo
    import sugestoes

    class LCU:
        def __init__(self, quebra=False):
            self.gets, self.quebra = [], quebra

        def get(self, caminho, timeout=None):
            self.gets.append(caminho)
            if self.quebra:
                raise ConnectionError("client fechando")
            return {"/lol-patch/v1/game-version": "16.20.1+teste",
                    "/lol-game-data/assets/v1/summoner-spells.json": [{"name": "Flash", "cooldown": 300, "gameModes": ["CLASSIC"]}],
                    "/lol-game-data/assets/v1/items.json": [{"id": 3031, "from": [1038], "to": [], "priceTotal": 3400,
                                                             "inStore": True, "categories": []}],
                    "/lol-game-data/assets/v1/champion-summary.json": [{"id": 1}, {"id": 60001}],
                    "/lol-game-data/assets/v1/champions/1.json": {"alias": "Annie", "id": 1, "name": "Annie",
                                                                  "tacticalInfo": {"damageType": "kMagic"}, "roles": ["mage"]},
                    }[caminho]

    class Janela:
        def fase(self, f):
            pass

        def fechar(self):
            pass

    def sem_mentor(*a):
        raise RuntimeError("sem mentor no teste")

    import logging
    log_coach = logging.getLogger("coletor.coach")   # avisos esperados (sem mentor, LCU quebrada) fora do stderr
    log_coach.propagate = False
    log_coach.addHandler(logging.NullHandler())
    with tempfile.TemporaryDirectory() as tmp:
        cache = Path(tmp) / "cache" / "jogo-estatico.json"
        fab = {"estatico": lambda lcu: sugestoes.carregar_estatico(cache, lcu=lcu), "mentor": sem_mentor,
               "janela": lambda url, ligado: Janela()}
        c = coach_vivo.Coach(db=Path(tmp) / "lol.db", config=Path(tmp) / "config.json", fabricas=fab)
        sem_antes = not cache.exists()
        lcu = LCU()
        asyncio.run(c.fase("Lobby", lcu=lcu))
        pronto = c.estatico_pronto.wait(10)
        lido = sugestoes.carregar_estatico(cache) if cache.exists() else None   # o que o _Partida lê no InProgress
        n = len(lcu.gets)
        asyncio.run(c.fase("ChampSelect", lcu=lcu))
        caso("cache do dado estático montado no Lobby, antes da 1ª partida (e só 1 vez)",
             sem_antes and pronto and lido and lido["versao"] == "16.20.1+teste" and lido["feiticos"] == {"Flash": 300}
             and list(lido["campeoes"]) == ["Annie"] and len(lcu.gets) == n and not cache.with_name(cache.name + ".tmp").exists(),
             f"GETs {n}, campeões {list((lido or {}).get('campeoes') or {})}")
        # client reaberto (atualizou de patch: porta nova) → confere de novo; mesma versão = só 1 GET
        lcu2 = LCU()
        c.lcu = lcu2
        t2 = c.aquecer_estatico()
        if t2:
            t2.join(5)
        caso("client reaberto (outra LCU): aquece de novo, 1 GET da versão com o cache em dia",
             t2 is not None and lcu2.gets == ["/lol-patch/v1/game-version"] and c.estatico_pronto.is_set(),
             f"GETs {lcu2.gets}")
        # LCU falhando: não marca pronto e tenta de novo depois da espera (não a cada fase)
        c2 = coach_vivo.Coach(db=Path(tmp) / "lol.db", config=Path(tmp) / "config.json",
                              fabricas={**fab, "estatico": lambda lcu: sugestoes.carregar_estatico(Path(tmp) / "x.json", lcu=lcu)})
        ruim = LCU(quebra=True)
        c2.lcu = ruim
        t = c2.aquecer_estatico()
        t.join(5)
        de_novo_ja = c2.aquecer_estatico()
        depois = c2.aquecer_estatico(espera_s=0)
        if depois:
            depois.join(5)
        caso("LCU falhando: não marca pronto, não repete a cada fase, tenta de novo depois da espera",
             not c2.estatico_pronto.is_set() and de_novo_ja is None and depois is not None and len(ruim.gets) == 2,
             f"GETs {len(ruim.gets)}")
    log_coach.propagate = True


def principal():
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", type=Path, default=LIVE_PADRAO)
    a = ap.parse_args()
    caso_30s()
    caso_gank()
    caso_fura_informativo()
    caso_validade()
    caso_tom()
    caso_textos_md()
    caso_fila_voz()
    caso_relogio()
    caso_cache_estatico()
    caso_replay(a.live)
    n = sum(resultados)
    print(f"\n{'ok' if n == len(resultados) else 'FALHOU'} ({n}/{len(resultados)})")
    return 0 if n == len(resultados) else 1


if __name__ == "__main__":
    sys.exit(principal())
