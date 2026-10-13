// Botão "FILA RÁPIDA" ao lado do jogar: um clique monta o lobby (fila + posições) e busca partida.
// prepararLobby() NÃO busca; a busca (POST .../matchmaking/search) só sai do clique no botão.

const SELETORES = { ancora: '.navbar_backdrop', botao: '#lc-fila-rapida' };
const FASES_BLOQUEADAS = ['ReadyCheck', 'ChampSelect', 'GameStart', 'InProgress', 'Reconnect', 'WaitingForStats', 'PreEndOfGame', 'EndOfGame'];

const lcu = async (metodo, url, corpo) => {
  const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { ok: r.ok, status: r.status, json };
};

const avisar = (msg, erro) => { try { (erro ? Toast.error : Toast.success)(msg); } catch { console.log('[lol-client]', msg); } };

export class Recusa extends Error {}

// Penalidade (dodge, leaver buster, ranqueada restrita): canStartActivity false E um item em restrictions[] (o
// código e o prazo da mensagem). canStartActivity false sem restrição não recusa: logo depois do POST /lobby e do
// PUT das posições ele pode ainda não ter assentado (não medido); a busca sai e, se o client recusar, o erro
// dela aparece. Nunca tocar no bustedLeaverAccessToken. -> texto da recusa ou null
export function restricaoDura(lobby, agora = Date.now()) {
  if (!lobby || lobby.canStartActivity !== false) return null;
  const r = (lobby.restrictions || [])[0];
  if (!r) return null;
  const fim = Number(r.expiredTimestamp) > 0 ? Number(r.expiredTimestamp)
    : Number(r.restrictionArgs?.remainingMillis) > 0 ? agora + Number(r.restrictionArgs.remainingMillis) : 0;
  const prazo = fim > agora
    ? `, faltam ${Math.ceil((fim - agora) / 60000)} min (até ${new Date(fim).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})` : '';
  return `fila bloqueada pelo client: ${r.restrictionCode || 'restrição'}${prazo}`;
}

// Lobby na fila configurada com as posições; recusa em fase de jogo ou com outro membro no grupo.
export async function prepararLobby(cfg) {
  const fr = cfg.filaRapida;
  if (fr.pos1 === fr.pos2) throw new Recusa(`1ª e 2ª posição iguais (${fr.pos1}): troque no Ctrl+K`);
  const fase = (await lcu('GET', '/lol-gameflow/v1/gameflow-phase')).json;
  if (typeof fase !== 'string') throw new Error('não consegui ler a fase do client');
  if (FASES_BLOQUEADAS.includes(fase)) throw new Recusa(`fila rápida indisponível agora (${fase})`);
  if (fase === 'Matchmaking') throw new Recusa('já está na fila');
  // falha fechada: só segue sem lobby (404) ou com lobby lido e sem mais ninguém (nem convite pendente)
  const lobby = await lcu('GET', '/lol-lobby/v2/lobby');
  if (!lobby.ok && lobby.status !== 404) throw new Error(`ler lobby: ${lobby.status}`);
  if (lobby.ok && ((lobby.json?.members?.length ?? 0) > 1 || lobby.json?.invitations?.some(i => i.state === 'Pending')))
    throw new Recusa('tem mais gente no grupo: monte a fila pelo botão do client');
  if (!lobby.ok || lobby.json?.gameConfig?.queueId !== fr.fila) {
    const r = await lcu('POST', '/lol-lobby/v2/lobby', { queueId: fr.fila });
    if (!r.ok) throw new Error(`criar lobby: ${r.status} ${r.json?.message ?? ''}`);
  }
  const p = await lcu('PUT', '/lol-lobby/v2/lobby/members/localMember/position-preferences', { firstPreference: fr.pos1, secondPreference: fr.pos2 });
  if (!p.ok) throw new Error(`posições: ${p.status} ${p.json?.message ?? ''}`);
  const pronto = (await lcu('GET', '/lol-lobby/v2/lobby')).json;
  const bloqueio = restricaoDura(pronto);
  if (bloqueio) throw new Recusa(bloqueio);
  return pronto;
}

// ---- jogar de novo (pós-jogo) ----
// Só por clique do Gabriel (botão no topo do painel do pós-jogo), nunca sozinho ao cair no Lobby.
// EndOfGame: play-again (ou dismiss-stats) -> espera Lobby/None -> mesma fila da partida anterior
// (lastQueuedLobbyStatus.queueId) -> posições do cfg se a fila usa posição -> busca. Lobby/None: pula a volta.
// Grupo ou não-líder: só volta ao lobby (quem busca é o líder). opcoes: {derrotasSeguidas (null = não sei: com o
// freio ligado pede confirmação), confirmado, queueIdEsperado (fila da partida do painel: diferente da
// lastQueuedLobbyStatus = personalizada/treino ou fila trocada, recusa), dormir, agora, prazoMs}.
// O botão só aparece no painel aberto pelo EndOfGame (posjogo/index.js); Lobby/None = ele saiu da tela de
// estatísticas com o painel aberto (ou o líder do grupo voltou ao lobby).
// -> {status: 'buscando'|'grupo'|'confirmar'|'recusa', motivo?, derrotas?}
export const FILAS_COM_POSICAO = [420, 440, 400];
const dormirPadrao = ms => new Promise(r => setTimeout(r, ms));

export async function jogarDeNovo(cfg, opcoes = {}) {
  const { derrotasSeguidas = 0, confirmado = false, queueIdEsperado, dormir = dormirPadrao, agora = Date.now, prazoMs = 15000 } = opcoes;
  const fr = cfg.filaRapida;
  const recusa = motivo => ({ status: 'recusa', motivo });
  const lerFase = async () => (await lcu('GET', '/lol-gameflow/v1/gameflow-phase')).json;
  const fase = await lerFase();
  if (typeof fase !== 'string') return recusa('não consegui ler a fase do client');
  if (!['EndOfGame', 'Lobby', 'None'].includes(fase)) return recusa(`jogar de novo só depois do fim da partida (agora: ${fase})`);
  // freio de tilt antes de qualquer escrita
  const freio = Number(fr.freioTilt) || 0;
  if (freio > 0 && !confirmado && (derrotasSeguidas === null || derrotasSeguidas >= freio))
    return { status: 'confirmar', derrotas: derrotasSeguidas };

  const st = (await lcu('GET', '/lol-gameflow/v1/gameflow-metadata/player-status')).json;
  const ant = st?.lastQueuedLobbyStatus;
  const queueId = Number(ant?.queueId) || 0;
  if (!queueId || queueId < 0) return recusa('não sei a fila da partida anterior');
  if (queueIdEsperado !== undefined && queueIdEsperado !== null && Number(queueIdEsperado) !== queueId)
    return recusa(`esta partida foi na fila ${queueIdEsperado} e a última fila do client é a ${queueId}: monte pelo client`);
  const grupo = !ant.isLeader || (ant.memberSummonerIds?.length ?? 1) > 1;

  if (fase === 'EndOfGame') {
    let voltou = false;
    if (ant.allowedPlayAgain) voltou = (await lcu('POST', '/lol-lobby/v2/play-again')).ok;
    if (!voltou) {
      const d = await lcu('POST', '/lol-end-of-game/v1/state/dismiss-stats');
      if (!d.ok) return recusa(`não consegui sair da tela de fim de partida (${d.status})`);
    }
    // espera o client sair do EndOfGame
    const ate = agora() + prazoMs;
    let f = await lerFase();
    while (!['Lobby', 'None'].includes(f) && agora() < ate) { await dormir(500); f = await lerFase(); }
    if (!['Lobby', 'None'].includes(f)) return recusa('saí da tela de fim de partida, mas o lobby não voltou a tempo: não busquei');
    if (grupo) return { status: 'grupo', motivo: f === 'Lobby' ? 'de volta ao lobby do grupo: o líder busca' : 'saí da tela de fim de partida; o lobby do grupo não voltou' };
  }
  if (grupo) return { status: 'grupo', motivo: 'em grupo quem busca é o líder' };

  // revalida: entre o clique e agora o Gabriel pode ter mexido
  const f2 = await lerFase();
  if (!['Lobby', 'None'].includes(f2)) return recusa(`fase mudou para ${f2}: nada foi feito`);
  let lobby = await lcu('GET', '/lol-lobby/v2/lobby');
  if (!lobby.ok && lobby.status !== 404) return recusa(`ler lobby: ${lobby.status}`);
  if (lobby.ok && ((lobby.json?.members?.length ?? 0) > 1 || lobby.json?.invitations?.some(i => i.state === 'Pending')))
    return { status: 'grupo', motivo: 'tem mais gente no lobby: o líder busca' };
  if (!lobby.ok || lobby.json?.gameConfig?.queueId !== queueId) {
    // sem lobby (play-again falhou, fila fora de rotação) ou fila diferente: cria na mesma da partida
    const c = await lcu('POST', '/lol-lobby/v2/lobby', { queueId });
    if (!c.ok) return recusa(`não consegui montar a fila ${queueId} (${c.status} ${c.json?.message ?? ''}): fora de rotação?`);
  }
  if (FILAS_COM_POSICAO.includes(queueId)) {
    if (fr.pos1 === fr.pos2) return recusa(`1ª e 2ª posição iguais (${fr.pos1}): troque nas configurações`);
    const p = await lcu('PUT', '/lol-lobby/v2/lobby/members/localMember/position-preferences', { firstPreference: fr.pos1, secondPreference: fr.pos2 });
    if (!p.ok) return recusa(`posições: ${p.status} ${p.json?.message ?? ''}`);
  }
  lobby = await lcu('GET', '/lol-lobby/v2/lobby');
  const bloqueio = restricaoDura(lobby.json, agora());
  if (bloqueio) return recusa(bloqueio);
  const b = await lcu('POST', '/lol-lobby/v2/lobby/matchmaking/search');
  if (!b.ok) return recusa(`buscar: ${b.status} ${b.json?.message ?? ''}`);
  return { status: 'buscando', queueId };
}

// Só o clique chama isto.
async function buscar(cfg) {
  await prepararLobby(cfg);
  const r = await lcu('POST', '/lol-lobby/v2/lobby/matchmaking/search');
  if (!r.ok) throw new Error(`buscar: ${r.status} ${r.json?.message ?? ''}`);
}

async function cancelar() {
  const r = await lcu('DELETE', '/lol-lobby/v2/lobby/matchmaking/search');
  if (!r.ok) throw new Error(`cancelar: ${r.status} ${r.json?.message ?? ''}`);
}

export function iniciarFilaRapida(context, cfg) {
  let buscando = false, ocupado = false;

  const atualizar = b => {
    if (!b) return; // desligado na configuração: sem botão
    b.textContent = buscando ? 'cancelar fila' : 'fila rápida';
    b.classList.toggle('lc-buscando', buscando);
    b.classList.toggle('lc-ocupado', ocupado);
    const fr = cfg.filaRapida;
    b.title = buscando ? 'sair da fila' : `${fr.fila === 420 ? 'solo/duo' : 'flex'}: ${fr.pos1} e ${fr.pos2}`;
  };

  const clique = async () => {
    if (ocupado) return;
    ocupado = true; atualizar(botao());
    try {
      if (buscando) await cancelar();
      else await buscar(cfg);
    } catch (e) {
      avisar(e instanceof Recusa ? e.message : `fila rápida: ${e.message}`, true);
    } finally { ocupado = false; atualizar(botao()); }
  };

  const botao = () => document.querySelector(SELETORES.botao) || criar();
  const criar = () => {
    const ancora = document.querySelector(SELETORES.ancora);
    if (!ancora || !cfg.filaRapida.ligado) return null;
    const b = document.createElement('div');
    b.id = 'lc-fila-rapida';
    b.addEventListener('click', clique);
    ancora.appendChild(b);
    atualizar(b);
    return b;
  };

  // desligado na configuração: o botão sai do DOM; religado: volta sem recarregar
  const sincronizar = () => {
    const b = document.querySelector(SELETORES.botao);
    if (!cfg.filaRapida.ligado) b?.remove();
    else if (b) atualizar(b);
    else criar();
  };

  // o Ember re-renderiza a barra: reinjeta quando some (guarda: só cria se não existir)
  // o init do Pengu roda antes do <body> existir: o DOM fica para depois do DOMContentLoaded
  const ligarDom = () => {
    let pendente = false;
    new MutationObserver(() => {
      if (pendente) return;
      pendente = true;
      requestAnimationFrame(() => { pendente = false; if (!document.querySelector(SELETORES.botao)) criar(); });
    }).observe(document.body, { childList: true, subtree: true });
    criar();
  };
  if (document.body) ligarDom();
  else document.addEventListener('DOMContentLoaded', ligarDom, { once: true });
  lcu('GET', '/lol-lobby/v2/lobby/matchmaking/search-state').then(r => {
    buscando = r.json?.searchState === 'Searching';
    const b = document.querySelector(SELETORES.botao);
    if (b) atualizar(b);
  }).catch(() => {});

  context.socket.observe('/lol-lobby/v2/lobby/matchmaking/search-state', msg => {
    buscando = msg?.data?.searchState === 'Searching';
    const b = document.querySelector(SELETORES.botao);
    if (b) atualizar(b);
  });
  return { prepararLobby: () => prepararLobby(cfg), sincronizar };
}
