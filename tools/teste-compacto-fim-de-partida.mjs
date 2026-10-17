// Testa o fim de partida compacto do passo 12 (roadmap/2026-10-13-client-compacto.md): honra (compacto/tela-honra.js),
// chat da sala (compacto/chat-sala.js), "adicionar" e "denunciar" por jogador (compacto/jogador-acoes.js) e a sala/detalhes
// no pós-jogo (tela-posjogo.js), sem o client: roteador de verdade (compacto/index.js) com riotInvoke falso, DOM mínimo
// feito aqui e LCU falsa (tools/lcu-falsa.mjs: nem a tela nem o teste falam com o client). Partida 3293137136
// (tests/fixtures/fim-de-partida-3293137136.json: eog real recortado, identidade dos 10 trocada; ballot no formato da sonda;
// chat inventado no formato medido da sala: type 'groupchat', fromSummonerId 0, sonda de 14/10). Regras que o teste segura: nada escrito sem clique (voto, prosseguir, pular, adicionar, denunciar,
// mensagem); corpos iguais aos do front da Riot; 405 no pedido de amizade não desbloqueia ninguém; até 3 categorias e 255
// letras; personalizada não denuncia; sala do champ select nunca lida; da sala só id e type ficam; nome nunca no log.
// uso: node tools/teste-compacto-fim-de-partida.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relatar, lcuFalsa } from './lcu-falsa.mjs';
import { criarJanela, invocadorRiot, criarCamada } from '../pengu/compacto/modo.js';
import { criarRoteador, CLASSE } from '../pengu/compacto/index.js';
import * as honra from '../pengu/compacto/tela-honra.js';
import * as posjogo from '../pengu/compacto/tela-posjogo.js';
import * as sala from '../pengu/compacto/chat-sala.js';
import * as ja from '../pengu/compacto/jogador-acoes.js';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const FX = JSON.parse(readFileSync(raiz + 'tests/fixtures/fim-de-partida-3293137136.json', 'utf8'));
const GID = 3293137136;
const SALA_ID = `${GID}-eog@lol-post-game.br1.pvp.net`;
const SALA_CS = 'c1@champ-select.br1.pvp.net';
const MSGS = `/lol-chat/v1/conversations/${encodeURIComponent(SALA_ID)}/messages`;
const MSGS_CS = `/lol-chat/v1/conversations/${encodeURIComponent(SALA_CS)}/messages`;

// ---------- DOM mínimo (o mesmo dos outros testes do compacto; append(null) quebra, como seria "null" na tela) ----------
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
    const est = {}; est.setProperty = (k, v) => { est[k] = v; }; this.style = est; this.value = '';
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { if (k === 'id') this.id = String(v); else if (k === 'class') this.className = v; else this.attrs.set(k, String(v)); }
  getAttribute(k) { return k === 'id' ? this.id : this.attrs.get(k) ?? null; }
  removeAttribute(k) { this.attrs.delete(k); }
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
  insertBefore(n, ref) { if (n.parentNode) n.remove(); n.parentNode = this; const i = this.childNodes.indexOf(ref); this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n); return n; }
  remove() { if (this.parentNode) { const l = this.parentNode.childNodes; l.splice(l.indexOf(this), 1); } this.parentNode = null; }
  replaceChildren(...ns) { for (const n of [...this.childNodes]) n.parentNode = null; this.childNodes = []; this.append(...ns); }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this.replaceChildren(new Texto(v)); }
  get isConnected() { let p = this; while (p.parentNode) p = p.parentNode; return p === this.doc.documentElement; }
  addEventListener(ev, fn) { (this.ouvintes[ev] ||= []).push(fn); }
  disparar(ev, extra = {}) { const e = { target: this, stopPropagation() {}, preventDefault() {}, ...extra }; for (const fn of this.ouvintes[ev] || []) fn(e); }
  click(extra) { this.disparar('click', extra); }
  // a faixa da sala nunca puxa o foco sozinha (etapa A de 2026-10-16): todo focus() conta
  focus() { this.doc.focos = (this.doc.focos || 0) + 1; this.doc.activeElement = this; }
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

// ---------- relógio falso ----------
function relogio() {
  const r = { agora: 5_000_000, prox: 1, fila: new Map() };
  r.agendar = (fn, ms = 0) => { const id = r.prox++; r.fila.set(id, { em: r.agora + ms, fn }); return id; };
  r.limpar = id => { r.fila.delete(id); };
  r.repetir = (fn, ms) => { const id = r.prox++; r.fila.set(id, { em: r.agora + ms, fn, cada: ms }); return id; };
  r.avancar = async ms => {
    const fim = r.agora + ms;
    for (;;) {
      const [id, t] = [...r.fila].filter(([, t]) => t.em <= fim).sort((a, b) => a[1].em - b[1].em)[0] || [];
      if (!id) break;
      r.agora = t.em;
      if (t.cada) t.em += t.cada; else r.fila.delete(id);
      t.fn();
      await tick(2);
    }
    r.agora = fim;
    await tick();
  };
  return r;
}
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const clone = o => JSON.parse(JSON.stringify(o));

// ---------- cenário: roteador + telas de verdade, LCU falsa ----------
function cenario({ ballot = FX.ballot, amigos = [], pedidos = [], denunciados = [], noJogo = [], vozDoTime = false, mudo = false,
  chat = FX.chat, conversas, custom = false, rotas: extras = {}, cfgChat = { nomes: 'ambos' }, cfgCompacto = {} } = {}) {
  const rel = relogio();
  honra._relogio.agora = () => rel.agora;
  posjogo._relogio.agora = () => rel.agora;
  posjogo._relogio.data = () => new Date(2026, 9, 14, 16, 0, 0);
  sala._esquecerRascunhos();
  ja._esquecerRascunhosDenuncia();
  posjogo._esquecer();
  const doc = novoDoc();
  globalThis.document = doc;
  const est = { fase: 'WaitingForStats', ballot: ballot === null ? null : clone(ballot), seq: { name: 'honor-vote', priority: 1 }, chat: clone(chat) };
  const sessao = { ...FX.sessao, gameData: { ...FX.sessao.gameData, isCustomGame: custom } };
  const rotas = {
    'GET /lol-gameflow/v1/session': () => sessao,
    'GET /lol-gameflow/v1/gameflow-phase': () => est.fase,
    'GET /lol-summoner/v1/current-summoner': { gameName: 'Xerekton', profileIconId: 29 },
    'GET /lol-gameflow/v1/gameflow-metadata/player-status': { lastQueuedLobbyStatus: { queueId: 420, isLeader: true, memberSummonerIds: [111], allowedPlayAgain: true } },
    'GET /lol-end-of-game/v1/eog-stats-block': () => FX.eog,
    'GET /lol-ranked/v1/current-ranked-stats': { queueMap: { RANKED_SOLO_5x5: { tier: 'EMERALD', division: 'IV', leaguePoints: 46 } } },
    'GET /lol-honor-v2/v1/ballot': () => (est.ballot === null ? { status: 404, json: { message: 'sem' } } : est.ballot),
    'GET /lol-honor-v2/v1/config': { SecondsToVote: 40 },
    'POST /lol-honor/v1/honor': c => { est.ballot.honoredPlayers.push({ recipientPuuid: c.recipientPuuid }); return { status: 200, json: null }; },
    'POST /lol-honor/v1/ballot': { status: 204 },
    'POST /lol-pre-end-of-game/v1/skip-pre-end-of-game': { status: 204 },
    'GET /lol-pre-end-of-game/v1/currentSequenceEvent': () => est.seq,
    'GET /lol-chat/v1/friends': amigos.map(puuid => ({ puuid })),
    'GET /lol-chat/v2/friend-requests': pedidos.map(puuid => ({ puuid, direction: 'out' })),
    'POST /lol-chat/v2/friend-requests': { status: 204 },
    [`GET /lol-player-report-sender/v1/reported-players/gameId/${GID}`]: () => denunciados,
    'GET /lol-player-report-sender/v1/in-game-reports': noJogo,
    'GET /lol-client-config/v3/client-config/lol.client_settings.team_voice.enabled': vozDoTime,
    'POST /lol-player-report-sender/v1/end-of-game-reports': { status: 204 },
    // a sala do champ select vem antes, como na lista real (sala de grupo + conversa 1:1 + pós-jogo)
    'GET /lol-chat/v1/conversations': () => conversas ?? [
      { id: SALA_CS, type: 'championSelect', extra: { campo: 'nunca guardar' } },
      { id: 'amigo@br1.pvp.net', type: 'chat', unreadMessageCount: 1 },
      { id: SALA_ID, type: 'postGame', extra: { campo: 'nunca guardar' } }],
    [`GET ${MSGS}`]: () => est.chat,
    [`GET ${MSGS_CS}`]: [{ id: 'x', type: 'chat', body: 'mensagem da seleção', fromPuuid: 'puuid-1' }],
    // a sala é MUC: a mensagem enviada com type 'chat' volta da LCU como 'groupchat' (sonda de 14/10: 21 groupchat, 0 chat; 15/10)
    [`POST ${MSGS}`]: c => { est.chat.push({ id: 'n' + est.chat.length, ...c, type: 'groupchat', fromSummonerId: 0, fromPuuid: 'puuid-eu' }); return { status: 200, json: {} }; },
    'GET /lol-chat/v1/me': { id: 'eu@br1.pvp.net', summonerId: 111, puuid: 'puuid-eu' },
    'GET /lol-chat/v1/player-mutes': mudo ? { 'puuid-eu': { isSystemMuted: true } } : {},
    'POST /lol-lobby/v2/play-again': { status: 204 },
    'POST /lol-end-of-game/v1/state/dismiss-stats': { status: 204 },
    ...extras,
  };
  const falsa = lcuFalsa(rotas);
  globalThis.fetch = falsa.fetch;
  const pedidosJanela = [];
  const win = { innerWidth: 1280, riotInvoke: arg => { const p = JSON.parse(arg.request); pedidosJanela.push(p); if (p.name === 'Window.ResizeTo') win.innerWidth = p.params[0]; } };
  const janela = criarJanela({ invocar: invocadorRiot(win, () => {}), medir: () => [win.innerWidth, 720] });
  const s = { rel, doc, est, falsa, avisos: [], logs: [], pedidosJanela, subs: new Map() };
  s.emitir = async (uri, data, eventType = 'Update') => { s.subs.get(uri)?.({ uri, data, eventType }); await tick(14); };
  const cfg = { compacto: { ligado: true, inicioCompacto: true, larg: 420, alt: 680, ...cfgCompacto }, aceite: { ligado: true }, chatPosjogo: cfgChat,
    filaRapida: { jogarDeNovo: true, pos1: 'TOP', pos2: 'JUNGLE', freioTilt: 2, freioMadrugada: true } };
  const camada = criarCamada({ doc, aoExpandir: () => s.rot.expandir(), aoMinimizar: () => {}, aoFechar: () => {} });
  s.rot = criarRoteador({
    cfg, janela, camada,
    carregarTela: async nome => { if (nome === 'honra') return honra; if (nome === 'posjogo') return posjogo; throw new Error('404 ' + nome); },
    servicos: { coletor: async () => ({ status: 404, dados: null }), fila: { derrotasSeguidas: async () => 0 }, posjogo: {} },
    avisar: (m, e) => s.avisos.push([m, !!e]), log: (...a) => s.logs.push(a.map(String).join(' ')),
    assinar: (uri, cb) => s.subs.set(uri, cb),
    classe: on => doc.documentElement.classList.toggle(CLASSE, on),
    agendar: rel.agendar, limpar: rel.limpar, repetir: rel.repetir, pararRepetir: rel.limpar, agora: () => rel.agora,
  });
  s.rot.marcarPronto();
  s.ir = async (fase, seq) => { est.fase = fase; s.rot.aoFase(fase); s.rot.aoSessao(sessao); if (seq !== undefined) s.rot.aoSequencia(seq); await tick(14); };
  s.honra = async () => { await s.ir('WaitingForStats'); await s.ir('PreEndOfGame', 'honor-vote'); await tick(14); };
  s.cfg = cfg;
  s.camada = () => doc.getElementById('lc-compacto');
  s.texto = () => s.camada()?.textContent || '';
  s.q = sel => s.camada()?.querySelector(sel);
  s.qq = sel => s.camada()?.querySelectorAll(sel) || [];
  s.clicar = async (el, extra) => { el?.click(extra); await tick(14); };
  s.escritas = () => falsa.escritas().map(c => `${c.metodo} ${c.url}`);
  s.foto = () => ({ efetivo: s.rot.estado().efetivo, tela: s.rot.estado().tela });
  s.linha = puuid => s.qq('.lc-cp-hj').find(l => l.dataset.puuid === puuid);
  return s;
}

const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const NOMES_FX = Array.from({ length: 9 }, (_, i) => `Jogador${i + 1}`);

// ---------- 1. funções puras ----------
{
  const js = ja.jogadoresDoEog(FX.eog);
  const eu = js.find(j => j.eu), adv = ja.adversarioDireto(js, eu);
  caso('eog 3293137136: 10 jogadores, eu = Renekton no topo, adversário direto = K\'Sante', js.length === 10 && eu.campeao === 'Renekton' && eu.posicao === 'TOP'
    && adv?.campeao === "K'Sante" && js.filter(j => j.aliado).length === 5, JSON.stringify([eu?.campeao, adv?.campeao]));
  caso('Riot ID como o pós-jogo mostra: "Jogador1 #BR1"; sem nome = "" (nunca um palpite)', ja.nomeCompleto(js.find(j => j.puuid === 'puuid-1')) === 'Jogador1 #BR1'
    && ja.nomeCompleto({ nome: '', tag: 'BR1' }) === '');
  const s0 = ja.secoesDenuncia(false), s1 = ja.secoesDenuncia(true);
  const ids = s => s.flatMap(x => x.categorias.map(c => c.id));
  caso('denúncia: as 3 seções da Riot (LOL), 7 categorias; com voz do time, 8 (COMMS_ABUSE_VOICE)',
    s0.length === 3 && ids(s0).length === 7 && !ids(s0).includes('COMMS_ABUSE_VOICE') && ids(s1).length === 8 && ids(s1).includes('COMMS_ABUSE_VOICE')
    && s0[0].titulo === 'JOGUE PARA VENCER.' && s0[2].categorias[0].titulo === 'ABUSO DE COMUNICAÇÃO', JSON.stringify(ids(s0)));
  let m = [];
  for (const id of ['LEAVING_AFK', 'BOTTING', 'VERBAL_ABUSE', 'INAPPROPRIATE_NAME']) m = ja.alternarCategoria(m, id);
  caso('denúncia: até 3 categorias (a 4ª não entra); desmarcar libera', igual(m, ['LEAVING_AFK', 'BOTTING', 'VERBAL_ABUSE'])
    && igual(ja.alternarCategoria(m, 'BOTTING'), ['LEAVING_AFK', 'VERBAL_ABUSE']) && igual(ja.alternarCategoria([], 'INVENTADA'), []));
  const j = js.find(x => x.puuid === 'puuid-6');
  const c1 = ja.corpoDenuncia({ jogador: j, categorias: ['VERBAL_ABUSE'], comentario: '' });
  const c2 = ja.corpoDenuncia({ jogador: j, categorias: ['VERBAL_ABUSE', 'BOTTING'], comentario: 'x'.repeat(300) });
  caso('denúncia: corpo do client {comment, gameId, categories, offenderSummonerId, offenderPuuid}; comentário vazio fica fora; 255 letras',
    JSON.stringify(c1) === JSON.stringify({ gameId: GID, categories: ['VERBAL_ABUSE'], offenderSummonerId: 1006, offenderPuuid: 'puuid-6' })
    && c2.comment.length === 255 && ja.corpoDenuncia({ jogador: j, categorias: [], comentario: 'a' }) === null, JSON.stringify(c1));
  const social = { lido: true, amigos: new Set(['puuid-1']), pedidos: new Set(['puuid-2']), enviados: new Set(['puuid-3']), denunciados: new Set(['puuid-6']) };
  const por = p => js.find(x => x.puuid === p);
  caso('adicionar: eu, bot, amigo, pedido pendente e já enviado ficam cinza com motivo; livre pode; sem a lista de amigos, cinza',
    !ja.podeAdicionar(eu, social).ok && /amigo/.test(ja.podeAdicionar(por('puuid-1'), social).motivo) && /pendente/.test(ja.podeAdicionar(por('puuid-2'), social).motivo)
    && /enviado/.test(ja.podeAdicionar(por('puuid-3'), social).motivo) && ja.podeAdicionar(por('puuid-4'), social).ok
    && !ja.podeAdicionar({ ...por('puuid-4'), bot: true }, social).ok && !ja.podeAdicionar(por('puuid-4'), { ...social, lido: false }).ok);
  caso('denunciar: eu, personalizada e já denunciado ficam cinza; os outros podem',
    !ja.podeDenunciar(eu, social).ok && /personalizada/.test(ja.podeDenunciar(por('puuid-4'), social, { custom: true }).motivo)
    && /já denunciado/.test(ja.podeDenunciar(por('puuid-6'), social).motivo) && ja.podeDenunciar(por('puuid-4'), social).ok);
  const conv = [{ id: SALA_CS, type: 'championSelect' }, { id: 'a', type: 'chat' }, { id: SALA_ID, type: 'postGame', extra: 'x', outra: { y: 1 } }];
  caso('sala: só a postGame; da conversa só id e type ficam (o resto, inclusive a credencial da sala, nunca sai daqui)',
    igual(sala.acharSala(conv, GID), { id: SALA_ID, type: 'postGame' }) && sala.acharSala(conv.slice(0, 2), GID) === null && sala.acharSala('lixo', GID) === null);
  const velha = { id: `${GID - 7}-eog@lol-post-game.br1.pvp.net`, type: 'postGame' };
  caso('sala: só a DESTA partida (a do pós-jogo anterior na frente da lista fica de fora); sem gameId, nenhuma (revisão 14/10)',
    igual(sala.acharSala([velha, ...conv], GID), { id: SALA_ID, type: 'postGame' }) && sala.acharSala([velha], GID) === null
    && sala.acharSala(conv, null) === null && sala.acharSala([{ id: `${GID}9-eog@x`, type: 'postGame' }], GID) === null);
  const lm = sala.lerMensagens(FX.chat);
  caso('sala: "entrou/saiu" some; contador de quem está; quem saiu marcado', lm.linhas.length === 3 && lm.linhas.every(l => l.texto !== 'joined_room')
    && lm.naSala === 1 && lm.sairam.has('puuid-6'), JSON.stringify({ n: lm.linhas.length, naSala: lm.naSala }));
  // formato medido (sonda do pós-jogo de 14/10, temp/posjogo-sonda-2026-10-14.jsonl): mensagem da sala = type 'groupchat', as 11
  // chaves de /messages, fromSummonerId 0. O filtro só 'chat' deixava a sala vazia com as mensagens chegando (relato de 15/10/2026)
  const real = [{ body: 'gg', fromId: 'x@lol-post-game', fromObfuscatedPuuid: '', fromObfuscatedSummonerId: 0, fromPid: 'x@lol-post-game', fromPuuid: 'puuid-2',
    fromSummonerId: 0, id: '1792044882211:17', isHistorical: false, timestamp: '2026-10-15T06:14:42.211Z', type: 'groupchat' },
  { body: 'joined_room', fromPuuid: 'puuid-4', id: 's1', type: 'system', timestamp: '' },
  { body: 'oi', fromPuuid: 'puuid-3', id: 'c1', type: 'chat', timestamp: '' }, { body: 'x', fromPuuid: 'puuid-3', id: 'c2', type: 'celebration', timestamp: '' }];
  const lr = sala.lerMensagens(real);
  caso('sala: mensagem real da sala (type groupchat) aparece; chat também (como o isChatMessage da Riot); system e celebration não',
    igual(lr.linhas.map(l => [l.id, l.puuid, l.texto]), [['1792044882211:17', 'puuid-2', 'gg'], ['c1', 'puuid-3', 'oi']]), JSON.stringify(lr.linhas));
  // quem está na sala (pedido de 15/10/2026 ~12:45: "mostrasse um ícone [...] quais campeões estão na sala ainda"): sonda de
  // 14/10 = left_room de quem nunca teve joined_room (os 10 entram na sala no fim da partida; joined_room só de quem chega
  // depois dele). Sem evento = dentro; o último evento vale; falar = dentro.
  const ev = lm.eventos;
  caso('presença: eventos da sala por puuid (joined/fala = dentro, left = saiu)', ev.get('puuid-1') === 'dentro' && ev.get('puuid-2') === 'dentro'
    && ev.get('puuid-6') === 'saiu' && !ev.has('puuid-7'), JSON.stringify([...ev]));
  const pres = sala.presencaNaSala(js, ev);
  caso('presença: os 10 do eog, quem saiu marcado, quem não deu sinal conta como dentro; eu sempre dentro',
    pres.length === 10 && pres.filter(p => p.estado === 'saiu').map(p => p.puuid).join() === 'puuid-6' && pres.find(p => p.eu)?.estado === 'dentro'
    && pres.every(p => p.campeaoId > 0), JSON.stringify(pres.map(p => [p.puuid, p.estado])));
  const reentrou = sala.lerMensagens([...FX.chat, { id: 'm9', type: 'system', body: 'joined_room', fromPuuid: 'puuid-6' }]);
  caso('presença: saiu e voltou = dentro (o último evento vale)', sala.presencaNaSala(js, reentrou.eventos).every(p => p.estado === 'dentro'));
  // participants ([S], rota que o rcp-fe-lol-social lê em toda conversa; LolChatParticipant tem puuid): com casamento vale ela
  const comPart = sala.presencaNaSala(js, ev, sala.lerParticipantes([{ puuid: 'puuid-1' }, { summonerId: 1002 }, { gameName: 'jogador3', gameTag: 'br1' }, { puuid: 'puuid-eu' }]));
  caso('presença com participants: quem casa (puuid, summonerId ou Riot ID) está; quem não casa e não falou saiu',
    igual(comPart.filter(p => p.estado === 'dentro').map(p => p.puuid), ['puuid-eu', 'puuid-1', 'puuid-2', 'puuid-3', 'puuid-5']), JSON.stringify(comPart.map(p => [p.puuid, p.estado])));
  caso('presença com participants que não casa com ninguém (formato inesperado): ignora e fica nos eventos',
    igual(sala.presencaNaSala(js, ev, sala.lerParticipantes([{ x: 1 }])).map(p => p.estado), pres.map(p => p.estado))
    && sala.lerParticipantes('lixo') === null && sala.lerParticipantes({ participants: [{ puuid: 'a' }] }).length === 1);
  // cor do lado no lado vermelho e sem isPlayerTeam: o aliado é sempre o time dele (a mesma regra do chat expandido)
  const aliadosDe = eog => ja.jogadoresDoEog(eog).filter(j => j.aliado).map(j => j.puuid).sort().join();
  const aliadosFx = aliadosDe(FX.eog);
  const invertido = { ...FX.eog, teams: [...FX.eog.teams].reverse() };
  const semFlag = { ...FX.eog, teams: FX.eog.teams.map(t => ({ ...t, isPlayerTeam: undefined })) };
  caso('cor do lado: com o time dele em 2º (lado vermelho) e sem isPlayerTeam, os aliados continuam os 5 do time dele',
    aliadosFx.split(',').length === 5 && aliadosFx.includes('puuid-eu') && aliadosDe(invertido) === aliadosFx && aliadosDe(semFlag) === aliadosFx,
    JSON.stringify([aliadosFx, aliadosDe(semFlag)]));
  caso('presença: bot nunca entra na faixa', sala.presencaNaSala([...js, { puuid: null, bot: true, campeaoId: 1, aliado: false }], ev).length === 10);
  // nome do campeão com a cor do lado, como no chat expandido (chat-posjogo.js pinta o .message-name inteiro pelo time)
  const camp = j => sala.nomeNaSala(j, 'ambos')[1]?.classe || '';
  caso('sala: o "(Campeão)" leva a cor do lado (aliado, inimigo, eu), como o nick',
    /lc-cp-nm-al/.test(camp(por('puuid-2'))) && /lc-cp-nm-in/.test(camp(por('puuid-5'))) && /lc-cp-nm-eu/.test(camp(eu)) && /lc-cp-camp/.test(camp(eu))
    && /lc-cp-nm-in/.test(sala.nomeNaSala(por('puuid-5'), 'campeao')[0].classe), camp(por('puuid-2')));
  const jj = por('puuid-2');
  caso('sala: nome pelo modo do chat do pós-jogo (ambos / só campeão / só jogador)',
    igual(sala.nomeNaSala(jj, 'ambos').map(p => p.texto), ['Jogador2', `(${jj.campeao})`]) && igual(sala.nomeNaSala(jj, 'campeao').map(p => p.texto), [jj.campeao])
    && igual(sala.nomeNaSala(jj, 'jogador').map(p => p.texto), ['Jogador2']));
  const cm = sala.corpoMensagem('gg', { id: 'eu@x', summonerId: 111 }, new Date(Date.UTC(2026, 9, 14, 19, 0, 0)));
  caso('sala: corpo do envio igual ao do client (type chat, fromId, fromSummonerId, isHistorical false, timestamp, body)',
    JSON.stringify(cm) === JSON.stringify({ type: 'chat', fromId: 'eu@x', fromSummonerId: 111, isHistorical: false, timestamp: '2026-10-14T19:00:00.000Z', body: 'gg' }));
  const b404 = honra.lerBallot({ ok: false, status: 404 }), bVazio = honra.lerBallot({ ok: true, status: 200, json: { eligibleAllies: [], eligibleOpponents: [], votePool: { votes: 2 } } });
  const bOk = honra.lerBallot({ ok: true, status: 200, json: { ...FX.ballot, honoredPlayers: [{ recipientPuuid: 'puuid-1' }] } });
  caso('ballot: 404 = sem honra; listas vazias = vazia; honoredPlayers = votos usados', b404.estado === 'sem' && bVazio.estado === 'vazia' && bOk.estado === 'lista'
    && bOk.aliados.length === 4 && bOk.oponentes.length === 5 && bOk.usados.has('puuid-1') && bOk.votos === 4);
  const bt = o => honra.botaoHonra({ ballot: bOk, enviado: false, enviando: false, desdeMs: 0, ...o });
  caso('botão da honra: sem voto = "prosseguir" (ajuste de 14/10 ~20:00); com voto = PRONTO; lista vazia libera o pular em 5 s',
    honra.botaoHonra({ ballot: { ...bOk, usados: new Set() } }).texto === 'prosseguir' && bt().texto === 'PRONTO · enviar 1 voto'
    && !honra.botaoHonra({ ballot: bVazio, desdeMs: 4000 }).acao && honra.botaoHonra({ ballot: bVazio, desdeMs: 5000 }).acao === 'pular'
    && !honra.botaoHonra({ ballot: b404 }).acao && bt({ enviado: true }).texto === 'honra enviada' && bt({ enviado: true }).icone === 'ok');
  caso('botão da honra: voto em voo = cinza "enviando o voto"; etapa fora de honor-vote = cinza "a Riot já fechou a honra" (revisão 14/10)',
    !bt({ votando: 1 }).acao && bt({ votando: 1 }).texto === 'enviando o voto…' && !bt({ seq: '' }).acao && bt({ seq: '' }).texto === 'a Riot já fechou a honra'
    && !bt({ seq: 'ranked-celebration' }).acao && bt({ seq: 'honor-vote' }).acao === 'enviar');
}

// ---------- 2. honra pelo roteador ----------
{
  const s = cenario();
  await s.honra();
  caso('PreEndOfGame honor-vote: honra compacta montada (tela A), janela 420', s.foto().efetivo === 'compacto' && s.foto().tela === 'honra'
    && s.pedidosJanela.some(p => p.name === 'Window.ResizeTo' && p.params[0] === 420), JSON.stringify(s.foto()));
  const linhas = s.qq('.lc-cp-hj');
  const t = s.texto();
  caso('honra: 4 do teu time e 5 adversários, cada um com foto do campeão, Riot ID e campeão', linhas.length === 9
    && linhas.every(l => !!l.querySelector('.lc-cp-foto')) && s.linha('puuid-1')?.textContent.includes('Jogador1 #BR1')
    && s.linha('puuid-5')?.textContent.includes("K'Sante"), linhas.map(l => l.textContent).join(' | '));
  caso('honra: sem os rótulos de protótipo "aliado N"/"inimigo N" (ajuste de 14/10 ~20:00)', !/aliado \d|inimigo \d/.test(t), t);
  caso('honra: adicionar e denunciar em cada linha', linhas.every(l => !!l.querySelector('[data-a="adicionar"]') && !!l.querySelector('[data-a="denunciar"]')));
  caso('honra: botão de baixo "prosseguir" sem voto', s.q('[data-a="honra-base"]')?.textContent === 'prosseguir', s.q('[data-a="honra-base"]')?.textContent);
  caso('honra: chat da sala embaixo, recolhido', s.q('.lc-cp-dock')?.dataset.tam === 'recolhido');
  await s.rel.avancar(45000);
  caso('honra: 45 s parado (relógio estimado zerou) = zero escritas; coração e prosseguir seguem valendo',
    s.escritas().length === 0 && s.linha('puuid-1').querySelector('[data-a="honrar"]').disabled === false && s.q('[data-a="honra-base"]').disabled === false
    && s.texto().includes('tempo estimado acabou'), s.escritas().join(', '));
  await s.clicar(s.linha('puuid-1').querySelector('[data-a="honrar"]'), { isTrusted: false });
  caso('honra: clique sintético (isTrusted false) não vota', s.escritas().length === 0);
  await s.clicar(s.linha('puuid-1').querySelector('[data-a="honrar"]'));
  const v = s.falsa.escritas();
  caso('honra: clique no coração = POST /lol-honor/v1/honor {recipientPuuid, honorType:"HEART"} (o corpo do front da Riot)',
    v.length === 1 && v[0].url === '/lol-honor/v1/honor' && igual(v[0].corpo, { recipientPuuid: 'puuid-1', honorType: 'HEART' }), JSON.stringify(v));
  caso('honra: voto dado vira "honrado" com o coração cheio e o botão vira "PRONTO · enviar 1 voto"', s.linha('puuid-1').querySelector('[data-a="honrar"]').textContent === 'honrado'
    && s.linha('puuid-1').querySelector('[data-a="honrar"] [data-icone="honrar"]')?.getAttribute('fill') === 'currentColor'
    && s.q('[data-a="honra-base"]').textContent === 'PRONTO · enviar 1 voto');
  await s.clicar(s.q('[data-a="honra-base"]'));
  const w = s.falsa.escritas();
  caso('honra: PRONTO = POST /lol-honor/v1/ballot sem corpo; depois "honra enviada" com o ícone ok e corações travados',
    w.length === 2 && w[1].url === '/lol-honor/v1/ballot' && w[1].corpo === undefined && s.q('[data-a="honra-base"]').textContent === 'honra enviada'
    && !!s.q('[data-a="honra-base"] [data-icone="ok"]')
    && s.linha('puuid-2').querySelector('[data-a="honrar"]').disabled === true, JSON.stringify(w));
  s.est.seq = { name: '' };
  s.rot.aoSequencia(''); await s.emitir('/lol-pre-end-of-game/v1/currentSequenceEvent', { name: '', priority: -1 });
  caso('honra: a Riot fechou a etapa ("" no evento) = "a Riot fechou a honra", sem mexer na janela', s.texto().includes('a Riot fechou a honra') && s.foto().tela === 'honra');
  await s.ir('EndOfGame');
  caso('EndOfGame: pós-jogo compacto (tela B) depois da honra', s.foto().tela === 'posjogo' && s.foto().efetivo === 'compacto');
  caso('log do roteador sem nome de jogador', !s.logs.some(l => NOMES_FX.some(n => l.includes(n))), s.logs.join(' | '));
}
{
  const b = clone(FX.ballot); b.votePool.votes = 1;
  const s = cenario({ ballot: b });
  await s.honra();
  await s.clicar(s.linha('puuid-1').querySelector('[data-a="honrar"]'));
  caso('honra com 1 voto: depois do voto os outros corações travam (sem votos sobrando)', s.linha('puuid-2').querySelector('[data-a="honrar"]').disabled === true
    && /sem votos/.test(s.linha('puuid-2').querySelector('[data-a="honrar"]').getAttribute('title') || ''));
}
{
  const s = cenario({ ballot: null });
  await s.honra();
  await s.rel.avancar(10000);
  caso('fila sem honra (ballot 404): "sem honra nesta partida", botão cinza, nenhuma escrita', s.texto().includes('sem honra nesta partida')
    && s.q('[data-a="honra-base"]').disabled === true && s.escritas().length === 0, s.escritas().join(', '));
}
{
  const vazio = { ...clone(FX.ballot), eligibleAllies: [], eligibleOpponents: [] };
  const s = cenario({ ballot: vazio });
  await s.honra();
  caso('ballot vazio: "buscando quem pode ser honrado", pular cinza antes dos 5 s', s.texto().includes('buscando quem pode ser honrado') && s.q('[data-a="honra-base"]').disabled === true);
  await s.rel.avancar(5500);
  caso('ballot vazio: nada escrito sozinho em 5 s (sem pular automático)', s.escritas().length === 0);
  await s.clicar(s.q('[data-a="honra-base"]'));
  caso('ballot vazio passado 5 s: clique em "pular a espera" = POST skip-pre-end-of-game (a opção que a Riot dá)',
    igual(s.escritas(), ['POST /lol-pre-end-of-game/v1/skip-pre-end-of-game']), s.escritas().join(', '));
}

// ---------- 3. adicionar e denunciar (na honra) ----------
{
  const s = cenario({ amigos: ['puuid-1'], pedidos: ['puuid-2'] });
  await s.honra();
  const ad = p => s.linha(p).querySelector('[data-a="adicionar"]');
  caso('adicionar: amigo e pedido pendente cinza com motivo; os outros livres', ad('puuid-1').disabled && /amigo/.test(ad('puuid-1').getAttribute('title'))
    && ad('puuid-2').disabled && /pendente/.test(ad('puuid-2').getAttribute('title')) && ad('puuid-3').disabled === false);
  await s.rel.avancar(30000);
  caso('adicionar: nada sai sem clique', s.escritas().length === 0);
  await s.clicar(ad('puuid-3'));
  const w = s.falsa.escritas();
  caso('adicionar: clique = POST /lol-chat/v2/friend-requests {direction:"out", puuid} (rota do pós-jogo da Riot); ícone ok cinza depois',
    w.length === 1 && w[0].url === '/lol-chat/v2/friend-requests' && igual(w[0].corpo, { direction: 'out', puuid: 'puuid-3' })
    && ad('puuid-3').disabled && !!ad('puuid-3').querySelector('[data-icone="ok"]') && ad('puuid-3').getAttribute('aria-label') === 'pedido de amizade enviado' && s.avisos.some(([m]) => /pedido de amizade enviado/.test(m)), JSON.stringify(w));
  await s.clicar(ad('puuid-3'));
  caso('adicionar: 2º clique não manda de novo', s.falsa.escritas().length === 1);
}
{
  const s = cenario({ rotas: { 'POST /lol-chat/v2/friend-requests': { status: 405, json: { message: 'blocked' } } } });
  await s.honra();
  await s.clicar(s.linha('puuid-4').querySelector('[data-a="adicionar"]'));
  caso('adicionar jogador bloqueado (405): avisa e manda para o client normal; nunca desbloqueia (sem DELETE) nem tenta de novo',
    igual(s.escritas(), ['POST /lol-chat/v2/friend-requests']) && s.avisos.some(([m, e]) => e && /bloqueado/.test(m)), s.escritas().join(', '));
}
{
  const s = cenario({ noJogo: [{ offenderPuuid: 'puuid-6', categories: ['VERBAL_ABUSE'] }] });
  await s.honra();
  await s.clicar(s.linha('puuid-6').querySelector('[data-a="denunciar"]'));
  const f = s.q('.lc-cp-den');
  const cats = s.qq('.lc-cp-den [data-a="categoria"]');
  caso('denunciar: formulário com o título, o nome, as 7 categorias da Riot em 3 seções e o campo de comentário',
    !!f && f.textContent.includes('DENUNCIAR JOGADOR') && f.textContent.includes('Jogador6 #BR1') && cats.length === 7 && s.qq('.lc-cp-den-sec').length === 3
    && s.q('.lc-cp-den textarea')?.getAttribute('placeholder')?.startsWith('Fale mais sobre') && s.q('.lc-cp-den textarea')?.getAttribute('maxlength') === '255', f?.textContent);
  caso('denunciar: o que ele já denunciou na partida vem marcado (in-game-reports), como na Riot', s.q('.lc-cp-den [data-cat="VERBAL_ABUSE"]')?.classList.contains('lc-cp-on'));
  const cat = id => s.q(`.lc-cp-den [data-a="categoria"][data-cat="${id}"]`);
  for (const id of ['LEAVING_AFK', 'BOTTING', 'INAPPROPRIATE_NAME']) await s.clicar(cat(id));
  caso('denunciar: a 4ª categoria não marca (máximo 3) e fica cinza', s.qq('.lc-cp-den .lc-cp-den-cat.lc-cp-on').length === 3 && !cat('INAPPROPRIATE_NAME').classList.contains('lc-cp-on')
    && cat('INAPPROPRIATE_NAME').classList.contains('lc-cp-bloq'));
  const ta = s.q('.lc-cp-den textarea');
  ta.value = 'xingou o time inteiro'; ta.disparar('input');
  await s.rel.avancar(20000);
  caso('denunciar: formulário aberto e preenchido não envia sozinho', s.escritas().length === 0);
  await s.clicar(s.q('[data-a="enviar-denuncia"]'));
  const w = s.falsa.escritas();
  caso('denunciar: clique em DENUNCIAR JOGADOR = POST end-of-game-reports com o corpo do client; fecha e agradece; denunciar cinza depois',
    w.length === 1 && w[0].url === '/lol-player-report-sender/v1/end-of-game-reports'
    && JSON.stringify(w[0].corpo) === JSON.stringify({ comment: 'xingou o time inteiro', gameId: GID, categories: ['VERBAL_ABUSE', 'LEAVING_AFK', 'BOTTING'], offenderSummonerId: 1006, offenderPuuid: 'puuid-6' })
    && !s.q('.lc-cp-den') && s.avisos.some(([m]) => m === 'Uma denúncia foi enviada para análise. Obrigado.') && s.linha('puuid-6').querySelector('[data-a="denunciar"]').disabled,
    JSON.stringify(w));
}
{
  const s = cenario({ denunciados: ['puuid-7'], vozDoTime: true });
  await s.honra();
  caso('denunciar: quem já está em reported-players da partida fica cinza', s.linha('puuid-7').querySelector('[data-a="denunciar"]').disabled
    && /já denunciado/.test(s.linha('puuid-7').querySelector('[data-a="denunciar"]').getAttribute('title')));
  await s.clicar(s.linha('puuid-8').querySelector('[data-a="denunciar"]'));
  caso('denunciar: com a voz do time ligada no client-config, 8 categorias (ABUSO DE COMUNICAÇÃO POR VOZ)', s.qq('.lc-cp-den [data-a="categoria"]').length === 8);
  caso('denunciar: sem categoria o botão de enviar fica cinza', s.q('[data-a="enviar-denuncia"]').disabled === true);
  await s.clicar(s.q('[data-a="fechar-denuncia"]'));
  caso('denunciar: FECHAR fecha sem escrever', !s.q('.lc-cp-den') && s.escritas().length === 0);
}
{
  const s = cenario({ rotas: { 'POST /lol-player-report-sender/v1/end-of-game-reports': { status: 500, json: { message: 'falhou' } } } });
  await s.honra();
  await s.clicar(s.linha('puuid-6').querySelector('[data-a="denunciar"]'));
  await s.clicar(s.q('.lc-cp-den [data-a="categoria"][data-cat="BOTTING"]'));
  await s.clicar(s.q('[data-a="enviar-denuncia"]'));
  caso('denunciar com erro (500): motivo no formulário e "abrir no client normal"; uma tentativa só', s.q('.lc-cp-den-erro')?.textContent.includes('500')
    && s.falsa.escritas().length === 1 && !!s.q('[data-a="denuncia-expandir"]'));
  await s.clicar(s.q('[data-a="denuncia-expandir"]'));
  caso('denunciar com erro: "abrir no client normal" expande', s.foto().efetivo === 'expandido');
}
{
  const s = cenario({ custom: true });
  await s.honra();
  caso('personalizada: denunciar cinza (a Riot não deixa denunciar em personalizada)', s.linha('puuid-6').querySelector('[data-a="denunciar"]').disabled
    && /personalizada/.test(s.linha('puuid-6').querySelector('[data-a="denunciar"]').getAttribute('title')));
}

// ---------- 4. chat da sala ----------
{
  const s = cenario();
  await s.honra();
  const dock = s.q('.lc-cp-dock');
  caso('sala na honra: recolhida com a última linha e o contador de não lidas', dock.dataset.tam === 'recolhido' && dock.textContent.includes('boa top, segurou bem')
    && dock.querySelector('.lc-cp-un')?.textContent === '3', dock.textContent);
  caso('sala: nunca lê a sala do champ select (só a postGame)', !s.falsa.chamadas.some(c => c.url === MSGS_CS) && s.falsa.chamadas.some(c => c.url === MSGS));
  await s.clicar(s.q('[data-a="sala-aumentar"]'));
  const linhas = s.qq('.lc-cp-cm');
  caso('sala aberta: foto do campeão e "Jogador (Campeão)" em cada linha, sem "entrou/saiu"', linhas.length === 3 && linhas.every(l => !!l.querySelector('.lc-cp-foto'))
    && linhas[0].textContent.includes('Jogador2') && linhas.every(l => !/joined_room|left_room/.test(l.textContent)), linhas.map(l => l.textContent).join(' | '));
  const fx = s.q('.lc-cp-pres');
  const icones = fx ? fx.querySelectorAll('.lc-cp-pres-j') : [];
  caso('sala aberta: faixa com o ícone dos 10 campeões no cabeçalho; quem saiu apagado (Graves), os outros acesos',
    icones.length === 10 && icones.filter(i => i.classList.contains('lc-cp-pres-saiu')).length === 1
    && /Graves/.test(icones.find(i => i.classList.contains('lc-cp-pres-saiu'))?.getAttribute('title') || ''), fx?.textContent);
  // a foto de dentro nasce com title = campeão; se ficasse, o hover mostraria só o campeão e o "saiu da sala" sumiria
  caso('sala aberta: no hover do ícone vale o title do ícone ("… saiu da sala"), a foto de dentro não tem title próprio',
    icones.length === 10 && icones.every(i => !i.querySelector('.lc-cp-foto')?.getAttribute('title'))
    && /saiu da sala/.test(icones.find(i => i.classList.contains('lc-cp-pres-saiu'))?.getAttribute('title') || ''),
    icones.map(i => i.querySelector('.lc-cp-foto')?.getAttribute('title')).join());
  caso('sala aberta: a faixa diz quantos estão (9 de 10) e separa aliados e inimigos',
    /9 de 10/.test(fx?.getAttribute('title') || '') && fx.querySelector('.lc-cp-pres-gal')?.querySelectorAll('.lc-cp-pres-j').length === 5
    && fx.querySelectorAll('.lc-cp-pres-in').length === 5 && fx.querySelectorAll('.lc-cp-pres-eu').length === 1, fx?.getAttribute('title'));
  await s.clicar(s.q('[data-a="sala-recolher"]'));
  caso('sala recolhida: sem a faixa (só a última linha)', !s.q('.lc-cp-pres'));
  await s.clicar(s.q('[data-a="sala-aumentar"]'));
  caso('sala: participants só por GET (nenhuma escrita)', s.falsa.chamadas.some(c => c.metodo === 'GET' && c.url === MSGS.replace('/messages', '/participants')) && s.escritas().length === 0);
  const input = s.q('[data-a="sala-texto"]');
  input.value = 'gg wp';
  input.disparar('keydown', { key: 'Enter', isTrusted: false });
  await tick(14);
  caso('sala: Enter sintético (isTrusted false) não envia', s.escritas().length === 0);
  input.disparar('keydown', { key: 'Enter' });
  await tick(14);
  const w = s.falsa.escritas();
  caso('sala: Enter dele = POST .../messages com o corpo do client', w.length === 1 && w[0].url === MSGS && w[0].corpo.type === 'chat' && w[0].corpo.body === 'gg wp'
    && w[0].corpo.fromId === 'eu@br1.pvp.net' && w[0].corpo.fromSummonerId === 111 && w[0].corpo.isHistorical === false && typeof w[0].corpo.timestamp === 'string', JSON.stringify(w));
  await s.rel.avancar(1600);
  caso('sala: a mensagem enviada aparece (relida em 1,5 s) e o campo limpa', s.qq('.lc-cp-cm').some(l => l.textContent.includes('gg wp')) && s.q('[data-a="sala-texto"]').value === '');
}
{
  const s = cenario({ cfgChat: { nomes: 'campeao' }, mudo: true });
  await s.honra();
  await s.ir('EndOfGame');
  const dock = s.q('.lc-cp-dock');
  caso('sala no pós-jogo: aberta (normal), entre o conteúdo e os botões', dock?.dataset.tam === 'normal');
  caso('sala com "só o campeão": linhas sem o nome do jogador', s.qq('.lc-cp-cm').length === 3 && !s.qq('.lc-cp-cm').some(l => /Jogador\d/.test(l.textContent)));
  const input = s.q('[data-a="sala-texto"]');
  caso('chat bloqueado pela Riot (isSystemMuted): campo cinza com o motivo', input.disabled === true && dock.textContent.includes('chat bloqueado pela Riot'));
  input.value = 'oi'; input.disparar('keydown', { key: 'Enter' }); await tick(14);
  caso('chat bloqueado: Enter não envia', s.escritas().length === 0);
}
{
  const s = cenario({ conversas: [] });
  await s.honra();
  await s.ir('EndOfGame');
  caso('sem sala do pós-jogo: "a sala do pós-jogo não está aberta", envio cinza, tela segue', s.q('.lc-cp-dock')?.textContent.includes('a sala do pós-jogo não está aberta')
    && s.q('[data-a="sala-texto"]').disabled === true && s.foto().efetivo === 'compacto');
}

// ---------- 5. pós-jogo: detalhes com os 10, ações e o cartão do chat ----------
{
  const s = cenario({ amigos: ['puuid-2'] });
  await s.honra();
  await s.ir('EndOfGame');
  await s.clicar(s.q('[data-a="aba-detalhes"]'));
  const linhas = s.qq('.lc-cp-jg');
  caso('detalhes: 10 linhas, a minha marcada e a do adversário direto (K\'Sante)', linhas.length === 10 && linhas.filter(l => l.classList.contains('lc-cp-eu')).length === 1
    && linhas.find(l => l.classList.contains('lc-cp-adv'))?.textContent.includes("K'Sante"), linhas.map(l => l.textContent).join(' | '));
  caso('detalhes: tu × adversário direto (KDA, farm, ouro, dano, dano recebido, visão)', s.q('.lc-cp-vs')?.textContent.includes('dano recebido') && s.qq('.lc-cp-vsl').length === 6);
  caso('detalhes: a minha linha sem adicionar e denunciar; amigo com adicionar cinza', !linhas.find(l => l.classList.contains('lc-cp-eu')).querySelector('[data-a="adicionar"]')
    && s.qq('.lc-cp-jg').find(l => l.dataset.puuid === 'puuid-2').querySelector('[data-a="adicionar"]').disabled);
  await s.clicar(s.q('[data-a="aba-resumo"]'));
  await s.clicar(s.q('[data-a="sala-aumentar"]'));
  const nome = s.qq('.lc-cp-cm .lc-cp-nmw').find(n => n.textContent.includes('Jogador5'));
  await s.clicar(nome);
  const card = s.q('.lc-cp-jcard');
  caso('chat: clique no nome abre o cartão do jogador (foto, nome, campeão, adicionar, denunciar)', !!card && card.textContent.includes('Jogador5 #BR1')
    && !!card.querySelector('[data-a="card-adicionar"]') && !!card.querySelector('[data-a="card-denunciar"]') && s.escritas().length === 0);
  await s.clicar(card?.querySelector('[data-a="card-denunciar"]'));
  caso('cartão: "denunciar" abre o formulário da denúncia daquele jogador', !s.q('.lc-cp-jcard') && s.q('.lc-cp-den')?.textContent.includes('Jogador5 #BR1') && s.escritas().length === 0);
}

// ---------- 6. revisão adversarial de 14/10/2026 (achados corrigidos) ----------
const VELHA = `${GID - 7}-eog@lol-post-game.br1.pvp.net`;
const MSGS_VELHA = `/lol-chat/v1/conversations/${encodeURIComponent(VELHA)}/messages`;
{ // 2: sala da partida anterior na lista
  const s = cenario({ conversas: [{ id: VELHA, type: 'postGame' }, { id: SALA_ID, type: 'postGame' }],
    rotas: { [`GET ${MSGS_VELHA}`]: [{ id: 'v', type: 'chat', body: 'da partida anterior', fromPuuid: 'puuid-1' }], [`POST ${MSGS_VELHA}`]: { status: 200 } } });
  await s.honra(); await s.ir('EndOfGame');
  const input = s.q('[data-a="sala-texto"]');
  input.value = 'gg'; input.disparar('keydown', { key: 'Enter' }); await tick(14);
  caso('sala: com a do pós-jogo anterior na frente, lê e envia só na DESTA partida', !s.falsa.chamadas.some(c => c.url === MSGS_VELHA)
    && igual(s.escritas(), [`POST ${MSGS}`]) && !s.texto().includes('da partida anterior'), s.escritas().join(', '));
}
{
  const s = cenario({ conversas: [{ id: VELHA, type: 'postGame' }] });
  await s.honra(); await s.ir('EndOfGame');
  const input = s.q('[data-a="sala-texto"]');
  input.value = 'gg'; input.disparar('keydown', { key: 'Enter' }); await tick(14);
  caso('sala: só a do pós-jogo anterior aberta = "não está aberta", campo cinza, nada lido nem enviado nela',
    input.disabled === true && s.escritas().length === 0 && !s.falsa.chamadas.some(c => c.url === MSGS_VELHA) && s.q('.lc-cp-dock').textContent.includes('não está aberta'));
}
{ // 2: sem gameId (sessão e ballot sem ele): nenhuma sala
  const b = clone(FX.ballot); delete b.gameId;
  const s = cenario({ ballot: b, rotas: { 'GET /lol-gameflow/v1/session': { status: 500, json: null } } });
  await s.honra();
  await s.clicar(s.q('[data-a="sala-aumentar"]'));
  caso('sala sem saber a partida: nenhuma sala lida, campo cinza com o motivo', !s.falsa.chamadas.some(c => c.url === MSGS) && s.q('[data-a="sala-texto"]').disabled === true
    && s.q('.lc-cp-dock').textContent.includes('esperando saber qual é a partida'), s.q('.lc-cp-dock').textContent);
  // 10: sem gameId da sessão nem do ballot, o eog (de qualquer partida) não entra: só o campeão, sem denúncia
  caso('honra sem gameId: eog não aceito (só o campeão na linha, denunciar cinza)', !s.linha('puuid-1').textContent.includes('Jogador1')
    && s.linha('puuid-1').querySelector('[data-a="denunciar"]').disabled === true, s.linha('puuid-1').textContent);
}
{ // 10: sessão falhou, ballot com gameId: o eog desta partida entra, o de outra não
  const s = cenario({ rotas: { 'GET /lol-gameflow/v1/session': { status: 500, json: null } } });
  await s.honra();
  caso('honra com a sessão falhando: gameId do ballot vale, eog desta partida entra (nome na linha)', s.linha('puuid-1').textContent.includes('Jogador1 #BR1'));
  await s.emitir('/lol-end-of-game/v1/eog-stats-block', { ...clone(FX.eog), gameId: GID - 7 });
  caso('honra: eog de outra partida pelo evento é ignorado', s.linha('puuid-1').textContent.includes('Jogador1 #BR1'));
}
{ // 3: voto em voo segura o prosseguir; etapa fechada trava voto e prosseguir
  let soltar;
  const s = cenario({ rotas: { 'POST /lol-honor/v1/honor': () => new Promise(r => { soltar = () => r({ status: 200, json: null }); }) } });
  await s.honra();
  await s.clicar(s.linha('puuid-1').querySelector('[data-a="honrar"]'));
  const base = s.q('[data-a="honra-base"]');
  await s.clicar(base);
  caso('honra: voto em voo = botão de baixo cinza "enviando o voto"; o clique nele não manda o ballot antes do voto',
    base.disabled === true && base.textContent === 'enviando o voto…' && igual(s.escritas(), ['POST /lol-honor/v1/honor']), s.escritas().join(', '));
  soltar(); await tick(14);
  caso('honra: o voto voltou = PRONTO de novo', s.q('[data-a="honra-base"]').disabled === false && /PRONTO/.test(s.q('[data-a="honra-base"]').textContent));
  s.est.seq = { name: '' };
  s.rot.aoSequencia(''); // só o roteador leu (o evento da etapa é [S])
  await s.rel.avancar(600);
  const b2 = s.q('[data-a="honra-base"]');
  await s.clicar(b2);
  caso('honra: etapa fechada lida pelo roteador = "a Riot já fechou a honra", cinza, nenhum POST ballot fora da etapa',
    b2.disabled === true && b2.textContent === 'a Riot já fechou a honra' && !s.escritas().includes('POST /lol-honor/v1/ballot'), s.escritas().join(', '));
  await s.rel.avancar(4000);
  caso('honra: "" parado 4 s depois da honra = client normal (nada da Riot escondido embaixo)', s.foto().efetivo === 'expandido', JSON.stringify(s.foto()));
}
{ // 7: o botão de baixo é o mesmo elemento enquanto o relógio anda
  const vazio = { ...clone(FX.ballot), eligibleAllies: [], eligibleOpponents: [] };
  const s = cenario({ ballot: vazio });
  await s.honra();
  const b0 = s.q('[data-a="honra-base"]');
  await s.rel.avancar(3000);
  const b1 = s.q('[data-a="honra-base"]');
  await s.rel.avancar(2600);
  caso('honra: "pular a espera" é o mesmo botão do começo ao fim (o tique só troca o texto: clique nunca cai num botão que sumiu)',
    b0 === b1 && b1 === s.q('[data-a="honra-base"]') && b1.disabled === false && b1.textContent === 'pular a espera pela honra', b1.textContent);
}
{ // 9: evento sem dados não vira "sem honra"; GET com erro relê até a lista chegar
  const s = cenario();
  await s.honra();
  await s.emitir('/lol-honor-v2/v1/ballot', null, 'Update');
  caso('honra: evento do ballot sem dados não vira "sem honra" (relê)', s.qq('.lc-cp-hj').length === 9 && !s.texto().includes('sem honra nesta partida'));
  let falhas = 2;
  const s2 = cenario({ rotas: { 'GET /lol-honor-v2/v1/ballot': () => (falhas-- > 0 ? { status: 500, json: null } : clone(FX.ballot)) } });
  await s2.honra();
  caso('honra: GET do ballot com 500 = "lendo a honra…"', s2.texto().includes('lendo a honra'));
  await s2.rel.avancar(5000);
  caso('honra: ballot "lendo" relê sozinho (só GET) até a lista chegar', s2.qq('.lc-cp-hj').length === 9 && s2.escritas().length === 0, s2.texto());
}
{ // 4 e 11: o campo de texto da sala sobrevive a mensagem nova; 100+ mensagens seguem mostrando a última
  const muitas = [...clone(FX.chat), ...Array.from({ length: 105 }, (_, i) => ({ id: 'm' + i, type: 'groupchat', body: 'msg ' + i, fromPuuid: 'puuid-2', timestamp: '' }))];
  const s = cenario({ chat: muitas });
  await s.honra(); await s.ir('EndOfGame');
  const input = s.q('[data-a="sala-texto"]');
  input.value = 'digitando'; input.disparar('input');
  s.est.chat.push({ id: 'nova', type: 'groupchat', body: 'mensagem nova', fromPuuid: 'puuid-3', timestamp: '' });
  await s.rel.avancar(1600);
  caso('sala: mensagem nova não recria o campo (o mesmo <input>, com o que ele digitava)', s.q('[data-a="sala-texto"]') === input && input.value === 'digitando');
  caso('sala com 100+ mensagens: a nova aparece (repinta pelo id da última, não pelo tamanho)', s.q('.lc-cp-ms').textContent.includes('mensagem nova')
    && s.qq('.lc-cp-cm').length === 100, String(s.qq('.lc-cp-cm').length));
}
{ // 6: nome nunca no aviso (o avisar cai no console.log sem camada); 14: comentário da denúncia sobrevive à troca de tela
  const s = cenario();
  await s.honra();
  await s.clicar(s.linha('puuid-3').querySelector('[data-a="adicionar"]'));
  caso('adicionar: o aviso cita só o campeão, nunca o Riot ID', s.avisos.some(([m]) => /pedido de amizade enviado/.test(m)) && !s.avisos.some(([m]) => NOMES_FX.some(n => m.includes(n))),
    JSON.stringify(s.avisos));
  await s.clicar(s.linha('puuid-6').querySelector('[data-a="denunciar"]'));
  await s.clicar(s.q('.lc-cp-den [data-a="categoria"][data-cat="BOTTING"]'));
  const ta = s.q('.lc-cp-den textarea'); ta.value = 'afk o jogo inteiro'; ta.disparar('input');
  await s.ir('EndOfGame');
  await s.clicar(s.q('[data-a="aba-detalhes"]'));
  await s.clicar(s.qq('.lc-cp-jg').find(l => l.dataset.puuid === 'puuid-6').querySelector('[data-a="denunciar"]'));
  caso('denúncia: comentário e categoria digitados na honra voltam no pós-jogo (rascunho por partida e jogador), nada enviado',
    s.q('.lc-cp-den textarea')?.value === 'afk o jogo inteiro' && s.q('.lc-cp-den [data-cat="BOTTING"]')?.classList.contains('lc-cp-on')
    && !s.escritas().some(w => w.includes('end-of-game-reports')), s.escritas().join(', '));
  await s.clicar(s.q('[data-a="fechar-denuncia"]'));
  await s.clicar(s.qq('.lc-cp-jg').find(l => l.dataset.puuid === 'puuid-6').querySelector('[data-a="denunciar"]'));
  caso('denúncia: FECHAR descarta o rascunho (ele desistiu)', s.q('.lc-cp-den textarea')?.value === '');
}
{ // 13 e 8: JOGAR DE NOVO e fechar ignoram clique sintético; ir para o lobby sem saber do grupo não cai no ✕ calado
  const s = cenario({ rotas: { 'GET /lol-gameflow/v1/gameflow-metadata/player-status': {} } });
  await s.honra(); await s.ir('EndOfGame');
  await s.clicar(s.q('[data-a="jogar"]'), { isTrusted: false });
  await s.clicar(s.q('[data-a="jogar"]'), { isTrusted: false });
  await s.clicar(s.q('[data-a="fechar-pj"]'), { isTrusted: false });
  caso('pós-jogo: JOGAR DE NOVO e fechar com clique sintético não escrevem nada', s.escritas().length === 0, s.escritas().join(', '));
  await s.clicar(s.q('[data-a="lobby"]'));
  caso('ir para o lobby sem play-again e sem saber do grupo: não usa o fechar da Riot (dismiss-stats); avisa e abre o client normal',
    s.escritas().length === 0 && s.foto().efetivo === 'expandido' && s.avisos.some(([m, e]) => e && /lobby/.test(m)), s.escritas().join(', '));
}
{
  const s = cenario({ rotas: { 'GET /lol-gameflow/v1/gameflow-metadata/player-status': { lastQueuedLobbyStatus: { queueId: 420, isLeader: true, memberSummonerIds: [111], allowedPlayAgain: false } } } });
  await s.honra(); await s.ir('EndOfGame');
  await s.clicar(s.q('[data-a="lobby"]'));
  caso('ir para o lobby sozinho sem play-again: dismiss-stats com o aviso "indo para o início"', igual(s.escritas(), ['POST /lol-end-of-game/v1/state/dismiss-stats'])
    && s.avisos.some(([m]) => /indo para o início/.test(m)), s.escritas().join(', '));
}

// ---------- 7. a faixa cresce sozinha (etapa A de roadmap/2026-10-16-chat-da-sala-som-icones.md) ----------
{ // funções puras
  caso('cresce: chaves do remetente sem os vazios da sala MUC ("" e 0), na ordem do getDisplayName da Riot',
    igual(sala.chavesDe({ fromPuuid: 'p', fromObfuscatedPuuid: '', fromSummonerId: 0, fromObfuscatedSummonerId: 77, fromId: 'x@a', fromPid: 'x@a', gameName: 'Nome' }), ['p', '77', 'x@a', 'x@a']));
  const L = (id, de, hist = false) => ({ id, de, hist, texto: id, quando: '' });
  const base = sala.novasDeOutros([L('a', ['p2']), L('b', ['p3'])], null, new Set(['eu']));
  caso('cresce: 1ª leitura da sala é base (o que já estava na sala ao abrir nunca conta como novo)', base.novas === 0 && base.vistos.size === 2);
  const dep = sala.novasDeOutros([L('a', ['p2']), L('b', ['p3']), L('c', ['p4']), L('d', ['obf-eu']), L('e', ['p5'], true)], base.vistos, new Set(['eu', 'obf-eu']));
  caso('cresce: só a nova de outro jogador conta; a minha (até só com a chave obfuscated) e a histórica não', dep.novas === 1 && dep.vistos.size === 5);
  caso('cresce: a lista de vistos de entrada não muda', base.vistos.size === 2);
  caso('cresce: só recolhida, com a chave ligada (ausente = ligada) e mensagem nova',
    sala.deveCrescer({ tam: 'recolhido', novas: 1 }) && sala.deveCrescer({ tam: 'recolhido', novas: 1, ligado: undefined }) && !sala.deveCrescer({ tam: 'recolhido', novas: 1, ligado: false })
    && !sala.deveCrescer({ tam: 'normal', novas: 3 }) && !sala.deveCrescer({ tam: 'recolhido', novas: 0 }));
  const conv = [{ id: 'velha@champ-select.br1.pvp.net', type: 'championSelect', password: 'x' }, { id: 'muc1@lobby.br1.pvp.net', type: 'teamBuilder' },
    { id: 'MUC2@champ-select.br1.pvp.net', type: 'championSelect', password: 'nunca', mucJwtDto: { jwt: 'nunca' } }];
  caso('sala da seleção: a desta sessão pelo multiUserChatId (startsWith, como o front da Riot); a anterior, a do lobby e sem muc = nenhuma; só id e type saem',
    igual(sala.acharSalaSelecao(conv, 'muc2'), { id: 'MUC2@champ-select.br1.pvp.net', type: 'championSelect' }) && sala.acharSalaSelecao(conv, 'muc1') === null
    && sala.acharSalaSelecao(conv, '') === null && sala.acharSalaSelecao(conv.slice(0, 1), 'muc2') === null && sala.acharSalaSelecao('lixo', 'muc2') === null
    && sala.mucDaSessao({ chatDetails: { multiUserChatId: 'muc2', multiUserChatPassword: 'nunca' } }) === 'muc2' && sala.mucDaSessao(null) === '');
}
const novaMsg = (s, id, puuid, body = 'oi') => s.est.chat.push({ id, type: 'groupchat', body, fromPuuid: puuid, fromSummonerId: 0, isHistorical: false, timestamp: '' });
{ // honra: nasce recolhida; mensagem de outro = normal; nada de foco, escrita ou "lida"
  const s = cenario();
  await s.honra();
  await s.rel.avancar(1600);
  const dock = () => s.q('.lc-cp-dock');
  caso('cresce (honra): as mensagens que já estavam na sala não abrem a faixa', dock().dataset.tam === 'recolhido');
  novaMsg(s, 'eu1', 'puuid-eu', 'minha');
  await s.rel.avancar(1600);
  caso('cresce (honra): a minha mensagem não abre a faixa', dock().dataset.tam === 'recolhido');
  s.est.chat.push({ id: 'sis1', type: 'system', body: 'joined_room', fromPuuid: 'puuid-7', timestamp: '' });
  novaMsg(s, 'h1', 'puuid-4', 'velha');
  s.est.chat[s.est.chat.length - 1].isHistorical = true;
  await s.rel.avancar(1600);
  caso('cresce (honra): "entrou na sala" e mensagem histórica não abrem a faixa', dock().dataset.tam === 'recolhido');
  novaMsg(s, 'o1', 'puuid-3', 'bora de novo?');
  await s.rel.avancar(1600);
  caso('cresce (honra): mensagem de outro jogador abre a faixa (normal) e mostra a mensagem', dock().dataset.tam === 'normal' && s.q('.lc-cp-ms').textContent.includes('bora de novo?'));
  caso('cresce (honra): sem foco de teclado, nenhuma escrita, nenhum "lida" (PUT conversations/active)', !s.doc.focos && s.escritas().length === 0
    && !s.falsa.chamadas.some(c => /conversations\/active/.test(c.url)), `${s.doc.focos} ${s.escritas().join(', ')}`);
  await s.clicar(s.q('[data-a="sala-recolher"]'));
  novaMsg(s, 'o2', 'puuid-5', 'e aí');
  await s.rel.avancar(1600);
  caso('cresce (honra): recolhida por ele, abre de novo na próxima mensagem de outro jogador', dock().dataset.tam === 'normal');
  await s.clicar(s.q('[data-a="sala-aumentar"]'));
  novaMsg(s, 'o3', 'puuid-2', 'alto');
  await s.rel.avancar(1600);
  caso('cresce (honra): aberta no alto não muda de tamanho', dock().dataset.tam === 'alto');
}
{ // chave desligada: a faixa só abre pelo clique; o contador sobe
  const s = cenario({ cfgCompacto: { chatSalaCresce: false } });
  await s.honra();
  await s.rel.avancar(1600);
  novaMsg(s, 'o1', 'puuid-3', 'oi time');
  await s.rel.avancar(1600);
  caso('cresce desligado: a faixa fica recolhida e o contador sobe (4)', s.q('.lc-cp-dock').dataset.tam === 'recolhido' && s.q('.lc-cp-un')?.textContent === '4', s.q('.lc-cp-dock').textContent);
  s.cfg.compacto.chatSalaCresce = true; // vale na hora (o cfg é o mesmo objeto)
  novaMsg(s, 'o2', 'puuid-3', 'oi de novo');
  await s.rel.avancar(1600);
  caso('cresce religado: vale na próxima mensagem, sem recarregar', s.q('.lc-cp-dock').dataset.tam === 'normal');
}
{ // pós-jogo: nasce aberta; recolhida por ele, cresce de novo
  const s = cenario();
  await s.honra(); await s.ir('EndOfGame');
  await s.rel.avancar(1600);
  caso('cresce (pós-jogo): nasce aberta', s.q('.lc-cp-dock').dataset.tam === 'normal');
  await s.clicar(s.q('[data-a="sala-recolher"]'));
  novaMsg(s, 'o1', 'puuid-6', 'ggwp');
  await s.rel.avancar(1600);
  caso('cresce (pós-jogo): recolhida por ele, mensagem de outro jogador abre de novo; sem foco nem escrita', s.q('.lc-cp-dock').dataset.tam === 'normal'
    && !s.doc.focos && s.escritas().length === 0);
}

relatar(casos);
