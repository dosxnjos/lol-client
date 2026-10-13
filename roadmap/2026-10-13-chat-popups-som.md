# Chat do pós-jogo melhorado, avisos chatos calados e som do aceite ligado

- **Data:** 13/10/2026 · **Alvo:** `pengu/chat-posjogo.js` (novo), `pengu/sem-popups.js` (novo), `pengu/config.js`
  (migração do som), `pengu/configuracoes.js`, `pengu/index.js`, `pengu/estilo.css`; testes `tools/teste-chat-posjogo.mjs`,
  `tools/teste-sem-popups.mjs`, `tools/teste-config.mjs` · **Depende de:** aceite e som do plano
  [voz e foco](2026-10-13-voz-pregravada-e-foco.md) (passo 2c), padrão de migração do freio em
  [jogar de novo](2026-10-13-jogar-de-novo.md) (passo 3)
- **Origem:** leitura das referências de terceiros de 13/10/2026 (plugin de chat do pós-jogo MIT v0.8 e o "debloater" do
  client), decisão do Gabriel no mesmo dia.

## Pedido, nas palavras dele

> "Eu gostei da ideia do Better Lol Chat. Opção 4 também parece boa. Quanto ao 5, eu apoio tirar alguns pop-ups chatos, sim."

E, na mesma conversa: "as fotos dos campeões no joguinho podem ser coletadas do próprio cliente, né?" (vale aqui também:
o ícone de cada linha do chat sai do próprio client, `/lol-game-data/assets/...`, nunca de CDN).

## Entendimento

1. **Chat do pós-jogo** (opção 1): trazer para o nosso plugin, adaptado, o que o plugin MIT faz no chat da tela de
   estatísticas: nome do campeão junto do nome (ou no lugar), ícone do campeão em cada linha, cor certa de
   aliado/inimigo (o client pinta todo mundo como inimigo: `fromSummonerId` 0 nas mensagens de grupo), chat que abre
   sozinho e fica aberto, sem "entrou/deixou o saguão", e quem saiu escurecido no placar.
2. **Som** (opção 4): `aceite.silenciarSom` já existe (corta só o loop depois do aceite). Ele quer **ligado**: padrão
   true, e a config salva dele (false = padrão antigo, nunca escolhido) vira true uma vez só, com marca de migração.
3. **Popups** (opção 5): calar os avisos "você foi preenchido", "páginas de runa modificadas automaticamente" e "smite
   atribuído automaticamente" com resposta falsa estreita, só nas rotas exatas, uma chave por aviso.

## Linha que não se cruza

- Só leitura na LCU real; nenhuma escrita nova (o chat não envia nada; o sem-popups não escreve, só responde por cima).
- Falsificar **só GET** das rotas exatas abaixo. Nunca: `/lol-missions`, reward-grants, Missions/Challenges,
  `/lol-settings`, `/lol-champ-select/v1/session` (o coletor lê `isAutofilled` de lá), punição/conduta/Vanguard.
- `textarea.focus()` nunca (rola o client inteiro); trocar classe de foco do chat sempre com a rolagem congelada.
- Nada de nome de jogador em log, fixture ou arquivo (fixture usa `JogadorN#BR1`). O único nome de terceiro no repo é o
  aviso de copyright MIT no topo de `pengu/chat-posjogo.js`, que a licença exige.
- Não trazer do plugin de origem: checagem de atualização no GitHub, aviso disfarçado de mensagem no chat, instalador,
  `/demo` e `/sample`, painel de opções próprio, faixa de crédito, chat esticado, ícone no meio do placar.

## Medido no client 16.20 (13/10/2026, fase `None`, só GET pelo `tools/cdp.mjs eval`)

`GET /help?format=Console` (3,6 MB), funções que casam com autofill/auto-modified/smite:

| função | rota | quem consulta no JS do client (busca em 42 scripts carregados) |
| --- | --- | --- |
| `GetLolLobbyV1AutofillDisplayed` / `Put…` | `/lol-lobby/v1/autofill-displayed` | **ninguém** |
| `GetLolPerksV1ShowAutoModifiedPagesNotification` / `Post…` | `/lol-perks/v1/show-auto-modified-pages-notification` | champ-select (`r("/lol-perks").get(...)` → aviso sobre as runas; ao fechar, `POST` = "já vi"), navigation (botão Jogar → aviso), collections (`addObserver` → selo "revisar runas"; `POST` no init da tela de runas) |
| `GetLolLobbyTeamBuilderChampSelectV1HasAutoAssignedSmite` | `/lol-lobby-team-builder/champ-select/v1/has-auto-assigned-smite` | champ-select e jade (`get(..., {skipCache: true})` no planejamento → aviso `smite_assignment_message`) |
| `GetLolSummonerV1CurrentSummonerAutofill` | `/lol-summoner/v1/current-summoner/autofill` | shared-components (`db.observe` → modal de proteção do autofill, dados de LP) |
| `DeleteLolPerksV1PagesByIdAutoModifiedSelections` | `/lol-perks/v1/pages/{id}/auto-modified-selections` | collections (limpa a marca ao editar) |

Correções de premissa (rotas de jul/2025 não medidas):

- `has-auto-assigned-smite` não é `/lol-perks/...`: é `/lol-lobby-team-builder/champ-select/v1/has-auto-assigned-smite`.
- `/lol-lobby/v1/autofill-displayed` existe, mas **nenhum** script do 16.20 lê: falsificar não cala nada. O aviso de
  preenchido vem de `session.myTeam[].isAutofilled` (título "posição atribuída (preenchido)" e o modal de dodge da
  ranqueada) e de `/lol-summoner/v1/current-summoner/autofill` (modal de proteção). A sessão é proibida e o modal de
  proteção é informação de LP, não aviso chato: **autofill descartado** (ver § Descartado).
- "o selo lê `isAutofilled`": só o `coletor/coletor.py` lê (HTTP próprio do Python, fora da página); o
  `pengu/champselect.js` não lê. O embrulho é da página e nunca toca a sessão: o coletor segue lendo o valor verdadeiro.

Transporte: `dataBinding.get` → `jsonRequest` (`rcp-fe-common-libs`) → `XMLHttpRequest` cru (`h.status`,
`h.responseText`, `send` adiado). Por isso o embrulho é no `XMLHttpRequest.prototype.open/send` (e no `fetch`, por
garantia). O Datadog do client também instrumenta `open/send` e escuta `loadend`: a resposta falsa dispara
`readystatechange`, `load` e `loadend`.

Textos do saguão (de `/fe/lol-social/trans.json`, pt-BR): `system_message_joined_room` = "{{actor}} entrou no saguão",
`system_message_left_room` = "{{actor}} deixou o saguão". O módulo lê esse arquivo na hora (vale para outro idioma) e
cai nesses textos e nos em inglês sem ele.

## Decisões técnicas (quem: executor opus, 13/10/2026)

- **Chaves** (`config.js`, todas padrão ligado): `chatPosjogo.{ligado, nomes: 'ambos'|'campeao'|'jogador',
  iconeCampeao, corTime, abrirSozinho, manterAberto, esconderEntrouSaiu, escurecerSaiu}` e
  `semPopups.{ligado, runasAutomaticas, smiteAutomatico}`. Nomes escolhidos para a classe no `<html>` não colidir
  (`runas.ligado` já é `lc-runas`). Confiança alta; reverte trocando o padrão.
- **"Entrou" e "deixou" somem os dois** (o original escondia só o "entrou"): o pedido diz "esconder avisos entrou/saiu";
  quem saiu continua visível pelo placar escurecido. Uma chave só. Confiança média; reverte separando em duas chaves.
- **Não brigar com o painel**: com `#lc-posjogo` aberto o chat não força abrir nem intercepta Esc (o Esc é do painel).
  A troca de nome/cor dentro do iframe segue (invisível sob o painel). Ao fechar o painel, a sonda de 250 ms abre o chat.
- **Sem-popups decide na hora do `send`** (config viva: desligar no Ctrl+K vale na próxima consulta, sem recarregar).
  Resposta falsa = `false` (as duas rotas devolvem `bool`; o client só mostra com `true`).
- **Som**: `VERSAO` 3 em `config.js`; a migração 3 só troca `aceite.silenciarSom === false` por true; marca dentro da
  config e em `lol-client.versao`, igual à do freio. Config v1 recebe as duas migrações na mesma carga.
- **Esc só com o cursor no chat** (executor opus, depois da revisão): o Esc recolhe só com `document.activeElement` dentro
  da sala (campo ou iframe das mensagens) e tira o cursor do campo (`blur`, que não rola). Fora disso o Esc é do client
  (janela de denúncia/honra por cima do placar). Custo: com o chat aberto por nós e o cursor fora dele, o Esc não recolhe;
  o botão do chat recolhe sempre. Confiança média; reverte tirando a exigência `focoNaSala` em `deveRecolherNoEsc`.
- **Desligar no meio da tela desfaz** (executor opus): `ajustarSala` guarda no `dataset` o `can-hide-player-messages` e a
  lista de `room-changed-messages` originais e devolve ao desligar; a lista só volta se o atributo ainda é o que nós
  escrevemos (o client reescreve). O chat que nós abrimos sem foco fecha; com o cursor nele, fica. Confiança alta.

## Revisão adversarial (13/10/2026, 2 revisores)

Nenhum achado falso; nenhum bloqueante.

1. Aviso de runas pode escapar depois de um patch (cache do `dataBinding`): real, sem correção estreita possível (calar o
   socket sai da "resposta falsa estreita"). Rebaixado de "raro" para "não provado" em § O que só o client prova.
2. Enter em qualquer lugar reabria o chat recolhido (painel, Ctrl+K, módulo desligado): corrigido (`deveReabrir`).
3. Esc roubava o 1º Esc de janelas do client e deixava o cursor no campo escondido: corrigido (`deveRecolherNoEsc` +
   `blur`). O 2º revisor apontou o mesmo.
4. Desligar com a tela aberta deixava o chat preso aberto e os atributos mexidos: corrigido (`ajustarSala`,
   `fecharAoDesligar`).

## Passos

1. [x] Ler o código original (copiado para `%TEMP%\lolref`), medir `/help` e o JS do client (acima).
2. [x] **Som ligado** (`config.js` `migrar`, `PADRAO.aceite.silenciarSom: true`, texto nas Configurações e README).
   Prova: `node tools/teste-config.mjs` (false sem marca → true e uma gravação; recarregar não grava; desligar depois
   fica false; com a marca 3 fica false; revert com só a marca de fora não migra).
3. [x] **Sem popups** (`pengu/sem-popups.js`, chamado primeiro no `init`). Prova: `node tools/teste-sem-popups.mjs`
   (XHR e fetch falsos: só GET das 2 rotas exatas é falsificado; POST da mesma rota, rota parecida, sessão do champ
   select, missões e settings passam intactos; chave do aviso ou geral desligada não falsifica; config lida na hora).
4. [x] **Chat do pós-jogo** (`pengu/chat-posjogo.js` + CSS do iframe embutido no módulo + regras do placar no
   `estilo.css`). Prova: `node tools/teste-chat-posjogo.mjs` com `tests/fixtures/chat-posjogo.json` (elenco do eog
   sintético, linhas no formato do template do client): nome+campeão, só campeão, só jogador; ícone do client; aliado
   pintado de inimigo vira aliado; "entrou/deixou o saguão" somem e voltam ao desligar; repintar não mexe no DOM;
   decisão de abrir/manter/recolher; nenhum Riot ID no log.
5. [x] **Sintaxe e XHR de verdade no CEF 108** (13/10/2026, fase `None`, sem recarregar a interface): os módulos novos
   importados na página por `cdp.mjs eval` (blob); `XMLHttpRequest` real numa subclasse embrulhada (o protótipo global
   não foi tocado): GET do smite devolveu `status` 200, `responseText` "false", eventos `readystatechange`→`load`→`loadend`,
   **0** pedidos na rede; `padroesSala` com o `trans.json` real casa "entrou/deixou o saguão".
   Resultado das provas offline: `python tools/rodar-testes.py mjs` 12/12 (config 38/38, sem-popups 22/22, chat 36/36).
5b. [x] **Achados da revisão adversarial** (13/10/2026, ver § Revisão): Esc só com o cursor no chat e solta o cursor;
   Enter só reabre com o cursor no chat, painel fechado e módulo ligado; desligar no meio da tela desfaz (fecha o que
   nós abrimos, devolve `can-hide-player-messages` e `room-changed-messages`). Prova: `node tools/teste-chat-posjogo.mjs`
   45/45 (9 casos novos: Esc, Enter, desligar, sala ida e volta sem escrita repetida, nenhum `.focus()` no código).
   Suíte inteira (`python tools/rodar-testes.py`, client fechado): 33/33.
6. [ ] **Recarregar a interface** (só em `None`/`Lobby`, quando o Gabriel liberar) para o plugin novo valer.
7. [ ] **Prova no client** (fim de uma partida real, com o Gabriel): ver § O que só o client prova.

## O que só o client prova

- Chat: o painel `#lc-posjogo` fechado → o chat abre sozinho na aba Placar, fica aberto ao clicar fora, o botão do chat e
  o Esc (com o cursor no chat) recolhem e o cursor sai do campo; com a janela de denúncia/honra por cima, o 1º Esc fecha
  a janela, não o chat; nomes com campeão e ícone; aliado em azul; sem "entrou/deixou o saguão"; quem saiu escurecido.
  ARAM e Arena (placar com DOM diferente: só as classes `strawberry-`/`jade-` do original, não medidas aqui; sem
  `.scoreboard-team-container` nesses modos o chat não abre sozinho). O escurecer depende de `.not-in-chat`, não medido.
- Sem popups: o aviso de smite não aparece ao cair de selva sem smite; o de runas não aparece no champ select nem no
  botão Jogar depois de um patch que mexe nas runas. **Cache, não provado**: a rota das runas passa pelo cache do
  `dataBinding` e só a 1ª leitura por XHR cai no embrulho; se o servidor das runas ajustar as páginas **depois** dessa
  leitura (a tela de coleções observa a rota logo na subida) e mandar `true` pelo socket, o champ select e o botão Jogar
  leem `true` do cache e o aviso aparece. "Depois do patch" é justo o único caso em que esse aviso existe, então não dá
  para chamar de raro: só a 1ª subida do client depois de um patch que mexa nas runas prova se cala.
- Som: depois de aceitar, o loop não toca (já era o passo 2c do plano de voz e foco, agora ligado por padrão).

## Armadilhas encontradas (para o orquestrador consolidar no ARMADILHAS)

- **Rota do `/help` sem consumidor** → `/lol-lobby/v1/autofill-displayed` existe no 16.20 e nenhum script do client lê;
  falsificar não cala o aviso. Antes de falsificar, procurar quem consulta no JS do client (`document.scripts`).
- **Transporte do `dataBinding` é XHR** (`jsonRequest` em `rcp-fe-common-libs`), não `fetch`: embrulho só de `fetch`
  não pega nada. GET sem `skipCache` lê o cache por caminho, que o socket atualiza.
- **Texto do saguão é localizado** ("entrou no saguão"/"deixou o saguão" em pt-BR; o `body` da LCU é a chave
  `joined_room`/`left_room`): regex em inglês do original não casa aqui; ler `/fe/lol-social/trans.json`.
- **Smite automático mora no team-builder**: `/lol-lobby-team-builder/champ-select/v1/has-auto-assigned-smite`, não
  `/lol-perks`.

## Descartado e impraticável

- **Aviso "você foi preenchido"** (executor, 13/10/2026): a rota de referência não tem consumidor no 16.20 e as fontes
  reais do aviso são a sessão do champ select (proibida: o coletor lê `isAutofilled` dela) e a proteção de autofill
  (informação de LP). Reabrir só se um patch voltar a ler `autofill-displayed` (refazer a busca do passo 1).
- Do plugin de origem: chat esticado até o topo do placar, ícone e nível no meio do placar, painel de opções próprio,
  faixa de crédito, checagem de atualização, aviso no chat, instalador, `/demo` e `/sample` (fora do pedido ou proibidos).
