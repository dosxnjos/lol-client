// Menu do clique direito, diálogos de confirmação e campo de uma linha da lista de amigos do compacto (etapa 2 de
// roadmap/2026-10-16-compacto-chat-amigos-perfil.md). Só desenho: o que cada item faz (e as rotas da Riot) é de compacto/lateral.js
// e compacto/amigos.js. Os três moram no ".lc-lt-sobre" da lista, AO LADO do corpo que o relógio recria (ARMADILHAS "Campo de
// texto ou botão recriado"), e cada botão passa o evento do clique adiante: quem escreve na LCU confere isTrusted.
// Importável no node: nada de DOM no topo.
import { h, icone } from './comum.js';

// clique direito dentro do diálogo/campo: nem o menu do navegador nem o da lista (cortar só a subida pulava quem, no document,
// suprime o menu nativo do CEF; revisão de 16/10/2026)
const ignorar = e => { e.preventDefault?.(); e.stopPropagation?.(); };

// menu -> {el, abrir(itens, {chave, topo}), atualizar(itens), fechar(), aberto(), chave()}. itens = amigos.itensMenu(...) ou
// itensMenuGrupo(...): [{a, rotulo, off, motivo, perigo, sub:[{id, rotulo, off}]}]. Item cinza não faz nada (o motivo vai no title).
export function criarMenu({ doc, seguro, aoEscolher, aoFechar }) {
  let chave = null, itens = [], subAberto = false, origem = null;
  const el = h('div', { doc, class: 'lc-lt-menu', role: 'menu', dataset: { a: 'lt-menu' }, style: { display: 'none' } });
  el.addEventListener('keydown', seguro(e => {
    e.stopPropagation?.(); // as teclas do menu não vão para os atalhos da Riot
    if (e.key === 'Escape') {
      // Esc devolve o foco a quem abriu o menu (a linha ou o cabeçalho; a lista não repinta com o menu aberto, então ela segue viva)
      e.preventDefault?.();
      const volta = origem;
      fechar();
      try { if (volta?.isConnected !== false) volta?.focus?.({ preventScroll: true }); } catch { /* sem DOM */ }
    }
  }));
  el.addEventListener('contextmenu', e => { e.preventDefault?.(); e.stopPropagation?.(); });
  const botao = (it, extra = {}) => h('button', { doc, class: 'lc-lt-mi' + (it.off ? ' lc-lt-off' : '') + (it.perigo ? ' lc-lt-perigo' : ''), role: 'menuitem',
    'aria-disabled': it.off ? 'true' : undefined, title: it.motivo || undefined, dataset: { a: `lt-m-${it.a}`, ...extra.dataset },
    on: { click: seguro(e => { e.stopPropagation?.(); if (it.off) return; extra.click ? extra.click(e) : aoEscolher?.(it, null, e); }) } }, it.rotulo, extra.depois || null);
  function desenhar() {
    const filhos = [];
    for (const it of itens) {
      if (it.sub) {
        filhos.push(botao(it, { depois: h('span', { doc, class: 'lc-lt-mseta' }, ' ', icone(subAberto ? 'aberto' : 'fechado', { doc, tam: 12 })), click: () => { subAberto = !subAberto; desenhar(); } }));
        if (subAberto) filhos.push(h('div', { doc, class: 'lc-lt-msub', role: 'menu' }, ...it.sub.map(s => h('button', { doc, class: 'lc-lt-mi' + (s.off ? ' lc-lt-off' : ''),
          role: 'menuitem', 'aria-disabled': s.off ? 'true' : undefined, dataset: { a: 'lt-m-mover-para', gid: String(s.id) },
          on: { click: seguro(e => { e.stopPropagation?.(); if (s.off) return; aoEscolher?.(it, s, e); }) } }, s.rotulo))));
      } else filhos.push(botao(it));
    }
    el.replaceChildren(...filhos);
  }
  function abrir(lista, { chave: k = null, topo = 0, origem: o = null } = {}) {
    chave = k; itens = Array.isArray(lista) ? lista : []; subAberto = false; origem = o;
    el.style.top = `${Math.max(0, Math.round(Number(topo) || 0))}px`;
    el.style.display = '';
    desenhar();
    try { el.querySelector?.('button:not([aria-disabled])')?.focus?.({ preventScroll: true }); } catch { /* sem DOM */ }
  }
  function atualizar(lista) { if (chave === null) return; itens = Array.isArray(lista) ? lista : []; desenhar(); }
  function fechar() {
    if (chave === null && el.style.display === 'none') return;
    chave = null; itens = []; origem = null; el.style.display = 'none'; el.replaceChildren();
    aoFechar?.();
  }
  return { el, abrir, atualizar, fechar, aberto: () => chave !== null, chave: () => chave };
}

// diálogo de confirmação (o DialogConfirm da Riot dentro da lista) -> {el, abrir(def), fechar(), aberto()}.
// def = {titulo, texto, nome (aparece em destaque no lugar de {{name}}), caixa: {rotulo, marcada} | null, botoes: [{a, rotulo,
// perigo, acao(ev, marcada)}]}. ✕ e Esc fecham sem nada; cada botão fecha e chama a acao com o evento do clique.
export function criarDialogo({ doc, seguro, aoFechar }) {
  let aberto = false;
  const el = h('div', { doc, class: 'lc-lt-dlg', role: 'alertdialog', dataset: { a: 'lt-dialogo' }, style: { display: 'none' } });
  el.addEventListener('keydown', seguro(e => { e.stopPropagation?.(); if (e.key === 'Escape') { e.preventDefault?.(); fechar(); } }));
  el.addEventListener('contextmenu', ignorar);
  function fechar() { if (!aberto) return; aberto = false; el.style.display = 'none'; el.replaceChildren(); aoFechar?.(); }
  function abrir({ titulo = '', texto = '', nome = '', caixa = null, botoes = [] } = {}) {
    aberto = true;
    const [antes, depois] = String(texto).split('{{name}}');
    const corpoTexto = h('p', { doc, class: 'lc-lt-dtx' }, antes, depois !== undefined ? h('b', { doc }, nome) : null, depois ?? null);
    const cx = caixa ? h('input', { doc, type: 'checkbox', dataset: { a: 'lt-dlg-caixa' } }) : null;
    if (cx) cx.checked = !!caixa.marcada;
    const bts = botoes.map(b => h('button', { doc, class: 'lc-cp-btn' + (b.perigo ? ' lc-cp-verm' : b.prim ? ' lc-cp-prim' : ''), dataset: { a: `lt-dlg-${b.a}` },
      on: { click: seguro(e => { const m = cx ? !!cx.checked : false; fechar(); return b.acao?.(e, m); }) } }, b.rotulo));
    el.replaceChildren(h('div', { doc, class: 'lc-lt-dcx' },
      h('header', { doc, class: 'lc-lt-dcab' }, h('b', { doc }, titulo),
        h('button', { doc, class: 'lc-lt-x', title: 'fechar sem fazer nada', 'aria-label': 'fechar sem fazer nada', dataset: { a: 'lt-dlg-fechar' },
          on: { click: seguro(e => { e.stopPropagation?.(); fechar(); }) } }, icone('fechar', { doc, tam: 14 }))),
      corpoTexto,
      cx ? h('label', { doc, class: 'lc-lt-dcaixa' }, cx, ' ', caixa.rotulo) : null,
      h('div', { doc, class: 'lc-lt-dbts' }, ...bts)));
    el.style.display = '';
    try { el.querySelector?.('button')?.focus?.({ preventScroll: true }); } catch { /* sem DOM */ }
  }
  return { el, abrir, fechar, aberto: () => aberto };
}

// campo de uma linha (anotação do amigo, nome da pasta) -> {el, input, abrir(def), fechar(), aberto()}.
// def = {titulo, valor, placeholder, max, validar(v) -> '' | 'igual' | motivo, aoConfirmar(v, ev)}. Enter confirma, Esc cancela.
export function criarCampo({ doc, seguro, aoFechar }) {
  let def = null;
  const tit = h('small', { doc }, '');
  const input = h('input', { doc, class: 'lc-lt-busca', autocomplete: 'off', spellcheck: 'false', dataset: { a: 'lt-campo' } });
  const erro = h('small', { doc, class: 'lc-lt-cerro' }, '');
  const ok = h('button', { doc, class: 'lc-cp-btn lc-cp-prim', dataset: { a: 'lt-campo-ok' }, on: { click: seguro(e => confirmar(e)) } }, 'salvar');
  const el = h('div', { doc, class: 'lc-lt-campo', dataset: { a: 'lt-campo-cx' }, style: { display: 'none' } }, tit,
    h('div', { doc, class: 'lc-lt-en lc-lt-cen' }, input, ok,
      h('button', { doc, class: 'lc-lt-x', title: 'cancelar', 'aria-label': 'cancelar', dataset: { a: 'lt-campo-cancelar' }, on: { click: seguro(() => fechar()) } },
        icone('fechar', { doc, tam: 14 }))), erro);
  input.addEventListener('keydown', seguro(e => {
    e.stopPropagation?.(); // teclas do campo não vão para os atalhos da Riot
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault?.(); return confirmar(e); }
    if (e.key === 'Escape') { e.preventDefault?.(); fechar(); }
    return undefined;
  }));
  input.addEventListener('input', () => { erro.textContent = ''; });
  el.addEventListener('contextmenu', ignorar);
  function confirmar(e) {
    if (!def) return undefined;
    const v = String(input.value ?? '');
    const motivo = def.validar ? def.validar(v) : '';
    if (motivo === 'igual') { fechar(); return undefined; }
    if (motivo) { erro.textContent = motivo; return undefined; }
    const fn = def.aoConfirmar;
    fechar();
    return fn?.(v, e);
  }
  function abrir(d) {
    def = d || {};
    tit.textContent = def.titulo || '';
    input.value = def.valor || '';
    input.placeholder = def.placeholder || '';
    if (def.max) input.setAttribute('maxlength', String(def.max)); else input.removeAttribute?.('maxlength');
    erro.textContent = '';
    el.style.display = '';
    try { input.focus({ preventScroll: true }); input.select?.(); } catch { /* sem DOM */ }
  }
  function fechar() { if (!def) return; def = null; el.style.display = 'none'; aoFechar?.(); }
  return { el, input, abrir, fechar, confirmar, aberto: () => !!def };
}

export const CSS_AMIGOS = `
#lc-compacto .lc-lt-amigos { position:relative; }
#lc-compacto .lc-lt-npasta { font-size:15px; }
#lc-compacto .lc-lt-npasta:disabled { opacity:.35; cursor:default; }
#lc-compacto .lc-lt-gcab { display:flex; align-items:baseline; gap:2px; cursor:pointer; user-select:none; border-top:2px solid transparent; border-bottom:2px solid transparent; }
#lc-compacto .lc-lt-gcab:hover { color:var(--lc-ouro2); }
#lc-compacto .lc-lt-gcab small { font-size:10px; letter-spacing:0; color:var(--lc-mudo); }
#lc-compacto .lc-lt-gcab .lc-lt-seta { width:12px; display:inline-grid; place-items:center; }
#lc-compacto .lc-lt-gcab.lc-lt-antes { border-top-color:var(--lc-azul); }
#lc-compacto .lc-lt-gcab.lc-lt-depois { border-bottom-color:var(--lc-azul); }
#lc-compacto .lc-lt-gcab.lc-lt-alvo { background:rgba(10,200,185,.10); color:var(--lc-ouro2); }
#lc-compacto .lc-lt-amigo:focus-visible, #lc-compacto .lc-lt-gcab:focus-visible { outline:1px solid var(--lc-ouro-esc); outline-offset:-1px; }
#lc-compacto .lc-lt-amigo.lc-lt-arrastando { opacity:.45; }
#lc-compacto .lc-lt-sobre { position:absolute; left:0; right:0; top:46px; bottom:0; pointer-events:none; }
#lc-compacto .lc-lt-sobre > * { pointer-events:auto; }
#lc-compacto .lc-lt-menu { position:absolute; left:10px; right:10px; z-index:3; background:#010a13; border:1px solid var(--lc-ouro-esc); box-shadow:0 6px 18px rgba(0,0,0,.6);
  padding:4px 0; display:flex; flex-direction:column; max-height:calc(100% - 8px); overflow:auto; }
#lc-compacto .lc-lt-mi { display:block; width:100%; text-align:left; background:none; border:none; font:inherit; font-size:12.5px; color:var(--lc-ouro2); padding:6px 12px; cursor:pointer; }
#lc-compacto .lc-lt-mi:hover, #lc-compacto .lc-lt-mi:focus-visible { background:rgba(200,170,110,.12); outline:none; }
#lc-compacto .lc-lt-mi.lc-lt-perigo { color:#ff8a96; }
#lc-compacto .lc-lt-mi.lc-lt-off { color:#5b5a56; cursor:help; }
#lc-compacto .lc-lt-mi.lc-lt-off:hover { background:none; }
#lc-compacto .lc-lt-msub { border-left:2px solid var(--lc-linha); margin:0 0 2px 14px; }
#lc-compacto .lc-lt-msub .lc-lt-mi { font-size:11.5px; letter-spacing:.06em; padding:4px 10px; }
#lc-compacto .lc-lt-dlg { position:absolute; inset:0; z-index:4; background:rgba(1,10,19,.82); display:flex; align-items:flex-start; justify-content:center; padding-top:30px; }
#lc-compacto .lc-lt-dcx { width:calc(100% - 24px); background:#010a13; border:1px solid var(--lc-ouro-esc); padding:10px 12px 12px; box-shadow:0 8px 24px rgba(0,0,0,.7); }
#lc-compacto .lc-lt-dcab { display:flex; align-items:center; gap:8px; }
#lc-compacto .lc-lt-dcab b { flex:1; color:var(--lc-ouro2); font-size:13px; }
#lc-compacto .lc-lt-dtx { margin:8px 0; font-size:12px; line-height:1.4; color:#cdbe91; }
#lc-compacto .lc-lt-dtx b { color:var(--lc-ouro2); }
#lc-compacto .lc-lt-dcaixa { display:flex; align-items:center; gap:4px; font-size:12px; color:var(--lc-ouro2); margin:4px 0 8px; cursor:pointer; }
#lc-compacto .lc-lt-dbts { display:flex; gap:6px; flex-wrap:wrap; }
#lc-compacto .lc-lt-dbts .lc-cp-btn { flex:1 1 auto; height:auto; min-height:28px; padding:4px 8px; white-space:nowrap; font-size:12px; letter-spacing:0; }
#lc-compacto .lc-lt-campo { position:absolute; left:0; right:0; top:0; z-index:3; background:#050d17; border-bottom:1px solid var(--lc-ouro-esc); padding:6px 10px 6px; }
#lc-compacto .lc-lt-campo > small { display:block; font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--lc-mudo); margin-bottom:4px; }
#lc-compacto .lc-lt-cen { padding:0; border:none; align-items:center; }
#lc-compacto .lc-lt-cen .lc-cp-btn { height:28px; padding:0 10px; }
#lc-compacto .lc-lt-cerro { display:block; font-size:11px; color:#ffb3bd; min-height:0; }
#lc-compacto .lc-cp-coluna.lc-lt-solta-ok { outline:2px dashed var(--lc-azul); outline-offset:-4px; }
#lc-compacto .lc-cp-coluna.lc-lt-solta-nao { outline:2px dashed #5b5a56; outline-offset:-4px; }
#lc-compacto .lc-lt-solta-dica { position:absolute; left:16px; right:16px; bottom:16px; z-index:6; pointer-events:none; text-align:center; padding:8px 10px;
  background:rgba(1,10,19,.92); border:1px solid var(--lc-linha); color:var(--lc-ouro2); font-size:12px; }
#lc-compacto .lc-cp-coluna.lc-lt-solta-ok .lc-lt-solta-dica { border-color:var(--lc-azul); }
`;
