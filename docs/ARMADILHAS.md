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
- **Janela do ready-check** ainda não medida: o aceite usa `limiteS: 12` (constante do
  `PADRAO` em `config.js`; o valor salvo no DataStore é ignorado) e aceita em
  `min(atrasoS, limiteS − 2)` pelo `timer` do payload. Medir no 1º aceite real e ajustar o `PADRAO`.
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
  `ELITE_MONSTER_KILL`, `BUILDING_KILL` e 1 frame por minuto.
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
  achatar antes de procurar o pick travado. `bans.myTeamBans`/`theirTeamBans` têm fama de vir
  vazio em patch recente: o retrato usa as ações `ban` completas e cai no resumo só sem elas.
  **A confirmar** na 1ª gravação real (fixtures do passo 1 são montadas).
- **Live Client (`127.0.0.1:2999`) recusa a conexão fora da partida** e pode dar 404/500 na tela
  de carregamento: o gravador conta como "sem partida", não como erro.
- **Timeout de leitura da LCU não vira `URLError`** → sai `TimeoutError` cru do `getresponse`
  (e `ConnectionResetError`, `JSONDecodeError` com corpo cortado). Quem só pega `HTTPError` morre
  no 1º engasgo; o `Gravador.get()` pega tudo e conta `erro_lcu`.
- **Sequência de derrotas zerando à meia-noite** → `sessao_hoje()` lia só desde 00:00 e o `_tilt()`
  encadeia por pausa < 2 h: na faixa 00–06h (a pior) o alerta de 3+ derrotas não disparava. Hoje a
  sessão em andamento atravessa a meia-noite (`servidor._sessao`).

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
- **Parar o coletor com `schtasks /end`** não grava "encerrado" (morte seca) e deixa a trava;
  a próxima instância vê o pid morto e remove ("trava órfã").
- **Coletor sai com "outra instância em execução" sem haver outra** → a trava órfã tinha um pid
  que o Windows reaproveitou para outro python (há dezenas vivos: MCPs, maestro). `pid_vivo`
  compara a criação do processo com o mtime da trava: nascido depois dela = órfã (13/10/2026).
- **Token da LCU no log Security** → com `ProcessCreationIncludeCmdLine_Enabled=1` (ligado
  pelo harness em 10/10/2026), o 4688 do client grava `--remoting-auth-token`. O log de 200 MB
  é circular e retém ~2,5 h. Detalhe e desligar: [COLETOR.md](COLETOR.md) § Segurança.
