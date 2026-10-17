// Testa as telas 1 (lobby) e 2 (na fila) do client compacto (pengu/compacto/tela-lobby.js e tela-fila.js) sem o
// client: o roteador de verdade (compacto/index.js) monta as telas de verdade, com riotInvoke falso, DOM mínimo feito
// aqui, relógio falso e LCU falsa (fetch global trocado: nada sai para o client). Prova do plano
// roadmap/2026-10-13-client-compacto.md, passo 4: busca só no clique; freio pede o 2º clique; penalidade não busca;
// não-líder não busca nem cancela; cancelar = DELETE; convite aceito/recusado só por clique; chat sem coletor expande.
// uso: node tools/teste-compacto-lobby.mjs
import { relatar, lcuFalsa } from './lcu-falsa.mjs';
import { criarJanela, invocadorRiot, criarCamada } from '../pengu/compacto/modo.js';
import { criarRoteador, CLASSE } from '../pengu/compacto/index.js';
import { _zerarCatalogo } from '../pengu/compacto/comum.js';
import * as modComum from '../pengu/compacto/comum.js';
import { criarTelaLobby, estadoGrupo, planoJogar, convitesPendentes, proximaPosicao, partidasDeHoje, resumoHoje, sequenciaHoje,
  dicaLocal, naoLidas, amigosParaConvidar, ranqueSolo, haQuanto, mmss, _zerarCache, variacaoDoDia, _zerarPdlDia } from '../pengu/compacto/tela-lobby.js';
import { criarTelaFila, estadoBusca, textoEspera, CSS_FILA } from '../pengu/compacto/tela-fila.js';
import * as modFila from '../pengu/compacto/tela-fila.js';
import * as modLobby from '../pengu/compacto/tela-lobby.js';
import { MEDICAO, ATUALIZANDO } from '../pengu/freios.js';

// ---------- DOM mínimo (mesmo do teste-compacto.mjs) ----------
class Classes {
  constructor() { this.s = new Set(); }
  add(...c) { for (const x of c) this.s.add(x); }
  remove(...c) { for (const x of c) this.s.delete(x); }
  contains(c) { return this.s.has(c); }
  toggle(c, f) { const q = f === undefined ? !this.s.has(c) : !!f; if (q) this.s.add(c); else this.s.delete(c); return q; }
  toString() { return [...this.s].join(' '); }
}
class Texto { constructor(t) { this.nodeType = 3; this.data = String(t); this.parentNode = null; } get textContent() { return this.data; } set textContent(v) { this.data = String(v); } remove() { if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; } }
class El {
  constructor(tag, doc) {
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.doc = doc; this.parentNode = null; this.childNodes = [];
    this.classList = new Classes(); this.dataset = {}; this.attrs = new Map(); this.ouvintes = {}; this.id = '';
    const est = {}; est.setProperty = (k, v) => { est[k] = v; }; this.style = est;
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { if (k === 'id') this.id = String(v); else if (k === 'class') this.className = v; else this.attrs.set(k, String(v)); }
  getAttribute(k) { return k === 'id' ? this.id : this.attrs.get(k) ?? null; }
  hasAttribute(k) { return this.attrs.has(k); }
  get disabled() { return this.attrs.has('disabled'); }
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
  disparar(ev) { const e = { target: this, stopPropagation() {}, preventDefault() {} }; for (const fn of this.ouvintes[ev] || []) fn(e); }
  // como o navegador: botão desabilitado não recebe clique (forcar ignora isso: prova que o handler também recusa)
  click(forcar = false) { if (this.disabled && !forcar) return; this.disparar('click'); }
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

// ---------- relógio falso (o mesmo para o roteador e para as telas) ----------
function relogio(inicio) {
  let agora = inicio, prox = 1;
  const fila = new Map();
  return {
    agora: () => agora,
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
  };
}
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

// ---------- dados ----------
const T0 = new Date(2026, 9, 13, 15, 0, 0).getTime(); // 13/10/2026 15:00 local (de dia: freio de madrugada não dispara)
const BUSCA = 'POST /lol-lobby/v2/lobby/matchmaking/search';
const CANCELA = 'DELETE /lol-lobby/v2/lobby/matchmaking/search';
const POS = 'PUT /lol-lobby/v2/lobby/members/localMember/position-preferences';
// valor aleatório nos campos da sala do chat do lobby: prova que estadoGrupo não os carrega adiante
const MARCA_SALA = 'marca-' + Math.random().toString(36).slice(2);
const eu = { summonerId: 111, puuid: 'p-eu', summonerName: '', summonerIconId: 29, isLeader: true, firstPositionPreference: 'TOP', secondPositionPreference: 'JUNGLE', allowedInviteOthers: true };
const amigo = { summonerId: 222, puuid: 'p-amigo', summonerName: '', summonerIconId: 7, isLeader: false };
const lobbySolo = (over = {}) => ({ partyId: 'x', members: [eu], localMember: eu, invitations: [], canStartActivity: true, restrictions: [],
  gameConfig: { queueId: 420, mapId: 11, isCustom: false, showPositionSelector: true }, multiUserChatId: MARCA_SALA, mucJwtDto: { jwt: MARCA_SALA }, ...over });
const lobbyGrupo = (souLider, over = {}) => {
  const me = { ...eu, isLeader: souLider }, ele = { ...amigo, isLeader: !souLider };
  return lobbySolo({ members: [ele, me], localMember: me, gameConfig: { queueId: 440, mapId: 11, isCustom: false, showPositionSelector: true }, ...over });
};
const partida = (id, minutosAtras, vitoria, champ = 58, fila = 420) => ({ gameId: id, mapId: 11, queueId: fila, gameType: 'MATCHED_GAME',
  gameCreation: T0 - minutosAtras * 60000, gameDuration: 1800, participants: [{ championId: champ, stats: { win: vitoria, kills: 2, deaths: 5, assists: 12 } }] });
const HIST = [partida(1, 600, true), partida(2, 500, false), partida(3, 300, false, 154, 400), partida(4, 120, false)];

// cenário: roteador + tela de verdade. rotas extras sobrepõem as padrão; servicos/cfg idem.
function cenario({ fase = 'Lobby', lobby = lobbySolo(), rotas = {}, cfgFila = {}, servicos = {}, coletor = null, inicio = T0, hora = null } = {}) {
  _zerarCache(); _zerarCatalogo(); _zerarPdlDia();
  const rel = relogio(inicio);
  const doc = novoDoc();
  globalThis.document = doc;
  const est = { lobby, fase };
  const falsa = lcuFalsa({
    'GET /lol-gameflow/v1/gameflow-phase': () => est.fase,
    'GET /lol-lobby/v2/lobby': () => (est.lobby ? est.lobby : { status: 404, json: { message: 'LOBBY_NOT_FOUND' } }),
    'POST /lol-lobby/v2/lobby': c => { est.lobby = lobbySolo({ gameConfig: { queueId: c.queueId, mapId: c.queueId === 450 ? 12 : 11, showPositionSelector: c.queueId !== 450 } }); est.fase = 'Lobby'; return est.lobby; },
    [POS]: { status: 201, json: null },
    [BUSCA]: () => { est.fase = 'Matchmaking'; return { status: 204 }; },
    [CANCELA]: () => { est.fase = 'Lobby'; return { status: 204 }; },
    'GET /lol-lobby/v2/received-invitations': [],
    'GET /lol-chat/v1/conversations': [],
    'GET /lol-summoner/v1/current-summoner': { gameName: 'Xerekton', tagLine: 'BR1', profileIconId: 29, puuid: 'p-eu' },
    'GET /lol-ranked/v1/current-ranked-stats': { queueMap: { RANKED_SOLO_5x5: { tier: 'EMERALD', division: 'IV', leaguePoints: 14 } } },
    'GET /lol-game-data/assets/v1/champion-summary.json': [{ id: 58, name: 'Renekton' }, { id: 154, name: 'Zac' }],
    'GET /lol-summoner/v1/summoners/222': { gameName: 'amigo 1' },
    'GET /lol-matchmaking/v1/search': { status: 404, json: { message: 'not in queue' } },
    ...rotas,
  });
  globalThis.fetch = falsa.fetch;
  const cfg = { compacto: { ligado: true, inicioCompacto: true, favoritos: [58, 154], larg: 420, alt: 640 }, aceite: { ligado: true },
    filaRapida: { ligado: true, fila: 420, pos1: 'TOP', pos2: 'JUNGLE', freioTilt: 2, freioMadrugada: true, ...cfgFila } };
  const definidos = [];
  const colChamadas = [];
  const col = coletor ? async (caminho, op = {}) => { colChamadas.push([op.metodo || 'GET', caminho, op.corpo]); return coletor(caminho, op); } : undefined;
  const svc = {
    fila: { derrotasSeguidas: async () => 0 },
    historico: { partidas: () => HIST, ler: async () => {} },
    champ: { estatisticas: id => ({ geral: id === 58 ? { n: 87, winrate: 48 } : id === 154 ? { n: 63, winrate: 48 } : { n: 0 } }) },
    definir: (c, v) => definidos.push([c, v]),
    coletor: col, ...servicos,
  };
  const relHora = hora ? () => new Date(2026, 9, 13, hora, 0, 0) : () => new Date(rel.agora());
  const tLobby = criarTelaLobby({ agora: rel.agora, relogio: relHora });
  const tFila = criarTelaFila({ agora: rel.agora });
  const pedidos = [];
  const win = { innerWidth: 1280, riotInvoke: arg => { const p = JSON.parse(arg.request); pedidos.push(p); if (p.name === 'Window.ResizeTo') win.innerWidth = p.params[0]; } };
  const janela = criarJanela({ invocar: invocadorRiot(win, () => {}), medir: () => [win.innerWidth, 720] });
  const avisos = [], logs = [], subs = new Map();
  const s = { rel, doc, falsa, est, cfg, definidos, colChamadas, avisos, logs, subs, tLobby, tFila, pedidos };
  const camada = criarCamada({ doc, aoExpandir: () => s.rot.expandir(), aoMinimizar: () => {}, aoFechar: () => {} });
  s.rot = criarRoteador({
    cfg, janela, camada, servicos: svc,
    carregarTela: async nome => (nome === 'lobby' ? tLobby : nome === 'fila' ? tFila : Promise.reject(new Error('sem ' + nome))),
    avisar: (m, e) => avisos.push([m, !!e]), log: (...a) => logs.push(a.map(String).join(' ')),
    assinar: (uri, cb) => subs.set(uri, cb),
    classe: on => doc.documentElement.classList.toggle(CLASSE, on),
    agendar: rel.agendar, limpar: rel.limpar, repetir: rel.repetir, pararRepetir: rel.limpar,
  });
  s.ir = async f => { est.fase = f; s.rot.aoFase(f); await tick(); };
  s.iniciar = async () => { s.rot.marcarPronto(); s.rot.preCarregar(); await tick(); await s.ir(fase); await tick(); };
  s.q = sel => doc.getElementById('lc-compacto')?.querySelector(sel) || null;
  s.texto = () => doc.getElementById('lc-compacto')?.textContent || '';
  s.escritas = () => falsa.escritas().map(c => `${c.metodo} ${c.url}`);
  s.buscas = () => s.escritas().filter(x => x === BUSCA).length;
  s.evento = async (uri, data, eventType = 'Update') => { subs.get(uri)?.({ uri, data, eventType }); await tick(); };
  s.clicar = async (sel, forcar = false) => { const el = s.q(sel); if (!el) throw new Error('não achei ' + sel); el.click(forcar); await tick(); };
  s.efetivo = () => s.rot.estado().efetivo;
  return s;
}

const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ================= funções puras =================
{
  const g = estadoGrupo({ ok: true, status: 200, json: lobbySolo() });
  caso('estadoGrupo: solo, líder, fila 420, posições do lobby', g.existe && !g.grupo && g.lider === true && g.fila === 420 && g.pos1 === 'TOP' && g.pos2 === 'JUNGLE', JSON.stringify(g));
  caso('estadoGrupo: dados da sala do chat do lobby não saem', !JSON.stringify(g).includes(MARCA_SALA));
  const g404 = estadoGrupo({ ok: false, status: 404, json: null });
  caso('estadoGrupo: 404 = sem lobby, tu é líder', g404.lido && !g404.existe && g404.lider === true);
  const gErr = estadoGrupo({ ok: false, status: 500, json: null });
  caso('estadoGrupo: erro de leitura = não lido, liderança desconhecida', !gErr.lido && gErr.lider === null);
  const gm = estadoGrupo({ ok: true, status: 200, json: lobbyGrupo(false) });
  caso('estadoGrupo: grupo de outro = não-líder', gm.grupo && gm.lider === false && gm.membros.length === 2 && gm.membros.find(m => m.eu)?.summonerId === 111);
  const gPend = estadoGrupo({ ok: true, status: 200, json: lobbySolo({ invitations: [{ state: 'Pending' }] }) });
  caso('estadoGrupo: convite pendente enviado conta como grupo', gPend.grupo && gPend.pendentes === 1);
  const gPena = estadoGrupo({ ok: true, status: 200, json: lobbySolo({ canStartActivity: false, restrictions: [{ restrictionCode: 'QUEUE_DODGER', expiredTimestamp: Date.now() + 4 * 60000 }] }) });
  caso('estadoGrupo: penalidade vira texto com o código e o prazo', /QUEUE_DODGER/.test(gPena.restricao || '') && /faltam 4 min/.test(gPena.restricao || ''), gPena.restricao);
  const gTorto = estadoGrupo({ ok: true, status: 200, json: { members: 'x', localMember: null, gameConfig: null } });
  caso('estadoGrupo: campos tortos não lançam', gTorto.existe && gTorto.lider === null && gTorto.membros.length === 0);

  caso('planoJogar: solo 420 = solo', igual(planoJogar(g, 420), { pode: true, modo: 'solo' }));
  caso('planoJogar: solo ARAM = aram', planoJogar(g, 450).modo === 'aram');
  caso('planoJogar: não-líder não busca', !planoJogar(gm, 440).pode && planoJogar(gm, 440).rotulo === 'O LÍDER BUSCA');
  caso('planoJogar: penalidade não busca', !planoJogar(gPena, 420).pode && /QUEUE_DODGER/.test(planoJogar(gPena, 420).motivo));
  caso('planoJogar: liderança desconhecida não busca', !planoJogar(estadoGrupo({ ok: true, status: 200, json: lobbyGrupo(true, { localMember: { summonerId: 111 } }) }), 440).pode);
  caso('planoJogar: lobby não lido não busca', !planoJogar(gErr, 420).pode);
  caso('planoJogar: líder de grupo = grupo', planoJogar(estadoGrupo({ ok: true, status: 200, json: lobbyGrupo(true) }), 420).modo === 'grupo');
  caso('planoJogar: personalizado não busca', !planoJogar(estadoGrupo({ ok: true, status: 200, json: lobbySolo({ gameConfig: { queueId: 0, isCustom: true } }) }), 420).pode);
  // lobby só dele numa fila que a tela não cobre (Arena): o JOGAR trocaria o lobby; só depois de ele escolher a fila aqui
  const gArena = estadoGrupo({ ok: true, status: 200, json: lobbySolo({ gameConfig: { queueId: 1700, mapId: 30, isCustom: false, showPositionSelector: false } }) });
  caso('planoJogar: lobby solo da Arena não troca sozinho para a ranqueada (motivo diz a fila)', !planoJogar(gArena, 420).pode && /Arena/.test(planoJogar(gArena, 420).motivo));
  caso('planoJogar: lobby da Arena + fila escolhida nesta tela = solo (troca por clique dele)', igual(planoJogar(gArena, 420, { filaEscolhida: true }), { pode: true, modo: 'solo' }));
  caso('planoJogar: fila do lobby sem número (0/null) não conta como "de fora"',
    planoJogar(estadoGrupo({ ok: true, status: 200, json: lobbySolo({ gameConfig: { queueId: 0, isCustom: false } }) }), 420).pode);
  // variação de PDL do dia (protótipo: "PDL ±0" / "Esmeralda IV 14"): base = 1ª leitura do dia
  let base = null;
  const loja = { get: () => base, set: v => { base = v; } };
  const rk = (tier, div, pdl) => ranqueSolo({ queueMap: { RANKED_SOLO_5x5: { tier, division: div, leaguePoints: pdl } } });
  const v0 = variacaoDoDia(rk('EMERALD', 'IV', 14), T0, loja);
  const v1 = variacaoDoDia(rk('EMERALD', 'IV', 35), T0 + 3600000, loja);
  const v2 = variacaoDoDia(rk('EMERALD', 'IV', 0), T0 + 7200000, loja);
  const v3 = variacaoDoDia(rk('EMERALD', 'III', 5), T0 + 9000000, loja);
  const v4 = variacaoDoDia(rk('EMERALD', 'III', 5), T0 + 86400000, loja);
  caso('variacaoDoDia: 1ª leitura = ±0; depois +21 e −14 na mesma divisão; subiu de divisão = ↑; dia novo zera',
    v0.texto === '±0' && v1.texto === '+21' && v2.texto === '−14' && v3.texto === '↑' && v4.texto === '±0' && /15:00/.test(v1.titulo),
    JSON.stringify([v0, v1, v2, v3, v4]));
  caso('variacaoDoDia: sem ranque ou ainda lendo não inventa número', variacaoDoDia(rk('NONE'), T0, loja).texto === '—' && variacaoDoDia(null, T0, loja).texto === '—');

  const cv = convitesPendentes([{ invitationId: 'abc', state: 'Pending', fromSummonerName: 'amigo 3', gameConfig: { queueId: 440 }, canAcceptInvitation: true },
    { invitationId: 'old', state: 'Declined' }, { state: 'Pending' }]);
  caso('convitesPendentes: só Pending com id', cv.length === 1 && cv[0].id === 'abc' && cv[0].de === 'amigo 3' && cv[0].fila === 440 && cv[0].pode);
  caso('proximaPosicao: pula a outra e dá a volta', proximaPosicao('TOP', 'JUNGLE') === 'MIDDLE' && proximaPosicao('UTILITY', 'TOP') === 'JUNGLE');
  const hoje = partidasDeHoje([...HIST, partida(9, 60 * 24, true), { ...partida(10, 50, true), gameDuration: 200 }, { ...partida(11, 40, true), queueId: 0 }], T0);
  caso('partidasDeHoje: só hoje, sem remake nem personalizada, em ordem', hoje.length === 4 && igual(hoje.map(p => p.gameId), [1, 2, 3, 4]));
  const r = resumoHoje(hoje);
  caso('resumoHoje: 1V 3D e fim da última', r.v === 1 && r.d === 3 && r.n === 4 && r.ultimaFim === T0 - 120 * 60000 + 1800000);
  caso('sequenciaHoje: 3 derrotas', igual(sequenciaHoje(hoje), { tipo: 'D', n: 3 }));
  caso('partidasDeHoje: histórico não lido = null', partidasDeHoje(null, T0) === null && resumoHoje(null) === null);
  caso('haQuanto', haQuanto(T0 - 219 * 60000, T0) === 'há 3 h 39 min' && haQuanto(T0 - 12 * 60000, T0) === 'há 12 min' && haQuanto(T0, T0) === 'agora');
  caso('mmss', mmss(41) === '00:41' && mmss(130) === '02:10' && mmss(-5) === '00:00');

  const d2 = dicaLocal({ seq: 2, hoje: r, data: new Date(T0) });
  caso('dicaLocal: 2 derrotas seguidas cita o número medido', d2.startsWith('2 derrotas seguidas') && d2.includes(`${MEDICAO.wrDepoisDe2}%`));
  const dm = dicaLocal({ seq: 0, hoje: r, data: new Date(2026, 9, 13, 3) });
  caso('dicaLocal: madrugada', dm.startsWith('de madrugada') && dm.includes(`${MEDICAO.wrMadrugada}%`));
  const dd = dicaLocal({ seq: 1, hoje: { v: 1, d: 3, n: 4 }, data: new Date(T0) });
  caso('dicaLocal: de dia, derrotas não seguidas', dd.includes(`${MEDICAO.wrDia}%`) && dd.includes('as 3 derrotas de hoje não foram seguidas'));
  caso('dicaLocal: sequência incerta não inventa número', !dicaLocal({ seq: ATUALIZANDO, hoje: r, data: new Date(T0) }).includes('não foram seguidas'));

  caso('naoLidas: só conversa 1:1', naoLidas([{ type: 'chat', unreadMessageCount: 2 }, { type: 'customGame', unreadMessageCount: 5 }, { type: 'chat', unreadMessageCount: 1 }]) === 3 && naoLidas(null) === 0);
  const am = amigosParaConvidar([
    { summonerId: 1, puuid: 'a', gameName: 'zé', availability: 'chat', product: 'league_of_legends', lol: { gameStatus: 'outOfGame' } },
    { summonerId: 2, puuid: 'b', gameName: 'ana', availability: 'dnd', product: 'league_of_legends', lol: { gameStatus: 'inGame' } },
    { summonerId: 3, puuid: 'c', gameName: 'bia', availability: 'offline' },
    { summonerId: 4, puuid: 'd', gameName: 'cel', availability: 'mobile' },
    { summonerId: 5, puuid: 'e', gameName: 'val', availability: 'chat', product: 'valorant' },
  ]);
  caso('amigosParaConvidar: online no LoL, livres primeiro', igual(am.map(a => [a.nome, a.livre, a.status]), [['zé', true, 'no client'], ['ana', false, 'em partida']]));
  caso('ranqueSolo', ranqueSolo({ queueMap: { RANKED_SOLO_5x5: { tier: 'EMERALD', division: 'IV', leaguePoints: 14 } } })?.texto === 'Esmeralda IV · 14 PDL'
    && ranqueSolo({ queueMap: { RANKED_SOLO_5x5: { tier: 'NONE' } } })?.texto === 'sem ranque na solo/duo' && ranqueSolo(null) === null
    && ranqueSolo({ queueMap: { RANKED_SOLO_5x5: { tier: 'MASTER', division: 'NA', leaguePoints: 80 } } })?.texto === 'Mestre · 80 PDL');

  caso('estadoBusca: buscando', igual(estadoBusca({ searchState: 'Searching', timeInQueue: 41, estimatedQueueTime: 130, queueId: 420, lowPriorityData: { penaltyTimeRemaining: 0 } }),
    { fila: 420, emFila: 41, estimado: 130, tipo: 'buscando' }));
  caso('estadoBusca: baixa prioridade', estadoBusca({ searchState: 'Searching', lowPriorityData: { penaltyTimeRemaining: 300, reason: 'LEAVER_BUSTED' } }).tipo === 'baixa');
  caso('estadoBusca: encontrada e erro', estadoBusca({ searchState: 'Found' }).tipo === 'achou' && estadoBusca({ searchState: 'Error', errors: [{ errorType: 'QUEUE_DODGER' }] }).motivo === 'QUEUE_DODGER');
  caso('estadoBusca: sem leitura = entrando', estadoBusca(null).tipo === 'entrando');
  const nomes = new Map([[58, { nome: 'Renekton' }], [154, { nome: 'Zac' }]]);
  caso('textoEspera: favoritos com números', textoEspera([58, 154, 1], id => ({ geral: id === 58 ? { n: 87, winrate: 48 } : id === 154 ? { n: 63, winrate: 48 } : { n: 0 } }), nomes)
    === 'Renekton: 87 partidas, 48% de vitória. Zac: 63 partidas, 48% de vitória.');
}

// ================= tela 1 (lobby) =================
{
  const s = cenario({ cfgFila: { freioTilt: 0, freioMadrugada: false } });
  await s.iniciar();
  caso('lobby: monta compacto com a tela 1', s.efetivo() === 'compacto' && s.rot.estado().tela === 'lobby', JSON.stringify(s.rot.estado()));
  s.rel.avancar(30000); await tick();
  caso('lobby: montar + 30 s de timers e eventos = zero escrita na LCU', s.escritas().length === 0, s.escritas().join(', '));
  caso('lobby: cabeçalho com nome e ranque', s.texto().includes('Xerekton') && s.texto().includes('Esmeralda IV · 14 PDL'));
  caso('lobby: hoje 1V 3D', /1V\s*3D/.test(s.texto()) && s.texto().includes('4 partidas hoje'), s.texto());
  caso('lobby: dica do coach (local, número primeiro)', s.q('.lc-cp-dica')?.textContent.includes(`${MEDICAO.wrDia}%`));
  caso('lobby: JOGAR mostra fila e posições', s.q('[data-a="jogar"]')?.textContent.includes('Ranqueada Solo/Duo · Topo / Selva'));
  const pdl = s.q('[data-a="pdl-dia"]');
  caso('lobby: bloco "hoje" com a variação do dia em destaque e o elo embaixo (protótipo: "PDL ±0" / "Esmeralda IV 14")',
    pdl?.querySelector('b')?.textContent === '±0' && pdl?.querySelector('small')?.textContent === 'Esmeralda IV 14', pdl?.textContent);
  caso('lobby: nomes dos campeões da lista de hoje vêm do catálogo', s.q('.lc-cp-partidas')?.textContent.includes('Renekton') && s.q('.lc-cp-partidas')?.textContent.includes('Zac'));
  await s.clicar('[data-a="jogar"]');
  caso('lobby: clique sem freio = posições + 1 busca', s.buscas() === 1 && s.escritas().includes(POS), s.escritas().join(', '));
  caso('lobby: busca não recria o lobby que já está na fila certa', !s.escritas().includes('POST /lol-lobby/v2/lobby'));
  await s.ir('Matchmaking');
  caso('lobby -> Matchmaking: tela 2 montada', s.rot.estado().tela === 'fila' && s.tLobby.estado() === null);
}
{
  // freio de tilt: 1º clique só avisa, 2º de reflexo ignorado, 2º dentro da janela busca
  const s = cenario({ cfgFila: { freioTilt: 2, freioMadrugada: false }, servicos: { fila: { derrotasSeguidas: async () => 2 } } });
  await s.iniciar();
  await s.clicar('[data-a="jogar"]');
  caso('freio: 1º clique não escreve nada', s.escritas().length === 0, s.escritas().join(', '));
  caso('freio: botão vira BUSCAR MESMO ASSIM com o motivo', s.q('[data-a="jogar"]')?.textContent.startsWith('BUSCAR MESMO ASSIM') && s.q('[data-a="freio"]')?.textContent.includes('2 derrotas seguidas'));
  s.rel.avancar(300);
  await s.clicar('[data-a="jogar"]');
  caso('freio: 2º clique de reflexo (300 ms) ignorado', s.buscas() === 0 && s.q('[data-a="freio"]'));
  s.rel.avancar(1700);
  caso('freio: contagem regressiva anda', s.q('[data-a="freio"]')?.textContent.includes('6 s'), s.q('[data-a="freio"]')?.textContent);
  await s.clicar('[data-a="jogar"]');
  caso('freio: 2º clique dentro de 8 s busca uma vez', s.buscas() === 1, s.escritas().join(', '));
}
{
  const s = cenario({ cfgFila: { freioTilt: 2, freioMadrugada: false }, servicos: { fila: { derrotasSeguidas: async () => 3 } } });
  await s.iniciar();
  await s.clicar('[data-a="jogar"]');
  s.rel.avancar(9000); await tick();
  caso('freio: passou da janela, o botão volta a JOGAR', s.q('[data-a="jogar"]')?.textContent.startsWith('JOGAR') && !s.q('[data-a="freio"]'));
  await s.clicar('[data-a="jogar"]');
  caso('freio: clique depois da janela arma de novo, não busca', s.buscas() === 0 && s.q('[data-a="freio"]'));
}
{
  const s = cenario({ cfgFila: { freioTilt: 2, freioMadrugada: true }, hora: 3, servicos: { fila: { derrotasSeguidas: async () => 0 } } });
  await s.iniciar();
  await s.clicar('[data-a="jogar"]');
  caso('freio de madrugada: 1º clique só avisa', s.buscas() === 0 && s.q('[data-a="freio"]')?.textContent.includes('madrugada'));
  caso('freio de madrugada: a dica do coach fala da madrugada', s.q('.lc-cp-dica')?.textContent.includes('de madrugada'));
}
{
  const s = cenario({ cfgFila: { freioTilt: 2 }, servicos: { fila: { derrotasSeguidas: async () => null } } });
  await s.iniciar();
  await s.clicar('[data-a="jogar"]');
  caso('freio: sequência desconhecida (histórico não leu) pede confirmação', s.buscas() === 0 && s.q('[data-a="freio"]')?.textContent.includes('sequência de derrotas desconhecida'));
}
{
  // penalidade (dodge): JOGAR apagado com motivo e prazo; nem clique forçado busca
  const s = cenario({ lobby: lobbySolo({ canStartActivity: false, restrictions: [{ restrictionCode: 'QUEUE_DODGER', expiredTimestamp: Date.now() + 5 * 60000 }] }), cfgFila: { freioTilt: 0, freioMadrugada: false } });
  await s.iniciar();
  const bt = s.q('[data-a="jogar"]');
  caso('penalidade: JOGAR desabilitado e motivo à vista', bt?.disabled && s.q('.lc-cp-pena')?.textContent.includes('QUEUE_DODGER') && s.q('.lc-cp-pena')?.textContent.includes('faltam'));
  await s.clicar('[data-a="jogar"]', true);
  caso('penalidade: clique forçado não busca nem escreve', s.escritas().length === 0, s.escritas().join(', '));
}
{
  // não-líder: sem JOGAR que busque, fila travada; posição vai ao lobby (meio segundo depois) sem buscar
  const s = cenario({ lobby: lobbyGrupo(false), cfgFila: { freioTilt: 0, freioMadrugada: false } });
  await s.iniciar();
  const bt = s.q('[data-a="jogar"]');
  caso('não-líder: botão "O LÍDER BUSCA" desabilitado', bt?.disabled && bt.textContent.startsWith('O LÍDER BUSCA'), bt?.textContent);
  caso('não-líder: escolher fila desabilitado', s.doc.getElementById('lc-compacto').querySelectorAll('[data-a="fila"]').every(b => b.disabled));
  caso('não-líder: sem "+ convidar"', !s.q('[data-a="convidar"]'));
  caso('não-líder: nome do líder resolvido (grupo dele, não seleção)', s.texto().includes('amigo 1') && s.texto().includes('líder'));
  await s.clicar('[data-a="jogar"]', true);
  await s.clicar('[data-a="pos"][data-v="1"]');
  caso('não-líder: posição ainda não foi (espera meio segundo)', !s.escritas().includes(POS));
  s.rel.avancar(600); await tick();
  caso('não-líder: posição foi ao lobby e nada buscou', s.escritas().includes(POS) && s.buscas() === 0, s.escritas().join(', '));
  const put = s.falsa.chamadas.find(c => `${c.metodo} ${c.url}` === POS);
  caso('não-líder: a 1ª posição pulou para a próxima livre', put?.corpo?.firstPreference === 'MIDDLE' && put?.corpo?.secondPreference === 'JUNGLE', JSON.stringify(put?.corpo));
  caso('não-líder: posições gravadas na config (tua config)', s.definidos.some(([c, v]) => c === 'filaRapida.pos1' && v === 'MIDDLE'));
}
{
  // líder de grupo: busca pela fila do grupo, sem recriar o lobby (não desfaz o grupo)
  const s = cenario({ lobby: lobbyGrupo(true), cfgFila: { freioTilt: 0, freioMadrugada: false } });
  await s.iniciar();
  caso('líder: JOGAR com a fila do grupo', s.q('[data-a="jogar"]')?.textContent.includes('Ranqueada Flex') && s.q('[data-a="jogar"]')?.textContent.includes('com 1 amigo'));
  await s.clicar('[data-a="jogar"]');
  caso('líder: posições + 1 busca, sem POST /lobby', s.buscas() === 1 && s.escritas().includes(POS) && !s.escritas().includes('POST /lol-lobby/v2/lobby'), s.escritas().join(', '));
}
{
  // líder com freio: grupo também passa pelos freios
  const s = cenario({ lobby: lobbyGrupo(true), cfgFila: { freioTilt: 2, freioMadrugada: false }, servicos: { fila: { derrotasSeguidas: async () => 2 } } });
  await s.iniciar();
  await s.clicar('[data-a="jogar"]');
  caso('líder com freio: 1º clique não escreve', s.escritas().length === 0 && s.q('[data-a="freio"]'));
  s.rel.avancar(1000);
  await s.clicar('[data-a="jogar"]');
  caso('líder com freio: 2º clique busca', s.buscas() === 1);
}
{
  // ARAM sozinho: lobby 450 sem posição
  const s = cenario({ lobby: null, fase: 'None', cfgFila: { freioTilt: 0, freioMadrugada: false } });
  await s.iniciar();
  await s.clicar('[data-a="fila"][data-v="450"]');
  caso('ARAM: escolher não escreve na LCU nem na config da fila rápida', s.escritas().length === 0 && !s.definidos.some(([c]) => c === 'filaRapida.fila'));
  caso('ARAM: sem posições', s.texto().includes('ARAM não tem posição') && !s.q('[data-a="pos"]'));
  await s.clicar('[data-a="jogar"]');
  const lob = s.falsa.chamadas.find(c => c.metodo === 'POST' && c.url === '/lol-lobby/v2/lobby');
  caso('ARAM: cria o lobby 450, sem posição, e busca', lob?.corpo?.queueId === 450 && !s.escritas().includes(POS) && s.buscas() === 1, s.escritas().join(', '));
}
{
  // flex escolhida: vai para a config (é fila da fila rápida) e a busca usa ela
  const s = cenario({ lobby: null, fase: 'None', cfgFila: { freioTilt: 0, freioMadrugada: false } });
  await s.iniciar();
  await s.clicar('[data-a="fila"][data-v="440"]');
  caso('flex: gravada na config', s.definidos.some(([c, v]) => c === 'filaRapida.fila' && v === 440));
  await s.clicar('[data-a="jogar"]');
  const lob = s.falsa.chamadas.find(c => c.metodo === 'POST' && c.url === '/lol-lobby/v2/lobby');
  caso('flex: lobby 440 + posições + busca (caminho da fila rápida)', lob?.corpo?.queueId === 440 && s.escritas().includes(POS) && s.buscas() === 1, s.escritas().join(', '));
}
{
  // convite recebido: aceitar e recusar só por clique, rota exata
  const convite = [{ invitationId: 'abc/1', state: 'Pending', fromSummonerName: 'amigo 3', gameConfig: { queueId: 440 }, canAcceptInvitation: true }];
  const s = cenario({ rotas: { 'GET /lol-lobby/v2/received-invitations': convite, 'POST /lol-lobby/v2/received-invitations/abc%2F1/accept': { status: 204 }, 'POST /lol-lobby/v2/received-invitations/abc%2F1/decline': { status: 204 } } });
  await s.iniciar();
  caso('convite: aparece com quem convidou e a fila', s.q('[data-a="convite"]')?.textContent.includes('amigo 3') && s.q('[data-a="convite"]')?.textContent.includes('Ranqueada Flex'));
  caso('convite: nada é aceito sozinho', s.escritas().length === 0);
  await s.clicar('[data-a="convite-aceitar"]');
  caso('convite: aceitar = POST .../accept (id escapado)', igual(s.escritas(), ['POST /lol-lobby/v2/received-invitations/abc%2F1/accept']), s.escritas().join(', '));
  caso('convite: some depois de aceito', !s.q('[data-a="convite"]'));
}
{
  const s = cenario({ rotas: { 'POST /lol-lobby/v2/received-invitations/xyz/decline': { status: 204 } } });
  await s.iniciar();
  await s.evento('/lol-lobby/v2/received-invitations', [{ invitationId: 'xyz', state: 'Pending', fromSummonerName: '', gameConfig: { queueId: 420 } }]);
  caso('convite por evento: aparece ("um amigo" sem nome)', s.q('[data-a="convite"]')?.textContent.includes('um amigo'));
  s.falsa.chamadas.length = 0;
  await s.clicar('[data-a="convite-recusar"]');
  caso('convite: recusar = POST .../decline', igual(s.escritas(), ['POST /lol-lobby/v2/received-invitations/xyz/decline']) && s.avisos.some(([m]) => m === 'convite recusado'), s.escritas().join(', '));
}
{
  // chat: com o coletor abre a janela; sem rota/coletor, expande (chat da Riot)
  const s = cenario({ rotas: { 'GET /lol-chat/v1/conversations': [{ type: 'chat', unreadMessageCount: 2 }, { type: 'customGame', unreadMessageCount: 9 }] }, coletor: async () => ({ status: 200, dados: { ok: true } }) });
  await s.iniciar();
  const bolha = s.doc.getElementById('lc-compacto').querySelector('.lc-cp-bolha');
  caso('chat: contador só das conversas 1:1', bolha?.textContent === '2' && bolha.style.display === '');
  // revisão de 17/10/2026 (ícones): sem o chat ao lado o botão é o mesmo "chat" (ícone e aria-label), só abre as janelas do coletor
  const btChat = s.doc.getElementById('lc-compacto').querySelector('[data-a="chat"]');
  caso('chat sem o chat ao lado: ícone chat e aria-label "chat" (o nome do ícone, não "amigos")',
    btChat?.getAttribute('aria-label') === 'chat' && !!btChat?.querySelector('[data-icone="chat"]'), btChat?.getAttribute('aria-label'));
  await s.clicar('[data-a="chat"]');
  caso('chat: coletor abriu = POST /chat/abrir/amigos e o compacto fica', s.colChamadas.some(([m, c]) => m === 'POST' && c === '/chat/abrir/amigos') && s.efetivo() === 'compacto');
  await s.evento('/lol-chat/v1/conversations', null);
  caso('chat: nada de escrita na LCU', s.escritas().length === 0);
}
{
  const s = cenario({ coletor: async () => ({ status: 404, dados: { erro: 'não existe' } }) });
  await s.iniciar();
  await s.clicar('[data-a="chat"]');
  caso('chat sem a rota do chat: expande e avisa', s.efetivo() === 'expandido' && !s.doc.getElementById('lc-compacto') && s.avisos.some(([m]) => m.includes('chat em janela própria indisponível')), JSON.stringify(s.avisos));
}
{
  const s = cenario({ servicos: { coletor: undefined } });
  await s.iniciar();
  await s.clicar('[data-a="chat"]');
  caso('chat sem coletor nenhum: expande', s.efetivo() === 'expandido');
}
{
  // + convidar: sem o chat do coletor, a lista de amigos dentro da tela; convite só no clique
  const amigos = [{ summonerId: 333, puuid: 'p333', gameName: 'zé', availability: 'chat', product: 'league_of_legends', lol: { gameStatus: 'outOfGame' } }];
  const s = cenario({ lobby: null, fase: 'None', coletor: async () => ({ status: 0, dados: null }),
    rotas: { 'GET /lol-chat/v1/friends': amigos, 'POST /lol-lobby/v2/lobby/invitations': c => ({ status: 200, json: c }) } });
  await s.iniciar();
  await s.clicar('[data-a="convidar"]');
  caso('convidar: coletor fora = lista de amigos na tela', s.q('[data-a="amigos"]')?.textContent.includes('zé') && s.efetivo() === 'compacto');
  caso('convidar: abrir a lista não escreve', s.escritas().length === 0);
  await s.clicar('[data-a="convidar-amigo"]');
  const inv = s.falsa.chamadas.find(c => c.url === '/lol-lobby/v2/lobby/invitations');
  caso('convidar: sem lobby monta o da fila escolhida e convida', igual(s.escritas(), ['POST /lol-lobby/v2/lobby', 'POST /lol-lobby/v2/lobby/invitations'])
    && inv?.corpo?.[0]?.toSummonerId === 333 && inv?.corpo?.[0]?.toPuuid === 'p333' && s.buscas() === 0, s.escritas().join(', '));
  caso('convidar: aviso de convite enviado', s.avisos.some(([m]) => m === 'convite enviado para zé'));
}
{
  // contrato de coletor/chat_janelas.py: POST /chat/abrir/amigos -> 202 {ok: true}
  const s = cenario({ coletor: async c => (c === '/chat/abrir/amigos' ? { status: 202, dados: { ok: true } } : { status: 404 }) });
  await s.iniciar();
  await s.clicar('[data-a="convidar"]');
  caso('convidar: com o chat do coletor (202), abre a lista de amigos dele', s.colChamadas.some(([m, c]) => m === 'POST' && c === '/chat/abrir/amigos') && !s.q('[data-a="amigos"]') && s.efetivo() === 'compacto');
  s.colChamadas.length = 0;
}
{
  const s = cenario({ coletor: async c => (c === '/chat/abrir/amigos' ? { status: 202, dados: { ok: false } } : { status: 404 }) });
  await s.iniciar();
  await s.clicar('[data-a="chat"]');
  caso('chat: coletor recusou (ok false) = expande', s.efetivo() === 'expandido');
}
{
  const s = cenario({ coletor: async c => (c === '/dica' ? { status: 200, dados: { texto: 'teu farm caiu 12% nas derrotas de hoje.' } } : { status: 404 }) });
  await s.iniciar();
  caso('dica: a do coletor vale quando ele tem a rota', s.q('.lc-cp-dica')?.textContent.includes('teu farm caiu 12%'));
}
{
  // lobby personalizado: a tela da Riot é a dona -> expande
  const s = cenario({ lobby: lobbySolo({ gameConfig: { queueId: 0, mapId: 11, isCustom: true } }) });
  await s.iniciar();
  caso('personalizada: expande sozinho com aviso', s.efetivo() === 'expandido' && s.avisos.some(([m]) => m.includes('personalizado')));
}
{
  // evento torto e leitura que falha: a tela segue de pé, botão cinza com motivo
  const s = cenario({ rotas: { 'GET /lol-lobby/v2/lobby': { status: 500, json: { message: 'x' } } } });
  await s.iniciar();
  const bt = s.q('[data-a="jogar"]');
  caso('lobby ilegível: JOGAR cinza com motivo, nada busca', bt?.disabled && bt.textContent.includes('não foi possível ler o lobby') && s.efetivo() === 'compacto');
  await s.evento('/lol-lobby/v2/lobby', 5);
  await s.evento('/lol-lobby/v2/received-invitations', { estranho: true });
  caso('evento torto não derruba a tela', s.efetivo() === 'compacto' && s.rot.estado().tela === 'lobby');
}
{
  // None -> Lobby: mesma tela (atualizar), sem desmontar
  const s = cenario({ lobby: null, fase: 'None' });
  await s.iniciar();
  const antes = s.tLobby.estado();
  s.est.lobby = lobbySolo({ gameConfig: { queueId: 440, mapId: 11, showPositionSelector: true } });
  await s.ir('Lobby');
  caso('None -> Lobby: mesma montagem, relê o lobby', s.tLobby.estado() === antes && s.q('[data-a="fila"][data-v="440"]')?.classList.contains('lc-cp-on'));
}
{
  // voltou ao lobby da Arena (fila que a tela não cobre): fica compacto, o JOGAR diz de qual fila é o lobby e só busca
  // depois que ele escolhe a fila aqui (antes, um clique desfazia o lobby da Arena e entrava na ranqueada)
  const s = cenario({ lobby: lobbySolo({ gameConfig: { queueId: 1700, mapId: 30, isCustom: false, showPositionSelector: false } }), cfgFila: { freioTilt: 0, freioMadrugada: false } });
  await s.iniciar();
  const jogar = () => s.q('[data-a="jogar"]');
  const antes = { efetivo: s.efetivo(), desligado: jogar()?.disabled, texto: jogar()?.textContent };
  await s.clicar('[data-a="jogar"]', true);
  const semBusca = s.buscas() === 0 && s.escritas().length === 0;
  await s.clicar('[data-a="fila"][data-v="420"]');
  await s.clicar('[data-a="jogar"]');
  caso('lobby da Arena: compacto, JOGAR apagado dizendo "Arena", clique forçado não escreve; escolher Solo/Duo aqui libera a busca',
    antes.efetivo === 'compacto' && antes.desligado && /Arena/.test(antes.texto) && semBusca && s.buscas() === 1, JSON.stringify({ antes, escritas: s.escritas() }));
}

// ================= tela 2 (na fila) =================
const buscando = (over = {}) => ({ searchState: 'Searching', timeInQueue: 41, estimatedQueueTime: 130, queueId: 420, lowPriorityData: { penaltyTimeRemaining: 0 }, errors: [], ...over });
{
  const s = cenario({ fase: 'Matchmaking', rotas: { 'GET /lol-matchmaking/v1/search': buscando() } });
  await s.iniciar();
  caso('fila: tela 2 montada', s.rot.estado().tela === 'fila');
  caso('fila: tempo e estimativa do client', s.q('[data-tick="fila"]')?.textContent === '00:41' && s.texto().includes('estimado 02:10'), s.texto());
  caso('fila: fila e posições do lobby', s.texto().includes('Ranqueada Solo/Duo · Topo / Selva'));
  s.rel.avancar(3000);
  caso('fila: relógio anda sozinho', s.q('[data-tick="fila"]')?.textContent === '00:44', s.q('[data-tick="fila"]')?.textContent);
  caso('fila: enquanto espera com os favoritos', s.q('.lc-cp-dica')?.textContent.includes('Renekton: 87 partidas, 48% de vitória'));
  caso('fila: sequência de hoje', s.texto().includes('3 derrotas'));
  s.rel.avancar(20000); await tick();
  caso('fila: 23 s de timers = zero escrita', s.escritas().length === 0, s.escritas().join(', '));
  await s.clicar('[data-a="cancelar-fila"]');
  caso('fila: cancelar = 1 DELETE da busca, nada mais', igual(s.escritas(), [CANCELA]), s.escritas().join(', '));
  await s.ir('Lobby');
  caso('fila -> Lobby: volta à tela 1', s.rot.estado().tela === 'lobby');
}
{
  const s = cenario({ fase: 'Matchmaking', lobby: lobbyGrupo(false), rotas: { 'GET /lol-matchmaking/v1/search': buscando({ queueId: 440 }) } });
  await s.iniciar();
  const bt = s.q('[data-a="cancelar-fila"]');
  caso('fila não-líder: sem botão cancelar, nota de quem cancela', !bt && s.texto().includes('só o líder'));
  s.tFila.estado().cancelar();
  await tick();
  caso('fila não-líder: cancelar forçado não escreve', s.escritas().length === 0 && s.avisos.some(([m]) => m.includes('só o líder')));
}
{
  const s = cenario({ fase: 'Matchmaking', rotas: { 'GET /lol-lobby/v2/lobby': { status: 500, json: null }, 'GET /lol-matchmaking/v1/search': buscando() } });
  await s.iniciar();
  const bt = s.q('[data-a="cancelar-fila"]');
  caso('fila: liderança desconhecida = cancelar cinza com motivo', bt?.disabled && bt.textContent.includes('líder desconhecido'));
  await s.clicar('[data-a="cancelar-fila"]', true);
  caso('fila: cinza forçado não escreve', s.escritas().length === 0);
}
{
  const s = cenario({ fase: 'Matchmaking', rotas: { 'GET /lol-matchmaking/v1/search': buscando({ lowPriorityData: { penaltyTimeRemaining: 300, reason: 'LEAVER_BUSTED' } }) } });
  await s.iniciar();
  caso('baixa prioridade: contagem regressiva', s.q('[data-tick="fila"]')?.textContent === '05:00' && s.texto().includes('fila de baixa prioridade'));
  s.rel.avancar(10000);
  caso('baixa prioridade: desce', s.q('[data-tick="fila"]')?.textContent === '04:50', s.q('[data-tick="fila"]')?.textContent);
  caso('baixa prioridade: líder pode cancelar', !!s.q('[data-a="cancelar-fila"]') && !s.q('[data-a="cancelar-fila"]').disabled);
}
{
  const s = cenario({ fase: 'Matchmaking', rotas: { 'GET /lol-matchmaking/v1/search': buscando() } });
  await s.iniciar();
  await s.evento('/lol-matchmaking/v1/search', buscando({ searchState: 'Found' }));
  caso('fila: partida encontrada = anel parado, sem cancelar', s.texto().includes('partidaencontrada') && !s.q('[data-a="cancelar-fila"]'));
  await s.evento('/lol-matchmaking/v1/search', buscando({ searchState: 'Error', errors: [{ errorType: 'QUEUE_DODGER', penaltyTimeRemaining: 100 }] }));
  caso('fila: erro do client à vista', s.texto().includes('QUEUE_DODGER'));
  await s.evento('/lol-matchmaking/v1/search', 'lixo');
  caso('fila: evento torto não derruba', s.efetivo() === 'compacto' && s.rot.estado().tela === 'fila');
}
{
  // 14/10/2026: "o círculo spinner não completa o giro, reinicia sempre que conta um segundo". O client manda o evento da
  // busca a cada ~1 s (timeInQueue sobe) e cada evento redesenhava a tela: anel novo = animação do ::after do zero
  let noClient = 41; // a releitura de 5 s devolve o mesmo que o evento
  const s = cenario({ fase: 'Matchmaking', rotas: { 'GET /lol-matchmaking/v1/search': () => ({ status: 200, json: buscando({ timeInQueue: noClient }) }) } });
  await s.iniciar();
  const anel = s.q('.lc-cp-anel');
  let soltou = 0, pai = anel?.parentNode;
  if (anel) Object.defineProperty(anel, 'parentNode', { get: () => pai, set: v => { if (v !== pai) soltou++; pai = v; }, configurable: true });
  for (let t = 42; t <= 46; t++) { noClient = t; s.rel.avancar(1000); await s.evento('/lol-matchmaking/v1/search', buscando({ timeInQueue: t })); }
  caso('fila: 5 eventos da busca (1 por segundo) não recriam nem soltam o anel (o giro não reinicia)',
    !!anel && s.q('.lc-cp-anel') === anel && soltou === 0, `mesmo=${s.q('.lc-cp-anel') === anel} soltou=${soltou}`);
  caso('fila: com o anel parado no lugar, o tempo segue o client', s.q('[data-tick="fila"]')?.textContent === '00:46', s.q('[data-tick="fila"]')?.textContent);
  caso('fila: anel nasce com a fase do giro presa ao relógio (anel recriado continua o giro, não volta ao topo)',
    /^-\d+ms$/.test(String(anel?.style?.['--lc-cp-gira-fase'] || '')) && /animation-delay:var\(--lc-cp-gira-fase/.test(CSS_FILA), String(anel?.style?.['--lc-cp-gira-fase']));
  await s.evento('/lol-matchmaking/v1/search', buscando({ searchState: 'Found' }));
  caso('fila: partida encontrada para o anel no mesmo elemento', s.q('.lc-cp-anel') === anel && anel.classList.contains('lc-cp-parado') && soltou === 0);
}
{
  // ready check (14/10/2026 14:43): a tela da fila fica de pé por baixo do #lc-aceite, sem cancelar (o ready check é do
  // aceite); outro jogador não aceitou = volta a Matchmaking na mesma tela, buscando de novo
  const s = cenario({ fase: 'Matchmaking', rotas: { 'GET /lol-matchmaking/v1/search': buscando() } });
  await s.iniciar();
  const montada = s.tFila.estado();
  await s.ir('ReadyCheck');
  caso('ready check: mesma tela da fila (atualizar), "partida encontrada", sem cancelar, nada escrito',
    s.rot.estado().tela === 'fila' && s.tFila.estado() === montada && s.texto().includes('partidaencontrada') && !s.q('[data-a="cancelar-fila"]')
      && s.escritas().length === 0, s.texto());
  // o client carrega a tela por import(): sem atualizar no módulo, Matchmaking <-> ReadyCheck remontava (anel novo)
  caso('módulos tela-fila e tela-lobby exportam atualizar (o roteador lê o módulo, não o criarTela)',
    typeof modFila.atualizar === 'function' && typeof modLobby.atualizar === 'function');
  caso('ready check: a nota aponta a contagem do aceite (o aceite é do aceite.js)', /aceite/.test(s.q('.lc-cp-nota-rc')?.textContent || ''), s.texto());
  // revisão de 14/10/2026: a nota segue a contagem (#lc-aceite no <body>), que some quando o aceite.js aceita
  const nota = () => s.q('.lc-cp-nota-rc')?.textContent || '';
  const semContagemAinda = nota();
  const cont = s.doc.createElement('div'); cont.id = 'lc-aceite'; s.doc.body.append(cont);
  s.rel.avancar(1000); await tick();
  const comContagem = nota();
  cont.remove();
  s.rel.avancar(1000); await tick();
  caso('ready check: nota "esperando a contagem" → "responda na contagem" → depois do aceite (contagem sumiu) "esperando os outros"',
    /esperando a contagem/.test(semContagemAinda) && /responda na contagem/.test(comContagem) && /esperando os outros/.test(nota()),
    JSON.stringify([semContagemAinda, comContagem, nota()]));
  await s.ir('Matchmaking');
  await s.evento('/lol-matchmaking/v1/search', buscando({ timeInQueue: 3 }));
  caso('ready check recusado por outro: de volta à fila na mesma tela, cancelar de volta', s.tFila.estado() === montada && !!s.q('[data-a="cancelar-fila"]')
    && !s.q('.lc-cp-nota-rc') && s.q('[data-tick="fila"]')?.textContent === '00:03', s.texto());
  // seleção: a fila espera a sessão (≤ 2 s) e um evento do lobby nesse meio não pode pintar "buscando" com cancelar
  await s.ir('ReadyCheck'); await s.ir('ChampSelect');
  await s.evento('/lol-lobby/v2/lobby', null, 'Delete');
  caso('seleção chegando (tela da fila esperando a sessão): "partida encontrada", sem cancelar, mesmo com evento do lobby',
    s.rot.estado().tela === 'fila' && s.texto().includes('abrindo a seleção') && !s.q('[data-a="cancelar-fila"]'), s.texto());
}
{
  // 404 na busca (entrando na fila) e sem histórico: "—" sem quebrar
  const s = cenario({ fase: 'Matchmaking', servicos: { historico: { partidas: () => null, ler: async () => {} }, champ: null } });
  await s.iniciar();
  caso('fila: sem leitura nem histórico, tela de pé', s.efetivo() === 'compacto' && s.texto().includes('entrando na fila') && s.texto().includes('lendo o histórico'));
}

// ================= preferidas do lobby para a seleção (plano do compacto, passo 16, revisão 15/10/2026) =================
{
  const memo = modComum.preferidasLobby;
  if (memo) Object.assign(memo, { pos1: '', pos2: '', em: 0 });
  const s = cenario({ lobby: lobbySolo({ localMember: { ...eu, secondPositionPreference: 'FILL' } }) });
  await s.iniciar(); await tick();
  caso('preferidas: a tela do lobby guarda as pedidas cruas, com FILL (a seleção compara com elas se o GET de lá falhar)',
    memo?.pos1 === 'TOP' && memo?.pos2 === 'FILL' && memo.em > 0, JSON.stringify(memo));
  await s.evento('/lol-lobby/v2/lobby', lobbySolo({ gameConfig: { queueId: 3100, mapId: 11, isCustom: true, showPositionSelector: false } }));
  caso('preferidas: lobby personalizado apaga a reserva', memo?.pos1 === '' && memo?.em === 0, JSON.stringify(memo));
}

// ================= linha que não se cruza: busca nunca sem clique =================
{
  // passeio pelas fases das telas 1 e 2 com eventos e 2 min de timers: nenhuma escrita
  const s = cenario({ lobby: lobbySolo(), rotas: { 'GET /lol-matchmaking/v1/search': buscando() }, coletor: async () => ({ status: 200, dados: {} }) });
  await s.iniciar();
  for (const f of ['None', 'Lobby', 'Matchmaking', 'Lobby', 'None', 'Lobby']) { await s.ir(f); s.rel.avancar(20000); await tick(); }
  await s.evento('/lol-lobby/v2/lobby', lobbyGrupo(true));
  await s.evento('/lol-lobby/v2/received-invitations', [{ invitationId: 'q', state: 'Pending' }]);
  s.rel.avancar(60000); await tick();
  caso('passeio sem clique: zero escrita na LCU', s.escritas().length === 0, s.escritas().join(', '));
  caso('passeio: tela de pé no fim', s.efetivo() === 'compacto' && s.rot.estado().tela === 'lobby');
}

relatar(casos);
