# Calibrar os avisos ao vivo e o overlay do minimapa (2ª ranqueada de 14/10/2026)

- **Data:** 14/10/2026 · **Alvo:** `coletor/avisos.py` (motor e `AlertasPosicao`), `coletor/coach_vivo.py` (gank),
  `coletor/overlay_minimapa.py` (janela e desenho), `coletor/vitrine.py` (composição), provas em `tools/`
- **Continua:** [voz pré-gravada e foco](2026-10-13-voz-pregravada-e-foco.md) (o catálogo de falas de lá não muda)
- **Fora:** `pengu/posjogo/**` e `coletor/mentor.py` (outra frente mexe neles)

## Pedido (Gabriel, top laner, conta Xerekton, depois da partida 3293092537, 11:30–11:57)

> está dizendo várias vezes "MID sumiu", sendo que a gente está tendo a base toda tomada. Essa hora não
> faz mais sentido saber se o MID sumiu ou não.

> [jungler na selva bot deles] eu tô na top lane […] Poderia avisar que tá gankando bot, mas não que tá na
> selva bot. Agora se avisasse que tá na selva top, ok.

> a questão de gank não é nem só pelo meu lado do mapa onde a Riot definiu, mas sim onde eu estiver
> posicionado (exemplo quando eu estiver movimentando e estiver no mid ou bot) (~12:10)

> faz sentido avisar quando tiver gank nas outras lanes, mesmo que não seja a minha, para que eu possa
> avisar meus colegas (~12:20)

> O mapa tá pintando muito feio […] deveria ser algo mais sutil […] mais transparente […] eu preciso
> entender o que é essas cores diferentes do círculo vermelho laranja amarelo. — eu apoio o mapa de
> calor. Mas precisa ser uma cor mais sutil. Com anti-aliasing. E, se possível, com uma transição
> fluida nesse crescimento dela. (~12:10)

Repetições que ele ouviu: "gank provável no top" várias vezes seguidas, "o top chegou no nível 16" 2x,
"o jungler chegou no nível 11" 2x, "curar do suporte voltou" 3x. Ele vai trazer mais calibração depois:
mexer **só** no que está aqui.

## Fatos medidos (log `dados/coletor.log`, partida 3293092537, gameTime 0 = 11:32:25)

Avisos emitidos na partida (voz / moldura): `jungler_apareceu` 14/23, `mid_sumiu` 10/25, `intruso` 7/13,
`intruso_grupo` 6/6, `adversario_voltou` 5/8, `gank` 5/5, `mid_indo` 3/7, `objetivo_60s` 4/0, `pico_nivel` 4/0,
`feitico_voltou` 2/0, `inimigo_fed` 1/0, `mortes_cedo` 1/0. Total 62 falas e 87 molduras em 24,5 min.

1. **`mid_sumiu` nunca era barrado pelo anti-spam**: a chave era o segundo em que o mid foi visto
   (`f"{int(s.visto)}"`), nova a cada sumiço, então o `repetir=30` nunca valia. Moldura em gt 37 (os minions
   nem tinham chegado: o Gabriel comentou isso no início da gravação), 140, 328, … e 7 vezes entre 1319 e 1450,
   com a base dele caindo (torre do inibidor do mid dele em 1367, inibidor em 1388; ele era CHAOS).
2. **`jungler_apareceu` com chave = zona do rótulo**: "rio bot" → "bot" → "selva bot" são 3 chaves; saíram 3
   molduras em 13 s (11:41:06–11:41:19, 11:52:57–11:53:09). E falava em qualquer lugar do mapa.
3. **As repetições de voz são eco da transcrição do Reco, não do coach**: "o top chegou no nível 16" saiu 1 vez
   (11:53:54), "o jungler chegou no nível 11" 1 vez (11:46:55), "curar do suporte voltou" 1 vez (11:48:32),
   "dragão em um minuto" 1 vez (11:36:25) e "gank provável no top" 1 vez em 11:38:28; a transcrição repete as
   mesmas (e "A destruição" ×5, "アーメン" ×11, que nem são do coach). Repetição real: gank top em 11:54:30 e
   11:55:01 (31 s, logo depois do `repetir=30`) e "o top voltou pra rota" 5 vezes na partida.
4. **Gank só olhava a rota do champ select** (`coach_vivo._jungler`: `euJogador.rota` primeiro, o ícone só com
   o Gabriel de selva) e só a rota dele.
5. **Overlay**: janela Tk com cor-chave (1,0,1) + alfa global 0,55: px ou é 100% da cor ou some, então a borda
   serrilha e não há como suavizar; amarelo (pouca chance) → laranja → vermelho (o mais provável) saturados, mais
   um contorno branco, redesenho a cada 400 ms aos saltos.

## Decisões técnicas

Quem decidiu: o agente executor (opus, técnico). Reverter = `git revert` do commit desta frente.

| # | decisão | confiança | o que reverteria |
| --- | --- | --- | --- |
| D1 | `mid_sumiu` só na fase de rotas: gameTime 90–840 s (minions chegam ~1:00; placas caem aos 14:00) e antes de cair qualquer torre externa do mid (`Turret_T*_L1_P3`) | alta | o Gabriel pedir "mid sumiu" no meio de jogo |
| D2 | `mid_sumiu` calado com: eu morto, eu na minha base, cerco (2+ inimigos vistos na minha base, ou torre de inibidor/nexo ou inibidor meu caído: `Turret_T<meu>_L*_P1/P4/P5`, `Inhib_T<meu>_`), luta (3+ inimigos à vista **juntos**, a ≤ 2500 de um deles: top, mid e dupla do bot cada um na sua rota não é luta), e mid visto por último fora da rota do meio e do rio (na selva ou na base já está fundo; o rio conta, é a moita do roam) | média | aviso que faltou numa partida medida |
| D3 | teto e intervalo **por tipo** no motor (`TIPOS[...]["teto"]`, `["intervalo"]`, independentes da chave): `mid_sumiu` 4 por partida e 120 s entre eles; `jungler_apareceu` 20 s; `mid_indo` 30 s. Vale para voz, moldura e painel juntos (é o aceite do aviso) | alta | — |
| D4 | voz não repete a mesma fala dentro de 60 s (`MotorAvisos.REPETIR_FALA_S`), qualquer tipo, fora o retorno de atalho; gank `repetir` 30 → 60 s | alta | gank legítimo repetido em < 60 s calado numa partida medida; também cala na voz um 2º "2 inimigos no top" (outro mergulho) em < 60 s (a borda continua) |
| D5 | "onde estou" = meu ícone no minimapa visto há ≤ 4 s; morto, na base ou sem ícone → a rota do champ select (reserva); no rio/selva → a rota mais perto (faixa de 1500), senão nenhuma | média | ícone próprio mal detectado (o minimapa acha 89% dos ícones) |
| D6 | `jungler_apareceu` com voz e moldura só se importa para onde estou: a ≤ 4000 unidades de mim, ou na zona de gank da minha rota (`top`: rota top, rio top, selva top dos dois; `bot` espelhado; `mid`: rota do meio e os dois rios). Longe = **só painel** (2ª tela), azul, prioridade 15 (abaixo das informativas: não tira "dragão em um minuto" da faixa), nada de voz nem borda; o overlay já mostra a área dele | média | o Gabriel sentir falta de saber o jungler longe |
| D7 | gank nas **3 rotas**: a minha (onde estou) com prioridade 100, urgente, vermelho; outra rota só com aliado visto nela há ≤ 5 s e adiantado (mais perto da fonte inimiga), prioridade 75, não urgente, amarelo, no máximo 1 a cada 30 s; por passo sai 1 gank só (a minha rota vence; entre as outras, a de maior massa). A distribuição do jungler é calculada 1 vez por passo (`jungler.gank(..., zonas=)`) | média | gank de outra rota demais numa partida medida: subir `coach_vivo.GANK_OUTRA_S`, baixar `avisos.PRIO_GANK_OUTRA`, ou exigir massa maior que `jungler.GANK_MASSA` para outra rota |
| D8 | overlay vira janela Win32 própria (molde da `moldura.py`) com `UpdateLayeredWindow` e alfa por px (BGRA pré-multiplicado), mantendo `WS_EX_TRANSPARENT/TOPMOST/TOOLWINDOW/NOACTIVATE` e `WDA_EXCLUDEFROMCAPTURE`. Tira de quebra o Tk, que rouba foco ao nascer (ARMADILHAS § Windows) | alta | ULW falhar em alguma máquina (log "overlay: UpdateLayeredWindow falhou") |
| D9 | mapa de calor de **uma cor só** (vermelho do anel do inimigo no minimapa, `COR`), probabilidade = opacidade (12% em **toda** a área com calor ≥ `LIMIAR` até 45% no mais provável; revisão: a 1ª versão usava uma rampa sobre o valor do calor e deixava a zona inteira de pouca chance a ~7%), sem contorno branco, borda suavizada (desfoque gaussiano σ 2 px na opacidade, inclusive no corte da fog), transição por média móvel (τ 0,35 s) entre quadros a ~10 fps, parada sem redesenho quando converge (a vitrine segue recebendo o quadro a cada 400 ms); some com esmaecimento | média (gosto) | o Gabriel achar fraco/forte: `ALPHA`, `ALPHA_MIN`, `COR` no topo do módulo |
| D10 | (revisão) `mid_indo` liberado pela **relevância** do sumiço, não pelo aceite do motor: sumiço que passou nos filtros, ou calado só por luta, eu morto ou eu na base (`LIBERA_MID_INDO`), libera o "mid indo X" mesmo com o "mid sumiu" barrado por intervalo/teto; fora da fase de rotas, torre do mid caída, cerco ou visto por último na selva, não. Cerco checado antes de eu morto/na base (o motivo liberador implica que o resto passou) | média | "mid indo" demais no meio de jogo numa partida medida |
| D11 | (revisão) eu de selva (`posicao == JUNGLE`): o "jungler apareceu" importa no mapa todo (o jungler deles é o adversário direto: invasão, contra-selva, objetivo), como antes da calibração; o docstring já dizia isso e o código não | média | o Gabriel jogar de selva e achar demais |
| D12 | (revisão) urgente com a mesma frase só barra em 10 s (`REPETIR_FALA_URGENTE_S`), não 60: o mesmo texto urgente pode ser outro perigo (gank de outra rota que virou o da minha rota; 2º mergulho). Repetição do mesmo evento a chave já barra (gank 60 s, intruso 15 s). Substitui a nota de D4 sobre o 2º "2 inimigos no top" | alta | — |
| D13 | (revisão) gank de outra rota: validade 22 s na fila (`VALIDADE_GANK_OUTRA` ≥ intervalo da voz: com os 6 s do tipo vencia mudo atrás de um "jungler apareceu"), tom sério sempre ("sai daí" do descontraído é para quem está na rota), cada aliado da rota testado, o mais adiantado primeiro (antes: o 1º em ordem alfabética, e se ele estava atrás o aviso sumia) | média | o aviso de outra rota chegar atrasado demais para servir (então: furar a fila em vez de esperar) |
| D14 | (revisão) "onde estou" na base **deles** (split push na torre do inibidor): a rota pela faixa sem margem dentro da base; perto do nexo (3 faixas) nenhuma. Antes: nenhuma rota e nenhum gank | alta | — |

Espelho do mapa: a geometria das rotas é absoluta (rota top = canto de cima à esquerda para os dois times);
base e selva são relativas ao meu time (`analise.regiao`, `jungler.nome_zona`), e `zonas_de_gank` usa os
nomes relativos. Nenhuma regra nova cita "top" fixo: tudo sai da rota onde estou ou da do champ select.

## Passos

1. Motor (`avisos.py`): `teto`/`intervalo` por tipo; fala repetida em 60 s; gank `repetir` 60.
2. `AlertasPosicao`: frescor do meu ícone, `onde_estou`, eventos de estrutura (`observar(..., eventos=)`),
   regras D1/D2 do `mid_sumiu` (chave fixa), `mid_indo` só depois de `mid_sumiu` aceito, D6 do jungler.
3. `coach_vivo._jungler`: rota de onde estou primeiro, D7; passa `eventos` ao `observar`.
4. Overlay Win32 + `renderizar` RGBA + `premultiplicar`; `vitrine.compor` com alfa por px; provas que
   comparavam com a cor-chave passam a olhar o alfa.
5. Provas: `teste-coach.py`, `teste-sugestoes.py`, `teste-alertas.py --sem-janela` (casos novos: cerco,
   fim de jogo, jungler longe/perto, gank em outra rota, onde estou), `teste-vitrine.py`, `teste-jungler.py`,
   `teste-alcance.py`; catálogo inalterado (`versao_catalogo() == b7043050b0b7`); custo do overlay medido;
   com o jogo fechado: `ensaio-coach.py` antes/depois, `overlay_minimapa.py --demo`, `teste-alertas.py`.
6. Docs: COLETOR (§ Minimapa, § Avisos ao vivo, § Coach na partida, vitrine), ARMADILHAS (chave nova a cada
   evento; cor-chave serrilha; eco do Reco).

## O que o overlay mostra (para o Gabriel)

- **Antes:** amarelo = o jungler deles **pode** estar ali, pouca chance; laranja = chance média; vermelho = o
  lugar mais provável; contorno branco = até onde ele conseguiria ter andado desde a última vez que foi visto.
  As cores eram relativas (o ponto mais provável do momento era sempre o vermelho mais forte).
- **Agora:** uma mancha vermelha clara só, da mesma família do anel vermelho dos inimigos no minimapa. Quanto
  **mais forte** o vermelho, mais provável ele estar ali; toda a área onde ele pode estar fica pelo menos
  levemente pintada (12%, o papel do antigo contorno branco) e a borda vai sumindo suave. A mancha cresce aos
  poucos enquanto ele está sumido (ele anda), some devagar 30 s depois da última pista e não pinta onde o teu
  time está vendo (lá ele não está).

## O que o pedido não dizia

- completei: `mid_indo` só sai depois de um sumiço relevante (sem o "sumiu", "mid indo" vira ruído). A 1ª
  versão exigia o "sumiu" **aceito** pelo motor; a revisão mostrou que o intervalo/teto matava o roam junto:
  hoje vale a relevância (D10).
- completei (revisão): o gancho da vitrine recebe o quadro a cada 400 ms com o overlay parado (sem isto a
  vitrine da próxima partida não teria print do overlay estável).
- completei: frescor do meu próprio ícone (antes valia a última posição para sempre: morto ou na fonte, o
  coach achava que eu continuava na rota), porque toda regra nova depende de "onde estou".
- completei: ensaio passa a contar molduras por tipo além das falas, porque o reclamado foi a moldura.
- fica de fora (não pedido): "o top voltou pra rota" (5 falas, 8 molduras); as 5 falas estão a mais de 1 min
  uma da outra no log, então a regra de fala repetida em 60 s **não** muda nada nela. Fica para a calibração
  que o Gabriel disse que vai trazer.

## Descartado e impraticável

- Reproduzir a partida de 14/10 ponta a ponta: não há gravação dela (`temp/gravacao/` só tem 13/10) e o banco
  guarda a Live Client a cada 10 s, sem as detecções do minimapa. Antes/depois em número = log real (antes) ×
  simulação das regras de tempo/estrutura sobre os mesmos instantes + ensaio da gravação de 13/10 (decisor:
  agente).
- (revisão, P3) Reavaliar o "mid sumiu" enquanto ele segue sumido, em vez de decidir numa foto do instante
  (3 inimigos juntos naquele segundo calam o sumiço inteiro): descartado. Com D10, o caso que importa (o mid
  indo para a luta do bot) sai como "mid indo bot" quando ele reaparece; reavaliar exigiria limite de idade do
  sumiço e contagem de motivo por sumiço, mais estado para um aviso que o teto já limita a 4 (decisor: agente).
- (revisão, P3) Andando pela selva longe das rotas nenhuma rota é vigiada (antes valia a do champ select):
  mantido, coerente com "onde estou"; cobrem o raio de 4000 do jungler e o gank das rotas com aliado.
  Documentado em COLETOR § Avisos ao vivo (decisor: agente; reverteria: aviso faltando numa partida medida).
