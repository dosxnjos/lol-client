# Relatório de execução — telas que tiram o compacto (etapas 1–6, 17/10/2026)

Plano: [2026-10-17-telas-que-expandem.md](../2026-10-17-telas-que-expandem.md). Tudo provado offline (LCU falsa, relógio falso,
DOM falso); nada de escrita contra o client real. Etapa 7 (coletor ignora partida assistida) segue como card à parte.

## O que cada etapa virou

- **1 (fila desconhecida na ranqueada):** `aoFase` mantém `est.info` na passagem `ReadyCheck → ChampSelect`; `esgotouSessao` relê
  `GET /lol-gameflow/v1/session` uma vez no 1º prazo e só expande no 2º (4 s); `aoSessao` ignora sessão sem fila nem mapa em
  `ChampSelect` com fila já lida. Prova: `teste-compacto.mjs` § 4b (reconstrução de 15/10 13:50; 5 casos falham no código anterior).
- **2 (espectador):** `aoSelecao(s)` no roteador (só `isSpectating` booleano; nunca `localPlayerCellId -1`), `info.assistindo` no
  `destinoDaFase` (seleção e fim expandem, partida = client normal embaixo do jogo), zera em None/Lobby/Matchmaking/ReadyCheck;
  `iniciarCompacto` observa e lê (GET) `/lol-champ-select/v1/session` na entrada da seleção, sem segurar a tela. `ctx.ceder(motivo)`
  novo; `tela-champselect` cede por ele (banco, 450, espectador). Medidor: `isSpectating` em `sessao_cs` e `gameflow_chaves` (só nomes
  de `gameData`/`gameClient`) em ChampSelect/GameStart/InProgress. Provas: `teste-compacto-expansoes.mjs` § 3b (16/10 20:48–20:51),
  `teste-compacto-selecao.mjs` (ARAM e espectador cedem), `teste-compacto.mjs` (destinos), `teste-medir-compacto.py`.
- **3 (registro honesto):** gesto só conta dentro do `#lc-compacto` e depois de a tela montar (`medirGesto`, `gestoDentro`,
  `est.telaDesde`); evento leva `gestoAntesDaTela`/`gestoForaDaCamada` (o `coletor/expansoes.py` saneia os dois). Vocabulário +
  feedback, denuncia, denuncias, ggwp, placar, vanguard. Relatório: `reclassificar` (o "por-ele" de tela gravado antes, com clique
  anterior a um `fim`, vira `tela-sozinha`, marcado `reclassificado`) e o bloco da trilha. Provas: `teste-compacto-expansoes.mjs`
  § 1, § 7; `teste-expansoes.py` D8–D10. No registro real, o evento `mvbmby7o-5` (16/10 20:48) sai reclassificado.
- **4 (ready check sem socket):** `criarReleituraRC` no `aceite.js` (GET já e a cada 1 s na fase `ReadyCheck`, até 12, para com
  contagem/aceite/"não aceitar"/fim da fase; GET que falha nunca vira `avaliar(null)`); diag `origem=get` (`CAMPOS_DIAG` do coletor).
  Prova: `teste-aceite.mjs` (releitura).
- **5 (celebração de desafio):** `SEQ_SOZINHAS` + `ESPERA_CELEBRACAO_MS` (10 s); `alvo()` com `esperar` e `est.forcado` expande na
  hora (antes a espera ignorava a regra 7, o erro de tela e as Configurações). Prova: `teste-compacto.mjs` (15/10, parada 10 s,
  vinheta, missions-celebration).
- **6 (volta ao compacto):** `forcar(..., 'modal')` arma uma releitura de `modalAberto()` a cada 250 ms; 1,5 s sem camada da regra 7
  = zera o forcado e volta (`como: "a janela da Riot fechou"`). Fora do ready check, com ⤢ dele no meio ou outro motivo. Prova:
  `teste-compacto-expansoes.mjs` § 2b.

## Decisões técnicas

1. Etapa 6 por releitura do `modalAberto()` (a mesma `vigia.aberto()`), não por callback novo da vigia: o observador da vigia só vê
   nós adicionados e o modal pode sumir só de vista (`getClientRects`). Confiança alta; reverte voltando ao callback se a releitura
   pesar (250 ms, só DOM).
2. Etapa 1 com 2 prazos (4 s) em vez de 1: mantém "campo ausente = expandir", só mais paciente. Reverte com expansão tardia
   medida numa seleção que não é SR.
3. Reclassificação no relatório (lado leitura), não reescrita do jsonl: o dado gravado fica como veio.

## Limites conhecidos

- Volta da etapa 6 durante um `esperar` (seleção esperando a sessão, janela de 10 s da celebração): o forcado zera mas a janela só
  volta na próxima virada de destino (a espera não mexe na janela). Raro; a próxima fase resolve.
- Plugin recarregado no meio de uma partida assistida: a seleção já passou, `isSpectating` não é lido e a tela "partida em
  andamento" aparece (como antes).

## O que só o client real prova

- A próxima ranqueada sem expansão na entrada da seleção, mesmo com o GET lento.
- Uma partida assistida: expansão com origem `fase`, motivo "assistindo…", sem `tela: jogo`; e a linha `gameflow_chaves` do medidor.
- O próximo aviso de punição voltar ao compacto 1,5 s depois do GGWP, com título/botão nomeados no registro.
- Um ready check com o socket mudo mostrando a contagem (`origem=get` no `coletor.log`).
- A celebração de desafio passando sem 1280.

Nada disso vale antes de: recarregar a interface do client (plugin; só em None/Lobby), reiniciar o coletor (`gestoAntesDaTela`/
`gestoForaDaCamada` e `origem=get`) e reiniciar o medidor (`isSpectating`/`gameflow_chaves`).

## D1 e D2 (decisões do orquestrador, 17/10/2026 noite)

### D1 — a seleção assistida não pisca mais (`pengu/compacto/index.js`)

- `aoFase('ChampSelect')` vinda de `None`/`Lobby` (sem `ReadyCheck`) e sem espectador já sabido arma `est.esperaSelecao` +
  `ESPERA_SELECAO_MS` (1000 ms); `destinoDaFase` devolve `esperar` ("conferindo se é uma partida assistida") enquanto isso, então a
  tela de antes (lobby) fica e a da seleção não monta. Qualquer `isSpectating` booleano em `aoSelecao` solta a espera (também o
  `false` da personalizada: antes o retorno cedo de "nada mudou" a prenderia até o prazo). Prazo esgotado = regra de antes. Sai da
  seleção = espera zera. O prazo da sessão do gameflow (`timerSessao`) só arma sem a sessão lida.
- Medição da personalizada: no medidor de 14–15/10, as 5 entradas `Lobby → ChampSelect` (treino) tiveram a sessão da seleção gravada
  41, 56, 48, 91 e 69 ms depois da fase (o medidor faz GETs em série; o plugin pede a sessão da seleção por GET e evento já na fase,
  em paralelo). No teste com os tempos de 15/10 02:23:58 a tela monta em 69 ms, contra 28 ms antes (quando chegava a sessão do
  gameflow): +41 ms, e a tela já mostrava "lendo a seleção…" até essa mesma sessão. Pior caso (client ocupado): 1 s, e monta.
- Prova: `teste-compacto-expansoes.mjs` § 3b (reconstrução de 16/10 20:48:19 com os ms do medidor: falha no código anterior, a tela
  da seleção montava) e § 3c (personalizada 69 ms, prazo de 1 s, ranqueada sem espera mesmo sem a sessão da seleção, sessão antes da
  fase, espera que não vaza). Casos antigos que entravam na seleção pelo `Lobby` ganharam o `aoSelecao({isSpectating:false})` real
  (`teste-compacto.mjs`, `teste-compacto-lateral.mjs`, `teste-compacto-expansoes.mjs` § 2c e o classificador do § 7, que agora
  espera o prazo).

### D2 — coletor em partida assistida (`coletor/coletor.py`, `coach_vivo.py`, `ao_vivo.py`)

- **Sinal escolhido: `isSpectating` da `/lol-champ-select/v1/session`** (o coletor já assina o evento). Evidência: nas 3 seleções
  assistidas de 16/10 o `coletor.log` não tem "champ select final" nem "desfeito" (o `RetratoChampSelect.sessao` só pula sessão
  que não é dict ou com `isSpectating`), enquanto toda ranqueada dele tem; e a tela da seleção do plugin cedeu pelo ramo
  `isSpectating` (registro de 16/10, A3). `gameData`/`playerChampionSelections` do gameflow: não medidos (o medidor ainda não
  gravou `gameflow_chaves` numa assistida), então não usados.
- **Reserva: Live Client sem jogador ativo.** Medido no `dados\lol.db`: 2 partidas assistidas (3292972402 de 13/10, que também era
  assistida: fora de `partidas`, entrou de `None`, saiu `WaitingForStats → None` sem `EndOfGame`, 1ª amostra aos 241 s de jogo; e
  3293888206) com `eu` = 0 em todas as 51 amostras; as 18 partidas dele têm exatamente 1 `eu` por amostra, inclusive 3293149183
  (coletor religado aos 80 s). Uso: 5 leituras seguidas em jogo (`SEM_EU_LEITURAS`; nunca no carregamento) desligam o coach e marcam
  o gameId; o `ao_vivo.py` só grava `ao_vivo`/`eventos_ao_vivo` depois de ver o jogador ativo uma vez (os eventos esperam em memória
  e saem inteiros). Na granularidade de 1 s (a do gatilho): a única gravação leitura a leitura de uma partida dele
  (`temp\gravacao\20261013-071040\live.jsonl`, 2007 leituras em jogo) não tem nenhuma leitura sem o jogador ativo (maior sequência 0).
- Limite: com a seleção não vista (coletor religado no meio da partida assistida), o medidor de travadas já saiu no 1º `InProgress`
  e segue até o jogo fechar (a reserva não o para); e a reserva é irreversível na partida (o gameId fica em `Coach.assistidas` até o
  coletor reiniciar).
- O que virou: `Coletor.assistindo` (liga pelo `isSpectating`, ignora Update atrasado nas fases de jogo, zera em
  None/Lobby/Matchmaking/ReadyCheck); fase de jogo assistida = log "(partida N, assistida)", sem medidor de travadas, sem retrato
  nem draft do coach, sem `ligar_game_id`, sem busca no histórico, e `coach.fase(..., assistida=True)` (encerra o que houver, fecha o
  painel, marca o gameId; `Reconnect`/`InProgress` repetido da mesma partida também não liga). `_Partida.assistida` não grava
  `previsoes_jungler`.
- Prova: `tools/teste-assistida.py` (12 casos; no código anterior 10 falham): Coletor real com LCU falsa reconstruindo 16/10
  20:45–20:51 + controle da ranqueada dele logo depois; coach com `assistida`; reserva (3292972402) com controles de carregamento e
  da 3293149183; laço `AoVivo` com Live Client falsa (nada gravado sem jogador ativo; a dele grava amostras e eventos). Entrou no
  `rodar-testes.py`.

### Bateria (17/10 noite, LoL fechado)

`rodar-testes.py .mjs teste-assistida teste-champselect teste-mcp teste-coach.py teste-banco`: 32/32 (todas as `.mjs` do plugin;
`teste-compacto` 188/188, `teste-compacto-expansoes` 66/66, `teste-compacto-selecao` 262/262, `teste-textos` 9/9). Fora, por porta
proibida nesta rodada: `ensaio-coach.py` (8766/2996) e `teste-expansoes.py` (8798; não tocado).

### Limpeza proposta (decisão do Gabriel; nada apagado)

Linhas já gravadas das partidas assistidas em `dados\lol.db`: 3293888206 = 90 `ao_vivo` + 13 `eventos_ao_vivo`; 3292972402 = 420
`ao_vivo` + 22 `eventos_ao_vivo` + 18 `previsoes_jungler`. Nenhuma das duas está em `partidas`, `champ_select` nem
`revisoes_jungler`; `sessoes` tem 3 linhas de fase de cada (log de fases, ninguém lê com game_id). Proposta: com o coletor de pé,
`banco.backup(c, "dados/backup/lol-antes-limpeza-assistidas.db")` e depois `delete from ao_vivo|eventos_ao_vivo|previsoes_jungler
where game_id in (3293888206, 3292972402)`.

### O que só o client real prova (D1 e D2)

- Assistir a um amigo com o compacto ligado: sem a tela da seleção piscando; o `LeagueClientUx.log` sem "tela champselect" nessa
  entrada. E a próxima personalizada montando a seleção sem atraso perceptível.
- No coletor: "seleção: partida assistida" e "fase InProgress (partida N, assistida)" no log, nenhuma linha de voz/painel/medidor e
  nada novo em `ao_vivo` para o gameId; numa partida dele, tudo como antes.
- A reserva só se vê com o coletor religado no meio de uma partida assistida ("sem o jogador ativo na Live Client por 5 leituras").
- Vale depois de recarregar o plugin (só em None/Lobby) e reiniciar o coletor.

## Revisão adversarial de D1 e D2 (17/10/2026 noite)

Procurado: partida dele classificada como assistida (ranqueada, Reconnect, personalizada, treino, ARAM, TFT), atraso na seleção dele,
sinal de espectador que some no meio da partida, regressão no aceite, no compacto e no coach ao vivo.

**Achado e corrigido: a reserva da Live Client podia calar a ranqueada dele.** `_ao_ler` desligava coach, voz, painel e overlay em
qualquer partida com 5 leituras em jogo sem o jogador ativo, e marcava o gameId para nada religar, sem olhar se o coletor já sabia
que a partida era dele. O `eu` depende de o `riotId` do `activePlayer` casar com o de `allPlayers`; um patch da Riot que mude esse
formato (ou um objeto de erro no `activePlayer`) calaria toda ranqueada no 5º segundo, e o `ao_vivo` deixaria de gravar a partida
inteira. Correção:

- `Coletor.assistindo` virou três estados: True (assistida), False (dele: seleção com `isSpectating` false, ou passou por
  `Matchmaking`/`ReadyCheck`, que o espectador não usa), None (não sei: depois de `None`/`Lobby`, ou coletor religado no meio).
  `Coletor.proprias` guarda o gameId sabido dele (o `Reconnect` depois de um `None` de client reaberto segue dele).
- Partida sabida dele chega como `coach.fase(..., propria=True)` → `_Partida.propria`: a reserva nunca vale nela, e
  `AoVivo.iniciar(..., exigir_eu=False)` grava sem esperar o jogador ativo. `Reconnect` sabido dele desarma a reserva na partida já
  ligada. A reserva fica só para o coletor religado no meio da partida (o caso para que ela existe).
- Prova: `tools/teste-assistida.py` 20/20 (8 casos novos). Contra o código de antes de D1/D2, 5/20; os casos novos da revisão
  falham todos (sem `propria` no coach nem `exigir_eu` no ao vivo, a reserva cala a partida dele).

**Conferido sem achado:**
- Sinal que some no meio: `marcar_assistindo` ignora `Update` nas fases de jogo; websocket reconectado relê a fase com o estado do
  coletor intacto; só `None`/`Lobby` zeram.
- Partida dele como assistida pelo sinal principal: a seleção dele manda `isSpectating` false (volta para False), a busca e o ready
  check põem False; nenhum caminho dele pula `Lobby` entre uma assistida e a dele.
- Plugin (D1): ranqueada e normal saem do `ReadyCheck` e nunca esperam; a ordem trocada (sessão da seleção antes da fase) já tem caso
  em `teste-compacto-expansoes.mjs` § 3c; a espera não vaza para a entrada seguinte. Teto: personalizada com o GET da seleção em 404
  e nenhum `Update` em 1 s monta com 1 s de atraso (regra de antes), medido 41–91 ms nas 8 entradas reais.
- `eog-stats-block` não chegou nas 2 assistidas (`coletor.log` sem "eog gravado" em 13/10 22:13 e 16/10 20:51): `buscar_partida`
  não roda nelas. O `limpar_live` passa o `activePlayer` e `allPlayers` pelo mesmo mapa (riotId, riotIdGameName, summonerName).
- Aceite: D2 não toca `aviso_partida` nem o ready check; `teste-aceite.mjs` 50/50.

**Bateria (LoL fechado):** `rodar-testes.py .mjs teste-assistida teste-champselect teste-mcp teste-coach.py teste-banco teste-vitrine
teste-medir-compacto`: 34/34. Fora, por porta: `ensaio-coach.py` (8766/2996), `teste-expansoes.py` (8798, fora da faixa liberada),
`teste-aviso-partida.py` (8797), `teste-chat-janelas.py`, `teste-vida.py`, `teste-vigia.py` (8765/8766/8799/2998).

Regra da casa: as 4 substituições da D1 em `tools/teste-compacto.mjs` foram feitas por heredoc Python (não pelo Edit) na sessão de
construção; o diff confere e foi commitado como está.
