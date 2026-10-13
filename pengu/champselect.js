// Winrate no champ select: selo com partidas, winrate e KDA do jogador local com o campeão em
// hover ou escolhido, no geral e na posição atribuída. Só dados do próprio jogador (fronteira do hub).
// Fonte: histórico da LCU (20 ou 200 partidas conforme o cache do client, ARMADILHAS), somado por
// gameId a cada leitura, então a amostra só cresce na sessão. Regra de amostra e posição: docs/INSIGHTS.md.
// Importável no node (tools/teste-winrate.mjs): nada de window/document no topo do módulo.

// stats.roleBoundItem = item da missão de função (medido 13/10/2026 em items.json)
const POSICAO_DO_ITEM = {
  1200: 'TOP', 1220: 'TOP', 1221: 'TOP', 1222: 'TOP',
  1201: 'MIDDLE', 1206: 'MIDDLE',
  1202: 'BOTTOM', 1207: 'BOTTOM',
  1203: 'UTILITY', 1208: 'UTILITY', 2055: 'UTILITY', // 2055: sentinela de controle no espaço da missão de suporte
  1204: 'JUNGLE', 1205: 'JUNGLE', 1209: 'JUNGLE', 1210: 'JUNGLE',
};
const GOLPEAR = 11;

export const normalizarPosicao = p => (p ? String(p).toUpperCase() : '');

// posição jogada numa partida do histórico (participante do jogador local) ou '' se não der para saber
export function posicaoDaPartida(p) {
  const pos = POSICAO_DO_ITEM[p?.stats?.roleBoundItem];
  if (pos) return pos;
  return p && (p.spell1Id === GOLPEAR || p.spell2Id === GOLPEAR) ? 'JUNGLE' : '';
}

// partida que conta: Summoner's Rift com matchmaking (sem personalizada nem treino), sem remake
export const partidaConta = g => g?.mapId === 11 && g.gameType === 'MATCHED_GAME'
  && !!g.participants?.[0] && !g.participants[0].stats?.gameEndedInEarlySurrender;

const resumo = lista => {
  const n = lista.length;
  if (!n) return { n: 0 };
  let v = 0, k = 0, d = 0, a = 0;
  for (const s of lista) { v += s.win ? 1 : 0; k += s.kills; d += s.deaths; a += s.assists; }
  const um = x => Math.round(x * 10) / 10;
  // sem morte nenhuma: kda null ("perfeito"); (K+A)/1 cresceria com o número de partidas
  return { n, vitorias: v, winrate: Math.round(v / n * 100), k: um(k / n), d: um(d / n), a: um(a / n), kda: d ? um((k + a) / d) : null };
};

// historico = games.games da LCU (cada partida traz só o participante do jogador local)
// -> { geral: {n, vitorias, winrate, k, d, a, kda}, posicao: {...} | null }
export function estatisticasCampeao(historico, championId, posicao) {
  const pos = normalizarPosicao(posicao);
  const minhas = (historico || []).filter(g => partidaConta(g) && g.participants[0].championId === championId);
  return {
    geral: resumo(minhas.map(g => g.participants[0].stats)),
    posicao: pos ? { pos, ...resumo(minhas.filter(g => posicaoDaPartida(g.participants[0]) === pos).map(g => g.participants[0].stats)) } : null,
  };
}

const NOME_POSICAO = { TOP: 'topo', JUNGLE: 'selva', MIDDLE: 'meio', BOTTOM: 'atirador', UTILITY: 'suporte' };
const virgula = x => String(x).replace('.', ',');
const linha = r => `${r.n} ${r.n === 1 ? 'partida' : 'partidas'} · ${r.winrate}% · KDA ${r.kda === null ? 'perfeito' : virgula(r.kda)}`;

// texto do selo (puro: o teste também confere)
export function textoSelo(est, nome) {
  if (!est.geral.n) return { titulo: nome, linhas: ['sem partidas'] };
  const linhas = [linha(est.geral)];
  if (est.posicao) linhas.push(`${NOME_POSICAO[est.posicao.pos] || est.posicao.pos}: ${est.posicao.n ? linha(est.posicao) : 'sem partidas'}`);
  return { titulo: nome, linhas };
}

// ---- no client ----

const URL_HIST = '/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=199';

export function iniciarChampSelect(context, cfg) {
  const partidas = new Map(); // gameId -> partida (só cresce)
  let carregando = null, ultimaLeitura = 0, falhou = 0, nomes = null, ultimaSessao = null;

  // só leitura boa marca ultimaLeitura; erro (HTTP ou rede) deixa o selo tentar de novo (no máximo a cada 15 s)
  const lerHistorico = () => {
    if (carregando) return carregando;
    carregando = fetch(URL_HIST).then(async r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const lista = (await r.json())?.games?.games;
      if (!Array.isArray(lista)) throw new Error('resposta sem games.games');
      for (const g of lista) partidas.set(g.gameId, g);
      ultimaLeitura = Date.now();
      falhou = 0;
    }).catch(e => { falhou = Date.now(); console.error('[lol-client] histórico', e); }).finally(() => { carregando = null; desenhar(); });
    return carregando;
  };

  const nomeCampeao = async id => {
    if (!nomes) {
      try { nomes = Object.fromEntries((await (await fetch('/lol-game-data/assets/v1/champion-summary.json')).json()).map(c => [c.id, c.name])); }
      catch { nomes = {}; }
    }
    return nomes[id] || `campeão ${id}`;
  };

  // campeão do jogador local: travado, senão em hover. Na vez dele o hover vive na ação de pick
  // (actions[].championId); antes da vez, na intenção (myTeam[].championPickIntent). Medido 13/10/2026.
  const meu = s => {
    const eu = s?.myTeam?.find(c => c.cellId === s.localPlayerCellId);
    if (!eu) return null;
    const acao = (s.actions || []).flat().find(a => a.type === 'pick' && a.actorCellId === s.localPlayerCellId && a.championId);
    return { championId: eu.championId || acao?.championId || eu.championPickIntent || 0, posicao: normalizarPosicao(eu.assignedPosition) };
  };

  // pedido: cada desenho ou remoção ganha um número; desenho em voo (await do nome) que ficou velho desiste
  let pedido = 0;
  const remover = () => { pedido++; document.getElementById('lc-winrate')?.remove(); };

  async function desenhar(s = ultimaSessao) {
    const alvo = cfg.champSelect.ligado ? meu(s) : null;
    if (!alvo?.championId) return remover();
    const n = ++pedido;
    const nome = await nomeCampeao(alvo.championId);
    if (n !== pedido || !document.body) return;
    let el = document.getElementById('lc-winrate');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lc-winrate';
      document.body.appendChild(el);
    }
    const t = ultimaLeitura ? textoSelo(estatisticasCampeao([...partidas.values()], alvo.championId, alvo.posicao), nome)
      : { titulo: nome, linhas: [falhou && !carregando ? 'histórico indisponível agora (tento de novo)' : 'carregando histórico…'] };
    const div = (className, textContent) => Object.assign(document.createElement('div'), { className, textContent });
    const titulo = div('lc-wr-titulo', '');
    titulo.append(div('lc-wr-nome', t.titulo), ultimaLeitura ? div('lc-wr-amostra', `histórico: ${partidas.size} partidas`) : '');
    el.replaceChildren(titulo, ...t.linhas.map(l => div('lc-wr-linha', l)));
    // na faixa vazia acima da coluna do meu time (.summoner-array, medido 13/10/2026); sem ela, no topo ao centro
    const col = document.querySelector('.summoner-array')?.getBoundingClientRect();
    el.classList.toggle('lc-wr-coluna', !!col?.width);
    if (col?.width) Object.assign(el.style, { left: col.left + 14 + 'px', top: Math.max(4, col.top - el.offsetHeight - 4) + 'px', width: col.width - 28 + 'px' });
    else Object.assign(el.style, { left: '', top: '', width: '' });
  }

  let eventos = 0;
  context.socket.observe('/lol-champ-select/v1/session', msg => {
    eventos++;
    if (msg?.eventType === 'Delete' || !msg?.data) { ultimaSessao = null; return remover(); }
    ultimaSessao = msg.data;
    if (!ultimaLeitura && !carregando && Date.now() - falhou > 15000) lerHistorico();
    desenhar();
  });
  // partida nova no histórico: relê (o cache só cresce)
  context.socket.observe('/lol-gameflow/v1/gameflow-phase', msg => { if (msg?.data === 'EndOfGame') setTimeout(lerHistorico, 60000); });
  // a leitura de 200 partidas leva até 40 s: começa já, para estar pronta no champ select
  setTimeout(lerHistorico, 5000);

  return {
    lerHistorico, desenhar: () => desenhar(),
    // eventos e alvo: diagnóstico para o teste ao vivo (o socket entrega? qual campo trouxe o campeão?)
    estado: () => ({ partidas: partidas.size, carregando: !!carregando, ultimaLeitura, falhou, eventos, alvo: meu(ultimaSessao) }),
    estatisticas: (championId, posicao) => estatisticasCampeao([...partidas.values()], championId, posicao),
  };
}
