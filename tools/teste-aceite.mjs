// Testa o aceite automático (pengu/aceite.js): a decisão pura, o foco devolvido no ReadyCheck (criarFoco, com
// relógio e LCU falsos) e o embrulho do som (embrulharAudio, com rcp-fe-audio falso). uso: node tools/teste-aceite.mjs
import { decidir, criarFoco, embrulharAudio, iniciarAceite, CLASSE_POPUP_LIVRE, FOCO } from '../pengu/aceite.js';
import { lcuFalsa } from './lcu-falsa.mjs';

const cfg = { ligado: true, atrasoS: 10, limiteS: 12 };
const rc = (timer, playerResponse = 'None', state = 'InProgress') => ({ state, playerResponse, timer, declinerIds: [], dodgeWarning: 'None', suppressUx: false });

const casos = [
  ['sem ready-check', decidir(null, cfg), d => d.acao === 'parar'],
  ['InProgress/None t=0 agenda ~10 s', decidir(rc(0), cfg), d => d.acao === 'esperar' && Math.abs(d.emS - 10) < 0.01],
  ['t=11 aceita já', decidir(rc(11), cfg), d => d.acao === 'aceitar'],
  ['Accepted cancela', decidir(rc(3, 'Accepted'), cfg), d => d.acao === 'parar'],
  ['Declined cancela', decidir(rc(3, 'Declined'), cfg), d => d.acao === 'parar'],
];
// extras: a janela corta o atraso (limite - 2) e o desligado não age
const extras = [
  ['atraso 15 vira 10 pelo limite 12', decidir(rc(0), { ...cfg, atrasoS: 15 }), d => d.acao === 'esperar' && d.emS === 10],
  ['desligado não age', decidir(rc(0), { ...cfg, ligado: false }), d => d.acao === 'parar'],
];

// ---- foco ----
// roteiro: lista de [ms, evento] com evento 'foco' | 'blur' | fase; devolve as chamadas à LCU
function rodarFoco(roteiro, aceite = {}, focoInicial = true) {
  let t = 0;
  const pend = [], chamadas = [];
  const f = criarFoco({
    cfg: { aceite: { ligado: true, trazerClient: false, ...aceite } },
    lcu: (m, u) => { chamadas.push(`${m} ${u}`); return Promise.resolve({ ok: true }); },
    agora: () => t, agendar: fn => { pend.push(fn); return pend.length; }, focoInicial,
  });
  for (const [ms, ev] of roteiro) {
    t = ms;
    if (ev === 'foco') f.aoFoco(); else if (ev === 'blur') f.aoBlur();
    else if (ev === 'sonda1' || ev === 'sonda0') f.sondar(ev === 'sonda1'); // document.hasFocus() lido pela sonda
    else f.aoFase(ev);
    while (pend.length) pend.shift()(); // o atraso de 100 ms do minimizar
  }
  return chamadas;
}
const MIN = 'POST /riotclient/ux-minimize', SHOW = 'POST /riotclient/ux-show';
const so = (ch, ...esperado) => JSON.stringify(ch) === JSON.stringify(esperado);
const foco = [
  ['estava em outra janela: focus 60 ms depois da fase -> minimiza',
    rodarFoco([[0, 'blur'], [30000, 'ReadyCheck'], [30060, 'foco']]), ch => so(ch, MIN)],
  ['focus 200 ms ANTES do evento da fase (sonda de 13/10) -> minimiza',
    rodarFoco([[0, 'blur'], [29800, 'foco'], [30000, 'ReadyCheck']]), ch => so(ch, MIN)],
  ['já estava no client (foco desde antes) -> nada',
    rodarFoco([[0, 'foco'], [30000, 'ReadyCheck']], {}, false), ch => so(ch)],
  ['foco inicial da página, nenhum evento -> nada',
    rodarFoco([[30000, 'ReadyCheck']]), ch => so(ch)],
  ['trazerClient ligado -> não minimiza',
    rodarFoco([[0, 'blur'], [30000, 'ReadyCheck'], [30060, 'foco']], { trazerClient: true }), ch => so(ch)],
  ['aceite automático desligado -> não minimiza',
    rodarFoco([[0, 'blur'], [30000, 'ReadyCheck'], [30060, 'foco']], { ligado: false }), ch => so(ch)],
  [`focus tarde (> ${FOCO.janelaMs} ms, foi ele clicando) -> nada`,
    rodarFoco([[0, 'blur'], [30000, 'ReadyCheck'], [30000 + FOCO.janelaMs + 500, 'foco']]), ch => so(ch)],
  ['minimizou e chegou ao ChampSelect -> ux-show',
    rodarFoco([[0, 'blur'], [30000, 'ReadyCheck'], [30060, 'foco'], [31000, 'blur'], [42000, 'ChampSelect']]), ch => so(ch, MIN, SHOW)],
  ['ChampSelect sem ter minimizado -> sem ux-show',
    rodarFoco([[0, 'foco'], [30000, 'ReadyCheck'], [42000, 'ChampSelect']], {}, false), ch => so(ch)],
  ['ready-check recusado por terceiro e outro em seguida: minimiza nos dois, um ux-show',
    rodarFoco([[0, 'blur'], [30000, 'ReadyCheck'], [30060, 'foco'], [30200, 'blur'], [43000, 'Matchmaking'], [60000, 'ReadyCheck'],
      [60050, 'foco'], [60200, 'blur'], [72000, 'ChampSelect']]), ch => so(ch, MIN, MIN, SHOW)],
  ['evento ReadyCheck repetido (focus antes da fase) não minimiza 2 vezes',
    rodarFoco([[0, 'blur'], [29800, 'foco'], [30000, 'ReadyCheck'], [30100, 'ReadyCheck']]), ch => so(ch, MIN)],
  ['saiu da fila (Lobby) depois de minimizar: ChampSelect seguinte não chama ux-show',
    rodarFoco([[0, 'blur'], [30000, 'ReadyCheck'], [30060, 'foco'], [30200, 'blur'], [40000, 'Lobby'], [90000, 'foco'], [95000, 'ChampSelect']]), ch => so(ch, MIN)],
  // foco no iframe do chat: sair para outro app e o roubo nativo não disparam blur/focus na janela de cima; só a sonda vê
  ['iframe do chat: sonda vê a saída e o roubo antes da fase -> minimiza',
    rodarFoco([[5000, 'sonda0'], [29900, 'sonda1'], [30000, 'ReadyCheck']]), ch => so(ch, MIN)],
  ['iframe do chat: sonda vê o roubo 200 ms depois da fase -> minimiza',
    rodarFoco([[5000, 'sonda0'], [30000, 'ReadyCheck'], [30200, 'sonda1']]), ch => so(ch, MIN)],
  ['iframe do chat com ele no client o tempo todo (sonda sempre true) -> nada',
    rodarFoco([[5000, 'sonda1'], [29750, 'sonda1'], [30000, 'ReadyCheck'], [30250, 'sonda1']]), ch => so(ch)],
  ['sonda e evento focus juntos não minimizam 2 vezes',
    rodarFoco([[5000, 'sonda0'], [30000, 'ReadyCheck'], [30060, 'foco'], [30250, 'sonda1']]), ch => so(ch, MIN)],
];

// ---- som ----
const LOOP = '/fe/lol-static-assets/sounds/sfx-readycheck-ringmagic-accepted-loop.ogg';
const CONTAGEM = '/fe/lol-static-assets/sounds/sfx-readycheck-ringmagic-countdown.ogg';
function audioFalso() {
  const canais = new Map(['sfx-ui', 'sfx-notifications'].map(n => [n, {
    nome: n,
    createSound(url, opts) { return { url, opts, tocou: 0, play() { this.tocou++; return Promise.resolve(this); }, isPlaying() { return this.tocou > 0; }, stop() {} }; },
  }]));
  return { getChannel(n) { return canais.get(n) || false; } };
}
let calar = true;
const api = audioFalso();
const antes = api.getChannel('sfx-ui'); // o componente pode ter guardado o canal antes do embrulho
embrulharAudio(api, () => calar);
const getChannel1 = api.getChannel, createSound1 = antes.createSound;
embrulharAudio(api, () => calar); // 2ª vez (postInit + whenReady): não embrulha de novo
const naoDuplicou = api.getChannel === getChannel1 && antes.createSound === createSound1;
const loop = api.getChannel('sfx-ui').createSound(LOOP, { isLoop: true });
const loopAntes = antes.createSound(LOOP, { isLoop: true });
const contagem = api.getChannel('sfx-ui').createSound(CONTAGEM);
const ret = loop.play();
loopAntes.play();
contagem.play();
const mudoComChave = loop.tocou === 0 && loopAntes.tocou === 0 && ret instanceof Promise;
calar = false;
loop.play();
const voltaSemChave = loop.tocou === 1;
const api2 = { getChannel: () => ({ createSound: () => null }) };
let semErro = true;
try { embrulharAudio(api2, () => true); semErro = api2.getChannel('sfx-ui').createSound(LOOP) === null; } catch { semErro = false; }
const som = [
  ['loop pós-aceite mudo com a chave (play devolve Promise)', mudoComChave],
  ['canal guardado antes do embrulho também fica mudo', loopAntes.tocou === 0],
  ['embrulhar 2 vezes não embrulha de novo (getChannel e createSound iguais)', naoDuplicou],
  ['contagem (outro som) toca normal', contagem.tocou === 1],
  ['chave desligada na hora: o mesmo som volta a tocar', voltaSemChave],
  ['isPlaying/stop passam para o som original', loop.isPlaying() === true && typeof loop.stop === 'function'],
  ['createSound que devolve null não quebra', semErro],
  ['api sem getChannel: embrulho recusa calado', embrulharAudio({}, () => true) === false],
];

// ---- popup nativo escondido (esconderPopup): "não aceitar" e accept que falhou devolvem o popup ----
// DOM, window, Toast e LCU falsos; nenhuma chamada sai para o client de verdade
const classesHtml = new Set(), dom = new Map(), toasts = [];
const elFalso = () => ({ id: '', innerHTML: '', ouvintes: [], querySelector: () => ({ textContent: '' }),
  addEventListener(t, fn) { this.ouvintes.push(fn); }, remove() { dom.delete(this.id); } });
globalThis.document = {
  hasFocus: () => true,
  documentElement: { classList: { toggle(n, v) { if (v) classesHtml.add(n); else classesHtml.delete(n); } } },
  body: { appendChild(el) { dom.set(el.id, el); } },
  getElementById: id => dom.get(id) ?? null,
  createElement: elFalso,
};
globalThis.window = { addEventListener() {} };
globalThis.Toast = { error: m => toasts.push(m), success() {} };
const tique = () => new Promise(r => setTimeout(r, 20));
async function rodarPopup({ timer, aceiteStatus = 204, clicar }) {
  classesHtml.clear(); toasts.length = 0;
  const falsa = lcuFalsa({
    'GET /lol-matchmaking/v1/ready-check': rc(timer),
    'POST /lol-matchmaking/v1/ready-check/accept': { status: aceiteStatus },
  });
  globalThis.fetch = falsa.fetch;
  const obs = {};
  iniciarAceite({ socket: { observe: (rota, fn) => { obs[rota] = fn; } } }, { aceite: { ligado: true, atrasoS: 10, limiteS: 12, esconderPopup: true } });
  const evento = data => obs['/lol-matchmaking/v1/ready-check'](data ? { eventType: 'Update', data } : { eventType: 'Delete' });
  evento(rc(timer));
  if (clicar) dom.get('lc-aceite')?.ouvintes[0]({ target: { closest: () => ({ dataset: { a: clicar } }) } });
  await tique();
  const durante = classesHtml.has(CLASSE_POPUP_LIVRE);
  evento(null); // o ready check acabou
  return { durante, depois: classesHtml.has(CLASSE_POPUP_LIVRE), escritas: falsa.escritas().map(c => c.url), toasts: [...toasts] };
}
const pNao = await rodarPopup({ timer: 0, clicar: 'desligar' });
const pFalha = await rodarPopup({ timer: 11, aceiteStatus: 500 });
const pOk = await rodarPopup({ timer: 11 });
const popup = [
  ['"não aceitar": popup nativo volta (classe manual) e nada é aceito', pNao.durante && pNao.escritas.length === 0, JSON.stringify(pNao)],
  ['fim do ready check: a classe sai (próximo popup escondido de novo)', !pNao.depois && !pFalha.depois, JSON.stringify([pNao, pFalha])],
  ['accept que falhou (500): popup volta e avisa', pFalha.durante && pFalha.escritas.length === 1 && pFalha.toasts.length === 1, JSON.stringify(pFalha)],
  ['accept que deu certo: popup segue escondido, sem aviso', !pOk.durante && pOk.escritas.length === 1 && pOk.toasts.length === 0, JSON.stringify(pOk)],
];

let ok = 0, total = 0;
const linha = (nome, passou, extra = '') => { total++; ok += !!passou; console.log(passou ? 'ok' : 'FALHOU', nome, passou ? '' : extra); };
for (const [nome, d, conf] of casos) linha(nome, conf(d), JSON.stringify(d));
for (const [nome, d, conf] of extras) linha('(extra) ' + nome, conf(d), JSON.stringify(d));
for (const [nome, ch, conf] of foco) linha('(foco) ' + nome, conf(ch), JSON.stringify(ch));
for (const [nome, passou] of som) linha('(som) ' + nome, passou);
for (const [nome, passou, extra] of popup) linha('(popup) ' + nome, passou, extra);
console.log(`${ok}/${total} ok`);
process.exit(ok === total ? 0 : 1);
