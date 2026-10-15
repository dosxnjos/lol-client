// Tela 3 do client compacto: seleção de campeões do SR (filas 420/440/400 e personalizada no SR; o roteador manda o
// resto para a tela da Riot). Plano: roadmap/2026-10-13-client-compacto.md, passo 5; visual = protótipo aprovado em
// 13/10/2026 (temp/2026-10-13-prototipo-client-compacto.html, aba 3). Contrato de tela: cabeçalho de ./index.js.
// Importável no node (tools/teste-compacto-selecao.mjs): nada de window/document no topo do módulo.
//
// Linhas que não se cruzam (plano § guardrails):
// - nada decide pelo jogador: hover, ban, travar, troca, aceite de troca, skin, feitiço e runa são clique dele.
//   A única escrita automática que existe é a do runas.js (1 página), que segue dona dela; aqui não se repete.
// - nome nenhum: aliado = "aliado N", inimigo só pelo campeão e só com a ação de pick COMPLETA (o hover inimigo vaza
//   em actions[].championId com isInProgress e nos bans antes do ten_bans_reveal: ARMADILHAS § LCU, fixture real).
// - estado sai da sessão a cada evento (localPlayerCellId relido sempre: troca de ordem muda o dono do cellId).
// - erro aqui = client normal (o roteador expande): dodge custa PDL, tela quebrada não pode ficar na frente.
//
// Rotas (todas [H] no /help de 13/10/2026; o que é [S] está marcado):
//   GET  /lol-champ-select/v1/session (+ evento), pickable-champion-ids, bannable-champion-ids, skin-carousel-skins,
//        summoners/{slotId} (só os botões show*: enriquecimento opcional [S], falha calada)
//   PATCH session/actions/{id} {completed:false, championId} = hover/intenção; {completed:true, championId} = banir/travar
//        (os corpos do client da Riot, rcp-fe-lol-champ-select; medido na ranqueada de 14/10/2026). NUNCA o
//        POST session/actions/{id}/complete: sem corpo a LCU manda "lockIn championId: 0", devolve 204 e não trava nada
//        (LeagueClient.log, ARMADILHAS § LCU)
//   PATCH session/my-selection {selectedSkinId} | {spell1Id, spell2Id}
//   POST session/position-swaps|pick-order-swaps|champion-swaps/{id}/request|cancel|accept|decline
//        (a troca de campeão é o campo `trades` da sessão, mas a rota é champion-swaps)
//   GET  /lol-perks/v1/pages, /lol-perks/v1/currentpage; PUT /lol-perks/v1/currentpage <id puro> (ARMADILHAS § LCU)
import { h, fotoCampeao, campeoes, estilo, preferidasLobby } from './comum.js';
import { consultarRunas } from '../runas.js';
import { textoSelo } from '../champselect.js';
import { botaoChat, botaoCoach } from './chat-botao.js';

const CS = '/lol-champ-select/v1';
export const POS = { TOP: 'Topo', JUNGLE: 'Selva', MIDDLE: 'Meio', BOTTOM: 'Atirador', UTILITY: 'Suporte' };
// catálogo medido 13/10/2026 (summoner-spells.json, CLASSIC): reserva quando o client não responde
export const FEITICOS = { 1: 'Purificar', 3: 'Exaustão', 4: 'Flash', 6: 'Fantasma', 7: 'Curar', 11: 'Golpear', 12: 'Teleporte', 14: 'Incendiar', 21: 'Barreira' };
export const TROCAS = [
  { tipo: 'POSICAO', campo: 'positionSwaps', rota: 'position-swaps', botao: '⇄ posição', nome: 'posição', mostrar: 'showPositionSwaps' },
  { tipo: 'ORDEM', campo: 'pickOrderSwaps', rota: 'pick-order-swaps', botao: '⇅ ordem', nome: 'ordem', mostrar: 'showSwaps' },
  { tipo: 'CAMPEAO', campo: 'trades', rota: 'champion-swaps', botao: '⟲ campeão', nome: 'campeão', mostrar: 'showTrades' },
];
const MOTIVO = {
  BUSY: { todos: 'outra troca em andamento: aguarde a resposta' },
  INVALID: {
    POSICAO: 'troca de posição não vale agora (fora de fase, ou um de vocês já escolheu)',
    ORDEM: 'troca de ordem não vale agora (fora de fase, ou um de vocês já escolheu)',
    CAMPEAO: 'troca de campeão só depois que os dois travarem, e cada um precisa ter o campeão do outro',
  },
  AUSENTE: { todos: 'o client não oferece esta troca nesta fase' },
  ESCONDIDA: { todos: 'o client não oferece esta troca com este aliado agora' },
};
export const RESULTADO_MS = 6000; // quanto tempo "recusou/desistiu/aceitou" fica na linha do aliado
export const SILENCIO_MS = 3000, RELER_MS = 2000; // sem evento da sessão há SILENCIO_MS: relê por GET (a cada RELER_MS)
// Relógio da fase (relato de 14/10/2026 ~20:50, "contadores de tempo e a barra bugados"): o timer da sessão é uma FOTO tirada em
// internalNowInEpochMs, e a LCU repete a mesma foto quando outra coisa da sessão muda (champselect-real.json ev 16/17 e 44/45:
// mesmo {adjusted 31400, internalNow} 6,2 s depois) e na releitura por GET. Contar o adjusted a partir da chegada do evento
// fazia o número voltar (25 -> 32) e a barra voltar a 100%; numa FINALIZATION calma a releitura de 2 s prendia o número entre
// 30 e 28. Conta da Riot (rcp-fe-lol-champ-select 16.20): restante = adjusted - (agora - internalNow), número em floor.
// FOTO_MAX_MS: internalNow mais longe de agora que isso = relógio torto, conta da chegada (o de antes).
export const FOTO_MAX_MS = 120000;
export const _relogio = { agora: () => Date.now() }; // injetável (teste com relógio falso)
// fim da fase (ms do relógio local) pelo timer lido -> número
export function fimDaFase(timer, agora = _relogio.agora()) {
  const foto = Number(timer?.foto);
  const base = foto > 0 && Math.abs(agora - foto) <= FOTO_MAX_MS ? foto : agora;
  return base + Math.max(0, Number(timer?.restante) || 0);
}
// banir/travar: CONFERIR_MS depois do clique (e da resposta 2xx) a ação ainda aberta = o client não aceitou (aviso com a
// saída; nunca repete sozinho)
export const CONFERIR_MS = 3000;
// botão BANIR/TRAVAR nasce cinza por ARMAR_MS a cada ação nova (tipo ou id): o clique que ia para a grade ou para o
// BANIR anterior não cai num TRAVAR que acabou de surgir no mesmo lugar
export const ARMAR_MS = 700;
// escrita desta tela sem resposta no prazo = falhou (status 0, aviso com a saída): o fetch do CEF não tem prazo e o
// engasgo da LCU existe (ARMADILHAS § LCU); o hover tem prazo menor porque o travar pendente espera por ele
export const PRAZO_MS = 4000, PRAZO_HOVER_MS = 2000;
// hover igual ao último enviado só se repete depois disso (o 204 que não muda nada existe: o 2º clique tem de valer)
export const REENVIO_MS = 1500;

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const posDe = p => String(p || '').toUpperCase();
export const nomePos = p => POS[posDe(p)] || (posDe(p) ? posDe(p).toLowerCase() : 'sem posição');
export const acoes = s => (Array.isArray(s?.actions) ? s.actions.flat(2) : []).filter(a => a && typeof a === 'object');
export const semAcento = t => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// ---------- leitura da sessão (pura) ----------
// -> null (sem myTeam) | {me, fase, time[], inimigos[], nInimigos, banidos[], revelado, meuBan, modo, eu, timer,
//    travados (Set), banidosConhecidos (Set), vez}
export function lerSessao(s) {
  if (!s || typeof s !== 'object' || !Array.isArray(s.myTeam)) return null;
  const me = num(s.localPlayerCellId);
  const lista = acoes(s);
  const doTime = new Set(s.myTeam.map(c => num(c?.cellId)));
  // isAllyAction é o sinal; sem ele, pelo cellId (os cells do meu time mudam entre seleções: 0-4 ou 5-9)
  const aliada = a => (typeof a.isAllyAction === 'boolean' ? a.isAllyAction : doTime.has(num(a.actorCellId)));
  const picks = lista.filter(a => a.type === 'pick');
  const pickDe = cell => picks.find(a => num(a.actorCellId) === cell) || null;
  const time = s.myTeam.filter(c => c && typeof c === 'object').map(c => {
    const cell = num(c.cellId), a = pickDe(cell), ia = picks.indexOf(a);
    // travado: myTeam.championId (muda na troca de campeão; a ação fica com o id antigo) ou a ação completa
    const travado = num(c.championId) > 0 ? num(c.championId) : (a?.completed && num(a.championId) > 0 ? num(a.championId) : 0);
    const hover = travado ? 0 : (a && !a.completed && num(a.championId) > 0 ? num(a.championId) : Math.max(0, num(c.championPickIntent)));
    return { cellId: cell, eu: cell === me, pos: posDe(c.assignedPosition), travado, hover, ordem: ia < 0 ? 100 + cell : ia,
      skin: num(c.selectedSkinId), spells: [num(c.spell1Id), num(c.spell2Id)], autofill: c.isAutofilled === true };
  }).sort((x, y) => x.ordem - y.ordem || x.cellId - y.cellId);
  let n = 0;
  time.forEach((t, i) => { t.n = i + 1; t.rotulo = t.eu ? 'você' : `aliado ${++n}`; });
  const eu = time.find(t => t.eu) || null;

  // inimigo: só a ação de pick completa (nunca theirTeam.championPickIntent nem a ação em andamento)
  const inimigos = picks.filter(a => !aliada(a) && a.completed && num(a.championId) > 0).map(a => num(a.championId));
  const nInimigos = Array.isArray(s.theirTeam) && s.theirTeam.length ? s.theirTeam.length : 5;

  // bans: o do inimigo vem na sessão antes da revelação; só mostra depois do ten_bans_reveal completo
  const bans = lista.filter(a => a.type === 'ban');
  const revela = lista.find(a => a.type === 'ten_bans_reveal');
  const revelado = revela ? !!revela.completed : (!s.hasSimultaneousBans || (bans.length > 0 && bans.every(a => a.completed)));
  const meuBanA = bans.find(a => num(a.actorCellId) === me && a.completed);
  const meuBan = meuBanA ? num(meuBanA.championId) : null; // -1/0 = não baniu
  const banidos = revelado
    ? bans.filter(a => a.completed && num(a.championId) > 0).map(a => ({ id: num(a.championId), meu: num(a.actorCellId) === me, aliado: aliada(a) }))
      .sort((x, y) => (y.meu - x.meu) || (y.aliado - x.aliado))
    : [];
  const banidosConhecidos = new Set(bans.filter(a => a.completed && num(a.championId) > 0 && (revelado || aliada(a))).map(a => num(a.championId)));
  const travados = new Set([...time.map(t => t.travado).filter(Boolean), ...inimigos]);

  // o que eu faço agora
  const fase = String(s.timer?.phase || '');
  const minhas = lista.filter(a => num(a.actorCellId) === me);
  const meuPick = minhas.find(a => a.type === 'pick') || null;
  const ativa = minhas.find(a => a.isInProgress && !a.completed && (a.type === 'pick' || a.type === 'ban')) || null;
  const travei = !!eu?.travado || !!meuPick?.completed;
  let tipo;
  if (fase === 'PLANNING') tipo = meuPick && !meuPick.completed ? 'intencao' : 'esperar';
  else if (fase === 'BAN_PICK') tipo = ativa ? (ativa.type === 'ban' ? 'banir' : 'escolher') : travei ? 'finalizar' : 'esperar';
  else if (fase === 'FINALIZATION' || fase === 'GAME_STARTING') tipo = 'finalizar';
  else tipo = travei ? 'finalizar' : 'desconhecido';
  // no PLANNING os bans já vêm isInProgress (fixture real): a intenção é sempre a ação de pick, nunca a ativa
  const acao = tipo === 'banir' || tipo === 'escolher' ? ativa : (tipo === 'intencao' || tipo === 'esperar') && meuPick && !meuPick.completed ? meuPick : null;

  // de quem é a vez (rótulo da fase)
  const andamento = lista.filter(a => a.isInProgress && !a.completed);
  const banindo = andamento.some(a => a.type === 'ban');
  const pickAgora = andamento.find(a => a.type === 'pick');
  const vez = !pickAgora ? '' : aliada(pickAgora) ? (time.find(t => t.cellId === num(pickAgora.actorCellId))?.rotulo || 'seu time') : 'time inimigo';

  const t = s.timer || {};
  return {
    me, fase, time, eu, inimigos, nInimigos, banidos, revelado, meuBan, banidosConhecidos, travados,
    modo: { tipo, acao: acao ? { id: acao.id, type: acao.type, championId: num(acao.championId) } : null },
    banindo, vez, fila: num(s.queueId),
    timer: { restante: Math.max(0, num(t.adjustedTimeLeftInPhase)), total: Math.max(0, num(t.totalTimeInPhase)), infinito: !!t.isInfinite,
      foto: num(t.internalNowInEpochMs) },
  };
}

// rótulo da fase no topo (protótipo: FASE_ROT) -> [título, linha de baixo]
export function rotuloFase(l) {
  const f = l?.fase || '';
  if (f === 'PLANNING') return ['PLANEJAMENTO', 'PLANNING · declare a sua intenção'];
  if (f === 'BAN_PICK') {
    if (l.modo.tipo === 'banir' || l.banindo) return ['BANIMENTO', 'BAN_PICK · bans simultâneos'];
    if (l.modo.tipo === 'escolher') return ['ESCOLHA · SUA VEZ', 'BAN_PICK · escolhendo'];
    return ['ESCOLHA', l.vez ? `BAN_PICK · vez: ${l.vez}` : 'BAN_PICK · escolhendo'];
  }
  if (f === 'FINALIZATION') return ['FINALIZAÇÃO', 'FINALIZATION · skin, feitiços, trocas'];
  if (f === 'GAME_STARTING') return ['COMEÇANDO', 'GAME_STARTING · a partida vai abrir'];
  return ['SELEÇÃO', `fase ${f || 'sem leitura'}`];
}

// ---------- posição em destaque (plano, passo 16; relato de 15/10/2026 ~04:15) ----------
// "já é a segunda vez que eu caio de jungle, não percebo e acabo indo de Renekton": a posição era só a palavra pequena embaixo
// do "tu". Três peças: painel com o ícone e o nome no lugar da grade por _papel.ms ao entrar (ou quando a posição muda numa
// troca), a palavra grande à direita da linha "tu" a seleção inteira, e o aviso do campeão com poucas partidas na posição.
// Nada disso escreve nem segura clique: a vez dele de agir (ban/pick) fecha o painel na hora.
// Ícone: o SVG do próprio client (o que a tela da Riot usa no pino da posição e no diálogo de troca: rcp-fe-lol-champ-select
// 16.20, assets.wad lido em 15/10/2026); sem ele (404) o <img> sai e fica o nome grande.
export const iconePosicao = p => `/fe/lol-champ-select/svg/position-${String(p).toLowerCase()}.svg`;
const NA_POS = { TOP: 'no topo', JUNGLE: 'na selva', MIDDLE: 'no meio', BOTTOM: 'de atirador', UTILITY: 'de suporte' };
// abaixo disso na posição atribuída, o aviso aparece (técnico, reversível: plano passo 16, decisão xxiii)
export const POUCAS_NA_POSICAO = 3;
// ms: quanto o painel fica; vistos: chave da seleção -> {ini: posição de entrada, vis: última posição já mostrada} (no módulo:
// remontar a tela, expandir e voltar, não repete; espelhado no sessionStorage: recarga da interface no meio da seleção também
// não repete e segue sabendo a posição de entrada, que separa troca de autofill). lido: o sessionStorage já foi lido
export const _papel = { ms: 3500, vistos: new Map(), lido: false, semIcone: false };
const MEM_PAPEL = 'lc-cp-papel';
function vistosPapel() {
  if (!_papel.lido) {
    _papel.lido = true;
    try {
      const v = JSON.parse(globalThis.sessionStorage?.getItem(MEM_PAPEL) || '[]');
      for (const e of Array.isArray(v) ? v : []) {
        if (Array.isArray(e) && typeof e[0] === 'string' && POS[e[1]?.ini] && !_papel.vistos.has(e[0]))
          _papel.vistos.set(e[0], { ini: e[1].ini, vis: POS[e[1].vis] ? e[1].vis : '' });
      }
    } catch { /* sem storage (bloqueado, node): só a memória do módulo */ }
  }
  return _papel.vistos;
}
function guardarPapel() {
  // a chave de montagem (sessão sem id nem gameId) não sobrevive à recarga: não vale guardar
  try { globalThis.sessionStorage?.setItem(MEM_PAPEL, JSON.stringify([..._papel.vistos].filter(([k]) => k[0] !== 'm').slice(-20))); } catch { /* segue */ }
}
// ms: idade máxima das preferidas lidas pela tela do lobby (comum.js) que ainda valem na seleção quando o GET de lá falha
const PREFS_LOBBY_MS = 60 * 60e3;

// posição dele nesta seleção e o quanto ela merece destaque. prefs = {pos1, pos2} do lobby (GET /lol-lobby/v2/lobby, [S] na
// seleção, ou a última leitura da tela do lobby) ou null. ini = a posição com que ele entrou nesta seleção ('' = não sei).
// Autofill = a regra do coletor (coletor.py retrato): isAutofilled, ou fora das pedidas sem FILL entre elas. Mas troca de
// posição (aceita ou pedida por ele) muda o assignedPosition e não as preferidas nem o isAutofilled: posição diferente da de
// entrada é troca (nunca vermelho), e isAutofilled numa posição pedida também (revisão 15/10/2026, ARMADILHAS § LCU).
// -> null (sem posição: às cegas, ARAM, personalizada sem posição) | {pos, nome, icone, destaque: normal|segunda|auto, nota}
export function papelDe(l, prefs = null, ini = '') {
  const eu = l?.eu, pos = eu?.pos || '';
  if (!POS[pos]) return null;
  const NOME = p => POS[p].toUpperCase();
  const pedidas = [prefs?.pos1, prefs?.pos2].map(posDe);
  const fill = pedidas.includes('FILL');
  const validas = pedidas.filter(p => POS[p]);
  const p1 = pedidas[0];
  // textos impessoais (docs/TEXTOS-DA-INTERFACE.md): "1ª opção: TOPO", nunca "tu pediu TOPO"
  let destaque = 'normal', nota = 'posição nesta seleção';
  if (POS[ini] && ini !== pos) {
    destaque = POS[p1] && p1 !== pos ? 'segunda' : 'normal';
    nota = `trocou de posição: era ${NOME(ini)}` + (destaque === 'segunda' ? ` · 1ª opção: ${NOME(p1)}` : '');
  } else if ((eu.autofill && !validas.includes(pos)) || (validas.length && !fill && !validas.includes(pos))) {
    destaque = 'auto';
    nota = 'PREENCHIMENTO AUTOMÁTICO' + (validas.length ? ` · opções: ${validas.map(NOME).join(' e ')}` : '');
  } else if (POS[p1] && p1 !== pos) {
    destaque = 'segunda';
    nota = `fora da 1ª opção (${NOME(p1)})`;
  } else if (p1 === pos) nota = '1ª opção';
  return { pos, nome: NOME(pos), icone: iconePosicao(pos), destaque, nota };
}

// aviso do campeão (hover/intenção/vez dele) com poucas partidas na posição atribuída: os números do selo
// (servicos.champ.estatisticas, o histórico do client; nenhuma leitura nova). Nunca bloqueia: é texto.
// -> "Renekton na selva: 1 partida · no topo: 74" | null (posição com partidas suficientes, sem dado, histórico lendo)
export function avisoPosicao(champ, id, pos, nome = '') {
  const p = posDe(pos);
  if (!(id > 0) || !POS[p] || typeof champ?.estatisticas !== 'function') return null;
  try {
    if (typeof champ.partidas === 'function' && champ.partidas() === null) return null;
    const est = champ.estatisticas(id, p);
    const n = num(est?.posicao?.n);
    if (n >= POUCAS_NA_POSICAO) return null;
    let melhor = null, sabidas = n; // onde ele mais joga o campeão (mesma fonte): diz o porquê do aviso em 1 olhada
    for (const q of Object.keys(POS)) {
      if (q === p) continue;
      const m = num(champ.estatisticas(id, q)?.posicao?.n);
      sabidas += m;
      if (m > n && m > (melhor?.n || 0)) melhor = { q, n: m };
    }
    // partida sem o item da missão nem Golpear não conta em posição nenhuma (posicaoDaPartida): com menos da metade das
    // partidas dele com o campeão de posição sabida, "1 partida na selva" seria palpite (revisão 15/10/2026)
    if (num(est?.geral?.n) > 0 && sabidas * 2 < num(est.geral.n)) return null;
    const qtd = n ? `${n} ${n === 1 ? 'partida' : 'partidas'}` : 'nenhuma partida';
    return `${nome || `campeão ${id}`} ${NA_POS[p]}: ${qtd}${melhor ? ` · ${NA_POS[melhor.q]}: ${melhor.n}` : ''}`;
  } catch { return null; }
}

// estado de uma troca com um aliado. slots: Map(cellId -> summoners/{slotId}) opcional (show* = false esconde)
export function estadoTroca(s, troca, cellId, slot) {
  const arr = s?.[troca.campo];
  const c = Array.isArray(arr) ? arr.find(x => num(x?.cellId) === cellId) : null;
  const id = c && c.id !== undefined && c.id !== null && Number.isInteger(Number(c.id)) ? Number(c.id) : null;
  if (!c || id === null) return { estado: 'AUSENTE', id: null, motivo: MOTIVO.AUSENTE.todos };
  const estado = String(c.state || '').toUpperCase();
  if (estado === 'AVAILABLE' && slot && slot[troca.mostrar] === false) return { estado: 'ESCONDIDA', id, motivo: MOTIVO.ESCONDIDA.todos };
  const m = MOTIVO[estado];
  return { estado, id, motivo: m ? (m[troca.tipo] || m.todos) : estado === 'AVAILABLE' ? '' : `estado do client não esperado (${estado || 'vazio'})` };
}

// pedidos de troca em aberto (SENT/RECEIVED) e como fecharam. mem = novaMemoria(); devolve os resultados novos
// [{tipo, cellId, dir, resultado: 'aceito'|'recusado'|'cancelado'|'morreu'|'sumiu'}]. "morreu" = fechou sem resposta
// numa virada de fase (plano: pedido aberto morre na virada [S]).
// Medido na fixture real (champselect-real.json, ev 30 -> 32, troca de ordem entre os cells 1 e 3): o estado ACCEPTED
// nunca aparece; a troca feita REGENERA os contratos (ids 4 e 7 somem e voltam como 24 e 25 em AVAILABLE) e os
// jogadores mudam de cell. Por isso o pedido é seguido por tipo + cell do aliado (nunca pelo id), e o fim sem estado
// final é julgado pelo efeito em mim: ordem = meu localPlayerCellId mudou; posição = minha assignedPosition mudou;
// campeão = meu championId mudou. Sem efeito: vale o clique dele (recusar/cancelar), senão morreu/sumiu.
export const novaMemoria = () => ({ sessao: null, fase: null, abertos: new Map(), resultados: new Map(), cliques: new Map() });
// clique dele num pedido aberto (accept/decline/cancel): se o contrato sumir sem estado final, conta o clique
export function marcarClique(mem, tipo, cellId, verbo) { mem.cliques?.set(`${tipo}:${num(cellId)}`, verbo); }
function meuEstado(s) {
  const cell = num(s?.localPlayerCellId);
  const c = Array.isArray(s?.myTeam) ? s.myTeam.find(x => num(x?.cellId) === cell) : null;
  return { cell, pos: posDe(c?.assignedPosition), champ: num(c?.championId) };
}
function trocaFeita(ab, eu) {
  if (ab.tipo === 'ORDEM') return eu.cell !== ab.eu.cell;
  if (ab.tipo === 'POSICAO') return !!eu.pos && !!ab.eu.pos && eu.pos !== ab.eu.pos;
  return ab.eu.champ > 0 && eu.champ > 0 && eu.champ !== ab.eu.champ; // CAMPEAO
}
export function acompanharPedidos(mem, s, agora = Date.now()) {
  const fase = String(s?.timer?.phase || '');
  mem.cliques ||= new Map();
  if (mem.sessao !== s?.id) { mem.sessao = s?.id ?? null; mem.abertos.clear(); mem.resultados.clear(); mem.cliques.clear(); mem.fase = fase; }
  const eu = meuEstado(s);
  const novos = [];
  const vistos = new Map(); // `${tipo}:${cellId}` -> {tr, c}
  for (const tr of TROCAS) for (const c of (Array.isArray(s?.[tr.campo]) ? s[tr.campo] : [])) if (c) vistos.set(`${tr.tipo}:${num(c.cellId)}`, { tr, c });
  for (const [k, ab] of [...mem.abertos]) {
    const v = vistos.get(k), st = String(v?.c?.state || '').toUpperCase();
    if (st === 'SENT' || st === 'RECEIVED') continue; // segue aberto (mesmo com id novo)
    const clique = mem.cliques.get(k);
    const resultado = st === 'ACCEPTED' ? 'aceito' : st === 'DECLINED' ? 'recusado' : st === 'CANCELLED' ? 'cancelado'
      : trocaFeita(ab, eu) ? 'aceito' : clique === 'decline' ? 'recusado' : clique === 'cancel' ? 'cancelado'
        : fase !== ab.fase ? 'morreu' : 'sumiu';
    mem.abertos.delete(k);
    mem.cliques.delete(k);
    // troca feita em que eu mudei de cell (ordem; posição também, se ela mover jogadores [S]): o aliado agora senta no
    // cell que era meu (a linha dele é a desse cell)
    const cellAgora = resultado === 'aceito' && eu.cell !== ab.eu.cell && ab.cellId === eu.cell ? ab.eu.cell : ab.cellId;
    const r = { tipo: ab.tipo, cellId: cellAgora, dir: ab.dir, resultado };
    novos.push(r);
    mem.resultados.set(cellAgora, { ...r, ate: agora + RESULTADO_MS });
  }
  for (const [k, { tr, c }] of vistos) {
    const st = String(c?.state || '').toUpperCase();
    if ((st === 'SENT' || st === 'RECEIVED') && !mem.abertos.has(k)) mem.abertos.set(k, { tipo: tr.tipo, cellId: num(c.cellId), dir: st, fase, eu });
  }
  // resultado guardado num cell que virou o meu (troca de ordem) não teria linha onde aparecer
  for (const [cell, r] of [...mem.resultados]) if (r.ate <= agora || cell === eu.cell) mem.resultados.delete(cell);
  mem.fase = fase;
  return novos;
}

// texto da linha do aliado depois que o pedido fechou
export function textoResultado(r, rotulo) {
  const nome = TROCAS.find(t => t.tipo === r.tipo)?.nome || 'troca';
  if (r.resultado === 'aceito') return `troca de ${nome} feita`;
  if (r.resultado === 'recusado') return r.dir === 'SENT' ? `${rotulo} recusou a troca de ${nome}` : `você recusou a troca de ${nome}`;
  if (r.resultado === 'cancelado') return r.dir === 'SENT' ? `pedido de troca de ${nome} cancelado` : `${rotulo} desistiu da troca de ${nome}`;
  if (r.resultado === 'morreu') return `o pedido de troca de ${nome} morreu na virada de fase`;
  return `o pedido de troca de ${nome} fechou sem resposta`;
}

// campeões que não dá para escolher/banir agora (Set de ids)
export function indisponiveis(l, s, { pickable = null, bannable = null } = {}) {
  const fora = new Set([...l.travados, ...l.banidosConhecidos]);
  if (l.modo.tipo === 'banir') {
    if (s?.disallowBanningTeammateHoveredChampions) for (const t of l.time) if (!t.eu && t.hover) fora.add(t.hover);
    return { fora, permitidos: bannable };
  }
  return { fora, permitidos: pickable };
}

// lista da grade: ids do catálogo (permitidos quando o client respondeu), favoritos na frente, busca sem acento
export function listaGrade(cat, { busca = '', permitidos = null, favoritos = [] } = {}) {
  const q = semAcento(busca);
  const fav = favoritos.filter(id => cat.has(id));
  const ids = [...cat.keys()].filter(id => !permitidos || permitidos.has(id) || fav.includes(id));
  const nome = id => cat.get(id)?.nome || String(id);
  return ids.filter(id => !q || semAcento(nome(id)).includes(q) || semAcento(cat.get(id)?.alias).includes(q))
    .sort((a, b) => (fav.includes(b) - fav.includes(a)) || (fav.indexOf(a) - fav.indexOf(b)) || nome(a).localeCompare(nome(b), 'pt-BR'));
}

// cor da bolinha do chroma, igual ao skin-button da Riot (rcp-fe-lol-champ-select 16.20, `color`): 2 cores = diagonal 135°,
// 1 cor = sólida; sem cor = ''
export function corDoChroma(cores) {
  const c = (Array.isArray(cores) ? cores : []).map(x => String(x || '').replace(/[^#\w(),.% -]/g, ''));
  if (!c.length || !c[0]) return '';
  return c.length !== 1 && c[1] ? `linear-gradient(135deg, ${c[0]} 0%, ${c[0]} 50%, ${c[1]} 50%, ${c[1]} 100%)` : c[0];
}

// skins que ele tem do campeão (carrossel do client): padrão sempre; chroma escolhida marca a skin-mãe. chromas: os childSkins
// que ele tem e estão liberados (unlocked ou owned, sem disabled: a Riot também tira os desativados do jmx), na ordem do id
// (pedido de 15/10/2026 ~12:45: "quero poder escolher o chroma quando estiver disponível")
export function skinsDoCampeao(carrossel, championId) {
  const lista = (Array.isArray(carrossel) ? carrossel : []).filter(k => k && num(k.championId) === championId && !k.disabled
    && (k.isBase || k.unlocked || k.ownership?.owned));
  const filhos = k => (Array.isArray(k.childSkins) ? k.childSkins : []).filter(c => c && typeof c === 'object');
  return lista.map(k => ({ id: num(k.id), nome: String(k.name || (k.isBase ? 'padrão' : k.id)), base: !!k.isBase,
    splash: String(k.splashPath || ''), tile: String(k.tilePath || ''), filhos: filhos(k).map(c => num(c.id)),
    chromas: filhos(k).filter(c => num(c.id) > 0 && num(c.id) !== num(k.id) && !c.disabled && (c.unlocked || c.ownership?.owned))
      .map(c => ({ id: num(c.id), nome: String(c.shortName || c.name || c.id), cor: corDoChroma(c.colors) })).sort((a, b) => a.id - b.id) }))
    .sort((a, b) => (b.base - a.base) || a.id - b.id);
}
export const skinMarcada = (skins, selecionada) => skins.find(k => k.id === selecionada || k.filhos.includes(selecionada))?.id ?? null;

// feitiço novo no slot (0 = D, 1 = F); igual ao do outro slot = trocam de lugar (como o client)
export function trocarFeitico([a, b], slot, novo) {
  const par = [a, b];
  const outro = 1 - slot;
  if (par[outro] === novo) par[outro] = par[slot];
  par[slot] = novo;
  return par;
}

// ---------- miniatura da splash (protótipo: splash reduzida no canvas, 240×142) ----------
const miniaturas = new Map(); // splashPath -> dataURL | 'erro' | Promise
export const MINIATURA = [240, 142];
function miniatura(url, doc) {
  if (!url) return Promise.resolve(null);
  const m = miniaturas.get(url);
  if (typeof m === 'string') return Promise.resolve(m === 'erro' ? null : m);
  if (m) return m;
  const p = new Promise(resolve => {
    const Img = globalThis.Image;
    const canvas = doc?.createElement?.('canvas');
    const g = canvas?.getContext?.('2d');
    if (typeof Img !== 'function' || !g) return resolve(null);
    const img = new Img();
    img.onload = () => {
      try {
        const [w, hh] = MINIATURA;
        canvas.width = w; canvas.height = hh;
        const esc = Math.max(w / img.naturalWidth, hh / img.naturalHeight);
        const sw = w / esc, sh = hh / esc;
        g.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, 0, 0, w, hh);
        let d = canvas.toDataURL('image/webp', 0.82);
        if (!d.startsWith('data:image/webp')) d = canvas.toDataURL('image/jpeg', 0.82);
        resolve(d);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  }).then(d => { miniaturas.set(url, d || 'erro'); return d; });
  miniaturas.set(url, p);
  return p;
}

// ---------- CSS (visual do protótipo aprovado; prefixo lc-cp-sel-) ----------
export const CSS = `
#lc-compacto .lc-cp-corpo.lc-cp-sel { padding:0; gap:0; }
#lc-compacto .lc-cp-sel-f { color:var(--lc-ouro2); font-weight:700; letter-spacing:.08em; font-size:13px; line-height:1.25; white-space:nowrap; }
#lc-compacto .lc-cp-sel-f small { display:block; font-weight:400; letter-spacing:0; color:var(--lc-mudo); font-size:10.5px; }
#lc-compacto .lc-cp-sel-t { font-size:22px; color:var(--lc-ouro2); font-weight:300; margin-right:6px; min-width:34px; text-align:right; }
#lc-compacto .lc-cp-sel-barra { position:sticky; top:0; z-index:3; height:4px; flex:none; background:#1b2530; }
#lc-compacto .lc-cp-sel-barra i { display:block; height:100%; width:100%; background:var(--lc-azul); transition:width .25s linear; }
#lc-compacto .lc-cp-sel-barra i.lc-cp-sel-fim { background:var(--lc-verm); }
#lc-compacto .lc-cp-sel-receb { margin:8px 10px 2px; border:1px solid var(--lc-amarelo); background:rgba(242,193,78,.1); padding:8px 10px;
  font-size:12.5px; color:var(--lc-ouro2); }
#lc-compacto .lc-cp-sel-receb .lc-cp-sel-tt { font-weight:700; color:var(--lc-amarelo); font-size:11px; letter-spacing:.08em; text-transform:uppercase; }
#lc-compacto .lc-cp-sel-receb b { color:var(--lc-ouro2); }
#lc-compacto .lc-cp-sel-bts { display:flex; gap:8px; margin-top:7px; }
#lc-compacto .lc-cp-sel-bts .lc-cp-btn { flex:1; padding:6px; }
#lc-compacto .lc-cp-sel-sec { display:flex; justify-content:space-between; align-items:center; padding:7px 12px 3px; font-size:10px;
  letter-spacing:.12em; text-transform:uppercase; color:var(--lc-mudo); }
#lc-compacto .lc-cp-sel-sec button { background:none; border:none; color:var(--lc-ouro); font-family:inherit; font-size:11px; letter-spacing:0;
  text-transform:none; padding:0; cursor:pointer; }
#lc-compacto .lc-cp-sel-time { padding:0 8px; }
#lc-compacto .lc-cp-sel-lin { display:grid; grid-template-columns:16px 32px 1fr auto; gap:7px; align-items:center; padding:4px;
  border-bottom:1px solid rgba(60,60,65,.45); min-height:42px; }
#lc-compacto .lc-cp-sel-lin.lc-cp-sel-eu { background:linear-gradient(90deg,rgba(200,170,110,.13),rgba(200,170,110,0)); }
#lc-compacto .lc-cp-sel-lin.lc-cp-sel-agindo { box-shadow:inset 3px 0 0 var(--lc-azul); }
#lc-compacto .lc-cp-foto.lc-cp-sel-intencao { opacity:.6; filter:saturate(.35); border-style:dashed; border-color:var(--lc-mudo); }
#lc-compacto .lc-cp-sel-o { font-size:11px; color:var(--lc-mudo); text-align:center; }
#lc-compacto .lc-cp-sel-n { font-size:12.5px; line-height:1.2; color:var(--lc-ouro2); min-width:0; }
#lc-compacto .lc-cp-sel-n small { display:block; color:var(--lc-mudo); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#lc-compacto .lc-cp-sel-n i { color:#7f8a93; }
#lc-compacto .lc-cp-sel-trocas { display:flex; gap:3px; }
#lc-compacto .lc-cp-sel-trocas button { background:var(--lc-pan2); border:1px solid var(--lc-linha); color:var(--lc-ouro2); font-family:inherit;
  font-size:10.5px; padding:3px 5px; border-radius:3px; white-space:nowrap; cursor:pointer; }
#lc-compacto .lc-cp-sel-trocas button:hover:not([disabled]) { border-color:var(--lc-ouro); }
#lc-compacto .lc-cp-sel-trocas button[disabled] { color:#5b5f66; border-color:#2a2d33; cursor:not-allowed; }
#lc-compacto .lc-cp-sel-trocas button.lc-cp-sel-busy[disabled] { color:#8a7a52; }
#lc-compacto .lc-cp-sel-pend { font-size:10.5px; color:var(--lc-amarelo); text-align:right; line-height:1.3; }
#lc-compacto .lc-cp-sel-pend.lc-cp-sel-ruim { color:#ff8a9a; }
#lc-compacto .lc-cp-sel-selo { font-size:10.5px; line-height:1.3; color:var(--lc-mudo); text-align:right; white-space:nowrap; }
#lc-compacto .lc-cp-sel-selo span { display:block; }
#lc-compacto .lc-cp-sel-selo span:first-child { color:var(--lc-txt); }
#lc-compacto .lc-cp-sel-pend.lc-cp-sel-bom { color:var(--lc-azul); }
#lc-compacto .lc-cp-sel-pend button { background:none; border:1px solid #6b5a2e; color:var(--lc-ouro2); font-family:inherit; font-size:10px;
  padding:1px 6px; margin-top:2px; cursor:pointer; }
#lc-compacto .lc-cp-sel-vazio { border-style:dashed !important; border-color:#3a3f46 !important; color:#4a4f56; background:#151b22; }
#lc-compacto .lc-cp-sel-inim { display:flex; gap:6px; padding:2px 12px 6px; align-items:center; }
#lc-compacto .lc-cp-sel-bans { padding:0 12px 6px; font-size:11px; color:var(--lc-mudo); display:flex; align-items:center; gap:3px; white-space:nowrap; }
#lc-compacto .lc-cp-sel-bans > span:first-child { margin-right:4px; }
#lc-compacto .lc-cp-sel-bans .lc-cp-foto { filter:grayscale(.85) brightness(.75); }
#lc-compacto .lc-cp-sel-bans .lc-cp-foto.lc-cp-sel-teu { filter:none; border-color:var(--lc-verm); }
#lc-compacto .lc-cp-sel-sel { margin-top:auto; border-top:1px solid var(--lc-linha2); padding:8px 10px 10px; display:flex; flex-direction:column;
  gap:7px; background:rgba(9,20,40,.6); }
#lc-compacto .lc-cp-sel-busca { display:flex; gap:6px; }
#lc-compacto .lc-cp-sel-busca input { flex:1; background:var(--lc-bg); border:1px solid var(--lc-linha); color:var(--lc-ouro2); padding:6px 8px;
  font-family:inherit; font-size:12.5px; user-select:text; }
#lc-compacto .lc-cp-sel-favs { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
#lc-compacto .lc-cp-sel-fav { display:flex; gap:7px; align-items:center; background:var(--lc-pan2); border:1px solid var(--lc-linha); padding:4px 7px;
  color:var(--lc-ouro2); font-family:inherit; font-size:12px; text-align:left; cursor:pointer; }
#lc-compacto .lc-cp-sel-fav small { display:block; color:var(--lc-mudo); font-size:10.5px; }
#lc-compacto .lc-cp-sel-fav.lc-cp-sel-on, #lc-compacto .lc-cp-sel-gc.lc-cp-sel-on { border-color:var(--lc-azul); box-shadow:0 0 0 1px var(--lc-azul) inset; }
#lc-compacto .lc-cp-sel-grade { display:grid; grid-template-columns:repeat(7,1fr); gap:4px; max-height:118px; overflow:auto; padding-right:2px; }
#lc-compacto .lc-cp-sel-gc { background:none; border:1px solid transparent; padding:2px 0; display:flex; flex-direction:column; align-items:center;
  gap:1px; color:var(--lc-mudo); font-family:inherit; font-size:9.5px; line-height:1.05; cursor:pointer; }
#lc-compacto .lc-cp-sel-gc span.lc-cp-sel-nm { max-width:52px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#lc-compacto .lc-cp-sel-gc[disabled], #lc-compacto .lc-cp-sel-fav[disabled] { opacity:.28; cursor:not-allowed; }
#lc-compacto .lc-cp-sel-acao { display:flex; gap:6px; }
#lc-compacto .lc-cp-sel-acao .lc-cp-btn { flex:1; font-size:14px; letter-spacing:.1em; padding:9px; }
#lc-compacto .lc-cp-sel-skins { display:flex; gap:5px; overflow-x:auto; padding-bottom:3px; }
#lc-compacto .lc-cp-sel-chromas { display:flex; align-items:center; gap:6px; margin:-2px 0 4px; }
#lc-compacto .lc-cp-sel-chromas .lc-cp-nota { margin-right:2px; }
#lc-compacto .lc-cp-sel-cr { flex:none; width:16px; height:16px; padding:0; border-radius:50%; border:1px solid var(--lc-linha); cursor:pointer;
  background:#3a3f45; box-shadow:0 0 0 1px rgba(0,0,0,.6) inset; }
#lc-compacto .lc-cp-sel-cr:hover { filter:brightness(1.2); }
#lc-compacto .lc-cp-sel-cr.lc-cp-sel-on { border:2px solid var(--lc-ouro); width:18px; height:18px; }
#lc-compacto .lc-cp-sel-cr[disabled] { opacity:.5; cursor:not-allowed; }
#lc-compacto .lc-cp-sel-sk { position:relative; flex:none; width:104px; height:62px; border:1px solid var(--lc-linha); padding:0; overflow:hidden;
  background:#151b22 center/cover no-repeat; font-family:inherit; font-size:9.5px; color:#fff; text-align:left; line-height:1.15;
  text-shadow:0 1px 2px #000; cursor:pointer; }
#lc-compacto .lc-cp-sel-sk span { position:absolute; left:0; right:0; bottom:0; padding:12px 4px 3px;
  background:linear-gradient(rgba(0,0,0,0),rgba(0,0,0,.88) 55%); display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; }
#lc-compacto .lc-cp-sel-sk.lc-cp-sel-on { border:2px solid var(--lc-ouro); }
#lc-compacto .lc-cp-sel-spells { display:grid; grid-template-columns:1fr 1fr; gap:6px; }
#lc-compacto .lc-cp-sel-spells button { background:var(--lc-pan2); border:1px solid var(--lc-linha); color:var(--lc-ouro2); padding:6px 8px;
  font-family:inherit; font-size:12px; text-align:left; cursor:pointer; }
#lc-compacto .lc-cp-sel-spells button.lc-cp-sel-on { border-color:var(--lc-ouro); }
#lc-compacto .lc-cp-sel-spells button b { color:var(--lc-mudo); margin-right:5px; font-weight:600; }
#lc-compacto .lc-cp-sel-splista { display:flex; flex-wrap:wrap; gap:4px; }
#lc-compacto .lc-cp-sel-splista button { background:var(--lc-bg); border:1px solid var(--lc-linha); color:var(--lc-txt); font-family:inherit;
  font-size:11px; padding:3px 6px; cursor:pointer; }
#lc-compacto .lc-cp-sel-splista button.lc-cp-sel-on { border-color:var(--lc-ouro); color:var(--lc-ouro2); }
#lc-compacto .lc-cp-sel-runa { font-size:12px; color:var(--lc-txt); display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
#lc-compacto .lc-cp-sel-runa .lc-cp-sel-ok { color:#3fbf77; }
#lc-compacto .lc-cp-sel-runa button { background:var(--lc-pan2); border:1px solid var(--lc-linha); color:var(--lc-ouro2); font-family:inherit;
  font-size:11.5px; padding:4px 8px; cursor:pointer; }
#lc-compacto .lc-cp-sel-runa button.lc-cp-sel-on { border-color:var(--lc-azul); }
/* passo 16: posição em destaque. Painel no lugar da grade (a grade fica no DOM, escondida: o campo de busca não perde o foco) */
#lc-compacto .lc-cp-sel.lc-cp-sel-papel-on .lc-cp-sel-sel { display:none; }
#lc-compacto .lc-cp-sel-papel-painel { margin-top:auto; flex:1 0 auto; min-height:220px; display:flex; flex-direction:column; align-items:center;
  justify-content:center; gap:2px; padding:12px 10px 14px; border-top:1px solid var(--lc-linha2); cursor:pointer; text-align:center;
  background:radial-gradient(ellipse at 50% 38%,rgba(200,170,110,.18),rgba(9,20,40,.65) 68%); animation:lc-cp-sel-papel-in .18s ease-out; }
@keyframes lc-cp-sel-papel-in { from { opacity:0; transform:scale(.96); } to { opacity:1; transform:none; } }
#lc-compacto .lc-cp-sel-papel-painel img { width:104px; height:104px; filter:drop-shadow(0 0 10px rgba(200,170,110,.45)); }
#lc-compacto .lc-cp-sel-papel-nome { font-size:46px; line-height:1.05; font-weight:700; letter-spacing:.1em; color:var(--lc-ouro2); margin-top:4px; }
#lc-compacto .lc-cp-sel-papel-nota { font-size:13px; color:var(--lc-mudo); letter-spacing:.03em; }
#lc-compacto .lc-cp-sel-papel-dica { font-size:10.5px; color:#5b6670; margin-top:8px; }
#lc-compacto .lc-cp-sel-papel-painel.lc-cp-sel-d-segunda { box-shadow:inset 0 0 0 2px var(--lc-amarelo); }
#lc-compacto .lc-cp-sel-papel-painel.lc-cp-sel-d-segunda .lc-cp-sel-papel-nome,
#lc-compacto .lc-cp-sel-papel-painel.lc-cp-sel-d-segunda .lc-cp-sel-papel-nota { color:var(--lc-amarelo); }
#lc-compacto .lc-cp-sel-papel-painel.lc-cp-sel-d-auto { box-shadow:inset 0 0 0 2px var(--lc-verm);
  background:radial-gradient(ellipse at 50% 38%,rgba(232,64,87,.2),rgba(9,20,40,.65) 68%); }
#lc-compacto .lc-cp-sel-papel-painel.lc-cp-sel-d-auto .lc-cp-sel-papel-nome { color:#ff8a9a; }
#lc-compacto .lc-cp-sel-papel-painel.lc-cp-sel-d-auto .lc-cp-sel-papel-nota { color:#ff8a9a; font-weight:700; }
/* a palavra grande na linha "tu", à direita (a coluna dos botões de troca dos aliados), ao lado do selo */
#lc-compacto .lc-cp-sel-eudir { display:flex; align-items:center; gap:8px; min-width:0; }
#lc-compacto .lc-cp-sel-papel { font-size:19px; line-height:1; font-weight:700; letter-spacing:.05em; color:var(--lc-ouro2); white-space:nowrap; }
#lc-compacto .lc-cp-sel-papel.lc-cp-sel-d-segunda { color:var(--lc-amarelo); }
#lc-compacto .lc-cp-sel-papel.lc-cp-sel-d-auto { color:#ff8a9a; }
#lc-compacto .lc-cp-sel-selo.lc-cp-sel-pouco span:last-child { color:var(--lc-amarelo); }
#lc-compacto .lc-cp-nota.lc-cp-sel-avisopos { color:var(--lc-amarelo); }
`;

// ---------- tela ----------
let atual = null; // estado da montagem viva (o roteador monta uma tela por vez)
let montagens = 0; // seleção sem id nem gameId: a chave do painel da posição vale por montagem

export async function montar(raiz, ctx) {
  const doc = raiz.ownerDocument || raiz.doc || globalThis.document;
  estilo('lc-cp-selecao-estilo', CSS, doc);
  raiz.classList.add('lc-cp-sel');
  const st = {
    ctx, raiz, doc, el: (tag, attrs = {}, ...f) => h(tag, { doc, ...attrs }, ...f),
    sessao: null, l: null, mem: novaMemoria(), cat: new Map(), pickable: null, bannable: null, chaveListas: '',
    escolhido: 0, busca: '', inimigosAbertos: true, spAberto: null, ocupado: new Set(), slots: new Map(), slotsEm: 0, slotsVoo: false,
    skins: null, feiticos: null, runa: null, fim: 0, chaveSel: '', chaveGrade: '', modoSel: null, saiu: false,
    // hover: clique guardado | hoverVoo: id em voo | hoverEnviado: {acao, id, em} | fechando: banir/travar clicado
    // {acao, id, verbo, nome, enviado} até a sessão mostrar a ação fechada | armando: botão de ação ainda cinza
    hover: null, hoverVoo: null, hoverEnviado: null, fechando: null, armando: false, chaveArmar: null, genArmar: 0,
    // passo 16: painel da posição aberto, geração do prazo dele, preferidas do lobby (e de qual seleção)
    papelAberto: false, genPapel: 0, prefs: null, prefsSid: null, montagem: ++montagens,
  };
  atual = st;
  st.ultimoEvento = _relogio.agora();
  montarEsqueleto(st);
  // clique em qualquer lugar da tela fecha o painel da posição (captura: o clique segue para o botão onde caiu)
  st.fecharPapelClique = ctx.seguro(() => { if (st.papelAberto) { fecharPapel(st); pintar(st); } });
  raiz.addEventListener('click', st.fecharPapelClique, true);
  // e qualquer tecla (ele começou a digitar o campeão): no documento, porque a busca escondida perde o foco; a tecla segue
  st.docPapel = doc;
  try { doc.addEventListener?.('keydown', st.fecharPapelClique, true); } catch { /* segue */ }
  ctx.observar(`${CS}/session`, msg => { if (msg?.eventType !== 'Delete' && msg?.data) aoSessao(st, msg.data); });
  ctx.intervalo(() => relogio(st), 250);
  // socket mudo (engasgo da LCU, reconexão que não reassina: ARMADILHAS § LCU) deixaria a tela congelada com o
  // relógio andando e a vez errada: sem evento há SILENCIO_MS, relê a sessão por GET
  ctx.intervalo(() => {
    if (st.relendo || _relogio.agora() - st.ultimoEvento < SILENCIO_MS) return;
    st.relendo = true;
    ctx.lcu('GET', `${CS}/session`).then(ctx.seguro(r => {
      st.relendo = false;
      st.ultimoEvento = _relogio.agora();
      if (r.ok && r.json && typeof r.json === 'object') aoSessao(st, r.json);
    }));
  }, RELER_MS);
  campeoes().then(ctx.seguro(cat => { if (cat?.size) { st.cat = cat; st.chaveSel = ''; pintar(st); } }));
  const r = await ctx.lcu('GET', `${CS}/session`);
  if (!ctx.vivo()) return;
  if (r.ok && r.json && typeof r.json === 'object') aoSessao(st, r.json);
  else if (!st.sessao) {
    st.partes.time.replaceChildren(st.el('div', { class: 'lc-cp-nota', style: { padding: '10px 4px' } }, 'lendo a seleção…'));
    ctx.tempo(() => { if (!st.sessao) ctx.falhou(new Error(`a sessão da seleção não chegou (${r.status})`)); }, 3000);
  }
}

export function desmontar(raiz) {
  try { raiz?.classList?.remove('lc-cp-sel', 'lc-cp-sel-papel-on'); } catch { /* segue */ }
  try { if (atual?.fecharPapelClique) raiz?.removeEventListener?.('click', atual.fecharPapelClique, true); } catch { /* segue */ }
  try { if (atual?.fecharPapelClique) atual.docPapel?.removeEventListener?.('keydown', atual.fecharPapelClique, true); } catch { /* segue */ }
  atual = null;
}

// só para o teste e para depuração (window.__lolClient.compacto.montada())
export const _estado = () => atual;

function montarEsqueleto(st) {
  const { el, ctx, raiz } = st;
  const p = st.partes = {
    fase: el('div', { class: 'lc-cp-sel-f' }),
    tempo: el('span', { class: 'lc-cp-sel-t', title: 'tempo da fase' }),
    barra: el('i'),
    receb: el('div'),
    time: el('div', { class: 'lc-cp-sel-time' }),
    toggle: el('button', { dataset: { a: 'inimigos' }, on: { click: ctx.seguro(() => { st.inimigosAbertos = !st.inimigosAbertos; pintar(st); }) } }, 'recolher'),
    inim: el('div'),
    sel: el('div', { class: 'lc-cp-sel-sel' }),
    busca: el('input', { placeholder: 'buscar campeão', dataset: { a: 'busca' }, spellcheck: 'false' }),
    favs: el('div', { class: 'lc-cp-sel-favs' }),
    grade: el('div', { class: 'lc-cp-sel-grade' }),
    acao: el('div', { class: 'lc-cp-sel-acao' }),
  };
  p.busca.addEventListener('input', ctx.seguro(() => { st.busca = String(p.busca.value || ''); pintarGrade(st); }));
  ctx.titulo.append(p.fase);
  ctx.extras.append(p.tempo);
  botaoCoach(ctx); // passo 13 B2: 📊 abre o selo completo ao lado (só no clique dele)
  botaoChat(ctx); // protótipo (tela 3): relógio, 💬 com o contador, expandir
  raiz.append(
    el('div', { class: 'lc-cp-sel-barra' }, p.barra),
    p.receb,
    el('div', { class: 'lc-cp-sel-sec' }, el('span', {}, 'seu time · ordem de escolha')),
    p.time,
    el('div', { class: 'lc-cp-sel-sec' }, el('span', {}, 'time inimigo · só campeão'), p.toggle),
    p.inim,
    p.sel,
  );
}

function aoSessao(st, s) {
  const { ctx } = st;
  st.ultimoEvento = _relogio.agora();
  const l = lerSessao(s);
  if (!l) throw new Error('sessão da seleção sem myTeam');
  // seleção com banco (ARAM), espectador ou sem seleção: a tela é da Riot
  if (s.benchEnabled || s.isSpectating || l.fila === 450) {
    if (!st.saiu) { st.saiu = true; ctx.avisar('esta seleção (banco/ARAM ou espectador) é da tela da Riot: abrindo o client normal'); ctx.expandir(); }
    return;
  }
  if (st.sessao?.id !== s.id || st.l?.me !== l.me) { st.escolhido = 0; st.spAberto = null; st.skins = null; st.runa = null; }
  // escolha local vale só para a ação em que foi feita (intenção 18 -> ban 4 -> pick 18): nunca carrega para o ban
  if ((l.modo.acao?.id ?? null) !== st.acaoId) { st.acaoId = l.modo.acao?.id ?? null; st.escolhido = 0; }
  st.sessao = s; st.l = l;
  // hover enviado vale até a sessão mostrar ele (ou a ação mudar, ou REENVIO_MS): evento velho não faz reenviar o mesmo
  const he = st.hoverEnviado;
  if (he && (l.modo.acao?.id !== he.acao || noClient(l) === he.id || Date.now() - he.em > REENVIO_MS)) st.hoverEnviado = null;
  // banir/travar clicado: a ação fechou ou mudou na sessão = acabou (o resto, a conferência decide)
  if (st.fechando && l.modo.acao?.id !== st.fechando.acao) st.fechando = null;
  armar(st);
  st.fim = fimDaFase(l.timer); // pela foto (internalNow), nunca pela chegada do evento: a foto repetida não volta o relógio
  for (const r of acompanharPedidos(st.mem, s)) {
    if (r.resultado === 'morreu' || r.resultado === 'sumiu') ctx.avisar(textoResultado(r, rotuloDe(l, r.cellId)));
    ctx.tempo(() => pintar(st), RESULTADO_MS + 100);
  }
  if (st.escolhido && l.modo.tipo === 'finalizar') st.escolhido = 0;
  lerListas(st);
  lerSlots(st);
  if (l.modo.tipo === 'finalizar') { lerSkins(st); lerFeiticos(st); lerRuna(st); }
  lerPreferidas(st, s);
  papelAoSessao(st, s, l);
  pintar(st);
}

// ---------- posição em destaque (passo 16): quando abre e quando fecha o painel ----------
const chaveSessao = (st, s) => (s?.id ? `s${s.id}` : num(s?.gameId) > 0 ? `g${num(s.gameId)}` : `m${st.montagem}`);
// abre: 1ª vez que esta seleção mostra esta posição (PLANNING, ou a 1ª fase vista, ou a posição nova de uma troca, inclusive a
// volta para a de antes), e só com a vez de outro (intenção/esperar). Fecha: vez dele de agir (ban/pick) na hora, sem
// posição, prazo, clique ou tecla. Guarda também a posição de entrada (papelDe separa troca de autofill por ela).
function papelAoSessao(st, s, l) {
  const pos = l.eu?.pos || '';
  const agir = l.modo.tipo === 'banir' || l.modo.tipo === 'escolher';
  if (st.papelAberto && (agir || !POS[pos])) fecharPapel(st);
  st.sid = chaveSessao(st, s);
  if (!POS[pos]) return;
  const vistos = vistosPapel();
  let m = vistos.get(st.sid);
  if (!m) {
    if (vistos.size > 200) vistos.clear();
    m = { ini: pos, vis: '' };
    vistos.set(st.sid, m);
  }
  if (m.vis === pos) return;
  m.vis = pos;
  guardarPapel();
  if (l.modo.tipo !== 'intencao' && l.modo.tipo !== 'esperar') return;
  st.papelAberto = true;
  const g = ++st.genPapel;
  st.ctx.tempo(() => { if (st.genPapel === g && st.papelAberto) { fecharPapel(st); pintar(st); } }, _papel.ms);
}
function fecharPapel(st) { st.papelAberto = false; st.genPapel++; }
// a posição dele agora, com as preferidas e a posição de entrada desta seleção
const papelAgora = st => papelDe(st.l, st.prefs, vistosPapel().get(st.sid)?.ini || '');

// 1ª e 2ª posição pedidas no lobby: GET /lol-lobby/v2/lobby na seleção ([S]: o coletor lê no Lobby/Matchmaking/ReadyCheck e só
// tenta na seleção quando não leu antes, coletor.py ler_preferidas; sem medição de que responde aqui). Falhou = a última
// leitura da tela do lobby (comum.js preferidasLobby, até PREFS_LOBBY_MS); sem nenhuma = só o isAutofilled decide.
// Uma leitura por seleção.
function lerPreferidas(st, s) {
  if (!POS[st.l?.eu?.pos || '']) return;
  const sid = chaveSessao(st, s);
  if (st.prefsSid === sid) return;
  st.prefsSid = sid; st.prefs = null;
  const doLobby = () => (preferidasLobby.em && Date.now() - preferidasLobby.em < PREFS_LOBBY_MS && (preferidasLobby.pos1 || preferidasLobby.pos2)
    ? { pos1: posDe(preferidasLobby.pos1), pos2: posDe(preferidasLobby.pos2) } : null);
  st.prefs = doLobby();
  st.ctx.lcu('GET', '/lol-lobby/v2/lobby').then(st.ctx.seguro(r => {
    const m = r.ok && r.json && typeof r.json === 'object' ? r.json.localMember : null;
    if (st.prefsSid !== sid || !m || typeof m !== 'object') return;
    st.prefs = { pos1: posDe(m.firstPositionPreference), pos2: posDe(m.secondPositionPreference) };
    pintar(st);
  }));
}

const rotuloDe = (l, cell) => l?.time.find(t => t.cellId === cell)?.rotulo || 'aliado';
const nomeDe = (st, id) => st.cat.get(id)?.nome || (id > 0 ? `campeão ${id}` : '');

// ---------- leituras de apoio (falha = segue sem: botão cinza ou lista inteira) ----------
function lerListas(st) {
  const { l, ctx } = st;
  if (!['intencao', 'esperar', 'banir', 'escolher'].includes(l.modo.tipo)) return;
  const feitas = acoes(st.sessao).filter(a => a.completed).length;
  const chave = `${st.sessao.id}|${l.fase}|${l.modo.tipo}|${feitas}`;
  if (chave === st.chaveListas) return;
  st.chaveListas = chave;
  const ids = r => (r.ok && Array.isArray(r.json) ? new Set(r.json.map(Number).filter(n => n > 0)) : null);
  const rota = l.modo.tipo === 'banir' ? 'bannable-champion-ids' : 'pickable-champion-ids';
  ctx.lcu('GET', `${CS}/${rota}`).then(ctx.seguro(r => {
    if (st.chaveListas !== chave) return;
    const lista = ids(r);
    if (rota === 'bannable-champion-ids') st.bannable = lista; else st.pickable = lista;
    // só tamanhos, nunca nome: o console do Pengu cai no LeagueClientUx.log (prova da grade vazia de 14/10/2026)
    const noCat = lista && st.cat.size ? [...lista].filter(x => st.cat.has(x)).length : -1;
    (ctx.log || console.log)(`[lol-client] compacto: ${rota} ${l.fase}/${l.modo.tipo} status=${r.status} n=${lista ? lista.size : 'sem lista'} noCatalogo=${noCat}`);
    st.chaveSel = ''; pintar(st);
  }));
}

// summoners/{slotId}: só os show* dos aliados (slot ↔ cell pelo cellId da resposta) [S]; falha = sem enriquecimento
function lerSlots(st) {
  const { l, ctx } = st;
  if (st.slotsVoo || Date.now() - st.slotsEm < 2000 || !['PLANNING', 'BAN_PICK', 'FINALIZATION'].includes(l.fase)) return;
  st.slotsVoo = true; st.slotsEm = Date.now();
  const cells = new Set(l.time.filter(t => !t.eu).map(t => t.cellId));
  Promise.all([0, 1, 2, 3, 4].map(i => ctx.lcu('GET', `${CS}/summoners/${i}`))).then(ctx.seguro(rs => {
    st.slotsVoo = false;
    const m = new Map();
    for (const r of rs) {
      const j = r.ok && r.json && typeof r.json === 'object' ? r.json : null;
      if (!j || j.isOnPlayersTeam === false || !cells.has(num(j.cellId))) continue;
      m.set(num(j.cellId), { showTrades: j.showTrades, showSwaps: j.showSwaps, showPositionSwaps: j.showPositionSwaps });
    }
    st.slots = m;
    pintar(st);
  }));
}

function lerSkins(st) {
  const { l, ctx } = st;
  const champ = l.eu?.travado || 0;
  if (!champ) return;
  const k = st.skins;
  if (k && k.campeao === champ && (k.lista || k.voo || Date.now() - k.em < 3000)) return;
  st.skins = { campeao: champ, lista: k?.campeao === champ ? k.lista : null, voo: true, em: Date.now() };
  ctx.lcu('GET', `${CS}/skin-carousel-skins`).then(ctx.seguro(r => {
    if (st.skins?.campeao !== champ) return;
    const lista = r.ok ? skinsDoCampeao(r.json, champ) : [];
    st.skins = { campeao: champ, lista: lista.length ? lista : null, voo: false, em: Date.now() };
    st.chaveSel = ''; pintar(st);
  }));
}

function lerFeiticos(st) {
  if (st.feiticos) return;
  st.feiticos = { ...FEITICOS };
  st.ctx.lcu('GET', '/lol-game-data/assets/v1/summoner-spells.json').then(st.ctx.seguro(r => {
    if (!r.ok || !Array.isArray(r.json)) return;
    const m = {};
    for (const f of r.json) if (num(f?.id) > 0 && Array.isArray(f.gameModes) && f.gameModes.includes('CLASSIC') && f.name) m[num(f.id)] = String(f.name);
    if (Object.keys(m).length >= 5) { st.feiticos = m; st.chaveSel = ''; pintar(st); }
  }));
}

function lerRuna(st) {
  const { l, ctx } = st;
  const cfg = ctx.cfg || {};
  const champ = l.eu?.travado || 0;
  if (!champ || (st.runa && st.runa.campeao === champ)) return;
  if (!cfg.runas?.ligado) { st.runa = { campeao: champ, estado: 'desligada' }; return; }
  st.runa = { campeao: champ, estado: 'lendo' };
  Promise.all([ctx.lcu('GET', '/lol-perks/v1/pages'), ctx.lcu('GET', '/lol-perks/v1/currentpage')]).then(ctx.seguro(([p, a]) => {
    if (st.runa?.campeao !== champ) return;
    if (!p.ok || !Array.isArray(p.json)) { st.runa = { campeao: champ, estado: 'erro' }; st.chaveSel = ''; pintar(st); return; }
    const paginas = p.json.filter(x => x && x.isEditable);
    const { candidatas } = consultarRunas(cfg.runas.regras, champ, l.eu?.pos, paginas);
    const porId = new Map(paginas.map(x => [x.id, x]));
    st.runa = { campeao: champ, estado: 'ok', candidatas: candidatas.map(id => ({ id, nome: String(porId.get(id)?.name ?? id) })),
      atual: a.ok && a.json ? { id: a.json.id, nome: String(a.json.name ?? '') } : null };
    // 2+ páginas: a escolha é desta tela; o popup do runas.js (escondido no compacto) sai, com o Esc dele
    // (o runas.js lê páginas e nomes antes de abrir: fecha de novo depois, para o popup que nasce atrasado)
    if (candidatas.length > 1) {
      const fechar = () => { try { ctx.servicos?.runas?.fecharPopup?.(); } catch { /* segue */ } };
      fechar(); ctx.tempo(fechar, 1500); ctx.tempo(fechar, 5000);
    }
    // 1 página: o runas.js aplica sozinho ao travar; relê a atual para mostrar o ✓
    if (candidatas.length === 1 && st.runa.atual?.id !== candidatas[0]) ctx.tempo(() => relerRunaAtual(st, champ), 1500);
    st.chaveSel = ''; pintar(st);
  }));
}
function relerRunaAtual(st, champ) {
  st.ctx.lcu('GET', '/lol-perks/v1/currentpage').then(st.ctx.seguro(a => {
    if (st.runa?.campeao !== champ || !a.ok || !a.json) return;
    st.runa = { ...st.runa, atual: { id: a.json.id, nome: String(a.json.name ?? '') } };
    st.chaveSel = ''; pintar(st);
  }));
}

// ---------- escritas: só por clique dele ----------
// uma por chave por vez; erro vira aviso (a tela continua: dá para tentar de novo ou expandir)
function escrever(st, chave, passos, ok, depois) {
  const { ctx } = st;
  if (st.ocupado.has(chave)) return;
  st.ocupado.add(chave);
  pintar(st);
  (async () => {
    for (const [metodo, url, corpo, erro] of passos) {
      const r = await lcuComPrazo(st, metodo, url, corpo);
      if (!ctx.vivo()) return;
      if (!r.ok) { ctx.avisar(`${erro} (${r.status || 'sem resposta'})`, true); return; }
    }
    if (ok) ctx.avisar(ok);
    depois?.();
  })().catch(e => ctx.falhou(e)).finally(() => { st.ocupado.delete(chave); if (ctx.vivo()) { st.chaveSel = ''; pintar(st); } });
}

// o campeão que o client já tem na ação que a tela usa (intenção: o hover do myTeam; vez dele: a ação)
const noClient = l => (l.modo.tipo === 'intencao' || l.modo.tipo === 'esperar' ? (l.eu?.hover || l.modo.acao?.championId || 0) : (l.modo.acao?.championId || 0));

// botão BANIR/TRAVAR: a cada ação nova (tipo + id, inclusive a 1ª pintura) fica cinza por ARMAR_MS. Geração: duas viradas
// dentro do prazo não armam cedo (não há como cancelar o timer)
function armar(st) {
  const { l, ctx } = st;
  const chave = `${l.modo.tipo}|${l.modo.acao?.id ?? ''}`;
  if (chave === st.chaveArmar) return;
  st.chaveArmar = chave;
  if (l.modo.tipo !== 'banir' && l.modo.tipo !== 'escolher') { st.armando = false; return; }
  st.armando = true;
  const g = ++st.genArmar;
  ctx.tempo(() => { if (st.genArmar !== g) return; st.armando = false; st.chaveSel = ''; pintar(st); }, ARMAR_MS);
}

// LCU com prazo: resolve uma vez só, com a resposta ou com {ok:false, status:0} no fim do prazo (a resposta atrasada
// depois disso é ignorada: nada roda duas vezes)
function lcuComPrazo(st, metodo, url, corpo, ms = PRAZO_MS) {
  const { ctx } = st;
  return new Promise(res => {
    let feito = false;
    const fim = r => { if (!feito) { feito = true; res(r); } };
    ctx.tempo(() => fim({ ok: false, status: 0, json: null, erro: 'sem resposta' }), ms);
    Promise.resolve(ctx.lcu(metodo, url, corpo)).then(fim, e => fim({ ok: false, status: 0, json: null, erro: e?.message || String(e) }));
  });
}

const VERBO = { banir: { rot: 'BANIR', ger: 'BANINDO', fez: 'baniu' }, travar: { rot: 'TRAVAR', ger: 'TRAVANDO', fez: 'travou' } };

// clique num campeão = hover na ação dele (como o client: o time vê). Na intenção (PLANNING ou vez de outro) isso JÁ é
// declarar: 1 clique, sem confirmar (pedido do Gabriel, 14/10/2026). Banir e travar seguem só no botão de baixo.
function clicarCampeao(st, id) {
  const { l, ctx } = st;
  const f = st.fechando;
  if (f) {
    // banir/travar já saiu: o clique na grade espera o client (um {completed:false} agora iria contra a ação fechando)
    if (f.enviado) return;
    // banir/travar esperando o hover em voo: o clique novo é ele mudando de ideia (nunca trava o campeão de antes)
    st.fechando = null;
    ctx.avisar(`${f.verbo === 'banir' ? 'ban' : 'travamento'} de ${f.nome} cancelado: clique em ${VERBO[f.verbo].rot} de novo`);
  }
  st.escolhido = id;
  const a = l.modo.acao;
  // o que vai ficar no client depois do que já saiu (o enviado vale até a sessão mostrar ele, ou REENVIO_MS)
  const he = st.hoverEnviado;
  const enviado = he?.acao === a?.id && Date.now() - he.em <= REENVIO_MS ? he.id : undefined;
  const ultimo = st.hover?.id ?? st.hoverVoo ?? enviado ?? noClient(l);
  if (a && ['banir', 'escolher', 'intencao', 'esperar'].includes(l.modo.tipo) && ultimo !== id) {
    st.hover = { acao: a.id, id, intencao: l.modo.tipo === 'intencao' || l.modo.tipo === 'esperar' };
    enviarHover(st);
  }
  st.chaveSel = ''; pintar(st);
}

// uma escrita de hover por vez; clique novo durante o voo fica guardado e o último vence (Zac e logo Renekton = Renekton)
function enviarHover(st) {
  const { ctx } = st;
  const q = st.hover;
  if (!q || st.ocupado.has('hover')) return;
  if (st.l?.modo.acao?.id !== q.acao) { st.hover = null; return; } // a ação mudou (virou o ban, travou): o clique morreu
  st.hover = null;
  st.ocupado.add('hover'); st.hoverVoo = q.id;
  const erro = q.intencao ? 'não foi possível declarar a intenção' : 'não foi possível marcar o campeão';
  lcuComPrazo(st, 'PATCH', `${CS}/session/actions/${q.acao}`, { completed: false, championId: q.id }, PRAZO_HOVER_MS).then(ctx.seguro(r => {
    st.ocupado.delete('hover'); st.hoverVoo = null;
    st.hoverEnviado = r.ok ? { acao: q.acao, id: q.id, em: Date.now() } : null;
    const f = st.fechando;
    if (f && !f.enviado) {
      // BANIR/TRAVAR clicado com este hover em voo. Sem resposta: o hover ainda pode chegar depois do travamento (ordem
      // incerta), então não manda; avisa e devolve o botão. Com resposta (mesmo erro): manda o que ele clicou
      st.hover = null;
      if (!r.ok && !r.status) {
        st.fechando = null;
        ctx.avisar(`o client não respondeu ao campeão marcado: clique em ${VERBO[f.verbo].rot} de novo ou em ⤢ expandir`, true);
        if (ctx.vivo()) { st.chaveSel = ''; pintar(st); }
        return;
      }
      if (!r.ok) ctx.avisar(`${erro} (${r.status})`, true);
      return enviarAcao(st);
    }
    if (!r.ok) ctx.avisar(`${erro} (${r.status || 'sem resposta'})`, true);
    if (st.hover) enviarHover(st);
    else if (ctx.vivo()) { st.chaveSel = ''; pintar(st); }
  }));
}

function confirmarAcao(st) {
  const { l } = st;
  const a = l.modo.acao, id = alvoPadrao(st);
  if (!a || !id || (l.modo.tipo !== 'banir' && l.modo.tipo !== 'escolher')) return;
  // 2º clique (clique duplo, ou o evento da sessão ainda não chegou), botão ainda armando ou campeão que não vale
  if (st.fechando || st.ocupado.has('acao') || st.armando || !dadosEscolha(st).pode(id)) return;
  st.hover = null; // hover guardado não passa por cima do travamento
  st.fechando = { acao: a.id, id, verbo: l.modo.tipo === 'banir' ? 'banir' : 'travar', nome: nomeDe(st, id), enviado: false };
  // um hover ainda em voo chegaria DEPOIS do travamento (ordem não garantida): espera ele voltar (enviarHover manda)
  if (st.ocupado.has('hover')) { st.chaveSel = ''; pintar(st); return; }
  enviarAcao(st);
}

// o corpo do botão da Riot: 1 PATCH com completed e o campeão juntos (o POST .../complete trava o campeão 0)
function enviarAcao(st) {
  const { ctx } = st;
  const f = st.fechando;
  if (!f || f.enviado) return;
  const repintar = () => { if (ctx.vivo()) { st.chaveSel = ''; pintar(st); } };
  // o pendente esperou o hover: refaz as checagens do botão (a ação pode ter mudado, o campeão pode ter sido pego)
  if (st.l?.modo.acao?.id !== f.acao) { st.fechando = null; return repintar(); }
  if (!dadosEscolha(st).pode(f.id)) {
    st.fechando = null;
    ctx.avisar(`${f.nome} não está mais disponível: escolha outro`, true);
    return repintar();
  }
  f.enviado = true;
  st.ocupado.add('acao');
  // a conferência conta do clique: roda em CONFERIR_MS ou na resposta 2xx, o que vier por último
  let prazo = false, ok = false;
  ctx.tempo(() => { prazo = true; if (ok) conferirAcao(st, f); }, CONFERIR_MS);
  repintar();
  lcuComPrazo(st, 'PATCH', `${CS}/session/actions/${f.acao}`, { completed: true, championId: f.id }).then(ctx.seguro(r => {
    st.ocupado.delete('acao');
    if (!r.ok) {
      if (st.fechando === f) st.fechando = null;
      ctx.avisar(`não foi possível ${f.verbo} ${f.nome} (${r.status || 'sem resposta'}): tente de novo ou use ⤢ expandir`, true);
    } else { ok = true; if (prazo) conferirAcao(st, f); }
    repintar();
  }));
}

// 2xx não prova que travou (14/10/2026: 204 e nada): relê a sessão (o evento pode estar atrasado: socket mudo) e, com a
// ação ainda aberta, avisa com a saída e devolve o botão. Nunca tenta de novo sozinho.
function conferirAcao(st, f) {
  const { ctx } = st;
  lcuComPrazo(st, 'GET', `${CS}/session`).then(ctx.seguro(r => {
    const s = r.ok && r.json && typeof r.json === 'object' ? r.json : st.sessao;
    const a = acoes(s).find(x => x.id === f.acao);
    const aberta = a && !a.completed && a.isInProgress;
    if (st.fechando === f) st.fechando = null;
    if (aberta) ctx.avisar(`o client não ${VERBO[f.verbo].fez} ${f.nome}: tente de novo ou use ⤢ expandir`, true);
    // fechou no client e o evento não veio (socket mudo): a tela passa a valer a sessão relida (sem isso o botão voltaria
    // ligado para uma ação já fechada)
    else if (r.ok && Array.isArray(r.json?.myTeam) && st.l?.modo.acao?.id === f.acao) return aoSessao(st, r.json);
    if (ctx.vivo()) { st.chaveSel = ''; pintar(st); }
  }));
}

function troca(st, tr, id, verbo, cellId) {
  if (!Number.isInteger(id)) return;
  if (verbo !== 'request' && cellId !== undefined) marcarClique(st.mem, tr.tipo, cellId, verbo);
  const txt = { request: 'pedir', cancel: 'cancelar', accept: 'aceitar', decline: 'recusar' }[verbo];
  escrever(st, `troca:${tr.tipo}:${id}`, [['POST', `${CS}/session/${tr.rota}/${id}/${verbo}`, undefined, `não foi possível ${txt} a troca de ${tr.nome}`]]);
}

// ---------- pintura ----------
function relogio(st) {
  const { partes: p, l } = st;
  if (!l) return;
  if (l.timer.infinito) { p.tempo.textContent = '∞'; p.barra.style.width = '100%'; return; }
  const resta = Math.max(0, st.fim - _relogio.agora());
  p.tempo.textContent = String(Math.floor(resta / 1000)); // floor como a tela da Riot (timeRemaining)
  p.barra.style.width = (l.timer.total > 0 ? Math.min(100, resta / l.timer.total * 100) : 0) + '%';
  p.barra.classList.toggle('lc-cp-sel-fim', resta < 8000);
}

function pintar(st) {
  if (!st.l || !st.ctx.vivo()) return;
  const [f, sub] = rotuloFase(st.l);
  st.partes.fase.replaceChildren(f, st.el('small', {}, sub));
  relogio(st);
  pintarRecebida(st);
  pintarTime(st);
  pintarInimigos(st);
  pintarSel(st);
  pintarPapel(st);
}

// painel da posição: irmão da caixa de seleção (a caixa fica no DOM, escondida pela classe da raiz), nunca sobre o pedido de
// troca recebido nem sobre os times
function pintarPapel(st) {
  const { raiz, partes: p, el } = st;
  const papel = st.papelAberto ? papelAgora(st) : null;
  raiz.classList.toggle('lc-cp-sel-papel-on', !!papel);
  if (!papel) { if (p.papel) { p.papel.remove(); p.papel = null; } return; }
  const chave = `${papel.pos}|${papel.destaque}|${papel.nota}|${_papel.semIcone}`;
  if (p.papel?.parentNode === raiz && p.papelChave === chave) return;
  // refeito com a mesma posição (o lobby respondeu e o destaque mudou): sem a entrada animada de novo
  const refeito = !!p.papel && p.papelPos === papel.pos;
  p.papel?.remove();
  const icone = _papel.semIcone ? null : el('img', { src: papel.icone, alt: '', dataset: { a: 'papel-icone' },
    on: { error: e => { _papel.semIcone = true; try { e?.target?.remove?.(); } catch { /* segue */ } } } });
  p.papel = el('div', { class: `lc-cp-sel-papel-painel lc-cp-sel-d-${papel.destaque}`, role: 'status', title: 'clique para fechar',
    dataset: { a: 'papel-painel', destaque: papel.destaque }, on: { click: st.fecharPapelClique } },
  icone, el('div', { class: 'lc-cp-sel-papel-nome' }, papel.nome), el('div', { class: 'lc-cp-sel-papel-nota' }, papel.nota),
  el('div', { class: 'lc-cp-sel-papel-dica' }, 'sua posição · fecha sozinho ou com um clique'));
  p.papelChave = chave; p.papelPos = papel.pos;
  if (refeito) p.papel.style.animation = 'none';
  raiz.insertBefore(p.papel, p.sel);
}

// pedido que chegou: o 1º RECEIVED (um por vez no client: os outros ficam BUSY)
function recebida(st) {
  for (const t of st.l.time) {
    if (t.eu) continue;
    for (const tr of TROCAS) {
      const e = estadoTroca(st.sessao, tr, t.cellId);
      if (e.estado === 'RECEIVED') return { t, tr, e };
    }
  }
  return null;
}

function pintarRecebida(st) {
  const { el, l, partes: p, ctx } = st;
  const r = recebida(st);
  if (!r) return p.receb.replaceChildren();
  const { t, tr, e } = r, eu = l.eu || {};
  let txt;
  if (tr.tipo === 'POSICAO') txt = [el('b', {}, t.rotulo), ` (${nomePos(t.pos)}) quer trocar de posição: você vai para `, el('b', {}, nomePos(t.pos)), ', ele para ', el('b', {}, nomePos(eu.pos)), '.'];
  else if (tr.tipo === 'ORDEM') txt = [el('b', {}, t.rotulo), ' quer trocar a ordem de escolha: você escolhe em ', el('b', {}, `${t.n}º`), ', ele em ', el('b', {}, `${eu.n}º`), '.'];
  else txt = [el('b', {}, t.rotulo), ' quer trocar de campeão: você fica com ', el('b', {}, nomeDe(st, t.travado) || 'o campeão dele'), ', ele com ', el('b', {}, nomeDe(st, eu.travado) || 'o seu'), '.'];
  const ocupado = st.ocupado.has(`troca:${tr.tipo}:${e.id}`);
  p.receb.replaceChildren(el('div', { class: 'lc-cp-sel-receb', role: 'alert' },
    el('div', { class: 'lc-cp-sel-tt' }, `pedido de troca de ${tr.nome}`), ...txt,
    el('div', { class: 'lc-cp-sel-bts' },
      el('button', { class: 'lc-cp-btn lc-cp-prim', disabled: ocupado, dataset: { a: 'aceitar', tipo: tr.tipo }, on: { click: ctx.seguro(() => troca(st, tr, e.id, 'accept', t.cellId)) } }, 'aceitar'),
      el('button', { class: 'lc-cp-btn lc-cp-verm', disabled: ocupado, dataset: { a: 'recusar', tipo: tr.tipo }, on: { click: ctx.seguro(() => troca(st, tr, e.id, 'decline', t.cellId)) } }, 'recusar'))));
}

function foto(st, id, tam, extra = '') {
  if (!(id > 0)) return st.el('span', { class: 'lc-cp-foto lc-cp-sel-vazio' + extra, style: { width: tam + 'px', height: tam + 'px' } }, '?');
  const f = fotoCampeao(id, { tam, nome: nomeDe(st, id), doc: st.doc });
  f.dataset.campeao = String(id);
  if (extra) f.className += extra;
  return f;
}

function pintarTime(st) {
  const { el, l, ctx, partes: p, sessao: s, mem } = st;
  const linhas = l.time.map(t => {
    const agindo = l.modo.tipo === 'escolher' && t.eu;
    // foto: travado = normal; intenção/hover (meu ou de aliado: championPickIntent ou a ação aberta, lerSessao) = foto
    // com a marca de intenção, como no client da Riot (Gabriel, 14/10/2026: "só aparece depois que pica")
    const c = t.travado || t.hover;
    const fotoLinha = c ? foto(st, c, 30, t.travado ? '' : ' lc-cp-sel-intencao') : foto(st, 0, 30);
    if (!t.travado && c) fotoLinha.setAttribute('title', `intenção: ${nomeDe(st, c)}`);
    let det;
    if (t.travado) det = nomeDe(st, t.travado);
    else if (t.hover) det = el('i', {}, t.eu ? `${nomeDe(st, t.hover)} (escolhendo)` : `intenção: ${nomeDe(st, t.hover)}`);
    else det = el('i', {}, agindo ? 'escolhendo…' : 'ainda não escolheu');
    // a minha posição vira a palavra grande à direita (passo 16): embaixo do "tu" fica só o campeão
    // e o "(escolhendo)" sai também (a foto tracejada e o itálico já dizem que é intenção): com ATIRADOR e o selo na coluna da
    // direita sobram ~85 px em 420 de largura (harness, 15/10/2026: "Renekton (escolhendo)" cortava a 74/106 px)
    const papel = t.eu ? papelAgora(st) : null;
    if (papel && !t.travado && t.hover) det = el('i', { title: `intenção: ${nomeDe(st, t.hover)}` }, nomeDe(st, t.hover));
    const nome = el('div', { class: 'lc-cp-sel-n' }, t.rotulo, el('small', {}, papel ? '' : `${nomePos(t.pos)} · `, det));
    let dir = '';
    // selo do meu campeão (hover ou travado), à direita da linha "tu" (onde os aliados têm as trocas): passo 11 b6
    const selo = t.eu && c && estatLigada(st) ? textoSeloTela(ctx.servicos?.champ, c, t.pos, nomeDe(st, c)) : null;
    // poucas partidas na posição: a linha da posição do selo em amarelo (o texto do aviso fica na seleção)
    const pouco = selo && papel && !t.travado ? !!avisoPosicao(ctx.servicos?.champ, c, t.pos, nomeDe(st, c)) : false;
    if (selo) dir = el('div', { class: 'lc-cp-sel-selo' + (pouco ? ' lc-cp-sel-pouco' : ''), dataset: { a: 'selo' }, title: selo.titulo || undefined },
      ...selo.linhas.map(l => el('span', {}, l)));
    if (papel) {
      dir = el('div', { class: 'lc-cp-sel-eudir' }, dir || null,
        el('div', { class: `lc-cp-sel-papel lc-cp-sel-d-${papel.destaque}`, title: `${papel.nome}: ${papel.nota}`, dataset: { a: 'papel', destaque: papel.destaque } }, papel.nome));
    }
    if (!t.eu) {
      const res = mem.resultados.get(t.cellId);
      const estados = TROCAS.map(tr => [tr, estadoTroca(s, tr, t.cellId, st.slots.get(t.cellId))]);
      const enviada = estados.find(([, e]) => e.estado === 'SENT');
      const chegou = estados.find(([, e]) => e.estado === 'RECEIVED');
      if (enviada) {
        const [tr, e] = enviada;
        dir = el('div', { class: 'lc-cp-sel-pend' }, `pedido de ${tr.nome} enviado`, el('br'), 'aguardando… ',
          el('button', { dataset: { a: 'cancelar', tipo: tr.tipo }, disabled: st.ocupado.has(`troca:${tr.tipo}:${e.id}`), on: { click: ctx.seguro(() => troca(st, tr, e.id, 'cancel', t.cellId)) } }, 'cancelar'));
      } else if (chegou) {
        dir = el('div', { class: 'lc-cp-sel-pend' }, `pediu troca de ${chegou[0].nome}`, el('br'), 'responda acima');
      } else if (res && res.ate > Date.now()) {
        const ruim = res.resultado !== 'aceito';
        dir = el('div', { class: 'lc-cp-sel-pend ' + (ruim ? 'lc-cp-sel-ruim' : 'lc-cp-sel-bom') }, textoResultado(res, t.rotulo));
      } else {
        dir = el('div', { class: 'lc-cp-sel-trocas' }, ...estados.map(([tr, e]) => (e.estado === 'AVAILABLE'
          ? el('button', { title: `pedir troca de ${tr.nome} com ${t.rotulo}`, dataset: { a: 'pedir', tipo: tr.tipo, cell: t.cellId },
            disabled: st.ocupado.has(`troca:${tr.tipo}:${e.id}`), on: { click: ctx.seguro(() => troca(st, tr, e.id, 'request')) } }, tr.botao)
          : el('button', { disabled: true, class: e.estado === 'BUSY' ? 'lc-cp-sel-busy' : undefined, title: e.motivo, dataset: { tipo: tr.tipo, estado: e.estado, cell: t.cellId } }, tr.botao))));
      }
    }
    return el('div', { class: `lc-cp-sel-lin${t.eu ? ' lc-cp-sel-eu' : ''}${agindo ? ' lc-cp-sel-agindo' : ''}`, dataset: { cell: t.cellId } },
      el('span', { class: 'lc-cp-sel-o' }, String(t.n)), fotoLinha, nome, dir);
  });
  p.time.replaceChildren(...linhas);
}

function pintarInimigos(st) {
  const { el, l, partes: p } = st;
  p.toggle.textContent = st.inimigosAbertos ? 'recolher' : 'mostrar';
  if (!st.inimigosAbertos) return p.inim.replaceChildren();
  const vis = l.inimigos.length;
  const fotos = Array.from({ length: Math.max(l.nInimigos, vis) }, (_, i) => (i < vis ? foto(st, l.inimigos[i], 34) : foto(st, 0, 34)));
  const filhos = [el('div', { class: 'lc-cp-sel-inim', dataset: { a: 'inimigos-fotos' } }, ...fotos,
    el('span', { class: 'lc-cp-nota', style: { marginLeft: '4px' } }, vis ? `${vis} de ${l.nInimigos} travados` : 'aparece quando cada um trava'))];
  if (l.banidos.length) {
    const nomes = l.banidos.map(b => nomeDe(st, b.id) + (b.meu ? ' (seu)' : '')).join(', ');
    filhos.push(el('div', { class: 'lc-cp-sel-bans', title: nomes, dataset: { a: 'bans' } }, el('span', {}, `${l.banidos.length} banidos`),
      ...l.banidos.map(b => foto(st, b.id, 22, b.meu ? ' lc-cp-sel-teu' : ''))));
  }
  p.inim.replaceChildren(...filhos);
}

function pintarSel(st) {
  const { l, ctx } = st;
  const tipo = l.modo.tipo;
  if (['intencao', 'esperar', 'banir', 'escolher'].includes(tipo)) return pintarEscolha(st);
  if (st.modoSel !== tipo) { st.modoSel = tipo; st.chaveSel = ''; }
  if (tipo === 'finalizar') return pintarFinal(st);
  const chave = `desconhecido|${l.fase}`;
  if (chave === st.chaveSel) return;
  st.chaveSel = chave;
  st.partes.sel.replaceChildren(st.el('div', { class: 'lc-cp-nota' }, `fase da seleção desconhecida (${l.fase || 'sem leitura'}): use ⤢ expandir para a tela da Riot.`));
}

// "winrate no champ select" (champSelect.ligado) vale nos dois modos: desligado, nem os números dos favoritos nem o selo
const estatLigada = st => st.ctx.cfg?.champSelect?.ligado !== false;

// Selo do campeão em hover ou travado (plano, passo 11 b6): os números do champselect.js (servicos.champ.estatisticas,
// o mesmo histórico do selo do client normal; nenhuma leitura nova) à direita da linha "tu", na coluna em que os
// aliados têm os botões de troca (vazia na minha linha). Altura zero: 2 linhas de 10,5 px cabem nos 42 px da linha
// (harness temp/compacto-harness em 420×680, fontes de reserva, 14/10/2026: 42 px e 0 de rolagem em 6 fases; uma 3ª
// linha embaixo do nome levava a linha a 50 px). Falta conferir com as fontes da Riot. Texto inteiro (textoSelo, as
// linhas do selo do client normal) no title. Matchup, trauma e draft do coletor ficam para o protótipo do grupo 2 (d2).
// -> {linhas: [geral, posição?], texto, titulo} | null (sem campeão ou sem o serviço)
export function textoSeloTela(champ, id, pos, nome = '') {
  if (!(id > 0) || typeof champ?.estatisticas !== 'function') return null;
  const so = (texto, titulo) => ({ linhas: [texto], texto, titulo });
  try {
    if (typeof champ.partidas === 'function' && champ.partidas() === null) {
      // leitura que falhou (sem outra em voo): o mesmo texto do selo do client normal, não "carregando" para sempre
      const e = typeof champ.estado === 'function' ? champ.estado() : null;
      return e?.falhou && !e.carregando ? so('histórico indisponível agora', 'nova leitura do histórico em instantes')
        : so('histórico carregando', 'lendo o histórico do client');
    }
    const est = champ.estatisticas(id, pos);
    const g = est?.geral;
    const titulo = () => { const t = textoSelo(est, nome); return [t.titulo, ...t.linhas].filter(Boolean).join('\n'); };
    if (!g?.n) return so('sem partidas com ele', titulo());
    const kda = v => (v === null ? ' · KDA perfeito' : typeof v === 'number' ? ` · KDA ${String(v).replace('.', ',')}` : '');
    const linhas = [`${g.n} ${g.n === 1 ? 'partida' : 'partidas'} · ${g.winrate}%${kda(g.kda)}`];
    const p = est.posicao;
    if (p?.pos) linhas.push(`${nomePos(p.pos).toLowerCase()}: ${p.n ? `${p.n} ${p.n === 1 ? 'partida' : 'partidas'} · ${p.winrate}%` : 'sem partidas'}`);
    return { linhas, texto: linhas.join(' · '), titulo: titulo() };
  } catch { return so('histórico indisponível', ''); }
}

function estatFav(st, id) {
  const champ = st.ctx.servicos?.champ;
  if (!estatLigada(st)) return '';
  try {
    if (!champ?.estatisticas || (typeof champ.partidas === 'function' && champ.partidas() === null)) return 'histórico carregando';
    const g = champ.estatisticas(id, st.l.eu?.pos)?.geral;
    return g?.n ? `${g.n} ${g.n === 1 ? 'partida' : 'partidas'} · ${g.winrate}%` : 'sem partidas';
  } catch { return 'histórico indisponível'; }
}

const favoritos = st => (Array.isArray(st.ctx.cfg?.compacto?.favoritos) ? st.ctx.cfg.compacto.favoritos : []).map(Number).filter(n => n > 0 && n < 10000);
function dadosEscolha(st) {
  const { fora, permitidos: lista } = indisponiveis(st.l, st.sessao, { pickable: st.pickable, bannable: st.bannable });
  // lista do client vazia ou sem nenhum id do catálogo (a grade do ban veio vazia na ranqueada de 14/10/2026, conteúdo
  // não capturado). No BAN não filtra por ela e avisa: banir não depende de ter o campeão e quem recusa o inválido é o
  // client, no clique dele. Na ESCOLHA (e na intenção) segue filtrando (só favoritos, cinza) com a nota e o ⤢: mostrar
  // campeão que ele não tem seria deixar de checar justo o que o client garante
  const semLista = !!lista && (lista.size === 0 || (st.cat.size > 0 && ![...lista].some(x => st.cat.has(x))));
  const permitidos = semLista && st.l.modo.tipo === 'banir' ? null : lista;
  return { fav: favoritos(st), fora, permitidos, semLista, id: alvoPadrao(st), pode: x => !fora.has(x) && (!permitidos || permitidos.has(x)) };
}

// por que o campeão do botão não vale (o botão fica cinza; CLAUDE.md: cinza sempre com motivo)
function motivoFora(st, d, id) {
  const { l } = st;
  const nome = nomeDe(st, id);
  if (l.banidosConhecidos.has(id)) return `${nome} foi banido: escolha outro.`;
  if (l.travados.has(id)) return `${nome} já foi escolhido: escolha outro.`;
  if (l.modo.tipo === 'banir') {
    const al = l.time.find(t => !t.eu && t.hover === id);
    if (al && d.fora.has(id)) return `${al.rotulo} quer jogar ${nome}: não pode ser banido, escolha outro.`;
    return `${nome} não está na lista de bans do client: escolha outro.`;
  }
  return `${nome} não está entre os seus campeões liberados: escolha outro ou use ⤢ expandir.`;
}
// campeão do botão: o clicado agora, senão o que o client já tem nesta ação. No ban, NUNCA a intenção de pick dele
// (a intenção declarada no PLANNING viraria "BANIR <o campeão dele>" a um clique)
export function alvoPadrao(st) {
  const l = st.l;
  if (st.escolhido) return st.escolhido;
  if (l.modo.tipo === 'banir') return l.modo.acao?.championId > 0 ? l.modo.acao.championId : 0;
  if (l.modo.tipo === 'escolher') return (l.modo.acao?.championId > 0 ? l.modo.acao.championId : 0) || l.eu?.hover || 0;
  return l.eu?.hover || 0;
}

// estrutura fixa do modo escolha: o campo de busca nunca sai do DOM (evento da sessão chega a cada ~1 s e tiraria
// o foco de quem está digitando); só o miolo de cada caixa se refaz
function pintarEscolha(st) {
  const { el, l, ctx, partes: p } = st;
  if (st.modoSel !== 'escolha') {
    st.modoSel = 'escolha'; st.chaveSel = ''; st.chaveGrade = '';
    p.notas = el('div', { style: { display: 'contents' } });
    p.fim = el('div', { style: { display: 'contents' } });
    if (p.busca.value !== st.busca) p.busca.value = st.busca;
    p.sel.replaceChildren(p.notas, el('div', { class: 'lc-cp-sel-busca' }, p.busca), p.favs, p.grade, p.acao, p.fim);
  }
  const d = dadosEscolha(st);
  const { fav, fora, permitidos, semLista, id, pode } = d;
  const tipo = l.modo.tipo;
  const ocupado = st.ocupado.has('acao');
  const stats = fav.map(x => estatFav(st, x));
  const f = st.fechando;
  // passo 16: campeão que ele vai jogar (intenção ou vez dele; nunca o ban) com poucas partidas na posição atribuída
  const avisoPos = tipo !== 'banir' && id && estatLigada(st) ? avisoPosicao(ctx.servicos?.champ, id, l.eu?.pos, nomeDe(st, id)) : null;
  const chave = JSON.stringify([tipo, l.modo.acao?.id, id, [...fora].sort(), permitidos ? permitidos.size : -1, semLista, st.cat.size, fav, stats, ocupado,
    l.meuBan, l.revelado, l.fase, st.armando, f && [f.acao, f.id, f.enviado], l.time.map(t => t.hover), avisoPos]);
  pintarGrade(st, d);
  if (chave === st.chaveSel) return;
  st.chaveSel = chave;
  p.favs.replaceChildren(...fav.map((x, i) => el('button', {
    class: 'lc-cp-sel-fav' + (x === id ? ' lc-cp-sel-on' : ''), disabled: !pode(x), dataset: { a: 'campeao', id: x },
    on: { click: ctx.seguro(() => clicarCampeao(st, x)) },
  }, foto(st, x, 28), el('span', {}, `★ ${nomeDe(st, x)}`, el('small', {}, stats[i])))));
  // banir e travar: botão de baixo, só com o clique dele. Intenção: o clique na grade já declara, e no lugar do botão fica
  // um marcador cinza do mesmo tamanho (sem ele, o TRAVAR que surge na vez dele empurraria a grade e um clique na última
  // fileira cairia no botão: revisão de 14/10/2026)
  if (tipo === 'banir' || tipo === 'escolher') {
    const v = VERBO[tipo === 'banir' ? 'banir' : 'travar'];
    const txt = f && f.acao === l.modo.acao?.id ? `${v.ger} ${f.nome}…` : id ? `${v.rot} ${nomeDe(st, id)}` : v.rot;
    p.acao.replaceChildren(el('button', {
      class: 'lc-cp-btn ' + (tipo === 'banir' ? 'lc-cp-verm' : 'lc-cp-prim'), dataset: { a: 'acao' },
      disabled: !l.modo.acao || !id || !pode(id) || ocupado || !!f || st.armando, on: { click: ctx.seguro(() => confirmarAcao(st)) },
    }, txt));
  } else {
    p.acao.replaceChildren(el('button', { class: 'lc-cp-btn', disabled: true, dataset: { a: 'acao-marcador' } },
      l.modo.acao ? 'clique num campeão para declarar' : 'sua vez ainda não chegou'));
  }
  const notas = [];
  if (avisoPos) notas.push(el('div', { class: 'lc-cp-nota lc-cp-sel-avisopos', dataset: { a: 'aviso-posicao' },
    title: 'suas partidas com este campeão nesta posição, no histórico do client; só um aviso, a escolha continua livre' }, `⚠ ${avisoPos}`));
  // sem lista na escolha a nota do sem-lista já explica o cinza
  if ((tipo === 'banir' || tipo === 'escolher') && id && !pode(id) && !(semLista && tipo !== 'banir') && !f)
    notas.push(el('div', { class: 'lc-cp-nota', dataset: { a: 'motivo' } }, motivoFora(st, d, id)));
  if (l.meuBan !== null && !l.revelado && l.fase === 'BAN_PICK' && tipo !== 'banir')
    notas.push(el('div', { class: 'lc-cp-nota' }, l.meuBan > 0 ? `seu ban: ${nomeDe(st, l.meuBan)}. Os bans dos 10 aparecem juntos quando todos terminarem.` : 'nenhum ban seu nesta seleção.'));
  // com o aviso da posição, as notas genéricas de espera/intenção saem (o aviso ocupa a linha delas: 1 linha a mais rolava
  // a tela 10 px em 420×680, harness 15/10/2026)
  if (tipo === 'esperar' && !avisoPos) notas.push(el('div', { class: 'lc-cp-nota' }, l.modo.acao ? 'sua vez de escolher ainda não chegou: um clique muda a intenção.' : 'sua vez ainda não chegou.'));
  // a nota da intenção fica no topo, com as outras: o que fica embaixo da grade tem altura fixa entre as fases
  if (tipo === 'intencao' && !avisoPos) notas.push(el('div', { class: 'lc-cp-nota' }, 'um clique declara a intenção (só o seu time vê); a escolha vale na sua vez.'));
  if (semLista) notas.push(el('div', { class: 'lc-cp-nota', dataset: { a: 'sem-lista' } }, tipo === 'banir'
    ? 'o client não mandou a lista de bans: mostrando todos (se não valer, o client recusa e avisa).'
    : 'o client não mandou a lista dos seus campeões: só os favoritos, em cinza. Use ⤢ expandir para escolher na tela da Riot.'));
  p.notas.replaceChildren(...notas);
  p.fim.replaceChildren();
}

// a grade se repinta à parte (busca digitada não refaz o resto nem perde o foco do campo)
function pintarGrade(st, dados) {
  const { el, ctx, partes: p, l } = st;
  if (!dados) {
    if (!l || st.modoSel !== 'escolha') return;
    dados = dadosEscolha(st);
  }
  const { fav, pode, id, permitidos } = dados;
  const ids = listaGrade(st.cat, { busca: st.busca, permitidos, favoritos: fav });
  const chave = JSON.stringify([ids, ids.map(pode), id, st.cat.size]);
  if (chave === st.chaveGrade) return;
  st.chaveGrade = chave;
  const rolagem = p.grade.scrollTop;
  p.grade.replaceChildren(...(ids.length ? ids.map(x => el('button', {
    class: 'lc-cp-sel-gc' + (x === id ? ' lc-cp-sel-on' : ''), disabled: !pode(x), title: nomeDe(st, x), dataset: { a: 'campeao', id: x },
    on: { click: ctx.seguro(() => clicarCampeao(st, x)) },
  }, foto(st, x, 30), el('span', { class: 'lc-cp-sel-nm' }, nomeDe(st, x)))) : [el('span', { class: 'lc-cp-nota' }, st.cat.size ? 'nenhum campeão com esse nome' : 'carregando os campeões…')]));
  p.grade.scrollTop = rolagem;
}

function pintarFinal(st) {
  const { el, l, ctx, partes: p, sessao: s } = st;
  const eu = l.eu || { spells: [0, 0], skin: 0 };
  const champ = eu.travado;
  const sk = st.skins?.campeao === champ ? st.skins.lista : null;
  const fe = st.feiticos || FEITICOS;
  const runa = st.runa?.campeao === champ ? st.runa : null;
  const oc = k => st.ocupado.has(k);
  const chave = JSON.stringify([champ, sk?.map(k => [k.id, k.chromas.map(c => c.id)]), eu.skin, eu.spells, st.spAberto, fe, runa, s.allowSkinSelection, oc('skin'), oc('feitico'), oc('runa'), st.cat.size, l.fase]);
  if (chave === st.chaveSel) return;
  st.chaveSel = chave;
  const filhos = [];
  // skin
  const marcada = sk ? skinMarcada(sk, eu.skin) : null;
  filhos.push(el('div', { class: 'lc-cp-rot' }, `skin de ${nomeDe(st, champ)} `,
    el('span', { class: 'lc-cp-nota', style: { textTransform: 'none', letterSpacing: '0' } },
      s.allowSkinSelection === false ? '(esta fila não deixa escolher)' : !sk ? '(lendo as skins…)' : sk.length === 1 ? '(só a padrão)' : `(${sk.length} disponíveis)`)));
  let faixa = null;
  // chromas da skin marcada, em cima das splash arts: [padrão][cada chroma dele]; clique = o mesmo PATCH da skin (requestSetSkin
  // da Riot manda o id do chroma em selectedSkinId)
  const mae = sk && s.allowSkinSelection !== false ? sk.find(k => k.id === marcada) : null;
  if (mae?.chromas?.length) {
    const bolinha = (id, nome, cor) => el('button', {
      class: 'lc-cp-sel-cr' + (eu.skin === id ? ' lc-cp-sel-on' : ''), title: nome, disabled: oc('skin'), dataset: { a: 'chroma', id },
      style: cor ? { background: cor } : undefined,
      on: { click: ctx.seguro(() => { if (eu.skin !== id) escrever(st, 'skin', [['PATCH', `${CS}/session/my-selection`, { selectedSkinId: id }, 'não foi possível trocar o chroma']]); }) },
    });
    filhos.push(el('div', { class: 'lc-cp-sel-chromas', dataset: { a: 'chromas' } }, el('span', { class: 'lc-cp-nota' }, 'chroma'),
      bolinha(mae.id, `${mae.nome} (padrão)`, ''), ...mae.chromas.map(c => bolinha(c.id, c.nome, c.cor))));
  }
  if (sk && s.allowSkinSelection !== false) {
    // roda do mouse na faixa rola as skins para o lado (Gabriel, 14/10/2026); no começo/fim da faixa ou com tudo à vista
    // a roda segue para a tela (não prende a rolagem). Ouvinte só aqui: a grade de campeões não existe nesta fase
    // scroll: guarda a posição venha de onde vier (roda, deslize lateral do touchpad, arrasto da barra), para a repintura
    // voltar ao mesmo ponto
    filhos.push(faixa = el('div', { class: 'lc-cp-sel-skins', dataset: { a: 'skins' }, on: { wheel: e => rodaNaFaixa(st, faixa, e), scroll: () => lembrarFaixa(st, faixa) } }, ...sk.map(k => {
      const b = el('button', {
        class: 'lc-cp-sel-sk' + (k.id === marcada ? ' lc-cp-sel-on' : ''), title: k.nome, disabled: oc('skin'), dataset: { a: 'skin', id: k.id },
        on: { click: ctx.seguro(() => { if (k.id !== marcada) escrever(st, 'skin', [['PATCH', `${CS}/session/my-selection`, { selectedSkinId: k.id }, 'não foi possível trocar a skin']]); }) },
      }, el('span', {}, k.nome));
      miniatura(k.splash, st.doc).then(d => {
        const url = d || k.tile || k.splash;
        if (url) b.style.backgroundImage = `url("${String(url).replace(/["\\\n]/g, '')}")`;
      });
      return b;
    })));
  }
  // feitiços
  filhos.push(el('div', { class: 'lc-cp-rot' }, 'feitiços'));
  filhos.push(el('div', { class: 'lc-cp-sel-spells' }, ...[0, 1].map(slot => el('button', {
    class: st.spAberto === slot ? 'lc-cp-sel-on' : undefined, dataset: { a: 'feitico-abrir', slot },
    on: { click: ctx.seguro(() => { st.spAberto = st.spAberto === slot ? null : slot; st.chaveSel = ''; pintar(st); }) },
  }, el('b', {}, slot ? 'F' : 'D'), fe[eu.spells[slot]] || (eu.spells[slot] ? `feitiço ${eu.spells[slot]}` : 'nenhum')))));
  if (st.spAberto !== null) {
    filhos.push(el('div', { class: 'lc-cp-sel-splista' }, ...Object.keys(fe).map(Number).map(fid => el('button', {
      class: eu.spells[st.spAberto] === fid ? 'lc-cp-sel-on' : undefined, disabled: oc('feitico'), dataset: { a: 'feitico', id: fid },
      on: { click: ctx.seguro(() => {
        const slot = st.spAberto;
        st.spAberto = null;
        if (eu.spells[slot] === fid) { st.chaveSel = ''; return pintar(st); }
        const [spell1Id, spell2Id] = trocarFeitico(eu.spells, slot, fid);
        escrever(st, 'feitico', [['PATCH', `${CS}/session/my-selection`, { spell1Id, spell2Id }, 'não foi possível trocar o feitiço']]);
      }) },
    }, fe[fid]))));
  }
  // runa
  filhos.push(el('div', { class: 'lc-cp-rot' }, 'runa'));
  filhos.push(pintarRuna(st, runa, champ));
  p.sel.replaceChildren(...filhos);
  // faixa nova (clique numa skin repinta): volta para onde ele tinha rolado
  if (faixa && st.skinsRolagem?.campeao === champ) try { faixa.scrollLeft = st.skinsRolagem.x; } catch { /* segue */ }
}

// px de uma volta da roda (deltaMode 1 = linhas, 2 = páginas); horizontal de touchpad passa direto
export function rodaNaFaixa(st, faixa, e) {
  if (!faixa || !e) return false;
  const passo = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? Number(faixa.clientWidth) || 300 : 1;
  const d = (Math.abs(Number(e.deltaY) || 0) >= Math.abs(Number(e.deltaX) || 0) ? Number(e.deltaY) || 0 : 0) * passo;
  const max = Math.max(0, (Number(faixa.scrollWidth) || 0) - (Number(faixa.clientWidth) || 0));
  const x = Number(faixa.scrollLeft) || 0;
  if (!d || max <= 0 || (d > 0 && x >= max) || (d < 0 && x <= 0)) return false;
  faixa.scrollLeft = Math.min(max, Math.max(0, x + d));
  lembrarFaixa(st, faixa);
  e.preventDefault?.();
  return true;
}

export function lembrarFaixa(st, faixa) {
  if (st && faixa) st.skinsRolagem = { campeao: st.l?.eu?.travado || 0, x: Number(faixa.scrollLeft) || 0 };
}

function pintarRuna(st, runa, champ) {
  const { el, ctx } = st;
  const nome = nomeDe(st, champ);
  const linha = (...f) => el('div', { class: 'lc-cp-sel-runa', dataset: { a: 'runa' } }, ...f);
  if (!runa || runa.estado === 'lendo') return linha(el('span', { class: 'lc-cp-nota' }, 'lendo as páginas…'));
  if (runa.estado === 'desligada') return linha(el('span', { class: 'lc-cp-nota' }, 'runa por campeão desligada nas configurações: fica a atual'));
  if (runa.estado === 'erro') return linha(el('span', { class: 'lc-cp-nota' }, 'não foi possível ler as páginas: fica a atual'));
  const c = runa.candidatas, atual = runa.atual?.id;
  // escolha feita aqui: o runas.js esquece a pendência no clique (um ⤢ logo depois não reabre o popup; passo 11 b4)
  const aplicar = pg => { try { ctx.servicos?.runas?.escolheu?.(); } catch { /* segue */ } return aplicarPut(pg); };
  const aplicarPut = pg => escrever(st, 'runa', [['PUT', '/lol-perks/v1/currentpage', pg.id, `não foi possível aplicar a runa ${pg.nome}`]],
    `runa ${pg.nome} aplicada`, () => { if (st.runa?.campeao === champ) st.runa = { ...st.runa, atual: { id: pg.id, nome: pg.nome } }; });
  if (!c.length) return linha(el('span', { class: 'lc-cp-nota' }, `sem página para ${nome}: fica a atual${runa.atual?.nome ? ` (${runa.atual.nome})` : ''}`));
  if (c.length === 1) {
    return atual === c[0].id ? linha(el('span', { class: 'lc-cp-sel-ok' }, '✓'), `página "${c[0].nome}" aplicada sozinha`)
      : linha(`página "${c[0].nome}": `, el('button', { dataset: { a: 'runa-aplicar', id: c[0].id }, disabled: st.ocupado.has('runa'),
        on: { click: ctx.seguro(() => aplicar(c[0])) } }, 'aplicar'));
  }
  const marcada = c.find(x => x.id === atual);
  return linha(`${c.length} páginas de ${nome}: `, ...c.map(pg => el('button', {
    class: pg.id === atual ? 'lc-cp-sel-on' : undefined, disabled: st.ocupado.has('runa'), dataset: { a: 'runa-pagina', id: pg.id },
    on: { click: ctx.seguro(() => { if (pg.id !== atual) aplicar(pg); }) },
  }, pg.nome)), marcada ? el('span', { class: 'lc-cp-sel-ok' }, '✓ aplicada') : el('span', { class: 'lc-cp-nota' }, 'escolha uma'));
}
