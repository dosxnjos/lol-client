# Plano — lol-client v2: coach (champ select, matchups, pós-jogo, ao vivo, minimapa) (2026-10-13)

Pedido: lol-client-v2-coach | o lol-client vira um coach pessoal: pós-jogo com painéis e lições, painel ao vivo na 2ª tela, previsão do jungler | de: gabriel | desde: 2026-10-13 | origem: chat

## Para validar ao vivo com o Gabriel (fechamento, 13/10/2026)

Tudo abaixo passou offline (`rodar-testes.py` 27/27, ensaio ponta a ponta); nada rodou numa partida com o
código novo. Roteiro, nesta ordem:

1. **Antes**: com o client em `Lobby`, `schtasks /end /tn lol-client-coletor` e `/run` (o coletor de pé roda o
   código antigo, sem a 8765). Conferir "Coach: coletor" ligado em Configurações › LOL-CLIENT.
2. **Modo treino (fila 3140, ~5 min)**: painel abre no `DISPLAY1` e fecha no fim (11); o Gabriel **ouve** a voz
   (12); moldura só com o jogo na frente (15c); F8 liga e desliga o overlay e ele cai em cima do minimapa (15b:
   conferir no olho ou foto do celular, porque o overlay sai do print por `WDA_EXCLUDEFROMCAPTURE`); F9 + 1..5
   marca o Flash e o chip aparece no painel (15e).
3. **Uma normal (fila 400) numa rota** (na gravada ele era o jungler: gank nunca disparou): selo com inimigo
   de verdade (17), os 10 na tela de carregamento (18), avisos de gank e intruso (15), e clicar no feitiço do
   inimigo no TAB depois que ele usar, para juntar ≥ 10 pings no chat (15e; o `chat/` do gravador segue no
   canto errado, a prova lê `telas/`).
4. **Depois**: pós-jogo com 6 abas, mentor pronto sozinho (chamado pela tarefa agendada, passo 20) e uma
   pergunta pela caixa; `GET 127.0.0.1:8765/revisao/<gameId>` com a precisão do jungler (15f.3).

Lacunas técnicas antes do passo 15: `tools/avaliar-gank.py` (a prova dele) não existe e o aviso de gank não
fica gravado em lugar nenhum (o motor não loga as falas), então hoje não há como medir precisão depois da
partida; gravar os avisos publicados (tabela ou log) e escrever o avaliador. Fora do ao vivo: 15d (ouro/xp por
campo e OCR dos timers, ou descarte registrado), resumo do carregamento no client (18) e atalho de resumo ao
vivo do mentor (20).

## Contexto (ler antes de começar)

- **v1** (base deste plano): [2026-10-13-lol-client-v1.md](2026-10-13-lol-client-v1.md): plugin
  Pengu, coletor SQLite com gatilho 4688, pós-jogo v1, MCP, seção nas Configurações (7b),
  winrate no champ select (7c), runas (7d). Ler o "Contexto" de lá: lockfile, LCU, Pengu, `tools/cdp.mjs`.
- Docs do projeto: [ARMADILHAS](../docs/ARMADILHAS.md) (muitas pegadinhas medidas em 13/10),
  [INSIGHTS](../docs/INSIGHTS.md) (dona das heurísticas: regiões, adversário por posição,
  mortes, diffs), [COLETOR](../docs/COLETOR.md) (banco, ciclo de vida, segurança).
- Hub: [cerebro/projetos/lol-client.md](../../cerebro/projetos/lol-client.md).
- Máquina (medido 13/10/2026): 2 monitores, `DISPLAY2` principal 2560×1080 (lógico 2048×864,
  escala 125%) e `DISPLAY1` secundário 1920×1200 (lógico 1536×960, em x=2048, y=476). Jogo em
  `WindowMode=2` (sem borda) 2560×1080, `MinimapScale=2.46`, `FlipMiniMap=0` (mapa à direita),
  `MinimapEnableAllTimers=1`. Python 3.14 com `cv2` 4.13 e `numpy`; **sem `mss`** (instalar:
  `python -m pip install --user mss`). Voz pt-BR do Windows: "Microsoft Maria Desktop" (System.Speech).
- Números reais do banco (172 partidas do Rift, 13/10/2026): ouro aos 10 +500 → 70% de
  vitórias, −500 → 41%; 0 mortes antes dos 10 → 70%, 2+ → 43% (55% das partidas); metade das
  mortes no lado inimigo, 48% sem aliado perto; 51% seguidas de objetivo inimigo em 90 s;
  00–06h 47% contra 12–18h 60%.

## Referências de mercado (13/10/2026, enviadas pelo Gabriel)

Mesma abordagem que este plano (minimapa por visão computacional + API local da Riot + voz, sem
memória nem injeção), o que valida o caminho:

- [Wardian](https://wardian.cc/pt/) (grátis, Windows): lê só os pixels do minimapa e fala
  "Jungler top!", "Gank bot!", "Jungler sumiu", "Mid sumiu" (laner que saiu da rota e não
  reapareceu), aviso 1 min antes de cada dragão e de ouro guardado ≥ 2000. Diz que não adivinha
  o que está na fog. Roda abaixo da prioridade do processo do LoL.
- [Absol](https://absol.lol/) (R$ 15/mês, vendas pausadas): voz com dois tons ("tryhard" e
  "for fun"), alerta de inimigo fed para evitar 1x1, jungler visto, timers de dragão, arauto,
  vastilarvas e barão, painel com calendário de resultados, LP e farm por minuto.
- [Scoutr](https://scoutr.gg/): minimapa a ~6 fps (HSV + calibração por campeão), mapa de
  calor e previsão do jungler, voz local, perguntas por voz durante a partida.

Ideias absorvidas (passos 12 e 14): "laner sumiu", ouro guardado para voltar à base, dois tons
de voz, prioridade de CPU abaixo do jogo.

## Entendimento do pedido

O Gabriel quer que o projeto vire **um coach pessoal**:

1. **Pós-jogo**: popup com vários painéis visuais e textos prontos, escolhidos por condições sobre o
   desempenho dele em cada ponto (fase de rota, mortes, objetivos, tendência, sessão).
2. **Painel ao vivo na 2ª tela**: dados ao vivo da partida, para o campeão dele e para o
   jogo (aliado a ajudar, inimigo forte, movimento no mapa, objetivo, item a comprar por causa do
   estado da partida). **Clareza acima de tudo**: decisão rápida, pouca leitura, sem bagunça.
3. **Retrato do champ select + matchups** (proposto por mim, aceito).
4. Previsão de onde o jungler inimigo está, pelo tempo dele na fog (inspirado num app
   que ele viu; o mais parecido achado é o Scoutr: visão computacional no minimapa).

Autorização explícita do Gabriel (13/10/2026): "pode fazer tudo, até o que a riot não
aprova. O projeto vai ser uma espécie de coach meu". O risco de conta é dele.

## O que o pedido não dizia

Feito (marcado `+`):

- **+ Linha que não se cruza** (decisão do agente, mantida mesmo com a autorização): nada lê
  memória do jogo, injeta no processo, automatiza tecla ou clique, ou revela informação que o
  jogador não tem (fog, cooldown inimigo escondido, ward invisível). Tudo sai de: tela que ele vê,
  Live Client Data API, LCU e o histórico dele. Motivo: isso é trapaça contra os outros 9
  jogadores e é exatamente o que o Vanguard detecta. "Dar ordem" ("vai pro dragão", "compra
  tal item") a Riot não aprova para produtos, mas não é informação escondida: entra.
- **+ Amostragem ao vivo grava no banco**: o painel ao vivo lê a Live Client a cada 1 s, e o
  coletor guarda uma amostra a cada 10 s. Isso deixa o pós-jogo mais fino que o frame de 1
  min da timeline (itens, KDA, nível, ouro estimado por momento).
- **+ Regras de texto num arquivo dono** (`docs/LICOES.md`): condição, prioridade e frase.
  Pós-jogo e ao vivo leem do mesmo lugar; ajustar o tom é editar texto, não código.
- **+ Anti-spam ao vivo**: cada aviso tem prioridade, validade e intervalo mínimo; no máximo 1
  aviso de voz a cada 20 s, fora o de gank (e o alerta de posição depois de fala informativa: refinamento no I1).
- **+ Matchup só com n ≥ 3**; abaixo disso mostra o n e "pouca amostra", sem conclusão.

Proposto (depende do Gabriel):

- Overlay transparente por cima do jogo (sem injeção: janela sempre-no-topo, que ignora clique),
  depois que a 2ª tela estiver boa. Começar pela 2ª tela é mais seguro e mais legível.

Descartado: ler a memória do jogo e mostrar inimigo na fog (trapaça e ban).

## O que NÃO muda (guardrails)

- Os guardrails da v1 valem (nunca buscar fila em teste, recarga só em `None`/`Lobby`,
  credencial fora de arquivo).
- Nenhum acesso ao processo do jogo (`League of Legends.exe`): sem `OpenProcess` de leitura,
  sem hook, sem DLL. Captura de tela pelo Windows (como print), nada mais.
- Nunca enviar tecla ou clique ao jogo.
- O coletor continua **só** existindo com o client aberto (+ 10 min).

## Abordagem / arquitetura

```
coletor\coletor.py   + champ select (retrato no fim da seleção)
                     + laço ao vivo durante InProgress: Live Client 1 s -> estado em memória,
                       amostra a cada 10 s -> tabela ao_vivo; servidor HTTP local 127.0.0.1:8765
coletor\coach.py     motor de lições: lê docs/LICOES.md (regras) + estado -> lista priorizada
coletor\minimapa.py  captura do minimapa (mss) + detecção de ícones (cv2) -> últimas posições vistas
coletor\jungler.py   previsão do jungler inimigo (última vez visto + eventos globais + rotas de selva)
coletor\voz.py       fala pt-BR (System.Speech, voz Maria), fila com prioridade e intervalo
painel\              página da 2ª tela (HTML/CSS/JS sem build), servida pelo coletor
pengu\posjogo\       pós-jogo v2: abas + lições
mcp\servidor.py      + matchups(), champ_select(), sessao_hoje()
```

- **Live Client Data API**: `https://127.0.0.1:2999/liveclientdata/allgamedata` (TLS sem
  verificação, sem auth, só durante a partida): `activePlayer`, `allPlayers[]` (campeão, time,
  posição, nível, itens, placar KDA/farm, morto e tempo de renascer), `events.Events[]`
  (ChampionKill, DragonKill, HeraldKill, BaronKill, TurretKilled, InhibKilled…), `gameData.gameTime`.
- **Ouro estimado** = soma do preço total dos itens (`GET /lol-game-data/assets/v1/items.json`
  da LCU, campo `priceTotal`, guardado em cache no início da partida).
- **Painel da 2ª tela**: o coletor abre `msedge --app=http://127.0.0.1:8765 --window-position=2560,595`
  (ajustar pela posição do `DISPLAY1` em px físicos) quando a fase vira `InProgress`, e fecha
  no `EndOfGame`. A página consulta `/estado` a cada 1 s (sem websocket, mais simples).

## Decisões e trade-offs

- **API antes de print** (Gabriel, 13/10/2026: "o que a gente conseguir evitar fazer sem print
  na tela, melhor"): toda informação sai primeiro da Live Client, da LCU e do histórico. Captura
  de tela só onde não existe API (posição no minimapa: passos 13, 15b, 15c e o fallback OCR do
  15e), sempre como módulo separado que liga e desliga na seção do 7b. Atualização do Gabriel
  no mesmo dia: "pode usar print então, no fear, mas api first": os módulos de tela nascem
  **ligados**, e a regra de preferir API continua (se a API cobre, não se usa print). O gravador
  roda a partida de medição com `--tela`. O chat do jogo é sondado pela LCU
  (`/lol-chat/v1/conversations`, sem conversas privadas) antes de pensar em OCR.

- **2ª tela antes de overlay**: zero interação com a janela do jogo, legível, e o Gabriel já
  tem o monitor. Overlay vira proposta depois. Quem: opus 5.5; confiança alta.
- **Previsão do jungler é probabilística e honesta**: mostra "provável: selva top inimiga
  (visto há 25 s)" com um nível de confiança, nunca uma posição "certa". Sem visão recente →
  "sumido há X s" + ~~farm do placar como pista~~ eventos globais (objetivo, abate, morte) como
  pista (o farm do inimigo não anda na fog: passo 9).
- **Hipótese a medir antes de construir em cima**: o farm (`creepScore`) do inimigo na Live
  Client atualiza mesmo na fog (é o que o TAB mostra). Se não atualizar, a previsão usa só o
  tempo e as rotas típicas. Medir na 1ª partida real (passo 9). **Medido em 13/10/2026: FALSA**
  (o cs do inimigo só sobe com farm visto e nunca recupera; jungler inimigo 100 contra 266 reais).
  A previsão usa tempo, rotas, horários dos campos e os eventos globais (objetivo, abate, morte).
- Conceitos do acervo: **falácia da previsão** (previsão do jungler é distribuição com
  confiança, nunca ponto) e **via-negativa** (painel ao vivo com 4 blocos fixos; cada aviso novo tem de
  tirar a vaga de outro).

## Passos

### Fase 0 — gravador passivo (antes da 1ª partida real)

0. [x] `tools/gravador.py`: um processo só leitura que o Gabriel deixa rodando numa partida
   **normal** para fechar de uma vez tudo o que só uma partida real responde:
   - em `Matchmaking`/`ReadyCheck`: `GET /lol-matchmaking/v1/ready-check` a cada ~200 ms →
     `temp/gravacao/readycheck.jsonl` (`timer`, `state`, `playerResponse`, hora local), para medir
     a janela e o instante do aceite do plugin;
   - em `ChampSelect`: `/lol-champ-select/v1/session` a cada mudança → `champselect.jsonl`
     (vira fixture do passo 1);
   - em `InProgress`: `allgamedata` da Live Client a cada 1 s → `live.jsonl` (passo 9) e um recorte
     do minimapa a cada 10 s com o `gameTime` no nome (`mss`; instalar) → `minimapa/`;
   - no fim: `game-timelines/{id}` salvo junto. As posições de `participantFrames` de cada minuto
     são o gabarito dos recortes que caem no minuto (passo 13 sem anotação manual);
   - nada de POST, nada de credencial em arquivo.
   Antes da partida: `schtasks /end /tn lol-client-coletor` e `schtasks /run /tn lol-client-coletor`
   para o coletor corrigido (trava órfã) ser o que roda.
   **prova:** `python tools/gravador.py --ensaio` (sem partida: grava 5 s da fase atual e sai) →
   `temp/gravacao/` com o arquivo da fase e nenhuma credencial (`grep` da credencial vazio)
   **reprova se:** pasta vazia ou credencial encontrada
   Feito 13/10/2026 06:12 (fase `Lobby`): `fases.jsonl`, `lobby.jsonl` (fila 420, TOP/JUNGLE),
   `calibracao.json` e 1 recorte do minimapa; Live Client recusada = "sem partida 1x";
   "credencial nos arquivos: 0" (conferência em memória, sem `grep` na linha de comando: o 4688
   grava a linha de comando no log Security) e `temp/v2/conferir_credencial.py` → 0. Também grava
   a tela inteira a cada 60 s para calibrar o minimapa (fórmula e calibração:
   [COLETOR.md](../docs/COLETOR.md) § Minimapa); sai 30 s após o client fechar ou 10 min após o
   `EndOfGame`. ~~Falta a gravação de uma partida real~~ **Partida real gravada** em 13/10/2026
   07:10–07:54 (`temp/gravacao/20261013-071040/`, normal fila 400, partida 3292746609): 3
   ready-checks, 61 eventos de champ select (2 seleções, uma desfeita por dodge), 2106 amostras da
   Live Client, 202 recortes do minimapa, 35 telas, partida + timeline. Resultado:
   [MEDICAO-2026-10-13.md](../docs/MEDICAO-2026-10-13.md). Defeitos do gravador achados (corrigir
   antes da próxima gravação): o recorte `chat/` cai no lugar errado nesta HUD (chat em x≈1400–1800,
   y≈830–975); os prints são do monitor, não da janela (11% dos recortes com navegador/desktop);
   no carregamento o nome = `gameTime` parado e os prints se sobrescrevem; `limpar_sessao` apaga
   `nameVisibilityType` (anonimato do champ select sem resposta); recortar só o mapa de 347 px e
   alinhar a cadência de 10 s ao `gameTime` (capturar com `gameTime mod 10 < 0,5`).

### Fase A — champ select e matchups

1. [x] Retrato do champ select no coletor: assinar `OnJsonApiEvent_lol-champ-select_v1_session`;
   na transição para `FINALIZATION` (ou na última sessão antes de `GameStart`) gravar na tabela
   `champ_select`: `game_id` (preenchido quando a partida aparece), `fila`, `assigned_position`
   do local, posições preferidas do lobby, `autofill` (assigned fora das preferidas), campeões e
   bans dos dois times (só ids), página de runa atual (id e nome), feitiços, segundos até travar.
   **prova:** `python tools/teste-champselect.py` alimenta 3 sessões gravadas em
   `tests/fixtures/champselect-*.json` (gravar uma real da personalizada do 7c e montar 2
   variações) → `3/3 ok` (autofill certo, ids certos)
   **reprova se:** qualquer `FALHOU`
   **correção:** sem sessão real disponível, as 3 fixtures (`preferida`, `autofill`, `blind`) foram
   **montadas** no formato do `GET /help?format=Full` (`TeamBuilderDirect-ChampSelectSession`);
   **a fixture real virá do gravador** (passo 0): o `champselect.jsonl` dele já é a lista
   `eventos` de uma fixture (conferido com `temp/v2/gravador_compat.py`). Feito 13/10/2026:
   `3/3 ok` + extras ok (seleção desfeita, reconexão no meio, fluxo pelo `Coletor` com LCU falsa,
   banco em `temp/`). Regras do retrato: [COLETOR.md](../docs/COLETOR.md) § Retrato do champ select.
   Coletor real **não reiniciado** (fica para o orquestrador antes da partida).
   **Fixture real entrou** (13/10/2026): `tests/fixtures/champselect-real.json` (61 eventos da
   partida 3292746609, anonimizada). Ela achou um bug: ban não feito vem com `championId` -1 e
   entrava em `bans_aliados`; `coletor.py` agora filtra `championId > 0` → `5/5 ok` + extras ok.
   O coletor em execução segue com o código antigo até reiniciar; a linha desta partida no
   `dados/lol.db` ficou com o -1.
2. [x] `coletor/analise.py` + `docs/INSIGHTS.md` § Matchups: por campeão inimigo adversário
   de rota (posição pela heurística da v1): n, vitórias, ouro, xp e farm aos 10/15 médios, mortes
   antes dos 10, mortes solo (1 inimigo) contra gank (2+); filtro por campeão próprio.
   **prova:** `python -c "from coletor.analise import matchups; ..."` para Renekton → lista
   ordenada por n, e a soma dos n = nº de partidas de Renekton com adversário não-incerto (conferir por SQL)
   **reprova se:** soma diferente
   Feito 13/10/2026: Renekton → 43 grupos ordenados por n, soma 85 = 86 elegíveis por SQL − 1
   incerto (conferido também rodando `analisar` em cada uma) → `ok`. Grupo = (meu campeão, papel,
   adversário); `n < 3` → médias null: [INSIGHTS.md](../docs/INSIGHTS.md) § Matchups.
3. [x] MCP: `matchups(campeao='Renekton', min_partidas=3)`, `champ_select(limite=20)`,
   `sessao_hoje()` (partidas de hoje, sequência, LP, horário, e o alerta de tilt do histórico).
   **prova:** chamada stdio (como na v1) de `matchups` → JSON com `n`, `winrate`, `ouro10`
   **reprova se:** erro ou campos ausentes
   Feito 13/10/2026: `python tools/teste-mcp.py temp/teste-champselect.db` sobe o servidor por
   stdio (SDK `mcp`), lista as 9 ferramentas e chama as 3 novas → `ok` (matchups ~3 KB com `n`,
   `winrate`, `ouro10`; `champ_select` no banco real sem a tabela → "sem retratos ainda", no
   banco de teste → retrato com autofill; `sessao_hoje` com partidas, sequência e LP).
4. [x] Selo do champ select (v1 7c) + matchup: quando o top inimigo travar (campeão visível no
   time inimigo com `assignedPosition` igual à minha, ou o único sem posição em blind), o selo
   ganha a linha "contra X: aV/bD · ouro10 ±N" (n ≥ 3; senão "contra X: n=1").
   **correção (medição de 13/10/2026):** na normal draft `theirTeam[].assignedPosition` vem
   sempre "" (os 5 sem posição), então esse gatilho nunca dispara. Gatilho novo: adversário = o
   inimigo cuja **rota provável** (C2 do passo 17) é a minha, lido só quando a ação de pick dele
   fica `completed` (o hover inimigo vaza 0,5–2,2 s antes e causaria flicker).
   **prova:** função pura `linhaMatchup(historico, meuCampeao, campeaoInimigo)` em
   `node tools/teste-matchup.mjs` contra a saída de `matchups()` em Python → `ok`
   **reprova se:** números diferentes
   Feito 13/10/2026: `node tools/teste-matchup.mjs` → `ok (82 linhas iguais ao Python + 6 extras)` (Renekton 43
   grupos, Zac 37; números lidos de volta do texto contra o grupo cru; papel desempata). **Decisão (opus 5.5,
   confiança alta):** matchup, trauma e faixa vêm do coletor (`GET 127.0.0.1:8765/draft/<meu campeão>`, rota
   nova no `coach_vivo`); o plugin só escolhe e formata (`linhaMatchup(matchups, meu, inimigo, nome, papel)`).
   Motivo: o histórico do client só traz o meu participante, sem adversário nem linha do tempo, e a faixa
   precisa do `meta.db`. Reverteria se o client passasse a entregar a partida inteira no histórico. Coletor
   fora → selo só com o winrate e a linha "coach: coletor fora do ar".

### Fase B — pós-jogo v2

5. [x] `pengu/posjogo/licoes.md` (**arquivo dono**; o plugin importa com `?raw`, o Python lê o
   mesmo caminho; `docs/LICOES.md` é só um link para ele): regras em blocos `id / quando (expressão sobre métricas nomeadas) /
   prioridade / texto com {placeholders}`, ~20 regras iniciais cobrindo fase de rota, mortes
   cedo, mortes sozinho no lado inimigo, morte que custou objetivo, farm por minuto contra média,
   matchup, sessão (sequência e horário), e pelo menos 3 regras **positivas** ("rota limpa: 0
   mortes até os 15"). Métricas definidas com fórmula em `docs/INSIGHTS.md`.
   **prova:** `python tools/validar-licoes.py` (parse + toda métrica citada existe na spec) → `ok (N regras)`
   **reprova se:** métrica inexistente ou parse falha
   Feito 13/10/2026: `ok (24 regras, 7 positivas, 44 métricas na spec, 20 casos de formato)`; cópia com
   métrica inventada → `FALHOU` com as 2 citações. Regras com matchup e traumas (`analise.traumas`
   do passo 19); métricas por fonte (partida, histórico, coletor) em [INSIGHTS](../docs/INSIGHTS.md)
   § Métricas das lições; `docs/LICOES.md` é só o link.
6. [x] Motor de lições: `coletor/coach.py` (Python, MCP e painel ao vivo) e
   `pengu/posjogo/licoes.js` (JS, pós-jogo), ambos lendo o mesmo `pengu/posjogo/licoes.md` (sem cópia).
   **prova:** para a partida de referência `3292712362` (fixtures), JS e Python devolvem as
   mesmas 3 lições, na mesma ordem (`node tools/teste-licoes.mjs` e `python tools/teste-licoes.py` → mesma linha impressa)
   **reprova se:** listas diferentes
   Feito 13/10/2026 (rodar o `.py` antes: ele grava em `temp/licoes/` o contexto do coletor e, na real,
   partida/timeline/histórico tirados do banco): 3292712362 → `mortes-1x1-adversario > virada-10-15 >
   farm-acima`; real 3292746609 → `sozinho-lado-inimigo > morte-objetivo > farm-acima`; linhas iguais
   no `diff`, 44/44 métricas iguais nas duas (as de `partida` e `histórico` calculadas pelo JS do zero;
   matchup, traumas e winrate por faixa vêm do Python, como no client). Extra: cruzado com as 173
   partidas do banco + 400 sorteios → 573/573 iguais (escolha e cada regra); ele achou e fez corrigir
   o `mmss` de negativo. Pendente da integração: o pós-jogo importar `licoes.md?raw` e o coletor servir
   `GET /contexto/<gameId>` (`coach.contexto_partida`). **Integração (13/10/2026):** o servidor local serve
   `GET /contexto/<gameId>` e `/licoes/<gameId>` e o MCP ganhou `licoes(game_id)` (ensaio: 200 e as 3 lições
   da 3292746609); falta só o pós-jogo do client (passo 7) importar e chamar.
7. [x] Pós-jogo com abas: **Resumo** (3 lições no topo + resultado), **Rota** (curva de ouro e
   xp minuto a minuto tua contra o adversário, em SVG), **Mortes** (mapa da v1 + lista), **Objetivos**
   (linha do tempo), **Tendência** (esta partida contra as últimas 20 em 4 indicadores, com
   setas), **Sessão** (hoje: partidas, sequência, LP, alerta). Visual nativo do client; legível
   em 1280×720; Esc fecha. **Print de cada aba e olhar uma por uma** (6 abas em 1280×720 é denso).
   **prova:** eval após `analisarPartida(3292712362)`: `document.querySelectorAll('#lc-posjogo [data-aba]').length + '|' + document.querySelectorAll('#lc-posjogo .lc-licao').length` → `6|3`; print conferido
   **reprova se:** menos abas ou lições
   Feito 13/10/2026 (`pengu/posjogo/abas.js` + `index.js`; **correção:** o eval chama `abrirPainel`, que roda o
   `analisarPartida` e desenha): 3292712362 → `6|3` (`mortes-1x1-adversario > virada-10-15 > farm-acima`) e
   3292746609 → `6|3` (`sozinho-lado-inimigo > morte-objetivo > farm-acima`), contexto do coletor `ok`, 12 prints
   em 1280×720 conferidos um a um (`temp/pengu/ref-*.png`, `real-*.png`; acharam e fizeram corrigir rolagem
   lateral nos Objetivos, rótulos encolhidos no placar e a 3ª lição divergente com o cache de 20 partidas). Mentor
   de verdade (servidor de teste com `Mentor` real em banco copiado): "pedir a análise agora" → "mentor
   pensando…" → texto em 19,8 s; pergunta pela caixa → resposta em 8,2 s na mesma sessão. Lições: as do
   `GET /licoes` do coletor quando ele responde (banco inteiro), senão o `licoes.js` com o histórico do client.
   Sem POST automático ao mentor (o coletor pede no `pos_partida`; o painel só oferece o botão). Prova sem
   client: `node tools/teste-abas.mjs` → `ok`. Revisão do jungler (15f.3) entra como bloco da aba Tendência.

### Fase C — painel ao vivo (2ª tela)

8. [x] Laço ao vivo no coletor (só em `InProgress`): Live Client a cada 1 s, estado em memória,
   amostra a cada 10 s na tabela `ao_vivo` (game_time, por participante: nível, itens, ouro
   estimado, KDA, farm, morto); eventos novos na tabela `eventos_ao_vivo`. Servidor HTTP
   `127.0.0.1:8765` (`/` página, `/estado` JSON). Sem partida → `/estado` = `{"partida": false}`.
   Flag `--liveclient <url>` (padrão `https://127.0.0.1:2999`) para o simulador rodar em HTTP simples.
   **Da medição (13/10/2026):** a Live Client responde no carregamento com `gameTime` ~0,025 e sem
   eventos por ~100 s: estado "carregando" até o evento `GameStart` (não gravar amostra antes).
   Eventos: lista inteira em toda resposta, deduplicar por `EventID`. Não guardar o `allgamedata`
   bruto (33 KB/amostra, 69 MB por partida): só o resumo por participante. Farm vem em degraus de
   10; nível e itens do inimigo podem estar velhos (guardar "visto em gt X"). O simulador pode tocar
   amostras reais de `temp/gravacao/20261013-071040/live.jsonl`.
   **prova:** `python tools/simular-liveclient.py` (servidor falso em 2999 tocando um
   `allgamedata` gravado de 3 momentos) + `curl -s 127.0.0.1:8765/estado` → JSON com 10 jogadores e `ouroEstimado` > 0
   **reprova se:** `partida:false` com o simulador de pé
   Feito 13/10/2026 (módulos; a ligação no `coletor.py` é da integração): `coletor/ao_vivo.py`
   (`AoVivo`, `EstadoPartida`), `coletor/servidor_local.py`, `tools/simular-liveclient.py` (porta
   **2998** por padrão, para não brigar com a Live Client real; `/sim/ir?gt=`, `/sim/vel`, `/sim/desligar`).
   Prova: simulador + `python coletor/ao_vivo.py --liveclient http://127.0.0.1:2998 --db temp/ao_vivo/ao_vivo.db
   --game-id 3292746609` → `/estado` com `partida true`, 10 jogadores, `ouroEstimado` 2650–3825 aos 10:34
   (preço total do `items.json` da LCU: o `price` da Live Client é o da receita), amostras a cada 10 s
   (600,1 · 610,1 · 620,0 · 630,1; 10 linhas cada), eventos sem Riot ID; simulador desligado → `{"partida": false}`
   em ≤ 10 s; carregamento = `partida true, fase carregando`. Como funciona: [COLETOR](../docs/COLETOR.md) § Ao vivo.
9. [x] **Medição numa partida real** (com o Gabriel, numa normal antes de usar na ranqueada):
   gravar `allgamedata` bruto a cada 1 s em `temp/` por 5 min; responder no ARMADILHAS: o
   `creepScore` do inimigo muda quando ele está na fog? `position` dos inimigos vem preenchida?
   itens do inimigo atualizam na fog?
   **prova:** `python tools/analisar-gravacao.py temp/live-*.jsonl` → as três respostas com evidência (timestamps)
   **reprova se:** gravação vazia
   Feito 13/10/2026 com a partida inteira (2106 amostras, 33 min, partida 3292746609).
   **Desvio da prova:** `tools/analisar-gravacao.py` não existe; as respostas saíram de scripts em
   `temp/medicao/live_*.py` (fora do git) cruzando `live.jsonl` com a timeline. Respostas: (1)
   `creepScore` do inimigo **não muda na fog** e nunca recupera (Ekko cs 0 até 306,9 s com 16 reais
   no min 3; fim 100 contra 266); (2) `position` **não é coordenada** (é a rota declarada; não há
   x/y em lugar nenhum); (3) itens e nível do inimigo **congelam na fog** e sincronizam ao
   reaparecer (Ekko nível 1 → 4 com 2 itens em 244,9 s); KDA, morte e renascer são globais.
   Detalhe e o resto (eventos, alma, feitiços, carregamento): [MEDICAO-2026-10-13.md](../docs/MEDICAO-2026-10-13.md) § 1.
10. [x] Página `painel/`: 4 blocos fixos (Tua rota · Ameaça · Teu padrão · Time e objetivos)
    + faixa de **um** aviso por vez do `coach.py` (texto ≤ 6 palavras + ícone + cor). Escuro, fonte
    grande, números grandes, nada de rolagem; legível de relance a 1,5 m. Itens:
    - **Tua rota**: ouro estimado, farm e nível contra o adversário (cor por limiar);
    - **Ameaça**: inimigo com maior (KDA × valor de itens), com dano predominante (AD/AP por itens + tags do campeão);
    - **Teu padrão**: a regra do histórico que vale agora ("1 morte antes dos 10: cuidado até 10:00");
    - **Time e objetivos**: próximo dragão, arauto ou barão pelo último evento + tempo de renascer conhecido,
      inimigos mortos agora (janela de objetivo), sugestão de item defensivo pela composição
      inimiga (tabela curada em `docs/ITENS.md` para Renekton e Zac).
    **prova:** com o simulador do passo 8, print headless da página (`tools/cdp.mjs` não serve
    aqui; usar `msedge --headless --screenshot`) e conferir os 4 blocos; teste de anti-spam
    (`python tools/teste-coach.py`: 30 s simulados → no máximo 1 aviso de voz e nenhum repetido)
    **reprova se:** bloco ausente ou aviso repetido
    Feito 13/10/2026: prints headless (1536×960, `--virtual-time-budget`; o estado vai embutido no
    HTML para o 1º quadro) no carregamento e nos min 5, 15 e 30 com o simulador tocando sem pular,
    conferidos um a um: 4 blocos em todos, nada cortado; adversário parado na fog sai cinza com
    "Ekko visto há 41 s: dados dele parados" (nunca como atual). `tools/teste-coach.py` → `ok (12/12)`.
    A faixa usa o `MotorAvisos` (avisos.py) pela integração; sem ele, `AvisosBasicos` (só API, 1 aviso
    novo a cada 30 s: replay da partida → máx. 1 em 30 s, nenhum repetido). Sugestão de item: genérica
    por AD/AP até a integração trocar pela tabela do `docs/ITENS.md` (`sugestoes.py`).
11. [x] Abrir e fechar o painel sozinho: `InProgress` → Edge em modo app no `DISPLAY1`;
    `EndOfGame` → fecha a janela (pelo pid guardado). Usar `--user-data-dir=dados\edge-painel`:
    sem isso o `msedge --app` reaproveita o Edge já aberto, o pid devolvido morre na hora e a
    janela não fecha. Desliga pela seção do 7b
    ("painel ao vivo na 2ª tela").
    **prova:** com o simulador, mudar a fase falsa e conferir a janela (`tasklist` com o pid) → abre e fecha
    **reprova se:** janela não abre ou fica órfã
    Feito 13/10/2026 (`coletor/janela_painel.py`): `python coletor/janela_painel.py --teste` → InProgress
    abre (pid no `tasklist`, janela em (2560, 595, 1920, 1140) = área útil do DISPLAY1), WaitingForStats
    mantém, EndOfGame fecha em 0,4 s por `WM_CLOSE`, `tasklist` sem o pid e 0 `msedge` com o perfil do
    painel. Liga/desliga: chave `painelAoVivo` do `/config` (o botão na seção do 7b é do Pengu).
12. [ ] Voz (`coletor/voz.py`): Maria pt-BR por **um processo de fala persistente** (PowerShell
    com System.Speech lendo frases do stdin, ou COM `SAPI.SpVoice`; abrir um PowerShell por frase
    custa ~1 s), fila com prioridade e intervalo mínimo; liga e
    desliga pela seção do 7b; avisos: objetivo em 60 s, janela de objetivo (2+ inimigos mortos),
    gank provável e "jungler sumiu" / "<rota> sumiu" (Fase D), "tu tá 2 mortes antes dos 10",
    ouro guardado ≥ 2000 ("hora de voltar?"), inimigo fed na tua rota ("evita 1x1"). Dois tons
    selecionáveis (sério e descontraído) com textos em `docs/LICOES.md`. Processo do coletor com
    prioridade abaixo do normal durante a partida.
    **prova:** `python -c "from coletor.voz import falar; falar('teste do coach')"` → o Gabriel ouve; e `python tools/teste-coach.py` → anti-spam ok
    **reprova se:** sem som ou aviso repetido
    **Parcial (13/10/2026, frente voz-alertas):** `coletor/voz.py` (PowerShell persistente, voz
    "Microsoft Maria Desktop" confirmada pelo processo, frase em base64, fila por prioridade, gank
    corta a fala comum) e o motor comum `coletor/avisos.py` (`MotorAvisos` + `GatilhosLive` com os
    avisos da lista; "gank provável" chega do `jungler.py` por `motor.publicar`). `falar('teste do
    coach')` rodou (3,2 s, voz Maria; **falta o Gabriel confirmar que ouviu**); `teste-coach.py` →
    `ok (12/12)`, inclusive o replay da partida 3292746609 (20 falas em 33 min, menor intervalo 20,0 s,
    avisos de dragão a ±1 s do gabarito). **correção da prova:** "30 s → no máximo 1 fala" contradiz
    a regra de 1 fala a cada 20 s (5 avisos distintos saem em t=0 e t=20); o teste cobre as duas
    leituras (mesmo aviso 60× → 1 fala; distintos → ≤ 2, a ≥ 20 s). Falta (integração): ligar no
    laço ao vivo do coletor, a chave do 7b (`motor.configurar`) e `voz.prioridade_do_processo(True)` em
    `InProgress`. Textos: seção `## Avisos ao vivo` do arquivo de lições ([COLETOR](../docs/COLETOR.md) § Avisos ao vivo).
    **Integração feita (13/10/2026):** motor no laço do coletor (`coach_vivo.py`), `motor.configurar` pela
    config (`voz`, `tomVoz`, `alertasTela`, `avisosDesligados`, reaplicada a cada `POST /config`), processo
    abaixo do normal em `InProgress` e normal no fim; ensaio: 30 falas em 33 min, menor intervalo 20,0 s,
    nenhuma repetida. Segue `[ ]` até o Gabriel confirmar que ouviu.

### Fase D — minimapa e jungler

13. [x] `coletor/minimapa.py`: captura da região do minimapa (calcular pela resolução,
    `MinimapScale` e `FlipMiniMap` do `game.cfg`; calibrar com um print real) a ~6 fps; detecção
    dos ícones dos 5 inimigos por template (ícones de `/lol-game-data/assets/v1/champion-icons/{id}.png`,
    recortados em círculo e redimensionados ao tamanho do ícone no minimapa) + borda vermelha;
    devolve `{campeao: (x, y no mapa 0–14870, visto_em)}`.
    **prova:** `python tools/teste-minimapa.py tests/fixtures/minimapa-*.png` (prints reais do
    minimapa tirados numa partida, com as posições anotadas à mão num `.json` ao lado) → acerto ≥ 80% dos ícones a ≤ 600 unidades
    **reprova se:** acerto < 80%
    **Ajustes da medição de 13/10/2026** ([MEDICAO](../docs/MEDICAO-2026-10-13.md) § 3):
    - retângulo: **autodetectar** a faixa (16, 28, 27) em volta do mapa no 1º recorte de jogo, em
      vez da fórmula (só uma `MinimapScale` medida). Referência: mapa 347 px em (2197, 716) na tela
      2560×1080 com escala 2,46; os 382 px do chute são a moldura. Mundo → pixel:
      `X = 2196,7 + 0,02345·x`, `Y = 1064,0 − 0,02361·y` ([COLETOR](../docs/COLETOR.md) § Minimapa);
    - template = ícone **base** da LCU (`champion-icons/{id}.png`) **inteiro** com máscara circular,
      28 px (testar 26–30); a skin não muda o ícone, não baixar círculo de skin. Medido: aliados
      76% a ≤ 600 com score ≥ 0,75; inimigos 67–84% de precisão (piso; borda vermelha/azul não testada);
    - acrescentar template do **anel da Yuumi presa** (tirado da gravação), hospedeiro por
      eliminação; sem isso o par some ~80% do jogo;
    - em luta o ícone inimigo cobre o aliado: testar segmentação da borda + classificação entre 5;
    - **filtro "jogo na tela"** antes de detectar (11% dos recortes eram navegador/desktop);
    - a prova fica com as **fixtures anotadas à mão**: a timeline (1/min, recorte ~2 s depois) tem
      teto de ~82% a ≤ 600 mesmo com detecção certa; se usar a timeline, a régua é ≤ 1000.
    Feito 13/10/2026: `python tools/teste-minimapa.py` (14 recortes reais em `tests/fixtures/minimapa/`,
    77 ícones anotados à mão) → **66/74 visíveis a ≤ 600 (89%)**, 0 falso de campeão, 1 Yuumi deduzida
    errada (anel de "voltando à base"; a `Captura` descarta pelo histórico), retângulo achado sozinho
    14/14 recortes e 27/28 telas (1 com 346 px), filtro de jogo na tela ok, ~7–9 ms/quadro (~5% de um
    núcleo a 6 fps) → `ok`. **Desvio do método**: em vez de 5 `matchTemplate` por quadro (50 ms cada com
    máscara), anéis por cor em meia resolução + rosto comparado em numpy só nos candidatos, o que
    resolve também o ícone encoberto pela borda. Erros que sobram: ícone mais da metade coberto em luta.
    Interface: `Captura.deteccoes()` = `[{campeao, time, x, y, visto_em}]` ([COLETOR](../docs/COLETOR.md)
    § Minimapa ao vivo). Falta: rodar ao vivo numa partida (passo 15).
14. [x] `coletor/jungler.py`: estado do jungler inimigo = última posição vista + tempo desde
    então + (se o passo 9 confirmar) variação do farm dele + horários de nascimento dos campos;
    distribuição sobre zonas (selva top/bot inimiga, rio, selva aliada top/bot, rota X) com
    confiança; alerta "gank provável top" quando a massa na zona perto da minha rota passa de um
    limiar e eu estou adiantado na rota sem ward conhecida (não temos wards: só posição).
    **prova:** `python tools/teste-jungler.py` com 5 cenários sintéticos (visto no azul inimigo aos
    3:15 → aos 3:40 provável rio top; sem dado → "sumido"; …) → `5/5 ok`
    **reprova se:** cenário falha
    **correção (passo 9, 13/10/2026):** a pista "variação do farm dele" **sai**: o `creepScore` do
    inimigo não anda na fog (só quando ele já está visível, e aí a posição é melhor), anda de 10
    em 10 e nunca recupera. Pistas que ficam, todas globais e em ≤ 1 s: eventos de objetivo com
    `KillerName` (vastilarvas, dragão, arauto, barão: local exato do jungler inimigo naquele
    instante), `ChampionKill` com ele em `KillerName`/`Assisters` (esteve na rota da vítima),
    `isDead`/`respawnTimer` (morto = sem gank por N s). Nome do Smite (upgrade) só quando visto.
    Um dos 5 cenários deve ser "objetivo do jungler inimigo na fog → posição fixada no objetivo".
    Feito 13/10/2026: `python tools/teste-jungler.py` → `5/5 ok` (azul 3:15 → rio top aos 3:40;
    sem dado → sumido; `HordeKill` na fog → covil; morto → sem gank, renasce na fonte; gank top só
    adiantado e com ele perto) + extras ok (abate com assistência, fonte do overlay). Zonas relativas ao
    meu time (ORDER e CHAOS nos cenários). `--real` toca a partida medida: zona certa 38%, top-3 67%
    (medição, não prova; o passo 15 é quem avalia).
15. [ ] Validação ao vivo com o Gabriel numa normal: registrar cada alerta de gank e, no
    pós-jogo, conferir contra a timeline (o jungler apareceu perto em ≤ 30 s?). Reportar precisão.
    **prova:** `python tools/avaliar-gank.py <game_id>` → precisão e cobertura impressas
    **reprova se:** relatório vazio
15b. [ ] **Overlay no minimapa** (pedido do Gabriel, 13/10/2026: "círculo crescendo da última
    posição vista, baseado no move speed"). Janela própria, transparente, sempre no topo e que
    **ignora clique** (`WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW` via
    ctypes), posicionada exatamente sobre o retângulo do minimapa do passo 13. Sem injeção e sem
    tocar no processo do jogo; só funciona em modo sem borda (`WindowMode=2`, o atual).
    - **Área alcançável, não círculo**: a partir da última posição vista, distância percorrível
      = velocidade × tempo, propagada por uma grade de caminhável do Rift (máscara gerada uma vez
      a partir do minimapa; paredes bloqueiam), não em linha reta através de parede.
      Velocidade = base do campeão (`/lol-game-data/assets/v1/champions/{id}.json`) + bota
      visível no TAB (itens da Live Client).
    - **Menos a área que tu enxerga**: a fog do minimapa é mais escura; o que está iluminado e
      sem o ícone dele, ele não está. Alcançável ∩ fog.
    - **Peso pelas pistas** do passo 14 (~~farm subindo → campos~~, que a medição derrubou; abate
      com assistência dele ou objetivo feito por ele → lugar e hora) vira mapa de calor em vez de
      mancha uniforme.
    - **Medido em 13/10/2026** ([MEDICAO](../docs/MEDICAO-2026-10-13.md) § 3): a fog sai do próprio
      recorte por brilho absoluto (HSV `V`: parede 0–10, chão na fog ~56, iluminado ~154; regra
      chão = V > 30, fog = chão com V < 100), sem histórico. A grade de caminhável sai de V > 30
      (1 quadro concorda 96,9% com a mediana; preencher buracos pretos < 40 px de ícones/textos;
      usar mediana de vários quadros ou o início da partida). Grade 347×347 ≈ 43 unidades/px.
      Mapa dinâmico **sem teste**: nesta partida `mapTerrain` ficou "Default" e não houve alma;
      o gatilho de regerar é a contagem de `DragonKill` (a fenda muda para o elemento da alma por
      volta do 2º/3º dragão; elemento = `DragonType` do 3º), não o `mapTerrain`; o instante exato
      da mudança fica para a partida com alma.
      Gravar uma partida com alma para validar. Pausar quando o jogo não está na tela.
    - Some sozinha depois de ~30 s sem pista nova (a área cobre o mapa e vira ruído) e
      troca por "sumido há Xs". Só para o jungler por padrão; laners opcionais.
    - Liga/desliga na seção do 7b e por atalho global (ex.: F8).
    - **Mapa dinâmico** (pedido do Gabriel): a grade de caminhável não é fixa. Ela é gerada do
      próprio minimapa (o terreno aparece até na fog, só mais escuro) no início da partida e
      refeita quando o terreno muda: evento `DragonKill` que define a alma (Fenda Química, Hextec,
      Oceano, Infernal muda paredes e passagens) e a cada 5 min por garantia. Mudança de season
      ou patch vira só "regerar a máscara", nada fixo no código. Máscaras salvas em `dados/mapas/`
      com o patch e o tipo de fenda, para comparar.
    - **Dash e Flash por cima da parede** (pedido do Gabriel): tabela curada `docs/MOBILIDADE.md`
      por campeão (alcance do salto, se atravessa parede, recarga aproximada; ex.: Kayn E anda
      dentro da parede, Zac E, Elise E, Kindred Q, Nidalee W, Lee Sin W com sentinela, Graves E);
      a propagação deixa cruzar parede de espessura ≤ alcance do salto, uma vez por recarga.
      Flash (400) entra para todo mundo como "talvez" (sem saber se está pronto), com peso menor.
    **prova:** `python tools/teste-alcance.py`: ponto no azul inimigo, 10 s a 345 de velocidade →
    área não atravessa a parede da base, raio máximo ≤ 3450 unidades; o mesmo com Kayn → cruza a
    parede; 4 cenários → `4/4 ok`; ao vivo na normal, print do overlay alinhado com o minimapa
    (erro ≤ 1 ícone)
    **reprova se:** área atravessa parede sem dash, ou overlay desalinhado
    Feito 13/10/2026 (menos o "ao vivo"): `python tools/teste-alcance.py` → `4/4 ok` (do vermelho
    inimigo, 10 s a 345: raio 3332 ≤ 3450 e o covil do barão fora andando; Kayn entra; Flash = 0,5;
    área ∩ fog zera o iluminado) + extras (grade regerada concorda 98,8% com 1 quadro, fontes ligadas,
    regeração após o 2º dragão). **correção:** o ponto da prova saiu do azul para o vermelho inimigo
    porque em 10 s não há parede da base ao alcance; a parede testada é a do covil do barão.
    **correção:** a LCU não tem velocidade em `champions/{id}.json`; base do Data Dragon da versão do
    client. **correção:** o mapa muda depois do **2º** dragão (wiki), não com a alma: `GradeViva`
    regera ~20 s depois do 2º `DragonKill`. `python coletor/overlay_minimapa.py --demo --left 1000
    --top 300` → estilos click-through/topo/sem foco, `WindowFromPoint` atravessa, retângulo exato,
    100% da área quente desenhada e 0% no print com `WDA_EXCLUDEFROMCAPTURE` → `ok`. Falta: print ao
    vivo do overlay alinhado (partida) e a chave da seção do 7b (F8 já liga/desliga).
    **Fechamento (13/10/2026):** a chave existe (`overlayMinimapa`, Configurações › LOL-CLIENT › Minimapa e
    jungler). `--demo` em (1000, 300) → `ok`; em (300, 300) → 1 `FALHOU` ("px fora da área que mudaram: 11%",
    regra < 5%) e 2 `ok` seguidos: a conta de "fora da área" mede a tela atrás, e qualquer janela animando ali
    reprova. Prova instável pelo ambiente, não pelo overlay. **correção:** "print ao vivo" não prova nada,
    o overlay sai do print de propósito; o alinhamento se confere no olho ou por foto do celular.
15c. [x] **Alertas visuais na tela** (pedido do Gabriel, 13/10/2026). Overlay de tela inteira,
    click-through, que só desenha uma **moldura colorida pulsando na borda da tela** + um
    rótulo curto no canto (≤ 3 palavras) por ~2 s, com a voz do passo 12 junto:
    - **jungler apareceu** em qualquer zona (rótulo com a zona: "jungler rio top");
    - **mid fora do mid** ("mid sumiu" quando some; "mid indo top" quando reaparece fora da rota);
    - **intruso na minha rota**: qualquer inimigo que **não é** meu adversário de rota visto perto
      da minha rota, ou a **primeira aparição** de qualquer inimigo (inclusive o meu adversário
      voltando da base) numa faixa perto da minha rota. Cor por gravidade: vermelho (jungler ou 2+
      inimigos), amarelo (1 laner intruso), azul (adversário voltou).
    - "Minha rota": a posição atribuída no champ select (passo 1) + a zona do meu ícone no
      minimapa quando detectado (ícone próprio tem moldura distinta).
    - Anti-spam do passo 12; liga/desliga por tipo na seção do 7b.
    - **Da medição (13/10/2026):** o print é do monitor; quando o jogo não está na tela (morto,
      trocou de janela: 11% dos recortes), pausar os alertas em vez de alertar sobre lixo. Teste
      barato: a faixa (16, 28, 27) em volta do mapa ou a janela em primeiro plano.
    **prova:** `python tools/teste-alertas.py` com sequências sintéticas de detecções (jungler
    aparece no rio top; mid some 8 s e reaparece no top; suporte inimigo entra na rota top) → os 3
    alertas certos, sem repetição em 10 s → `3/3 ok`
    **reprova se:** alerta errado, faltando ou repetido
    Feito 13/10/2026: `AlertasPosicao` em `coletor/avisos.py` (contrato das detecções em
    [COLETOR](../docs/COLETOR.md) § Avisos ao vivo) + `coletor/moldura.py` (ctypes, só com o jogo em
    primeiro plano, fora do print por `WDA_EXCLUDEFROMCAPTURE`). `python tools/teste-alertas.py` →
    `prova do plano: ok 3/3` e `ok (12/12)` com os extras (jungler na rota = vermelho urgente, 2
    intrusos, adversário voltou, pausa fora da tela, morto não some, lista do `Captura.deteccoes()`,
    janela real). "Minha rota" sai da
    `position` da Live Client (= a atribuída) ou do meu ícone. Falta: detecções reais do passo 13 e
    validação ao vivo (passo 15); chave do 7b por tipo via `motor.configurar(desligados=…)`.
15d. [ ] **Inteligência de selva inimiga** (pedido do Gabriel, 13/10/2026). Tabela curada
    `docs/SELVA.md` (campos, ouro e farm por campo, nascimento e renascimento do patch atual, com
    fonte e data; conferir na wiki a cada patch) + estado por campo inimigo:
    - **lado de início do jungler** pelo 1º avistamento, pelo farm aos ~1:45 e pelo nível 2/3;
    - **campos provavelmente limpos**: ~~farm do inimigo subindo~~ (o passo 9 derrubou: o farm do
      inimigo não anda na fog) → horário + último avistamento + eventos globais (vastilarvas,
      dragão, arauto feitos por ele, abates), com renascimento contado a partir daí;
    - **previsões úteis**: "jungler nível 3 por volta de 3:15 perto do top" (janela de gank),
      "campos top inimigos livres" quando ele foi visto no bot (para contra-selva quando o Gabriel
      joga de Zac), "caranguejo do rio nasce em 30 s";
    - o minimapa já mostra o timer dos campos que tu viu morrer (`MinimapEnableAllTimers=1`): ler
      esses timers por OCR como confirmação, quando aparecerem.
    **prova:** `python tools/teste-selva.py`: farm 0→4→8→12 aos 1:45/2:05/2:30 + visto no
    vermelho inimigo aos 1:35 → início no vermelho, 3 campos limpos na ordem certa, nível 3 previsto
    entre 3:00 e 3:30 → `ok`
    **reprova se:** lado ou ordem errados
    **correção (passo 9):** o cenário da prova não pode usar farm do inimigo (fica 0 na fog e anda
    de 10 em 10). Trocar por: visto no vermelho inimigo aos 1:35 + sem avistamento até 3:00 →
    início no vermelho, campos limpos estimados pelo tempo, nível 3 entre 3:00 e 3:30; e um 2º
    cenário com `HordeKill` dele aos 8:50 → posição e campos do lado das vastilarvas.
    Feito 13/10/2026: `python tools/teste-selva.py` → `2/2 ok` + extras ok. **correção:** desde o
    V26.01 os buffs nascem 0:55 e os campos pequenos 1:07 (eram 1:30/1:42), caranguejo 2:55, barão
    20:00 ([SELVA](../docs/SELVA.md), wiki 13/10/2026); na partida real o Zac fez nível 3 em 2:04 e o
    Ekko entre 2:00 e 3:00. Com o avistamento aos 1:35 o nível 3 previsto é 2:14–3:09 (não 3:00–3:30);
    o modelo acerta Zac (1:50–2:45) e Ekko (1:49–2:44). Campos limpos às 3:00: vermelho → krugs → aves →
    lobos. Falta: OCR dos timers de campo do minimapa (confirmação) e ouro/xp de vermelho, lobos e aves.
    **Reaberto na revisão (13/10/2026):** a prova passou, mas o passo pede os dois itens acima e não houve
    decisão de cortar; fica `[ ]` até a tabela ter ouro/xp com fonte e data e o OCR dos timers existir (ou um
    descarte registrado). Hoje nada lê ouro/xp por campo (`selva.py` usa só nascimento/renascimento).
15e. [ ] **Flash e feitiços inimigos** (pedido do Gabriel, 13/10/2026: "aparece na visão de algum
    aliado quando o inimigo usou o flash"). A Live Client não informa recarga de feitiço inimigo;
    as fontes visíveis são:
    - **ping de feitiço dos aliados no chat** (clicar no feitiço do inimigo no placar gera a linha
      "Campeão - Flash" com o horário): OCR do recorte do chat (`chat/` do gravador, a cada 3 s);
    - **atalho manual** (ex.: F9 + 1 a 5 para o inimigo) quando o próprio Gabriel vê o flash;
    - (avaliar com a gravação) detectar o efeito do flash na tela: provavelmente pouco confiável, só se a gravação mostrar que dá.
    Recarga: 300 s, reduzida por bota jônica (itens no TAB) e por Visão Cósmica quando o ramo
    secundário visível (`runes` da Live Client) permitir; senão marca "±". Mostra "Darius sem
    flash 3:12" no painel e fala quando ele volta.
    **prova:** `python tools/teste-ocr-chat.py temp/gravacao/*/chat/` → linhas de ping
    reconhecidas com campeão e feitiço certos em ≥ 80% dos prints que têm um (anotar 10 prints à mão);
    `python tools/teste-feiticos.py` → cronômetro com bota jônica = 300 × 100/110 s
    **reprova se:** OCR < 80% ou tempo errado
    **Ajustes da medição de 13/10/2026** ([MEDICAO](../docs/MEDICAO-2026-10-13.md) § 4):
    - **chat da LCU fechado**: `/lol-chat/v1/conversations` ficou `[]` a partida toda; fica OCR + atalho;
    - **pré-condição da prova**: o `chat/` gravado está no lugar errado (canto inferior esquerdo;
      nesta HUD o chat fica em x≈1400–1800, y≈830–975 de 2560×1080). Calibrar sozinho no 1º print
      de tela inteira (linha "Digite /help…" ou linhas que começam em `mm:ss`, pela caixa
      `OcrLine.Words[].BoundingRect` do OCR do Windows), gravar em `calibracao.json` e **gravar
      outra partida** com ≥ 10 prints de ping anotados. Os 6/6 de hoje (n pequeno, em `telas/`) não cravam 80%;
    - **formato real do ping** (troca o "Campeão - Flash"): `^(\d\d:\d\d) .*\((<aliado>)\): (<inimigo>) usou (<feitiço>)$`
      e a variante sem "usou" (`<inimigo> <feitiço>`); descartar "X - Vivo(a)", "Espere por R - Ns",
      "usou R - <ult>" e "<item> - Precisa de N de ouro". "usou" = gasto: o cronômetro começa no
      horário da linha. Dedupe por (horário, inimigo, feitiço): aliados repetem e a linha aparece em vários prints;
    - **motor**: Windows.Media.Ocr pt-BR (nativo, < 20 ms por print), recorte colorido ampliado 3×,
      sem binarizar; votar entre prints de 3 s; dicionário fechado (10 campeões da Live Client +
      feitiços). Tesseract descartado como principal (44% contra 57% das linhas);
    - **recarga**: a runa é **Perspicácia Cósmica** (8347, +18), não "Visão Cósmica"; botas 3158
      (+10) e 3171 Lucidez Escarlate (+20); `base × 100/(100 + soma)`, base do
      `summoner-spells.json` da LCU (Flash 300, Incendiar/Barreira 180, Exaustão/Curar/Fantasma/
      Purificar 240, Teleporte 300). A prova `teste-feiticos.py` cobre também 3158 + 8347 = 234,4 s;
    - **runa dos outros**: a Live Client só tem keystone + árvores (sem Inspiração → "sem"; com →
      "±"). Fonte certa: spectator-v5 (by-puuid do Gabriel) uma vez no carregamento, guardando só
      `championId → perkIds` (nunca `riotId`/`puuid`);
    - **bota do inimigo** na Live Client atrasa (mediana 25 s, até 322 s): ler no momento do ping
      (ele está visível) e marcar "±" se a última leitura de item for velha.
    **Feito em parte (13/10/2026, frente feitiços):** `coletor/feiticos.py` (OCR persistente,
    calibração do chat pelas linhas `mm:ss` → (1404, 806)–(1876, 976) nas telas, regex real, dedupe,
    recarga, atalho F9 + 1..5 por `RegisterHotKey`) e `tools/teste-feiticos.py` → `ok (0 falhas)`
    (272,7 / 234,4 / 217,4 s; replay da gravação acha Yasuo 7:05 e 7:06 e Tristana 19:14 uma vez).
    `tools/teste-ocr-chat.py` (gabarito `tests/fixtures/chat-pings-20261013.json`, 35 telas anotadas)
    → 3/3 prints com ping de feitiço, 5/5 pings, 0 falso positivo, rc 2: a régua passa, mas só 6
    prints têm ping (3 de feitiço), < 10. **Falta:** gravar outra partida com o chat certo e ≥ 10
    prints de ping; ligar no laço ao vivo; testar o F9 com o jogo aberto. Doc: [COLETOR](../docs/COLETOR.md) § Feitiços.
    **Ligado no laço (integração, 13/10/2026):** OCR a cada 3 s, F9, runas do spectator do carregamento
    (`Carregamento.runas`), "sem Flash" nos chips do painel e "com Flash" na voz; no ensaio o OCR dos prints
    gravados achou Yasuo Flash/Incendiar e Tristana Flash e as 3 voltas saíram na voz. Falta o mesmo de antes.
15f. [x] **Sugestões aceitas pelo Gabriel em 13/10/2026 ("quero todas")**:
    1. **flash por atalho**: coberto pelo 15e.
    2. **preparo de objetivo**: 60 s antes de dragão, arauto, vastilarvas ou barão, bloco que mostra
       quais inimigos estão mortos (e por quanto tempo), sumidos ou vistos, e a área provável do jungler.
    3. **revisão da previsão no pós-jogo**: aba que compara a previsão do jungler (gravada a cada
       10 s) com a posição real dele na timeline (1/min) e mostra a precisão da partida e a acumulada.
    4. **picos de força do adversário**: 1º item lendário completo e nível 6 (e 11/16) do adversário de
       rota e do jungler → aviso curto ("Darius nível 6").
    5. **tela de carregamento**: composição inimiga (AD/AP, cura, controle), tua página de runa
       atual e o lembrete de build da tabela `docs/ITENS.md` para o teu campeão contra aquela
       composição, no painel da 2ª tela.
    6. **modo treino**: tudo funciona na fila 3140 (modo treino) para calibrar overlay, alertas e
       voz sem partida valendo; a amostragem do banco ignora esse modo (`FORA_DAS_CONTAS`).
    **prova:** um teste por item em `tools/teste-sugestoes.py` com estados sintéticos (2: 2
    inimigos mortos 40 s antes do dragão → bloco lista os 2; 3: precisão calculada sobre fixture;
    4: nível 5→6 → 1 aviso; 5: comp 4 AD → lembrete de armadura; 6: fila 3140 → painel ativo e
    nada gravado em `partidas`) → `5/5 ok`
    **reprova se:** qualquer item falha
    **Da medição (13/10/2026):** item 2: inimigos mortos e o tempo de renascer vêm globais
    (`isDead`/`respawnTimer`), e o objetivo feito pelo inimigo chega em ≤ 1 s; item 3: a timeline é
    1 posição/min e o recorte cai ~2 s depois, então a precisão usa ≤ 1000 unidades (≤ 600 tem teto
    ~82%); item 4: nível e item do jungler/adversário só atualizam quando ele é visto (aviso pode
    sair atrasado: dizer "visto nível 6"); item 5: disparar pela Live Client respondendo com
    `gameTime` parado em ~0,025 (não pela fase `GameStart`, que dura ~50 ms); ~100 s de janela, com
    campeão, rota, feitiços e keystone dos 10 já disponíveis.
    Feito 13/10/2026: `coletor/sugestoes.py` + `docs/ITENS.md` (Renekton e Zac) e
    `python tools/teste-sugestoes.py` → `5/5 ok`; o replay da partida gravada dá composição 3 AD · 2 AP
    no carregamento, "Ekko nível 6" aos 6:32 e "Ekko fechou Aurora e Crepúsculo" aos 11:02. Item 6
    provado pela regra (`amostrar(3140)` falso, `coach_ativo` verdadeiro, partida 3140 fora da
    `ultima_partida`), não pelo painel. **Falta (integração):** mostrar os blocos no painel, aba
    de revisão no pós-jogo e tabela das previsões (jungler.py ainda não existe).
    **Integração (13/10/2026):** blocos 2 e 5 no painel (preparo no rodapé de objetivos, composição e build no
    carregamento), picos e treino (3140: coach ligado, amostra fora) no laço; previsão do jungler a cada 10 s em
    `previsoes_jungler`, revisão no pós-jogo em `revisoes_jungler` e `GET /revisao/<gameId>`. Falta a aba do
    pós-jogo no client (Pengu).

### Fase F — inteligência no champ select e no carregamento (pedido do Gabriel, 13/10/2026)

Pesquisa de mercado, tags, previsão de vitória, Riot API e fronteira (anonimato no champ select
da ranqueada desde o patch 12.22: jogador de terceiro só a partir do carregamento) em
[docs/MERCADO.md](../docs/MERCADO.md), que é o contrato desta fase: a tabela da § 7 (C1–C4,
L1–L5, prioridade e custo de chamadas) e as decisões técnicas de lá valem como passos.
Chave: `LOL_RIOT_API_KEY` no Doppler pessoal ([ARMADILHAS](../docs/ARMADILHAS.md) § Riot API).

17. [x] C1 (= passo 4) + C2 + C3 no champ select: winrate dos 10 campeões na rota provável,
    rota provável do inimigo, força do draft em faixa com os 2–3 termos que mais pesaram.
    Antes do C2, conferir na gravação real (`temp/gravacao/*/champselect.jsonl`) se
    `theirTeam[].assignedPosition` vem preenchido. **Conferido em 13/10/2026: não vem** ("" em
    todos os eventos da normal draft, `isAutofilled` false e feitiços 0 no time inimigo; no banco,
    `champ_select.inimigos` com posição nula). C2 é inferência: prior por campeão (histórico +
    tabela), resolvido como atribuição dos 5 inimigos às 5 rotas; o smite inimigo só confirma o
    jungler no carregamento (Live Client). Ler o campeão inimigo só com a ação `completed`.
    **prova:** testes puros por item (`tools/teste-draft.py` com 3 drafts sintéticos → faixa e
    termos esperados) → `3/3 ok`; selo ao vivo numa personalizada sozinho (protocolo do CLAUDE.md)
    **reprova se:** faixa errada ou selo ausente
    **Parte de dados feita (13/10/2026, frente riot-api):** `coletor/draft.py` (`Draft.analisar_sessao`) +
    `dados/meta.db` (309 partidas EMERALD, `tools/coletar-meta.py`). `python tools/teste-draft.py` →
    `3/3 ok` + rota provável dos 5 inimigos da partida real 3292746609 5/5 (prior só da meta); retrocesso
    no banco: 89,7% dos campeões na rota certa, 77,6% dos times inteiros. Termo pessoal e matchup só
    com n ≥ 3. **Falta:** selo ao vivo (plugin + `/draft` no servidor local), integração.
    **Selo feito (13/10/2026):** o selo lê `GET /draft/<campeão>` a cada 3 s na seleção: matchup contra o
    inimigo de rota provável (`adversarioDoDraft`), trauma e "draft: <faixa>" + os 2 termos que mais pesaram
    (some sem campeão travado: a faixa do vazio é 50%). Com a sessão real gravada no coach: "contra Ekko: n=2 ·
    Ekko é trauma: 0V/4D · draft: equilibrada · −2,8 teu Zac jungle: 27V/33D". Ao vivo numa personalizada
    sozinho (hover em Zac sem travar, saída pelo `session/quit` com rede de segurança): selo na coluna, com o
    coletor de teste respondendo. Inimigo de verdade no draft ao vivo: só numa partida (personalizada sozinho
    não tem).
18. [ ] C4 + L1–L4 no carregamento: 10 jogadores (elo, WR, sequência, maestria, tags da § 2,
    "morre cedo" do adversário e do jungler) no painel da 2ª tela e num resumo no client;
    identidade de terceiros só em memória; previsão gravada para calibrar contra o resultado.
    **prova:** `tools/teste-tags.py` com partidas sintéticas por tag → todas as tags certas;
    contagem de chamadas por partida ≤ orçamento da § 7 (contador no log)
    **reprova se:** tag errada ou orçamento estourado
    **Gatilho medido em 13/10/2026:** o carregamento não tem fase própria (`GameStart` dura ~50 ms,
    o resto corre em `InProgress`). O sinal é a Live Client respondendo (~7 s após `InProgress`)
    com `gameTime` parado em ~0,025 e sem o evento `GameStart`: ~100 s de janela para elo, WR e
    maestria dos 10. Rota do inimigo: a declarada em `allPlayers[].position` já vem aqui (e o smite),
    então o carregamento corrige o palpite do C2.
    **Parte de dados feita (13/10/2026, frente riot-api):** `coletor/riotapi.py` + `coletor/carregamento.py`.
    `python tools/teste-tags.py` → tags 10/10, br1 27–28 e americas 58–59 (orçamento 31/72, linha
    `carregamento: chamadas …` no log), oculto sem chamada, premade baixado 1 vez, gatilho = 99
    amostras da gravação real. Partida real 3292746609 com a Riot API: br1 30, americas 49, 7 s,
    0 identificador nos arquivos escritos. **correções:** o puuid da LCU não serve na Riot API (400);
    "perde a rota" virou "domina a rota" (`laningPhaseGoldExpAdvantage` = vantagem grande):
    [ARMADILHAS](../docs/ARMADILHAS.md) § Riot API. **Falta:** painel da 2ª tela e resumo no client.
    **Integração (13/10/2026):** o coletor dispara o carregamento na Live Client com `gameTime` ~0 e o painel
    mostra a previsão em faixa ("Teu padrão") e as tags do adversário ("Ameaça"); o MCP lê o `/estado` do
    coletor em vez de chamar a Riot API de novo (sem 429). Falta o resumo no client.

### Fase G — herança do projeto antigo do Gabriel (abril de 2026)

Dois scripts dele de 30/04/2026 (cópia em `OneDrive\Aplicativos\remotely-save\dosxnjos\league of legends\`;
a pasta original saiu na limpeza de 31/07): `analise_trauma.py` ("Neural Trauma Analyzer": nas
derrotas com um campeão, quais campeões mais aparecem, ponderado por pickrate e counters de um
site de meta, em um índice "IBP"; depois pede 3 dicas a um LLM com a persona "mentor ácido") e
`telemetria_partida.py` (resumo da última partida pela Riot API + diagnóstico e conversa com o
mesmo mentor). O conceito vale; o método e a fonte não:

- conta os 9 outros campeões da partida perdida, inclusive aliados, sem comparar com as
  vitórias (campeão popular aparece em tudo) → aqui vira **lift** de derrota contra o
  campeão inimigo (taxa de derrota com ele no time inimigo ÷ taxa geral), n ≥ 3, encolhido
  para a média quando a amostra é pequena;
- pickrate e counters vinham de raspagem com bypass de Cloudflare → fora (mesma régua de
  [MERCADO](../docs/MERCADO.md) § 4).

19. [x] **Teus traumas**: ferramenta `traumas(campeao=None, min_partidas=3)` no MCP + bloco no
    pós-jogo (aba Tendência) e no selo do champ select ("Darius é trauma: 2V/7D") com o lift
    acima; nome "trauma" mantido, é dele.
    **prova:** `python tools/teste-traumas.py` com histórico sintético (campeão X em 6 de 8
    derrotas e 1 de 8 vitórias → trauma; campeão popular em tudo → não) → `ok`
    **reprova se:** campeão popular aparece como trauma
    **Dados e MCP feitos (13/10/2026, frente riot-api):** `analise.traumas()` (K = 10, lift ≥ 1,2,
    [INSIGHTS](../docs/INSIGHTS.md) § Traumas) + `traumas()` no MCP. `python tools/teste-traumas.py` →
    `ok` (X lift 1,29 trauma; popular lift 1,000 não; n = 2 não; remake e treino fora). **Falta:**
    bloco na aba Tendência e no selo. **Feito (13/10/2026):** aba Tendência ("Ekko é trauma: 0V/4D com Zac ·
    lift 1,26" na 3292746609) e linha no selo (`linhaTrauma`, conferida no `teste-matchup.mjs` contra
    `analise.traumas`); liga/desliga em Configurações › LOL-CLIENT › Traumas (só o plugin).
20. [x] **Mentor com o Claude do Gabriel** (decidido por ele em 13/10/2026: "usar o meu claude
    aqui, versão sonnet, com advisor opus"). O coletor chama o **binário oficial** em modo
    headless (classe D da régua [termos-de-uso](../../cerebro/temas/harness/hooks/termos-de-uso.md):
    `claude -p` próprio é uso permitido; proxy/SDK pelo plano, não):
    `claude -p --model sonnet --advisor opus --disallowedTools "<todas as ferramentas>" --output-format json "<prompt>"`.
    - **Isolamento obrigatório**: cwd e `BACKUP_RAIZ` em `%LOCALAPPDATA%\lol-client-mentor` (fora de
      qualquer repo; dentro de `C:\Dev` o hook de backup commitaria e daria push), `SESSOES_ABERTAS_IGNORAR=1`,
      `CENTRAL_ORIGEM=ia:lol-client-mentor`. `--bare` **não serve**: pula o login e dá "Not logged in".
    - Medido em 13/10/2026: resposta em ~20 s no total (~10 s de API), 1 turno, Sonnet 5.5; o
      advisor só é chamado quando o modelo acha necessário.
    - Pós-jogo: no `EndOfGame`, o coletor manda as lições do passo 6 + números da partida + traumas
      no tom "mentor ácido" (o do `analise_trauma.py` de abril), grava o texto no banco e serve
      em `/mentor/<gameId>` (servidor do passo 8); o painel mostra "mentor pensando…" e depois o texto.
    - **Conversa**: caixa "pergunta ao mentor" no pós-jogo continua a mesma sessão (`--resume <session_id>`
      guardado com o texto), como o chat do `telemetria_partida.py`.
    - Ao vivo: ~20 s é lento para alerta; serve só para resumo sob demanda (ex.: atalho na tela de morte).
    - Custo: sai da cota da assinatura (1 chamada por partida + perguntas), sem chave nova.
    - Padrão medido em 13/10/2026 com texto simples: Sonnet, `--effort low`, advisor Opus (Haiku
      inventou "sem flash"; medium inventou "first blood" e veio cortado). **Refazer a comparação
      com dados reais** (pedido do Gabriel): entrada = o que a partida 3292746609 gerou (amostras
      da Live Client, eventos, análise do pós-jogo, lições, traumas, histórico), nos dois usos:
      pós-jogo (partida inteira) e ao vivo (estado de um momento, ex.: minuto 8 e minuto 20).
      Matriz Sonnet/Haiku × low/medium, saídas lado a lado em `temp/mentor-comparacao.md`, julgadas
      por especificidade, fato inventado (conferir cada afirmação contra os dados) e tempo; o
      vencedor vira o padrão da seção LOL-CLIENT.
    **prova:** `python tools/teste-mentor.py --seco` (monta o prompt da partida de referência e mostra
    o comando sem chamar) → comando com `--model sonnet --advisor opus` e o env isolado; e uma
    chamada real → texto não vazio em ≤ 60 s gravado na tabela `mentor`
    **reprova se:** cwd dentro de `C:\Dev`, ferramenta liberada no comando, ou texto vazio
    Feito 13/10/2026 (prova): `coletor/mentor.py` + `tools/teste-mentor.py`. `--seco` → comando com
    `--model sonnet --advisor opus`, cwd e `BACKUP_RAIZ` em `%LOCALAPPDATA%\lol-client-mentor`, env sem
    `CLAUDE*` → `ok`; chamada real do pós-jogo da 3292746609 → texto em 17,2 s gravado na tabela `mentor` (banco
    de teste em `temp/`) e a pergunta com `--resume` na mesma sessão em 11,1 s → `ok`; `--offline` (fila de 1,
    rotas, prompt sem Riot ID) → `15/15 ok`. **correção do comando**: `--disallowedTools` não basta (MCP de
    usuário, `CLAUDE.md` global e hooks vazam); o comando é `claude -p --safe-mode --tools ""
    --strict-mcp-config --disable-slash-commands --settings {"disableAllHooks":true} --system-prompt …` com o
    prompt pelo **stdin** ([ARMADILHAS](../docs/ARMADILHAS.md) § Mentor, [COLETOR](../docs/COLETOR.md) § Mentor).
    **Comparação com dados reais** (`temp/mentor-comparacao.md`, 2 rodadas × 3 usos × 4 configurações, cada
    afirmação conferida): Sonnet/medium 50 fatos certos, 1 erro de leitura, 0 inferência fora dos dados, 16,9 s
    de média (e 0 erro nas 2 chamadas reais); Sonnet/low 48 / 1 (+1 na chamada real) / 3, 13,2 s; Haiku/low
    38 / 3 / 2, 17,8 s; Haiku/medium 40 / 0 / 2, 22,8 s e o menos específico com o Haiku/low. Nenhum número inventado em nenhuma; o advisor
    não foi acionado em nenhuma das 25 chamadas. **Vencedor: Sonnet, `--effort medium`, advisor Opus**
    (`mentor.MODELO_PADRAO`/`EFFORT_PADRAO`; troca o "low" do teste com texto simples). Quem: opus 5.5;
    confiança média (n = 2 por célula, uma partida); reverteria: medium inventando mais que low nas próximas
    partidas ou passando de ~30 s. A comparação rodou antes de lições (passo 6) e traumas (passo 19) entrarem
    no prompt; a chamada real final já os leva.
    **Falta (integração)**: chamar `Mentor.posjogo(gid)` no `EndOfGame` depois de partida + timeline no banco;
    encaminhar `/mentor…` do `servidor_local.py` para `Mentor.rota_http`; "mentor pensando…" e a caixa de
    pergunta no pós-jogo (Pengu) e no painel.
    **Integração (13/10/2026):** `Mentor.posjogo(gid)` quando a partida chega no banco (chave `mentor`; não em
    personalizada/treino) e `/mentor…` encaminhado; ensaio com o Claude falso → `GET /mentor/3292746609` pronto.
    Falta a interface no Pengu e o atalho de resumo ao vivo. **Interface no Pengu feita (13/10/2026):** passo 7
    (aba Resumo) e modelo/esforço na seção LOL-CLIENT (`mentorModelo`/`mentorEffort` no `/config`, aplicados no
    `Mentor` na hora). Falta o atalho de resumo ao vivo.

### Integração (13/10/2026)

I1. [x] **Coach ligado no coletor** (`coletor/coach_vivo.py` + ganchos no `coletor.py`): fases do gameflow →
    carregamento, laço ao vivo, minimapa/jungler/selva/overlay, avisos/voz/moldura, feitiços, sugestões,
    mentor e revisão; servidor local junto com o coletor (`/estado`, `/config`, `/mentor`, `/contexto`,
    `/licoes`, `/draft`, `/revisao`); config em `dados/config.json` (o plugin manda o cfg dele em `POST
    /config`); processo abaixo do normal na partida. Como funciona: [COLETOR](../docs/COLETOR.md) § Coach na partida.
    **prova:** `python tools/ensaio-coach.py` (coletor + LCU falsa + simulador tocando a partida inteira, sem o
    client) → `ok (0 falha(s))`; e `python tools/rodar-testes.py` → todas ok
    **reprova se:** qualquer `FALHOU`, aviso repetido, voz com < 20 s sem urgência, thread viva depois do `EndOfGame`
    **Refinamento (revisão 13/10/2026; opus 5.5, confiança média, reverteria se a voz virar spam ao vivo):** alerta
    de posição (prio ≥ 70: jungler apareceu, intruso, mid indo) fala ≥ 5 s depois de uma fala informativa (prio
    < 50: feitiço voltou, pico, objetivo, ouro, regra) em vez de esperar 20 s e vencer na fila; marcado
    `furou` e aceito pelo ensaio; o resto segue 1 fala a cada 20 s ([COLETOR](../docs/COLETOR.md) § Avisos ao vivo).
    Feito 13/10/2026: ensaio `ok (0 falha(s))` (38 conferências): carregamento → `pronto` com a Riot API falsa,
    painel muda (prints no carregamento e aos 5, 15 e 25 min), CPU 2,5–2,8% de um núcleo a 1x e ~11% a 10x,
    29–31 falas por rodada sem repetição (menor intervalo 20,0 s), dragão 60 s antes nos 5, `POST /config` aplicado ao vivo,
    `EndOfGame` desliga em < 0,1 s sem thread viva, `GET /contexto` 200 logo no `EndOfGame` (o coach busca a
    partida na LCU antes do backfill), mentor e revisão depois do backfill, `dados/` intocado; `rodar-testes.py`
    → 25/25. **Não validado:** nada ao vivo (o coletor real roda o código antigo até o orquestrador reiniciar a
    tarefa); gank (o Gabriel jogou de selva na partida gravada); `mss` real a 6 fps (instalado, 10.2.0), moldura,
    overlay com F8 e atalho F9 só no ciclo de vida (o F8 sai no `parar()` do overlay); `claude -p` real a partir
    da tarefa agendada; previsão do jungler 1/26 a ≤ 1000 no ensaio (recorte a cada 10 s: o passo 15 mede).
    Decisões técnicas (opus 5.5; reversíveis): (a) a cola mora em `coach_vivo.py`, o `coletor.py` só chama
    `coach.fase/champ_select/pos_partida` (confiança alta; reverteria se o coletor precisasse do estado da
    partida); (b) config em `dados/config.json` com o cfg do plugin aceito inteiro (chaves em `coach`), uma
    constante (`servidor_local.CONFIG`); (c) previsão gravada = centro dentro da zona mais provável (confiança
    baixa: o ensaio não separa as duas; reverteria com o passo 15); (d) os dois caches estáticos
    (`catalogo.json` do ao vivo, `jogo-estatico.json` das sugestões) ficam separados por ora (unificar = mexer
    em duas frentes sem ganho medido).
    **Seção do 7b no plugin (13/10/2026):** Configurações › LOL-CLIENT ganhou os blocos Coach (estado da ligação),
    Painel ao vivo, Voz (liga e tom), Alertas na tela (moldura + os 12 tipos, que viram `avisosDesligados`), Minimapa
    e jungler (captura, overlay com F8 fixo, feitiços), Mentor (modelo e esforço), Tela de carregamento e Traumas;
    `cfg.coach` vai para `POST /config` na carga e a cada mudança. Prova: clique real numa caixa de tipo → log do
    servidor de teste com `avisosDesligados: ['mid_sumiu']` e de volta `[]`; `opus/high -> sonnet/medium` pelo
    `definir`; `Coach.configurar` aplica no `Mentor` (`haiku low`), valor fora da lista volta ao padrão.

### Fase E — fechamento

16. [ ] README (o coach: o que faz, como ligar/desligar cada parte), ARMADILHAS, COLETOR, hub,
    diário; commit e push.
    **prova:** `git status --porcelain | wc -l` → `0` e `origin/main` igual ao local
    **reprova se:** pendente
    **Fechamento (13/10/2026, sem commit: quem commita é o orquestrador):** `python tools/rodar-testes.py` →
    `27/27 ok` (`teste-ocr-chat` rc 2 = régua ok com < 10 pings; o `teste-mcp` termina em `ok` com o log do SDK
    no stderr); `python tools/ensaio-coach.py` (10x, 30 s a 1x, com prints) → 39 conferências, `ok (0 falha(s))`:
    CPU 3,2% de um núcleo a 1x e 12,0% a 10x (passo máx. 1229 ms numa leitura, p95 5,4 ms), 31 falas em 33 min
    sem repetição (menor intervalo 20,0 s), dragão 60 s antes nos 5, `EndOfGame` sem thread viva. `README.md`
    novo (o que faz, instalar, ligar e desligar cada parte, o que depende de partida, desinstalar: gatilho,
    junção do Pengu, porta 8888 do depurador, MCP, `dados\`, pastas do mentor); COLETOR linka o README; lista
    de validação ao vivo no topo deste plano. Arquivos da v2 em aberto no git (75 entradas, 96 arquivos
    novos): **alterados** `CLAUDE.md`, `coletor/{analise,banco,coletor}.py`, `docs/{ARMADILHAS,COLETOR,INSIGHTS,MERCADO}.md`,
    `mcp/servidor.py`, `pengu/{blocos,champselect,config,configuracoes,index}.js`, `pengu/estilo.css`,
    `pengu/posjogo/index.js`, este plano, `tests/fixtures/README.md`, `tools/teste-mcp.py`; **novos**
    `README.md`, `coletor/{alcance,ao_vivo,avisos,carregamento,coach,coach_vivo,draft,feiticos,janela_painel,jungler,mentor,minimapa,moldura,overlay_minimapa,riotapi,selva,servidor_local,sugestoes,voz}.py`,
    `docs/{ITENS,LICOES,MOBILIDADE,SELVA}.md`, `painel/` (3), `pengu/coach.js`, `pengu/posjogo/{abas,licoes}.js`,
    `pengu/posjogo/licoes.md`, `tests/fixtures/{chat-pings-20261013,jogo-estatico}.json`, `tests/fixtures/minimapa/`
    (30), `tools/{coletar-meta,ensaio-coach,rodar-testes,servidor-teste-plugin,simular-liveclient,validar-licoes}.py`
    e 18 provas `tools/teste-*.py|mjs`. Falta para o `[x]`: commit e push, hub e diário.

## Riscos / o que pode dar errado

- **Live Client sem dado de fog** (passo 9): a previsão perde a pista do farm; segue com tempo e rotas.
  **Aconteceu** (medido em 13/10/2026): o farm do inimigo não anda na fog. Ganho inesperado:
  objetivos e abates feitos por ele chegam globais em ≤ 1 s com `KillerName`.
- **Print pega o que estiver na tela** (medido em 13/10/2026: 11% dos recortes com navegador ou
  desktop, inclusive conteúdo pessoal): todo módulo de tela filtra "jogo na tela" antes de usar.
- **Minimapa muda de lugar e tamanho** com a configuração do HUD: calibrar pelo `game.cfg` a
  cada partida e logar o retângulo usado; print de calibração em `temp/`.
- **CPU**: cv2 a 6 fps num recorte pequeno é barato; medir o uso (< 5% de um núcleo) e cair para 3 fps se passar.
- **Excesso de informação ao vivo**: os 4 blocos são fixos; aviso novo só entra tirando outro (via-negativa).
- **Ban**: tudo aqui fica fora do processo do jogo. O risco residual é a política de terceiros da
  Riot (ordem ao jogador), assumido pelo Gabriel em 13/10/2026.
