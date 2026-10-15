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
// Sem pedido atômico de posição + tamanho (15/10/2026, lido no LeagueClientUx.exe: Window.Activate, AddToTaskbar, ApplyMask,
// CenterToScreen, CenterWithinParent, Flash, GetValidWindowSizes, Hide, Minimize, MoveBy, MoveTo, RemoveFromTaskbar, ResizeBy,
// ResizeTo, Restore, ScreenData, SetDebugWindowFrameVisibility, SetResizeBounds, SetTitle, Show, ShowDevTools, SyncMinimize;
// nenhum SetBounds/SetRect): a ordem dos dois pedidos é a de aplicarAgora.

export const MINIMIZADA_X = -30000;
export const FOLGA_PX = 2; // diferença de posição que não vale um MoveTo (px físicos)

// ScreenData cru -> tela normalizada | null (sem os números ou minimizada)
export function normalizarTela(d) {
  if (!d || typeof d !== 'object') return null;
  const n = k => Number(d[k]);
  const t = { x: n('screenX'), y: n('screenY'), z: n('zoomScale') || 1, L: n('screenAvailLeft'), T: n('screenAvailTop'),
    W: n('screenAvailWidth'), H: n('screenAvailHeight'), minimizada: d.windowMinimized === true };
  if (![t.x, t.y, t.L, t.T, t.W, t.H].every(Number.isFinite) || !(t.W > 0) || !(t.H > 0) || !(t.z > 0)) return null;
  // largura da janela em px CSS (windowWidth vem físico: o centerWithinMainWindow do rcp-fe-lol-uikit 16.20 centra width·zoomScale
  // dentro de (screenX, screenY, windowWidth, windowHeight); null sem o número): decide se a lateral cresce ou encolhe a janela
  const ww = n('windowWidth');
  t.w = Number.isFinite(ww) && ww > 0 ? ww / t.z : null;
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
// crescer: quanto esperar a página ficar com a largura nova (evento resize) antes de andar; sem ele, anda assim mesmo (CSS velho
// numa janela nova é pior que um quadro torto)
export const ESPERA_TAMANHO_MS = 250;
// a corrida que nenhuma ordem tira (ARMADILHAS § Client, "pisca ao abrir ⚙"): MoveTo vai ao próximo compose do DWM, o CSS novo ao
// próximo quadro da página. 0 = MoveTo na mesma volta do CSS; 1 = um quadro depois. [S] o traço não decide (com 0, "css" e
// "move" saem no mesmo ms do JS): só vídeo ou captura de tela em alta taxa. Ao abrir, coluna pulando para a esquerda por um
// quadro = o MoveTo chega antes, subir para 1; para a direita = fica 0
export const MOVE_APOS_CSS_QUADROS = 0;
// quadros com o painel da esquerda escondido depois do MoveTo (o quadro da corrida mostra fundo escuro, nunca as configurações
// no lugar da coluna)
export const QUADROS_ATE_MOSTRAR = 2;
const TRACO_MAX = 40;

// rAF da página com rede (minimizada o rAF para: a fila da geometria nunca fica presa)
export const quadroDaPagina = (win = globalThis.window) => () => new Promise(r => {
  let feito = false;
  const fim = () => { if (!feito) { feito = true; r(); } };
  const t = setTimeout(fim, 50);
  try { win.requestAnimationFrame(() => { clearTimeout(t); fim(); }); } catch { /* sem rAF: o prazo resolve */ }
});
// a página já tem a largura pedida (±8 px CSS, a folga do noTamanho)? Resolve no evento resize (antes do estilo e da pintura do
// quadro: o CSS posto na continuação sai no MESMO quadro do tamanho novo) ou no prazo. -> Promise<bool>
export const esperarTamanhoDaPagina = (win = globalThis.window, prazoMs = ESPERA_TAMANHO_MS) => larg => new Promise(res => {
  let feito = false, t = null;
  const ver = () => { try { if (Math.abs(Number(win.innerWidth) - larg) <= 8) fim(true); } catch { /* segue */ } };
  const fim = ok => { if (feito) return; feito = true; clearTimeout(t); try { win.removeEventListener('resize', ver); } catch { /* segue */ } res(ok); };
  t = setTimeout(() => fim(false), prazoMs);
  try { win.addEventListener('resize', ver); } catch { /* sem eventos: o prazo resolve */ }
  ver();
});

// Geometria viva. lerTela() -> Promise<tela|null>; mover(x, y) (Window.MoveTo, físico); medidas() -> {larg, alt, esq, dir, col, pintada} CSS
// que o roteador pediu por último (estado único de largura: index.js est.lateral). Serializa: um ajuste por vez, sempre com a
// medida mais nova do roteador (abrir e fechar rápido nunca aplica um estado velho).
// ativo() -> o compacto ainda está à vista: a tarefa é assíncrona (ScreenData) e a fase pode ter expandido a janela no meio
// (coach que sai ao entrar na partida): sem a guarda, a tarefa encolhia/movia o client de 1280
// quadro() -> Promise do próximo quadro; esperarTamanho(larg) -> Promise<bool> (a página com a largura nova); agora() -> ms (traço)
export function criarGeometria({ lerTela, mover, medidas, log = () => {}, ativo = () => true,
  esperar = ms => new Promise(r => setTimeout(r, ms)), quadro = () => new Promise(r => setTimeout(r, 16)),
  esperarTamanho = async () => false, agora = () => Date.now() }) {
  const g = { ancora: null, xAlvo: null, yAlvo: null, esqAplicado: 0, tela: null, movidas: 0, recusas: 0, traco: [] };
  let fila = Promise.resolve();

  // adota onde a janela está como lugar escolhido por ele (entrou no compacto, ele arrastou, o Windows mexeu)
  const adotar = (t, esq) => { g.ancora = t.x + esq * t.z; };
  const longe = (a, b) => Math.abs(a - b) > FOLGA_PX;
  // traço curto para medir no client a corrida CSS x MoveTo (sem log no console a cada clique)
  const marcar = (ev, extra = {}) => { g.traco.push({ t: Math.round(agora() * 10) / 10, ev, ...extra }); if (g.traco.length > TRACO_MAX) g.traco.shift(); };
  const quadros = async n => { for (let i = 0; i < n; i++) await quadro(); };

  // redimensionar(m): o ResizeTo do roteador; porCss(m): as variáveis --lc-cp-* da camada (larguras dos 3 pedaços); esconderEsq(on):
  // o painel da esquerda fica invisível (a coluna nunca). Crescer ou encolher para a esquerda não tem pedido atômico (nenhum
  // SetBounds no LeagueClientUx.exe, 15/10/2026): MoveTo e ResizeTo são dois, e a página só fica sabendo do tamanho novo uma ida e
  // volta depois. Regra (o Gabriel viu "uma flickada" ao clicar na ⚙, 15/10/2026: o CSS da esquerda saía numa página ainda de 420 e
  // a janela andava antes de alargar: 1+ quadro com as configurações no lugar da coluna e a coluna cortada):
  // - janela CRESCE: ResizeTo primeiro, com a esquerda velha (a coluna fica onde está, sobra fundo escuro à direita); quando a
  //   página já tem a largura nova (resize), CSS novo + MoveTo na mesma volta;
  // - janela ENCOLHE (ou fica igual): CSS novo + MoveTo primeiro (a janela ainda é larga, nada corta); ResizeTo por último, dois
  //   quadros depois (a página já pintou o CSS novo quando a janela estreita).
  // Invariante: a página nunca fica mais estreita do que esquerda + coluna pedem. Painel da esquerda escondido do quadro antes do
  // MoveTo até QUADROS_ATE_MOSTRAR depois. Sobra só a corrida CSS x MoveTo (0-1 quadro, MOVE_APOS_CSS_QUADROS).
  // soSemMover (decisão 1 do Gabriel: aberturas automáticas): se a tela RELIDA aqui pede mover (ou não deu para ler), não muda
  // nada e chama aoRecusar() — a conta "cabe sem mover" de quem pediu pode estar velha (ele arrastou no meio).
  async function aplicarAgora({ redimensionar = null, porCss = null, soSemMover = false, aoRecusar = null, esconderEsq = null } = {}) {
    if (!ativo()) return null;
    const t = await lerTela();
    if (t) g.tela = t;
    if (!ativo()) return null;
    const m = medidas();
    const recusar = motivo => { g.recusas++; log(`geometria: não abre sozinho (${motivo})`); try { aoRecusar?.(); } catch (e) { log('geometria: aoRecusar', e); } return null; };
    if (!t || t.minimizada || !m || !(m.larg > 0)) {
      if (soSemMover) return recusar('sem a posição da janela');
      porCss?.(m); redimensionar?.(m); return null;
    }
    // a esquerda que está PINTADA (m.pintada, do CSS da camada) vence a que esta geometria aplicou por último: na partida o
    // roteador zera o CSS e encolhe a janela sem passar por aqui (revisão adversarial de 15/10/2026: sair da partida com a ⚙
    // aberta crescia "com a esquerda velha" 360 numa página de 420, o mesmo pisca)
    const esqAntes = Number.isFinite(m.pintada) ? m.pintada : g.esqAplicado;
    // a janela não está onde eu deixei: ele arrastou (ou é a 1ª vez). A coluna estava em x + esq_de_antes·z (1ª vez, depois de
    // esquecer(): a borda da janela, como sempre foi)
    if (g.ancora === null || g.xAlvo === null || longe(t.x, g.xAlvo)) adotar(t, g.ancora === null ? g.esqAplicado : esqAntes);
    const yBase = g.yAlvo !== null && !longe(t.y, g.yAlvo) ? g.yAlvo : t.y;
    const esq = m.esq || 0;
    const p = posicaoAlvo({ tela: t, ancora: g.ancora, esq, larg: m.larg, alt: m.alt, y: yBase });
    const anda = longe(p.x, t.x) || longe(p.y, t.y);
    if (soSemMover && anda) return recusar('teria de mover a janela');
    const mexeEsq = esq !== esqAntes;
    // largura atual: a do ScreenData; sem ela, crescer = a esquerda crescer (a ordem de antes)
    const cresce = Number.isFinite(t.w) ? m.larg > t.w + 0.5 : esq > esqAntes;
    const encolhe = Number.isFinite(t.w) ? m.larg < t.w - 0.5 : true;
    const esconder = on => { if (!mexeEsq) return; try { esconderEsq?.(on); } catch (e) { log('geometria: esconder', e); } };
    const redim = () => { if (redimensionar) { redimensionar(m); marcar('resize', { w: m.larg }); } };
    // CSS novo e MoveTo juntos (o passo da corrida); false = a fase mudou no meio (partida: nada de MoveTo)
    const andarComCss = async () => {
      porCss?.(m); marcar('css', { esq, dir: m.dir ?? null });
      if (MOVE_APOS_CSS_QUADROS > 0) { await quadros(MOVE_APOS_CSS_QUADROS); if (!ativo()) return false; }
      if (anda) { mover(p.x, p.y); g.movidas++; marcar('move', { x: p.x, y: p.y }); }
      // CSS e posição mudaram AQUI: o estado vale já (a partida pode começar antes do ResizeTo e a tarefa sair sem o fim)
      g.esqAplicado = esq; g.xAlvo = p.x; g.yAlvo = p.y;
      return true;
    };
    marcar('pedido', { x: t.x, w: t.w, larg: m.larg, esq, esqAntes, cresce });
    try {
      if (cresce) {
        esconder(true);
        porCss?.({ ...m, esq: esqAntes }); // a coluna fica onde está enquanto a janela alarga pela direita
        redim();
        const ok = await esperarTamanho(m.larg);
        marcar(ok ? 'tamanho' : 'tamanho-prazo');
        if (!ativo()) { log('geometria: a fase mudou no meio (não anda)'); return null; }
        if (!(await andarComCss())) return null;
      } else {
        if (mexeEsq && anda) { esconder(true); await quadro(); if (!ativo()) return null; } // painel some antes de a janela andar
        if (!(await andarComCss())) return null;
        if (encolhe) { await quadros(2); if (!ativo()) return null; }
        redim();
      }
      g.esqAplicado = esq;
      g.xAlvo = p.x; g.yAlvo = p.y;
      if (anda) log(`janela em ${p.x},${p.y}`);
      if (mexeEsq) await quadros(QUADROS_ATE_MOSTRAR);
    } finally { esconder(false); }
    // [S] ResizeTo manter o canto de cima à esquerda: espera o redimensionamento assentar, relê e corrige uma vez
    await esperar(RELER_MS);
    const t2 = await lerTela();
    if (t2 && !t2.minimizada && ativo()) {
      g.tela = t2;
      const corrige = longe(t2.x, p.x) || longe(t2.y, p.y);
      // correção frequente aqui = o 2º pulo que ele veria ([S] ResizeTo que não mantém o canto): o traço mostra
      marcar('releitura', { x: t2.x, w: t2.w, corrige });
      if (corrige) { mover(p.x, p.y); g.movidas++; log(`geometria: correção depois do ResizeTo (${t2.x} → ${p.x})`); }
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
    estado: () => ({ ...g, traco: g.traco.map(x => ({ ...x })) }),
  };
}
