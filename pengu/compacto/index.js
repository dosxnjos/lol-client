// Client compacto: roteador por fase (roadmap/2026-10-13-client-compacto.md, passo 3).
// Cada fase do gameflow tem destino (destinoDaFase); o roteador decide se a camada compacta aparece, qual tela
// monta e quando o client volta ao normal. Telas: pengu/compacto/tela-<nome>.js (contrato abaixo), carregadas sob
// demanda; tela que não existe ou falha = client normal, nunca tela quebrada (dodge no champ select custa PDL).
// Importável no node (tools/teste-compacto.mjs): o DOM só entra em iniciarCompacto.
//
// ---- contrato das telas ----
// export function montar(raiz, ctx)   // obrigatório; pode ser async. Erro (throw ou Promise rejeitada) = expande.
// export function desmontar(raiz, ctx) // opcional; o roteador já limpa raiz, título, extras, timers e assinaturas.
// export function atualizar(ctx)       // opcional; fase mudou sem mudar de tela (None->Lobby, WaitingForStats->
//                                      // EndOfGame). Sem ele o roteador desmonta e monta de novo.
// ctx = {
//   cfg, servicos ({context, fila, champ, runas, posjogo, coletor, ...} do pengu/index.js), tela (nome),
//   fase (getter, fase atual), info (getter: {lida, fila, mapa, custom} da sessão do gameflow),
//   raiz (corpo), titulo (slot à esquerda do topo), extras (slot antes do "expandir": 💬, etc.),
//   lcu(metodo, url, corpo) -> {ok, status, json} (nunca lança; comum.lcu),
//   observar(uri, cb)    // evento da LCU (WAMP {data, eventType, uri}); some sozinho ao desmontar; erro no cb = expande
//   tempo(fn, ms), intervalo(fn, ms) // limpos ao desmontar; erro = expande
//   seguro(fn)           // embrulha handler de clique/promise: erro = expande; no-op depois de desmontada
//   vivo()               // false depois de desmontada (trabalho async confere antes de pintar)
//   falhou(erro)         // erro tratado pela tela que deve devolver o client normal
//   expandir()           // clique do Gabriel que leva ao client normal (ex.: "ver análise completa")
//   ceder(motivo)        // a tela é da Riot (decisão da tela, sem clique dele): client normal até a virada de destino
//   avisar(msg, erro)    // aviso curto dentro da camada
// }
// Linhas que não se cruzam (plano § guardrails): busca só por clique e pelos freios (freios.js); nome oculto nunca;
// nada decide pelo jogador; nunca tecla ou clique no jogo.
import { criarJanela, criarCamada, criarBotaoModo, criarArrasto, invocadorRiot, ehAtalho, CSS, GRACA_MEDIDA_MS, tamanho } from './modo.js';
import { lcu as lcuPadrao, avisar as avisarPadrao, estilo, FASES_JOGO } from './comum.js';
import { criarGeometria, lerTelaRiot, quadroDaPagina, esperarTamanhoDaPagina } from './geometria.js';
import { criarLateral, CSS_LATERAL } from './lateral.js';
import { criarFundo } from './fundo.js';
import { criarRegistroExpansoes, descreverCamada, textoSeguro, enviarAoColetor } from './expansoes.js';
import { coletor as coletorPadrao, destinoDe } from '../coach.js';

export const FASES = ['None', 'Lobby', 'Matchmaking', 'ReadyCheck', 'ChampSelect', 'GameStart', 'InProgress', 'Reconnect',
  'FailedToLaunch', 'TerminatedInError', 'WaitingForStats', 'PreEndOfGame', 'EndOfGame'];
export const FILAS_CHAMPSELECT = [420, 440, 400]; // seleção do SR com ban e posição (ARAM 450 expande: decisão do plano)
export const MAPA_SR = 11;
export const MAPAS_JOGO = [11, 12]; // tela compacta da partida (passo 14): Summoner's Rift e ARAM
export const TELAS = { lobby: './tela-lobby.js', fila: './tela-fila.js', champselect: './tela-champselect.js', posjogo: './tela-posjogo.js',
  honra: './tela-honra.js', jogo: './tela-jogo.js' };
export { FASES_JOGO };
// PreEndOfGame (passo 12): a etapa vem do GET/evento /lol-pre-end-of-game/v1/currentSequenceEvent ({name}). Só honor-vote tem
// tela compacta; celebração (subir de elo, desafio, missões) expande, mas só depois de ficar SEQ_FIRME_MS (vazias passam em
// < 0,1 s e expandir nelas faria a janela piscar 420 -> 1280 -> 420 toda partida). Etapa não lida em ESPERA_SEQ_MS: expande.
export const SEQ_HONRA = 'honor-vote';
export const SEQ_FIRME_MS = 600;
export const ESPERA_SEQ_MS = 2000;
// '' (nenhuma etapa) depois da honra: a Riot troca de etapa ou de fase em < 1 s; parado mais que isso, expande (revisão de
// 14/10/2026: sem prazo, a tela ficava presa no PreEndOfGame e escondia o que a Riot abrisse por baixo)
export const ESPERA_POS_HONRA_MS = 4000;
// etapas que a Riot passa sozinha (etapa 5 do roadmap/2026-10-17-telas-que-expandem.md): medido em 15/10/2026 que a
// challenge-level-up-celebration vira EndOfGame sozinha em ~2,5 e ~6,7 s, sem clique, e nenhum front da Riot posta o "complete" dela.
// Fica na tela de antes (a da honra) até ESPERA_CELEBRACAO_MS; passou disso, expande como as outras. A vinheta com botão
// (.vignette-celebration) segue na regra 7. missions-celebration e ranked-celebration continuam expandindo (SEQ_FIRME_MS).
// Reverte: tirar o nome da lista
export const SEQ_SOZINHAS = ['challenge-level-up-celebration'];
export const ESPERA_CELEBRACAO_MS = 10000;
export const MOTIVO_CONFIG_RIOT = 'configurações da Riot (abertas por você)'; // forcar() e a volta comparam o mesmo texto
export const CLASSE = 'lc-modo-compacto'; // no <html> enquanto a camada está à vista (lc-compacto é a chave ligada)
// champ select sem a sessão do gameflow lida: espera isso, relê a sessão uma vez (GET), espera de novo e só então expande (4 s no
// total). Etapa 1 do roadmap/2026-10-17-telas-que-expandem.md: em 15/10 13:50 o GET da entrada travou ~6 s (client ocupado) e a
// ranqueada expandiu 1 s por "fila desconhecida"
export const ESPERA_SESSAO_MS = 2000;
export const CONTAGEM_MS = 1500; // ready check sem o #lc-aceite visto até aqui: expande (o popup da Riot fica embaixo da camada)
export const MODAL_RC_MS = 1000; // "modal" no ready check: confere de novo depois disso antes de expandir (aoModal)
// volta ao compacto quando a janela da Riot que expandiu (regra 7) fecha (etapa 6 do roadmap/2026-10-17-telas-que-expandem.md): em
// 15/10/2026, depois do "GGWP" no aviso de punição, ele ficou no client normal o pós-jogo inteiro (40 e 61 s) e chegou a desligar e
// religar o compacto. Confere a cada CONFERE_MODAL_MS; nenhuma camada da regra 7 por VOLTA_MODAL_MS (cobre 2 modais em sequência,
// como o Vanguard) = volta. Não vale no ready check (regra própria) nem nas Configurações pelo painel (volta própria)
export const VOLTA_MODAL_MS = 1500;
export const CONFERE_MODAL_MS = 250;
// depois dessa volta, a releitura segue por GRACA_VOLTA_MS: "fechou" aqui = nenhuma camada visível (getClientRects vazio conta como
// fechada) e a vigia só vê nó novo; janela da Riot que só se escondeu e reaparece sem nó novo expande de novo (revisão adversarial de
// 17/10/2026). Reverte: 0
export const GRACA_VOLTA_MS = 5000;
// registro das expansões (passo 15): ctx.expandir() até GESTO_MS depois de um clique/tecla dele conta como dele; o aviso da tela
// (ctx.avisar) até AVISO_MS antes da expansão vai junto no evento (só palavras do vocabulário de interface: textoSeguro)
export const GESTO_MS = 1500;
export const AVISO_MS = 1500;

// Regra 7 (telas da Riot que surgem sozinhas): camadas filhas de #lol-uikit-layer-manager-wrapper. Medido no
// rcp-fe-lol-uikit 16.20 (13/10/2026): modal = div.modal; drawer/popout = lol-uikit-full-page-backdrop;
// celebração = .vignette-celebration / .dialog-toast-celebration. Fora: .tooltip, .flyout*, lol-social-chat-window
// (mora lá o tempo todo), notificações contextuais, toast simples.
export const MODAIS = {
  gatilho: ['.modal', 'lol-uikit-full-page-backdrop', '.vignette-celebration', '.dialog-toast-celebration', '.first-touch-modal', '.identity-modal'],
  // conhecidos: só o popup do ready check (aceite.js é dono). As Configurações (.lol-settings-container) NÃO: com a
  // camada à vista elas ficariam abertas e invisíveis atrás dela (inclusive o bloco que desliga o compacto); a Riot
  // reanexa o mesmo DOM ao reabrir (ARMADILHAS § Client), então reabrir também dispara a vigia e expande
  conhecidos: ['.ready-check-root-element'],
};

// espectador (etapa 2 do roadmap/2026-10-17-telas-que-expandem.md): medido em 16/10/2026 que assistir a um amigo entra na fase
// ChampSelect (timer GAME_STARTING = atraso do espectador) e depois InProgress, nunca WatchInProgress. O sinal é o isSpectating da
// /lol-champ-select/v1/session (nunca localPlayerCellId -1 sozinho: aparece no início de uma seleção real ainda sem sessão)
export const MOTIVO_ASSISTINDO = 'assistindo a uma partida: tela da Riot';
export const FASES_POS = ['WaitingForStats', 'PreEndOfGame', 'EndOfGame'];
// seleção que começa no menu inicial (fase anterior None ou Lobby: sem ReadyCheck) espera o isSpectating da sessão da seleção antes
// de montar a tela compacta (decisão D1 de 17/10/2026): a seleção assistida não pisca a tela da seleção antes de ceder. Medido no
// medidor de 14–16/10: a sessão da seleção chega 41–91 ms depois da fase nas 8 entradas None/Lobby (3 assistidas, 5 personalizadas);
// a tela da seleção mostra "lendo a seleção…" até essa mesma sessão. A ranqueada e a normal vêm do ReadyCheck e nunca esperam.
// Sem confirmação no prazo, segue a regra de antes (monta). Reverte: 0
export const ESPERA_SELECAO_MS = 1000;
export const FASES_ANTES_ESPERA_SELECAO = ['None', 'Lobby'];

// info: {lida, fila, mapa, custom, aceiteLigado, aceiteVivo, aceiteManual, assistindo} -> {tipo: 'tela'|'jogo'|'expandir'|'esperar', tela?, motivo?}
// aceiteVivo === false: o aceite.js falhou no init (index.js: seguro() devolveu null); undefined = não sei, vale o ligado
export function destinoDaFase(fase, info = {}) {
  // partida assistida: a seleção, a partida e o fim dela são telas da Riot do começo ao fim (antes das regras de fila/mapa)
  if (info.assistindo) {
    if (fase === 'ChampSelect') return { tipo: 'expandir', motivo: MOTIVO_ASSISTINDO };
    if (FASES_JOGO.includes(fase)) return { tipo: 'jogo', motivo: 'assistindo a uma partida: client normal embaixo do jogo' };
    if (FASES_POS.includes(fase)) return { tipo: 'expandir', motivo: 'fim de uma partida assistida: tela da Riot' };
  }
  switch (fase) {
    case 'None': case 'Lobby': return { tipo: 'tela', tela: 'lobby' };
    case 'Matchmaking': return { tipo: 'tela', tela: 'fila' };
    case 'ReadyCheck':
      // a janela pequena corta o popup da Riot (modal de 1280): só fica no compacto quando o #lc-aceite vai mesmo aceitar
      if (!info.aceiteLigado) return { tipo: 'expandir', motivo: 'aceite automático desligado: o popup da Riot decide' };
      if (info.aceiteVivo === false) return { tipo: 'expandir', motivo: 'o aceite automático não subiu nesta carga: o popup da Riot decide' };
      if (info.aceiteManual) return { tipo: 'expandir', motivo: 'o popup da Riot voltou (aceite manual)' };
      // a camada cobre o popup da Riot: sem a contagem do aceite.js à vista, ele ficaria sem botão (14/10 10:10 o JS
      // do aceite não agiu). O roteador só marca isso depois de CONTAGEM_MS sem ver o #lc-aceite neste ready check
      if (info.semContagem) return { tipo: 'expandir', motivo: 'a contagem do aceite não apareceu: o popup da Riot decide' };
      // a tela da fila fica de pé ("partida encontrada") por baixo do #lc-aceite (z 100002 > camada 100000). Até
      // 14/10/2026 o ready check tirava a camada ("ceder") e a janela de 420 mostrava a tela da Riot de 1280 cortada
      // pelo ready check inteiro (ranqueada das 14:43, com 2 ready checks: ARMADILHAS § Client)
      return { tipo: 'tela', tela: 'fila' };
    case 'ChampSelect': {
      if (!info.lida) return { tipo: 'esperar', motivo: 'lendo a fila da seleção' };
      // vinda do menu inicial: espera o isSpectating (ESPERA_SELECAO_MS) antes de qualquer destino da seleção
      if (info.esperaSelecao) return { tipo: 'esperar', motivo: 'conferindo se é uma partida assistida' };
      const fila = Number(info.fila) || 0, mapa = Number(info.mapa) || 0;
      if (mapa && mapa !== MAPA_SR) return { tipo: 'expandir', motivo: 'seleção fora do Summoner\'s Rift (ARAM e outros): tela da Riot' };
      if (FILAS_CHAMPSELECT.includes(fila) || (info.custom && mapa === MAPA_SR)) return { tipo: 'tela', tela: 'champselect' };
      return { tipo: 'expandir', motivo: `seleção da fila ${fila || 'desconhecida'}: tela da Riot` };
    }
    // partida (passo 14, relato de 14/10/2026 ~20:50: "o modo compacto sai assim que a partida inicia"): a tela "partida em
    // andamento" fica atrás do jogo. Até aqui GameStart/InProgress tiravam a camada e Reconnect expandia. As 3 fases têm a
    // mesma chave (tela:jogo): o "⤢ expandir" dele vale a partida inteira e o botão RECONECTAR aparece pela fase
    // Só Summoner's Rift e ARAM (revisão adversarial, achado 10): TFT, Arena e outros modos não têm "teu time × inimigos" nem
    // campeão do jogador e voltam ao de antes do passo 14 (client normal). Mapa não lido = tela de jogo (não espera nem bloqueia).
    // Espectador NÃO é outra fase (medido em 16/10/2026: assistir passa por ChampSelect e InProgress): vem pelo info.assistindo,
    // tratado no topo desta função
    case 'GameStart': case 'InProgress': case 'Reconnect': {
      const mapa = Number(info.mapa) || 0;
      if (info.lida && mapa && !MAPAS_JOGO.includes(mapa)) return { tipo: 'jogo', motivo: `partida no mapa ${mapa} (TFT, Arena...): client normal` };
      return { tipo: 'tela', tela: 'jogo' };
    }
    // a Riot abre o modal de crash report nessas fases (_gameflowStateCallback do rcp-fe-lol-navigation 16.20) e não há ação
    // segura conhecida para um botão nosso: tela da Riot
    case 'FailedToLaunch': case 'TerminatedInError': return { tipo: 'expandir', motivo: 'o jogo não abriu ou caiu: tela da Riot' };
    case 'WaitingForStats': return { tipo: 'tela', tela: 'posjogo' };
    case 'PreEndOfGame': {
      // info.seq: nome da etapa (undefined = ainda não lida); seqFirme: a etapa ficou SEQ_FIRME_MS; seqEsgotou: sem etapa
      // (não lida ou '') por tempo demais (o roteador conta: ESPERA_SEQ_MS antes da honra, ESPERA_POS_HONRA_MS depois)
      if (info.seq === SEQ_HONRA) return { tipo: 'tela', tela: 'honra' };
      if (typeof info.seq !== 'string') return info.seqEsgotou ? { tipo: 'expandir', motivo: 'etapa do fim de partida sem leitura: tela da Riot' }
        : { tipo: 'esperar', motivo: 'lendo a etapa do fim de partida' };
      // '' = nenhuma etapa: na entrada (a honra vem ~0,1 s depois) ou no fim da honra (a Riot já vai trocar); parado, expande
      if (!info.seq) return info.seqEsgotou ? { tipo: 'expandir', motivo: 'fim de partida sem etapa da Riot: tela da Riot' }
        : { tipo: 'esperar', motivo: 'entre duas etapas do fim de partida' };
      // etapa que a Riot passa sozinha: espera na tela de antes; parada demais (seqLonga), expande
      if (SEQ_SOZINHAS.includes(info.seq)) return info.seqLonga ? { tipo: 'expandir', motivo: `etapa do fim de partida da Riot (${info.seq}) parada: tela da Riot` }
        : { tipo: 'esperar', motivo: `etapa ${info.seq}: a Riot passa sozinha` };
      return info.seqFirme ? { tipo: 'expandir', motivo: `etapa do fim de partida da Riot (${info.seq}): celebração e telas novas expandem` }
        : { tipo: 'esperar', motivo: `etapa ${info.seq}: esperando ver se fica` };
    }
    case 'EndOfGame': return { tipo: 'tela', tela: 'posjogo' };
    default: return { tipo: 'expandir', motivo: `fase desconhecida (${fase ?? 'sem leitura'})` };
  }
}

// guarda da tarefa assíncrona da geometria (ativo() de criarGeometria): só com o compacto à vista E fora das fases de jogo.
// Revisão adversarial do passo 14 (achado 1): fechar ⚙ nos últimos ms da seleção enfileira um aplicar; a fase vira GameStart
// durante o ScreenData e, com a tela "jogo" compacta, "efetivo === compacto" seguia verdadeiro: saíam ResizeTo + MoveTo com o
// jogo abrindo. Prova: teste-compacto-lateral.mjs ("corrida ⚙ fechada + GameStart")
export function geometriaAtiva(e) {
  return !!e && e.efetivo === 'compacto' && !FASES_JOGO.includes(e.fase);
}

// o alvo de um clique/tecla está na camada do compacto (#lc-compacto: coluna, lateral, configurações)? Clique no client normal da
// Riot (ex.: "Assistir", 16/10/2026) não é pedido de uma tela compacta (etapa 3 de roadmap/2026-10-17-telas-que-expandem.md)
export function gestoDentro(doc, alvo) {
  try {
    const c = doc?.getElementById?.('lc-compacto');
    return !!c && !!alvo && (c === alvo || !!c.contains?.(alvo));
  } catch { return false; }
}

// algo espera o foco (est.adiado) e a página tem o foco agora -> reavaliar (iniciarCompacto relê a cada FOCO_RELE_MS)
export const FOCO_RELE_MS = 500;
export function voltouAoClient(e, foco) {
  return !!e?.adiado && foco === true;
}

// info da sessão do gameflow (só o que roteia; nada de identidade)
export function infoDaSessao(s) {
  const gd = s?.gameData || {};
  const fila = Number(gd.queue?.id), mapa = Number(s?.map?.id ?? gd.queue?.mapId);
  return { lida: true, fila: fila > 0 ? fila : null, mapa: mapa > 0 ? mapa : null, custom: !!gd.isCustomGame };
}

// camada da Riot que manda expandir -> descrição curta | null. el = filho direto do wrapper.
export function classificarCamada(el) {
  if (!el || el.nodeType !== 1) return null;
  const casa = sel => { try { return !!el.matches?.(sel); } catch { return false; } };
  const contem = sel => { try { return casa(sel) || !!el.querySelector?.(sel); } catch { return false; } };
  const gatilho = MODAIS.gatilho.find(casa);
  if (!gatilho) return null;
  if (MODAIS.conhecidos.some(contem)) return null;
  try { if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return null; } catch { /* conta como visível */ }
  return gatilho.replace(/^\./, '');
}

// camadas da Riot à vista agora (registro das expansões, passo 15): filhos do wrapper menos o chat, sem identidade
// (expansoes.descreverCamada), cada uma com o que a regra 7 diria dela (expande: desc | null). Até 6
export function descreverCamadas(doc = globalThis.document) {
  try {
    const w = doc?.getElementById?.('lol-uikit-layer-manager-wrapper');
    return Array.from(w?.children || []).filter(c => c.tagName !== 'LOL-SOCIAL-CHAT-WINDOW').slice(0, 6)
      .map(c => ({ ...descreverCamada(c), expande: classificarCamada(c) }));
  } catch { return []; }
}

// Vigia da camada de modais. O wrapper nasce preguiçoso (getter domNode do uikit só anexa no 1º uso): observa o
// #lol-uikit-layer-manager até ele existir. aoModal(desc) com 250 ms de folga (o conteúdo do modal chega depois da
// camada; o do ready check precisa estar dentro para ser reconhecido).
export function criarVigiaModais({ doc = globalThis.document, aoModal, agendar = setTimeout, limpar = clearTimeout, folgaMs = 250 }) {
  let obsWrapper = null, obsManager = null, timer = null, wrapper = null;
  // medição da regra 7 (passo 1 do plano): o que apareceu no wrapper, só tag e classes (nunca texto), últimas 30
  const visto = [];
  const aberto = () => {
    const w = doc.getElementById?.('lol-uikit-layer-manager-wrapper');
    if (!w) return null;
    for (const c of Array.from(w.children || [])) { const d = classificarCamada(c); if (d) return d; }
    return null;
  };
  const anotar = () => {
    const w = doc.getElementById?.('lol-uikit-layer-manager-wrapper');
    const camadas = Array.from(w?.children || []).filter(c => c.tagName !== 'LOL-SOCIAL-CHAT-WINDOW').map(c => ({
      tag: String(c.tagName || '').toLowerCase(), classes: String(c.className || '').slice(0, 80),
      filho: String(c.children?.[0]?.className || c.children?.[0]?.tagName || '').slice(0, 80), expande: classificarCamada(c),
    }));
    const chave = JSON.stringify(camadas);
    if (camadas.length && visto.at(-1)?.chave !== chave) visto.push({ em: new Date().toISOString(), chave, camadas });
    if (visto.length > 30) visto.shift();
  };
  const conferir = () => {
    limpar(timer);
    timer = agendar(() => {
      timer = null;
      try { anotar(); } catch { /* só medição */ }
      const d = aberto();
      if (d) aoModal?.(d);
    }, folgaMs);
  };
  const ligarWrapper = () => {
    const w = doc.getElementById?.('lol-uikit-layer-manager-wrapper');
    if (!w || w === wrapper || typeof MutationObserver === 'undefined') return !!w;
    obsWrapper?.disconnect();
    wrapper = w;
    obsWrapper = new MutationObserver(ms => { if (ms.some(m => m.addedNodes?.length)) conferir(); });
    obsWrapper.observe(w, { childList: true });
    return true;
  };
  // o manager também nasce por JS (rcp-fe-lol-uikit, inicializado assíncrono pelo plugin-runner; não está no
  // index.html estático, conferido por GET em 13/10/2026): se o DOMContentLoaded chegou antes dele, observa o <body>
  // até ele aparecer e só então desliga essa vigia larga (sem isso a regra 7 ficava cega a sessão inteira)
  let obsCorpo = null;
  const ligarManager = () => {
    const m = doc.getElementById?.('lol-uikit-layer-manager');
    if (!m || obsManager) return !!m;
    obsManager = new MutationObserver(() => { if (ligarWrapper()) conferir(); });
    obsManager.observe(m, { childList: true });
    return true;
  };
  const ligar = () => {
    if (typeof MutationObserver === 'undefined') return;
    ligarWrapper();
    if (ligarManager()) { if (wrapper) conferir(); return; }
    if (obsCorpo || !doc.body) return;
    obsCorpo = new MutationObserver(() => {
      if (!ligarManager()) return;
      obsCorpo.disconnect(); obsCorpo = null;
      if (ligarWrapper() || wrapper) conferir();
    });
    obsCorpo.observe(doc.body, { childList: true, subtree: true });
  };
  return { ligar, aberto, conferir, ligado: () => ({ manager: !!obsManager, wrapper: !!obsWrapper, esperando: !!obsCorpo }),
    historico: () => visto.map(({ em, camadas }) => ({ em, camadas })) };
}

const dormir = (agendar, ms) => new Promise(r => agendar(r, ms));

// Núcleo testável. janela: criarJanela(); camada: {montar() -> {raiz, titulo, extras}, remover()};
// carregarTela(nome) -> Promise<módulo> (rejeita/sem montar = tela não existe); assinar(uri, cb): socket da LCU;
// classe(bool): html.lc-modo-compacto; modalAberto() -> desc|null; aceiteManual() -> bool; aoAplicar(estado).
export function criarRoteador({
  cfg, janela, camada, carregarTela, servicos = {}, lcu = lcuPadrao, avisar = avisarPadrao,
  log = (...a) => console.log('[lol-client] compacto:', ...a), assinar = () => {}, classe = () => {},
  modalAberto = () => null, aceiteManual = () => false, aceiteVivo = () => undefined, aoAplicar = () => {},
  contagemNaTela = () => undefined, // #lc-aceite no DOM? (undefined = não sei: não expande por isso)
  // a página tem o foco? (document.hasFocus()). Em InProgress, sem foco = o jogo na frente: o roteador não mexe na janela
  // (ResizeTo/MoveTo/CenterToScreen) até ele voltar ao client (passo 14; o iniciarCompacto relê no evento focus)
  temFoco = () => true,
  agendar = setTimeout, limpar = clearTimeout, repetir = setInterval, pararRepetir = clearInterval, agora = () => Date.now(),
  // passo 13 (opcionais: sem eles, nada de lateral e nenhuma janela anda). geometria: criarGeometria (prende a janela ao
  // monitor, coluna parada); lateral: {anexar(partes), aoFase(fase), aoEfetivo(efetivo)} (compacto/lateral.js)
  geometria = null, lateral = null,
  // passo 15 (opcionais): registro das expansões (expansoes.criarRegistroExpansoes) e as camadas da Riot à vista (descreverCamadas)
  registro = null, camadasRiot = () => [],
  // último clique/tecla dele na página: ms desde ele (número) ou {haMs, dentro} (dentro = o alvo estava na camada do compacto);
  // null = não sei. Separa o ctx.expandir() de um botão da tela do que a tela chama sozinha (lobby personalizado, sem coletor...)
  gestoHaMs = () => null,
}) {
  const reencolhidas = []; // quando a Riot devolveu a janela a 1280 com a tela compacta montada (ms)
  // est.lateral: ESTADO ÚNICO de largura da lateral (px CSS): esq = configurações (cresce para a esquerda), dir = lista +
  // painel (crescem para a direita). Janela = coluna da config + esq + dir; cfg.compacto.larg nunca muda por causa dela
  const est = { fase: null, info: { lida: false }, chave: null, destino: null, override: null, forcado: null,
    efetivo: 'expandido', motivo: 'início', tela: null, pronto: false, lateral: { esq: 0, dir: 0 }, configRiot: false };
  // partida (passo 14): a lateral fica guardada (decisão 2 do passo 13) e não soma na janela; a lateral.js também zera as larguras
  const emJogo = () => FASES_JOGO.includes(est.fase);
  const extra = () => (emJogo() ? 0 : est.lateral.esq + est.lateral.dir);
  // mexer na janela com o jogo na frente pode trazer o client para cima dele (SetWindowPos sem NOACTIVATE [S]): em InProgress só
  // com o foco na página. GameStart (~50 ms, antes da janela do jogo) e Reconnect (o jogo caiu) podem
  const focoOk = () => { try { return temFoco() !== false; } catch { return true; } };
  const podeMexer = () => est.fase !== 'InProgress' || focoOk();
  const adiar = oque => { if (est.adiado !== oque) { if (!est.adiado) est.adiadoDesde = agora(); est.adiado = oque; log(`partida: ${oque} espera o foco no client (jogo na frente)`); } };
  // est.forcado com a origem dele (registro das expansões, passo 15): modal | erro-tela | janela-voltou | sem-riotinvoke | config-riot
  const forcar = (motivo, tipo, camadaRiot = null) => {
    est.forcado = motivo; est.forcadoTipo = tipo; est.forcadoCamada = camadaRiot;
    if (tipo === 'modal') armarVoltaModal(); else pararVoltaModal();
    return motivo;
  };
  // etapa 6 de 17/10: a janela da Riot que expandiu sumiu por VOLTA_MODAL_MS -> zera o forcado e volta (nenhuma chamada à LCU: lê o DOM)
  let timerVoltaModal = null, semModalDesde = null;
  function pararVoltaModal() { if (timerVoltaModal) { pararRepetir(timerVoltaModal); timerVoltaModal = null; } semModalDesde = null; }
  // sempre recomeça: a releitura de depois da volta (conferirReaparecer) usa o mesmo timer e não pode segurar a vez da nova janela
  function armarVoltaModal() { pararVoltaModal(); timerVoltaModal = repetir(conferirVoltaModal, CONFERE_MODAL_MS); }
  function conferirVoltaModal() {
    // outro motivo tomou conta (virada de destino, Configurações, ▣ dele), ele pediu o client normal (⤢) ou é o ready check: não volta
    if (est.forcadoTipo !== 'modal' || !est.forcado || est.override === 'expandido' || est.fase === 'ReadyCheck' || est.voltaModalGasta) { pararVoltaModal(); return; }
    if (est.efetivo !== 'expandido') { semModalDesde = null; return; } // a expansão ainda espera o foco (partida)
    let d;
    try { d = modalAberto(); } catch { d = 'sem leitura'; }
    if (d) { semModalDesde = null; return; }
    if (semModalDesde == null) { semModalDesde = agora(); return; }
    if (agora() - semModalDesde < VOLTA_MODAL_MS) return;
    pararVoltaModal();
    est.forcado = null; est.forcadoTipo = null; est.forcadoCamada = null;
    est.volta = 'a janela da Riot fechou';
    log('a janela da Riot fechou: volta ao compacto');
    resolver();
    if (GRACA_VOLTA_MS > 0) { const desde = agora(); timerVoltaModal = repetir(() => conferirReaparecer(desde), CONFERE_MODAL_MS); }
  }
  // GRACA_VOLTA_MS depois da volta: a janela da Riot que só se escondeu e reaparece sem nó novo (a vigia não vê) expande de novo
  function conferirReaparecer(desde) {
    if (agora() - desde > GRACA_VOLTA_MS || est.forcado) { pararVoltaModal(); return; }
    if (est.efetivo !== 'compacto') return; // tela ainda carregando ou ⤢ dele: nada a cobrir agora
    let d;
    try { d = modalAberto(); } catch { d = null; }
    // reapareceu: expande e, até a virada de destino, não volta mais por esta regra (sem 420 -> 1280 -> 420 em laço)
    if (d) { pararVoltaModal(); est.voltaModalGasta = true; forcarPorModal(d); }
  }
  const coluna = () => tamanho(cfg.compacto?.larg, cfg.compacto?.alt)[0];
  const compactar = () => janela.compactar(cfg.compacto?.larg, cfg.compacto?.alt, extra());
  // sobre ({esq, dir}, da geometria): as larguras do passo em curso, não as mais novas (a geometria cresce com a esquerda VELHA e
  // põe a nova na volta do MoveTo; um 2º clique no meio não pode desencontrar CSS e posição)
  const porLarguras = sobre => { try { const j = emJogo(); camada.larguras?.({ esq: j ? 0 : (sobre?.esq ?? est.lateral.esq), col: coluna(), dir: j ? 0 : (sobre?.dir ?? est.lateral.dir) }); } catch { /* sem DOM */ } };
  const gancho = (nome, ...a) => { try { lateral?.[nome]?.(...a); } catch (e) { log(`lateral: ${nome} falhou`, e); } };
  const modulos = new Map(); // nome -> {estado: 'carregando'|'ok'|'falta', mod}
  const assinadas = new Set();
  let montagem = null, token = 0, aplicando = false, pendente = false, timerSessao = null, timerContagem = null, timerModalRc = null, timerSeq = null;
  let timerSelecao = null; // prazo do isSpectating na seleção vinda do menu inicial (D1 de 17/10/2026)
  // libera a espera do isSpectating; -> true se havia espera
  function soltarEsperaSelecao() {
    if (timerSelecao) { limpar(timerSelecao); timerSelecao = null; }
    const havia = !!est.esperaSelecao;
    est.esperaSelecao = false;
    return havia;
  }

  const carregar = nome => {
    let m = modulos.get(nome);
    if (m) return m;
    m = { estado: 'carregando', mod: null };
    modulos.set(nome, m);
    Promise.resolve().then(() => carregarTela(nome)).then(mod => {
      if (mod && typeof mod.montar === 'function') { m.estado = 'ok'; m.mod = mod; } else m.estado = 'falta';
    }, e => { m.estado = 'falta'; log(`tela "${nome}" indisponível (${e?.message || e})`); }).then(() => resolver());
    return m;
  };

  // o que a fase pede agora -> {modo: 'compacto'|'expandido'|'esperar'|'nada', tela?, mod?, motivo?}
  function alvo() {
    const c = cfg.compacto || {};
    if (!c.ligado) return { modo: 'expandido', motivo: 'client compacto desligado', origem: 'desligado' };
    // sem DOM ou sem a 1ª leitura da fase: não mexe em nada (recarga com a janela pequena não pisca)
    if (!est.pronto || !est.faseLida) return { modo: 'nada' };
    const d = destinoDaFase(est.fase, { ...est.info, aceiteLigado: !!cfg.aceite?.ligado, aceiteVivo: aceiteVivo(), aceiteManual: !!aceiteManual(), semContagem: semContagem(),
      assistindo: !!est.assistindo, esperaSelecao: !!est.esperaSelecao, ...infoSequencia() });
    const chave = d.tipo === 'esperar' ? est.chave : `${d.tipo}:${d.tela || ''}`;
    // virou de destino: a escolha manual e a regra 7 valem só até aqui ("lembrar o modo por fase", plano)
    if (chave !== est.chave) { est.chave = chave; est.override = null; est.forcado = null; est.configRiot = false; est.voltaModalGasta = false; }
    est.destino = d;
    const quer = est.override || (c.inicioCompacto ? 'compacto' : 'expandido');
    // esperar com uma tela da Riot por cima (regra 7) expande na hora: a espera de até 10 s da celebração de desafio (etapa 5 de
    // 17/10) deixava a vinheta com botão embaixo da camada. A chave não muda na espera, então o forcado vale até a virada de destino
    if (d.tipo === 'esperar' && est.forcado && est.efetivo === 'compacto') return { modo: 'expandido', motivo: est.forcado, origem: est.forcadoTipo || 'forcado' };
    if (d.tipo === 'esperar') return { modo: 'esperar', motivo: d.motivo };
    if (d.tipo === 'expandir') return { modo: 'expandido', motivo: d.motivo, daFase: true, origem: 'fase' };
    // 'jogo' desde o passo 14 só sai para partida fora de SR/ARAM (TFT, Arena...): client normal embaixo do jogo, como antes
    if (d.tipo === 'jogo') return { modo: 'expandido', motivo: d.motivo || 'partida: client normal embaixo do jogo', daFase: true, origem: 'jogo-fora' };
    if (est.forcado) return { modo: 'expandido', motivo: est.forcado, origem: est.forcadoTipo || 'forcado' };
    if (quer !== 'compacto') return { modo: 'expandido', motivo: est.override ? 'expandido por você' : 'padrão: client normal', origem: est.override ? 'por-ele' : 'padrao' };
    if (!janela.disponivel()) return { modo: 'expandido', motivo: 'sem controle da janela (riotInvoke)', origem: 'sem-riotinvoke' };
    const m = carregar(d.tela);
    if (m.estado === 'carregando') return { modo: 'esperar', motivo: `carregando a tela ${d.tela}` };
    if (m.estado !== 'ok') return { modo: 'expandido', motivo: `a tela compacta "${d.tela}" ainda não existe`, origem: 'sem-tela' };
    // montagem nova (entrar no compacto ou trocar de tela) com tela da Riot aberta: fica no normal
    if (!(est.efetivo === 'compacto' && montagem?.nome === d.tela)) {
      const modal = modalAberto();
      if (modal) { forcar(`o client abriu uma janela própria (${modal})`, 'modal', modal); return { modo: 'expandido', motivo: est.forcado, origem: 'modal' }; }
    }
    return { modo: 'compacto', tela: d.tela, mod: m.mod };
  }

  // etapa do PreEndOfGame para o destinoDaFase (est.seq = {nome, desde} | null; est.seqDesde = entrada no PreEndOfGame;
  // est.honraVista = honor-vote visto neste fim de partida)
  function infoSequencia() {
    if (est.fase !== 'PreEndOfGame') return {};
    return { seq: est.seq ? est.seq.nome : undefined, seqFirme: !!est.seq && agora() - est.seq.desde >= SEQ_FIRME_MS,
      seqLonga: !!est.seq && agora() - est.seq.desde >= ESPERA_CELEBRACAO_MS, seqEsgotou: prazoSemEtapa() === 0 };
  }

  // sem etapa (não lida ou ''): ms até expandir (0 = esgotou); null = há etapa com nome. '' antes da honra conta como
  // "não lida" (prazo da entrada na fase); '' depois dela, ESPERA_POS_HONRA_MS desde que virou ''
  function prazoSemEtapa() {
    if (est.fase !== 'PreEndOfGame' || (est.seq && est.seq.nome)) return null;
    const fim = est.seq && est.honraVista ? est.seq.desde + ESPERA_POS_HONRA_MS
      : typeof est.seqDesde === 'number' ? est.seqDesde + ESPERA_SEQ_MS : null;
    return fim === null ? null : Math.max(0, fim - agora());
  }

  // ready check: a contagem foi vista alguma vez? (some sozinha depois do aceite, esperando os outros: não conta)
  function semContagem() {
    if (est.fase !== 'ReadyCheck' || !est.rc) return false;
    let v;
    try { v = contagemNaTela(); } catch { v = undefined; }
    if (v === true) est.rc.vista = true;
    // expandiu uma vez neste ready check: fica expandido até a fase mudar (a contagem chegando tarde encolheria a
    // janela embaixo do cursor dele, indo clicar no popup da Riot: revisão de 14/10/2026)
    if (!est.rc.vista && v === false && agora() - est.rc.desde >= CONTAGEM_MS) est.rc.expandiu = true;
    return !!est.rc.expandiu;
  }

  function agendarSeq(ms) {
    if (timerSeq) limpar(timerSeq);
    timerSeq = agendar(() => { timerSeq = null; if (est.fase === 'PreEndOfGame') resolver(); }, ms);
  }

  function resolver() {
    if (aplicando) { pendente = true; return; }
    aplicando = true;
    // registro das expansões (passo 15): um ponto só, o efetivo antes e depois do laço (pega todos os caminhos do aplicar, a
    // emergência e a expansão que esperou o foco). Uma ida e volta inteira dentro deste laço não muda a janela e fica de fora
    const antes = { efetivo: est.efetivo, tela: est.tela, adiadoDesde: est.adiado === 'expandir' ? est.adiadoDesde : null,
      janela: registro && est.efetivo === 'compacto' ? registro.medirAgora() : null };
    try {
      let voltas = 0;
      do { pendente = false; aplicar(alvo()); } while (pendente && ++voltas < 5);
    } catch (e) {
      log('roteador falhou', e);
      emergencia();
    } finally { aplicando = false; }
    notarExpansao(antes);
    try { aoAplicar(estado()); } catch { /* botão */ }
    despejarAvisos();
  }

  // 'padrao' = "iniciar no compacto" desligado nas configurações dele (o ▣ dele vale até a fase virar): escolha dele, não tela da Riot
  const POR_ELE = ['por-ele', 'config-riot', 'desligado', 'padrao'];
  // motivo que vai ao registro: o de erro de tela leva e.message cru (pode trazer dado da LCU); ali só o vocabulário de interface
  const motivoSeguro = m => String(m ?? '').replace(/^erro na tela compacta \((.*)\)$/s, (_, x) => `erro na tela compacta (${textoSeguro(x, 100) || '…'})`);
  // o gesto agora, em relação à tela montada (etapa 3 de roadmap/2026-10-17-telas-que-expandem.md): {haMs, antes, fora} | null.
  // antes = foi antes de a tela atual montar (16/10/2026: o clique em "Assistir" no client normal, 771 ms antes, contou como pedido da
  // tela da seleção que montou depois); fora = o alvo não estava na camada do compacto
  function medirGesto() {
    let g;
    try { g = gestoHaMs(); } catch { g = null; }
    const haMs = typeof g === 'number' ? g : g && typeof g.haMs === 'number' ? g.haMs : null;
    if (haMs == null || !Number.isFinite(haMs)) return null;
    const desde = typeof est.telaDesde === 'number' ? agora() - est.telaDesde : null;
    return { haMs, antes: desde != null && haMs > desde, fora: !!g && typeof g === 'object' && g.dentro === false };
  }
  function notarExpansao(antes) {
    const gatilho = est.gatilho, volta = est.volta, gestoPedido = est.gestoPedido;
    const transicao = antes.efetivo !== est.efetivo && (est.efetivo === 'expandido' || est.efetivo === 'compacto');
    // pedido dele que ainda espera o foco (partida): gatilho e volta seguem até a transição de verdade
    if (transicao || !est.adiado) { est.gatilho = null; est.volta = null; est.gestoPedido = undefined; }
    if (!registro) return;
    try {
      if (antes.efetivo === 'compacto' && est.efetivo === 'expandido') {
        let origem = est.origem || 'desconhecida', porEle = POR_ELE.includes(origem), gesto = null;
        // ctx.expandir() de uma tela: por ele só com clique/tecla dele há pouco (medido no pedido, não na expansão que
        // esperou o foco); sem isso foi a tela sozinha
        let gestoFora = false, gestoAntes = false;
        if (origem === 'por-ele' && /^tela /.test(gatilho || '')) {
          const g = gestoPedido !== undefined ? gestoPedido : medirGesto();
          gesto = g ? g.haMs : null; gestoFora = !!g?.fora; gestoAntes = !!g?.antes;
          // dele só com clique/tecla há pouco, dentro da camada e depois de a tela montar
          porEle = !!g && g.haMs <= GESTO_MS && !g.antes && !g.fora;
          if (!porEle) origem = 'tela-sozinha';
        }
        const info = est.info || {};
        const aviso = est.ultimoAviso && agora() - est.ultimoAviso.em <= AVISO_MS ? est.ultimoAviso.msg : null;
        registro.abrir({
          origem, porEle, gatilho: gatilho || (origem === 'padrao' ? 'config: iniciar no compacto desligado' : null), gestoHaMs: gesto,
          ...(gestoAntes ? { gestoAntesDaTela: true } : {}), ...(gestoFora ? { gestoForaDaCamada: true } : {}),
          motivo: motivoSeguro(est.motivo), aviso,
          fase: est.fase ?? null, seq: est.fase === 'PreEndOfGame' || est.fase === 'WaitingForStats' ? est.seq?.nome ?? null : null,
          fila: info.fila ?? null, mapa: info.mapa ?? null, custom: !!info.custom, telaAntes: antes.tela,
          gatilhoCamada: origem === 'modal' ? est.forcadoCamada || null : null, camadas: (() => { try { return camadasRiot() || []; } catch { return []; } })(),
          janelaAntes: antes.janela,
          esperouFocoMs: antes.adiadoDesde != null ? Math.max(0, Math.round(agora() - antes.adiadoDesde)) : 0,
          reencolhidas: reencolhidas.length, lateral: { ...est.lateral },
        });
      } else if (antes.efetivo === 'expandido' && est.efetivo === 'compacto') {
        registro.fechar({ como: volta || 'automático', fase: est.fase ?? null, tela: est.tela });
      } else if (est.efetivo === 'expandido') {
        registro.trocou({ fase: est.fase ?? null, motivo: motivoSeguro(est.motivo), origem: est.origem || null });
      }
    } catch (e) { log('registro da expansão falhou', e); }
  }

  // último recurso: sem camada e janela normal
  function emergencia() {
    try { desmontarTela(); } catch { /* segue */ }
    try { camada.remover(); } catch { /* segue */ }
    try { classe(false); } catch { /* segue */ }
    // partida com o jogo na frente (revisão adversarial, achado 5): nem a emergência mexe na janela; expande quando ele voltar
    try { if (janela.ehCompacta()) { if (podeMexer()) janela.expandir(); else adiar('expandir'); } } catch { /* segue */ }
    est.efetivo = 'expandido'; est.motivo = 'erro no roteador'; est.origem = 'erro-roteador'; est.tela = null;
  }

  function aplicar(a) {
    if (a.modo === 'esperar' && est.destino?.tipo === 'esperar' && !timerSessao && est.fase === 'ChampSelect' && !est.info.lida) {
      // sessão do champ select não chegou: não encolhe nem expande no escuro por até 2 × ESPERA_SESSAO_MS (relê no meio)
      timerSessao = agendar(esgotouSessao, ESPERA_SESSAO_MS);
    }
    if (a.modo === 'nada' || a.modo === 'esperar') return;
    if (a.modo === 'compacto') {
      if (est.efetivo === 'compacto' && montagem && montagem.nome === a.tela && camada.conectada && !camada.conectada()) {
        // a camada à vista não é a minha (a Riot trocou o <body> por uma cópia sem ouvintes): monta de novo
        log('a camada saiu da página: montando de novo');
        desmontarTela();
        const partes = camada.montar();
        porLarguras();
        gancho('anexar', partes);
        montarTela(a.tela, a.mod, partes);
        return;
      }
      if (est.efetivo === 'compacto' && montagem && montagem.nome === a.tela) {
        // a Riot devolveu a janela a 1280×720 com a camada de pé (restore do plugin-runner, ux-show [S]): encolhe de
        // novo; se ela insistir (3 vezes em 10 s), desiste e fica no client normal (camada de 1280 não é compacto)
        if (podeMexer()) est.adiado = null;
        if (!janela.ehCompacta()) {
          if (!podeMexer()) { adiar('reencolher a janela'); return; }
          const t = agora();
          while (reencolhidas.length && t - reencolhidas[0] > 10000) reencolhidas.shift();
          if (reencolhidas.length >= 3) { forcar('a janela voltou ao tamanho normal sozinha', 'janela-voltou'); pendente = true; return; }
          reencolhidas.push(t);
          log('a janela voltou a 1280 sozinha: encolhendo de novo');
          if (!compactar()) { forcar('a janela não encolheu (riotInvoke)', 'sem-riotinvoke'); pendente = true; return; }
          if (!emJogo()) geometria?.ajustar(); // partida: nada de MoveTo (passo 14)
        } else if (emJogo() && podeMexer() && typeof janela.noTamanho === 'function' && !janela.noTamanho(cfg.compacto?.larg, cfg.compacto?.alt, extra())) {
          // tela de jogo montada sem foco numa janela pequena mas do tamanho de antes (a lateral somada: "acertar o tamanho
          // da janela" adiado): com o foco de volta, só ResizeTo (revisão adversarial, achado 4). Só nas fases de jogo: fora
          // delas a fila da geometria é dona da ordem CSS/MoveTo/ResizeTo, e um compactar() no meio dela pularia a coluna
          log('partida: acertando o tamanho da janela (foco no client)');
          if (!compactar()) { forcar('a janela não encolheu (riotInvoke)', 'sem-riotinvoke'); pendente = true; return; }
        }
        if (montagem.fase !== est.fase) mudarFase(a);
        return;
      }
      // já pequena mas noutro tamanho (recarga do plugin com a janela de 640 de antes): encolhe para o tamanho pedido. Troca
      // de tela compara com coluna + lateral (passo 13: antes comparava só com a config e toda troca de tela encolhia a lateral)
      const pequena = janela.ehCompacta();
      let precisa = !pequena || (typeof janela.noTamanho === 'function' && !janela.noTamanho(cfg.compacto?.larg, cfg.compacto?.alt, extra()));
      // partida com o jogo na frente (passo 14): janela grande fica como está até o foco; janela já pequena monta sem ResizeTo
      if (precisa && !podeMexer()) {
        if (!pequena) { adiar('encolher a janela'); return; }
        adiar('acertar o tamanho da janela');
        precisa = false;
      }
      desmontarTela();
      const entrando = est.efetivo !== 'compacto';
      const partes = camada.montar();
      // troca de tela já no compacto, janela pequena, fora da partida: a fila da geometria é a dona da ordem CSS/ResizeTo/MoveTo
      // (revisão adversarial de 15/10/2026: saindo da partida com a ⚙ aberta, porLarguras + compactar daqui punham esq 360 numa
      // página de 420 antes do ResizeTo, o pisca da ⚙; prova: teste-compacto-lateral.mjs "⚙ aberta numa partida inteira")
      const pelaGeometria = !entrando && pequena && !emJogo() && !!geometria && janela.disponivel();
      if (pelaGeometria) {
        if (precisa) aplicarGeometria();
      } else {
        porLarguras();
        if (precisa && !compactar() && !janela.ehCompacta()) {
          camada.remover();
          forcar('a janela não encolheu (riotInvoke)', 'sem-riotinvoke');
          est.efetivo = 'expandido'; est.motivo = est.forcado; est.origem = 'sem-riotinvoke'; est.tela = null;
          return;
        }
        if ((precisa || entrando) && !emJogo()) geometria?.ajustar(); // partida: nada de MoveTo (passo 14)
      }
      if (podeMexer()) est.adiado = null;
      classe(true);
      est.efetivo = 'compacto'; est.motivo = null; est.tela = a.tela;
      gancho('anexar', partes);
      if (entrando) gancho('aoEfetivo', 'compacto');
      // toda montagem vai para o LeagueClientUx.log: sem ela, o log de uma partida só mostrava as saídas do compacto
      // e não provava o que estava na tela (14/10/2026 14:43)
      // partida: o foco vai junto (prova, no log da partida, de que a janela não mudou com o jogo na frente: passo 14)
      log(`tela ${a.tela} (${est.fase})${emJogo() ? ` foco=${focoOk()} redimensionou=${precisa}` : ''}`);
      montarTela(a.tela, a.mod, partes);
      return;
    }
    // expandido: sem camada e a janela no tamanho normal (a lateral some junto e volta igual quando o compacto voltar)
    // partida com o jogo na frente (passo 14): expandir (regra 7, erro) espera o foco; a tela compacta segue de pé até lá
    if (a.modo === 'expandido' && janela.ehCompacta() && !podeMexer()) { adiar('expandir'); return; }
    est.adiado = null;
    const saindo = est.efetivo === 'compacto';
    desmontarTela();
    camada.remover();
    classe(false);
    if (a.modo === 'expandido' && janela.ehCompacta()) { janela.expandir(); geometria?.esquecer(); }
    if (est.efetivo !== a.modo || est.motivo !== a.motivo) log(`${a.modo}: ${a.motivo}`);
    est.efetivo = a.modo; est.motivo = a.motivo; est.origem = a.origem || null; est.tela = null;
    if (saindo) gancho('aoEfetivo', a.modo);
  }

  // prazo da sessão do gameflow na seleção (etapa 1 de 17/10): o 1º esgotar relê a sessão (só GET) e espera mais um prazo; o 2º
  // segue a regra "campo ausente = expandir" ({lida:true} sem fila -> "seleção da fila desconhecida")
  function esgotouSessao() {
    timerSessao = null;
    if (est.info.lida || est.fase !== 'ChampSelect') return;
    if (!est.sessaoRelida) {
      est.sessaoRelida = true;
      try {
        Promise.resolve(lcu('GET', '/lol-gameflow/v1/session'))
          .then(r => { if (r?.ok && r.json && typeof r.json === 'object' && est.fase === 'ChampSelect') aoSessao(r.json); })
          .catch(e => log('releitura da sessão falhou', e));
      } catch (e) { log('releitura da sessão falhou', e); }
      timerSessao = agendar(esgotouSessao, ESPERA_SESSAO_MS);
      return;
    }
    est.info = { lida: true };
    resolver();
  }

  // /lol-gameflow/v1/session (evento ou GET)
  function aoSessao(s) {
    const novo = infoDaSessao(s);
    const v = est.info;
    if (v.lida && v.fila === novo.fila && v.mapa === novo.mapa && v.custom === novo.custom) return;
    // a sessão chega vazia ~150-190 ms antes de a fase sair da seleção (medido em 16/10/2026): quem decide a saída é o evento de
    // fase. Sessão com fila ou mapa (troca de fila de verdade) segue valendo
    // (fila OU mapa já lidos: a personalizada no SR tem fila 0 = null e mapa 11; revisão adversarial de 17/10/2026)
    if (est.fase === 'ChampSelect' && v.lida && (v.fila || v.mapa) && novo.fila == null && novo.mapa == null) return;
    est.info = novo;
    if (timerSessao && est.info.lida) { limpar(timerSessao); timerSessao = null; }
    resolver();
  }

  // a lateral pede larguras (px CSS). Compacto à vista: a janela muda na hora (geometria: cresce antes de andar, anda antes de
  // encolher, prende ao monitor, coluna parada); senão só guarda e vale quando o compacto voltar. -> true se mudou
  // opcoes {soSemMover, aoRecusar}: abertura automática (decisão 1): a geometria confere com a tela relida e, se teria de mover
  // a janela, não muda nada e chama aoRecusar (a lateral desfaz e pede as larguras de antes)
  // a tarefa da geometria com CSS, ResizeTo e o painel da esquerda. m = as medidas que a geometria está aplicando (o ResizeTo
  // espera exatamente essa largura); esconderEsq: o painel da esquerda fica invisível no quadro da corrida CSS x MoveTo
  // (ARMADILHAS § Client, "pisca ao abrir ⚙")
  function aplicarGeometria({ soSemMover = false, aoRecusar = null } = {}) {
    return geometria.aplicar({ redimensionar: m => est.efetivo === 'compacto' && (m ? janela.compactar(cfg.compacto?.larg, cfg.compacto?.alt, m.larg - m.col) : compactar()),
      porCss: porLarguras, soSemMover, aoRecusar, esconderEsq: on => camada.mudando?.(on) });
  }
  function pedirLateral({ esq = 0, dir = 0 } = {}, { soSemMover = false, aoRecusar = null } = {}) {
    const novo = { esq: Math.max(0, Math.round(Number(esq) || 0)), dir: Math.max(0, Math.round(Number(dir) || 0)) };
    if (novo.esq === est.lateral.esq && novo.dir === est.lateral.dir) return false;
    est.lateral = novo;
    // partida (passo 14): a lateral guardada não mexe na janela (extra() é 0 nas fases de jogo); a montagem da tela de jogo acerta
    if (emJogo()) { porLarguras(); return true; }
    if (est.efetivo === 'compacto' && janela.disponivel() && geometria) {
      // a tarefa da geometria é assíncrona: só redimensiona se o compacto ainda estiver à vista quando ela rodar. As variáveis
      // CSS saem na tarefa, junto do MoveTo (revisão de 14/10/2026: na hora do clique a coluna saía de vista até o ScreenData)
      aplicarGeometria({ soSemMover, aoRecusar });
      return true;
    }
    porLarguras();
    if (est.efetivo === 'compacto' && janela.disponivel()) compactar();
    return true;
  }

  // "Configurações da Riot" do painel B1: expande (o modal dela é de 1280) e, quando ele fechar, volta ao compacto
  // (comportamento novo do passo 13, decisão técnica v; as outras janelas da Riot seguem a regra 7 de sempre)
  function abrirConfigRiot() {
    forcar(MOTIVO_CONFIG_RIOT, 'config-riot');
    est.configRiot = true;
    est.gatilho = 'painel ⚙: Configurações da Riot';
    resolver();
    return est.efetivo !== 'compacto';
  }
  function configRiotFechou() {
    if (!est.configRiot) return;
    est.configRiot = false;
    if (est.forcado === MOTIVO_CONFIG_RIOT) { est.forcado = null; est.volta = 'as Configurações da Riot fecharam'; resolver(); }
  }

  function mudarFase(a) {
    const m = montagem;
    m.fase = est.fase;
    // a troca de fase sem remontar também vai ao log (Matchmaking <-> ReadyCheck): sem ela, "tela fila (Matchmaking)"
    // seguido de "tela champselect" não separa "a fila ficou no ready check" de "nada aconteceu"
    log(`tela ${m.nome} (${est.fase}): atualizada`);
    if (typeof m.mod.atualizar === 'function') {
      try { const r = m.mod.atualizar(m.ctx); if (r && typeof r.then === 'function') r.catch(e => falhou(e, m.token)); } catch (e) { falhou(e, m.token); }
      return;
    }
    desmontarTela();
    montarTela(a.tela, a.mod, camada.montar());
  }

  function montarTela(nome, mod, partes) {
    const t = ++token;
    const m = { nome, mod, token: t, fase: est.fase, partes, timers: new Set(), intervalos: new Set(), subs: new Map(), ctx: null };
    montagem = m;
    est.telaDesde = agora(); // gesto de antes disto não é pedido desta tela (medirGesto)
    const vivo = () => montagem === m && m.token === token;
    const seguro = fn => (...args) => {
      if (!vivo()) return undefined;
      try {
        const r = fn(...args);
        if (r && typeof r.then === 'function') r.catch(e => falhou(e, t));
        return r;
      } catch (e) { falhou(e, t); return undefined; }
    };
    const ctx = {
      cfg, servicos, tela: nome,
      get fase() { return est.fase; },
      get info() { return { ...est.info }; },
      // etapa do PreEndOfGame que o roteador leu (GET a cada 1 s + evento): a honra confere se ainda é honor-vote
      get seq() { return est.fase === 'PreEndOfGame' && est.seq ? est.seq.nome : null; },
      raiz: partes.raiz, titulo: partes.titulo, extras: partes.extras,
      lcu: (metodo, url, corpo) => lcu(metodo, url, corpo),
      vivo, seguro,
      observar(uri, cb) {
        if (!vivo()) return;
        if (!m.subs.has(uri)) m.subs.set(uri, new Set());
        m.subs.get(uri).add(seguro(cb));
        assinarUri(uri);
      },
      tempo(fn, ms) {
        if (!vivo()) return null;
        const id = agendar(() => { m.timers.delete(id); seguro(fn)(); }, ms);
        m.timers.add(id);
        return id;
      },
      intervalo(fn, ms) {
        if (!vivo()) return null;
        const id = repetir(seguro(fn), ms);
        m.intervalos.add(id);
        return id;
      },
      falhou: e => falhou(e, t),
      expandir: () => expandirPorTi(`tela ${nome}`),
      // a tela cede à Riot sozinha (seleção com banco, espectador): automática no registro, nunca "por ele" (etapa 2 de 17/10)
      ceder: motivo => { if (!vivo()) return; forcar(String(motivo || `a tela ${nome} cedeu à Riot`).slice(0, 120), 'tela-sozinha'); est.gatilho = `tela ${nome}`; resolver(); },
      avisar: (msg, erro) => { anotarAviso(msg); return avisar(msg, erro); },
      dormir: ms => dormir(agendar, ms),
    };
    m.ctx = ctx;
    try {
      const r = mod.montar(partes.raiz, ctx);
      if (r && typeof r.then === 'function') r.catch(e => falhou(e, t));
    } catch (e) { falhou(e, t); }
  }

  function desmontarTela() {
    const m = montagem;
    if (!m) return;
    montagem = null;
    token++;
    for (const id of m.timers) limpar(id);
    for (const id of m.intervalos) pararRepetir(id);
    m.subs.clear();
    try { m.mod.desmontar?.(m.partes.raiz, m.ctx); } catch (e) { log(`desmontar "${m.nome}" falhou`, e); }
    for (const p of [m.partes.raiz, m.partes.titulo, m.partes.extras]) try { p?.replaceChildren?.(); } catch { /* segue */ }
  }

  // eventos da LCU: um observe por uri (o socket do Pengu não tem como desassinar); entrega só à tela montada
  function assinarUri(uri) {
    if (assinadas.has(uri)) return;
    assinadas.add(uri);
    try {
      assinar(uri, msg => { const s = montagem?.subs.get(uri); if (s) for (const cb of [...s]) cb(msg); });
    } catch (e) { log('assinar', uri, e); }
  }

  // erro de tela: client normal até a próxima virada de destino (tenta de novo na próxima fase)
  function falhou(e, t) {
    if (t !== undefined && (!montagem || montagem.token !== t)) return; // tela velha: ignora
    // uma vez por montagem (revisão adversarial, achado 6): na partida sem foco a expansão espera e a montagem fica de pé; sem isto
    // um tique que lança repetia log e aviso a cada segundo. token++ mata o vivo()/seguro() dela; timers e intervalos param aqui
    const m = montagem;
    if (m) {
      if (m.falhou) return;
      m.falhou = true;
      token++;
      for (const id of m.timers) limpar(id);
      for (const id of m.intervalos) pararRepetir(id);
      m.timers.clear(); m.intervalos.clear();
    }
    log('tela compacta falhou', e);
    forcar(`erro na tela compacta (${String(e?.message || e).slice(0, 120)})`, 'erro-tela');
    // o texto sai no fim do resolver (pode ser reentrante): só então se sabe se o client normal abriu ou espera o foco
    avisarDepois(() => (est.adiado === 'expandir' ? 'a tela compacta falhou: o client normal abre quando voltar a ele'
      : 'a tela compacta falhou: abrindo o client normal'), true);
    resolver();
  }

  // aviso de uma tela (ctx.avisar) para o registro das expansões: o de logo antes vai no evento; o de logo depois completa
  function anotarAviso(msg) {
    if (!registro) return;
    try {
      const t = textoSeguro(msg, 120);
      if (!t) return;
      est.ultimoAviso = { msg: t, em: agora() };
      registro.anotar?.({ aviso: t });
    } catch { /* só registro */ }
  }

  // aviso que sai no fim do próximo resolver() (dentro da camada que vai sumir ele se perderia): chamar antes dele
  const avisos = [];
  function avisarDepois(msg, erro = false) { avisos.push([msg, erro]); }
  function despejarAvisos() {
    while (avisos.length) { const [msg, erro] = avisos.shift(); try { avisar(typeof msg === 'function' ? msg() : msg, erro); } catch { /* segue */ } }
  }

  // gatilho (registro das expansões): 'botão ⤢', 'atalho Ctrl+Shift+M', 'tela <nome>', 'Ctrl+K'...
  function expandirPorTi(gatilho) {
    est.override = 'expandido';
    est.gatilho = typeof gatilho === 'string' ? gatilho.slice(0, 60) : 'ele';
    // o gesto vale no instante do pedido (na partida sem foco a expansão de verdade sai depois)
    est.gestoPedido = medirGesto();
    resolver();
  }

  // regra 7: tela própria da Riot por cima do compacto = client normal até a próxima virada de destino
  function forcarPorModal(desc) {
    if (est.efetivo !== 'compacto' || !desc) return;
    forcar(`o client abriu uma janela própria (${desc})`, 'modal', desc);
    avisarDepois(`${est.forcado}: client normal`);
    resolver();
  }

  function compactarPorTi(gatilho) {
    est.override = 'compacto';
    est.forcado = null;
    est.volta = `por ele (${typeof gatilho === 'string' ? gatilho.slice(0, 60) : 'botão ▣'})`;
    resolver();
    if (est.efetivo !== 'compacto' && est.destino?.tipo !== 'esperar' && !(modulos.get(est.destino?.tela)?.estado === 'carregando'))
      avisar(`modo compacto indisponível agora: ${est.motivo || 'sem tela'}`, true);
  }

  function estado() {
    return { fase: est.fase, info: { ...est.info }, seq: est.seq?.nome ?? null, destino: est.destino, efetivo: est.efetivo, motivo: est.motivo, tela: est.tela,
      override: est.override, forcado: est.forcado, adiado: est.adiado || null, janelaCompacta: janela.ehCompacta(), camada: !!camada.existe?.(),
      lateral: { ...est.lateral }, telas: Object.fromEntries([...modulos].map(([k, v]) => [k, v.estado])) };
  }
  // tamanho CSS que a janela compacta deve ter agora (coluna + lateral) e a largura da esquerda (geometria)
  // pintada: a esquerda que o CSS tem AGORA (camada.medidas; na partida porLarguras põe 0 sem a geometria saber): é dela que a
  // geometria parte (revisão adversarial de 15/10/2026)
  const medidasJanela = () => {
    const [larg, alt] = tamanho(cfg.compacto?.larg, cfg.compacto?.alt, extra());
    let pintada = null;
    try { const v = camada.medidas?.().esq; if (Number.isFinite(v)) pintada = v; } catch { /* sem camada */ }
    return { larg, alt, esq: est.lateral.esq, dir: est.lateral.dir, col: coluna(), pintada };
  };

  return {
    aoFase(fase) {
      if (est.faseLida && fase === est.fase) return;
      est.faseLida = true; // null (leitura falhou de vez) também conta: destino "fase desconhecida" = client normal
      // a sessão de antes pode ser de outra fila; a do ready check não (a seleção que sai dele é a mesma partida: etapa 1 de
      // 17/10/2026, decisão 2 do plano; reverte com um registro de seleção de fila diferente da do ready check)
      if (fase === 'ChampSelect') {
        if (!(est.fase === 'ReadyCheck' && est.info.lida && est.info.fila)) est.info = { lida: false };
        est.sessaoRelida = false;
      }
      // o prazo da sessão é de uma entrada só: ChampSelect -> None -> ChampSelect em < 2 s encurtava o da 2ª (revisão de 17/10)
      if (timerSessao) { limpar(timerSessao); timerSessao = null; }
      // D1 de 17/10/2026: seleção vinda do menu inicial (None/Lobby, sem ReadyCheck: assistir ou personalizada) espera o isSpectating
      // da sessão da seleção por até ESPERA_SELECAO_MS antes de montar a tela compacta; vinda do ReadyCheck (ranqueada, normal) nunca
      soltarEsperaSelecao();
      if (fase === 'ChampSelect' && ESPERA_SELECAO_MS > 0 && FASES_ANTES_ESPERA_SELECAO.includes(est.fase) && !est.assistindo) {
        est.esperaSelecao = true;
        timerSelecao = agendar(() => {
          timerSelecao = null;
          if (!est.esperaSelecao) return;
          est.esperaSelecao = false;
          log('seleção sem o isSpectating no prazo: segue a regra da fila');
          resolver();
        }, ESPERA_SELECAO_MS);
      }
      // saiu do ready check (outro não aceitou: Matchmaking de novo): "⤢ expandir" e regra 7 daquele ready check não
      // seguem para a busca. Matchmaking e ReadyCheck têm a mesma chave (tela:fila) desde 14/10/2026; antes o "ceder"
      // trocava a chave e zerava isso. Entrar no ready check não zera: expandido por ti segue expandido no aceite
      if (est.fase === 'ReadyCheck' && fase !== 'ReadyCheck') { est.override = null; est.forcado = null; }
      // partida assistida acabou (ou nunca houve): fora da seleção/partida/fim, o espectador zera (etapa 2 de 17/10)
      if (['None', 'Lobby', 'Matchmaking', 'ReadyCheck'].includes(fase)) est.assistindo = false;
      est.fase = fase;
      // ready check novo: confere a contagem do aceite de novo depois de CONTAGEM_MS (semContagem)
      if (timerContagem) { limpar(timerContagem); timerContagem = null; }
      est.rc = fase === 'ReadyCheck' ? { desde: agora(), vista: false } : null;
      if (est.rc) timerContagem = agendar(() => { timerContagem = null; resolver(); }, CONTAGEM_MS + 50);
      // etapa do fim de partida: a do evento pode chegar antes da fase (WaitingForStats -> PreEndOfGame guarda); fora do fim de
      // partida ela não vale mais. Sem etapa lida em ESPERA_SEQ_MS, o destino expande (o de antes do passo 12)
      if (fase !== 'WaitingForStats' && fase !== 'PreEndOfGame') { est.seq = null; est.honraVista = false; }
      est.seqDesde = fase === 'PreEndOfGame' ? agora() : null;
      if (fase === 'PreEndOfGame') agendarSeq((prazoSemEtapa() ?? ESPERA_SEQ_MS) + 50);
      // a lateral sabe da fase antes do resolver: o coach e a sala do time saem da largura antes de a janela encolher
      gancho('aoFase', fase);
      resolver();
    },
    // /lol-pre-end-of-game/v1/currentSequenceEvent: name ('' = nenhuma etapa); Delete = ''
    aoSequencia(nome) {
      const n = typeof nome === 'string' ? nome : '';
      if (est.seq && est.seq.nome === n) return;
      est.seq = { nome: n, desde: agora() };
      if (n === SEQ_HONRA) est.honraVista = true;
      else if (SEQ_SOZINHAS.includes(n)) agendarSeq(ESPERA_CELEBRACAO_MS + 50);
      else if (n) agendarSeq(SEQ_FIRME_MS + 50);
      else { const p = prazoSemEtapa(); if (p !== null) agendarSeq(p + 50); } // '' também tem prazo (sem ele, ficava preso)
      resolver();
    },
    aoSessao,
    // /lol-champ-select/v1/session (evento ou GET; só leitura): isSpectating marca a partida assistida (etapa 2 de 17/10). Sem o
    // campo (Delete, GET 404, sessão torta) nada muda; nas fases de partida e de fim o sinal da seleção vale até a fase zerar
    aoSelecao(s) {
      if (!s || typeof s !== 'object' || typeof s.isSpectating !== 'boolean') return;
      if (FASES_JOGO.includes(est.fase) || FASES_POS.includes(est.fase)) return;
      // qualquer isSpectating booleano confirma a seleção vinda do menu inicial (D1): a personalizada (false com false) também solta
      const esperava = soltarEsperaSelecao();
      if (!!est.assistindo === s.isSpectating) { if (esperava) resolver(); return; }
      est.assistindo = s.isSpectating;
      log(`seleção: ${s.isSpectating ? 'assistindo a uma partida' : 'partida própria'}`);
      resolver();
    },
    aoModal(desc) {
      if (est.efetivo !== 'compacto' || !desc) return;
      // ready check: o div.modal do ready check pode ganhar o .ready-check-root-element depois da folga da vigia (ela só
      // vê filhos diretos do wrapper) e ser lido como desconhecido. Confere de novo em MODAL_RC_MS: o do ready check já
      // tem o conteúdo (vigia.aberto() devolve null); modal desconhecido de verdade segue aberto e expande
      if (est.fase === 'ReadyCheck' && desc === 'modal') {
        if (timerModalRc) return;
        timerModalRc = agendar(() => {
          timerModalRc = null;
          let d = null;
          try { d = modalAberto(); } catch { d = null; }
          if (d) forcarPorModal(d);
        }, MODAL_RC_MS);
        return;
      }
      forcarPorModal(desc);
    },
    alternar(gatilho) {
      if (!cfg.compacto?.ligado) { avisar('client compacto desligado nas configurações', true); return; }
      if (est.efetivo === 'compacto') expandirPorTi(gatilho); else compactarPorTi(gatilho);
    },
    compactar: compactarPorTi,
    expandir: expandirPorTi,
    marcarPronto() { est.pronto = true; resolver(); },
    reavaliar: resolver,
    sincronizar: resolver, // cfg mudou (ligado, inicioCompacto, tamanho)
    estado,
    preCarregar() { for (const nome of Object.keys(TELAS)) carregar(nome); },
    montada: () => (montagem ? { nome: montagem.nome, ctx: montagem.ctx } : null),
    // passo 13: largura da lateral (estado único) e as Configurações da Riot abertas pelo painel
    pedirLateral, larguraLateral: () => ({ ...est.lateral }), medidasJanela, abrirConfigRiot, configRiotFechou,
    partes: () => (est.efetivo === 'compacto' ? camada.partes?.() || null : null),
  };
}

// Arrastar a janela compacta pelo topo da camada (Window.MoveTo, px físicos): sempre sobra um pedaço do topo à vista. Base e
// limites pela tela da geometria (ScreenData); sem ela, a conta antiga com window.screenX/screen.*. Cada MoveTo do arrasto vai
// para a geometria (anotarPosicao) e o fim relê a tela: sem isso o 2º arrasto saltava de volta ao lugar do 1º e a decisão 1
// ("abre só se couber sem mover") usava a posição velha (revisão de 14/10/2026). escala: o ponteiro anda em px da página, a
// janela em px físicos (× zoomScale [S], ARMADILHAS § Client). Testável: tools/teste-compacto-lateral.mjs.
export function criarArrastoJanela({ geometria, janela, medidas = () => null, win = globalThis.window, raf }) {
  const telaViva = () => { const t = geometria?.tela?.(); return t && !t.minimizada ? t : null; };
  return criarArrasto({
    posicao: () => { const t = telaViva(); return t ? [t.x, t.y] : [Number(win?.screenX ?? win?.screenLeft), Number(win?.screenY ?? win?.screenTop)]; },
    mover: (x, y) => { janela.mover(x, y); geometria?.anotarPosicao?.(x, y); },
    escala: () => telaViva()?.z || 1,
    aoSoltar: () => { geometria?.reler?.().catch?.(() => {}); },
    limites: () => {
      const t = telaViva();
      if (t) {
        const w = (medidas()?.larg || Number(win?.innerWidth) || 420) * t.z;
        return { minX: t.L - (w - 120), maxX: t.L + t.W - 120, minY: t.T, maxY: t.T + t.H - 60 };
      }
      const s = win?.screen || {}, x0 = Number(s.availLeft) || 0, y0 = Number(s.availTop) || 0;
      const aw = Number(s.availWidth), ah = Number(s.availHeight), w = Number(win?.outerWidth) || Number(win?.innerWidth) || 420;
      return { minX: x0 - (w - 120), maxX: Number.isFinite(aw) ? x0 + aw - 120 : undefined, minY: y0, maxY: Number.isFinite(ah) ? y0 + ah - 60 : undefined };
    },
    ...(raf ? { raf } : {}),
  });
}

// Liga tudo no client. servicos: o que as telas usam do resto do plugin (fila rápida, winrate, runas, pós-jogo...).
export function iniciarCompacto(context, cfg, servicos = {}) {
  const doc = document;
  const invocar = invocadorRiot(window);
  const janela = criarJanela({ invocar, medir: () => [window.innerWidth, window.innerHeight] });
  let rot = null;
  // passo 13: onde a janela fica quando a lateral abre/fecha (ScreenData da Riot; px físicos no MoveTo, CSS no ResizeTo)
  const geometria = criarGeometria({
    lerTela: () => lerTelaRiot(window),
    mover: (x, y) => janela.mover(x, y),
    medidas: () => rot?.medidasJanela() || null,
    log: (...a) => console.log('[lol-client] compacto:', ...a),
    ativo: () => geometriaAtiva(rot?.estado()),
    // crescer: CSS e MoveTo só com a página já na largura nova (evento resize); quadros pelo rAF (com rede, minimizada não trava)
    quadro: quadroDaPagina(window), esperarTamanho: esperarTamanhoDaPagina(window), agora: () => performance.now(),
  });
  const arrasto = criarArrastoJanela({ geometria, janela, medidas: () => rot?.medidasJanela() || null, win: window, raf: fn => requestAnimationFrame(fn) });
  const camada = criarCamada({
    doc,
    arrasto,
    aoExpandir: () => rot?.expandir('botão ⤢'),
    // "–": a conversa marcada como lida deixa de ser a ativa do client antes de sumir (senão as mensagens chegam já lidas)
    aoMinimizar: () => { try { lateral.aoOculto(); } catch { /* segue */ } janela.minimizar(); },
    aoFechar: () => janela.sair(),
    avisoFechar: () => (rot?.estado().fase === 'ChampSelect'
      ? 'fechar o client agora é dodge: perde PDL e fica um tempo sem poder buscar. fechar mesmo assim?'
      : FASES_JOGO.includes(rot?.estado().fase)
        ? 'fechar o client na partida: o jogo segue aberto, mas reconectar e o pós-jogo dependem do client. fechar mesmo assim?'
        : 'fechar o client?'),
  });
  const botao = criarBotaoModo({ doc, aoClicar: () => rot?.compactar(), raf: fn => requestAnimationFrame(fn) });
  const vigia = criarVigiaModais({ doc, aoModal: d => rot?.aoModal(d) });
  // passo 13: lateral (chat ao lado, configurações à esquerda, coach da seleção). Escrita só por clique dele
  const lateral = criarLateral({
    cfg, rot: () => rot, doc, lcu: lcuPadrao, servicos, geometria, definir: servicos.definir || (() => {}),
    avisar: (m, erro) => avisarPadrao(m, erro), log: (...a) => console.log('[lol-client] compacto:', ...a),
    abrirConfigRiot: () => abrirConfigRiot(),
  });
  // etapa 3 de 2026-10-16: o fundo do perfil dele como fundo da coluna (só GET; variável e classe no <html>, que sobrevivem à cópia
  // da camada que a Riot faz no boot). Liga no ligarDom; a chave compacto.fundoPerfil vale na hora (sincronizar)
  const fundo = criarFundo({ cfg, lcu: lcuPadrao, doc, log: (...a) => console.log('[lol-client] compacto:', ...a) });
  // passo 15: registro das expansões. Janela em px CSS (inner*) e a posição/monitor da geometria (px físicos, ScreenData);
  // envio ao coletor (POST /compacto/expansoes) com fila em memória: coletor fora ou sem a rota guarda e reenvia. Só com o
  // complemento coach anunciando "expansoes"; com o aperto de mão pendente guarda, sem a chave ou sem o recurso descarta
  // (coach.js destinoRecurso; Fase 1 de roadmap/2026-10-17-plugin-pengu-primeiro.md)
  const colExp = servicos.coletor || coletorPadrao;
  const registro = criarRegistroExpansoes({
    enviar: enviarAoColetor(colExp, () => destinoDe(colExp, 'expansoes')),
    medir: () => {
      const t = geometria.tela?.();
      return { larg: window.innerWidth, alt: window.innerHeight, x: Number(window.screenX), y: Number(window.screenY),
        compacta: janela.ehCompacta(), ...(t ? { telaX: t.x, telaY: t.y, monitor: [t.L, t.T, t.W, t.H], zoom: t.z, minimizada: !!t.minimizada } : {}) };
    },
    log: (...a) => console.log('[lol-client] compacto:', ...a),
  });
  let gesto = null; // último clique/tecla dele na página {em (ms do relógio), dentro (na camada)}: ligarDom escuta na captura
  rot = criarRoteador({
    cfg, janela, camada, geometria, lateral, registro, camadasRiot: () => descreverCamadas(doc),
    gestoHaMs: () => (gesto == null ? null : { haMs: Date.now() - gesto.em, dentro: gesto.dentro }),
    carregarTela: nome => import(TELAS[nome]),
    servicos: { context, ...servicos, lateral },
    assinar: (uri, cb) => context.socket.observe(uri, cb),
    classe: ligado => doc.documentElement.classList.toggle(CLASSE, ligado),
    modalAberto: () => vigia.aberto(),
    aceiteManual: () => doc.documentElement.classList.contains('lc-aceite-manual'),
    // pengu/index.js passa o retorno do iniciarAceite (null = o módulo quebrou no init: o popup da Riot segue
    // escondido pelo estilo.css e ninguém aceita; ceder com a janela pequena perderia a partida)
    aceiteVivo: () => ('aceite' in servicos ? !!servicos.aceite : undefined),
    // contagem do aceite.js (mostrarOverlay põe #lc-aceite no <body>)
    contagemNaTela: () => !!doc.getElementById('lc-aceite'),
    // passo 14: com o jogo na frente a página não tem o foco; aí o roteador não mexe na janela (relê no evento focus abaixo)
    temFoco: () => { try { return typeof doc.hasFocus === 'function' ? doc.hasFocus() : true; } catch { return true; } },
    // botão "▣ modo compacto" só no client normal; na seleção e na partida a barra da Riot não aparece: botão flutuante
    aoAplicar: e => botao.sincronizar(!!cfg.compacto?.ligado && e.efetivo === 'expandido', { flutuante: e.fase === 'ChampSelect' || FASES_JOGO.includes(e.fase) }),
  });

  // "Configurações da Riot" do painel B1 (passo 13): expande, abre o modal dela (rcp.whenReady('rcp-fe-lol-settings').show(), o
  // mesmo da engrenagem; existe no 16.20, nunca chamado antes: [S]) e, quando o .lol-settings-container sai da página (a Riot
  // desanexa o modal ao fechar: ARMADILHAS § Client), volta ao compacto. Sem modal em 5 s: avisa e segue vigiando até 10 min.
  let vigiaCfg = null;
  function abrirConfigRiot() {
    rot.abrirConfigRiot();
    const inicio = Date.now();
    let visto = false, avisou = false;
    (async () => {
      try { const s = await globalThis.rcp?.whenReady?.('rcp-fe-lol-settings'); if (typeof s?.show === 'function') { s.show(); return; } } catch (e) { console.error('[lol-client] compacto: configurações da Riot', e); }
      avisarPadrao('abra a engrenagem no topo do client: ao fechar as configurações, o compacto volta', false);
    })();
    clearInterval(vigiaCfg);
    vigiaCfg = setInterval(() => {
      const aberto = !!doc.querySelector('.lol-settings-container');
      if (aberto) visto = true;
      else if (visto) { clearInterval(vigiaCfg); vigiaCfg = null; rot.configRiotFechou(); return; }
      if (!visto && !avisou && Date.now() - inicio > 5000) { avisou = true; avisarPadrao('as Configurações da Riot não abriram sozinhas: use a engrenagem no topo', true); }
      if (Date.now() - inicio > 600000) { clearInterval(vigiaCfg); vigiaCfg = null; }
    }, 500);
  }

  const lerSessao = () => lcuPadrao('GET', '/lol-gameflow/v1/session').then(r => { if (r.ok && r.json) rot.aoSessao(r.json); });
  // espectador (etapa 2 de 17/10): isSpectating da sessão da seleção, por evento e por um GET na entrada (só leitura; não segura a
  // tela da seleção: a ranqueada nunca espera por este GET)
  const lerSelecao = () => lcuPadrao('GET', '/lol-champ-select/v1/session').then(r => { if (r.ok && r.json) rot.aoSelecao(r.json); }).catch(() => {});
  context.socket.observe('/lol-champ-select/v1/session', msg => { if (msg?.eventType !== 'Delete' && msg?.data) rot.aoSelecao(msg.data); });
  // etapa do fim de partida (honra x celebrações, passo 12): evento + leitura ao entrar no PreEndOfGame
  const lerSequencia = () => lcuPadrao('GET', '/lol-pre-end-of-game/v1/currentSequenceEvent')
    .then(r => { if (r.ok && r.json && typeof r.json === 'object') rot.aoSequencia(String(r.json.name ?? '')); });
  context.socket.observe('/lol-pre-end-of-game/v1/currentSequenceEvent', msg => {
    rot.aoSequencia(msg?.eventType === 'Delete' ? '' : String(msg?.data?.name ?? ''));
  });
  // o evento da etapa é [S] e a etapa vira honor-vote ~0,1 s DEPOIS da fase (sonda de 14/10): uma leitura só, na entrada,
  // podia pegar "" e deixar a honra compacta sem montar. Relê a cada 1 s enquanto a fase é PreEndOfGame, por até 60 s (o
  // teto da honra da Riot é 40 s), também durante a honra: o fim dela ('') trava o "prosseguir" e dá o prazo para expandir
  // se a Riot não sair da fase (revisão de 14/10/2026). Só GET. Relógio cru como o resto do iniciarCompacto (sem teste).
  let releSeq = null;
  const vigiarSequencia = () => {
    if (releSeq) clearInterval(releSeq);
    const ate = Date.now() + 60000;
    releSeq = setInterval(() => {
      if (rot.estado().fase !== 'PreEndOfGame' || Date.now() > ate) { clearInterval(releSeq); releSeq = null; return; }
      lerSequencia().catch(() => {});
    }, 1000);
  };
  context.socket.observe('/lol-gameflow/v1/gameflow-phase', msg => {
    const f = msg?.data;
    if (typeof f !== 'string') return;
    rot.aoFase(f);
    if (f === 'ChampSelect') { lerSessao(); lerSelecao(); }
    if (f === 'PreEndOfGame') { lerSequencia().catch(() => {}); vigiarSequencia(); }
  });
  context.socket.observe('/lol-gameflow/v1/session', msg => { if (msg?.eventType !== 'Delete' && msg?.data) rot.aoSessao(msg.data); });
  // fase inicial (recarga do plugin no meio de qualquer fase); falha = tenta de novo, a fase do socket também chega
  const lerFase = async (tentativa = 0) => {
    const r = await lcuPadrao('GET', '/lol-gameflow/v1/gameflow-phase');
    if (typeof r.json === 'string') { rot.aoFase(r.json); if (r.json === 'ChampSelect') { lerSessao(); lerSelecao(); } if (r.json === 'PreEndOfGame') { lerSequencia().catch(() => {}); vigiarSequencia(); } return; }
    if (tentativa < 5) setTimeout(() => lerFase(tentativa + 1), 3000);
    else rot.aoFase(null);
  };
  lerSessao().catch(() => {});
  lerFase().catch(() => {});

  // DOM só depois do DOMContentLoaded (o Pengu chama init antes do <body>: ARMADILHAS § Client)
  const ligarDom = () => {
    estilo('lc-compacto-estilo', CSS, doc);
    estilo('lc-lt-estilo', CSS_LATERAL, doc);
    fundo.iniciar();
    botao.ligar();
    vigia.ligar();
    // registro das expansões: o ctx.expandir() de uma tela até GESTO_MS depois disto é dele (só o instante; nada do evento sai).
    // Tecla só Enter/Espaço (aciona botão): digitar no chat do compacto não é pedido de expandir (revisão adversarial 15/10)
    // o alvo vale junto (só se estava na camada do compacto: etapa 3 de 17/10/2026; nada do evento sai além disso)
    doc.addEventListener('pointerdown', e => { gesto = { em: Date.now(), dentro: gestoDentro(doc, e?.target) }; }, true);
    doc.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') gesto = { em: Date.now(), dentro: gestoDentro(doc, e?.target) }; }, true);
    // popup do ready check que volta (aceite manual): sai da tela compacta e expande
    if (typeof MutationObserver !== 'undefined')
      new MutationObserver(() => { if (rot.estado().fase === 'ReadyCheck') rot.reavaliar(); })
        .observe(doc.documentElement, { attributes: true, attributeFilter: ['class'] });
    // camada trocada por cópia (boot da Riot): o roteador remonta. Observa só os filhos do <body>; o intervalo cobre
    // um <body> novo (o observador ficaria preso no antigo)
    // no ready check também: a contagem do aceite (#lc-aceite) entrando no <body> conta como vista (semContagem)
    const conferirCamada = () => { if ((camada.existe() && !camada.conectada()) || rot.estado().fase === 'ReadyCheck') rot.reavaliar(); };
    if (typeof MutationObserver !== 'undefined') new MutationObserver(conferirCamada).observe(doc.body, { childList: true });
    setInterval(conferirCamada, 2000);
    // atalho só com a chave ligada: desligado, o Ctrl+Shift+M segue para o client como se o plugin não existisse
    window.addEventListener('keydown', e => {
      if (!cfg.compacto?.ligado || !ehAtalho(e)) return;
      e.preventDefault(); e.stopPropagation();
      rot.alternar('atalho Ctrl+Shift+M');
    }, true);
    // a Riot pode devolver a janela a 1280×720 sozinha (restore, ux-show do aceite.js) [S]: relê agora e de novo depois
    // da folga do ResizeTo (GRACA_MEDIDA_MS), senão a camada de 1280 ficava de pé até a próxima fase
    let tResize = null, tResize2 = null;
    window.addEventListener('resize', () => {
      clearTimeout(tResize); clearTimeout(tResize2);
      tResize = setTimeout(() => rot.reavaliar(), 300);
      tResize2 = setTimeout(() => rot.reavaliar(), GRACA_MEDIDA_MS + 200);
    });
    // passo 14: ele voltou ao client com a partida rodando (alt-tab, barra de tarefas): o que esperava o foco (encolher, expandir
    // por regra 7) acontece agora, com ele olhando
    window.addEventListener('focus', () => { if (rot.estado().adiado) rot.reavaliar(); });
    // ...e por releitura (revisão adversarial, achado 2): com o foco dentro de um iframe (o chat da Riot) a página de cima não
    // recebe focus/blur (ARMADILHAS § Client; o aceite.js testa hasFocus() a cada 250 ms pelo mesmo motivo). Só estado local, nenhuma chamada à LCU
    setInterval(() => { try { if (voltouAoClient(rot.estado(), doc.hasFocus?.())) rot.reavaliar(); } catch { /* segue */ } }, FOCO_RELE_MS);
    // janela minimizada ou escondida por outro caminho (barra de tarefas, Win+D): devolve a conversa ativa (revisão de 14/10/2026)
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'hidden') { try { lateral.aoOculto(); } catch { /* segue */ } } });
    rot.preCarregar();
    rot.marcarPronto();
  };
  if (doc.body) ligarDom();
  else doc.addEventListener('DOMContentLoaded', ligarDom, { once: true });

  // o aviso do modo às janelas do chat do complemento (a cada 60 s) saiu em 19/10/2026 com as janelas (Fase 2 de
  // roadmap/2026-10-17-plugin-pengu-primeiro.md): o chat é só o ao lado (compacto/lateral.js)

  // medição (passo 1): camadas da Riot vistas, para conferir a lista da regra 7 depois de uma partida real
  // (node tools/cdp.mjs eval com window.__lolClient.compacto.modais(); só tag e classe, nunca texto)
  return {
    ...rot,
    // cfg mudou: roteador + lateral (configurações repintam, compacto desligado fecha o chat) + fundo
    sincronizar() { rot.sincronizar(); lateral.sincronizar(); fundo.sincronizar(); },
    modais: () => vigia.historico(),
    // etapa 3: o fundo da coluna (url à vista, último erro, leituras) — tools/cdp.mjs eval __lolClient.compacto.fundo()
    fundo: () => fundo.estado(),
    // passo 15: expansão aberta, fila sem coletor, último envio e os 10 últimos eventos (tools/cdp.mjs eval)
    expansoes: () => registro.estado(),
    lateral, geometria: () => geometria.estado(),
  };
}

// Ação que abre tela do plugin por cima do client normal (Ctrl+K "analisar última partida", plano passo 11 b2): com a
// camada à vista o #lc-posjogo nasceria escondido (html.lc-modo-compacto), o clique fora dele fecharia no 1º clique na
// camada e o keydown de captura comeria o Esc. Expande antes (vale como o "⤢ expandir" dele: o roteador é síncrono) e
// só então abre; se a camada não sair, não abre por baixo dela e avisa. compacto null (quebrou no init) = abre direto.
// aVista: html.lc-modo-compacto (a classe que o CSS usa para esconder o painel). -> o retorno de abrir() | null
export function expandirAntes({ compacto, abrir, aVista = () => !!globalThis.document?.documentElement?.classList?.contains(CLASSE),
  avisar = avisarPadrao }) {
  const naCamada = () => { try { return aVista() || compacto?.estado?.().efetivo === 'compacto'; } catch { return false; } };
  if (naCamada()) {
    try { compacto?.expandir?.('Ctrl+K'); } catch (e) { console.error('[lol-client] compacto: expandir', e); }
    if (naCamada()) { avisar('não foi possível sair do modo compacto: use expandir e chame de novo pelo Ctrl+K', true); return null; }
  }
  return abrir();
}
