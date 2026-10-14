// Tela 2 do client compacto: na fila (roadmap/2026-10-13-client-compacto.md, passo 4; protótipo aprovado em
// 13/10/2026, tela 2). Fase Matchmaking (contrato em compacto/index.js).
// - tempo na fila e estimativa do GET /lol-matchmaking/v1/search (timeInQueue, estimatedQueueTime, em segundos [S]);
//   entre uma leitura e outra o relógio anda sozinho aqui (1 s), sem pedir nada à LCU;
// - baixa prioridade (leaver): lowPriorityData.penaltyTimeRemaining > 0 vira contagem regressiva [S, a medir];
// - cancelar = DELETE /lol-lobby/v2/lobby/matchmaking/search, só por clique e só do líder; não-líder vê quem cancela;
//   liderança desconhecida = botão cinza com o motivo (o "⤢ expandir" do topo leva ao botão da Riot);
// - partida encontrada não é tela nova: o ReadyCheck é do aceite.js (o roteador cede).
// Nunca busca: esta tela não tem caminho para POST .../matchmaking/search.
import { h, estilo, campeoes } from './comum.js';
import { cabecalho, estadoGrupo, lerHoje, resumoHoje, sequenciaHoje, blocoDia, mmss, FILAS_CP, NOME_POS, CSS_LOBBY } from './tela-lobby.js';
import { FILAS_COM_POSICAO } from '../fila-rapida.js';

const ERROS = ['Error', 'ServiceError', 'ServiceShutdown', 'Invalid', 'AbandonedLowPriorityQueue'];

// busca (GET /lol-matchmaking/v1/search) -> o que a tela mostra. Só números e enum (nada de id de jogador).
export function estadoBusca(b) {
  if (!b || typeof b !== 'object') return { tipo: 'entrando' };
  const lp = b.lowPriorityData || {};
  const pena = Number(lp.penaltyTimeRemaining);
  const fila = Number(b.queueId) || null;
  const base = { fila, emFila: Number(b.timeInQueue) || 0, estimado: Number(b.estimatedQueueTime) || 0 };
  if (b.searchState === 'Found') return { ...base, tipo: 'achou' };
  if (ERROS.includes(b.searchState)) {
    const e = (Array.isArray(b.errors) ? b.errors : [])[0];
    return { ...base, tipo: 'erro', motivo: String(e?.errorType || e?.message || b.searchState) };
  }
  if (Number.isFinite(pena) && pena > 0) return { ...base, tipo: 'baixa', pena, motivo: String(lp.reason || '') };
  return { ...base, tipo: 'buscando' };
}

// texto "enquanto espera" com os favoritos (stats do histórico pelo champselect.js). nomes: Map id -> {nome}
export function textoEspera(favoritos, estat, nomes) {
  const partes = [];
  for (const id of favoritos || []) {
    const g = estat?.(id)?.geral;
    if (!g?.n) continue;
    const nome = nomes?.get?.(Number(id))?.nome || `campeão ${id}`;
    partes.push(`${nome}: ${g.n} ${g.n === 1 ? 'partida' : 'partidas'}, ${g.winrate}% de vitória`);
  }
  return partes.length ? partes.join('. ') + '.' : '';
}

export function criarTelaFila({ agora = Date.now } = {}) {
  let st = null;

  function montar(raiz, ctx) {
    estilo('lc-cp-lobby-estilo', CSS_LOBBY);
    estilo('lc-cp-fila-estilo', CSS_FILA);
    const s = st = { ctx, raiz, busca: { tipo: 'entrando' }, lidaEm: agora(), g: null, cancelando: false, espera: '', hoje: null, refs: {}, agora };
    const cab = cabecalho(ctx, { agora });
    s.cab = cab;
    s.pintar = () => { if (ctx.vivo()) pintar(s); };

    const aplicarBusca = b => { s.busca = estadoBusca(b); s.lidaEm = agora(); s.pintar(); };
    const lerBusca = async () => {
      const r = await ctx.lcu('GET', '/lol-matchmaking/v1/search');
      if (r.ok) aplicarBusca(r.json);
      else if (r.status !== 404) { /* falha de leitura: mantém o que tinha, o relógio local segue */ }
    };
    const lerLobby = async () => { const r = await ctx.lcu('GET', '/lol-lobby/v2/lobby'); s.g = estadoGrupo(r); s.pintar(); };
    const lerEspera = async () => {
      const champ = ctx.servicos?.champ;
      if (typeof champ?.estatisticas !== 'function') return;
      const nomes = await campeoes().catch(() => new Map());
      s.espera = textoEspera(ctx.cfg?.compacto?.favoritos || [], champ.estatisticas, nomes);
      s.pintar();
    };
    s.hoje = lerHoje(ctx, agora(), () => { s.hoje = lerHoje(ctx, agora()); s.pintar(); });

    s.cancelar = ctx.seguro(async () => {
      if (s.cancelando) return;
      if (s.g?.lider !== true) { ctx.avisar(s.g?.lider === false ? 'em grupo só o líder cancela' : 'não sei se tu é o líder: cancela pelo client normal', true); return; }
      s.cancelando = true; s.pintar();
      try {
        const r = await ctx.lcu('DELETE', '/lol-lobby/v2/lobby/matchmaking/search');
        if (!r.ok) ctx.avisar(`não consegui cancelar (${r.status}): usa o client normal`, true);
        // ok: a fase volta a Lobby e o roteador troca para a tela 1
      } finally { s.cancelando = false; s.pintar(); }
    });

    s.pintar();
    lerBusca().catch(() => {});
    lerLobby().catch(() => {});
    lerEspera().catch(() => {});
    ctx.observar('/lol-matchmaking/v1/search', msg => { if (msg?.eventType !== 'Delete' && msg?.data) aplicarBusca(msg.data); });
    ctx.observar('/lol-lobby/v2/lobby', msg => { s.g = estadoGrupo(msg?.eventType === 'Delete' || !msg?.data ? { ok: false, status: 404 } : { ok: true, status: 200, json: msg.data }); s.pintar(); });
    // relógio local (sem redesenhar: o clique no cancelar não pode cair num redesenho) e releitura a cada 5 s
    ctx.intervalo(() => { if (s.refs.relogio) s.refs.relogio.textContent = textoRelogio(s); }, 1000);
    ctx.intervalo(() => { lerBusca().catch(() => {}); }, 5000);
  }

  function desmontar() { st = null; }
  return { montar, desmontar, estado: () => st };
}

function textoRelogio(s) {
  const passou = Math.max(0, (s.agora() - s.lidaEm) / 1000);
  const b = s.busca;
  if (b.tipo === 'baixa') return mmss(b.pena - passou);
  if (b.tipo === 'achou' || b.tipo === 'erro') return '';
  return mmss((b.emFila || 0) + passou);
}

function pintar(s) {
  const { busca: b, g } = s;
  const filaId = b.fila || g?.fila || null;
  const f = FILAS_CP[filaId] || { n: filaId ? `fila ${filaId}` : 'fila' };
  const comPos = FILAS_COM_POSICAO.includes(filaId) && g?.pos1 && g?.pos2;
  const lider = g?.lider;
  const filhos = [];
  s.refs = {};
  const relogio = h('b', { dataset: { tick: 'fila' } }, textoRelogio(s));
  s.refs.relogio = relogio;
  const botaoCancelar = () => {
    if (lider === true) return h('button', { class: 'lc-cp-btn lc-cp-verm lc-cp-cancelar', disabled: s.cancelando, dataset: { a: 'cancelar-fila' }, on: { click: () => s.cancelar?.() } }, s.cancelando ? '…' : 'cancelar');
    if (lider === false) {
      const nomeLider = g.membros?.find(m => m.lider && !m.eu)?.nome;
      return h('div', { class: 'lc-cp-nota lc-cp-centro' }, `só o líder${nomeLider ? ` (${nomeLider})` : ''} cancela`);
    }
    return h('button', { class: 'lc-cp-btn lc-cp-verm lc-cp-cancelar', disabled: true, title: 'não sei se tu é o líder: cancela pelo client normal (⤢ expandir)', dataset: { a: 'cancelar-fila' } },
      g ? 'cancelar (não sei se tu é o líder)' : 'cancelar (lendo o grupo…)');
  };

  if (b.tipo === 'baixa') {
    filhos.push(h('div', { class: 'lc-cp-anel lc-cp-anel-pena' }, h('div', {}, relogio, h('small', {}, 'espera extra antes de buscar'))));
    filhos.push(h('div', { class: 'lc-cp-pena' }, '⏳ ', h('b', {}, 'fila de baixa prioridade'), ' (saída de partida). A busca de verdade começa quando a contagem zerar; o client conta sozinho.'));
    filhos.push(botaoCancelar());
  } else if (b.tipo === 'achou') {
    filhos.push(h('div', { class: 'lc-cp-anel lc-cp-parado' }, h('div', {}, h('b', { class: 'lc-cp-achou' }, 'partida', h('br'), 'encontrada'))));
  } else if (b.tipo === 'erro') {
    filhos.push(h('div', { class: 'lc-cp-anel lc-cp-anel-pena lc-cp-parado' }, h('div', {}, h('b', { class: 'lc-cp-achou' }, 'fila', h('br'), 'parada'))));
    filhos.push(h('div', { class: 'lc-cp-pena' }, 'o client parou a busca: ', h('b', {}, b.motivo)));
    filhos.push(botaoCancelar());
  } else {
    const est = b.estimado > 0 ? `na fila · estimado ${mmss(b.estimado)}` : 'na fila';
    filhos.push(h('div', { class: 'lc-cp-anel' }, h('div', {}, relogio, h('small', {}, b.tipo === 'entrando' ? 'entrando na fila' : est))));
    filhos.push(h('div', { class: 'lc-cp-centro lc-cp-filanome' }, `${f.n}${comPos ? ` · ${NOME_POS[g.pos1]} / ${NOME_POS[g.pos2]}` : ''}`));
    filhos.push(botaoCancelar());
  }

  if (s.espera) filhos.push(h('div', { class: 'lc-cp-dica lc-cp-fim' }, h('b', {}, 'enquanto espera'), s.espera));
  const hoje = resumoHoje(s.hoje);
  const seq = sequenciaHoje(s.hoje);
  const terceira = ['sequência', !s.hoje ? '—' : seq.n >= 2 ? `${seq.n} ${seq.tipo === 'V' ? 'vitórias' : 'derrotas'}` : 'nenhuma'];
  const dia = blocoDia(hoje, s.cab?.ranque?.(), terceira, { agoraMs: s.agora() });
  if (!s.espera) dia.classList.add('lc-cp-fim');
  filhos.push(dia);
  s.raiz.replaceChildren(...filhos);
}

export const CSS_FILA = `
#lc-compacto .lc-cp-anel { width:170px; height:170px; border-radius:50%; margin:10px auto 2px; border:3px solid var(--lc-azul2); display:grid;
  place-items:center; text-align:center; position:relative; flex:none; box-shadow:0 0 30px rgba(10,200,185,.18) inset; }
#lc-compacto .lc-cp-anel::after { content:""; position:absolute; inset:-3px; border-radius:50%; border:3px solid transparent;
  border-top-color:var(--lc-ouro); animation:lc-cp-gira 1.6s linear infinite; }
@keyframes lc-cp-gira { to { transform:rotate(360deg); } }
#lc-compacto .lc-cp-anel.lc-cp-anel-pena { border-color:var(--lc-verm); }
#lc-compacto .lc-cp-anel.lc-cp-parado { border-color:var(--lc-amarelo); }
#lc-compacto .lc-cp-anel.lc-cp-parado::after { animation:none; border-color:transparent; }
#lc-compacto .lc-cp-anel b { font-size:38px; color:var(--lc-ouro2); font-weight:300; display:block; line-height:1; }
#lc-compacto .lc-cp-anel b.lc-cp-achou { font-size:24px; }
#lc-compacto .lc-cp-anel small { font-size:11px; color:var(--lc-mudo); }
#lc-compacto .lc-cp-centro { text-align:center; }
#lc-compacto .lc-cp-filanome { color:var(--lc-ouro2); }
#lc-compacto .lc-cp-cancelar { align-self:center; padding:8px 30px; }
#lc-compacto .lc-cp-fim { margin-top:auto; }
`;

const padrao = criarTelaFila();
export const montar = padrao.montar;
export const desmontar = padrao.desmontar;
export const estadoTela = padrao.estado;
