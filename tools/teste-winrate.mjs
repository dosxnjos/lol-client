// Confere estatisticasCampeao (pengu/champselect.js) contra a contagem em Python sobre o MESMO histórico.
// uso: node tools/teste-winrate.mjs [historico.json]  (padrão: tests/fixtures/historico.json, versionado;
// o histórico inteiro do dia sai de GET .../current-summoner/matches para temp/historico.json)
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { estatisticasCampeao, textoSelo } from '../pengu/champselect.js';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const arq = process.argv[2] || raiz + 'tests/fixtures/historico.json';
let h;
try { h = JSON.parse(readFileSync(arq, 'utf8')); }
catch (e) {
  console.log(`FALHOU: sem histórico em ${arq} (${e.code || e.message}). Gere com o client aberto: arquivo .js com`
    + " (async () => JSON.stringify(await (await fetch('/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=199')).json()))()"
    + ' e `node tools/cdp.mjs eval <arquivo.js> > temp/historico.json` (leva até 40 s).');
  process.exit(1);
}
const jogos = h.games?.games ?? h;
const py = JSON.parse(execFileSync('python', [raiz + 'tools/teste-winrate.py', arq], { encoding: 'utf8' }));

let ok = 0, total = 0;
for (const [chave, esperado] of Object.entries(py)) {
  const [c, pos] = chave.split('|');
  const e = estatisticasCampeao(jogos, Number(c), pos);
  const obtido = pos ? (({ pos: _, ...r }) => r)(e.posicao) : e.geral;
  total++;
  if (JSON.stringify(obtido) === JSON.stringify(esperado)) ok++;
  else console.log('FALHOU', chave, 'js', JSON.stringify(obtido), 'py', JSON.stringify(esperado));
}
// amostra impressa para conferência a olho
for (const [c, pos] of [[58, 'TOP'], [58, 'JUNGLE'], [154, 'JUNGLE'], [103, 'MIDDLE']])
  console.log(c, pos, JSON.stringify(textoSelo(estatisticasCampeao(jogos, c, pos), String(c)).linhas));
console.log(`${jogos.length} partidas no histórico, ${ok}/${total} recortes iguais ao Python`);
console.log(ok === total && total > 0 ? 'ok' : 'FALHOU');
process.exit(ok === total && total > 0 ? 0 : 1);
