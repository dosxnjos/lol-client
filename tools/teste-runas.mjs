// Testa a escolha pura das runas (pengu/runas.js). uso: node tools/teste-runas.mjs
import { escolherRunas, donoDaPagina, consultarRunas } from '../pengu/runas.js';
import { PADRAO } from '../pengu/config.js';

const regras = PADRAO.runas.regras; // a semente do plano
// páginas como GET /lol-perks/v1/pages devolve (medidas em 13/10/2026; só o que a função usa)
const paginas = [1409260191, 1378841228, 1333256548, 1540029809, 1517184216, 2133672737, 1417788555, 1696192448, 2147419287].map(id => ({ id }));
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const casos = [
  ['Renekton/TOP -> 2 ids', escolherRunas(regras, 58, 'TOP', paginas), r => igual(r, [1409260191, 2147419287])],
  ['Zac/JUNGLE -> [1540029809]', escolherRunas(regras, 154, 'JUNGLE', paginas), r => igual(r, [1540029809])],
  ['Ahri -> []', escolherRunas(regras, 103, 'MIDDLE', paginas), r => igual(r, [])],
  ['id inexistente filtrado', escolherRunas([{ championId: 58, posicao: '*', paginas: [1409260191, 999] }], 58, 'TOP', paginas), r => igual(r, [1409260191])],
];
// extras: posição específica vence a '*', posição minúscula da LCU, champ select sem posição, dono da página
const pos = [...regras, { championId: 58, posicao: 'JUNGLE', paginas: [1696192448] }];
const extras = [
  ['regra da posição vence a *', escolherRunas(pos, 58, 'JUNGLE', paginas), r => igual(r, [1696192448])],
  ['posição em minúscula (assignedPosition)', escolherRunas(pos, 58, 'jungle', paginas), r => igual(r, [1696192448])],
  ['sem posição (personalizada) cai na *', escolherRunas(pos, 58, '', paginas), r => igual(r, [1409260191, 2147419287])],
  ['apagada vira aviso', consultarRunas([{ championId: 58, posicao: '*', paginas: [1409260191, 999] }], 58, '', paginas), r => igual(r, { candidatas: [1409260191], apagadas: [999] })],
  // regra da posição sem página viva não esconde a '*' (achado de revisão 13/10/2026)
  ['regra da posição vazia cai na *', escolherRunas([...regras, { championId: 154, posicao: 'JUNGLE', paginas: [] }], 154, 'jungle', paginas), r => igual(r, [1540029809])],
  ['regra da posição toda apagada cai na * e avisa', consultarRunas([...regras, { championId: 154, posicao: 'JUNGLE', paginas: [999] }], 154, 'JUNGLE', paginas), r => igual(r, { candidatas: [1540029809], apagadas: [999] })],
  ['regra da posição com 1 viva não cai na *', consultarRunas([...regras, { championId: 58, posicao: 'TOP', paginas: [999, 1696192448] }], 58, 'TOP', paginas), r => igual(r, { candidatas: [1696192448], apagadas: [999] })],
  ['página do Zac com Renekton -> dono 154', donoDaPagina(regras, 1540029809, 58), r => r === 154],
  ['página do próprio campeão -> null', donoDaPagina(regras, 1540029809, 154), r => r === null],
];

let ok = 0;
for (const [nome, r, conf] of casos) { const passou = conf(r); ok += passou; console.log(passou ? 'ok' : 'FALHOU', nome, JSON.stringify(r)); }
let okx = 0;
for (const [nome, r, conf] of extras) { const passou = conf(r); okx += passou; console.log(passou ? 'ok' : 'FALHOU', '(extra)', nome, JSON.stringify(r)); }
console.log(`${ok}/${casos.length} ok` + (okx === extras.length ? '' : ` | extras FALHOU ${okx}/${extras.length}`));
process.exit(ok === casos.length && okx === extras.length ? 0 : 1);
