# lol-client

Mod pessoal do client do LoL (plugin Pengu, coletor SQLite, pós-jogo, MCP). Hub:
[cerebro/projetos/lol-client.md](../cerebro/projetos/lol-client.md) · plano vigente em `roadmap/`.

- **Nunca** `POST .../matchmaking/search` nem accept/decline do ready check em teste contra o client real (só LCU falsa);
  recarregar a interface só em fase `None`/`Lobby`. Detalhe: [docs/ARMADILHAS.md](docs/ARMADILHAS.md).
- Única escrita sozinha do coletor na LCU: a reserva do aceite, só com a rota do plugin no ar e sem "não aceitar" ([COLETOR](docs/COLETOR.md) § Quem aceita).
- Busca na fila só por clique do Gabriel (fila rápida, jogar de novo), sempre pelos freios de `pengu/freios.js`
  (tilt e madrugada, 2º clique); escrita da coleta de recompensas só por
  `ROTAS_COLETA` (`pengu/recompensas.js`), nunca rota que gasta (baú, criação, fichas, passe).
- Client compacto (`pengu/compacto/`): erro, campo ausente ou modal desconhecido → expandir ou botão cinza com motivo,
  nunca decidir pelo jogador; rota [S] ainda sem medição nunca é premissa ([plano](roadmap/2026-10-13-client-compacto.md) passo 1).
  Travar/banir = `PATCH session/actions/{id} {completed:true, championId}`; nunca `POST .../complete` (ARMADILHAS § LCU).
  Fim de partida (voto, prosseguir, adicionar, denunciar, sala): só clique dele, rota e corpo do front da Riot (ARMADILHAS § LCU).
  Partida (`tela-jogo.js`): sozinho nada de `MoveTo`/`ux-show` (geometria só com `geometriaAtiva`); em `InProgress` sem foco nada mexe na janela, nem `CenterToScreen` (`podeMexer`, ARMADILHAS § Client).
  Lateral (chat, ⚙, 📊): largura só pelo `est.lateral` do roteador, posição só pela `compacto/geometria.js` (px físicos; `MoveTo` fora dela = `anotarPosicao`; abertura sozinha = `soSemMover`); provar com `teste-compacto-lateral.mjs`.
- Resposta falsa (avisos calados) só GET das `ROTAS` de `pengu/sem-popups.js`; nunca a sessão do champ select
  (o coletor lê `isAutofilled`). Plano: [chat, avisos e som](roadmap/2026-10-13-chat-popups-som.md).
- Teste em personalizada: sair só por `POST /lol-lobby-team-builder/champ-select/v1/session/quit`,
  com rede de segurança na página; `cancel-champ-select` não cancela e o client põe hover sozinho.
- Coach ao vivo (`coletor/coach_vivo.py`): provar com `python tools/ensaio-coach.py` (sem client, banco e
  portas de teste); nunca rodar o `coletor.py` de teste contra `dados/` com o coletor real de pé.
- Print do overlay/moldura só pelo modo vitrine (`tools/vitrine.py`); nunca desligar `WDA_EXCLUDEFROMCAPTURE` nem
  trazer o jogo para a frente. Provas que abrem janela só com o jogo fechado (`rodar-testes.py` e `ensaio-coach.py` recusam).
- Pacote de voz: a tarefa `lol-client-voz` completa e converge sozinha (`python tools/voz-agendada.py estado`); gerador
  só com o jogo fechado e nada do `pythonw` sem `CREATE_NO_WINDOW` ([COLETOR](docs/COLETOR.md) § Avisos ao vivo).
- Atalho do coach (F7 em batidas, F8) só **observa** o teclado (`coletor/teclas.py`), em tecla livre no LoL (número de cima é item); nunca
  `RegisterHotKey` (não dispara com o jogo na frente), `SendInput`/`keybd_event` ou hook que coma tecla (ARMADILHAS § Windows).
- Credencial do lockfile nunca em arquivo, log ou doc; senha/token de sala de chat nunca no banco (`banco.SEGREDOS`). Heurísticas do pós-jogo: dona é
  [docs/INSIGHTS.md](docs/INSIGHTS.md) (JS e Python seguem ela). Coletor, banco e MCP:
  [docs/COLETOR.md](docs/COLETOR.md).
