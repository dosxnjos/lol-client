# Lições do coach

Arquivo **dono** das regras de texto do pós-jogo (plano v2, passos 5 e 6). Dois motores leem este
mesmo arquivo, sem cópia: `coletor/coach.py` (Python: MCP, coletor, painel ao vivo) e
`pengu/posjogo/licoes.js` (JS: pós-jogo no client, importado com `?raw`). Ajustar o tom é editar
texto aqui, não código. Métricas que as regras podem citar, com fórmula e fonte:
[docs/INSIGHTS.md § Métricas das lições](../../docs/INSIGHTS.md#métricas-das-lições).
Conferência: `python tools/validar-licoes.py` (parse + métrica existente) e
`python tools/teste-licoes.py` / `node tools/teste-licoes.mjs` (os dois motores, mesma saída).

## Como escrever uma regra

Cada regra é um bloco `### <id>` dentro de uma seção `## Regras…`, com linhas `- chave: valor`:

| chave | obrigatória | o quê |
| --- | --- | --- |
| `quando` | sim | expressão sobre métricas, entre crases (gramática abaixo) |
| `prioridade` | sim | inteiro; maior aparece antes |
| `tipo` | sim | `atencao` ou `positiva` |
| `grupo` | não | regras do mesmo grupo não aparecem juntas (fica a de maior prioridade) |
| `uso` | não | `posjogo` (padrão); outros usos ficam para o painel ao vivo |
| `texto` | sim | uma linha, com `{metrica}` ou `{metrica:formato}` |

Chave desconhecida é guardada e ignorada pelo motor (espaço para tons de voz, ícone etc.).
Texto fora de `## Regras…` não é regra (a seção `## Avisos ao vivo`, se existir, é do `coletor/avisos.py`).

**Expressão** (sem `eval`, parser próprio nos dois motores): números (`-400`, `0.3`), nomes de
métrica, `+ - * /`, comparação `== != > >= < <=` (uma por termo), `e`, `ou`, `não` (ou `nao`),
parênteses e `existe(metrica)`. Precedência: `ou` < `e` < `não` < comparação < `+ -` < `* /`.

**Nulo** (métrica sem dado: partida curta, sem adversário, matchup com n < 3, sem traumas):
conta com nulo dá nulo, divisão por zero dá nulo, comparação com nulo dá nulo; `e`/`ou`/`não`
seguem a lógica de três valores (falso `e` nulo = falso; verdadeiro `ou` nulo = verdadeiro);
a regra só dispara com resultado **verdadeiro**. Só `existe()` enxerga o nulo. Placeholder de
métrica nula também impede a regra de disparar.

**Formatos** do placeholder: nenhum (inteiro como inteiro, fração com 1 casa), `+` (sinal
explícito), `abs` (sem sinal), `int` (arredonda para inteiro; combina: `+int`), `pct` (inteiro
com `%`), `mmss` (milissegundos em `mm:ss`, sobre o valor absoluto; negativo ganha `−`). Arredondamento `floor(v × 10ᶜ + 0,5) / 10ᶜ` nos dois
motores, vírgula decimal, negativo com `−`.

**Escolha das 3 lições**: dispara quem tem `quando` verdadeiro e todos os placeholders com valor;
ordena por prioridade decrescente (empate: ordem neste arquivo); de cada `grupo` fica só a primeira;
pega as 3 primeiras. Se nenhuma das 3 for `positiva` e alguma positiva disparou, a melhor positiva
entra no lugar da 3ª (a lista volta a ser ordenada por prioridade).

Tom: padrão, não veredito ([INSIGHTS § Limites](../../docs/INSIGHTS.md#limites-conhecidos)): o
número primeiro, depois uma dica curta. Nada de "você errou".

## Regras do pós-jogo

### mortes-cedo-2
- quando: `mortes10 >= 2`
- prioridade: 85
- tipo: atencao
- grupo: mortes-cedo
- texto: {mortes10} mortes antes dos 10 min, a 1ª aos {primeira_morte:mmss}. Começo com 2 ou mais mortes derruba tua taxa de vitória: até os 10, joga pela vida.

### mortes-1x1-adversario
- quando: `mortes_1x1_adversario >= 2 e adversario_incerto == 0`
- prioridade: 80
- tipo: atencao
- grupo: mortes-adversario
- texto: {mortes_1x1_adversario} mortes no 1x1 para o {adversario_nome}: nas trocas diretas ele levou a melhor. Antes de entrar, confere vida, nível e recarga dele.

### virada-10-15
- quando: `ouro10 >= 0 e ouro15 <= -300 e adversario_incerto == 0`
- prioridade: 75
- tipo: atencao
- grupo: ouro-rota
- texto: Aos 10 tu estava {ouro10:+} de ouro contra o {adversario_nome}; aos 15, {ouro15:+}. A vantagem escapou entre os 10 e os 15.

### sozinho-lado-inimigo
- quando: `mortes_sozinho_inimigo >= 2`
- prioridade: 72
- tipo: atencao
- grupo: posicionamento
- texto: {mortes_sozinho_inimigo} de {mortes} mortes sozinho no lado inimigo do mapa, sem aliado perto. Do outro lado sem visão, recua ou chama alguém.

### morte-objetivo
- quando: `mortes_objetivo >= 2`
- prioridade: 70
- tipo: atencao
- grupo: objetivo
- texto: {mortes_objetivo} de {mortes} mortes seguidas de objetivo inimigo em até 90 s ({objetivos_pos_morte} objetivos). Perto de dragão, arauto ou torre, tua vida vale o objetivo.

### atras-15
- quando: `ouro15 <= -1000 e adversario_incerto == 0`
- prioridade: 68
- tipo: atencao
- grupo: ouro-rota
- texto: Aos 15 tu estava {ouro15:abs} de ouro atrás do {adversario_nome} ({xp15:+} de xp).

### tilt-historico
- quando: `derrotas_antes >= 2 e apos_derrotas_n >= 10 e apos_derrotas_wr <= geral_wr - 5`
- prioridade: 67
- tipo: atencao
- grupo: sessao
- texto: Entrou nesta com {derrotas_antes} derrotas seguidas; depois disso teu histórico é {apos_derrotas_wr:pct} de vitória contra {geral_wr:pct} no geral. Pausa antes da próxima.

### tilt
- quando: `derrotas_antes >= 2`
- prioridade: 66
- tipo: atencao
- grupo: sessao
- texto: Entrou nesta com {derrotas_antes} derrotas seguidas na sessão.

### atras-10
- quando: `ouro10 <= -400 e adversario_incerto == 0`
- prioridade: 65
- tipo: atencao
- grupo: ouro-rota
- texto: Aos 10 tu estava {ouro10:+} de ouro e {xp10:+} de xp contra o {adversario_nome}.

### trauma
- quando: `existe(trauma_lift) e vitoria == 0`
- prioridade: 64
- tipo: atencao
- grupo: trauma
- texto: {trauma_nome} estava do outro lado: é trauma ({trauma_v}V/{trauma_d}D com ele no time inimigo). Descontada a amostra pequena, tua derrota contra ele fica estimada em {trauma_lift}× a normal.

### matchup-ruim
- quando: `matchup_wr <= 40 e vitoria == 0`
- prioridade: 62
- tipo: atencao
- grupo: matchup
- texto: Contra {adversario_nome} teu histórico é {matchup_v}V/{matchup_d}D (n={matchup_n}), com {matchup_ouro10:+int} de ouro aos 10 em média. Treina o matchup ou bane.

### mortes-cedo-1
- quando: `mortes10 == 1`
- prioridade: 55
- tipo: atencao
- grupo: mortes-cedo
- texto: 1 morte antes dos 10 min, aos {primeira_morte:mmss}. Fechar os 10 sem morrer está entre os começos que mais te dão vitória.

### desvantagem-numerica
- quando: `mortes_desvantagem >= 3`
- prioridade: 55
- tipo: atencao
- grupo: posicionamento
- texto: {mortes_desvantagem} de {mortes} mortes em jogada com mais inimigos do que aliados perto.

### muitas-mortes
- quando: `mortes >= 8`
- prioridade: 50
- tipo: atencao
- grupo: mortes-total
- texto: {mortes} mortes na partida: cada uma é tempo fora do mapa e ouro para o outro lado.

### farm-abaixo
- quando: `farm_dif <= -0.5`
- prioridade: 50
- tipo: atencao
- grupo: farm
- texto: Farm de {farm_min}/min, {farm_dif:abs} abaixo da tua média com {campeao_nome} ({farm_media}/min, n={farm_n}).

### sessao-longa
- quando: `sessao_partida >= 5`
- prioridade: 45
- tipo: atencao
- grupo: sessao
- texto: Esta foi a {sessao_partida}ª partida seguida da sessão (pausas de menos de 2 h).

### faixa-ruim
- quando: `faixa_n >= 15 e faixa_wr <= geral_wr - 5`
- prioridade: 40
- tipo: atencao
- grupo: horario
- texto: Partida na faixa das {faixa}h, onde teu histórico é {faixa_wr:pct} de vitória contra {geral_wr:pct} no geral (n={faixa_n}).

### rota-limpa
- quando: `mortes15 == 0 e duracao_min >= 15`
- prioridade: 90
- tipo: positiva
- grupo: mortes-cedo
- texto: Começo limpo: 0 mortes até os 15 min.

### venceu-trauma
- quando: `existe(trauma_lift) e vitoria == 1`
- prioridade: 70
- tipo: positiva
- grupo: trauma
- texto: Vitória com {trauma_nome} do outro lado, teu trauma ({trauma_v}V/{trauma_d}D com ele no time inimigo).

### venceu-matchup-ruim
- quando: `matchup_wr <= 45 e vitoria == 1`
- prioridade: 65
- tipo: positiva
- grupo: matchup
- texto: Vitória contra {adversario_nome}, matchup em que teu histórico é {matchup_v}V/{matchup_d}D.

### sem-morte-cedo
- quando: `mortes10 == 0 e duracao_min >= 10`
- prioridade: 60
- tipo: positiva
- grupo: mortes-cedo
- texto: 0 mortes antes dos 10 min: um dos começos que mais te dão vitória.

### ouro-frente
- quando: `ouro10 >= 500 e adversario_incerto == 0`
- prioridade: 58
- tipo: positiva
- grupo: ouro-rota
- texto: {ouro10:+} de ouro aos 10 contra o {adversario_nome}: rota ganha.

### poucas-mortes
- quando: `mortes <= 2 e duracao_min >= 20`
- prioridade: 50
- tipo: positiva
- grupo: mortes-total
- texto: Só {mortes} mortes em {duracao_min:int} min de partida.

### farm-acima
- quando: `farm_dif >= 0.3`
- prioridade: 40
- tipo: positiva
- grupo: farm
- texto: Farm de {farm_min}/min, {farm_dif:+} acima da tua média com {campeao_nome} (n={farm_n}).
