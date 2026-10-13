// lol-client: plugin do Pengu Loader. Plano: ../roadmap/2026-10-13-lol-client-v1.md
// O Pengu chama init() antes do <body> existir: módulo que mexe no DOM espera o DOMContentLoaded.
import './estilo.css';
import { cfg, carregar, registrarAcoes, definir, aoMudar, classes, restaurar } from './config.js';
import { iniciarConfiguracoes, registrarBloco } from './configuracoes.js';
import { iniciarAceite, mostrarOverlay, esconderOverlay } from './aceite.js';
import { iniciarFilaRapida } from './fila-rapida.js';
import { iniciarPosjogo, analisarUltima, abrirPainel, analisarPartida, fecharPainel } from './posjogo/index.js';
import { iniciarChampSelect } from './champselect.js';
import { iniciarRunas } from './runas.js';
import { blocoChampSelect, blocoRunas } from './blocos.js';

// um módulo quebrado não derruba os outros
const seguro = (nome, fn) => { try { return fn(); } catch (e) { console.error(`[lol-client] ${nome}`, e); return null; } };

export function init(context) {
  seguro('config', carregar);
  const aceite = seguro('aceite', () => iniciarAceite(context, cfg));
  const fila = seguro('fila rápida', () => iniciarFilaRapida(context, cfg));
  seguro('pós-jogo', () => iniciarPosjogo(context, cfg));
  const champ = seguro('champ select', () => iniciarChampSelect(context, cfg));
  const runas = seguro('runas', () => iniciarRunas(context, cfg));
  seguro('configurações', () => iniciarConfiguracoes({ cfg, definir, aoMudar, restaurar }));
  seguro('blocos', () => { registrarBloco('champSelect', blocoChampSelect(champ)); registrarBloco('runas', blocoRunas); });
  // liga/desliga sem recarregar: aceite desligado cancela a contagem em curso; fila rápida tira/põe o botão;
  // winrate redesenha (ou some) na hora; runas desligadas fecham o popup aberto
  aoMudar(c => {
    if (!c.aceite.ligado) seguro('aceite', () => aceite?.avaliar(null));
    seguro('fila rápida', () => fila?.sincronizar());
    seguro('champ select', () => champ?.desenhar());
    if (!c.runas.ligado) seguro('runas', () => runas?.fecharPopup());
  });
  seguro('ações', () => registrarAcoes([
    { name: 'lol-client: analisar última partida', tags: ['lol-client', 'pós-jogo'], perform: () => analisarUltima() },
  ]));

  // ponto de acesso para depuração e testes (cdp.mjs eval); prepararLobby não busca partida
  window.__lolClient = {
    cfg, definir, aoMudar, classes, registrarBloco,
    prepararLobby: fila?.prepararLobby,
    analisarUltima, abrirPainel, analisarPartida, fecharPainel,
    aceite: { mostrarOverlay, esconderOverlay }, // overlay só desenha; quem aceita é o observador
    winrate: champ, // estado(), estatisticas(championId, posicao), lerHistorico()
    runas, // aoTravar(championId, posicao) simula o travamento: aplica a runa ou abre o popup
  };
  document.documentElement.dataset.lolClient = 'ok';
  console.log('[lol-client] ok');
}
