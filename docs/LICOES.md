# Lições do coach

As regras do pós-jogo moram em [pengu/posjogo/licoes.md](../pengu/posjogo/licoes.md) (arquivo dono,
lido pelo plugin e pelo `coletor/coach.py`). Métricas: [INSIGHTS.md § Métricas das lições](INSIGHTS.md#métricas-das-lições).

Os textos dos **avisos ao vivo** (voz e moldura) moram na seção abaixo: o `coletor/avisos.py`
(`carregar_textos`) lê a 1ª seção `## Avisos ao vivo` que achar, no `pengu/posjogo/licoes.md` e depois
aqui; tipo que faltar fica com o padrão do código (`avisos.TEXTOS`). Ajustar o tom é editar a linha,
sem mexer em código; vale na próxima partida (o motor lê no início de cada uma).

Formato, uma linha por tipo: `` - `tipo` | sério: fala / rótulo | descontraído: fala / rótulo ``. O
rótulo (moldura e faixa do painel) fica com as 3 primeiras palavras.

A **fala é genérica** (voz pré-gravada, 13/10/2026): diz a rota, nunca o campeão, e nenhum número aberto,
porque cada fala possível é gravada uma vez num pacote de áudio (`avisos.catalogo()`). Placeholders da
fala: `{zona}` ("no rio top"), `{rota}` ("top", "jungler", "mid", "atirador", "suporte"; "inimigo" sem
posição), `{objetivo}`, `{n}` (2 a 5), `{feitico}` ("flash"), `{pico}` (6, 11, 16). Só do rótulo:
`{campeao}`, `{zc}` ("rio top"), `{zt}` ("rio"), `{nivel}`, `{feitico_nome}`, `{ouro}`. Fala com
placeholder de rótulo (ex.: `{campeao}`) sai do pacote e é lida ao vivo pela Maria; mudar uma fala pede
regerar o pacote (`tools/gerar-pacote-voz.py`, só a fala nova é gerada). Quando cada tipo dispara,
prioridade e cor: [COLETOR § Avisos ao vivo](COLETOR.md#avisos-ao-vivo-voz-e-moldura-plano-v2-passos-12-e-15c).

## Avisos ao vivo

- `gank` | sério: gank provável {zona} / gank {zc} | descontraído: olha o gank {zona}, sai daí / gank {zc}
- `intruso_grupo` | sério: {n} inimigos {zona} / {n} inimigos {zt} | descontraído: {n} vindo {zona}, recua / {n} inimigos {zt}
- `intruso` | sério: o {rota} chegando {zona} / intruso {zc} | descontraído: visita: o {rota} {zona} / visita {zc}
- `jungler_apareceu` | sério: jungler {zona} / jungler {zc} | descontraído: achei o jungler: {zona} / jungler {zc}
- `mid_indo` | sério: o mid saiu da rota: {zona} / mid indo {zt} | descontraído: o mid largou a rota, tá {zona} / mid indo {zt}
- `mid_sumiu` | sério: mid sumiu / mid sumiu | descontraído: cadê o mid? sumiu / mid sumiu
- `janela_objetivo` | sério: {n} inimigos mortos: {objetivo} / janela {objetivo} | descontraído: {n} mortos, bora {objetivo} / bora {objetivo}
- `objetivo_60s` | sério: {objetivo} em um minuto / {objetivo} 1 min | descontraído: {objetivo} nasce em um minuto, se prepara / {objetivo} 1 min
- `mortes_cedo` | sério: duas mortes antes dos dez, joga seguro / joga seguro | descontraído: tu tá duas mortes antes dos dez, segura a onda / segura a onda
- `adversario_voltou` | sério: o {rota} voltou pra rota / {campeao} voltou | descontraído: o {rota} voltou, cuidado / {campeao} voltou
- `inimigo_fed` | sério: o {rota} tá forte, evita o um contra um / evita 1x1 | descontraído: o {rota} tá fed, nada de um contra um / evita 1x1
- `ouro_guardado` | sério: ouro guardado, hora de voltar? / hora de voltar | descontraído: tá rico, volta e gasta / hora de voltar
- `feitico_voltou` | sério: {feitico} do {rota} voltou / {campeao} com {feitico_nome} | descontraído: {feitico} do {rota} voltou, cuidado / {campeao} com {feitico_nome}
- `pico_nivel` | sério: o {rota} chegou no nível {pico} / {campeao} nível {nivel} | descontraído: o {rota} chegou no nível {pico}, respeita / {campeao} nível {nivel}
- `pico_nivel_visto` | sério: o {rota} já passou do nível {pico} / {campeao} nível {nivel} | descontraído: o {rota} já passou do nível {pico}, respeita / {campeao} nível {nivel}
- `pico_item` | sério: o {rota} fechou item / {campeao} fechou item | descontraído: o {rota} fechou item, ficou forte / {campeao} fechou item
