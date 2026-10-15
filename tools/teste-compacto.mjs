// Testa a base do client compacto (pengu/compacto/: modo.js, index.js, comum.js + chave compacto do config.js) sem o
// client: riotInvoke falso (grava os pedidos), DOM mínimo feito aqui, telas falsas e LCU falsa. Prova do plano
// roadmap/2026-10-13-client-compacto.md, passos 2 e 3: alternar volta ao estado inicial; ResizeTo 420×640 e
// 1280×720 (+ CenterToScreen); roteador nas 13 fases; ReadyCheck cede ao aceite; Reconnect expande; modal
// desconhecido expande; erro numa tela expande. uso: node tools/teste-compacto.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relatar, lcuFalsa } from './lcu-falsa.mjs';
import { criarJanela, invocadorRiot, criarCamada, criarBotaoModo, criarArrasto, ehAtalho, tamanho, CSS_MODO, GRACA_MEDIDA_MS } from '../pengu/compacto/modo.js';
import { criarRoteador, destinoDaFase, infoDaSessao, classificarCamada, criarVigiaModais, FASES, CLASSE, ESPERA_SESSAO_MS, TELAS, CONTAGEM_MS, MODAL_RC_MS, expandirAntes } from '../pengu/compacto/index.js';
import { esc, h, avisar, lcu, campeoes, iconeCampeao, _zerarCatalogo, CSS_BASE } from '../pengu/compacto/comum.js';

// ---------- DOM mínimo ----------
class Classes {
  constructor(el) { this.s = new Set(); this.el = el; }
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
    this.classList = new Classes(this); this.dataset = {}; this.attrs = new Map(); this.ouvintes = {}; this.id = '';
    const est = {}; est.setProperty = (k, v) => { est[k] = v; }; this.style = est;
    this.offsetWidth = 0; this.offsetLeft = 0;
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { if (k === 'id') this.id = String(v); else if (k === 'class') this.className = v; else this.attrs.set(k, String(v)); }
  getAttribute(k) { return k === 'id' ? this.id : this.attrs.get(k) ?? null; }
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
  click() { this.disparar('click'); }
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
  querySelector(sel) { const s = String(sel).trim(); for (const n of this.desc()) if (n.matches(s.startsWith('#') ? s : s)) return n; return null; }
  querySelectorAll(sel) { return [...this.desc()].filter(n => n.matches(sel)); }
}
function novoDoc() {
  const doc = { listeners: {} };
  doc.createElement = tag => new El(tag, doc);
  doc.documentElement = new El('html', doc);
  doc.head = new El('head', doc); doc.body = new El('body', doc);
  doc.documentElement.append(doc.head, doc.body);
  doc.getElementById = id => { for (const n of doc.documentElement.desc()) if (n.id === id) return n; return null; };
  doc.querySelector = sel => doc.documentElement.querySelector(sel);
  doc.querySelectorAll = sel => doc.documentElement.querySelectorAll(sel);
  doc.addEventListener = () => {};
  return doc;
}

// ---------- relógio falso (agendar/limpar/repetir) ----------
function relogio() {
  let agora = 0, prox = 1;
  const fila = new Map(); // id -> {em, fn, cada}
  return {
    agendar: (fn, ms = 0) => { const id = prox++; fila.set(id, { em: agora + ms, fn }); return id; },
    limpar: id => { fila.delete(id); },
    repetir: (fn, ms) => { const id = prox++; fila.set(id, { em: agora + ms, fn, cada: ms }); return id; },
    avancar(ms) {
      const fim = agora + ms;
      for (;;) {
        const [id, t] = [...fila].filter(([, t]) => t.em <= fim).sort((a, b) => a[1].em - b[1].em)[0] || [];
        if (!id) break;
        agora = t.em;
        if (t.cada) t.em += t.cada; else fila.delete(id);
        t.fn();
      }
      agora = fim;
    },
    pendentes: () => fila.size,
    agoraMs: () => agora,
  };
}
const tick = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

// ---------- telas falsas ----------
function telaFalsa(nome, { lancar = false, rejeitar = false, comAtualizar = false } = {}) {
  const t = {
    montadas: 0, desmontadas: 0, atualizadas: 0, ctx: null, raiz: null,
    montar(raiz, ctx) {
      t.montadas++; t.ctx = ctx; t.raiz = raiz;
      if (lancar) throw new Error(`quebrei a ${nome}`);
      raiz.append(h('div', { doc: raiz.doc, class: 'conteudo' }, `tela ${nome}`));
      ctx.titulo.append(`título ${nome}`);
      if (rejeitar) return Promise.reject(new Error(`rejeitei a ${nome}`));
      return undefined;
    },
    desmontar() { t.desmontadas++; },
  };
  if (comAtualizar) t.atualizar = () => { t.atualizadas++; };
  return t;
}

function cenario({ cfg: cfgOver = {}, telas, larguraInicial = 1280, alturaInicial = 720, modal = null, contagemNaTela } = {}) {
  const cfg = { compacto: { ligado: true, inicioCompacto: true, favoritos: [58, 154], larg: 420, alt: 640 }, aceite: { ligado: true }, ...cfgOver };
  const pedidos = [];
  // como o client: o ResizeTo muda a largura que a página mede
  const win = { innerWidth: larguraInicial, innerHeight: alturaInicial, riotInvoke: arg => { const p = JSON.parse(arg.request); pedidos.push(p); if (p.name === 'Window.ResizeTo') [win.innerWidth, win.innerHeight] = p.params; } };
  const invocar = invocadorRiot(win, () => {});
  const rel = relogio();
  const janela = criarJanela({ invocar, medir: () => [win.innerWidth, win.innerHeight], agora: rel.agoraMs });
  const doc = novoDoc();
  const avisos = [], logs = [], subs = new Map(), aplicados = [];
  const ts = telas ?? { lobby: telaFalsa('lobby', { comAtualizar: true }), fila: telaFalsa('fila', { comAtualizar: true }), champselect: telaFalsa('champselect'),
    posjogo: telaFalsa('posjogo', { comAtualizar: true }), honra: telaFalsa('honra') };
  const s = { cfg, pedidos, doc, rel, avisos, logs, subs, telas: ts, modal, aplicados, win };
  const camada = criarCamada({ doc, aoExpandir: () => s.rot.expandir(), aoMinimizar: () => janela.minimizar(), aoFechar: () => janela.sair(),
    avisoFechar: () => (s.rot.estado().fase === 'ChampSelect' ? 'fechar agora é dodge' : 'fechar o client?') });
  s.rot = criarRoteador({
    cfg, janela, camada,
    carregarTela: async nome => { if (ts[nome]) return ts[nome]; throw new Error('404 ' + nome); },
    avisar: (m, e) => avisos.push([m, !!e]), log: (...a) => logs.push(a.join(' ')),
    assinar: (uri, cb) => subs.set(uri, cb),
    classe: on => doc.documentElement.classList.toggle(CLASSE, on),
    modalAberto: () => s.modal,
    aceiteManual: () => doc.documentElement.classList.contains('lc-aceite-manual'),
    aoAplicar: e => aplicados.push(e.efetivo), contagemNaTela,
    agendar: rel.agendar, limpar: rel.limpar, repetir: rel.repetir, pararRepetir: rel.limpar, agora: rel.agoraMs,
  });
  s.janela = janela;
  s.foto = () => ({ efetivo: s.rot.estado().efetivo, tela: s.rot.estado().tela, janelaCompacta: janela.ehCompacta(),
    camada: !!doc.getElementById('lc-compacto'), classe: doc.documentElement.classList.contains(CLASSE) });
  s.nomes = () => pedidos.map(p => `${p.name}${p.params.length ? ' ' + p.params.join('x') : ''}`);
  s.ir = async (fase, sessao) => { s.rot.aoFase(fase); if (sessao) s.rot.aoSessao(sessao); await tick(); };
  return s;
}
const sessao = (fila, mapa = 11, custom = false) => ({ gameData: { queue: { id: fila, mapId: mapa }, isCustomGame: custom }, map: { id: mapa } });
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);

// ---------- 1. config ----------
{
  globalThis.document = novoDoc();
  let salvo = null;
  globalThis.DataStore = { get: k => (k === 'lol-client.config' ? salvo : null), set: (k, v) => { if (k === 'lol-client.config') salvo = JSON.parse(JSON.stringify(v)); } };
  const { carregar, classes, PADRAO } = await import('../pengu/config.js');
  const c1 = JSON.parse(JSON.stringify(carregar()));
  // passo 13 (14/10/2026): chatLateral e conversaSozinha entram ligados (A1 e decisão 1 do Gabriel)
  caso('config: padrão compacto {ligado, inicioCompacto, favoritos [58,154], 420×680, chatLateral, conversaSozinha}',
    igual(c1.compacto, { ligado: true, inicioCompacto: true, favoritos: [58, 154], larg: 420, alt: 680, chatLateral: true, conversaSozinha: true }), JSON.stringify(c1.compacto));
  // 14/10/2026: barra de rolagem na tela 3 com 640. A config salva do Gabriel tem 640 (o padrão antigo; não há campo nas
  // Configurações): sem migração, o padrão novo nunca chegava nele
  salvo = { versao: 3, compacto: { ligado: true, inicioCompacto: true, favoritos: [58, 154], larg: 420, alt: 640 } };
  const cAlt = JSON.parse(JSON.stringify(carregar()));
  salvo = { versao: 3, compacto: { larg: 420, alt: 720 } };
  const cAlt2 = JSON.parse(JSON.stringify(carregar()));
  caso('config: alt 640 salvo (padrão antigo) vira 680; outro valor salvo fica', cAlt.compacto.alt === 680 && cAlt2.compacto.alt === 720, `${cAlt.compacto.alt} ${cAlt2.compacto.alt}`);
  salvo = { versao: 3, filaRapida: { fila: 440 } };
  const c2 = JSON.parse(JSON.stringify(carregar()));
  caso('config: salva antes da chave ganha o padrão do compacto e segue na versao 3', c2.compacto.ligado && c2.compacto.inicioCompacto && c2.versao === 3 && c2.filaRapida.fila === 440);
  salvo = { versao: 3, compacto: { inicioCompacto: false, favoritos: [] , larg: 'x' } };
  const c3 = JSON.parse(JSON.stringify(carregar()));
  caso('config: escolha salva fica (inicioCompacto false, favoritos vazio); tipo torto volta ao padrão',
    c3.compacto.inicioCompacto === false && igual(c3.compacto.favoritos, []) && c3.compacto.larg === 420 && c3.compacto.ligado === true);
  const cl = classes();
  caso('config: classes lc-compacto e lc-inicio-compacto, sem lc-modo-compacto (é do roteador)',
    cl.some(([k]) => k === 'lc-compacto') && cl.some(([k]) => k === 'lc-inicio-compacto') && !cl.some(([k]) => k === CLASSE) && new Set(cl.map(([k]) => k)).size === cl.length);
  caso('config: PADRAO.compacto.favoritos é Renekton e Zac', igual(PADRAO.compacto.favoritos, [58, 154]));
}

// ---------- 2. destino de cada fase ----------
{
  const info = { lida: true, fila: 420, mapa: 11, custom: false, aceiteLigado: true, aceiteManual: false };
  const esperado = {
    None: 'tela:lobby', Lobby: 'tela:lobby', Matchmaking: 'tela:fila', ReadyCheck: 'tela:fila', ChampSelect: 'tela:champselect',
    GameStart: 'jogo:', InProgress: 'jogo:', Reconnect: 'expandir:', FailedToLaunch: 'expandir:', TerminatedInError: 'expandir:',
    // PreEndOfGame sem a etapa lida espera (passo 12: a honra é compacta, as celebrações expandem; ver os casos abaixo)
    WaitingForStats: 'tela:posjogo', PreEndOfGame: 'esperar:', EndOfGame: 'tela:posjogo',
  };
  const obtido = Object.fromEntries(FASES.map(f => { const d = destinoDaFase(f, info); return [f, `${d.tipo}:${d.tela || ''}`]; }));
  caso('destino: as 13 fases têm destino esperado', FASES.length === 13 && igual(obtido, esperado), JSON.stringify(obtido));
  const pre = o => { const d = destinoDaFase('PreEndOfGame', { ...info, ...o }); return `${d.tipo}:${d.tela || ''}`; };
  caso('destino PreEndOfGame (passo 12): honor-vote = tela honra; etapa não lida espera e, esgotada, expande',
    pre({ seq: 'honor-vote' }) === 'tela:honra' && pre({}) === 'esperar:' && pre({ seqEsgotou: true }) === 'expandir:', [pre({ seq: 'honor-vote' }), pre({}), pre({ seqEsgotou: true })].join(' '));
  caso('destino PreEndOfGame: celebração só expande depois de firme (vazia passa sem piscar a janela); "" espera, esgotado expande',
    pre({ seq: 'ranked-celebration' }) === 'esperar:' && pre({ seq: 'ranked-celebration', seqFirme: true }) === 'expandir:' && pre({ seq: '' }) === 'esperar:'
      && pre({ seq: '', seqEsgotou: true }) === 'expandir:');
  caso('destino: fase desconhecida e null expandem', destinoDaFase('Xyz').tipo === 'expandir' && destinoDaFase(null).tipo === 'expandir');
  caso('destino: ARAM (450, mapa 12) expande', destinoDaFase('ChampSelect', { ...info, fila: 450, mapa: 12 }).tipo === 'expandir');
  caso('destino: personalizada no SR vai para a tela 3', destinoDaFase('ChampSelect', { ...info, fila: 3100, custom: true }).tela === 'champselect');
  caso('destino: fila desconhecida no SR expande', destinoDaFase('ChampSelect', { ...info, fila: 490 }).tipo === 'expandir');
  caso('destino: seleção sem sessão lida espera', destinoDaFase('ChampSelect', { lida: false }).tipo === 'esperar');
  caso('destino: flex e normal (440, 400) vão para a tela 3', ['440', '400'].every(f => destinoDaFase('ChampSelect', { ...info, fila: Number(f) }).tela === 'champselect'));
  caso('destino: ReadyCheck com aceite desligado expande', destinoDaFase('ReadyCheck', { ...info, aceiteLigado: false }).tipo === 'expandir');
  caso('destino: ReadyCheck com o popup devolvido (aceite manual) expande', destinoDaFase('ReadyCheck', { ...info, aceiteManual: true }).tipo === 'expandir');
  caso('destino: ReadyCheck com o aceite.js quebrado no init (aceiteVivo false) expande; não sei (undefined) fica na tela da fila',
    destinoDaFase('ReadyCheck', { ...info, aceiteVivo: false }).tipo === 'expandir' && destinoDaFase('ReadyCheck', { ...info, aceiteVivo: undefined }).tela === 'fila');
  caso('infoDaSessao: fila, mapa e personalizada; sem sessão = nulos', igual(infoDaSessao(sessao(420)), { lida: true, fila: 420, mapa: 11, custom: false })
    && igual(infoDaSessao(null), { lida: true, fila: null, mapa: null, custom: false }));
}

// ---------- 3. janela (riotInvoke) ----------
{
  const pedidos = [];
  const j = criarJanela({ invocar: invocadorRiot({ riotInvoke: a => pedidos.push(JSON.parse(a.request)) }), medir: () => [1280, 720] });
  j.compactar(420, 640); j.expandir(); j.minimizar(); j.sair();
  caso('janela: ResizeTo 420×640; expandir = ResizeTo 1280×720 + CenterToScreen; – e ✕ da Riot',
    igual(pedidos, [{ name: 'Window.ResizeTo', params: [420, 640] }, { name: 'Window.ResizeTo', params: [1280, 720] },
      { name: 'Window.CenterToScreen', params: [] }, { name: 'Window.Minimize', params: [] }, { name: 'RiotClient.Exit', params: [] }]), JSON.stringify(pedidos));
  caso('janela: tamanho torto vira 420×680 (o padrão), fora do limite também', igual(tamanho('x', null), [420, 680]) && igual(tamanho(100, 5000), [420, 680]) && igual(tamanho(480, 700), [480, 700]));
  const sem = criarJanela({ invocar: invocadorRiot({}), medir: () => [1280, 720] });
  caso('janela: sem riotInvoke não está disponível e não finge que encolheu', !sem.disponivel() && sem.compactar(420, 640) === false && !sem.ehCompacta());
  caso('janela: boot com a janela pequena (recarga do plugin) conta como compacta', criarJanela({ invocar: invocadorRiot({}), medir: () => [420, 640] }).ehCompacta());
  let largura = 1280;
  const j2 = criarJanela({ invocar: invocadorRiot({ riotInvoke() {} }), medir: () => [largura, 720] });
  j2.expandir(); largura = 420; // encolheu por outro caminho depois de eu expandir
  caso('janela: medida pequena vence o "expandi por último" (na dúvida, expande)', j2.ehCompacta());
}

// ---------- 4. roteador ----------
{ // alternar ida e volta + ResizeTo
  const s = cenario();
  s.rot.marcarPronto();
  await s.ir('Lobby');
  const inicial = s.foto();
  caso('boot no Lobby: compacto, ResizeTo 420×640, camada e html.lc-modo-compacto, tela lobby montada',
    igual(inicial, { efetivo: 'compacto', tela: 'lobby', janelaCompacta: true, camada: true, classe: true }) && igual(s.nomes(), ['Window.ResizeTo 420x640'])
      && s.telas.lobby.montadas === 1 && s.telas.lobby.raiz.textContent === 'tela lobby', JSON.stringify([inicial, s.nomes()]));
  const camadaEl = s.doc.getElementById('lc-compacto');
  caso('camada: topo com expandir, – e ✕; título da tela no slot', !!camadaEl.querySelector('[data-a=expandir]') && !!camadaEl.querySelector('[data-a=minimizar]')
    && !!camadaEl.querySelector('[data-a=fechar]') && camadaEl.querySelector('.lc-cp-titulo').textContent === 'título lobby');
  s.rot.alternar();
  caso('alternar -> expandido: ResizeTo 1280×720 + CenterToScreen, camada e classe saem, tela desmontada',
    igual(s.foto(), { efetivo: 'expandido', tela: null, janelaCompacta: false, camada: false, classe: false })
      && igual(s.nomes().slice(1), ['Window.ResizeTo 1280x720', 'Window.CenterToScreen']) && s.telas.lobby.desmontadas === 1, JSON.stringify([s.foto(), s.nomes()]));
  s.rot.alternar();
  caso('alternar duas vezes volta ao estado inicial (ResizeTo 420×640 de novo, tela montada de novo)',
    igual(s.foto(), inicial) && s.nomes().at(-1) === 'Window.ResizeTo 420x640' && s.telas.lobby.montadas === 2, JSON.stringify(s.foto()));
  s.doc.getElementById('lc-compacto').querySelector('[data-a=expandir]').click();
  caso('botão expandir da camada leva ao client normal', s.foto().efetivo === 'expandido' && !s.foto().camada && s.nomes().at(-1) === 'Window.CenterToScreen');
  caso('aoAplicar avisa cada estado (o botão "modo compacto" segue o efetivo)', s.aplicados.includes('compacto') && s.aplicados.at(-1) === 'expandido');
}

{ // sequência das 13 fases
  const s = cenario();
  s.rot.marcarPronto();
  const passos = [
    ['None', null, 'compacto', 'lobby'], ['Lobby', null, 'compacto', 'lobby'], ['Matchmaking', null, 'compacto', 'fila'],
    ['ReadyCheck', null, 'compacto', 'fila'], ['ChampSelect', sessao(420), 'compacto', 'champselect'], ['GameStart', null, 'expandido', null],
    ['InProgress', null, 'expandido', null], ['Reconnect', null, 'expandido', null], ['FailedToLaunch', null, 'expandido', null],
    ['TerminatedInError', null, 'expandido', null], ['WaitingForStats', null, 'compacto', 'posjogo'], ['PreEndOfGame', null, 'compacto', 'honra'],
    ['EndOfGame', null, 'compacto', 'posjogo'],
  ];
  const erros = [];
  let antesRC = 0;
  for (const [fase, ses, efetivo, tela] of passos) {
    if (fase === 'ReadyCheck') antesRC = s.pedidos.length;
    await s.ir(fase, ses);
    if (fase === 'PreEndOfGame') { s.rot.aoSequencia('honor-vote'); await tick(); }
    const f = s.foto();
    const camadaOk = efetivo === 'compacto' ? f.camada && f.classe : !f.camada && !f.classe;
    if (f.efetivo !== efetivo || f.tela !== tela || !camadaOk) erros.push(`${fase}: ${JSON.stringify(f)}`);
    if (fase === 'ReadyCheck' && (s.pedidos.length !== antesRC || !f.janelaCompacta)) erros.push('ReadyCheck mexeu na janela');
    if (efetivo === 'expandido' && f.janelaCompacta) erros.push(`${fase}: janela ficou pequena`);
  }
  caso('roteador: as 13 fases em sequência levam ao destino esperado', !erros.length, erros.join(' | '));
  caso('None -> Lobby (mesma tela) chama atualizar, não remonta', s.telas.lobby.montadas === 1 && s.telas.lobby.atualizadas === 1);
  caso('WaitingForStats -> PreEndOfGame (honra) -> EndOfGame: honra monta uma vez, pós-jogo remonta depois dela',
    s.telas.posjogo.montadas === 2 && s.telas.honra.montadas === 1 && s.telas.honra.desmontadas === 1, JSON.stringify([s.telas.posjogo.montadas, s.telas.honra.montadas]));
  const z = Number(CSS_MODO.match(/#lc-compacto \{[^}]*z-index:(\d+)/)?.[1]);
  caso('camada com z-index 100000, abaixo do #lc-aceite (100002)', z === 100000 && z < 100002);
  caso('CSS: runas, selo e pós-jogo grande somem só com html.lc-modo-compacto', /html\.lc-modo-compacto #lc-runas, html\.lc-modo-compacto #lc-winrate, html\.lc-modo-compacto #lc-posjogo \{ display:none !important; \}/.test(CSS_MODO));
}

{ // fim de partida (passo 12): honra compacta, celebração firme expande, vazia não pisca, sem etapa lida expande
  const tamanhos = s => s.pedidos.filter(p => p.name === 'Window.ResizeTo').map(p => p.params.join('x'));
  const a = cenario(); a.rot.marcarPronto();
  await a.ir('WaitingForStats');
  a.rot.aoSequencia('honor-vote'); await tick(); // o evento da etapa pode chegar antes da fase
  await a.ir('PreEndOfGame');
  caso('honor-vote antes da fase: PreEndOfGame entra direto na honra compacta, sem expandir no meio',
    a.foto().tela === 'honra' && a.foto().efetivo === 'compacto' && !tamanhos(a).includes('1280x720'), JSON.stringify([a.foto(), tamanhos(a)]));
  a.rot.aoSequencia(''); await tick();
  a.rot.aoSequencia('challenge-level-up'); await tick();
  a.rel.avancar(300); await tick();
  a.rot.aoSequencia(''); await tick();
  a.rel.avancar(2000); await tick();
  caso('celebração vazia (300 ms) depois da honra: nada pisca (sem ResizeTo 1280)', !tamanhos(a).includes('1280x720') && a.foto().efetivo === 'compacto', JSON.stringify(tamanhos(a)));
  a.rot.aoSequencia('ranked-celebration'); await tick();
  a.rel.avancar(700); await tick();
  caso('celebração que fica (700 ms): expande (tela da Riot, regra de antes)', a.foto().efetivo === 'expandido' && tamanhos(a).at(-1) === '1280x720', JSON.stringify([a.foto(), tamanhos(a)]));
  await a.ir('EndOfGame');
  caso('EndOfGame depois da celebração expandida: volta ao compacto no pós-jogo', a.foto().efetivo === 'compacto' && a.foto().tela === 'posjogo', JSON.stringify(a.foto()));

  const b = cenario(); b.rot.marcarPronto();
  await b.ir('WaitingForStats'); await b.ir('PreEndOfGame');
  caso('PreEndOfGame sem etapa lida: espera (fica no carregando do pós-jogo)', b.foto().tela === 'posjogo' && b.foto().efetivo === 'compacto');
  b.rel.avancar(2100); await tick();
  caso('PreEndOfGame sem etapa em 2 s: expande (o comportamento de antes do passo 12)', b.foto().efetivo === 'expandido' && b.rot.estado().destino?.tipo === 'expandir', JSON.stringify(b.foto()));
  b.rot.aoSequencia('honor-vote'); await tick();
  caso('etapa honor-vote chega tarde: a honra compacta monta', b.foto().efetivo === 'compacto' && b.foto().tela === 'honra', JSON.stringify(b.foto()));
  b.rot.expandir(); await tick();
  caso('"⤢ expandir" na honra vale até o EndOfGame (outra tela): o pós-jogo volta compacto', b.foto().efetivo === 'expandido');
  await b.ir('EndOfGame');
  caso('EndOfGame depois do expandir na honra: pós-jogo compacto', b.foto().efetivo === 'compacto' && b.foto().tela === 'posjogo', JSON.stringify(b.foto()));
  await b.ir('Lobby');
  b.rot.aoSequencia('honor-vote'); await tick();
  caso('etapa fora do fim de partida não mexe (Lobby segue no lobby)', b.foto().tela === 'lobby' && b.rot.estado().fase === 'Lobby');

  // "" parado (revisão de 14/10/2026: sem prazo, a tela ficava presa no PreEndOfGame escondendo o que a Riot abrisse)
  const c = cenario(); c.rot.marcarPronto();
  await c.ir('WaitingForStats'); await c.ir('PreEndOfGame');
  c.rot.aoSequencia(''); await tick(); // a Riot pulou a honra (personalizada sem honra, conta sem ballot)
  c.rel.avancar(1500); await tick();
  caso('"" na entrada (sem honra): espera como "não lida" (1,5 s no carregando do pós-jogo)', c.foto().efetivo === 'compacto' && c.foto().tela === 'posjogo', JSON.stringify(c.foto()));
  c.rel.avancar(600); await tick();
  caso('"" na entrada parado 2 s: expande (tela da Riot)', c.foto().efetivo === 'expandido' && c.rot.estado().destino?.tipo === 'expandir', JSON.stringify(c.foto()));

  const d = cenario(); d.rot.marcarPronto();
  await d.ir('WaitingForStats'); await d.ir('PreEndOfGame');
  d.rot.aoSequencia('honor-vote'); await tick();
  d.rel.avancar(10000); await tick();
  d.rot.aoSequencia(''); await tick();
  d.rel.avancar(3000); await tick();
  caso('"" depois da honra: 3 s segue na honra (a Riot troca em < 1 s)', d.foto().efetivo === 'compacto' && d.foto().tela === 'honra', JSON.stringify(d.foto()));
  d.rel.avancar(1100); await tick();
  caso('"" depois da honra parado 4 s: expande (nada da Riot fica escondido embaixo)', d.foto().efetivo === 'expandido', JSON.stringify(d.foto()));
  await d.ir('EndOfGame');
  caso('EndOfGame depois do "" esgotado: pós-jogo compacto', d.foto().efetivo === 'compacto' && d.foto().tela === 'posjogo');

  const e = cenario(); e.rot.marcarPronto();
  await e.ir('WaitingForStats'); await e.ir('PreEndOfGame');
  e.rot.aoSequencia('honor-vote'); await tick();
  e.rot.aoSequencia(''); await tick();
  e.rel.avancar(800); await tick();
  await e.ir('EndOfGame');
  caso('"" depois da honra e EndOfGame em 0,8 s: honra -> pós-jogo sem piscar 1280', e.foto().tela === 'posjogo' && e.foto().efetivo === 'compacto'
    && !tamanhos(e).includes('1280x720'), JSON.stringify(tamanhos(e)));
}

{ // ReadyCheck cede ao aceite; aceite desligado / manual expandem
  const s = cenario();
  s.rot.marcarPronto();
  await s.ir('Matchmaking');
  await s.ir('ReadyCheck');
  caso('ReadyCheck com aceite ligado: camada fica (tela da fila), janela pequena (o #lc-aceite fica por cima)', igual(s.foto(), { efetivo: 'compacto', tela: 'fila', janelaCompacta: true, camada: true, classe: true }));
  s.doc.documentElement.classList.add('lc-aceite-manual');
  s.rot.reavaliar();
  caso('ReadyCheck com o popup da Riot de volta (lc-aceite-manual): expande', s.foto().efetivo === 'expandido' && !s.foto().janelaCompacta && s.nomes().includes('Window.CenterToScreen'));
  s.doc.documentElement.classList.remove('lc-aceite-manual');
  await s.ir('ChampSelect', sessao(420));
  caso('depois do ReadyCheck expandido, a seleção volta ao compacto', s.foto().efetivo === 'compacto' && s.foto().tela === 'champselect' && s.foto().janelaCompacta);
  const s2 = cenario({ cfg: { aceite: { ligado: false } } });
  s2.rot.marcarPronto();
  await s2.ir('Matchmaking');
  await s2.ir('ReadyCheck');
  caso('ReadyCheck com aceite automático desligado: expande (o botão da Riot fica à mão)', s2.foto().efetivo === 'expandido' && !s2.foto().janelaCompacta && !s2.foto().camada);
}

{ // ranqueada de 14/10/2026 14:43: ready check aceito, outro jogador não aceitou (volta a Matchmaking ~2 s), 2º ready
  // check, seleção. O Gabriel viu a tela da Riot (1280, cortada) dentro da janela pequena do 1º ready check até a seleção.
  // LeagueClientUx.log daquela carga: só 2 linhas "ceder: ready check" e nada entre elas.
  const s = cenario();
  s.rot.marcarPronto();
  const passos = [];
  for (const [fase, ses] of [['Matchmaking'], ['ReadyCheck'], ['Matchmaking'], ['ReadyCheck'], ['ChampSelect', sessao(420)]]) {
    const antes = s.pedidos.length;
    await s.ir(fase, ses);
    passos.push({ fase, ...s.foto(), mexeuJanela: s.pedidos.length !== antes });
  }
  const rcs = passos.filter(p => p.fase === 'ReadyCheck');
  caso('14/10 14:43: no ready check a camada fica de pé na janela pequena (tela da fila por baixo do #lc-aceite), sem mexer na janela',
    rcs.length === 2 && rcs.every(p => p.efetivo === 'compacto' && p.tela === 'fila' && p.camada && p.classe && p.janelaCompacta && !p.mexeuJanela),
    JSON.stringify(passos) + ' logs=' + JSON.stringify(s.logs));
  caso('14/10 14:43: a volta a Matchmaking mostra a tela da fila; a seleção monta a tela 3',
    passos[2].efetivo === 'compacto' && passos[2].tela === 'fila' && passos[2].camada && passos[4].tela === 'champselect' && passos[4].camada,
    JSON.stringify(passos));
  caso('14/10 14:43: a fila não remonta entre Matchmaking e ReadyCheck (mesma tela, atualizar)', s.telas.fila.montadas === 1, `montadas=${s.telas.fila.montadas}`);
  {
    // com a camada no ready check o popup da Riot fica embaixo dela: se a contagem do aceite.js (#lc-aceite) não aparecer
    // (o JS do aceite não agiu, como em 14/10 10:10), ele ficaria sem botão. Sem contagem em 1,5 s = expande (popup da Riot)
    let contagem = false;
    const c = cenario({ contagemNaTela: () => contagem });
    c.rot.marcarPronto(); await c.ir('Matchmaking'); await c.ir('ReadyCheck');
    const cedo = c.foto();
    c.rel.avancar(CONTAGEM_MS + 100); await tick();
    caso('ready check sem a contagem do aceite: fila por 1,5 s, depois expande (popup da Riot à mão)',
      cedo.efetivo === 'compacto' && cedo.tela === 'fila' && c.foto().efetivo === 'expandido' && !c.foto().janelaCompacta, JSON.stringify([cedo, c.foto()]));
    await c.ir('ChampSelect', sessao(420));
    caso('ready check sem contagem: a seleção volta ao compacto', c.foto().efetivo === 'compacto' && c.foto().tela === 'champselect');
    contagem = true;
    const d = cenario({ contagemNaTela: () => contagem });
    d.rot.marcarPronto(); await d.ir('Matchmaking'); await d.ir('ReadyCheck');
    d.rel.avancar(500); await tick();
    contagem = false; // o aceite.js tira a contagem depois de aceitar (esperando os outros)
    d.rel.avancar(CONTAGEM_MS + 100); await tick();
    caso('ready check com a contagem vista: ela sumir depois (aceitou, esperando os outros) não expande',
      d.foto().efetivo === 'compacto' && d.foto().tela === 'fila', JSON.stringify(d.foto()));
  }
  {
    // altura nova (680) com o plugin recarregado e a janela ainda nos 420×640 de antes: encolher "já pequena" não bastava
    const a = cenario({ larguraInicial: 420, alturaInicial: 640, cfg: { compacto: { ligado: true, inicioCompacto: true, larg: 420, alt: 680 }, aceite: { ligado: true } } });
    a.rot.marcarPronto(); await a.ir('Lobby');
    const b = cenario({ larguraInicial: 420, alturaInicial: 680, cfg: { compacto: { ligado: true, inicioCompacto: true, larg: 420, alt: 680 }, aceite: { ligado: true } } });
    b.rot.marcarPronto(); await b.ir('Lobby'); await b.ir('Matchmaking'); await b.ir('ReadyCheck');
    caso('janela já pequena noutro tamanho (420×640) vira 420×680 na montagem; no tamanho certo nenhum ResizeTo',
      igual(a.nomes(), ['Window.ResizeTo 420x680']) && a.foto().efetivo === 'compacto' && b.nomes().length === 0 && b.foto().tela === 'fila', JSON.stringify([a.nomes(), b.nomes()]));
  }
  caso('14/10 14:43: cada montagem de tela compacta vai para o log (sem isso o LeagueClientUx.log não prova nada)',
    s.logs.filter(l => /^tela fila \(Matchmaking\)$/.test(l)).length === 1 && s.logs.some(l => /^tela champselect/.test(l)), JSON.stringify(s.logs));
  caso('14/10 14:43: a troca de fase sem remontar também vai ao log (ready check na fila, volta à busca)',
    s.logs.filter(l => l === 'tela fila (ReadyCheck): atualizada').length === 2 && s.logs.includes('tela fila (Matchmaking): atualizada'), JSON.stringify(s.logs));
}

{ // revisão de 14/10/2026: com o ready check na tela da fila, Matchmaking e ReadyCheck têm a mesma chave (tela:fila)
  // 1) "modal" no ready check (o .ready-check-root-element chega depois da folga da vigia): não expande no ato
  const a = cenario();
  a.rot.marcarPronto(); await a.ir('Matchmaking'); await a.ir('ReadyCheck');
  a.modal = null; // quando a conferência roda, o modal já tem o conteúdo do ready check (vigia.aberto() = null)
  a.rot.aoModal('modal');
  const noAto = a.foto().efetivo;
  a.rel.avancar(MODAL_RC_MS + 50); await tick();
  caso('ready check: "modal" que era o do próprio ready check não expande (confere de novo e some)',
    noAto === 'compacto' && a.foto().efetivo === 'compacto' && a.foto().tela === 'fila' && !a.avisos.length, JSON.stringify([noAto, a.foto(), a.avisos]));
  const b = cenario();
  b.rot.marcarPronto(); await b.ir('Matchmaking'); await b.ir('ReadyCheck');
  b.modal = 'modal'; // segue aberto e desconhecido
  b.rot.aoModal('modal');
  b.rel.avancar(MODAL_RC_MS + 50); await tick();
  caso('ready check: modal desconhecido que segue aberto expande depois da conferência',
    b.foto().efetivo === 'expandido' && b.avisos.some(([m]) => /janela própria/.test(m)), JSON.stringify(b.foto()));
  b.modal = null;
  await b.ir('Matchmaking');
  caso('o ready check expandido pela regra 7 não segue para a busca (outro não aceitou: a fila volta compacta)',
    b.foto().efetivo === 'compacto' && b.foto().tela === 'fila', JSON.stringify(b.rot.estado()));
  // 2) "⤢ expandir" no ready check vale só nele; o expandido na busca segue no ready check (não encolhe no aceite)
  const c = cenario();
  c.rot.marcarPronto(); await c.ir('Matchmaking'); await c.ir('ReadyCheck');
  c.rot.expandir();
  const rcExp = c.foto().efetivo;
  await c.ir('Matchmaking');
  const mmDepois = c.foto().efetivo;
  c.rot.expandir();
  await c.ir('ReadyCheck');
  caso('"⤢ expandir" no ready check não segue para a busca; expandido na busca segue expandido no ready check',
    rcExp === 'expandido' && mmDepois === 'compacto' && c.foto().efetivo === 'expandido', JSON.stringify([rcExp, mmDepois, c.foto()]));
  // 3) sem contagem em 1,5 s expande; ela chegar tarde não encolhe de novo no mesmo ready check
  let contagem = false;
  const d = cenario({ contagemNaTela: () => contagem });
  d.rot.marcarPronto(); await d.ir('Matchmaking'); await d.ir('ReadyCheck');
  d.rel.avancar(CONTAGEM_MS + 100); await tick();
  const exp = d.foto().efetivo;
  const pedidosAntes = d.pedidos.length;
  contagem = true; // o #lc-aceite entrou depois de 1,5 s
  d.rot.reavaliar();
  caso('ready check: contagem que chega depois de expandir não encolhe a janela embaixo do cursor',
    exp === 'expandido' && d.foto().efetivo === 'expandido' && d.pedidos.length === pedidosAntes, JSON.stringify([exp, d.foto(), d.nomes()]));
  contagem = false;
  await d.ir('Matchmaking');
  caso('ready check expandido por falta de contagem: a volta à busca é compacta', d.foto().efetivo === 'compacto' && d.foto().tela === 'fila');
}

{ // Reconnect
  const s = cenario();
  s.rot.marcarPronto();
  await s.ir('ChampSelect', sessao(420));
  await s.ir('Reconnect');
  caso('Reconnect: camada sai e o client volta ao normal (1280×720 centralizado)', igual(s.foto(), { efetivo: 'expandido', tela: null, janelaCompacta: false, camada: false, classe: false })
    && s.nomes().slice(-2).join() === 'Window.ResizeTo 1280x720,Window.CenterToScreen' && s.telas.champselect.desmontadas === 1);
  s.rot.compactar();
  caso('Reconnect: pedir o compacto não encolhe e avisa o motivo', s.foto().efetivo === 'expandido' && s.avisos.some(([m]) => /reconectar/.test(m)));
}

{ // boot da Riot tira a camada do <body> e põe uma cópia sem ouvintes (14/10/2026: "lendo o lobby" para sempre)
  const s = cenario();
  s.rot.marcarPronto();
  await s.ir('Lobby');
  const minha = s.doc.getElementById('lc-compacto');
  minha.remove();
  const copia = h('div', { doc: s.doc, id: 'lc-compacto' }, h('main', { doc: s.doc, class: 'lc-cp-corpo' }, 'lendo o lobby…'));
  s.doc.body.append(copia);
  s.rot.reavaliar();
  const vis = s.doc.getElementById('lc-compacto');
  const raizTela = s.telas.lobby.raiz;
  caso('camada trocada por cópia: remonta a tela na camada nova, a cópia sai e a tela pinta no que está à vista',
    s.telas.lobby.montadas === 2 && s.doc.querySelectorAll('#lc-compacto').length === 1 && vis !== copia && vis !== minha
      && raizTela.isConnected && !!vis.querySelector('[data-a=expandir]') && s.foto().efetivo === 'compacto'
      && igual(s.nomes(), ['Window.ResizeTo 420x640']),
    JSON.stringify({ montadas: s.telas.lobby.montadas, n: s.doc.querySelectorAll('#lc-compacto').length, nomes: s.nomes() }));
  s.rot.reavaliar();
  caso('camada já é a minha: reavaliar não remonta de novo', s.telas.lobby.montadas === 2);
}

{ // a Riot devolve a janela a 1280×720 com a camada de pé (restore do plugin-runner, ux-show do aceite.js) [S]
  const s = cenario();
  s.rot.marcarPronto();
  await s.ir('Lobby');
  // 1280×720 inteiro (desde a revisão de 14/10/2026 "devolvida" exige o formato 16:9 da Riot; só a largura não basta)
  s.win.innerWidth = 1280; s.win.innerHeight = 720; // logo depois do ResizeTo (dentro da folga): ainda conta como compacta, nada muda
  s.rot.reavaliar();
  const naFolga = s.nomes().length === 1;
  s.rel.avancar(GRACA_MEDIDA_MS + 10);
  s.rot.reavaliar();
  caso('Riot devolveu 1280 com a camada à vista: depois da folga encolhe de novo, sem remontar a tela',
    naFolga && igual(s.nomes(), ['Window.ResizeTo 420x640', 'Window.ResizeTo 420x640']) && s.telas.lobby.montadas === 1 && s.foto().efetivo === 'compacto', JSON.stringify(s.nomes()));
  for (let i = 0; i < 3; i++) { s.win.innerWidth = 1280; s.win.innerHeight = 720; s.rel.avancar(GRACA_MEDIDA_MS + 10); s.rot.reavaliar(); }
  caso('Riot insiste em 1280 (3 vezes em 10 s): desiste e fica no client normal, sem camada',
    s.foto().efetivo === 'expandido' && !s.foto().camada && !s.foto().classe && /tamanho normal sozinha/.test(s.rot.estado().motivo), JSON.stringify(s.rot.estado()));
  const j = criarJanela({ invocar: invocadorRiot({ riotInvoke() {} }), medir: () => [1280, 720], agora: () => 5000 });
  j.compactar(420, 640);
  caso('janela: medida grande dentro da folga do meu ResizeTo segue compacta (o innerWidth demora a acompanhar)', j.ehCompacta());
}

{ // modal desconhecido (regra 7)
  const s = cenario();
  s.rot.marcarPronto();
  await s.ir('Lobby');
  s.rot.aoModal('modal');
  caso('modal desconhecido no compacto: expande e avisa', s.foto().efetivo === 'expandido' && !s.foto().camada && s.avisos.some(([m]) => /janela própria/.test(m)));
  s.modal = 'modal';
  s.rot.alternar();
  caso('com o modal ainda aberto, pedir o compacto não encolhe', s.foto().efetivo === 'expandido' && s.avisos.at(-1)[0].includes('indisponível'));
  s.modal = null;
  s.rot.alternar();
  caso('modal fechou: o botão compacta de novo', s.foto().efetivo === 'compacto');
  await s.ir('Matchmaking');
  s.modal = 'vignette-celebration';
  await s.ir('Lobby');
  caso('entrar no compacto com celebração aberta: fica no normal', s.foto().efetivo === 'expandido' && /celebration/.test(s.rot.estado().motivo));
  // classificação das camadas do wrapper
  const doc = novoDoc();
  const mk = (tag, cls, filho) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (filho) e.append(filho); return e; };
  caso('classificar: .modal desconhecido, backdrop e celebração expandem', classificarCamada(mk('div', 'modal', mk('div', 'algo'))) === 'modal'
    && classificarCamada(mk('lol-uikit-full-page-backdrop', 'drawer-layer')) === 'lol-uikit-full-page-backdrop'
    && classificarCamada(mk('div', 'vignette-celebration')) === 'vignette-celebration');
  caso('classificar: ready check, tooltip, chat e toast não expandem',
    classificarCamada(mk('div', 'modal', mk('div', 'ready-check-root-element'))) === null
      && classificarCamada(mk('div', 'tooltip')) === null && classificarCamada(mk('lol-social-chat-window')) === null
      && classificarCamada(mk('div', 'dialog-toast')) === null && classificarCamada(null) === null);
  caso('classificar: Configurações da Riot expandem (com a camada à vista ficariam abertas e invisíveis atrás dela)',
    classificarCamada(mk('div', 'modal', mk('div', 'lol-settings-container'))) === 'modal');
  // vigia: wrapper com modal -> aoModal depois da folga
  const w = mk('div'); w.id = 'lol-uikit-layer-manager-wrapper';
  const mgr = mk('div'); mgr.id = 'lol-uikit-layer-manager'; mgr.append(w); doc.body.append(mgr);
  w.append(mk('lol-social-chat-window'));
  const rel = relogio(); const vistos = [];
  const vigia = criarVigiaModais({ doc, aoModal: d => vistos.push(d), agendar: rel.agendar, limpar: rel.limpar });
  vigia.conferir(); rel.avancar(300);
  const semNada = vistos.length === 0 && vigia.aberto() === null;
  w.append(mk('div', 'modal', mk('div', 'qualquer-coisa')));
  vigia.conferir(); rel.avancar(300);
  caso('vigia: só o chat no wrapper não dispara; modal novo dispara aoModal depois da folga', semNada && igual(vistos, ['modal']));
  const hist = vigia.historico();
  caso('vigia: histórico da medição guarda só tag e classes (sem o chat, sem texto)', hist.length === 1
    && igual(hist[0].camadas, [{ tag: 'div', classes: 'modal', filho: 'qualquer-coisa', expande: 'modal' }]), JSON.stringify(hist));
}
{ // vigia ligada ANTES de o uikit montar o #lol-uikit-layer-manager (ele nasce por JS, depois do DOMContentLoaded)
  const antesMO = globalThis.MutationObserver;
  const observadores = [];
  globalThis.MutationObserver = class { constructor(cb) { this.cb = cb; this.on = false; observadores.push(this); } observe(el, op) { this.el = el; this.op = op; this.on = true; } disconnect() { this.on = false; } };
  const disparar = () => { for (const o of [...observadores]) if (o.on) o.cb([{ addedNodes: [1] }]); };
  try {
    const doc = novoDoc();
    const mk = (tag, cls, filho) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (filho) e.append(filho); return e; };
    const rel = relogio(); const vistos = [];
    const vigia = criarVigiaModais({ doc, aoModal: d => vistos.push(d), agendar: rel.agendar, limpar: rel.limpar });
    vigia.ligar();
    const l0 = vigia.ligado();
    const mgr = mk('div'); mgr.id = 'lol-uikit-layer-manager';
    const w = mk('div'); w.id = 'lol-uikit-layer-manager-wrapper'; mgr.append(w); doc.body.append(mgr);
    disparar(); // o <body> vê o manager chegar
    const l1 = vigia.ligado();
    const corpoOn = observadores.filter(o => o.on && o.el === doc.body).length;
    w.append(mk('div', 'modal', mk('div', 'penalidade')));
    disparar(); rel.avancar(300);
    caso('vigia: ligada antes do manager existir, espera pelo <body>, liga no manager quando ele nasce e o modal novo expande',
      l0.esperando && !l0.manager && l1.manager && l1.wrapper && !l1.esperando && corpoOn === 0 && igual(vistos, ['modal']),
      JSON.stringify({ l0, l1, corpoOn, vistos }));
  } finally { globalThis.MutationObserver = antesMO; }
}

{ // erro numa tela
  const s = cenario({ telas: { lobby: telaFalsa('lobby'), fila: telaFalsa('fila', { lancar: true }), champselect: telaFalsa('champselect', { rejeitar: true }), posjogo: telaFalsa('posjogo') } });
  s.rot.marcarPronto();
  await s.ir('Lobby');
  await s.ir('Matchmaking');
  caso('tela que lança no montar: expande na hora e avisa', igual(s.foto(), { efetivo: 'expandido', tela: null, janelaCompacta: false, camada: false, classe: false })
    && s.avisos.some(([m, e]) => e && /falhou/.test(m)));
  await s.ir('ChampSelect', sessao(420));
  await tick();
  caso('tela que rejeita a promise do montar: expande', s.foto().efetivo === 'expandido' && !s.foto().janelaCompacta);
  await s.ir('EndOfGame');
  caso('erro vale até a virada: a fase seguinte tenta o compacto de novo', s.foto().efetivo === 'compacto' && s.foto().tela === 'posjogo');
  // erro depois de montada: clique (seguro), evento da LCU (observar) e timer (tempo)
  const ctx = s.telas.posjogo.ctx;
  ctx.seguro(() => { throw new Error('clique quebrou'); })();
  caso('erro num handler (ctx.seguro): expande', s.foto().efetivo === 'expandido' && /clique quebrou/.test(s.rot.estado().motivo));
}

{ // observar, tempo e intervalo morrem com a tela
  const s = cenario();
  s.rot.marcarPronto();
  await s.ir('Lobby');
  const ctx = s.telas.lobby.ctx;
  const recebidos = [];
  ctx.observar('/lol-lobby/v2/lobby', m => recebidos.push(m.data));
  let disparos = 0;
  ctx.tempo(() => disparos++, 1000);
  ctx.intervalo(() => disparos++, 500);
  s.subs.get('/lol-lobby/v2/lobby')({ data: 1 });
  s.rel.avancar(1000);
  const antes = [recebidos.length, disparos];
  await s.ir('Matchmaking');
  s.subs.get('/lol-lobby/v2/lobby')({ data: 2 });
  s.rel.avancar(5000);
  caso('ctx: evento, tempo e intervalo chegam com a tela montada e param ao desmontar', igual(antes, [1, 3]) && recebidos.length === 1 && disparos === 3 && !ctx.vivo(),
    JSON.stringify([antes, recebidos, disparos]));
  ctx.observar('/x', () => {});
  caso('ctx: observar depois de desmontada não assina nada', !s.subs.has('/x'));
  const ctxFila = s.telas.fila.ctx;
  ctxFila.observar('/lol-matchmaking/v1/search', () => { throw new Error('evento quebrou'); });
  s.subs.get('/lol-matchmaking/v1/search')({ data: {} });
  caso('erro no callback de evento (ctx.observar): expande', s.foto().efetivo === 'expandido');
}

{ // sem tela: não encolhe; janela pequena da recarga volta ao normal
  const s = cenario({ telas: {} });
  s.rot.marcarPronto();
  await s.ir('Lobby');
  caso('sem tela compacta da fase: nenhum ResizeTo (sem piscar), motivo registrado', s.pedidos.length === 0 && s.foto().efetivo === 'expandido' && /ainda não existe/.test(s.rot.estado().motivo));
  const s2 = cenario({ telas: {}, larguraInicial: 420 });
  s2.rot.marcarPronto();
  await s2.ir('Lobby');
  caso('recarga com a janela pequena e sem tela: volta a 1280×720 uma vez', igual(s2.nomes(), ['Window.ResizeTo 1280x720', 'Window.CenterToScreen']));
  const s3 = cenario();
  s3.rot.aoFase('Lobby'); await tick();
  caso('antes do DOM pronto (marcarPronto) nada acontece', s3.pedidos.length === 0 && !s3.foto().camada);
  const s5 = cenario({ larguraInicial: 420 });
  s5.rot.marcarPronto(); await tick();
  const quieto = s5.pedidos.length === 0;
  s5.rot.aoFase(null); await tick();
  caso('recarga com a janela pequena: nada muda até ler a fase; leitura que falhou de vez = client normal', quieto && s5.foto().efetivo === 'expandido' && !s5.foto().janelaCompacta);
  const s4 = cenario();
  s4.win.riotInvoke = undefined;
  s4.rot.marcarPronto(); await s4.ir('Lobby');
  caso('sem riotInvoke: fica no normal, sem camada', s4.foto().efetivo === 'expandido' && !s4.foto().camada);
}

{ // lembrar o modo por fase + padrão expandido + desligado
  const s = cenario();
  s.rot.marcarPronto();
  await s.ir('Lobby');
  s.rot.expandir();
  await s.ir('None'); // mesma tela: segue expandido
  const meio = s.foto().efetivo;
  await s.ir('Matchmaking');
  caso('expandir manual vale até a virada de tela; a fase seguinte volta ao compacto (padrão)', meio === 'expandido' && s.foto().efetivo === 'compacto' && s.foto().tela === 'fila');
  const s2 = cenario({ cfg: { compacto: { ligado: true, inicioCompacto: false, larg: 420, alt: 640 } } });
  s2.rot.marcarPronto();
  await s2.ir('Lobby');
  const a = s2.foto().efetivo, pa = s2.pedidos.length;
  s2.rot.compactar(); await tick();
  const b = s2.foto().efetivo;
  await s2.ir('Matchmaking');
  caso('padrão expandido: Lobby normal sem ResizeTo; botão compacta; fase seguinte volta ao normal', a === 'expandido' && pa === 0 && b === 'compacto' && s2.foto().efetivo === 'expandido');
  const s3 = cenario();
  s3.rot.marcarPronto();
  await s3.ir('Lobby');
  s3.cfg.compacto.ligado = false;
  s3.rot.sincronizar();
  caso('desligar na config: camada sai e a janela volta ao normal na hora', igual(s3.foto(), { efetivo: 'expandido', tela: null, janelaCompacta: false, camada: false, classe: false }));
  s3.rot.alternar();
  caso('desligado: atalho não compacta e avisa', s3.foto().efetivo === 'expandido' && /desligado/.test(s3.avisos.at(-1)[0]));
}

{ // champ select: sessão atrasada, ARAM, personalizada
  const s = cenario();
  s.rot.marcarPronto();
  await s.ir('Matchmaking');
  await s.ir('ReadyCheck');
  const antes = s.pedidos.length;
  await s.ir('ChampSelect');
  const esperando = s.foto().efetivo === 'compacto' && s.foto().tela === 'fila' && s.pedidos.length === antes;
  s.rel.avancar(ESPERA_SESSAO_MS + 10);
  caso('seleção sem a sessão do gameflow: espera na tela da fila sem mexer na janela e expande depois de 2 s', esperando && s.foto().efetivo === 'expandido' && !s.foto().janelaCompacta);
  const s2 = cenario();
  s2.rot.marcarPronto();
  await s2.ir('Lobby');
  await s2.ir('ChampSelect', sessao(450, 12));
  caso('seleção do ARAM: expande (tela da Riot)', s2.foto().efetivo === 'expandido' && !s2.foto().camada);
  const s3 = cenario();
  s3.rot.marcarPronto();
  await s3.ir('Lobby', sessao(450, 12)); // sessão velha de ARAM
  await s3.ir('ChampSelect', sessao(3100, 11, true));
  caso('personalizada no SR: tela 3 (sessão nova vence a velha)', s3.foto().tela === 'champselect');
}

// ---------- 5. atalho, botão "modo compacto", ✕ com confirmação ----------
caso('atalho: Ctrl+Shift+M (key e code) sim; Ctrl+M, Ctrl+Shift+K e Ctrl+Alt+Shift+M não',
  ehAtalho({ ctrlKey: true, shiftKey: true, key: 'M' }) && ehAtalho({ ctrlKey: true, shiftKey: true, code: 'KeyM', key: 'µ' })
    && !ehAtalho({ ctrlKey: true, key: 'm' }) && !ehAtalho({ ctrlKey: true, shiftKey: true, key: 'K' }) && !ehAtalho({ ctrlKey: true, shiftKey: true, altKey: true, key: 'm' }) && !ehAtalho(null));
{
  const doc = novoDoc();
  const nav = doc.createElement('div'); nav.className = 'navbar_backdrop'; doc.body.append(nav);
  const fila = doc.createElement('div'); fila.id = 'lc-fila-rapida'; fila.offsetLeft = 251; fila.offsetWidth = 111; nav.append(fila);
  let cliques = 0;
  const b = criarBotaoModo({ doc, aoClicar: () => cliques++ });
  b.sincronizar(true);
  const el = doc.getElementById('lc-botao-compacto');
  el?.click();
  caso('botão "▣ modo compacto" no topo, logo depois da fila rápida (368 px), e o clique compacta',
    el && el.parentNode === nav && el.textContent === '▣ modo compacto' && el.style.left === '368px' && cliques === 1
      && doc.documentElement.classList.contains('lc-botao-compacto') && doc.documentElement.style['--lc-cp-nav'] === `${368 + 140 + 8 - 253}px`, JSON.stringify(el?.style));
  b.sincronizar(false);
  caso('botão some quando a camada está à vista (ou o compacto desligado)', !doc.getElementById('lc-botao-compacto') && !doc.documentElement.classList.contains('lc-botao-compacto'));
  fila.remove();
  b.sincronizar(true);
  caso('sem fila rápida o botão ocupa o lugar dela (250 px)', doc.getElementById('lc-botao-compacto').style.left === '250px');
  // seleção de campeões no client normal: a barra da Riot não aparece; o botão flutua (senão não havia volta)
  b.sincronizar(true, { flutuante: true });
  const fl = doc.getElementById('lc-botao-compacto');
  fl?.click();
  caso('botão flutuante (ChampSelect): no <body>, classe lc-cp-flutua, barra da Riot sem deslocamento, clique compacta',
    fl && fl.parentNode === doc.body && fl.classList.contains('lc-cp-flutua') && !doc.documentElement.classList.contains('lc-botao-compacto') && cliques === 2);
  b.sincronizar(true, { flutuante: false });
  caso('fora da seleção o botão volta para a barra', doc.getElementById('lc-botao-compacto')?.parentNode === nav && doc.documentElement.classList.contains('lc-botao-compacto'));
  nav.remove();
  b.sincronizar(true);
  caso('sem a .navbar_backdrop (tela da Riot sem barra): botão flutuante', doc.getElementById('lc-botao-compacto')?.parentNode === doc.body);
  caso('CSS: botão flutuante fixo no alto à direita', /#lc-botao-compacto\.lc-cp-flutua \{ position:fixed;[^}]*right:96px; top:4px/.test(CSS_MODO));
}
{ // arrastar a janela compacta pelo topo (Window.MoveTo)
  const movs = []; let quadro = null;
  const a = criarArrasto({ posicao: () => [400, 100], mover: (x, y) => movs.push([x, y]), limites: () => ({ minX: -300, maxX: 2440, minY: 0, maxY: 1380 }), raf: fn => { quadro = fn; } });
  const botao = { closest: sel => (/button/.test(sel) ? botao : null) };
  const noBotao = a.down({ button: 0, screenX: 500, screenY: 120, target: botao }) === false && !a.ativo();
  a.down({ button: 0, screenX: 500, screenY: 120, target: { closest: () => null } });
  a.move({ screenX: 560, screenY: 90 }); a.move({ screenX: 580, screenY: 80 }); quadro();
  a.move({ screenX: 9000, screenY: -500 }); quadro();
  a.up(); quadro = null; a.move({ screenX: 0, screenY: 0 });
  const doc = novoDoc();
  criarCamada({ doc, arrasto: a }).montar();
  const topo = doc.getElementById('lc-compacto').querySelector('header');
  caso('arrastar: clique em botão do topo não arrasta; posição = janela + quanto o ponteiro andou (1 MoveTo por quadro), presa nos limites; soltou, parou',
    noBotao && igual(movs, [[480, 60], [2440, 0]]) && !a.ativo() && quadro === null && !!topo.ouvintes.pointerdown && topo.classList.contains('lc-cp-arrasta'), JSON.stringify(movs));
  const pedidos = [];
  criarJanela({ invocar: invocadorRiot({ riotInvoke: r => pedidos.push(JSON.parse(r.request)) }) }).mover(480.4, 60);
  caso('janela.mover = Window.MoveTo [x, y] inteiros', igual(pedidos, [{ name: 'Window.MoveTo', params: [480, 60] }]));
}
caso('CSS: aviso da camada logo abaixo do topo e sem pegar clique (TRAVAR/BANIR/JOGAR ficam embaixo)',
  /\.lc-cp-aviso \{[^}]*top:52px;[^}]*pointer-events:none;/.test(CSS_BASE) && !/\.lc-cp-aviso \{[^}]*bottom:10px/.test(CSS_BASE));
{
  const s = cenario();
  s.rot.marcarPronto();
  await s.ir('ChampSelect', sessao(420));
  const cam = s.doc.getElementById('lc-compacto');
  cam.querySelector('[data-a=fechar]').click();
  const alerta = cam.querySelector('.lc-cp-alerta');
  const textoOk = alerta && /dodge/.test(alerta.textContent);
  cam.querySelector('[data-a=fechar-nao]').click();
  const voltou = !cam.querySelector('.lc-cp-alerta') && !s.nomes().includes('RiotClient.Exit');
  cam.querySelector('[data-a=fechar]').click();
  cam.querySelector('[data-a=fechar-sim]').click();
  caso('✕ no champ select: avisa do dodge, "voltar" não fecha, 2º clique fecha (RiotClient.Exit)', textoOk && voltou && s.nomes().at(-1) === 'RiotClient.Exit');
  cam.querySelector('[data-a=minimizar]').click();
  caso('– minimiza pela Riot (Window.Minimize)', s.nomes().at(-1) === 'Window.Minimize');
}

// ---------- 6. comum ----------
{
  caso('esc: escapa < > & " \' `', esc('<img src=x onerror="a">&\'`') === '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;&#96;');
  const doc = novoDoc();
  const el = h('div', { doc, class: 'a b', dataset: { x: '1' }, title: 't' }, '<b>nome</b>', h('span', { doc }, 'filho'));
  caso('h(): texto da LCU entra como texto (nada de HTML)', el.childNodes[0].nodeType === 3 && el.textContent === '<b>nome</b>filho' && el.className === 'a b' && el.dataset.x === '1');
  caso('iconeCampeao: só id numérico > 0', iconeCampeao(58) === '/lol-game-data/assets/v1/champion-icons/58.png' && iconeCampeao('../x') === '' && iconeCampeao(-1) === '');
  const f = lcuFalsa({ 'GET /lol-game-data/assets/v1/champion-summary.json': [{ id: -1, name: 'Nenhum' }, { id: 58, name: 'Renekton', alias: 'Renekton' }, { id: 60103, name: 'Ahri' }] });
  _zerarCatalogo();
  const cat = await campeoes(f.fetch);
  caso('campeoes(): catálogo sem -1 nem variante de modo (id < 10000)', cat.size === 1 && cat.get(58).nome === 'Renekton');
  const falha = await lcu('GET', '/x', undefined, async () => { throw new Error('caiu'); });
  caso('lcu(): falha de rede não lança ({ok:false, status:0})', falha.ok === false && falha.status === 0 && falha.erro === 'caiu');
  const s = cenario();
  s.rot.marcarPronto(); await s.ir('Lobby');
  avisar('teste', true, s.doc);
  caso('avisar(): com a camada à vista o aviso aparece dentro dela', s.doc.getElementById('lc-compacto').querySelector('.lc-cp-aviso')?.textContent === 'teste');
}

// ---------- 7. fiação no client (iniciarCompacto) com window/document/socket/LCU falsos ----------
{
  const doc = novoDoc();
  const pedidos = [], teclas = [], observados = new Map();
  const lf = lcuFalsa({ 'GET /lol-gameflow/v1/gameflow-phase': 'Lobby', 'GET /lol-gameflow/v1/session': sessao(420) });
  const antes = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.document = doc;
  globalThis.window = { innerWidth: 1280, innerHeight: 720, riotInvoke: a => pedidos.push(JSON.parse(a.request)), addEventListener: (ev, fn) => teclas.push([ev, fn]) };
  globalThis.fetch = lf.fetch;
  globalThis.Toast = { success() {}, error() {} };
  const { iniciarCompacto, criarAvisoChat, TELAS } = await import('../pengu/compacto/index.js');
  // coletor falso (POST /chat/plugin vai para ele, não para a LCU)
  const aoColetor = [];
  const coletorFalso = async (caminho, op = {}) => { aoColetor.push([caminho, op.metodo || 'GET', op.corpo]); return { status: 200, dados: { ok: true } }; };
  const cfg = { compacto: { ligado: true, inicioCompacto: true, larg: 420, alt: 640 }, aceite: { ligado: true } };
  const api = iniciarCompacto({ socket: { observe: (uri, cb) => observados.set(uri, cb) } }, cfg, { coletor: coletorFalso });
  await tick(40);
  const e = api.estado();
  // as 4 telas reais carregam pelo import dinâmico; Lobby com inicioCompacto = tela 1 na janela pequena
  caso('iniciarCompacto: lê a fase, assina gameflow, injeta o CSS, carrega as 4 telas e abre o Lobby no compacto (ResizeTo 420x640)',
    e.fase === 'Lobby' && e.efetivo === 'compacto' && e.tela === 'lobby' && observados.has('/lol-gameflow/v1/gameflow-phase')
      && observados.has('/lol-gameflow/v1/session') && !!doc.getElementById('lc-compacto-estilo')
      && Object.keys(TELAS).every(k => e.telas[k] === 'ok')
      && pedidos.filter(p => p.name === 'Window.ResizeTo').map(p => p.params.join('x')).join() === '420x640'
      && !!doc.getElementById('lc-compacto') && doc.documentElement.classList.contains('lc-modo-compacto'), JSON.stringify({ e, pedidos }));
  // passo 13: com o chat ao lado ligado (padrão), as janelas do coletor não podem abrir conversa sozinhas (abriria em dobro): o
  // coletor de hoje só lê `compacto`, então vai compacto:false + lateral:true (o caso de chatLateral desligado fica no bloco de baixo)
  caso('iniciarCompacto: avisa o coletor do modo (POST /chat/plugin {compacto:false, lateral:true} com o chat ao lado ligado)',
    aoColetor.some(([c, m, corpo]) => c === '/chat/plugin' && m === 'POST' && corpo?.compacto === false && corpo?.lateral === true), JSON.stringify(aoColetor));
  const tecla = teclas.find(([ev]) => ev === 'keydown')?.[1];
  let parou = false;
  tecla?.({ ctrlKey: true, shiftKey: true, key: 'M', preventDefault() {}, stopPropagation() { parou = true; } });
  await tick(10);
  caso('iniciarCompacto: Ctrl+Shift+M chega ao roteador (compacto -> client normal 1280x720, sem camada)',
    parou && api.estado().efetivo === 'expandido' && !doc.getElementById('lc-compacto') && !doc.documentElement.classList.contains('lc-modo-compacto')
      && pedidos.filter(p => p.name === 'Window.ResizeTo').at(-1)?.params.join('x') === '1280x720');
  caso('iniciarCompacto: no client normal aparece o "▣ modo compacto" (sem a barra da Riot neste DOM: flutuante)',
    doc.getElementById('lc-botao-compacto')?.dataset.modo === 'flutua');
  caso('iniciarCompacto: ouve o resize da janela (a Riot pode devolver 1280×720 sozinha)', teclas.some(([ev]) => ev === 'resize'));
  caso('iniciarCompacto: montar o lobby e alternar só leem a LCU (GET)', lf.escritas().length === 0, JSON.stringify(lf.escritas()));
  caso('iniciarCompacto: modais() expõe o histórico da medição', Array.isArray(api.modais()));
  // chave desligada pelas Configurações: sincronizar avisa o coletor (compacto:false) uma vez
  const antesAviso = aoColetor.length;
  cfg.compacto.ligado = false;
  api.sincronizar(); api.sincronizar();
  await tick(10);
  caso('sincronizar com a chave desligada: client normal e um único POST /chat/plugin {compacto:false}',
    api.estado().efetivo === 'expandido' && aoColetor.slice(antesAviso).filter(([c]) => c === '/chat/plugin').length === 1
      && aoColetor.at(-1)?.[2]?.compacto === false, JSON.stringify(aoColetor.slice(antesAviso)));
  Object.assign(globalThis, antes);
}
{
  // compacto desligado desde a carga: nada do modo expandido muda (sem ResizeTo, sem camada, sem botão, sem classe)
  const doc = novoDoc();
  const pedidos = [], observados = new Map(), ouvintes = [], toasts = [];
  const lf = lcuFalsa({ 'GET /lol-gameflow/v1/gameflow-phase': 'Lobby', 'GET /lol-gameflow/v1/session': sessao(420) });
  const antes = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, Toast: globalThis.Toast };
  globalThis.document = doc;
  globalThis.window = { innerWidth: 1280, innerHeight: 720, riotInvoke: a => pedidos.push(JSON.parse(a.request)), addEventListener: (ev, fn) => ouvintes.push([ev, fn]) };
  globalThis.fetch = lf.fetch;
  globalThis.Toast = { success: m => toasts.push(m), error: m => toasts.push(m) };
  const { iniciarCompacto } = await import('../pengu/compacto/index.js');
  const aoColetor = [];
  const coletorFalso = async (caminho, op = {}) => { aoColetor.push([caminho, op.metodo || 'GET', op.corpo]); return { status: 200, dados: { ok: true } }; };
  const cfg = { compacto: { ligado: false, inicioCompacto: true, larg: 420, alt: 640 }, aceite: { ligado: true } };
  const api = iniciarCompacto({ socket: { observe: (uri, cb) => observados.set(uri, cb) } }, cfg, { coletor: coletorFalso });
  await tick(40);
  const cl = doc.documentElement.classList;
  caso('compacto desligado: client normal intocado (sem riotInvoke, sem #lc-compacto, sem botão, sem classe no <html>)',
    api.estado().efetivo === 'expandido' && pedidos.length === 0 && !doc.getElementById('lc-compacto') && !doc.getElementById('lc-botao-compacto')
      && !cl.contains('lc-modo-compacto') && !cl.contains('lc-botao-compacto') && lf.escritas().length === 0, JSON.stringify({ e: api.estado(), pedidos }));
  caso('compacto desligado: o coletor ouve compacto:false na carga e nada mais',
    aoColetor.length === 1 && aoColetor[0][0] === '/chat/plugin' && aoColetor[0][2]?.compacto === false, JSON.stringify(aoColetor));
  // atalho: desligado, o Ctrl+Shift+M segue para o client (nem engolido nem com aviso de erro)
  const tecla = ouvintes.find(([ev]) => ev === 'keydown')?.[1];
  let parou = false, impediu = false;
  tecla?.({ ctrlKey: true, shiftKey: true, key: 'M', preventDefault() { impediu = true; }, stopPropagation() { parou = true; } });
  await tick(4);
  caso('compacto desligado: Ctrl+Shift+M não é engolido nem avisa (o client recebe a tecla como sem o plugin)',
    !!tecla && !parou && !impediu && toasts.length === 0 && pedidos.length === 0, JSON.stringify({ parou, impediu, toasts }));
  Object.assign(globalThis, antes);
}
{
  // aviso ao coletor: reaviso periódico só com a chave ligada (o coletor reinicia e volta com compacto=None)
  const { criarAvisoChat } = await import('../pengu/compacto/index.js');
  const cfg = { compacto: { ligado: true } };
  const aoColetor = []; let periodico = null;
  const aviso = criarAvisoChat({ cfg, coletor: async (c, op = {}) => { aoColetor.push(op.corpo); return { status: 0, dados: null }; }, repetir: fn => { periodico = fn; return 1; } });
  await aviso.avisar();
  periodico(); periodico();
  await tick(4);
  const ligadoN = aoColetor.length;
  cfg.compacto.ligado = false;
  await aviso.mudou();
  periodico();
  await tick(4);
  caso('aviso ao coletor: coletor fora não lança; ligado reavisa a cada volta; desligado avisa 1 vez e para',
    ligadoN === 3 && aoColetor.length === 4 && aoColetor.at(-1)?.compacto === false, JSON.stringify(aoColetor));
}
{
  // passo 13: chat ao lado desligado = comportamento de antes (compacto:true, as janelas do coletor abrem sozinhas); religar
  // avisa de novo (compacto:false, lateral:true)
  const { criarAvisoChat } = await import('../pengu/compacto/index.js');
  const cfg = { compacto: { ligado: true, chatLateral: false } };
  const aoColetor = [];
  const aviso = criarAvisoChat({ cfg, coletor: async (c, op = {}) => { aoColetor.push(op.corpo); return { status: 200, dados: { ok: true } }; }, repetir: () => 1 });
  await aviso.avisar();
  cfg.compacto.chatLateral = true;
  await aviso.mudou(); await aviso.mudou();
  caso('aviso ao coletor: chatLateral desligado manda compacto:true (como antes); ligar a lateral avisa 1 vez compacto:false + lateral:true',
    igual(aoColetor, [{ compacto: true, lateral: false }, { compacto: false, lateral: true }]), JSON.stringify(aoColetor));
}

// ---------- 7b. Ctrl+K "analisar última partida" com a camada à vista (plano, passo 11 b2) ----------
// o painel nasceria embaixo da camada (display:none): o clique fora dele fecharia no 1º clique e o Esc seria comido.
// expandirAntes expande (roteador de verdade) e só então abre; se a camada não sai, não abre e avisa
{
  const s = cenario();
  s.rot.marcarPronto();
  await s.ir('EndOfGame'); await tick(); await s.ir('EndOfGame');
  const antes = s.foto();
  const vistoNaAbertura = [];
  const abrir = () => { vistoNaAbertura.push({ ...s.foto(), aVista: s.doc.documentElement.classList.contains(CLASSE) }); return 'aberto'; };
  const r = expandirAntes({ compacto: s.rot, abrir, aVista: () => s.doc.documentElement.classList.contains(CLASSE), avisar: (m, e) => s.avisos.push([m, !!e]) });
  caso('b2: Ctrl+K com a camada à vista: expande (sem camada, janela 1280×720) ANTES de abrir o painel',
    antes.efetivo === 'compacto' && vistoNaAbertura.length === 1 && vistoNaAbertura[0].efetivo === 'expandido' && !vistoNaAbertura[0].camada
    && !vistoNaAbertura[0].aVista && !s.janela.ehCompacta() && r === 'aberto', JSON.stringify({ antes, vistoNaAbertura }));
  caso('b2: o expandir do Ctrl+K vale como "⤢ expandir" dele (override), não como erro', s.rot.estado().override === 'expandido' && !s.avisos.some(([, e]) => e));
  // já expandido: só abre
  const s2 = cenario({ cfg: { compacto: { ligado: false } } });
  await s2.ir('Lobby');
  let n = 0;
  expandirAntes({ compacto: s2.rot, abrir: () => { n++; }, aVista: () => false, avisar: () => {} });
  caso('b2: client normal à vista: abre direto, sem mexer na janela', n === 1 && s2.pedidos.length === 0, s2.nomes().join());
  // compacto que quebrou no init (null): abre como antes
  let m = 0;
  expandirAntes({ compacto: null, abrir: () => { m++; }, aVista: () => false, avisar: () => {} });
  caso('b2: sem o compacto (módulo quebrado): abre como antes', m === 1);
  // a camada não sai (expandir sem efeito): não abre por baixo dela, avisa
  let k = 0;
  const preso = { estado: () => ({ efetivo: 'compacto' }), expandir() {} };
  const avisosPreso = [];
  expandirAntes({ compacto: preso, abrir: () => { k++; }, aVista: () => true, avisar: (msg, e) => avisosPreso.push([msg, !!e]) });
  caso('b2: camada que não sai: o painel NÃO abre embaixo dela e o aviso diz o que fazer', k === 0 && avisosPreso.length === 1 && avisosPreso[0][1], JSON.stringify(avisosPreso));
}

// ---------- 8. guardrails no código ----------
{
  const pasta = fileURLToPath(new URL('../pengu/compacto/', import.meta.url));
  const fontes = readdirSync(pasta).filter(n => n.endsWith('.js')).map(n => [n, readFileSync(pasta + n, 'utf8')]);
  caso('compacto/*.js: nenhum innerHTML (DOM por h()/textContent)', fontes.every(([, t]) => !/\.innerHTML\s*=/.test(t)), fontes.filter(([, t]) => /\.innerHTML\s*=/.test(t)).map(([n]) => n).join());
  caso('base do compacto não busca partida nem toca a LCU com escrita (só as telas, pelos freios)',
    fontes.filter(([n]) => ['index.js', 'modo.js', 'comum.js'].includes(n)).every(([, t]) => !/matchmaking\/search|'(POST|PUT|PATCH|DELETE)'/.test(t)));
  caso('TELAS: um módulo por tela, nome tela-<nome>.js', Object.entries(TELAS).every(([k, v]) => v === `./tela-${k}.js`));
}

relatar(casos);
