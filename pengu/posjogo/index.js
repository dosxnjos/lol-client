// Painel pós-jogo: busca partida e linha do tempo na LCU, roda analise.js (spec: docs/INSIGHTS.md) e desenha.
import { analisar, trajeto, FORA_DAS_CONTAS } from './analise.js';

const LARG = 14870, ALT = 14980, PX = 330;
const sx = x => (x / LARG * PX).toFixed(1);
const sy = y => ((ALT - y) / ALT * PX).toFixed(1);
const esperar = ms => new Promise(r => setTimeout(r, ms));

const REGIAO = {
  base_aliada: 'base aliada', base_inimiga: 'base inimiga', rota_top: 'rota top', rota_meio: 'rota meio',
  rota_bot: 'rota bot', rio: 'rio', selva_aliada: 'selva aliada', selva_inimiga: 'selva inimiga',
};
const OBJETIVO = {
  DRAGON: 'dragão', BARON_NASHOR: 'Barão', RIFTHERALD: 'Arauto', HORDE: 'Larva', ATAKHAN: 'Atakhan',
  TOWER_BUILDING: 'torre', INHIBITOR_BUILDING: 'inibidor',
};
const TORRE = { OUTER_TURRET: 'externa', INNER_TURRET: 'interna', BASE_TURRET: 'de base', NEXUS_TURRET: 'do nexus' };
const ROTA = { TOP_LANE: 'top', MID_LANE: 'meio', BOT_LANE: 'bot' };

const json = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); };

// partida + linha do tempo com retentativa (logo no EndOfGame a LCU ainda não tem)
// vivo(): false quando o painel foi fechado; para de tentar
async function buscarComRetentativa(gameId, aoEsperar, vivo = () => true) {
  for (const espera of [0, 5000, 10000, 20000, 40000]) {
    if (espera) { aoEsperar?.(espera); await esperar(espera); }
    if (!vivo()) throw new Error('painel fechado');
    try {
      return await Promise.all([json(`/lol-match-history/v1/games/${gameId}`), json(`/lol-match-history/v1/game-timelines/${gameId}`)]);
    } catch { /* tenta de novo */ }
  }
  throw new Error('a LCU ainda não tem esta partida');
}

let nomes = null;
async function nomeCampeao(id) {
  if (!nomes) {
    try { nomes = Object.fromEntries((await json('/lol-game-data/assets/v1/champion-summary.json')).map(c => [c.id, c.name])); }
    catch { nomes = {}; }
  }
  return nomes[id] || `campeão ${id}`;
}

const historico = async () => (await json('/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=19')).games.games;

export async function analisarPartida(gameId, { aoEsperar, vivo } = {}) {
  // histórico só alimenta a média de farm: falha nele não derruba o painel
  const [eu, hist] = await Promise.all([json('/lol-summoner/v1/current-summoner'), historico().catch(() => [])]);
  const [partida, linha] = await buscarComRetentativa(gameId, aoEsperar, vivo);
  const r = analisar(partida, linha, eu.puuid, hist);
  if (!r.erro) r.trajeto = trajeto(linha, r.participantId);
  r.campeoes = Object.fromEntries(partida.participants.map(p => [p.participantId, p.championId]));
  return r;
}

// ---- desenho ----

// sessao: cada abertura ganha um número; fechar() o invalida, e análise em voo não reabre o painel
let sessao = 0;
function remover() {
  document.getElementById('lc-posjogo')?.remove();
  window.removeEventListener('keydown', aoTecla, true);
}
function fechar() { sessao++; remover(); }
function aoTecla(e) { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); fechar(); } }

function moldura(conteudo) {
  remover();
  const el = document.createElement('div');
  el.id = 'lc-posjogo';
  el.innerHTML = conteudo;
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('.lc-fechar')) fechar(); });
  document.body.appendChild(el);
  window.addEventListener('keydown', aoTecla, true);
  return el;
}

const sinal = v => (v > 0 ? `<span class="lc-pos">+${v}</span>` : v < 0 ? `<span class="lc-neg">−${-v}</span>` : '0');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function svgMapa(r) {
  const rota = 'fill="none" stroke="#2a3a3a" stroke-width="14" stroke-linecap="round"';
  const pontos = r.trajeto.map(p => `${sx(p.x)},${sy(p.y)}`).join(' ');
  const passos = r.trajeto.map((p, i) => `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="2.2" fill="#0ac8b9" opacity="${(0.35 + 0.65 * i / r.trajeto.length).toFixed(2)}"/>`).join('');
  const mortes = r.mortes.map((m, i) => `<g><circle cx="${sx(m.x)}" cy="${sy(m.y)}" r="8" fill="#e84057" stroke="#010a13" stroke-width="1.5"/>
    <text x="${sx(m.x)}" y="${(+sy(m.y) + 3.5).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">${i + 1}</text></g>`).join('');
  return `<svg viewBox="0 0 ${PX} ${PX}" xmlns="http://www.w3.org/2000/svg">
    <path d="M${sx(14925)},${sy(0)} L${sx(0)},${sy(14925)}" stroke="#14303a" stroke-width="40"/>
    <path d="M${sx(1200)},${sy(3000)} L${sx(1200)},${sy(13780)} L${sx(11870)},${sy(13780)}" ${rota}/>
    <path d="M${sx(3000)},${sy(1200)} L${sx(13670)},${sy(1200)} L${sx(13670)},${sy(11980)}" ${rota}/>
    <path d="M${sx(2600)},${sy(2600)} L${sx(12270)},${sy(12380)}" ${rota}/>
    <circle cx="${sx(0)}" cy="${sy(0)}" r="${(5000 / LARG * PX).toFixed(1)}" fill="${r.time === 100 ? '#0a3a5a' : '#4a1520'}" opacity=".55"/>
    <circle cx="${sx(LARG)}" cy="${sy(ALT)}" r="${(5000 / LARG * PX).toFixed(1)}" fill="${r.time === 200 ? '#0a3a5a' : '#4a1520'}" opacity=".55"/>
    <polyline points="${pontos}" fill="none" stroke="#0ac8b9" stroke-width="1.2" opacity=".55"/>
    ${passos}${mortes}
  </svg>`;
}

function padroes(r) {
  const n = r.mortes.length;
  if (!n) return ['nenhuma morte nesta partida'];
  const conta = f => r.mortes.filter(f).length;
  const out = [];
  const metadeInimiga = conta(m => m.lado === 'inimigo');
  if (metadeInimiga) out.push(`${metadeInimiga} de ${n} mortes na metade inimiga do mapa`);
  const sozinho = conta(m => m.aliadosPerto.length === 0);
  if (sozinho) out.push(`${sozinho} de ${n} mortes sem aliado por perto no minuto mais próximo`);
  const emDesvantagem = conta(m => m.inimigos > m.aliadosPerto.length + 1);
  if (emDesvantagem) out.push(`${emDesvantagem} de ${n} mortes com mais inimigos na jogada do que aliados perto`);
  const comObjetivo = conta(m => m.objetivos.length);
  if (comObjetivo) out.push(`${comObjetivo} de ${n} mortes seguidas de objetivo inimigo em até 90 s`);
  const cedo = conta(m => m.ms < 15 * 60000);
  if (cedo) out.push(`${cedo} de ${n} mortes antes dos 15 min`);
  return out;
}

// HTML do painel (async pelos nomes dos campeões); quem desenha é o abrirPainel, depois de conferir a sessão
async function montar(r) {
  if (r.erro) return `<div class="lc-carregando">pós-jogo: ${esc(r.erro)} <button class="lc-fechar">fechar</button></div>`;
  const meu = await nomeCampeao(r.campeao);
  const adv = r.adversario ? await nomeCampeao(r.adversario.campeao) : null;
  const nomesAliados = {};
  for (const m of r.mortes) for (const p of m.aliadosPerto) nomesAliados[p] ??= await nomeCampeao(r.campeoes[p]);
  const min = Math.floor(r.duracaoS / 60), seg = String(r.duracaoS % 60).padStart(2, '0');

  const linhasMortes = r.mortes.map((m, i) => `<tr class="lc-morte">
      <td><span class="lc-num">${i + 1}</span></td><td>${m.t}</td>
      <td>${REGIAO[m.regiao] || m.regiao}${m.regiao.startsWith('rota') ? ` <span class="lc-nota">(${m.lado === 'inimigo' ? 'passou do meio' : 'lado aliado'})</span>` : ''}</td>
      <td>${m.inimigos}${m.matador === 0 ? ' (execução)' : ''}</td>
      <td>${m.aliadosPerto.length ? m.aliadosPerto.map(p => esc(nomesAliados[p])).join(', ') : '<span class="lc-neg">ninguém</span>'}</td>
      <td>${m.objetivos.length ? m.objetivos.map(o => `${OBJETIVO[o.tipo] || o.tipo}${o.tipo === 'TOWER_BUILDING' ? ` ${TORRE[o.detalhe] || ''} ${ROTA[o.rota] || ''}` : ''}`).join(', ') : '—'}</td>
    </tr>`).join('');

  const linhasDiff = ['10', '15'].filter(k => r.diffs[k]).map(k => {
    const d = r.diffs[k];
    return `<tr><td>${k} min</td><td>${sinal(d.ouro)}</td><td>${sinal(d.xp)}</td><td>${sinal(d.farm)}</td>
      <td class="lc-nota">${d.eu.ouro}/${d.eu.xp}/${d.eu.farm} vs ${d.adv.ouro}/${d.adv.xp}/${d.adv.farm}</td></tr>`;
  }).join('');

  const f = r.farm, um = v => v.toFixed(1).replace('.', ',').replace('-', '−');
  const farmTxt = f.media === null
    ? `${um(f.valor)}/min · amostra insuficiente (${f.n})`
    : `${um(f.valor)}/min contra tua média de ${um(f.media)} com ${esc(meu)} (${f.n} partidas) · ${f.diferenca >= 0 ? '<span class="lc-pos">+' : '<span class="lc-neg">'}${um(f.diferenca)}</span>`;

  const advTxt = r.adversario
    ? `${r.adversario.incerto ? 'adversário provável' : 'contra'} ${esc(adv)} · ${r.papel}`
    : 'sem adversário de rota (papéis não identificados)';

  return `<div class="lc-caixa">
    <div class="lc-topo">
      <h2>${esc(meu)}</h2>
      <span class="${r.vitoria ? 'lc-vitoria' : 'lc-derrota'}">${r.vitoria ? 'vitória' : 'derrota'}</span>
      <span>${min}:${seg} · ${advTxt} · partida ${r.gameId}</span>
      <button class="lc-fechar">fechar (Esc)</button>
    </div>
    <div class="lc-mapa">${svgMapa(r)}
      <div class="lc-legenda"><span><i style="background:#0ac8b9"></i>teu trajeto (1 ponto por minuto)</span><span><i style="background:#e84057"></i>mortes</span></div>
      <div class="lc-nota">posição amostrada 1 vez por minuto: pode estar até 30 s longe do momento real.</div>
    </div>
    <div class="lc-direita">
      <h3>padrões</h3><ul class="lc-padroes">${padroes(r).map(p => `<li>${p}</li>`).join('')}</ul>
      <h3>mortes (${r.mortes.length})</h3>
      ${r.mortes.length ? `<table><tr><th></th><th>tempo</th><th>onde</th><th>inimigos</th><th>aliados perto</th><th>objetivo inimigo em 90 s</th></tr>${linhasMortes}</table>` : '<div>nenhuma</div>'}
      <h3>contra o adversário de rota</h3>
      ${linhasDiff ? `<table><tr><th></th><th>ouro</th><th>xp</th><th>farm</th><th>tu vs ele (ouro/xp/farm)</th></tr>${linhasDiff}</table>` : '<div>sem dados (partida curta ou sem adversário)</div>'}
      <h3>farm por minuto</h3><div>${farmTxt}</div>
      <div class="lc-nota">heurística sobre 1 quadro por minuto: mostra padrões, não veredito. Objetivo depois da morte é coincidência de tempo, não prova de causa.</div>
    </div>
  </div>`;
}

export async function abrirPainel(gameId) {
  moldura('<div class="lc-carregando">analisando a partida…</div>');
  const minha = ++sessao;
  const vivo = () => minha === sessao && !!document.getElementById('lc-posjogo');
  try {
    const r = await analisarPartida(gameId, {
      vivo,
      aoEsperar: ms => { const c = document.querySelector('#lc-posjogo .lc-carregando'); if (c) c.textContent = `processando a partida (nova tentativa em ${ms / 1000} s)…`; },
    });
    if (!vivo()) return r; // fechou enquanto carregava
    const html = await montar(r);
    if (vivo()) moldura(html);
    return r;
  } catch (e) {
    if (!vivo()) return null; // fechado: erro não reabre o painel
    moldura(`<div class="lc-carregando">pós-jogo: ${esc(e.message)} <button class="lc-fechar">fechar</button></div>`);
    throw e;
  }
}

// última partida do Rift no histórico (sem treino, personalizada nem remake: docs/INSIGHTS.md)
export async function analisarUltima() {
  const ultima = (await historico())
    .filter(g => g.mapId === 11 && g.gameDuration >= 300 && !FORA_DAS_CONTAS.includes(g.queueId)).sort((a, b) => b.gameCreation - a.gameCreation)[0];
  if (!ultima) { moldura('<div class="lc-carregando">nenhuma partida de Summoner\'s Rift no histórico <button class="lc-fechar">fechar</button></div>'); return null; }
  return abrirPainel(ultima.gameId);
}

export { fechar as fecharPainel };

// abre sozinho no fim da partida (gameId guardado enquanto a partida rolava)
export function iniciarPosjogo(context, cfg) {
  let gameId = null, mapa = null;
  context.socket.observe('/lol-gameflow/v1/session', msg => {
    const s = msg?.data;
    if (s?.gameData?.gameId) gameId = s.gameData.gameId;
    if (s?.map?.id) mapa = s.map.id;
  });
  context.socket.observe('/lol-gameflow/v1/gameflow-phase', async msg => {
    const fase = msg?.data;
    // o painel (tela cheia) não pode cobrir o aceite nem a seleção: fecha e cancela análise em voo
    if (['ReadyCheck', 'ChampSelect', 'GameStart', 'InProgress'].includes(fase)) fechar();
    // novo ciclo: o id da partida anterior não vale mais (Lobby traz gameId 0)
    if (['None', 'Lobby', 'Matchmaking'].includes(fase)) gameId = null;
    if (fase !== 'EndOfGame' || !cfg.posjogo.ligado) return;
    if (mapa && mapa !== 11) return; // ARAM, Arena etc.: sem painel automático
    if (!gameId) gameId = (await json('/lol-end-of-game/v1/eog-stats-block').catch(() => null))?.gameId;
    if (gameId) abrirPainel(gameId).catch(e => console.error('[lol-client] pós-jogo', e));
  });
}
