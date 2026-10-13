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
import { iniciarRecompensas, levantar, criarLcu } from './recompensas.js';
import { blocoChampSelect, blocoRunas, blocoConexao, blocoPainel, blocoVoz, blocoAlertas, blocoMinimapa, blocoMentor,
  blocoCarregamento, blocoTraumas } from './blocos.js';
import { coletor, sincronizarConfig, estadoConexao } from './coach.js';

// um módulo quebrado não derruba os outros
const seguro = (nome, fn) => { try { return fn(); } catch (e) { console.error(`[lol-client] ${nome}`, e); return null; } };

export function init(context) {
  seguro('config', carregar);
  const aceite = seguro('aceite', () => iniciarAceite(context, cfg));
  // champ select antes da fila rápida: o cache de histórico dele alimenta o freio de tilt (sem ele, a fila lê sozinha)
  const champ = seguro('champ select', () => iniciarChampSelect(context, cfg, coletor));
  const historico = champ ? { partidas: champ.partidas, ler: champ.lerHistorico } : null;
  const fila = seguro('fila rápida', () => iniciarFilaRapida(context, cfg, { historico }));
  const posjogo = seguro('pós-jogo', () => iniciarPosjogo(context, cfg, coletor));
  const runas = seguro('runas', () => iniciarRunas(context, cfg));
  const recompensas = seguro('recompensas', () => iniciarRecompensas(context, cfg));
  seguro('configurações', () => iniciarConfiguracoes({ cfg, definir, aoMudar, restaurar }));
  seguro('blocos', () => {
    registrarBloco('champSelect', blocoChampSelect(champ));
    registrarBloco('runas', blocoRunas);
    registrarBloco('coach', blocoConexao(estadoConexao), 'Coach: coletor');
    registrarBloco('painel', blocoPainel, 'Painel ao vivo (2ª tela)');
    registrarBloco('voz', blocoVoz, 'Voz');
    registrarBloco('alertas', blocoAlertas, 'Alertas na tela');
    registrarBloco('minimapa', blocoMinimapa, 'Minimapa e jungler');
    registrarBloco('mentor', blocoMentor, 'Mentor');
    registrarBloco('carregamento', blocoCarregamento, 'Tela de carregamento');
    registrarBloco('traumas', blocoTraumas, 'Traumas');
  });
  // config do coach para o coletor: agora e a cada mudança (o coletor sobe depois: coach.js tenta de novo)
  seguro('coach', () => sincronizarConfig(cfg));
  // liga/desliga sem recarregar: aceite desligado cancela a contagem em curso; fila rápida tira/põe o botão;
  // winrate redesenha (ou some) na hora; runas desligadas fecham o popup aberto
  aoMudar(c => {
    if (!c.aceite.ligado) seguro('aceite', () => aceite?.avaliar(null));
    seguro('fila rápida', () => fila?.sincronizar());
    seguro('champ select', () => champ?.desenhar());
    if (!c.runas.ligado) seguro('runas', () => runas?.fecharPopup());
    seguro('coach', () => sincronizarConfig(c));
  });
  seguro('ações', () => registrarAcoes([
    { name: 'lol-client: analisar última partida', tags: ['lol-client', 'pós-jogo'], perform: () => analisarUltima() },
  ]));

  // ponto de acesso para depuração e testes (cdp.mjs eval); prepararLobby não busca partida
  window.__lolClient = {
    cfg, definir, aoMudar, classes, registrarBloco,
    prepararLobby: fila?.prepararLobby,
    derrotasSeguidas: fila?.derrotasSeguidas, // o que o freio de tilt da fila rápida vê agora (só leitura; null = não sei)
    analisarUltima, abrirPainel, analisarPartida, fecharPainel,
    posjogo, // aba('rota') troca a aba do painel aberto (prints da prova)
    coach: { coletor, estadoConexao, sincronizar: () => sincronizarConfig(cfg) },
    aceite: { mostrarOverlay, esconderOverlay }, // overlay só desenha; quem aceita é o observador
    winrate: champ, // estado(), estatisticas(championId, posicao), lerHistorico()
    runas, // aoTravar(championId, posicao) simula o travamento: aplica a runa ou abre o popup
    // levantar() só lê (GET): o que está pendente e o motivo de pular cada item; rodar() coleta de verdade
    recompensas: { levantar: () => levantar(criarLcu(), cfg), rodar: () => recompensas?.rodar('manual'), estado: () => recompensas?.estado() },
    foco: () => aceite?.foco?.estado(),
  };
  document.documentElement.dataset.lolClient = 'ok';
  console.log('[lol-client] ok');
}
