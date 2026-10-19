// Prova do botão "atualizar" do lado do plugin (pengu/atualizador.js e a linha de pengu/atualizacao.js; P3 de
// roadmap/2026-10-19-publicacao-e-complemento-publico.md). Nada aqui fala com o client, com o complemento de verdade nem com o
// GitHub: complemento falso (a função coletor da ponte, injetada), relógio falso e DOM falso.
//   (a) sem o complemento (sem o recurso "atualizar"): nenhum pedido; a linha diz o caminho do atualizar.cmd e mostra o endereço
//       da página da versão com "copiar link" (área de transferência falsa: "Link copiado." / falha); nada abre (window.open);
//   (b) com o complemento: POST /atualizar só com {versao}; progresso "Baixando…", "Conferindo…", "Instalando…" na linha;
//       "atualizar" some enquanto trabalha (2º clique não chama de novo); "pronto" = "Atualizado para a versão x." com
//       "recarregar agora";
//   (c) recarregar só em None/Lobby e por clique (fase lida na hora); fora: "Recarregue na tela inicial ou no lobby.";
//   (d) fora de None/Lobby nem pede ao complemento; recusas e erros do complemento viram o texto do guia (desenvolvimento, hash…);
//       409 com outra troca em curso acompanha até o fim; sem resposta e demora;
//   (e) guardas: nenhum window.open, <a href>, eval, new Function nem import de URL no código da atualização; link só github.com.
// uso: node tools/teste-atualizador.mjs
import { readFileSync } from 'node:fs';
import { relatar } from './lcu-falsa.mjs';

const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

// ---------- DOM falso (o mesmo jeito do teste-atualizacao.mjs) ----------
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
    let html = '';
    Object.defineProperty(this, 'innerHTML', { get: () => html, set: v => { html = String(v); this.htmlUsado = true; } });
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
// window.open espião: nada da atualização pode chamar
const abertos = [];
globalThis.window = { open: (...a) => { abertos.push(a); return null; } };

const A = await import('../pengu/atualizacao.js');
const AT = await import('../pengu/atualizador.js');
const { REPO } = await import('../pengu/versao.js');
const botoes = n => n.querySelectorAll('lol-uikit-flat-button-secondary');
const porTexto = (n, t) => botoes(n).find(b => b.textContent === t);
const ui = { explica: t => { const p = new El('p'); p.className = 'lc-explica'; p.textContent = t; return p; } };

// relógio falso só para o laço do atualizador (o verificador não agenda nada que importe aqui)
function relogio() {
  const r = { agora: 0, fila: [] };
  r.agendar = (fn, ms) => { r.fila.push({ em: r.agora + ms, fn }); return r.fila.length; };
  r.passo = async () => { r.fila.sort((a, b) => a.em - b.em); const t = r.fila.shift(); if (!t) return false; r.agora = t.em; t.fn(); await flush(); return true; };
  return r;
}
// verificador com a versão 0.2.0 já vista (DataStore falso), fase controlável
function montar({ fase = 'None', faseLida } = {}) {
  const ds = new Map([[A.CHAVE_ATUALIZACAO, { repo: REPO, em: 1, okEm: 1, versao: '0.2.0', tag: 'v0.2.0', corpo: '' }]]);
  const est = { fase, faseLida: faseLida ?? fase, recargas: 0, copiados: [], copiarOk: true };
  const v = A.criarVerificador({ cfg: { atualizacao: { verificar: true } }, versao: '0.1.0', repo: REPO, f: async () => ({ status: 404 }),
    agendar: () => 0, cancelar: () => {}, ds: { get: k => ds.get(k) ?? null, set: (k, x) => ds.set(k, x) }, lerFase: async () => est.faseLida,
    log: () => {}, recarregarPagina: () => { est.recargas++; }, copiar: async t => { est.copiados.push(t); return est.copiarOk; } });
  v.aoFase(fase);
  return { v, est };
}
// complemento falso: roteiro de estados devolvidos pelo GET /atualizar/estado
function complemento({ post = { status: 202, dados: { estado: 'baixando', versao: '0.2.0' } }, estados = [], recurso = true } = {}) {
  const c = { pedidos: [], estados: [...estados] };
  c.coletor = async (caminho, op = {}) => {
    c.pedidos.push({ caminho, metodo: op.metodo || 'GET', corpo: op.corpo });
    if (caminho === '/atualizar') return post;
    const prox = c.estados.length > 1 ? c.estados.shift() : c.estados[0];
    return prox || { status: 0, dados: null };
  };
  c.temRecurso = n => recurso && n === 'atualizar';
  return c;
}
const st = (estado, extra = {}) => ({ status: 200, dados: { estado, versao: '0.2.0', instalada: '0.1.0', ...extra } });

// ---------- (a) sem o complemento ----------
{
  const m = montar();
  const c = complemento({ recurso: false });
  m.v.registrarAtualizador(AT.criarAtualizador({ coletor: c.coletor, temRecurso: c.temRecurso, pasta: 'lol-ultra-client' }));
  porTexto(A.linhaVersaoNova(ui, m.v), 'atualizar').clicar();
  await flush();
  const linha = A.linhaVersaoNova(ui, m.v);
  const txt = linha.textContent;
  caso('(a) sem o complemento: nenhum pedido ao complemento', c.pedidos.length === 0, JSON.stringify(c.pedidos));
  caso('(a) a linha diz o caminho do atualizar.cmd (plugins\\lol-ultra-client do Pengu Loader) e reiniciar o client',
    txt.includes('abra o atualizar.cmd da pasta plugins\\lol-ultra-client do Pengu Loader e depois reinicie o client'), txt);
  const link = linha.querySelector('.lc-versao-link');
  caso('(a) endereço da página da versão como texto selecionável', link?.textContent === `https://github.com/${REPO}/releases/tag/v0.2.0`, link?.textContent);
  caso('(a) "copiar link" presente, "atualizar" segue (pode tentar de novo)', !!porTexto(linha, 'copiar link') && !!porTexto(linha, 'atualizar'));
  porTexto(linha, 'copiar link').clicar(); await flush();
  caso('(a) "copiar link" copia o endereço e diz "Link copiado."', m.est.copiados.length === 1 && m.est.copiados[0] === link.textContent
    && A.linhaVersaoNova(ui, m.v).textContent.includes('Link copiado.'), JSON.stringify(m.est.copiados));
  m.est.copiarOk = false;
  porTexto(A.linhaVersaoNova(ui, m.v), 'copiar link').clicar(); await flush();
  caso('(a) cópia negada: "Não foi possível copiar: selecione o endereço acima."', A.linhaVersaoNova(ui, m.v).textContent.includes('Não foi possível copiar: selecione o endereço acima.'));
  caso('(a) nada abriu (window.open nunca chamado)', abertos.length === 0, abertos.length);
  caso('(a) pasta do plugin pela URL do Pengu (https://plugins/<pasta>/…); fora do client, o nome do pacote',
    AT.pastaDoPlugin('https://plugins/meu-client/atualizador.js') === 'meu-client' && AT.pastaDoPlugin('file:///C:/x/pengu/atualizador.js') === 'lol-ultra-client'
    && AT.pastaDoPlugin('https://plugins/..%2F..%2Fx/a.js') === 'lol-ultra-client');
}

// ---------- (b) com o complemento ----------
{
  const m = montar({ fase: 'Lobby' });
  const r = relogio();
  const c = complemento({ estados: [st('baixando'), st('conferindo'), st('trocando'), st('pronto', { reiniciar: true })] });
  m.v.registrarAtualizador(AT.criarAtualizador({ coletor: c.coletor, temRecurso: c.temRecurso, agendar: r.agendar, agora: () => r.agora }));
  const vistos = [];
  m.v.aoMudar(() => { const l = A.linhaVersaoNova(ui, m.v); vistos.push({ txt: l?.textContent || '', atualizar: !!(l && porTexto(l, 'atualizar')) }); });
  porTexto(A.linhaVersaoNova(ui, m.v), 'atualizar').clicar();
  await flush();
  const durante = A.linhaVersaoNova(ui, m.v);
  caso('(b) POST /atualizar só com {versao}', c.pedidos[0]?.caminho === '/atualizar' && c.pedidos[0].metodo === 'POST'
    && JSON.stringify(c.pedidos[0].corpo) === JSON.stringify({ versao: '0.2.0' }), JSON.stringify(c.pedidos[0]));
  caso('(b) "atualizar" some enquanto trabalha; "Baixando a versão 0.2.0…" na linha', !porTexto(durante, 'atualizar')
    && durante.textContent.includes('Baixando a versão 0.2.0…') && m.v.estado().atualizando, durante.textContent);
  const antes = c.pedidos.length;
  await m.v.atualizar();   // 2º clique (pelo estado: o botão nem existe)
  caso('(b) 2º "atualizar" com a troca em curso: nada novo', c.pedidos.length === antes);
  for (let i = 0; i < 10 && await r.passo(); i++) { /* laço do atualizador */ }
  await flush();
  const fim = A.linhaVersaoNova(ui, m.v);
  const textos = vistos.map(x => x.txt);
  const ordem = ['Baixando a versão 0.2.0…', 'Conferindo os arquivos…', 'Instalando…', 'Atualizado para a versão 0.2.0.'].map(t => textos.findIndex(x => x.includes(t)));
  caso('(b) progresso na ordem: Baixando… → Conferindo os arquivos… → Instalando… → Atualizado para a versão 0.2.0.',
    ordem.every(i => i >= 0) && ordem.every((i, k) => k === 0 || i > ordem[k - 1]), JSON.stringify(ordem));
  caso('(b) pronto: "Atualizado para a versão 0.2.0." com "recarregar agora", sem "atualizar"', fim.textContent.includes('Atualizado para a versão 0.2.0.')
    && !!porTexto(fim, 'recarregar agora') && !porTexto(fim, 'atualizar') && !m.v.estado().atualizando, fim.textContent);
  caso('(b) GET /atualizar/estado a cada PASSO_MS (4 consultas), nenhum outro POST', c.pedidos.filter(p => p.caminho === '/atualizar/estado').length === 4
    && c.pedidos.filter(p => p.metodo === 'POST').length === 1 && r.agora === 4 * AT.PASSO_MS, JSON.stringify(c.pedidos.map(p => p.caminho)));
  caso('(b) nada recarregou sozinho', m.est.recargas === 0);

  // ---------- (c) recarregar só em None/Lobby, por clique ----------
  m.est.faseLida = 'ChampSelect';
  porTexto(fim, 'recarregar agora').clicar(); await flush();
  const fora = A.linhaVersaoNova(ui, m.v);
  caso('(c) "recarregar agora" em ChampSelect (fase lida na hora): não recarrega, "Recarregue na tela inicial ou no lobby.", o botão fica',
    m.est.recargas === 0 && fora.textContent.includes('Recarregue na tela inicial ou no lobby.') && !!porTexto(fora, 'recarregar agora'), fora.textContent);
  for (const f of ['Matchmaking', 'ReadyCheck', 'InProgress', 'EndOfGame']) {
    m.est.faseLida = f;
    await m.v.recarregar();
  }
  caso('(c) Matchmaking, ReadyCheck, InProgress, EndOfGame (lidas na hora, com o socket dizendo Lobby): nenhuma recarga', m.est.recargas === 0);
  m.est.faseLida = null;      // leitura falhou: vale a fase do socket
  m.v.aoFase('InProgress');
  await m.v.recarregar();
  caso('(c) leitura da fase falhou e o socket diz InProgress: nenhuma recarga', m.est.recargas === 0);
  m.v.aoFase('Lobby');
  m.est.faseLida = 'Lobby';
  porTexto(fora, 'recarregar agora').clicar(); await flush();
  caso('(c) no Lobby, pelo clique: recarrega 1 vez', m.est.recargas === 1);
  m.est.faseLida = 'None';
  await m.v.recarregar();
  caso('(c) em None: recarrega', m.est.recargas === 2);
}

// ---------- (d) fase, recusas e erros ----------
async function executar({ fase = 'None', post, estados, passos = 40 } = {}) {
  const m = montar({ fase });
  const r = relogio();
  const c = complemento({ post, estados });
  m.v.registrarAtualizador(AT.criarAtualizador({ coletor: c.coletor, temRecurso: c.temRecurso, agendar: r.agendar, agora: () => r.agora }));
  let acabou = false;
  const p = m.v.atualizar().then(x => { acabou = true; return x; });
  for (let i = 0; i < passos * 2 && !acabou; i++) { await flush(); await r.passo(); }
  await p; await flush();
  return { m, c, r, txt: A.linhaVersaoNova(ui, m.v).textContent, linha: A.linhaVersaoNova(ui, m.v) };
}
{
  for (const f of ['Matchmaking', 'ReadyCheck', 'ChampSelect', 'InProgress', 'EndOfGame']) {
    const x = await executar({ fase: f });
    caso(`(d) fase ${f}: nenhum pedido ao complemento, "Atualize na tela inicial ou no lobby."`, x.c.pedidos.length === 0 && x.txt.includes('Atualize na tela inicial ou no lobby.'), x.txt);
  }
  const recusas = [
    ['desenvolvimento', 'Instalação de desenvolvimento'], ['sem-plugin', 'plugins\\lol-ultra-client do Pengu Loader não encontrada'],
    ['partida', 'Atualize na tela inicial ou no lobby.'], ['versao', 'não é mais nova que a instalada'],
  ];
  for (const [motivo, trecho] of recusas) {
    const x = await executar({ post: { status: 409, dados: { estado: 'recusado', motivo } } });
    caso(`(d) recusa '${motivo}': "${trecho}…", "atualizar" volta, sem consultar o estado`, x.txt.includes(trecho) && !!porTexto(x.linha, 'atualizar')
      && x.c.pedidos.length === 1, x.txt);
  }
  const erros = [['hash', 'não conferem com o release: nada foi trocado'], ['origem', 'não vieram do endereço oficial'], ['pacote', 'está incompleto'],
    ['rede', 'Não foi possível baixar a versão 0.2.0'], ['release', 'não encontrada no GitHub'], ['troca', 'a versão anterior continua instalada'],
    ['qualquer-outro', 'Não foi possível atualizar agora']];
  for (const [motivo, trecho] of erros) {
    const x = await executar({ estados: [st('baixando'), st('erro', { motivo })] });
    caso(`(d) erro '${motivo}': "${trecho}…"`, x.txt.includes(trecho) && !porTexto(x.linha, 'recarregar agora'), x.txt);
  }
  const inc = await executar({ estados: [st('trocando'), st('erro', { motivo: 'troca-incompleta' })] });
  caso('(d) troca incompleta: o texto e o endereço da página da versão para instalar à mão', inc.txt.includes('parou no meio')
    && inc.linha.querySelector('.lc-versao-link')?.textContent === `https://github.com/${REPO}/releases/tag/v0.2.0`, inc.txt);
  const outra = await executar({ post: { status: 409, dados: { estado: 'conferindo', versao: '0.2.0' } }, estados: [st('trocando'), st('pronto')] });
  caso('(d) 409 com outra troca em curso: acompanha até "Atualizado"', outra.txt.includes('Atualizado para a versão 0.2.0.'), outra.txt);
  // revisão adversarial da P3: o 'pronto' segurado passou sem ser lido (timer do CEF atrasado) e a instância nova responde
  // 'parado' com a versão nova instalada: é sucesso, não falha
  const sucessora = await executar({ estados: [st('trocando'), { status: 0, dados: null }, { status: 0, dados: null },
    st('parado', { versao: null, instalada: '0.2.0' })] });
  caso('(d) "pronto" perdido e a instância nova "parado" com a 0.2.0 instalada: "Atualizado para a versão 0.2.0." com "recarregar agora"',
    sucessora.txt.includes('Atualizado para a versão 0.2.0.') && !!porTexto(sucessora.linha, 'recarregar agora'), sucessora.txt);
  const jaNova = await executar({ post: { status: 409, dados: { estado: 'recusado', motivo: 'versao', instalada: '0.2.0' } } });
  caso('(d) clique de novo com a 0.2.0 já instalada (recusa "versao"): "Atualizado para a versão 0.2.0." com "recarregar agora"',
    jaNova.txt.includes('Atualizado para a versão 0.2.0.') && !!porTexto(jaNova.linha, 'recarregar agora'), jaNova.txt);
  const parada = await executar({ estados: [st('trocando'), st('parado', { versao: null })] });
  caso('(d) "parado" com a versão velha instalada segue sendo falha', parada.txt.includes('Não foi possível atualizar agora')
    && !porTexto(parada.linha, 'recarregar agora'), parada.txt);
  const mudo = await executar({ post: { status: 0, dados: null } });
  caso('(d) POST sem resposta: "Complemento coach sem resposta: tente de novo mais tarde."', mudo.txt.includes('Complemento coach sem resposta'), mudo.txt);
  const caiu = await executar({ estados: [{ status: 0, dados: null }] });
  caso(`(d) complemento caiu no meio: desiste depois de ${AT.SEM_RESPOSTA_MAX} consultas sem resposta`, caiu.txt.includes('Complemento coach sem resposta')
    && caiu.c.pedidos.filter(p => p.caminho === '/atualizar/estado').length === AT.SEM_RESPOSTA_MAX, caiu.c.pedidos.length);
  const lento = await executar({ estados: [st('baixando')], passos: AT.PRAZO_TOTAL_MS / AT.PASSO_MS + 5 });
  caso('(d) baixando para sempre: para no prazo total com "A atualização ainda não terminou…"', lento.txt.includes('A atualização ainda não terminou')
    && lento.r.agora <= AT.PRAZO_TOTAL_MS + AT.PASSO_MS, lento.r.agora);
  // texto vindo do complemento nunca vira link nem HTML: o link só aceita https://github.com/
  const m = montar();
  m.v.registrarAtualizador(async () => ({ texto: 'x', link: 'javascript:alert(1)' }));
  await m.v.atualizar();
  caso('(d) link fora de https://github.com/ é descartado', !A.linhaVersaoNova(ui, m.v).querySelector('.lc-versao-link'));
}

// ---------- (e) guardas no código ----------
{
  const src = ['pengu/atualizador.js', 'pengu/atualizacao.js'].map(f => [f, readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')]);
  const semComentario = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const [f, s] of src) {
    const c = semComentario(s);
    caso(`(e) ${f}: sem window.open, <a, href, eval, new Function nem import() de URL`, !/window\.open|<a[\s>]|\bhref\b|\beval\s*\(|new Function|import\s*\(\s*['"`]https?:/.test(c));
    caso(`(e) ${f}: sem innerHTML`, !/innerHTML/.test(c));
  }
}

relatar(casos);
