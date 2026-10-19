// Guarda do guia de textos (docs/TEXTOS-DA-INTERFACE.md; relato do Gabriel de 15/10/2026 ~12:45: "só porque tu clicou [...] é
// muito imaturo para um app"). Varre os literais de string de pengu/** e painel/** (comentário, console.*, import e CSS ficam de
// fora) e falha se voltar o tom de chat: "tu/teu/tua" + verbo na 3ª pessoa, imperativo de "tu" ("clica", "tenta", "usa"…),
// "só porque", o app em 1ª pessoa ("não consegui", "não sei", "fechei", "abri o client"). Também prova frase() (comum.js): o
// aviso sai com maiúscula inicial. Textos da Riot copiados do trans.json e o vocabulário do registro das expansões são exceção.
// Desde 19/10/2026: nenhum literal do plugin com "coletor", "8765" ou "MCP" (o nome é "complemento coach"; INTERNOS abaixo).
// uso: node tools/teste-textos.mjs
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { relatar } from './lcu-falsa.mjs';
import { frase } from '../pengu/compacto/comum.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const BARRA = String.fromCharCode(92);
const pal = p => new RegExp(`(?<![\\p{L}\\w-])(?:${p})(?![\\p{L}\\w-])`, 'iu');
// imperativo de "tu" só no começo de oração (o mesmo verbo na 3ª pessoa é texto descritivo: "o Claude responde", "quem escolhe")
const ordem = p => new RegExp(`(?:^|[:;.(·]\\s*)(?:${p})(?![\\p{L}\\w-])`, 'iu');
// [nome, padrão]: cada um é uma regra do guia
const PROIBIDOS = [
  ['pronome "tu/teu/tua/ti" (use impessoal ou "você/seu")', pal('tu|teu|tua|teus|tuas|ti')],
  ['"clica/clicou" (use "clique")', pal('clica|clicou')],
  ['imperativo de "tu" (use "tente", "use", "escolha", "confira", "aguarde"…)', ordem('tenta|usa|escolhe|confere|responde|chama|espera as|cancela pelo|busca pelo|baixa pelo|aceita ou|abre o lobby|passa o mouse')],
  ['justificar o óbvio ("só porque…")', /só porque/iu],
  ['o app em 1ª pessoa (use "não foi possível…", "abrindo…")', /não consegui|não sei\b|não li\b|\bfechei\b|\babri\b|\bfui para\b|\bparei\b|\btento\b/iu],
  ['gíria ("pra", "dá para", "não deu")', pal('pra|dá para|não deu')],
];
// exceções conhecidas: [arquivo, trecho do literal]
const EXCECOES = [
  ['pengu/compacto/expansoes.js', 'suas teu tua'],            // VOCABULARIO do registro (palavras que a Riot pode usar)
  ['pengu/compacto/jogador-acoes.js', 'Conte pra gente'],   // texto da Riot (trans.json do formulário de denúncia)
];

// literais de string do arquivo -> [[linha, texto]]. Template com ${…}: o texto vira um literal só (cada expressão como "…") e o
// código de dentro da expressão é varrido também (template aninhado em template, como nas abas do pós-jogo, escapava antes)
function literais(arquivo) {
  const src = readFileSync(arquivo, 'utf8');
  const linhas = src.split('\n');
  const inicios = [0];
  for (let k = 0; k < src.length; k++) if (src[k] === '\n') inicios.push(k + 1);
  const linhaDe = pos => { let a = 0, b = inicios.length - 1; while (a < b) { const m = (a + b + 1) >> 1; if (inicios[m] <= pos) a = m; else b = m - 1; } return a + 1; };
  const out = [];
  // código a partir de i; fecha = para no "}" de profundidade 0 (fim de ${…}) e devolve o índice dele
  function codigo(i, fecha) {
    let prof = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); if (j < 0) return src.length; i = j + 2; continue; }
      if (c === "'" || c === '"' || c === '`') { i = texto(i); continue; }
      if (fecha && c === '{') prof++;
      else if (fecha && c === '}') { if (prof === 0) return i; prof--; }
      i++;
    }
    return i;
  }
  function texto(i) {
    const q = src[i], l0 = linhaDe(i);
    let j = i + 1, s = '';
    while (j < src.length && src[j] !== q) {
      if (src[j] === BARRA) { s += src[j] + src[j + 1]; j += 2; continue; }
      if (q === '`' && src[j] === '$' && src[j + 1] === '{') { j = codigo(j + 2, true) + 1; s += '…'; continue; }
      s += src[j]; j++;
    }
    const ctx = linhas[l0 - 1] || '';
    const css = s.length > 300 && /\{[^}]*:[^}]*;/.test(s); // bloco de CSS
    if (!/console\.|^\s*import /.test(ctx) && !css) out.push([l0, s]);
    return j + 1;
  }
  codigo(0, false);
  return out;
}

const arquivos = [];
const andar = p => { for (const n of readdirSync(p)) { const f = join(p, n); if (statSync(f).isDirectory()) andar(f); else if (/\.(js|html)$/.test(n)) arquivos.push(f); } };
andar(join(RAIZ, 'pengu'));
andar(join(RAIZ, 'painel'));

const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);
for (const [nome, re] of PROIBIDOS) {
  const achados = [];
  for (const f of arquivos) {
    const rel = relative(RAIZ, f).replaceAll(BARRA, '/');
    for (const [l, s] of literais(f)) {
      if (!re.test(s)) continue;
      if (EXCECOES.some(([a, t]) => a === rel && s.includes(t))) continue;
      achados.push(`${rel}:${l}: ${s.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }
  caso(`texto de interface sem ${nome}`, achados.length === 0, '\n  ' + achados.join('\n  '));
}
caso('varreu os arquivos do plugin e do painel', arquivos.length >= 30, String(arquivos.length));
// Fase 1 do plano plugin Pengu primeiro (19/10/2026): o nome do Python para o usuário é um termo só, "complemento coach"; "coletor",
// a porta 8765 e "MCP" nunca aparecem em texto visível do plugin (com ou sem o complemento). Ficam de fora os valores internos
// que nunca vão para a tela: [arquivo, literal exato | RegExp]
const INTERNOS = [
  ['pengu/coach.js', 'http://127.0.0.1:8765'], ['pengu/coach.js', 'lol-client-coletor'],
  ['pengu/config.js', 'coletor.ligado'], ['pengu/blocos.js', 'coletor.ligado'],
  ['pengu/compacto/tela-jogo.js', 'coletor'],      // textoTempo().fonte (valor interno; o texto da fonte é "complemento coach")
  ['pengu/posjogo/index.js', 'coletor'],           // ctxEstado das lições que vieram do complemento (abas.js ctxNota)
  ['pengu/compacto/expansoes.js', /^expansões: /], // log do registro das expansões (console, via log injetado)
  ['pengu/compacto/expansoes.js', /\bcoletor fora consegui\b/], // VOCABULARIO do registro (palavras que a Riot pode usar)
];
{
  const re = /coletor|8765|\bMCP\b/i;
  const achados = [];
  for (const f of arquivos) {
    const rel = relative(RAIZ, f).replaceAll(BARRA, '/');
    if (!rel.startsWith('pengu/')) continue;
    for (const [l, s] of literais(f)) {
      if (!re.test(s)) continue;
      if (INTERNOS.some(([a, t]) => a === rel && (t instanceof RegExp ? t.test(s) : s === t))) continue;
      achados.push(`${rel}:${l}: ${s.replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  }
  caso('texto de interface sem "coletor", "8765" nem "MCP" (o nome para o usuário é "complemento coach")', achados.length === 0, '\n  ' + achados.join('\n  '));
}
{
  // o varredor enxerga template dentro de ${…} (as abas do pós-jogo) e pula comentário e console
  const dir = mkdtempSync(join(tmpdir(), 'lc-textos-'));
  const f = join(dir, 'x.js');
  writeFileSync(f, "const a = `x ${b ? `tu pediu ${c}` : 'tento de novo'} y`; // tu\nconsole.log('não sei');\nconst d = { e: 1 };\n");
  const vistos = literais(f).map(([l, s]) => `${l}:${s}`);
  rmSync(dir, { recursive: true, force: true });
  caso('varredor: template aninhado vira literal próprio; comentário e console ficam de fora',
    ['1:x … y', '1:tu pediu …', '1:tento de novo'].every(v => vistos.includes(v)) && vistos.length === 3, JSON.stringify(vistos));
}
caso('frase(): maiúscula inicial, mesmo depois de símbolo ou emoji', frase('baixando o replay') === 'Baixando o replay' && frase('⛔ chat bloqueado') === '⛔ Chat bloqueado'
  && frase('replay: x') === 'Replay: x' && frase('Já ok') === 'Já ok' && frase('') === '' && frase(null) === '' && frase('ánimo') === 'Ánimo' && frase('3 derrotas') === '3 derrotas');
relatar(casos);
