# lol-client

Mod pessoal do client do LoL (plugin Pengu, coletor SQLite, pós-jogo, MCP). Hub:
[cerebro/projetos/lol-client.md](../cerebro/projetos/lol-client.md) · plano vigente em `roadmap/`.

- **Nunca** `POST .../matchmaking/search` nem accept/decline do ready check em teste contra o client real (só LCU falsa);
  recarregar a interface só em fase `None`/`Lobby`. Detalhe: [docs/ARMADILHAS.md](docs/ARMADILHAS.md).
- Única escrita sozinha do coletor na LCU: a reserva do aceite, só com o plugin visto durante o próprio ready check (aperto de mão ou `POST /aceite/plugin` com Origin) e sem "não aceitar"; o plugin só fala com a 8765 com `coletor.ligado` e aperto de mão, e só na rota do recurso anunciado (`pengu/coach.js`; [COLETOR](docs/COLETOR.md) § Quem aceita).
- Busca na fila só por clique do Gabriel (fila rápida, jogar de novo), sempre pelos freios de `pengu/freios.js`
  (tilt e madrugada, 2º clique); escrita da coleta de recompensas só por
  `ROTAS_COLETA` (`pengu/recompensas.js`), nunca rota que gasta (baú, criação, fichas, passe).
- Client compacto (`pengu/compacto/`): erro, campo ausente ou modal desconhecido → expandir ou botão cinza com motivo,
  nunca decidir pelo jogador; rota [S] ainda sem medição nunca é premissa ([plano](roadmap/2026-10-13-client-compacto.md) passo 1).
  Travar/banir = `PATCH session/actions/{id} {completed:true, championId}`; nunca `POST .../complete` (ARMADILHAS § LCU).
  Fim de partida (voto, prosseguir, adicionar, denunciar, sala, replay): só clique dele, rota e corpo do front da Riot (ARMADILHAS § LCU).
  Partida (`tela-jogo.js`): sozinho nada de `MoveTo`/`ux-show` (geometria só com `geometriaAtiva`); em `InProgress` sem foco nada mexe na janela, nem `CenterToScreen` (`podeMexer`, ARMADILHAS § Client).
  Lateral (chat, amigos, configurações, coach): largura só pelo `est.lateral` do roteador, posição só pela `compacto/geometria.js` (px físicos; `MoveTo` fora dela = `anotarPosicao`); nada do chat abre nem muda de foco sozinho, em fase nenhuma (16/10/2026); provar com `teste-compacto-lateral.mjs`.
  Exceção: a faixa da sala do time na coluna (seleção, pós-jogo, honra) cresce sozinha com mensagem de outro jogador, só a altura: sem foco, sem geometria, sem "lida"; na ranqueada só campeão/posição ([plano](roadmap/2026-10-16-chat-da-sala-som-icones.md)); provar com `teste-compacto-selecao.mjs` §10 e `teste-compacto-fim-de-partida.mjs` §7.
  Amigos (pastas, menu, arrastar): regra e corpos só em `compacto/amigos.js`; convite só na fase `Lobby` com lobby criado (a lista nunca cria lobby); provar com `teste-compacto-amigos.mjs`.
  Perfil (editor, perfil de amigo, fundo): corpos só em `compacto/perfil.js`; grava só no "salvar" dele e só o que mudou (nunca ao fechar); fundo só a imagem, véu medido (`compacto/fundo.js`); provar com `teste-compacto-perfil.mjs`.
  Som das configurações (`lol-audio` do client, só o client, não a partida): corpos só em `compacto/som.js`; grava só no clique ou no soltar do volume dele, abrir nunca grava; provar com `teste-compacto-som.mjs`.
  Ordem CSS/`ResizeTo`/`MoveTo` só pela fila da geometria, partindo da esquerda pintada (ARMADILHAS § Client, "Pisca ao abrir ⚙").
  Saída do compacto só pelo `resolver()` (o registro das expansões compara antes/depois); `est.forcado` só por `forcar(motivo, tipo)`; texto de camada da Riot só por `expansoes.textoSeguro` (vocabulário, nunca nome) ([COLETOR](docs/COLETOR.md) § Registro das expansões).
  Tela que cede à Riot sozinha usa `ctx.ceder(motivo)`, nunca `ctx.expandir()` (é do clique dele); espectador só por `isSpectating` da sessão da seleção, nunca `localPlayerCellId -1` ([plano](roadmap/2026-10-17-telas-que-expandem.md)); seleção vinda de None/Lobby espera esse sinal (`ESPERA_SELECAO_MS`), a do ReadyCheck nunca.
- Partida assistida (espectador) não liga coach, voz, painel, medidor nem grava nada (`Coletor.assistindo`; reserva: Live Client sem jogador ativo, nunca em partida sabida dele: `propria=True`); provar com `tools/teste-assistida.py` ([COLETOR](docs/COLETOR.md) § Coach na partida).
- Texto de interface (`pengu/**`, `painel/**`): tom de produto, impessoal ou "você", nunca "tu"/gíria/1ª pessoa do app;
  régua em [TEXTOS-DA-INTERFACE](docs/TEXTOS-DA-INTERFACE.md), guarda em `node tools/teste-textos.mjs`. Ícone só de `pengu/icones.js` (Lucide embutido), nunca emoji; guarda em `teste-icones.mjs`. Texto visível e `PADRAO` (`pengu/config.js`) sem nome nem dado do mantenedor (ids de runa, favoritos): a semente dele mora no README § Instalar; guarda em `teste-config.mjs`.
- Resposta falsa (avisos calados) só GET das `ROTAS` de `pengu/sem-popups.js`; nunca a sessão do champ select
  (o coletor lê `isAutofilled`). Plano: [chat, avisos e som](roadmap/2026-10-13-chat-popups-som.md).
- Teste em personalizada: sair só por `POST /lol-lobby-team-builder/champ-select/v1/session/quit`,
  com rede de segurança na página; `cancel-champ-select` não cancela e o client põe hover sozinho.
- A 8765 é do coletor: nunca matar dono de porta sem `GET /estado`; derrubar o coletor de propósito = `python
  tools/vigia-coletor.py pausar` antes, senão o vigia sobe de novo ([COLETOR](docs/COLETOR.md) § Vida, queda e vigia).
- Coach ao vivo (`coletor/coach_vivo.py`): provar com `python tools/ensaio-coach.py` (sem client, banco e
  portas de teste); nunca rodar o `coletor.py` de teste contra `dados/` com o coletor real de pé.
- Print do overlay/moldura só pelo modo vitrine (`tools/vitrine.py`); nunca desligar `WDA_EXCLUDEFROMCAPTURE` nem
  trazer o jogo para a frente. Provas que abrem janela só com o jogo fechado (`rodar-testes.py` e `ensaio-coach.py` recusam).
- Pacote de voz: a tarefa `lol-client-voz` completa e converge sozinha (`python tools/voz-agendada.py estado`); gerador
  só com o jogo fechado e nada do `pythonw` sem `CREATE_NO_WINDOW` ([COLETOR](docs/COLETOR.md) § Avisos ao vivo).
- Atalho do coach (F7 em batidas, F8) só **observa** o teclado (`coletor/teclas.py`), em tecla livre no LoL (número de cima é item); nunca
  `RegisterHotKey` (não dispara com o jogo na frente), `SendInput`/`keybd_event` ou hook que coma tecla (ARMADILHAS § Windows).
- Credencial do lockfile e a linha `Command Line` do r3dlog (token e chave da partida) nunca em arquivo, log ou doc; senha/token de sala de chat nunca no banco (`banco.SEGREDOS`). Heurísticas do pós-jogo: dona é
  [docs/INSIGHTS.md](docs/INSIGHTS.md) (JS e Python seguem ela). Coletor, banco e MCP:
  [docs/COLETOR.md](docs/COLETOR.md).
