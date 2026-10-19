// Ponte do plugin com as janelas do chat fora do client (tela 5; coletor/chat_janelas.py, rotas /chat/* do
// servidor local 127.0.0.1:8765), só com o complemento coach anunciando "chat-janelas" (quem chama confere: compacto/index.js
// criarAvisoChat). Sem DOM: quem desenha o 💬 é a tela compacta (ctx.extras), quem abre a janela é o coletor.
// Nada aqui escreve na LCU; o coletor só abre janela por clique do Gabriel ou por mensagem nova, e mensagem nova só abre
// sozinha com o compacto ligado (avisarModo). estadoChat/abrirAmigos saíram em 19/10/2026 (sem chamador no plugin; Fase 1 do
// roadmap/2026-10-17-plugin-pengu-primeiro.md): o 💬 abre a janela por compacto/chat-botao.js abrirChat.
import { coletor as coletorPadrao } from '../coach.js';

// último modo avisado e se o coletor ficou sabendo (o reaviso periódico do compacto/index.js reenvia)
const modo = { valor: null, lateral: false, entregue: false };
export const _zerarModo = () => { modo.valor = null; modo.lateral = false; modo.entregue = false; }; // só teste

// o coletor só abre conversa sozinho (mensagem nova) com o client compacto ligado (cfg.compacto.ligado): chamar
// na carga e a cada mudança da chave. Coletor fora: o reaviso periódico (compacto/index.js CHAT_REAVISO_MS) reenvia.
// lateral (passo 13): o chat ao lado do compacto está ligado; quem chama já manda compacto:false junto (index.js
// criarAvisoChat), porque o coletor de hoje só lê `compacto`. O campo é para o coletor depois do patch.
export async function avisarModo(compacto, f = coletorPadrao, { lateral = false } = {}) {
  modo.valor = !!compacto;
  modo.lateral = !!lateral;
  const r = await f('/chat/plugin', { metodo: 'POST', corpo: { compacto: modo.valor, lateral: modo.lateral }, prazoMs: 3000 });
  modo.entregue = r.status === 200;
  return modo.entregue;
}

// contador sem coletor: soma as não lidas das conversas diretas lidas pela própria LCU do plugin
// (GET /lol-chat/v1/conversations); sala de grupo (champ select, pós-jogo, lobby) não conta.
const SALA = /@(champ-select|post-game|lol-post-game|sec|lol-lobby|lobby|club|cs)\./i;
export function naoLidasDaLcu(conversas) {
  if (!Array.isArray(conversas)) return 0;
  return conversas.reduce((s, c) => (c && String(c.type || '').toLowerCase() === 'chat' && !SALA.test(String(c.id || ''))
    ? s + Math.max(0, Number(c.unreadMessageCount) || 0) : s), 0);
}
