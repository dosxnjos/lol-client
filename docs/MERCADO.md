# Mercado: análise de jogadores e campeões no champ select e no carregamento

Pesquisa de 13/10/2026: o que os apps do mercado mostram, que dado sustenta cada "tag", quanto
dá para prever o resultado, de onde tirar winrate e matchup, o que a Riot permite e a proposta
para o lol-client. Plano vigente: [v2 coach](../roadmap/2026-10-13-lol-client-v2-coach.md).
Chave e erros da Riot API: [ARMADILHAS § Riot API](ARMADILHAS.md#riot-api-servidores-da-riot-não-a-lcu).

**Como ler as fontes.** `[oficial]` = site/guia do próprio app ou doc da Riot; `[concorrente]` =
blog de app rival (quase todo comparativo de 2026 é da Hexgate ou da iTero, que vendem contra os
outros); `[terceiro]` = blog independente; `[código]` = repositório lido; `[marketing]` =
alegação sem benchmark, não usar como fato.

## 1. Panorama dos apps

| app | momento | o que mostra | previsão de vitória |
| --- | --- | --- | --- |
| [Porofessor](https://porofessor.gg/) | carregamento (a live page exige "loading screen or it must have started" `[oficial]`); champ select só colando o chat (não funciona na Solo/Duo) | por jogador: elo, WR, jogos, rota, mais jogados, "Player Tags" e "Team Tags"; base = últimos 30 dias de normal e ranqueada `[oficial]` | não |
| Blitz.gg | carregamento (rank, WR, forma recente, mais jogados) `[concorrente]` | tags "Autofill", "Dies Early", "Bad Laner" (só a [iTero](https://www.itero.gg/articles/what-is-the-best-league-of-legends-companion-app-in-2025) cita, `[concorrente]`); sugestões de pick, gráfico de dano dos times | só pós-jogo ("Win Probability Change" por morte) |
| [Mobalytics](https://mobalytics.gg/blog/lol-how-to-use-mobalytics-overlay-live-companion/) | champ select (aliados, no hover) e carregamento (inimigos) `[oficial, guia antigo]` | elo, feitiços, runas, jogos e WR **na rota e no campeão**, badges verde/vermelho/amarelo (ex.: "Wrecking Ball") | não |
| [OP.GG Desktop](https://op.gg/desktop/en/patch-notes) | pick-ban (aliados) `[marketing]`, overlay in-game | dados de jogador, build, timers; chatbot de IA | não encontrada |
| U.GG app | champ select `[oficial, snippet]` | picks, counters, sinergia, import de runas/itens | não encontrada |
| [iTero](https://www.itero.gg/) | champ select ("AI Drafting Coach"), matchup após lock-in | ranking de picks pelo teu histórico e pool; matchup 1v1 por nível in-game | não mostra %; ranqueia picks pelo WR da comp |
| [Hexgate](https://hexgate.app/blog/porofessor-alternatives/) | carregamento ("Lane Scouting", só Pro+) | lado de início e rota de gank do jungler inimigo, mortes cedo e CS aos 10 do oponente | não |
| [LoLTheory](https://blog.loltheory.gg/what-is-loltheory/) | champ select | "Score = win rate minus risk", personalizado pelo teu histórico (10 patches) | não mostra % do time |
| League of Graphs | carregamento (checker ao vivo) `[terceiro]` | 10 jogadores, elo, WR no campeão, forma (win/lose streak) | não |
| [Facecheck](https://facecheck.overwolf.com/) | champ select e carregamento | "smart Tags" de jogador e campeão, sem nomes publicados `[marketing]` | não |
| [LoLDraftAI](https://loldraftai.com/) | champ select | % calibrado só do draft (10 picks), sem dado de jogador | **sim**: 56,7% de acurácia declarada `[oficial, autodeclarado]` |
| [DraftGap](https://draftgap.com/) (MIT, [código](https://github.com/vigovlugt/draftgap)) | champ select (sincroniza com o client) | % a partir de 50 somando WR, matchup e duplas em escala Elo | **sim** (método publicado no código) |
| [Should I Dodge](https://shouldidodge.lol/) | champ select (print ou montagem manual) | soma de log-odds do WR de cada campeão; admite não saber nada de jogador | sim, sem acurácia publicada |
| [Champ Select Coach](https://www.overwolf.com/app/samuel_blad-champ_select_coach) | champ select | vencedor previsto e nota por jogador; "2x mais preciso que estatística" `[marketing]` | sim, sem benchmark |

**Conclusões.** (1) Nenhum app grande de scouting (Porofessor, Blitz, Mobalytics, OP.GG, U.GG)
mostra "% de chance de vencer" antes do jogo; quem mostra são ferramentas só de draft.
(2) Análise de **jogadores** começa no carregamento em todos eles: é regra da Riot (seção 6),
não escolha de produto.

## 2. Catálogo de tags

Nenhum app grande publica o limiar das tags (busca por OTP, smurf, streak, "dies early",
autofill: nada, nem oficial nem de terceiro). Os **únicos limiares literais** achados são do
TrueMain, app desktop open source que faz exatamente o caso do lol-client (LCU + carregamento):
[`player-intel.ts`](https://github.com/ilyanfraimbault/TrueMain) (branch develop, SHA 2712c61;
issues #1753 e #1910, 01–06/10/2026). Princípio declarado lá: "counts and ratios only — no score
made of them". Os limiares abaixo marcados *proposta* são ponto de partida, a calibrar com dado.

| tag | definição / limiar | fonte | dado necessário | calcula com Riot API? |
| --- | --- | --- | --- | --- |
| Win streak / Lose streak | 3+ seguidas (`MIN_STREAK = 3`) | TrueMain `[código]`; Porofessor, Blitz, League of Graphs citam sem limiar | resultado das últimas partidas em ordem | sim: match-v5 ids + partidas. `hotStreak` do league-v4 é o único sinal oficial, só de vitória, **limiar não documentado** |
| Autofill / fora da rota | fatia na rota < 25% (≥ 50% = main, 25–50% = secundária), com ≥ 3 jogos de rota conhecida | TrueMain `[código]` | `teamPosition` das últimas partidas × posição atual | sim: match-v5 `teamPosition` |
| OTP (one-trick) | sem limiar publicado; *proposta*: ≥ 60% das últimas 20 no mesmo campeão **ou** maestria do campeão ≥ 5× a do 2º | Porofessor (nome), Hexgate `[concorrente]` | partidas recentes + maestria | sim: match-v5 + champion-mastery-v4 `/top` |
| Primeira vez / "First Game" | 0 jogos no campeão entre os lidos | TrueMain `[código]`; Mobalytics (nome, via iTero) | partidas recentes + maestria | sim (maestria baixa confirma) |
| Experiência no campeão | maestria < 5 mil → 41,5% de WR; > 500 mil → 54,5%; de 2,5 mil a 7,5 mil ≈ +8 pp; recomenda ≥ 5 jogos antes de ranqueada | [iTero, 08/09/2022, > 1 M jogos](https://www.itero.gg/articles/draft-sq) `[concorrente]` | maestria no campeão | sim: champion-mastery-v4 `by-champion` |
| KDA bom no campeão | KDA ≥ 3 (`GOOD_KDA`) | TrueMain `[código]` | K/D/A das partidas no campeão | sim |
| Morre cedo / "Dies Early" | sem limiar publicado; *proposta*: média ≥ 1,5 morte antes dos 10 min nas últimas N partidas (o banco do Gabriel: 2+ mortes antes dos 10 → 43% de vitória) | Blitz (nome, via iTero), Hexgate (mortes cedo do oponente) | minuto de cada morte | **caro**: só a timeline do match-v5 traz o minuto; 1 chamada extra por partida |
| Perde a rota / "Bad Laner" | sem limiar publicado; *proposta*: `laningPhaseGoldExpAdvantage = 1` em < 35% das últimas N | Blitz (nome, via iTero) | vantagem de ouro+xp na fase de rota | sim: `challenges.laningPhaseGoldExpAdvantage` (0/1) e `earlyLaningPhaseGoldExpAdvantage` existem no [schema](https://www.mingweisamuel.com/riotapi-schema/openapi-3.0.0.json) do match-v5; **semântica sem descrição oficial**: conferir contra o próprio banco antes de usar |
| Agressivo na rota / solo kills | sem limiar; *proposta*: `challenges.soloKills` médio ≥ 1 | Porofessor ("Aggressive Laner", via iTero) | solo kills | sim: `challenges.soloKills`, `takedownsFirstXMinutes` |
| Visão ruim / "Bad Vision" | sem limiar; *proposta*: placar de visão/min abaixo da média do papel | Porofessor, Mobalytics ("Vision Focused") | `visionScore`, duração | sim |
| Smurf / conta nova | sem limiar; "Newbie" (Porofessor), "veteran"/"freshBlood" (league-v4, **semântica não documentada**) | wecoach `[terceiro]`, iTero `[concorrente]` | nível, jogos na season, WR | parcial; WR alto + poucos jogos é **cálculo de MMR implícito**: evitar (seção 6) |
| Comp: "Heavy AD/AP", "Good engage" | sem limiar; *proposta*: ≥ 70% do dano esperado de um tipo | Hexgate, Porofessor ("Team Tags") | tipo de dano do campeão | sim, com dado estático (Data Dragon/CommunityDragon); passo 15f.5 do plano já cobre |

Fontes dos nomes de tag: [iTero, 31/03/2026](https://www.itero.gg/articles/what-is-the-best-league-of-legends-companion-app-in-2025)
`[concorrente]`, [lolnow.gg, 17/12/2025](https://lolnow.gg/porofessor/) `[terceiro]`. Crítica
recorrente aos badges: "unclear badge names" e "info overload" (TrueMain #1910) → no lol-client,
tag com número ao lado ("3 derrotas seguidas", não só "tilt").

## 3. Previsão de vitória

**O que o mercado faz.** Só draft: DraftGap (rating estilo Elo, `rating = -400·log10(1/w - 1)`,
soma dos 5 campeões + duplas + 25 matchups − os do inimigo; encolhimento bayesiano de 250 a 3000
"jogos fictícios" contra amostra pequena), LoLDraftAI (rede neural sobre os 10 picks),
Should I Dodge (soma de log-odds). Com dado de jogador só o Champ Select Coach, sem benchmark.

**Acurácia realista** (fração de partidas cujo vencedor o modelo acerta):

| fonte | entrada | acurácia | confiança |
| --- | --- | --- | --- |
| [DraftRec, WWW 2022](https://arxiv.org/abs/2204.12750) (280 mil partidas, top 0,1%) | só draft | 52,6–52,8% | alta (tabela lida) |
| idem | draft + histórico dos jogadores | 54,1–55,4% | alta |
| [LoLDraftAI vs DraftGap, abr/2026](https://loldraftai.com/blog/draftgap-vs-loldraftai-comparison) (32.750 partidas) | só draft | 55,9% vs 54,7% (ECE 0,009 vs 0,020) | média: autor é concorrente |
| [LoLDraftAI](https://loldraftai.com/) | draft / + runas | 56,7% / 57,7% | baixa: autodeclarado |
| Chen et al. (citado em [arXiv 2108.02799](https://arxiv.org/html/2108.02799v1)) | experiência jogador-campeão | 60,2% | original não lido |
| [Do et al., FDG 2021](https://arxiv.org/html/2108.02799v1) | WR e maestria de cada jogador no campeão | 75,1% | **baixa**: 5 mil partidas, sem baseline de draft, risco de vazamento (WR da temporada inclui a partida prevista), validação acima do treino |
| [iTero, 2022](https://itero.gg/articles/the-draft-model) | draft em jogo profissional | 67–73% | baixa: autodeclarado, outro contexto |
| [paper de tempo real](https://arxiv.org/pdf/2309.02449) | estado da partida aos 25 min | 83,5% | contexto diferente (ao vivo) |

**Leitura honesta:** só draft acerta **52–57%**; com histórico de jogador bem modelado, **55–60%**.
O 75% é teto otimista, não expectativa. A variável que mais pesa é a **experiência do jogador no
campeão** (Chen; DraftRec; maestria na iTero), e quase todo campeão vive entre 46% e 54% de WR
([iTero](https://www.itero.gg/articles/draft-sq)). Benchmark de recomendação de pick da
[Winrate.gg, 28/04/2026](https://winrate.gg/articles/draft-recommendation-benchmark) (autor
interessado): pick sugerido venceu 55,1% (Winrate), 52,9% (iTero), 49,8% (LoLDraftAI); serve
como contraponto às alegações, não como prova.

**Proposta para o lol-client** (simples, calibrado, faixa e não número mágico):

1. Modelo em log-odds, aditivo, explicável termo a termo: `logit(p) = Σ draft + Σ jogador`.
   - **draft**: log-odds do WR de cada campeão na rota (BR, elo do Gabriel), encolhido para 50%
     com prior de ~1000 jogos; matchup de rota encolhido para o esperado pela diferença de rating
     (o método do DraftGap, MIT). Sinergia fica de fora na v1 (amostra não sustenta, seção 4).
   - **jogador** (só no carregamento): maestria/jogos no campeão (curva da iTero como prior),
     autofill, streak. Pesos pequenos e fixos de início; nada de "WR alto + poucos jogos" (MMR).
2. Mostrar **faixa**, não %: "equilibrada" (47–53%), "leve vantagem/desvantagem" (53–58% / 42–47%),
   "vantagem/desvantagem clara" (fora disso, raro). Ao lado, os 2–3 termos que mais pesaram
   ("Renekton vs Darius −2 pp, n=1.240") e o n de cada um.
3. **Calibrar** contra o próprio histórico: gravar a previsão de cada partida no retrato do champ
   select (passo 1) e, a cada 50 partidas, tabela de confiabilidade (previsto vs real por faixa) e
   Brier. Com 172 partidas no banco, o erro do WR observado por faixa é de ±7–10 pp: a calibração
   própria só corrige faixas grosseiras; até ter ~300 partidas, as faixas são o limite de precisão.
4. **Não recomendar dodge.** Com 52–57% de acerto, a diferença entre "leve desvantagem" e
   "equilibrada" é ruído do tamanho do custo de LP do dodge; a Riot também veta "apps that dictate
   player decisions" ([docs/lol](https://developer.riotgames.com/docs/lol)). O texto informa, não manda.

## 4. Fontes de dados de meta e matchup

A Riot API **não tem** endpoint de winrate nem de matchup: todo WR é de terceiro ou coleta própria.

| fonte | o que dá | acesso | termos | uso no lol-client |
| --- | --- | --- | --- | --- |
| Coleta própria (match-v5, Personal Key) | WR de campeão por rota, no BR e no elo certo | 100 req/2 min no balde `americas` ≈ 65–70 mil partidas/dia rodando 24 h | "gather your own stats", "personal research projects" ([portal](https://developer.riotgames.com/docs/portal)); varrer partidas de terceiros em massa é zona cinzenta, sem proibição explícita | **WR de campeão por rota: sim** (n = 2.500 de Renekton top ≈ 46 mil partidas, < 1 dia). **Matchup: não** (n = 1.000 de um matchup ≈ 730 mil partidas, ~1 patch inteiro) |
| Histórico do Gabriel (SQLite) | matchups dele (passo 2 do plano) | já existe | próprio | sim, com n ≥ 3 e o n sempre visível |
| [OP.GG MCP](https://github.com/opgginc/opgg-mcp) (`https://mcp-api.op.gg/mcp`, MIT, org opgginc) | `lol_get_champion_analysis` (WR, counters, sinergia), `lol_get_lane_matchup_guide`, `lol_list_lane_meta_champions`, `lol_get_summoner_profile` | MCP; **autenticação e rate limit não documentados** | os [termos do site](https://op.gg/policies/agreement) (14/09/2026) proíbem scraping e só liberam uso pessoal; o MCP é canal do próprio dono dos dados (o repo não se declara "oficial") | **candidato para matchup agregado**, depois de testar acesso e limite |
| [Lolalytics](https://lolalytics.com/) | WR, matchup, duplas por elo (ex.: Renekton top Esmeralda+ 16.20: 64.758 jogos, 51,12%) | sem API pública | [aviso](https://a3.lolalytics.com/): "API privada", dados com copyright, "não podem ser usados por terceiros" | **não** (o DraftGap raspa daqui; o código serve, os dados não) |
| U.GG / Mobalytics | WR, matchup | sem API pública | termos devolveram 403; cláusula de scraping **não verificada** | não, até ler os termos |
| [Data Dragon](https://developer.riotgames.com/docs/lol) / CommunityDragon / [Meraki](https://github.com/meraki-analytics/lolstaticdata) | dados estáticos (habilidades, itens, tipo de dano) | livre | Meraki pede crédito | sim, para tags de comp |

**Margem do WR** (IC 95% ≈ ±1/√n): 250 jogos ±6,3 pp · 1.000 ±3,1 · 2.500 ±2,0 · 10.000 ±1,0.
Efeito real de matchup é de poucos pontos: abaixo de ~1.000 jogos o número não separa matchup bom de ruim.

**Recomendação.** (1) WR de campeão por rota: coleta própria via match-v5 no BR/elo do
Gabriel, renovada por patch. (2) Matchup: histórico dele (já planejado) + agregado do OP.GG MCP
se o teste de acesso passar, sempre encolhido pelo método do DraftGap. (3) Nunca raspar
Lolalytics. Reversível: a fonte entra atrás de uma função `wr(campeao, rota)` e troca sem mexer na tela.

## 5. Riot API

Rotas conferidas no [schema da comunidade](https://www.mingweisamuel.com/riotapi-schema/openapi-3.0.0.json)
(espelho gerado da referência oficial; o portal [developer.riotgames.com/apis](https://developer.riotgames.com/apis)
não renderiza sem JS). Endpoints por `summonerId`/`accountId` foram **removidos em 20/06/2025**
([RiotGamesDevRel](https://x.com/RiotGamesDevRel/status/1932188110454235582)): tudo por PUUID.

| API | path | host BR | uso no coach |
| --- | --- | --- | --- |
| account-v1 | `/riot/account/v1/accounts/by-riot-id/{gameName}/{tagLine}` · `/by-puuid/{puuid}` | `americas.api.riotgames.com` | Riot ID ↔ PUUID (dispensável quando o LCU já dá o PUUID) |
| league-v4 | `/lol/league/v4/entries/by-puuid/{puuid}` | `br1.api.riotgames.com` | elo, PDL, V/D da fila, `hotStreak` |
| champion-mastery-v4 | `/lol/champion-mastery/v4/champion-masteries/by-puuid/{puuid}/by-champion/{championId}` · `/top?count=` | `br1` | experiência no campeão, OTP |
| match-v5 | `/lol/match/v5/matches/by-puuid/{puuid}/ids?queue=&count=` (até 100) · `/matches/{matchId}` · `/timeline` | `americas` | streak, autofill, KDA, `challenges`; timeline só para "morre cedo" |
| spectator-v5 | `/lol/spectator/v5/active-games/by-summoner/{puuid}` (o parâmetro é PUUID) | `br1` | os 10 da partida a partir do carregamento; `puuid` **null** quando o jogador está anônimo |
| summoner-v4 | `/lol/summoner/v4/summoners/by-puuid/{puuid}` | `br1` | nível e ícone |

Sem chave nenhuma: LCU `/lol-gameflow/v1/session` (`gameData.teamOne/teamTwo` com `puuid` no
carregamento) e `/lol-match-history/v1/products/lol/{puuid}/matches` (últimos 20), o caminho do
TrueMain. Não gasta cota da Riot API, mas o LCU é "not officially supported"; **a verificar** se o
histórico de outro jogador pelo LCU traz `challenges` e `teamPosition`.

**Chaves** ([portal](https://developer.riotgames.com/docs/portal)):

| tipo | validade e uso | limite (por região de roteamento) |
| --- | --- | --- |
| Development | vence a cada 24 h; proibido produto público | igual à personal |
| **Personal** (recomendada) | "just the developer or a small private community", "gather your own stats"; registro sem verificação; sem aumento de limite | **20 req/1 s e 100 req/2 min** |
| Production | produto público, exige protótipo; dá RSO | 500/10 s e 30.000/10 min |

Revisão "typically weekly… sometimes up to three weeks" ([FAQ](https://developer.riotgames.com/docs/faqs));
"aprovação automática da personal" só em [blog](https://darkintaqt.com/blog/riot-app-application) (não oficial).

**Onde guardar:** já existe `LOL_RIOT_API_KEY` (chave de desenvolvimento) no Doppler pessoal;
configuração, 401 e User-Agent em [ARMADILHAS § Riot API](ARMADILHAS.md#riot-api-servidores-da-riot-não-a-lcu).
A personal substitui o valor no mesmo segredo. Nunca no repo, em log ou em doc.

**Passo que só o Gabriel faz** (logado na conta Riot dele): em
[developer.riotgames.com](https://developer.riotgames.com/) → *Register Product* → **Personal API
Key**, descrição: "coach pessoal local, uso só meu: meu histórico e os 10 jogadores da minha
partida a partir da tela de carregamento; usa LCU e Live Client Data API; endpoints account-v1,
league-v4, champion-mastery-v4, match-v5, spectator-v5". Aprovada, colar a chave no
`LOL_RIOT_API_KEY` do Doppler pessoal (`prd`).

## 6. Regras e fronteira

| fase | o que o client mostra | o coach pode analisar |
| --- | --- | --- |
| champ select **Solo/Duo** | aliados viram apelido (Gromp, Murk Wolf, Raptor, Krug, Scuttle Crab); o LCU manda `gameName` e `puuid` vazios; tu e o duo se veem | **só campeões** (picks, bans, rota provável, WR, matchup, força do draft) + as tuas stats e as do duo |
| champ select **Flex** | a [wiki](https://wiki.leagueoflegends.com/en-us/Team_drafting) e a [Overwolf](https://dev.overwolf.com/ow-native/guides/game-compliance/riot-games/) dizem só Solo/Duo; um post de 2022 citava "SoloQ and FlexQ" | **tratar como Solo/Duo**: analisar só quem veio com nome e `puuid` |
| champ select **normal draft** | nomes dos aliados visíveis | campeões + aliados |
| inimigos no champ select | ocultos "until the game begins" em qualquer fila | só os campeões deles |
| **tela de carregamento** | nomes de todos ("once in the loading screen, players will be able to see summoner names", [Overwolf](https://dev.overwolf.com/ow-electron/guides/game-compliance/league-of-legends/)) | primeiro momento legítimo para os **10 jogadores** |
| em jogo | Live Client devolve `riotId` de todos | painel ao vivo |

- **Teste de anonimato**: o que vale é **faltar o `puuid`**, não o `nameVisibilityType`. No
  carregamento o flag continua `HIDDEN` com nome e `puuid` preenchidos
  ([TrueMain PR #1823, 03/10/2026](https://github.com/ilyanfraimbault/TrueMain/pull/1823)).
  Streamer Mode ("Hide My Name"/"Hide My Everything", [patch 25.20](https://www.leagueoflegends.com/en-us/news/game-updates/patch-25-20-notes/))
  → `puuid` null também no carregamento: esse jogador **nunca** é consultado.
- **Política** ([docs/lol](https://developer.riotgames.com/docs/lol), [policies/general, 29/05/2025](https://developer.riotgames.com/policies/general)):
  "cannot identify or analyze players who are deliberately hidden by the game", "cannot
  de-anonymize players"; MMR/ELO calculators proibidos; "apps that dictate player decisions"
  proibidos (pode destacar decisões e dar opções). Desde o patch 12.22 (nov/2022) a Riot exigiu que
  Blitz e Porofessor removessem nome **e stats** de jogador no champ select
  ([devtrackers](https://devtrackers.gg/leagueoflegends/p/749a443a-apps-that-reveal-player-names-or-stats-in-champ-select-need-to-remove-these-informations-starting-patch-12-22)).
- **O que NÃO fazer** (fora sempre, mesmo com a autorização do Gabriel; bate com o
  [hub](../../cerebro/projetos/lol-client.md)): lobby reveal (interceptar RTMP e trocar `HIDDEN`
  por `VISIBLE`, [ex.](https://xbaank.github.io/blog/showing-names-in-soloq.html)), correlacionar
  `obfuscatedPuuid` ou qualquer campo do champ select com identidade, consultar o spectator
  durante o champ select atrás dos aliados. Relato de bans por lobby reveal detectado pelo
  Vanguard desde 05/2024: 2 semanas na 1ª infração ([mein-mmo](https://mein-mmo.de/en/lol-riot-bans-players-for-using-an-unfair-tool-caught-a-pro,1129299/),
  segunda mão, sem comunicado oficial). O coletor já não grava identidade do champ select
  (`limpar_sessao` em `coletor/coletor.py`).
- **Colisão com o plano**: a Riot/Overwolf proíbem desde 13/03/2025 timers de feitiço inimigo,
  **inclusive marcados à mão**, e "notifications that dictate player action based on the current
  game state" ([Overwolf](https://dev.overwolf.com/ow-native/guides/game-compliance/riot-games/)).
  O passo 15e (flash inimigo) e a voz do passo 12 caem nisso. Não é informação escondida (não fere
  a linha do hub) e o Gabriel assumiu o risco em 13/10/2026, mas o risco existe e fica registrado aqui.

## 7. Proposta para o lol-client

Onde aparece: champ select no **plugin Pengu** (o client está na frente); carregamento no **painel
da 2ª tela** (durante o carregamento o jogo ocupa o monitor principal; se o client minimiza, **a
confirmar**), que hoje o passo 11 abre em `InProgress`. Antecipar a abertura para a fase em que o
carregamento começa (`GameStart` precede `InProgress` no gameflow; qual delas cobre a tela de
carregamento **a confirmar** no `fases.jsonl` da gravação real do passo 0).

| # | fase | o que | dado | prioridade | esforço | relação com o plano |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | champ select | matchup do teu histórico contra o top inimigo travado | SQLite | P1 | P | já é o passo 4 |
| C2 | champ select | WR de cada um dos 10 campeões na rota provável + rota provável do inimigo | coleta própria (seção 4) | P1 | M | novo; **a verificar na gravação real** (passo 0) se `theirTeam[].assignedPosition` vem preenchido; vazio → inferir a rota pelo pickrate do campeão por rota |
| C3 | champ select | força do draft em faixa (seção 3), com os 2–3 termos que mais pesaram | C2 + matchup encolhido | P2 | M | novo |
| C4 | champ select | aliados com nome (normal draft) e o duo: elo, maestria e jogos no campeão escolhido | Riot API | P3 | P | novo; só quem veio com `puuid` |
| L1 | carregamento | 10 jogadores: elo, WR da fila, `hotStreak`, maestria no campeão | league-v4 + mastery no campeão + mastery `/top` (OTP), 27 chamadas no balde `br1` | P1 | M | novo |
| L2 | carregamento | tags (seção 2): streak, autofill, OTP/primeira vez, KDA no campeão, perde a rota | 9 × (1 ids + 5 partidas) ≈ 54 chamadas no balde `americas`, em segundo plano | P1 | M | novo; o que não chegar no carregamento aparece no painel ao vivo |
| L3 | carregamento | "morre cedo" do adversário de rota e do jungler inimigo | timeline (2 × 5 chamadas) | P2 | P | novo; espelha o Lane Scouting da Hexgate |
| L4 | carregamento | previsão em faixa draft + jogadores, gravada para calibrar | L1 + L2 + C3 | P2 | M | novo |
| L5 | carregamento | composição inimiga (AD/AP, cura, controle) + lembrete de build | estático | P2 | P | já é o 15f.5 |

**Orçamento** (Personal Key, 100 req/2 min por balde): com o PUUID vindo do gameflow do LCU não
se gasta account-v1; L1 cabe sobrado em `br1`; L2 com 5 partidas por jogador usa ~54% do balde
`americas`, com 10 estoura. Daí: 5 partidas, partida repetida entre jogadores (premades) baixada
uma vez, timeline só para L3. Alternativa sem cota: histórico pelo LCU (como o TrueMain), se a
verificação da seção 5 confirmar os campos.

### Decisões técnicas

- **Identidade dos outros 9 só em memória** (cache por PUUID durante a partida, nada em disco),
  mantendo a regra atual do coletor ("identidade de outros jogadores nunca vai para disco").
  Quem: opus 5.5 (subagente de pesquisa); confiança média. Reverteria: o rate limit obrigar cache
  entre partidas (jogador repetido em sequência); aí SQLite com expiração de 24 h e só PUUID +
  agregados, nunca nome.
- **Tags com número, sem score composto** (princípio do TrueMain): "3 derrotas seguidas", "12% de
  jogos de top", nunca uma nota única. Confiança alta.

### O que o pedido não dizia

- Fronteira do champ select (seção 6): jogadores só onde o client mostra o nome; o pedido falava
  de análise dos jogadores "na seleção", o que na Solo/Duo é a feature que a Riot mandou remover em 2022.
- "% de chance de vencer" virou faixa com termos visíveis e calibração contra o próprio histórico:
  o mercado acerta 52–60%, um número com casas decimais mentiria precisão.
- Colisão do passo 15e (flash inimigo) com a regra de 03/2025, registrada na seção 6.
- Rota do inimigo no champ select talvez não venha do LCU: verificar na gravação real antes do C2.
