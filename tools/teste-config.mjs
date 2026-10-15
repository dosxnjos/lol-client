// Testa a carga da configuração do plugin (pengu/config.js): migração de avisosDesligados (lista até
// 13/10/2026 -> {voz, tela}) e a mescla com o padrão. uso: node tools/teste-config.mjs
import { carregar, cfg, migrar, PADRAO, classes, definir } from '../pengu/config.js';
import { corpoConfig } from '../pengu/coach.js';

globalThis.document = { documentElement: { classList: { toggle() {} } } };
// DataStore falso que guarda de verdade (ida e volta: carregar -> definir -> salvar -> carregar)
// duas chaves: a config (salvo; gravacoes conta só ela) e a marca de migração à parte (marca)
let salvo = null, gravacoes = 0, marca = null;
const CHAVE = 'lol-client.config';
globalThis.DataStore = {
  get: k => (k === CHAVE ? (salvo === null ? null : JSON.parse(JSON.stringify(salvo))) : marca),
  set: (k, v) => { if (k === CHAVE) { gravacoes++; salvo = JSON.parse(JSON.stringify(v)); } else marca = v; },
};
// cada carga parte sem a marca de fora, salvo quando o caso passa uma
const carregarCom = (s, m = null) => { salvo = s; marca = m; return JSON.parse(JSON.stringify(carregar())); };
const recarregar = () => JSON.parse(JSON.stringify(carregar()));
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const casos = [
  ['sem nada salvo: padrão {voz:[], tela:[]}', carregarCom(null), c => igual(c.coach.avisosDesligados, { voz: [], tela: [] })],
  ['lista antiga migra para os dois', carregarCom({ coach: { avisosDesligados: ['gank', 'mid_sumiu'] } }),
    c => igual(c.coach.avisosDesligados, { voz: ['gank', 'mid_sumiu'], tela: ['gank', 'mid_sumiu'] })],
  ['formato novo fica como está', carregarCom({ coach: { avisosDesligados: { voz: ['gank'], tela: [] }, voz: false } }),
    c => igual(c.coach.avisosDesligados, { voz: ['gank'], tela: [] }) && c.coach.voz === false],
  ['lista vazia antiga vira {[], []}', carregarCom({ coach: { avisosDesligados: [] } }),
    c => igual(c.coach.avisosDesligados, { voz: [], tela: [] })],
  ['padrão não é alterado pela carga', null, () => igual(PADRAO.coach.avisosDesligados, { voz: [], tela: [] })
    && cfg.coach.avisosDesligados !== PADRAO.coach.avisosDesligados],
  ['migrar(null) não quebra', migrar(null), r => r === null],
  // chaves novas de 13/10/2026 (contrato plugin <-> coach): config salva antes delas ganha os padrões
  ['config antiga ganha as chaves novas com os padrões', carregarCom({ aceite: { ligado: true, atrasoS: 7 }, filaRapida: { fila: 440 }, coach: { voz: false } }),
    c => c.aceite.atrasoS === 7 && c.aceite.trazerClient === false && c.aceite.esconderPopup === false && c.aceite.silenciarSom === true
      && c.filaRapida.fila === 440 && c.filaRapida.jogarDeNovo === true && c.filaRapida.freioTilt === 2 && c.filaRapida.freioMadrugada === true
      && c.recompensas.ligado === true && c.recompensas.tft === false && c.coach.aceiteFlutuante === true && c.coach.voz === false],
  ['valores salvos das chaves novas ficam', carregarCom({ aceite: { trazerClient: true, esconderPopup: true, silenciarSom: true },
    filaRapida: { jogarDeNovo: false, freioTilt: 3 }, recompensas: { ligado: false, tft: true }, coach: { aceiteFlutuante: false } }),
    c => c.aceite.trazerClient && c.aceite.esconderPopup && c.aceite.silenciarSom && !c.filaRapida.jogarDeNovo
      && c.filaRapida.freioTilt === 3 && !c.recompensas.ligado && c.recompensas.tft && c.coach.aceiteFlutuante === false],
  ['tipo errado salvo volta ao padrão (freioTilt "3" -> 2)', carregarCom({ filaRapida: { freioTilt: '3' } }), c => c.filaRapida.freioTilt === 2],
  // freios (decisão do Gabriel, 13/10/2026): padrão tilt 2 + madrugada; 0 salvo antes da marca vira 2 uma vez só
  ['padrão: freioTilt 2, freioMadrugada ligado, versao 3', carregarCom(null),
    c => c.filaRapida.freioTilt === 2 && c.filaRapida.freioMadrugada === true && c.versao === 3],
  ['migração: 0 salvo sem a marca vira 2 e grava com a marca', (() => { gravacoes = 0; const c = carregarCom({ filaRapida: { freioTilt: 0, fila: 440 } }); return { c, salvo, gravacoes }; })(),
    ({ c, salvo: s, gravacoes: g }) => c.filaRapida.freioTilt === 2 && c.filaRapida.fila === 440 && g === 1 && s.versao === 3 && s.filaRapida.freioTilt === 2],
  ['migração uma vez só: recarregar não grava de novo', (() => { gravacoes = 0; const c = recarregar(); return { c, gravacoes }; })(),
    ({ c, gravacoes: g }) => c.filaRapida.freioTilt === 2 && g === 0],
  ['respeita desligar depois: definir 0 -> salvar -> recarregar = 0', (() => { definir('filaRapida.freioTilt', 0); return recarregar(); })(),
    c => c.filaRapida.freioTilt === 0 && c.versao === 3],
  ['com a marca, 0 salvo fica 0', carregarCom({ versao: 2, filaRapida: { freioTilt: 0 } }), c => c.filaRapida.freioTilt === 0],
  ['sem a marca, limiar escolhido (3) fica 3', carregarCom({ filaRapida: { freioTilt: 3 } }), c => c.filaRapida.freioTilt === 3 && c.versao === 3],
  ['migração grava a marca de fora (lol-client.versao = 3)', (carregarCom({ filaRapida: { freioTilt: 0 } }), marca), m => m === 3],
  // revert do plugin: o código antigo apaga a versao de dentro da config; a marca de fora segura o 0 escolhido
  ['revert: 0 salvo sem versao mas com a marca de fora (3) fica 0 e nada grava', (() => { gravacoes = 0; const c = carregarCom({ filaRapida: { freioTilt: 0 } }, 3); return { c, gravacoes }; })(),
    ({ c, gravacoes: g }) => c.filaRapida.freioTilt === 0 && g === 0],
  ['revert da v2: marca de fora 2 segura o 0 do freio; a migração do som ainda roda', (() => { gravacoes = 0; const c = carregarCom({ filaRapida: { freioTilt: 0 }, aceite: { silenciarSom: false } }, 2); return { c, gravacoes, m: marca }; })(),
    ({ c, gravacoes: g, m }) => c.filaRapida.freioTilt === 0 && c.aceite.silenciarSom === true && g === 1 && m === 3],
  ['instalação nova sem nada salvo não grava a marca de fora', (carregarCom(null), marca), m => m === null],
  ['config já na versão nova sem a marca de fora: grava a marca, não a config', (() => { gravacoes = 0; const c = carregarCom({ versao: 3, filaRapida: { freioTilt: 0 } }); return { c, gravacoes, m: marca }; })(),
    ({ c, gravacoes: g, m }) => c.filaRapida.freioTilt === 0 && g === 0 && m === 3],
  ['madrugada desligada salva fica desligada', carregarCom({ versao: 2, filaRapida: { freioMadrugada: false } }), c => c.filaRapida.freioMadrugada === false],
  // som do aceite (decisão do Gabriel, 13/10/2026): padrão ligado; false salvo antes da marca 3 vira true uma vez só
  ['som: padrão silenciarSom ligado', carregarCom(null), c => c.aceite.silenciarSom === true && PADRAO.aceite.silenciarSom === true],
  ['som: false salvo (v2) sem a marca 3 vira true e grava uma vez, com a marca', (() => { gravacoes = 0; const c = carregarCom({ versao: 2, aceite: { silenciarSom: false, atrasoS: 7 } }, 2); return { c, salvo, gravacoes, m: marca }; })(),
    ({ c, salvo: s, gravacoes: g, m }) => c.aceite.silenciarSom === true && c.aceite.atrasoS === 7 && g === 1 && s.versao === 3 && s.aceite.silenciarSom === true && m === 3],
  ['som: recarregar depois da migração não grava de novo', (() => { gravacoes = 0; const c = recarregar(); return { c, gravacoes }; })(),
    ({ c, gravacoes: g }) => c.aceite.silenciarSom === true && g === 0],
  ['som: respeita desligar depois (definir false -> recarregar = false)', (() => { definir('aceite.silenciarSom', false); return recarregar(); })(),
    c => c.aceite.silenciarSom === false && c.versao === 3],
  ['som: com a marca 3 dentro, false fica false', carregarCom({ versao: 3, aceite: { silenciarSom: false } }), c => c.aceite.silenciarSom === false],
  ['som: revert (sem versao dentro, marca de fora 3) não migra nem grava', (() => { gravacoes = 0; const c = carregarCom({ aceite: { silenciarSom: false } }, 3); return { c, gravacoes }; })(),
    ({ c, gravacoes: g }) => c.aceite.silenciarSom === false && g === 0],
  ['config v1 recebe as duas migrações na mesma carga', (() => { gravacoes = 0; const c = carregarCom({ filaRapida: { freioTilt: 0 }, aceite: { silenciarSom: false } }); return { c, gravacoes }; })(),
    ({ c, gravacoes: g }) => c.filaRapida.freioTilt === 2 && c.aceite.silenciarSom === true && g === 1],
  ['migrar puro: v2 com som false -> true, freio 0 fica', migrar({ versao: 2, filaRapida: { freioTilt: 0 }, aceite: { silenciarSom: false } }),
    s => s.aceite.silenciarSom === true && s.filaRapida.freioTilt === 0 && s.versao === 3],
  // chaves novas da leva de 13/10/2026 (chat do pós-jogo e avisos): padrão ligado, classes sem colisão
  ['chat e avisos: padrões ligados e nomes "ambos"', carregarCom(null),
    c => c.chatPosjogo.ligado && c.chatPosjogo.nomes === 'ambos' && c.chatPosjogo.iconeCampeao && c.chatPosjogo.corTime
      && c.chatPosjogo.abrirSozinho && c.chatPosjogo.manterAberto && c.chatPosjogo.esconderEntrouSaiu && c.chatPosjogo.escurecerSaiu
      && c.semPopups.ligado && c.semPopups.runasAutomaticas && c.semPopups.smiteAutomatico],
  ['classes sem colisão (lc-runas é só das runas por campeão)', (carregarCom({ runas: { ligado: false } }), classes()),
    l => l.filter(([k]) => k === 'lc-runas').length === 1 && l.find(([k]) => k === 'lc-runas')[1] === false
      && new Set(l.map(([k]) => k)).size === l.length
      && ['lc-chat-posjogo', 'lc-escurecer-saiu', 'lc-sem-popups', 'lc-runas-automaticas', 'lc-smite-automatico'].every(n => l.some(([k]) => k === n))],
  ['migrar(null) e migrar(lixo) não quebram', [migrar(null), migrar('x')], ([a, b]) => a === null && b === 'x'],
  ['aceiteAtrasoS não fica salvo no cfg (é derivado)', carregarCom({ coach: { aceiteAtrasoS: 9 } }), c => !('aceiteAtrasoS' in c.coach)],
  ['classes: lc-esconder-popup, lc-trazer-client, lc-silenciar-som, lc-recompensas', (carregarCom({ aceite: { esconderPopup: true } }), classes()),
    l => ['lc-esconder-popup', 'lc-trazer-client', 'lc-silenciar-som', 'lc-recompensas', 'lc-aceite'].every(n => l.some(([k]) => k === n))
      && l.find(([k]) => k === 'lc-esconder-popup')[1] === true],
  // POST /config do coletor: chaves do coach + aceiteAtrasoS espelhado do aceite
  ['POST /config leva aceiteFlutuante e aceiteAtrasoS = atraso do aceite', corpoConfig({ aceite: { ligado: true, atrasoS: 8, limiteS: 12 }, coach: { voz: true, aceiteFlutuante: true } }),
    b => b.coach.aceiteFlutuante === true && b.coach.aceiteAtrasoS === 8 && b.coach.voz === true],
  ['aceiteAtrasoS respeita o limite (limiteS − 2)', corpoConfig({ aceite: { ligado: true, atrasoS: 15, limiteS: 12 }, coach: {} }), b => b.coach.aceiteAtrasoS === 10],
  ['aceite automático desligado: aceiteAtrasoS null', corpoConfig({ aceite: { ligado: false, atrasoS: 8, limiteS: 12 }, coach: { aceiteFlutuante: true } }),
    b => b.coach.aceiteAtrasoS === null && b.coach.aceiteFlutuante === true],
  ['corpoConfig não altera o cfg.coach', (() => { const c = { aceite: { ligado: true, atrasoS: 8 }, coach: {} }; corpoConfig(c); return c; })(),
    c => !('aceiteAtrasoS' in c.coach)],
  // regras de aviso de 14/10/2026 viram escolha (roadmap/2026-10-14-calibrar-avisos.md, passo 7): padrão = comportamento do dia
  ['avisos 14/10: padrão = calibração (gank outra rota, jungler longe no painel, filtro do mid, corte da frase, mancha vermelha normal suave)', carregarCom(null),
    c => c.coach.gankOutraRota === true && c.coach.junglerLonge === 'painel' && c.coach.midSumiuFiltro === true
      && c.coach.cortarFalaRepetida === true && c.coach.overlayCor === 'vermelho' && c.coach.overlayForca === 'normal'
      && c.coach.overlaySuave === true && c.versao === 3],
  ['avisos 14/10: config salva antes das chaves ganha os padrões sem regravar (sem VERSAO nova)', (() => { gravacoes = 0; const c = carregarCom({ versao: 3, coach: { voz: false } }, 3); return { c, gravacoes }; })(),
    ({ c, gravacoes: g }) => c.coach.voz === false && c.coach.gankOutraRota === true && c.coach.junglerLonge === 'painel' && g === 0],
  ['avisos 14/10: escolhas salvas ficam', carregarCom({ coach: { gankOutraRota: false, junglerLonge: 'nada', midSumiuFiltro: false,
    cortarFalaRepetida: false, overlayCor: 'roxo', overlayForca: 'sutil', overlaySuave: false } }),
    c => !c.coach.gankOutraRota && c.coach.junglerLonge === 'nada' && !c.coach.midSumiuFiltro && !c.coach.cortarFalaRepetida
      && c.coach.overlayCor === 'roxo' && c.coach.overlayForca === 'sutil' && !c.coach.overlaySuave],
  ['avisos 14/10: valor inválido volta ao padrão (texto fora da lista e tipo errado)', carregarCom({ coach: { junglerLonge: 'sempre',
    overlayCor: 'azul', overlayForca: 7, gankOutraRota: 'nao', midSumiuFiltro: 0 } }),
    c => c.coach.junglerLonge === 'painel' && c.coach.overlayCor === 'vermelho' && c.coach.overlayForca === 'normal'
      && c.coach.gankOutraRota === true && c.coach.midSumiuFiltro === true],
  ['avisos 14/10: definir -> salvar -> recarregar mantém a escolha', (() => { carregarCom(null); definir('coach.overlayCor', 'laranja'); definir('coach.junglerLonge', 'tudo'); return recarregar(); })(),
    c => c.coach.overlayCor === 'laranja' && c.coach.junglerLonge === 'tudo'],
  ['avisos 14/10: POST /config leva as chaves novas ao coletor', corpoConfig({ aceite: { ligado: false }, coach: { ...PADRAO.coach, junglerLonge: 'nada', overlaySuave: false } }),
    b => b.coach.junglerLonge === 'nada' && b.coach.overlaySuave === false && b.coach.gankOutraRota === true && b.coach.overlayForca === 'normal'],
  ['avisos 14/10: classes das caixas novas sem colisão', (carregarCom(null), classes()),
    l => new Set(l.map(([k]) => k)).size === l.length
      && ['lc-gank-outra-rota', 'lc-mid-sumiu-filtro', 'lc-cortar-fala-repetida', 'lc-overlay-suave'].every(n => l.some(([k]) => k === n))],
];

// Configurações › LOL-CLIENT: os blocos Voz, Alertas e Minimapa montam um controle para cada chave nova (DOM mínimo)
const elFalso = tag => ({ tag, filhos: [], className: '', textContent: '', append(...f) { this.filhos.push(...f); }, replaceChildren(...f) { this.filhos = f; } });
document.createElement = elFalso;
const blocos = await import('../pengu/blocos.js');
const montarBloco = (fn, c) => {
  const ids = [], textos = [], listas = {};
  const ui = {
    caixa: (id, rotulo, explicacao, valor) => { ids.push(id); textos.push(rotulo, explicacao); return elFalso('caixa'); },
    lista: (id, rotulo, opcoes) => { ids.push(id); listas[id] = opcoes.map(([v]) => v); textos.push(rotulo); return elFalso('lista'); },
    linha: (...f) => { const e = elFalso('linha'); e.append(...f); return e; },
    explica: t => { textos.push(t); return elFalso('p'); },
  };
  fn(elFalso('div'), { cfg: c, definir: () => {}, ui });
  return { ids, texto: textos.join(' '), listas };
};
const cfgPadrao = JSON.parse(JSON.stringify(PADRAO));
const voz = montarBloco(blocos.blocoVoz, cfgPadrao), alertas = montarBloco(blocos.blocoAlertas, cfgPadrao), mini = montarBloco(blocos.blocoMinimapa, cfgPadrao);
casos.push(
  ['tela: Voz tem a caixa do corte da frase e fala da Aoede (Maria só de reserva)', voz,
    v => v.ids.includes('coach.cortarFalaRepetida') && /Aoede/.test(v.texto) && !/\(voz Maria do Windows\)/.test(v.texto) && /Maria/.test(v.texto)],
  ['tela: Alertas tem gank em outra rota, jungler longe (3 opções) e filtro do mid', alertas,
    a => ['coach.gankOutraRota', 'coach.junglerLonge', 'coach.midSumiuFiltro'].every(i => a.ids.includes(i))
      && JSON.stringify(a.listas['coach.junglerLonge']) === JSON.stringify(['painel', 'tudo', 'nada'])],
  ['tela: Minimapa tem cor (3), força (3) e transição da mancha', mini,
    m => ['coach.overlayCor', 'coach.overlayForca', 'coach.overlaySuave'].every(i => m.ids.includes(i))
      && m.listas['coach.overlayCor'].length === 3 && JSON.stringify(m.listas['coach.overlayForca']) === JSON.stringify(['sutil', 'normal', 'forte'])],
  ['tela: toda chave nova do PADRAO.coach tem controle', [voz, alertas, mini],
    bs => ['gankOutraRota', 'junglerLonge', 'midSumiuFiltro', 'cortarFalaRepetida', 'overlayCor', 'overlayForca', 'overlaySuave']
      .every(k => k in PADRAO.coach && bs.some(b => b.ids.includes('coach.' + k)))],
);

// paridade com o expandido (plano do compacto, passo 11 b3): a confirmação das ações do Ctrl+K sai dentro da camada
// compacta quando ela está à vista (compacto/comum.js avisar), senão no Toast como antes
{
  const { registrarAcoes } = await import('../pengu/config.js');
  const acoes = [];
  globalThis.CommandBar = { addAction: a => acoes.push(a) };
  registrarAcoes([]);
  const acao = acoes.find(a => a.tags?.includes('esconderTft'));
  const novoEl = () => { const e = { filhos: [], dataset: {}, style: {}, className: '', id: '', _t: '', pai: null,
    append(...ns) { for (const n of ns) { if (n && typeof n === 'object') n.pai = e; e.filhos.push(n); } }, appendChild(n) { e.append(n); return n; },
    remove() { if (e.pai) e.pai.filhos.splice(e.pai.filhos.indexOf(e), 1); e.pai = null; }, addEventListener() {}, setAttribute() {},
    querySelector: sel => e.filhos.find(f => typeof f === 'object' && String(f.className).split(' ').includes(sel.slice(1))) || null,
    get textContent() { return e._t + e.filhos.map(f => (typeof f === 'object' ? f.textContent : String(f))).join(''); }, set textContent(v) { e._t = String(v); e.filhos = []; } };
    return e; };
  const toasts = [];
  globalThis.Toast = { success: t => toasts.push(t), error: t => toasts.push('[erro] ' + t) };
  const camada = novoEl(); camada.id = 'lc-compacto';
  const docAntes = globalThis.document;
  globalThis.document = { ...docAntes, createElement: () => novoEl(), getElementById: id => (id === 'lc-compacto' ? camada : null) };
  acao?.perform();
  const naCamada = camada.filhos.map(f => f.textContent), toastsCamada = toasts.length;
  globalThis.document = { ...docAntes, createElement: () => novoEl(), getElementById: () => null };
  acao?.perform();
  globalThis.document = docAntes;
  casos.push(['b3: Ctrl+K liga/desliga com a camada à vista: confirmação dentro do #lc-compacto; sem ela, no Toast',
    { naCamada, toastsCamada, toasts }, v => v.naCamada.length === 1 && /esconder TFT: (ligado|desligado)/i.test(v.naCamada[0]) && v.toastsCamada === 0
      && v.toasts.length === 1 && /esconder TFT/i.test(v.toasts[0])]);
}

let ok = 0;
for (const [nome, valor, conferir] of casos) {
  const passou = !!conferir(valor);
  ok += passou;
  console.log(`${passou ? 'ok ' : 'FALHOU'} ${nome}${passou ? '' : ' -> ' + JSON.stringify(valor?.coach?.avisosDesligados ?? valor)}`);
}
console.log(`${ok}/${casos.length} ok`);
process.exit(ok === casos.length ? 0 : 1);
