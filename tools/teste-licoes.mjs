// Prova do passo 6 (plano v2), lado JS: pengu/posjogo/licoes.js nas mesmas 2 partidas do tools/teste-licoes.py.
// A análise (analise.js), a sessão e as métricas são calculadas aqui, do zero: referência das fixtures de
// tests/fixtures/, partida real do que o Python tirou do banco (temp/licoes/3292746609.json). Só o contexto do
// coletor (matchup, traumas, winrate por faixa) e os nomes vêm do Python, como no client (GET /contexto do coletor).
// Compara métrica a métrica com o Python e imprime as linhas "licoes <id>: …", que têm de bater com as dele.
// uso: python tools/teste-licoes.py && node tools/teste-licoes.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analisar } from '../pengu/posjogo/analise.js';
import { lerRegras, escolher, sessao, historicoDaLcu, montarMetricas, formatar, compilar, avaliarExpr, renderizar } from '../pengu/posjogo/licoes.js';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const lerJson = p => JSON.parse(readFileSync(raiz + p, 'utf8'));
const REF = 3292712362, REAL = 3292746609;
const ESPERADO_REF = ['mortes-1x1-adversario', 'virada-10-15', 'farm-acima'];
const falhas = [];

// mesmos casos de tools/validar-licoes.py (CASOS_FORMATO)
const CASOS = [
  [0.25, '', '0,3'], [-0.25, '', '−0,2'], [2.5, '', '2,5'], [2.5, 'int', '3'], [-2.5, 'int', '−2'],
  [171, '+', '+171'], [-368, '+', '−368'], [-368, 'abs', '368'], [0, '+', '0'], [0.04, '+', '0,0'],
  [7.886, '', '7,9'], [0.4424, '+', '+0,4'], [47.6, 'pct', '48%'], [289069, 'mmss', '04:49'],
  [1.2597, '', '1,3'], [-83.333, '+int', '−83'], ['Zac', '', 'Zac'], [33.3667, 'int', '33'],
  [-61000, 'mmss', '−01:01'], [-0.25, 'mmss', '00:00'],
];
for (const [v, f, esp] of CASOS) {
  const obt = formatar(v, f);
  if (obt !== esp) falhas.push(`formatar(${v}, '${f}') = '${obt}', esperado '${esp}'`);
}

const regras = lerRegras(readFileSync(raiz + 'pengu/posjogo/licoes.md', 'utf8'));

function rodar(gid, partida, timeline, historico, puuid, dump) {
  const r = analisar(partida, timeline, puuid, historico);
  if (r.erro) { falhas.push(`${gid}: ${r.erro}`); return; }
  const ses = sessao(historicoDaLcu(historico), gid, partida.gameCreation);
  const m = montarMetricas(r, ses, dump.contexto, dump.nomes);
  // métrica a métrica contra o Python (mesmas chaves, números a 1e-9)
  const chaves = new Set([...Object.keys(m), ...Object.keys(dump.metricas)]);
  let iguais = 0;
  for (const k of chaves) {
    const a = m[k], b = dump.metricas[k];
    const ok = (typeof a === 'number' && typeof b === 'number') ? Math.abs(a - b) < 1e-9 : a === b;
    if (ok) iguais++; else falhas.push(`${gid}: métrica ${k}: JS ${JSON.stringify(a)} x Python ${JSON.stringify(b)}`);
  }
  const lic = escolher(regras, m);
  console.log(`licoes ${gid}: ${lic.map(x => x.id).join(' > ')}`);
  for (const x of lic) console.log(`  [${x.tipo}] ${x.texto}`);
  console.log(`  métricas iguais ao Python: ${iguais}/${chaves.size}`);
  if (JSON.stringify(lic) !== JSON.stringify(dump.licoes)) falhas.push(`${gid}: lições diferentes das do Python`);
  return lic;
}

const dumpDe = gid => {
  const p = `temp/licoes/${gid}.json`;
  if (!existsSync(raiz + p)) { console.log(`FALHOU: sem ${p} (rode antes: python tools/teste-licoes.py)`); process.exit(1); }
  return lerJson(p);
};

// referência: tudo das fixtures
const fx = n => lerJson(`tests/fixtures/${n}`);
const licRef = rodar(REF, fx(`game-${REF}.json`), fx(`timeline-${REF}.json`), fx('historico.json').games.games,
  fx('summoner.json').puuid, dumpDe(REF));
if (licRef && JSON.stringify(licRef.map(x => x.id)) !== JSON.stringify(ESPERADO_REF)) falhas.push(`${REF}: esperado ${ESPERADO_REF.join(' > ')}`);

// real: partida, timeline e histórico do banco (via dump do Python)
const d = dumpDe(REAL);
const licReal = rodar(REAL, d.partida, d.timeline, d.historico, d.puuid, d);
if (licReal && licReal.length !== 3) falhas.push(`${REAL}: ${licReal.length} lições`);

// cruzado: o motor sobre as métricas de todas as partidas do banco + sorteios (temp/licoes/cruzado.json)
const casos = dumpDe('cruzado');
let iguaisCruz = 0;
for (const c of casos) {
  const m = c.metricas;
  let ok = JSON.stringify(escolher(regras, m)) === JSON.stringify(c.licoes);
  for (const rg of regras) {
    let v;
    try { v = avaliarExpr(compilar(rg.quando), m); } catch (e) { v = `erro: ${e.message}`; }
    const [vPy, tPy] = c.regras[rg.id];
    const t = renderizar(rg.texto, m);
    if (v !== vPy || t !== tPy) {
      ok = false;
      if (falhas.length < 20) falhas.push(`cruzado ${c.origem} ${rg.id}: JS ${JSON.stringify([v, t])} x Python ${JSON.stringify([vPy, tPy])}`);
    }
  }
  if (ok) iguaisCruz++;
  else if (falhas.length < 20) falhas.push(`cruzado ${c.origem}: escolha diferente`);
}
console.log(`cruzado: ${iguaisCruz}/${casos.length} casos iguais ao Python (escolha + cada regra: valor e texto)`);

console.log(falhas.length ? falhas.map(f => `FALHOU: ${f}`).join('\n') : `ok (${CASOS.length} casos de formato, ${regras.length} regras)`);
process.exit(falhas.length ? 1 : 0);
