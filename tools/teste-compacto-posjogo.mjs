// Testa a tela 4 do client compacto (pengu/compacto/tela-posjogo.js, roadmap/2026-10-13-client-compacto.md, passo 7)
// sem o client: roteador de verdade (compacto/index.js) com riotInvoke falso, DOM mínimo feito aqui, LCU falsa
// (tools/lcu-falsa.mjs; o fetch global é trocado, então nem a tela nem o jogarDeNovo falam com o client) e coletor
// falso. Partida gravada 3292746609 (tests/fixtures/posjogo-3292746609.json, sem identidade) + casos sintéticos de
// ranqueada (PDL), grupo, personalizada e LCU quebrada. Prova do passo 7: "carregando" no WaitingForStats; números e
// lições da partida; painel grande fechado até o clique em "ver análise completa" (que expande antes); jogar de novo só
// por clique e pelos freios; o guarda do pengu/posjogo/index.js (import de verdade, com hook para o ?raw do .md).
// uso: node tools/teste-compacto-posjogo.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { relatar, lcuFalsa } from './lcu-falsa.mjs';
import { criarJanela, invocadorRiot, criarCamada } from '../pengu/compacto/modo.js';
import { criarRoteador, CLASSE } from '../pengu/compacto/index.js';
import * as tela from '../pengu/compacto/tela-posjogo.js';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const FX = JSON.parse(readFileSync(raiz + 'tests/fixtures/posjogo-3292746609.json', 'utf8'));
const GID = 3292746609;
const BUSCA = 'POST /lol-lobby/v2/lobby/matchmaking/search';

// ---------- DOM mínimo (o mesmo de tools/teste-compacto.mjs, com innerHTML e window para o posjogo/index.js) ----------
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
    const est = {}; est.setProperty = (k, v) => { est[k] = v; }; this.style = est; this.offsetWidth = 0; this.offsetLeft = 0;
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
  get textContent() { return this.childNodes.map(n => n.textContent).join('') + (this.innerHTML || ''); }
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
  // seletor com descendente ("[data-painel=x] .y"): o último pedaço casa no nó, os outros num ancestral, em ordem
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

// ---------- relógio falso: timers do roteador e o relógio da tela (freio de 8 s) andam juntos ----------
function relogio() {
  const r = { agora: 1_000_000, prox: 1, fila: new Map() };
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

// ---------- cenário: roteador + tela de verdade, LCU/coletor/serviços falsos ----------
// lcu: estado mutável do client falso. Rotas não listadas = 404.
function cenario({ sessao = FX.sessao, eog = FX.eog, cfgFila = {}, playerStatus, ranked = null, notificacao = null,
  licoes = [{ status: 404, dados: { erro: 'partida ainda fora do banco', tentarDeNovoS: 5 } }, { status: 200, dados: FX.licoes }],
  derrotas = 0, lcuQuebrada = false, coletorFora = false } = {}) {
  const rel = relogio();
  tela._relogio.agora = () => rel.agora;
  tela._relogio.data = () => new Date(2026, 9, 13, 15, 0, 0); // tarde: o freio de madrugada não entra por acaso
  const doc = novoDoc();
  globalThis.document = doc;
  const est = { fase: 'WaitingForStats', ranked, notificacao, eog };
  const st = playerStatus ?? { lastQueuedLobbyStatus: { queueId: sessao?.gameData?.queue?.id, isLeader: true, memberSummonerIds: [111], allowedPlayAgain: true } };
  const rotas = lcuQuebrada ? {} : {
    'GET /lol-gameflow/v1/session': () => sessao,
    'GET /lol-gameflow/v1/gameflow-phase': () => est.fase,
    'GET /lol-summoner/v1/current-summoner': { gameName: 'Xerekton', profileIconId: 29 },
    'GET /lol-gameflow/v1/gameflow-metadata/player-status': st,
    'GET /lol-end-of-game/v1/eog-stats-block': () => (est.fase === 'EndOfGame' && est.eog ? est.eog : { status: 404, json: { message: 'no eog' } }),
    'GET /lol-ranked/v1/current-ranked-stats': () => est.ranked ?? { status: 404, json: null },
    'GET /lol-ranked/v1/current-lp-change-notification': () => est.notificacao ?? { status: 404, json: null },
    'POST /lol-lobby/v2/play-again': () => { est.fase = 'Lobby'; est.lobby = true; return { status: 204 }; },
    'POST /lol-end-of-game/v1/state/dismiss-stats': () => { est.fase = 'None'; return { status: 204 }; },
    'GET /lol-lobby/v2/lobby': () => (est.lobby ? { members: [{ summonerId: 111 }], invitations: [], gameConfig: { queueId: sessao.gameData.queue.id }, canStartActivity: true, restrictions: [] } : { status: 404, json: null }),
    'POST /lol-lobby/v2/lobby': () => { est.lobby = true; return { status: 200 }; },
    'PUT /lol-lobby/v2/lobby/members/localMember/position-preferences': { status: 201 },
    [BUSCA]: { status: 204 },
  };
  const falsa = lcuFalsa(rotas);
  globalThis.fetch = falsa.fetch;
  const pedidos = [];
  const win = { innerWidth: 1280, riotInvoke: arg => { const p = JSON.parse(arg.request); pedidos.push(p); if (p.name === 'Window.ResizeTo') win.innerWidth = p.params[0]; } };
  const janela = criarJanela({ invocar: invocadorRiot(win, () => {}), medir: () => [win.innerWidth, 720] });
  const s = { rel, doc, est, falsa, pedidos, avisos: [], subs: new Map(), abertos: [], coletorPedidos: [] };
  const coletor = async caminho => {
    s.coletorPedidos.push(caminho);
    if (coletorFora) return { status: 0, dados: null };
    return licoes.length > 1 ? licoes.shift() : licoes[0];
  };
  const cfg = { compacto: { ligado: true, inicioCompacto: true, larg: 420, alt: 640 }, aceite: { ligado: true },
    filaRapida: { jogarDeNovo: true, pos1: 'TOP', pos2: 'JUNGLE', freioTilt: 2, freioMadrugada: true, ...cfgFila } };
  const camada = criarCamada({ doc, aoExpandir: () => s.rot.expandir(), aoMinimizar: () => {}, aoFechar: () => {} });
  s.rot = criarRoteador({
    cfg, janela, camada,
    carregarTela: async nome => { if (nome === 'posjogo') return tela; throw new Error('404 ' + nome); },
    servicos: { coletor, fila: { derrotasSeguidas: async () => derrotas }, posjogo: { abrirPainel: (id, o) => { s.abertos.push([id, o]); return Promise.resolve(); } } },
    avisar: (m, e) => s.avisos.push([m, !!e]), log: () => {},
    assinar: (uri, cb) => s.subs.set(uri, cb),
    classe: on => doc.documentElement.classList.toggle(CLASSE, on),
    agendar: rel.agendar, limpar: rel.limpar, repetir: rel.repetir, pararRepetir: rel.limpar,
  });
  s.rot.marcarPronto();
  s.ir = async fase => { est.fase = fase; s.rot.aoFase(fase); if (sessao) s.rot.aoSessao(sessao); await tick(12); };
  s.camada = () => doc.getElementById('lc-compacto');
  s.texto = () => s.camada()?.textContent || '';
  s.botao = a => s.camada()?.querySelector(`[data-a="${a}"]`);
  s.clicar = async a => { s.botao(a)?.click(); await tick(12); };
  s.escritas = () => falsa.escritas().map(c => `${c.metodo} ${c.url}`);
  s.foto = () => ({ efetivo: s.rot.estado().efetivo, tela: s.rot.estado().tela, camada: !!s.camada(), classe: doc.documentElement.classList.contains(CLASSE) });
  return s;
}

const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const rankEsm = lp => ({ queueMap: { RANKED_SOLO_5x5: { queueType: 'RANKED_SOLO_5x5', tier: 'EMERALD', division: 'IV', leaguePoints: lp } } });

// ---------- 1. funções puras ----------
{
  const r = tela.resumoDoEog(FX.eog);
  caso('eog 3292746609: derrota, 8/9/6, Zac, 33:22, partida de fila', r.vitoria === false && igual(r.kda, [8, 9, 6]) && r.campeaoId === 154
    && r.campeao === 'Zac' && tela.textoDuracao(r.duracaoS) === '33:22' && r.matchmaking === true && !r.refeita, JSON.stringify(r));
  caso('eog 3292746609: farm 6,2/min, o mesmo da lição do coletor ("Farm de 6,2/min")',
    tela.textoFarm(r.farmMin) === '6,2' && FX.licoes.licoes.some(l => l.texto.includes(`Farm de ${tela.textoFarm(r.farmMin)}/min`)), tela.textoFarm(r.farmMin));
  caso('eog: hora do início = fim − duração (mesma convenção da lista da tela 1)', r.inicioMs === FX.eog.endOfGameTimestamp - 2002 * 1000 && /^\d\d:\d\d$/.test(tela.textoHora(r.inicioMs)));
  let quebrou = null;
  try {
    for (const lixo of [null, 'x', {}, { localPlayer: 'x', teams: 'y', gameLength: 'abc' }, { localPlayer: { stats: { CHAMPIONS_KILLED: true } }, teams: [null, 3] }])
      { const z = tela.resumoDoEog(lixo); if (z && (z.kda || z.farmMin !== null || z.vitoria !== null)) quebrou = JSON.stringify(z); }
  } catch (e) { quebrou = e.message; }
  caso('eog torto (null, string, campos de tipo errado) não lança nem inventa número', quebrou === null, quebrou);
  caso('eog: remake marca refeita; WIN do stats vale sem teams', tela.resumoDoEog({ ...FX.eog, gameEndedInEarlySurrender: true }).refeita
    && tela.resumoDoEog({ ...FX.eog, teams: [], localPlayer: { stats: { WIN: 1 } } }).vitoria === true);
  caso('PDL: notificação só vale com o gameId desta partida', tela.pdlDaNotificacao({ gameId: GID, leaguePointsDelta: -18 }, GID)?.delta === -18
    && tela.pdlDaNotificacao({ gameId: 1, leaguePointsDelta: 20 }, GID) === null && tela.pdlDaNotificacao({ gameId: GID }, GID) === null
    && tela.pdlDaNotificacao(null, GID) === null && tela.pdlDaNotificacao({ gameId: GID, leaguePointsDelta: 5 }, null) === null);
  const a = tela.filaRanqueada(rankEsm(14), 420), d = tela.filaRanqueada(rankEsm(35), 420);
  caso('PDL: diferença na mesma divisão (+21), igual = nada ainda, fila sem ranque = null',
    tela.pdlDaDiferenca(a, d)?.delta === 21 && tela.pdlDaDiferenca(a, a) === null && tela.filaRanqueada(rankEsm(1), 400) === null && tela.filaRanqueada({}, 420) === null);
  const sobe = tela.pdlDaDiferenca(a, { tier: 'EMERALD', divisao: 'III', pdl: 0 }), cai = tela.pdlDaDiferenca(a, { tier: 'PLATINUM', divisao: 'I', pdl: 75 });
  caso('PDL: troca de divisão vira subiu/caiu (sem delta inventado)', sobe?.mudou === 'subiu' && cai?.mudou === 'caiu' && sobe.delta === undefined);
  caso('PDL: textos +21, −18 (menos de verdade), ±0, ↑', igual([21, -18, 0].map(x => tela.textoPdl({ delta: x })), ['+21', '−18', '±0']) && tela.textoPdl({ mudou: 'subiu' }) === '↑');
  caso('rank do topo: "Esmeralda IV · 14 PDL"; Mestre sem divisão', tela.textoRank(a) === 'Esmeralda IV · 14 PDL'
    && tela.textoRank({ tier: 'MASTER', divisao: 'I', pdl: 80 }) === 'Mestre · 80 PDL' && tela.textoRank(null) === 'sem ranque');
  caso('grupo: sozinho e líder = false; não-líder ou 2 membros = true; sem leitura = null',
    tela.emGrupo({ lastQueuedLobbyStatus: { isLeader: true, memberSummonerIds: [1] } }) === false
    && tela.emGrupo({ lastQueuedLobbyStatus: { isLeader: false, memberSummonerIds: [1] } }) === true
    && tela.emGrupo({ lastQueuedLobbyStatus: { isLeader: true, memberSummonerIds: [1, 2] } }) === true && tela.emGrupo(null) === null);
  const cfg = { filaRapida: { jogarDeNovo: true, pos1: 'TOP', pos2: 'JUNGLE' } };
  const b = o => tela.botaoJogar({ fase: 'EndOfGame', cfg, fila: 420, custom: false, resumo: null, grupo: false, armada: false, ...o });
  caso('botão: mesma fila com posições (420), sem posição no ARAM', b().sub === 'mesma fila: Ranqueada Solo/Duo · Topo / Selva' && b({ fila: 450 }).sub === 'mesma fila: ARAM' && !b().motivo);
  caso('botão cinza com motivo: estatísticas, desligado, personalizada, fila desconhecida',
    !!b({ fase: 'WaitingForStats' }).motivo && !!b({ cfg: { filaRapida: { jogarDeNovo: false } } }).motivo && !!b({ custom: true }).motivo
    && !!b({ fila: null }).motivo && !!b({ resumo: { matchmaking: false } }).motivo);
  caso('botão: grupo = VOLTAR AO LOBBY; armado = BUSCAR MESMO ASSIM', b({ grupo: true }).texto === 'VOLTAR AO LOBBY' && b({ armada: true }).texto === 'BUSCAR MESMO ASSIM');
}

// ---------- 2. partida gravada 3292746609 (normal 400) pelo roteador ----------
{
  tela._esquecer();
  const s = cenario();
  await s.ir('WaitingForStats');
  const f1 = s.foto();
  caso('WaitingForStats: tela posjogo compacta montada (camada, classe, janela 420×640)', f1.efetivo === 'compacto' && f1.tela === 'posjogo' && f1.camada && f1.classe
    && s.pedidos.some(p => p.name === 'Window.ResizeTo' && igual(p.params, [420, 640])), JSON.stringify(f1));
  caso('WaitingForStats: "CARREGANDO…" com – no lugar dos números e sem jogar de novo', s.texto().includes('CARREGANDO…') && s.texto().includes('– / – / –')
    && !s.botao('jogar') && !s.botao('analise'), s.texto());
  caso('topo: o próprio nome e o rank (sem ranque lido = "fim de partida")', s.camada().querySelector('.lc-cp-pj-id')?.textContent.startsWith('Xerekton'));
  caso('topo: 💬 com o contador antes do expandir (protótipo da tela 4: "mais uma?" no fim da partida)',
    !!s.camada().querySelector('.lc-cp-extras')?.querySelector('button[data-a="chat"]'));
  caso('CSS do pós-jogo escopado em .lc-cp-pj (não muda o JOGAR nem o freio da tela 1)',
    !/#lc-compacto \.lc-cp-(jogar|freio|res|nums|lic|linha-bts)\b/.test(tela.CSS_POSJOGO) && /#lc-compacto \.lc-cp-pj \.lc-cp-jogar \{/.test(tela.CSS_POSJOGO));
  await s.ir('EndOfGame');
  const t = s.texto();
  caso('EndOfGame: DERROTA, 8 / 9 / 6, farm 6,2, Normal (escolha), Zac, 33:22', ['DERROTA', '8 / 9 / 6', '6,2', 'Normal (escolha)', 'Zac', '33:22'].every(x => t.includes(x)), t);
  const pdlCel = s.camada().querySelector('.lc-cp-nums')?.children[2];
  caso('EndOfGame: PDL "–" fora da ranqueada, motivo no title', pdlCel?.textContent === '–PDL' && pdlCel.getAttribute('title') === 'sem PDL nesta fila', pdlCel?.textContent);
  caso('lições: coletor ainda sem a partida → "…" e nova tentativa agendada', s.coletorPedidos.length === 1 && s.camada().querySelector('.lc-cp-lic')?.classList.contains('lc-cp-carregando'));
  await s.rel.avancar(5000);
  const lis = s.camada().querySelectorAll('li');
  caso('lições: depois de 5 s as 3 do coletor, ⚠/⚠/✓, texto inteiro no title', lis.length === 3 && s.coletorPedidos.length === 2
    && lis.map(l => l.textContent[0]).join('') === '⚠⚠✓' && lis[2].classList.contains('lc-cp-pos')
    && lis.every((l, i) => l.getAttribute('title') === FX.licoes.licoes[i].texto), lis.map(l => l.textContent).join(' | '));
  caso('jogar de novo: "mesma fila: Normal (escolha) · Topo / Selva"', s.botao('jogar')?.textContent === 'JOGAR DE NOVOmesma fila: Normal (escolha) · Topo / Selva', s.botao('jogar')?.textContent);
  caso('EndOfGame com o compacto: painel grande NÃO abriu sozinho', s.abertos.length === 0);
  caso('nada escrito na LCU até aqui (só leitura)', s.escritas().length === 0, s.escritas().join(', '));
  await s.clicar('analise');
  const f2 = s.foto();
  caso('"ver análise completa": expande (sem camada, 1280×720) e só então abre o painel da partida com fimDePartida',
    f2.efetivo === 'expandido' && !f2.camada && !f2.classe && igual(s.pedidos.filter(p => p.name === 'Window.ResizeTo').at(-1).params, [1280, 720])
    && igual(s.abertos, [[GID, { fimDePartida: true }]]), JSON.stringify({ f2, abertos: s.abertos }));
  caso('"ver análise completa" não escreve na LCU', s.escritas().length === 0);
}

// ---------- 3. nome de terceiro nunca aparece ----------
{
  tela._esquecer();
  const eog = JSON.parse(JSON.stringify(FX.eog));
  eog.teams[0].players = [{ riotIdGameName: 'AliadoSecreto', summonerName: 'AliadoSecreto', championName: 'Lee Sin' }];
  eog.teams[1].players = [{ riotIdGameName: 'InimigoSecreto', summonerName: 'InimigoSecreto', championName: 'Darius' }];
  eog.localPlayer.riotIdGameName = 'NomeDoEog';
  const s = cenario({ eog });
  await s.ir('WaitingForStats'); await s.ir('EndOfGame');
  const t = s.texto();
  caso('eog com nomes dos 10: a tela não mostra nenhum (só o campeão e o nome do próprio current-summoner)',
    !/Secreto|NomeDoEog|Lee Sin|Darius/.test(t) && t.includes('Zac'), t);
}

// ---------- 4. ranqueada sintética: PDL pela diferença, sobrevivendo à honra (PreEndOfGame remonta a tela) ----------
{
  tela._esquecer();
  const sessao = { gameData: { gameId: GID, queue: { id: 420, mapId: 11 }, isCustomGame: false }, map: { id: 11 } };
  const s = cenario({ sessao, ranked: rankEsm(14), notificacao: { gameId: 999, leaguePointsDelta: 30 } });
  await s.ir('WaitingForStats');
  caso('ranqueada: topo com "Esmeralda IV · 14 PDL"', s.camada().querySelector('.lc-cp-pj-id')?.textContent === 'XerektonEsmeralda IV · 14 PDL', s.camada().querySelector('.lc-cp-pj-id')?.textContent);
  await s.ir('PreEndOfGame');
  caso('PreEndOfGame (honra): client normal, sem camada', s.foto().efetivo === 'expandido' && !s.foto().camada);
  s.est.ranked = rankEsm(35);
  await s.ir('EndOfGame');
  await s.rel.avancar(6000);
  const pdl = s.camada()?.querySelector('.lc-cp-nums')?.children[2];
  caso('ranqueada: PDL +21 pela diferença (antes lido no WaitingForStats); notificação de outra partida ignorada',
    pdl?.textContent === '+21PDL' && pdl.querySelector('b')?.classList.contains('lc-cp-mais') && /diferença/.test(pdl.getAttribute('title') || ''), pdl?.textContent);
}
{
  tela._esquecer();
  const sessao = { gameData: { gameId: GID, queue: { id: 420, mapId: 11 }, isCustomGame: false }, map: { id: 11 } };
  const s = cenario({ sessao, ranked: rankEsm(14) });
  await s.ir('WaitingForStats'); await s.ir('EndOfGame');
  const antes = s.camada().querySelector('.lc-cp-nums')?.children[2]?.textContent;
  s.est.notificacao = { gameId: GID, leaguePointsDelta: -18 };
  await s.rel.avancar(5000);
  const depois = s.camada().querySelector('.lc-cp-nums')?.children[2]?.textContent;
  caso('ranqueada: "…" enquanto lê, depois −18 pela notificação desta partida', antes === '…PDL' && depois === '−18PDL', `${antes} -> ${depois}`);
  s.est.notificacao = null;
  await s.rel.avancar(200000);
  caso('ranqueada: valor lido fica (não volta a "–" no fim dos 3 min)', s.camada().querySelector('.lc-cp-nums')?.children[2]?.textContent === '−18PDL');
}
{
  tela._esquecer();
  const sessao = { gameData: { gameId: GID, queue: { id: 420, mapId: 11 }, isCustomGame: false }, map: { id: 11 } };
  const s = cenario({ sessao, ranked: rankEsm(14) });
  await s.ir('WaitingForStats'); await s.ir('EndOfGame');
  await s.rel.avancar(186000); // 3 min + a última leitura (a cada 5 s)
  const c = s.camada().querySelector('.lc-cp-nums')?.children[2];
  caso('ranqueada sem variação em 3 min: "–" com o motivo, sem inventar ±0', c?.textContent === '–PDL' && /3 min/.test(c.getAttribute('title') || ''), c?.textContent);
}

// ---------- 5. jogar de novo: só por clique, pelos freios (2 derrotas seguidas) ----------
{
  tela._esquecer();
  const sessao = { gameData: { gameId: GID, queue: { id: 420, mapId: 11 }, isCustomGame: false }, map: { id: 11 } };
  const s = cenario({ sessao, derrotas: 2 });
  await s.ir('WaitingForStats'); await s.ir('EndOfGame');
  await s.rel.avancar(30000);
  caso('jogar de novo: nada escrito sem clique (30 s no EndOfGame)', s.escritas().length === 0, s.escritas().join(', '));
  await s.clicar('jogar');
  caso('freio: 1º clique só arma (BUSCAR MESMO ASSIM + "2 derrotas seguidas"), zero escritas',
    s.escritas().length === 0 && s.botao('jogar')?.textContent.startsWith('BUSCAR MESMO ASSIM') && s.texto().includes('2 derrotas seguidas'), s.texto());
  await s.rel.avancar(300);
  await s.clicar('jogar');
  caso('freio: 2º clique de reflexo (< 700 ms) é ignorado', s.escritas().length === 0 && s.botao('jogar')?.textContent.startsWith('BUSCAR MESMO ASSIM'));
  await s.rel.avancar(9000);
  caso('freio: depois de 8 s o botão volta a JOGAR DE NOVO', s.botao('jogar')?.textContent.startsWith('JOGAR DE NOVO') && !s.texto().includes('2 derrotas seguidas'));
  await s.clicar('jogar');
  caso('freio: clique depois da janela arma de novo (não busca)', s.escritas().length === 0 && s.botao('jogar')?.textContent.startsWith('BUSCAR MESMO ASSIM'));
  await s.rel.avancar(2000);
  await s.clicar('jogar');
  const w = s.escritas();
  caso('freio: 2º clique dentro de 8 s busca uma vez, na mesma fila, com as posições',
    w.filter(x => x === BUSCA).length === 1 && w[0] === 'POST /lol-lobby/v2/play-again' && w.includes('PUT /lol-lobby/v2/lobby/members/localMember/position-preferences')
    && s.avisos.some(([m]) => m.includes('de volta à fila')), w.join(', '));
}
{
  tela._esquecer();
  const s = cenario({ derrotas: 0 }); // normal 400, sem freio
  await s.ir('WaitingForStats'); await s.ir('EndOfGame');
  await s.clicar('jogar');
  caso('sem freio: 1 clique busca uma vez (fila 400 da partida)', s.escritas().filter(x => x === BUSCA).length === 1, s.escritas().join(', '));
}
{
  tela._esquecer();
  const s = cenario({ derrotas: 0, playerStatus: { lastQueuedLobbyStatus: { queueId: 400, isLeader: false, memberSummonerIds: [111, 222], allowedPlayAgain: true } } });
  await s.ir('WaitingForStats'); await s.ir('EndOfGame');
  const rot = s.botao('jogar')?.textContent;
  await s.clicar('jogar');
  caso('grupo de outro: VOLTAR AO LOBBY, volta pelo play-again e nunca busca', rot.startsWith('VOLTAR AO LOBBY') && igual(s.escritas(), ['POST /lol-lobby/v2/play-again'])
    && s.avisos.some(([m]) => m.includes('líder')), `${rot} | ${s.escritas().join(', ')}`);
}
{
  tela._esquecer();
  const sessao = { gameData: { gameId: GID, queue: { id: -1, mapId: 11 }, isCustomGame: true }, map: { id: 11 } };
  const eog = { ...FX.eog, gameType: 'CUSTOM_GAME' };
  const s = cenario({ sessao, eog, playerStatus: { lastQueuedLobbyStatus: { queueId: 420, isLeader: true, memberSummonerIds: [111], allowedPlayAgain: true } } });
  await s.ir('WaitingForStats'); await s.ir('EndOfGame');
  const b = s.botao('jogar');
  await s.clicar('jogar');
  caso('personalizada (última fila do client = 420): botão cinza com motivo e clique não escreve nada',
    b?.disabled === true && /personalizada/.test(b.getAttribute('title') || '') && s.escritas().length === 0 && s.avisos.some(([m, e]) => e && /personalizada/.test(m)), s.escritas().join(', '));
}
{
  tela._esquecer();
  const s = cenario({ cfgFila: { jogarDeNovo: false } });
  await s.ir('WaitingForStats'); await s.ir('EndOfGame');
  await s.clicar('jogar');
  caso('jogar de novo desligado nas configurações: cinza e não escreve', s.botao('jogar')?.disabled === true && s.escritas().length === 0);
}

// ---------- 6. fechar, ARAM, LCU quebrada ----------
{
  tela._esquecer();
  const s = cenario();
  await s.ir('WaitingForStats'); await s.ir('EndOfGame');
  await s.clicar('fechar-pj');
  caso('fechar: dismiss-stats, nunca busca', igual(s.escritas(), ['POST /lol-end-of-game/v1/state/dismiss-stats']), s.escritas().join(', '));
}
{
  tela._esquecer();
  const sessao = { gameData: { gameId: GID, queue: { id: 450, mapId: 12 }, isCustomGame: false }, map: { id: 12 } };
  const s = cenario({ sessao });
  await s.ir('WaitingForStats'); await s.ir('EndOfGame');
  caso('ARAM: sem "ver análise completa" (a análise é do Rift); fechar segue', !s.botao('analise') && !!s.botao('fechar-pj') && s.texto().includes('ARAM'));
}
{
  tela._esquecer();
  const s = cenario({ lcuQuebrada: true, coletorFora: true });
  await s.ir('WaitingForStats'); await s.ir('EndOfGame');
  await s.rel.avancar(63000); // 60 s + a última leitura (a cada 2 s)
  const t = s.texto();
  caso('LCU toda 404: tela segue compacta, "FIM DE PARTIDA", "–" nos números, lições e PDL com o motivo (sem gameId)',
    s.foto().efetivo === 'compacto' && t.includes('FIM DE PARTIDA') && t.includes('– / – / –') && t.includes('sem lições: o client não disse qual partida foi')
    && s.camada().querySelector('.lc-cp-nums')?.children[2]?.textContent === '–PDL', t);
  await s.clicar('jogar');
  caso('LCU quebrada: jogar de novo (fila pela sessão do roteador) recusa sem escrever, com aviso de erro',
    s.falsa.escritas().length === 0 && s.avisos.some(([m, e]) => e && /jogar de novo: não consegui ler a fase/.test(m)), JSON.stringify(s.avisos));
}
{
  tela._esquecer();
  const s = cenario({ coletorFora: true });
  await s.ir('WaitingForStats'); await s.ir('EndOfGame');
  caso('coletor fora: "coletor fora do ar: as lições ficam na análise completa", números da partida seguem',
    s.texto().includes('coletor fora do ar: as lições ficam na análise completa') && s.texto().includes('8 / 9 / 6'), s.texto());
  const n = s.coletorPedidos.length;
  await s.rel.avancar(15000);
  caso('coletor fora: tenta de novo a cada 15 s', s.coletorPedidos.length === n + 1, `${n} -> ${s.coletorPedidos.length}`);
  await s.rel.avancar(300000);
  caso('coletor fora por 5 min: desiste das lições sem expandir', s.foto().efetivo === 'compacto' && s.texto().includes('sem lições: coletor fora do ar'), s.texto());
}
{
  tela._esquecer();
  const eog = { gameId: GID, localPlayer: { stats: { CHAMPIONS_KILLED: 'x' }, championId: 'abc' }, teams: 'lixo', gameLength: -5 };
  const s = cenario({ eog });
  await s.ir('WaitingForStats'); await s.ir('EndOfGame');
  caso('eog torto no client: a tela não quebra (fica compacta, "FIM DE PARTIDA" com –)', s.foto().efetivo === 'compacto' && s.texto().includes('FIM DE PARTIDA') && s.avisos.every(([, e]) => !e), s.texto());
}

// ---------- 7. pengu/posjogo/index.js de verdade: o painel não abre sozinho com a camada compacta à vista ----------
{
  // o Pengu serve "./licoes.md?raw" como texto; no node, um hook faz o mesmo (só para este teste)
  registerHooks({
    resolve(spec, ctx, next) { return spec.endsWith('?raw') ? { url: new URL(spec, ctx.parentURL).href, shortCircuit: true } : next(spec, ctx); },
    load(url, ctx, next) {
      if (!url.endsWith('?raw')) return next(url, ctx);
      return { format: 'module', source: `export default ${JSON.stringify(readFileSync(fileURLToPath(url.split('?')[0]), 'utf8'))};`, shortCircuit: true };
    },
  });
  const pj = await import(pathToFileURL(raiz + 'pengu/posjogo/index.js').href);
  const erroOriginal = console.error, logOriginal = console.log;
  console.error = () => {}; console.log = () => {}; // o painel sem LCU loga o erro dele: não interessa aqui
  const esperarReal = ms => new Promise(r => setTimeout(r, ms));
  // window com ouvintes de verdade (o painel ouve keydown e pointerdown na captura): janela.disparar(tipo, alvo)
  function novaJanela() {
    const ouvintes = {};
    return {
      addEventListener(t, f) { (ouvintes[t] ||= new Set()).add(f); },
      removeEventListener(t, f) { ouvintes[t]?.delete(f); },
      disparar(t, target, extra = {}) { for (const f of [...(ouvintes[t] || [])]) f({ type: t, target, stopPropagation() {}, preventDefault() {}, ...extra }); },
      ouvindo: t => ouvintes[t]?.size || 0,
    };
  }
  // partida de referência 3292712362 (tests/fixtures) na LCU falsa: a abertura automática com erro não abre caixa
  // nenhuma (vai para o botão, D4), então "o painel abre" precisa de uma partida que a LCU tem
  const GREF = 3292712362;
  const fxRef = n => JSON.parse(readFileSync(raiz + 'tests/fixtures/' + n, 'utf8'));
  const ROTAS_REF = {
    'GET /lol-summoner/v1/current-summoner': fxRef('summoner.json'),
    [`GET /lol-match-history/v1/games/${GREF}`]: fxRef('game-3292712362.json'),
    [`GET /lol-match-history/v1/game-timelines/${GREF}`]: fxRef('timeline-3292712362.json'),
    'GET /lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=199': fxRef('historico.json'),
  };
  async function rodada({ compacto, avista, mudarFase = null, rotas = ROTAS_REF }) {
    const doc = novoDoc();
    globalThis.document = doc;
    const janela = novaJanela();
    globalThis.window = janela;
    globalThis.fetch = lcuFalsa(rotas).fetch; // rotas: {} = tudo 404 (abertura automática com erro: só o botão)
    // estado do módulo é um só: o aceite esquece análise, botão e "última aberta" da rodada anterior
    const obs0 = [];
    pj.iniciarPosjogo({ socket: { observe: (uri, cb) => { if (uri.endsWith('gameflow-phase')) obs0.push(cb); } } },
      { posjogo: { ligado: false } }, null);
    for (const cb of obs0) cb({ data: 'ReadyCheck' });
    if (avista) doc.documentElement.classList.add('lc-modo-compacto');
    const obs = new Map();
    const context = { socket: { observe: (uri, cb) => { (obs.get(uri) || obs.set(uri, []).get(uri)).push(cb); } } };
    const emitir = (uri, data) => { for (const cb of obs.get(uri) || []) cb({ uri, data, eventType: 'Update' }); };
    const cfg = { posjogo: { ligado: true }, compacto: { ligado: compacto }, filaRapida: {}, traumas: {} };
    const ret = pj.iniciarPosjogo(context, cfg, null);
    emitir('/lol-gameflow/v1/session', { gameData: { gameId: GREF, queue: { id: 400 } }, map: { id: 11 } });
    emitir('/lol-gameflow/v1/gameflow-phase', 'EndOfGame');
    if (mudarFase) { await esperarReal(50); emitir('/lol-gameflow/v1/gameflow-phase', mudarFase); }
    await esperarReal(pj.ESPERA_COMPACTO_MS + 150);
    await tick(10);
    return { doc, ret, emitir, janela, aberto: !!doc.getElementById('lc-posjogo') };
  }
  const a = await rodada({ compacto: true, avista: true });
  caso('posjogo/index.js: EndOfGame com a camada compacta à vista → #lc-posjogo fechado', !a.aberto);
  a.ret.abrirPainel(GID, { fimDePartida: true }).catch(() => {});
  await tick(10);
  caso('posjogo/index.js: abrirPainel devolvido (o "ver análise completa") abre o painel', !!a.doc.getElementById('lc-posjogo'));
  const b = await rodada({ compacto: true, avista: false });
  caso('posjogo/index.js: compacto ligado mas client normal à vista (expandido por ti, modal da Riot) → abre como antes', b.aberto);
  const c = await rodada({ compacto: false, avista: false });
  caso('posjogo/index.js: compacto desligado → abre como antes', c.aberto);
  // reabrir (Gabriel, 14/10/2026): fechar (aqui, clique fora da caixa) deixa o botão; clicar reabre; fase do aceite tira o botão
  c.janela.disparar('pointerdown', c.doc.body);
  const bt = c.doc.getElementById('lc-posjogo-reabrir');
  caso('pós-jogo fechado por ele: painel sai e aparece o "reabrir análise"', !c.doc.getElementById('lc-posjogo') && !!bt);
  bt?.click(); await tick(10);
  caso('reabrir análise: o painel volta e o botão some', !!c.doc.getElementById('lc-posjogo') && !c.doc.getElementById('lc-posjogo-reabrir'));
  c.janela.disparar('keydown', c.doc.body, { key: 'Escape' });
  caso('Esc fecha o painel (e deixa o botão)', !c.doc.getElementById('lc-posjogo') && !!c.doc.getElementById('lc-posjogo-reabrir'));
  c.emitir('/lol-gameflow/v1/gameflow-phase', 'ReadyCheck');
  caso('ReadyCheck tira o "reabrir análise" (painel e botão fora do aceite)', !c.doc.getElementById('lc-posjogo') && !c.doc.getElementById('lc-posjogo-reabrir'));
  const d = await rodada({ compacto: true, avista: false, mudarFase: 'Lobby' });
  caso('posjogo/index.js: fase saiu do EndOfGame durante a espera → não abre', !d.aberto);
  const e = await rodada({ compacto: true, avista: true });
  caso('posjogo/index.js: só lc-compacto (chave ligada) sem lc-modo-compacto não segura o painel',
    (() => { const dd = novoDoc(); dd.documentElement.classList.add('lc-compacto'); globalThis.document = dd; return !pj.compactoAVista(); })() && !e.aberto);
  // ---- painel que não prende (roadmap/2026-10-14-posjogo-livre-e-mentor-enxuto.md, D1/D3/D4) ----
  // partida de referência 3292712362 (tests/fixtures) com a leitura do jogo presa num portão: dá para fechar no meio
  {
    const GJ = 3292712362;
    const fx = n => JSON.parse(readFileSync(raiz + 'tests/fixtures/' + n, 'utf8'));
    const jogo = fx('game-3292712362.json'), linha = fx('timeline-3292712362.json');
    let abrir = null, leituras = 0, jogoServido = jogo;
    const fecharPortao = () => { let a; const p = new Promise(r => { a = r; }); abrir = a; return p; };
    let portao = fecharPortao();
    const rotas = {
      'GET /lol-summoner/v1/current-summoner': fx('summoner.json'),
      [`GET /lol-match-history/v1/games/${GJ}`]: async () => { leituras++; await portao; return jogoServido; },
      [`GET /lol-match-history/v1/game-timelines/${GJ}`]: linha,
      'GET /lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=199': fx('historico.json'),
    };
    // rodada limpa: ReadyCheck esquece análise e botão da rodada anterior (estado do módulo é um só)
    const nova = async ({ fim = true } = {}) => {
      portao = fecharPortao(); leituras = 0;
      const doc = novoDoc(); globalThis.document = doc;
      const janela = novaJanela(); globalThis.window = janela;
      globalThis.fetch = lcuFalsa(rotas).fetch;
      const obs = new Map();
      const context = { socket: { observe: (uri, cb) => { (obs.get(uri) || obs.set(uri, []).get(uri)).push(cb); } } };
      const emitir = (uri, data) => { for (const cb of obs.get(uri) || []) cb({ uri, data, eventType: 'Update' }); };
      const ret = pj.iniciarPosjogo(context, { posjogo: { ligado: true }, compacto: { ligado: false }, filaRapida: {}, traumas: {} }, null);
      emitir('/lol-gameflow/v1/gameflow-phase', 'ReadyCheck');
      emitir('/lol-gameflow/v1/session', { gameData: { gameId: GJ, queue: { id: 420 } }, map: { id: 11 } });
      if (fim) emitir('/lol-gameflow/v1/gameflow-phase', 'EndOfGame');
      await tick(10);
      const painelEl = () => doc.getElementById('lc-posjogo'), botao = () => doc.getElementById('lc-posjogo-reabrir');
      return { doc, janela, emitir, ret, painelEl, botao, painelPronto: () => !!painelEl()?.innerHTML?.includes('lc-topo') };
    };
    const xis = { closest: s => (s === '.lc-fechar' ? {} : null), parentNode: null }; // o ✕ dentro do HTML do painel

    // pedido por ele (botão, Ctrl+K, "ver análise completa"): caixa de carregamento com ✕, que fecha sem cancelar
    let s = await nova({ fim: false });
    s.ret.abrirPainel(GJ).catch(() => {}); await tick(10);
    const carregando = s.painelEl()?.innerHTML || '';
    caso('pedido por ele: "analisando a partida…" com ✕ na caixa de carregamento',
      carregando.includes('analisando a partida') && carregando.includes('lc-fechar') && !s.painelPronto(), carregando);
    s.painelEl()?.disparar('click', { target: xis });
    caso('✕ no carregamento: a caixa sai e o botão do topo diz "analisando a partida…"',
      !s.painelEl() && s.botao()?.textContent === '⏳ analisando a partida…', s.botao()?.textContent);
    abrir(); await tick(20);
    caso('análise chega com o painel fechado: nada abre sozinho; o botão vira "análise pronta"',
      !s.painelEl() && s.botao()?.textContent === '📊 análise pronta', s.botao()?.textContent);
    s.botao()?.click(); await tick(10);
    caso('clique no botão: painel com a partida na hora, sem ler a LCU de novo (a análise seguiu em cache)',
      s.painelPronto() && !s.botao() && leituras === 1, `leituras ${leituras}`);
    s.janela.disparar('pointerdown', s.painelEl());
    caso('clique dentro da caixa não fecha', s.painelPronto());
    s.janela.disparar('pointerdown', s.doc.body);
    caso('clique fora da caixa (no client) fecha o painel e deixa "reabrir análise"',
      !s.painelEl() && s.botao()?.textContent === '📊 reabrir análise' && s.janela.ouvindo('pointerdown') === 0, s.botao()?.textContent);

    // abertura automática do EndOfGame: carrega só com o botão; sem ele mexer no client, abre quando fica pronta
    s = await nova();
    caso('EndOfGame: carregando sem caixa por cima (só o botão "analisando")', !s.painelEl() && s.botao()?.textContent === '⏳ analisando a partida…');
    abrir(); await tick(20);
    caso('EndOfGame sem clique dele no client: o painel abre sozinho quando a análise fica pronta', s.painelPronto() && !s.botao());

    // ...e com clique dele no meio do carregamento: não cai por cima, espera no botão
    s = await nova();
    s.janela.disparar('pointerdown', s.doc.body);
    abrir(); await tick(20);
    caso('EndOfGame com clique dele no client durante o carregamento: painel não abre; botão "análise pronta"',
      !s.painelEl() && s.botao()?.textContent === '📊 análise pronta', s.botao()?.textContent);
    s.botao()?.click(); await tick(10);
    caso('...e o clique no botão abre o painel', s.painelPronto());
    // o "mexeu" daquela abertura não vale para a próxima: abertura automática com a análise já pronta abre na hora
    s.janela.disparar('pointerdown', s.doc.body);
    s.ret.abrirPainel(GJ, { fimDePartida: true, automatico: true }); await tick(10);
    caso('abertura automática seguinte, com a análise pronta: abre (o clique da anterior não segura)', s.painelPronto() && leituras === 1);

    // aceite no meio do carregamento: some tudo e a análise em voo não abre nada depois
    s = await nova();
    s.emitir('/lol-gameflow/v1/gameflow-phase', 'ReadyCheck');
    abrir(); await tick(20);
    caso('ReadyCheck no carregamento: botão some e a análise que chega depois não abre o painel', !s.painelEl() && !s.botao());

    // 2º EndOfGame da mesma partida com a análise em voo (revisão 14/10, achado 6): não apaga a caixa de carregamento
    // que ele abriu pelo botão nem zera o "ele mexeu"
    s = await nova();
    s.janela.disparar('pointerdown', s.doc.body);
    s.emitir('/lol-gameflow/v1/gameflow-phase', 'EndOfGame'); await tick(10);
    abrir(); await tick(20);
    caso('2º EndOfGame no carregamento depois de ele clicar no client: o painel continua sem cair por cima',
      !s.painelEl() && s.botao()?.textContent === '📊 análise pronta' && leituras === 1, `${s.botao()?.textContent} leituras ${leituras}`);
    s = await nova();
    s.botao()?.click(); await tick(10);
    const caixaAntes = s.painelEl()?.innerHTML?.includes('analisando a partida');
    s.emitir('/lol-gameflow/v1/gameflow-phase', 'EndOfGame'); await tick(10);
    caso('2º EndOfGame com a caixa de carregamento que ele abriu: a caixa fica', caixaAntes && !!s.painelEl()?.innerHTML?.includes('analisando a partida'));
    abrir(); await tick(20);
    caso('...e quando a análise fica pronta o painel aparece nela', s.painelPronto());

    // erro na abertura automática (revisão 14/10, achado 2): nenhuma caixa sozinha; o botão oferece tentar de novo
    jogoServido = { ...jogo, mapId: 12 }; // analisar() devolve erro ("só Summoner's Rift")
    try {
      s = await nova();
      abrir(); await tick(20);
      caso('abertura automática com erro: nenhuma caixa por cima do client; botão "tentar a análise de novo"',
        !s.painelEl() && s.botao()?.textContent === '📊 tentar a análise de novo', s.botao()?.textContent);
      s = await nova({ fim: false });
      s.ret.abrirPainel(GJ).catch(() => {}); await tick(10);
      abrir(); await tick(20);
      caso('pedido por ele com erro: o erro aparece na caixa (com ✕)',
        !!s.painelEl()?.innerHTML?.includes('pós-jogo:') && !!s.painelEl()?.innerHTML?.includes('lc-fechar'));
    } finally { jogoServido = jogo; }

    // lições do motor (D7 corrigido na revisão, achado 1): recolhidas só com veredito na faixa
    const auto = st => pj.licoesAuto({ mentor: st });
    caso('licoesAuto: abertas sem resposta do mentor, com "nada" (mentor desligado, personalizada, partida antiga), pensando, erro, fora',
      auto(null) && auto({ status: 'nada' }) && auto({ status: 'pensando' }) && auto({ status: 'erro' }) && auto({ status: 'fora' }) && auto({ status: 'indisponivel' }));
    caso('licoesAuto: recolhidas com o veredito pronto; abertas se a resposta pronta não tem "Veredito:"',
      !auto({ status: 'pronto', texto: '**Veredito:** você morreu demais.\n\nO essencial:\n- x' }) && auto({ status: 'pronto', texto: 'Lições:\n1. x' }));
  }

  // a camada cai DEPOIS dos 400 ms (celebração que chega tarde e a regra 7 expande, erro da tela 4, ⤢ expandir dele):
  // o client normal segue como hoje, com o painel; fora do EndOfGame, ou com o painel já aberto, nada
  const antesMO = globalThis.MutationObserver;
  const obs = [];
  globalThis.MutationObserver = class { constructor(cb) { this.cb = cb; this.on = false; obs.push(this); } observe(el) { this.el = el; this.on = true; } disconnect() { this.on = false; } };
  const mudouClasse = () => { for (const o of [...obs]) if (o.on) o.cb([{ attributeName: 'class' }]); };
  try {
    const f = await rodada({ compacto: true, avista: true });
    const fechadoAntes = !f.aberto;
    f.doc.documentElement.classList.remove('lc-modo-compacto');
    mudouClasse(); await tick(10);
    caso('posjogo/index.js: camada cai depois da decisão (modal tardio/erro/expandir) no EndOfGame → o painel abre',
      fechadoAntes && !!f.doc.getElementById('lc-posjogo') && obs.every(o => !o.on));
    const g = await rodada({ compacto: true, avista: true });
    const ligadas = obs.filter(o => o.on).length;
    // fase mudou (fechar = dismiss-stats -> Lobby): a vigia para e a camada que cai depois não abre nada
    g.emitir('/lol-gameflow/v1/gameflow-phase', 'Lobby');
    const parou = obs.every(o => !o.on);
    g.doc.documentElement.classList.remove('lc-modo-compacto');
    mudouClasse(); await tick(10);
    caso('posjogo/index.js: uma vigia por EndOfGame; a fase muda e ela para (a camada que cai depois não abre o painel)',
      ligadas === 1 && parou && !g.doc.getElementById('lc-posjogo'), JSON.stringify({ ligadas, parou }));
    let abriu = 0;
    const v = pj.vigiarSaidaDoCompacto({ aoSair: () => { abriu++; }, doc: g.doc, MO: globalThis.MutationObserver });
    g.doc.documentElement.classList.add('lc-modo-compacto'); mudouClasse();
    const comCamada = abriu === 0;
    g.doc.documentElement.classList.remove('lc-modo-compacto'); mudouClasse(); mudouClasse();
    v.parar();
    caso('vigiarSaidaDoCompacto: só dispara quando a classe sai, uma vez', comCamada && abriu === 1);
  } finally { globalThis.MutationObserver = antesMO; }
  console.error = erroOriginal; console.log = logOriginal;
}

relatar(casos);
