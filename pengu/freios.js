// Freios antes de buscar partida (fila rápida e "jogar de novo"): tilt (N derrotas seguidas na sessão) e
// madrugada (01:00–05:59, hora local do PC). Freio só pede um 2º clique em até JANELA_MS: nunca bloqueia de vez,
// nunca busca sozinho. Módulo puro (sem window/document): roda no node (tools/teste-jogar-de-novo.mjs).
// Decisão do Gabriel (13/10/2026): "pode seguir com 2, com freio por horário" (roadmap/2026-10-13-jogar-de-novo.md).
import { valida, SESSAO_GAP_MS } from './posjogo/abas.js';
import { linhasHistorico } from './historico.js';
import { medicaoDe } from './posjogo/contexto.js';

// Números da confirmação: calculados do acumulador de quem usa (historico.js; posjogo/contexto.js medicaoDe), não mais fixos
// (Fase 5 do roadmap/2026-10-17-plugin-pengu-primeiro.md; até 19/10/2026 era a MEDICAO de 13/10 com 174 partidas do
// mantenedor: 2 derrotas 44%, madrugada 47%, dia 58%). medicao = {partidas, wrGeral, wrDepoisDe2, wrMadrugada, wrDia} (inteiros)
// ou null abaixo de 30 partidas; cada número null com menos de 10 partidas na faixa. Sem número, o texto não cita nenhum.
// Na instalação com o complemento coach, o acumulador começa com a importação do /resumos (Fase 4)
export function medicaoAtual() {
  try { return medicaoDe(linhasHistorico()); } catch { return null; }
}
// "cai" só quando o número é menor que a comparação (o calculado pode não mostrar queda): senão o texto só diz o número
const cai = (a, b) => typeof a === 'number' && typeof b === 'number' && a < b;
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

// o número é o de depois de exatamente 2 derrotas (com 3+ a amostra é ruído: 71% em 7 partidas na medição de 13/10): cita o 2.
// med = medicao (null = texto sem número)
const seguidas = n => `${n} ${n === 1 ? 'derrota' : 'derrotas seguidas'}`;
const frase = (m, med) => {
  if (m.tipo === 'madrugada') {
    const mad = med?.wrMadrugada, dia = med?.wrDia;
    if (typeof mad !== 'number' || typeof dia !== 'number') return 'é madrugada (entre 1h e 6h)';
    return cai(mad, dia) ? `de madrugada o seu winrate cai: ${mad}% contra ${dia}% de dia` : `de madrugada o seu winrate é ${mad}%, contra ${dia}% de dia`;
  }
  if (m.derrotas === null) return 'sequência de derrotas desconhecida (o histórico não carregou)';
  if (m.derrotas === ATUALIZANDO) return 'sequência de derrotas desconhecida (o histórico ainda não tem a última partida)';
  const d2 = med?.wrDepoisDe2;
  if (typeof d2 !== 'number') return seguidas(m.derrotas);
  const verbo = cai(d2, med.wrGeral) ? 'cai para' : 'é';
  if (m.derrotas === 2) return `2 derrotas seguidas: depois disso o seu winrate ${verbo} ${d2}%`;
  return `${seguidas(m.derrotas)}: depois de 2, o seu winrate ${cai(d2, med.wrGeral) ? 'já cai para' : 'é'} ${d2}%`;
};
// os dois freios de uma vez: uma frase só, um 2º clique confirma os dois. medicao: parâmetro (padrão: a do acumulador agora)
export const textoFreios = (motivos, medicao = medicaoAtual()) => `${motivos.map(m => frase(m, medicao)).join('; e ')}. Buscar mesmo assim?`;

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
