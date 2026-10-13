# "Jogar de novo e buscar" no pós-jogo + freio de tilt + guarda de penalidade

- **Data:** 13/10/2026 · **Alvo:** `pengu/fila-rapida.js` (`jogarDeNovo`, `restricaoDura`), `pengu/posjogo/abas.js`
  (`htmlTopo`), `pengu/posjogo/index.js` (`acaoJogarDeNovo`), `pengu/config.js`, `pengu/configuracoes.js`, teste
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
2. Freio de tilt (`filaRapida.freioTilt`, padrão 0 = desligado; o Gabriel ainda escolhe o limiar): com N derrotas
   seguidas na sessão (pausa < 2 h), o 1º clique só pede confirmação. Histórico incompleto = sequência incerta →
   pede confirmação (não chuta 1).
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
3. [ ] **Freio:** o Gabriel escolhe o limiar (`dono: gabriel`; padrão 0 até lá).

## Decisões técnicas (revisão de 13/10/2026)

- `canStartActivity` false sem restrição não recusa (o erro da própria busca aparece). Confiança média; reverteria
  se a prova mostrar busca recusada pelo client sem mensagem útil.
- Fila do painel ≠ `lastQueuedLobbyStatus.queueId` → recusa. Não medido se as duas batem em Swiftplay e Arena; se
  não baterem, o efeito é um toast de recusa, nunca busca na fila errada.
- Texto de recusa diz o que foi feito ("saí da tela de fim de partida…"), não "nada foi feito".

## O que o pedido não dizia

- **Freio com histórico incompleto pede confirmação:** chutar "1 derrota" desligaria o freio justo quando o dado falta.
- **Botão só no painel do fim de partida:** o do Ctrl+K pode ser de outra partida.
- **Recusa em vez de busca errada:** fila diferente, penalidade ou lobby que não voltou nunca viram busca.

## Relatório de execução

- **13/10/2026 (sem client):** código e 34/34 no teste com LCU falsa; `tools/rodar-testes.py` inclui o teste. Prova no
  client pendente (passo 2).
