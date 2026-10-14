# Relatório de execução: calibrar avisos e overlay (14/10/2026)

Plano: [../2026-10-14-calibrar-avisos.md](../2026-10-14-calibrar-avisos.md). Executor: opus (subagente do
orquestrador), sem commit e sem reiniciar o coletor (o coletor de pé roda o código antigo até o orquestrador
reiniciar fora de partida).

## Causas medidas

- `mid_sumiu`: chave = segundo da última vista (nova a cada sumiço) → `repetir` nunca barrava; nada olhava a
  fase do jogo (1º aviso aos 0:37) nem a base caindo (7 bordas entre 22:00 e 24:10, com a torre do inibidor
  do mid dele caída aos 22:47).
- `jungler_apareceu`: chave = zona do rótulo → "rio bot"/"bot"/"selva bot" eram 3 avisos em 13 s; e falava em
  qualquer lugar do mapa.
- Repetições de voz: eco da transcrição do Reco (o log tem 1 de cada); real só gank top a 31 s (repetir 30).
- Gank: só a rota do champ select, e o "adiantado" usava a última posição do meu ícone para sempre.
- Overlay: cor-chave + alfa global (serrilhado por construção), 3 cores relativas + contorno branco, saltos a
  cada 400 ms.

## Arquivos

Código: `coletor/avisos.py` (motor: `intervalo`/`teto` por tipo, `REPETIR_FALA_S`; `AlertasPosicao`:
`onde_estou`, `importa_para_mim`, `aliado_na_rota`, `_mid_sumiu_calado`, `_agrupados`, `estruturas`,
`chave_zona`, `ZONAS_DA_ROTA`, `decidir_gank`), `coletor/coach_vivo.py` (gank via `decidir_gank`, eventos ao
`observar`, `GANK_OUTRA_S`), `coletor/jungler.py` (`gank(..., zonas=)`), `coletor/overlay_minimapa.py`
(reescrito: Win32 + `UpdateLayeredWindow`), `coletor/vitrine.py` (`compor` com alfa por px).
Provas: `tools/teste-alertas.py` (+30 casos), `tools/teste-coach.py` (+3), `tools/teste-overlay.py` (novo, no
`rodar-testes.py`), `tools/teste-vitrine.py`, `tools/teste-jungler.py`, `tools/teste-alcance.py` (alfa no lugar
da cor-chave), `tools/ensaio-coach.py` (conta molduras, suprimidos e calados).
Docs: `docs/COLETOR.md`, `docs/ARMADILHAS.md` (só os hunks desta frente), plano e ponteiro no plano da voz;
hub `cerebro/projetos/lol-client.md` (1 linha). Catálogo de falas intacto: 452, versão `b7043050b0b7`.

## Números antes/depois

| medida | antes | depois |
| --- | --- | --- |
| partida 3293092537, log real (voz / moldura) | mid_sumiu 10/25, jungler_apareceu 14/23 | não reproduzível ponta a ponta (sem gravação) |
| mesma partida, reconstrução sintética dos instantes do log (voz / moldura) | mid_sumiu 18/21, jungler_apareceu 15/23 | mid_sumiu 4/4 (2:19, 5:27, 7:36, 9:43), jungler_apareceu 2/3 + o resto só no painel |
| ensaio da gravação de 13/10 a 10x (Gabriel de Zac, selva), molduras | jungler_apareceu 2, mid_sumiu 2 | gank 2 (outra rota, amarelo), intruso 1, jungler_apareceu 1, mid_sumiu 1 |
| ensaio, falas | 28 (mid_sumiu 1, jungler_apareceu 1) | 29 (mid_sumiu 1, gank 1, jungler_apareceu 1, intruso 1) |
| ensaio, passo do laço a 10x | histórico p95 4,8–5,4 ms | p50 2,6 ms, p95 5,0 ms, CPU 13,2% |
| overlay: maior salto de opacidade entre px vizinhos | 140/255 | 20/255 (com corte da fog) |
| overlay: mudança por quadro com a área crescendo | 33/255 de uma vez a cada 400 ms | 5,3/255 por quadro |
| overlay: tela × conta da composição (`--demo`) | — | erro máx 0 |
| overlay: custo (janela real, sem texto) | Tk a 2,5 Hz: 1,2–1,6% de um núcleo | 2,0–2,7 ms/quadro com o ULW, 10 quadros/s só animando: 0,6–3,1% de um núcleo (medida ruidosa); parado: 0 |

Provas: `rodar-testes.py` 42/42 com o jogo fechado (teste-alertas 66/66, teste-coach 29/29, teste-overlay 8/8,
teste-vitrine 25/25, teste-sugestoes 5/5, ensaio ok); `overlay_minimapa.py --demo` ok.

## Sem prova

- Partida real com o código novo (o coletor de pé roda o antigo até reiniciar).
- Taxa de gank de outra rota numa partida de rota: a gravação de 13/10 é de selva. Botões: `GANK_OUTRA_S`,
  `PRIO_GANK_OUTRA`, massa mínima (`jungler.GANK_MASSA`).
- Frescor do meu ícone (4 s) a 6 fps ao vivo: o ensaio só tem 1 recorte a cada 10 s.
- Gosto do overlay (cor, 12–45% de opacidade): só o Gabriel olhando; `COR`, `ALPHA`, `ALPHA_MIN`.
