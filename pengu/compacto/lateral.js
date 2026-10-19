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
// Etapa 2 (amigos, 16/10/2026): a lista do 👥 mostra os grupos da Riot na ordem dela (recolher, reordenar arrastando o cabeçalho,
// criar/renomear/excluir pasta, gravando onde a Riot grava), o menu do clique direito com os itens do roster da Riot e arrastar um
// amigo até a coluna = convite para o lobby (só com o lobby criado, fase Lobby). Regras e corpos: compacto/amigos.js; desenho do
// menu, diálogos e campo: compacto/amigos-menu.js. Toda escrita só com o evento do clique, tecla ou soltar DELE (isTrusted).
// Etapa 3 (perfil, 16/10/2026): "Exibir perfil" e a foto do amigo abrem o perfil dele no painel da direita (modo 'perfil': resumo,
// histórico, detalhe da partida; fecha voltando ao que estava, como o 📊); a foto do topo do lobby abre o editor do meu perfil à
// esquerda, no lugar da ⚙ (um dos dois por vez). Desenho e corpos: compacto/perfil.js; o fundo da coluna: compacto/fundo.js.
// Importável no node (tools/teste-compacto-lateral.mjs, teste-compacto-amigos.mjs): nada de DOM no topo; doc, LCU, relógio e
// geometria injetáveis.
import { h, estilo, icone, campeoes as catalogoPadrao, FASES_JOGO } from './comum.js';
import { verAmigos, lobbyParaConvite, pedidosRecebidos, criarListaAmigos, criarConversaView, lerConversa, enviarMensagem,
  acharSalaTime, elencoTime, lerSalaTime, linhaSalaTime, limparConversas, verRecentes, criarRecentes, pidDe, statusAmigo, CSS_CHAT_LATERAL } from './lateral-chat.js';
import { criarCoachView, modeloSelo, meuNaSessao, COACH_CADA_MS, CSS_COACH } from './lateral-coach.js';
import { criarConfigView, CSS_CONFIG } from './lateral-config.js';
import { larguraUtilCss } from './geometria.js';
import { ordenarGrupos, podeReordenar, novaOrdem, corpoRecolher, validarNomePasta, corpoNovaPasta, vaoDeSoltar, podeConvidar, corpoConvite,
  corpoEspectar, lerPodeAssistir, corpoNota, corpoMover, corpoBloqueio, corpoDenuncia, recebeuMensagem, nomeCompleto, itensMenu, itensMenuGrupo, comNome,
  TEXTOS_RIOT, ROTAS } from './amigos.js';
import { criarMenu, criarDialogo, criarCampo, CSS_AMIGOS } from './amigos-menu.js';
import { criarPerfilView, criarEditorView, CSS_PERFIL } from './perfil.js';

export const LARG = { lista: 300, painel: 360, config: 360 };
export const PASSO_MS = 1500;
// o chat é sempre ao lado com o compacto ligado: a chave que escolhia as janelas do chat do complemento saiu com elas em
// 19/10/2026 (Fase 2 de roadmap/2026-10-17-plugin-pengu-primeiro.md)
export const lateralLigada = cfg => !!cfg?.compacto?.ligado;
export const chaveConversa = pid => `c:${String(pid).toLowerCase()}`;

// estado -> o que aparece e as larguras (px CSS). util = largura útil do monitor em CSS; col = coluna da config.
// Monitor estreito: lista e painel dividem a mesma vaga (o painel entra no lugar da lista, com ← para voltar).
// Esquerda: as configurações (⚙) OU o editor do meu perfil (etapa 3 de 2026-10-16), um dos dois por vez, na mesma largura.
export function layout(e, { util = Infinity, col = 420 } = {}) {
  let lista = !!e.lista, painel = !!e.painel, estreito = false;
  const config = !!e.config, editor = !config && !!e.editor, esq = config || editor;
  const soma = () => col + (esq ? LARG.config : 0) + (lista ? LARG.lista : 0) + (painel ? LARG.painel : 0);
  if (soma() > util && lista && painel) { estreito = true; if (e.vistaEstreita === 'lista') painel = false; else lista = false; }
  return { esq: esq ? LARG.config : 0, dir: (lista ? LARG.lista : 0) + (painel ? LARG.painel : 0), lista, painel, config, editor, estreito, total: soma(), cabe: soma() <= util };
}

// rot() -> roteador ({pedirLateral...}); servicos: {champ, ...}; geometria: criarGeometria | null
export function criarLateral({
  cfg, rot, doc = globalThis.document, lcu, servicos = {}, geometria = null, definir = () => {},
  avisar = () => {}, log = () => {}, repetir = setInterval, pararRepetir = clearInterval, agora = () => Date.now(),
  campeoes = catalogoPadrao, abrirConfigRiot = () => {},
}) {
  // painel: null | 'chat' | 'coach' | 'perfil'; anterior: o modo que o coach ou o perfil cobriu (pilha de 1); conversa: a escolhida no
  // chat (a "última conversa aberta" enquanto ele não fechar no ✕): null | {k, tipo:'conversa', pid, conv, nome, txt} | {k:'time',
  // tipo:'time'}; perfil: de quem é o perfil à vista ({pid?, puuid, summonerId, nome, eu?}); editor: o editor do meu perfil à esquerda
  const e = { lista: false, config: false, editor: false, painel: null, anterior: null, conversa: null, perfil: null, vistaEstreita: 'painel' };
  const rascunhos = new Map(); // k da conversa -> texto digitado e não enviado (só memória da página)
  const st = { fase: null, efetivo: 'expandido', partes: null, eu: null, euEm: 0, amigos: null, conversas: [], lobby: null, pedidos: 0, pedidosEm: 0,
    convidados: new Map(), sessao: null, sala: null, salaLinhas: [], salaVistas: 0, mudo: false, ativaPorMim: null, lidaPara: null,
    timer: null, volta: 0, lendo: false, nomes: new Map(), pediuHist: false,
    // etapa 2: grupos da Riot (ordenados, cópias do que foi lido: são o corpo dos PUTs) | null; amigos como lidos (corpo dos PUTs de
    // amigo); arrasto em andamento; denúncia de mensagem (config da Riot e quem ele já denunciou)
    grupos: null, amigosCrus: null, crus: new Map(), arrasto: null, denuncia: { ligada: false, em: 0, denunciados: new Set(), lidosEm: 0 } };
  let configView = null, coachView = null, timeView = null, convView = null, recentesView = null, listaView = null, menuView = null, dlgView = null, campoView = null;
  let perfilView = null, editorView = null;
  // "Assistir" do perfil à vista: o GET can-spectate da Riot para a chave de espectador do amigo (chave = "puuid|spectatorKey" já pedida)
  const perfilCtx = { assistir: null, chave: '' };
  const colunasLigadas = new WeakSet();
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
      aoFechar: () => { e.lista = false; if (e.painel) e.vistaEstreita = 'painel'; render(); },
      aoMenuAmigo: (a, ev, linha) => abrirMenuAmigo(a, ev, linha), aoMenuGrupo: (s, ev, cab) => abrirMenuGrupo(s, ev, cab), aoRecolher: (s, ev) => recolher(s, ev),
      aoNovaPasta: ev => pedirNovaPasta(ev), congelado: () => sobreAberto() || !!st.arrasto, aoPerfil: (a, ev) => verPerfil(a.pid, ev),
      arrasto: { amigo: arrastarAmigo, grupo: arrastarGrupo, sobreGrupo, saiuGrupo, soltarGrupo, fim: () => limparArrasto() } });
    const soltar = () => { if (!sobreAberto()) listaView?.soltarPendente(); };
    menuView = criarMenu({ doc, seguro, aoEscolher: (it, sub, ev) => escolherNoMenu(it, sub, ev), aoFechar: soltar });
    dlgView = criarDialogo({ doc, seguro, aoFechar: soltar });
    campoView = criarCampo({ doc, seguro, aoFechar: soltar });
    listaView.sobre.append(campoView.el, menuView.el, dlgView.el);
    painelTit = h('b', { doc }, 'chat');
    painelSub = h('small', { doc }, '');
    painelX = h('button', { doc, class: 'lc-lt-x', title: 'fechar o chat', 'aria-label': 'fechar o chat', dataset: { a: 'lt-fechar-painel' }, on: { click: seguro(() => fecharPainel()) } },
      icone('fechar', { doc, tam: 14 }));
    painelCorpo = h('div', { doc, class: 'lc-lt-pcorpo' });
    painelEl = h('section', { doc, class: 'lc-lt-pn lc-lt-painel', dataset: { painel: 'painel' } },
      h('header', { doc, class: 'lc-lt-cab' },
        h('button', { doc, class: 'lc-lt-volta', title: 'voltar à lista de amigos', 'aria-label': 'voltar à lista de amigos', dataset: { a: 'lt-voltar' },
          on: { click: seguro(() => { e.vistaEstreita = 'lista'; render(); }) } }, icone('voltar', { doc, tam: 14 })),
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
          h('button', { doc, class: 'lc-lt-x', title: 'fechar a conversa', 'aria-label': 'fechar a conversa', dataset: { a: 'lt-fechar-conversa' },
            on: { click: seguro(() => fecharConversa()) } }, icone('fechar', { doc, tam: 14 }))),
        baixoCorpo));
    configView = criarConfigView({ doc, cfg, definir, lcu, avisar, aoConfigRiot: seguro(() => configRiot()), aoFechar: seguro(() => { e.config = false; render(); }) });
    coachView = criarCoachView({ doc });
    // etapa 3 (perfil): o de outro jogador no painel da direita; o editor do meu à esquerda. Ações do perfil = as do menu do amigo
    perfilView = criarPerfilView({ doc, lcu, seguro, avisar, agora, campeoes, acoes: {
      estado: alvo => acoesDoPerfil(alvo),
      convidar: (alvo, ev) => convidar(itemDe(alvo?.pid) || { pid: alvo?.pid, nome: alvo?.nome }, ev),
      mensagem: (alvo, ev) => (deEle(ev) ? abrirConversa(itemDe(alvo?.pid) || { pid: alvo?.pid, nome: alvo?.nome }, ev) : false),
      assistir: (alvo, ev) => assistir(alvo?.pid, ev),
    } });
    editorView = criarEditorView({ doc, lcu, seguro, avisar, agora, aoFechar: () => { e.editor = false; render(); }, aoHistorico: (alvo, ev) => abrirPerfil(alvo, ev, { aba: 'historico' }) });
  };
  // troca os filhos só se mudaram (mover um nó tira o foco do campo que ele está digitando)
  const trocar = (pai, nos) => {
    if (!pai) return;
    const atuais = [...(pai.children || [])];
    if (atuais.length === nos.length && atuais.every((n, i) => n === nos[i])) return;
    pai.replaceChildren(...nos);
  };
  const texto = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
  // botão só com ícone: o nome dele vai no title e no aria-label juntos
  const titulo = (el, t) => { try { if (el.getAttribute('title') !== t) { el.setAttribute('title', t); el.setAttribute('aria-label', t); } } catch { /* sem DOM */ } };

  function pintarRecentes() {
    if (!recentesView) return;
    const itens = verRecentes({ conversas: st.conversas, amigos: st.amigos, eu: st.eu, agoraMs: agora() });
    recentesView.pintar(itens, { ativa: e.conversa?.k || null, time: naSelecao() ? { un: Math.max(0, st.salaLinhas.length - st.salaVistas) } : null });
  }
  // cabeçalho e corpo só mudam quando o modo ou a conversa mudam (o relógio repinta a cada 1,5 s; botão recriado perde o clique)
  function pintarPainel(lay) {
    painelEl.classList.toggle('lc-lt-estreito', !!lay.estreito);
    if (e.painel === 'coach') {
      texto(painelTit, 'coach da seleção'); texto(painelSub, 'selo completo · acompanha o seu hover'); titulo(painelX, 'fechar o coach');
      trocar(painelCorpo, [coachView.el]);
      return;
    }
    if (e.painel === 'perfil') {
      texto(painelTit, e.perfil?.eu ? 'seu histórico' : 'perfil'); texto(painelSub, e.perfil?.eu ? 'partidas e replays' : e.perfil?.nome || 'jogador');
      titulo(painelX, e.anterior === 'chat' ? 'fechar o perfil e voltar ao chat' : 'fechar o perfil');
      trocar(painelCorpo, [perfilView.el]);
      return;
    }
    texto(painelTit, 'chat'); texto(painelSub, 'conversas recentes'); titulo(painelX, 'fechar o chat');
    trocar(painelCorpo, [chatEl]);
    pintarRecentes();
    const c = e.conversa;
    chatEl.classList.toggle('lc-lt-com-conversa', !!c);
    if (!c) { trocar(baixoCorpo, []); return; }
    if (c.tipo === 'time') { texto(baixoNome, 'sala do time'); texto(baixoSub, 'só campeão e posição de quem fala'); trocar(baixoCorpo, [timeView.el]); return; }
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
      html.classList.toggle('lc-lt-perfil', e.painel === 'perfil');
      html.classList.toggle('lc-lt-editor', !e.config && !!e.editor);
    } catch { /* sem DOM */ }
  }

  // aplica o estado: DOM dos painéis + larguras ao roteador (que muda a janela se o compacto está à vista)
  function render() {
    const lay = L();
    if (st.partes) {
      garantirDom();
      trocar(st.partes.esq, lay.config ? [configView.el] : lay.editor ? [editorView.el] : []);
      trocar(st.partes.dir, [lay.lista ? listaView.el : null, lay.painel ? painelEl : null].filter(Boolean));
      if (lay.config && !configView.el.dataset.pintado) { configView.el.dataset.pintado = '1'; configView.aoAbrir(); configView.pintar(); }
      if (lay.painel) pintarPainel(lay);
      if (lay.lista) listaView.pintar(st.amigos, false);
      else fecharSobre(); // lista fora de vista: menu, diálogo e campo dela fecham sem escrever nada
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
      if (e.painel === 'perfil') perfilView?.fechar();
      e.lista = false; e.painel = null; e.anterior = null; e.perfil = null; limparAtiva();
      avisar(`não cabe tudo ao lado neste monitor: o chat fechou para abrir ${e.config ? 'as configurações' : 'o seu perfil'}`);
    } else if (lado === 'dir' && e.config) { e.config = false; avisar('não cabe tudo ao lado neste monitor: as configurações fecharam'); }
    else if (lado === 'dir' && e.editor && !editorView?.pendentes().length) { e.editor = false; avisar('não cabe tudo ao lado neste monitor: o editor do perfil fechou'); }
    lay = layout(e, { util: u, col: col() });
    return lay.cabe;
  }

  // o chat entra no lugar do perfil (💬, conversa, sala do time): o perfil sai de verdade (leituras em voo descartadas)
  function deixarPerfil() { if (e.painel === 'perfil') { perfilView?.fechar(); e.perfil = null; } }

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
    deixarPerfil(); e.painel = 'chat'; e.anterior = null; e.vistaEstreita = 'painel';
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
    if (e.painel === 'perfil') { perfilView?.fechar(); e.perfil = null; }
    if (e.painel === 'coach' || e.painel === 'perfil') {
      e.painel = e.anterior; e.anterior = null;
      if (e.painel === 'coach' && !naSelecao()) e.painel = null; // o perfil cobria o coach e a seleção acabou
    } else { e.painel = null; e.anterior = null; }
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
    deixarPerfil(); e.painel = 'chat'; e.anterior = null; e.vistaEstreita = 'painel';
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
    deixarPerfil(); e.painel = 'chat'; e.anterior = null; e.vistaEstreita = 'painel';
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
    if (e.painel === 'perfil') { perfilView?.fechar(); e.perfil = null; e.painel = e.anterior === 'chat' ? 'chat' : null; }
    e.anterior = e.painel === 'chat' ? 'chat' : null;
    e.painel = 'coach'; e.vistaEstreita = 'painel';
    if (!caber('dir')) { e.painel = e.anterior; e.anterior = null; avisar('o coach não cabe ao lado neste monitor', true); }
    render();
    if (e.painel === 'coach') lerCoach().catch(err => falha('coach', err));
    return true;
  }
  function alternarConfig() {
    // ⚙ e o editor do perfil dividem a esquerda: com mudanças não salvas no perfil, a ⚙ espera (nada se perde sem ele decidir)
    if (!e.config && e.editor && editorView?.pendentes().length) { avisar('o perfil tem mudanças não salvas: salve ou feche o editor antes', true); return false; }
    e.config = !e.config;
    if (e.config) {
      e.editor = false;
      if (configView) delete configView.el.dataset.pintado;
      if (!caber('esq')) { e.config = false; avisar('as configurações não cabem ao lado neste monitor: use o client normal', true); }
    }
    render();
    return true;
  }
  // foto do topo (lobby e fila): o editor do meu perfil à esquerda, no lugar da ⚙ (decisão 11 do plano). Outro clique fecha (com
  // mudanças não salvas, o editor pede o 2º clique no ✕ dele). Abrir só lê (GET); escrever é o "salvar" dele
  function alternarEditor() {
    garantirDom();
    if (e.editor && !e.config) { editorView.fechar(); return true; }
    e.editor = true; e.config = false;
    if (!caber('esq')) { e.editor = false; avisar('o editor do perfil não cabe ao lado neste monitor: use o client normal', true); }
    render();
    if (e.editor) editorView.abrir().catch(err => falha('perfil', err));
    return true;
  }
  // o que o perfil de um amigo oferece agora (a mesma regra do menu: amigos.podeConvidar, can-spectate da Riot, conversa no chat)
  function acoesDoPerfil(alvo) {
    const f = alvo?.pid ? st.crus.get(alvo.pid) : null;
    if (!f) return {};
    const c = conviteDe(alvo.pid);
    const temChave = !!(f.puuid && f.lol?.spectatorKey);
    // resposta de outra chave (partida anterior) não vale para a partida de agora
    const s = (perfilCtx.chave === chaveAssistir(f) && perfilCtx.assistir) || { estado: 'verificando' };
    return {
      convidar: c.mostra ? { mostra: true, ok: !!c.ok, motivo: c.motivo || '' } : { mostra: false },
      mensagem: { mostra: lateralLigada(cfg), ok: true, motivo: 'abrir a conversa no chat' },
      assistir: temChave && s.estado !== 'erro' ? { mostra: true, ok: s.estado === 'ok', motivo: s.estado === 'verificando' ? 'verificando se a partida pode ser assistida'
        : s.estado === 'ok' ? 'assistir a partida como espectador' : s.dica || 'a partida não pode ser assistida agora' } : { mostra: false },
    };
  }
  // perfil no painel da direita (decisão 2: ocupa o lugar do chat e, fechado, volta ao que estava). Só com o gesto dele; só GET
  function abrirPerfil(alvo, ev, { aba = 'resumo' } = {}) {
    if (!deEle(ev) || !alvo?.puuid) return false;
    garantirDom();
    if (e.painel !== 'perfil') { guardarRascunho(); e.anterior = e.painel; }
    e.painel = 'perfil'; e.perfil = { ...alvo }; e.vistaEstreita = 'painel';
    if (!caber('dir')) {
      e.painel = e.anterior; e.anterior = null; e.perfil = null;
      avisar('o perfil não cabe ao lado neste monitor: use o client normal', true); render(); return false;
    }
    perfilCtx.assistir = null; perfilCtx.chave = '';
    render();
    perfilView.abrir(alvo, { aba }).catch(err => falha('perfil', err));
    conferirAssistir();
    return true;
  }
  const chaveAssistir = f => (f?.puuid && f.lol?.spectatorKey ? `${f.puuid}|${f.lol.spectatorKey}` : '');
  // "Assistir" do perfil: o mesmo GET can-spectate que a Riot faz ao abrir o menu do amigo, ao abrir o perfil e de novo só quando a chave de
  // espectador muda (o amigo entrou noutra partida com o perfil aberto; revisão de 16/10/2026: antes o botão ficava em "verificando"
  // para sempre, ou valia o "pode" da partida anterior). Só GET
  function conferirAssistir() {
    const pid = e.painel === 'perfil' ? e.perfil?.pid : null;
    const f = pid ? st.crus.get(pid) : null;
    const chave = chaveAssistir(f);
    if (!chave || chave === perfilCtx.chave) return;
    perfilCtx.chave = chave; perfilCtx.assistir = null;
    lcu('GET', ROTAS.podeAssistir(f.puuid, f.lol.spectatorKey)).then(r => {
      if (e.perfil?.pid !== pid || perfilCtx.chave !== chave) return;
      perfilCtx.assistir = lerPodeAssistir(r, f);
      perfilView.pintar();
    }).catch(() => {});
  }
  function configRiot() {
    abrirConfigRiot();
  }
  // pedidos de amizade: aceitar/recusar é no client normal (expande)
  function pedidosNoClient() { roteador()?.expandir?.(); avisar('pedidos de amizade: aceite ou recuse no client normal'); }

  // convite (botão da linha, menu e soltar na coluna): a regra única de amigos.podeConvidar, refeita NA HORA do gesto dele (fase,
  // lobby e status do amigo podem ter mudado desde a última pintura). Corpo: lobbiesService.invitePlayer do rcp-fe-lol-parties
  const conviteDe = pid => {
    const f = st.crus.get(pid);
    return f ? podeConvidar({ f, fase: st.fase, lobby: st.lobby, eu: st.eu, convidados: st.convidados, agoraMs: agora() }) : { mostra: false, ok: false, motivo: 'amigo não encontrado na lista' };
  };
  async function convidar(a, ev) {
    if (!deEle(ev) || !a?.pid) return;
    const c = st.crus.has(a.pid) ? conviteDe(a.pid) : a.convite || a.convidar;
    if (!c?.ok) { avisar(c?.motivo || 'convite indisponível agora', true); return; }
    const f = st.crus.get(a.pid) || { summonerId: a.summonerId };
    st.convidados.set(a.pid, agora());
    montarAmigos();
    const r = await lcu('POST', ROTAS.convite, corpoConvite(f));
    if (r.ok) avisar(`convite enviado para ${a.nome}`);
    else { st.convidados.delete(a.pid); avisar(`convite não saiu (${r.status})`, true); }
    lerAmigos().catch(() => {});
  }

  // ---------- amigos: menu do clique direito, pastas, arrasto (etapa 2) ----------
  // gesto dele: o evento do clique, da tecla ou do soltar, nunca sintético (no client, evento criado por script tem isTrusted false)
  const deEle = ev => !!ev && ev.isTrusted !== false;
  const sobreAberto = () => !!(menuView?.aberto() || dlgView?.aberto() || campoView?.aberto());
  function fecharSobre() { menuView?.fechar(); dlgView?.fechar(); campoView?.fechar(); }
  const idAmigo = f => String(f?.id || f?.pid || '');
  const itemDe = pid => (st.amigos?.ok ? [...st.amigos.online, ...st.amigos.offline].find(a => a.pid === pid) : null) || null;
  // posição do menu: logo abaixo da linha (ou do cabeçalho) clicada, dentro da camada ".lc-lt-sobre"
  function topoDe(alvo) {
    try {
      const r = alvo?.getBoundingClientRect?.(), s = listaView?.sobre?.getBoundingClientRect?.();
      return r && s ? r.bottom - s.top : 0;
    } catch { return 0; }
  }
  function ajustarMenu() {
    try {
      const alt = menuView.el.offsetHeight, max = listaView.sobre.clientHeight, topo = parseFloat(menuView.el.style.top) || 0;
      if (alt && max && topo + alt > max) menuView.el.style.top = `${Math.max(0, max - alt - 4)}px`;
    } catch { /* sem layout */ }
  }
  // o que o menu mostra do amigo agora (amigos.itensMenu, com a ordem e os critérios do contextMenuModel da Riot)
  const menuCtx = { pid: null, assistir: null, denuncia: null };
  function itensDoAmigo(pid) {
    const f = st.crus.get(pid);
    return itensMenu(f, { grupos: st.grupos, convite: conviteDe(pid), assistir: menuCtx.assistir, denuncia: menuCtx.denuncia });
  }
  function abrirMenuAmigo(a, ev, linha) {
    if (!a?.pid || !st.crus.has(a.pid)) return;
    dlgView?.fechar(); campoView?.fechar();
    const f = st.crus.get(a.pid);
    menuCtx.pid = a.pid; menuCtx.assistir = null; menuCtx.denuncia = { ligada: st.denuncia.ligada, denunciado: st.denuncia.denunciados.has(String(f.puuid)), recebeu: false };
    menuView.abrir(itensDoAmigo(a.pid), { chave: `a:${a.pid}`, topo: topoDe(linha), origem: linha });
    ajustarMenu();
    const ainda = () => menuView.chave() === `a:${a.pid}`;
    // "Assistir partida": a Riot pergunta ao abrir o menu (spectateAvailability: GET can-spectate); erro = o item some
    if (f.puuid && f.lol?.spectatorKey) {
      lcu('GET', ROTAS.podeAssistir(f.puuid, f.lol.spectatorKey)).then(r => {
        if (!ainda()) return;
        menuCtx.assistir = lerPodeAssistir(r, f);
        menuView.atualizar(itensDoAmigo(a.pid));
      }).catch(() => {});
    }
    // "Denunciar": só com a denúncia de mensagem ligada pela Riot (client-config), cinza se já denunciado ou sem mensagem dele
    lerDenuncia(a, f).then(d => { if (d && ainda()) { menuCtx.denuncia = d; menuView.atualizar(itensDoAmigo(a.pid)); } }).catch(() => {});
  }
  async function lerDenuncia(a, f) {
    if (agora() - st.denuncia.em > 300000) {
      st.denuncia.em = agora();
      const r = await lcu('GET', ROTAS.denunciaLigada);
      st.denuncia.ligada = !!(r.ok && (r.json === true || r.json?.enabled === true));
    }
    if (!st.denuncia.ligada) return { ligada: false, denunciado: false, recebeu: false };
    if (agora() - st.denuncia.lidosEm > 30000) {
      const r = await lcu('GET', ROTAS.denuncias);
      if (r.ok && Array.isArray(r.json)) { st.denuncia.denunciados = new Set(r.json.map(String)); st.denuncia.lidosEm = agora(); }
    }
    let recebeu = false;
    const conv = a.conv || st.conversas.find(c => c.type === 'chat' && String(c.pid).toLowerCase() === String(a.pid).toLowerCase())?.id || '';
    if (conv) {
      const [m, quem] = await Promise.all([lcu('GET', `/lol-chat/v1/conversations/${encodeURIComponent(conv)}/messages`), eu()]);
      recebeu = !!(m.ok && recebeuMensagem(m.json, quem?.id));
    }
    return { ligada: true, denunciado: st.denuncia.denunciados.has(String(f.puuid)), recebeu };
  }
  function escolherNoMenu(it, sub, ev) {
    const chave = menuView.chave() || '';
    menuView.fechar();
    if (chave.startsWith('g:')) return escolherNoMenuGrupo(Number(chave.slice(2)), it, ev);
    const pid = chave.slice(2);
    const a = itemDe(pid), f = st.crus.get(pid);
    if (!a || !f) return undefined;
    switch (it.a) {
      case 'convidar': return convidar(a, ev);
      case 'mensagem': return abrirConversa(a, ev);
      case 'assistir': return assistir(pid, ev);
      case 'perfil': return verPerfil(pid, ev);
      case 'nota': return campoView.abrir({ titulo: `anotação: ${a.nome}`, valor: f.note || '', placeholder: 'anotação sobre o amigo', aoConfirmar: (v, e2) => salvarNota(pid, v, e2) });
      case 'mover': return sub ? moverAmigo(pid, sub.id, ev) : undefined;
      case 'remover': return confirmarRemover(pid);
      case 'denunciar': return confirmarDenuncia(pid);
      default: return undefined;
    }
  }
  // "Exibir perfil" (menu do amigo) e clique na foto dele na lista: o perfil dentro do compacto, no painel da direita (etapa 3; até
  // ela, o client normal com o showOverlay do rcp-fe-lol-profiles)
  function verPerfil(pid, ev) {
    if (!deEle(ev)) return false;
    const f = st.crus.get(pid);
    if (!f?.puuid) { avisar('perfil indisponível para este amigo: use o client normal', true); return false; }
    return abrirPerfil({ pid, puuid: String(f.puuid), summonerId: Number(f.summonerId) || 0, nome: String(f.gameName || f.name || 'amigo'), tag: String(f.gameTag || ''),
      status: statusAmigo(f, agora()).txt }, ev);
  }
  // "Assistir partida" (spectateGame do roster v2): perfil privado avisa e não abre (hasPrivateProfile do rcp-fe-lol-profiles)
  async function assistir(pid, ev) {
    if (!deEle(ev)) return;
    const f = st.crus.get(pid);
    if (!f?.lol?.spectatorKey) return;
    const priv = await lcu('GET', ROTAS.privacidade);
    if (priv.ok && priv.json === 'ENABLED' && f.summonerId) {
      const s = await lcu('GET', ROTAS.invocador(f.summonerId));
      if (s.ok && s.json?.privacy === 'PRIVATE') { avisar('perfil privado: a partida deste jogador não pode ser assistida', true); return; }
    }
    const r = await lcu('POST', ROTAS.espectar, corpoEspectar(f));
    if (r.ok) avisar(`abrindo a partida de ${f.gameName || 'amigo'} como espectador`);
    else avisar(`não foi possível assistir (${r.status}): use o client normal`, true);
  }
  async function salvarNota(pid, texto, ev) {
    if (!deEle(ev)) return;
    const f = st.crus.get(pid);
    if (!f) return;
    const corpo = corpoNota(f, texto);
    if (corpo.note === String(f.note || '')) return;
    const r = await lcu('PUT', ROTAS.amigo(idAmigo(f)), corpo);
    if (r.ok) { f.note = corpo.note; montarAmigos(); avisar(corpo.note ? 'anotação salva' : 'anotação apagada'); }
    else avisar(`a anotação não foi salva (${r.status})`, true);
  }
  // "Mover" (setGroup do serviço friend-groups): o amigo inteiro como lido, com o groupId novo
  async function moverAmigo(pid, gid, ev) {
    if (!deEle(ev)) return;
    const f = st.crus.get(pid);
    const g = st.grupos?.find(x => Number(x.id) === Number(gid));
    if (!f || !g || g.isMetaGroup || g.virtual || Number(f.groupId) === Number(gid)) return;
    const r = await lcu('PUT', ROTAS.amigo(idAmigo(f)), corpoMover(f, gid));
    // à vista ele muda de pasta já (amigo em pasta automática, offline ou celular, segue nela: a Riot mostra por displayGroupId)
    if (r.ok) { f.groupId = Number(gid); if (!grupoDe(f.displayGroupId)?.isMetaGroup) f.displayGroupId = Number(gid); montarAmigos(); }
    else avisar(`não foi possível mover o amigo (${r.status})`, true);
    lerAmigos().catch(() => {});
  }
  // "Desfazer amizade/Bloquear" (confirmUnfriendOrBlockFriendHelper): um diálogo, três saídas; a caixa "Também denunciar" só com a
  // denúncia de mensagem ligada e ele ainda não denunciado; a denúncia sai depois da ação, e a falha dela não desfaz nada
  function confirmarRemover(pid) {
    const f = st.crus.get(pid);
    const nome = nomeCompleto(f);
    if (!f || !nome) { avisar('nome do amigo incompleto: use o client normal', true); return; }
    const caixa = st.denuncia.ligada && !st.denuncia.denunciados.has(String(f.puuid)) ? { rotulo: TEXTOS_RIOT.tambemDenunciar, marcada: false } : null;
    dlgView.abrir({ titulo: TEXTOS_RIOT.removerTitulo, texto: TEXTOS_RIOT.removerTexto, nome, caixa, botoes: [
      { a: 'desfazer', rotulo: TEXTOS_RIOT.removerSim, perigo: true, acao: (ev, m) => removerOuBloquear(pid, 'desfazer', ev, m) },
      { a: 'bloquear', rotulo: TEXTOS_RIOT.bloquear, perigo: true, acao: (ev, m) => removerOuBloquear(pid, 'bloquear', ev, m) }] });
  }
  async function removerOuBloquear(pid, qual, ev, denunciar) {
    if (!deEle(ev)) return;
    const f = st.crus.get(pid);
    if (!f) return;
    const nome = nomeCompleto(f) || f.gameName || 'amigo';
    const r = qual === 'desfazer' ? await lcu('DELETE', ROTAS.amigo(idAmigo(f))) : await lcu('POST', ROTAS.bloqueados, corpoBloqueio(f));
    if (!r.ok) { avisar(qual === 'desfazer' ? `não foi possível desfazer a amizade (${r.status})` : `não foi possível bloquear (${r.status})`, true); return; }
    avisar(qual === 'desfazer' ? `amizade desfeita: ${nome}` : `${nome} bloqueado`);
    if (denunciar) {
      const d = await lcu('POST', ROTAS.denuncias, corpoDenuncia(f)).catch(() => ({ ok: false }));
      if (d.ok) st.denuncia.denunciados.add(String(f.puuid));
    }
    lerAmigos().catch(() => {});
  }
  // "Denunciar" (confirmReportFriendForAbusiveTextHelper): "Também bloquear" já marcado; o bloqueio vem depois da denúncia aceita
  function confirmarDenuncia(pid) {
    const f = st.crus.get(pid);
    const nome = nomeCompleto(f);
    if (!f || !nome) { avisar('nome do amigo incompleto: use o client normal', true); return; }
    dlgView.abrir({ titulo: TEXTOS_RIOT.denunciaTitulo, texto: TEXTOS_RIOT.denunciaTexto, nome, caixa: { rotulo: TEXTOS_RIOT.tambemBloquear, marcada: true }, botoes: [
      { a: 'denunciar', rotulo: TEXTOS_RIOT.denunciar, perigo: true, acao: (ev, m) => denunciar(pid, ev, m) },
      { a: 'cancelar', rotulo: TEXTOS_RIOT.cancelar, acao: () => {} }] });
  }
  async function denunciar(pid, ev, bloquear) {
    if (!deEle(ev)) return;
    const f = st.crus.get(pid);
    if (!f?.puuid) return;
    const nome = nomeCompleto(f) || f.gameName || 'amigo';
    const r = await lcu('POST', ROTAS.denuncias, corpoDenuncia(f));
    if (!r.ok) { avisar(comNome(TEXTOS_RIOT.denunciaFalhou, nome, 'player'), true); return; }
    st.denuncia.denunciados.add(String(f.puuid));
    avisar(comNome(TEXTOS_RIOT.denunciaEnviada, nome, 'player'));
    if (bloquear) {
      const b = await lcu('POST', ROTAS.bloqueados, corpoBloqueio(f));
      if (!b.ok) avisar(`não foi possível bloquear (${b.status})`, true);
    }
    lerAmigos().catch(() => {});
  }

  // ---------- pastas (grupos da Riot) ----------
  const grupoDe = id => st.grupos?.find(g => Number(g.id) === Number(id)) || null;
  function abrirMenuGrupo(s, ev, cab) {
    if (!st.grupos || !s) return;
    dlgView?.fechar(); campoView?.fechar();
    menuView.abrir(itensMenuGrupo(s), { chave: `g:${s.id}`, topo: topoDe(cab), origem: cab });
    ajustarMenu();
  }
  function escolherNoMenuGrupo(id, it, ev) {
    const g = grupoDe(id);
    if (!g) return undefined;
    if (it.a === 'renomear') {
      return campoView.abrir({ titulo: TEXTOS_RIOT.renomearPasta, valor: g.name, placeholder: TEXTOS_RIOT.nomePasta, max: 40,
        validar: v => validarNomePasta(v, st.grupos, g.id), aoConfirmar: (v, e2) => renomearPasta(g.id, v, e2) });
    }
    if (it.a === 'excluir') {
      // a Riot (roster v2) exclui sem perguntar; aqui pede a confirmação do plano ("Excluir pasta?")
      return dlgView.abrir({ titulo: TEXTOS_RIOT.excluirPasta, texto: 'Excluir a pasta {{name}}? Os amigos dela continuam na sua lista.', nome: g.name, botoes: [
        { a: 'excluir', rotulo: 'excluir', perigo: true, acao: e2 => excluirPasta(g.id, e2) }, { a: 'cancelar', rotulo: 'cancelar', acao: () => {} }] });
    }
    return undefined;
  }
  function pedirNovaPasta(ev) {
    if (!deEle(ev)) return;
    if (!st.grupos) { avisar('não foi possível ler as pastas: crie pelo client normal', true); return; }
    menuView?.fechar(); dlgView?.fechar();
    campoView.abrir({ titulo: 'nova pasta', valor: '', placeholder: TEXTOS_RIOT.nomePasta, max: 40, validar: v => validarNomePasta(v, st.grupos), aoConfirmar: (v, e2) => criarPasta(v, e2) });
  }
  async function criarPasta(nome, ev) {
    if (!deEle(ev) || !st.grupos) return;
    const r = await lcu('POST', ROTAS.grupos, corpoNovaPasta(st.grupos, nome));
    if (!r.ok) avisar(`a pasta não foi criada (${r.status})`, true);
    lerAmigos().catch(() => {});
  }
  async function renomearPasta(id, nome, ev) {
    if (!deEle(ev)) return;
    const g = grupoDe(id);
    if (!g || g.isMetaGroup || g.virtual || Number(g.id) === 0) return;
    const r = await lcu('PUT', ROTAS.grupo(g.id), { ...g, name: String(nome).trim() });
    if (r.ok) g.name = String(nome).trim(); else avisar(`a pasta não foi renomeada (${r.status})`, true);
    lerAmigos().catch(() => {});
  }
  async function excluirPasta(id, ev) {
    if (!deEle(ev)) return;
    const g = grupoDe(id);
    if (!g || g.isMetaGroup || g.virtual || Number(g.id) === 0) return;
    const r = await lcu('DELETE', ROTAS.grupo(g.id));
    if (!r.ok) avisar(`a pasta não foi excluída (${r.status})`, true);
    lerAmigos().catch(() => {});
  }
  // recolher/abrir (toggleCollapse da Riot): na hora na tela, PUT do grupo como lido com collapsed trocado; falhou, volta e avisa.
  // Sem a leitura das pastas não há cabeçalho de grupo (o "offline" da lista de antes recolhe só aqui)
  const recolhidosLocais = new Set(); // Geral só local (o grupo 0 não veio na lista da Riot): recolhe sem gravar
  async function recolher(s, ev) {
    if (!deEle(ev) || !s) return;
    if (s.virtual) { if (recolhidosLocais.has(s.id)) recolhidosLocais.delete(s.id); else recolhidosLocais.add(s.id); montarAmigos(); return; }
    const g = grupoDe(s.id);
    if (!g) return;
    const corpo = corpoRecolher(g);
    g.collapsed = corpo.collapsed;
    montarAmigos();
    const r = await lcu('PUT', ROTAS.grupo(g.id), corpo);
    if (!r.ok) { g.collapsed = !corpo.collapsed; montarAmigos(); avisar(`a pasta não foi ${corpo.collapsed ? 'recolhida' : 'aberta'} (${r.status})`, true); }
  }
  // reordenar (moveGroup + saveGroupOrder do serviço friend-groups v2): a ordem nova na hora, um PUT por grupo não meta que mudou
  async function reordenar(id, vao, ev) {
    if (!deEle(ev) || !st.grupos) return;
    const { ordem, puts } = novaOrdem(st.grupos, id, vao);
    if (!puts.length) return;
    const antes = st.grupos;
    st.grupos = ordem;
    montarAmigos();
    let falhou = 0;
    for (const p of puts) {
      const r = await lcu('PUT', ROTAS.grupo(p.id), p.corpo);
      if (!r.ok) falhou = r.status || -1;
    }
    if (falhou) { st.grupos = antes; montarAmigos(); avisar(`a ordem das pastas não foi salva (${falhou})`, true); }
    lerAmigos().catch(() => {});
  }

  // ---------- arrastar (HTML5 DnD dentro da camada; o soltar de verdade tem isTrusted) ----------
  // amigo -> coluna = convite para o lobby (decisão 8: só com o lobby criado; fora disso o soltar não faz nada e diz por quê);
  // amigo -> cabeçalho de pasta = mover (o "dropped" do lol-social-roster-group); pasta -> entre pastas = reordenar.
  // O dado do arrasto fica aqui (st.arrasto), não no dataTransfer: o MIME próprio só marca que o arrasto é nosso
  const MIME_AMIGO = 'application/x-lc-amigo', MIME_PASTA = 'application/x-lc-pasta';
  function arrastarAmigo(a, ev) {
    if (!a?.pid || !st.crus.has(a.pid)) { ev?.preventDefault?.(); return; }
    fecharSobre();
    st.arrasto = { tipo: 'amigo', pid: a.pid, nome: a.nome };
    try { ev.dataTransfer?.setData?.(MIME_AMIGO, a.pid); if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'copyMove'; } catch { /* sem DnD */ }
    try { (ev.currentTarget || ev.target)?.classList?.add('lc-lt-arrastando'); } catch { /* sem DOM */ }
  }
  function arrastarGrupo(s, ev) {
    const pode = podeReordenar(st.grupos);
    if (!s || s.meta || s.virtual || !pode.ok) { ev?.preventDefault?.(); return; }
    fecharSobre();
    st.arrasto = { tipo: 'grupo', id: Number(s.id) };
    try { ev.dataTransfer?.setData?.(MIME_PASTA, String(s.id)); if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move'; } catch { /* sem DnD */ }
  }
  const marcarCab = (cab, classes = []) => { try { for (const c of ['lc-lt-antes', 'lc-lt-depois', 'lc-lt-alvo']) cab?.classList?.toggle(c, classes.includes(c)); } catch { /* sem DOM */ } };
  function metadeDeBaixo(ev, cab) {
    try {
      const r = cab?.getBoundingClientRect?.();
      if (r && r.height > 0 && Number.isFinite(ev?.clientY)) return ev.clientY - r.top > r.height / 2;
    } catch { /* sem layout */ }
    return !!ev?.depois; // teste: o evento falso diz a metade
  }
  // -> true = aceita o soltar aqui (quem chama faz o preventDefault)
  function sobreGrupo(s, ev, cab) {
    const a = st.arrasto;
    if (!a || !s || !st.grupos) return false;
    if (a.tipo === 'grupo') {
      if (s.meta || s.virtual) { marcarCab(cab); return false; }
      const depois = metadeDeBaixo(ev, cab);
      a.alvo = { id: Number(s.id), depois };
      marcarCab(cab, [depois ? 'lc-lt-depois' : 'lc-lt-antes']);
      return true;
    }
    if (a.tipo === 'amigo') {
      // droppable da Riot: pasta não meta e mais de uma pasta
      const ok = !s.meta && !s.virtual && st.grupos.filter(g => !g.virtual).length > 1;
      marcarCab(cab, ok ? ['lc-lt-alvo'] : []);
      return ok;
    }
    return false;
  }
  function saiuGrupo(s, ev, cab) { marcarCab(cab); }
  function soltarGrupo(s, ev, cab) {
    const a = st.arrasto;
    marcarCab(cab);
    limparArrasto();
    if (!a || !s || !deEle(ev)) return undefined;
    if (a.tipo === 'grupo' && !s.meta && !s.virtual) return reordenar(a.id, vaoDeSoltar(st.grupos, s.id, metadeDeBaixo(ev, cab)), ev);
    if (a.tipo === 'amigo' && !s.meta && !s.virtual) return moverAmigo(a.pid, s.id, ev);
    return undefined;
  }
  function limparArrasto() {
    const tinha = !!st.arrasto;
    st.arrasto = null;
    const col = st.partes?.coluna;
    try {
      col?.classList?.remove('lc-lt-solta-ok', 'lc-lt-solta-nao');
      col?.querySelector?.('.lc-lt-solta-dica')?.remove();
      for (const n of listaView?.el?.querySelectorAll?.('.lc-lt-arrastando, .lc-lt-antes, .lc-lt-depois, .lc-lt-alvo') || []) n.classList.remove('lc-lt-arrastando', 'lc-lt-antes', 'lc-lt-depois', 'lc-lt-alvo');
    } catch { /* sem DOM */ }
    if (tinha && !sobreAberto()) listaView?.soltarPendente();
  }
  // a coluna principal recebe o amigo: marca verde (convida) ou cinza (motivo na faixa de baixo); soltar com o gesto dele convida
  function marcarColuna(col, c, nome) {
    try {
      col.classList.toggle('lc-lt-solta-ok', !!c.ok);
      col.classList.toggle('lc-lt-solta-nao', !c.ok);
      let dica = col.querySelector?.('.lc-lt-solta-dica');
      if (!dica) { dica = h('div', { doc, class: 'lc-lt-solta-dica', dataset: { a: 'lt-solta-dica' } }); col.appendChild(dica); }
      const t = c.ok ? `solte para convidar ${nome}` : c.motivo || 'convite indisponível agora';
      if (dica.textContent !== t) dica.textContent = t;
    } catch { /* sem DOM */ }
  }
  // clique fora fecha o menu e o campo (a Riot fecha o menu em qualquer clique na janela e o campo da pasta ao perder o foco);
  // o diálogo de confirmação é modal e só fecha pelos botões dele. Sem isto a lista ficaria congelada com o menu esquecido aberto
  function ligarCliqueFora(camada) {
    if (!camada || colunasLigadas.has(camada) || typeof camada.addEventListener !== 'function') return;
    colunasLigadas.add(camada);
    camada.addEventListener('pointerdown', ev => {
      const t = ev.target;
      const dentro = el => !!el && (el === t || (typeof el.contains === 'function' && el.contains(t)));
      if (menuView?.aberto() && !dentro(menuView.el)) menuView.fechar();
      if (campoView?.aberto() && !dentro(campoView.el)) campoView.fechar();
      // arrasto sem dragend (o Chromium não o dispara se a origem sai do documento; soltar fora da janela pode não chegar): durante
      // um arrasto nativo não há pointerdown, então um clique dele aqui prova que o arrasto acabou e solta a lista congelada
      // (revisão de 16/10/2026; prova: "arrasto sem dragend" de teste-compacto-amigos.mjs)
      if (st.arrasto) limparArrasto();
    }, true);
  }
  function ligarColuna(col) {
    if (!col || colunasLigadas.has(col) || typeof col.addEventListener !== 'function') return;
    colunasLigadas.add(col);
    const sobre = ev => {
      const a = st.arrasto;
      if (a?.tipo !== 'amigo') return;
      ev.preventDefault?.(); // sempre: sem isto o drop nunca chega e o motivo não aparece
      try { if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'; } catch { /* sem DnD */ }
      marcarColuna(col, conviteDe(a.pid), a.nome);
    };
    col.addEventListener('dragenter', seguro(sobre, 'arrasto'));
    col.addEventListener('dragover', seguro(sobre, 'arrasto'));
    col.addEventListener('dragleave', seguro(ev => {
      const para = ev.relatedTarget;
      if (para && typeof col.contains === 'function' && col.contains(para)) return;
      // no Chromium o dragleave entre filhos chega com relatedTarget null: só tira a marca se o ponteiro saiu do retângulo da
      // coluna (senão ela piscava a cada filho cruzado; revisão de 16/10/2026)
      try {
        const r = col.getBoundingClientRect?.();
        const x = ev.clientX, y = ev.clientY;
        if (r && r.width > 0 && Number.isFinite(x) && Number.isFinite(y) && x >= r.left && x < r.right && y >= r.top && y < r.bottom) return;
      } catch { /* sem layout: tira a marca */ }
      try { col.classList.remove('lc-lt-solta-ok', 'lc-lt-solta-nao'); col.querySelector?.('.lc-lt-solta-dica')?.remove(); } catch { /* sem DOM */ }
    }, 'arrasto'));
    col.addEventListener('drop', seguro(ev => {
      const a = st.arrasto;
      if (a?.tipo !== 'amigo') return undefined;
      ev.preventDefault?.();
      limparArrasto();
      if (!deEle(ev)) return undefined;
      const c = conviteDe(a.pid);
      if (!c.ok) { avisar(c.motivo || 'convite indisponível agora'); return undefined; }
      const item = itemDe(a.pid) || { pid: a.pid, nome: a.nome };
      return convidar(item, ev);
    }, 'arrasto'));
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
    if (r.ok && r.json && typeof r.json === 'object') {
      st.eu = { id: r.json.id, pid: r.json.pid, puuid: r.json.puuid, summonerId: r.json.summonerId, product: r.json.product, platformId: r.json.platformId };
      st.euEm = agora();
    }
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
    // etapa 2: os grupos da Riot (GET /lol-chat/v1/friend-groups) junto dos amigos; sem eles, a lista de antes (sem reordenar)
    const [f, l, , g] = await Promise.all([lcu('GET', '/lol-chat/v1/friends'), lcu('GET', '/lol-lobby/v2/lobby'), lerConversas(), lcu('GET', ROTAS.grupos), eu().catch(() => null)]);
    if (agora() - st.pedidosEm > 15000) {
      st.pedidosEm = agora();
      const p = await lcu('GET', '/lol-chat/v2/friend-requests');
      if (p.ok) st.pedidos = pedidosRecebidos(p.json);
    }
    st.lobby = lobbyParaConvite(l);
    st.grupos = g.ok ? ordenarGrupos(g.json) : null;
    if (!f.ok || !Array.isArray(f.json)) { st.amigosCrus = null; st.crus = new Map(); }
    else {
      // os amigos como lidos (corpo dos PUTs de anotação e de pasta; só em memória: nunca vão para aviso, log ou registro)
      st.amigosCrus = f.json.filter(x => x && typeof x === 'object');
      st.crus = new Map(st.amigosCrus.map(x => [pidDe(x), x]).filter(([k]) => k));
    }
    montarAmigos(f.ok ? null : f.status);
  }
  // st.amigos a partir do que foi lido por último (recolher e reordenar mudam na hora, antes da resposta da Riot)
  function montarAmigos(statusErro = null) {
    if (!st.amigosCrus) {
      st.amigos = { ok: false, motivo: statusErro === 0 ? 'o client não respondeu' : `não foi possível ler os amigos (${statusErro ?? 'erro'})` };
    } else {
      const abertas = new Set(e.conversa?.tipo === 'conversa' && e.painel === 'chat' ? [e.conversa.pid] : []);
      const v = verAmigos({ amigos: st.amigosCrus, conversas: st.conversas, lobby: st.lobby, convidados: st.convidados, abertas, agoraMs: agora(), fase: st.fase, eu: st.eu,
        grupos: st.grupos });
      if (v.secoes) for (const s of v.secoes) if (s.virtual && recolhidosLocais.has(s.id)) s.recolhido = true;
      st.amigos = { ok: true, pedidos: st.pedidos, reordena: podeReordenar(st.grupos), ...v };
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
      traumas: cfg.traumas?.ligado !== false, fila: roteador()?.estado?.().info?.fila ?? null,
      // matchup e draft só com o complemento coach anunciando "draft" (champselect.js temCoach; coach.js temRecurso)
      temColetor: typeof champ?.temCoach === 'function' ? !!champ.temCoach() : typeof champ?.lerCoach === 'function' }));
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
      // perfil à vista: só o estado das ações (convite segue a fase e o amigo) e o replay da partida aberta; os amigos a cada 4 voltas
      if (e.painel === 'perfil' && lay.painel) { if (e.perfil?.pid && st.volta % 4 === 0) await lerAmigos(); conferirAssistir(); perfilView?.relogio(); }
      if (lay.painel) pintarPainel(lay);
    } catch (err) { log('lateral: leitura', err); } finally { st.lendo = false; }
  }
  const ligarRelogio = () => { if (!st.timer) st.timer = repetir(() => { volta(); }, PASSO_MS); };
  const pararRelogio = () => { if (st.timer) { pararRepetir(st.timer); st.timer = null; } };

  return {
    // ganchos do roteador (index.js)
    // a coluna recebe o amigo arrastado (convite): ouvintes uma vez por coluna (a camada recria a coluna a cada montagem)
    anexar(partes) { if (!partes) return; st.partes = partes; ligarColuna(partes.coluna); ligarCliqueFora(partes.camada); render(); },
    aoEfetivo(efetivo) {
      st.efetivo = efetivo;
      if (efetivo === 'compacto') { ligarRelogio(); volta(); }
      else {
        pararRelogio(); fecharSobre(); limparArrasto(); st.partes = null; limparAtiva();
        // a ⚙ aberta volta igual, mas repintada e com o som do client relido (ele pode ter mexido no client normal: Configurações da Riot)
        if (configView) delete configView.el.dataset.pintado;
      }
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
        if (e.painel === 'perfil' && e.anterior === 'coach') e.anterior = null; // o perfil cobria o coach: fechado, não volta a ele
        if (e.conversa?.tipo === 'time') { e.conversa = null; mudou = true; }
        rascunhos.delete('time');
        st.sala = null; st.salaLinhas = []; st.salaVistas = 0; st.sessao = null;
        if (mudou || virouJogo) render();
      }
      // na seleção nada abre sozinho: a sala do time aparece como 1ª linha dos recentes
      // o convite depende da fase (só no Lobby): a lista repinta o botão e o menu já com a fase nova
      if (antes !== fase && st.amigosCrus) montarAmigos();
    },
    sincronizar() {
      if (!lateralLigada(cfg)) {
        // o perfil de um amigo nasce da lista (lateral): fecha junto; o meu histórico (atalho do editor) fica
        const amigo = e.painel === 'perfil' && !e.perfil?.eu;
        const tinha = e.lista || e.painel === 'chat' || e.anterior === 'chat' || amigo;
        guardarRascunho();
        e.lista = false;
        // o perfil cobria o 📊 (seleção): volta ao 📊, como o ✕ do perfil (revisão de 16/10/2026: o coach sumia junto)
        if (amigo) { perfilView?.fechar(); e.perfil = null; e.painel = e.anterior === 'coach' && naSelecao() ? 'coach' : null; e.anterior = null; }
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
    // etapa 3: a foto do topo abre/fecha o editor do meu perfil; o perfil de um jogador no painel da direita (clique dele)
    alternarEditor: seguro(alternarEditor), abrirPerfil: seguro(abrirPerfil), verPerfil: seguro(verPerfil),
    perfil: () => perfilView?.estado() ?? null, editor: () => editorView?.estado() ?? null, salvarPerfil: seguro(ev => editorView?.salvar(ev)),
    voltarLista: seguro(() => { e.vistaEstreita = 'lista'; render(); }),
    // ultima: a conversa que o 💬 mostra ao abrir (a última que ele abriu desde que o client ligou, até o ✕ dela)
    estado: () => ({ ...e, conversa: e.conversa ? { ...e.conversa } : null, perfil: e.perfil ? { ...e.perfil } : null, ultima: e.conversa ? (e.conversa.tipo === 'time' ? 'time' : e.conversa.pid) : null,
      rascunhos: rascunhos.size, layout: L(), fase: st.fase, efetivo: st.efetivo, ativaPorMim: st.ativaPorMim }),
    recentes: () => verRecentes({ conversas: st.conversas, amigos: st.amigos, eu: st.eu, agoraMs: agora() }),
    // etapa 2 (testes e __lolClient): o que a lista de amigos tem aberto agora
    amigos: () => ({ grupos: st.grupos ? st.grupos.map(g => ({ id: g.id, name: g.name, priority: g.priority, collapsed: !!g.collapsed, isMetaGroup: !!g.isMetaGroup })) : null,
      secoes: st.amigos?.secoes?.map(s => ({ id: s.id, rotulo: s.rotulo, recolhido: s.recolhido, online: s.online, total: s.total })) ?? null,
      menu: menuView?.chave() ?? null, dialogo: !!dlgView?.aberto(), campo: !!campoView?.aberto(), arrasto: st.arrasto ? { ...st.arrasto } : null }),
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
#lc-compacto .lc-lt-x, #lc-compacto .lc-lt-volta { width:24px; height:24px; flex:none; background:none; border:none; color:var(--lc-mudo); font:inherit; font-size:13px; cursor:pointer;
  display:inline-grid; place-items:center; padding:0; }
#lc-compacto .lc-lt-x:hover, #lc-compacto .lc-lt-volta:hover { color:var(--lc-ouro2); }
#lc-compacto .lc-lt-volta { display:none; }
#lc-compacto .lc-lt-painel.lc-lt-estreito .lc-lt-volta { display:inline-grid; }
#lc-compacto .lc-lt-pcorpo { flex:1; min-height:0; display:flex; flex-direction:column; }
html.lc-lt-chat #lc-compacto [data-a="chat"], html.lc-lt-lista #lc-compacto [data-a="lista-amigos"], html.lc-lt-config #lc-compacto [data-a="config"],
html.lc-lt-coach #lc-compacto [data-a="coach"] { border-color:var(--lc-azul); box-shadow:0 0 0 1px rgba(10,200,185,.35) inset; }
html.lc-lt-editor #lc-compacto [data-a="meu-perfil"] .lc-cp-av { border-color:var(--lc-azul); box-shadow:0 0 0 2px rgba(10,200,185,.35); }
` + CSS_CHAT_LATERAL + CSS_AMIGOS + CSS_COACH + CSS_CONFIG + CSS_PERFIL;
