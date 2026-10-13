// Heurísticas do pós-jogo. Dona das regras: docs/INSIGHTS.md (o coletor/analise.py segue a mesma).
// Módulo puro: nada de window/document aqui, para rodar no node (tools/teste-posjogo.mjs).

const C = 14925; // eixo do rio: x + y = C
const PAPEIS_ROTA = ['TOP', 'MIDDLE', 'BOTTOM'];
export const FORA_DAS_CONTAS = [0, 3100, 3140]; // personalizada e treino: fora da amostra de farm e da "última"

// frame do minuto m: não é o final e está a no máximo 5 s da grade
export function frameMinuto(frames, m) {
  if (m >= frames.length - 1) return null;
  const f = frames[m];
  return Math.abs(f.timestamp - m * 60000) <= 5000 ? f : null;
}

export function regiaoAbsoluta(x, y) {
  if (x * x + y * y < 5000 ** 2) return 'base_100';
  if ((14870 - x) ** 2 + (14980 - y) ** 2 < 5000 ** 2) return 'base_200';
  if (x < 2300 || y > 12680 || y - x > 9000) return 'rota_top';
  if (y < 2300 || x > 12570 || x - y > 9000) return 'rota_bot';
  if (Math.abs(y - x) <= 1200) return 'rota_meio';
  if (Math.abs(x + y - C) <= 1400) return 'rio';
  return x + y < C ? 'selva_100' : 'selva_200';
}

export function regiao(x, y, meuTime) {
  const r = regiaoAbsoluta(x, y);
  const m = r.match(/^(base|selva)_(\d+)$/);
  if (!m) return r;
  return `${m[1]}_${Number(m[2]) === meuTime ? 'aliada' : 'inimiga'}`;
}

export function lado(x, y, meuTime) {
  const s = x + y;
  if (s === C) return 'centro';
  return (s < C ? 100 : 200) === meuTime ? 'aliado' : 'inimigo';
}

export function tempo(ms) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const pf = (frame, pid) => frame.participantFrames[String(pid)];
const farmDe = p => p.minionsKilled + p.jungleMinionsKilled;
const porPid = (a, b) => a - b;

// papéis por time; null se faltar f(10) ou algum time não tiver 5
export function papeis(partida, frames) {
  const f10 = frameMinuto(frames, 10);
  if (!f10) return null;
  const papel = {}, folga = {};
  for (const time of [100, 200]) {
    const pids = partida.participants.filter(p => p.teamId === time).map(p => p.participantId).sort(porPid);
    if (pids.length !== 5) return null;
    const ordena = (lista, chave, desc) => [...lista].sort((a, b) => (desc ? chave(b) - chave(a) : chave(a) - chave(b)) || a - b);
    const jg = ordena(pids, p => pf(f10, p).jungleMinionsKilled, true)[0];
    const resto = pids.filter(p => p !== jg);
    const sup = ordena(resto, p => pf(f10, p).minionsKilled, false)[0];
    const rotas = resto.filter(p => p !== sup);
    const s = {};
    for (const p of rotas) {
      let soma = 0;
      for (let i = 3; i <= 10; i++) { const pos = pf(frames[i], p).position; soma += pos.y - pos.x; }
      s[p] = soma / 8;
    }
    const ord = ordena(rotas, p => s[p], true);
    papel[jg] = 'JUNGLE'; papel[sup] = 'UTILITY';
    ord.forEach((p, i) => { papel[p] = PAPEIS_ROTA[i]; });
    folga[time] = Math.min(s[ord[0]] - s[ord[1]], s[ord[1]] - s[ord[2]]);
  }
  return { papel, folga };
}

// time de quem matou o monstro (teamId do evento vem 0)
function timeMatador(ev, timeDe) {
  if (ev.killerId) return timeDe[ev.killerId];
  const a = ev.assistingParticipantIds?.[0];
  return a ? timeDe[a] : undefined;
}

export function analisar(partida, linha, puuid, historico = []) {
  if (partida.mapId !== 11) return { erro: "só Summoner's Rift" };
  const ident = partida.participantIdentities.find(i => i.player?.puuid === puuid);
  if (!ident) return { erro: 'partida de outra conta' };
  const eu = ident.participantId;
  const meu = partida.participants.find(p => p.participantId === eu);
  const meuTime = meu.teamId, timeInimigo = 300 - meuTime;
  const timeDe = Object.fromEntries(partida.participants.map(p => [p.participantId, p.teamId]));
  const frames = linha.frames;

  // papel e adversário
  const pp = papeis(partida, frames);
  let papel = null, adversario = null;
  if (pp) {
    papel = pp.papel[eu];
    const adv = partida.participants.find(p => p.teamId === timeInimigo && pp.papel[p.participantId] === papel);
    adversario = {
      participantId: adv.participantId, campeao: adv.championId,
      incerto: PAPEIS_ROTA.includes(papel) && Math.min(pp.folga[100], pp.folga[200]) < 2000,
    };
  }

  // eventos em ordem da linha do tempo
  const eventos = frames.flatMap(f => f.events || []);

  const mortes = [];
  for (const ev of eventos) {
    if (ev.type !== 'CHAMPION_KILL' || ev.victimId !== eu) continue;
    const ms = ev.timestamp, { x, y } = ev.position;
    let perto = frames[0];
    for (const f of frames) if (Math.abs(f.timestamp - ms) < Math.abs(perto.timestamp - ms)) perto = f;
    const aliadosPerto = partida.participants
      .filter(p => p.teamId === meuTime && p.participantId !== eu)
      .map(p => p.participantId)
      .filter(p => { const pos = pf(perto, p)?.position; return pos && (pos.x - x) ** 2 + (pos.y - y) ** 2 < 2000 ** 2; })
      .sort(porPid);
    const objetivos = eventos
      .filter(o => o.timestamp >= ms && o.timestamp <= ms + 90000)
      .filter(o => (o.type === 'BUILDING_KILL' && o.teamId === meuTime)
        || (o.type === 'ELITE_MONSTER_KILL' && timeMatador(o, timeDe) === timeInimigo))
      .map(o => o.type === 'BUILDING_KILL'
        ? { tipo: o.buildingType, detalhe: o.towerType, rota: o.laneType, ms: o.timestamp }
        : { tipo: o.monsterType, detalhe: o.monsterSubType, rota: '', ms: o.timestamp });
    const assistentes = ev.assistingParticipantIds || [];
    mortes.push({
      ms, t: tempo(ms), x, y, regiao: regiao(x, y, meuTime), lado: lado(x, y, meuTime),
      matador: ev.killerId, assistentes, inimigos: (ev.killerId ? 1 : 0) + assistentes.length,
      frameMs: perto.timestamp, aliadosPerto, objetivos,
    });
  }

  // diferenças aos 10 e 15 min
  const diffs = {};
  if (adversario) for (const m of [10, 15]) {
    const f = frameMinuto(frames, m);
    if (!f) continue;
    const a = pf(f, eu), b = pf(f, adversario.participantId);
    const vEu = { ouro: a.totalGold, xp: a.xp, farm: farmDe(a) };
    const vAdv = { ouro: b.totalGold, xp: b.xp, farm: farmDe(b) };
    diffs[String(m)] = { ouro: vEu.ouro - vAdv.ouro, xp: vEu.xp - vAdv.xp, farm: vEu.farm - vAdv.farm, eu: vEu, adv: vAdv };
  }

  // farm por minuto contra a média com o mesmo campeão
  const fpm = (stats, dur) => (stats.totalMinionsKilled + stats.neutralMinionsKilled) / (dur / 60);
  const amostra = historico
    .filter(g => g.mapId === 11 && g.gameDuration >= 300 && !FORA_DAS_CONTAS.includes(g.queueId)
      && g.gameCreation < partida.gameCreation
      && g.gameId !== partida.gameId && g.participants?.[0]?.championId === meu.championId)
    .sort((a, b) => b.gameCreation - a.gameCreation)
    .slice(0, 20);
  const valor = fpm(meu.stats, partida.gameDuration);
  const n = amostra.length;
  const media = n >= 3 ? amostra.reduce((s, g) => s + fpm(g.participants[0].stats, g.gameDuration), 0) / n : null;

  return {
    gameId: partida.gameId, participantId: eu, time: meuTime, campeao: meu.championId, papel,
    adversario, mortes, diffs,
    farm: { valor, media, n, diferenca: media === null ? null : valor - media },
    amostraIds: amostra.map(g => g.gameId), // fora da spec: só para conferência
    duracaoS: partida.gameDuration, vitoria: !!meu.stats.win, queueId: partida.queueId,
  };
}

// trajeto minuto a minuto do jogador (para o mapa)
export function trajeto(linha, pid) {
  return linha.frames.map(f => pf(f, pid)?.position).filter(Boolean);
}
