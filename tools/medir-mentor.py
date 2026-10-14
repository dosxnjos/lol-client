# medição antes/depois do mentor do pós-jogo (roadmap/2026-10-14-posjogo-livre-e-mentor-enxuto.md, passo 3)
#   antes  = a última resposta pronta do pós-jogo guardada na tabela `mentor` do banco real (prompt antigo)
#   depois = uma chamada real do `claude -p` com o prompt de agora (mentor.prompt_posjogo + mentor.chamar)
# Conta palavras, frases de ausência ("não tenho dado…") e números da resposta que não aparecem no bloco DADOS
# (bandeira para a conferência manual, não veredito: "10" de "aos 10 minutos" aparece sempre).
# O banco real só é lido (abrir_leitura); a saída vai para temp/mentor-medicao/<data>/ (json por partida + medicao.md).
#   python tools/medir-mentor.py [gameId ...] [--seco] [--refazer]
#     --seco     só o "antes" (não chama o Claude)
#     --refazer  chama de novo mesmo com o json do "depois" já salvo
import argparse
import json
import re
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import banco  # noqa: E402
import mentor  # noqa: E402

PADRAO = [3292913427, 3293084144, 3293092537]
AUSENCIA = re.compile(r"\bnão (?:tenho|temos|há|sei|dá para saber)\b|\bsem (?:o |esse )?dado|\bfalta(?:m)? (?:o )?dado",
                      re.I)
NUMERO = re.compile(r"\d{1,2}:\d{2}|[−+-]?\d+(?:[.,]\d+)?(?:/\d+/\d+)?")


def palavras(t):
    return len(re.sub(r"\*\*", "", t or "").split())


def ausencias(t):
    """frases (não ocorrências) que falam de dado ausente"""
    frases = re.split(r"(?<=[.!?])\s+|\n+", re.sub(r"\*\*", "", t or ""))
    return [f.strip() for f in frases if AUSENCIA.search(f)]


def veredito(t):
    m = re.search(r"^\s*(?:\*\*)?Veredito:?(?:\*\*)?:?\s*(.+?)(?=\n\s*\n|\n\s*(?:\*\*)?(?:O essencial|Lições|Próxima)|\Z)",
                  t or "", re.S | re.M)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else None


def dados_do(prompt):
    i, f = prompt.find("DADOS\n"), prompt.find("FIM DOS DADOS")
    return prompt[i:f] if i >= 0 and f > i else prompt


def numeros_fora(resposta, prompt):
    """números da resposta que não estão no DADOS (vírgula e ponto valem igual; sinal ignorado)"""
    base = dados_do(prompt)
    base_n = base.replace(",", ".").replace("−", "-")
    fora = []
    for n in NUMERO.findall(resposta or ""):
        cru = n.replace("−", "").replace("+", "").lstrip("-")
        alvo = cru.replace(",", ".")
        if alvo in base_n or cru in base:
            continue
        fora.append(n)
    return sorted(set(fora), key=lambda x: (len(x), x))


def antes(c, gid):
    r = c.execute("select prompt, resposta, duracao_ms, custo_usd from mentor where game_id=? and uso='posjogo' "
                  "and status='pronto' order by id desc limit 1", (gid,)).fetchone()
    return None if not r else {"prompt": r[0], "resposta": r[1], "duracao_ms": r[2], "custo_usd": r[3]}


def depois(c, gid, pasta, refazer):
    arq = pasta / f"{gid}.json"
    if arq.exists() and not refazer:
        return json.loads(arq.read_text(encoding="utf-8"))
    prompt = mentor.prompt_posjogo(c, gid)
    r = mentor.chamar(prompt)
    out = {"game_id": gid, "ts": int(time.time()), "modelo": mentor.MODELO_PADRAO, "effort": mentor.EFFORT_PADRAO,
           "prompt": prompt, "resposta": r["texto"], "erro": r["erro"], "duracao_ms": r["duracao_ms"],
           "custo_usd": r["custo_usd"], "modelo_usado": r["modelo_usado"]}
    arq.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    return out


def linha(tag, x):
    if not x or not x.get("resposta"):
        return f"| {tag} | – | – | – | – | {x and x.get('erro') or 'sem resposta'} |"
    aus = ausencias(x["resposta"])
    fora = numeros_fora(x["resposta"], x["prompt"])
    seg = f"{x['duracao_ms'] / 1000:.1f}" if x.get("duracao_ms") else "–"
    return (f"| {tag} | {palavras(x['resposta'])} | {len(aus)} | {', '.join(fora) or '—'} | {seg} | "
            f"{'; '.join(aus) or '—'} |")


def main():
    ap = argparse.ArgumentParser(description="mede o mentor do pós-jogo antes/depois do prompt novo")
    ap.add_argument("games", type=int, nargs="*")
    ap.add_argument("--db", default=str(banco.DB_PADRAO))
    ap.add_argument("--seco", action="store_true")
    ap.add_argument("--refazer", action="store_true")
    ap.add_argument("--pasta", default=str(RAIZ / "temp" / "mentor-medicao" / time.strftime("%Y-%m-%d")))
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    pasta = Path(a.pasta)
    pasta.mkdir(parents=True, exist_ok=True)
    c = banco.abrir_leitura(a.db)
    md = ["| partida | palavras | frases de ausência | números fora do DADOS | s | frases |",
          "| --- | --- | --- | --- | --- | --- |"]
    vereditos = []
    for gid in a.games or PADRAO:
        x = antes(c, gid)
        md.append(linha(f"{gid} antes", x))
        if not a.seco:
            y = depois(c, gid, pasta, a.refazer)
            md.append(linha(f"{gid} depois", y))
            vereditos.append((gid, veredito(x and x["resposta"]), veredito(y.get("resposta"))))
    c.close()
    texto = "\n".join(md)
    if vereditos:
        texto += "\n\nVereditos (antes → depois):\n" + "\n".join(f"- {g}: {a_ or '—'}\n  → {d or '—'}" for g, a_, d in vereditos)
    (pasta / "medicao.md").write_text(texto + "\n", encoding="utf-8")
    print(texto)
    print(f"\nsaída: {pasta}")


if __name__ == "__main__":
    main()
