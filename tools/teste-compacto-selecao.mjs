// Testa a tela 3 do client compacto (pengu/compacto/tela-champselect.js) sem o client: DOM mínimo feito aqui (cópia do
// de tools/teste-compacto.mjs, que não exporta o dele), LCU falsa e a sessão REAL gravada em
// tests/fixtures/champselect-real.json (normal draft, 61 eventos, duas seleções com localPlayerCellId 5 e depois 4).
// Prova do passo 5 do plano roadmap/2026-10-13-client-compacto.md: inimigo só com pick completo, bans só depois da
// revelação, nenhum nome, nenhuma escrita sem clique, cada clique = a rota certa (trade = champion-swaps), pedido de
// troca recusado/desistido/morto na virada visível, erro = client normal. Seção 7b: a ranqueada real de 14/10/2026
// (tests/fixtures/selecao-ranqueada-20261014.json) com os 3 defeitos relatados (grade de ban vazia, intenção em 2
// cliques, TRAVAR pelo POST .../complete que a LCU trava como campeão 0). uso: node tools/teste-compacto-selecao.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relatar, lcuFalsa } from './lcu-falsa.mjs';
import * as tela from '../pengu/compacto/tela-champselect.js';
import { lerSessao, rotuloFase, estadoTroca, acompanharPedidos, novaMemoria, listaGrade, skinsDoCampeao, skinMarcada, trocarFeitico,
  TROCAS, RESULTADO_MS } from '../pengu/compacto/tela-champselect.js';
import { lcu as lcuComum, _zerarCatalogo } from '../pengu/compacto/comum.js';
import { criarRoteador, TELAS } from '../pengu/compacto/index.js';
import { criarJanela, invocadorRiot, criarCamada } from '../pengu/compacto/modo.js';

// ---------- DOM mínimo (igual ao de teste-compacto.mjs + value/focus/scrollTop) ----------
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
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.doc = doc; this.parentNode = null; this.childNodes = [];
    this.classList = new Classes(); this.dataset = {}; this.attrs = new Map(); this.ouvintes = {}; this.id = '';
    const est = {}; est.setProperty = (k, v) => { est[k] = v; }; this.style = est;
    this.value = ''; this.scrollTop = 0;
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { if (k === 'id') this.id = String(v); else if (k === 'class') this.className = v; else this.attrs.set(k, String(v)); }
  getAttribute(k) { return k === 'id' ? this.id : this.attrs.get(k) ?? null; }
  get disabled() { return this.attrs.has('disabled'); }
  get title() { return this.attrs.get('title') ?? ''; }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  append(...ns) { for (let n of ns) { if (typeof n === 'string') n = new Texto(n); if (n.parentNode) n.remove(); n.parentNode = this; this.childNodes.push(n); } }
  appendChild(n) { this.append(n); return n; }
  insertBefore(n, ref) { if (n.parentNode) n.remove(); n.parentNode = this; const i = this.childNodes.indexOf(ref); this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n); return n; }
  remove() { if (this.parentNode) { const l = this.parentNode.childNodes; l.splice(l.indexOf(this), 1); } this.parentNode = null; }
  replaceChildren(...ns) { for (const n of [...this.childNodes]) n.parentNode = null; this.childNodes = []; this.append(...ns); }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this.replaceChildren(new Texto(v)); }
  get isConnected() { let p = this; while (p.parentNode) p = p.parentNode; return p === this.doc.documentElement; }
  addEventListener(ev, fn) { (this.ouvintes[ev] ||= []).push(fn); }
  disparar(ev, extra = {}) { const e = { target: this, stopPropagation() {}, preventDefault() {}, ...extra }; for (const fn of this.ouvintes[ev] || []) fn(e); }
  click() { if (!this.disabled) this.disparar('click'); }
  focus() { this.doc.ativo = this; }
  matches(sel) {
    const m = String(sel).match(/^([a-z0-9-]*)((?:\.[\w-]+)*)(#[\w-]+)?((?:\[[^\]]+\])*)$/i);
    if (!m) throw new Error('seletor não suportado: ' + sel);
    if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
    for (const c of m[2].split('.').filter(Boolean)) if (!this.classList.contains(c)) return false;
    if (m[3] && this.id !== m[3].slice(1)) return false;
    for (const a of m[4].match(/\[[^\]]+\]/g) || []) {
      const [, k, v] = a.match(/^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/);
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
  const doc = {};
  doc.createElement = tag => new El(tag, doc);
  doc.documentElement = new El('html', doc);
  doc.head = new El('head', doc); doc.body = new El('body', doc);
  doc.documentElement.append(doc.head, doc.body);
  doc.getElementById = id => { for (const n of doc.documentElement.desc()) if (n.id === id) return n; return null; };
  doc.querySelector = sel => doc.documentElement.querySelector(sel);
  doc.addEventListener = () => {};
  return doc;
}
// todo texto e todo title da árvore (o que o Gabriel lê, inclusive no passar do mouse)
const visivel = el => [el.textContent, ...[...el.desc()].map(n => n.getAttribute('title') || '')].join(' | ');
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clonar = o => structuredClone(o);

// ---------- dados ----------
const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const fx = JSON.parse(readFileSync(RAIZ + 'tests/fixtures/champselect-real.json', 'utf8'));
const ev = fx.eventos; // índices iguais aos do gravador (sessões em 1..25 e 28..59)
const S = i => clonar(ev[i].session);
// nomes falsos de campeão (o client manda os de verdade); 60103 = variante de modo que o catálogo filtra
const NOMES = { 58: 'Renekton', 154: 'Zac', 897: "K'Sante", 157: 'Yasuo', 245: 'Ekko', 950: 'Naafiri', 145: 'Kai\'Sa', 805: 'Mel', 92: 'Riven' };
const ids = new Set([58, 154, 897]);
for (const e of ev) if (e.session) for (const a of e.session.actions.flat()) if (a.championId > 0) ids.add(a.championId);
const CATALOGO = [{ id: -1, name: 'Nenhum' }, { id: 60103, name: 'Ahri' }, ...[...ids].map(id => ({ id, name: NOMES[id] || `Camp${id}`, alias: (NOMES[id] || `Camp${id}`).replace(/\W/g, '') }))];
const TODOS = [...ids];
const PAGINAS = [
  { id: 1409260191, name: '☝️🐊', isEditable: true }, { id: 2147419287, name: 'Nova Página de Runas 9', isEditable: true },
  { id: 1540029809, name: '🤢', isEditable: true }, { id: 9, name: 'fixa', isEditable: false },
];
const CFG = {
  compacto: { ligado: true, inicioCompacto: true, favoritos: [58, 154], larg: 420, alt: 640 },
  runas: { ligado: true, regras: [{ championId: 58, posicao: '*', paginas: [1409260191, 2147419287] }, { championId: 154, posicao: '*', paginas: [1540029809] }] },
};
const SKINS = [
  { championId: 154, id: 154000, name: 'Zac', isBase: true, unlocked: true, splashPath: '/lol-game-data/assets/v1/champion-splashes/154/154000.jpg', tilePath: '/t/154000.jpg', childSkins: [] },
  { championId: 154, id: 154001, name: 'Zac Arma Especial', unlocked: false, ownership: { owned: false }, splashPath: '/s/154001.jpg', childSkins: [] },
  { championId: 154, id: 154002, name: 'Zac Piscina', unlocked: true, splashPath: '/s/154002.jpg', childSkins: [{ id: 154010 }] },
  { championId: 154, id: 154006, name: 'Zac SKT T1', unlocked: false, ownership: { owned: true }, splashPath: '/s/154006.jpg', childSkins: [] },
  { championId: 154, id: 154007, name: 'Zac Desativada', unlocked: true, disabled: true, splashPath: '/s/154007.jpg', childSkins: [] },
  { championId: 58, id: 58001, name: 'Renekton Galáctico', unlocked: true, splashPath: '/s/58001.jpg', childSkins: [] },
];

// ---------- tela montada com ctx falso (mesmo contrato do roteador: seguro/falhou = client normal) ----------
async function montarTela({ rotas = {}, cfg = CFG, servicos = {}, inicial = null } = {}) {
  const doc = novoDoc();
  const camada = doc.createElement('div'); camada.id = 'lc-compacto';
  const titulo = doc.createElement('div'), extras = doc.createElement('div'), raiz = doc.createElement('main');
  raiz.className = 'lc-cp-corpo';
  camada.append(titulo, extras, raiz); doc.body.append(camada);
  // escrita sem rota própria = 204 (como o client); GET sem rota = 404
  // GET da sessão = o estado atual do "client" (a inicial e depois o último evento emitido), como a LCU de verdade
  let ultima = inicial;
  const tabela = {
    'GET /lol-champ-select/v1/session': () => (ultima ? clonar(ultima) : { status: 404, json: { message: 'No active delegate' } }),
    'GET /lol-game-data/assets/v1/champion-summary.json': CATALOGO,
    'GET /lol-champ-select/v1/pickable-champion-ids': TODOS,
    'GET /lol-champ-select/v1/bannable-champion-ids': TODOS,
    'GET /lol-champ-select/v1/skin-carousel-skins': SKINS,
    'GET /lol-perks/v1/pages': PAGINAS,
    'GET /lol-perks/v1/currentpage': PAGINAS[2],
    ...rotas,
  };
  const f = lcuFalsa(new Proxy(tabela, { get: (o, k) => (k in o ? o[k] : typeof k === 'string' && !k.startsWith('GET ') ? { status: 204 } : undefined) }));
  globalThis.fetch = f.fetch;
  _zerarCatalogo();
  const t = { doc, raiz, titulo, extras, lcu: f, falhas: [], avisos: [], logs: [], expandiu: 0, timers: [], intervalos: [], subs: new Map(), vivo: true };
  const seguro = fn => (...a) => {
    if (!t.vivo) return undefined;
    try { const r = fn(...a); if (r && typeof r.then === 'function') r.catch(e => t.falhas.push(e)); return r; } catch (e) { t.falhas.push(e); return undefined; }
  };
  t.ctx = {
    cfg, servicos, tela: 'champselect', fase: 'ChampSelect', info: { lida: true, fila: 400, mapa: 11, custom: false },
    raiz, titulo, extras, lcu: (m, u, c) => lcuComum(m, u, c, f.fetch), vivo: () => t.vivo, seguro,
    observar: (uri, cb) => t.subs.set(uri, seguro(cb)),
    tempo: (fn, ms) => { t.timers.push({ fn: seguro(fn), ms }); return t.timers.length; },
    intervalo: (fn, ms) => { t.intervalos.push({ fn: seguro(fn), ms }); return t.intervalos.length; },
    falhou: e => t.falhas.push(e), expandir: () => { t.expandiu++; }, avisar: (m, e) => t.avisos.push([String(m), !!e]),
    dormir: () => Promise.resolve(), log: m => t.logs.push(String(m)),
  };
  t.emitir = async (s, eventType = 'Update') => { ultima = s; t.subs.get('/lol-champ-select/v1/session')?.({ eventType, data: s, uri: '/lol-champ-select/v1/session' }); await tick(); };
  t.mudarSemEvento = s => { ultima = s; }; // o client mudou e o evento não veio (socket mudo)
  t.achar = sel => raiz.querySelector(sel);
  t.todos = sel => raiz.querySelectorAll(sel);
  t.escritas = () => f.escritas().map(c => `${c.metodo} ${c.url}${c.corpo === undefined ? '' : ' ' + JSON.stringify(c.corpo)}`);
  t.rodarTimers = ms => { const v = t.timers.filter(x => x.ms <= ms); t.timers = t.timers.filter(x => x.ms > ms); v.forEach(x => x.fn()); };
  await tela.montar(raiz, t.ctx);
  await tick();
  return t;
}
const linhaDo = (t, cell) => t.achar(`div.lc-cp-sel-lin[data-cell="${cell}"]`);
const botaoTroca = (t, cell, tipo) => linhaDo(t, cell)?.querySelector(`button[data-tipo="${tipo}"]`);

const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);
const todasEscritas = [];

// ---------- 1. leitura pura da sessão real ----------
{
  const l40 = lerSessao(S(40));
  caso('leitura: localPlayerCellId 4, meu ban em andamento = banir (ação 4)', l40.me === 4 && l40.modo.tipo === 'banir' && l40.modo.acao?.id === 4, JSON.stringify(l40.modo));
  caso('leitura: time por ordem de pick, "tu" e aliado 1..4 sem nome', igual(l40.time.map(x => x.rotulo), ['aliado 1', 'aliado 2', 'aliado 3', 'aliado 4', 'tu']) && l40.eu.cellId === 4);
  const l30 = lerSessao(S(30)), l32 = lerSessao(S(32));
  caso('leitura: troca de ordem (cells 1 e 3) muda a posição do cell entre eventos', l30.time.find(x => x.cellId === 1).pos === 'TOP' && l32.time.find(x => x.cellId === 1).pos === 'UTILITY');
  caso('leitura: hover inimigo (ação em andamento) não aparece; pick completo aparece (ev 18 -> 19)',
    igual(lerSessao(S(18)).inimigos, []) && igual(lerSessao(S(19)).inimigos, [950]) && !lerSessao(S(19)).inimigos.includes(154));
  caso('leitura: ev 51 mostra 157, 147, 18 e não o 245 em andamento; ev 52 mostra o 245',
    igual(lerSessao(S(51)).inimigos, [157, 147, 18]) && lerSessao(S(52)).inimigos.includes(245));
  const l15 = lerSessao(S(15)), l17 = lerSessao(S(17));
  // 1ª seleção: eu no cell 5 (meu time 5-9); os bans 805/90/875/360 de antes da revelação são do MEU time
  const aliadosBan = new Set(ev[15].session.actions.flat().filter(a => a.type === 'ban' && a.isAllyAction).map(a => a.championId));
  const s16 = S(16); // ev 16: bans inimigos completos (777...) e o ten_bans_reveal ainda em andamento
  const l16 = lerSessao(s16);
  caso('leitura: bans inimigos escondidos antes do ten_bans_reveal (ev 15, 16) e os 10 depois (ev 17)',
    !l15.revelado && l15.banidos.length === 0 && [...l15.banidosConhecidos].every(id => aliadosBan.has(id))
    && !l16.revelado && !l16.banidosConhecidos.has(777) && l17.revelado && l17.banidos.length === 10 && l17.banidosConhecidos.has(777));
  const l44 = lerSessao(S(44)), l45 = lerSessao(S(45));
  caso('leitura: ban -1 (não baniu) fica de fora: 9 banidos, meuBan -1', !l44.revelado && l45.revelado && l45.banidos.length === 9 && l45.meuBan === -1);
  caso('leitura: modos da 2ª seleção (intenção, banir, esperar, escolher, finalizar)',
    lerSessao(S(28)).modo.tipo === 'intencao' && lerSessao(S(28)).modo.acao.id === 18 && lerSessao(S(34)).modo.tipo === 'banir'
    && lerSessao(S(45)).modo.tipo === 'esperar' && lerSessao(S(53)).modo.tipo === 'escolher' && lerSessao(S(53)).eu.hover === 154
    && lerSessao(S(54)).modo.tipo === 'finalizar' && lerSessao(S(58)).modo.tipo === 'finalizar' && lerSessao(S(59)).modo.tipo === 'finalizar');
  caso('leitura: rótulo da fase (planejamento, banimento, tua vez, finalização)',
    rotuloFase(lerSessao(S(28)))[0] === 'PLANEJAMENTO' && rotuloFase(l40)[0] === 'BANIMENTO' && rotuloFase(lerSessao(S(53)))[0] === 'ESCOLHA · TUA VEZ'
    && rotuloFase(lerSessao(S(58)))[0] === 'FINALIZAÇÃO' && rotuloFase(lerSessao(S(47)))[1].includes('aliado 2'));
  caso('leitura: sessão sem myTeam = null', lerSessao({}) === null && lerSessao(null) === null);
  const tr = S(40);
  caso('troca: AVAILABLE, INVALID com motivo, sem contrato = AUSENTE',
    estadoTroca(tr, TROCAS[0], 1).estado === 'AVAILABLE' && estadoTroca(tr, TROCAS[0], 1).id === 4
    && estadoTroca(tr, TROCAS[2], 1).estado === 'INVALID' && /travarem/.test(estadoTroca(tr, TROCAS[2], 1).motivo)
    && estadoTroca(S(58), TROCAS[1], 1).estado === 'AUSENTE');
  caso('troca: show* false do summoners/{slotId} deixa cinza', estadoTroca(tr, TROCAS[0], 1, { showPositionSwaps: false }).estado === 'ESCONDIDA');
  caso('feitiço: igual ao do outro slot troca de lugar', igual(trocarFeitico([11, 4], 0, 4), [4, 11]) && igual(trocarFeitico([11, 4], 1, 14), [11, 14]));
  const sk = skinsDoCampeao(SKINS, 154);
  caso('skins: só as que ele tem (padrão, unlocked, owned), sem desativada nem de outro campeão',
    igual(sk.map(k => k.id), [154000, 154002, 154006]) && skinMarcada(sk, 154010) === 154002);
  const cat = new Map(CATALOGO.filter(c => c.id > 0 && c.id < 10000).map(c => [c.id, { id: c.id, nome: c.name, alias: c.alias }]));
  caso('grade: favoritos na frente e busca sem acento/apóstrofo ("ksante")',
    listaGrade(cat, { favoritos: [58, 154] }).slice(0, 2).join() === '58,154' && igual(listaGrade(cat, { busca: 'ksante' }), [897]));
  const mem = novaMemoria();
  const a = S(40); a.positionSwaps.find(x => x.cellId === 1).state = 'SENT';
  acompanharPedidos(mem, a, 0);
  const b = S(58); b.positionSwaps = [];
  const r = acompanharPedidos(mem, b, 10);
  caso('pedido: SENT sem resposta que some na virada de fase = "morreu"', r.length === 1 && r[0].resultado === 'morreu' && r[0].cellId === 1);
}

// ---------- 2. sessão real inteira, sem clique ----------
{
  const t = await montarTela();
  let vazou = [], euCells = new Set(), falhas = 0;
  for (let i = 0; i < ev.length; i++) {
    if (!ev[i].session) continue;
    await t.emitir(S(i));
    // o que a tela diz sobre as pessoas (times, bans, pedido, título); a grade de busca lista todos os campeões e fica de fora
    const txt = [...t.raiz.children].filter(c => !c.classList.contains('lc-cp-sel-sel')).map(visivel).join(' | ') + visivel(t.titulo);
    // nome de campeão inimigo em hover (ação em andamento) nunca na tela; ban inimigo só depois da revelação
    const l = lerSessao(ev[i].session);
    const s = ev[i].session;
    for (const a of s.actions.flat()) {
      const inimigo = a.isAllyAction === false;
      if (inimigo && a.type === 'pick' && !a.completed && a.championId > 0 && !l.inimigos.includes(a.championId) && !l.travados.has(a.championId)
        && !l.time.some(x => x.hover === a.championId) && !l.banidos.some(b => b.id === a.championId) && txt.includes(NOMES[a.championId] || `Camp${a.championId}`))
        vazou.push(`ev ${i}: hover inimigo ${a.championId}`);
      if (inimigo && a.type === 'ban' && a.championId > 0 && !l.revelado && !l.time.some(x => x.hover === a.championId || x.travado === a.championId)
        && t.achar('div[data-a="bans"]')) vazou.push(`ev ${i}: bans antes da revelação`);
    }
    euCells.add(String(t.achar('div.lc-cp-sel-lin.lc-cp-sel-eu')?.dataset.cell));
    if (/gameName|tagLine|puuid|summonerId|#BR1/.test(txt)) vazou.push(`ev ${i}: identidade`);
  }
  falhas = t.falhas.length;
  caso('sessão real (61 eventos): nenhuma escrita sem clique', t.escritas().length === 0, t.escritas().join('; '));
  caso('sessão real: nenhum erro de tela', falhas === 0, t.falhas.map(e => e.message).join('; '));
  caso('sessão real: hover inimigo, ban antes da revelação e identidade nunca aparecem', vazou.length === 0, vazou.slice(0, 5).join('; '));
  caso('sessão real: "tu" segue o localPlayerCellId relido (5 na 1ª seleção, 4 na 2ª)', euCells.has('5') && euCells.has('4'));
  caso('sessão real: sem matchmaking, quit ou RiotClient nas leituras', !t.lcu.chamadas.some(c => /matchmaking|quit|riotclient/i.test(c.url)));
  todasEscritas.push(...t.escritas());
}

// ---------- 3. tela por fase ----------
{
  const t = await montarTela({ inicial: S(40) });
  caso('montar: lê a sessão sozinho (GET) e pinta a fase no título e o tempo no topo',
    t.titulo.textContent.startsWith('BANIMENTO') && t.extras.querySelector('span.lc-cp-sel-t')?.textContent === '16' && t.raiz.classList.contains('lc-cp-sel'));
  // protótipo (tela 3): relógio, 💬 com o contador, expandir; o contador só lê (GET /lol-chat/v1/conversations)
  const bt = t.extras.querySelector('button[data-a="chat"]');
  caso('topo: 💬 com o contador depois do relógio (protótipo da tela 3)', !!bt && t.extras.children.indexOf?.(bt) !== 0
    && t.extras.children[0]?.classList.contains('lc-cp-sel-t') && t.extras.children[1] === bt && t.subs.has('/lol-chat/v1/conversations'));
  caso('banir: botão BANIR desligado sem campeão escolhido', t.achar('button[data-a="acao"]')?.disabled && /BANIR/.test(t.achar('button[data-a="acao"]').textContent));
  t.achar('button.lc-cp-sel-gc[data-id="58"]').click(); await tick();
  // corpos iguais aos do client da Riot (rcp-fe-lol-champ-select: selectChampion e o botão de travar/banir)
  caso('banir: clique na grade = hover (PATCH da ação 4, completed false), sem travar', igual(t.escritas(), ['PATCH /lol-champ-select/v1/session/actions/4 {"completed":false,"championId":58}']), t.escritas().join('; '));
  t.rodarTimers(tela.ARMAR_MS);
  t.achar('button[data-a="acao"]').click(); await tick();
  // 14/10/2026: POST .../complete sem corpo = "lockIn championId: 0" no LeagueClient.log, 204 e nada travado
  caso('banir: BANIR = 1 PATCH {completed:true, championId} da ação 4 (nunca POST .../complete)', igual(t.escritas().slice(1), ['PATCH /lol-champ-select/v1/session/actions/4 {"completed":true,"championId":58}']), t.escritas().join('; '));
  // clique duplo: o 204 voltou e o evento da sessão ainda não; o 2º clique não manda outro ban (revisão nº 7)
  const bb = t.achar('button[data-a="acao"]');
  bb.click(); await tick();
  caso('banir: depois do 204 e antes do evento, BANIR fica "BANINDO Renekton…" cinza e o 2º clique não escreve',
    bb.disabled && /BANINDO Renekton/.test(bb.textContent) && t.escritas().length === 2, `${bb.textContent} | ${t.escritas().join('; ')}`);
  t.achar('button.lc-cp-sel-gc[data-id="154"]').click(); await tick();
  caso('banir: clique na grade com o ban saindo é ignorado (nada de {completed:false} contra a ação fechando)', t.escritas().length === 2, t.escritas().join('; '));
  caso('banir: ban de aliado já feito (51) e hover de aliado fica cinza', t.achar('button.lc-cp-sel-gc[data-id="51"]')?.disabled);
  todasEscritas.push(...t.escritas());
  tela.desmontar(t.raiz, t.ctx); t.vivo = false;
  caso('desmontar: tira a classe do corpo', !t.raiz.classList.contains('lc-cp-sel'));
}
{
  const t = await montarTela({ inicial: S(28), servicos: { champ: { partidas: () => [], estatisticas: id => ({ geral: id === 58 ? { n: 87, winrate: 48 } : { n: 0 } }) } } });
  const favs = t.todos('button.lc-cp-sel-fav');
  caso('intenção: favoritos Renekton e Zac com o winrate do histórico', favs.length === 2 && /Renekton/.test(favs[0].textContent) && /87 partidas · 48%/.test(favs[0].textContent) && /sem partidas/.test(favs[1].textContent));
  caso('intenção: sem botão de confirmar (declarar é 1 clique, pedido do Gabriel 14/10/2026)', !t.achar('button[data-a="acao"]') && /1 clique/.test(t.raiz.textContent));
  favs[1].click(); await tick();
  caso('intenção: clicar no favorito já declara (PATCH da minha ação de pick, completed false, sem travar)',
    igual(t.escritas(), ['PATCH /lol-champ-select/v1/session/actions/18 {"completed":false,"championId":154}']) && t.todos('button.lc-cp-sel-fav')[1].classList.contains('lc-cp-sel-on'), t.escritas().join('; '));
  t.todos('button.lc-cp-sel-fav')[1].click(); await tick();
  caso('intenção: clicar de novo no mesmo campeão não escreve outra vez', t.escritas().length === 1, t.escritas().join('; '));
  // a intenção (Zac) não pode virar o alvo do ban na fase seguinte
  await t.emitir(S(34));
  const ban = t.achar('button[data-a="acao"]');
  caso('ban depois da intenção: botão é só "BANIR", desligado (a escolha do PLANNING não carrega)', ban.textContent === 'BANIR' && ban.disabled, ban.textContent);
  await t.emitir(S(28));
  // busca: o campo não sai do DOM quando a sessão chega
  const campo = t.achar('input[data-a="busca"]');
  campo.value = 'zac'; campo.disparar('input'); await tick();
  const grade1 = t.todos('button.lc-cp-sel-gc').map(b => String(b.dataset.id));
  await t.emitir(S(30));
  caso('busca: "zac" filtra a grade e o campo segue o mesmo nó, ligado, depois de um evento',
    igual(grade1, ['154']) && t.achar('input[data-a="busca"]') === campo && campo.isConnected && campo.value === 'zac');
  todasEscritas.push(...t.escritas());
}
{
  // ranqueada real: intenção Zac declarada no PLANNING (championPickIntent 154) e a vez do ban chega
  const s = S(34); s.myTeam.find(c => c.cellId === 4).championPickIntent = 154;
  const t = await montarTela({ inicial: s });
  const b = t.achar('button[data-a="acao"]');
  caso('ban com intenção declarada: nunca "BANIR Zac" (o próprio pick) a um clique', b.textContent === 'BANIR' && b.disabled, b.textContent);
  b.click(); await tick();
  caso('ban com intenção declarada: clicar no botão desligado não escreve nada', t.escritas().length === 0);
}
{
  const t = await montarTela({ inicial: S(53), servicos: { champ: { partidas: () => null, estatisticas: () => ({ geral: { n: 1 } }) } } });
  caso('escolher: TRAVAR nasce cinza por ARMAR_MS (clique que ia para outro lugar não trava)', /TRAVAR Zac/.test(t.achar('button[data-a="acao"]').textContent) && t.achar('button[data-a="acao"]').disabled);
  t.rodarTimers(tela.ARMAR_MS);
  caso('escolher: TRAVAR com o hover do client (Zac)', /TRAVAR Zac/.test(t.achar('button[data-a="acao"]').textContent) && !t.achar('button[data-a="acao"]').disabled);
  caso('escolher: campeão travado por outro (895) e banido (51) cinza', t.achar('button.lc-cp-sel-gc[data-id="895"]')?.disabled && t.achar('button.lc-cp-sel-gc[data-id="51"]')?.disabled);
  caso('escolher: histórico ainda lendo vira "histórico carregando"', /histórico carregando/.test(t.achar('button.lc-cp-sel-fav').textContent));
  t.achar('button[data-a="acao"]').click(); await tick();
  caso('escolher: TRAVAR = 1 PATCH {completed:true, championId} da ação 18 (o corpo do botão da Riot)', igual(t.escritas(), ['PATCH /lol-champ-select/v1/session/actions/18 {"completed":true,"championId":154}']), t.escritas().join('; '));
  todasEscritas.push(...t.escritas());
}
{
  // erro do client ao travar: aviso, a tela segue (dá para tentar de novo)
  const t = await montarTela({ inicial: S(53), rotas: { 'PATCH /lol-champ-select/v1/session/actions/18': { status: 500, json: {} } } });
  t.rodarTimers(tela.ARMAR_MS);
  t.achar('button[data-a="acao"]').click(); await tick();
  caso('escolher: PATCH de travar com 500 vira aviso de erro, sem derrubar a tela', t.avisos.some(([m, e]) => e && /não consegui travar Zac \(500\)/.test(m)) && t.falhas.length === 0 && !t.achar('button[data-a="acao"]').disabled);
}
{
  // 204 que não trava (foi o que a LCU fez com o POST .../complete em 14/10/2026): a sessão segue com a ação aberta
  // depois do prazo -> aviso de erro com a saída (tentar de novo ou expandir); nunca tenta de novo sozinho
  const t = await montarTela({ inicial: S(53) });
  t.rodarTimers(tela.ARMAR_MS);
  t.achar('button[data-a="acao"]').click(); await tick();
  const n = t.escritas().length;
  await t.emitir(S(53));
  t.rodarTimers(tela.CONFERIR_MS); await tick();
  caso('escolher: 204 sem a ação completar em CONFERIR_MS (relida por GET) vira aviso "não travou" com ⤢, sem 2ª escrita',
    t.avisos.some(([m, e]) => e && /não travou Zac/.test(m) && /expandir/.test(m)) && t.escritas().length === n && n === 1, JSON.stringify(t.avisos));
  caso('escolher: depois do "não travou" o botão TRAVAR volta ligado (tentar de novo é clique dele)',
    !t.achar('button[data-a="acao"]').disabled && /^TRAVAR Zac$/.test(t.achar('button[data-a="acao"]').textContent), t.achar('button[data-a="acao"]').textContent);
  const t2 = await montarTela({ inicial: S(53) });
  t2.rodarTimers(tela.ARMAR_MS);
  t2.achar('button[data-a="acao"]').click(); await tick();
  await t2.emitir(S(54)); // a ação 18 completou
  t2.rodarTimers(tela.CONFERIR_MS); await tick();
  caso('escolher: travou de verdade (ação completa) = nenhum aviso de erro', !t2.avisos.some(([, e]) => e), JSON.stringify(t2.avisos));
  // socket mudo: travou no client, o evento não chegou (a tela ainda vê S(53)); a releitura por GET evita o alarme falso
  const t3 = await montarTela({ inicial: S(53) });
  t3.rodarTimers(tela.ARMAR_MS);
  t3.achar('button[data-a="acao"]').click(); await tick();
  t3.mudarSemEvento(S(54));
  t3.rodarTimers(tela.CONFERIR_MS); await tick();
  caso('escolher: travou mas o evento não veio (socket mudo) = nenhum aviso falso (confere por GET)', !t3.avisos.some(([, e]) => e), JSON.stringify(t3.avisos));
}
{
  // TRAVAR com o hover ainda em voo: o travamento espera o hover voltar (senão o hover chega depois e a ordem é incerta)
  let soltar;
  const presa = new Promise(r => { soltar = r; });
  const rotas = { 'PATCH /lol-champ-select/v1/session/actions/18': async c => { if (c?.completed === false) await presa; return { status: 204 }; } };
  const t = await montarTela({ inicial: S(53), rotas });
  t.rodarTimers(tela.ARMAR_MS);
  t.achar('button.lc-cp-sel-gc[data-id="58"]').click(); await tick();
  t.achar('button[data-a="acao"]').click(); await tick();
  const antes = t.escritas();
  caso('escolher: TRAVAR pendente (hover em voo) aparece como "TRAVANDO Renekton…" cinza (revisão nº 2)',
    /TRAVANDO Renekton/.test(t.achar('button[data-a="acao"]').textContent) && t.achar('button[data-a="acao"]').disabled, t.achar('button[data-a="acao"]').textContent);
  soltar(); await tick(12);
  caso('escolher: TRAVAR durante o hover em voo = só o hover sai; o travamento (do clique dele) sai quando o hover volta, com o campeão clicado',
    igual(antes, ['PATCH /lol-champ-select/v1/session/actions/18 {"completed":false,"championId":58}'])
    && igual(t.escritas(), [...antes, 'PATCH /lol-champ-select/v1/session/actions/18 {"completed":true,"championId":58}']), JSON.stringify({ antes, depois: t.escritas() }));
  todasEscritas.push(...t.escritas());
}
{
  // fase 'esperar' (vez de outro, minha ação de pick aberta): clique = intenção na hora, sem confirmar
  const t = await montarTela({ inicial: S(45) });
  caso('esperar: sem botão de ação (só intenção, 1 clique)', !t.achar('button[data-a="acao"]'));
  t.achar('button.lc-cp-sel-gc[data-id="154"]').click(); await tick();
  caso('esperar: clique na grade = PATCH da minha ação de pick (18) com completed false',
    igual(t.escritas(), ['PATCH /lol-champ-select/v1/session/actions/18 {"completed":false,"championId":154}']), t.escritas().join('; '));
  todasEscritas.push(...t.escritas());
}
{
  // cliques rápidos (Zac e logo Renekton): o último vence, mesmo com a 1ª escrita ainda em voo
  let soltar;
  const presa = new Promise(r => { soltar = r; });
  const t = await montarTela({ inicial: S(28), rotas: { 'PATCH /lol-champ-select/v1/session/actions/18': async () => { await presa; return { status: 204 }; } } });
  t.achar('button.lc-cp-sel-gc[data-id="154"]').click(); await tick();
  t.achar('button.lc-cp-sel-gc[data-id="58"]').click(); await tick();
  soltar(); await tick(12);
  caso('intenção: 2 cliques rápidos = 2 PATCHes na ordem, o último (Renekton) por último',
    igual(t.escritas(), ['PATCH /lol-champ-select/v1/session/actions/18 {"completed":false,"championId":154}', 'PATCH /lol-champ-select/v1/session/actions/18 {"completed":false,"championId":58}']), t.escritas().join('; '));
}

// ---------- 4. trocas ----------
{
  const t = await montarTela({ inicial: S(40) });
  caso('trocas: posição e ordem disponíveis, campeão cinza com o motivo', !botaoTroca(t, 1, 'POSICAO').disabled && !botaoTroca(t, 1, 'ORDEM').disabled
    && botaoTroca(t, 1, 'CAMPEAO').disabled && /travarem/.test(botaoTroca(t, 1, 'CAMPEAO').title));
  botaoTroca(t, 1, 'POSICAO').click(); await tick();
  caso('trocas: pedir posição = POST position-swaps/4/request', igual(t.escritas(), ['POST /lol-champ-select/v1/session/position-swaps/4/request']), t.escritas().join('; '));
  const enviado = S(40);
  enviado.positionSwaps.find(x => x.cellId === 1).state = 'SENT';
  for (const x of enviado.positionSwaps) if (x.cellId !== 1) x.state = 'BUSY';
  await t.emitir(enviado);
  caso('trocas: SENT mostra "enviado / aguardando" e cancelar; os outros BUSY ficam cinza',
    /enviado/.test(linhaDo(t, 1).textContent) && !!linhaDo(t, 1).querySelector('button[data-a="cancelar"]')
    && botaoTroca(t, 2, 'POSICAO').disabled && botaoTroca(t, 2, 'POSICAO').classList.contains('lc-cp-sel-busy'));
  linhaDo(t, 1).querySelector('button[data-a="cancelar"]').click(); await tick();
  caso('trocas: cancelar = POST position-swaps/4/cancel', t.escritas().at(-1) === 'POST /lol-champ-select/v1/session/position-swaps/4/cancel');
  const recusou = S(40); recusou.positionSwaps.find(x => x.cellId === 1).state = 'DECLINED';
  // de novo SENT -> DECLINED
  await t.emitir(enviado); await t.emitir(recusou);
  caso('trocas: DECLINED aparece na linha ("aliado 2 recusou a troca de posição")', /aliado \d recusou a troca de posição/.test(linhaDo(t, 1).textContent), linhaDo(t, 1).textContent);
  await t.emitir(S(40));
  caso('trocas: o recado fica alguns segundos mesmo com o contrato de volta a AVAILABLE', /recusou/.test(linhaDo(t, 1).textContent) && RESULTADO_MS >= 4000);
  // pedido recebido de ordem: caixa no topo com aceitar/recusar
  const recebido = S(40); recebido.pickOrderSwaps.find(x => x.cellId === 2).state = 'RECEIVED';
  await t.emitir(recebido);
  const caixa = t.achar('div.lc-cp-sel-receb');
  caso('trocas: RECEIVED abre a caixa "pedido de troca de ordem" com a ordem dos dois', !!caixa && /troca de ordem/.test(caixa.textContent) && /tu escolhe em 3º, ele em 5º/.test(caixa.textContent), caixa?.textContent);
  caixa.querySelector('button[data-a="aceitar"]').click(); await tick();
  caso('trocas: aceitar = POST pick-order-swaps/5/accept', t.escritas().at(-1) === 'POST /lol-champ-select/v1/session/pick-order-swaps/5/accept');
  t.achar('div.lc-cp-sel-receb').querySelector('button[data-a="recusar"]').click(); await tick();
  caso('trocas: recusar = POST pick-order-swaps/5/decline', t.escritas().at(-1) === 'POST /lol-champ-select/v1/session/pick-order-swaps/5/decline');
  const desistiu = S(40); desistiu.pickOrderSwaps.find(x => x.cellId === 2).state = 'CANCELLED';
  await t.emitir(desistiu);
  caso('trocas: aliado desistiu (CANCELLED) aparece na linha dele', /desistiu da troca de ordem/.test(linhaDo(t, 2).textContent), linhaDo(t, 2).textContent);
  // pedido meu que morre na virada de fase
  const meu = S(40); meu.positionSwaps.find(x => x.cellId === 0).state = 'SENT';
  await t.emitir(meu);
  const virada = S(58);
  await t.emitir(virada);
  caso('trocas: pedido sem resposta que morre na virada de fase vira aviso', t.avisos.some(([m]) => /morreu na virada de fase/.test(m)), JSON.stringify(t.avisos));
  // estado que o client não deveria mandar: cinza com o motivo, sem quebrar
  const torto = S(40); torto.positionSwaps.find(x => x.cellId === 3).state = 'QUALQUER';
  await t.emitir(torto);
  caso('trocas: estado desconhecido fica cinza com o motivo e a tela segue', botaoTroca(t, 3, 'POSICAO').disabled && /não esperado/.test(botaoTroca(t, 3, 'POSICAO').title) && t.falhas.length === 0);
  todasEscritas.push(...t.escritas());
}
{
  // troca de campeão recebida na finalização: rota champion-swaps (o campo é trades)
  const s = S(58);
  s.trades = [{ cellId: 3, id: 7, state: 'RECEIVED' }, { cellId: 0, id: 4, state: 'BUSY' }];
  const t = await montarTela({ inicial: s });
  const caixa = t.achar('div.lc-cp-sel-receb');
  caso('troca de campeão: caixa "tu fica com Camp420, ele com Zac"', !!caixa && /tu fica com Camp420, ele com Zac/.test(caixa.textContent), caixa?.textContent);
  caixa.querySelector('button[data-a="aceitar"]').click(); await tick();
  caso('troca de campeão: aceitar = POST champion-swaps/7/accept', igual(t.escritas(), ['POST /lol-champ-select/v1/session/champion-swaps/7/accept']), t.escritas().join('; '));
  todasEscritas.push(...t.escritas());
}
{
  // summoners/{slotId}: show* false deixa o botão cinza (enriquecimento [S])
  const rotas = {};
  [0, 1, 2, 3, 4].forEach(i => { rotas[`GET /lol-champ-select/v1/summoners/${i}`] = { cellId: i, isOnPlayersTeam: true, showPositionSwaps: i !== 1, showSwaps: true, showTrades: true }; });
  const t = await montarTela({ inicial: S(40), rotas });
  caso('summoners/{slotId}: showPositionSwaps false deixa só aquele botão cinza', botaoTroca(t, 1, 'POSICAO').disabled && !botaoTroca(t, 2, 'POSICAO').disabled);
}
{
  // contratos de verdade (fixture, ev 30 -> 32, troca de ordem entre os cells 1 e 3): ACCEPTED nunca aparece, a troca
  // feita REGENERA os ids (4 e 7 -> 24 e 25 em AVAILABLE) e os jogadores mudam de cell. O pedido segue por tipo + cell;
  // o fim sem estado final é julgado pelo efeito em mim (ordem: meu cell; posição: minha posição; campeão: o meu).
  const pos = (s, cell) => s.myTeam.find(c => c.cellId === cell);
  const disponiveis = pares => pares.map(([cellId, id]) => ({ cellId, id, state: 'AVAILABLE' }));
  const semAvisoRuim = t => !t.avisos.some(([m]) => /sem resposta|morreu/.test(m));
  // a) eu (cell 4, selva) peço ⇅ ordem ao cell 2 (meio, contrato 5); ele aceita: passo para o cell 2, contratos novos
  const t = await montarTela({ inicial: S(28) });
  botaoTroca(t, 2, 'ORDEM').click(); await tick();
  const pediu = t.escritas().at(-1) === 'POST /lol-champ-select/v1/session/pick-order-swaps/5/request';
  const enviado = S(28);
  for (const x of enviado.pickOrderSwaps) x.state = x.cellId === 2 ? 'SENT' : 'BUSY';
  await t.emitir(enviado);
  const aceito = S(28);
  aceito.localPlayerCellId = 2;
  pos(aceito, 2).assignedPosition = 'jungle'; pos(aceito, 4).assignedPosition = 'middle';
  aceito.pickOrderSwaps = disponiveis([[1, 24], [0, 25], [3, 26], [4, 27]]);
  await t.emitir(aceito);
  const parceiro = linhaDo(t, 4)?.textContent || '';
  caso('troca: ⇅ ordem pedida e aceita com ids regenerados (como na partida real): "troca de ordem feita" na linha do aliado, sem "sem resposta"',
    pediu && /troca de ordem feita/.test(parceiro) && semAvisoRuim(t) && String(t.achar('div.lc-cp-sel-lin.lc-cp-sel-eu')?.dataset.cell) === '2' && t.falhas.length === 0,
    JSON.stringify({ parceiro, avisos: t.avisos, falhas: t.falhas.map(e => e.message) }));
  todasEscritas.push(...t.escritas());
  // b) pedido de ordem recebido do cell 1 (contrato 4), aceito por ti: tu passa para o cell 1
  const t2 = await montarTela({ inicial: S(28) });
  const recebido = S(28);
  for (const x of recebido.pickOrderSwaps) x.state = x.cellId === 1 ? 'RECEIVED' : 'BUSY';
  await t2.emitir(recebido);
  t2.achar('div.lc-cp-sel-receb').querySelector('button[data-a="aceitar"]').click(); await tick();
  const depois = S(28);
  depois.localPlayerCellId = 1;
  pos(depois, 1).assignedPosition = 'jungle'; pos(depois, 4).assignedPosition = 'top';
  depois.pickOrderSwaps = disponiveis([[2, 30], [0, 31], [3, 32], [4, 33]]);
  await t2.emitir(depois);
  caso('troca: ⇅ ordem recebida e aceita por ti: "troca de ordem feita" na linha de quem pediu (agora no teu cell antigo)',
    t2.escritas().at(-1) === 'POST /lol-champ-select/v1/session/pick-order-swaps/4/accept' && /troca de ordem feita/.test(linhaDo(t2, 4)?.textContent || '') && semAvisoRuim(t2),
    linhaDo(t2, 4)?.textContent);
  todasEscritas.push(...t2.escritas());
  // c) ⇄ posição recebida do cell 0 (contrato 6), recusada por ti; o contrato volta AVAILABLE com id novo, sem DECLINED
  const t3 = await montarTela({ inicial: S(28) });
  const r3 = S(28);
  for (const x of r3.positionSwaps) x.state = x.cellId === 0 ? 'RECEIVED' : 'BUSY';
  await t3.emitir(r3);
  t3.achar('div.lc-cp-sel-receb').querySelector('button[data-a="recusar"]').click(); await tick();
  const d3 = S(28);
  d3.positionSwaps.find(x => x.cellId === 0).id = 40;
  await t3.emitir(d3);
  caso('troca: ⇄ posição recusada por ti e contrato regenerado sem DECLINED: "tu recusou", sem aviso de "sem resposta"',
    t3.escritas().at(-1) === 'POST /lol-champ-select/v1/session/position-swaps/6/decline' && /tu recusou a troca de posição/.test(linhaDo(t3, 0)?.textContent || '') && semAvisoRuim(t3),
    linhaDo(t3, 0)?.textContent);
  todasEscritas.push(...t3.escritas());
  // d) a sequência real inteira (troca entre dois aliados, ninguém pediu nada a mim): nada de aviso nem recado
  const t4 = await montarTela({ inicial: S(28) });
  for (const i of [30, 31, 32, 33]) await t4.emitir(S(i));
  caso('troca: sequência real ev 28 -> 33 (aliados 1 e 3 trocam a ordem): nenhum aviso nem recado na tela',
    t4.avisos.length === 0 && t4.todos('div.lc-cp-sel-pend').length === 0 && t4.falhas.length === 0, JSON.stringify(t4.avisos));
  // e) puro: SENT que volta com id novo segue aberto
  const mem = novaMemoria();
  const a = S(28); a.pickOrderSwaps.find(x => x.cellId === 2).state = 'SENT';
  acompanharPedidos(mem, a, 0);
  const b = S(28); Object.assign(b.pickOrderSwaps.find(x => x.cellId === 2), { state: 'SENT', id: 99 });
  caso('pedido: SENT que volta com id novo segue aberto (seguido por tipo + cell, nunca pelo id)', acompanharPedidos(mem, b, 10).length === 0 && mem.abertos.size === 1);
}
{
  // socket do Pengu mudo no meio da seleção: sem evento há 3 s, relê a sessão por GET a cada 2 s (a vez certa volta)
  let atual = S(40);
  const t = await montarTela({ inicial: S(40), rotas: { 'GET /lol-champ-select/v1/session': () => atual } });
  const reler = t.intervalos.find(x => x.ms === 2000);
  const gets = () => t.lcu.chamadas.filter(c => c.metodo === 'GET' && c.url === '/lol-champ-select/v1/session').length;
  const g0 = gets();
  reler?.fn(); await tick();
  const comEvento = gets() === g0;
  atual = S(53); // a vez dele chegou e o evento não veio
  tela._estado().ultimoEvento = Date.now() - 5000;
  reler?.fn(); await tick();
  caso('socket mudo: com evento recente não relê; 3 s sem evento relê por GET e pinta a vez certa ("TUA VEZ", TRAVAR)',
    !!reler && comEvento && gets() === g0 + 1 && /TUA VEZ/.test(t.titulo.textContent) && /TRAVAR/.test(t.achar('button[data-a="acao"]')?.textContent || '') && t.falhas.length === 0,
    JSON.stringify({ g0, g: gets(), titulo: t.titulo.textContent }));
  todasEscritas.push(...t.escritas());
}

// ---------- 5. finalização: skin, feitiços, runa ----------
{
  const fechou = [];
  const t = await montarTela({ inicial: S(58), servicos: { runas: { fecharPopup: () => fechou.push(1) } } });
  const sks = t.todos('button.lc-cp-sel-sk');
  caso('skin: só as 3 que ele tem, a escolhida (154002) marcada', igual(sks.map(b => String(b.dataset.id)), ['154000', '154002', '154006']) && sks[1].classList.contains('lc-cp-sel-on'));
  caso('skin: miniatura da splash (sem canvas no teste: cai na url do client)', /url\("\/t\/154000\.jpg"\)|url\("\/lol-game-data/.test(sks[0].style.backgroundImage || ''), sks[0].style.backgroundImage);
  sks[2].click(); await tick();
  caso('skin: clique = PATCH my-selection {selectedSkinId}', igual(t.escritas(), ['PATCH /lol-champ-select/v1/session/my-selection {"selectedSkinId":154006}']), t.escritas().join('; '));
  t.achar('button[data-a="feitico-abrir"][data-slot="0"]').click(); await tick();
  t.achar('button[data-a="feitico"][data-id="4"]').click(); await tick();
  caso('feitiço: Flash no D com Flash no F = troca de lugar (PATCH spell1 4, spell2 11)', t.escritas().at(-1) === 'PATCH /lol-champ-select/v1/session/my-selection {"spell1Id":4,"spell2Id":11}', t.escritas().join('; '));
  caso('runa: Zac com 1 página já atual = "✓ aplicada sozinha", nada escrito', /aplicada sozinha/.test(t.achar('div[data-a="runa"]').textContent) && !t.escritas().some(e => /perks/.test(e)));
  // troca de campeão: myTeam muda para Renekton (2 páginas): escolha dentro da tela, popup do runas.js fechado
  const ren = S(58); ren.myTeam.find(c => c.cellId === 4).championId = 58;
  await t.emitir(ren);
  const pags = t.todos('button[data-a="runa-pagina"]');
  caso('runa: Renekton com 2 páginas mostra as 2 e fecha o popup escondido do runas.js', pags.length === 2 && fechou.length >= 1 && /escolhe uma/.test(t.achar('div[data-a="runa"]').textContent));
  pags[0].click(); await tick();
  caso('runa: clique = PUT currentpage com o id puro', t.escritas().at(-1) === 'PUT /lol-perks/v1/currentpage 1409260191' && /✓ aplicada/.test(t.achar('div[data-a="runa"]').textContent), t.escritas().join('; '));
  caso('skin: troca de campeão relê o carrossel (Renekton: 1 skin dele + nenhuma do Zac)', t.todos('button.lc-cp-sel-sk').every(b => String(b.dataset.id).startsWith('58')));
  todasEscritas.push(...t.escritas());
}
{
  // "quero poder usar o scroll para rolar entre as skins" (Gabriel, 14/10/2026): roda do mouse na faixa = rolagem lateral
  const t = await montarTela({ inicial: S(58) });
  const faixa = t.achar('div.lc-cp-sel-skins');
  const roda = (el, deltaY, deltaX = 0) => { let parou = false; for (const fn of el?.ouvintes?.wheel || []) fn({ deltaY, deltaX, deltaMode: 0, preventDefault() { parou = true; } }); return parou; };
  if (faixa) { faixa.scrollWidth = 600; faixa.clientWidth = 300; faixa.scrollLeft = 0; }
  const parou = roda(faixa, 100);
  caso('skins: roda para baixo na faixa rola para o lado (e não rola a tela)', !!faixa && faixa.scrollLeft === 100 && parou, `left=${faixa?.scrollLeft} parou=${parou}`);
  roda(faixa, -40);
  caso('skins: roda para cima volta', faixa?.scrollLeft === 60, String(faixa?.scrollLeft));
  t.todos('button.lc-cp-sel-sk')[2].click(); await tick(); // repinta a faixa (skin ocupada)
  const nova = t.achar('div.lc-cp-sel-skins');
  caso('skins: clicar numa skin repinta a faixa no mesmo ponto da rolagem', nova !== faixa && nova.scrollLeft === 60, `nova=${nova !== faixa} left=${nova?.scrollLeft}`);
  faixa.scrollLeft = 300; // fim da faixa (600 - 300)
  const parouFim = roda(faixa, 100);
  caso('skins: no fim da faixa a roda segue para a tela (não prende a rolagem)', !parouFim && faixa.scrollLeft === 300, `left=${faixa.scrollLeft} parou=${parouFim}`);
  const curta = t.achar('div.lc-cp-sel-skins');
  curta.scrollWidth = 200; curta.clientWidth = 300; curta.scrollLeft = 0;
  caso('skins: faixa que cabe inteira não engole a roda', !roda(curta, 100) && curta.scrollLeft === 0);
  caso('skins: a grade de campeões não ganhou ouvinte de roda', !(t.achar('div.lc-cp-sel-grade')?.ouvintes?.wheel?.length));
  // revisão de 14/10/2026: deslize lateral do touchpad ou arrasto da barra (só o evento scroll, sem wheel) também ficam
  curta.scrollWidth = 600; curta.clientWidth = 300; curta.scrollLeft = 210;
  for (const fn of curta.ouvintes?.scroll || []) fn({});
  const outraSkin = S(58); outraSkin.myTeam.find(c => c.cellId === 4).selectedSkinId = 154006;
  await t.emitir(outraSkin); // o client confirmou a skin: repinta a faixa
  const depoisScroll = t.achar('div.lc-cp-sel-skins');
  caso('skins: rolagem sem roda (touchpad, barra) também volta ao mesmo ponto depois da repintura',
    depoisScroll !== curta && depoisScroll.scrollLeft === 210, `nova=${depoisScroll !== curta} left=${depoisScroll?.scrollLeft}`);
  caso('skins: rolar não escreve nada (só o PATCH do clique na skin)', igual(t.escritas(), ['PATCH /lol-champ-select/v1/session/my-selection {"selectedSkinId":154006}']), t.escritas().join('; '));
}
{
  const t = await montarTela({ inicial: S(58), cfg: { ...CFG, runas: { ...CFG.runas, ligado: false } } });
  caso('runa: runa por campeão desligada = nada lido nem escrito', /desligada/.test(t.achar('div[data-a="runa"]').textContent) && !t.lcu.chamadas.some(c => /perks/.test(c.url)));
}

// ---------- 6. defesas: ARAM, sessão que não chega, sessão torta ----------
{
  const s = S(40); s.benchEnabled = true; s.queueId = 450;
  const t = await montarTela({ inicial: s });
  caso('ARAM (banco): expande com aviso, sem pintar nem escrever', t.expandiu === 1 && t.avisos.length === 1 && t.escritas().length === 0);
}
{
  const t = await montarTela();
  caso('sessão que não chega: mostra "lendo a seleção…"', /lendo a seleção/.test(t.raiz.textContent));
  t.rodarTimers(3000);
  caso('sessão que não chega em 3 s: falhou (o roteador devolve o client normal)', t.falhas.length === 1 && /não chegou/.test(t.falhas[0].message));
}
{
  const t = await montarTela({ inicial: S(40) });
  await t.emitir({ timer: { phase: 'BAN_PICK' } });
  caso('sessão sem myTeam: erro vai ao roteador (expande)', t.falhas.length === 1);
}

// ---------- 7. pelo roteador de verdade (contrato de tela) ----------
{
  const doc = novoDoc();
  globalThis.document = doc;
  const win = { innerWidth: 1280, riotInvoke: arg => { const p = JSON.parse(arg.request); if (p.name === 'Window.ResizeTo') win.innerWidth = p.params[0]; } };
  const janela = criarJanela({ invocar: invocadorRiot(win, () => {}), medir: () => [win.innerWidth, 720] });
  const camada = criarCamada({ doc });
  const subs = new Map(), avisos = [];
  const f = lcuFalsa({ 'GET /lol-champ-select/v1/session': S(40), 'GET /lol-game-data/assets/v1/champion-summary.json': CATALOGO, 'GET /lol-champ-select/v1/bannable-champion-ids': TODOS });
  globalThis.fetch = f.fetch; _zerarCatalogo();
  const rot = criarRoteador({
    cfg: { ...CFG, aceite: { ligado: true } }, janela, camada, carregarTela: async () => tela,
    lcu: (m, u, c) => lcuComum(m, u, c, f.fetch), avisar: (m, e) => avisos.push([m, e]), log: () => {},
    assinar: (uri, cb) => subs.set(uri, cb), classe: () => {},
  });
  rot.marcarPronto();
  rot.aoFase('ChampSelect');
  rot.aoSessao({ gameData: { queue: { id: 420, mapId: 11 }, isCustomGame: false }, map: { id: 11 } });
  await tick(10);
  const e1 = rot.estado();
  const corpo = doc.getElementById('lc-compacto')?.querySelector('main.lc-cp-corpo');
  caso('roteador: ChampSelect 420 monta a tela 3 na janela 420×640 e pinta a sessão', e1.efetivo === 'compacto' && e1.tela === 'champselect' && win.innerWidth === 420
    && !!corpo?.querySelector('div.lc-cp-sel-lin'), JSON.stringify(e1));
  subs.get('/lol-champ-select/v1/session')?.({ eventType: 'Update', data: { timer: { phase: 'BAN_PICK' } } });
  await tick();
  const e2 = rot.estado();
  caso('roteador: sessão torta no meio = client normal 1280 (erro de tela expande)', e2.efetivo === 'expandido' && /erro na tela/.test(e2.forcado || '') && win.innerWidth === 1280, JSON.stringify(e2));
  caso('roteador: nenhuma escrita na LCU nesse caminho', f.escritas().length === 0);
}

// ---------- 7b. a ranqueada real de 14/10/2026 (1ª no compacto): os 3 defeitos que o Gabriel relatou ----------
// tests/fixtures/selecao-ranqueada-20261014.json (do medidor, só sinais): eu no cell 1, ban 1, pick 13.
// ev 0 = PLANNING, ev 1 = BAN_PICK com o meu ban aberto, ev 10 = vez do cell 0 com a minha intenção 58, ev 14 = minha vez.
{
  const R = JSON.parse(readFileSync(RAIZ + 'tests/fixtures/selecao-ranqueada-20261014.json', 'utf8')).eventos;
  const SR = i => clonar(R[i].session);
  const grade = t => t.todos('button.lc-cp-sel-gc');
  const ligados = t => grade(t).filter(b => !b.disabled).map(b => Number(b.dataset.id));

  // defeito 2: declarar no PLANNING é 1 clique
  {
    const t = await montarTela({ inicial: SR(0) });
    caso('ranqueada ev 0 (PLANNING): modo intenção na minha ação de pick 13, sem botão de confirmar',
      lerSessao(SR(0)).modo.tipo === 'intencao' && lerSessao(SR(0)).modo.acao?.id === 13 && !t.achar('button[data-a="acao"]'));
    t.achar('button.lc-cp-sel-fav[data-id="58"]')?.click(); await tick();
    caso('ranqueada ev 0: clique no favorito Renekton = PATCH actions/13 {completed:false, championId:58} na hora',
      igual(t.escritas(), ['PATCH /lol-champ-select/v1/session/actions/13 {"completed":false,"championId":58}']), t.escritas().join('; '));
    todasEscritas.push(...t.escritas());
  }

  // defeito 1: grade do ban vazia quando a lista de banidos do client vem vazia ou sem nenhum id do catálogo
  for (const [nome, lista] of [['vazia ([])', []], ['sem id do catálogo ([99999])', [99999]]]) {
    const t = await montarTela({ inicial: SR(0), rotas: { 'GET /lol-champ-select/v1/bannable-champion-ids': lista } });
    await t.emitir(SR(1));
    const l1 = lerSessao(SR(1));
    caso(`ranqueada ev 1 (BAN_PICK), bannable ${nome}: modo banir na ação 1 e a grade mostra os campeões, ligados, com a nota`,
      l1.modo.tipo === 'banir' && l1.modo.acao?.id === 1 && ligados(t).length >= TODOS.length - 1 && /lista de bans/.test(t.raiz.textContent),
      JSON.stringify({ ligados: ligados(t).length, nota: /lista de bans/.test(t.raiz.textContent) }));
    caso(`ranqueada ev 1, bannable ${nome}: BANIR desligado até o clique dele`, t.achar('button[data-a="acao"]')?.disabled && /^BANIR$/.test(t.achar('button[data-a="acao"]').textContent));
    caso(`ranqueada ev 1, bannable ${nome}: o tamanho da lista vai para o log (só números, para o LeagueClientUx.log)`,
      t.logs.some(m => new RegExp(`bannable-champion-ids BAN_PICK/banir status=200 n=${lista.length} noCatalogo=0`).test(m)), JSON.stringify(t.logs));
    t.achar('button.lc-cp-sel-gc[data-id="157"]')?.click(); await tick();
    t.rodarTimers(tela.ARMAR_MS);
    t.achar('button[data-a="acao"]')?.click(); await tick();
    caso(`ranqueada ev 1, bannable ${nome}: clique = hover, BANIR = 1 PATCH completed true da ação 1`,
      igual(t.escritas(), ['PATCH /lol-champ-select/v1/session/actions/1 {"completed":false,"championId":157}', 'PATCH /lol-champ-select/v1/session/actions/1 {"completed":true,"championId":157}']), t.escritas().join('; '));
    todasEscritas.push(...t.escritas());
  }
  {
    // lista boa: filtra como antes (o client manda só o que dá para banir)
    const t = await montarTela({ inicial: SR(1), rotas: { 'GET /lol-champ-select/v1/bannable-champion-ids': [58, 157, 245] } });
    caso('ranqueada ev 1, bannable com ids: a grade é a lista do client (+ favoritos cinza), sem a nota',
      igual(ligados(t).sort((a, b) => a - b), [58, 157, 245]) && !/lista de bans/.test(t.raiz.textContent), JSON.stringify(ligados(t)));
  }

  // defeito 3: TRAVAR na minha vez (intenção 58 vira o alvo)
  {
    const t = await montarTela({ inicial: SR(14) });
    t.rodarTimers(tela.ARMAR_MS);
    const b = t.achar('button[data-a="acao"]');
    caso('ranqueada ev 14 (minha vez): TRAVAR Renekton ligado (a intenção 58 é o alvo)', /TRAVAR Renekton/.test(b?.textContent || '') && !b?.disabled, b?.textContent);
    b?.click(); await tick();
    caso('ranqueada ev 14: TRAVAR = PATCH actions/13 {completed:true, championId:58}, nenhum /complete',
      igual(t.escritas(), ['PATCH /lol-champ-select/v1/session/actions/13 {"completed":true,"championId":58}']), t.escritas().join('; '));
    await t.emitir(SR(19)); // 10:14:00: pick 13 completo com 58
    t.rodarTimers(tela.CONFERIR_MS); await tick();
    caso('ranqueada ev 19: travado = finalização, sem aviso de erro', lerSessao(SR(19)).modo.tipo === 'finalizar' && !t.avisos.some(([, e]) => e), JSON.stringify(t.avisos));
    todasEscritas.push(...t.escritas());
  }

  // revisão de 14/10/2026 (antes do commit): os buracos que o mecanismo novo de travar abria
  const P13 = 'PATCH /lol-champ-select/v1/session/actions/13';
  const presa = () => { let soltar; const p = new Promise(r => { soltar = r; }); return [p, () => soltar()]; };
  {
    // nº 1: o botão de ação ocupa o mesmo lugar na espera e na vez dele, e o TRAVAR que surge nasce cinza por ARMAR_MS
    const t = await montarTela({ inicial: SR(10) });
    const caixa = () => t.achar('.lc-cp-sel-acao');
    const antes = caixa()?.children.map(b => b.className);
    caso('posição: na espera (ev 10) o lugar do botão tem 1 marcador cinza do mesmo tamanho (lc-cp-btn), sem botão de ação',
      igual(antes, ['lc-cp-btn']) && caixa().children[0].disabled && !t.achar('button[data-a="acao"]'), JSON.stringify(antes));
    await t.emitir(SR(14));
    const b = t.achar('button[data-a="acao"]');
    caso('posição: na vez dele (ev 14) o TRAVAR entra no MESMO lugar (1 botão lc-cp-btn na mesma caixa), cinza nos primeiros ms',
      caixa()?.children.length === 1 && caixa().children[0] === b && /lc-cp-btn/.test(b.className) && b.disabled && /TRAVAR Renekton/.test(b.textContent), b?.textContent);
    b.click(); await tick();
    caso('posição: clique no TRAVAR recém-surgido (ainda armando) não escreve nada', t.escritas().length === 0, t.escritas().join('; '));
    t.rodarTimers(tela.ARMAR_MS);
    caso('posição: depois de ARMAR_MS o TRAVAR liga', !t.achar('button[data-a="acao"]').disabled);
  }
  {
    // nº 1 (ban → escolha) e geração: duas viradas dentro do prazo não armam cedo
    const t = await montarTela({ inicial: SR(1) });
    const primeiro = t.timers.find(x => x.ms === tela.ARMAR_MS);
    await t.emitir(SR(14));
    primeiro?.fn(); await tick();
    caso('armar: o timer do BANIR (virada anterior) não liga o TRAVAR que surgiu depois', !!primeiro && t.achar('button[data-a="acao"]').disabled);
    t.rodarTimers(tela.ARMAR_MS);
    caso('armar: o timer do próprio TRAVAR liga', !t.achar('button[data-a="acao"]').disabled);
  }
  {
    // nº 2: TRAVAR pendente (hover A em voo) + clique em B = cancela, nunca trava B nem A sem novo clique
    const [p, soltar] = presa();
    const t = await montarTela({ inicial: SR(14), rotas: { [P13]: async c => { if (c?.completed === false) await p; return { status: 204 }; } } });
    t.rodarTimers(tela.ARMAR_MS);
    t.achar('button.lc-cp-sel-gc[data-id="157"]').click(); await tick();
    t.achar('button[data-a="acao"]').click(); await tick();
    t.achar('button.lc-cp-sel-gc[data-id="245"]').click(); await tick();
    caso('pendente + clique em outro: aviso "travamento de Yasuo cancelado"', t.avisos.some(([m]) => /travamento de Yasuo cancelado/.test(m) && /TRAVAR de novo/.test(m)), JSON.stringify(t.avisos));
    soltar(); await tick(12);
    caso('pendente + clique em outro: sai só o hover novo (Ekko), nenhum completed true',
      igual(t.escritas(), [`${P13} {"completed":false,"championId":157}`, `${P13} {"completed":false,"championId":245}`]), t.escritas().join('; '));
    caso('pendente + clique em outro: o botão volta "TRAVAR Ekko" ligado', /^TRAVAR Ekko$/.test(t.achar('button[data-a="acao"]').textContent) && !t.achar('button[data-a="acao"]').disabled,
      t.achar('button[data-a="acao"]').textContent);
  }
  {
    // nº 2: o pendente refaz o pode(id): um aliado travou o campeão enquanto o hover voava
    const [p, soltar] = presa();
    const t = await montarTela({ inicial: SR(14), rotas: { [P13]: async c => { if (c?.completed === false) await p; return { status: 204 }; } } });
    t.rodarTimers(tela.ARMAR_MS);
    t.achar('button.lc-cp-sel-gc[data-id="157"]').click(); await tick();
    t.achar('button[data-a="acao"]').click(); await tick();
    const s = SR(14); s.myTeam.find(c => c.cellId !== 1).championId = 157;
    await t.emitir(s);
    soltar(); await tick(12);
    caso('pendente: campeão pego por aliado no meio do voo = não trava, aviso "não está mais disponível"',
      !t.escritas().some(e => /"completed":true/.test(e)) && t.avisos.some(([m, e]) => e && /Yasuo não está mais disponível/.test(m)), JSON.stringify({ e: t.escritas(), a: t.avisos }));
  }
  {
    // nº 3: hover que nunca volta + TRAVAR: no prazo do hover, aviso e o botão volta; o 2º clique trava
    const [p] = presa();
    const t = await montarTela({ inicial: SR(14), rotas: { [P13]: async c => { if (c?.completed === false) await p; return { status: 204 }; } } });
    t.rodarTimers(tela.ARMAR_MS);
    t.achar('button.lc-cp-sel-gc[data-id="157"]').click(); await tick();
    t.achar('button[data-a="acao"]').click(); await tick();
    t.rodarTimers(tela.PRAZO_HOVER_MS); await tick(6);
    caso('hover mudo + TRAVAR: no PRAZO_HOVER_MS aviso "não respondeu" com ⤢ e nenhum travamento às cegas',
      t.avisos.some(([m, e]) => e && /não respondeu/.test(m) && /expandir/.test(m)) && !t.escritas().some(e => /"completed":true/.test(e)), JSON.stringify(t.avisos));
    const b = t.achar('button[data-a="acao"]');
    caso('hover mudo + TRAVAR: o botão volta "TRAVAR Yasuo" ligado', /^TRAVAR Yasuo$/.test(b.textContent) && !b.disabled, b.textContent);
    b.click(); await tick();
    caso('hover mudo + TRAVAR: o 2º clique dele trava (1 PATCH completed true)', t.escritas().filter(e => /"completed":true,"championId":157/.test(e)).length === 1, t.escritas().join('; '));
  }
  {
    // nº 3: o PATCH de travar que nunca volta: no PRAZO_MS vira "não consegui travar (sem resposta)" e o botão volta
    const [p] = presa();
    const t = await montarTela({ inicial: SR(14), rotas: { [P13]: async c => { if (c?.completed === true) await p; return { status: 204 }; } } });
    t.rodarTimers(tela.ARMAR_MS);
    t.achar('button[data-a="acao"]').click(); await tick();
    caso('travar mudo: enquanto voa, "TRAVANDO Renekton…" cinza', /TRAVANDO Renekton/.test(t.achar('button[data-a="acao"]').textContent) && t.achar('button[data-a="acao"]').disabled);
    // nº 4: clique na grade com o travar em voo não manda {completed:false} contra a ação fechando
    t.achar('button.lc-cp-sel-gc[data-id="157"]').click(); await tick();
    caso('travar em voo: clique na grade ignorado (só o PATCH de travar saiu)', igual(t.escritas(), [`${P13} {"completed":true,"championId":58}`]), t.escritas().join('; '));
    t.rodarTimers(tela.PRAZO_MS); await tick(6);
    caso('travar mudo: no PRAZO_MS aviso "não consegui travar Renekton (sem resposta)" com ⤢, botão de volta e nenhuma 2ª escrita',
      t.avisos.some(([m, e]) => e && /não consegui travar Renekton \(sem resposta\)/.test(m) && /expandir/.test(m)) && !t.achar('button[data-a="acao"]').disabled
      && t.escritas().length === 1, JSON.stringify(t.avisos));
  }
  {
    // nº 6: botão cinza sempre com motivo (a intenção dele foi banida por um aliado)
    const s = SR(14);
    const banAliado = tela.acoes(s).find(a => a.type === 'ban' && a.actorCellId !== 1 && s.myTeam.some(c => c.cellId === a.actorCellId));
    banAliado.championId = 58; banAliado.completed = true;
    const t = await montarTela({ inicial: s });
    t.rodarTimers(tela.ARMAR_MS);
    const b = t.achar('button[data-a="acao"]');
    caso('motivo: TRAVAR Renekton cinza com a nota "Renekton foi banido: clica outro"', b.disabled && /TRAVAR Renekton/.test(b.textContent)
      && /Renekton foi banido: clica outro/.test(t.achar('[data-a="motivo"]')?.textContent || ''), t.achar('[data-a="motivo"]')?.textContent);
  }
  {
    // nº 5: na ESCOLHA, lista de picks vazia segue filtrando (só favoritos, cinza) com a nota e o ⤢
    const t = await montarTela({ inicial: SR(14), rotas: { 'GET /lol-champ-select/v1/pickable-champion-ids': [] } });
    t.rodarTimers(tela.ARMAR_MS);
    const nota = t.achar('[data-a="sem-lista"]')?.textContent || '';
    caso('escolha sem lista de picks: grade = só os favoritos, cinza; TRAVAR cinza; nota com ⤢ (nunca mostra campeão que ele não tem)',
      igual(grade(t).map(x => Number(x.dataset.id)).sort((a, b) => a - b), [58, 154]) && ligados(t).length === 0 && t.achar('button[data-a="acao"]').disabled
      && /expandir/.test(nota), JSON.stringify({ g: grade(t).map(x => x.dataset.id), nota }));
  }
  {
    // nº 8: o mesmo campeão não reenvia na hora, mas reenvia depois de REENVIO_MS (o 204 que não muda nada existe)
    const t = await montarTela({ inicial: SR(0) });
    t.achar('button.lc-cp-sel-gc[data-id="157"]').click(); await tick();
    await t.emitir(SR(0)); // evento velho (o hover ainda não aparece nele)
    t.achar('button.lc-cp-sel-gc[data-id="157"]').click(); await tick();
    const n1 = t.escritas().length;
    const agora = Date.now;
    Date.now = () => agora() + tela.REENVIO_MS + 50;
    try { t.achar('button.lc-cp-sel-gc[data-id="157"]').click(); await tick(); } finally { Date.now = agora; }
    caso('reenvio: evento velho não faz reenviar o mesmo campeão; depois de REENVIO_MS o 2º clique reenvia', n1 === 1 && t.escritas().length === 2, `${n1} ${t.escritas().length}`);
  }

  // 3ª ranqueada de 14/10/2026: "as fotos dos campeões mostrando intenção não aparecem. Só depois que pica" (o aliado
  // com intenção só tinha o texto "intenção: X"; foto só depois de travar). Intenção = foto com marca própria, travado
  // = foto normal; inimigo segue só com o pick completo (lerSessao, guardrail)
  {
    const fotoDa = (t, cell) => linhaDo(t, cell)?.querySelector('span.lc-cp-foto');
    const t = await montarTela({ inicial: SR(11) });
    const a0 = fotoDa(t, 0), eu = fotoDa(t, 1);
    caso('ranqueada ev 11: aliado com intenção (cell 0, 25) mostra a foto da intenção, marcada como intenção',
      String(a0?.dataset?.campeao) === '25' && a0.classList.contains('lc-cp-sel-intencao') && /intenção/.test(linhaDo(t, 0)?.textContent || ''),
      `${a0?.dataset?.campeao} ${a0?.className}`);
    caso('ranqueada ev 11: a minha intenção (58) também com a marca de intenção', String(eu?.dataset?.campeao) === '58' && eu.classList.contains('lc-cp-sel-intencao'), `${eu?.dataset?.campeao} ${eu?.className}`);
    await t.emitir(SR(12));
    const a0t = fotoDa(t, 0);
    caso('ranqueada ev 12: aliado travou (25): foto normal, sem a marca de intenção', String(a0t?.dataset?.campeao) === '25' && !a0t.classList.contains('lc-cp-sel-intencao'), a0t?.className);
    await t.emitir(SR(15));
    caso('ranqueada ev 15: intenção nova de outro aliado (cell 2, 51) aparece na hora', String(fotoDa(t, 2)?.dataset?.campeao) === '51' && fotoDa(t, 2).classList.contains('lc-cp-sel-intencao'));
    caso('intenção: o CSS dá à foto de intenção um visual próprio (tracejada e apagada)',
      /\.lc-cp-foto\.lc-cp-sel-intencao \{[^}]*dashed[^}]*\}/.test(tela.CSS) && /\.lc-cp-foto\.lc-cp-sel-intencao \{[^}]*opacity/.test(tela.CSS));
    caso('intenção: nenhuma escrita só por mostrar', t.escritas().length === 0, t.escritas().join('; '));
  }
  // revisão de 14/10/2026: a intenção é só do meu time. Hover inimigo em andamento (champselect-real.json: ev 18 cell 0
  // 950, ev 23 cell 1 145, ev 51 cell 7 245, ev 57 cell 9 92, isAllyAction false) nunca vira foto nas linhas do time
  // nem entra na lista de inimigos antes do pick completo
  {
    const vazou = [];
    for (const [i, cell, id] of [[18, 0, 950], [23, 1, 145], [51, 7, 245], [57, 9, 92]]) {
      const s = S(i);
      const hover = s.actions.flat().find(a => a.actorCellId === cell && a.type === 'pick' && a.isAllyAction === false);
      if (!hover || hover.championId !== id || hover.completed) { vazou.push(`fixture ${i} mudou`); continue; }
      const t = await montarTela({ inicial: s });
      const linhas = t.todos('div.lc-cp-sel-lin');
      if (!linhas.length) vazou.push(`ev ${i}: sem linhas do time`);
      const fotos = linhas.flatMap(l => l.querySelectorAll('span.lc-cp-foto')).filter(f => String(f.dataset?.campeao) === String(id));
      if (fotos.length) vazou.push(`ev ${i}: foto de ${id} na linha do time`);
      if (lerSessao(s).inimigos.includes(id)) vazou.push(`ev ${i}: ${id} na lista de inimigos`);
    }
    caso('intenção inimiga (hover em andamento) não aparece em foto nem na lista de inimigos (ev 18, 23, 51, 57)', !vazou.length, vazou.join('; '));
  }

  // a seleção inteira, sem clique: nada escrito, nenhum erro
  {
    const t = await montarTela({ inicial: SR(0) });
    for (let i = 1; i < R.length; i++) await t.emitir(SR(i));
    caso('ranqueada inteira (30 eventos): nenhuma escrita sem clique e nenhum erro', t.escritas().length === 0 && t.falhas.length === 0,
      t.escritas().join('; ') + t.falhas.map(e => e.message).join('; '));
  }
}

// ---------- 8. linha que não se cruza, somada ----------
caso('nenhum clique escreveu em matchmaking, quit, gameflow ou RiotClient', todasEscritas.length > 10 && !todasEscritas.some(e => /matchmaking|quit|gameflow|riotclient|lobby/i.test(e)), todasEscritas.length);
caso('nenhum clique usou POST .../complete (sem corpo a LCU trava o campeão 0: LeagueClient.log 14/10/2026)', !todasEscritas.some(e => /\/complete/.test(e)), todasEscritas.filter(e => /\/complete/.test(e)).join('; '));
caso('travar/banir sempre leva o championId junto do completed true', todasEscritas.filter(e => /"completed":true/.test(e)).every(e => /"completed":true,"championId":[1-9]\d*/.test(e)));

// o roteador carrega esta tela (sem isso a seleção fica sempre no client normal)
caso('roteador: TELAS.champselect aponta para a tela 3', TELAS.champselect === './tela-champselect.js', TELAS.champselect);
relatar(casos);
