// Prova do acumulador do histórico no plugin (pengu/historico.js; roadmap/2026-10-17-plugin-pengu-primeiro.md, Fase 4).
// Nada aqui fala com o client nem com a 8765: LCU falsa (tools/lcu-falsa.mjs), DataStore falso (Map que conta set e bytes),
// relógio falso. Partida de verdade: tests/fixtures/game-3292712362.json + timeline (traz Riot ID e puuid dos 10, o que
// torna a varredura de privacidade falsificável).
//   1. linha da fixture (campos, valores conferidos com teste-analise.py, bytes)
//   2. privacidade: o JSON salvo sem gameName, tagLine, summonerName nem puuid de outro jogador; mutação deixa a varredura vermelha
//   3. sem duplicata (a mesma partida 2 vezes = 1 set); a mais completa troca a menos completa
//   4. teto: 500 mais recentes; partida mais antiga que a última com o acumulador cheio não entra nem grava; 500 linhas < 150 KB
//   5. backfill: só None/Lobby, 1 partida a cada 5 s, 1 set por lote de 10, no máximo 40 por abertura, sem GET de partida que
//      não conta (ARAM, personalizada, remake), para na hora em Matchmaking/ChampSelect (GET em voo abortada)
//   6. espera o pós-jogo e a lista em voo (ocupado); linha do tempo 404 entra sem os campos dela, 500 fica de fora
//   7. importação do complemento: uma vez por abertura, só com "resumos", mescla por gameId, limpa campo estranho, recusa outra conta
//   8. conta diferente da dona: nada lido nem gravado; formato desconhecido: nada regravado
//   9. carregar de outra ordem de campos; nada gravado sem mudança
// uso: node tools/teste-historico.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relatar, lcuFalsa } from './lcu-falsa.mjs';
import { criarHistorico, linhaDe, limpar, remapear, comoObjeto, conta, CAMPOS, CHAVE, TETO, PASSO_MS, LOTE, MAX_POR_ABERTURA, VERSAO }
  from '../pengu/historico.js';

const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);
const pasta = fileURLToPath(new URL('../tests/fixtures/', import.meta.url));
const ler = n => JSON.parse(readFileSync(pasta + n, 'utf8'));
const ID = 3292712362;
const GAME = ler(`game-${ID}.json`);
const LINHA = ler(`timeline-${ID}.json`);
const EU = ler('summoner.json').puuid;
const OUTROS_PUUID = GAME.participantIdentities.map(i => i.player.puuid).filter(p => p && p !== EU);
const NOMES = GAME.participantIdentities.flatMap(i => [i.player.gameName, i.player.summonerName, i.player.tagLine]).filter(x => typeof x === 'string' && x.length >= 3);
const clone = x => JSON.parse(JSON.stringify(x));
const flush = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

// DataStore falso: guarda a cópia serializada, conta set e bytes do último
function dsFalso(inicial) {
  const m = new Map();
  if (inicial !== undefined) m.set(CHAVE, JSON.stringify(inicial));
  const s = { sets: 0, bytes: 0, m };
  s.get = k => (m.has(k) ? JSON.parse(m.get(k)) : null);
  s.set = (k, v) => { const t = JSON.stringify(v); m.set(k, t); s.sets++; s.bytes = t.length; };
  s.bruto = () => m.get(CHAVE) || '';
  return s;
}

// relógio falso (agendar/cancelar injetados)
function relogio() {
  const r = { agora: 0, fila: new Map(), prox: 1 };
  r.agendar = (fn, ms = 0) => { const id = r.prox++; r.fila.set(id, { em: r.agora + ms, fn }); return id; };
  r.cancelar = id => { r.fila.delete(id); };
  r.avancar = async ms => {
    const fim = r.agora + ms;
    for (;;) {
      let alvo = null;
      for (const [id, t] of r.fila) if (t.em <= fim && (!alvo || t.em < alvo[1].em)) alvo = [id, t];
      if (!alvo) break;
      r.agora = alvo[1].em; r.fila.delete(alvo[0]);
      alvo[1].fn();
      await flush();
    }
    r.agora = fim;
    await flush();
  };
  return r;
}

// partida sintética a partir da fixture: outro gameId e outra hora (mesmos 10 jogadores, mesma linha do tempo)
const partida = (gid, criacao, extra = {}) => Object.assign(clone(GAME), { gameId: gid, gameCreation: criacao }, extra);
// entrada da lista do histórico (o que o selo da seleção leu): só os campos que o backfill olha
const daLista = g => ({ gameId: g.gameId, gameCreation: g.gameCreation, gameDuration: g.gameDuration, queueId: g.queueId, mapId: g.mapId });

// varredura de privacidade: nenhuma chave de identidade, nenhum puuid alheio, nenhum nome dos 10
function varrer(texto) {
  const achados = [];
  for (const k of ['gameName', 'tagLine', 'summonerName', 'participantIdentities', 'puuid"']) if (texto.includes(k)) achados.push(k);
  for (const p of OUTROS_PUUID) if (texto.includes(p)) achados.push('puuid alheio');
  for (const n of NOMES) if (texto.includes(n)) achados.push('nome ' + n.length);
  return achados;
}

// ---------- 1. linha da fixture ----------
{
  const l = linhaDe(GAME, EU, LINHA);
  const o = l && comoObjeto(l);
  caso('1 linha da partida 3292712362 tem os CAMPOS na ordem', Array.isArray(l) && l.length === CAMPOS.length, l);
  // valores de teste-analise.py: eu 58 TOP, adversário 83 certo, diffs 10 {171,-134,0}, 15 {-368,-554,1}
  caso('1 campeão, papel, adversário e certeza (os do teste-analise.py)', o && o.campeao === 58 && o.papel === 'TOP' && o.adversario === 83 && o.incerto === 0, o);
  caso('1 diferenças aos 10 e 15 min', o && o.ouro10 === 171 && o.xp10 === -134 && o.farm10 === 0 && o.ouro15 === -368 && o.xp15 === -554 && o.farm15 === 1, o);
  const meu = GAME.participants.find(p => p.championId === 58);
  caso('1 vitória, fila, duração, criação e cs', o && o.vitoria === (meu.stats.win ? 1 : 0) && o.fila === 420 && o.duracao === GAME.gameDuration
    && o.criacao === GAME.gameCreation && o.cs === meu.stats.totalMinionsKilled + meu.stats.neutralMinionsKilled, o);
  const inim = GAME.participants.filter(p => p.teamId !== meu.teamId).map(p => p.championId);
  caso('1 inimigos = os 5 campeões do outro time (só ids)', o && o.inimigos.length === 5 && o.inimigos.every(x => inim.includes(x)), o?.inimigos);
  caso('1 mortes antes dos 10 min: soma solo + gank', o && o.mortes10 !== null && o.mortes10 === o.solo10 + o.gank10, o);
  const bytes = JSON.stringify(l).length;
  caso(`1 linha com no máximo 160 bytes (${bytes})`, bytes <= 160, bytes);
  const sem = comoObjeto(linhaDe(GAME, EU, null));
  caso('1 sem linha do tempo: papel, adversário, diferenças e mortes null; o resto igual', sem.papel === null && sem.adversario === null
    && sem.ouro10 === null && sem.mortes10 === null && sem.vitoria === o.vitoria && sem.inimigos.length === 5, sem);
  caso('1 partida de outra conta, ARAM, personalizada e remake não entram', linhaDe(GAME, 'outro-puuid', LINHA) === null
    && linhaDe({ ...GAME, mapId: 12 }, EU, LINHA) === null && linhaDe({ ...GAME, queueId: 0 }, EU, LINHA) === null
    && linhaDe({ ...GAME, gameDuration: 299 }, EU, LINHA) === null);
}

// ---------- 2. privacidade ----------
{
  const ds = dsFalso();
  const h = criarHistorico({ ds, log: () => {} });
  h.carregar();
  h.registrar(GAME, LINHA, EU);
  const texto = ds.bruto();
  caso('2 a fixture tem o que a varredura procura (10 puuids, nomes): o teste é falsificável', OUTROS_PUUID.length === 9 && NOMES.length >= 10, [OUTROS_PUUID.length, NOMES.length]);
  caso('2 JSON salvo sem gameName, tagLine, summonerName nem puuid/nome de outro jogador', texto && varrer(texto).length === 0, varrer(texto));
  caso('2 o único puuid é o dele (dono)', ds.get(CHAVE).dono === EU && texto.split(EU).length === 2);
  // mutação: a linha carregando a identidade dos 10 -> a varredura acusa
  const mut = ds.get(CHAVE); mut.linhas[0].push(GAME.participantIdentities);
  caso('2 mutação (identidades na linha) deixa a varredura vermelha', varrer(JSON.stringify(mut)).length > 0);
  // e o limpar descarta campo a mais e texto no lugar de número
  const suja = [...linhaDe(GAME, EU, LINHA)]; suja[CAMPOS.indexOf('adversario')] = 'Fulano#BR1';
  caso('2 limpar: texto no lugar de id vira null; linha de outro tamanho é recusada', limpar(suja)[CAMPOS.indexOf('adversario')] === null
    && limpar([...suja, 'x']) === null);
}

// ---------- 3. sem duplicata; a mais completa troca ----------
{
  const ds = dsFalso();
  const h = criarHistorico({ ds, log: () => {} });
  h.carregar();
  const a = h.registrar(GAME, null, EU);
  const b = h.registrar(GAME, null, EU);
  caso('3 a mesma partida 2 vezes: 1 linha, 1 set', a && !b && ds.sets === 1 && ds.get(CHAVE).linhas.length === 1, [a, b, ds.sets]);
  const c = h.registrar(GAME, LINHA, EU);
  caso('3 a mesma com linha do tempo troca a sem (mais completa): 2º set', c && ds.sets === 2 && ds.get(CHAVE).linhas.length === 1
    && comoObjeto(ds.get(CHAVE).linhas[0]).papel === 'TOP');
  const d = h.registrar(GAME, null, EU);
  caso('3 a menos completa depois não troca nem grava', !d && ds.sets === 2);
}

// ---------- 4. teto ----------
{
  const base = linhaDe(GAME, EU, LINHA);
  const linhas = [];
  for (let i = 0; i < 520; i++) { const l = [...base]; l[0] = 1000 + i; l[1] = 1_700_000_000_000 + i * 3_600_000; linhas.push(l); }
  const ds = dsFalso({ v: VERSAO, dono: EU, imp: 0, campos: CAMPOS, linhas });
  const h = criarHistorico({ ds, log: () => {} });
  h.carregar();
  caso('4 carregar 520 linhas guarda as 500 mais recentes', h.estado().linhas === TETO && h.linhas()[0].gameId === 1519 && h.linhas().at(-1).gameId === 1020,
    [h.estado().linhas, h.linhas()[0]?.gameId, h.linhas().at(-1)?.gameId]);
  caso('4 carregar não grava', ds.sets === 0);
  const velha = partida(77, 1_600_000_000_000);
  caso('4 cheio: partida mais antiga que a última não entra nem grava', !h.registrar(velha, LINHA, EU) && ds.sets === 0 && h.estado().linhas === TETO);
  const nova = partida(99999, 1_800_000_000_000);
  caso('4 cheio: partida nova entra, a mais antiga sai, 1 set com 500', h.registrar(nova, LINHA, EU) && ds.sets === 1
    && ds.get(CHAVE).linhas.length === TETO && ds.get(CHAVE).linhas[0][0] === 99999 && !ds.get(CHAVE).linhas.some(l => l[0] === 1020));
  caso(`4 500 linhas no DataStore: ${ds.bytes} bytes (< 150 KB; medição C: 310 KB em 5,5–9,9 ms)`, ds.bytes < 150_000, ds.bytes);
}

// ---------- 5 e 6. backfill ----------
// 60 partidas do Rift + 3 que não contam, mais recentes primeiro; a LCU falsa responde partida e linha do tempo
function cenario({ n = 60, rotasExtra = {}, ocupado = () => false, ds = dsFalso(), coletor = null, temRecurso = () => false } = {}) {
  const rel = relogio();
  const jogos = [];
  for (let i = 0; i < n; i++) jogos.push(partida(5000 + i, 1_760_000_000_000 + i * 3_600_000));
  const naoContam = [partida(9001, 1_770_000_000_000, { mapId: 12, queueId: 450 }), partida(9002, 1_770_000_000_001, { queueId: 0 }),
    partida(9003, 1_770_000_000_002, { gameDuration: 200 })];
  const rotas = { 'GET /lol-summoner/v1/current-summoner': { puuid: EU }, ...rotasExtra };
  for (const g of [...jogos, ...naoContam]) {
    rotas[`GET /lol-match-history/v1/games/${g.gameId}`] ??= g;
    rotas[`GET /lol-match-history/v1/game-timelines/${g.gameId}`] ??= LINHA;
  }
  const lcu = lcuFalsa(rotas);
  const abortadas = [];
  // GET com sinal: a resposta só chega no próximo passo do relógio (dá para trocar a fase com ela em voo)
  const lcuFn = async (url, signal) => {
    const r = await lcu.fetch(url);
    if (signal?.aborted) { abortadas.push(url); return { status: 0, dados: null }; }
    let dados = null; try { dados = await r.json(); } catch { /* vazio */ }
    return { status: r.status, dados };
  };
  let lista = [...jogos, ...naoContam].reverse().map(daLista);
  const h = criarHistorico({ ds, lcu: lcuFn, agendar: rel.agendar, cancelar: rel.cancelar, partidas: () => lista, ocupado, coletor, temRecurso, log: () => {} });
  h.carregar();
  const getsPartida = () => lcu.chamadas.filter(c => c.url.startsWith('/lol-match-history/v1/games/')).map(c => Number(c.url.split('/').pop()));
  return { rel, h, ds, lcu, jogos, getsPartida, abortadas, setLista: l => { lista = l; } };
}

{
  const c = cenario();
  c.h.aoFase('Lobby');
  await c.rel.avancar(PASSO_MS * 3 + 10);
  const g3 = c.getsPartida().length;
  caso(`5 Lobby: 1 partida a cada ${PASSO_MS / 1000} s (3 passos = ${g3} GET de partida)`, g3 === 3, c.getsPartida());
  caso('5 a mais recente primeiro', c.getsPartida()[0] === 5059 && c.getsPartida()[1] === 5058, c.getsPartida());
  caso('5 nenhum set antes do lote de 10', c.ds.sets === 0);
  await c.rel.avancar(PASSO_MS * 7);
  caso(`5 lote de ${LOTE}: 1 set com 10 linhas`, c.ds.sets === 1 && c.ds.get(CHAVE).linhas.length === 10, [c.ds.sets, c.ds.get(CHAVE)?.linhas?.length]);
  await c.rel.avancar(PASSO_MS * 100);
  const g = c.getsPartida();
  caso(`5 no máximo ${MAX_POR_ABERTURA} por abertura`, g.length === MAX_POR_ABERTURA && c.h.estado().feitos === MAX_POR_ABERTURA, g.length);
  caso('5 1 set por lote (4 lotes de 10 = 4 sets)', c.ds.sets === 4 && c.ds.get(CHAVE).linhas.length === 40, [c.ds.sets, c.ds.get(CHAVE)?.linhas?.length]);
  caso('5 nenhuma GET de partida que não conta (ARAM, personalizada, remake)', !g.some(x => x > 9000));
  caso('5 nenhuma escrita na LCU', c.lcu.escritas().length === 0);
  caso('5 parado depois do limite (sem timer)', !c.h.estado().rodando);
  const linhas = c.ds.get(CHAVE).linhas;
  caso('5 sem duplicata no que foi salvo', new Set(linhas.map(l => l[0])).size === linhas.length);
  caso('5 varredura de privacidade no JSON do backfill', varrer(c.ds.bruto()).length === 0, varrer(c.ds.bruto()));
}
{
  // para na hora ao entrar em Matchmaking (com a GET em voo) e não volta em ChampSelect; volta no Lobby
  const c = cenario();
  c.h.aoFase('None');
  await c.rel.avancar(PASSO_MS * 2 + 10);
  const antes = c.getsPartida().length;
  // próxima GET sai no passo seguinte: troca a fase com ela em voo
  c.rel.agendar(() => c.h.aoFase('Matchmaking'), PASSO_MS);
  await c.rel.avancar(PASSO_MS + 1);
  await c.rel.avancar(PASSO_MS * 20);
  const emMM = c.getsPartida().length;
  c.h.aoFase('ReadyCheck'); c.h.aoFase('ChampSelect');
  await c.rel.avancar(PASSO_MS * 20);
  caso('5 Matchmaking: para na hora (no máximo a GET que já tinha saído), nada em 100 s', emMM <= antes + 1 && c.getsPartida().length === emMM,
    [antes, emMM, c.getsPartida().length]);
  caso('5 ChampSelect: nenhuma GET', c.getsPartida().length === emMM);
  caso('5 nenhum set fora de None/Lobby', c.ds.sets === 0, c.ds.sets);
  c.h.aoFase('Lobby');
  await c.rel.avancar(PASSO_MS * 2 + 10);
  caso('5 Lobby de novo: o backfill continua de onde parou', c.getsPartida().length === emMM + 2, c.getsPartida().length);
}
{
  // GET abortada: a fase troca para ReadyCheck com a GET da partida em voo (a LCU falsa troca a fase ao receber o pedido)
  const alvo = { h: null };
  const c = cenario({ rotasExtra: { 'GET /lol-match-history/v1/games/5059': () => { alvo.h.aoFase('ReadyCheck'); return partida(5059, 1_760_000_000_000 + 59 * 3_600_000); } } });
  alvo.h = c.h;
  c.h.aoFase('Lobby');
  await c.rel.avancar(PASSO_MS + 10);
  await c.rel.avancar(PASSO_MS * 10);
  caso('5 GET em voo abortada na troca de fase: a partida não entra, nenhuma GET de linha do tempo, nenhuma GET depois',
    c.abortadas.length === 1 && c.abortadas[0].endsWith('/5059') && c.h.estado().linhas === 0 && c.ds.sets === 0
    && !c.lcu.chamadas.some(x => x.url.includes('game-timelines')) && c.getsPartida().length === 1, [c.abortadas, c.h.estado(), c.getsPartida()]);
}
{
  // 6. ocupado: pós-jogo ou lista em voo -> nenhuma GET
  let oc = true;
  const c = cenario({ ocupado: () => oc });
  c.h.aoFase('Lobby');
  await c.rel.avancar(PASSO_MS * 10);
  caso('6 pós-jogo/lista em voo (ocupado): nenhuma GET da LCU em 50 s', c.lcu.chamadas.length === 0, c.lcu.chamadas.length);
  oc = false;
  await c.rel.avancar(PASSO_MS + 10);
  caso('6 livre de novo: o backfill anda', c.getsPartida().length === 1, c.getsPartida());
  // lista ainda não lida (null): espera sem GET de partida
  const d = cenario();
  d.setLista(null);
  d.h.aoFase('Lobby');
  await d.rel.avancar(PASSO_MS * 4);
  caso('6 lista do histórico ainda não lida: nenhuma GET (nem a do puuid), segue tentando', d.getsPartida().length === 0
    && d.lcu.chamadas.length === 0 && d.h.estado().rodando, d.lcu.chamadas.map(x => x.url));
  // sem conta (antes do login, current-summoner 404): no máximo 3 GET e para até a próxima fase livre
  const e = cenario({ rotasExtra: { 'GET /lol-summoner/v1/current-summoner': { status: 404, json: { message: 'nao' } } } });
  e.h.aoFase('Lobby');
  await e.rel.avancar(PASSO_MS * 20);
  const eus = () => e.lcu.chamadas.filter(x => x.url === '/lol-summoner/v1/current-summoner').length;
  caso('6 current-summoner 404: 3 tentativas e para (nenhuma GET de partida)', eus() === 3 && e.getsPartida().length === 0 && !e.h.estado().rodando, eus());
  e.h.aoFase('None');
  await e.rel.avancar(PASSO_MS * 20);
  caso('6 próxima fase livre: tenta de novo (mais 3)', eus() === 6, eus());
}
{
  // 6. linha do tempo 404 entra sem os campos dela; 500 fica de fora nesta abertura
  const c = cenario({ n: 3, rotasExtra: {
    'GET /lol-match-history/v1/game-timelines/5002': { status: 404, json: { message: 'nao' } },
    'GET /lol-match-history/v1/game-timelines/5001': { status: 500, json: { message: 'erro' } },
  } });
  c.h.aoFase('Lobby');
  await c.rel.avancar(PASSO_MS * 10);
  const salvas = Object.fromEntries((c.ds.get(CHAVE)?.linhas || []).map(l => [l[0], comoObjeto(l)]));
  caso('6 linha do tempo 404: a partida entra sem papel nem diferenças', salvas[5002] && salvas[5002].papel === null && salvas[5002].vitoria !== undefined, salvas[5002]);
  caso('6 linha do tempo 500: fica de fora e não se pede de novo nesta abertura', !salvas[5001]
    && c.lcu.chamadas.filter(x => x.url.endsWith('/5001')).length === 2, c.lcu.chamadas.filter(x => x.url.endsWith('/5001')).length);
  caso('6 fim do backfill grava o lote incompleto (1 set)', c.ds.sets === 1 && Object.keys(salvas).length === 2, [c.ds.sets, Object.keys(salvas)]);
}
{
  // 4 + 5: acumulador cheio não busca partida mais antiga que a última
  const base = linhaDe(GAME, EU, LINHA);
  const linhas = [];
  // a mais antiga guardada fica no meio das 60 da lista (as 28 mais velhas da lista sairiam pelo teto na hora)
  const corte = 1_760_100_000_000;
  for (let i = 0; i < TETO; i++) { const l = [...base]; l[0] = 1000 + i; l[1] = corte + i * 1000; linhas.push(l); }
  const c = cenario({ ds: dsFalso({ v: VERSAO, dono: EU, imp: 0, campos: CAMPOS, linhas }) });
  c.h.aoFase('Lobby');
  await c.rel.avancar(PASSO_MS * 100);
  const g = c.getsPartida();
  const novas = c.jogos.filter(j => j.gameCreation > corte).length;
  caso(`4 cheio: o backfill só busca partida mais nova que a mais antiga guardada (${g.length} de ${novas} mais novas, nenhuma das ${60 - novas} velhas)`,
    g.length === novas && g.every(id => c.jogos.find(j => j.gameId === id).gameCreation > corte), [g.length, novas]);
  caso('4 cheio: segue com 500 linhas', c.ds.get(CHAVE).linhas.length === TETO, c.ds.get(CHAVE)?.linhas?.length);
}

// ---------- 7. importação do complemento ----------
function complemento({ dono = EU, linhas, campos = CAMPOS, status = 200 } = {}) {
  const chamadas = [];
  const f = async (caminho, op = {}) => { chamadas.push({ caminho, op }); return status === 200 ? { status, dados: { v: 1, dono, campos, linhas } } : { status, dados: null }; };
  return { f, chamadas };
}
{
  const base = linhaDe(GAME, EU, LINHA);
  const semTl = linhaDe(GAME, EU, null);
  // 30 linhas do complemento; a 3292712362 já está no acumulador sem linha do tempo (a do complemento é mais completa)
  const doCol = [];
  for (let i = 0; i < 30; i++) { const l = [...base]; l[0] = 7000 + i; l[1] = 1_750_000_000_000 + i; doCol.push(l); }
  doCol.push(base);
  // campo estranho: a ordem dos campos do complemento traz um "gameName" a mais
  const campos = [...CAMPOS, 'gameName'];
  const comNome = doCol.map(l => [...l, 'Fulano']);
  const col = complemento({ linhas: comNome, campos });
  const ds = dsFalso({ v: VERSAO, dono: EU, imp: 0, campos: CAMPOS, linhas: [semTl] });
  const c = cenario({ n: 0, ds, coletor: col.f, temRecurso: n => n === 'resumos' });
  c.h.aoFase('Lobby');
  await c.rel.avancar(PASSO_MS * 10);
  const salvo = c.ds.get(CHAVE);
  caso('7 importação: 1 GET /resumos?desde=0 por abertura', col.chamadas.length === 1 && col.chamadas[0].caminho === '/resumos?desde=0', col.chamadas.map(x => x.caminho));
  caso('7 mescla por gameId: 31 linhas, 1 set', salvo.linhas.length === 31 && c.ds.sets === 1, [salvo.linhas.length, c.ds.sets]);
  caso('7 a do complemento (com linha do tempo) troca a local sem', comoObjeto(salvo.linhas.find(l => l[0] === ID)).papel === 'TOP');
  caso('7 campo a mais do complemento (gameName) não entra', !c.ds.bruto().includes('Fulano') && !c.ds.bruto().includes('gameName'));
  caso('7 imp = maior gameId importado', salvo.imp === ID, salvo.imp);
  c.h.aoFase('ChampSelect'); c.h.aoFase('Lobby');
  await c.rel.avancar(PASSO_MS * 5);
  caso('7 Lobby de novo na mesma abertura: não importa outra vez', col.chamadas.length === 1, col.chamadas.length);
  // abertura nova com o mesmo DataStore: pede desde o imp
  const col2 = complemento({ linhas: [] });
  const c2 = cenario({ n: 0, ds, coletor: col2.f, temRecurso: n => n === 'resumos' });
  c2.h.aoFase('None');
  await c2.rel.avancar(PASSO_MS * 3);
  caso('7 abertura seguinte: GET /resumos?desde=<imp>, nada novo = nenhum set', col2.chamadas[0]?.caminho === `/resumos?desde=${ID}` && c2.ds.sets === c.ds.sets,
    [col2.chamadas[0]?.caminho, c2.ds.sets]);
  // sem o recurso: nenhuma chamada
  const col3 = complemento({ linhas: doCol });
  const c3 = cenario({ n: 0, coletor: col3.f, temRecurso: () => false });
  c3.h.aoFase('Lobby');
  await c3.rel.avancar(PASSO_MS * 5);
  caso('7 sem o recurso "resumos": nenhuma chamada ao complemento', col3.chamadas.length === 0);
  // complemento de outra conta: nada mesclado
  const col4 = complemento({ linhas: doCol, dono: 'puuid-de-outro' });
  const c4 = cenario({ n: 0, coletor: col4.f, temRecurso: n => n === 'resumos' });
  c4.h.aoFase('Lobby');
  await c4.rel.avancar(PASSO_MS * 5);
  caso('7 complemento de outra conta: nada importado, nada gravado', col4.chamadas.length === 1 && c4.ds.sets === 0 && c4.h.estado().linhas === 0);
  // fora do ar: tenta de novo (no máximo 3) e não grava
  const col5 = complemento({ status: 0 });
  const c5 = cenario({ n: 0, coletor: col5.f, temRecurso: n => n === 'resumos' });
  c5.h.aoFase('Lobby');
  await c5.rel.avancar(PASSO_MS * 10);
  caso('7 complemento fora do ar: 3 tentativas, nenhum set', col5.chamadas.length === 3 && c5.ds.sets === 0, col5.chamadas.length);
}

// ---------- 8. outra conta; formato desconhecido ----------
{
  const ds = dsFalso({ v: VERSAO, dono: 'puuid-da-dona', imp: 0, campos: CAMPOS, linhas: [linhaDe(GAME, EU, LINHA)] });
  const logs = [];
  const h = criarHistorico({ ds, log: m => logs.push(m) });
  h.carregar();
  caso('8 linhas(puuid) de outra conta = nada, mesmo antes do 1º registro; a dona vê as dela', h.linhas(EU).length === 0
    && h.linhas('puuid-da-dona').length === 1);
  caso('8 conta diferente da dona: o pós-jogo não grava', !h.registrar(partida(42, 1_790_000_000_000), LINHA, EU) && ds.sets === 0);
  caso('8 e as linhas da dona não aparecem para ela', h.linhas().length === 0 && logs.some(m => m.includes('conta diferente')), logs);
  const c = cenario({ ds: dsFalso({ v: VERSAO, dono: 'puuid-da-dona', imp: 0, campos: CAMPOS, linhas: [] }) });
  c.h.aoFase('Lobby');
  await c.rel.avancar(PASSO_MS * 10);
  caso('8 backfill de outra conta: nenhuma GET de partida, nenhum set', c.getsPartida().length === 0 && c.ds.sets === 0);
  const ds2 = dsFalso({ v: 2, coisa: 'nova' });
  const h2 = criarHistorico({ ds: ds2, log: () => {} });
  h2.carregar();
  caso('8 formato desconhecido (v 2): nada lido, nada regravado', !h2.registrar(GAME, LINHA, EU) && ds2.sets === 0 && h2.estado().inerte);
}

// ---------- 9. outra ordem de campos; nada gravado sem mudança ----------
{
  const l = linhaDe(GAME, EU, LINHA);
  const campos = [...CAMPOS].reverse();
  const ds = dsFalso({ v: VERSAO, dono: EU, imp: 5, campos, linhas: [[...l].reverse()] });
  const h = criarHistorico({ ds, log: () => {} });
  h.carregar();
  caso('9 carregar de outra ordem de campos remapeia pelo nome', JSON.stringify(h.linhas()[0]) === JSON.stringify(comoObjeto(l)), h.linhas()[0]);
  caso('9 campo que falta vira null (inimigos: [])', JSON.stringify(remapear(['gameId', 'criacao'], [[1, 2]])[0]) === JSON.stringify(CAMPOS.map(c => (c === 'gameId' ? 1 : c === 'criacao' ? 2 : c === 'inimigos' ? [] : c === 'vitoria' ? 0 : null))));
  caso('9 nada gravado sem mudança', ds.sets === 0 && !h.registrar(GAME, LINHA, EU) && ds.sets === 0);
  caso('9 conta(): mesma regra do coletor', conta({ mapId: 11, gameDuration: 300, queueId: 420 }) && !conta({ mapId: 11, gameDuration: 299, queueId: 420 })
    && !conta({ mapId: 11, gameDuration: 900, queueId: 3140 }));
}

// ---------- 10. ponta a ponta: o pós-jogo (posjogo/index.js analisarPartida) alimenta sem GET a mais ----------
{
  const { registerHooks } = await import('node:module');
  // o Pengu serve "*.md?raw" como texto e o CSS pelo import: no node, um hook faz o mesmo (como em teste-ponte.mjs)
  registerHooks({
    resolve(spec, ctx, next) { return spec.endsWith('?raw') || spec.endsWith('.css') ? { url: new URL(spec, ctx.parentURL).href, shortCircuit: true } : next(spec, ctx); },
    load(url, ctx, next) {
      if (url.endsWith('.css')) return { format: 'module', source: 'export default "";', shortCircuit: true };
      if (!url.endsWith('?raw')) return next(url, ctx);
      return { format: 'module', source: `export default ${JSON.stringify(readFileSync(fileURLToPath(url.split('?')[0]), 'utf8'))};`, shortCircuit: true };
    },
  });
  const lcu = lcuFalsa({
    'GET /lol-summoner/v1/current-summoner': { puuid: EU },
    'GET /lol-game-data/assets/v1/champion-summary.json': [],
    [`GET /lol-match-history/v1/games/${ID}`]: GAME,
    [`GET /lol-match-history/v1/game-timelines/${ID}`]: LINHA,
    'GET /lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=199': { games: { games: [] } },
  });
  globalThis.fetch = lcu.fetch;
  const hist = await import('../pengu/historico.js');
  const pos = await import('../pengu/posjogo/index.js');
  const ds = dsFalso();
  const ouvintes = [];
  hist.iniciarHistorico({ socket: { observe: (rota, fn) => ouvintes.push([rota, fn]) } }, { ds, lcu: async () => ({ status: 0, dados: null }), log: () => {} });
  const r = await pos.analisarPartida(ID);
  const doJogo = lcu.chamadas.filter(c => c.url.includes(String(ID)));
  caso('10 o pós-jogo analisou e o acumulador ganhou a partida (1 set, papel TOP)', !r.erro && ds.sets === 1
    && comoObjeto(ds.get(CHAVE).linhas[0]).papel === 'TOP' && ds.get(CHAVE).dono === EU, [r.erro, ds.sets]);
  caso('10 sem GET a mais: 1 games/{id} e 1 game-timelines/{id} (as do pós-jogo), nenhuma escrita', doJogo.length === 2
    && lcu.chamadas.filter(c => c.url === '/lol-summoner/v1/current-summoner').length === 1 && lcu.escritas().length === 0,
    lcu.chamadas.map(c => c.url));
  caso('10 o acumulador assina a fase do gameflow (backfill só em None/Lobby)', ouvintes.some(([rota]) => rota === '/lol-gameflow/v1/gameflow-phase'));
  await pos.analisarPartida(ID);
  caso('10 a mesma partida analisada de novo (painel reaberto, Ctrl+K): nenhum set a mais', ds.sets === 1, ds.sets);
  caso('10 varredura de privacidade no que o pós-jogo gravou', varrer(ds.bruto()).length === 0, varrer(ds.bruto()));
}

relatar(casos);
