# Fixtures da partida de referência (gameId 3292712362)

Caso de referência de [docs/INSIGHTS.md](../../docs/INSIGHTS.md), baixado da LCU em 13/10/2026.
Usadas por `tools/teste-posjogo.mjs` (JS do painel), `tools/teste-analise.py` (Python do MCP)
e `tools/teste-winrate.mjs` (selo do champ select, padrão sem argumento).

- `game-` e `timeline-3292712362.json`: `GET /lol-match-history/v1/games/{id}` e `game-timelines/{id}`.
  Única edição: a identidade dos 9 outros jogadores (`gameName`, `tagLine`, `puuid`, `summonerId`,
  `profileIcon`) virou `JogadorN`/`BR1`/puuid falso distinto, regra de [ARMADILHAS](../../docs/ARMADILHAS.md).
  O participante 1 é a conta (casa com `summoner.json`).
- `historico.json`: `current-summoner/matches` recortado às 17 partidas que os testes usam
  (a referência + as 16 da amostra de farm); só traz a identidade da própria conta.
- `summoner.json`: só o `puuid` da conta.
- `ref-3292712362.json`: números esperados, saída do cálculo independente `temp/insights_calc.py`
  (fora do repo); a tabela de [INSIGHTS.md](../../docs/INSIGHTS.md) § Caso de teste é a mesma.

## Pós-jogo compacto (`tools/teste-compacto-posjogo.mjs`)

- `posjogo-3292746609.json`: **real** (normal 400, Zac, derrota 8/9/6, 13/10/2026): o eog do `dados/lol.db`
  (maior id) recortado ao jogador local **sem identidade** (só campeão, stats de KDA/farm, times com vitória), a
  sessão do gameflow só com gameId/fila/mapa e as 3 lições do `GET /licoes/<id>` do coletor (só id/tipo/texto).

## Champ select (`tools/teste-champselect.py`, acha `champselect-*.json` por glob)

- `champselect-preferida`, `-autofill`, `-blind`, `-tardio`: montadas à mão no formato do `/help`.
- `champselect-real.json`: **real**, 61 eventos do `champselect.jsonl` do gravador (normal draft,
  fila 400, 13/10/2026, partida 3292746609), sem edição além do `coletor.limpar_sessao` (sem
  identidade de jogador nem `chatDetails`; 29 identificadores dos 10 conferidos: 0 achados). Tem
  seleção desfeita por dodge, troca de ordem de pick e ban não feito (`championId` -1). Esperado
  conferido contra a partida e `/lol-perks/v1/pages`. Detalhe: [MEDICAO-2026-10-13](../../docs/MEDICAO-2026-10-13.md).

## Minimapa (passos 13, 14, 15b e 15d)

- `minimapa/*.png` + `*.json`: 14 recortes **reais** (497×497, mapa em (134,133) com 347 px) da
  partida 3292746609, com o centro de cada ícone **anotado à mão** (folha 3× com grade de 25 px; 77
  ícones, marca `yuumi` = anel grosso da Yuumi presa, `encoberto` = menos da metade visível) e os
  mortos do instante (Live Client). Sem nome de jogador (só retratos dos aliados acima do mapa).
  `partida.json` = os 10 campeões e times; `icones/{id}.png` = ícone base da LCU. Usados por
  `teste-minimapa.py` (prova), `teste-alcance.py` e `teste-jungler.py` (grade regerada da mediana).

## Feitiços e sugestões (passos 15e e 15f)

- `chat-pings-20261013.json`: gabarito anotado à mão dos pings no chat das 35 telas da partida
  3292746609 (`tools/teste-ocr-chat.py`). Só horário, campeões e feitiço: as imagens têm nome de
  terceiros e ficam em `temp/gravacao/` (fora do git). 20 com chat, 6 com ping, 3 com ping de feitiço.
- `jogo-estatico.json`: `sugestoes.montar_estatico()` da LCU no patch 16.20 (recarga dos feitiços
  CLASSIC, 112 itens lendários, 173 campeões com dano/controle/papéis); usado por `tools/teste-sugestoes.py`.

## Chat do pós-jogo ([plano](../../roadmap/2026-10-13-chat-popups-som.md))

- `chat-posjogo.json`: **sintético** (nomes `JogadorN#BR1`/`Eu#BR1`, puuid falso): eog no formato do
  `eog-stats-block`, `champion-summary` recortado, mensagens do LCU, textos do saguão em pt-BR medidos em
  `/fe/lol-social/trans.json` (13/10/2026) e as linhas do chat no formato do template do client (Riot ID com as
  marcas bidi, linha de sistema, celebração, nome desconhecido, Ahri nos dois times). Usado por `tools/teste-chat-posjogo.mjs`.
