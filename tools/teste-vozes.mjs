// Prova do pacote de vozes no bloco Voz do lado do plugin (pengu/vozes.js e blocos.js blocoVoz; P5 de
// roadmap/2026-10-19-publicacao-e-complemento-publico.md). Nada aqui fala com o client, com o complemento de verdade nem com o
// GitHub: complemento falso (a função coletor da ponte, injetada), relógio falso e DOM falso.
//   (a) sem o recurso "voz-pacote": o bloco Voz fica só com as chaves de antes, nenhum pedido;
//   (b) com ele: 1 GET /voz/estado ao abrir (de novo só depois de CONSULTA_MS); "consultando" pergunta de novo em 2 s;
//       linha do estado (sem pacote: voz do Windows; instalado: Aoede, versão, falas; versão nova) e o rótulo do botão
//       ("baixar vozes (36 MB)", "atualizar vozes (36 MB)", nenhum em dia, com recusa, procurando ou sem pacote publicado);
//   (c) clique: POST /voz/baixar {} só; progresso "Baixando as vozes… 12 de 36 MB", "Conferindo…", "Instalando…"; o botão some
//       enquanto trabalha e o 2º clique não pede; "pronto" = "Vozes instaladas (versão …)"; o bloco pergunta de novo no fim;
//   (d) recusas e erros do complemento no texto do guia; 409 com outro download em curso acompanha; sem resposta; demora;
//   (e) guardas: nenhum fetch, window.open, href, eval, innerHTML nem endereço https no vozes.js.
// uso: node tools/teste-vozes.mjs
import { readFileSync } from 'node:fs';
import { relatar } from './lcu-falsa.mjs';

const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);
const flush = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

// ---------- DOM falso (o mesmo jeito do teste-atualizador.mjs) ----------
class Classes {
  constructor() { this.s = new Set(); }
  add(...c) { for (const x of c) this.s.add(x); }
  remove(...c) { for (const x of c) this.s.delete(x); }
  contains(c) { return this.s.has(c); }
  toggle(c, f) { const q = f === undefined ? !this.s.has(c) : !!f; if (q) this.s.add(c); else this.s.delete(c); return q; }
  toString() { return [...this.s].join(' '); }
}
class Texto { constructor(t) { this.nodeType = 3; this.data = String(t); this.parentNode = null; } get textContent() { return this.data; } remove() { if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1); this.parentNode = null; } }
class El {
  constructor(tag) {
    this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.parentNode = null; this.childNodes = [];
    this.classList = new Classes(); this.dataset = {}; this.attrs = new Map(); this.ouvintes = {}; this.style = {};
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.get(k) ?? null; }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  append(...ns) { for (let n of ns) { if (n == null) continue; if (typeof n !== 'object') n = new Texto(n); if (n.parentNode) n.remove(); n.parentNode = this; this.childNodes.push(n); } }
  appendChild(n) { this.append(n); return n; }
  remove() { if (this.parentNode) { const l = this.parentNode.childNodes; l.splice(l.indexOf(this), 1); } this.parentNode = null; }
  replaceChildren(...ns) { for (const n of [...this.childNodes]) n.parentNode = null; this.childNodes = []; this.append(...ns); }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this.replaceChildren(new Texto(v)); }
  addEventListener(ev, fn) { (this.ouvintes[ev] ||= []).push(fn); }
  removeEventListener() {}
  clicar() { for (const fn of this.ouvintes.click || []) fn({ isTrusted: true, target: this }); }
  *desc() { for (const n of this.children) { yield n; yield* n.desc(); } }
  querySelectorAll(sel) { const c = sel.replace(/^\./, ''); return [...this.desc()].filter(n => (sel.startsWith('.') ? n.classList.contains(c) : n.tagName === sel.toUpperCase())); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
const doc = { createElement: t => new El(t), createTextNode: t => new Texto(t) };
doc.documentElement = new El('html'); doc.body = new El('body'); doc.documentElement.append(doc.body);
globalThis.document = doc;
globalThis.window = { open: () => { throw new Error('window.open'); } };

const VZ = await import('../pengu/vozes.js');
const { blocoVoz } = await import('../pengu/blocos.js');
const { ui } = await import('../pengu/configuracoes.js');
const { TEXTO_SEM_RESPOSTA } = await import('../pengu/atualizador.js');
const botoes = n => n.querySelectorAll('lol-uikit-flat-button-secondary');
const explicas = n => n.querySelectorAll('.lc-explica').map(p => p.textContent);

function relogio() {
  const r = { agora: 0, fila: [] };
  r.agendar = (fn, ms) => { r.fila.push({ em: r.agora + ms, fn }); return r.fila.length; };
  r.passo = async () => { r.fila.sort((a, b) => a.em - b.em); const t = r.fila.shift(); if (!t) return false; r.agora = t.em; t.fn(); await flush(); return true; };
  r.andar = ms => { r.agora += ms; };
  return r;
}
// roda o relógio falso até o baixar() terminar (cada passo espera as promessas assentarem antes); ver(): a cada passo
async function correr(m, r, ver = () => {}) {
  for (let i = 0; i < 2000 && m.v.estado().trabalhando; i++) {
    await flush();
    ver();
    if (!m.v.estado().trabalhando) break;
    if (!(await r.passo())) await flush();
  }
}
const TAM = 36418377;
const D = (extra = {}) => ({ estado: 'parado', motivo: null, pacote: 'aoede', instalada: null, esperada: '76d3c16afdfb', acao: 'baixar',
  disponivel: { versao: '76d3c16afdfb', tag: 'v0.1.0', tamanho: TAM }, baixados: 0, total: null, ...extra });
const INST = { versao: '76d3c16afdfb', falas: 476, release: true };
// complemento falso: roteiro do GET /voz/estado (o último repete) e a resposta do POST
function complemento({ estados = [{ status: 200, dados: D() }], post = { status: 202, dados: D({ estado: 'baixando' }) }, recurso = true } = {}) {
  const c = { pedidos: [], estados: [...estados] };
  c.coletor = async (caminho, op = {}) => {
    c.pedidos.push({ caminho, metodo: op.metodo || 'GET', corpo: op.corpo });
    if (caminho === '/voz/baixar') return post;
    const prox = c.estados.length > 1 ? c.estados.shift() : c.estados[0];
    return prox || { status: 0, dados: null };
  };
  c.temRecurso = n => recurso && n === 'voz-pacote';
  return c;
}
const ctx = () => ({ cfg: { coach: { voz: true, tomVoz: 'serio', cortarFalaRepetida: true } }, definir: () => {}, ui });
function montar(c, r = relogio()) {
  let pinturas = 0;
  const v = VZ.criarVozes({ coletor: c.coletor, temRecurso: c.temRecurso, agendar: r.agendar, agora: () => r.agora, aoMudar: () => { pinturas++; } });
  const pintar = () => { const corpo = new El('div'); blocoVoz(corpo, ctx(), v); return corpo; };
  return { v, r, pintar, pinturas: () => pinturas };
}

// ---------- (a) sem o recurso ----------
{
  const c = complemento({ recurso: false });
  const m = montar(c);
  const corpo = m.pintar();
  await flush();
  const antes = new El('div');
  blocoVoz(antes, ctx());
  caso('(a) sem voz-pacote: o bloco Voz fica igual ao de antes (sem linha nem botão do pacote)', corpo.textContent === antes.textContent
    && !botoes(corpo).length, corpo.textContent);
  caso('(a) sem voz-pacote: nenhum pedido ao complemento', c.pedidos.length === 0, JSON.stringify(c.pedidos));
  await m.v.baixar();
  caso('(a) sem voz-pacote: baixar() não pede nada', c.pedidos.length === 0, JSON.stringify(c.pedidos));
}

// ---------- (b) estado e rótulo ----------
{
  const c = complemento();
  const m = montar(c);
  let corpo = m.pintar();
  caso('(b) 1ª pintura: "Consultando o pacote de vozes…" e 1 GET /voz/estado', explicas(corpo).includes(VZ.TEXTO_CONSULTANDO)
    && c.pedidos.length === 1 && c.pedidos[0].caminho === '/voz/estado' && c.pedidos[0].metodo === 'GET', JSON.stringify(c.pedidos));
  await flush();
  caso('(b) a resposta repinta (aoMudar)', m.pinturas() >= 1, m.pinturas());
  corpo = m.pintar();
  caso('(b) sem pacote: voz Maria do Windows e o botão "baixar vozes (36 MB)"', explicas(corpo).includes('Sem o pacote de vozes Aoede: os avisos saem na voz Maria do Windows.')
    && botoes(corpo).map(b => b.textContent).join() === 'baixar vozes (36 MB)', corpo.textContent);
  m.pintar(); m.pintar();
  caso('(b) repintar antes de 30 s não pergunta de novo', c.pedidos.length === 1, c.pedidos.length);
  m.r.andar(VZ.CONSULTA_MS);
  m.pintar();
  caso('(b) depois de 30 s, 1 GET a mais', c.pedidos.length === 2, c.pedidos.length);
}
{
  const c = complemento({ estados: [{ status: 200, dados: D({ estado: 'consultando', disponivel: null }) }, { status: 200, dados: D() }] });
  const m = montar(c);
  m.pintar();
  await flush();
  let corpo = m.pintar();
  caso('(b) complemento consultando o release: "Procurando o pacote desta versão…" e nenhum botão ainda',
    explicas(corpo).some(t => t.endsWith('Procurando o pacote desta versão…')) && !botoes(corpo).length, corpo.textContent);
  await m.r.passo();
  corpo = m.pintar();
  await flush();
  corpo = m.pintar();
  caso('(b) 2 s depois pergunta de novo e o botão aparece com o tamanho', c.pedidos.length === 2
    && botoes(corpo).map(b => b.textContent).join() === 'baixar vozes (36 MB)', [c.pedidos.length, corpo.textContent]);
}
const linha = d => VZ.textoEstado(d);
caso('(b) instalado em dia: Aoede, versão e falas; nenhum botão', linha(D({ instalada: INST, acao: 'nada' }))
  === 'Pacote de vozes Aoede instalado (versão 76d3c16afdfb, 476 falas).' && VZ.rotuloBotao(D({ instalada: INST, acao: 'nada' })) === null);
caso('(b) pacote velho: versão nova na linha e "atualizar vozes (36 MB)"',
  linha(D({ instalada: { ...INST, versao: 'aaaaaaaaaaaa' }, acao: 'atualizar' })) === 'Pacote de vozes Aoede instalado (versão aaaaaaaaaaaa, 476 falas). Versão nova do pacote: 76d3c16afdfb.'
  && VZ.rotuloBotao(D({ instalada: { ...INST, versao: 'aaaaaaaaaaaa' }, acao: 'atualizar' })) === 'atualizar vozes (36 MB)');
caso('(b) pacote desta versão não publicado: a linha diz e nenhum botão', linha(D({ disponivel: null, motivo: 'release' })).endsWith('O pacote desta versão ainda não foi publicado.')
  && VZ.rotuloBotao(D({ disponivel: null, motivo: 'release' })) === null);
caso('(b) consulta do release que falhou na rede: botão sem tamanho (o clique tenta de novo)', VZ.rotuloBotao(D({ disponivel: null, motivo: 'rede' })) === 'baixar vozes');
caso('(b) instalação de desenvolvimento / pacote gerado aqui (acao nada): linha do pacote e nenhum botão',
  VZ.rotuloBotao(D({ instalada: { ...INST, release: false }, acao: 'nada', recusa: 'gerado-aqui' })) === null
  && linha(D({ instalada: { ...INST, release: false }, acao: 'nada' })) === 'Pacote de vozes Aoede instalado (versão 76d3c16afdfb, 476 falas).');
caso('(b) versão e nome tortos do complemento não vão para a tela', linha(D({ pacote: '<img>', instalada: { versao: '<b>x</b>', falas: 'a' }, acao: 'nada' }))
  === 'Pacote de vozes Aoede instalado (versão ?, 0 falas).');
caso('(b) mb(): 36418377 -> "36 MB", 300 KB -> "1 MB"', VZ.mb(TAM) === '36 MB' && VZ.mb(300000) === '1 MB');

// ---------- (c) clique ----------
{
  const r = relogio();
  const c = complemento({ estados: [
    { status: 200, dados: D() },
    { status: 200, dados: D({ estado: 'baixando', baixados: 12e6, total: TAM }) },
    { status: 200, dados: D({ estado: 'conferindo', baixados: TAM, total: TAM }) },
    { status: 200, dados: D({ estado: 'trocando' }) },
    { status: 200, dados: D({ estado: 'pronto', instalada: INST, acao: 'nada' }) },
  ] });
  const m = montar(c, r);
  m.pintar();
  await flush();
  const progresso = [];
  let corpo = m.pintar();
  botoes(corpo)[0].clicar();
  await flush();
  corpo = m.pintar();
  progresso.push(m.v.estado().progresso);
  caso('(c) POST /voz/baixar com corpo {} só', c.pedidos.filter(p => p.metodo === 'POST').length === 1
    && JSON.stringify(c.pedidos.find(p => p.metodo === 'POST').corpo) === '{}' && c.pedidos.find(p => p.metodo === 'POST').caminho === '/voz/baixar',
  JSON.stringify(c.pedidos));
  caso('(c) trabalhando: o botão some e a linha mostra o progresso', !botoes(corpo).length && explicas(corpo).some(t => t.startsWith('Baixando as vozes…')), corpo.textContent);
  await m.v.baixar();
  caso('(c) 2º clique enquanto trabalha não pede de novo', c.pedidos.filter(p => p.metodo === 'POST').length === 1);
  await correr(m, r, () => progresso.push(m.v.estado().progresso));
  await flush();
  caso('(c) progresso na ordem: "Baixando as vozes… 12 de 36 MB", "Conferindo as vozes…", "Instalando as vozes…"',
    progresso.includes('Baixando as vozes… 12 de 36 MB') && progresso.indexOf('Conferindo as vozes…') > progresso.indexOf('Baixando as vozes… 12 de 36 MB')
    && progresso.indexOf('Instalando as vozes…') > progresso.indexOf('Conferindo as vozes…'), JSON.stringify(progresso));
  caso('(c) fim: "Vozes instaladas (versão 76d3c16afdfb): valem a partir da próxima partida."',
    m.v.estado().mensagem === 'Vozes instaladas (versão 76d3c16afdfb): valem a partir da próxima partida.', m.v.estado().mensagem);
  const n = c.pedidos.length;
  corpo = m.pintar();
  caso('(c) no fim o bloco pergunta de novo (mostra o pacote novo) e mostra a mensagem', c.pedidos.length === n + 1
    && explicas(corpo).includes('Vozes instaladas (versão 76d3c16afdfb): valem a partir da próxima partida.'), [c.pedidos.length - n, corpo.textContent]);
  caso('(c) consultas do progresso a cada 1 s', c.pedidos.filter(p => p.caminho === '/voz/estado').length >= 4);
}

// ---------- (d) recusas, erros, 409, sem resposta, demora ----------
for (const [motivo, texto] of Object.entries(VZ.TEXTOS)) {
  const estado = ['partida', 'desenvolvimento', 'gerado-aqui', 'em-dia', 'versao'].includes(motivo) ? 'recusado' : 'erro';
  const c = complemento({ post: { status: estado === 'recusado' ? 409 : 202, dados: D({ estado: estado === 'recusado' ? 'recusado' : 'baixando', motivo }) },
    estados: [{ status: 200, dados: D({ estado, motivo }) }] });
  const r = relogio();
  const m = montar(c, r);
  const p = m.v.baixar();
  await correr(m, r);
  const fim = await p;
  caso(`(d) ${estado} ${motivo}: "${texto}"`, fim === texto, fim);
}
{
  const c = complemento({ post: { status: 409, dados: D({ estado: 'baixando', baixados: 1e6, total: TAM }) },
    estados: [{ status: 200, dados: D({ estado: 'trocando' }) }, { status: 200, dados: D({ estado: 'pronto', instalada: INST }) }] });
  const r = relogio();
  const m = montar(c, r);
  const p = m.v.baixar();
  await correr(m, r);
  caso('(d) 409 com outro download em curso: acompanha até o fim', (await p).startsWith('Vozes instaladas'), m.v.estado());
}
{
  const c = complemento({ post: { status: 0, dados: null } });
  const m = montar(c);
  caso('(d) POST sem resposta: "Complemento coach sem resposta…"', await m.v.baixar() === TEXTO_SEM_RESPOSTA);
  const c2 = complemento({ estados: [{ status: 0, dados: null }] });
  const r = relogio();
  const m2 = montar(c2, r);
  const p = m2.v.baixar();
  await correr(m2, r);
  caso('(d) 15 consultas seguidas sem resposta: "Complemento coach sem resposta…"', await p === TEXTO_SEM_RESPOSTA
    && c2.pedidos.filter(x => x.caminho === '/voz/estado').length === VZ.SEM_RESPOSTA_MAX, c2.pedidos.length);
  const c3 = complemento({ estados: [{ status: 200, dados: D({ estado: 'baixando', baixados: 1, total: TAM }) }] });
  const r3 = relogio();
  const m3 = montar(c3, r3);
  const p3 = m3.v.baixar();
  await correr(m3, r3);
  caso('(d) mais de 15 min baixando: "O download das vozes ainda não terminou…"', await p3 === VZ.TEXTO_DEMORA);
  caso('(d) troca que falha na 1ª instalação (troca-nova): diz que a voz segue a do Windows, sem citar pacote anterior',
    VZ.traduzir(D({ estado: 'erro', motivo: 'troca-nova' })) === 'Não foi possível instalar as vozes: os avisos seguem na voz Maria do Windows.',
    VZ.traduzir(D({ estado: 'erro', motivo: 'troca-nova' })));
  caso('(d) "parado" com a versão do código instalada do release = sucesso (o pronto passou sem ser lido)',
    VZ.traduzir(D({ estado: 'parado', instalada: INST })).startsWith('Vozes instaladas') && VZ.traduzir(D({ estado: 'parado' })) === VZ.TEXTO_FALHA);
}

// ---------- (e) guardas ----------
{
  const s = readFileSync(new URL('../pengu/vozes.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  caso('(e) vozes.js: sem fetch, window.open, href, eval, new Function, innerHTML nem endereço https',
    !/\bfetch\s*\(|window\.open|\bhref\b|\beval\s*\(|new Function|innerHTML|https?:\/\//.test(s));
}

relatar(casos);
