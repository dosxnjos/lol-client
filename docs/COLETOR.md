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
| `overlay_minimapa.py` | janela Win32 click-through, topo, sem foco, **fora do print** (`WDA_EXCLUDEFROMCAPTURE`) sobre o retângulo, desenhada por `UpdateLayeredWindow` com alfa por px (desde 14/10/2026; antes Tk com cor-chave, que serrilhava); calor ∩ fog em **uma cor só** (`COR`) com a probabilidade na opacidade (`ALPHA_MIN` 12% em toda a área com calor ≥ `LIMIAR` a `ALPHA` 45%), borda desfocada (`SUAVE_PX`) e transição contínua (`Transicao`, τ 0,35 s, ~15 quadros/s só enquanto muda); some 30 s após a última pista (esmaecendo) e mostra "jungler sumido há X s" (caixa do tamanho do texto) por 10 s, depois some até a próxima pista; F8 liga/desliga (retorno "overlay ligado/desligado" na moldura, azul; registro e cada F8 recebido vão para o log) | `tools/teste-overlay.py` (cor, opacidade, borda, transição, conta da composição, custo ~2% de um núcleo animando); `python coletor/overlay_minimapa.py --demo` (estilos, `WindowFromPoint`, desenho contra a conta e exclusão do print) |

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
estado = jg.estado(gt, fog)                 # fog = cap.ultimo_terreno()["fog"] só com cap.no_ar
aviso = avisos.decidir_gank(lambda r, alvo: jg.gank(gt, r, alvo, fog), pos, reserva)   # pos = AlertasPosicao
# gank(): None com ele na tela (visto há ≤ 3 s: o AlertasPosicao avisa). decidir_gank: a rota de ONDE ESTOU
# (ícone; sem ícone, a do champ select) urgente; outra rota só com aliado visto nela, amarelo (§ Avisos ao vivo)
selva = jg.selva.estado(gt)
ov = overlay_minimapa.OverlayMinimapa(overlay_minimapa.fonte_jungler(cap, jg, relogio)); ov.iniciar()
```

Medido no replay da partida real (recortes a cada 10 s, Ekko contra a timeline 1/min): zona mais
provável certa 9/24 (38%), entre as 3 primeiras 16/24 (67%), posição real dentro da área 23/24.
Ao vivo a 6 fps deve melhorar; a avaliação de verdade é o passo 15.

**Como ler o overlay** (para o Gabriel): a mancha vermelha clara é onde o jungler deles **pode** estar agora;
quanto mais forte o vermelho, mais provável; o vermelho mais fraco (12%) marca até onde ele pode ter ido. Ela cresce aos poucos enquanto ele está sumido (ele anda), não
pinta onde o teu time está vendo e some devagar 30 s depois da última pista. Até 14/10/2026 eram três cores:
amarelo (pouca chance), laranja (média), vermelho (o mais provável do momento) e um contorno branco (até onde
ele conseguiria ter ido). Desde 14/10/2026 o Gabriel escolhe em Configurações › Minimapa e jungler: cor da mancha
(vermelho, o padrão, que a transparência deixa claro; laranja; roxo: azul fica fora porque é a cor dos aliados no minimapa), força (sutil,
normal, forte) e "mancha muda aos poucos" (desligado = muda na hora). Valores: `CORES` e `FORCAS` no topo do
`overlay_minimapa.py` (normal = `ALPHA`/`ALPHA_MIN`); a janela troca em voo por `OverlayMinimapa.aplicar_estilo`.

**A janela foi à tela?** O print nunca mostra o overlay (fora do print por regra), então quem prova é o log de cada
partida: `overlay: janela pronta (fora do print: True)` ao nascer, `overlay: na tela {ret, visivel, fora_do_print,
estilos, jogo_por_cima}` na 1ª vez que desenha (`OverlayMinimapa.diagnostico`, o que o Windows diz da janela) e
`overlay: o jogo estava POR CIMA do overlay na ordem Z` se, ao reafirmar o topo (1 s), o jogo estava acima dela.
Sem o jogo: `python coletor\overlay_minimapa.py --demo --left 1000 --top 300` (2ª fase = a ordem da produção).
O log "na tela" não prova que a mancha era visível (a janela TOPMOST sobre o jogo sem borda não perde na ordem Z):
o contraste é do desenho. **Mancha mínima** (revisão de 14/10/2026): pedaço de calor pequeno (área < π·(2·
`MANCHA_MIN_PX`)² px) alarga `MANCHA_MIN_PX` antes do desfoque e o pico volta ao de antes dele, então o jungler
recém-visto sai como bolinha no `ALPHA`, não a 2% ([ARMADILHAS](ARMADILHAS.md) § desfoque).

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

Resposta do pós-jogo (14/10/2026, [plano](../roadmap/2026-10-14-posjogo-livre-e-mentor-enxuto.md) D5/D6): até 120
palavras em linguagem de jogador, `Veredito:` (1–2 frases, sem número, causa e efeito; o painel põe na faixa do topo do
Resumo), `O essencial:` (1 item, 2 só se pesou igual, com o número e o que fazer), `Mandou bem:` (opcional, 1 fato bom
dos dados; sem nada claro a linha some; pedido do Gabriel 14/10) e `Próxima partida:`. Teto duro de 120 palavras contando
tudo (com o `Mandou bem` passava de 120: medido 128–155, apertado para ~100). O que não está nos dados fica de
fora, sem frase de "não tenho esse dado"; número só dos dados. Pergunta dele sobre algo fora dos dados (flash, vida do
inimigo): uma frase curta "daqui não dá para ver isso" e o que os dados mostram. Medição antes/depois: `python tools/medir-mentor.py
[gameId …]` (antes = resposta guardada; depois = chamada real; banco só lido, saída em `temp/mentor-medicao/`).

## Ao vivo: laço, servidor local e painel da 2ª tela (plano v2, passos 8, 10 e 11)

- **`coletor\ao_vivo.py`**: `AoVivo` lê `allgamedata` a cada 1 s numa thread, passa por
  `coletor.limpar_live` (Riot ID → campeão) e monta o estado em `EstadoPartida` (sem IO). Fases:
  `carregando` (resposta com `gameTime` ~0 e sem `GameStart`), `jogo`, `fim` (`GameEnd`); 10 s sem
  resposta → `{"partida": false}`. Inimigo: nível, itens e farm congelam na fog → `vistoHaS` = tempo
  desde a última mudança (ou desde um abate dele com aliado envolvido); > 30 s = `atual: false` e o
  painel mostra cinza "visto há Xs". Com o minimapa ligado, a última detecção dele também conta
  (`ao_vivo.mesclar_vistos`, no passo do coach; 14/10/2026: o farm da Live Client anda de 10 em 10 e o adversário
  à vista no minimapa ficava "dados dele parados" até chegar na tela do Gabriel); ela refaz os blocos da rota e
  da ameaça (cópias feitas no `atualizar`). Ouro estimado = `priceTotal` do `items.json` da LCU (cache em
  `dados\cache\catalogo.json`; o `price` da Live Client é o da receita). Objetivos pelos horários
  medidos no banco (constantes no topo do módulo; alma = 4º `DragonKill` do time, fenda = tipo do 3º).
  "Teu padrão": vitórias por mortes antes dos 10 no histórico (campeão com n ≥ 8, senão geral).
  Grava amostra a cada 10 s de `gameTime` e os eventos novos (dedupe por `EventID`) só com `game_id`,
  fora de personalizada/treino e depois do `GameStart`.
- **`coletor\servidor_local.py`** (`127.0.0.1:8765`): `/` painel (estado embutido no 1º quadro),
  `/estado`, `/config` GET/POST (`dados\config.json`; chaves em § Coach na partida), `/mentor/...`
  (encaminha ao `Mentor.rota_http`), `/contexto/<gameId>` e `/licoes/<gameId>` (`coach.py`), e as rotas
  que o coach pendura (`/draft`, `/revisao/<gameId>`) e o coletor (`/chat/...`, `POST /aceite/plugin`: § Sinal e
  diagnóstico do plugin). CORS só para origem local (`127.0.0.1`,
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
pos.observar(cap.deteccoes(max_idade=1), relogio(), quadro_valido=cap.no_ar, mortos=live.mortos,
             eventos=live.eventos.values())                                                  # ≥ 1/s
motor.publicar(Aviso("gank", {"zona": "no top", "zc": "top"}, "top"))   # jungler.py; regra do coach.py: Aviso(id, textos={tom: (fala, rótulo)})
motor.estado()                                            # bloco "aviso" do /estado (faixa do painel)
motor.configurar(tom=, voz=, moldura=, painel=, desligados={"voz": [...], "tela": [...]})  # seção do 7b
```

- **Tipos calados por destino** (`avisos.normalizar_desligados`): `{"voz": [tipos], "tela": [tipos]}`,
  "tela" = painel + moldura. Tipo nos dois = descartado (`suprimidos["desligado"]`); só num = os outros
  destinos seguem. Tipos ligáveis: `avisos.TIPOS_LIGAVEIS` (os 14 de `TIPOS`, com os retornos de atalho
  `feitico_marcado` e `overlay_f8`, + `feitico_voltou`, `pico_nivel`, `pico_item`, `regra`; a mesma lista
  do `AVISOS` de `pengu/blocos.js`, conferida pelo `teste-alertas.py`); tipo publicado fora da lista conta
  como `regra`. Lista simples (formato até 13/10/2026) = calado nos dois: o motor, o `servidor_local` e o
  plugin migram.
- **Aviso por evento**: `Aviso.molde` escolhe a fala em `TEXTOS` quando um tipo tem falas por evento
  (`feitico_marcado`: `feitico_armado`, `feitico_desfeito`, `feitico_sem_inimigo`…), e `Aviso.destinos`
  só restringe os do tipo (o F9 armado vai só para a moldura).
- **Retorno de atalho** (`retorno=True` em `TIPOS`: `feitico_marcado`, `overlay_f8`) só preenche tempo
  ocioso: na moldura sai quando nenhum alerta está na tela (2,5 s desde o último; o mais novo substitui os
  anteriores) e não conta no gap, então um alerta que chega depois entra na hora; na voz sai na hora, sem
  urgência (não corta a frase em curso) e fora do intervalo de 20 s. Nunca apaga nem atrasa um alerta.
- **Log**: cada fala e cada moldura saem no `dados\coletor.log` (`aviso voz <tipo>/<cor>: <fala>`,
  `aviso moldura <tipo>/<cor>: <rótulo>`): "a borda ficou vermelha" se confere pelo log.

- **Detecções do minimapa** (contrato do passo 13): lista de `{campeao, time, x, y, visto_em}`
  (`minimapa.Captura.deteccoes(max_idade=1)`); visível agora = `visto_em` a ≤ 0,6 s do `gt`, o
  resto é posição antiga e conta como fora de vista; `campeao` = `championName` da Live Client, `time` =
  `ORDER`/`CHAOS` (ou 100/200), `x`/`y` em unidades do mapa (0–14870 × 0–14980, origem na base azul),
  `visto_em` = `gameTime` do quadro. `quadro_valido=False` quando o jogo não está na tela: pausa (e
  2 s de ressincronia ao voltar). Morto não "some" (`mortos`).
- **Regras**: anti-spam por `tipo:chave` (`repetir`; gank 60 s); por **tipo**, independente da chave,
  `intervalo` (contado por tipo, destinos e `Aviso.grupo`) e `teto` por partida (`TIPOS`: `mid_sumiu` 120 s e 4, `jungler_apareceu` 20 s, `mid_indo` 30 s;
  calibração de 14/10/2026); a voz não repete a **mesma frase** em 60 s (`REPETIR_FALA_S`, qualquer tipo, fora
  o retorno de atalho; `suprimidos["fala_repetida"]`), urgente só em 10 s (`REPETIR_FALA_URGENTE_S`: o mesmo
  texto urgente pode ser outro perigo, ex. o gank de outra rota que virou o da minha); `Aviso.validade` e
  `Aviso.tom` postos pelo gatilho sobrepõem os do tipo/motor; voz com 1 fala a cada 20 s (gank e intruso
  vermelho furam e cortam a fala comum; alerta de posição com prio ≥ 70 fala ≥ 5 s depois de uma fala
  informativa de prio < 50, marcado `furou`), aviso que esperou além da `validade` cai; moldura 1 por
  vez (2,5 s entre elas); painel mostra o de maior prioridade dos últimos ~8 s. Tabela de tipos,
  cores e limiares no topo de `avisos.py` (`TIPOS`, `OBJETIVOS`, constantes das classes).
- **Onde estou** (`AlertasPosicao.onde_estou`, 14/10/2026): meu ícone visto há ≤ 4 s numa rota = ela; no rio
  ou na selva, a rota cuja faixa me contém (senão nenhuma: andando pela selva longe das rotas nenhuma rota é
  vigiada, só vale o raio de 4000 do jungler e o gank das rotas com aliado); na base **deles** (split push), a
  faixa da rota sem margem (perto do nexo, onde as 3 se cruzam, nenhuma); morto, na minha base ou sem ícone = a
  rota do champ select. **Base presumida** (revisão de 14/10/2026, D20): sem ícone fresco, mas com a última pista
  "fui para a base" há ≤ 45 s (`BASE_PRESUMIDA_S`: morri, o ícone sumiu com o anel grosso de voltando à base, ou
  foi visto por último na minha base), a fonte é `base` (pos `None`), não `reserva`: o ícone na fonte fica no
  canto do minimapa e mal passa no `LIMIAR_ANEL`. Vale para a rota vigiada (intruso), o jungler e o gank.
  Geometria das rotas absoluta, base e selva relativas ao meu time (`analise.regiao`): nada fixa "top".
- **Gank** (`avisos.decidir_gank`, chamado pelo `coach_vivo`): o da rota onde estou sai urgente, vermelho, prio
  100; o de outra rota (o Gabriel avisa os colegas) só com aliado visto nela há ≤ 5 s e adiantado, amarelo,
  prio 75, sem urgência, no máximo 1 a cada 30 s (`coach_vivo.GANK_OUTRA_S`), sempre no tom sério e com validade
  de 22 s na fila (`VALIDADE_GANK_OUTRA`: espera a fala anterior em vez de cair mudo); cada aliado da rota é
  testado, o mais adiantado primeiro (`aliados_na_rota`); 1 gank por vez (a minha rota vence; entre as outras,
  a de maior massa). Morto ou na base (inclusive a presumida), a minha rota só conta com aliado visto nela, como
  a de outra rota (amarelo, sem urgência): pedido do Gabriel depois da partida 3293137136.
- **Posição**: jungler apareceu (≥ 8 s fora de vista ou 1º avistamento) com voz e borda só se importa para
  onde estou (a ≤ 4000 de mim ou na zona de gank da minha rota, `avisos.ZONAS_DA_ROTA`); longe = só a faixa do
  painel, azul, prio 15 (abaixo das informativas); eu de selva, o jungler deles importa no mapa todo. Mid sumiu (6 s sem detecção, visto por último na rota do meio ou no rio) só entre 1:30 e 14:00,
  antes de cair torre externa do mid, e calado com eu morto, eu na base, cerco (2+ inimigos na minha base ou
  torre de inibidor/nexo/inibidor meu caído, pelo nome do evento) ou luta (3+ inimigos à vista a ≤ 2500 de um
  deles; cada um na sua rota não é luta): motivo em
  `AlertasPosicao.calados`. "Mid indo X" ao reaparecer fora do mid, só depois de um sumiço que passou na
  relevância ou foi calado só por luta, eu morto ou eu na base (`LIBERA_MID_INDO`), aceito ou não o "mid sumiu"
  pelo motor (intervalo, teto); nunca fora da fase de rotas, em cerco ou depois de morrer e renascer; intruso = inimigo que não
  mora na rota vigiada (moradores: top no top, mid no mid, atirador e suporte no bot; o jungler deles
  não mora em nenhuma) chegando a ≤ 1500 da faixa dela (regiões de [INSIGHTS](INSIGHTS.md); a faixa do meio,
  |y − x| ≤ 1200, é só do mid: com a margem, top e bot engoliam a frente das bases no meio, `avisos.perto_da_rota`), vermelho
  se jungler ou 2+, amarelo se 1; "chegando" = **ele** entrou na faixa ou reapareceu nela, nunca eu
  entrando numa rota onde ele já estava. Eu morto ou na base (inclusive a presumida), o intruso da minha rota só
  conta com aliado visto nela, a regra do gank (D24 do [plano de calibração](../roadmap/2026-10-14-calibrar-avisos.md)). Adversário da rota do champ select que volta depois de ≥ 20 s
  sumido = azul. Rota vigiada = a de onde estou (`onde_estou`, acima); jungler sem ícone numa rota não vigia
  nada (com o ícone numa rota, o jungler deles chegando = vermelho urgente, o contra-gank).
  Na minha rota, intruso vence "mid indo".
- **Escolhas nas Configurações** (pedido do Gabriel de 14/10/2026; [plano](../roadmap/2026-10-14-calibrar-avisos.md)
  passo 7): cada regra nova da calibração é uma chave da config, padrão = o comportamento acima. `gankOutraRota`
  false = `decidir_gank(..., outras=False)` (só a minha rota); `junglerLonge` = `AlertasPosicao.jungler_longe`
  (`painel` como acima, `tudo` = voz e borda como o de perto, mas com o `intervalo` de 20 s contado à parte
  (`Aviso.grupo="longe"`: o motor conta por `(tipo, destinos, grupo)`; sem isso o longe calava o perto dos próximos
  20 s), `nada` = nem o painel); `midSumiuFiltro` false =
  `filtro_mid` desligado (regra de antes: só não conta o mid visto por último na base dele; teto 4 e 120 s seguem);
  `cortarFalaRepetida` false = `MotorAvisos.cortar_repetida` (sem os 60 s nem os 10 s do urgente). Quem aplica é o
  `coach_vivo._Partida.configurar` (na largada e a cada `POST /config`) e `_configurar_pos`, chamado também quando o
  `AlertasPosicao` nasce (1º allgamedata com `GameStart`, depois da largada). Na tela: blocos Voz, Alertas e
  Minimapa de `pengu/blocos.js`; listas de valores em `pengu/config.js` = `servidor_local.ESCOLHAS` =
  `overlay_minimapa.CORES/FORCAS` (o `teste-alertas.py` confere).
- **Textos** (dois tons, `sério`/`descontraído`): padrão em `avisos.TEXTOS`; editáveis na seção
  `## Avisos ao vivo` do arquivo de lições (`pengu\posjogo\licoes.md`, senão `docs\LICOES.md`, onde ela
  mora hoje com 16 moldes), uma
  linha por tipo: `` - `tipo` | sério: fala / rótulo | descontraído: fala / rótulo `` (rótulo ≤ 3
  palavras; placeholders em [LICOES](LICOES.md)). **A fala é genérica** (rota, nunca campeão; sem ouro nem
  nível real) e o rótulo pode ter o nome: `feiticos.voltaram` e `sugestoes.PicosDeForca` mandam `dados`
  (+ `molde`) e o motor monta a fala pelo molde (`avisos.aviso_de`).
- **Catálogo** (`avisos.catalogo()`, plano [voz pré-gravada](../roadmap/2026-10-13-voz-pregravada-e-foco.md)
  passos 3/3b): toda fala possível = molde × tom × valores finitos (`avisos.valores_catalogo()`: zonas de
  `zona()`, `{rota}` de `ROTA_FALA` + "inimigo", `{n}` 2–5, objetivos, 8 feitiços com cronômetro, picos
  6/11/16). **452 falas** (226 por tom) em 13/10/2026, versão `avisos.versao_catalogo()`. Texto livre
  (`avisos.LIVRES`: regra do coach.py, hoje nenhuma ao vivo) fica fora; molde com placeholder sem valores
  finitos é listado por `moldes_fora_do_catalogo()`. Provas: `teste-coach.py` (catálogo, replay) e o ensaio
  (toda fala dentro).
- **Voz** (`coletor\voz.py`): fala que está no **pacote** ativo (`voz.PACOTE_PADRAO` = `aoede`, troca por
  `LOL_VOZ_PACOTE`; pasta `%LOCALAPPDATA%\lol-client\voz\pacotes\<nome>\` com `indice.json`) toca o `.wav`
  (`winsound` assíncrono) na mesma fila: prioridade, urgente corta, validade igual. Fora do pacote, ou sem
  a pasta: um PowerShell persistente (System.Speech, "Microsoft Maria Desktop", sem janela, prioridade
  abaixo do normal), frase em base64 pelo stdin; com pacote, a frase que faltou vai 1 vez por processo para
  `dados\voz-faltou.jsonl`; fala `suspeita` no índice e `.wav` que falha ao tocar também vão para a Maria.
  Pacote gerado por `tools/gerar-pacote-voz.py` (lotes em rodízio de moldes no Gemini; corte guiado pela
  transcrição: o silêncio separa pedaços, o Whisper do Reco em `tools/conferir-trechos.py` diz de qual frase é
  cada um, e o trecho tem de soar mais como a própria frase do que como as vizinhas do lote; `loudnorm`; prova
  offline `tools/teste-pacote-voz.py`). `voz.prioridade_do_processo(True)` põe o coletor abaixo do normal na partida.
- **Pacote que cresce sozinho** (plano voz, passo 6b): a tarefa `lol-client-voz` (`tools\voz-agendada.py rodar`,
  `pythonw`, oculta, só logado) roda às 05:15 e a cada 2 h até 23:15. Pula com `League of Legends.exe` aberto ou o
  client fora de `None`/`Lobby`/`EndOfGame` (fase pela LCU, como o coletor); senão chama o gerador no venv do TTS
  (`--tom ambos`, console oculto, abaixo do normal) e, se o client entra em fila no meio, cria
  `dados\voz-agendada.parar` (o gerador para antes do próximo pedido ou no meio de uma espera da API); com
  `League of Legends.exe` aberto, mata o gerador na hora. O Whisper só sobe no 1º áudio (cota morta = 1 pedido e
  sai). O gerador faz (a) as falas que faltam, com a
  fila de modelos inteira e o **modelo-alvo** na frente (`modelo_alvo` no `indice.json`: o 1º da fila na 1ª rodada,
  fixo depois; `--modelo-alvo` troca); (b) só se (a) esvaziou, refaz no alvo as falas de outro modelo, **só com o
  alvo**. Fala refeita ganha `<hash>-<n>.wav` e entra no índice só depois de passar na conferência; o `.wav` antigo
  sai depois do índice; recusada, a antiga fica (`tentativas_alvo`, no máximo 1 por dia; 3 recusas = presa; trocar o
  alvo zera). Fala com duração absurda (`falhas`) também volta só 1 vez por dia. `progresso_alvo` no índice;
  completo e no alvo → a tarefa se desativa (`schtasks /change /disable`) e registra; presas e suspeitas ficam fora
  desse critério e o log diz quantas ("100% do que o alvo aceitou"). O tocador pega fala nova
  sem reiniciar o coletor: um `Voz` novo por partida abre o pacote de novo e o `Pacote.relido()` relê o índice que
  mudou antes de cada fala (nunca no meio). Log: `dados\voz-agendada.log` (rotação 256 KB × 3); última rodada em
  `dados\voz-agendada.json`.
- **Moldura** (`coletor\moldura.py`): janela própria de tela inteira, click-through
  (`WS_EX_LAYERED|TRANSPARENT|TOPMOST|TOOLWINDOW|NOACTIVATE`), borda pulsando + rótulo no canto por
  2 s, só com "League of Legends (TM) Client" em primeiro plano, e **fora do print**
  (`WDA_EXCLUDEFROMCAPTURE`, [ARMADILHAS](ARMADILHAS.md) § Tela).

| o quê | comando |
| --- | --- |
| falar uma frase | `python -c "from coletor.voz import falar; falar('teste do coach')"` |
| mostrar um alerta | `python coletor\moldura.py vermelho "jungler rio top" --forcar` |
| provas | `python tools\teste-coach.py` (anti-spam + replay da partida gravada), `python tools\teste-alertas.py` |
| pacote de voz: estado, tarefa | `python tools\voz-agendada.py estado` · `... instalar` (refaz/reativa) · `... remover` |
| pacote de voz à mão (jogo fechado) | `%LOCALAPPDATA%\lol-client\voz\venv\Scripts\python.exe tools\gerar-pacote-voz.py --voz aoede` |

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
- **Como o F9 funciona** (só `RegisterHotKey`: escuta, nunca manda tecla ao jogo): o F9 fica registrado a
  partida inteira; apertar arma por **2 s**, e só nesses 2 s o 1..5 é do coach (fora deles é tecla de
  item do jogo). 1 top, 2 jungler, 3 mid, 4 atirador, 5 suporte = "ele acabou de usar o Flash" (sem Flash,
  o outro feitiço com recarga); o mesmo número de novo em ≤ 10 s desfaz. `Feiticos.marcar(n)` devolve
  `marcado`/`desfeito`/`sem_inimigo`/`sem_feitico` + a rota da fala (`ROTA_FALA`), e o coach responde pelo
  `MotorAvisos` (tipo `feitico_marcado`, `avisos.aviso_atalho`; nunca vermelho, vermelho é perigo):

  | evento | moldura (rótulo, cor) | voz |
  | --- | --- | --- |
  | F9 armado | "flash: 1-5", azul | — |
  | marcado | "<rota> sem flash", verde | "flash do <rota> marcado" (descontraído: "anotado: <rota> sem flash") |
  | desfeito | "marcação desfeita", azul | "marcação desfeita" |
  | sem inimigo na posição (treino) | "sem inimigo", azul | — |

  Rota da fala genérica (top, jungler, mid, atirador, suporte; "inimigo" quando a Live Client não deu a
  posição dele, porque aí a ordem é a do `allPlayers` e a rota da tecla seria mentira), nunca nome de
  campeão. Com um alerta na tela (gank vermelho), o retorno da moldura espera ele acabar. A voz e a tela do
  retorno se calam na seção LOL-CLIENT como qualquer tipo. No log: `atalho: F9 registrado`, `atalho: F9
  recebido`, `atalho: F9 + n recebido`, `coach: F9+n -> <resultado>` (o F8: `overlay: F8 registrado`,
  `overlay do minimapa ligado/desligado (F8)`). Sem a linha "recebido" depois de apertar = a tecla não
  chegou ao `RegisterHotKey` ([ARMADILHAS](ARMADILHAS.md) § Windows). Fora da partida:
  `python coletor\feiticos.py --sonda 30` imprime cada F8/F9 que o Windows entrega.
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
| 1ª fase com client (lobby, champ select, fim) | `aquecer_estatico`: monta/confere `dados\cache\jogo-estatico.json` em thread (uma vez por processo; falhou = de novo na próxima fase após 60 s), para a 1ª partida já ler o cache (loga "dado estático pronto antes da partida") |
| champ select (cada sessão) | `draft.Draft.analisar_sessao` → `GET /draft`; `GET /draft/<meu campeão>` junta `matchups` (`analise.matchups`) e `traumas` dele contra os inimigos travados (cache de 10 min por campeão): é o que o selo do plugin lê |
| `InProgress`/`Reconnect` | processo **abaixo do normal**; laço ao vivo (`AoVivo`, só um ouvinte para sempre); por partida: `MotorAvisos` + `GatilhosLive` (voz, moldura, faixa do painel), `Captura` do minimapa + `EstadoJungler`/`GradeViva` + overlay, `Feiticos` + OCR do chat a cada 3 s + atalho F9, `PicosDeForca`, dado estático (cache; a LCU refaz por patch em thread); janela do painel |
| carregamento (Live Client com `gameTime` ~0) | `Carregamento.verificar` (Riot API, uma vez por partida) → `carregamento` no `/estado`; `bloco_carregamento` → `composicao`; runas do spectator → `Feiticos.definir_runas` |
| jogo, a cada leitura (1 s) | avisos da Live Client, `AlertasPosicao` sobre as detecções (com os eventos: torres e inibidores), jungler (gank pelo `avisos.decidir_gank`: a rota onde estou e, com aliado nela, as outras), feitiços que voltaram e picos de força → motor, `preparo_objetivo`, item curado do [ITENS](ITENS.md) no lugar do genérico; uma previsão do jungler a cada 10 s |
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
dois, no arquivo salvo e no `POST`), `aceiteFlutuante` e `aceiteAtrasoS` (§ Aviso de partida), e as escolhas das
regras de aviso (§ Avisos ao vivo, "Escolhas"): `gankOutraRota`, `junglerLonge` (`painel`|`tudo`|`nada`),
`midSumiuFiltro`, `cortarFalaRepetida`, `overlayCor` (`vermelho`|`laranja`|`roxo`), `overlayForca`
(`sutil`|`normal`|`forte`) e `overlaySuave`. O plugin manda `{"coach": {...cfg.coach, aceiteAtrasoS}}`
(`coach.corpoConfig`: o atraso efetivo do aceite, derivado na hora e nunca salvo no plugin) na carga, a
cada mudança e, com o coletor fora, de novo a cada 30 s (`pengu/coach.js`); chave desconhecida, de tipo
errado ou valor fora da lista é ignorada (volta ao padrão), no `POST` e, desde 14/10/2026, também na leitura do
arquivo (`servidor_local.ESCOLHAS`). Depois que o jogo sai da tela, um `POST /config`
não religa captura nem OCR daquela partida.

**Modo vitrine** (`coletor\vitrine.py`; `python tools\vitrine.py ligar|estado|desligar`): prints que mostram o
overlay e a moldura funcionando, que o print comum nunca vê (`WDA_EXCLUDEFROMCAPTURE`, ARMADILHAS § Tela).
`ligar` grava `dados\vitrine.json` (marca na pasta do banco: ensaio e testes, com banco em `temp\`, nunca a
consomem), válida 3 h até a partida começar; a partida consome e o fim dela apaga (coletor que caiu no meio
retoma na mesma partida; reinício limpo do coletor encerra a vitrine). A mesma partida recomeçada dentro do processo
(Reconnect, `AoVivo` morto, fase relida) segue gravando: o coach só apaga a marca com outro `game_id` ou no fim; marca
consumida sem `game_id` (GET da sessão falhou no `InProgress`) é adotada pela partida que vier com id. `ligar` com uma
partida gravando (marca consumida há < 2 h) recusa (rc 1); o fim de uma partida só apaga a marca que ela consumiu.
Vale só com o coletor iniciado com estes ganchos. Ganchos: `OverlayMinimapa.ao_desenhar(img, ret, quadro)` a cada quadro mostrado (com a imagem parada, o quadro da tela a cada 400 ms) e
`Moldura.ao_mostrar(cor, rotulo, geo, espessura)` a cada alerta; só enfileiram, a thread `vitrine` faz o resto:
jogo **já** em primeiro plano (`minimapa.janela_do_jogo_em_primeiro_plano`; nunca traz janela para a frente) →
print `mss` → primeiro plano conferido de novo (alt-tab no meio = descartado) → composição com o pixel desenhado (overlay: o quadro RGBA que a janela mandou ao `UpdateLayeredWindow`,
composto pela mesma conta, `overlay_minimapa.compor_sobre`; moldura: `moldura.renderizar`, a mesma rotina GDI da
janela, alfa 255 = início do pulso).
Saída em `temp\vitrine\<data>\`: `*-minimapa-composto.png` (mapa + 40 px de margem) e `*-camada.png` (RGBA exata),
`*-moldura-<cor>-tela.png` (tela inteira em 1280 px, chat medido, canto de baixo à esquerda e topo central
pixelados antes de compor), `vitrine.jsonl` (gameTime, tipo, aviso, rótulo, `revisao_privacidade: "pendente"`) e
`LEIA-ME-privacidade.txt`. No máximo 1 print a cada 90 s por tipo (`overlay-calor`, `overlay-texto`,
`moldura-<cor>`) e 25 por partida; falha de disco ou `mss` só loga. O recorte usa o monitor que contém a
região (lista do `mss`, não o `monitor_do_jogo` do game.cfg, que com 2 telas pode errar); região fora de todo
monitor é logada e espera o intervalo do tipo. Custo medido no fio de quem chama: gancho < 0,1 ms com a tela
inteira; laço de 50 ms em paralelo atrasou no pior 2,8 ms (o ensaio não liga a vitrine). Prova:
`python tools\teste-vitrine.py`.

**Ensaio** (`python tools\ensaio-coach.py`): o `Coletor` com LCU falsa + o simulador tocando a partida
3292746609 inteira (carregamento, 30 s a 1x, o resto a 10x), banco copiado em `temp\ensaio\` (a partida
chega pelo backfill no `EndOfGame`), portas 8766/2996. Som, tela, teclado e rede trocados por registros
(lista no cabeçalho do script); minimapa e OCR rodam de verdade sobre os prints gravados. Medido em
13/10/2026: CPU do processo 2,5–2,8% de um núcleo a 1x (passo do laço p50 0,9 ms; fora da conta: o
minimapa a 6 fps, que a frente mediu em ~5%, e os PowerShell filhos de voz e OCR, abaixo do normal), ~11%
a 10x (p95 4,8 ms, máx ~300 ms no Dijkstra do jungler; na rodada do fechamento 3,2% / 12,0%, p95 5,4 ms e um
passo de 1229 ms); 29–31 falas em 33 min, nenhuma chave repetida,
menor intervalo 20,0 s; aviso de dragão 60 s antes nos 5; `EndOfGame` desliga em < 0,1 s e não sobra
thread; `dados\` intocado. Prints do painel em `temp\ensaio\painel-*.png`. O `temp\ensaio\relatorio.json` conta
falas **e molduras** por tipo, os `suprimidos` do motor e os "mid sumiu" calados por motivo (14/10/2026).

**Plugin contra um coach de verdade** (`python tools\servidor-teste-plugin.py [--fixture]`): `Coach` com mentor
real na 8765, banco copiado em `temp\pengu\` e config em `temp\pengu\config.json`; lê o champ select da LCU (só
GET). Serve para provar selo, pós-jogo e a seção LOL-CLIENT com o coletor real ainda no código antigo (sem a
8765); com o coletor novo de pé a porta está ocupada e ele sai.

## Aviso de partida fora do client (`coletor\aviso_partida.py`, plano voz/foco, passo 2b)

No `ReadyCheck`, o `Coletor.fase` abre uma janelinha Win32 (ctypes, como a `moldura.py`) no canto inferior direito da tela principal (área
útil, acima da barra de tarefas): "partida encontrada", a contagem e dois botões, **aceitar agora**
(`POST /lol-matchmaking/v1/ready-check/accept`) e **recusar** (`.../decline`). Qualquer outra fase fecha;
ela também se fecha sozinha em 20 s (o ready check dura 12), caso o websocket caia no meio.

- **Sem roubar o foco:** nasce escondida com `WS_EX_NOACTIVATE | WS_EX_TOPMOST | WS_EX_TOOLWINDOW`, aparece
  só por `SetWindowPos(SWP_NOACTIVATE | SWP_SHOWWINDOW)` e responde `MA_NOACTIVATE` ao clique. Não é Tk: o Tk
  ativa a própria janela ao nascer ([ARMADILHAS](ARMADILHAS.md) § Windows). DPI por thread
  (`SetThreadDpiAwarenessContext`), não no processo. Cores do `painel\painel.css`; botões desenhados (GDI),
  com mão e realce ao passar o mouse.
- **Contagem:** com `aceiteAtrasoS` = número, "aceito em N s" até `min(atraso, 10)` pelo `timer` do
  `GET /lol-matchmaking/v1/ready-check` (o mesmo alvo do `pengu\aceite.js`); com `null` (aceite automático
  desligado), "expira em N s" até os 12 s. O `timer` é inteiro: a janela ancora o início pelo menor
  `agora − timer` e conta pelo relógio local (o 1º GET pode dar 404 antes do payload).
- **O espelho pode mentir:** o `aceiteAtrasoS` é o último que o plugin mandou (plugin fora do ar, POST que nunca
  chegou). Passado o alvo + `FOLGA_S` (0,7 s) com `playerResponse` ainda `None`, a reserva aceita (abaixo); se ela
  também não aceitar (POST falhou), volta a "expira em N s" com o alerta vermelho "o aceite automático não veio:
  clique" (fase `sem_aceite`). Com "não aceitar" do plugin nesta vez, a janelinha só conta até expirar, sem alerta.
- **Depois do clique:** "aceita" (+ "esperando os outros") ou "recusada", sem botões; um POST por ready
  check; POST que falha devolve os botões com "o client não respondeu".
  O aceite automático do plugin respeita o recusar: ele para com `playerResponse` `Declined` e, antes de
  aceitar, relê o ready check e só aceita com `None`.
- **Config:** `aceiteFlutuante` (padrão `true`) e `aceiteAtrasoS` (número 0–60 ou `null`; padrão 10 =
  `PADRAO.aceite.atrasoS` do plugin, que manda o valor espelhado). Lidas na hora do `ReadyCheck`. Com
  `aceiteFlutuante` `false` e o aceite ligado, a reserva roda sem janela (`AvisoPartida(janela=False)`).

### Quem aceita: o plugin primeiro, a reserva do coletor depois (14/10/2026)

O `pengu\aceite.js` aceita no alvo `min(atrasoS, limiteS − 2)` (10 s de 12). O JS do client pode não agir (caso de
14/10/2026 em [ARMADILHAS](ARMADILHAS.md) § Client e Pengu), então a consulta da janelinha (`AvisoPartida`, Python,
não congela com o client) tem uma **reserva**: passado o mesmo alvo + `FOLGA_S` (0,7 s), ela relê
`GET /lol-matchmaking/v1/ready-check` e só faz `POST .../accept` com `state` `InProgress` e `playerResponse` `None`.
Uma tentativa por ready check; log `aceite pela reserva do coletor (plugin não aceitou; N s do ready check; último
sinal do plugin há N s | nenhum sinal do plugin)` ou `reserva do aceite: não agiu (<motivo>; N s)` (ex.: `já aceita;
10.1 s` = o plugin aceitou a tempo).

- **Só arma com a rota do plugin no ar:** sem coach (`--sem-coach`) ou com o servidor local fora do ar (porta 8765
  ocupada), o "não aceitar" não teria por onde chegar, então `coletor._sinal_aceite` devolve `None`, o log diz
  `reserva do aceite desarmada: sem rota do plugin` e a janelinha (se ligada) abre só com os botões (`reserva=False`).
- **Não age:** aceite automático desligado no espelho (`aceiteAtrasoS` `null`), "não aceitar" do overlay do plugin ou
  aceite desligado nele **neste** ready check (sinal recebido até 1 s antes do início dele, ancorado no `timer` da
  LCU; o coletor zera ao sair da fase; `ligado true` atrasado não destrava, só o `fim`), `Accepted`/`Declined`, ready
  check fora de `InProgress` ou releitura que falha (404 = acabou), clique da janelinha em voo, "recusar" da janelinha
  cujo POST falhou, **outro ready check** na mesma instância (`timer` que volta ou 404 entre dois payloads: falha
  fechada, log `não agiu (outro ready check; …)`). Alvo = o mais tardio entre o espelho e o último `atrasoS` do plugin.
- **Aviso recém-nascido** (coletor que sobe ou reconecta com o alvo + folga já passado): espera `IDADE_MIN_S` (1,5 s)
  de vida antes do POST, tempo de chegar ao menos um evento do plugin (~1/s) com o "não aceitar".
- **Limite:** o "não aceitar" vai a cada evento do plugin (~1/s), então um POST perdido não basta para a reserva
  errar; o furo real é a rota fora do ar, que desarma a reserva (acima).
- **Folga 0,7 s** (`aviso_partida.FOLGA_S`, a mesma da tela). Medido no `dados\medicao-compacto-2026-10-13.jsonl`
  (ready check de 14/10 10:10:21): o evento com `timer` 10 chega ~9,8 s depois da fase, o `timer` 12 em ~+12,0 s e a
  fase sai em ~+13,0 s. Estimado, não medido: o aceite do plugin visível no GET até ~+10,4 s (13/10: aceitou com
  `timer` 10,0 em 3/3, mais uma consulta). Agir depois de ~10,5 deixa a releitura ver o aceite do plugin; antes de
  ~11,5 o POST chega antes do `timer` 12. A consulta acorda na hora do alvo + folga, mas o início é ancorado no
  `timer` inteiro com consulta a cada 0,5 s: a reserva age entre ~10,7 e ~11,2 s reais do ready check (nunca antes
  de 10,7: `agora − timer` nunca é anterior ao início real).
- **POST duplicado com o plugin:** a releitura logo antes do POST estreita a janela, mas o GET pode levar até 2 s
  (prazo dele); o que a LCU devolve a um 2º accept não foi medido (proibido testar accept no client real). Qualquer
  erro do POST vira log + botões de volta. O POST da reserva tem prazo de 3 s (`POST_RESERVA_S`).

### Sinal e diagnóstico do plugin (`POST /aceite/plugin`)

O `aceite.js` manda ao coletor (`coach.coletor`, prazo 1,5 s, nunca esperado) cada decisão: `evento` (cada payload do
ready check, com `timer` e `playerResponse`), `agendou` (`emS`), `aceitando`, `post` (`status` da LCU), `nao-aceitou`
(motivo), `nao-aceitar` (overlay), `fim`, `foco` e `foco-lcu` (minimizar/mostrar e o status). Todo corpo leva `ligado`,
`atrasoS`, `limiteS`, `desligadoNestaVez`, `hidden`, `visibilityState` e `foco` (`document.hasFocus()`). O coletor
guarda o que serve à reserva (`aviso_partida.SinalPlugin`) e grava uma linha `aceite (plugin): evento=… timer=…` no
`dados\coletor.log` (só as chaves de `CAMPOS_DIAG`): ready check sem nenhuma linha `aceite (plugin)` = o JS do plugin
não estava vivo. Origem (`servidor_local.origem_aceite_ok`): só a página do client (`https://127.0.0.1:<porta da LCU>`),
o Pengu (`https://plugins`) ou sem `Origin`; as páginas do próprio coletor e outra página local em `http` levam 403.

| o quê | comando |
| --- | --- |
| ver a janelinha com um ready check falso | `python coletor\aviso_partida.py --demo [--atraso 10 \| -1] [--segundos 12]` |
| prova (contagem, config, `Coletor.fase`, reserva, rota `/aceite/plugin`, janela real; a janela é pulada com o jogo aberto) | `python tools\teste-aviso-partida.py [--sem-janela]` |
| prova do lado do plugin (decisão, foco, som, popup, aviso ao coletor injetado) | `node tools\teste-aceite.mjs` |

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
