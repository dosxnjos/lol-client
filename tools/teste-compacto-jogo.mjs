// Testa a tela "partida em andamento" do client compacto (pengu/compacto/tela-jogo.js, passo 14 do plano
// roadmap/2026-10-13-client-compacto.md) sem o client: DOM mínimo feito aqui (cópia do de tools/teste-compacto-selecao.mjs,
// com o setter de disabled), LCU falsa (nenhum POST/PATCH ao client real) e coletor falso (GET /estado).
// Relato do Gabriel de 14/10/2026 ~20:50: "O modo compacto sai assim que a partida inicia". Prova: campeão, fila, tempo e
// placar do time (coletor) com reserva sem coletor (sessão do gameflow + relógio local desde o GameStart, rotulado
// "desde o carregamento"); RECONECTAR só com clique de verdade, um por vez, POST /lol-gameflow/v1/reconnect sem corpo;
// nenhum nome de terceiro nem puuid na tela; nada de escrita fora do reconectar. uso: node tools/teste-compacto-jogo.mjs
import { relatar, lcuFalsa } from './lcu-falsa.mjs';
import * as tela from '../pengu/compacto/tela-jogo.js';
import { lerEstadoColetor, meuCampeao, textoTempo, idadeColetor, ROTA_RECONECTAR, RECONECTA_MS, COLETOR_VELHO_MS, PROJECAO_MAX_MS } from '../pengu/compacto/tela-jogo.js';
import { lcu as lcuComum, _zerarCatalogo } from '../pengu/compacto/comum.js';
import { TELAS, destinoDaFase } from '../pengu/compacto/index.js';

// ---------- DOM mínimo ----------
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
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { if (k === 'id') this.id = String(v); else if (k === 'class') this.className = v; else this.attrs.set(k, String(v)); }
  getAttribute(k) { return k === 'id' ? this.id : this.attrs.get(k) ?? null; }
  removeAttribute(k) { this.attrs.delete(k); }
  get disabled() { return this.attrs.has('disabled'); }
  set disabled(v) { if (v) this.attrs.set('disabled', ''); else this.attrs.delete('disabled'); }
  get title() { return this.attrs.get('title') ?? ''; }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  append(...ns) { for (let n of ns) { if (typeof n === 'string') n = new Texto(n); if (n.parentNode) n.remove(); n.parentNode = this; this.childNodes.push(n); } }
  appendChild(n) { this.append(n); return n; }
  remove() { if (this.parentNode) { const l = this.parentNode.childNodes; l.splice(l.indexOf(this), 1); } this.parentNode = null; }
  replaceChildren(...ns) { for (const n of [...this.childNodes]) n.parentNode = null; this.childNodes = []; this.append(...ns); }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this.replaceChildren(new Texto(v)); }
  addEventListener(ev, fn) { (this.ouvintes[ev] ||= []).push(fn); }
  disparar(ev, extra = {}) { const e = { target: this, stopPropagation() {}, preventDefault() {}, ...extra }; for (const fn of this.ouvintes[ev] || []) fn(e); }
  click(extra = { isTrusted: true }) { if (!this.disabled) this.disparar('click', extra); }
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
const visivel = el => [el.textContent, ...[...el.desc()].map(n => n.getAttribute('title') || '')].join(' | ');
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

// ---------- dados ----------
const PUUID = 'p-eu-0000';
const SESSAO = {
  phase: 'InProgress',
  gameData: {
    gameId: 3293999999, isCustomGame: false, queue: { id: 420, mapId: 11 },
    teamOne: [{ puuid: PUUID, championId: 58, summonerName: 'Eu' }, { puuid: 'p-al1', championId: 64, summonerName: 'AliadoSecreto' }],
    teamTwo: [{ puuid: 'p-in1', championId: 24, summonerName: 'InimigoSecreto' }],
    playerChampionSelections: [{ puuid: PUUID, championId: 58, spell1Id: 12, spell2Id: 4 }, { puuid: 'p-in1', championId: 24 }],
  },
  map: { id: 11 },
};
const ESTADO = {
  partida: true, fase: 'jogo', gt: 125.4, relogio: '02:05', gameId: 3293999999, meuTime: 100, eu: 0,
  euJogador: { nome: 'Renekton', campeao: 58 },
  jogadores: [
    { slot: 0, campeao: 58, nome: 'Renekton', aliado: true, k: 3, d: 1, a: 2, vistoHaS: 0 },
    { slot: 1, campeao: 64, nome: 'Lee Sin', aliado: true, k: 4, d: 0, a: 5, vistoHaS: 0 },
    { slot: 5, campeao: 24, nome: 'Jax', aliado: false, k: 4, d: 7, a: 0, vistoHaS: 41, itens: [3078], ouroEstimado: 9999 },
  ],
};
const CATALOGO = [{ id: 58, name: 'Renekton', alias: 'Renekton' }, { id: 64, name: 'Lee Sin', alias: 'LeeSin' }, { id: 24, name: 'Jax', alias: 'Jax' }];

let agora = 1_000_000;
tela._relogio.agora = () => agora;

// ---------- tela montada com ctx falso (contrato do roteador: seguro/falhou = client normal) ----------
async function montarTela({ fase = 'GameStart', rotas = {}, coletor = async () => ({ status: 200, dados: ESTADO }), semColetor = false } = {}) {
  const doc = novoDoc();
  const camada = doc.createElement('div'); camada.id = 'lc-compacto';
  const titulo = doc.createElement('div'), extras = doc.createElement('div'), raiz = doc.createElement('main');
  camada.append(titulo, extras, raiz); doc.body.append(camada);
  const f = lcuFalsa({
    'GET /lol-gameflow/v1/session': SESSAO,
    'GET /lol-summoner/v1/current-summoner': { puuid: PUUID, gameName: 'Xerekton', profileIconId: 1 },
    'GET /lol-game-data/assets/v1/champion-summary.json': CATALOGO,
    [`POST ${ROTA_RECONECTAR}`]: { status: 204 },
    ...rotas,
  });
  globalThis.fetch = f.fetch;
  globalThis.document = doc;
  _zerarCatalogo();
  const t = { doc, raiz, titulo, extras, lcu: f, falhas: [], avisos: [], expandiu: 0, intervalos: [], subs: new Map(), vivo: true, fase, coletorPedidos: [] };
  const seguro = fn => (...a) => {
    if (!t.vivo) return undefined;
    try { const r = fn(...a); if (r && typeof r.then === 'function') r.catch(e => t.falhas.push(e)); return r; } catch (e) { t.falhas.push(e); return undefined; }
  };
  const servicos = semColetor ? {} : { coletor: async (caminho, op) => { t.coletorPedidos.push([caminho, op?.metodo || 'GET']); return coletor(caminho, op); } };
  t.ctx = {
    cfg: {}, servicos, tela: 'jogo', get fase() { return t.fase; }, info: { lida: true },
    raiz, titulo, extras, lcu: (m, u, c) => lcuComum(m, u, c, f.fetch), vivo: () => t.vivo, seguro,
    observar: (uri, cb) => t.subs.set(uri, seguro(cb)),
    tempo: () => 0, intervalo: (fn, ms) => { t.intervalos.push({ fn: seguro(fn), ms }); return t.intervalos.length; },
    falhou: e => t.falhas.push(e), expandir: () => { t.expandiu++; }, avisar: (m, e) => t.avisos.push([String(m), !!e]), dormir: () => Promise.resolve(),
  };
  t.ir = async novaFase => { t.fase = novaFase; tela.atualizar(t.ctx); await tick(); };
  t.tique = async () => { for (const i of t.intervalos) i.fn(); await tick(); };
  t.achar = sel => raiz.querySelector(sel);
  t.texto = sel => raiz.querySelector(sel)?.textContent ?? null;
  t.escritas = () => f.escritas();
  t.desmontar = () => { t.vivo = false; tela.desmontar(raiz, t.ctx); };
  tela.montar(raiz, t.ctx);
  await tick();
  return t;
}

const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);

// ---------- 1. funções puras ----------
{
  const e = lerEstadoColetor(ESTADO, 3293999999);
  caso('coletor: tempo, placar por time (soma dos abates) e meu campeão', e && e.gt === 125.4 && e.placar.nosso === 7 && e.placar.deles === 4 && e.campeao === 58 && !e.carregando, JSON.stringify(e));
  caso('coletor: só tempo (e a hora da leitura dele), placar e campeão saem da leitura (nada de item, ouro, "visto há", nome)',
    igual(Object.keys(e).sort(), ['campeao', 'carregando', 'em', 'gt', 'placar']) && !JSON.stringify(e).includes('Jax'), JSON.stringify(e));
  caso('coletor: partida de outro gameId não vale', lerEstadoColetor(ESTADO, 123) === null);
  caso('coletor: sem partida (partida false) = null; carregando marcado', lerEstadoColetor({ partida: false }) === null && lerEstadoColetor({ ...ESTADO, fase: 'carregando' }).carregando === true);
  caso('coletor: jogador sem k ou sem aliado = sem placar (não inventa)', lerEstadoColetor({ ...ESTADO, jogadores: [{ aliado: true }, { aliado: false, k: 1 }] }).placar === null);
  caso('sessão: meu campeão pelo puuid (playerChampionSelections / teamOne)', meuCampeao(SESSAO, PUUID) === 58
    && meuCampeao({ gameData: { teamTwo: [{ puuid: PUUID, championId: 24 }] } }, PUUID) === 24);
  caso('sessão: sem puuid, puuid de outro ou championId 0 = null', meuCampeao(SESSAO, null) === null && meuCampeao(SESSAO, 'x') === null
    && meuCampeao({ gameData: { teamOne: [{ puuid: PUUID, championId: 0 }] } }, PUUID) === null && meuCampeao(null, PUUID) === null);
  const c = lerEstadoColetor(ESTADO);
  caso('tempo: coletor fresco anda com o relógio entre leituras', textoTempo({ coletor: c, lidoEm: 0, agora: 3000 }).texto === '02:08' && textoTempo({ coletor: c, lidoEm: 0, agora: 0 }).rotulo === 'tempo de jogo');
  // achado 8 da revisão adversarial: a projeção parte de quando o COLETOR leu (atualizadoMs), não de quando a tela leu, e anda
  // no máximo PROJECAO_MAX_MS (partida pausada não corre 8 s para depois voltar)
  const comHora = lerEstadoColetor({ ...ESTADO, atualizadoMs: 10_000 });
  caso('achado 8: tempo projetado desde o atualizadoMs do coletor (lido pela tela 1,5 s depois: 02:05 + 2 s = 02:07, não 02:05)',
    comHora.em === 10_000 && textoTempo({ coletor: comHora, lidoEm: 11_500, agora: 12_000 }).texto === '02:07', textoTempo({ coletor: comHora, lidoEm: 11_500, agora: 12_000 }).texto);
  caso(`achado 8: projeção no máximo ${PROJECAO_MAX_MS / 1000} s (7 s sem leitura nova: 02:09, não 02:12)`,
    textoTempo({ coletor: comHora, lidoEm: 10_000, agora: 17_000 }).texto === '02:09', textoTempo({ coletor: comHora, lidoEm: 10_000, agora: 17_000 }).texto);
  caso('achado 8: atualizadoMs velho (coletor travado) conta como leitura velha; no futuro, vale a hora da tela',
    textoTempo({ coletor: comHora, lidoEm: 30_000, agora: 30_000, inicio: 1 }).fonte === 'local'
      && idadeColetor(lerEstadoColetor({ ...ESTADO, atualizadoMs: 99_000 }), 20_000, 21_000) === 1000);
  caso('tempo: coletor velho cai no relógio local, rotulado "desde o carregamento"',
    textoTempo({ coletor: c, lidoEm: 0, agora: COLETOR_VELHO_MS + 1, inicio: COLETOR_VELHO_MS + 1 - 90000 }).texto === '01:30'
    && /desde o carregamento/.test(textoTempo({ coletor: c, lidoEm: 0, agora: COLETOR_VELHO_MS + 1, inicio: 1 }).rotulo));
  caso('tempo: sem nada = "–"', textoTempo({ agora: 5 }).texto === '–');
}

// ---------- 2. partida com o coletor ----------
{
  tela._zerarInicio();
  agora = 1_000_000;
  const t = await montarTela({ fase: 'GameStart' });
  caso('GameStart: título "abrindo o jogo", coletor ainda não lido (só InProgress lê)', /abrindo o jogo/.test(t.titulo.textContent) && t.coletorPedidos.length === 0, JSON.stringify(t.coletorPedidos));
  agora += 2000;
  await t.ir('InProgress');
  await tick();
  caso('InProgress: campeão (Renekton), fila (Ranqueada Solo/Duo), tempo de jogo do coletor, placar do time',
    t.texto('b.lc-cp-jg-camp') === 'Renekton' && t.raiz.textContent.includes('Ranqueada Solo/Duo') && t.texto('div[data-a="tempo"]') === '02:05'
    && t.texto('div[data-a="placar"]') === 'seu time 7 × 4 inimigos', visivel(t.raiz));
  caso('InProgress: fonte "coletor (Live Client)" e "em andamento" no título', t.raiz.textContent.includes('tempo e placar: coletor (Live Client)') && /em andamento/.test(t.titulo.textContent));
  const tudo = visivel(t.raiz) + visivel(t.titulo);
  caso('nada de terceiro na tela: sem nome de jogador, sem puuid, sem campeão inimigo, sem item/ouro/"visto"',
    !/AliadoSecreto|InimigoSecreto|Xerekton|p-eu|p-in1|Jax|Lee Sin|9999|visto/.test(tudo), tudo);
  agora += 4000; await t.tique();
  caso('relógio anda entre leituras do coletor (02:05 + 4 s; a leitura nova devolve o mesmo gt)', t.texto('div[data-a="tempo"]') === '02:05', t.texto('div[data-a="tempo"]'));
  caso('caiu escondido fora do Reconnect', t.achar('div[data-a="caiu"]').style.display === 'none');
  caso('nenhuma escrita na LCU numa partida normal (só GET)', t.escritas().length === 0 && t.coletorPedidos.every(([c, m]) => c === '/estado' && m === 'GET'), JSON.stringify([t.escritas(), t.coletorPedidos]));
  t.achar('button[data-a="abrir-normal"]').click();
  caso('"abrir o client normal" (ícone expandir) chama o expandir do roteador', t.expandiu === 1);
  caso('sem erro de tela', t.falhas.length === 0, t.falhas.map(String).join('; '));
  t.desmontar();
}

// ---------- 3. coletor fora: sessão do gameflow + relógio local desde o GameStart ----------
{
  tela._zerarInicio();
  agora = 2_000_000;
  const t = await montarTela({ fase: 'GameStart', coletor: async () => ({ status: 0, dados: null }) });
  t.desmontar(); // ele expandiu no GameStart; a tela volta depois (o relógio é por partida, não por montagem)
  agora += 90_000;
  const u = await montarTela({ fase: 'InProgress', coletor: async () => ({ status: 0, dados: null }) });
  await tick();
  caso('coletor fora: campeão pela sessão do gameflow (puuid do current-summoner)', u.texto('b.lc-cp-jg-camp') === 'Renekton', u.texto('b.lc-cp-jg-camp'));
  caso('coletor fora: relógio local desde o GameStart (01:30), rotulado "desde o carregamento", sem placar',
    u.texto('div[data-a="tempo"]') === '01:30' && /desde o carregamento/.test(u.raiz.textContent) && u.achar('div[data-a="placar"]').style.display === 'none', visivel(u.raiz));
  caso('coletor fora: a fonte diz "coletor fora"', u.raiz.textContent.includes('coletor fora'));
  u.desmontar();
  // GameStart da partida seguinte (outro gameId) zera o relógio
  agora += 30 * 60_000;
  const v = await montarTela({ fase: 'GameStart', coletor: async () => ({ status: 0, dados: null }),
    rotas: { 'GET /lol-gameflow/v1/session': { ...SESSAO, gameData: { ...SESSAO.gameData, gameId: 3294000001 } } } });
  agora += 5000; await v.ir('InProgress');
  caso('partida seguinte: GameStart novo zera o relógio local (00:05)', v.texto('div[data-a="tempo"]') === '00:05', v.texto('div[data-a="tempo"]'));
  v.desmontar();
  // plugin recarregado no meio da partida (sem GameStart visto) e sem coletor: "–", nunca um tempo inventado
  tela._zerarInicio();
  const w = await montarTela({ fase: 'InProgress', semColetor: true });
  caso('boot no meio da partida sem coletor: tempo "–" (não inventa)', w.texto('div[data-a="tempo"]') === '–', w.texto('div[data-a="tempo"]'));
  w.desmontar();
  // coletor diz "carregando"
  const x = await montarTela({ fase: 'InProgress', coletor: async () => ({ status: 200, dados: { ...ESTADO, fase: 'carregando', gt: 0.02 } }) });
  await tick();
  caso('tela de carregamento do jogo: "carregando", sem placar', x.texto('div[data-a="tempo"]') === 'carregando' && x.achar('div[data-a="placar"]').style.display === 'none', visivel(x.raiz));
  x.desmontar();
}

// ---------- 4. Reconnect: RECONECTAR só com clique dele ----------
{
  tela._zerarInicio();
  const t = await montarTela({ fase: 'InProgress' });
  await t.ir('Reconnect');
  const btn = t.achar('button[data-a="reconectar"]');
  // texto neutro (achado 3): o Reconnect também aparece no fim de uma partida normal
  caso('Reconnect: bloco "o jogo fechou" com RECONECTAR à vista; título "o jogo fechou: reconectar?"; nada de "caiu"/"a partida segue"',
    t.achar('div[data-a="caiu"]').style.display === '' && btn && !btn.disabled && /o jogo fechou: reconectar\?/.test(t.titulo.textContent)
      && /se a partida ainda está rolando/.test(t.raiz.textContent) && !/caiu|a partida segue/.test(t.raiz.textContent + t.titulo.textContent),
    visivel(t.raiz) + ' / ' + t.titulo.textContent);
  const nColetor = t.coletorPedidos.length;
  await t.tique();
  caso('Reconnect: não lê o coletor (o jogo caiu)', t.coletorPedidos.length === nColetor);
  caso('Reconnect: nada é enviado sem clique', t.escritas().length === 0);
  btn.click({ isTrusted: false }); await tick();
  caso('clique sintético (isTrusted false) não reconecta', t.escritas().length === 0);
  btn.click(); await tick();
  btn.click(); await tick(); // 2º clique com o 1º ok: cinza, não manda outro
  const esc = t.escritas();
  caso('clique dele: exatamente 1 POST /lol-gameflow/v1/reconnect, sem corpo', esc.length === 1 && esc[0].metodo === 'POST' && esc[0].url === ROTA_RECONECTAR && esc[0].corpo === undefined, JSON.stringify(esc));
  caso('depois do clique: botão cinza "reconectando…" e o aviso do pedido', btn.disabled && btn.textContent === 'reconectando…' && /pedido enviado/.test(t.raiz.textContent));
  agora += RECONECTA_MS + 1; await t.tique();
  caso(`fase presa no Reconnect por ${RECONECTA_MS / 1000} s: o botão volta (novo clique dele vale)`, !btn.disabled && btn.textContent === 'RECONECTAR');
  await t.ir('InProgress');
  caso('voltou ao InProgress: bloco do Reconnect some', t.achar('div[data-a="caiu"]').style.display === 'none');
  btn.click(); await tick();
  caso('fora do Reconnect o botão escondido não manda nada', t.escritas().length === 1);
  t.desmontar();
  // falha da LCU: motivo + aviso, botão volta para tentar de novo (clique dele)
  const u = await montarTela({ fase: 'Reconnect', rotas: { [`POST ${ROTA_RECONECTAR}`]: { status: 500, json: { message: 'x' } } } });
  const b2 = u.achar('button[data-a="reconectar"]');
  b2.click(); await tick();
  caso('falha (500): motivo na tela, aviso com a saída (client normal) e botão de volta', /não foi possível reconectar \(500\)/.test(u.raiz.textContent)
    && u.avisos.some(([m, e]) => e && /client normal/.test(m)) && !b2.disabled, visivel(u.raiz));
  b2.click(); await tick();
  caso('falha: novo clique dele tenta de novo (2 POSTs, nenhum sozinho)', u.escritas().length === 2 && u.escritas().every(c => c.url === ROTA_RECONECTAR));
  caso('nenhuma escrita além do /reconnect (nada de early-exit, spectate/quit)', [...t.escritas(), ...u.escritas()].every(c => c.url === ROTA_RECONECTAR));
  u.desmontar();
}

// ---------- 4b. revisão adversarial do passo 14: achados 3, 7 e 9 ----------
{
  // achado 3: Reconnect no fim de uma partida normal (medição de 14/10: InProgress -> Reconnect -> PreEndOfGame em 11 s). No
  // PreEndOfGame o roteador espera a etapa e NÃO chama atualizar: o tique de 1 s tira o bloco e o RECONECTAR de vista
  tela._zerarInicio();
  const t = await montarTela({ fase: 'InProgress' });
  await t.ir('Reconnect');
  t.fase = 'PreEndOfGame'; // sem atualizar (o roteador está em "esperar")
  await t.tique();
  caso('achado 3: Reconnect -> PreEndOfGame sem atualizar: o tique esconde "o jogo fechou" e o RECONECTAR; título "terminou"',
    t.achar('div[data-a="caiu"]').style.display === 'none' && /terminou/.test(t.titulo.textContent), visivel(t.raiz) + ' / ' + t.titulo.textContent);
  t.achar('button[data-a="reconectar"]').click(); await tick();
  caso('achado 3: no PreEndOfGame o RECONECTAR não manda nada', t.escritas().length === 0);
  t.desmontar();

  // achado 7: reconectar passa por GameStart de novo na mesma partida, minutos depois: o relógio local não zera
  tela._zerarInicio();
  agora = 5_000_000;
  const u = await montarTela({ fase: 'GameStart', semColetor: true });
  agora += 600_000; await u.ir('InProgress'); // sessão lida (gameId 3293999999) ligou o início
  await u.ir('Reconnect');
  agora += 120_000; await u.ir('GameStart'); // 2 min depois, a mesma partida
  agora += 5000; await u.ir('InProgress');
  caso('achado 7: GameStart do reconectar (mesma partida, tela de pé) não zera o relógio local (12:05)', u.texto('div[data-a="tempo"]') === '12:05', u.texto('div[data-a="tempo"]'));
  u.desmontar();
  // tela remontada no GameStart do reconectar (ele tinha expandido): o início de antes volta quando a sessão confirma a partida
  agora += 60_000;
  const w = await montarTela({ fase: 'GameStart', semColetor: true });
  agora += 5000; await w.ir('InProgress');
  caso('achado 7: remontada no GameStart do reconectar, a sessão da mesma partida devolve o início de antes (13:10)', w.texto('div[data-a="tempo"]') === '13:10', w.texto('div[data-a="tempo"]'));
  w.desmontar();

  // achado 9: janela minimizada (visibilityState hidden) não lê o coletor; visível sem foco (2ª tela) lê
  tela._zerarInicio();
  const x = await montarTela({ fase: 'InProgress' });
  await tick();
  const n0 = x.coletorPedidos.length;
  x.doc.visibilityState = 'hidden';
  await x.tique(); await x.tique();
  const nEscondida = x.coletorPedidos.length - n0;
  x.doc.visibilityState = 'visible';
  await x.tique();
  caso('achado 9: minimizada não lê o coletor; visível de novo lê na volta seguinte', nEscondida === 0 && x.coletorPedidos.length - n0 === 1, JSON.stringify([nEscondida, x.coletorPedidos.length - n0]));
  x.desmontar();
}

// ---------- 5. contrato com o roteador ----------
caso('roteador: TELAS.jogo aponta para a tela de partida e o módulo exporta atualizar (GameStart -> InProgress sem remontar)',
  TELAS.jogo === './tela-jogo.js' && typeof tela.atualizar === 'function' && typeof tela.montar === 'function');
caso('roteador: GameStart, InProgress e Reconnect vão para a tela "jogo"; FailedToLaunch e TerminatedInError expandem',
  ['GameStart', 'InProgress', 'Reconnect'].every(f => destinoDaFase(f).tela === 'jogo') && ['FailedToLaunch', 'TerminatedInError'].every(f => destinoDaFase(f).tipo === 'expandir'));

function igual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
relatar(casos);
