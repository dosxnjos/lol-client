# INSIGHTS — spec das heurísticas do pós-jogo

Dona única das regras do pós-jogo. Duas implementações seguem este arquivo à risca:
`pengu/posjogo/` (JS, lê a LCU direto) e `coletor/analise.py` (Python, lê o SQLite).
Mudou a regra? Muda aqui primeiro, depois as duas, e o caso de teste no fim.

Medido em 13/10/2026 (patch 16.20, `gameVersion` 16.20.824.8524) sobre as 20 partidas
de Summoner's Rift que a LCU devolvia. Unidades: tempo em **ms** (`timestamp`), duração
da partida em **s** (`gameDuration`), posição em unidades do mapa.

### Fontes e campos confirmados

| dado | JS (LCU) | Python |
| --- | --- | --- |
| eu | `GET /lol-summoner/v1/current-summoner` → `puuid` | puuid gravado pelo coletor |
| partida | `GET /lol-match-history/v1/games/{gameId}` | tabela `partidas` (json bruto do mesmo endpoint) |
| linha do tempo | `GET /lol-match-history/v1/game-timelines/{gameId}` | tabelas `frames`/`eventos` (mesmos campos) |
| histórico | `GET /lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=19` | tabela `partidas` |

Campos usados (nomes reais):

- partida: `gameId`, `mapId` (11 = Rift), `queueId`, `gameCreation` (ms epoch),
  `gameDuration` (s), `participantIdentities[].participantId`,
  `participantIdentities[].player.puuid`, `participants[].participantId`,
  `participants[].teamId` (100 ou 200), `participants[].championId`,
  `participants[].stats.{win, deaths, totalMinionsKilled, neutralMinionsKilled}`.
- linha do tempo: `frames[]` com `timestamp` (ms), `participantFrames["<pid>"]` (chave
  **string**) com `position{x,y}`, `totalGold`, `xp`, `minionsKilled`,
  `jungleMinionsKilled`, `level`; `frames[].events[]` com `type`, `timestamp`,
  `position{x,y}`, `killerId`, `victimId`, `assistingParticipantIds`, `teamId`,
  `monsterType`, `monsterSubType`, `buildingType`, `laneType`, `towerType`.
- `frames[0]` é o minuto 0; há 1 frame por minuto (`timestamp` ≈ i·60000, deriva de
  centenas de ms) e **o último frame é o fim da partida** (`timestamp` = duração, fora da grade).
- O último frame bate com `stats`: `minionsKilled` = `totalMinionsKilled`,
  `jungleMinionsKilled` = `neutralMinionsKilled`; mortes por `CHAMPION_KILL` = `stats.deaths`
  (20/20 partidas).
- No histórico, `participants[]` traz **só o próprio jogador** (`participants[0]`, com o
  `participantId` real da partida).

Só se analisa partida com `mapId == 11`; outra → painel diz "só Summoner's Rift" e para.

### Identificação do jogador e do adversário de rota

**Eu** = o `participantId` cuja entrada em `participantIdentities[]` tem
`player.puuid` igual ao puuid do current-summoner. Sem entrada → aborta ("partida de
outra conta"). `meuTime` = `teamId` desse participante; `timeInimigo` = 300 − `meuTime`.

**correção ao plano:** `participants[].timeline.lane/role` **não serve** e é ignorado.
Em 3292719721 os 10 vêm `NONE/SUPPORT`; em 3292712362 o top (Renekton) vem
`JUNGLE/NONE` com dois `JUNGLE/NONE` no mesmo time; em 3292656408 o time 100 não tem
`TOP`. O papel sai sempre da linha do tempo, pela regra abaixo (não é fallback, é a regra).

**Frame do minuto m** (`f(m)`): `frames[m]` só vale se `m < frames.length − 1` (não é o
frame final) **e** `|frames[m].timestamp − m·60000| ≤ 5000`. Senão, `f(m)` não existe.

**Papéis**, para cada time (100 e 200) separadamente:

1. Pré-requisitos: `f(10)` existe e o time tem exatamente 5 participantes. Se falhar em
   qualquer time → **sem papéis e sem adversário** (as mortes continuam; as diferenças
   somem).
2. `JUNGLE` = maior `jungleMinionsKilled` em `f(10)`; empate → menor `participantId`.
3. `UTILITY` = entre os 4 restantes, menor `minionsKilled` em `f(10)`; empate → menor `participantId`.
4. Para os 3 restantes, `s(p)` = média de `position.y − position.x` nos frames de índice
   3 a 10 inclusive (8 frames, divide por 8, sem arredondar). Ordena por `s`
   decrescente (empate → menor `participantId`): 1º = `TOP`, 2º = `MIDDLE`, 3º = `BOTTOM`.
5. `folga(time)` = `min(s1 − s2, s2 − s3)` sobre os 3 ordenados.

**Adversário de rota** = o participante do `timeInimigo` com o mesmo papel que o meu.
**Adversário incerto** quando meu papel é `TOP`, `MIDDLE` ou `BOTTOM` e
`min(folga(100), folga(200)) < 2000` (rota trocada, roaming pesado): calcula igual, mas o
painel escreve "adversário provável". Nas 20 partidas a menor folga foi 4778.

Validação (20 partidas, 200 participantes): o papel por posição bateu 200/200 com a
ordem dos `participantId` (1–5 e 6–10 = TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY). Essa
ordem é só observação: **não usar como regra**.

### Coordenadas e regiões do mapa

Mapa de 0–14870 (x) × 0–14980 (y), origem no canto da base do time 100 (azul, embaixo à
esquerda); o time 200 fica em cima à direita. No SVG, y cresce para cima: desenhar com
`yTela = 14980 − y`. O mapa é simétrico por `(x, y) → (14870 − x, 14980 − y)` (torres
espelhadas a menos de 100 unidades). Constante `C = 14925` (= (14870 + 14980) / 2): a reta
`x + y = C` é o eixo do rio.

Classificação de um ponto `(x, y)` (inteiros), **nesta ordem**, a primeira que bater vence:

| # | condição | região absoluta |
| --- | --- | --- |
| 1 | `x² + y² < 5000²` | base do 100 |
| 2 | `(14870 − x)² + (14980 − y)² < 5000²` | base do 200 |
| 3 | `x < 2300` ou `y > 12680` ou `y − x > 9000` | rota top |
| 4 | `y < 2300` ou `x > 12570` ou `x − y > 9000` | rota bot |
| 5 | `abs(y − x) ≤ 1200` | rota meio |
| 6 | `abs(x + y − 14925) ≤ 1400` | rio |
| 7 | `x + y < 14925` | selva do 100 |
| 8 | senão | selva do 200 |

Região relativa ao jogador (a que se mostra e se testa): `base_aliada`/`base_inimiga`
(base do `meuTime` ou não), `rota_top`, `rota_meio`, `rota_bot`, `rio`,
`selva_aliada`/`selva_inimiga`. Oito valores, escritos exatamente assim.

Atributo extra `lado` (metade do mapa): `x + y < 14925` é o lado do 100, `> 14925` o do 200,
`== 14925` → `centro`; relativo: `aliado`/`inimigo`. Numa rota, `lado = inimigo` = passou
do meio da rota.

Referências medidas (eventos `BUILDING_KILL` e `ELITE_MONSTER_KILL`): torre externa top do
100 (981, 10441), do 200 (4318, 13875); torre externa bot do 100 (10504, 1029), do 200
(13866, 4505); torre externa meio do 100 (5846, 6396), do 200 (8955, 8510); torre de base
do meio do 100 (3651, 3696), do 200 (11134, 11207); Barão (5007, 10471); Dragão
(9837, 4397); Arauto/Larvas ≈ (4700, 10100).

Validação nas 20 partidas (papel pela regra acima; "esperado" = a própria rota ou
`base_aliada`; selva/rio/base para o jungle):

- minuto 1 e 2 de quem é `TOP` → `rota_top` em 77/80 (1 `rio` e 1 `selva_inimiga` no
  minuto 1, ainda andando; 1 `base_aliada` no minuto 2); meio → `rota_meio` 77/80; bot e suporte
  → `rota_bot` 157/160.
- minutos 2–8: TOP 95,7%, MIDDLE 90,7%, BOTTOM 96,4%, UTILITY 84,3%, JUNGLE 85,0%; o resto
  é roaming real (suporte no rio, jungle gankando rota).

### Mortes

Morte = evento `CHAMPION_KILL` com `victimId == eu`, em ordem de `timestamp`
(percorrer `frames` em ordem e `events` em ordem dentro do frame). Para cada uma:

- `ms` = `timestamp`; `t` = `mm:ss` de `floor(ms / 1000)` (minutos com 2 dígitos, sem hora; 61 min → `61:00`).
- `x`, `y` = `position` do evento; `regiao` e `lado` pela seção anterior, relativos ao `meuTime`.
- `matador` = `killerId` (0 = execução: torre, tropa ou monstro); `assistentes` =
  `assistingParticipantIds` como vêm.
- `inimigos` = `(killerId ≠ 0 ? 1 : 0) + assistingParticipantIds.length`.
- **Frame mais próximo**: entre **todos** os frames (inclusive o 0 e o final), o de menor
  `abs(frame.timestamp − ms)`; empate → o de menor `timestamp`. Guardar `frameMs`.
- `aliadosPerto` = `participantId`s do `meuTime`, exceto eu, cuja `position` nesse frame
  cumpre `(px − x)² + (py − y)² < 2000²` (estrito). Lista em ordem crescente.
- `objetivos` = eventos com `ms ≤ timestamp ≤ ms + 90000` (inclusivo nas duas pontas), em
  ordem da linha do tempo, que sejam:
  - `BUILDING_KILL` com `teamId == meuTime`. **O `teamId` do `BUILDING_KILL` é o dono do
    prédio destruído**, não quem destruiu (prova: torre externa bot em (10504, 1029) com
    `teamId` 100 e `killerId` 9, do time 200; 0 contradições nas 20 partidas). Vale com
    `killerId` 0 (tropa).
  - `ELITE_MONSTER_KILL` cujo time matador é o `timeInimigo`. **O `teamId` desse evento vem
    sempre 0**: time matador = time do `killerId`; se `killerId == 0`, time do
    `assistingParticipantIds[0]`; sem nenhum dos dois → ignora o evento (3 de 170 eventos
    de monstro tinham `killerId` 0). Cada evento conta sozinho (cada Larva do Vazio,
    `HORDE`, é um item).
  - Item: `{tipo, detalhe, rota, ms}` com `tipo` = `monsterType` ou `buildingType`,
    `detalhe` = `monsterSubType` ou `towerType`, `rota` = `laneType` (`""` em monstro).

### Diferenças aos 10 e 15 min

Para `m` em 10 e 15, se `f(m)` existe **e** há adversário:

- `ouro` = `totalGold(eu) − totalGold(adv)`
- `xp` = `xp(eu) − xp(adv)`
- `farm` = `(minionsKilled + jungleMinionsKilled)(eu) − (minionsKilled + jungleMinionsKilled)(adv)`

Positivo = eu à frente. Inteiros, sem arredondamento. Sem `f(m)` (partida curta) ou sem
adversário → a chave do minuto **não aparece** (nem zero, nem null). Guardar também os
valores absolutos dos dois (`eu`, `adv`) para depurar.

### Farm por minuto vs média das últimas 20 partidas com o mesmo campeão

- `valor` = `(stats.totalMinionsKilled + stats.neutralMinionsKilled) / (gameDuration / 60)`
  da partida analisada.
- **Amostra**: partidas do histórico com o mesmo `championId` do jogador, `mapId == 11`,
  `gameDuration ≥ 300` (fora remake), `gameCreation` **menor** que o da analisada,
  `gameId` diferente e `queueId ∉ {0, 3100, 3140}` (personalizada e Modo Treino: farm perto
  de 0 puxaria a média para baixo; constante `FORA_DAS_CONTAS` nas duas implementações).
  Qualquer outra fila entra. A "última partida" (análise sem `gameId`) usa o mesmo filtro
  de mapa, duração e fila. Ordena por `gameCreation` decrescente e pega as 20
  primeiras. Cada partida contribui com o próprio farm por minuto (mesma fórmula).
- `media` = média aritmética simples dos farms por minuto da amostra (não é farm total ÷
  minutos totais). `n` = tamanho da amostra. `n < 3` → `media = null` e o painel diz
  "amostra insuficiente (n)".
- `diferenca` = `valor − media`.
- Fonte: JS usa o histórico da LCU (`participants[0].stats` de cada partida); Python usa a
  tabela `partidas` com o próprio participante achado pelo puuid.
- **correção ao plano:** a LCU devolve **só as 20 partidas mais recentes**, ignorando
  `begIndex`/`endIndex` (testado 13/10/2026: 0–199, 0–99, 0–49, 20–39, 100–119, 180–199 e
  a rota com puuid; todas → as mesmas 20; às 04:50 do mesmo dia a mesma rota devolveu 200,
  depois voltou a 20: depende do cache do client, ver ARMADILHAS). Logo no JS a amostra
  costuma ter no máximo 19, e o
  Python, com mais histórico no banco, pode dar `n` e `media` diferentes. Divergência
  esperada; o teste cruzado de farm usa a lista fixa de `gameId`s do caso de referência.
- Arredondar só na exibição (1 casa decimal); testes comparam com tolerância 0,01.

### Formato do resultado

As duas implementações devolvem a mesma estrutura (nomes exatos; JS em objeto, Python em dict):

```json
{
  "gameId": 0, "participantId": 0, "time": 100, "campeao": 0, "papel": "TOP",
  "adversario": { "participantId": 0, "campeao": 0, "incerto": false },
  "mortes": [
    { "ms": 0, "t": "mm:ss", "x": 0, "y": 0, "regiao": "rota_top", "lado": "aliado",
      "matador": 0, "assistentes": [], "inimigos": 0, "frameMs": 0, "aliadosPerto": [],
      "objetivos": [ { "tipo": "DRAGON", "detalhe": "FIRE_DRAGON", "rota": "", "ms": 0 } ] }
  ],
  "diffs": { "10": { "ouro": 0, "xp": 0, "farm": 0, "eu": {"ouro": 0, "xp": 0, "farm": 0}, "adv": {"ouro": 0, "xp": 0, "farm": 0} } },
  "farm": { "valor": 0.0, "media": 0.0, "n": 0, "diferenca": 0.0 }
}
```

Sem papéis → `papel: null`, `adversario: null`, `diffs: {}`. As chaves de `diffs` são
**strings** `"10"` e `"15"` (no Python também, nunca `int`). `n < 3` → `media` e
`diferenca` = `null`.

### Matchups

Agregado do histórico por **(meu campeão, meu papel, campeão adversário de rota)**, com filtro
opcional pelo meu campeão. Python: `analise.matchups(c, campeao=None)`; MCP: `matchups()`; o selo do champ
select (passo 4 do plano v2) segue a mesma regra.

- **Partidas elegíveis**: `mapId == 11`, com linha do tempo, `queueId ∉ FORA_DAS_CONTAS`,
  `gameDuration ≥ 300` (fora remake). Cada uma passa pela análise acima.
- **Fora da conta** (contadas em `fora`, nunca somem caladas): sem papéis (`sem_papel`, ex.:
  sem `f(10)`) e adversário incerto (`incerto`). Soma dos `n` = elegíveis − `fora`.
- Por grupo: `n`, `vitorias`; `ouroM`, `xpM`, `farmM` (M = 10 e 15) = média aritmética das
  diferenças `eu − adv` da seção "Diferenças", só das partidas que têm `f(M)` (`n10`, `n15`
  dizem quantas); `mortes10` = média de mortes com `ms < 600000`, separadas em `solo10`
  (`inimigos == 1`) e `gank10` (`inimigos ≥ 2`); execução (`inimigos == 0`) só entra no total.
- **Amostra mínima**: `n < 3` → `winrate` e todas as médias = `null` e `conclusao: false`
  (mostra só `n` e `vitorias`, "pouca amostra"). Mesmo corte do farm por minuto. **`n` aparece sempre.**
- Ordem: `n` decrescente, depois vitórias, meu campeão, papel e id do adversário.
- Arredondar só na exibição (ouro e xp inteiros, farm e mortes com 1 casa).

Conferência (13/10/2026, banco com 172 partidas elegíveis): Renekton (58) → 86 elegíveis, 1
incerta, 85 em 43 grupos (soma dos `n` = 85); o maior é TOP contra Aatrox (266), n = 7.

### Winrate no champ select (selo `#lc-winrate`)

Plano v1, passo 7c. JS em `pengu/champselect.js` (`estatisticasCampeao`); conferência
independente em Python: `tools/teste-winrate.py` (par do `tools/teste-winrate.mjs`).

- **Fonte**: lista do histórico da LCU (`.../current-summoner/matches`), sem linha do tempo.
  Cada leitura soma ao cache por `gameId` (a LCU devolve 20 ou 200, ARMADILHAS); o cache só cresce na sessão.
- **Conta**: `mapId == 11`, `gameType == "MATCHED_GAME"` (fora personalizada e treino) e sem
  `stats.gameEndedInEarlySurrender` (remake). Qualquer fila com matchmaking entra.
- **Posição da partida** = `stats.roleBoundItem` (item da missão de função, nomes conferidos
  em `items.json` em 13/10/2026): 1200, 1220, 1221, 1222 → `TOP`; 1201, 1206 → `MIDDLE`;
  1202, 1207 → `BOTTOM`; 1203, 1208, 2055 → `UTILITY` (2055, sentinela de controle, ocupa o
  espaço da missão de suporte); 1204, 1205, 1209, 1210 → `JUNGLE`. Outro valor (0 em
  treino) → Golpear (feitiço 11) = `JUNGLE`, senão posição desconhecida (só entra no geral).
  `timeline.lane/role` não serve (ver acima). A posição pedida vem de
  `myTeam[].assignedPosition` (minúscula: `"top"`); vazia → só a linha geral.
- **Números**: `n`, `vitorias`, `winrate` = `round(v/n·100)`, `k`, `d`, `a` médios e
  `kda = (K+A)/max(1,D)` sobre os totais, com 1 casa (meia unidade para cima, como `Math.round`).
  Sem partida → "sem partidas". O selo mostra o tamanho do histórico lido.

Conferência (13/10/2026, 200 partidas): Renekton 86 · 49% · KDA 1,5 (topo, as mesmas 86);
Zac 63 · 49% · 2,4, na selva 61 · 48% · 2,5; 24/24 recortes iguais ao Python.

### Limites conhecidos

- **1 frame por minuto**: posição, ouro e farm são amostras de até 30 s de distância do
  evento. "Aliados por perto" pode errar para os dois lados numa luta que se moveu.
- Aliado **morto** não é excluído de "aliados por perto" (o frame pode mostrá-lo na fonte
  ou ainda no lugar da luta).
- **Sem wards, compras, nível de habilidade nem placas de torre** na timeline da LCU:
  nada de visão ou de build entra na análise.
- Papel por posição pode errar em rota trocada ou suporte que farma; o sinal é
  `adversario.incerto`. A amostra de farm ignora o papel jogado com o campeão.
- Objetivo depois da morte é **correlação de tempo**, não causa: a morte pode não ter
  liberado o objetivo.
- Regiões são polígonos aproximados; pontos de borda (entrada do rio, quina da rota)
  caem num lado ou outro por poucas centenas de unidades.
- **Heurística ≠ veredito**: o painel mostra padrões ("3 de 5 mortes na metade inimiga da
  rota sem aliado perto"), nunca "você errou aqui".

### Caso de teste de referência

**gameId 3292712362** — ranqueada solo/duo (420), 13/10/2026 03:25 UTC, 1826 s (30:26),
vitória do time 100. Calculado por `temp/insights_calc.py` (gitignored) sobre os JSON
baixados da LCU, que ficam versionados em [tests/fixtures/](../tests/fixtures/README.md)
(a LCU guarda só 20 partidas e esta sai do histórico depois de umas 18 novas); os dois
testes (`tools/teste-posjogo.mjs`, `tools/teste-analise.py`) leem de lá.

Identificação: eu = `participantId` 1, time 100, `championId` 58 (Renekton), papel `TOP`.
Adversário = `participantId` 6, `championId` 83, `incerto: false`
(`folga(100)` = 4778, `folga(200)` = 7810).

**5 mortes** (= `stats.deaths`):

| # | t | ms | (x, y) | regiao | lado | matador | assistentes | inimigos | frameMs | aliadosPerto | objetivos (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 09:21 | 561338 | (13098, 3301) | rota_bot | inimigo | 10 | [9] | 2 | 540210 | [4, 5] | HORDE 566949, HORDE 570923 |
| 2 | 11:07 | 667090 | (1126, 10559) | rota_top | aliado | 6 | [] | 1 | 660236 | [] | — |
| 3 | 16:07 | 967911 | (1026, 9790) | rota_top | aliado | 6 | [] | 1 | 960324 | [3] | TOWER_BUILDING/OUTER_TURRET/MID_LANE 979933, DRAGON/HEXTECH_DRAGON 1038827 |
| 4 | 24:05 | 1445508 | (7324, 8832) | rio | inimigo | 9 | [10] | 2 | 1440453 | [4, 5] | TOWER_BUILDING/INNER_TURRET/TOP_LANE 1475331 |
| 5 | 29:45 | 1785889 | (12677, 13791) | base_inimiga | inimigo | 9 | [7, 8, 10] | 4 | 1800548 | [3, 4, 5] | — |

Armadilhas que o caso cobre: na janela da morte 1 o `FIRE_DRAGON` (631726) foi do
**próprio** time (killer 2) e fica fora; na morte 3 o `RIFTHERALD` (1044171, killer 3)
também fica fora; a morte 5 usa o frame **final** (1800548 é o mais próximo); a morte 4
tem `y − x` = 1508, fora do meio (≤ 1200), e cai no rio.

**Diferenças** (eu − adv; `f(10)` em 600211 ms, `f(15)` em 900303 ms):

| min | ouro | xp | farm | eu (ouro, xp, farm) | adv (ouro, xp, farm) |
| --- | --- | --- | --- | --- | --- |
| 10 | +171 | −134 | 0 | 3334, 4670, 67 | 3163, 4804, 67 |
| 15 | −368 | −554 | +1 | 4678, 7959, 108 | 5046, 8513, 107 |

**Farm por minuto**: `valor` = 240 / (1826 / 60) = 7,8861; `media` = 7,4437, `n` = 16
(janela da LCU em 13/10/2026), sobre estes `gameId`s:
3292673407, 3292656408, 3292611857, 3292592702, 3291749162, 3291733499, 3291720658,
3291708550, 3291333732, 3291279167, 3291267798, 3291245839, 3291218155, 3291213848,
3291213653, 3291211660. Com mais histórico no banco, o Python pode achar até 4 a mais;
para conferir, restrinja a amostra a esta lista.

Conferência mínima das implementações (passos 12 e 13 do plano): 5 mortes com as regiões
acima, na ordem, e as diferenças aos 10 min `{ouro: 171, xp: -134, farm: 0}`.
