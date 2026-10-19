// Abas do pós-jogo v2 (plano v2, passo 7): Resumo, Rota, Mortes, Objetivos, Tendência e Sessão.
// Só monta HTML a partir da análise (analise.js, spec em docs/INSIGHTS.md) e do que chega do coletor
// (contexto, mentor, revisão do jungler). Módulo puro: nada de window/document, roda no node.
import { FORA_DAS_CONTAS } from './analise.js';

export const ABAS = [['resumo', 'Resumo'], ['rota', 'Rota'], ['mortes', 'Mortes'], ['objetivos', 'Objetivos'],
  ['tendencia', 'Tendência'], ['sessao', 'Sessão']];

const LARG = 14870, ALT = 14980, PX = 330;
const sx = x => (x / LARG * PX).toFixed(1);
const sy = y => ((ALT - y) / ALT * PX).toFixed(1);
export const SESSAO_GAP_MS = 2 * 3600 * 1000; // mesma regra do licoes.js, do tilt no MCP e do freio (freios.js)
const REMAKE_S = 300;

// \x22 = aspas duplas: escrito assim para o varredor de literais do tools/teste-textos.mjs (que não entende regex) não se perder
export const esc = s => String(s ?? '').replace(/[&<>\x22]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const virgula = (v, casas = 1) => v.toFixed(casas).replace('.', ',').replace('-', '−');
const mil = v => Math.round(v).toLocaleString('pt-BR');
const sinal = v => (v > 0 ? `<span class="lc-pos">+${mil(v)}</span>` : v < 0 ? `<span class="lc-neg">−${mil(-v)}</span>` : '0');
const mmss = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

const REGIAO = {
  base_aliada: 'base aliada', base_inimiga: 'base inimiga', rota_top: 'rota top', rota_meio: 'rota meio',
  rota_bot: 'rota bot', rio: 'rio', selva_aliada: 'selva aliada', selva_inimiga: 'selva inimiga',
};
const OBJETIVO = {
  DRAGON: 'dragão', ELDER_DRAGON: 'dragão ancião', BARON_NASHOR: 'Barão', RIFTHERALD: 'Arauto', HORDE: 'vastilarva',
  ATAKHAN: 'Atakhan', TOWER_BUILDING: 'torre', INHIBITOR_BUILDING: 'inibidor',
};
const SIGLA = { DRAGON: 'D', ELDER_DRAGON: 'DA', BARON_NASHOR: 'B', RIFTHERALD: 'A', HORDE: 'V', ATAKHAN: 'At', TOWER_BUILDING: 'T', INHIBITOR_BUILDING: 'I' };
const DRAGAO = { WATER_DRAGON: 'oceano', EARTH_DRAGON: 'montanha', AIR_DRAGON: 'nuvem', FIRE_DRAGON: 'infernal',
  HEXTECH_DRAGON: 'hextec', CHEMTECH_DRAGON: 'quimtec', ELDER_DRAGON: 'ancião' };
const TORRE = { OUTER_TURRET: 'externa', INNER_TURRET: 'interna', BASE_TURRET: 'de base', NEXUS_TURRET: 'do nexus' };
const ROTA = { TOP_LANE: 'top', MID_LANE: 'meio', BOT_LANE: 'bot' };
const PAPEL = { TOP: 'topo', JUNGLE: 'selva', MIDDLE: 'meio', BOTTOM: 'atirador', UTILITY: 'suporte' };

// ---------- dados extras (da partida e da linha do tempo da LCU) ----------

// ouro e xp minuto a minuto, meu e do adversário (adv = participantId ou null)
export function curvas(linha, eu, adv) {
  return linha.frames.map(f => {
    const a = f.participantFrames[String(eu)], b = adv ? f.participantFrames[String(adv)] : null;
    return a && { min: f.timestamp / 60000, eu: { ouro: a.totalGold, xp: a.xp }, adv: b ? { ouro: b.totalGold, xp: b.xp } : null };
  }).filter(Boolean);
}

// objetivos dos dois times; ELITE_MONSTER_KILL.teamId vem 0 (time = do matador) e BUILDING_KILL.teamId é o
// DONO do prédio (quem derrubou é o outro): docs/ARMADILHAS.md § LCU API
export function objetivosDaPartida(partida, linha, meuTime) {
  const timeDe = Object.fromEntries(partida.participants.map(p => [p.participantId, p.teamId]));
  const out = [];
  for (const f of linha.frames) for (const ev of f.events || []) {
    if (ev.type === 'ELITE_MONSTER_KILL') {
      const t = timeDe[ev.killerId] || timeDe[ev.assistingParticipantIds?.[0]];
      if (t) out.push({ ms: ev.timestamp, tipo: ev.monsterType, detalhe: ev.monsterSubType || '', rota: '', lado: t === meuTime ? 'aliado' : 'inimigo' });
    } else if (ev.type === 'BUILDING_KILL') {
      out.push({ ms: ev.timestamp, tipo: ev.buildingType, detalhe: ev.towerType || '', rota: ev.laneType || '', lado: ev.teamId === meuTime ? 'inimigo' : 'aliado' });
    }
  }
  return out.sort((a, b) => a.ms - b.ms);
}

export const valida = g => g?.mapId === 11 && !FORA_DAS_CONTAS.includes(g.queueId) && g.gameDuration >= REMAKE_S && !!g.participants?.[0]?.stats;

// 4 indicadores desta partida contra as últimas 20 válidas antes dela (histórico da LCU, só o meu participante)
const INDICADORES = [
  { id: 'farm', rotulo: 'farm por minuto', f: s => s.totalMinionsKilled + s.neutralMinionsKilled, porMin: true, maiorMelhor: true, casas: 1 },
  { id: 'ouro', rotulo: 'ouro por minuto', f: s => s.goldEarned, porMin: true, maiorMelhor: true, casas: 0 },
  { id: 'dano', rotulo: 'dano em campeões por minuto', f: s => s.totalDamageDealtToChampions, porMin: true, maiorMelhor: true, casas: 0 },
  { id: 'mortes', rotulo: 'mortes', f: s => s.deaths, porMin: false, maiorMelhor: false, casas: 1 },
];
export function tendencia(stats, duracaoS, historico, gameId, criacao) {
  const ant = (historico || []).filter(g => valida(g) && g.gameCreation < criacao && g.gameId !== gameId)
    .sort((a, b) => b.gameCreation - a.gameCreation).slice(0, 20).reverse();
  return INDICADORES.map(ind => {
    const v = (s, d) => (ind.porMin ? ind.f(s) / (d / 60) : ind.f(s));
    const esta = v(stats, duracaoS);
    const serie = ant.map(g => v(g.participants[0].stats, g.gameDuration));
    const media = serie.length ? serie.reduce((a, b) => a + b, 0) / serie.length : null;
    // seta: taxa ±5% da média; mortes ±1 (número pequeno, % engana)
    const dif = media === null ? null : esta - media;
    const parado = dif === null || (ind.porMin ? Math.abs(dif) < 0.05 * media : Math.abs(dif) < 1);
    return { ...ind, esta, media, n: serie.length, serie, dif, melhor: parado ? 0 : (dif > 0) === ind.maiorMelhor ? 1 : -1 };
  });
}

// partidas da sessão desta partida (pausa < 2 h entre o fim de uma e o início da outra), nos dois sentidos
export function sessaoDaPartida(historico, esta) {
  const todas = [...(historico || []).filter(g => valida(g) && g.gameId !== esta.gameId).map(g => ({
    gameId: g.gameId, criacao: g.gameCreation, duracao: g.gameDuration, vitoria: !!g.participants[0].stats.win,
    campeao: g.participants[0].championId, k: g.participants[0].stats.kills, d: g.participants[0].stats.deaths,
    a: g.participants[0].stats.assists, fila: g.queueId,
  })), { ...esta, esta: true }].sort((a, b) => a.criacao - b.criacao);
  const i = todas.findIndex(p => p.esta);
  let ini = i, fim = i;
  const junto = (a, b) => b.criacao - (a.criacao + a.duracao * 1000) < SESSAO_GAP_MS;
  while (ini > 0 && junto(todas[ini - 1], todas[ini])) ini--;
  while (fim < todas.length - 1 && junto(todas[fim], todas[fim + 1])) fim++;
  const lista = todas.slice(ini, fim + 1);
  const ate = lista.slice(0, i - ini + 1);
  let seq = 0;
  for (let j = ate.length - 1; j >= 0 && ate[j].vitoria === esta.vitoria; j--) seq++;
  return { lista, posicao: i - ini + 1, seq, vitorias: lista.filter(p => p.vitoria).length };
}

const faixaDe = h => (h < 6 ? '00-06' : h < 12 ? '06-12' : h < 18 ? '12-18' : '18-24');

// alertas da sessão: sequência de derrotas e faixa horária, com o número do histórico (contexto do coletor)
export function alertasSessao(ses, esta, hist, horaAgora) {
  const out = [];
  const geral = hist?.geral?.wr;
  if (!esta.vitoria && ses.seq >= 2) {
    const ad = hist?.apos_derrotas?.[String(Math.min(ses.seq, 3))];
    const num = ad?.n ? `: depois de ${Math.min(ses.seq, 3)}${ses.seq >= 3 ? '+' : ''} derrotas seguidas o seu winrate é ${Math.round(ad.wr)}% (${ad.n} partidas)${geral !== null && geral !== undefined ? `, contra ${Math.round(geral)}% no geral` : ''}` : '';
    out.push({ nivel: ses.seq >= 3 ? 'forte' : 'medio', texto: `${ses.seq} derrotas seguidas${num}. ${ses.seq >= 3 ? 'Pare por hoje ou troque de atividade.' : 'Faça uma pausa de 10 min antes da próxima.'}` });
  }
  const fx = hist?.faixas?.[faixaDe(horaAgora)];
  if (fx?.n >= 10 && geral !== null && geral !== undefined && fx.wr <= geral - 5)
    out.push({ nivel: 'medio', texto: `Agora (${faixaDe(horaAgora).replace('-', '–')}h) o seu winrate é ${Math.round(fx.wr)}% (${fx.n} partidas), contra ${Math.round(geral)}% no geral.` });
  return out;
}

// ---------- abas ----------

const nomeObjetivo = o => {
  if (o.tipo === 'TOWER_BUILDING') return `torre ${TORRE[o.detalhe] || ''} ${ROTA[o.rota] || ''}`.replace(/\s+/g, ' ').trim();
  if (o.tipo === 'INHIBITOR_BUILDING') return `inibidor ${ROTA[o.rota] || ''}`.trim();
  if (o.tipo === 'DRAGON' && DRAGAO[o.detalhe]) return `dragão ${DRAGAO[o.detalhe]}`;
  return OBJETIVO[o.tipo] || o.tipo;
};

// opcoes.jogarDeNovo: botão "jogar de novo e buscar" (fila-rapida.js jogarDeNovo; só por clique). [data-replay]: lugar da linha do
// replay (baixar/assistir), montada por DOM em posjogo/index.js (../replay.js)
export function htmlTopo(r, nome, opcoes = {}) {
  const min = Math.floor(r.duracaoS / 60), seg = String(r.duracaoS % 60).padStart(2, '0');
  const adv = r.adversario ? `${r.adversario.incerto ? 'adversário provável' : 'contra'} ${esc(nome(r.adversario.campeao))} · ${PAPEL[r.papel] || r.papel}` : 'sem adversário de rota';
  return `<div class="lc-topo">
    <h2>${esc(nome(r.campeao))}</h2>
    <span class="${r.vitoria ? 'lc-vitoria' : 'lc-derrota'}">${r.vitoria ? 'vitória' : 'derrota'}</span>
    <span>${min}:${seg} · ${adv} · partida ${esc(r.gameId)}</span>
    <span class="lc-replay-slot" data-replay></span>
    ${opcoes.jogarDeNovo ? '<button class="lc-jogar-de-novo" data-acao="jogar-de-novo" title="volta ao lobby da mesma fila e busca partida">jogar de novo e buscar</button>' : ''}
    <button class="lc-fechar">fechar (Esc)</button>
  </div>
  <nav class="lc-abas">${ABAS.map(([id, t]) => `<button class="lc-aba" data-aba="${id}">${t}</button>`).join('')}</nav>`;
}

// estado do contexto das lições. 'sem' = sem o complemento coach com o recurso "contexto" (Fase 1 de
// roadmap/2026-10-17-plugin-pengu-primeiro.md): nota neutra, nada de "fora do ar". 'local' = sem ele, com o contexto do
// acumulador (posjogo/contexto.js, Fase 5); local = quantas partidas guardadas entraram (0 = nenhum contexto local), que
// também valem enquanto o complemento não responde
export const ctxNota = (estado, local = 0) => {
  const comLocal = `lições com as ${local} partidas guardadas neste computador`;
  return ({
    coletor: 'lições do complemento coach: o histórico inteiro, com matchup, traumas e taxa por horário',
    ok: 'lições com matchup, traumas e histórico do complemento coach',
    local: `lições com matchup, traumas e histórico das ${local} partidas guardadas neste computador`,
    esperando: local ? `esperando o complemento coach gravar a partida; até lá, ${comLocal}`
      : 'esperando o complemento coach gravar a partida (matchup, traumas e histórico entram quando ela chegar)',
    fora: local ? `complemento coach sem resposta: ${comLocal}` : 'complemento coach sem resposta: lições sem matchup, traumas e histórico',
    erro: local ? `complemento coach sem esta partida: ${comLocal}` : 'complemento coach sem esta partida: lições sem matchup, traumas e histórico',
    sem: 'lições com o histórico do client',
  }[estado] || (local ? `consultando o complemento coach; até lá, ${comLocal}` : 'consultando o complemento coach…'));
};

// Resumo (docs/INSIGHTS.md § Pós-jogo v2, D7 do roadmap 2026-10-14): faixa do veredito do mentor no topo (vazia até
// ele chegar: pintar('mentor') enche), placar e lições do motor à esquerda (recolhidas com o mentor ligado:
// opcoes.licoesAbertas), resto do mentor à direita
export function abaResumo(r, licoes, ctxEstado, opcoes = {}) {
  const s = r.stats;
  const farm = s.totalMinionsKilled + s.neutralMinionsKilled;
  const placar = [
    ['KDA', `${s.kills}/${s.deaths}/${s.assists}`], ['farm', `${farm} · ${virgula(farm / (r.duracaoS / 60))}/min`],
    ['ouro', mil(s.goldEarned)], ['dano em campeões', mil(s.totalDamageDealtToChampions)], ['visão', s.visionScore], ['nível', s.champLevel],
  ];
  const lic = licoes.length ? licoes.map((l, i) => `<div class="lc-licao lc-${l.tipo === 'positiva' ? 'positiva' : 'atencao'}">
      <span class="lc-licao-n">${i + 1}</span><span>${esc(l.texto)}</span></div>`).join('')
    : '<div class="lc-vazio">nenhuma regra disparou nesta partida</div>';
  const abertas = opcoes.licoesAbertas === undefined ? true : !!opcoes.licoesAbertas;
  const rotulo = licoes.length ? `${licoes.length === 1 ? 'a lição' : `as ${licoes.length} lições`} do motor de regras` : 'lições do motor de regras';
  return `<div class="lc-resumo">
    <div class="lc-veredito" data-veredito hidden></div>
    <div class="lc-res-esq">
      <div class="lc-placar">${placar.map(([k, v]) => `<div><b>${esc(v)}</b><span>${k}</span></div>`).join('')}</div>
      <details class="lc-licoes-det" data-licoes${abertas ? ' open' : ''}><summary>${rotulo}</summary>
        <div class="lc-licoes">${lic}</div></details>
      <div class="lc-nota" data-ctx-nota>${ctxNota(ctxEstado, r.ctxLocal ? r.amostraLocal || 0 : 0)}</div>
    </div>
    ${opcoes.mentor === false ? '' : `<div class="lc-res-dir lc-mentor">
      <h3>mentor</h3>
      <div class="lc-mentor-corpo" data-mentor>consultando o mentor…</div>
      <form class="lc-mentor-form" data-pergunta><input type="text" maxlength="1000" placeholder="pergunta ao mentor sobre esta partida…" autocomplete="off"><button type="submit">perguntar</button></form>
      <div class="lc-nota" data-mentor-aviso></div>
    </div>`}
  </div>`;
}

// texto do mentor: "Veredito:", "O essencial:", "Mandou bem:" (opcional), "Lições:" (formato até 13/10), "Próxima partida:" em destaque,
// **negrito** e quebras de linha. O modelo costuma escrever o rótulo em negrito ("**Veredito:**"): vira rótulo também.
const ROTULOS = 'Veredito|O essencial|Mandou bem|Lições|Próxima partida';
const textoMentor = t => esc(t).replace(new RegExp(`^[ \\t]*\\*\\*(${ROTULOS}):?\\*\\*:?`, 'gm'), '$1:')
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(new RegExp(`^[ \\t]*(${ROTULOS}):`, 'gm'), '<b class="lc-rotulo">$1:</b>').replace(/\n/g, '<br>');

// separa o veredito (linha "Veredito:", com ou sem **) do resto da resposta do mentor. Sem veredito: tudo no resto.
// O veredito vai até a linha em branco, o próximo rótulo ou o fim do texto.
export function partesMentor(texto) {
  const t = String(texto ?? '');
  const m = t.match(new RegExp(`^[ \\t]*(?:\\*\\*)?Veredito:?(?:\\*\\*)?:?[ \\t]*([\\s\\S]*?)(?=\\n[ \\t]*\\n|\\n[ \\t]*(?:\\*\\*)?(?:${ROTULOS})\\b|(?![\\s\\S]))`, 'm'));
  const veredito = m ? m[1].replace(/\*\*/g, '').replace(/\s+/g, ' ').trim() : '';
  if (!veredito) return { veredito: null, resto: t.trim() };
  return { veredito, resto: (t.slice(0, m.index) + t.slice(m.index + m[0].length)).trim() };
}

// faixa do topo do Resumo: o veredito pronto, "escrevendo" enquanto o mentor pensa; '' (faixa escondida) sem mentor
export function htmlVeredito(m) {
  if (m?.status === 'pensando') return '<span class="lc-pensando">o mentor está escrevendo o veredito<span>…</span></span>';
  if (m?.status !== 'pronto') return '';
  const { veredito } = partesMentor(m.texto);
  return veredito ? `<b class="lc-rotulo">Veredito</b> ${esc(veredito)}` : '';
}

export function htmlMentor(m) {
  if (!m || m.status === 'carregando') return 'consultando o mentor…';
  if (m.status === 'fora') return '<span class="lc-nota">complemento coach sem resposta: o mentor roda nele. Nova tentativa em instantes.</span>';
  if (m.status === 'indisponivel') return '<span class="lc-nota">mentor desligado no complemento coach (Configurações › LOL-CLIENT › Mentor).</span>';
  const partes = [];
  if (m.status === 'nada') partes.push(`<div class="lc-nota">o complemento coach pede a análise sozinho quando a partida chega no banco (até ~3 min depois do fim).</div>
    <button class="lc-botao" data-acao="mentor-gerar">pedir a análise agora</button>`);
  else if (m.status === 'pensando') partes.push('<div class="lc-pensando">mentor pensando<span>…</span></div>');
  else if (m.status === 'erro') {
    const ult = [...(m.conversa || [])].reverse().find(c => c.uso === 'posjogo');
    partes.push(`<div class="lc-neg">o mentor falhou: ${esc(ult?.erro || 'sem detalhe')}</div><button class="lc-botao" data-acao="mentor-gerar">tentar de novo</button>`);
  } else partes.push(`<div class="lc-mentor-texto">${textoMentor(partesMentor(m.texto).resto)}</div>`); // veredito: faixa do topo
  for (const c of (m.conversa || []).filter(x => x.uso === 'pergunta')) {
    const resp = c.status === 'pensando' ? '<span class="lc-pensando">pensando<span>…</span></span>'
      : c.status === 'erro' ? `<span class="lc-neg">${esc(c.erro || 'falhou')}</span>` : textoMentor(c.resposta || '');
    partes.push(`<div class="lc-conversa"><div class="lc-pergunta">você: ${esc(c.pergunta)}</div><div>${resp}</div></div>`);
  }
  return partes.join('');
}

// gráfico de linhas (eu x adversário) em SVG; mortes minhas como marcas no eixo do tempo
function grafico(titulo, pontos, chave, mortes, lado = 540, alto = 230) {
  const m = { e: 46, d: 12, c: 10, b: 24 };
  const w = lado - m.e - m.d, h = alto - m.c - m.b;
  const maxMin = Math.max(1, pontos[pontos.length - 1].min);
  const vals = pontos.flatMap(p => [p.eu[chave], p.adv?.[chave]]).filter(v => v !== undefined && v !== null);
  const maxV = Math.max(1, ...vals) * 1.05;
  const X = mn => (m.e + mn / maxMin * w).toFixed(1), Y = v => (m.c + h - v / maxV * h).toFixed(1);
  const linha = (sel, cor) => {
    const ps = pontos.filter(p => sel(p) !== undefined && sel(p) !== null);
    return ps.length ? `<polyline points="${ps.map(p => `${X(p.min)},${Y(sel(p))}`).join(' ')}" fill="none" stroke="${cor}" stroke-width="2"/>` : '';
  };
  const passo = maxV > 20000 ? 5000 : maxV > 8000 ? 2000 : 1000;
  let grade = '';
  for (let v = passo; v < maxV; v += passo) grade += `<line x1="${m.e}" x2="${lado - m.d}" y1="${Y(v)}" y2="${Y(v)}" stroke="#1e2328"/><text x="${m.e - 6}" y="${(+Y(v) + 4).toFixed(1)}" text-anchor="end">${v / 1000}k</text>`;
  let eixo = '';
  for (let mn = 5; mn <= maxMin; mn += 5) eixo += `<text x="${X(mn)}" y="${alto - 6}" text-anchor="middle">${mn}</text>`;
  const marcas = [10, 15].filter(mn => mn <= maxMin).map(mn => `<line x1="${X(mn)}" x2="${X(mn)}" y1="${m.c}" y2="${m.c + h}" stroke="#463714" stroke-dasharray="3 3"/>`).join('');
  const mt = mortes.map(mo => `<text x="${X(mo.ms / 60000)}" y="${(m.c + h - 3).toFixed(1)}" text-anchor="middle" class="lc-g-morte">✕</text>`).join('');
  const ult = pontos[pontos.length - 1];
  return `<div class="lc-grafico"><div class="lc-g-titulo">${titulo} <span class="lc-nota">fim: você ${mil(ult.eu[chave])}${ult.adv ? ` · ele ${mil(ult.adv[chave])}` : ''}</span></div>
    <svg viewBox="0 0 ${lado} ${alto}" width="${lado}" height="${alto}" xmlns="http://www.w3.org/2000/svg">
    ${grade}${eixo}${marcas}${linha(p => p.adv?.[chave], '#e84057')}${linha(p => p.eu[chave], '#0ac8b9')}${mt}</svg></div>`;
}

export function abaRota(r, nome) {
  const adv = r.adversario ? esc(nome(r.adversario.campeao)) : null;
  const linhasDiff = ['10', '15'].filter(k => r.diffs[k]).map(k => {
    const d = r.diffs[k];
    return `<tr><td>${k} min</td><td>${sinal(d.ouro)}</td><td>${sinal(d.xp)}</td><td>${sinal(d.farm)}</td>
      <td class="lc-nota">${mil(d.eu.ouro)} / ${mil(d.eu.xp)} / ${d.eu.farm} contra ${mil(d.adv.ouro)} / ${mil(d.adv.xp)} / ${d.adv.farm}</td></tr>`;
  }).join('');
  const f = r.farm;
  const farmTxt = f.media === null ? `${virgula(f.valor)}/min · amostra insuficiente (${f.n})`
    : `${virgula(f.valor)}/min contra a sua média de ${virgula(f.media)} com ${esc(nome(r.campeao))} (${f.n} partidas) · ${f.diferenca >= 0 ? '<span class="lc-pos">+' : '<span class="lc-neg">'}${virgula(f.diferenca)}</span>`;
  return `<div class="lc-legenda"><span><i style="background:#0ac8b9"></i>você</span>${adv ? `<span><i style="background:#e84057"></i>${adv}${r.adversario.incerto ? ' (provável)' : ''}</span>` : ''}<span class="lc-g-morte">✕</span> suas mortes · tracejado: 10 e 15 min</div>
    <div class="lc-graficos">${grafico('ouro total', r.curva, 'ouro', r.mortes)}${grafico('experiência', r.curva, 'xp', r.mortes)}</div>
    <div class="lc-rota-baixo">
      <div><h3>contra o adversário de rota</h3>
        ${linhasDiff ? `<table><tr><th></th><th>ouro</th><th>xp</th><th>farm</th><th>você contra ele (ouro / xp / farm)</th></tr>${linhasDiff}</table>` : '<div>sem dados (partida curta ou sem adversário)</div>'}</div>
      <div><h3>farm por minuto</h3><div>${farmTxt}</div>
        <div class="lc-nota">ouro e xp da linha do tempo: 1 quadro por minuto.</div></div>
    </div>`;
}

function svgMapa(r) {
  const rota = 'fill="none" stroke="#2a3a3a" stroke-width="14" stroke-linecap="round"';
  const pontos = r.trajeto.map(p => `${sx(p.x)},${sy(p.y)}`).join(' ');
  const passos = r.trajeto.map((p, i) => `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="2.2" fill="#0ac8b9" opacity="${(0.35 + 0.65 * i / r.trajeto.length).toFixed(2)}"/>`).join('');
  const mortes = r.mortes.map((m, i) => `<g><circle cx="${sx(m.x)}" cy="${sy(m.y)}" r="8" fill="#e84057" stroke="#010a13" stroke-width="1.5"/>
    <text x="${sx(m.x)}" y="${(+sy(m.y) + 3.5).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">${i + 1}</text></g>`).join('');
  return `<svg class="lc-mapa-svg" viewBox="0 0 ${PX} ${PX}" xmlns="http://www.w3.org/2000/svg">
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

export function padroes(r) {
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

export function abaMortes(r, nome) {
  const linhas = r.mortes.map((m, i) => `<tr class="lc-morte">
      <td><span class="lc-num">${i + 1}</span></td><td>${m.t}</td>
      <td>${REGIAO[m.regiao] || m.regiao}${m.regiao.startsWith('rota') ? ` <span class="lc-nota">(${m.lado === 'inimigo' ? 'passou do meio' : 'lado aliado'})</span>` : ''}</td>
      <td>${m.inimigos}${m.matador === 0 ? ' (execução)' : ''}</td>
      <td>${m.aliadosPerto.length ? m.aliadosPerto.map(p => esc(nome(r.campeoes[p]))).join(', ') : '<span class="lc-neg">ninguém</span>'}</td>
      <td>${m.objetivos.length ? m.objetivos.map(nomeObjetivo).join(', ') : '—'}</td>
    </tr>`).join('');
  return `<div class="lc-mortes">
    <div class="lc-mapa">${svgMapa(r)}
      <div class="lc-legenda"><span><i style="background:#0ac8b9"></i>seu trajeto (1 ponto por minuto)</span><span><i style="background:#e84057"></i>mortes</span></div>
      <div class="lc-nota">posição amostrada 1 vez por minuto: pode estar até 30 s longe do momento real.</div>
    </div>
    <div class="lc-direita">
      <h3>padrões</h3><ul class="lc-padroes">${padroes(r).map(p => `<li>${p}</li>`).join('')}</ul>
      <h3>mortes (${r.mortes.length})</h3>
      ${r.mortes.length ? `<table><tr><th></th><th>tempo</th><th>onde</th><th>inimigos</th><th>aliados perto</th><th>objetivo inimigo em 90 s</th></tr>${linhas}</table>` : '<div>nenhuma</div>'}
      <div class="lc-nota">heurística sobre 1 quadro por minuto: mostra padrões, não veredito. Objetivo depois da morte é coincidência de tempo, não prova de causa.</div>
    </div>
  </div>`;
}

export function abaObjetivos(r) {
  const objs = r.objetivos, dur = r.duracaoS * 1000;
  const L = 1120, A = 150, me = 70, md = 16;
  const X = ms => (me + ms / dur * (L - me - md)).toFixed(1);
  const yDe = { aliado: 38, inimigo: 112 };
  let eixo = '';
  for (let mn = 5; mn * 60000 < dur; mn += 5) eixo += `<line x1="${X(mn * 60000)}" x2="${X(mn * 60000)}" y1="14" y2="${A - 18}" stroke="#1e2328"/><text x="${X(mn * 60000)}" y="${A - 4}" text-anchor="middle">${mn}</text>`;
  const marca = o => {
    const cor = o.lado === 'aliado' ? '#0ac8b9' : '#e84057';
    const pred = o.tipo.endsWith('_BUILDING');
    const forma = pred ? `<rect x="${(+X(o.ms) - 8).toFixed(1)}" y="${yDe[o.lado] - 8}" width="16" height="16" fill="#010a13" stroke="${cor}" stroke-width="1.5"/>`
      : `<circle cx="${X(o.ms)}" cy="${yDe[o.lado]}" r="9" fill="${cor}" opacity=".9"/>`;
    return `<g><title>${mmss(o.ms)} ${nomeObjetivo(o)} (${o.lado === 'aliado' ? 'seu time' : 'inimigo'})</title>${forma}
      <text x="${X(o.ms)}" y="${yDe[o.lado] + 3.5}" text-anchor="middle" class="${pred ? 'lc-o-pred' : 'lc-o-mon'}" fill="${pred ? cor : '#010a13'}">${SIGLA[o.tipo] || '?'}</text></g>`;
  };
  const mortes = r.mortes.map((m, i) => `<g><title>${m.t} sua morte ${i + 1}</title><text x="${X(m.ms)}" y="79" text-anchor="middle" class="lc-g-morte">✕</text></g>`).join('');
  const conta = (lado, f) => objs.filter(o => o.lado === lado && f(o)).length;
  const tipos = [['dragões', o => o.tipo === 'DRAGON' || o.tipo === 'ELDER_DRAGON'], ['vastilarvas', o => o.tipo === 'HORDE'], ['Arauto', o => o.tipo === 'RIFTHERALD'],
    ['Barão', o => o.tipo === 'BARON_NASHOR'], ['Atakhan', o => o.tipo === 'ATAKHAN'], ['torres', o => o.tipo === 'TOWER_BUILDING'], ['inibidores', o => o.tipo === 'INHIBITOR_BUILDING']];
  const placar = tipos.filter(([, f]) => conta('aliado', f) + conta('inimigo', f) > 0)
    .map(([n, f]) => `<div><b><span class="lc-pos">${conta('aliado', f)}</span> × <span class="lc-neg">${conta('inimigo', f)}</span></b><span>${n}</span></div>`).join('');
  const lista = objs.map(o => `<li class="lc-${o.lado}"><span>${mmss(o.ms)}</span> ${nomeObjetivo(o)}</li>`).join('');
  return `<div class="lc-placar lc-placar-obj">${placar || '<div>nenhum objetivo na linha do tempo</div>'}</div>
    <svg class="lc-linha-obj" viewBox="0 0 ${L} ${A}" width="${L}" height="${A}" xmlns="http://www.w3.org/2000/svg">
      <text x="4" y="${yDe.aliado + 4}" class="lc-o-rot">seu time</text><text x="4" y="83" class="lc-o-rot">suas mortes</text><text x="4" y="${yDe.inimigo + 4}" class="lc-o-rot">inimigo</text>
      ${eixo}${objs.map(marca).join('')}${mortes}</svg>
    <div class="lc-legenda"><span>D dragão · V vastilarva · A Arauto · B Barão · At Atakhan · T torre · I inibidor</span><span><i style="background:#0ac8b9"></i>seu time</span><span><i style="background:#e84057"></i>inimigo</span></div>
    <ul class="lc-lista-obj">${lista}</ul>`;
}

function barras(serie, esta, ind) {
  const vals = [...serie, esta];
  const max = Math.max(...vals, 1e-9), L = 210, A = 44, w = L / vals.length;
  return `<svg viewBox="0 0 ${L} ${A}" width="${L}" height="${A}" xmlns="http://www.w3.org/2000/svg">${vals.map((v, i) => {
    const h = Math.max(1, v / max * (A - 2));
    const ult = i === vals.length - 1;
    return `<rect x="${(i * w + 1).toFixed(1)}" y="${(A - h).toFixed(1)}" width="${(w - 2).toFixed(1)}" height="${h.toFixed(1)}" fill="${ult ? (ind.melhor > 0 ? '#0ac8b9' : ind.melhor < 0 ? '#e84057' : '#c8aa6e') : '#3c3c41'}"/>`;
  }).join('')}</svg>`;
}

export function abaTendencia(r, nome, ctx, ctxEstado, revisao, mostrarTraumas) {
  const inds = r.tendencia.map(t => {
    const seta = t.melhor > 0 ? '<span class="lc-pos">▲ melhor</span>' : t.melhor < 0 ? '<span class="lc-neg">▼ pior</span>' : '<span class="lc-nota">▬ na média</span>';
    return `<div class="lc-ind"><div class="lc-ind-rot">${t.rotulo}</div>
      <div class="lc-ind-num"><b>${virgula(t.esta, t.casas)}</b> ${t.media === null ? '<span class="lc-nota">sem histórico</span>' : `<span class="lc-nota">média ${virgula(t.media, t.casas)} (${t.n})</span>`}</div>
      <div>${seta}</div>${t.n ? barras(t.serie, t.esta, t) : ''}</div>`;
  }).join('');
  let traumas = '';
  if (mostrarTraumas) {
    const lista = (ctx?.traumas || []).slice().sort((a, b) => (b.lift - a.lift) || (a.campeao - b.campeao));
    traumas = `<div><h3>traumas nesta partida</h3>${ctx ? (lista.length ? `<ul class="lc-padroes">${lista.map(t =>
      `<li><b>${esc(nome(t.campeao))}</b> é trauma: ${t.vitorias}V/${t.derrotas}D com ${esc(nome(r.campeao))} · lift ${virgula(t.lift, 2)}</li>`).join('')}</ul>`
      : '<div>nenhum campeão-trauma no time inimigo desta partida</div>') : `<div class="lc-nota">${ctxNota(ctxEstado)}</div>`}
      <div class="lc-nota">trauma: campeão inimigo com derrota acima da sua taxa geral (lift ≥ 1,2, n ≥ 3); com ~170 campeões comparados, 1 ou 2 podem ser acaso.</div></div>`;
  }
  // revisao === false: sem o recurso "revisao" do complemento coach, o bloco da previsão do jungler some
  const rv = revisao?.revisao;
  const pct = p => (p === null || p === undefined ? '—' : `${Math.round(p * 100)}%`);
  const ac = revisao?.acumulada;
  const jg = revisao === false ? '' : rv ? `<div class="lc-ind-num"><b>${rv.acertos}/${rv.n}</b> <span class="lc-nota">minutos com o jungler a ≤ ${rv.raio} unidades da previsão (${pct(rv.precisao)})</span></div>
      ${ac ? `<div class="lc-nota">acumulado: ${ac.acertos}/${ac.n} (${pct(ac.precisao)}) em ${ac.partidas} ${ac.partidas === 1 ? 'partida' : 'partidas'}</div>` : ''}`
    : `<div class="lc-nota">${revisao?.status === 0 ? 'complemento coach sem resposta' : 'sem previsão gravada nesta partida (o coach ao vivo não rodou nela)'}</div>`;
  return `<h3>esta partida contra as suas últimas ${r.tendencia[0]?.n ?? 0} (Rift, sem remake)</h3>
    <div class="lc-inds">${inds}</div>
    <div class="lc-tend-baixo">${traumas}${jg ? `<div><h3>previsão do jungler inimigo</h3>${jg}</div>` : ''}</div>`;
}

export function abaSessao(r, nome, ses, ranked, ctx, ctxEstado, horaAgora) {
  const solo = ranked?.queueMap?.RANKED_SOLO_5x5;
  const elo = solo?.tier && solo.tier !== 'NONE' ? `${solo.tier} ${solo.division && solo.division !== 'NA' ? solo.division : ''} · ${solo.leaguePoints} PDL (${solo.wins}V ${solo.losses}D na temporada)` : 'sem ranque na Solo/Duo';
  const linhas = ses.lista.map((p, i) => `<tr class="${p.esta ? 'lc-esta' : ''}"><td>${i + 1}</td><td>${new Date(p.criacao).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
    <td>${esc(nome(p.campeao))}</td><td class="${p.vitoria ? 'lc-pos' : 'lc-neg'}">${p.vitoria ? 'vitória' : 'derrota'}</td><td>${p.k}/${p.d}/${p.a}</td>
    <td>${Math.floor(p.duracao / 60)} min</td><td>${p.esta ? '← esta' : ''}</td></tr>`).join('');
  const alertas = alertasSessao(ses, { vitoria: r.vitoria }, ctx?.historico, horaAgora);
  const alertaHtml = alertas.length ? alertas.map(a => `<div class="lc-alerta lc-alerta-${a.nivel}">${esc(a.texto)}</div>`).join('')
    : `<div class="lc-alerta lc-alerta-ok">${ctx ? 'Sem alerta: nem sequência de derrotas nem faixa horária ruim agora.'
      : ctxEstado === 'sem' ? 'Sem alerta: nenhuma sequência de derrotas agora.' : esc(ctxNota(ctxEstado))}</div>`;
  return `<div class="lc-placar">
      <div><b>${ses.lista.length}</b><span>partidas na sessão</span></div>
      <div><b><span class="lc-pos">${ses.vitorias}V</span> <span class="lc-neg">${ses.lista.length - ses.vitorias}D</span></b><span>resultado</span></div>
      <div><b>${ses.seq} ${r.vitoria ? (ses.seq === 1 ? 'vitória' : 'vitórias') : (ses.seq === 1 ? 'derrota' : 'derrotas')}</b><span>seguidas até esta</span></div>
      <div><b>${ses.posicao}ª</b><span>partida da sessão</span></div>
    </div>
    ${alertaHtml}
    <h3>partidas da sessão (pausa de 2 h ou mais abre outra)</h3>
    <table><tr><th></th><th>hora</th><th>campeão</th><th>resultado</th><th>KDA</th><th>duração</th><th></th></tr>${linhas}</table>
    <h3>ranque</h3><div>Solo/Duo agora: ${esc(elo)}</div>
    <div class="lc-nota">o histórico do client guarda 20 ou 200 partidas.</div>`;
}
