# Plano — client compacto, champ select compacto e chat fora do client (2026-10-13)

Pedido: — | client compacto (lobby, fila, champ select com trocas, pós-jogo, chat em janelas) | de: gabriel | desde: 2026-10-13 | origem: chat

- **Alvo:** `pengu/` (plugin: tela compacta por cima do client, troca de modo, botão no modo expandido),
  `coletor/` (janelas do chat fora do client, servidas pelo `servidor_local` 127.0.0.1:8765), `pengu/config.js`
  (chave `compacto.*`), `pengu/estilo.css`, testes em `tools/`.
- **Protótipo para aprovação:** [temp/2026-10-13-prototipo-client-compacto.html](../temp/2026-10-13-prototipo-client-compacto.html)
  (abre com duplo clique; nada de rede) · prints de cada tela em `temp/prototipo-compacto/tela-N.png` (1 a 7, mais
  `tela-3b.png`: finalização com troca de campeão recebida). `temp/` não é versionado.
- **Protótipo do fim de partida (passo 12, aguardando aprovação):**
  [temp/2026-10-14-prototipo-compacto-fim-de-partida.html](../temp/2026-10-14-prototipo-compacto-fim-de-partida.html)
  · prints em `temp/prototipo-fim-de-partida/tela-{A,B,B-detalhes,C,D}.png`.
- **Protótipo do chat ao lado e do grupo 2 da paridade (passo 13, aguardando aprovação):**
  [temp/2026-10-14-prototipo-compacto-chat-e-paridade.html](../temp/2026-10-14-prototipo-compacto-chat-e-paridade.html)
  · prints em `temp/prototipo-chat-e-paridade/`.
- **Ler antes:** hub [cerebro/projetos/lol-client.md](../../cerebro/projetos/lol-client.md) ·
  [CLAUDE.md](../CLAUDE.md) · [docs/ARMADILHAS.md](../docs/ARMADILHAS.md) (§ Client e Pengu, § LCU API) ·
  [README](../README.md) · irmãos: [jogar de novo](2026-10-13-jogar-de-novo.md) (freios, penalidade),
  [v2 coach](2026-10-13-lol-client-v2-coach.md) (selo do champ select, pós-jogo).

## ⛔ Construção NÃO começa antes do passo 0

O Gabriel decidiu (13/10/2026): "se eu aprovar cada uma das telas, todas elas, nem que seja apenas uma imagem
mostrando como seria, aí assim a gente pode prosseguir com a construção". Passo 0 fecha só com **as 7 telas
aprovadas**. Tela com ajuste → ajusta o protótipo e pede aprovação de novo; nenhum código de produto antes.

## Pedido (palavras dele, 13/10/2026)

> "E se a gente tiver um modo compacto do client, layout compacto, inicializa automaticamente no modo compacto, e aí
> tem só algumas poucas informações pertinentes, botão de jogar, porque geralmente é isso que eu faço. Coloco para
> jogar, ranqueada, escolho uma skin, vejo os campeões do outro lado [...] E depois no pós-jogo também poderia ter uma
> tela compacta. A parte de chat também poderia ser comprimida [...] o chat poderia até ser um pop-up fora do client
> [...] tem o botão de chat e ao clicar nele, aí ele chama a lista de amigos numa nova janela, novas conversas aparecem
> numa terceira janela."

> "nessa tela compacta também tem que ter a opção para voltar para o modo expandido padrão. E obviamente no modo
> expandido padrão também tem que ter a opção para entrar novamente no modo compacto. Eu apoio já criar a questão do
> champ select junto. Lembrando que é interessante ter toda a questão de troca de posição, troca de ordem para poder
> aceitar, poder solicitar. [...] Em relação ao protótipo compacto, eu apoio só um protótipo inicialmente. E se eu
> aprovar cada uma das telas, todas elas, nem que seja apenas uma imagem mostrando como seria, aí assim a gente pode
> prosseguir com a construção."

## Entendimento

O Gabriel abre o client quase sempre para a mesma coisa: jogar ranqueada, escolher campeão e skin, olhar o time
inimigo, ver o resultado e jogar de novo. O client de 1280×720 mostra loja, eventos, perfil e chat que ele não usa
nessa rotina. Ele quer:

1. o client **abrir sozinho** numa janela pequena só com o que importa;
2. **alternar** compacto ↔ expandido em qualquer tela, nos dois sentidos;
3. champ select compacto **completo**, inclusive as três trocas (posição, ordem de pick, campeão) com
   **solicitar** e **aceitar/recusar**;
4. pós-jogo compacto;
5. chat **fora do client**: botão 💬 → lista de amigos em janela própria → cada conversa em outra janela (uma
   janela por conversa; mensagem nova de quem não tem janela abre a dele, "novas conversas aparecem numa terceira
   janela").

Fora do escopo: ready-check (o `aceite.js` e a janelinha do coletor já são donos), loja, perfil, coleção, eventos,
chat dentro da partida (só existe na tela do jogo, ver Descartado).

## Fatos medidos (13/10/2026, só leitura)

**Janela e tela da Riot:**
- `window.riotInvoke({request: JSON.stringify({name:'Window.ResizeTo', params:[w,h]})})` aceita qualquer tamanho em
  px CSS; o `#rcp-fe-viewport-root` **continua com 1280 de largura** e é cortado. A UI da Riot não se adapta: a tela
  compacta é **nossa**, desenhada por cima. Tamanho padrão 1280×720 CSS, `devicePixelRatio` 1,25.
- Camadas existentes (`pengu/estilo.css`): `#lc-posjogo` z-index 100001 (tela cheia; `pengu/posjogo/index.js`
  abre **sozinho** no `EndOfGame` da SR), `#lc-aceite` 100002, `#lc-runas` **100000** sem fundo bloqueante,
  `#lc-winrate` **100000** (selo fixo no champ select). Mesmo z-index da camada compacta = quem fica por cima depende
  da ordem no DOM: os dois somem no compacto (passo 5).

**Legenda do levantamento:** **[H]** está no `/help?format=Console` (cópia de 13/10/2026 em
`temp/v2/help-full.json`, só a função/campo existir; a semântica segue [S] até medir); **[L]** lido ao vivo;
**[S]** suposição, precisa ser medida antes de depender.

**Fases do `gameflow-phase`** (todas têm destino na tabela de telas): `None`, `Lobby`, `Matchmaking`, `ReadyCheck`,
`ChampSelect`, `GameStart`, `InProgress`, `Reconnect`, `FailedToLaunch`, `TerminatedInError`, `WaitingForStats`,
`PreEndOfGame`, `EndOfGame`.

**Lobby, grupo e fila:**
- convite [H]: `GET /lol-lobby/v2/received-invitations`, `POST .../received-invitations/{invitationId}/accept|decline`;
  convidar `POST /lol-lobby/v2/lobby/invitations` (corpo [S] `[{toSummonerId}]`); líder [S] pelo `localMember.isLeader`
  do `GET /lol-lobby/v2/lobby`; `POST .../members/{summonerId}/promote` existe e fica de fora.
- penalidade que impede buscar: `restrictions[]` do lobby (`restricaoDura`, `pengu/fila-rapida.js`) = fase **`Lobby`**,
  a busca nem começa: o estado é da **tela 1**.
- busca [H]: `GET /lol-matchmaking/v1/search` (`timeInQueue`, `estimatedQueueTime`, `lowPriorityData` com
  `penaltyTimeRemaining`), `DELETE` = cancelar. [S] fila de baixa prioridade (leaver) entra em `Matchmaking` com a
  contagem do `lowPriorityData`: é o único "castigo" que aparece na **tela 2**.
- reconectar [H]: `POST /lol-gameflow/v1/reconnect` sem corpo (o `_performReconnect` do `rcp-fe-lol-navigation` 16.20); desde o
  passo 14 o RECONECTAR da tela de jogo usa, só por clique dele.
- PDL do pós-jogo [S]: `GET /lol-ranked/v1/current-lp-change-notification` ou diferença de `current-ranked-stats`
  antes/depois (`leaguePointsDelta` existe no `/help`); medir qual chega a tempo.

**Champ select** (sessão `TeamBuilderDirect-ChampSelectSession`, só o prefixo `/lol-champ-select/v1`; o legado
`/lol-lobby-team-builder/champ-select/v1` só para o `session/quit`):
- sessão [H]: `timer`, `myTeam[]`, `theirTeam[]`, `localPlayerCellId`, `actions` (lista de listas), `trades[]`,
  `pickOrderSwaps[]`, `positionSwaps[]` (`ChampSelectSwapContract`), `allowSkinSelection`, `benchEnabled`/
  `benchChampions` (ARAM), `allowRerolling`/`rerollsRemaining`. Evento `OnJsonApiEvent_lol-champ-select_v1_session`.
- escolher/banir [H]: `PATCH session/actions/{id}` (corpo `ChampSelectAction`). **Medido 14/10/2026** (ranqueada,
  `LeagueClient.log`): `{completed: false, championId}` = hover/intenção, `{completed: true, championId}` = trava/bane
  (o corpo da própria Riot); `POST .../{id}/complete` sem corpo trava o campeão 0 (204, nada acontece): **não usar**.
- campeões [H]: `pickable-champion-ids`, `bannable-champion-ids`, `all-grid-champions` (`owned`, `disabled`,
  `positionsFavorited`), `POST toggle-favorite/{championId}/{position}` (favorito nativo da Riot).
- troca de posição [H]: `session/position-swaps/{id}/request|accept|decline|cancel`, `GET ongoing-position-swap`
  (`requesterPosition`, `responderPosition`, `initiatedByLocalPlayer`), `POST ongoing-position-swap/{id}/clear`.
- troca de ordem [H]: `session/pick-order-swaps/{id}/request|accept|decline|cancel`, `GET ongoing-pick-order-swap`.
- troca de campeão [H]: o campo da sessão é `trades`, mas a rota é `session/champion-swaps/{id}/...`;
  `GET ongoing-champion-swap` traz `requesterChampionName`/`responderChampionName`, **sem** `requestorIndex`.
- estados [H]: `AVAILABLE | BUSY | INVALID | RECEIVED | SENT | DECLINED | CANCELLED | ACCEPTED`; tipos
  `CHAMPION | PICK_ORDER | POSITION`. [S] um contrato por aliado; `AVAILABLE` = dá para pedir; `SENT` para quem pediu,
  `RECEIVED` para quem recebe; `BUSY` com outra troca pendente; `INVALID` fora de fase/fila **ou, na troca de
  campeão, quando um dos dois não tem o campeão do outro**; `DECLINED`/`CANCELLED` = recusa e desistência (a tela
  mostra os dois); pedido aberto morre na virada de fase [S].
- ARAM [H]: `benchChampions`, `rerollsRemaining`, `POST session/bench/swap/{championId}`,
  `POST session/my-selection/reroll`. **Não entra no compacto** (decisão abaixo): a seleção do ARAM expande.
- botões por jogador [H]: `GET summoners/{slotId}` → `showTrades`, `showSwaps`, `showPositionSwaps`, `tradeId`,
  `swapId`, `positionSwapId`, `isActingNow`, `nameVisibilityType`, `isAutofilled`. **Usar isso** em vez de recalcular.
- skin [H]: `PATCH session/my-selection {selectedSkinId}`, `GET skin-carousel-skins` (chromas em `childSkins`).
  [S] só respondem dentro do champ select.
- feitiços [H]: mesmo `PATCH my-selection {spell1Id, spell2Id}`; catálogo [L] `/lol-game-data/assets/v1/summoner-spells.json`
  (1 Purificar, 3 Exaustão, 4 Flash, 6 Fantasma, 7 Curar, 11 Golpear, 12 Teleporte, 14 Incendiar, 21 Barreira).
- timer [H]: `adjustedTimeLeftInPhase`, `totalTimeInPhase`, `phase`.

**Chat:**
- [H] `GET /lol-chat/v1/friends` (`gameName`, `availability`, `lol.gameStatus`, `groupName`), `GET conversations`
  (`unreadMessageCount`, `lastMessage`), `GET conversations/{id}/messages`, `POST conversations/{id}/messages`.
- [L] `availability`: `chat | away | dnd | mobile | offline`; `lol.gameStatus`: `outOfGame`, `inGame`,
  `hosting_RANKED_SOLO_5x5`… [S] `inQueue`, `championSelect` (não visto) e o tempo de partida (`lol.timeStamp`):
  no protótipo "na fila" e "em partida · 18 min" levam a tag "a medir".
- [S] envio mínimo `{body, type:"chat"}`; abrir conversa `POST conversations {id: <pid>, type:"chat"}`.

**Dados dele usados no protótipo** (MCP, 13/10/2026): hoje 1V 3D, Esmeralda IV 14 PDL (variação 0); Renekton 87
partidas 48,3%, Zac 63 partidas 47,6%; freios `pengu/freios.js` `MEDICAO` (depois de 2 derrotas 44%; madrugada 47%
contra 58% de dia).

## O que o pedido não dizia

**Feito (no protótipo e no plano, marcado `+` nos passos):**
- \+ **Penalidade no lobby** (dodge): JOGAR apagado com o motivo e o prazo do `restrictions[]` (tela 1, fase
  `Lobby`), igual ao jogar de novo; **baixa prioridade** (leaver) na tela 2 com a contagem do `lowPriorityData`.
  Sem isso, a tela pequena esconderia o motivo de não buscar.
- \+ **Grupo e convite**: membros e líder na tela 1, convite recebido com aceitar/recusar, "convidar" na lista de
  amigos; no grupo de outro o JOGAR vira "o líder busca" e o jogar de novo só volta ao lobby (regra do
  [jogar de novo](2026-10-13-jogar-de-novo.md)). Sem isso a duo que o próprio chat sugere não tinha caminho.
- \+ **Todas as fases com destino** (Reconnect, falha ao abrir o jogo, carregando estatísticas): o botão Reconectar da
  Riot nunca pode ficar embaixo da camada (risco de penalidade de leaver).
- \+ **Pedido de troca recusado, desistido ou morto na virada de fase** e troca de campeão sem o campeão: o fluxo
  "solicitar" completo, não só o caminho feliz.
- \+ **✕ na seleção pede confirmação**: fechar o client nessa fase é dodge.
- \+ **Freios simuláveis no protótipo** (2 derrotas, madrugada): o estado real de hoje não dispara freio, e ele precisa
  ver o 2º clique antes de aprovar a tela 1.
- \+ **Estados `BUSY`/`INVALID` das trocas** em cinza com o motivo: existem no enum e, sem eles, o botão "solicitar"
  pareceria quebrado.
- \+ **Texto do parecer visível** além do "copiar": `navigator.clipboard` pode ser recusado em arquivo aberto por
  duplo clique; o texto fica numa caixa para selecionar.
- \+ **Lembrar o modo** (compacto/expandido) por fase: quem expandiu no champ select para ver algo volta ao compacto
  na fase seguinte só se o padrão for compacto (regra no passo 3).
- \+ **Minimizar e fechar em todas as telas compactas** (inclusive a 3): a camada cobre os controles da janela da
  Riot; sem eles o compacto prende o Gabriel (no protótipo, os `–` e `✕` do topo).
- \+ **Atalho de teclado** para alternar (Ctrl+Shift+M, a validar contra os atalhos do client), além do botão;
  aparece no protótipo (telas 1 e 6, título do "expandir") para ele aprovar.

**Proposto (decisão dele, não bloqueia o passo 0):**
- Abrir **sempre** no compacto (o pedido) **ou** só nas fases da rotina (Lobby/fila/champ select/pós-jogo) e
  expandido no resto. Recomendo: sempre compacto, com as telas da Riot que surgem sozinhas expandindo (abaixo).
- Janelas do chat **sempre por cima** ou normais. Recomendo normais (por cima atrapalha a partida na mesma tela).
- Seleção do ARAM compacta (banco, reroll, só troca de campeão) numa leva futura, se ele quiser: hoje ela expande.

**Descartado:** ver § Descartado e impraticável.

## O que NÃO muda (guardrails)

- **Busca na fila só por clique**, sempre pelos freios de `pengu/freios.js` (2º clique em até 8 s). O compacto não
  ganha "buscar sozinho" em nenhum caso.
- **Nada revela nome oculto** no champ select ranqueado: inimigo só pelo campeão (e só depois da ação de pick dele
  `completed`); aliado com Riot ID só onde `nameVisibilityType` permite; o protótipo usa "aliado N".
- **Nada automatiza decisão do jogador:** escolher, banir, trocar, aceitar troca, skin e feitiço são clique dele. O
  único automático que já existe e continua é a troca da página de runa (`runas.js`) e o popup quando há 2+.
- **Ready-check não é tela compacta:** `aceite.js` (z 100002) e a janelinha do coletor seguem donos. A tela compacta
  fica **abaixo** de 100002 e cede no `ReadyCheck`.
- **Reconectar é clique dele:** desde o passo 14 no RECONECTAR da tela de jogo (a mesma rota do botão da Riot); nunca reconecta sozinho.
- O `estilo.css` que enxuga o modo expandido (TFT, coluna larga) continua valendo no expandido.
- Credencial da página/lockfile, `chatDetails.multiUserChatPassword` e `mucJwtDto` nunca em arquivo, log ou fixture.
- Recarregar a interface só em `None`/`Lobby`.

## Abordagem / arquitetura

**Uma camada nossa por cima + janela pequena.** No modo compacto o plugin chama `Window.ResizeTo` (≈420×640 CSS) e
monta `#lc-compacto` (tela cheia da janela, z-index 100000, abaixo do aceite) que esconde visualmente o
`#rcp-fe-viewport-root`. A tela compacta só lê a LCU e escreve pelas mesmas rotas que a UI da Riot usa. Expandir =
`ResizeTo(1280, 720)` + remover a camada; o client fica intacto embaixo o tempo todo.

**Telas** (todas as fases do `gameflow-phase` têm destino):

| tela | fase | conteúdo |
| --- | --- | --- |
| 1 lobby | `None`/`Lobby` | grupo (membros, líder, + convidar), convite recebido (aceitar/recusar), JOGAR (fila e posições do cfg, freios; "o líder busca" no grupo de outro; apagado com o motivo e o prazo do `restrictions[]`), escolher fila (solo/duo 420, flex 440, normal 400, ARAM 450), resumo do dia, dica do coach, 💬 com contador, expandir, – ✕ |
| 2 na fila | `Matchmaking` | tempo na fila, estimativa, cancelar (só o líder); variante baixa prioridade (contagem do `lowPriorityData`) |
| 2 na fila | `ReadyCheck` | "partida encontrada" por baixo do `#lc-aceite` (desde 14/10/2026, passo 10; antes a camada saía e a tela da Riot aparecia cortada); quem aceita segue sendo o `aceite.js` e a janelinha do coletor |
| 3 champ select | `ChampSelect` (SR: 420/440/400) | timer e fase, aliados (posição + campeão), inimigos só por campeão (recolhível), 10 bans, busca + favoritos (Renekton, Zac), banir/escolher/travar, skin, feitiços, runa (escolha **dentro** da tela quando há 2+), trocas com aceito/recusa/desistência/virada de fase, – e ✕ com aviso de dodge |
| 7 regra | `ChampSelect` do ARAM (450) | expande: banco e reroll ficam com a tela da Riot |
| partida | `GameStart`/`InProgress`/`Reconnect` | desde o passo 14 (14/10/2026): tela compacta atrás do jogo (campeão, fila, tempo, placar do time; RECONECTAR no `Reconnect`, por clique); antes a camada saía de cena |
| 7 regra | `FailedToLaunch`, `TerminatedInError` | expande sozinho: a tela da Riot (crash report) fica à mão |
| 4 pós-jogo | `WaitingForStats`/`PreEndOfGame` | "carregando" (honra do `PreEndOfGame`: regra 7, expande) |
| 4 pós-jogo | `EndOfGame` | V/D, KDA, farm, PDL [S], 3 lições em 1 linha cada, jogar de novo (mesma fila da partida, freios; no grupo de outro só volta ao lobby), ver análise completa (expande e abre o `#lc-posjogo`; no compacto ele **não** abre sozinho) |
| 5 chat | qualquer | lista de amigos (janela ~300×560, com "convidar") e **uma janela por conversa** (~360×420, até 3), fora do client |
| 6 expandido | qualquer | client normal + botão "modo compacto" no topo, ao lado da fila rápida (`.navbar_backdrop`); Ctrl+Shift+M |
| 7 regras | — | telas da Riot que surgem sozinhas (subir de nível, honra, celebração, punição, convite/aviso fora do compacto) e **qualquer modal desconhecido** na camada de modais da Riot expandem sozinhas |

**Chat fora do client:** o Pengu não abre janela do sistema. Quem abre é o coletor, no mesmo padrão do painel da 2ª
tela (Edge em modo app, `coletor/janela_painel.py`), servindo `/chat/amigos` e `/chat/conversa/<id>` no
`servidor_local`: **uma janela Edge por conversa** (até 3; a 4ª fecha a mais antiga). Mensagem nova de quem não tem
janela abre a dele **sem roubar o foco**; em `GameStart`/`InProgress` só conta no 💬 e abre quando a partida acaba. Quem fala com a LCU é o **plugin** (já tem a sessão): o coletor pede pelo `POST /config`-like
canal existente ou o plugin empurra friends/conversas para o coletor (decisão no passo 6, mais reversível primeiro:
plugin empurra, coletor só exibe e devolve o texto digitado). Armadilhas que valem: px lógicos do `msedge
--window-position` e `rcWork` (§ Windows), pid do Edge reaproveitado.

## Decisões e trade-offs

- **Camada nossa, não CSS na tela da Riot** (medido: a viewport não encolhe). Custo: cada tela é código nosso e pode
  quebrar com patch; ganho: controle total do que aparece. Confiança alta. Reverte se um patch da Riot fizer a UI
  responsiva.
- **Estados das trocas por `summoners/{slotId}`** (botões que a Riot já calcula) em vez de recalcular por
  `positionSwaps[]`. Confiança média: [S] até medir numa ranqueada.
- **Chat pelo padrão do painel** (Edge app do coletor) e não janela Win32 nova: reusa código que já funciona.
  Custo: depende do coletor de pé; sem coletor, o 💬 abre o chat nativo no expandido.
- **Favoritos:** Renekton e Zac fixos no topo da busca (config `compacto.favoritos`), sem depender do
  `toggle-favorite` nativo (que é por posição). Reverte para o nativo se ele quiser os mesmos favoritos no client.
- **ARAM expande na seleção** em vez de ganhar tela compacta própria (banco, reroll, sem ban/ordem/posição, feitiços
  diferentes): menos código e nenhuma tela que ele aprovaria sem existir. Confiança alta. Reverte se ele pedir (item
  proposto acima).
- **Runa e selo dentro da tela 3:** no compacto (`html.lc-compacto`) o `#lc-runas` e o `#lc-winrate` ficam escondidos;
  a tela 3 mostra a mesma escolha do `runas.js` e o winrate nos favoritos. Evita empate de z-index (100000) com a
  camada. Confiança média: depende de o `runas.js` expor as páginas candidatas sem abrir o popup.
- **Pós-jogo:** no compacto o `posjogo/index.js` não abre o `#lc-posjogo` no `EndOfGame`; só o "ver análise completa"
  (que expande antes). No expandido, segue como hoje. Revisão de 13/10/2026: se a camada cair DEPOIS da decisão
  (celebração tardia que a regra 7 expande, erro da tela 4 ou o ⤢ expandir dele) ainda no `EndOfGame`, o painel abre
  (`vigiarSaidaDoCompacto`): "expandido segue como hoje". Confiança média; reverte se ele achar que o ⤢ manual não
  devia abrir o painel (aí só modal/erro abrem).
- **Filas novas na fila rápida:** hoje `FILAS = [420, 440]` em `config.js`; o compacto adiciona 400 e 450.
  Posições só em 420/440/400 (regra do jogar de novo). ARAM sem posição.
- **Conceitos do acervo:** `via-negativa` (o compacto é subtração: o valor está no que sai da tela, não no que entra
  — cada tela foi cortada até a rotina dele) e `falacia-da-previsao` (as rotas marcadas [S] viram passo de medição
  antes do código, não premissa).

## Passos

0. [x] **Aprovado em 13/10/2026 (2ª rodada), palavras dele: "tudo aprovado, pode construir."** As 7 telas,
   incluindo a 3 e a 5 ajustadas. Construção liberada.
   **Aprovação tela a tela pelo Gabriel** (bloqueia todos os outros). Ele abre o protótipo, marca cada tela
   "aprovar" ou "pedir ajuste" e cola o parecer no chat. **Formato do parecer** (gerado pelo botão "copiar meu
   parecer"), uma linha por tela:
   `tela N <nome>: aprovada` ou `tela N <nome>: ajuste: <texto dele>` ou `tela N <nome>: sem parecer`, com os nomes
   `1 lobby`, `2 na fila`, `3 seleção de campeões`, `4 pós-jogo`, `5 chat (amigos + conversa)`,
   `6 client normal com o botão`, `7 regra: expandir sozinho` (1ª linha: `parecer do protótipo do client compacto (13/10/2026)`).
   Protótipo conferido em 13/10/2026 (Chromium via Playwright, servido em 127.0.0.1:8799 só para o teste): as 7
   abas renderizam, freio pede o 2º clique, troca recebida aceita/recusa, expandir ↔ modo compacto, parecer gerado;
   zero requisição externa (`grep -E "https?:|src=|href=|url\("` sem resultado). Refeito depois da revisão (§ Revisão
   do protótipo): `node --check` do script ok, zero erro de página nas 7 abas, prints em `temp/prototipo-compacto/`;
   a chave das marcações mudou para `lc-prototipo-compacto-v2` (marcação antiga não vale para o protótipo novo).
   — **prova:** parecer colado no chat com as 7 linhas `aprovada` → registrar a data e a frase dele aqui.
   **reprova se:** qualquer linha `ajuste:` ou `sem parecer` (ajusta o protótipo e repete o passo 0).
   **Parecer de 13/10/2026 (1ª rodada), palavras dele:**
   > tela 1 lobby: aprovada · tela 2 na fila: aprovada · tela 3 seleção de campeões: ajuste: fotos dos campeões ao
   > invés de só a letra inicial do nome deles E nas skins pode ser uma miniatura da Splash Art · tela 4 pós-jogo:
   > aprovada · tela 5 chat (amigos + conversa): ajuste: centralizar verticalmente corretamente elementos como o
   > botão de enviar · tela 6 client normal com o botão: aprovada · tela 7 regra: expandir sozinho: aprovada

   **Aprovadas (5):** 1, 2, 4, 6, 7. **Ajustadas, aguardando nova aprovação (2):** 3 e 5. Passo 0 continua aberto:
   construção segue bloqueada até ele aprovar a 3 e a 5 de novo. Ajustes feitos no protótipo (13/10/2026):
   - tela 3: foto de cada campeão (grade, favoritos, teu time, inimigos, bans agora em fotos) e skins com miniatura
     da splash art, nome real do client e **só as que ele tem** (Renekton 6, Zac 3), como no carrossel do client.
     Origem: o próprio client, só GET pela página (`champion-summary.json`, `champion-icons/<id>.png`,
     `champions/<id>.json` → `splashPath`, posse por `/lol-champions/v1/inventories/.../skins`), reduzidas no canvas
     (foto 64 px, skin 240×142, WebP) e embutidas; o HTML segue sem URL externa (~0,5 MB).
   - tela 5: botão enviar e campo com a mesma altura e centro (o botão era mais alto que a faixa e vazava para
     baixo); barra das janelas, contador de não lidas e "convidar" alinhados ao centro da linha.
   - telas 1, 4 e 7 (aprovadas) mudaram só no ícone do campeão (letra → foto): mesmo componente da tela 3; volta à
     letra com um `if` no `cp()` se ele preferir.
   - atalho de endereço `#3`, `#3b`, `#5` abre direto na tela (prints por Edge headless em `temp/prototipo-compacto/`).
   - chave das marcações **mantida** (`lc-prototipo-compacto-v2`): as 5 aprovações dele continuam marcadas e ele só
     re-marca a 3 e a 5 (o contrário da rodada anterior, que trocou a chave porque o protótipo inteiro mudou).
1. [ ] **Ferramenta pronta, medir na próxima ranqueada:** `python tools/medir-compacto.py` (passivo, só GET, só sinais
   em `dados/medicao-compacto-<data>.jsonl`; prova offline `tools/teste-medir-compacto.py` 32/32). Falta rodar numa
   ranqueada real e escrever o `docs/MEDICAO-<data>.md` § Trocas. Enquanto isso, a construção é defensiva: campo
   ausente ou estado desconhecido = botão cinza com motivo ou expandir.
   **Medir as [S] numa ranqueada real, só leitura** (gravador do coletor ou `tools/cdp.mjs eval` com GET):
   estados de `positionSwaps`/`pickOrderSwaps`/`trades` e `summoners/{slotId}` a cada `Update`; `skin-carousel-skins`
   dentro da seleção; `lol.gameStatus` de um amigo na fila e `lol.timeStamp`; `GET /lol-matchmaking/v1/search` na fila
   (`timeInQueue`, `estimatedQueueTime`, `lowPriorityData`); origem do PDL do pós-jogo; `received-invitations` com um
   convite real; `localMember.isLeader`; que sinal cada tela da regra 7 dá (fase, rota ou modal na camada
   `#lol-uikit-layer-manager-wrapper`); Ctrl+Shift+M livre no client. Gravar sinais (enum, bool), nunca identidade.
   — **prova:** `docs/MEDICAO-<data>.md` § Trocas com a tabela estado×momento e ARMADILHAS atualizado.
   **reprova se:** a tabela tem estado sem momento observado ou a seção não existe.
2. [x] **Feito 13/10/2026:** `node tools/teste-compacto.mjs` 104/104 (alterna nos dois sentidos, 420×640 ↔ 1280×720,
   camada some, arrastar pelo topo, janela devolvida a 1280 pela Riot, atalho só com a chave ligada).
   **Config e troca de modo** (`pengu/config.js`: `compacto: {ligado, inicioCompacto, favoritos: [58, 154],
   larg: 420, alt: 640}`; `pengu/compacto/modo.js`: `ResizeTo`, camada, botão "modo compacto" no expandido junto da
   fila rápida, botão "expandir" em toda tela compacta, + atalho). Teste node com `riotInvoke` falso.
   — **prova:** `node tools/teste-compacto.mjs` → modo alterna nos dois sentidos, `ResizeTo` chamado com 420×640 e
   1280×720, camada some no expandido. **reprova se:** alternar duas vezes não volta ao estado inicial.
3. [x] **Feito 13/10/2026:** no mesmo `teste-compacto.mjs` (13 fases → destino, ReadyCheck cede ao aceite e expande
   se o `aceite.js` não subiu, Reconnect expande, `.modal` desconhecido expande, vigia ligada antes do layer manager).
   **Roteador por fase** (`pengu/compacto/index.js`): as 13 fases da tabela → destino; `ReadyCheck` cede ao
   aceite; `GameStart`/`InProgress` tiram a camada; `Reconnect`/`FailedToLaunch`/`TerminatedInError` e a seleção do
   ARAM expandem; + lembrar o modo por fase; telas da Riot que surgem sozinhas → expandir (sinal de cada uma medido no
   passo 1, sem rota inventada) **mais** um `MutationObserver` na camada de modais da Riot
   (`#lol-uikit-layer-manager-wrapper`): modal que não está na lista conhecida (ready-check do `aceite.js`, avisos
   calados do `sem-popups.js`) → expandir. — **prova:** teste node com sequência das 13 fases → destino esperado a
   cada fase, z-index < 100002; DOM falso com um `.modal` desconhecido → expande. **reprova se:** o `ReadyCheck`
   mostra tela compacta por cima do aceite, ou `Reconnect` deixa a camada de pé.
4. [x] **Feito 13/10/2026:** `node tools/teste-compacto-lobby.mjs` 126/126 (busca só no clique e pelos freios, penalidade
   e não-líder não buscam, fila fora do compacto não busca, nenhum `matchmaking/search` real).
   **Telas 1 e 2** (lobby, fila): reusar `fila-rapida.prepararLobby`, `freios.js`, `restricaoDura` (penalidade
   na tela 1); grupo pelo `GET /lol-lobby/v2/lobby` (membros, líder), convite recebido (`received-invitations`
   accept/decline, clique dele), convidar pela lista de amigos; não-líder não busca nem cancela; cancelar =
   `DELETE /lol-lobby/v2/lobby/matchmaking/search`; tempo e estimativa do `GET /lol-matchmaking/v1/search`.
   — **prova:** teste com LCU falsa: busca só no clique, freio pede 2º clique, penalidade não busca, não-líder não
   busca; **nunca** `matchmaking/search` real em teste. **reprova se:** algum caminho busca sem clique.
5. [x] **Feito 13/10/2026 (offline):** `node tools/teste-compacto-selecao.mjs` 79/79 sobre `champselect-real.json`
   (inimigo só com pick completo, sem nome de terceiro, trocas julgadas pelo efeito, socket mudo relê por GET, runa
   dentro da tela). Falta a parte na personalizada (skin e feitiço pelo Gabriel): vai junto do passo 9.
   **Tela 3** (champ select SR): busca, favoritos, hover/ban/travar, skin, feitiços, runa **dentro da tela**
   (páginas candidatas do `runas.js`; `html.lc-compacto` esconde `#lc-runas` e `#lc-winrate`), inimigos só com ação
   completa, trocas pelos botões do `summoners/{slotId}` com `DECLINED`/`CANCELLED`/virada de fase visíveis e
   `INVALID` com motivo; ✕ com aviso de dodge; reler `localPlayerCellId` a cada evento; trade muda
   `myTeam[].championId`. Prova na personalizada (sair só por `session/quit`, CLAUDE.md).
   — **prova:** fixture `champselect-real.json` + teste node; na personalizada o Gabriel troca skin e feitiço pela
   tela compacta. **reprova se:** inimigo aparece antes do pick completo, nome de terceiro aparece ou o popup/selo
   antigo aparece por cima da tela compacta.
6. [x] **Feito 13/10/2026 (offline + 2 janelas reais):** `python tools/teste-chat-janelas.py` 71/71 (abre na mensagem
   nova, não abre em `InProgress`, origem barrada com 403, sem credencial na url/log; `--real` mediu foco e posição).
   Falta 1 mensagem real enviada pelo Gabriel: vai junto do passo 9.
   **Tela 5** (chat em janelas): coletor serve `/chat/*`, abre uma janela Edge app por conversa
   (`janela_painel` como base, até 3, sem roubar o foco, nenhuma em `InProgress`), plugin alimenta amigos/conversas,
   envia mensagens e convites; contador 💬 de `unreadMessageCount`.
   — **prova:** `python tools/teste-chat-janelas.py` com LCU falsa (mensagem nova abre a janela da conversa; em
   `InProgress` não abre) + 1 mensagem real enviada pelo Gabriel.
   **reprova se:** a janela abre fora da área útil, rouba o foco, ou a credencial da LCU aparece na url/log do coletor.
7. [x] **Feito 13/10/2026:** `node tools/teste-compacto-posjogo.mjs` 62/62 com a partida 3292746609 (painel fechado até
   o clique, abre se a camada cair ainda no `EndOfGame`, jogar de novo pelos freios, CSS sem vazar para a tela 1).
   **Tela 4** (pós-jogo compacto): "carregando" em `WaitingForStats`/`PreEndOfGame`; lições do
   `GET /licoes/<gameId>`, jogar de novo existente (mesma fila, regra de grupo), "ver análise completa" expande e abre
   o `#lc-posjogo`; no compacto o `posjogo/index.js` não abre o painel sozinho. — **prova:** teste node com partida
   gravada 3292746609 + `EndOfGame` com o compacto ligado → `#lc-posjogo` fechado até o clique.
   **reprova se:** o jogar de novo pula os freios ou o painel grande cobre o pós-jogo compacto.
8. [x] **Feito 13/10/2026:** README (tabela, Configurações, o que só a partida prova, medidor), ARMADILHAS (§ Client e
   Pengu, § LCU, § Windows), hub do cérebro e o resumo visual com os prints do protótipo aprovado.
   **Docs:** README (tabela "o que faz" + bloco nas Configurações), ARMADILHAS (o que a medição achar),
   hub do cérebro. — **prova:** `grep -n compacto README.md docs/ARMADILHAS.md` → linhas novas.
   **reprova se:** zero linhas.
9. [ ] **Prova no client com ele:** uma ranqueada inteira no compacto (lobby → fila → champ select com 1 troca →
   pós-jogo → jogar de novo). Verificação manual (precisa de partida real e de outro jogador para a troca).
   **1ª ranqueada no compacto (14/10/2026 10:12-10:15, solo/duo; ele travou pelo client normal e jogou):** 3 defeitos
   na tela 3, causas e correção em ARMADILHAS § LCU; prova offline `node tools/teste-compacto-selecao.mjs` 128/128
   (fixture `selecao-ranqueada-20261014.json`, remontada do medidor).
   - TRAVAR não travou: o `POST .../complete` sem corpo trava o campeão 0 (`LeagueClient.log`, 4 tentativas com 204).
     **Provado.** Agora 1 `PATCH {completed:true, championId}` (o corpo da Riot), conferido na sessão depois.
   - Declarar pedia 2 cliques: nenhum PATCH no PLANNING. **Provado.** Agora o clique na grade já declara.
   - Grade do ban vazia: as 5 leituras de `bannable-champion-ids` voltaram 200, conteúdo não gravado. **Dedução**
     (lista vazia ou sem id do catálogo); no ban essa lista não filtra mais e o tamanho vai para o log.
   - Revisão antes do commit (10 achados, todos com caso de teste): botão que nasce no lugar da grade (marcador fixo e
     `ARMAR_MS`), travar pendente que trocava de campeão, escrita sem prazo, clique na grade durante o travar, escolha
     sem lista mostrando campeão que ele não tem, cinza sem motivo, clique duplo, reenvio de hover, fixture com 2
     bandeiras supostas (o medidor passou a gravar), diff do ARMADILHAS misturado.
   - **Falta provar na próxima seleção dele** (com a interface recarregada em `None`/`Lobby`, que leva o plugin novo):
     declarar com 1 clique no PLANNING, banir pela grade, travar pelo TRAVAR, e a linha
     `[lol-client] compacto: bannable-champion-ids … n=` no `LeagueClientUx.log` (n = 0 confirma a causa da grade
     vazia; n grande com `noCatalogo` > 0 derruba a dedução e a causa volta a ser procurada).
10. [ ] **Relato da 3ª ranqueada de 14/10/2026 (~14:43), 5 ajustes.** Construído e provado offline em 14/10/2026; falta a
    prova na próxima partida dele (fim deste passo). Palavras dele e o que mudou:
    1. "O tema compacto quebrou e mostrou o lobby expandido porém dentro do modo compacto. E aí voltou para o modo compacto
       assim que entrou na seleção." Sequência (`dados/coletor.log` e o `LeagueClientUx.log` da carga das 14:08): ready
       check 1 (14:42:58; ele mesmo clicou no ACEITAR do popup da Riot, linha `readyCheck ACCEPT`, enquanto o POST do plugin
       levava 2,2 s), um jogador não aceitou, `Matchmaking` por 2 s (14:43:11), ready check 2 (14:43:13), seleção
       (14:43:24). **Causa:** não era o roteador deixar de remontar a fila: montagem não logava nada, e as 2 linhas "ceder"
       iguais só saem se o estado mudou entre elas (o teste com a mesma sequência mostra a fila montada no meio). Era o
       destino do `ReadyCheck`: "ceder" tirava a camada e deixava a janela de 420 com a tela da Riot de 1280 cortada e só a
       faixa do `#lc-aceite` por cima, nos dois ready checks. **Correção:** `ReadyCheck` com o aceite automático vivo = a
       tela da fila ("partida encontrada", anel parado, sem cancelar) por baixo do `#lc-aceite`, que no compacto fica logo
       abaixo do topo, na largura da janela; aceite desligado, `aceite.js` quebrado ou "não aceitar" (popup da Riot de volta)
       seguem expandindo. Como a camada agora cobre o popup da Riot, ready check sem o `#lc-aceite` visto em 1,5 s
       (`CONTAGEM_MS`; caso do aceite que não agiu às 10:10 de 14/10) expande para o popup da Riot ficar à mão; a contagem que
       some depois de vista (aceitou, esperando os outros) não expande. Na seleção, enquanto a sessão não chega, a fila
       segue em "partida encontrada" (nunca "buscando" com cancelar). Toda montagem de tela loga
       (`[lol-client] compacto: tela <nome> (<fase>)`). Decisão técnica (confiança alta; reverte se o popup da Riot
       precisar ficar à vista no compacto: aí o ready check expande).
    2. "As fotos dos campeões mostrando intenção não aparecem. Só depois que pica. Tem como mostrar as fotos já na
       intenção?" A tela 3 mostrava a intenção dos aliados só em texto. Agora a foto da intenção (`championPickIntent` ou a
       ação aberta; a dele também) aparece apagada e com borda tracejada; travado = foto normal. Inimigo segue só com o pick
       completo (guardrail).
    3. "A altura da janela pode ficar um pouco maior, porque acabou mostrando uma barra de rolagem desnecessária durante a
       seleção, foi durante a tela de intenção." Medido no harness (`temp/compacto-harness/telas.html` + `servir.mjs`,
       Playwright, sessão da ranqueada de 14/10): em 640 o corpo passava 15 px no PLANNING e 26 px na vez de outro com os
       bans revelados; em 680, 0 nas 8 fases medidas, e lobby, fila e pós-jogo só ganham folga embaixo. `compacto.alt`
       padrão 680; a config dele tem 640 salvo e não há campo nas Configurações, então o `carregar()` troca 640 (o padrão
       antigo, nunca escolha) por 680, como faz com o `limiteS`. E a janela que já está pequena noutro tamanho (o plugin
       recarregado com a janela de 640 ainda aberta) encolhe para 420×680 na próxima montagem (`criarJanela.noTamanho`,
       folga de 8 px); antes, "já pequena" bastava e o 680 só valeria depois de expandir e compactar de novo.
    4. "Quero poder usar o scroll para rolar entre as skins." Roda do mouse na faixa de skins rola para o lado; no
       começo/fim da faixa (ou com tudo à vista) a roda segue para a tela; a faixa repintada pelo clique volta ao ponto rolado.
    5. "Quando estou na fila, o círculo spinner não preenche, não completa o giro do círculo. Ele sempre reinicia sempre que
       conta um segundo a mais no contador." O evento da busca chega a cada ~1 s e cada um recriava o anel (animação do
       zero). Agora o anel é o mesmo elemento a montagem inteira (Matchmaking e ReadyCheck na mesma tela, sem remontar) e
       nasce com a fase do giro presa ao relógio.
    — **prova offline:** `node tools/teste-compacto.mjs` 115/115, `teste-compacto-lobby.mjs` 135/135,
    `teste-compacto-selecao.mjs` 141/141, `teste-compacto-posjogo.mjs` 85/85, `teste-aceite.mjs` 43/43 (casos novos
    vermelhos antes da correção); harness: a mesma `Animation` do anel depois da releitura de 5 s (código antigo: animação
    nova), 1 só `tela fila (Matchmaking)` no log com o ready check no meio; prints antes/depois em
    `temp/compacto-harness/2026-10-14-*.png`. **Falta na partida dele:** a contagem do aceite por cima da fila num ready
    check real (as fontes da Riot podem mudar a altura da faixa; o anel desce 100 px para ela), a foto da intenção de um
    aliado numa ranqueada, a roda numa faixa de skins real e a janela de 680 na tela dele (se o `innerHeight` depois do
    `ResizeTo` não der 680 ± 8, o compacto pede o `ResizeTo` a cada tela nova: inofensivo, mas é sinal para ajustar). No `LeagueClientUx.log`: nenhum
    "ceder"; `tela fila (Matchmaking)` uma vez por fila (o ready check não remonta), `tela fila (ReadyCheck): atualizada`
    a cada ready check e `tela champselect (ChampSelect)`.

    **Revisão adversarial do passo 10 (14/10/2026, só leitura) e o que entrou por ela.** Com o ready check na tela da
    fila, `Matchmaking` e `ReadyCheck` passaram a ter a mesma chave no roteador (`tela:fila`); antes o "ceder" trocava a
    chave e isso zerava sozinho o "⤢ expandir" e a regra 7 a cada virada. Achados corrigidos, cada um com caso de teste:
    - um `div.modal` no ready check cujo `.ready-check-root-element` chega depois da folga de 250 ms da vigia (que só vê
      filhos diretos do wrapper) era lido como modal desconhecido: expandia e, pela chave igual, seguia expandido na
      busca seguinte. Agora `aoModal` no ready check confere de novo em 1 s (`MODAL_RC_MS`) e só expande se o modal segue
      desconhecido; sair do ready check zera "⤢ expandir" e regra 7 daquele ready check (entrar nele não zera: expandido
      na busca segue expandido no aceite, como antes);
    - sem a contagem em 1,5 s o client expandia e, se ela chegasse depois, encolhia de novo embaixo do cursor dele: agora
      fica expandido até o fim daquele ready check;
    - a troca de fase sem remontar também loga (`tela fila (ReadyCheck): atualizada`), senão o log não separa "a fila
      ficou no ready check" de "nada aconteceu";
    - a nota da fila no ready check segue a contagem: "esperando a contagem do aceite…" → "responde na contagem do
      aceite, aqui em cima" → depois que ela some (o `aceite.js` tira a contagem antes do GET/POST do aceite) "aceitando
      a partida: esperando os outros jogadores";
    - a posição da faixa de skins agora é guardada no evento `scroll` (deslize do touchpad e arrasto da barra), não só
      na roda;
    - teste novo: hover inimigo em andamento (`champselect-real.json` ev 18, 23, 51, 57) nunca vira foto nem entra na
      lista de inimigos.
    Fica para a partida (não dá para medir sem as fontes da Riot): a contagem do `#lc-aceite` pode quebrar em 3 linhas e
    passar dos 100 px que o anel desce; se cobrir o "partida encontrada", encurtar o texto dela ou medir a margem pela
    altura real. **Mudança de comportamento que ele precisa saber:** no compacto o popup da Riot do ready check fica
    embaixo da camada; o aceite manual é o "aceitar agora" da contagem (ou "não aceitar", que devolve o client normal).
    Decisões técnicas (closer do workflow, opus, 14/10/2026): conferir de novo o modal em vez de ignorar todo modal no
    ready check (um modal desconhecido de verdade ainda expande), confiança alta; zerar a escolha ao sair do ready check
    em vez de pôr a fase na chave (pôr a fase encolheria no aceite quem expandiu na busca), confiança média, reverte se
    ele quiser o "⤢ expandir" do ready check valendo também na busca seguinte.
    — **prova:** `teste-compacto.mjs` 122/122, `teste-compacto-lobby.mjs` 136/136, `teste-compacto-selecao.mjs` 143/143,
    `teste-compacto-posjogo.mjs` 85/85, `teste-aceite.mjs` 43/43, `teste-config.mjs` 49/49 (`rodar-testes.py` não roda
    com o jogo aberto).
11. [ ] **Paridade com o expandido (pedido de 14/10/2026 ~15:35).** Grupo 1 (b1-b6) **feito em 14/10/2026** (bloco "Grupo 1
    feito" abaixo); o que falta é o grupo 2 (d1-d3, protótipo no passo 13). Palavras dele: "garanta que todos os outros recursos
    que implementamos no modo expandido também tenham no modo compacto." Inventário e conferência no código em 14/10/2026
    (só leitura, `pengu/index.js`, `compacto/*`, `posjogo/index.js`, `champselect.js`, `runas.js`, `recompensas.js`,
    `config.js`, `aceite.js`, `sem-popups.js`, `estilo.css`, README). **Regra de dono:** `compacto/tela-champselect.js` e
    `tela-fila.js` são da frente seleção (passo 10: fotos da intenção, altura, roda de skins, anel);
    `compacto/tela-posjogo.js`, chat do pós-jogo, honra/placar, mentor e o painel de 6 abas no compacto são da frente fim
    de partida (protótipo `temp/2026-10-14-prototipo-compacto-fim-de-partida.html`). Correção num arquivo de outra frente
    = **especificar para ela** (o quê, linha, prova), nunca editar direto. **Revisto na construção do grupo 1 (14/10/2026):**
    a tarefa mandou construir b1-b6, a única frente concorrente no ar era `coletor/*.py` e os dois arquivos estavam limpos
    no `git status`; b5 e b6 foram editados direto em `tela-posjogo.js` e `tela-champselect.js`, com mudança mínima.
    Legenda: [S] = não medido no client real.

    **a) Já existe nos dois modos (18, nada a fazer):** aceitar sozinho com contagem e "não aceitar" (`#lc-aceite` por
    cima da tela da fila; "não aceitar" expande) · atraso do aceite · client pisca e volta para trás (com o [S] da janela
    devolvida a 1280 pelo `ux-show`, que o roteador reencolhe) · calar o som em loop · janelinha aceitar/recusar e reserva
    do aceite no coletor · fila rápida (= JOGAR da tela 1, mesmo `buscarFilaRapida`) · fila e posições (a tela 1 grava em
    `filaRapida.*`) · freios de tilt e madrugada (telas 1 e 4) · jogar de novo e buscar (tela 4) · runa automática ao
    travar (✓ na tela 3) · escolha entre 2+ páginas (dentro da tela 3) · calar o aviso de runas mudadas e o de golpear ·
    painel da 2ª tela, voz, moldura, overlay, F8/F9 (na partida a camada sai) · V/D, KDA e farm na tela 4 (PDL segue
    [S], `tela-posjogo.js:8`) · fechar a tela de estatísticas · coleta de recompensas · ⤢ expandir, Ctrl+Shift+M e
    "▣ modo compacto" · MCP.

    **b) Corrigir sem tela nova (categoria 1; ordem de execução):**

    | # | lacuna | correção | arquivo · dono |
    | --- | --- | --- | --- |
    | 1 | análise só começa no clique em "ver análise completa" com a camada à vista: o ramo `compactoAVista()` retorna sem `obterAnalise` | chamar `obterAnalise(gid)` antes do `return`; o `aoMudarAnalise` desiste sozinho com `ultimaAberta` nulo, então nada é desenhado embaixo da camada | `pengu/posjogo/index.js` ~488-500 · livre |
    | 2 | Ctrl+K "analisar última partida" no compacto abre o painel em `display:none`; o `aoClicarFora` dele fecha no 1º clique na camada e o `keydown` de captura come o Esc enquanto ele existe | no `perform`, `compacto.expandir()` quando `compacto.estado().efetivo === 'compacto'` e só depois `analisarUltima()` | `pengu/index.js` (`registrarAcoes`, ~70) · livre |
    | 3 | avisos por `Toast` direto podem ficar embaixo da camada [S] | trocar pelo `avisar` de `compacto/comum.js:98` (já põe o aviso dentro do `#lc-compacto` quando ele existe e cai no Toast quando não): `runas.js:43` ("página da regra sumiu", "tua runa atual é a de X"), `recompensas.js:221` ("recompensa para escolher", falhas), `config.js:186` (confirmações do Ctrl+K). `fila-rapida.js` e `posjogo/index.js:297` só agem no expandido: ficam | `runas.js`, `recompensas.js`, `config.js` · livre |
    | 4 | travar no compacto com 2+ páginas e expandir antes de escolher: o `aoTravar` devolveu `acao:'compacto'` e marcou `tratado`; expandido, o popup não abre e fica a runa atual sem aviso (raro) | rodar `aoTravar` de novo ao sair do compacto na fase `ChampSelect` com a escolha pendente | `pengu/runas.js` · livre |
    | 5 | lições da tela 4 mostram "fora" sem o coletor (o motor local do painel não roda) | export novo em `servicos.posjogo` com as lições da análise local (depende do item 1; custo: partida + linha do tempo, até ~75 s com as novas tentativas). Consumo na tela 4 | export: `posjogo/index.js` · livre; consumo: `tela-posjogo.js` · feito aqui (ver "Regra de dono") |
    | 6 | selo do champ select: os dados já existem e a tela 3 não usa | reaproveitar `servicos.champ.coach()`, `estatisticas(id,pos)` e os formatadores `textoSelo`, `linhaMatchup`, `linhaTrauma`, `linhasDraft` de `champselect.js` (nenhuma leitura nova; o `champselect.js` já busca `/draft/<id>` a cada 3 s nos dois modos); o `estatFav` ignora `champSelect.ligado` (1 linha) | `compacto/tela-champselect.js:903-912` · feito aqui, só winrate/KDA/posição (ver "Regra de dono"); matchup, trauma e draft no passo 13 |

    Decisões técnicas (orquestrador, 14/10/2026): (i) Toast → `avisar` do compacto, confiança alta (ele já escolhe pelo
    DOM e o Toast segue como reserva); reverte se a medição do item c2 mostrar o Toast por cima da camada e ele preferir o
    visual da Riot. (ii) "runa X aplicada" **não** vai para o aviso da camada quando ela está à vista (sairia em dobro com o
    ✓ da tela 3), confiança média; reverte se ele sentir falta da confirmação.

    **c) Medir no client real (só leitura, fase `None`/`Lobby`, antes de decidir):**
    1. a CommandBar do Ctrl+K desenha por cima do `#lc-compacto` (z 100000)? Se sim, toda chave liga/desliga e de ciclo
       já se edita sem expandir e o item d1 encolhe para os blocos com campos (regras de runa, escolhas do coach).
    2. o Toast do Pengu fica embaixo da camada? Com o b3 feito, só documenta (ARMADILHAS).
    3. celebração depois da coleta de recompensas (achado novo): a coleta roda na carga e 30 s depois da partida, com a
       tela 1 à vista; `.vignette-celebration` dispara a regra 7 e o `est.forcado` só limpa quando o destino muda →
       provável lobby expandido até a próxima busca depois de toda partida com recompensa. Confirmado → voltar ao
       compacto quando o modal da Riot fecha (`compacto/index.js` `aoModal`/`alvo`, livre; registrar como decisão
       técnica) ou aceitar como está.
    4. PDL da tela 4 (frente fim de partida; segue [S] até a medição).

    **Medido (14/10/2026, fase Lobby, só leitura):** c1: a CommandBar **não** fica por cima: raiz `fixed … z-[99]` (só
    existe aberta) contra 100000 da camada; lido no `core.dll` do Pengu 1.1.6, não visto na tela (abrir exigiria tecla).
    No compacto o Ctrl+K abre invisível; o b2 cobre só o "analisar". Proposta não aplicada nem medida:
    `html.lc-modo-compacto .fixed.top-0.left-0.z-\[99\] { z-index: 100001 !important }` (CSS sobre classe Tailwind do
    Pengu, quebra calada numa atualização; não sei se a paleta monta em shadow root); aplicada, o d1 encolhe. c2: o Toast
    é `fixed` z 9999, embaixo da camada (mesma fonte) → o b3 era necessário. c3: **não** expandiu na única observação (carga
    das 19:39:55, 2 recompensas): o `.dialog-toast-celebration` chega dentro de `div.lol-uikit-toast-celebration-layer`, a
    regra 7 só casa o filho direto do wrapper, `expande: null`, lobby seguiu compacto. Sem prova: a coleta 30 s depois de
    uma partida, a `.vignette-celebration` e um `div.modal` das 19:40:08 depois de um "expandido por ti". ARMADILHAS § Client
    e Pengu.

    **Grupo 1 feito (14/10/2026; construtor + revisão + fechamento por subagentes do orquestrador):**
    b1: no EndOfGame com a camada à vista, `obterAnalise(gid)` roda antes do `return`; nada desenha embaixo dela.
    b2: Ctrl+K "analisar última partida" passa por `expandirAntes` (`compacto/index.js`): expande e só então abre; se a
    camada não sai, não abre e avisa. No fim de partida do Rift abre a partida que acabou pelo mesmo `abrir` do "ver análise
    completa" (`posjogo.analisarAgora`, que para a vigia da camada: sem isso saíam 2 `abrirPainel`, talvez de partidas
    diferentes); fora dele, `analisarUltima` mostra "procurando a última partida…" antes da leitura do histórico (até ~40 s)
    e não abre se ele fechou a caixa ou se a camada voltou. b3: Toasts de `runas.js`, `recompensas.js`, `config.js` passam
    por `comum.avisar` (dentro da camada à vista, Toast sem ela); "runa X aplicada" não sai com a camada (decisão ii).
    b4: travar com 2+ páginas no compacto deixa a escolha pendente; quando `lc-modo-compacto` sai (`comum.vigiarClasse`)
    o popup abre, sem `ux-show`/`ux-flash`, salvo se a página atual já é candidata; "manter a atual"/Esc e o clique numa
    página da tela 3 (`runas.escolheu`, antes do PUT) contam como escolha; 1 página, sem regra e runas desligadas limpam a
    pendência. b5: `posjogo.licoesLocais(id)` (o motor e a análise em cache do painel) alimenta a tela 4 enquanto as
    lições do coletor não chegam (fora, status 0, "esperando"), rótulo "3 lições · sem o coletor"; fora do Rift nem pede.
    b6: selo do campeão em hover ou travado na coluna da direita da linha "tu" (2 linhas: "12 partidas · 58% · KDA 3,1" e
    "selva: 5 partidas · 60%"; texto inteiro no title), dos números do `champselect.js` (nenhuma leitura nova); leitura
    que falhou = "histórico indisponível agora".
    Decisões técnicas (opus, 14/10/2026): (iii) abertura automática com a análise **já pronta** (camada que cai no
    EndOfGame depois do b1: "⤢ expandir" dele, regra 7) não abre o painel por cima: fica o botão "análise pronta" (D4);
    revê a decisão de 13/10 "o expandir no EndOfGame abre o painel" só para esse caso; com a análise em voo segue abrindo
    quando fica pronta se ele não mexeu. Resíduo: expandir antes da análise ficar pronta ainda abre sozinho depois;
    expandir depois dá o botão. Confiança média; reverte se ele quiser o painel abrindo sozinho ao expandir. (iv) lições
    locais enquanto as do coletor não chegam (não só com ele fora), como o painel; com o histórico disponível na hora da
    análise (sem refazer depois das 200 partidas: vale a armadilha da 3ª lição diferente). Média; reverte se ele estranhar
    lição local trocada pela do coletor. (v) selo na coluna da direita, 2 linhas de 10,5 px (harness 420×680: linha em 42 px,
    rolagem 0 em 6 fases; uma 3ª linha embaixo do nome ia a 50 px). Média; reverte se ele não gostar do lugar (aí entra
    no passo 13). (vi) página atual já candidata = escolha feita; `fecharPopup()` de fora não conta. Alta. (vii) com
    "winrate no champ select" desligado somem o selo **e** os números dos favoritos (mudança além do b6). Média; reverte
    (dono: gabriel) se ele quiser os números dos favoritos mesmo com o selo desligado. (viii) a celebração da Riot segue por
    baixo da camada (c3). Média; reverte se ele quiser ver a celebração.
    Nota sem correção: 2 avisos seguidos da mesma coleta de recompensas deixam só o último visível na camada (o Toast
    empilhava).
    — **prova:** `teste-compacto.mjs` 122 → 127, `teste-compacto-selecao.mjs` 143 → 157, `teste-compacto-posjogo.mjs`
    85 → 104, `teste-runas.mjs` 4/4 com extras 5 → 21, `teste-recompensas.mjs` 39 → 41, `teste-config.mjs` 49 → 50, todos
    verdes; casos novos vermelhos antes da correção (os de b2 e da análise pronta conferidos revertendo a correção).
    Sem mudança e verdes: `teste-compacto-lobby` 136, `teste-aceite` 43, `teste-posjogo` 11, `teste-jogar-de-novo` 96,
    `teste-sem-popups` 22, `teste-chat-posjogo` 45, `teste-winrate`, `teste-licoes`, `teste-abas`, `teste-matchup`.
    `rodar-testes.py` não roda com o jogo aberto. **Falta (só a próxima partida prova):** nada visto no client real (vale
    depois da recarga no lobby); selo com as fontes da Riot; lições locais com o coletor fora de verdade; Ctrl+K num
    EndOfGame real; celebração 30 s depois da partida e `.vignette-celebration`.

    **d) Precisa de tela nova: protótipo único + aprovação do Gabriel antes de código (regra do passo 0).** Protótipo,
    viabilidade e parecer de d1-d3 vivem no **passo 13** (telas B1-B3); o texto abaixo é o levantamento de origem.
    1. Configurações de dentro do compacto: hoje não há engrenagem e abrir as Configurações da Riot expande (regra 7).
       Mesmo "⚙ expandir e abrir as Configurações" é elemento novo (`compacto/modo.js` `criarCamada`). Tamanho depende do c1.
    2. Selo completo na tela 3: KDA, recorte por posição, campeão em hover ou travado (hoje só "n partidas · wr%" geral
       dos favoritos), matchup, "X é trauma", força do draft e "coletor fora". Não há lugar na tela 3 para isso; a frente
       seleção não cobre (tela dela) → protótipo, depois especificado para ela.
    3. "📊 reabrir análise" no lobby: no expandido o botão fica até o próximo aceite (README); no compacto fica em z 99990,
       embaixo da camada (100000), e `ultimaAberta` segue nulo se a análise nunca abriu, então baixar o z-index não
       resolve. Falta um caminho na tela 1 (`compacto/tela-lobby.js`, livre; fronteira com a frente fim de partida).
    **Proposto (dono: gabriel):** o chat de time da seleção e o da tela de estatísticas são da Riot, não do plugin, e o
    💬 do compacto cobre só conversas 1:1 (`chat-botao.js:3`). Se para ele paridade é "tudo o que eu uso", entra no
    protótipo do d. Recomendo deixar de fora agora: o chat do pós-jogo já está com a frente fim de partida e o da seleção
    não teve pedido.

    **e) Já com as outras frentes (não duplicar):** chat do pós-jogo melhorado, honra e placar dos 10, veredito e
    pergunta ao mentor, painel de 6 abas no compacto, PDL (frente fim de partida); fotos da intenção, altura, roda de
    skins, anel (frente seleção). Conferido: `chat-posjogo.js` não chama `focus()` (linha 33), não rouba o teclado por
    baixo da camada.

    **f) Não faz sentido no compacto:** § Descartado e impraticável (linhas "paridade, 14/10").

    **Correções ao inventário:** a dica do coach no lobby é só do compacto (o coletor não tem a rota `/dica`): sobra, não
    lacuna. `favoritos`, `larg`, `alt` não têm campo em nenhum modo (README): não é paridade. Fila rápida: paridade
    completa (o Toast dela só existe no botão da barra da Riot; a tela 1 usa o aviso da camada). Recompensas: a coleta
    vale nos dois; o risco é o c3.

    **O que o pedido não dizia (completei no levantamento):** c3 (celebração que deixa o lobby expandido), b4 (runa
    pendente ao expandir) e o b2 ser pior que "não abre" (o painel invisível come o Esc e o 1º clique).
    — **prova:** b1-b4: casos novos vermelhos antes e verdes depois em `node tools/teste-compacto-posjogo.mjs`
    (`EndOfGame` com a camada à vista → `obterAnalise` chamado e `#lc-posjogo` ausente), `teste-compacto.mjs` (Ctrl+K
    com a camada → `expandir` antes do painel), `teste-aceite.mjs`/teste de runas (aviso dentro do `#lc-compacto` falso;
    `aoTravar` de novo ao expandir com escolha pendente); `rodar-testes.py` inteiro verde. c1-c3: resultado anotado em
    ARMADILHAS § Client e Pengu. b5/b6: especificação entregue às frentes, com linha e prova. d: protótipo publicado em
    `temp/` e o parecer dele colado aqui.
    **reprova se:** item d com código de produto antes da aprovação dele; correção feita direto em arquivo de outra
    frente; aviso "runa aplicada" em dobro na tela 3; algum caminho do b2 abre o painel com a camada ainda à vista.
12. [ ] **Fim de partida compacto (parecer de 14/10/2026 ~20:00 com 2 ajustes e 3 complementos; construído offline e
    revisado em 14/10, falta a partida real: blocos "Aprovação e construção" e "Revisão adversarial" no fim deste passo).** A regra do passo 0 valeu até o
    parecer; o texto abaixo é a proposta de origem. Pedidos dele (14/10/2026): ~15:30 "Tem como a tela pós-jogo, de honra, de
    detalhes do pós-jogo, com o chat, a análise do mentor etc, também funcionarem no modo compacto?" e depois "No modo
    compacto, também quero o chat pós-jogo. Com aquela mesma ideia de botar a foto dos campeões. Pode ficar ali na parte
    de baixo, em cima do botão de jogar de novo."
    **Protótipo:** [temp/2026-10-14-prototipo-compacto-fim-de-partida.html](../temp/2026-10-14-prototipo-compacto-fim-de-partida.html)
    (abre com duplo clique, zero requisição externa, janela 420×680 = `compacto.alt` atual; `#A` a `#D` abrem direto).
    Telas: **A honra** (`PreEndOfGame`, sequência `honor-vote`) · **B pós-jogo** (`EndOfGame`: faixa V/D + KDA + farm +
    PDL; abas resumo = mentor + lições e detalhes = tu × adversário direto e os 10) · **C chat da sala** (dentro da B,
    logo acima do JOGAR DE NOVO, foto do campeão de quem falou; também na A, recolhido) · **D navegação** (carregando em
    `WaitingForStats` e o fluxo das fases). Dados da partida real 3293137136; só o Gabriel com nome (resto "aliado
    N"/"inimigo N" + campeão), mensagens de chat inventadas. Prints de 14/10 16:32–16:36 em
    `temp/prototipo-fim-de-partida/`; o `tela-A.png` foi refeito às 16:45 depois do ajuste do relógio. O HTML é a
    referência. **Parecer** (botão "copiar meu parecer", chave `lc-prototipo-fim-de-partida-v1`): 1ª linha
    `parecer do protótipo do fim de partida compacto (14/10/2026)`, depois `tela A honra: …`, `tela B pós-jogo: …`,
    `tela C chat da sala: …`, `tela D navegação: …`, cada uma `aprovada`, `ajuste: <texto>` ou `sem parecer`.

    **Viabilidade (14/10/2026, só leitura: GET na LCU, JS da Riot do `assets.wad`, logs, `dados/lol.db`; sonda redigida
    da partida 3293149183 em `temp/posjogo-sonda-2026-10-14.jsonl`; nenhum POST/PATCH/voto).** As 4 telas cabem como
    camada nossa por cima (a UI da Riot fica em 1280 e o Ember dela segue rodando embaixo). [S] = não medido.

    | tela | leitura | escrita (só por clique dele, rotas e corpos do front da Riot) | limite / [S] |
    | --- | --- | --- | --- |
    | A honra | `GET /lol-honor-v2/v1/ballot` (+ evento): `eligibleAllies[4]`, `eligibleOpponents[5]` (puuid, campeão, função, `skinSplashPath`), `votePool.votes` (1 a 4 por partida), `honoredPlayers[]` ao vivo (medido 0→1→4) = fonte de "já votei"; fim = `GET /lol-pre-end-of-game/v1/currentSequenceEvent` deixa de ser `honor-vote`; `SecondsToVote` 40 em `/lol-honor-v2/v1/config` | votar `POST /lol-honor/v1/honor {recipientPuuid, honorType:"HEART"}`; pronto/pular `POST /lol-honor/v1/ballot` sem corpo; pular a espera `POST /lol-pre-end-of-game/v1/skip-pre-end-of-game` (a Riot só oferece com ballot vazio depois de 5 s). Fora: `honor-v2/v1/honor-player`, `DELETE ballot`, `complete/{seq}`, `ballot/refresh` | a cerimônia da Riot segue viva embaixo (relógio, envio automático, som `honor-vote-cast.ogg`): voto nosso não desconta o contador dela, então sem "pronto" a fase espera os 40 s; "pronto" nosso + envio automático dela = 2 `POST ballot`, efeito [S]; nosso relógio é estimativa (a LCU não dá o tempo que falta) e **ao zerar não trava nada**: voto e pronto valem até o evento; ballot vazio no 1º GET = esperar o evento; fila sem honra ou ballot vazio passados ~5 s → "sem honra nesta partida", sem pular sozinho; som da Riot embaixo [S] (precedente `aceite.embrulharAudio`) |
    | B pós-jogo | `GET /lol-end-of-game/v1/eog-stats-block` (+ evento; 404 fora do pós-jogo; já existe antes da honra, ARMADILHAS § tabela `eog`): `gameLength`, `queueType`, `teams[2]`, 10 jogadores com campeão, Riot ID, `items[7]`, feitiços, posição, `stats` (183 chaves); PDL pelo `lp` do coletor (46→64 medido; nas 2 partidas de 14/10 o valor novo já estava no `PreEndOfGame`); mentor `GET 127.0.0.1:8765/mentor/<gameId>` (`nada/pensando/pronto/erro`, rótulos Veredito/O essencial/Mandou bem/Próxima partida, parser `partesMentor` de `pengu/posjogo/abas.js`) | perguntar `POST /mentor/<id>/pergunta {pergunta}` → 202; jogar de novo = tela 4 aprovada (freios) | mentor fica pronto 57–106 s depois do fim (n=7): "analisando…" nunca segura o jogar de novo; sem coletor = botão cinza com motivo; 10 linhas de ~30 px cabem, itens/runas/feitiços ficam no "⤢ análise completa"; nomes de terceiros só como o client já mostra no pós-jogo (`cfg.chatPosjogo.nomes`), sempre `esc()`, nunca no log; PDL sem coletor segue [S] (11.c4) |
    | C chat da sala | `GET /lol-chat/v1/conversations` com `type:"postGame"` (id `<gameId>-eog@lol-post-game.br1.pvp.net`), `.../{id}/messages` (`fromPuuid` → elenco do eog, como o `montarElenco` de `pengu/chat-posjogo.js`; reserva: puuid do ballot); `GET /lol-chat/v1/player-mutes` → `isSystemMuted` | enviar `POST /lol-chat/v1/conversations/{id}/messages {type:"chat", body, …}` [S] (nunca medido) | sala nasce 0,1–1 s depois do `PreEndOfGame` e morre ao sair do pós-jogo (5 a 8 saíram em 30–60 s); `password`/`mucJwtDto` da conversa nunca guardados nem logados; mora **na camada do plugin**, não nas janelas de `coletor/chat_janelas.py` (barram `@post-game.` de propósito) |
    | D navegação | `gameflow-phase` + `currentSequenceEvent` | nenhuma | `WaitingForStats` 0,7–7 s; honra 10–43 s (teto 40); celebrações (`challenge-level-up`, `missions`, `ranked-celebration`) < 0,1 s quando vazias; voltar ao compacto depois de uma celebração expandida [S] (11.c3) |


    **Fica de fora do compacto (expande, regra 7), e por quê:** ~~denunciar, adicionar amigo~~ (entraram pelo pedido dele de
    ~20:05/~20:08, ver o bloco da construção) e silenciar (menu "..." é modal da Riot), aba Progresso, celebrações (subir de elo, desafio, nível de honra) e o chat de dentro da partida (só existe
    na tela do jogo). **Única mudança de regra:** a regra 7 (`pengu/compacto/index.js`, ~linha 81: honra expande) passa a
    valer só fora de `honor-vote`; ver § Descartado (linha da honra reaberta). **Termos/Vanguard:** só LCU, nada toca o
    processo do jogo; voto, pronto e pular só por clique dele (nada automático, nem "votar no último").
    **Ligações:** 11.b5 (lições sem coletor, consumo na tela 4), 11.c4 (PDL), 11.d3 (sem caminho para reabrir a análise no
    compacto: o "analisando…" do protótipo diz que a resposta reabre pelo 📊 do client normal), 11.e (esta frente).
    **Ajustes da revisão (14/10/2026, antes de pedir o parecer):** relógio estimado zerado não desabilita mais coração nem
    pronto (antes travava voto válido se a Riot começou a contar depois de nós) e o botão "tempo acabou · ver o pós-jogo",
    que prometia uma ação que a LCU não tem, saiu (o protótipo ganhou o simulador "a Riot fechou a honra"); o "analisando"
    deixou de prometer o painel grande depois (11.d3); derrota marcada como simulada (PDL inventado); de onde vem o
    elenco do chat na honra e a volta das celebrações marcada [S].
    **O que o pedido não dizia:** (i) a tabela `eog` de `dados/lol.db` (26 linhas) guarda `multiUserChatPassword` e
    `mucJwtDto` crus, credencial da sala: proposta para a frente do coletor (tirar os campos ao gravar e limpar as linhas
    antigas; `coletor/` tem trabalho de outra sessão em aberto, não mexido aqui); (ii) `/lol-honor-v2/v1/vote-completion`
    só atualiza minutos depois: não serve de sinal de fim, quem serve é o `currentSequenceEvent`.
    **Fora deste passo:** a 2ª metade da mensagem dele ("A ideia do malfight sendo notificado quando eu estou morto é a
    mesma coisa que eu falei antes. Se eu estiver na base ou morto, não faz sentido avisar. Agora, de outra forma, tem que
    avisar se voltou e em qual lane voltou.") é do coach ao vivo (`coletor/coach_vivo.py`, `coletor/avisos.py`): vai para
    [calibrar os avisos](2026-10-14-calibrar-avisos.md), que outra sessão está editando agora (D2/D20 já calam o "mid
    sumiu" com ele morto ou na base). Conferir lá se o `adversario_voltou` ("o top voltou pra rota") já cobre o mid: o
    pedido pode ser só a volta do mid dizendo a rota (não verificado aqui).
    — **prova:** parecer colado no chat com as 4 linhas `aprovada` → registrar data e frase dele aqui; só então vira plano
    de construção (rotas [S] medidas antes de depender: 2º `POST ballot`, envio na sala, som da cerimônia).
    **reprova se:** qualquer `ajuste:`/`sem parecer` (ajusta o protótipo e pede de novo) ou código em `pengu/` desta frente
    antes da aprovação.

    **Aprovação e construção (14/10/2026).** Parecer dele (~20:00, colado do protótipo, literal): "tela A honra: ajuste: o
    botão 'enviar sem votar' pode ser apenas prosseguir. não precisa constar aliado/inimigo 1 a 5 · tela B pós-jogo: sem
    parecer · tela C chat da sala: ajuste: o botão de jogar de novo deve ser dois: 'ir para o lobby' e 'jogar de novo' que
    entra na fila · tela D navegação: sem parecer". Complementos: ~20:05 "isso, mostra o nome também do jogador/campeão,
    opção de adicionar o jogador também caso você não tenha adicionado"; ~20:08 "denunciar também". Leitura do
    orquestrador (dono técnico): "sem parecer" = sem objeção, constrói como no protótipo; os ajustes entram sem nova rodada
    de protótipo. Construído (offline, sem POST/PATCH no client real):
    - roteador (`compacto/index.js`): `PreEndOfGame` lê a etapa (`GET`/evento `/lol-pre-end-of-game/v1/currentSequenceEvent`);
      `honor-vote` = tela nova `honra`; outra etapa (celebração) expande só depois de 600 ms firme (`SEQ_FIRME_MS`: vazia
      passa em < 0,1 s e não pisca a janela); etapa não lida em 2 s (`ESPERA_SEQ_MS`) expande, como antes; `''` espera.
      O evento da etapa é [S] e ela vira `honor-vote` ~0,1 s depois da fase: `iniciarCompacto` relê o GET a cada 1 s (até
      45 s) enquanto a fase é `PreEndOfGame` e a etapa não é a honra.
      `EndOfGame` volta ao compacto (a chave muda de `tela:honra`/`expandir:` para `tela:posjogo`).
    - tela A `compacto/tela-honra.js`: lista do ballot com foto, Riot ID do eog (pelo puuid; sem eog, só o campeão) e
      campeão · posição, ♡ (`POST /lol-honor/v1/honor {recipientPuuid, honorType:"HEART"}`), "prosseguir" sem voto e
      "PRONTO · enviar N votos" com voto (`POST /lol-honor/v1/ballot` sem corpo), lista vazia → "pular a espera" depois de 5 s
      (`POST /lol-pre-end-of-game/v1/skip-pre-end-of-game`), ballot 404 → "sem honra nesta partida"; relógio estimado
      (`SecondsToVote`) que ao zerar não trava nada; chat da sala recolhido embaixo.
    - tela B (`tela-posjogo.js` reescrita no visual do protótipo): faixa V/D, abas resumo (mentor do coletor com veredito,
      mandou bem, próxima partida, o essencial, perguntar; lições recolhidas com veredito) e detalhes (tu × adversário
      direto + os 10 com "+"/"⚑"); chat da sala aberto acima dos botões; **IR PARA O LOBBY** (`play-again` se
      `allowedPlayAgain`, senão `dismiss-stats`; nunca busca) ao lado de **JOGAR DE NOVO** (o de sempre, freios); em grupo
      só o "VOLTAR AO LOBBY"; "análise completa" e "fechar" embaixo. Tela D = o "carregando estatísticas".
    - tela C `compacto/chat-sala.js`: só a conversa `type:"postGame"` (da conversa ficam só `id`/`type`), mensagens a cada
      1,5 s, "entrou/saiu" some, contador de quem está, foto do campeão e nome pelo `cfg.chatPosjogo.nomes`, envio só por
      Enter/clique com o corpo do client (`sendMessage` do rcp-fe-lol-social), `isSystemMuted` → campo cinza; clique no
      nome abre o cartão do jogador. Correção de 15/10/2026: as falas da sala voltam `type:"groupchat"` e o filtro só
      `chat` deixava a sala vazia (ARMADILHAS § LCU); hoje aceita os dois. Replay (baixar/assistir) na tela B e no painel
      grande: `pengu/replay.js` (pedido de 15/10, prova `tools/teste-replay.mjs`). Revisão adversarial de 15/10: `found`
      cinza e `gameType` do histórico (`MATCHED_GAME` da partida) batem com o JS da Riot; replay aberto mantém `EndOfGame`
      (coach calado); sem achado de código. Falta prova real: POSTs saindo, janela depois do replay, a mensagem dele
      aparecendo uma vez só (eco `groupchat` × cópia do POST, não medido).
    - `compacto/jogador-acoes.js`: "+" = `POST /lol-chat/v2/friend-requests {direction:"out", puuid}` (só para quem não é
      amigo nem tem pedido em `v2/friend-requests`); "⚑" abre o formulário da Riot (mesmas 3 seções, 7 categorias, 8 com a
      voz do time em `lol.client_settings.team_voice.enabled`, até 3, comentário até 255, textos pt-BR do trans.json) e só
      o clique em DENUNCIAR JOGADOR manda `POST /lol-player-report-sender/v1/end-of-game-reports {comment, gameId,
      categories, offenderSummonerId, offenderPuuid}`; desligado em personalizada e para quem está em `reported-players`.
      Rotas e corpos lidos no JS da Riot (16.20, `tools/ler-wad.py`), nunca enviados ao client real.
    **Decisões técnicas (opus, 14/10/2026; opção mais reversível):** (i) celebração só expande firme (600 ms): confiança
    média, reverte se uma celebração de verdade ficar embaixo da camada (aí `SEQ_FIRME_MS` cai ou a lista de etapas entra);
    (ii) 405 no pedido de amizade (jogador bloqueado) **não** repete o "desbloquear e adicionar" da Riot (`DELETE
    blocked-players` é outra decisão dele): avisa e o client normal resolve; alta; (iii) gameId da denúncia = o do próprio
    jogador no eog (`reportedPlayer.gameId` da Riot), não o `reportGameId` do topo; alta; (iv) erro de envio (adicionar ou
    denunciar) = motivo + "abrir no client normal", sem 2ª tentativa sozinha; alta; (v) "fechar" (dismiss-stats) fica ao
    lado da análise além do "ir para o lobby" (play-again): são saídas diferentes na Riot; média, reverte se ele achar
    repetido; (vi) "⤢ expandir" na honra vale até o `EndOfGame` (outra tela); média.
    **O que o pedido não dizia (completei):** chat do champ select e a sala do lobby nunca lidos; cartão do jogador ao
    clicar no nome no chat; `tools/ler-wad.py` (leitor do assets.wad, só leitura) para a próxima conferência de rota.
    — **prova (14/10/2026):** `node tools/teste-compacto-fim-de-partida.mjs` 65/65 (novo, vermelho antes: os módulos não
    existiam), `teste-compacto.mjs` 139/139 (PreEndOfGame: casos novos quebram contra o HEAD com `aoSequencia is not a
    function`), `teste-compacto-posjogo.mjs` 118/118 (casos de ir para o lobby, mentor e nomes nos detalhes novos), sem mudança
    e verdes: `teste-compacto-lobby` 136, `teste-compacto-selecao` 157, `teste-aceite` 43, `teste-chat-posjogo` 45,
    `teste-jogar-de-novo` 96, `teste-posjogo` 11, `teste-config` 50. Prints do harness (`temp/compacto-harness/
    fim-de-partida.html`, `servir-fim.mjs` na 8823): `2026-10-14-fim-{A-honra,A-denuncia,A-vazia,B-resumo,B-detalhes,
    C-sala,D-carregando}.png`. **Falta (só a partida prova):** a honra embaixo da camada de verdade (a cerimônia e o som da
    Riot seguem embaixo [S]), o 2º `POST ballot` (o nosso + o envio automático dela) [S], se a honor-vote põe algo no
    layer-manager (regra 7 a expandiria; `modais()` desta sessão sem histórico), o nome da etapa das celebrações, o envio na
    sala, pedido de amizade e denúncia contra o client real, `reported-players` e o `team_voice` lidos de verdade, o evento
    de mensagem nova (hoje 1,5 s de leitura).

    **Revisão adversarial e correções (14/10/2026, antes do commit).** 15 achados; corrigidos com teste (cada caso novo
    falha contra o código de antes; mutação conferida em cópia no scratchpad):
    - (1, alta) `''` no `currentSequenceEvent` não tinha prazo e prendia o `PreEndOfGame` na tela compacta (o `esperar` não
      olha a regra 7: o que a Riot abrisse ficava embaixo). Hoje `''` antes da honra conta como "não lida" (2 s e expande);
      depois da honra, `ESPERA_POS_HONRA_MS` = 4 s e expande; o `EndOfGame` dentro do prazo não pisca a janela.
    - (2, alta) a sala do pós-jogo anterior na lista recebia a mensagem: `acharSala(conversas, gameId)` aceita só id
      `<gameId>-…`; sem gameId, nenhuma sala ("esperando saber qual é a partida…", campo cinza).
    - (3) "prosseguir" com voto em voo ou depois da etapa: botão cinza ("enviando o voto…" / "a Riot já fechou a honra"); a
      honra lê a etapa do roteador (`ctx.seq`), que agora relê o GET a cada 1 s também durante a honra, por até 60 s.
    - (4, 11) campo da sala recriado a cada mensagem (perdia o foco, Enter ia para a Riot, 2º envio duplicado): campo e
      botão nascem uma vez por montagem; repinta pelo id da última mensagem (com 100 parava).
    - (6) aviso de amizade só com o campeão (sem camada nem Toast, o `avisar` cai no `console.log`).
    - (7) "pular a espera" recriado a cada 500 ms engolia clique: o botão de baixo da honra é um só, muda o texto.
    - (8) "ir para o lobby" sem `play-again`: `dismiss-stats` só sozinho (`grupo === false`) e com o aviso "fui para o
      início"; em grupo ou sem saber, avisa e abre o client normal.
    - (9) evento do ballot sem dados virava "sem honra" e erro ≠ 404 deixava "lendo" para sempre: relê (GET, 2 s).
    - (10) sessão que falha não apaga o gameId; sem gameId da sessão vale o do ballot; eog só com gameId igual.
    - (13) JOGAR DE NOVO e "fechar" ignoram clique sintético (`isTrusted === false`), como os outros botões que escrevem.
    - (14) formulário de denúncia guarda categorias e comentário por partida e jogador (a troca de fase desmontava e o
      texto sumia); FECHAR descarta.
    Fechado por leitura: (15) `votePool.votes` é o total (a Riot faz `votesRemaining = votes − selecionados`,
    `setInitialVotesRemaining` do rcp-fe-lol-postgame 16.20), igual à conta daqui. **Decisões (opus, 14/10/2026):** (vii)
    "+" e "⚑" ficam também na honra (pedido explícito dele, ~20:05/~20:08), sem prova de que `end-of-game-reports` e
    `friend-requests` aceitam antes do `EndOfGame`; erro mostra o motivo e "abrir no client normal", que na honra cai na
    tela da Riot sem esses botões: média, reverte para "no pós-jogo" se a 1ª honra real recusar; (viii) 4 s para o `''`
    depois da honra: média, reverte se a celebração da Riot demorar mais que isso a começar; (ix) item 12 (vigia da etapa
    com `setInterval`/`Date.now()` crus) aceito como o resto do `iniciarCompacto` (sem teste de relógio falso); (x) o mesmo
    filtro de gameId no `pengu/chat-posjogo.js` (produção, só leitura: no pior caso lê nomes da sala errada) fica
    **adiado** para não mexer fora do compacto nesta frente. **Falta, além da lista acima:** a cerimônia da Riot envia
    sozinha quando os votos dela acabam (`votesRemaining === 0`): com o voto dado aqui, ver se ela manda o ballot antes do
    clique dele. — **prova (14/10/2026, depois das correções):** `teste-compacto-fim-de-partida.mjs` 89/89,
    `teste-compacto.mjs` 145/145, `teste-compacto-posjogo.mjs` 118/118; sem mudança e verdes: `teste-compacto-lobby` 136,
    `teste-compacto-selecao` 157, `teste-aceite` 43, `teste-chat-posjogo` 45, `teste-jogar-de-novo` 96 (freios),
    `teste-posjogo` 11, `teste-config` 50. Nenhum POST/PATCH contra o client real; `coletor/` intocado.
13. [ ] **Chat lateral e grupo 2 da paridade (parecer de 14/10/2026 ~20:00 com 1 ajuste; construído offline e revisado em
    14/10, commit `c713c3d`; falta a partida real: blocos "Construção" e "Revisão adversarial" no fim deste passo).** A regra do passo 0 valeu até o parecer. Pedido dele (14/10/2026 ~17:00): "O chat que hoje abre uma janela
    nova, eu queria que na verdade fosse o próprio modo compacto ganhando espaço para a direita, mostrando a lista. E se
    eu abrir esse chat com alguém, esse chat também expande mais para a direita. Aí se eu fechar a parte do chat, fica só
    o modo compacto e a lista de amigos. E eu também posso fechar a lista de amigos." Junto, o grupo 2 do passo 11 (d1-d3).
    **Protótipo:** [temp/2026-10-14-prototipo-compacto-chat-e-paridade.html](../temp/2026-10-14-prototipo-compacto-chat-e-paridade.html)
    (abre com duplo clique, zero requisição externa; `#A1-lista`, `#A1-conversa`, `#A1-direita`, `#A1-pequeno`, `#A2-rc`,
    `#A2-pj`, `#B1`, `#B2-travado`, `#B2-fora`, `#B3-nunca`, `#parecer` etc. abrem direto). Prints de 14/10 em
    `temp/prototipo-chat-e-paridade/` (23); o HTML é a referência (a revisão abaixo mudou textos depois dos prints).
    Só o Gabriel com nome; amigos "amigo N", aliados "aliado N", mensagens inventadas.
    Telas: **A1 chat ao lado** (💬 alarga 420 → 720 com a lista de amigos; clicar num amigo → 1080 com a conversa; ✕ da
    conversa → 720; ✕ da lista → 420, ou 780 se a conversa segue aberta; painel da direita único com abas, então nunca
    passa de 1080; monitor estreito: a conversa entra no lugar da lista com ←) · **A2 nas outras fases** (aceite preso à
    coluna de 420; seleção nunca abre nada sozinha; em partida a lateral fecha e fica guardada; no pós-jogo entra à direita
    da tela B do passo 12) · **B1 configurações** (⚙ abre os blocos do lol-client no painel da direita; as da Riot pelo
    rodapé, expandindo) · **B2 selo completo** (📊 na seleção abre KDA, posição, hover/travado, matchup, trauma, draft e
    "coletor fora" no painel da direita) · **B3 reabrir análise** (linha "📊 última partida" no lobby: pronta, analisando,
    nunca aberta → analisar, falhou → tentar de novo; some no próximo ready check).
    **Parecer** (botão "copiar meu parecer", chave `lc-prototipo-chat-e-paridade-v1`): 1ª linha `parecer do protótipo do
    chat lateral e da paridade (14/10/2026)`, depois `tela A1 …` a `tela B3 …` (`aprovada`, `ajuste: <texto>` ou `sem
    parecer`) e `decisão 1 …` a `decisão 3 …`. As decisões são dele (as linhas `decisão N` respondem, sem card):
    - [[DECISAO]] mensagem nova abre a conversa sozinha? | opções: cabe/nunca/sempre | recomendo: cabe (só se couber sem mover a janela e nunca na seleção: mover a janela põe o JOGAR/TRAVAR embaixo do mouse) | dono: gabriel
    - [[DECISAO]] lateral volta depois da partida? | opções: volta/fechada | recomendo: volta | dono: gabriel
    - [[DECISAO]] onde abrem as configurações no compacto? | opções: painel/expandir | recomendo: painel | dono: gabriel

    **Viabilidade (14/10/2026, só leitura com o client em `Lobby`; `riotInvoke` só `Window.ScreenData` e
    `Window.GetValidWindowSizes`).** Monitor 2560×1080 físicos, área útil 2560×1020, escala 1,25 (= 2048×816 CSS);
    `ResizeTo` em px CSS, `MoveTo` em px físicos (o `centerWithinMainWindow` do lol-uikit multiplica por `zoomScale`);
    borda direita = `screenX + larguraCSS × zoomScale`, presa a `screenAvailLeft + screenAvailWidth` por `MoveTo`;
    `screenX` = −32000 com a janela minimizada (ignorar); `window.getScreenDetails()` trava o eval (não usar). Larguras:
    420/720/780/1080 CSS = 525/900/975/1350 físicos; altura 680 = 850. `/lol-chat` medido: `friends` (195; `icon` →
    `profile-icons/<icon>.jpg`; em partida `lol.championId` → `champion-icons/<id>.png`, fila, `timeStamp`, `gameStatus`),
    `conversations` + `messages` (`isHistorical`, `fromPuuid`), `friend-counts`, `v2/friend-requests` (3).
    B1: `rcp.whenReady('rcp-fe-lol-settings')` → `show()` existe (não chamado); os `lol-uikit-*` dos blocos funcionam fora
    do modal. B2: tudo em `pengu/champselect.js` (`estatisticasCampeao`, `textoSelo`, `linhaMatchup`, `linhaTrauma`,
    `linhasDraft`, `adversarioDoDraft`); **pegadinha:** `desenhar()` volta cedo com `cfg.champSelect.ligado` falso e o
    `lerCoach` nunca roda, então o compacto precisa de `lerCoach` exportado e independente do selo. B3: `ultimaAberta` e
    `analises` são privados de `pengu/posjogo/index.js` (zeram no ready check).
    **[S] a medir antes de depender:** `ResizeTo` manter o canto de cima à esquerda; evento de mensagem nova pelo `observe`
    de `/lol-chat/v1/conversations` (reserva: reler a cada 5 s, a conversa aberta a cada 1,5 s); envio `{body,
    type:"chat"}` com fallback 404 → `POST conversations {id, type:"chat"}` (1ª prova = mensagem real dele); `PUT`/`DELETE
    conversations/active` e se "ativa" marca como lida sem ele ver (fechar o painel chama o `DELETE`); convite `POST
    /lol-lobby/v2/lobby/invitations [{toSummonerId}]`; `ux-show`/restore da Riot no ready check com a lateral aberta; atalhos
    da Riot pegando teclas do campo de texto; `aceite.js` minimizando se o foco mudar enquanto ele digita no ready check;
    adversário de rota na ranqueada (rota provável do `draft.py`); Ctrl+K por cima da camada (11.c1).

    **Decisões técnicas (orquestrador, 14/10/2026; opção mais reversível):**
    (i) as 3 travas que hoje desfazem a lateral em < 2 s mudam juntas: `modo.js:14` `LIMITES.larg = [360, 900]` (o
    `tamanho()` troca 1080 por 420 em silêncio); `modo.js:17`/`:50` `LARGURA_COMPACTA_MAX = 1000` (com 1080 o
    `ehCompacta()` vira falso e o roteador, `index.js:286`, reencolhe; 3 vezes em 10 s desiste); `index.js:300` (toda troca
    de tela encolhe se `!noTamanho(cfg.larg, cfg.alt)`). Novo: "compacta" = a medida bate com o último tamanho **pedido**
    (±8 px); a largura desejada = coluna da config + lateral, guardada em `est.lateral` do roteador e nunca em
    `cfg.compacto.larg`; "a Riot devolveu a janela" = o par exato 1280×720 (a altura 680 distingue). Confiança alta;
    reverte se a medição mostrar a Riot devolvendo outro tamanho. Muda a regra de ARMADILHAS § Client e Pengu ("A Riot
    devolve a janela a 1280×720 sozinha", `ehCompacta` ≥ 1000 px): atualizar lá **na construção**, não agora.
    (ii) painel da direita único com abas (conversas, coach, configurações): teto de 1080, B1 e B2 no mesmo mecanismo do
    chat. Confiança alta; reverte se ele pedir duas conversas lado a lado.
    (iii) janelas do coletor (`coletor/chat_janelas.py`, `JanelasEdge`, rotas `/chat/*`, `painel/chat/`) **dormentes 1
    ciclo**, não apagadas; obrigatório já na construção: campo novo no `/chat/plugin` para desligar a abertura automática
    quando a lateral estiver ligada (não reaproveitar `compacto:false`), senão a conversa abre em dobro. Confiança média;
    reverte (apaga) depois de 1 ciclo sem uso, ou volta se ele quiser o chat na 2ª tela.
    (iv) o compacto lê o selo sem depender da chave "Winrate com o campeão", só quando ele abre o 📊. Confiança média;
    reverte se ele quiser que a chave desligue tudo.
    (v) depois de um `MoveTo` para caber, a janela volta à posição anterior ao encolher se ele não arrastou; voltar ao
    compacto depois de fechar as Configurações da Riot é comportamento novo (hoje `est.forcado` só limpa na troca de
    destino), o mesmo conserto do 11.c3.

    **Reaproveitar na construção:** de `coletor/chat_janelas.py` para JS no plugin (1:1): `eh_conversa_direta`,
    `status_amigo`, `nome_fila`/`FILAS`/`TIPOS_FILA`, `grupo_do_amigo`, ordenação, regras de convidar (só líder ou
    `allowedInviteOthers`, nunca ocupado ou já no grupo), `enviar` com fallback 404, `TEXTO_MAX`, `MSGS_MAX`; de
    `painel/chat/chat.js`/`chat.css`: render da lista e da conversa, `isTrusted` no enviar/convidar, "lida" só depois de
    interação. `chat-ponte.naoLidasDaLcu` e o contador de `chat-botao.js` ficam. Camada: `#lc-compacto` vira linha (coluna
    420 + painéis); `#lc-aceite`, `.lc-cp-aviso` (`comum.js:131`) e `.lc-cp-alerta` presos à coluna; o painel libera
    `user-select`; foco só com `focus({preventScroll:true})`; corrigir junto o `criarArrasto.limites` (`index.js:519-523`
    mistura `screen.*` físico com `innerWidth` CSS: usar `outerWidth`). Casos de `tools/teste-chat-janelas.py` viram teste
    node com `tools/lcu-falsa.mjs`.
    **Fronteiras (especificar, nunca editar arquivo de outra frente):** frente seleção: só o botão 📊 em
    `compacto/tela-champselect.js`; frente fim de partida: 1 export só de leitura do estado da análise em
    `posjogo/index.js` (`{gameId, pronta, erro, vista}` ou null) + `analisarUltima()` (última de Summoner's Rift ≥ 300 s)
    e a lateral à direita da tela B; coletor: o campo novo do (iii). "Análise pronta" no B3 depende do 11.b1.
    **Fica de fora, e por quê:** chat de dentro da partida (`conversations` fica `[]` o jogo inteiro); chat na 2ª tela (a
    lateral é a mesma janela; para isso só as janelas do coletor); a UI da Riot ocupar a largura nova (viewport em 1280,
    cortada); aceitar/recusar pedido de amizade, adicionar, silenciar, denunciar (client normal, expande); configurações da
    Riot e "restaurar padrão" dentro do compacto; nome de jogador na seleção (só campeão).
    — **prova:** parecer colado no chat com as 5 linhas `aprovada` e as 3 decisões → registrar data e frase dele aqui; só
    então vira plano de construção, com os [S] acima medidos antes de depender deles.
    **reprova se:** qualquer `ajuste:`/`sem parecer` (ajusta o protótipo e pede de novo); código em `pengu/` ou `coletor/`
    desta frente antes da aprovação; algo que abre sozinho na seleção ou move a janela embaixo do mouse sem a decisão 1.

    **Parecer (14/10/2026 ~20:00, literal):** "tela A1 chat lateral (lista e conversa): sem parecer · tela A2 chat lateral
    nas outras fases: sem parecer · tela B1 configurações dentro do compacto: ajuste: configurações pode expandir para a
    esquerda. não esqueça de garantir que as janelas não se percam entre si ao serem abertas ou fechadas. · tela B2 selo
    completo na seleção: sem parecer · tela B3 reabrir análise no lobby: sem parecer · decisão 1 mensagem nova abre a
    conversa sozinha: sem escolha · decisão 2 lateral depois da partida: sem escolha · decisão 3 onde abrem as
    configurações: sem escolha"; e "chat do time entra sim" (chat do time na seleção). Leitura do orquestrador: "sem
    parecer" = constrói como no protótipo; decisões sem escolha = as recomendações: (1) abre sozinha só se couber sem
    mover a janela e nunca na seleção; (2) a lateral volta depois da partida; (3) painel, que pelo ajuste B1 cresce para a
    **esquerda** (chat para a direita, coluna compacta parada no lugar). Registrado pela frente do fim de partida (passo
    12); a construção deste passo é da outra frente.

    **Construção (14/10/2026, offline; nenhum POST/PATCH contra o client real; `coletor/` intocado).**
    - **3 travas + estado único** (`compacto/modo.js`, `index.js`): `tamanho(larg, alt, extra)` limita só a coluna e soma a
      lateral (teto `LATERAL_MAX` 1600); `ehCompacta` = a largura medida bate com a **pedida** (±8); "a Riot devolveu" = ≥ 1000 px
      fora do pedido depois da folga; boot = < 1000 px ou fora do 16:9 da Riot. `est.lateral {esq, dir}` no roteador é o único
      dono da largura (`pedirLateral`); troca de tela compara com coluna + lateral; expandir guarda o estado e o compacto volta igual.
    - **Geometria** (`compacto/geometria.js`, novo): `Window.ScreenData` por `riotInvoke` com `onSuccess` (físicos, `zoomScale`);
      âncora = x da coluna escolhido por ele (adota quando a janela não está onde foi deixada: arrasto, Windows); configurações
      crescem à esquerda com `MoveTo` antes do `ResizeTo`, fechar faz o inverso; tudo preso à área útil; relê e corrige se o
      `ResizeTo` não manteve o canto. Limites do arrasto em px físicos (o `criarArrasto.limites` misturava `screen.*` com CSS).
    - **Camada em linha** `[esquerda][coluna][direita]` (`criarCamada`): aviso, alerta, denúncia, cartão do jogador e
      `#lc-aceite` presos à coluna (`--lc-cp-esq`/`--lc-cp-col`).
    - **A1/A2** (`compacto/lateral.js` + `lateral-chat.js`, novos): 💬 = lista (300) à direita; amigo = conversa (painel 360 com
      abas, até 3 conversas, a 4ª fecha a mais antiga); ✕ de cada um; monitor estreito: a conversa entra no lugar da lista com ←;
      abrir um lado que não cabe com o outro fecha o outro e avisa. Lista, status, grupos e "convidar" portados 1:1 de
      `coletor/chat_janelas.py`; pedidos de amizade abrem o client normal. Escrita só por clique/Enter dele (`isTrusted`), corpos
      lidos no JS da Riot: mensagem `sendMessage`, conversa nova `{id, type:"chat"}`, "lida" `PUT/DELETE conversations/active`
      (só depois de clique ou tecla na conversa à vista), convite `[{toSummonerId}]`. Chat bloqueado (`isSystemMuted`) = campo cinza.
      Por fase: troca de tela não mexe; partida encontrada com a contagem na coluna; em partida o client vai a 1280 e a lateral
      fica guardada; coach e sala do time saem ao deixar a seleção.
    - **Chat do time** ("chat do time entra sim"): na lateral, linha "🗨 sala do time" no topo da lista durante a seleção →
      aba; só a conversa `type:"championSelect"` (só id/type ficam); quem fala = campeão + posição pelo `myTeam` da sessão
      (casando puuid/summonerId/obfuscated*), sem casar = "aliado"; nenhum nome lido. Decisão: lateral (não a tela 3), porque a
      tela 3 não tem altura sobrando (frente seleção) e a lateral já tem campo, abas e regra de foco; média, reverte se ele quiser
      a sala dentro da tela 3.
    - **B1** (`lateral-config.js`): ⚙ no topo do lobby/fila abre à esquerda os blocos de `configuracoes.js` (`montarPainel`,
      sem "restaurar padrão"), um aberto por vez, "Client compacto" primeiro, busca; rodapé "Configurações da Riot" expande, chama
      `rcp.whenReady('rcp-fe-lol-settings').show()` [S] e volta ao compacto quando o `.lol-settings-container` sai da página
      (`abrirConfigRiot`/`configRiotFechou`; decisão v, só para esse caminho; a regra 7 das outras janelas segue igual).
      Chaves novas: `compacto.chatLateral` e `compacto.conversaSozinha` (padrão ligadas; bloco "Client compacto" e Ctrl+K).
    - **B2** (`lateral-coach.js`): 📊 na seleção (`tela-champselect.js`, só o botão) abre o selo completo como aba: geral e
      posição, matchup contra o adversário de rota **travado** (`adversarioDoDraft` + conferido no `theirTeam`), trauma (chave),
      draft com a barra do `p`; `champselect.js` ganhou `lerCoach` exportado (roda com "Winrate" desligado, decisão iv). Deixar o
      coach aberto o traz de volta na próxima seleção só se couber sem mover.
    - **B3** (`tela-lobby.js` + `posjogo/index.js` `estadoAnalise()` lendo o cache da análise, e `analisarUltima` no retorno do
      `iniciarPosjogo`): linha "📊 última partida" abaixo da dica: pronta/vista → "⤢ reabrir", analisando → cinza, falhou →
      "tentar de novo", nunca → "analisar"; some no ready check (`esquecerAnalises`) até a próxima partida; expande antes de abrir.
    - **Decisão 1** (mensagem nova): abre a conversa sozinha só com o compacto à vista, em `None`/`Lobby`/`EndOfGame`, com a
      chave ligada, última mensagem não minha e se couber sem mover (`cabeSemMover` com a tela lida); nunca dá foco nem marca lida.
    **Decisões técnicas (opus, 14/10/2026):** (vi) coletor: o plugin manda `POST /chat/plugin {compacto: ligado && !lateral,
    lateral}`; o coletor de hoje só lê `compacto`, então com a lateral ligada as janelas do Edge param de abrir conversa sozinhas
    já (sem isso abriria em dobro). Reaproveita o `compacto:false` que o (iii) queria evitar: única via sem editar `coletor/`
    (pedido da rodada); efeito colateral: o estado das janelas diz "client compacto desligado". Média; reverte quando o coletor
    ler `lateral` (abaixo). (vii) conversas e coach dividem o painel de 360 em abas; config à esquerda fora das abas. Alta.
    **Mudança do coletor (para o orquestrador aplicar; não feita aqui):** `coletor/chat_janelas.py` `rota_post` `/chat/plugin`:
    `self.lateral = bool(corpo.get("lateral"))` (atributo novo `self.lateral = False` no `__init__`); `abre_sozinha_ligado`:
    `return not self.lateral and (self.compacto is True or (self.compacto is None and self.lista_aberta))`; `pode_abrir_sozinha`:
    com `self.lateral`, motivo "chat ao lado do compacto"; caso novo em `tools/teste-chat-janelas.py` (`{compacto:true,
    lateral:true}` não abre). Depois disso o plugin pode mandar `compacto: ligado` de verdade (`index.js` `criarAvisoChat`, 1 linha).
    Também zerar `self.lateral = False` no bloco da troca de porta (~linha 420-426, onde já faz `self.compacto = None`).
    **Ordem de deploy:** primeiro o patch do coletor (e reiniciar o coletor), **depois** a linha do `criarAvisoChat`; na ordem
    inversa a conversa volta a abrir em dobro (lateral + Edge). Até lá o paliativo `compacto:false` fica.
    Revisão (advisor, antes de fechar): a tarefa da geometria é assíncrona; coach aberto na seleção e a partida começando = o
    gancho da fase muda a largura, o roteador expande na mesma volta e a tarefa atrasada encolhia/movia o client de 1280. Hoje a
    geometria só age com o compacto à vista (`ativo`, conferido antes e depois do ScreenData) e o `redimensionar` do roteador
    também confere; caso novo (com e sem as configurações à esquerda).
    **Revisão adversarial (14/10/2026, depois da construção; 1 grave, 2 médios confirmados, 1 plausível, 7 menores):**
    - corrigido **(1, grave) arrasto com posição velha**: o 2º arrasto saltava ao lugar do 1º e a decisão 1 ("cabe sem mover")
      usava a posição velha, movendo a coluna na seleção. O teste não via: a operação "arrasta" punha `s.win.x` direto. Agora
      `criarArrastoJanela` (`index.js`, exportado) anota cada `MoveTo` na geometria (`anotarPosicao`) e relê no fim; abertura
      automática (mensagem nova, coach lembrado) vai com `soSemMover`: a tarefa da geometria relê a tela e, se teria de mover
      (ou não leu a tela), recusa e a lateral tira a aba (`desfazerAuto`). O teste usa o arrasto de verdade, também nas 60 aleatórias.
    - corrigido **(2) coluna fora de vista ao abrir/fechar ⚙**: CSS `--lc-cp-*` sai na tarefa da geometria (`porCss`): crescendo à
      esquerda CSS → MoveTo → ResizeTo; fechando ResizeTo → CSS → MoveTo; e `.lc-cp-esq:empty` saiu (a esquerda vazia encolhia
      antes do MoveTo). Conferido também no harness (navegador): ao fechar ⚙ a coluna não pula antes da janela andar.
    - corrigido **(3) reserva com unidades erradas**: com `riotInvoke`, ScreenData sem resposta/erro = `null` (só redimensiona).
    - corrigido **(4, plausível) mensagem lida sem ele ver**: `conferirAtiva` devolve (`DELETE conversations/active`) ao trocar
      de aba, fechar o painel, sair do compacto (partida, ⤢), no "–" e com a página oculta (`aoOculto`, `visibilitychange`).
    - corrigido **(6)** "a Riot devolveu" também exige o 16:9 (1100×680 depois de pedir 1080 segue compacta); `teste-compacto`
      ganhou a altura 720 nos 2 casos de restore (antes só a largura). **(8)** `caber('esq')` limpa o mapa de conversas.
      **(9)** abas só são recriadas quando mudam (o relógio de 1,5 s comia cliques). **(10)** com 3 conversas abertas,
      mensagem nova só conta. **(11)** a releitura depois do `ResizeTo` espera ~120 ms (`RELER_MS`; [S] CEF assíncrono).
    - **(7)** sala do time casada com `session.chatDetails.multiUserChatId` (id igual ou `<muc>@…`); 2+ salas sem casar = não lê
      nem envia; **1 sala só = ela** (decisão técnica viii, opus: confiança baixa no formato do id, nenhum dado real no repo;
      reverte para "sem casar, não envia" se a próxima ranqueada mostrar que o id casa com o muc).
    - aplicado com [S] **(5)** delta do arrasto × `zoomScale` (a base agora é física): pela leitura da Riot (CSS × zoomScale =
      físico). Medição que decide, no lobby: `window.screenX * zoomScale` vs `ScreenData.screenX` — iguais = fica; diferentes =
      reverter (`criarArrastoJanela` `escala: () => 1`, 1 linha).
    - 15 mutações (cada conserto desfeito numa cópia no scratchpad): todas vermelhas.
    — **prova da revisão (14/10/2026):** `teste-compacto-lateral.mjs` 101/101 (22 casos novos), `teste-compacto.mjs` 146/146 e
    `rodar-testes.py` do compacto, config e plugin verdes (lista abaixo).
    — **prova (14/10/2026):** `node tools/teste-compacto-lateral.mjs` 79/79 (novo; 144 sequências abre/fecha em toda ordem × 4
    lugares do monitor, 60 aleatórias com arrasto/expandir/troca de tela, ResizeTo pelo centro, partida começando com o coach
    aberto; mutação em cópia no scratchpad: 12 mutações, todas pegas), `teste-compacto.mjs` 146/146 (2 casos atualizados: padrão com as chaves novas e o aviso ao coletor
    com a lateral), sem mudança e verdes: `compacto-lobby` 136, `compacto-selecao` 157, `compacto-fim-de-partida` 89,
    `compacto-posjogo` 118, `config` 50, `aceite` 43, `chat-posjogo` 45, `jogar-de-novo` 96, `posjogo` 11, `runas`, `recompensas` 41,
    `sem-popups` 22, `winrate`, `matchup`, `abas`, `licoes`. Prints do harness (`temp/compacto-harness/lateral.html`, `servir.mjs
    8831`): `2026-10-14-lateral-{A1-conversa,B1,B1-tudo,B2-coach,sala-do-time,B3-pronta,A2-partida-encontrada,monitor-pequeno}.png`.
    **Falta (só o client real prova):** `ScreenData` com `onSuccess` e o `ResizeTo` manter o canto (a correção cobre se não);
    o pisca de 1 quadro ao crescer à esquerda; `rcp...settings.show()`; evento de mensagem nova (hoje releitura a cada 1,5–4,5 s);
    envio 1:1 e na sala do time, "lida" e convite contra o client real; remetente da sala ranqueada casar com o `myTeam`
    (senão sai "aliado"); `ux-show`/restore da Riot com a lateral aberta; atalhos da Riot e o foco do `aceite.js` com ele digitando
    na lateral; janela em 2 monitores; recarga do plugin com a lateral aberta (volta a 420, estado não persiste); escala do
    arrasto (achado 5) e o id da sala do time contra o `multiUserChatId` (achado 7); `ResizeTo` síncrono ou não (achado 11). Antes da
    partida, depois da recarga no lobby: `node tools/cdp.mjs eval tools/compacto-importar.js` (os 5 módulos novos estão na lista).
14. [ ] **Relógio da seleção e compacto durante a partida (relato de 14/10/2026 ~20:50).** Palavras dele: "Os contadores de
    tempo e a barra de tempo durante a seleção de campeões estão bugados. O modo compacto sai assim que a partida inicia, na
    tela de partida em andamento, corrija." Até aqui `GameStart`/`InProgress` tiravam a camada **por desenho** (tabela de
    telas, linha "—"; passo 3) e a lateral fechava na partida e voltava depois (decisão 2 do passo 13). Este passo muda o
    primeiro e mantém o segundo.
    **14a. Relógio e barra da tela 3** (`pengu/compacto/tela-champselect.js`, `relogio`/`aoSessao`).
    - **correção (premissa da tarefa):** a evidência apontada (`dados/medicao-compacto-2026-10-14.jsonl` e
      `tests/fixtures/selecao-ranqueada-20261014.json`) não tem o relógio: o medidor grava só `phase`, `totalTimeInPhase` e
      `isInfinite` (`tools/medir-compacto.py`, `sem_relogio`) e a fixture foi remontada com `adjustedTimeLeftInPhase =
      totalTimeInPhase` em todo evento. A única gravação real com `adjustedTimeLeftInPhase` + `internalNowInEpochMs` é
      `tests/fixtures/champselect-real.json` (61 leituras GET do `tools/gravador.py`, normal draft de 13/10/2026).
    - **causa (provada):** o timer da sessão é uma **foto** tirada em `internalNowInEpochMs`; a tela fazia `fim = Date.now() +
      adjustedTimeLeftInPhase` a cada evento ou releitura. A LCU repete a mesma foto quando outra coisa da sessão muda: na
      fixture real, `ts 1791886349525` e `ts 1791886355766` (6,2 s depois) trazem o mesmo `{adjusted 31400, internalNow
      1791886349147}`, e de novo `1791886605276 → 1791886611468`. A fixture é do `tools/gravador.py`, que lê por **GET** a cada
      ~0,5 s: o ev 45 é uma resposta de GET com a foto de 6,6 s antes, então a releitura por GET também devolve foto velha. O relógio voltava de ~25 para 32 e a barra voltava a 100%
      ("reinicia"); a releitura por GET do socket mudo (`SILENCIO_MS`/`RELER_MS`) faz o mesmo a cada 2 s numa fase calma
      (FINALIZATION de 30 s: o número ficava preso entre 30 e 28). Fora isso, todo evento chega 100–500 ms depois da foto e o
      número dava um pulinho para cima. A conta da Riot (lida no `rcp-fe-lol-champ-select` 16.20 com `tools/ler-wad.py`):
      `restante = max(adjustedTimeLeftInPhase − (agora − internalNowInEpochMs), 0)`, sem `internalNow` vale o `adjusted`.
      Não é o defeito do anel da fila (`4c3de6a`): a barra é um elemento só a montagem inteira; quem reiniciava era o número.
    - **correção:** `fim = (internalNowInEpochMs > 0 e |agora − internalNowInEpochMs| ≤ FOTO_MAX_MS (120 s) ? internalNowInEpochMs :
      agora) + adjustedTimeLeftInPhase` (foto mais longe que isso = relógio torto, conta da chegada como antes) e relógio
      injetável (`_relogio.agora`, como o `tela-posjogo.js`). Número com `floor` como o da Riot (era `ceil`: 1 s a mais).
    - **prova:** `node tools/teste-compacto-selecao.mjs` com relógio falso tocando os 61 eventos reais (`agora = ts`): depois
      de `ts 1791886355766` o número é 24 (`floor(31400 − 6619 ms)`) e a barra ~79% (antes: 32 e 100%); dentro da mesma foto o número nunca sobe; a
      releitura de 2 s numa FINALIZATION calma desce até 0. **reprova se:** algum par da mesma foto faz o número subir.
    **14b. Tela compacta "partida em andamento"** (`pengu/compacto/tela-jogo.js`, roteador `compacto/index.js`).
    - `GameStart`, `InProgress` e `Reconnect` → tela `jogo` (mesma chave: o "⤢ expandir" dele vale a partida inteira; o
      botão muda pela fase). Janela 420×680 atrás do jogo: campeão (foto + nome), fila, tempo de jogo, placar do time e
      "⤢ abrir o client normal". `Reconnect`: "RECONECTAR" = `POST /lol-gameflow/v1/reconnect` sem corpo (o
      `_performReconnect` do `rcp-fe-lol-navigation` 16.20), só clique de verdade (`isTrusted`), cinza até a fase mudar;
      falha = motivo + "abrir no client normal". Nada de `early-exit` nem `spectate/quit` (o "sair" da Riot).
    - Dados, nesta ordem: `GET 127.0.0.1:8765/estado` do coletor (já lê a Live Client: `fase` `carregando`, `gt`, `meuTime`,
      `jogadores[].aliado/k`, `euJogador.campeao`); só o que a Riot mostra no HUD (tempo e abates por time), nada de inimigo
      na fog, itens ou "visto há". Coletor fora: campeão por `GET /lol-gameflow/v1/session` (`playerChampionSelections`/
      `teamOne`/`teamTwo` casado com o puuid do `current-summoner`, nunca mostrado nem logado) e relógio local desde o
      `GameStart`, rotulado "desde o carregamento" (inclui os ~99 s da tela de carregamento: ARMADILHAS § Live Client),
      nunca "tempo de jogo". Fetch direto na 2999 fica de fora (certificado próprio da Riot no CEF: [S] novo sem ganho).
    - `FailedToLaunch`/`TerminatedInError` seguem expandindo: a Riot abre o modal de crash report nessas fases
      (`_gameflowStateCallback`) e não achei no front dela qual ação é a segura; regra 7 expandiria de todo jeito.
    - **Foco:** sozinho, nas fases de jogo o roteador só chama `Window.ResizeTo` (nunca `MoveTo`/geometria nem `ux-show`), e em
      `InProgress` sem o foco na página (`document.hasFocus()` falso = o jogo na frente) não mexe na janela de jeito nenhum:
      reencolher, expandir por regra 7 e a montagem que precisaria de `ResizeTo` esperam ele voltar ao client (evento
      `focus`); com ele no client, expandir é o de sempre (`ResizeTo` + `CenterToScreen`). `GameStart` (≈50 ms, antes da janela
      do jogo) e `Reconnect` (o jogo caiu) não dependem do foco.
    - **Lateral:** continua fechada na partida e volta depois (decisão 2): nas fases de jogo ela some da largura (`extra` 0),
      não lê nada (relógio parado), devolve a conversa ativa (`DELETE conversations/active`) e guarda o que estava aberto.
    - "▣ modo compacto" flutuante também nas fases de jogo (a tela da Riot ali não tem a barra de cima).
    - **prova:** `teste-compacto.mjs` (13 fases → destino novo; invocações do `riotInvoke` falso nas fases de jogo: só
      `Window.ResizeTo`; `InProgress` sem foco não chama nada e age no `focus`; `FailedToLaunch` expande),
      `teste-compacto-jogo.mjs` (novo: campeão, fila, tempo e placar pelo coletor, reserva sem coletor, reconectar só com
      clique e uma vez, nenhum POST fora do `/reconnect`), `teste-compacto-lateral.mjs` (partida com a lateral aberta: janela
      420, estado guardado, volta no pós-jogo); harness com prints. **reprova se:** alguma fase de jogo chama `CenterToScreen`/
      `MoveTo`, reconecta sem clique ou mostra dado de inimigo além do placar.
    **Construído (14/10/2026, offline; nenhum POST/PATCH contra o client real; `coletor/` intocado; sem commit, a pedido).**
    `tela-champselect.js` (`fimDaFase`, `_relogio`, `floor`), `tela-jogo.js` (novo), `index.js` (destino, `temFoco`/`podeMexer`,
    `extra` 0 na partida, sem geometria na partida, log com o foco, `focus` relê, flutuante e aviso do ✕ na partida),
    `lateral.js` (some e para de ler na partida, volta depois), `comum.js` (`FASES_JOGO`), `compacto-importar.js` (+4 módulos),
    `rodar-testes.py` (+ `teste-compacto-jogo.mjs`). Completei: `tools/medir-compacto.py` passa a gravar `adjustedTimeLeftInPhase` e
    `internalNowInEpochMs` no `sessao_cs` (só números; a comparação ignora os dois, sem linha a mais; `teste-medir-compacto.py`
    35/35): a próxima ranqueada prova o 14a com dado dele (o medidor em execução só pega isso quando for reiniciado).
    Decisões técnicas (opus, 14/10/2026, opção mais reversível): (i) `floor` como a Riot (era `ceil`): alta; (ii) foto do timer
    a mais de 120 s de agora = conta da chegada (relógio torto): média, reverte se a medição mostrar relógios que divergem
    pouco; (iii) as 3 fases de jogo com a mesma chave (⤢ dele vale a partida inteira): média; (iv) `FailedToLaunch`/
    `TerminatedInError` seguem expandindo: alta; (v) fonte de dados = coletor `/estado`, sem fetch direto na 2999: média,
    reverte se ele quiser o tempo sem o coletor (aí medir CORS/certificado da 2999 no CEF); (vi) sem foco em `InProgress` nada
    mexe na janela, com foco o expandir é o de sempre: alta; (vii) leitura do coletor velha (> 8 s) cai para o relógio local:
    média.
    — **prova (14/10/2026):** `teste-compacto-selecao.mjs` 165/165 (7 casos novos ou mudados vermelhos contra o HEAD: 32 em
    vez de 24, barra 100%, número que sobe dentro da mesma foto, releitura presa entre 30 e 27), `teste-compacto.mjs` 162/162
    (15 vermelhos contra o HEAD), `teste-compacto-jogo.mjs` 39/39 (novo; o módulo não existia), `teste-compacto-lateral.mjs`
    103/103 (4 vermelhos contra o HEAD); mutações em cópia no scratchpad: sem `podeMexer` (4 casos vermelhos), geometria na
    partida (1), lateral sem sumir na partida (2). Sem mudança e verdes: `compacto-lobby` 136, `compacto-posjogo` 118,
    `compacto-fim-de-partida` 89, `aceite` 43, `config` 50, `chat-posjogo` 45, `jogar-de-novo` 96, `posjogo` 11, `recompensas` 41,
    `runas` 4, `sem-popups` 22, `abas`, `licoes`, `matchup`, `winrate`. Harness (`temp/compacto-harness/partida.html`, `servir.mjs
    8843`, relógio falso): `2026-10-14-relogio-{antes,depois}.png` (ev 45 da gravação real: 31 e barra 98% antes, 24 e 77%
    depois), `2026-10-14-partida-{InProgress,sem-coletor,Reconnect}.png`.
    **Falta (só a partida prova):** `ResizeTo` com a janela minimizada ou atrás do jogo (foco), o `/reconnect` contra o client
    real, `playerChampionSelections` real, `document.hasFocus()` no CEF com o jogo na frente, o que a Riot faz com o tamanho
    da janela no fim da partida. No `LeagueClientUx.log` da próxima partida: `tela jogo (GameStart) foco=true redimensionou=…`
    e nenhum `expandido: partida…`; antes dela, recarga no lobby e `node tools/cdp.mjs eval tools/compacto-importar.js`.
    **Revisão adversarial do 14 (14/10/2026, só leitura) e correções (opus, 15/10/2026).** Relógio e barra da seleção: sem
    segundo defeito (o `isInfinite` não passa pelo `fimDaFase`, cada troca de fase traz foto nova, nenhum outro código lê
    `adjustedTimeLeftInPhase`). Achados da partida, todos corrigidos com teste que falha antes (mutação em cópia no scratchpad):
    1. **ALTA, bloqueava:** `MoveTo` na partida pela tarefa atrasada da geometria. Fechar ⚙ (painel da esquerda) nos últimos ms da
       seleção enfileira um `aplicar`; a fase vira GameStart no meio do ScreenData e a guarda `ativo()` (`efetivo === 'compacto'`)
       seguia verdadeira com a tela de jogo compacta: `ResizeTo` + `MoveTo` com o jogo abrindo. Agora `geometriaAtiva(estado)`
       (compacto e fora das fases de jogo), exportada do `index.js` e usada no client e no `teste-compacto-lateral.mjs` (que tinha
       a cópia da guarda velha). Prova: "corrida ⚙ fechada + GameStart" (vermelho antes: `ResizeTo 420x680, MoveTo 640x100`).
    2. **MÉDIA:** o adiado só voltava pelo evento `focus`, que não chega com o foco no iframe do chat da Riot. `iniciarCompacto`
       relê a cada 500 ms (`FOCO_RELE_MS`, `voltouAoClient(estado, hasFocus())`). Prova: puro no `teste-compacto.mjs`; o intervalo
       em si só a partida prova.
    3. **MÉDIA (dado real):** `Reconnect` também aparece no fim de partida normal (InProgress → Reconnect 19:33:01 →
       PreEndOfGame 19:33:12). Texto neutro ("o jogo fechou: se a partida ainda está rolando, reconecta"; título "o jogo fechou:
       reconectar?"); o `tique` de 1 s repinta quando a fase muda sem `atualizar` (bloco e botão somem, título "terminou").
       Prova: `teste-compacto-jogo.mjs` e harness `#fim-reconnect` (aos 1,3 s do PreEndOfGame: `caiu` escondido, título
       "terminou"); print `2026-10-14-partida-Reconnect-texto-neutro.png`.
    4. **BAIXA-MÉDIA:** "acertar o tamanho da janela" adiado nunca acontecia (ramo "mesma tela" só limpava o adiado). Nas fases de
       jogo, com o foco, o ramo confere `noTamanho` e faz `ResizeTo`; fora delas não (a fila da geometria é dona da ordem CSS →
       MoveTo → ResizeTo).
    5. **BAIXA:** a `emergencia()` expandia sem olhar o foco; agora adia "expandir" em InProgress sem foco.
    6. **BAIXA:** erro de tela com a expansão adiada repetia log e aviso a cada segundo e dizia "abri o client normal". Uma vez
       por montagem (`m.falhou`, `token++`, timers e intervalos parados) e o texto sai no fim do `resolver` ("abre quando voltar a
       ele" se adiou).
    7. **BAIXA ([S]):** o relógio local zerava se o reconectar passasse por GameStart > 60 s depois. Mesmo `gameId` não zera; tela
       remontada guarda o início de antes (`anterior`) e o devolve quando a sessão confirma a mesma partida.
    8. **BAIXA:** o tempo do coletor era projetado da hora em que a tela leu. Agora de `atualizadoMs` (hora em que o coletor leu a
       Live Client, mesmo relógio da máquina), no máximo `PROJECAO_MAX_MS` 4 s (partida pausada não corre e volta); a leitura
       velha (> 8 s) conta pela mesma hora.
    9. **BAIXA (desempenho):** o `GET /estado` não roda com a página escondida (`visibilityState === 'hidden'`, janela
       minimizada). Sem foco continua lendo: o client pode estar à vista na 2ª tela ao lado do jogo.
    10. **BAIXA ([S]):** TFT e Arena caíam na tela de jogo ("teu time × inimigos" sem sentido). Tela de jogo só com o mapa lido 11
       ou 12 (`MAPAS_JOGO`); outro mapa volta ao de antes do passo 14 (client normal, que em InProgress sem foco também espera);
       mapa não lido segue na tela de jogo. Espectador já é outra fase (`WatchInProgress` → client normal).
    11. **DOC:** 14a corrigido (`FOTO_MAX_MS` na fórmula; 24, não 25); `CLAUDE.md`: "sozinho nada de `MoveTo`/`ux-show`, sem foco
       nem `CenterToScreen`" (por clique dele o expandir segue com `CenterToScreen`).
    Decisões técnicas (opus, 15/10/2026, a mais reversível): (viii) achado 4 só nas fases de jogo: alta, reverte se aparecer
    janela fora do tamanho no lobby (aí entra pela fila da geometria, nunca direto); (ix) achado 9 por `visibilityState`, não por
    foco: média, reverte se a medição mostrar que o CEF minimizado segue `visible` (aí a leitura volta a ser sempre); (x) achado 10
    com mapa não lido = tela de jogo: média, reverte se TFT/Arena chegarem ao GameStart antes da sessão (aí esperar a sessão);
    (xi) projeção máxima 4 s (coletor lê a cada 1 s, tela a cada 2 s, prazo 1,5 s): média; (xii) releitura do foco a cada 500 ms
    (o `aceite.js` usa 250): alta.
    — **prova (15/10/2026):** `teste-compacto.mjs` 175/175, `teste-compacto-lateral.mjs` 104/104, `teste-compacto-jogo.mjs` 47/47,
    `teste-compacto-selecao.mjs` 165/165, `lobby` 136, `posjogo` 118, `fim-de-partida` 89, `aceite` 43, `config` 50, `sem-popups` 22,
    `chat-posjogo` 45, `recompensas` 41, `jogar-de-novo` 96, `posjogo` 11, `runas` 4, `licoes`/`abas`/`winrate`/`matchup` rc 0,
    `teste-medir-compacto.py` 35/35. Mutações (cada correção desfeita numa cópia): achados 1, 3, 4, 5, 6, 7, 8, 9 e 10 ficam
    vermelhos. O `rodar-testes.py` inteiro não rodou: ele abre janelas (moldura, Tk) e o ensaio usa a porta 8766, com o client
    aberto na tela dele. **Falta (só a partida prova), além da lista acima:** `hasFocus()` a cada 500 ms com o foco no chat da
    Riot; `visibilityState` do CEF minimizado; mapa de TFT/Arena chegando antes ou depois do GameStart.

14b. [x] **⚙ sem piscar** (relato dele, 15/10/2026 ~00:30: "ao clicar na engrenagem, o client dá uma flickada rápida antes da
    janela de configurações ir pra esquerda da janela principal"). Causa: a geometria punha `--lc-cp-esq: 360` + `MoveTo` +
    `ResizeTo` na mesma volta; a página ainda de 420 pintava [configurações 360][coluna 60] até saber do tamanho novo (1+ quadro
    com as configurações no lugar da coluna); ao fechar, o `ResizeTo` estreitava antes da pintura nova (coluna cortada).
    Caminhos avaliados: (a) pedido atômico: **não existe** (os 23 `Window.*` do `LeagueClientUx.exe` lidos em 15/10; `MoveBy`/
    `ResizeBy` são os mesmos dois pedidos; a própria Riot faz `moveTo` e `resizeTo` separados); (b) CSS antes do `MoveTo` = a ordem
    que piscava; (c) escolhido, em `compacto/geometria.js` `aplicarAgora`: janela que **cresce** = `ResizeTo` primeiro com a
    esquerda velha (a coluna fica, sobra fundo escuro à direita), CSS novo + `MoveTo` na mesma volta quando a página já tem a
    largura nova (`resize`, prazo `ESPERA_TAMANHO_MS` 250); janela que **encolhe** = CSS + `MoveTo` primeiro, `ResizeTo` dois
    quadros depois; (d) só no painel da esquerda: `lc-cp-mudando` o deixa invisível do quadro antes do `MoveTo` até 2 depois
    (o quadro da corrida mostra fundo, nunca as configurações no lugar da coluna). Vale igual ao fechar e com ⚙ + 💬 juntos.
    Fundo da página escuro no compacto (`html.lc-modo-compacto`) para a sobra do alargamento [S].
    **Decisões técnicas (fable, 15/10/2026, a mais reversível):** (xiii) ordem por largura (cresce/encolhe) e não por lado:
    confiança alta no harness, média no client; reverte se o traço mostrar a página pintando antes do `resize`; (xiv)
    `MOVE_APOS_CSS_QUADROS = 0` (MoveTo na mesma volta do CSS): média; sobe para 1 se o traço/vídeo mostrar a coluna pulando
    para a esquerda por um quadro; (xv) painel escondido 2 quadros: alta (custo 33 ms de "aparece depois").
    — **prova (15/10/2026):** `teste-compacto-lateral.mjs` 115/115 com a **janela por quadros** (a página só sabe do `ResizeTo` um
    quadro depois; cada quadro é o que a tela mostra): nenhum quadro com a coluna cortada ou fora do lugar ao abrir/fechar ⚙,
    com o chat aberto, ⚙ + 💬 juntos, toda ordem de lista/conversa/⚙, monitor pequeno; partida no meio da transição sem
    `MoveTo`; prazo do `resize` destrava a fila. Rodado contra o código de antes (cópia do `HEAD` 6db5898): 10 vermelhos
    (coluna cortada no #41 ao abrir). Mutações (esconder, os 2 quadros antes de encolher, CSS velho no `ResizeTo`): vermelhas.
    `teste-compacto.mjs` 175, `jogo` 47, `lobby` 136, `selecao` 165, `posjogo` 118, `fim-de-partida` 89. **Só o client prova:**
    a corrida CSS × `MoveTo` (0-1 quadro; nos dois sentidos o harness segura ≤ 1 quadro torto e nunca a coluna cortada), se o
    `resize` chega antes do 1º quadro no tamanho novo e se o `ResizeTo` mantém o canto (correção depois dele = 2º pulo). Ler
    `__lolClient.compacto.geometria().traco` depois de abrir/fechar a ⚙ no lobby (`pedido → resize → tamanho → css → move →
    releitura`, relógio em ms; `tamanho-prazo` ou `releitura corrige:true` = ainda pisca).
    — **revisão adversarial (15/10/2026):** sequências testadas: ⚙ com 💬 aberto, fechar em toda ordem (as 6 permutações já
    passam por todos os fechamentos), borda do monitor, recarga com painel aberto (a lateral não guarda a ⚙: volta fechada, sem
    CSS da esquerda), partida no meio. **Achado real:** ⚙ aberta numa partida inteira. Na partida o roteador zera o CSS e encolhe a
    janela a 420 sem a geometria saber (`g.esqAplicado` seguia 360); ao sair, a montagem do pós-jogo punha 360 numa página de 420
    antes do `ResizeTo` e a geometria crescia "com a esquerda velha" 360: o mesmo pisca, por uma ida e volta. Variante: fechar a ⚙
    e a partida começar nos 2 quadros antes do `ResizeTo` deixava a âncora 450 px físicos errada (a janela pulava ao abrir o chat
    depois). **Decisão técnica (xvi, fable, 15/10/2026, a mais reversível; confiança alta no harness):** a geometria parte da
    esquerda **pintada** (`medidasJanela().pintada`, CSS da camada) e não da que ela aplicou; o estado (`esqAplicado`, alvo) vale
    no `MoveTo`, não no fim da tarefa; troca de tela já no compacto, fora da partida e com a janela pequena vai pela fila da
    geometria (`pelaGeometria` em `index.js`). Reverte se o pós-jogo voltar a encolher a lateral. Prova: dois casos novos em
    `teste-compacto-lateral.mjs` ("⚙ aberta numa partida inteira", "⚙ fechada nos quadros antes do ResizeTo"), vermelhos antes
    (coluna cortada no #121; janela em 1090 em vez de 640); numa cópia, desfazer `pintada` ou `pelaGeometria` deixa o 1º vermelho;
    o estado no `MoveTo` é redundante com `pintada` (desfeito sozinho segue 117/117; fica por deixar o estado honesto); 117/117 e
    as outras suítes verdes.
    **Correção do registro:** o traço não decide (xiv): com 0, `css` e `move` saem no mesmo ms do JS; quem chega primeiro na tela
    só vídeo ou captura em alta taxa mostra. Também só o client: perto da borda direita o `ResizeTo` primeiro passa da borda do
    monitor até o `MoveTo` (na 2ª tela, visível por 1+ quadro); `windowWidth` físico confirmado no `centerWithinMainWindow` da Riot.
    Fica de risco aceito: uma troca de tela da Riot exatamente na espera do `resize` (≤ 250 ms) de um clique na ⚙ ainda pode pôr
    o CSS novo antes do `MoveTo` (raro; a montagem com `entrando` segue com `porLarguras`).
15. [ ] **Registro das expansões (pedido de 15/10/2026 ~04:40).** Palavras dele: "sempre que o modo compacto saísse de
    maneira automática para o modo estendido, fosse computado e logado as informações pertinentes, motivo, janelas etc, pra
    gente tentar depois transformar o que faz sentido em tela do modo compacto também."
    **Entendimento:** cada vez que o efetivo do roteador vira `compacto → expandido` sai um evento estruturado; a volta
    (`expandido → compacto`) fecha o mesmo evento com a duração e o "como voltou". Serve para decidir, com contagem, quais
    telas da Riot merecem tela compacta. Expansão pedida por ele (⤢, Ctrl+Shift+M, botão de uma tela, Ctrl+K, Configurações
    da Riot pelo painel, compacto desligado) também entra, marcada `porEle`.
    **Como (construído em 15/10/2026):**
    - plugin: `pengu/compacto/expansoes.js` (sem DOM): `descreverCamadas(doc)` (filhos do `#lol-uikit-layer-manager-wrapper`
      menos o chat: tag, id, classes, filhos de 1º nível; texto só de título/botão e só com palavras de uma lista de vocabulário
      de interface, o resto vira `…`: nome de jogador nunca passa, por construção) e `criarRegistroExpansoes` (fila em memória
      de até 100 eventos, manda em lote ao coletor, reenvia a cada 60 s; coletor fora ou sem a rota (404) = guarda).
    - roteador (`index.js`): **um ponto só**, o `resolver()` compara o efetivo antes e depois do laço do `aplicar` (pega
      emergência, expansão adiada pelo foco, todos os caminhos). Origem da expansão: `est.forcadoTipo` gravado onde
      `est.forcado` nasce (`modal`, `erro-tela`, `janela-voltou`, `sem-riotinvoke`, `config-riot`) ou o destino da fase
      (`fase`, `jogo-fora`), `por-ele`, `desligado`, `sem-tela`, `erro-roteador`. Janela antes (na hora) e depois (lida
      `GRACA_MEDIDA_MS` + 100 ms depois); fase, etapa do fim de partida (`currentSequenceEvent`), fila, mapa, espera do foco.
    - coletor: `POST /compacto/expansoes` (mesma regra de origem do `/aceite/plugin`: só o Pengu e a página do client),
      `coletor/expansoes.py` saneia de novo (chaves conhecidas, texto cortado, Riot ID fora) e grava
      `dados/expansoes-compacto.jsonl` (rotação 1 MB × 3). Relatório: `python tools/relatorio-expansoes.py [--desde AAAA-MM-DD]
      [--json]` agrupa por origem/motivo/camada com contagem, duração (mediana, máximo), como voltou e 3 exemplos.
    **Decisões técnicas (fable, 15/10/2026, a mais reversível):** (xvii) texto da camada só com vocabulário de interface
    (lista fixa; palavra fora vira `…`): confiança alta na privacidade, média na utilidade; reverte ampliando a lista, nunca
    passando texto livre; (xviii) diff no `resolver` e não um gancho por caminho: alta; o que fica de fora é uma ida e volta
    inteira dentro do mesmo `resolver` (até 5 voltas), que não muda a janela; (xix) dois registros por expansão (`inicio`,
    `fim`) com o mesmo `id`: expansão que nunca voltou (client fechado) aparece no relatório como "sem volta".
    — **prova:** `node tools/teste-compacto-expansoes.mjs` (regra 7, fase, celebração, erro de tela, janela que volta, sem
    riotInvoke, por ele, Configurações da Riot, duração e volta, fila sem coletor e com 404, privacidade da camada);
    `python tools/teste-expansoes.py` (origem, saneamento, rotação, relatório); as suítes do compacto verdes.
    **Feito offline em 15/10/2026:** `teste-compacto-expansoes.mjs` 34/34 (sem o `notarExpansao` no `resolver`: 13/34),
    `teste-expansoes.py` 18/18, `teste-aviso-partida.py --sem-janela` 81/81 (rota `/aceite/` igual), `teste-compacto` 175,
    `lobby` 136, `selecao` 215, `posjogo` 124, `fim-de-partida` 90, `lateral` 118, `jogo` 47, `chat-posjogo` 45. O guarda
    "base do compacto sem `'POST'`" pegou o envio no `index.js`: o POST ao coletor mora em `expansoes.enviarAoColetor`.
    Achado na construção: as telas chamam `ctx.expandir()` sozinhas (lobby personalizado, seleção com banco, chat sem
    coletor, pós-jogo sem saída): sem o gesto elas contariam como "por ele"; viram `tela-sozinha` (ARMADILHAS § Client).
    **Só o client prova:** a rota no ar depois do coletor reiniciado (orquestrador, no lobby) e as primeiras linhas reais
    (`window.__lolClient.compacto.expansoes()` pelo `tools/cdp.mjs eval` mostra a fila e o último envio).
    **Revisão adversarial (15/10/2026, corrigido com teste):**
    - **lote acima de 64 KiB travava a fila:** o `servidor_local.do_POST` lê no máximo 65536 bytes de corpo; 50 eventos com
      camadas (~1,2 KB cada, a fila cheia enquanto o coletor velho responde 404) cortavam o JSON, o coletor dava 400 e o plugin
      reenviava o mesmo lote para sempre. Agora o lote vai até `LOTE_BYTES` (40 000 bytes UTF-8); evento sozinho maior perde
      as camadas (fica a que expande, `camadasCortadas`) e, se ainda não couber, sai como descartado; 400/413 tira o lote da
      fila (descartado, um log) em vez de repetir. Prova: 45 expansões com 6 camadas na fila → 90 eventos entregues em lotes
      ≤ 64 KiB, nenhum 400.
    - **motivo de erro de tela levava `e.message` cru** (texto livre, podia trazer dado da LCU) ao jsonl e ao `coletor.log`:
      no registro o parêntese passa pelo `textoSeguro` (`motivoSeguro`); na tela dele o motivo segue inteiro.
    - **`origem: 'padrao'`** ("iniciar no compacto" desligado: o ▣ dele vale até a fase virar) contava como automática; é
      escolha dele: `porEle`, gatilho "config: iniciar no compacto desligado".
    - **gesto:** tecla vale só Enter/Espaço (digitar no chat do compacto não é pedido de expandir); o gesto é medido no pedido
      (`ctx.expandir()`), não na expansão que esperou o foco, e o gatilho não se perde num `resolver()` no meio da espera.
    - **relatório na hora local:** o plugin carimba em UTC; `--desde` e os exemplos usam a hora de Brasília (`hora_local`).
    - Conferido e sem mudança: `geometria.tela()` é cache (nada de `riotInvoke` por `resolver`); `seq` vem de `est.seq.nome`.
    Fica de risco aceito: apelido de jogador feito só de palavras do vocabulário ("Novo Time") passaria no título de uma
    camada; Enter no chat do compacto até 1,5 s antes de uma tela expandir sozinha conta como dele.
    Provas depois da revisão: `teste-compacto-expansoes.mjs` 39/39, `teste-expansoes.py` 20/20.
16. [ ] **Posição em destaque na seleção (relato de 15/10/2026 ~04:15).** Palavras dele: "assim que eu entrar numa seleção
    de campeões, eu gostaria que por alguns segundos aparecesse um ícone representando a minha role. Poderia ser um ícone no
    lugar de todos os campeões ali [...] essa seção toda poderia ficar limpa e mostrando só a minha role. De repente, já que na
    linha do meu nome não tem os botões de posição, ordem, campeão, também dá para deixar uma palavra bem grande alinhada na
    direita, representando a minha role. Assim fica bem na cara, porque atualmente é uma palavra pequena embaixo do meu nome, no
    lugar da palavra 'tu'. Então fica bem difícil de perceber. E já é a segunda vez que eu caio de jungle, não percebo e acabo
    indo de Renekton, que é um campeão majoritariamente top."
    **Caso real** (`dados/lol.db`, `champ_select` de 15/10/2026 03:22): preferidas `TOP,JUNGLE`, recebeu `JUNGLE`,
    `isAutofilled` false (era a 2ª opção dele, não autofill), travou Renekton (58). Por isso o destaque compara com a **1ª**
    pedida, não só com o autofill.
    **Construído em 15/10/2026 (offline), tudo em `pengu/compacto/tela-champselect.js`:**
    - **(1) painel da posição:** na 1ª vez que uma seleção|posição aparece (`_papel.vistos`, no módulo: expandir e voltar não
      repete) e só com a vez de outro (`intencao`/`esperar`), a caixa de seleção (busca, favoritos, grade, botão) some por
      `_papel.ms` = 3,5 s e no lugar fica o ícone do client (`/fe/lol-champ-select/svg/position-<pos>.svg`, o do pino da posição
      e do diálogo de troca da Riot; `assets.wad` do `rcp-fe-lol-champ-select` 16.20 lido em 15/10) e o nome grande
      (TOPO, SELVA, MEIO, ATIRADOR, SUPORTE). Destaque: **amarelo** "não é a tua 1ª: tu pediu TOPO"; **vermelho**
      "PREENCHIMENTO AUTOMÁTICO · tu pediu TOPO e SELVA" (`isAutofilled`, ou fora das 2 pedidas sem FILL: a regra do
      `coletor.py` `retrato`). Fecha no prazo, com um clique em qualquer lugar da tela (captura na raiz: o clique segue para o
      botão onde caiu) e **na hora** em que o ban/pick dele abre. 1ª sessão vista já na vez dele: não abre. Às cegas/ARAM/sem
      posição: nada. Posição mudou na mesma seleção (troca aceita): abre de novo com a nova.
    - **(2) palavra grande** à direita da linha "tu" (19 px, mesma cor do destaque), a seleção inteira, ao lado do selo do
      passo 11 b6 (`div.lc-cp-sel-eudir` = [selo][PALAVRA]). Embaixo do "tu" sai a posição pequena e o "(escolhendo)": fica só o
      campeão (itálico = intenção; a foto tracejada já marca).
    - **(3) aviso** (`avisoPosicao`): campeão em intenção ou na vez dele com menos de `POUCAS_NA_POSICAO` = 3 partidas tuas na
      posição atribuída → nota amarela "⚠ Renekton na selva: 1 partida · no topo: 74" (onde ele mais joga, mesma fonte) e a
      linha da posição do selo em amarelo. Fonte: `servicos.champ.estatisticas` (o histórico do selo, nenhuma leitura nova).
      Nunca no ban; nunca mexe em `pode()`/`disabled`; com "winrate no champ select" desligado, nada. Toma a linha da nota
      genérica de espera/intenção (a altura não muda).
    - Leitura nova: `GET /lol-lobby/v2/lobby` 1 vez por seleção (`lerPreferidas`), **[S]** nesta tela (o coletor já lê ali na
      seleção); falha = só o `isAutofilled` decide. Nenhuma escrita.
    **Decisões técnicas (opus com advisor, 15/10/2026, a mais reversível):** (xx) painel **irmão** da caixa de seleção, que fica
    no DOM escondida pela classe `lc-cp-sel-papel-on` da raiz (nunca dentro dela: o `replaceChildren` do `pintarEscolha` o
    apagaria e o campo de busca perderia o foco), sem cobrir pedido de troca nem os times: alta; reverte para sobreposição
    absoluta se a grade pular ao fechar. (xxi) `<img>` com `onerror` (sai o ícone, fica o nome; `_papel.semIcone` não tenta de
    novo), nunca `-webkit-mask` (404 vira bloco de cor): alta no harness, média no client. (xxii) lobby lido na seleção: média;
    reverte guardando a pos1 lida pela tela do lobby num memo do `comum.js` se o GET der 404 na seleção. (xxiii) limiar 3 e a
    posição da partida pelo item da missão/Golpear (`posicaoDaPartida`): partida sem item não conta, então pode avisar a mais
    (é só texto): média; sobe/desce mudando a constante. (xxiv) arranjo da linha **lado a lado** medido no harness em 420×680
    (fontes de reserva): todas as linhas 42 px, rolagem 0 em PLANNING, ban, espera, vez dele e finalização, nada cortado no pior
    caso (Nunu e Willump + ATIRADOR + selo de 2 linhas: nome 92/92 px); a 1ª versão (palavra 21 px com "(escolhendo)") cortava
    o nome a 74/106 px e foi trocada. Reverte para palavra sobre o selo se as fontes da Riot cortarem. (xxv) o aviso no lugar
    da nota genérica: com as duas, a espera rolava 10 px (644/634): alta. (xxvi) 3,5 s: média (pedido "alguns segundos";
    `_papel.ms`).
    Painel refeito com a mesma posição (o lobby responde depois e o destaque muda) entra sem a animação de novo.
    — **prova (15/10/2026):** `node tools/teste-compacto-selecao.mjs` 215/215 (seção 9, 50 casos novos, inclusive as duas
    seleções reais de `champselect-real.json` na mesma montagem; antes do código: 180/207, 27 vermelhos); `teste-compacto` 175, `lobby` 136, `posjogo` 124, `fim-de-partida` 90, `lateral` 118, `jogo` 47, `winrate` ok.
    Prints (harness, `temp/compacto-harness/2026-10-15-papel-*.png`, `#sel-papel` com `?pos=&ev=&hover=&auto=&fixo=`;
    ícones copiados do `assets.wad` para `temp/compacto-harness/svg/` e servidos pelo `servir.mjs` em `/fe/...`): 0 antes,
    1 SELVA 2ª opção, 2 SUPORTE autofill, 3 TOPO 1ª, 4 linha + aviso, 5 vez dele com TRAVAR ligado e o aviso, 6 finalização.
    **Só o client prova:** o `GET /lol-lobby/v2/lobby` na seleção, o SVG carregando dentro da camada compacta, as fontes da Riot
    na linha "tu" (corte) e se 3,5 s é tempo bom na PLANNING real.
    **Revisão adversarial (opus com advisor, 15/10/2026), 6 achados, todos com caso vermelho antes:**
    (a) **troca de posição pintava vermelho:** a troca muda o `assignedPosition` e não as preferidas nem o `isAutofilled`;
    TOPO → SUPORTE trocado por ele saía "PREENCHIMENTO AUTOMÁTICO · tu pediu TOPO e SELVA", e o autofill que trocou para a 1ª
    seguia vermelho. Agora `papelDe(l, prefs, ini)`: posição diferente da de entrada = "trocou de posição: era TOPO" (amarelo
    só se não é a 1ª), nunca vermelho; `isAutofilled` numa posição pedida também não. (b) trocou e **voltou** para a posição de
    antes: o painel não reabria (a chave `seleção|posição` já estava vista); agora `_papel.vistos` = seleção → {ini, vis}.
    (c) **recarga no meio da seleção** mostrava o painel de novo e perdia a posição de entrada (o vermelho de (a) voltava):
    `_papel.vistos` espelhado no `sessionStorage` (`lc-cp-papel`, 20 seleções, try/catch; sem storage = só o módulo).
    (d) **o GET do lobby na seleção não tem medição** (o coletor lê no Lobby/Matchmaking/ReadyCheck): reserva
    `preferidasLobby` em `comum.js`, gravada crua (com FILL) pela tela do lobby a cada leitura, apagada no lobby personalizado,
    vale por 1 h se o GET falhar; o GET que responde ganha dela. (e) **tecla** com o painel aberto (começou a digitar o
    campeão; a busca escondida perde o foco) fecha na hora, sem comer a tecla (ouvinte no documento, sai no `desmontar`).
    (f) **aviso sem dado:** partida sem o item da missão nem Golpear não tem posição; com menos da metade das partidas dele com
    o campeão de posição sabida, o aviso cala (20 partidas e só 1 classificada não viram "nenhuma partida na selva").
    Conferido e mantido: o painel nunca abre na vez dele (1ª sessão vista já na vez = não abre; vez chegou = fecha no mesmo
    evento); às cegas/ARAM sem nada; a palavra e o selo lado a lado seguem a medição (xxiv); "nenhuma partida" de campeão que
    ele nunca jogou fica (é verdade e é o caso do relato). Decisões: (xxvii) troca pela posição de entrada, não pelo evento da
    troca (`positionSwaps` some depois de aceito): alta; (xxviii) `sessionStorage` e não `localStorage` (morre com o client,
    a seleção também): alta; (xxix) reserva de 1 h: média, reverte pelo `PREFS_LOBBY_MS`.
    — **prova:** `teste-compacto-selecao.mjs` 231/231 (16 casos novos; 11 vermelhos antes), `teste-compacto-lobby.mjs` 138/138
    (2 novos: reserva com FILL, personalizada apaga); `teste-compacto` 175, `posjogo` 124, `fim-de-partida` 90, `lateral` 118,
    `jogo` 47, `expansoes` 34, `winrate` ok.
17. [ ] **Textos de produto, replay em 1 clique, quem está na sala, cor do campeão e chroma (relato de 15/10/2026 ~12:45).**
    Palavras dele: (a) "fui clicar no botão de baixar replay e apareceu o texto 'só porque tu clicou'. Esse texto é muito
    imaturo para um app. Outro é '1 clique na grade declara', que poderia ser 'clique para declarar' [...] preciso que tenha
    uma regra geral para que tenha uma comunicação mais correta [...] de preferência ajustar ou remover a regra que diz para
    falar desse jeito"; (b) "se eu clicar para assistir o replay, é porque eu já cliquei antes para baixar [...] queria clicar
    em assistir replay e iniciar o replay de primeira"; (c) "na sala do pós-jogo mostrasse um ícone [...] quais campeões estão
    na sala ainda"; (d) "o nick tá ótimo, mas o nome do campeão pode ser colorido de acordo com o lado [...] no mesmo esquema
    que funciona no modo expandido"; (e) "na seleção de skins, eu também quero poder escolher o chroma quando estiver
    disponível. Pode ficar em cima das splash arts". (O resto do mesmo relato, feitiços e "voltou" sem voz, é do coletor:
    [calibrar avisos](2026-10-14-calibrar-avisos.md).)
    **Causa de (a):** a persona do chat com o Gabriel ("tu fez", minúsculas) vazou para a interface. `C:\Dev\CLAUDE.md` agora
    diz que texto de interface nunca herda a persona; a régua do projeto é [TEXTOS-DA-INTERFACE](../docs/TEXTOS-DA-INTERFACE.md)
    (1 linha no CLAUDE.md) e `node tools/teste-textos.mjs` varre os literais de `pengu/**` e `painel/**` (no HEAD: 1/8, 241
    achados; depois: 8/8).
    **Construído em 15/10/2026 (offline):**
    - **(a) auditoria dos textos** em `pengu/**` e `painel/**` (≈150 literais): sem "tu/teu/tua" (impessoal ou "você/seu"; "tu"
      na linha dele vira "você"), imperativo de "você" (clique, tente, use, escolha, aguarde), sem "só porque", o app sem 1ª
      pessoa ("não foi possível…", "abrindo o client normal", "… desconhecido"), sem "dá para"/"pra"; o "1ª opção: TOPO" no
      painel da posição; "Buscar mesmo assim?" com maiúscula. Aviso (toast) com maiúscula inicial por `frase()`
      (`compacto/comum.js`, usado em `avisar()`, no Toast da fila rápida e no do pós-jogo). Palavras novas dos avisos no
      `VOCABULARIO` das expansões (abrindo, possível…), para o registro não virar "…". Não mexido: falas/rótulos da voz
      (`coletor/avisos.py`, LICOES), texto copiado da Riot (denúncia), o `VOCABULARIO`, log e comentário. Lista antes/depois
      completa no `git diff` de `pengu/` e `painel/` deste passo; amostra no guia.
    - **(b) assistir em 1 clique** (`pengu/replay.js`): sem `criarConfirmacao`; o clique dele manda o `POST .../watch` e avisa
      "abrindo o replay: o jogo vai abrir e o client volta quando ele fechar"; clique de reflexo até `REPLAY.reflexoMs` (4 s)
      depois de abrir não manda de novo. Vale no compacto e no painel grande (o mesmo `criarReplay`).
    - **(c) faixa de quem está na sala** (`compacto/chat-sala.js`): com a sala aberta e o eog lido, o cabeçalho troca o
      "N na sala" pelos ícones (16 px) dos campeões do eog, [aliados | inimigos], borda azul/vermelha/dourada (eu), quem saiu
      apagado no mesmo lugar; `title` "9 de 10 na sala" e "Nome #TAG · Campeão: saiu da sala". Regra (`presencaNaSala`): sem
      evento = dentro (sonda de 14/10: `left_room` de quem nunca teve `joined_room`, ARMADILHAS § LCU), último evento vale,
      falar = dentro; `GET .../participants` ([S]) a cada 4 voltas (~6 s) vale só se casar com alguém (puuid, summonerId ou
      Riot ID). Recolhida: só a última linha, como antes. Na honra também (a mesma faixa).
    - **(d) "(Campeão)" na cor do lado**: `nomeNaSala` dá ao campeão a mesma classe de cor do nick (aliado azul, inimigo
      vermelho, ele dourado), com a opacidade do expandido (`.lc-cp-camp` .72), como o `chat-posjogo.js` pinta o
      `.message-name` inteiro.
    - **(e) chroma** (`tela-champselect.js`): `skinsDoCampeao` traz `chromas` (os `childSkins` dele: unlocked/owned, sem
      `disabled`), cor como o skin-button da Riot (`corDoChroma`: 2 cores = diagonal 135°); na finalização, com a skin
      marcada tendo chroma, uma linha "chroma [padrão][bolinhas]" logo acima das splash arts; clique = o mesmo `PATCH
      session/my-selection {selectedSkinId}` da skin (o `requestSetSkin` da Riot manda o id do chroma); "padrão" volta à skin
      sem chroma; a bolinha escolhida ganha o anel dourado e a splash da skin-mãe segue marcada.
    **Decisões técnicas (opus, 15/10/2026, a mais reversível):** (xxx) "você/seu" quando precisa de pessoa (padrão da Riot
    pt-BR) e impessoal no resto: alta; reverte trocando os literais (o teste aponta cada um). (xxxi) caixa: rótulo curto
    segue o bloco (minúsculas do compacto aprovado) e só o aviso ganha maiúscula, por `frase()` central: média (o relato
    falou de tom, não de caixa); reverte tirando `frase()` do `avisar`. (xxxii) presença "sem evento = dentro": média (os 10
    entram na sala no fim da partida; quem caiu do jogo e nunca entrou aparece aceso); reverte para 3 estados (sem evento =
    meio apagado) se o client real mostrar gente fantasma. (xxxiii) faixa no cabeçalho, não numa linha nova: alta (a altura
    do dock é fixa; 420/420 sem estouro medido no harness). (xxxiv) chroma só os que ele tem: alta (a faixa de skins já
    mostra só as dele; a Riot oferece comprar os outros, o compacto não compra). (xxxv) reflexo de 4 s no assistir: média.
    — **prova (15/10/2026):** `teste-replay.mjs` 35/35 (4 vermelhos antes), `teste-compacto-fim-de-partida.mjs` 101/101 (11
    casos novos, vermelhos antes: crash em `lm.eventos`), `teste-compacto-selecao.mjs` 240/240 (6 vermelhos antes),
    `teste-textos.mjs` 8/8 (novo; 1/8 no HEAD), `teste-compacto` 175, `lobby` 138, `posjogo` 124, `lateral` 118, `jogo` 47,
    `expansoes` 39, `jogar-de-novo` 97, `config` 50, `runas`, `recompensas`, `chat-posjogo`, `aceite`, `abas`, `licoes`,
    `painel`, `teste-alertas.py` 133/133. Prints (harness, `temp/compacto-harness/`): `2026-10-15-sala-presenca-e-cor-do-campeao.png`
    (antes: `2026-10-14-fim-C-sala.png`), `2026-10-15-replay-assistir-1-clique.png`, `2026-10-15-chroma-rubi-escolhido.png`,
    `2026-10-15-textos-intencao-depois.png` (antes: `2026-10-15-papel-4-…png`), `2026-10-15-textos-papel-segunda-opcao.png`.
    **Só o client prova:** o `GET .../participants` na sala do pós-jogo (formato e se casa com o eog; sonda de 15/10 em
    EndOfGame achou a sala já fechada), se quem nunca entrou na sala aparece aceso, o `PATCH` com o id do chroma aceito na
    finalização real e as bolinhas com as cores da Riot, o replay abrindo no 1º clique e o aviso visível antes do MinimizeAll.
    **Revisão adversarial (15/10/2026):** (1) o varredor do `teste-textos.mjs` não entrava em template dentro de `${…}` (as
    abas do pós-jogo passavam sem leitura): agora varre a expressão e o template aninhado (caso novo), e pega "tento" e
    "baixa pelo"; três textos que ainda feriam o guia corrigidos ("baixa pelo client normal" → "baixe…", "(tento a cada 30 s)"
    → "(nova tentativa a cada 30 s)", "tento ler o histórico de novo" → "nova leitura do histórico em instantes").
    (2) "não é a 1ª opção · 1ª opção: TOPO" repetia "1ª opção": vira "fora da 1ª opção (TOPO)" (vale também com FILL, onde
    "2ª opção" seria falso). (3) no ícone da faixa da sala, o `title` da foto (só o campeão) ganhava do `title` do ícone e o
    "saiu da sala" sumia no hover: a foto perde o próprio. (4) cor do lado: o `jogadoresDoEog` não tinha a regra do expandido
    para eog sem `isPlayerTeam` (todo mundo sairia vermelho): agora o aliado é o time com `isLocalPlayer`; caso novo prova o
    time dele em 2º (lado vermelho) e sem a flag. Conferido sem mudança: assistir só fica clicável no estado `watch` (replay
    baixado); a faixa só mostra nome que o eog já mostra; chroma só da skin marcada, só os liberados, só por clique.

## Revisão da construção (13/10/2026)

Revisão adversarial achou 20 defeitos; nenhum falso, dois repetidos (12 = 2, 18 = 5): 18 distintos, todos corrigidos
com caso de teste, sem rota nova da LCU. Depois disso: `rodar-testes.py` 41/41 e os 10 módulos importados sem erro no
CEF do client (`node tools/cdp.mjs eval tools/compacto-importar.js`).

| # | achado | correção |
| --- | --- | --- |
| 1 | vigia de modais cega com o layer manager criado depois | espera pelo `<body>` até ele existir |
| 2 | painel do pós-jogo não abria se a camada caísse depois de 400 ms | `vigiarSaidaDoCompacto` |
| 3 | tela 3 congelava com o socket mudo | relê `GET session` a cada 2 s depois de 3 s sem evento |
| 4 | lobby solo em fila fora do compacto (Arena, TFT) | JOGAR apagado com a fila; busca só depois de escolher |
| 5 | troca feita dada como "fechou sem resposta" | segue por tipo + cell, julga pelo efeito em mim |
| 6 | janela devolvida a 1280×720 pela Riot ficava assim | desconfia de ≥ 1000 px; reencolhe; 3 vezes em 10 s desiste |
| 7 | conversa marcada como lida sem clique | `?auto=1` só marca depois de clique/tecla |
| 8 | qualquer página local mandava mensagem por ele | `origem_chat_ok` (403 fora da própria origem) |
| 9 | sem volta ao compacto na seleção da Riot | "▣ modo compacto" flutuante; some no ready check |
| 10 | telas 3 e 4 sem 💬 | `compacto/chat-botao.js` nas telas 1 a 4 |
| 11 | aviso tapando o TRAVAR | aviso abaixo do topo, `pointer-events:none` |
| 13 | CSS do pós-jogo encolhia o JOGAR | regras sob `.lc-cp-pj` |
| 14 | "hoje" mostrava o PDL absoluto | variação do dia + elo embaixo |
| 15 | janela compacta não se movia | topo arrasta por `Window.MoveTo` |
| 16 | Configurações da Riot atrás da camada | expandem como modal |
| 17 | ready check com `aceite.js` quebrado | expande em vez de ceder |
| 19 | conversa abria sozinha com o compacto desligado | desligado vence a lista aberta |
| 20 | Ctrl+Shift+M engolido com a chave desligada | atalho só age com a chave ligada |

## Riscos / o que pode dar errado

- **`ResizeTo` pequeno some com a tela da Riot de vez** (popup nativo fora do quadro): por isso as telas que
  surgem sozinhas expandem. Se o sinal de alguma não for achável, ela fica atrás da camada: a camada ganha botão
  "expandir" sempre visível e o passo 1 lista quais não têm sinal.
- **Clique da camada vazando para o Ember** embaixo: a camada captura todos os eventos; `el.click()` em botão do
  Ember não funciona (ARMADILHAS), mas a camada não clica no Ember, só chama a LCU.
- **Trocas [S]**: se o fluxo de estados não for o suposto, a tela 3 muda de forma. O passo 1 vem antes do 5.
- **Patch novo** renomeia seletor (`.navbar_backdrop`): conferir a lista em ARMADILHAS antes do passo 2.
- **Chat depende do coletor**: sem ele, o 💬 expande e abre o chat nativo.

## Revisão do protótipo (13/10/2026)

Revisão adversarial achou 13 defeitos; todos reais, corrigidos no protótipo e neste plano antes de pedir o passo 0.
Correção parcial em dois: (5) dodge impede a busca e fica no `Lobby` (tela 1), mas a baixa prioridade de leaver
entra em `Matchmaking` [S], então a tela 2 mantém uma variante; (6) a seleção do ARAM não ganhou protótipo próprio:
expande (decisão acima).

| # | achado | correção |
| --- | --- | --- |
| 1 | fases sem destino (Reconnect etc.) | tabela com as 13 fases; Reconnect/falha expandem; passo 3 prova |
| 2 | `#lc-posjogo` abre sozinho por cima | não abre no compacto (decisão + passo 7) |
| 3 | `#lc-runas`/`#lc-winrate` em z 100000 | escondidos no compacto, runa dentro da tela 3 (decisão + passo 5) |
| 4 | convite, duo, grupo sem caminho | tela 1 (grupo, convite, "o líder busca"), "convidar" na tela 5, passo 4 |
| 5 | penalidade na tela errada | dodge na tela 1; tela 2 só baixa prioridade [S] |
| 6 | ARAM sem seleção | ARAM expande na seleção (regra 7) |
| 7 | troca pedida sempre aceita | simular aceita/recusa/sem resposta, desistência e virada de fase |
| 8 | troca de campeão sem posse | `INVALID` com motivo quando falta o campeão |
| 9 | uma janela de conversa ou várias | uma por conversa, abre sozinha sem foco (tela 5 + passo 6) |
| 10 | "desconhecida expande" sem passo | `MutationObserver` na camada de modais (passo 3) |
| 11 | tela 3 sem – e ✕ | – e ✕ com aviso de dodge |
| 12 | dados sem rota nem [S] | rotas [H] do `/help` e tags "a medir" (fila, PDL, status, envio) |
| 13 | menores | 10 bans, jogar de novo pela fila da partida, Ctrl+Shift+M visível, anel parado na partida encontrada |

## Descartado e impraticável

| o quê | por quê | decisor |
| --- | --- | --- |
| seleção do ARAM compacta (nesta leva) | banco/reroll/feitiços próprios = outra tela; expande, proposta fica aberta | orquestrador (revisão de 13/10) |
| deixar a UI da Riot responsiva por CSS | medido 13/10: a viewport fica em 1280 e é cortada | orquestrador (medição) |
| tela compacta de ready-check | `aceite.js` + janelinha do coletor já são donos; duas telas brigariam pelo mesmo clique | orquestrador |
| nome dos inimigos / aliados ocultos no champ select | linha que não se cruza (fronteira do projeto) | Gabriel (fronteira de 13/10) |
| aceitar troca sozinho, pick/ban automático | automatiza decisão do jogador | Gabriel (fronteira) |
| chat da partida nas janelas de chat | `/lol-chat/v1/conversations` fica `[]` a partida inteira (ARMADILHAS); só OCR | medição de 13/10 |
| vários protótipos alternativos | ele pediu "só um protótipo inicialmente" | Gabriel |
| paridade, 14/10: esconder TFT, coluna larga, evento, CLASSIC e loja no compacto | CSS sobre telas da Riot que a camada cobre; volta a valer ao expandir | orquestrador (conferência de 14/10) |
| paridade, 14/10: esconder o popup do ready check no compacto | o popup já fica embaixo da camada | orquestrador (conferência de 14/10) |
| paridade, 14/10: aceitar/recusar dentro da camada com o aceite automático desligado | a decisão é do popup da Riot (o compacto expande) e a janelinha do coletor já serve nos dois modos; tela própria de recusar iria contra "nada decide pelo jogador" | orquestrador (conferência de 14/10) |
| paridade, 14/10: ARAM e seleção com banco, reconectar, honra, falha ao abrir o jogo | telas da Riot; já descartadas neste plano (regra 7). **Honra reaberta** pelo passo 12 (só a sequência `honor-vote`; celebrações seguem expandindo): vale o parecer dele na tela A | orquestrador |
| chat ao lado do compacto na 2ª tela (passo 13) | a lateral é a própria janela do client; a página só enxerga o monitor onde ela está e prender à borda evita cair na 2ª tela (outra escala). Chat na 2ª tela = só as janelas do coletor | medição de 14/10 |
| ⚙ sem nenhum quadro intermediário (passo 14b), agora | sem pedido atômico de posição + tamanho no client; o único caminho é `Window.ApplyMask` (existe no `LeagueClientUx.exe`, nenhum plugin da Riot chama, parâmetros desconhecidos): janela sempre na largura máxima e abrir ⚙ = tirar a máscara. Redesenho da geometria e escrita sem medição no client real; parado, não descartado | fable (15/10) |
| paridade, 14/10: `ux-show`/`ux-flash` do popup de runas no compacto | quem escolhe é a tela 3, e ele já está nela porque acabou de travar | orquestrador (conferência de 14/10) |

## Relatório

Relatório de execução de cada fase vai no sidecar [2026-10-13-client-compacto.d/](2026-10-13-client-compacto.d/)
(regra de 09/10/2026), nunca no corpo deste md.
