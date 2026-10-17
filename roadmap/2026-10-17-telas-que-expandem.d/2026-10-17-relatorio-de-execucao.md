# Relatório de execução — telas que tiram o compacto (etapas 1–6, 17/10/2026)

Plano: [2026-10-17-telas-que-expandem.md](../2026-10-17-telas-que-expandem.md). Tudo provado offline (LCU falsa, relógio falso,
DOM falso); nada de escrita contra o client real. Etapa 7 (coletor ignora partida assistida) segue como card à parte.

## O que cada etapa virou

- **1 (fila desconhecida na ranqueada):** `aoFase` mantém `est.info` na passagem `ReadyCheck → ChampSelect`; `esgotouSessao` relê
  `GET /lol-gameflow/v1/session` uma vez no 1º prazo e só expande no 2º (4 s); `aoSessao` ignora sessão sem fila nem mapa em
  `ChampSelect` com fila já lida. Prova: `teste-compacto.mjs` § 4b (reconstrução de 15/10 13:50; 5 casos falham no código anterior).
- **2 (espectador):** `aoSelecao(s)` no roteador (só `isSpectating` booleano; nunca `localPlayerCellId -1`), `info.assistindo` no
  `destinoDaFase` (seleção e fim expandem, partida = client normal embaixo do jogo), zera em None/Lobby/Matchmaking/ReadyCheck;
  `iniciarCompacto` observa e lê (GET) `/lol-champ-select/v1/session` na entrada da seleção, sem segurar a tela. `ctx.ceder(motivo)`
  novo; `tela-champselect` cede por ele (banco, 450, espectador). Medidor: `isSpectating` em `sessao_cs` e `gameflow_chaves` (só nomes
  de `gameData`/`gameClient`) em ChampSelect/GameStart/InProgress. Provas: `teste-compacto-expansoes.mjs` § 3b (16/10 20:48–20:51),
  `teste-compacto-selecao.mjs` (ARAM e espectador cedem), `teste-compacto.mjs` (destinos), `teste-medir-compacto.py`.
- **3 (registro honesto):** gesto só conta dentro do `#lc-compacto` e depois de a tela montar (`medirGesto`, `gestoDentro`,
  `est.telaDesde`); evento leva `gestoAntesDaTela`/`gestoForaDaCamada` (o `coletor/expansoes.py` saneia os dois). Vocabulário +
  feedback, denuncia, denuncias, ggwp, placar, vanguard. Relatório: `reclassificar` (o "por-ele" de tela gravado antes, com clique
  anterior a um `fim`, vira `tela-sozinha`, marcado `reclassificado`) e o bloco da trilha. Provas: `teste-compacto-expansoes.mjs`
  § 1, § 7; `teste-expansoes.py` D8–D10. No registro real, o evento `mvbmby7o-5` (16/10 20:48) sai reclassificado.
- **4 (ready check sem socket):** `criarReleituraRC` no `aceite.js` (GET já e a cada 1 s na fase `ReadyCheck`, até 12, para com
  contagem/aceite/"não aceitar"/fim da fase; GET que falha nunca vira `avaliar(null)`); diag `origem=get` (`CAMPOS_DIAG` do coletor).
  Prova: `teste-aceite.mjs` (releitura).
- **5 (celebração de desafio):** `SEQ_SOZINHAS` + `ESPERA_CELEBRACAO_MS` (10 s); `alvo()` com `esperar` e `est.forcado` expande na
  hora (antes a espera ignorava a regra 7, o erro de tela e as Configurações). Prova: `teste-compacto.mjs` (15/10, parada 10 s,
  vinheta, missions-celebration).
- **6 (volta ao compacto):** `forcar(..., 'modal')` arma uma releitura de `modalAberto()` a cada 250 ms; 1,5 s sem camada da regra 7
  = zera o forcado e volta (`como: "a janela da Riot fechou"`). Fora do ready check, com ⤢ dele no meio ou outro motivo. Prova:
  `teste-compacto-expansoes.mjs` § 2b.

## Decisões técnicas

1. Etapa 6 por releitura do `modalAberto()` (a mesma `vigia.aberto()`), não por callback novo da vigia: o observador da vigia só vê
   nós adicionados e o modal pode sumir só de vista (`getClientRects`). Confiança alta; reverte voltando ao callback se a releitura
   pesar (250 ms, só DOM).
2. Etapa 1 com 2 prazos (4 s) em vez de 1: mantém "campo ausente = expandir", só mais paciente. Reverte com expansão tardia
   medida numa seleção que não é SR.
3. Reclassificação no relatório (lado leitura), não reescrita do jsonl: o dado gravado fica como veio.

## Limites conhecidos

- Volta da etapa 6 durante um `esperar` (seleção esperando a sessão, janela de 10 s da celebração): o forcado zera mas a janela só
  volta na próxima virada de destino (a espera não mexe na janela). Raro; a próxima fase resolve.
- Plugin recarregado no meio de uma partida assistida: a seleção já passou, `isSpectating` não é lido e a tela "partida em
  andamento" aparece (como antes).

## O que só o client real prova

- A próxima ranqueada sem expansão na entrada da seleção, mesmo com o GET lento.
- Uma partida assistida: expansão com origem `fase`, motivo "assistindo…", sem `tela: jogo`; e a linha `gameflow_chaves` do medidor.
- O próximo aviso de punição voltar ao compacto 1,5 s depois do GGWP, com título/botão nomeados no registro.
- Um ready check com o socket mudo mostrando a contagem (`origem=get` no `coletor.log`).
- A celebração de desafio passando sem 1280.

Nada disso vale antes de: recarregar a interface do client (plugin; só em None/Lobby), reiniciar o coletor (`gestoAntesDaTela`/
`gestoForaDaCamada` e `origem=get`) e reiniciar o medidor (`isSpectating`/`gameflow_chaves`).
