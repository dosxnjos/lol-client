// Contexto do pós-jogo e do selo da seleção sobre as linhas do acumulador (../historico.js), sem o complemento coach
// (roadmap/2026-10-17-plugin-pengu-primeiro.md, Fase 5). Porta de coletor/analise.py (matchups, traumas) e de coletor/coach.py
// (historico_tilt, _traumas, contexto_partida): mesma spec (docs/INSIGHTS.md § Matchups, § Traumas, § Pós-jogo v2), mesma
// saída, para o licoes.js (montarMetricas) e as abas não mudarem. Terceira implementação da mesma spec: quem muda uma muda as
// outras. Paridade: tools/teste-contexto.mjs e tools/teste-contexto.py sobre tools/fixtures/historico-1.json.
// Entrada: linhas do acumulador como objetos (historico.js comoObjeto / linhas()): gameId, criacao, duracao, fila, campeao,
// papel, adversario, incerto, vitoria, ouro10..farm15, mortes10, solo10, gank10, cs, inimigos. Só partidas próprias do Rift.
// Ordem e comparação iguais às do Python: soma da esquerda para a direita, ordem por criação crescente, texto comparado por
// < e > (nunca localeCompare). Módulo puro: roda no node.
import { FORA_DAS_CONTAS } from './analise.js';
import { faixa } from './licoes.js';

export const MIN_MATCHUP = 3;      // analise.MIN_MATCHUP
export const K_TRAUMA = 10;        // analise.K_TRAUMA
export const LIFT_TRAUMA = 1.2;    // analise.LIFT_TRAUMA
export const REMAKE_S = 300;       // analise.REMAKE_S
export const MS_10 = 600000;
export const SESSAO_GAP_MS = 2 * 3600 * 1000;   // coach.SESSAO_GAP_MS
// amostra local mínima para o pós-jogo usar este contexto e para a chave "Mostrar traumas" aparecer sem o complemento:
// 3 partidas, o mínimo de um trauma (n >= 3). Abaixo disso, as lições ficam como sem contexto
export const AMOSTRA_LOCAL = 3;
// freios (Fase 5 passo 3): os números da confirmação só com 30 partidas no acumulador; cada número só com 10 na própria faixa
export const PISO_MEDICAO = 30;
export const PISO_FAIXA = 10;

const nulo = v => v === null || v === undefined;
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// partida que entra nas contas (mapa 11 já é garantido pelo acumulador): coach._valida sem o alvo
const contaLinha = l => !!l && !FORA_DAS_CONTAS.includes(l.fila) && l.duracao >= REMAKE_S;
// analise.matchups só lê partidas com linha do tempo (tem_timeline=1): no acumulador, mortes10 só existe com ela
const temLinhaDoTempo = l => !nulo(l.mortes10);
const media = vs => (vs.length ? vs.reduce((s, v) => s + v, 0) / vs.length : null);
const porCriacao = linhas => [...linhas].sort((a, b) => a.criacao - b.criacao);

// analise.matchups(c, campeao): grupos (meu campeão, papel, adversário de rota) -> {matchups, partidas, fora}
export function matchups(linhas, campeao = null) {
  const ps = porCriacao((linhas || []).filter(l => contaLinha(l) && temLinhaDoTempo(l) && (nulo(campeao) || l.campeao === campeao)));
  const fora = { sem_papel: 0, incerto: 0 };
  const grupos = new Map();
  for (const l of ps) {
    if (!l.papel || nulo(l.adversario)) { fora.sem_papel++; continue; }
    if (l.incerto) { fora.incerto++; continue; }
    const chave = `${l.campeao}|${l.papel}|${l.adversario}`;
    if (!grupos.has(chave)) grupos.set(chave, { campeao: l.campeao, papel: l.papel, adversario: l.adversario, jogos: [], d: { 10: [], 15: [] } });
    const g = grupos.get(chave);
    g.jogos.push({ vitoria: l.vitoria ? 1 : 0, mortes10: l.mortes10, solo10: l.solo10, gank10: l.gank10 });
    for (const m of ['10', '15']) if (!nulo(l[`ouro${m}`])) g.d[m].push({ ouro: l[`ouro${m}`], xp: l[`xp${m}`], farm: l[`farm${m}`] });
  }
  const out = [];
  for (const g of grupos.values()) {
    const n = g.jogos.length;
    const v = g.jogos.reduce((s, j) => s + j.vitoria, 0);
    const ok = n >= MIN_MATCHUP;
    const item = { campeao: g.campeao, papel: g.papel, adversario: g.adversario, n, vitorias: v, winrate: ok ? 100 * v / n : null, conclusao: ok };
    for (const m of ['10', '15']) {
      const ds = g.d[m];
      item[`n${m}`] = ds.length;
      for (const k of ['ouro', 'xp', 'farm']) item[`${k}${m}`] = ok ? media(ds.map(d => d[k])) : null;
    }
    for (const k of ['mortes10', 'solo10', 'gank10']) item[k] = ok ? media(g.jogos.map(j => j[k])) : null;
    out.push(item);
  }
  out.sort((a, b) => (b.n - a.n) || (b.vitorias - a.vitorias) || (a.campeao - b.campeao) || cmp(a.papel, b.papel) || (a.adversario - b.adversario));
  return { matchups: out, partidas: ps.length, fora };
}

// analise.traumas(c, campeao, min_partidas, antes_de): lift de derrota com cada campeão no time inimigo, encolhido com K_TRAUMA
export function traumas(linhas, { campeao = null, minPartidas = 3, antesDe = null } = {}) {
  const jogos = (linhas || []).filter(l => contaLinha(l) && (nulo(campeao) || l.campeao === campeao) && (nulo(antesDe) || l.criacao < antesDe));
  const nTotal = jogos.length;
  if (!nTotal) return { partidas: 0, derrotas: 0, taxa_derrota: null, campeoes: [], traumas: [] };
  const dTotal = jogos.filter(l => !l.vitoria).length;
  const taxa = dTotal / nTotal;
  const por = new Map();
  for (const l of jogos) {
    for (const cid of new Set(Array.isArray(l.inimigos) ? l.inimigos : [])) {
      const s = por.get(cid) || [0, 0];
      s[0] += 1;
      s[1] += l.vitoria ? 0 : 1;
      por.set(cid, s);
    }
  }
  const out = [];
  for (const [cid, [n, d]] of por) {
    const item = { campeao: cid, n, vitorias: n - d, derrotas: d, taxa_derrota: d / n,
      lift_bruto: taxa ? (d / n) / taxa : null,
      lift: taxa ? ((d + K_TRAUMA * taxa) / (n + K_TRAUMA)) / taxa : null };
    item.trauma = !!(n >= minPartidas && item.lift !== null && item.lift >= LIFT_TRAUMA);
    out.push(item);
  }
  out.sort((a, b) => ((b.lift || 0) - (a.lift || 0)) || (b.n - a.n) || (a.campeao - b.campeao));
  return { partidas: nTotal, derrotas: dTotal, taxa_derrota: taxa, k: K_TRAUMA, limiar: LIFT_TRAUMA, min_partidas: minPartidas,
    campeoes: out, traumas: out.filter(x => x.trauma) };
}

// hora local da partida (coach.faixa usa datetime.fromtimestamp: a mesma hora local do PC)
const horaLocal = ms => new Date(ms).getHours();

// contagens do historico_tilt: [vitórias, partidas] no geral, por faixa horária e depois de k derrotas seguidas (0..3+)
function contarTilt(linhas, gameId, criacao) {
  const ps = porCriacao((linhas || []).filter(l => contaLinha(l) && l.criacao < criacao && l.gameId !== gameId));
  const geral = [0, 0], faixas = {}, apos = {};
  let seq = 0, ant = null;
  for (const p of ps) {
    if (!ant || p.criacao - (ant.criacao + ant.duracao * 1000) >= SESSAO_GAP_MS) seq = 0;
    const v = p.vitoria ? 1 : 0;
    const fx = faixa(horaLocal(p.criacao)), k = String(Math.min(seq, 3));
    for (const b of [geral, faixas[fx] ||= [0, 0], apos[k] ||= [0, 0]]) { b[0] += v; b[1] += 1; }
    seq = v ? 0 : seq + 1;
    ant = p;
  }
  return { geral, faixas, apos };
}
const wr = (v, n) => (n ? 100 * v / n : null);   // coach._wr
const bloco = b => ({ n: b[1], wr: wr(b[0], b[1]) });
const ordenado = (o, sem = null) => Object.fromEntries(Object.keys(o).filter(k => k !== sem).sort().map(k => [k, bloco(o[k])]));

// coach.historico_tilt(historico, game_id, criacao): winrate geral, por faixa de horário e depois de 1, 2 e 3+ derrotas
// seguidas, só das partidas anteriores à analisada (sequência zera numa pausa >= 2 h)
export function historicoTilt(linhas, gameId, criacao) {
  const { geral, faixas, apos } = contarTilt(linhas, gameId, criacao);
  return { geral: bloco(geral), faixas: ordenado(faixas), apos_derrotas: ordenado(apos, '0') };
}

// coach._traumas: os traumas (só os marcados) do meu campeão que estão no time inimigo desta partida, das partidas de antes
export function traumasDaPartida(linhas, campeao, inimigos, antesDe = null) {
  const ini = inimigos instanceof Set ? inimigos : new Set(inimigos || []);
  const out = [];
  for (const t of traumas(linhas, { campeao, antesDe }).traumas) {
    if (!ini.has(t.campeao) || t.lift === null || t.n < MIN_MATCHUP || t.trauma === false) continue;
    out.push({ campeao: t.campeao, n: t.n, lift: t.lift, vitorias: t.vitorias, derrotas: t.derrotas });
  }
  return out;
}

// coach.contexto_partida: {matchup, traumas, historico} da partida `alvo` (linha do acumulador como objeto). Matchup = grupo
// (meu campeão, papel, adversário) com todas as linhas (inclui a própria partida); traumas e histórico só as anteriores
export function contextoPartida(linhas, alvo) {
  let mu = null;
  if (!nulo(alvo?.adversario) && !alvo.incerto && alvo.papel) {
    const g = matchups(linhas, alvo.campeao).matchups.find(x => x.papel === alvo.papel && x.adversario === alvo.adversario);
    if (g) mu = { n: g.n, vitorias: g.vitorias, winrate: g.winrate, ouro10: g.ouro10, xp10: g.xp10, farm10: g.farm10, mortes10: g.mortes10 };
  }
  return { matchup: mu, traumas: traumasDaPartida(linhas, alvo?.campeao, alvo?.inimigos, alvo?.criacao),
    historico: historicoTilt(linhas, alvo?.gameId, alvo?.criacao) };
}

// selo da seleção sem o complemento: o mesmo formato do GET /draft/<meu campeão> (coach_vivo._rota_draft) para o
// champselect.js e o lateral-coach.js. Sem a rota provável do draft (Fase 6, fora): o adversário de rota é o inimigo travado que
// já foi adversário de rota deste campeão nesta posição (grupo do matchups com papel = posição); com mais de um, o de maior n.
// local: true marca a fonte (o texto da rota diz "pelo seu histórico"). posicao: TOP/JUNGLE/... ('' = sem matchup)
export function seloLocal(linhas, meu, posicao, inimigos) {
  const ini = [...(inimigos instanceof Set ? inimigos : new Set(inimigos || []))].sort((a, b) => a - b);
  const mus = matchups(linhas, meu).matchups;
  const pos = posicao ? String(posicao).toUpperCase() : '';
  let adv = null;
  if (pos) for (const id of ini) {
    const g = mus.find(x => x.papel === pos && x.adversario === id);
    if (g && (!adv || g.n > adv.n)) adv = { campeao: id, n: g.n };
  }
  const set = new Set(ini);
  return { local: true, draft: adv ? { inimigos: [{ campeao: adv.campeao, rota: pos }] } : null, matchups: mus,
    traumas: traumas(linhas, { campeao: meu }).campeoes.filter(t => set.has(t.campeao)) };
}

// medição dos freios (fila rápida e "jogar de novo"; Fase 5 passo 3: era a MEDICAO fixa de freios.js): winrate da partida
// seguinte depois de exatamente 2 derrotas seguidas na sessão, de madrugada (faixa 00-06) e de dia (06-12 + 12-18), mais o geral,
// sobre todas as linhas do acumulador. null abaixo de PISO_MEDICAO partidas; cada número null com menos de PISO_FAIXA partidas
// na própria faixa. Os textos arredondam; quem compara (cai/não cai) usa o arredondado.
export function medicaoDe(linhas, { piso = PISO_MEDICAO, pisoFaixa = PISO_FAIXA } = {}) {
  const { geral, faixas, apos } = contarTilt(linhas, null, Infinity);
  if (geral[1] < piso) return null;
  const soma = ks => ks.reduce((b, k) => [b[0] + (faixas[k]?.[0] || 0), b[1] + (faixas[k]?.[1] || 0)], [0, 0]);
  const num = b => (b && b[1] >= pisoFaixa ? Math.round(wr(b[0], b[1])) : null);
  const dia = soma(['06-12', '12-18']), mad = faixas['00-06'], d2 = apos['2'];
  return { partidas: geral[1], wrGeral: Math.round(wr(geral[0], geral[1])), wrDepoisDe2: num(d2), nDepoisDe2: d2?.[1] || 0,
    wrMadrugada: num(mad), nMadrugada: mad?.[1] || 0, wrDia: num(dia), nDia: dia[1] };
}
