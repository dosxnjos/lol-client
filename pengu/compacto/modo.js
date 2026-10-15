// Troca de modo do client compacto (roadmap/2026-10-13-client-compacto.md, passo 2): tamanho da janela pelo
// riotInvoke, a camada #lc-compacto por cima da tela da Riot, o botão "modo compacto" no client normal e o atalho.
// Quem decide QUANDO compactar ou expandir é o roteador (index.js); aqui só o COMO.
// Importável no node (tools/teste-compacto.mjs): nada de window/document no topo do módulo.
//
// Medido no client 16.20 (13/10/2026, leitura dos scripts da Riot por GET na própria página):
// - Window.ResizeTo [w, h] em px CSS; a viewport da Riot (#rcp-fe-viewport-root) continua com 1280 e é cortada;
// - o plugin-runner da Riot volta ao normal com Window.ResizeTo [1280, 720] + Window.CenterToScreen (expandir = isso);
// - o "–" da Riot é Window.Minimize; o "✕" termina em RiotClient.Exit (rcp-fe-lol-navigation, _postAction).
import { h, CSS_BASE } from './comum.js';

export const EXPANDIDA = [1280, 720];
export const PADRAO_COMPACTA = [420, 680]; // mesmo padrão do config.js (compacto.larg/alt)
// limites da COLUNA compacta (compacto.larg/alt da config); a lateral (passo 13) soma à largura da janela por fora deles
const LIMITES = { larg: [360, 900], alt: [480, 1000] };
export const LATERAL_MAX = 1600; // painéis ao lado (esquerda + direita), px CSS: valor torto não estica a janela além disso
// boot (recarga do plugin, nada pedido ainda): conta como compacta a janela mais estreita que isto OU fora do formato 16:9 dos
// tamanhos da Riot (1024×576, 1280×720, 1600×900, 1920×1080): a janela de 1080×680 com a lateral aberta também é compacta
export const LARGURA_COMPACTA_MAX = 1000;
const formatoRiot = (w, hh) => hh > 0 && Math.abs(w / hh - 16 / 9) < 0.03;

// tamanho da janela compacta pela config, com limites (valor torto salvo não esconde o client). extra = largura da lateral
// (px CSS, do roteador; nunca da config)
export function tamanho(larg, alt, extra = 0) {
  const ok = (v, [min, max], pad) => (Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max ? Math.round(Number(v)) : pad);
  const lat = Number.isFinite(Number(extra)) ? Math.min(Math.max(Math.round(Number(extra)), 0), LATERAL_MAX) : 0;
  return [ok(larg, LIMITES.larg, PADRAO_COMPACTA[0]) + lat, ok(alt, LIMITES.alt, PADRAO_COMPACTA[1])];
}

// riotInvoke não é gravável nem configurável, mas é chamável (ARMADILHAS § Client). -> fn(nome, params) -> bool
export function invocadorRiot(alvo = globalThis.window, log = (...a) => console.error('[lol-client] compacto', ...a)) {
  const invocar = (nome, params = []) => {
    const f = alvo?.riotInvoke;
    if (typeof f !== 'function') return false;
    try { f.call(alvo, { request: JSON.stringify({ name: nome, params }) }); return true; } catch (e) { log(nome, e); return false; }
  };
  invocar.existe = () => typeof alvo?.riotInvoke === 'function';
  return invocar;
}

// folga depois do meu ResizeTo antes de acreditar numa medida grande (o innerWidth pode demorar a acompanhar)
export const GRACA_MEDIDA_MS = 1500;

// janela do client. medir() -> [innerWidth, innerHeight] (px CSS); agora() -> ms (teste)
export function criarJanela({ invocar, medir = () => [globalThis.innerWidth, globalThis.innerHeight], agora = () => Date.now() }) {
  let compacta = null, pedidoEm = 0, pedido = null; // o que eu pedi por último (null = ainda não mexi), quando e o tamanho
  // pequena = eu encolhi OU a medida diz pequena: na dúvida conta como pequena, porque daí o caminho é expandir
  // (janela de 420 sem camada é o client inutilizável que não pode acontecer). Exceção: eu encolhi, mas depois da folga a
  // largura medida não é a que eu pedi (±8) e é de client normal (≥ 1000) = a própria Riot devolveu o tamanho dela (restore
  // do plugin-runner, ux-show do aceite.js [S]): deixa de contar como compacta e o roteador encolhe de novo. Desde o passo 13
  // a janela compacta pode ter 1080 ou mais (lateral aberta): "compacta" é a medida bater com o PEDIDO, não ser < 1000 px
  // (a regra antiga reencolhia a lateral em < 2 s). Só a largura decide: a altura do client não muda com a lateral.
  const ehCompacta = () => {
    const m = medir?.() || [];
    const w = Number(m[0]), hh = Number(m[1]);
    const medida = Number.isFinite(w) && w > 0;
    if (compacta === true) {
      // + formato 16:9 (revisão de 14/10/2026): o tamanho que a Riot devolve é sempre dela (1280×720...); um ResizeTo que só
      // não caiu no pedido (arredondamento, unidade [S]) com a lateral aberta não pode disparar 3 reencolhidas e expandir
      const devolvida = medida && w >= LARGURA_COMPACTA_MAX && formatoRiot(w, hh) && pedido && Math.abs(w - pedido[0]) > 8 && agora() - pedidoEm > GRACA_MEDIDA_MS;
      if (devolvida) { compacta = false; return false; }
      return true;
    }
    return medida && (w < LARGURA_COMPACTA_MAX || (hh > 0 && !formatoRiot(w, hh)));
  };
  // janela pequena mas fora do tamanho pedido (ex.: 640 de antes de 14/10/2026 depois de recarregar o plugin; lateral que
  // mudou): sem medida = não sei, conta como certa (não fica pedindo ResizeTo). extra = lateral (px CSS)
  const noTamanho = (larg, alt, extra = 0) => {
    const [w, hh] = tamanho(larg, alt, extra);
    const m = medir?.() || [];
    const mw = Number(m[0]), mh = Number(m[1]);
    if (!(mw > 0) || !(mh > 0)) return true;
    return Math.abs(mw - w) <= 8 && Math.abs(mh - hh) <= 8;
  };
  return {
    disponivel: () => (typeof invocar?.existe === 'function' ? invocar.existe() : typeof invocar === 'function'),
    ehCompacta,
    noTamanho,
    // extra: largura da lateral (passo 13), somada à coluna da config
    compactar(larg, alt, extra = 0) {
      const [w, hh] = tamanho(larg, alt, extra);
      const ok = invocar('Window.ResizeTo', [w, hh]);
      if (ok) { compacta = true; pedidoEm = agora(); pedido = [w, hh]; }
      return ok;
    },
    pedido: () => (pedido ? [...pedido] : null),
    // arrastar a janela compacta pelo topo (Window.MoveTo [x, y]; unidade [S]: medir no passo 9)
    mover: (x, y) => invocar('Window.MoveTo', [Math.round(x), Math.round(y)]),
    expandir() {
      const ok = invocar('Window.ResizeTo', [...EXPANDIDA]);
      if (ok) { invocar('Window.CenterToScreen', []); compacta = false; }
      return ok;
    },
    minimizar: () => invocar('Window.Minimize', []),
    sair: () => invocar('RiotClient.Exit', []),
  };
}

// Ctrl+Shift+M: nenhum script da Riot trata essa combinação (grep dos 40 rcp-fe em 13/10/2026: nem keyCode 77, nem
// KeyM, nem ctrl+shift). Com o foco dentro do iframe do chat o keydown não chega à página (ARMADILHAS § Client).
export function ehAtalho(e) {
  if (!e || !e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return false;
  return e.code === 'KeyM' || String(e.key || '').toLowerCase() === 'm';
}

// Arrastar a janela compacta pelo topo da camada (a camada cobre a barra da Riot, que é por onde a janela normal
// arrasta). Medido 13/10/2026: nenhuma regra -webkit-app-region no CSS da Riot; Window.MoveTo existe no uikit.
// posição nova = posição da janela no início + quanto o ponteiro andou na tela (screenX/Y). Unidade do MoveTo e do
// window.screenX [S] (outerWidth vem em px físicos, innerWidth em CSS): limites() mantém um pedaço do topo à vista e
// "⤢ expandir" recentra (CenterToScreen), então nunca some de vez. Clique em botão do topo não arrasta.
// Passo 13 (revisão de 14/10/2026): escala() converte o quanto o ponteiro andou (px da página) para a unidade da posição
// (px físicos do ScreenData: × zoomScale; [S] medir no client, ARMADILHAS § Client); aoSoltar() no fim do arrasto (a geometria
// relê a posição).
export function criarArrasto({ posicao, mover, limites, raf = fn => setTimeout(fn, 16), escala = () => 1, aoSoltar = () => {} }) {
  let ini = null, alvo = null, agendado = false;
  const prender = (v, min, max) => (Number.isFinite(min) && Number.isFinite(max) && max >= min ? Math.min(Math.max(v, min), max) : v);
  const down = e => {
    if (!e || (e.button !== undefined && e.button !== 0)) return false;
    try { if (e.target?.closest?.('button, input, [data-a]')) return false; } catch { /* segue */ }
    const p = posicao?.() || [];
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(e.screenX) || !Number.isFinite(e.screenY)) return false;
    let k = 1;
    try { k = Number(escala?.()) || 1; } catch { k = 1; }
    ini = { sx: e.screenX, sy: e.screenY, wx: p[0], wy: p[1], k: k > 0 ? k : 1 };
    try { e.currentTarget?.setPointerCapture?.(e.pointerId); } catch { /* sem captura: move só dentro do topo */ }
    return true;
  };
  const move = e => {
    if (!ini || !Number.isFinite(e?.screenX) || !Number.isFinite(e?.screenY)) return;
    const L = limites?.() || {};
    alvo = [prender(ini.wx + (e.screenX - ini.sx) * ini.k, L.minX, L.maxX), prender(ini.wy + (e.screenY - ini.sy) * ini.k, L.minY, L.maxY)];
    if (agendado) return;
    agendado = true;
    raf(() => { agendado = false; if (alvo) try { mover(alvo[0], alvo[1]); } catch { /* segue */ } });
  };
  const up = () => { const era = !!ini; ini = null; if (era) try { aoSoltar?.(); } catch { /* segue */ } };
  return { down, move, up, ativo: () => !!ini };
}

// Camada por cima da tela da Riot: topo (título da tela, extras, expandir, –, ✕) + corpo. Abaixo do #lc-aceite
// (100002) e do mesmo nível do #lc-runas/#lc-winrate, que somem com html.lc-modo-compacto (CSS_MODO).
// avisoFechar() -> texto da confirmação do ✕ (no champ select fala do dodge). O ✕ pede um 2º clique.
// arrasto: criarArrasto() (opcional): o topo arrasta a janela.
// Passo 13: a camada é uma LINHA [painel da esquerda (configurações)] [coluna compacta] [painéis da direita (chat, coach)]. A
// coluna é a tela de sempre (topo + corpo), com position:relative: aviso, alerta, denúncia e cartão do jogador ficam presos a
// ela, nunca esticados pela janela inteira. larguras({esq, col, dir}) põe as variáveis --lc-cp-esq/--lc-cp-col na camada e no
// <html> (o #lc-aceite fica sobre a coluna). Quem enche os painéis é a lateral (compacto/lateral.js).
export function criarCamada({ doc = globalThis.document, aoExpandir, aoMinimizar, aoFechar, avisoFechar = () => 'fechar o client?', arrasto = null }) {
  let el = null, partes = null, medidas = { esq: 0, col: PADRAO_COMPACTA[0], dir: 0 };
  const porVariaveis = () => {
    const alvos = [el, doc.documentElement].filter(Boolean);
    for (const a of alvos) try {
      a.style?.setProperty?.('--lc-cp-esq', medidas.esq + 'px');
      a.style?.setProperty?.('--lc-cp-col', medidas.col + 'px');
      a.style?.setProperty?.('--lc-cp-dir', medidas.dir + 'px');
    } catch { /* sem style */ }
  };
  const fecharAlerta = () => el?.querySelector?.('.lc-cp-alerta')?.remove();
  const pedirFechar = () => {
    if (!el) return;
    if (el.querySelector?.('.lc-cp-alerta')) return;
    const alerta = h('div', { doc, class: 'lc-cp-alerta', role: 'alertdialog' },
      h('div', { doc }, String(avisoFechar() || 'fechar o client?')),
      h('div', { doc, class: 'lc-cp-bts' },
        h('button', { doc, class: 'lc-cp-btn lc-cp-verm', dataset: { a: 'fechar-sim' }, on: { click: () => { fecharAlerta(); aoFechar?.(); } } }, 'fechar mesmo assim'),
        h('button', { doc, class: 'lc-cp-btn', dataset: { a: 'fechar-nao' }, on: { click: fecharAlerta } }, 'voltar')));
    // logo abaixo do topo, por cima do conteúdo da tela (dentro da coluna)
    const pai = partes.coluna || el;
    pai.insertBefore ? pai.insertBefore(alerta, partes.raiz) : pai.appendChild(alerta);
  };
  // a Riot, no boot, tira a camada do <body> e põe uma CÓPIA sem ouvintes (14/10/2026: tela parada em "lendo o
  // lobby", botões mortos; ARMADILHAS § Client). conectada() = a camada à vista é a minha
  const conectada = () => !!el && el.isConnected !== false && doc.getElementById?.('lc-compacto') === el;
  const montar = () => {
    if (conectada()) return partes;
    // sobra de outra carga do plugin ou cópia feita pela Riot: todas saem
    for (const velho of doc.querySelectorAll?.('#lc-compacto') || []) velho.remove();
    doc.getElementById?.('lc-compacto')?.remove();
    const titulo = h('div', { doc, class: 'lc-cp-titulo' });
    const extras = h('div', { doc, class: 'lc-cp-extras' });
    const raiz = h('main', { doc, class: 'lc-cp-corpo' });
    const arrastar = arrasto ? {
      pointerdown: e => arrasto.down(e), pointermove: e => arrasto.move(e), pointerup: e => arrasto.up(e), pointercancel: e => arrasto.up(e),
    } : undefined;
    const esq = h('aside', { doc, class: 'lc-cp-esq', dataset: { lado: 'esq' } });
    const dir = h('aside', { doc, class: 'lc-cp-dir', dataset: { lado: 'dir' } });
    const coluna = h('div', { doc, class: 'lc-cp-coluna' },
      h('header', { doc, class: 'lc-cp-topo' + (arrasto ? ' lc-cp-arrasta' : ''), title: arrasto ? 'arraste por aqui para mover a janela' : undefined, on: arrastar }, titulo,
        h('div', { doc, class: 'lc-cp-acoes' }, extras,
          h('button', { doc, class: 'lc-cp-ic lc-cp-exp', title: 'client normal (Ctrl+Shift+M)', dataset: { a: 'expandir' }, on: { click: () => aoExpandir?.() } }, '⤢ expandir'),
          h('button', { doc, class: 'lc-cp-win', title: 'minimizar', dataset: { a: 'minimizar' }, on: { click: () => aoMinimizar?.() } }, '–'),
          h('button', { doc, class: 'lc-cp-win', title: 'fechar o client', dataset: { a: 'fechar' }, on: { click: pedirFechar } }, '✕'))),
      raiz);
    el = h('div', { doc, id: 'lc-compacto', role: 'dialog', 'aria-label': 'client compacto' }, esq, coluna, dir);
    doc.body.appendChild(el);
    partes = { raiz, titulo, extras, camada: el, coluna, esq, dir };
    porVariaveis();
    return partes;
  };
  const remover = () => { el?.remove(); el = null; partes = null; };
  // larguras dos três pedaços (px CSS; o roteador é o dono: index.js est.lateral)
  const larguras = m => { medidas = { esq: Math.max(0, Number(m?.esq) || 0), col: Math.max(0, Number(m?.col) || PADRAO_COMPACTA[0]), dir: Math.max(0, Number(m?.dir) || 0) }; porVariaveis(); };
  // painel da esquerda invisível enquanto a janela anda (geometria: o quadro da corrida CSS x MoveTo mostra fundo, nunca as
  // configurações no lugar da coluna). Só a esquerda: a coluna nunca some
  let mudando = false;
  const mudar = on => { mudando = !!on; try { el?.classList?.toggle?.('lc-cp-mudando', mudando); } catch { /* sem DOM */ } };
  return { montar, remover, existe: () => !!el, conectada, partes: () => partes, pedirFechar, larguras, medidas: () => ({ ...medidas }),
    mudando: mudar, estaMudando: () => mudando };
}

// Botão "▣ modo compacto" no client normal, ao lado da fila rápida (protótipo tela 6). Mesmo padrão do
// fila-rapida.js: âncora .navbar_backdrop (pointer-events: none com o lobby aberto: o botão liga o próprio),
// reinjeção por MutationObserver + rAF. Posição: logo depois do #lc-fila-rapida (o texto dele muda de largura:
// "buscar mesmo assim?"); a barra .left-nav-menu anda pela variável --lc-cp-nav (medido 13/10/2026: a barra
// começa em 253 px sem margem; a fila rápida ocupa 251..362).
// Onde a barra não existe ou não aparece (a seleção de campeões da Riot não mostra a .navbar_backdrop; o roteador
// pede flutuante no ChampSelect), o botão vira FLUTUANTE: fixo no alto à direita, antes da engrenagem e do – ✕ da
// Riot (posição [S], conferir no passo 9). Sem ele, quem expandiu na seleção só voltava pelo Ctrl+Shift+M, que não
// chega à página com o foco no chat (ARMADILHAS § Client).
export const NAV_BASE = 253;
export function criarBotaoModo({ doc = globalThis.document, aoClicar, raf = fn => setTimeout(fn, 16) }) {
  let visivel = false, flutuante = false, obs = null;
  const ID = 'lc-botao-compacto';
  const posicionar = () => {
    const b = doc.getElementById?.(ID);
    if (!b || b.dataset?.modo !== 'barra') return;
    const fila = doc.getElementById?.('lc-fila-rapida');
    const filaW = fila ? Number(fila.offsetWidth) || 0 : 0;
    const left = filaW > 0 ? (Number(fila.offsetLeft) || 251) + filaW + 6 : 250;
    b.style.left = left + 'px';
    const fim = left + (Number(b.offsetWidth) || 140) + 8;
    try { doc.documentElement.style.setProperty('--lc-cp-nav', Math.max(0, fim - NAV_BASE) + 'px'); } catch { /* sem style */ }
  };
  const modoQuerido = () => (!flutuante && doc.querySelector?.('.navbar_backdrop') ? 'barra' : 'flutua');
  const criar = modo => {
    const pai = modo === 'barra' ? doc.querySelector?.('.navbar_backdrop') : doc.body;
    if (!pai) return null;
    const b = h('div', { doc, id: ID, class: modo === 'flutua' ? 'lc-cp-flutua' : undefined, dataset: { modo }, title: 'modo compacto (Ctrl+Shift+M)', role: 'button',
      on: { click: e => { e?.stopPropagation?.(); aoClicar?.(); } } }, '▣ modo compacto');
    pai.appendChild(b);
    posicionar();
    return b;
  };
  // v: mostrar o botão; flutuante: forçar o flutuante (ChampSelect) — sem o 2º argumento mantém o último pedido
  const sincronizar = (v, opcoes) => {
    visivel = !!v;
    if (opcoes && 'flutuante' in opcoes) flutuante = !!opcoes.flutuante;
    let b = doc.getElementById?.(ID);
    const modo = modoQuerido();
    if (b && (!visivel || b.dataset?.modo !== modo)) { b.remove(); b = null; }
    if (visivel && !b) b = criar(modo);
    else if (b) posicionar();
    // a barra .left-nav-menu só anda quando o botão está nela
    try { doc.documentElement.classList.toggle('lc-botao-compacto', visivel && b?.dataset?.modo === 'barra'); } catch { /* sem DOM */ }
  };
  const ligar = () => {
    if (obs || typeof MutationObserver === 'undefined' || !doc.body) return;
    let pendente = false;
    obs = new MutationObserver(() => {
      if (pendente) return;
      pendente = true;
      raf(() => {
        pendente = false;
        if (!visivel) return;
        const b = doc.getElementById(ID);
        if (!b || b.dataset?.modo !== modoQuerido()) sincronizar(true); else posicionar();
      });
    });
    obs.observe(doc.body, { childList: true, subtree: true, characterData: true });
  };
  return { sincronizar, ligar, posicionar, visivel: () => visivel, flutuante: () => doc.getElementById?.(ID)?.dataset?.modo === 'flutua' };
}

// CSS da camada e do botão (injetado por comum.estilo: o estilo.css é de outras frentes)
export const CSS_MODO = `
#lc-compacto { position:fixed; inset:0; z-index:100000; display:flex; flex-direction:row; overflow:hidden; box-sizing:border-box;
  background:#010a13; color:#cdbe91;
  font:13px/1.45 var(--font-body,"Segoe UI",sans-serif); user-select:none; }
#lc-compacto > .lc-cp-coluna { position:relative; flex:none; width:var(--lc-cp-col,420px); min-width:0; height:100%; display:flex; flex-direction:column;
  overflow:hidden; background:radial-gradient(120% 60% at 50% 0%,#0f2236 0%,#010a13 60%); }
#lc-compacto > .lc-cp-esq { flex:none; width:var(--lc-cp-esq,0px); height:100%; overflow:hidden; display:flex; }
#lc-compacto > .lc-cp-dir { flex:none; width:var(--lc-cp-dir,0px); height:100%; overflow:hidden; display:flex; }
/* só a direita some vazia: a esquerda vazia ainda ocupa a largura da variável até a geometria aplicar (senão, ao fechar ⚙, a
   coluna pulava para a esquerda antes do MoveTo; revisão de 14/10/2026). Variável 0 + overflow hidden = não ocupa nada */
#lc-compacto > .lc-cp-dir:empty { display:none; }
#lc-compacto.lc-cp-mudando > .lc-cp-esq > * { visibility:hidden; }
/* fundo da página no compacto: a sobra que a janela mostra ao alargar antes de a página pintar no tamanho novo sai escura [S] */
html.lc-modo-compacto { background:#010a13; }
#lc-compacto *, #lc-compacto *::before, #lc-compacto *::after { box-sizing:border-box; }
#lc-compacto ::-webkit-scrollbar { width:6px; height:6px; }
#lc-compacto ::-webkit-scrollbar-thumb { background:#463714; border-radius:3px; }
#lc-compacto ::-webkit-scrollbar-track { background:transparent; }
#lc-compacto .lc-cp-topo { height:46px; flex:none; display:flex; align-items:center; justify-content:space-between; gap:8px;
  padding:0 10px 0 12px; border-bottom:1px solid #463714; background:rgba(1,10,19,.85); }
#lc-compacto .lc-cp-titulo { display:flex; gap:8px; align-items:center; min-width:0; overflow:hidden; color:#f0e6d2; }
#lc-compacto .lc-cp-acoes, #lc-compacto .lc-cp-extras { display:flex; gap:6px; align-items:center; flex:none; }
#lc-compacto .lc-cp-ic { position:relative; display:inline-flex; align-items:center; gap:4px; height:28px; min-width:30px; padding:0 8px;
  background:#1e2328; border:1px solid #3c3c41; border-radius:4px; color:#f0e6d2; font-family:inherit; font-size:13px; cursor:pointer; }
#lc-compacto .lc-cp-ic:hover { border-color:#c8aa6e; }
#lc-compacto .lc-cp-ic.lc-cp-exp { border-color:#785a28; color:#c8aa6e; }
#lc-compacto .lc-cp-win { width:18px; padding:0; background:none; border:none; color:#a09b8c; font-family:inherit; font-size:13px;
  text-align:center; cursor:pointer; }
#lc-compacto .lc-cp-win:hover { color:#f0e6d2; }
#lc-compacto .lc-cp-corpo { flex:1; min-height:0; overflow:auto; padding:12px 14px; display:flex; flex-direction:column; gap:8px; }
#lc-compacto .lc-cp-alerta { flex:none; margin:8px 10px 2px; padding:8px 10px; border:1px solid #e84057; background:rgba(232,64,87,.12);
  font-size:12.5px; color:#f0e6d2; }
#lc-compacto .lc-cp-alerta .lc-cp-bts { display:flex; gap:8px; margin-top:7px; }
#lc-compacto .lc-cp-alerta .lc-cp-bts .lc-cp-btn { flex:1; padding:6px; }
html.lc-modo-compacto #lc-runas, html.lc-modo-compacto #lc-winrate, html.lc-modo-compacto #lc-posjogo { display:none !important; }
/* ready check no compacto: a contagem do aceite.js (z 100002) logo abaixo do topo, na largura da janela; a tela da fila
   desce o anel (lc-cp-anel-rc) para ela não cobrir o "partida encontrada" */
html.lc-modo-compacto #lc-aceite { top:54px; left:calc(var(--lc-cp-esq,0px) + 12px); right:auto; width:calc(var(--lc-cp-col,420px) - 24px);
  transform:none; justify-content:center; flex-wrap:wrap; box-sizing:border-box; }
/* Ctrl+K do Pengu (CommandBar: raiz fixed z-[99], lido no core.dll em 14/10/2026) por cima da camada; se o Pengu mudar as
   classes, a regra só deixa de casar e volta ao de antes (lista por baixo) */
html.lc-modo-compacto .fixed.top-0.left-0.z-\\[99\\] { z-index:100003 !important; }
#lc-botao-compacto { position:absolute; left:368px; top:24px; height:34px; padding:0 12px; box-sizing:border-box; z-index:2;
  display:flex; align-items:center; white-space:nowrap; cursor:pointer; user-select:none; pointer-events:auto;
  font:700 12px/1 var(--font-display); letter-spacing:.08em; text-transform:uppercase; color:#cdbe91;
  background:linear-gradient(180deg,#1e2328,#0f1317); border:2px solid transparent; border-image:linear-gradient(180deg,#c8aa6e,#785a28) 1; }
#lc-botao-compacto:hover { color:#f0e6d2; border-image:linear-gradient(180deg,#f0e6d2,#c8aa6e) 1; box-shadow:0 0 8px rgba(200,170,110,.35); }
html.lc-botao-compacto .left-nav-menu { margin-left:var(--lc-cp-nav,254px) !important; }
#lc-botao-compacto.lc-cp-flutua { position:fixed; left:auto; right:96px; top:4px; height:26px; padding:0 10px; z-index:100000; font-size:11px;
  box-shadow:0 2px 10px rgba(0,0,0,.6); }
#lc-compacto .lc-cp-topo.lc-cp-arrasta { cursor:move; touch-action:none; }
#lc-compacto .lc-cp-topo.lc-cp-arrasta button { cursor:pointer; }
`;
export const CSS = CSS_BASE + CSS_MODO;
