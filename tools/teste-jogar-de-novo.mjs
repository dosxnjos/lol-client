// Testa o "jogar de novo e buscar" do pós-jogo (pengu/fila-rapida.js jogarDeNovo) e a guarda de penalidade do
// prepararLobby com LCU falsa (tools/lcu-falsa.mjs): fluxo feliz, grupo/não-líder, penalidade, play-again
// falhando -> dismiss-stats -> lobby novo, fila fora de rotação, timeout da fase e freio de tilt.
// Nenhuma chamada sai para o client de verdade (fetch global trocado pela LCU falsa).
// uso: node tools/teste-jogar-de-novo.mjs
import { jogarDeNovo, prepararLobby, restricaoDura, Recusa } from '../pengu/fila-rapida.js';
import { htmlTopo } from '../pengu/posjogo/abas.js';
import { lcuFalsa, relatar } from './lcu-falsa.mjs';

const BUSCA = 'POST /lol-lobby/v2/lobby/matchmaking/search';
const POS = 'PUT /lol-lobby/v2/lobby/members/localMember/position-preferences';

// cenário: o que o client falso faz. retorno: {res, w (escritas), chamadas, t (relógio final)}
async function cenario({ fase = 'EndOfGame', lq = {}, playAgain = 204, dismiss = 204, lobbyDepois = 'Lobby', lerAteVoltar = 2,
  lobby = {}, criarLobby = 200, cfgFila = {}, opcoes = {} } = {}) {
  let t = 1_000_000;
  const estado = { fase, lobbyExiste: fase === 'Lobby', leituras: 0, voltando: false };
  const ant = { allowedPlayAgain: true, isLeader: true, memberSummonerIds: [111], queueId: 420, ...lq };
  const corpoLobby = () => ({ members: [{ summonerId: 111 }], invitations: [], gameConfig: { queueId: estado.queueId ?? ant.queueId },
    canStartActivity: true, restrictions: [], ...lobby });
  const voltar = destino => { estado.voltando = destino; estado.leituras = 0; };
  const falsa = lcuFalsa({
    'GET /lol-gameflow/v1/gameflow-phase': () => {
      if (estado.voltando && ++estado.leituras > lerAteVoltar) { estado.fase = estado.voltando; estado.lobbyExiste = estado.voltando === 'Lobby'; estado.voltando = false; }
      return estado.fase;
    },
    'GET /lol-gameflow/v1/gameflow-metadata/player-status': { lastQueuedLobbyStatus: ant, currentLobbyStatus: null },
    'POST /lol-lobby/v2/play-again': () => { if (playAgain < 300) voltar(lobbyDepois); return { status: playAgain }; },
    'POST /lol-end-of-game/v1/state/dismiss-stats': () => { if (dismiss < 300) voltar('None'); return { status: dismiss }; },
    'GET /lol-lobby/v2/lobby': () => (estado.lobbyExiste ? corpoLobby() : { status: 404, json: { message: 'LOBBY_NOT_FOUND' } }),
    'POST /lol-lobby/v2/lobby': corpo => { if (criarLobby < 300) { estado.lobbyExiste = true; estado.queueId = corpo.queueId; estado.fase = 'Lobby'; }
      return { status: criarLobby, json: criarLobby < 300 ? corpoLobby() : { message: 'INVALID_QUEUE' } }; },
    [POS]: { status: 201 },
    [BUSCA]: { status: 204 },
  });
  globalThis.fetch = falsa.fetch;
  const cfg = { filaRapida: { pos1: 'TOP', pos2: 'JUNGLE', freioTilt: 0, ...cfgFila } };
  const res = await jogarDeNovo(cfg, { dormir: async ms => { t += ms; }, agora: () => t, ...opcoes });
  return { res, w: falsa.escritas().map(c => `${c.metodo} ${c.url}`), chamadas: falsa.chamadas, t };
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);

{
  const c = await cenario();
  caso('feliz: play-again, posições, busca', c.res.status === 'buscando' && igual(c.w, ['POST /lol-lobby/v2/play-again', POS, BUSCA]), JSON.stringify([c.res, c.w]));
  const pos = c.chamadas.find(x => x.metodo === 'PUT');
  caso('feliz: posições do cfg', igual(pos?.corpo, { firstPreference: 'TOP', secondPreference: 'JUNGLE' }), JSON.stringify(pos?.corpo));
  caso('feliz: busca só depois do lobby lido de volta (Lobby antes da busca)', c.chamadas.findIndex(x => x.url === '/lol-lobby/v2/lobby' && x.metodo === 'GET') < c.chamadas.findIndex(x => x.metodo === 'POST' && x.url.endsWith('/search')));
  caso('nunca toca no bustedLeaverAccessToken', !c.chamadas.some(x => /busted/i.test(x.url)));
}
{
  const c = await cenario({ lq: { queueId: 440 }, cfgFila: { pos1: 'MIDDLE', pos2: 'UTILITY' } });
  caso('mesma fila da partida anterior (flex 440)', c.res.status === 'buscando' && c.res.queueId === 440, JSON.stringify(c.res));
}
{
  const c = await cenario({ lq: { queueId: 450 } });
  caso('fila sem posição (ARAM 450): não manda posições', c.res.status === 'buscando' && !c.w.includes(POS), JSON.stringify(c.w));
}
{
  const c = await cenario({ lq: { memberSummonerIds: [111, 222] } });
  caso('grupo: só play-again, sem busca, motivo "o líder busca"', c.res.status === 'grupo' && igual(c.w, ['POST /lol-lobby/v2/play-again']) && /líder busca/.test(c.res.motivo), JSON.stringify([c.res, c.w]));
}
{
  const c = await cenario({ lq: { isLeader: false } });
  caso('não-líder: só play-again, sem busca', c.res.status === 'grupo' && !c.w.includes(BUSCA), JSON.stringify(c.w));
}
{
  const c = await cenario({ lobby: { canStartActivity: false, restrictions: [{ restrictionCode: 'QUEUE_DODGER', expiredTimestamp: 1_000_000 + 5 * 60000, restrictionArgs: {}, summonerIds: [111] }] } });
  caso('penalidade: recusa com código e prazo, sem busca', c.res.status === 'recusa' && /QUEUE_DODGER/.test(c.res.motivo) && /faltam 5 min/.test(c.res.motivo) && !c.w.includes(BUSCA), JSON.stringify([c.res, c.w]));
}
{
  const c = await cenario({ lobby: { canStartActivity: true, restrictions: [{ restrictionCode: 'ALGO_LEVE', expiredTimestamp: 0 }] } });
  caso('restrição sem canStartActivity false (o client deixa): busca', c.res.status === 'buscando', JSON.stringify(c.res));
}
{
  const c = await cenario({ playAgain: 500 });
  caso('play-again falha -> dismiss-stats -> lobby novo na mesma fila -> busca',
    c.res.status === 'buscando' && igual(c.w, ['POST /lol-lobby/v2/play-again', 'POST /lol-end-of-game/v1/state/dismiss-stats', 'POST /lol-lobby/v2/lobby', POS, BUSCA]), JSON.stringify([c.res, c.w]));
  caso('lobby novo com o queueId da partida', igual(c.chamadas.find(x => x.metodo === 'POST' && x.url === '/lol-lobby/v2/lobby')?.corpo, { queueId: 420 }));
}
{
  const c = await cenario({ playAgain: 500, criarLobby: 400 });
  caso('fila fora de rotação (criar lobby falha): recusa, sem busca', c.res.status === 'recusa' && /fora de rotação/.test(c.res.motivo) && !c.w.includes(BUSCA), JSON.stringify([c.res, c.w]));
}
{
  const c = await cenario({ lq: { allowedPlayAgain: false } });
  caso('allowedPlayAgain false: vai direto ao dismiss-stats', c.w[0] === 'POST /lol-end-of-game/v1/state/dismiss-stats' && !c.w.includes('POST /lol-lobby/v2/play-again') && c.res.status === 'buscando', JSON.stringify(c.w));
}
{
  const c = await cenario({ lerAteVoltar: 1e9 });
  caso('timeout: a fase não sai do EndOfGame em 15 s -> recusa e nada mais', c.res.status === 'recusa' && /a tempo/.test(c.res.motivo) && igual(c.w, ['POST /lol-lobby/v2/play-again']) && c.t - 1_000_000 >= 15000, JSON.stringify([c.res, c.w, c.t]));
  caso('timeout: o texto diz o que foi feito (saiu da tela) e o que não (busca)', /saí da tela de fim de partida/.test(c.res.motivo) && /não busquei/.test(c.res.motivo) && !/nada foi feito/.test(c.res.motivo), c.res.motivo);
}
{
  const c = await cenario({ lobby: { canStartActivity: false, restrictions: [] } });
  caso('canStartActivity false sem restrição (lobby ainda assentando): não recusa, a busca sai', c.res.status === 'buscando' && c.w.includes(BUSCA), JSON.stringify([c.res, c.w]));
}
{
  const c = await cenario({ opcoes: { queueIdEsperado: 0 } }); // personalizada/treino: a última fila do client é a 420
  caso('fila da partida diferente da última fila do client: recusa sem escrever', c.res.status === 'recusa' && /fila 0/.test(c.res.motivo) && c.w.length === 0, JSON.stringify([c.res, c.w]));
  const d = await cenario({ opcoes: { queueIdEsperado: 420 } });
  caso('fila da partida igual à última fila: segue e busca', d.res.status === 'buscando', JSON.stringify(d.res));
}
{
  const c = await cenario({ fase: 'Lobby' });
  caso('já no Lobby (ele fechou a tela de stats): sem play-again, ajusta e busca', c.res.status === 'buscando' && igual(c.w, [POS, BUSCA]), JSON.stringify(c.w));
}
{
  const c = await cenario({ fase: 'InProgress' });
  caso('fase de jogo: recusa sem escrever', c.res.status === 'recusa' && c.w.length === 0, JSON.stringify(c.res));
}
{
  const c = await cenario({ cfgFila: { freioTilt: 3 }, opcoes: { derrotasSeguidas: 3 } });
  caso('freio de tilt: 3 derrotas com limiar 3 pede confirmação sem escrever', c.res.status === 'confirmar' && c.res.derrotas === 3 && c.w.length === 0, JSON.stringify([c.res, c.w]));
  const d = await cenario({ cfgFila: { freioTilt: 3 }, opcoes: { derrotasSeguidas: 3, confirmado: true } });
  caso('freio de tilt: confirmado, segue e busca', d.res.status === 'buscando', JSON.stringify(d.res));
  const e = await cenario({ cfgFila: { freioTilt: 3 }, opcoes: { derrotasSeguidas: 2 } });
  caso('freio de tilt: 2 derrotas com limiar 3 não pede', e.res.status === 'buscando');
  const f = await cenario({ cfgFila: { freioTilt: 0 }, opcoes: { derrotasSeguidas: 9 } });
  caso('freio de tilt 0 = desligado', f.res.status === 'buscando');
  const g = await cenario({ cfgFila: { freioTilt: 3 }, opcoes: { derrotasSeguidas: null } });
  caso('freio de tilt: sequência incerta (histórico não carregou) pede confirmação', g.res.status === 'confirmar' && g.res.derrotas === null && g.w.length === 0, JSON.stringify(g.res));
  const h = await cenario({ cfgFila: { freioTilt: 0 }, opcoes: { derrotasSeguidas: null } });
  caso('freio desligado: sequência incerta não pede nada', h.res.status === 'buscando', JSON.stringify(h.res));
}

// item (b): guarda de penalidade no prepararLobby da fila rápida (nunca busca: prepararLobby não chama search)
{
  const falsa = lcuFalsa({
    'GET /lol-gameflow/v1/gameflow-phase': 'Lobby',
    'GET /lol-lobby/v2/lobby': { members: [{}], invitations: [], gameConfig: { queueId: 420 }, canStartActivity: false,
      restrictions: [{ restrictionCode: 'LEAVER_BUSTED', expiredTimestamp: 0, restrictionArgs: { remainingMillis: 600000 } }] },
    [POS]: { status: 201 },
  });
  globalThis.fetch = falsa.fetch;
  let erro = null;
  try { await prepararLobby({ filaRapida: { fila: 420, pos1: 'TOP', pos2: 'JUNGLE' } }); } catch (e) { erro = e; }
  caso('prepararLobby com canStartActivity false: Recusa com o código e o prazo', erro instanceof Recusa && /LEAVER_BUSTED/.test(erro.message) && /faltam 10 min/.test(erro.message), erro?.message);
  caso('prepararLobby nunca busca', !falsa.chamadas.some(x => x.url.endsWith('/search')));
}
caso('restricaoDura: lobby livre -> null', restricaoDura({ canStartActivity: true, restrictions: [] }) === null);
caso('restricaoDura: canStartActivity false sem restrição -> null (não recusa)', restricaoDura({ canStartActivity: false, restrictions: [] }) === null);
{
  // prepararLobby da fila rápida com o lobby recém-criado ainda sem canStartActivity: não recusa
  const falsa = lcuFalsa({
    'GET /lol-gameflow/v1/gameflow-phase': 'None',
    'POST /lol-lobby/v2/lobby': { status: 200, json: {} },
    'GET /lol-lobby/v2/lobby': { members: [{}], invitations: [], gameConfig: { queueId: 420 }, canStartActivity: false, restrictions: [] },
    [POS]: { status: 201 },
  });
  globalThis.fetch = falsa.fetch;
  let erro = null;
  try { await prepararLobby({ filaRapida: { fila: 420, pos1: 'TOP', pos2: 'JUNGLE' } }); } catch (e) { erro = e; }
  caso('prepararLobby: canStartActivity false sem restrição não recusa', erro === null, erro?.message);
}

// botão no topo do painel: só com a chave; sem .lc-fechar (o clique não fecha o painel por engano)
{
  const r = { duracaoS: 1800, campeao: 58, vitoria: false, gameId: 123, adversario: null, papel: 'TOP' };
  const com = htmlTopo(r, () => 'Renekton', { jogarDeNovo: true }), sem = htmlTopo(r, () => 'Renekton');
  caso('htmlTopo: botão "jogar de novo" só com a chave', com.includes('data-acao="jogar-de-novo"') && !sem.includes('jogar-de-novo'));
  caso('htmlTopo: o botão não tem a classe lc-fechar', !/class="[^"]*lc-fechar[^"]*"[^>]*data-acao="jogar-de-novo"/.test(com));
}

relatar(casos);
