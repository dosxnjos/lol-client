# prova do passo 5 (plano v2): parse do pengu/posjogo/licoes.md + toda métrica citada existe na spec
# (docs/INSIGHTS.md § Métricas das lições) e no coletor/coach.py. Também confere o formatador com os
# casos de arredondamento que o node repete em tools/teste-licoes.mjs.
# uso: python tools/validar-licoes.py [licoes.md]
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import coach  # noqa: E402

# (valor, formato, esperado): mesmos casos em tools/teste-licoes.mjs
CASOS_FORMATO = [
    (0.25, "", "0,3"), (-0.25, "", "−0,2"), (2.5, "", "2,5"), (2.5, "int", "3"), (-2.5, "int", "−2"),
    (171, "+", "+171"), (-368, "+", "−368"), (-368, "abs", "368"), (0, "+", "0"), (0.04, "+", "0,0"),
    (7.886, "", "7,9"), (0.4424, "+", "+0,4"), (47.6, "pct", "48%"), (289069, "mmss", "04:49"),
    (1.2597, "", "1,3"), (-83.333, "+int", "−83"), ("Zac", "", "Zac"), (33.3667, "int", "33"),
    (-61000, "mmss", "−01:01"), (-0.25, "mmss", "00:00"),
]


def spec_metricas(texto):
    """{nome: (tipo, fonte)} da tabela de docs/INSIGHTS.md § Métricas das lições"""
    out, dentro = {}, False
    for linha in texto.splitlines():
        if linha.startswith("### "):
            dentro = linha[4:].strip().lower() == "métricas das lições"
            continue
        if not dentro or not linha.startswith("| `"):
            continue
        cols = [c.strip() for c in linha.strip().strip("|").split("|")]
        for nome in re.findall(r"`([a-z0-9_]+)`", cols[0]):
            out[nome] = (cols[1], cols[2])
    return out


falhas = []
arq = Path(sys.argv[1]) if len(sys.argv) > 1 else coach.ARQ_REGRAS
try:
    regras = coach.carregar_regras(arq.read_text(encoding="utf-8"))
except Exception as e:  # noqa: BLE001
    print(f"FALHOU: parse de {arq}: {e}")
    sys.exit(1)
spec = spec_metricas((RAIZ / "docs" / "INSIGHTS.md").read_text(encoding="utf-8"))
if not spec:
    falhas.append("tabela § Métricas das lições não encontrada em docs/INSIGHTS.md")
impl = {k: v for k, v in coach.METRICAS.items()}
for nome in sorted(set(spec) ^ set(impl)):
    falhas.append(f"métrica {nome}: {'só na spec' if nome in spec else 'só no coach.py'}")
for nome in sorted(set(spec) & set(impl)):
    if spec[nome] != impl[nome]:
        falhas.append(f"métrica {nome}: spec {spec[nome]} x coach.py {impl[nome]}")

if not regras:
    falhas.append("nenhuma regra (blocos ### dentro de ## Regras…)")
vistos = set()
for r in regras:
    rid = r["id"]
    if rid in vistos:
        falhas.append(f"{rid}: id repetido")
    vistos.add(rid)
    for k in ("quando", "prioridade", "tipo", "texto"):
        if r.get(k) in (None, ""):
            falhas.append(f"{rid}: sem {k}")
    if r.get("tipo") not in coach.TIPOS:
        falhas.append(f"{rid}: tipo {r.get('tipo')!r} (use {' ou '.join(coach.TIPOS)})")
    try:
        arv = coach.compilar(r.get("quando") or "")
        for nome in sorted(coach.nomes_da_expressao(arv)):
            if nome not in spec:
                falhas.append(f"{rid}: métrica inexistente no quando: {nome}")
            elif spec[nome][0] != "número" and not re.search(rf"existe\(\s*{nome}\s*\)", r["quando"]):
                falhas.append(f"{rid}: métrica de texto em conta/comparação: {nome}")
    except ValueError as e:
        falhas.append(f"{rid}: quando não compila: {e}")
    for nome, fmt in coach.placeholders(r.get("texto")):
        if nome not in spec:
            falhas.append(f"{rid}: métrica inexistente no texto: {{{nome}}}")
        if (fmt[1:] if fmt.startswith("+") else fmt) not in coach.FORMATOS:
            falhas.append(f"{rid}: formato desconhecido {{{nome}:{fmt}}}")
    if "{" in re.sub(r"\{[a-z0-9_]+(?::[+a-z]+)?\}", "", r.get("texto") or ""):
        falhas.append(f"{rid}: chave solta no texto")
positivas = sum(r.get("tipo") == "positiva" for r in regras)
if positivas < 3:
    falhas.append(f"só {positivas} regras positivas (mínimo 3)")

for v, fmt, esp in CASOS_FORMATO:
    obt = coach.formatar(v, fmt)
    if obt != esp:
        falhas.append(f"formatar({v!r}, {fmt!r}) = {obt!r}, esperado {esp!r}")

# cada regra avaliada com todas as métricas nulas: não pode disparar nem quebrar
nulas = {k: None for k in spec}
for r in regras:
    try:
        if coach.avaliar_expr(coach.compilar(r["quando"]), nulas) is True:
            falhas.append(f"{r['id']}: dispara sem dado nenhum")
    except (KeyError, ValueError):
        pass  # já acusado acima

if falhas:
    print("\n".join(f"FALHOU: {f}" for f in falhas))
    sys.exit(1)
print(f"ok ({len(regras)} regras, {positivas} positivas, {len(spec)} métricas na spec, "
      f"{len(CASOS_FORMATO)} casos de formato)")
