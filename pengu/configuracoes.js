// Seção "lol-client" no modal de Configurações do client (engrenagem no topo direito).
// O client desanexa o modal ao fechar e reanexa o mesmo DOM; recarregar a interface o recria:
// um MutationObserver injeta quando falta (guarda: #lc-config-nav) e devolve o nativo ao fechar.
// Grupo próprio na navegação, nunca item dentro de uma barra nativa: o Ember mapeia índice -> seção.
// Módulos novos plugam controles sem editar este arquivo: registrarBloco(nome, renderizar).
// Seletores medidos em 13/10/2026 (patch 16.20): docs/ARMADILHAS.md.
import { ATRASOS, FREIOS } from './config.js';
import { MEDICAO, JANELA_MS } from './freios.js';

const SEL = {
  container: '.lol-settings-container',
  navs: '.lol-settings-navs',
  navLista: '.lol-settings-nav-scroller > div',
  opcoes: '.lol-settings-options',
  titulo: '.lol-settings-title',
  item: 'lol-uikit-navigation-item',
};
const POSICOES = [['TOP', 'Topo'], ['JUNGLE', 'Selva'], ['MIDDLE', 'Meio'], ['BOTTOM', 'Atirador'], ['UTILITY', 'Suporte']];
const FILAS = [[420, 'Solo/Duo'], [440, 'Flex']];

// blocos que os passos 7c (champSelect) e 7d (runas) preenchem; até lá mostram o aviso
const blocos = new Map([
  ['champSelect', { titulo: 'Champ select', vazio: 'Winrate e KDA com o campeão em hover: chega na próxima versão.' }],
  ['runas', { titulo: 'Runas por campeão', vazio: 'Troca a página de runas ao travar o campeão: chega na próxima versão.' }],
]);
let redesenhar = () => {};

// renderizar(el, ui): el é um <div> vazio dentro do bloco; ui traz cfg, definir e os construtores abaixo.
// Nome reservado (champSelect, runas) substitui o aviso; nome novo vira bloco no fim, com o nome de título.
export function registrarBloco(nome, renderizar, titulo) {
  const b = blocos.get(nome) || { titulo: titulo || nome };
  blocos.set(nome, { ...b, titulo: titulo || b.titulo, renderizar });
  redesenhar();
}

const el = (tag, attrs = {}, ...filhos) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'texto') e.textContent = v;
    else e.setAttribute(k, v);
  }
  for (const f of filhos) if (f) e.append(f);
  return e;
};

// construtores com cara de nativo (mesmas classes do client)
export const ui = {
  secao: texto => el('div', { class: 'lol-settings-general-section-title', texto }),
  explica: texto => el('p', { class: 'lc-explica', texto }),

  // caixa de marcar: lol-uikit-flat-checkbox com o input dentro (a classe 'checked' acompanha o change)
  caixa(id, rotulo, explicacao, valor, aoTrocar) {
    const input = el('input', { slot: 'input', type: 'checkbox', name: id, id: 'lc-cfg-' + id.replace(/\./g, '-') });
    input.checked = !!valor;
    input.addEventListener('change', () => aoTrocar(input.checked));
    const cb = el('lol-uikit-flat-checkbox', { class: valor ? 'checked' : '' }, input, el('label', { slot: 'label', texto: rotulo }));
    return el('div', { class: 'lol-settings-general-row lc-linha' }, cb, explicacao && ui.explica(explicacao));
  },

  // lista suspensa: lol-uikit-framed-dropdown; o clique na opção marca 'selected' sozinho
  lista(id, rotulo, opcoes, valor, aoTrocar) {
    const dd = el('lol-uikit-framed-dropdown', { tabindex: '0', 'data-cfg': id });
    for (const [v, nome] of opcoes) {
      const o = el('lol-uikit-dropdown-option', { slot: 'lol-uikit-dropdown-option', 'data-v': String(v), texto: nome });
      if (v === valor) o.setAttribute('selected', '');
      dd.append(o);
    }
    dd.addEventListener('click', e => {
      const o = e.target.closest?.('lol-uikit-dropdown-option');
      if (!o) return;
      const v = opcoes.find(([x]) => String(x) === o.dataset.v)?.[0];
      if (v !== undefined && v !== valor) aoTrocar(v);
    });
    return el('div', { class: 'lc-campo' }, el('div', { class: 'lol-settings-window-size-text', texto: rotulo }), dd);
  },

  linha: (...filhos) => el('div', { class: 'lol-settings-general-row lc-campos' }, ...filhos),
};

function montar(painel, cfg, definir, restaurar) {
  const topo = painel.scrollTop;
  painel.replaceChildren();
  const add = (...n) => painel.append(...n);
  const caixa = (caminho, rotulo, explicacao) => {
    const valor = caminho.split('.').reduce((o, k) => o?.[k], cfg);
    return ui.caixa(caminho, rotulo, explicacao, valor, v => definir(caminho, v));
  };
  // 1ª e 2ª posição nunca iguais: escolher a da outra troca as duas
  const posicao = (minha, outra, rotulo) => ui.lista('filaRapida.' + minha, rotulo, POSICOES, cfg.filaRapida[minha], v => {
    if (v === cfg.filaRapida[outra]) cfg.filaRapida[outra] = cfg.filaRapida[minha];
    definir('filaRapida.' + minha, v);
  });

  add(ui.secao('Interface'),
    caixa('esconderTft', 'Esconder TFT', 'Tira a aba TFT da barra de cima e o card TFT da tela de modos.'),
    caixa('colunaLarga', 'Coluna larga das filas', 'Alarga a lista de filas do modo selecionado na tela de jogar.'),
    caixa('extras.esconderEvento', 'Esconder aba de evento', 'Tira da barra de cima a aba do evento da temporada.'),
    caixa('extras.esconderClassic', 'Esconder aba CLASSIC', 'Tira da barra de cima a aba CLASSIC.'),
    caixa('extras.esconderLoja', 'Esconder loja', 'Tira da barra de cima a aba da loja.'));

  add(ui.secao('Aceitar partida'),
    caixa('aceite.ligado', 'Aceitar partida automaticamente', 'Mostra a contagem quando a partida aparece e aceita sozinho; "não aceitar" cancela daquela vez.'),
    ui.linha(ui.lista('aceite.atrasoS', 'Aceitar depois de', ATRASOS.map(s => [s, s + ' s']), cfg.aceite.atrasoS, v => definir('aceite.atrasoS', v))),
    ui.explica(`Conta pelo relógio do servidor; ${cfg.aceite.limiteS - 2} s é o máximo seguro (a janela da Riot é de ~${cfg.aceite.limiteS} s).`),
    caixa('aceite.trazerClient', 'Trazer o client para a frente ao achar partida', 'Desligado (padrão), com o aceite automático: se tu estava em outra janela, o client pisca e some de novo (o Windows devolve a janela de antes); no champ select ele volta sozinho.'),
    caixa('aceite.esconderPopup', 'Esconder o popup de partida encontrada', 'Some a janela de aceitar do client; a contagem do lol-client continua. Só vale com o aceite automático ligado.'),
    caixa('aceite.silenciarSom', 'Silenciar o som depois de aceitar', 'Ligado (padrão): corta o som em loop que toca depois que tu aceita, até todos aceitarem. O aviso de partida encontrada continua tocando.'),
    caixa('coach.aceiteFlutuante', 'Aceitar ou recusar fora do client', 'Janelinha no canto da tela, por cima de tudo e sem roubar o foco, com a contagem e os botões "aceitar agora" e "recusar". Precisa do coletor ligado.'));

  add(ui.secao('Fila rápida'),
    caixa('filaRapida.ligado', 'Botão fila rápida', 'Botão ao lado do jogar: um clique monta o lobby com as tuas posições e entra na fila.'),
    ui.linha(ui.lista('filaRapida.fila', 'Fila ranqueada', FILAS, cfg.filaRapida.fila, v => definir('filaRapida.fila', v)),
      posicao('pos1', 'pos2', '1ª posição'), posicao('pos2', 'pos1', '2ª posição')),
    caixa('filaRapida.jogarDeNovo', 'Botão "jogar de novo" no pós-jogo', 'Um clique volta ao lobby da mesma fila da partida, põe as tuas posições e busca. Em grupo só volta ao lobby: quem busca é o líder. Nunca busca sozinho.'),
    ui.linha(ui.lista('filaRapida.freioTilt', 'Pedir confirmação depois de', FREIOS.map(n => [n, n ? `${n} derrotas seguidas` : 'nunca']),
      cfg.filaRapida.freioTilt, v => definir('filaRapida.freioTilt', v))),
    ui.explica(`Freio de tilt: com essa sequência de derrotas na sessão, a fila rápida e o "jogar de novo" pedem um segundo clique em até ${JANELA_MS / 1000} s. Depois de 2 derrotas seguidas teu winrate cai para ${MEDICAO.wrDepoisDe2}% (${MEDICAO.partidas} partidas, ${MEDICAO.data}).`),
    caixa('filaRapida.freioMadrugada', 'Pedir confirmação de madrugada (1h–6h)', `Entre 01:00 e 05:59 (hora do PC), a fila rápida e o "jogar de novo" pedem um segundo clique. De madrugada teu winrate é ${MEDICAO.wrMadrugada}%, contra ${MEDICAO.wrDia}% de dia.`));

  add(ui.secao('Recompensas'),
    caixa('recompensas.ligado', 'Coletar recompensas sozinho', 'Ao abrir o client e 30 s depois de cada partida, pega as recompensas que não têm escolha (concessões, trilha do evento); de cada tipo, pega uma primeiro e confere antes do resto. Nunca abre baú, cria, desencanta nem compra; recompensa de escolher fica para ti, com aviso.'),
    caixa('recompensas.tft', 'Incluir o passe do TFT', 'Também coleta os prêmios liberados do passe do TFT.'));

  add(ui.secao('Pós-jogo'),
    caixa('posjogo.ligado', 'Painel pós-jogo', 'Ao fim da partida, abre a análise: mapa com o trajeto, mortes e diferença contra o adversário de rota.'));

  for (const [nome, b] of blocos) {
    const corpo = el('div', { class: 'lc-bloco', 'data-bloco': nome });
    add(ui.secao(b.titulo), corpo);
    if (!b.renderizar) { corpo.append(ui.explica(b.vazio || '')); continue; }
    try { b.renderizar(corpo, { cfg, definir, ui }); }
    catch (e) { console.error('[lol-client] bloco', nome, e); corpo.replaceChildren(ui.explica('Erro ao montar este bloco.')); }
  }

  // sem restaurar (painel do compacto, passo 13 B1): "restaurar padrão" fica só no client normal (um clique errado apagaria tudo)
  if (restaurar) {
    const botao = el('lol-uikit-flat-button-secondary', { class: 'lc-restaurar', texto: 'Restaurar padrão do lol-client' });
    botao.addEventListener('click', restaurar);
    add(el('div', { class: 'lol-settings-general-row lc-rodape' }, botao));
  }
  painel.scrollTop = topo;
  // o foco do input clicado (desanexado na remontagem) faz o scrollable rolar depois: segura de novo no quadro seguinte
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { if (Math.abs(painel.scrollTop - topo) > 1) painel.scrollTop = topo; });
}

// Os mesmos blocos e chaves dentro do painel de configurações do client compacto (compacto/lateral-config.js, passo 13 B1):
// mesmo cfg, gravado na hora pelo definir; sem o "restaurar padrão".
export function montarPainel(painel, { cfg, definir }) { montar(painel, cfg, definir, null); }

// liga a seção; cfg/definir/aoMudar/restaurar vêm do config.js
export function iniciarConfiguracoes({ cfg, definir, aoMudar, restaurar }) {
  // o client não destrói o modal ao fechar: desanexa e reanexa o MESMO DOM. Por isso tudo aqui
  // trabalha sobre o elemento guardado (visto), não sobre document.getElementById.
  let visto = null, aberto = false;
  const container = () => document.querySelector(SEL.container);
  const ativo = c => !!c?.classList.contains('lc-ativo');
  const painel = c => c?.querySelector('#lc-config-painel');

  redesenhar = () => {
    const p = painel(visto);
    if (p) montar(p, cfg, definir, restaurar);
  };
  aoMudar(() => redesenhar());

  const ativar = c => {
    const opcoes = c?.querySelector(SEL.opcoes);
    if (!opcoes) return;
    // apaga só o destaque das seções nativas; o selectedindex das barras é do Ember e fica intacto
    for (const i of c.querySelectorAll(`${SEL.navs} ${SEL.item}:not(#lc-config-nav)`)) i.removeAttribute('active');
    c.querySelector('#lc-config-nav')?.setAttribute('active', 'true');
    c.querySelector('#lc-config-barra')?.setAttribute('selectedindex', '0');
    c.classList.add('lc-ativo');
    let p = painel(c);
    if (!p) {
      p = el('lol-uikit-scrollable', { id: 'lc-config-painel', 'overflow-masks': 'enabled' });
      opcoes.append(p);
    }
    montar(p, cfg, definir, restaurar);
    p.scrollTop = 0;
  };

  // destaque nativo = item na posição selectedindex de cada barra (quem manda no índice é o Ember;
  // ao reabrir o modal ele volta sozinho para GERAL, e clicar na seção já marcada não muda o índice)
  const sincronizarDestaque = c => {
    if (!c || ativo(c)) return;
    for (const b of c.querySelectorAll(`${SEL.navs} lol-uikit-navigation-bar:not(#lc-config-barra)`)) {
      const sel = Number(b.getAttribute('selectedindex'));
      [...b.children].filter(i => i.matches(SEL.item)).forEach((i, n) => {
        if (n === sel) { if (!i.hasAttribute('active')) i.setAttribute('active', 'true'); }
        else i.removeAttribute('active');
      });
    }
  };

  // volta ao nativo: o conteúdo do Ember nunca saiu do lugar, só estava escondido
  const desativar = c => {
    if (!c) return;
    c.classList.remove('lc-ativo');
    painel(c)?.remove();
    c.querySelector('#lc-config-nav')?.removeAttribute('active');
    c.querySelector('#lc-config-barra')?.setAttribute('selectedindex', '-1');
    // depois do uikit e do Ember processarem o clique ou a reabertura
    requestAnimationFrame(() => requestAnimationFrame(() => sincronizarDestaque(c)));
  };

  const injetar = () => {
    const c = container(), lista = c?.querySelector(SEL.navLista);
    // modal fechou (desanexado): reabre no nativo, como o client faria
    if (!c) {
      if (aberto && ativo(visto)) desativar(visto);
      aberto = false;
      return;
    }
    if (!aberto) requestAnimationFrame(() => requestAnimationFrame(() => sincronizarDestaque(c))); // reabriu
    aberto = true;
    visto = c;
    if (!lista || c.querySelector('#lc-config-nav')) return;
    if (!lista.querySelector(SEL.item)) return; // Ember ainda montando a navegação
    const item = el('lol-uikit-navigation-item', { id: 'lc-config-nav', class: 'lol-settings-nav', name: 'lc-config' }, el('div', { texto: 'LOL-CLIENT' }));
    const barra = el('lol-uikit-navigation-bar', { id: 'lc-config-barra', direction: 'down', type: 'tabbed', selectedindex: '-1' }, item);
    lista.prepend(el('div', { id: 'lc-config-grupo' }, el('div', { class: 'lol-settings-nav-title', texto: 'Plugins' }), barra));

    const titulo = c.querySelector(SEL.titulo);
    const quebra = titulo?.querySelector('.lol-settings-title-break')?.textContent ?? ' / ';
    // um invólucro só, com espaços entre as partes como no template nativo
    titulo?.append(el('span', { class: 'lc-titulo' }, el('span', { class: 'lol-settings-header-group-name', texto: 'Plugins' }), ' ',
      el('span', { class: 'lol-settings-title-break', texto: quebra }), ' ',
      el('span', { class: 'lol-settings-title-current', texto: 'lol-client' })));

    // captura: decide antes do uikit e do Ember; seção nativa clicada devolve o conteúdo nativo
    c.querySelector(SEL.navs).addEventListener('click', e => {
      const alvo = e.target.closest?.(SEL.item);
      if (!alvo) return;
      if (alvo.id === 'lc-config-nav') ativar(c);
      else if (ativo(c)) desativar(c);
    }, true);
  };

  const ligarDom = () => {
    let pendente = false;
    new MutationObserver(() => {
      if (pendente) return;
      pendente = true;
      requestAnimationFrame(() => { pendente = false; try { injetar(); } catch (e) { console.error('[lol-client] configurações', e); } });
    }).observe(document.body, { childList: true, subtree: true });
    injetar();
  };
  if (document.body) ligarDom();
  else document.addEventListener('DOMContentLoaded', ligarDom, { once: true });

  return { registrarBloco, ativar: () => ativar(container()), desativar: () => desativar(container()) };
}
