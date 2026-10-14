// Testa a coleta automática de recompensas (pengu/recompensas.js) com LCU falsa (tools/lcu-falsa.mjs):
// coleta sem escolha, pula escolha real (concessão e marco da trilha), nunca chama rota de gasto, prova antes do
// lote (1 por tipo, confere, depois o resto), um erro não para o resto e avisa uma vez, o gatilho adia fora de
// None/Lobby e o TFT só com a chave. Formato dos grants e da trilha medido no client em 13/10/2026 (só leitura).
// uso: node tools/teste-recompensas.mjs
import { criarLcu, criarRecompensas, classificarConcessao, rotaPermitida, levantar, MAX_FALHAS } from '../pengu/recompensas.js';
import { lcuFalsa, relatar } from './lcu-falsa.mjs';

const item = (id, titulo, fonte = 'cap.wallets') => ({ id, itemId: id, localizations: { title: titulo }, fulfillmentSource: fonte, quantity: 1 });
const grant = (id, status, itens, max = itens.length) => ({
  info: { id, rewardGroupId: 'rg-' + id, status, selectedIds: [] },
  rewardGroup: { id: 'rg-' + id, rewardStrategy: 'SELECTION', rewards: itens, selectionStrategyConfig: { maxSelectionsAllowed: max, minSelectionsAllowed: max } },
});
const semMax = g => ({ ...g, rewardGroup: { ...g.rewardGroup, selectionStrategyConfig: null } });
const novosGrants = () => [
  grant('g1', 'PENDING_SELECTION', [item('r1', '750 Essências Azuis')]),
  grant('g5', 'PENDING_SELECTION', [item('r5', 'Cápsula de Campeão')]), // o servidor falso devolve 500
  grant('g2', 'PENDING_SELECTION', [item('r2a', 'Ícone', 'loot.lootserver'), item('r2b', 'Emote', 'loot.lootserver')]),
  grant('g6', 'PENDING_SELECTION', [item('r6', '250 Essências Azuis')]),
  grant('g3', 'PENDING_SELECTION', [item('r3a', 'Skin A'), item('r3b', 'Skin B'), item('r3c', 'Skin C')], 1), // escolha real
  grant('g4', 'FULFILLED', [item('r4', 'já coletada')]),
  semMax(grant('g7', 'PENDING_SELECTION', [item('r7a', 'Borda X'), item('r7b', 'Borda Y')])), // máximo não informado
];
const marco = (opcoes, selecionada = -1) => ({ state: 'Locked', threshold: '1', progressRequired: 1, rewardTags: [],
  rewardOptions: opcoes.map((n, i) => ({ state: 'Locked', selected: i === selecionada, rewardName: n })) });
const PASSE = [{ info: { passId: 'p1' }, milestones: [{ status: 'REWARDABLE' }, { status: 'ACTIVE' }, { status: 'UPCOMING' }], bonuses: [] }];

// semEfeito: o select responde 204 mas a concessão continua pendente (corpo errado, por exemplo)
function montar({ fase = 'Lobby', tft = false, ligado = true, semEfeito = false } = {}) {
  const estado = { fase, ev1: 2 };
  const grants = novosGrants();
  const select = id => () => {
    if (id === 'g5') return { status: 500, json: { message: 'erro do servidor' } };
    if (!semEfeito) grants.find(g => g.info.id === id).info.status = 'FULFILLED';
    return { status: 204 };
  };
  const falsa = lcuFalsa({
    'GET /lol-gameflow/v1/gameflow-phase': () => estado.fase,
    'GET /lol-rewards/v1/grants': () => (estado.grantsFalha ? { status: 500, json: { message: 'fora' } } : grants),
    ...Object.fromEntries(['g1', 'g2', 'g5', 'g6'].map(id => [`POST /lol-rewards/v1/grants/${id}/select`, select(id)])),
    'GET /lol-event-hub/v1/events': [{ eventId: 'ev1', eventInfo: { eventName: 'Mundial' } }, { eventId: 'ev2', eventInfo: {} },
      { eventId: 'ev3', eventInfo: { eventName: 'Com escolha' } }, { eventId: 'ev4', eventInfo: {} }],
    'GET /lol-event-hub/v1/events/ev1/reward-track/unclaimed-rewards': () => ({ lockedTokensCount: 0, rewardsCount: estado.ev1, timeOfLastUnclaimedReward: 1 }),
    'GET /lol-event-hub/v1/events/ev1/reward-track/items': [marco(['Ícone']), marco(['Skin X', 'Skin Y'], 1)], // escolha já feita
    'GET /lol-event-hub/v1/events/ev1/reward-track/bonus-items': [],
    'GET /lol-event-hub/v1/events/ev2/reward-track/unclaimed-rewards': { lockedTokensCount: 0, rewardsCount: 0, timeOfLastUnclaimedReward: -1 },
    // ev3: marco "escolha 1 de 2" sem opção marcada -> escolher, sem claim-all
    'GET /lol-event-hub/v1/events/ev3/reward-track/unclaimed-rewards': { lockedTokensCount: 0, rewardsCount: 1, timeOfLastUnclaimedReward: 1 },
    'GET /lol-event-hub/v1/events/ev3/reward-track/items': [marco(['Ícone'])],
    'GET /lol-event-hub/v1/events/ev3/reward-track/bonus-items': [marco(['Emote A', 'Emote B'])],
    // ev4: leitura dos marcos falha -> não coleta
    'GET /lol-event-hub/v1/events/ev4/reward-track/unclaimed-rewards': { lockedTokensCount: 0, rewardsCount: 1, timeOfLastUnclaimedReward: 1 },
    'POST /lol-event-hub/v1/events/ev1/reward-track/claim-all': () => { estado.ev1 = 0; return { status: 200, json: {} }; },
    'POST /lol-event-hub/v1/events/ev3/reward-track/claim-all': { status: 200, json: {} },
    'POST /lol-event-hub/v1/events/ev4/reward-track/claim-all': { status: 200, json: {} },
    'GET /lol-tft-pass/v1/active-passes': PASSE,
    'PUT /lol-tft-pass/v1/pass/p1/milestone/claim-all-rewards': { status: 204 },
  });
  const avisos = [], esperas = [], timers = [];
  const cfg = { recompensas: { ligado, tft } };
  const r = criarRecompensas({
    cfg, lcu: criarLcu(falsa.fetch), avisar: (m, erro) => avisos.push((erro ? '[erro] ' : '') + m),
    dormir: async ms => { esperas.push(ms); }, agendar: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, cancelar: () => {},
  });
  const disparar = async () => { const t = timers.shift(); if (t) { t.fn(); await new Promise(res => setTimeout(res, 20)); } return t; };
  return { r, falsa, avisos, esperas, timers, estado, cfg, disparar };
}
const escritas = f => f.escritas().map(c => `${c.metodo} ${c.url}`);
const SEL = id => `POST /lol-rewards/v1/grants/${id}/select`;
const EV1 = 'POST /lol-event-hub/v1/events/ev1/reward-track/claim-all';

const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);

// 1. prova antes do lote, coleta no Lobby
{
  const m = montar();
  const res = await m.r.rodar('teste');
  const w = escritas(m.falsa);
  caso('1ª rodada: só 1 de cada tipo (cap.wallets, loot.lootserver, evento), na ordem', JSON.stringify(w) === JSON.stringify([SEL('g1'), SEL('g2'), EV1]), JSON.stringify(w));
  const g2 = m.falsa.chamadas.find(c => c.url.endsWith('/g2/select'));
  caso('corpo do select = {rewardGroupId, selections: todos os itens}', JSON.stringify(g2?.corpo) === JSON.stringify({ rewardGroupId: 'rg-g2', selections: ['r2a', 'r2b'] }), JSON.stringify(g2?.corpo));
  caso('toast conta 4 (evento conta 2) e diz que as outras 2 vêm depois', m.avisos.includes('4 recompensas coletadas (1ª de cada tipo; as outras 2 depois da próxima partida)'), JSON.stringify(m.avisos));
  caso('escolha real (1 de 3) não é coletada', !w.some(u => u.includes('/g3/')));
  caso('concessão já FULFILLED não é tocada', !w.some(u => u.includes('/g4/')));
  const lev = await levantar(criarLcu(m.falsa.fetch), m.cfg); // só GET
  const rotulos = lev.escolher.map(e => e.rotulo);
  caso('aviso único das 3 escolhas (g3, g7, ev3)', m.avisos.includes('3 recompensas para escolher (veja no client)') && rotulos.length === 3, JSON.stringify([m.avisos, rotulos]));
  caso('concessão sem maxSelectionsAllowed vira escolha (não coleta)', !w.some(u => u.includes('/g7/')) && rotulos.some(a => a.includes('máximo de seleções não informado')), JSON.stringify(rotulos));
  caso('trilha com marco de escolha sem opção marcada: sem claim-all, vira escolha', !w.some(u => u.includes('/ev3/')) && rotulos.some(a => a.includes('Emote A ou Emote B')), JSON.stringify(rotulos));
  caso('trilha sem leitura dos marcos vai para pulados com o motivo', lev.pulados.some(p => p.id === 'ev4' && /marcos da trilha/.test(p.motivo)), JSON.stringify(lev.pulados));
  caso('trilha cujos marcos não deu para ler: sem claim-all', !w.some(u => u.includes('/ev4/')));
  caso('marco de escolha já feita (opção marcada) não segura o claim-all', w.includes(EV1));
  caso('uma por vez com ≥ 300 ms entre elas', m.esperas.length === 2 && m.esperas.every(ms => ms >= 300), JSON.stringify(m.esperas));
  caso('TFT desligado: nem lê o passe', !m.falsa.chamadas.some(c => c.url.includes('tft')));
  caso('1ª rodada sem falha', res.falhas === 0 && res.esperando === 2, JSON.stringify(res));

  // 2ª rodada: as amostras sumiram da leitura -> tipos liberados -> o resto vai; g5 falha e não para o g6.
  // A trilha ev1 ganhou prêmio novo com a partida: não é "amostra sem efeito", o claim-all sai de novo
  let de = m.avisos.length, deW = w.length;
  m.estado.ev1 = 1;
  const res2 = await m.r.rodar('2');
  const w2 = escritas(m.falsa).slice(deW);
  caso('2ª rodada: tipos conferidos, vai o resto (g5 falha, g6 depois dela)', JSON.stringify(w2) === JSON.stringify([SEL('g5'), SEL('g6'), EV1]) && res2.falhas === 1, JSON.stringify([w2, res2]));
  caso('trilha com prêmio novo depois da partida não trava o tipo evento', res2.travados === 0 && !m.avisos.some(a => a.includes('não teve efeito')), JSON.stringify([res2, m.avisos]));
  caso('2ª rodada: estado dos tipos liberado', JSON.stringify(m.r.estado().grupos) === JSON.stringify({ 'concessão:cap.wallets': 'liberado', 'concessão:loot.lootserver': 'liberado', evento: 'liberado' }), JSON.stringify(m.r.estado().grupos));
  caso('toast de falha na 1ª vez', m.avisos.slice(de).some(a => a.startsWith('[erro] 1 recompensa')), JSON.stringify(m.avisos.slice(de)));
  caso('2ª rodada não repete o aviso da mesma escolha', !m.avisos.slice(de).some(a => a.includes('para escolher')), JSON.stringify(m.avisos.slice(de)));

  // a mesma falha de novo: sem toast; depois de MAX_FALHAS, nem tenta
  de = m.avisos.length;
  for (let i = 2; i <= MAX_FALHAS; i++) await m.r.rodar(String(i + 1));
  caso('falha repetida não repete o toast vermelho', !m.avisos.slice(de).some(a => a.startsWith('[erro]')), JSON.stringify(m.avisos.slice(de)));
  deW = escritas(m.falsa).length;
  await m.r.rodar('depois do limite');
  caso(`depois de ${MAX_FALHAS} falhas a recompensa sai da fila da sessão`, !escritas(m.falsa).slice(deW).includes(SEL('g5')), JSON.stringify(escritas(m.falsa).slice(deW)));
  caso('toda escrita está na lista de coleta', m.falsa.escritas().every(c => rotaPermitida(c.metodo, c.url)));
}

// 2. amostra que responde ok mas não tem efeito: trava o tipo, avisa, não manda o lote
{
  const m = montar({ semEfeito: true });
  await m.r.rodar('1');
  const deW = escritas(m.falsa).length;
  await m.r.rodar('2');
  const w2 = escritas(m.falsa).slice(deW);
  caso('amostra sem efeito: o tipo trava e o lote dele não sai', !w2.some(u => u.includes('/lol-rewards/')) && m.r.estado().grupos['concessão:cap.wallets'] === 'travado', JSON.stringify([w2, m.r.estado().grupos]));
  caso('amostra sem efeito: avisa em vermelho', m.avisos.some(a => a.startsWith('[erro] coleta de recompensas (concessão:cap.wallets) não teve efeito')), JSON.stringify(m.avisos));
}

// 2b. leitura das concessões falha na rodada de conferência: a amostra não vira "liberada" (falha fechada)
{
  const m = montar();
  await m.r.rodar('1'); // amostras g1 e g2
  m.estado.grantsFalha = true;
  let deW = escritas(m.falsa).length;
  await m.r.rodar('2');
  const w2 = escritas(m.falsa).slice(deW);
  const g = m.r.estado().grupos;
  caso('grants 500 na conferência: tipos seguem em amostra e nenhum select sai', !w2.some(u => u.includes('/lol-rewards/'))
    && g['concessão:cap.wallets'] === 'amostra' && g['concessão:loot.lootserver'] === 'amostra', JSON.stringify([w2, g]));
  m.estado.grantsFalha = false;
  deW = escritas(m.falsa).length;
  await m.r.rodar('3');
  const w3 = escritas(m.falsa).slice(deW);
  caso('leitura boa depois: confere e manda o resto', JSON.stringify(w3) === JSON.stringify([SEL('g5'), SEL('g6')]) && m.r.estado().grupos['concessão:cap.wallets'] === 'liberado', JSON.stringify([w3, m.r.estado().grupos]));
}

// 3. rotas de gasto recusadas antes do fetch
{
  const f = lcuFalsa({});
  const lcu = criarLcu(f.fetch);
  const gasto = [['POST', '/lol-loot/v1/recipes/CHEST_128_OPEN/craft'], ['POST', '/lol-loot/v1/craft/mass'],
    ['POST', '/lol-event-hub/v1/token-shop/purchase'], ['POST', '/lol-purchase-widget/v1/purchaseItems'],
    ['POST', '/lol-loot/v1/player-loot/CHEST_128/context-menu'], ['PUT', '/lol-missions/v1/player/m1']];
  let recusadas = 0;
  for (const [m, u] of gasto) { try { await lcu(m, u, {}); } catch { recusadas++; } }
  caso('rotas de gasto (baú, criação, loja de fichas, compra) recusadas sem chegar à LCU', recusadas === gasto.length && f.chamadas.length === 0, `${recusadas}/${gasto.length}, ${f.chamadas.length} chamadas`);
}

// 4. gatilhos
{
  const m = montar({ fase: 'InProgress' });
  await m.r.aoCarregar();
  caso('carga no meio da partida: adia, nada coletado', m.falsa.escritas().length === 0 && m.r.estado().devendo);
  m.r.aoFase('InProgress');
  m.r.aoFase('EndOfGame');
  m.estado.fase = 'Lobby';
  m.r.aoFase('Lobby');
  caso('EndOfGame -> Lobby agenda em 30 s', m.timers.length === 1 && m.timers[0].ms === 30000, JSON.stringify(m.timers.map(t => t.ms)));
  m.r.aoFase('Lobby');
  caso('evento repetido de Lobby não reagenda', m.timers.length === 1);
  m.estado.fase = 'Matchmaking'; // jogar de novo: já está na fila quando o relógio dispara
  await m.disparar();
  caso('na hora de coletar relê a fase: Matchmaking adia', m.falsa.escritas().length === 0 && m.r.estado().devendo);
  m.r.aoFase('Matchmaking'); m.r.aoFase('ReadyCheck'); m.r.aoFase('ChampSelect'); m.r.aoFase('InProgress'); m.r.aoFase('EndOfGame');
  m.estado.fase = 'None';
  m.r.aoFase('None');
  caso('próxima ida a None agenda de novo', m.timers.length === 1);
  await m.disparar();
  caso('e aí coleta (1 de cada tipo)', escritas(m.falsa).length === 3, JSON.stringify(escritas(m.falsa)));
}
{
  const m = montar();
  m.r.aoFase('EndOfGame'); m.r.aoFase('Lobby');
  m.estado.fase = 'ChampSelect';
  m.r.aoFase('Matchmaking');
  caso('sair de Lobby/None antes dos 30 s desarma o relógio e deixa devendo', m.r.estado().devendo === true);
}
{
  const m = montar({ tft: true });
  await m.r.rodar('tft');
  caso('TFT com a chave: PUT claim-all-rewards do passe', escritas(m.falsa).includes('PUT /lol-tft-pass/v1/pass/p1/milestone/claim-all-rewards'));
}
{
  const m = montar({ ligado: false });
  const res = await m.r.rodar('desligado');
  caso('chave geral desligada: nem lê', res.status === 'desligado' && m.falsa.chamadas.length === 0);
}
{
  const m = montar();
  const [a, b] = await Promise.all([m.r.rodar('1'), m.r.rodar('2')]);
  caso('duas ao mesmo tempo: a 2ª fica de fora (uma coleta por vez)', a.status === 'feito' && b.status === 'ocupado', `${a.status} ${b.status}`);
}
{
  const G = novosGrants();
  caso('classificar: 2 de 2 coleta, 1 de 3 pede escolha, sem máximo pede escolha',
    classificarConcessao(G[2]).tipo === 'coletar' && classificarConcessao(G[4]).tipo === 'escolher' && classificarConcessao(G[6]).tipo === 'escolher');
  caso('classificar: grupo pelo tipo de entrega', classificarConcessao(G[2]).grupo === 'concessão:loot.lootserver' && classificarConcessao(G[0]).grupo === 'concessão:cap.wallets');
}
// paridade com o expandido (plano do compacto, passo 11 b3): com a camada compacta à vista os avisos da coleta saem
// dentro dela (compacto/comum.js avisar), não no Toast que pode ficar embaixo; sem ela, no Toast como antes
{
  const { iniciarRecompensas } = await import('../pengu/recompensas.js');
  const novoEl = () => { const e = { filhos: [], dataset: {}, style: {}, className: '', id: '', _t: '', pai: null,
    append(...ns) { for (const n of ns) { if (n && typeof n === 'object') n.pai = e; e.filhos.push(n); } }, appendChild(n) { e.append(n); return n; },
    remove() { if (e.pai) e.pai.filhos.splice(e.pai.filhos.indexOf(e), 1); e.pai = null; }, addEventListener() {}, setAttribute() {},
    querySelector: sel => e.filhos.find(f => typeof f === 'object' && String(f.className).split(' ').includes(sel.slice(1))) || null,
    get textContent() { return e._t + e.filhos.map(f => (typeof f === 'object' ? f.textContent : String(f))).join(''); }, set textContent(v) { e._t = String(v); e.filhos = []; } };
    return e; };
  const rodada = async comCamada => {
    const m = montar();
    const camada = novoEl(); camada.id = 'lc-compacto';
    const toasts = [];
    const antes = { document: globalThis.document, fetch: globalThis.fetch, Toast: globalThis.Toast };
    globalThis.document = { createElement: () => novoEl(), getElementById: id => (comCamada && id === 'lc-compacto' ? camada : null) };
    globalThis.fetch = m.falsa.fetch;
    globalThis.Toast = { success: t => toasts.push(t), error: t => toasts.push('[erro] ' + t) };
    const timeoutOriginal = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...a) => (ms >= 5000 ? 0 : timeoutOriginal(fn, ms, ...a)); // a coleta da carga (5 s) não roda aqui
    try {
      const r = iniciarRecompensas({ socket: { observe() {} } }, m.cfg);
      await r.rodar('teste');
    } finally { globalThis.setTimeout = timeoutOriginal; Object.assign(globalThis, antes); }
    return { camada: camada.filhos.map(f => f.textContent), toasts };
  };
  const a = await rodada(true);
  caso('b3: camada à vista: avisos da coleta dentro do #lc-compacto, nenhum Toast', a.camada.length === 1 && /recompensa/.test(a.camada[0]) && a.toasts.length === 0, JSON.stringify(a));
  const b = await rodada(false);
  caso('b3: client normal: avisos da coleta no Toast, como antes', b.toasts.some(t => /para escolher/.test(t)) && b.camada.length === 0, JSON.stringify(b));
}

relatar(casos);
