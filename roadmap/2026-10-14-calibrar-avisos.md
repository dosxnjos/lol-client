# Calibrar os avisos ao vivo e o overlay do minimapa (2ª ranqueada de 14/10/2026)

- **Data:** 14/10/2026 · **Alvo:** `coletor/avisos.py` (motor e `AlertasPosicao`), `coletor/coach_vivo.py` (gank),
  `coletor/overlay_minimapa.py` (janela e desenho), `coletor/vitrine.py` (composição), provas em `tools/`; passo 7:
  `coletor/servidor_local.py` (esquema da config), `pengu/config.js` e `pengu/blocos.js` (Configurações)
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
| D15 | (passo 7) cada regra nova vira chave **plana** em `cfg.coach` / `servidor_local.CONFIG_PADRAO`, padrão = o comportamento de D1–D14; entra pela mescla do `pengu/config.js` sem `VERSAO` nova (nenhum valor antigo a corrigir, como o `compacto`). Texto fora da lista volta ao padrão nos dois lados: `carregar()` do plugin (`ESCOLHAS`) e `ler_config` + `salvar_config` do coletor (antes só o POST conferia) | alta | — |
| D16 | (passo 7) gank de outra rota = caixa própria (`gankOutraRota`), não um tipo novo de aviso: tipo novo mudaria o `AVISOS`/`TIPOS_LIGAVEIS` e quem já calou "Gank provável" deixaria de calar o de outra rota. Ligado, ele segue as caixas voz/tela do "Gank provável" | alta | o Gabriel querer voz/tela separadas para o gank de outra rota |
| D17 | (passo 7) jungler longe = **uma lista de 3** (`junglerLonge`: só painel / falar e piscar a borda / não mostrar) em vez de duas caixas: cobre "escolher ou não" nos dois sentidos num controle só. "Tudo" publica igual ao perto (voz, borda, vermelho), mas com o intervalo de 20 s contado à parte (`Aviso.grupo="longe"`; revisão de 14/10/2026: sem isso o longe calava o perto que vinha depois) | média | o Gabriel achar a lista confusa |
| D18 | (passo 7) filtro do "mid sumiu" desligado = a regra de antes de 14/10 (só não conta o mid visto por último na base dele, motivo `base_dele`) **com** teto 4 e 120 s (D3), que são "limites de repetição"; corte da frase repetida desligado tira as duas janelas (60 s e os 10 s do urgente: antes de D4 não havia nenhuma) | alta | — |
| D19 | (passo 7) overlay: cores vermelho claro (padrão, `COR`), laranja `(240,140,50)` e **roxo** `(170,90,230)`; azul fica fora porque é a cor dos aliados no minimapa (mancha azul = "aliado ali"). Força sutil (0,30/0,08), normal (`ALPHA`/`ALPHA_MIN`), forte (0,60/0,18). Transição desligada = `tau` 0 (alvo na tela no 1º quadro). Troca em voo por `OverlayMinimapa.aplicar_estilo`; o estilo entra no estado do quadro, então o "parado" não segura a imagem velha | média (gosto) | o Gabriel pedir azul ou outra cor: 1 linha em `overlay_minimapa.CORES` + `servidor_local.ESCOLHAS` + `pengu/config.js OVERLAY_CORES` |
| D20 | (passo 8) **base presumida**: sem ícone fresco, a última pista "fui para a base" há ≤ 45 s (`AlertasPosicao.BASE_PRESUMIDA_S`: eu morto, meu ícone sumiu com o anel grosso de voltando à base, ou visto por último na minha base) = `onde_estou` fonte `base` (antes `reserva`). Com isso a regra do Gabriel ("na base ou morto, gank na minha rota só conta com aliado lá, como o de outra rota") sai do `decidir_gank` que já tratava base/morto assim. Sumir **na rota** (sem anel grosso) segue a reserva (D5). O `minimapa.Captura` passa `grande` nas detecções | média | gank faltando na rota dele logo depois de voltar da base numa partida medida (ícone não achado por mais de 4 s no caminho): baixar `BASE_PRESUMIDA_S`. A Yuumi aliada presa nele também dá anel grosso: com ela deduzida na minha posição (≤ 300) o anel não conta como voltar à base |
| D21 | (passo 8) a faixa do meio (\|y − x\| ≤ `M_MEIO`) é só do mid em `avisos.perto_da_rota` (fora `com_base`, que mantém o nexo sem rota, D14): com a margem de 1500 as rotas laterais pegavam a frente das bases no meio (torre do inibidor do mid a ~5300 do canto, fora do `R_BASE`) | alta | — |
| D22 | (passo 8) "visto" do painel = o mais recente entre a assinatura da Live Client (nível, itens, farm) e a última detecção do minimapa (`ao_vivo.mesclar_vistos`, no passo do coach; grava no banco também, então o `visto_gt` do `ao_vivo` passa a incluir o minimapa) | alta | detecção falsa do adversário no minimapa marcando "atual" o que está parado (o painel mostraria números velhos sem o cinza) |
| D23 | (passo 8, corrigida na revisão) overlay: a janela fica como está (a hipótese do print foi derrubada com prova). A causa do "não funcionou mais" é **defeito do desenho**, não gosto: o desfoque σ=2 do `alfa_alvo` diluía a mancha pequena (jungler recém-visto = calor de 1–2 px) a 2–8% de alfa; 4 dos 7 quadros de calor da partida ficaram abaixo de 16% (145059-03 0,09; 145529-13 0,11; 145659-15 0,04; 150000-21 0,15). Correção: pedaço pequeno (área < π·(2·`MANCHA_MIN_PX`)²) alarga 3 px antes do desfoque e o pico volta ao de antes do desfoque (nunca acima); zona grande fica com a borda de antes. Força e cor não mudam. Fica também o diagnóstico no log (`janela pronta`, `na tela {...}`, aviso se o jogo estava por cima na ordem Z) e a 2ª fase do `--demo` | alta | mancha de ponto grande demais ou "pulando" na tela (ele dizer): baixar `MANCHA_MIN_PX` para 2 (ponto ainda com área ≥ π·4² px acima de 10%). O log "na tela, sem o jogo por cima" **não** prova que ele viu: a janela TOPMOST sobre o jogo sem borda (`WindowMode=2`) não perde na ordem Z |
| D24 | (passo 8, revisão) eu na base (inclui a base presumida da D20) ou morto: **intruso** na minha rota só conta com aliado lá, a mesma regra do gank ("nem tinha aliado nenhum meu no top, então não fazia sentido se preocupar"). Quem chega enquanto estou fora já está na rota quando eu volto e não vira intruso (regra de 13/10). O "o top voltou" (morador) não muda | média | ele dizer que quer saber, da base, quem está esperando na rota dele: tirar o filtro `longe` do laço de intrusos em `AlertasPosicao.observar` |

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
7. **Tudo opcional nas Configurações** (pedido do Gabriel, 14/10/2026 ~12:25: "acho que todas essas opções de fala
   e notificação devem ser opcionais para a pessoa escolher ou não nas configurações"). Decisões D15–D19. Cada
   regra nova nasce ligada como está (padrão = passos 1–6); a tela é Configurações › LOL-CLIENT, texto de leigo.
   - Chaves (mesmo nome e padrão em `pengu/config.js PADRAO.coach` e `coletor/servidor_local.py CONFIG_PADRAO`;
     texto validado por `ESCOLHAS` nos dois): `gankOutraRota` (true), `junglerLonge` (`painel`), `midSumiuFiltro`
     (true), `cortarFalaRepetida` (true), `overlayCor` (`vermelho`), `overlayForca` (`normal`), `overlaySuave` (true).
   - Coletor: `avisos.decidir_gank(..., outras=)`, `AlertasPosicao.configurar(filtro_mid=, jungler_longe=)`,
     `MotorAvisos.configurar(cortar_repetida=)`, `overlay_minimapa.estilo()/Estilo/aplicar_estilo` (desenho com
     estilo opcional; sem ele, as constantes do módulo). `coach_vivo._Partida.configurar` aplica tudo na largada e a
     cada `POST /config`; `_configurar_pos` também quando o `AlertasPosicao` nasce (depois da largada).
   - Tela (`pengu/blocos.js`): bloco **Voz** ganha "Não repetir a mesma frase em menos de 1 minuto" e o texto
     certo da voz (Aoede gravada, Maria do Windows só para a frase que falta; antes dizia "voz Maria do Windows");
     bloco **Alertas** ganha "Avisar gank nas outras rotas", a lista "Jungler inimigo longe de ti" e "Avisar 'mid
     sumiu' só quando faz sentido"; bloco **Minimapa** ganha "Cor da mancha", "Força da cor", "Mancha muda aos
     poucos" e um "Como ler".
   - Provas (cada chave: desligada muda, ligada = hoje): `node tools/teste-config.mjs` (padrão, mescla sem regravar,
     inválido = padrão, controles na tela), `python tools/teste-alertas.py --sem-janela` (`escolhas_config`: gank,
     jungler longe nos 3 modos, filtro do mid em 0:20/22 min/cerco, teto mantido, corte da frase, esquema do
     coletor, listas iguais nos 3 lugares), `python tools/teste-overlay.py` (cor, força, sem transição, troca em
     voo), `python tools/teste-coach.py` (`caso_escolhas_config`: largada, `AlertasPosicao` tardio, overlay e POST).
     Catálogo inalterado (`b7043050b0b7`). Com o jogo fechado: `python tools/rodar-testes.py` (42/42 em 14/10).
   - Revisão (14/10/2026): `junglerLonge="tudo"` dividia o intervalo de 20 s com o jungler de perto e calava ele →
     `Aviso.grupo` (o motor conta o intervalo por tipo, destinos e grupo; caso "longe aos 0 s não cala o PERTO aos
     12 s" nos modos tudo e painel); o `caso_escolhas_config` passa a criar o `AlertasPosicao` pelo `passo()` real
     (allgamedata com `GameStart`); textos da tela corrigidos (longe = de onde tu está agora, a linha do tipo cala
     perto e longe; a mancha some 30 s depois da última pista; "Vermelho (padrão)"). Ficou como está: valor
     inválido no `POST /config` volta ao padrão (não mantém o salvo), como diz a doc; só plugin com bug chega lá.
     Sem prova: `gankOutraRota=false` lido em `coach_vivo._jungler` (o `decidir_gank(outras=False)` está provado).
   - Falta (orquestrador, no lobby): reiniciar o coletor e recarregar o client para a tela nova aparecer; olhar a
     seção LOL-CLIENT com os textos novos.
8. **Relato da partida 3293137136** (14/10/2026, ~14:46–15:15, top de Renekton contra K'Sante, coletor rodando
   d913c28; gameTime 0 ≈ 14:47:02). O Gabriel, em palavras dele (decisões D20–D23):
   1. "O overlay do mapa não funcionou mais." O coach desenhou (`dados\coletor.log`: a vitrine gravou
      `overlay-calor`/`overlay-texto` 14:50–15:01; `temp\vitrine\2026-10-14\14*-minimapa-*.png`).
   2. "O coach ao vivo não está encontrando o oponente na lane [...] mesmo que ele estivesse aparecendo no
      minimapa. Ele só encontrou depois que apareceu na minha tela."
   3. "Tava só eu e o Gragas (o mid deles), ambos na top lane, e eu recebi o aviso sonoro de que tinham quatro no
      top, sendo que eu tava vendo dois no mid e um no bot. Dois na base do mid deles e um no bot lá no meio da
      lane." (log 15:07:57 `intruso_grupo/vermelho: 4 inimigos top`)
   4. "Acho que apareceu gank provável no top sendo que eu já tava na base [...] nem tinha aliado nenhum meu no
      top, então não fazia sentido se preocupar com isso." Regra pedida: na base ou morto, gank na rota dele só
      conta se houver aliado lá (como gank de outra rota).
   - **Causas, com evidência:**
     - (1) Hipótese "a janela nova (UpdateLayeredWindow) entra no print do minimapa e o coach lê a própria mancha"
       **derrubada**: com o jogo fechado, na ordem da produção (exclusão pedida ao nascer), afinidade lida de volta
       `0x11`, R − G médio da área quente no print ~0 com a exclusão e +65 sem ela; a janela vai ao lugar pedido.
       O detector rodado sobre os prints da vitrine (camada descontada) acha o K'Sante em 7 de 12 recortes
       (`minimapa.py` sem mudança desde 13/10). O que está medido: a mancha nova muda a tela ~8× menos que a do Tk (diferença média
       25–38 na área pintada contra ~200) e metade dos quadros de calor é um ponto (alfa máx 4–15%). Se a janela
       apareceu in-game **não tem prova** (o print nunca mostra a janela, por regra): entra diagnóstico no log.
       **Causa achada na revisão (D23):** o desfoque σ=2 do `alfa_alvo` diluía a mancha pequena; alfa máximo medido
       no código de antes: ponto de 1 px 0,018, raio 1 px 0,08, 3 px 0,31, só de 5 px para cima 0,43–0,45. Nos
       prints da partida (`*-camada.png`), 4 de 7 quadros de calor ficaram entre 4% e 15%. O Tk de manhã também
       tinha manchas minúsculas, mas pintava o ponto em cor cheia a 55% com contorno branco: era visível.
     - (2) O "visto" do painel (adversário de rota: "visto há X s: dados dele parados") era só a assinatura da
       Live Client (nível, itens, farm), e o farm anda de 10 em 10: em gt 843,8 o minimapa achou o K'Sante e o
       painel dizia "visto há 34 s"; 34 de 142 amostras dele vivo estavam "paradas". Leitura do agente: ele falava
       do bloco de rota do painel (é o único lugar que diz "não visto" do adversário); se era a voz "o top voltou",
       é outra coisa e fica para a próxima calibração.
     - (3) `avisos.perto_da_rota` alargava top/bot em 1500 (x < 3800, y > 11180) e a frente da base no meio
       (torre do inibidor do mid, ~5300 do canto, fora do `R_BASE`) contava como top, mid e bot: o Gragas chegando
       no top + 3 inimigos na frente da base do mid deles = "4 inimigos top" (quais 3 não está no log; o que casa
       com "dois na base do mid deles" é a dupla do bot com a Yuumi presa, que conta 2, e o Graves; o K'Sante mora
       no top e não entra na conta). Reproduzido no teste com as posições das torres: o código de antes fala
       "3 inimigos no mid" e, 20 s depois, com o mid deles chegando no top, "4 inimigos no top", a mesma dupla do
       log (15:07:42 "2 inimigos mid", 15:07:57 "4 inimigos top").
     - (4) O `decidir_gank` já tratava "na base/morto" como pedido, mas só com o meu ícone **visto** na base; o
       ícone na fonte fica no canto do minimapa e mal é achado (anel 0,301 contra o limiar 0,30): sem ícone por
       4 s, "onde estou" virava a rota do champ select e o gank do top saía urgente.
   - **Correções:** `avisos.perto_da_rota` (faixa do meio só do mid, D21); `AlertasPosicao` com base presumida e
     `minimapa.Captura` passando `grande` (D20); `ao_vivo.mesclar_vistos` chamado no passo do coach (D22);
     `overlay_minimapa`: `diagnostico()`, `por_cima()`, log `janela pronta`/`na tela`/ordem Z e a 2ª fase do
     `--demo` na ordem da produção (D23). Da revisão: `overlay_minimapa.alfa_alvo` com mancha mínima e pico
     preservado (D23); `ao_vivo.mesclar_vistos` refaz também o bloco da **ameaça** (o painel desenha `a.atual` e
     `a.vistoHaS` dessa cópia, que seguia "visto há 34 s" com o adversário à vista); intruso na minha rota calado
     comigo na base ou morto sem aliado lá (D24); Yuumi aliada com nome de campeão repetido ("Yuumi ORDER").
   - **Efeito colateral da D20 (sabido):** com a base presumida (≤ 45 s depois de morrer ou voltar à base) o
     "mid sumiu" também se cala (motivo `eu_na_base`), como já acontecia com o ícone visto na base.
   - **Provas** (falham no código de antes: rodadas sobre uma cópia do `HEAD` em pasta temporária):
     `python tools\teste-alertas.py --sem-janela` (`revisao_3293137136`: geometria, "4 inimigos" → "intruso top"
     amarelo, base presumida em 3 caminhos e o lado oposto: sumir na rota ou com a Yuumi presa = reserva), `python tools\teste-coach.py`
     (`caso_visto_minimapa`: unidade e o caminho real `Coach._ao_ler`), `python tools\teste-overlay.py` (ordem Z
     falsa; e, da revisão, mancha de ponto/raio 1, 3 e 10 px no `ALPHA` com área ≥ π·4² px acima de 10%, que dava
     0,018 antes), `python tools\teste-minimapa.py` (interface com `grande`). Da revisão também: `teste-coach`
     (a ameaça vira "atual") e `teste-alertas` (intruso no top vazio comigo na base calado; com aliado ou eu na
     rota, avisa), os dois falhando no código anterior à revisão.
   - **Provado depois, com o jogo fechado (revisão):** `python coletor\overlay_minimapa.py --demo --left 1800 --top 300`
     ok nas duas fases (fora do print, R − G +0 com a exclusão e +57 sem; em (1000, 300) dá FALHOU porque há tela
     animando atrás, a armadilha já registrada); `rodar-testes.py` 42/42. Janela real com um ponto de 1 px de
     calor, print com a exclusão desligada: código de antes = nada na tela (R − G máx +4); agora 64 px avermelhados
     (R − G até +76). O `--demo` quebrava na 2ª fase com a saída redirecionada (cp1252 no "R−G"): corrigido.
   - **Sem prova:** o overlay in-game (próxima partida: perguntar se viu a bolinha logo depois de o jungler ser
     visto; no log, `overlay: na tela` e `POR CIMA`).
   - **Na próxima partida:** perguntar se viu a mancha **pequena** (logo depois de o jungler ser visto). Se não
     viu nem a grande e o log diz `overlay: na tela`, aí é janela/contraste; "Força Forte" sozinha não resolvia
     o ponto (0,60 no mesmo desfoque dava ~2% em r=0) e por isso não é a resposta para a mancha pequena.
   - **Notas da revisão, não corrigidas (sem caso medido, risco de piorar):** `minimapa.Detector._yuumi` pode
     pôr uma Yuumi inimiga fantasma num inimigo voltando à base (conta no "N inimigos" e vira "visto" no painel);
     a junção de dois candidatos no mesmo centro (`minimapa.py`, raio 0,6·r_anel) não olha o time, então num
     corpo a corpo a menos de ~370 unidades um dos dois ícones some. Nos 12 prints da partida nenhum dos dois
     aconteceu. Risco conhecido da D20: ícone dele perdido em < 4 s logo ao sair da base deixa o gank real no
     top "só com aliado" por até 45 s.

## O que o overlay mostra (para o Gabriel)

- **Antes:** amarelo = o jungler deles **pode** estar ali, pouca chance; laranja = chance média; vermelho = o
  lugar mais provável; contorno branco = até onde ele conseguiria ter andado desde a última vez que foi visto.
  As cores eram relativas (o ponto mais provável do momento era sempre o vermelho mais forte).
- **Agora:** uma mancha vermelha clara só, da mesma família do anel vermelho dos inimigos no minimapa. Quanto
  **mais forte** o vermelho, mais provável ele estar ali; toda a área onde ele pode estar fica pelo menos
  levemente pintada (12%, o papel do antigo contorno branco) e a borda vai sumindo suave. Logo depois de ele
  ser visto, a mancha é uma bolinha pequena no vermelho mais forte (desde a revisão de 14/10: antes ela
  sumia no desfoque e o overlay parecia desligado). A mancha cresce aos
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
- completei (passo 7): valor de texto inválido no `dados\config.json` (editado à mão, versão futura) caía direto na
  partida, porque o `ler_config` não conferia a lista (só o POST); agora volta ao padrão também na leitura, e no
  plugin a mescla, que só olhava o tipo, confere as listas novas.
- completei (passo 7): "Como ler" a mancha no bloco Minimapa (ele perguntou o que eram as cores, ~12:10).
- completei (passo 8): "voltando à base" (anel grosso no meu ícone que some) também presume a base, não só a
  morte: ele disse "eu já tava na base", e o recall é o outro jeito de chegar lá sem morrer.
- completei (passo 8): o "visto" do minimapa vale para todo inimigo do painel e entra no `visto_gt` gravado no
  banco (o mentor lê quem está "parado"), não só no adversário de rota.
- completei (passo 8): log `overlay: janela pronta (fora do print: …)`; antes o resultado da exclusão nem era
  registrado, e não havia como saber depois da partida se a janela foi à tela.
- completei (revisão do passo 8): a regra do gank na base (D20) também para o intruso (D24); senão, por até
  45 s com ele na base, "intruso top" seguia vigiando o top vazio, o mesmo "não fazia sentido se preocupar".
- completei (revisão do passo 8): o bloco da ameaça do painel também recebe o "visto" do minimapa; sem isto o
  "não encontrou o oponente" continuava no bloco ao lado do de rota.
- fica de fora (passo 8, não pedido): a Yuumi inimiga presa conta 2 no "N inimigos" (ela está lá); o jogo por
  cima do overlay só é avisado, não corrigido além do "sempre no topo" de 1 s que já existia.
- correção (passo 8): o "baixar o accept para 8 segundos" do mesmo relato já está feito (`aceiteAtrasoS: 8` na
  linha `config do coach` de 15:19:04); não é desta frente.
- fica de fora (passo 7, não pedido): atalho Ctrl+K para as chaves novas e o `alfa` que a vitrine grava no jsonl
  (segue o `ALPHA` do módulo, não a força escolhida; a imagem gravada já sai com a força certa).
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
