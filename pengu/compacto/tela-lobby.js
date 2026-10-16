// Tela 1 do client compacto: lobby (roadmap/2026-10-13-client-compacto.md, passo 4; protótipo aprovado em 13/10/2026,
// temp/2026-10-13-prototipo-client-compacto.html, tela 1). Fases None e Lobby (contrato em compacto/index.js).
// Também exporta o que a tela 2 (tela-fila.js) usa: cabeçalho (foto, nome, ranque), 💬 com contador, resumo do dia.
//
// Linhas que não se cruzam:
// - busca SÓ no clique do JOGAR e sempre pelos freios (freios.js: 2º clique em até 8 s); montar, eventos e timers
//   só leem (GET). Sozinho na fila com posição: buscarFilaRapida da fila rápida (o mesmo caminho do botão do topo).
//   Líder de grupo e ARAM: caminho próprio aqui (prepararLobby recusa grupo e manda posição em toda fila), com os
//   mesmos freios e a mesma restricaoDura.
// - não-líder não busca (nem o botão aparece); penalidade (restrictions[]) apaga o JOGAR com o motivo e o prazo.
// - nada decide pelo jogador: convite aceito/recusado, convidar, sair do grupo, fila e posições são clique dele.
// - nome mostrado aqui é só de quem está no grupo dele, de quem o convidou e dos amigos (nada da seleção ranqueada).
// Campo ausente ou estado desconhecido nunca quebra a tela: vira botão cinza com o motivo. Erro que escapa de
// handler/timer/evento (ctx.seguro) devolve o client normal.
import { h, fotoCampeao, campeoes, estilo, preferidasLobby } from './comum.js';
import { buscarFilaRapida, Recusa, restricaoDura, FILAS_COM_POSICAO } from '../fila-rapida.js';
import { criarConfirmacao, cliqueComFreio, avaliarFreios, textoFreios, derrotasSeguidasAgora, ehMadrugada, MEDICAO,
  JANELA_MS, ATUALIZANDO } from '../freios.js';
import { valida } from '../posjogo/abas.js';
import { definir as definirConfig } from '../config.js';
import { botaoChat, abrirChat, botaoConfig } from './chat-botao.js';

// ---------- dados fixos ----------
export const FILAS_CP = {
  420: { c: 'Solo/Duo', n: 'Ranqueada Solo/Duo' },
  440: { c: 'Flex', n: 'Ranqueada Flex' },
  400: { c: 'Normal', n: 'Normal (escolha)' },
  450: { c: 'ARAM', n: 'ARAM' },
};
export const ORDEM_FILAS = [420, 440, 400, 450];
const FILAS_CONFIG = [420, 440]; // as que a fila rápida aceita (config.js FILAS): 400/450 ficam só nesta tela
export const POSICOES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']; // mesmas do config.js (sem FILL)
export const NOME_POS = { TOP: 'Topo', JUNGLE: 'Selva', MIDDLE: 'Meio', BOTTOM: 'Atirador', UTILITY: 'Suporte' };
const TIER = { IRON: 'Ferro', BRONZE: 'Bronze', SILVER: 'Prata', GOLD: 'Ouro', PLATINUM: 'Platina', EMERALD: 'Esmeralda',
  DIAMOND: 'Diamante', MASTER: 'Mestre', GRANDMASTER: 'Grão-Mestre', CHALLENGER: 'Desafiante' };
const FASES_LIVRES = ['Lobby', 'None'];
const ROTA_BUSCA = '/lol-lobby/v2/lobby/matchmaking/search';

// ---------- funções puras (tools/teste-compacto-lobby.mjs) ----------
export const doisDigitos = n => String(Math.max(0, Math.trunc(n))).padStart(2, '0');
export const mmss = s => { const t = Math.max(0, Math.floor(Number(s) || 0)); return `${doisDigitos(t / 60)}:${doisDigitos(t % 60)}`; };
export const horaMin = ms => { const d = new Date(ms); return `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`; };

// "há 3 h 39 min" | "há 12 min" | "agora"
export function haQuanto(ms, agoraMs) {
  const min = Math.floor((agoraMs - ms) / 60000);
  if (!Number.isFinite(min) || min < 1) return 'agora';
  return min < 60 ? `há ${min} min` : `há ${Math.floor(min / 60)} h ${min % 60} min`;
}

// ranque da solo/duo de GET /lol-ranked/v1/current-ranked-stats -> {texto: 'Esmeralda IV · 14 PDL', tier, pdl} | null
export function ranqueSolo(stats) {
  const q = stats?.queueMap?.RANKED_SOLO_5x5 || (stats?.queues || []).find(x => x?.queueType === 'RANKED_SOLO_5x5');
  if (!q) return null;
  const tier = TIER[String(q.tier || '').toUpperCase()];
  if (!tier) return { texto: 'sem ranque na solo/duo', tier: null, pdl: null };
  const div = ['I', 'II', 'III', 'IV'].includes(q.division) ? ` ${q.division}` : '';
  const pdl = Number.isFinite(Number(q.leaguePoints)) ? Number(q.leaguePoints) : null;
  return { texto: `${tier}${div}${pdl === null ? '' : ` · ${pdl} PDL`}`, tier: `${tier}${div}`, pdl,
    tierId: String(q.tier).toUpperCase(), divisao: div.trim() };
}

// variação de PDL do dia (protótipo: "PDL ±0" em destaque, "Esmeralda IV 14" embaixo). Base = 1ª leitura do ranque
// no dia local, guardada no DataStore do Pengu (sem ele, na memória da carga). Não há rota do coletor com o PDL do
// dia (a tabela lp do banco só é lida pelo MCP): se ele jogou hoje com o client aberto antes desta 1ª leitura, a
// variação começa dali (o title diz desde quando). -> {texto, titulo}
export const CHAVE_PDL_DIA = 'lol-client.compacto.pdl-dia';
const pdlMem = { v: null };
export const _zerarPdlDia = () => { pdlMem.v = null; }; // só teste
export function lojaPdlDia() {
  return {
    get: () => { try { return globalThis.DataStore?.get?.(CHAVE_PDL_DIA) ?? pdlMem.v; } catch { return pdlMem.v; } },
    set: v => { pdlMem.v = v; try { globalThis.DataStore?.set?.(CHAVE_PDL_DIA, v); } catch { /* fica na memória */ } },
  };
}
const ORDEM_TIER = Object.keys(TIER);
const ordemRanque = r => ORDEM_TIER.indexOf(r.tierId) * 10 + (['IV', 'III', 'II', 'I'].indexOf(r.divisao) + 1);
export function variacaoDoDia(ranque, agoraMs, loja = lojaPdlDia()) {
  if (!ranque) return { texto: '—', titulo: 'lendo o ranque…' };
  if (ranque.pdl === null || !ORDEM_TIER.includes(ranque.tierId)) return { texto: '—', titulo: 'sem ranque na solo/duo' };
  const d = new Date(agoraMs), dia = `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`;
  let base = null;
  try { base = loja.get(); } catch { /* sem base */ }
  if (!base || base.dia !== dia || !Number.isFinite(base.pdl) || !ORDEM_TIER.includes(base.tierId)) {
    base = { dia, tierId: ranque.tierId, divisao: ranque.divisao, pdl: ranque.pdl, tier: ranque.tier, em: agoraMs };
    try { loja.set(base); } catch { /* fica sem guardar */ }
  }
  const titulo = `variação desde ${horaMin(base.em)} (1ª leitura de hoje: ${base.tier || base.tierId} ${base.pdl} PDL)`;
  if (base.tierId === ranque.tierId && base.divisao === ranque.divisao) {
    const v = ranque.pdl - base.pdl;
    return { texto: v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : '±0', titulo };
  }
  return { texto: ordemRanque(ranque) > ordemRanque(base) ? '↑' : '↓', titulo: `mudou de divisão hoje (${titulo})` };
}

// lobby (resposta {ok, status, json} do GET /lol-lobby/v2/lobby) -> o que a tela precisa. Nunca guarda a senha do chat
// (multiUserChatPassword, mucJwtDto): só os campos abaixo saem daqui.
export function estadoGrupo(r) {
  if (!r || (!r.ok && r.status === 404)) return { lido: true, existe: false, grupo: false, lider: true, membros: [], fila: null };
  if (!r.ok || !r.json || typeof r.json !== 'object') return { lido: false, existe: false, grupo: false, lider: null, membros: [], fila: null, erro: `lobby ilegível (${r.status ?? '?'})` };
  const l = r.json, eu = l.localMember || null;
  const membros = (Array.isArray(l.members) ? l.members : []).map(m => ({
    summonerId: m?.summonerId ?? null, puuid: typeof m?.puuid === 'string' ? m.puuid : '', nome: String(m?.summonerName || ''),
    icone: Number(m?.summonerIconId) || 0, lider: m?.isLeader === true,
    eu: !!eu && ((eu.puuid && m?.puuid === eu.puuid) || (eu.summonerId && m?.summonerId === eu.summonerId)),
  }));
  const pendentes = (Array.isArray(l.invitations) ? l.invitations : []).filter(i => i?.state === 'Pending').length;
  const fila = Number(l.gameConfig?.queueId) || null;
  const pref = p => (POSICOES.includes(p) ? p : null);
  return {
    lido: true, existe: true, grupo: membros.length > 1 || pendentes > 0, pendentes, membros,
    lider: typeof eu?.isLeader === 'boolean' ? eu.isLeader : null,
    podeConvidar: eu ? eu.allowedInviteOthers !== false : false,
    fila, custom: !!l.gameConfig?.isCustom, comPosicao: l.gameConfig?.showPositionSelector,
    pos1: pref(eu?.firstPositionPreference), pos2: pref(eu?.secondPositionPreference),
    restricao: restricaoDura(l),
  };
}

// convites recebidos pendentes (GET /lol-lobby/v2/received-invitations) -> [{id, de, fila, pode}]
export function convitesPendentes(lista) {
  return (Array.isArray(lista) ? lista : []).filter(c => c?.state === 'Pending' && c.invitationId).map(c => ({
    id: String(c.invitationId), de: String(c.fromSummonerName || '').trim() || 'um amigo',
    fila: Number(c.gameConfig?.queueId) || null, pode: c.canAcceptInvitation !== false,
  }));
}

// próxima posição no ciclo, pulando a outra (1ª e 2ª nunca iguais, como no Ctrl+K)
export function proximaPosicao(atual, outra) {
  let i = POSICOES.indexOf(atual);
  for (let n = 0; n < POSICOES.length; n++) {
    i = (i + 1) % POSICOES.length;
    if (POSICOES[i] !== outra) return POSICOES[i];
  }
  return atual;
}

// partidas de hoje (dia local) que contam (Rift, sem personalizada/treino, sem remake), da mais antiga à mais nova
export function partidasDeHoje(historico, agoraMs) {
  if (!Array.isArray(historico)) return null;
  const hoje = new Date(agoraMs).toDateString();
  return historico.filter(g => valida(g) && new Date(g.gameCreation).toDateString() === hoje)
    .sort((a, b) => a.gameCreation - b.gameCreation)
    .map(g => {
      const p = g.participants[0], s = p.stats || {};
      return { gameId: g.gameId, inicio: g.gameCreation, fim: g.gameCreation + (Number(g.gameDuration) || 0) * 1000,
        championId: Number(p.championId) || 0, vitoria: !!s.win, k: s.kills ?? 0, d: s.deaths ?? 0, a: s.assists ?? 0, fila: g.queueId };
    });
}

// V/D, total e quando acabou a última
export function resumoHoje(lista) {
  if (!Array.isArray(lista)) return null;
  const v = lista.filter(p => p.vitoria).length;
  return { v, d: lista.length - v, n: lista.length, ultimaFim: lista.length ? Math.max(...lista.map(p => p.fim)) : null };
}

// sequência atual do dia (da mais nova para trás): {tipo: 'V'|'D'|null, n}
export function sequenciaHoje(lista) {
  if (!Array.isArray(lista) || !lista.length) return { tipo: null, n: 0 };
  const ult = lista[lista.length - 1].vitoria;
  let n = 0;
  for (let i = lista.length - 1; i >= 0 && lista[i].vitoria === ult; i--) n++;
  return { tipo: ult ? 'V' : 'D', n };
}

// dica do coach em 1 linha, número primeiro, sem ordem (só quando o coletor não manda a dele). seq: derrotas seguidas
// (número, null ou ATUALIZANDO); hoje: resumoHoje; data: Date local.
export function dicaLocal({ seq, hoje, data }) {
  const M = MEDICAO;
  if (typeof seq === 'number' && seq >= 2) return `${seq} derrotas seguidas: depois de 2, o seu winrate cai para ${M.wrDepoisDe2}% (${M.partidas} partidas, ${M.data}).`;
  if (data && ehMadrugada(data)) return `de madrugada o seu winrate cai: ${M.wrMadrugada}% contra ${M.wrDia}% de dia (${M.partidas} partidas).`;
  const extra = hoje && hoje.d >= 2 && typeof seq === 'number' && seq < 2 ? ` as ${hoje.d} derrotas de hoje não foram seguidas.` : '';
  return `de dia o seu winrate é ${M.wrDia}%, contra ${M.wrMadrugada}% de madrugada (${M.partidas} partidas, ${M.data}).${extra}`;
}

// não lidas do chat (só conversas 1:1; salas do lobby/seleção ficam de fora), abrir a lista de amigos e o 💬: moram em
// ./chat-botao.js (as telas 3 e 4 também têm o 💬); reexportados aqui para quem já importava daqui
export { naoLidas, abrirChat, ROTA_CHAT } from './chat-botao.js';

// amigos do LoL online para convidar (GET /lol-chat/v1/friends) -> [{summonerId, puuid, nome, status, livre}]
const STATUS_JOGO = { outOfGame: 'no client', inGame: 'em partida', inQueue: 'na fila', championSelect: 'na seleção' };
export function amigosParaConvidar(lista) {
  const ordem = { chat: 0, away: 1, dnd: 2 };
  return (Array.isArray(lista) ? lista : [])
    .filter(f => f && f.availability in ordem && (!f.product || f.product === 'league_of_legends') && (f.summonerId || f.puuid))
    .map(f => {
      const jogo = String(f.lol?.gameStatus || '');
      const status = STATUS_JOGO[jogo] || (jogo.startsWith('hosting_') ? 'no lobby' : f.availability === 'away' ? 'ausente' : 'online');
      return { summonerId: f.summonerId ?? null, puuid: f.puuid || '', nome: String(f.gameName || f.name || 'amigo'),
        status, livre: !['inGame', 'championSelect', 'inQueue'].includes(jogo), ordem: ordem[f.availability] };
    })
    .sort((a, b) => (a.livre === b.livre ? a.ordem - b.ordem || a.nome.localeCompare(b.nome) : a.livre ? -1 : 1));
}

// nome das filas que a tela 1 não cobre (só para dizer em qual lobby ele está; busca nelas é pelo client normal)
export const FILAS_FORA = { 1700: 'Arena', 480: 'Escolha Rápida', 490: 'Partida Rápida', 1090: 'TFT', 1100: 'TFT ranqueado',
  1130: 'TFT hiper', 1160: 'TFT em dupla', 830: 'Co-op vs. IA', 840: 'Co-op vs. IA', 850: 'Co-op vs. IA', 870: 'Co-op vs. IA',
  880: 'Co-op vs. IA', 890: 'Co-op vs. IA', 900: 'URF', 1900: 'URF' };
export const nomeFila = id => FILAS_CP[id]?.n || FILAS_FORA[id] || `fila ${id ?? '?'}`;
// lobby só dele numa fila que esta tela não cobre (Arena, TFT...): o JOGAR trocaria o lobby; vale só quando o número é conhecido
export const filaDeFora = g => !!(g?.existe && !g.grupo && !g.custom && Number(g.fila) > 0 && !ORDEM_FILAS.includes(Number(g.fila)));

// o que o JOGAR faz agora -> {pode: false, motivo, rotulo?} | {pode: true, modo: 'solo'|'grupo'|'aram'}
// filaEscolhida: ele clicou numa fila desta tela (só então o JOGAR troca um lobby de outra fila)
export function planoJogar(g, fila, { filaEscolhida = false } = {}) {
  if (!g?.lido) return { pode: false, motivo: g?.erro ? `não foi possível ler o lobby (${g.erro}): busque pelo client normal` : 'lendo o lobby…' };
  if (g.custom) return { pode: false, motivo: 'lobby personalizado: é pelo client normal' };
  if (g.restricao) return { pode: false, motivo: g.restricao };
  if (g.existe && g.grupo) {
    if (g.lider === false) return { pode: false, motivo: 'em grupo quem busca é o líder', rotulo: 'O LÍDER BUSCA' };
    if (g.lider !== true) return { pode: false, motivo: 'líder do grupo desconhecido: busque pelo client normal' };
    if (!ORDEM_FILAS.includes(g.fila)) return { pode: false, motivo: `o grupo está na fila ${g.fila ?? 'desconhecida'}: busque pelo client normal` };
    return { pode: true, modo: 'grupo' };
  }
  if (filaDeFora(g) && !filaEscolhida)
    return { pode: false, motivo: `o lobby é de ${nomeFila(g.fila)}: escolha a fila acima para trocar ou busque pelo client normal` };
  if (!ORDEM_FILAS.includes(fila)) return { pode: false, motivo: 'escolha uma fila' };
  return { pode: true, modo: fila === 450 ? 'aram' : 'solo' };
}

// "📊 última partida" no lobby (passo 13 B3). an = servicos.posjogo.estadoAnalise() -> {titulo, sub, botao: {rotulo, acao, motivo}}
// | null (sem linha: descartada no ready check, ou o painel pós-jogo do plugin não existe). acao: 'abrir' | 'analisar' | null
export function linhaUltima(an, nomeCampeao = id => `campeão ${id}`) {
  if (!an || typeof an !== 'object') return null;
  if (an.nunca) return { titulo: '📊 última partida', sub: 'análise ainda não aberta nesta sessão', botao: { rotulo: 'analisar', acao: 'analisar' } };
  const r = an.resumo;
  const res = r ? `${r.vitoria ? 'vitória' : 'derrota'} · ${nomeCampeao(r.campeao)} ${r.k}/${r.d}/${r.a}` : '';
  const quando = r ? [FILAS_CP[r.fila]?.c || FILAS_FORA[r.fila], Number(r.criacao) > 0 ? `às ${horaMin(Number(r.criacao))}` : ''].filter(Boolean).join(' ') : '';
  if (an.erro) return { titulo: '📊 última partida', sub: `a análise falhou: ${String(an.erro).slice(0, 80)}`, botao: { rotulo: 'tentar de novo', acao: 'abrir' } };
  if (!an.pronta) return { titulo: '📊 última partida', sub: 'analisando a partida…', botao: { rotulo: 'analisando…', acao: null, motivo: 'a análise ainda está rodando: o botão acende quando ela ficar pronta' } };
  return { titulo: `📊 última partida${res ? `: ${res}` : ''}`, sub: [an.vista ? 'análise vista' : 'análise pronta', quando].filter(Boolean).join(' · '),
    botao: { rotulo: '⤢ reabrir', acao: 'abrir' } };
}

// ---------- cache entre montagens (a tela 2 usa o mesmo cabeçalho) ----------
const cache = { nome: '', icone: 0, ranque: null, emCab: 0, nomes: new Map(), memoria: { fila: null } };
export const _zerarCache = () => { cache.nome = ''; cache.icone = 0; cache.ranque = null; cache.emCab = 0; cache.nomes.clear(); cache.memoria.fila = null; };

// ---------- peças compartilhadas com a tela 2 ----------
const iconePerfil = id => (Number(id) > 0 ? `/lol-game-data/assets/v1/profile-icons/${Math.trunc(Number(id))}.jpg` : '');
function avatar(id, letra, tam) {
  const url = iconePerfil(id);
  return h('span', { class: 'lc-cp-av', style: { width: tam + 'px', height: tam + 'px', backgroundImage: url ? `url("${url}")` : '' } },
    url ? '' : String(letra || '?').slice(0, 1).toUpperCase());
}

// topo: foto, nome e ranque à esquerda (ctx.titulo); 💬 com o contador de não lidas (ctx.extras, chat-botao.js). Só GET.
// -> {ranque: () => ranqueSolo|null}
export function cabecalho(ctx, { agora = Date.now } = {}) {
  const sub = h('small', {}, cache.ranque?.texto || '');
  const nome = h('b', {}, cache.nome || '…');
  const caixaAv = h('span', { class: 'lc-cp-avcx' }, avatar(cache.icone, cache.nome, 30));
  ctx.titulo.append(h('div', { class: 'lc-cp-id' }, caixaAv, h('div', {}, nome, sub)));
  botaoChat(ctx);
  botaoConfig(ctx); // ⚙ configurações à esquerda (passo 13 B1)
  const lerCab = async () => {
    if (cache.emCab && agora() - cache.emCab < 60000) return;
    const [s, rk] = await Promise.all([ctx.lcu('GET', '/lol-summoner/v1/current-summoner'), ctx.lcu('GET', '/lol-ranked/v1/current-ranked-stats')]);
    if (s.ok && s.json) { cache.nome = String(s.json.gameName || s.json.displayName || ''); cache.icone = Number(s.json.profileIconId) || 0; }
    if (rk.ok) cache.ranque = ranqueSolo(rk.json);
    if (s.ok || rk.ok) cache.emCab = agora();
    if (!ctx.vivo()) return;
    nome.textContent = cache.nome || 'você';
    sub.textContent = cache.ranque?.texto || '';
    caixaAv.replaceChildren(avatar(cache.icone, cache.nome, 30));
  };
  lerCab().catch(() => {});
  return { ranque: () => cache.ranque };
}

// histórico de hoje pelo cache do champselect.js (servicos.historico); null = ainda não leu (pede a leitura uma vez)
export function lerHoje(ctx, agoraMs, aoChegar) {
  const hist = ctx.servicos?.historico;
  const lista = typeof hist?.partidas === 'function' ? hist.partidas() : null;
  if (lista === null && typeof hist?.ler === 'function') {
    Promise.resolve().then(() => hist.ler()).then(() => { if (ctx.vivo() && hist.partidas()) aoChegar?.(); }).catch(() => {});
  }
  return partidasDeHoje(lista, agoraMs);
}

// derrotas seguidas: a mesma sequência do freio da fila rápida (servicos.fila); sem ela, pelo histórico
export async function derrotasSeguidas(ctx, agoraMs) {
  const f = ctx.servicos?.fila;
  if (typeof f?.derrotasSeguidas === 'function') return f.derrotasSeguidas();
  const lista = ctx.servicos?.historico?.partidas?.();
  return Array.isArray(lista) ? derrotasSeguidasAgora(lista, agoraMs) : null;
}

// faixa "hoje": V/D, variação de PDL do dia (embaixo, o elo com os pontos: "Esmeralda IV 14"), terceira célula
// (última partida ou sequência)
export function blocoDia(hoje, ranque, terceira, { agoraMs = Date.now(), loja } = {}) {
  const vd = hoje ? [h('b', { class: 'lc-cp-v' }, `${hoje.v}V`), ' ', h('b', { class: 'lc-cp-d' }, `${hoje.d}D`)] : [h('b', {}, '—')];
  const varia = variacaoDoDia(ranque, agoraMs, loja);
  const elo = ranque?.tier ? `${ranque.tier}${ranque.pdl === null ? '' : ` ${ranque.pdl}`}` : (ranque ? 'sem ranque' : 'lendo…');
  return h('div', { class: 'lc-cp-dia' },
    h('div', {}, ...vd, h('small', {}, hoje ? `${hoje.n} ${hoje.n === 1 ? 'partida' : 'partidas'} hoje` : 'lendo o histórico…')),
    h('div', { title: varia.titulo, dataset: { a: 'pdl-dia' } }, 'PDL ', h('b', {}, varia.texto), h('small', {}, elo)),
    h('div', {}, terceira[0], h('small', { dataset: { tick: 'terceira' } }, terceira[1])));
}

// ---------- tela 1 ----------
// relogio/agora injetáveis (teste); definir = config.definir (persiste fila e posições como "tua config")
export function criarTelaLobby({ agora = Date.now, relogio = () => new Date(), definir = null } = {}) {
  let st = null;

  function montar(raiz, ctx) {
    estilo('lc-cp-lobby-estilo', CSS_LOBBY);
    const cfg = ctx.cfg || {};
    const fr = cfg.filaRapida || {};
    const gravar = (caminho, v) => { try { (ctx.servicos?.definir || definir || definirConfig)(caminho, v); } catch { /* fica só nesta tela */ } };
    const s = st = {
      ctx, raiz, g: { lido: false, existe: false, grupo: false, lider: null, membros: [] }, convites: [],
      fila: ORDEM_FILAS.includes(cache.memoria.fila) ? cache.memoria.fila : ORDEM_FILAS.includes(fr.fila) ? fr.fila : 420,
      pos1: POSICOES.includes(fr.pos1) ? fr.pos1 : 'TOP', pos2: POSICOES.includes(fr.pos2) ? fr.pos2 : 'JUNGLE',
      filaDoLobby: false, ocupado: false, textoFreio: '', amigos: null, amigosAbertos: false, convidando: new Set(),
      dica: '', dicaDoColetor: false, hoje: null, refs: {}, posVersao: 0, expandiu: false, agora,
    };
    if (s.pos1 === s.pos2) s.pos2 = proximaPosicao(s.pos1, s.pos1);
    const confirmacao = s.confirmacao = criarConfirmacao({ agora });
    const cab = cabecalho(ctx, { agora });

    const pintarSeguro = () => { if (ctx.vivo()) pintar(s, cab); };
    s.pintar = pintarSeguro;

    // ---- leituras (só GET) ----
    const aplicarLobby = r => {
      const g = estadoGrupo(r);
      // reserva das preferidas para o destaque da posição na seleção (comum.js preferidasLobby; personalizada não conta). Cru
      // do localMember, com FILL (o g.pos1/pos2 joga FILL fora e a seleção leria "fora das pedidas" = autofill falso)
      if (g.existe) {
        const m = r.json?.localMember, cru = v => (typeof v === 'string' ? v.toUpperCase() : '');
        Object.assign(preferidasLobby, g.custom || !m ? { pos1: '', pos2: '', em: 0 }
          : { pos1: cru(m.firstPositionPreference), pos2: cru(m.secondPositionPreference), em: Date.now() });
      }
      // lobby personalizado (ou o grupo numa fila que esta tela não cobre): a tela da Riot é a dona
      if (g.existe && (g.custom || (g.grupo && !ORDEM_FILAS.includes(g.fila)))) {
        if (!s.expandiu) {
          s.expandiu = true;
          ctx.expandir();
          ctx.avisar(g.custom ? 'lobby personalizado: abrindo o client normal' : `grupo na fila ${g.fila ?? 'desconhecida'}: abrindo o client normal`);
        }
        return;
      }
      s.g = g;
      // a fila e as posições do lobby valem mais que a config (ele pode ter montado pelo client normal)
      if (g.existe && ORDEM_FILAS.includes(g.fila) && (g.grupo || !s.filaEscolhida)) { s.fila = g.fila; s.filaDoLobby = true; }
      if (g.pos1 && g.pos2 && g.pos1 !== g.pos2 && !s.posEscolhida) { s.pos1 = g.pos1; s.pos2 = g.pos2; }
      pintarSeguro();
    };
    const lerLobby = async () => aplicarLobby(await ctx.lcu('GET', '/lol-lobby/v2/lobby'));
    const lerConvites = async () => {
      const r = await ctx.lcu('GET', '/lol-lobby/v2/received-invitations');
      if (r.ok) { s.convites = convitesPendentes(r.json); pintarSeguro(); }
    };
    const lerDica = async () => {
      const hojeR = resumoHoje(s.hoje);
      const seq = await derrotasSeguidas(ctx, agora()).catch(() => null);
      if (!s.dicaDoColetor) s.dica = dicaLocal({ seq, hoje: hojeR, data: relogio() });
      pintarSeguro();
      // a dica do coletor, se ele tiver a rota (GET /dica -> {texto}); fora do ar ou sem rota = fica a local
      const col = ctx.servicos?.coletor;
      if (typeof col !== 'function') return;
      const r = await col('/dica', { prazoMs: 2000 });
      const t = typeof r?.dados?.texto === 'string' ? r.dados.texto.trim() : '';
      if (r?.status === 200 && t) { s.dica = t.slice(0, 220); s.dicaDoColetor = true; pintarSeguro(); }
    };
    const lerHistorico = () => { s.hoje = lerHoje(ctx, agora(), () => { s.hoje = lerHoje(ctx, agora()); lerDica().catch(() => {}); pintarSeguro(); }); };
    s.recarregar = () => { lerLobby().catch(() => {}); lerConvites().catch(() => {}); };
    // 📊 última partida (passo 13 B3): estado da análise do pós-jogo do plugin (só leitura), relido no relógio de 1 s; repinta só
    // quando muda (repintar a tela a cada segundo perderia clique)
    const lerAnalise = () => {
      let an = null;
      try { an = typeof ctx.servicos?.posjogo?.estadoAnalise === 'function' ? ctx.servicos.posjogo.estadoAnalise() : null; } catch { an = null; }
      const sig = JSON.stringify(an);
      if (sig === s.analiseSig) return false;
      s.analise = an; s.analiseSig = sig;
      if (an?.resumo?.campeao && !s.nomesCamp) campeoes().then(m => { s.nomesCamp = m; pintarSeguro(); }).catch(() => {});
      return true;
    };
    lerAnalise();

    lerHistorico();
    pintarSeguro();
    s.recarregar();
    lerDica().catch(() => {});
    ctx.observar('/lol-lobby/v2/lobby', msg => aplicarLobby(msg?.eventType === 'Delete' || !msg?.data ? { ok: false, status: 404 } : { ok: true, status: 200, json: msg.data }));
    ctx.observar('/lol-lobby/v2/received-invitations', msg => {
      if (Array.isArray(msg?.data)) { s.convites = convitesPendentes(msg.data); pintarSeguro(); } else lerConvites().catch(() => {});
    });
    // relógio de 1 s: contagem do freio e "última há X" sem redesenhar a tela (clique no meio de um redesenho se perde)
    ctx.intervalo(() => {
      const armado = confirmacao.armada();
      if (s.refs.freioCont) s.refs.freioCont.textContent = armado ? `${Math.max(0, Math.ceil((s.armadoAte - agora()) / 1000))} s` : '';
      if (!armado && s.textoFreio) { s.textoFreio = ''; pintarSeguro(); }
      const hoje = resumoHoje(s.hoje);
      if (s.refs.terceira && hoje?.ultimaFim) s.refs.terceira.textContent = haQuanto(hoje.ultimaFim, agora());
      if (lerAnalise()) pintarSeguro();
    }, 1000);

    // ---- ações (só clique) ----
    s.acoes = {
      fila: ctx.seguro(id => {
        if (s.g.grupo || !ORDEM_FILAS.includes(id) || s.ocupado) return;
        s.fila = id; s.filaEscolhida = true; s.filaDoLobby = false; cache.memoria.fila = id;
        if (FILAS_CONFIG.includes(id)) gravar('filaRapida.fila', id);
        confirmacao.desarmar(); s.textoFreio = '';
        pintarSeguro();
      }),
      pos: ctx.seguro(qual => {
        if (s.ocupado) return;
        if (qual === 1) s.pos1 = proximaPosicao(s.pos1, s.pos2); else s.pos2 = proximaPosicao(s.pos2, s.pos1);
        s.posEscolhida = true;
        gravar('filaRapida.pos1', s.pos1); gravar('filaRapida.pos2', s.pos2);
        // membro de grupo não tem JOGAR: a posição vai ao lobby na hora (meio segundo depois do último clique)
        if (s.g.existe && s.g.grupo && FILAS_COM_POSICAO.includes(s.g.fila)) {
          const versao = ++s.posVersao;
          ctx.tempo(async () => {
            if (versao !== s.posVersao) return; // outro clique depois deste: vale o último
            const r = await ctx.lcu('PUT', '/lol-lobby/v2/lobby/members/localMember/position-preferences', { firstPreference: s.pos1, secondPreference: s.pos2 });
            if (!r.ok) ctx.avisar(`posições não foram para o lobby (${r.status})`, true);
          }, 500);
        }
        pintarSeguro();
      }),
      jogar: ctx.seguro(() => jogar(s, ctx, { agora, relogio })),
      aceitar: ctx.seguro(id => responderConvite(s, ctx, id, 'accept')),
      recusar: ctx.seguro(id => responderConvite(s, ctx, id, 'decline')),
      convidar: ctx.seguro(() => abrirConvidar(s, ctx)),
      convidarAmigo: ctx.seguro(a => convidarAmigo(s, ctx, a)),
      fecharAmigos: ctx.seguro(() => { s.amigosAbertos = false; pintarSeguro(); }),
      // B3: expande (o painel de 6 abas é de 1280) e só então abre; a camada não saiu = não abre por baixo dela
      ultima: ctx.seguro(acao => {
        const pj = ctx.servicos?.posjogo;
        const an = s.analise;
        if (!acao || !pj) return;
        const doc = s.raiz?.ownerDocument || s.raiz?.doc || globalThis.document;
        ctx.expandir();
        if (doc?.documentElement?.classList?.contains?.('lc-modo-compacto')) { ctx.avisar('não foi possível sair do modo compacto: use ⤢ expandir', true); return; }
        const r = acao === 'abrir' && an?.gameId ? pj.abrirPainel?.(an.gameId, {}) : pj.analisarUltima?.();
        Promise.resolve(r).catch(e => console.error('[lol-client] compacto: última partida', e));
      }),
      sair: ctx.seguro(async () => {
        if (s.ocupado) return;
        s.ocupado = true; pintarSeguro();
        try {
          const r = await ctx.lcu('DELETE', '/lol-lobby/v2/lobby');
          if (!r.ok && r.status !== 404) ctx.avisar(`não foi possível sair do grupo (${r.status})`, true);
        } finally { s.ocupado = false; pintarSeguro(); }
      }),
    };
  }

  // None <-> Lobby: mesma tela, relê o lobby e os convites
  function atualizar(ctx) {
    if (!st || st.ctx !== ctx) return;
    st.recarregar();
  }

  function desmontar() { st = null; }

  return { montar, desmontar, atualizar, estado: () => st };
}

// ---- JOGAR: só o clique chega aqui; freio antes de qualquer escrita ----
async function jogar(s, ctx, { agora, relogio }) {
  if (s.ocupado) return;
  const plano = planoJogar(s.g, s.fila, { filaEscolhida: !!s.filaEscolhida });
  if (!plano.pode) { ctx.avisar(plano.motivo, true); return; }
  // 2º clique de reflexo (< 700 ms depois de armar): ignorado, o freio fica
  if (s.confirmacao.cedo()) return;
  const cfg = ctx.cfg || {};
  const fr = { ...(cfg.filaRapida || {}), fila: s.fila, pos1: s.pos1, pos2: s.pos2 };
  const seq = () => derrotasSeguidas(ctx, agora());
  s.ocupado = true; s.pintar();
  try {
    const r = await cliqueComFreio(s.confirmacao, confirmado => (plano.modo === 'solo'
      // o mesmo caminho do botão fila rápida: conferirFase, freios, prepararLobby (fila + posições), restricaoDura, busca
      ? buscarFilaRapida({ ...cfg, filaRapida: fr }, { confirmado, derrotasSeguidas: seq, relogio })
      : buscarDireto(ctx, plano.modo, fr, { confirmado, seq, relogio, agora })));
    if (r?.status === 'confirmar') {
      s.textoFreio = r.texto;
      s.armadoAte = agora() + JANELA_MS;
    } else if (r?.status === 'buscando') {
      s.textoFreio = '';
      s.buscou = true; // a fase vira Matchmaking e o roteador troca para a tela 2
    }
  } catch (e) {
    if (ctx.vivo()) ctx.avisar(e instanceof Recusa ? e.message : `jogar: ${e?.message || e}`, true);
  } finally {
    s.ocupado = false;
    s.pintar();
  }
}

// líder de grupo (fila do lobby, posições dele) e ARAM sozinho (sem posição). Mesmos freios e restricaoDura da fila
// rápida. -> {status: 'confirmar', motivos, texto} | {status: 'buscando'}; Recusa/Error sobem.
export async function buscarDireto(ctx, modo, fr, { confirmado = false, seq, relogio = () => new Date(), agora = Date.now }) {
  const lcu = ctx.lcu;
  const fase = (await lcu('GET', '/lol-gameflow/v1/gameflow-phase')).json;
  if (typeof fase !== 'string') throw new Error('não foi possível ler a fase do client');
  if (!FASES_LIVRES.includes(fase)) throw new Recusa(fase === 'Matchmaking' ? 'já está na fila' : `jogar indisponível agora (${fase})`);
  if (!confirmado) {
    const tilt = (Number(fr.freioTilt) || 0) > 0;
    const d = !tilt ? 0 : typeof seq === 'function' ? await seq() : seq ?? null;
    const motivos = avaliarFreios(fr, { derrotasSeguidas: d === undefined ? null : d, data: relogio() });
    if (motivos.length) return { status: 'confirmar', motivos, texto: textoFreios(motivos) };
  }
  // revalida o grupo entre o clique e agora (falha fechada: lobby ilegível não busca)
  const lb = await lcu('GET', '/lol-lobby/v2/lobby');
  if (!lb.ok && lb.status !== 404) throw new Error(`ler lobby: ${lb.status}`);
  const g = estadoGrupo(lb);
  if (modo === 'grupo') {
    if (!g.existe || !g.grupo) throw new Recusa('o grupo mudou: confira e clique de novo');
    if (g.lider !== true) throw new Recusa('em grupo quem busca é o líder');
    if (g.custom || !ORDEM_FILAS.includes(g.fila)) throw new Recusa('fila do grupo fora do compacto: busque pelo client normal');
    if (FILAS_COM_POSICAO.includes(g.fila)) {
      if (fr.pos1 === fr.pos2) throw new Recusa(`1ª e 2ª posição iguais (${fr.pos1})`);
      const p = await lcu('PUT', '/lol-lobby/v2/lobby/members/localMember/position-preferences', { firstPreference: fr.pos1, secondPreference: fr.pos2 });
      if (!p.ok) throw new Error(`posições: ${p.status} ${p.json?.message ?? ''}`);
    }
  } else if (modo === 'aram') {
    if (g.grupo) throw new Recusa('alguém entrou no grupo: confira e clique de novo');
    if (!g.existe || g.fila !== 450) {
      const c = await lcu('POST', '/lol-lobby/v2/lobby', { queueId: 450 });
      if (!c.ok) throw new Error(`criar lobby do ARAM: ${c.status} ${c.json?.message ?? ''}`);
    }
  } else throw new Error(`modo desconhecido: ${modo}`);
  const pronto = await lcu('GET', '/lol-lobby/v2/lobby');
  const bloqueio = restricaoDura(pronto.json, agora());
  if (bloqueio) throw new Recusa(bloqueio);
  const b = await lcu('POST', ROTA_BUSCA);
  if (!b.ok) throw new Error(`buscar: ${b.status} ${b.json?.message ?? ''}`);
  return { status: 'buscando' };
}

async function responderConvite(s, ctx, id, acao) {
  if (s.ocupado) return;
  const c = s.convites.find(x => x.id === id);
  if (!c) return;
  if (acao === 'accept' && !c.pode) { ctx.avisar('o client não deixa aceitar este convite agora', true); return; }
  s.ocupado = true; s.pintar();
  try {
    const r = await ctx.lcu('POST', `/lol-lobby/v2/received-invitations/${encodeURIComponent(id)}/${acao}`);
    if (!r.ok) { ctx.avisar(`${acao === 'accept' ? 'aceitar' : 'recusar'} convite: ${r.status}`, true); return; }
    s.convites = s.convites.filter(x => x.id !== id);
    if (acao === 'decline') ctx.avisar('convite recusado');
  } finally { s.ocupado = false; s.pintar(); }
}

// "+ convidar": a lista de amigos ao lado (a do 👥, chat ao lado ligado) ou em janela própria (coletor); sem as duas, a lista
// dentro desta tela
async function abrirConvidar(s, ctx) {
  if (await abrirChat(ctx)) return;
  if (!ctx.vivo()) return;
  s.amigosAbertos = true; s.amigos = null; s.pintar();
  const r = await ctx.lcu('GET', '/lol-chat/v1/friends');
  if (!ctx.vivo() || !s.amigosAbertos) return;
  s.amigos = r.ok ? amigosParaConvidar(r.json) : [];
  s.amigosErro = r.ok ? '' : `não foi possível ler os amigos (${r.status})`;
  s.pintar();
}

// convite por clique dele: sem lobby, monta o da fila escolhida antes (um convite precisa de grupo)
async function convidarAmigo(s, ctx, a) {
  const chave = String(a.summonerId ?? a.puuid);
  if (s.convidando.has(chave)) return;
  if (s.g.existe && s.g.podeConvidar === false) { ctx.avisar('o líder não liberou convites', true); return; }
  s.convidando.add(chave); s.pintar();
  try {
    if (!s.g.existe) {
      const c = await ctx.lcu('POST', '/lol-lobby/v2/lobby', { queueId: s.fila });
      if (!c.ok) { ctx.avisar(`não foi possível montar o lobby (${c.status})`, true); return; }
    }
    const inv = { toSummonerId: a.summonerId ?? undefined, toPuuid: a.puuid || undefined };
    const r = await ctx.lcu('POST', '/lol-lobby/v2/lobby/invitations', [inv]);
    if (!r.ok) { ctx.avisar(`convite não saiu (${r.status})`, true); return; }
    ctx.avisar(`convite enviado para ${a.nome}`);
  } finally { s.convidando.delete(chave); s.pintar(); }
}

// ---------- desenho (DOM só por h(): texto da LCU entra por textContent) ----------
const acoesTardias = s => new Proxy({}, { get: (_, nome) => (...args) => s.acoes?.[nome]?.(...args) });

function pintar(s, cab) {
  const { ctx, g } = s;
  const membro = g.existe && g.grupo && g.lider === false;
  const deFora = filaDeFora(g) && !s.filaEscolhida;
  const filaLobby = (g.existe && g.grupo) || deFora ? g.fila : s.fila;
  const f = FILAS_CP[filaLobby] || { c: nomeFila(filaLobby), n: nomeFila(filaLobby) };
  const comPos = FILAS_COM_POSICAO.includes(filaLobby);
  // ação lida na hora do clique (a 1ª pintura pode vir antes de s.acoes existir)
  const a = acoesTardias(s);
  const filhos = [];
  s.refs = {};

  // convite recebido (o primeiro; os outros chegam quando este some)
  const c = s.convites[0];
  if (c) {
    const fc = FILAS_CP[c.fila];
    filhos.push(h('div', { class: 'lc-cp-convite', dataset: { a: 'convite' } },
      h('b', {}, c.de), ' te convidou', fc ? [' para ', h('b', {}, fc.n)] : '',
      h('div', { class: 'lc-cp-bts' },
        h('button', { class: 'lc-cp-btn lc-cp-prim' + (c.pode ? '' : ' lc-cp-cinza'), disabled: s.ocupado || !c.pode, title: c.pode ? 'aceitar' : 'o client não deixa aceitar agora', dataset: { a: 'convite-aceitar' }, on: { click: () => a.aceitar?.(c.id) } }, 'aceitar'),
        h('button', { class: 'lc-cp-btn lc-cp-verm', disabled: s.ocupado, dataset: { a: 'convite-recusar' }, on: { click: () => a.recusar?.(c.id) } }, 'recusar'))));
  }

  if (s.dica) filhos.push(h('div', { class: 'lc-cp-dica' }, h('b', {}, 'coach'), s.dica));

  // 📊 última partida (passo 13 B3): reabrir/analisar expande e abre o painel de 6 abas; some no próximo ready check
  const ua = linhaUltima(s.analise, id => s.nomesCamp?.get?.(Number(id))?.nome || `campeão ${id}`);
  if (ua) filhos.push(h('div', { class: 'lc-cp-ultima', dataset: { a: 'ultima' } },
    s.analise?.resumo?.campeao ? fotoCampeao(s.analise.resumo.campeao, { tam: 26 }) : h('span', { class: 'lc-cp-ultima-ic' }, '📊'),
    h('div', {}, h('b', {}, ua.titulo), h('small', {}, ua.sub)),
    h('button', { class: 'lc-cp-btn' + (ua.botao.acao ? ' lc-cp-prim' : ' lc-cp-cinza'), disabled: !ua.botao.acao, title: ua.botao.motivo || undefined,
      dataset: { a: 'ultima-' + (ua.botao.acao || 'espera') }, on: { click: () => a.ultima?.(ua.botao.acao) } }, ua.botao.rotulo)));

  // grupo
  filhos.push(h('div', { class: 'lc-cp-rot' }, 'grupo'));
  const mbs = [];
  if (!g.existe || !g.membros.length) mbs.push(h('span', { class: 'lc-cp-mb' }, avatar(cache.icone, cache.nome, 18), 'você'));
  else for (const m of [...g.membros].sort((x, y) => (y.lider ? 1 : 0) - (x.lider ? 1 : 0))) {
    const nome = m.eu ? 'você' : (m.nome || cache.nomes.get(String(m.summonerId)) || 'amigo');
    if (!m.eu && !m.nome && m.summonerId && !cache.nomes.has(String(m.summonerId))) resolverNome(s, m.summonerId);
    mbs.push(h('span', { class: 'lc-cp-mb' }, avatar(m.icone, nome, 18), nome, m.lider && g.grupo ? h('small', {}, 'líder') : null));
  }
  if (!membro && (g.podeConvidar !== false || !g.existe)) mbs.push(h('button', { class: 'lc-cp-link', title: 'abre a lista de amigos para convidar', dataset: { a: 'convidar' }, on: { click: () => a.convidar?.() } }, '+ convidar'));
  if (g.existe && g.grupo) mbs.push(h('button', { class: 'lc-cp-link', title: 'sair do grupo', disabled: s.ocupado, dataset: { a: 'sair' }, on: { click: () => a.sair?.() } }, 'sair'));
  filhos.push(h('div', { class: 'lc-cp-grupo' }, mbs));

  if (s.amigosAbertos) filhos.push(listaAmigos(s));

  // fila
  filhos.push(h('div', { class: 'lc-cp-rot' }, g.grupo ? (membro ? 'fila (quem escolhe é o líder)' : 'fila do grupo (muda pelo client normal)') : 'fila'));
  filhos.push(h('div', { class: 'lc-cp-seg' }, ORDEM_FILAS.map(id => h('button', {
    class: id === filaLobby ? 'lc-cp-on' : '', disabled: g.grupo || s.ocupado, dataset: { a: 'fila', v: String(id) },
    on: { click: () => a.fila?.(id) },
  }, FILAS_CP[id].c))));

  // posições
  filhos.push(h('div', { class: 'lc-cp-rot' }, 'posições'));
  if (comPos) filhos.push(h('div', { class: 'lc-cp-posicoes' },
    h('button', { title: 'clique para trocar', disabled: s.ocupado, dataset: { a: 'pos', v: '1' }, on: { click: () => a.pos?.(1) } }, '1ª', h('b', {}, NOME_POS[s.pos1] || s.pos1)),
    h('button', { title: 'clique para trocar', disabled: s.ocupado, dataset: { a: 'pos', v: '2' }, on: { click: () => a.pos?.(2) } }, '2ª', h('b', {}, NOME_POS[s.pos2] || s.pos2))));
  else filhos.push(h('div', { class: 'lc-cp-nota' }, filaLobby === 450 ? 'ARAM não tem posição' : 'esta fila não tem posição'));

  // JOGAR
  const plano = planoJogar(g, s.fila, { filaEscolhida: !!s.filaEscolhida });
  const armado = s.confirmacao.armada() && !!s.textoFreio;
  if (g.restricao) {
    filhos.push(h('div', { class: 'lc-cp-pena' }, '⛔ ', h('b', {}, 'busca indisponível agora.'), h('br'), g.restricao));
    filhos.push(h('button', { class: 'lc-cp-jogar', disabled: true, dataset: { a: 'jogar' } }, 'JOGAR', h('small', {}, 'volta quando liberar; a busca só começa com o seu clique')));
  } else if (membro) {
    filhos.push(h('button', { class: 'lc-cp-jogar', disabled: true, dataset: { a: 'jogar' } }, 'O LÍDER BUSCA', h('small', {}, `${f.n} · escolha as suas posições`)));
  } else if (!plano.pode) {
    filhos.push(h('button', { class: 'lc-cp-jogar', disabled: true, title: plano.motivo, dataset: { a: 'jogar' } }, plano.rotulo || 'JOGAR', h('small', {}, plano.motivo)));
  } else {
    const outros = g.membros.length - 1;
    const comQuem = !g.grupo ? '' : outros > 0 ? ` · com ${outros} ${outros === 1 ? 'amigo' : 'amigos'}` : ' · convite pendente';
    filhos.push(h('button', { class: 'lc-cp-jogar' + (armado ? ' lc-cp-armado' : ''), disabled: s.ocupado, dataset: { a: 'jogar' }, on: { click: () => a.jogar?.() } },
      s.ocupado ? '…' : armado ? 'BUSCAR MESMO ASSIM' : 'JOGAR',
      h('small', {}, `${f.n}${comPos ? ` · ${NOME_POS[s.pos1]} / ${NOME_POS[s.pos2]}` : ''}${comQuem}`)));
    if (armado) {
      const cont = h('span', { class: 'lc-cp-cont' }, `${Math.max(0, Math.ceil((s.armadoAte - s.agora()) / 1000))} s`);
      s.refs.freioCont = cont;
      filhos.push(h('div', { class: 'lc-cp-freio', dataset: { a: 'freio' } }, '⚠ ', s.textoFreio, ' ', cont));
    }
  }

  // hoje
  const hoje = resumoHoje(s.hoje);
  filhos.push(h('div', { class: 'lc-cp-rot' }, 'hoje'));
  const ult = hoje?.ultimaFim ? ['última', haQuanto(hoje.ultimaFim, s.agora())] : ['última', hoje ? 'nenhuma hoje' : '—'];
  const dia = blocoDia(hoje, cab?.ranque?.(), ult, { agoraMs: s.agora() });
  s.refs.terceira = dia.querySelector?.('[data-tick="terceira"]') || null;
  filhos.push(dia);
  if (s.hoje?.length) filhos.push(listaPartidas(s.hoje));

  s.raiz.replaceChildren(...filhos);
}

// nome de quem está no grupo (summonerName vem vazio desde o Riot ID): GET do invocador, guardado por id
function resolverNome(s, summonerId) {
  const k = String(summonerId);
  cache.nomes.set(k, '');
  s.ctx.lcu('GET', `/lol-summoner/v1/summoners/${encodeURIComponent(k)}`).then(r => {
    const n = r.ok ? String(r.json?.gameName || r.json?.displayName || '') : '';
    cache.nomes.set(k, n);
    if (n) s.pintar();
  }).catch(() => {});
}

function listaAmigos(s) {
  const a = acoesTardias(s);
  const linhas = s.amigos === null ? [h('div', { class: 'lc-cp-nota' }, 'lendo os amigos…')]
    : !s.amigos.length ? [h('div', { class: 'lc-cp-nota' }, s.amigosErro || 'nenhum amigo online no LoL')]
      : s.amigos.slice(0, 12).map(am => {
        const ocupado = s.convidando.has(String(am.summonerId ?? am.puuid));
        return h('div', { class: 'lc-cp-amigo' + (am.livre ? '' : ' lc-cp-apagado') },
          h('span', { class: 'lc-cp-nm' }, am.nome, h('small', {}, am.status)),
          h('button', { class: 'lc-cp-link', disabled: ocupado || !am.livre, title: am.livre ? 'convidar para o seu grupo' : 'ocupado agora',
            dataset: { a: 'convidar-amigo' }, on: { click: () => a.convidarAmigo?.(am) } }, ocupado ? '…' : 'convidar'));
      });
  return h('div', { class: 'lc-cp-amigos', dataset: { a: 'amigos' } },
    h('div', { class: 'lc-cp-amigos-topo' }, h('span', {}, 'convidar amigo'), h('button', { class: 'lc-cp-link', dataset: { a: 'fechar-amigos' }, on: { click: () => a.fecharAmigos?.() } }, 'fechar')),
    linhas);
}

function listaPartidas(lista) {
  const ul = h('ul', { class: 'lc-cp-partidas' });
  const nomes = new Map();
  const itens = [...lista].reverse().slice(0, 8).map(p => {
    const nome = h('span', {}, `campeão ${p.championId}`);
    nomes.set(p.championId, (nomes.get(p.championId) || []).concat([nome]));
    return h('li', {}, h('span', {}, horaMin(p.inicio)), fotoCampeao(p.championId, { tam: 20 }), nome,
      h('span', { class: 'lc-cp-r ' + (p.vitoria ? 'lc-cp-v' : 'lc-cp-d') }, p.vitoria ? 'vitória' : 'derrota'),
      h('span', { class: 'lc-cp-k' }, `${p.k}/${p.d}/${p.a} `, h('span', { class: 'lc-cp-f' }, FILAS_CP[p.fila]?.c || '')));
  });
  ul.append(...itens);
  // nomes dos campeões chegam depois (catálogo do client, uma vez por carga)
  campeoes().then(cat => { for (const [id, els] of nomes) { const n = cat.get(id)?.nome; if (n) for (const el of els) el.textContent = n; } }).catch(() => {});
  return ul;
}

// ---------- CSS (visual do protótipo aprovado, prefixo lc-cp-) ----------
export const CSS_LOBBY = `
#lc-compacto .lc-cp-id { display:flex; gap:8px; align-items:center; min-width:0; }
#lc-compacto .lc-cp-id b { display:block; color:var(--lc-ouro2); font-size:13px; line-height:1.1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#lc-compacto .lc-cp-id small { display:block; color:var(--lc-mudo); font-size:11px; white-space:nowrap; }
#lc-compacto .lc-cp-avcx { display:flex; flex:none; }
#lc-compacto .lc-cp-av { display:inline-grid; place-items:center; flex:none; border-radius:50%; border:2px solid var(--lc-ouro);
  background:#1e3a5f center/cover no-repeat; color:var(--lc-ouro2); font-weight:700; font-size:12px; }
#lc-compacto .lc-cp-grupo .lc-cp-av { border-width:1px; font-size:10px; }
#lc-compacto .lc-cp-dica b { color:var(--lc-azul); font-weight:600; margin-right:4px; }
#lc-compacto .lc-cp-ultima { flex:none; display:flex; gap:9px; align-items:center; padding:7px 9px; border:1px solid #1d4b57; background:rgba(9,20,40,.65); }
#lc-compacto .lc-cp-ultima > div { flex:1; min-width:0; }
#lc-compacto .lc-cp-ultima b { display:block; color:var(--lc-ouro2); font-size:12px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#lc-compacto .lc-cp-ultima small { display:block; color:var(--lc-mudo); font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#lc-compacto .lc-cp-ultima .lc-cp-btn { flex:none; padding:5px 9px; font-size:11.5px; }
#lc-compacto .lc-cp-ultima-ic { width:26px; text-align:center; flex:none; }
#lc-compacto .lc-cp-seg { display:grid; grid-template-columns:repeat(4,1fr); border:1px solid var(--lc-linha); flex:none; }
#lc-compacto .lc-cp-seg button { background:var(--lc-pan); color:var(--lc-mudo); border:none; border-right:1px solid var(--lc-linha); padding:8px 2px;
  font-family:inherit; font-size:12px; cursor:pointer; }
#lc-compacto .lc-cp-seg button:last-child { border-right:none; }
#lc-compacto .lc-cp-seg button.lc-cp-on { background:#1e2d3d; color:var(--lc-ouro2); box-shadow:inset 0 -2px 0 var(--lc-ouro); }
#lc-compacto .lc-cp-seg button[disabled] { cursor:not-allowed; }
#lc-compacto .lc-cp-seg button[disabled]:not(.lc-cp-on) { opacity:.55; }
#lc-compacto .lc-cp-posicoes { display:grid; grid-template-columns:1fr 1fr; gap:6px; flex:none; }
#lc-compacto .lc-cp-posicoes button { background:var(--lc-pan); border:1px solid var(--lc-linha); color:var(--lc-mudo); padding:7px; font-family:inherit;
  font-size:12px; text-align:left; cursor:pointer; }
#lc-compacto .lc-cp-posicoes button:hover { border-color:var(--lc-ouro-esc); }
#lc-compacto .lc-cp-posicoes button b { color:var(--lc-ouro2); margin-left:4px; }
#lc-compacto .lc-cp-jogar { margin-top:6px; flex:none; background:linear-gradient(180deg,#1e5a6b,#0b3a49); border:2px solid var(--lc-azul2);
  color:var(--lc-ouro2); font-family:inherit; font-size:26px; font-weight:700; letter-spacing:.14em; padding:12px 8px 8px; display:flex;
  flex-direction:column; align-items:center; gap:2px; cursor:pointer; }
#lc-compacto .lc-cp-jogar small { font-size:11px; letter-spacing:.04em; font-weight:400; color:var(--lc-txt); }
#lc-compacto .lc-cp-jogar:hover { filter:brightness(1.15); }
#lc-compacto .lc-cp-jogar.lc-cp-armado { background:linear-gradient(180deg,#6b4a1e,#46300f); border-color:var(--lc-amarelo); font-size:19px; }
#lc-compacto .lc-cp-jogar[disabled] { filter:grayscale(1) brightness(.7); cursor:not-allowed; }
#lc-compacto .lc-cp-freio { flex:none; border:1px solid var(--lc-amarelo); background:rgba(242,193,78,.08); color:var(--lc-ouro2); font-size:12.5px; padding:7px 10px; }
#lc-compacto .lc-cp-freio .lc-cp-cont, #lc-compacto .lc-cp-cont { float:right; color:var(--lc-amarelo); font-weight:700; }
#lc-compacto .lc-cp-pena { flex:none; border:1px solid var(--lc-verm); background:rgba(232,64,87,.1); padding:10px 12px; color:var(--lc-ouro2); font-size:13px; }
#lc-compacto .lc-cp-dia { display:grid; grid-template-columns:1fr 1fr 1fr; border:1px solid var(--lc-linha); background:var(--lc-pan); flex:none; }
#lc-compacto .lc-cp-dia > div { padding:7px 9px; border-right:1px solid var(--lc-linha); font-size:12px; color:var(--lc-mudo); min-width:0; }
#lc-compacto .lc-cp-dia > div:last-child { border-right:none; }
#lc-compacto .lc-cp-dia b { font-size:17px; color:var(--lc-ouro2); }
#lc-compacto .lc-cp-dia b.lc-cp-v, #lc-compacto .lc-cp-v { color:var(--lc-azul); }
#lc-compacto .lc-cp-dia b.lc-cp-d, #lc-compacto .lc-cp-d { color:var(--lc-verm); }
#lc-compacto .lc-cp-dia small { display:block; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#lc-compacto .lc-cp-partidas { list-style:none; margin:0; padding:0; font-size:12px; flex:none; }
#lc-compacto .lc-cp-partidas li { display:grid; grid-template-columns:40px 22px 1fr 56px 104px; gap:6px; align-items:center; padding:4px 2px;
  border-bottom:1px solid rgba(60,60,65,.5); }
#lc-compacto .lc-cp-partidas li > span:nth-child(3) { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#lc-compacto .lc-cp-partidas .lc-cp-r { font-weight:700; text-align:center; }
#lc-compacto .lc-cp-partidas .lc-cp-k { color:var(--lc-ouro2); text-align:right; }
#lc-compacto .lc-cp-partidas .lc-cp-f { color:var(--lc-mudo); font-size:11px; }
#lc-compacto .lc-cp-grupo { display:flex; gap:6px; align-items:center; flex-wrap:wrap; font-size:12px; color:var(--lc-mudo); }
#lc-compacto .lc-cp-mb { display:flex; gap:5px; align-items:center; background:var(--lc-pan); border:1px solid var(--lc-linha); padding:3px 7px 3px 4px; color:var(--lc-ouro2); }
#lc-compacto .lc-cp-mb small { color:var(--lc-mudo); font-size:10.5px; }
#lc-compacto .lc-cp-link { background:none; border:1px dashed var(--lc-ouro-esc); color:var(--lc-ouro); font-family:inherit; font-size:11.5px; padding:3px 8px; cursor:pointer; }
#lc-compacto .lc-cp-link[disabled] { opacity:.5; cursor:not-allowed; }
#lc-compacto .lc-cp-convite { flex:none; border:1px solid var(--lc-azul2); background:rgba(10,200,185,.08); padding:8px 10px; font-size:12.5px; color:var(--lc-ouro2); }
#lc-compacto .lc-cp-convite .lc-cp-bts { display:flex; gap:8px; margin-top:6px; }
#lc-compacto .lc-cp-convite .lc-cp-bts .lc-cp-btn { flex:1; padding:6px; }
#lc-compacto .lc-cp-amigos { flex:none; border:1px solid var(--lc-ouro-esc); background:var(--lc-pan); padding:6px 8px; display:flex; flex-direction:column; gap:4px;
  max-height:190px; overflow:auto; }
#lc-compacto .lc-cp-amigos-topo { display:flex; justify-content:space-between; align-items:center; font-size:11px; letter-spacing:.08em;
  text-transform:uppercase; color:var(--lc-mudo); }
#lc-compacto .lc-cp-amigo { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:12.5px; color:var(--lc-ouro2); }
#lc-compacto .lc-cp-amigo.lc-cp-apagado { opacity:.55; }
#lc-compacto .lc-cp-amigo .lc-cp-nm { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#lc-compacto .lc-cp-amigo .lc-cp-nm small { color:var(--lc-mudo); font-size:11px; margin-left:6px; }
`;

// instância do client (o roteador importa montar/desmontar/atualizar)
const padrao = criarTelaLobby();
export const montar = padrao.montar;
export const desmontar = padrao.desmontar;
export const atualizar = padrao.atualizar;
export const estadoTela = padrao.estado;
