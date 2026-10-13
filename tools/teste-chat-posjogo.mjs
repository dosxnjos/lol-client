// Testa pengu/chat-posjogo.js sem o client: elenco do eog, nomes com campeão e ícone do próprio client, cor certa do
// time, "entrou/deixou o saguão" escondidos (pt-BR e inglês), desligar devolve o original, repintar não mexe no DOM,
// decisão de abrir/manter/recolher e o log sem Riot ID. DOM mínimo feito aqui (sem jsdom), no formato do template do
// client; fixture sintética em tests/fixtures/chat-posjogo.json. uso: node tools/teste-chat-posjogo.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { montarElenco, completarComEntradas, acharJogador, padroesSala, lerLinhaSala, partesNome, reescrever, decidirAbertura,
  deveRecolherNoEsc, deveReabrir, fecharAoDesligar, ajustarSala, limparBidi, CSS_QUADRO, iniciarChatPosjogo } from '../pengu/chat-posjogo.js';
import { relatar } from './lcu-falsa.mjs';

const fx = JSON.parse(readFileSync(fileURLToPath(new URL('../tests/fixtures/chat-posjogo.json', import.meta.url)), 'utf8'));

// ---- DOM mínimo: elementos, texto, classList, dataset, querySelector(All) com classe/tag/[attr] e descendente ----
let escritas = 0; // toda troca de verdade no DOM conta (para provar que repintar igual não mexe em nada)
class Classes {
  constructor() { this.s = new Set(); }
  contains(c) { return this.s.has(c); }
  add(...cs) { for (const c of cs) if (!this.s.has(c)) { this.s.add(c); escritas++; } }
  remove(...cs) { for (const c of cs) if (this.s.delete(c)) escritas++; }
  toggle(c, f) { const q = f === undefined ? !this.s.has(c) : !!f; if (q) this.add(c); else this.remove(c); return q; }
  toString() { return [...this.s].join(' '); }
}
class Texto {
  constructor(t, doc) { this.nodeType = 3; this.data = String(t); this.ownerDocument = doc; this.parentNode = null; }
  get textContent() { return this.data; }
}
class Elem {
  constructor(tag, doc) {
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.parentNode = null;
    this.childNodes = []; this.classList = new Classes(); this.dataset = {}; this.attrs = new Map();
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList = new Classes(); for (const c of String(v).split(/\s+/).filter(Boolean)) this.classList.s.add(c); escritas++; }
  setAttribute(k, v) { if (k === 'class') this.className = v; else { this.attrs.set(k, String(v)); escritas++; } }
  getAttribute(k) { return k === 'class' ? this.className : this.attrs.get(k) ?? null; }
  removeAttribute(k) { if (this.attrs.delete(k)) escritas++; }
  contains(n) { for (let p = n; p; p = p.parentNode) if (p === this) return true; return false; }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  append(...ns) { for (let n of ns) { if (typeof n === 'string') n = new Texto(n, this.ownerDocument); n.parentNode = this; this.childNodes.push(n); escritas++; } }
  appendChild(n) { this.append(n); return n; }
  replaceChildren(...ns) { this.childNodes = []; escritas++; this.append(...ns); }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this.childNodes = []; escritas++; this.append(new Texto(v, this.ownerDocument)); }
  *descendentes() { for (const n of this.children) { yield n; yield* n.descendentes(); } }
  casa(simples) { // tag.classe.classe[attr="v"]
    const m = simples.match(/^([a-z0-9-]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i);
    if (!m) throw new Error('seletor não suportado: ' + simples);
    if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
    for (const c of m[2].split('.').filter(Boolean)) if (!this.classList.contains(c)) return false;
    for (const a of m[3].match(/\[[^\]]+\]/g) || []) {
      const [, k, v] = a.match(/^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/);
      if (v === undefined ? !this.attrs.has(k) : this.getAttribute(k) !== v) return false;
    }
    return true;
  }
  casaComplexo(partes) {
    if (!this.casa(partes[partes.length - 1])) return false;
    let i = partes.length - 2, p = this.parentNode;
    while (i >= 0 && p) { if (p.casa?.(partes[i])) i--; p = p.parentNode; }
    return i < 0;
  }
  querySelectorAll(sel) {
    const grupos = sel.split(',').map(s => s.trim().split(/\s+/));
    return [...this.descendentes()].filter(d => grupos.some(g => d.casaComplexo(g)));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}
function novoDoc() {
  const doc = { createElement: t => new Elem(t, doc), createTextNode: t => new Texto(t, doc) };
  doc.documentElement = new Elem('html', doc);
  doc.querySelectorAll = s => doc.documentElement.querySelectorAll(s);
  doc.querySelector = s => doc.documentElement.querySelector(s);
  return doc;
}
// linhas do chat no formato do template do client (message-box > chat-message > .message-name + ':' + corpo)
function montarQuadro(linhas) {
  const doc = novoDoc(), lista = doc.createElement('div');
  lista.className = 'messages';
  doc.documentElement.append(lista);
  const caixas = {};
  for (const l of linhas) {
    const caixa = doc.createElement('div');
    caixa.className = `message-box ${l.classe}`;
    if (l.nome) {
      const cm = doc.createElement('div'); cm.className = 'chat-message';
      const nome = doc.createElement('div'); nome.className = 'message-name'; nome.textContent = l.nome;
      const dois = doc.createElement('span'); dois.className = 'message'; dois.textContent = ':';
      const corpo = doc.createElement('span'); corpo.className = 'message'; corpo.textContent = l.texto;
      cm.append(nome, ' ', dois, ' ', corpo);
      caixa.append(cm);
    } else {
      const sm = doc.createElement('div'); sm.className = 'system-message';
      const span = doc.createElement('span');
      if (l.celebracao) span.className = 'celebration';
      span.textContent = l.sistema ?? l.celebracao;
      sm.append(span);
      caixa.append(sm);
    }
    lista.append(caixa);
    caixas[l.id] = caixa;
  }
  return { doc, caixas, nome: id => caixas[id].querySelector('.message-name') };
}

// ---- elenco ----
const elenco = completarComEntradas(montarElenco(fx.eog, fx.eu, fx.campeoes), fx.mensagens);
const padroes = padroesSala(fx.trans);
const semEog = montarElenco(null, fx.eu, fx.campeoes);
// eog sem isPlayerTeam: o time sai do jogador atual
const eogSemFlag = { teams: fx.eog.teams.map(t => ({ ...t, isPlayerTeam: undefined })) };
const elencoSemFlag = montarElenco(eogSemFlag, fx.eu, fx.campeoes);
// eog antigo (listas separadas)
const elencoAntigo = montarElenco({ teamPlayerParticipantStats: fx.eog.teams[0].players, otherTeamPlayerParticipantStats: fx.eog.teams[1].players }, fx.eu, fx.campeoes);

// ---- pintura ----
const OP = { ligado: true, nomes: 'ambos', iconeCampeao: true, corTime: true, abrirSozinho: true, manterAberto: true, esconderEntrouSaiu: true, escurecerSaiu: true };
const q = montarQuadro(fx.linhas);
const orig = Object.fromEntries(fx.linhas.filter(l => l.nome).map(l => [l.id, l.nome]));
const r1 = reescrever(q.doc, elenco, OP, padroes);
const icone = id => q.nome(id).querySelector('img.lc-chat-icone')?.getAttribute('src') ?? null;
const ambos = {
  aliado: q.nome('aliado').textContent, inimigo: q.nome('inimigo').textContent, minha: q.nome('minha').textContent,
  semTag: q.nome('sem-tag').textContent, iconeAliado: icone('aliado'), iconeInimigo: icone('inimigo'),
};
const classes = id => q.caixas[id].className;
const depois1 = Object.fromEntries(Object.keys(q.caixas).map(id => [id, classes(id)]));
escritas = 0;
const r2 = reescrever(q.doc, elenco, OP, padroes);
const escritasRepintar = escritas;

const r3 = reescrever(q.doc, elenco, { ...OP, nomes: 'campeao' }, padroes);
const soCampeao = { aliado: q.nome('aliado').textContent, icone: icone('aliado') };
reescrever(q.doc, elenco, { ...OP, nomes: 'jogador', iconeCampeao: false }, padroes);
const soJogador = { aliado: q.nome('aliado').textContent, ds: { ...q.nome('aliado').dataset } };
reescrever(q.doc, elenco, { ...OP, nomes: 'jogador', iconeCampeao: true }, padroes);
const jogadorComIcone = { texto: q.nome('aliado').textContent, icone: icone('aliado') };
// o client repinta o nome (Ember): volta a ser pintado
reescrever(q.doc, elenco, OP, padroes);
q.nome('inimigo').textContent = orig.inimigo;
reescrever(q.doc, elenco, OP, padroes);
const repintadoPeloClient = q.nome('inimigo').textContent;
// cor do time desligada: devolve a classe do client
reescrever(q.doc, elenco, { ...OP, corTime: false }, padroes);
const semCor = classes('aliado');
reescrever(q.doc, elenco, OP, padroes);
// esconder desligado: linhas do saguão voltam
reescrever(q.doc, elenco, { ...OP, esconderEntrouSaiu: false }, padroes);
const semEsconder = ['entrou', 'saiu', 'entrou-en'].map(id => q.caixas[id].classList.contains('lc-oculta'));
reescrever(q.doc, elenco, OP, padroes);
// tudo desligado: devolve exatamente o original
reescrever(q.doc, elenco, { ...OP, ligado: false }, padroes);
const desligado = {
  nomes: Object.entries(orig).every(([id, t]) => q.nome(id).textContent === t && q.nome(id).childNodes.length === 1 && q.nome(id).dataset.lcOriginal === undefined),
  aliado: classes('aliado'), ocultas: Object.values(q.caixas).filter(c => c.classList.contains('lc-oculta')).length,
};

// ---- decisão de abrir/manter ----
const d = (o = {}) => decidirAbertura({ op: OP, placar: true, painel: false, aberto: false, recolhido: false, jaAbriu: false, saiuDoPlacar: false, ...o });

// ---- Esc, Enter e desligar no meio da tela ----
const esc = (o = {}) => deveRecolherNoEsc({ op: OP, naFase: true, painel: false, sala: true, noPlacar: true, recolhido: false, aberto: true, focoNaSala: true, ...o });
const reabre = (o = {}) => deveReabrir({ op: OP, naFase: true, recolhido: true, painel: false, tipo: 'keydown', focoNaSala: true, cliqueNoCampo: false, ...o });
const fecha = (o = {}) => fecharAoDesligar({ op: { ...OP, ligado: false }, abertoPorNos: true, aberto: true, focoNaSala: false, ...o });
// sala do pós-jogo com o "esconder chat" do client e avisos de troca de sala
function montarSala() {
  const doc = novoDoc(), s = doc.createElement('lol-social-chat-room');
  s.setAttribute('type', 'postGame');
  s.setAttribute('can-hide-player-messages', 'true');
  s.setAttribute('room-changed-messages', JSON.stringify(['Fulano #BR1 entrou no saguão', 'Aviso que fica', 'Fulano #BR1 deixou o saguão']));
  const entrada = doc.createElement('lol-social-chat-input');
  entrada.setAttribute('can-hide-player-messages', '');
  const botao = doc.createElement('div');
  botao.className = 'chat-toggle-button can-hide-player-messages';
  s.append(entrada, botao);
  doc.documentElement.append(s);
  const attrs = el => [...el.attrs].sort(([a], [b]) => a.localeCompare(b));
  const foto = () => JSON.stringify({ s: s.className, a: attrs(s), e: attrs(entrada), b: botao.className,
    ds: [s.dataset, entrada.dataset, botao.dataset].map(d => Object.keys(d).length) });
  return { s, entrada, botao, foto };
}
const sl = montarSala();
const salaAntes = sl.foto();
ajustarSala(sl.s, OP, padroes);
const salaLigada = { esconde: sl.s.getAttribute('can-hide-player-messages'), entrada: sl.entrada.getAttribute('can-hide-player-messages'),
  botao: sl.botao.className, avisos: sl.s.getAttribute('room-changed-messages'), classe: sl.s.className };
escritas = 0;
ajustarSala(sl.s, OP, padroes);
const escritasSala = escritas;
ajustarSala(sl.s, { ...OP, ligado: false }, padroes);
const salaDesligada = sl.foto();
escritas = 0;
ajustarSala(sl.s, { ...OP, ligado: false }, padroes);
const escritasSalaDesligada = escritas;
// o client reescreveu os avisos depois do nosso filtro: desligar não devolve a lista velha por cima
const sl2 = montarSala();
ajustarSala(sl2.s, OP, padroes);
sl2.s.setAttribute('room-changed-messages', JSON.stringify(['Lista nova do client']));
ajustarSala(sl2.s, { ...OP, esconderEntrouSaiu: false }, padroes);
const avisosDoClient = sl2.s.getAttribute('room-changed-messages');
const fonteChat = readFileSync(fileURLToPath(new URL('../pengu/chat-posjogo.js', import.meta.url)), 'utf8');

// ---- log sem Riot ID: o módulo no client com socket, fetch e DOM falsos (sem sala na tela) ----
const logs = [];
const logOriginal = console.log;
console.log = (...a) => logs.push(a.join(' '));
const obs = {};
const rotas = {
  '/fe/lol-social/trans.json': fx.trans, '/lol-game-data/assets/v1/champion-summary.json': fx.campeoes, '/lol-summoner/v1/current-summoner': fx.eu,
  '/lol-end-of-game/v1/eog-stats-block': fx.eog, '/lol-chat/v1/conversations': [{ id: 'sala-1', type: 'postGame' }],
  '/lol-chat/v1/conversations/sala-1/messages': fx.mensagens, '/lol-gameflow/v1/gameflow-phase': 'None',
};
const pedidos = [];
globalThis.fetch = async (url, init) => {
  pedidos.push(`${init?.method || 'GET'} ${url}`);
  const v = rotas[url];
  return { ok: v !== undefined, status: v === undefined ? 404 : 200, text: async () => (v === undefined ? '' : JSON.stringify(v)) };
};
const intervalos = [];
globalThis.window = { scrollX: 0, scrollY: 0, scrollTo() {}, innerWidth: 1280, innerHeight: 720 };
globalThis.document = { body: {}, documentElement: {}, querySelector: () => null, querySelectorAll: () => [], getElementById: () => null, addEventListener() {} };
const intervaloOriginal = globalThis.setInterval;
globalThis.setInterval = (fn, ms) => { intervalos.push(ms); return 0; };
const chat = iniciarChatPosjogo({ socket: { observe: (rota, fn) => { obs[rota] = fn; } } }, { chatPosjogo: OP });
obs['/lol-gameflow/v1/gameflow-phase']({ data: 'EndOfGame', eventType: 'Update' });
await new Promise(r => setTimeout(r, 700));
const estado = chat.estado();
globalThis.setInterval = intervaloOriginal;
console.log = logOriginal;
const nomesFalsos = ['Jogador', 'Eu#', 'Ninguem'];

relatar([
  ['elenco: 10 jogadores, 5 aliados (com o próprio)', elenco.length === 10 && elenco.filter(p => p.aliado).length === 5 && elenco.find(p => p.puuid === 'puuid-eu').aliado],
  ['elenco: ícone sempre do próprio client (/lol-game-data/...)', elenco.every(p => p.icone.startsWith('/lol-game-data/assets/v1/champion-icons/'))],
  ['elenco: campeão sem squarePortraitPath cai no champion-icons/{id}.png do client', elenco.find(p => p.puuid === 'puuid-9').icone === '/lol-game-data/assets/v1/champion-icons/103.png'],
  ['elenco: joined_room completa o summonerId que faltava', elenco.find(p => p.puuid === 'puuid-3').summonerId === 103],
  ['elenco: sem eog = vazio', semEog.length === 0],
  ['elenco: eog sem isPlayerTeam -> time do jogador atual', elencoSemFlag.filter(p => p.aliado).length === 5 && elencoSemFlag.find(p => p.puuid === 'puuid-5').aliado === false],
  ['elenco: formato antigo (listas separadas) também', elencoAntigo.length === 10 && elencoAntigo.filter(p => p.aliado).length === 5],
  ['acharJogador: Riot ID com marcas bidi, sem tag, campeão único; campeão repetido = ninguém', acharJogador(elenco, orig.aliado)?.puuid === 'puuid-2'
    && acharJogador(elenco, 'Jogador3')?.puuid === 'puuid-3' && acharJogador(elenco, 'Renekton')?.puuid === 'puuid-1'
    && acharJogador(elenco, 'Ahri') === null && acharJogador(elenco, orig.desconhecido) === null && acharJogador(elenco, 'Jogador2#BR2') === null],
  ['saguão: padrão lido do trans.json e o inglês de reserva', lerLinhaSala(fx.linhas[0].sistema, padroes)?.tipo === 'entrou'
    && lerLinhaSala(fx.linhas[1].sistema, padroes)?.tipo === 'saiu' && lerLinhaSala('A #B joined the lobby', padroes)?.nome === 'A #B'
    && lerLinhaSala('Jogador1 entrou na partida', padroes) === null],
  ['saguão: sem trans.json cai no pt-BR medido', lerLinhaSala('Fulano #BR1 deixou o saguão', padroesSala(null))?.nome === 'Fulano #BR1'
    && lerLinhaSala('X entrou no saguão', padroesSala({ system_message_joined_room: 42 }))?.tipo === 'entrou'],
  ['ambos: "Nome #TAG(Campeão)" com ícone', ambos.aliado === 'Jogador2 #BR1(Ahri)' && ambos.inimigo === 'Jogador6 #BR1(Lee Sin)'
    && ambos.minha === 'Eu #BR1(Zac)' && ambos.semTag === 'Jogador3(Jinx)' && ambos.iconeAliado === '/lol-game-data/assets/v1/champion-icons/103.png', JSON.stringify(ambos)],
  ['aliado que o client pintou de inimigo vira my-team; inimigo fica other-team; a minha fica mine', depois1.aliado === 'message-box my-team'
    && depois1.inimigo === 'message-box other-team' && depois1.minha === 'message-box mine' && depois1['sem-tag'] === 'message-box my-team' && r1.times === 2, JSON.stringify(depois1)],
  ['"entrou" (pt-BR e inglês) e "deixou o saguão" escondidos', ['entrou', 'saiu', 'entrou-en'].every(id => depois1[id].includes('lc-oculta')) && r1.ocultas === 3, JSON.stringify(r1)],
  ['celebração e nome desconhecido intocados', q.nome('desconhecido').textContent === orig.desconhecido && q.nome('desconhecido').dataset.lcOriginal === undefined
    && depois1.desconhecido === 'message-box other-team' && depois1.honra === 'message-box other-team'],
  ['repintar igual não mexe no DOM (o observador do iframe não entra em laço)', escritasRepintar === 0 && r2.nomes === 0 && r2.times === 0, JSON.stringify({ escritasRepintar, r2 })],
  ['só o campeão: "Ahri" com ícone', soCampeao.aliado === 'Ahri' && soCampeao.icone && r3.nomes === 4, JSON.stringify({ soCampeao, r3 })],
  ['só o nome sem ícone: devolve o texto original exato (com as marcas bidi)', soJogador.aliado === orig.aliado && soJogador.ds.lcOriginal === undefined, JSON.stringify(soJogador)],
  ['só o nome com ícone: nome limpo + ícone', jogadorComIcone.texto === 'Jogador2 #BR1' && jogadorComIcone.icone, JSON.stringify(jogadorComIcone)],
  ['o client repinta o nome: pintado de novo', repintadoPeloClient === 'Jogador6 #BR1(Lee Sin)', repintadoPeloClient],
  ['cor do time desligada: a classe do client volta', semCor === 'message-box other-team', semCor],
  ['esconder desligado: as linhas do saguão voltam', semEsconder.every(v => v === false), JSON.stringify(semEsconder)],
  ['tudo desligado: nomes, classes e linhas exatamente como o client deixou', desligado.nomes && desligado.aliado === 'message-box other-team' && desligado.ocultas === 0, JSON.stringify(desligado)],
  ['partesNome: jogador sem campeão no modo ambos e sem ícone = original', JSON.stringify(partesNome('X', { campeao: '', icone: '' }, OP)) === '[{"texto":"X"}]'],
  ['limparBidi tira as marcas', limparBidi(orig.aliado) === 'Jogador2 #BR1'],
  ['CSS do iframe esconde .lc-oculta e pinta os 3 times', CSS_QUADRO.includes('.message-box.lc-oculta') && ['my-team', 'other-team', 'mine'].every(t => CSS_QUADRO.includes(`.message-box.${t} .message-name`))],
  ['abrir: entra no placar com abrirSozinho -> abrir', d() === 'abrir'],
  ['abrir: painel #lc-posjogo aberto -> não mexe', d({ painel: true }) === null && d({ painel: true, recolhido: true, aberto: true }) === null],
  ['abrir: fora do placar (Progresso) -> não mexe', d({ placar: false }) === null],
  ['manter: já abriu, o client fechou no blur -> abrir de novo', d({ jaAbriu: true }) === 'abrir'],
  ['manter desligado: já abriu e fechou -> deixa fechado', d({ jaAbriu: true, op: { ...OP, manterAberto: false } }) === null],
  ['abrir sozinho desligado: não abre na entrada', d({ op: { ...OP, abrirSozinho: false } }) === null],
  ['recolhido por ele e o client reabriu -> fechar (com manter); sem manter, deixa', d({ recolhido: true, aberto: true }) === 'fechar'
    && d({ recolhido: true, aberto: true, op: { ...OP, manterAberto: false } }) === null && d({ recolhido: true }) === null],
  ['saiu do placar com o chat aberto -> fechar uma vez', d({ saiuDoPlacar: true, aberto: true, placar: false }) === 'fechar'],
  ['módulo desligado -> não mexe', d({ op: { ...OP, ligado: false } }) === null],
  ['Esc com o cursor no chat recolhe; fora do chat (janela do client por cima) fica com o client', esc() === true && esc({ focoNaSala: false }) === false],
  ['Esc: painel aberto, módulo ou manter desligado, já recolhido ou fora do placar -> não recolhe', [{ painel: true }, { op: { ...OP, ligado: false } },
    { op: { ...OP, manterAberto: false } }, { recolhido: true }, { noPlacar: false }, { aberto: false }, { naFase: false }].every(o => esc(o) === false)],
  ['Enter fora do chat, com o painel ou o Ctrl+K, não reabre o chat recolhido', reabre() === true && reabre({ focoNaSala: false }) === false
    && reabre({ painel: true }) === false],
  ['Enter ou clique com o módulo desligado não reabre; clique no campo reabre (só se recolhido)', reabre({ op: { ...OP, ligado: false } }) === false
    && reabre({ tipo: 'pointerdown', cliqueNoCampo: true, op: { ...OP, ligado: false } }) === false && reabre({ tipo: 'pointerdown', cliqueNoCampo: true }) === true
    && reabre({ tipo: 'pointerdown', cliqueNoCampo: false }) === false && reabre({ recolhido: false }) === false],
  ['desligar com o chat aberto por nós fecha; com o cursor nele, aberto pelo client ou ainda ligado, fica', fecha() === true && fecha({ focoNaSala: true }) === false
    && fecha({ abertoPorNos: false }) === false && fecha({ op: OP }) === false && fecha({ op: { ...OP, abrirSozinho: false, manterAberto: false } }) === true],
  ['sala ligada: mensagens desbloqueadas e "entrou/deixou" fora da lista de avisos', salaLigada.esconde === null && salaLigada.entrada === null
    && salaLigada.botao === 'chat-toggle-button' && salaLigada.avisos === '["Aviso que fica"]' && salaLigada.classe.includes('lc-chat-desbloqueado'), JSON.stringify(salaLigada)],
  ['sala: repetir não mexe no DOM; desligar devolve tudo como o client deixou; desligado repetido não mexe', escritasSala === 0
    && salaDesligada === salaAntes && escritasSalaDesligada === 0, JSON.stringify({ escritasSala, salaAntes, salaDesligada, escritasSalaDesligada })],
  ['sala: lista de avisos reescrita pelo client não é trocada pela velha ao desligar', avisosDoClient === '["Lista nova do client"]', avisosDoClient],
  ['nunca .focus() no código (rola o client inteiro)', !/\.focus\(\)/.test(fonteChat.replace(/^\s*\/\/.*$/gm, ''))],
  ['no client (falso): elenco montado na fase EndOfGame, só GET, sonda de 250 ms', estado.naFase && estado.jogadores === 10
    && pedidos.every(p => p.startsWith('GET ')) && intervalos.includes(250), JSON.stringify({ estado, pedidos })],
  ['log sem Riot ID (só a contagem)', logs.some(l => l.includes('10 jogadores')) && !logs.some(l => nomesFalsos.some(n => l.includes(n))), JSON.stringify(logs)],
]);
