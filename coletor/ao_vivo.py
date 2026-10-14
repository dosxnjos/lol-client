# laço ao vivo do lol-client (plano v2, passos 8 e 10): Live Client Data API a cada 1 s ->
# estado em memória (servido em /estado pelo servidor_local) e amostra a cada 10 s de gameTime nas
# tabelas ao_vivo/eventos_ao_vivo. Só lê a API local pública da Riot: nada de memória do jogo,
# nada de tecla. O que está na fog não aparece: nível, itens e farm do inimigo congelam quando ele
# some e saem com "visto há Xs". KDA, morte e objetivos são globais. Medição: docs/MEDICAO-2026-10-13.md.
#
# uso avulso (simulador): python coletor/ao_vivo.py --liveclient http://127.0.0.1:2998 --db temp/ao_vivo.db
import argparse
import json
import logging
import ssl
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import banco  # noqa: E402

LIVECLIENT_PADRAO = "https://127.0.0.1:2999"
CATALOGO = banco.RAIZ / "dados" / "cache" / "catalogo.json"
FORA_DAS_CONTAS = (0, 3100, 3140)  # mesma régua do analise.py: personalizada e treino não gravam
AMOSTRA_S = 10       # uma amostra no banco a cada 10 s de gameTime
VELHO_S = 30         # inimigo sem mudança há mais que isso: "visto há Xs" (não é dado atual)
SEM_RESPOSTA_S = 10  # Live Client calada por mais que isso: partida acabou
ROTAS = ("TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY")
ROTA_PT = {"TOP": "topo", "JUNGLE": "selva", "MIDDLE": "meio", "BOTTOM": "atirador", "UTILITY": "suporte"}

# horários dos objetivos medidos no banco (202 partidas, patches 16.8–16.20, 13/10/2026): 1º abate
# mais cedo e menor intervalo entre abates. Dragão 328 s / +307 s, vastilarvas 487 s (uma leva de 3),
# arauto 921 s (um só), barão 1219 s / +381 s, ancião +370 s depois da alma. Patch novo: conferir.
DRAGAO_1, DRAGAO_RENASCE = 300, 300
VASTILARVAS_1, VASTILARVAS_N = 480, 3
ARAUTO_1 = 900
BARAO_1, BARAO_RENASCE = 1200, 360
ANCIAO_RENASCE = 360
DRAGAO_PT = {"Fire": "Infernal", "Water": "Oceano", "Earth": "Montanha", "Air": "Nuvem",
             "Chemtech": "Quimtec", "Hextech": "Hextec", "Elder": "Ancião"}
AP_CATS = {"SpellDamage", "MagicPenetration"}
AD_CATS = {"Damage", "CriticalStrike", "ArmorPenetration"}

log = logging.getLogger("coletor.ao_vivo")


def mmss(s):
    s = max(0, int(s))
    return f"{s // 60:02d}:{s % 60:02d}"


# ---------- catálogo (preço total e categoria dos itens, campeões) ----------

def baixar_catalogo(lcu, caminho=CATALOGO):
    """items.json e champion-summary.json da LCU -> cache em dados/cache (o preço da Live Client é
    o da receita, não o total: Botas Galvanizadas 600 contra 1200)"""
    itens = lcu.get("/lol-game-data/assets/v1/items.json", timeout=30) or []
    camps = lcu.get("/lol-game-data/assets/v1/champion-summary.json", timeout=30) or []
    cat = {"itens": {str(i["id"]): {"total": i.get("priceTotal") or 0, "cats": i.get("categories") or []}
                     for i in itens if isinstance(i, dict) and "id" in i},
           "campeoes": {c["alias"]: {"id": c["id"], "nome": c.get("name"), "papeis": c.get("roles") or []}
                        for c in camps if isinstance(c, dict) and 0 < c.get("id", -1) < 10000 and c.get("alias")}}
    caminho = Path(caminho)
    caminho.parent.mkdir(parents=True, exist_ok=True)
    caminho.write_text(json.dumps(cat, ensure_ascii=False), encoding="utf-8")
    return cat


def ler_catalogo(caminho=CATALOGO):
    try:
        return json.loads(Path(caminho).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


# ---------- histórico ("Teu padrão") ----------

def historico_mortes10(db=banco.DB_PADRAO):
    """vitórias por mortes antes dos 10 (0, 1, 2+) no histórico: {campeao|None: {balde: [v, n]}}.
    Mesmas partidas do analise.py (Rift, linha do tempo, fora remake/personalizada/treino)"""
    try:
        c = banco.abrir_leitura(db)
    except FileNotFoundError:
        return {}
    try:
        linhas = c.execute(
            "select p.campeao, p.vitoria, (select count(*) from eventos e where e.game_id = p.game_id "
            "and e.tipo = 'CHAMPION_KILL' and e.victim_id = p.eu and e.ts < 600000) "
            "from partidas p where p.mapa = 11 and p.tem_timeline = 1 and p.eu is not null "
            f"and p.fila not in {FORA_DAS_CONTAS} and p.duracao >= 300").fetchall()
    except Exception as e:
        log.warning("histórico do padrão indisponível: %s", e)
        return {}
    finally:
        c.close()
    out = {}
    for camp, vit, m in linhas:
        balde = min(m, 2)
        for chave in (None, camp):
            v = out.setdefault(chave, {}).setdefault(balde, [0, 0])
            v[0] += vit or 0
            v[1] += 1
    return out


def padrao_por_historico(hist):
    """devolve f(estado) -> {titulo, detalhe, cor} com a regra de mortes antes dos 10"""
    def wr(campeao, balde):
        v = (hist.get(campeao) or {}).get(balde)
        if not v or v[1] < 8:  # pouca amostra no campeão: usa o geral
            v = (hist.get(None) or {}).get(balde)
        return (round(100 * v[0] / v[1]), v[1]) if v and v[1] else (None, 0)

    def f(est):
        eu = est.get("euJogador")
        if not eu:
            return None
        gt = est.get("gt") or 0
        mortes10 = est.get("mortes10", 0)
        balde = min(mortes10, 2)
        pct, n = wr(eu.get("campeao"), balde)
        hist_txt = f"{pct}% de vitória em {n} partidas" if pct is not None else "sem histórico"
        if gt < 600:
            titulo = ["0 mortes até agora", "1 morte antes dos 10", f"{mortes10} mortes antes dos 10"][balde]
            detalhe = ["segura a rota até 10:00", "cuidado até 10:00", "joga seguro, farma"][balde]
        else:
            titulo = f"saiu dos 10 com {mortes10} morte" + ("s" if mortes10 != 1 else "")
            detalhe = ["rota limpa: aperta", "ainda dá: objetivo", "vira com objetivo, não 1x1"][balde]
        return {"titulo": titulo, "detalhe": detalhe, "historico": hist_txt,
                "cor": ("verde", "amarelo", "vermelho")[balde]}
    return f


# ---------- avisos básicos (a faixa de 1 aviso; o coach.py substitui) ----------

class AvisosBasicos:
    """só avisos que saem da API (objetivo em 1 min, janela com 2+ inimigos mortos).
    Anti-spam: um aviso por vez, validade em s de jogo, intervalo mínimo por id e no máximo um
    aviso novo a cada 30 s (a janela de objetivo também fica marcada no bloco de objetivos)."""
    INTERVALO = {"janela": 45, "objetivo": 240}
    ENTRE_AVISOS = 30

    def __init__(self):
        self.limpar()

    def limpar(self):
        self.atual = None
        self.ultimo = -1e9  # gt do último aviso novo
        self.visto = {}  # id -> gt da última vez que saiu

    def __call__(self, est):
        gt = est.get("gt") or 0
        if self.atual and gt - self.atual["desde"] >= self.atual["validadeS"]:
            self.atual = None
        cands = []
        ob = est.get("objetivos") or {}
        mortos = [m for m in ob.get("inimigosMortos") or [] if m["renascerS"] >= 8]
        if len(mortos) >= 2:
            cands.append({"id": "janela", "tipo": "janela", "prioridade": 3, "validadeS": 10,
                          "texto": f"{len(mortos)} mortos: joga objetivo", "icone": "janela", "cor": "verde"})
        for chave, nome in (("dragao", "Dragão"), ("anciao", "Ancião"), ("barao", "Barão"),
                            ("arauto", "Arauto"), ("vastilarvas", "Vastilarvas")):
            o = ob.get(chave)
            if o and o.get("emS") is not None and 40 <= o["emS"] <= 60:
                cands.append({"id": f"{chave}-{int(o['nasceGt'])}", "tipo": "objetivo", "prioridade": 2,
                              "validadeS": 12, "texto": f"{nome} em 1 minuto", "icone": chave, "cor": "azul"})
        cands = [a for a in cands if gt - self.visto.get(a["id"], -1e9) >= self.INTERVALO[a["tipo"]]]
        if cands and not self.atual and gt - self.ultimo >= self.ENTRE_AVISOS:
            novo = max(cands, key=lambda a: a["prioridade"])
            self.atual = {**novo, "desde": gt}
            self.visto[novo["id"]] = self.ultimo = gt
        return self.atual and {k: v for k, v in self.atual.items() if k != "desde"}


# ---------- estado de uma partida (sem IO: o laço e os testes alimentam) ----------

class EstadoPartida:
    def __init__(self, catalogo=None, avisador=None, padrao=None):
        self.cat = catalogo or {}
        self.avisador = avisador or AvisosBasicos()
        self.padrao = padrao
        self.limpar()

    def limpar(self):
        self.eventos = {}       # EventID -> evento (já sem Riot ID)
        self.novos = []         # eventos ainda não gravados no banco
        self.visto = {}         # jogador -> (assinatura nível/itens/cs, gt da última mudança)
        self.gt = None
        self.est = {"partida": False}
        if hasattr(self.avisador, "limpar"):
            self.avisador.limpar()

    # -- catálogo --
    def _camp(self, p):
        alias = str(p.get("rawChampionName") or "").replace("game_character_displayname_", "")
        info = (self.cat.get("campeoes") or {}).get(alias)
        if info:
            return info
        nome = p.get("championName")
        return next((v for v in (self.cat.get("campeoes") or {}).values() if v.get("nome") == nome), {})

    def _ouro(self, itens):
        tab = self.cat.get("itens") or {}
        total = 0
        for it in itens:
            info = tab.get(str(it.get("itemID")))
            preco = info["total"] if info else (it.get("price") or 0)
            total += preco * max(1, it.get("count") or 1) if it.get("consumable") else preco
        return int(total)

    def _dano(self, itens, papeis):
        tab = self.cat.get("itens") or {}
        ad = ap = 0
        for it in itens:
            cats = set((tab.get(str(it.get("itemID"))) or {}).get("cats") or [])
            ad += bool(cats & AD_CATS)
            ap += bool(cats & AP_CATS)
        if ad != ap:
            return "AD" if ad > ap else "AP"
        # sem item de dano: pelo papel do campeão (tanque varia: Zac é mágico, Sion físico)
        papeis = set(papeis)
        if "mage" in papeis:
            return "AP"
        if "marksman" in papeis or (papeis & {"fighter", "assassin"} and "tank" not in papeis):
            return "AD"
        return "misto"

    # -- passo --
    def atualizar(self, dados, agora_ms=None):
        """processa um allgamedata (já passado por coletor.limpar_live); devolve o estado"""
        if not isinstance(dados, dict) or not isinstance(dados.get("allPlayers"), list):
            return self.est
        gt = float((dados.get("gameData") or {}).get("gameTime") or 0)
        if self.gt is not None and gt < self.gt - 5:
            self.limpar()  # partida nova (ou o simulador voltou no tempo)
        self.gt = gt
        evs = ((dados.get("events") or {}).get("Events")) or []
        for e in evs:
            if isinstance(e, dict) and e.get("EventID") is not None and e["EventID"] not in self.eventos:
                self.eventos[e["EventID"]] = e
                self.novos.append(e)
        nomes = {e.get("EventName") for e in self.eventos.values()}
        fase = "fim" if "GameEnd" in nomes else ("jogo" if "GameStart" in nomes or gt >= 1 else "carregando")

        jogadores = dados["allPlayers"]
        ativo = (dados.get("activePlayer") or {})
        eu_nome = ativo.get("riotId") or ativo.get("summonerName")
        eu_slot = next((i for i, p in enumerate(jogadores)
                        if eu_nome and eu_nome in (p.get("riotId"), p.get("summonerName"))), None)
        meu_time = jogadores[eu_slot].get("team") if eu_slot is not None else "ORDER"
        slot_de = {}
        for i, p in enumerate(jogadores):
            for k in ("riotId", "summonerName"):
                if p.get(k):
                    slot_de[p[k]] = i

        # vistos por evento: abate com um aliado do outro lado = o inimigo estava na tela de alguém
        vistos_ev = {}
        for e in self.eventos.values():
            if e.get("EventName") not in ("ChampionKill", "TurretKilled"):
                continue
            envolvidos = [e.get("KillerName"), e.get("VictimName"), *(e.get("Assisters") or [])]
            slots = [slot_de[n] for n in envolvidos if n in slot_de]
            tem_aliado = any(jogadores[s].get("team") == meu_time for s in slots) or \
                (e.get("EventName") == "TurretKilled" and f"_T{'Order' if meu_time == 'ORDER' else 'Chaos'}_"
                 in str(e.get("TurretKilled")))
            if tem_aliado:
                for s in slots:
                    vistos_ev[s] = max(vistos_ev.get(s, 0), float(e.get("EventTime") or 0))

        lista = []
        for i, p in enumerate(jogadores):
            sc = p.get("scores") or {}
            itens = [it for it in p.get("items") or [] if isinstance(it, dict)]
            info = self._camp(p)
            aliado = p.get("team") == meu_time
            assin = (p.get("level"), tuple(sorted(it.get("itemID") or 0 for it in itens)), sc.get("creepScore"))
            chave = p.get("riotId") or p.get("championName")  # a ordem de allPlayers muda ao sair do carregamento
            ant = self.visto.get(chave)
            if ant is None:
                # 1ª leitura: no início todos estão na base (dado certo); no meio da partida (coletor
                # reiniciou) não se sabe desde quando o dado está parado
                visto_gt = gt if fase == "carregando" or gt <= 5 else None
            else:
                visto_gt = gt if ant[0] != assin else ant[1]
            if i in vistos_ev:
                visto_gt = max(visto_gt or 0, vistos_ev[i])
            if aliado:
                visto_gt = gt
            self.visto[chave] = (assin, visto_gt)
            ha = 0 if aliado or fase == "carregando" else (None if visto_gt is None else max(0, gt - visto_gt))
            lista.append({
                "slot": i, "campeao": info.get("id"), "nome": p.get("championName"),
                "time": 100 if p.get("team") == "ORDER" else 200, "aliado": aliado, "eu": i == eu_slot,
                "rota": p.get("position") or "", "nivel": p.get("level"),
                "itens": [it.get("itemID") for it in itens], "ouroEstimado": self._ouro(itens),
                "k": sc.get("kills", 0), "d": sc.get("deaths", 0), "a": sc.get("assists", 0),
                "cs": sc.get("creepScore", 0), "morto": bool(p.get("isDead")),
                "renascerS": round(float(p.get("respawnTimer") or 0), 1),
                "vistoGt": None if visto_gt is None else round(visto_gt, 1),
                "vistoHaS": None if ha is None else round(ha), "atual": ha is not None and ha <= VELHO_S,
                "dano": self._dano(itens, info.get("papeis") or []),
                "feiticos": [((p.get("summonerSpells") or {}).get(k) or {}).get("displayName")
                             for k in ("summonerSpellOne", "summonerSpellTwo")],
                "keystone": ((p.get("runes") or {}).get("keystone") or {}).get("displayName"),
            })
        eu = lista[eu_slot] if eu_slot is not None else None
        aliados = [j for j in lista if j["aliado"]]
        inimigos = [j for j in lista if not j["aliado"]]
        adv = None
        if eu and eu["rota"]:
            mesmos = [j for j in inimigos if j["rota"] == eu["rota"]]
            adv = mesmos[0] if len(mesmos) == 1 else None

        est = {"partida": True, "fase": fase, "gt": round(gt, 1), "relogio": mmss(gt),
               "atualizadoMs": agora_ms or banco.agora_ms(), "meuTime": 100 if meu_time == "ORDER" else 200,
               "eu": eu_slot, "euJogador": eu, "ouroBolso": int(ativo.get("currentGold") or 0),
               "precos": "lcu" if self.cat.get("itens") else "aproximado",
               "jogadores": sorted(aliados, key=self._ordem) + sorted(inimigos, key=self._ordem)}
        est["mortes10"] = sum(1 for e in self.eventos.values() if e.get("EventName") == "ChampionKill"
                              and eu and slot_de.get(e.get("VictimName")) == eu_slot
                              and float(e.get("EventTime") or 0) < 600)
        est["rota"] = self._rota(eu, adv, est["ouroBolso"])
        est["ameaca"] = self._ameaca(inimigos, adv)
        est["objetivos"] = self._objetivos(gt, fase, lista, slot_de, meu_time, inimigos)
        try:
            est["padrao"] = self.padrao(est) if self.padrao else None
        except Exception as e:
            log.warning("padrão falhou: %s", e)
            est["padrao"] = None
        try:
            est["aviso"] = self.avisador(est) if fase == "jogo" else None
        except Exception as e:
            log.warning("aviso falhou: %s", e)
            est["aviso"] = None
        self.est = est
        return est

    @staticmethod
    def _ordem(j):
        return (ROTAS.index(j["rota"]) if j["rota"] in ROTAS else 9, j["slot"])

    @staticmethod
    def _rota(eu, adv, bolso):
        if not eu:
            return None
        out = {"eu": {k: eu[k] for k in ("nome", "campeao", "rota", "nivel", "cs", "ouroEstimado")},
               "bolso": bolso, "adv": None, "diff": None, "cor": {}}
        if adv:
            out["adv"] = {k: adv[k] for k in ("nome", "campeao", "nivel", "cs", "ouroEstimado", "vistoHaS", "atual")}
            # itens do adversário só chegam quando ele é visto: nunca visto ou sem item = ouro dele desconhecido (no começo
            # da partida a conta dava "+500", o item inicial do Gabriel contra o inventário vazio; 14/10/2026)
            ouro_ok = adv.get("vistoGt") is not None and bool(adv.get("itens"))
            d = {"ouro": eu["ouroEstimado"] - adv["ouroEstimado"] if ouro_ok else None, "cs": eu["cs"] - adv["cs"],
                 "nivel": (eu["nivel"] or 0) - (adv["nivel"] or 0)}
            out["diff"] = d
            # limiar do ouro aos 10 do histórico (+500 -> 70%, -500 -> 41%); farm anda de 10 em 10
            lim = {"ouro": 500, "cs": 20, "nivel": 1}
            for k, v in d.items():
                if v is None:
                    out["cor"][k] = "velho"
                elif not adv["atual"]:
                    out["cor"][k] = "velho"  # dado do adversário parado na fog: não é comparação atual
                else:
                    out["cor"][k] = "verde" if v >= lim[k] else "vermelho" if v <= -lim[k] else "neutro"
        return out

    @staticmethod
    def _ameaca(inimigos, adv):
        if not inimigos:
            return None
        def peso(j):
            return (j["k"] + j["a"]) / max(1, j["d"]) * max(1, j["ouroEstimado"])
        j = max(inimigos, key=lambda j: (peso(j), j["k"]))
        kda = (j["k"] + j["a"]) / max(1, j["d"])
        return {"nome": j["nome"], "campeao": j["campeao"], "k": j["k"], "d": j["d"], "a": j["a"],
                "kda": round(kda, 1), "ouroEstimado": j["ouroEstimado"], "dano": j["dano"],
                "nivel": j["nivel"], "vistoHaS": j["vistoHaS"], "atual": j["atual"],
                "morto": j["morto"], "renascerS": j["renascerS"],
                "rota": j["rota"], "minhaRota": bool(adv and adv["slot"] == j["slot"])}

    def _objetivos(self, gt, fase, lista, slot_de, meu_time, inimigos):
        evs = sorted(self.eventos.values(), key=lambda e: float(e.get("EventTime") or 0))
        lista_slot = {j["slot"]: j for j in lista}

        def time_de(e):
            s = slot_de.get(e.get("KillerName"))
            if s is None:
                return None
            return "nosso" if lista_slot[s]["aliado"] else "deles"
        drag = {"nosso": [], "deles": []}
        ult_drag = ult_barao = None
        alma = elemento = None
        hordas = 0
        arauto_feito = False
        for e in evs:
            n, t = e.get("EventName"), float(e.get("EventTime") or 0)
            if n == "DragonKill":
                tipo = e.get("DragonType")
                if tipo == "Elder":
                    ult_drag = ("anciao", t)
                    continue
                lado = time_de(e)
                if lado:
                    drag[lado].append(tipo)
                total = len(drag["nosso"]) + len(drag["deles"])
                if total == 3:
                    elemento = tipo  # a fenda muda por volta do 2º/3º: elemento = o do 3º
                if lado and len(drag[lado]) == 4 and not alma:
                    alma = {"time": lado, "tipo": tipo}
                ult_drag = ("alma" if alma else "dragao", t)
            elif n == "BaronKill":
                ult_barao = t
            elif n == "HordeKill":
                hordas += 1
            elif n == "HeraldKill":
                arauto_feito = True

        def timer(nasce, ativo=True):
            if not ativo or nasce is None:
                return None
            em = nasce - gt
            return {"nasceGt": round(nasce, 1), "emS": round(em) if em > 0 else 0, "vivo": em <= 0,
                    "texto": "vivo" if em <= 0 else mmss(em)}
        ob = {}
        if alma:
            ob["dragao"] = None
            ob["anciao"] = timer((ult_drag[1] if ult_drag else gt) + ANCIAO_RENASCE)
        else:
            ob["dragao"] = timer(DRAGAO_1 if not ult_drag else ult_drag[1] + DRAGAO_RENASCE)
            ob["anciao"] = None
        if fase == "carregando":
            ob["dragao"] = timer(DRAGAO_1)
        ob["vastilarvas"] = timer(VASTILARVAS_1, hordas < VASTILARVAS_N and gt < ARAUTO_1)
        ob["arauto"] = timer(ARAUTO_1, not arauto_feito and gt < BARAO_1)
        ob["barao"] = timer(BARAO_1 if ult_barao is None else ult_barao + BARAO_RENASCE, gt >= ARAUTO_1 - 60)
        ob["dragoes"] = {"nosso": len(drag["nosso"]), "deles": len(drag["deles"]),
                         "tiposNosso": [DRAGAO_PT.get(x, x) for x in drag["nosso"]],
                         "tiposDeles": [DRAGAO_PT.get(x, x) for x in drag["deles"]],
                         "fenda": DRAGAO_PT.get(elemento, elemento) if elemento else None,
                         "alma": alma and {"time": alma["time"], "tipo": DRAGAO_PT.get(alma["tipo"], alma["tipo"])}}
        ob["inimigosMortos"] = sorted(({"nome": j["nome"], "renascerS": round(j["renascerS"])}
                                       for j in inimigos if j["morto"] and j["renascerS"] >= 1),
                                      key=lambda m: -m["renascerS"])
        ob["aliadosMortos"] = sorted(({"nome": j["nome"], "renascerS": round(j["renascerS"])}
                                      for j in lista if j["aliado"] and j["morto"] and j["renascerS"] >= 1),
                                     key=lambda m: -m["renascerS"])
        ob["janela"] = sum(1 for m in ob["inimigosMortos"] if m["renascerS"] >= 8) >= 2
        ad = sum(1 for j in inimigos if j["dano"] == "AD")
        ap = sum(1 for j in inimigos if j["dano"] == "AP")
        # genérico até a tabela curada (docs/ITENS.md, Renekton e Zac) existir
        if ad >= 3 and ad > ap:
            sug = {"texto": "armadura", "motivo": f"{ad} de {len(inimigos)} com dano físico"}
        elif ap >= 3 and ap > ad:
            sug = {"texto": "resistência mágica", "motivo": f"{ap} de {len(inimigos)} com dano mágico"}
        else:
            sug = {"texto": "vida", "motivo": f"dano misto ({ad} AD · {ap} AP)"}
        ob["composicao"] = {"ad": ad, "ap": ap, "outros": len(inimigos) - ad - ap}
        ob["sugestaoItem"] = sug
        return ob


# ---------- laço (thread) ----------

class LiveClient:
    def __init__(self, url=LIVECLIENT_PADRAO):
        self.url = url.rstrip("/")
        # TLS sem verificação: certificado da Riot autoassinado, só em 127.0.0.1
        self.ctx = ssl.create_default_context()
        self.ctx.check_hostname = False
        self.ctx.verify_mode = ssl.CERT_NONE

    def allgamedata(self, timeout=2):
        """dict, ou None fora da partida (conexão recusada, 404, corpo inválido)"""
        try:
            req = urllib.request.Request(f"{self.url}/liveclientdata/allgamedata", headers={"Accept": "application/json"})
            kw = {"context": self.ctx} if self.url.startswith("https") else {}
            with urllib.request.urlopen(req, timeout=timeout, **kw) as r:
                return json.loads(r.read())
        except (urllib.error.URLError, OSError, ValueError):
            return None


class AoVivo:
    """laço ao vivo: iniciar(game_id, fila) em InProgress, parar() no fim; estado() a qualquer hora.
    Grava em `db` (conexão própria na thread). avisador/padrao: funções f(estado) que o coach troca."""

    def __init__(self, liveclient=LIVECLIENT_PADRAO, db=banco.DB_PADRAO, historico_db=None,
                 catalogo=None, lcu=None, avisador=None, padrao=None, intervalo=1.0):
        self.cliente = LiveClient(liveclient)
        self.db = db
        self.historico_db = historico_db or db
        self.lcu = lcu
        self.catalogo = catalogo
        self.avisador = avisador
        self.padrao = padrao
        self.intervalo = intervalo
        self.trava = threading.Lock()
        self.thread = None
        self.parando = threading.Event()
        self._est = {"partida": False}
        self.game_id = self.fila = None
        self.gravar = True
        self.amostras = 0
        self.ouvintes = []

    def ao_ler(self, fn):
        """fn(bruto, limpo, estado) a cada leitura (thread do laço, antes de publicar o estado).
        bruto tem o Riot ID dos 10 (só memória); limpo e estado não. Devolver um dict acrescenta
        chaves ao /estado (ex.: {"jungler": ...}). Para avisos, minimapa, carregamento, mentor."""
        self.ouvintes.append(fn)
        return fn

    def estado(self):
        with self.trava:
            return self._est

    def ativo(self):
        return bool(self.thread and self.thread.is_alive())

    def iniciar(self, game_id=None, fila=None, gravar=True):
        """idempotente na mesma partida; partida nova reinicia. Grava amostras só com game_id, fila
        fora de FORA_DAS_CONTAS (treino e personalizada só no painel) e gravar=True (config amostrasAoVivo)"""
        if self.ativo():
            if game_id and game_id != self.game_id:
                self.parar()
            else:
                return
        self.game_id, self.fila, self.gravar = game_id, fila, gravar
        self.amostras = 0
        self.parando.clear()
        self.thread = threading.Thread(target=self._rodar, name="ao-vivo", daemon=True)
        self.thread.start()
        log.info("ao vivo iniciado (partida %s, fila %s)", game_id, fila)

    def parar(self):
        self.parando.set()
        if self.thread and self.thread is not threading.current_thread():
            self.thread.join(timeout=5)
        self.thread = None
        with self.trava:
            self._est = {"partida": False}

    def _preparar(self):
        """catálogo do cache na hora (o carregamento tem ~100 s); a LCU atualiza em paralelo"""
        cat = self.catalogo if self.catalogo is not None else ler_catalogo()
        padrao = self.padrao or padrao_por_historico(historico_mortes10(self.historico_db))
        partida = EstadoPartida(cat, self.avisador, padrao)
        if self.catalogo is None and self.lcu is not None:
            threading.Thread(target=self._atualizar_catalogo, args=(partida,), name="catalogo", daemon=True).start()
        return partida

    def _atualizar_catalogo(self, partida):
        try:
            partida.cat = baixar_catalogo(self.lcu)
        except Exception as e:
            log.warning("catálogo da LCU indisponível (fica o cache): %s", e)

    def _rodar(self):
        from coletor import limpar_live  # dono único da troca de Riot ID por campeão
        try:
            partida = self._preparar()
            gravar = self.gravar and self.game_id is not None and self.fila not in FORA_DAS_CONTAS
            c = banco.abrir(self.db) if gravar else None
            if c is not None:
                banco.criar_ao_vivo(c)
        except Exception:
            log.exception("ao vivo não iniciou")
            return
        ultimo_ok = time.monotonic()
        ultimo_balde = None
        erros = 0
        try:
            while not self.parando.is_set():
                t0 = time.monotonic()
                try:
                    dados = self.cliente.allgamedata()
                    if dados is not None:
                        ultimo_ok = t0
                        limpo = limpar_live(dados)
                        est = partida.atualizar(limpo)
                        est["gameId"] = self.game_id
                        for fn in list(self.ouvintes):
                            try:
                                extra = fn(dados, limpo, est)
                                if isinstance(extra, dict):
                                    est.update(extra)
                            except Exception as e:
                                log.warning("ouvinte do ao vivo falhou: %s", e)
                        with self.trava:
                            self._est = est  # publicado pronto: ninguém mexe depois
                        if c is not None and est["fase"] != "carregando":
                            self._gravar(c, partida)
                            balde = int(est["gt"] // AMOSTRA_S)
                            if balde != ultimo_balde:
                                ultimo_balde = balde
                                banco.gravar_amostra_ao_vivo(c, self.game_id, est["gt"],
                                                             [_linha(j) for j in est["jogadores"]])
                                self.amostras += 1
                    elif time.monotonic() - ultimo_ok > SEM_RESPOSTA_S:
                        with self.trava:
                            self._est = {"partida": False}
                except Exception:
                    erros += 1
                    if erros <= 3:  # amostra estranha não derruba o laço; o log não enche
                        log.exception("ao vivo: erro numa leitura (%d)", erros)
                self.parando.wait(max(0.05, self.intervalo - (time.monotonic() - t0)))
        finally:
            if c is not None:
                self._gravar(c, partida)
                c.close()
            log.info("ao vivo parado (%d amostras)", self.amostras)

    def _gravar(self, c, partida):
        if partida.novos:
            banco.gravar_eventos_ao_vivo(c, self.game_id, partida.novos)
            partida.novos = []


_OBJ_AVISOS = {"dragao": "dragão", "anciao": "ancião", "vastilarvas": "vastilarvas", "arauto": "arauto",
               "barao": "barão"}


def objetivos_para_avisos(est):
    """timers do estado no formato de avisos.GatilhosLive.atualizar(objetivos=...):
    [{objetivo, nasce_em, vivo}] (ancião incluso; objetivo que não volta fica de fora)"""
    ob = (est or {}).get("objetivos") or {}
    return [{"objetivo": nome, "nasce_em": ob[k]["nasceGt"], "vivo": ob[k]["vivo"]}
            for k, nome in _OBJ_AVISOS.items() if ob.get(k)]


def _linha(j):
    return {"slot": j["slot"], "time": j["time"], "campeao": j["campeao"], "nome": j["nome"], "rota": j["rota"],
            "nivel": j["nivel"], "itens": j["itens"], "ouro_est": j["ouroEstimado"], "kills": j["k"],
            "deaths": j["d"], "assists": j["a"], "cs": j["cs"], "morto": j["morto"],
            "renascer": j["renascerS"], "visto_gt": j["vistoGt"], "eu": j["eu"]}


def principal():
    ap = argparse.ArgumentParser(description="laço ao vivo + servidor do painel (avulso, para o simulador)")
    ap.add_argument("--liveclient", default=LIVECLIENT_PADRAO, help="URL da Live Client (padrão https://127.0.0.1:2999)")
    ap.add_argument("--db", default=str(banco.RAIZ / "temp" / "ao_vivo.db"), help="banco onde grava as amostras")
    ap.add_argument("--historico", default=str(banco.DB_PADRAO), help="banco do histórico (só leitura)")
    ap.add_argument("--game-id", type=int, default=None)
    ap.add_argument("--fila", type=int, default=None)
    ap.add_argument("--porta", type=int, default=8765)
    ap.add_argument("--baixar-catalogo", action="store_true", help="lê items.json/champion-summary da LCU e sai")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.baixar_catalogo:
        import coletor
        lcu = coletor.conectar()
        if not lcu:
            print("client fechado")
            return 1
        cat = baixar_catalogo(lcu)
        print(f"catálogo: {len(cat['itens'])} itens, {len(cat['campeoes'])} campeões -> {CATALOGO}")
        return 0
    import servidor_local
    av = AoVivo(args.liveclient, args.db, historico_db=args.historico)
    av.iniciar(args.game_id, args.fila)
    srv = servidor_local.ServidorLocal(av.estado, db=args.historico, porta=args.porta)
    if not srv.iniciar():
        av.parar()
        return 1
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        srv.parar()
        av.parar()
    return 0


if __name__ == "__main__":
    sys.exit(principal())
