// Configuração do plugin: defaults + DataStore + classes no <html> + ações no Ctrl+K (CommandBar).
// Classe: chave booleana em camelCase vira lc-kebab (esconderTft -> lc-esconder-tft);
// <modulo>.ligado vira lc-<modulo> (aceite.ligado -> lc-aceite, filaRapida.ligado -> lc-fila-rapida).
import { avisar as avisarComum } from './compacto/comum.js';

const CHAVE = 'lol-client.config';
const POSICOES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const FILAS = [420, 440];
export const ATRASOS = [3, 4, 5, 6, 7, 8, 9, 10]; // dona única: painel (configuracoes.js) e Ctrl+K
export const FREIOS = [0, 2, 3, 4, 5]; // freio de tilt: 0 = desligado; padrão 2 (decisão do Gabriel, 13/10/2026)
// nomes no chat do pós-jogo (dona única: Configurações e Ctrl+K)
export const NOMES_CHAT = [['ambos', 'nome e campeão'], ['campeao', 'só o campeão'], ['jogador', 'só o nome']];
// escolhas de texto das regras de aviso (dona única: Configurações e a validação do carregar). Mesmos valores de
// servidor_local.ESCOLHAS no coletor (o teste-alertas.py confere)
export const JUNGLER_LONGE = [['painel', 'Só no painel da 2ª tela (padrão)'], ['tudo', 'Falar e piscar a borda também'], ['nada', 'Não mostrar']];
export const OVERLAY_CORES = [['vermelho', 'Vermelho (padrão)'], ['laranja', 'Laranja'], ['roxo', 'Roxo']];
export const OVERLAY_FORCAS = [['sutil', 'Sutil'], ['normal', 'Normal (padrão)'], ['forte', 'Forte']];
const ESCOLHAS = { 'coach.junglerLonge': JUNGLER_LONGE, 'coach.overlayCor': OVERLAY_CORES, 'coach.overlayForca': OVERLAY_FORCAS };
// versão das migrações de valor (migrar): 2 = freioTilt 0 salvo antes de 13/10/2026 virou 2, uma vez só;
// 3 = aceite.silenciarSom false salvo antes da leva de 13/10/2026 virou true, uma vez só (roadmap/2026-10-13-chat-popups-som.md).
// A marca vive em duas casas: versao dentro da config e CHAVE_VERSAO à parte. A de fora sobrevive a um revert do
// plugin (a mescla antiga apaga chave que não está no PADRAO dela e a migração voltaria por cima de um 0 escolhido).
const VERSAO = 3;
const CHAVE_VERSAO = 'lol-client.versao';

export const PADRAO = {
  versao: VERSAO, // marca da migração; mora no PADRAO para a mescla não apagar
  esconderTft: true,
  colunaLarga: true,
  // trazerClient false = devolver o foco (minimiza o client que pulou na frente no ReadyCheck; volta no
  // ChampSelect); esconderPopup só vale com o aceite ligado (CSS em html.lc-aceite.lc-esconder-popup);
  // silenciarSom corta o loop que toca depois do aceite (roadmap/2026-10-13-voz-pregravada-e-foco.md, 2–2c); ligado
  // por padrão desde a decisão do Gabriel de 13/10/2026 (roadmap/2026-10-13-chat-popups-som.md)
  aceite: { ligado: true, atrasoS: 10, limiteS: 12, trazerClient: false, esconderPopup: false, silenciarSom: true },
  // jogarDeNovo: botão no pós-jogo; freioTilt: derrotas seguidas que pedem confirmação (0 = desligado);
  // freioMadrugada: pedir confirmação ao buscar entre 01:00 e 05:59. Os dois freios valem para a fila rápida e o
  // jogar de novo (freios.js; roadmap/2026-10-13-jogar-de-novo.md)
  filaRapida: { ligado: true, fila: 420, pos1: 'TOP', pos2: 'JUNGLE', jogarDeNovo: true, freioTilt: 2, freioMadrugada: true },
  // coleta sem escolha ao abrir o client e depois de cada partida (roadmap/2026-10-13-coleta-automatica-de-recompensas.md)
  recompensas: { ligado: true, tft: false },
  posjogo: { ligado: true },
  // chat da tela de estatísticas (chat-posjogo.js): nomes 'ambos' | 'campeao' | 'jogador'; quando o painel #lc-posjogo
  // está aberto o chat fica por baixo e só o texto muda (roadmap/2026-10-13-chat-popups-som.md)
  chatPosjogo: {
    ligado: true, nomes: 'ambos', iconeCampeao: true, corTime: true, abrirSozinho: true, manterAberto: true,
    esconderEntrouSaiu: true, escurecerSaiu: true,
  },
  // avisos calados por resposta falsa só nas rotas exatas (sem-popups.js); autofill fica de fora: rota sem consumidor
  semPopups: { ligado: true, runasAutomaticas: true, smiteAutomatico: true },
  extras: { esconderEvento: false, esconderClassic: false, esconderLoja: false },
  champSelect: { ligado: true },
  traumas: { ligado: true }, // linha "X é trauma" no selo e bloco na aba Tendência (só o plugin)
  // chaves do coach: vão inteiras para o coletor (POST 127.0.0.1:8765/config, coach.js); mesmos nomes e
  // padrões do servidor_local.CONFIG_PADRAO. Mentor: sonnet + medium = vencedor da comparação (plano v2, passo 20)
  coach: {
    painelAoVivo: true, amostrasAoVivo: true, voz: true, tomVoz: 'serio', minimapa: true, overlayMinimapa: true,
    alertasTela: true, feiticos: true, carregamento: true, mentor: true, mentorModelo: 'sonnet', mentorEffort: 'medium',
    // tipos calados por destino ("tela" = painel + moldura); "voltou" sem voz = padrão do coletor (servidor_local.py)
    avisosDesligados: { voz: ['adversario_voltou'], tela: [] },
    aceiteFlutuante: true, // janelinha aceitar/recusar fora do client (coletor); aceiteAtrasoS vai junto, derivado (coach.js)
    // regras de aviso da calibração de 14/10/2026 viram escolha (pedido do Gabriel, 14/10/2026; roadmap/2026-10-14-
    // calibrar-avisos.md passo 7). Padrão = o comportamento daquele dia. Chave nova sem valor antigo: entra pela mescla,
    // sem VERSAO nova (como o compacto); valor de texto fora de ESCOLHAS volta ao padrão no carregar()
    gankOutraRota: true, junglerLonge: 'painel', midSumiuFiltro: true, cortarFalaRepetida: true,
    overlayCor: 'vermelho', overlayForca: 'normal', overlaySuave: true,
  },
  // client compacto (pengu/compacto/, roadmap/2026-10-13-client-compacto.md): ligado = botão "modo compacto", atalho
  // Ctrl+Shift+M e roteador por fase; inicioCompacto = o padrão de cada fase é a tela compacta (pedido do Gabriel,
  // 13/10/2026); favoritos = championId fixos no topo da busca (58 Renekton, 154 Zac); larg/alt = janela em px CSS.
  // alt 680 desde 14/10/2026 (a tela 3 passava 26 px de 640 e mostrava barra de rolagem; carregar() leva o 640 salvo).
  // Classes: lc-compacto (ligado) e lc-inicio-compacto; a camada à vista é html.lc-modo-compacto (compacto/index.js)
  // passo 13 (aprovado em 14/10/2026 ~20:00): chatLateral = chat (💬) e amigos (👥) ao lado da coluna (e as janelas do coletor
  // deixam de abrir conversa sozinhas). Entra pela mescla, sem VERSAO nova. A chave conversaSozinha saiu em 16/10/2026 (nada do
  // chat abre sozinho, pedido do Gabriel; roadmap/2026-10-16-compacto-chat-amigos-perfil.md): o valor salvo some na mescla.
  // fundoPerfil (etapa 3 do mesmo plano, 16/10/2026): o fundo do perfil dele como fundo da coluna compacta (compacto/fundo.js).
  compacto: { ligado: true, inicioCompacto: true, favoritos: [58, 154], larg: 420, alt: 680, chatLateral: true, fundoPerfil: true },
  // regras de runa (runas.js); semente medida em 13/10/2026: ids estáveis, o nome é só para exibir
  runas: {
    ligado: true,
    regras: [
      { championId: 58, posicao: '*', paginas: [1409260191, 2147419287] }, // Renekton: ☝️🐊 e Nova Página de Runas 9
      { championId: 154, posicao: '*', paginas: [1540029809] }, // Zac: 🤢
    ],
  },
};

const kebab = s => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
const clonar = o => JSON.parse(JSON.stringify(o));

// mescla o salvo sobre o padrão (chave nova do padrão aparece; chave velha some)
function mesclar(padrao, salvo) {
  const out = {};
  for (const [k, v] of Object.entries(padrao)) {
    const s = salvo?.[k];
    // lista é dado do usuário: vale a salva inteira (até vazia); sem lista salva, a do padrão
    if (Array.isArray(v)) out[k] = clonar(Array.isArray(s) ? s : v);
    else out[k] = v && typeof v === 'object' ? mesclar(v, s) : (s === undefined || typeof s !== typeof v ? v : s);
  }
  return out;
}

// avisosDesligados até 13/10/2026 era uma lista só (calado na voz e na tela): vira {voz, tela}.
// versao < 2: freioTilt 0 era o padrão antigo, nunca escolhido pelo Gabriel -> 2 (decisão dele, 13/10/2026). A marca
// faz valer uma vez só: se ele desligar depois (0 com versao 2), fica 0. marca = CHAVE_VERSAO lida à parte.
// versao < 3: aceite.silenciarSom false era o padrão antigo, nunca escolhido -> true (decisão dele, 13/10/2026), mesma
// regra de uma vez só. Config v1 recebe as duas na mesma carga.
// -> salvo (alterado no lugar)
export function migrar(salvo, marca = 0) {
  if (!salvo || typeof salvo !== 'object') return salvo;
  const d = salvo.coach?.avisosDesligados;
  if (Array.isArray(d)) salvo.coach.avisosDesligados = { voz: [...d], tela: [...d] };
  const versao = Math.max(Number(salvo.versao) || 0, Number(marca) || 0);
  if (versao < 2 && salvo.filaRapida?.freioTilt === 0) salvo.filaRapida.freioTilt = 2;
  if (versao < 3 && salvo.aceite?.silenciarSom === false) salvo.aceite.silenciarSom = true;
  if (versao < VERSAO) salvo.versao = VERSAO;
  return salvo;
}

export const cfg = clonar(PADRAO);
const ouvintes = new Set();

export function carregar() {
  let salvo = null, marca = 0;
  try { salvo = DataStore.get(CHAVE); marca = Number(DataStore.get(CHAVE_VERSAO)) || 0; } catch { /* sem DataStore: fica o padrão */ }
  const temSalvo = !!salvo && typeof salvo === 'object';
  const antes = temSalvo ? Math.max(Number(salvo.versao) || 0, marca) : VERSAO;
  Object.assign(cfg, mesclar(PADRAO, migrar(salvo, marca)));
  // limiteS não é editável: dono é o PADRAO (ajuste depois de medir a janela chega a quem já salvou)
  cfg.aceite.limiteS = PADRAO.aceite.limiteS;
  // compacto.alt não tem campo nas Configurações: 640 salvo é o padrão antigo, nunca escolha (barra de rolagem na tela 3)
  if (cfg.compacto.alt === 640) cfg.compacto.alt = PADRAO.compacto.alt;
  // a mescla só confere o tipo: texto fora da lista (salvo à mão ou por versão futura) volta ao padrão
  for (const [caminho, opcoes] of Object.entries(ESCOLHAS)) {
    const [mod, chave] = caminho.split('.');
    if (!opcoes.some(([v]) => v === cfg[mod][chave])) cfg[mod][chave] = PADRAO[mod][chave];
  }
  // migrou agora: grava já com a marca (a migração não roda de novo nem se ele nunca mexer na configuração)
  if (antes < VERSAO) try { DataStore.set(CHAVE, clonar(cfg)); } catch { /* ignora */ }
  // marca de fora: só depois que uma config salva passou pela versão nova (instalação nova sem nada salvo não marca)
  if (temSalvo && marca < VERSAO) try { DataStore.set(CHAVE_VERSAO, VERSAO); } catch { /* ignora */ }
  aplicarClasses();
  return cfg;
}

export function salvar() {
  try { DataStore.set(CHAVE, clonar(cfg)); } catch { /* ignora */ }
  aplicarClasses();
  for (const fn of ouvintes) try { fn(cfg); } catch (e) { console.error('[lol-client]', e); }
}

export const aoMudar = fn => (ouvintes.add(fn), () => ouvintes.delete(fn));

// as regras de runa ficam: são dado do Gabriel, não preferência (plano v1, passo 7d)
export function restaurar() {
  const regras = cfg.runas?.regras;
  Object.assign(cfg, clonar(PADRAO));
  if (Array.isArray(regras)) cfg.runas.regras = clonar(regras);
  salvar();
}

// lista [classe, ligado] de todas as chaves booleanas
export function classes(c = cfg) {
  const out = [];
  for (const [k, v] of Object.entries(c)) {
    if (typeof v === 'boolean') out.push(['lc-' + kebab(k), v]);
    else if (v && typeof v === 'object') for (const [k2, v2] of Object.entries(v)) {
      if (typeof v2 !== 'boolean') continue;
      out.push([k2 === 'ligado' ? 'lc-' + kebab(k) : 'lc-' + kebab(k2), v2]);
    }
  }
  return out;
}

export function aplicarClasses() {
  const el = document.documentElement;
  for (const [nome, ligado] of classes()) el.classList.toggle(nome, ligado);
}

// caminho 'aceite.ligado' -> get/set
const obter = caminho => caminho.split('.').reduce((o, k) => o[k], cfg);
export function definir(caminho, valor) {
  const partes = caminho.split('.'), ultima = partes.pop();
  partes.reduce((o, k) => o[k], cfg)[ultima] = valor;
  salvar();
}

// valor fora da lista (salvo por versão antiga): vai ao próximo maior, não volta ao começo
const proximo = (lista, atual) => {
  const i = lista.indexOf(atual);
  return i >= 0 ? lista[(i + 1) % lista.length] : (lista.find(v => v > atual) ?? lista[0]);
};
// confirmação das ações do Ctrl+K: dentro da camada compacta quando ela está à vista (o Toast pode ficar embaixo dela),
// senão o Toast do Pengu (compacto/comum.js avisar; plano do compacto, passo 11 b3)
const avisar = msg => avisarComum(msg);

const ALTERNAVEIS = [
  ['esconderTft', 'esconder TFT'],
  ['colunaLarga', 'coluna larga das filas'],
  ['aceite.ligado', 'aceitar partida automático'],
  ['aceite.trazerClient', 'trazer o client para a frente ao achar partida'],
  ['aceite.esconderPopup', 'esconder o popup de partida encontrada'],
  ['aceite.silenciarSom', 'silenciar o som depois de aceitar'],
  ['coach.aceiteFlutuante', 'aceitar/recusar fora do client'],
  ['filaRapida.ligado', 'botão fila rápida'],
  ['filaRapida.jogarDeNovo', 'botão jogar de novo no pós-jogo'],
  ['filaRapida.freioMadrugada', 'pedir confirmação de madrugada (1h–6h)'],
  ['recompensas.ligado', 'coletar recompensas sozinho'],
  ['recompensas.tft', 'coletar o passe do TFT'],
  ['posjogo.ligado', 'painel pós-jogo'],
  ['chatPosjogo.ligado', 'chat do pós-jogo melhorado'],
  ['chatPosjogo.iconeCampeao', 'ícone do campeão no chat do pós-jogo'],
  ['chatPosjogo.corTime', 'cor certa de aliado e inimigo no chat do pós-jogo'],
  ['chatPosjogo.abrirSozinho', 'abrir o chat do pós-jogo sozinho'],
  ['chatPosjogo.manterAberto', 'manter o chat do pós-jogo aberto'],
  ['chatPosjogo.esconderEntrouSaiu', 'esconder "entrou/deixou o saguão" no chat'],
  ['chatPosjogo.escurecerSaiu', 'escurecer no placar quem saiu do chat'],
  ['semPopups.ligado', 'calar avisos automáticos do client'],
  ['semPopups.runasAutomaticas', 'calar o aviso de runas mudadas pelo jogo'],
  ['semPopups.smiteAutomatico', 'calar o aviso de golpear colocado sozinho'],
  ['champSelect.ligado', 'winrate no champ select'],
  ['runas.ligado', 'runa por campeão ao travar'],
  ['traumas.ligado', 'traumas no selo e no pós-jogo'],
  ['coach.painelAoVivo', 'painel ao vivo na 2ª tela'],
  ['coach.voz', 'voz do coach'],
  ['coach.alertasTela', 'moldura de alertas na tela'],
  ['coach.overlayMinimapa', 'overlay do jungler no minimapa'],
  ['coach.mentor', 'mentor no pós-jogo'],
  ['compacto.ligado', 'client compacto (botão e Ctrl+Shift+M)'],
  ['compacto.inicioCompacto', 'abrir cada fase no modo compacto'],
  ['compacto.chatLateral', 'chat ao lado do compacto'],
  ['compacto.fundoPerfil', 'fundo do perfil no compacto'],
  ['extras.esconderEvento', 'esconder aba de evento'],
  ['extras.esconderClassic', 'esconder aba CLASSIC'],
  ['extras.esconderLoja', 'esconder loja'],
];

export function registrarAcoes(extras = []) {
  if (typeof CommandBar === 'undefined') return;
  const grupo = 'lol-client';
  for (const [caminho, rotulo] of ALTERNAVEIS) CommandBar.addAction({
    name: `lol-client: ${rotulo} (liga/desliga)`, group: grupo, tags: ['lol-client', caminho],
    perform: () => { definir(caminho, !obter(caminho)); avisar(`${rotulo}: ${obter(caminho) ? 'ligado' : 'desligado'}`); },
  });
  // evitar: caminho cujo valor o ciclo pula (1ª e 2ª posição nunca iguais)
  const ciclo = (caminho, lista, rotulo, fmt = v => v, evitar) => CommandBar.addAction({
    name: `lol-client: ${rotulo} (próximo valor)`, group: grupo, tags: ['lol-client', caminho],
    perform: () => {
      let v = proximo(lista, obter(caminho));
      if (evitar && v === obter(evitar)) v = proximo(lista, v);
      definir(caminho, v); avisar(`${rotulo}: ${fmt(obter(caminho))}`);
    },
  });
  ciclo('aceite.atrasoS', ATRASOS, 'atraso do aceite', v => `${v} s`);
  ciclo('filaRapida.fila', FILAS, 'fila da fila rápida', v => (v === 420 ? 'solo/duo (420)' : 'flex (440)'));
  ciclo('filaRapida.pos1', POSICOES, '1ª posição da fila rápida', undefined, 'filaRapida.pos2');
  ciclo('filaRapida.pos2', POSICOES, '2ª posição da fila rápida', undefined, 'filaRapida.pos1');
  ciclo('chatPosjogo.nomes', NOMES_CHAT.map(([v]) => v), 'nomes no chat do pós-jogo', v => NOMES_CHAT.find(([x]) => x === v)?.[1] ?? v);
  ciclo('filaRapida.freioTilt', FREIOS, 'freio de tilt (fila rápida e jogar de novo)', v => (v ? `${v} derrotas seguidas` : 'desligado'));
  CommandBar.addAction({
    name: 'lol-client: restaurar configuração padrão', group: grupo, tags: ['lol-client'],
    perform: () => { restaurar(); avisar('configuração padrão restaurada'); },
  });
  for (const a of extras) CommandBar.addAction({ group: grupo, ...a });
}
