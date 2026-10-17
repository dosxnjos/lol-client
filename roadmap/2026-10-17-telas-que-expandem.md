# Plano — telas que tiram o compacto: diagnóstico e o que construir (2026-10-17)

Plano para um executor que nunca viu a conversa. Projeto `C:\Dev\lol-client`, plugin Pengu em `pengu/` (compacto em
`pengu/compacto/`). Antes do 1º Edit: hub `C:\Dev\cerebro\projetos\lol-client.md`, `CLAUDE.md`, `docs/ARMADILHAS.md`
(§ Client e Pengu, § LCU), `docs/TEXTOS-DA-INTERFACE.md`, `docs/COLETOR.md` § Registro das expansões do compacto e o
[plano do compacto](2026-10-13-client-compacto.md) (regra 7, passos 12, 14 e 15).

Este md é **só diagnóstico e proposta**: nenhum código de produto foi tocado para escrevê-lo. As etapas abaixo são
independentes; cada uma tem prova, revisão adversarial e commit próprio, na ordem da lista priorizada.

## Pedido (Gabriel, 17/10/2026)

"você conseguiu ver as telas que fazem ele sair do modo compacto até então pra gente migrar elas também pro modo
compacto?"

Resposta curta: sim. Em 15–16/10 o registro das expansões (`dados\expansoes-compacto.jsonl`, 42 linhas) pegou **5 tipos
de tela da Riot** que tiram o compacto sozinhas, mais um caso que parecia grave e **não era a ranqueada dele**: era ele
**assistindo** partidas de amigos. Só uma tela tem bug do compacto na ranqueada de verdade (uma piscada de 1 s no início
da seleção). O resto é proteção funcionando; parte dá para migrar com segurança, parte deve continuar expandindo.

O registro continua ligado: ele vive no plugin e grava pelo coletor, que em 17/10 14:21 estava de pé (`vivo há 2706 min`
no `dados\coletor.log`). O último evento é de 16/10 22:50 porque não houve expansão depois disso. O medidor passivo
(`tools\medir-compacto.py --continuo`) também segue gravando (última linha 17/10 13:48).

## Como ler a evidência (pegadinha de relógio)

- `dados\expansoes-compacto.jsonl`: campo `em` em **UTC** (`...Z`). O `tools\relatorio-expansoes.py` mostra em hora local
  (UTC−3).
- `dados\medicao-compacto-2026-10-15.jsonl` (medidor): campo `t` em **hora local, sem fuso**.
- `dados\coletor.log`: hora local.
- Logo, "16/10 23:45 UTC" no registro = "16/10 20:45" no medidor e no log do coletor.

## Diagnóstico, tela por tela

### A. Caso "ranqueada virou ARAM/espectador" (16/10, 20:45–20:52 local): era espectador, não a ranqueada dele

O que o registro mostra (linhas 33–40): numa expansão pedida por ele (`por-ele`, `gatilho: tela lobby`, gesto de 104 ms),
a trilha anota "seleção fora do Summoner's Rift (ARAM e outros)" e "seleção da fila desconhecida"; depois um evento
`por-ele` com `gatilho: tela champselect`, fila 420, mapa 11 e o aviso "esta seleção (banco/ARAM ou espectador) é da
tela da Riot".

O que a LCU dizia (medidor, hora local):

| hora | fase | gameflow | sessão da seleção |
| --- | --- | --- | --- |
| 20:45:35 | None → ChampSelect | `queueId 2400`, `mapId 12`, `gameMode KIWI` | `localPlayerCellId -1`, `isCustomGame true`, `benchEnabled false`, timer `GAME_STARTING` 75 000 ms, os 5 campeões já travados, `isOnPlayersTeam false` em todos |
| 20:46:50 | ChampSelect → None | | |
| 20:48:19 | None → ChampSelect | `queueId 420`, `mapId 11`, `CLASSIC` | `localPlayerCellId -1`, `isCustomGame true`, timer `GAME_STARTING` 170 000 ms, campeões travados |
| 20:48:23 | ChampSelect → None | | |
| 20:48:28 | None → ChampSelect | `queueId 2400`, `mapId 12`, `KIWI` | `localPlayerCellId -1`, `GAME_STARTING` 89 000 ms (86 000 restantes) |
| 20:50:00 | ChampSelect → InProgress | | (86 s depois: o fim da contagem) |
| 20:51:40 | InProgress → WaitingForStats → None | | |

Na lista de amigos do mesmo minuto há amigos em `hosting_KIWI` e `hosting_RANKED_SOLO_5x5`. O coletor registrou "fase
ChampSelect (partida None)" nas três seleções, sem gravar champ select. A ranqueada real dele (15/10 13:50, para comparar)
tem `localPlayerCellId 4`, `isCustomGame false`, timer `PLANNING` e `BAN_PICK`.

**Conclusão:** ele clicou em **Assistir** em amigos (duas partidas de ARAM Mayhem e uma ranqueada de amigo). Medido aqui:
**assistir entra na fase `ChampSelect`** (contagem `GAME_STARTING` = atraso do espectador: 170 s na ranqueada, 75–89 s
no KIWI) **e depois em `InProgress`**, não em `WatchInProgress` como presumia o comentário de `pengu/compacto/index.js:105`.

Causas exatas no código:

1. **"fora do Summoner's Rift" (KIWI, mapa 12):** `pengu/compacto/index.js:96` (`destinoDaFase`, `ChampSelect`) leu
   `mapa = 12` de `infoDaSessao` (`index.js:147`, `s.map.id` do `/lol-gameflow/v1/session`) e expandiu. O destino certo
   (client normal), o motivo errado: o roteador não sabe de espectador.
2. **"seleção da fila desconhecida" (20:46:49 e 20:48:23):** no fim de cada seleção assistida a sessão do gameflow
   chega **vazia** (sem `queue.id` nem `map.id`) ~150–190 ms **antes** do evento de fase. `aoSessao` (`index.js:776–783`)
   troca `est.info` para `{lida:true, fila:null, mapa:null}` e `destinoDaFase` cai em `index.js:98`. Como ele já estava
   expandido, só virou trilha; com o compacto à vista seria uma piscada 420 → 1280 → 420 na saída de qualquer seleção.
3. **O aviso "banco/ARAM ou espectador" e o 420/11:** o gameflow da partida assistida diz fila 420, mapa 11, `custom
   false` → `index.js:97` monta a tela da seleção; `pengu/compacto/tela-champselect.js:735` vê `s.isSpectating`
   (`benchEnabled` era `false` e a fila não era 450, então foi o `isSpectating`) e chama `ctx.avisar(...)` +
   `ctx.expandir()` (`tela-champselect.js:736`).
4. **Por que o registro marcou "por-ele":** `ctx.expandir()` passa por `expandirPorTi('tela champselect')`
   (`index.js:703`), origem `por-ele`. Em `notarExpansao` (`index.js:401–406`) o pedido de uma tela só conta como dele se
   houve clique/tecla nos últimos `GESTO_MS` (1500 ms); `gestoHaMs` foi **771 ms**. Esse clique foi o "Assistir" dele **no
   client normal da Riot**, antes de a tela compacta existir (ele tinha expandido pelo botão às 20:48:14; a seleção abriu
   às 20:48:19,14 e a tela compacta montou ~20:48:19,46). O gesto é escutado no documento inteiro (`index.js:987`), sem
   olhar se foi dentro da camada nem se foi depois da montagem da tela. É erro do classificador, não do relatório.
5. **Efeito colateral visto:** às 20:49:57 a fase virou `GameStart` e o roteador **encolheu** para a tela da partida
   (`index.js:106–109`: mapa 12 está em `MAPAS_JOGO`) de uma partida que ele só assistia (registro, linha 40: `fim` em
   `GameStart`, `tela: jogo`). E o coletor tratou a partida assistida como dele: ligou medidor de travadas, voz, minimapa,
   painel na 2ª tela, falou "2 inimigos mortos: torre" (log 20:50:01–20:51:25) e gravou 90 linhas em `ao_vivo` e 13 em
   `eventos_ao_vivo` do `dados\lol.db` (`game_id 3293888206`, fila 2400; não entrou em `partidas`).

Não houve perda do compacto na ranqueada dele nesse horário.

### B. Bug real na ranqueada: "seleção da fila desconhecida" por 1 s no início da seleção (15/10 13:50:26 local)

Registro linha 15: `ChampSelect`, `telaAntes: fila`, `fila: null`, `mapa: null`, 0,96 s até voltar sozinho. A seleção era
a ranqueada dele (medidor: `localPlayerCellId 4`, fila 420).

Causa: `aoFase('ChampSelect')` zera `est.info` (`index.js:747`, "a sessão de antes pode ser de outra fila") e pede
`GET /lol-gameflow/v1/session` (`index.js:940`, `967`). Enquanto não chega, `destinoDaFase` devolve "esperar"
(`index.js:94`) e `aplicar` arma `ESPERA_SESSAO_MS` = 2000 ms (`index.js:55`, `440`). Ao esgotar, o timer põe
`est.info = {lida:true}` **sem fila nem mapa** e o destino vira `index.js:98` → expande. A fase entrou às 13:50:24,2; a
expansão saiu às 13:50:26,3 (2,1 s depois, exatamente o prazo) e voltou às 13:50:27,26, quando a sessão chegou com 420.

Por que o GET demorou: o plugin ficou ~6 s sem resposta da LCU nesse momento. No mesmo minuto o `aceite.js` pediu
`GET /lol-matchmaking/v1/ready-check` às 13:50:21,1 e só registrou a falha às 13:50:27,3 ("releitura falhou ou fora de
InProgress"; a reserva do coletor aceitou às 13:50:22,1). Entrada na seleção = client ocupado.

A fila já era conhecida: no `ReadyCheck` o socket da sessão do gameflow já tinha posto `est.info` com fila 420 e mapa 11
(o `aoSessao` roda em qualquer fase). Zerar na passagem `ReadyCheck → ChampSelect` joga fora uma informação certa (a
seleção que sai de um ready check é sempre da mesma fila).

### C. Ready check: "a contagem do aceite não apareceu: o popup da Riot decide" (3x, 15/10 12:01, 12:36, 12:37)

Regra que decidiu: `index.js:88` com `semContagem()` (`index.js:351`): no `ReadyCheck`, sem o `#lc-aceite` do
`pengu/aceite.js` no `<body>` em `CONTAGEM_MS` (1500 ms), expande para o popup da Riot não ficar sem botão embaixo da
camada. A camada registrada era o popup da Riot (`div.modal` > `fake-ember-application`, título "partida …" =
"PARTIDA ENCONTRADA", botões "aceitar"/"recusar").

Causa medida: nesses 3 ready checks o `aceite.js` **não recebeu nenhum evento** de `/lol-matchmaking/v1/ready-check`
(`aceite.js:241`). No `coletor.log` não há `evento=evento` nem `evento=agendou` do plugin; só o `evento=foco` (que vem do
socket de fase, que funcionava). O medidor, com socket próprio, viu os eventos do ready check normalmente (12:36:38–47).
Sem evento, o `aceite.js` não mostra a contagem; o compacto, corretamente, expandiu. Quem aceitou foi a janelinha do
coletor (12:01:16) e a reserva do coletor (12:36:47, 12:38:05: "último sinal do plugin há 2125 s"). Nas outras
entradas em fila do período (02:23, 02:29, 03:19, 04:12, 04:15, 04:25, 05:25, 13:50 de 15/10 e 12:41 de 16/10) o evento
chegou e nada expandiu. A causa de o socket do plugin perder só essa rota entre ~05:30 e ~13:50 de 15/10 **não foi
medida** (hipótese: inscrição perdida numa recarga/atualização do client nesse intervalo).

O que a tela da Riot tem (`rcp-fe-lol-navigation` 16.20, `2d07c2d59aefa2f7.js` @1141469 e @1142318): botões "aceitar" e
"recusar" = `POST /lol-matchmaking/v1/ready-check/accept` e `.../decline`, sem corpo. É a mesma rota que o `aceite.js`
já usa.

### D. Modal no fim de partida: "atualização de …" e "… de …" (15/10 05:34 e 12:35, `EndOfGame`, ~40 e 61 s)

Camada: `div.modal` > `lol-uikit-full-page-backdrop` + `div.dialog-alert`, botões vazios no registro. Pelos textos pt_BR
do front (`tools/ler-wad.py` em `rcp-fe-lol-social`, arquivo de textos `b2d4d0a32f6e33b7.bin`), os dois títulos casam com
o **aviso de punição de quem você denunciou**: `remedy_received_notification_title_bystander` = "Atualização de feedback"
e `remedy_received_notification_title_reporter` = "Feedback de denúncia" ("feedback" e "denúncia" não estão no
`VOCABULARIO` de `pengu/compacto/expansoes.js`, por isso viraram "…"). Botão único: "GGWP" (`remedy_notification_confirm`,
fora do vocabulário, por isso a lista de botões veio vazia). Corpo: "Aplicamos uma penalidade a **<nome do jogador>** em
uma das suas partidas recentes…" (nome possivelmente ofuscado pela configuração `remedy.obfuscated_player_name`).

Front da Riot (`rcp-fe-lol-social/34f2d9061fb95af6.js` @1361522): observa `/lol-remedy/v1/remedy-notifications` e, no OK,
`PUT /lol-remedy/v1/ack-remedy-notification/{mailId}`. Confiança alta, não total: é a única dupla de títulos do front que
gera exatamente "atualização de …" e "… de …" num `dialog-alert` (o "Atualização de Placar!" dos desafios é toast, não
modal). A etapa 3 abaixo deixa o próximo registro confirmar.

Regra que decidiu: a vigia da regra 7 (`index.js:68`, `.modal`) → `aoModal` → `forcarPorModal` (`index.js:712`) →
`est.forcado` com origem `modal`. O custo real não é o modal: `est.forcado` só zera na próxima virada de destino
(`index.js:312`), então, depois que ele clica "GGWP", o client **fica expandido o resto do pós-jogo** (39,8 s e 60,9 s,
até a fase virar `Lobby`). Na de 12:35 ele chegou a **desligar e religar o compacto** nas configurações no meio (trilha:
"client compacto desligado" a +48 s): sinal de que queria o compacto de volta.

### E. Modal "erro no …" com "ok" (15/10 06:19 local, fase `None`, sem volta)

Dois `dialog-alert` empilhados. Título do front: `vanguard_error_title` = "ERRO NO VANGUARD: VAN {{errorCode}}"
(`rcp-fe-lol-navigation`). No front (`2d07c2d59aefa2f7.js` @1165506), o OK chama `onClose: _shutdownClient`
(`RiotClient.Exit`): **fecha o client**. Expandir é o certo; nada a migrar.

### F. Fim de partida: etapa `challenge-level-up-celebration` (2x, 15/10 12:35 e 14:23, `PreEndOfGame`, 1,8 e 6,1 s)

Regra que decidiu: `index.js:124`: no `PreEndOfGame`, etapa que não é `honor-vote` e ficou `SEQ_FIRME_MS` (600 ms) expande.
Camadas da Riot no instante: nenhuma (`camadas: []`).

Medido: nas duas vezes a etapa passou sozinha para `EndOfGame` (12:34:58 → 12:35:08 e 14:23:03 → 14:23:13 no medidor; a
etapa durou ~2,5 e ~6,7 s), sem clique dele (no 1º caso a janela tinha acabado de crescer). No front, o desafio que sobe
de nível vira uma **vinheta** (`VignetteCelebration`, `rcp-fe-lol-navigation` @1113689: botão "próximo", `timing
INFINITE`) ou um **toast** de desafio; nenhum front posta `/lol-pre-end-of-game/v1/complete/challenge-level-up-celebration`
(só `missions-celebration` tem `complete`, @373036). Ou seja: a etapa avança sozinha pelo servidor e, se a vinheta
aparecer, ela entra em `#lol-uikit-layer-manager-wrapper` como `.vignette-celebration`, que a regra 7 já pega.

## Lista priorizada do que construir (técnico, barato, reversível)

| # | o quê | por quê | tamanho |
| --- | --- | --- | --- |
| 1 | Seleção não pisca por fila "desconhecida" (B e A2) | é o único bug que tira o compacto da ranqueada dele | pequeno |
| 2 | Espectador é tela da Riot do começo ao fim (A1, A3, A5 no plugin) | hoje a partida assistida encolhe para a tela "partida em andamento" e a seleção assistida passa pela tela compacta | pequeno |
| 3 | Registro honesto (A4, D) | sem isso o relatório mistura o automático com o pedido e não nomeia os modais | pequeno |
| 4 | Contagem do aceite sem depender só do socket (C) | 3 de 5 ready checks de 15/10 expandiram por isso | pequeno |
| 5 | Celebração de desafio não expande (F) | evita o 420 → 1280 → 420 de 2–7 s no fim de partida | pequeno |
| 6 | Volta ao compacto quando o modal que expandiu fecha (D) | após o "GGWP" ele fica no client normal o pós-jogo inteiro | médio |
| 7 | Coletor ignora partida assistida (A5 no coletor) | voz, painel e `ao_vivo` de partida que não é dele | médio, card à parte |

### Etapa 1 — seleção sem "fila desconhecida" transitória (`pengu/compacto/index.js`)

1. `aoFase` (`index.js:747`): na passagem **`ReadyCheck → ChampSelect`**, se `est.info.lida` e `est.info.fila` já são
   conhecidos, **manter** `est.info` (mesma partida); zerar só vindo de outra fase (assistir vem de `None`, personalizada
   vem de `Lobby`).
2. Timer `ESPERA_SESSAO_MS` (`index.js:440`): ao esgotar sem sessão, **pedir o GET de novo** uma vez (injetar a leitura
   no roteador como já se faz com `lcu`) e esperar mais `ESPERA_SESSAO_MS`; só então `{lida:true}` sem fila → expande
   (a regra "campo ausente → expandir" continua, só com 4 s em vez de 2 s).
3. `aoSessao` (`index.js:776`): com a fase em `ChampSelect` e `est.info` já lida com fila, **ignorar** sessão que chega
   sem `queue.id` **e** sem `map.id` (a sessão vazia da saída da seleção): quem decide a saída é o evento de fase. Sessão
   com fila **diferente** continua valendo (troca de fila de verdade).
4. Prova: `node tools/teste-compacto.mjs` (ou o teste do roteador que já cobre `destinoDaFase`/`aoSessao`) com três
   casos novos: (a) `ReadyCheck` com sessão 420 → `ChampSelect` sem GET por 3 s = segue na tela da seleção, nenhuma
   expansão no registro; (b) GET que só responde no 2º pedido = sem expansão; (c) em `ChampSelect` 420 compacto, sessão
   vazia e 180 ms depois fase `None` = nenhuma expansão. E o caso antigo: `ChampSelect` vindo de `None` sem sessão nenhuma
   por 4 s = expande com "seleção da fila desconhecida".
5. Reverte: `git revert` do commit; as três mudanças são independentes.

### Etapa 2 — espectador (`pengu/compacto/index.js`, `tela-champselect.js`; medidor)

1. **Medir antes de presumir** (só GET, client real): estender `tools/medir-compacto.py` para gravar, na entrada de
   `ChampSelect` e de `GameStart`, `isSpectating` da `/lol-champ-select/v1/session` e **só as chaves** (sem valores) de
   `gameData` e `gameClient` do `/lol-gameflow/v1/session`. Serve para achar, na próxima vez que ele assistir, um campo do
   gameflow que diga "espectador" (a premissa abaixo usa só o `isSpectating`, já provado indiretamente em A3).
2. Roteador: observar `/lol-champ-select/v1/session` (só leitura, como a tela já faz) e guardar
   `est.assistindo = s.isSpectating === true` na fase `ChampSelect`. **Nunca** usar `localPlayerCellId === -1` sozinho
   como sinal (pode aparecer no início de uma seleção real ainda sem sessão: tiraria a ranqueada).
3. `destinoDaFase`: com `info.assistindo`, `ChampSelect` → `expandir` com motivo "assistindo a uma partida: tela da Riot"
   (antes das regras de mapa/fila); `GameStart`/`InProgress`/`Reconnect` → `{tipo:'jogo'}` (client normal embaixo do
   jogo, como TFT/Arena); `WaitingForStats`/`PreEndOfGame`/`EndOfGame` → `expandir`. `est.assistindo` zera em `None`,
   `Lobby` e `Matchmaking`.
4. `tela-champselect.js:735–736`: o ramo `isSpectating` deixa de chamar `ctx.expandir()` (que vira "por-ele"); o roteador
   já expandiu. Banco (`benchEnabled`) e fila 450 seguem como estão (decisão do plano do compacto), mas a saída deles
   também deve sair como automática: usar uma saída de tela "cede à Riot" que passe por `forcar(motivo, 'tela-sozinha')`
   + `resolver()`, não por `expandirPorTi`.
5. Corrigir o comentário de `index.js:105` ("Espectador já é outra fase (WatchInProgress)"): medido em 16/10 que não é.
6. Texto: rodar `node tools/teste-textos.mjs` (motivo novo).
7. Prova: casos no teste do roteador e em `tools/teste-compacto-selecao.mjs`: sessão `isSpectating:true` com fila 420/11 =
   expande na hora, origem `fase`, sem montar a tela; depois `GameStart` mapa 12 = client normal (nada de `tela: jogo`);
   `None` zera. Ranqueada normal (`isSpectating:false`, `localPlayerCellId 4`) segue compacta em toda a sequência.
8. Reverte: `git revert`; sem o sinal, volta ao comportamento de hoje.

### Etapa 3 — registro das expansões honesto (`index.js`, `expansoes.js`, `tools/relatorio-expansoes.py`)

1. Gesto: guardar o instante do clique/tecla (não só "há quanto tempo") e, em `notarExpansao` (`index.js:401–406`), contar
   o pedido de uma tela como dele só se o gesto for **depois da montagem dessa tela** (gravar `desde` em `montarTela`,
   `index.js:590`) **e** dentro da camada do compacto (`event.target` contido na raiz da camada no `pointerdown`/`keydown`
   de `index.js:987`). Sem isso: `tela-sozinha`.
2. `VOCABULARIO` (`expansoes.js:12`): acrescentar palavras de interface que apareceram e não são nome: `feedback denuncia
   denuncias ggwp placar vanguard`. Reverte tirando da lista (decisão xvii do plano do compacto: amplia lista, nunca texto
   livre).
3. `tools/relatorio-expansoes.py`: listar também os motivos da `trilha` (o que pediria expansão enquanto ela já estava de
   pé), num bloco "também apareceram durante expansões pedidas por você". Foi assim que o caso A ficou escondido em
   "pedidas por ele".
4. Prova: `node tools/teste-compacto-expansoes.mjs` (clique fora da camada há 700 ms + tela que expande sozinha =
   `tela-sozinha`; clique no botão da tela = `por-ele`) e `python tools/teste-expansoes.py` (trilha no relatório).
5. Doc: `docs/COLETOR.md` § Registro das expansões (regra do gesto e o bloco novo do relatório).

### Etapa 4 — contagem do aceite sem depender só do socket (`pengu/aceite.js`)

1. Em `iniciarAceite`, no evento de fase `ReadyCheck` (o socket de fase funcionou nos 3 casos), fazer
   `GET /lol-matchmaking/v1/ready-check` e chamar `avaliar(payload)`; repetir a cada 1 s enquanto a fase for `ReadyCheck`
   e não houver `agendado`/`aceitando` (máx. 12 leituras). `avaliar` já é idempotente (`if (agendado) return`).
2. Diagnóstico: `diag('evento', {origem:'get'})` para o log dizer quando foi o GET que salvou.
3. O compacto **não muda**: sem contagem em 1,5 s, segue expandindo (a regra protege o caso "aceite.js morto").
4. Prova: `node tools/teste-aceite.mjs` com socket mudo + GET respondendo `InProgress` = contagem aparece e aceita no alvo;
   GET `Accepted` = não agenda. Nada de POST contra o client real (só LCU falsa, `tools/lcu-falsa.mjs`).
5. Reverte: `git revert`.

### Etapa 5 — celebração de desafio não expande (`index.js`, `destinoDaFase`)

1. Constantes novas: `SEQ_SOZINHAS = ['challenge-level-up-celebration']` e `ESPERA_CELEBRACAO_MS = 10000` (medido: a etapa
   passa sozinha em 2,5–6,7 s).
2. `PreEndOfGame` com etapa em `SEQ_SOZINHAS`: `esperar` (fica na tela de antes, a da honra, sem expandir) até
   `ESPERA_CELEBRACAO_MS`; esgotou = expande como hoje. Agendar o `resolver()` no prazo (como `agendarSeq`).
3. A vinheta com botão ("próximo") continua coberta pela regra 7: `.vignette-celebration` e `.dialog-toast-celebration`
   estão em `MODAIS.gatilho` → expande. `missions-celebration` (o front posta `complete` depois da escolha de recompensa)
   e `ranked-celebration` (promoção) **continuam expandindo**.
4. Prova: teste do roteador: `honor-vote` → `challenge-level-up-celebration` 3 s → `EndOfGame` = nenhuma expansão;
   etapa parada 10 s = expande; vinheta na vigia durante a etapa = expande na hora.
5. Reverte: tirar o nome de `SEQ_SOZINHAS`.

### Etapa 6 — voltar ao compacto quando o modal que expandiu fechar (`index.js`, vigia)

1. A vigia (`criarVigiaModais`, `index.js:178`) passa a avisar também quando **não há mais** camada que a regra 7 expandiria
   (`aoSemModal`).
2. No roteador: se `est.forcadoTipo === 'modal'`, sem `est.override` dele no meio, e nenhuma camada da regra 7 por
   1500 ms, zerar `est.forcado` e `resolver()` (volta para a tela do destino; o registro fecha com `como: automático`).
   Dois modais em sequência (o Vanguard abriu 2) não piscam: o prazo cobre a troca.
3. Não vale para o ready check (tem regra própria) nem para `config-riot` (já tem volta própria).
4. Prova: teste do roteador: `EndOfGame` compacto → modal → expande → modal some → 1,5 s → compacto; modal some e outro
   abre em 300 ms → fica expandido; ele expandiu pelo botão no meio → não volta sozinho.
5. Reverte: `git revert`; a regra 7 volta a valer "até a virada de destino".

### Etapa 7 — coletor ignora partida assistida (card à parte, fora do compacto)

O coletor já pula o champ select com `isSpectating` (`coletor/coletor.py:334`), mas ligou coach, voz, painel e medidor
de travadas no `InProgress` da partida assistida e gravou `ao_vivo`/`eventos_ao_vivo`. Proposta: guardar o
`isSpectating` da seleção e, no `InProgress` seguinte, não ligar `coach_vivo`/`travadas`/painel; reserva independente:
a Live Client em modo espectador (medir `/liveclientdata/activeplayer` numa partida assistida antes de usar). Prova com
`python tools/ensaio-coach.py`. Tem regras próprias (coach, vigia, porta 8765): vira card próprio, não entra nas etapas
1–6.

## O que deixar como está, e por quê

- **Erro do Vanguard (E):** o OK fecha o client. Expandir é o certo.
- **Popup do ready check quando o `aceite.js` não está vivo (C):** continua expandindo. Uma tela compacta própria com
  "aceitar"/"recusar" (`POST .../ready-check/accept|decline`, só clique dele) é possível, mas precisa conversar com a
  reserva do coletor (o "recusar" tem de chegar ao coletor antes da reserva aceitar). Só se, depois da etapa 4, voltar a
  acontecer.
- **Conteúdo do aviso de punição (D) dentro do compacto:** não agora. Traz o nome de outro jogador e aparece pouco
  (2 vezes em 3 dias). A etapa 6 resolve o custo real (ficar expandido depois do "GGWP").
- **Seleção e partida assistidas (A):** são telas da Riot (contagem do espectador, botão de parar de assistir). Etapa 2
  só faz o compacto sair do caminho do jeito certo.
- **ARAM e seleção com banco:** decisão do plano do compacto; fora deste plano.

## Decisões técnicas (confiança e o que reverteria)

1. Espectador pelo `isSpectating` da sessão da seleção, nunca por `localPlayerCellId -1` sozinho. Confiança média-alta
   (o `isSpectating` disparou o aviso em 16/10; o valor não foi gravado pelo medidor). Reverte: a medição da etapa 2.1
   mostrar outro campo melhor ou o `isSpectating` ausente.
2. Manter a fila do ready check na entrada da seleção. Confiança alta (mesma partida por construção). Reverte: um registro
   de seleção com fila diferente da do ready check.
3. Etapas 5 e 6 mudam a regra "lembrar o modo até a virada de destino" só para dois casos medidos. Reverte: registro com
   expansão que volta e sai de novo em menos de 3 s (flip-flop).

## O que o pedido não dizia

- O caso "grave" não era bug na ranqueada; o bug real na ranqueada é outro (B), menor, e entra primeiro.
- O coletor fala e grava em partida assistida (etapa 7): achado lateral, vira card próprio.
- Pegadinha de fuso entre registro (UTC) e medidor (local): entra na `ARMADILHAS.md` § Client junto com "assistir entra
  em `ChampSelect`/`InProgress`" e "a sessão do gameflow esvazia ~150 ms antes da fase sair da seleção" quando a etapa 1
  ou 2 fechar.
