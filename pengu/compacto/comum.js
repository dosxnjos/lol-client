// Helpers das telas compactas (roadmap/2026-10-13-client-compacto.md). Importável no node (tools/teste-compacto.mjs):
// nada de window/document no topo do módulo; quem precisa de DOM recebe o document (ou usa o global na hora).
// Regra da casa: texto da LCU (nome de campeão, título, mensagem) nunca vai cru para innerHTML. Montar DOM com h()
// (textContent) ou, se for string HTML, passar cada valor por esc().

// fases da partida (passo 14): a tela compacta "partida em andamento" (tela-jogo.js) fica atrás do jogo; a lateral fica guardada
// (decisão 2 do passo 13) e o roteador não mexe na janela com o jogo na frente (compacto/index.js podeMexer)
export const FASES_JOGO = ['GameStart', 'InProgress', 'Reconnect'];

// escapa texto para HTML (atributo ou corpo)
export function esc(v) {
  return String(v ?? '').replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c]);
}

// LCU pela própria página (a sessão do client já autentica: a credencial nunca passa por aqui).
// Nunca lança: falha de rede vira {ok:false, status:0, erro}. f = fetch injetável (teste).
export async function lcu(metodo, url, corpo, f = globalThis.fetch) {
  try {
    const r = await f(url, {
      method: metodo,
      headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await r.text();
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
    return { ok: r.ok, status: r.status, json };
  } catch (e) {
    return { ok: false, status: 0, json: null, erro: e?.message || String(e) };
  }
}

// ícone do campeão servido pelo próprio client (o mesmo do minimapa: ARMADILHAS § Tela). Só id numérico > 0.
export function iconeCampeao(id) {
  const n = Math.trunc(Number(id));
  return n > 0 ? `/lol-game-data/assets/v1/champion-icons/${n}.png` : '';
}

// catálogo id -> {id, nome, alias}, lido uma vez por carga do plugin. Filtra id < 10000 (variantes de modo com o
// mesmo nome, ARMADILHAS § Client). Falha = mapa vazio (a tela mostra o id, não quebra) e tenta de novo na próxima.
let catalogo = null, catalogoEmVoo = null;
export function campeoes(f = globalThis.fetch) {
  if (catalogo) return Promise.resolve(catalogo);
  return (catalogoEmVoo ||= lcu('GET', '/lol-game-data/assets/v1/champion-summary.json', undefined, f).then(r => {
    const mapa = new Map();
    if (r.ok && Array.isArray(r.json)) for (const c of r.json) {
      const id = Number(c?.id);
      if (id > 0 && id < 10000) mapa.set(id, { id, nome: String(c.name ?? id), alias: String(c.alias ?? '') });
    }
    if (mapa.size) catalogo = mapa;
    return mapa;
  }).finally(() => { catalogoEmVoo = null; }));
}
export const _zerarCatalogo = () => { catalogo = null; }; // só teste

// cria elemento: h('div', {class: 'x', title: 't', dataset: {a: 1}, on: {click: fn}, style: {left: '1px'}}, filho, 'texto')
// texto entra por textContent (seguro com dado da LCU). doc injetável (teste).
export function h(tag, attrs = {}, ...filhos) {
  const doc = attrs?.doc || globalThis.document;
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false || k === 'doc') continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
    else if (k === 'style') for (const [p, val] of Object.entries(v)) el.style[p] = val;
    else if (k === 'text') el.textContent = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const f of filhos.flat()) {
    if (f === undefined || f === null || f === false) continue;
    el.append(typeof f === 'object' ? f : String(f));
  }
  return el;
}

// foto redonda do campeão (protótipo: .cp.foto); sem id vira círculo vazio com a inicial
export function fotoCampeao(id, { tam = 28, nome = '', doc } = {}) {
  const url = iconeCampeao(id);
  return h('span', {
    doc, class: 'lc-cp-foto', title: nome || undefined,
    style: { width: tam + 'px', height: tam + 'px', backgroundImage: url ? `url("${url}")` : '' },
  }, url ? '' : String(nome || '?').slice(0, 1));
}

// <style id> injetado uma vez (Pengu não tem import de CSS medido em subpasta; ARMADILHAS § Client)
export function estilo(id, css, doc = globalThis.document) {
  if (!doc?.head && !doc?.documentElement) return null;
  let el = doc.getElementById?.(id);
  if (!el) {
    el = doc.createElement('style');
    el.id = id;
    (doc.head || doc.documentElement).appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
  return el;
}

// aviso curto: dentro da camada compacta quando ela está à vista (o Toast do client pode ficar embaixo dela);
// senão o Toast do Pengu; sem nenhum dos dois, console. Na camada ele fica logo abaixo do topo e não pega clique
// (pointer-events:none): embaixo moram TRAVAR/BANIR e JOGAR, e o aviso de 4,5 s não pode tapar o botão da vez.
export function avisar(msg, erro = false, doc = globalThis.document) {
  const texto = String(msg ?? '');
  try {
    const camada = doc?.getElementById?.('lc-compacto');
    if (camada) {
      camada.querySelector?.('.lc-cp-aviso')?.remove();
      const el = h('div', { doc, class: 'lc-cp-aviso' + (erro ? ' lc-cp-erro' : ''), role: 'status' }, texto);
      // dentro da coluna compacta (passo 13: com a lateral aberta a camada tem 1080+ px; o aviso fica sobre a coluna)
      let alvo = null;
      try { alvo = camada.querySelector?.('.lc-cp-coluna') || null; } catch { alvo = null; }
      (alvo || camada).appendChild(el);
      setTimeout(() => el.remove(), 4500);
      return;
    }
  } catch { /* cai no Toast */ }
  try { (erro ? Toast.error : Toast.success)(texto); } catch { console.log('[lol-client] compacto:', texto); }
}

// vigia uma classe do <html> e chama aoSair() a cada vez que ela sai (tinha -> não tem). Ex.: lc-modo-compacto (a camada
// compacta saiu: expandido por ele, regra 7, erro). doc/MO injetáveis; sem MutationObserver vira no-op. -> {parar()}
export function vigiarClasse(classe, aoSair, { doc = globalThis.document, MO = globalThis.MutationObserver } = {}) {
  const el = doc?.documentElement;
  if (typeof MO !== 'function' || !el?.classList) return { parar() {} };
  let tinha = !!el.classList.contains(classe), vivo = true;
  const obs = new MO(() => {
    if (!vivo) return;
    const tem = !!el.classList.contains(classe);
    const saiu = tinha && !tem;
    tinha = tem;
    if (saiu) try { aoSair(); } catch (e) { console.error('[lol-client] vigiarClasse', e); }
  });
  obs.observe(el, { attributes: true, attributeFilter: ['class'] });
  return { parar() { if (vivo) { vivo = false; obs.disconnect(); } } };
}

// CSS base compartilhado pelas telas (mesmo visual do protótipo aprovado em 13/10/2026). Prefixo lc-cp- para não
// colidir com classe da Riot nem com as outras partes do plugin. Telas acrescentam o próprio CSS por estilo().
export const CSS_BASE = `
#lc-compacto { --lc-bg:#010a13; --lc-pan:#091428; --lc-pan2:#1e2328; --lc-linha:#3c3c41; --lc-linha2:#463714;
  --lc-ouro:#c8aa6e; --lc-ouro2:#f0e6d2; --lc-ouro-esc:#785a28; --lc-txt:#cdbe91; --lc-mudo:#a09b8c;
  --lc-azul:#0ac8b9; --lc-azul2:#0397ab; --lc-verm:#e84057; --lc-amarelo:#f2c14e; }
#lc-compacto .lc-cp-rot { font-size:10px; letter-spacing:.12em; text-transform:uppercase; color:var(--lc-mudo); margin-top:2px; }
#lc-compacto .lc-cp-nota { font-size:11.5px; color:var(--lc-mudo); }
#lc-compacto .lc-cp-dica { background:linear-gradient(90deg,rgba(10,200,185,.12),rgba(10,200,185,0)); border-left:3px solid var(--lc-azul);
  padding:7px 10px; font-size:12.5px; color:var(--lc-ouro2); }
#lc-compacto .lc-cp-btn { background:var(--lc-pan2); border:1px solid var(--lc-ouro-esc); color:var(--lc-ouro2); padding:8px 12px;
  font-family:inherit; font-weight:600; font-size:13px; line-height:1.2; letter-spacing:.04em; cursor:pointer; }
#lc-compacto .lc-cp-btn:hover { border-color:var(--lc-ouro); }
#lc-compacto .lc-cp-btn.lc-cp-prim { background:linear-gradient(180deg,#1e5a6b,#0b3a49); border-color:var(--lc-azul2); }
#lc-compacto .lc-cp-btn.lc-cp-verm { border-color:#8a2a38; color:#ffd3d9; }
#lc-compacto .lc-cp-btn[disabled], #lc-compacto .lc-cp-btn.lc-cp-cinza { filter:grayscale(1) brightness(.7); cursor:not-allowed; }
#lc-compacto .lc-cp-foto { display:inline-grid; place-items:center; border-radius:50%; flex:none; border:1.5px solid var(--lc-ouro-esc);
  background:#151b22 center/cover no-repeat; color:#fff; font-weight:700; font-size:12px; }
#lc-compacto .lc-cp-aviso { position:absolute; left:10px; right:10px; top:52px; bottom:auto; z-index:5; padding:8px 10px; font-size:12.5px;
  background:#1e2328; border:1px solid var(--lc-ouro-esc); color:var(--lc-ouro2); box-shadow:0 4px 18px rgba(0,0,0,.6); pointer-events:none; }
#lc-compacto .lc-cp-aviso.lc-cp-erro { border-color:var(--lc-verm); }
`;
