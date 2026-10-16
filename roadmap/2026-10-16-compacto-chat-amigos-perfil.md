# Plano — compacto: chat com recentes, amigos com grupos e menu, perfil (2026-10-16)

Plano para um executor que nunca viu a conversa. Só planejamento e medição: **nada aqui foi construído**. Projeto
`C:\Dev\lol-client`, plugin Pengu em `pengu/compacto/`. Antes do 1º Edit: hub `C:\Dev\cerebro\projetos\lol-client.md`,
`CLAUDE.md`, `docs/ARMADILHAS.md` (§ Client e Pengu, § LCU), `docs/TEXTOS-DA-INTERFACE.md` e o passo 13 do
[plano do compacto](2026-10-13-client-compacto.md) (a lateral nasceu lá; este plano muda a regra dela).

Três etapas independentes, nesta ordem, cada uma com commit próprio: **1 chat**, **2 amigos**, **3 perfil**.
Relatório de execução de cada etapa no sidecar `roadmap/2026-10-16-compacto-chat-amigos-perfil.d/`, nunca neste corpo.

## Pedido (palavras do Gabriel, 16/10/2026 de manhã, várias mensagens; a última corrige as anteriores)

1. Relato: "me chamaram, apareceu notificaçãozinha no botão de mensagens de amigos, mas lá não aparece a conversa, aparece
   só a lista de amigos. O único jeito para ver a conversa foi abrindo o modo expandido." Quer o histórico (conversas
   recentes).
2. Correção: "eu não quero que a janela abra sozinha com a mensagem. Apenas mostra a notificação e só abra por meio do
   botão. E se eu já estiver em outra conversa, não muda nada: simplesmente mostra ali que tem alguém que me chamou nessa
   região de recentes. Mas a conversa não abre sozinha também."
3. Última mensagem sobre o chat: "do lado do botão de chat pode ter um botão de amigos. O botão de chat abre só a janela de
   recentes com a conversa aberta: a última conversa aberta depois que o jogo ligou. A conversa aberta também tem um
   xizinho para fechar, e aí sobra só a lista de chats recentes, sem mostrar a conversa. O botão de chat abre essa janela
   inteira; o botão de amigos mostra a lista de amigos."
4. Amigos: "os grupos da lista de amigos aparecem no topo. Por exemplo, eu tenho a lista tropa, quero que ela apareça no
   topo. Tenho que conseguir reordenar dentre os grupos existentes (criados + geral). Tem que funcionar da mesma maneira
   que ocorre no modo expandido." "No clique do direito, nos usuários, também tem que ter as mesmas opções do que no clique
   expandido. Convidar para a partida." "Quero poder arrastar essa pessoa para dentro da janela principal do modo compacto
   para arrastar ela para o meu lobby, caso o lobby já esteja criado. Na verdade, o jogo sempre tem que estar no lobby para
   que possibilite convidar alguém para o lobby." "Quero poder dar clique direito num contato e poder assistir a partida
   caso eles estejam na partida."
5. Perfil: "Toda a questão também de exibir perfil, mostrar histórico, baixar replay das partidas seria interessante, bem
   como os recursos principais do meu perfil também. Sei que o meu histórico já existe, né? Mas de repente poder trocar a
   foto de perfil, por exemplo. A moldura, a bandeira, título, Emblema." "O meu background do perfil definido também
   poderia ser o background na janela principal. Só que como o background é no modo paisagem e o client compacto é no modo
   retrato, daria para deixar meio que centralizado esse background, porém expandido para caber 100% nessa tela principal.
   E aí seria cortado o lado esquerdo e o lado direito."

## Entendimento

Hoje (passo 13, commit `c713c3d`) o 💬 abre a **lista de amigos** (300 px) à direita da coluna; clicar num amigo abre a
conversa num **painel de 360 px com abas** (até 3 conversas, coach 📊 e sala do time como abas). Mensagem nova abre a
conversa sozinha "se couber sem mover a janela e nunca na seleção" (decisão 1 do passo 13, chave
`compacto.conversaSozinha`). Não existe vista de conversas recentes: com a notificação no 💬 ele caía na lista de amigos
e não achava quem chamou.

O que muda:

- **💬 = janela de chat** (o painel de 360): altura dividida e **fixa**, recentes em cima (~1/3, rolagem própria) e a
  conversa escolhida embaixo (~2/3, campo de envio no fundo). Abre mostrando a **última conversa que ele abriu desde que o
  client ligou** (memória da página). ✕ da conversa fecha só a conversa: os recentes ocupam a altura toda. As abas somem.
- **Botão de amigos novo** ao lado do 💬 abre/fecha a coluna de amigos (300 px), independente do chat.
- **Nada abre sozinho, em fase nenhuma.** Quem chama sobe nos recentes com o número de não lidas; o 💬 mostra a bolha.
- **Amigos com grupos como no client da Riot** (mesma ordem, recolher, reordenar arrastando, gravando onde a Riot grava),
  menu do clique direito com os itens da Riot, e arrastar um amigo para a coluna principal = convite para o lobby.
- **Perfil**: perfil de amigo (dados, histórico, assistir ao vivo), editor do meu perfil (ícone, moldura, bandeira,
  título, emblemas) e o fundo de perfil dele como fundo da coluna principal.

## Medição (16/10/2026 ~13h, client real em `InProgress`, só GET por `node tools/cdp.mjs eval` com fetch relativo)

Scripts no scratchpad da sessão (`medir-social.js`, `medir-social2.js`; saída só com chaves e contagens, sem nome, puuid
ou id de terceiro; nada disso vai para o repo). `League of Legends.exe` estava aberto: nenhuma prova com janela rodou.
Lobby 404 era o esperado (fase de jogo). Patch 16.20.

| rota (GET) | resultado medido |
| --- | --- |
| `/lol-chat/v1/friend-groups` | 4 grupos `{id, name, priority, isMetaGroup, isLocalized, collapsed}`: `Tropa` id 1 prio 4, `**Default` id 0 prio 3 (**não** é meta), `MOBILE` 10001 prio 2 meta (collapsed), `OFFLINE` 10000 prio 1 meta |
| `/lol-chat/v1/friends` | 195 amigos; chaves `groupId`, `groupName`, `displayGroupId`, `displayGroupName`, `note`, `isP2PConversationMuted`, `name` (≠ `gameName`), `gameTag`, `icon`, `lol{…}`. A **exibição** é por `displayGroupId`: 150 do Geral e 27 da Tropa estão no OFFLINE (10000), 3 no MOBILE; `groupId` segue 0/1 |
| `friends[].lol` | `gameStatus`, `queueId`, `gameQueueType`, `isObservable`, `spectatorKey` (os 3 em partida tinham), `puuid`, `championId`, `playerTitleSelected`, `challengeTokensSelected`, `regalia`, `rankedLeague*` |
| `/lol-chat/v1/conversations` | 5 conversas `type:"chat"` em plena partida; **as 1:1 também trazem as chaves `password` e `mucJwtDto`** (seguir tirando); `lastMessage {body, timestamp, fromId, fromPid, fromPuuid, type, …}` em todas: dá o trecho e a ordem dos recentes |
| `/lol-spectator/v3/buddy/can-spectate/{puuid}/{spectatorKey}` | `{availableForWatching, reason}` (amigo em TFT ranqueada: `false`) |
| `/lol-spectator/v1/spectate/config` | `isEnabled:true`, `spectatableQueues` (420, 440, 400, 450, 490, 1700…) |
| `/lol-platform-config/v1/namespaces/LcuBuddySpectate` | `{Enabled:true}` |
| `/lol-summoner/v1/profile-privacy-enabled` | `"DISABLED"` (a checagem de perfil privado da Riot não bloqueia nada aqui) |
| `/lol-summoner/v2/summoners/puuid/{puuid}` (amigo) | 200, `privacy:"PUBLIC"`, `profileIconId`, `summonerLevel`, `gameName`, `tagLine` |
| `/lol-ranked/v1/ranked-stats/{puuid}` (amigo) | 200, `queueMap`, `highestRankedEntry`… |
| `/lol-summoner/v1/summoner-profile?puuid=` (amigo) | 200, `{backgroundSkinId, backgroundSkinAugments, equippedBannerFlag, regalia}` |
| `/lol-collections/v1/inventories/{summonerId}/backdrop` | dele e de amigo: 200, `{backdropType:"specified-skin", backdropImage:"/lol-game-data/assets/ASSETS/Characters/<campeão>/Skins/SkinN/Images/<x>_splash_centered_N.jpg", backdropVideo:"", backdropMaskColor, …}` |
| `/lol-match-history/v1/products/lol/{puuid}/matches?begIndex=0&endIndex=N` (amigo) | 200, `{accountId, platformId, games:{games:[…]}}`; cada jogo com `gameId`, `queueId`, `gameDuration`, `participants` (1, o dono) |
| `/lol-match-history/v1/games/{gameId}` (jogo de amigo) | 200, 10 `participants` e 10 `participantIdentities` |
| `/lol-champion-mastery/v1/{puuid}/champion-mastery-view/top?count=3` | **405**: no front da Riot é **POST** (não medível pela régua) |
| `/lol-summoner/v1/current-summoner/summoner-profile` | `{backgroundSkinId, regalia}` |
| `/lol-regalia/v2/current-summoner/regalia` | `{preferredCrestType:"prestige", crestType, preferredBannerType:"blank", bannerType, selectedPrestigeCrest:9, highestRankedEntry, lastSeasonHighestRank, profileIconId, summonerLevel}` |
| `/lol-challenges/v2/titles/local-player` | array de 85 `{itemId, name, …}` |
| `/lol-challenges/v1/summary-player-data/local-player` | `{title, topChallenges(3), bannerId, crestId:"1", prestigeCrestBorderLevel:200, selectedChallengesString, …}` |
| `/lol-challenges/v1/challenges/local-player` | 399 desafios |
| `/lol-inventory/v2/inventory/SUMMONER_ICON` | 205 ícones dele |
| `/lol-inventory/v2/inventory/REGALIA_BANNER` | 4 itens (o `v3` deu 404) |
| `/lol-platform-config/v1/namespaces/Replays` | só `MinutesUntilReplayConsideredLost`: **sem `ThirdPersonAccessibleGameQueues`** |
| `/lol-platform-config/v1/namespaces/Regalia/BannerSkinsEnabled` e `…/Challenges/IdentityCustomizerBannerSkinsEnabled` | 404 (destaque de bandeira provavelmente desligado nesta região) |
| `/lol-banners/v1/current-summoner/flags` · `…/flags/equipped` · `…/frames/equipped` | 0 bandeiras do Clash · 404 · 404 |

## Front da Riot lido (16.20, `python tools/ler-wad.py <assets.wad> <pasta fora do repo>`)

Arquivos (nome = hash dentro do `.wad`, estável para 16.20; reextrair com o `ler-wad.py` se o patch mudar):
`rcp-fe-lol-social` → `34f2d9061fb95af6.js` (+ pt-BR em `b6fd06e0027281c0.bin`); `rcp-fe-lol-shared-components` →
`9cbc81de4b27be2d.js` (+ pt-BR `98c1ed67df587b59.bin`, `f4e8b2c724c337ec.bin`); `rcp-fe-lol-profiles` →
`3e7da685a8f3eb46.js`; `rcp-fe-lol-match-history` → `70f9590985796fa8.js`; `rcp-fe-lol-parties` → `63033b1005ac2ae0.js`.
Nada abaixo foi enviado ao client real.

### Grupos de amigos (social, serviço Ember `friend-groups`, o roster v2 que o client usa hoje)

- Lista: observa `/lol-chat/v1/friend-groups`; filtra `mobile` só na Tencent; ordena `_groupSort` = **`priority`
  decrescente, empate por nome**; decora `**DEFAULT`/`**OTHERSHARDS`/`**OTHER`. Rótulo do `**Default` = "Geral"
  (`group_label_default`); meta usa `group_label_<nome>`.
- Roster (`lol-social-roster`, `_generateRosterModel`): amigos por **`displayGroupId`**; grupo desconhecido vai para o 0;
  ordem dos grupos = a da lista acima.
- Recolher: `saveGroupCollapsed(g)` = `PUT /lol-chat/v1/friend-groups/{id}` com o **objeto do grupo inteiro** como lido,
  `collapsed` trocado.
- Reordenar: arrasto do cabeçalho do grupo (`draggable` = `!isMetaGroup`; mime `ROSTER_GROUP`), `onDrop` →
  `moveGroup(id, posição)` (splice) → `saveGroupOrder`: para cada grupo na ordem nova, **`priority = length − índice`**,
  e `PUT /lol-chat/v1/friend-groups/{id}` (objeto inteiro) só nos que mudaram e **não são meta**. Atenção: o módulo velho
  `chat/friend-groups.js` usava `100 − n`; vale o v2 (as prioridades medidas 4/3/2/1 confirmam).
- Mover amigo de grupo: `setGroup(id, groupId)` = `PUT /lol-chat/v1/friends/{id}` com o **objeto do amigo inteiro**,
  `groupId` trocado. Destinos: todos os grupos menos meta e menos o atual (`makeMoveToContextMenuItem`; some se só há 1
  grupo ou o amigo está num meta, isto é, offline/celular).
- Pasta (cabeçalho, clique direito): criar `POST /lol-chat/v1/friend-groups {name, priority: max+1}`, renomear =
  `saveGroup` (PUT objeto inteiro), excluir `DELETE /lol-chat/v1/friend-groups/{id}`; nomes validados por
  `validateGroupName` (vazio, repetido, reservado: Geral, Celular, Offline, Discord, Outros).

### Menu do clique direito no amigo (`contextMenuModel` do `lol-social-roster-member`, nesta ordem)

| item (pt-BR da Riot) | quando aparece / cinza | ação da Riot |
| --- | --- | --- |
| Convidar para partida | some se não convidável pela LoL; cinza se `!canInviteToGame` (`_availableForGame` e não remoto e `parties.canInvitePlayer`) | `POST /lol-lobby/v2/lobby/invitations [{toSummonerId}]` (parties `invitePlayer`: recusa se já está no lobby ou o grupo está cheio) |
| Enviar mensagem | sempre (menos só-Discord) | abre a conversa |
| Assistir partida | some sem `puuid`/`spectatorKey`; cinza se `can-spectate` ≠ `availableForWatching:true` (dica `spectator_tooltip_queue_disabled` ou `…_custom_games_transient_disabled`) | perfil privado → alerta; senão `POST /lol-spectator/v1/spectate/launch {dropInSpectateGameId: friend.name, gameQueueType, allowObserveMode: lol.isObservable, puuid: lol.puuid, spectatorKey: lol.spectatorKey}` (assistindo alguém: `dropInSpectateGameId`/`spectatingTargetPuuid` do `lol`) |
| Exibir perfil | cinza se perfis desligados | `profilePlugin.showOverlay({summonerId, puuid})` |
| Dar presente | só com presentes ligados | navega para a loja (presentear) |
| Adicionar/Editar anotação | sempre | `PUT /lol-chat/v1/friends/{id}` `{...amigo, note}` |
| Mover › (pastas) | ver grupos acima | `PUT /lol-chat/v1/friends/{id}` com `groupId` |
| Desfazer amizade/Bloquear | sempre (perigo) | diálogo único (`confirmUnfriendOrBlockFriendHelper`): **aceitar** "Desfazer amizade" = `DELETE /lol-chat/v1/friends/{id}`; **recusar** "Bloquear" = `POST /lol-chat/v1/blocked-players {summonerId, puuid}`; ✕ = nada; caixa "Também denunciar" (só com `dmReportingEnabled` e não denunciado) |
| Denunciar | some sem `dmReportingEnabled`; cinza se já denunciado ou sem mensagem recebida dele | diálogo com "também bloquear" (marcado); `POST /lol-player-report-sender/v1/direct-message-reports {offenderPuuid}` |

Fora do roster v2 (só no módulo velho da janela de chat): "Silenciar/Dessilenciar". Textos pt-BR no `.bin` do social
(`context_menu_*`, `roster_confirm_*`): copiar literal e nomear como exceção em `tools/teste-textos.mjs`, como o
`TEXTOS_DENUNCIA` de `compacto/jogador-acoes.js`.

### Arrastar para convidar (parties)

Roster: `onDragStart` põe `application/riot.player+json` `{type:"chat-user", id, summonerId, name}` só se
`canInviteToGame`; o lobby da Riot aceita com `canReceiveDrops = canInvite && !emFila` e convida pelo mesmo
`invitePlayer`. No compacto o arrasto é entre elementos da própria camada (HTML5 DnD; o `drop` de verdade tem `isTrusted`).

### Perfil de outro jogador, histórico, replay

- Perfil (profiles): `summoner` por puuid, `ranked-stats/{puuid}`, `inventories/{summonerId}/backdrop`, maestria top 3
  por **POST** `/lol-champion-mastery/v1/{puuid}/champion-mastery-view/top?count=3`, privacidade `hasPrivateProfile` =
  `profile-privacy-enabled` + `summoners/{id}.privacy`.
- Histórico (match-history, `_loadFriendData`): `GET /lol-match-history/v1/products/lol/{puuid}/matches`; detalhe
  `GET /lol-match-history/v1/games/{gameId}`; linha do tempo `GET …/game-timelines/{gameId}`.
- Replay de terceiro: `shouldShowReplayButton` exige, na vista de terceiro, `queueId` na lista
  `platformConfig.Replays.ThirdPersonAccessibleGameQueues`, que **não existe aqui** → a Riot **não mostra** baixar/assistir
  replay no histórico de amigo. Rotas de replay = as de `pengu/replay.js` (ARMADILHAS § LCU "Replay").

### Meu perfil (identity customizer de shared-components; abas pt-BR "Molduras", "Bandeiras", "Emblemas", "Títulos")

`saveAndExit` salva tudo ao sair, 3 chamadas, cada uma só se mudou:
- ícone: `PUT /lol-summoner/v1/current-summoner/icon {profileIconId}` (opções: `GET /lol-inventory/v2/inventory/SUMMONER_ICON`);
- regalia: `PUT /lol-regalia/v2/current-summoner/regalia {preferredCrestType, preferredBannerType, selectedPrestigeCrest}`
  (`preferredBannerType` = `"lastSeasonHighestRank"` ou `"blank"`, `convertBannerTypeFromBoolToString`; crest
  `prestige`/`ranked`);
- desafios: `POST /lol-challenges/v1/update-player-preferences` com `challengeIds` (3 posições, vazias = −1, só se há
  emblemas escolhidos), `title` (string do `itemId`, só se ≥ 0), `bannerAccent` (só com destaque de bandeira ligado),
  `crestBorder` (`"1"` prestígio, `"2"` ranque atual) e `prestigeCrestBorderLevel`. Leituras: `titles/local-player`,
  `challenges/local-player`, `summary-player-data/local-player`, `regalia`.
- fundo de perfil: leitura `GET /lol-collections/v1/inventories/{summonerId}/backdrop` (`backdropImage`); escrita (não
  pedida) `POST /lol-summoner/v1/current-summoner/summoner-profile {key:"backgroundSkinId", value}` +
  `{key:"backgroundSkinAugments", value}`.
- "Bandeira do Clash" (`/lol-banners`, `PUT …/flags/equipped`) é outra coisa: ele tem 0 bandeiras.

## Decisões

**Substituída (16/10/2026, palavras dele no item 2 do pedido):** a decisão 1 do passo 13 ("mensagem nova abre a conversa
sozinha só se couber sem mover a janela e nunca na seleção", chave `compacto.conversaSozinha`). Agora nada do chat abre
nem troca de foco sozinho, em fase nenhuma.

Técnicas (a opção mais reversível; confiança e o que reverteria):

1. **Ordem na direita: [coluna][amigos 300][chat 360]**, como hoje (lista colada na coluna). Arrastar o amigo até a
   coluna fica curto e `layout()`/geometria/teste seguem valendo. Alta; reverte trocando a ordem em `render`.
2. **Painel da direita tem um modo só por vez**: `chat` | `coach` | `perfil` (etapa 3) | fechado. 📊 e "Exibir perfil"
   ocupam o lugar do chat e, ao fechar, voltam ao modo anterior (pilha de 1). Alta.
3. **✕ da conversa esquece a "última conversa"**: o próximo 💬 abre só com os recentes. A "última" é sempre a última que
   ele abriu (clique num recente, num amigo ou em "Enviar mensagem"); recarga do client zera. Média (a frase dele admite as
   duas leituras); reverte guardando a última mesmo depois do ✕.
4. **"Lida" no clique do recente**: o clique na linha é gesto dele (`isTrusted`), então a conversa vira a ativa do client
   (`PUT conversations/active {id}`) já nesse clique, além da interação na própria conversa (regra de hoje). Continua o
   `conferirAtiva` (devolve com `DELETE` ao sair de vista). Alta.
5. **Coach lembrado (passo 13) deixa de voltar sozinho.** Com o 📊 no lugar do chat, voltar sozinho na seleção seguinte
   trocaria o que ele vê; fica só o 📊 por clique. Média; reverte deixando voltar quando o painel está fechado e a largura
   não muda.
6. **Rascunho por conversa** em `Map` da página (`pid` → texto): troca de conversa, ✕, fechar e reabrir o painel
   guardam; enviar com sucesso e recarregar o client apagam. Nunca em disco, DataStore, coletor ou log. Alta.
7. **Reordenar só entre grupos não meta** (criados + Geral); MOBILE e OFFLINE ficam sempre no fim e não recebem nem dão
   lugar. A Riot deixa soltar entre metas (o que daria prioridade igual a um meta); aqui a marca de soltar só aparece
   entre não metas. Alta.
8. **Convite só com lobby existente** (palavras dele): menu, botão e arrasto ficam cinza com motivo fora disso; a coluna
   de amigos **nunca cria lobby**. O caminho antigo `tela-lobby.convidarAmigo`, que cria lobby, só existe com a lateral
   desligada: fica como está (divergente, anotado). Alta.
9. **Editor do meu perfil com botão "salvar"** que manda só as chamadas que mudaram (a Riot salva ao sair). Escolher não
   escreve nada. Alta; reverte salvando no fechar.
10. **Fundo da coluna = imagem estática** (`backdropImage`), nunca o vídeo (custo de CPU numa janela que fica aberta o
    dia todo). Alta.
11. **Perfil de amigo e editor dentro da lateral** (painel da direita para amigo; painel da esquerda, o mesmo das ⚙,
    para o meu perfil, um dos dois por vez). Média; reverte para camada por cima da coluna.

## Linhas que não se cruzam (valem para as 3 etapas)

- Toda escrita na LCU (enviar, lida, convidar, mover de grupo, reordenar, recolher, anotação, remover, bloquear,
  denunciar, assistir, trocar ícone/regalia/preferências) só por clique, tecla ou soltar **dele** (`isTrusted`), com a rota e
  o corpo da tabela acima e o comentário citando arquivo e função da Riot. Destrutiva com a confirmação da Riot.
- Contra o client real só GET de medição; POST/PUT/PATCH/DELETE só na `tools/lcu-falsa.mjs` ou no harness
  `temp/compacto-harness` (portas 0 ou 8831-8840).
- Provas com janela (`rodar-testes.py`, prints) só com `League of Legends.exe` fechado (`tasklist` em comando separado);
  aberto = só os testes node, e dizer. Recarregar o client não é do executor.
- Largura só por `est.lateral` do roteador e `compacto/geometria.js`; ordem CSS/`ResizeTo`/`MoveTo` pela fila da geometria;
  saída do compacto só pelo `resolver()`.
- Nome oculto da ranqueada nunca aparece (sala do time segue campeão e posição). "Assistir" é o espectador oficial.
- Texto de interface no tom do guia (`node tools/teste-textos.mjs` passa); texto copiado da Riot vira exceção nomeada.
- Senha/token de sala (`password`, `mucJwtDto`) nunca saem do `lerConversas`; fixtures inventadas (sem puuid/nome real).

## Etapa 1 — chat: 💬 com recentes e conversa, ✕, botão de amigos, nada sozinho

**Estado (16/10/2026, tarde): construída, sem commit (o orquestrador commita).** Feito: estado novo da lateral
(`painel: null|'chat'|'coach'`, `anterior`, `conversa`, `rascunhos: Map`); `talvezAbrirSozinha`, `desfazerAuto`,
`FASES_ABRE_SOZINHA`, `MAX_CONVERSAS`, abas, `lembrarCoach` e a chave `conversaSozinha` removidos; recentes
(`limparConversas`, `verRecentes`, `criarRecentes` em `lateral-chat.js`) com a sala do time na 1ª linha na seleção (e fora
da lista de amigos); uma view de conversa para todas as 1:1 (`reiniciar`, `limpar:false` quando ele troca no meio do envio);
💬 = `alternarChat`, 👥 = `botaoAmigos` (`data-a="lista-amigos"`, porque `amigos` já é a lista do lobby) logo depois do 💬;
"+ convidar" abre a lista; textos e chave atualizados; README, ARMADILHAS e `CLAUDE.md` atualizados.
Decisões tomadas na execução: (a) "lida" também no clique do amigo na lista (o mesmo gesto que põe a conversa à vista;
decisão 4 só citava o recente); (b) monitor estreito: 👥/💬 com o painel aberto mas escondido **mostram** em vez de fechar;
(c) com 3 botões no topo os ícones ficam mais justos (o 👥 cortava "FINALIZAÇÃO" na seleção, medido no harness);
(d) [[DECISAO]] do coach voltando sozinho adotada como recomendado (nunca volta; reversível). Provas: `teste-compacto-lateral`
129/129 (mutações no scratchpad: abrir sozinho com o painel aberto e com ele fechado ficam vermelhas), bateria node do plugin
verde, `teste-textos` 9/9, prints `temp/compacto-harness/2026-10-16-etapa1-*.png` (cliques reais do Playwright).
**Só o client real prova:** PUT/DELETE `conversations/active` aceitos no clique do recente; fotos do perfil nos recentes; altura
1/3 com fonte e escala reais; `:has` no CEF 108 do client; o envio de rascunho guardado depois de trocar de conversa.
**Revisão adversarial (16/10/2026, antes do commit):** mutações conferidas (tirar `isTrusted` de "lida" e do Enter, abrir sozinho
com o painel fechado e trocar de conversa sozinho: todas vermelhas). Corrigido: envio em voo com troca de conversa (A → B → A
deixava o texto enviado como rascunho; a falha de A aparecia na conversa de B), comparação pela chave `k`, 2 casos novos (131/131).
Ficou: o 👥 também entrou no topo do lobby, pós-jogo e honra (título não medido nessas telas; só a seleção foi medida); na seleção
o relógio lê `/conversations` 2 vezes por volta (`lerConversas` e `lerSala`).

Arquivos: `compacto/lateral.js`, `compacto/lateral-chat.js`, `compacto/chat-botao.js`, telas que chamam `botaoChat`
(`tela-lobby.js` `cabecalho`, `tela-champselect.js`, `tela-posjogo.js`, `tela-honra.js`), `pengu/config.js`,
`pengu/blocos.js`, `tools/teste-compacto-lateral.mjs`, `tools/teste-compacto.mjs`, README, ARMADILHAS.

1. **Estado novo da lateral** (troca `e.abas`/`MAX_CONVERSAS`): `{lista, config, painel: null|'chat'|'coach', anterior,
   conversa: null | {pid, conv, nome} | 'time', ultima: pid|null}` + `rascunhos: Map`. `layout()` igual (lista 300, painel
   360, estreito com ← quando não cabe). Remover `talvezAbrirSozinha`, `desfazerAuto`, `FASES_ABRE_SOZINHA`,
   `conversaSozinha` e o `lembrarCoach` (decisão 5); `lerConversas` continua contando não lidas por conversa.
2. **Painel de chat** (novo `criarChatView` em `lateral-chat.js`): cabeçalho "chat" com ✕ do painel; **recentes** em cima
   (altura fixa ~1/3 do painel, `overflow:auto`), cada linha = foto (ícone do perfil do amigo casado por `pid` em
   `friends`, senão inicial), nome (`gameName` da conversa), trecho de `lastMessage.body` (1 linha, reticências; "você: "
   quando é dele), hora, selo de não lidas; ordem por `lastMessage.timestamp` decrescente; só `ehConversaDireta`. Na
   seleção, a 1ª linha é "🗨 sala do time" (com o selo de hoje). **Conversa** embaixo (~2/3) com cabeçalho (nome, status
   do amigo) e ✕ "fechar a conversa"; reaproveita `criarConversaView` (campo nasce uma vez; ARMADILHAS "Campo de texto ou
   botão recriado"). Sem conversa: recentes na altura toda e, se não há recentes, "nenhuma conversa recente" (texto final
   pelo guia). Recente sem `conv` não existe; amigo sem conversa abre vazia e o 1º envio cria (`enviarMensagem`, fallback
   404 de hoje).
3. **💬** (`botaoChat`): alterna o painel de chat (abre com `e.ultima`, se ainda existir; senão só recentes); título
   "chat (abre ao lado; outro clique fecha)". Bolha de não lidas como hoje. Com `chatLateral` desligado, segue a janela do
   coletor (sem mudança).
4. **Botão de amigos novo** (`botaoAmigos` em `chat-botao.js`, ao lado do 💬 em todas as telas que têm o 💬; ícone 👥,
   `data-a="amigos"`, destaque quando aberta como o 💬 hoje): alterna `e.lista`. Clique num amigo = abre o chat com a
   conversa dele (clique dele). "+ convidar" do lobby (`abrirConvidar`) passa a abrir a lista de amigos.
5. **Nada sozinho**: mensagem nova só muda contador, ordem e selo dos recentes; nunca `painel`, `conversa`, largura ou
   foco. Se ele está numa conversa e outra pessoa chama, ela sobe nos recentes (à vista em cima).
6. **"Lida"**: decisão 4; `marcarLida` no clique do recente e na interação na conversa; `conferirAtiva` como hoje
   (trocar de conversa, ✕, fechar o painel, partida, ⤢, oculto = `DELETE conversations/active`).
7. **Rascunho** (decisão 6): ao trocar de conversa, ✕ ou fechar o painel, guardar `input.value` em `rascunhos`; ao abrir,
   repor; envio ok apaga. Sala do time tem rascunho próprio (`'time'`).
8. **📊 coach** sai das abas: `alternarCoach` põe `painel='coach'` guardando o anterior; fechar (📊 de novo ou ✕) volta ao
   anterior (chat com a mesma conversa e rascunho, ou fechado). Fora da seleção o coach sai e volta o anterior.
9. **Config**: tirar `conversaSozinha` do padrão (`config.js:75`), do comentário (`:72-74`), do bloco "Client compacto"
   (`blocos.js:232-233`); valor salvo antigo some sozinho (`mesclar`, `config.js:90`, só copia chaves do padrão; o coletor não tem essa chave). Texto de
   `chatLateral` (`blocos.js:230`) passa a descrever chat e amigos ao lado.
10. **Documentação**: README linha 25 (o trecho do 💬 e o "mensagem nova abre a conversa sozinha"), ARMADILHAS § LCU
    (1:1 também trazem `password`/`mucJwtDto`; recentes vêm de `lastMessage`), passo novo no plano do compacto (feito
    junto deste plano).

**Critérios de aceite**
- 💬 abre o painel com recentes em cima e a última conversa aberta embaixo; ✕ da conversa deixa só os recentes; 💬 de novo
  fecha; 👥 abre/fecha a lista sem mexer no chat; as duas larguras pelo `est.lateral`.
- Mensagem nova em **toda fase** (None, Lobby, Matchmaking, ReadyCheck, ChampSelect, EndOfGame, PreEndOfGame) com o painel
  fechado, aberto noutra conversa, aberto sem conversa: `painel`, `conversa`, largura e `document.activeElement` iguais
  antes e depois; só contador, ordem e selo mudam.
- Rascunho sobrevive a trocar, ✕, fechar e reabrir; some no envio ok; nenhum `localStorage`/`sessionStorage`/coletor
  recebe o texto (o teste espia).
- Nenhum POST/PUT/DELETE sai sem evento `isTrusted` (evento falso do teste com `isTrusted:false` não escreve).
- `teste-textos.mjs` passa.

**Provas**
- `node tools/teste-compacto-lateral.mjs` reescrito para o estado novo: as sequências abre/fecha passam a combinar
  💬/👥/⚙/📊/✕ da conversa × 4 lugares do monitor; caso novo "não lida sobe em toda fase não muda nada" (com mutação:
  religar uma abertura sozinha numa cópia no scratchpad tem de ficar vermelho); caso "recentes ordenados por timestamp e sem
  `password`/`mucJwtDto`"; caso "rascunho"; caso "lida no clique do recente e DELETE ao sair de vista".
- `node tools/teste-compacto.mjs` (padrão sem `conversaSozinha`), `teste-compacto-lobby.mjs`, `teste-compacto-selecao.mjs`,
  `teste-compacto-fim-de-partida.mjs`, `teste-textos.mjs`, `teste-config.mjs` verdes.
- Prints no harness (`temp/compacto-harness`, servidor em 8831-8840, só com o jogo fechado; Playwright `browser_click`
  porque precisa de clique real): chat com conversa, chat só recentes, lista + chat, monitor estreito, seleção com a sala do
  time como 1ª linha.

## Etapa 2 — amigos: grupos, reordenar, menu do clique direito, arrastar para convidar

Arquivos: `compacto/lateral-chat.js` (`verAmigos`, `criarListaAmigos`), `compacto/lateral.js`, novo
`compacto/amigos-menu.js` (menu e diálogos), `compacto/index.js` (alvo do soltar na coluna), `tools/lcu-falsa.mjs`
(rotas de escrita novas), teste novo `tools/teste-compacto-amigos.mjs`, fixture inventada `tests/fixtures/social-amigos.json`
(formato medido acima, nomes "amigo N").

1. **Grupos como a Riot**: ler `/lol-chat/v1/friend-groups` junto dos `friends` (cada 3 s com a lista aberta, como hoje);
   grupos em `_groupSort` (prioridade decrescente, nome); amigos por `displayGroupId`; grupo desconhecido → Geral; rótulos
   "Geral" e os metas pelo nome da Riot (OFFLINE, MOBILE) no estilo do compacto. Contagem "online/total" por grupo. Dentro
   do grupo, a ordem de hoje (não lidas, status, nome). Hoje `verAmigos` põe "geral" primeiro e ordena por nome: é o defeito
   do "tropa no topo".
2. **Recolher**: clique no cabeçalho alterna e grava `PUT /lol-chat/v1/friend-groups/{id}` (objeto como lido,
   `collapsed` trocado); otimista, volta se falhar (aviso).
3. **Reordenar** (decisão 7): cabeçalho de grupo não meta `draggable`; marca de soltar entre não metas; soltar = `moveGroup`
   + `saveGroupOrder` do roster v2 (`priority = length − índice`, PUT só nos não meta que mudaram, objeto inteiro). Sem
   leitura dos grupos = sem arrasto (cinza com motivo). Função pura `novaOrdem(grupos, id, pos)` → lista de PUTs, testada.
4. **Menu do clique direito** (`contextmenu` na linha; Shift+F10/tecla Menu também): itens e ordem da tabela "Menu do
   clique direito", com os mesmos critérios de some/cinza (motivo no `title`):
   - Convidar para partida: decisão 8 (`lobbyParaConvite` de hoje + amigo livre + não membro + grupo não cheio).
   - Enviar mensagem: abre o chat nessa conversa (etapa 1).
   - Assistir partida: aparece com `lol.spectatorKey`; ao abrir o menu, `GET can-spectate` decide cinza/aceso (dica com o
     texto da Riot); clique = `POST /lol-spectator/v1/spectate/launch` com o corpo da tabela. Recusa da LCU = aviso com o
     status e "use o client normal". O launch abre o jogo como espectador: a fase do gameflow nesse caso **não foi medida**
     ([S]); o roteador expande se ela não for uma das conhecidas (regra 7 de hoje); medir na 1ª vez com ele.
   - Exibir perfil: etapa 3 (até lá, expandir e `rcp.whenReady('rcp-fe-lol-profiles')` → `showOverlay({summonerId, puuid})`
     [S], como as Configurações da Riot no passo 13).
   - Dar presente: [[DECISAO]] abaixo; até lá, fora do menu.
   - Adicionar/Editar anotação: campo na própria linha (Enter grava, Esc cancela), `PUT /lol-chat/v1/friends/{id}`
     `{...amigo, note}`; nota aparece no `title`/2ª linha como no roster.
   - Mover ›: submenu com os grupos não meta, atual cinza; `PUT /lol-chat/v1/friends/{id}` com o objeto inteiro e `groupId`.
     Some para amigo em meta (offline/celular), como a Riot.
   - Desfazer amizade/Bloquear: diálogo dentro da camada com o texto da Riot, 3 saídas (Desfazer amizade = `DELETE
     /lol-chat/v1/friends/{id}`; Bloquear = `POST /lol-chat/v1/blocked-players {summonerId, puuid}`; ✕ = nada) e a caixa
     "Também denunciar" quando a Riot mostra (`dmReportingEnabled` do client-config [S] e não denunciado).
   - Denunciar: só com mensagem recebida dele (`hasReceivedMessageFromMember`: alguma mensagem na conversa com `fromId`
     ≠ o dele e tipo ≠ system); diálogo da Riot com "também bloquear" marcado; `POST
     /lol-player-report-sender/v1/direct-message-reports {offenderPuuid}`.
   - Silenciar: fora (não está no roster v2).
   - Menu da pasta (clique direito no cabeçalho): criar, renomear, excluir com as rotas e a validação da Riot
     (`validateGroupName`); excluir pede a confirmação que a Riot usa (ler o handler `context_menu_delete_group` no social
     antes; se não houver confirmação lá, usar a de "Excluir pasta?" do guia).
5. **Arrastar para convidar**: linha de amigo `draggable` quando convidável; `dragover` na `.lc-cp-coluna` mostra a borda
   de soltar só se a decisão 8 permite; `drop` com `isTrusted` = mesmo convite do menu. Soltar fora disso não faz nada e
   avisa o motivo ("abra o lobby para convidar", "o grupo está cheio", "o líder não liberou convites", "amigo em partida").
   O arrasto nunca começa o arrasto da janela (`criarArrastoJanela` só no topo; conferir que `dragstart` na lista não sobe).
6. **Documentação**: README (amigos, grupos, menu, arrastar), ARMADILHAS § LCU com as rotas desta etapa marcadas "lido no
   front, não enviado ao client real" até a 1ª vez dele, e a pegadinha `displayGroupId` × `groupId`.

**Critérios de aceite**
- Com a fixture medida (Tropa 4, Geral 3, MOBILE 2, OFFLINE 1), a ordem é Tropa, Geral, Celular, Offline; arrastar Geral
  para cima manda exatamente `PUT …/0 {…priority:4}` e `PUT …/1 {…priority:3}`; metas nunca recebem PUT.
- Menu com os itens e estados da Riot para: amigo livre no lobby dele, amigo em partida (assistível e não), offline,
  celular, sem lobby, lobby cheio, não líder.
- Desfazer/Bloquear: cada saída manda só a sua rota; ✕ nada. Denunciar cinza sem mensagem recebida.
- Soltar na coluna: convite só em `Lobby` com lobby e permissão; senão aviso e zero escrita.
- Toda escrita só com `isTrusted`; `teste-textos.mjs` passa (textos da Riot como exceção nomeada).

**Provas**: `node tools/teste-compacto-amigos.mjs` (novo, LCU falsa registrando método/rota/corpo de cada escrita; mutações
em cópia no scratchpad: `100 − n`, PUT em meta, convite sem lobby, drop sem `isTrusted`, todas vermelhas),
`teste-compacto-lateral.mjs`, `teste-compacto-lobby.mjs`, `teste-textos.mjs`; prints no harness (grupos, menu aberto,
diálogo de bloquear, arrasto com a coluna marcada) com o jogo fechado.

## Etapa 3 — perfil: amigo (perfil, histórico, assistir), meu perfil (editor), fundo da coluna

Arquivos: novo `compacto/perfil.js` (perfil de amigo e editor), `compacto/lateral.js` (modo `perfil` no painel da direita;
editor no da esquerda), `compacto/tela-lobby.js` (clique na foto dele abre o editor), `compacto/index.js` (fundo da coluna),
`pengu/config.js`/`blocos.js` (chave `compacto.fundoPerfil`, padrão ligada), teste novo `tools/teste-compacto-perfil.mjs`.

1. **Perfil de amigo** (menu "Exibir perfil" e clique na foto na lista): painel da direita no modo `perfil` (decisão 2),
   ✕ volta ao anterior. Cabeçalho: faixa com o fundo de perfil dele (`backdrop`), ícone, Riot ID, nível, título e emblemas
   do `lol` da presença; ranque solo/flex (`ranked-stats/{puuid}`); maestria top 3 **só** se a POST da Riot for aceita como
   leitura (é POST: entra como "escrita por clique" ao abrir o perfil, ou fica fora; ver Riscos). Aba **histórico**: 20
   partidas (`…/products/lol/{puuid}/matches?begIndex=0&endIndex=19`): campeão, resultado, K/D/A, fila, duração, quando;
   clique abre o detalhe (`games/{gameId}`, os 10 com campeão e K/D/A; nome só o que a Riot mostra no histórico, por
   `textContent`). Ações do perfil = as do menu (convidar, mensagem, assistir).
2. **Replay de partida de amigo**: [[DECISAO]] abaixo. Recomendação: como a Riot (não oferece). Se ele escolher oferecer,
   reaproveitar `criarReplay` de `pengu/replay.js` com o `gameId`.
3. **Meu histórico**: já existe ("📊 última partida", pós-jogo). No editor, um atalho "histórico" que abre a mesma aba do
   perfil com o puuid dele.
4. **Editor do meu perfil** (clique na foto do topo do lobby; painel da esquerda, decisão 11): abas **Ícone** (grade dos 205
   do inventário, busca por id/nome do catálogo `summoner-icons.json`), **Molduras** (prestígio/ranque e o nível de
   prestígio, como `crestType`/`selectedPrestigeCrest`), **Bandeiras** (só "em branco" × "ranque da temporada passada";
   destaque de bandeira [S], fora enquanto a config da Riot não existir), **Emblemas** (até 3 desafios com nível, ordem de
   escolha), **Títulos** (85 dele, mais "nenhum" [S]). Prévia no topo. **Salvar** (decisão 9) manda só o que mudou:
   `PUT …/icon`, `PUT /lol-regalia/v2/current-summoner/regalia`, `POST /lol-challenges/v1/update-player-preferences` com o
   corpo exato de `_savePreferences`. Falha = aviso com status; nada de nova tentativa sozinha.
5. **Fundo da coluna**: `backdrop.backdropImage` dele como fundo de `.lc-cp-coluna` (`background-size:cover;
   background-position:center`: retrato corta os lados), por baixo de um véu escuro (gradiente) e com os painéis das
   telas translúcidos o bastante para o fundo aparecer. Só a coluna (lateral sem fundo). Lido no boot e a cada 10 min;
   imagem que falha = sem fundo. Chave `compacto.fundoPerfil` no bloco "Client compacto" ("Usa o fundo do seu perfil como
   fundo da janela compacta.").
   **Contraste medido**: ferramenta nova no harness (canvas) que, para cada bloco de texto das telas lobby, fila, seleção e
   pós-jogo, calcula o contraste WCAG entre a cor do texto e o percentil 95 da luminância do fundo já com o véu, sobre o
   fundo dele e 4 splashes claras (ex.: Lux, Janna, Seraphine, Soraka em skins claras). Aceite: ≥ 4,5:1 no texto normal e
   ≥ 3:1 no grande; o véu sobe até passar.
6. **Documentação**: README (perfil, editor, fundo e a chave), ARMADILHAS (maestria é POST; replay de terceiro escondido
   pela Riot; `backdropVideo` ignorado).

**Critérios de aceite**
- Perfil de amigo abre por clique, mostra dados e histórico com as rotas acima (só GET, mais a POST da maestria se
  aprovada) e fecha voltando ao chat como estava.
- Editor: escolher não escreve; salvar manda só as chamadas que mudaram, com os corpos da Riot (teste compara JSON).
- Fundo: coluna com o splash centrado e cortado nos lados; contraste medido passa; chave desligada = fundo de hoje.

**Provas**: `node tools/teste-compacto-perfil.mjs` (novo; LCU falsa; mutações: `title` numérico, `challengeIds` sem −1,
salvar tudo sempre, fundo com vídeo), `teste-compacto-lateral.mjs`, `teste-compacto-lobby.mjs`, `teste-textos.mjs`,
`teste-config.mjs`; ferramenta de contraste com o resultado no relatório; prints no harness com o jogo fechado.

## Riscos e rotas sem medição

- [S] **Toda escrita desta frente** (grupos, amigos, bloquear, denunciar, espectador, ícone, regalia, preferências) foi lida
  no front e nunca enviada: a 1ª prova é um clique dele de verdade. Cada aviso de falha diz o status e oferece o client
  normal; nenhuma nova tentativa sozinha.
- [S] fase do gameflow durante o espectador e se o launch é aceito com lobby aberto (o módulo velho da Riot exigia sem
  lobby; o roster v2 não). Fase desconhecida = o roteador expande (regra 7).
- [S] `dmReportingEnabled` (client-config) não medido: sem ele, "Denunciar" e "Também denunciar" somem, como na Riot.
- [S] maestria top 3 é POST: medir só com clique dele, ou deixar fora do perfil.
- [S] tirar o título ("nenhum"): a Riot não manda `title` quando `itemId` < 0; como ela limpa não foi lido.
- [S] destaque de bandeira (`bannerAccent`): config da Riot ausente aqui (404); aba Bandeiras fica só no tipo.
- [S] `showOverlay` do perfil da Riot (`rcp.whenReady('rcp-fe-lol-profiles')`) pelo plugin, até a etapa 3.
- HTML5 DnD no CEF 108 dentro da camada: a Riot usa o mesmo mecanismo no roster; conferir no harness que o `drop` chega
  com `isTrusted` e que o arrasto não move a janela.
- Fundo e contraste: splash muito clara pode exigir véu tão escuro que o fundo quase some; o número sai da medição.
- Etapa 1 reescreve o coração do `teste-compacto-lateral.mjs` (abas): fazer o estado novo e o teste no mesmo commit, com as
  sequências de geometria intactas.

## Fica de fora (e por quê)

| o quê | por quê |
| --- | --- |
| abrir conversa sozinha (qualquer fase) | pedido dele de 16/10 (substitui a decisão 1 do passo 13) |
| silenciar amigo | não está no menu do roster v2 da Riot (só no módulo velho) |
| convidar pelo Discord / pela Riot | itens da Riot que só aparecem para amigo de outro jogo ou Discord; os amigos dele medidos são LoL |
| criar lobby a partir da coluna de amigos | "o jogo sempre tem que estar no lobby para convidar" |
| trocar o fundo de perfil | não pedido (só usar o fundo como fundo da janela); rota lida, fica para quando ele pedir |
| Bandeira do Clash (`/lol-banners`) | ele tem 0 bandeiras |
| vídeo do fundo | custo de CPU (decisão 10) |
| pedidos de amizade dentro do compacto | fora no passo 13 e não pedido de novo (abre o client normal) |
| ler memória do jogo, automatizar tecla ou clique, nome oculto | fronteira do projeto |

## [[DECISAO]] — só o Gabriel

- [[DECISAO]] replay de partida de amigo: a Riot **não oferece** baixar/assistir replay no histórico de outro jogador
  (lista `ThirdPersonAccessibleGameQueues` ausente nesta região), a rota por `gameId` existe mas nunca foi usada assim |
  opções: igual à Riot (não oferecer) / oferecer mesmo assim (risco de recusa do servidor e de ir além do que a Riot
  permite) | recomendo: igual à Riot; "Assistir partida" ao vivo (espectador) fica | dono: gabriel
- [[DECISAO]] "Dar presente" no menu do amigo: a Riot abre a loja (gasta RP); a régua do projeto proíbe rota que gasta |
  opções: fora do menu / item que expande para o client normal na loja de presentes (nada comprado pelo plugin) | recomendo:
  item que expande | dono: gabriel
- [[DECISAO]] coach 📊 voltando sozinho na seleção seguinte (hoje volta se ele deixou aberto) | opções: nunca volta sozinho /
  volta só com o painel fechado e sem mudar a largura | recomendo: nunca (decisão 5; mesmo espírito do "nada sozinho") |
  dono: gabriel

## O que o pedido não dizia

- Grupos recolhem e as pastas se criam/renomeiam/excluem: "da mesma maneira que no expandido" inclui isso; rotas da Riot.
- Anotação e denúncia de mensagem entram porque estão no menu da Riot ("as mesmas opções").
- Rascunho guardado por conversa (pedido do orquestrador): sem ele, o ✕ e a troca de conversa apagariam o que ele digitou.
- Contraste medido do fundo: sem número, o fundo bonito some com o texto em skin clara.
- Ordem das metas fixa no fim (decisão 7): evita prioridade repetida que a Riot permite por acidente.
