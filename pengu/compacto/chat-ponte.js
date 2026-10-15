// Ponte do plugin com as janelas do chat fora do client (tela 5; coletor/chat_janelas.py, rotas /chat/* do
// servidor local 127.0.0.1:8765). Sem DOM: quem desenha o 💬 é a tela compacta (ctx.extras), quem abre a janela é
// o coletor. Coletor fora do ar (status 0) = {ok:false, fora:true}: a tela expande e abre o chat nativo da Riot.
// Nada aqui escreve na LCU; o coletor só abre janela por clique do Gabriel (abrirAmigos) ou por mensagem nova,
// e mensagem nova só abre sozinha com o compacto ligado (avisarModo).
import { coletor as coletorPadrao } from '../coach.js';

// último modo avisado e se o coletor ficou sabendo: o coletor sobe DEPOIS do client (gatilho 4688) e reinicia;
// a consulta do 💬 (estadoChat) reenvia o modo quando o coletor volta, senão a conversa nova nunca abre sozinha
const modo = { valor: null, lateral: false, entregue: false };
export const _zerarModo = () => { modo.valor = null; modo.lateral = false; modo.entregue = false; }; // só teste

// 💬 com contador: {ok, naoLidas, abertas, lista, fora?, motivo?}. Chamar a cada poucos segundos com a tela à vista.
export async function estadoChat(f = coletorPadrao) {
  const r = await f('/chat/estado', { prazoMs: 3000 });
  if (r.status === 0) {
    modo.entregue = false;
    return { ok: false, fora: true, naoLidas: 0, motivo: 'coletor fora do ar' };
  }
  if (modo.valor !== null && !modo.entregue) await avisarModo(modo.valor, f, { lateral: modo.lateral });
  const d = r.dados || {};
  return { ok: r.status === 200 && d.ok !== false, naoLidas: Math.max(0, Number(d.naoLidas) || 0),
    abertas: Array.isArray(d.abertas) ? d.abertas.length : 0, lista: !!d.lista, motivo: d.motivo || '' };
}

// clique no 💬 (ou no "+ convidar" da tela 1): lista de amigos numa janela própria
export async function abrirAmigos(f = coletorPadrao) {
  const r = await f('/chat/abrir/amigos', { metodo: 'POST', corpo: {}, prazoMs: 3000 });
  if (r.status === 0) return { ok: false, fora: true, motivo: 'coletor fora do ar' };
  return { ok: r.status >= 200 && r.status < 300, motivo: r.dados?.motivo || '' };
}

// o coletor só abre conversa sozinho (mensagem nova) com o client compacto ligado (cfg.compacto.ligado): chamar
// na carga e a cada mudança da chave. Coletor fora: fica guardado e o próximo estadoChat que achar o coletor reenvia.
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
