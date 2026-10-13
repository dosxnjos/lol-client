// Pós-jogo v2 (plano v2, passo 7) sem o client: monta as 6 abas (pengu/posjogo/abas.js) para a partida de
// referência (fixtures) e para a real 3292746609 (dump do tools/teste-licoes.py em temp/licoes/), com e sem o
// contexto do coletor, e confere estrutura e números: 6 abas, 3 lições, nada de undefined/NaN, objetivos e
// curvas batendo com a linha do tempo, tendência com ≤ 20 partidas anteriores, sessão contendo esta partida.
// uso: python tools/teste-licoes.py && node tools/teste-abas.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analisar, trajeto } from '../pengu/posjogo/analise.js';
import { licoes } from '../pengu/posjogo/licoes.js';
import { ABAS, curvas, objetivosDaPartida, tendencia, sessaoDaPartida, alertasSessao, htmlTopo, htmlMentor,
  abaResumo, abaRota, abaMortes, abaObjetivos, abaTendencia, abaSessao } from '../pengu/posjogo/abas.js';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const lerJson = p => JSON.parse(readFileSync(raiz + p, 'utf8'));
const regras = readFileSync(raiz + 'pengu/posjogo/licoes.md', 'utf8');
const falhas = [];
const conta = (html, re) => (html.match(re) || []).length;

function caso(gid, partida, linha, hist, puuid, dump) {
  const r = analisar(partida, linha, puuid, hist);
  const meu = partida.participants.find(p => p.participantId === r.participantId);
  Object.assign(r, {
    trajeto: trajeto(linha, r.participantId), campeoes: Object.fromEntries(partida.participants.map(p => [p.participantId, p.championId])),
    curva: curvas(linha, r.participantId, r.adversario?.participantId), objetivos: objetivosDaPartida(partida, linha, r.time),
    stats: meu.stats, criacao: partida.gameCreation,
    tendencia: tendencia(meu.stats, partida.gameDuration, hist, gid, partida.gameCreation),
    sessao: sessaoDaPartida(hist, { gameId: gid, criacao: partida.gameCreation, duracao: partida.gameDuration, vitoria: r.vitoria,
      campeao: meu.championId, k: meu.stats.kills, d: meu.stats.deaths, a: meu.stats.assists, fila: partida.queueId }),
  });
  const nomes = dump.nomes || {};
  const nome = id => nomes[String(id)] || `campeão ${id}`;
  for (const ctx of [null, dump.contexto]) {
    const lic = licoes(regras, r, hist, partida.gameCreation, ctx, nomes).licoes;
    if (ctx && JSON.stringify(lic) !== JSON.stringify(dump.licoes)) falhas.push(`${gid}: lições com contexto diferentes das do Python`);
    const html = htmlTopo(r, nome) + [abaResumo(r, lic, ctx ? 'ok' : 'fora'), abaRota(r, nome), abaMortes(r, nome), abaObjetivos(r),
      abaTendencia(r, nome, ctx, ctx ? 'ok' : 'fora', { revisao: { n: 26, acertos: 3, precisao: 0.115, raio: 1000 }, acumulada: { partidas: 1, n: 26, acertos: 3, precisao: 0.115 } }, true),
      abaSessao(r, nome, r.sessao, { queueMap: { RANKED_SOLO_5x5: { tier: 'GOLD', division: 'II', leaguePoints: 40, wins: 10, losses: 9 } } }, ctx, ctx ? 'ok' : 'fora', 1)].join('');
    const tag = `${gid}${ctx ? ' com contexto' : ' sem coletor'}`;
    if (conta(html, /data-aba="/g) !== 6) falhas.push(`${tag}: ${conta(html, /data-aba="/g)} abas`);
    if (conta(html, /class="lc-licao /g) !== 3) falhas.push(`${tag}: ${conta(html, /class="lc-licao /g)} lições`);
    if (/undefined|NaN|\[object/.test(html)) falhas.push(`${tag}: ${html.match(/.{40}(undefined|NaN|\[object).{20}/)?.[0]}`);
    console.log(`${tag}: ${lic.map(l => l.id).join(' > ')} · ${(html.length / 1024).toFixed(0)} KB`);
  }
  // números contra a linha do tempo
  const evs = linha.frames.flatMap(f => f.events || []);
  const nObj = evs.filter(e => e.type === 'BUILDING_KILL' || (e.type === 'ELITE_MONSTER_KILL' && (e.killerId || e.assistingParticipantIds?.length))).length;
  if (r.objetivos.length !== nObj) falhas.push(`${gid}: ${r.objetivos.length} objetivos x ${nObj} na linha do tempo`);
  const torresMinhas = evs.filter(e => e.type === 'BUILDING_KILL' && e.buildingType === 'TOWER_BUILDING' && e.teamId !== r.time).length;
  if (r.objetivos.filter(o => o.tipo === 'TOWER_BUILDING' && o.lado === 'aliado').length !== torresMinhas) falhas.push(`${gid}: torres do meu time`);
  if (r.curva.length !== linha.frames.length) falhas.push(`${gid}: curva ${r.curva.length} x ${linha.frames.length} quadros`);
  const d10 = r.diffs['10'], p10 = r.curva[10];
  if (d10 && (p10.eu.ouro - p10.adv.ouro !== d10.ouro || p10.eu.xp - p10.adv.xp !== d10.xp)) falhas.push(`${gid}: curva aos 10 x diffs`);
  if (r.tendencia.length !== 4 || r.tendencia.some(t => t.n > 20)) falhas.push(`${gid}: tendência`);
  if (!r.sessao.lista.some(p => p.esta) || r.sessao.seq < 1) falhas.push(`${gid}: sessão sem esta partida`);
  console.log(`  objetivos ${r.objetivos.length} · curva ${r.curva.length} min · tendência n=${r.tendencia[0].n} (${r.tendencia.map(t => `${t.id} ${t.esta.toFixed(1)}/${t.media?.toFixed(1)} ${t.melhor}`).join(', ')}) · sessão ${r.sessao.lista.length} (${r.sessao.posicao}ª, seq ${r.sessao.seq})`);
}

const dumpDe = gid => {
  const p = `temp/licoes/${gid}.json`;
  if (!existsSync(raiz + p)) { console.log(`FALHOU: sem ${p} (rode antes: python tools/teste-licoes.py)`); process.exit(1); }
  return lerJson(p);
};
const fx = n => lerJson(`tests/fixtures/${n}`);
caso(3292712362, fx('game-3292712362.json'), fx('timeline-3292712362.json'), fx('historico.json').games.games, fx('summoner.json').puuid, dumpDe(3292712362));
const d = dumpDe(3292746609);
caso(3292746609, d.partida, d.timeline, d.historico, d.puuid, d);

// alertas da sessão: 3 derrotas seguidas com o histórico do coletor; faixa horária ruim; sem contexto, nada
const hist = { geral: { n: 170, wr: 54 }, faixas: { '00-06': { n: 30, wr: 47 } }, apos_derrotas: { 3: { n: 12, wr: 33.3 } } };
const al = alertasSessao({ seq: 3 }, { vitoria: false }, hist, 2);
if (al.length !== 2 || !al[0].texto.includes('33%') || !al[1].texto.includes('47%')) falhas.push(`alertas: ${JSON.stringify(al)}`);
if (alertasSessao({ seq: 1 }, { vitoria: false }, null, 2).length) falhas.push('alerta sem contexto');
// mentor: estados do coletor viram HTML sem quebrar
for (const m of [null, { status: 'fora' }, { status: 'nada' }, { status: 'pensando', conversa: [] },
  { status: 'pronto', texto: 'Veredito: ok.\nLições: **1.** x', conversa: [{ uso: 'pergunta', pergunta: 'e o <b>?', status: 'pronto', resposta: 'r' }] },
  { status: 'erro', conversa: [{ uso: 'posjogo', erro: 'timeout' }] }]) {
  const h = htmlMentor(m);
  if (/undefined|<b>\?/.test(h)) falhas.push(`mentor ${m?.status}: ${h.slice(0, 80)}`);
}
console.log(falhas.length ? falhas.map(f => `FALHOU: ${f}`).join('\n') : `ok (${ABAS.length} abas x 2 partidas x com/sem coletor)`);
process.exit(falhas.length ? 1 : 0);
