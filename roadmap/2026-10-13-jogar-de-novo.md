# "Jogar de novo e buscar" no pós-jogo + freio de tilt + guarda de penalidade

- **Data:** 13/10/2026 · **Alvo:** `pengu/fila-rapida.js` (`jogarDeNovo`, `restricaoDura`), `pengu/posjogo/abas.js`
  (`htmlTopo`), `pengu/posjogo/index.js` (`acaoJogarDeNovo`), `pengu/freios.js`, `pengu/config.js`, `pengu/configuracoes.js`, teste
  `tools/teste-jogar-de-novo.mjs` · **Depende de:** fila rápida da v1 ([v1](2026-10-13-lol-client-v1.md))
- **Origem:** síntese das referências de terceiros de 13/10 (itens a, b, d, e), aprovada pelo orquestrador. Irmão de
  [voz e foco](2026-10-13-voz-pregravada-e-foco.md) (aceite, foco, som) e da
  [coleta de recompensas](2026-10-13-coleta-automatica-de-recompensas.md) (gatilho pós-partida).

## Entendimento

No fim da partida o Gabriel quer voltar à fila com um clique, na **mesma fila** da partida anterior e com as posições
dele, sem passar pela tela de estatísticas e pelo lobby. O botão fica no topo do painel do pós-jogo.

## Linha que não se cruza

- Busca **só por clique** do Gabriel; nunca buscar sozinho ao cair no `Lobby`.
- Nunca interceptar o botão animado do Ember nem usar `el.click()`: tudo pela LCU.
- Nunca tocar no `bustedLeaverAccessToken`; penalidade vira recusa com código e prazo.
- Teste automatizado nunca chama `POST .../matchmaking/search` de verdade (LCU falsa sempre).

## Fluxo (`fila-rapida.jogarDeNovo(cfg, opcoes)`)

1. Lê a fase: só `EndOfGame`, `Lobby` ou `None`.
2. Freios (`pengu/freios.js`, os mesmos na fila rápida): tilt (`filaRapida.freioTilt`, padrão 2) com N derrotas
   seguidas na sessão (pausa < 2 h) e madrugada (`filaRapida.freioMadrugada`, padrão ligado) entre 01:00 e 05:59: o 1º
   clique só pede confirmação, o 2º em até 8 s busca. Histórico incompleto = sequência incerta → pede confirmação
   (não chuta 1).
3. `GET /lol-gameflow/v1/gameflow-metadata/player-status` → `lastQueuedLobbyStatus` (`queueId`, `isLeader`,
   `allowedPlayAgain`, `memberSummonerIds`). Fila da partida do painel diferente dessa `queueId` → recusa sem escrever
   (personalizada, treino ou fila trocada).
4. Em `EndOfGame`: `POST /lol-lobby/v2/play-again` se `allowedPlayAgain`; senão (ou se falhar)
   `POST /lol-end-of-game/v1/state/dismiss-stats`. Espera a fase virar `Lobby`/`None` por até 15 s; senão recusa
   ("saí da tela de fim de partida, mas o lobby não voltou a tempo: não busquei").
5. Grupo ou não-líder: para aqui com toast "o líder busca".
6. Revalida a fase; sem lobby ou fila diferente → `POST /lol-lobby/v2/lobby` com a mesma `queueId` (fila fora de
   rotação → recusa). Posições do cfg só nas filas com posição (420, 440, 400).
7. Relê o lobby: `canStartActivity === false` **e** item em `restrictions[]` → recusa com `restrictionCode` e prazo.
   Sem restrição a busca sai (logo depois do POST/PUT o flag pode ainda não ter assentado; não medido).
8. `POST /lol-lobby/v2/lobby/matchmaking/search` → fecha o painel.

O botão só aparece no painel aberto pelo `EndOfGame` (`abrirPainel(..., {fimDePartida: true})`): o painel do Ctrl+K
pode ser de partida antiga, e o freio contaria a sequência errada. A mesma guarda de penalidade
(`restricaoDura`) entrou no `prepararLobby` da fila rápida (item b). O gatilho pós-partida das recompensas relê a fase
na hora e adia fora de `None`/`Lobby`, porque o jogar de novo leva direto a `Matchmaking`/`ReadyCheck` (item e).

## Passos

1. [ ] **Código e teste offline:** feito em 13/10/2026 (código pronto, falta prova no client).
   `node tools/teste-jogar-de-novo.mjs` 34/34 com LCU falsa: play-again, dismiss-stats, espera, grupo, não-líder,
   penalidade, fila fora de rotação, fila diferente da partida, freio (incluindo sequência incerta), posições só nas
   filas com posição. O controle do botão no DOM (só no painel do `EndOfGame`) não tem teste em node.
2. [ ] **Prova no client** (com o Gabriel, fim de uma partida real de solo/duo): o botão aparece só no painel do fim
   de partida; o clique volta à fila 420 com as posições do cfg; o painel fecha. Em grupo: só volta ao lobby e o
   toast diz que o líder busca.
3. [x] **Freio:** decidido pelo Gabriel em 13/10/2026 (abaixo) e implementado no mesmo dia, sem client. Prova:
   `node tools/teste-jogar-de-novo.mjs` 75/75 (madrugada às 01:00 e 05:59 pede, 06:00 e 00:59 não; tilt 2 e os dois
   juntos nos dois botões; 2º clique em até 8 s busca uma vez, depois de 8 s pede de novo e não busca; sem 2º clique
   nada escreve; sequência da fila rápida com cache velho = "não sei") e `node tools/teste-config.mjs` 23/23
   (migração 0 → 2 uma vez só, gravada com a marca; desligar depois fica 0). Falta a prova no client (passo 2).

## Decisão do Gabriel: freio de tilt em 2 e freio por horário (13/10/2026)

> "pode seguir com 2, com freio por horário"

Evidência que ele viu (MCP `tilt`, 174 partidas no Rift), winrate da partida seguinte:

| antes da partida | winrate |
| --- | --- |
| nenhuma derrota | 50,9% |
| 1 derrota | 53,7% |
| 2 derrotas seguidas | 43,8% (16 partidas) |
| 3+ derrotas seguidas | 71,4% (7 partidas, ruído) |

| faixa (hora local) | winrate |
| --- | --- |
| 00–06 | 47,1% (70 partidas) |
| 06–12 | 58,8% |
| 12–18 | 58,5% |
| 18–24 | 50,0% |

O que entrou: padrão `freioTilt` 2 (config salva com 0, o padrão antigo que ele nunca escolheu, migra para 2 uma vez
só: `config.migrar`, marca `versao: 2`); `freioMadrugada` (padrão ligado) entre 01:00 e 05:59 na hora do PC; os dois
nos dois botões que buscam (fila rápida e jogar de novo), com o mesmo mecanismo (`freios.cliqueComFreio`); texto com
o número medido, vindo de `freios.MEDICAO` (um lugar só, com a data).

## Decisões técnicas (revisão de 13/10/2026)

- `canStartActivity` false sem restrição não recusa (o erro da própria busca aparece). Confiança média; reverteria
  se a prova mostrar busca recusada pelo client sem mensagem útil.
- Fila do painel ≠ `lastQueuedLobbyStatus.queueId` → recusa. Não medido se as duas batem em Swiftplay e Arena; se
  não baterem, o efeito é um toast de recusa, nunca busca na fila errada.
- Texto de recusa diz o que foi feito ("saí da tela de fim de partida…"), não "nada foi feito".
- **Freios (13/10/2026, depois da decisão do Gabriel):**
  - os dois freios ao mesmo tempo = uma confirmação só, com as duas frases; um 2º clique confirma os dois. Confiança
    alta; reverteria se ele pedir um clique por freio;
  - com 3+ derrotas o texto cita as derrotas dele e o número medido para 2 ("3 derrotas seguidas: depois de 2 teu
    winrate já cai para 44%"): o 71% de 3+ é ruído (7 partidas) e não vira texto;
  - fila rápida sem `p.r.sessao`: a sequência sai do cache de histórico do `champselect.js` (já lido 5 s depois de
    abrir o client), sem ler 200 partidas a cada clique. Partida do Rift que acabou e ainda não está no cache → relê
    com prazo de 4 s; não apareceu → "não sei" (pede confirmação, a mesma regra do jogar de novo). Partida que não
    aparece em 10 min deixa de ser cobrada (TFT, modo que o histórico não traz). Confiança média: o client pode levar
    mais de 4 s para pôr a partida no histórico, e o 1º clique logo depois de uma vitória pediria confirmação "não sei"
    à toa; reverteria se a prova mostrar isso sempre;
  - janela do 2º clique: 8 s (era 10 s no jogar de novo), constante `JANELA_MS`; o relógio é injetável e o teste
    nunca usa `Date` real; a fase é conferida antes do freio na fila rápida (em partida recusa sem pedir confirmação);
  - madrugada usa 01:00–05:59 (pedido), não 00–06 da medição: a faixa 00–01 fica sem freio de horário.
- **Revisão adversarial dos freios (13/10/2026), 5 achados, todos corrigidos** (prova: `node tools/teste-jogar-de-novo.mjs`
  96/96, `node tools/teste-config.mjs` 27/27):
  1. *Fila rápida pedia "não sei" depois de quase toda partida* (o `champselect` relê 60 s depois do `EndOfGame` e a
     leitura leva até 40 s; o prazo era 4 s). Agora o resultado vem do `eog-stats-block` (evento do socket; sem ele em
     3 s, um GET) e entra como partida provisória até o histórico trazê-la (`criarSequencia.resultado`): vitória = 0
     sem ler nada, derrota soma à sequência do cache, a de verdade substitui a provisória. Sem resultado e cache sem a
     partida = `ATUALIZANDO` ("o histórico ainda não tem a última partida"), separado de "não carregou" (null).
     Formato do eog medido no banco do coletor (`teams[].isPlayerTeam/isWinningTeam`, `gameLength`,
     `endOfGameTimestamp`, `gameType`). Casos `eog: …` e `resultadoDoEog: …`. Confiança média: o evento do eog no
     socket do Pengu não foi visto no client (o coletor recebe pelo mesmo URI); o GET de 3 s cobre.
  2. *Duplo clique passava pelos freios*: 2º clique a menos de 700 ms de armar é ignorado (`freios.MIN_MS`,
     `confirmacao.cedo()`), a janela segue armada. Casos `… duplo clique …` e `2º clique aos 700 ms confirma`.
  3. *Não-líder/grupo recebia "buscar mesmo assim?"*: o freio do `jogarDeNovo` roda depois de ler o
     `player-status` (só GET) e só quando o caminho busca. Casos `não-líder de madrugada…` e `grupo de madrugada…`.
  4. *Treino deixava "não sei" por 10 min*: a partida só é cobrada se `contaNoFreio` (Rift, sem `isCustomGame`, fila
     fora de `FORA_DAS_CONTAS`); o eog gravado da ferramenta de treino é `CUSTOM_GAME`. Casos `contaNoFreio: …`.
  5. *Revert do plugin apagava a marca e a migração voltava por cima de um 0 escolhido*: a marca também fica numa
     chave própria do DataStore (`lol-client.versao`), que o código antigo não toca. Casos `revert: …` e `… marca de fora …`.
     Reverteria se a chave extra confundir alguém lendo o DataStore.

## O que o pedido não dizia

- **Freio com histórico incompleto pede confirmação:** chutar "1 derrota" desligaria o freio justo quando o dado falta.
- **Botão só no painel do fim de partida:** o do Ctrl+K pode ser de outra partida.
- **Recusa em vez de busca errada:** fila diferente, penalidade ou lobby que não voltou nunca viram busca.
- **Migração gravada na hora** (freios): se a config migrada só ficasse em memória, a migração rodaria a cada abertura
  até ele mexer em algo; gravando com a marca, o "desligar depois" vale desde o 1º recarregamento.
- **Cache velho não conta derrota a menos:** a partida que acabou de terminar precisa estar no histórico lido; senão
  o freio diz "não sei" em vez de contar 1 derrota quando são 2.
- **`window.__lolClient.derrotasSeguidas()`** (só leitura): o que o freio da fila rápida vê agora, para a prova no client.

## Relatório de execução

- **13/10/2026 (sem client):** código e 34/34 no teste com LCU falsa; `tools/rodar-testes.py` inclui o teste. Prova no
  client pendente (passo 2).
- **13/10/2026, freios (sem client):** `pengu/freios.js` novo (medição, madrugada, sequência, confirmação de 2 cliques);
  `fila-rapida.js` (`buscarFilaRapida`, `criarSequencia`, rótulo "buscar mesmo assim?" no botão), `posjogo/index.js`,
  `config.js` (padrão 2, `freioMadrugada`, migração com marca, Ctrl+K), `configuracoes.js` (caixa da madrugada),
  `champselect.js` (expõe o cache), `index.js`, `estilo.css`. Testes: jogar de novo 75/75, config 23/23. Prova no
  client pendente: o rótulo na barra e o toast, o 2º clique de verdade e a migração na config salva dele.
- **13/10/2026, revisão dos freios (sem client):** os 5 achados acima corrigidos; jogar de novo 96/96, config 27/27,
  `tools/rodar-testes.py` 31/31. Prova no client pendente, somada à de cima: depois de uma vitória a fila rápida busca
  no 1º clique (`window.__lolClient.derrotasSeguidas()` = 0 logo após o `EndOfGame`).
