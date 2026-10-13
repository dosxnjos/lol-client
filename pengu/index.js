// lol-client: plugin do Pengu Loader. Plano: ../roadmap/2026-10-13-lol-client-v1.md
// O Pengu chama init() antes do <body> existir: módulo que mexe no DOM espera o DOMContentLoaded.
import './estilo.css';
import { cfg, carregar, registrarAcoes, definir, aoMudar, classes } from './config.js';
import { iniciarAceite, mostrarOverlay, esconderOverlay } from './aceite.js';
import { iniciarFilaRapida } from './fila-rapida.js';
import { iniciarPosjogo, analisarUltima, abrirPainel, analisarPartida, fecharPainel } from './posjogo/index.js';

// um módulo quebrado não derruba os outros
const seguro = (nome, fn) => { try { return fn(); } catch (e) { console.error(`[lol-client] ${nome}`, e); return null; } };

export function init(context) {
  seguro('config', carregar);
  seguro('aceite', () => iniciarAceite(context, cfg));
  const fila = seguro('fila rápida', () => iniciarFilaRapida(context, cfg));
  seguro('pós-jogo', () => iniciarPosjogo(context, cfg));
  seguro('ações', () => registrarAcoes([
    { name: 'lol-client: analisar última partida', tags: ['lol-client', 'pós-jogo'], perform: () => analisarUltima() },
  ]));

  // ponto de acesso para depuração e testes (cdp.mjs eval); prepararLobby não busca partida
  window.__lolClient = {
    cfg, definir, aoMudar, classes,
    prepararLobby: fila?.prepararLobby,
    analisarUltima, abrirPainel, analisarPartida, fecharPainel,
    aceite: { mostrarOverlay, esconderOverlay }, // overlay só desenha; quem aceita é o observador
  };
  document.documentElement.dataset.lolClient = 'ok';
  console.log('[lol-client] ok');
}
