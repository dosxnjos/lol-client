# prova do passo 3 (plano v2): sobe mcp/servidor.py por stdio (como o Claude Code faz) e chama as
# ferramentas novas. uso: python tools/teste-mcp.py [banco de teste com champ_select, ex. temp/teste-champselect.db]
# (o banco de teste nasce do python tools/teste-champselect.py)
import asyncio
import json
import os
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

sys.stdout.reconfigure(encoding="utf-8")
RAIZ = Path(__file__).resolve().parent.parent
SERV = str(RAIZ / "mcp" / "servidor.py")


async def chamar(env, *chamadas):
    params = StdioServerParameters(command=sys.executable, args=[SERV], env={**os.environ, **env})
    async with stdio_client(params) as (r, w):
        async with ClientSession(r, w) as s:
            await s.initialize()
            nomes = [t.name for t in (await s.list_tools()).tools]
            out = []
            for nome, args in chamadas:
                res = await s.call_tool(nome, args)
                txt = "".join(getattr(x, "text", "") for x in res.content)
                out.append((nome, res.isError, json.loads(txt) if txt.strip().startswith(("{", "[")) else txt))
            return nomes, out


async def principal():
    falhas = []
    nomes, out = await chamar({}, ("matchups", {"campeao": "Renekton", "min_partidas": 3}),
                              ("champ_select", {"limite": 5}), ("sessao_hoje", {}))
    print("ferramentas:", ", ".join(nomes))
    for n in ("matchups", "champ_select", "sessao_hoje"):
        if n not in nomes:
            falhas.append(f"ferramenta {n} ausente")
    (_, erro, m), (_, erro2, cs), (_, erro3, sh) = out
    if erro or not isinstance(m, dict) or not m.get("matchups"):
        falhas.append(f"matchups: erro ou vazio: {str(m)[:200]}")
    else:
        top = m["matchups"][0]
        faltam = [k for k in ("n", "winrate", "ouro10") if k not in top]
        if faltam:
            falhas.append(f"matchups: campos ausentes {faltam}")
        soma = sum(x["n"] for x in m["matchups"]) + sum(int(p.split("n=")[1].split(",")[0]) for p in m["pouca_amostra"])
        print(f"matchups(Renekton): {len(m['matchups'])} com n>=3, {len(m['pouca_amostra'])} com pouca amostra, "
              f"partidas {m['partidas']}, fora {m['fora']}, soma n {soma}")
        print("  1º:", json.dumps(top, ensure_ascii=False))
        print("  bytes:", len(json.dumps(m, ensure_ascii=False)))
    print("champ_select (banco real):", "erro" if erro2 else json.dumps(cs, ensure_ascii=False)[:200])
    if erro2:
        falhas.append(f"champ_select no banco real: {cs}")
    print("sessao_hoje:", "erro" if erro3 else json.dumps(sh, ensure_ascii=False)[:400])
    if erro3 or "vitorias" not in sh:
        falhas.append(f"sessao_hoje: {str(sh)[:200]}")
    if len(sys.argv) > 1:  # champ_select com retratos, no banco de teste
        _, out = await chamar({"LOL_CLIENT_DB": sys.argv[1]}, ("champ_select", {"limite": 5}))
        _, erro4, cs = out[0]
        print("champ_select (banco de teste):", json.dumps(cs, ensure_ascii=False)[:500])
        if erro4 or not cs.get("selecoes") or "autofill" not in cs["selecoes"][0]:
            falhas.append(f"champ_select no banco de teste: {str(cs)[:200]}")
    print("\n".join(falhas) if falhas else "ok")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(principal()))
