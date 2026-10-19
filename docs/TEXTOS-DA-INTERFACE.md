# Textos da interface

Régua de todo texto que o jogador lê no client e no painel: rótulo, aviso (toast), nota, dica, tooltip (`title`),
placeholder, motivo de botão cinza e as Configurações. Vale para `pengu/**`, `painel/**` e o `publico/LEIA-ME.md` (o
README do repositório público; guarda de tom e de nome em `tools/teste-publicar.py`, desde 19/10/2026). Origem: relato do Gabriel de
15/10/2026 ("baixando o replay (só porque tu clicou)" e "1 clique na grade declara" soavam imaturos num app que tem
"tanto texto bacana e adequado"). A persona do chat com o Gabriel (minúsculas, "tu fez") **não** vale aqui
(`C:\Dev\CLAUDE.md`). Guarda automática: `node tools/teste-textos.mjs`.

## Tom

- **Produto, não conversa.** Claro, direto, neutro. Sem gíria ("pra", "dá para", "não deu"), sem piada, sem intimidade.
- **Não justificar o óbvio.** O clique foi dele; o aviso diz o que acontece, não por quê: "baixando o replay".
- **Não narrar como o código decide** ("a reserva do coletor", "o roteador", "o evento não veio"). Diga o fato e a saída.
- **O Python é "complemento coach"** (19/10/2026, Fase 1 do plano plugin Pengu primeiro): um termo só para o usuário.
  "coletor", a porta "8765" e "MCP" nunca aparecem em texto visível; sem o complemento, o que depende dele **some** (nada de
  "fora do ar" nem botão cinza) e, onde o usuário procuraria, uma linha diz que precisa do complemento coach. Falha com ele
  instalado: "complemento coach sem resposta". Guarda em `node tools/teste-textos.mjs` (valores internos como
  `coletor.ligado` ficam na lista `INTERNOS` de lá).
- **Sem o nome do mantenedor** (19/10/2026, Fase 3 do plano plugin Pengu primeiro): texto visível e valor padrão nunca citam
  quem mantém o plugin nem os dados da conta dele (comentário no código pode). Guarda em `node tools/teste-textos.mjs` (literal)
  e `teste-config.mjs` (`PADRAO`).
- **Motivo de botão cinza = fato + saída**: "o client está atualizando", "líder do grupo desconhecido: busque pelo client
  normal". O porquê só entra quando muda a decisão dele, depois de dois-pontos, nunca entre "(porque…)".

## Pessoa e gramática

- **Prefira a frase impessoal**: "1ª opção: TOPO", "Renekton foi banido: escolha outro", "nenhum ban seu nesta seleção".
- Quando precisar falar com o jogador: **"você/seu/sua"** com o verbo concordando (o padrão da Riot em pt-BR). Nunca "tu"
  com verbo na 3ª pessoa ("tu pediu", "tu tem", "tu é"). Na lista de jogadores, ele é **"você"**.
- **Imperativo de "você"**: clique, escolha, tente, confira, aguarde, use, busque, cancele, responda, abra, passe.
  Nunca o de "tu": clica, escolhe, tenta, confere, espera, usa, busca, cancela, responde, abre, passa.
- **O app não fala em 1ª pessoa**: "não foi possível ler o lobby", "abrindo o client normal", "nova tentativa em seguida"
  (e não "não consegui", "não sei", "abri", "fechei", "tento de novo"). "Não sei X" vira "X desconhecido" ou
  "X não identificado".
- Acentuação completa; concordância de número ("2 páginas … não existem").

## Formato

- **Rótulo de botão**: verbo no infinitivo, curto ("baixar replay", "assistir replay", "enviar", "convidar"). Botão
  desligado que serve de dica: imperativo curto ("clique num campeão para declarar"). Tooltip de botão: o que ele faz, no
  infinitivo ("baixar o replay desta partida", "abrir o jogo com o replay (o client minimiza e volta no fim)").
- **Caixa**: rótulo curto segue o bloco (minúsculas nos botões e notas pequenas do compacto, como no protótipo aprovado;
  CAIXA ALTA onde o CSS ou o título manda). **Aviso (toast) começa com maiúscula**: `frase()` de
  `pengu/compacto/comum.js` faz isso sozinho em `avisar()` (camada e Toast), no Toast da fila rápida e no do pós-jogo;
  texto escrito direto no `Toast` já nasce com maiúscula. Configurações: frase com maiúscula e ponto final.
- **Pergunta de confirmação** é frase nova: "… 44%. Buscar mesmo assim?".
- **Aviso curto**, uma linha. Dois-pontos ligam fato e saída ("o client está atualizando: tente em alguns minutos").
- Número com unidade ("8 s", "3 partidas"); ordinal "1ª", "2º"; travessão não.
- **Ícone, nunca emoji** (17/10/2026, "ícones lucide no lugar de emojis"): ícone sai de `pengu/icones.js` (Lucide embutido) e é
  decorativo. Botão só com ícone leva `title` e `aria-label` com o nome dele ("chat", "amigos", "configurações", "coach da seleção",
  "fechar a conversa"). Frase que cita um botão usa o nome, não o glifo: "tente de novo ou use expandir", "clique em fechar de novo".

## Antes e depois (15/10/2026)

| antes | depois |
| --- | --- |
| baixando o replay (só porque tu clicou) | baixando o replay |
| de volta à fila (só porque tu clicou) | de volta à fila |
| 1 clique na grade declara | clique num campeão para declarar |
| não é a tua 1ª: tu pediu TOPO | fora da 1ª opção (TOPO) |
| PREENCHIMENTO AUTOMÁTICO · tu pediu TOPO e SELVA | PREENCHIMENTO AUTOMÁTICO · opções: TOPO e SELVA |
| tu (na linha dele, na seleção e no lobby) | você |
| tu baniu Zed. / tu não baniu ninguém. | seu ban: Zed. / nenhum ban seu nesta seleção. |
| Renekton foi banido: clica outro. | Renekton foi banido: escolha outro. |
| não consegui travar Zac (500): tenta de novo ou ⤢ expandir | não foi possível travar Zac (500): tente de novo ou use expandir |
| não sei se tu é o líder: cancela pelo client normal | líder do grupo desconhecido: cancele pelo client normal |
| lobby personalizado: abri o client normal | lobby personalizado: abrindo o client normal |
| não cabe tudo ao lado no teu monitor: fechei o chat… | não cabe tudo ao lado neste monitor: o chat fechou… |
| espera as estatísticas chegarem | aguarde as estatísticas chegarem |
| de madrugada teu winrate cai: 47% contra 58% de dia. buscar mesmo assim? | de madrugada o seu winrate cai: 47% contra 58% de dia. Buscar mesmo assim? |
| ⛔ chat bloqueado pela Riot nesta conta: dá para ler, não dá para enviar | chat bloqueado pela Riot nesta conta: só leitura, sem envio (com o ícone bloqueado, desde 17/10) |
| coletor fora do ar: as lições ficam na análise completa (19/10) | as lições ficam na análise completa (sem o complemento) / complemento coach sem resposta: … (com ele) |
| coach: coletor fora do ar (sem matchup e draft) (19/10) | (some sem o complemento) / matchup e draft indisponíveis agora: nova tentativa em seguida |
| indisponível: o coletor não está rodando (127.0.0.1:8765 não respondeu) (19/10) | indisponível: o complemento coach não respondeu (sem o recurso "mentor", a caixa some) |
| 2 derrotas seguidas: depois disso o seu winrate cai para 44% (número fixo do mantenedor) (19/10) | o mesmo com o número das partidas guardadas; sem amostra: "2 derrotas seguidas. Buscar mesmo assim?"; número sem queda: "o seu winrate é 55%" |
| de madrugada o seu winrate cai: 47% contra 58% de dia (número fixo) (19/10) | sem amostra: "é madrugada (entre 1h e 6h). Buscar mesmo assim?"; com: os números calculados |
| lições com o histórico do client (sem o complemento, mesmo com partidas guardadas) (19/10) | lições com matchup, traumas e histórico das 53 partidas guardadas neste computador |
| adversário da sua rota ainda não travou (selo sem o complemento) (19/10) | ninguém travado: "adversário da sua rota ainda não travou"; travados fora do histórico da rota: "nenhum inimigo travado no seu histórico desta rota"; às cegas: a caixa some; rota: "adversário no seu histórico com este campeão (topo)" |
| ⚙ freio de tilt com mais de 30 partidas: "Com 30 partidas guardadas neste computador, aparece aqui…" (19/10) | Com 10 partidas logo depois de 2 derrotas seguidas (9 até agora), aparece aqui o seu winrate nelas. |

A lista completa de 15/10 está no passo 17 do [plano do compacto](../roadmap/2026-10-13-client-compacto.md).

## Fora deste guia

- **Falas e rótulos da voz** (`coletor/avisos.py`, [LICOES](LICOES.md)): o pacote de voz pré-gravado depende do texto
  exato; mudar uma fala é regravar. Os rótulos de tela que saem de lá (ex.: "evita 1x1" na moldura) ficam para a
  frente do coletor; o chip do painel (`painel.js`) já segue este guia.
- Texto que a Riot escreveu (trans.json copiado, ex.: o formulário de denúncia em `jogador-acoes.js`) e o
  `VOCABULARIO` do registro das expansões (`expansoes.js`): são exceções nomeadas em `tools/teste-textos.mjs`.
- O texto do mentor (gerado pelo Claude no coletor) e nome de jogador ou campeão vindo da LCU (sempre por `esc()`).
- As notas do release ("o que mudou", `pengu/atualizacao.js`, 19/10/2026): texto de quem publica, mostrado só por `textContent`.
  Os textos do aviso em volta seguem este guia: "Versão 0.2.0 disponível (instalada: 0.1.0).", botões "atualizar", "o que
  mudou" e "procurar agora", bloco "Atualizações"; falha da consulta automática não vira aviso (só o "procurar agora" diz
  "Não foi possível consultar agora: tente mais tarde."). O botão atualizar (P3, `pengu/atualizador.js`): etapas "Baixando a
  versão 0.2.0…", "Conferindo os arquivos…", "Instalando…"; fim "Atualizado para a versão 0.2.0." com o botão "recarregar
  agora" (fora de None/Lobby: "Recarregue na tela inicial ou no lobby."); recusas e erros em frase de fato + saída ("Instalação
  de desenvolvimento (…): o botão não troca estes arquivos.", "Os arquivos da versão 0.2.0 não conferem com o release: nada foi
  trocado."); sem o complemento, o caminho do `atualizar.cmd` e o endereço com "copiar link". O `publico/atualizar.cmd` segue o
  mesmo tom nas mensagens dele, e o `instalar.cmd` e o `desinstalar.cmd` (P4) também: fato + saída, impessoal ou "você"
  ("Python 3.12 ou mais novo (64 bits) não encontrado.", "Baixe em … e rode o instalar.cmd de novo.", "Plugin não copiado: …
  e os dois carregariam juntos."). Nenhuma guarda automática lê os `.cmd`: revisar à mão (o `teste-instalar.py` confere as
  frases que as provas esperam). O pacote de vozes no bloco Voz (P5, `pengu/vozes.js`): linha "Sem o pacote de vozes Aoede: os
  avisos saem na voz Maria do Windows." ou "Pacote de vozes Aoede instalado (versão 76d3c16afdfb, 476 falas).", botões "baixar
  vozes (36 MB)" e "atualizar vozes (36 MB)" (minúsculas, como "atualizar" e "recarregar agora"), etapas "Baixando as vozes… 12
  de 36 MB", "Conferindo as vozes…", "Instalando as vozes…", fim "Vozes instaladas (versão …): valem a partir da próxima
  partida." e recusas em fato + saída ("Baixe as vozes na tela inicial ou no lobby.", "Pacote de vozes gerado neste computador: o
  botão não troca este pacote.").
- Comentário de código, log (`console.*`) e documentação para agentes (README, ARMADILHAS, roadmap). Ex.: as linhas
  "histórico: …" do acumulador (`pengu/historico.js`, 19/10/2026). O que mostra a amostra dele (Fase 5 do plano plugin Pengu
  primeiro: nota do pós-jogo, freios, dica do lobby, selo, Configurações) segue este guia: diz "partidas guardadas neste
  computador", nunca "acumulador", e sem amostra não cita número (tabela acima).
