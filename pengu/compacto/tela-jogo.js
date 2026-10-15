// Tela do client compacto durante a partida (roadmap/2026-10-13-client-compacto.md, passo 14). Relato do Gabriel de
// 14/10/2026 ~20:50: "O modo compacto sai assim que a partida inicia, na tela de partida em andamento, corrija." Até aqui
// GameStart/InProgress tiravam a camada (o client voltava a 1280 atrás do jogo) e Reconnect expandia. Contrato das telas:
// pengu/compacto/index.js. Fases: GameStart, InProgress e Reconnect (mesma tela; atualizar troca o miolo pela fase).
// - mostra: campeão (foto + nome), fila, tempo de jogo e placar do time (abates por time, o mesmo número do HUD da Riot);
//   nada de inimigo na fog, item, ouro ou "visto há": só o que a tela da Riot já mostra;
// - fontes, nesta ordem: GET 127.0.0.1:8765/estado do coletor (ao_vivo.EstadoPartida, que lê a Live Client na 2999:
//   fase "carregando", gt, jogadores[].aliado/k, euJogador.campeao); sem coletor, campeão pela sessão do gameflow
//   (playerChampionSelections/teamOne/teamTwo casado com o puuid do current-summoner [S]; o puuid nunca vai para a tela nem
//   para o log) e relógio local desde o GameStart, rotulado "desde o carregamento" (inclui os ~99 s da tela de
//   carregamento: ARMADILHAS § Live Client), nunca "tempo de jogo";
// - Reconnect: RECONECTAR = POST /lol-gameflow/v1/reconnect sem corpo (o _performReconnect do rcp-fe-lol-navigation 16.20),
//   só clique de verdade (isTrusted), um por vez, cinza até a fase mudar; falha = motivo + "abrir no client normal". O "sair"
//   da Riot (early-exit, spectate/quit) não existe aqui;
// - nada nesta tela mexe na janela nem no foco: quem decide tamanho é o roteador (index.js podeMexer).
// Importável no node (tools/teste-compacto-jogo.mjs).
import { h, estilo, campeoes, fotoCampeao } from './comum.js';
import { infoDaPartida, nomeFila } from './tela-posjogo.js';

export const ESTADO_CADA_MS = 2000; // GET /estado do coletor
export const TIQUE_MS = 1000; // relógio local da tela (só o texto)
export const COLETOR_VELHO_MS = 8000; // leitura do coletor mais velha que isso não vale (tempo e placar somem para a reserva)
// o tempo do coletor anda pelo relógio entre leituras a partir de quando o COLETOR leu a Live Client (atualizadoMs), no máximo
// isso: partida pausada (personalizada, treino) não anda mais que alguns segundos e depois volta (revisão adversarial, achado 8)
export const PROJECAO_MAX_MS = 4000;
export const RECONECTA_MS = 20000; // RECONECTAR ok e a fase não saiu do Reconnect nesse prazo: o botão volta
export const ROTA_RECONECTAR = '/lol-gameflow/v1/reconnect';
export const _relogio = { agora: () => Date.now() }; // injetável (teste)

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const dois = n => String(Math.floor(n)).padStart(2, '0');
export const mmss = s => { const t = Math.max(0, Math.floor(Number(s) || 0)); return `${dois(t / 60)}:${dois(t % 60)}`; };

// /estado do coletor -> {gt, carregando, placar: {nosso, deles} | null, campeao} | null. Só tempo, abates por time e o meu
// campeão (KDA é global na Live Client: ARMADILHAS); gameId diferente do desta partida = leitura de outra partida, não vale
export function lerEstadoColetor(d, gameId = null) {
  if (!d || typeof d !== 'object' || d.partida !== true) return null;
  if (gameId && num(d.gameId) && num(d.gameId) !== Number(gameId)) return null;
  const gt = num(d.gt);
  let placar = null;
  if (Array.isArray(d.jogadores) && d.jogadores.length) {
    let nosso = 0, deles = 0, ok = true;
    for (const j of d.jogadores) {
      const k = num(j?.k);
      if (k === null || typeof j?.aliado !== 'boolean') { ok = false; break; }
      if (j.aliado) nosso += k; else deles += k;
    }
    if (ok) placar = { nosso, deles };
  }
  const c = num(d.euJogador?.campeao);
  const em = num(d.atualizadoMs); // quando o coletor leu a Live Client (ms epoch, mesmo relógio da máquina)
  return { gt: gt !== null && gt >= 0 ? gt : null, carregando: d.fase === 'carregando', placar, campeao: c > 0 ? c : null, em: em > 0 ? em : null };
}

// ms desde a leitura do coletor: pela hora dele (atualizadoMs) quando veio e não está no futuro (+1 s de folga), senão pela
// hora em que a tela leu (lidoEm)
export function idadeColetor(coletor, lidoEm, agora) {
  const base = coletor?.em && coletor.em <= agora + 1000 ? coletor.em : lidoEm;
  return agora - base;
}

// sessão do gameflow + meu puuid -> championId | null. Formato do playerChampionSelections [S] (vetor de objeto sem tipo no
// /help): procura o puuid nas três listas e só aceita championId > 0
export function meuCampeao(sessao, puuid) {
  const gd = sessao?.gameData;
  if (!gd || typeof gd !== 'object' || typeof puuid !== 'string' || !puuid) return null;
  for (const lista of [gd.playerChampionSelections, gd.teamOne, gd.teamTwo]) {
    if (!Array.isArray(lista)) continue;
    const x = lista.find(p => p && typeof p === 'object' && p.puuid === puuid && num(p.championId) > 0);
    if (x) return Number(x.championId);
  }
  return null;
}

// tempo que a tela mostra -> {texto, rotulo, fonte}. coletor: lerEstadoColetor; lidoEm: quando chegou; inicio: GameStart local
export function textoTempo({ coletor = null, lidoEm = 0, agora, inicio = null }) {
  const idade = coletor ? idadeColetor(coletor, lidoEm, agora) : Infinity;
  if (coletor && idade <= COLETOR_VELHO_MS) {
    if (coletor.carregando) return { texto: 'carregando', rotulo: 'tela de carregamento do jogo', fonte: 'coletor' };
    if (coletor.gt !== null) return { texto: mmss(coletor.gt + Math.min(PROJECAO_MAX_MS, Math.max(0, idade)) / 1000), rotulo: 'tempo de jogo', fonte: 'coletor' };
  }
  if (inicio) return { texto: mmss((agora - inicio) / 1000), rotulo: 'desde o carregamento (relógio do client)', fonte: 'local' };
  return { texto: '–', rotulo: 'sem o relógio da partida', fonte: null };
}

// relógio local desde o GameStart, por partida (sobrevive a expandir e compactar de novo: a tela remonta)
let inicioJogo = null; // {em, gameId, anterior}
export const _zerarInicio = () => { inicioJogo = null; }; // só teste
// GameStart dura ~50 ms: montar e atualizar na mesma virada não zeram; o GameStart da partida seguinte (minutos depois) zera.
// Reconectar pode passar por GameStart de novo na MESMA partida [S] (revisão adversarial, achado 7): com o gameId já sabido
// (atualizar com a sessão lida) não zera; sem ele (tela remontada), guarda o início de antes em `anterior` e o devolve se a
// sessão lida depois for da mesma partida
function marcarInicio(fase, agora, gameId = null) {
  if (fase !== 'GameStart') return;
  if (inicioJogo && (agora - inicioJogo.em <= 60000 || (gameId && inicioJogo.gameId === gameId))) return;
  const anterior = inicioJogo?.gameId ? { em: inicioJogo.em, gameId: inicioJogo.gameId } : null;
  inicioJogo = { em: agora, gameId: gameId || null, anterior };
}
function inicioDe(gameId) {
  if (!inicioJogo) return null;
  if (gameId && inicioJogo.gameId === null) {
    if (inicioJogo.anterior?.gameId === gameId) inicioJogo = { ...inicioJogo.anterior, anterior: null }; // reconectou: segue o de antes
    else inicioJogo.gameId = gameId;
  }
  if (gameId && inicioJogo.gameId !== gameId) return null; // GameStart de outra partida (plugin recarregado no meio)
  return inicioJogo.em;
}

let atual = null;
const escondida = s => { try { return (s.raiz.ownerDocument || s.raiz.doc || globalThis.document)?.visibilityState === 'hidden'; } catch { return false; } };

export function montar(raiz, ctx) {
  estilo('lc-cp-jogo-estilo', CSS_JOGO, raiz.ownerDocument || raiz.doc || globalThis.document);
  raiz.classList?.add('lc-cp-jg');
  const doc = raiz.ownerDocument || raiz.doc || globalThis.document;
  const el = (tag, attrs = {}, ...f) => h(tag, { doc, ...attrs }, ...f);
  const s = atual = { ctx, raiz, el, info: null, campeao: null, nome: '', puuid: null, coletor: null, lidoEm: 0, coletorFora: false,
    reconectando: false, reconectaEm: 0, faseVista: null, refs: {}, lendoSessao: false };
  marcarInicio(ctx.fase, _relogio.agora());
  esqueleto(s);
  pintar(s);
  lerSessao(s).catch(() => {});
  campeoes().then(ctx.seguro(cat => { s.cat = cat; pintarCampeao(s); })).catch(() => {});
  ctx.observar('/lol-gameflow/v1/session', msg => { if (msg?.eventType !== 'Delete' && msg?.data) aoSessao(s, msg.data); });
  ctx.intervalo(() => tique(s), TIQUE_MS);
  // janela minimizada (visibilityState hidden): ninguém olha, não lê (achado 9). Sem foco NÃO conta como escondida: o client
  // pode estar à vista na 2ª tela ao lado do jogo; a próxima volta depois de reaparecer lê de novo (≤ 2 s)
  ctx.intervalo(() => { if (!escondida(s)) lerColetor(s).catch(() => {}); }, ESTADO_CADA_MS);
  lerColetor(s).catch(() => {});
}

// GameStart -> InProgress -> Reconnect -> InProgress: mesma tela, troca o miolo (sem remontar: o roteador olha o módulo)
export function atualizar(ctx) {
  const s = atual;
  if (!s || s.ctx !== ctx) return;
  marcarInicio(ctx.fase, _relogio.agora(), s.info?.gameId || null);
  if (ctx.fase !== 'Reconnect') { s.reconectando = false; s.reconectaEm = 0; }
  pintar(s);
  if (!s.campeao) lerSessao(s).catch(() => {});
  lerColetor(s).catch(() => {});
}

export function desmontar(raiz) {
  try { raiz?.classList?.remove('lc-cp-jg'); } catch { /* segue */ }
  atual = null;
}

export const _estado = () => atual; // teste e depuração

async function lerSessao(s) {
  const { ctx } = s;
  if (s.lendoSessao) return;
  s.lendoSessao = true;
  try {
    const [g, eu] = await Promise.all([ctx.lcu('GET', '/lol-gameflow/v1/session'),
      s.puuid ? Promise.resolve(null) : ctx.lcu('GET', '/lol-summoner/v1/current-summoner')]);
    if (!ctx.vivo()) return;
    if (eu?.ok && typeof eu.json?.puuid === 'string') s.puuid = eu.json.puuid;
    if (g.ok && g.json && typeof g.json === 'object') aoSessao(s, g.json);
  } finally { s.lendoSessao = false; }
}

function aoSessao(s, sessao) {
  if (!s.ctx.vivo()) return;
  const info = infoDaPartida(sessao);
  if (info.gameId || !s.info) s.info = info;
  const c = meuCampeao(sessao, s.puuid);
  if (c) s.campeao = c;
  pintar(s);
}

async function lerColetor(s) {
  const { ctx } = s;
  const coletor = ctx.servicos?.coletor;
  // Reconnect: o jogo caiu, a Live Client não responde; GameStart dura ~50 ms. Só InProgress lê
  if (typeof coletor !== 'function' || ctx.fase !== 'InProgress' || s.lendoColetor) return;
  s.lendoColetor = true;
  try {
    const r = await coletor('/estado', { prazoMs: 1500 });
    if (!ctx.vivo()) return;
    const est = r?.status === 200 ? lerEstadoColetor(r.dados, s.info?.gameId || null) : null;
    s.coletorFora = !r || r.status === 0;
    if (est) {
      s.coletor = est; s.lidoEm = _relogio.agora();
      if (!s.campeao && est.campeao) s.campeao = est.campeao;
    }
    pintar(s);
  } finally { s.lendoColetor = false; }
}

// ---------- desenho (esqueleto uma vez; botões nunca são recriados: o clique não cai numa repintura) ----------
function esqueleto(s) {
  const { el, ctx, raiz } = s;
  const r = s.refs;
  r.titulo = el('div', { class: 'lc-cp-jg-tit' });
  ctx.titulo.append(r.titulo);
  r.foto = el('div', { class: 'lc-cp-jg-foto' });
  r.campeao = el('b', { class: 'lc-cp-jg-camp' });
  r.fila = el('div', { class: 'lc-cp-nota' });
  r.tempo = el('div', { class: 'lc-cp-jg-tempo', dataset: { a: 'tempo' } });
  r.rotulo = el('div', { class: 'lc-cp-rot' });
  r.placar = el('div', { class: 'lc-cp-jg-placar', dataset: { a: 'placar' } });
  r.fonte = el('div', { class: 'lc-cp-nota lc-cp-jg-fonte' });
  r.reconectar = el('button', { class: 'lc-cp-btn lc-cp-prim lc-cp-jg-rec', dataset: { a: 'reconectar' }, on: { click: ctx.seguro(e => reconectar(s, e)) } }, 'RECONECTAR');
  r.motivoRec = el('div', { class: 'lc-cp-nota' });
  r.caiu = el('div', { class: 'lc-cp-jg-caiu', dataset: { a: 'caiu' } },
    // texto neutro (revisão adversarial, achado 3): o Reconnect também aparece no fim de uma partida normal (medição de 14/10:
    // InProgress -> Reconnect 19:33:01 -> PreEndOfGame 19:33:12); "caiu, a partida segue" seria falso ali
    el('b', {}, 'o jogo fechou'), el('div', { class: 'lc-cp-nota' }, 'se a partida ainda está rolando, reconecta para voltar a ela'), r.reconectar, r.motivoRec);
  r.expandir = el('button', { class: 'lc-cp-btn', dataset: { a: 'abrir-normal' }, on: { click: ctx.seguro(() => ctx.expandir()) } }, '⤢ abrir o client normal');
  raiz.append(
    el('section', { class: 'lc-cp-jg-cab' }, r.foto, el('div', {}, r.campeao, r.fila)),
    el('section', { class: 'lc-cp-jg-relogio' }, r.tempo, r.rotulo, r.placar),
    r.caiu,
    el('div', { class: 'lc-cp-jg-pe' }, r.fonte, r.expandir,
      el('div', { class: 'lc-cp-nota' }, 'o client fica atrás do jogo: nada aqui mexe na partida nem traz a janela para a frente')),
  );
}

function pintarCampeao(s) {
  const { refs: r } = s;
  const nome = s.campeao ? (s.cat?.get?.(s.campeao)?.nome || `campeão ${s.campeao}`) : '';
  if (r.campeao.textContent !== (nome || 'seu campeão')) r.campeao.textContent = nome || 'seu campeão';
  const chave = String(s.campeao || 0);
  if (r.foto.dataset.c !== chave) { r.foto.dataset.c = chave; r.foto.replaceChildren(fotoCampeao(s.campeao, { tam: 64, nome, doc: s.raiz.ownerDocument || s.raiz.doc })); }
}

function pintar(s) {
  const { ctx, refs: r } = s;
  if (!ctx.vivo()) return;
  const fase = ctx.fase;
  const caiu = fase === 'Reconnect';
  // PreEndOfGame/WaitingForStats: a tela fica de pé uns segundos enquanto o roteador espera a etapa da Riot (destino "esperar")
  const tit = caiu ? ['PARTIDA', 'o jogo fechou: reconectar?'] : fase === 'GameStart' ? ['PARTIDA', 'abrindo o jogo']
    : fase === 'InProgress' ? ['PARTIDA', 'em andamento'] : ['PARTIDA', 'terminou'];
  if (s.faseVista !== fase) { s.faseVista = fase; r.titulo.replaceChildren(tit[0], s.el('small', {}, tit[1])); }
  pintarCampeao(s);
  const fila = s.info?.fila;
  const txtFila = s.info ? (s.info.custom ? 'personalizada' : nomeFila(fila)) : 'lendo a partida…';
  if (r.fila.textContent !== txtFila) r.fila.textContent = txtFila;
  r.caiu.style.display = caiu ? '' : 'none';
  const ocupado = s.reconectando && _relogio.agora() - s.reconectaEm < RECONECTA_MS;
  r.reconectar.disabled = ocupado;
  r.reconectar.textContent = ocupado ? 'reconectando…' : 'RECONECTAR';
  tique(s);
}

// só textos que mudam com o relógio (tempo, placar, fonte): nada de botão
function tique(s) {
  const { refs: r } = s;
  if (!s.ctx.vivo()) return;
  // fase mudou sem atualizar (Reconnect -> PreEndOfGame com o roteador esperando a etapa: achado 3): repinta título e blocos
  if (s.faseVista !== s.ctx.fase) { pintar(s); return; }
  const agora = _relogio.agora();
  const t = textoTempo({ coletor: s.coletor, lidoEm: s.lidoEm, agora, inicio: inicioDe(s.info?.gameId || null) });
  if (r.tempo.textContent !== t.texto) r.tempo.textContent = t.texto;
  if (r.rotulo.textContent !== t.rotulo) r.rotulo.textContent = t.rotulo;
  const fresco = s.coletor && idadeColetor(s.coletor, s.lidoEm, agora) <= COLETOR_VELHO_MS;
  const p = fresco && !s.coletor.carregando ? s.coletor.placar : null;
  const txtPlacar = p ? `seu time ${p.nosso} × ${p.deles} inimigos` : '';
  if (r.placar.textContent !== txtPlacar) r.placar.textContent = txtPlacar;
  r.placar.style.display = p ? '' : 'none';
  const fonte = s.ctx.fase === 'Reconnect' ? ''
    : t.fonte === 'coletor' ? 'tempo e placar: coletor (Live Client)'
      : s.coletorFora ? 'coletor fora: só o relógio do client' : typeof s.ctx.servicos?.coletor === 'function' ? 'esperando o coletor…' : '';
  if (r.fonte.textContent !== fonte) r.fonte.textContent = fonte;
  if (s.reconectando && agora - s.reconectaEm >= RECONECTA_MS && r.reconectar.disabled) pintar(s);
}

async function reconectar(s, e) {
  const { ctx, refs: r } = s;
  if (e?.isTrusted === false) return; // clique sintético nunca reconecta
  if (ctx.fase !== 'Reconnect') return;
  if (s.reconectando && _relogio.agora() - s.reconectaEm < RECONECTA_MS) return; // um por vez
  s.reconectando = true; s.reconectaEm = _relogio.agora();
  r.motivoRec.textContent = '';
  pintar(s);
  const res = await ctx.lcu('POST', ROTA_RECONECTAR);
  if (!ctx.vivo()) return;
  if (res.ok) { r.motivoRec.textContent = 'pedido enviado: o jogo vai abrir'; return; }
  s.reconectando = false; s.reconectaEm = 0;
  r.motivoRec.textContent = `não foi possível reconectar (${res.status || 'sem resposta'}): use o RECONECTAR do client normal (⤢ abaixo)`;
  ctx.avisar(`não foi possível reconectar (${res.status || 'sem resposta'}): abra o client normal e use o botão da Riot`, true);
  pintar(s);
}

export const CSS_JOGO = `
#lc-compacto .lc-cp-jg { display:flex; flex-direction:column; gap:14px; padding:18px 16px 14px; }
#lc-compacto .lc-cp-jg-tit { display:flex; flex-direction:column; line-height:1.15; color:var(--lc-ouro2); font-weight:700; letter-spacing:.08em; font-size:13px; }
#lc-compacto .lc-cp-jg-tit small { color:var(--lc-mudo); font-weight:400; letter-spacing:0; font-size:11px; }
#lc-compacto .lc-cp-jg-cab { display:flex; align-items:center; gap:12px; }
#lc-compacto .lc-cp-jg-foto .lc-cp-foto { border-width:2px; font-size:22px; }
#lc-compacto .lc-cp-jg-camp { display:block; color:var(--lc-ouro2); font-size:18px; font-weight:700; }
#lc-compacto .lc-cp-jg-relogio { display:flex; flex-direction:column; align-items:center; gap:2px; padding:16px 10px 14px; background:var(--lc-pan);
  border:1px solid var(--lc-linha2); }
#lc-compacto .lc-cp-jg-tempo { font-size:44px; font-weight:700; color:var(--lc-ouro2); letter-spacing:.04em; font-variant-numeric:tabular-nums; line-height:1.1; }
#lc-compacto .lc-cp-jg-placar { margin-top:10px; font-size:15px; color:var(--lc-txt); font-variant-numeric:tabular-nums; }
#lc-compacto .lc-cp-jg-caiu { display:flex; flex-direction:column; gap:8px; padding:12px; border:1px solid var(--lc-verm); background:rgba(232,64,87,.08); }
#lc-compacto .lc-cp-jg-caiu b { color:#ffd3d9; font-size:14px; }
#lc-compacto .lc-cp-jg-rec { padding:12px; font-size:15px; }
#lc-compacto .lc-cp-jg-pe { margin-top:auto; display:flex; flex-direction:column; gap:8px; }
#lc-compacto .lc-cp-jg-fonte:empty { display:none; }
`;
