// Botão "FILA RÁPIDA" ao lado do jogar: um clique monta o lobby (fila + posições) e busca partida.
// prepararLobby() NÃO busca; a busca (POST .../matchmaking/search) só sai do clique no botão.
// Freios (tilt e madrugada, freios.js) valem aqui e no jogar de novo: o 1º clique só pede confirmação.
import { avaliarFreios, textoFreios, derrotasSeguidasAgora, criarConfirmacao, cliqueComFreio, JANELA_MS, ATUALIZANDO } from './freios.js';
import { valida } from './posjogo/abas.js';
import { FORA_DAS_CONTAS } from './posjogo/analise.js';
import { frase } from './compacto/comum.js';

const SELETORES = { ancora: '.navbar_backdrop', botao: '#lc-fila-rapida' };
const FASES_BLOQUEADAS = ['ReadyCheck', 'ChampSelect', 'GameStart', 'InProgress', 'Reconnect', 'WaitingForStats', 'PreEndOfGame', 'EndOfGame'];

const lcu = async (metodo, url, corpo) => {
  const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { ok: r.ok, status: r.status, json };
};

const avisar = (msg, erro) => { try { (erro ? Toast.error : Toast.success)(frase(msg)); } catch { console.log('[lol-client]', msg); } };

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

// fase em que a fila rápida pode montar o lobby; senão Recusa/Error (só leitura)
async function conferirFase() {
  const fase = (await lcu('GET', '/lol-gameflow/v1/gameflow-phase')).json;
  if (typeof fase !== 'string') throw new Error('não foi possível ler a fase do client');
  if (FASES_BLOQUEADAS.includes(fase)) throw new Recusa(`fila rápida indisponível agora (${fase})`);
  if (fase === 'Matchmaking') throw new Recusa('já está na fila');
  return fase;
}

// Lobby na fila configurada com as posições; recusa em fase de jogo ou com outro membro no grupo.
export async function prepararLobby(cfg) {
  const fr = cfg.filaRapida;
  if (fr.pos1 === fr.pos2) throw new Recusa(`1ª e 2ª posição iguais (${fr.pos1}): troque no Ctrl+K`);
  await conferirFase();
  // falha fechada: só segue sem lobby (404) ou com lobby lido e sem mais ninguém (nem convite pendente)
  const lobby = await lcu('GET', '/lol-lobby/v2/lobby');
  if (!lobby.ok && lobby.status !== 404) throw new Error(`ler lobby: ${lobby.status}`);
  if (lobby.ok && ((lobby.json?.members?.length ?? 0) > 1 || lobby.json?.invitations?.some(i => i.state === 'Pending')))
    throw new Recusa('há mais jogadores no grupo: monte a fila pelo botão do client');
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
// lastQueuedLobbyStatus = personalizada/treino ou fila trocada, recusa), dormir, agora (ms), relogio (Date da hora
// local, freio de madrugada), prazoMs}.
// O botão só aparece no painel aberto pelo EndOfGame (posjogo/index.js); Lobby/None = ele saiu da tela de
// estatísticas com o painel aberto (ou o líder do grupo voltou ao lobby).
// -> {status: 'buscando'|'grupo'|'confirmar'|'recusa', motivo?, derrotas?, motivos?, texto?}
export const FILAS_COM_POSICAO = [420, 440, 400];
const dormirPadrao = ms => new Promise(r => setTimeout(r, ms));
const relogioPadrao = () => new Date();

// freios (tilt e madrugada) antes de qualquer escrita: {status:'confirmar', motivos, texto, derrotas} ou null
function freiar(fr, { derrotasSeguidas, confirmado, relogio }) {
  if (confirmado) return null;
  const motivos = avaliarFreios(fr, { derrotasSeguidas, data: relogio() });
  if (!motivos.length) return null;
  return { status: 'confirmar', motivos, texto: textoFreios(motivos), derrotas: motivos.find(m => m.tipo === 'tilt')?.derrotas ?? derrotasSeguidas };
}

export async function jogarDeNovo(cfg, opcoes = {}) {
  const { derrotasSeguidas = 0, confirmado = false, queueIdEsperado, dormir = dormirPadrao, agora = Date.now,
    relogio = relogioPadrao, prazoMs = 15000 } = opcoes;
  const fr = cfg.filaRapida;
  const recusa = motivo => ({ status: 'recusa', motivo });
  const lerFase = async () => (await lcu('GET', '/lol-gameflow/v1/gameflow-phase')).json;
  const fase = await lerFase();
  if (typeof fase !== 'string') return recusa('não foi possível ler a fase do client');
  if (!['EndOfGame', 'Lobby', 'None'].includes(fase)) return recusa(`jogar de novo só depois do fim da partida (agora: ${fase})`);

  const st = (await lcu('GET', '/lol-gameflow/v1/gameflow-metadata/player-status')).json;
  const ant = st?.lastQueuedLobbyStatus;
  const queueId = Number(ant?.queueId) || 0;
  if (!queueId || queueId < 0) return recusa('fila da partida anterior desconhecida');
  if (queueIdEsperado !== undefined && queueIdEsperado !== null && Number(queueIdEsperado) !== queueId)
    return recusa(`esta partida foi na fila ${queueIdEsperado} e a última fila do client é a ${queueId}: monte pelo client`);
  const grupo = !ant.isLeader || (ant.memberSummonerIds?.length ?? 1) > 1;
  // freios antes de qualquer escrita (até aqui só GET) e só quando este caminho busca: em grupo ou sem ser o líder
  // ele só volta ao lobby, e pedir "buscar mesmo assim?" seria mentira (revisão de 13/10/2026)
  if (!grupo) {
    const freio = freiar(fr, { derrotasSeguidas, confirmado, relogio });
    if (freio) return freio;
  }

  if (fase === 'EndOfGame') {
    let voltou = false;
    if (ant.allowedPlayAgain) voltou = (await lcu('POST', '/lol-lobby/v2/play-again')).ok;
    if (!voltou) {
      const d = await lcu('POST', '/lol-end-of-game/v1/state/dismiss-stats');
      if (!d.ok) return recusa(`não foi possível sair da tela de fim de partida (${d.status})`);
    }
    // espera o client sair do EndOfGame
    const ate = agora() + prazoMs;
    let f = await lerFase();
    while (!['Lobby', 'None'].includes(f) && agora() < ate) { await dormir(500); f = await lerFase(); }
    if (!['Lobby', 'None'].includes(f)) return recusa('a tela de fim de partida fechou, mas o lobby não voltou a tempo: a busca não começou');
    if (grupo) return { status: 'grupo', motivo: f === 'Lobby' ? 'de volta ao lobby do grupo: o líder busca' : 'a tela de fim de partida fechou, mas o lobby do grupo não voltou' };
  }
  if (grupo) return { status: 'grupo', motivo: 'em grupo quem busca é o líder' };

  // revalida: entre o clique e agora o Gabriel pode ter mexido
  const f2 = await lerFase();
  if (!['Lobby', 'None'].includes(f2)) return recusa(`fase mudou para ${f2}: nada foi feito`);
  let lobby = await lcu('GET', '/lol-lobby/v2/lobby');
  if (!lobby.ok && lobby.status !== 404) return recusa(`ler lobby: ${lobby.status}`);
  if (lobby.ok && ((lobby.json?.members?.length ?? 0) > 1 || lobby.json?.invitations?.some(i => i.state === 'Pending')))
    return { status: 'grupo', motivo: 'há mais jogadores no lobby: o líder busca' };
  if (!lobby.ok || lobby.json?.gameConfig?.queueId !== queueId) {
    // sem lobby (play-again falhou, fila fora de rotação) ou fila diferente: cria na mesma da partida
    const c = await lcu('POST', '/lol-lobby/v2/lobby', { queueId });
    if (!c.ok) return recusa(`não foi possível montar a fila ${queueId} (${c.status} ${c.json?.message ?? ''}): fora de rotação?`);
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

// Só o clique chama isto. Freios depois de conferir a fase (só leitura) e antes de qualquer escrita.
// opcoes: {confirmado, derrotasSeguidas (número, null = não sei, ou função async que lê; só chamada com o freio de
// tilt ligado e sem confirmação), relogio}. Recusa/Error sobem (o clique mostra). -> {status: 'confirmar'|'buscando'}
export async function buscarFilaRapida(cfg, opcoes = {}) {
  const { confirmado = false, derrotasSeguidas = 0, relogio = relogioPadrao } = opcoes;
  const fr = cfg.filaRapida;
  if (!confirmado) {
    await conferirFase();
    const tilt = (Number(fr.freioTilt) || 0) > 0;
    const seq = !tilt ? 0 : typeof derrotasSeguidas === 'function' ? await derrotasSeguidas() : derrotasSeguidas;
    const freio = freiar(fr, { derrotasSeguidas: seq, confirmado, relogio });
    if (freio) return freio;
  }
  await prepararLobby(cfg);
  const r = await lcu('POST', '/lol-lobby/v2/lobby/matchmaking/search');
  if (!r.ok) throw new Error(`buscar: ${r.status} ${r.json?.message ?? ''}`);
  return { status: 'buscando' };
}

// Partida que entra no freio de tilt (sessão do gameflow guardada durante a partida): Rift, fora personalizada,
// ferramenta de treino e filas de FORA_DAS_CONTAS. Sem fila conhecida, deixa passar (o eog filtra MATCHED_GAME).
// Ferramenta de treino passa pelo EndOfGame e nunca entra no histórico (eog gravado em 13/10/2026: CUSTOM_GAME).
export function contaNoFreio({ mapa, fila, custom } = {}) {
  if (mapa !== 11 || custom) return false;
  if (fila === null || fila === undefined) return true;
  const q = Number(fila);
  return q > 0 && !FORA_DAS_CONTAS.includes(q);
}

// resultado da partida pelo eog-stats-block (chega no EndOfGame, muito antes do histórico de 200 partidas):
// teams[].isPlayerTeam/isWinningTeam, gameLength (s), endOfGameTimestamp (ms), gameType (formato medido no eog gravado
// pelo coletor em 13/10/2026). Remake (gameEndedInEarlySurrender) vai com duração 0: valida() descarta. -> {..} | null
export function resultadoDoEog(d) {
  if (!d?.gameId || d.gameType !== 'MATCHED_GAME') return null;
  const vitoria = (d.teams || []).find(t => t.isPlayerTeam)?.isWinningTeam;
  if (typeof vitoria !== 'boolean') return null;
  return { gameId: d.gameId, vitoria, duracaoS: d.gameEndedInEarlySurrender ? 0 : Number(d.gameLength) || 0, fimMs: Number(d.endOfGameTimestamp) || 0 };
}

// Derrotas seguidas para o freio da fila rápida, sem ler o histórico (15–40 s com 200 partidas) a cada clique.
// fonte: {partidas: () => lista | null (null = nunca leu), ler: () => Promise} (o cache do champselect.js; sem ele,
// lê sozinho). O champselect só relê 60 s depois do EndOfGame e a leitura leva até 40 s: o resultado da partida que
// acabou (resultado(), do eog) entra como partida provisória até o histórico trazê-la, e vitória já zera sem esperar
// leitura nenhuma. Partida que acabou (fimDePartida) sem resultado e fora da lista: relê com prazo e, se ela não
// aparecer, ATUALIZANDO (o freio pede confirmação). Lista nunca lida = null. Sem resultado, a partida que não aparece
// em 10 min deixa de ser cobrada.
const URL_HIST = '/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=199';
export function criarSequencia({ fonte = null, agora = Date.now, esperar = dormirPadrao, desistirMs = 600000 } = {}) {
  if (!fonte) {
    const jogos = new Map();
    let lido = false, emVoo = null;
    fonte = {
      partidas: () => (lido ? [...jogos.values()] : null),
      ler: () => (emVoo ||= lcu('GET', URL_HIST).then(r => {
        const lista = r.json?.games?.games;
        if (r.ok && Array.isArray(lista)) { for (const g of lista) jogos.set(g.gameId, g); lido = true; }
      }).catch(() => {}).finally(() => { emVoo = null; })),
    };
  }
  let faltando = null; // {gameId, em}: acabou e o resultado não chegou
  const provisorias = new Map(); // gameId -> partida montada do eog, até o histórico trazer a de verdade
  const naLista = (lista, id) => !!lista?.some(g => g.gameId === id);
  const falta = lista => !lista || (faltando && agora() - faltando.em < desistirMs && !naLista(lista, faltando.gameId));
  // a provisória sai quando a de verdade chega (nunca conta duas vezes)
  const comProvisorias = lista => {
    for (const id of [...provisorias.keys()]) if (naLista(lista, id)) provisorias.delete(id);
    return [...lista, ...provisorias.values()];
  };
  // a partida mais recente que conta é vitória: 0, com ou sem histórico
  const venceuAUltima = () => {
    const ult = [...provisorias.values()].filter(valida).sort((a, b) => b.gameCreation - a.gameCreation)[0];
    return !!ult && ult.participants[0].stats.win;
  };
  return {
    fimDePartida(gameId) { if (gameId && !provisorias.has(gameId)) faltando = { gameId, em: agora() }; },
    resultado({ gameId, vitoria, duracaoS = 0, fimMs = 0, fila = null } = {}) {
      if (!gameId || typeof vitoria !== 'boolean') return;
      const fim = fimMs > 0 ? fimMs : agora();
      provisorias.set(gameId, { gameId, mapId: 11, queueId: fila, gameDuration: duracaoS, gameCreation: fim - duracaoS * 1000,
        participants: [{ stats: { win: vitoria } }] });
      if (faltando?.gameId === gameId) faltando = null;
    },
    pendente: gameId => faltando?.gameId === gameId,
    async derrotas(prazoMs = 4000) {
      let lista = fonte.partidas();
      if (!lista && venceuAUltima()) return 0;
      if (falta(lista)) {
        await Promise.race([Promise.resolve().then(fonte.ler).catch(() => {}), esperar(prazoMs)]);
        lista = fonte.partidas();
      }
      if (!lista) return venceuAUltima() ? 0 : null;
      if (falta(lista)) return ATUALIZANDO;
      faltando = null;
      return derrotasSeguidasAgora(comProvisorias(lista), agora());
    },
  };
}

async function cancelar() {
  const r = await lcu('DELETE', '/lol-lobby/v2/lobby/matchmaking/search');
  if (!r.ok) throw new Error(`cancelar: ${r.status} ${r.json?.message ?? ''}`);
}

// historico: {partidas, ler} do champselect.js (cache já quente); sem ele, a fila rápida lê sozinha no clique
export function iniciarFilaRapida(context, cfg, { historico = null } = {}) {
  let buscando = false, ocupado = false, textoFreio = '', timerFreio = null;
  const confirmacao = criarConfirmacao();
  const sequencia = criarSequencia({ fonte: historico });

  const atualizar = b => {
    if (!b) return; // desligado na configuração: sem botão
    // o rótulo do freio faz parte do estado: o search-state que chega no meio da janela não pode apagá-lo
    const armado = !buscando && confirmacao.armada();
    b.textContent = buscando ? 'cancelar fila' : armado ? 'buscar mesmo assim?' : 'fila rápida';
    b.classList.toggle('lc-buscando', buscando);
    b.classList.toggle('lc-ocupado', ocupado);
    b.classList.toggle('lc-confirmar', armado);
    const fr = cfg.filaRapida;
    b.title = buscando ? 'sair da fila' : armado ? `${textoFreio} (clique de novo em até ${JANELA_MS / 1000} s)`
      : `${fr.fila === 420 ? 'solo/duo' : 'flex'}: ${fr.pos1} e ${fr.pos2}`;
  };

  const clique = async () => {
    // duplo clique de reflexo (2º em menos de 700 ms depois de armar): ignorado, o rótulo do freio fica
    if (ocupado || (!buscando && confirmacao.cedo())) return;
    ocupado = true; atualizar(botao());
    try {
      if (buscando) { confirmacao.desarmar(); await cancelar(); }
      else {
        const r = await cliqueComFreio(confirmacao, confirmado =>
          buscarFilaRapida(cfg, { confirmado, derrotasSeguidas: () => sequencia.derrotas() }));
        clearTimeout(timerFreio);
        if (r.status === 'confirmar') {
          textoFreio = r.texto;
          avisar(r.texto, true);
          timerFreio = setTimeout(() => atualizar(document.querySelector(SELETORES.botao)), JANELA_MS + 50);
        }
      }
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
  // partida que acabou: o freio de tilt usa o resultado do eog até o histórico trazê-la (criarSequencia).
  // atual = a partida da sessão do gameflow (id, mapa, fila, personalizada); só a que contaNoFreio entra.
  let atual = null;
  context.socket.observe('/lol-gameflow/v1/session', msg => {
    const gd = msg?.data?.gameData;
    if (!gd?.gameId) return;
    atual = { gameId: gd.gameId, mapa: msg.data.map?.id ?? atual?.mapa ?? null, fila: gd.queue?.id ?? null, custom: !!gd.isCustomGame };
  });
  const aplicarEog = (d, partida) => {
    const r = resultadoDoEog(d);
    if (r && partida && r.gameId === partida.gameId && contaNoFreio(partida)) sequencia.resultado({ ...r, fila: partida.fila });
  };
  context.socket.observe('/lol-end-of-game/v1/eog-stats-block', msg => { if (msg?.eventType !== 'Delete') aplicarEog(msg?.data, atual); });
  context.socket.observe('/lol-gameflow/v1/gameflow-phase', msg => {
    if (msg?.data === 'EndOfGame' && atual && contaNoFreio(atual)) {
      const partida = atual;
      sequencia.fimDePartida(partida.gameId);
      // o evento do eog não chegou em 3 s: lê o bloco (só GET)
      setTimeout(() => {
        if (sequencia.pendente(partida.gameId)) lcu('GET', '/lol-end-of-game/v1/eog-stats-block').then(r => aplicarEog(r.json, partida)).catch(() => {});
      }, 3000);
    }
    if (['None', 'Lobby', 'Matchmaking'].includes(msg?.data)) atual = null;
  });
  return { prepararLobby: () => prepararLobby(cfg), sincronizar, derrotasSeguidas: () => sequencia.derrotas() };
}
