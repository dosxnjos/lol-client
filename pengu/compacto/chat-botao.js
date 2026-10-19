// 💬 com o contador de não lidas no topo das telas compactas (protótipo aprovado: telas 1, 2, 3 e 4). O 💬 abre/fecha o painel de
// chat ao lado (recentes + a última conversa aberta, compacto/lateral.js) e o 👥 ao lado dele abre/fecha a lista de amigos (etapa 1
// de roadmap/2026-10-16-compacto-chat-amigos-perfil.md). Sem a lateral (quebrou no init), o chat é o da Riot no client normal. As
// janelas próprias do chat no complemento coach saíram em 19/10/2026 (Fase 2 de roadmap/2026-10-17-plugin-pengu-primeiro.md,
// aprovada pelo Gabriel). Também aqui: ⚙ (configurações à esquerda, B1) e 📊 (coach da seleção, B2). Contador: GET
// /lol-chat/v1/conversations (só conversa 1:1; sala do lobby, da seleção e do pós-jogo não conta). Só lê a LCU. Importável no
// node (sem DOM no topo).
import { h, estilo, icone } from './comum.js';

// contador sem coletor: soma as não lidas das conversas diretas lidas pela própria LCU do plugin
// (GET /lol-chat/v1/conversations); sala de grupo (champ select, pós-jogo, lobby) não conta. Veio do chat-ponte.js em
// 19/10/2026 (Fase 2 de roadmap/2026-10-17-plugin-pengu-primeiro.md: só LCU, nada do coletor)
const SALA = /@(champ-select|post-game|lol-post-game|sec|lol-lobby|lobby|club|cs)\./i;
export function naoLidasDaLcu(conversas) {
  if (!Array.isArray(conversas)) return 0;
  return conversas.reduce((s, c) => (c && String(c.type || '').toLowerCase() === 'chat' && !SALA.test(String(c.id || ''))
    ? s + Math.max(0, Number(c.unreadMessageCount) || 0) : s), 0);
}

// não lidas das conversas diretas (type 'chat', fora das salas de grupo)
export const naoLidas = conversas => naoLidasDaLcu(conversas);

// abre a lista de amigos -> true se abriu ("+ convidar" do lobby): a lateral da própria janela (compacto/lateral.js, a do 👥).
// Sem a lateral, false (quem chama mostra a lista dentro da tela ou expande para o chat da Riot)
export async function abrirChat(ctx, { alternar = false } = {}) {
  const lat = ctx.servicos?.lateral;
  if (!lat?.ligada?.()) return false;
  if (alternar) return lat.alternarLista() !== false;
  if (!lat.estado?.().lista) return lat.alternarLista() !== false;
  return true;
}

export const CSS_CHAT = `
#lc-compacto .lc-cp-bolha { position:absolute; top:-6px; right:-6px; background:var(--lc-verm); color:#fff; font-style:normal; font-size:10px;
  font-weight:700; min-width:16px; height:16px; border-radius:8px; display:grid; place-items:center; padding:0 3px; }
#lc-compacto .lc-cp-extras:has(> button.lc-cp-ic:nth-of-type(3)) > .lc-cp-ic { padding:0 5px; min-width:28px; }
`;
// (3 botões no topo, como 📊 💬 👥 na seleção: ícones mais justos para o nome da fase caber; medido no harness em 16/10/2026,
// "FINALIZAÇÃO" pede 97 px e sobravam 91)

// cria o 💬 em ctx.extras (antes do que já estiver lá) e, com o chat ao lado, o 👥 logo depois; mantém o contador. -> o 💬
export function botaoChat(ctx, { antesDe = null } = {}) {
  estilo('lc-cp-chat-estilo', CSS_CHAT, ctx.extras?.ownerDocument || ctx.extras?.doc || globalThis.document);
  const doc = ctx.extras?.ownerDocument || ctx.extras?.doc;
  const bolha = h('i', { doc, class: 'lc-cp-bolha', style: { display: 'none' } });
  let abrindo = false;
  const aoLado = !!ctx.servicos?.lateral?.ligada?.();
  const bt = h('button', { doc, class: 'lc-cp-ic', title: aoLado ? 'chat: conversas recentes ao lado (outro clique fecha)' : 'chat: abre o chat no client normal',
    'aria-label': 'chat', dataset: { a: 'chat' }, on: { click: ctx.seguro(async () => {
    if (abrindo) return;
    abrindo = true;
    try {
      const lat = ctx.servicos?.lateral;
      // chat ao lado: o painel de chat (recentes + a última conversa aberta); nada abre sem este clique
      if (lat?.ligada?.() && typeof lat.alternarChat === 'function') { if (lat.alternarChat() !== false) return; }
      else if (await abrirChat(ctx, { alternar: true })) return;
      if (!ctx.vivo()) return;
      // sem o chat ao lado: o chat é o da Riot, no client normal (plano § Riscos)
      ctx.expandir();
      ctx.avisar('chat ao lado indisponível: abrindo o client normal', true);
    } finally { abrindo = false; }
  }) } }, icone('chat', { doc }), bolha);
  if (antesDe && antesDe.parentNode === ctx.extras && typeof ctx.extras.insertBefore === 'function') ctx.extras.insertBefore(bt, antesDe);
  else ctx.extras.append(bt);
  botaoAmigos(ctx, { depoisDe: bt });
  const pintarBolha = n => { bolha.textContent = n > 99 ? '99+' : String(n); bolha.style.display = n > 0 ? '' : 'none'; };
  const ler = async () => {
    const r = await ctx.lcu('GET', '/lol-chat/v1/conversations');
    if (ctx.vivo() && r.ok) pintarBolha(naoLidas(r.json));
  };
  ler().catch(() => {});
  ctx.observar('/lol-chat/v1/conversations', () => { ler().catch(() => {}); });
  ctx.intervalo(() => { ler().catch(() => {}); }, 5000);
  return bt;
}

// 👥 lista de amigos ao lado (etapa 1 de 2026-10-16: "do lado do botão de chat pode ter um botão de amigos"), logo depois do 💬.
// Só com a lateral de pé. data-a "lista-amigos": "amigos" é a lista dentro da tela do lobby (tela-lobby.js, sem a lateral)
export function botaoAmigos(ctx, { depoisDe = null } = {}) {
  const lat = ctx.servicos?.lateral;
  if (typeof lat?.alternarLista !== 'function' || !lat.ligada?.()) return null;
  const doc = ctx.extras?.ownerDocument || ctx.extras?.doc;
  const bt = h('button', { doc, class: 'lc-cp-ic', title: 'amigos: lista ao lado (outro clique fecha)', 'aria-label': 'amigos', dataset: { a: 'lista-amigos' },
    on: { click: ctx.seguro(() => lat.alternarLista()) } }, icone('amigos', { doc }));
  const irmaos = [...(ctx.extras.children || [])];
  const i = depoisDe ? irmaos.indexOf(depoisDe) : -1;
  const prox = i >= 0 ? irmaos[i + 1] : null;
  if (prox && typeof ctx.extras.insertBefore === 'function') ctx.extras.insertBefore(bt, prox);
  else ctx.extras.append(bt);
  return bt;
}

// ⚙ configurações do lol-client no painel da esquerda (passo 13 B1). Sem lateral (teste antigo, quebra no init): nada
export function botaoConfig(ctx) {
  const lat = ctx.servicos?.lateral;
  if (typeof lat?.alternarConfig !== 'function') return null;
  const doc = ctx.extras?.ownerDocument || ctx.extras?.doc;
  const bt = h('button', { doc, class: 'lc-cp-ic', title: 'configurações do lol-client (abrem à esquerda)', 'aria-label': 'configurações', dataset: { a: 'config' },
    on: { click: ctx.seguro(() => lat.alternarConfig()) } }, icone('configuracoes', { doc }));
  ctx.extras.append(bt);
  return bt;
}

// 📊 coach da seleção no painel da direita (passo 13 B2): só no clique dele
export function botaoCoach(ctx, { antesDe = null } = {}) {
  const lat = ctx.servicos?.lateral;
  if (typeof lat?.alternarCoach !== 'function') return null;
  const doc = ctx.extras?.ownerDocument || ctx.extras?.doc;
  const bt = h('button', { doc, class: 'lc-cp-ic', title: 'coach da seleção: selo completo ao lado (KDA, posição, matchup, draft)', 'aria-label': 'coach da seleção', dataset: { a: 'coach' },
    on: { click: ctx.seguro(() => lat.alternarCoach()) } }, icone('coach', { doc }));
  if (antesDe && antesDe.parentNode === ctx.extras && typeof ctx.extras.insertBefore === 'function') ctx.extras.insertBefore(bt, antesDe);
  else ctx.extras.append(bt);
  return bt;
}
