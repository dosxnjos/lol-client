// Testa a escolha pura das runas (pengu/runas.js). uso: node tools/teste-runas.mjs
import { escolherRunas, donoDaPagina, consultarRunas } from '../pengu/runas.js';
import { PADRAO } from '../pengu/config.js';

const regras = PADRAO.runas.regras; // a semente do plano
// páginas como GET /lol-perks/v1/pages devolve (medidas em 13/10/2026; só o que a função usa)
const paginas = [1409260191, 1378841228, 1333256548, 1540029809, 1517184216, 2133672737, 1417788555, 1696192448, 2147419287].map(id => ({ id }));
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const casos = [
  ['Renekton/TOP -> 2 ids', escolherRunas(regras, 58, 'TOP', paginas), r => igual(r, [1409260191, 2147419287])],
  ['Zac/JUNGLE -> [1540029809]', escolherRunas(regras, 154, 'JUNGLE', paginas), r => igual(r, [1540029809])],
  ['Ahri -> []', escolherRunas(regras, 103, 'MIDDLE', paginas), r => igual(r, [])],
  ['id inexistente filtrado', escolherRunas([{ championId: 58, posicao: '*', paginas: [1409260191, 999] }], 58, 'TOP', paginas), r => igual(r, [1409260191])],
];
// extras: posição específica vence a '*', posição minúscula da LCU, champ select sem posição, dono da página
const pos = [...regras, { championId: 58, posicao: 'JUNGLE', paginas: [1696192448] }];
const extras = [
  ['regra da posição vence a *', escolherRunas(pos, 58, 'JUNGLE', paginas), r => igual(r, [1696192448])],
  ['posição em minúscula (assignedPosition)', escolherRunas(pos, 58, 'jungle', paginas), r => igual(r, [1696192448])],
  ['sem posição (personalizada) cai na *', escolherRunas(pos, 58, '', paginas), r => igual(r, [1409260191, 2147419287])],
  ['apagada vira aviso', consultarRunas([{ championId: 58, posicao: '*', paginas: [1409260191, 999] }], 58, '', paginas), r => igual(r, { candidatas: [1409260191], apagadas: [999] })],
  // regra da posição sem página viva não esconde a '*' (achado de revisão 13/10/2026)
  ['regra da posição vazia cai na *', escolherRunas([...regras, { championId: 154, posicao: 'JUNGLE', paginas: [] }], 154, 'jungle', paginas), r => igual(r, [1540029809])],
  ['regra da posição toda apagada cai na * e avisa', consultarRunas([...regras, { championId: 154, posicao: 'JUNGLE', paginas: [999] }], 154, 'JUNGLE', paginas), r => igual(r, { candidatas: [1540029809], apagadas: [999] })],
  ['regra da posição com 1 viva não cai na *', consultarRunas([...regras, { championId: 58, posicao: 'TOP', paginas: [999, 1696192448] }], 58, 'TOP', paginas), r => igual(r, { candidatas: [1696192448], apagadas: [999] })],
  ['página do Zac com Renekton -> dono 154', donoDaPagina(regras, 1540029809, 58), r => r === 154],
  ['página do próprio campeão -> null', donoDaPagina(regras, 1540029809, 154), r => r === null],
];

// client compacto à vista (html.lc-modo-compacto): 2+ páginas não abrem o popup nem piscam a janela (a tela 3 escolhe)
{
  const { iniciarRunas } = await import('../pengu/runas.js');
  const chamadas = [], criados = [];
  const antes = { document: globalThis.document, fetch: globalThis.fetch };
  globalThis.document = {
    documentElement: { classList: { contains: c => c === 'lc-modo-compacto' } },
    getElementById: () => null, removeEventListener() {}, addEventListener() {},
    createElement: t => { criados.push(t); return { append() {}, addEventListener() {}, dataset: {} }; }, body: { appendChild() {} },
  };
  globalThis.fetch = async (url, op = {}) => {
    chamadas.push(`${op.method || 'GET'} ${url}`);
    const corpo = url === '/lol-perks/v1/pages' ? paginas.map(p => ({ ...p, isEditable: true, name: 'p' + p.id }))
      : url.endsWith('champion-summary.json') ? [{ id: 58, name: 'Renekton' }] : [];
    return { ok: true, status: 200, text: async () => JSON.stringify(corpo) };
  };
  const r = await iniciarRunas({ socket: { observe() {} } }, { runas: { ligado: true, regras } }).aoTravar(58, 'TOP');
  Object.assign(globalThis, antes);
  extras.push(['compacto à vista: 2 páginas sem popup, sem ux-show/ux-flash, sem escrita',
    { r, escritas: chamadas.filter(c => !c.startsWith('GET')), criados: criados.length },
    x => x.r.acao === 'compacto' && igual(x.r.ids, [1409260191, 2147419287]) && x.escritas.length === 0 && x.criados === 0]);
}

// ---- paridade com o expandido (plano do compacto, passo 11 b3 e b4): DOM falso com a camada e o popup ----
{
  const { iniciarRunas } = await import('../pengu/runas.js');
  class FEl {
    constructor(tag) { this.tag = tag; this.filhos = []; this.dataset = {}; this.style = {}; this.attrs = {}; this.ouv = {}; this.id = ''; this.className = ''; this._t = ''; this.pai = null; }
    get textContent() { return this._t + this.filhos.map(n => (n && typeof n === 'object' ? n.textContent : String(n))).join(''); }
    set textContent(v) { this._t = String(v); this.filhos = []; }
    append(...ns) { for (const n of ns) { if (n && typeof n === 'object') { n.pai?.filhos.splice(n.pai.filhos.indexOf(n), 1); n.pai = this; } this.filhos.push(n); } }
    appendChild(n) { this.append(n); return n; }
    remove() { if (this.pai) { this.pai.filhos.splice(this.pai.filhos.indexOf(this), 1); this.pai = null; } }
    addEventListener(t, f) { (this.ouv[t] ||= []).push(f); }
    setAttribute(k, v) { this.attrs[k] = v; }
    *desc() { for (const n of this.filhos) if (n && typeof n === 'object') { yield n; yield* n.desc(); } }
    querySelector(sel) { const c = sel.slice(1); for (const n of this.desc()) if (String(n.className).split(' ').includes(c)) return n; return null; }
    querySelectorAll(sel) { const c = sel.slice(1); return [...this.desc()].filter(n => String(n.className).split(' ').includes(c)); }
    click() { for (const f of this.ouv.click || []) f({ stopPropagation() {}, preventDefault() {} }); }
  }
  // um "client": classe do <html>, camada, popup, Toast, MutationObserver e LCU falsos
  function client({ compacto = true, atual = 999, paginasVivas = paginas } = {}) {
    const c = { classes: new Set(compacto ? ['lc-modo-compacto'] : []), toasts: [], chamadas: [], obs: [], subs: new Map(), atual };
    const body = new FEl('body');
    c.body = body;
    c.camada = null;
    c.doc = {
      body, documentElement: { classList: { contains: k => c.classes.has(k) } },
      createElement: t => new FEl(t),
      getElementById: id => { for (const n of body.desc()) if (n.id === id) return n; return null; },
      addEventListener() {}, removeEventListener() {},
    };
    c.compactar = () => { c.classes.add('lc-modo-compacto'); c.camada = new FEl('div'); c.camada.id = 'lc-compacto'; body.append(c.camada); c.mudou(); };
    c.expandir = () => { c.classes.delete('lc-modo-compacto'); c.camada?.remove(); c.camada = null; c.mudou(); };
    c.mudou = () => { for (const o of c.obs) if (!o.parado) o.cb([{ type: 'attributes', attributeName: 'class' }]); };
    c.MO = class { constructor(cb) { this.cb = cb; c.obs.push(this); } observe() {} disconnect() { this.parado = true; } };
    c.Toast = { success: m => c.toasts.push(['ok', m]), error: m => c.toasts.push(['erro', m]) };
    c.fetch = async (url, op = {}) => {
      const metodo = op.method || 'GET';
      c.chamadas.push(`${metodo} ${url}`);
      const corpo = url === '/lol-perks/v1/pages' ? paginasVivas.map(p => ({ ...p, isEditable: true, name: 'p' + p.id }))
        : url === '/lol-perks/v1/currentpage' && metodo === 'GET' ? { id: c.atual, name: 'p' + c.atual }
        : url.endsWith('champion-summary.json') ? [{ id: 58, name: 'Renekton' }, { id: 154, name: 'Zac' }]
        : url === '/lol-perks/v1/styles' ? [] : null;
      if (url === '/lol-perks/v1/currentpage' && metodo === 'PUT') c.atual = JSON.parse(op.body);
      return { ok: true, status: 200, text: async () => (corpo === null ? '' : JSON.stringify(corpo)) };
    };
    c.usar = () => { Object.assign(globalThis, { document: c.doc, Toast: c.Toast, MutationObserver: c.MO, fetch: c.fetch }); };
    c.usar();
    if (compacto) { c.camada = new FEl('div'); c.camada.id = 'lc-compacto'; body.append(c.camada); }
    c.context = { socket: { observe: (uri, cb) => { (c.subs.get(uri) || c.subs.set(uri, []).get(uri)).push(cb); } } };
    c.emitir = (uri, data) => { for (const cb of c.subs.get(uri) || []) cb({ uri, data, eventType: 'Update' }); };
    c.popup = () => c.doc.getElementById('lc-runas');
    c.escritas = () => c.chamadas.filter(x => !x.startsWith('GET'));
    c.aviso = () => c.camada?.querySelector('.lc-cp-aviso')?.textContent || null;
    return c;
  }
  const espera = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
  const antes = { document: globalThis.document, fetch: globalThis.fetch, Toast: globalThis.Toast, MutationObserver: globalThis.MutationObserver };
  const regras2 = [{ championId: 58, posicao: '*', paginas: [1409260191, 2147419287] }, { championId: 154, posicao: '*', paginas: [1540029809, 999] }];

  // b4: travou no compacto com 2 páginas e expandiu antes de escolher: o popup aparece ao expandir (sem piscar a janela)
  let c = client();
  let api = iniciarRunas(c.context, { runas: { ligado: true, regras: regras2 } });
  let r = await api.aoTravar(58, 'TOP');
  const semPopupNoCompacto = !c.popup();
  c.expandir(); await espera();
  extras.push(['b4: 2 páginas no compacto e ele expande antes de escolher → popup das 2 páginas, sem ux-show/ux-flash e sem escrita',
    { r: r.acao, semPopupNoCompacto, popup: !!c.popup(), botoes: c.popup()?.querySelectorAll('.lc-runas-pagina').length, escritas: c.escritas() },
    x => x.r === 'compacto' && x.semPopupNoCompacto && x.popup && x.botoes === 2 && x.escritas.length === 0]);
  // compactar de novo com o popup aberto: a tela 3 fecha o popup (fecharPopup, não é escolha dele); expandir de novo reabre
  c.compactar(); api.fecharPopup(); c.expandir(); await espera();
  extras.push(['b4: popup fechado pela tela 3 (voltou ao compacto) e expandiu de novo → popup volta', { popup: !!c.popup() }, x => x.popup]);
  // "manter a atual" é escolha dele: expandir depois não reabre
  c.popup()?.querySelector('.lc-runas-fechar')?.click();
  c.compactar(); c.expandir(); await espera();
  extras.push(['b4: "manter a atual" vale como escolha: compactar e expandir de novo não reabre', { popup: !!c.popup() }, x => !x.popup]);

  // b4: já escolheu na tela 3 (a página atual é uma das candidatas) → expandir não abre nada
  c = client();
  api = iniciarRunas(c.context, { runas: { ligado: true, regras: regras2 } });
  await api.aoTravar(58, 'TOP');
  c.atual = 2147419287; // o clique dele na tela 3 (PUT currentpage)
  c.expandir(); await espera();
  extras.push(['b4: escolheu na tela 3 antes de expandir → nenhum popup', { popup: !!c.popup(), escritas: c.escritas() }, x => !x.popup && x.escritas.length === 0]);

  // b4 (achado 5): clicou na página da tela 3 e expandiu antes do PUT terminar (a LCU ainda devolve a página antiga) →
  // a tela 3 avisa o runas.js no clique (escolheu) e o expandir não reabre o popup
  c = client();
  api = iniciarRunas(c.context, { runas: { ligado: true, regras: regras2 } });
  await api.aoTravar(58, 'TOP');
  api.escolheu(); // o clique na tela 3; c.atual segue 999 (PUT em voo)
  c.expandir(); await espera();
  extras.push(['b4: escolheu na tela 3 e expandiu com o PUT em voo → nenhum popup', { popup: !!c.popup(), chamadas: c.chamadas.filter(x => /currentpage/.test(x)) },
    x => !x.popup]);

  // b4 (achado 6): as regras mudaram no meio da seleção (2 páginas -> 1, fora das candidatas antigas): o expandir aplica a
  // nova uma vez e a pendência fecha; compactar e expandir de novo não repete o PUT nem o aviso
  c = client();
  const cfg6 = { runas: { ligado: true, regras: regras2 } };
  api = iniciarRunas(c.context, cfg6);
  await api.aoTravar(58, 'TOP');
  cfg6.runas.regras = [{ championId: 58, posicao: '*', paginas: [1696192448] }];
  c.expandir(); await espera();
  c.compactar(); c.expandir(); await espera();
  extras.push(['b4: regra virou 1 página no meio → 1 PUT só, sem popup, mesmo expandindo de novo',
    { puts: c.escritas().filter(x => x.startsWith('PUT')), popup: !!c.popup() }, x => x.puts.length === 1 && !x.popup]);

  // b4: a seleção acabou (fase saiu do ChampSelect) antes de expandir → nada
  c = client();
  api = iniciarRunas(c.context, { runas: { ligado: true, regras: regras2 } });
  await api.aoTravar(58, 'TOP');
  c.emitir('/lol-gameflow/v1/gameflow-phase', 'InProgress');
  c.expandir(); await espera();
  extras.push(['b4: seleção acabou antes de expandir → nenhum popup', { popup: !!c.popup() }, x => !x.popup]);

  // b3: aviso de página apagada vai para a camada à vista (não para o Toast, que pode ficar embaixo dela)
  c = client();
  api = iniciarRunas(c.context, { runas: { ligado: true, regras: regras2 } });
  r = await api.aoTravar(154, 'JUNGLE');
  extras.push(['b3: "página da regra não existe mais" com a camada à vista → aviso dentro do #lc-compacto, sem Toast',
    { r: r.acao, aviso: c.aviso(), toasts: c.toasts },
    x => /não existe mais/.test(x.aviso || '') && x.toasts.length === 0]);
  // decisão (ii): "runa X aplicada" não sai em dobro com o ✓ da tela 3 (nem camada nem Toast)
  extras.push(['b3: "runa aplicada" com a camada à vista não sai (o ✓ da tela 3 já diz)', { r: r.acao, toasts: c.toasts, avisos: c.camada.querySelectorAll('.lc-cp-aviso').map(a => a.textContent) },
    x => x.r === 'aplicou' && !x.toasts.some(([, m]) => /aplicada/.test(m)) && !x.avisos.some(m => /aplicada/.test(m))]);
  // client normal: os mesmos avisos seguem no Toast
  c = client({ compacto: false });
  api = iniciarRunas(c.context, { runas: { ligado: true, regras: regras2 } });
  await api.aoTravar(154, 'JUNGLE');
  extras.push(['b3: client normal: "não existe mais" e "runa aplicada" seguem no Toast', { toasts: c.toasts },
    x => x.toasts.some(([t, m]) => t === 'erro' && /não existe mais/.test(m)) && x.toasts.some(([t, m]) => t === 'ok' && /aplicada/.test(m))]);
  // "tua runa atual é a de X" (sem regra) com a camada à vista: na camada
  c = client({ atual: 1540029809 });
  const r3 = await iniciarRunas(c.context, { runas: { ligado: true, regras: [regras2[1]] } }).aoTravar(103, 'MIDDLE');
  extras.push(['b3: "tua runa atual é a de Zac" com a camada à vista → na camada', { r: r3.acao, aviso: c.aviso(), toasts: c.toasts },
    // o catálogo de nomes do runas.js é do módulo (o 1º caso carregou só o Renekton): Zac ou o id
    x => x.r === 'avisou' && /runa atual é a de (Zac|154)/.test(x.aviso || '') && x.toasts.length === 0]);
  Object.assign(globalThis, antes);
}

let ok = 0;
for (const [nome, r, conf] of casos) { const passou = conf(r); ok += passou; console.log(passou ? 'ok' : 'FALHOU', nome, JSON.stringify(r)); }
let okx = 0;
for (const [nome, r, conf] of extras) { const passou = conf(r); okx += passou; console.log(passou ? 'ok' : 'FALHOU', '(extra)', nome, JSON.stringify(r)); }
console.log(`${ok}/${casos.length} ok` + (okx === extras.length ? '' : ` | extras FALHOU ${okx}/${extras.length}`));
process.exit(ok === casos.length && okx === extras.length ? 0 : 1);
