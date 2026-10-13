# Armadilhas — lol-client

Sintoma → causa → o que fazer. Datas = quando foi medido.

## Client e Pengu

- **Plugin não aparece depois de editar** → o client só lê o plugin no carregamento da
  interface. Recarregar com `window.restartClient()` ou `POST /riotclient/kill-and-restart-ux`,
  **só em fase `None`/`Lobby`** (`GET /lol-gameflow/v1/gameflow-phase`). O login e o lobby
  sobrevivem ao recarregamento (testado 13/10/2026).
- **Porta 8888 não responde** → `RemoteDebuggingPort=8888` vive em
  `C:\Program Files\Pengu Loader\config` (adicionada 13/10/2026; backup do original em
  `%TEMP%\pengu-config.bak`). Só vale depois de recarregar a interface.
- **`cdp.mjs` mira na página errada** → com o DevTools do client aberto, ele também é `type: "page"` e
  pode vir primeiro na `/json/list`; o `eval` roda no DevTools. Mirar na página cuja url tem `/index.html`
  e não começa com `devtools://` (corrigido 13/10/2026). A url da página traz a credencial: nunca logar.
- **Botão Confirmar do Modo de Treino não clica** → a altura fixa da coluna larga (360 px, `z-index: 2`)
  valia para todo cartão selecionado; o do Treino não tem lista de filas e a caixa vazia cobria o botão.
  A regra só vale com `:has(.parties-game-type-card-categories)` (13/10/2026). Trocar o CSS ao vivo: o
  Pengu injeta o `estilo.css` como `<link>`; trocar por `<style>` com o texto novo.
- **Clique por coordenada erra o alvo** → a janela tem `devicePixelRatio` 1,25; print em
  1600×900, CSS em 1280×720. Coordenada do print ÷ 1,25.
- **`el.click()` em botão do Ember não faz nada** → alguns componentes do uikit só reagem a
  evento de mouse real. Usar `node tools/cdp.mjs click <x> <y>` (Input.dispatchMouseEvent).
- **Seletores medidos em 13/10/2026 (patch 16.20)**: `menu_item_navbar_tft`,
  `.game-type-card`, `.parties-game-type-icon.map-22`, `.parties-game-type-lower-half`,
  `.play-button-component`, `.navbar_backdrop` (âncora do botão fila rápida),
  `.left-nav-menu`, `menu_item_navbar_demacia` (CLASSIC), `menu_item_event_hub_generic_nav_name`,
  `menu_item_navbar_store`, `.lol-settings-container`, `.lol-settings-navs`,
  `.lol-settings-nav-scroller`, `.lol-settings-options`, `.lol-settings-title`,
  `.app-controls-settings` (engrenagem, ≈1226,15 px CSS). Patch novo pode renomear; conferir aqui primeiro.
- **Plugin carrega mas `init` morre calado** (`dataset.lolClient` vazio, sem `__lolClient`) →
  o Pengu chama `init()` **antes do `<body>` existir** (`await i.init(...)` no preInit);
  `document.body` é `null` ali. DOM só depois do `DOMContentLoaded` (ver `fila-rapida.js`);
  `index.js` isola cada módulo em try/catch. Diagnóstico: `import()` do plugin + `init` com
  contexto falso via `cdp.mjs eval` mostra o erro (13/10/2026).
- **CSS do plugin** → `import './estilo.css'` funciona: o Pengu troca por um módulo que põe
  `<link rel=stylesheet href=https://plugins/lol-client/estilo.css>` no body. Arquivos do
  plugin são servidos em `https://plugins/lol-client/...` (`?raw`, `?url`, `.json` também).
- **`context.socket.observe(uri, cb)`** → `cb` recebe o evento WAMP `{data, eventType, uri}`;
  em `Delete`, `data` vem `null`.
- **Clique cego em (445,685) pode buscar partida** → é o "<" da tela de modos, mas na tela do
  lobby o mesmo ponto é o `.find-match-button-container` (ENCONTRAR PARTIDA). Antes de clicar,
  conferir o alvo com `document.elementFromPoint(x, y)` (o "<" está em `.confirm-button-container`).
- **Clique na seta (37,108) ou no GRUPO não faz nada** → a dica "SEU GRUPO ESTÁ ABERTO"
  (`.parties-first-experience-tooltip`) às vezes muda de lugar e cobre o canto de cima à
  esquerda. Fecha no `lol-uikit-close-button` dela (≈255,14 px CSS quando está ali).
- **Janela do ready-check = 12 s** (medida em 13/10/2026 pelo gravador, 3 ready-checks reais da
  partida de medição: o plugin aceitou com `timer` 10,0 em 3/3; a janela inteira, de 0,0 a 12,0, foi
  vista em 1, quando um terceiro não aceitou e a fase voltou a `Matchmaking` ~13,1 s após o início).
  `timer` só tem inteiros (1 s de resolução) e `state` fica `InProgress` mesmo com a recusa de
  terceiro: a recusa só aparece pela fase. Depois de um dodge de terceiro no champ select, o
  ready-check seguinte chega ~1,5 s após sair do `ChampSelect`. O aceite usa `limiteS: 12`
  (constante do `PADRAO` em `config.js`; o valor salvo no DataStore é ignorado) e aceita em
  `min(atrasoS, limiteS − 2)` pelo `timer` do payload.
- **Seção "lol-client" nas Configurações some, duplica ou volta errada** (medido 13/10/2026,
  `pengu/configuracoes.js`):
  - o modal (`.lol-settings-container`, dentro de `#lol-uikit-layer-manager`) **não é destruído
    ao fechar**: o client desanexa e reanexa o MESMO DOM; ao reabrir, o Ember volta sozinho para
    GERAL. Guardar o elemento, não depender de `getElementById` (nó desanexado não aparece);
  - navegação: `.lol-settings-nav-scroller > div` com pares `.lol-settings-nav-title` +
    `lol-uikit-navigation-bar` (o `selectedindex` de cada barra é do Ember, que mapeia índice →
    seção pelo `name` do item). Item novo vai numa **barra própria**, nunca dentro de uma nativa,
    e o `selectedindex` nativo não se toca: só o atributo `active` dos itens (restaurar índice
    salvo briga com o reset do Ember e deixa duas seções marcadas);
  - conteúdo: `.lol-settings-options > lol-uikit-scrollable`; clicar de volta na mesma seção
    nativa não re-renderiza nada, então o conteúdo nativo fica no lugar e só se esconde;
  - o título (`.lol-settings-title`) é texto do Ember: trocar o `textContent` quebra o vínculo;
    esconder os spans nativos e pôr os próprios ao lado.
- **`lol-uikit-flat-checkbox` não acompanha `input.checked = x`** → a classe `checked` só muda no
  evento `change` (clique real ou `input.click()`); re-renderizar ou pôr a classe junto.
- **Opção de `lol-uikit-framed-dropdown` fora de vista** → a lista abre rolada até o item marcado;
  as de cima ficam escondidas e um clique por coordenada cai em outro elemento. Conferir com
  `elementFromPoint` antes; a escolha dispara `click` com alvo `lol-uikit-dropdown-option`.
- **Selo do winrate não aparece com o campeão em hover** → na vez do jogador o hover vive na ação
  (`actions[][].championId` do pick com `actorCellId` = `localPlayerCellId`), não em
  `myTeam[].championId` (0 até travar); `championPickIntent` também vem preenchido. Ler os três (13/10/2026).
- **Personalizada sozinho inicia a partida mesmo "cancelada"** (13/10/2026, aconteceu: partida
  3292748018, 3 min) → `POST /lol-lobby/v1/lobby/custom/cancel-champ-select` devolve 204 e
  **não cancela** (o lobby some, a fase lida vira `None`, a seleção segue e o timer de 90 s
  inicia o jogo com o campeão em hover). E o client **põe hover sozinho** no campeão
  (Renekton) na seleção às cegas: sem hover nosso, o timer também inicia. Saída comprovada:
  a do botão SAIR, `POST /lol-lobby-team-builder/champ-select/v1/session/quit` → `Lobby` com o
  lobby intacto. Teste: rede de segurança na página (`setTimeout` com o quit) e conferir a
  fase depois. Saída de jogo já iniciado: `POST /lol-gameflow/v1/early-exit` dá 403 fora de
  `InProgress`/`Reconnect`.
- **Criar personalizada dá 500 `INVALID_LOBBY`** → `mutators: {id: 1}` não vale mais: o id é a
  fila personalizada (`GET /lol-game-queues/v1/custom`; 3100 = SR às cegas) e o corpo precisa
  de `queueId: 3100` no topo, junto de `customGameLobby` e `isCustom: true`. Iniciar a seleção:
  `POST /lol-lobby/v1/lobby/custom/start-champ-select` (13/10/2026).
- **Campeão duplicado na busca** → `champion-summary.json` traz variantes de modo com o mesmo nome
  (60103 = `Jade_Ahri`); filtrar `id < 10000` (13/10/2026). Vale para a tabela `campeoes` do banco: 77
  nomes têm a variante 60xxx e um mapa nome→id sem o filtro pega ela (Lee Sin → 60064, sem participante:
  a revisão do jungler sumia calada; `coach_vivo.revisar`, revisão de 13/10/2026).
- **Painel pós-jogo cobre o ready-check** → `#lc-posjogo` é tela cheia (z-index 100001) e o
  modal do client fica embaixo. Ele fecha sozinho em `ReadyCheck`/`ChampSelect`/`GameStart`/`InProgress`
  e o `#lc-aceite` fica acima (100002); tela nova por cima do client precisa do mesmo cuidado.
  O popup de runas (`#lc-runas`) não tem fundo bloqueante (só a caixa recebe clique: troca, feitiços
  e chat seguem usáveis), fecha com Esc e quando a fase sai de `ChampSelect` (Delete da sessão pode se perder).
- **Selo do winrate preso em "sem partidas"** → erro HTTP do histórico (404/5xx no boot) marcava a
  leitura como feita. Hoje só resposta com `games.games` conta; erro vira "histórico indisponível" e o
  selo relê no máximo a cada 15 s (13/10/2026, achado de revisão).
- **Pós-jogo leva ~1 min para abrir** (13/10/2026: 52–54 s) → esperava a leitura de 200 partidas do histórico
  (15–40 s, às vezes mais) e, provável (não isolado), a LCU atende o match-history em fila: o `games/{id}`
  pedido junto ficava atrás dela. Hoje busca partida e linha do tempo primeiro, dá ao histórico 1,5 s (com cache) ou 8 s (sem), abre e
  repinta Tendência e Sessão quando a leitura chega (`posjogo/index.js`).
- **3ª lição diferente no client e no coletor para a mesma partida** (13/10/2026, 3292746609: `atras-10` x
  `farm-acima`) → o cache do client tinha 20 partidas e a média de farm ficou sem amostra (n=2). Com o
  coletor de pé, o pós-jogo mostra as lições do `GET /licoes/<gameId>` (banco inteiro) e a média de farm dele.
- **Configurações pulam ~50 px a cada clique numa caixa** (lá embaixo na seção) → a remontagem desanexa o
  input focado e o `lol-uikit-scrollable` rola depois; `montar()` reaplica o `scrollTop` no quadro seguinte.
- **Lição com texto diferente no JS e no Python** → `%` e `//` de negativo diferem (`-1 % 60` = 59 no
  Python, −1 no JS) e `round` do Python é bancário: os motores de lições formatam sobre o valor
  absoluto e arredondam com `floor(v + 0,5)`. O cruzado de `tools/teste-licoes.mjs` pega (13/10/2026).

## LCU API

- **`/help` não tem URL** → `GET /help?format=Full` lista funções por nome
  (`PutLolLobbyV2LobbyMembersLocalMemberPositionPreferences` = `PUT /lol-lobby/v2/lobby/members/localMember/position-preferences`).
- **`GET /lol-matchmaking/v1/ready-check` dá 404** fora da fila ("Not attached to a matchmaking queue"): é o normal.
- **`GET /lol-lobby/v2/lobby` sem lobby dá 404** (medido 13/10/2026): a fila rápida trata 404 como
  "sem lobby" e recusa qualquer outro erro (falha fechada, para não substituir um grupo que não leu).
- **Timeline sem wards nem compras** → a versão da LCU só traz `CHAMPION_KILL`,
  `ELITE_MONSTER_KILL`, `BUILDING_KILL` e 1 frame por minuto. Hora de compra de item só pela
  match-v5 da Riot API (`ITEM_PURCHASED`).
- **Histórico com 20 ou 200 partidas, sem paginar** → `.../current-summoner/matches` ignora
  `begIndex`/`endIndex` e devolve o que o client tem em cache: às vezes as 20 mais recentes,
  às vezes 200 (04:50 de 13/10/2026: 200, até 23/04/2026; minutos depois, 20 de novo). A
  chamada que traz 200 pode levar 15–40 s: timeout ≥ 90 s. O coletor grava o que vier e o
  banco acumula; não iterar índices.
- **Recarregar a interface cria um `LeagueClientUx.exe` novo** → cada recarga gera um 4688 e
  dispara a tarefa `lol-client-coletor`; inofensivo (`IgnoreNew` + trava em `dados/coletor.lock`).
  A LCU (porta do lockfile) segue de pé; o websocket pode cair e o coletor reconecta.
- **Posição da partida na lista do histórico** → `timeline.lane/role` não serve; use
  `stats.roleBoundItem` (item da missão de função): mapa em [INSIGHTS.md](INSIGHTS.md) § Winrate (13/10/2026).
- **`GET /lol-perks/v1/currentpage` dá 404 "Perk Page not found."** fora do champ select quando
  nenhuma página está marcada como atual (13/10/2026): é estado, não erro. `PUT` do mesmo
  endpoint leva o **id puro** no corpo (`1540029809`, int32), não `{id}`; funciona no champ select.
- **`timeline.lane/role` errado** (top vindo `JUNGLE/NONE`, partida inteira `NONE/SUPPORT`)
  → não usar; papel pela posição: [INSIGHTS.md](INSIGHTS.md).
- **Time de quem pegou o objetivo** → `BUILDING_KILL.teamId` é o **dono** do prédio
  destruído; `ELITE_MONSTER_KILL.teamId` vem sempre 0 (usar o time do `killerId`). Detalhe em
  [INSIGHTS.md](INSIGHTS.md) § Mortes.
- **Tipo `LolChampSelectChampSelectSession` não existe no `/help`** → o champ select é do
  TeamBuilder: `TeamBuilderDirect-ChampSelectSession`, `-ChampSelectPlayerSelection`
  (tem `isAutofilled`), `-ChampSelectAction` (13/10/2026).
- **Sessão do champ select carrega segredo** → `chatDetails` traz `multiUserChatPassword` e
  `mucJwtDto.jwt` da sala; `myTeam[]` traz puuid e Riot ID. Nada disso vai para disco:
  `coletor.limpar_sessao()` (coletor e gravador).
- **Nome de terceiro em gravação** → a Live Client (`allPlayers[].riotId`, `summonerName`; eventos
  com `KillerName`/`VictimName`/`Assisters`) traz o Riot ID dos 10: o gravador troca pelo campeão
  (`coletor.limpar_live`). `partida-{id}.json` (gravador), `partidas.json` e `eog` (banco) seguem
  brutos, só em `temp/`/`dados/`: fixture para `tests/` (versionado) sai sem identidade de terceiros.
- **`Update` da sessão do champ select depois da mudança de fase** (13/10/2026, achado de revisão):
  sem memória da chave fechada, ele reabria a seleção e, em `FINALIZATION`, regravava o retrato
  final com `ts` errado, `seg_ate_travar` null e sem `desfeita`. `RetratoChampSelect.fechadas` ignora.
- **Runa do campeão errado depois de trocar de campeão (trade)** → na troca, `myTeam[].championId`
  muda e a ação de pick travada fica com o id antigo (comportamento conhecido, ainda não medido aqui):
  o gatilho das runas lê `myTeam` primeiro e trata de novo a cada campeão diferente (13/10/2026).
- **`actions` vem como lista de listas** (um turno por lista; o `/help` diz `vector<object>`):
  achatar antes de procurar o pick travado. `bans.myTeamBans`/`theirTeamBans` vêm vazios
  (`numBans` 0) a seleção inteira: o retrato usa as ações `ban` completas e cai no resumo só sem
  elas. **Confirmado** na partida real de 13/10/2026 (normal, fila 400): 8 turnos = 10 bans
  simultâneos, 1 ação `ten_bans_reveal` (tipo próprio, `actorCellId` -1, id 100/101: os bans
  inimigos aparecem todos juntos) e os picks 1-2-2-2-2-1. Ban repetido entre times é normal.
- **Ban não feito entra como campeão -1** → a ação `ban` fecha `completed=true` com `championId`
  -1 (e -1 também em `partida.teams[].bans`); filtro truthy deixa o -1 passar. Usar `championId > 0`
  (`coletor.py`, corrigido em 13/10/2026 com a fixture `champselect-real.json`).
- **Normal draft (fila 400) sem posição nem feitiço do inimigo** → `theirTeam[].assignedPosition`
  vem "", `isAutofilled` false e `spell1Id`/`spell2Id` 0 até o `GAME_STARTING`: rota e smite
  inimigos não existem no champ select (só no carregamento, pela Live Client). O campeão inimigo
  aparece no `Update` em que a ação de pick dele fica `completed`; o hover dele vaza em
  `championPickIntent`/ação `isInProgress` só no turno dele, 0,5–2,2 s antes (a conferir se a tela
  mostra; ler só a ação completa evita flicker) (13/10/2026).
- **`pickOrderSwap` entre aliados muda o dono do `cellId`** → `assignedPosition`,
  `championPickIntent` e a ação de pick passam de um cell para outro (3 → 1, 13/10/2026). Estado
  guardado por `cellId` entre `Update`s pode trocar de jogador; reler `localPlayerCellId` a cada sessão.
- **Gravação não diz se o champ select da normal é anônimo** → o gravador passa a sessão por
  `limpar_sessao()`, que apaga `nameVisibilityType` junto com a identidade. Para responder, gravar
  só sinais (`bool(valor)` e o enum) antes de limpar.
- **Seleção desfeita por dodge de terceiro não vira linha** no `champ_select` (por design,
  conferido em dado real em 13/10/2026): "fui dodged" é dado perdido hoje.
- **Tabela `eog` grava a mesma partida 3 vezes** em ~100 ms (eventos `Update` entre
  `WaitingForStats` e `PreEndOfGame`, `coletor.py` no handler do eog), sem dedupe e com
  `experienceEarned`/`teams` diferentes: ler a de maior id (13/10/2026).
- **`champ_select.runa_nome` com emoji** (a página do Gabriel se chama 🤢) → print do banco no
  console cp1252 morre com `UnicodeEncodeError`: `PYTHONIOENCODING=utf-8` ou `errors='replace'`.
- **Chat do jogo não passa pela LCU** → `/lol-chat/v1/conversations` (sem as privadas) ficou `[]`
  a partida inteira de 13/10/2026 com ~160 linhas de chat na tela: só dá para ler por tela (OCR).
- **Timeout de leitura da LCU não vira `URLError`** → sai `TimeoutError` cru do `getresponse`
  (e `ConnectionResetError`, `JSONDecodeError` com corpo cortado). Quem só pega `HTTPError` morre
  no 1º engasgo; o `Gravador.get()` pega tudo e conta `erro_lcu`.
- **Sequência de derrotas zerando à meia-noite** → `sessao_hoje()` lia só desde 00:00 e o `_tilt()`
  encadeia por pausa < 2 h: na faixa 00–06h (a pior) o alerta de 3+ derrotas não disparava. Hoje a
  sessão em andamento atravessa a meia-noite (`servidor._sessao`).

## Live Client Data API (`127.0.0.1:2999`, medido na partida 3292746609, 13/10/2026)

Medição completa: [MEDICAO-2026-10-13.md](MEDICAO-2026-10-13.md) § 1.

- **Recusa a conexão fora da partida, mas responde 200 na tela de carregamento** → ~7 s depois de
  `InProgress` já vem `allPlayers` completo (campeão, time, rota, feitiços, keystone), com
  `gameData.gameTime` parado em ~0,025 e `events` vazio por ~99 s. Quem usa "resposta ok" ou
  "`gameTime` > 0" como início do jogo trata o carregamento como o segundo 0. Início real: evento
  `GameStart` em `events` (ou `gameTime` > ~0,1). Fora da partida, o gravador conta "sem partida".
- **`GameStart` do gameflow dura ~50 ms** → o polling perde a fase e o `fases.jsonl` pula de
  `ChampSelect` para `InProgress`; só o websocket do coletor vê. O carregamento corre em `InProgress`.
- **`creepScore` do inimigo não sobe na fog e nunca recupera** → jungler inimigo com 100 de cs no fim
  contra 266 reais. O client só conta o abate de tropa/monstro que o teu time vê. Nível e itens
  também congelam na fog, mas sincronizam ao reaparecer (Ekko pulou de nível 1/[] para 4 com 2
  itens em 244,9 s). KDA, `isDead` e `respawnTimer` são globais. Exceção não explicada: item de
  suporte inimigo (3865) visível em gt 0,8; não generalizar sem 2ª partida.
- **Item de inimigo atrasa** → aparece mediana 25 s (p90 69 s, máx. 322 s) depois da compra
  (match-v5), contra 0,5 s de aliado: "tem bota jônica" pode estar velho.
- **`creepScore` anda em degraus de 10** para todos, inclusive o jogador ativo (cs 0 com 9 reais,
  20 com 28): não serve para cs/min fino.
- **Não existe posição x/y** em lugar nenhum: `allPlayers[].position` é a rota declarada
  (TOP/JUNGLE/...). Posição só na timeline (1/min) ou no minimapa.
- **Sem cooldown de feitiço** → `summonerSpells` traz só nomes localizados (sem id nem recarga);
  `activePlayer` nem tem `summonerSpells` nem `scores` (placar próprio está em `allPlayers`). O nome
  do Smite muda com o upgrade (Golpear → Golpe Irrestrito → Golpe Primordial): aceitar os 3.
- **Runas dos outros incompletas** → `allPlayers[].runes` traz só keystone e as 2 árvores;
  `fullRunes` existe só para o `activePlayer`. A página inteira dos 10 vem do spectator-v5 (`perkIds`).
- **Objetivos**: chegam mesmo feitos pelo inimigo na fog, em ≤ 1 s, com `KillerName` (localização
  exata do jungler naquele instante). `Stolen` é string `"True"`/`"False"`. `Assisters` de
  dragão/barão mistura os dois times: não usar como "time que participou". Só `DragonKill` traz
  `DragonType`.
- **`TurretKilled` com tropa de `KillerName`** (`Minion_T100L1S34N0211`) → não está no mapa
  nome→campeão; o time sai do `T100`/`T200` da tropa ou do `TChaos`/`TOrder` do nome da torre (a
  torre é do time que PERDEU).
- **Alma do dragão não vem pronta** → `gameData.mapTerrain` ficou "Default" a partida inteira, mesmo
  depois do 3º dragão. Contar `DragonKill` por time; elemento = `DragonType` do 3º em diante.
- **Lista de eventos inteira em toda amostra** (acumulativa; `EventID` contíguo): deduplicar por
  `EventID`. Amostra de 16–47 KB (mediana 33 KB, 69 MB por 33 min): não guardar o bruto no banco.
- **`items[].price` é o custo da receita, não o do item** (Sinal de Sterak 775 contra 3200): valor e
  "lendário" saem do `priceTotal` do `items.json` da LCU (`sugestoes.montar_estatico`, 13/10/2026).
- **`rawChampionName` não tem padrão único** (`game_character_displayname_Illaoi`, mas a Seraphine vem
  `Character_Seraphine_Name`): casar o campeão pelo `championName` (pt-BR) com o `champion-summary.json`.
- **Ordem de `allPlayers` muda ao sair do carregamento** (Zac 1º nas 99 amostras do carregamento, 2º
  no jogo): estado guardado por índice troca de jogador; chavear pelo nome (`ao_vivo.py`, 13/10/2026).
- **Dado do inimigo "atual" na 1ª leitura do meio da partida** (coletor reiniciado): não dá para saber
  desde quando está parado; o `ao_vivo.py` marca `vistoHaS` nulo até a 1ª mudança ou abate dele.
- **Rajada de avisos com o coletor reiniciado no meio da partida** → o `GatilhosLive` nasce sem memória
  e na 1ª leitura acha `inimigo_fed`, `janela_objetivo` e `mortes_cedo` de uma vez. O motor segura (1 fala a
  cada 20 s, o resto cai pela `validade`), então sai 1 fala velha, não 3; não é bug, é o custo de reiniciar.

## Tela, minimapa e chat (prints do gravador, 13/10/2026)

Medição completa: [MEDICAO-2026-10-13.md](MEDICAO-2026-10-13.md) § 3 e § 4.

- **`lado_estimado` 382 do `calibracao.json` é a moldura, não o mapa** → a moldura dourada mede
  ~381×382 em (2179, 698); o mapa (quadrado preto dos ícones) mede **347 px em (2197, 716)** em
  2560×1080 com `MinimapScale` 2,46. Converter mundo→pixel com 382 erra ~10%: [COLETOR](COLETOR.md) § Minimapa.
- **Print pega o monitor, não a janela do jogo** → quando o Gabriel troca de janela (morto,
  carregando), `telas/`, `minimapa/` e `chat/` gravam o navegador ou a área de trabalho: 22 de 202
  recortes (11%) e 6 de 35 telas, com conteúdo pessoal. Filtrar por janela em primeiro plano
  (`GetForegroundWindow`, título "League of Legends (TM) Client"), pela faixa (16,28,27) em volta do
  mapa ou pelo tamanho do PNG (< ~300 KB contra ~3,7 MB).
- **Prints do carregamento sobrescrevem um ao outro** → o nome é o `gameTime`, parado em ~0,025:
  `00000.0.png` é regravado e só a última captura sobrevive.
- **Minimapa ignora a skin** → mostra o ícone **base** do campeão; o círculo da skin
  (CommunityDragon) não casa (Zac com skin 2: 0/30). Usar `champion-icons/{id}.png` da LCU.
- **Ícone inimigo é desenhado por cima do aliado** → em luta o aliado some do template matching.
- **Yuumi presa** troca o ícone do hospedeiro por um anel azul maior; nem template quadrado nem
  circular acham o hospedeiro (Nilah 2/26). A Live Client não diz em quem ela está. Achando o anel
  pela cor e o rosto só no miolo (sem o anel), o hospedeiro sai (`minimapa.py`, 7/8 nas fixtures).
  **O anel grosso também é o de "voltando à base"** (com seta): no recorte 442 a Nilah voltava sozinha
  e a Yuumi estava na fonte 20 s antes; a `Captura` descarta Yuumi deduzida onde ela não teria como
  chegar (450 unidades/s desde a última vez vista).
- **`matchTemplate` com máscara é lento** → ~1 ms por chamada pequena e ~50 ms no mapa inteiro por
  campeão (10 campeões = 500 ms por quadro). Achar os anéis por cor em meia resolução e comparar o
  rosto à mão em numpy só nos candidatos: ~7–9 ms por quadro (13/10/2026).
- **Contorno preto de ícone vira parede** na grade de caminhável (torre, inibidor têm traço de 1–2 px):
  abrir a máscara de parede com 3×3 antes de preencher buracos (`minimapa.caminhavel`).
- **Gabarito pela timeline não certifica ≤ 600** → 1 posição por minuto e recorte ~2 s depois: até
  ~900 unidades de diferença com a detecção certa (teto ~82%).
- **Recorte do chat por proporção erra** → nesta HUD (2560×1080) o chat fica acima da barra de
  habilidades, x ≈ 1400–1800, y ≈ 830–975, não no canto inferior esquerdo: 670 prints de `chat/`
  sem nenhuma linha. A posição do chat é da HUD (movível) e não está no `game.cfg`.
- **Ping de feitiço no chat pt-BR não é "Campeão - Flash"** → é `mm:ss <aliado> (<campeão>):
  <inimigo> usou <feitiço>` ou `<inimigo> <feitiço>` (sem "usou"); "usou" = gasto, sem horário de
  volta, e aliados repetem. "X - Vivo(a)", "Espere por R - 2s", "usou R - <ult>" e
  "<item> - Precisa de N de ouro" são outros pings.
- **Nome da runa**: 8347 = **Perspicácia Cósmica** (+18 de aceleração de feitiço de invocador), não
  "Visão Cósmica". Bota 3158 dá +10 e 3171 (Lucidez Escarlate) +20.
- **Linha mais velha do chat sai cortada no topo** → o OCR lê `0/:06` e `Hash`/`1-lash` no lugar de
  `07:06` e Flash: `/` vira 7 e o feitiço casa por semelhança com o dicionário fechado
  (`feiticos._ts_norm`/`ler_ping`, 13/10/2026). Ping sem "usou" (`Seraphine Exaustão`) não diz que
  gastou: não liga cronômetro.
- **Painel pós-jogo não deixa rastro de sucesso** → `fechar()` remove `#lc-posjogo` sem log; depois
  que o Gabriel fecha, não dá para provar de fora que abriu sozinho (13/10/2026).
- **Overlay próprio aparece no print do minimapa** → o `mss` (BitBlt com `CAPTUREBLT`) captura
  janelas layered; a borda de 12 px da moldura (15c) cai em cima da faixa (16,28,27) que o minimapa
  usa para se achar (16/17 px). Janela de overlay nasce com `SetWindowDisplayAffinity(hwnd,
  WDA_EXCLUDEFROMCAPTURE=0x11)`: segue na tela e some do print (medido 13/10/2026, `teste-alertas.py`).
  Vale para o overlay do minimapa (15b) também (`overlay_minimapa.py --demo`: área quente 100% no
  print sem a exclusão, 0% com ela).
- **Overlay "não aparece" no canto do minimapa da área de trabalho** → um `Windows.UI.Core.CoreWindow`
  sempre-no-topo (painel do sistema) cobria (2197, 716) em 13/10/2026: até uma janela branca opaca
  saía (50, 50, 50) no print. Testar o desenho em outro ponto (`--demo --left 1000 --top 300`).
- **`--demo` do overlay dá `FALHOU` num ponto e `ok` no outro** → "px fora da área que mudaram" mede a tela
  **atrás** da janela; um terminal ou vídeo animando ali passa dos 5% (11% em (300, 300), 13/10/2026). Rodar
  de novo com a área livre antes de mexer no overlay.
- **LCU não tem atributo de campeão** → `/lol-game-data/assets/v1/champions/{id}.json` não traz
  velocidade (só `tacticalInfo`, magias, skins). Velocidade base sai do Data Dragon (`champion.json`
  da versão do client, 16.20.1 em 13/10/2026; Zac 340 = `moveSpeed` da Live Client), em cache em `dados/`.
- **Mapa muda depois do 2º dragão, não com a alma** (wiki "Elemental drake", 13/10/2026); o elemento
  é o do 3º, que só aparece no `DragonType` quando ele morre.

## Windows

- **Print com `mss`**: a versão 10 já devolve px físicos (monitor do jogo 2560×1080 com escala
  125%) e `mss.mss()` virou `mss.MSS()` (o antigo só avisa). Conferido 13/10/2026.
- **`sct.monitors[1]` não é o monitor principal** → aqui é a 2ª tela (1920×1200 em (2560, 595)); o do
  jogo é o `[2]`. O OCR do chat usava o `[1]` e lia painel, navegador e conversas. Escolher pelo
  `minimapa.monitor_do_jogo` (resolução do `game.cfg`, senão `is_primary`) (revisão de 13/10/2026).
- **`RegisterHotKey` come a tecla** → a janela em foco não recebe a tecla registrada. Só o F9 fica
  registrado; 1..5 (teclas de item do jogo) só nos 2 s depois do F9 (`feiticos.Atalhos`). Registro
  medido em 13/10/2026; com o jogo aberto ainda não (se o F9 já for atalho do jogo, trocar a tecla).
- **`ConvertTo-Json` do PowerShell 5.1 desembrulha lista de 1** (e array dentro de array sai como
  `{value, Count}`): no OCR cada palavra vai como hashtable e o Python normaliza lista/dict
  (`feiticos.OcrChat.ler`). Imagem sem arquivo: base64 no stdin → `MemoryStream` →
  `WindowsRuntimeStreamExtensions.AsRandomAccessStream` funciona; ~70–100 ms por recorte ampliado 3×.
- **Testar o coletor sem mexer no real** → não rodar `coletor.py` (a trava e o log são os de
  `dados/`); usar `RetratoChampSelect` ou `Coletor` com LCU falsa e `--db`/banco em `temp/`
  (`tools/teste-champselect.py`). MCP: `LOL_CLIENT_DB=<banco>`.
- **`auditpol /subcategory:"Process Creation"` dá "Parâmetro incorreto"** → o Windows é pt-BR
  e o nome é localizado; usar o GUID `{0CCE922B-69AE-11D9-BED3-505054503030}`. No Git Bash,
  `/get` vira caminho; rodar pelo PowerShell.
- **auditpol com o GUID `…-BED3-00C04FD9BE6E` dá "Parâmetro incorreto"** → esse GUID (que
  circula na web e estava no plano) não existe aqui; o real termina em `505054503030`
  (`auditpol /list /subcategory:* /v`). `instalar-gatilho.ps1` acha pelo prefixo `0CCE922B` (13/10/2026).
- **Cabeçalho do `auditpol /backup` e do `/r` é localizado** ("GUID de Subcategoria",
  "Valor da Configuração", "Êxito") → ler o CSV por posição; o estado salvo em
  `dados/auditoria-anterior.txt` é o número (0 nada, 1 sucesso, 2 falha, 3 os dois). Em
  13/10/2026 a auditoria de criação de processo **já estava ligada** (valor 1) antes do instalador.
- **`os.kill(pid, 0)` no Windows mata o processo** (vira `TerminateProcess`) → checar trava
  com `OpenProcess`/`GetExitCodeProcess` (`coletor.pid_vivo`).
- **`.ps1` com acento sai quebrado** → o Windows PowerShell 5.1 lê `.ps1` sem BOM como ANSI;
  os scripts de `tools/` ficam sem acento.
- **OCR do Windows devolve tudo vazio sem erro** (PowerShell 5.1 + WinRT) → `[Windows.Globalization.Language]`
  precisa do próprio `[void][Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]`;
  sem isso `TryCreateFromLanguage` recebe null (13/10/2026, `temp/medicao/ocr_windows.ps1`).
- **Análise de imagem em Python** → `python -I` não enxerga o `cv2` (instalado no site de
  usuário); o PIL não aceita caminho `/c/...` do Git Bash; saída com "≈" quebra no cp1252
  (`PYTHONIOENCODING=utf-8`); o hook `guarda-comando` bloqueia `sed -i` (13/10/2026).
- **Parar o coletor com `schtasks /end`** não grava "encerrado" (morte seca) e deixa a trava;
  a próxima instância vê o pid morto e remove ("trava órfã").
- **Coletor sai com "outra instância em execução" sem haver outra** → a trava órfã tinha um pid
  que o Windows reaproveitou para outro python (há dezenas vivos: MCPs, maestro). `pid_vivo`
  compara a criação do processo com o mtime da trava: nascido depois dela = órfã (13/10/2026).
- **Token da LCU no log Security** → com `ProcessCreationIncludeCmdLine_Enabled=1` (ligado
  pelo harness em 10/10/2026), o 4688 do client grava `--remoting-auth-token`. O log de 200 MB
  é circular e retém ~2,5 h. Detalhe e desligar: [COLETOR.md](COLETOR.md) § Segurança.
- **Janela do painel fora do lugar** → `msedge --window-position/--window-size` usa px **lógicos**:
  2560,595 físicos viraram (3200, 744); dividir pela escala do monitor (`GetDpiForMonitor`). Usar a
  área útil (`rcWork`), senão a barra de tarefas cobre o rodapé (13/10/2026).
- **Pid do painel guardado pode virar o Edge do Gabriel** → coletor morto no meio da partida deixa
  `dados\edge-painel.pid`; o Windows reaproveita o pid e o próximo `fechar()` derrubaria o navegador
  dele. `janela_painel.pid_existe` recusa processo criado depois do `ts` do arquivo (13/10/2026).
- **`taskkill /PID <edge> /T` sem `/F` não fecha o Edge** (esperou 3 s e precisou do `/F`) →
  `WM_CLOSE` na janela do pid fecha em 0,4 s (`janela_painel.py`, 13/10/2026).
- **Print headless do painel sai vazio** → `msedge --headless --screenshot` tira a foto no load,
  antes do 1º `fetch('/estado')`: o servidor embute o estado no HTML; `--virtual-time-budget=3000` ajuda.
- **Nome grande some de um bloco do painel** (integração, 13/10/2026: "3 AD · 2 AP" sumiu no
  carregamento) → o bloco é flex em coluna com `min-height: 0` e `overflow: hidden`: texto longo
  (lembrete do ITENS.md em 3 linhas) encolhe o `.nome-grande` até zero. `.nome-grande` tem
  `flex-shrink: 0` e o texto longo vai para um rodapé de uma linha, nunca para o meio do bloco.
- **Coach não desliga no fim da partida** → `EndOfGame` está em `FASES_JOGO` do `coletor.py`: "parar fora
  das fases de jogo" nunca dispara nele. Quem decide é o `coach_vivo.Coach.fase` (`WaitingForStats`
  para o que olha a tela; `EndOfGame` ou fora do jogo para tudo).
- **Cópia do `dados\lol.db` inconsistente** (WAL aberto pelo coletor real) → copiar com
  `sqlite3.Connection.backup`, não com cópia de arquivo (`tools\ensaio-coach.py`).
- **Previsão do jungler sempre no meio do mapa** (ensaio, 13/10/2026) → o centro do calor da área inteira
  cai em (8000–9000, 8000–9000) assim que ela cresce: não diz nada. O coach grava o centro **dentro da
  zona mais provável**. Nenhum dos dois passou de 2/26 a ≤ 1000 no ensaio (zona certa 4/29), mas lá o
  minimapa é 1 recorte a cada 10 s e a fog tem até 10 s: quem mede de verdade é o passo 15, ao vivo a 6 fps.

## Riot API (servidores da Riot, não a LCU)

- **Chave**: `LOL_RIOT_API_KEY` no Doppler **pessoal** (`--scope ~/.doppler-pessoal`, projeto
  `pessoal`, literal no `prd`, referência no `dev`). Rodar com
  `doppler run --project pessoal --config prd --scope ~/.doppler-pessoal -- <cmd>`.
- **Chave de desenvolvimento vence em 24 h** → o Gabriel regenera no painel developer.riotgames.com
  e o valor novo vai só no `prd`. A Personal API Key não vence (pedido de aprovação; ver docs/MERCADO.md).
  **Personal API Key aprovada em 13/10/2026** (app `891070` "lol-client personal coach", status
  Approved, conferido no painel pelo Playwright): é ela que está no `prd` desde então (limite
  `100:120,20:1`). Não vence; a chave de desenvolvimento do painel não é mais usada.
- **`401 Unknown apikey`** → duas causas, olhar o painel antes: (1) a chave **venceu** (o painel
  mostra a validade; regenerar); (2) a chave **acabou de ser gerada** e ainda não vale: leva
  alguns minutos (13/10/2026: a 1ª tinha vencido; a regenerada deu 401 por ~5 min e 200 às 07:21).
  Chave recém-gerada com 401: esperar, não regenerar de novo.
- **`403 error code: 1010`** → a Cloudflare da Riot bloqueia requisição sem `User-Agent`
  (o padrão do `urllib` é barrado). Mandar `User-Agent: lol-client/<versão>`.
- **`400` em `/by-puuid/` com o puuid da LCU** → o puuid da Riot API é cifrado por chave (78 caracteres)
  e **não** é o UUID da LCU (`meta.puuid`, `participantIdentities`, gameflow). Riot ID → `account-v1` →
  puuid da API, ou os 10 pelo spectator-v5 (13/10/2026). O caminho da URL tem identidade: `riotapi.mascarar`.
- **`laningPhaseGoldExpAdvantage` não é "ganhou a rota"** → vale 1 em só 12% dos jogos (3050 da meta);
  com 1, todos estavam +24% ou mais de ouro+xp sobre o adversário aos 14 min; com 0, 42% estavam à
  frente (120 participantes do banco, 13/10/2026). Mede "domina a rota"; "perde a rota" não sai dele.
- **Sem chave até reiniciar o coletor** → o cliente é um só no processo e guardava `""` na 1ª falha do
  `doppler secrets get` (sem rede, CLI deslogado). Hoje relê depois de 60 s (`riotapi.RELER_CHAVE_S`).
- **429 com dois processos na mesma chave** → o limite (100/2 min) é da chave, o balde de cada processo
  não vê o do outro (2º teste do carregamento em < 2 min: 7 s → 64 s). `riotapi` lê
  `X-App-Rate-Limit-Count` da resposta e se acerta; ainda assim, só um processo consulta durante a partida.

## Mentor (`claude -p`, `coletor/mentor.py`, medido em 13/10/2026, Claude Code 2.1.296)

- **`CLAUDE.md` global e hooks vazam no `claude -p` mesmo com cwd fora de `C:\Dev`** → o modelo recebe o
  modo caveman e a persona do `~/.claude/CLAUDE.md`, e os hooks de `UserPromptSubmit` (calendário,
  conceitos) injetam contexto pessoal. `--safe-mode` tira `CLAUDE.md`, hook, skill e plugin e mantém o
  login (o `--bare` não serve: pula o OAuth). Sobra só o bloco automático com o e-mail da conta.
- **Ferramenta e MCP**: `--tools ""` zera as nativas, mas os MCP do escopo de usuário carregam em qualquer
  cwd; `--strict-mcp-config` sem `--mcp-config` zera. O advisor é ferramenta do servidor e segue ativo.
- **Env da sessão que roda o teste vaza** (`CLAUDECODE`, `CLAUDE_EFFORT`, `CLAUDE_CODE_SESSION_ID`…):
  `CLAUDE_EFFORT` pode passar por cima do `--effort`. `mentor.ambiente()` tira toda chave `CLAUDE*`.
- **`--resume <id>` só acha a sessão no mesmo cwd** (as sessões ficam por pasta de projeto): o cwd do
  mentor é fixo (`%LOCALAPPDATA%\lol-client-mentor`); nunca `--no-session-persistence`.
- **Prompt pela linha de comando**: estoura o limite de ~32 K do Windows no pós-jogo e cai no 4688 (o log
  Security grava a linha de comando). O prompt vai pelo stdin.
