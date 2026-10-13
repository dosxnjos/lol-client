# Mobilidade — dash, salto e Flash por cima da parede

Tabela lida por `coletor/alcance.py` (`ler_mobilidade`) para a área alcançável do overlay do
minimapa (plano v2, passo 15b). Uma linha por campeão: o salto que mais muda a área (um por pista;
a recarga só entra como texto, a área usa **um** salto). Flash (400) vale para todo mundo e entra
como "talvez" (peso 0,5 no mapa de calor), porque não sabemos se está pronto.

**Valores aproximados** (13/10/2026, conhecimento geral sem conferir número a número; client
16.20 = patch 26.20). Conferir na wiki do LoL quando um campeão desta lista for o jungler inimigo e
corrigir aqui. `atravessa`: `parede` = passa parede de espessura ≤ alcance (pousa no chão);
`livre` = anda dentro da parede (Kayn E), a área cobre a parede também.

Como a conta funciona e o que ela não faz: [COLETOR](COLETOR.md) § Minimapa e alcance.

| campeão | habilidade | alcance | atravessa | recarga | observação |
| --- | --- | --- | --- | --- | --- |
| Kayn | E Passo Sombrio | 700 | livre | 8 | ~1,5 s dentro da parede com bônus de velocidade |
| Zac | E Estilingue Elástico | 1200 | parede | 22 | nível 1; cresce até 1800 com os pontos |
| Elise | E Rapel (aranha) | 750 | parede | 22 | |
| Kindred | Q Dança das Flechas | 340 | parede | 9 | |
| Nidalee | W Investida (felina) | 375 | parede | 6 | 750 com a marca da caçada |
| Lee Sin | W Proteger | 700 | parede | 12 | precisa de sentinela ou aliado |
| Graves | E Saque Rápido | 425 | parede | 16 | |
| Ekko | E Mergulho de Fase | 350 | parede | 9 | investida + salto até o alvo |
| RekSai | E Escavar | 800 | parede | 26 | túnel; reaparece pelo outro lado |
| KhaZix | E Pulo | 700 | parede | 20 | 900 com a evolução |
| Shaco | Q Ilusão | 400 | parede | 9 | piscar |
| Talon | E Caminho do Assassino | 700 | parede | 2 | pula qualquer parede; cada parede 1x por ~100 s |
| Tristana | W Salto Foguete | 900 | parede | 22 | |
| Ezreal | E Disparo Arcano | 475 | parede | 19 | piscar |
| Kassadin | R Caminhar do Vazio | 500 | parede | 5 | piscar |
| Riven | Q Asas Partidas | 260 | parede | 13 | só o 3º golpe salta parede fina |
