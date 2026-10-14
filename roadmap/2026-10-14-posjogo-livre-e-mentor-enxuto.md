# Pós-jogo que não prende + mentor enxuto com veredito no topo

- **Data:** 14/10/2026 · **Alvo:** `pengu/posjogo/index.js`, `pengu/posjogo/abas.js`, `pengu/estilo.css`,
  `coletor/mentor.py`, testes `tools/teste-compacto-posjogo.mjs`, `tools/teste-abas.mjs`, `tools/teste-mentor.py`,
  medição `tools/medir-mentor.py` · **Depende de:** pós-jogo v2 e mentor do [plano v2](2026-10-13-lol-client-v2-coach.md)
  (passos 7 e 20), botão "reabrir análise" (commit 16383f3)
- **Fora desta frente:** `coletor/coach_vivo.py`, `avisos.py`, `sugestoes.py`, `overlay_minimapa.py`, `vitrine.py`
  (outra sessão: "mid sumiu" repetido, overlay do minimapa, cores do círculo).

## Entendimento

Pedido do Gabriel em 14/10/2026 (~12:05), nas palavras dele:

1. "Essa análise pós-jogo me impede de clicar em qualquer coisa na interface do LoL e poder prosseguir. Eu deveria ter
   mais versatilidade, eu poderia fechar essa janela antes de terminar o loading da análise."
2. "quanto ao mentor falando, ele não precisa dizer que não tem dados específicos. Às vezes ele fala que não tem dado de
   vida, nível ou recarga dele. Ele nem precisa pontuar isso. Se ele está recebendo essa orientação, pode tirar."
3. "Eu preciso de uma informação menos técnica. Possivelmente um TLDR no início do texto, parecido com o veredito. Algo
   como 'você está morrendo muito no mid-game, o que permitiu que eles fizessem o barão'. Dependendo, nem precisa de
   todas essas lições, esse texto longo. E talvez só esse texto mais enxuto, só com o essencial, mas sem perder a leveza."

Estado antes (lido no código em 14/10/2026):

- `#lc-posjogo` é tela cheia (`position:fixed; inset:0`, z-index 100001) com fundo escuro que recebe o clique: o client
  da Riot fica inteiro bloqueado enquanto o painel está aberto. A tela "analisando a partida…" não tem botão de fechar
  (Esc e clique no fundo fecham, mas nada diz isso). Fechar no carregamento **cancela** a busca na LCU; o "reabrir"
  refaz tudo do zero.
- O painel abre sozinho no `EndOfGame` e pode cair por cima de um clique dele (a análise leva de 2 a 50 s).
- O prompt do mentor (`coletor/mentor.py`, `SISTEMA`) manda dizer "não tenho esse dado" quando falta dado; a linha
  "Limites dos dados" do bloco DADOS lista o que falta. As 5 respostas reais do banco (13 e 14/10) têm 1 a 2 frases de
  ausência cada ("Não tenho dado de vida, nível ou recarga dele") e 238 a 259 palavras (o limite pedido era 220).
- Aba Resumo: placar + 3 lições à esquerda, mentor (veredito + 3 lições longas + próxima partida) à direita.

## Decisões técnicas

- **D1. Painel não bloqueia mais o client.** Fundo sem clique (`pointer-events:none`, transparente); só a caixa recebe
  clique. Clique fora da caixa fecha o painel **e** segue para o client (o "jogar novamente" ou o chat da Riot reagem
  no mesmo clique); ✕ e Esc fecham. Mesmo padrão do popup de runas (`#lc-runas`, ARMADILHAS § Client: sem fundo
  bloqueante). Conflito do pedido resolvido: "clique fora fecha" e "client clicável" só convivem assim (fundo que recebe
  clique bloqueia o client). Quem: opus 5.5; confiança média; reverteria: ele pedir o fundo escuro de volta ou fechar
  sem querer ao clicar no client.
- **D2. Caixa ancorada no topo e mais baixa**, deixando a faixa de baixo livre (onde a Riot põe o campo do chat e o
  botão de jogar, pelo print do lobby `temp/7b-final.png`: y ≥ ~650 px CSS). Medidas em variáveis CSS
  (`--lc-pj-topo`, `--lc-pj-livre`) para ajustar sem mexer no resto. **[S] não medido na tela de estatísticas**
  (nenhum print do `EndOfGame` no repo). Confiança baixa na geometria; reverte trocando 2 variáveis.
- **D3. Análise desacoplada do painel.** A análise da LCU fica num cache por partida (promessa): fechar o painel, mesmo
  no carregamento, não cancela; reabrir mostra o resultado na hora. Só a fase de aceite/seleção/partida cancela (como
  hoje). O mentor do coletor nunca dependeu do painel (o coletor pede sozinho quando a partida chega no banco).
- **D4. Abrir sozinho só sem atropelar.** No `EndOfGame` o carregamento não abre caixa: aparece o botão do topo
  "⏳ analisando a partida…" (não bloqueia nada). Pronta a análise: se ele **não** clicou nem digitou no client desde o
  fim da partida, o painel abre como hoje; se mexeu, o botão vira "📊 análise pronta" e espera o clique. Aberturas
  pedidas por ele (botão, Ctrl+K, "ver análise completa" do compacto) mostram a caixa de carregamento com ✕. Erro na
  abertura automática (LCU sem a partida depois de ~75 s, remake) também não abre caixa: o botão vira "📊 tentar a
  análise de novo"; um 2º `EndOfGame` da mesma partida com a análise em voo segue a espera que já existe (revisão).
  Confiança média; reverteria: ele preferir que nunca abra sozinho (trocar `abrirSozinho` por botão sempre).
- **D5. Mentor sem frase de ausência.** `SISTEMA`: sai "se o dado não existe, diga 'não tenho esse dado'"; entra "o que
  não está nos dados fica de fora, sem comentar que falta". A regra "todo número tem de estar nos dados" fica. A linha
  "Limites dos dados" do DADOS continua (é o que impede inventar), marcada como "não comente". Vale também para o ao
  vivo (mesmo `SISTEMA`; texto do ao vivo ganha o mesmo "não comente"). Pergunta direta dele sobre algo fora dos dados
  (flash, vida do inimigo) recebe uma frase curta "daqui não dá para ver isso" e segue com o que os dados mostram
  (revisão: proibir tudo empurrava o modelo a inventar ou desconversar).
- **D6. Formato novo do pós-jogo do mentor**: `Veredito:` 1–2 frases em linguagem de jogador (causa e efeito, como o
  exemplo dele), `O essencial:` 1 ou 2 itens curtos com o número que sustenta e o que fazer, `Próxima partida:` uma
  coisa. Teto de 120 palavras (antes 220, e saía ~250). Tom "direto e leve" no lugar de "ácido". Sai a ressalva "é
  padrão a olhar, não veredito" do texto (o prompt segue pedindo para não acusar). Reverteria: medição mostrar número
  inventado ou fato errado a mais que antes.
- **D7. Resumo do painel: veredito no topo.** Faixa larga com o veredito do mentor acima de tudo; à direita, o resto do
  mentor (o essencial, próxima partida, conversa); as 3 lições do motor de regras ficam recolhidas (`<details>`) só
  quando o veredito está na faixa, e abertas em todo o resto (mentor ainda sem resposta ou em "nada", pensando,
  desligado, erro, coletor fora: corrigido na revisão, antes recolhia com "nada" e a tela ficava vazia). Clique dele em abrir/fechar
  vale até o painel fechar. Respostas antigas ("Lições:") seguem aparecendo.
- **D8. Chat do pós-jogo (`pengu/chat-posjogo.js`) não muda**: ele segue fechado enquanto o painel está aberto e abre
  quando o painel fecha. Com D1, clicar no chat fecha o painel e o chat abre na sequência. Reverteria: ele querer
  digitar no chat com o painel aberto.

## Passos

1. [x] `pengu/posjogo/index.js`: cache da análise por partida (D3), botão do topo com estados
   carregando/pronta/reabrir (D4), caixa de carregamento com ✕, clique fora fecha sem bloquear (D1), abertura
   automática com guarda de interação (D4).
   **prova:** casos novos em `node tools/teste-compacto-posjogo.mjs`: fechar no carregamento → painel sai, botão
   "analisando"; análise chega → painel **não** volta sozinho e o botão vira "pronta"; clique no botão → painel com a
   partida sem nova leitura da LCU; abertura automática sem interação → painel abre; com clique no client durante o
   carregamento → não abre, botão "pronta"; ReadyCheck tira tudo.
2. [x] `pengu/estilo.css`: fundo sem clique, caixa no topo com faixa livre embaixo (D1, D2), faixa do veredito e lições
   recolhíveis (D7). **prova:** leitura do CSS + caso do teste que confere a estrutura; geometria real fica sem prova
   até a próxima partida (ver "Sem prova").
3. [x] `coletor/mentor.py`: `SISTEMA`, `FORMATO_POSJOGO`, linhas de limites (D5, D6).
   **prova:** `python tools/teste-mentor.py --seco` e `--offline` verdes; `python tools/medir-mentor.py` nas partidas
   3292913427, 3293084144 e 3293092537 (antes = resposta guardada no banco; depois = chamada real com o prompt novo,
   gravada só em `temp/`): palavras, frases de ausência e números que não estão no DADOS, mais conferência manual de
   cada fato.
   **reprova se:** número inventado, fato errado a mais que antes, frase de ausência sobrando, veredito com jargão.
4. [x] `docs/INSIGHTS.md` (§ Pós-jogo v2: Resumo com veredito) antes do JS; `pengu/posjogo/abas.js`: `partesMentor`,
   faixa do veredito, lições em `<details>`, rótulo "O essencial" (D7).
   **prova:** `node tools/teste-abas.mjs` com casos do veredito (formato novo, `**Veredito:**` do modelo, resposta antiga
   sem veredito).
5. [x] Docs: `docs/COLETOR.md` § Mentor (contrato novo), `docs/ARMADILHAS.md` § Client (painel sem fundo bloqueante) e
   § Mentor (frase de ausência vinha do prompt; medição de 14/10), `pengu/blocos.js` (texto do Mentor), README se citar o
   comportamento. **prova:** `python tools/rodar-testes.py` (recusa com o jogo aberto) ou os testes do pós-jogo e do
   mentor um a um.

## Execução (14/10/2026, opus 5.5; sem commit, o orquestrador integra)

- Passos 1, 2 e 4 feitos: `node tools/teste-compacto-posjogo.mjs` → 78/78 (13 casos novos: carregamento com ✕, fechar
  sem cancelar, nada abre sozinho depois, botão "análise pronta" e reabrir sem nova leitura da LCU, clique dentro x
  fora, Esc, abertura automática com e sem clique dele, o clique de uma abertura não segura a seguinte, ReadyCheck no
  carregamento); `node tools/teste-abas.mjs` → ok
  (veredito no formato novo, com `**`, antigo, sem rótulo, em 2 linhas; faixa escondida; `<details>` aberto/fechado);
  `teste-posjogo` 11/11, `teste-chat-posjogo` 45/45, `teste-jogar-de-novo` 96/96, `teste-compacto` 106/106.
- Passo 3 feito: `teste-mentor.py --seco` ok, `--offline` 15/15. Medição (`tools/medir-mentor.py`, saídas em
  `temp/mentor-medicao/2026-10-14*`), 4 rodadas do prompt, cada afirmação conferida contra o DADOS:

  | partida | antes: palavras / ausência / erros | final (r4): palavras / ausência / erros |
  | --- | --- | --- |
  | 3292913427 (V, Renekton x Riven) | 257 / 1 / 1 ("3 mortes sem aliado" depois dos 16 min: eram 2) | 121 / 0 / 0,5 ("sem aliado por perto" na morte de 22:40: havia 1) |
  | 3293084144 (V, x Akali) | 247 / 2 / 1 (vastilarva "dela": foi da Qiyana) | 111 / 0 / 0,5 (objetivos atribuídos também à Caitlyn) |
  | 3293092537 (D, x Jax) | 250 / 2 / 0,5 (barão "depois" das mortes: veio 6 s antes) | 102 / 0 / 0 |

  Nenhum número fora do DADOS em nenhuma rodada. Rodadas intermediárias: r1 (veredito com número em 2 de 3, "torre do
  meio deles" ambíguo), r2 (veredito sem número, mas 2 inferências numa partida e 127–143 palavras), r3 (o "até o
  barão" do exemplo virou conteúdo na 3293092537): cada uma mudou o prompt (D6). n = 1 chamada por partida por rodada;
  custo ~US$ 0,026 por chamada.
- Passo 5: README, `docs/COLETOR.md` § Mentor, `docs/ARMADILHAS.md` § Client e § Mentor, `docs/INSIGHTS.md` § Pós-jogo
  v2. `rodar-testes.py` não rodou: o jogo estava aberto (ele recusa; provas que abrem janela ficam para depois).

## Revisão adversarial e correções (14/10/2026, opus 5.5)

- `python tools/rodar-testes.py` com o jogo fechado: 42/42 (inclui `teste-compacto-posjogo` 85/85, `teste-mentor`
  `--seco` e `--offline`, `ensaio-coach`).
- **Corrigidos, com caso de teste em `tools/teste-compacto-posjogo.mjs` (85/85):**
  - lições recolhidas e sem veredito com o mentor em `nada` (mentor desligado, personalizada, partida antiga e os
    primeiros minutos de toda partida): `licoesAuto` recolhe só com veredito pronto (D7, INSIGHTS § Resumo);
  - erro na abertura automática abria caixa sozinho por cima do client: vai para o botão "tentar de novo" (D4);
  - 2º `EndOfGame` da mesma partida apagava a caixa de carregamento que ele abriu e zerava o "ele mexeu" (D4);
  - faixa vazia no topo do Resumo com o veredito escondido: o espaço sob o veredito virou margem dele (CSS).
- **Mentor, pergunta direta** (D5): `SISTEMA` limita o "não comente o que falta" à análise e aos conselhos não pedidos;
  pergunta fora dos dados recebe uma frase curta. Medido na 3293092537 (`temp/mentor-medicao/2026-10-14-r5-pergunta/`):
  flash → "Daqui não dá para ver o uso do flash." e segue com as mortes; vida do Jax → "Daqui não dá para ver a vida do
  Jax." e segue; "o que fazer diferente na rota" → 3 pontos sem frase de ausência; números todos do DADOS. O pós-jogo
  da mesma chamada seguiu sem frase de ausência (1 exagero: "cada morte virou torre ou dragão", 2 de 4 viraram).
- **Tabela corrigida:** 3292913427 r4 conta 0,5 erro (a morte de 22:40 tinha 1 aliado perto). "Do Riven"/"a ele"
  (Riven é campeã) vem do texto da lição do motor; fica como nota, fora desta frente.
- **Proposta para o Gabriel** (produto, `dono: gabriel`): linha opcional "Mandou bem:" quando os dados mostram algo bom
  (ex.: farm acima da média na 3293092537, que o formato de 1–2 itens deixou de fora). Recomendação: sim, 1 frase, sem
  furar o teto de 120 palavras.
- **Adiado:** a análise em voo da partida que acabou de terminar se perde se ele pedir outra pelo Ctrl+K antes de ela
  ficar pronta (`analises.clear()`): raro (Ctrl+K nos primeiros segundos depois do fim) e o "analisar última" reabre
  com nova leitura. Decisor: opus 5.5; reabrir se ele relatar.

## O que o pedido não dizia

- Fechar no carregamento não cancela a análise da LCU (antes cancelava e o "reabrir" refazia do zero): reabrir fica
  instantâneo.
- Abrir sozinho só quando ele não está mexendo no client (D4): o pedido de "não prender" vale também para o painel que
  aparece no meio de um clique.
- O mesmo `SISTEMA` serve o mentor ao vivo: a frase de ausência some lá também.
- Medição antes/depois com conferência de fatos, como a de 13/10, para provar que enxugar não fez o mentor inventar.

## Descartado e impraticável

- **Painel lateral estreito** (drawer à direita): as abas Rota, Mortes e Objetivos têm gráficos de 540 px, mapa de
  330 px e linha de 1120 px; caberiam só com redesenho das 6 abas, e a lateral direita do client é a lista de amigos.
  Decisor: opus 5.5, 14/10/2026. Reabrir se a caixa no topo ainda atrapalhar.
- **Nunca abrir sozinho** (só botão): tira o que ele usa hoje sem pedido; D4 resolve o atropelo sem tirar a abertura.

## Sem prova (fica para a próxima partida real)

- Geometria na tela de estatísticas da Riot (D2): se a faixa livre embaixo bate com o "jogar novamente" e o chat.
- Clique fora fechando e o mesmo clique valendo no client (o CEF 108 entrega o `pointerdown` antes do clique: esperado,
  não medido no client).
- Evento `toggle` do `<details>` das lições no CEF 108 (escolha dele valendo até fechar o painel); só o HTML tem prova.
- Chat do pós-jogo com o painel aberto: segue a regra de antes (fechado enquanto `#lc-posjogo` existe), não medido com
  a caixa nova.
- Mentor ao vivo: só herdou o `SISTEMA` novo, sem medição própria.
- 2º `EndOfGame` da LCU com o painel já aberto ou fechado por ele: o painel ainda abre de novo (como antes da frente);
  só o caso com a análise em voo foi corrigido.
