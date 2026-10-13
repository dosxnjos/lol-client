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

// ---- matchup, trauma e draft (dados do coletor, GET 127.0.0.1:8765/draft/<meu campeão>) ----
// O histórico do client só traz o meu participante, sem adversário nem linha do tempo: matchup (papel pela
// timeline, ouro aos 10), traumas e a faixa do draft (meta.db) saem do coletor; aqui só escolhe e formata.
// Spec: docs/INSIGHTS.md § Matchups e § Traumas; prova: tools/teste-matchup.mjs contra o analise.py.

export const MIN_MATCHUP = 3; // analise.MIN_MATCHUP: abaixo disso só o n
const arred = v => Math.floor(v + 0.5); // igual aos motores de lições (sem round bancário)
const comSinal = v => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0');

// grupo (meu campeão, papel, adversário) de analise.matchups(); papel desempata quando joguei em 2 rotas
export function grupoMatchup(matchups, meu, inimigo, papel = '') {
  const gs = (matchups || []).filter(g => g.campeao === meu && g.adversario === inimigo);
  if (!gs.length) return null;
  return gs.find(g => papel && g.papel === papel) || [...gs].sort((a, b) => (b.n - a.n) || a.papel.localeCompare(b.papel))[0];
}

// "contra Ekko: 1V/3D · ouro10 −435"; n < 3: "contra Ekko: n=2"; nunca: "contra Ekko: sem histórico"
export function linhaMatchup(matchups, meu, inimigo, nome = `campeão ${inimigo}`, papel = '') {
  const g = grupoMatchup(matchups, meu, inimigo, papel);
  if (!g) return `contra ${nome}: sem histórico`;
  if (g.n < MIN_MATCHUP) return `contra ${nome}: n=${g.n}`;
  const base = `contra ${nome}: ${g.vitorias}V/${g.n - g.vitorias}D`;
  return g.ouro10 === null || g.ouro10 === undefined ? base : `${base} · ouro10 ${comSinal(arred(g.ouro10))}`;
}

// o inimigo travado com maior lift entre os marcados trauma (n ≥ 3, lift ≥ 1,2): "Darius é trauma: 2V/7D"
export function linhaTrauma(traumas, nome = id => `campeão ${id}`) {
  const t = (traumas || []).filter(x => x.trauma).sort((a, b) => (b.lift - a.lift) || (a.campeao - b.campeao))[0];
  return t ? `${nome(t.campeao)} é trauma: ${t.vitorias}V/${t.derrotas}D` : null;
}

// adversário de rota = o inimigo travado cuja rota provável (C2 do draft.py) é a minha
export const adversarioDoDraft = (draft, posicao) =>
  (posicao && (draft?.inimigos || []).find(i => i.rota === normalizarPosicao(posicao))) || null;

// "draft: leve vantagem" + os 2 termos que mais pesaram (texto do draft.py, com o efeito em pontos)
export function linhasDraft(draft) {
  // sem nenhum campeão travado a faixa é só o 50% do vazio: não mostra
  if (!draft?.faixa || !((draft.aliados || []).length + (draft.inimigos || []).length)) return [];
  const pp = t => `${t.pp > 0 ? '+' : '−'}${Math.abs(t.pp).toFixed(1).replace('.', ',')}`;
  const termos = (draft.termos || []).slice(0, 2).map(t => `${pp(t)} ${String(t.texto).replace(/(\d)\.(\d)/g, '$1,$2')}`);
  return [`draft: ${draft.faixa}`, ...(termos.length ? [termos.join(' · ')] : [])];
}

// ---- no client ----

const URL_HIST = '/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=199';

export function iniciarChampSelect(context, cfg, coletor = null) {
  const partidas = new Map(); // gameId -> partida (só cresce)
  let carregando = null, ultimaLeitura = 0, falhou = 0, nomes = null, ultimaSessao = null;
  // dados do coletor para o selo: relidos a cada 3 s na seleção (inimigo trava, draft muda)
  const coach = { dados: null, campeao: 0, em: 0, buscando: false, fora: false };
  const lerCoach = async id => {
    if (!coletor || coach.buscando) return;
    coach.buscando = true;
    const r = await coletor(`/draft/${id}`, { prazoMs: 4000 });
    coach.buscando = false;
    coach.fora = r.status !== 200;
    Object.assign(coach, { dados: r.status === 200 ? r.dados : null, campeao: id, em: Date.now() });
    desenhar();
  };
  let relogio = null;
  const pararRelogio = () => { clearInterval(relogio); relogio = null; };

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
    // matchup, trauma e draft: do coletor, só para o campeão em tela (dado de outro campeão não aparece)
    if (coletor && (coach.campeao !== alvo.championId || Date.now() - coach.em > 3000)) lerCoach(alvo.championId);
    const extra = [];
    const d = coach.campeao === alvo.championId ? coach.dados : null;
    if (d) {
      const adv = adversarioDoDraft(d.draft, alvo.posicao);
      if (adv) extra.push(['lc-wr-coach', linhaMatchup(d.matchups, alvo.championId, adv.campeao, await nomeCampeao(adv.campeao), alvo.posicao)]);
      const tr = cfg.traumas?.ligado ? linhaTrauma(d.traumas, id => nomes?.[id] || `campeão ${id}`) : null;
      if (tr) extra.push(['lc-wr-trauma', tr]);
      linhasDraft(d.draft).forEach((l, i) => extra.push([i ? 'lc-wr-sub' : 'lc-wr-coach', l]));
    } else if (coletor && coach.fora) extra.push(['lc-wr-sub', 'coach: coletor fora do ar (sem matchup e draft)']);
    if (n !== pedido || !document.body) return;
    const div = (className, textContent) => Object.assign(document.createElement('div'), { className, textContent });
    const titulo = div('lc-wr-titulo', '');
    titulo.append(div('lc-wr-nome', t.titulo), ultimaLeitura ? div('lc-wr-amostra', `histórico: ${partidas.size} partidas`) : '');
    el.replaceChildren(titulo, ...t.linhas.map(l => div('lc-wr-linha', l)), ...extra.map(([c, l]) => div('lc-wr-linha ' + c, l)));
    // na faixa vazia acima da coluna do meu time (.summoner-array, medido 13/10/2026); sem ela, no topo ao centro
    const col = document.querySelector('.summoner-array')?.getBoundingClientRect();
    el.classList.toggle('lc-wr-coluna', !!col?.width);
    if (col?.width) Object.assign(el.style, { left: col.left + 14 + 'px', top: Math.max(4, col.top - el.offsetHeight - 4) + 'px', width: col.width - 28 + 'px' });
    else Object.assign(el.style, { left: '', top: '', width: '' });
  }

  let eventos = 0;
  context.socket.observe('/lol-champ-select/v1/session', msg => {
    eventos++;
    if (msg?.eventType === 'Delete' || !msg?.data) { ultimaSessao = null; pararRelogio(); return remover(); }
    ultimaSessao = msg.data;
    // sem evento novo (todos pensando) o draft do coletor ainda muda: redesenha a cada 3 s
    if (coletor && !relogio) relogio = setInterval(() => (ultimaSessao ? desenhar() : pararRelogio()), 3000);
    if (!ultimaLeitura && !carregando && Date.now() - falhou > 15000) lerHistorico();
    desenhar();
  });
  // partida nova no histórico: relê (o cache só cresce)
  context.socket.observe('/lol-gameflow/v1/gameflow-phase', msg => { if (msg?.data === 'EndOfGame') setTimeout(lerHistorico, 60000); });
  // a leitura de 200 partidas leva até 40 s: começa já, para estar pronta no champ select
  setTimeout(lerHistorico, 5000);

  return {
    // desenhar(sessao): teste com sessão gravada (sem argumento, a última do socket)
    lerHistorico, desenhar: s => { if (s !== undefined) ultimaSessao = s; return desenhar(); }, coach: () => ({ ...coach }),
    // cache do histórico para o freio de tilt da fila rápida (fila-rapida.criarSequencia); null = nunca leu
    partidas: () => (ultimaLeitura ? [...partidas.values()] : null),
    // eventos e alvo: diagnóstico para o teste ao vivo (o socket entrega? qual campo trouxe o campeão?)
    estado: () => ({ partidas: partidas.size, carregando: !!carregando, ultimaLeitura, falhou, eventos, alvo: meu(ultimaSessao) }),
    estatisticas: (championId, posicao) => estatisticasCampeao([...partidas.values()], championId, posicao),
  };
}
