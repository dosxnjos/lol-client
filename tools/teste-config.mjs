// Testa a carga da configuração do plugin (pengu/config.js): migração de avisosDesligados (lista até
// 13/10/2026 -> {voz, tela}) e a mescla com o padrão. uso: node tools/teste-config.mjs
import { carregar, cfg, migrar, PADRAO, classes } from '../pengu/config.js';
import { corpoConfig } from '../pengu/coach.js';

globalThis.document = { documentElement: { classList: { toggle() {} } } };
let salvo = null;
globalThis.DataStore = { get: () => salvo, set: () => {} };
const carregarCom = s => { salvo = s; return JSON.parse(JSON.stringify(carregar())); };
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
    c => c.aceite.atrasoS === 7 && c.aceite.trazerClient === false && c.aceite.esconderPopup === false && c.aceite.silenciarSom === false
      && c.filaRapida.fila === 440 && c.filaRapida.jogarDeNovo === true && c.filaRapida.freioTilt === 0
      && c.recompensas.ligado === true && c.recompensas.tft === false && c.coach.aceiteFlutuante === true && c.coach.voz === false],
  ['valores salvos das chaves novas ficam', carregarCom({ aceite: { trazerClient: true, esconderPopup: true, silenciarSom: true },
    filaRapida: { jogarDeNovo: false, freioTilt: 3 }, recompensas: { ligado: false, tft: true }, coach: { aceiteFlutuante: false } }),
    c => c.aceite.trazerClient && c.aceite.esconderPopup && c.aceite.silenciarSom && !c.filaRapida.jogarDeNovo
      && c.filaRapida.freioTilt === 3 && !c.recompensas.ligado && c.recompensas.tft && c.coach.aceiteFlutuante === false],
  ['tipo errado salvo volta ao padrão (freioTilt "3")', carregarCom({ filaRapida: { freioTilt: '3' } }), c => c.filaRapida.freioTilt === 0],
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
];

let ok = 0;
for (const [nome, valor, conferir] of casos) {
  const passou = !!conferir(valor);
  ok += passou;
  console.log(`${passou ? 'ok ' : 'FALHOU'} ${nome}${passou ? '' : ' -> ' + JSON.stringify(valor?.coach?.avisosDesligados ?? valor)}`);
}
console.log(`${ok}/${casos.length} ok`);
process.exit(ok === casos.length ? 0 : 1);
