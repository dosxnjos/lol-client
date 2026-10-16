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
