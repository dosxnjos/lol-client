// Acumulador do histórico próprio no DataStore do Pengu (roadmap/2026-10-17-plugin-pengu-primeiro.md, Fase 4): a
// amostra do contexto do pós-jogo e da seleção (Fase 5) sem o complemento coach. O histórico da LCU só tem o cache do
// client (20 a 200 partidas, sem adversário nem linha do tempo); aqui ficam até TETO partidas próprias, uma linha cada.
// Formato (chave lol-client.historico): {v: 1, dono: <puuid desta conta>, imp: <maior gameId importado do complemento>,
// campos: CAMPOS, linhas: [[...], ...]}, lista de listas (sem nome de campo repetido), mais recentes primeiro.
// Os campos são o que analise.matchups/traumas, coach.historico_tilt/_traumas/contexto_partida, a média de farm e
// draft.indices_pessoais leem (coletor/). Só agregado próprio: nunca nome, Riot ID nem puuid de outro jogador (o DataStore
// é namespace comum e legível, ARMADILHAS § Client e Pengu); o inimigo entra só por campeão.
// Quem escreve (no máximo 1 DataStore.set por vez):
//   - o pós-jogo (posjogo/index.js analisarPartida): a partida que acabou, das GET que ele já faz (games + game-timelines);
//   - o backfill: só em None/Lobby, 1 partida que falta a cada PASSO_MS, da lista que o selo da seleção já leu
//     (champselect.js partidas()), no máximo MAX_POR_ABERTURA por abertura do client, 1 set por LOTE; para na hora em
//     qualquer outra fase (aborta a GET em voo) e espera enquanto o pós-jogo ou a lista do histórico estão lendo (a LCU
//     atende o match-history em fila, ARMADILHAS § LCU);
//   - a importação do complemento (recurso "resumos", GET /resumos?desde=<imp>): uma vez por abertura, mescla por gameId.
// Conta diferente da dona (outra conta no mesmo Pengu): nada lido nem gravado, uma linha no console.
import { analisar, FORA_DAS_CONTAS } from './posjogo/analise.js';

export const CHAVE = 'lol-client.historico';
export const VERSAO = 1;
export const TETO = 500;          // medição C (19/10/2026): set de 310 KB em 5,5–9,9 ms; 500 linhas ficam perto de 60 KB
export const PASSO_MS = 5000;
export const MAX_POR_ABERTURA = 40;
export const LOTE = 10;
export const FASES_LIVRES = ['None', 'Lobby'];
export const REMAKE_S = 300;      // analise.REMAKE_S
export const MS_10 = 600000;
export const IMPORTAR_PRAZO_MS = 30000;   // medido 19/10/2026: 191 partidas em 1,2 s no coletor
export const IMPORTAR_TENTATIVAS = 3;
// a ordem é o formato: o coletor (servidor_local.CAMPOS_RESUMO) devolve a mesma lista, e quem lê mapeia pelo nome
export const CAMPOS = ['gameId', 'criacao', 'duracao', 'fila', 'campeao', 'papel', 'adversario', 'incerto', 'vitoria', 'ouro10', 'xp10', 'farm10', 'ouro15', 'xp15', 'farm15', 'mortes10', 'solo10', 'gank10', 'cs', 'inimigos'];
const PAPEIS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const IDX = Object.fromEntries(CAMPOS.map((c, i) => [c, i]));

// partida que entra nas contas: a mesma regra do coletor (mapa 11, fila fora de FORA_DAS_CONTAS, duração >= 300 s).
// Serve para a partida inteira (games/{id}) e para a entrada da lista (mesmos campos), antes de qualquer GET
export const conta = g => g?.mapId === 11 && Number(g.gameDuration) >= REMAKE_S && !FORA_DAS_CONTAS.includes(g.queueId);

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// linha do acumulador a partir de games/{id} (+ game-timelines/{id}, ou r já calculado por analise.analisar).
// Sem linha do tempo: os campos dela ficam null (papel, adversário, diferenças e mortes cedo). null = não entra.
export function linhaDe(partida, puuid, linhaTempo = null, r = null) {
  if (!conta(partida) || !puuid) return null;
  const ident = (partida.participantIdentities || []).find(i => i?.player?.puuid === puuid);
  const meu = ident && (partida.participants || []).find(p => p.participantId === ident.participantId);
  if (!meu) return null;
  if (!r && Array.isArray(linhaTempo?.frames) && linhaTempo.frames.length) {
    try { r = analisar(partida, linhaTempo, puuid, []); } catch { r = null; }
  }
  const ok = !!r && !r.erro && Array.isArray(r.mortes);
  const d = m => (ok ? r.diffs?.[m] : null) || {};
  const cedo = ok ? r.mortes.filter(m => m.ms < MS_10) : null;
  const adv = ok ? r.adversario : null;
  const s = meu.stats || {};
  const o = {
    gameId: partida.gameId, criacao: partida.gameCreation, duracao: partida.gameDuration, fila: partida.queueId,
    campeao: meu.championId, papel: ok && PAPEIS.includes(r.papel) ? r.papel : null,
    adversario: adv ? adv.campeao : null, incerto: adv ? (adv.incerto ? 1 : 0) : null, vitoria: s.win ? 1 : 0,
    ouro10: d('10').ouro, xp10: d('10').xp, farm10: d('10').farm, ouro15: d('15').ouro, xp15: d('15').xp, farm15: d('15').farm,
    mortes10: cedo ? cedo.length : null, solo10: cedo ? cedo.filter(m => m.inimigos === 1).length : null,
    gank10: cedo ? cedo.filter(m => m.inimigos >= 2).length : null,
    cs: (Number(s.totalMinionsKilled) || 0) + (Number(s.neutralMinionsKilled) || 0),
    inimigos: (partida.participants || []).filter(p => p.teamId !== meu.teamId)
      .sort((a, b) => a.participantId - b.participantId).map(p => p.championId),
  };
  return limpar(CAMPOS.map(c => o[c]));
}

// linha de fora (DataStore, complemento): só os CAMPOS, cada um com o tipo dele; o resto é descartado. null = inválida
export function limpar(l) {
  if (!Array.isArray(l) || l.length !== CAMPOS.length) return null;
  const out = CAMPOS.map((c, i) => {
    const v = l[i];
    if (c === 'papel') return PAPEIS.includes(v) ? v : null;
    if (c === 'inimigos') return Array.isArray(v) ? v.filter(x => Number.isInteger(x)).slice(0, 5) : [];
    if (c === 'vitoria') return v ? 1 : 0;
    return num(v);
  });
  return Number.isInteger(out[IDX.gameId]) && out[IDX.gameId] > 0 && num(out[IDX.criacao]) !== null ? out : null;
}

// {campos, linhas} de outra ordem de campos -> linhas na ordem de CAMPOS (campo que falta = null)
export function remapear(campos, linhas) {
  if (!Array.isArray(campos) || !Array.isArray(linhas)) return [];
  const pos = CAMPOS.map(c => campos.indexOf(c));
  return linhas.map(l => (Array.isArray(l) ? limpar(pos.map((p, i) => (p < 0 ? (CAMPOS[i] === 'inimigos' ? [] : null) : l[p]))) : null)).filter(Boolean);
}

export const comoObjeto = l => Object.fromEntries(CAMPOS.map((c, i) => [c, l[i]]));
// quantos campos têm valor: a linha mais completa ganha na mescla (a do complemento com linha do tempo troca a sem)
const completude = l => l.reduce((n, v) => n + (v === null || (Array.isArray(v) && !v.length) ? 0 : 1), 0);

const dsPadrao = {
  get: k => { try { return typeof DataStore === 'undefined' ? null : DataStore.get(k); } catch { return null; } },
  set: (k, v) => { if (typeof DataStore !== 'undefined') DataStore.set(k, v); },
};
// GET na LCU (mesma origem) -> {status, dados}; status 0 = abortada ou sem resposta
async function lcuPadrao(url, signal) {
  try {
    const r = await fetch(url, signal ? { signal } : undefined);
    let dados = null;
    try { dados = await r.json(); } catch { /* corpo vazio */ }
    return { status: Number(r.status) || 0, dados };
  } catch { return { status: 0, dados: null }; }
}

// Tudo injetável para tools/teste-historico.mjs: ds (DataStore), lcu(url, signal), agendar/cancelar (setTimeout),
// partidas() (lista do histórico já lida, null = nunca leu), ocupado() (pós-jogo ou lista em voo), coletor e temRecurso
// (ponte, coach.js), Abort (AbortController)
export function criarHistorico({ ds = dsPadrao, lcu = lcuPadrao, agendar = (fn, ms) => setTimeout(fn, ms), cancelar = t => clearTimeout(t),
  partidas = () => null, ocupado = () => false, coletor = null, temRecurso = () => false,
  Abort = typeof AbortController === 'function' ? AbortController : null, log = m => console.log('[lol-client]', m) } = {}) {
  const porId = new Map();   // gameId -> linha
  let dono = null, imp = 0, inerte = false, carregado = false;
  let pendentes = 0, sets = 0, eu = null, outraConta = false;
  let fase = null, timer = null, ctl = null, emPasso = false;
  let feitos = 0, importado = false, tentativasImp = 0, fim = false;
  const tentados = new Set();

  function carregar() {
    carregado = true;
    const s = ds.get(CHAVE);
    if (s === null || s === undefined) return;
    if (!s || typeof s !== 'object' || s.v !== VERSAO) {
      // versão que este código não conhece (mais nova) ou lixo: não lê nem regrava por cima
      inerte = true;
      log(`histórico: ${CHAVE} em formato desconhecido; acumulador parado (nada gravado)`);
      return;
    }
    dono = typeof s.dono === 'string' && s.dono ? s.dono : null;
    imp = Number.isInteger(s.imp) ? s.imp : 0;
    for (const l of remapear(s.campos, s.linhas)) porId.set(l[IDX.gameId], l);
    cortar();
  }

  const maisAntiga = () => { let m = null; for (const l of porId.values()) if (m === null || l[IDX.criacao] < m[IDX.criacao]) m = l; return m; };
  // teto: fica as TETO mais recentes; devolve false se a própria linha nova saiu
  function cortar(nova = null) {
    let saiu = false;
    while (porId.size > TETO) {
      const m = maisAntiga();
      porId.delete(m[IDX.gameId]);
      if (m === nova) saiu = true;
    }
    return !saiu;
  }
  const cheio = () => porId.size >= TETO;

  // a linha entra (ou troca uma menos completa do mesmo gameId) -> true se mudou algo em memória
  function adicionar(l) {
    if (!l) return false;
    const velha = porId.get(l[IDX.gameId]);
    if (velha && completude(l) <= completude(velha)) return false;
    porId.set(l[IDX.gameId], l);
    if (!cortar(l)) return false;
    return true;
  }

  // conta da sessão: a dona do acumulador, ou nenhuma ainda (a 1ª gravação marca)
  function contaOk(puuid) {
    if (!puuid) return false;
    if (!dono || dono === puuid) return true;
    if (!outraConta) log('histórico: conta diferente da dona do acumulador; nada lido nem gravado nesta conta');
    outraConta = true;
    return false;
  }

  function salvar() {
    if (inerte || !dono) return false;
    const linhas = [...porId.values()].sort((a, b) => b[IDX.criacao] - a[IDX.criacao] || b[IDX.gameId] - a[IDX.gameId]);
    try {
      ds.set(CHAVE, { v: VERSAO, dono, imp, campos: CAMPOS, linhas });
      sets++;
      pendentes = 0;
      return true;
    } catch (e) { log(`histórico: DataStore.set falhou (${e?.message || e})`); return false; }
  }

  // partida que acabou (pós-jogo): 1 set se entrou algo novo (com as pendentes do backfill junto)
  function registrar(partida, linhaTempo, puuid, r = null) {
    if (!carregado) carregar();
    if (inerte || !contaOk(puuid)) return false;
    eu = puuid;
    const l = linhaDe(partida, puuid, linhaTempo, r);
    if (!adicionar(l)) return false;
    dono = puuid;
    return salvar();
  }

  // ---- backfill (None/Lobby) e importação ----
  const livre = () => FASES_LIVRES.includes(fase);
  function agendarPasso(ms = PASSO_MS) {
    cancelar(timer);
    timer = agendar(() => { timer = null; passo(); }, ms);
  }
  function parar() {
    cancelar(timer); timer = null;
    if (ctl) { try { ctl.abort(); } catch { /* ignora */ } ctl = null; }
  }

  function aoFase(f) {
    if (f === fase) return;
    fase = f;
    if (livre()) { fim = false; if (!timer && !emPasso && !inerte) agendarPasso(); } else parar();
  }
  // a ponte mudou (complemento achado com "resumos") ou a lista do histórico chegou: volta a olhar se estava parado
  function cutucar() {
    if (livre() && !timer && !emPasso && !inerte) { fim = false; agendarPasso(); }
  }

  async function garantirEu() {
    if (eu) return eu;
    const r = await lcu('/lol-summoner/v1/current-summoner');
    eu = r.status === 200 && typeof r.dados?.puuid === 'string' ? r.dados.puuid : null;
    return eu;
  }

  // próxima partida que falta: da lista já lida, a mais recente; undefined = lista ainda não lida; null = nada falta
  function proxima() {
    const lista = partidas();
    if (!Array.isArray(lista)) return undefined;
    const antiga = cheio() ? maisAntiga()[IDX.criacao] : null;
    let melhor = null;
    for (const g of lista) {
      if (!conta(g) || porId.has(g.gameId) || tentados.has(g.gameId)) continue;
      if (antiga !== null && !(g.gameCreation > antiga)) continue;   // sairia pelo teto na hora
      if (!melhor || g.gameCreation > melhor.gameCreation) melhor = g;
    }
    return melhor;
  }

  async function importar() {
    tentativasImp++;
    const r = await coletor(`/resumos?desde=${imp}`, { prazoMs: IMPORTAR_PRAZO_MS });
    if (r.status === 0 && tentativasImp < IMPORTAR_TENTATIVAS) return false;   // fora do ar agora: tenta no próximo passo
    importado = true;
    const d = r.dados;
    if (r.status !== 200 || !d || d.v !== VERSAO) { log(`histórico: importação do complemento sem resultado (${r.status})`); return false; }
    if (d.dono !== eu) { log('histórico: o complemento é de outra conta; nada importado'); return false; }
    let mudou = false, maior = imp;
    for (const l of remapear(d.campos, d.linhas)) {
      maior = Math.max(maior, l[IDX.gameId]);
      if (conta({ mapId: 11, gameDuration: l[IDX.duracao], queueId: l[IDX.fila] }) && adicionar(l)) mudou = true;
    }
    const n = porId.size;
    if (mudou || maior !== imp) {
      imp = maior;
      dono = eu;
      salvar();
      log(`histórico: importação do complemento (${n} partidas no acumulador)`);
    }
    return mudou;
  }

  async function passo() {
    if (!livre() || emPasso || inerte) return;
    emPasso = true;
    let seguir = true;
    try {
      if (ocupado()) return;   // pós-jogo ou lista do histórico lendo: nunca em paralelo (a LCU atende em fila)
      if (!(await garantirEu()) || !livre()) return;
      if (!contaOk(eu)) { seguir = false; return; }
      if (!importado && temRecurso('resumos') && typeof coletor === 'function') { await importar(); return; }
      if (feitos >= MAX_POR_ABERTURA) { seguir = false; return; }
      const g = proxima();
      if (g === undefined) return;   // lista ainda não lida: o selo da seleção lê 5 s depois da carga
      if (!g) { seguir = false; return; }
      tentados.add(g.gameId);
      feitos++;
      ctl = Abort ? new Abort() : null;
      const sinal = ctl?.signal;
      const pg = await lcu(`/lol-match-history/v1/games/${g.gameId}`, sinal);
      if (pg.status !== 200 || !livre()) return;
      const pt = await lcu(`/lol-match-history/v1/game-timelines/${g.gameId}`, sinal);
      // 404 = a LCU não tem a linha do tempo desta partida: entra sem os campos dela (não se pede de novo).
      // Outro erro ou abortada (fase mudou): fica de fora nesta abertura
      if (pt.status !== 200 && pt.status !== 404) return;
      const l = linhaDe(pg.dados, eu, pt.status === 200 ? pt.dados : null);
      if (adicionar(l)) { dono = eu; pendentes++; }
      if (pendentes >= LOTE && livre()) salvar();
    } catch (e) {
      log(`histórico: backfill (${e?.message || e})`);
    } finally {
      ctl = null;
      emPasso = false;
      if (!seguir) {
        fim = true;
        if (pendentes && livre()) salvar();   // fim do backfill nesta fase: grava o lote incompleto
      }
      if (seguir && livre() && !timer) agendarPasso();
    }
  }

  const estado = () => ({ linhas: porId.size, dono: !!dono, imp, inerte, outraConta, fase, feitos, tentados: tentados.size,
    pendentes, sets, importado, fim, rodando: !!timer || emPasso });
  // as linhas como objetos, mais recentes primeiro (Fase 5: contexto do pós-jogo e da seleção)
  const linhas = () => (outraConta ? [] : [...porId.values()].sort((a, b) => b[IDX.criacao] - a[IDX.criacao]).map(comoObjeto));

  return { carregar, registrar, aoFase, cutucar, passo, importar, estado, linhas, parar };
}

// ---- instância do plugin (index.js chama iniciarHistorico). Antes dela, registrarPartida não faz nada ----
let inst = null;

export function iniciarHistorico(context, opcoes = {}) {
  inst = criarHistorico(opcoes);
  inst.carregar();
  let doSocket = false;
  context.socket.observe('/lol-gameflow/v1/gameflow-phase', m => { doSocket = true; inst.aoFase(m?.data); });
  (opcoes.lcu || lcuPadrao)('/lol-gameflow/v1/gameflow-phase').then(r => { if (!doSocket && r.status === 200) inst.aoFase(r.dados); });
  return inst;
}

export const registrarPartida = (partida, linhaTempo, puuid, r) => (inst ? inst.registrar(partida, linhaTempo, puuid, r) : false);
export const estadoHistorico = () => inst?.estado() ?? null;
