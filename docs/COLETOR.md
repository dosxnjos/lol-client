# Coletor, banco e MCP — como funciona

Regras do pós-jogo: [INSIGHTS.md](INSIGHTS.md). Pegadinhas: [ARMADILHAS.md](ARMADILHAS.md).
Visão de uso (o que o coach faz, ligar e desligar, instalar e desinstalar): [README](../README.md).

## Ciclo de vida

1. O client abre → o Windows grava o evento 4688 (`LeagueClientUx.exe`) → a tarefa
   `lol-client-coletor` roda `pythonw.exe coletor\coletor.py` (instalada por
   `tools\instalar-gatilho.ps1`, PowerShell elevado).
2. O coletor pega a trava `dados\coletor.lock` (pid; trava de pid morto é removida), lê o
   lockfile **em memória** (a credencial nunca vai para log nem banco), faz o backfill do que
   falta e assina o websocket WAMP (fase do gameflow, `eog-stats-block`, ranqueada).
3. Em cada mudança de fase: linha em `sessoes` e snapshot de LP em `lp`. No `EndOfGame`:
   grava o `eog` e busca a partida nova com espera de 5, 10, 20, 40, 80 e 160 s.
   Champ select: § Retrato do champ select. O servidor local (8765) sobe junto com o coletor e o
   coach liga e desliga pelas fases: § Coach na partida.
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
| 3 lições de uma partida (regras: `pengu\posjogo\licoes.md`) | `python coletor\coach.py [gameId]` (`--contexto`: o JSON que o pós-jogo do client recebe) |
| gravar uma partida real (só leitura) | `python tools\gravador.py` (`--ensaio`: 5 s e sai) |
| teste do retrato do champ select | `python tools\teste-champselect.py` |
| todas as provas offline (+ ensaio a 20x no fim) | `python tools\rodar-testes.py [filtro]` |
| ensaio ponta a ponta sem o client (§ Coach na partida) | `python tools\ensaio-coach.py [--velocidade 10] [--sem-prints]` |
| coletor contra o simulador (banco e porta de teste; nunca com o coletor real de pé na mesma trava) | `python coletor\coletor.py --liveclient http://127.0.0.1:2998 --db temp\x.db --porta-painel 8766` |
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
| `ao_vivo`, `eventos_ao_vivo` | amostra de 10 s da Live Client por participante e os eventos dela (§ Ao vivo); sem Riot ID |
| `previsoes_jungler`, `revisoes_jungler` | centro da zona mais provável do jungler inimigo a cada 10 s e a revisão contra a timeline no pós-jogo (§ Coach na partida); criadas pelo `coach_vivo.py` |
| `mentor` | pedidos ao mentor (§ Mentor); criada pelo `mentor.py` |

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
Fixar B pede um `--ensaio` com outra `MinimapScale`. **Em produção não há fórmula**:
`coletor/minimapa.achar_mapa` acha o anel da faixa (16, 28, 27) no 1º print de tela inteira e guarda
o retângulo (28/28 telas da partida medida → 347 em (2197, 716); a fórmula fica só no gravador).
`GlobalScale` (escala do HUD) fica fora da fórmula até um print mostrar que mexe no minimapa. O
print é do monitor, não da janela: filtrar quadros sem jogo ([ARMADILHAS](ARMADILHAS.md) § Tela).

## Minimapa ao vivo: detecção, jungler, selva e overlay (plano v2, passos 13, 14, 15b e 15d)

Só print do monitor (`mss`) com a janela "League of Legends (TM) Client" em primeiro plano e a faixa
no lugar; nada lê memória, injeta ou clica. Módulos (todos em `coletor/`, testes em `tools/teste-*.py`):

| módulo | o que faz | prova |
| --- | --- | --- |
| `minimapa.py` | `Captura` (thread ~6 fps): retângulo achado sozinho; anéis azul/vermelho por cor em meia resolução → candidatos → rosto comparado com o ícone **base** da LCU (`dados/icones/{id}.png`, `baixar_icones`) entre os vivos do time; Yuumi presa = anel grosso do hospedeiro (descartada se ela não teria como chegar lá); `terreno()` fog/parede por HSV V; `caminhavel()` grade | `teste-minimapa.py`: 66/74 ícones a ≤ 600 (89%), 0 falso de campeão, ~7–9 ms/quadro (~5% de um núcleo a 6 fps) |
| `jungler.py` | `EstadoJungler`: pista = último avistamento, objetivo com `KillerName`, abate com ele, renascer na fonte; zonas (rota/rio/selva/base, relativas ao meu time) com prior por horário; `gank()` | `teste-jungler.py` 5/5; `--real` toca a partida medida |
| `selva.py` | `EstadoSelva`: lado de início, rota provável e campos limpos pelo tempo, nível 3 previsto, contra-selva; horários em [SELVA](SELVA.md) | `teste-selva.py` 2/2 + partida real |
| `alcance.py` | `Grade` (caminhável do próprio minimapa; Dijkstra 8-vizinhos, ~40 ms), `Area` (velocidade × tempo, um salto da [MOBILIDADE](MOBILIDADE.md), Flash = 0,5), `GradeViva` (regera ~20 s após o 2º `DragonKill` e a cada 5 min; `dados/mapas/`), `velocidade()` (Data Dragon + bota) | `teste-alcance.py` 4/4 |
| `overlay_minimapa.py` | janela Tk click-through, topo, sem foco, **fora do print** (`WDA_EXCLUDEFROMCAPTURE`) sobre o retângulo; calor ∩ fog; some 30 s após a última pista e mostra "jungler sumido há X s" (caixa do tamanho do texto) por 10 s, depois some até a próxima pista; F8 liga/desliga | `python coletor/overlay_minimapa.py --demo` (estilos, `WindowFromPoint`, desenho e exclusão do print) |

Ligação no laço ao vivo (quem integra; `relogio()` = `gameTime` estimado do laço, `live` = última
amostra da Live Client):

```python
cap = minimapa.Captura(lambda: {"meu_time": eu_time, "campeoes": [{campeao, id, time}...], "mortos": [...]}, relogio)
minimapa.baixar_icones(lcu, ids)            # ids: minimapa.ids_por_alias(lcu) + minimapa.id_do_jogador(p, mapa)
cap.iniciar()                               # InProgress; cap.parar() fora de FASES_JOGO
gv = alcance.GradeViva(lambda: cap.quadros, patch)
jg = jungler.EstadoJungler(eu_time, grade=None, lado=347)   # refeito com cap.ret.lado quando o retângulo chega
# a cada amostra (1 s):
jg.jogadores(live["allPlayers"], gt, velocidade=alcance.velocidade(jungler_campeao, itens_dele))
jg.eventos(live["events"]["Events"]); gv.eventos(live["events"]["Events"])
jg.observar(cap.deteccoes(max_idade=1)); g = gv.atualizar(gt); jg.trocar_grade(g)
jg.preparar(gt)                             # Dijkstra da pista nova aqui, não na thread do overlay
estado = jg.estado(gt, fog); aviso = jg.gank(gt, minha_rota, minha_pos)   # fog = cap.ultimo_terreno()["fog"] só com cap.no_ar
# gank(): None com ele na tela (visto há ≤ 3 s: o AlertasPosicao avisa); eu jungler → rota do meu ícone
selva = jg.selva.estado(gt)
ov = overlay_minimapa.OverlayMinimapa(overlay_minimapa.fonte_jungler(cap, jg, relogio)); ov.iniciar()
```

Medido no replay da partida real (recortes a cada 10 s, Ekko contra a timeline 1/min): zona mais
provável certa 9/24 (38%), entre as 3 primeiras 16/24 (67%), posição real dentro da área 23/24.
Ao vivo a 6 fps deve melhorar; a avaliação de verdade é o passo 15.

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
`traumas(campeao, min_partidas)`: [INSIGHTS.md](INSIGHTS.md) § Traumas. `carregamento_atual()`: a
análise da tela de carregamento (abaixo); fora de partida `{"partida": false}`. Lê primeiro o `/estado`
do coletor (`"fonte": "coletor"`, sem gastar a cota da chave; porta em `LOL_CLIENT_PORTA`, padrão 8765)
e só analisa no próprio processo sem coletor de pé. `licoes(game_id)`: as 3 lições do pós-jogo
(`coach.licoes_partida`; [LICOES](LICOES.md)).

## Riot API, carregamento e meta (plano v2, passos 17 e 18)

- `coletor\riotapi.py`: cliente com balde por host (`br1`, `americas`; 20/s e 100/2 min, acertado
  pelo `X-App-Rate-Limit-Count`), `User-Agent`, 429 com `Retry-After`, cache em memória e, só para o
  que é chaveado por matchId e passou por `anonimizar_partida`, em `dados\riot-cache\`. Chave:
  `LOL_RIOT_API_KEY` do ambiente ou, sem ela, `doppler secrets get` do Doppler pessoal (só em memória).
- `coletor\carregamento.py`: gatilho = Live Client com `gameTime` < 0,1 e sem `GameStart`; os 10 pelo
  spectator-v5 (puuid da Riot API do Gabriel via `account-v1`), senão Riot ID → `account-v1`.
  Camadas L1 (liga, maestria), L2 (até 5 partidas, premade 1 vez), L3 ("morre cedo" do adversário e do
  jungler), L4 (previsão em faixa). Orçamento por partida br1 31 / americas 72, contador no log
  (`carregamento: chamadas …`). Puuid e Riot ID de terceiros só em memória; `encerrar()` esquece.
- `coletor\draft.py`: rota provável (atribuição dos 5 por ∏ P(rota|campeão), meta + histórico) e força
  do draft em faixa com os termos que mais pesaram; `gravar_previsao` → tabela `previsoes` do `meta.db`.
- `dados\meta.db` (`tools\coletar-meta.py`, rodar com `doppler run`): `partidas` (match_id, patch, fila,
  tier, remake), `picks` (campeão, rota, time, vitória), `pendentes` (retomada), `previsoes`. Sem puuid.
  13/10/2026: 309 partidas EMERALD (98 do 16.20; `--dias N` limita).
- Provas: `tools\teste-tags.py`, `tools\teste-draft.py`, `tools\teste-traumas.py`.

## Mentor (`coletor\mentor.py`, plano v2 passo 20)

O Claude do Gabriel em modo headless: `claude -p --safe-mode --model sonnet --advisor opus --effort medium
--tools "" --strict-mcp-config` com cwd e `BACKUP_RAIZ` em `%LOCALAPPDATA%\lol-client-mentor`, prompt
pelo stdin e env sem `CLAUDE*` (pegadinhas em [ARMADILHAS](ARMADILHAS.md) § Mentor). O prompt leva só
nomes de campeão (nunca Riot ID ou puuid): pós-jogo = `analise.analisar` + os 10 + ouro do time a cada
5 min + objetivos + matchup + últimas 20 com o campeão + sessão; ao vivo = uma amostra da Live Client
com os limites da névoa escritos. `Mentor` roda uma chamada por vez e uma na fila (a terceira → 429) e
grava cada pedido na tabela `mentor` (`status` pensando → pronto/erro, `session_id` para `--resume`).
Rotas (o servidor HTTP encaminha `/mentor…` para `Mentor.rota_http`): `GET /mentor/<gameId>`,
`POST /mentor/<gameId>` (gera de novo), `POST /mentor/<gameId>/pergunta {"pergunta"}`,
`POST /mentor/aovivo`. Teste: `python tools/teste-mentor.py --seco | --offline | (real) | --comparar`
(escreve só em `temp/`). Comparação de modelos: plano v2, passo 20.

## Ao vivo: laço, servidor local e painel da 2ª tela (plano v2, passos 8, 10 e 11)

- **`coletor\ao_vivo.py`**: `AoVivo` lê `allgamedata` a cada 1 s numa thread, passa por
  `coletor.limpar_live` (Riot ID → campeão) e monta o estado em `EstadoPartida` (sem IO). Fases:
  `carregando` (resposta com `gameTime` ~0 e sem `GameStart`), `jogo`, `fim` (`GameEnd`); 10 s sem
  resposta → `{"partida": false}`. Inimigo: nível, itens e farm congelam na fog → `vistoHaS` = tempo
  desde a última mudança (ou desde um abate dele com aliado envolvido); > 30 s = `atual: false` e o
  painel mostra cinza "visto há Xs". Ouro estimado = `priceTotal` do `items.json` da LCU (cache em
  `dados\cache\catalogo.json`; o `price` da Live Client é o da receita). Objetivos pelos horários
  medidos no banco (constantes no topo do módulo; alma = 4º `DragonKill` do time, fenda = tipo do 3º).
  "Teu padrão": vitórias por mortes antes dos 10 no histórico (campeão com n ≥ 8, senão geral).
  Grava amostra a cada 10 s de `gameTime` e os eventos novos (dedupe por `EventID`) só com `game_id`,
  fora de personalizada/treino e depois do `GameStart`.
- **`coletor\servidor_local.py`** (`127.0.0.1:8765`): `/` painel (estado embutido no 1º quadro),
  `/estado`, `/config` GET/POST (`dados\config.json`; chaves em § Coach na partida), `/mentor/...`
  (encaminha ao `Mentor.rota_http`), `/contexto/<gameId>` e `/licoes/<gameId>` (`coach.py`), e as rotas
  que o coach pendura (`/draft`, `/revisao/<gameId>`). CORS só para origem local (`127.0.0.1`,
  `localhost`, `plugins`, `riot`; preflight responde `Access-Control-Allow-Private-Network`); `Host` de
  fora → 403. O plugin chama `http://127.0.0.1:8765` (por IP: loopback não é conteúdo misto).
- **`painel\`**: HTML/CSS/JS sem build, 4 blocos fixos + faixa de 1 aviso, consulta `/estado` 1/s. O que
  as frentes acrescentaram entra **dentro** dos 4 blocos (via-negativa): carregamento → previsão em faixa
  no "Teu padrão" e tags do adversário na "Ameaça"; jogo → chip do jungler na "Ameaça", feitiços em
  recarga nos chips de "Time e objetivos" e, 60 s antes de um objetivo, o preparo no rodapé dele.
- **`coletor\janela_painel.py`**: `JanelaPainel.fase(fase)` abre o Edge `--app` no monitor secundário
  (área útil, em px lógicos) em `InProgress`/`Reconnect` e fecha fora das fases de jogo, por
  `WM_CLOSE` (o `taskkill` sem `/F` não fecha o Edge), com `taskkill /F` de reserva.

A ligação no `coletor.py` é o `coach_vivo.Coach` (§ Coach na partida); `--liveclient` é flag do coletor.

| o quê | comando |
| --- | --- |
| simulador da Live Client (porta 2998) | `python tools\simular-liveclient.py [--inicio 600] [--velocidade 20]` (`/sim/ir?gt=`, `/sim/pausar`, `/sim/desligar`) |
| laço + servidor avulsos | `python coletor\ao_vivo.py --liveclient http://127.0.0.1:2998 --db temp\ao_vivo.db --game-id 1` |
| atualizar o catálogo (client aberto) | `python coletor\ao_vivo.py --baixar-catalogo` |
| abrir/fechar a janela | `python coletor\janela_painel.py --teste` |

## Avisos ao vivo: voz e moldura (plano v2, passos 12 e 15c)

`coletor\avisos.py` é o motor comum; tempo em tudo = `gameTime` (s). Ligação (integração):

```python
relogio = RelogioJogo()                                   # laço ao vivo: relogio.atualizar(gameTime)
motor = MotorAvisos(tom="serio", relogio=relogio, voz=Voz(), moldura=Moldura())
live = GatilhosLive(motor)                                # a cada allgamedata: live.atualizar(dados, objetivos=…); motor.tick()
pos = AlertasPosicao.do_live(motor, dados)                # 1º allgamedata com GameStart
pos.observar(cap.deteccoes(max_idade=1), relogio(), quadro_valido=cap.no_ar, mortos=live.mortos)  # ≥ 1/s
motor.publicar(Aviso("gank", {"zona": "no top", "zc": "top"}, "top"))   # jungler.py; regra do coach.py: Aviso(id, textos={tom: (fala, rótulo)})
motor.estado()                                            # bloco "aviso" do /estado (faixa do painel)
motor.configurar(tom=, voz=, moldura=, painel=, desligados={"voz": [...], "tela": [...]})  # seção do 7b
```

- **Tipos calados por destino** (`avisos.normalizar_desligados`): `{"voz": [tipos], "tela": [tipos]}`,
  "tela" = painel + moldura. Tipo nos dois = descartado (`suprimidos["desligado"]`); só num = os outros
  destinos seguem. Tipos ligáveis: `avisos.TIPOS_LIGAVEIS` (os 12 de `TIPOS` + `feitico_voltou`,
  `pico_nivel`, `pico_item`, `regra`); tipo publicado fora da lista conta como `regra`. Lista simples
  (formato até 13/10/2026) = calado nos dois: o motor, o `servidor_local` e o plugin migram.

- **Detecções do minimapa** (contrato do passo 13): lista de `{campeao, time, x, y, visto_em}`
  (`minimapa.Captura.deteccoes(max_idade=1)`); visível agora = `visto_em` a ≤ 0,6 s do `gt`, o
  resto é posição antiga e conta como fora de vista; `campeao` = `championName` da Live Client, `time` =
  `ORDER`/`CHAOS` (ou 100/200), `x`/`y` em unidades do mapa (0–14870 × 0–14980, origem na base azul),
  `visto_em` = `gameTime` do quadro. `quadro_valido=False` quando o jogo não está na tela: pausa (e
  2 s de ressincronia ao voltar). Morto não "some" (`mortos`).
- **Regras**: anti-spam por `tipo:chave` (`repetir`), voz com 1 fala a cada 20 s (gank e intruso
  vermelho furam e cortam a fala comum; alerta de posição com prio ≥ 70 fala ≥ 5 s depois de uma fala
  informativa de prio < 50, marcado `furou`), aviso que esperou além da `validade` cai; moldura 1 por
  vez (2,5 s entre elas); painel mostra o de maior prioridade dos últimos ~8 s. Tabela de tipos,
  cores e limiares no topo de `avisos.py` (`TIPOS`, `OBJETIVOS`, constantes das classes).
- **Posição**: jungler apareceu (≥ 8 s fora de vista ou 1º avistamento); mid sumiu (6 s sem
  detecção, fora da base dele) e "mid indo X" ao reaparecer fora do mid; intruso = inimigo que não
  mora na rota vigiada (moradores: top no top, mid no mid, atirador e suporte no bot; o jungler deles
  não mora em nenhuma) chegando a ≤ 1500 da faixa dela (regiões de [INSIGHTS](INSIGHTS.md)), vermelho
  se jungler ou 2+, amarelo se 1; "chegando" = **ele** entrou na faixa ou reapareceu nela, nunca eu
  entrando numa rota onde ele já estava. Adversário da rota do champ select que volta depois de ≥ 20 s
  sumido = azul. Rota vigiada = a do meu ícone, senão a posição da Live Client; jungler sem ícone numa
  rota não vigia nada (com o ícone numa rota, o jungler deles chegando = vermelho urgente, o contra-gank).
  Na minha rota, intruso vence "mid indo".
- **Textos** (dois tons, `sério`/`descontraído`): padrão em `avisos.TEXTOS`; editáveis na seção
  `## Avisos ao vivo` do arquivo de lições (`pengu\posjogo\licoes.md`, senão `docs\LICOES.md`, onde ela
  mora hoje com os 12 tipos), uma
  linha por tipo: `` - `tipo` | sério: fala / rótulo | descontraído: fala / rótulo `` (rótulo ≤ 3
  palavras; placeholders `{campeao}`, `{zona}`, `{zc}`, `{zt}`, `{objetivo}`, `{n}`, `{ouro}`).
- **Voz** (`coletor\voz.py`): um PowerShell persistente (System.Speech, "Microsoft Maria Desktop",
  sem janela, prioridade abaixo do normal), frase em base64 pelo stdin, fila por prioridade.
  `voz.prioridade_do_processo(True)` põe o coletor abaixo do normal na partida.
- **Moldura** (`coletor\moldura.py`): janela própria de tela inteira, click-through
  (`WS_EX_LAYERED|TRANSPARENT|TOPMOST|TOOLWINDOW|NOACTIVATE`), borda pulsando + rótulo no canto por
  2 s, só com "League of Legends (TM) Client" em primeiro plano, e **fora do print**
  (`WDA_EXCLUDEFROMCAPTURE`, [ARMADILHAS](ARMADILHAS.md) § Tela).

| o quê | comando |
| --- | --- |
| falar uma frase | `python -c "from coletor.voz import falar; falar('teste do coach')"` |
| mostrar um alerta | `python coletor\moldura.py vermelho "jungler rio top" --forcar` |
| provas | `python tools\teste-coach.py` (anti-spam + replay da partida gravada), `python tools\teste-alertas.py` |

## Feitiços inimigos e sugestões (plano v2, passos 15e e 15f)

- **`coletor\feiticos.py`**: `Feiticos` guarda o gasto de feitiço de cada inimigo (início = horário
  `mm:ss` da linha do chat, não a hora da leitura) e a volta em `base × 100/(100 + aceleração)`:
  bota 3158 +10 / 3171 +20 lida na Live Client na hora; Perspicácia Cósmica (8347) +18 pelo
  spectator-v5 (`runas_do_espectador`, só `championId → perkIds`); sem spectator e com Inspiração
  (8300) nas árvores = "±" (volta mais cedo, com a runa). Fontes: `LeitorChat` (print do chat a cada
  ~3 s pelo `mss`, só com o jogo em primeiro plano, no **monitor do jogo** (`minimapa.monitor_do_jogo`:
  resolução do `game.cfg`, senão o principal; o `monitors[1]` do mss aqui é a 2ª tela); OCR sem resposta
  em 10 s mata o PowerShell e sobe outro no próximo print; recorte calibrado sozinho pelas linhas `mm:ss` e
  guardado em `dados\calibracao-chat.json`; OCR do Windows pt-BR num PowerShell persistente, imagem
  pelo stdin, nada em disco) e `Atalhos` (F9 + 1..5 = TOP..UTILITY: Flash dele agora; repetir em
  10 s desfaz). Dedupe: mesmo inimigo e feitiço a ≤ 60 s = um gasto; linha > 300 s antes do
  `gameTime` cai (a linha fica na tela 2 min ou mais).
- **`coletor\sugestoes.py`**: `preparo_objetivo` (60 s antes: mortos, vistos/sumidos pelo minimapa,
  área do jungler; horários do `ao_vivo.py`), `revisar_previsao`/`precisao_acumulada` (previsão do
  jungler × timeline, ≤ 1000 unidades, só com ele na fog), `PicosDeForca` (adversário de rota e
  jungler: níveis 6/11/16 e 1º lendário; salto > 1 nível = "visto nível N"), `bloco_carregamento`
  (composição pela LCU + lembrete de [ITENS.md](ITENS.md)), `amostrar`/`coach_ativo` (treino 3140:
  coach ligado, amostra fora). Dado estático (feitiços, lendários, campeões): `carregar_estatico(lcu=)`
  → `dados\cache\jogo-estatico.json`, refeito quando o patch muda.

| o quê | comando |
| --- | --- |
| OCR do chat contra o gabarito | `python tools\teste-ocr-chat.py [temp\gravacao\<pasta>]` (rc 2 = régua ok, amostra < 10 prints com ping) |
| cronômetro, leitura, atalho | `python tools\teste-feiticos.py` (`--sem-gravacao` pula o replay) |
| sugestões 2–6 | `python tools\teste-sugestoes.py` → `5/5 ok` |

## Coach na partida (`coletor\coach_vivo.py`, integração de 13/10/2026)

`Coach` (um por processo: servidor local, laço ao vivo, carregamento, mentor, janela do painel) +
`_Partida` (o que vive só numa partida). O `coletor.py` só chama `coach.fase()` a cada mudança do
gameflow, `coach.champ_select(sessão)` e `coach.pos_partida(gid)` quando a partida chega no banco;
tudo que bloqueia roda em `asyncio.to_thread`. `--sem-coach` desliga.

| momento | o que liga ou desliga |
| --- | --- |
| início do coletor | servidor local (8765; porta ocupada → loga e segue), mentor (tabela `mentor`) |
| champ select (cada sessão) | `draft.Draft.analisar_sessao` → `GET /draft`; `GET /draft/<meu campeão>` junta `matchups` (`analise.matchups`) e `traumas` dele contra os inimigos travados (cache de 10 min por campeão): é o que o selo do plugin lê |
| `InProgress`/`Reconnect` | processo **abaixo do normal**; laço ao vivo (`AoVivo`, só um ouvinte para sempre); por partida: `MotorAvisos` + `GatilhosLive` (voz, moldura, faixa do painel), `Captura` do minimapa + `EstadoJungler`/`GradeViva` + overlay, `Feiticos` + OCR do chat a cada 3 s + atalho F9, `PicosDeForca`, dado estático (cache; a LCU refaz por patch em thread); janela do painel |
| carregamento (Live Client com `gameTime` ~0) | `Carregamento.verificar` (Riot API, uma vez por partida) → `carregamento` no `/estado`; `bloco_carregamento` → `composicao`; runas do spectator → `Feiticos.definir_runas` |
| jogo, a cada leitura (1 s) | avisos da Live Client, `AlertasPosicao` sobre as detecções, jungler (gank só com rota: o Gabriel de selva não tem), feitiços que voltaram e picos de força → motor, `preparo_objetivo`, item curado do [ITENS](ITENS.md) no lugar do genérico; uma previsão do jungler a cada 10 s |
| `WaitingForStats`/`PreEndOfGame` | para o que olha a tela: captura, overlay, OCR, atalho, moldura |
| `EndOfGame` ou fase fora do jogo | para tudo (threads com `join`), grava `previsoes_jungler`, `Carregamento.encerrar()` (esquece puuid/Riot ID), prioridade normal |
| partida no banco (backfill) | revisão da previsão (`revisoes_jungler`, `GET /revisao/<gameId>`) e `Mentor.posjogo` (não em personalizada/treino) |
| `GET /contexto` ou `/licoes` de partida fora do banco | busca `games/{id}` + `game-timelines/{id}` na LCU na hora (só GET, no máximo 1 a cada 3 s por partida) e grava; sem linha do tempo ainda → 404 com `tentarDeNovoS: 5` |

Cada seção do passo tem o próprio `try`: uma peça quebrada não apaga as outras, e o aviso de falha sai
no máximo 1 vez por minuto por seção. Previsão do jungler gravada = centro do calor **dentro da zona mais
provável** (o centro da área inteira cai no meio do mapa assim que ela cresce).

**Config** (`dados\config.json`, `servidor_local.CONFIG_PADRAO`; lida em cada `InProgress` e reaplicada
na hora a cada `POST /config`): `painelAoVivo`, `amostrasAoVivo`, `voz`, `tomVoz` (`serio`|`descontraido`),
`minimapa` (captura, jungler, alertas de posição), `overlayMinimapa`, `alertasTela` (moldura), `feiticos`
(OCR e F9), `carregamento` (Riot API), `mentor`, `mentorModelo` (`sonnet`|`haiku`|`opus`) e `mentorEffort`
(`low`|`medium`|`high`; padrão sonnet + medium, o vencedor do passo 20; aplicados no `Mentor` na criação e a
cada `POST /config`), `avisosDesligados` (`{"voz": [...], "tela": [...]}`; a lista antiga é migrada para os
dois, no arquivo salvo e no `POST`). O plugin manda `{"coach": cfg.coach}` na carga, a
cada mudança e, com o coletor fora, de novo a cada 30 s (`pengu/coach.js`); chave desconhecida, de tipo
errado ou valor fora da lista é ignorada (volta ao padrão). Depois que o jogo sai da tela, um `POST /config`
não religa captura nem OCR daquela partida.

**Ensaio** (`python tools\ensaio-coach.py`): o `Coletor` com LCU falsa + o simulador tocando a partida
3292746609 inteira (carregamento, 30 s a 1x, o resto a 10x), banco copiado em `temp\ensaio\` (a partida
chega pelo backfill no `EndOfGame`), portas 8766/2996. Som, tela, teclado e rede trocados por registros
(lista no cabeçalho do script); minimapa e OCR rodam de verdade sobre os prints gravados. Medido em
13/10/2026: CPU do processo 2,5–2,8% de um núcleo a 1x (passo do laço p50 0,9 ms; fora da conta: o
minimapa a 6 fps, que a frente mediu em ~5%, e os PowerShell filhos de voz e OCR, abaixo do normal), ~11%
a 10x (p95 4,8 ms, máx ~300 ms no Dijkstra do jungler; na rodada do fechamento 3,2% / 12,0%, p95 5,4 ms e um
passo de 1229 ms); 29–31 falas em 33 min, nenhuma chave repetida,
menor intervalo 20,0 s; aviso de dragão 60 s antes nos 5; `EndOfGame` desliga em < 0,1 s e não sobra
thread; `dados\` intocado. Prints do painel em `temp\ensaio\painel-*.png`.

**Plugin contra um coach de verdade** (`python tools\servidor-teste-plugin.py [--fixture]`): `Coach` com mentor
real na 8765, banco copiado em `temp\pengu\` e config em `temp\pengu\config.json`; lê o champ select da LCU (só
GET). Serve para provar selo, pós-jogo e a seção LOL-CLIENT com o coletor real ainda no código antigo (sem a
8765); com o coletor novo de pé a porta está ocupada e ele sai.

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
--scope user lol-client` e apagar `dados\`. Lista completa (junção do Pengu, porta 8888, pastas do
mentor): [README](../README.md) § Desinstalar tudo.
