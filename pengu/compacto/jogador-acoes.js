// Jogadores do fim de partida compacto: quem é quem (eog), "adicionar" e "denunciar" por jogador, igual ao client da Riot
// (roadmap/2026-10-13-client-compacto.md, passo 12; pedido do Gabriel de 14/10/2026 ~20:05 e ~20:08). Usado pela honra
// (tela-honra.js), pelos detalhes do pós-jogo e pelo chat da sala (tela-posjogo.js, chat-sala.js).
// Rotas e corpos lidos no JS da própria Riot (rcp-fe-lol-postgame e rcp-fe-lol-shared-components 16.20, assets.wad, só
// leitura: tools/ler-wad.py), nunca testados contra o client real:
// - adicionar: POST /lol-chat/v2/friend-requests {direction:'out', puuid} (playerActions.sendFriendRequest do pós-jogo).
//   405 = jogador bloqueado: a Riot oferece "desbloquear e adicionar" (DELETE blocked-players); aqui NÃO: só avisa e
//   oferece o client normal (desbloquear é outra decisão dele).
// - denunciar: POST /lol-player-report-sender/v1/end-of-game-reports {comment, gameId, categories, offenderSummonerId,
//   offenderPuuid} (report-modal-data.sendPlayerReport). gameId = o do próprio jogador no eog (reportedPlayer.gameId),
//   até 3 categorias, comentário até 255, comentário vazio não vai no corpo (o Ember manda undefined). Desligado em
//   personalizada e para quem já está em GET reported-players/gameId/<id> (isReportDisabled do placar).
// Nada sai sem clique dele. Nome de terceiro só como o client mostra no pós-jogo (Riot ID do eog), sempre por
// textContent, nunca no log. Importável no node (tools/teste-compacto-fim-de-partida.mjs): nada de DOM no topo.
import { h, estilo, fotoCampeao, icone, comIcone } from './comum.js';

export const POSICOES_PT = { TOP: 'Topo', JUNGLE: 'Selva', MIDDLE: 'Meio', BOTTOM: 'Atirador', UTILITY: 'Suporte' };
export const ROTAS = {
  amigos: '/lol-chat/v1/friends',
  pedidos: '/lol-chat/v2/friend-requests',
  denunciados: gid => `/lol-player-report-sender/v1/reported-players/gameId/${encodeURIComponent(gid)}`,
  denunciar: '/lol-player-report-sender/v1/end-of-game-reports',
  noJogo: '/lol-player-report-sender/v1/in-game-reports',
  vozDoTime: '/lol-client-config/v3/client-config/lol.client_settings.team_voice.enabled',
};
export const MAX_CATEGORIAS = 3; // atMaxSelected = gte(selectedCount, 3)
export const MAX_COMENTARIO = 255; // maxCommentLength
const rascunhosDenuncia = new Map(); // "<gameId>:<puuid>" -> {marcadas, comentario} do formulário aberto (abrirDenuncia)
export const _esquecerRascunhosDenuncia = () => rascunhosDenuncia.clear(); // só teste

// textos pt-BR do formulário da Riot (trans.json do rcp-fe-lol-shared-components 16.20, lido em 14/10/2026)
export const TEXTOS_DENUNCIA = {
  titulo: 'DENUNCIAR JOGADOR',
  descricao: 'Conte pra gente o que aconteceu com esta pessoa da maneira mais precisa possível.\nSelecione até 3 opções relevantes.',
  placeholder: 'Fale mais sobre o que aconteceu na partida, incluindo incidentes na Seleção de Campeões ou na tela de fim de partida, se for o caso.',
  enviar: 'DENUNCIAR JOGADOR',
  fechar: 'FECHAR',
  enviada: 'Uma denúncia foi enviada para análise. Obrigado.',
};
export const CATEGORIAS = {
  LEAVING_AFK: ['ABANDONO DE PARTIDA/OCIOSIDADE', 'Desconectou-se, não participou ativamente da partida.'],
  ASSISTING_ENEMY_TEAM: ['SABOTAGEM DA EQUIPE', 'Morte intencional, atrapalhar colegas de equipe, assistência à equipe inimiga'],
  THIRD_PARTY_TOOLS: ['TRAPAÇA', 'Uso de scripting ou programas ilegais de terceiros'],
  RANK_MANIPULATION: ['MANIPULAÇÃO DE RANQUE', 'Contas smurf, manipulação, troca de vitórias, perda de elo'],
  BOTTING: ['USO DE BOTS', 'Usar bots de ociosidade ou de ganho de níveis para participar inativamente ou progredir injustamente'],
  VERBAL_ABUSE: ['ABUSO DE COMUNICAÇÃO', 'Bullying, assédio, ameaças, discurso de ódio, spam de chat/ping'],
  COMMS_ABUSE_VOICE: ['ABUSO DE COMUNICAÇÃO POR VOZ', 'Bullying, assédio, ameaças, discurso de ódio no chat de voz da equipe'],
  INAPPROPRIATE_NAME: ['NOME OFENSIVO', 'Nome de conta, tagline ou nome de equipe impróprio ou ofensivo'],
};
// DEFAULT_CATEGORY_SECTIONS (LOL) e LOL_TEAM_VOICE_CATEGORY_SECTIONS (voz do time ligada no client-config)
const SECOES = [
  ['JOGUE PARA VENCER.', ['LEAVING_AFK', 'ASSISTING_ENEMY_TEAM']],
  ['JOGUE LIMPO.', ['THIRD_PARTY_TOOLS', 'RANK_MANIPULATION', 'BOTTING']],
  ['JOGUE COM RESPEITO.', ['VERBAL_ABUSE', 'INAPPROPRIATE_NAME']],
];
const SECOES_VOZ = [SECOES[0], SECOES[1], ['JOGUE COM RESPEITO.', ['VERBAL_ABUSE', 'COMMS_ABUSE_VOICE', 'INAPPROPRIATE_NAME']]];

// -> [{titulo, categorias: [{id, titulo, descricao}]}]
export function secoesDenuncia(vozDoTime = false) {
  return (vozDoTime === true ? SECOES_VOZ : SECOES).map(([titulo, ids]) => ({
    titulo, categorias: ids.map(id => ({ id, titulo: CATEGORIAS[id][0], descricao: CATEGORIAS[id][1] })),
  }));
}

// marcar/desmarcar respeitando o máximo (a 4ª fica desabilitada, como no formulário da Riot)
export function alternarCategoria(marcadas, id) {
  const l = Array.isArray(marcadas) ? marcadas.filter(x => CATEGORIAS[x]) : [];
  if (!CATEGORIAS[id]) return l;
  if (l.includes(id)) return l.filter(x => x !== id);
  return l.length >= MAX_CATEGORIAS ? l : [...l, id];
}

// corpo exato do client (actions.reportPlayer). null = falta dado para denunciar
export function corpoDenuncia({ jogador, categorias, comentario }) {
  const cats = (Array.isArray(categorias) ? categorias : []).filter(id => CATEGORIAS[id]).slice(0, MAX_CATEGORIAS);
  if (!jogador?.puuid || !(Number(jogador.gameId) > 0) || !cats.length) return null;
  const c = typeof comentario === 'string' ? comentario.slice(0, MAX_COMENTARIO) : '';
  return { comment: c || undefined, gameId: Number(jogador.gameId), categories: cats, offenderSummonerId: jogador.summonerId ?? undefined,
    offenderPuuid: jogador.puuid };
}

const num = v => (v === null || v === undefined || v === '' || typeof v === 'boolean' || !Number.isFinite(Number(v)) ? null : Number(v));
const st = (s, ...ks) => { for (const k of ks) { const v = num(s?.[k]); if (v !== null) return v; } return null; };

// eog-stats-block -> os 10 (ou quantos vierem) com o que as telas usam. Nome = Riot ID do eog (o que o pós-jogo da Riot
// mostra); sem Riot ID, o summonerName; sem nada, '' (a tela mostra só o campeão, nunca um palpite).
export function jogadoresDoEog(eog) {
  if (!eog || typeof eog !== 'object' || !Array.isArray(eog.teams)) return [];
  const dur = num(eog.gameLength);
  const out = [];
  // sem isPlayerTeam em nenhum time: o aliado é o time do jogador atual (a mesma regra do chat expandido, chat-posjogo.js
  // elencoDoEog), senão todo mundo sairia vermelho na sala e na tabela
  const semFlag = !eog.teams.some(t => t?.isPlayerTeam === true);
  const meuTime = t => Array.isArray(t?.players) && t.players.some(p => p?.isLocalPlayer === true);
  for (const t of eog.teams) {
    if (!t || !Array.isArray(t.players)) continue;
    const aliado = t.isPlayerTeam === true || (semFlag && meuTime(t));
    for (const p of t.players) {
      if (!p || typeof p !== 'object') continue;
      const s = p.stats || {};
      const id = num(p.championId);
      const k = st(s, 'CHAMPIONS_KILLED', 'kills'), d = st(s, 'NUM_DEATHS', 'deaths'), a = st(s, 'ASSISTS', 'assists');
      const tropas = st(s, 'MINIONS_KILLED', 'totalMinionsKilled'), monstros = st(s, 'NEUTRAL_MINIONS_KILLED', 'neutralMinionsKilled');
      const nome = typeof p.riotIdGameName === 'string' && p.riotIdGameName ? p.riotIdGameName
        : typeof p.summonerName === 'string' ? p.summonerName : '';
      const pos = String(p.selectedPosition || '').toUpperCase();
      const det = String(p.detectedTeamPosition || '').toUpperCase();
      out.push({
        puuid: typeof p.puuid === 'string' && p.puuid ? p.puuid : null,
        summonerId: num(p.summonerId),
        gameId: num(p.gameId) || num(eog.gameId),
        nome, tag: typeof p.riotIdTagLine === 'string' ? p.riotIdTagLine : '',
        campeaoId: id > 0 ? id : null, campeao: typeof p.championName === 'string' ? p.championName : '',
        posicao: POSICOES_PT[pos] ? pos : POSICOES_PT[det] ? det : '',
        aliado, venceu: typeof t.isWinningTeam === 'boolean' ? t.isWinningTeam : null,
        eu: p.isLocalPlayer === true, bot: p.botPlayer === true,
        k, d, a, kda: k !== null && d !== null && a !== null ? [k, d, a] : null,
        farmMin: (tropas !== null || monstros !== null) && dur > 0 ? ((tropas || 0) + (monstros || 0)) / (dur / 60) : null,
        ouro: st(s, 'GOLD_EARNED', 'goldEarned'), dano: st(s, 'TOTAL_DAMAGE_DEALT_TO_CHAMPIONS', 'totalDamageDealtToChampions'),
        recebido: st(s, 'TOTAL_DAMAGE_TAKEN', 'totalDamageTaken'), visao: st(s, 'VISION_SCORE', 'visionScore'),
      });
    }
  }
  return out;
}

// o adversário direto: mesma posição no outro time (null se a posição não veio ou não bate com ninguém)
export function adversarioDireto(lista, eu = lista?.find(j => j.eu)) {
  if (!eu?.posicao) return null;
  return lista.find(j => !j.aliado && j.posicao === eu.posicao) || null;
}

// "Nome" e "#TAG" como o client mostra (texto puro; quem pinta usa textContent)
export const nomeCompleto = j => (j?.nome ? (j.tag ? `${j.nome} #${j.tag}` : j.nome) : '');

// ---- estado social (amigos, pedidos, denúncias): lido uma vez por montagem, só GET ----
// pedidos: v2 friend-requests -> [{puuid, direction}]; amigos: v1 friends -> [{puuid}]
export function estadoAmizade(social, puuid) {
  if (!puuid) return 'livre';
  if (social?.enviados?.has?.(puuid)) return 'enviado';
  if (social?.amigos?.has?.(puuid)) return 'amigo';
  if (social?.pedidos?.has?.(puuid)) return 'pendente';
  return 'livre';
}

// -> {ok, motivo} (motivo vira o title do botão cinza)
export function podeAdicionar(j, social) {
  if (!j || j.eu) return { ok: false, motivo: 'é você' };
  if (j.bot) return { ok: false, motivo: 'bot' };
  if (!j.puuid || !(j.summonerId > 0)) return { ok: false, motivo: 'o client não mandou quem é este jogador' };
  if (!social?.lido) return { ok: false, motivo: social?.falhou ? 'não foi possível ler a lista de amigos: adicione pelo client normal' : 'lendo a lista de amigos…' };
  const e = estadoAmizade(social, j.puuid);
  if (e === 'amigo') return { ok: false, motivo: 'já é seu amigo' };
  if (e === 'pendente') return { ok: false, motivo: 'pedido de amizade pendente' };
  if (e === 'enviado') return { ok: false, motivo: 'pedido de amizade enviado' };
  return { ok: true };
}

export function podeDenunciar(j, social, { custom = false } = {}) {
  if (!j || j.eu) return { ok: false, motivo: 'é você' };
  if (custom === true) return { ok: false, motivo: 'a Riot não deixa denunciar em personalizada' };
  if (!j.puuid || !(Number(j.gameId) > 0)) return { ok: false, motivo: 'o client não mandou quem é este jogador' };
  if (social?.denunciados?.has?.(j.puuid)) return { ok: false, motivo: 'já denunciado nesta partida' };
  return { ok: true };
}

const puuidsDe = (lista, filtro = () => true) => new Set((Array.isArray(lista) ? lista : []).filter(x => x && filtro(x))
  .map(x => (typeof x === 'string' ? x : x.puuid)).filter(Boolean));

// social da montagem. ctx = contexto da tela (lcu, vivo, avisar, expandir). -> {estado, ler, adicionar, denunciar, aoMudar}
export function criarSocial(ctx, { gameId = () => null, custom = () => null } = {}) {
  const s = { lido: false, amigos: new Set(), pedidos: new Set(), enviados: new Set(), denunciados: new Set(), noJogo: {}, vozDoTime: false,
    emVoo: new Set() };
  const ouvintes = new Set();
  const mudou = () => { for (const fn of ouvintes) try { fn(); } catch (e) { ctx.falhou?.(e); } };
  let lendo = null;
  const ler = () => (lendo ||= (async () => {
    const gid = gameId();
    const [am, pe, de, nj, voz] = await Promise.all([
      ctx.lcu('GET', ROTAS.amigos), ctx.lcu('GET', ROTAS.pedidos),
      gid ? ctx.lcu('GET', ROTAS.denunciados(gid)) : Promise.resolve({ ok: false }),
      ctx.lcu('GET', ROTAS.noJogo), ctx.lcu('GET', ROTAS.vozDoTime),
    ]);
    if (!ctx.vivo()) return;
    if (am.ok) s.amigos = puuidsDe(am.json);
    if (pe.ok) s.pedidos = puuidsDe(pe.json);
    if (de.ok) for (const p of puuidsDe(de.json)) s.denunciados.add(p);
    if (nj.ok && Array.isArray(nj.json)) for (const r of nj.json) if (r?.offenderPuuid && Array.isArray(r.categories)) s.noJogo[r.offenderPuuid] = r.categories;
    s.vozDoTime = voz.ok && voz.json === true;
    // amigos sem leitura: o botão fica cinza (não dá para saber se já é amigo); o resto não segura nada
    s.lido = am.ok;
    s.falhou = !am.ok;
    mudou();
  })().finally(() => { lendo = null; }));

  // clique dele em "+": um pedido por jogador, sem desbloquear ninguém
  const adicionar = async j => {
    const pode = podeAdicionar(j, s);
    if (!pode.ok || s.emVoo.has('a:' + j.puuid)) return { ok: false, motivo: pode.motivo };
    s.emVoo.add('a:' + j.puuid); mudou();
    let r;
    try { r = await ctx.lcu('POST', ROTAS.pedidos, { direction: 'out', puuid: j.puuid }); } finally { s.emVoo.delete('a:' + j.puuid); }
    if (!ctx.vivo()) return { ok: r?.ok };
    // só o campeão no aviso: sem camada e sem Toast, o avisar cai no console.log (nome de terceiro nunca no log)
    if (r.ok) { s.enviados.add(j.puuid); ctx.avisar(`pedido de amizade enviado (${j.campeao || 'jogador'})`); }
    else if (r.status === 405) ctx.avisar('esse jogador está bloqueado: desbloquear e adicionar fica no client normal (expandir)', true);
    else ctx.avisar(`não foi possível enviar o pedido de amizade (${r.status}${r.json?.message ? ': ' + String(r.json.message).slice(0, 80) : ''}): use o client normal`, true);
    mudou();
    return { ok: r.ok, status: r.status };
  };

  // clique dele em "DENUNCIAR JOGADOR" no formulário
  const denunciar = async (j, categorias, comentario) => {
    const pode = podeDenunciar(j, s, { custom: custom() === true });
    if (!pode.ok) return { ok: false, motivo: pode.motivo };
    const corpo = corpoDenuncia({ jogador: j, categorias, comentario });
    if (!corpo) return { ok: false, motivo: 'escolha ao menos uma opção' };
    if (s.emVoo.has('d:' + j.puuid)) return { ok: false, motivo: 'enviando…' };
    s.emVoo.add('d:' + j.puuid); mudou();
    let r;
    try { r = await ctx.lcu('POST', ROTAS.denunciar, corpo); } finally { s.emVoo.delete('d:' + j.puuid); }
    if (r.ok) s.denunciados.add(j.puuid);
    if (ctx.vivo()) mudou();
    return { ok: r.ok, status: r.status, motivo: r.ok ? null : `a denúncia não foi (${r.status}${r.json?.message ? ': ' + String(r.json.message).slice(0, 80) : ''})` };
  };

  return { estado: () => s, ler, adicionar, denunciar, custom: () => custom() === true, aoMudar: fn => (ouvintes.add(fn), () => ouvintes.delete(fn)) };
}

// ---- desenho ----

// "+" e "⚑" de uma linha. aoDenunciar(j) abre o formulário (abrirDenuncia)
export function botoesJogador(ctx, social, j, { aoDenunciar, doc } = {}) {
  const s = social.estado();
  const ad = podeAdicionar(j, s), de = podeDenunciar(j, s, { custom: social.custom?.() === true });
  if (j?.eu) return h('span', { doc, class: 'lc-cp-jacoes' });
  const am = estadoAmizade(s, j.puuid);
  const voandoA = s.emVoo.has('a:' + j.puuid);
  const icA = am === 'enviado' || am === 'pendente' ? 'ok' : am === 'amigo' ? 'favorito' : 'adicionar';
  const btA = h('button', { doc, class: 'lc-cp-jb' + (am === 'enviado' ? ' lc-cp-jb-ok' : ''), dataset: { a: 'adicionar', puuid: j.puuid || '' },
    title: ad.ok ? `adicionar ${nomeCompleto(j) || 'o jogador'} como amigo` : ad.motivo,
    'aria-label': voandoA ? 'enviando o pedido de amizade' : { ok: 'pedido de amizade enviado', favorito: 'já é amigo', adicionar: 'adicionar como amigo' }[icA],
    on: { click: ctx.seguro(e => { e?.stopPropagation?.(); if (e?.isTrusted === false) return; return social.adicionar(j); }) } },
  voandoA ? '…' : icone(icA, { doc, tam: 13, cheio: icA === 'favorito' }));
  btA.disabled = !ad.ok || voandoA;
  const btD = h('button', { doc, class: 'lc-cp-jb lc-cp-jb-d' + (s.denunciados.has(j.puuid) ? ' lc-cp-jb-ok' : ''), dataset: { a: 'denunciar', puuid: j.puuid || '' },
    title: de.ok ? `denunciar ${nomeCompleto(j) || 'o jogador'}` : de.motivo, 'aria-label': 'denunciar',
    on: { click: ctx.seguro(e => { e?.stopPropagation?.(); if (e?.isTrusted === false) return; aoDenunciar?.(j); }) } }, icone('denunciar', { doc, tam: 13 }));
  btD.disabled = !de.ok;
  return h('span', { doc, class: 'lc-cp-jacoes' }, btA, btD);
}

// Formulário de denúncia dentro da camada (por cima do corpo, abaixo do topo). Mesmas categorias, máximo, comentário e
// textos do formulário da Riot. Só o clique em DENUNCIAR JOGADOR envia; falha = motivo + "abrir no client normal".
// raiz: o corpo da tela (o router limpa ao desmontar). -> {el, fechar()}
export function abrirDenuncia(ctx, social, j, { raiz = ctx.raiz, doc } = {}) {
  estilo('lc-cp-jogadores-estilo', CSS_JOGADORES, raiz?.ownerDocument || raiz?.doc || globalThis.document);
  raiz?.querySelector?.('.lc-cp-den')?.remove();
  const s = social.estado();
  // rascunho por partida e jogador: a honra e o pós-jogo são telas diferentes e a troca de fase desmonta o formulário
  // (o comentário digitado sumia; revisão de 14/10/2026). Só em memória, nunca em log nem disco.
  const chaveR = `${j.gameId ?? ''}:${j.puuid}`;
  const rasc = rascunhosDenuncia.get(chaveR);
  let marcadas = rasc ? [...rasc.marcadas] : (s.noJogo[j.puuid] || []).filter(id => CATEGORIAS[id]).slice(0, MAX_CATEGORIAS); // a Riot já marca o que ele denunciou na partida
  let comentario = rasc?.comentario || '', erro = '', enviando = false;
  const guardar = () => { if (rascunhosDenuncia.size > 20) rascunhosDenuncia.clear(); rascunhosDenuncia.set(chaveR, { marcadas: [...marcadas], comentario }); };
  const el = h('div', { doc, class: 'lc-cp-den', role: 'dialog', 'aria-label': TEXTOS_DENUNCIA.titulo });
  const fechar = () => el.remove();
  const pintar = () => {
    const secoes = secoesDenuncia(s.vozDoTime);
    const lista = secoes.flatMap(sec => [h('div', { doc, class: 'lc-cp-den-sec' }, sec.titulo), ...sec.categorias.map(c => {
      const on = marcadas.includes(c.id), bloq = !on && marcadas.length >= MAX_CATEGORIAS;
      const cx = h('input', { doc, type: 'checkbox', dataset: { cat: c.id } });
      cx.checked = on; cx.disabled = bloq || enviando;
      return h('label', { doc, class: 'lc-cp-den-cat' + (on ? ' lc-cp-on' : '') + (bloq ? ' lc-cp-bloq' : ''), dataset: { a: 'categoria', cat: c.id },
        on: { click: ctx.seguro(e => { e?.preventDefault?.(); if (bloq || enviando) return; marcadas = alternarCategoria(marcadas, c.id); erro = ''; guardar(); pintar(); }) } },
      cx, h('span', { doc }, h('b', { doc }, c.titulo), h('small', { doc }, c.descricao)));
    })]);
    const ta = h('textarea', { doc, maxlength: String(MAX_COMENTARIO), placeholder: TEXTOS_DENUNCIA.placeholder, dataset: { a: 'comentario' } });
    ta.value = comentario;
    ta.disabled = enviando;
    ta.addEventListener('input', () => { comentario = String(ta.value || '').slice(0, MAX_COMENTARIO); conta.textContent = `${comentario.length}/${MAX_COMENTARIO}`; guardar(); });
    ta.addEventListener('keydown', e => e.stopPropagation?.()); // teclas do campo não vão para os atalhos da Riot
    const conta = h('small', { doc, class: 'lc-cp-den-conta' }, `${comentario.length}/${MAX_COMENTARIO}`);
    const enviar = h('button', { doc, class: 'lc-cp-btn lc-cp-verm', dataset: { a: 'enviar-denuncia' },
      on: { click: ctx.seguro(async e => {
        if (e?.isTrusted === false || enviando || !marcadas.length) return;
        enviando = true; erro = ''; pintar();
        const r = await social.denunciar(j, marcadas, comentario);
        enviando = false;
        if (!ctx.vivo()) return;
        if (r.ok) { rascunhosDenuncia.delete(chaveR); fechar(); ctx.avisar(TEXTOS_DENUNCIA.enviada); return; }
        erro = r.motivo || 'a denúncia não foi';
        pintar();
      }) } }, enviando ? 'ENVIANDO…' : TEXTOS_DENUNCIA.enviar);
    enviar.disabled = enviando || !marcadas.length;
    el.replaceChildren(
      h('div', { doc, class: 'lc-cp-den-topo' }, fotoCampeao(j.campeaoId, { tam: 34, nome: j.campeao, doc }),
        h('div', { doc }, h('b', { doc }, TEXTOS_DENUNCIA.titulo), h('small', { doc }, [nomeCompleto(j), j.campeao].filter(Boolean).join(' · ')))),
      h('div', { doc, class: 'lc-cp-den-corpo' },
        h('p', { doc, class: 'lc-cp-den-desc' }, TEXTOS_DENUNCIA.descricao),
        ...lista,
        ta, conta,
        erro ? h('div', { doc, class: 'lc-cp-den-erro', role: 'status' }, erro, ' ',
          h('button', { doc, class: 'lc-cp-btn', dataset: { a: 'denuncia-expandir' }, on: { click: ctx.seguro(() => { fechar(); ctx.expandir(); }) } }, comIcone('expandir', 'abrir no client normal', { doc }))) : null),
      h('div', { doc, class: 'lc-cp-den-bts' },
        // FECHAR é ele desistindo: o rascunho vai junto (a troca de tela não passa por aqui e o guarda)
        h('button', { doc, class: 'lc-cp-btn', dataset: { a: 'fechar-denuncia' }, on: { click: ctx.seguro(() => { rascunhosDenuncia.delete(chaveR); fechar(); }) } }, TEXTOS_DENUNCIA.fechar),
        enviar));
  };
  pintar();
  raiz.appendChild(el);
  return { el, fechar };
}

// Cartão do jogador (clique no nome dele no chat da sala): foto, nome, campeão, "adicionar" e "denunciar". -> {el, fechar()}
export function abrirJogador(ctx, social, j, { raiz = ctx.raiz, doc } = {}) {
  estilo('lc-cp-jogadores-estilo', CSS_JOGADORES, raiz?.ownerDocument || raiz?.doc || globalThis.document);
  raiz?.querySelector?.('.lc-cp-jcard')?.remove();
  const el = h('div', { doc, class: 'lc-cp-jcard', role: 'dialog' });
  const fechar = () => { el.remove(); parar?.(); };
  const pintar = () => {
    const s = social.estado();
    const ad = podeAdicionar(j, s), de = podeDenunciar(j, s, { custom: social.custom?.() === true });
    const btA = h('button', { doc, class: 'lc-cp-btn', dataset: { a: 'card-adicionar' }, title: ad.motivo || undefined,
      on: { click: ctx.seguro(e => { if (e?.isTrusted === false) return; return social.adicionar(j); }) } },
    estadoAmizade(s, j.puuid) === 'enviado' ? comIcone('ok', 'pedido enviado', { doc }) : comIcone('adicionar', 'adicionar', { doc }));
    btA.disabled = !ad.ok || s.emVoo.has('a:' + j.puuid);
    const btD = h('button', { doc, class: 'lc-cp-btn lc-cp-verm', dataset: { a: 'card-denunciar' }, title: de.motivo || undefined,
      on: { click: ctx.seguro(e => { if (e?.isTrusted === false) return; fechar(); abrirDenuncia(ctx, social, j, { raiz, doc }); }) } }, comIcone('denunciar', 'denunciar', { doc }));
    btD.disabled = !de.ok;
    el.replaceChildren(
      h('div', { doc, class: 'lc-cp-den-topo' }, fotoCampeao(j.campeaoId, { tam: 34, nome: j.campeao, doc }),
        h('div', { doc }, h('b', { doc }, nomeCompleto(j) || j.campeao || '?'), h('small', { doc }, [j.campeao, POSICOES_PT[j.posicao]].filter(Boolean).join(' · ') || ' '))),
      h('div', { doc, class: 'lc-cp-den-bts' }, btA, btD,
        h('button', { doc, class: 'lc-cp-btn', dataset: { a: 'card-fechar' }, on: { click: ctx.seguro(() => fechar()) } }, 'fechar')));
  };
  const parar = social.aoMudar(() => { if (el.parentNode) pintar(); });
  pintar();
  raiz.appendChild(el);
  return { el, fechar };
}

export const CSS_JOGADORES = `
#lc-compacto .lc-cp-jcard { position:absolute; left:10px; right:10px; top:54px; z-index:6; background:#0b1420; border:1px solid var(--lc-ouro-esc);
  box-shadow:0 6px 24px rgba(0,0,0,.7); }
#lc-compacto .lc-cp-jacoes { display:inline-flex; gap:3px; flex:none; }
#lc-compacto .lc-cp-jb { width:22px; height:22px; padding:0; display:inline-grid; place-items:center; background:var(--lc-pan2); border:1px solid var(--lc-linha);
  color:var(--lc-ouro2); font-family:inherit; font-size:12px; line-height:1; cursor:pointer; }
#lc-compacto .lc-cp-jb:hover:not([disabled]) { border-color:var(--lc-ouro); }
#lc-compacto .lc-cp-jb.lc-cp-jb-d:hover:not([disabled]) { border-color:#e84057; color:#ffd3d9; }
#lc-compacto .lc-cp-jb[disabled] { opacity:.4; cursor:default; }
#lc-compacto .lc-cp-jb.lc-cp-jb-ok[disabled] { opacity:.75; color:#7fe3a8; }
#lc-compacto .lc-cp-den { position:absolute; left:0; right:0; top:46px; bottom:0; z-index:6; display:flex; flex-direction:column;
  background:#010a13; border-top:1px solid #8a2a38; user-select:text; }
#lc-compacto .lc-cp-den-topo { flex:none; display:flex; gap:9px; align-items:center; padding:9px 12px; border-bottom:1px solid var(--lc-linha2); }
#lc-compacto .lc-cp-den-topo b { display:block; color:var(--lc-ouro2); font-size:14px; letter-spacing:.1em; }
#lc-compacto .lc-cp-den-topo small { display:block; color:var(--lc-mudo); font-size:11.5px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#lc-compacto .lc-cp-den-corpo { flex:1; min-height:0; overflow:auto; padding:8px 12px; display:flex; flex-direction:column; gap:4px; }
#lc-compacto .lc-cp-den-desc { margin:0 0 4px; font-size:11.5px; color:var(--lc-txt); white-space:pre-line; }
#lc-compacto .lc-cp-den-sec { font-size:10px; letter-spacing:.12em; color:var(--lc-mudo); margin-top:4px; }
#lc-compacto .lc-cp-den-cat { display:flex; gap:7px; align-items:flex-start; padding:4px 6px; border:1px solid transparent; cursor:pointer; }
#lc-compacto .lc-cp-den-cat.lc-cp-on { border-color:#8a2a38; background:rgba(232,64,87,.08); }
#lc-compacto .lc-cp-den-cat.lc-cp-bloq { opacity:.45; cursor:not-allowed; }
#lc-compacto .lc-cp-den-cat input { margin:2px 0 0; accent-color:#e84057; pointer-events:none; }
#lc-compacto .lc-cp-den-cat b { display:block; font-size:11.5px; color:var(--lc-ouro2); font-weight:600; }
#lc-compacto .lc-cp-den-cat small { display:block; font-size:10.5px; color:var(--lc-mudo); line-height:1.3; }
#lc-compacto .lc-cp-den textarea { margin-top:6px; min-height:58px; resize:none; background:var(--lc-bg); border:1px solid var(--lc-linha); color:var(--lc-ouro2);
  padding:6px 7px; font:inherit; font-size:11.5px; user-select:text; }
#lc-compacto .lc-cp-den-conta { align-self:flex-end; font-size:10px; color:var(--lc-mudo); }
#lc-compacto .lc-cp-den-erro { font-size:11.5px; color:#ffb3bd; display:flex; gap:6px; align-items:center; flex-wrap:wrap; }
#lc-compacto .lc-cp-den-erro .lc-cp-btn { padding:4px 8px; font-size:11.5px; }
#lc-compacto .lc-cp-den-bts { flex:none; display:flex; gap:6px; padding:8px 12px 10px; border-top:1px solid var(--lc-linha2); }
#lc-compacto .lc-cp-den-bts .lc-cp-btn { flex:1; }
`;
