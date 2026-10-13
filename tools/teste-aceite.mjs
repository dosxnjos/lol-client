// Testa a decisão pura do aceite automático (pengu/aceite.js). uso: node tools/teste-aceite.mjs
import { decidir } from '../pengu/aceite.js';

const cfg = { ligado: true, atrasoS: 10, limiteS: 12 };
const rc = (timer, playerResponse = 'None', state = 'InProgress') => ({ state, playerResponse, timer, declinerIds: [], dodgeWarning: 'None', suppressUx: false });

const casos = [
  ['sem ready-check', decidir(null, cfg), d => d.acao === 'parar'],
  ['InProgress/None t=0 agenda ~10 s', decidir(rc(0), cfg), d => d.acao === 'esperar' && Math.abs(d.emS - 10) < 0.01],
  ['t=11 aceita já', decidir(rc(11), cfg), d => d.acao === 'aceitar'],
  ['Accepted cancela', decidir(rc(3, 'Accepted'), cfg), d => d.acao === 'parar'],
  ['Declined cancela', decidir(rc(3, 'Declined'), cfg), d => d.acao === 'parar'],
];
// extras: a janela corta o atraso (limite - 2) e o desligado não age
const extras = [
  ['atraso 15 vira 10 pelo limite 12', decidir(rc(0), { ...cfg, atrasoS: 15 }), d => d.acao === 'esperar' && d.emS === 10],
  ['desligado não age', decidir(rc(0), { ...cfg, ligado: false }), d => d.acao === 'parar'],
];

let ok = 0;
for (const [nome, d, conf] of casos) { const passou = conf(d); ok += passou; console.log(passou ? 'ok' : 'FALHOU', nome, JSON.stringify(d)); }
let okx = 0;
for (const [nome, d, conf] of extras) { const passou = conf(d); okx += passou; console.log(passou ? 'ok' : 'FALHOU', '(extra)', nome, JSON.stringify(d)); }
console.log(`${ok}/${casos.length} ok` + (okx === extras.length ? '' : ` | extras FALHOU ${okx}/${extras.length}`));
process.exit(ok === casos.length && okx === extras.length ? 0 : 1);
