# Plano — client compacto, champ select compacto e chat fora do client (2026-10-13)

Pedido: — | client compacto (lobby, fila, champ select com trocas, pós-jogo, chat em janelas) | de: gabriel | desde: 2026-10-13 | origem: chat

- **Alvo:** `pengu/` (plugin: tela compacta por cima do client, troca de modo, botão no modo expandido),
  `coletor/` (janelas do chat fora do client, servidas pelo `servidor_local` 127.0.0.1:8765), `pengu/config.js`
  (chave `compacto.*`), `pengu/estilo.css`, testes em `tools/`.
- **Protótipo para aprovação:** [temp/2026-10-13-prototipo-client-compacto.html](../temp/2026-10-13-prototipo-client-compacto.html)
  (abre com duplo clique; nada de rede) · prints de cada tela em `temp/prototipo-compacto/tela-N.png` (1 a 7, mais
  `tela-3b.png`: finalização com troca de campeão recebida). `temp/` não é versionado.
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
- reconectar [H]: `POST /lol-gameflow/v1/reconnect` existe; o compacto **não** usa (expande e o botão é da Riot).
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
- **Reconectar é clique dele no botão da Riot:** em `Reconnect` o compacto expande e some; nunca reconecta sozinho.
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
| — | `ReadyCheck` | cede ao `#lc-aceite` e à janelinha do coletor (sem tela nova) |
| 3 champ select | `ChampSelect` (SR: 420/440/400) | timer e fase, aliados (posição + campeão), inimigos só por campeão (recolhível), 10 bans, busca + favoritos (Renekton, Zac), banir/escolher/travar, skin, feitiços, runa (escolha **dentro** da tela quando há 2+), trocas com aceito/recusa/desistência/virada de fase, – e ✕ com aviso de dodge |
| 7 regra | `ChampSelect` do ARAM (450) | expande: banco e reroll ficam com a tela da Riot |
| — | `GameStart`/`InProgress` | camada sai de cena (client normal embaixo do jogo, como hoje); volta no pós-jogo |
| 7 regra | `Reconnect`, `FailedToLaunch`, `TerminatedInError` | expande sozinho: o botão da Riot fica à mão |
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

11. [ ] **Paridade com o expandido (pedido de 14/10/2026 ~15:35).** Palavras dele: "garanta que todos os outros recursos
    que implementamos no modo expandido também tenham no modo compacto." Inventário e conferência no código em 14/10/2026
    (só leitura, `pengu/index.js`, `compacto/*`, `posjogo/index.js`, `champselect.js`, `runas.js`, `recompensas.js`,
    `config.js`, `aceite.js`, `sem-popups.js`, `estilo.css`, README). **Regra de dono:** `compacto/tela-champselect.js` e
    `tela-fila.js` são da frente seleção (passo 10: fotos da intenção, altura, roda de skins, anel);
    `compacto/tela-posjogo.js`, chat do pós-jogo, honra/placar, mentor e o painel de 6 abas no compacto são da frente fim
    de partida (protótipo `temp/2026-10-14-prototipo-compacto-fim-de-partida.html`). Correção num arquivo de outra frente
    = **especificar para ela** (o quê, linha, prova), nunca editar direto. Legenda: [S] = não medido no client real.

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
    | 5 | lições da tela 4 mostram "fora" sem o coletor (o motor local do painel não roda) | export novo em `servicos.posjogo` com as lições da análise local (depende do item 1; custo: partida + linha do tempo, até ~75 s com as novas tentativas). Consumo na tela 4 | export: `posjogo/index.js` · livre; consumo: `tela-posjogo.js` · **especificar para a frente fim de partida** |
    | 6 | selo do champ select: os dados já existem e a tela 3 não usa | reaproveitar `servicos.champ.coach()`, `estatisticas(id,pos)` e os formatadores `textoSelo`, `linhaMatchup`, `linhaTrauma`, `linhasDraft` de `champselect.js` (nenhuma leitura nova; o `champselect.js` já busca `/draft/<id>` a cada 3 s nos dois modos); o `estatFav` ignora `champSelect.ligado` (1 linha) | `compacto/tela-champselect.js:903-912` · **especificar para a frente seleção** |

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

    **d) Precisa de tela nova: protótipo único + aprovação do Gabriel antes de código (regra do passo 0):**
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
| paridade, 14/10: ARAM e seleção com banco, reconectar, honra, falha ao abrir o jogo | telas da Riot; já descartadas neste plano (regra 7) | orquestrador |
| paridade, 14/10: `ux-show`/`ux-flash` do popup de runas no compacto | quem escolhe é a tela 3, e ele já está nela porque acabou de travar | orquestrador (conferência de 14/10) |

## Relatório

Relatório de execução de cada fase vai no sidecar [2026-10-13-client-compacto.d/](2026-10-13-client-compacto.d/)
(regra de 09/10/2026), nunca no corpo deste md.
