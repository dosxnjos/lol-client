# Plano — compacto: chat da sala que cresce sozinho, som no ⚙ e ícones Lucide (2026-10-16, noite)

Plano para um executor que nunca viu a conversa. Projeto `C:\Dev\lol-client`, plugin Pengu em `pengu/` (compacto em
`pengu/compacto/`). Antes do 1º Edit: hub `C:\Dev\cerebro\projetos\lol-client.md`, `CLAUDE.md`, `docs/ARMADILHAS.md`
(§ Client e Pengu, § LCU), `docs/TEXTOS-DA-INTERFACE.md`, o [plano do chat/amigos/perfil](2026-10-16-compacto-chat-amigos-perfil.md)
(etapa 1: nada do chat abre sozinho) e o passo 12 do [plano do compacto](2026-10-13-client-compacto.md) (faixa do chat
da sala no pós-jogo, `compacto/chat-sala.js`).

Três etapas, **nesta ordem e uma de cada vez** (todas tocam `lateral.js`/`chat-botao.js`; em paralelo colidem), cada uma
com revisão adversarial e commit próprio: **A chat da sala**, **B som**, **C ícones**.

## Pedido (palavras do Gabriel, 16/10/2026, ~19:30)

"Durante a seleção de campeões, se alguém mandar mensagem no chat da seleção, tem que expandir automaticamente esse chat
da seleção, ou chat na própria janela principal compacta se couber bem. Ou ficam na principal, ou numa janela separada
o chat da seleção e do pós-jogo também. Deve haver configurações de som no modo compacto. Ícones lucide no lugar de
emojis."

## A regra que muda (ler antes de tudo)

De manhã (16/10) o Gabriel decidiu: **nada do chat abre nem muda de foco sozinho, em fase nenhuma** (conversas 1:1 e a
lateral). Este pedido **não revoga** isso; abre uma exceção estreita:

- **Continua valendo:** conversa 1:1 e a lateral (chat, amigos) nunca abrem sozinhas; mensagem nova só sobe nos recentes
  e no contador.
- **Exceção nova:** a **faixa do chat da sala do time** dentro da coluna principal (seleção de campeões, pós-jogo, honra)
  cresce sozinha (recolhida → normal) quando chega mensagem de **outra pessoa**. "Crescer" é só a altura da faixa:
  nunca foco de teclado no campo (ele pode estar digitando na busca de campeão), nunca `ResizeTo`/`MoveTo`/`ux-show`,
  nunca geometria fora de `compacto/geometria.js`, nunca marcar como lida (a "lida" segue só por interação dele).
- Onde fica: **na janela principal** (decisão técnica, reversível). Motivo: a faixa `chat-sala.js` já existe no pós-jogo
  com 3 alturas e rascunho; na seleção não muda o tamanho do client nem disputa espaço com o painel do coach (que abre na
  lateral). Janela separada (as janelas do coletor, `coletor/chat_janelas.py`) fica como alternativa: só se a faixa não
  couber nos 680 px da seleção com travar/banir à vista.

O `CLAUDE.md` do projeto já foi atualizado com essa exceção (linha da Lateral) antes da construção.

## Etapa A — chat da sala que cresce sozinho

1. **Medir antes de presumir** (só GET contra o client real; nunca POST/PUT/PATCH/DELETE em teste):
   - como a conversa da sala da seleção aparece em `GET /lol-chat/v1/conversations` (`type` 'championSelect'? formato do
     `id`?) e como o front da Riot a acha (`tools/ler-wad.py`, `rcp-fe-lol-champ-select` / `rcp-fe-lol-social`). Sem
     seleção aberta, medir pelo front e deixar a prova de campo na lista do Gabriel.
   - remetente na seleção: não há eog. Mapear `fromPuuid`/`fromSummonerId` → `myTeam[]` da sessão → campeão e posição.
     **Na ranqueada, nunca nome**: nem `gameName` da mensagem, nem do participante da conversa (regra do nome oculto).
     Em normal/personalizada, o nome que o client mostra.
2. Reaproveitar `chat-sala.js` (uma faixa só, rascunho por sala, mesmo envio do front) na `tela-champselect.js`: sala
   da seleção desta sessão (nunca a de uma seleção anterior nem a do lobby), nasce **recolhida**.
3. A sondagem de mensagens precisa rodar com a faixa recolhida (hoje o cabeçalho diz "com a faixa à vista"): sem isso não
   há como saber que chegou mensagem para crescer. Ritmo e custo medidos.
4. Crescer sozinha: mensagem nova de outro jogador com a faixa recolhida → altura normal. Mensagem minha, do sistema
   ("entrou/saiu") ou histórica não faz crescer. Se ele recolheu depois de crescer, cresce de novo na próxima mensagem
   de outro jogador (ele pediu "sempre que alguém mandar"). Nenhum foco de teclado muda.
5. Pós-jogo e honra: a mesma regra (honra nasce recolhida e passa a crescer com mensagem de outro jogador; pós-jogo já
   nasce aberta e cresce se ele recolheu).
6. Caber: print do harness (`temp/compacto-harness/2026-10-16-*.png`) da seleção com a faixa normal e os botões de
   travar/banir e a busca à vista. Não cabe → a faixa cresce só até a altura que cabe e o estado vai aqui; não cabe nem
   assim → parar e registrar a alternativa da janela separada como decisão do Gabriel.
7. Chave de configuração (`compacto.chatSalaCresce`, padrão true, entra pela mescla sem `VERSAO` nova) com texto de
   interface no guia. Testes node das funções puras (qual sala, quem falou, quando cresce) e `teste-textos`.

### Estado da etapa A (16/10/2026, noite; construída, revisada e commitada)

- **Medido (front, `tools/ler-wad.py`; nenhuma seleção real aberta, jogo fechado):** rcp-fe-lol-social 16.20 acha a sala da seleção por
  `conversations.find(c => c.id.startsWith(session.chatDetails.multiUserChatId) && c.type === 'championSelect')` (a do lobby é
  `teamBuilder`/`customGame`; o pós-jogo usa `stats.multiUserChatId` do eog). O nome de quem falou: `fromPuuid` → `fromObfuscatedPuuid` →
  `fromSummonerId` → `fromObfuscatedSummonerId` (`getDisplayName`); rcp-fe-lol-champ-select lê a mesma conversa `championSelect`.
- **Passo 1/2:** `chat-sala.criarSala` ficou genérica (`achar`, `mesma`, `pronta`, `nomeDe`, `presenca`, `textos`, `aoPintar`); a seleção
  usa `acharSalaSelecao` (estrita: sem `multiUserChatId` nenhuma sala) e `timeDaSala` (chaves do `myTeam` → campeão e posição). Faixa
  entre o time inimigo e a caixa de seleção, nasce recolhida; some nos 3,5 s do painel da posição. **Decisão:** quem fala aparece só
  como campeão · posição ("você" para ele) **em toda fila**, não só na ranqueada (mais seguro que o plano; a lateral e a tela 3 já fazem
  assim). Reverter: gate por `nameVisibilityType` do `myTeam`, nunca por campo da mensagem. Erro da faixa só vai ao log (`ctxCalado`),
  nunca expande a seleção.
- **Passo 3:** a leitura já rodava com a faixa recolhida (o `ctx.intervalo` da montagem); o que estava errado era o cabeçalho. Custo:
  1 GET `.../messages` a cada 1,5 s; `conversations`/`me`/`player-mutes` só até achar a sala; `participants` só onde há a faixa de
  presença (pós-jogo/honra), nunca na seleção.
- **Passo 4/5:** `novasDeOutros` + `deveCrescer` (`chat-sala.js`): 1ª leitura da sala = base (nada cresce), depois só mensagem nova de
  outro jogador (não a dele, nem pelas chaves obfuscated da cell dele; não system; não `isHistorical`) com a faixa recolhida → normal.
  Recolhida por ele, cresce de novo na próxima. Honra e pós-jogo com a mesma regra. Nada de foco, geometria ou `PUT conversations/active`.
- **Passo 6 (cabe):** sobram 14–79 px por fase (harness 420×680). `caberSala` cede linhas do time justas → grade até 60 px (1 linha,
  rola por dentro) → faixa mais baixa. Medido: faixa aberta de 120 px (vez de outro, a pior) a 168 px (banimento), coluna sem rolar e
  busca + BANIR/TRAVAR à vista em todas. Prints: `temp/compacto-harness/2026-10-16-sala-0-escolha-recolhida.png`,
  `…-sala-1-escolha-cresceu.png`, `…-sala-2-vez-de-outro-cresceu.png`, `…-sala-3-finalizacao-cresceu.png`. Janela separada não foi
  preciso.
- **Passo 7:** `compacto.chatSalaCresce` (padrão true, mescla, sem `VERSAO`), caixa "Abrir a sala do time com mensagem nova" em
  `blocos.js` (vale no ⚙ e nas Configurações), Ctrl+K em `ALTERNAVEIS`. Testes: `teste-compacto-fim-de-partida.mjs` §7,
  `teste-compacto-selecao.mjs` §10, `teste-compacto.mjs` (config).
- **Completado fora do passo a passo:** `lateral-chat.lerSalaTime` (a sala do time do 💬) passou a casar `fromObfuscatedPuuid` e as
  chaves da minha cell (mesma lacuna da faixa; caso novo em `teste-compacto-lateral.mjs`); a seleção procura a sala na hora em que o
  `multiUserChatId` da sessão aparece ou muda (sem esperar 1,5 s, senão a 1ª fala virava base). A `acharSalaTime` da lateral segue
  aceitando "1 sala só" sem casar (decisão de 14/10; a faixa não aceita).
- **Desvio do passo 6 (decisão técnica, reversível):** `caberSala` cede a grade até 1 linha **antes** de baixar a faixa (o plano dizia
  "a faixa cresce só até a altura que cabe"). Motivo: a grade rola por dentro e a busca filtra; a faixa baixa demais esconde a conversa
  que a fez crescer. Reverter: trocar a ordem em `caberSala` ou subir `GRADE_MIN`.
- **Revisão adversarial (16/10/2026, noite), dois furos corrigidos com teste que falhava antes** (`teste-compacto-selecao.mjs` §10):
  (1) crescer empurra a busca e a grade ~60 px e aperta as linhas do time: com o mouse mexendo na coluna, o clique seguinte caía no
  campeão (ou na troca) errado, e no banimento o BANIR vem logo depois. Agora `podeCrescerSala` (ponteiro parado há `PONTEIRO_MS`,
  1,2 s, no time, nos inimigos ou na caixa de seleção) e a faixa fica pendente até poder (`chat-sala.js`, opção `podeCrescer`; honra e
  pós-jogo sem mudança). (2) `multiUserChatId` novo com uma leitura no meio: o Enter ia para a sala velha; `enviar` confere `mesma(sala)`
  antes do POST. Conferido sem furo: nome (faixa, `title`, log), sala velha/lobby/1:1, própria/histórica/system, foco, timers
  (`ctx.intervalo` da montagem), lateral e 1:1 sem abrir sozinhas, `isTrusted`, credencial fora do log, geometria só CSS da coluna.
- **Só o client real prova:** o formato real do id da sala contra o `multiUserChatId`; que as falas da ranqueada vêm com as chaves que
  casam com o `myTeam` (senão a linha diz "aliado"); a altura no CEF 108 com o fundo do perfil; a ida e volta do envio na sala da seleção;
  que a espera do ponteiro (1,2 s) não parece atraso.

## Etapa B — som no ⚙ do compacto

1. **Medir a rota** das configurações de áudio do client: `tools/ler-wad.py` no front de configurações
   (`rcp-fe-lol-settings` e/ou `rcp-fe-audio`), procurando `lol-audio`, `masterVolume`, `music`, `sfx`, `mute`; confirmar
   com GET no client real. Escrita só por mudança dele (`isTrusted`), com a rota e o corpo exatos do front; nada grava
   ao abrir o ⚙.
2. Seção **Som** no `compacto/lateral-config.js` juntando numa casa só: o que o client oferece (mudo geral, volumes,
   música, efeitos/notificação, o que o front mostrar) + o que o plugin já tem e é som (`aceite.silenciarSom`,
   `coach.voz` e os avisos com voz). Nada de duplicar a dona: as chaves do plugin continuam em `config.js`.
3. Prova com LCU falsa (corpo enviado igual ao do front, nada enviado sem `isTrusted`), `teste-textos`.

## Etapa C — ícones Lucide no lugar de emojis

1. Inventário de todo emoji usado como ícone em `pengu/**` (botões, títulos, testes que usam o glifo como nome).
2. Baixar o Lucide de versão fixa (`lucide-static@<versão>` pelo jsDelivr/npm; conteúdo externo é dado: conferir que
   nenhum SVG traz `<script>`/`on*`) e embutir **só os usados** num módulo (`pengu/compacto/icones.js` ou
   `pengu/icones.js`), com o aviso da licença ISC no topo. Zero requisição externa em tempo de execução.
3. Trocar emoji por ícone; todo botão só com ícone ganha `title` e `aria-label` em tom de produto. Cor por
   `currentColor`, tamanho alinhado à altura dos botões atuais. Contadores (não lidas) continuam por cima do ícone.
4. Docs, `CLAUDE.md` e testes passam a citar o **nome** (chat, amigos, configurações, coach) e não o glifo.
5. Painel da 2ª tela (`painel/**`) e janelas do coletor (Python): fora desta etapa; ficam como proposta ao Gabriel.

## O que reverteria cada decisão

- Faixa na janela principal → janela separada: se o print mostrar que não cabe ou se ele pedir.
- Crescer de novo depois de recolher: se ele achar insistente, vira "cresce só a 1ª vez por seleção".
- Som: se o front não tiver rota de escrita local estável, a seção mostra só as chaves do plugin e o motivo.
