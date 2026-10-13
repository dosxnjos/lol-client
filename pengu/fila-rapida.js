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

class Recusa extends Error {}

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
  return (await lcu('GET', '/lol-lobby/v2/lobby')).json;
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
