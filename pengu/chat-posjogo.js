/*
 * Chat da tela de estatísticas do pós-jogo: nome do campeão junto do nome (ou no lugar), ícone do campeão em cada
 * linha, cor certa de aliado/inimigo, chat que abre sozinho e fica aberto, sem "entrou/deixou o saguão" e quem saiu
 * escurecido no placar. Plano: roadmap/2026-10-13-chat-popups-som.md.
 *
 * Partes adaptadas de better-lol-chat v0.8 (https://github.com/rdavis0/better-lol-chat), sob a licença abaixo:
 *
 * MIT License
 *
 * Copyright (c) 2026 wryguy
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
// Dois documentos: a página do client (sala lol-social-chat-room[type="postGame"], botão .chat-toggle-button, placar)
// e o iframe#embedded-messages-frame com as linhas. CSS da página no estilo.css; o do iframe vai como <style> (CSS_QUADRO):
// <link> não chega lá. O iframe expira e é recriado: procurar de novo a cada uso, nunca guardar.
// Nunca textarea.focus() (rola o client inteiro); toda troca da classe de foco é com a rolagem congelada.
// Com o painel #lc-posjogo aberto (cobre o chat no Rift) o chat não abre nem segura o Esc: só o texto muda.
// Nunca loga nome de jogador. Importável no node (tools/teste-chat-posjogo.mjs): nada de window/document no topo.

import { NOMES_CHAT } from './config.js';

export const FASES = new Set(['WaitingForStats', 'PreEndOfGame', 'EndOfGame']);
export const SEL = {
  sala: 'lol-social-chat-room[type="postGame"]',
  quadro: 'iframe#embedded-messages-frame, iframe',
  botao: '.chat-toggle-button',
  placar: '.scoreboard-team-container',
};
const FOCADO = 'focused-chat-box';
const RECOLHIDO = 'lc-chat-recolhido';

export const limparBidi = s => String(s ?? '').replace(/[‎‏‪-‮⁦-⁩]/g, '');
const normal = s => limparBidi(s).replace(/\s+/g, ' ').trim();
const minusculo = s => normal(s).toLowerCase();

// "Nome #TAG" (o client põe espaço e marcas bidi) -> { nome, tag } em minúsculas
export function partesRiotId(texto) {
  const t = minusculo(texto), i = t.indexOf('#');
  return i < 0 ? { nome: t, tag: '' } : { nome: t.slice(0, i).trim(), tag: t.slice(i + 1).trim() };
}

// ---- elenco (eog + champion-summary + jogador atual) ----

const unicos = valores => {
  const out = [], vistos = new Set();
  for (const v of valores) {
    const s = normal(v);
    if (!s || vistos.has(s.toLowerCase())) continue;
    vistos.add(s.toLowerCase());
    out.push(s);
  }
  return out;
};

// eog = /lol-end-of-game/v1/eog-stats-block; eu = /lol-summoner/v1/current-summoner; campeoes = champion-summary.json
// -> [{ puuid, summonerId, teamId, campeao, icone, aliado, apelidos }] (ícone sempre do próprio client)
export function montarElenco(eog, eu, campeoes) {
  if (!eog || typeof eog !== 'object') return [];
  const nomes = new Map(), icones = new Map();
  for (const c of Array.isArray(campeoes) ? campeoes : []) {
    if (!c || c.id == null) continue;
    nomes.set(Number(c.id), c.name || c.alias);
    if (c.squarePortraitPath) icones.set(Number(c.id), c.squarePortraitPath);
  }
  const lista = [];
  const incluir = (p, aliado, teamId) => {
    if (!p) return;
    const id = Number(p.championId) || 0;
    lista.push({
      puuid: p.puuid || p.playerPuuid || null,
      summonerId: p.summonerId ?? null,
      teamId: teamId ?? p.teamId ?? null,
      campeao: nomes.get(id) || p.championName || '',
      icone: icones.get(id) || (id > 0 ? `/lol-game-data/assets/v1/champion-icons/${id}.png` : ''),
      aliado,
      apelidos: unicos([
        p.riotIdGameName && p.riotIdTagLine ? `${p.riotIdGameName}#${p.riotIdTagLine}` : null,
        p.gameName && p.tagLine ? `${p.gameName}#${p.tagLine}` : null,
        p.riotIdGameName, p.gameName, p.summonerName, p.riotId,
      ]),
    });
  };
  if (Array.isArray(eog.teams) && eog.teams.length) {
    for (const t of eog.teams) for (const p of t.players || []) incluir(p, t.isPlayerTeam === true, p.teamId ?? t.teamId);
  }
  if (!lista.length) {
    for (const p of eog.teamPlayerParticipantStats || []) incluir(p, true, p.teamId);
    for (const p of eog.otherTeamPlayerParticipantStats || []) incluir(p, false, p.teamId);
  }
  // sem isPlayerTeam em nenhum time: o time é o do jogador atual
  const meu = lista.find(p => (eu?.puuid && p.puuid === eu.puuid) || (eu?.summonerId != null && String(p.summonerId) === String(eu.summonerId)));
  if (meu) {
    if (!lista.some(p => p.aliado) && meu.teamId != null) for (const p of lista) p.aliado = String(p.teamId) === String(meu.teamId);
    meu.aliado = true;
  }
  return lista;
}

// mensagens de sistema "joined_room"/"left_room" do LCU completam puuid/summonerId que o eog não trouxe
export function completarComEntradas(elenco, mensagens) {
  const porPuuid = new Map(elenco.filter(p => p.puuid).map(p => [String(p.puuid), p]));
  const porId = new Map(elenco.filter(p => p.summonerId != null && Number(p.summonerId) !== 0).map(p => [String(p.summonerId), p]));
  for (const m of Array.isArray(mensagens) ? mensagens : []) {
    if (m?.type !== 'system' || !['joined_room', 'left_room'].includes(String(m.body))) continue;
    const puuid = m.fromPuuid && String(m.fromPuuid), sid = m.fromSummonerId;
    if (!puuid || sid == null || Number(sid) === 0) continue;
    const p = porPuuid.get(puuid) || porId.get(String(sid));
    if (!p) continue;
    p.puuid ||= puuid;
    if (p.summonerId == null || Number(p.summonerId) === 0) p.summonerId = sid;
  }
  return elenco;
}

// texto da linha (Riot ID com ou sem tag, ou o nome do campeão se só um tiver) -> jogador | null
export function acharJogador(elenco, texto) {
  const t = minusculo(texto);
  if (!t || !elenco?.length) return null;
  for (const p of elenco) if (p.apelidos.some(a => a.toLowerCase() === t)) return p;
  // mesmo nome: tag igual casa; texto ou apelido sem tag casa só se o jogador não tem esse nome com outra tag
  const q = partesRiotId(t);
  if (q.nome) for (const p of elenco) {
    const mesmos = p.apelidos.map(partesRiotId).filter(r => r.nome === q.nome);
    if (!mesmos.length) continue;
    const tags = mesmos.map(r => r.tag).filter(Boolean);
    if (!q.tag || !tags.length || tags.includes(q.tag)) return p;
  }
  const porCampeao = elenco.filter(p => p.campeao && p.campeao.toLowerCase() === t);
  return porCampeao.length === 1 ? porCampeao[0] : null;
}

// ---- "entrou/deixou o saguão" (texto localizado; o body da LCU é só a chave) ----

const escapar = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const modelo = m => new RegExp('^' + escapar(m).replace(/\\\{\\\{actor\\\}\\\}/g, '(.+?)') + '$', 'i');
// medido no client 16.20 pt-BR (/fe/lol-social/trans.json) + o inglês do client em en-US
const PADRAO_SALA = {
  entrou: ['{{actor}} entrou no saguão', '{{actor}} joined the lobby', '{{actor}} joined the room'],
  saiu: ['{{actor}} deixou o saguão', '{{actor}} left the lobby', '{{actor}} left the room'],
};

// trans = JSON do /fe/lol-social/trans.json (ou null) -> { entrou: [RegExp], saiu: [RegExp] }
export function padroesSala(trans) {
  const de = (chave, base) => {
    const t = typeof trans?.[chave] === 'string' && trans[chave].includes('{{actor}}') ? [trans[chave]] : [];
    return [...new Set([...t, ...base])].map(modelo);
  };
  return { entrou: de('system_message_joined_room', PADRAO_SALA.entrou), saiu: de('system_message_left_room', PADRAO_SALA.saiu) };
}

// -> { tipo: 'entrou' | 'saiu', nome } | null
export function lerLinhaSala(texto, padroes) {
  const t = normal(texto);
  if (!t) return null;
  for (const tipo of ['entrou', 'saiu']) for (const re of padroes[tipo]) {
    const m = t.match(re);
    if (m) return { tipo, nome: m[1].trim() };
  }
  return null;
}

// ---- pintura das linhas (dentro do iframe) ----

const modoNomes = v => (NOMES_CHAT.some(([x]) => x === v) ? v : 'ambos');

// -> partes [{icone} | {classe, texto} | {texto}] do .message-name
export function partesNome(original, jogador, op) {
  const ligado = !!op?.ligado;
  if (!ligado || !jogador) return [{ texto: original }];
  const modo = modoNomes(op.nomes);
  const icone = op.iconeCampeao && jogador.icone ? [{ icone: jogador.icone }] : [];
  if (!jogador.campeao || modo === 'jogador') return icone.length ? [...icone, { classe: 'lc-chat-nome', texto: normal(original) }] : [{ texto: original }];
  if (modo === 'campeao') return [...icone, { classe: 'lc-chat-nome', texto: jogador.campeao }];
  return [...icone, { classe: 'lc-chat-nome', texto: normal(original) }, { classe: 'lc-chat-campeao', texto: `(${jogador.campeao})` }];
}

const textoDe = partes => partes.map(p => p.texto || '').join('');

function pintar(el, partes) {
  const doc = el.ownerDocument;
  el.replaceChildren(...partes.map(p => {
    if (p.icone) {
      const img = doc.createElement('img');
      img.className = 'lc-chat-icone';
      img.setAttribute('alt', '');
      img.setAttribute('draggable', 'false');
      img.setAttribute('src', p.icone);
      return img;
    }
    if (p.classe) {
      const s = doc.createElement('span');
      s.className = p.classe;
      s.textContent = p.texto;
      return s;
    }
    return doc.createTextNode(p.texto);
  }));
}

// classe de time que a linha deveria ter (null = deixar a do client)
export const classeTime = jogador => (jogador ? (jogador.aliado ? 'my-team' : 'other-team') : null);

// Reescreve as linhas do iframe. op = cfg.chatPosjogo. Idempotente: linha já pintada igual não é tocada (o observador
// do iframe dispara com as nossas próprias trocas). Desligado = devolve o original. -> contagem do que mudou
export function reescrever(doc, elenco, op, padroes) {
  const conta = { nomes: 0, times: 0, ocultas: 0, linhas: 0 };
  if (!doc?.querySelectorAll) return conta;
  const ligado = !!op?.ligado;
  for (const caixa of doc.querySelectorAll('.message-box')) {
    conta.linhas++;
    if (caixa.querySelector('.celebration')) continue;
    const nomeEl = caixa.querySelector('.chat-message .message-name');
    if (nomeEl) {
      const ds = nomeEl.dataset;
      // o client pode repintar o nome (texto diferente do que pusemos e do original guardado): vira o novo original
      if (ds.lcOriginal != null && nomeEl.textContent !== ds.lcTexto && nomeEl.textContent !== ds.lcOriginal) {
        delete ds.lcOriginal; delete ds.lcTexto; delete ds.lcAssinatura;
      }
      const original = ds.lcOriginal ?? nomeEl.textContent;
      const jogador = acharJogador(elenco, original);
      if (jogador || ds.lcOriginal != null) {
        const partes = partesNome(original, jogador, op);
        const assinatura = JSON.stringify(partes);
        const devolver = partes.length === 1 && partes[0].texto === original && !partes[0].classe;
        if (devolver) {
          if (ds.lcOriginal != null) {
            if (nomeEl.textContent !== original || nomeEl.childNodes.length !== 1) { nomeEl.textContent = original; conta.nomes++; }
            delete ds.lcOriginal; delete ds.lcTexto; delete ds.lcAssinatura;
          }
        } else if (ds.lcAssinatura !== assinatura || nomeEl.textContent !== ds.lcTexto) {
          ds.lcOriginal = original;
          pintar(nomeEl, partes);
          ds.lcAssinatura = assinatura;
          ds.lcTexto = textoDe(partes);
          conta.nomes++;
        }
      }
      // cor do time: o client marca o aliado como other-team (fromSummonerId 0 nas mensagens de grupo)
      if (!caixa.classList.contains('mine')) {
        const cd = caixa.dataset;
        const querida = ligado && op.corTime ? classeTime(jogador) : null;
        if (querida) {
          if (cd.lcTime == null) cd.lcTime = caixa.classList.contains('my-team') ? 'my-team' : caixa.classList.contains('other-team') ? 'other-team' : '';
          const outra = querida === 'my-team' ? 'other-team' : 'my-team';
          if (!caixa.classList.contains(querida) || caixa.classList.contains(outra)) {
            caixa.classList.remove(outra); caixa.classList.add(querida); conta.times++;
          }
        } else if (cd.lcTime != null) {
          caixa.classList.remove('my-team', 'other-team');
          if (cd.lcTime) caixa.classList.add(cd.lcTime);
          delete cd.lcTime;
          conta.times++;
        }
      }
      continue;
    }
    const span = caixa.querySelector('.system-message span');
    if (!span) continue;
    const linha = lerLinhaSala(span.textContent, padroes);
    const ocultar = !!linha && ligado && !!op.esconderEntrouSaiu;
    if (ocultar !== caixa.classList.contains('lc-oculta')) caixa.classList.toggle('lc-oculta', ocultar);
    if (ocultar) conta.ocultas++;
  }
  return conta;
}

// CSS de dentro do iframe (vai como <style id="lc-chat-quadro">); as cores são as do chat do client
export const CSS_QUADRO = `
.message-box.lc-oculta { display: none !important; }
html.lc-cor-time .message-box.my-team .message-name { color: #16cae5 !important; }
html.lc-cor-time .message-box.other-team .message-name { color: #ff1a3e !important; }
html.lc-cor-time .message-box.mine .message-name { color: #fabe0a !important; }
.lc-chat-icone { display: inline-block; width: 1.75em; height: 1.75em; margin-right: 0.28em; vertical-align: -0.45em;
  object-fit: cover; border-radius: 2px; pointer-events: none; }
html.lc-icone-campeao .message-box { line-height: 1.75em; }
html.lc-icone-campeao .message-box .message-name { align-items: center; vertical-align: bottom; }
.lc-chat-campeao { margin-left: 0.35em; opacity: 0.72; }
`;

// ---- abrir e manter aberto ----

// estado -> 'abrir' | 'fechar' | null. jaAbriu = o chat esteve aberto nesta tela (sozinho ou por ele);
// recolhido = ele fechou pelo botão ou Esc (com manterAberto, quem fecha é só ele)
export function decidirAbertura({ op, placar, painel, aberto, recolhido, jaAbriu, saiuDoPlacar }) {
  if (!op?.ligado || painel) return null;
  if (saiuDoPlacar) return aberto ? 'fechar' : null;
  if (!placar) return null;
  if (recolhido) return aberto && op.manterAberto ? 'fechar' : null;
  if (aberto) return null;
  if (op.abrirSozinho && !jaAbriu) return 'abrir';
  if (op.manterAberto && jaAbriu) return 'abrir';
  return null;
}

// Esc recolhe só com o cursor dentro da sala (campo ou mensagens): fora dela o Esc é do client (janela de denúncia,
// honra, opções por cima do placar). focoNaSala = document.activeElement dentro da sala (o iframe conta)
export function deveRecolherNoEsc({ op, naFase, painel, sala, noPlacar, recolhido, aberto, focoNaSala }) {
  return !!(naFase && op?.ligado && op.manterAberto && !painel && sala && noPlacar && !recolhido && aberto && focoNaSala);
}

// recolhido por ele: clique no campo reabre; Enter só com o cursor na sala e o painel fechado (Enter no painel ou no
// Ctrl+K não é dele para o chat)
export function deveReabrir({ op, naFase, recolhido, painel, tipo, focoNaSala, cliqueNoCampo }) {
  if (!naFase || !recolhido || !op?.ligado) return false;
  if (tipo === 'pointerdown') return !!cliqueNoCampo;
  return tipo === 'keydown' && !painel && !!focoNaSala;
}

// desligado (ou sem abrir/manter) no meio da tela: fecha o que nós abrimos sem foco de verdade (o client só fecha no
// blur, que não vem); com o cursor na sala, quem abriu foi ele e fica
export function fecharAoDesligar({ op, abertoPorNos, aberto, focoNaSala }) {
  const ativo = !!(op?.ligado && (op.abrirSozinho || op.manterAberto));
  return !ativo && !!abertoPorNos && !!aberto && !focoNaSala;
}

const ESCONDER = 'can-hide-player-messages';
const DESBLOQUEADO = 'lc-chat-desbloqueado';

// Estado da sala que não é a abertura: mensagens dos jogadores visíveis mesmo com o "esconder chat" do client e os
// avisos de troca de sala (atributo room-changed-messages, JSON de textos) filtrados. Guarda o original no dataset e
// devolve ao desligar; idempotente (a sonda de 250 ms chama a cada tique). O client reescreve room-changed-messages:
// só devolve o original se o atributo ainda é o que nós escrevemos.
export function ajustarSala(s, o, padroes) {
  if (!s) return;
  const ligado = !!o?.ligado;
  const entrada = s.querySelector('lol-social-chat-input'), botao = s.querySelector(SEL.botao);
  if (ligado && (o.abrirSozinho || o.manterAberto)) {
    if (!s.classList.contains(DESBLOQUEADO)) s.classList.add(DESBLOQUEADO);
    for (const el of [s, entrada].filter(Boolean)) {
      const v = el.getAttribute(ESCONDER);
      if (v == null) continue;
      if (el.dataset.lcEsconder == null) el.dataset.lcEsconder = v;
      el.removeAttribute(ESCONDER);
    }
    if (botao?.classList.contains(ESCONDER)) { botao.classList.remove(ESCONDER); botao.dataset.lcEsconder = '1'; }
  } else {
    if (s.classList.contains(DESBLOQUEADO)) s.classList.remove(DESBLOQUEADO);
    for (const el of [s, entrada].filter(Boolean)) {
      if (el.dataset.lcEsconder == null) continue;
      if (el.getAttribute(ESCONDER) == null) el.setAttribute(ESCONDER, el.dataset.lcEsconder);
      delete el.dataset.lcEsconder;
    }
    if (botao?.dataset.lcEsconder != null) { botao.classList.add(ESCONDER); delete botao.dataset.lcEsconder; }
  }
  const ds = s.dataset, bruto = s.getAttribute('room-changed-messages');
  if (ligado && o.esconderEntrouSaiu) {
    if (!bruto || bruto === ds.lcSalaFiltrada) return;
    try {
      const lista = JSON.parse(bruto);
      if (!Array.isArray(lista)) return;
      const restam = lista.filter(t => !lerLinhaSala(String(t), padroes));
      if (restam.length === lista.length) return;
      const fica = JSON.stringify(restam);
      ds.lcSalaOriginal = bruto;
      ds.lcSalaFiltrada = fica;
      s.setAttribute('room-changed-messages', fica);
    } catch { /* ignora */ }
  } else if (ds.lcSalaOriginal != null) {
    if (bruto === ds.lcSalaFiltrada) s.setAttribute('room-changed-messages', ds.lcSalaOriginal);
    delete ds.lcSalaOriginal; delete ds.lcSalaFiltrada;
  }
}

// ---- no client ----

function congelarRolagem(fn) {
  const nos = [document.documentElement, document.body, document.scrollingElement, document.querySelector('.lol-responsive-app'),
    document.querySelector('#rcp-fe-viewport-root'), document.querySelector('[data-screen-root]')].filter(Boolean);
  const fotos = nos.map(el => ({ el, top: el.scrollTop, left: el.scrollLeft }));
  const wx = window.scrollX, wy = window.scrollY;
  try { return fn(); } finally {
    for (const f of fotos) try { f.el.scrollTop = f.top; f.el.scrollLeft = f.left; } catch { /* ignora */ }
    try { window.scrollTo(wx, wy); } catch { /* ignora */ }
  }
}

function placarNaTela() {
  for (const el of document.querySelectorAll(SEL.placar)) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const vw = window.innerWidth || document.documentElement.clientWidth, vh = window.innerHeight || document.documentElement.clientHeight;
    if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) continue;
    const st = getComputedStyle(el);
    if (st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) !== 0) return true;
  }
  return false;
}

const lerJson = url => fetch(url).then(r => (r.ok ? r.text() : '')).then(t => (t ? JSON.parse(t) : null)).catch(() => null);

export function iniciarChatPosjogo(context, cfg) {
  const op = () => cfg.chatPosjogo || {};
  let naFase = false, elenco = [], padroes = padroesSala(null), textosLidos = false, campeoes = null;
  let recolhido = false, jaAbriu = false, noPlacar = false, escrevendo = 0, timerElenco = null, quadroPendente = 0;
  let abertoPorNos = false; // a classe de aberto foi posta por nós (sem foco real: o client não fecha sozinho)
  const quadros = new WeakSet(), salasVigiadas = new WeakSet();

  const sala = () => document.querySelector(SEL.sala);
  const painelAberto = () => !!document.getElementById('lc-posjogo');
  const aberta = s => !!s?.classList.contains(FOCADO);
  const docDoQuadro = s => {
    const f = s?.querySelector(SEL.quadro);
    try { return f?.contentDocument || f?.contentWindow?.document || null; } catch { return null; }
  };

  // troca a classe de foco sem focar nada (focar o textarea rola o client inteiro)
  const marcarAberta = (s, sim) => {
    if (!s) return;
    escrevendo++;
    try {
      congelarRolagem(() => {
        const caixa = s.querySelector('.chat-box');
        for (const el of [s, caixa].filter(Boolean)) el.classList.toggle(FOCADO, sim);
        if (!sim) for (const el of s.querySelectorAll('.' + FOCADO)) el.classList.remove(FOCADO);
        s.classList.toggle(RECOLHIDO, !sim && recolhido);
      });
      abertoPorNos = sim;
    } finally { queueMicrotask(() => { escrevendo--; }); }
  };

  // cursor dentro da sala: o campo (documento da página) ou as mensagens (o iframe é o activeElement da página)
  const focoNa = s => {
    const a = document.activeElement;
    return !!(s && a && a !== document.body && a !== document.documentElement && s.contains(a));
  };
  // tira o cursor da sala ao recolher (senão o que ele digita vai para um campo escondido); blur não rola a tela
  const soltarFoco = s => {
    try { const d = docDoQuadro(s), a = d?.activeElement; if (a && a !== d.body) a.blur(); } catch { /* ignora */ }
    try { const a = document.activeElement; if (a && a !== document.body && s.contains(a)) a.blur(); } catch { /* ignora */ }
  };

  const aoTeclar = e => {
    if (e.key !== 'Escape' || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const s = sala();
    if (!deveRecolherNoEsc({ op: op(), naFase, painel: painelAberto(), sala: !!s, noPlacar, recolhido, aberto: aberta(s), focoNaSala: focoNa(s) })) return;
    e.preventDefault();
    e.stopPropagation();
    recolhido = true;
    soltarFoco(s);
    marcarAberta(s, false);
  };

  const ligarQuadro = doc => {
    if (!doc?.documentElement) return;
    let estilo = doc.getElementById('lc-chat-quadro');
    if (!estilo) {
      estilo = doc.createElement('style');
      estilo.id = 'lc-chat-quadro';
      (doc.head || doc.documentElement).appendChild(estilo);
    }
    if (estilo.textContent !== CSS_QUADRO) estilo.textContent = CSS_QUADRO;
    if (quadros.has(doc)) return;
    quadros.add(doc);
    doc.addEventListener('keydown', aoTeclar, true);
    new MutationObserver(() => {
      if (!naFase || quadroPendente) return;
      quadroPendente = requestAnimationFrame(() => { quadroPendente = 0; aplicar(); });
    }).observe(doc.documentElement, { childList: true, subtree: true, characterData: true });
  };

  // o client tira a classe de foco no blur/clique fora: com manterAberto, devolve na hora
  const vigiarSala = s => {
    if (salasVigiadas.has(s)) return;
    salasVigiadas.add(s);
    new MutationObserver(() => { if (!escrevendo && naFase) abrirOuFechar(); })
      .observe(s, { attributes: true, attributeFilter: ['class'] });
  };

  function abrirOuFechar() {
    const s = sala();
    if (!s) return;
    const placar = placarNaTela(), saiuDoPlacar = noPlacar && !placar;
    noPlacar = placar;
    if (!aberta(s)) abertoPorNos = false;
    if (aberta(s) && placar && !painelAberto()) jaAbriu = true;
    const acao = decidirAbertura({ op: op(), placar, painel: painelAberto(), aberto: aberta(s), recolhido, jaAbriu, saiuDoPlacar });
    if (acao === 'abrir') { marcarAberta(s, true); jaAbriu = true; } else if (acao === 'fechar') marcarAberta(s, false);
  }

  function aplicar() {
    if (!naFase) return;
    const s = sala();
    if (!s) return;
    const o = op();
    if (o.ligado) vigiarSala(s);
    ajustarSala(s, o, padroes);
    // desligado no meio da tela: desfaz o recolhido e fecha o que nós abrimos sem foco real
    if (!o.ligado || !o.manterAberto) {
      recolhido = false;
      if (s.classList.contains(RECOLHIDO)) s.classList.remove(RECOLHIDO);
    }
    if (fecharAoDesligar({ op: o, abertoPorNos, aberto: aberta(s), focoNaSala: focoNa(s) })) marcarAberta(s, false);
    const doc = docDoQuadro(s);
    if (!doc) return;
    ligarQuadro(doc);
    const raiz = doc.documentElement;
    raiz.classList.toggle('lc-cor-time', !!(o.ligado && o.corTime));
    raiz.classList.toggle('lc-icone-campeao', !!(o.ligado && o.iconeCampeao));
    try { reescrever(doc, elenco, o, padroes); } catch (e) { console.error('[lol-client] chat do pós-jogo', e); }
  }

  async function atualizarElenco() {
    if (!textosLidos) {
      textosLidos = true;
      padroes = padroesSala(await lerJson('/fe/lol-social/trans.json'));
    }
    campeoes ||= await lerJson('/lol-game-data/assets/v1/champion-summary.json');
    const [eu, eog, conversas] = await Promise.all([lerJson('/lol-summoner/v1/current-summoner'),
      lerJson('/lol-end-of-game/v1/eog-stats-block'), lerJson('/lol-chat/v1/conversations')]);
    if (!naFase) return;
    const novo = montarElenco(eog, eu, campeoes);
    const conversa = (Array.isArray(conversas) ? conversas : []).find(c => c?.type === 'postGame');
    const id = conversa?.id || conversa?.pid;
    if (id) completarComEntradas(novo, await lerJson(`/lol-chat/v1/conversations/${encodeURIComponent(id)}/messages`));
    if (!naFase) return;
    elenco = novo;
    console.log('[lol-client] chat do pós-jogo:', elenco.length, 'jogadores no elenco');
    aplicar();
  }
  const pedirElenco = () => { clearTimeout(timerElenco); timerElenco = setTimeout(() => atualizarElenco().catch(() => {}), 400); };

  const aoFase = fase => {
    const agora = FASES.has(String(fase || ''));
    if (agora === naFase) return;
    naFase = agora;
    recolhido = false; jaAbriu = false; noPlacar = false; abertoPorNos = false;
    if (!naFase) { elenco = []; clearTimeout(timerElenco); return; }
    pedirElenco();
  };

  // a leitura inicial (plugin recarregado no meio do pós-jogo) não passa por cima de um evento do socket mais novo
  let faseDoSocket = false;
  context.socket.observe('/lol-gameflow/v1/gameflow-phase', m => { faseDoSocket = true; aoFase(m?.data); });
  context.socket.observe('/lol-end-of-game/v1/eog-stats-block', () => { if (naFase) pedirElenco(); });
  context.socket.observe('/lol-chat/v1/conversations', () => { if (naFase) pedirElenco(); });
  lerJson('/lol-gameflow/v1/gameflow-phase').then(f => { if (!faseDoSocket) aoFase(f); });

  // botão do chat: com manterAberto, quem decide aberto/fechado é ele (o client só fecharia no blur)
  const aoBotao = e => {
    const o = op(), s = sala();
    if (!naFase || !o.ligado || !o.manterAberto || painelAberto() || !s) return;
    const botao = e.target?.closest?.(SEL.botao);
    if (!botao || !s.contains(botao)) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if (e.type !== 'pointerdown' || e.button !== 0) return;
    recolhido = aberta(s) && !recolhido;
    marcarAberta(s, !recolhido);
    if (!recolhido) jaAbriu = true;
  };
  // recolhido: clicar no campo ou Enter com o cursor na sala abre de novo (o client foca o campo sozinho)
  const aoAbrirCampo = e => {
    if (e.type === 'keydown' && e.key !== 'Enter') return;
    const s = sala();
    if (!s) return;
    const cliqueNoCampo = e.type === 'pointerdown' && e.button === 0 && s.contains(e.target) && !e.target.closest?.(SEL.botao)
      && !!e.target.closest?.('textarea, input.chat-input, lol-social-chat-input, .chat-placeholder-text, .input-sizer');
    if (!deveReabrir({ op: op(), naFase, recolhido, painel: painelAberto(), tipo: e.type, focoNaSala: focoNa(s), cliqueNoCampo })) return;
    recolhido = false;
    marcarAberta(s, true);
  };
  const ligarDom = () => {
    document.addEventListener('pointerdown', aoBotao, true);
    document.addEventListener('click', aoBotao, true);
    document.addEventListener('pointerdown', aoAbrirCampo, true);
    document.addEventListener('keydown', aoAbrirCampo, true);
    document.addEventListener('keydown', aoTeclar, true);
    setInterval(() => { if (naFase) { aplicar(); abrirOuFechar(); } }, 250);
  };
  if (document.body) ligarDom();
  else document.addEventListener('DOMContentLoaded', ligarDom, { once: true });

  return {
    atualizar: () => { aplicar(); abrirOuFechar(); },
    estado: () => ({ naFase, jogadores: elenco.length, recolhido, jaAbriu, noPlacar, sala: !!sala(), painel: painelAberto() }),
  };
}

// bloco "Chat do pós-jogo" nas Configurações (registrarBloco)
export function blocoChatPosjogo(corpo, { cfg, definir, ui }) {
  const c = cfg.chatPosjogo, caixa = (k, rotulo, explica) => ui.caixa('chatPosjogo.' + k, rotulo, explica, c[k], v => definir('chatPosjogo.' + k, v));
  corpo.append(
    caixa('ligado', 'Chat do pós-jogo melhorado', 'No chat da tela de estatísticas: campeão de cada um, cor certa do time e menos poluição. Com o painel do lol-client aberto, o chat fica por baixo; vale quando tu fecha o painel e nos outros modos.'),
    ui.linha(ui.lista('chatPosjogo.nomes', 'Nome em cada linha', NOMES_CHAT, modoNomes(c.nomes), v => definir('chatPosjogo.nomes', v))),
    caixa('iconeCampeao', 'Ícone do campeão', 'A foto do campeão (do próprio client) antes do nome.'),
    caixa('corTime', 'Cor certa de aliado e inimigo', 'O client pinta todo mundo como inimigo; aqui aliado fica azul e inimigo vermelho.'),
    caixa('abrirSozinho', 'Abrir o chat sozinho', 'O chat já abre quando a tela de estatísticas aparece.'),
    caixa('manterAberto', 'Manter o chat aberto', 'Clicar fora não fecha; fecha no botão do chat ou no Esc com o cursor no chat (fora dele, o Esc fica com o client).'),
    caixa('esconderEntrouSaiu', 'Esconder "entrou/deixou o saguão"', 'Some com os avisos de entrada e saída da sala.'),
    caixa('escurecerSaiu', 'Escurecer quem saiu', 'No placar, quem já saiu do chat fica cinza.'));
}
