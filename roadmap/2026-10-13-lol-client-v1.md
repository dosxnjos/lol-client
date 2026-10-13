# Plano — lol-client v1: interface, fila rápida, coletor, pós-jogo e MCP (2026-10-13)

Pedido: lol-client-v1 | mod do client do LoL: interface, fila rápida, auto-aceitar, banco de partidas, pós-jogo e MCP | de: gabriel | desde: 2026-10-13 | origem: chat

## Contexto (ler antes de começar)

- Hub: [cerebro/projetos/lol-client.md](../../cerebro/projetos/lol-client.md) · regras do
  projeto: [CLAUDE.md](../CLAUDE.md) · armadilhas: [docs/ARMADILHAS.md](../docs/ARMADILHAS.md).
- O client do LoL (LeagueClientUx) é um app Ember rodando em **CEF 108** (Chromium 108:
  `:has()` funciona). Atrás dele há a **LCU API**: REST + websocket WAMP em
  `https://127.0.0.1:<porta>`, autenticada por Basic com usuário `riot` e a credencial do
  lockfile. O lockfile fica em `C:\Games\Riot Games\League of Legends\lockfile` e tem cinco
  campos separados por dois-pontos (nome, pid, porta, credencial, protocolo). **A credencial
  muda a cada abertura e nunca vai para arquivo versionado, log, doc ou cérebro.**
- **Pengu Loader 1.1.6** em `C:\Program Files\Pengu Loader` injeta plugins JS no client.
  Contrato (extraído do `core.dll`): pasta `plugins/<nome>/index.js` (módulo ES); exporta
  `init(context)` (com `context.socket.observe(endpoint, cb)` e `context.rcp`) e/ou
  `load()` / `default`, chamados no `window.load`. Globais disponíveis: `DataStore`
  (get/set persistente), `CommandBar` (ações no Ctrl+K), `Toast` (success/error/promise),
  `window.restartClient()` (recarrega a interface). De dentro do plugin, `fetch('/lol-...')`
  chega na LCU **sem auth**, porque a origem da página já é autenticada (testado: 200).
- **Depuração**: `RemoteDebuggingPort=8888` foi adicionada ao `config` do Pengu em
  13/10/2026 (backup do original: `%TEMP%\pengu-config.bak`). `http://127.0.0.1:8888/json/list`
  lista a página; `tools/cdp.mjs` faz `eval <arquivo.js>`, `click <x> <y>` (px CSS) e
  `shot <saida.png>`. A janela tem `devicePixelRatio` 1,25: coordenada do print ÷ 1,25 = px CSS.
- Recarregar a interface sem derrubar o login: `POST /riotclient/kill-and-restart-ux`
  (ou `window.restartClient()`). **Só com a fase em `None` ou `Lobby` e sem busca de fila
  ativa** (`GET /lol-gameflow/v1/gameflow-phase`).
- Endpoints confirmados no `/help` da LCU em 13/10/2026:
  - lobby: `POST /lol-lobby/v2/lobby` (`{queueId}`), `GET /lol-lobby/v2/lobby/members`,
    `PUT /lol-lobby/v2/lobby/members/localMember/position-preferences`
    (`{firstPreference, secondPreference}`), `POST|DELETE /lol-lobby/v2/lobby/matchmaking/search`
  - aceite: `GET /lol-matchmaking/v1/ready-check`, `POST /lol-matchmaking/v1/ready-check/accept|decline`
  - ranque e fim de jogo: `GET /lol-ranked/v1/current-ranked-stats`, `GET /lol-end-of-game/v1/eog-stats-block`
  - histórico: `GET /lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=199`
    (200 partidas, desde 23/04/2026), `GET /lol-match-history/v1/games/{gameId}`
  - linha do tempo: `GET /lol-match-history/v1/game-timelines/{gameId}`, com frames de 1 min
    (`position{x,y}`, `totalGold`, `xp`, `minionsKilled`, `jungleMinionsKilled`, `level` por
    participante) e eventos `CHAMPION_KILL` (`position`, `killerId`, `victimId`,
    `assistingParticipantIds`), `ELITE_MONSTER_KILL`, `BUILDING_KILL`. **Sem wards nem compras.**
- Fila 420 = Ranqueada Solo/Duo. Conta: Xerekton#Xerek (BR; puuid em `GET /lol-summoner/v1/current-summoner`).
- DOM medido em 13/10/2026 (tela de modos aberta pela seta do lobby):
  - barra de cima: `lol-uikit-navigation-item.main-navigation-menu-item.menu_item_navbar_tft`
  - card de modo: `.game-type-card` (selecionado: `.selected`); ícone com a classe do mapa:
    `.parties-game-type-icon.map-11` (Rift), `map-22` (TFT), `map-12` (ARAM), `map-30` (Arena),
    `map-453` (Rift Clássico)
  - lista de filas: `.parties-game-type-lower-half` (180 px, causa do aperto) >
    `.parties-game-type-card-categories` > `.parties-game-type-card-category-div` > `.queue-id`
  - botão jogar: `.play-button-component` (no lobby o texto vira "GRUPO")
- **Protótipo de CSS aprovado pelo Gabriel** ("ficou boa a questão do width"):

  ```css
  .game-type-card.selected .parties-game-type-lower-half { width: 340px; height: 360px; position: relative; z-index: 2; }
  .game-type-card.selected .parties-game-type-card-categories { width: 100%; max-height: none; }
  .game-type-card.selected .parties-game-type-card-category-div { width: auto; }
  .game-type-card:has(.parties-game-type-icon.map-22) { display: none !important; }
  .main-navigation-menu-item.menu_item_navbar_tft { display: none !important; }
  ```

## Entendimento do pedido

O Gabriel (analista de dados, jogador ranqueado top/jungle) quer o client do LoL mais
útil para ele:

1. **Banco de partidas (opção 1)**: histórico próprio para análise. Exigência dele: o
   banco **não fica ativo o tempo todo**; liga junto com o LoL e desliga sozinho um tempo
   depois que o LoL fecha.
2. **MCP (opção 4)**: perguntar ao Claude sobre as próprias partidas.
3. **Interface mais simples**: esconder TFT; corrigir a coluna estreita das filas do
   Summoner's Rift na tela de "jogar"; aceita sugestões.
4. **Aceitar partida automático** depois de ~10 s, com chance de recusar.
5. **Botão "fila rápida"** perto do botão jogar (topo esquerdo): um clique entra na fila
   solo/duo com 1ª posição top e 2ª jungle.
6. **Tela pós-jogo com insights**: o que aconteceu minuto a minuto, para mostrar onde e
   por que errou (posicionamento e comportamento).

Fora do escopo: qualquer coisa dentro da partida (Vanguard), revelar nomes ocultos no
champ select, automação de jogo, skins.

## O que o pedido não dizia

Feito (técnico, barato, reversível, marcado `+` nos passos):

- **+ Janela do aceite**: a Riot dá ~12 s para aceitar; 10 s fixos + latência estoura.
  Usar o `timer` (tempo decorrido) do próprio ready-check e aceitar no
  `min(atraso configurado, limite − 2 s)`; o atraso fica configurável.
- **+ Proteção do grupo** na fila rápida: `POST /lol-lobby/v2/lobby` substitui o lobby e
  expulsaria amigos; com outro membro no grupo, recusa com toast.
- **+ Backfill**: as 200 partidas que o client já guarda entram no banco na 1ª execução,
  e cada início recupera o que faltou. Gatilho que falhou não perde partida; só perde a
  telemetria ao vivo daquela sessão (LP antes e depois, horários de fase).
- **+ Configuração no Ctrl+K** do Pengu (CommandBar): ligar e desligar cada item, ajustar o
  atraso do aceite e as posições da fila rápida, sem editar arquivo.
- **+ Análise sob demanda**: a mesma tela pós-jogo abre para a última partida pelo Ctrl+K
  ("analisar última partida"). Também serve de teste sem precisar jogar.
- **+ Spec única das heurísticas** em `docs/INSIGHTS.md`: o painel (JS) e o MCP (Python)
  implementam as mesmas regras; a spec é a dona, para não divergirem.

Proposto (não feito, depende do Gabriel):

- Enxugamentos extras (aba de evento, "CLASSIC", loja): entram como chaves desligadas por
  padrão no Ctrl+K; ele liga o que quiser.
- Live Client Data API (`127.0.0.1:2999`, oficial da Riot, só leitura) durante a partida:
  ouro, itens e placar a cada poucos segundos, mais fino que 1 frame por minuto. v2, se a
  análise de 1 min se mostrar grossa demais.
- No champ select: winrate e KDA com o campeão em hover, tirados do banco. v2.

Descartado: revelar o lobby (privacidade de terceiros, ban); trocar skin dentro do jogo
(Vanguard).

## O que NÃO muda (guardrails)

- Nenhum arquivo do jogo (`C:\Games\Riot Games\...`) é editado. Fora do repo, só o
  `config` do Pengu (já feito) e a junção em `plugins/`.
- **Nunca `POST /lol-lobby/v2/lobby/matchmaking/search` em teste automatizado**: põe a
  conta na fila e um aceite perdido gera penalidade. Teste de busca só com o Gabriel no
  teclado e avisado.
- Nunca recarregar a interface fora das fases `None`/`Lobby`.
- Credencial do lockfile e tokens não vão para arquivo versionado, log nem diário.
- Nada roda o tempo todo: o coletor só existe enquanto o LoL está aberto (+ 10 min).

## Abordagem / arquitetura

```
C:\Dev\lol-client\
  pengu\            plugin do Pengu (junção em C:\Program Files\Pengu Loader\plugins\lol-client)
    index.js        entrada: init/load, liga os módulos conforme config
    config.js       defaults + DataStore('lol-client.config') + ações do CommandBar
    estilo.css      CSS (TFT, coluna, enxugamentos por classe no <html>)
    aceite.js       auto-aceitar com contagem e botão "não aceitar"
    fila-rapida.js  botão ao lado do jogar (MutationObserver reinjeta após re-render do Ember)
    posjogo\        painel de análise (mapa SVG + insights), implementa docs/INSIGHTS.md
  coletor\          Python: backfill + websocket da LCU -> SQLite; sai sozinho 10 min sem client
    analise.py      mesmas heurísticas (docs/INSIGHTS.md), usado pelo MCP
  mcp\servidor.py   MCP stdio (SDK `mcp` já instalado), lê o SQLite; sincroniza via LCU se o client estiver aberto
  tools\cdp.mjs     laço de dev: eval/click/shot via porta 8888
  tools\instalar-gatilho.ps1 / remover-gatilho.ps1   gatilho do Windows (abaixo)
  dados\            lol.db + coletor.log (gitignored)
```

**Ciclo de vida do coletor (pedido do Gabriel):** a sessão do Claude roda elevada
(`net session` ok). Passos:

- habilitar a auditoria "Criação de processo" (subcategoria
  `{0CCE922B-69AE-11D9-BED3-00C04FD9BE6E}`; o Windows é pt-BR, então usar o GUID, não o nome);
- criar uma tarefa no Agendador com **gatilho de evento** Security 4688 filtrado por
  `NewProcessName` terminando em `\LeagueClientUx.exe`, ação `pythonw coletor\coletor.py`,
  "não iniciar nova instância se já estiver rodando".

Nenhum processo nosso fica residente: quem vigia é o próprio Windows. O coletor sai
sozinho após 10 min sem lockfile ou sem resposta da LCU. Reversão: `tools\remover-gatilho.ps1`
(apaga a tarefa e restaura a auditoria anterior, salva pelo instalador em
`dados\auditoria-anterior.txt`). Alternativa se o 4688 não disparar: assinatura WMI
permanente (`Win32_ProcessStartTrace`), também nativa.

## Decisões e trade-offs

- **Pós-jogo calcula no próprio plugin** (LCU direto), sem depender do coletor: o painel
  funciona mesmo se o gatilho falhar. Custo: heurística duplicada em JS e Python, contida
  pela spec única `docs/INSIGHTS.md`. Quem: opus 5.5 (sessão assistida); confiança média;
  reverteria se a divergência aparecer na prática, passando o painel a ler do coletor por HTTP local.
- **SQLite** (stdlib) e não DuckDB: zero dependência e um arquivo só. Para análise pesada,
  o DuckDB lê SQLite direto depois.
- **Tarefa por evento 4688** e não um vigia residente, porque o Gabriel pediu nada ligado o
  tempo todo. Custo: a auditoria grava um evento por processo criado no log de Segurança
  (volume pequeno; o log rotaciona sozinho).
- **Aceite**: o atraso conta pelo `timer` do servidor, não pelo relógio local, porque o
  evento pode chegar atrasado.
- Conceitos do acervo: **via-negativa** (enxugar a interface é tirar, não pôr; os extras
  ficam desligados por padrão) e **falácia da previsão** (o "por que errei" é heurística
  sobre 1 frame por minuto; o painel mostra padrões, não veredito).

## Passos

### Fase 0 — base

1. [x] Hub `cerebro/projetos/lol-client.md` + linha no `cerebro/INDICE.md`.
   **prova:** `grep -c lol-client C:/Dev/cerebro/INDICE.md` → `1`
   **reprova se:** `0`
2. [ ] Repo: `git init -b main`, `.gitignore` (`dados/`, `node_modules/`, `__pycache__/`, `temp/`),
   `README.md`, `CLAUDE.md`, `docs/ARMADILHAS.md`, `tools/cdp.mjs`; repo privado
   `dosxnjos/lol-client` criado com `GH_TOKEN=$(gh auth token -u dosxnjos)` (a conta ativa
   do `gh` é `dados-produto-gruponomura` e é global; não trocar).
   **prova:** `GH_TOKEN=$(gh auth token -u dosxnjos) gh repo view dosxnjos/lol-client --json visibility -q .visibility` → `PRIVATE`
   **reprova se:** erro "Could not resolve" ou `PUBLIC`
3. [ ] Junção de dev: `cmd /c mklink /J "C:\Program Files\Pengu Loader\plugins\lol-client" "C:\Dev\lol-client\pengu"`;
   plugin "olá" (`index.js` que faz `console.log('[lol-client] ok')` e marca
   `document.documentElement.dataset.lolClient = 'ok'`); recarregar a interface.
   **prova:** `node tools/cdp.mjs eval` de `document.documentElement.dataset.lolClient + '|' + JSON.stringify(Pengu.plugins)` → `ok|["lol-client/index.js"]`
   **reprova se:** `undefined|[]`

### Fase 1 — interface (plugin)

4. [ ] `pengu/config.js`: defaults
   `{esconderTft:true, colunaLarga:true, aceite:{ligado:true, atrasoS:10}, filaRapida:{ligado:true, fila:420, pos1:'TOP', pos2:'JUNGLE'}, posjogo:{ligado:true}, extras:{esconderEvento:false, esconderClassic:false, esconderLoja:false}}`,
   persistidos em `DataStore`; cada chave booleana vira classe no `<html>` (`lc-esconder-tft` etc.);
   ações no `CommandBar` para alternar cada uma e para editar atraso e posições.
   **prova:** eval `[...document.documentElement.classList].filter(c=>c.startsWith('lc-')).sort().join(',')` → contém `lc-coluna-larga,lc-esconder-tft`
   **reprova se:** string vazia
5. [ ] `pengu/estilo.css`: o CSS do protótipo, prefixado pelas classes do passo 4. Cuidar do
   último card visível: a lista de 340 px não pode passar da borda direita da área central
   (alinhar pela direita quando estouraria).
   **prova:** eval com a tela de modos aberta (seta do lobby, px CSS ≈ (37,108)):
   `getComputedStyle(document.querySelector('.menu_item_navbar_tft')).display + '|' + document.querySelector('.game-type-card.selected .parties-game-type-lower-half').getBoundingClientRect().width`
   → `none|340`
   **reprova se:** `block|180` (ou qualquer largura 180)
6. [ ] `pengu/aceite.js` (+ janela calculada): `context.socket.observe('/lol-matchmaking/v1/ready-check', ...)`.
   Com `state==='InProgress' && playerResponse==='None'`, mostrar overlay com contagem e botões
   "aceitar agora" e "não aceitar"; aceitar em `min(atrasoS, limite − 2)` segundos medidos pelo
   `timer` do payload (limite padrão 12 s até medir o real; registrar no ARMADILHAS o valor
   observado). Cancelar se a resposta mudar (o Gabriel aceitou ou recusou na mão) ou se ele
   clicar "não aceitar" (que só desliga o automático daquela vez; recusar de fato é no botão do client).
   Lógica de decisão numa função pura `decidir(payload, cfg)` exportada.
   **prova:** `node tools/teste-aceite.mjs` importa a função pura e roda 5 casos
   (sem ready-check; InProgress/None em t=0 → agenda ~10 s; t=11 → aceita já; Accepted → cancela;
   Declined → cancela) → `5/5 ok`
   **reprova se:** qualquer `FALHOU`
7. [ ] `pengu/fila-rapida.js`: botão "FILA RÁPIDA" ao lado do `.play-button-component`,
   reinjetado por `MutationObserver` quando o Ember re-renderiza. Ao clicar:
   - fase em `ChampSelect`/`InProgress`/`ReadyCheck` → toast e nada;
   - lobby com outro membro → toast e nada (+ proteção do grupo);
   - senão: `POST /lol-lobby/v2/lobby {queueId:cfg.fila}` (se a fila atual for outra ou não
     houver lobby), `PUT position-preferences {firstPreference:pos1, secondPreference:pos2}`,
     `POST matchmaking/search`.
   - durante a busca o botão vira "cancelar" (`DELETE .../search`).
   **prova (sem buscar):** eval `!!document.querySelector('#lc-fila-rapida')` → `true`; e eval que
   chama a função exportada `prepararLobby()` (lobby + posições, **sem** search) e depois
   `GET /lol-lobby/v2/lobby/members` → 1º membro com `firstPositionPreference:"TOP"` e
   `secondPositionPreference:"JUNGLE"`; `GET /lol-lobby/v2/lobby` com `gameConfig.queueId:420`
   **reprova se:** botão ausente ou fila ≠ 420. Clique real com busca: só o Gabriel, avisado.

### Fase 2 — coletor e ciclo de vida

8. [ ] `docs/INSIGHTS.md`: spec das heurísticas (as do passo 12), regiões do mapa e
   limites conhecidos. É a dona; JS e Python a citam.
   **prova:** `grep -c '^### ' docs/INSIGHTS.md` → `≥ 6`
   **reprova se:** arquivo ausente ou `< 6`
9. [ ] `coletor/coletor.py` + `coletor/banco.py`:
   - descobre o lockfile (`C:\Games\Riot Games\League of Legends\lockfile`; fallback pelo
     `--install-directory` da linha de comando do `LeagueClientUx.exe`);
   - instância única (arquivo de trava com pid em `dados/`);
   - backfill: 200 partidas + `games/{id}` + `game-timelines/{id}` das que faltam;
   - websocket WAMP (`websockets`, já instalado; TLS sem verificação, só 127.0.0.1) assinando
     `OnJsonApiEvent_lol-gameflow_v1_gameflow-phase`, `OnJsonApiEvent_lol-end-of-game_v1_eog-stats-block`,
     `OnJsonApiEvent_lol-ranked_v1_current-ranked-stats`;
   - snapshot de LP a cada mudança de fase; no `EndOfGame`, busca a partida nova com
     retentativa (o histórico demora a aparecer);
   - sai 10 min após perder o client (`--ocioso-min` configurável); log em `dados/coletor.log`
     sem a credencial;
   - tabelas `partidas`, `participantes`, `frames`, `eventos`, `lp`, `sessoes`, `eog` (json bruto guardado junto).
   **prova:** `python coletor/coletor.py --so-backfill` e depois
   `python -c "import sqlite3;c=sqlite3.connect('dados/lol.db');print(c.execute('select count(*) from partidas').fetchone()[0]>=150, c.execute('select count(distinct game_id) from frames').fetchone()[0]>=100)"`
   → `True True`
   **reprova se:** `False` em qualquer um, ou exceção
10. [ ] Saída por ociosidade testável.
    **prova:** `timeout 60 python coletor/coletor.py --ocioso-min 0.1 --lockfile C:/nao/existe; echo rc=$?` → `rc=0`
    **reprova se:** `rc=124` (não saiu)
11. [ ] `tools/instalar-gatilho.ps1` e `tools/remover-gatilho.ps1`: salvam a auditoria atual,
    habilitam a criação de processo por GUID, registram a tarefa `lol-client-coletor` com
    gatilho de evento 4688 (XPath filtrando `LeagueClientUx.exe`), ação `pythonw.exe` com o
    caminho absoluto do coletor, `MultipleInstances IgnoreNew`, sem limite de tempo.
    **prova:** `schtasks /query /tn lol-client-coletor /xml | grep -c 4688` → `≥1`; e, com o
    Gabriel avisado, fechar e reabrir o client e ver `dados/coletor.log` com uma linha nova de
    "iniciado" posterior à reabertura.
    **reprova se:** tarefa ausente, ou log sem linha nova após reabrir

### Fase 3 — pós-jogo

12. [ ] `pengu/posjogo/`: ao entrar em `EndOfGame` (e pela ação "analisar última partida" do
    Ctrl+K), busca `games/{id}` e `game-timelines/{id}` (com retentativa), acha o próprio
    participante pelo puuid e o adversário de rota (mesma `timeline.lane`/`role` no time
    inimigo; fallback pela posição média nos minutos 3–10). Painel sobreposto com:
    - mapa SVG do Rift (0–14870 × 0–14980, y invertido) com o trajeto minuto a minuto e as mortes;
    - lista de mortes: tempo, região (rota, rio, selva aliada ou inimiga, base), quantos
      inimigos participaram, aliados por perto no frame mais próximo (< 2000 unidades), e se
      houve objetivo inimigo em até 90 s depois;
    - diferença de ouro, xp e farm contra o adversário de rota aos 10 e aos 15 min;
    - farm por minuto contra a tua média nas últimas 20 partidas com o mesmo campeão (histórico da LCU);
    - fechar com Esc ou botão.
    **prova:** eval que dispara "analisar última partida" e depois
    `document.querySelectorAll('#lc-posjogo .lc-morte').length + '|' + !!document.querySelector('#lc-posjogo svg')`
    → `<N>|true`, com N igual ao número de `CHAMPION_KILL` cujo `victimId` é o próprio participante na timeline (conferir por curl)
    **reprova se:** painel ausente ou contagem diferente
13. [ ] `coletor/analise.py`: as mesmas heurísticas sobre o SQLite.
    **prova:** `analisar(game_id)` sobre o mesmo `gameId` do passo 12 → mesmo número de
    mortes e as mesmas diferenças aos 10 min do painel
    **reprova se:** números diferentes do painel

### Fase 4 — MCP

14. [ ] `mcp/servidor.py` (FastMCP, stdio), ferramentas:
    - `resumo(dias=7)`: partidas, vitórias, LP, campeões, posições;
    - `partidas(limite=20, campeao=None, fila=None)`;
    - `analise_partida(game_id=None)` (padrão: a última);
    - `tilt()`: winrate da partida seguinte após 0, 1, 2 e 3+ derrotas seguidas, e por horário;
    - `campeoes(min_partidas=3)`;
    - `sincronizar()`: roda o backfill se o client estiver aberto. Só leitura no banco, fora este.
    Registro: `claude mcp add --scope user lol-client -- python C:\Dev\lol-client\mcp\servidor.py`.
    **prova:** `claude mcp list 2>&1 | grep lol-client` → linha com `✓ Connected`
    **reprova se:** ausente ou `✗ Failed`

### Fase 5 — fechamento

15. [ ] README (instalar, usar, desligar e desinstalar tudo), ARMADILHAS e hub atualizados,
    fragmento de diário em `cerebro/pessoal/diario/2026-10-13/` + compilar, commit e push.
    **prova:** `git -C C:/Dev/lol-client status --porcelain | wc -l` → `0` e o último commit local igual ao de `origin/main`
    **reprova se:** arquivos pendentes ou push faltando

## Riscos / o que pode dar errado

- **Janela do ready-check** diferente de 12 s: medir no 1º aceite real e ajustar o padrão.
- **Ember re-renderiza** a barra superior a cada troca de rota: botão injetado uma vez some.
  MutationObserver obrigatório, com guarda contra duplicar.
- **Patch do LoL** muda classes CSS: seletores num lugar só (`estilo.css` e uma constante
  `SELETORES` no JS); a ARMADILHAS registra a data em que cada seletor foi medido.
- **Pengu desatualizado** num patch ("Pengu does not support your Client version"): o
  plugin some, o client continua normal. Coletor e MCP não dependem do Pengu.
- **Auditoria 4688** pode não disparar o Agendador (log cheio, política de grupo):
  fallback WMI documentado na Abordagem.
- **Timeline indisponível** logo no `EndOfGame`: retentativa com espera crescente (5, 10,
  20, 40 s) e "processando partida" no painel.
- **Termos da Riot**: Pengu é zona cinza; tudo aqui é leitura de dados próprios e mudança
  de interface. Nada toca o processo do jogo.
