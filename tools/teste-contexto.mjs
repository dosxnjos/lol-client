// Prova da Fase 5 (roadmap/2026-10-17-plugin-pengu-primeiro.md), lado JS: pengu/posjogo/contexto.js sobre a fixture do
// acumulador (tools/fixtures/historico-1.json, lida pelo remapear do historico.js como o DataStore) dá a MESMA saída que o
// coletor (tools/teste-contexto.py --json, as funções do Python sem mudança) e que a gravada em
// tools/fixtures/contexto-esperado.json, campo a campo (número com tolerância 1e-9). Hora local fixa em America/Sao_Paulo
// nos dois lados (as faixas horárias dependem dela). Mais: medição dos freios (piso de 30 partidas e 10 por faixa), selo
// local da seleção e a fixture sem identidade de outro jogador.
// uso: node tools/teste-contexto.mjs   (roda o teste-contexto.py --json; sem Python, compara só com o esperado)
process.env.TZ = 'America/Sao_Paulo';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { remapear, comoObjeto, CAMPOS } from '../pengu/historico.js';
import { matchups, traumas, historicoTilt, contextoPartida, traumasDaPartida, seloLocal, medicaoDe, PISO_MEDICAO, PISO_FAIXA,
  AMOSTRA_LOCAL } from '../pengu/posjogo/contexto.js';
import { linhaMatchup, linhaTrauma, adversarioDoDraft, linhasDraft } from '../pengu/champselect.js';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const casos = [];
const caso = (nome, ok, detalhe = '') => { casos.push([nome, !!ok]); console.log(`${ok ? 'ok   ' : 'FALHA'} ${nome}${ok ? '' : ` -- ${detalhe}`}`); };

// diferenças campo a campo (mesma regra do teste-contexto.py)
function diferencas(a, b, c = '') {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b)) ? [] : [`${c}: ${a} x ${b}`];
  if (Array.isArray(a) && Array.isArray(b)) return a.length !== b.length ? [`${c}: ${a.length} itens x ${b.length}`] : a.flatMap((x, i) => diferencas(x, b[i], `${c}[${i}]`));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a), kb = Object.keys(b);
    const so = [...ka.filter(k => !kb.includes(k)), ...kb.filter(k => !ka.includes(k))].map(k => `${c}.${k}: só de um lado`);
    return [...so, ...ka.filter(k => kb.includes(k)).sort().flatMap(k => diferencas(a[k], b[k], `${c}.${k}`))];
  }
  return a === b ? [] : [`${c}: ${JSON.stringify(a)} x ${JSON.stringify(b)}`];
}

const fixtura = JSON.parse(readFileSync(raiz + 'tools/fixtures/historico-1.json', 'utf8'));
const linhas = remapear(fixtura.campos, fixtura.linhas).map(comoObjeto);
caso('fixture: formato do DataStore (v 1, campos = CAMPOS) e todas as linhas passam pelo remapear', fixtura.v === 1
  && JSON.stringify(fixtura.campos) === JSON.stringify(CAMPOS) && linhas.length === fixtura.linhas.length, `${linhas.length} de ${fixtura.linhas.length}`);
const texto = readFileSync(raiz + 'tools/fixtures/historico-1.json', 'utf8');
caso('fixture: só ids de campeão, nenhum nome nem puuid além do dono', !/gameName|tagLine|summonerName|riotId/i.test(texto)
  && (texto.match(/puuid[-\w]*/g) || []).every(p => p === 'puuid-eu'));

const porId = new Map(linhas.map(l => [l.gameId, l]));
function rodarJs(k) {
  if (k.fn === 'matchups') return matchups(linhas, k.campeao);
  if (k.fn === 'traumas') return traumas(linhas, { campeao: k.campeao, antesDe: k.antes_de });
  if (k.fn === 'historico_tilt') return historicoTilt(linhas, k.game_id, k.criacao);
  if (k.fn === 'contexto_partida') return contextoPartida(linhas, porId.get(k.game_id));
  throw new Error(`função desconhecida: ${k.fn}`);
}

const arqEsperado = raiz + 'tools/fixtures/contexto-esperado.json';
const esperado = existsSync(arqEsperado) ? JSON.parse(readFileSync(arqEsperado, 'utf8')) : null;
let py = null;
try {
  py = JSON.parse(execFileSync('python', [raiz + 'tools/teste-contexto.py', '--json'], { encoding: 'utf8', maxBuffer: 1 << 24 }));
} catch (e) { console.log(`(sem o Python: ${String(e.message || e).split('\n')[0]}; compara só com o esperado)`); }
caso('contexto-esperado.json existe', !!esperado, arqEsperado);
const lista = py?.casos || esperado?.casos || [];
caso('casos de paridade: matchups, traumas, histórico e contexto de 7 partidas', lista.length >= 14, String(lista.length));
for (const k of lista) {
  const js = rodarJs(k);
  if (py) { const d = diferencas(js, py.saidas[k.id], k.id); caso(`${k.id}: JS = Python (ao vivo), campo a campo`, !d.length, d.slice(0, 4).join('; ')); }
  if (esperado) { const d = diferencas(js, esperado.saidas[k.id], k.id); caso(`${k.id}: JS = esperado, campo a campo`, !d.length, d.slice(0, 4).join('; ')); }
}

// ---- recortes que o licoes.js lê (montarMetricas): matchup com 7 chaves, traumas com 5 ----
{
  const c = contextoPartida(linhas, porId.get(3302400577));
  caso('contexto: matchup só com n, vitorias, winrate, ouro10, xp10, farm10, mortes10', c.matchup
    && JSON.stringify(Object.keys(c.matchup)) === JSON.stringify(['n', 'vitorias', 'winrate', 'ouro10', 'xp10', 'farm10', 'mortes10']), JSON.stringify(c.matchup));
  const t = contextoPartida(linhas, porId.get(3302392505)).traumas;
  caso('contexto: trauma da partida com campeao, n, lift, vitorias, derrotas (só inimigos desta partida)', t.length > 0
    && t.every(x => JSON.stringify(Object.keys(x)) === JSON.stringify(['campeao', 'n', 'lift', 'vitorias', 'derrotas']) && porId.get(3302392505).inimigos.includes(x.campeao)),
  JSON.stringify(t));
  caso('traumasDaPartida: inimigo fora da partida não entra', traumasDaPartida(linhas, 58, [1, 2, 3], Infinity).length === 0);
  const sem = contextoPartida([], { gameId: 1, criacao: 1, campeao: 58, papel: 'TOP', adversario: 83, incerto: 0, inimigos: [83] });
  caso('contexto sem linhas: matchup null, traumas [], histórico geral n 0 (sem exceção)', sem.matchup === null && !sem.traumas.length
    && sem.historico.geral.n === 0 && sem.historico.geral.wr === null);
}

// ---- medição dos freios (Fase 5 passo 3): calculada do acumulador, piso de 30 partidas e de 10 por faixa ----
{
  const m = medicaoDe(linhas);
  const ti = historicoTilt(linhas, null, Infinity);
  const r = b => (b && b.n >= PISO_FAIXA ? Math.round(b.wr) : null);
  const f = ti.faixas;
  const nDia = (f['06-12']?.n || 0) + (f['12-18']?.n || 0);
  const vDia = (f['06-12'] ? f['06-12'].wr * f['06-12'].n / 100 : 0) + (f['12-18'] ? f['12-18'].wr * f['12-18'].n / 100 : 0);
  caso('medição: partidas = geral do histórico (as que contam)', m && m.partidas === ti.geral.n && m.partidas === 53, JSON.stringify(m));
  caso('medição: depois de 2 = apos_derrotas["2"], madrugada = faixa 00-06, dia = 06-12 + 12-18 (arredondados)',
    m.wrDepoisDe2 === r(ti.apos_derrotas['2']) && m.wrMadrugada === r(f['00-06']) && m.nDia === nDia && m.wrDia === Math.round(100 * Math.round(vDia) / nDia)
    && m.wrGeral === Math.round(ti.geral.wr), JSON.stringify({ m, ti }));
  const menos = linhas.filter(l => l.fila !== 0 && l.duracao >= 300).slice(0, PISO_MEDICAO - 1);
  caso(`medição: ${PISO_MEDICAO - 1} partidas = null (texto sem número); ${PISO_MEDICAO} = números`, medicaoDe(menos) === null
    && medicaoDe(linhas.filter(l => l.fila !== 0 && l.duracao >= 300).slice(0, PISO_MEDICAO)) !== null);
  caso('medição: remake e personalizada não contam para o piso', medicaoDe([...menos, ...linhas.filter(l => l.fila === 0 || l.duracao < 300)]) === null);
  const soDia = linhas.map(l => ({ ...l, criacao: new Date(new Date(l.criacao).setHours(14)).getTime() }));
  const md = medicaoDe(soDia);
  caso('medição: faixa com menos de 10 partidas = só aquele número null (madrugada sem partida)', md && md.wrMadrugada === null && md.nMadrugada === 0
    && md.wrDia !== null, JSON.stringify(md));
  caso('medição: lista vazia ou nula = null', medicaoDe([]) === null && medicaoDe(null) === null);
}

// ---- selo local da seleção (sem o complemento): mesmo formato do GET /draft/<meu> ----
{
  const s = seloLocal(linhas, 58, 'top', new Set([83, 64, 122, 30, 31]));
  caso('selo local: matchups = matchups(linhas, meu).matchups', JSON.stringify(s.matchups) === JSON.stringify(matchups(linhas, 58).matchups));
  const g83 = s.matchups.find(g => g.papel === 'TOP' && g.adversario === 83), g122 = s.matchups.find(g => g.papel === 'TOP' && g.adversario === 122);
  const esperadoAdv = g83.n >= g122.n ? 83 : 122;
  caso('selo local: adversário de rota = inimigo travado com grupo (meu, posição) de maior n', adversarioDoDraft(s.draft, 'top')?.campeao === esperadoAdv,
    JSON.stringify(s.draft));
  caso('selo local: traumas = traumas(campeao).campeoes só dos travados; sem linha de draft', s.traumas.every(t => [83, 64, 122, 30, 31].includes(t.campeao))
    && s.traumas.length > 0 && linhasDraft(s.draft).length === 0 && s.local === true);
  const nome = id => `campeão ${id}`;
  caso('selo local: linhaMatchup e linhaTrauma do selo funcionam com ele', /^contra campeão (83|122): \d+V\/\d+D/.test(linhaMatchup(s.matchups, 58, esperadoAdv, nome(esperadoAdv), 'TOP'))
    && /é trauma: \d+V\/\d+D$/.test(linhaTrauma(s.traumas, nome) || ''), `${linhaMatchup(s.matchups, 58, esperadoAdv, nome(esperadoAdv), 'TOP')} | ${linhaTrauma(s.traumas, nome)}`);
  const sp = seloLocal(linhas, 58, '', new Set([83]));
  caso('selo local: sem posição (às cegas) não escolhe adversário', sp.draft === null);
  const nada = seloLocal(linhas, 58, 'TOP', new Set([1, 2, 3]));
  caso('selo local: nenhum travado com histórico na rota = sem adversário', nada.draft === null && nada.traumas.length === 0);
  caso('AMOSTRA_LOCAL = 3 (mínimo de um trauma)', AMOSTRA_LOCAL === 3);
}

const falhas = casos.filter(([, ok]) => !ok);
console.log(falhas.length ? `\n${falhas.length} de ${casos.length} falharam` : `\nteste-contexto.mjs: ${casos.length}/${casos.length} ok`);
process.exit(falhas.length ? 1 : 0);
