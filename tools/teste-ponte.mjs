// Prova da ponte do plugin com o complemento coach (pengu/coach.js; roadmap/2026-10-17-plugin-pengu-primeiro.md, Fase 1).
// Nada aqui fala com o client nem com a 8765 de verdade: fetch espião (LCU falsa de tools/lcu-falsa.mjs + complemento falso),
// relógio falso (timers globais trocados), DataStore em memória.
//   (a) coletor.ligado false (instalação nova): zero fetch à 8765 em 30 min simulados passando por todas as fases, com o
//       plugin inteiro de pé (pengu/index.js init: compacto, seleção, partida, pós-jogo, aceite);
//   (b) ligado e porta fechada: recuo 30 s -> 2 min -> 5 min medido (chamadas por instante e por fase);
//   (c) porta respondendo 200 sem app (outro programa): ausente, nenhuma outra rota chamada;
//   (d) /ola com recursos parciais (coach + draft): o plugin inteiro de pé chama só /ola, /config e /draft;
//   (e) complemento que sobe no meio do recuo de 5 min e Lobby -> Matchmaking -> ReadyCheck: aperto de mão antes do
//       ReadyCheck e o "não aceitar" chega (POST /aceite/plugin);
//   (f) a sessão do aceite vale o último aperto de mão bom: outro programa na porta, complemento sem a reserva ou ponte
//       desligada e religada = zero POST /aceite/plugin; porta fechada (complemento reiniciando) mantém a sessão.
// uso: node tools/teste-ponte.mjs
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relatar, lcuFalsa } from './lcu-falsa.mjs';

// o Pengu serve "*.md?raw" como texto e o CSS pelo import: no node, um hook faz o mesmo (como em teste-replay.mjs)
registerHooks({
  resolve(spec, ctx, next) { return spec.endsWith('?raw') || spec.endsWith('.css') ? { url: new URL(spec, ctx.parentURL).href, shortCircuit: true } : next(spec, ctx); },
  load(url, ctx, next) {
    if (url.endsWith('.css')) return { format: 'module', source: 'export default "";', shortCircuit: true };
    if (!url.endsWith('?raw')) return next(url, ctx);
    return { format: 'module', source: `export default ${JSON.stringify(readFileSync(fileURLToPath(url.split('?')[0]), 'utf8'))};`, shortCircuit: true };
  },
});

const coach = await import('../pengu/coach.js');
const { criarPonte, URL_COLETOR, APP, RECUO_MS, CHAVE_PONTE } = coach;

const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);
const imediato = setImmediate;
const flush = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise(r => imediato(r)); };

// ---------- relógio falso injetável (parte 1) ----------
function relogio(inicio = 1_000_000) {
  const r = { agora: inicio, fila: new Map(), prox: 1 };
  r.agendar = (fn, ms = 0) => { const id = r.prox++; r.fila.set(id, { em: r.agora + Math.max(0, Number(ms) || 0), fn }); return id; };
  r.cancelar = id => { r.fila.delete(id); };
  r.avancar = async ms => {
    const fim = r.agora + ms;
    for (;;) {
      let alvo = null;
      for (const [id, t] of r.fila) if (t.em <= fim && (!alvo || t.em < alvo[1].em)) alvo = [id, t];
      if (!alvo) break;
      r.agora = alvo[1].em; r.fila.delete(alvo[0]);
      alvo[1].fn();
      await flush(3);
    }
    r.agora = fim;
    await flush(3);
  };
  return r;
}

// complemento falso: no = porta atende; app = o que o /ola diz; recursos anunciados; chamadas gravadas com o instante
// (no, app, recursos e semApp mudam no meio do caso: o complemento cai, volta sem um recurso, outro programa pega a porta)
function complemento(rel, { no = true, app = APP, recursos = ['coach', 'draft'], semApp = false } = {}) {
  const s = { no, app, recursos, semApp, chamadas: [] };
  s.fetch = async (url, op = {}) => {
    if (!String(url).startsWith(URL_COLETOR)) throw new Error('fetch fora da 8765 na parte 1: ' + url);
    const caminho = String(url).slice(URL_COLETOR.length);
    s.chamadas.push({ caminho, metodo: op.method || 'GET', corpo: op.body ? JSON.parse(op.body) : undefined, em: rel.agora });
    if (!s.no) throw new TypeError('Failed to fetch');
    const corpo = caminho === '/ola' ? (s.semApp ? { ok: true } : { app: s.app, versao: 1, recursos: s.recursos }) : { ok: true };
    return { status: 200, json: async () => corpo };
  };
  return s;
}
const ds = () => { const m = new Map(); return { get: k => (m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : null), set: (k, v) => m.set(k, JSON.parse(JSON.stringify(v))), m }; };

// ---------- (b) ligado e porta fechada: recuo ----------
{
  const rel = relogio(0);
  const srv = complemento(rel, { no: false });
  const cfg = { coletor: { ligado: true }, coach: { voz: true }, aceite: { ligado: true, atrasoS: 10, limiteS: 12 } };
  const p = criarPonte({ cfg, f: srv.fetch, agendar: rel.agendar, cancelar: rel.cancelar, agora: () => rel.agora, ds: ds(), log: () => {} });
  p.iniciar();
  await flush(4);   // a porta fechada recusa na hora (o prazo de 3 s do /ola não chega a correr)
  await rel.avancar(30 * 60000);
  const tempos = srv.chamadas.map(c => c.em / 1000);
  caso('(b) porta fechada, 30 min sem fase: /ola na carga e depois a 30 s, 2 min e 5 min (recuo), só /ola',
    JSON.stringify(tempos) === JSON.stringify([0, 30, 150, 450, 750, 1050, 1350, 1650]) && srv.chamadas.every(c => c.caminho === '/ola'), JSON.stringify(tempos));
  caso('(b) RECUO_MS = 30 s, 2 min, 5 min', JSON.stringify(RECUO_MS) === JSON.stringify([30000, 120000, 300000]));
  const r0 = await p.coletor('/draft/58', { prazoMs: 4000 });
  const n0 = srv.chamadas.length;
  caso('(b) sem aperto de mão, coletor() devolve status 0 na hora, sem fetch', r0.status === 0 && n0 === 8 && !p.temRecurso('draft'));
  // fases: as da fila tentam na hora, fora do recuo; None/Lobby/EndOfGame também na virada; a mesma fase repetida não
  const porFase = {};
  for (const [fase, ms] of [['Lobby', 20000], ['Matchmaking', 40000], ['ReadyCheck', 8000], ['ChampSelect', 90000], ['InProgress', 600000],
    ['EndOfGame', 60000], ['EndOfGame', 1000], ['Lobby', 10000]]) {
    const antes = srv.chamadas.length, t0 = rel.agora;
    p.aoFase(fase);
    await flush(4);
    const naHora = srv.chamadas.slice(antes).filter(c => c.em === t0).length;
    await rel.avancar(ms);
    (porFase[fase] ||= []).push({ naHora, total: srv.chamadas.length - antes });
  }
  caso('(b) Matchmaking e ReadyCheck tentam na hora (fora do recuo); ChampSelect e InProgress não', porFase.Matchmaking[0].naHora === 1 && porFase.ReadyCheck[0].naHora === 1
    && porFase.ChampSelect[0].naHora === 0 && porFase.InProgress[0].naHora === 0, JSON.stringify(porFase));
  caso('(b) None/Lobby/EndOfGame tentam na virada; EndOfGame repetido não tenta de novo', porFase.Lobby.every(x => x.naHora === 1)
    && porFase.EndOfGame[0].naHora === 1 && porFase.EndOfGame[1].naHora === 0, JSON.stringify(porFase));
  caso('(b) InProgress de 10 min com a porta fechada: 2 tentativas (recuo de 5 min), nenhuma outra rota', porFase.InProgress[0].total === 2
    && srv.chamadas.every(c => c.caminho === '/ola'), JSON.stringify(porFase.InProgress));
  const e = p.estado();
  caso('(b) estado: ligado, procurando, próxima tentativa marcada, erro "fora do ar"', e.ligado && e.procurando && !e.visto && e.proximaEm > rel.agora && e.erro === 'fora do ar', JSON.stringify(e));
}

// ---------- (c) 200 sem app = outro programa ----------
{
  const rel = relogio(0);
  const srv = complemento(rel, { semApp: true });
  const cfg = { coletor: { ligado: true }, coach: {}, aceite: {} };
  const p = criarPonte({ cfg, f: srv.fetch, agendar: rel.agendar, cancelar: rel.cancelar, agora: () => rel.agora, ds: ds(), log: () => {} });
  p.iniciar();
  await rel.avancar(1000);
  const r1 = await p.coletor('/draft/58'), r2 = await p.coletor('/estado'), r3 = await p.coletor('/aceite/plugin', { metodo: 'POST', corpo: {}, evento: true });
  p.sincronizar({ ...cfg, coach: { voz: false } });
  await rel.avancar(5 * 60000);
  caso('(c) porta respondendo 200 sem app: ausente, nenhuma rota além do /ola (nem config, nem evento do aceite)',
    !p.estado().visto && [r1, r2, r3].every(r => r.status === 0) && srv.chamadas.length > 0 && srv.chamadas.every(c => c.caminho === '/ola')
    && p.estado().erro === 'outro programa na porta', JSON.stringify(srv.chamadas.map(c => c.caminho)));
  const rel2 = relogio(0);
  const srv2 = complemento(rel2, { app: 'outro-programa' });
  const p2 = criarPonte({ cfg, f: srv2.fetch, agendar: rel2.agendar, cancelar: rel2.cancelar, agora: () => rel2.agora, ds: ds(), log: () => {} });
  p2.iniciar();
  await rel2.avancar(1000);
  caso('(c) app diferente de "lol-client-coletor": ausente', !p2.estado().visto && (await p2.coletor('/draft/1')).status === 0 && srv2.chamadas.length === 1);
}

// ---------- (d) unidade: recursos parciais, config uma vez por aperto de mão, lol-client.ponte ----------
{
  const rel = relogio(0);
  const srv = complemento(rel, { recursos: ['coach', 'draft'] });
  const cfg = { coletor: { ligado: true }, coach: { voz: true }, aceite: { ligado: true, atrasoS: 8, limiteS: 12 } };
  const mem = ds();
  const p = criarPonte({ cfg, f: srv.fetch, agendar: rel.agendar, cancelar: rel.cancelar, agora: () => rel.agora, ds: mem, log: () => {} });
  p.iniciar();
  await flush(4);
  await rel.avancar(1000);
  const cfgs = srv.chamadas.filter(c => c.caminho === '/config');
  caso('(d) aperto de mão bom com "coach": config mandada uma vez (POST /config com o espelho do atraso)', cfgs.length === 1 && cfgs[0].metodo === 'POST'
    && cfgs[0].corpo?.coach?.aceiteAtrasoS === 8, JSON.stringify(srv.chamadas.map(c => c.caminho)));
  caso('(d) temRecurso só do anunciado; mostraRecurso igual; lol-client.ponte gravado', p.temRecurso('draft') && p.temRecurso('coach') && !p.temRecurso('estado-partida')
    && !p.temRecurso('mentor') && JSON.stringify(mem.get(CHAVE_PONTE)?.recursos) === JSON.stringify(['coach', 'draft']));
  p.aoFase('Lobby');
  await flush(4);
  await rel.avancar(1000);
  caso('(d) novo aperto de mão bom (virada para Lobby) manda a config de novo, uma vez', srv.chamadas.filter(c => c.caminho === '/config').length === 2,
    JSON.stringify(srv.chamadas.map(c => [c.caminho, c.em])));
  await rel.avancar(30 * 60000);
  caso('(d) sem o laço de 30 s: complemento visto, 30 min sem mudança = nenhuma chamada a mais', srv.chamadas.length === 4, JSON.stringify(srv.chamadas.map(c => c.caminho)));
  // complemento cai: a próxima chamada vê "fora do ar", a ponte volta a procurar e os blocos usam o último aperto de mão bom
  srv.no = false;
  const r = await p.coletor('/draft/58');
  caso('(d) complemento caiu: chamada volta 0, ponte procurando, temRecurso false, mostraRecurso pelo lol-client.ponte',
    r.status === 0 && p.estado().procurando && !p.temRecurso('draft') && p.mostraRecurso('draft') && !p.mostraRecurso('mentor'));
  caso('(d) destino das expansões: guardar com o aperto de mão pendente; descartar com o complemento visto sem o recurso',
    p.destino('expansoes') === 'descartar', p.destino('expansoes'));
  const rel3 = relogio(0);
  const p3 = criarPonte({ cfg: { coletor: { ligado: true } }, f: complemento(rel3, { no: false }).fetch, agendar: rel3.agendar, cancelar: rel3.cancelar, agora: () => rel3.agora, ds: ds(), log: () => {} });
  p3.iniciar(); await rel3.avancar(100);
  const p4 = criarPonte({ cfg: { coletor: { ligado: false } }, ds: ds(), log: () => {} });
  caso('(d) destino: pendente = guardar; chave desligada = descartar', p3.destino('expansoes') === 'guardar' && p4.destino('expansoes') === 'descartar');
  // desligar a ponte: para tudo na hora
  cfg.coletor.ligado = false;
  srv.no = true;
  const n = srv.chamadas.length;
  p.sincronizar(cfg);
  await rel.avancar(30 * 60000);
  caso('(d) chave desligada: nada mais sai, nem o recuo', srv.chamadas.length === n && !p.estado().procurando && (await p.coletor('/draft/1')).status === 0);
}

// ---------- (e) complemento sobe no meio do recuo de 5 min; fila; "não aceitar" chega ----------
{
  const rel = relogio(0);
  const srv = complemento(rel, { no: false, recursos: ['coach', 'aceite-reserva', 'aceite-flutuante'] });
  globalThis.DataStore = undefined;
  const cfg = { coletor: { ligado: true }, coach: {}, aceite: { ligado: true, atrasoS: 10, limiteS: 12 } };
  const indice = await import('../pengu/index.js');
  coach.iniciarPonte(cfg, { f: srv.fetch, agendar: rel.agendar, cancelar: rel.cancelar, agora: () => rel.agora, ds: ds(), log: () => {} });
  coach.aoFasePonte('None');
  await rel.avancar(400000);   // carga 0 s, 30 s, 150 s (falharam); próxima só aos 450 + 300 = 750 s
  coach.aoFasePonte('Lobby'); await flush(4);   // 400 s: ainda fora
  await rel.avancar(100000);   // 500 s: entre duas tentativas de 5 min
  srv.no = true;               // o complemento sobe aqui (gatilho do Windows atrasado, vigia)
  await rel.avancar(20000);
  const antes = await indice.avisarAceite('/aceite/plugin', { metodo: 'POST', corpo: { evento: 'evento' }, prazoMs: 1500 });
  const tAntes = srv.chamadas.filter(c => c.caminho === '/aceite/plugin').length;
  coach.aoFasePonte('Matchmaking'); await flush(6);
  const tMatch = rel.agora;
  await rel.avancar(40000);
  const tRc = rel.agora;
  coach.aoFasePonte('ReadyCheck'); await flush(6);
  const okOla = srv.chamadas.filter(c => c.caminho === '/ola' && srv.no);
  const primeiroBom = srv.chamadas.find(c => c.caminho === '/ola' && c.em >= 520000);
  const r = await indice.avisarAceite('/aceite/plugin', { metodo: 'POST', corpo: { evento: 'nao-aceitar', desligadoNestaVez: true }, prazoMs: 1500 });
  const posts = srv.chamadas.filter(c => c.caminho === '/aceite/plugin');
  caso('(e) antes de achar o complemento, o aviso do aceite não sai (status 0, sem fetch)', antes.status === 0 && tAntes === 0);
  caso('(e) complemento que subiu no meio do recuo de 5 min: aperto de mão na entrada em Matchmaking, antes do ReadyCheck',
    primeiroBom && primeiroBom.em === tMatch && tMatch < tRc && coach.temRecurso('aceite-reserva'), JSON.stringify({ primeiroBom, tMatch, tRc, n: okOla.length }));
  caso('(e) o "não aceitar" chega ao complemento (POST /aceite/plugin com desligadoNestaVez)', r.status === 200 && posts.length === 1
    && posts[0].metodo === 'POST' && posts[0].corpo?.desligadoNestaVez === true, JSON.stringify(posts));
  // no meio de um recuo (o complemento caiu e voltou), o evento do aceite segue indo: é por evento, não sondagem
  srv.no = false;
  await coach.coletor('/config', { metodo: 'POST', corpo: {} });
  srv.no = true;
  const r2 = await indice.avisarAceite('/aceite/plugin', { metodo: 'POST', corpo: { evento: 'nao-aceitar', desligadoNestaVez: true } });
  caso('(e) "não aceitar" durante o recuo (complemento visto nesta sessão) vai na hora', coach.estadoPonte().procurando && r2.status === 200
    && srv.chamadas.filter(c => c.caminho === '/aceite/plugin').length === 2);
  coach.iniciarPonte({ coletor: { ligado: false } }, { ds: ds(), log: () => {} });   // devolve a ponte desligada para a parte 2
}

// ---------- (f) a sessão vale o último aperto de mão bom (revisão adversarial de 19/10) ----------
// antes: a sessão só crescia, e o "não aceitar"/diagnóstico por evento ia a outro programa na porta, a um complemento que
// voltou sem a reserva, ou saía depois de desligar e religar a ponte antes de qualquer aperto de mão novo
{
  const indice = await import('../pengu/index.js');
  const aceitePosts = srv => srv.chamadas.filter(c => c.caminho === '/aceite/plugin').length;
  const montar = recursos => {
    const rel = relogio(0);
    const srv = complemento(rel, { recursos });
    const cfg = { coletor: { ligado: true }, coach: {}, aceite: { ligado: true, atrasoS: 10, limiteS: 12 } };
    coach.iniciarPonte(cfg, { f: srv.fetch, agendar: rel.agendar, cancelar: rel.cancelar, agora: () => rel.agora, ds: ds(), log: () => {} });
    return { rel, srv, cfg };
  };
  const ready = async rel => { for (const fase of ['Lobby', 'Matchmaking', 'ReadyCheck']) { coach.aoFasePonte(fase); await flush(6); } await rel.avancar(1000); };
  const aviso = () => indice.avisarAceite('/aceite/plugin', { metodo: 'POST', corpo: { evento: 'nao-aceitar', desligadoNestaVez: true }, prazoMs: 1500 });

  // (f1) aperto de mão bom, depois outro programa pega a porta (200 sem app)
  {
    const { rel, srv } = montar(['coach', 'aceite-reserva']);
    await rel.avancar(1000);
    const r0 = await aviso();
    srv.semApp = true;
    await ready(rel);
    const n = aceitePosts(srv);
    const r1 = await aviso(), r2 = await aviso();
    caso('(f1) aperto de mão bom e depois outro programa na porta: zero POST /aceite/plugin no ReadyCheck',
      r0.status === 200 && n === 1 && [r1, r2].every(r => r.status === 0) && aceitePosts(srv) === 1 && !coach.naSessao('aceite-reserva')
      && coach.estadoPonte().erro === 'outro programa na porta', JSON.stringify({ r0: r0.status, n, depois: aceitePosts(srv), sessao: coach.estadoPonte().sessao }));
  }
  // (f2) o complemento volta sem a reserva (porta ocupada ou erro no _sinal_aceite tira /aceite/ do /ola)
  {
    const { rel, srv } = montar(['coach', 'aceite-reserva']);
    await rel.avancar(1000);
    srv.recursos = ['coach'];
    await ready(rel);
    const r = await aviso();
    caso('(f2) aperto de mão bom sem aceite-reserva: a sessão é a do último aperto de mão, nenhum POST /aceite/plugin',
      coach.estadoPonte().visto && r.status === 0 && aceitePosts(srv) === 0 && JSON.stringify(coach.estadoPonte().sessao) === JSON.stringify(['coach']),
      JSON.stringify({ r: r.status, n: aceitePosts(srv), sessao: coach.estadoPonte().sessao }));
  }
  // (f3) desligar e religar a ponte com a porta fechada: nada por evento antes de um aperto de mão bom novo
  {
    const { rel, srv, cfg } = montar(['coach', 'aceite-reserva']);
    await rel.avancar(1000);
    cfg.coletor.ligado = false; coach.sincronizarConfig(cfg); await flush(4);
    const desligado = await aviso();
    srv.no = false;
    cfg.coletor.ligado = true; coach.sincronizarConfig(cfg); await flush(6);
    const religado = await aviso();
    caso('(f3) ponte desligada e religada sem aperto de mão bom: o "não aceitar" não sai (nem com a chave desligada)',
      desligado.status === 0 && religado.status === 0 && aceitePosts(srv) === 0 && coach.estadoPonte().procurando,
      JSON.stringify({ desligado: desligado.status, religado: religado.status, n: aceitePosts(srv) }));
  }
  // (f4) o que fica: porta fechada (status 0) mantém a sessão, e o "não aceitar" segue indo quando ela volta
  {
    const { rel, srv } = montar(['coach', 'aceite-reserva']);
    await rel.avancar(1000);
    srv.no = false;
    await coach.coletor('/config', { metodo: 'POST', corpo: {} });
    srv.no = true;
    const r = await aviso();
    caso('(f4) complemento reiniciando (porta fechada, status 0): sessão mantida, o "não aceitar" vai',
      coach.estadoPonte().procurando && coach.naSessao('aceite-reserva') && r.status === 200 && aceitePosts(srv) === 1);
  }
  coach.iniciarPonte({ coletor: { ligado: false } }, { ds: ds(), log: () => {} });   // devolve a ponte desligada para a parte 2
}

// ---------- parte 2: o plugin inteiro (pengu/index.js init) com relógio global falso ----------
// DOM mínimo (o de tools/teste-compacto.mjs, com innerHTML como texto: o pós-jogo grande monta sem parse)
class Classes {
  constructor() { this.s = new Set(); }
  add(...c) { for (const x of c) this.s.add(x); }
  remove(...c) { for (const x of c) this.s.delete(x); }
  contains(c) { return this.s.has(c); }
  toggle(c, f) { const q = f === undefined ? !this.s.has(c) : !!f; if (q) this.s.add(c); else this.s.delete(c); return q; }
  toString() { return [...this.s].join(' '); }
}
class Texto { constructor(t) { this.nodeType = 3; this.data = String(t); this.parentNode = null; } get textContent() { return this.data; } remove() { if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; } }
class El {
  constructor(tag, doc) {
    this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.doc = doc; this.parentNode = null; this.childNodes = [];
    this.classList = new Classes(); this.dataset = {}; this.attrs = new Map(); this.ouvintes = {}; this.id = ''; this.innerHTML = '';
    const est = {}; est.setProperty = (k, v) => { est[k] = v; }; est.removeProperty = k => { delete est[k]; }; this.style = est;
    this.offsetWidth = 0; this.offsetHeight = 0; this.offsetLeft = 0; this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 0;
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { if (k === 'id') this.id = String(v); else if (k === 'class') this.className = v; else this.attrs.set(k, String(v)); }
  getAttribute(k) { return k === 'id' ? this.id : this.attrs.get(k) ?? null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }
  get disabled() { return this.attrs.has('disabled'); }
  set disabled(v) { if (v) this.attrs.set('disabled', ''); else this.attrs.delete('disabled'); }
  get title() { return this.attrs.get('title') ?? ''; }
  set title(v) { this.attrs.set('title', String(v)); }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get ownerDocument() { return this.doc; }
  append(...ns) { for (let n of ns) { if (n === null || n === undefined) continue; if (typeof n !== 'object') n = new Texto(n); if (n.parentNode) n.remove(); n.parentNode = this; this.childNodes.push(n); } }
  prepend(...ns) { const velhos = this.childNodes; this.childNodes = []; this.append(...ns); this.childNodes.push(...velhos); }
  appendChild(n) { this.append(n); return n; }
  insertBefore(n, ref) { if (n.parentNode) n.remove(); n.parentNode = this; const i = this.childNodes.indexOf(ref); this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n); return n; }
  replaceWith(n) { if (!this.parentNode) return; const p = this.parentNode, i = p.childNodes.indexOf(this); this.parentNode = null; if (n) { if (n.parentNode) n.remove(); n.parentNode = p; p.childNodes.splice(i, 1, n); } else p.childNodes.splice(i, 1); }
  remove() { if (this.parentNode) { const l = this.parentNode.childNodes; l.splice(l.indexOf(this), 1); } this.parentNode = null; }
  replaceChildren(...ns) { for (const n of [...this.childNodes]) n.parentNode = null; this.childNodes = []; this.append(...ns); }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this.replaceChildren(new Texto(v)); }
  get isConnected() { let p = this; while (p.parentNode) p = p.parentNode; return p === this.doc.documentElement; }
  addEventListener(ev, fn) { (this.ouvintes[ev] ||= []).push(fn); }
  removeEventListener(ev, fn) { this.ouvintes[ev] = (this.ouvintes[ev] || []).filter(f => f !== fn); }
  dispatchEvent() { return true; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; }
  getClientRects() { return []; }
  focus() {} blur() {} scrollIntoView() {}
  closest() { return null; }
  contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  matches(sel) {
    const m = String(sel).trim().match(/^([a-z0-9-]*)((?:\.[\w-]+)*)(#[\w-]+)?((?:\[[^\]]+\])*)$/i);
    if (!m) return false;   // seletor composto: o DOM falso não acha (a tela trata null)
    if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
    for (const c of m[2].split('.').filter(Boolean)) if (!this.classList.contains(c)) return false;
    if (m[3] && this.id !== m[3].slice(1)) return false;
    for (const a of m[4].match(/\[[^\]]+\]/g) || []) {
      const mm = a.match(/^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/);
      if (!mm) return false;
      const [, k, v] = mm;
      const dk = k.startsWith('data-') ? k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase()) : null;
      const valor = dk ? this.dataset[dk] : this.getAttribute(k);
      if (v === undefined ? valor === undefined || valor === null : String(valor) !== v) return false;
    }
    return true;
  }
  *desc() { for (const n of this.children) { yield n; yield* n.desc(); } }
  querySelector(sel) { for (const n of this.desc()) if (n.matches(sel)) return n; return null; }
  querySelectorAll(sel) { return [...this.desc()].filter(n => n.matches(sel)); }
}
function novoDoc() {
  const doc = { ouvintes: {}, visibilityState: 'visible', hidden: false };
  doc.createElement = tag => new El(tag, doc);
  doc.createElementNS = (_, tag) => new El(tag, doc);
  doc.createTextNode = t => new Texto(t);
  doc.documentElement = new El('html', doc);
  doc.head = new El('head', doc); doc.body = new El('body', doc);
  doc.documentElement.append(doc.head, doc.body);
  doc.getElementById = id => { for (const n of doc.documentElement.desc()) if (n.id === id) return n; return null; };
  doc.querySelector = sel => doc.documentElement.querySelector(sel);
  doc.querySelectorAll = sel => doc.documentElement.querySelectorAll(sel);
  doc.addEventListener = (ev, fn) => { (doc.ouvintes[ev] ||= []).push(fn); };
  doc.removeEventListener = () => {};
  doc.hasFocus = () => true;
  return doc;
}

// relógio global falso: setTimeout/setInterval/Date.now trocados; avancar(ms) roda os timers em ordem
const T = { agora: Date.UTC(2026, 9, 19, 18, 0, 0), fila: new Map(), prox: 1, rodados: 0 };
const errosTimer = [];
function instalarRelogio() {
  T.fila.clear();   // cada montagem do plugin começa sem os timers da anterior (o mesmo processo monta duas vezes)
  Date.now = () => T.agora;
  globalThis.setTimeout = (fn, ms = 0, ...a) => { const id = T.prox++; T.fila.set(id, { em: T.agora + Math.max(0, Number(ms) || 0), fn: () => fn(...a) }); return id; };
  globalThis.setInterval = (fn, ms = 0, ...a) => { const id = T.prox++; const cada = Math.max(1, Number(ms) || 1); T.fila.set(id, { em: T.agora + cada, fn: () => fn(...a), cada }); return id; };
  globalThis.clearTimeout = globalThis.clearInterval = id => { T.fila.delete(id); };
  globalThis.requestAnimationFrame = fn => globalThis.setTimeout(() => fn(T.agora), 16);
  globalThis.cancelAnimationFrame = id => globalThis.clearTimeout(id);
}
async function avancar(ms) {
  const fim = T.agora + ms;
  for (;;) {
    let alvo = null;
    for (const [id, t] of T.fila) if (t.em <= fim && (!alvo || t.em < alvo[1].em || (t.em === alvo[1].em && id < alvo[0]))) alvo = [id, t];
    if (!alvo) break;
    const [id, t] = alvo;
    T.agora = t.em;
    if (t.cada) t.em += t.cada; else T.fila.delete(id);
    T.rodados++;
    try { t.fn(); } catch (e) { errosTimer.push(String(e?.stack || e).slice(0, 300)); }
    await flush(2);
  }
  T.agora = fim;
  await flush(3);
}

const ler = n => JSON.parse(readFileSync(fileURLToPath(new URL(`../tests/fixtures/${n}`, import.meta.url)), 'utf8'));
const GID = 3292712362;
const SUMMONER = ler('summoner.json');
// sessão da seleção mínima (só ids de campeão): eu na selva com Zac travado, inimigo com Renekton
const SELECAO = { localPlayerCellId: 2, isSpectating: false, myTeam: [{ cellId: 2, championId: 154, championPickIntent: 0, assignedPosition: 'jungle' }],
  theirTeam: [{ cellId: 7, championId: 58 }], actions: [[{ id: 1, type: 'pick', actorCellId: 2, championId: 154, completed: true, isInProgress: false }]],
  timer: { phase: 'BAN_PICK', adjustedTimeLeftInPhase: 20000 }, bans: { myTeamBans: [], theirTeamBans: [] } };
const HIST = ler('historico.json');
const PARTIDA = ler(`game-${GID}.json`), TIMELINE = ler(`timeline-${GID}.json`);

// o plugin inteiro de pé com o complemento falso `srv` e a config salva `salvo`; roteiro de 30 min passando por todas as fases
async function plugin({ salvo = null, srv }) {
  instalarRelogio();
  const inicio = T.agora;
  const doc = novoDoc();
  globalThis.document = doc;
  const est = { fase: 'None', rc: null };
  const sessao = () => ({ phase: est.fase, map: { id: 11 }, gameData: { gameId: ['None', 'Lobby', 'Matchmaking'].includes(est.fase) ? 0 : GID,
    queue: { id: 420, mapId: 11, type: 'RANKED_SOLO_5x5', gameMode: 'CLASSIC' }, playerChampionSelections: [], teamOne: [], teamTwo: [] } });
  const lf = lcuFalsa({
    'GET /lol-gameflow/v1/gameflow-phase': () => est.fase,
    'GET /lol-gameflow/v1/session': () => sessao(),
    'GET /lol-summoner/v1/current-summoner': SUMMONER,
    'GET /lol-matchmaking/v1/ready-check': () => est.rc ?? { status: 404, json: { message: 'not attached' } },
    'GET /lol-champ-select/v1/session': () => (est.fase === 'ChampSelect' ? SELECAO : { status: 404, json: null }),
    [`GET /lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=199`]: HIST,
    [`GET /lol-match-history/v1/games/${GID}`]: PARTIDA,
    [`GET /lol-match-history/v1/game-timelines/${GID}`]: TIMELINE,
    'GET /lol-chat/v1/conversations': [],
    'GET /lol-chat/v1/friends': [],
    'GET /lol-lobby/v2/lobby': () => (est.fase === 'Lobby' ? { gameConfig: { queueId: 420, mapId: 11 }, localMember: { isLeader: true, firstPositionPreference: 'TOP', secondPositionPreference: 'JUNGLE' }, members: [{}], canStartActivity: true, restrictions: [], invitations: [] } : { status: 404, json: null }),
  });
  const a8765 = [];
  globalThis.fetch = async (url, op = {}) => {
    const u = String(url);
    if (u.includes('127.0.0.1:8765')) {
      a8765.push({ caminho: u.slice(URL_COLETOR.length), metodo: op.method || 'GET', fase: est.fase, em: T.agora });
      return srv(u.slice(URL_COLETOR.length), op);
    }
    return lf.fetch(u, op);
  };
  const pedidosRiot = [];
  globalThis.window = { innerWidth: 1280, innerHeight: 720, screenX: 0, screenY: 0, devicePixelRatio: 1,
    riotInvoke: a => { pedidosRiot.push(a); try { const p = JSON.parse(a.request); if (p.name === 'Window.ResizeTo') window.innerWidth = p.params[0]; } catch { /* outro */ } },
    addEventListener: () => {}, removeEventListener: () => {}, fetch: globalThis.fetch, XMLHttpRequest: class { open() {} send() {} setRequestHeader() {} addEventListener() {} },
    getComputedStyle: () => ({ getPropertyValue: () => '' }) };
  globalThis.getComputedStyle = window.getComputedStyle;
  globalThis.Toast = { success() {}, error() {} };
  globalThis.CommandBar = { addAction() {} };
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  const dsMem = new Map(salvo ? [['lol-client.config', salvo]] : []);
  globalThis.DataStore = { get: k => (dsMem.has(k) ? JSON.parse(JSON.stringify(dsMem.get(k))) : undefined), set: (k, v) => { dsMem.set(k, JSON.parse(JSON.stringify(v))); }, has: k => dsMem.has(k), remove: k => dsMem.delete(k) };
  const obs = new Map();
  const context = { socket: { observe: (uri, cb) => { (obs.get(uri) || obs.set(uri, []).get(uri)).push(cb); } },
    rcp: { postInit() {}, whenReady: () => new Promise(() => {}) } };
  const emitir = (uri, data, eventType = 'Update') => { for (const cb of obs.get(uri) || []) try { cb({ uri, data, eventType }); } catch (e) { errosTimer.push(String(e).slice(0, 200)); } };
  const errosInit = [];
  const erroOriginal = console.error, logOriginal = console.log;
  console.error = (...a) => { errosInit.push(a.map(String).join(' ').slice(0, 200)); };
  console.log = () => {};
  try {
    const { init } = await import('../pengu/index.js');
    init(context);
    await avancar(2000);
    const fase = async (f, ms) => { est.fase = f; emitir('/lol-gameflow/v1/gameflow-phase', f); emitir('/lol-gameflow/v1/session', sessao()); await avancar(ms); };
    // roteiro de 30 min: None, Lobby, fila, ready check (eventos do socket), seleção (sessão real), partida, pós-jogo, lobby
    await fase('None', 60000);
    await fase('Lobby', 180000);
    await fase('Matchmaking', 120000);
    est.fase = 'ReadyCheck'; emitir('/lol-gameflow/v1/gameflow-phase', 'ReadyCheck');
    for (let t = 0; t <= 6; t++) { est.rc = { state: 'InProgress', playerResponse: 'None', timer: t }; emitir('/lol-matchmaking/v1/ready-check', est.rc); await avancar(1000); }
    est.rc = { state: 'InProgress', playerResponse: 'Accepted', timer: 7 }; emitir('/lol-matchmaking/v1/ready-check', est.rc); await avancar(5000);
    est.rc = null;
    est.fase = 'ChampSelect'; emitir('/lol-gameflow/v1/gameflow-phase', 'ChampSelect'); emitir('/lol-gameflow/v1/session', sessao());
    for (let i = 0; i < 18; i++) { emitir('/lol-champ-select/v1/session', SELECAO); await avancar(10000); }
    await fase('GameStart', 2000);
    await fase('InProgress', 17 * 60000);
    await fase('WaitingForStats', 5000);
    await fase('EndOfGame', 20000);
    try { window.__lolClient?.abrirPainel?.(GID); } catch (e) { errosInit.push('abrirPainel: ' + e); }
    await avancar(150000);
    await fase('Lobby', 60000);
    const total = (T.agora - inicio) / 60000;
    // Configurações (as mesmas da ⚙ do compacto): títulos dos blocos e todo o texto, com o estado da ponte no fim do roteiro
    const { montarPainel } = await import('../pengu/configuracoes.js');
    const painel = doc.createElement('div');
    montarPainel(painel, { cfg: window.__lolClient.cfg, definir: () => {} });
    const titulos = painel.querySelectorAll('.lol-settings-general-section-title').map(n => n.textContent);
    const ids = painel.querySelectorAll('input').map(n => n.getAttribute('name'));
    return { a8765, errosInit, total, lc: window.__lolClient, dsMem, pedidosRiot, lf, config: { titulos, ids, texto: painel.textContent } };
  } finally {
    console.error = erroOriginal; console.log = logOriginal;
  }
}

// ---------- (a) instalação nova (nada salvo): coletor.ligado false ----------
{
  let respostas = 0;
  const r = await plugin({ srv: async () => { respostas++; return { status: 200, json: async () => ({ app: APP, versao: 1, recursos: ['coach'] }) }; } });
  const modulos = r.errosInit.filter(e => /^\[lol-client\] (config|ponte|aceite|champ select|pós-jogo|compacto|configurações|blocos)\b/.test(e));
  caso('(a) o plugin inteiro subiu (compacto, seleção, pós-jogo, aceite) sem erro de módulo', !!r.lc?.compacto && !!r.lc?.winrate && !!r.lc?.posjogo && modulos.length === 0,
    JSON.stringify(modulos.slice(0, 5)));
  caso(`(a) instalação nova: coletor.ligado false e zero fetch à 8765 em ${Math.round(r.total)} min por todas as fases`,
    r.lc?.cfg?.coletor?.ligado === false && r.a8765.length === 0 && respostas === 0 && r.total >= 30, JSON.stringify(r.a8765.slice(0, 5)));
  caso('(a) o roteiro passou pelas telas (a LCU falsa foi lida na seleção, na partida e no pós-jogo)',
    r.lf.chamadas.some(c => c.url.includes('/lol-champ-select/v1/session') || c.url.includes('champ-select')) && r.lf.chamadas.some(c => c.url.includes(`/games/${GID}`)),
    JSON.stringify([...new Set(r.lf.chamadas.map(c => c.url.split('?')[0]))].slice(0, 30)));
  caso('(a) instalação nova não grava lol-client.ponte', !r.dsMem.has(CHAVE_PONTE));
  const t = r.config.titulos;
  caso('(a) Configurações sem o complemento: "Complemento coach" e "Coach ao vivo"; nenhum bloco do coach', t.includes('Complemento coach') && t.includes('Coach ao vivo')
    && !['Painel ao vivo (2ª tela)', 'Voz', 'Alertas na tela', 'Minimapa e jungler', 'Mentor', 'Tela de carregamento', 'Traumas'].some(x => t.includes(x)), JSON.stringify(t));
  caso('(a) Configurações sem o complemento: sem a janelinha fora do client nem a chave do chat em janelas; com a chave da ponte',
    !r.config.ids.includes('coach.aceiteFlutuante') && !r.config.ids.includes('compacto.chatLateral') && r.config.ids.includes('coletor.ligado'), JSON.stringify(r.config.ids));
  caso('(a) Configurações sem o complemento: nenhum texto com "coletor", "8765" ou "MCP"', !/coletor|8765|\bMCP\b/i.test(r.config.texto), r.config.texto.match(/.{0,60}(coletor|8765|MCP).{0,60}/i)?.[0]);
}

// ---------- (d) config do Gabriel (v3 salva) com o complemento anunciando só coach + draft ----------
{
  const r = await plugin({ salvo: { versao: 3, coach: { voz: true } },
    srv: async (caminho, op) => ({ status: 200, json: async () => (caminho === '/ola' ? { app: APP, versao: 1, recursos: ['coach', 'draft'] } : { ok: true }) }) });
  const rotas = [...new Set(r.a8765.map(c => c.caminho.replace(/\/\d+$/, '/<id>')))].sort();
  const permitidas = ['/config', '/draft/<id>', '/ola'];
  caso('(d) config v3 salva vira coletor.ligado true (migração 4)', r.lc?.cfg?.coletor?.ligado === true && r.dsMem.get('lol-client.config')?.versao === 4);
  caso('(d) recursos parciais (coach, draft): o plugin inteiro chama só /ola, /config e /draft/<id>', rotas.every(x => permitidas.includes(x)) && rotas.includes('/draft/<id>')
    && rotas.includes('/config') && rotas.includes('/ola'), JSON.stringify(rotas));
  const porFase = {};
  for (const c of r.a8765) { const k = `${c.fase} ${c.metodo} ${c.caminho.replace(/\/\d+$/, '/<id>')}`; porFase[k] = (porFase[k] || 0) + 1; }
  caso('(d) /draft só na seleção; /ola nas viradas (carga, None, Lobby, Matchmaking, ReadyCheck, EndOfGame)',
    r.a8765.filter(c => c.caminho.startsWith('/draft')).every(c => c.fase === 'ChampSelect')
    && ['None', 'Lobby', 'Matchmaking', 'ReadyCheck', 'EndOfGame'].every(f => r.a8765.some(c => c.caminho === '/ola' && c.fase === f)), JSON.stringify(porFase));
  console.log(`(d) chamadas à 8765 em ${Math.round(r.total)} min, por fase e rota: ${JSON.stringify(porFase)}`);
  caso('(d) nenhum POST /aceite/plugin, /chat/plugin nem /compacto/expansoes sem o recurso', !r.a8765.some(c => /^\/(aceite|chat|compacto)\//.test(c.caminho)));
  caso('(d) lol-client.ponte gravado com os recursos do aperto de mão', JSON.stringify(r.dsMem.get(CHAVE_PONTE)?.recursos) === JSON.stringify(['coach', 'draft']));
  const t = r.config.titulos;
  caso('(d) Configurações com coach + draft: "Traumas" aparece (fonte: draft); Voz, Painel, Mentor e "Coach ao vivo" não',
    t.includes('Complemento coach') && t.includes('Traumas') && !t.includes('Coach ao vivo') && !t.includes('Voz') && !t.includes('Painel ao vivo (2ª tela)') && !t.includes('Mentor'),
    JSON.stringify(t));
  caso('(d) estado da ponte nas Configurações: "Complemento coach encontrado (versão 1)"', /Complemento coach encontrado \(versão 1\)/.test(r.config.texto), r.config.texto.slice(0, 300));
}

relatar(casos);
