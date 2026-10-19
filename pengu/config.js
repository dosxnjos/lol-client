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
// 4 = coletor.ligado (ponte com o complemento coach) nasce false; config salva antes dela (a instalação do Gabriel) liga
// uma vez só (roadmap/2026-10-17-plugin-pengu-primeiro.md, Fase 1, decisão técnica 2).
// A marca vive em duas casas: versao dentro da config e CHAVE_VERSAO à parte. A de fora sobrevive a um revert do
// plugin (a mescla antiga apaga chave que não está no PADRAO dela e a migração voltaria por cima de um 0 escolhido).
export const VERSAO = 4;
const CHAVE_VERSAO = 'lol-client.versao';

export const PADRAO = {
  versao: VERSAO, // marca da migração; mora no PADRAO para a mescla não apagar
  esconderTft: true,
  colunaLarga: true,
  // trazerClient false = devolver o foco (minimiza o client que pulou na frente no ReadyCheck; volta no
  // ChampSelect). Padrão true desde 19/10/2026 (instalação nova não minimiza; decisão do Gabriel, Fase 3 de
  // roadmap/2026-10-17-plugin-pengu-primeiro.md): o false salvo antes fica pela mescla, sem VERSAO nova.
  // esconderPopup só vale com o aceite ligado (CSS em html.lc-aceite.lc-esconder-popup);
  // silenciarSom corta o loop que toca depois do aceite (roadmap/2026-10-13-voz-pregravada-e-foco.md, 2–2c); ligado
  // por padrão desde a decisão do Gabriel de 13/10/2026 (roadmap/2026-10-13-chat-popups-som.md)
  aceite: { ligado: true, atrasoS: 10, limiteS: 12, trazerClient: true, esconderPopup: false, silenciarSom: true },
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
  // ponte com o complemento coach (coach.js): false = nenhuma chamada à 127.0.0.1:8765. Instalação nova nasce sem ela; a config
  // salva antes da VERSAO 4 liga uma vez (migrar). É instalação, não preferência: restaurar() mantém o valor
  coletor: { ligado: false },
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
  // 13/10/2026); favoritos = championId fixos no topo da busca, vazio no padrão (dado de quem usa, só no DataStore;
  // a semente do mantenedor está no README § Instalar; Fase 3 de roadmap/2026-10-17-plugin-pengu-primeiro.md); larg/alt = janela em px CSS.
  // alt 680 desde 14/10/2026 (a tela 3 passava 26 px de 640 e mostrava barra de rolagem; carregar() leva o 640 salvo).
  // Classes: lc-compacto (ligado) e lc-inicio-compacto; a camada à vista é html.lc-modo-compacto (compacto/index.js)
  // passo 13 (aprovado em 14/10/2026 ~20:00): chat (💬) e amigos (👥) ao lado da coluna. A chave que escolhia entre o chat ao
  // lado e as janelas do chat do coletor saiu em 19/10/2026 com as janelas (Fase 2 de roadmap/2026-10-17-plugin-pengu-primeiro.md):
  // o chat é sempre ao lado e o valor salvo some na mescla. A chave conversaSozinha saiu em 16/10/2026 (nada do
  // chat abre sozinho, pedido do Gabriel; roadmap/2026-10-16-compacto-chat-amigos-perfil.md): o valor salvo some na mescla.
  // fundoPerfil (etapa 3 do mesmo plano, 16/10/2026): o fundo do perfil dele como fundo da coluna compacta (compacto/fundo.js).
  // chatSalaCresce (etapa A de roadmap/2026-10-16-chat-da-sala-som-icones.md): a faixa da sala do time (seleção, honra, pós-jogo)
  // cresce sozinha com mensagem de outro jogador (compacto/chat-sala.js). Entra pela mescla, sem VERSAO nova.
  compacto: { ligado: true, inicioCompacto: true, favoritos: [], larg: 420, alt: 680, fundoPerfil: true, chatSalaCresce: true },
  // regras de runa (runas.js): {championId, posicao ('*' ou TOP…UTILITY), paginas: [ids de /lol-perks/v1/pages]}. Vazio
  // no padrão: os ids de página são por conta (sem regra, nada acontece). A semente do mantenedor está no README § Instalar
  runas: { ligado: true, regras: [] },
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
// versao < 4: quem já tinha config salva usava a ponte com o coletor (sempre ligada até 19/10/2026) -> coletor.ligado true,
// uma vez só; desligar depois fica desligado. Instalação nova (nada salvo) não passa por aqui: fica o false do PADRAO.
// Também liga quando a config salva não tem coletor.ligado booleano, em qualquer versão (revisão adversarial de 19/10): o
// plugin de antes da v4 (revert de 8a54ae8/d53f20e) apaga a chave na mescla (não está no PADRAO dele) mas mantém versao 4,
// e a ponte do Gabriel voltaria desligada calada. Toda config gravada pela v4 tem a chave (a mescla põe), então o false
// escolhido nunca é tocado; instalação nova (salvo nulo) sai antes.
// -> salvo (alterado no lugar)
export const semPonteSalva = salvo => !!salvo && typeof salvo === 'object' && typeof salvo.coletor?.ligado !== 'boolean';
export function migrar(salvo, marca = 0) {
  if (!salvo || typeof salvo !== 'object') return salvo;
  const d = salvo.coach?.avisosDesligados;
  if (Array.isArray(d)) salvo.coach.avisosDesligados = { voz: [...d], tela: [...d] };
  const versao = Math.max(Number(salvo.versao) || 0, Number(marca) || 0);
  if (versao < 2 && salvo.filaRapida?.freioTilt === 0) salvo.filaRapida.freioTilt = 2;
  if (versao < 3 && salvo.aceite?.silenciarSom === false) salvo.aceite.silenciarSom = true;
  if (versao < 4 || semPonteSalva(salvo)) salvo.coletor = { ...(salvo.coletor && typeof salvo.coletor === 'object' ? salvo.coletor : {}), ligado: true };
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
  const reparou = semPonteSalva(salvo);   // v4 sem a chave da ponte (revert do plugin): grava o reparo já
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
  if (antes < VERSAO || reparou) try { DataStore.set(CHAVE, clonar(cfg)); } catch { /* ignora */ }
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

// as regras de runa ficam: são dado de quem usa, não preferência (plano v1, passo 7d). Os favoritos do compacto também
// (desde 19/10/2026 o padrão é vazio e não há tela para refazer a lista). A ponte com o complemento coach
// (coletor.ligado) também: é instalação; sem isto o "restaurar padrão" desligaria a ponte calado
export function restaurar() {
  const regras = cfg.runas?.regras, favoritos = cfg.compacto?.favoritos, ponte = cfg.coletor?.ligado;
  Object.assign(cfg, clonar(PADRAO));
  if (Array.isArray(regras)) cfg.runas.regras = clonar(regras);
  if (Array.isArray(favoritos)) cfg.compacto.favoritos = clonar(favoritos);
  if (typeof ponte === 'boolean') cfg.coletor.ligado = ponte;
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
  ['coletor.ligado', 'falar com o complemento coach'],
  ['compacto.ligado', 'client compacto (botão e Ctrl+Shift+M)'],
  ['compacto.inicioCompacto', 'abrir cada fase no modo compacto'],
  ['compacto.fundoPerfil', 'fundo do perfil no compacto'],
  ['compacto.chatSalaCresce', 'abrir a faixa da sala do time com mensagem nova'],
  ['extras.esconderEvento', 'esconder aba de evento'],
  ['extras.esconderClassic', 'esconder aba CLASSIC'],
  ['extras.esconderLoja', 'esconder loja'],
];
// atalhos do Ctrl+K que só existem com o recurso do complemento coach (aperto de mão, coach.js): [caminho, rótulo, recursos]
// (qualquer um dos recursos basta). O CommandBar não tira ação registrada: entram uma vez, quando o recurso aparece
export const ALTERNAVEIS_COACH = [
  ['coach.aceiteFlutuante', 'aceitar/recusar fora do client', ['aceite-flutuante']],
  ['traumas.ligado', 'traumas no selo e no pós-jogo', ['draft', 'contexto']],
  ['coach.painelAoVivo', 'painel ao vivo na 2ª tela', ['painel']],
  ['coach.voz', 'voz do coach', ['voz']],
  ['coach.alertasTela', 'moldura de alertas na tela', ['alertas']],
  ['coach.overlayMinimapa', 'overlay do jungler no minimapa', ['minimapa']],
  ['coach.mentor', 'mentor no pós-jogo', ['mentor']],
];
const acoesCoach = new Set();
// mostra(recurso) -> bool (coach.js mostraRecurso: anunciado agora ou lembrado do último aperto de mão bom)
export function registrarAcoesCoach(mostra) {
  if (typeof CommandBar === 'undefined' || typeof mostra !== 'function') return 0;
  let n = 0;
  for (const [caminho, rotulo, recursos] of ALTERNAVEIS_COACH) {
    if (acoesCoach.has(caminho) || !recursos.some(r => mostra(r))) continue;
    acoesCoach.add(caminho);
    n++;
    CommandBar.addAction({
      name: `lol-client: ${rotulo} (liga/desliga)`, group: 'lol-client', tags: ['lol-client', caminho],
      perform: () => { definir(caminho, !obter(caminho)); avisar(`${rotulo}: ${obter(caminho) ? 'ligado' : 'desligado'}`); },
    });
  }
  return n;
}

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
