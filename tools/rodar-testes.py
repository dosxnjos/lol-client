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
    [PY, "tools/teste-banco.py"],          # banco sem senha/token da sala do chat (eog), em pasta temporária
    [PY, "tools/validar-licoes.py"],
    [PY, "tools/teste-licoes.py"],
    ["node", "tools/teste-licoes.mjs"],
    ["node", "tools/teste-abas.mjs"],
    ["node", "tools/teste-winrate.mjs"],
    ["node", "tools/teste-matchup.mjs"],
    ["node", "tools/teste-aceite.mjs"],
    ["node", "tools/teste-config.mjs"],
    ["node", "tools/teste-ponte.mjs"],    # ponte com o complemento coach: chave, aperto de mão, recuo, recursos (19/10/2026)
    ["node", "tools/teste-historico.mjs"],   # acumulador do histórico no DataStore: formato, teto, backfill, importação, privacidade (19/10/2026)
    [PY, "tools/teste-contexto.py"],      # contexto do pós-jogo do coletor sobre a fixture do acumulador = contexto-esperado.json (19/10/2026)
    ["node", "tools/teste-contexto.mjs"],   # pengu/posjogo/contexto.js = Python ao vivo e = esperado; freios e selo locais (19/10/2026)
    ["node", "tools/teste-sem-popups.mjs"],
    ["node", "tools/teste-chat-posjogo.mjs"],
    ["node", "tools/teste-recompensas.mjs"],
    ["node", "tools/teste-jogar-de-novo.mjs"],
    ["node", "tools/teste-runas.mjs"],
    ["node", "tools/teste-compacto.mjs"],
    ["node", "tools/teste-compacto-lobby.mjs"],
    ["node", "tools/teste-compacto-selecao.mjs"],
    ["node", "tools/teste-compacto-posjogo.mjs"],
    ["node", "tools/teste-replay.mjs"],   # baixar/assistir replay no pós-jogo (pengu/replay.js, 15/10/2026)
    ["node", "tools/teste-compacto-fim-de-partida.mjs"],
    ["node", "tools/teste-compacto-lateral.mjs"],
    ["node", "tools/teste-compacto-amigos.mjs"],   # grupos, menu do clique direito e arrastar para convidar (16/10/2026)
    ["node", "tools/teste-compacto-perfil.mjs"],   # perfil de amigo, editor do meu perfil e fundo da coluna (16/10/2026)
    ["node", "tools/teste-compacto-som.mjs"],   # seção Som da ⚙ do compacto: corpos do lol-audio da Riot, isTrusted, debounce (16/10/2026)
    ["node", "tools/teste-compacto-jogo.mjs"],   # partida em andamento (passo 14)
    ["node", "tools/teste-compacto-expansoes.mjs"],   # registro das saídas do compacto (passo 15)
    ["node", "tools/teste-textos.mjs"],   # tom dos textos da interface (docs/TEXTOS-DA-INTERFACE.md, 15/10/2026)
    ["node", "tools/teste-icones.mjs"],   # ícones Lucide embutidos (pengu/icones.js) e nenhum emoji como ícone (17/10/2026)
    [PY, "tools/teste-expansoes.py"],      # rota /compacto/expansoes (porta 8798), jsonl com rotação e relatório
    [PY, "tools/teste-resumos.py"],        # rota GET /resumos (porta 0): mesmo formato e mesma linha do plugin, privacidade (19/10/2026)
    [PY, "tools/teste-medir-compacto.py"],
    [PY, "tools/teste-coach.py"],
    [PY, "tools/teste-assistida.py"],      # partida assistida (espectador): nada de coach, voz, painel, medidor nem gravação (17/10/2026)
    [PY, "tools/teste-pacote-voz.py"],
    [PY, "tools/teste-alertas.py"],
    ["node", "tools/teste-painel.mjs"],    # painel da 2ª tela em DOM falso (inimigo morto: "morto, volta em N s")
    [PY, "tools/teste-vitrine.py"],
    [PY, "tools/teste-aviso-partida.py"],
    [PY, "tools/teste-varrer-publico.py"],   # varredura da foto pública: gameId, nome em literal, credencial (19/10/2026)
    [PY, "tools/teste-minimapa.py"],
    [PY, "tools/teste-jungler.py"],
    [PY, "tools/teste-alcance.py"],
    [PY, "tools/teste-overlay.py"],        # desenho do overlay sem janela (a janela: overlay_minimapa.py --demo)
    [PY, "tools/teste-selva.py"],
    [PY, "tools/teste-feiticos.py"],
    [PY, "tools/teste-ocr-chat.py"],
    [PY, "tools/teste-sugestoes.py"],
    [PY, "tools/teste-tags.py"],
    [PY, "tools/teste-traumas.py"],
    [PY, "tools/teste-draft.py"],
    [PY, "tools/teste-vida.py"],           # registro de queda do coletor (pythonw filho que cai de propósito)
    [PY, "tools/teste-vigia.py"],          # vigia: decisão e rodada sem tarefa (as tarefas de teste: --real, à mão)
    [PY, "tools/teste-medir-travadas.py"],  # medidor de travadas (logs da Riot, classificação, gancho; mede 8 s)
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
    sys.stdout.reconfigure(encoding="utf-8")
    # teste-alertas, teste-aviso-partida e o ensaio abrem janelas (moldura, Tk) na tela: com o jogo aberto elas
    # aparecem por cima da partida do Gabriel (13/10/2026, ARMADILHAS § Windows). --com-jogo passa por cima.
    if "--com-jogo" in args:
        args.remove("--com-jogo")
    elif "League of Legends.exe" in subprocess.run(["tasklist", "/FI", "IMAGENAME eq League of Legends.exe"],
                                                   capture_output=True, text=True, errors="replace").stdout:
        print("League of Legends.exe aberto: provas que abrem janela ficam para depois da partida (--com-jogo força)")
        return 2
    filtros = args
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
