# Relatório: correções da revisão adversarial (14/10/2026)

Plano: [2026-10-14-calibrar-avisos.md](../2026-10-14-calibrar-avisos.md) · relatório da construção:
[2026-10-14-relatorio-de-execucao.md](2026-10-14-relatorio-de-execucao.md). Decisões novas: D10 a D14 no plano.

## Achados e o que mudou

| achado | correção | prova (falha antes, passa depois) |
| --- | --- | --- |
| P1 fala repetida calava o gank urgente da minha rota | urgente com a mesma frase só barra em 10 s (`REPETIR_FALA_URGENTE_S`) | `teste-coach`: "fala repetida: urgente…" |
| P1 "mid indo" dependia do "mid sumiu" aceito | libera pela relevância do sumiço (`LIBERA_MID_INDO`: passou, ou calado por luta/eu morto/eu na base) | `teste-alertas`: 3 casos "14/10 mid indo" |
| P2 split push fundo sem gank | `onde_estou` na base deles: a faixa da rota sem margem | `teste-alertas`: "split push…", "perto do nexo…" |
| P2 gank de outra rota vencia mudo na fila | `Aviso.validade` sobrepõe a do tipo; outra rota 22 s; `Aviso.tom` sério | `teste-coach`: "gank de outra rota com a voz ocupada…", "tom sério…" |
| P3 aliado em ordem alfabética | `aliados_na_rota`, o mais adiantado primeiro, cada um testado | `teste-alertas`: "outra rota com 2 aliados…" |
| P3 eu jungler: jungler longe só no painel | eu de selva, tudo importa (D11) | `teste-alertas`: "eu jungler na minha selva…" |
| P3 área de pouca chance quase invisível | piso `ALPHA_MIN` em todo px com calor ≥ `LIMIAR` | `teste-overlay`: "zona de pouca chance…" (antes 17/255, agora ≥ 31) |
| obs. vitrine sem quadro com o overlay parado | gancho a cada 400 ms parado | sonda com janela: 17 quadros desenhados, 24 entregas, ~0,44 s entre elas depois de convergir |
| P3 "mid sumiu" numa foto; selva sem rota | descartados com motivo no plano | — |
| obs. "o top voltou pra rota" 5x | fora (não pedido; falas a > 1 min uma da outra) | — |

## Números

- `rodar-testes.py` 42/42 com o jogo fechado (`teste-alertas` 73/73, `teste-coach` 32/32, `teste-overlay` 8/8 e 9/9 à parte depois do caso do piso,
  `teste-vitrine` 25/25, `teste-sugestoes` 5/5, ensaio ok); `overlay_minimapa.py --demo` ok (tela × conta erro 0,
  3,3 ms por quadro). Catálogo: 452 falas, versão `b7043050b0b7`.
- 14/10 sintético (mesmo roteiro do construtor): "mid sumiu" 4/4, "jungler apareceu" 2/3 (voz/borda), igual à
  construção; log real 10/25 e 14/23.
- Ensaio 13/10 a 10x: 28 falas; bordas gank 1, "jungler apareceu" 2 (D11 devolve o jungler longe ao Zac de
  selva). O ensaio tem 1 recorte do minimapa a cada 10 s e varia de rodada a rodada ("mid sumiu" e intruso
  saíram 1 na construção e 0 aqui, sem nenhum "mid sumiu" calado: o sumiço não chegou a ser visto).
