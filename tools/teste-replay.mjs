// Testa o replay do pós-jogo (pengu/replay.js; pedido de 15/10/2026 "quero o botão de baixar/assistir replay no pós-jogo") sem o
// client: LCU falsa (tools/lcu-falsa.mjs) e DOM mínimo feito aqui. Formatos medidos no client em 15/10/2026 (só GET):
// /lol-replays/v1/configuration, /metadata/{id} nos estados "watch" e "download" e o 404 sem registro. Rotas e corpos lidos no
// rcp-fe-lol-shared-components 16.20 (ReplayButton). Regras que o teste segura: nada escrito sem clique de verdade; baixar sem
// registro cria antes (corpo igual ao da Riot); assistir em 1 clique (pedido de 15/10/2026 ~12:45); estados cinza com motivo.
// uso: node tools/teste-replay.mjs
import { relatar, lcuFalsa } from './lcu-falsa.mjs';
import { lcu as lcuReal } from '../pengu/compacto/comum.js';
import * as rp from '../pengu/replay.js';

class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.childNodes = []; this.dataset = {}; this.attrs = new Map(); this.ouvintes = {}; this.style = {};
    this.hidden = false; this.disabled = false; this._t = ''; const s = new Set(); this.classList = { add: c => s.add(c), remove: c => s.delete(c), contains: c => s.has(c),
      toggle: (c, f) => { const q = f === undefined ? !s.has(c) : !!f; if (q) s.add(c); else s.delete(c); return q; } }; }
  set className(v) { for (const c of String(v).split(/\s+/).filter(Boolean)) this.classList.add(c); }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  append(...ns) { for (const n of ns) { if (n === null || n === undefined) throw new Error('append(null)'); this.childNodes.push(typeof n === 'string' ? { textContent: n } : n); } }
  appendChild(n) { this.append(n); return n; }
  addEventListener(ev, fn) { (this.ouvintes[ev] ||= []).push(fn); }
  click(extra = {}) { for (const fn of this.ouvintes.click || []) fn({ type: 'click', target: this, ...extra }); }
  get textContent() { return this._t || this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this._t = String(v); this.childNodes = []; }
  q(a) { for (const n of this.childNodes) { if (n.dataset?.a === a) return n; const r = n.q?.(a); if (r) return r; } return null; }
}
const doc = { createElement: t => new El(t), head: new El('head'), getElementById: () => null };
globalThis.document = doc;

const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };
const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const GID = 3293377251;
const R = rp.rotas(GID);
// medidos em 15/10/2026 (client 16.20, só GET)
const CFG = { gameVersion: '16.20.824.8524', isInTournament: false, isLoggedIn: true, isPatching: false, isPlayingGame: false, isPlayingReplay: false,
  isReplaysEnabled: true, isReplaysForEndOfGameEnabled: true, isReplaysForMatchHistoryEnabled: true, minServerVersion: '', minutesUntilReplayConsideredLost: 30 };
const SEM_REGISTRO = { status: 404, json: { errorCode: 'RPC_ERROR', httpStatus: 404, implementationDetails: {}, message: 'Plugin found no local metadata. Try using the POST metadata create endpoint first.' } };
const ok = j => ({ ok: true, status: 200, json: j });

// ---------- 1. funções puras ----------
{
  caso('rotas: as do ReplayButton da Riot (metadata, create v2, download graceful no fim de partida, download no histórico, watch)',
    R.metadata === `/lol-replays/v1/metadata/${GID}` && R.criar === `/lol-replays/v2/metadata/${GID}/create` && R.baixar(true) === `/lol-replays/v1/rofls/${GID}/download/graceful`
    && R.baixar(false) === `/lol-replays/v1/rofls/${GID}/download` && R.assistir === `/lol-replays/v1/rofls/${GID}/watch`);
  caso('corpo do create: fim de partida = gameVersion "unknown_version" + queue.type + queue.id (sem gameEnd)',
    igual(rp.corpoCriar({ gameType: 'RANKED_SOLO_5x5', queueId: 420 }), { gameVersion: 'unknown_version', gameType: 'RANKED_SOLO_5x5', queueId: 420 }));
  caso('corpo do create: histórico manda a versão e gameEnd = criação + duração; sem tipo ou fila = null (a Riot recusaria)',
    igual(rp.corpoCriar({ gameVersion: '16.20.1', gameType: 'MATCHED_GAME', queueId: 400, gameCreation: 1000, gameDuration: 50 }), { gameVersion: '16.20.1', gameType: 'MATCHED_GAME', queueId: 400, gameEnd: 1050 })
    && rp.corpoCriar({ queueId: 420 }) === null && rp.corpoCriar({ gameType: 'X' }) === null && rp.corpoCriar({ gameType: 'X', queueId: null }) === null);
  const m = (meta, cfg = ok(CFG), extra = {}) => rp.modeloReplay({ gid: GID, meta, cfg, ...extra });
  const w = m(ok({ downloadProgress: 100, gameId: GID, state: 'watch' }));
  caso('watch (medido): "assistir replay" pode; baixar some', w.assistir.mostra && w.assistir.ok && !w.baixar.mostra && w.texto === 'replay baixado');
  const d = m(ok({ downloadProgress: 282790429, gameId: GID, state: 'download' }));
  caso('download (medido, progresso com lixo): "baixar replay" pode; assistir some', d.baixar.ok && d.baixar.rotulo === 'baixar replay' && !d.assistir.mostra);
  caso('sem registro (404 medido): "baixar replay" pode (o clique registra e baixa); sem corpo = cinza com motivo',
    m(SEM_REGISTRO).baixar.ok && !m(SEM_REGISTRO, ok(CFG), { temCorpo: false }).baixar.ok && /fila/.test(m(SEM_REGISTRO, ok(CFG), { temCorpo: false }).baixar.motivo));
  const baixando = m(ok({ state: 'downloading', downloadProgress: 42.4 }));
  caso('downloading: cinza com o progresso (só 0–100 vale)', !baixando.baixar.ok && baixando.baixar.rotulo === 'baixando… 42%' && m(ok({ state: 'downloading', downloadProgress: 9e8 })).baixar.rotulo === 'baixando…');
  caso('retryDownload: "baixar de novo" pode', m(ok({ state: 'retryDownload' })).baixar.ok && m(ok({ state: 'retryDownload' })).baixar.rotulo === 'baixar de novo');
  const cinzas = ['checking', 'found', 'incompatible', 'missingOrExpired', 'lost', 'error', 'unsupported', 'inventado'].map(s => m(ok({ state: s })));
  caso('checking/found/incompatible/missingOrExpired/lost/error/unsupported/desconhecido: nada pode, cada um com motivo',
    cinzas.every(x => !x.baixar.ok && !x.assistir.ok && x.baixar.motivo), JSON.stringify(cinzas.map(x => x.baixar.motivo)));
  const em = k => m(ok({ state: 'watch' }), ok({ ...CFG, [k]: true })).assistir;
  caso('assistir cinza com partida rodando, replay aberto, torneio ou client atualizando (configuration)',
    ['isPlayingGame', 'isPlayingReplay', 'isInTournament', 'isPatching'].every(k => em(k).mostra && !em(k).ok && em(k).motivo), em('isPlayingGame').motivo);
  caso('baixar cinza com o client atualizando', !m(ok({ state: 'download' }), ok({ ...CFG, isPatching: true })).baixar.ok && !m(SEM_REGISTRO, ok({ ...CFG, isPatching: true })).baixar.ok);
  caso('replay desligado pela Riot (fim de partida ou histórico): cinza com motivo',
    !m(ok({ state: 'download' }), ok({ ...CFG, isReplaysForEndOfGameEnabled: false })).baixar.ok
    && m(ok({ state: 'download' }), ok({ ...CFG, isReplaysForEndOfGameEnabled: false }), { fim: false }).baixar.ok
    && !m(ok({ state: 'download' }), ok({ ...CFG, isReplaysEnabled: false }), { fim: false }).baixar.ok);
  caso('sem gameId, sem leitura ou leitura com erro: cinza, nunca quebra', !rp.modeloReplay({ gid: null, meta: null }).baixar.ok && !m(null).baixar.ok
    && !m({ ok: false, status: 0, json: null }).baixar.ok && !m({ ok: true, status: 200, json: 'lixo' }).baixar.ok);
}

// ---------- 2. ações e a linha (DOM falso + LCU falsa) ----------
function cenario({ meta = ok({ state: 'download', downloadProgress: 0, gameId: GID }), cfg = CFG, criarStatus = 204, depoisCriar = { state: 'download' }, gid = GID, fim = true, corpo,
  virarEm = 0 } = {}) {
  const est = { meta, agora: 1_000_000, esperas: 0 };
  // espera de 1 s do baixar (checking depois do create) sem relógio de verdade; virarEm = na N-ésima espera a Riot termina de verificar
  const esperar = async () => { est.esperas++; if (virarEm && est.esperas === virarEm) est.meta = ok({ state: 'download' }); };
  const falsa = lcuFalsa({
    [`GET ${R.metadata}`]: () => (est.meta.status && !est.meta.ok ? { status: est.meta.status, json: est.meta.json } : est.meta.json),
    'GET /lol-replays/v1/configuration': () => cfg,
    [`POST ${R.criar}`]: () => { est.meta = ok(depoisCriar); return { status: criarStatus }; },
    [`POST ${R.baixar(true)}`]: () => { est.meta = ok({ state: 'downloading', downloadProgress: 3 }); return { status: 204 }; },
    [`POST ${R.baixar(false)}`]: () => { est.meta = ok({ state: 'downloading', downloadProgress: 3 }); return { status: 204 }; },
    [`POST ${R.assistir}`]: { status: 204 },
  });
  const avisos = [];
  const lcu = (mt, u, c) => lcuReal(mt, u, c, falsa.fetch);
  const linha = rp.criarReplay({ doc, lcu, gameId: () => gid, fim, corpo: () => corpo ?? { gameType: 'RANKED_SOLO_5x5', queueId: 420 },
    avisar: (t, e) => avisos.push([t, !!e]), agora: () => est.agora, esperar });
  return { est, falsa, avisos, linha, b: () => linha.el.q('replay-baixar'), a: () => linha.el.q('replay-assistir'), escritas: () => falsa.escritas().map(c => `${c.metodo} ${c.url}`) };
}

{
  const s = cenario();
  await s.linha.ler(); await tick();
  caso('linha: lê metadata e configuration (só GET); nada escrito sem clique', s.escritas().length === 0 && s.falsa.chamadas.some(c => c.url === R.metadata)
    && s.b().disabled === false && s.b().textContent === 'baixar replay' && s.a().style.display === 'none');
  s.b().click({ isTrusted: false }); await tick();
  caso('baixar: clique sintético (isTrusted false) não baixa', s.escritas().length === 0);
  // revisão de 16/10/2026: chamada sem evento (código, não clique) também não escreve; antes passava (e?.isTrusted === false)
  await s.linha.baixar(); await s.linha.assistir(); await tick();
  caso('baixar/assistir chamados sem evento (sem o clique dele): nada sai', s.escritas().length === 0, JSON.stringify(s.escritas()));
  s.b().click(); await tick(12);
  caso('baixar: clique dele = POST download/graceful {componentType do fim de partida}; linha vira "baixando"',
    igual(s.falsa.escritas().map(c => [c.url, c.corpo]), [[R.baixar(true), { componentType: 'replay-button_end-of-game' }]]) && s.b().disabled === true && /baixando/.test(s.b().textContent)
    && s.avisos.some(([t, e]) => /baixando o replay/i.test(t) && !e), JSON.stringify(s.falsa.escritas()));
  caso('textos (docs/TEXTOS-DA-INTERFACE.md): o aviso do download não justifica o óbvio nem usa "tu"',
    s.avisos.every(([t]) => !/porque|\btu\b|clicou/.test(t)), JSON.stringify(s.avisos));
}
{
  const s = cenario({ meta: SEM_REGISTRO });
  await s.linha.ler(); await tick();
  caso('sem registro: "baixar replay" pode e nada é criado sozinho', s.b().disabled === false && s.escritas().length === 0);
  s.b().click(); await tick(12);
  caso('sem registro: o clique cria (corpo do fim de partida da Riot) e só então baixa',
    igual(s.falsa.escritas().map(c => [c.url, c.corpo]), [[R.criar, { gameVersion: 'unknown_version', gameType: 'RANKED_SOLO_5x5', queueId: 420 }],
      [R.baixar(true), { componentType: 'replay-button_end-of-game' }]]), JSON.stringify(s.falsa.escritas()));
}
{
  const s = cenario({ meta: SEM_REGISTRO, depoisCriar: { state: 'checking' } });
  await s.linha.ler(); s.b().click(); await tick(12);
  caso('registrou e a Riot verifica por mais de 6 s: não baixa, avisa para tentar em segundos (sem erro vermelho)',
    igual(s.escritas(), [`POST ${R.criar}`]) && s.est.esperas === 6 && s.avisos.some(([t, e]) => /verificando/.test(t) && !e), JSON.stringify(s.avisos));
}
{
  const s = cenario({ meta: SEM_REGISTRO, depoisCriar: { state: 'checking' }, virarEm: 3 });
  await s.linha.ler(); s.b().click(); await tick(20);
  caso('registrou e a Riot termina de verificar em ~3 s: o MESMO clique baixa (sem pedir 2º clique)',
    igual(s.escritas(), [`POST ${R.criar}`, `POST ${R.baixar(true)}`]) && s.est.esperas === 3, JSON.stringify({ e: s.escritas(), n: s.est.esperas }));
}
{
  const s = cenario({ meta: SEM_REGISTRO, depoisCriar: { state: 'missingOrExpired' } });
  await s.linha.ler(); s.b().click(); await tick(12);
  caso('registrou e o replay expirou: não baixa, avisa o motivo', igual(s.escritas(), [`POST ${R.criar}`]) && s.avisos.some(([t, e]) => /expirou/.test(t) && e));
}
{
  const s = cenario({ fim: false, corpo: { gameVersion: '16.20.1', gameType: 'MATCHED_GAME', queueId: 400, gameCreation: 1000, gameDuration: 50 } });
  await s.linha.ler(); s.b().click(); await tick(12);
  caso('painel aberto fora do fim de partida: download do histórico (sem graceful, componentType do histórico)',
    igual(s.falsa.escritas().map(c => [c.url, c.corpo]), [[R.baixar(false), { componentType: 'replay-button_match-history' }]]));
}
{
  const s = cenario({ meta: ok({ downloadProgress: 100, gameId: GID, state: 'watch' }) });
  await s.linha.ler(); await tick();
  caso('watch: "assistir replay" à vista e o baixar some', s.a().disabled === false && s.a().textContent === 'assistir replay' && s.b().style.display === 'none');
  s.a().click({ isTrusted: false }); await tick();
  caso('assistir: clique sintético não abre', s.escritas().length === 0);
  // pedido de 15/10/2026 ~12:45: "se eu clicar para assistir o replay, é porque eu já cliquei antes para baixar [...] iniciar o
  // replay de primeira": 1 clique = POST watch, com um aviso curto de que o jogo vai abrir (a Riot minimiza o client)
  s.a().click(); await tick(12);
  caso('assistir: 1 clique dele = POST watch {componentType} (sem 2º clique de confirmação)',
    igual(s.falsa.escritas().map(c => [c.url, c.corpo]), [[R.assistir, { componentType: 'replay-button_end-of-game' }]]), JSON.stringify(s.falsa.escritas()));
  caso('assistir: aviso curto de que o jogo vai abrir, sem pedir 2º clique',
    s.avisos.some(([t, e]) => /jogo/.test(t) && !e) && !s.avisos.some(([t]) => /de novo/.test(t)), JSON.stringify(s.avisos));
  s.est.agora += 200; s.a().click(); await tick(12);
  caso('assistir: clique de reflexo logo depois de abrir não manda o watch de novo', s.escritas().length === 1, JSON.stringify(s.escritas()));
}
{
  const s = cenario({ meta: ok({ state: 'watch' }), }); // o botão nunca vira "clique de novo"
  await s.linha.ler(); await tick();
  caso('assistir: o rótulo é sempre "assistir replay" (nenhum estado armado)', s.a().textContent === 'assistir replay' && !/de novo/.test(s.a().getAttribute('title') || ''));
}
{
  const s = cenario({ meta: ok({ state: 'watch' }), cfg: { ...CFG, isPlayingGame: true } });
  await s.linha.ler(); s.a().click(); await tick();
  caso('assistir com partida rodando: botão cinza com motivo, clique não abre', s.a().disabled === true && /partida rodando/.test(s.a().getAttribute('title')) && s.escritas().length === 0);
}
{
  const s = cenario({ gid: null });
  await s.linha.ler(); s.b().click(); await tick();
  caso('sem gameId: nenhuma leitura de replay nem escrita', !s.falsa.chamadas.some(c => c.url.includes('/lol-replays/v1/metadata')) && s.escritas().length === 0 && s.b().disabled === true);
}

// ---------- 3. painel grande (pengu/posjogo/index.js montarReplay): a linha entra no [data-replay] do topo ----------
{
  // o Pengu serve "./licoes.md?raw" como texto; no node, um hook faz o mesmo (como em teste-compacto-posjogo.mjs)
  const { registerHooks } = await import('node:module');
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  registerHooks({
    resolve(spec, ctx, next) { return spec.endsWith('?raw') ? { url: new URL(spec, ctx.parentURL).href, shortCircuit: true } : next(spec, ctx); },
    load(url, ctx, next) {
      if (!url.endsWith('?raw')) return next(url, ctx);
      return { format: 'module', source: `export default ${JSON.stringify(readFileSync(fileURLToPath(url.split('?')[0]), 'utf8'))};`, shortCircuit: true };
    },
  });
  const pj = await import(pathToFileURL(fileURLToPath(new URL('../pengu/posjogo/index.js', import.meta.url))).href);
  const painel = async ({ fim, meta, gid = GID }) => {
    const est = { meta };
    const falsa = lcuFalsa({
      [`GET ${rp.rotas(gid).metadata}`]: () => est.meta,
      'GET /lol-replays/v1/configuration': CFG,
      [`POST ${rp.rotas(gid).criar}`]: () => { est.meta = { state: 'download' }; return { status: 204 }; },
      [`POST ${rp.rotas(gid).baixar(false)}`]: { status: 204 }, [`POST ${rp.rotas(gid).baixar(true)}`]: { status: 204 } });
    globalThis.fetch = falsa.fetch;
    const slot = new El('span');
    const p = { el: { querySelector: s => (s === '[data-replay]' ? slot : null) } };
    let aberto = true;
    const r = { gameId: gid, criacao: 1791888829931 - 2002000, esta: { versao: '16.20.824.8524', tipo: 'MATCHED_GAME', fila: 400, duracao: 2002 } };
    pj._montarReplay(p, r, () => aberto, fim);
    await tick(10);
    return { p, slot, falsa, fechar: () => { aberto = false; } };
  };
  const a = await painel({ fim: false, meta: { status: 404, json: { message: 'no local metadata' } } });
  const linha = a.slot.childNodes[0];
  caso('painel: a linha do replay entra no [data-replay]; só GET até o clique', !!linha?.q && !!linha.q('replay-baixar') && a.falsa.escritas().length === 0
    && a.falsa.chamadas.some(c => c.url === rp.rotas(GID).metadata));
  linha.q('replay-baixar').click(); await tick(12);
  caso('painel pelo Ctrl+K (fora do fim de partida): registra com os dados do histórico (versão, gameType, fila, gameEnd) e baixa pelo /download',
    igual(a.falsa.escritas().map(c => [c.url, c.corpo]), [[rp.rotas(GID).criar, { gameVersion: '16.20.824.8524', gameType: 'MATCHED_GAME', queueId: 400, gameEnd: 1791888829931 - 2002000 + 2002 }],
      [rp.rotas(GID).baixar(false), { componentType: 'replay-button_match-history' }]]), JSON.stringify(a.falsa.escritas()));
  a.fechar();
  const b = await painel({ fim: true, meta: { state: 'download' } });
  b.slot.childNodes[0].q('replay-baixar').click(); await tick(12);
  caso('painel do fim de partida: baixa pelo /download/graceful', igual(b.falsa.escritas().map(c => c.url), [rp.rotas(GID).baixar(true)]));
  b.fechar();
  const c = await painel({ fim: true, meta: { state: 'download' }, gid: 0 });
  caso('painel sem gameId: nenhuma linha', c.slot.childNodes.length === 0);
}

relatar(casos);
