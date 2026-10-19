// lol-client: plugin do Pengu Loader. Plano: ../roadmap/2026-10-13-lol-client-v1.md
// O Pengu chama init() antes do <body> existir: módulo que mexe no DOM espera o DOMContentLoaded.
import './estilo.css';
import { cfg, carregar, registrarAcoes, registrarAcoesCoach, definir, aoMudar, classes, restaurar } from './config.js';
import { iniciarConfiguracoes, registrarBloco, usarRecursos, redesenharConfiguracoes } from './configuracoes.js';
import { iniciarAceite, mostrarOverlay, esconderOverlay } from './aceite.js';
import { iniciarFilaRapida } from './fila-rapida.js';
import { iniciarPosjogo, analisarUltima, abrirPainel, analisarPartida, fecharPainel, ocupado as posjogoOcupado } from './posjogo/index.js';
import { iniciarHistorico } from './historico.js';
import { AMOSTRA_LOCAL } from './posjogo/contexto.js';
import { iniciarChampSelect } from './champselect.js';
import { iniciarRunas } from './runas.js';
import { iniciarRecompensas, levantar, criarLcu } from './recompensas.js';
import { blocoChampSelect, blocoRunas, blocoConexao, blocoCoachAusente, blocoPainel, blocoVoz, blocoAlertas, blocoMinimapa, blocoMentor,
  blocoCarregamento, blocoTraumas, blocoCompacto } from './blocos.js';
import { coletor, sincronizarConfig, estadoPonte, iniciarPonte, aoFasePonte, aoMudarPonte, mostraRecurso, naSessao, apertarMao,
  temRecurso } from './coach.js';
import { iniciarSemPopups, blocoSemPopups } from './sem-popups.js';
import { iniciarChatPosjogo, blocoChatPosjogo } from './chat-posjogo.js';
import { iniciarCompacto, expandirAntes } from './compacto/index.js';

// um módulo quebrado não derruba os outros
const seguro = (nome, fn) => { try { return fn(); } catch (e) { console.error(`[lol-client] ${nome}`, e); return null; } };

// "não aceitar" e diagnóstico do aceite ao complemento (POST /aceite/plugin; a reserva dele aceita se este não aceitar).
// Só com a reserva no último aperto de mão bom (coach.js naSessao); por evento (evento: true), nunca preso ao recuo da ponte
export const avisarAceite = (caminho, opcoes = {}) => (naSessao('aceite-reserva')
  ? coletor(caminho, { ...opcoes, evento: true }) : Promise.resolve({ status: 0, dados: null }));

export function init(context) {
  seguro('config', carregar);
  // ponte com o complemento coach (coach.js): nada fala com a 8765 sem cfg.coletor.ligado e sem aperto de mão bom.
  // Aperto de mão na carga e nas viradas de fase (None/Lobby/EndOfGame; Matchmaking e ReadyCheck fora do recuo)
  seguro('ponte', () => iniciarPonte(cfg));
  seguro('ponte: fases', () => context.socket.observe('/lol-gameflow/v1/gameflow-phase', msg => { seguro('ponte: fase', () => aoFasePonte(msg?.data)); }));
  // antes de tudo: os plugins do client começam a pedir logo depois deste init (só GET das rotas exatas; sem-popups.js)
  const semPopups = seguro('sem popups', () => iniciarSemPopups(cfg));
  const aceite = seguro('aceite', () => iniciarAceite(context, cfg, { avisarColetor: avisarAceite }));
  // champ select antes da fila rápida: o cache de histórico dele alimenta o freio de tilt (sem ele, a fila lê sozinha)
  const champ = seguro('champ select', () => iniciarChampSelect(context, cfg, coletor));
  const historico = champ ? { partidas: champ.partidas, ler: champ.lerHistorico } : null;
  const fila = seguro('fila rápida', () => iniciarFilaRapida(context, cfg, { historico }));
  const posjogo = seguro('pós-jogo', () => iniciarPosjogo(context, cfg, coletor));
  // acumulador do histórico próprio no DataStore (historico.js, Fase 4 do plano plugin Pengu primeiro): a partida que acaba
  // entra pelo pós-jogo; o backfill (só None/Lobby) usa a lista que o selo já leu e espera o pós-jogo e a lista em voo;
  // com "resumos" anunciado, importa do complemento uma vez por abertura
  // fonte local de matchup e traumas (contexto.js, Fase 5): o acumulador desta conta com amostra. A chave "Mostrar traumas" e o
  // atalho dela no Ctrl+K aparecem com ela ou com o complemento ("draft"/"contexto"); "historico" é o nome dessa fonte em
  // ALTERNAVEIS_COACH (config.js), não um recurso do aperto de mão
  // minhas = as linhas que a conta da sessão vê (0 com outra conta ou com a conta ainda não lida; revisão adversarial da Fase 5)
  const temAmostraLocal = () => (acumulador?.estado()?.minhas || 0) >= AMOSTRA_LOCAL;
  const mostraComLocal = nome => mostraRecurso(nome) || (nome === 'historico' && temAmostraLocal());
  let amostraVista = false;
  // a amostra desta conta chegou ao mínimo (conta lida na carga, pós-jogo, backfill ou importação): a chave e o atalho dos
  // traumas aparecem sem recarregar
  const aoAmostra = () => {
    if (amostraVista || !temAmostraLocal()) return;
    amostraVista = true;
    seguro('configurações', () => redesenharConfiguracoes());
    seguro('ações do coach', () => registrarAcoesCoach(mostraComLocal));
  };
  const acumulador = seguro('histórico', () => iniciarHistorico(context, {
    partidas: () => champ?.partidas() ?? null,
    ocupado: () => !!(posjogoOcupado() || champ?.estado().carregando),
    coletor, temRecurso, aoSalvar: aoAmostra, aoConta: aoAmostra,
  }));
  const chat = seguro('chat do pós-jogo', () => iniciarChatPosjogo(context, cfg));
  const runas = seguro('runas', () => iniciarRunas(context, cfg));
  const recompensas = seguro('recompensas', () => iniciarRecompensas(context, cfg));
  // client compacto (roadmap/2026-10-13-client-compacto.md): roteador por fase; telas em compacto/tela-*.js
  // (definir: a tela 1 grava fila e posições em filaRapida.*; coletor: o fetch da ponte (coach.js) das telas e do registro das expansões; aceite: null = o
  // aceite.js quebrou no init e o ReadyCheck expande em vez de ceder)
  const compacto = seguro('compacto', () => iniciarCompacto(context, cfg, { fila, champ, runas, posjogo, coletor, historico, definir, aceite }));
  // blocos e chaves do coach só com o recurso do complemento (procurando: os do último aperto de mão bom, lol-client.ponte)
  seguro('configurações: recursos', () => usarRecursos(mostraRecurso));
  seguro('configurações', () => iniciarConfiguracoes({ cfg, definir, aoMudar, restaurar }));
  seguro('blocos', () => {
    const com = (...nomes) => ({ visivel: () => nomes.some(n => mostraRecurso(n)) });
    registrarBloco('champSelect', blocoChampSelect(champ));
    registrarBloco('runas', blocoRunas);
    registrarBloco('coach', blocoConexao(estadoPonte, () => apertarMao('procurar agora')), 'Complemento coach');
    registrarBloco('coachAusente', blocoCoachAusente, 'Coach ao vivo', { visivel: () => !mostraRecurso('coach') });
    registrarBloco('painel', blocoPainel, 'Painel ao vivo (2ª tela)', com('painel'));
    registrarBloco('voz', blocoVoz, 'Voz', com('voz'));
    registrarBloco('alertas', blocoAlertas, 'Alertas na tela', com('alertas'));
    registrarBloco('minimapa', blocoMinimapa, 'Minimapa e jungler', com('minimapa', 'feiticos'));
    registrarBloco('mentor', blocoMentor, 'Mentor', com('mentor'));
    registrarBloco('carregamento', blocoCarregamento, 'Tela de carregamento', com('carregamento'));
    registrarBloco('traumas', blocoTraumas, 'Traumas', { visivel: () => ['draft', 'contexto', 'historico'].some(mostraComLocal) });
    registrarBloco('chatPosjogo', blocoChatPosjogo, 'Chat do pós-jogo');
    registrarBloco('semPopups', blocoSemPopups, 'Avisos do client');
    registrarBloco('compacto', blocoCompacto, 'Client compacto');
  });
  // a config do coach vai no aperto de mão bom com "coach" (coach.js) e a cada mudança: aoMudar abaixo
  // liga/desliga sem recarregar: aceite desligado cancela a contagem em curso; fila rápida tira/põe o botão;
  // winrate redesenha (ou some) na hora; runas desligadas fecham o popup aberto
  aoMudar(c => {
    if (!c.aceite.ligado) seguro('aceite', () => aceite?.avaliar(null));
    seguro('fila rápida', () => fila?.sincronizar());
    seguro('champ select', () => champ?.desenhar());
    if (!c.runas.ligado) seguro('runas', () => runas?.fecharPopup());
    seguro('coach', () => sincronizarConfig(c));
    seguro('chat do pós-jogo', () => chat?.atualizar()); // nomes, cores e avisos repintam na hora (desligado devolve o original)
    seguro('compacto', () => compacto?.sincronizar()); // ligado/inicioCompacto/tamanho valem na hora
  });
  // o complemento achado, perdido ou com outros recursos: blocos, ⚙ do compacto, selo e atalhos do Ctrl+K reagem sem recarregar
  aoMudarPonte(() => {
    seguro('configurações', () => redesenharConfiguracoes());
    seguro('compacto', () => compacto?.sincronizar());
    seguro('champ select', () => champ?.desenhar());
    seguro('ações do coach', () => registrarAcoesCoach(mostraComLocal));
    seguro('histórico', () => acumulador?.cutucar()); // complemento com "resumos" achado: a importação sai no próximo passo
  });
  // com a camada compacta à vista, expande antes de abrir o painel (compacto/index.js expandirAntes, passo 11 b2)
  seguro('ações', () => registrarAcoes([
    { name: 'lol-client: analisar última partida', tags: ['lol-client', 'pós-jogo'], perform: () => expandirAntes({ compacto, abrir: () => (posjogo?.analisarAgora ?? analisarUltima)() }) },
  ]));
  // atalhos coach.* do Ctrl+K: só os do recurso anunciado (ou lembrado); os que aparecerem depois entram no aperto de mão
  seguro('ações do coach', () => registrarAcoesCoach(mostraComLocal));

  // ponto de acesso para depuração e testes (cdp.mjs eval); prepararLobby não busca partida
  window.__lolClient = {
    cfg, definir, aoMudar, classes, registrarBloco,
    prepararLobby: fila?.prepararLobby,
    derrotasSeguidas: fila?.derrotasSeguidas, // o que o freio de tilt da fila rápida vê agora (só leitura; null = não sei)
    analisarUltima, abrirPainel, analisarPartida, fecharPainel,
    posjogo, // aba('rota') troca a aba do painel aberto (prints da prova)
    // ponte com o complemento coach: estado() (ligado, visto, recursos, recuo), apertar() força um aperto de mão (só GET /ola)
    coach: { coletor, estado: estadoPonte, temRecurso, apertar: () => apertarMao('cdp'), sincronizar: () => sincronizarConfig(cfg) },
    aceite: { mostrarOverlay, esconderOverlay }, // overlay só desenha; quem aceita é o observador
    winrate: champ, // estado(), estatisticas(championId, posicao), lerHistorico()
    historico: acumulador && { estado: acumulador.estado, linhas: acumulador.linhas }, // acumulador (só leitura)
    runas, // aoTravar(championId, posicao) simula o travamento: aplica a runa ou abre o popup
    // levantar() só lê (GET): o que está pendente e o motivo de pular cada item; rodar() coleta de verdade
    recompensas: { levantar: () => levantar(criarLcu(), cfg), rodar: () => recompensas?.rodar('manual'), estado: () => recompensas?.estado() },
    foco: () => aceite?.foco?.estado(),
    chatPosjogo: chat, // estado() e atualizar()
    semPopups, // rotaFalsa(metodo, url): o que seria respondido por nós agora (só consulta)
    compacto, // estado(), alternar(), compactar(), expandir(), reavaliar()
  };
  document.documentElement.dataset.lolClient = 'ok';
  console.log('[lol-client] ok');
}
