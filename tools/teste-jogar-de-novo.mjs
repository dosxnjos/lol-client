// Testa o "jogar de novo e buscar" do pós-jogo (pengu/fila-rapida.js jogarDeNovo) e a guarda de penalidade do
// prepararLobby com LCU falsa (tools/lcu-falsa.mjs): fluxo feliz, grupo/não-líder, penalidade, play-again
// falhando -> dismiss-stats -> lobby novo, fila fora de rotação, timeout da fase e freio de tilt.
// Freios (pengu/freios.js, decisão do Gabriel de 13/10/2026): tilt com padrão 2, madrugada (01:00–05:59), os dois na
// fila rápida (buscarFilaRapida) e no jogar de novo, 2º clique dentro/fora da janela de 8 s, sequência de derrotas
// da fila rápida (criarSequencia). Relógio sempre injetado: nenhum Date real decide nada aqui.
// Nenhuma chamada sai para o client de verdade (fetch global trocado pela LCU falsa).
// uso: node tools/teste-jogar-de-novo.mjs
import { jogarDeNovo, prepararLobby, restricaoDura, Recusa, buscarFilaRapida, criarSequencia, resultadoDoEog, contaNoFreio } from '../pengu/fila-rapida.js';
import { criarConfirmacao, cliqueComFreio, derrotasSeguidasAgora, avaliarFreios, textoFreios, ehMadrugada, MEDICAO, JANELA_MS, ATUALIZANDO } from '../pengu/freios.js';
import { htmlTopo } from '../pengu/posjogo/abas.js';
import { lcuFalsa, relatar } from './lcu-falsa.mjs';

const BUSCA = 'POST /lol-lobby/v2/lobby/matchmaking/search';
const POS = 'PUT /lol-lobby/v2/lobby/members/localMember/position-preferences';
// hora local montada à mão (não depende do fuso da máquina nem do relógio real)
const as = (h, m = 0) => () => new Date(2026, 9, 13, h, m, 0);
const TARDE = as(15);

// cenário: o que o client falso faz. retorno: {res, w (escritas), chamadas, t (relógio final)}
// cfg base com freioMadrugada false e relógio de tarde: os casos antigos não dependem da hora
async function cenario({ fase = 'EndOfGame', lq = {}, playAgain = 204, dismiss = 204, lobbyDepois = 'Lobby', lerAteVoltar = 2,
  lobby = {}, criarLobby = 200, cfgFila = {}, opcoes = {}, cliques = null } = {}) {
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
  const cfg = { filaRapida: { pos1: 'TOP', pos2: 'JUNGLE', freioTilt: 0, freioMadrugada: false, ...cfgFila } };
  const rodar = confirmado => jogarDeNovo(cfg, { dormir: async ms => { t += ms; }, agora: () => t, relogio: TARDE, ...opcoes,
    ...(confirmado === undefined ? {} : { confirmado }) });
  const w = () => falsa.escritas().map(c => `${c.metodo} ${c.url}`);
  // cliques: [ms desde o clique anterior, ...]: mesmo mecanismo do botão (cliqueComFreio), relógio falso
  if (cliques) {
    let relogioBotao = 0;
    const conf = criarConfirmacao({ agora: () => relogioBotao });
    const res = [], escritas = [];
    for (const dt of cliques) {
      relogioBotao += dt;
      res.push(await cliqueComFreio(conf, rodar));
      escritas.push(w());
    }
    return { res, escritas, w: w(), chamadas: falsa.chamadas };
  }
  const res = await rodar();
  return { res, w: w(), chamadas: falsa.chamadas, t };
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

// ---- freios (decisão do Gabriel, 13/10/2026: tilt 2 e madrugada) ----
const TEXTO_TILT_2 = '2 derrotas seguidas: depois disso teu winrate cai para 44%. buscar mesmo assim?';
const TEXTO_MADRUGADA = 'de madrugada teu winrate cai: 47% contra 58% de dia. buscar mesmo assim?';
caso('números da medição num lugar só, com a data', MEDICAO.data === '13/10/2026' && MEDICAO.wrDepoisDe2 === 44 && MEDICAO.wrMadrugada === 47 && MEDICAO.wrDia === 58);
caso('janela do 2º clique: 8 s', JANELA_MS === 8000);
caso('madrugada: 01:00 e 05:59 sim; 00:59 e 06:00 não',
  ehMadrugada(as(1)()) && ehMadrugada(as(5, 59)()) && !ehMadrugada(as(0, 59)()) && !ehMadrugada(as(6)()));
caso('texto do tilt cita as derrotas e os 44%', textoFreios([{ tipo: 'tilt', derrotas: 2 }]) === TEXTO_TILT_2, textoFreios([{ tipo: 'tilt', derrotas: 2 }]));
caso('texto da madrugada cita 47% contra 58%', textoFreios([{ tipo: 'madrugada' }]) === TEXTO_MADRUGADA, textoFreios([{ tipo: 'madrugada' }]));
caso('3 derrotas: cita as 3 e o número medido (o de 2), não inventa outro',
  /^3 derrotas seguidas: depois de 2 teu winrate já cai para 44%\. buscar mesmo assim\?$/.test(textoFreios([{ tipo: 'tilt', derrotas: 3 }])));
caso('sequência incerta tem frase própria', /não sei quantas derrotas/.test(textoFreios([{ tipo: 'tilt', derrotas: null }])));
caso('avaliarFreios: madrugada desligada não pede', avaliarFreios({ freioTilt: 0, freioMadrugada: false }, { derrotasSeguidas: 0, data: as(3)() }).length === 0);
for (const [h, m, pede] of [[1, 0, true], [5, 59, true], [6, 0, false], [0, 59, false]]) {
  const c = await cenario({ cfgFila: { freioMadrugada: true }, opcoes: { relogio: as(h, m) } });
  const hh = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  caso(`jogar de novo às ${hh}: ${pede ? 'pede confirmação sem escrever' : 'busca direto'}`,
    pede ? c.res.status === 'confirmar' && c.res.texto === TEXTO_MADRUGADA && c.w.length === 0 : c.res.status === 'buscando', JSON.stringify([c.res, c.w]));
}
{
  const c = await cenario({ cfgFila: { freioTilt: 2 }, opcoes: { derrotasSeguidas: 2 } });
  caso('jogar de novo: tilt 2 com 2 derrotas pede, com o texto das derrotas', c.res.status === 'confirmar' && c.res.texto === TEXTO_TILT_2 && c.w.length === 0, JSON.stringify(c.res));
  const d = await cenario({ cfgFila: { freioTilt: 2, freioMadrugada: true }, opcoes: { derrotasSeguidas: 2, relogio: as(2) } });
  caso('jogar de novo: os dois freios de uma vez = uma confirmação com as duas frases',
    d.res.status === 'confirmar' && d.res.motivos.length === 2 && /44%/.test(d.res.texto) && /47% contra 58%/.test(d.res.texto) && d.w.length === 0, JSON.stringify(d.res));
}
{
  // mecanismo do botão: 1º clique arma, 2º em até 8 s busca; fora da janela vale como 1º de novo
  const dentro = await cenario({ cfgFila: { freioMadrugada: true }, opcoes: { relogio: as(3) }, cliques: [0, 7000] });
  caso('jogar de novo, madrugada: 1º clique não escreve, 2º em 7 s busca',
    dentro.res[0].status === 'confirmar' && dentro.escritas[0].length === 0 && dentro.res[1].status === 'buscando' && dentro.w.filter(x => x === BUSCA).length === 1, JSON.stringify([dentro.res, dentro.w]));
  const fora = await cenario({ cfgFila: { freioTilt: 2 }, opcoes: { derrotasSeguidas: 2 }, cliques: [0, 8001] });
  caso('jogar de novo, tilt: 2º clique depois de 8 s não busca (pede de novo)',
    fora.res[1].status === 'confirmar' && fora.w.length === 0, JSON.stringify([fora.res, fora.w]));
  const tres = await cenario({ cfgFila: { freioTilt: 2 }, opcoes: { derrotasSeguidas: 2 }, cliques: [0, 9000, 2000] });
  caso('jogar de novo: depois de expirar, um novo par de cliques busca', tres.res[2].status === 'buscando' && tres.w.filter(x => x === BUSCA).length === 1, JSON.stringify(tres.res));
  const um = await cenario({ cfgFila: { freioTilt: 2 }, opcoes: { derrotasSeguidas: 2 }, cliques: [0] });
  caso('jogar de novo: sem 2º clique nada acontece', um.res[0].status === 'confirmar' && um.w.length === 0);
}

// fila rápida (buscarFilaRapida): LCU falsa sem lobby, fase None
function filaFalsa({ fase = 'None' } = {}) {
  const est = { lobby: null };
  const falsa = lcuFalsa({
    'GET /lol-gameflow/v1/gameflow-phase': () => fase,
    'GET /lol-lobby/v2/lobby': () => est.lobby || { status: 404, json: { message: 'LOBBY_NOT_FOUND' } },
    'POST /lol-lobby/v2/lobby': corpo => { est.lobby = { members: [{}], invitations: [], gameConfig: { queueId: corpo.queueId }, canStartActivity: true, restrictions: [] }; return est.lobby; },
    [POS]: { status: 201 },
    [BUSCA]: { status: 204 },
  });
  globalThis.fetch = falsa.fetch;
  return falsa;
}
const cfgFR = extra => ({ filaRapida: { fila: 420, pos1: 'TOP', pos2: 'JUNGLE', freioTilt: 2, freioMadrugada: true, ...extra } });
const buscas = falsa => falsa.chamadas.filter(c => `${c.metodo} ${c.url}` === BUSCA).length;
async function cliquesFila(cfg, cliques, opcoes) {
  const falsa = filaFalsa();
  let t = 0;
  const conf = criarConfirmacao({ agora: () => t });
  const res = [], escritas = [];
  for (const dt of cliques) {
    t += dt;
    res.push(await cliqueComFreio(conf, confirmado => buscarFilaRapida(cfg, { confirmado, ...opcoes })));
    escritas.push(falsa.escritas().length);
  }
  return { res, escritas, falsa };
}
{
  const a = await cliquesFila(cfgFR(), [0, 5000], { derrotasSeguidas: 2, relogio: TARDE });
  caso('fila rápida, tilt 2: 1º clique sem nenhuma escrita, 2º em 5 s monta o lobby e busca uma vez',
    a.res[0].status === 'confirmar' && a.res[0].texto === TEXTO_TILT_2 && a.escritas[0] === 0 && a.res[1].status === 'buscando' && buscas(a.falsa) === 1, JSON.stringify(a.res));
  const b = await cliquesFila(cfgFR(), [0, 8500], { derrotasSeguidas: 2, relogio: TARDE });
  caso('fila rápida, tilt: 2º clique fora da janela não busca', b.res[1].status === 'confirmar' && buscas(b.falsa) === 0 && b.falsa.escritas().length === 0, JSON.stringify(b.res));
  const c = await cliquesFila(cfgFR(), [0, 3000], { derrotasSeguidas: 0, relogio: as(1) });
  caso('fila rápida às 01:00: pede; 2º clique busca', c.res[0].status === 'confirmar' && c.res[0].texto === TEXTO_MADRUGADA && c.escritas[0] === 0 && buscas(c.falsa) === 1, JSON.stringify(c.res));
  const d = await cliquesFila(cfgFR(), [0, 9000], { derrotasSeguidas: 0, relogio: as(5, 59) });
  caso('fila rápida às 05:59: pede; 2º clique fora da janela não busca', d.res[0].status === 'confirmar' && d.res[1].status === 'confirmar' && buscas(d.falsa) === 0);
  const e = await cliquesFila(cfgFR(), [0], { derrotasSeguidas: 0, relogio: as(6) });
  caso('fila rápida às 06:00 sem derrotas: busca no 1º clique', e.res[0].status === 'buscando' && buscas(e.falsa) === 1, JSON.stringify(e.res));
  const f = await cliquesFila(cfgFR(), [0], { derrotasSeguidas: 1, relogio: as(0, 59) });
  caso('fila rápida às 00:59 com 1 derrota: busca no 1º clique', f.res[0].status === 'buscando' && buscas(f.falsa) === 1, JSON.stringify(f.res));
  let lidas = 0;
  const g = await cliquesFila(cfgFR({ freioTilt: 0, freioMadrugada: false }), [0], { derrotasSeguidas: async () => { lidas++; return 9; }, relogio: as(3) });
  caso('fila rápida com os freios desligados: busca direto e nem lê a sequência', g.res[0].status === 'buscando' && lidas === 0 && buscas(g.falsa) === 1);
  const h = await cliquesFila(cfgFR({ freioMadrugada: false }), [0], { derrotasSeguidas: async () => null, relogio: TARDE });
  caso('fila rápida: sequência incerta (histórico não carregou) pede confirmação', h.res[0].status === 'confirmar' && /não sei/.test(h.res[0].texto) && h.escritas[0] === 0);
  lidas = 0;
  const i = await cliquesFila(cfgFR(), [0, 1000], { derrotasSeguidas: async () => { lidas++; return 2; }, relogio: TARDE });
  caso('fila rápida: o clique que confirma não relê a sequência', lidas === 1 && i.res[1].status === 'buscando');
  const k = await cliquesFila(cfgFR(), [0, 1000], { derrotasSeguidas: 2, relogio: as(2) });
  caso('fila rápida: os dois freios juntos, um 2º clique confirma os dois', k.res[0].motivos?.length === 2 && k.res[1].status === 'buscando' && buscas(k.falsa) === 1, JSON.stringify(k.res));
  // fase de jogo: recusa antes do freio (não pede confirmação de algo que não faria)
  const falsa = filaFalsa({ fase: 'InProgress' });
  let erro = null;
  try { await buscarFilaRapida(cfgFR(), { derrotasSeguidas: 2, relogio: as(3) }); } catch (x) { erro = x; }
  caso('fila rápida em partida: Recusa antes do freio, sem escrita', erro instanceof Recusa && falsa.escritas().length === 0, erro?.message);
}

// sequência de derrotas da fila rápida (histórico da LCU, sessão = pausa < 2 h)
const H = 3600_000, AGORA = 100 * H;
const jogo = (id, fimHorasAtras, win, { dur = 1800, mapId = 11, queueId = 420 } = {}) =>
  ({ gameId: id, mapId, queueId, gameDuration: dur, gameCreation: AGORA - fimHorasAtras * H - dur * 1000, participants: [{ stats: { win } }] });
caso('sequência: 2 derrotas recentes = 2', derrotasSeguidasAgora([jogo(1, 1, true), jogo(2, 0.6, false), jogo(3, 0.1, false)], AGORA) === 2);
caso('sequência: última foi vitória = 0', derrotasSeguidasAgora([jogo(1, 1, false), jogo(2, 0.1, true)], AGORA) === 0);
caso('sequência: última derrota terminou há 2 h ou mais = sessão nova = 0', derrotasSeguidasAgora([jogo(1, 3, false), jogo(2, 2, false)], AGORA) === 0);
caso('sequência: pausa de 2 h entre derrotas corta', derrotasSeguidasAgora([jogo(1, 5, false), jogo(2, 0.2, false)], AGORA) === 1);
caso('sequência: remake, ARAM e personalizada não contam', derrotasSeguidasAgora([jogo(1, 0.9, false), jogo(2, 0.6, false, { dur: 200 }),
  jogo(3, 0.4, false, { mapId: 12, queueId: 450 }), jogo(4, 0.1, false, { queueId: 3100 })], AGORA) === 1);
caso('sequência: sem histórico = null', derrotasSeguidasAgora(null, AGORA) === null);
{
  const nunca = () => new Promise(() => {});
  let lista = null, leituras = 0;
  const fonte = { partidas: () => lista, ler: async () => { leituras++; lista = [jogo(1, 0.5, false), jogo(2, 0.1, false)]; } };
  const s = criarSequencia({ fonte, agora: () => AGORA, esperar: nunca });
  caso('criarSequencia: nunca leu -> lê e conta', (await s.derrotas()) === 2 && leituras === 1);
  caso('criarSequencia: cache bom não relê', (await s.derrotas()) === 2 && leituras === 1);
  s.fimDePartida(3); // acabou a partida 3, que a próxima leitura ainda não traz
  caso('criarSequencia: partida que acabou, sem resultado e fora do histórico = ATUALIZANDO', (await s.derrotas()) === ATUALIZANDO && leituras === 2);
  fonte.ler = async () => { leituras++; lista = [...lista, jogo(3, 0, false)]; };
  caso('criarSequencia: releitura que traz a partida conta ela', (await s.derrotas()) === 3);
  const lento = criarSequencia({ fonte: { partidas: () => null, ler: nunca }, agora: () => AGORA, esperar: async () => {} });
  caso('criarSequencia: leitura que passa do prazo = null', (await lento.derrotas()) === null);
  let t = AGORA;
  const velho = criarSequencia({ fonte: { partidas: () => [jogo(1, 0.1, false)], ler: async () => {} }, agora: () => t, esperar: nunca });
  velho.fimDePartida(99);
  const antes = await velho.derrotas();
  t += 11 * 60000;
  caso('criarSequencia: partida que não aparece em 10 min deixa de ser cobrada', antes === ATUALIZANDO && (await velho.derrotas()) === 1);
}

// revisão de 13/10/2026, achado 1: resultado do eog até o histórico trazer a partida (sem esperar a leitura de 40 s)
{
  const nunca = () => new Promise(() => {});
  let leituras = 0, lista = [jogo(1, 0.6, false)];
  const fonte = { partidas: () => lista, ler: async () => { leituras++; } }; // a leitura nunca traz a partida 2
  const s = criarSequencia({ fonte, agora: () => AGORA, esperar: nunca });
  s.fimDePartida(2);
  s.resultado({ gameId: 2, vitoria: true, duracaoS: 1800, fimMs: AGORA - 60000, fila: 420 });
  caso('eog: vitória que o histórico não tem = 0, sem ler o histórico', (await s.derrotas()) === 0 && leituras === 0);
  const t = criarSequencia({ fonte, agora: () => AGORA, esperar: nunca });
  t.fimDePartida(2);
  t.resultado({ gameId: 2, vitoria: false, duracaoS: 1800, fimMs: AGORA - 60000, fila: 420 });
  caso('eog: derrota em cima de 1 derrota do cache = 2, sem ler', (await t.derrotas()) === 2 && leituras === 0);
  lista = [jogo(1, 0.6, false), { ...jogo(2, 0.02, false), gameId: 2 }];
  caso('eog: quando o histórico traz a partida, ela não conta duas vezes', (await t.derrotas()) === 2);
  const u = criarSequencia({ fonte: { partidas: () => null, ler: nunca }, agora: () => AGORA, esperar: async () => {} });
  u.resultado({ gameId: 7, vitoria: true, duracaoS: 1800, fimMs: AGORA, fila: 420 });
  caso('eog: vitória com o histórico nunca lido = 0 (sem esperar)', (await u.derrotas()) === 0);
  u.resultado({ gameId: 8, vitoria: false, duracaoS: 1800, fimMs: AGORA + 1, fila: 420 });
  caso('eog: derrota com o histórico nunca lido = null (não carregou)', (await u.derrotas()) === null);
  let l2 = [jogo(1, 0.6, false)];
  const v = criarSequencia({ fonte: { partidas: () => l2, ler: async () => {} }, agora: () => AGORA, esperar: nunca });
  v.resultado({ gameId: 9, vitoria: true, duracaoS: 0, fimMs: AGORA, fila: 420 }); // remake: duração 0
  caso('eog: remake (duração 0) não zera a sequência', (await v.derrotas()) === 1);
  caso('texto: ATUALIZANDO tem frase própria, diferente de "não carregou"',
    /ainda não tem a última partida/.test(textoFreios([{ tipo: 'tilt', derrotas: ATUALIZANDO }])) && !/não carregou/.test(textoFreios([{ tipo: 'tilt', derrotas: ATUALIZANDO }])));
  caso('avaliarFreios: ATUALIZANDO com o tilt ligado pede', avaliarFreios({ freioTilt: 2 }, { derrotasSeguidas: ATUALIZANDO, data: as(15)() }).length === 1);
}
// resultadoDoEog no formato do eog gravado pelo coletor (13/10/2026)
{
  const eog = (extra = {}) => ({ gameId: 5, gameType: 'MATCHED_GAME', gameLength: 1669, endOfGameTimestamp: 1791909425811, gameEndedInEarlySurrender: false,
    teams: [{ isPlayerTeam: true, isWinningTeam: false }, { isPlayerTeam: false, isWinningTeam: true }], ...extra });
  const d = resultadoDoEog(eog());
  caso('resultadoDoEog: derrota pelo time do jogador', d?.vitoria === false && d.duracaoS === 1669 && d.fimMs === 1791909425811);
  caso('resultadoDoEog: vitória', resultadoDoEog(eog({ teams: [{ isPlayerTeam: false, isWinningTeam: false }, { isPlayerTeam: true, isWinningTeam: true }] }))?.vitoria === true);
  caso('resultadoDoEog: ferramenta de treino (CUSTOM_GAME) = null', resultadoDoEog(eog({ gameType: 'CUSTOM_GAME' })) === null);
  caso('resultadoDoEog: remake vai com duração 0', resultadoDoEog(eog({ gameEndedInEarlySurrender: true }))?.duracaoS === 0);
  caso('resultadoDoEog: sem time do jogador = null', resultadoDoEog(eog({ teams: [] })) === null);
}
// achado 4: só partida que conta é cobrada (treino não deixa "não sei" por 10 min)
caso('contaNoFreio: solo/duo no Rift sim; fila desconhecida sim', contaNoFreio({ mapa: 11, fila: 420, custom: false }) && contaNoFreio({ mapa: 11, fila: null, custom: false }));
caso('contaNoFreio: personalizada/treino, fila 0, 3140 e ARAM não',
  !contaNoFreio({ mapa: 11, fila: 420, custom: true }) && !contaNoFreio({ mapa: 11, fila: 0 }) && !contaNoFreio({ mapa: 11, fila: -1 })
  && !contaNoFreio({ mapa: 11, fila: 3140 }) && !contaNoFreio({ mapa: 12, fila: 450 }));

// achado 2: duplo clique de reflexo (2º clique em menos de 700 ms) é ignorado nos dois botões
{
  const a = await cenario({ cfgFila: { freioMadrugada: true }, opcoes: { relogio: as(2) }, cliques: [0, 300] });
  caso('jogar de novo: duplo clique (300 ms) não busca e não chama a LCU de novo', a.res[1].status === 'ignorado' && a.w.length === 0, JSON.stringify(a.res));
  const b = await cenario({ cfgFila: { freioMadrugada: true }, opcoes: { relogio: as(2) }, cliques: [0, 300, 1000] });
  caso('jogar de novo: depois do duplo clique ignorado, um 2º clique consciente busca uma vez',
    b.res[2].status === 'buscando' && b.w.filter(x => x === BUSCA).length === 1, JSON.stringify(b.res));
  const c = await cliquesFila(cfgFR(), [0, 699], { derrotasSeguidas: 2, relogio: TARDE });
  caso('fila rápida: duplo clique (699 ms) ignorado, nenhuma escrita', c.res[1].status === 'ignorado' && c.falsa.escritas().length === 0);
  const d = await cliquesFila(cfgFR(), [0, 700], { derrotasSeguidas: 2, relogio: TARDE });
  caso('fila rápida: 2º clique aos 700 ms confirma', d.res[1].status === 'buscando' && buscas(d.falsa) === 1);
}
// achado 3: em grupo ou sem ser o líder o caminho não busca: o freio não pede "buscar mesmo assim?"
{
  const a = await cenario({ lq: { isLeader: false }, cfgFila: { freioMadrugada: true, freioTilt: 2 }, opcoes: { relogio: as(2), derrotasSeguidas: 2 } });
  caso('não-líder de madrugada com 2 derrotas: volta ao lobby sem pedir confirmação', a.res.status === 'grupo' && !a.w.includes(BUSCA), JSON.stringify(a.res));
  const b = await cenario({ lq: { memberSummonerIds: [111, 222] }, cfgFila: { freioMadrugada: true }, opcoes: { relogio: as(3) } });
  caso('grupo de madrugada: grupo, nunca confirmar', b.res.status === 'grupo', JSON.stringify(b.res));
}

relatar(casos);
