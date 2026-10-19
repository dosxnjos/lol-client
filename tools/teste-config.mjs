// Testa a carga da configuração do plugin (pengu/config.js): migração de avisosDesligados (lista até
// 13/10/2026 -> {voz, tela}), a mescla com o padrão e a VERSAO 4 (ponte com o complemento coach: instalação nova false,
// config salva antes dela true uma vez, restaurar mantém). uso: node tools/teste-config.mjs
import { readFileSync } from 'node:fs';
import { carregar, cfg, migrar, PADRAO, classes, definir, restaurar } from '../pengu/config.js';
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
  ['sem nada salvo: padrão {voz:[voltou], tela:[]}', carregarCom(null), c => igual(c.coach.avisosDesligados, { voz: ['adversario_voltou'], tela: [] })],
  ['lista antiga migra para os dois', carregarCom({ coach: { avisosDesligados: ['gank', 'mid_sumiu'] } }),
    c => igual(c.coach.avisosDesligados, { voz: ['gank', 'mid_sumiu'], tela: ['gank', 'mid_sumiu'] })],
  ['formato novo fica como está', carregarCom({ coach: { avisosDesligados: { voz: ['gank'], tela: [] }, voz: false } }),
    c => igual(c.coach.avisosDesligados, { voz: ['gank'], tela: [] }) && c.coach.voz === false],
  ['lista vazia antiga vira {[], []}', carregarCom({ coach: { avisosDesligados: [] } }),
    c => igual(c.coach.avisosDesligados, { voz: [], tela: [] })],
  ['padrão não é alterado pela carga', null, () => igual(PADRAO.coach.avisosDesligados, { voz: ['adversario_voltou'], tela: [] })
    && cfg.coach.avisosDesligados !== PADRAO.coach.avisosDesligados],
  ['migrar(null) não quebra', migrar(null), r => r === null],
  // chaves novas de 13/10/2026 (contrato plugin <-> coach): config salva antes delas ganha os padrões
  // trazerClient: padrão true desde 19/10/2026 (Fase 3); config salva sem a chave ganha o padrão novo
  ['config antiga ganha as chaves novas com os padrões (trazerClient true)', carregarCom({ aceite: { ligado: true, atrasoS: 7 }, filaRapida: { fila: 440 }, coach: { voz: false } }),
    c => c.aceite.atrasoS === 7 && c.aceite.trazerClient === true && c.aceite.esconderPopup === false && c.aceite.silenciarSom === true
      && c.filaRapida.fila === 440 && c.filaRapida.jogarDeNovo === true && c.filaRapida.freioTilt === 2 && c.filaRapida.freioMadrugada === true
      && c.recompensas.ligado === true && c.recompensas.tft === false && c.coach.aceiteFlutuante === true && c.coach.voz === false],
  ['valores salvos das chaves novas ficam', carregarCom({ aceite: { trazerClient: false, esconderPopup: true, silenciarSom: true },
    filaRapida: { jogarDeNovo: false, freioTilt: 3 }, recompensas: { ligado: false, tft: true }, coach: { aceiteFlutuante: false } }),
    c => c.aceite.trazerClient === false && c.aceite.esconderPopup && c.aceite.silenciarSom && !c.filaRapida.jogarDeNovo
      && c.filaRapida.freioTilt === 3 && !c.recompensas.ligado && c.recompensas.tft && c.coach.aceiteFlutuante === false],
  ['tipo errado salvo volta ao padrão (freioTilt "3" -> 2)', carregarCom({ filaRapida: { freioTilt: '3' } }), c => c.filaRapida.freioTilt === 2],
  // freios (decisão do Gabriel, 13/10/2026): padrão tilt 2 + madrugada; 0 salvo antes da marca vira 2 uma vez só
  ['padrão: freioTilt 2, freioMadrugada ligado, versao 4', carregarCom(null),
    c => c.filaRapida.freioTilt === 2 && c.filaRapida.freioMadrugada === true && c.versao === 4],
  ['migração: 0 salvo sem a marca vira 2 e grava com a marca', (() => { gravacoes = 0; const c = carregarCom({ filaRapida: { freioTilt: 0, fila: 440 } }); return { c, salvo, gravacoes }; })(),
    ({ c, salvo: s, gravacoes: g }) => c.filaRapida.freioTilt === 2 && c.filaRapida.fila === 440 && g === 1 && s.versao === 4 && s.filaRapida.freioTilt === 2],
  ['migração uma vez só: recarregar não grava de novo', (() => { gravacoes = 0; const c = recarregar(); return { c, gravacoes }; })(),
    ({ c, gravacoes: g }) => c.filaRapida.freioTilt === 2 && g === 0],
  ['respeita desligar depois: definir 0 -> salvar -> recarregar = 0', (() => { definir('filaRapida.freioTilt', 0); return recarregar(); })(),
    c => c.filaRapida.freioTilt === 0 && c.versao === 4],
  ['com a marca, 0 salvo fica 0', carregarCom({ versao: 2, filaRapida: { freioTilt: 0 } }), c => c.filaRapida.freioTilt === 0],
  ['sem a marca, limiar escolhido (3) fica 3', carregarCom({ filaRapida: { freioTilt: 3 } }), c => c.filaRapida.freioTilt === 3 && c.versao === 4],
  ['migração grava a marca de fora (lol-client.versao = 4)', (carregarCom({ filaRapida: { freioTilt: 0 } }), marca), m => m === 4],
  // revert do plugin: o código antigo apaga a versao de dentro da config; a marca de fora segura o 0 escolhido. Marca 3 (antes
  // da v4): só a migração da ponte roda e grava, uma vez
  ['revert: 0 salvo sem versao mas com a marca de fora (3) fica 0; grava só a v4 (ponte ligada)', (() => { gravacoes = 0; const c = carregarCom({ filaRapida: { freioTilt: 0 } }, 3); return { c, gravacoes }; })(),
    ({ c, gravacoes: g }) => c.filaRapida.freioTilt === 0 && c.coletor.ligado === true && g === 1],
  ['revert: marca de fora 4 e nada dentro: nada migra nem grava', (() => { gravacoes = 0; const c = carregarCom({ filaRapida: { freioTilt: 0 }, coletor: { ligado: false } }, 4); return { c, gravacoes }; })(),
    ({ c, gravacoes: g }) => c.filaRapida.freioTilt === 0 && c.coletor.ligado === false && g === 0],
  ['revert da v2: marca de fora 2 segura o 0 do freio; a migração do som ainda roda', (() => { gravacoes = 0; const c = carregarCom({ filaRapida: { freioTilt: 0 }, aceite: { silenciarSom: false } }, 2); return { c, gravacoes, m: marca }; })(),
    ({ c, gravacoes: g, m }) => c.filaRapida.freioTilt === 0 && c.aceite.silenciarSom === true && g === 1 && m === 4],
  ['instalação nova sem nada salvo não grava a marca de fora', (carregarCom(null), marca), m => m === null],
  ['config já na versão nova sem a marca de fora: grava a marca, não a config', (() => { gravacoes = 0; const c = carregarCom({ versao: 4, filaRapida: { freioTilt: 0 }, coletor: { ligado: true } }); return { c, gravacoes, m: marca }; })(),
    ({ c, gravacoes: g, m }) => c.filaRapida.freioTilt === 0 && g === 0 && m === 4],
  ['madrugada desligada salva fica desligada', carregarCom({ versao: 2, filaRapida: { freioMadrugada: false } }), c => c.filaRapida.freioMadrugada === false],
  // som do aceite (decisão do Gabriel, 13/10/2026): padrão ligado; false salvo antes da marca 3 vira true uma vez só
  ['som: padrão silenciarSom ligado', carregarCom(null), c => c.aceite.silenciarSom === true && PADRAO.aceite.silenciarSom === true],
  ['som: false salvo (v2) sem a marca 3 vira true e grava uma vez, com a marca', (() => { gravacoes = 0; const c = carregarCom({ versao: 2, aceite: { silenciarSom: false, atrasoS: 7 } }, 2); return { c, salvo, gravacoes, m: marca }; })(),
    ({ c, salvo: s, gravacoes: g, m }) => c.aceite.silenciarSom === true && c.aceite.atrasoS === 7 && g === 1 && s.versao === 4 && s.aceite.silenciarSom === true && m === 4],
  ['som: recarregar depois da migração não grava de novo', (() => { gravacoes = 0; const c = recarregar(); return { c, gravacoes }; })(),
    ({ c, gravacoes: g }) => c.aceite.silenciarSom === true && g === 0],
  ['som: respeita desligar depois (definir false -> recarregar = false)', (() => { definir('aceite.silenciarSom', false); return recarregar(); })(),
    c => c.aceite.silenciarSom === false && c.versao === 4],
  ['som: com a marca 3 dentro, false fica false', carregarCom({ versao: 3, aceite: { silenciarSom: false } }), c => c.aceite.silenciarSom === false],
  ['som: revert (sem versao dentro, marca de fora 3) não migra o som (grava só a v4)', (() => { gravacoes = 0; const c = carregarCom({ aceite: { silenciarSom: false } }, 3); return { c, gravacoes }; })(),
    ({ c, gravacoes: g }) => c.aceite.silenciarSom === false && g === 1],
  ['config v1 recebe as três migrações na mesma carga', (() => { gravacoes = 0; const c = carregarCom({ filaRapida: { freioTilt: 0 }, aceite: { silenciarSom: false } }); return { c, gravacoes }; })(),
    ({ c, gravacoes: g }) => c.filaRapida.freioTilt === 2 && c.aceite.silenciarSom === true && c.coletor.ligado === true && g === 1],
  ['migrar puro: v2 com som false -> true, freio 0 fica, ponte ligada', migrar({ versao: 2, filaRapida: { freioTilt: 0 }, aceite: { silenciarSom: false } }),
    s => s.aceite.silenciarSom === true && s.filaRapida.freioTilt === 0 && s.coletor?.ligado === true && s.versao === 4],
  // ponte com o complemento coach (VERSAO 4, roadmap/2026-10-17-plugin-pengu-primeiro.md Fase 1, decisão técnica 2)
  ['ponte: instalação nova = coletor.ligado false (nada toca a 8765) e nada gravado', (() => { gravacoes = 0; const c = carregarCom(null); return { c, gravacoes, m: marca }; })(),
    ({ c, gravacoes: g, m }) => PADRAO.coletor.ligado === false && c.coletor.ligado === false && g === 0 && m === null],
  ['ponte: config v3 salva (a do Gabriel) = true uma vez, gravada com versao 4 e a marca 4', (() => { gravacoes = 0; const c = carregarCom({ versao: 3, coach: { voz: false } }, 3); return { c, salvo, gravacoes, m: marca }; })(),
    ({ c, salvo: s, gravacoes: g, m }) => c.coletor.ligado === true && s.coletor.ligado === true && s.versao === 4 && g === 1 && m === 4 && c.coach.voz === false],
  ['ponte: false escolhido depois fica false (recarregar não migra de novo)', (() => { definir('coletor.ligado', false); gravacoes = 0; const c = recarregar(); return { c, gravacoes }; })(),
    ({ c, gravacoes: g }) => c.coletor.ligado === false && g === 0],
  ['ponte: ... e sem a marca de fora (DataStore só com a config v4) também fica false', (() => { const s = JSON.parse(JSON.stringify(salvo)); return carregarCom(s, null); })(),
    c => c.coletor.ligado === false],
  ['ponte: restaurar() mantém coletor.ligado (instalação, não preferência) e as regras de runa', (() => {
    carregarCom({ versao: 4, coletor: { ligado: true }, runas: { regras: [{ championId: 1, posicao: '*', paginas: [7] }] }, filaRapida: { freioTilt: 5 } }, 4);
    restaurar(); return recarregar(); })(),
    c => c.coletor.ligado === true && c.runas.regras.length === 1 && c.runas.regras[0].championId === 1 && c.filaRapida.freioTilt === 2],
  ['ponte: restaurar() com a ponte desligada continua desligada', (() => { carregarCom({ versao: 4, coletor: { ligado: false } }, 4); restaurar(); return recarregar(); })(),
    c => c.coletor.ligado === false],
  // revisão adversarial de 19/10: o plugin de antes da v4 (revert) apaga coletor na mescla e mantém versao 4 (e a marca 4)
  ['ponte: v4 salva sem a chave coletor (revert e volta) = true, gravada já', (() => { gravacoes = 0; const c = carregarCom({ versao: 4, coach: { voz: false } }, 4); return { c, salvo, gravacoes }; })(),
    ({ c, salvo: s, gravacoes: g }) => c.coletor.ligado === true && s.coletor?.ligado === true && g === 1 && c.coach.voz === false],
  ['ponte: ... e recarregar depois do reparo não grava de novo', (() => { gravacoes = 0; const c = recarregar(); return { c, gravacoes }; })(),
    ({ c, gravacoes: g }) => c.coletor.ligado === true && g === 0],
  ['ponte: v4 salva com coletor.ligado false fica false (o reparo só olha a chave ausente)', (() => { gravacoes = 0; const c = carregarCom({ versao: 4, coletor: { ligado: false } }, 4); return { c, gravacoes }; })(),
    ({ c, gravacoes: g }) => c.coletor.ligado === false && g === 0],
  ['ponte: v4 salva com coletor.ligado de tipo errado ("x") = true', carregarCom({ versao: 4, coletor: { ligado: 'x' } }, 4), c => c.coletor.ligado === true],
  ['ponte: classe lc-coletor sem colisão', (carregarCom(null), classes()), l => l.filter(([k]) => k === 'lc-coletor').length === 1],
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
      && c.coach.overlaySuave === true && c.versao === 4],
  ['avisos 14/10: config salva antes das chaves ganha os padrões sem regravar (sem VERSAO nova)', (() => { gravacoes = 0; const c = carregarCom({ versao: 4, coach: { voz: false }, coletor: { ligado: true } }, 4); return { c, gravacoes }; })(),
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

// ---- Fase 3 de roadmap/2026-10-17-plugin-pengu-primeiro.md (19/10/2026): o que é pessoal vira configuração ----
// PADRAO público: runas.regras [], compacto.favoritos [], aceite.trazerClient true (decisão do Gabriel: minimizar no ready check
// desligado para instalação nova). A config salva do Gabriel não muda: GABRIEL tem a forma da config dele lida do DataStore em
// 19/10/2026 (versao 3, trazerClient false explícito, favoritos e regras salvos; só os subtrees que esta fase toca)
const GABRIEL = {
  versao: 3,
  aceite: { ligado: true, atrasoS: 8, limiteS: 12, trazerClient: false, esconderPopup: false, silenciarSom: true },
  filaRapida: { ligado: true, fila: 420, pos1: 'TOP', pos2: 'JUNGLE', jogarDeNovo: true, freioTilt: 2, freioMadrugada: true },
  compacto: { ligado: true, inicioCompacto: true, favoritos: [58, 154], larg: 420, alt: 680, fundoPerfil: true, chatSalaCresce: true },
  runas: { ligado: true, regras: [
    { championId: 58, posicao: '*', paginas: [1409260191, 2147419287] },
    { championId: 154, posicao: '*', paginas: [1540029809] },
  ] },
  recompensas: { ligado: true, tft: false },
  semPopups: { ligado: true, runasAutomaticas: true, smiteAutomatico: true },
};
const copia = o => JSON.parse(JSON.stringify(o));
// os subtrees que a Fase 3 toca (e os que ficam ligados por decisão dele): iguais ao salvo
const mesmos = (c, ref = GABRIEL) => ['aceite', 'filaRapida', 'compacto', 'runas', 'recompensas', 'semPopups'].every(k => igual(c[k], ref[k]));
{
  gravacoes = 0;
  const nova = carregarCom(null);
  casos.push(['Fase 3: instalação nova = trazerClient true, sem regras de runa nem favoritos; aceite, recompensas e avisos calados ligados; nada gravado',
    { nova, gravacoes, marca },
    ({ nova: c, gravacoes: g, marca: m }) => c.aceite.trazerClient === true && igual(c.runas.regras, []) && c.runas.ligado === true
      && igual(c.compacto.favoritos, []) && c.aceite.ligado === true && c.recompensas.ligado === true && c.semPopups.ligado === true
      && g === 0 && m === null]);
  casos.push(['Fase 3: o PADRAO não carrega dado pessoal (nenhum id de página de runa, favorito nem nome)', JSON.stringify(PADRAO),
    s => igual(PADRAO.runas.regras, []) && igual(PADRAO.compacto.favoritos, []) && !/Gabriel|Renekton|1409260191|2147419287|1540029809/.test(s)]);

  // a config dele (v3, marca 3, como está no DataStore): a migração v4 grava uma vez (ponte), os subtrees ficam iguais no cfg e no salvo
  gravacoes = 0;
  const g1 = carregarCom(copia(GABRIEL), 3);
  const salvo1 = copia(salvo), grav1 = gravacoes;
  gravacoes = 0;
  const g2 = recarregar();
  casos.push(['Fase 3: config salva do Gabriel (v3) igual antes e depois, inclusive trazerClient false, favoritos [58,154] e as 2 regras (cfg e DataStore)',
    { g1, salvo1, grav1 }, ({ g1: c, salvo1: s, grav1: n }) => mesmos(c) && mesmos(s) && c.aceite.trazerClient === false && s.aceite.trazerClient === false
      && n === 1 && s.versao === 4 && c.coletor.ligado === true]);
  casos.push(['Fase 3: ... e recarregar não grava nem muda nada', { g2, gravacoes }, ({ g2: c, gravacoes: n }) => mesmos(c) && n === 0]);
  // o estado dele depois de o orquestrador recarregar o plugin da Fase 1 (v4, marca 4, ponte ligada): zero gravação, nada muda
  gravacoes = 0;
  const g4 = carregarCom({ ...copia(GABRIEL), versao: 4, coletor: { ligado: true } }, 4);
  casos.push(['Fase 3: config dele já na v4 (depois da Fase 1): nada gravado, subtrees iguais, trazerClient false',
    { g4, gravacoes }, ({ g4: c, gravacoes: n }) => mesmos(c) && c.aceite.trazerClient === false && n === 0]);
  // restaurar(): favoritos ficam como as regras (não há tela para refazer a lista); trazerClient é preferência com caixa: volta ao padrão
  restaurar();
  const r = recarregar();
  casos.push(['Fase 3: restaurar() mantém favoritos, regras e a ponte; trazerClient volta ao padrão (true)', r,
    c => igual(c.compacto.favoritos, [58, 154]) && igual(c.runas.regras, GABRIEL.runas.regras) && c.coletor.ligado === true
      && c.aceite.trazerClient === true && c.aceite.atrasoS === 10]);
  casos.push(['Fase 3: restaurar() numa instalação nova continua sem favoritos nem regras', (() => { carregarCom(null); restaurar(); return recarregar(); })(),
    c => igual(c.compacto.favoritos, []) && igual(c.runas.regras, []) && c.coletor.ligado === false]);

  // a semente do README § Instalar roda como está escrita (revisão adversarial da Fase 3, 19/10/2026): numa reinstalação o
  // DataStore não tem lol-client.config até o 1º salvar() (o trecho antigo, DataStore.get(...).compacto, dava TypeError), e
  // uma mudança nas Configurações antes de recarregar regravava o cfg da memória por cima de um DataStore.set feito por fora
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const trecho = (readme.match(/`([^`\n]*compacto\.favoritos[^`\n]*)`/) || [])[1] || '';
  const rodar = () => new Function('__lolClient', 'DataStore', trecho)({ cfg, definir }, globalThis.DataStore);
  gravacoes = 0;
  carregarCom(null);
  const vazio = salvo;
  let erro = null;
  try { rodar(); } catch (e) { erro = String(e); }
  const depois = copia(salvo);
  definir('filaRapida.ligado', false);   // muda uma chave nas Configurações antes de recarregar
  const r2 = recarregar();
  casos.push(['Fase 3: a semente do README roda numa instalação nova (DataStore vazio) e sobrevive a mudar outra chave antes de recarregar',
    { trecho, vazio, erro, depois, r2 }, v => v.vazio === null && v.erro === null && /__lolClient\.definir/.test(v.trecho)
      && igual(v.depois?.compacto?.favoritos, [58, 154]) && v.depois?.aceite?.trazerClient === false
      && igual(v.r2.compacto.favoritos, [58, 154]) && v.r2.aceite.trazerClient === false && v.r2.filaRapida.ligado === false]);
}

// ponta a ponta do foco no ready check (aceite.js criarFoco) com a config carregada: outra janela na frente, ReadyCheck, o client
// rouba o foco 60 ms depois. Instalação nova não minimiza; a config dele (trazerClient false) segue minimizando
{
  const { criarFoco } = await import('../pengu/aceite.js');
  const roteiro = c => {
    let t = 0;
    const pend = [], chamadas = [];
    const f = criarFoco({ cfg: c, lcu: (m, u) => { chamadas.push(`${m} ${u}`); return Promise.resolve({ ok: true }); },
      agora: () => t, agendar: fn => { pend.push(fn); return pend.length; } });
    for (const [ms, ev] of [[0, 'blur'], [30000, 'ReadyCheck'], [30060, 'foco']]) {
      t = ms;
      if (ev === 'foco') f.aoFoco(); else if (ev === 'blur') f.aoBlur(); else f.aoFase(ev);
      while (pend.length) pend.shift()();
    }
    return chamadas;
  };
  const nova = roteiro(carregarCom(null));
  const dele = roteiro(carregarCom({ ...copia(GABRIEL), versao: 4, coletor: { ligado: true } }, 4));
  casos.push(['Fase 3: ready check com o client atrás: instalação nova não minimiza; a config dele minimiza (ux-minimize)', { nova, dele },
    v => v.nova.length === 0 && igual(v.dele, ['POST /riotclient/ux-minimize'])]);
}

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
  // Fase 1 (ponte): sem o complemento, nenhum atalho coach.*; o da própria ponte existe sempre. Fase 2 (19/10/2026): o atalho do
  // chat ao lado saiu com as janelas do chat do complemento (nenhuma ação compacto.chat* em recurso nenhum, abaixo)
  const { registrarAcoesCoach, ALTERNAVEIS_COACH } = await import('../pengu/config.js');
  const tags = () => acoes.map(a => a.tags?.[1]);
  const semCoach = ['coach.voz', 'coach.mentor', 'coach.aceiteFlutuante', 'coach.painelAoVivo', 'traumas.ligado'].filter(t => tags().includes(t));
  casos.push(['Fase 2: nenhum atalho do Ctrl+K liga a escolha do chat (lista do coach sem compacto.chat* nem o recurso das janelas)',
    ALTERNAVEIS_COACH.map(([c, , r]) => [c, r.join()]), v => v.every(([c, r]) => !/^compacto\.chat/.test(c) && !/chat-janelas/.test(r))]);
  const n0 = registrarAcoesCoach(() => false);
  const n1 = registrarAcoesCoach(r => r === 'voz' || r === 'mentor');
  const n2 = registrarAcoesCoach(r => r === 'voz' || r === 'mentor');
  casos.push(['ponte: Ctrl+K sem o complemento não tem coach.*/traumas/chat ao lado; tem "falar com o complemento coach"; recurso novo entra uma vez',
    { semCoach, n0, n1, n2, tags: tags() }, v => v.semCoach.length === 0 && v.n0 === 0 && v.n1 === 2 && v.n2 === 0
      && v.tags.includes('coletor.ligado') && v.tags.includes('coach.voz') && v.tags.includes('coach.mentor') && !v.tags.includes('coach.painelAoVivo')]);
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
