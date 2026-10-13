# Selva — campos, horários e o que dá para prever

Tabela dona dos horários usados por `coletor/selva.py` (constantes `CAMPOS`, `TEMPOS`,
`CARANGUEJO_*`, `OBJETIVOS`, `NASCE_OBJ`) e por `coletor/jungler.py`. **Conferir a cada patch** na
wiki e mudar aqui e no código juntos. Client 16.20 = patch 26.20 (a numeração "26.xx" é a das
notas; `gameVersion` da partida medida: 16.20.824.8524).

## Campos e objetivos

| campo | nasce | renasce | ouro | xp | fonte (13/10/2026) |
| --- | --- | --- | --- | --- | --- |
| Sentinela Azul (azul) | 0:55 | 5:00 | 90 | 95–142,5 | wiki "Blue Sentinel": 0:55 desde o V26.01 (era 1:30) |
| Brambleback Vermelho (vermelho) | 0:55 | 5:00 | verificar | verificar | por analogia ao azul (buffs nascem juntos); **verificar** na wiki |
| Gromp | 1:07 | 2:15 | 80 | 120–180 | wiki "Gromp": 1:07 desde o V26.01 (era 1:42) |
| Krugs | 1:07 | 2:15 | 109 (soma) | verificar | wiki "Krug": 1:07 desde o V26.01 |
| Lobos | 1:07 | 2:15 | verificar | verificar | por analogia (campos pequenos); **verificar** |
| Aves (Raptors) | 1:07 | 2:15 | verificar | verificar | por analogia (campos pequenos); **verificar** |
| Caranguejo do rio | 2:55 | 2:30 | 55–121 | 100–150 | wiki "Rift Scuttler": 2:55 desde o V26.01 (era 3:30) |
| Vastilarvas | 8:00 | não renasce | | | wiki "Voidgrub": 8:00 desde o V25.09; somem 14:45 |
| Arauto | 15:00 | | | | wiki "Voidgrub" (mesmo covil) |
| Dragão elemental | 5:00 | 5:00 | | | wiki "Elemental drake" |
| Barão | 20:00 | 6:00 | | | wiki "Baron Nashor": 20:00 desde o V26.01 (era 25:00) |

Confirmado na partida real 3292746609 (13/10/2026): dragão às 8:28 e vastilarvas às 8:50/8:59/9:13
(≥ 5:00 e ≥ 8:00); Zac nível 2 em 1:15 e nível 3 em 2:04 pela Live Client (o 1º campo dá o nível 2,
wiki "Jungling"); Ekko nível 2 no minuto 2 e nível 3 no minuto 3 pela timeline.

**Mapa muda depois do 2º dragão** (wiki "Elemental drake": "after the second drake has been slain and
the third drake has been determined, the map will transform"), não com a alma: o elemento é o do
3º dragão, que a Live Client só diz quando ele morre (`DragonType`). Por isso `alcance.GradeViva`
regera a grade ~20 s depois do 2º `DragonKill`.

## Posições (unidades do mundo, 0–14870)

Coordenadas da comunidade, **conferidas no minimapa** da partida de 13/10/2026 (caem nos ícones e
timers dos campos do recorte 00362.0); objetivos pela timeline (`ELITE_MONSTER_KILL`).

| campo | ORDER (azul, baixo-esquerda) | CHAOS (vermelho, cima-direita) |
| --- | --- | --- |
| azul | (3821, 8101) top | (11032, 6990) bot |
| gromp | (2288, 8448) top | (12703, 6443) bot |
| lobos | (3783, 6495) top | (11008, 8387) bot |
| aves | (6823, 5507) bot | (7986, 9471) top |
| vermelho | (7765, 4020) bot | (7101, 10900) top |
| krugs | (8394, 2641) bot | (6317, 12146) top |

Caranguejo: top (4400, 9600), bot (10500, 5170). Dragão (9866, 4414); vastilarvas, arauto e barão
no mesmo covil (5007, 10471). "Metade" = top quando `y > x`.

## O que o módulo prevê (e com que pista)

- **Lado de início**: 1º avistamento do jungler antes de 1:50 a ≤ 2000 de um campo dele; campo
  pequeno vira o buff da mesma metade. Confiança "alta" se o avistamento é até 1:20.
- **Campos limpos**: rota provável a partir do início (mesma metade por proximidade, depois a outra:
  vermelho → krugs → aves → lobos → azul → gromp no CHAOS), 1º campo acaba 15 s depois de nascer,
  cada um seguinte em 18 s + caminhada a 345. Avistamento perto de um campo ancora a rota (ele estava
  lá naquela hora). Renascimento contado do fim estimado. Sem o farm dele (congela na fog: passo 9).
- **Nível 3 previsto**: fim do 3º campo, janela de −10 s a +45 s. Na partida real: Zac 2:04 (previsto
  1:50–2:45), Ekko entre 2:00 e 3:00 (previsto 1:49–2:44). O plano original dizia 3:00–3:30 com os
  horários antigos (campos a 1:30/1:42).
- **Objetivo dele** (`DragonKill`, `HordeKill`, `HeraldKill`, `BaronKill` com `KillerName` = jungler):
  posição exata naquele instante; por 60 s, "campos <outra metade> dele livres".
- **Visto numa metade** (fora da base, há ≤ 20 s): "campos <outra metade> inimigos livres" (contra-selva).
- **Caranguejo**: "nasce em N s" nos 30 s antes de 2:55.

Não feito: ler por OCR os timers que o minimapa mostra dos campos que tu viu morrer
(`MinimapEnableAllTimers=1`), como confirmação.
