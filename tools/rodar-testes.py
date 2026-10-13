# roda todas as provas offline do projeto em sequência e resume (rc e última linha de cada uma).
#   python tools/rodar-testes.py [--log temp/testes.log] [filtro...]
# Nada aqui chama o Claude, a Riot API de verdade ou o client: teste-mentor vai em --seco/--offline,
# teste-mcp no banco de teste que o teste-champselect cria em temp/. A ordem importa: teste-licoes.py
# grava temp/licoes/ antes do .mjs; teste-champselect cria o banco do teste-mcp.
import subprocess
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PY, NODE = sys.executable, "node"
TESTES = [
    [PY, "tools/teste-analise.py"],
    ["node", "tools/teste-posjogo.mjs"],
    [PY, "tools/teste-champselect.py"],
    [PY, "tools/teste-mcp.py", "temp/teste-champselect.db"],
    [PY, "tools/validar-licoes.py"],
    [PY, "tools/teste-licoes.py"],
    ["node", "tools/teste-licoes.mjs"],
    ["node", "tools/teste-abas.mjs"],
    ["node", "tools/teste-winrate.mjs"],
    ["node", "tools/teste-matchup.mjs"],
    ["node", "tools/teste-aceite.mjs"],
    ["node", "tools/teste-runas.mjs"],
    [PY, "tools/teste-coach.py"],
    [PY, "tools/teste-alertas.py"],
    [PY, "tools/teste-minimapa.py"],
    [PY, "tools/teste-jungler.py"],
    [PY, "tools/teste-alcance.py"],
    [PY, "tools/teste-selva.py"],
    [PY, "tools/teste-feiticos.py"],
    [PY, "tools/teste-ocr-chat.py"],
    [PY, "tools/teste-sugestoes.py"],
    [PY, "tools/teste-tags.py"],
    [PY, "tools/teste-traumas.py"],
    [PY, "tools/teste-draft.py"],
    [PY, "tools/teste-mentor.py", "--seco"],
    [PY, "tools/teste-mentor.py", "--offline"],
    # ponta a ponta (coletor + coach + simulador tocando a partida gravada a 20x, ~2 min; portas 8766/2996)
    [PY, "tools/ensaio-coach.py", "--sem-prints", "--seg-1x", "5", "--velocidade", "20"],
]
# rc diferente de 0 que não é falha: teste-ocr-chat dá 2 com a régua ok e amostra < 10 prints com ping
RC_OK = {"tools/teste-ocr-chat.py": (0, 2)}


def principal():
    args = sys.argv[1:]
    log = None
    if "--log" in args:
        i = args.index("--log")
        log = RAIZ / args[i + 1]
        del args[i:i + 2]
    filtros = args
    sys.stdout.reconfigure(encoding="utf-8")
    saida = []
    falhas = 0
    for cmd in TESTES:
        nome = " ".join(cmd[1:])
        if filtros and not any(f in nome for f in filtros):
            continue
        t0 = time.time()
        r = subprocess.run(cmd, cwd=RAIZ, capture_output=True, text=True, encoding="utf-8", errors="replace",
                           env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"})
        dt = time.time() - t0
        texto = (r.stdout or "") + (r.stderr or "")
        ultima = next((ln for ln in reversed(texto.strip().splitlines()) if ln.strip()), "")
        ok = r.returncode in RC_OK.get(cmd[1], (0,))
        falhas += not ok
        linha = f"{'ok    ' if ok else 'FALHOU'} rc={r.returncode} {dt:5.1f}s  {nome}  | {ultima[:150]}"
        print(linha, flush=True)
        saida.append(f"===== {nome} (rc {r.returncode}, {dt:.1f} s)\n{texto}\n")
    print(f"{len(saida) - falhas}/{len(saida)} ok")
    if log:
        log.parent.mkdir(parents=True, exist_ok=True)
        log.write_text("".join(saida), encoding="utf-8")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(principal())
