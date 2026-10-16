// Fundo da coluna compacta = o fundo do perfil dele (etapa 3 de roadmap/2026-10-16-compacto-chat-amigos-perfil.md; pedido do Gabriel de
// 16/10/2026: "o meu background do perfil definido também poderia ser o background da janela principal. Como o background é no modo
// paisagem e o client compacto é no modo retrato, daria para deixar meio que centralizado esse background, porém expandido para caber
// 100% nessa tela principal. E aí seria cortado o lado esquerdo e o lado direito").
// - a imagem é a backdropImage de GET /lol-collections/v1/inventories/{summonerId}/backdrop (a mesma que o rcp-fe-lol-profiles lê no
//   backdropObserver; medido em 16/10/2026: "/lol-game-data/assets/ASSETS/Characters/<campeão>/Skins/SkinN/Images/<x>_splash_centered_N.jpg");
//   o backdropVideo nunca é lido (decisão 10 do plano: vídeo numa janela aberta o dia todo custa CPU);
// - cover + center na coluna (retrato: corta os lados), por baixo de um véu escuro (VEU, medido pelo contraste de cada texto das telas
//   no harness temp/compacto-harness/contraste.html; números no roadmap, etapa 3) e com os textos mais apagados um tom mais claros;
// - as variáveis vão no <html>, não na camada: no boot a Riot troca o #lc-compacto por uma cópia (ARMADILHAS § Client) e a coluna é
//   recriada a cada montagem; o CSS casa html.lc-cp-com-fundo;
// - só GET; chave compacto.fundoPerfil (padrão ligada) desliga na hora; imagem que não carrega = sem fundo (o de sempre).
// Importável no node (tools/teste-compacto-perfil.mjs): nada de DOM no topo; doc, LCU, relógio e carregador de imagem injetáveis.
import { estilo } from './comum.js';
import { caminhoSeguro, ROTAS_PERFIL } from './perfil.js';

export const RELER_MS = 10 * 60 * 1000;
export const CLASSE_FUNDO = 'lc-cp-com-fundo';
export const VAR_FUNDO = '--lc-cp-fundo';
// véu sobre a imagem: cor do fundo do compacto (#010a13) com a opacidade de cima para baixo (pos em fração da altura da coluna)
export const VEU_COR = [1, 10, 19];
// medido em 16/10/2026 (temp/compacto-harness/contraste.html, 5 telas × 10 splashes reais + branco puro): com os TONS_FUNDO, 0,84
// uniforme passa em TODOS os textos até sobre branco puro (o pior caso de qualquer imagem); 0,80 já deixa 7 abaixo de 4,5:1 e um
// gradiente mais leve no alto falha (há texto em toda a altura da coluna). O véu fica uniforme
export const VEU = [{ pos: 0, a: 0.84 }, { pos: 1, a: 0.84 }];
// dica: a linha "sua posição · fecha sozinho…" do destaque da posição na seleção (#5b6670 no CSS da seleção, 2,2:1 sobre o véu com splash
// branca; revisão de 16/10/2026, achada pela colheita de cores do teste). #b4bec6 passa 4,96:1 até no centro dourado do painel dela
export const TONS_FUNDO = { mudo: '#c4bead', verm: '#ff6f82', cinza: '#aab3ba', dica: '#b4bec6' };
export const fundoLigado = cfg => !!cfg?.compacto?.ligado && cfg?.compacto?.fundoPerfil !== false;
// backdrop -> caminho da imagem (só a estática; o vídeo nunca) | ''
export const urlFundo = backdrop => (backdrop && typeof backdrop === 'object' ? caminhoSeguro(backdrop.backdropImage) : '');

// ---------- contraste (WCAG 2.x), para a medição do véu ----------
const canal = v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const luminancia = ([r, g, b]) => 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
export const contraste = (a, b) => { const x = luminancia(a), y = luminancia(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// camada rgba por cima de uma cor (composição do navegador, em sRGB)
export const compor = (baixo, [r, g, b, a = 1]) => [r * a + baixo[0] * (1 - a), g * a + baixo[1] * (1 - a), b * a + baixo[2] * (1 - a)];
// opacidade do véu numa altura (0..1), interpolada como o linear-gradient
export function alfaVeu(y, veu = VEU) {
  const t = Math.min(1, Math.max(0, Number(y) || 0));
  for (let i = 1; i < veu.length; i++) if (t <= veu[i].pos) { const a = veu[i - 1], b = veu[i]; return a.a + (b.a - a.a) * ((t - a.pos) / (b.pos - a.pos || 1)); }
  return veu[veu.length - 1].a;
}
// CSS do gradiente do véu
export const gradienteVeu = (veu = VEU) => `linear-gradient(180deg,${veu.map(p => `rgba(${VEU_COR.join(',')},${p.a}) ${Math.round(p.pos * 100)}%`).join(',')})`;
// texto grande (WCAG): ≥ 24 px, ou ≥ 18,66 px em negrito
export const textoGrande = (px, peso) => Number(px) >= 24 || (Number(px) >= 18.66 && Number(peso) >= 700);
export const minimoWcag = (px, peso) => (textoGrande(px, peso) ? 3 : 4.5);

// com o fundo, os textos mais apagados da coluna sobem um tom (o cinza-dourado "mudo", o vermelho, o cinza da intenção e a dica do
// destaque da posição na seleção): eram os que caíam abaixo de 4,5:1 sobre splash clara (medido no harness; números no roadmap, etapa 3).
// Cor de texto nova no CSS da coluna: o teste colhe todas (teste-compacto-perfil.mjs, "colheita") e falha se alguma não passar
export const CSS_FUNDO = (veu = VEU) => `
html.${CLASSE_FUNDO} #lc-compacto > .lc-cp-coluna { background:${gradienteVeu(veu)}, var(${VAR_FUNDO}) center / cover no-repeat, #010a13;
  --lc-mudo:${TONS_FUNDO.mudo}; --lc-verm:${TONS_FUNDO.verm}; }
html.${CLASSE_FUNDO} #lc-compacto > .lc-cp-coluna .lc-cp-sel-n i { color:${TONS_FUNDO.cinza}; }
html.${CLASSE_FUNDO} #lc-compacto > .lc-cp-coluna .lc-cp-sel-papel-dica { color:${TONS_FUNDO.dica}; }
`;

// controlador (iniciarCompacto): {cfg, lcu, doc, carregarImagem(url) -> Promise<boolean>, repetir, pararRepetir, log}
export const RETENTAR_MS = 30000, RETENTATIVAS = 6;
export function criarFundo({ cfg, lcu, doc = globalThis.document, carregarImagem = carregarNoNavegador, repetir = setInterval, pararRepetir = clearInterval,
  agendar = setTimeout, log = () => {} }) {
  const st = { url: '', lendo: false, timer: null, erro: '', lidas: 0, retentativas: 0 };
  // no boot a LCU pode ainda não responder (o plugin carrega antes do login): falha sem fundo à vista tenta de novo em 30 s, até 6 vezes;
  // depois disso, só a releitura de 10 min
  const talvezRetentar = () => {
    if (st.url || !st.erro || !fundoLigado(cfg) || st.retentativas >= RETENTATIVAS) return;
    st.retentativas++;
    agendar(() => { ler().catch(() => {}); }, RETENTAR_MS);
  };
  const html = () => doc?.documentElement;
  function aplicar(url) {
    const r = html();
    if (!r) return;
    try { r.style?.setProperty?.(VAR_FUNDO, `url("${url}")`); r.classList?.add?.(CLASSE_FUNDO); } catch { /* sem DOM */ }
    st.url = url;
  }
  function limpar() {
    const r = html();
    try { r?.classList?.remove?.(CLASSE_FUNDO); r?.style?.removeProperty?.(VAR_FUNDO); } catch { /* sem DOM */ }
    st.url = '';
  }
  // só GET: invocador atual -> backdrop -> imagem pré-carregada; qualquer falha = sem fundo
  async function passo() {
    st.lidas++;
    const eu = await lcu('GET', ROTAS_PERFIL.eu);
    const id = Number(eu.ok ? eu.json?.summonerId : 0);
    if (!(id > 0)) { st.erro = `invocador (${eu.status})`; return; } // falha passageira: fica o que estava
    const b = await lcu('GET', ROTAS_PERFIL.fundo(id));
    const url = b.ok ? urlFundo(b.json) : '';
    if (!fundoLigado(cfg)) { limpar(); return; }
    if (!url) { st.erro = b.ok ? 'sem imagem' : `backdrop (${b.status})`; if (b.ok) limpar(); return; }
    if (url === st.url) { st.erro = ''; return; }
    let ok = false;
    try { ok = await carregarImagem(url); } catch { ok = false; }
    if (!fundoLigado(cfg)) { limpar(); return; }
    if (ok) { st.erro = ''; aplicar(url); } else { st.erro = 'imagem não carregou'; limpar(); }
  }
  async function ler() {
    if (!fundoLigado(cfg)) { limpar(); return st.url; }
    if (st.lendo) return st.url;
    st.lendo = true;
    try { await passo(); } catch (e) { st.erro = String(e?.message || e); log('fundo', e); } finally { st.lendo = false; }
    if (st.url) st.retentativas = 0;
    else if (st.erro !== 'sem imagem') talvezRetentar();
    return st.url;
  }
  return {
    iniciar() {
      estilo('lc-cp-fundo-estilo', CSS_FUNDO(), doc);
      ler().catch(() => {});
      if (!st.timer) st.timer = repetir(() => { ler().catch(() => {}); }, RELER_MS);
    },
    // cfg mudou (Configurações): desligou = some na hora; ligou = lê
    sincronizar() { if (!fundoLigado(cfg)) limpar(); else if (!st.url) ler().catch(() => {}); },
    parar() { if (st.timer) { pararRepetir(st.timer); st.timer = null; } },
    ler, estado: () => ({ url: st.url, erro: st.erro, lidas: st.lidas, ligado: fundoLigado(cfg) }),
  };
}

// pré-carrega a imagem (o fundo só entra se ela abriu: imagem quebrada não troca o fundo de sempre por um buraco)
export function carregarNoNavegador(url, { Img = globalThis.Image, prazoMs = 15000 } = {}) {
  return new Promise(res => {
    if (typeof Img !== 'function') { res(false); return; }
    const i = new Img();
    const t = setTimeout(() => res(false), prazoMs);
    i.onload = () => { clearTimeout(t); res(true); };
    i.onerror = () => { clearTimeout(t); res(false); };
    i.src = url;
  });
}
