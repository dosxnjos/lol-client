// Testa a lateral do client compacto (roadmap/2026-10-13-client-compacto.md, passo 13; parecer do Gabriel de 14/10/2026 ~20:00):
// chat ao lado (A1/A2), sala do time na seleção, configurações à esquerda (B1), coach da seleção (B2), "📊 última partida" (B3) e
// as 3 travas do roteador (LIMITES.larg, LARGURA_COMPACTA_MAX, noTamanho na troca de tela) com o estado único de largura.
// Sem o client: roteador e lateral de verdade, janela falsa que faz o que o client faz (ResizeTo em px CSS mantendo o canto,
// MoveTo e ScreenData em px físicos, escala 1,25), LCU falsa (tools/lcu-falsa.mjs) e DOM mínimo feito aqui.
// O que segura: abrir e fechar qualquer painel, em TODA ordem e em 4 lugares do monitor, nunca deixa a janela fora do monitor,
// nunca deixa largura diferente do estado e devolve a coluna ao lugar dela; nada escreve na LCU sem clique; corpos iguais aos
// do front da Riot; nome de jogador da seleção nunca aparece.
// uso: node tools/teste-compacto-lateral.mjs
import { relatar, lcuFalsa } from './lcu-falsa.mjs';
import { criarJanela, invocadorRiot, criarCamada, tamanho, LATERAL_MAX, CSS as CSS_MODO } from '../pengu/compacto/modo.js';
import { criarRoteador, criarArrastoJanela, CLASSE, geometriaAtiva } from '../pengu/compacto/index.js';
import { lcu as lcuReal } from '../pengu/compacto/comum.js';
import { criarGeometria, lerTelaRiot, posicaoAlvo, cabeSemMover, normalizarTela } from '../pengu/compacto/geometria.js';
import { criarLateral, layout, MAX_CONVERSAS } from '../pengu/compacto/lateral.js';
import { verAmigos, statusAmigo, lerSalaTime, elencoTime, acharSalaTime, lobbyParaConvite, pedidosRecebidos, lerConversa } from '../pengu/compacto/lateral-chat.js';
import { modeloSelo, meuNaSessao } from '../pengu/compacto/lateral-coach.js';
import { linhaUltima } from '../pengu/compacto/tela-lobby.js';
import { botaoCoach, botaoConfig } from '../pengu/compacto/chat-botao.js';
import { PADRAO } from '../pengu/config.js';

// ---------- DOM mínimo (o dos outros testes do compacto; append(null) quebra, como seria "null" na tela) ----------
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
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.doc = doc; this.ownerDocument = doc; this.parentNode = null; this.childNodes = [];
    this.classList = new Classes(); this.dataset = {}; this.attrs = new Map(); this.ouvintes = {}; this.id = '';
    const est = {}; est.setProperty = (k, v) => { est[k] = v; }; this.style = est; this.value = ''; this.scrollTop = 0;
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { if (k === 'id') this.id = String(v); else if (k === 'class') this.className = v; else this.attrs.set(k, String(v)); }
  getAttribute(k) { return k === 'id' ? this.id : this.attrs.get(k) ?? null; }
  removeAttribute(k) { this.attrs.delete(k); }
  hasAttribute(k) { return this.attrs.has(k); }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  append(...ns) {
    for (let n of ns) {
      if (n === null || n === undefined) throw new Error('append(null): no client isto vira o texto "null"');
      if (typeof n === 'string') n = new Texto(n);
      if (n.parentNode) n.remove();
      n.parentNode = this; this.childNodes.push(n);
    }
  }
  appendChild(n) { this.append(n); return n; }
  prepend(n) { if (n.parentNode) n.remove(); n.parentNode = this; this.childNodes.unshift(n); }
  insertBefore(n, ref) { if (n.parentNode) n.remove(); n.parentNode = this; const i = this.childNodes.indexOf(ref); this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n); return n; }
  remove() { if (this.parentNode) { const l = this.parentNode.childNodes; l.splice(l.indexOf(this), 1); } this.parentNode = null; }
  replaceChildren(...ns) { for (const n of [...this.childNodes]) n.parentNode = null; this.childNodes = []; this.append(...ns); }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this.replaceChildren(new Texto(v)); }
  get isConnected() { let p = this; while (p.parentNode) p = p.parentNode; return p === this.doc.documentElement; }
  addEventListener(ev, fn) { (this.ouvintes[ev] ||= []).push(fn); }
  disparar(ev, extra = {}) { const e = { target: this, stopPropagation() {}, preventDefault() {}, ...extra }; for (let n = this; n; n = n.parentNode) for (const fn of n.ouvintes?.[ev] || []) fn(e); }
  click(extra) { this.disparar('click', extra); }
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
  casa(sel) {
    const partes = String(sel).trim().split(/\s+/);
    if (!this.matches(partes.pop())) return false;
    let n = this.parentNode;
    for (let i = partes.length - 1; i >= 0; i--) {
      while (n && n.nodeType === 1 && !n.matches(partes[i])) n = n.parentNode;
      if (!n || n.nodeType !== 1) return false;
      n = n.parentNode;
    }
    return true;
  }
  closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(sel)) return n; return null; }
  querySelector(sel) { for (const n of this.desc()) if (n.casa(sel)) return n; return null; }
  querySelectorAll(sel) { return [...this.desc()].filter(n => n.casa(sel)); }
}
function novoDoc() {
  const doc = {};
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
// setImmediate: no Windows o setTimeout(0) espera o relógio do sistema (~15 ms) e as 144 sequências levariam minutos
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);

// ---------- janela falsa: o que o client faz (riotInvoke) ----------
// ResizeTo [w, h] em px CSS mantendo o canto de cima à esquerda ([S] no client: a geometria relê e corrige); MoveTo [x, y] e
// ScreenData em px FÍSICOS (escala z); CenterToScreen centraliza no monitor
const MONITORES = {
  meio: { L: 0, T: 0, W: 2560, H: 1020 },
  pequeno: { L: 0, T: 0, W: 1280, H: 1020 }, // 1024 CSS úteis com z 1,25 (o "monitor pequeno" do protótipo)
};
// canto: true = mantém o canto; false = cresce pelo centro na hora; 'tarde' = cresce pelo centro, mas a posição só muda uma volta
// do laço depois (o redimensionamento assíncrono do CEF [S]: a releitura logo após o ResizeTo leria a posição velha).
// cssEsq() = a variável --lc-cp-esq da camada no momento de cada pedido (prova a ordem CSS x MoveTo x ResizeTo)
function janelaFalsa({ x = 640, y = 100, w = 1280, h = 720, z = 1.25, mon = MONITORES.meio, canto = true } = {}) {
  const win = { x, y, w, h, z, mon: { ...mon }, pedidos: [], minimizada: false, cssEsq: () => null };
  win.riotInvoke = arg => {
    const p = JSON.parse(arg.request);
    if (p.name !== 'Window.ScreenData') { p.esqCss = win.cssEsq(); win.pedidos.push(p); }
    if (p.name === 'Window.ResizeTo') {
      const [nw, nh] = p.params, dx = Math.round((win.w - nw) * win.z / 2);
      if (canto === false) win.x += dx;
      else if (canto === 'tarde') setImmediate(() => { win.x += dx; });
      win.w = nw; win.h = nh;
    }
    else if (p.name === 'Window.MoveTo') { [win.x, win.y] = p.params; if (win.ajusteMove) [win.x, win.y] = win.ajusteMove(win.x, win.y); } // ajusteMove: o Windows encaixa
    else if (p.name === 'Window.CenterToScreen') { win.x = Math.round(win.mon.L + (win.mon.W - win.w * win.z) / 2); win.y = Math.round(win.mon.T + (win.mon.H - win.h * win.z) / 2); }
    else if (p.name === 'Window.ScreenData') arg.onSuccess?.(JSON.stringify({ result: JSON.stringify({ screenX: win.minimizada ? -32000 : win.x, screenY: win.minimizada ? -32000 : win.y,
      screenAvailLeft: win.mon.L, screenAvailTop: win.mon.T, screenAvailWidth: win.mon.W, screenAvailHeight: win.mon.H, windowWidth: win.w * win.z, windowHeight: win.h * win.z,
      windowMinimized: win.minimizada, zoomScale: win.z }) }));
  };
  return win;
}

// ---------- janela por quadros: o pipeline do client, quadro a quadro (o que o Gabriel vê piscar, 15/10/2026) ----------
// Cada quadro: (1) a página fica sabendo do tamanho que a janela tinha no fim do quadro anterior (a ida e volta browser →
// página do ResizeTo: muda o innerWidth e dispara resize); (2) rAF e o que ele destrava; (3) a página pinta: foto das variáveis
// --lc-cp-* e do painel da esquerda escondido, no tamanho que ELA conhece; (4) o DWM aplica os pedidos nativos que chegaram
// (MoveTo/ResizeTo; atrasoNativo: N quadros depois); (5) a tela mostra a foto da página na janela onde ela está.
// Pedido nativo e CSS da mesma volta caem no mesmo quadro (atrasoNativo 0); a corrida real de 0-1 quadro é [S]
// (geometria.MOVE_APOS_CSS_QUADROS). prazoQuadros: o ESPERA_TAMANHO_MS do client contado em quadros (~15 a 60 Hz).
// paginaAtrasa: quadros a mais até a página saber do ResizeTo; pinturaAtrasa: a tela mostra a pintura do quadro ANTERIOR (o
// pedido nativo ganha a corrida contra o CSS; o oposto de atrasoNativo)
function janelaQuadros({ x = 640, y = 100, w = 1280, h = 720, z = 1.25, mon = MONITORES.meio, atrasoNativo = 0, prazoQuadros = 15, paginaAtrasa = 0, pinturaAtrasa = false } = {}) {
  const j = { os: { x, y, w, h }, vista: w, z, mon: { ...mon }, fila: [], raf: [], esperas: [], quadros: [], pedidos: [], n: 0, minimizada: false,
    foto: () => null, cssEsq: () => null, sabe: [] };
  for (const k of ['x', 'y', 'w', 'h']) Object.defineProperty(j, k, { get: () => j.os[k], set: v => { j.os[k] = v; } });
  j.riotInvoke = arg => {
    const p = JSON.parse(arg.request);
    if (p.name === 'Window.ScreenData') {
      const o = { ...j.os };
      setImmediate(() => arg.onSuccess?.(JSON.stringify({ result: JSON.stringify({ screenX: o.x, screenY: o.y, screenAvailLeft: j.mon.L, screenAvailTop: j.mon.T,
        screenAvailWidth: j.mon.W, screenAvailHeight: j.mon.H, windowWidth: o.w * z, windowHeight: o.h * z, windowMinimized: false, zoomScale: z }) })));
      return;
    }
    j.pedidos.push({ name: p.name, params: p.params, quadro: j.n, esqCss: j.cssEsq() });
    j.fila.push({ p, em: j.n + atrasoNativo });
  };
  j.quadro = () => new Promise(r => j.raf.push(r));
  j.esperarTamanho = larg => new Promise(res => {
    if (Math.abs(j.vista - larg) <= 8) { res(true); return; }
    j.esperas.push({ larg, res, ate: j.n + prazoQuadros });
  });
  const aplicar = p => {
    if (p.name === 'Window.ResizeTo') { [j.os.w, j.os.h] = p.params; j.sabe.push({ w: j.os.w, em: j.n + 1 + paginaAtrasa }); }
    else if (p.name === 'Window.MoveTo') [j.os.x, j.os.y] = p.params;
    else if (p.name === 'Window.CenterToScreen') { j.os.x = Math.round(j.mon.L + (j.mon.W - j.os.w * z) / 2); j.os.y = Math.round(j.mon.T + (j.mon.H - j.os.h * z) / 2); }
  };
  j.passar = async () => {
    j.n++;
    // (1) resize na página
    while (j.sabe.length && j.sabe[0].em <= j.n) j.vista = j.sabe.shift().w;
    j.esperas = j.esperas.filter(e => {
      if (Math.abs(j.vista - e.larg) <= 8) { e.res(true); return false; }
      if (j.n >= e.ate) { e.res(false); return false; }
      return true;
    });
    // (2) rAF + o que ele destrava (continuações, ScreenData)
    for (const r of j.raf.splice(0)) r();
    await tick(12);
    // (3) pinta
    const pintura = { vista: j.vista, ...(j.foto() || {}) };
    const f = pinturaAtrasa ? (j.anterior || pintura) : pintura;
    j.anterior = pintura;
    // (4) DWM
    const agora = j.fila.filter(q => q.em <= j.n);
    j.fila = j.fila.filter(q => q.em > j.n);
    for (const q of agora) aplicar(q.p);
    // (5) tela
    j.quadros.push({ n: j.n, x: j.os.x, w: j.os.w, ...f });
  };
  j.rodar = async (n = 40) => { for (let i = 0; i < n; i++) await j.passar(); };
  return j;
}
// quadros ruins de UM passo (desde = índice em s.win.quadros do 1º quadro do passo): coluna cortada, ou num lugar que não é o de
// antes nem o de depois do passo (o pulo de 1+ quadro que ele vê), ou indo e voltando. Onde a âncora cabe, o conferir() do fim
// do passo exige a coluna nela; onde não cabe (borda do monitor) ela anda uma vez, de propósito.
function quadrosRuins(s, desde = 0) {
  const z = s.win.z, colX = q => q.x + q.esq * z;
  const qs = s.win.quadros.slice(desde).filter(q => q.compacto);
  const antes = s.win.quadros.slice(0, desde).filter(q => q.compacto).at(-1);
  if (!qs.length) return [];
  const ini = antes ? colX(antes) : colX(qs[0]), fim = colX(qs.at(-1));
  const perto = (a, b) => Math.abs(a - b) <= 2;
  const ruins = [];
  let trocas = 0, ult = ini;
  for (const q of qs) {
    const util = Math.min(q.vista, q.w), x = colX(q);
    if (q.esq + q.col > util + 0.5) ruins.push(`#${q.n} coluna cortada (esq ${q.esq} + col ${q.col} > ${util}; página ${q.vista}, janela ${q.w})`);
    else if (!perto(x, ini) && !perto(x, fim)) ruins.push(`#${q.n} coluna em ${x} (antes ${ini}, depois ${fim})`);
    if (!perto(x, ult)) { trocas++; ult = x; }
    if (q.esq > 0 && q.temEsq && !q.mudando && !perto(x, fim)) ruins.push(`#${q.n} configurações à vista com a coluna fora do lugar`);
  }
  if (trocas > 1) ruins.push(`coluna mudou de lugar ${trocas} vezes num passo`);
  return ruins;
}

// ---------- telas falsas (a lateral não depende da tela da coluna) ----------
const telaFalsa = nome => ({ montar(raiz, ctx) { raiz.append(ctx.raiz.doc.createElement('div')); ctx.titulo.append(`tela ${nome}`); }, atualizar() {} });
const TELAS = { lobby: telaFalsa('lobby'), fila: telaFalsa('fila'), champselect: telaFalsa('champselect'), posjogo: telaFalsa('posjogo'), honra: telaFalsa('honra'),
  jogo: telaFalsa('jogo') };

// ---------- dados da LCU falsa ----------
const NOME_OCULTO = 'NomeOcultoDoAliado';
const NUNCA = 'NUNCA-GUARDAR'; // campo extra da sala (no client: as credenciais da sala), que nunca pode sair da leitura
const SALA_CS = 'cs1@champ-select.br1.pvp.net';
const sessaoCS = (meuChamp = 0, hover = 58, adv = 24) => ({
  localPlayerCellId: 2, timer: { phase: 'BAN_PICK' },
  myTeam: [
    { cellId: 0, puuid: 'p-al0', summonerId: 900, gameName: NOME_OCULTO, nameVisibilityType: 'HIDDEN', championId: 64, assignedPosition: 'JUNGLE' },
    { cellId: 1, puuid: '', obfuscatedPuuid: 'obf-al1', gameName: NOME_OCULTO + '2', championId: 0, championPickIntent: 134, assignedPosition: 'MIDDLE' },
    { cellId: 2, puuid: 'puuid-eu', summonerId: 111, championId: meuChamp, assignedPosition: 'TOP' }],
  theirTeam: [{ cellId: 5, championId: adv }, { cellId: 6, championId: 0 }],
  actions: [[{ id: 1, type: 'pick', actorCellId: 2, championId: meuChamp || hover, completed: !!meuChamp }]],
});
function rotasPadrao(est) {
  return {
    'GET /lol-chat/v1/me': { id: 'eu@br1.pvp.net', pid: 'eu@br1.pvp.net', puuid: 'puuid-eu', summonerId: 111, gameName: 'Xerekton' },
    'GET /lol-chat/v1/friends': () => est.amigos,
    'GET /lol-chat/v1/conversations': () => est.conversas,
    'GET /lol-chat/v2/friend-requests': [{ direction: 'in', puuid: 'x' }, { direction: 'out', puuid: 'y' }, { direction: 'in', puuid: 'z' }],
    'GET /lol-chat/v1/player-mutes': () => (est.mudo ? { 'puuid-eu': { isSystemMuted: true } } : {}),
    'GET /lol-lobby/v2/lobby': () => (est.lobby === null ? { status: 404, json: { message: 'sem lobby' } } : est.lobby),
    'POST /lol-lobby/v2/lobby/invitations': { status: 200, json: [] },
    [`GET /lol-chat/v1/conversations/${encodeURIComponent('a1@br1.pvp.net')}/messages`]: () => est.msgsA1,
    [`POST /lol-chat/v1/conversations/${encodeURIComponent('a1@br1.pvp.net')}/messages`]: c => { est.msgsA1.push({ id: 'n' + est.msgsA1.length, ...c, fromId: 'eu@br1.pvp.net' }); return { status: 200, json: {} }; },
    [`POST /lol-chat/v1/conversations/${encodeURIComponent('a2@br1.pvp.net')}/messages`]: () => (est.conv2 ? { status: 200, json: {} } : { status: 404, json: {} }),
    'POST /lol-chat/v1/conversations': c => { est.conv2 = c; return { status: 200, json: c }; },
    'PUT /lol-chat/v1/conversations/active': { status: 204 },
    'DELETE /lol-chat/v1/conversations/active': { status: 204 },
    'GET /lol-champ-select/v1/session': () => est.sessao,
    [`GET /lol-chat/v1/conversations/${encodeURIComponent(SALA_CS)}/messages`]: () => est.msgsCS,
    [`POST /lol-chat/v1/conversations/${encodeURIComponent(SALA_CS)}/messages`]: c => { est.msgsCS.push({ id: 'cs' + est.msgsCS.length, ...c, fromPuuid: 'puuid-eu', type: 'groupchat' }); return { status: 200, json: {} }; },
  };
}
const AMIGOS = () => [
  { pid: 'a1@br1.pvp.net', puuid: 'pa1', summonerId: 201, gameName: 'amigo 1', availability: 'chat', lol: { gameStatus: 'outOfGame' }, icon: 29, displayGroupName: 'duo de sempre' },
  { pid: 'a2@br1.pvp.net', puuid: 'pa2', summonerId: 202, gameName: 'amigo 2', availability: 'dnd', lol: { gameStatus: 'inGame', championId: 58, queueId: 420, timeStamp: 0 }, icon: 7 },
  { pid: 'a3@br1.pvp.net', puuid: 'pa3', summonerId: 203, gameName: 'amigo 3', availability: 'offline' },
];

// ---------- cenário: roteador + lateral + geometria de verdade ----------
// quadros: {atrasoNativo, prazoQuadros, paginaAtrasa} = janela por quadros (a página só sabe do ResizeTo um quadro depois)
function cenario({ mon = 'meio', x = 640, canto = true, cfgCompacto = {}, champ = null, posjogo = null, quadros = null } = {}) {
  const doc = novoDoc();
  globalThis.document = doc;
  const win = quadros ? janelaQuadros({ x, mon: MONITORES[mon] || mon, ...quadros }) : janelaFalsa({ x, mon: MONITORES[mon] || mon, canto });
  const est = { amigos: AMIGOS(), conversas: [{ id: 'a1@br1.pvp.net', pid: 'a1@br1.pvp.net', type: 'chat', unreadMessageCount: 0, gameName: 'amigo 1' },
    { id: SALA_CS, type: 'championSelect', extra: { campo: NUNCA } }],
  msgsA1: [{ id: 'm1', type: 'chat', body: 'bora uma duo?', fromId: 'a1@br1.pvp.net', timestamp: '2026-10-14T19:58:00.000Z' }],
  msgsCS: [{ id: 'j', type: 'system', body: 'joined_room', fromPuuid: 'p-al0' },
    { id: 'c1', type: 'groupchat', body: 'vou de lee', fromPuuid: 'p-al0', fromSummonerId: 900 },
    { id: 'c2', type: 'groupchat', body: 'mid aqui', fromObfuscatedSummonerId: 'obf-al1', fromPuuid: 'obf-al1' },
    { id: 'c3', type: 'groupchat', body: 'quem é esse', fromPuuid: 'desconhecido' }],
  lobby: { localMember: { isLeader: true, puuid: 'puuid-eu', summonerId: 111 }, members: [{ puuid: 'puuid-eu', summonerId: 111 }] }, sessao: null, mudo: false, conv2: null };
  const falsa = lcuFalsa(rotasPadrao(est));
  const lcu = (m, u, c) => lcuReal(m, u, c, falsa.fetch);
  const cfg = { compacto: { ligado: true, inicioCompacto: true, larg: 420, alt: 680, chatLateral: true, conversaSozinha: true, ...cfgCompacto }, aceite: { ligado: true }, traumas: { ligado: true } };
  let agoraMs = 1_000_000;
  const janela = criarJanela({ invocar: invocadorRiot(win, () => {}), medir: () => (quadros ? [win.vista, win.h] : [win.w, win.h]), agora: () => agoraMs });
  const s = { doc, win, est, falsa, cfg, avisos: [], logs: [], agora: () => agoraMs, avancar: ms => { agoraMs += ms; } };
  // esperar: a folga antes de reler depois do ResizeTo (120 ms no client) vira 2 voltas do laço (o ResizeTo "tarde" da janela
  // falsa assenta em 1)
  // quadro: uma volta do laço; esperarTamanho: a janela falsa aplica o ResizeTo na hora (a janela por quadros, mais abaixo, é a
  // que tem a página atrasada)
  const geo = criarGeometria({ lerTela: () => lerTelaRiot(win), mover: (a, b) => janela.mover(a, b), medidas: () => s.rot?.medidasJanela() || null,
    ativo: () => geometriaAtiva(s.rot?.estado()),
    ...(quadros
      ? { esperar: async () => { for (let i = 0; i < 7; i++) await win.quadro(); }, quadro: win.quadro, esperarTamanho: win.esperarTamanho, agora: () => win.n * 16.7 }
      : { esperar: () => tick(2), quadro: () => tick(1), esperarTamanho: async larg => { await tick(1); return Math.abs(win.w - larg) <= 8; } }) });
  const camada = criarCamada({ doc, aoExpandir: () => s.rot.expandir(), aoMinimizar: () => {}, aoFechar: () => {} });
  const avisar = (m, e) => s.avisos.push([m, !!e]);
  const lat = criarLateral({ cfg, rot: () => s.rot, doc, lcu, servicos: { champ }, geometria: geo, avisar, log: (...a) => s.logs.push(a.map(String).join(' ')),
    repetir: () => 1, pararRepetir: () => {}, agora: () => agoraMs, campeoes: async () => new Map([[58, { nome: 'Renekton' }], [24, { nome: 'Jax' }], [64, { nome: 'Lee Sin' }], [154, { nome: 'Zac' }]]),
    abrirConfigRiot: () => { s.configRiot = (s.configRiot || 0) + 1; s.rot.abrirConfigRiot(); } });
  s.rot = criarRoteador({
    cfg, janela, camada, geometria: geo, lateral: lat,
    carregarTela: async nome => { if (TELAS[nome]) return TELAS[nome]; throw new Error('404 ' + nome); },
    servicos: { lateral: lat, posjogo }, avisar, log: (...a) => s.logs.push(a.map(String).join(' ')),
    classe: on => doc.documentElement.classList.toggle(CLASSE, on),
    agendar: () => 0, limpar: () => {}, repetir: () => 1, pararRepetir: () => {}, agora: () => agoraMs,
  });
  s.rot.marcarPronto();
  win.cssEsq = () => camada.medidas().esq;
  // arrasto de verdade (o mesmo do client: criarArrastoJanela), dx/dy em px da página; raf síncrono
  const arrasto = criarArrastoJanela({ geometria: geo, janela, medidas: () => s.rot?.medidasJanela() || null, win: { screenX: 0, screenY: 0, screen: {} }, raf: fn => fn() });
  s.arrastar = async (dx, dy = 0) => {
    arrasto.down({ button: 0, screenX: 500, screenY: 300, target: null });
    arrasto.move({ screenX: 500 + dx, screenY: 300 + dy });
    arrasto.up();
    await tick(4);
  };
  Object.assign(s, { geo, camada, lat, lcu, janela, arrasto });
  s.ir = async fase => { s.rot.aoFase(fase); await tick(8); await geo.ocioso(); await tick(4); };
  s.passo = async fn => { await fn(); await tick(8); await geo.ocioso(); await tick(8); await geo.ocioso(); };
  if (quadros) {
    // o que a página pinta em cada quadro
    win.foto = () => {
      const p = camada.partes(), m = camada.medidas();
      return { compacto: s.rot.estado().efetivo === 'compacto' && !!p, esq: m.esq, col: m.col, dir: m.dir, mudando: camada.estaMudando?.() ?? false, temEsq: !!p?.esq.children.length };
    };
    s.ir = async fase => { s.rot.aoFase(fase); await win.rodar(40); };
    s.passo = async fn => { await fn(); await win.rodar(40); };
  }
  s.partes = () => camada.partes();
  return s;
}
const ANTES = { document: globalThis.document };

// invariantes depois de cada passo (o que o Gabriel pediu: "garantir que as janelas não se percam entre si")
function conferir(s) {
  const lay = s.lat.layout(), lat = s.rot.larguraLateral(), e = s.rot.estado();
  const { w, h, z, x, y, mon: m } = s.win;
  const erros = [];
  if (lat.esq !== lay.esq || lat.dir !== lay.dir) erros.push(`estado da lateral ${JSON.stringify(lat)} ≠ layout ${lay.esq}/${lay.dir}`);
  if (e.efetivo === 'compacto') {
    if (w !== 420 + lay.esq + lay.dir) erros.push(`largura ${w} ≠ 420 + ${lay.esq} + ${lay.dir}`);
    if (x < m.L - 1 || x + w * z > m.L + m.W + 1 || y < m.T - 1 || y + h * z > m.T + m.H + 1) erros.push(`fora do monitor: x ${x} y ${y} w ${w}`);
    const xNaAncora = s.ancora - lay.esq * z;
    const cabeNaAncora = xNaAncora >= m.L - 1 && xNaAncora + w * z <= m.L + m.W + 1;
    if (cabeNaAncora && Math.abs(x + lay.esq * z - s.ancora) > 2) erros.push(`coluna em ${x + lay.esq * z}, âncora ${s.ancora}`);
    const p = s.partes();
    if (p) {
      if (p.esq.children.length !== (lay.config ? 1 : 0)) erros.push(`esquerda com ${p.esq.children.length} painéis`);
      if (p.dir.children.length !== (lay.lista ? 1 : 0) + (lay.painel ? 1 : 0)) erros.push(`direita com ${p.dir.children.length} painéis`);
      const v = p.camada.style;
      if (v['--lc-cp-esq'] !== lay.esq + 'px' || v['--lc-cp-dir'] !== lay.dir + 'px') erros.push(`variáveis CSS ${v['--lc-cp-esq']}/${v['--lc-cp-dir']}`);
    }
  }
  return erros;
}

// =================== 1. janela: as 3 travas ===================
{
  caso('tamanho: coluna com limites e lateral somada por fora ([420+660, 680]); lateral torta não estica além do teto',
    igual(tamanho(420, 680, 660), [1080, 680]) && igual(tamanho(420, 680, -5), [420, 680]) && igual(tamanho(420, 680, 99999), [420 + LATERAL_MAX, 680])
      && igual(tamanho(5000, 680, 300), [720, 680]));
  let medida = [1280, 720], t = 0;
  const pedidos = [];
  const j = criarJanela({ invocar: invocadorRiot({ riotInvoke: a => { const p = JSON.parse(a.request); pedidos.push(p); if (p.name === 'Window.ResizeTo') medida = [...p.params]; } }), medir: () => medida, agora: () => t });
  j.compactar(420, 680, 660);
  t += 5000;
  caso('trava 2: janela de 1080 (lateral aberta) segue compacta depois da folga (antes: ≥ 1000 px = "a Riot devolveu")', j.ehCompacta() && igual(pedidos.at(-1).params, [1080, 680]));
  caso('trava 3: noTamanho compara com coluna + lateral (1080×680 está no tamanho; 420 não)', j.noTamanho(420, 680, 660) && !j.noTamanho(420, 680, 0));
  medida = [1280, 720]; t += 5000;
  caso('a Riot devolveu 1280×720 com a lateral aberta: deixa de ser compacta (o roteador reencolhe)', !j.ehCompacta());
  const boot = (w, h) => criarJanela({ invocar: invocadorRiot({ riotInvoke() {} }), medir: () => [w, h] }).ehCompacta();
  caso('boot (recarga do plugin): 1080×680 e 1440×680 contam como compactas; 1280×720, 1600×900 e 1024×576 (formatos da Riot) não',
    boot(1080, 680) && boot(1440, 680) && boot(420, 680) && !boot(1280, 720) && !boot(1600, 900) && !boot(1024, 576));
}

// =================== 2. geometria pura ===================
{
  const t = normalizarTela({ screenX: 640, screenY: 100, screenAvailLeft: 0, screenAvailTop: 0, screenAvailWidth: 2560, screenAvailHeight: 1020, zoomScale: 1.25 });
  caso('posição: crescer à esquerda tira esq·z da janela e a coluna fica na âncora', igual(posicaoAlvo({ tela: t, ancora: 640, esq: 360, larg: 780, alt: 680 }), { x: 190, y: 100, cabe: true }));
  caso('posição: encostada à direita, a janela anda o mínimo para dentro (âncora intacta)', posicaoAlvo({ tela: { ...t, x: 2000 }, ancora: 2000, esq: 0, larg: 1080, alt: 680 }).x === 2560 - 1350);
  caso('posição: à esquerda do monitor a borda esquerda vence (topo nunca some)', posicaoAlvo({ tela: { ...t, x: 0 }, ancora: 0, esq: 360, larg: 780, alt: 680 }).x === 0);
  caso('posição: altura também presa ao monitor', posicaoAlvo({ tela: { ...t, y: 900 }, ancora: 640, esq: 0, larg: 420, alt: 680 }).y === 1020 - 850);
  caso('cabe sem mover: 1080 a partir de x 640 cabe; a partir de 1400 não; minimizada nunca',
    cabeSemMover(t, 1080) && !cabeSemMover({ ...t, x: 1400 }, 1080) && !cabeSemMover({ ...t, minimizada: true }, 420));
  caso('ScreenData minimizado (screenX −32000) é marcado e não move nada', normalizarTela({ screenX: -32000, screenY: -32000, screenAvailLeft: 0, screenAvailTop: 0,
    screenAvailWidth: 2560, screenAvailHeight: 1020, zoomScale: 1.25 }).minimizada === true && normalizarTela(null) === null);
  caso('layout: lista 300 + painel 360 à direita, configurações 360 à esquerda; monitor estreito divide a vaga (conversa no lugar da lista)',
    igual(layout({ lista: true, abas: [{}], config: true }, { util: 4000, col: 420 }), { esq: 360, dir: 660, lista: true, painel: true, config: true, estreito: false, total: 1440, cabe: true })
      && layout({ lista: true, abas: [{}], vistaEstreita: 'painel' }, { util: 1024, col: 420 }).dir === 360
      && layout({ lista: true, abas: [{}], vistaEstreita: 'painel' }, { util: 1024, col: 420 }).painel === true
      && layout({ lista: true, abas: [{}], vistaEstreita: 'lista' }, { util: 1024, col: 420 }).lista === true);
}

// =================== 3. roteador + lateral: abrir e fechar ===================
const A1 = { pid: 'a1@br1.pvp.net', conv: 'a1@br1.pvp.net', nome: 'amigo 1' };
const A2 = { pid: 'a2@br1.pvp.net', nome: 'amigo 2' };
{
  const s = cenario();
  await s.ir('Lobby');
  s.ancora = s.win.x;
  caso('entra no compacto em 420×680 sem mexer na posição (âncora = onde a janela está)', s.win.w === 420 && s.win.h === 680 && s.win.x === 640 && conferir(s).length === 0, JSON.stringify([s.win, conferir(s)]));
  await s.passo(() => s.lat.alternarLista());
  caso('💬: a janela alarga para a direita (420 → 720) com a lista; coluna parada', s.win.w === 720 && s.win.x === 640 && s.partes().dir.children[0]?.dataset.painel === 'lista' && conferir(s).length === 0, JSON.stringify([s.win, conferir(s)]));
  await s.passo(() => s.lat.abrirConversa(A1));
  caso('amigo clicado: a conversa abre mais à direita (720 → 1080), coluna parada', s.win.w === 1080 && s.win.x === 640 && s.partes().dir.children.length === 2 && conferir(s).length === 0, JSON.stringify([s.win, conferir(s)]));
  const nPedidos = s.win.pedidos.length;
  await s.passo(() => s.lat.alternarConfig());
  const cfgPed = s.win.pedidos.slice(nPedidos).map(p => p.name);
  // ordem desde 15/10/2026 ("flickada" ao clicar na ⚙): janela que cresce alarga ANTES de andar; que encolhe anda antes de estreitar
  caso('⚙: as configurações crescem para a ESQUERDA (1440), a coluna fica no mesmo lugar da tela; alarga antes de andar',
    s.win.w === 1440 && s.win.x === 640 - 450 && s.win.x + 360 * 1.25 === 640 && igual(cfgPed, ['Window.ResizeTo', 'Window.MoveTo']) && conferir(s).length === 0, JSON.stringify([s.win, cfgPed, conferir(s)]));
  const n2 = s.win.pedidos.length;
  await s.passo(() => s.lat.alternarConfig());
  const ped2 = s.win.pedidos.slice(n2).map(p => p.name);
  caso('fechar as configurações: anda e só então encolhe; coluna volta ao mesmo lugar (x 640)', s.win.w === 1080 && s.win.x === 640 && igual(ped2, ['Window.MoveTo', 'Window.ResizeTo']), JSON.stringify([s.win, ped2]));
  await s.passo(() => s.lat.alternarLista());
  caso('✕ da lista com a conversa aberta: fica 780 (coluna + conversa)', s.win.w === 780 && conferir(s).length === 0, JSON.stringify(s.win));
  await s.passo(() => s.lat.fecharAba('c:a1@br1.pvp.net'));
  caso('✕ da conversa: volta a 420 e a coluna na âncora', s.win.w === 420 && s.win.x === 640 && conferir(s).length === 0, JSON.stringify(s.win));
  // troca de tela não encolhe a lateral (trava 3)
  await s.passo(() => s.lat.alternarLista());
  const n3 = s.win.pedidos.length;
  await s.ir('Matchmaking'); await s.ir('ReadyCheck'); await s.ir('Matchmaking');
  caso('trava 3: lobby → fila → partida encontrada → fila com a lista aberta: nenhum ResizeTo (antes toda troca de tela voltava a 420)',
    s.win.pedidos.slice(n3).filter(p => p.name === 'Window.ResizeTo').length === 0 && s.win.w === 720 && s.rot.estado().efetivo === 'compacto', JSON.stringify(s.win.pedidos.slice(n3)));
  // a Riot devolve a janela a 1280×720 com a lateral aberta: reencolhe para coluna + lateral, não para 420
  s.win.w = 1280; s.win.h = 720; s.avancar(5000);
  s.rot.reavaliar(); await tick(8); await s.geo.ocioso();
  caso('Riot devolveu 1280×720 com a lista aberta: reencolhe para 720×680 (coluna + lista), não para 420', s.win.w === 720 && s.win.h === 680, JSON.stringify(s.win));
  // expandir com a lateral aberta e voltar: a lateral volta igual (A2)
  await s.passo(() => s.rot.expandir());
  caso('⤢ expandir com a lista aberta: client normal 1280×720 e a lateral some junto (estado guardado)',
    s.win.w === 1280 && !s.doc.getElementById('lc-compacto') && s.lat.estado().lista === true && igual(s.rot.larguraLateral(), { esq: 0, dir: 300 }), JSON.stringify(s.win));
  const xExp = s.win.x;
  await s.passo(() => s.rot.compactar());
  s.ancora = xExp;
  caso('▣ modo compacto de volta: 720×680 com a lista no lugar, a coluna onde a janela normal estava', s.win.w === 720 && s.partes().dir.children.length === 1 && conferir(s).length === 0, JSON.stringify([s.win, conferir(s)]));
  caso('nenhuma escrita na LCU só por abrir/fechar painéis e trocar de tela (só GET)', s.falsa.escritas().length === 0, JSON.stringify(s.falsa.escritas()));
  globalThis.document = ANTES.document;
}

// =================== 4. toda ordem, 4 lugares do monitor ===================
const permutacoes = l => (l.length <= 1 ? [l] : l.flatMap((x, i) => permutacoes([...l.slice(0, i), ...l.slice(i + 1)]).map(r => [x, ...r])));
{
  const ABRE = { lista: s => s.lat.alternarLista(), conversa: s => s.lat.abrirConversa(A1), config: s => s.lat.alternarConfig() };
  const FECHA = { lista: s => s.lat.alternarLista(), conversa: s => s.lat.fecharAba('c:a1@br1.pvp.net'), config: s => s.lat.alternarConfig() };
  const LUGARES = [['meio', 640], ['borda direita', 1900], ['borda esquerda', 0], ['monitor pequeno', 300]];
  let n = 0;
  const falhas = [];
  for (const [lugar, x0] of LUGARES) {
    for (const abre of permutacoes(['lista', 'conversa', 'config'])) for (const fecha of permutacoes(['lista', 'conversa', 'config'])) {
      const s = cenario({ x: x0, mon: lugar === 'monitor pequeno' ? 'pequeno' : 'meio' });
      await s.ir('Lobby');
      s.ancora = s.win.x;
      for (const op of [...abre.map(o => ['abre', o]), ...fecha.map(o => ['fecha', o])]) {
        // monitor pequeno: abrir um lado que não cabe com o outro fecha o outro; o "fecha" seguinte vira abrir de novo. A invariante
        // vale do mesmo jeito (janela no monitor, largura = estado)
        await s.passo(() => (op[0] === 'abre' ? ABRE : FECHA)[op[1]](s));
        const erros = conferir(s);
        n++;
        if (erros.length) { falhas.push(`${lugar} ${abre}/${fecha} depois de ${op.join(' ')}: ${erros.join('; ')}`); break; }
      }
      // fecha o que sobrou aberto (monitor pequeno) e confere a volta à âncora
      const e = s.lat.estado();
      if (e.config) await s.passo(() => s.lat.alternarConfig());
      if (e.lista) await s.passo(() => s.lat.alternarLista());
      for (const a of s.lat.estado().abas) await s.passo(() => s.lat.fecharAba(a.k));
      if (s.win.w !== 420 || Math.abs(s.win.x - s.ancora) > 2) falhas.push(`${lugar} ${abre}/${fecha}: no fim w ${s.win.w} x ${s.win.x} âncora ${s.ancora}`);
    }
  }
  caso(`toda ordem (3! aberturas × 3! fechamentos × 4 lugares = 144 sequências, ${n} passos): janela sempre no monitor, largura = estado, coluna parada e de volta à âncora no fim`,
    falhas.length === 0, falhas.slice(0, 4).join(' | '));
}
{
  // sequências aleatórias (semente fixa) com arrasto dele, expandir/compactar e troca de tela no meio
  let semente = 20261014;
  const rnd = n => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente % n; };
  const OPS = ['lista', 'conversa', 'conversa2', 'config', 'fechaConversa', 'fechaConversa2', 'arrasta', 'expandeVolta', 'fase'];
  const falhas = [];
  let passos = 0;
  for (let k = 0; k < 60; k++) {
    const pequeno = k % 4 === 3;
    const s = cenario({ x: [640, 1900, 0, 300][k % 4], mon: pequeno ? 'pequeno' : 'meio' });
    await s.ir('Lobby');
    s.ancora = s.win.x;
    const feitas = [];
    for (let i = 0; i < 12; i++) {
      const op = OPS[rnd(OPS.length)];
      feitas.push(op);
      if (op === 'lista') await s.passo(() => s.lat.alternarLista());
      else if (op === 'conversa') await s.passo(() => s.lat.abrirConversa(A1));
      else if (op === 'conversa2') await s.passo(() => s.lat.abrirConversa(A2));
      else if (op === 'config') await s.passo(() => s.lat.alternarConfig());
      else if (op === 'fechaConversa') await s.passo(() => s.lat.fecharAba('c:a1@br1.pvp.net'));
      else if (op === 'fechaConversa2') await s.passo(() => s.lat.fecharAba('c:a2@br1.pvp.net'));
      else if (op === 'arrasta') {
        // ele arrasta pelo topo (dentro do monitor), pelo arrasto de verdade (criarArrastoJanela): a coluna vira a âncora nova.
        // Antes este passo punha s.win.x direto e não pegava a posição velha da geometria (revisão de 14/10/2026)
        const lay = s.lat.layout(), m = s.win.mon;
        const maxX = m.L + m.W - s.win.w * s.win.z - 3;
        if (maxX < m.L + 3) continue;
        const alvo = Math.round(m.L + 3 + rnd(Math.max(1, Math.floor(maxX - m.L - 3))));
        await s.arrastar(Math.round((alvo - s.win.x) / s.win.z));
        s.ancora = s.win.x + lay.esq * s.win.z;
      } else if (op === 'expandeVolta') {
        await s.passo(() => s.rot.expandir());
        const xe = s.win.x;
        await s.passo(() => s.rot.compactar());
        s.ancora = xe;
      } else if (op === 'fase') { await s.ir('Matchmaking'); await s.ir('Lobby'); }
      passos++;
      const erros = conferir(s);
      if (erros.length) { falhas.push(`#${k} [${feitas.join(',')}]: ${erros.join('; ')}`); break; }
    }
  }
  caso(`sequências aleatórias (60 × 12 passos = ${passos}, com arrasto, expandir/voltar e troca de tela): nenhuma janela perdida nem largura errada`,
    falhas.length === 0, falhas.slice(0, 3).join(' | '));
}
{
  // [S] o ResizeTo do client manter o canto de cima à esquerda: se ele crescer pelo centro, a geometria relê e corrige
  const falhas = [];
  for (const abre of permutacoes(['lista', 'conversa', 'config'])) {
    const s = cenario({ canto: false });
    await s.ir('Lobby');
    s.ancora = s.win.x;
    for (const op of [...abre, ...abre]) {
      await s.passo(() => (op === 'lista' ? s.lat.alternarLista() : op === 'config' ? s.lat.alternarConfig() : (s.lat.estado().abas.length ? s.lat.fecharAba('c:a1@br1.pvp.net') : s.lat.abrirConversa(A1))));
      const erros = conferir(s);
      if (erros.length) { falhas.push(`${abre} depois de ${op}: ${erros.join('; ')}`); break; }
    }
  }
  caso('ResizeTo que cresce pelo centro (o [S] do client): a geometria relê o ScreenData e devolve a coluna à âncora, em toda ordem', falhas.length === 0, falhas.slice(0, 2).join(' | '));
}
{
  // conversas: a 4ª fecha a mais antiga que não está à vista
  const s = cenario();
  await s.ir('Lobby');
  for (const i of [1, 2, 3, 4]) await s.passo(() => s.lat.abrirConversa({ pid: `x${i}@br1.pvp.net`, nome: `amigo ${i}` }));
  const ks = s.lat.estado().abas.map(a => a.k);
  caso(`até ${MAX_CONVERSAS} conversas: a 4ª fecha a mais antiga; o painel continua 360 (abas, nunca passa de 1080)`,
    ks.length === MAX_CONVERSAS && !ks.includes('c:x1@br1.pvp.net') && s.win.w === 780, JSON.stringify([ks, s.win.w]));
  // monitor pequeno: lista + conversa não cabem → a conversa entra no lugar da lista (←)
  const p = cenario({ mon: 'pequeno', x: 0 });
  await p.ir('Lobby');
  await p.passo(() => p.lat.alternarLista());
  await p.passo(() => p.lat.abrirConversa(A1));
  const l1 = p.lat.layout();
  await p.passo(() => p.lat.voltarLista());
  const l2 = p.lat.layout();
  caso('monitor pequeno (1024 CSS úteis): a conversa entra no lugar da lista e ← volta à lista; nunca 1080',
    l1.estreito && l1.painel && !l1.lista && l2.lista && !l2.painel && p.win.w === 720, JSON.stringify([l1, l2, p.win.w]));
  await p.passo(() => p.lat.alternarConfig());
  caso('monitor pequeno: abrir as configurações quando não cabe com o chat fecha o chat (o que ele abriu por último vence) e avisa',
    p.lat.estado().config && !p.lat.estado().lista && p.lat.estado().abas.length === 0 && p.win.w === 780 && p.avisos.some(([m]) => /fechei o chat/.test(m)), JSON.stringify([p.lat.estado(), p.avisos]));
  globalThis.document = ANTES.document;
}

// =================== 5. A2: fases ===================
{
  const champ = { partidas: () => [], estatisticas: () => ({ geral: { n: 93, winrate: 51, kda: 1.5 }, posicao: { pos: 'TOP', n: 88, winrate: 51, kda: 1.5 } }),
    coach: () => ({ campeao: 58, em: 0, dados: null, fora: true }), lerCoach: async () => {}, estado: () => ({ falhou: 0 }) };
  const s = cenario({ champ });
  await s.ir('Lobby');
  s.ancora = s.win.x;
  await s.passo(() => s.lat.abrirConversa(A1));
  s.est.sessao = sessaoCS(0, 58, 24);
  s.rot.aoFase('ChampSelect');
  s.rot.aoSessao({ gameData: { queue: { id: 420, mapId: 11 } }, map: { id: 11 } });
  await tick(8); await s.geo.ocioso(); await tick(4);
  caso('seleção: a conversa aberta segue ao lado (780) e a coluna não anda', s.win.w === 780 && s.win.x === 640 && s.rot.estado().tela === 'champselect', JSON.stringify([s.win, s.rot.estado().tela]));
  // mensagem nova na seleção: nunca abre nada sozinha
  await s.passo(() => s.lat.fecharAba('c:a1@br1.pvp.net'));
  s.lat.talvezAbrirSozinha(await s.lat.lerConversas());
  s.est.conversas[0].unreadMessageCount = 2;
  await s.passo(async () => s.lat.talvezAbrirSozinha(await s.lat.lerConversas()));
  caso('decisão 1: mensagem nova na seleção não abre nada (a coluna não anda embaixo do mouse perto do TRAVAR)', s.lat.estado().abas.length === 0 && s.win.w === 420, JSON.stringify(s.lat.estado().abas));
  // 📊 coach
  await s.passo(() => s.lat.alternarCoach());
  caso('📊: o coach abre ao lado (780) só no clique', s.win.w === 780 && s.lat.estado().abas.some(a => a.k === 'coach'), JSON.stringify(s.lat.estado()));
  // sala do time
  await s.passo(() => s.lat.abrirTime());
  await s.passo(() => s.lat.volta());
  const texto = s.partes().dir.textContent;
  caso('sala do time: quem fala aparece como campeão/posição ("Selva", "Meio", "aliado"); nome oculto nunca na tela; da sala ficam só id e type',
    /Selva/.test(texto) && /vou de lee/.test(texto) && /Meio/.test(texto) && /aliado/.test(texto) && !texto.includes(NOME_OCULTO) && !texto.includes(NUNCA), texto.slice(0, 400));
  const ta = s.partes().dir.querySelector('[data-a="lt-texto"]');
  ta.value = 'top aqui';
  ta.disparar('keydown', { key: 'Enter' });
  await tick(12);
  const envio = s.falsa.escritas().find(c => c.url.includes(encodeURIComponent(SALA_CS)));
  caso('sala do time: Enter dele envia com o corpo do client {type:"chat", fromId, fromSummonerId, isHistorical:false, timestamp, body}',
    envio && envio.corpo.type === 'chat' && envio.corpo.body === 'top aqui' && envio.corpo.fromId === 'eu@br1.pvp.net' && envio.corpo.fromSummonerId === 111 && envio.corpo.isHistorical === false
      && typeof envio.corpo.timestamp === 'string', JSON.stringify(envio));
  const nEsc = s.falsa.escritas().length;
  ta.value = 'sintético';
  ta.disparar('keydown', { key: 'Enter', isTrusted: false });
  await tick(8);
  caso('sala do time: Enter sintético (isTrusted false) não envia', s.falsa.escritas().length === nEsc);
  // em partida (passo 14): tela compacta "jogo" só com a coluna (420); a lateral some e guarda; coach e sala do time saem do estado
  await s.passo(() => s.lat.abrirConversa(A1));
  const nPart = s.win.pedidos.length;
  await s.ir('InProgress');
  const naPartida = s.win.pedidos.slice(nPart).map(p => p.name);
  caso('em partida: tela compacta "jogo" em 420 (lateral fora da janela), coach e sala do time saem, a conversa fica guardada',
    s.win.w === 420 && s.rot.estado().tela === 'jogo' && !!s.doc.getElementById('lc-compacto') && s.partes().dir.children.length === 0
      && igual(s.rot.estado().lateral, { esq: 0, dir: 0 }) && igual(s.lat.estado().abas.map(a => a.k), ['c:a1@br1.pvp.net']) && s.lat.estado().lembrarCoach === true,
    JSON.stringify([s.win, s.rot.estado().lateral, s.lat.estado().abas]));
  caso('em partida: a janela só recebe ResizeTo (nada de MoveTo/CenterToScreen com o jogo abrindo)', naPartida.length >= 1 && naPartida.every(n => n === 'Window.ResizeTo'), naPartida.join());
  const leiturasAntes = s.falsa.chamadas?.length ?? null;
  await s.passo(() => s.lat.volta());
  caso('em partida: o relógio da lateral não lê nada da LCU', leiturasAntes === null || s.falsa.chamadas.length === leiturasAntes, String(leiturasAntes));
  const xJogo = s.win.x;
  await s.ir('EndOfGame');
  s.ancora = xJogo;
  caso('decisão 2: depois da partida a lateral volta (pós-jogo 780 com a conversa ao lado)', s.win.w === 780 && s.rot.estado().tela === 'posjogo' && s.partes().dir.children.length === 1 && conferir(s).length === 0,
    JSON.stringify([s.win, conferir(s)]));
  // próxima seleção: o coach volta aberto (ele deixou aberto) só se couber sem mover
  await s.ir('Lobby');
  await s.passo(() => s.lat.fecharAba('c:a1@br1.pvp.net'));
  s.rot.aoFase('ChampSelect');
  s.rot.aoSessao({ gameData: { queue: { id: 420, mapId: 11 } }, map: { id: 11 } });
  await tick(8); await s.geo.ocioso(); await tick(4);
  caso('próxima seleção: o coach volta aberto porque ele deixou aberto (cabe sem mover)', s.lat.estado().abas.some(a => a.k === 'coach') && s.win.w === 780, JSON.stringify([s.lat.estado().abas, s.win]));
  await s.ir('Lobby');
  s.win.x = 2560 - 420 * 1.25; // encostada à direita: o coach não cabe sem mover
  await s.passo(() => s.lat.alternarLista()); await s.passo(() => s.lat.alternarLista()); // relê a tela (geometria)
  s.rot.aoFase('ChampSelect');
  s.rot.aoSessao({ gameData: { queue: { id: 420, mapId: 11 } }, map: { id: 11 } });
  await tick(8); await s.geo.ocioso(); await tick(4);
  caso('próxima seleção encostada à direita: o coach NÃO abre sozinho (precisaria mover a janela)', !s.lat.estado().abas.some(a => a.k === 'coach') && s.win.w === 420, JSON.stringify([s.lat.estado().abas, s.win]));
  globalThis.document = ANTES.document;
}

{
  // corrida: coach (ou sala do time) aberto na seleção, sem conversa, e a partida começa. O gancho da fase tira a aba (a largura
  // muda, a geometria enfileira), o roteador expande na mesma volta: a tarefa atrasada não pode encolher nem mover o client de 1280
  for (const comConfig of [false, true]) {
    const champ = { partidas: () => [], estatisticas: () => ({ geral: { n: 0 } }), coach: () => ({}), lerCoach: async () => {}, estado: () => ({}) };
    const s = cenario({ champ });
    await s.ir('Lobby');
    if (comConfig) await s.passo(() => s.lat.alternarConfig());
    s.est.sessao = sessaoCS(58);
    s.rot.aoFase('ChampSelect');
    s.rot.aoSessao({ gameData: { queue: { id: 420, mapId: 11 } }, map: { id: 11 } });
    await tick(8); await s.geo.ocioso();
    await s.passo(() => s.lat.alternarCoach());
    const n = s.win.pedidos.length;
    await s.ir('InProgress'); await tick(8); await s.geo.ocioso(); await tick(8);
    const depois = s.win.pedidos.slice(n).map(p => `${p.name} ${p.params.join('x')}`);
    // passo 14: a partida fica compacta (tela "jogo", só a coluna); a geometria não anda a janela com o jogo abrindo
    caso(`partida começa com o coach aberto${comConfig ? ' e as configurações à esquerda' : ''}: tela de jogo em 420, só ResizeTo, nada de MoveTo`,
      s.win.w === 420 && s.rot.estado().tela === 'jogo' && depois.length >= 1 && depois.every(p => p.startsWith('Window.ResizeTo')), JSON.stringify(depois));
  }
  globalThis.document = ANTES.document;
}

{
  // corrida da revisão adversarial do passo 14 (achado 1): ele fecha ⚙ (painel da ESQUERDA: a geometria teria de andar a janela)
  // nos últimos ms da seleção e a fase vira GameStart antes de a tarefa da geometria rodar. Antes do passo 14 a fase expandia e a
  // guarda ativo() abortava; com a tela "jogo" compacta a guarda dava verdadeiro e saíam ResizeTo + MoveTo com o jogo abrindo
  const champ = { partidas: () => [], estatisticas: () => ({ geral: { n: 0 } }), coach: () => ({}), lerCoach: async () => {}, estado: () => ({}) };
  const s = cenario({ champ });
  await s.ir('Lobby');
  await s.passo(() => s.lat.alternarConfig());
  s.est.sessao = sessaoCS(58);
  s.rot.aoFase('ChampSelect');
  s.rot.aoSessao({ gameData: { queue: { id: 420, mapId: 11 } }, map: { id: 11 } });
  await tick(8); await s.geo.ocioso(); await tick(4);
  const esqAntes = s.rot.estado().lateral.esq;
  const n = s.win.pedidos.length;
  s.lat.alternarConfig(); // fecha ⚙: pedirLateral enfileira a tarefa da geometria (sem esperar)
  s.rot.aoFase('GameStart'); // a fase vira na mesma volta, antes do ScreenData
  await tick(8); await s.geo.ocioso(); await tick(8); await s.geo.ocioso(); await tick(8);
  const depois = s.win.pedidos.slice(n).map(p => `${p.name} ${p.params.join('x')}`);
  caso('corrida ⚙ fechada + GameStart: a tarefa atrasada da geometria não move a janela (nenhum MoveTo/CenterToScreen na partida)',
    esqAntes > 0 && s.rot.estado().tela === 'jogo' && !depois.some(p => /MoveTo|CenterToScreen/.test(p)),
    JSON.stringify([esqAntes, depois]));
  globalThis.document = ANTES.document;
}

// =================== 6. decisão 1: mensagem nova ===================
{
  const novaMsg = async s => { s.est.conversas[0].unreadMessageCount += 1; s.est.conversas[0].lastMessage = { fromId: 'a1@br1.pvp.net' }; await s.passo(async () => s.lat.talvezAbrirSozinha(await s.lat.lerConversas())); };
  const prepara = async s => { await s.ir('Lobby'); await s.lcu('GET', '/lol-chat/v1/me'); await s.lat.volta(); s.lat.talvezAbrirSozinha(await s.lat.lerConversas()); };
  const s = cenario();
  await prepara(s);
  await novaMsg(s);
  const a = s.lat.estado();
  caso('lobby com espaço: mensagem nova abre a conversa ao lado sem mover a janela (coluna parada, sem foco no campo)',
    a.abas.some(x => x.k === 'c:a1@br1.pvp.net') && s.win.w === 780 && s.win.x === 640 && !s.doc.ativo, JSON.stringify([a.abas, s.win, !!s.doc.ativo]));
  caso('mensagem nova aberta sozinha não marca como lida (nenhum PUT active sem clique ou tecla dele)', !s.falsa.escritas().some(c => c.url.includes('conversations/active')), JSON.stringify(s.falsa.escritas()));
  const d = cenario({ x: 2560 - 420 * 1.25 });
  await prepara(d);
  await novaMsg(d);
  caso('encostada à direita: mensagem nova NÃO abre (teria de mover a janela); só conta', d.lat.estado().abas.length === 0 && d.win.w === 420, JSON.stringify(d.lat.estado().abas));
  const o = cenario({ cfgCompacto: { conversaSozinha: false } });
  await prepara(o);
  await novaMsg(o);
  caso('chave "abrir a conversa sozinha" desligada: nada abre', o.lat.estado().abas.length === 0);
  const m = cenario();
  await prepara(m);
  m.est.conversas[0].unreadMessageCount += 1; m.est.conversas[0].lastMessage = { fromId: 'eu@br1.pvp.net' };
  await m.passo(async () => m.lat.talvezAbrirSozinha(await m.lat.lerConversas()));
  caso('última mensagem é minha (mandada pelo chat da Riot): nada abre', m.lat.estado().abas.length === 0, JSON.stringify(m.lat.estado().abas));
  globalThis.document = ANTES.document;
}

// =================== 7. escrita só por clique, corpos do client ===================
{
  const s = cenario();
  await s.ir('Lobby');
  await s.passo(() => s.lat.alternarLista());
  await s.passo(() => s.lat.lerAmigos());
  const lista = s.partes().dir.querySelector('[data-painel="lista"]');
  const txt = lista.textContent;
  caso('lista: online agrupada, "amigo 2" em partida com a fila, offline recolhido, 2 pedidos de amizade recebidos',
    /duo de sempre \(1\)/.test(txt) && /em partida · Solo\/Duo/.test(txt) && /offline \(1\)/.test(txt) && !/amigo 3/.test(txt) && /2 pedidos de amizade/.test(txt), txt.slice(0, 300));
  const conv = lista.querySelector('[data-a="lt-convidar"]');
  conv.click({ isTrusted: false });
  await tick(8);
  caso('convidar com clique sintético: nada sai', s.falsa.escritas().length === 0);
  conv.click();
  await tick(10);
  const inv = s.falsa.escritas().find(c => c.url === '/lol-lobby/v2/lobby/invitations');
  caso('convidar: clique dele manda o corpo da Riot [{toSummonerId}] (invitePlayer do rcp-fe-lol-parties)', inv && igual(inv.corpo, [{ toSummonerId: 201 }]), JSON.stringify(inv));
  const listaAgora = s.partes().dir.querySelector('[data-painel="lista"]');
  caso('amigo em partida não tem "convidar"', [...listaAgora.querySelectorAll('[data-a="lt-amigo"]')].find(n => n.dataset.pid === 'a2@br1.pvp.net')?.querySelector('[data-a="lt-convidar"]') === null);
  // conversa: clique no amigo abre; Enter envia com o corpo do client; "lida" só depois de interação dele
  [...listaAgora.querySelectorAll('[data-a="lt-amigo"]')].find(n => n.dataset.pid === 'a1@br1.pvp.net').click();
  await tick(10); await s.geo.ocioso(); await tick(6);
  const painel = s.partes().dir.querySelector('[data-painel="painel"]');
  caso('conversa aberta pelo clique: mensagens à vista, nenhum PUT active ainda', /bora uma duo\?/.test(painel.textContent) && !s.falsa.escritas().some(c => c.url.endsWith('/active')), painel.textContent.slice(0, 200));
  const campo = painel.querySelector('[data-a="lt-texto"]');
  s.est.conversas[0].unreadMessageCount = 1;
  await s.lat.lerConversas();
  campo.disparar('pointerdown');
  await tick(6);
  const put = s.falsa.escritas().find(c => c.url === '/lol-chat/v1/conversations/active');
  caso('"lida": clique dele na conversa vira a ativa do client (PUT conversations/active {id}, setActive da Riot)', put && put.metodo === 'PUT' && igual(put.corpo, { id: 'a1@br1.pvp.net' }), JSON.stringify(put));
  campo.value = 'bora';
  campo.disparar('keydown', { key: 'Enter' });
  await tick(14);
  const msg = s.falsa.escritas().find(c => c.metodo === 'POST' && c.url.includes(encodeURIComponent('a1@br1.pvp.net')));
  caso('enviar: Enter dele, corpo do client e o campo limpa', msg && msg.corpo.type === 'chat' && msg.corpo.body === 'bora' && msg.corpo.fromId === 'eu@br1.pvp.net' && campo.value === '', JSON.stringify(msg));
  await s.passo(() => s.lat.volta());
  const campo2 = s.partes().dir.querySelector('[data-a="lt-texto"]');
  caso('o campo de texto é o mesmo depois de repintar (não perde o foco no meio da digitação)', campo2 === campo);
  await s.passo(() => s.lat.fecharAba('c:a1@br1.pvp.net'));
  caso('fechar a aba que ele marcou como ativa devolve (DELETE conversations/active, o mesmo da Riot)', s.falsa.escritas().some(c => c.metodo === 'DELETE' && c.url === '/lol-chat/v1/conversations/active'));
  // amigo sem conversa ainda: cria pelo corpo do client e tenta uma vez
  await s.passo(() => s.lat.abrirConversa(A2));
  const c2 = s.partes().dir.querySelector('[data-a="lt-texto"]');
  c2.value = 'gg';
  c2.disparar('keydown', { key: 'Enter' });
  await tick(16);
  const cria = s.falsa.escritas().find(c => c.url === '/lol-chat/v1/conversations' && c.metodo === 'POST');
  caso('amigo sem conversa: POST /lol-chat/v1/conversations {id, type:"chat"} (_createConversation da Riot) e manda de novo', cria && igual(cria.corpo, { id: 'a2@br1.pvp.net', type: 'chat' })
    && s.falsa.escritas().filter(c => c.url.includes(encodeURIComponent('a2@br1.pvp.net'))).length === 2, JSON.stringify(s.falsa.escritas().slice(-3)));
  // chat bloqueado pela Riot
  s.est.mudo = true;
  for (let i = 0; i < 4; i++) await s.passo(() => s.lat.volta()); // o bloqueio é relido a cada 4 voltas (~6 s)
  const c3 = s.partes().dir.querySelector('[data-a="lt-texto"]');
  caso('chat bloqueado pela Riot (isSystemMuted): campo cinza com o motivo', c3.disabled === true && /bloqueado pela Riot/.test(s.partes().dir.textContent));
  globalThis.document = ANTES.document;
}

// =================== 8. chat desligado, ⚙ e configurações da Riot ===================
{
  const s = cenario({ cfgCompacto: { chatLateral: false } });
  await s.ir('Lobby');
  caso('chat ao lado desligado: 💬 não abre a lateral (o botão cai nas janelas do coletor)', s.lat.alternarLista() === false && s.win.w === 420);
  s.cfg.compacto.chatLateral = true;
  await s.passo(() => s.lat.alternarLista());
  await s.passo(() => s.lat.abrirConversa(A1));
  s.cfg.compacto.chatLateral = false;
  await s.passo(() => s.lat.sincronizar());
  caso('desligar a chave com a conversa aberta: lista e conversa fecham na hora (420)', s.win.w === 420 && s.lat.estado().abas.length === 0 && !s.lat.estado().lista, JSON.stringify(s.lat.estado()));
  // ⚙ com o cfg de verdade (PADRAO): os blocos da seção lol-client, sem "restaurar padrão"
  const r = cenario();
  const cfgReal = JSON.parse(JSON.stringify(PADRAO));
  Object.assign(r.cfg, cfgReal, { compacto: { ...cfgReal.compacto } });
  await r.ir('Lobby');
  await r.passo(() => r.lat.alternarConfig());
  const pcfg = r.partes().esq.querySelector('[data-painel="config"]');
  const tc = pcfg.textContent;
  caso('⚙: painel à esquerda com os blocos do lol-client (Interface, Aceitar partida, Fila rápida...) e sem "Restaurar padrão"',
    /Interface/.test(tc) && /Aceitar partida/.test(tc) && /Fila rápida/.test(tc) && !/Restaurar padrão/.test(tc) && /Configurações da Riot/.test(tc), tc.slice(0, 300));
  const bloco = [...pcfg.querySelectorAll('[data-a="cfg-bloco"]')].find(b => b.dataset.bloco === 'Aceitar partida');
  bloco.click();
  caso('⚙: um bloco aberto por vez (clicar "Aceitar partida" abre ele)', /Aceitar partida automaticamente/.test(pcfg.textContent), pcfg.textContent.slice(0, 200));
  const busca = pcfg.querySelector('[data-a="cfg-busca"]');
  busca.value = 'madrugada'; busca.disparar('input');
  caso('⚙: busca acha a opção em qualquer bloco ("madrugada" → Fila rápida)', /Pedir confirmação de madrugada/.test(pcfg.textContent) && !/Aceitar partida automaticamente/.test(pcfg.textContent));
  const nAntes = r.win.pedidos.length;
  pcfg.querySelector('[data-a="cfg-riot"]').click();
  await tick(8); await r.geo.ocioso();
  caso('Configurações da Riot: abre o client normal (o modal dela é de 1280)', r.rot.estado().efetivo === 'expandido' && r.win.w === 1280 && r.configRiot === 1, JSON.stringify([r.rot.estado().forcado, r.win.w]));
  r.rot.configRiotFechou(); await tick(8); await r.geo.ocioso(); await tick(6);
  caso('fechou as Configurações da Riot: volta ao compacto com as configurações do lol-client abertas à esquerda (comportamento novo, decisão v)',
    r.rot.estado().efetivo === 'compacto' && r.win.w === 780 && r.partes().esq.children.length === 1, JSON.stringify([r.rot.estado().efetivo, r.win.w, r.win.pedidos.slice(nAntes).map(p => p.name)]));
  globalThis.document = ANTES.document;
}

// =================== 9. puros: lista, sala do time, coach, última partida ===================
{
  const v = verAmigos({ amigos: AMIGOS(), conversas: [{ id: 'a1@br1.pvp.net', pid: 'a1@br1.pvp.net', type: 'chat', unreadMessageCount: 3 }, { id: SALA_CS, type: 'championSelect', unreadMessageCount: 9 }],
    lobby: lobbyParaConvite({ ok: true, status: 200, json: { localMember: { isLeader: false, allowedInviteOthers: false }, members: [] } }) });
  caso('verAmigos: sala de grupo não conta como não lida; não-líder vê "convidar" cinza com o motivo; em partida sem convidar',
    v.naoLidas === 3 && v.online[0].convidar.ok === false && /só o líder/.test(v.online[0].convidar.motivo) && v.online[1].convidar.mostra === false, JSON.stringify(v));
  caso('lobby: sem lobby = "abre o lobby antes"; erro = não sei (nunca convida)', lobbyParaConvite({ ok: false, status: 404 }).tem === false && lobbyParaConvite({ ok: false, status: 0 }).tem === null);
  caso('status: no celular, ausente, na fila, no lobby', statusAmigo({ availability: 'mobile' }).txt === 'no celular' && statusAmigo({ availability: 'away' }).txt === 'ausente'
    && statusAmigo({ availability: 'chat', lol: { gameStatus: 'inQueue', queueId: 440 } }).txt === 'na fila · Flex' && statusAmigo({ availability: 'chat', lol: { gameStatus: 'hosting_RANKED_SOLO_5x5' } }).txt === 'no lobby · Solo/Duo');
  caso('pedidos de amizade: só os recebidos', pedidosRecebidos([{ direction: 'in' }, { direction: 'out' }, { direction: 'IN' }]) === 2 && pedidosRecebidos(null) === 0);
  caso('sala do time: só type championSelect, e só id/type saem', igual(acharSalaTime([{ id: 'x', type: 'chat' }, { id: SALA_CS, type: 'championSelect', extra: NUNCA }]), { id: SALA_CS, type: 'championSelect' }));
  const linhas = lerSalaTime([{ id: '1', type: 'groupchat', body: 'oi', fromSummonerId: 900 }, { id: '2', type: 'chat', body: 'eu', fromId: 'eu@br1.pvp.net' }, { id: '3', type: 'system', body: 'joined_room' }],
    elencoTime(sessaoCS(58)), { id: 'eu@br1.pvp.net', puuid: 'puuid-eu' });
  caso('sala do time: remetente casado pelo summonerId vira campeão/posição; eu = "tu"; sistema some; nenhum nome na saída',
    linhas.length === 2 && linhas[0].quem.posicao === 'JUNGLE' && linhas[0].quem.campeao === 64 && linhas[1].quem.eu && !JSON.stringify(linhas).includes(NOME_OCULTO), JSON.stringify(linhas));
  caso('elenco do time: guarda campeão/posição e as chaves só em Set (nenhum gameName)', !JSON.stringify(elencoTime(sessaoCS(58)).map(x => ({ ...x, chaves: [...x.chaves] }))).includes(NOME_OCULTO));
  caso('conversa: mensagens minhas por fromId, sistema separado', igual(lerConversa([{ id: 1, body: 'a', fromId: 'eu' }, { id: 2, body: 'b', fromId: 'x', type: 'system' }], { id: 'eu' }).map(m => [m.eu, m.sis]), [[true, false], [false, true]]));
  const nome = id => ({ 58: 'Renekton', 24: 'Jax' }[id] || `campeão ${id}`);
  const est = { geral: { n: 93, winrate: 51, kda: 1.5 }, posicao: { pos: 'TOP', n: 88, winrate: 51, kda: 1.5 } };
  const coach = { campeao: 58, dados: { draft: { inimigos: [{ campeao: 24, rota: 'TOP' }], aliados: [{ campeao: 64 }], faixa: 'leve vantagem', p: 0.56, termos: [{ pp: 1.2, texto: 'dano misto no teu time' }] },
    matchups: [{ campeao: 58, adversario: 24, papel: 'TOP', n: 6, vitorias: 2, ouro10: -441 }], traumas: [{ campeao: 24, trauma: true, lift: 1.4, vitorias: 2, derrotas: 4 }] } };
  const m1 = modeloSelo({ sessao: sessaoCS(58, 58, 24), est, histN: 200, coach, nome, fila: 420 });
  caso('coach travado: selo com geral e posição, matchup contra o adversário travado, trauma e draft com a barra',
    m1.travado && m1.linhas.length === 2 && /contra Jax: 2V\/4D · ouro10 −441/.test(m1.rota?.texto) && /Jax é trauma: 2V\/4D/.test(m1.trauma) && m1.draft?.faixa === 'draft: leve vantagem' && m1.draft.p === 0.56
      && m1.sub === 'tu · Topo · Solo/Duo', JSON.stringify(m1));
  const m2 = modeloSelo({ sessao: sessaoCS(0, 58, 0), est, coach, nome, traumas: false });
  caso('coach em hover, adversário ainda não travou: sem linha de matchup; trauma desligado não aparece', !m2.travado && !m2.rota && !m2.trauma, JSON.stringify(m2));
  const m3 = modeloSelo({ sessao: sessaoCS(58), est: null, coach: { campeao: 58, fora: true, dados: null }, nome });
  caso('coletor fora / histórico ainda não lido: "carregando histórico…" e a marca de coletor fora', m3.fora && /carregando/.test(m3.linhas[0]), JSON.stringify(m3));
  caso('sem campeão em hover nem travado: o painel pede para passar o mouse', !!modeloSelo({ sessao: { localPlayerCellId: 2, myTeam: [{ cellId: 2 }], actions: [] } }).vazio && meuNaSessao(null) === null);
  caso('📊 última partida: pronta / analisando / falhou / nunca / descartada',
    linhaUltima({ gameId: 1, pronta: true, resumo: { vitoria: false, campeao: 58, k: 8, d: 9, a: 5, fila: 400, criacao: 0 } }, nome).titulo === '📊 última partida: derrota · Renekton 8/9/5'
      && linhaUltima({ gameId: 1, pronta: false }).botao.acao === null && linhaUltima({ gameId: 1, pronta: false, erro: 'x' }).botao.rotulo === 'tentar de novo'
      && linhaUltima({ nunca: true }).botao.acao === 'analisar' && linhaUltima(null) === null);
  // botões das telas: sem lateral (teste antigo) não aparecem; com ela, chamam o clique certo
  const doc = novoDoc();
  let chamado = '';
  const ctx = { extras: doc.createElement('div'), seguro: f => f, servicos: { lateral: { alternarCoach: () => { chamado += 'coach'; }, alternarConfig: () => { chamado += 'config'; } } } };
  botaoCoach(ctx).click(); botaoConfig(ctx).click();
  caso('📊 e ⚙ chamam a lateral; sem lateral não existem', chamado === 'coachconfig' && botaoCoach({ extras: doc.createElement('div'), servicos: {} }) === null);
}

// =================== 10. revisão adversarial de 14/10/2026 ===================
const novaMsgDe = async (s, i = 0) => { s.est.conversas[i].unreadMessageCount += 1; s.est.conversas[i].lastMessage = { fromId: s.est.conversas[i].id }; await s.passo(async () => s.lat.talvezAbrirSozinha(await s.lat.lerConversas())); };
const preparaMsg = async s => { await s.ir('Lobby'); await s.lcu('GET', '/lol-chat/v1/me'); await s.lat.volta(); s.lat.talvezAbrirSozinha(await s.lat.lerConversas()); };
const PERTO_DIREITA = 2560 - 420 * 1.25 - 10; // 2025: 780 não cabe sem mover
{
  // achado 1, sintoma A: o 2º arrasto partia da posição do 1º (a geometria só relia a tela na tarefa dela)
  const s = cenario();
  await s.ir('Lobby');
  await s.arrastar(100);
  const x1 = s.win.x;
  await s.arrastar(10, 8);
  caso('arrasto: o 2º arrasto parte de onde o 1º deixou (antes: saltava de volta ao lugar do 1º); delta × zoomScale (100 px da página = 125 físicos)',
    x1 === 765 && s.win.x === 778 && s.win.y === 110, JSON.stringify([x1, s.win.x, s.win.y]));
  // depois do arrasto, abrir a lista usa o lugar novo como âncora
  s.ancora = s.win.x;
  await s.passo(() => s.lat.alternarLista());
  caso('arrasto e depois 💬: a coluna fica onde ele largou (âncora nova)', s.win.x === 778 && s.win.w === 720 && conferir(s).length === 0, JSON.stringify([s.win, conferir(s)]));
  // no MEIO do arrasto (botão ainda apertado, antes da releitura do fim) a geometria já sabe onde a janela está
  s.arrasto.down({ button: 0, screenX: 0, screenY: 0, target: null });
  s.arrasto.move({ screenX: -40, screenY: 0 });
  const meio = s.geo.tela()?.x;
  s.arrasto.up(); await tick(4);
  caso('arrasto: cada MoveTo do arrasto já vale para a geometria (anotarPosicao), sem esperar o fim', meio === 728 && s.win.x === 728, JSON.stringify([meio, s.win.x]));
  // o Windows não pôs a janela exatamente onde o MoveTo pediu (encaixe): o fim do arrasto relê a posição de verdade
  s.win.ajusteMove = (x, y) => [x - (x % 16), y];
  await s.arrastar(-9);
  caso('fim do arrasto relê o ScreenData: a geometria fica com a posição real, não com a pedida', s.geo.tela()?.x === s.win.x && s.win.x % 16 === 0, JSON.stringify([s.geo.tela()?.x, s.win.x]));
  s.win.ajusteMove = null;
  globalThis.document = ANTES.document;
}
{
  // achado 1, sintoma B: arrastou para perto da borda direita e chegou mensagem: a conta velha dizia "cabe" e a janela andava
  const s = cenario();
  await preparaMsg(s);
  await s.arrastar(Math.round((PERTO_DIREITA - s.win.x) / 1.25));
  const xArr = s.win.x;
  const n = s.win.pedidos.length;
  await novaMsgDe(s);
  caso('decisão 1 depois de arrastar para a borda direita: mensagem nova NÃO abre e a janela não anda', s.lat.estado().abas.length === 0 && s.win.w === 420 && s.win.x === xArr
    && !s.win.pedidos.slice(n).some(p => p.name === 'Window.MoveTo'), JSON.stringify([s.lat.estado().abas, s.win.x, xArr, s.win.pedidos.slice(n)]));
  // garantia: a janela foi para a borda SEM a geometria saber (a última tela lida diz que cabe): a tarefa relê, recusa e desfaz
  const g = cenario();
  await preparaMsg(g);
  g.win.x = PERTO_DIREITA;
  const n2 = g.win.pedidos.length;
  await novaMsgDe(g);
  caso('decisão 1 garantida na geometria: tela velha diz "cabe", a releitura diz "teria de mover" → nenhuma aba, nenhum MoveTo, largura de volta a 420',
    g.lat.estado().abas.length === 0 && g.win.w === 420 && g.win.x === PERTO_DIREITA && !g.win.pedidos.slice(n2).some(p => p.name === 'Window.MoveTo')
      && !g.win.pedidos.slice(n2).some(p => p.name === 'Window.ResizeTo' && p.params[0] !== 420) && g.geo.estado().recusas >= 1 && conferir(g).length === 0,
    JSON.stringify([g.lat.estado().abas, g.win, g.win.pedidos.slice(n2), g.geo.estado().recusas]));
  // o coach lembrado volta na próxima seleção pela mesma garantia
  const champ = { partidas: () => [], estatisticas: () => ({ geral: { n: 0 } }), coach: () => ({}), lerCoach: async () => {}, estado: () => ({}) };
  const c = cenario({ champ });
  await c.ir('Lobby');
  c.est.sessao = sessaoCS(58);
  c.rot.aoFase('ChampSelect'); c.rot.aoSessao({ gameData: { queue: { id: 420, mapId: 11 } }, map: { id: 11 } });
  await tick(8); await c.geo.ocioso();
  await c.passo(() => c.lat.alternarCoach());
  await c.ir('Lobby');
  c.win.x = PERTO_DIREITA; // sem reler: a geometria ainda acha que a janela está em 640
  const n3 = c.win.pedidos.length;
  c.rot.aoFase('ChampSelect'); c.rot.aoSessao({ gameData: { queue: { id: 420, mapId: 11 } }, map: { id: 11 } });
  await tick(8); await c.geo.ocioso(); await tick(8); await c.geo.ocioso();
  caso('coach lembrado na próxima seleção com a tela velha: a geometria recusa, o coach não abre, a coluna não anda; segue lembrado para o 📊',
    !c.lat.estado().abas.some(a => a.k === 'coach') && c.lat.estado().lembrarCoach === true && c.win.x === PERTO_DIREITA && c.win.w === 420
      && !c.win.pedidos.slice(n3).some(p => p.name === 'Window.MoveTo'), JSON.stringify([c.lat.estado().abas, c.win, c.win.pedidos.slice(n3)]));
  globalThis.document = ANTES.document;
}
{
  // achado 2: as variáveis CSS saem na tarefa da geometria, junto do MoveTo (antes: na hora do clique, coluna fora de vista)
  const s = cenario();
  await s.ir('Lobby');
  const n = s.win.pedidos.length;
  s.lat.alternarConfig();
  const naHora = s.camada.medidas().esq;
  await tick(8); await s.geo.ocioso(); await tick(8);
  const abre = s.win.pedidos.slice(n).map(p => [p.name, p.esqCss]);
  const n2 = s.win.pedidos.length;
  s.lat.alternarConfig();
  const naHora2 = s.camada.medidas().esq;
  await tick(8); await s.geo.ocioso(); await tick(8);
  const fecha = s.win.pedidos.slice(n2).map(p => [p.name, p.esqCss]);
  // desde 15/10/2026: crescer = ResizeTo com a esquerda VELHA (0) e o CSS novo só na volta do MoveTo; encolher = CSS e MoveTo
  // juntos, ResizeTo por último
  caso('⚙ abre: no clique a variável fica em 0 (a coluna não sai de vista); ResizeTo ainda com 0, MoveTo já com 360',
    naHora === 0 && igual(abre, [['Window.ResizeTo', 0], ['Window.MoveTo', 360]]), JSON.stringify([naHora, abre]));
  caso('⚙ fecha: no clique segue 360; MoveTo já com 0 (CSS e MoveTo juntos), ResizeTo por último',
    naHora2 === 360 && igual(fecha, [['Window.MoveTo', 0], ['Window.ResizeTo', 0]]), JSON.stringify([naHora2, fecha]));
  caso('CSS: a esquerda vazia não some (sem .lc-cp-esq:empty), senão a coluna pulava para a esquerda antes do MoveTo',
    !/\.lc-cp-esq:empty/.test(CSS_MODO) && /\.lc-cp-dir:empty/.test(CSS_MODO));
  globalThis.document = ANTES.document;
}
{
  // achado 3: com riotInvoke, timeout/erro = null (a reserva com screenX × dpr mistura unidades no client)
  const mudo = await lerTelaRiot({ riotInvoke() {}, screenX: 100, screenY: 100, devicePixelRatio: 1.25, screen: { availWidth: 2048, availHeight: 816 } }, { prazoMs: 5 });
  const lanca = await lerTelaRiot({ riotInvoke() { throw new Error('x'); }, screenX: 100, screen: { availWidth: 2048, availHeight: 816 } });
  const lixo = await lerTelaRiot({ riotInvoke(a) { a.onSuccess('{"result":"nao é json"}'); }, screenX: 100, screen: { availWidth: 2048, availHeight: 816 } });
  const harness = await lerTelaRiot({ screenX: 100, screenY: 50, devicePixelRatio: 1.25, screen: { availLeft: 0, availTop: 0, availWidth: 2048, availHeight: 816 } });
  caso('ScreenData sem resposta, com erro ou ilegível = null (nunca a reserva no client); sem riotInvoke (harness) = reserva × dpr',
    mudo === null && lanca === null && lixo === null && harness?.x === 125 && harness?.W === 2560, JSON.stringify([mudo, lanca, lixo, harness]));
  // sem tela: só redimensiona (nenhum MoveTo)
  const doc = novoDoc(); globalThis.document = doc;
  let movidas = 0, redim = 0, css = 0;
  const geo = criarGeometria({ lerTela: async () => null, mover: () => { movidas++; }, medidas: () => ({ larg: 780, alt: 680, esq: 360 }), esperar: async () => {} });
  await geo.aplicar({ redimensionar: () => { redim++; }, porCss: () => { css++; } });
  let recusou = 0;
  await geo.aplicar({ redimensionar: () => { redim++; }, porCss: () => { css++; }, soSemMover: true, aoRecusar: () => { recusou++; } });
  caso('sem tela lida: só CSS e ResizeTo, nenhum MoveTo; abertura automática sem tela = recusa (não sei se cabe)', movidas === 0 && redim === 1 && css === 1 && recusou === 1);
  globalThis.document = ANTES.document;
}
{
  // achado 11: ResizeTo que muda a posição só depois (assíncrono): a releitura espera e corrige
  const falhas = [];
  for (const abre of permutacoes(['lista', 'conversa', 'config'])) {
    const s = cenario({ canto: 'tarde' });
    await s.ir('Lobby');
    s.ancora = s.win.x;
    for (const op of [...abre, ...abre]) {
      await s.passo(() => (op === 'lista' ? s.lat.alternarLista() : op === 'config' ? s.lat.alternarConfig() : (s.lat.estado().abas.length ? s.lat.fecharAba('c:a1@br1.pvp.net') : s.lat.abrirConversa(A1))));
      await tick(4);
      const erros = conferir(s);
      if (erros.length) { falhas.push(`${abre} depois de ${op}: ${erros.join('; ')}`); break; }
    }
  }
  caso('ResizeTo que muda a posição uma volta depois (CEF assíncrono [S]): a geometria espera, relê e devolve a coluna à âncora, em toda ordem', falhas.length === 0, falhas.slice(0, 2).join(' | '));
  globalThis.document = ANTES.document;
}
{
  // achado 4: "lida" só enquanto a conversa está à vista
  const abrirEMarcar = async s => {
    await s.ir('Lobby');
    await s.passo(() => s.lat.abrirConversa(A1));
    s.partes().dir.querySelector('[data-a="lt-texto"]').disparar('pointerdown');
    await tick(6);
  };
  const deletes = s => s.falsa.escritas().filter(c => c.metodo === 'DELETE' && c.url === '/lol-chat/v1/conversations/active').length;
  const puts = s => s.falsa.escritas().filter(c => c.metodo === 'PUT' && c.url === '/lol-chat/v1/conversations/active').length;
  const a = cenario();
  await abrirEMarcar(a);
  const p1 = puts(a);
  await a.passo(() => a.lat.abrirConversa(A2));
  caso('lida: clicou na conversa A (PUT) e foi para a aba B → DELETE (A deixa de ser a ativa do client)', p1 === 1 && deletes(a) === 1 && a.lat.estado().ativaPorMim === null, JSON.stringify(a.falsa.escritas()));
  const b = cenario();
  await abrirEMarcar(b);
  await b.ir('InProgress');
  caso('lida: entrou em partida (a lateral some da tela de jogo) → DELETE', deletes(b) === 1 && b.lat.estado().ativaPorMim === null);
  const c = cenario();
  await abrirEMarcar(c);
  c.lat.aoOculto(); await tick(4);
  caso('lida: "–" ou janela escondida (aoOculto) → DELETE; repetir não manda outro', deletes(c) === 1 && (c.lat.aoOculto(), true) && deletes(c) === 1);
  const d = cenario();
  await abrirEMarcar(d);
  await d.passo(() => d.lat.volta());
  caso('lida: seguir na mesma conversa à vista não devolve (nenhum DELETE)', deletes(d) === 0 && d.lat.estado().ativaPorMim === 'a1@br1.pvp.net');
  globalThis.document = ANTES.document;
}
{
  // achado 6: ResizeTo que não caiu exatamente no pedido com a lateral aberta não conta como "a Riot devolveu"
  let medida = [1280, 720], t = 0;
  const j = criarJanela({ invocar: invocadorRiot({ riotInvoke: a => { const p = JSON.parse(a.request); if (p.name === 'Window.ResizeTo') medida = [...p.params]; } }), medir: () => medida, agora: () => t });
  j.compactar(420, 680, 660);
  medida = [1100, 680]; t += 5000;
  const torta = j.ehCompacta();
  medida = [1600, 900];
  caso('janela de 1100×680 depois do pedido de 1080 (arredondamento): segue compacta; 1600×900 (formato da Riot) = devolvida', torta === true && j.ehCompacta() === false);
}
{
  // achado 7: sala do time casada com a sessão (chatDetails.multiUserChatId)
  const velha = { id: 'velha@champ-select.br1.pvp.net', type: 'championSelect' }, nova = { id: 'NOVA@champ-select.br1.pvp.net', type: 'championSelect' };
  const ses = muc => ({ chatDetails: { multiUserChatId: muc, multiUserChatPassword: NUNCA } });
  caso('sala do time: 2 salas (dodge) → a que casa com o multiUserChatId da sessão; nenhuma casa → null (não envia); 1 sala → ela',
    igual(acharSalaTime([velha, nova], ses('nova')), { id: nova.id, type: 'championSelect' }) && acharSalaTime([velha, nova], ses('outra')) === null
      && acharSalaTime([velha, nova], null) === null && igual(acharSalaTime([nova], ses('outra')), { id: nova.id, type: 'championSelect' })
      && !JSON.stringify(acharSalaTime([velha, nova], ses('nova'))).includes(NUNCA));
}
{
  // achado 8: fechar o chat por falta de espaço não deixa a conversa velha no mapa
  const p = cenario({ mon: 'pequeno', x: 0 });
  await p.ir('Lobby');
  await p.passo(() => p.lat.abrirConversa(A1));
  const campoVelho = p.partes().dir.querySelector('[data-a="lt-texto"]');
  await p.passo(() => p.lat.alternarConfig());
  await p.passo(() => p.lat.alternarConfig());
  await p.passo(() => p.lat.abrirConversa(A1));
  const campoNovo = p.partes().dir.querySelector('[data-a="lt-texto"]');
  caso('monitor pequeno: ⚙ fechou o chat; reabrir o mesmo amigo cria a conversa de novo (não a view velha presa à aba velha)', campoNovo && campoNovo !== campoVelho, String(campoNovo === campoVelho));
  globalThis.document = ANTES.document;
}
{
  // achado 9: o relógio não recria os botões das abas
  const s = cenario();
  await s.ir('Lobby');
  await s.passo(() => s.lat.abrirConversa(A1));
  await s.passo(() => s.lat.abrirConversa(A2));
  const aba1 = s.partes().dir.querySelector('[data-a="lt-aba"]');
  await s.passo(() => s.lat.volta()); await s.passo(() => s.lat.volta());
  const aba2 = s.partes().dir.querySelector('[data-a="lt-aba"]');
  aba2.click(); await tick(6);
  caso('abas: o relógio não recria os botões (o clique não se perde) e o clique troca a aba', aba1 === aba2 && s.lat.estado().ativa === aba1.dataset.k, JSON.stringify([aba1 === aba2, s.lat.estado().ativa]));
  globalThis.document = ANTES.document;
}
{
  // achado 10: com 3 conversas abertas, mensagem nova só conta
  const s = cenario();
  s.est.conversas.push({ id: 'a4@br1.pvp.net', pid: 'a4@br1.pvp.net', type: 'chat', unreadMessageCount: 0, gameName: 'amigo 4' });
  await preparaMsg(s);
  for (const i of [1, 2, 3]) await s.passo(() => s.lat.abrirConversa({ pid: `x${i}@br1.pvp.net`, nome: `amigo ${i}` }));
  const antes = s.lat.estado().abas.map(a => a.k);
  await novaMsgDe(s, 2);
  caso(`${MAX_CONVERSAS} conversas abertas por ele: mensagem nova não abre (não fecha uma dele)`, igual(s.lat.estado().abas.map(a => a.k), antes), JSON.stringify(s.lat.estado().abas.map(a => a.k)));
  globalThis.document = ANTES.document;
}

// =================== quadro a quadro: a ⚙ não pisca (relato do Gabriel, 15/10/2026 ~00:30) ===================
// "ao clicar na engrenagem, o client dá uma flickada rápida antes da janela de configurações ir pra esquerda". Antes: CSS da
// esquerda (360) + MoveTo + ResizeTo na mesma volta; a página ainda de 420 pintava [configurações 360][coluna 60] (coluna cortada,
// configurações no lugar dela) até saber do tamanho novo. Cada quadro abaixo é o que a tela mostra.
{
  // cada op é um passo (clique + 40 quadros); os ruins de todos os passos
  const abrirFechar = async (s, ops) => {
    const ruins = [];
    for (const op of ops) { const desde = s.win.quadros.length; await s.passo(op); ruins.push(...quadrosRuins(s, desde)); }
    return ruins;
  };
  const base = async (opcoes = {}) => {
    const s = cenario({ quadros: {}, ...opcoes });
    await s.ir('Lobby');
    s.ancora = s.win.x + s.camada.medidas().esq * s.win.z;
    return s;
  };
  // 1. ⚙ abre e fecha sozinha
  let s = await base();
  const n0 = s.win.pedidos.length;
  const ruins1 = await abrirFechar(s, [() => s.lat.alternarConfig()]);
  const ped1 = s.win.pedidos.slice(n0).map(p => [p.name, p.esqCss]);
  const ruins1b = await abrirFechar(s, [() => s.lat.alternarConfig()]);
  caso('quadro a quadro, ⚙ abre: nenhum quadro com a coluna cortada ou fora do lugar (ResizeTo com a esquerda velha, MoveTo com a nova)',
    ruins1.length === 0 && igual(ped1, [['Window.ResizeTo', 0], ['Window.MoveTo', 360]]) && s.win.quadros.length > 0 && conferir(s).length === 0 || false,
    JSON.stringify([ruins1.slice(0, 3), ped1]));
  caso('quadro a quadro, ⚙ fecha: nenhum quadro ruim (anda com o CSS, encolhe por último)', ruins1b.length === 0 && s.win.w === 420 && s.win.x === 640, JSON.stringify([ruins1b.slice(0, 3), s.win.w, s.win.x]));
  // o painel da esquerda aparece só depois de a janela andar e segue visível no fim
  const qs = s.win.quadros;
  caso('quadro a quadro: o painel da esquerda nunca aparece antes da janela andar; ao fim de cada passo nada fica escondido',
    !qs.some(q => q.esq > 0 && q.temEsq && !q.mudando && q.x !== 640 - 450) && !s.camada.estaMudando?.(), JSON.stringify(qs.filter(q => q.esq > 0 && q.temEsq && !q.mudando).slice(0, 2)));
  globalThis.document = ANTES.document;

  // 2. ⚙ com o chat aberto, ⚙ + 💬 na mesma volta (abrir e fechar), conversa no meio
  s = await base();
  const ruins2 = await abrirFechar(s, [() => s.lat.alternarLista(), () => s.lat.abrirConversa(A1), () => s.lat.alternarConfig(), () => s.lat.alternarConfig(),
    () => { s.lat.alternarConfig(); s.lat.alternarLista(); }, () => { s.lat.alternarConfig(); s.lat.alternarLista(); }]);
  caso('quadro a quadro, ⚙ com o chat aberto e ⚙ + 💬 juntos (abrir e fechar): nenhum quadro ruim, estado final certo',
    ruins2.length === 0 && conferir(s).length === 0, JSON.stringify([ruins2.slice(0, 3), conferir(s)]));
  globalThis.document = ANTES.document;

  // 3. toda ordem de abrir e fechar (lista, conversa, ⚙), duas vezes
  const falhas = [];
  for (const abre of permutacoes(['lista', 'conversa', 'config'])) {
    const p = await base();
    for (const op of [...abre, ...abre]) {
      const r = await abrirFechar(p, [() => (op === 'lista' ? p.lat.alternarLista() : op === 'config' ? p.lat.alternarConfig() : (p.lat.estado().abas.length ? p.lat.fecharAba('c:a1@br1.pvp.net') : p.lat.abrirConversa(A1)))]);
      const e = conferir(p);
      if (r.length || e.length) { falhas.push(`${abre} em ${op}: ${[...r, ...e].slice(0, 2).join('; ')}`); break; }
    }
    globalThis.document = ANTES.document;
  }
  caso('quadro a quadro, toda ordem de lista/conversa/⚙ (abrir e fechar): nenhum quadro com a coluna fora do lugar', falhas.length === 0, falhas.slice(0, 2).join(' | '));

  // 4. monitor pequeno: ⚙ fecha o chat (caber('esq'): a esquerda cresce e a direita encolhe na mesma volta)
  const pq = await base({ mon: 'pequeno', x: 300 });
  await pq.passo(() => pq.lat.abrirConversa(A1));
  pq.ancora = pq.win.x;
  const ruins4 = await abrirFechar(pq, [() => pq.lat.alternarConfig(), () => pq.lat.alternarConfig()]);
  caso('quadro a quadro, monitor pequeno (⚙ fecha o chat na mesma volta e reabre): nenhum quadro ruim', ruins4.length === 0 && conferir(pq).length === 0,
    JSON.stringify([ruins4.slice(0, 3), conferir(pq)]));
  globalThis.document = ANTES.document;

  // 5. a página nunca fica sabendo do tamanho (o resize não chega): o prazo destrava a fila e o estado final fica certo
  const pr = await base({ quadros: { paginaAtrasa: 30 } });
  await pr.passo(() => pr.lat.alternarConfig());
  await pr.win.rodar(40);
  caso('resize que não chega a tempo: a geometria anda pelo prazo (não trava a fila) e termina no lugar',
    pr.win.x === 640 - 450 && pr.win.w === 780 && (pr.geo.estado().traco || []).some(t => t.ev === 'tamanho-prazo'), JSON.stringify([pr.win.x, pr.win.w, (pr.geo.estado().traco || []).map(t => t.ev)]));
  globalThis.document = ANTES.document;

  // 6. o que só o client decide ([S]): DWM 1 quadro atrás da página. Sobra no máximo 1 quadro por passo (a corrida do MoveTo);
  // antes eram 2+ com a coluna cortada
  const at = await base({ quadros: { atrasoNativo: 1 } });
  at.ancora = at.win.x;
  const ruins6a = await abrirFechar(at, [() => at.lat.alternarConfig()]);
  const ruins6b = await abrirFechar(at, [() => at.lat.alternarConfig()]);
  const tortos = r => r.filter(x => x.startsWith('#')).length;
  caso('[S] DWM um quadro atrás: no máximo 1 quadro torto ao abrir e 1 ao fechar (a corrida do MoveTo), nunca a coluna cortada',
    tortos(ruins6a) <= 1 && tortos(ruins6b) <= 1 && ![...ruins6a, ...ruins6b].some(r => r.includes('cortada')), JSON.stringify([ruins6a, ruins6b]));
  globalThis.document = ANTES.document;
  // o oposto: o pedido nativo chega antes da pintura (antes: ao FECHAR, o ResizeTo estreitava a janela com as configurações ainda
  // pintadas e a coluna sumia)
  const pa = await base({ quadros: { pinturaAtrasa: true } });
  pa.ancora = pa.win.x;
  const ruins6c = await abrirFechar(pa, [() => pa.lat.alternarConfig()]);
  const ruins6d = await abrirFechar(pa, [() => pa.lat.alternarConfig()]);
  caso('[S] pintura um quadro atrás do pedido nativo: no máximo 1 quadro torto ao abrir e 1 ao fechar, nunca a coluna cortada',
    tortos(ruins6c) <= 1 && tortos(ruins6d) <= 1 && ![...ruins6c, ...ruins6d].some(r => r.includes('cortada')), JSON.stringify([ruins6c, ruins6d]));
  globalThis.document = ANTES.document;

  // 6b. a partida começa no MEIO da transição (depois do ResizeTo, esperando o resize): nada de MoveTo com o jogo abrindo
  // (ARMADILHAS § Client, passo 14) e o painel da esquerda não fica escondido
  const gs = await base();
  gs.lat.alternarConfig();
  await gs.win.passar();
  const nGs = gs.win.pedidos.length;
  const jaRedimensionou = gs.win.pedidos.some(p => p.name === 'Window.ResizeTo' && p.params[0] === 780);
  gs.rot.aoFase('GameStart');
  await gs.win.rodar(40);
  const naPartida = gs.win.pedidos.slice(nGs).map(p => p.name);
  caso('partida no meio da transição da ⚙ (ResizeTo já saiu, esperando o resize): nenhum MoveTo depois, nada fica escondido',
    jaRedimensionou && !naPartida.some(n => /MoveTo|CenterToScreen/.test(n)) && !gs.camada.estaMudando?.(), JSON.stringify([jaRedimensionou, naPartida]));
  globalThis.document = ANTES.document;

  // 6c. revisão adversarial (15/10/2026): ⚙ aberta numa partida inteira. Na partida a lateral some só pelo CSS (porLarguras com
  // esq 0) e a janela encolhe a 420 sem a geometria saber: ela seguia achando 360 pintado. Ao sair da partida, a montagem do
  // pós-jogo punha esq 360 numa página de 420 antes do ResizeTo e a geometria crescia "com a esquerda velha" 360: o mesmo pisca
  // (configurações no lugar da coluna, coluna cortada) por uma ida e volta
  const pg = await base();
  await pg.passo(() => pg.lat.alternarConfig());
  const ancoraPg = pg.win.x + 360 * pg.win.z;
  const desdeJogo = pg.win.quadros.length;
  await pg.ir('GameStart');
  const ruinsEntra = quadrosRuins(pg, desdeJogo).filter(r => r.includes('cortada'));
  const noJogo = { w: pg.win.w, esq: pg.camada.medidas().esq };
  const desdePos = pg.win.quadros.length;
  await pg.ir('WaitingForStats');
  const ruinsPos = quadrosRuins(pg, desdePos);
  pg.ancora = ancoraPg;
  caso('⚙ aberta numa partida inteira: entrar sem coluna cortada; sair da partida volta [configurações][coluna] sem nenhum quadro ruim',
    ruinsEntra.length === 0 && noJogo.w === 420 && noJogo.esq === 0 && ruinsPos.length === 0 && pg.win.w === 780 && conferir(pg).length === 0,
    JSON.stringify([ruinsEntra.slice(0, 2), noJogo, ruinsPos.slice(0, 3), pg.win.w, conferir(pg)]));
  globalThis.document = ANTES.document;

  // 6d. fechar a ⚙ e a partida começar nos 2 quadros antes do ResizeTo (CSS e MoveTo já saíram): a geometria tem de saber que
  // a esquerda pintada é 0 e onde a janela ficou; senão, depois da partida, a âncora sai 360 px à direita e a janela pula
  const fg = await base();
  await fg.passo(() => fg.lat.alternarConfig());
  fg.lat.alternarConfig();
  let movida = false;
  for (let i = 0; i < 40 && !movida; i++) { await fg.win.passar(); movida = fg.win.x === 640; }
  fg.rot.aoFase('GameStart');
  await fg.win.rodar(40);
  await fg.ir('WaitingForStats');
  const xPos = fg.win.x;
  const desdeChat = fg.win.quadros.length;
  await fg.passo(() => fg.lat.alternarLista());
  fg.ancora = 640;
  caso('⚙ fechada nos quadros antes do ResizeTo e a partida começa: depois dela, abrir o chat não pula a janela (âncora certa)',
    movida && fg.win.x === xPos && fg.win.x === 640 && quadrosRuins(fg, desdeChat).length === 0 && conferir(fg).length === 0,
    JSON.stringify([movida, xPos, fg.win.x, fg.geo.estado().ancora, quadrosRuins(fg, desdeChat).slice(0, 2), conferir(fg)]));
  globalThis.document = ANTES.document;

  // 7. traço para medir no client: pedido, resize, tamanho, css, move, releitura, nessa ordem ao abrir
  const tr = await base();
  await tr.passo(() => tr.lat.alternarConfig());
  const evs = (tr.geo.estado().traco || []).map(t => t.ev);
  const i = evs.lastIndexOf('pedido');
  caso('traço da geometria (__lolClient.compacto.geometria().traco): pedido → resize → tamanho → css → move → releitura',
    igual(evs.slice(i), ['pedido', 'resize', 'tamanho', 'css', 'move', 'releitura']), JSON.stringify(evs.slice(i)));
  globalThis.document = ANTES.document;
}

globalThis.document = ANTES.document;
relatar(casos);
