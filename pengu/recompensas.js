// Coleta automática de recompensas (roadmap/2026-10-13-coleta-automatica-de-recompensas.md).
// Só coleta o que não tem escolha; escolha de verdade ("1 de 3") vira aviso e fica com o Gabriel.
// NUNCA gasta: baú, criação, desencantar, loja de fichas, passe. A garantia é a lista de rotas de escrita
// permitidas (ROTAS_COLETA): qualquer outra escrita é recusada aqui dentro, antes do fetch.
// Gatilhos: ao carregar o client e 30 s depois de EndOfGame -> None/Lobby; na hora de coletar relê a fase e
// adia se não for None/Lobby (o "jogar de novo" leva direto a Matchmaking/ReadyCheck/ChampSelect).
// Prova antes do lote (planejarColeta): por sessão, 1 item de cada tipo; o resto só depois de conferir que ele saiu.
// Importável no node (tools/teste-recompensas.mjs): nada de window/document no topo do módulo.
import { avisar as avisarComum } from './compacto/comum.js';

export const ROTAS_COLETA = [
  /^POST \/lol-rewards\/v1\/grants\/[\w-]+\/select$/,
  /^POST \/lol-event-hub\/v1\/events\/[\w-]+\/reward-track\/claim-all$/,
  /^PUT \/lol-tft-pass\/v1\/pass\/[\w-]+\/milestone\/claim-all-rewards$/,
];
export const FASES_LIVRES = ['None', 'Lobby'];
export const ESPERA_POS_JOGO_MS = 30000; // o servidor credita o prêmio da partida depois do fim
export const INTERVALO_MS = 350; // uma coleta por vez, ≥ 300 ms entre elas

export const rotaPermitida = (metodo, url) => metodo === 'GET' || ROTAS_COLETA.some(re => re.test(`${metodo} ${url}`));

// fetch da LCU com a trava de rotas; devolve {ok, status, json}
export function criarLcu(fetchFn = (...a) => fetch(...a)) {
  return async (metodo, url, corpo) => {
    if (!rotaPermitida(metodo, url)) throw new Error(`rota fora da lista de coleta: ${metodo} ${url}`);
    const r = await fetchFn(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const texto = await r.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
    return { ok: r.ok, status: r.status, json };
  };
}

const titulo = rw => rw?.localizations?.title || rw?.itemId || 'recompensa';

// Concessão (GET /lol-rewards/v1/grants, item {info, rewardGroup}) -> {tipo: 'coletar'|'escolher'|'pular'}.
// Sem escolha = todos os itens cabem no máximo de seleções (medido em 13/10/2026: 60 pendentes, todas 1/1 ou 2/2).
export function classificarConcessao(g) {
  const info = g?.info, grupo = g?.rewardGroup;
  if (!info?.id || info.status !== 'PENDING_SELECTION') return { tipo: 'pular', motivo: `status ${info?.status ?? '?'}` };
  const itens = grupo?.rewards || [];
  if (!itens.length) return { tipo: 'pular', motivo: 'sem itens' };
  const nomes = itens.map(titulo);
  // falha fechada: sem o máximo informado não dá para saber se é escolha; fica com o Gabriel
  const bruto = grupo.selectionStrategyConfig?.maxSelectionsAllowed;
  const max = bruto === null || bruto === undefined || bruto === '' ? NaN : Number(bruto);
  if (!Number.isFinite(max)) return { tipo: 'escolher', id: info.id, rotulo: `escolher (máximo de seleções não informado): ${nomes.join(' ou ')}` };
  if (max < itens.length) return { tipo: 'escolher', id: info.id, rotulo: `escolher ${max} de ${itens.length}: ${nomes.join(' ou ')}` };
  return {
    // tipo de entrega (cap.wallets, loot.lootserver, cap.entitlements, store.purchase): a 1ª coleta de cada tipo
    // na sessão vai sozinha e é conferida antes do lote (criarRecompensas)
    tipo: 'coletar', id: info.id, rotulo: nomes.join(' + '), grupo: `concessão:${itens[0]?.fulfillmentSource || '?'}`,
    chamada: ['POST', `/lol-rewards/v1/grants/${info.id}/select`, { rewardGroupId: info.rewardGroupId || grupo.id, selections: itens.map(i => i.id) }],
  };
}

// tudo o que está pendente, por fonte, com o motivo de pular cada item (passo 1 do plano)
export async function levantar(lcu, cfg) {
  // concessoesLidas: false = a leitura falhou (a conferência da amostra não pode concluir nada dela)
  const out = { coletar: [], escolher: [], pulados: [], concessoesLidas: false };
  const grants = await lcu('GET', '/lol-rewards/v1/grants').catch(() => null);
  if (grants?.ok && Array.isArray(grants.json)) {
    out.concessoesLidas = true;
    for (const g of grants.json) {
      const c = classificarConcessao(g);
      if (c.tipo === 'coletar') out.coletar.push({ fonte: 'concessão', ...c });
      else if (c.tipo === 'escolher') out.escolher.push({ fonte: 'concessão', ...c });
      else if (c.motivo !== 'status FULFILLED') out.pulados.push({ fonte: 'concessão', id: g?.info?.id, motivo: c.motivo });
    }
  } else out.pulados.push({ fonte: 'concessão', motivo: `leitura falhou (${grants?.status ?? 'erro'})` });

  const eventos = await lcu('GET', '/lol-event-hub/v1/events').catch(() => null);
  for (const ev of (eventos?.ok && Array.isArray(eventos.json) ? eventos.json : [])) {
    const id = ev?.eventId;
    if (!id) continue;
    const u = await lcu('GET', `/lol-event-hub/v1/events/${id}/reward-track/unclaimed-rewards`).catch(() => null);
    const n = Number(u?.json?.rewardsCount) || 0;
    if (n <= 0) continue;
    // a trilha pode ter marco de escolha (rewardOptions > 1) e não está medido se o claim-all pula ou escolhe:
    // marco de escolha sem opção marcada = escolha do Gabriel, sem claim-all. O state dos itens não serve
    // (13/10: "Locked" em todos, até nas trilhas com progresso). Leitura falhou = não coleta (falha fechada).
    const nome = ev?.eventInfo?.eventName || id;
    const [itens, bonus] = await Promise.all(['items', 'bonus-items'].map(t =>
      lcu('GET', `/lol-event-hub/v1/events/${id}/reward-track/${t}`).catch(() => null)));
    if (!itens?.ok || !Array.isArray(itens.json) || !bonus?.ok || !Array.isArray(bonus.json)) {
      out.pulados.push({ fonte: 'evento', id, motivo: `não consegui ler os marcos da trilha (${itens?.status ?? 'erro'}/${bonus?.status ?? 'erro'})` });
      continue;
    }
    const escolha = [...itens.json, ...bonus.json].find(i => (i?.rewardOptions?.length ?? 0) > 1 && !i.rewardOptions.some(o => o?.selected));
    if (escolha) {
      out.escolher.push({ fonte: 'evento', id, rotulo: `trilha de ${nome}: escolher entre ${escolha.rewardOptions.map(o => o?.rewardName || '?').join(' ou ')}` });
      continue;
    }
    out.coletar.push({ fonte: 'evento', id, rotulo: `${n} da trilha de ${nome}`, quantos: n, grupo: 'evento',
      chamada: ['POST', `/lol-event-hub/v1/events/${id}/reward-track/claim-all`] });
  }

  if (cfg?.recompensas?.tft) {
    const passes = await lcu('GET', '/lol-tft-pass/v1/active-passes').catch(() => null);
    for (const p of (passes?.ok && Array.isArray(passes.json) ? passes.json : [])) {
      const id = p?.info?.passId;
      const n = [...(p?.milestones || []), ...(p?.bonuses || [])].filter(m => m?.status === 'REWARDABLE').length;
      if (id && n > 0) out.coletar.push({ fonte: 'tft', id, rotulo: `${n} do passe do TFT`, quantos: n, grupo: 'tft',
        chamada: ['PUT', `/lol-tft-pass/v1/pass/${id}/milestone/claim-all-rewards`] });
    }
  }
  return out;
}

const dormirPadrao = ms => new Promise(r => setTimeout(r, ms));

// coleta uma por vez; um erro não para o resto (falhou: tenta de novo só no próximo gatilho)
export async function coletar(lcu, itens, { dormir = dormirPadrao, intervaloMs = INTERVALO_MS, log = () => {} } = {}) {
  let ok = 0;
  const falhas = [], coletados = [];
  for (const [i, item] of itens.entries()) {
    if (i) await dormir(intervaloMs);
    try {
      const [metodo, url, corpo] = item.chamada;
      const r = await lcu(metodo, url, corpo);
      if (r.ok) { ok += item.quantos || 1; coletados.push(item); log(`recompensa coletada (${item.fonte}${item.amostra ? ', 1ª do tipo' : ''}): ${item.rotulo}`); }
      else { falhas.push({ ...item, status: r.status }); log(`recompensa falhou (${item.fonte}, ${r.status}): ${item.rotulo}`); }
    } catch (e) {
      falhas.push({ ...item, erro: String(e?.message || e) });
      log(`recompensa falhou (${item.fonte}): ${e?.message || e}`);
    }
  }
  return { ok, falhas, coletados };
}

export const MAX_FALHAS = 3; // a mesma recompensa falhando 3 vezes na sessão: para de tentar (só log)

// Prova antes do lote (passo 2 do plano, automático): por sessão do client, cada tipo (grupo do levantar) manda
// 1 item só; na rodada seguinte, se ele sumiu da leitura, o tipo fica liberado e o resto vai; se continua
// pendente apesar do 2xx, o tipo trava até recarregar o client (só concessão; trilha e passe liberam no 2xx, ver
// rodar). Falha repetida avisa uma vez por recompensa.
// grupos: Map(grupo -> {estado: 'amostra', id} | {estado: 'liberado'} | {estado: 'travado'})
export function planejarColeta(coletarLista, { grupos, tentativas, concessoesLidas = true }) {
  const pendentes = new Set(coletarLista.map(i => i.id));
  const travados = [];
  // leitura das concessões falhou: lista vazia não prova que a amostra saiu; a amostra espera a próxima leitura boa
  if (concessoesLidas) for (const [g, st] of grupos) if (st.estado === 'amostra') {
    if (pendentes.has(st.id)) { grupos.set(g, { estado: 'travado' }); travados.push(g); } else grupos.set(g, { estado: 'liberado' });
  }
  const fila = [], comAmostra = new Set();
  let esperando = 0;
  for (const item of coletarLista) {
    if ((tentativas.get(item.id) || 0) >= MAX_FALHAS) continue;
    const g = item.grupo || item.fonte, st = grupos.get(g)?.estado;
    if (st === 'travado') continue;
    if (st === 'liberado') { fila.push(item); continue; }
    if (st === 'amostra' || comAmostra.has(g)) { esperando++; continue; } // tipo sem prova: só 1 até conferir
    comAmostra.add(g);
    fila.push({ ...item, grupo: g, amostra: true });
  }
  return { fila, travados, esperando };
}

// Controlador com relógio e LCU injetáveis (o teste dirige com tempo falso).
// avisar(texto, erro?) mostra no client; agendar/cancelar = setTimeout/clearTimeout.
export function criarRecompensas({ cfg, lcu, avisar = () => {}, log = () => {}, dormir = dormirPadrao,
  agendar = setTimeout, cancelar = clearTimeout, esperaMs = ESPERA_POS_JOGO_MS }) {
  let rodando = false, devendo = false, timer = null, faseAnterior = null;
  const avisados = new Set(); // escolha avisada uma vez por sessão do client, não a cada partida
  const grupos = new Map(), tentativas = new Map(), falhasAvisadas = new Set(); // prova por tipo e falhas (sessão)

  async function rodar(origem) {
    if (!cfg.recompensas?.ligado) return { status: 'desligado' };
    if (rodando) return { status: 'ocupado' };
    rodando = true;
    try {
      const fase = (await lcu('GET', '/lol-gameflow/v1/gameflow-phase').catch(() => null))?.json;
      if (!FASES_LIVRES.includes(fase)) { devendo = true; log(`recompensas: adiado (${origem}, fase ${fase})`); return { status: 'adiado', fase }; }
      devendo = false;
      const lev = await levantar(lcu, cfg);
      const novas = lev.escolher.filter(e => !avisados.has(e.id));
      for (const e of novas) avisados.add(e.id);
      if (novas.length) avisar(novas.length === 1 ? `recompensa para escolher: ${novas[0].rotulo}` : `${novas.length} recompensas para escolher (veja no client)`);
      const plano = planejarColeta(lev.coletar, { grupos, tentativas, concessoesLidas: lev.concessoesLidas });
      for (const g of plano.travados) {
        log(`recompensas: a 1ª coleta do tipo ${g} respondeu ok mas continua pendente; tipo parado nesta sessão`);
        avisar(`coleta de recompensas (${g}) não teve efeito: parei esse tipo até reabrir o client`, true);
      }
      const r = await coletar(lcu, plano.fila, { dormir, log });
      // concessão: id único, a rodada seguinte confere se saiu da lista. Trilha do evento e passe: o id é o do
      // evento/passe, que volta a ter prêmio depois de outra partida (conferir por presença travaria à toa): o 2xx libera
      for (const item of r.coletados) if (item.amostra)
        grupos.set(item.grupo, item.fonte === 'concessão' ? { estado: 'amostra', id: item.id } : { estado: 'liberado' });
      for (const f of r.falhas) tentativas.set(f.id, (tentativas.get(f.id) || 0) + 1);
      const resto = plano.esperando ? ` (1ª de cada tipo; as outras ${plano.esperando} depois da próxima partida)` : '';
      if (r.ok) avisar(`${r.ok} ${r.ok === 1 ? 'recompensa coletada' : 'recompensas coletadas'}${resto}`);
      // falha avisa uma vez por recompensa; depois de MAX_FALHAS ela sai da fila desta sessão
      const falhasNovas = r.falhas.filter(f => !falhasAvisadas.has(f.id));
      for (const f of falhasNovas) falhasAvisadas.add(f.id);
      if (falhasNovas.length) avisar(`${falhasNovas.length} recompensa(s) não coletada(s): tento de novo depois da próxima partida`, true);
      return { status: 'feito', coletadas: r.ok, falhas: r.falhas.length, escolher: lev.escolher.length, esperando: plano.esperando, travados: plano.travados.length };
    } finally { rodando = false; }
  }

  const programar = (ms, origem) => {
    timer = agendar(() => { timer = null; rodar(origem).catch(e => log(`recompensas: ${e?.message || e}`)); }, ms);
  };

  return {
    rodar,
    // carregamento do client (o rodar relê a fase: recarga no meio da partida adia)
    aoCarregar: () => rodar('carga'),
    aoFase(fase) {
      const antes = faseAnterior;
      faseAnterior = fase;
      if (!FASES_LIVRES.includes(fase)) { if (timer) { cancelar(timer); timer = null; devendo = true; } return; }
      // fim de partida (ou coleta adiada) chegando em None/Lobby: espera o crédito e coleta
      // (evento repetido de Lobby não empurra o relógio já armado)
      if ((antes === 'EndOfGame' || devendo) && !timer) programar(esperaMs, antes === 'EndOfGame' ? 'pós-jogo' : 'adiada');
    },
    estado: () => ({ rodando, devendo, agendado: !!timer, avisados: avisados.size,
      grupos: Object.fromEntries([...grupos].map(([g, st]) => [g, st.estado])), falhas: Object.fromEntries(tentativas) }),
  };
}

export function iniciarRecompensas(context, cfg) {
  // aviso dentro da camada compacta quando ela está à vista (a coleta roda com a tela 1 à frente e o Toast pode ficar
  // embaixo dela), senão o Toast do Pengu (compacto/comum.js avisar; plano do compacto, passo 11 b3)
  const avisar = (msg, erro) => avisarComum(msg, erro);
  const r = criarRecompensas({ cfg, lcu: criarLcu(), avisar, log: m => console.log('[lol-client]', m) });
  context.socket.observe('/lol-gameflow/v1/gameflow-phase', msg => r.aoFase(msg?.data));
  // carga: depois da fase responder (o rodar lê a fase); 5 s para o client assentar
  setTimeout(() => r.aoCarregar().catch(e => console.error('[lol-client] recompensas', e)), 5000);
  return r;
}
