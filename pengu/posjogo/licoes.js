// Motor de lições do pós-jogo (plano v2, passo 6). Regras: ./licoes.md (dono; o coletor/coach.py lê o mesmo
// arquivo); métricas: docs/INSIGHTS.md § Métricas das lições. Mudou aqui, muda no coach.py (prova:
// tools/teste-licoes.mjs e .py, mesma saída). Módulo puro: o texto das regras chega por parâmetro (o
// index.js importa com `?raw`), nada de window/document, para rodar no node. CEF 108: sem toSorted/groupBy.
import { FORA_DAS_CONTAS } from './analise.js';

export const N_LICOES = 3;
const SESSAO_GAP_MS = 2 * 3600 * 1000; // pausa >= 2 h abre sessão nova (mesma regra do tilt no MCP)
const MS_10 = 600000, MS_15 = 900000, REMAKE_S = 300;
const FORMATOS = ['', 'abs', 'int', 'pct', 'mmss'];

// ---------- regras (licoes.md) ----------

export function lerRegras(texto) {
  const regras = [];
  let atual = null, dentro = false;
  for (const linha of texto.split(/\r?\n/)) {
    if (linha.startsWith('## ')) { dentro = linha.slice(3).trim().toLowerCase().startsWith('regras'); atual = null; continue; }
    if (!dentro) continue;
    let m = linha.match(/^###\s+(\S+)\s*$/);
    if (m) { atual = { id: m[1] }; regras.push(atual); continue; }
    m = atual && linha.match(/^-\s+([a-z_]+):\s*(.*?)\s*$/);
    if (m) {
      let v = m[2];
      if (m[1] === 'quando' && v.length >= 2 && v[0] === '`' && v[v.length - 1] === '`') v = v.slice(1, -1).trim();
      atual[m[1]] = v;
    }
  }
  for (const r of regras) {
    if (r.uso === undefined) r.uso = 'posjogo';
    if (r.grupo === undefined) r.grupo = null;
    r.prioridade = /^-?\d+$/.test(String(r.prioridade ?? '').trim()) ? parseInt(r.prioridade, 10) : null;
  }
  return regras;
}

// ---------- expressão do `quando` ----------

const COMP = ['==', '!=', '>=', '<=', '>', '<'];

function tokens(expr) {
  const re = /\s*(?:(\d+(?:\.\d+)?)|(não|[A-Za-z_][A-Za-z0-9_]*)|(>=|<=|==|!=|[<>()+\-*/]))/y;
  const out = [];
  let i = 0;
  while (i < expr.length) {
    if (expr.slice(i).trim() === '') break;
    re.lastIndex = i;
    const m = re.exec(expr);
    if (!m || re.lastIndex === i) throw new Error(`caractere inesperado em ${expr}, posição ${i}`);
    out.push(m[1] !== undefined ? ['num', parseFloat(m[1])] : m[2] !== undefined ? ['nome', m[2]] : ['op', m[3]]);
    i = re.lastIndex;
  }
  return out;
}

export function compilar(expr) {
  const toks = tokens(expr);
  let pos = 0;
  const ver = () => toks[pos] || [null, null];
  const eh = (t, v) => ver()[0] === t && ver()[1] === v;
  const comer = (tipo, valor) => {
    const t = ver();
    if (t[0] === null || (tipo && t[0] !== tipo) || (valor && t[1] !== valor)) throw new Error(`esperava ${valor || tipo} em ${expr}, veio ${t[1]}`);
    pos++;
    return t;
  };
  const ou = () => { let a = e(); while (eh('nome', 'ou')) { comer(); a = ['bin', 'ou', a, e()]; } return a; };
  const e = () => { let a = nao(); while (eh('nome', 'e')) { comer(); a = ['bin', 'e', a, nao()]; } return a; };
  const nao = () => { if (eh('nome', 'não') || eh('nome', 'nao')) { comer(); return ['un', 'não', nao()]; } return comp(); };
  const comp = () => {
    let a = soma();
    if (ver()[0] === 'op' && COMP.includes(ver()[1])) {
      const op = comer()[1];
      a = ['bin', op, a, soma()];
      if (ver()[0] === 'op' && COMP.includes(ver()[1])) throw new Error(`comparação encadeada em ${expr}`);
    }
    return a;
  };
  const soma = () => { let a = prod(); while (ver()[0] === 'op' && '+-'.includes(ver()[1])) { const op = comer()[1]; a = ['bin', op, a, prod()]; } return a; };
  const prod = () => { let a = un(); while (ver()[0] === 'op' && '*/'.includes(ver()[1])) { const op = comer()[1]; a = ['bin', op, a, un()]; } return a; };
  const un = () => { if (eh('op', '-')) { comer(); return ['un', '-', un()]; } return prim(); };
  const prim = () => {
    const t = ver();
    if (t[0] === 'num') { comer(); return ['num', t[1]]; }
    if (eh('op', '(')) { comer(); const a = ou(); comer('op', ')'); return a; }
    if (t[0] === 'nome' && !['e', 'ou', 'não', 'nao'].includes(t[1])) {
      comer();
      if (t[1] === 'existe') { comer('op', '('); const nome = comer('nome')[1]; comer('op', ')'); return ['existe', nome]; }
      return ['var', t[1]];
    }
    throw new Error(`termo inesperado em ${expr}: ${t[1]}`);
  };
  const arv = ou();
  if (pos !== toks.length) throw new Error(`sobrou ${ver()[1]} em ${expr}`);
  return arv;
}

const vazio = v => v === null || v === undefined;
function num(v) {
  if (vazio(v)) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return v;
  throw new Error(`valor não numérico na expressão: ${v}`);
}
const logico = v => (vazio(v) ? null : typeof v === 'boolean' ? v : num(v) !== 0);

// true / false / null (lógica de três valores; spec no cabeçalho do licoes.md)
export function avaliarExpr(arv, m) {
  const k = arv[0];
  if (k === 'num') return arv[1];
  if (k === 'var') { if (!(arv[1] in m)) throw new Error(`métrica desconhecida: ${arv[1]}`); return vazio(m[arv[1]]) ? null : m[arv[1]]; }
  if (k === 'existe') return !vazio(m[arv[1]]);
  if (k === 'un') {
    const a = avaliarExpr(arv[2], m);
    if (arv[1] === '-') { const x = num(a); return x === null ? null : -x; }
    const l = logico(a);
    return l === null ? null : !l;
  }
  const op = arv[1];
  let a = avaliarExpr(arv[2], m), b = avaliarExpr(arv[3], m);
  if (op === 'e') { a = logico(a); b = logico(b); if (a === false || b === false) return false; return a === null || b === null ? null : true; }
  if (op === 'ou') { a = logico(a); b = logico(b); if (a === true || b === true) return true; return a === null || b === null ? null : false; }
  a = num(a); b = num(b);
  if (a === null || b === null) return null;
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? null : a / b;
    case '==': return a === b;
    case '!=': return a !== b;
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '>': return a > b;
    default: return a < b;
  }
}

// ---------- texto ----------

export const arred = (v, casas = 0) => { const f = 10 ** casas; return Math.floor(v * f + 0.5) / f; };

// placeholder → texto; igual ao formatar() do coach.py
export function formatar(v, fmt = '') {
  if (typeof v === 'string') return v;
  v = num(v);
  const sinal = fmt.startsWith('+');
  const base = sinal ? fmt.slice(1) : fmt;
  if (!FORMATOS.includes(base)) throw new Error(`formato desconhecido: ${fmt}`);
  if (base === 'mmss') { // sobre o valor absoluto: % de negativo difere entre Python e JS
    const s = Math.floor(Math.abs(v) / 1000);
    return `${v < 0 && s > 0 ? '−' : ''}${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }
  if (base === 'abs') v = Math.abs(v);
  if (base === 'int' || base === 'pct') v = arred(v, 0);
  const inteiro = Number.isInteger(v);
  const r = inteiro ? v : arred(v, 1);
  const corpo = inteiro ? String(Math.abs(r)) : Math.abs(r).toFixed(1).replace('.', ',');
  const pre = r < 0 ? '−' : sinal && r > 0 ? '+' : '';
  return pre + corpo + (base === 'pct' ? '%' : '');
}

const RE_PH = /\{([a-z0-9_]+)(?::([+a-z]+))?\}/g;
export const placeholders = texto => [...String(texto || '').matchAll(RE_PH)].map(m => [m[1], m[2] || '']);

// texto preenchido; null se algum placeholder está sem valor
export function renderizar(texto, m) {
  if (placeholders(texto).some(([nome]) => vazio(m[nome]))) return null;
  return texto.replace(RE_PH, (_, nome, fmt) => formatar(m[nome], fmt || ''));
}

// ---------- escolha ----------

// as n lições: [{id, tipo, prioridade, texto}] (regra de escolha no licoes.md); regra quebrada não dispara
export function escolher(regras, m, n = N_LICOES, uso = 'posjogo') {
  const disparou = [];
  regras.forEach((r, i) => {
    if ((r.uso || 'posjogo') !== uso || r.prioridade === null || r.prioridade === undefined) return;
    try {
      if (avaliarExpr(compilar(r.quando), m) !== true) return;
      const texto = renderizar(r.texto, m);
      if (texto !== null) disparou.push({ r, i, texto });
    } catch { /* regra quebrada: o validar-licoes.py acusa */ }
  });
  const ordem = (a, b) => (b.r.prioridade - a.r.prioridade) || (a.i - b.i);
  disparou.sort(ordem);
  const grupos = new Set(), unicas = [];
  for (const d of disparou) {
    if (d.r.grupo) { if (grupos.has(d.r.grupo)) continue; grupos.add(d.r.grupo); }
    unicas.push(d);
  }
  let escolhidas = unicas.slice(0, n);
  if (n > 0 && !escolhidas.some(d => d.r.tipo === 'positiva')) {
    const pos = unicas.slice(n).find(d => d.r.tipo === 'positiva');
    if (pos) escolhidas = [...escolhidas.slice(0, n - 1), pos].sort(ordem);
  }
  return escolhidas.map(d => ({ id: d.r.id, tipo: d.r.tipo, prioridade: d.r.prioridade, texto: d.texto }));
}

// ---------- métricas ----------

export const faixa = h => (h < 6 ? '00-06' : h < 12 ? '06-12' : h < 18 ? '12-18' : '18-24');

// histórico da LCU (current-summoner/matches: participants[0] é o próprio) → formato da sessao()
export const historicoDaLcu = games => games.map(g => ({
  gameId: g.gameId, criacao: g.gameCreation, duracao: g.gameDuration, fila: g.queueId, mapa: g.mapId,
  vitoria: g.participants?.[0]?.stats?.win ? 1 : 0,
}));

const valida = (p, id, criacao) => p.mapa === 11 && !FORA_DAS_CONTAS.includes(p.fila) && p.duracao >= REMAKE_S
  && p.criacao < criacao && p.gameId !== id;

// posição da partida na sessão e sequência antes dela (mesma regra do coach.sessao)
export function sessao(historico, gameId, criacao) {
  const ps = historico.filter(p => valida(p, gameId, criacao)).sort((a, b) => a.criacao - b.criacao);
  let corrente = [], ant = null;
  for (const p of ps) {
    if (!ant || p.criacao - (ant.criacao + ant.duracao * 1000) >= SESSAO_GAP_MS) corrente = [];
    corrente.push(p);
    ant = p;
  }
  if (!ant || criacao - (ant.criacao + ant.duracao * 1000) >= SESSAO_GAP_MS) corrente = [];
  let derrotas = 0, vitorias = 0;
  for (let i = corrente.length - 1; i >= 0 && !corrente[i].vitoria; i--) derrotas++;
  for (let i = corrente.length - 1; i >= 0 && corrente[i].vitoria; i--) vitorias++;
  const h = new Date(criacao).getHours();
  return { partida: corrente.length + 1, derrotas_antes: derrotas, vitorias_antes: vitorias, hora: h, faixa: faixa(h) };
}

// métrica -> valor (null = sem dado). r = analisar() do analise.js (tem vitoria e duracaoS); ses = sessao();
// contexto = o do coletor (GET /contexto/<gameId>; null = sem); nomes = {id: nome}
export function montarMetricas(r, ses, contexto, nomes) {
  const ctx = contexto || {}, nm = nomes || {};
  const nome = cid => (vazio(cid) ? null : nm[String(cid)] ?? `campeão ${cid}`);
  const adv = r.adversario || null;
  const mortes = r.mortes;
  const d10 = r.diffs['10'] || null, d15 = r.diffs['15'] || null;
  const objs = new Set();
  for (const mo of mortes) for (const o of mo.objetivos) objs.add(JSON.stringify([o.tipo, o.detalhe, o.rota, o.ms]));
  const conta = f => mortes.filter(f).length;
  const f = r.farm;
  const m = {
    vitoria: r.vitoria ? 1 : 0, duracao_min: r.duracaoS / 60,
    campeao_nome: nome(r.campeao), adversario_nome: adv ? nome(adv.campeao) : null,
    adversario_incerto: adv ? (adv.incerto ? 1 : 0) : null,
    ouro10: d10 && d10.ouro, xp10: d10 && d10.xp, farm10: d10 && d10.farm,
    ouro15: d15 && d15.ouro, xp15: d15 && d15.xp, farm15: d15 && d15.farm,
    mortes: mortes.length, mortes10: conta(mo => mo.ms < MS_10), mortes15: conta(mo => mo.ms < MS_15),
    primeira_morte: mortes.length ? mortes[0].ms : null,
    mortes_1x1_adversario: adv ? conta(mo => mo.matador === adv.participantId && mo.inimigos === 1) : null,
    mortes_sozinho_inimigo: conta(mo => mo.lado === 'inimigo' && !mo.aliadosPerto.length),
    mortes_desvantagem: conta(mo => mo.inimigos > mo.aliadosPerto.length + 1),
    mortes_objetivo: conta(mo => mo.objetivos.length > 0), objetivos_pos_morte: objs.size,
    farm_min: f.valor, farm_media: f.media, farm_n: f.n, farm_dif: f.diferenca,
    sessao_partida: ses.partida, derrotas_antes: ses.derrotas_antes, vitorias_antes: ses.vitorias_antes,
    hora: ses.hora, faixa: ses.faixa,
  };
  const mu = adv && !adv.incerto ? ctx.matchup || null : null;
  m.matchup_n = mu ? mu.n : null;
  m.matchup_v = mu ? mu.vitorias : null;
  m.matchup_d = mu ? mu.n - mu.vitorias : null;
  m.matchup_wr = mu ? mu.winrate ?? null : null;
  m.matchup_ouro10 = mu ? mu.ouro10 ?? null : null;
  const tr = [...(ctx.traumas || [])].sort((a, b) => (b.lift - a.lift) || (a.campeao - b.campeao));
  const t = tr[0] || null;
  m.trauma_nome = t ? nome(t.campeao) : null;
  m.trauma_lift = t ? t.lift : null;
  m.trauma_n = t ? t.n : null;
  m.trauma_v = t ? t.vitorias : null;
  m.trauma_d = t ? t.derrotas : null;
  const hist = ctx.historico || {};
  m.geral_wr = hist.geral?.wr ?? null;
  const fx = hist.faixas?.[ses.faixa] || {};
  m.faixa_wr = fx.wr ?? null;
  m.faixa_n = fx.n ?? null;
  const k = Math.min(ses.derrotas_antes, 3);
  const ad = k ? hist.apos_derrotas?.[String(k)] || {} : {};
  m.apos_derrotas_wr = ad.wr ?? null;
  m.apos_derrotas_n = ad.n ?? null;
  for (const c of Object.keys(m)) if (m[c] === undefined) m[c] = null;
  return m;
}

// atalho do pós-jogo: regras (texto do licoes.md) + análise + histórico da LCU + contexto do coletor
export function licoes(textoRegras, r, historicoLcu, gameCreation, contexto, nomes, n = N_LICOES) {
  const ses = sessao(historicoDaLcu(historicoLcu || []), r.gameId, gameCreation);
  const m = montarMetricas(r, ses, contexto, nomes);
  return { licoes: escolher(lerRegras(textoRegras), m, n), metricas: m };
}
