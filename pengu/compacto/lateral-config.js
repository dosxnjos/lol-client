// Configurações do lol-client dentro do compacto (roadmap/2026-10-13-client-compacto.md, passo 13, tela B1 + ajuste do Gabriel de
// 14/10/2026 ~20:00: "configurações pode expandir para a esquerda"). Painel à ESQUERDA da coluna, com os mesmos blocos e chaves da
// seção "lol-client" das Configurações da Riot (pengu/configuracoes.js montarPainel: mesmo cfg, gravado na hora), em blocos
// recolhíveis (um aberto por vez) com busca. "Restaurar padrão" fica só no client normal. Rodapé: Configurações da Riot (vídeo,
// som, teclas) abrem o client normal no modal dela e voltam ao compacto quando ele fecha (index.js abrirConfigRiot).
// Seção "Som" (etapa B de roadmap/2026-10-16-chat-da-sala-som-icones.md, pedido de 16/10/2026): só aqui, nunca no modal da Riot (lá a
// página Som é a dela). Junta o som do client (compacto/som.js: GET ao abrir; PATCH só no clique ou no soltar do volume, dele) com as
// chaves de som do plugin (blocos.js blocoSomPlugin); o bloco "Voz" some daqui porque os controles dele estão na Som.
// Importável no node (o DOM vem do doc injetado; montarPainel e os blocos usam o document global, como no client).
import { h, icone, comIcone } from './comum.js';
import { montarPainel, ui } from '../configuracoes.js';
import { blocoSomPlugin } from '../blocos.js';
import { criarSomView, CSS_SOM } from './som.js';

export const BLOCO_INICIAL = 'Client compacto';
export const BLOCO_SOM = 'Som';
const SOME_NO_COMPACTO = ['Voz']; // os controles dele estão na seção Som

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

// amb = {doc, cfg, definir, aoConfigRiot(), aoFechar(), lcu?, avisar?, esperar?, cancelar?} -> {el, pintar(), aoAbrir(), som}
// Sem lcu (teste antigo, client sem LCU): a seção Som mostra só as chaves do plugin e o motivo.
export function criarConfigView(amb) {
  const { doc } = amb;
  let aberto = BLOCO_INICIAL, filtro = '', repintar = false;
  const som = criarSomView({ doc, lcu: amb.lcu || (async () => ({ ok: false, status: 0, erro: 'sem LCU' })), avisar: amb.avisar, esperar: amb.esperar, cancelar: amb.cancelar,
    aoSoltar: () => { if (repintar) pintar(); } });
  const busca = h('input', { doc, class: 'lc-lt-busca', placeholder: 'buscar opção (ex.: aceitar, runa, chat)', autocomplete: 'off', spellcheck: 'false', dataset: { a: 'cfg-busca' } });
  busca.addEventListener('input', () => { filtro = String(busca.value || '').trim().toLocaleLowerCase('pt-BR'); pintar(); });
  busca.addEventListener('keydown', e => e.stopPropagation?.());
  const corpo = h('div', { doc, class: 'lc-lt-cfgcorpo', dataset: { a: 'cfg-corpo' } });
  const riot = h('button', { doc, class: 'lc-cp-btn lc-lt-riot', dataset: { a: 'cfg-riot' }, title: 'abre o client normal no modal da Riot; ao fechar, volta ao compacto',
    on: { click: e => { if (e?.isTrusted === false) return; amb.aoConfigRiot?.(); } } }, comIcone('expandir', 'Configurações da Riot (vídeo, som, teclas)', { doc }));
  // um arrasto do volume que ficou preso (sem pointerup) solta no próximo clique em qualquer lugar da ⚙ fora de um volume (cabeçalho de
  // bloco, busca, ✕): senão a ⚙ ficava parada, porque arrastando ela não repinta (revisão de 16/10/2026)
  const el = h('section', { doc, class: 'lc-lt-pn lc-lt-cfg', dataset: { painel: 'config' }, on: { pointerdown: ev => som.soltarSeFora(ev) } },
    h('header', { doc, class: 'lc-lt-cab' }, h('div', { doc, class: 'lc-lt-tit' }, h('b', { doc }, comIcone('configuracoes', 'configurações do lol-client', { doc })), h('small', { doc }, 'grava na hora · as mesmas do client normal')),
      h('button', { doc, class: 'lc-lt-x', title: 'fechar as configurações', 'aria-label': 'fechar as configurações', dataset: { a: 'cfg-fechar' }, on: { click: e => amb.aoFechar?.(e) } },
        icone('fechar', { doc, tam: 14 }))),
    h('div', { doc, class: 'lc-lt-buscacx' }, busca), corpo,
    h('footer', { doc, class: 'lc-lt-rod' }, riot, h('small', { doc }, 'abre o client normal: o modal da Riot é desenhado para 1280')));

  // seção Som: o pedaço da Riot (o mesmo nó a montagem inteira: o controle de volume não pode ser recriado) + as caixas do plugin
  function grupoSom() {
    const plugin = h('div', { doc });
    try { blocoSomPlugin(plugin, { cfg: amb.cfg, definir: amb.definir, ui }); }
    catch (e) { plugin.replaceChildren(h('p', { doc, class: 'lc-explica' }, `não foi possível montar as opções de som do lol-client (${e?.message || e})`)); }
    return { titulo: BLOCO_SOM, nos: [som.el, h('div', { doc, class: 'lc-lt-subtit' }, 'Som do lol-client'), ...[...(plugin.children || plugin.childNodes || [])]] };
  }

  function pintar() {
    // arrastando o volume: repinta no soltar (o controle sairia do lugar no meio do arrasto)
    if (som.arrastando()) { repintar = true; return; }
    repintar = false;
    let topo = 0;
    try { topo = corpo.scrollTop || 0; } catch { /* sem layout */ }
    const cru = h('div', { doc });
    try { montarPainel(cru, { cfg: amb.cfg, definir: amb.definir }); }
    catch (e) { corpo.replaceChildren(h('div', { doc, class: 'lc-lt-vazio' }, `não foi possível montar as configurações (${e?.message || e})`)); return; }
    // o bloco do compacto vem primeiro (é o que ele mexe daqui; protótipo B1), a seção Som logo depois
    const ordem = t => (t === BLOCO_INICIAL ? 0 : t === BLOCO_SOM ? 1 : 2);
    const filhos = [...(cru.children || cru.childNodes || [])];
    // o que vem antes da 1ª seção (a linha "Versão x.y.z disponível", atualizacao.js) fica acima dos blocos, sempre à vista: o ponto
    // no ⚙ trouxe ele até aqui, e dentro de um bloco recolhido ninguém acharia
    const iTit = filhos.findIndex(n => n?.classList?.contains?.('lol-settings-general-section-title'));
    const soltos = iTit < 0 ? [] : filhos.slice(0, iTit);
    const grupos = [...agrupar(filhos).filter(g => !SOME_NO_COMPACTO.includes(g.titulo)), grupoSom()]
      .map((g, i) => ({ g, i })).sort((a, b) => ordem(a.g.titulo) - ordem(b.g.titulo) || a.i - b.i).map(x => x.g);
    const blocos = [];
    let somAVista = false;
    for (const g of grupos) {
      const linhas = g.nos;
      const casam = filtro ? linhas.filter(n => textoDe(n).includes(filtro)) : linhas;
      if (filtro && !casam.length && !g.titulo.toLocaleLowerCase('pt-BR').includes(filtro)) continue;
      const abre = filtro ? true : aberto === g.titulo;
      const ehLinha = x => x?.classList?.contains?.('lol-settings-general-row');
      const n = linhas.reduce((t, x) => t + (ehLinha(x) ? 1 : (x?.querySelectorAll?.('.lol-settings-general-row')?.length || 0)), 0) || linhas.length;
      const cab = h('button', { doc, class: 'lc-lt-bcab' + (abre ? ' lc-lt-aberto' : ''), dataset: { a: 'cfg-bloco', bloco: g.titulo },
        on: { click: () => { aberto = aberto === g.titulo ? '' : g.titulo; pintar(); } } }, h('span', { doc }, g.titulo), h('small', { doc }, `${n} ${n === 1 ? 'opção' : 'opções'} `, icone(abre ? 'aberto' : 'fechado', { doc, tam: 11 })));
      const vistos = filtro && casam.length ? casam : linhas;
      const corpoB = abre ? h('div', { doc, class: 'lc-lt-bcorpo' }, ...vistos) : null;
      if (abre && vistos.includes(som.el)) somAVista = true;
      blocos.push(h('div', { doc, class: 'lc-lt-bloco' }, cab, corpoB));
    }
    const cima = soltos.length ? [h('div', { doc, class: 'lc-lt-topo', dataset: { a: 'cfg-topo' } }, ...soltos)] : [];
    corpo.replaceChildren(...cima, ...(blocos.length ? blocos : [h('div', { doc, class: 'lc-lt-vazio' }, 'nada com esse texto')]));
    try { corpo.scrollTop = topo; } catch { /* sem layout */ }
    // só GET: abrir a ⚙ ou a seção nunca grava nada
    if (somAVista && som.precisaLer()) som.ler();
  }
  // a ⚙ abriu de novo (lateral.js): o som do client é relido na próxima vez que a seção estiver à vista
  const aoAbrir = () => som.velho();
  return { el, pintar, aoAbrir, som, estado: () => ({ aberto, filtro }) };
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
#lc-compacto .lc-lt-topo { padding:6px 12px 8px; border-bottom:1px solid rgba(60,60,65,.6); font-size:12px; color:var(--lc-txt); }
#lc-compacto .lc-lt-topo .lc-versao-linha { margin:0; }
#lc-compacto .lc-lt-topo .lc-versao-titulo { margin:0 0 6px; color:var(--lc-ouro2); font-size:12.5px; }
#lc-compacto .lc-lt-topo .lc-versao-acoes { display:flex; flex-wrap:wrap; gap:6px; }
#lc-compacto .lc-lt-topo .lc-explica { margin:4px 0 0; font-size:11px; color:var(--lc-mudo); line-height:1.35; user-select:text; }
#lc-compacto .lc-lt-topo .lc-versao-notas { margin-top:6px; max-height:140px; overflow:auto; white-space:pre-wrap; user-select:text; font-size:11px; color:var(--lc-mudo); }
#lc-compacto .lc-lt-rod { flex:none; padding:8px 10px 10px; border-top:1px solid var(--lc-linha2); display:flex; flex-direction:column; gap:4px; }
#lc-compacto .lc-lt-rod small { font-size:10.5px; color:var(--lc-mudo); }
#lc-compacto .lc-lt-riot { width:100%; }
` + CSS_SOM;
