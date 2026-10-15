// 💬 com o contador de não lidas no topo das telas compactas (protótipo aprovado: telas 1, 2, 3 e 4). Clique = lista de
// amigos ao lado da coluna (passo 13, compacto/lateral.js; chave compacto.chatLateral) ou, com ela desligada, numa janela
// própria (coletor/chat_janelas.py, POST /chat/abrir/amigos); sem os dois, o chat é o da Riot no client normal.
// Também aqui: ⚙ (configurações à esquerda, B1) e 📊 (coach da seleção, B2). Contador: GET /lol-chat/v1/conversations (só conversa 1:1; sala do lobby, da seleção
// e do pós-jogo não conta). Só lê a LCU; a credencial fica com o coletor. Importável no node (sem DOM no topo).
import { h, estilo } from './comum.js';
import { naoLidasDaLcu } from './chat-ponte.js';

// não lidas das conversas diretas (type 'chat', fora das salas de grupo)
export const naoLidas = conversas => naoLidasDaLcu(conversas);

// abre a lista de amigos -> true se abriu. Passo 13: com o chat ao lado ligado (compacto.chatLateral, padrão), a lista é a
// lateral da própria janela (compacto/lateral.js); desligado, a janela própria do coletor como antes
export const ROTA_CHAT = '/chat/abrir/amigos';
export async function abrirChat(ctx, { alternar = false } = {}) {
  const lat = ctx.servicos?.lateral;
  if (lat?.ligada?.()) {
    if (alternar) return lat.alternarLista() !== false;
    if (!lat.estado?.().lista) return lat.alternarLista() !== false;
    return true;
  }
  const col = ctx.servicos?.coletor;
  if (typeof col !== 'function') return false;
  const r = await col(ROTA_CHAT, { metodo: 'POST', corpo: {}, prazoMs: 3000 });
  return r?.status >= 200 && r.status < 300 && r.dados?.ok !== false;
}

export const CSS_CHAT = `
#lc-compacto .lc-cp-bolha { position:absolute; top:-6px; right:-6px; background:var(--lc-verm); color:#fff; font-style:normal; font-size:10px;
  font-weight:700; min-width:16px; height:16px; border-radius:8px; display:grid; place-items:center; padding:0 3px; }
`;

// cria o 💬 em ctx.extras (antes do que já estiver lá) e mantém o contador. -> o botão
export function botaoChat(ctx, { antesDe = null } = {}) {
  estilo('lc-cp-chat-estilo', CSS_CHAT, ctx.extras?.ownerDocument || ctx.extras?.doc || globalThis.document);
  const doc = ctx.extras?.ownerDocument || ctx.extras?.doc;
  const bolha = h('i', { doc, class: 'lc-cp-bolha', style: { display: 'none' } });
  let abrindo = false;
  const aoLado = !!ctx.servicos?.lateral?.ligada?.();
  const bt = h('button', { doc, class: 'lc-cp-ic', title: aoLado ? 'amigos (abre ao lado; outro clique fecha)' : 'amigos (abre em janela própria)', dataset: { a: 'chat' }, on: { click: ctx.seguro(async () => {
    if (abrindo) return;
    abrindo = true;
    try {
      if (await abrirChat(ctx, { alternar: true })) return;
      if (!ctx.vivo()) return;
      // sem o coletor (ou sem a rota do chat): o chat é o da Riot, no client normal (plano § Riscos)
      ctx.expandir();
      ctx.avisar('chat em janela própria indisponível (coletor fora do ar): abrindo o client normal', true);
    } finally { abrindo = false; }
  }) } }, '💬', bolha);
  if (antesDe && antesDe.parentNode === ctx.extras && typeof ctx.extras.insertBefore === 'function') ctx.extras.insertBefore(bt, antesDe);
  else ctx.extras.append(bt);
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

// ⚙ configurações do lol-client no painel da esquerda (passo 13 B1). Sem lateral (teste antigo, quebra no init): nada
export function botaoConfig(ctx) {
  const lat = ctx.servicos?.lateral;
  if (typeof lat?.alternarConfig !== 'function') return null;
  const doc = ctx.extras?.ownerDocument || ctx.extras?.doc;
  const bt = h('button', { doc, class: 'lc-cp-ic', title: 'configurações do lol-client (abrem à esquerda)', dataset: { a: 'config' },
    on: { click: ctx.seguro(() => lat.alternarConfig()) } }, '⚙');
  ctx.extras.append(bt);
  return bt;
}

// 📊 coach da seleção no painel da direita (passo 13 B2): só no clique dele
export function botaoCoach(ctx, { antesDe = null } = {}) {
  const lat = ctx.servicos?.lateral;
  if (typeof lat?.alternarCoach !== 'function') return null;
  const doc = ctx.extras?.ownerDocument || ctx.extras?.doc;
  const bt = h('button', { doc, class: 'lc-cp-ic', title: 'coach da seleção: selo completo ao lado (KDA, posição, matchup, draft)', dataset: { a: 'coach' },
    on: { click: ctx.seguro(() => lat.alternarCoach()) } }, '📊');
  if (antesDe && antesDe.parentNode === ctx.extras && typeof ctx.extras.insertBefore === 'function') ctx.extras.insertBefore(bt, antesDe);
  else ctx.extras.append(bt);
  return bt;
}
