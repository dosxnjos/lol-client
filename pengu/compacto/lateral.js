// Lateral do client compacto (roadmap/2026-10-13-client-compacto.md, passo 13; parecer do Gabriel de 14/10/2026 ~20:00; etapa 1 de
// roadmap/2026-10-16-compacto-chat-amigos-perfil.md, 16/10/2026):
// - à DIREITA da coluna: lista de amigos (👥, 300 px) e o painel (360 px), que tem um modo por vez: CHAT (💬) ou o coach da
//   seleção (📊). Pedido de 16/10: "o botão de chat abre só a janela de recentes com a conversa aberta: a última conversa aberta
//   depois que o jogo ligou. A conversa aberta também tem um xizinho para fechar, e aí sobra só a lista de chats recentes [...] o
//   botão de amigos mostra a lista de amigos." O chat tem altura fixa: recentes em cima (~1/3) e a conversa embaixo (~2/3).
// - à ESQUERDA: configurações do lol-client (⚙, tela B1; ajuste dele: "configurações pode expandir para a esquerda. não esqueça
//   de garantir que as janelas não se percam entre si ao serem abertas ou fechadas").
// A coluna fica parada na tela; quem decide a largura da janela é o roteador (index.js pedirLateral: estado único) e quem prende
// a janela ao monitor é compacto/geometria.js. Aqui: o que está aberto, o desenho e as leituras (só GET; escrita só por clique).
// Decisões: (a) NADA do chat abre nem troca de foco sozinho, em fase nenhuma (pedido de 16/10: "eu não quero que a janela abra
// sozinha com a mensagem. Apenas mostra a notificação e só abra por meio do botão"; substitui a decisão 1 do passo 13): mensagem
// nova só muda contador, ordem e selo dos recentes; (b) a lateral volta depois da partida; (c) configurações à esquerda;
// (d) 📊 ocupa o lugar do chat e, ao fechar, volta ao que estava (pilha de 1); nunca volta sozinho na seleção seguinte;
// (e) ✕ da conversa esquece a "última conversa" (o próximo 💬 abre só com os recentes); (f) rascunho por conversa num Map da
// página (troca de conversa, ✕, fechar e reabrir guardam; envio ok e recarga do client apagam; nunca em disco, DataStore ou log).
// Importável no node (tools/teste-compacto-lateral.mjs): nada de DOM no topo; doc, LCU, relógio e geometria injetáveis.
import { h, estilo, campeoes as catalogoPadrao, FASES_JOGO } from './comum.js';
import { verAmigos, lobbyParaConvite, pedidosRecebidos, criarListaAmigos, criarConversaView, lerConversa, enviarMensagem,
  acharSalaTime, elencoTime, lerSalaTime, linhaSalaTime, limparConversas, verRecentes, criarRecentes, CSS_CHAT_LATERAL } from './lateral-chat.js';
import { criarCoachView, modeloSelo, meuNaSessao, COACH_CADA_MS, CSS_COACH } from './lateral-coach.js';
import { criarConfigView, CSS_CONFIG } from './lateral-config.js';
import { larguraUtilCss } from './geometria.js';

export const LARG = { lista: 300, painel: 360, config: 360 };
export const PASSO_MS = 1500;
export const lateralLigada = cfg => !!cfg?.compacto?.ligado && cfg?.compacto?.chatLateral !== false;
export const chaveConversa = pid => `c:${String(pid).toLowerCase()}`;

// estado -> o que aparece e as larguras (px CSS). util = largura útil do monitor em CSS; col = coluna da config.
// Monitor estreito: lista e painel dividem a mesma vaga (o painel entra no lugar da lista, com ← para voltar).
export function layout(e, { util = Infinity, col = 420 } = {}) {
  let lista = !!e.lista, painel = !!e.painel, estreito = false;
  const config = !!e.config;
  const soma = () => col + (config ? LARG.config : 0) + (lista ? LARG.lista : 0) + (painel ? LARG.painel : 0);
  if (soma() > util && lista && painel) { estreito = true; if (e.vistaEstreita === 'lista') painel = false; else lista = false; }
  return { esq: config ? LARG.config : 0, dir: (lista ? LARG.lista : 0) + (painel ? LARG.painel : 0), lista, painel, config, estreito, total: soma(), cabe: soma() <= util };
}

// rot() -> roteador ({pedirLateral...}); servicos: {champ, ...}; geometria: criarGeometria | null
export function criarLateral({
  cfg, rot, doc = globalThis.document, lcu, servicos = {}, geometria = null, definir = () => {},
  avisar = () => {}, log = () => {}, repetir = setInterval, pararRepetir = clearInterval, agora = () => Date.now(),
  campeoes = catalogoPadrao, abrirConfigRiot = () => {},
}) {
  // painel: null | 'chat' | 'coach'; anterior: o modo que o coach cobriu (null | 'chat'); conversa: a escolhida no chat (a "última
  // conversa aberta" enquanto ele não fechar no ✕): null | {k, tipo:'conversa', pid, conv, nome, txt} | {k:'time', tipo:'time'}
  const e = { lista: false, config: false, painel: null, anterior: null, conversa: null, vistaEstreita: 'painel' };
  const rascunhos = new Map(); // k da conversa -> texto digitado e não enviado (só memória da página)
  const st = { fase: null, efetivo: 'expandido', partes: null, eu: null, euEm: 0, amigos: null, conversas: [], lobby: null, pedidos: 0, pedidosEm: 0,
    convidados: new Map(), sessao: null, sala: null, salaLinhas: [], salaVistas: 0, mudo: false, ativaPorMim: null, lidaPara: null,
    timer: null, volta: 0, lendo: false, nomes: new Map(), pediuHist: false };
  let configView = null, coachView = null, timeView = null, convView = null, recentesView = null, listaView = null;
  let painelEl = null, painelTit = null, painelSub = null, painelX = null, painelCorpo = null, chatEl = null, baixoNome = null, baixoSub = null, baixoCorpo = null;

  const falha = (onde, err) => { log(`lateral: ${onde}`, err); try { avisar(`a lateral falhou (${onde}): ${err?.message || err}`, true); } catch { /* segue */ } };
  const seguro = (fn, onde = 'clique') => (...a) => {
    try { const r = fn(...a); if (r && typeof r.then === 'function') r.catch(err => falha(onde, err)); return r; } catch (err) { falha(onde, err); return undefined; }
  };
  const roteador = () => { try { return rot?.() || null; } catch { return null; } };
  const col = () => roteador()?.medidasJanela?.().col || 420;
  const util = () => { const t = geometria?.tela?.(); return larguraUtilCss(t) ?? Infinity; };
  // partida (passo 14): a tela compacta de jogo fica de pé, mas a lateral some e guarda o que estava aberto (decisão b: volta
  // depois da partida); nada de leitura no relógio nem largura na janela
  const emJogo = () => FASES_JOGO.includes(st.fase);
  const VAZIO = { lista: false, config: false, painel: null };
  const L = () => layout(emJogo() ? VAZIO : e, { util: util(), col: col() });
  const naSelecao = () => st.fase === 'ChampSelect';
  const compactoAVista = () => st.efetivo === 'compacto';
  const chatAVista = (lay = L()) => lay.painel && e.painel === 'chat';

  // ---------- desenho ----------
  const garantirDom = () => {
    if (painelEl) return;
    estilo('lc-lt-estilo', CSS_LATERAL, doc);
    listaView = criarListaAmigos({ doc, seguro, aoAmigo: (a, ev) => abrirConversa(a, ev), aoConvidar: (a, ev) => convidar(a, ev), aoPedidos: () => pedidosNoClient(),
      aoFechar: () => { e.lista = false; if (e.painel) e.vistaEstreita = 'painel'; render(); } });
    painelTit = h('b', { doc }, 'chat');
    painelSub = h('small', { doc }, '');
    painelX = h('button', { doc, class: 'lc-lt-x', title: 'fechar o chat', dataset: { a: 'lt-fechar-painel' }, on: { click: seguro(() => fecharPainel()) } }, '✕');
    painelCorpo = h('div', { doc, class: 'lc-lt-pcorpo' });
    painelEl = h('section', { doc, class: 'lc-lt-pn lc-lt-painel', dataset: { painel: 'painel' } },
      h('header', { doc, class: 'lc-lt-cab' },
        h('button', { doc, class: 'lc-lt-volta', title: 'voltar à lista de amigos', dataset: { a: 'lt-voltar' }, on: { click: seguro(() => { e.vistaEstreita = 'lista'; render(); }) } }, '←'),
        h('div', { doc, class: 'lc-lt-tit' }, painelTit, painelSub), painelX),
      painelCorpo);
    // chat: recentes em cima, a conversa embaixo (uma view para todas as 1:1 e outra para a sala do time; o campo nasce uma vez)
    recentesView = criarRecentes({ doc, seguro, aoAbrir: (r, ev) => (r.tipo === 'time' ? abrirTime(ev) : abrirConversa(r, ev)) });
    convView = criarConversaView({ doc, seguro, enviar: texto => enviarConversa(texto),
      aoInteragir: ev => { if (ev?.isTrusted !== false && e.conversa?.tipo === 'conversa') marcarLida(e.conversa, ev); } }, { placeholder: 'mensagem (Enter envia)' });
    timeView = criarConversaView({ doc, seguro, enviar: texto => enviarSala(texto), aoInteragir: () => { st.salaVistas = st.salaLinhas.length; } },
      { placeholder: 'mensagem para o time (Enter envia)', semMensagens: 'ninguém falou ainda' });
    // rascunho: cada tecla guarda o texto da conversa à vista (o Map é da página; nada vai para disco, DataStore ou log)
    convView.input.addEventListener('input', () => guardarRascunho());
    timeView.input.addEventListener('input', () => guardarRascunho());
    baixoNome = h('b', { doc }, '');
    baixoSub = h('small', { doc }, '');
    baixoCorpo = h('div', { doc, class: 'lc-lt-ccorpo' });
    chatEl = h('div', { doc, class: 'lc-lt-chat', dataset: { a: 'lt-chat' } }, recentesView.el,
      h('div', { doc, class: 'lc-lt-baixo', dataset: { a: 'lt-conversa' } },
        h('header', { doc, class: 'lc-lt-ccab' }, h('div', { doc, class: 'lc-lt-tit' }, baixoNome, baixoSub),
          h('button', { doc, class: 'lc-lt-x', title: 'fechar a conversa', dataset: { a: 'lt-fechar-conversa' }, on: { click: seguro(() => fecharConversa()) } }, '✕')),
        baixoCorpo));
    configView = criarConfigView({ doc, cfg, definir, aoConfigRiot: seguro(() => configRiot()), aoFechar: seguro(() => { e.config = false; render(); }) });
    coachView = criarCoachView({ doc });
  };
  // troca os filhos só se mudaram (mover um nó tira o foco do campo que ele está digitando)
  const trocar = (pai, nos) => {
    if (!pai) return;
    const atuais = [...(pai.children || [])];
    if (atuais.length === nos.length && atuais.every((n, i) => n === nos[i])) return;
    pai.replaceChildren(...nos);
  };
  const texto = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
  const titulo = (el, t) => { try { if (el.getAttribute('title') !== t) el.setAttribute('title', t); } catch { /* sem DOM */ } };

  function pintarRecentes() {
    if (!recentesView) return;
    const itens = verRecentes({ conversas: st.conversas, amigos: st.amigos, eu: st.eu, agoraMs: agora() });
    recentesView.pintar(itens, { ativa: e.conversa?.k || null, time: naSelecao() ? { un: Math.max(0, st.salaLinhas.length - st.salaVistas) } : null });
  }
  // cabeçalho e corpo só mudam quando o modo ou a conversa mudam (o relógio repinta a cada 1,5 s; botão recriado perde o clique)
  function pintarPainel(lay) {
    painelEl.classList.toggle('lc-lt-estreito', !!lay.estreito);
    if (e.painel === 'coach') {
      texto(painelTit, '📊 coach da seleção'); texto(painelSub, 'selo completo · acompanha o seu hover'); titulo(painelX, 'fechar o coach');
      trocar(painelCorpo, [coachView.el]);
      return;
    }
    texto(painelTit, 'chat'); texto(painelSub, 'conversas recentes'); titulo(painelX, 'fechar o chat');
    trocar(painelCorpo, [chatEl]);
    pintarRecentes();
    const c = e.conversa;
    chatEl.classList.toggle('lc-lt-com-conversa', !!c);
    if (!c) { trocar(baixoCorpo, []); return; }
    if (c.tipo === 'time') { texto(baixoNome, '🗨 sala do time'); texto(baixoSub, 'só campeão e posição de quem fala'); trocar(baixoCorpo, [timeView.el]); return; }
    texto(baixoNome, c.nome || 'amigo'); texto(baixoSub, c.txt || 'conversa');
    trocar(baixoCorpo, [convView.el]);
  }

  function marcarClasses() {
    try {
      const html = doc.documentElement;
      html.classList.toggle('lc-lt-lista', !!e.lista);
      html.classList.toggle('lc-lt-config', !!e.config);
      html.classList.toggle('lc-lt-chat', e.painel === 'chat');
      html.classList.toggle('lc-lt-coach', e.painel === 'coach');
    } catch { /* sem DOM */ }
  }

  // aplica o estado: DOM dos painéis + larguras ao roteador (que muda a janela se o compacto está à vista)
  function render() {
    const lay = L();
    if (st.partes) {
      garantirDom();
      trocar(st.partes.esq, lay.config ? [configView.el] : []);
      trocar(st.partes.dir, [lay.lista ? listaView.el : null, lay.painel ? painelEl : null].filter(Boolean));
      if (lay.config && !configView.el.dataset.pintado) { configView.el.dataset.pintado = '1'; configView.pintar(); }
      if (lay.painel) pintarPainel(lay);
      if (lay.lista) listaView.pintar(st.amigos, false);
    }
    marcarClasses();
    roteador()?.pedirLateral?.({ esq: lay.esq, dir: lay.dir });
    conferirAtiva(lay);
    return lay;
  }

  // a conversa que ele marcou como lida (PUT active) só segue ativa no client enquanto está À VISTA: a escolhida no chat, painel de
  // chat aberto e compacto na tela. Trocou de conversa, ✕, fechou o painel, 📊 por cima, foi para a partida, minimizou: DELETE
  // (revisão de 14/10/2026: senão as mensagens dela chegavam já lidas, a bolha ficava em 0 e ele nunca via)
  function conferirAtiva(lay = L()) {
    if (!st.ativaPorMim) return;
    const c = e.conversa;
    const aVista = compactoAVista() && chatAVista(lay) && c?.tipo === 'conversa' && (c.conv || c.pid) === st.ativaPorMim;
    if (!aVista) limparAtiva();
  }

  // abriu um lado e não cabe no monitor com o outro: o que ele acabou de abrir vence, o outro fecha (avisa). Nem sozinho cabe:
  // não abre (avisa). -> true se ficou aberto
  function caber(lado) {
    const u = util();
    if (!Number.isFinite(u)) return true;
    let lay = layout(e, { util: u, col: col() });
    if (lay.cabe) return true;
    if (lado === 'esq' && (e.lista || e.painel)) {
      guardarRascunho();
      e.lista = false; e.painel = null; e.anterior = null; limparAtiva();
      avisar('não cabe tudo ao lado neste monitor: o chat fechou para abrir as configurações');
    } else if (lado === 'dir' && e.config) { e.config = false; avisar('não cabe tudo ao lado neste monitor: as configurações fecharam'); }
    lay = layout(e, { util: u, col: col() });
    return lay.cabe;
  }

  // ---------- rascunho por conversa (decisão f) ----------
  const viewDe = c => (c?.tipo === 'time' ? timeView : convView);
  function guardarRascunho() {
    const c = e.conversa;
    const v = viewDe(c);
    if (!c || !v) return;
    const t = String(v.input.value || '');
    if (t) rascunhos.set(c.k, t); else rascunhos.delete(c.k);
  }

  // ---------- ações (clique dele) ----------
  // 👥: abre/fecha a lista. Monitor estreito com a lista aberta mas escondida atrás do painel: o clique mostra a lista
  function alternarLista() {
    if (!lateralLigada(cfg)) return false;
    const lay = L();
    if (e.lista && lay.estreito && !lay.lista) { e.vistaEstreita = 'lista'; render(); return true; }
    e.lista = !e.lista;
    if (e.lista) { e.vistaEstreita = 'lista'; if (!caber('dir')) { e.lista = false; avisar('a lista de amigos não cabe ao lado neste monitor: use o client normal', true); } }
    else if (e.painel) e.vistaEstreita = 'painel';
    render();
    if (e.lista) lerAmigos().catch(err => falha('amigos', err));
    return true;
  }
  // 💬: abre/fecha o painel de chat (recentes + a última conversa que ele abriu). Com o 📊 à vista, o 💬 põe o chat no lugar
  function alternarChat() {
    if (!lateralLigada(cfg)) return false;
    const lay = L();
    if (e.painel === 'chat' && lay.estreito && !lay.painel) { e.vistaEstreita = 'painel'; render(); return true; }
    if (e.painel === 'chat') { fecharPainel(); return true; }
    e.painel = 'chat'; e.anterior = null; e.vistaEstreita = 'painel';
    if (!caber('dir')) { e.painel = null; avisar('o chat não cabe ao lado neste monitor: use o client normal', true); }
    render();
    if (e.painel === 'chat') {
      lerChat().catch(err => falha('chat', err));
      if (e.conversa) viewDe(e.conversa)?.focar();
    }
    return true;
  }
  // ✕ do cabeçalho do painel: no chat fecha o painel (a conversa escolhida fica para o próximo 💬); no coach volta ao anterior
  function fecharPainel() {
    guardarRascunho();
    if (e.painel === 'coach') { e.painel = e.anterior; e.anterior = null; }
    else { e.painel = null; e.anterior = null; }
    if (!e.painel && e.lista) e.vistaEstreita = 'lista';
    render();
    if (e.painel === 'chat') lerChat().catch(() => {});
    return true;
  }
  // ✕ da conversa: fecha só a conversa; os recentes ocupam a altura toda e o próximo 💬 abre sem conversa (decisão e)
  function fecharConversa() {
    if (!e.conversa) return false;
    guardarRascunho();
    e.conversa = null;
    render();
    return true;
  }
  // a conversa de um amigo (clique num recente, na lista de amigos): vira a escolhida e o chat abre com ela
  function abrirConversa(a, ev) {
    if (!lateralLigada(cfg) || !a?.pid) return false;
    const k = chaveConversa(a.pid);
    const conv = a.conv || st.conversas.find(c => c.type === 'chat' && String(c.pid).toLowerCase() === String(a.pid).toLowerCase())?.id || '';
    if (e.conversa?.k !== k) {
      guardarRascunho();
      e.conversa = { k, tipo: 'conversa', pid: String(a.pid), conv, nome: a.nome || 'amigo', txt: a.txt || '' };
      garantirDom();
      convView.reiniciar({ placeholder: `mensagem para ${e.conversa.nome} (Enter envia)`, texto: rascunhos.get(k) || '' });
      convView.pintar([], { motivo: 'carregando…', bloqueado: st.mudo, chave: k });
    } else {
      if (conv && !e.conversa.conv) e.conversa.conv = conv;
      if (a.txt) e.conversa.txt = a.txt;
    }
    e.painel = 'chat'; e.anterior = null; e.vistaEstreita = 'painel';
    if (!caber('dir')) { e.painel = null; avisar('a conversa não cabe ao lado neste monitor: use o client normal', true); render(); return false; }
    render();
    lerConversaAtual().catch(err => falha('conversa', err));
    convView?.focar();
    // decisão 4 do plano de 16/10: o clique dele que põe a conversa à vista já vale como "lida" (evento sintético não escreve)
    if (ev && ev.isTrusted !== false) marcarLida(e.conversa, ev);
    return true;
  }
  // a sala do time (1ª linha dos recentes na seleção)
  function abrirTime(ev) {
    if (!naSelecao()) return false;
    if (e.conversa?.k !== 'time') {
      guardarRascunho();
      e.conversa = { k: 'time', tipo: 'time' };
      garantirDom();
      timeView.reiniciar({ texto: rascunhos.get('time') || '' });
    }
    e.painel = 'chat'; e.anterior = null; e.vistaEstreita = 'painel';
    if (!caber('dir')) { e.painel = null; avisar('a sala do time não cabe ao lado neste monitor', true); render(); return false; }
    render();
    lerSala().catch(err => falha('sala do time', err));
    timeView?.focar();
    if (ev && ev.isTrusted !== false) st.salaVistas = st.salaLinhas.length;
    return true;
  }
  // 📊: ocupa o lugar do chat (guarda o modo de antes) e, fechado, volta a ele (decisão d)
  function alternarCoach() {
    if (!naSelecao()) { avisar('o coach da seleção só existe na seleção de campeões'); return false; }
    if (e.painel === 'coach') { fecharPainel(); return true; }
    guardarRascunho();
    e.anterior = e.painel === 'chat' ? 'chat' : null;
    e.painel = 'coach'; e.vistaEstreita = 'painel';
    if (!caber('dir')) { e.painel = e.anterior; e.anterior = null; avisar('o coach não cabe ao lado neste monitor', true); }
    render();
    if (e.painel === 'coach') lerCoach().catch(err => falha('coach', err));
    return true;
  }
  function alternarConfig() {
    e.config = !e.config;
    if (e.config) {
      if (configView) delete configView.el.dataset.pintado;
      if (!caber('esq')) { e.config = false; avisar('as configurações não cabem ao lado neste monitor: use o client normal', true); }
    }
    render();
    return true;
  }
  function configRiot() {
    abrirConfigRiot();
  }
  // pedidos de amizade: aceitar/recusar é no client normal (expande)
  function pedidosNoClient() { roteador()?.expandir?.(); avisar('pedidos de amizade: aceite ou recuse no client normal'); }

  async function convidar(a, ev) {
    if (ev?.isTrusted === false) return;
    if (!a?.convidar?.ok) { avisar(a?.convidar?.motivo || 'convite indisponível agora', true); return; }
    st.convidados.set(a.pid, agora());
    pintarLista();
    const r = await lcu('POST', '/lol-lobby/v2/lobby/invitations', [{ toSummonerId: a.summonerId }]);
    if (r.ok) avisar(`convite enviado para ${a.nome}`);
    else { st.convidados.delete(a.pid); avisar(`convite não saiu (${r.status})`, true); }
    lerAmigos().catch(() => {});
  }

  // "lida": a conversa vira a ativa do client (PUT /lol-chat/v1/conversations/active {id}, setActive da Riot) só com clique ou tecla
  // DELE (no recente, no amigo ou na própria conversa) e com ela à vista; sair de vista devolve (DELETE, o mesmo da Riot)
  function marcarLida(c, ev) {
    if (ev && ev.isTrusted === false) return;
    const id = c?.conv || '';
    if (!id || !compactoAVista() || e.conversa !== c || !chatAVista()) return;
    const conv = st.conversas.find(x => x.type === 'chat' && x.id === id);
    const un = conv?.unreadMessageCount || 0;
    if (st.ativaPorMim === id && st.lidaPara === un) return;
    st.ativaPorMim = id;
    if (conv) conv.unreadMessageCount = 0;
    st.lidaPara = 0;
    lcu('PUT', '/lol-chat/v1/conversations/active', { id }).catch(() => {});
    pintarRecentes();
  }
  function limparAtiva() {
    if (!st.ativaPorMim) return;
    st.ativaPorMim = null; st.lidaPara = null;
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
    // só o que a lateral usa (limparConversas): password e mucJwtDto nunca ficam, nem nas 1:1 (que também trazem, 16/10/2026)
    st.conversas = limparConversas(r.json);
    const c = e.conversa;
    if (c?.tipo === 'conversa' && !c.conv) {
      const achada = st.conversas.find(y => y.type === 'chat' && y.pid.toLowerCase() === c.pid.toLowerCase());
      if (achada) c.conv = achada.id;
    }
    // ele está nesta conversa à vista e a marcou como ativa: as mensagens chegam lidas no client; o selo fica em 0
    if (st.ativaPorMim) { const a = st.conversas.find(y => y.id === st.ativaPorMim); if (a) a.unreadMessageCount = 0; }
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
    if (!f.ok || !Array.isArray(f.json)) st.amigos = { ok: false, motivo: f.status === 0 ? 'o client não respondeu' : `não foi possível ler os amigos (${f.status})` };
    else {
      const abertas = new Set(e.conversa?.tipo === 'conversa' && e.painel === 'chat' ? [e.conversa.pid] : []);
      st.amigos = { ok: true, pedidos: st.pedidos, ...verAmigos({ amigos: f.json, conversas: st.conversas, lobby: st.lobby, convidados: st.convidados, abertas, agoraMs: agora() }) };
      // status de quem está na conversa (o cabeçalho dela)
      const c = e.conversa;
      if (c?.tipo === 'conversa') { const a = [...st.amigos.online, ...st.amigos.offline].find(y => y.pid === c.pid); if (a) c.txt = a.txt; }
    }
    pintarLista();
  }
  const pintarLista = () => { if (st.partes && listaView && L().lista) listaView.pintar(st.amigos, false); };

  // recentes (+ a conversa escolhida); fotos e status dos recentes vêm dos amigos, lidos junto quando ainda não há
  async function lerChat() {
    await Promise.all([eu(), st.amigos ? lerConversas() : lerAmigos()]);
    if (e.conversa?.tipo === 'conversa') await lerConversaAtual();
    else if (e.conversa?.tipo === 'time' || naSelecao()) await lerSala();
    if (st.partes && painelEl && L().painel) pintarPainel(L());
  }
  async function lerConversaAtual() {
    const c = e.conversa;
    if (!c || c.tipo !== 'conversa' || !convView) return;
    if (!c.conv) { convView.pintar([], { bloqueado: st.mudo, chave: c.k }); return; }
    const [m, euAgora] = await Promise.all([lcu('GET', `/lol-chat/v1/conversations/${encodeURIComponent(c.conv)}/messages`), eu()]);
    if (e.conversa !== c) return; // ele trocou de conversa no meio da leitura
    let linhas = [], motivo = '';
    if (m.status === 404) linhas = [];
    else if (!m.ok) motivo = `não foi possível ler a conversa (${m.status})`;
    else linhas = lerConversa(m.json, euAgora);
    convView.pintar(linhas, { motivo, bloqueado: st.mudo, chave: c.k });
  }
  async function enviarConversa(texto) {
    const alvo = e.conversa;
    if (!alvo || alvo.tipo !== 'conversa') return { ok: false, motivo: 'sem conversa' };
    const r = await enviarMensagem(lcu, { conv: alvo.conv, pid: alvo.pid, eu: await eu(), texto });
    // a conversa à vista agora é a mesma do envio? Pela chave, não pelo objeto: ir para B e voltar para A no meio do envio cria
    // outro objeto para A, e o campo de A (com o rascunho reposto = o texto enviado) tem de limpar (revisão de 16/10/2026)
    const mesma = () => e.conversa?.k === alvo.k;
    if (!r.ok) {
      // ele já está noutra conversa: o erro não vai para o campo dela; avisa com o nome (o rascunho de A segue guardado)
      if (!mesma()) { avisar(`a mensagem para ${alvo.nome || 'o amigo'} não foi enviada: ${r.motivo || 'erro'}`, true); return { ...r, limpar: false }; }
      return r;
    }
    rascunhos.delete(alvo.k);
    await lerConversas();
    if (mesma()) await lerConversaAtual();
    if (st.partes && painelEl && L().painel) pintarPainel(L());
    return { ok: true, limpar: mesma() };
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
    if (!sala) { st.sala = null; st.salaLinhas = []; timeView?.pintar([], { motivo: 'a sala do time ainda não abriu (ou não foi encontrada)', bloqueado: true }); return; }
    if (st.sala?.id !== sala.id) { st.sala = sala; st.salaVistas = 0; }
    const m = await lcu('GET', `/lol-chat/v1/conversations/${encodeURIComponent(sala.id)}/messages`);
    if (!m.ok) { timeView?.pintar(st.salaLinhas, { motivo: m.status === 404 ? 'a sala do time fechou' : `não foi possível ler a sala (${m.status})`, bloqueado: st.mudo }); return; }
    st.salaLinhas = lerSalaTime(m.json, elencoTime(sess), quem);
    if (e.conversa?.tipo === 'time' && chatAVista() && compactoAVista()) st.salaVistas = st.salaLinhas.length;
    timeView?.pintar(st.salaLinhas, { bloqueado: st.mudo, desenhar: l => linhaSalaTime(l, doc) });
  }
  async function enviarSala(texto) {
    if (!st.sala) return { ok: false, motivo: 'sem sala do time' };
    const r = await enviarMensagem(lcu, { conv: st.sala.id, eu: await eu(), texto, criarSeFaltar: false });
    if (r.ok) { rascunhos.delete('time'); await lerSala(); }
    return r.ok ? { ok: true, limpar: e.conversa?.k === 'time' } : r;
  }
  async function lerCoach() {
    if (!naSelecao() || e.painel !== 'coach') return;
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

  // relógio da lateral: só com o compacto à vista. Mensagem nova só muda contador, ordem e selo dos recentes (decisão a): nada aqui
  // mexe em painel, conversa, largura ou foco
  async function volta() {
    if (st.lendo || !compactoAVista() || emJogo()) return;
    st.lendo = true;
    try {
      st.volta++;
      const lay = L();
      const chat = chatAVista(lay);
      if (st.volta % 4 === 1) await lerMudo().catch(() => {});
      if (chat) {
        if (lay.lista && st.volta % 2 === 0) await lerAmigos();
        else if (st.volta % 4 === 0 || !st.amigos) await lerAmigos();
        else await lerConversas();
        if (e.conversa?.tipo === 'conversa') await lerConversaAtual();
        if (naSelecao() && (e.conversa?.tipo === 'time' || st.volta % 2 === 0)) await lerSala();
      } else if (lay.lista && st.volta % 2 === 0) await lerAmigos();
      if (e.painel === 'coach' && lay.painel && st.volta % 2 === 0) await lerCoach();
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
      // entrou ou saiu da partida: a largura some (janela só com a coluna) ou volta como estava (passo 14)
      const virouJogo = FASES_JOGO.includes(antes) !== emJogo();
      if (fase !== 'ChampSelect') {
        let mudou = false;
        // fora da seleção o coach sai e volta o que ele cobria; a sala do time deixa de existir (e o rascunho dela)
        if (e.painel === 'coach') { e.painel = e.anterior; e.anterior = null; mudou = true; }
        if (e.conversa?.tipo === 'time') { e.conversa = null; mudou = true; }
        rascunhos.delete('time');
        st.sala = null; st.salaLinhas = []; st.salaVistas = 0; st.sessao = null;
        if (mudou || virouJogo) render();
      }
      // na seleção nada abre sozinho: a sala do time aparece como 1ª linha dos recentes
    },
    sincronizar() {
      if (!lateralLigada(cfg)) {
        const tinha = e.lista || e.painel === 'chat' || e.anterior === 'chat';
        guardarRascunho();
        e.lista = false;
        if (e.painel === 'chat') e.painel = null;
        if (e.anterior === 'chat') e.anterior = null;
        if (tinha) render();
      }
      if (e.config && configView && st.partes) configView.pintar();
    },
    // botões das telas (💬, 👥, ⚙, 📊) e testes
    ligada: () => lateralLigada(cfg),
    alternarLista: seguro(alternarLista), alternarChat: seguro(alternarChat), abrirConversa: seguro(abrirConversa), fecharConversa: seguro(fecharConversa),
    fecharPainel: seguro(fecharPainel), alternarCoach: seguro(alternarCoach), abrirTime: seguro(abrirTime), alternarConfig: seguro(alternarConfig),
    voltarLista: seguro(() => { e.vistaEstreita = 'lista'; render(); }),
    // ultima: a conversa que o 💬 mostra ao abrir (a última que ele abriu desde que o client ligou, até o ✕ dela)
    estado: () => ({ ...e, conversa: e.conversa ? { ...e.conversa } : null, ultima: e.conversa ? (e.conversa.tipo === 'time' ? 'time' : e.conversa.pid) : null,
      rascunhos: rascunhos.size, layout: L(), fase: st.fase, efetivo: st.efetivo, ativaPorMim: st.ativaPorMim }),
    recentes: () => verRecentes({ conversas: st.conversas, amigos: st.amigos, eu: st.eu, agoraMs: agora() }),
    layout: L, volta, lerAmigos, lerConversas,
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
#lc-compacto .lc-lt-pcorpo { flex:1; min-height:0; display:flex; flex-direction:column; }
html.lc-lt-chat #lc-compacto [data-a="chat"], html.lc-lt-lista #lc-compacto [data-a="lista-amigos"], html.lc-lt-config #lc-compacto [data-a="config"],
html.lc-lt-coach #lc-compacto [data-a="coach"] { border-color:var(--lc-azul); box-shadow:0 0 0 1px rgba(10,200,185,.35) inset; }
` + CSS_CHAT_LATERAL + CSS_COACH + CSS_CONFIG;
