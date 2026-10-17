// Tela 4 do client compacto: pós-jogo (roadmap/2026-10-13-client-compacto.md, passos 7 e 12). Contrato das telas:
// pengu/compacto/index.js. Visual do protótipo do fim de partida (temp/2026-10-14-prototipo-compacto-fim-de-partida.html,
// telas B, C e D), aprovado em 14/10/2026 ~20:00 com o ajuste "o botão de jogar de novo deve ser dois: 'ir para o lobby'
// e 'jogar de novo' que entra na fila", e ~20:05/~20:08: nome do jogador e do campeão nas linhas, "adicionar" e
// "denunciar" (compacto/jogador-acoes.js).
// - WaitingForStats: "carregando estatísticas" (tela D). A honra (PreEndOfGame honor-vote) é a tela-honra.js; o
//   roteador monta esta de novo no EndOfGame (a memória por gameId abaixo guarda o PDL "antes" e as lições).
// - EndOfGame (tela B): faixa V/D com campeão, KDA, farm/min, fila, posição, duração e PDL; abas "resumo" (mentor do
//   coletor: veredito, mandou bem, próxima partida, o essencial, perguntar; lições do coach recolhidas quando o veredito
//   chegou: GET /licoes/<gameId>, sem o coletor as do motor local, posjogo/index.js licoesLocais, passo 11 b5) e
//   "detalhes" (tu × adversário direto e os 10 com Riot ID, campeão, "+" e "⚑"); chat da sala embaixo (chat-sala.js,
//   tela C); linha do replay (baixar/assistir só por clique, assistir com 2 cliques: ../replay.js, pedido de 15/10/2026); IR PARA O LOBBY (play-again, senão dismiss-stats; nunca busca) e JOGAR DE NOVO (fila-rapida.js jogarDeNovo:
//   mesma fila, freios de freios.js, em grupo só volta ao lobby); análise completa (expande e abre o #lc-posjogo) e
//   fechar (dismiss-stats).
// Fontes: eog-stats-block (Riot ID dos outros só como o pós-jogo da Riot mostra, por textContent, nunca no log), sessão do
// gameflow (gameId, fila, mapa). PDL [S]: current-lp-change-notification com o gameId desta partida; senão a diferença do
// current-ranked-stats entre a 1ª leitura (WaitingForStats, guardada por partida) e as seguintes, por até 3 min.
// Campo ausente ou estado estranho nunca quebra: vira "–" com o motivo no title. Botão que não pode agir fica cinza com
// o motivo. Erro de código = o roteador devolve o client normal. Importável no node (tools/teste-compacto-posjogo.mjs).
import { h, estilo, fotoCampeao, comIcone } from './comum.js';
import { jogarDeNovo, FILAS_COM_POSICAO } from '../fila-rapida.js';
import { criarConfirmacao, cliqueComFreio, JANELA_MS } from '../freios.js';
import { partesMentor } from '../posjogo/abas.js';
import { botaoChat } from './chat-botao.js';
import { criarSala } from './chat-sala.js';
import { jogadoresDoEog, adversarioDireto, criarSocial, botoesJogador, abrirDenuncia, abrirJogador, CSS_JOGADORES } from './jogador-acoes.js';
import { criarReplay, REPLAY, CSS_REPLAY } from '../replay.js';

export const NOMES_FILA = { 420: 'Ranqueada Solo/Duo', 440: 'Ranqueada Flex', 400: 'Normal (escolha)', 430: 'Normal (às cegas)',
  450: 'ARAM', 490: 'Partida rápida' };
export const FILA_CURTA = { 420: 'Solo/Duo', 440: 'Flex', 400: 'Normal', 430: 'Às cegas', 450: 'ARAM', 490: 'Rápida' };
export const FILA_RANKED = { 420: 'RANKED_SOLO_5x5', 440: 'RANKED_FLEX_SR' };
const POSICOES = { TOP: 'Topo', JUNGLE: 'Selva', MIDDLE: 'Meio', BOTTOM: 'Atirador', UTILITY: 'Suporte', FILL: 'Qualquer' };
const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const TIER_PT = { IRON: 'Ferro', BRONZE: 'Bronze', SILVER: 'Prata', GOLD: 'Ouro', PLATINUM: 'Platina', EMERALD: 'Esmeralda',
  DIAMOND: 'Diamante', MASTER: 'Mestre', GRANDMASTER: 'Grão-Mestre', CHALLENGER: 'Desafiante' };
const DIVISOES = ['IV', 'III', 'II', 'I'];
// prazos (ms): eog que não chega, janela do PDL (a mesma do medidor), lições (backfill do coletor leva 5–160 s), mentor
export const PRAZOS = { eogMs: 60000, eogCadaMs: 2000, pdlMs: 180000, pdlCadaMs: 5000, licoesMs: 300000, coletorForaMs: 15000, tiqueMs: 500,
  mentorPensandoMs: 3000, mentorNadaMs: 5000, mentorProntoMs: 15000, mentorForaMs: 10000 };
// relógio da tela (o teste troca; o roteador já injeta os timers): agora() ms e data() para o freio de madrugada
export const _relogio = { agora: () => Date.now(), data: () => new Date() };

// ---- funções puras (teste) ----
const num = v => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v));
const pad = n => String(n).padStart(2, '0');

// eog-stats-block -> resumo do jogador local | null. Só campeão, números e resultado.
export function resumoDoEog(eog) {
  if (!eog || typeof eog !== 'object') return null;
  const lp = eog.localPlayer && typeof eog.localPlayer === 'object' ? eog.localPlayer : {};
  const st = lp.stats && typeof lp.stats === 'object' ? lp.stats : {};
  const pega = (...ks) => { for (const k of ks) { const v = num(st[k]); if (v !== null) return v; } return null; };
  const k = pega('CHAMPIONS_KILLED', 'kills'), d = pega('NUM_DEATHS', 'deaths'), a = pega('ASSISTS', 'assists');
  const tropas = pega('MINIONS_KILLED', 'totalMinionsKilled'), monstros = pega('NEUTRAL_MINIONS_KILLED', 'neutralMinionsKilled');
  const dur = num(eog.gameLength);
  const time = Array.isArray(eog.teams) ? eog.teams.find(t => t && t.isPlayerTeam === true) : null;
  let vitoria = typeof time?.isWinningTeam === 'boolean' ? time.isWinningTeam : null;
  if (vitoria === null && (num(st.WIN) === 0 || num(st.WIN) === 1)) vitoria = num(st.WIN) === 1;
  const fim = num(eog.endOfGameTimestamp);
  const id = num(lp.championId);
  const pos = String(lp.selectedPosition || '').toUpperCase(), det = String(lp.detectedTeamPosition || '').toUpperCase();
  return {
    gameId: num(eog.gameId),
    vitoria,
    refeita: eog.gameEndedInEarlySurrender === true,
    kda: k !== null && d !== null && a !== null ? [k, d, a] : null,
    farmMin: (tropas !== null || monstros !== null) && dur > 0 ? ((tropas || 0) + (monstros || 0)) / (dur / 60) : null,
    duracaoS: dur > 0 ? dur : null,
    inicioMs: fim > 0 && dur > 0 ? fim - dur * 1000 : null,
    campeaoId: id > 0 ? id : null,
    campeao: typeof lp.championName === 'string' && lp.championName ? lp.championName : null,
    posicao: POSICOES[pos] && pos !== 'FILL' ? pos : POSICOES[det] && det !== 'FILL' ? det : null,
    // false = personalizada/treino (o jogar de novo não serve); null = não sei
    matchmaking: typeof eog.gameType === 'string' ? eog.gameType === 'MATCHED_GAME' : null,
  };
}

// sessão do gameflow -> {gameId, fila, mapa, custom} (campos que não vieram ficam null)
export function infoDaPartida(s) {
  const gd = s?.gameData && typeof s.gameData === 'object' ? s.gameData : {};
  const gid = num(gd.gameId), fila = num(gd.queue?.id), mapa = num(s?.map?.id ?? gd.queue?.mapId);
  // tipoFila (queue.type, ex. RANKED_SOLO_5x5): o gameType que o botão de replay da Riot manda ao registrar o replay
  return { gameId: gid > 0 ? gid : null, fila: fila > 0 ? fila : null, mapa: mapa > 0 ? mapa : null,
    custom: typeof gd.isCustomGame === 'boolean' ? gd.isCustomGame : null,
    tipoFila: typeof gd.queue?.type === 'string' && gd.queue.type ? gd.queue.type : null };
}

// player-status -> true (grupo ou não-líder: só volta ao lobby) | false (sozinho e líder) | null (não sei)
export function emGrupo(st) {
  const ant = st?.lastQueuedLobbyStatus;
  if (!ant || typeof ant !== 'object' || typeof ant.isLeader !== 'boolean') return null;
  return !ant.isLeader || (Array.isArray(ant.memberSummonerIds) ? ant.memberSummonerIds.length : 1) > 1;
}

// notificação de PDL -> {delta, fonte} | null. Só a desta partida (o client guarda a última, que pode ser de outra).
export function pdlDaNotificacao(n, gameId) {
  if (!n || typeof n !== 'object' || !(Number(gameId) > 0) || num(n.gameId) !== Number(gameId)) return null;
  const d = num(n.leaguePointsDelta);
  return d === null ? null : { delta: Math.round(d), fonte: 'notificação do client' };
}

// current-ranked-stats -> {tier, divisao, pdl} da fila | null
export function filaRanqueada(stats, fila) {
  const tipo = FILA_RANKED[fila];
  if (!tipo || !stats || typeof stats !== 'object') return null;
  const q = stats.queueMap?.[tipo] || (Array.isArray(stats.queues) ? stats.queues.find(x => x?.queueType === tipo) : null);
  const pdl = num(q?.leaguePoints);
  if (!q || pdl === null) return null;
  const tier = String(q.tier || '').toUpperCase();
  return { tier: TIERS.includes(tier) ? tier : '', divisao: DIVISOES.includes(String(q.division)) ? String(q.division) : '', pdl };
}

const ordem = r => (TIERS.indexOf(r.tier) + 1) * 10 + (DIVISOES.indexOf(r.divisao) + 1);
// antes/depois -> {delta} (mesma divisão) | {mudou: 'subiu'|'caiu', depois} | null (nada mudou ainda)
export function pdlDaDiferenca(antes, depois) {
  if (!antes || !depois) return null;
  if (antes.tier === depois.tier && antes.divisao === depois.divisao)
    return depois.pdl === antes.pdl ? null : { delta: depois.pdl - antes.pdl, fonte: 'diferença do PDL antes/depois', antes: antes.pdl, depois: depois.pdl };
  return { mudou: ordem(depois) >= ordem(antes) ? 'subiu' : 'caiu', depois, fonte: 'diferença do PDL antes/depois' };
}

export function textoRank(r) {
  if (!r || !r.tier) return 'sem ranque';
  const alto = ['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(r.tier);
  return `${TIER_PT[r.tier]}${alto || !r.divisao ? '' : ' ' + r.divisao} · ${r.pdl} PDL`;
}

// {delta} -> "+21" / "−18" (sinal de menos de verdade) / "±0"; {mudou} -> "↑" / "↓"
export function textoPdl(p) {
  if (!p) return '–';
  if (p.mudou) return p.mudou === 'subiu' ? '↑' : '↓';
  const d = Number(p.delta);
  return d > 0 ? `+${d}` : d < 0 ? `−${Math.abs(d)}` : '±0';
}

export const textoFarm = v => (v === null || v === undefined ? '–' : (Math.round(v * 10) / 10).toFixed(1).replace('.', ','));
export const textoDuracao = s => (s > 0 ? `${Math.floor(s / 60)}:${pad(Math.floor(s % 60))}` : '');
export const textoHora = ms => { if (!(ms > 0)) return ''; const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const nomeFila = f => NOMES_FILA[f] || (f > 0 ? `fila ${f}` : 'partida');
// 12.345 -> "12,3k"; 950 -> "950"
export const textoMil = v => (v === null || v === undefined ? '–' : v >= 1000 ? `${(Math.round(v / 100) / 10).toFixed(1).replace('.', ',')}k` : String(Math.round(v)));

// texto do mentor -> {veredito, bem, prox, essencial: [], resto} (rótulos de pengu/posjogo/abas.js: Veredito, O essencial,
// Mandou bem, Lições, Próxima partida). Sem rótulo nenhum: tudo em "resto".
export function secoesMentor(texto) {
  const { veredito, resto } = partesMentor(texto);
  const out = { veredito, bem: '', prox: '', essencial: [], resto: '' };
  const linhas = String(resto || '').split('\n');
  let atual = null; const buf = { essencial: [], bem: [], prox: [], licoes: [], resto: [] };
  const RE = /^[ \t]*(?:\*\*)?(O essencial|Mandou bem|Lições|Próxima partida):?(?:\*\*)?:?[ \t]*(.*)$/;
  for (const l of linhas) {
    const m = l.match(RE);
    if (m) { atual = { 'O essencial': 'essencial', 'Mandou bem': 'bem', 'Lições': 'licoes', 'Próxima partida': 'prox' }[m[1]]; if (m[2].trim()) buf[atual].push(m[2]); continue; }
    buf[atual || 'resto'].push(l);
  }
  const limpa = t => t.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
  out.bem = limpa(buf.bem.join(' '));
  out.prox = limpa(buf.prox.join(' '));
  // essencial em itens: cada linha com "-", "•" ou "1." começa um item; o resto junta no anterior
  const itens = [];
  for (const l of [...buf.essencial, ...buf.licoes]) {
    if (!l.trim()) continue;
    if (/^\s*(?:[-•*]|\d+[.)])\s+/.test(l) || !itens.length) itens.push(l.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, ''));
    else itens[itens.length - 1] += ' ' + l;
  }
  out.essencial = itens.map(limpa).filter(Boolean);
  out.resto = limpa(buf.resto.join(' '));
  return out;
}

// ---- memória entre montagens (a honra é outra tela: esta é montada de novo no EndOfGame) ----
// por gameId: o PDL "antes" lido no WaitingForStats e as lições que já chegaram. Só as 3 últimas partidas.
const memoria = new Map();
const lembrar = gid => {
  if (!gid) return {};
  if (!memoria.has(gid)) { memoria.set(gid, {}); while (memoria.size > 3) memoria.delete(memoria.keys().next().value); }
  return memoria.get(gid);
};
export const _esquecer = () => memoria.clear(); // só teste

// o próprio jogador para o topo das telas do fim de partida (current-summoner e o ranque da solo/duo) -> {eu, rank}
export async function lerEu(ctx) {
  const [eu, rk] = await Promise.all([ctx.lcu('GET', '/lol-summoner/v1/current-summoner'), ctx.lcu('GET', '/lol-ranked/v1/current-ranked-stats')]);
  const out = { eu: null, rank: null };
  if (eu.ok && eu.json && typeof eu.json === 'object') {
    const nome = typeof eu.json.gameName === 'string' && eu.json.gameName ? eu.json.gameName : (typeof eu.json.displayName === 'string' ? eu.json.displayName : '');
    out.eu = { nome, icone: num(eu.json.profileIconId) };
  }
  if (rk.ok) out.rank = filaRanqueada(rk.json, 420);
  return out;
}

// topo: ícone, nome e ranque (ou o rótulo da tela)
export function pintarTituloEu(ctx, eu, rank, rotulo = 'fim de partida') {
  const t = ctx.titulo;
  if (!t?.replaceChildren) return;
  const nome = eu?.nome || '';
  const icone = eu?.icone > 0 ? `/lol-game-data/assets/v1/profile-icons/${eu.icone}.jpg` : '';
  t.replaceChildren(h('div', { class: 'lc-cp-pj-id' },
    h('span', { class: 'lc-cp-pj-av', style: { backgroundImage: icone ? `url("${icone}")` : '' } }, icone ? '' : (nome.slice(0, 1).toUpperCase() || '?')),
    h('div', {}, h('b', {}, nome || 'pós-jogo'), h('small', {}, rank ? textoRank(rank) : rotulo))));
}

// ---- tela ----
const estados = new WeakMap(); // ctx -> estado da montagem

export function montar(raiz, ctx) {
  estilo('lc-cp-posjogo-estilo', CSS_POSJOGO);
  estilo('lc-cp-jogadores-estilo', CSS_JOGADORES);
  estilo('lc-replay-estilo', CSS_REPLAY);
  const est = {
    gameId: null, fila: null, mapa: null, custom: null, resumo: null, eogDesde: null, ultimoEog: 0, eogEmVoo: false,
    fimEm: null, licoes: { estado: 'carregando', lista: [] }, licoesInicio: 0, licoesEmVoo: false, licoesAgendada: false,
    pdl: { estado: 'lendo' }, rank: null, ultimoPdl: 0, pdlEmVoo: false, grupo: null, eu: null,
    ocupado: false, confirmacao: null, textoFreio: '', armadoVisto: false, corpo: null, cont: null,
    jogadores: [], aba: 'resumo', mentor: { status: 'carregando' }, mentorLoop: false, pergunta: '', perguntando: false,
    licoesAbertas: null, partes: null, chaveCont: '', sala: null,
  };
  estados.set(ctx, est);
  botaoChat(ctx); // protótipo (tela 4): 💬 com o contador antes do expandir ("mais uma?" no fim da partida)
  est.social = criarSocial(ctx, { gameId: () => est.gameId, custom: () => est.custom === true || est.resumo?.matchmaking === false });
  est.social.aoMudar(() => pintar(ctx, est));
  est.corpo = h('div', { class: 'lc-cp-fp lc-cp-pj' });
  raiz.append(est.corpo);
  if (ctx.fase === 'EndOfGame') est.fimEm = _relogio.agora();
  pintar(ctx, est);
  ctx.observar('/lol-end-of-game/v1/eog-stats-block', msg => { if (msg?.eventType !== 'Delete' && msg?.data) receberEog(ctx, est, msg.data); });
  ctx.observar('/lol-ranked/v1/current-lp-change-notification', msg => {
    if (msg?.eventType === 'Delete' || est.pdl.estado !== 'lendo') return;
    const p = pdlDaNotificacao(msg?.data, est.gameId);
    if (p) { est.pdl = { estado: 'ok', ...p }; pintar(ctx, est); }
  });
  ctx.intervalo(() => tique(ctx, est), PRAZOS.tiqueMs);
  // replay: estado relido a cada 2 s com a tela B à vista (só GET; baixar/assistir só pelo clique dele, ../replay.js)
  ctx.intervalo(() => { if (ctx.fase === 'EndOfGame' && est.replay && est.partes) est.replay.ler(); }, REPLAY.cadaMs);
  return carregar(ctx, est);
}

// WaitingForStats -> EndOfGame sem trocar de tela
export function atualizar(ctx) {
  const est = estados.get(ctx);
  if (!est) return;
  if (ctx.fase === 'EndOfGame' && !est.fimEm) est.fimEm = _relogio.agora();
  pintar(ctx, est);
  if (!est.resumo) lerEog(ctx, est);
  aoFimDePartida(ctx, est);
}

export function desmontar(raiz, ctx) { estados.delete(ctx); }

async function carregar(ctx, est) {
  const [s, eu, st] = await Promise.all([
    ctx.lcu('GET', '/lol-gameflow/v1/session'),
    ctx.lcu('GET', '/lol-summoner/v1/current-summoner'),
    ctx.lcu('GET', '/lol-gameflow/v1/gameflow-metadata/player-status'),
  ]);
  if (!ctx.vivo()) return;
  const p = s.ok ? infoDaPartida(s.json) : infoDaPartida(null);
  const info = ctx.info || {};
  est.gameId = p.gameId;
  est.fila = p.fila ?? (num(info.fila) > 0 ? num(info.fila) : null);
  est.mapa = p.mapa ?? (num(info.mapa) > 0 ? num(info.mapa) : null);
  est.custom = p.custom ?? (typeof info.custom === 'boolean' ? info.custom : null);
  est.tipoFila = p.tipoFila;
  if (eu.ok && eu.json && typeof eu.json === 'object') {
    const nome = typeof eu.json.gameName === 'string' && eu.json.gameName ? eu.json.gameName : (typeof eu.json.displayName === 'string' ? eu.json.displayName : '');
    est.eu = { nome, icone: num(eu.json.profileIconId) };
  }
  if (st.ok) est.grupo = emGrupo(st.json);
  if (!FILA_RANKED[est.fila]) est.pdl = { estado: 'nao', motivo: 'sem PDL nesta fila' };
  pintar(ctx, est);
  await lerEog(ctx, est);
  if (!ctx.vivo()) return;
  // 1ª leitura do PDL agora (no WaitingForStats ela é o "antes"); o rank do topo sai dela também
  await lerPdl(ctx, est);
  if (!ctx.vivo()) return;
  lerLicoes(ctx, est);
  aoFimDePartida(ctx, est);
}

// EndOfGame com a partida conhecida: amigos/denúncias (só GET) e o mentor do coletor, uma vez por montagem
function aoFimDePartida(ctx, est) {
  if (ctx.fase !== 'EndOfGame' || !est.gameId) return;
  if (!est.socialLido) { est.socialLido = true; est.social.ler(); }
  if (!est.mentorLoop) { est.mentorLoop = true; lerMentor(ctx, est); }
}

function receberEog(ctx, est, eog) {
  const r = resumoDoEog(eog);
  if (!r || !r.gameId) return;
  // eog de outra partida (o client guarda o último): só vale o desta; sem gameId da sessão, só no EndOfGame
  if (est.gameId ? r.gameId !== est.gameId : ctx.fase !== 'EndOfGame') return;
  const novo = !est.gameId;
  est.gameId = r.gameId;
  est.resumo = r; // o client manda o mesmo eog até 3 vezes em ~100 ms (ARMADILHAS § LCU): vale o último
  est.jogadores = jogadoresDoEog(eog);
  if (typeof eog.queueType === 'string' && eog.queueType) est.tipoFilaEog = eog.queueType; // reserva do gameType do replay
  pintar(ctx, est);
  if (novo) { lerPdl(ctx, est); lerLicoes(ctx, est); }
  aoFimDePartida(ctx, est);
}

async function lerEog(ctx, est) {
  if (est.eogEmVoo) return;
  est.eogEmVoo = true;
  est.ultimoEog = _relogio.agora();
  let r;
  try { r = await ctx.lcu('GET', '/lol-end-of-game/v1/eog-stats-block'); } finally { est.eogEmVoo = false; }
  if (!ctx.vivo()) return;
  if (r.ok && r.json) receberEog(ctx, est, r.json);
}

async function lerPdl(ctx, est) {
  if (est.pdlEmVoo) return;
  est.pdlEmVoo = true;
  est.ultimoPdl = _relogio.agora();
  const ranked = !!FILA_RANKED[est.fila];
  try {
    if (ranked && est.pdl.estado === 'lendo' && est.gameId) {
      const n = await ctx.lcu('GET', '/lol-ranked/v1/current-lp-change-notification');
      if (!ctx.vivo()) return;
      const p = n.ok ? pdlDaNotificacao(n.json, est.gameId) : null;
      if (p) est.pdl = { estado: 'ok', ...p };
    }
    // o rank do topo (fila da partida; fora da ranqueada, a solo/duo) e a diferença antes/depois
    if (!est.rank || (ranked && est.pdl.estado === 'lendo')) {
      const r = await ctx.lcu('GET', '/lol-ranked/v1/current-ranked-stats');
      if (!ctx.vivo()) return;
      const atual = r.ok ? filaRanqueada(r.json, ranked ? est.fila : 420) : null;
      if (atual) {
        est.rank = atual;
        if (ranked && est.pdl.estado === 'lendo' && est.gameId) {
          const mem = lembrar(est.gameId);
          if (!mem.antes) mem.antes = atual; // 1ª leitura desta partida = antes; só mudança vista depois conta
          else {
            const d = pdlDaDiferenca(mem.antes, atual);
            if (d) est.pdl = { estado: 'ok', ...d };
          }
        }
      }
    }
  } finally { est.pdlEmVoo = false; }
  pintar(ctx, est);
}

async function lerLicoes(ctx, est) {
  if (!est.gameId || est.licoesEmVoo || est.licoes.estado === 'ok' || est.licoes.estado === 'sem') return;
  const mem = lembrar(est.gameId);
  if (mem.licoes) { est.licoes = { estado: 'ok', lista: mem.licoes }; pintar(ctx, est); return; }
  const col = ctx.servicos?.coletor;
  if (typeof col !== 'function') { est.licoes = { estado: 'fora', lista: [] }; lerLicoesLocais(ctx, est); pintar(ctx, est); return; }
  est.licoesInicio ||= _relogio.agora();
  est.licoesEmVoo = true;
  let r;
  try { r = await col(`/licoes/${est.gameId}`, { prazoMs: 30000 }); } catch { r = { status: 0, dados: null }; } finally { est.licoesEmVoo = false; }
  if (!ctx.vivo()) return;
  let espera = 0;
  if (r?.status === 200 && Array.isArray(r.dados?.licoes)) {
    const lista = r.dados.licoes.filter(l => l && typeof l.texto === 'string' && l.texto).slice(0, 3)
      .map(l => ({ texto: l.texto, positiva: l.tipo === 'positiva' }));
    est.licoes = lista.length ? { estado: 'ok', lista } : { estado: 'sem', lista: [], motivo: 'o coach não tirou lição desta partida' };
    if (lista.length) mem.licoes = lista;
  } else if (!r || r.status === 0) {
    est.licoes = { estado: 'fora', lista: [] };
    espera = PRAZOS.coletorForaMs;
    lerLicoesLocais(ctx, est);
  } else if (num(r.dados?.tentarDeNovoS) > 0) {
    est.licoes = { estado: 'esperando', lista: [] };
    espera = num(r.dados.tentarDeNovoS) * 1000;
  } else {
    est.licoes = { estado: 'sem', lista: [], motivo: String(r.dados?.erro || `coletor respondeu ${r.status}`) };
  }
  if (espera) {
    if (_relogio.agora() - est.licoesInicio + espera > PRAZOS.licoesMs) {
      const fora = est.licoes.estado === 'fora';
      est.licoes = { estado: 'sem', lista: [], motivo: fora ? 'coletor fora do ar' : 'o coach não leu a partida a tempo', fora };
    } else if (!est.licoesAgendada) {
      est.licoesAgendada = true;
      ctx.tempo(() => { est.licoesAgendada = false; return lerLicoes(ctx, est); }, espera);
    }
  }
  pintar(ctx, est);
}

// Sem o coletor (serviço ausente ou fora do ar): as lições do motor local do painel (posjogo/index.js licoesLocais, a mesma
// análise em cache que o "ver análise completa" abre), como no client normal (plano, passo 11 b5). Pedidas uma vez por
// montagem; o coletor segue sendo tentado e a resposta dele vence (licoesParaMostrar). Falha = segue "coletor fora".
function lerLicoesLocais(ctx, est) {
  const f = ctx.servicos?.posjogo?.licoesLocais;
  if (typeof f !== 'function' || est.locais || !est.gameId) return;
  // fora do Rift (ARAM, Arena) o motor não tem lição (analise.js: "só Summoner's Rift"): nem lê a partida
  if (est.mapa !== null && est.mapa !== 11) return;
  est.locais = { estado: 'lendo', lista: [] };
  const gid = est.gameId;
  Promise.resolve().then(() => f(gid)).then(r => r, () => null).then(r => {
    if (!ctx.vivo() || est.gameId !== gid) return;
    const lista = (Array.isArray(r?.licoes) ? r.licoes : []).filter(l => l && typeof l.texto === 'string' && l.texto).slice(0, 3)
      .map(l => ({ texto: l.texto, positiva: l.tipo === 'positiva' }));
    est.locais = lista.length ? { estado: 'ok', lista } : { estado: 'sem', lista: [] };
    pintar(ctx, est);
  });
}

// o que a lista mostra: as do coletor quando chegaram; até lá (fora, esperando o banco, sem lição), as do motor local que
// já chegaram, como o painel (`p.licoesColetor || calcularLicoes(...)`): o coletor que volta "esperando" não apaga a lista
export function licoesParaMostrar(licoes, locais) {
  return licoes?.estado !== 'ok' && locais?.estado === 'ok' ? { estado: 'ok', lista: locais.lista, local: true } : licoes;
}

// mentor do coletor (GET /mentor/<gameId>): 3 s pensando, 5 s sem nada, 15 s pronto (o coletor pode gerar de novo), 10 s
// fora. "analisando…" nunca segura o jogar de novo.
async function lerMentor(ctx, est) {
  if (!ctx.vivo()) return;
  const col = ctx.servicos?.coletor;
  if (typeof col !== 'function') { est.mentor = { status: 'fora' }; pintar(ctx, est); return; }
  let r;
  try { r = await col(`/mentor/${est.gameId}`, { prazoMs: 5000 }); } catch { r = { status: 0 }; }
  if (!ctx.vivo()) return;
  est.mentor = r?.status === 200 && r.dados?.status ? r.dados : { status: r?.status === 0 ? 'fora' : 'indisponivel' };
  pintar(ctx, est);
  const pensando = est.mentor.status === 'pensando' || (est.mentor.conversa || []).some(c => c.status === 'pensando');
  const ms = pensando ? PRAZOS.mentorPensandoMs : est.mentor.status === 'nada' ? PRAZOS.mentorNadaMs : est.mentor.status === 'fora' ? PRAZOS.mentorForaMs : PRAZOS.mentorProntoMs;
  ctx.tempo(() => lerMentor(ctx, est), ms);
}

// só o envio dele (Enter ou clique) pergunta
async function perguntar(ctx, est, input, e) {
  if (e?.isTrusted === false || est.perguntando) return;
  const texto = String(input?.value ?? est.pergunta ?? '').trim();
  const col = ctx.servicos?.coletor;
  if (!texto || !est.gameId || typeof col !== 'function') return;
  est.perguntando = true; pintar(ctx, est);
  let r;
  try { r = await col(`/mentor/${est.gameId}/pergunta`, { metodo: 'POST', corpo: { pergunta: texto }, prazoMs: 8000 }); } catch { r = { status: 0 }; }
  est.perguntando = false;
  if (!ctx.vivo()) return;
  if (r?.status === 202) {
    est.pergunta = '';
    const m = await col(`/mentor/${est.gameId}`).catch(() => null);
    if (ctx.vivo() && m?.status === 200 && m.dados?.status) est.mentor = m.dados;
  } else ctx.avisar(r?.status === 429 ? 'mentor ocupado com outra pergunta: tente de novo em alguns segundos'
    : r?.status === 0 ? 'coletor fora do ar' : `o mentor não aceitou a pergunta (${r?.dados?.erro || r?.status})`, true);
  pintar(ctx, est);
}

// a cada 0,5 s: contagem do freio, eog que não chegou, PDL que não chegou
function tique(ctx, est) {
  const agora = _relogio.agora();
  const armada = !!est.confirmacao?.armada();
  if (armada && est.cont) est.cont.textContent = `${Math.max(0, Math.ceil((est.armadoAte - agora) / 1000))} s`;
  if (est.armadoVisto && !armada) { est.armadoVisto = false; pintar(ctx, est); }
  const fim = ctx.fase === 'EndOfGame';
  if (!est.resumo && !est.eogEmVoo && agora - est.ultimoEog >= PRAZOS.eogCadaMs) {
    if (fim && est.fimEm && agora - est.fimEm > PRAZOS.eogMs) {
      if (!est.eogDesistiu) {
        est.eogDesistiu = true;
        // nem a sessão nem o eog disseram qual partida foi: lições e PDL não têm de onde vir
        if (!est.gameId) {
          est.licoes = { estado: 'sem', lista: [], motivo: 'o client não disse qual partida foi' };
          if (est.pdl.estado === 'lendo') est.pdl = { estado: 'nao', motivo: 'o client não disse qual partida foi' };
        }
        pintar(ctx, est);
      }
    } else lerEog(ctx, est);
  }
  if (est.pdl.estado === 'lendo' && !est.pdlEmVoo && est.gameId && agora - est.ultimoPdl >= PRAZOS.pdlCadaMs) {
    if (fim && est.fimEm && agora - est.fimEm > PRAZOS.pdlMs) {
      est.pdl = { estado: 'nao', motivo: 'a variação de PDL não chegou em 3 min: veja no client normal' };
      pintar(ctx, est);
    } else lerPdl(ctx, est);
  }
}

// ---- jogar de novo, ir para o lobby, análise, fechar ----

// rótulo e estado do botão grande -> {texto, sub, motivo (desabilitado), grupo}
export function botaoJogar({ fase, cfg, fila, custom, resumo, grupo, armada }) {
  const fr = cfg?.filaRapida || {};
  const pos = FILAS_COM_POSICAO.includes(fila) && POSICOES[fr.pos1] && POSICOES[fr.pos2] ? ` · ${POSICOES[fr.pos1]} / ${POSICOES[fr.pos2]}` : '';
  const sub = `mesma fila: ${nomeFila(fila)}${pos}`;
  if (fase !== 'EndOfGame') return { texto: 'JOGAR DE NOVO', sub: 'esperando as estatísticas da partida', motivo: 'esperando as estatísticas da partida' };
  if (!fr.jogarDeNovo) return { texto: 'JOGAR DE NOVO', sub: 'desligado nas configurações', motivo: 'jogar de novo desligado nas configurações (Ctrl+K)' };
  if (!(fila > 0) || custom === true || resumo?.matchmaking === false)
    return { texto: 'JOGAR DE NOVO', sub: 'personalizada ou treino: monte pelo client', motivo: 'partida personalizada ou de treino: monte a fila pelo client' };
  if (grupo === true) return { texto: 'VOLTAR AO LOBBY', sub: 'em grupo: quem busca é o líder', grupo: true };
  if (armada) return { texto: 'BUSCAR MESMO ASSIM', sub, armada: true };
  return { texto: 'JOGAR DE NOVO', sub };
}

async function derrotas(ctx, est) {
  if (est.resumo?.vitoria === true) return 0;
  const f = ctx.servicos?.fila?.derrotasSeguidas;
  if (typeof f !== 'function') return null; // não sei: o freio de tilt pede confirmação
  try { return await f(); } catch { return null; }
}

async function clicarJogar(ctx, est, e) {
  if (e?.isTrusted === false) return; // clique sintético nunca busca (o freio de 2 cliques segue valendo por cima)
  est.confirmacao ||= criarConfirmacao({ agora: () => _relogio.agora() });
  // duplo clique de reflexo (2º antes de 700 ms depois de armar): ignorado, como no painel e na fila rápida
  if (est.ocupado || est.confirmacao.cedo()) return;
  const b = botaoJogar({ fase: ctx.fase, cfg: ctx.cfg, fila: est.fila, custom: est.custom, resumo: est.resumo, grupo: est.grupo, armada: false });
  if (b.motivo) { ctx.avisar(b.motivo, true); return; }
  est.ocupado = true;
  pintar(ctx, est);
  let r;
  try {
    r = await cliqueComFreio(est.confirmacao, async confirmado => jogarDeNovo(ctx.cfg, {
      derrotasSeguidas: await derrotas(ctx, est), confirmado, queueIdEsperado: est.fila, relogio: () => _relogio.data(),
    }));
  } catch (e) { r = { status: 'recusa', motivo: e?.message || String(e) }; }
  est.ocupado = false;
  if (r?.status === 'confirmar') {
    est.textoFreio = r.texto;
    est.armadoAte = _relogio.agora() + JANELA_MS;
    est.armadoVisto = true;
  } else if (r?.status === 'buscando') ctx.avisar('de volta à fila');
  else if (r?.status === 'grupo') ctx.avisar(r.motivo);
  else if (r?.status === 'recusa') ctx.avisar(`jogar de novo: ${r.motivo}`, true);
  if (ctx.vivo()) pintar(ctx, est);
}

// "ir para o lobby" (ajuste do Gabriel, 14/10/2026 ~20:00): o "jogar novamente" da Riot sem buscar. play-again quando o
// client deixa (lastQueuedLobbyStatus.allowedPlayAgain), senão sai do fim de partida como o ✕ dela. Nunca busca.
export async function irParaLobby(ctx, est, e) {
  if (e?.isTrusted === false || est.ocupado) return;
  if (ctx.fase !== 'EndOfGame') { ctx.avisar('aguarde as estatísticas chegarem', true); return; }
  est.ocupado = true;
  pintar(ctx, est);
  let expandir = false;
  try {
    const st = await ctx.lcu('GET', '/lol-gameflow/v1/gameflow-metadata/player-status');
    let ok = false;
    if (st.ok && st.json?.lastQueuedLobbyStatus?.allowedPlayAgain === true) ok = (await ctx.lcu('POST', '/lol-lobby/v2/play-again')).ok;
    if (!ok) {
      // o ✕ (dismiss-stats) leva ao início, não ao lobby: só quando ele está sozinho (grupo === false) e com aviso; em
      // grupo ou sem saber, não adivinha o que o ✕ faz com o grupo: avisa e abre o client normal (revisão de 14/10/2026)
      const grupo = (st.ok ? emGrupo(st.json) : null) ?? est.grupo;
      if (grupo === false) {
        const d = await ctx.lcu('POST', '/lol-end-of-game/v1/state/dismiss-stats');
        if (d.ok) ctx.avisar('a Riot não permitiu voltar ao lobby: indo para o início');
        else ctx.avisar(`não foi possível sair da tela de fim de partida (${d.status})`, true);
      } else {
        ctx.avisar('a Riot não permitiu voltar ao lobby por aqui: abrindo o client normal', true);
        expandir = true;
      }
    }
  } finally { est.ocupado = false; }
  if (!ctx.vivo()) return;
  if (expandir) { ctx.expandir(); return; }
  pintar(ctx, est);
}

// expande ANTES de abrir: com a camada à vista o #lc-posjogo fica escondido (html.lc-modo-compacto, modo.js)
function verAnalise(ctx, est) {
  const id = est.gameId, abrir = ctx.servicos?.posjogo?.abrirPainel;
  ctx.expandir();
  if (!id) { ctx.avisar('partida não identificada: use Ctrl+K > analisar última partida', true); return; }
  if (typeof abrir !== 'function') { ctx.avisar('painel do pós-jogo indisponível: Ctrl+K > analisar última partida', true); return; }
  try { abrir(id, { fimDePartida: true })?.catch?.(() => {}); } catch { /* o client normal já está à vista */ }
}

async function fechar(ctx, e) {
  if (e?.isTrusted === false) return;
  if (ctx.fase !== 'EndOfGame') { ctx.avisar('aguarde as estatísticas chegarem', true); return; }
  // o mesmo que o ✕ da tela de estatísticas da Riot: sai do fim de partida, nunca busca
  const r = await ctx.lcu('POST', '/lol-end-of-game/v1/state/dismiss-stats');
  if (!r.ok) ctx.avisar(`não foi possível fechar a tela de fim de partida (${r.status})`, true);
}

// ---- desenho (h() = textContent: texto do eog, do chat e do coletor nunca vira HTML) ----

function pintar(ctx, est) {
  if (!ctx.vivo() || !est.corpo) return;
  pintarTituloEu(ctx, est.eu, est.rank);
  const fim = ctx.fase === 'EndOfGame';
  if (!fim || (!est.resumo && !est.eogDesistiu)) { pintarCarregando(ctx, est); return; }
  if (!est.partes) montarPartes(ctx, est);
  pintarFaixa(ctx, est);
  pintarAbas(ctx, est);
  pintarCont(ctx, est);
  pintarBase(ctx, est);
}

// tela D: WaitingForStats (e o EndOfGame sem eog ainda)
function pintarCarregando(ctx, est) {
  est.partes = null; est.chaveCont = '';
  const fim = ctx.fase === 'EndOfGame';
  est.corpo.replaceChildren(h('div', { class: 'lc-cp-carr' }, h('div', { class: 'lc-cp-anel' }),
    h('b', {}, 'CARREGANDO ESTATÍSTICAS'),
    h('span', {}, fim ? 'a Riot está mandando os números da partida.' : 'a Riot junta os números da partida (0,7 a 7 s). Em seguida vem a honra e o pós-jogo.')));
}

// estrutura fixa da tela B: as partes repintam sozinhas; a faixa do chat é uma só por montagem (rascunho e tamanho ficam)
function montarPartes(ctx, est) {
  est.chaveCont = '';
  if (!est.sala) est.sala = criarSala(ctx, { jogadores: () => est.jogadores, gameId: () => est.gameId, tamanho: 'normal', aoNome: j => abrirJogador(ctx, est.social, j, { raiz: ctx.raiz }) });
  // replay (pedido de 15/10/2026): uma linha só por montagem, entre o chat e os botões; botões nascem uma vez (../replay.js)
  if (!est.replay) est.replay = criarReplay({ lcu: ctx.lcu, gameId: () => est.gameId, fim: true, vivo: () => ctx.vivo(), avisar: (m, e) => ctx.avisar(m, e),
    corpo: () => ({ gameType: est.tipoFila || est.tipoFilaEog, queueId: est.fila }), agora: () => _relogio.agora() });
  est.partes = { faixa: h('div', { class: 'lc-cp-faixa' }), abas: h('div', { class: 'lc-cp-pj-abas' }), cont: h('div', { class: 'lc-cp-pj-cont' }),
    replay: h('div', { class: 'lc-cp-replay' }, est.replay.el), base: h('div', { class: 'lc-cp-base' }) };
  est.corpo.replaceChildren(est.partes.faixa, est.partes.abas, est.partes.cont, est.sala.el, est.partes.replay, est.partes.base);
  est.replay.ler();
}

function pintarFaixa(ctx, est) {
  const r = est.resumo;
  const f = est.partes.faixa;
  if (!r) {
    f.className = 'lc-cp-faixa';
    f.replaceChildren(h('span', { class: 'lc-cp-r' }, 'FIM DE PARTIDA'), h('span', { class: 'lc-cp-q' }, 'as estatísticas não chegaram: veja no client normal'));
    return;
  }
  const [classe, titulo] = r.refeita ? ['lc-cp-fx-r', 'REFEITA'] : r.vitoria === true ? ['lc-cp-fx-v', 'VITÓRIA'] : r.vitoria === false ? ['lc-cp-fx-d', 'DERROTA'] : ['', 'FIM DE PARTIDA'];
  f.className = `lc-cp-faixa ${classe}`;
  const pdl = est.pdl;
  const pdlTxt = pdl.estado === 'ok' ? textoPdl(pdl) : pdl.estado === 'lendo' ? '…' : '–';
  const pdlClasse = pdl.estado === 'ok' ? (pdl.mudou === 'subiu' || pdl.delta > 0 ? 'lc-cp-mais' : pdl.mudou === 'caiu' || pdl.delta < 0 ? 'lc-cp-menos' : '') : '';
  const pdlTitulo = pdl.estado === 'ok' ? (pdl.mudou ? `${pdl.mudou === 'subiu' ? 'subiu' : 'caiu'} de divisão: ${textoRank(pdl.depois)}` : `fonte: ${pdl.fonte}`)
    : pdl.estado === 'lendo' ? 'esperando a variação de PDL do client' : pdl.motivo || '';
  const pdlSub = pdl.estado === 'ok' && pdl.antes !== undefined && pdl.depois !== undefined && !pdl.mudou ? `${pdl.antes} → ${pdl.depois}`
    : pdl.estado === 'ok' && pdl.mudou ? textoRank(pdl.depois) : '';
  const linha2 = [FILA_CURTA[est.fila] || nomeFila(est.fila), POSICOES[r.posicao], r.duracaoS ? textoDuracao(r.duracaoS) : ''].filter(Boolean).join(' · ');
  f.replaceChildren(
    h('span', { class: 'lc-cp-r', title: r.refeita ? 'partida refeita (remake)' : undefined }, titulo),
    fotoCampeao(r.campeaoId, { tam: 30, nome: r.campeao || '' }),
    h('span', { class: 'lc-cp-q' }, h('b', {}, r.campeao || 'campeão'), ' · ', h('b', { class: 'lc-cp-kda' }, r.kda ? r.kda.join('/') : '–/–/–'), ' · ',
      h('b', {}, textoFarm(r.farmMin)), ' farm/min', h('br'), linha2),
    h('span', { class: 'lc-cp-pdl', title: pdlTitulo || undefined }, h('b', { class: pdlClasse || undefined }, `${pdlTxt} PDL`), pdlSub ? h('small', {}, pdlSub) : null));
}

function pintarAbas(ctx, est) {
  const aba = (id, rot) => h('button', { class: est.aba === id ? 'lc-cp-on' : undefined, dataset: { a: 'aba-' + id },
    on: { click: ctx.seguro(() => { if (est.aba === id) return; est.aba = id; est.chaveCont = ''; pintar(ctx, est); }) } }, rot);
  est.partes.abas.replaceChildren(aba('resumo', 'resumo'), aba('detalhes', 'detalhes'));
}

// o miolo só repinta quando muda o que ele mostra (a faixa do PDL repinta a cada 5 s; o campo da pergunta e a rolagem não
// podem resetar junto)
function pintarCont(ctx, est) {
  const s = est.social.estado();
  const lic = licoesParaMostrar(est.licoes, est.locais);
  const chave = JSON.stringify([est.aba, est.mentor?.status, est.mentor?.texto, (est.mentor?.conversa || []).map(c => [c.status, c.resposta, c.pergunta]),
    lic, est.jogadores.length, est.perguntando, s.lido, [...s.amigos].length, [...s.pedidos].length, [...s.enviados], [...s.denunciados], [...s.emVoo]]);
  if (chave === est.chaveCont) return;
  est.chaveCont = chave;
  const c = est.partes.cont;
  const topo = c.scrollTop;
  // replaceChildren(null) escreveria "null" na tela: só elementos
  c.replaceChildren(...(est.aba === 'detalhes' ? conteudoDetalhes(ctx, est) : conteudoResumo(ctx, est)).filter(Boolean));
  try { c.scrollTop = topo; } catch { /* sem layout */ }
}

function conteudoResumo(ctx, est) {
  const m = est.mentor || { status: 'carregando' };
  const caixa = [];
  const comColetor = typeof ctx.servicos?.coletor === 'function';
  if (m.status === 'pronto') {
    const sec = secoesMentor(m.texto);
    caixa.push(h('div', { class: 'lc-cp-mt-tt' }, h('span', { class: 'lc-cp-rot' }, sec.veredito ? 'mentor · veredito' : 'mentor')));
    if (sec.veredito) caixa.push(h('div', { class: 'lc-cp-mt-ver' }, sec.veredito));
    if (sec.bem) caixa.push(h('div', { class: 'lc-cp-mt-bem' }, h('b', {}, 'Mandou bem: '), sec.bem));
    if (sec.prox) caixa.push(h('div', { class: 'lc-cp-mt-prox' }, h('b', {}, 'Próxima partida: '), sec.prox));
    if (sec.essencial.length) caixa.push(h('details', { class: 'lc-cp-mt-ess' }, h('summary', {}, `o essencial (${sec.essencial.length})`), ...sec.essencial.map(t => h('p', {}, `• ${t}`))));
    if (sec.resto && !sec.veredito) caixa.push(h('div', { class: 'lc-cp-mt-ver' }, sec.resto));
  } else if (m.status === 'pensando' || m.status === 'nada' || m.status === 'carregando') {
    caixa.push(h('div', { class: 'lc-cp-mt-tt' }, h('span', { class: 'lc-cp-rot' }, 'mentor'), h('span', { class: 'lc-cp-nota' }, 'chega 1–2 min depois do fim')),
      h('div', { class: 'lc-cp-mt-ver lc-cp-mudo' }, m.status === 'carregando' ? 'perguntando ao coletor…' : comIcone('espera', 'analisando a partida…', { tam: 12 })),
      h('div', { class: 'lc-cp-nota' }, 'pode jogar de novo sem esperar: a resposta fica guardada no coletor.'));
  } else if (m.status === 'erro') {
    const ult = [...(m.conversa || [])].reverse().find(c => c.uso === 'posjogo');
    caixa.push(h('div', { class: 'lc-cp-mt-tt' }, h('span', { class: 'lc-cp-rot' }, 'mentor')), h('div', { class: 'lc-cp-mt-ver lc-cp-mudo' }, `o mentor falhou: ${ult?.erro || 'sem detalhe'}`));
  } else {
    caixa.push(h('div', { class: 'lc-cp-mt-tt' }, h('span', { class: 'lc-cp-rot' }, 'mentor')),
      h('div', { class: 'lc-cp-mt-ver lc-cp-mudo' }, m.status === 'indisponivel' ? 'mentor desligado no coletor' : 'indisponível: o coletor não está rodando (127.0.0.1:8765 não respondeu)'));
  }
  // conversa: a última pergunta e a resposta
  const perg = (m.conversa || []).filter(c => c.uso === 'pergunta').at(-1);
  if (perg) caixa.push(h('div', { class: 'lc-cp-mt-resp' }, h('i', {}, 'você: '), perg.pergunta || '', h('br'),
    perg.status === 'pensando' ? h('i', {}, 'pensando…') : perg.status === 'erro' ? `falhou: ${perg.erro || ''}` : String(perg.resposta || '').replace(/\*\*/g, '')));
  const podePerguntar = comColetor && m.status !== 'fora' && m.status !== 'indisponivel' && !!est.gameId;
  const input = h('input', { dataset: { a: 'mentor-pergunta' }, maxlength: '500', placeholder: podePerguntar ? 'perguntar ao mentor sobre esta partida' : 'perguntar fica cinza sem o coletor' });
  input.value = est.pergunta || '';
  input.disabled = !podePerguntar || est.perguntando;
  input.addEventListener('input', () => { est.pergunta = String(input.value || ''); });
  input.addEventListener('keydown', ctx.seguro(e => { e.stopPropagation?.(); if (e.key === 'Enter') { e.preventDefault?.(); return perguntar(ctx, est, input, e); } }));
  const bt = h('button', { class: 'lc-cp-btn', dataset: { a: 'mentor-perguntar' }, on: { click: ctx.seguro(e => perguntar(ctx, est, input, e)) } }, est.perguntando ? '…' : 'perguntar');
  bt.disabled = !podePerguntar || est.perguntando;
  caixa.push(h('div', { class: 'lc-cp-mt-perg' }, input, bt));
  const mentor = h('div', { class: 'lc-cp-mentor' + (m.status === 'pronto' ? '' : m.status === 'fora' || m.status === 'indisponivel' ? ' lc-cp-fora' : ' lc-cp-esperando') }, ...caixa);
  // lições do coach: recolhidas quando o veredito chegou (D7 do painel); abrir/fechar na mão vale até a tela sair
  const lic = licoesParaMostrar(est.licoes, est.locais);
  const temVeredito = m.status === 'pronto' && !!partesMentor(m.texto).veredito;
  const n = lic.estado === 'ok' ? lic.lista.length : 3;
  const rot = `${lic.estado === 'ok' ? n : 3} lições do coach${lic.local ? ' · sem o coletor' : ''}`;
  let lista;
  if (lic.estado === 'ok') {
    const titulo = l => (lic.local ? `${l.texto} (motor local: as do coletor não chegaram)` : l.texto);
    lista = h('ul', { class: 'lc-cp-lic' }, lic.lista.map(l => h('li', { class: l.positiva ? 'lc-cp-pos' : undefined, title: titulo(l) }, comIcone(l.positiva ? 'ok' : 'aviso', l.texto, { tam: 12 }))));
  } else if (lic.estado === 'fora' || lic.estado === 'sem') {
    const texto = lic.estado === 'fora' ? 'coletor fora do ar: as lições ficam na análise completa' : `sem lições: ${lic.motivo || 'nada a mostrar'}`;
    lista = h('ul', { class: 'lc-cp-lic' }, h('li', { class: 'lc-cp-mudo', title: texto }, texto));
  } else {
    const t = lic.estado === 'esperando' ? 'o coach está lendo a partida' : 'carregando as lições';
    lista = h('ul', { class: 'lc-cp-lic lc-cp-carregando', title: t }, h('li', {}, '…'), h('li', {}, '…'), h('li', {}, '…'));
  }
  const det = h('details', { class: 'lc-cp-lics', title: lic.local ? 'as lições do coletor não chegaram: estas são do motor do painel, com o histórico do client' : undefined },
    h('summary', {}, rot), lista);
  det.open = est.licoesAbertas ?? !temVeredito;
  det.addEventListener('toggle', () => { if (det.open !== !temVeredito || est.licoesAbertas !== null) est.licoesAbertas = det.open; });
  const fora = est.mapa !== null && est.mapa !== 11 ? h('div', { class: 'lc-cp-nota' }, 'fora do Summoner\'s Rift o coach não analisa a partida') : null;
  return [mentor, det, fora];
}

// tu × adversário direto e os 10 (nome como o pós-jogo da Riot mostra, campeão, K/D/A, farm, dano, ouro, "+" e "⚑")
function conteudoDetalhes(ctx, est) {
  const lista = est.jogadores;
  if (!lista.length) return [h('div', { class: 'lc-cp-nota' }, 'o client não mandou os jogadores desta partida')];
  const eu = lista.find(j => j.eu), adv = adversarioDireto(lista, eu);
  const out = [];
  if (eu && adv) {
    const lin = (rot, a, b, fa, fb, menorMelhor = false) => {
      const mx = Math.max(a || 0, b || 0) || 1, ganha = menorMelhor ? a < b : a > b, perde = menorMelhor ? a > b : a < b;
      return h('div', { class: 'lc-cp-vsl' }, h('span', { class: 'lc-cp-v1' + (ganha ? ' lc-cp-m' : '') }, fa),
        h('span', { class: 'lc-cp-b1' }, h('i', { style: { width: `${((a || 0) / mx * 100).toFixed(0)}%` } })), h('span', { class: 'lc-cp-lb' }, rot),
        h('span', { class: 'lc-cp-b2' }, h('i', { style: { width: `${((b || 0) / mx * 100).toFixed(0)}%` } })), h('span', { class: 'lc-cp-v2' + (perde ? ' lc-cp-m' : '') }, fb));
    };
    const kda = j => (j.kda ? (j.kda[0] + j.kda[2]) / Math.max(1, j.kda[1]) : 0);
    out.push(h('div', { class: 'lc-cp-vs' },
      h('div', { class: 'lc-cp-vs-cab' }, h('span', { class: 'lc-cp-e' }, fotoCampeao(eu.campeaoId, { tam: 24, nome: eu.campeao }), ` você · ${eu.campeao}`),
        h('span', { class: 'lc-cp-meio' }, POSICOES[eu.posicao] || ''),
        h('span', { class: 'lc-cp-d' }, [adv.nome, adv.campeao].filter(Boolean).join(' · ') + ' ', fotoCampeao(adv.campeaoId, { tam: 24, nome: adv.campeao }))),
      lin('KDA', kda(eu), kda(adv), eu.kda ? eu.kda.join('/') : '–', adv.kda ? adv.kda.join('/') : '–'),
      lin('farm/min', eu.farmMin, adv.farmMin, textoFarm(eu.farmMin), textoFarm(adv.farmMin)),
      lin('ouro', eu.ouro, adv.ouro, textoMil(eu.ouro), textoMil(adv.ouro)),
      lin('dano', eu.dano, adv.dano, textoMil(eu.dano), textoMil(adv.dano)),
      lin('dano recebido', eu.recebido, adv.recebido, textoMil(eu.recebido), textoMil(adv.recebido)),
      lin('visão', eu.visao, adv.visao, eu.visao ?? '–', adv.visao ?? '–')));
  }
  const mxd = Math.max(1, ...lista.map(j => j.dano || 0));
  const linha = j => h('div', { class: 'lc-cp-jg' + (j.eu ? ' lc-cp-eu' : adv && j.puuid === adv.puuid ? ' lc-cp-adv' : ''), dataset: { puuid: j.puuid || '' } },
    fotoCampeao(j.campeaoId, { tam: 24, nome: j.campeao }),
    h('span', { class: 'lc-cp-n', title: [j.nome && (j.tag ? `${j.nome} #${j.tag}` : j.nome), j.campeao].filter(Boolean).join(' · ') || undefined },
      j.nome || j.campeao || '?', h('small', {}, [j.nome ? j.campeao : '', POSICOES[j.posicao]].filter(Boolean).join(' · '))),
    h('span', { class: 'lc-cp-k' }, j.kda ? j.kda.join('/') : '–'),
    h('span', { class: 'lc-cp-f' }, textoFarm(j.farmMin)),
    h('span', { class: 'lc-cp-dn', title: j.dano !== null ? `dano a campeões: ${j.dano}` : undefined }, h('i', { style: { width: `${((j.dano || 0) / mxd * 100).toFixed(0)}%` } })),
    h('span', { class: 'lc-cp-o' }, textoMil(j.ouro)),
    botoesJogador(ctx, est.social, j, { aoDenunciar: x => abrirDenuncia(ctx, est.social, x, { raiz: ctx.raiz }) }));
  const tot = l => `${l.reduce((s, j) => s + (j.k || 0), 0)}/${l.reduce((s, j) => s + (j.d || 0), 0)}/${l.reduce((s, j) => s + (j.a || 0), 0)} · ${textoMil(l.reduce((s, j) => s + (j.ouro || 0), 0))}`;
  const meu = lista.filter(j => j.aliado), deles = lista.filter(j => !j.aliado);
  const v = est.resumo?.vitoria;
  out.push(h('div', { class: 'lc-cp-jg-h' }, h('span'), h('span'), h('span', {}, 'K/D/A'), h('span', {}, 'farm'), h('span', {}, 'dano'), h('span', {}, 'ouro'), h('span')),
    h('div', { class: 'lc-cp-tm' }, h('span', {}, `seu time${v === true ? ' · vitória' : v === false ? ' · derrota' : ''}`), h('b', {}, tot(meu))), ...meu.map(linha),
    h('div', { class: 'lc-cp-tm' }, h('span', {}, 'adversários'), h('b', {}, tot(deles))), ...deles.map(linha),
    h('div', { class: 'lc-cp-nota lc-cp-centro' }, 'itens, runas e feitiços: análise completa'));
  return out;
}

function pintarBase(ctx, est) {
  const armada = !!est.confirmacao?.armada();
  const r = est.resumo;
  const b = botaoJogar({ fase: ctx.fase, cfg: ctx.cfg, fila: est.fila, custom: est.custom, resumo: r, grupo: est.grupo, armada });
  const bt = h('button', {
    class: 'lc-cp-jogar' + (b.armada ? ' lc-cp-armado' : ''), dataset: { a: 'jogar' }, title: b.motivo || (b.armada ? `${est.textoFreio} (clique de novo em até ${JANELA_MS / 1000} s)` : b.sub),
    on: { click: ctx.seguro(e => clicarJogar(ctx, est, e)) },
  }, est.ocupado ? 'UM INSTANTE…' : b.texto, h('small', {}, b.sub));
  bt.disabled = !!b.motivo || est.ocupado;
  // em grupo o botão grande já é "voltar ao lobby": sem o segundo igual
  const lobby = b.grupo ? null : h('button', { class: 'lc-cp-btn lc-cp-lobby', dataset: { a: 'lobby' }, title: 'volta ao lobby da mesma fila sem buscar (o "jogar novamente" da Riot)',
    on: { click: ctx.seguro(e => irParaLobby(ctx, est, e)) } }, 'IR PARA O LOBBY');
  if (lobby) lobby.disabled = est.ocupado || ctx.fase !== 'EndOfGame';
  const filhos = [h('div', { class: 'lc-cp-linha-jogar' }, lobby, bt)];
  est.cont = null;
  if (b.armada) {
    est.cont = h('span', { class: 'lc-cp-cont' }, `${Math.max(0, Math.ceil((est.armadoAte - _relogio.agora()) / 1000))} s`);
    filhos.push(h('div', { class: 'lc-cp-freio', role: 'status' }, est.cont, comIcone('aviso', est.textoFreio, { tam: 12 })));
  }
  // análise completa só no Summoner's Rift (a análise do pós-jogo é dele: docs/INSIGHTS.md)
  const analise = est.mapa === null || est.mapa === 11;
  filhos.push(h('div', { class: 'lc-cp-linha-bts' },
    analise ? h('button', { class: 'lc-cp-btn', dataset: { a: 'analise' }, title: 'abre o client normal com as 6 abas do pós-jogo',
      on: { click: ctx.seguro(() => verAnalise(ctx, est)) } }, comIcone('expandir', 'análise completa')) : null,
    h('button', { class: 'lc-cp-btn', dataset: { a: 'fechar-pj' }, title: 'sai da tela de fim de partida como o botão de fechar da Riot (não busca)',
      on: { click: ctx.seguro(e => fechar(ctx, e)) } }, 'fechar')));
  est.partes.base.replaceChildren(...filhos);
}

// visual do protótipo do fim de partida (telas B, C e D). Tudo do corpo fica sob .lc-cp-pj: os <style> das telas nunca saem
// do documento e o lobby usa os mesmos nomes (.lc-cp-jogar, .lc-cp-freio...); sem o escopo, o do pós-jogo vazava para a
// tela 1 (JOGAR de 26 px virava 21 px até recarregar). O título (.lc-cp-pj-id) mora no topo, fora do .lc-cp-pj.
export const CSS_POSJOGO = `
#lc-compacto .lc-cp-fp { flex:1; min-height:0; display:flex; flex-direction:column; margin:-12px -14px; }
#lc-compacto .lc-cp-pj-id { display:flex; gap:8px; align-items:center; min-width:0; }
#lc-compacto .lc-cp-pj-av { width:30px; height:30px; border-radius:50%; border:2px solid var(--lc-ouro); display:grid; place-items:center; flex:none;
  background:#1e3a5f center/cover no-repeat; color:var(--lc-ouro2); font-weight:700; font-size:13px; }
#lc-compacto .lc-cp-pj-id b { display:block; color:var(--lc-ouro2); font-size:13px; line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#lc-compacto .lc-cp-pj-id small { display:block; color:var(--lc-mudo); font-size:11px; white-space:nowrap; }
#lc-compacto .lc-cp-pj .lc-cp-carr { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:10px; color:var(--lc-mudo);
  font-size:12.5px; text-align:center; padding:0 30px; }
#lc-compacto .lc-cp-pj .lc-cp-carr b { color:var(--lc-ouro2); font-size:15px; font-weight:600; letter-spacing:.08em; }
#lc-compacto .lc-cp-pj .lc-cp-anel { width:86px; height:86px; border-radius:50%; border:3px solid #17313c; position:relative; }
#lc-compacto .lc-cp-pj .lc-cp-anel::after { content:""; position:absolute; inset:-3px; border-radius:50%; border:3px solid transparent; border-top-color:var(--lc-ouro);
  animation:lc-cp-gira 1.4s linear infinite; }
@keyframes lc-cp-gira { to { transform:rotate(360deg); } }
#lc-compacto .lc-cp-pj .lc-cp-faixa { flex:none; display:flex; align-items:center; gap:8px; padding:8px 12px; border-bottom:1px solid var(--lc-linha2);
  background:linear-gradient(90deg,rgba(160,155,140,.10),rgba(160,155,140,0) 70%); }
#lc-compacto .lc-cp-pj .lc-cp-faixa.lc-cp-fx-v { background:linear-gradient(90deg,rgba(10,200,185,.10),rgba(10,200,185,0) 70%); }
#lc-compacto .lc-cp-pj .lc-cp-faixa.lc-cp-fx-d { background:linear-gradient(90deg,rgba(232,64,87,.12),rgba(232,64,87,0) 70%); }
#lc-compacto .lc-cp-pj .lc-cp-r { font-size:19px; letter-spacing:.12em; font-weight:700; color:var(--lc-ouro2); line-height:1; flex:none; }
#lc-compacto .lc-cp-pj .lc-cp-fx-v .lc-cp-r { color:#7fe3f0; } #lc-compacto .lc-cp-pj .lc-cp-fx-d .lc-cp-r { color:#ff8a9a; }
#lc-compacto .lc-cp-pj .lc-cp-q { white-space:nowrap; min-width:0; overflow:hidden; text-overflow:ellipsis; font-size:11px; color:var(--lc-mudo); line-height:1.3; }
#lc-compacto .lc-cp-pj .lc-cp-q b { color:var(--lc-ouro2); font-weight:600; }
#lc-compacto .lc-cp-pj .lc-cp-pdl { flex:none; margin-left:auto; text-align:right; line-height:1.1; }
#lc-compacto .lc-cp-pj .lc-cp-pdl b { display:block; white-space:nowrap; font-size:19px; color:var(--lc-ouro2); }
#lc-compacto .lc-cp-pj .lc-cp-pdl b.lc-cp-mais { color:#7fe3f0; } #lc-compacto .lc-cp-pj .lc-cp-pdl b.lc-cp-menos { color:#ff8a9a; }
#lc-compacto .lc-cp-pj .lc-cp-pdl small { font-size:10.5px; color:var(--lc-mudo); }
#lc-compacto .lc-cp-pj .lc-cp-pj-abas { flex:none; display:grid; grid-template-columns:1fr 1fr; border-bottom:1px solid var(--lc-linha); }
#lc-compacto .lc-cp-pj .lc-cp-pj-abas button { background:none; border:none; color:var(--lc-mudo); padding:7px 0 6px; font-family:inherit; font-size:12px;
  letter-spacing:.08em; text-transform:uppercase; cursor:pointer; }
#lc-compacto .lc-cp-pj .lc-cp-pj-abas button.lc-cp-on { color:var(--lc-ouro2); box-shadow:inset 0 -2px 0 var(--lc-ouro); }
#lc-compacto .lc-cp-pj .lc-cp-pj-cont { flex:1; min-height:0; overflow:auto; padding:9px 12px; display:flex; flex-direction:column; gap:8px; user-select:text; }
#lc-compacto .lc-cp-pj .lc-cp-mentor { border:1px solid #23435a; background:linear-gradient(180deg,rgba(10,200,185,.08),rgba(10,200,185,.02)); padding:8px 10px;
  display:flex; flex-direction:column; gap:6px; }
#lc-compacto .lc-cp-pj .lc-cp-mentor.lc-cp-fora { border-color:#33373d; background:rgba(40,40,45,.35); }
#lc-compacto .lc-cp-pj .lc-cp-mt-tt { display:flex; justify-content:space-between; align-items:center; }
#lc-compacto .lc-cp-pj .lc-cp-mt-ver { font-size:13px; color:var(--lc-ouro2); line-height:1.4; }
#lc-compacto .lc-cp-pj .lc-cp-mt-ver.lc-cp-mudo { color:var(--lc-mudo); }
#lc-compacto .lc-cp-pj .lc-cp-mt-bem { font-size:12px; color:#bdf0cf; border-left:3px solid #3fbf77; padding:2px 0 2px 7px; line-height:1.35; }
#lc-compacto .lc-cp-pj .lc-cp-mt-bem b { color:#3fbf77; font-weight:600; }
#lc-compacto .lc-cp-pj .lc-cp-mt-prox { font-size:12px; color:var(--lc-ouro2); border-left:3px solid var(--lc-azul); padding:2px 0 2px 7px; line-height:1.35; }
#lc-compacto .lc-cp-pj .lc-cp-mt-prox b { color:var(--lc-azul); font-weight:600; }
#lc-compacto .lc-cp-pj .lc-cp-mt-ess { font-size:12px; color:var(--lc-txt); }
#lc-compacto .lc-cp-pj .lc-cp-mt-ess summary { cursor:pointer; color:var(--lc-ouro); font-size:11.5px; }
#lc-compacto .lc-cp-pj .lc-cp-mt-ess p { margin:4px 0 0; line-height:1.4; }
#lc-compacto .lc-cp-pj .lc-cp-mt-resp { font-size:12px; color:var(--lc-ouro2); background:rgba(0,0,0,.25); padding:5px 7px; line-height:1.4; }
#lc-compacto .lc-cp-pj .lc-cp-mt-resp i { color:var(--lc-mudo); }
#lc-compacto .lc-cp-pj .lc-cp-mt-perg { display:flex; gap:5px; }
#lc-compacto .lc-cp-pj .lc-cp-mt-perg input { flex:1; min-width:0; height:26px; background:var(--lc-bg); border:1px solid var(--lc-linha); color:var(--lc-ouro2);
  padding:0 7px; font:inherit; font-size:11.5px; user-select:text; }
#lc-compacto .lc-cp-pj .lc-cp-mt-perg .lc-cp-btn { height:26px; padding:0 9px; font-size:11.5px; display:inline-flex; align-items:center; }
#lc-compacto .lc-cp-pj .lc-cp-lics summary { cursor:pointer; font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--lc-mudo); margin-bottom:5px; }
#lc-compacto .lc-cp-pj .lc-cp-lic { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:5px; }
#lc-compacto .lc-cp-pj .lc-cp-lic li { font-size:12px; color:var(--lc-ouro2); padding:6px 8px; background:var(--lc-pan); border-left:3px solid var(--lc-amarelo); line-height:1.35; }
#lc-compacto .lc-cp-pj .lc-cp-lic li.lc-cp-pos { border-left-color:#3fbf77; }
#lc-compacto .lc-cp-pj .lc-cp-lic li.lc-cp-mudo { color:var(--lc-mudo); border-left-color:var(--lc-linha); }
#lc-compacto .lc-cp-pj .lc-cp-lic.lc-cp-carregando { opacity:.45; }
#lc-compacto .lc-cp-pj .lc-cp-vs { border:1px solid var(--lc-linha); background:var(--lc-pan); padding:7px 9px; }
#lc-compacto .lc-cp-pj .lc-cp-vs-cab { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:6px; margin-bottom:5px; font-size:11.5px; color:var(--lc-ouro2); }
#lc-compacto .lc-cp-pj .lc-cp-vs-cab .lc-cp-e { display:flex; gap:5px; align-items:center; min-width:0; white-space:nowrap; overflow:hidden; }
#lc-compacto .lc-cp-pj .lc-cp-vs-cab .lc-cp-d { display:flex; gap:5px; align-items:center; justify-content:flex-end; min-width:0; white-space:nowrap; overflow:hidden; }
#lc-compacto .lc-cp-pj .lc-cp-vs-cab .lc-cp-meio { font-size:10px; color:var(--lc-mudo); letter-spacing:.1em; text-transform:uppercase; }
#lc-compacto .lc-cp-pj .lc-cp-vsl { display:grid; grid-template-columns:44px 1fr 74px 1fr 44px; gap:5px; align-items:center; font-size:11.5px; height:19px; }
#lc-compacto .lc-cp-pj .lc-cp-v1 { text-align:right; color:var(--lc-ouro2); } #lc-compacto .lc-cp-pj .lc-cp-v2 { color:var(--lc-ouro2); }
#lc-compacto .lc-cp-pj .lc-cp-v1.lc-cp-m, #lc-compacto .lc-cp-pj .lc-cp-v2.lc-cp-m { color:#7fe3f0; font-weight:600; }
#lc-compacto .lc-cp-pj .lc-cp-lb { text-align:center; color:var(--lc-mudo); font-size:10.5px; }
#lc-compacto .lc-cp-pj .lc-cp-b1, #lc-compacto .lc-cp-pj .lc-cp-b2 { height:6px; background:#17222e; position:relative; }
#lc-compacto .lc-cp-pj .lc-cp-b1 i { position:absolute; right:0; top:0; bottom:0; background:#3a8fb7; }
#lc-compacto .lc-cp-pj .lc-cp-b2 i { position:absolute; left:0; top:0; bottom:0; background:#a8495a; }
#lc-compacto .lc-cp-pj .lc-cp-tm { font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--lc-mudo); display:flex; justify-content:space-between; margin-top:2px; }
#lc-compacto .lc-cp-pj .lc-cp-tm b { color:var(--lc-ouro2); letter-spacing:0; font-weight:600; }
#lc-compacto .lc-cp-pj .lc-cp-jg, #lc-compacto .lc-cp-pj .lc-cp-jg-h { display:grid; grid-template-columns:24px 1fr 46px 26px 38px 32px 47px; gap:5px; align-items:center; }
#lc-compacto .lc-cp-pj .lc-cp-jg { height:32px; border-bottom:1px solid rgba(60,60,65,.45); font-size:11.5px; color:var(--lc-ouro2); }
#lc-compacto .lc-cp-pj .lc-cp-jg.lc-cp-eu { background:linear-gradient(90deg,rgba(200,170,110,.15),rgba(200,170,110,0)); }
#lc-compacto .lc-cp-pj .lc-cp-jg.lc-cp-adv { background:linear-gradient(90deg,rgba(232,64,87,.12),rgba(232,64,87,0)); }
#lc-compacto .lc-cp-pj .lc-cp-jg .lc-cp-n { min-width:0; line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#lc-compacto .lc-cp-pj .lc-cp-jg .lc-cp-n small { display:block; color:var(--lc-mudo); font-size:10px; overflow:hidden; text-overflow:ellipsis; }
#lc-compacto .lc-cp-pj .lc-cp-jg .lc-cp-k { text-align:center; }
#lc-compacto .lc-cp-pj .lc-cp-jg .lc-cp-f, #lc-compacto .lc-cp-pj .lc-cp-jg .lc-cp-o { text-align:right; color:var(--lc-txt); }
#lc-compacto .lc-cp-pj .lc-cp-jg .lc-cp-dn { height:5px; background:#17222e; position:relative; }
#lc-compacto .lc-cp-pj .lc-cp-jg .lc-cp-dn i { position:absolute; left:0; top:0; bottom:0; background:var(--lc-ouro-esc); }
#lc-compacto .lc-cp-pj .lc-cp-jg.lc-cp-eu .lc-cp-dn i { background:var(--lc-ouro); }
#lc-compacto .lc-cp-pj .lc-cp-jg-h { font-size:9.5px; color:var(--lc-mudo); letter-spacing:.06em; text-transform:uppercase; }
#lc-compacto .lc-cp-pj .lc-cp-jg-h span:nth-child(3) { text-align:center; }
#lc-compacto .lc-cp-pj .lc-cp-jg-h span:nth-child(4), #lc-compacto .lc-cp-pj .lc-cp-jg-h span:nth-child(6) { text-align:right; }
#lc-compacto .lc-cp-pj .lc-cp-centro { text-align:center; padding:4px 0 2px; }
#lc-compacto .lc-cp-pj .lc-cp-replay { flex:none; padding:5px 12px; border-top:1px solid var(--lc-linha2); background:rgba(1,10,19,.9); }
#lc-compacto .lc-cp-pj .lc-cp-base { flex:none; padding:7px 12px 9px; display:flex; flex-direction:column; gap:6px; border-top:1px solid var(--lc-linha2); background:rgba(1,10,19,.9); }
#lc-compacto .lc-cp-pj .lc-cp-linha-jogar { display:flex; gap:6px; }
#lc-compacto .lc-cp-pj .lc-cp-lobby { flex:1; font-size:13px; letter-spacing:.08em; padding:6px 6px; }
#lc-compacto .lc-cp-pj .lc-cp-jogar { flex:1.7; min-width:0; display:flex; flex-direction:column; align-items:center; gap:1px; padding:8px 6px 5px; cursor:pointer;
  background:linear-gradient(180deg,#1e5a6b,#0b3a49); border:2px solid var(--lc-azul2); color:var(--lc-ouro2); font-family:inherit;
  font-size:18px; font-weight:700; letter-spacing:.12em; line-height:1.15; }
#lc-compacto .lc-cp-pj .lc-cp-jogar small { font-size:10.5px; letter-spacing:.02em; font-weight:400; color:var(--lc-txt); max-width:100%; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; }
#lc-compacto .lc-cp-pj .lc-cp-jogar:hover { filter:brightness(1.15); }
#lc-compacto .lc-cp-pj .lc-cp-jogar.lc-cp-armado { background:linear-gradient(180deg,#6b4a1e,#46300f); border-color:var(--lc-amarelo); font-size:15px; }
#lc-compacto .lc-cp-pj .lc-cp-jogar[disabled] { filter:grayscale(1) brightness(.7); cursor:not-allowed; }
#lc-compacto .lc-cp-pj .lc-cp-freio { border:1px solid var(--lc-amarelo); background:rgba(242,193,78,.08); color:var(--lc-ouro2); font-size:12.5px; padding:7px 10px; }
#lc-compacto .lc-cp-pj .lc-cp-freio .lc-cp-cont { float:right; margin-left:8px; color:var(--lc-amarelo); font-weight:700; }
#lc-compacto .lc-cp-pj .lc-cp-linha-bts { display:flex; gap:6px; }
#lc-compacto .lc-cp-pj .lc-cp-linha-bts .lc-cp-btn { flex:1; padding:6px 8px; }
`;
