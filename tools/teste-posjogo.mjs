// Confere pengu/posjogo/analise.js contra o caso de referência de docs/INSIGHTS.md (gameId 3292712362).
// Os JSON vêm de temp/insights/ (baixados da LCU, gitignored). uso: node tools/teste-posjogo.mjs [pasta]
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analisar } from '../pengu/posjogo/analise.js';

const pasta = process.argv[2] || fileURLToPath(new URL('../temp/insights/', import.meta.url));
const ler = n => JSON.parse(readFileSync(pasta + '/' + n, 'utf8'));
if (!existsSync(pasta + '/game-3292712362.json')) { console.log('FALHOU: sem temp/insights/game-3292712362.json'); process.exit(1); }

const ID = 3292712362;
const AMOSTRA = [3292673407, 3292656408, 3292611857, 3292592702, 3291749162, 3291733499, 3291720658, 3291708550,
  3291333732, 3291279167, 3291267798, 3291245839, 3291218155, 3291213848, 3291213653, 3291211660];
const hist = ler('historico.json').games.games.filter(g => AMOSTRA.includes(g.gameId) || g.gameId === ID);
const r = analisar(ler(`game-${ID}.json`), ler(`timeline-${ID}.json`), ler('summoner.json').puuid, hist);

const esperado = {
  ident: [1, 100, 58, 'TOP', 6, 83, false],
  mortes: [
    ['09:21', 561338, 13098, 3301, 'rota_bot', 'inimigo', 10, [9], 2, 540210, [4, 5], [['HORDE', 566949], ['HORDE', 570923]]],
    ['11:07', 667090, 1126, 10559, 'rota_top', 'aliado', 6, [], 1, 660236, [], []],
    ['16:07', 967911, 1026, 9790, 'rota_top', 'aliado', 6, [], 1, 960324, [3], [['TOWER_BUILDING', 979933], ['DRAGON', 1038827]]],
    ['24:05', 1445508, 7324, 8832, 'rio', 'inimigo', 9, [10], 2, 1440453, [4, 5], [['TOWER_BUILDING', 1475331]]],
    ['29:45', 1785889, 12677, 13791, 'base_inimiga', 'inimigo', 9, [7, 8, 10], 4, 1800548, [3, 4, 5], []],
  ],
  diffs: { 10: [171, -134, 0, 3334, 4670, 67, 3163, 4804, 67], 15: [-368, -554, 1, 4678, 7959, 108, 5046, 8513, 107] },
  farm: [7.8861, 7.4437, 16],
};

let ok = 0, total = 0;
const caso = (nome, obtido, esp) => {
  total++;
  const a = JSON.stringify(obtido), b = JSON.stringify(esp);
  if (a === b) { ok++; console.log('ok', nome); } else console.log('FALHOU', nome, '\n  obtido  ', a, '\n  esperado', b);
};
caso('identificação', [r.participantId, r.time, r.campeao, r.papel, r.adversario?.participantId, r.adversario?.campeao, r.adversario?.incerto], esperado.ident);
caso('nº de mortes', r.mortes.length, 5);
r.mortes.forEach((m, i) => caso(`morte ${i + 1}`,
  [m.t, m.ms, m.x, m.y, m.regiao, m.lado, m.matador, m.assistentes, m.inimigos, m.frameMs, m.aliadosPerto, m.objetivos.map(o => [o.tipo, o.ms])],
  esperado.mortes[i]));
for (const m of ['10', '15']) {
  const d = r.diffs[m];
  caso(`diffs ${m}`, d && [d.ouro, d.xp, d.farm, d.eu.ouro, d.eu.xp, d.eu.farm, d.adv.ouro, d.adv.xp, d.adv.farm], esperado.diffs[m]);
}
caso('chaves de diffs são string', Object.keys(r.diffs), ['10', '15']);
caso('farm', [Number(r.farm.valor.toFixed(4)), Number(r.farm.media.toFixed(4)), r.farm.n], esperado.farm);
console.log(`${ok}/${total} ${ok === total ? 'ok' : 'FALHOU'}`);
process.exit(ok === total ? 0 : 1);
