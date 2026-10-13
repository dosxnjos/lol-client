# Plano — lol-client v2: coach (champ select, matchups, pós-jogo, ao vivo, minimapa) (2026-10-13)

Pedido: lol-client-v2-coach | o lol-client vira um coach pessoal: pós-jogo com painéis e lições, painel ao vivo na 2ª tela, previsão do jungler | de: gabriel | desde: 2026-10-13 | origem: chat

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
  aviso de voz a cada 20 s, fora o de gank.
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
coletor\jungler.py   previsão do jungler inimigo (última vez visto + farm do placar + rotas de selva)
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

- **2ª tela antes de overlay**: zero interação com a janela do jogo, legível, e o Gabriel já
  tem o monitor. Overlay vira proposta depois. Quem: opus 5.5; confiança alta.
- **Previsão do jungler é probabilística e honesta**: mostra "provável: selva top inimiga
  (visto há 25 s)" com um nível de confiança, nunca uma posição "certa". Sem visão recente →
  "sumido há X s" + farm do placar como pista.
- **Hipótese a medir antes de construir em cima**: o farm (`creepScore`) do inimigo na Live
  Client atualiza mesmo na fog (é o que o TAB mostra). Se não atualizar, a previsão usa só o
  tempo e as rotas típicas. Medir na 1ª partida real (passo 9).
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
   `EndOfGame`. **Falta a gravação de uma partida real** (só ela fecha readycheck, champ select real, live e timeline).

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
4. [ ] Selo do champ select (v1 7c) + matchup: quando o top inimigo travar (campeão visível no
   time inimigo com `assignedPosition` igual à minha, ou o único sem posição em blind), o selo
   ganha a linha "contra X: aV/bD · ouro10 ±N" (n ≥ 3; senão "contra X: n=1").
   **prova:** função pura `linhaMatchup(historico, meuCampeao, campeaoInimigo)` em
   `node tools/teste-matchup.mjs` contra a saída de `matchups()` em Python → `ok`
   **reprova se:** números diferentes

### Fase B — pós-jogo v2

5. [ ] `pengu/posjogo/licoes.md` (**arquivo dono**; o plugin importa com `?raw`, o Python lê o
   mesmo caminho; `docs/LICOES.md` é só um link para ele): regras em blocos `id / quando (expressão sobre métricas nomeadas) /
   prioridade / texto com {placeholders}`, ~20 regras iniciais cobrindo fase de rota, mortes
   cedo, mortes sozinho no lado inimigo, morte que custou objetivo, farm por minuto contra média,
   matchup, sessão (sequência e horário), e pelo menos 3 regras **positivas** ("rota limpa: 0
   mortes até os 15"). Métricas definidas com fórmula em `docs/INSIGHTS.md`.
   **prova:** `python tools/validar-licoes.py` (parse + toda métrica citada existe na spec) → `ok (N regras)`
   **reprova se:** métrica inexistente ou parse falha
6. [ ] Motor de lições: `coletor/coach.py` (Python, MCP e painel ao vivo) e
   `pengu/posjogo/licoes.js` (JS, pós-jogo), ambos lendo o mesmo `pengu/posjogo/licoes.md` (sem cópia).
   **prova:** para a partida de referência `3292712362` (fixtures), JS e Python devolvem as
   mesmas 3 lições, na mesma ordem (`node tools/teste-licoes.mjs` e `python tools/teste-licoes.py` → mesma linha impressa)
   **reprova se:** listas diferentes
7. [ ] Pós-jogo com abas: **Resumo** (3 lições no topo + resultado), **Rota** (curva de ouro e
   xp minuto a minuto tua contra o adversário, em SVG), **Mortes** (mapa da v1 + lista), **Objetivos**
   (linha do tempo), **Tendência** (esta partida contra as últimas 20 em 4 indicadores, com
   setas), **Sessão** (hoje: partidas, sequência, LP, alerta). Visual nativo do client; legível
   em 1280×720; Esc fecha. **Print de cada aba e olhar uma por uma** (6 abas em 1280×720 é denso).
   **prova:** eval após `analisarPartida(3292712362)`: `document.querySelectorAll('#lc-posjogo [data-aba]').length + '|' + document.querySelectorAll('#lc-posjogo .lc-licao').length` → `6|3`; print conferido
   **reprova se:** menos abas ou lições

### Fase C — painel ao vivo (2ª tela)

8. [ ] Laço ao vivo no coletor (só em `InProgress`): Live Client a cada 1 s, estado em memória,
   amostra a cada 10 s na tabela `ao_vivo` (game_time, por participante: nível, itens, ouro
   estimado, KDA, farm, morto); eventos novos na tabela `eventos_ao_vivo`. Servidor HTTP
   `127.0.0.1:8765` (`/` página, `/estado` JSON). Sem partida → `/estado` = `{"partida": false}`.
   Flag `--liveclient <url>` (padrão `https://127.0.0.1:2999`) para o simulador rodar em HTTP simples.
   **prova:** `python tools/simular-liveclient.py` (servidor falso em 2999 tocando um
   `allgamedata` gravado de 3 momentos) + `curl -s 127.0.0.1:8765/estado` → JSON com 10 jogadores e `ouroEstimado` > 0
   **reprova se:** `partida:false` com o simulador de pé
9. [ ] **Medição numa partida real** (com o Gabriel, numa normal antes de usar na ranqueada):
   gravar `allgamedata` bruto a cada 1 s em `temp/` por 5 min; responder no ARMADILHAS: o
   `creepScore` do inimigo muda quando ele está na fog? `position` dos inimigos vem preenchida?
   itens do inimigo atualizam na fog?
   **prova:** `python tools/analisar-gravacao.py temp/live-*.jsonl` → as três respostas com evidência (timestamps)
   **reprova se:** gravação vazia
10. [ ] Página `painel/`: 4 blocos fixos (Tua rota · Ameaça · Teu padrão · Time e objetivos)
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
11. [ ] Abrir e fechar o painel sozinho: `InProgress` → Edge em modo app no `DISPLAY1`;
    `EndOfGame` → fecha a janela (pelo pid guardado). Usar `--user-data-dir=dados\edge-painel`:
    sem isso o `msedge --app` reaproveita o Edge já aberto, o pid devolvido morre na hora e a
    janela não fecha. Desliga pela seção do 7b
    ("painel ao vivo na 2ª tela").
    **prova:** com o simulador, mudar a fase falsa e conferir a janela (`tasklist` com o pid) → abre e fecha
    **reprova se:** janela não abre ou fica órfã
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

### Fase D — minimapa e jungler

13. [ ] `coletor/minimapa.py`: captura da região do minimapa (calcular pela resolução,
    `MinimapScale` e `FlipMiniMap` do `game.cfg`; calibrar com um print real) a ~6 fps; detecção
    dos ícones dos 5 inimigos por template (ícones de `/lol-game-data/assets/v1/champion-icons/{id}.png`,
    recortados em círculo e redimensionados ao tamanho do ícone no minimapa) + borda vermelha;
    devolve `{campeao: (x, y no mapa 0–14870, visto_em)}`.
    **prova:** `python tools/teste-minimapa.py tests/fixtures/minimapa-*.png` (prints reais do
    minimapa tirados numa partida, com as posições anotadas à mão num `.json` ao lado) → acerto ≥ 80% dos ícones a ≤ 600 unidades
    **reprova se:** acerto < 80%
14. [ ] `coletor/jungler.py`: estado do jungler inimigo = última posição vista + tempo desde
    então + (se o passo 9 confirmar) variação do farm dele + horários de nascimento dos campos;
    distribuição sobre zonas (selva top/bot inimiga, rio, selva aliada top/bot, rota X) com
    confiança; alerta "gank provável top" quando a massa na zona perto da minha rota passa de um
    limiar e eu estou adiantado na rota sem ward conhecida (não temos wards: só posição).
    **prova:** `python tools/teste-jungler.py` com 5 cenários sintéticos (visto no azul inimigo aos
    3:15 → aos 3:40 provável rio top; sem dado → "sumido"; …) → `5/5 ok`
    **reprova se:** cenário falha
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
    - **Peso pelas pistas** do passo 14 (farm subindo → campos; abate com assistência dele → lugar
      e hora) vira mapa de calor em vez de mancha uniforme.
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
15c. [ ] **Alertas visuais na tela** (pedido do Gabriel, 13/10/2026). Overlay de tela inteira,
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
    **prova:** `python tools/teste-alertas.py` com sequências sintéticas de detecções (jungler
    aparece no rio top; mid some 8 s e reaparece no top; suporte inimigo entra na rota top) → os 3
    alertas certos, sem repetição em 10 s → `3/3 ok`
    **reprova se:** alerta errado, faltando ou repetido
15d. [ ] **Inteligência de selva inimiga** (pedido do Gabriel, 13/10/2026). Tabela curada
    `docs/SELVA.md` (campos, ouro e farm por campo, nascimento e renascimento do patch atual, com
    fonte e data; conferir na wiki a cada patch) + estado por campo inimigo:
    - **lado de início do jungler** pelo 1º avistamento, pelo farm aos ~1:45 e pelo nível 2/3;
    - **campos provavelmente limpos**: farm do inimigo subindo (se o passo 9 confirmar) somado ao
      horário e à posição, com renascimento contado a partir daí;
    - **previsões úteis**: "jungler nível 3 por volta de 3:15 perto do top" (janela de gank),
      "campos top inimigos livres" quando ele foi visto no bot (para contra-selva quando o Gabriel
      joga de Zac), "caranguejo do rio nasce em 30 s";
    - o minimapa já mostra o timer dos campos que tu viu morrer (`MinimapEnableAllTimers=1`): ler
      esses timers por OCR como confirmação, quando aparecerem.
    **prova:** `python tools/teste-selva.py`: farm 0→4→8→12 aos 1:45/2:05/2:30 + visto no
    vermelho inimigo aos 1:35 → início no vermelho, 3 campos limpos na ordem certa, nível 3 previsto
    entre 3:00 e 3:30 → `ok`
    **reprova se:** lado ou ordem errados
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
15f. [ ] **Sugestões aceitas pelo Gabriel em 13/10/2026 ("quero todas")**:
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

### Fase E — fechamento

16. [ ] README (o coach: o que faz, como ligar/desligar cada parte), ARMADILHAS, COLETOR, hub,
    diário; commit e push.
    **prova:** `git status --porcelain | wc -l` → `0` e `origin/main` igual ao local
    **reprova se:** pendente

## Riscos / o que pode dar errado

- **Live Client sem dado de fog** (passo 9): a previsão perde a pista do farm; segue com tempo e rotas.
- **Minimapa muda de lugar e tamanho** com a configuração do HUD: calibrar pelo `game.cfg` a
  cada partida e logar o retângulo usado; print de calibração em `temp/`.
- **CPU**: cv2 a 6 fps num recorte pequeno é barato; medir o uso (< 5% de um núcleo) e cair para 3 fps se passar.
- **Excesso de informação ao vivo**: os 4 blocos são fixos; aviso novo só entra tirando outro (via-negativa).
- **Ban**: tudo aqui fica fora do processo do jogo. O risco residual é a política de terceiros da
  Riot (ordem ao jogador), assumido pelo Gabriel em 13/10/2026.
