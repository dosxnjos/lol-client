# Lições do coach

As regras do pós-jogo moram em [pengu/posjogo/licoes.md](../pengu/posjogo/licoes.md) (arquivo dono,
lido pelo plugin e pelo `coletor/coach.py`). Métricas: [INSIGHTS.md § Métricas das lições](INSIGHTS.md#métricas-das-lições).

Os textos dos **avisos ao vivo** (voz e moldura) moram na seção abaixo: o `coletor/avisos.py`
(`carregar_textos`) lê a 1ª seção `## Avisos ao vivo` que achar, no `pengu/posjogo/licoes.md` e depois
aqui; tipo que faltar fica com o padrão do código (`avisos.TEXTOS`). Ajustar o tom é editar a linha,
sem mexer em código; vale na próxima partida (o motor lê no início de cada uma).

Formato, uma linha por tipo: `` - `tipo` | sério: fala / rótulo | descontraído: fala / rótulo ``. O
rótulo (moldura e faixa do painel) fica com as 3 primeiras palavras. Placeholders: `{campeao}`,
`{zona}` (fala: "no rio top"), `{zc}` (rótulo: "rio top"), `{zt}` (1 palavra: "rio"), `{objetivo}`,
`{n}`, `{ouro}`. Quando cada tipo dispara, prioridade e cor: [COLETOR § Avisos ao vivo](COLETOR.md#avisos-ao-vivo-voz-e-moldura-plano-v2-passos-12-e-15c).
Feitiço que voltou e picos de força do adversário montam o texto no código (`feiticos.py`, `sugestoes.py`).

## Avisos ao vivo

- `gank` | sério: gank provável {zona} / gank {zc} | descontraído: olha o gank {zona}, sai daí / gank {zc}
- `intruso_grupo` | sério: {n} inimigos {zona} / {n} inimigos {zt} | descontraído: {n} vindo {zona}, recua / {n} inimigos {zt}
- `intruso` | sério: {campeao} chegando {zona} / intruso {zc} | descontraído: visita: {campeao} {zona} / visita {zc}
- `jungler_apareceu` | sério: jungler {zona} / jungler {zc} | descontraído: achei o {campeao}: {zona} / jungler {zc}
- `mid_indo` | sério: mid saiu da rota: {campeao} {zona} / mid indo {zt} | descontraído: {campeao} largou o mid, tá {zona} / mid indo {zt}
- `mid_sumiu` | sério: mid sumiu / mid sumiu | descontraído: cadê o {campeao}? mid sumiu / mid sumiu
- `janela_objetivo` | sério: {n} inimigos mortos: {objetivo} / janela {objetivo} | descontraído: {n} mortos, bora {objetivo} / bora {objetivo}
- `objetivo_60s` | sério: {objetivo} em um minuto / {objetivo} 1 min | descontraído: {objetivo} nasce em um minuto, se prepara / {objetivo} 1 min
- `mortes_cedo` | sério: duas mortes antes dos dez, joga seguro / joga seguro | descontraído: tu tá duas mortes antes dos dez, segura a onda / segura a onda
- `adversario_voltou` | sério: {campeao} voltou pra rota / {campeao} voltou | descontraído: {campeao} voltou, cuidado / {campeao} voltou
- `inimigo_fed` | sério: {campeao} forte, evita o um contra um / evita 1x1 | descontraído: {campeao} tá fed, nada de um contra um / evita 1x1
- `ouro_guardado` | sério: {ouro} de ouro guardado, hora de voltar? / hora de voltar | descontraído: tá rico: {ouro} de ouro, volta e gasta / hora de voltar
