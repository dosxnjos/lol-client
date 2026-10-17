// Chat da sala do time dentro da camada compacta (roadmap/2026-10-13-client-compacto.md, passo 12, tela C; pedido de
// 14/10/2026: "o chat pós-jogo ... com a foto dos campeões ... na parte de baixo, em cima do botão de jogar de novo"; e a
// seleção de campeões desde 16/10/2026, roadmap/2026-10-16-chat-da-sala-som-icones.md etapa A).
// Uma faixa (dock) com 3 tamanhos: recolhido (só a última linha e o contador), normal e alto. Na honra e na seleção nasce
// recolhida; no pós-jogo, aberta.
// - sala: GET /lol-chat/v1/conversations, a de type 'postGame' DESTA partida (id <gameId>-eog@...; sem gameId, nenhuma); a
//   do champ select, do lobby, as 1:1 e a do pós-jogo anterior nunca. Na seleção quem escolhe a sala é a tela (opção achar:
//   a championSelect desta sessão, lateral-chat.acharSalaTime). Da conversa só o id e o type ficam na memória: password e
//   mucJwtDto (credencial da sala) nunca são guardados nem logados.
// - mensagens: GET .../{id}/messages a cada 1,5 s enquanto a tela está montada, com a faixa recolhida também (é assim que ela
//   sabe que chegou mensagem para crescer; o evento da LCU para mensagem nova segue [S]). Custo: 1 GET a cada 1,5 s, mais
//   participants a cada 4 voltas só onde a faixa de presença existe (pós-jogo e honra; na seleção, não).
//   Quem falou: as chaves do remetente (fromPuuid, fromObfuscatedPuuid, fromSummonerId, fromObfuscatedSummonerId, fromId,
//   fromPid: as que o getDisplayName do rcp-fe-lol-social usa) -> jogador (do eog no fim de partida; do myTeam da sessão na
//   seleção, só campeão e posição). No fim de partida: foto do campeão, nome como o client mostra no pós-jogo e cor do time; o
//   modo de nome é o do chat do pós-jogo (cfg.chatPosjogo.nomes: ambos/campeão/jogador).
//   "entrou/saiu da sala" some (como no client grande); só o contador diz quantos estão.
// - cresce sozinha (exceção da regra "nada do chat abre sozinho", 16/10/2026; cfg.compacto.chatSalaCresce): recolhida e chega
//   mensagem nova de OUTRO jogador (nunca a minha, nunca system, nunca histórica nem a que já estava na 1ª leitura) = altura
//   normal. Só a altura: nenhum foco de teclado, nenhuma geometria de janela, nenhum "lida" na LCU (PUT conversations/active).
// - enviar: só Enter ou clique dele; corpo do client (rcp-fe-lol-social sendMessage): {type:'chat', fromId, fromSummonerId,
//   isHistorical:false, timestamp, body}. Chat bloqueado pela Riot (player-mutes[eu].isSystemMuted): o client nem
//   manda; aqui o campo fica cinza com o motivo.
// Importável no node: nada de DOM no topo.
import { h, estilo, fotoCampeao } from './comum.js';
import { nomeCompleto } from './jogador-acoes.js';

export const SALA = { cadaMs: 1500, textoMax: 500, msgsMax: 100, participantesCada: 4 };
export const ALTURAS = { normal: 168, alto: 300, recolhido: 26 };
const rascunhos = new Map(); // id da sala -> texto não enviado (a honra e o pós-jogo são telas diferentes)
export const _esquecerRascunhos = () => rascunhos.clear(); // só teste

// conversas + gameId desta partida -> {id, type} da sala do pós-jogo | null (nada além disso sai daqui). Só a sala DESTA
// partida (id "<gameId>-eog@...", sonda de 14/10; confere só "<gameId>-"): a da partida anterior pode seguir na lista e a
// mensagem iria para os 9 de lá (revisão de 14/10/2026). Sem gameId, nenhuma.
export const salaDaPartida = (id, gameId) => Number(gameId) > 0 && typeof id === 'string' && id.startsWith(`${Number(gameId)}-`);
export function acharSala(conversas, gameId) {
  const c = (Array.isArray(conversas) ? conversas : []).find(x => x && x.type === 'postGame' && salaDaPartida(x.id, gameId));
  return c ? { id: c.id, type: c.type } : null;
}

// sala da seleção DESTA sessão, pela regra do front da Riot (rcp-fe-lol-social 16.20, lido no assets.wad em 16/10/2026: a sala
// championSelect é conversations.find(c => c.id.startsWith(session.chatDetails.multiUserChatId) && c.type === 'championSelect')).
// muc = só o multiUserChatId (a senha e o mucJwtDto da sessão nunca passam por aqui). Sem muc, nenhuma: a de uma seleção
// anterior (dodge) pode seguir na lista. A do lobby tem outro type (teamBuilder/customGame) e nunca casa. -> {id, type} | null
export const mucDaSessao = s => (typeof s?.chatDetails?.multiUserChatId === 'string' ? s.chatDetails.multiUserChatId : '');
export const salaDaSelecao = (id, muc) => !!muc && typeof id === 'string' && id.toLowerCase().startsWith(String(muc).toLowerCase());
export function acharSalaSelecao(conversas, muc) {
  const c = (Array.isArray(conversas) ? conversas : []).find(x => x && x.type === 'championSelect' && salaDaSelecao(x.id, muc));
  return c ? { id: c.id, type: c.type } : null;
}

// mensagens -> {linhas (chat/groupchat, na ordem, só as MSGS_MAX últimas), naSala (null = não sei), sairam: Set(puuid),
// eventos: Map(puuid -> 'dentro'|'saiu') pelo último sinal: joined_room ou fala = dentro, left_room = saiu}
export function lerMensagens(msgs) {
  const lista = Array.isArray(msgs) ? msgs.filter(m => m && typeof m === 'object') : [];
  const dentro = new Set(), sairam = new Set(), eventos = new Map();
  let viuEntrada = false;
  for (const m of lista) {
    if (!m.fromPuuid) continue;
    if ((m.type === 'chat' || m.type === 'groupchat') && typeof m.body === 'string') { eventos.set(m.fromPuuid, 'dentro'); continue; }
    if (m.type !== 'system') continue;
    if (m.body === 'joined_room') { viuEntrada = true; dentro.add(m.fromPuuid); sairam.delete(m.fromPuuid); eventos.set(m.fromPuuid, 'dentro'); }
    else if (m.body === 'left_room') { dentro.delete(m.fromPuuid); sairam.add(m.fromPuuid); eventos.set(m.fromPuuid, 'saiu'); }
  }
  // a sala é MUC: a mensagem (a dele também, enviada com type 'chat') volta 'groupchat' (sonda de 14/10; o filtro só 'chat'
  // deixava a sala vazia, relato de 15/10/2026). Os dois tipos, como o isChatMessage do rcp-fe-lol-social
  const linhas = lista.filter(m => (m.type === 'chat' || m.type === 'groupchat') && typeof m.body === 'string').slice(-SALA.msgsMax)
    .map(m => ({ id: String(m.id ?? ''), puuid: m.fromPuuid || null, de: chavesDe(m), hist: m.isHistorical === true, texto: m.body, quando: m.timestamp || '' }));
  return { linhas, naSala: viuEntrada ? dentro.size : null, sairam, eventos };
}

// chaves do remetente, na ordem do getDisplayName do rcp-fe-lol-social 16.20 (lido no assets.wad em 16/10/2026): fromPuuid,
// fromObfuscatedPuuid, fromSummonerId, fromObfuscatedSummonerId; mais fromId/fromPid (o "sou eu" do /lol-chat/v1/me). Na sala
// MUC os vazios vêm '' ou 0 (sonda de 14/10): ficam de fora. Só ids, nunca nome.
const vale = v => v !== undefined && v !== null && v !== '' && v !== 0 && v !== '0';
export const chavesDe = m => [m?.fromPuuid, m?.fromObfuscatedPuuid, m?.fromSummonerId, m?.fromObfuscatedSummonerId, m?.fromId, m?.fromPid]
  .filter(vale).map(String);
export const chaveLinha = l => l.id || `${l.quando}|${l.texto}`;

// mensagens novas de outro jogador desde a última leitura (a faixa cresce com elas). vistos = Set das chaves já vistas nesta
// sala | null (1ª leitura: tudo vira base, nada é novo: o que já estava na sala ao abrir é histórico); meus = Set das minhas
// chaves (/lol-chat/v1/me + a minha cell do myTeam ou o "eu" do eog: na ranqueada a minha fala pode vir só com as obfuscated).
// -> {novas, vistos} (vistos novo; o de entrada não muda)
export function novasDeOutros(linhas, vistos, meus = new Set()) {
  const lista = Array.isArray(linhas) ? linhas : [];
  const base = new Set(vistos || []);
  let novas = 0;
  for (const l of lista) {
    const k = chaveLinha(l);
    if (base.has(k)) continue;
    base.add(k);
    if (vistos && !l.hist && !(l.de || []).some(d => meus.has(d))) novas++;
  }
  return { novas, vistos: base };
}
// cresce? só recolhida, com a chave ligada e mensagem nova de outro jogador
export const deveCrescer = ({ tam, novas, ligado = true }) => ligado !== false && tam === 'recolhido' && novas > 0;

// jogadores -> Map(chave -> jogador): cada um casa por todas as chaves (j.chaves, Set de ids) e pelo puuid
export function mapaChaves(jogadores) {
  const m = new Map();
  for (const j of Array.isArray(jogadores) ? jogadores : []) {
    if (!j) continue;
    for (const k of [...(j.chaves || []), j.puuid].filter(vale).map(String)) if (!m.has(k)) m.set(k, j);
  }
  return m;
}
export const quemFalou = (l, mapa) => (l?.de?.length ? l.de : [l?.puuid].filter(Boolean)).map(k => mapa.get(String(k))).find(Boolean) || null;

// GET .../{id}/participants ([S]: rota que o rcp-fe-lol-social lê em toda conversa, LolChatParticipant com puuid no /help;
// o JS da Riot espera array) -> [{puuid, summonerId, gameName, gameTag}] | null (formato inesperado = não usa)
export function lerParticipantes(json) {
  const lista = Array.isArray(json) ? json : Array.isArray(json?.participants) ? json.participants : null;
  if (!lista) return null;
  return lista.filter(p => p && typeof p === 'object').map(p => ({
    puuid: typeof p.puuid === 'string' && p.puuid ? p.puuid : null,
    summonerId: Number(p.summonerId) > 0 ? Number(p.summonerId) : null,
    gameName: String(p.gameName ?? p.game_name ?? '').toLowerCase(), gameTag: String(p.gameTag ?? p.game_tag ?? '').toLowerCase() }));
}

// quem do eog está na sala (pedido de 15/10/2026 ~12:45: "mostrasse um ícone [...] quais campeões estão na sala ainda").
// jogadores (jogadoresDoEog, sem bot) + eventos (lerMensagens) + participantes (lerParticipantes | null) ->
// [{puuid, campeao, campeaoId, nome, tag, aliado, eu, estado: 'dentro'|'saiu'}], na ordem do eog.
// Sem participants que case com alguém: o último evento de cada um, e sem evento = dentro (sonda de 14/10: left_room de quem
// nunca teve joined_room; os 10 entram na sala no fim da partida e joined_room só vem de quem chega depois dele).
// Com participants que casa: quem está nela ou falou/entrou por último está; o resto saiu. Eu: sempre dentro.
export function presencaNaSala(jogadores, eventos = new Map(), participantes = null) {
  const js = (Array.isArray(jogadores) ? jogadores : []).filter(j => j && !j.bot);
  const casa = (j, p) => (!!p.puuid && p.puuid === j.puuid) || (!!p.summonerId && Number(j.summonerId) === p.summonerId)
    || (!!p.gameName && !!j.nome && p.gameName === String(j.nome).toLowerCase() && (!p.gameTag || !j.tag || p.gameTag === String(j.tag).toLowerCase()));
  const lista = Array.isArray(participantes) ? participantes : [];
  const casados = new Set(js.filter(j => !j.eu && lista.some(p => casa(j, p))));
  const pelaLista = casados.size > 0;
  return js.map(j => {
    const ev = j.puuid ? eventos.get(j.puuid) : undefined;
    const estado = j.eu ? 'dentro' : pelaLista ? (casados.has(j) || ev === 'dentro' ? 'dentro' : 'saiu') : ev || 'dentro';
    return { puuid: j.puuid || null, campeao: j.campeao || '', campeaoId: j.campeaoId || null, nome: j.nome || '', tag: j.tag || '',
      aliado: !!j.aliado, eu: !!j.eu, estado };
  });
}

// nome de quem falou, pelo modo do chat do pós-jogo -> [{texto, classe}]. O "(Campeão)" leva a cor do lado, como o nick (no chat
// expandido o chat-posjogo.js pinta o .message-name inteiro pelo time; pedido de 15/10/2026 ~12:45)
export function nomeNaSala(j, modo) {
  if (!j) return [{ texto: 'alguém', classe: 'lc-cp-nm' }];
  const cor = j.eu ? 'lc-cp-nm-eu' : j.aliado ? 'lc-cp-nm-al' : 'lc-cp-nm-in';
  const lado = `lc-cp-nm ${cor}`;
  const nome = j.nome || '', camp = j.campeao || '';
  if (modo === 'campeao' && camp) return [{ texto: camp, classe: lado }];
  if (modo === 'jogador' && nome) return [{ texto: nome, classe: lado }];
  if (nome && camp) return [{ texto: nome, classe: lado }, { texto: `(${camp})`, classe: `lc-cp-camp ${cor}` }];
  return [{ texto: nome || camp || '?', classe: lado }];
}

// corpo exato do client
export function corpoMensagem(texto, eu, agora = new Date()) {
  return { type: 'chat', fromId: eu?.id || undefined, fromSummonerId: eu?.summonerId ?? undefined, isHistorical: false,
    timestamp: agora.toISOString(), body: texto };
}

// textos da faixa do pós-jogo (a seleção passa os dela)
export const TEXTOS_POSJOGO = {
  titulo: 'sala do pós-jogo', semSala: 'a sala do pós-jogo não está aberta', semChave: 'esperando saber qual é a partida…',
  semChavePh: 'sem a partida, sem sala', semChaveTitulo: 'partida ainda não identificada: a mensagem não vai para a sala de outra partida',
};

// dock da sala. jogadores() -> lista do eog (ou o time da seleção: {chaves, campeao, campeaoId, eu, aliado}); gameId() -> a
// partida (a sala só é aceita se for dela); nomes() -> modo; aoNome(j) (opcional) ao clicar no nome; tamanho inicial.
// Seleção (e o que mais vier): achar(conversas) -> {id, type} | null escolhe a sala, mesma(sala) diz se ela ainda é a certa,
// pronta() diz se já se sabe qual sala procurar; nomeDe(j) -> [{texto, classe}] troca o nome; presenca false tira a faixa de
// quem está (e o GET de participants); textos troca os textos; aoPintar(el, tam) depois de cada pintura (a tela ajusta a altura);
// podeCrescer() false adia o crescer sozinho (fica pendente até a próxima volta em que puder).
// -> {el, atualizar(), tamanho(), sala()}
// O campo de texto e o botão nascem uma vez por montagem: repintar troca só o cabeçalho e as mensagens (recriar o <input>
// a cada mensagem nova tirava o foco dele no meio da digitação e o Enter seguinte ia para a Riot; revisão de 14/10/2026).
export function criarSala(ctx, { jogadores = () => [], gameId = () => null, nomes = () => ctx.cfg?.chatPosjogo?.nomes, tamanho = 'normal', aoNome = null, doc,
  achar = null, mesma = null, pronta = null, nomeDe = null, presenca: comPresenca = true, textos = {}, aoPintar = null, podeCrescer = null } = {}) {
  estilo('lc-cp-sala-estilo', CSS_SALA, ctx.raiz?.ownerDocument || ctx.raiz?.doc || globalThis.document);
  const T = { ...TEXTOS_POSJOGO, ...textos };
  const acharSalaAgora = achar || (conv => acharSala(conv, gameId()));
  const salaVale = mesma || (s => salaDaPartida(s.id, gameId()));
  const sabeQual = pronta || (() => Number(gameId()) > 0);
  const nomeDo = nomeDe || (j => nomeNaSala(j, nomes()));
  const est = { sala: null, linhas: [], naSala: null, sairam: new Set(), eventos: new Map(), participantes: null, voltas: 0, eu: null, mudo: false,
    tam: tamanho, vistas: 0, enviando: false, lendo: false, procurou: false, semPartida: false, vistos: null, cresceu: 0, pendente: false };
  const el = h('div', { doc, class: 'lc-cp-dock', dataset: { tam: est.tam } });
  let rolarFim = true, estrutura = null, assinatura = '';

  const naoLidas = () => Math.max(0, est.linhas.length - est.vistas);
  // o que muda a tela: repinta só quando isto muda (comparar só o tamanho da lista parava em 100 mensagens)
  const presenca = () => (comPresenca ? presencaNaSala(jogadores(), est.eventos, est.participantes) : []);
  const assinar = () => [est.linhas.length, est.linhas[est.linhas.length - 1]?.id ?? '', est.naSala, est.sairam.size, est.sala?.id ?? '', est.mudo,
    est.procurou, est.semPartida, est.tam, jogadores().length, presenca().map(p => p.estado[0]).join('')].join('|');
  const repintarSeMudou = () => { if (ctx.vivo() && assinar() !== assinatura) pintar(); };
  // minhas chaves: /lol-chat/v1/me + as do "eu" da lista de jogadores (na ranqueada a fala dele pode vir só com as obfuscated)
  const meus = () => new Set([est.eu?.id, est.eu?.pid, est.eu?.puuid, est.eu?.summonerId, ...jogadores().filter(j => j?.eu).flatMap(j => [...(j.chaves || []), j.puuid])]
    .filter(vale).map(String));
  const esquecerSala = () => { est.sala = null; est.linhas = []; est.naSala = null; est.eventos = new Map(); est.participantes = null; est.voltas = 0; est.vistos = null; };

  const ler = async () => {
    if (est.lendo || !ctx.vivo()) return;
    est.lendo = true;
    try {
      if (est.sala && !salaVale(est.sala)) esquecerSala(); // a partida (ou a seleção) mudou
      if (!est.sala) {
        // sem saber qual sala (partida/seleção), nenhuma (a da partida anterior pode estar na lista)
        est.semPartida = !sabeQual();
        if (est.semPartida) { est.procurou = true; return; }
        const r = await ctx.lcu('GET', '/lol-chat/v1/conversations');
        if (!ctx.vivo()) return;
        est.sala = r.ok ? acharSalaAgora(r.json) : null;
        est.procurou = true;
        if (!est.sala) return;
        if (rascunhos.has(est.sala.id) && !input.value) input.value = rascunhos.get(est.sala.id);
        const [eu, mudos] = await Promise.all([ctx.lcu('GET', '/lol-chat/v1/me'), ctx.lcu('GET', '/lol-chat/v1/player-mutes')]);
        if (!ctx.vivo()) return;
        if (eu.ok && eu.json && typeof eu.json === 'object') est.eu = { id: eu.json.id, pid: eu.json.pid, summonerId: eu.json.summonerId, puuid: eu.json.puuid };
        est.mudo = !!(mudos.ok && est.eu?.puuid && mudos.json?.[est.eu.puuid]?.isSystemMuted === true);
      }
      const sala = est.sala;
      const m = await ctx.lcu('GET', `/lol-chat/v1/conversations/${encodeURIComponent(sala.id)}/messages`);
      if (!ctx.vivo() || est.sala !== sala) return;
      if (m.status === 404) { esquecerSala(); return; } // a sala fechou
      if (!m.ok) return;
      Object.assign(est, lerMensagens(m.json));
      // cresce sozinha (cabeçalho): só a altura; o resto (foco, janela, "lida") ninguém toca aqui
      const nv = novasDeOutros(est.linhas, est.vistos, meus());
      est.vistos = nv.vistos;
      // podeCrescer() false (a seleção: o ponteiro dele mexeu na coluna há pouco; crescer agora empurra a grade e o clique cai no
      // campeão errado) = fica pendente e cresce na 1ª volta em que puder (revisão de 16/10/2026)
      const ligado = ctx.cfg?.compacto?.chatSalaCresce;
      if (deveCrescer({ tam: est.tam, novas: nv.novas, ligado })) est.pendente = true;
      if (est.pendente && deveCrescer({ tam: est.tam, novas: 1, ligado }) && (!podeCrescer || podeCrescer())) { est.cresceu++; mudarTam('normal'); }
      else if (ligado === false) est.pendente = false;
      // quem está na sala: participants ([S], só GET) na 1ª volta e a cada SALA.participantesCada voltas; falha = fica nos eventos
      if (comPresenca && est.voltas++ % SALA.participantesCada === 0) {
        const p = await ctx.lcu('GET', `/lol-chat/v1/conversations/${encodeURIComponent(est.sala.id)}/participants`);
        if (!ctx.vivo()) return;
        est.participantes = p.ok ? lerParticipantes(p.json) : null;
      }
      if (est.tam !== 'recolhido') est.vistas = est.linhas.length;
    } finally { est.lendo = false; repintarSeMudou(); }
  };

  const enviar = async e => {
    if (e?.isTrusted === false || est.enviando || est.mudo || !est.sala) return;
    const texto = String(input.value || '').trim();
    if (!texto) return;
    if (texto.length > SALA.textoMax) { ctx.avisar(`mensagem longa demais (máx. ${SALA.textoMax})`, true); return; }
    const sala = est.sala;
    // a sessão já mudou (seleção nova, outra partida) e a leitura ainda não trocou a sala: nada sai para a sala velha (revisão de
    // 16/10/2026); o texto fica no campo e a próxima volta da leitura acha a certa
    if (!salaVale(sala)) { esquecerSala(); pintar(); return; }
    est.enviando = true;
    bt.disabled = true;
    let r;
    try { r = await ctx.lcu('POST', `/lol-chat/v1/conversations/${encodeURIComponent(sala.id)}/messages`, corpoMensagem(texto, est.eu)); }
    finally { est.enviando = false; }
    if (!ctx.vivo()) return;
    // limpa só se o campo ainda tem o que foi enviado (ele pode ter seguido digitando)
    if (r.ok) { if (String(input.value || '').trim() === texto) input.value = ''; rascunhos.delete(sala.id); rolarFim = true; await ler(); }
    else ctx.avisar(`a mensagem não foi (${r.status}): a sala pode ter fechado`, true);
    pintar();
  };

  // campo e botão: uma vez por montagem (ver o cabeçalho de criarSala)
  const input = h('input', { doc, dataset: { a: 'sala-texto' }, maxlength: String(SALA.textoMax) });
  input.addEventListener('input', () => { if (est.sala) rascunhos.set(est.sala.id, String(input.value || '')); });
  input.addEventListener('keydown', ctx.seguro(e => {
    e.stopPropagation?.(); // as teclas do campo não vão para os atalhos da Riot
    if (e.key === 'Enter') { e.preventDefault?.(); return enviar(e); }
  }));
  const bt = h('button', { doc, class: 'lc-cp-btn', dataset: { a: 'sala-enviar' }, on: { click: ctx.seguro(e => enviar(e)) } }, 'enviar');
  const en = h('div', { doc, class: 'lc-cp-en' }, input, bt);
  const bloq = h('div', { doc, class: 'lc-cp-bloq' }, '⛔ chat bloqueado pela Riot nesta conta: só leitura, sem envio');
  const ms = h('div', { doc, class: 'lc-cp-ms' });
  const cab = h('div', { doc, class: 'lc-cp-dh', dataset: { a: 'sala-tam' },
    on: { click: ctx.seguro(e => { if (e?.target?.closest?.('button')) return; mudarTam(est.tam === 'recolhido' ? 'normal' : 'recolhido'); }) } });

  const mudarTam = t => { est.tam = t; est.pendente = false; if (t !== 'recolhido') { est.vistas = est.linhas.length; rolarFim = true; } pintar(); };

  function linha(l, mapa) {
    const j = quemFalou(l, mapa);
    const partes = nomeDo(j);
    const nome = h('span', { doc, class: 'lc-cp-nmw', title: j ? [nomeCompleto(j), j.campeao].filter(Boolean).join(' · ') : undefined,
      on: aoNome && j && !j.eu ? { click: ctx.seguro(() => aoNome(j)) } : undefined },
    ...partes.map(p => h('span', { doc, class: p.classe }, p.texto)));
    return h('div', { doc, class: 'lc-cp-cm' + (l.puuid && est.sairam.has(l.puuid) ? ' lc-cp-saiu' : '') },
      fotoCampeao(j?.campeaoId, { tam: 20, nome: j?.campeao || '', doc }),
      h('div', { doc, class: 'lc-cp-tx' }, nome, ' ', l.texto));
  }

  // [aliados][inimigos]: foto de 16 px com a borda da cor do lado; quem saiu fica apagado no mesmo lugar (a faixa não pula)
  function faixaPresenca(pres) {
    const dentro = pres.filter(p => p.estado === 'dentro').length;
    // a foto nasce com title = campeão, que ganharia do title do ícone ("saiu da sala" sumia no hover): tirar o de dentro
    const foto = p => { const f = fotoCampeao(p.campeaoId, { tam: 16, nome: p.campeao, doc }); f.removeAttribute?.('title'); return f; };
    const icone = p => h('span', { doc, class: `lc-cp-pres-j ${p.eu ? 'lc-cp-pres-eu' : p.aliado ? 'lc-cp-pres-al' : 'lc-cp-pres-in'}${p.estado === 'saiu' ? ' lc-cp-pres-saiu' : ''}`,
      title: `${[nomeCompleto(p), p.campeao].filter(Boolean).join(' · ')}: ${p.estado === 'saiu' ? 'saiu da sala' : 'na sala'}` },
    foto(p));
    const grupo = (lista, classe) => (lista.length ? h('span', { doc, class: `lc-cp-pres-g ${classe}` }, ...lista.map(icone)) : null);
    return h('span', { doc, class: 'lc-cp-pres', dataset: { a: 'sala-presenca' }, title: `${dentro} de ${pres.length} na sala` },
      grupo(pres.filter(p => p.aliado), 'lc-cp-pres-gal'), grupo(pres.filter(p => !p.aliado), 'lc-cp-pres-gin'));
  }

  function pintar() {
    if (!ctx.vivo()) return;
    assinatura = assinar();
    el.dataset.tam = est.tam;
    el.style.height = ALTURAS[est.tam] + 'px';
    const mapa = mapaChaves(jogadores());
    const ult = est.linhas[est.linhas.length - 1];
    const recolhido = est.tam === 'recolhido';
    const nl = naoLidas();
    cab.setAttribute('title', recolhido ? 'abrir o chat' : 'recolher o chat');
    // aberta e com o eog: a faixa de quem está na sala toma o lugar do contador (ícone de cada campeão; quem saiu, apagado)
    const pres = recolhido || !est.sala ? [] : presenca();
    // h() descarta os null; replaceChildren do DOM não (escreveria "null"): filtrar
    cab.replaceChildren(...['💬 ', h('b', { doc }, T.titulo),
      pres.length ? faixaPresenca(pres) : est.naSala !== null ? h('span', { doc }, ` · ${est.naSala} na sala`) : null,
      recolhido && nl ? h('span', { doc, class: 'lc-cp-un' }, String(nl)) : null,
      recolhido && ult ? h('span', { doc, class: 'lc-cp-ult' }, ...nomeDo(quemFalou(ult, mapa)).map(p => h('span', { doc, class: p.classe }, p.texto)), ' ', ult.texto) : null,
      h('span', { doc, class: 'lc-cp-tam' },
        !recolhido ? h('button', { doc, title: 'recolher', dataset: { a: 'sala-recolher' }, on: { click: ctx.seguro(() => mudarTam('recolhido')) } }, '▾') : null,
        est.tam !== 'alto' ? h('button', { doc, title: 'aumentar', dataset: { a: 'sala-aumentar' }, on: { click: ctx.seguro(() => mudarTam(recolhido ? 'normal' : 'alto')) } }, '▴') : null),
    ].filter(Boolean));
    // estrutura só muda com o tamanho ou o bloqueio: o campo (com o foco e o que ele digitou) fica no mesmo lugar
    const chave = recolhido ? 'r' : `a${est.mudo ? 'm' : ''}`;
    if (chave !== estrutura) { estrutura = chave; el.replaceChildren(...(recolhido ? [cab] : [cab, ms, est.mudo ? bloq : null, en].filter(Boolean))); }
    if (recolhido) return depois();
    let noFim = true;
    try { noFim = !(ms.scrollHeight > 0) || ms.scrollHeight - ms.scrollTop - ms.clientHeight < 24; } catch { /* sem layout */ }
    ms.replaceChildren(...(est.linhas.length ? est.linhas.map(l => linha(l, mapa))
      : [h('div', { doc, class: 'lc-cp-cm lc-cp-sis' }, !est.procurou ? 'procurando a sala…' : est.semPartida ? T.semChave
        : est.sala ? 'ninguém falou ainda' : T.semSala)]));
    input.setAttribute('placeholder', est.mudo ? 'envio bloqueado' : est.sala ? 'mensagem para a sala (Enter envia)' : est.semPartida ? T.semChavePh : 'sem sala');
    input.setAttribute('title', est.semPartida ? T.semChaveTitulo : '');
    input.disabled = est.mudo || !est.sala;
    bt.disabled = est.mudo || !est.sala || est.enviando;
    // mensagem nova desce sozinha só se ele já estava no fim (lendo lá em cima, fica onde está)
    if (rolarFim || noFim) { rolarFim = false; try { ms.scrollTop = 1e9; } catch { /* sem layout */ } }
    depois();
  }
  // a tela dona ajusta a altura depois de cada pintura (a seleção cabe a faixa nos 680 px); erro aqui não derruba a tela
  function depois() { try { aoPintar?.(el, est.tam); } catch (e) { (ctx.log || console.log)(`[lol-client] compacto: sala ajuste ${e?.message || e}`); } }

  pintar();
  ler();
  ctx.intervalo(() => ler(), SALA.cadaMs);
  // ler(): quem soube o gameId agora chama, sem esperar a próxima volta de 1,5 s
  return { el, atualizar: pintar, ler, tamanho: () => est.tam, sala: () => est.sala, estado: () => ({ ...est, sairam: [...est.sairam] }) };
}

export const CSS_SALA = `
#lc-compacto .lc-cp-dock { flex:none; display:flex; flex-direction:column; border-top:1px solid var(--lc-linha2); background:rgba(4,12,22,.92);
  overflow:hidden; }
#lc-compacto .lc-cp-dh { height:26px; flex:none; display:flex; align-items:center; gap:4px; padding:0 6px 0 10px; font-size:11px; color:var(--lc-mudo);
  border-bottom:1px solid rgba(70,55,20,.6); cursor:pointer; white-space:nowrap; }
#lc-compacto .lc-cp-dh b { color:var(--lc-ouro2); font-weight:600; }
#lc-compacto .lc-cp-un { background:var(--lc-verm); color:#fff; font-size:10px; font-weight:700; border-radius:8px; padding:0 5px; min-width:16px; height:15px;
  display:inline-grid; place-items:center; line-height:1; }
#lc-compacto .lc-cp-ult { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; color:#e8e2d0; margin-left:4px; }
#lc-compacto .lc-cp-tam { margin-left:auto; display:flex; gap:2px; }
#lc-compacto .lc-cp-tam button { background:none; border:1px solid transparent; color:var(--lc-mudo); font-size:11px; width:22px; height:20px; padding:0; cursor:pointer; }
#lc-compacto .lc-cp-tam button:hover { color:var(--lc-ouro2); border-color:var(--lc-linha); }
#lc-compacto .lc-cp-ms { flex:1; min-height:0; overflow:auto; padding:5px 8px; display:flex; flex-direction:column; gap:3px; user-select:text; }
#lc-compacto .lc-cp-cm { display:flex; gap:6px; align-items:flex-start; font-size:12px; line-height:1.3; color:#e8e2d0; }
#lc-compacto .lc-cp-cm .lc-cp-foto { font-size:9px; }
#lc-compacto .lc-cp-cm.lc-cp-saiu .lc-cp-foto { filter:grayscale(1) brightness(.6); }
#lc-compacto .lc-cp-cm.lc-cp-sis { color:var(--lc-mudo); font-style:italic; font-size:11px; justify-content:center; }
#lc-compacto .lc-cp-tx { min-width:0; padding-top:2px; overflow-wrap:anywhere; }
#lc-compacto .lc-cp-nmw { cursor:default; }
#lc-compacto .lc-cp-nmw[title] { cursor:pointer; }
#lc-compacto .lc-cp-nm { font-weight:600; }
#lc-compacto .lc-cp-nm-al { color:#58b3ff; } #lc-compacto .lc-cp-nm-in { color:#ff6b7f; } #lc-compacto .lc-cp-nm-eu { color:var(--lc-ouro); }
#lc-compacto .lc-cp-camp { opacity:.72; margin-left:3px; }
#lc-compacto .lc-cp-pres { display:inline-flex; align-items:center; gap:6px; margin-left:8px; min-width:0; overflow:hidden; }
#lc-compacto .lc-cp-pres-g { display:inline-flex; gap:2px; }
#lc-compacto .lc-cp-pres-gin { padding-left:6px; border-left:1px solid rgba(70,55,20,.8); }
#lc-compacto .lc-cp-pres-j { display:inline-flex; border:1px solid transparent; border-radius:2px; line-height:0; }
#lc-compacto .lc-cp-pres-j .lc-cp-foto { font-size:7px; }
#lc-compacto .lc-cp-pres-al { border-color:#58b3ff; } #lc-compacto .lc-cp-pres-in { border-color:#ff6b7f; } #lc-compacto .lc-cp-pres-eu { border-color:var(--lc-ouro); }
#lc-compacto .lc-cp-pres-saiu { border-color:#3c3c41; opacity:.35; filter:grayscale(1); }
#lc-compacto .lc-cp-en { height:34px; flex:none; display:flex; align-items:center; gap:6px; padding:0 8px; border-top:1px solid rgba(70,55,20,.6); }
#lc-compacto .lc-cp-en input { flex:1; min-width:0; height:24px; margin:0; background:var(--lc-bg); border:1px solid var(--lc-linha); color:var(--lc-ouro2);
  padding:0 8px; font:inherit; font-size:12px; user-select:text; }
#lc-compacto .lc-cp-en input:disabled { color:#6b6f76; border-color:#2a2d33; }
#lc-compacto .lc-cp-en .lc-cp-btn { height:24px; padding:0 10px; font-size:11.5px; display:inline-flex; align-items:center; }
#lc-compacto .lc-cp-bloq { font-size:11px; color:#ffb3bd; padding:3px 10px; background:rgba(232,64,87,.08); border-top:1px solid rgba(232,64,87,.3); }
`;
