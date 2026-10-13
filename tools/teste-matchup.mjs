// Prova dos passos 4 e 19 (plano v2), lado do selo: linhaMatchup/linhaTrauma (pengu/champselect.js) contra a
// saída de analise.matchups() e analise.traumas() no banco (tools/teste-matchup.py, só leitura). Confere o
// texto inteiro de cada grupo e, à parte, os números lidos de volta do texto contra o grupo do Python.
// uso: node tools/teste-matchup.mjs [banco] [campeão...]   (padrão: dados/lol.db, Renekton e Zac)
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { linhaMatchup, linhaTrauma, grupoMatchup, adversarioDoDraft, linhasDraft, MIN_MATCHUP } from '../pengu/champselect.js';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const py = JSON.parse(execFileSync('python', [raiz + 'tools/teste-matchup.py', ...process.argv.slice(2)], { encoding: 'utf8' }));
const falhas = [];
let casos = 0;

for (const bloco of py) {
  for (const c of bloco.casos) {
    casos++;
    const txt = linhaMatchup(bloco.matchups, c.meu, c.inimigo, c.nome, c.papel);
    if (txt !== c.esperado) falhas.push(`${c.meu} x ${c.inimigo} (${c.papel}): JS "${txt}" x Python "${c.esperado}"`);
    // números de volta do texto contra o grupo cru do Python
    const g = bloco.matchups.find(x => x.adversario === c.inimigo && x.papel === c.papel);
    const m = txt.match(/: (\d+)V\/(\d+)D(?: · ouro10 ([+−]?\d+))?$/);
    if (g && g.n >= MIN_MATCHUP) {
      const ouro = m?.[3] ? Number(m[3].replace('−', '-')) : null;
      if (!m || +m[1] !== g.vitorias || +m[2] !== g.n - g.vitorias || (g.ouro10 === null ? ouro !== null : Math.abs(ouro - g.ouro10) > 0.5))
        falhas.push(`${c.meu} x ${c.inimigo}: números do texto ${JSON.stringify(m?.slice(1))} x grupo n=${g.n} v=${g.vitorias} ouro10=${g.ouro10}`);
    }
  }
  const nome = id => bloco.nomes[String(id)] || `campeão ${id}`;
  const tr = linhaTrauma(bloco.traumas, nome);
  if (tr !== bloco.trauma_esperado) falhas.push(`trauma de ${bloco.meu}: JS "${tr}" x Python "${bloco.trauma_esperado}"`);
  // campeão popular (lift < 1,2) nunca vira trauma, mesmo sendo o único inimigo
  const naoTrauma = bloco.traumas.find(t => !t.trauma && t.n >= 10);
  if (naoTrauma && linhaTrauma([naoTrauma], nome) !== null) falhas.push(`popular ${naoTrauma.campeao} virou trauma`);
  console.log(`${bloco.meu}: ${bloco.matchups.length} grupos, ${bloco.casos.length} linhas; ex.: ${bloco.casos.slice(0, 2).map(c => linhaMatchup(bloco.matchups, c.meu, c.inimigo, c.nome, c.papel)).join(' | ')}; trauma: ${tr}`);
}

// papel desempata quando o mesmo adversário aparece em 2 papéis; sem papel, o de maior n
const dois = [{ campeao: 1, adversario: 2, papel: 'TOP', n: 3, vitorias: 1, ouro10: -100 }, { campeao: 1, adversario: 2, papel: 'JUNGLE', n: 5, vitorias: 4, ouro10: 250.4 }];
if (grupoMatchup(dois, 1, 2, 'TOP').papel !== 'TOP' || grupoMatchup(dois, 1, 2).papel !== 'JUNGLE') falhas.push('desempate por papel');
if (linhaMatchup(dois, 1, 2, 'X', 'JUNGLE') !== 'contra X: 4V/1D · ouro10 +250') falhas.push(`formato: ${linhaMatchup(dois, 1, 2, 'X', 'JUNGLE')}`);
if (linhaMatchup([{ ...dois[0], n: 2, ouro10: null }], 1, 2, 'X') !== 'contra X: n=2') falhas.push('n < 3');
// adversário pelo draft: inimigo com a rota provável igual à minha; faixa e termos
const draft = { faixa: 'leve vantagem', inimigos: [{ campeao: 245, rota: 'JUNGLE' }, { campeao: 92, rota: 'TOP' }], termos: [{ pp: -2.31, texto: 'Ekko jungle 52.1% (n=40)' }] };
if (adversarioDoDraft(draft, 'jungle')?.campeao !== 245 || adversarioDoDraft(draft, '') !== null) falhas.push('adversário do draft');
if (JSON.stringify(linhasDraft(draft)) !== JSON.stringify(['draft: leve vantagem', '−2,3 Ekko jungle 52,1% (n=40)'])) falhas.push(`draft: ${JSON.stringify(linhasDraft(draft))}`);

console.log(falhas.length ? falhas.slice(0, 20).map(f => `FALHOU: ${f}`).join('\n') : `ok (${casos} linhas iguais ao Python + 6 extras)`);
process.exit(falhas.length ? 1 : 0);
