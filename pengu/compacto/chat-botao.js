// 💬 com o contador de não lidas no topo das telas compactas (protótipo aprovado: telas 1, 2, 3 e 4). Clique = lista de
// amigos numa janela própria (coletor/chat_janelas.py, POST /chat/abrir/amigos); sem coletor, o chat é o da Riot no
// client normal (plano § Riscos). Contador: GET /lol-chat/v1/conversations (só conversa 1:1; sala do lobby, da seleção
// e do pós-jogo não conta). Só lê a LCU; a credencial fica com o coletor. Importável no node (sem DOM no topo).
import { h, estilo } from './comum.js';
import { naoLidasDaLcu } from './chat-ponte.js';

// não lidas das conversas diretas (type 'chat', fora das salas de grupo)
export const naoLidas = conversas => naoLidasDaLcu(conversas);

// abre a lista de amigos em janela própria -> true se o coletor aceitou
export const ROTA_CHAT = '/chat/abrir/amigos';
export async function abrirChat(ctx) {
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
  const bt = h('button', { doc, class: 'lc-cp-ic', title: 'amigos (abre em janela própria)', dataset: { a: 'chat' }, on: { click: ctx.seguro(async () => {
    if (abrindo) return;
    abrindo = true;
    try {
      if (await abrirChat(ctx)) return;
      if (!ctx.vivo()) return;
      // sem o coletor (ou sem a rota do chat): o chat é o da Riot, no client normal (plano § Riscos)
      ctx.expandir();
      ctx.avisar('chat em janela própria indisponível (coletor fora): abri o client normal', true);
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
