// Lateral do client compacto (roadmap/2026-10-13-client-compacto.md, passo 13; parecer do Gabriel de 14/10/2026 ~20:00):
// - à DIREITA da coluna: lista de amigos (300 px) e o painel (360 px) com abas: conversas 1:1, a sala do time (só na seleção) e
//   o coach da seleção (📊, tela B2). Pedido dele (~17:00): "o próprio modo compacto ganhando espaço para a direita, mostrando a
//   lista. E se eu abrir esse chat com alguém, esse chat também expande mais para a direita. [...] posso fechar a lista".
// - à ESQUERDA: configurações do lol-client (⚙, tela B1; ajuste dele: "configurações pode expandir para a esquerda. não esqueça
//   de garantir que as janelas não se percam entre si ao serem abertas ou fechadas").
// A coluna fica parada na tela; quem decide a largura da janela é o roteador (index.js pedirLateral: estado único) e quem prende
// a janela ao monitor é compacto/geometria.js. Aqui: o que está aberto, o desenho e as leituras (só GET; escrita só por clique).
// Decisões do Gabriel (sem escolha = a recomendação do protótipo): (1) mensagem nova abre a conversa sozinha só se couber SEM
// mover a janela e nunca na seleção; (2) a lateral volta depois da partida; (3) configurações num painel (à esquerda).
// Importável no node (tools/teste-compacto-lateral.mjs): nada de DOM no topo; doc, LCU, relógio e geometria injetáveis.
import { h, estilo, campeoes as catalogoPadrao } from './comum.js';
import { verAmigos, lobbyParaConvite, pedidosRecebidos, criarListaAmigos, criarConversaView, lerConversa, enviarMensagem, ehConversaDireta,
  acharSalaTime, elencoTime, lerSalaTime, linhaSalaTime, CSS_CHAT_LATERAL } from './lateral-chat.js';
import { criarCoachView, modeloSelo, meuNaSessao, COACH_CADA_MS, CSS_COACH } from './lateral-coach.js';
import { criarConfigView, CSS_CONFIG } from './lateral-config.js';
import { larguraUtilCss, cabeSemMover } from './geometria.js';

export const LARG = { lista: 300, painel: 360, config: 360 };
export const MAX_CONVERSAS = 3;
export const FASES_ABRE_SOZINHA = ['None', 'Lobby', 'EndOfGame']; // as mesmas das janelas do coletor (chat_janelas.FASES_ABRE_SOZINHO)
export const PASSO_MS = 1500;
export const lateralLigada = cfg => !!cfg?.compacto?.ligado && cfg?.compacto?.chatLateral !== false;
export const conversaSozinha = cfg => cfg?.compacto?.conversaSozinha !== false;
const TITULO = { coach: '📊 coach da seleção', time: '🗨 sala do time' };

// estado -> o que aparece e as larguras (px CSS). util = largura útil do monitor em CSS; col = coluna da config.
// Monitor estreito: lista e painel dividem a mesma vaga (a conversa entra no lugar da lista, com ← para voltar).
export function layout(e, { util = Infinity, col = 420 } = {}) {
  let lista = !!e.lista, painel = (e.abas || []).length > 0, estreito = false;
  const config = !!e.config;
  const soma = () => col + (config ? LARG.config : 0) + (lista ? LARG.lista : 0) + (painel ? LARG.painel : 0);
  if (soma() > util && lista && painel) { estreito = true; if (e.vistaEstreita === 'lista') painel = false; else lista = false; }
  return { esq: config ? LARG.config : 0, dir: (lista ? LARG.lista : 0) + (painel ? LARG.painel : 0), lista, painel, config, estreito, total: soma(), cabe: soma() <= util };
}

const chaveConversa = pid => `c:${String(pid).toLowerCase()}`;

// rot() -> roteador ({pedirLarguraLateral...}); servicos: {champ, ...}; geometria: criarGeometria | null
export function criarLateral({
  cfg, rot, doc = globalThis.document, lcu, servicos = {}, geometria = null, definir = () => {},
  avisar = () => {}, log = () => {}, repetir = setInterval, pararRepetir = clearInterval, agora = () => Date.now(),
  campeoes = catalogoPadrao, abrirConfigRiot = () => {}, aoMudar = () => {},
}) {
  const e = { lista: false, config: false, abas: [], ativa: null, vistaEstreita: 'painel', lembrarCoach: false };
  const st = { fase: null, efetivo: 'expandido', partes: null, eu: null, euEm: 0, amigos: null, conversas: [], lobby: null, pedidos: 0, pedidosEm: 0,
    convidados: new Map(), vistos: new Map(), primeiraLeitura: true, sessao: null, sala: null, salaLinhas: [], salaVistas: 0, mudo: false,
    ativaPorMim: null, timer: null, volta: 0, lendo: false, nomes: new Map(), tamanhoAntes: null };
  const conversas = new Map(); // k -> {view, linhas, motivo, lidaPara}
  let configView = null, coachView = null, timeView = null, listaView = null, painelEl = null, painelCab = null, painelAbas = null, painelCorpo = null;

  const falha = (onde, err) => { log(`lateral: ${onde}`, err); try { avisar(`a lateral falhou (${onde}): ${err?.message || err}`, true); } catch { /* segue */ } };
  const seguro = (fn, onde = 'clique') => (...a) => {
    try { const r = fn(...a); if (r && typeof r.then === 'function') r.catch(err => falha(onde, err)); return r; } catch (err) { falha(onde, err); return undefined; }
  };
  const roteador = () => { try { return rot?.() || null; } catch { return null; } };
  const col = () => roteador()?.medidasJanela?.().col || 420;
  const util = () => { const t = geometria?.tela?.(); return larguraUtilCss(t) ?? Infinity; };
  const L = () => layout(e, { util: util(), col: col() });
  const naSelecao = () => st.fase === 'ChampSelect';
  const compactoAVista = () => st.efetivo === 'compacto';

  // ---------- desenho ----------
  const garantirDom = () => {
    if (painelEl) return;
    estilo('lc-lt-estilo', CSS_LATERAL, doc);
    listaView = criarListaAmigos({ doc, seguro, aoAmigo: a => abrirConversa(a), aoConvidar: (a, ev) => convidar(a, ev), aoPedidos: () => pedidosNoClient(),
      aoTime: () => abrirTime(), aoFechar: () => { e.lista = false; render(); } });
    painelCab = h('div', { doc, class: 'lc-lt-tit' });
    painelAbas = h('div', { doc, class: 'lc-lt-abas' });
    painelCorpo = h('div', { doc, class: 'lc-lt-pcorpo' });
    painelEl = h('section', { doc, class: 'lc-lt-pn lc-lt-painel', dataset: { painel: 'painel' } },
      h('header', { doc, class: 'lc-lt-cab' },
        h('button', { doc, class: 'lc-lt-volta', title: 'voltar à lista', dataset: { a: 'lt-voltar' }, on: { click: seguro(() => { e.vistaEstreita = 'lista'; render(); }) } }, '←'),
        painelCab,
        h('button', { doc, class: 'lc-lt-x', title: 'fechar esta aba', dataset: { a: 'lt-fechar-aba' }, on: { click: seguro(() => fecharAba(e.ativa)) } }, '✕')),
      painelAbas, painelCorpo);
    configView = criarConfigView({ doc, cfg, definir, aoConfigRiot: seguro(() => configRiot()), aoFechar: seguro(() => { e.config = false; render(); }) });
    coachView = criarCoachView({ doc });
    timeView = criarConversaView({ doc, seguro, enviar: texto => enviarSala(texto), aoInteragir: () => { st.salaVistas = st.salaLinhas.length; } },
      { placeholder: 'mensagem para o time (Enter envia)', semMensagens: 'ninguém falou ainda' });
  };
  // troca os filhos só se mudaram (mover um nó tira o foco do campo que ele está digitando)
  const trocar = (pai, nos) => {
    if (!pai) return;
    const atuais = [...(pai.children || [])];
    if (atuais.length === nos.length && atuais.every((n, i) => n === nos[i])) return;
    pai.replaceChildren(...nos);
  };
  const aba = k => e.abas.find(a => a.k === k) || null;

  // abas e cabeçalho só são recriados quando mudam (revisão de 14/10/2026: o relógio repintava a cada 1,5 s e um clique que caía
  // entre o pointerdown e o click de um botão recriado se perdia)
  let assinaturaPainel = '';
  function pintarPainel(lay) {
    const a = aba(e.ativa) || e.abas[e.abas.length - 1] || null;
    if (a && e.ativa !== a.k) e.ativa = a.k;
    painelEl.classList.toggle('lc-lt-estreito', !!lay.estreito);
    if (!a) { assinaturaPainel = ''; painelCab.replaceChildren(); painelAbas.replaceChildren(); trocar(painelCorpo, []); return; }
    let corpo;
    if (a.tipo === 'conversa') corpo = viewConversa(a).view.el;
    else if (a.tipo === 'coach') corpo = coachView.el;
    else corpo = timeView.el;
    const assinatura = JSON.stringify([a.k, a.txt || '', e.abas.map(x => [x.k, x.un || 0, x.nome || ''])]);
    if (assinatura === assinaturaPainel && painelAbas.children.length === (e.abas.length > 1 ? e.abas.length : 0)) { trocar(painelCorpo, [corpo]); return; }
    assinaturaPainel = assinatura;
    painelCab.replaceChildren(h('b', { doc }, a.tipo === 'conversa' ? a.nome : TITULO[a.tipo]),
      h('small', { doc }, a.tipo === 'conversa' ? (a.txt || 'conversa') : a.tipo === 'coach' ? 'selo completo · troca com o teu hover' : 'só campeão e posição de quem fala'));
    painelAbas.replaceChildren(...(e.abas.length > 1 ? e.abas.map(x => h('button', { doc, class: 'lc-lt-aba' + (x.k === a.k ? ' lc-lt-on' : ''), dataset: { a: 'lt-aba', k: x.k },
      on: { click: seguro(ev => { if (ev?.target?.closest?.('[data-a="lt-fechar-x"]')) return; e.ativa = x.k; render(); }) } },
    h('span', { doc }, x.tipo === 'conversa' ? x.nome : x.tipo === 'coach' ? '📊 coach' : '🗨 time'),
    x.un ? h('i', { doc, class: 'lc-lt-un' }, String(x.un)) : null,
    h('b', { doc, class: 'lc-lt-ax', title: 'fechar', dataset: { a: 'lt-fechar-x' }, on: { click: seguro(() => fecharAba(x.k)) } }, '×'))) : []));
    trocar(painelCorpo, [corpo]);
  }

  function marcarClasses() {
    try {
      const html = doc.documentElement;
      html.classList.toggle('lc-lt-lista', !!e.lista);
      html.classList.toggle('lc-lt-config', !!e.config);
      html.classList.toggle('lc-lt-coach', !!aba('coach'));
    } catch { /* sem DOM */ }
  }

  // aplica o estado: DOM dos painéis + larguras ao roteador (que muda a janela se o compacto está à vista). opcoes: as da
  // abertura automática ({soSemMover, aoRecusar}, roteador.pedirLateral)
  function render(opcoes) {
    const lay = L();
    if (st.partes) {
      garantirDom();
      trocar(st.partes.esq, lay.config ? [configView.el] : []);
      trocar(st.partes.dir, [lay.lista ? listaView.el : null, lay.painel ? painelEl : null].filter(Boolean));
      if (lay.config && !configView.el.dataset.pintado) { configView.el.dataset.pintado = '1'; configView.pintar(); }
      if (lay.painel) pintarPainel(lay);
      if (lay.lista) listaView.pintar(st.amigos, false, naSelecao() ? { naoLidas: Math.max(0, st.salaLinhas.length - st.salaVistas) } : null);
    }
    marcarClasses();
    roteador()?.pedirLateral?.({ esq: lay.esq, dir: lay.dir }, opcoes);
    conferirAtiva(lay);
    return lay;
  }

  // a conversa que ele marcou como lida (PUT active) só segue ativa no client enquanto está À VISTA: aba ativa, painel aberto e
  // compacto na tela. Trocou de aba, fechou o painel, foi para a partida, minimizou: DELETE (revisão de 14/10/2026: senão as
  // mensagens dela chegavam já lidas, a bolha ficava em 0 e ele nunca via)
  function conferirAtiva(lay = L()) {
    if (!st.ativaPorMim) return;
    const a = lay.painel ? aba(e.ativa) : null;
    const aVista = compactoAVista() && a?.tipo === 'conversa' && (a.conv || a.pid) === st.ativaPorMim;
    if (!aVista) limparAtiva();
  }

  // abriu um lado e não cabe no monitor com o outro: o que ele acabou de abrir vence, o outro fecha (avisa). Nem sozinho cabe:
  // não abre (avisa). -> true se ficou aberto
  function caber(lado) {
    const u = util();
    if (!Number.isFinite(u)) return true;
    let lay = layout(e, { util: u, col: col() });
    if (lay.cabe) return true;
    // conversas.clear(): reabrir o mesmo amigo depois cria a conversa de novo (antes ficava a view velha, presa à aba velha)
    if (lado === 'esq' && (e.lista || e.abas.length)) { e.lista = false; limparAtiva(); e.abas = []; e.ativa = null; conversas.clear(); avisar('não cabe tudo ao lado no teu monitor: fechei o chat para abrir as configurações'); }
    else if (lado === 'dir' && e.config) { e.config = false; avisar('não cabe tudo ao lado no teu monitor: fechei as configurações'); }
    lay = layout(e, { util: u, col: col() });
    if (lay.cabe) return true;
    return false;
  }

  // ---------- ações (clique dele) ----------
  function alternarLista() {
    if (!lateralLigada(cfg)) return false;
    e.lista = !e.lista;
    if (e.lista) { e.vistaEstreita = 'lista'; if (!caber('dir')) { e.lista = false; avisar('a lista de amigos não cabe ao lado neste monitor: usa o client normal', true); } }
    render();
    if (e.lista) lerAmigos().catch(err => falha('amigos', err));
    return true;
  }
  function abrirConversa(a) {
    if (!lateralLigada(cfg) || !a?.pid) return false;
    const k = chaveConversa(a.pid);
    let x = aba(k);
    if (!x) {
      x = { k, tipo: 'conversa', pid: a.pid, conv: a.conv || '', nome: a.nome || 'amigo', txt: a.txt || '', un: a.un || 0 };
      e.abas.push(x);
      podarConversas(k);
    } else x.auto = false; // ele abriu: a recusa da abertura automática não fecha mais esta aba
    e.ativa = k; e.vistaEstreita = 'painel';
    if (!caber('dir')) { fecharAba(k, { semRender: true }); avisar('a conversa não cabe ao lado neste monitor: usa o client normal', true); }
    render();
    lerConversaAba(x).catch(err => falha('conversa', err));
    const v = conversas.get(k)?.view;
    v?.focar();
    return true;
  }
  // até MAX_CONVERSAS conversas: a 4ª fecha a mais antiga que não é a ativa
  function podarConversas(manter) {
    const cs = e.abas.filter(x => x.tipo === 'conversa');
    while (cs.length > MAX_CONVERSAS) {
      const velha = cs.find(x => x.k !== manter && x.k !== e.ativa) || cs[0];
      cs.splice(cs.indexOf(velha), 1);
      fecharAba(velha.k, { semRender: true });
    }
  }
  function fecharAba(k, { semRender = false } = {}) {
    const x = aba(k);
    if (!x) return;
    if (x.tipo === 'conversa') { if (st.ativaPorMim && st.ativaPorMim === (x.conv || x.pid)) limparAtiva(); conversas.delete(k); }
    if (x.tipo === 'coach') e.lembrarCoach = false;
    e.abas = e.abas.filter(y => y.k !== k);
    if (e.ativa === k) e.ativa = e.abas.length ? e.abas[e.abas.length - 1].k : null;
    if (!e.abas.length && e.lista) e.vistaEstreita = 'lista';
    if (!semRender) render();
  }
  function alternarCoach() {
    if (!naSelecao()) { avisar('o coach da seleção só existe na seleção de campeões'); return false; }
    if (aba('coach')) { fecharAba('coach'); return true; }
    e.abas.push({ k: 'coach', tipo: 'coach' });
    e.ativa = 'coach'; e.lembrarCoach = true; e.vistaEstreita = 'painel';
    if (!caber('dir')) { fecharAba('coach', { semRender: true }); avisar('o coach não cabe ao lado neste monitor', true); }
    render();
    lerCoach().catch(err => falha('coach', err));
    return true;
  }
  function abrirTime() {
    if (!naSelecao()) return false;
    if (!aba('time')) e.abas.push({ k: 'time', tipo: 'time' });
    e.ativa = 'time'; e.vistaEstreita = 'painel';
    if (!caber('dir')) { fecharAba('time', { semRender: true }); avisar('a sala do time não cabe ao lado neste monitor', true); }
    render();
    lerSala().catch(err => falha('sala do time', err));
    timeView?.focar();
    return true;
  }
  function alternarConfig() {
    e.config = !e.config;
    if (e.config) {
      if (configView) delete configView.el.dataset.pintado;
      if (!caber('esq')) { e.config = false; avisar('as configurações não cabem ao lado neste monitor: usa o client normal', true); }
    }
    render();
    return true;
  }
  function configRiot() {
    abrirConfigRiot();
  }
  // pedidos de amizade: aceitar/recusar é no client normal (expande)
  function pedidosNoClient() { roteador()?.expandir?.(); avisar('pedidos de amizade: aceita ou recusa no client normal'); }

  async function convidar(a, ev) {
    if (ev?.isTrusted === false) return;
    if (!a?.convidar?.ok) { avisar(a?.convidar?.motivo || 'não dá para convidar agora', true); return; }
    st.convidados.set(a.pid, agora());
    pintarLista();
    const r = await lcu('POST', '/lol-lobby/v2/lobby/invitations', [{ toSummonerId: a.summonerId }]);
    if (r.ok) avisar(`convite enviado para ${a.nome}`);
    else { st.convidados.delete(a.pid); avisar(`convite não saiu (${r.status})`, true); }
    lerAmigos().catch(() => {});
  }

  // "lida": a conversa vira a ativa do client (PUT /lol-chat/v1/conversations/active {id}, setActive da Riot) só depois de um
  // clique ou tecla DELE na conversa à vista; fechar a aba devolve (DELETE, o mesmo da Riot)
  function marcarLida(x, ev) {
    if (ev && ev.isTrusted === false) return;
    const id = x.conv || '';
    if (!id || !compactoAVista() || e.ativa !== x.k) return;
    const c = conversas.get(x.k);
    if (st.ativaPorMim === id && c?.lidaPara === (x.un || 0)) return;
    st.ativaPorMim = id;
    if (c) c.lidaPara = x.un || 0;
    x.un = 0;
    lcu('PUT', '/lol-chat/v1/conversations/active', { id }).catch(() => {});
  }
  function limparAtiva() {
    if (!st.ativaPorMim) return;
    st.ativaPorMim = null;
    lcu('DELETE', '/lol-chat/v1/conversations/active').catch(() => {});
  }

  // ---------- leituras (só GET) ----------
  const eu = async () => {
    if (st.eu && agora() - st.euEm < 300000) return st.eu;
    const r = await lcu('GET', '/lol-chat/v1/me');
    if (r.ok && r.json && typeof r.json === 'object') { st.eu = { id: r.json.id, pid: r.json.pid, puuid: r.json.puuid, summonerId: r.json.summonerId }; st.euEm = agora(); }
    return st.eu;
  };
  async function lerConversas() {
    const r = await lcu('GET', '/lol-chat/v1/conversations');
    if (!r.ok || !Array.isArray(r.json)) return null;
    // da lista só o que a lateral usa (salas de grupo: só id e type; password e mucJwtDto nunca ficam)
    st.conversas = r.json.filter(c => c && typeof c === 'object').map(c => (ehConversaDireta(c)
      ? { id: String(c.id), pid: String(c.pid || c.id), type: 'chat', unreadMessageCount: Number(c.unreadMessageCount) || 0, gameName: c.gameName || c.name || '',
        lastMessage: c.lastMessage && typeof c.lastMessage === 'object' ? { fromId: c.lastMessage.fromId, fromPid: c.lastMessage.fromPid, fromPuuid: c.lastMessage.fromPuuid } : null }
      : { id: String(c.id ?? ''), type: String(c.type ?? '') }));
    for (const x of e.abas) if (x.tipo === 'conversa') {
      const c = st.conversas.find(y => y.type === 'chat' && y.pid.toLowerCase() === String(x.pid).toLowerCase());
      if (c) { x.conv = c.id; x.un = c.unreadMessageCount; }
    }
    return st.conversas;
  }
  async function lerAmigos() {
    const [f, l] = await Promise.all([lcu('GET', '/lol-chat/v1/friends'), lcu('GET', '/lol-lobby/v2/lobby'), lerConversas()]);
    if (agora() - st.pedidosEm > 15000) {
      st.pedidosEm = agora();
      const p = await lcu('GET', '/lol-chat/v2/friend-requests');
      if (p.ok) st.pedidos = pedidosRecebidos(p.json);
    }
    st.lobby = lobbyParaConvite(l);
    if (!f.ok || !Array.isArray(f.json)) st.amigos = { ok: false, motivo: f.status === 0 ? 'o client não respondeu' : `não li os amigos (${f.status})` };
    else {
      const abertas = new Set(e.abas.filter(x => x.tipo === 'conversa').map(x => x.pid));
      st.amigos = { ok: true, pedidos: st.pedidos, ...verAmigos({ amigos: f.json, conversas: st.conversas, lobby: st.lobby, convidados: st.convidados, abertas, agoraMs: agora() }) };
      // status de quem tem aba aberta (o cabeçalho da conversa)
      for (const x of e.abas) if (x.tipo === 'conversa') { const a = [...st.amigos.online, ...st.amigos.offline].find(y => y.pid === x.pid); if (a) x.txt = a.txt; }
    }
    pintarLista();
  }
  const pintarLista = () => { if (st.partes && listaView && L().lista) listaView.pintar(st.amigos, false, naSelecao() ? { naoLidas: Math.max(0, st.salaLinhas.length - st.salaVistas) } : null); };

  function viewConversa(x) {
    let c = conversas.get(x.k);
    if (!c) {
      c = { linhas: [], motivo: 'carregando…', lidaPara: -1, bloqueado: false };
      c.view = criarConversaView({ doc, seguro,
        enviar: async texto => { const r = await enviarMensagem(lcu, { conv: x.conv, pid: x.pid, eu: await eu(), texto }); if (r.ok) { await lerConversas(); await lerConversaAba(x); } return r; },
        aoInteragir: ev => { if (ev?.isTrusted !== false) marcarLida(x, ev); } }, { placeholder: `mensagem para ${x.nome} (Enter envia)` });
      conversas.set(x.k, c);
    }
    return c;
  }
  async function lerConversaAba(x) {
    const c = viewConversa(x);
    if (!x.conv) { c.motivo = ''; c.linhas = []; c.view.pintar([], { bloqueado: st.mudo }); return; }
    const [m, euAgora] = await Promise.all([lcu('GET', `/lol-chat/v1/conversations/${encodeURIComponent(x.conv)}/messages`), eu()]);
    if (m.status === 404) { c.linhas = []; c.motivo = ''; }
    else if (!m.ok) c.motivo = `não li a conversa (${m.status})`;
    else { c.linhas = lerConversa(m.json, euAgora); c.motivo = ''; }
    c.view.pintar(c.linhas, { motivo: c.motivo, bloqueado: st.mudo });
  }
  async function lerMudo() {
    const quem = await eu();
    if (!quem?.puuid) return;
    const r = await lcu('GET', '/lol-chat/v1/player-mutes');
    st.mudo = !!(r.ok && r.json?.[quem.puuid]?.isSystemMuted === true);
  }
  async function lerSessao() {
    const r = await lcu('GET', '/lol-champ-select/v1/session');
    st.sessao = r.ok && r.json && typeof r.json === 'object' ? r.json : null;
    return st.sessao;
  }
  async function lerSala() {
    if (!naSelecao()) return;
    const [lista, sess, quem] = await Promise.all([lerConversas(), lerSessao(), eu()]);
    const sala = acharSalaTime(lista || st.conversas, sess);
    if (!sala) { st.sala = null; st.salaLinhas = []; timeView?.pintar([], { motivo: 'a sala do time ainda não abriu (ou não sei qual é)', bloqueado: true }); return; }
    if (st.sala?.id !== sala.id) { st.sala = sala; st.salaVistas = 0; }
    const m = await lcu('GET', `/lol-chat/v1/conversations/${encodeURIComponent(sala.id)}/messages`);
    if (!m.ok) { timeView?.pintar(st.salaLinhas, { motivo: m.status === 404 ? 'a sala do time fechou' : `não li a sala (${m.status})`, bloqueado: st.mudo }); return; }
    st.salaLinhas = lerSalaTime(m.json, elencoTime(sess), quem);
    if (e.ativa === 'time' && L().painel) st.salaVistas = st.salaLinhas.length;
    timeView?.pintar(st.salaLinhas, { bloqueado: st.mudo, desenhar: l => linhaSalaTime(l, doc) });
    const t = aba('time');
    if (t) t.un = Math.max(0, st.salaLinhas.length - st.salaVistas);
  }
  async function enviarSala(texto) {
    if (!st.sala) return { ok: false, motivo: 'sem sala do time' };
    const r = await enviarMensagem(lcu, { conv: st.sala.id, eu: await eu(), texto, criarSeFaltar: false });
    if (r.ok) await lerSala();
    return r;
  }
  async function lerCoach() {
    if (!naSelecao() || !aba('coach')) return;
    const sess = await lerSessao();
    const champ = servicos.champ;
    const meu = meuNaSessao(sess);
    if (meu && champ && typeof champ.partidas === 'function' && champ.partidas() === null && typeof champ.lerHistorico === 'function' && !st.pediuHist) {
      st.pediuHist = true; Promise.resolve().then(() => champ.lerHistorico()).catch(() => {});
    }
    if (meu && typeof champ?.lerCoach === 'function') {
      const c = champ.coach?.() || {};
      if (c.campeao !== meu.championId || agora() - (c.em || 0) > COACH_CADA_MS) await Promise.resolve(champ.lerCoach(meu.championId)).catch(() => {});
    }
    let nomes = st.nomes;
    try { nomes = await campeoes(); } catch { /* sem catálogo: id */ }
    if (nomes && nomes.size) st.nomes = nomes;
    const nome = id => st.nomes.get?.(Number(id))?.nome || `campeão ${id}`;
    const partidas = typeof champ?.partidas === 'function' ? champ.partidas() : null;
    const est = meu && partidas && typeof champ?.estatisticas === 'function' ? champ.estatisticas(meu.championId, meu.posicao) : null;
    const falhou = !!champ?.estado?.()?.falhou;
    coachView?.pintar(modeloSelo({ sessao: sess, est, histN: partidas?.length || 0, histErro: falhou, coach: champ?.coach?.() || null, nome,
      traumas: cfg.traumas?.ligado !== false, fila: roteador()?.estado?.().info?.fila ?? null, temColetor: typeof champ?.lerCoach === 'function' }));
  }

  // mensagem nova sem aba (decisão 1 do Gabriel): abre a conversa sozinha só com o compacto à vista, fora da seleção (lobby,
  // início, pós-jogo), com a chave ligada e se couber SEM mover a janela. Nunca dá foco. Senão só conta (bolha e lista).
  function talvezAbrirSozinha(lista) {
    const meus = new Set([st.eu?.id, st.eu?.pid, st.eu?.puuid].filter(Boolean).map(String));
    const novas = [];
    for (const c of lista.filter(x => x.type === 'chat')) {
      const antes = st.vistos.get(c.id);
      st.vistos.set(c.id, c.unreadMessageCount);
      if (st.primeiraLeitura || antes === undefined || c.unreadMessageCount <= antes) continue;
      const lm = c.lastMessage || {};
      if ([lm.fromId, lm.fromPid, lm.fromPuuid].filter(Boolean).some(v => meus.has(String(v)))) continue;
      if (aba(chaveConversa(c.pid))) continue;
      novas.push(c);
    }
    st.primeiraLeitura = false;
    if (!novas.length || !lateralLigada(cfg) || !conversaSozinha(cfg) || !compactoAVista() || !FASES_ABRE_SOZINHA.includes(st.fase)) return false;
    // já há MAX_CONVERSAS abertas: só conta (abrir sozinha fecharia uma conversa que ELE abriu; revisão de 14/10/2026)
    if (e.abas.filter(y => y.tipo === 'conversa').length >= MAX_CONVERSAS) { log('lateral: mensagem nova só conta (conversas no máximo)'); return false; }
    const c = novas[novas.length - 1];
    const antes = L();
    const x = { k: chaveConversa(c.pid), tipo: 'conversa', pid: c.pid, conv: c.id, nome: c.gameName || 'amigo', txt: '', un: c.unreadMessageCount, auto: true };
    e.abas.push(x);
    const depois = L();
    const t = geometria?.tela?.();
    const semMudarLargura = depois.dir === antes.dir && depois.esq === antes.esq;
    const cabe = semMudarLargura || (depois.cabe && depois.esq === antes.esq && cabeSemMover(t, depois.total));
    if (!cabe) { e.abas.pop(); log('lateral: mensagem nova não abre sozinha (não cabe sem mover a janela)'); return false; }
    const ativaAntes = e.ativa;
    if (!e.ativa || !aba(e.ativa)) e.ativa = x.k;
    log('lateral: mensagem nova abriu a conversa ao lado');
    // a conta acima usa a última tela lida; a geometria confere com a tela RELIDA na hora de aplicar e, se teria de mover a
    // janela (ele arrastou no meio), recusa: a aba sai e a largura volta (decisão 1 garantida, não só estimada)
    render({ soSemMover: !semMudarLargura, aoRecusar: () => desfazerAuto(x.k, ativaAntes) });
    lerConversaAba(x).catch(() => {});
    return true;
  }
  // a geometria recusou a abertura automática: tira a aba que abriu sozinha (se ele ainda não mexeu nela) e volta a largura
  function desfazerAuto(k, ativaAntes) {
    const x = aba(k);
    if (!x || (x.tipo === 'conversa' && !x.auto)) return;
    e.abas = e.abas.filter(y => y.k !== k);
    if (x.tipo === 'conversa') conversas.delete(k);
    if (e.ativa === k) e.ativa = aba(ativaAntes) ? ativaAntes : (e.abas.length ? e.abas[e.abas.length - 1].k : null);
    log('lateral: a janela teria de andar, a aba aberta sozinha saiu');
    render();
  }

  // relógio da lateral: só com o compacto à vista
  async function volta() {
    if (st.lendo || !compactoAVista()) return;
    st.lendo = true;
    try {
      st.volta++;
      const lay = L();
      const a = lay.painel ? aba(e.ativa) : null;
      if (st.volta % 4 === 1) await lerMudo().catch(() => {});
      if (a?.tipo === 'conversa') await lerConversaAba(a);
      if (a?.tipo === 'time') await lerSala();
      if (naSelecao() && !a?.tipo?.startsWith?.('time') && lay.lista && st.volta % 2 === 0) await lerSala();
      if (a?.tipo === 'coach' && st.volta % 2 === 0) await lerCoach();
      if (lay.lista && st.volta % 2 === 0) await lerAmigos();
      else if (st.volta % 3 === 0) { await eu(); const lista = await lerConversas(); if (lista) talvezAbrirSozinha(lista); }
      if (lay.lista && st.volta % 2 === 0) talvezAbrirSozinha(st.conversas);
      if (lay.painel) pintarPainel(lay);
    } catch (err) { log('lateral: leitura', err); } finally { st.lendo = false; }
  }
  const ligarRelogio = () => { if (!st.timer) st.timer = repetir(() => { volta(); }, PASSO_MS); };
  const pararRelogio = () => { if (st.timer) { pararRepetir(st.timer); st.timer = null; } };

  return {
    // ganchos do roteador (index.js)
    anexar(partes) { if (!partes) return; st.partes = partes; render(); },
    aoEfetivo(efetivo) {
      st.efetivo = efetivo;
      if (efetivo === 'compacto') { ligarRelogio(); volta(); }
      else { pararRelogio(); st.partes = null; limparAtiva(); }
    },
    // a janela some (o "–" dela, visibilitychange oculto): a conversa marcada como lida deixa de ser a ativa do client
    aoOculto() { limparAtiva(); },
    aoFase(fase) {
      const antes = st.fase;
      st.fase = fase;
      if (fase !== 'ChampSelect') {
        if (aba('coach')) e.lembrarCoach = true;
        const tinha = e.abas.length;
        e.abas = e.abas.filter(x => x.tipo !== 'coach' && x.tipo !== 'time');
        if (!aba(e.ativa)) e.ativa = e.abas.length ? e.abas[e.abas.length - 1].k : null;
        st.sala = null; st.salaLinhas = []; st.salaVistas = 0; st.sessao = null;
        if (tinha !== e.abas.length) render();
      } else if (antes !== 'ChampSelect' && e.lembrarCoach && !aba('coach')) {
        // ele deixou o coach aberto na seleção anterior: volta aberto, só se couber sem mover a janela (decisão 1 vale aqui)
        const lay0 = L();
        e.abas.push({ k: 'coach', tipo: 'coach' });
        const lay1 = L();
        const t = geometria?.tela?.();
        const igual = lay1.dir === lay0.dir;
        if (igual || (lay1.cabe && cabeSemMover(t, lay1.total))) {
          const ativaAntes = e.ativa;
          e.ativa = 'coach';
          // a geometria confere com a tela relida; teria de mover = o coach não volta sozinho (fica lembrado para o 📊)
          render({ soSemMover: !igual, aoRecusar: () => desfazerAuto('coach', ativaAntes) });
        } else e.abas.pop();
      }
    },
    sincronizar() {
      if (!lateralLigada(cfg)) {
        const tinha = e.lista || e.abas.some(x => x.tipo === 'conversa' || x.tipo === 'time');
        e.lista = false;
        for (const x of e.abas.filter(y => y.tipo === 'conversa' || y.tipo === 'time')) fecharAba(x.k, { semRender: true });
        if (tinha) render();
      }
      if (e.config && configView && st.partes) configView.pintar();
    },
    // botões das telas (💬, ⚙, 📊) e testes
    ligada: () => lateralLigada(cfg),
    alternarLista: seguro(alternarLista), abrirConversa: seguro(abrirConversa), fecharAba: seguro(k => fecharAba(k)), alternarCoach: seguro(alternarCoach),
    abrirTime: seguro(abrirTime), alternarConfig: seguro(alternarConfig), voltarLista: seguro(() => { e.vistaEstreita = 'lista'; render(); }),
    estado: () => ({ ...e, abas: e.abas.map(x => ({ ...x })), layout: L(), fase: st.fase, efetivo: st.efetivo, ativaPorMim: st.ativaPorMim }),
    layout: L, volta, lerAmigos, lerConversas, talvezAbrirSozinha,
  };
}

export const CSS_LATERAL = `
#lc-compacto .lc-lt-pn { height:100%; display:flex; flex-direction:column; min-width:0; background:#050d17; border-left:1px solid var(--lc-linha2);
  border-right:1px solid var(--lc-linha2); color:var(--lc-txt); }
#lc-compacto .lc-lt-amigos { width:300px; flex:none; }
#lc-compacto .lc-lt-painel { width:360px; flex:none; }
#lc-compacto .lc-lt-cfg { width:360px; flex:none; }
#lc-compacto .lc-lt-cab { height:46px; flex:none; display:flex; align-items:center; gap:8px; padding:0 8px 0 12px; border-bottom:1px solid var(--lc-linha2);
  background:rgba(1,10,19,.85); }
#lc-compacto .lc-lt-tit { flex:1; min-width:0; display:flex; flex-direction:column; line-height:1.2; }
#lc-compacto .lc-lt-tit b { color:var(--lc-ouro2); font-size:13px; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#lc-compacto .lc-lt-tit small { color:var(--lc-mudo); font-size:11px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#lc-compacto .lc-lt-x, #lc-compacto .lc-lt-volta { width:24px; height:24px; flex:none; background:none; border:none; color:var(--lc-mudo); font:inherit; font-size:13px; cursor:pointer; }
#lc-compacto .lc-lt-x:hover, #lc-compacto .lc-lt-volta:hover { color:var(--lc-ouro2); }
#lc-compacto .lc-lt-volta { display:none; }
#lc-compacto .lc-lt-painel.lc-lt-estreito .lc-lt-volta { display:inline-block; }
#lc-compacto .lc-lt-abas { flex:none; display:flex; gap:2px; padding:4px 6px 0; border-bottom:1px solid var(--lc-linha2); overflow:hidden; }
#lc-compacto .lc-lt-abas:empty { display:none; }
#lc-compacto .lc-lt-aba { display:flex; align-items:center; gap:4px; max-width:130px; padding:4px 6px; background:none; border:1px solid transparent; border-bottom:none;
  color:var(--lc-mudo); font:inherit; font-size:11.5px; cursor:pointer; white-space:nowrap; }
#lc-compacto .lc-lt-aba span { overflow:hidden; text-overflow:ellipsis; }
#lc-compacto .lc-lt-aba.lc-lt-on { color:var(--lc-ouro2); border-color:var(--lc-linha2); background:#0b1520; }
#lc-compacto .lc-lt-aba .lc-lt-un { margin-left:0; }
#lc-compacto .lc-lt-ax { font-weight:400; color:var(--lc-mudo); padding:0 2px; } #lc-compacto .lc-lt-ax:hover { color:var(--lc-ouro2); }
#lc-compacto .lc-lt-pcorpo { flex:1; min-height:0; display:flex; flex-direction:column; }
html.lc-lt-lista #lc-compacto [data-a="chat"], html.lc-lt-config #lc-compacto [data-a="config"], html.lc-lt-coach #lc-compacto [data-a="coach"] {
  border-color:var(--lc-azul); box-shadow:0 0 0 1px rgba(10,200,185,.35) inset; }
` + CSS_CHAT_LATERAL + CSS_COACH + CSS_CONFIG;
