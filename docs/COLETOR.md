# Coletor, banco e MCP — como funciona

Regras do pós-jogo: [INSIGHTS.md](INSIGHTS.md). Pegadinhas: [ARMADILHAS.md](ARMADILHAS.md).

## Ciclo de vida

1. O client abre → o Windows grava o evento 4688 (`LeagueClientUx.exe`) → a tarefa
   `lol-client-coletor` roda `pythonw.exe coletor\coletor.py` (instalada por
   `tools\instalar-gatilho.ps1`, PowerShell elevado).
2. O coletor pega a trava `dados\coletor.lock` (pid; trava de pid morto é removida), lê o
   lockfile **em memória** (a credencial nunca vai para log nem banco), faz o backfill do que
   falta e assina o websocket WAMP (fase do gameflow, `eog-stats-block`, ranqueada).
3. Em cada mudança de fase: linha em `sessoes` e snapshot de LP em `lp`. No `EndOfGame`:
   grava o `eog` e busca a partida nova com espera de 5, 10, 20, 40, 80 e 160 s.
4. Websocket caiu (recarga da interface) → reconecta. Sem lockfile ou LCU muda por
   `--ocioso-min` (padrão 10) → grava "encerrado (ocioso …)" e sai com rc 0.

Log: `dados\coletor.log` (1 MB × 3), com "iniciado", "conectado ao client", "fase …",
"backfill: …" e "encerrado (motivo)".

## Comandos

| o quê | comando |
| --- | --- |
| backfill avulso (sem trava, client aberto) | `python coletor\coletor.py --so-backfill` |
| teste de ociosidade | `python coletor\coletor.py --ocioso-min 0.1 --lockfile C:\nao\existe` |
| análise de uma partida | `python coletor\analise.py [gameId]` |
| instalar / remover o gatilho | `powershell -NoProfile -ExecutionPolicy Bypass -File tools\instalar-gatilho.ps1` (ou `remover-gatilho.ps1`) |
| parar o coletor agora | `schtasks /end /tn lol-client-coletor` |
| MCP | `claude mcp add --scope user lol-client -- python C:\Dev\lol-client\mcp\servidor.py` (remover: `claude mcp remove --scope user lol-client`) |

`--lockfile` explícito desliga a busca do lockfile pela linha de comando do client.

## Banco (`dados\lol.db`, SQLite WAL)

| tabela | conteúdo |
| --- | --- |
| `partidas` | uma por `gameId`: criação, duração, mapa, fila, eu, campeão, vitória, `tem_timeline`, json bruto de `games/{id}` |
| `participantes` | os 10 de cada partida, com puuid, `eu`, KDA, CS de tropa e de selva |
| `frames` | 1 linha por (partida, frame, participante): posição, ouro, xp, CS, nível |
| `eventos` | eventos da linha do tempo em ordem (`seq`), colunas + json do evento |
| `lp`, `sessoes`, `eog` | telemetria ao vivo: só existe das sessões em que o coletor rodou |
| `campeoes`, `meta` | nomes dos campeões; puuid e Riot ID do jogador |

## MCP (`mcp\servidor.py`)

Ferramentas: `resumo(dias)`, `partidas(limite, campeao, fila)`, `analise_partida(game_id)`,
`tilt()`, `campeoes(min_partidas)`, `sincronizar()`. Tudo abre o banco com `mode=ro`, exceto
`sincronizar()` (precisa do client aberto). Winrate, tilt e campeões ignoram remake
(< 5 min), personalizada e treino; no tilt a sequência de derrotas zera numa pausa ≥ 2 h.

## Segurança: token da LCU no log Security

O gatilho só filtra por `NewProcessName`; não precisa da linha de comando. Mas, com
`HKLM\…\Policies\System\Audit` `ProcessCreationIncludeCmdLine_Enabled=1`, cada 4688 do
`LeagueClientUx.exe` grava a linha de comando inteira, com `--remoting-auth-token` (credencial
da LCU da sessão aberta) e `--riotclient-auth-token`. Qualquer processo elevado lê. O token
morre quando o client fecha e o log é circular (200 MB, ~2,5 h de retenção medida em
13/10/2026), mas fica lá enquanto não for sobrescrito.

- Nesta máquina a chave **já estava ligada** antes do projeto (harness, 10/10/2026, para
  depurar o `claude.exe`): [maquina-nova.md](../../cerebro/temas/harness/maquina-nova.md) § 8,
  onde também está como desligar. O projeto não liga nem desliga essa chave; o
  `instalar-gatilho.ps1` só avisa quando ela está em 1.
- Máquina com a chave desligada: o instalador liga só a auditoria (sem linha de comando) e
  nada de token vai para o log.
- Alternativa sem log nenhum: assinatura WMI `Win32_ProcessStartTrace` (não implementada).

## Reverter tudo

`tools\remover-gatilho.ps1` (tarefa + auditoria ao estado salvo), `claude mcp remove
--scope user lol-client` e apagar `dados\`.
