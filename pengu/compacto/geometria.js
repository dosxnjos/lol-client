// Onde a janela compacta fica na tela quando a lateral abre e fecha (roadmap/2026-10-13-client-compacto.md, passo 13; ajuste
// B1 do Gabriel, 14/10/2026: "configurações pode expandir para a esquerda. não esqueça de garantir que as janelas não se percam
// entre si ao serem abertas ou fechadas"). Configurações crescem para a ESQUERDA, chat para a DIREITA, e a coluna compacta
// fica parada no mesmo lugar da tela; a janela inteira nunca sai do monitor.
// Importável no node (tools/teste-compacto-lateral.mjs): nada de window/document no topo do módulo.
//
// Unidades (lido no rcp-fe-lol-uikit 16.20, 14/10/2026): Window.ResizeTo em px CSS; Window.MoveTo, screenX/Y e a área útil do
// Window.ScreenData em px FÍSICOS (o centerWithinMainWindow da Riot multiplica a largura CSS por zoomScale). ScreenData só sai
// pelo riotInvoke com onSuccess: JSON.parse(JSON.parse(resposta).result) = {screenX, screenY, screenAvailLeft, screenAvailTop,
// screenAvailWidth, screenAvailHeight, windowWidth, windowHeight, windowMinimized, zoomScale}. Minimizada: screenX −32000
// (ignorar). window.getScreenDetails() trava o eval (nunca usar). [S] ResizeTo manter o canto de cima à esquerda: depois de
// cada par a posição é relida e corrigida com MoveTo.

export const MINIMIZADA_X = -30000;
export const FOLGA_PX = 2; // diferença de posição que não vale um MoveTo (px físicos)

// ScreenData cru -> tela normalizada | null (sem os números ou minimizada)
export function normalizarTela(d) {
  if (!d || typeof d !== 'object') return null;
  const n = k => Number(d[k]);
  const t = { x: n('screenX'), y: n('screenY'), z: n('zoomScale') || 1, L: n('screenAvailLeft'), T: n('screenAvailTop'),
    W: n('screenAvailWidth'), H: n('screenAvailHeight'), minimizada: d.windowMinimized === true };
  if (![t.x, t.y, t.L, t.T, t.W, t.H].every(Number.isFinite) || !(t.W > 0) || !(t.H > 0) || !(t.z > 0)) return null;
  if (t.x <= MINIMIZADA_X || t.y <= MINIMIZADA_X) t.minimizada = true;
  return t;
}

// largura útil do monitor em px CSS (o que cabe de janela) | null
export const larguraUtilCss = t => (t ? Math.floor(t.W / t.z) : null);

// Posição nova da janela (px físicos). ancora = x da COLUNA na tela (físico) que ele escolheu; esq = largura CSS do painel
// da esquerda; larg/alt = tamanho CSS total da janela. A coluna fica na âncora; se a janela não cabe, anda o mínimo para
// dentro do monitor (a âncora não muda: quando a janela encolhe, volta para lá). -> {x, y, cabe}
export function posicaoAlvo({ tela: t, ancora, esq = 0, larg, alt, y = t?.y }) {
  const w = larg * t.z, hh = alt * t.z;
  let x = ancora - esq * t.z;
  const maxX = t.L + t.W - w;
  if (x > maxX) x = maxX;
  if (x < t.L) x = t.L; // a borda esquerda vence: o topo (arrastar, ✕) nunca sai da tela
  let ny = Number.isFinite(y) ? y : t.T;
  const maxY = t.T + t.H - hh;
  if (ny > maxY) ny = maxY;
  if (ny < t.T) ny = t.T;
  return { x: Math.round(x), y: Math.round(ny), cabe: w <= t.W + 0.5 };
}

// a janela com a nova largura cabe SEM mover? (decisão 1 do Gabriel: mensagem nova só abre a conversa se couber sem mover a
// janela). t = tela lida; esq igual (a direita cresce, a esquerda não anda)
export function cabeSemMover(t, larg) {
  if (!t || t.minimizada) return false;
  return t.x + larg * t.z <= t.L + t.W + 0.5;
}

// Le o ScreenData pelo riotInvoke (Promise). Sem riotInvoke (harness): reserva com window.screenX/screen.avail* × dpr. COM
// riotInvoke, timeout ou erro = null (revisão de 14/10/2026: no client screenX/screen.* misturam unidades, ARMADILHAS § Client;
// a reserva viraria um MoveTo fora do monitor): quem chama só redimensiona e não move nada.
export function lerTelaRiot(win = globalThis.window, { prazoMs = 800 } = {}) {
  return new Promise(resolve => {
    let feito = false;
    const fim = v => { if (!feito) { feito = true; resolve(v); } };
    const reserva = () => {
      try {
        const s = win?.screen || {};
        const z = Number(win?.devicePixelRatio) || 1;
        // fora do client (harness) tudo vem em px CSS: converte para "físico" com o dpr para a conta ser a mesma
        return normalizarTela({ screenX: Number(win?.screenX) * z, screenY: Number(win?.screenY) * z, zoomScale: z,
          screenAvailLeft: Number(s.availLeft ?? 0) * z, screenAvailTop: Number(s.availTop ?? 0) * z,
          screenAvailWidth: Number(s.availWidth) * z, screenAvailHeight: Number(s.availHeight) * z });
      } catch { return null; }
    };
    const f = win?.riotInvoke;
    if (typeof f !== 'function') { fim(reserva()); return; }
    const t = setTimeout(() => fim(null), prazoMs);
    try {
      f.call(win, { request: JSON.stringify({ name: 'Window.ScreenData', params: [] }), onSuccess(e) {
        clearTimeout(t);
        try { fim(normalizarTela(JSON.parse(JSON.parse(e).result))); } catch { fim(null); }
      } });
    } catch { clearTimeout(t); fim(null); }
  });
}

// espera depois do ResizeTo antes de reler a posição ([S] o redimensionamento no CEF pode ser assíncrono: a releitura logo em
// seguida leria a posição antiga e a correção não dispararia; revisão de 14/10/2026)
export const RELER_MS = 120;

// Geometria viva. lerTela() -> Promise<tela|null>; mover(x, y) (Window.MoveTo, físico); medidas() -> {larg, alt, esq} CSS que o
// roteador pediu por último (estado único de largura: index.js est.lateral). Serializa: um ajuste por vez, sempre com a
// medida mais nova do roteador (abrir e fechar rápido nunca aplica um estado velho).
// ativo() -> o compacto ainda está à vista: a tarefa é assíncrona (ScreenData) e a fase pode ter expandido a janela no meio
// (coach que sai ao entrar na partida): sem a guarda, a tarefa encolhia/movia o client de 1280
export function criarGeometria({ lerTela, mover, medidas, log = () => {}, ativo = () => true,
  esperar = ms => new Promise(r => setTimeout(r, ms)) }) {
  const g = { ancora: null, xAlvo: null, yAlvo: null, esqAplicado: 0, tela: null, movidas: 0, recusas: 0 };
  let fila = Promise.resolve();

  // adota onde a janela está como lugar escolhido por ele (entrou no compacto, ele arrastou, o Windows mexeu)
  const adotar = (t, esq) => { g.ancora = t.x + esq * t.z; };
  const longe = (a, b) => Math.abs(a - b) > FOLGA_PX;

  // redimensionar(): o ResizeTo do roteador; porCss(): as variáveis --lc-cp-* da camada (larguras dos 3 pedaços). As duas saem
  // AQUI, na mesma volta do MoveTo (revisão de 14/10/2026: o CSS ia na hora do clique e a coluna ficava fora de vista a ida e
  // volta inteira do ScreenData). Ordem: crescendo para a esquerda, CSS → anda → alarga (a coluna só some ~1 quadro, nunca
  // anda); fechando a esquerda, encolhe → CSS → anda (CSS e MoveTo juntos); sem mudar a esquerda, CSS → redimensiona → anda.
  // soSemMover (decisão 1 do Gabriel: aberturas automáticas): se a tela RELIDA aqui pede mover (ou não deu para ler), não muda
  // nada e chama aoRecusar() — a conta "cabe sem mover" de quem pediu pode estar velha (ele arrastou no meio).
  async function aplicarAgora({ redimensionar = null, porCss = null, soSemMover = false, aoRecusar = null } = {}) {
    if (!ativo()) return null;
    const t = await lerTela();
    if (t) g.tela = t;
    if (!ativo()) return null;
    const m = medidas();
    const recusar = motivo => { g.recusas++; log(`geometria: não abre sozinho (${motivo})`); try { aoRecusar?.(); } catch (e) { log('geometria: aoRecusar', e); } return null; };
    if (!t || t.minimizada || !m || !(m.larg > 0)) {
      if (soSemMover) return recusar('sem a posição da janela');
      porCss?.(); redimensionar?.(); return null;
    }
    // a janela não está onde eu deixei: ele arrastou (ou é a 1ª vez). A coluna estava em x + esq_de_antes·z
    if (g.ancora === null || g.xAlvo === null || longe(t.x, g.xAlvo)) adotar(t, g.esqAplicado);
    const yBase = g.yAlvo !== null && !longe(t.y, g.yAlvo) ? g.yAlvo : t.y;
    const esq = m.esq || 0;
    const p = posicaoAlvo({ tela: t, ancora: g.ancora, esq, larg: m.larg, alt: m.alt, y: yBase });
    const anda = longe(p.x, t.x) || longe(p.y, t.y);
    if (soSemMover && anda) return recusar('teria de mover a janela');
    const ande = () => { if (anda) { mover(p.x, p.y); g.movidas++; } };
    if (esq > g.esqAplicado) { porCss?.(); ande(); redimensionar?.(); }
    else if (esq < g.esqAplicado) { redimensionar?.(); porCss?.(); ande(); }
    else { porCss?.(); redimensionar?.(); ande(); }
    g.esqAplicado = esq;
    g.xAlvo = p.x; g.yAlvo = p.y;
    if (anda) log(`janela em ${p.x},${p.y}`);
    // [S] ResizeTo manter o canto de cima à esquerda: espera o redimensionamento assentar, relê e corrige uma vez
    await esperar(RELER_MS);
    const t2 = await lerTela();
    if (t2 && !t2.minimizada && ativo()) {
      g.tela = t2;
      if (longe(t2.x, p.x) || longe(t2.y, p.y)) { mover(p.x, p.y); g.movidas++; }
    }
    return p;
  }

  const enfileirar = opcoes => { const p = fila.then(() => aplicarAgora(opcoes)).catch(e => { log('geometria', e); return null; }); fila = p; return p; };
  return {
    aplicar: enfileirar,                 // lateral mudou: ordem anda/alarga + prende ao monitor
    ajustar: () => enfileirar({}),       // depois de um ResizeTo do próprio roteador (entrou no compacto, reencolheu)
    // expandiu (CenterToScreen põe a janela noutro lugar): a próxima medida vira a âncora (coluna onde a janela está)
    esquecer() { g.ancora = null; g.xAlvo = null; g.yAlvo = null; g.esqAplicado = 0; },
    // lê de novo a tela (para "cabe sem mover" e a largura útil) sem mover nada
    async reler() { const t = await lerTela(); if (t) g.tela = t; return t; },
    // o arrasto dele moveu a janela (MoveTo direto, fora da fila): a última tela lida passa a valer com a posição nova. xAlvo e
    // yAlvo NÃO mudam: o próximo aplicar vê a janela longe do alvo e adota a âncora nova (revisão de 14/10/2026: sem isto o 2º
    // arrasto saltava de volta ao lugar do 1º e o "cabe sem mover" usava a posição velha)
    anotarPosicao(x, y) {
      if (!g.tela || g.tela.minimizada || !Number.isFinite(x) || !Number.isFinite(y)) return;
      g.tela = { ...g.tela, x: Math.round(x), y: Math.round(y) };
    },
    tela: () => g.tela,
    ocioso: () => fila,
    estado: () => ({ ...g }),
  };
}
