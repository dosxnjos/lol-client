// Tela 4 do client compacto: pós-jogo (roadmap/2026-10-13-client-compacto.md, passo 7; protótipo aprovado em
// 13/10/2026, temp/2026-10-13-prototipo-client-compacto.html, aba 4). Contrato das telas: pengu/compacto/index.js.
// - WaitingForStats: "carregando" (a honra do PreEndOfGame é da Riot: o roteador expande e remonta no EndOfGame).
// - EndOfGame: V/D, KDA, farm/min e PDL; as 3 lições do coletor (GET /licoes/<gameId>); jogar de novo (fila-rapida.js
//   jogarDeNovo: mesma fila da partida, freios de freios.js, em grupo só volta ao lobby); ver análise completa (expande e
//   abre o #lc-posjogo pelo posjogo/index.js, que com a camada à vista não abre sozinho); fechar (dismiss-stats).
// Fontes: eog-stats-block (só o jogador local: nome de terceiro nunca entra), sessão do gameflow (gameId, fila, mapa).
// PDL [S, a medir no passo 1]: current-lp-change-notification com o gameId desta partida; senão a diferença do
// current-ranked-stats entre a 1ª leitura (WaitingForStats, guardada por partida) e as seguintes, por até 3 min.
// Campo ausente ou estado estranho nunca quebra: vira "–" com o motivo no title. Botão que não pode agir fica cinza com
// o motivo. Erro de código = o roteador devolve o client normal. Importável no node (tools/teste-compacto-posjogo.mjs).
import { h, estilo, fotoCampeao } from './comum.js';
import { jogarDeNovo, FILAS_COM_POSICAO } from '../fila-rapida.js';
import { criarConfirmacao, cliqueComFreio, JANELA_MS } from '../freios.js';
import { botaoChat } from './chat-botao.js';

export const NOMES_FILA = { 420: 'Ranqueada Solo/Duo', 440: 'Ranqueada Flex', 400: 'Normal (escolha)', 430: 'Normal (às cegas)',
  450: 'ARAM', 490: 'Partida rápida' };
export const FILA_RANKED = { 420: 'RANKED_SOLO_5x5', 440: 'RANKED_FLEX_SR' };
const POSICOES = { TOP: 'Topo', JUNGLE: 'Selva', MIDDLE: 'Meio', BOTTOM: 'Atirador', UTILITY: 'Suporte', FILL: 'Qualquer' };
const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const TIER_PT = { IRON: 'Ferro', BRONZE: 'Bronze', SILVER: 'Prata', GOLD: 'Ouro', PLATINUM: 'Platina', EMERALD: 'Esmeralda',
  DIAMOND: 'Diamante', MASTER: 'Mestre', GRANDMASTER: 'Grão-Mestre', CHALLENGER: 'Desafiante' };
const DIVISOES = ['IV', 'III', 'II', 'I'];
// prazos (ms): eog que não chega, janela do PDL (a mesma do medidor), lições (backfill do coletor leva 5–160 s)
export const PRAZOS = { eogMs: 60000, eogCadaMs: 2000, pdlMs: 180000, pdlCadaMs: 5000, licoesMs: 300000, coletorForaMs: 15000, tiqueMs: 500 };
// relógio da tela (o teste troca; o roteador já injeta os timers): agora() ms e data() para o freio de madrugada
export const _relogio = { agora: () => Date.now(), data: () => new Date() };

// ---- funções puras (teste) ----
const num = v => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v));
const pad = n => String(n).padStart(2, '0');

// eog-stats-block -> resumo do jogador local | null. Nada de identidade: só campeão, números e resultado.
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
    // false = personalizada/treino (o jogar de novo não serve); null = não sei
    matchmaking: typeof eog.gameType === 'string' ? eog.gameType === 'MATCHED_GAME' : null,
  };
}

// sessão do gameflow -> {gameId, fila, mapa, custom} (campos que não vieram ficam null)
export function infoDaPartida(s) {
  const gd = s?.gameData && typeof s.gameData === 'object' ? s.gameData : {};
  const gid = num(gd.gameId), fila = num(gd.queue?.id), mapa = num(s?.map?.id ?? gd.queue?.mapId);
  return { gameId: gid > 0 ? gid : null, fila: fila > 0 ? fila : null, mapa: mapa > 0 ? mapa : null,
    custom: typeof gd.isCustomGame === 'boolean' ? gd.isCustomGame : null };
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
    return depois.pdl === antes.pdl ? null : { delta: depois.pdl - antes.pdl, fonte: 'diferença do PDL antes/depois' };
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

// ---- memória entre montagens (a honra do PreEndOfGame expande e a tela é montada de novo no EndOfGame) ----
// por gameId: o PDL "antes" lido no WaitingForStats e as lições que já chegaram. Só as 3 últimas partidas.
const memoria = new Map();
const lembrar = gid => {
  if (!gid) return {};
  if (!memoria.has(gid)) { memoria.set(gid, {}); while (memoria.size > 3) memoria.delete(memoria.keys().next().value); }
  return memoria.get(gid);
};
export const _esquecer = () => memoria.clear(); // só teste

// ---- tela ----
const estados = new WeakMap(); // ctx -> estado da montagem

export function montar(raiz, ctx) {
  estilo('lc-cp-posjogo-estilo', CSS_POSJOGO);
  const est = {
    gameId: null, fila: null, mapa: null, custom: null, resumo: null, eogDesde: null, ultimoEog: 0, eogEmVoo: false,
    fimEm: null, licoes: { estado: 'carregando', lista: [] }, licoesInicio: 0, licoesEmVoo: false, licoesAgendada: false,
    pdl: { estado: 'lendo' }, rank: null, ultimoPdl: 0, pdlEmVoo: false, grupo: null, eu: null,
    ocupado: false, confirmacao: null, textoFreio: '', armadoVisto: false, corpo: null, cont: null,
  };
  estados.set(ctx, est);
  botaoChat(ctx); // protótipo (tela 4): 💬 com o contador antes do expandir ("mais uma?" no fim da partida)
  est.corpo = h('div', { class: 'lc-cp-pj' });
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
  return carregar(ctx, est);
}

// WaitingForStats -> EndOfGame sem trocar de tela
export function atualizar(ctx) {
  const est = estados.get(ctx);
  if (!est) return;
  if (ctx.fase === 'EndOfGame' && !est.fimEm) est.fimEm = _relogio.agora();
  pintar(ctx, est);
  if (!est.resumo) lerEog(ctx, est);
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
}

function receberEog(ctx, est, eog) {
  const r = resumoDoEog(eog);
  if (!r || !r.gameId) return;
  // eog de outra partida (o client guarda o último): só vale o desta; sem gameId da sessão, só no EndOfGame
  if (est.gameId ? r.gameId !== est.gameId : ctx.fase !== 'EndOfGame') return;
  const novo = !est.gameId;
  est.gameId = r.gameId;
  est.resumo = r; // o client manda o mesmo eog até 3 vezes em ~100 ms (ARMADILHAS § LCU): vale o último
  pintar(ctx, est);
  if (novo) { lerPdl(ctx, est); lerLicoes(ctx, est); }
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
  if (typeof col !== 'function') { est.licoes = { estado: 'fora', lista: [] }; pintar(ctx, est); return; }
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
  } else if (num(r.dados?.tentarDeNovoS) > 0) {
    est.licoes = { estado: 'esperando', lista: [] };
    espera = num(r.dados.tentarDeNovoS) * 1000;
  } else {
    est.licoes = { estado: 'sem', lista: [], motivo: String(r.dados?.erro || `coletor respondeu ${r.status}`) };
  }
  if (espera) {
    if (_relogio.agora() - est.licoesInicio + espera > PRAZOS.licoesMs) {
      est.licoes = { estado: 'sem', lista: [], motivo: est.licoes.estado === 'fora' ? 'coletor fora do ar' : 'o coach não leu a partida a tempo' };
    } else if (!est.licoesAgendada) {
      est.licoesAgendada = true;
      ctx.tempo(() => { est.licoesAgendada = false; return lerLicoes(ctx, est); }, espera);
    }
  }
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

// ---- jogar de novo, análise, fechar ----

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

async function clicarJogar(ctx, est) {
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
  } else if (r?.status === 'buscando') ctx.avisar('de volta à fila (só porque tu clicou)');
  else if (r?.status === 'grupo') ctx.avisar(r.motivo);
  else if (r?.status === 'recusa') ctx.avisar(`jogar de novo: ${r.motivo}`, true);
  if (ctx.vivo()) pintar(ctx, est);
}

// expande ANTES de abrir: com a camada à vista o #lc-posjogo fica escondido (html.lc-modo-compacto, modo.js)
function verAnalise(ctx, est) {
  const id = est.gameId, abrir = ctx.servicos?.posjogo?.abrirPainel;
  ctx.expandir();
  if (!id) { ctx.avisar('não sei qual partida analisar: Ctrl+K > analisar última partida', true); return; }
  if (typeof abrir !== 'function') { ctx.avisar('painel do pós-jogo indisponível: Ctrl+K > analisar última partida', true); return; }
  try { abrir(id, { fimDePartida: true })?.catch?.(() => {}); } catch { /* o client normal já está à vista */ }
}

async function fechar(ctx) {
  if (ctx.fase !== 'EndOfGame') { ctx.avisar('espera as estatísticas chegarem', true); return; }
  // o mesmo que o ✕ da tela de estatísticas da Riot: sai do fim de partida, nunca busca
  const r = await ctx.lcu('POST', '/lol-end-of-game/v1/state/dismiss-stats');
  if (!r.ok) ctx.avisar(`não consegui fechar a tela de fim de partida (${r.status})`, true);
}

// ---- desenho (h() = textContent: texto do eog e do coletor nunca vira HTML) ----
function pintarTitulo(ctx, est) {
  const t = ctx.titulo;
  if (!t?.replaceChildren) return;
  const nome = est.eu?.nome || '';
  const icone = est.eu?.icone > 0 ? `/lol-game-data/assets/v1/profile-icons/${est.eu.icone}.jpg` : '';
  t.replaceChildren(h('div', { class: 'lc-cp-pj-id' },
    h('span', { class: 'lc-cp-pj-av', style: { backgroundImage: icone ? `url("${icone}")` : '' } }, icone ? '' : (nome.slice(0, 1).toUpperCase() || '?')),
    h('div', {}, h('b', {}, nome || 'pós-jogo'), h('small', {}, est.rank ? textoRank(est.rank) : 'fim de partida'))));
}

function pintar(ctx, est) {
  if (!ctx.vivo() || !est.corpo) return;
  pintarTitulo(ctx, est);
  const fim = ctx.fase === 'EndOfGame', r = est.resumo;
  const filhos = [];
  // resultado
  if (!fim || (!r && !est.eogDesistiu)) {
    filhos.push(h('div', { class: 'lc-cp-res lc-cp-carr' }, h('b', {}, 'CARREGANDO…'), h('small', {}, 'o client está juntando as estatísticas da partida')));
  } else if (!r) {
    filhos.push(h('div', { class: 'lc-cp-res lc-cp-carr' }, h('b', {}, 'FIM DE PARTIDA'),
      h('small', {}, 'as estatísticas não chegaram: veja no client normal')));
  } else {
    const [classe, titulo] = r.refeita ? ['lc-cp-r', 'REFEITA'] : r.vitoria === true ? ['lc-cp-v', 'VITÓRIA'] : r.vitoria === false ? ['lc-cp-d', 'DERROTA'] : ['', 'FIM DE PARTIDA'];
    const partes = [nomeFila(est.fila), textoHora(r.inicioMs)].filter(Boolean).join(' · ');
    filhos.push(h('div', { class: `lc-cp-res ${classe}` }, h('b', {}, titulo),
      h('small', {}, partes, ' · ', r.campeaoId ? fotoCampeao(r.campeaoId, { tam: 18, nome: r.campeao || '' }) : null,
        ` ${r.campeao || 'campeão'}`, r.duracaoS ? ` · ${textoDuracao(r.duracaoS)}` : '')));
  }
  // números
  const vazio = !fim || !r;
  const pdl = est.pdl;
  const pdlTxt = pdl.estado === 'ok' ? textoPdl(pdl) : pdl.estado === 'lendo' && fim ? '…' : '–';
  const pdlClasse = pdl.estado === 'ok' ? (pdl.mudou === 'subiu' || pdl.delta > 0 ? 'lc-cp-mais' : pdl.mudou === 'caiu' || pdl.delta < 0 ? 'lc-cp-menos' : '') : '';
  const pdlTitulo = pdl.estado === 'ok' ? (pdl.mudou ? `${pdl.mudou === 'subiu' ? 'subiu' : 'caiu'} de divisão: ${textoRank(pdl.depois)}` : `fonte: ${pdl.fonte}`)
    : pdl.estado === 'lendo' ? 'esperando a variação de PDL do client' : pdl.motivo || '';
  filhos.push(h('div', { class: 'lc-cp-nums' + (vazio ? ' lc-cp-carregando' : '') },
    h('div', { title: r?.refeita ? 'partida refeita (remake)' : undefined }, h('b', {}, !vazio && r.kda ? r.kda.join(' / ') : '– / – / –'), 'KDA'),
    h('div', {}, h('b', {}, !vazio ? textoFarm(r.farmMin) : '–'), 'farm/min'),
    h('div', { title: pdlTitulo || undefined }, h('b', { class: pdlClasse || undefined }, pdlTxt), 'PDL')));
  // lições
  const lic = est.licoes;
  filhos.push(h('div', { class: 'lc-cp-rot' }, lic.estado === 'ok' && lic.lista.length !== 3 ? 'lições' : '3 lições'));
  if (lic.estado === 'ok') {
    filhos.push(h('ul', { class: 'lc-cp-lic' }, lic.lista.map(l => h('li', { class: l.positiva ? 'lc-cp-pos' : undefined, title: l.texto }, `${l.positiva ? '✓' : '⚠'} ${l.texto}`))));
  } else if (lic.estado === 'fora' || lic.estado === 'sem') {
    const texto = lic.estado === 'fora' ? 'coletor fora do ar: as lições ficam na análise completa' : `sem lições: ${lic.motivo || 'nada a mostrar'}`;
    filhos.push(h('ul', { class: 'lc-cp-lic' }, h('li', { class: 'lc-cp-mudo', title: texto }, texto)));
  } else {
    const t = lic.estado === 'esperando' ? 'o coach está lendo a partida' : 'carregando as lições';
    filhos.push(h('ul', { class: 'lc-cp-lic lc-cp-carregando', title: t }, h('li', {}, '…'), h('li', {}, '…'), h('li', {}, '…')));
  }
  if (!fim) {
    filhos.push(h('div', { class: 'lc-cp-nota' }, 'leva poucos segundos; logo antes, a votação de honra abre o client normal.'));
  } else {
    // jogar de novo + freio
    const armada = !!est.confirmacao?.armada();
    const b = botaoJogar({ fase: ctx.fase, cfg: ctx.cfg, fila: est.fila, custom: est.custom, resumo: r, grupo: est.grupo, armada });
    const bt = h('button', {
      class: 'lc-cp-jogar' + (b.armada ? ' lc-cp-armado' : ''), dataset: { a: 'jogar' }, title: b.motivo || (b.armada ? `${est.textoFreio} (clica de novo em até ${JANELA_MS / 1000} s)` : undefined),
      on: { click: ctx.seguro(() => clicarJogar(ctx, est)) },
    }, est.ocupado ? 'UM INSTANTE…' : b.texto, h('small', {}, b.sub));
    bt.disabled = !!b.motivo || est.ocupado;
    filhos.push(bt);
    est.cont = null;
    if (b.armada) {
      est.cont = h('span', { class: 'lc-cp-cont' }, `${Math.max(0, Math.ceil((est.armadoAte - _relogio.agora()) / 1000))} s`);
      filhos.push(h('div', { class: 'lc-cp-freio', role: 'status' }, est.cont, `⚠ ${est.textoFreio}`));
    }
    // análise completa só no Summoner's Rift (a análise do pós-jogo é dele: docs/INSIGHTS.md)
    const analise = est.mapa === null || est.mapa === 11;
    filhos.push(h('div', { class: 'lc-cp-linha-bts' },
      analise ? h('button', { class: 'lc-cp-btn', dataset: { a: 'analise' }, title: 'abre o client normal com as 6 abas do pós-jogo',
        on: { click: ctx.seguro(() => verAnalise(ctx, est)) } }, '⤢ ver análise completa') : null,
      h('button', { class: 'lc-cp-btn', dataset: { a: 'fechar-pj' }, title: 'sai da tela de fim de partida (não busca)',
        on: { click: ctx.seguro(() => fechar(ctx)) } }, 'fechar')));
  }
  est.corpo.replaceChildren(...filhos);
}

// visual do protótipo aprovado (aba 4). Tudo do corpo fica sob .lc-cp-pj: os <style> das telas nunca saem do documento
// e o lobby usa os mesmos nomes (.lc-cp-jogar, .lc-cp-freio...); sem o escopo, o do pós-jogo vazava para a tela 1
// (JOGAR de 26 px virava 21 px até recarregar). O título (.lc-cp-pj-id) mora no topo, fora do .lc-cp-pj.
export const CSS_POSJOGO = `
#lc-compacto .lc-cp-pj { display:contents; }
#lc-compacto .lc-cp-pj-id { display:flex; gap:8px; align-items:center; min-width:0; }
#lc-compacto .lc-cp-pj-av { width:30px; height:30px; border-radius:50%; border:2px solid var(--lc-ouro); display:grid; place-items:center; flex:none;
  background:#1e3a5f center/cover no-repeat; color:var(--lc-ouro2); font-weight:700; font-size:13px; }
#lc-compacto .lc-cp-pj-id b { display:block; color:var(--lc-ouro2); font-size:13px; line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#lc-compacto .lc-cp-pj-id small { display:block; color:var(--lc-mudo); font-size:11px; white-space:nowrap; }
#lc-compacto .lc-cp-pj .lc-cp-res { text-align:center; padding:14px 0 6px; }
#lc-compacto .lc-cp-pj .lc-cp-res b { display:block; font-size:34px; letter-spacing:.2em; font-weight:700; color:var(--lc-ouro2); }
#lc-compacto .lc-cp-pj .lc-cp-res.lc-cp-v b { color:#7fe3f0; }
#lc-compacto .lc-cp-pj .lc-cp-res.lc-cp-d b { color:#ff8a9a; }
#lc-compacto .lc-cp-pj .lc-cp-res.lc-cp-carr b { font-size:22px; }
#lc-compacto .lc-cp-pj .lc-cp-res small { display:flex; justify-content:center; align-items:center; gap:3px; flex-wrap:wrap; color:var(--lc-mudo); font-size:12px; }
#lc-compacto .lc-cp-pj .lc-cp-res small .lc-cp-foto { font-size:9px; }
#lc-compacto .lc-cp-pj .lc-cp-nums { display:grid; grid-template-columns:repeat(3,1fr); border:1px solid var(--lc-linha); background:var(--lc-pan); }
#lc-compacto .lc-cp-pj .lc-cp-nums > div { padding:8px; text-align:center; border-right:1px solid var(--lc-linha); font-size:11px; color:var(--lc-mudo); }
#lc-compacto .lc-cp-pj .lc-cp-nums > div:last-child { border-right:none; }
#lc-compacto .lc-cp-pj .lc-cp-nums b { display:block; font-size:19px; color:var(--lc-ouro2); font-weight:600; }
#lc-compacto .lc-cp-pj .lc-cp-nums b.lc-cp-mais { color:#7fe3f0; }
#lc-compacto .lc-cp-pj .lc-cp-nums b.lc-cp-menos { color:#ff8a9a; }
#lc-compacto .lc-cp-pj .lc-cp-nums.lc-cp-carregando, #lc-compacto .lc-cp-pj .lc-cp-lic.lc-cp-carregando { opacity:.45; }
#lc-compacto .lc-cp-pj .lc-cp-lic { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:5px; }
#lc-compacto .lc-cp-pj .lc-cp-lic li { font-size:12.5px; color:var(--lc-ouro2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; padding:6px 8px;
  background:var(--lc-pan); border-left:3px solid var(--lc-amarelo); }
#lc-compacto .lc-cp-pj .lc-cp-lic li.lc-cp-pos { border-left-color:#3fbf77; }
#lc-compacto .lc-cp-pj .lc-cp-lic li.lc-cp-mudo { color:var(--lc-mudo); border-left-color:var(--lc-linha); }
#lc-compacto .lc-cp-pj .lc-cp-jogar { margin-top:6px; display:flex; flex-direction:column; align-items:center; gap:2px; padding:12px 8px 8px; cursor:pointer;
  background:linear-gradient(180deg,#1e5a6b,#0b3a49); border:2px solid var(--lc-azul2); color:var(--lc-ouro2); font-family:inherit;
  font-size:21px; font-weight:700; letter-spacing:.14em; line-height:1.15; }
#lc-compacto .lc-cp-pj .lc-cp-jogar small { font-size:11px; letter-spacing:.04em; font-weight:400; color:var(--lc-txt); }
#lc-compacto .lc-cp-pj .lc-cp-jogar:hover { filter:brightness(1.15); }
#lc-compacto .lc-cp-pj .lc-cp-jogar.lc-cp-armado { background:linear-gradient(180deg,#6b4a1e,#46300f); border-color:var(--lc-amarelo); font-size:17px; }
#lc-compacto .lc-cp-pj .lc-cp-jogar[disabled] { filter:grayscale(1) brightness(.7); cursor:not-allowed; }
#lc-compacto .lc-cp-pj .lc-cp-freio { border:1px solid var(--lc-amarelo); background:rgba(242,193,78,.08); color:var(--lc-ouro2); font-size:12.5px; padding:7px 10px; }
#lc-compacto .lc-cp-pj .lc-cp-freio .lc-cp-cont { float:right; margin-left:8px; color:var(--lc-amarelo); font-weight:700; }
#lc-compacto .lc-cp-pj .lc-cp-linha-bts { display:flex; gap:6px; }
#lc-compacto .lc-cp-pj .lc-cp-linha-bts .lc-cp-btn { flex:1; }
`;
