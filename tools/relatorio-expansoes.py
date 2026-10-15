"""Relatório das expansões do client compacto (plano do compacto, passo 15; pedido do Gabriel de 15/10/2026: "pra gente
tentar depois transformar o que faz sentido em tela do modo compacto também").

Lê dados/expansoes-compacto.jsonl (e as rotações .1 .. .3), junta o "inicio" e o "fim" de cada expansão pelo id e agrupa
por origem, motivo e camada da Riot: quantas vezes, quanto tempo ficou expandido (mediana e máximo), como voltou, em que
fases e 3 exemplos. Primeiro as automáticas (as candidatas a tela compacta), depois as pedidas por ele.

    python tools/relatorio-expansoes.py                    tudo
    python tools/relatorio-expansoes.py --desde 2026-10-15 a partir desse dia
    python tools/relatorio-expansoes.py --json             os grupos em JSON (para outra ferramenta)
    python tools/relatorio-expansoes.py --arquivo <jsonl>  outro arquivo (teste)

Só lê. Os eventos já chegam sem nome de jogador nem Riot ID (pengu/compacto/expansoes.js e coletor/expansoes.py).
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ARQUIVO = RAIZ / "dados" / "expansoes-compacto.jsonl"


def ler(arquivo=ARQUIVO):
    """eventos de todos os arquivos (o mais velho primeiro); linha torta é pulada e contada"""
    arquivo = Path(arquivo)
    caminhos = [arquivo.with_name(f"{arquivo.name}.{i}") for i in (3, 2, 1)] + [arquivo]
    eventos, tortas = [], 0
    for c in caminhos:
        try:
            linhas = c.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for linha in linhas:
            if not linha.strip():
                continue
            try:
                ev = json.loads(linha)
            except ValueError:
                tortas += 1
                continue
            if isinstance(ev, dict):
                eventos.append(ev)
    return eventos, tortas


def hora_local(em):
    """o plugin carimba em UTC (toISOString, "...Z"); o relatório e o --desde usam a hora local (Brasília: um evento das
    22h não pode cair no dia seguinte). Texto que não é ISO volta como veio"""
    s = str(em or "")
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone().strftime("%Y-%m-%dT%H:%M:%S")
    except ValueError:
        return s


def juntar(eventos, desde=None):
    """-> [expansão] (o "inicio" com fim, duracaoMs, como e trilha do "fim" de mesmo id) e o total descartado no plugin"""
    inicios, fins, descartados = {}, {}, 0
    for ev in eventos:
        t, i = ev.get("tipo"), ev.get("id")
        if t == "descartados":
            descartados += int(ev.get("n") or 0)
        elif t == "inicio" and i:
            inicios.setdefault(i, {**ev, "em": hora_local(ev.get("em")) if ev.get("em") else ev.get("em")})
        elif t == "fim" and i:
            fins[i] = ev
    out = []
    for i, ev in inicios.items():
        quando = str(ev.get("em") or ev.get("recebido_em") or "")
        if desde and quando[:10] < desde:
            continue
        f = fins.get(i)
        out.append({**ev, "fim": f is not None, "duracaoMs": (f or {}).get("duracaoMs"), "como": (f or {}).get("como"),
                    "faseVolta": (f or {}).get("fase"), "trilha": (f or {}).get("trilha") or []})
    return sorted(out, key=lambda e: str(e.get("em") or "")), descartados


def assinatura_camada(e):
    """a camada da Riot que explica a expansão: a da regra 7 (gatilhoCamada) ou a 1ª à vista que expande"""
    cs = [c for c in (e.get("camadas") or []) if isinstance(c, dict)]
    alvo = next((c for c in cs if c.get("expande")), None) or (cs[0] if cs and e.get("origem") == "modal" else None)
    if not alvo:
        return ""
    classes = " ".join(str(alvo.get("classes") or "").split()[:3])
    filho = (alvo.get("filhos") or [{}])[0] if alvo.get("filhos") else {}
    return f"{alvo.get('tag', '')}.{classes.replace(' ', '.')}" + (f" > {filho.get('tag', '')}" if filho.get("tag") else "")


def motivo_curto(m):
    """motivo sem o que varia à toa (mensagem de erro, número de fila vai no grupo da fila)"""
    m = str(m or "")
    m = re.sub(r"erro na tela compacta \(.*\)", "erro na tela compacta (…)", m)
    return m


def agrupar(expansoes):
    grupos = {}
    for e in expansoes:
        chave = (bool(e.get("porEle")), e.get("origem") or "?", motivo_curto(e.get("motivo")), assinatura_camada(e))
        grupos.setdefault(chave, []).append(e)
    out = []
    for (por_ele, origem, motivo, camada), es in grupos.items():
        durs = [e["duracaoMs"] for e in es if isinstance(e.get("duracaoMs"), (int, float))]
        out.append({
            "porEle": por_ele, "origem": origem, "motivo": motivo, "camada": camada, "n": len(es),
            "semVolta": sum(1 for e in es if not e["fim"]),
            "medianaS": round(statistics.median(durs) / 1000, 1) if durs else None,
            "maxS": round(max(durs) / 1000, 1) if durs else None,
            "fases": dict(Counter(e.get("fase") or "?" for e in es).most_common()),
            "etapas": dict(Counter(e["seq"] for e in es if e.get("seq")).most_common()),
            "filas": dict(Counter(str(e["fila"]) for e in es if e.get("fila") is not None).most_common()),
            "como": dict(Counter(e.get("como") or "sem volta" for e in es).most_common()),
            "exemplos": [{k: e.get(k) for k in ("em", "fase", "seq", "fila", "mapa", "gatilho", "aviso", "telaAntes")
                          if e.get(k) not in (None, "")}
                         | ({"camada": next((c for c in e.get("camadas") or [] if c.get("expande")), (e.get("camadas") or [None])[0])}
                            if e.get("camadas") else {})
                         for e in es[-3:]],
        })
    return sorted(out, key=lambda g: (g["porEle"], -g["n"], g["origem"]))


def texto(grupos, descartados=0, tortas=0, total=0):
    linhas = [f"{total} expansão(ões) do compacto em {len(grupos)} grupo(s)"
              + (f"; {descartados} evento(s) descartado(s) no plugin (fila cheia sem coletor)" if descartados else "")
              + (f"; {tortas} linha(s) ilegível(is)" if tortas else "")]
    for titulo, por_ele in (("AUTOMÁTICAS (candidatas a tela compacta)", False), ("PEDIDAS POR ELE", True)):
        gs = [g for g in grupos if g["porEle"] == por_ele]
        linhas.append(f"\n== {titulo}: {sum(g['n'] for g in gs)}")
        for g in gs:
            dur = f"mediana {g['medianaS']} s, máx {g['maxS']} s" if g["medianaS"] is not None else "sem duração"
            linhas.append(f"- {g['n']}x [{g['origem']}] {g['motivo']}" + (f"  · camada {g['camada']}" if g["camada"] else ""))
            linhas.append(f"    {dur}; sem volta {g['semVolta']}; fases {g['fases']}"
                          + (f"; etapas {g['etapas']}" if g["etapas"] else "") + (f"; filas {g['filas']}" if g["filas"] else ""))
            linhas.append(f"    voltou: {g['como']}")
            for ex in g["exemplos"]:
                cam = ex.pop("camada", None)
                linhas.append(f"    ex.: {json.dumps(ex, ensure_ascii=False)}"
                              + (f" camada {json.dumps({k: cam.get(k) for k in ('tag', 'classes', 'titulo', 'botoes') if cam.get(k)}, ensure_ascii=False)}" if cam else ""))
    return "\n".join(linhas)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="agrupa as expansões do client compacto")
    ap.add_argument("--arquivo", default=str(ARQUIVO))
    ap.add_argument("--desde", help="AAAA-MM-DD")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    eventos, tortas = ler(a.arquivo)
    expansoes, descartados = juntar(eventos, a.desde)
    grupos = agrupar(expansoes)
    if a.json:
        print(json.dumps({"total": len(expansoes), "descartados": descartados, "tortas": tortas, "grupos": grupos},
                         ensure_ascii=False, indent=1))
    elif not eventos:
        print(f"nenhuma expansão registrada ainda ({a.arquivo}): o coletor grava depois de reiniciado com a rota "
              f"/compacto/expansoes; ao vivo: window.__lolClient.compacto.expansoes() pelo tools/cdp.mjs eval")
    else:
        print(texto(grupos, descartados, tortas, len(expansoes)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
