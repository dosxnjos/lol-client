// Tela A do fim de partida compacto: honra (roadmap/2026-10-13-client-compacto.md, passo 12; protótipo
// temp/2026-10-14-prototipo-compacto-fim-de-partida.html, aba A, aprovado com ajuste em 14/10/2026 ~20:00: "o botão
// 'enviar sem votar' pode ser apenas prosseguir. não precisa constar aliado/inimigo 1 a 5"; ~20:05 e ~20:08: nome do
// jogador e do campeão em cada linha, "adicionar" e "denunciar"). Contrato das telas: pengu/compacto/index.js.
// O roteador só monta esta tela no PreEndOfGame com a sequência honor-vote (currentSequenceEvent).
// Rotas (as do front da Riot, rcp-fe-lol-postgame 16.20, lido no assets.wad):
// - lista: GET /lol-honor-v2/v1/ballot (+ evento): eligibleAllies, eligibleOpponents, votePool.votes, honoredPlayers
//   [{recipientPuuid}] ao vivo (= "já votei"); SecondsToVote em GET /lol-honor-v2/v1/config (padrão 40).
// - votar (clique no coração): POST /lol-honor/v1/honor {recipientPuuid, honorType:'HEART'}.
// - votos: votePool.votes é o TOTAL da partida (a Riot faz votesRemaining = votes - selecionados, setInitialVotesRemaining
//   do rcp-fe-lol-postgame 16.20, lido em 14/10/2026); a cerimônia dela envia sozinha quando os votos dela acabam.
// - pronto/prosseguir (clique): POST /lol-honor/v1/ballot sem corpo. Lista vazia passados 5 s: "pular a espera" (clique) =
//   POST /lol-pre-end-of-game/v1/skip-pre-end-of-game, a mesma opção que a Riot dá. Nada é automático: nem voto, nem
//   pronto, nem pular. A cerimônia da Riot segue viva embaixo (relógio, envio automático, som): o relógio daqui é
//   estimativa e ao zerar não trava nada; voto e pronto valem até a Riot fechar a fase.
// Nome de cada linha: Riot ID do eog (o que o client mostra no pós-jogo), juntado pelo puuid; sem eog, só o campeão.
// Importável no node (tools/teste-compacto-fim-de-partida.mjs).
import { h, estilo, fotoCampeao, comIcone } from './comum.js';
import { botaoChat } from './chat-botao.js';
import { criarSala } from './chat-sala.js';
import { jogadoresDoEog, criarSocial, botoesJogador, abrirDenuncia, abrirJogador, nomeCompleto, POSICOES_PT, CSS_JOGADORES } from './jogador-acoes.js';
import { infoDaPartida, nomeFila, pintarTituloEu, lerEu } from './tela-posjogo.js';

export const HONRA = { segundosPadrao: 40, pularEsperaMs: 5000, tiqueMs: 500 };
export const ROTAS_HONRA = {
  ballot: '/lol-honor-v2/v1/ballot', config: '/lol-honor-v2/v1/config', votar: '/lol-honor/v1/honor', enviar: '/lol-honor/v1/ballot',
  pular: '/lol-pre-end-of-game/v1/skip-pre-end-of-game', seq: '/lol-pre-end-of-game/v1/currentSequenceEvent',
  eog: '/lol-end-of-game/v1/eog-stats-block',
};
export const _relogio = { agora: () => Date.now() }; // o teste troca
const SEQ_HONRA = 'honor-vote'; // = index.js SEQ_HONRA (importar o roteador daqui faria ciclo)
const RELER_BALLOT_MS = 2000; // ballot sem leitura (erro que não é 404): relê, senão ficava "lendo" para sempre

const num = v => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v));

// resposta do GET ballot -> {estado: 'lendo'|'lista'|'vazia'|'sem', votos, usados: Set(puuid), aliados, oponentes}
// 'sem' = a fila não tem honra (404); 'vazia' = a Riot ainda não mandou ninguém (ela mesma pede de novo)
export function lerBallot(r) {
  if (!r) return { estado: 'lendo', votos: 0, usados: new Set(), aliados: [], oponentes: [] };
  if (!r.ok) return { estado: r.status === 404 ? 'sem' : 'lendo', votos: 0, usados: new Set(), aliados: [], oponentes: [] };
  const b = r.json && typeof r.json === 'object' ? r.json : {};
  const cand = l => (Array.isArray(l) ? l : []).filter(c => c && typeof c.puuid === 'string' && c.puuid).map(c => ({
    puuid: c.puuid, campeaoId: num(c.championId), campeao: typeof c.championName === 'string' ? c.championName : '',
    posicao: POSICOES_PT[String(c.role || '').toUpperCase()] ? String(c.role).toUpperCase() : '', bot: c.botPlayer === true,
  }));
  const aliados = cand(b.eligibleAllies), oponentes = cand(b.eligibleOpponents);
  const usados = new Set((Array.isArray(b.honoredPlayers) ? b.honoredPlayers : []).map(x => (typeof x === 'string' ? x : x?.recipientPuuid)).filter(Boolean));
  return { estado: aliados.length || oponentes.length ? 'lista' : 'vazia', votos: Math.max(0, num(b.votePool?.votes) ?? 0), usados, aliados, oponentes, gameId: num(b.gameId) };
}

// botão de baixo -> {texto, acao: 'enviar'|'pular'|null, motivo (cinza), prim}. votando: votos em voo (o "prosseguir" não
// sai antes do POST honor voltar, senão o voto se perdia); seq: etapa lida (fora de honor-vote o POST ballot cairia fora
// da etapa: cinza). Revisão de 14/10/2026.
export function botaoHonra({ ballot, enviado, enviando, desdeMs, votando = 0, seq = SEQ_HONRA }) {
  if (enviado) return { texto: 'honra enviada', icone: 'ok', acao: null, motivo: 'esperando a Riot fechar a honra' };
  if (enviando) return { texto: 'ENVIANDO…', acao: null, motivo: 'enviando' };
  if (seq !== SEQ_HONRA) return { texto: 'a Riot já fechou a honra', acao: null, motivo: 'o pós-jogo entra sozinho' };
  if (votando > 0) return { texto: 'enviando o voto…', acao: null, motivo: 'esperando o voto chegar à Riot' };
  if (ballot.estado === 'sem') return { texto: 'nada para votar', acao: null, motivo: 'esta fila não tem honra' };
  if (ballot.estado === 'lendo') return { texto: 'lendo a honra…', acao: null, motivo: 'lendo a lista da Riot' };
  if (ballot.estado === 'vazia') {
    const falta = HONRA.pularEsperaMs - (desdeMs || 0);
    return falta > 0 ? { texto: `pular a espera (libera em ${Math.ceil(falta / 1000)} s)`, acao: null, motivo: 'a Riot só oferece depois de 5 s' }
      : { texto: 'pular a espera pela honra', acao: 'pular' };
  }
  const n = ballot.usados.size;
  return n ? { texto: `PRONTO · enviar ${n} voto${n > 1 ? 's' : ''}`, acao: 'enviar', prim: true } : { texto: 'prosseguir', acao: 'enviar' };
}

const estados = new WeakMap();

export function montar(raiz, ctx) {
  estilo('lc-cp-honra-estilo', CSS_HONRA);
  estilo('lc-cp-jogadores-estilo', CSS_JOGADORES);
  const est = {
    gameId: null, fila: null, custom: null, eu: null, rank: null, eog: null, jogadores: [], ballot: lerBallot(null), segundos: HONRA.segundosPadrao,
    inicio: _relogio.agora(), enviado: false, enviando: false, votando: new Set(), seq: 'honor-vote', refs: {}, corpo: null, lista: null, base: null,
  };
  estados.set(ctx, est);
  botaoChat(ctx);
  est.social = criarSocial(ctx, { gameId: () => est.gameId, custom: () => est.custom });
  est.social.aoMudar(() => pintarLista(ctx, est));
  est.corpo = h('div', { class: 'lc-cp-fp lc-cp-hn' });
  est.topo = h('div', { class: 'lc-cp-hn-top' });
  est.lista = h('div', { class: 'lc-cp-hn-lista' });
  est.sala = criarSala(ctx, { jogadores: () => est.jogadores, gameId: () => est.gameId, tamanho: 'recolhido', aoNome: j => abrirJogador(ctx, est.social, j, { raiz: ctx.raiz }) });
  // botão de baixo e aviso: um de cada por montagem, só o texto e o estado mudam (recriar o botão a cada 500 ms engolia o
  // clique que começava num e terminava no outro; revisão de 14/10/2026)
  est.btBase = h('button', { class: 'lc-cp-btn lc-cp-hn-bt', dataset: { a: 'honra-base', acao: '' }, on: { click: ctx.seguro(e => clicarBase(ctx, est, e)) } });
  est.avisoBase = h('div', { class: 'lc-cp-aviso-l' });
  est.base = h('div', { class: 'lc-cp-base' }, est.btBase, est.avisoBase);
  est.corpo.append(est.topo, est.lista, est.sala.el, est.base);
  raiz.append(est.corpo);
  pintar(ctx, est);
  // evento sem dados não é "sem honra" (isso só o 404 do GET diz): relê
  ctx.observar(ROTAS_HONRA.ballot, msg => {
    if (msg?.eventType === 'Delete') return;
    if (msg?.data) receberBallot(ctx, est, { ok: true, status: 200, json: msg.data }); else relerBallot(ctx, est);
  });
  ctx.observar(ROTAS_HONRA.eog, msg => { if (msg?.eventType !== 'Delete' && msg?.data) receberEog(ctx, est, msg.data); });
  ctx.observar(ROTAS_HONRA.seq, msg => mudarSeq(ctx, est, msg?.eventType === 'Delete' ? '' : String(msg?.data?.name ?? '')));
  ctx.intervalo(() => tique(ctx, est), HONRA.tiqueMs);
  return carregar(ctx, est);
}

export function desmontar(raiz, ctx) { estados.delete(ctx); }

async function carregar(ctx, est) {
  const [s, b, c, eog] = await Promise.all([
    ctx.lcu('GET', '/lol-gameflow/v1/session'), ctx.lcu('GET', ROTAS_HONRA.ballot), ctx.lcu('GET', ROTAS_HONRA.config), ctx.lcu('GET', ROTAS_HONRA.eog),
  ]);
  if (!ctx.vivo()) return;
  const p = infoDaPartida(s.ok ? s.json : null);
  // sessão que falhou não apaga um gameId já sabido (sem ele, o eog de qualquer partida passaria)
  est.gameId = p.gameId ?? est.gameId; est.fila = p.fila ?? num(ctx.info?.fila); est.custom = p.custom ?? ctx.info?.custom ?? null;
  const seg = num(c.ok ? c.json?.SecondsToVote : null);
  if (seg > 0 && seg < 300) est.segundos = seg;
  receberBallot(ctx, est, b); // antes do eog: sem a sessão, o gameId do ballot é quem diz se o eog é desta partida
  if (eog.ok && eog.json) receberEog(ctx, est, eog.json);
  est.sala.ler(); // a sala só é aceita com o gameId, que chegou agora
  est.social.ler();
  const eu = await lerEu(ctx);
  if (!ctx.vivo()) return;
  Object.assign(est, eu);
  pintar(ctx, est);
}

function receberEog(ctx, est, eog) {
  const gid = num(eog?.gameId);
  // eog de outra partida (o client guarda o último): só o desta. Sem gameId da sessão nem do ballot, nenhum (a denúncia e
  // a amizade usariam o gameId de um eog antigo)
  if (!gid || gid !== est.gameId) return;
  est.eog = eog;
  est.jogadores = jogadoresDoEog(eog);
  pintar(ctx, est);
}

// GET do ballot fora da carga (evento sem dados, ballot ainda "lendo"): um por vez
async function relerBallot(ctx, est) {
  if (est.relendo) return;
  est.relendo = true;
  est.leuBallotEm = _relogio.agora();
  let r;
  try { r = await ctx.lcu('GET', ROTAS_HONRA.ballot); } finally { est.relendo = false; }
  if (!ctx.vivo()) return;
  // erro que não é 404 não apaga uma lista já lida (só "lendo" segue "lendo" e tenta de novo)
  if (!r.ok && r.status !== 404 && est.ballot.estado !== 'lendo') return;
  receberBallot(ctx, est, r);
}

function receberBallot(ctx, est, r) {
  const novo = lerBallot(r);
  est.leuBallotEm = _relogio.agora();
  // ballot de outra partida (o client guarda o último): ignora
  if (novo.gameId && est.gameId && novo.gameId !== est.gameId) return;
  if (novo.gameId && !est.gameId) est.gameId = novo.gameId; // sessão sem gameId: vale o do ballot
  if (novo.estado === 'lista' && est.ballot.estado !== 'lista') est.listaDesde = _relogio.agora();
  if (novo.estado === 'vazia' && est.ballot.estado !== 'vazia') est.vaziaDesde = _relogio.agora();
  // voto dado aqui e ainda não refletido no ballot segue contando (não volta, como na Riot)
  for (const p of est.ballot.usados) if (est.votados?.has(p)) novo.usados.add(p);
  est.ballot = novo;
  pintar(ctx, est);
}

// jogador do eog para o candidato do ballot (puuid); sem eog, só o que o ballot traz (campeão), sem nome
function jogadorDe(est, c) {
  const j = est.jogadores.find(x => x.puuid === c.puuid);
  return j ? { ...j, campeaoId: j.campeaoId ?? c.campeaoId, campeao: j.campeao || c.campeao, posicao: j.posicao || c.posicao }
    : { puuid: c.puuid, summonerId: null, gameId: null, nome: '', tag: '', campeaoId: c.campeaoId, campeao: c.campeao, posicao: c.posicao, bot: c.bot };
}

async function votar(ctx, est, c, e) {
  if (e?.isTrusted === false) return;
  const b = est.ballot;
  if (est.enviado || est.enviando || est.seq !== SEQ_HONRA || b.usados.has(c.puuid) || est.votando.has(c.puuid) || b.usados.size + est.votando.size >= b.votos) return;
  est.votando.add(c.puuid);
  pintar(ctx, est);
  const r = await ctx.lcu('POST', ROTAS_HONRA.votar, { recipientPuuid: c.puuid, honorType: 'HEART' });
  est.votando.delete(c.puuid);
  if (!ctx.vivo()) return;
  if (r.ok) { (est.votados ||= new Set()).add(c.puuid); est.ballot.usados.add(c.puuid); }
  else ctx.avisar(`o voto não foi (${r.status}): a honra pode ter fechado`, true);
  pintar(ctx, est);
  const nb = await ctx.lcu('GET', ROTAS_HONRA.ballot);
  if (ctx.vivo() && nb.ok) receberBallot(ctx, est, nb);
}

const botaoAgora = est => botaoHonra({ ballot: est.ballot, enviado: est.enviado, enviando: est.enviando, votando: est.votando.size, seq: est.seq,
  desdeMs: _relogio.agora() - (est.vaziaDesde || _relogio.agora()) });

// etapa da Riot (evento da tela ou a leitura do roteador, ctx.seq): fora de honor-vote, voto e prosseguir travam
function mudarSeq(ctx, est, nome) {
  if (typeof nome !== 'string' || nome === est.seq) return;
  est.seq = nome;
  pintar(ctx, est);
}

async function clicarBase(ctx, est, e) {
  if (e?.isTrusted === false) return;
  const b = botaoAgora(est);
  if (!b.acao) return;
  est.enviando = true;
  pintar(ctx, est);
  const r = await ctx.lcu('POST', b.acao === 'pular' ? ROTAS_HONRA.pular : ROTAS_HONRA.enviar);
  est.enviando = false;
  if (!ctx.vivo()) return;
  if (r.ok) est.enviado = true;
  else ctx.avisar(`${b.acao === 'pular' ? 'pular a espera' : 'enviar a honra'} falhou (${r.status}): a Riot pode ter fechado a fase`, true);
  pintar(ctx, est);
}

function abrirDenunciaDe(ctx, est, j) {
  abrirDenuncia(ctx, est.social, j, { raiz: ctx.raiz });
}

// relógio estimado: só a barra e o texto mudam (o resto não repinta a cada meio segundo)
function tique(ctx, est) {
  const { barra, seg } = est.refs;
  const rest = Math.max(0, est.segundos - (_relogio.agora() - est.inicio) / 1000);
  if (barra) { barra.style.width = `${(rest / est.segundos * 100).toFixed(1)}%`; barra.parentNode?.classList?.toggle?.('lc-cp-fim', rest <= 0); }
  if (seg) seg.textContent = rest > 0 ? `~${Math.ceil(rest)} s` : 'tempo estimado acabou';
  // etapa que o roteador leu (o evento da etapa é [S]); ballot sem leitura relê a cada RELER_BALLOT_MS
  mudarSeq(ctx, est, ctx.seq);
  if (est.ballot.estado === 'lendo' && !est.relendo && _relogio.agora() - (est.leuBallotEm || 0) >= RELER_BALLOT_MS) relerBallot(ctx, est);
  // lista vazia: o "pular a espera" libera aos 5 s (o botão é o mesmo; só o texto muda)
  pintarBase(ctx, est);
}

function pintar(ctx, est) {
  if (!ctx.vivo() || !est.corpo) return;
  pintarTituloEu(ctx, est.eu, est.rank, 'honra');
  pintarTopo(ctx, est);
  pintarLista(ctx, est);
  pintarBase(ctx, est);
}

function pintarTopo(ctx, est) {
  const b = est.ballot;
  const eu = est.jogadores.find(j => j.eu);
  const sobra = Math.max(0, b.votos - b.usados.size);
  const rest = Math.max(0, est.segundos - (_relogio.agora() - est.inicio) / 1000);
  const barra = h('i', { style: { width: `${(rest / est.segundos * 100).toFixed(1)}%` } });
  const seg = h('span', {}, rest > 0 ? `~${Math.ceil(rest)} s` : 'tempo estimado acabou');
  est.refs = { barra, seg };
  est.topo.replaceChildren( // (h() já descarta os null dos filhos)
    h('div', { class: 'lc-cp-hn-l1' }, h('span', { class: 'lc-cp-hn-tt' }, 'HONRA'),
      h('span', { class: 'lc-cp-nota' }, [nomeFila(est.fila), eu?.campeao].filter(Boolean).join(' · ')),
      b.estado === 'lista' ? h('span', { class: 'lc-cp-hn-vt', title: 'votos que sobram nesta partida (voto dado não volta, como na Riot)' }, 'votos: ', h('b', {}, String(sobra)), ` de ${b.votos}`) : null),
    h('div', { class: 'lc-cp-relogio' + (rest <= 0 ? ' lc-cp-fim' : '') }, barra),
    h('div', { class: 'lc-cp-hn-l2' }, seg, h('span', {}, 'estimado: o relógio de verdade é o da tela da Riot')));
}

function pintarLista(ctx, est) {
  if (!ctx.vivo() || !est.lista) return;
  const b = est.ballot;
  if (est.seq !== 'honor-vote') { // '' = a Riot fechou a etapa; outro nome = a próxima (celebração)
    est.lista.replaceChildren(h('div', { class: 'lc-cp-hn-vazio' }, h('b', {}, 'a Riot fechou a honra'), 'o pós-jogo entra sozinho em instantes.'));
    return;
  }
  if (b.estado === 'sem') {
    est.lista.replaceChildren(h('div', { class: 'lc-cp-hn-vazio' }, h('b', {}, 'sem honra nesta partida'),
      'a Riot não mandou ninguém para honrar. Nada a fazer: o pós-jogo aparece quando ela fechar esta fase.'));
    return;
  }
  if (b.estado === 'lendo' || b.estado === 'vazia') {
    est.lista.replaceChildren(h('div', { class: 'lc-cp-hn-vazio' }, h('b', {}, b.estado === 'lendo' ? 'lendo a honra…' : 'buscando quem pode ser honrado…'),
      b.estado === 'vazia' ? 'a Riot repete a busca sozinha; a lista aparece quando chegar. Depois de 5 s, a espera pode ser pulada.' : ''));
    return;
  }
  const sobra = b.votos - b.usados.size - est.votando.size;
  const linha = c => {
    const j = jogadorDe(est, c);
    const on = b.usados.has(c.puuid), voando = est.votando.has(c.puuid);
    const nome = nomeCompleto(j);
    const coracao = h('button', { class: 'lc-cp-coracao' + (on ? ' lc-cp-on' : ''), dataset: { a: 'honrar', puuid: c.puuid },
      title: on ? 'voto dado (não volta, como na Riot)' : est.enviado ? 'honra já enviada' : sobra <= 0 ? 'sem votos sobrando' : `honrar ${nome || j.campeao || 'o jogador'}`,
      on: { click: ctx.seguro(e => votar(ctx, est, c, e)) } }, voando ? '…' : comIcone('honrar', on ? 'honrado' : 'honrar', { tam: 12, cheio: on }));
    coracao.disabled = on || voando || est.enviado || est.enviando || sobra <= 0;
    return h('div', { class: 'lc-cp-hj' + (on ? ' lc-cp-on' : ''), dataset: { puuid: c.puuid } },
      fotoCampeao(j.campeaoId, { tam: 32, nome: j.campeao }),
      h('div', { class: 'lc-cp-hn-n' }, h('b', { title: nome || undefined }, nome || j.campeao || '?'),
        h('small', {}, [nome ? j.campeao : '', POSICOES_PT[j.posicao] || ''].filter(Boolean).join(' · '))),
      botoesJogador(ctx, est.social, j, { aoDenunciar: x => abrirDenunciaDe(ctx, est, x) }),
      coracao);
  };
  const honradosAli = b.aliados.filter(c => b.usados.has(c.puuid)).length;
  // replaceChildren(null) escreveria "null" na tela: só elementos
  est.lista.replaceChildren(...[
    h('div', { class: 'lc-cp-hn-sec' }, h('span', {}, 'seu time'), h('span', {}, `${honradosAli} de ${b.aliados.length} honrados`)),
    ...b.aliados.map(linha),
    b.oponentes.length ? h('div', { class: 'lc-cp-hn-sec' }, h('span', {}, 'adversários'), h('span', {}, 'a Riot deixa honrar')) : null,
    ...b.oponentes.map(linha)].filter(Boolean));
}

// atualiza o botão e o aviso de baixo no lugar (mesmo elemento: o clique dele nunca cai num botão que sumiu)
function pintarBase(ctx, est) {
  if (!ctx.vivo() || !est.btBase) return;
  const bt = botaoAgora(est);
  const rest = est.segundos - (_relogio.agora() - est.inicio) / 1000;
  const botao = est.btBase;
  const classe = 'lc-cp-btn lc-cp-hn-bt' + (bt.prim ? ' lc-cp-prim' : '');
  if (botao.className !== classe) botao.className = classe;
  botao.dataset.acao = bt.acao || '';
  botao.setAttribute('title', bt.motivo || '');
  // o botão nasce uma vez (ARMADILHAS "botão recriado"): só o miolo muda, com o ícone do modelo (bt.icone) antes do texto
  if (botao.textContent !== bt.texto || (botao.dataset.ic || '') !== (bt.icone || '')) {
    botao.dataset.ic = bt.icone || '';
    botao.replaceChildren(...(bt.icone ? comIcone(bt.icone, bt.texto) : [bt.texto]));
  }
  botao.disabled = !bt.acao;
  const aviso = est.enviado ? 'esperando a Riot fechar a honra; o pós-jogo entra sozinho'
    : est.seq !== SEQ_HONRA ? 'a Riot fechou a honra: o pós-jogo entra sozinho'
      : est.ballot.estado === 'vazia' ? 'pular a espera é a mesma opção que a Riot dá'
        : est.ballot.estado === 'sem' ? 'jogar de novo libera quando esta fase acabar'
          : rest <= 0 ? 'tempo estimado acabou: a Riot envia sozinha e fecha a fase. Até lá, voto e prosseguir seguem valendo'
            : 'sem apertar o botão, a honra espera o tempo acabar · jogar de novo libera depois';
  if (est.avisoBase.textContent !== aviso) est.avisoBase.textContent = aviso;
}

export const CSS_HONRA = `
#lc-compacto .lc-cp-fp { flex:1; min-height:0; display:flex; flex-direction:column; margin:-12px -14px; }
#lc-compacto .lc-cp-hn-top { flex:none; padding:8px 12px 7px; border-bottom:1px solid var(--lc-linha2); display:flex; flex-direction:column; gap:5px; }
#lc-compacto .lc-cp-hn-l1 { display:flex; align-items:baseline; gap:8px; min-width:0; }
#lc-compacto .lc-cp-hn-l1 .lc-cp-nota { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; min-width:0; }
#lc-compacto .lc-cp-hn-tt { font-size:17px; letter-spacing:.2em; font-weight:700; color:var(--lc-ouro2); flex:none; }
#lc-compacto .lc-cp-hn-vt { margin-left:auto; font-size:12px; color:var(--lc-mudo); white-space:nowrap; flex:none; }
#lc-compacto .lc-cp-hn-vt b { color:#ff8ab0; font-size:15px; }
#lc-compacto .lc-cp-relogio { height:5px; background:#1b2530; position:relative; }
#lc-compacto .lc-cp-relogio i { position:absolute; left:0; top:0; bottom:0; background:var(--lc-azul); transition:width .25s linear; }
#lc-compacto .lc-cp-relogio.lc-cp-fim i { background:var(--lc-verm); }
#lc-compacto .lc-cp-hn-l2 { display:flex; justify-content:space-between; gap:8px; font-size:10.5px; color:var(--lc-mudo); }
#lc-compacto .lc-cp-hn-lista { flex:1; min-height:0; overflow:auto; padding:4px 10px 6px; }
#lc-compacto .lc-cp-hn-sec { font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--lc-mudo); padding:6px 2px 3px; display:flex; justify-content:space-between; }
#lc-compacto .lc-cp-hj { display:grid; grid-template-columns:32px 1fr auto 82px; gap:7px; align-items:center; height:42px; padding:0 4px;
  border-bottom:1px solid rgba(60,60,65,.45); }
#lc-compacto .lc-cp-hj.lc-cp-on { background:linear-gradient(90deg,rgba(255,105,160,.10),rgba(255,105,160,0)); }
#lc-compacto .lc-cp-hn-n { min-width:0; line-height:1.2; }
#lc-compacto .lc-cp-hn-n b { display:block; font-size:12.5px; color:var(--lc-ouro2); font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#lc-compacto .lc-cp-hn-n small { display:block; color:var(--lc-mudo); font-size:10.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#lc-compacto .lc-cp-coracao { white-space:nowrap; height:28px; border:1px solid var(--lc-linha); background:var(--lc-pan2); color:var(--lc-mudo); font-family:inherit;
  font-size:12px; display:inline-flex; align-items:center; justify-content:center; gap:4px; padding:0 6px; cursor:pointer; }
#lc-compacto .lc-cp-coracao:hover:not([disabled]) { border-color:#ff8ab0; color:#ffd0e0; }
#lc-compacto .lc-cp-coracao.lc-cp-on { background:rgba(255,105,160,.16); border-color:#ff69a0; color:#ffd0e0; cursor:default; }
#lc-compacto .lc-cp-coracao[disabled]:not(.lc-cp-on) { opacity:.35; cursor:not-allowed; }
#lc-compacto .lc-cp-hn-vazio { padding:26px 12px; text-align:center; color:var(--lc-mudo); font-size:12.5px; line-height:1.5; }
#lc-compacto .lc-cp-hn-vazio b { display:block; color:var(--lc-ouro2); font-size:14px; margin-bottom:4px; }
#lc-compacto .lc-cp-base { flex:none; padding:7px 12px 9px; display:flex; flex-direction:column; gap:6px; border-top:1px solid var(--lc-linha2); background:rgba(1,10,19,.9); }
#lc-compacto .lc-cp-hn-bt { width:100%; padding:10px; font-size:14px; letter-spacing:.08em; }
#lc-compacto .lc-cp-aviso-l { font-size:11px; color:var(--lc-mudo); text-align:center; line-height:1.3; }
`;
