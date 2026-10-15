// Freios antes de buscar partida (fila rápida e "jogar de novo"): tilt (N derrotas seguidas na sessão) e
// madrugada (01:00–05:59, hora local do PC). Freio só pede um 2º clique em até JANELA_MS: nunca bloqueia de vez,
// nunca busca sozinho. Módulo puro (sem window/document): roda no node (tools/teste-jogar-de-novo.mjs).
// Decisão do Gabriel (13/10/2026): "pode seguir com 2, com freio por horário" (roadmap/2026-10-13-jogar-de-novo.md).
import { valida, SESSAO_GAP_MS } from './posjogo/abas.js';

// Medição de 13/10/2026 (MCP tilt, 174 partidas no Rift), winrate da partida seguinte:
// - por derrotas seguidas antes: 0 = 50,9%; 1 = 53,7%; 2 = 43,8% (16 partidas); 3+ = 71,4% (7, ruído);
// - por faixa horária: 00–06 47,1% (70 partidas); 06–12 58,8%; 12–18 58,5%; 18–24 50,0%.
// Os textos da confirmação citam só estes números: medir de novo = trocar aqui (e a data).
export const MEDICAO = { data: '13/10/2026', partidas: 174, wrDepoisDe2: 44, wrMadrugada: 47, wrDia: 58 };
export const MADRUGADA = { de: 1, ate: 6 }; // [1h, 6h): 01:00 pede, 05:59 pede, 06:00 e 00:59 não
export const JANELA_MS = 8000; // 2º clique confirma até 8 s depois do 1º
// 2º clique antes disto é o mesmo duplo clique de reflexo (revisão de 13/10/2026): ignorado, a janela segue armada
export const MIN_MS = 700;

export const ehMadrugada = data => {
  const h = data.getHours();
  return h >= MADRUGADA.de && h < MADRUGADA.ate;
};

// derrotas seguidas da sessão em andamento (pausa < 2 h, mesma regra do pós-jogo e do tilt do MCP), contadas da
// partida mais recente para trás. Última partida terminada há 2 h ou mais = sessão nova = 0. Sem histórico = null.
export function derrotasSeguidasAgora(historico, agoraMs) {
  if (!Array.isArray(historico)) return null;
  const jogos = historico.filter(valida).sort((a, b) => b.gameCreation - a.gameCreation);
  const fim = g => g.gameCreation + g.gameDuration * 1000;
  if (!jogos.length || agoraMs - fim(jogos[0]) >= SESSAO_GAP_MS) return 0;
  let n = 0;
  for (let i = 0; i < jogos.length && !jogos[i].participants[0].stats.win; i++) {
    if (i > 0 && jogos[i - 1].gameCreation - fim(jogos[i]) >= SESSAO_GAP_MS) break; // outra sessão
    n++;
  }
  return n;
}

// derrotasSeguidas que não é número: null = histórico não carregou; ATUALIZANDO = o histórico carregou mas ainda não
// tem a partida que acabou e o resultado dela não chegou (criarSequencia em fila-rapida.js)
export const ATUALIZANDO = 'atualizando';
const incerta = d => d === null || d === ATUALIZANDO;

// motivos para pedir confirmação: [{tipo: 'tilt', derrotas} | {tipo: 'madrugada'}]. Sequência incerta (null ou
// ATUALIZANDO): com o freio de tilt ligado pede confirmação, não chuta 0.
export function avaliarFreios(fr, { derrotasSeguidas = 0, data }) {
  const out = [];
  const limiar = Number(fr?.freioTilt) || 0;
  if (limiar > 0 && (incerta(derrotasSeguidas) || derrotasSeguidas >= limiar)) out.push({ tipo: 'tilt', derrotas: derrotasSeguidas });
  if (fr?.freioMadrugada && data && ehMadrugada(data)) out.push({ tipo: 'madrugada' });
  return out;
}

// 44% foi medido depois de exatamente 2 derrotas; com 3+ a amostra é ruído (71%, 7 partidas): cita o 2
const frase = m => {
  if (m.tipo === 'madrugada') return `de madrugada o seu winrate cai: ${MEDICAO.wrMadrugada}% contra ${MEDICAO.wrDia}% de dia`;
  if (m.derrotas === null) return 'sequência de derrotas desconhecida (o histórico não carregou)';
  if (m.derrotas === ATUALIZANDO) return 'sequência de derrotas desconhecida (o histórico ainda não tem a última partida)';
  if (m.derrotas === 2) return `2 derrotas seguidas: depois disso o seu winrate cai para ${MEDICAO.wrDepoisDe2}%`;
  return `${m.derrotas} derrotas seguidas: depois de 2, o seu winrate já cai para ${MEDICAO.wrDepoisDe2}%`;
};
// os dois freios de uma vez: uma frase só, um 2º clique confirma os dois
export const textoFreios = motivos => `${motivos.map(frase).join('; e ')}. Buscar mesmo assim?`;

// dois cliques: o 1º que cai num freio arma a janela; o 2º dentro dela confirma. Fora dela vale como 1º de novo.
// 2º clique antes de minMs (duplo clique de reflexo) é ignorado: não confirma nem rearma. agora injetável (teste sem
// Date real).
export function criarConfirmacao({ janelaMs = JANELA_MS, minMs = MIN_MS, agora = Date.now } = {}) {
  let ate = 0, desde = 0;
  return {
    armada: () => ate > 0 && agora() <= ate,
    // clique cedo demais depois de armar: o chamador não faz nada
    cedo: () => ate > 0 && agora() < desde + minMs,
    // consome: true = este clique confirma
    clique() { const ok = ate > 0 && agora() <= ate; ate = 0; return ok; },
    armar() { desde = agora(); ate = desde + janelaMs; },
    desarmar() { ate = 0; },
  };
}

// o mesmo mecanismo nos dois botões: executar(confirmado) -> {status: 'confirmar'|...}; 'confirmar' arma a janela.
// Clique cedo demais (confirmacao.cedo()) -> {status: 'ignorado'} sem chamar executar.
export async function cliqueComFreio(confirmacao, executar) {
  if (confirmacao.cedo()) return { status: 'ignorado' };
  const r = await executar(confirmacao.clique());
  if (r?.status === 'confirmar') confirmacao.armar();
  return r;
}
