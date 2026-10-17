// Testa os ícones Lucide do plugin (pengu/icones.js; etapa C de roadmap/2026-10-16-chat-da-sala-som-icones.md, pedido do Gabriel de
// 16/10/2026: "ícones lucide no lugar de emojis").
// O que segura: cada ícone nasce com os atributos do Lucide (currentColor, viewBox 24, decorativo para leitor de tela) e o nome do
// produto em data-icone; os dados embutidos só têm forma geométrica (nada de script, on*, href, style); o módulo não pede nada à rede
// e traz a licença ISC (e a MIT do Feather) no topo; só os ícones usados estão embutidos e todo nome usado existe; nenhum emoji ou
// glifo de ícone volta ao código do plugin fora das exceções nomeadas (dado do Gabriel e o vocabulário do registro das expansões).
// uso: node tools/teste-icones.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { relatar } from './lcu-falsa.mjs';
import { ICONES, icone, iconeHtml } from '../pengu/icones.js';
import { h, comIcone, icone as iconeComum } from '../pengu/compacto/comum.js';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);
const NS = 'http://www.w3.org/2000/svg';

// ---------- DOM mínimo (sem createElementNS, como o dos outros testes do compacto) ----------
class Texto { constructor(t) { this.nodeType = 3; this.data = String(t); } get textContent() { return this.data; } }
class El {
  constructor(tag, ns = null) { this.nodeType = 1; this.tagName = tag; this.ns = ns; this.attrs = new Map(); this.dataset = {}; this.childNodes = []; this.className = ''; this.ouvintes = {}; this.style = {}; }
  setAttribute(k, v) { if (k === 'class') this.className = String(v); this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  addEventListener(ev, fn) { (this.ouvintes[ev] ||= []).push(fn); }
  append(...ns) { for (const n of ns) { if (n === null || n === undefined) throw new Error('append(null)'); this.childNodes.push(typeof n === 'string' ? new Texto(n) : n); } }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
}
const docSemNS = { createElement: t => new El(t) };
const docComNS = { createElement: t => { throw new Error(`createElement(${t}) num SVG`); }, createElementNS: (ns, t) => new El(t, ns) };

// ---------- 1. construção ----------
const TAGS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);
const GEOM = new Set(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points']);
const VALOR = /^[0-9A-Za-z .,-]*$/;
const nomes = Object.keys(ICONES);
const ruins = [];
for (const n of nomes) {
  const s = icone(n, { doc: docSemNS });
  const a = k => s.getAttribute(k);
  const ok = s.tagName === 'svg' && a('viewBox') === '0 0 24 24' && a('fill') === 'none' && a('stroke') === 'currentColor' && a('stroke-width') === '2'
    && a('aria-hidden') === 'true' && a('focusable') === 'false' && a('width') === '16' && a('height') === '16' && s.dataset.icone === n
    && a('class') === `lc-ic lc-ic-${n}` && s.children.length === ICONES[n].partes.length && s.children.every((c, i) => c.tagName === ICONES[n].partes[i][0]);
  if (!ok) ruins.push(n);
}
caso(`os ${nomes.length} ícones nascem com os atributos do Lucide, decorativos e com data-icone (DOM sem createElementNS)`, nomes.length > 0 && !ruins.length, ruins.join(', '));
const comNS = icone('chat', { doc: docComNS });
caso('com createElementNS: raiz e formas no namespace do SVG', comNS.ns === NS && comNS.children.every(c => c.ns === NS));
const cheio = icone('honrar', { doc: docSemNS, cheio: true, tam: 1000 });
caso('cheio = preenchido com a cor do texto; tamanho limitado a 8..48 (1000 -> 48, lixo -> 16)',
  cheio.getAttribute('fill') === 'currentColor' && cheio.getAttribute('width') === '48' && icone('ok', { doc: docSemNS, tam: 'x' }).getAttribute('width') === '16');
const lanca = f => { try { f(); return false; } catch { return true; } };
caso('nome desconhecido lança (inclusive nome de protótipo), nunca devolve ícone vazio',
  lanca(() => icone('nada', { doc: docSemNS })) && lanca(() => icone('__proto__', { doc: docSemNS })) && lanca(() => icone('toString', { doc: docSemNS }))
    && lanca(() => iconeHtml('constructor')));
caso('classe extra só com letra, número, hífen e espaço (sem aspas nem <)', lanca(() => iconeHtml('ok', { classe: '"><script>' })) && !lanca(() => icone('ok', { doc: docSemNS, classe: 'lc-ic-antes' })));

// ---------- 2. dados: só geometria ----------
const fora = [];
for (const [n, ic] of Object.entries(ICONES)) {
  if (typeof ic.lucide !== 'string' || !/^[a-z0-9-]+$/.test(ic.lucide)) fora.push(`${n}: lucide`);
  for (const [t, attrs] of ic.partes) {
    if (!TAGS.has(t)) fora.push(`${n}: ${t}`);
    for (const [k, v] of Object.entries(attrs)) if (!GEOM.has(k) || !VALOR.test(v)) fora.push(`${n}: ${k}=${v}`);
  }
}
caso('dados embutidos: só path/circle/... com atributos geométricos e valores numéricos (nada de script, on*, href, style)', !fora.length, fora.join('; '));
const lucides = Object.values(ICONES).map(i => i.lucide);
caso('cada nome do produto aponta para um ícone diferente do Lucide', new Set(lucides).size === lucides.length);

// ---------- 3. string HTML (posjogo/index.js) ----------
const html = iconeHtml('fechar', { tam: 14 });
caso('iconeHtml: mesmo SVG em string, com data-icone e as formas do dado',
  /^<svg [^>]*viewBox="0 0 24 24"[^>]*>/.test(html) && html.includes('data-icone="fechar"') && html.includes('width="14"') && html.includes('d="M18 6 6 18"')
    && html.endsWith('</svg>') && !/<script|\son\w+=|href/i.test(html), html);

// ---------- 4. comum.js: comIcone e o reexport ----------
const docBt = { createElement: t => new El(t) };
const bt = h('button', { doc: docBt, title: 'x' }, comIcone('expandir', 'análise completa', { doc: docBt }));
caso('comIcone: ícone com a margem (lc-ic-antes) e o texto sem espaço na frente; o textContent é só o texto',
  bt.textContent === 'análise completa' && bt.children[0].dataset.icone === 'expandir' && /lc-ic-antes/.test(bt.children[0].getAttribute('class')) && iconeComum === icone);

// ---------- 5. o módulo: licença, nada de rede ----------
const fonte = readFileSync(join(RAIZ, 'pengu/icones.js'), 'utf8');
caso('icones.js abre com a licença ISC do Lucide e a MIT do Feather (ícones derivados)',
  fonte.startsWith('/*') && fonte.indexOf('ISC License') < fonte.indexOf('export') && fonte.includes('Copyright (c) 2026 Lucide Icons and Contributors')
    && fonte.includes('Copyright (c) 2013-present Cole Bemis') && fonte.includes('lucide-static 1.49.0'));
caso('icones.js não pede nada à rede: sem import, fetch, url( ou http fora do namespace e do comentário',
  !/^\s*import\s/m.test(fonte) && !/fetch\(|url\(|XMLHttpRequest|<script/i.test(fonte)
    && (fonte.match(/https?:\/\/[\w./-]+/g) || []).every(u => u === NS || u === 'https://lucide.dev'), fonte.match(/https?:\/\/[\w./-]+/g));

// ---------- 6. só os usados, e todo usado existe ----------
const arquivos = [];
const andar = p => { for (const n of readdirSync(p)) { const f = join(p, n); if (statSync(f).isDirectory()) andar(f); else if (/\.(js|css)$/.test(n)) arquivos.push(f); } };
andar(join(RAIZ, 'pengu'));
const codigo = new Map(arquivos.map(f => [relative(RAIZ, f).replace(/\\/g, '/'), readFileSync(f, 'utf8')]));
const semIcones = [...codigo].filter(([f]) => f !== 'pengu/icones.js').map(([, t]) => t).join('\n');
const naoUsados = nomes.filter(n => !semIcones.includes(`'${n}'`));
caso('só os ícones usados estão embutidos (cada nome aparece fora de icones.js)', !naoUsados.length, naoUsados.join(', '));
const chamados = [...semIcones.matchAll(/(?:icone|comIcone|iconeHtml)\(\s*'([^']+)'/g)].map(m => m[1]);
const faltam = [...new Set(chamados)].filter(n => !ICONES[n]);
caso(`todo icone('nome') com nome fixo no plugin existe (${new Set(chamados).size} nomes)`, chamados.length > 10 && !faltam.length, faltam.join(', '));

// ---------- 7. nenhum emoji/glifo de ícone de volta no código (fora de comentário) ----------
// setas: ↑ → ↓ (U+2191..2193) ficam livres (tipografia de número: PDL, "35 → 40"); ← e as outras setas contam como ícone. "×" também
// (era o "tirar da regra" das fichas de runa; revisão de 17/10/2026): só fica onde é o "contra" entre dois lados, nas exceções abaixo
const GLIFO = /[\u{1F000}-\u{1FFFF}☀-⟿⬀-⯿⌀-⏿⤀-⥿■-◿←↔-⇿×️＋]/u;
// exceções nomeadas: o vocabulário do registro das expansões (texto que vai ao coletor, fora desta etapa), os marcadores dos gráficos do
// painel do pós-jogo (marca de morte no SVG, setas de tendência, o ponto da lista de objetivos e o "← esta" da tabela: dado, não botão) e
// o "×" de "um contra o outro" (matchup do coach, placar da partida, objetivos do pós-jogo)
const EXCECOES = [
  ['pengu/estilo.css', "content: '●'"],
  ['pengu/compacto/index.js', "'painel ⚙: Configurações da Riot'"], ['pengu/compacto/index.js', "'botão ▣'"], ['pengu/compacto/index.js', "'botão ⤢'"],
  ['pengu/posjogo/abas.js', 'class="lc-g-morte">✕'], ['pengu/posjogo/abas.js', '▲ melhor'], ['pengu/posjogo/abas.js', '▼ pior'], ['pengu/posjogo/abas.js', '▬ na média'],
  ['pengu/posjogo/abas.js', "'← esta'"], ['pengu/posjogo/abas.js', '</span> × <span'],
  ['pengu/compacto/lateral-coach.js', "class: 'lc-lt-mudo' }, '×'"], ['pengu/compacto/tela-jogo.js', '${p.nosso} × ${p.deles}'],
];
const achados = [];
for (const [f, texto] of codigo) {
  if (f === 'pengu/icones.js') continue;
  texto.split(/\r?\n/).forEach((l, i) => {
    let c = l.replace(/\/\*.*?\*\//g, '');
    if (/^\s*(\*|\/\*)/.test(c)) return;
    c = c.replace(/(^|[^:'"`])\/\/.*$/, '$1');
    for (const [ef, et] of EXCECOES) if (ef === f) c = c.split(et).join('');
    if (GLIFO.test(c)) achados.push(`${f}:${i + 1}: ${l.trim().slice(0, 90)}`);
  });
}
caso('nenhum emoji ou glifo de ícone no código do plugin fora de comentário (ícone = pengu/icones.js)', !achados.length, achados.join('\n'));

relatar(casos);
