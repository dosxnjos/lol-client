"""prova do registro das expansões do client compacto, lado do coletor (plano do compacto, passo 15): rota
POST /compacto/expansoes num servidor local de teste (porta 8798; nada da LCU, nada do coletor real), mesma regra de
origem do /aceite/plugin, saneamento (chave desconhecida fora, texto cortado, Riot ID fora), gravação em jsonl com
rotação, o coletor pendura a rota, e o relatório (tools/relatorio-expansoes.py) juntando início e fim e agrupando.
uso: python tools/teste-expansoes.py
"""
import importlib.util
import json
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace

sys.stdout.reconfigure(encoding="utf-8")
RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import coletor  # noqa: E402
import expansoes  # noqa: E402
import servidor_local  # noqa: E402

spec = importlib.util.spec_from_file_location("relatorio_expansoes", RAIZ / "tools" / "relatorio-expansoes.py")
R = importlib.util.module_from_spec(spec)
spec.loader.exec_module(R)

resultados = []
PORTA = 8798


def caso(nome, ok, detalhe=""):
    resultados.append(bool(ok))
    print(f"{'ok' if ok else 'FALHOU'}  {nome}" + ("" if ok or not detalhe else f"  ({detalhe})"))


def evento(tipo="inicio", i="abc-1", **kw):
    return {"tipo": tipo, "id": i, "em": "2026-10-15T05:00:00.000Z", **kw}


def linhas(arq):
    try:
        return [json.loads(x) for x in Path(arq).read_text(encoding="utf-8").splitlines() if x.strip()]
    except OSError:
        return []


def main():
    tmp = Path(tempfile.mkdtemp(prefix="lc-expansoes-"))

    # ---------- A. saneamento ----------
    bruto = evento(origem="modal", porEle=False, motivo="o client abriu uma janela própria (modal) Fulano#BR1", fase="Lobby",
                   fila=420, mapa=11, lixo={"x": 1}, nome="Fulano", janelaAntes={"larg": 420, "alt": 680, "puuid": "x", "monitor": [0, 0, 1920, 1080]},
                   camadas=[{"tag": "div", "id": "id com espaço", "classes": "modal", "titulo": "missão …", "botoes": ["ok", 3],
                             "filhos": [{"tag": "lol-uikit-dialog-frame", "classes": "x", "texto": "gg"}], "texto": "chat"}],
                   trilha=[{"aposMs": 10, "fase": "ChampSelect", "motivo": "m", "origem": "fase", "extra": 1}],
                   motivoLongo="x" * 999)
    s = expansoes.sanear(bruto)
    caso("A1 chaves desconhecidas fora (lixo, nome, puuid na janela, texto na camada/filho)",
         "lixo" not in s and "nome" not in s and "puuid" not in s["janelaAntes"] and "motivoLongo" not in s
         and "texto" not in s["camadas"][0] and "texto" not in s["camadas"][0]["filhos"][0] and "extra" not in s["trilha"][0], json.dumps(s))
    caso("A2 Riot ID sai do texto; id esquisito vira ''; botão que não é texto sai",
         "Fulano#BR1" not in s["motivo"] and "…" in s["motivo"] and s["camadas"][0]["id"] == "" and s["camadas"][0]["botoes"] == ["ok"])
    caso("A3 tipos: fila/mapa números, porEle bool, monitor com 4 números",
         s["fila"] == 420 and s["mapa"] == 11 and s["porEle"] is False and s["janelaAntes"]["monitor"] == [0, 0, 1920, 1080])
    caso("A4 sem tipo/id válido = descartado", expansoes.sanear({"tipo": "x", "id": "a"}) is None
         and expansoes.sanear({"tipo": "inicio", "id": "a b"}) is None and expansoes.sanear("x") is None)
    caso("A5 texto cortado e sem quebra de linha (linha forjada no jsonl)",
         len(expansoes.sanear(evento(motivo="a\nb" * 500))["motivo"]) == 200 and "\n" not in expansoes.sanear(evento(motivo="a\nb"))["motivo"])

    # ---------- B. rota no servidor de teste ----------
    arq = tmp / "expansoes.jsonl"
    g = expansoes.Gravador(arq)
    coach = SimpleNamespace(srv=servidor_local.ServidorLocal(porta=PORTA, config=tmp / "cfg.json"))
    caso("B0 o coletor pendura /compacto/ no servidor do coach (sem servidor: nada)",
         coletor._registro_expansoes(coach) and "/compacto/" in coach.srv.rotas_post and not coletor._registro_expansoes(None))
    coach.srv.rotas_post["/compacto/"] = expansoes.rota_expansoes(g)   # a do teste grava no tmp
    if not coach.srv.iniciar():
        caso("B1 porta de teste 8798 livre", False)
        return 1
    try:
        def post(corpo, origem=None, rota="/compacto/expansoes"):
            dados = corpo if isinstance(corpo, bytes) else json.dumps(corpo).encode()
            req = urllib.request.Request(f"http://127.0.0.1:{PORTA}{rota}", data=dados, method="POST",
                                         headers={"Content-Type": "application/json", **({"Origin": origem} if origem else {})})
            try:
                with urllib.request.urlopen(req, timeout=5) as r:
                    return r.status
            except urllib.error.HTTPError as e:
                return e.code
        lote = {"eventos": [evento(origem="modal", fase="Lobby"), evento("fim", duracaoMs=5000, como="automático"),
                            {"tipo": "inicio"}], "descartados": 2}
        caso("B1 Pengu (https://plugins) e página do client (https://127.0.0.1:<LCU>) gravam",
             post(lote, "https://plugins") == 200 and post({"eventos": []}, "https://127.0.0.1:54321") == 200)
        caso("B2 página do próprio coletor (http://127.0.0.1:8798), outra local em http e site de fora: 403",
             post(lote, f"http://127.0.0.1:{PORTA}") == 403 and post(lote, "http://localhost:3000") == 403
             and post(lote, "https://exemplo.com") == 403)
        caso("B3 json inválido ou sem eventos -> 400; rota desconhecida -> 404",
             post(b"{nao", "https://plugins") == 400 and post({"x": 1}, "https://plugins") == 400
             and post({"eventos": []}, "https://plugins", "/compacto/outra") == 404)
        ls = linhas(arq)
        caso("B4 uma linha por evento válido (o torto fica fora) + a linha dos descartados, com recebido_em",
             [x["tipo"] for x in ls] == ["inicio", "fim", "descartados"] and all("recebido_em" in x for x in ls)
             and ls[2]["n"] == 2, json.dumps(ls))
        caso("B5 a regra de origem do /aceite/ continua igual", servidor_local.origem_aceite_ok("/aceite/plugin", "http://127.0.0.1:8765") is False
             and servidor_local.origem_aceite_ok("/compacto/expansoes", "https://plugins") is True
             and servidor_local.origem_aceite_ok("/estado", "http://127.0.0.1:8765") is True)
    finally:
        coach.srv.parar()
        g.fechar()

    # ---------- C. rotação ----------
    arq2 = tmp / "rot.jsonl"
    g2 = expansoes.Gravador(arq2, max_bytes=400, backups=2)
    for i in range(30):
        g2.gravar([expansoes.sanear(evento(i=f"r-{i}", motivo="m" * 50))])
    g2.fechar()
    tam = [p.stat().st_size for p in tmp.glob("rot.jsonl*")]
    caso("C1 rotação: arquivo + até 2 cópias, nenhum muito maior que o limite",
         len(tam) == 3 and max(tam) < 400 + 300, str(tam))
    eventos, _ = R.ler(arq2)
    caso("C2 relatório lê as rotações (o mais velho primeiro)", eventos and eventos[-1]["id"] == "r-29"
         and [e["id"] for e in eventos] == sorted([e["id"] for e in eventos], key=lambda x: int(x[2:])), str([e["id"] for e in eventos][:5]))

    # ---------- D. relatório ----------
    arq3 = tmp / "rel.jsonl"
    cam = [{"tag": "div", "classes": "modal lol-uikit-x", "filhos": [{"tag": "lol-uikit-dialog-frame"}], "titulo": "nova recompensa", "expande": "modal"}]
    evs = [evento(i="a", origem="modal", motivo="o client abriu uma janela própria (modal)", fase="Lobby", camadas=cam, porEle=False),
           evento("fim", "a", duracaoMs=4000, como="automático"),
           evento(i="b", origem="modal", motivo="o client abriu uma janela própria (modal)", fase="Lobby", camadas=cam, porEle=False),
           evento("fim", "b", duracaoMs=8000, como="automático"),
           evento(i="c", origem="fase", motivo="seleção fora do Summoner's Rift (ARAM e outros): tela da Riot", fase="ChampSelect", fila=450, porEle=False),
           evento(i="d", origem="por-ele", motivo="expandido por ti", fase="Lobby", porEle=True, gatilho="botão ⤢"),
           evento("fim", "d", duracaoMs=1000, como="por ele (botão ▣)"),
           {"tipo": "descartados", "id": "d-1", "n": 3}]
    arq3.write_text("\n".join(json.dumps(e, ensure_ascii=False) for e in evs) + "\n{torta\n", encoding="utf-8")
    eventos, tortas = R.ler(arq3)
    exps, desc = R.juntar(eventos)
    grupos = R.agrupar(exps)
    g_modal = next(x for x in grupos if x["origem"] == "modal")
    g_fase = next(x for x in grupos if x["origem"] == "fase")
    caso("D1 junta início e fim pelo id; conta descartados e linha torta", len(exps) == 4 and desc == 3 and tortas == 1)
    caso("D2 grupo da regra 7: 2x, mediana 6 s, máx 8 s, camada div.modal..., voltou automático 2x",
         g_modal["n"] == 2 and g_modal["medianaS"] == 6.0 and g_modal["maxS"] == 8.0 and g_modal["camada"].startswith("div.modal")
         and g_modal["como"] == {"automático": 2}, json.dumps(g_modal))
    caso("D3 expansão sem volta (client fechado) aparece como 'sem volta'; fila agrupada",
         g_fase["semVolta"] == 1 and g_fase["como"] == {"sem volta": 1} and g_fase["filas"] == {"450": 1}, json.dumps(g_fase))
    caso("D4 automáticas antes das pedidas por ele; o texto separa as duas seções",
         grupos[-1]["porEle"] and not grupos[0]["porEle"] and "AUTOMÁTICAS" in R.texto(grupos, desc, tortas, len(exps)))
    caso("D5 --desde filtra pelo dia do início", len(R.juntar(eventos, "2026-10-16")[0]) == 0 and len(R.juntar(eventos, "2026-10-15")[0]) == 4)
    # revisão adversarial 15/10: o plugin carimba em UTC; um evento de 01:30Z é da noite anterior na hora local (Brasília)
    from datetime import datetime, timezone
    local = R.hora_local("2026-10-16T01:30:00.000Z")
    esperado = datetime(2026, 10, 16, 1, 30, tzinfo=timezone.utc).astimezone().strftime("%Y-%m-%dT%H:%M:%S")
    noite = R.juntar([evento(i="n-1", em="2026-10-16T01:30:00.000Z")], "2026-10-16")[0]
    caso("D6 hora do relatório e --desde na hora local (UTC do plugin convertido)", local == esperado
         and (len(noite) == 1) == (esperado[:10] >= "2026-10-16") and R.hora_local("torto") == "torto", local)
    s = expansoes.sanear(evento(camadasCortadas=True))
    caso("D7 saneia camadasCortadas (bool: o plugin cortou as camadas de um evento grande demais)", s.get("camadasCortadas") is True,
         json.dumps(s, ensure_ascii=False))

    # ---------- etapa 3 de roadmap/2026-10-17-telas-que-expandem.md: registro honesto ----------
    # reconstrução das linhas 33–40 do dados/expansoes-compacto.jsonl (16/10/2026, UTC): expandido pelo botão às 23:48:14,477;
    # o compacto volta na seleção assistida às 23:48:19,458; 114 ms depois a tela da seleção pede o client normal com gesto de 771 ms
    # (o "Assistir" no client normal, ANTES da volta) -> o plugin antigo gravou "por-ele"; o relatório reclassifica
    real = [evento(i="mvbljp6u-3", em="2026-10-16T23:26:21.510Z", origem="por-ele", motivo="expandido por você", fase="Lobby", porEle=True,
                   gatilho="tela lobby", gestoHaMs=104),
            evento("fim", "mvbljp6u-3", em="2026-10-16T23:46:49.904Z", duracaoMs=1228394, como="automático", fase="None",
                   trilha=[{"aposMs": 1153293, "fase": "ChampSelect", "motivo": "seleção fora do Summoner's Rift (ARAM e outros): tela da Riot", "origem": "fase"},
                           {"aposMs": 1228206, "fase": "ChampSelect", "motivo": "seleção da fila desconhecida: tela da Riot", "origem": "fase"}]),
            evento(i="mvbmbua5-4", em="2026-10-16T23:48:14.477Z", origem="por-ele", motivo="expandido por você", fase="None", porEle=True, gatilho="botão ⤢"),
            evento("fim", "mvbmbua5-4", em="2026-10-16T23:48:19.458Z", duracaoMs=4981, como="automático", fase="ChampSelect"),
            evento(i="mvbmby7o-5", em="2026-10-16T23:48:19.572Z", origem="por-ele", motivo="expandido por você", fase="ChampSelect", porEle=True,
                   gatilho="tela champselect", gestoHaMs=771, fila=420, mapa=11,
                   aviso="esta seleção banco aram ou espectador é da tela da … abrindo o client normal"),
            evento("fim", "mvbmby7o-5", em="2026-10-16T23:48:23.672Z", duracaoMs=4101, como="automático", fase="None",
                   trilha=[{"aposMs": 4040, "fase": "ChampSelect", "motivo": "seleção da fila desconhecida: tela da Riot", "origem": "fase"}])]
    exps_r, _ = R.juntar(real)
    por_id = {e["id"]: e for e in exps_r}
    caso("D8 por-ele de tela com o clique antes de o compacto voltar vira tela-sozinha (reclassificado); clique dentro da tela segue por-ele",
         por_id["mvbmby7o-5"]["origem"] == "tela-sozinha" and por_id["mvbmby7o-5"]["porEle"] is False and por_id["mvbmby7o-5"].get("reclassificado")
         and por_id["mvbljp6u-3"]["origem"] == "por-ele" and por_id["mvbljp6u-3"]["porEle"] is True
         and por_id["mvbmbua5-4"]["origem"] == "por-ele", json.dumps(exps_r, ensure_ascii=False)[:600])
    g_r = R.agrupar(exps_r)
    t_r = R.agrupar_trilha(exps_r)
    txt = R.texto(g_r, 0, 0, len(exps_r), t_r)
    fora_sr = next((g for g in t_r if "Summoner" in g["motivo"]), None)
    desc_t = next((g for g in t_r if "desconhecida" in g["motivo"]), None)
    caso("D9 trilha: motivos que apareceram com o client normal à vista viram bloco próprio, com fase e de que expansão",
         fora_sr and fora_sr["n"] == 1 and fora_sr["fases"] == {"ChampSelect": 1} and fora_sr["dentro"] == {"pedidas por você": 1}
         and desc_t and desc_t["n"] == 2 and desc_t["dentro"] == {"pedidas por você": 1, "automáticas": 1}
         and "TAMBÉM APARECERAM" in txt and "reclassificada" in txt, json.dumps(t_r, ensure_ascii=False)[:600])
    s2 = expansoes.sanear(evento(origem="tela-sozinha", gestoHaMs=771, gestoAntesDaTela=True, gestoForaDaCamada=True))
    caso("D10 saneia gestoAntesDaTela e gestoForaDaCamada (bool)", s2.get("gestoAntesDaTela") is True and s2.get("gestoForaDaCamada") is True
         and expansoes.sanear(evento(gestoAntesDaTela="sim")).get("gestoAntesDaTela") is None, json.dumps(s2, ensure_ascii=False))

    k = sum(resultados)
    print(f"\n{'ok' if k == len(resultados) else 'FALHOU'} ({k}/{len(resultados)})")
    return 0 if k == len(resultados) else 1


if __name__ == "__main__":
    sys.exit(main())
