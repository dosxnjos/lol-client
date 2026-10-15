// Configurações do lol-client dentro do compacto (roadmap/2026-10-13-client-compacto.md, passo 13, tela B1 + ajuste do Gabriel de
// 14/10/2026 ~20:00: "configurações pode expandir para a esquerda"). Painel à ESQUERDA da coluna, com os mesmos blocos e chaves da
// seção "lol-client" das Configurações da Riot (pengu/configuracoes.js montarPainel: mesmo cfg, gravado na hora), em blocos
// recolhíveis (um aberto por vez) com busca. "Restaurar padrão" fica só no client normal. Rodapé: Configurações da Riot (vídeo,
// som, teclas) abrem o client normal no modal dela e voltam ao compacto quando ele fecha (index.js abrirConfigRiot).
// Sem LCU. Importável no node (o DOM vem do doc injetado; montarPainel usa o document global, como no client).
import { h } from './comum.js';
import { montarPainel } from '../configuracoes.js';

export const BLOCO_INICIAL = 'Client compacto';

// filhos do montarPainel -> [{titulo, nos}] (cada título de seção abre um grupo)
export function agrupar(filhos) {
  const grupos = [];
  for (const n of filhos) {
    if (n?.classList?.contains?.('lol-settings-general-section-title')) grupos.push({ titulo: String(n.textContent || '').trim(), nos: [] });
    else if (grupos.length) grupos[grupos.length - 1].nos.push(n);
  }
  return grupos;
}
const textoDe = n => String(n?.textContent || '').toLocaleLowerCase('pt-BR');

// amb = {doc, cfg, definir, aoConfigRiot(), aoFechar()} -> {el, pintar()}
export function criarConfigView(amb) {
  const { doc } = amb;
  let aberto = BLOCO_INICIAL, filtro = '';
  const busca = h('input', { doc, class: 'lc-lt-busca', placeholder: 'buscar opção (ex.: aceitar, runa, chat)', autocomplete: 'off', spellcheck: 'false', dataset: { a: 'cfg-busca' } });
  busca.addEventListener('input', () => { filtro = String(busca.value || '').trim().toLocaleLowerCase('pt-BR'); pintar(); });
  busca.addEventListener('keydown', e => e.stopPropagation?.());
  const corpo = h('div', { doc, class: 'lc-lt-cfgcorpo', dataset: { a: 'cfg-corpo' } });
  const riot = h('button', { doc, class: 'lc-cp-btn lc-lt-riot', dataset: { a: 'cfg-riot' }, title: 'abre o client normal no modal da Riot; ao fechar, volta ao compacto',
    on: { click: e => { if (e?.isTrusted === false) return; amb.aoConfigRiot?.(); } } }, '⤢ Configurações da Riot (vídeo, som, teclas)');
  const el = h('section', { doc, class: 'lc-lt-pn lc-lt-cfg', dataset: { painel: 'config' } },
    h('header', { doc, class: 'lc-lt-cab' }, h('div', { doc, class: 'lc-lt-tit' }, h('b', { doc }, '⚙ configurações do lol-client'), h('small', { doc }, 'grava na hora · as mesmas do client normal')),
      h('button', { doc, class: 'lc-lt-x', title: 'fechar as configurações', dataset: { a: 'cfg-fechar' }, on: { click: e => amb.aoFechar?.(e) } }, '✕')),
    h('div', { doc, class: 'lc-lt-buscacx' }, busca), corpo,
    h('footer', { doc, class: 'lc-lt-rod' }, riot, h('small', { doc }, 'abre o client normal: o modal da Riot é desenhado para 1280')));

  function pintar() {
    let topo = 0;
    try { topo = corpo.scrollTop || 0; } catch { /* sem layout */ }
    const cru = h('div', { doc });
    try { montarPainel(cru, { cfg: amb.cfg, definir: amb.definir }); }
    catch (e) { corpo.replaceChildren(h('div', { doc, class: 'lc-lt-vazio' }, `não foi possível montar as configurações (${e?.message || e})`)); return; }
    // o bloco do compacto vem primeiro (é o que ele mexe daqui; protótipo B1)
    const grupos = agrupar([...(cru.children || cru.childNodes || [])]).sort((a, b) => (b.titulo === BLOCO_INICIAL) - (a.titulo === BLOCO_INICIAL));
    const blocos = [];
    for (const g of grupos) {
      const linhas = g.nos;
      const casam = filtro ? linhas.filter(n => textoDe(n).includes(filtro)) : linhas;
      if (filtro && !casam.length && !g.titulo.toLocaleLowerCase('pt-BR').includes(filtro)) continue;
      const abre = filtro ? true : aberto === g.titulo;
      const ehLinha = x => x?.classList?.contains?.('lol-settings-general-row');
      const n = linhas.reduce((t, x) => t + (ehLinha(x) ? 1 : (x?.querySelectorAll?.('.lol-settings-general-row')?.length || 0)), 0) || linhas.length;
      const cab = h('button', { doc, class: 'lc-lt-bcab' + (abre ? ' lc-lt-aberto' : ''), dataset: { a: 'cfg-bloco', bloco: g.titulo },
        on: { click: () => { aberto = aberto === g.titulo ? '' : g.titulo; pintar(); } } }, h('span', { doc }, g.titulo), h('small', { doc }, `${n} ${n === 1 ? 'opção' : 'opções'} ${abre ? '▾' : '▸'}`));
      const corpoB = abre ? h('div', { doc, class: 'lc-lt-bcorpo' }, ...(filtro && casam.length ? casam : linhas)) : null;
      blocos.push(h('div', { doc, class: 'lc-lt-bloco' }, cab, corpoB));
    }
    corpo.replaceChildren(...(blocos.length ? blocos : [h('div', { doc, class: 'lc-lt-vazio' }, 'nada com esse texto')]));
    try { corpo.scrollTop = topo; } catch { /* sem layout */ }
  }
  return { el, pintar, estado: () => ({ aberto, filtro }) };
}

export const CSS_CONFIG = `
#lc-compacto .lc-lt-cfgcorpo { flex:1; min-height:0; overflow:auto; padding:4px 0 8px; user-select:text; }
#lc-compacto .lc-lt-bloco { border-bottom:1px solid rgba(60,60,65,.6); }
#lc-compacto .lc-lt-bcab { display:flex; justify-content:space-between; align-items:center; width:100%; padding:9px 12px; background:none; border:none;
  color:var(--lc-ouro2); font:inherit; font-size:12.5px; cursor:pointer; text-align:left; }
#lc-compacto .lc-lt-bcab:hover, #lc-compacto .lc-lt-bcab.lc-lt-aberto { background:rgba(200,170,110,.06); }
#lc-compacto .lc-lt-bcab small { color:var(--lc-mudo); font-size:10.5px; }
#lc-compacto .lc-lt-bcorpo { padding:2px 12px 10px; font-size:12px; color:var(--lc-txt); }
#lc-compacto .lc-lt-bcorpo .lol-settings-general-row { margin:6px 0; }
#lc-compacto .lc-lt-bcorpo .lc-explica { margin:2px 0 0 24px; font-size:11px; color:var(--lc-mudo); line-height:1.35; }
#lc-compacto .lc-lt-bcorpo lol-uikit-flat-checkbox { display:flex; gap:6px; align-items:center; color:var(--lc-ouro2); }
#lc-compacto .lc-lt-bcorpo .lc-campos { display:flex; flex-wrap:wrap; gap:8px; }
#lc-compacto .lc-lt-bcorpo .lol-settings-window-size-text { font-size:11px; color:var(--lc-mudo); margin-bottom:3px; }
#lc-compacto .lc-lt-rod { flex:none; padding:8px 10px 10px; border-top:1px solid var(--lc-linha2); display:flex; flex-direction:column; gap:4px; }
#lc-compacto .lc-lt-rod small { font-size:10.5px; color:var(--lc-mudo); }
#lc-compacto .lc-lt-riot { width:100%; }
`;
