# prova do passo 15d (plano v2): inteligência de selva inimiga sem o farm do inimigo (congela na fog).
#   python tools/teste-selva.py
# Cenário 1 (correção do passo 9 + patch 26.01): visto no vermelho inimigo aos 1:35, sem avistamento
# até 3:00 -> início no vermelho, campos limpos estimados pelo tempo na ordem da rota, nível 3
# previsto entre 2:00 e 3:15 (campos nascem 0:55/1:07 desde o 26.01; o plano dizia 3:00–3:30 com os
# horários antigos). Cenário 2: HordeKill dele aos 8:50 -> posição e campos do lado das vastilarvas.
# Conferência com a partida real (timeline 3292746609): nível 3 do Zac (ORDER) em 123,9 s pela
# Live Client e do Ekko (CHAOS) entre 120 e 180 s pela timeline.
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import selva as sv  # noqa: E402


def principal():
    res = []

    def caso(nome, ok, detalhe):
        res.append(ok)
        print(f"{'ok' if ok else 'FALHOU'}  {nome}: {detalhe}")

    # 1) visto no vermelho do CHAOS aos 1:35, nada até 3:00
    s = sv.EstadoSelva("CHAOS", {"Ekko"})
    s.avistamento(95, *sv.CAMPOS["CHAOS"]["vermelho"])
    e = s.estado(180)
    limpos = [c for c, _ in sorted(((c, v["limpo_em"]) for c, v in e["campos"].items() if v["status"] == "limpo"),
                                   key=lambda x: x[1])]
    n3 = e["nivel3"]
    centro = (n3[0] + n3[1]) / 2 if n3 else None
    caso("início e campos pelo tempo",
         e["lado_inicio"] == "vermelho" and limpos[:3] == ["vermelho", "krugs", "aves"] and n3 is not None
         and 120 <= n3[0] and n3[1] <= 195 and 120 <= centro <= 195,
         f"início {e['lado_inicio']} ({e['metade_inicio']}, {e['confianca_lado']}); limpos às 3:00 {limpos}; "
         f"nível 3 entre {sv.mmss(n3[0])} e {sv.mmss(n3[1])}; rota {e['rota']}")

    # 2) HordeKill dele aos 8:50 (530 s): posição no covil (rio top) e campos do lado top dele
    s = sv.EstadoSelva("CHAOS", {"Ekko"})
    s.evento({"EventID": 40, "EventName": "HordeKill", "EventTime": 530.4, "KillerName": "Ekko"})
    s.evento({"EventID": 40, "EventName": "HordeKill", "EventTime": 530.4, "KillerName": "Ekko"})  # repetido
    s.evento({"EventID": 41, "EventName": "DragonKill", "EventTime": 507.9, "KillerName": "Zac"})  # não é dele
    e = s.estado(545)
    uo = e.get("ultimo_objetivo") or {}
    caso("vastilarvas dele aos 8:50",
         uo.get("objetivo") == "vastilarvas" and (uo.get("x"), uo.get("y")) == (5007, 10471) and uo.get("metade") == "top"
         and sorted(e.get("campos_proximos", [])) == ["aves", "krugs", "vermelho"]
         and any("campos bot dele livres" in p for p in e["previsoes"]),
         f"{uo} | próximos {e.get('campos_proximos')} | {e['previsoes']}")
    print(f"{sum(res)}/{len(res)} ok")

    # extras: modelo contra a partida real (início pela posição aos 1:00 da timeline)
    z = sv.EstadoSelva("ORDER")
    z.avistamento(60, 6901, 5406)          # Zac aos 1:00 (timeline): aves do ORDER
    ez = z.estado(130)
    k = sv.EstadoSelva("CHAOS")
    k.avistamento(60, 7280, 11429)         # Ekko aos 1:00 (timeline): vermelho do CHAOS
    ek = k.estado(130)
    ok_z = ez["nivel3"][0] <= 123.9 <= ez["nivel3"][1]
    ok_k = ek["nivel3"][0] < 180 and ek["nivel3"][1] > 120   # real: nível 2 aos 2:00, nível 3 aos 3:00
    caranguejo = sv.EstadoSelva("CHAOS").estado(150)["previsoes"]
    ok_c = any("caranguejo do rio nasce em 25 s" in p for p in caranguejo)
    print(f"extras: Zac real nível 3 em 2:04 -> previsto {sv.mmss(ez['nivel3'][0])}–{sv.mmss(ez['nivel3'][1])} "
          f"({'ok' if ok_z else 'X'}); Ekko real entre 2:00 e 3:00 -> previsto {sv.mmss(ek['nivel3'][0])}–"
          f"{sv.mmss(ek['nivel3'][1])} ({'ok' if ok_k else 'X'}); aos 2:30 {caranguejo} ({'ok' if ok_c else 'X'})")
    return 0 if all(res) and ok_z and ok_k and ok_c else 1


if __name__ == "__main__":
    sys.exit(principal())
