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
   Champ select: § Retrato do champ select.
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
| gravar uma partida real (só leitura) | `python tools\gravador.py` (`--ensaio`: 5 s e sai) |
| teste do retrato do champ select | `python tools\teste-champselect.py` |
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
| `lp`, `sessoes`, `eog` | telemetria ao vivo: só existe das sessões em que o coletor rodou (`eog` bruto, com o Riot ID dos 10) |
| `campeoes`, `meta` | nomes dos campeões; puuid e Riot ID do jogador |
| `champ_select` | um retrato por seleção de campeão (abaixo); só existe das sessões em que o coletor rodou |

## Retrato do champ select

O coletor assina `OnJsonApiEvent_lol-champ-select_v1_session` e alimenta
`coletor.RetratoChampSelect` (sem IO; o teste usa a mesma classe):

- entra em `FINALIZATION` → grava a 1ª versão; `GameStart`/`InProgress` no gameflow → regrava
  com a última sessão e a runa final e liga o `game_id`. Seleção desfeita (dodge: o gameflow
  volta a lobby/fila) → regrava com `desfeita=1`, ou não grava se nem chegou à finalização.
  Quem decide é a fase do gameflow, não o `Delete` da sessão (a ordem dos dois não é garantida).
  Sessão fechada não reabre: `Update` atrasado com a mesma chave é ignorado (`fechadas`, últimas
  50). Chave = `id` da sessão; vazio → `g<gameId>`.
- colunas: `chave` (id da sessão), `ts` (1ª sessão vista), `game_id`, `fila`, `posicao`
  (`assignedPosition` do jogador local, maiúsculo; vazio = às cegas), `preferidas` (`TOP,JUNGLE`,
  do `GET /lol-lobby/v2/lobby` lido em `Lobby`/`Matchmaking`/`ReadyCheck`), `autofill` (posição
  fora das preferidas, `FILL` nas preferidas = nunca; sem posição = null), `autofill_riot`
  (`isAutofilled` da Riot, para conferir), `campeao`, `aliados`/`inimigos` (json `{cell,
  campeao, posicao}`, **só ids**), `bans_aliados`/`bans_inimigos` (das ações `ban` completas;
  sem elas, de `session.bans`), `runa_id`/`runa_nome` (`/lol-perks/v1/currentpage`), `feiticos`,
  `seg_ate_travar` (1ª sessão → pick local completo; null se já veio travado), `desfeita`.
- `posicao` e `autofill` são da **última** sessão, depois de trocas de posição: autofill para
  UTILITY trocado para TOP grava `posicao=TOP`, `autofill=0`, `autofill_riot=1`. O `champ_select()`
  do MCP separa o winrate por `autofill` (o que ele jogou), não pelo `autofill_riot`.
- O retrato nunca grava `chatDetails` (senha e jwt da sala) nem nome/puuid de ninguém
  (`limpar_sessao()`): na ranqueada o nome dos outros fica oculto na seleção. Já `partidas.json`,
  `participantes.puuid` e `eog` guardam o que o histórico e o fim de jogo mostram (Riot ID e puuid
  dos 10), só em `dados\` (fora do git). Fixture para `tests/` sai sem identidade de terceiros.
- Prova: `python tools/teste-champselect.py` (fixtures `tests/fixtures/champselect-*.json`,
  banco de teste em `temp/`).

## Gravador (`tools\gravador.py`)

Processo à parte, **só leitura**, para o Gabriel deixar rodando numa partida normal (plano v2,
passo 0). Não usa o log nem a trava do coletor; prioridade abaixo do normal; pode nascer antes
do client (espera ele abrir); sai sozinho 30 s depois do client fechar ou 10 min após o
`EndOfGame` (jogou de novo antes: segue). GET que falha (timeout, conexão caída) vira `erro_lcu`
no resumo e o laço segue; erro inesperado encerra, mas a conferência de credencial roda igual
(rc 1). Saída em `temp\gravacao\<AAAAMMDD-HHMMSS>\`, resumo no console ao sair.

| fase | o quê | arquivo |
| --- | --- | --- |
| todas | cada mudança de fase | `fases.jsonl` |
| `Lobby`/`None`/`Matchmaking` | fila, preferidas, nº de membros (na mudança de fase e a cada 5 s, se mudou; sem preferidas ao entrar no champ select, relê) | `lobby.jsonl` |
| `Matchmaking`/`ReadyCheck` | `GET /lol-matchmaking/v1/ready-check` a cada 200 ms (`timer`, `state`, `playerResponse`) | `readycheck.jsonl` |
| `ChampSelect` | sessão limpa a cada mudança (o relógio não conta) + runa + a fase seguinte | `champselect.jsonl` (**já é o `eventos` de uma fixture do passo 1**) |
| `InProgress` | `allgamedata` da Live Client a cada 1 s (recusada = sem partida), com o nome de cada jogador trocado pelo campeão também nos eventos (`coletor.limpar_live`); recorte do minimapa a cada 10 s e tela inteira a cada 60 s, com o `gameTime` no nome | `live.jsonl`, `minimapa/`, `telas/`, `calibracao.json` |
| `EndOfGame` | `game-timelines/{id}` e `games/{id}` (bruto: Riot ID e puuid dos 10), com espera de 5…160 s | `timeline-{id}.json`, `partida-{id}.json` |

`python tools\gravador.py --ensaio` grava 5 s da fase atual, tenta a Live Client, tira 1 recorte
do minimapa e confere em memória que a credencial não está em nenhum arquivo ("credencial nos
arquivos: 0"; o valor nunca é impresso). Antes de uma partida, o orquestrador reinicia a tarefa
`lol-client-coletor` para o coletor com champ select ser o que roda. Disco: medido 69,3 MB
de `live.jsonl` numa partida de 33 min (33 KB por amostra), mais ~4–5 MB por print de tela inteira (1 por minuto); apagar
`temp\gravacao\` depois de extrair o que interessa.

### Minimapa (retângulo de recorte)

Lido do `Config\game.cfg` do jogo: `[General] Width`, `Height`, `WindowMode`; `[HUD]`
`MinimapScale`, `FlipMiniMap`. O monitor do jogo é o que tem `Width×Height` (`mss` 10 já devolve
px físicos: 2560×1080 aqui, mesmo com escala de 125%).

**Medido na partida de 13/10/2026** (2560×1080, `MinimapScale` 2,46, `FlipMiniMap` 0; 28 de 28
telas de jogo, [MEDICAO-2026-10-13](MEDICAO-2026-10-13.md) § 3):

| o quê | retângulo (px físicos da tela) |
| --- | --- |
| **mapa** (quadrado preto onde ficam os ícones) | **347×347 em (2197, 716)**, a 16 px da borda direita e 17 da de baixo |
| moldura dourada de fora | ~381×382 em (2179, 698) até o canto do monitor |
| faixa em volta do mapa | cor (16, 28, 27), começa logo após a borda do mapa |

Mundo → pixel da tela (mínimos quadrados, 79 pontos): `X = 2196,7 + 0,02345·x`,
`Y = 1064,0 − 0,02361·y`. A conversão nominal (0–14870 × 0–14980 esticado nos 347 px) erra ≤ 6 px.

Fórmula do gravador (ainda o chute antigo, que acertou a **moldura**, não o mapa):

```
lado    = altura × (0,194 + 0,0648 × MinimapScale)       # = moldura (382); mapa ≈ moldura − 33 px
recorte = min(altura, lado × 1,3), quadrado preso ao canto de baixo (direito; FlipMiniMap=1: esquerdo)
```

O recorte gravado (497×497 em 2063, 583) contém o mapa inteiro em (134,133)–(481,480), com ~2× a
área necessária. Só uma escala foi medida, então `MINI_A` e `MINI_B` não se separam: a restrição é
`A + 2,46·B = 0,3213` para o mapa (0,352 para a moldura); mantendo B = 0,0648,
`lado_mapa = altura × (0,1619 + 0,0648 × MinimapScale)` e canto em `(W − 16 − lado, H − 17 − lado)`.
Fixar B pede um `--ensaio` com outra `MinimapScale`. **Para produção (passo 13), autodetectar**: achar
a faixa (16, 28, 27) em volta do mapa no 1º recorte de jogo e guardar o retângulo; a fórmula fica
de reserva. Constantes no topo de `tools/gravador.py` (o passo 13 leva para `coletor/minimapa.py`).
`GlobalScale` (escala do HUD) fica fora da fórmula até um print mostrar que mexe no minimapa. O
print é do monitor, não da janela: filtrar quadros sem jogo ([ARMADILHAS](ARMADILHAS.md) § Tela).

## MCP (`mcp\servidor.py`)

Ferramentas: `resumo(dias)`, `partidas(limite, campeao, fila)`, `analise_partida(game_id)`,
`tilt()`, `campeoes(min_partidas)`, `matchups(campeao, min_partidas)` (regra em
[INSIGHTS.md](INSIGHTS.md) § Matchups), `champ_select(limite)` (retratos + winrate com e sem
autofill; banco sem a tabela → "sem retratos ainda"), `sessao_hoje()` (partidas desde 00:00, ou
desde o início da sessão em andamento se ela começou antes, com a mesma regra de pausa do tilt,
mais a que terminou depois da meia-noite; sequência, LP do período, alertas pelo histórico de tilt
e de horário), `sincronizar()`. Tudo abre o banco com `mode=ro`, exceto `sincronizar()` (precisa
do client aberto). `LOL_CLIENT_DB` aponta outro banco (teste em `temp/`), `sincronizar()` incluso. Winrate, tilt e campeões ignoram remake
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
