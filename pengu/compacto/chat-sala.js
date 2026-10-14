// Chat da sala do pós-jogo dentro da camada compacta (roadmap/2026-10-13-client-compacto.md, passo 12, tela C; pedido de
// 14/10/2026: "o chat pós-jogo ... com a foto dos campeões ... na parte de baixo, em cima do botão de jogar de novo").
// Uma faixa (dock) com 3 tamanhos: recolhido (só a última linha e o contador), normal e alto. Na honra nasce recolhida;
// no pós-jogo, aberta.
// - sala: GET /lol-chat/v1/conversations, a de type 'postGame' DESTA partida (id <gameId>-eog@...; sem gameId, nenhuma); a
//   do champ select, do lobby, as 1:1 e a do pós-jogo anterior nunca. Da conversa só o id e o type ficam na memória: password e mucJwtDto (credencial da sala) nunca são guardados
//   nem logados.
// - mensagens: GET .../{id}/messages a cada 1,5 s com a faixa à vista (o evento da LCU para mensagem nova segue [S]).
//   Quem falou: fromPuuid -> jogador do eog (jogador-acoes.jogadoresDoEog): foto do campeão, nome como o client mostra no
//   pós-jogo e cor do time; o modo de nome é o do chat do pós-jogo (cfg.chatPosjogo.nomes: ambos/campeão/jogador).
//   "entrou/saiu da sala" some (como no client grande); só o contador diz quantos estão.
// - enviar: só Enter ou clique dele; corpo do client (rcp-fe-lol-social sendMessage): {type:'chat', fromId, fromSummonerId,
//   isHistorical:false, timestamp, body}. Chat bloqueado pela Riot (player-mutes[eu].isSystemMuted): o client nem
//   manda; aqui o campo fica cinza com o motivo.
// Importável no node: nada de DOM no topo.
import { h, estilo, fotoCampeao } from './comum.js';
import { nomeCompleto } from './jogador-acoes.js';

export const SALA = { cadaMs: 1500, textoMax: 500, msgsMax: 100 };
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

// mensagens -> {linhas (chat, na ordem, só as MSGS_MAX últimas), naSala (null = não sei), sairam: Set(puuid)}
export function lerMensagens(msgs) {
  const lista = Array.isArray(msgs) ? msgs.filter(m => m && typeof m === 'object') : [];
  const dentro = new Set(), sairam = new Set();
  let viuEntrada = false;
  for (const m of lista) {
    if (m.type !== 'system' || !m.fromPuuid) continue;
    if (m.body === 'joined_room') { viuEntrada = true; dentro.add(m.fromPuuid); sairam.delete(m.fromPuuid); }
    else if (m.body === 'left_room') { dentro.delete(m.fromPuuid); sairam.add(m.fromPuuid); }
  }
  const linhas = lista.filter(m => m.type === 'chat' && typeof m.body === 'string').slice(-SALA.msgsMax)
    .map(m => ({ id: String(m.id ?? ''), puuid: m.fromPuuid || null, texto: m.body, quando: m.timestamp || '' }));
  return { linhas, naSala: viuEntrada ? dentro.size : null, sairam };
}

// nome de quem falou, pelo modo do chat do pós-jogo -> [{texto, classe}]
export function nomeNaSala(j, modo) {
  if (!j) return [{ texto: 'alguém', classe: 'lc-cp-nm' }];
  const lado = j.eu ? 'lc-cp-nm lc-cp-nm-eu' : j.aliado ? 'lc-cp-nm lc-cp-nm-al' : 'lc-cp-nm lc-cp-nm-in';
  const nome = j.nome || '', camp = j.campeao || '';
  if (modo === 'campeao' && camp) return [{ texto: camp, classe: lado }];
  if (modo === 'jogador' && nome) return [{ texto: nome, classe: lado }];
  if (nome && camp) return [{ texto: nome, classe: lado }, { texto: `(${camp})`, classe: 'lc-cp-camp' }];
  return [{ texto: nome || camp || '?', classe: lado }];
}

// corpo exato do client
export function corpoMensagem(texto, eu, agora = new Date()) {
  return { type: 'chat', fromId: eu?.id || undefined, fromSummonerId: eu?.summonerId ?? undefined, isHistorical: false,
    timestamp: agora.toISOString(), body: texto };
}

// dock da sala. jogadores() -> lista do eog; gameId() -> a partida (a sala só é aceita se for dela); nomes() -> modo;
// aoNome(j) (opcional) ao clicar no nome; tamanho inicial. -> {el, atualizar(), tamanho(), sala()}
// O campo de texto e o botão nascem uma vez por montagem: repintar troca só o cabeçalho e as mensagens (recriar o <input>
// a cada mensagem nova tirava o foco dele no meio da digitação e o Enter seguinte ia para a Riot; revisão de 14/10/2026).
export function criarSala(ctx, { jogadores = () => [], gameId = () => null, nomes = () => ctx.cfg?.chatPosjogo?.nomes, tamanho = 'normal', aoNome = null, doc } = {}) {
  estilo('lc-cp-sala-estilo', CSS_SALA, ctx.raiz?.ownerDocument || ctx.raiz?.doc || globalThis.document);
  const est = { sala: null, linhas: [], naSala: null, sairam: new Set(), eu: null, mudo: false, tam: tamanho, vistas: 0, enviando: false,
    lendo: false, procurou: false, semPartida: false };
  const el = h('div', { doc, class: 'lc-cp-dock', dataset: { tam: est.tam } });
  let rolarFim = true, estrutura = null, assinatura = '';

  const porPuuid = () => new Map(jogadores().filter(j => j.puuid).map(j => [j.puuid, j]));
  const naoLidas = () => Math.max(0, est.linhas.length - est.vistas);
  // o que muda a tela: repinta só quando isto muda (comparar só o tamanho da lista parava em 100 mensagens)
  const assinar = () => [est.linhas.length, est.linhas[est.linhas.length - 1]?.id ?? '', est.naSala, est.sairam.size, est.sala?.id ?? '', est.mudo,
    est.procurou, est.semPartida, jogadores().length].join('|');
  const repintarSeMudou = () => { if (ctx.vivo() && assinar() !== assinatura) pintar(); };

  const ler = async () => {
    if (est.lendo || !ctx.vivo()) return;
    est.lendo = true;
    try {
      const gid = gameId();
      if (est.sala && !salaDaPartida(est.sala.id, gid)) { est.sala = null; est.linhas = []; est.naSala = null; } // a partida mudou
      if (!est.sala) {
        // sem saber a partida, nenhuma sala (a da partida anterior pode estar na lista)
        est.semPartida = !(Number(gid) > 0);
        if (est.semPartida) { est.procurou = true; return; }
        const r = await ctx.lcu('GET', '/lol-chat/v1/conversations');
        if (!ctx.vivo()) return;
        est.sala = r.ok ? acharSala(r.json, gid) : null;
        est.procurou = true;
        if (!est.sala) return;
        if (rascunhos.has(est.sala.id) && !input.value) input.value = rascunhos.get(est.sala.id);
        const [eu, mudos] = await Promise.all([ctx.lcu('GET', '/lol-chat/v1/me'), ctx.lcu('GET', '/lol-chat/v1/player-mutes')]);
        if (!ctx.vivo()) return;
        if (eu.ok && eu.json && typeof eu.json === 'object') est.eu = { id: eu.json.id, summonerId: eu.json.summonerId, puuid: eu.json.puuid };
        est.mudo = !!(mudos.ok && est.eu?.puuid && mudos.json?.[est.eu.puuid]?.isSystemMuted === true);
      }
      const m = await ctx.lcu('GET', `/lol-chat/v1/conversations/${encodeURIComponent(est.sala.id)}/messages`);
      if (!ctx.vivo()) return;
      if (m.status === 404) { est.sala = null; est.linhas = []; est.naSala = null; return; } // a sala fechou
      if (!m.ok) return;
      Object.assign(est, lerMensagens(m.json));
      if (est.tam !== 'recolhido') est.vistas = est.linhas.length;
    } finally { est.lendo = false; repintarSeMudou(); }
  };

  const enviar = async e => {
    if (e?.isTrusted === false || est.enviando || est.mudo || !est.sala) return;
    const texto = String(input.value || '').trim();
    if (!texto) return;
    if (texto.length > SALA.textoMax) { ctx.avisar(`mensagem longa demais (máx. ${SALA.textoMax})`, true); return; }
    const sala = est.sala;
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
  const bloq = h('div', { doc, class: 'lc-cp-bloq' }, '⛔ chat bloqueado pela Riot nesta conta: dá para ler, não dá para enviar');
  const ms = h('div', { doc, class: 'lc-cp-ms' });
  const cab = h('div', { doc, class: 'lc-cp-dh', dataset: { a: 'sala-tam' },
    on: { click: ctx.seguro(e => { if (e?.target?.closest?.('button')) return; mudarTam(est.tam === 'recolhido' ? 'normal' : 'recolhido'); }) } });

  const mudarTam = t => { est.tam = t; if (t !== 'recolhido') { est.vistas = est.linhas.length; rolarFim = true; } pintar(); };

  function linha(l, mapa) {
    const j = l.puuid ? mapa.get(l.puuid) : null;
    const partes = nomeNaSala(j, nomes());
    const nome = h('span', { doc, class: 'lc-cp-nmw', title: j ? [nomeCompleto(j), j.campeao].filter(Boolean).join(' · ') : undefined,
      on: aoNome && j && !j.eu ? { click: ctx.seguro(() => aoNome(j)) } : undefined },
    ...partes.map(p => h('span', { doc, class: p.classe }, p.texto)));
    return h('div', { doc, class: 'lc-cp-cm' + (l.puuid && est.sairam.has(l.puuid) ? ' lc-cp-saiu' : '') },
      fotoCampeao(j?.campeaoId, { tam: 20, nome: j?.campeao || '', doc }),
      h('div', { doc, class: 'lc-cp-tx' }, nome, ' ', l.texto));
  }

  function pintar() {
    if (!ctx.vivo()) return;
    assinatura = assinar();
    el.dataset.tam = est.tam;
    el.style.height = ALTURAS[est.tam] + 'px';
    const mapa = porPuuid();
    const ult = est.linhas[est.linhas.length - 1];
    const recolhido = est.tam === 'recolhido';
    const nl = naoLidas();
    cab.setAttribute('title', recolhido ? 'abrir o chat' : 'recolher o chat');
    // h() descarta os null; replaceChildren do DOM não (escreveria "null"): filtrar
    cab.replaceChildren(...['💬 ', h('b', { doc }, 'sala do pós-jogo'),
      est.naSala !== null ? h('span', { doc }, ` · ${est.naSala} na sala`) : null,
      recolhido && nl ? h('span', { doc, class: 'lc-cp-un' }, String(nl)) : null,
      recolhido && ult ? h('span', { doc, class: 'lc-cp-ult' }, ...nomeNaSala(ult.puuid ? mapa.get(ult.puuid) : null, nomes()).map(p => h('span', { doc, class: p.classe }, p.texto)), ' ', ult.texto) : null,
      h('span', { doc, class: 'lc-cp-tam' },
        !recolhido ? h('button', { doc, title: 'recolher', dataset: { a: 'sala-recolher' }, on: { click: ctx.seguro(() => mudarTam('recolhido')) } }, '▾') : null,
        est.tam !== 'alto' ? h('button', { doc, title: 'aumentar', dataset: { a: 'sala-aumentar' }, on: { click: ctx.seguro(() => mudarTam(recolhido ? 'normal' : 'alto')) } }, '▴') : null),
    ].filter(Boolean));
    // estrutura só muda com o tamanho ou o bloqueio: o campo (com o foco e o que ele digitou) fica no mesmo lugar
    const chave = recolhido ? 'r' : `a${est.mudo ? 'm' : ''}`;
    if (chave !== estrutura) { estrutura = chave; el.replaceChildren(...(recolhido ? [cab] : [cab, ms, est.mudo ? bloq : null, en].filter(Boolean))); }
    if (recolhido) return;
    let noFim = true;
    try { noFim = !(ms.scrollHeight > 0) || ms.scrollHeight - ms.scrollTop - ms.clientHeight < 24; } catch { /* sem layout */ }
    ms.replaceChildren(...(est.linhas.length ? est.linhas.map(l => linha(l, mapa))
      : [h('div', { doc, class: 'lc-cp-cm lc-cp-sis' }, !est.procurou ? 'procurando a sala…' : est.semPartida ? 'esperando saber qual é a partida…'
        : est.sala ? 'ninguém falou ainda' : 'a sala do pós-jogo não está aberta')]));
    input.setAttribute('placeholder', est.mudo ? 'envio bloqueado' : est.sala ? 'mensagem para a sala (Enter envia)' : est.semPartida ? 'sem a partida, sem sala' : 'sem sala');
    input.setAttribute('title', est.semPartida ? 'ainda não sei qual é a partida: a sala de outra partida não pode receber' : '');
    input.disabled = est.mudo || !est.sala;
    bt.disabled = est.mudo || !est.sala || est.enviando;
    // mensagem nova desce sozinha só se ele já estava no fim (lendo lá em cima, fica onde está)
    if (rolarFim || noFim) { rolarFim = false; try { ms.scrollTop = 1e9; } catch { /* sem layout */ } }
  }

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
#lc-compacto .lc-cp-en { height:34px; flex:none; display:flex; align-items:center; gap:6px; padding:0 8px; border-top:1px solid rgba(70,55,20,.6); }
#lc-compacto .lc-cp-en input { flex:1; min-width:0; height:24px; margin:0; background:var(--lc-bg); border:1px solid var(--lc-linha); color:var(--lc-ouro2);
  padding:0 8px; font:inherit; font-size:12px; user-select:text; }
#lc-compacto .lc-cp-en input:disabled { color:#6b6f76; border-color:#2a2d33; }
#lc-compacto .lc-cp-en .lc-cp-btn { height:24px; padding:0 10px; font-size:11.5px; display:inline-flex; align-items:center; }
#lc-compacto .lc-cp-bloq { font-size:11px; color:#ffb3bd; padding:3px 10px; background:rgba(232,64,87,.08); border-top:1px solid rgba(232,64,87,.3); }
`;
