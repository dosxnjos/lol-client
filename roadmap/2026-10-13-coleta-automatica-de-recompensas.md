# Coleta automática de recompensas

- **Data:** 13/10/2026 · **Alvo:** plugin Pengu (`pengu/recompensas.js` novo, `pengu/config.js`, `pengu/blocos.js`,
  `pengu/index.js`), teste `tools/teste-recompensas.mjs` · **Depende de:** nada (o coletor não muda)

## Pedido (Gabriel, 13/10/2026)

> Tem como termos um auto-collect de recompensas dos diferentes eventos que aparecem? Eu não sei como é
> que você faria o gatilho para ver se tem recompensa coletável, mas enfim, precisaria ser dinâmico,
> porque eu acho que tem diferentes tipos de recompensa. […] de repente poderia ser após cada partida e
> ao abrir o client.

## Fatos levantados (13/10/2026, client aberto, pelo CDP, só leitura)

A LCU tem 1.447 funções (`GET /help?format=Console`). As de coleta e o estado da conta hoje:

| fonte | leitura | coleta | estado em 13/10 |
| --- | --- | --- | --- |
| concessões de recompensa | `GET /lol-rewards/v1/grants` | `POST /lol-rewards/v1/grants/{grantId}/select` (corpo: ids escolhidos) e `POST /lol-rewards/v1/select-bulk` | **60 pendentes** (`PENDING_SELECTION`), de 27/10/2025 em diante; em **todas** o número de itens = `maxSelectionsAllowed` (não há escolha de verdade). Tipos: `cap.wallets` 34, `loot.lootserver` 18, `cap.entitlements` 6, `store.purchase` 2 |
| trilha de recompensas dos eventos | `GET /lol-event-hub/v1/events` e `.../events/{id}/reward-track/unclaimed-rewards` | `POST /lol-event-hub/v1/events/{id}/reward-track/claim-all` | 5 eventos; 2 com prêmio parado (2 + 1), um deles "Temporada 3: Mundial 2026" |
| missões | `GET /lol-missions/v1/missions` | `PUT /lol-missions/v1/player/{missionId}` (`rewardGroups`) | 202 missões, 32 `COMPLETED`; falta saber se alguma `COMPLETED` tem prêmio por pegar ou se o prêmio já virou concessão (linha 1) |
| marcos do loot | `GET /lol-loot/v1/milestones` | `POST /lol-loot/v1/milestones/{id}/claim` | vazio |
| maestria, honra | `GET /lol-champion-mastery/v1/reward-grants`, `GET /lol-honor-v2/v1/reward-granted` | `POST /lol-honor-v2/v1/reward-granted/ack` | vazio |
| TFT (passe) | `GET /lol-tft-pass/v1/active-passes` | `PUT /lol-tft-pass/v1/pass/{id}/milestone/claim-all-rewards` | não lido (TFT fica escondido) |

Referência de terceiro (lida em 13/10, plugin `autoClaimPassReward.js` de Elaina Da Catto, na pasta de
plugins antigos do Gabriel): `POST /lol-rewards/v1/grants/{info.id}/select` com corpo
`{rewardGroupId: info.rewardGroupId, selections: [ids de rewardGroup.rewards]}`, disparado ao abrir a
central de atividades ou o pós-jogo. Ele seleciona **todos** os itens, inclusive quando é "escolha 1 de N"
(defeito que este plano evita). Os nomes das funções vêm do `/help`; o formato exato dos corpos de `select`, `select-bulk` e `PUT
/lol-missions/v1/player/{id}` se confirma na 1ª coleta real, com 1 item, antes do lote.

## Decisões

- **Mora no plugin**, não no coletor: o plugin já roda dentro do client, tem a LCU sem credencial e vê o
  gameflow. Gatilhos: ao carregar o client (depois de `GET /lol-gameflow/v1/gameflow-phase` responder) e
  em cada `EndOfGame` → `None`/`Lobby` (30 s depois, para o servidor creditar o prêmio da partida).
- **Só coleta sem escolha.** Concessão com `maxSelectionsAllowed` < número de itens (escolher 1 de 3) **não
  é coletada**: vira aviso no client ("recompensa para escolher em …") e a escolha é do Gabriel.
- **Nunca gasta nada.** Nada de abrir baú, criar, desencantar (`/lol-loot/v1/recipes/*`,
  `craft-mass`), comprar na loja de fichas do evento (`token-shop`) ou passe. Coletar ≠ gastar.
- **Uma por vez, com intervalo** (≥ 300 ms) e registro: cada coleta vira uma linha no console do plugin e
  uma notificação curta no client ("3 recompensas coletadas"). Falhou → tenta de novo só no próximo gatilho.
- **TFT:** chave separada, desligada por padrão (o TFT fica escondido no client dele).
- Chave geral `recompensas` em Configurações › LOL-CLIENT, padrão **ligada** (foi pedido).

## Passos

1. [ ] Leitura de prova (sem coletar): função `levantar()` que devolve tudo o que está pendente por fonte,
   com o motivo de pular cada item. **prova:** `node tools/cdp.mjs eval` mostra a lista que bate com a tabela.
2. [ ] Coleta de **1** item de cada fonte com o client aberto, conferindo o efeito na leitura seguinte
   (o item sai da lista). Registrar aqui o corpo que funcionou. **prova:** antes/depois.
3. [ ] **Código pronto (13/10/2026), falta prova no client** (passos 2 e 4). `pengu/recompensas.js` (gatilhos, filas, regras acima) + chave em `config.js`/`blocos.js` + `index.js`.
   **prova:** `tools/teste-recompensas.mjs` com LCU falsa: coleta sem escolha, pula escolha real, não chama
   nenhuma rota de gasto, um erro não para o resto, gatilho no carregamento e depois do `EndOfGame`.
4. [ ] Rodada real: carregar o client → 60 concessões + 3 do evento coletadas; o client não mostra mais as
   celebrações paradas. **prova:** leitura do passo 1 zerada (menos as de escolha).
5. [ ] Docs: README (o que coleta e o que nunca faz), `docs/ARMADILHAS.md` (o que a coleta real revelou),
   este plano com o relatório. Commit por pathspec + push.

## O que o pedido não dizia

- **Escolha de verdade fica com ele:** coletar sozinho "1 de 3" seria decidir por ele.
- **Nunca gastar:** baú, criação e loja de fichas parecem "coletar", mas consomem recurso.
- **Esperar o crédito da partida:** sem os 30 s, a coleta pós-jogo rodaria antes de o prêmio existir.
- **TFT separado e desligado:** ele esconde o TFT.

## Descartado e impraticável

- **Coletar no coletor Python:** duplicaria a LCU e o gatilho que o plugin já tem · agente.

## Relatório de execução

- **Passo 3 (13/10/2026, sem coleta real):** `pengu/recompensas.js` com a lista de rotas de escrita permitidas
  (`ROTAS_COLETA`: select de concessão, `claim-all` da trilha, `claim-all-rewards` do TFT; qualquer outra escrita
  é recusada antes do fetch). Gatilho pós-jogo relê a fase na hora e adia fora de `None`/`Lobby` (o "jogar de
  novo" leva direto à fila). Aviso de escolha uma vez por concessão por sessão do client. Missões, marcos do
  loot, maestria e honra ficam fora (formato não confirmado ou vazio). `node tools/teste-recompensas.mjs` 24/24.
- Leitura de 13/10 (GET, client aberto): 60 concessões pendentes (1/1 e 2/2, nenhuma escolha real), trilha dos 5
  eventos com `rewardsCount` 0 (as 3 paradas da tabela já não estão), passe do TFT com 1 `REWARDABLE`.
- `window.__lolClient.recompensas.levantar()` é o passo 1 (só GET). Passos 1, 2, 4 e 5 seguem com o orquestrador.
- **Revisão do passo 3 (13/10/2026, sem coleta real):** o passo 2 virou código (`planejarColeta`): por sessão do
  client, a coleta manda **1 item de cada tipo de entrega** (`concessão:cap.wallets`, `loot.lootserver`,
  `cap.entitlements`, `store.purchase`…); na rodada seguinte, o item fora da lista libera o tipo; ainda pendente apesar
  do 2xx trava o tipo até recarregar (toast vermelho). Leitura que falha não conta como prova. Trilha e passe liberam
  no 2xx (o id volta a ter prêmio depois de outra partida). Concessão sem `maxSelectionsAllowed` numérico vira
  "escolher". Antes do `claim-all` da trilha, lê `/reward-track/items` e `/bonus-items`: marco com mais de uma opção e
  nenhuma `selected` manda o evento para "escolher"; leitura que falha pula o evento. Toast de falha uma vez por
  recompensa; depois de `MAX_FALHAS` = 3 falhas ela sai da fila da sessão. `node tools/teste-recompensas.mjs` 39/39.
- **Leitura da revisão (13/10, só GET):** 57 concessões pendentes em 4 tipos (`cap.wallets` 34, `loot.lootserver` 17,
  `cap.entitlements` 4, `store.purchase` 2), nenhuma sem máximo nem escolha de verdade; trilhas dos eventos zeradas.
  Logo, a próxima carga do client manda **4 selects e nenhum claim-all**; o resto vai na rodada seguinte (30 s depois
  da próxima partida ou `__lolClient.recompensas.rodar()`). O atraso da LCU para tirar o item da lista não foi medido:
  rodada manual cedo demais pode travar o tipo até recarregar.
- **Fechamento da leva (13/10/2026):** README (o que coleta e o que nunca faz) e `docs/ARMADILHAS.md` (grants, trilha
  "Locked", 2xx não prova) atualizados; `python tools/rodar-testes.py` com o jogo fechado (resultado no plano de
  [voz e foco](2026-10-13-voz-pregravada-e-foco.md) § Relatório). Passos 2 e 4 dependem do client.
