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
  (60103 = `Jade_Ahri`); filtrar `id < 10000` (13/10/2026).
- **Painel pós-jogo cobre o ready-check** → `#lc-posjogo` é tela cheia (z-index 100001) e o
  modal do client fica embaixo. Ele fecha sozinho em `ReadyCheck`/`ChampSelect`/`GameStart`/`InProgress`
  e o `#lc-aceite` fica acima (100002); tela nova por cima do client precisa do mesmo cuidado.
  O popup de runas (`#lc-runas`) não tem fundo bloqueante (só a caixa recebe clique: troca, feitiços
  e chat seguem usáveis), fecha com Esc e quando a fase sai de `ChampSelect` (Delete da sessão pode se perder).
- **Selo do winrate preso em "sem partidas"** → erro HTTP do histórico (404/5xx no boot) marcava a
  leitura como feita. Hoje só resposta com `games.games` conta; erro vira "histórico indisponível" e o
  selo relê no máximo a cada 15 s (13/10/2026, achado de revisão).

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
  circular acham o hospedeiro (Nilah 2/26). A Live Client não diz em quem ela está.
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
- **Painel pós-jogo não deixa rastro de sucesso** → `fechar()` remove `#lc-posjogo` sem log; depois
  que o Gabriel fecha, não dá para provar de fora que abriu sozinho (13/10/2026).

## Windows

- **Print com `mss`**: a versão 10 já devolve px físicos (monitor do jogo 2560×1080 com escala
  125%) e `mss.mss()` virou `mss.MSS()` (o antigo só avisa). Conferido 13/10/2026.
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
