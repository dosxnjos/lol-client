// Chat ao lado do compacto (roadmap/2026-10-13-client-compacto.md, passo 13, tela A1; pedido de 14/10/2026 ~17:00: "o próprio
// modo compacto ganhando espaço para a direita, mostrando a lista. E se eu abrir esse chat com alguém, esse chat também expande
// mais para a direita"). Lista de amigos, conversa 1:1 e a sala do time na seleção ("chat do time entra sim", 14/10 ~20:00).
// Quem abre, fecha e decide a largura é compacto/lateral.js; aqui só dados (funções puras, portadas 1:1 de
// coletor/chat_janelas.py) e o desenho de cada painel. Importável no node: nada de DOM no topo.
// Etapa 1 de roadmap/2026-10-16-compacto-chat-amigos-perfil.md (16/10/2026): o painel de chat ganha os RECENTES (verRecentes,
// criarRecentes: conversas 1:1 pela última mensagem) em cima e a conversa escolhida embaixo; a lista de amigos (👥) não tem mais
// a sala do time (ela é a 1ª linha dos recentes na seleção).
//
// Linhas que não se cruzam:
// - escrita só por clique ou Enter dele (evento com isTrusted): enviar, convidar, "lida". Rotas e corpos do front da Riot (lidos
//   no rcp-fe-lol-social/rcp-fe-lol-parties 16.20, 14/10/2026, tools/ler-wad.py): mensagem POST /lol-chat/v1/conversations/<id>/
//   messages {type:'chat', fromId, fromSummonerId, isHistorical:false, timestamp, body} (sendMessage); conversa nova POST
//   /lol-chat/v1/conversations {id, type:'chat'} (_createConversation); "ativa" PUT/DELETE /lol-chat/v1/conversations/active
//   {id} (setActive); convite POST /lol-lobby/v2/lobby/invitations [{toSummonerId}] (invitePlayer). Nunca testado contra o
//   client real: a 1ª prova é uma mensagem dele de verdade.
// - sala do time: só a conversa type 'championSelect' (da conversa ficam só id e type; password e mucJwtDto nunca). Quem falou
//   aparece só como campeão e posição (cruzando o remetente com myTeam da sessão); sem casar = "aliado". Nenhum nome da sala
//   nem da sessão é lido: nome oculto da ranqueada nunca aparece.
import { h, esc, fotoCampeao } from './comum.js';
import { corpoMensagem } from './chat-sala.js';

export const TEXTO_MAX = 500;
export const MSGS_MAX = 100;
export const CONVITE_VALE_MS = 60000;
export const FILAS = { 420: 'Solo/Duo', 440: 'Flex', 400: 'Normal', 430: 'Normal', 490: 'Rápida', 450: 'ARAM', 1700: 'Arena', 1900: 'URF',
  900: 'ARURF', 700: 'Clash', 830: 'Co-op', 840: 'Co-op', 850: 'Co-op', 870: 'Co-op', 880: 'Co-op', 890: 'Co-op', 3100: 'Personalizada',
  1090: 'TFT', 1100: 'TFT ranqueada', 1130: 'TFT', 1160: 'TFT duplas' };
export const TIPOS_FILA = { RANKED_SOLO_5x5: 'Solo/Duo', RANKED_FLEX_SR: 'Flex', NORMAL: 'Normal', BLIND_PICK: 'Normal', DRAFT_PICK: 'Normal',
  ARAM_UNRANKED_5x5: 'ARAM', ARAM: 'ARAM', CHERRY: 'Arena', RANKED_TFT: 'TFT ranqueada', NORMAL_TFT: 'TFT', CUSTOM: 'Personalizada', SWIFTPLAY: 'Rápida' };
const RE_SALA = /@(champ-select|post-game|lol-post-game|sec|lol-lobby|lobby|club|cs)\./i;
const ORDEM = { chat: 0, fila: 1, jogo: 2, away: 3, mobile: 4, off: 5 };
export const POS_PT = { TOP: 'Topo', JUNGLE: 'Selva', MIDDLE: 'Meio', BOTTOM: 'Atirador', UTILITY: 'Suporte' };

// ---------- funções puras (tools/teste-compacto-lateral.mjs; espelho de coletor/chat_janelas.py) ----------
export function ehConversaDireta(c) {
  if (!c || typeof c !== 'object') return false;
  return String(c.type || '').toLowerCase() === 'chat' && !RE_SALA.test(String(c.id || ''));
}
export function nomeFila(lol) {
  const l = lol || {};
  const q = Number.parseInt(l.queueId, 10);
  if (Number.isFinite(q) && q !== 0 && FILAS[q]) return FILAS[q];
  let tipo = String(l.gameQueueType || '');
  const g = String(l.gameStatus || '');
  if (!tipo && g.startsWith('hosting_')) tipo = g.slice('hosting_'.length);
  return TIPOS_FILA[tipo] || '';
}
// {online, dot, txt, cls, ocupado}
export function statusAmigo(f, agoraMs = Date.now()) {
  const disp = String(f?.availability || '').toLowerCase();
  const lol = f?.lol && typeof f.lol === 'object' ? f.lol : {};
  const produto = String(f?.product || '').toLowerCase();
  if (disp === '' || disp === 'offline') return { online: false, dot: 'off', txt: 'offline', cls: '', ocupado: true };
  if (disp === 'mobile') return { online: true, dot: 'mobile', txt: 'no celular', cls: '', ocupado: true };
  if (produto && produto !== 'league_of_legends' && produto !== 'lol')
    return { online: true, dot: disp === 'away' ? 'away' : 'chat', txt: `no ${String(f.productName || produto)}`, cls: '', ocupado: true };
  if (disp === 'away') return { online: true, dot: 'away', txt: 'ausente', cls: '', ocupado: false };
  const g = String(lol.gameStatus || '');
  const fila = nomeFila(lol);
  const suf = fila ? ` · ${fila}` : '';
  if (g === 'inGame') {
    let txt = 'em partida' + suf;
    const ts = Number(lol.timeStamp) || 0, min = (agoraMs - ts) / 60000;
    if (ts > 0 && min >= 0 && min < 180) txt += ` · ${Math.floor(min)} min`;
    return { online: true, dot: 'jogo', txt, cls: 'jogo', ocupado: true };
  }
  if (g === 'championSelect') return { online: true, dot: 'jogo', txt: 'na seleção' + suf, cls: 'jogo', ocupado: true };
  if (g === 'inQueue') return { online: true, dot: 'fila', txt: 'na fila' + suf, cls: 'fila', ocupado: true };
  if (g.startsWith('hosting')) return { online: true, dot: 'chat', txt: 'no lobby' + suf, cls: 'fila', ocupado: false };
  if (g === 'spectating') return { online: true, dot: 'jogo', txt: 'assistindo', cls: 'jogo', ocupado: true };
  if (disp === 'dnd') return { online: true, dot: 'jogo', txt: 'ocupado', cls: 'jogo', ocupado: true };
  return { online: true, dot: 'chat', txt: 'online', cls: '', ocupado: false };
}
export function grupoDoAmigo(f) {
  const g = String(f?.displayGroupName || f?.groupName || '').trim();
  return !g || g.startsWith('**') ? 'geral' : g;
}
export const pidDe = f => String(f?.pid || f?.id || '');

// lobby (GET /lol-lobby/v2/lobby) -> {tem, pode, motivo, membros:Set}: convidar só no lobby, como líder (ou convite liberado)
export function lobbyParaConvite(r) {
  if (!r || r.status === 0 || (r.ok === false && r.status !== 404)) return { tem: null, pode: false, motivo: 'não foi possível ler o lobby', membros: new Set() };
  const lob = r.ok ? r.json : null;
  if (!lob || typeof lob !== 'object') return { tem: false, pode: false, motivo: 'abra o lobby antes (escolha a fila no compacto)', membros: new Set() };
  const eu = lob.localMember || {};
  const membros = new Set();
  for (const m of lob.members || []) for (const c of ['puuid', 'summonerId']) if (m?.[c]) membros.add(String(m[c]));
  const pode = !!(eu.isLeader || eu.allowedInviteOthers);
  return { tem: true, pode, motivo: pode ? '' : 'só o líder do grupo convida', membros };
}

// friends + conversas diretas + lobby -> {online, offline, grupos, naoLidas} (mesmas regras de chat_janelas.ver_amigos)
export function verAmigos({ amigos = [], conversas = [], lobby = null, convidados = new Map(), abertas = new Set(), agoraMs = Date.now() } = {}) {
  const porPid = new Map();
  for (const c of conversas) if (ehConversaDireta(c)) porPid.set(String(c.pid || c.id || '').toLowerCase(), c);
  const lob = lobby || { tem: false, pode: false, motivo: 'abra o lobby antes', membros: new Set() };
  const online = [], offline = [];
  for (const f of Array.isArray(amigos) ? amigos : []) {
    if (!f || typeof f !== 'object') continue;
    const pid = pidDe(f);
    if (!pid) continue;
    const st = statusAmigo(f, agoraMs);
    const conv = porPid.get(pid.toLowerCase());
    const un = Math.max(0, Number(conv?.unreadMessageCount) || 0);
    const lol = f.lol && typeof f.lol === 'object' ? f.lol : {};
    const item = { pid, conv: conv ? String(conv.id) : '', nome: String(f.gameName || f.name || '?'), dot: st.dot, txt: st.txt, cls: st.cls, un,
      grupo: grupoDoAmigo(f), aberta: abertas.has(pid), icone: Number(f.icon) > 0 ? Number(f.icon) : 0,
      campeao: String(lol.gameStatus || '') === 'inGame' && Number(lol.championId) > 0 ? Number(lol.championId) : 0,
      summonerId: Number(f.summonerId) > 0 ? Number(f.summonerId) : 0 };
    if (!st.online) { offline.push(item); continue; }
    const noGrupo = [String(f.puuid || ''), String(f.summonerId || '')].some(v => v && lob.membros?.has(v));
    const conv0 = convidados.get(pid);
    if (noGrupo || st.ocupado) item.convidar = { mostra: false };
    else if (conv0 !== undefined && agoraMs - conv0 < CONVITE_VALE_MS) item.convidar = { mostra: true, ok: false, rotulo: 'convidado', motivo: 'convite enviado' };
    else if (!item.summonerId) item.convidar = { mostra: true, ok: false, rotulo: 'convidar', motivo: 'sem o id do amigo para convidar' };
    else item.convidar = { mostra: true, ok: !!lob.pode, rotulo: 'convidar', motivo: lob.motivo || 'convidar para o seu grupo' };
    online.push(item);
  }
  const cmp = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });
  online.sort((a, b) => (Math.min(b.un, 1) - Math.min(a.un, 1)) || ((ORDEM[a.dot] ?? 9) - (ORDEM[b.dot] ?? 9)) || cmp(a, b));
  offline.sort((a, b) => (Math.min(b.un, 1) - Math.min(a.un, 1)) || cmp(a, b));
  const grupos = [];
  for (const a of online) if (!grupos.includes(a.grupo)) grupos.push(a.grupo);
  grupos.sort((a, b) => (a !== 'geral') - (b !== 'geral') || a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
  return { online, offline, grupos, naoLidas: [...online, ...offline].reduce((s, a) => s + a.un, 0) };
}

const ehEntrouSaiu = m => String(m.type || '').toLowerCase() === 'system' && /^(joined|left)_room$/.test(String(m.body || '').trim());

// ---------- recentes (etapa 1 de 2026-10-16) ----------
// da lista da LCU (GET /lol-chat/v1/conversations) só o que a lateral usa. Conversa 1:1: id, pid, nome, não lidas e da
// lastMessage só remetente, texto, hora e tipo (medido em 16/10/2026: as 1:1 TAMBÉM trazem password e mucJwtDto; nunca ficam).
// Sala de grupo: só id e type.
export function limparConversas(lista) {
  return (Array.isArray(lista) ? lista : []).filter(c => c && typeof c === 'object').map(c => {
    if (!ehConversaDireta(c)) return { id: String(c.id ?? ''), type: String(c.type ?? '') };
    const lm = c.lastMessage && typeof c.lastMessage === 'object' ? c.lastMessage : null;
    return { id: String(c.id), pid: String(c.pid || c.id), type: 'chat', unreadMessageCount: Math.max(0, Number(c.unreadMessageCount) || 0), gameName: String(c.gameName || c.name || ''),
      lastMessage: lm ? { fromId: lm.fromId, fromPid: lm.fromPid, fromPuuid: lm.fromPuuid, body: typeof lm.body === 'string' ? lm.body : '', timestamp: String(lm.timestamp || ''),
        type: String(lm.type || '') } : null };
  });
}
// hora curta da última mensagem: hoje = "19:58"; outro dia = "14/10"
export function quandoCurto(ts, agoraMs = Date.now()) {
  const t = Date.parse(ts || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t), a = new Date(agoraMs);
  const p2 = n => String(n).padStart(2, '0');
  if (d.toDateString() === a.toDateString()) return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
  return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`;
}
// conversas diretas (limparConversas) + amigos (verAmigos: foto e status) + eu -> [{k, pid, conv, nome, trecho, deMim, quando, hora,
// un, icone, dot, campeao, txt}], da última mensagem mais nova para a mais velha; conversa sem mensagem no fim (por nome).
// "joined_room"/"left_room" de sistema não viram trecho.
export function verRecentes({ conversas = [], amigos = null, eu = null, agoraMs = Date.now() } = {}) {
  const meus = new Set([eu?.id, eu?.pid, eu?.puuid].filter(Boolean).map(String));
  const porPid = new Map();
  if (amigos && amigos.ok !== false) for (const a of [...(amigos.online || []), ...(amigos.offline || [])]) porPid.set(String(a.pid).toLowerCase(), a);
  const out = [];
  for (const c of Array.isArray(conversas) ? conversas : []) {
    if (!ehConversaDireta(c)) continue;
    const pid = String(c.pid || c.id || '');
    if (!pid) continue;
    const a = porPid.get(pid.toLowerCase()) || null;
    const lm = c.lastMessage && typeof c.lastMessage === 'object' ? c.lastMessage : null;
    const tipo = String(lm?.type || 'chat').toLowerCase();
    const sis = !lm || ehEntrouSaiu(lm) || (tipo !== 'chat' && tipo !== 'groupchat');
    const deMim = !!lm && [lm.fromId, lm.fromPid, lm.fromPuuid].filter(Boolean).some(v => meus.has(String(v)));
    const t = Date.parse(lm?.timestamp || '');
    const corpo = sis ? '' : String(lm.body || '').replace(/\s+/g, ' ').trim();
    out.push({ k: `c:${pid.toLowerCase()}`, pid, conv: String(c.id || ''), nome: String(c.gameName || a?.nome || 'amigo'), trecho: corpo ? (deMim ? `você: ${corpo}` : corpo) : '',
      deMim, quando: Number.isFinite(t) ? t : null, hora: quandoCurto(lm?.timestamp, agoraMs), un: Math.max(0, Number(c.unreadMessageCount) || 0),
      icone: a?.icone || 0, dot: a?.dot || 'off', campeao: a?.campeao || 0, txt: a?.txt || '' });
  }
  const cmp = (x, y) => x.nome.localeCompare(y.nome, 'pt-BR', { sensitivity: 'base' });
  return out.sort((x, y) => (x.quando === null) - (y.quando === null) || (y.quando ?? 0) - (x.quando ?? 0) || cmp(x, y));
}

// mensagens -> [{id, eu, texto, quando, sis}] (as MSGS_MAX últimas). eu = {id, puuid, pid, summonerId}
export function lerConversa(msgs, eu) {
  const meus = new Set([eu?.id, eu?.pid, eu?.puuid].filter(Boolean).map(String));
  // "joined_room"/"left_room" de sistema nas 1:1 (visto em 15/10/2026: 4 conversas terminando nelas) não são conversa
  return (Array.isArray(msgs) ? msgs : []).filter(m => m && typeof m === 'object' && !ehEntrouSaiu(m)).slice(-MSGS_MAX).map(m => {
    const tipo = String(m.type || 'chat').toLowerCase();
    const de = [m.fromPid, m.fromId, m.fromPuuid].filter(Boolean).map(String);
    return { id: String(m.id ?? ''), eu: de.some(d => meus.has(d)), texto: String(m.body ?? ''), quando: String(m.timestamp || ''),
      sis: tipo !== 'chat' && tipo !== 'groupchat' };
  });
}

// pedidos de amizade recebidos (GET /lol-chat/v2/friend-requests)
export const pedidosRecebidos = lista => (Array.isArray(lista) ? lista : []).filter(p => p && String(p.direction || '').toLowerCase() === 'in').length;

// sala do time: a conversa type 'championSelect' DESTA seleção -> {id, type} | null (nada além disso fica). Casa com
// session.chatDetails.multiUserChatId (só o id; senha e token da sala nunca são lidos): id igual ou "<muc>@...". Sala velha
// pendurada (dodge e seleção nova) com 2+ salas e nenhuma casando = null (não lê nem envia para a sala errada; revisão de
// 14/10/2026). Uma sala só = ela ([S] o formato do id contra o muc ainda não foi visto numa seleção real: sem isto, um formato
// diferente calaria a sala do time sempre).
export function acharSalaTime(conversas, sessao) {
  const salas = (Array.isArray(conversas) ? conversas : []).filter(x => x && x.type === 'championSelect' && typeof x.id === 'string');
  const muc = String(sessao?.chatDetails?.multiUserChatId ?? '').toLowerCase();
  let c = muc ? salas.find(x => { const id = x.id.toLowerCase(); return id === muc || id.startsWith(muc + '@'); }) : null;
  if (!c && salas.length === 1) c = salas[0];
  return c ? { id: c.id, type: c.type } : null;
}
// elenco do meu time na seleção, SÓ campeão e posição (sessão do champ select). Chaves de identidade ficam num Set para casar o
// remetente e nunca saem daqui. -> [{chaves:Set, campeao, posicao, eu}]
export function elencoTime(sessao) {
  const s = sessao && typeof sessao === 'object' ? sessao : {};
  const meu = s.localPlayerCellId;
  const hover = new Map();
  for (const a of (Array.isArray(s.actions) ? s.actions : []).flat()) if (a && a.type === 'pick' && Number(a.championId) > 0) hover.set(a.actorCellId, Number(a.championId));
  return (Array.isArray(s.myTeam) ? s.myTeam : []).filter(Boolean).map(c => ({
    chaves: new Set([c.puuid, c.obfuscatedPuuid, c.summonerId, c.obfuscatedSummonerId].filter(v => v !== undefined && v !== null && v !== '' && v !== 0).map(String)),
    campeao: Number(c.championId) || hover.get(c.cellId) || Number(c.championPickIntent) || 0,
    posicao: String(c.assignedPosition || '').toUpperCase(), eu: c.cellId === meu,
  }));
}
// mensagens da sala do time -> [{id, quem: {campeao, posicao, eu} | null, texto}] (só chat; system "entrou/saiu" some)
export function lerSalaTime(msgs, elenco, eu) {
  const meus = new Set([eu?.id, eu?.pid, eu?.puuid, eu?.summonerId].filter(v => v !== undefined && v !== null && v !== '').map(String));
  const lista = Array.isArray(msgs) ? msgs.filter(m => m && typeof m === 'object') : [];
  return lista.filter(m => (m.type === 'chat' || m.type === 'groupchat') && typeof m.body === 'string').slice(-MSGS_MAX).map(m => {
    const de = [m.fromPuuid, m.fromSummonerId, m.fromObfuscatedSummonerId, m.fromId, m.fromPid].filter(v => v !== undefined && v !== null && v !== '').map(String);
    const sou = de.some(d => meus.has(d));
    const j = sou ? (elenco.find(x => x.eu) || { campeao: 0, posicao: '', eu: true }) : elenco.find(x => !x.eu && de.some(d => x.chaves.has(d))) || null;
    return { id: String(m.id ?? ''), quem: j ? { campeao: j.campeao, posicao: j.posicao, eu: !!sou || !!j.eu } : null, texto: m.body };
  });
}

// ---------- desenho ----------
const DOT = { chat: '#3fbf77', jogo: '#58b3ff', fila: '#0ac8b9', away: '#e84057', mobile: '#a09b8c', off: '#5b5a56' };
const iconePerfil = id => (Number(id) > 0 ? `/lol-game-data/assets/v1/profile-icons/${Math.trunc(Number(id))}.jpg` : '');
const horaDe = ts => { const d = new Date(ts); return ts && !Number.isNaN(d.getTime()) ? d.toTimeString().slice(0, 5) : ''; };

// avatar: foto do campeão em partida, senão o ícone do perfil, senão a inicial
function avatar(a, doc) {
  const url = a.campeao ? `/lol-game-data/assets/v1/champion-icons/${a.campeao}.png` : iconePerfil(a.icone);
  return h('span', { doc, class: 'lc-lt-av', style: { backgroundImage: url ? `url("${url}")` : '' } }, url ? '' : String(a.nome || '?').trim().slice(0, 1).toUpperCase(),
    h('i', { doc, style: { background: DOT[a.dot] || DOT.off } }));
}

// Lista de amigos (👥). amb = {doc, seguro, aoAmigo(a, ev), aoConvidar(a, ev), aoPedidos(), aoFechar()} -> {el, pintar(dados), busca()}
export function criarListaAmigos(amb) {
  const { doc } = amb;
  let dados = null, filtro = '', offAberto = false, assinatura = '';
  const busca = h('input', { doc, class: 'lc-lt-busca', placeholder: 'buscar amigo', autocomplete: 'off', spellcheck: 'false', dataset: { a: 'lt-busca' } });
  busca.addEventListener('input', () => { filtro = String(busca.value || ''); pintar(dados, true); });
  busca.addEventListener('keydown', e => e.stopPropagation?.()); // teclas da busca não vão para os atalhos da Riot
  const titulo = h('b', { doc }, 'amigos');
  const sub = h('small', { doc }, '');
  const corpo = h('div', { doc, class: 'lc-lt-lista', dataset: { a: 'lt-lista' } });
  const el = h('section', { doc, class: 'lc-lt-pn lc-lt-amigos', dataset: { painel: 'lista' } },
    h('header', { doc, class: 'lc-lt-cab' }, h('div', { doc, class: 'lc-lt-tit' }, titulo, sub),
      h('button', { doc, class: 'lc-lt-x', title: 'fechar a lista', dataset: { a: 'lt-fechar-lista' }, on: { click: amb.seguro(e => amb.aoFechar?.(e)) } }, '✕')),
    h('div', { doc, class: 'lc-lt-buscacx' }, busca), corpo);

  const linha = a => h('div', { doc, class: 'lc-lt-amigo' + (a.aberta ? ' lc-lt-on' : ''), dataset: { a: 'lt-amigo', pid: a.pid }, title: a.nome,
    on: { click: amb.seguro(e => { if (e?.target?.closest?.('button')) return; amb.aoAmigo?.(a, e); }) } },
  avatar(a, doc),
  h('div', { doc, class: 'lc-lt-nm' }, h('span', { doc }, a.nome), h('small', { doc, class: a.cls || undefined }, a.txt)),
  h('span', { doc, class: 'lc-lt-dir' },
    a.convidar?.mostra ? h('button', { doc, class: 'lc-lt-conv' + (a.convidar.ok ? '' : ' lc-lt-off'), title: a.convidar.motivo || '', dataset: { a: 'lt-convidar' },
      on: { click: amb.seguro(e => amb.aoConvidar?.(a, e)) } }, a.convidar.rotulo || 'convidar') : null,
    a.un ? h('span', { doc, class: 'lc-lt-un' }, a.un > 99 ? '99+' : String(a.un)) : null));

  // dados = verAmigos(...) + {ok, motivo, pedidos, total}
  function pintar(d, forcar = false) {
    dados = d;
    const f = filtro.trim().toLocaleLowerCase('pt-BR');
    const sig = JSON.stringify([d && d.ok ? [d.online.map(a => [a.pid, a.un, a.txt, a.dot, a.aberta, a.convidar?.rotulo, a.convidar?.ok, a.campeao, a.icone]), d.offline.length,
      offAberto || f ? d.offline.map(a => [a.pid, a.un, a.aberta]) : 0, d.pedidos] : d?.motivo ?? null, f, offAberto]);
    if (!forcar && sig === assinatura) return;
    assinatura = sig;
    if (!d || !d.ok) {
      titulo.textContent = 'amigos'; sub.textContent = '';
      corpo.replaceChildren(h('div', { doc, class: 'lc-lt-vazio' }, d ? d.motivo : 'carregando…'));
      return;
    }
    titulo.textContent = 'amigos';
    sub.textContent = `${d.online.length} online de ${d.online.length + d.offline.length}`;
    const casa = a => !f || a.nome.toLocaleLowerCase('pt-BR').includes(f);
    const filhos = [];
    if (d.pedidos > 0) filhos.push(h('button', { doc, class: 'lc-lt-pedidos', dataset: { a: 'lt-pedidos' }, title: 'aceitar ou recusar é no client normal',
      on: { click: amb.seguro(e => amb.aoPedidos?.(e)) } }, `${d.pedidos} ${d.pedidos === 1 ? 'pedido' : 'pedidos'} de amizade`, h('span', { doc }, 'abrir ⤢')));
    for (const g of d.grupos) {
      const doGrupo = d.online.filter(a => a.grupo === g);
      filhos.push(h('div', { doc, class: 'lc-lt-grupo' }, `${g} (${doGrupo.length})`), ...doGrupo.filter(casa).map(linha));
    }
    if (!d.online.length) filhos.push(h('div', { doc, class: 'lc-lt-vazio' }, 'nenhum amigo online'));
    filhos.push(h('button', { doc, class: 'lc-lt-grupo lc-lt-offbt', dataset: { a: 'lt-offline' }, on: { click: amb.seguro(() => { offAberto = !offAberto; pintar(dados, true); }) } },
      `${offAberto || f ? '▾' : '▸'} offline (${d.offline.length})`));
    if (offAberto || f) filhos.push(...d.offline.filter(casa).map(linha));
    let topo = 0;
    try { topo = corpo.scrollTop || 0; } catch { /* sem layout */ }
    corpo.replaceChildren(...filhos);
    try { corpo.scrollTop = topo; } catch { /* sem layout */ }
  }
  return { el, pintar, busca, estado: () => ({ filtro, offAberto }) };
}

// Uma conversa (parte de baixo do painel de chat). amb = {doc, seguro, enviar(texto) -> Promise<{ok, motivo, limpar?}>, aoInteragir(ev)}.
// O campo e o botão nascem uma vez (ARMADILHAS: campo recriado tira o foco no meio da digitação); repinta só as mensagens. A mesma
// view serve a todas as conversas 1:1 (etapa 1 de 2026-10-16): quem troca de conversa chama reiniciar() e repõe o rascunho no campo;
// enviar devolve limpar:false quando ele já trocou de conversa no meio do envio (o campo é o da outra: nem limpa nem mostra erro).
export function criarConversaView(amb, { placeholder = 'mensagem (Enter envia)', semMensagens = 'sem mensagens ainda' } = {}) {
  const { doc } = amb;
  let enviando = false, assinatura = '', mudo = false, erro = '';
  const ms = h('div', { doc, class: 'lc-lt-ms', dataset: { a: 'lt-msgs' } });
  const input = h('input', { doc, class: 'lc-lt-in', maxlength: String(TEXTO_MAX), autocomplete: 'off', dataset: { a: 'lt-texto' }, placeholder });
  const bt = h('button', { doc, class: 'lc-cp-btn lc-cp-prim lc-lt-env', dataset: { a: 'lt-enviar' } }, 'enviar');
  const bloq = h('div', { doc, class: 'lc-lt-bloq' }, '⛔ chat bloqueado pela Riot nesta conta: só leitura, sem envio');
  const en = h('div', { doc, class: 'lc-lt-en' }, input, bt);
  const el = h('div', { doc, class: 'lc-lt-conversa' }, ms, en);
  const enviar = async e => {
    if (e?.isTrusted === false || enviando || mudo) return;
    const texto = String(input.value || '').trim();
    if (!texto) return;
    if (texto.length > TEXTO_MAX) { erro = `mensagem longa demais (máx. ${TEXTO_MAX})`; pintarErro(); return; }
    enviando = true; bt.disabled = true;
    let r;
    try { r = await amb.enviar(texto); } finally { enviando = false; bt.disabled = mudo; }
    if (r?.ok) { if (r.limpar !== false && String(input.value || '').trim() === texto) input.value = ''; erro = ''; }
    else if (r?.limpar !== false) erro = `não enviou: ${r?.motivo || 'erro'}`; // limpar:false = o campo já é de outra conversa
    // (o erro do envio de A não pode aparecer na conversa de B: quem chamou avisa; revisão de 16/10/2026)
    pintarErro();
  };
  const pintarErro = () => { el.querySelector?.('.lc-lt-erro')?.remove(); if (erro) el.insertBefore(h('div', { doc, class: 'lc-lt-erro' }, erro), en); };
  input.addEventListener('keydown', amb.seguro(e => {
    e.stopPropagation?.(); // teclas do campo não vão para os atalhos da Riot
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault?.(); return enviar(e); }
    return undefined;
  }));
  bt.addEventListener('click', amb.seguro(e => enviar(e)));
  // linhas = [{id, eu, texto, quando, sis}] ou da sala do time [{id, quem, texto}]; desenhar(l) -> elemento; chave = de quem é a
  // conversa (a view é a mesma para todas: trocar de conversa sempre repinta)
  function pintar(linhas, { motivo = '', bloqueado = false, desenhar = null, chave = '' } = {}) {
    if (bloqueado !== mudo) {
      mudo = bloqueado;
      if (mudo) el.insertBefore(bloq, en); else bloq.remove();
    }
    input.disabled = mudo; bt.disabled = mudo || enviando;
    const sig = JSON.stringify([chave, motivo, (linhas || []).length, (linhas || []).at(-1)?.id ?? '', (linhas || []).at(-1)?.texto ?? '']);
    if (sig === assinatura) return;
    assinatura = sig;
    let noFim = true;
    try { noFim = !(ms.scrollHeight > 0) || ms.scrollHeight - ms.scrollTop - ms.clientHeight < 40; } catch { /* sem layout */ }
    const linha = desenhar || (l => (l.sis ? h('div', { doc, class: 'lc-lt-m lc-lt-sis' }, l.texto)
      : h('div', { doc, class: 'lc-lt-m' + (l.eu ? ' lc-lt-eu' : '') }, l.texto, h('small', { doc }, horaDe(l.quando)))));
    ms.replaceChildren(...(motivo ? [h('div', { doc, class: 'lc-lt-m lc-lt-sis' }, motivo)]
      : linhas && linhas.length ? linhas.map(linha) : [h('div', { doc, class: 'lc-lt-m lc-lt-sis' }, semMensagens)]));
    if (noFim) try { ms.scrollTop = 1e9; } catch { /* sem layout */ }
  }
  el.addEventListener('pointerdown', e => amb.aoInteragir?.(e), true);
  el.addEventListener('keydown', e => amb.aoInteragir?.(e), true);
  // outra conversa no mesmo campo: some o erro da anterior, troca o placeholder e o texto (o rascunho dela)
  function reiniciar({ placeholder: ph, texto = '' } = {}) {
    erro = ''; pintarErro(); assinatura = '';
    if (ph) input.placeholder = ph;
    input.value = texto;
  }
  return { el, input, bt, pintar, enviar, reiniciar, focar: () => { try { input.focus({ preventScroll: true }); } catch { /* sem DOM */ } } };
}

// Recentes (parte de cima do painel de chat; etapa 1 de 2026-10-16). amb = {doc, seguro, aoAbrir(r, ev)} -> {el, pintar(itens, {ativa, time})}.
// itens = verRecentes(...); time = {un} na seleção (a sala do time é a 1ª linha), null fora dela. As linhas só são recriadas quando
// algo delas muda (o relógio repinta a cada 1,5 s: linha recriada entre o pointerdown e o click perde o clique).
export function criarRecentes(amb) {
  const { doc } = amb;
  let assinatura = '';
  const el = h('div', { doc, class: 'lc-lt-rec', dataset: { a: 'lt-recentes' } });
  const abrir = r => amb.seguro(e => amb.aoAbrir?.(r, e));
  const linha = (r, ativa) => h('div', { doc, class: 'lc-lt-recente' + (r.k === ativa ? ' lc-lt-on' : '') + (r.un ? ' lc-lt-nova' : ''), dataset: { a: 'lt-recente', k: r.k },
    title: r.txt ? `${r.nome} · ${r.txt}` : r.nome, on: { click: abrir(r) } },
  avatar({ nome: r.nome, icone: r.icone, campeao: r.campeao, dot: r.dot }, doc),
  h('div', { doc, class: 'lc-lt-nm' }, h('span', { doc }, r.nome), h('small', { doc }, r.trecho || ' ')),
  h('span', { doc, class: 'lc-lt-rdir' }, h('small', { doc }, r.hora || ''), r.un ? h('span', { doc, class: 'lc-lt-un' }, r.un > 99 ? '99+' : String(r.un)) : null));
  const linhaTime = (t, ativa) => h('div', { doc, class: 'lc-lt-recente lc-lt-rtime' + (ativa === 'time' ? ' lc-lt-on' : '') + (t.un ? ' lc-lt-nova' : ''),
    dataset: { a: 'lt-recente', k: 'time' }, title: 'chat do seu time na seleção (só campeão e posição)', on: { click: abrir({ k: 'time', tipo: 'time' }) } },
  h('span', { doc, class: 'lc-lt-av lc-lt-avtime' }, '🗨'),
  h('div', { doc, class: 'lc-lt-nm' }, h('span', { doc }, 'sala do time'), h('small', { doc }, 'só campeão e posição de quem fala')),
  h('span', { doc, class: 'lc-lt-rdir' }, t.un ? h('span', { doc, class: 'lc-lt-un' }, t.un > 99 ? '99+' : String(t.un)) : null));
  function pintar(itens, { ativa = null, time = null } = {}) {
    const lista = Array.isArray(itens) ? itens : [];
    const sig = JSON.stringify([lista.map(r => [r.k, r.nome, r.trecho, r.hora, r.un, r.icone, r.dot, r.campeao, r.txt]), ativa, time ? time.un : null]);
    if (sig === assinatura) return;
    assinatura = sig;
    const filhos = [];
    if (time) filhos.push(linhaTime(time, ativa));
    filhos.push(...lista.map(r => linha(r, ativa)));
    if (!filhos.length) filhos.push(h('div', { doc, class: 'lc-lt-vazio' }, 'nenhuma conversa recente: abra uma pela lista de amigos (👥)'));
    let topo = 0;
    try { topo = el.scrollTop || 0; } catch { /* sem layout */ }
    el.replaceChildren(...filhos);
    try { el.scrollTop = topo; } catch { /* sem layout */ }
  }
  return { el, pintar };
}

// linha da sala do time: foto do campeão + posição (nunca nome)
export function linhaSalaTime(l, doc) {
  const q = l.quem;
  const rot = !q ? 'aliado' : q.eu ? 'você' : POS_PT[q.posicao] || 'aliado';
  return h('div', { doc, class: 'lc-lt-cm' + (q?.eu ? ' lc-lt-eu' : '') }, fotoCampeao(q?.campeao, { tam: 20, doc }),
    h('div', { doc, class: 'lc-lt-tx' }, h('b', { doc }, rot), ' ', l.texto));
}

// envio com o corpo do client; conversa 1:1 que ainda não existe: cria (corpo do client) e tenta uma vez
export async function enviarMensagem(lcu, { conv, pid, eu, texto, criarSeFaltar = true }) {
  const id = conv || pid;
  if (!id) return { ok: false, motivo: 'sem conversa' };
  const url = c => `/lol-chat/v1/conversations/${encodeURIComponent(c)}/messages`;
  let r = await lcu('POST', url(id), corpoMensagem(texto, eu));
  if (!r.ok && r.status === 404 && criarSeFaltar && !conv && pid) {
    const c = await lcu('POST', '/lol-chat/v1/conversations', { id: String(pid), type: 'chat' });
    if (!c.ok) return { ok: false, motivo: `o client não abriu a conversa (${c.status})` };
    r = await lcu('POST', url(pid), corpoMensagem(texto, eu));
  }
  return r.ok ? { ok: true } : { ok: false, motivo: `o client recusou (${r.status})` };
}

export const escTexto = esc; // reexport para quem monta string (nada aqui usa innerHTML)

export const CSS_CHAT_LATERAL = `
#lc-compacto .lc-lt-busca, #lc-compacto .lc-lt-in { width:100%; height:28px; margin:0; background:var(--lc-bg); border:1px solid var(--lc-linha); color:var(--lc-ouro2);
  padding:0 8px; font:inherit; font-size:12px; user-select:text; }
#lc-compacto .lc-lt-busca:focus, #lc-compacto .lc-lt-in:focus { outline:none; border-color:var(--lc-ouro-esc); }
#lc-compacto .lc-lt-buscacx { flex:none; padding:8px 10px 4px; }
#lc-compacto .lc-lt-lista { flex:1; min-height:0; overflow:auto; padding-bottom:8px; }
#lc-compacto .lc-lt-grupo { display:block; width:100%; text-align:left; background:none; border:none; font:inherit; font-size:10px; letter-spacing:.12em;
  text-transform:uppercase; color:var(--lc-mudo); padding:8px 12px 3px; }
#lc-compacto button.lc-lt-grupo { cursor:pointer; } #lc-compacto button.lc-lt-grupo:hover { color:var(--lc-ouro2); }
#lc-compacto .lc-lt-amigo { display:grid; grid-template-columns:30px 1fr auto; gap:8px; align-items:center; padding:5px 12px; cursor:pointer; border-left:2px solid transparent; }
#lc-compacto .lc-lt-amigo:hover { background:rgba(255,255,255,.03); }
#lc-compacto .lc-lt-amigo.lc-lt-on { background:rgba(10,200,185,.08); border-left-color:var(--lc-azul); }
#lc-compacto .lc-lt-av { position:relative; width:28px; height:28px; border-radius:50%; background:#253445 center/cover no-repeat; display:grid; place-items:center;
  font-size:11px; color:var(--lc-ouro2); border:1px solid #2c3a4a; }
#lc-compacto .lc-lt-av i { position:absolute; right:-2px; bottom:-2px; width:9px; height:9px; border-radius:50%; border:2px solid var(--lc-bg); }
#lc-compacto .lc-lt-nm { min-width:0; font-size:12.5px; color:var(--lc-ouro2); line-height:1.2; }
#lc-compacto .lc-lt-nm span { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#lc-compacto .lc-lt-nm small { display:block; font-size:11px; color:var(--lc-mudo); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#lc-compacto .lc-lt-nm small.jogo { color:#58b3ff; } #lc-compacto .lc-lt-nm small.fila { color:var(--lc-azul); }
#lc-compacto .lc-lt-dir { display:flex; gap:4px; align-items:center; }
#lc-compacto .lc-lt-un { background:var(--lc-verm); color:#fff; font-size:10px; font-weight:700; border-radius:8px; padding:0 5px; min-width:16px; height:16px;
  display:inline-grid; place-items:center; line-height:1; margin-left:6px; }
#lc-compacto .lc-lt-conv { background:none; border:1px solid var(--lc-ouro-esc); color:var(--lc-ouro); font:inherit; font-size:10.5px; height:20px; padding:0 6px; cursor:pointer; }
#lc-compacto .lc-lt-conv.lc-lt-off { border-color:var(--lc-linha); color:var(--lc-mudo); cursor:help; }
#lc-compacto .lc-lt-pedidos { display:flex; justify-content:space-between; align-items:center; width:calc(100% - 20px); margin:4px 10px;
  padding:6px 9px; background:none; border:1px dashed var(--lc-ouro-esc); color:var(--lc-ouro2); font:inherit; font-size:12px; cursor:pointer; text-align:left; }
#lc-compacto .lc-lt-pedidos span { color:var(--lc-ouro); font-size:11px; }
#lc-compacto .lc-lt-chat { flex:1; min-height:0; display:flex; flex-direction:column; }
#lc-compacto .lc-lt-rec { flex:1; min-height:0; overflow:auto; padding:4px 0; }
#lc-compacto .lc-lt-chat.lc-lt-com-conversa .lc-lt-rec { flex:0 0 33%; border-bottom:1px solid var(--lc-linha2); }
#lc-compacto .lc-lt-baixo { display:none; flex:1; min-height:0; flex-direction:column; }
#lc-compacto .lc-lt-chat.lc-lt-com-conversa .lc-lt-baixo { display:flex; }
#lc-compacto .lc-lt-ccab { height:38px; flex:none; display:flex; align-items:center; gap:8px; padding:0 8px 0 12px; border-bottom:1px solid var(--lc-linha2); background:#0b1520; }
#lc-compacto .lc-lt-ccorpo { flex:1; min-height:0; display:flex; flex-direction:column; }
#lc-compacto .lc-lt-recente { display:grid; grid-template-columns:30px 1fr auto; gap:8px; align-items:center; padding:5px 12px; cursor:pointer; border-left:2px solid transparent; }
#lc-compacto .lc-lt-recente:hover { background:rgba(255,255,255,.03); }
#lc-compacto .lc-lt-recente.lc-lt-on { background:rgba(10,200,185,.08); border-left-color:var(--lc-azul); }
#lc-compacto .lc-lt-recente.lc-lt-nova .lc-lt-nm small { color:#e8e2d0; }
#lc-compacto .lc-lt-rdir { display:flex; flex-direction:column; align-items:flex-end; gap:3px; }
#lc-compacto .lc-lt-rdir small { font-size:10.5px; color:var(--lc-mudo); }
#lc-compacto .lc-lt-avtime { background:rgba(10,200,185,.12); border-color:var(--lc-azul2); font-size:13px; }
#lc-compacto .lc-lt-vazio { padding:18px 12px; color:var(--lc-mudo); font-size:12px; }
#lc-compacto .lc-lt-conversa { flex:1; min-height:0; display:flex; flex-direction:column; }
#lc-compacto .lc-lt-ms { flex:1; min-height:0; overflow:auto; padding:10px; display:flex; flex-direction:column; gap:6px; user-select:text; }
#lc-compacto .lc-lt-m { max-width:85%; align-self:flex-start; background:#1a2129; border:1px solid #2a323c; padding:6px 9px; font-size:12.5px; color:#e8e2d0;
  overflow-wrap:anywhere; }
#lc-compacto .lc-lt-m small { display:block; font-size:10px; color:var(--lc-mudo); margin-top:2px; }
#lc-compacto .lc-lt-m.lc-lt-eu { align-self:flex-end; background:#14303a; border-color:#1d4b57; }
#lc-compacto .lc-lt-m.lc-lt-sis { align-self:center; background:none; border:none; color:var(--lc-mudo); font-style:italic; font-size:11px; }
#lc-compacto .lc-lt-cm { display:flex; gap:6px; align-items:flex-start; font-size:12px; line-height:1.3; color:#e8e2d0; }
#lc-compacto .lc-lt-cm b { color:#58b3ff; font-weight:600; } #lc-compacto .lc-lt-cm.lc-lt-eu b { color:var(--lc-ouro); }
#lc-compacto .lc-lt-tx { min-width:0; padding-top:2px; overflow-wrap:anywhere; }
#lc-compacto .lc-lt-en { flex:none; display:flex; gap:6px; padding:8px 10px; border-top:1px solid var(--lc-linha2); }
#lc-compacto .lc-lt-in:disabled { color:#6b6f76; border-color:#2a2d33; }
#lc-compacto .lc-lt-env { height:28px; padding:0 12px; display:inline-flex; align-items:center; }
#lc-compacto .lc-lt-bloq, #lc-compacto .lc-lt-erro { flex:none; font-size:11px; color:#ffb3bd; padding:4px 10px; background:rgba(232,64,87,.08); border-top:1px solid rgba(232,64,87,.3); }
`;
