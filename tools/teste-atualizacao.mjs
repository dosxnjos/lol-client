// Prova do aviso de versão nova (pengu/atualizacao.js; P2 de roadmap/2026-10-19-publicacao-e-complemento-publico.md).
// Nada aqui fala com a api.github.com nem com o client: fetch espião com relógio falso (parte 1), DOM falso (parte 2) e, na parte 3,
// um servidor HTTP falso local na porta 0 (o fetch de verdade do node, com o prazo de 5 s medido no relógio de verdade).
//   (a) 1 consulta por dia em 3 dias de fases variadas e laço de 1 h; cada consulta em None/Lobby e com 24 h ou mais da anterior;
//   (b) chave desligada: zero consulta em 3 dias; ligar a chave consulta na hora (dia vencido, fase None);
//   (c) REPO vazio ou fora de dono/nome: zero fetch, nem no "procurar agora";
//   (d) fora de None/Lobby (fila, seleção, partida, pós-jogo): zero consulta automática; "procurar agora" consulta (clique dele);
//   (e) comparação de versão (1.10.0 > 1.9.3, v0.1.1 > 0.1.0, pré-lançamento e texto inválidos);
//   (f) 404, 403, 500, rede, prazo e resposta malformada: calados (nenhum log, nenhum aviso), só a hora da tentativa anotada;
//   (g) versão nova: aviso, log uma vez, DataStore só {repo, em, okEm, versao, tag, corpo}, corpo cortado; recarga mantém o aviso
//       sem consultar de novo no mesmo dia;
//   (h) linha da ⚙: corpo do release só como texto (HTML plantado vira texto, zero elemento), "atualizar" sem atualizador diz
//       onde baixar, com atualizador (P3) chama ele com {versao, tag, repo}; bloco Atualizações; a linha no topo do painel do
//       client e da ⚙ do compacto; o ponto no ⚙ do compacto (classe lc-versao-nova no <html>);
//   (i) PADRAO e mescla: atualizacao.verificar nasce ligado, inclusive na config salva antes da chave existir;
//   (o) window.open espião no arquivo inteiro: nenhuma chamada na carga, nas consultas (dia, laço, fases, erro, "procurar agora"),
//       nas telas nem no "atualizar" sem atualizador ("abrir página" é só do clique dele: tools/teste-atualizador.mjs (f)).
// uso: node tools/teste-atualizacao.mjs
import { createServer } from 'node:http';
import { relatar } from './lcu-falsa.mjs';

// window.open espião antes de importar o módulo (como no client, devolve null)
const abertos = [];
globalThis.window = { open: (...a) => { abertos.push(a); return null; } };

const A = await import('../pengu/atualizacao.js');
const { criarVerificador, compararVersoes, lerVersao, lerRelease, repoValido, CHAVE_ATUALIZACAO, DIA_MS, PRAZO_MS, CORPO_MAX, FASES_CONSULTA } = A;
const { VERSAO, REPO } = await import('../pengu/versao.js');

const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);
const imediato = setImmediate;
const flush = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise(r => imediato(r)); };
const H = 3600 * 1000;

function relogio(inicio = Date.UTC(2026, 9, 19, 12, 0, 0)) {
  const r = { agora: inicio, fila: new Map(), prox: 1 };
  r.agendar = (fn, ms = 0) => { const id = r.prox++; r.fila.set(id, { em: r.agora + Math.max(0, Number(ms) || 0), fn }); return id; };
  r.cancelar = id => { r.fila.delete(id); };
  r.avancar = async ms => {
    const fim = r.agora + ms;
    for (;;) {
      let alvo = null;
      for (const [id, t] of r.fila) if (t.em <= fim && (!alvo || t.em < alvo[1].em)) alvo = [id, t];
      if (!alvo) break;
      r.agora = alvo[1].em; r.fila.delete(alvo[0]);
      alvo[1].fn();
      await flush();
    }
    r.agora = fim;
    await flush();
  };
  return r;
}
const dsMem = () => { const m = new Map(); return { get: k => (m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : null), set: (k, v) => m.set(k, JSON.parse(JSON.stringify(v))), m }; };
const release = (tag, extra = {}) => ({ tag_name: tag, name: tag, draft: false, prerelease: false, body: `- notas da ${tag}`, html_url: 'https://github.com/x/y', ...extra });

// GitHub falso: resposta(url, op) -> {status, json} | 'rede' | 'nunca' | 'naojson'; chamadas com a fase e o instante
function github(rel, est, resposta = () => ({ status: 200, json: release('v' + VERSAO) })) {
  const g = { chamadas: [], resposta };
  g.f = async (url, op = {}) => {
    g.chamadas.push({ url: String(url), op, fase: est.fase, em: rel.agora });
    const r = g.resposta(url, op);
    if (r === 'rede') throw new TypeError('Failed to fetch');
    if (r === 'nunca') return new Promise((_, rej) => op.signal?.addEventListener('abort', () => rej(Object.assign(new Error('abort'), { name: 'AbortError' }))));
    if (r === 'naojson') return { status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } };
    return { status: r.status, json: async () => JSON.parse(JSON.stringify(r.json)) };
  };
  return g;
}
// verificador com tudo falso; est.fase é a fase que a LCU devolve na carga
function montar({ ligado = true, repo = REPO, versao = VERSAO, fase = 'None', resposta, ds = dsMem(), rel = relogio() } = {}) {
  const est = { fase };
  const cfg = { atualizacao: { verificar: ligado } };
  const g = github(rel, est, resposta);
  const logs = [], avisos = [];
  const ouvintes = new Set([e => avisos.push(e)]);
  const v = criarVerificador({ cfg, versao, repo, f: g.f, agendar: rel.agendar, cancelar: rel.cancelar, agora: () => rel.agora, ds,
    lerFase: async () => est.fase, ouvintes, log: m => logs.push(m) });
  return { v, g, rel, est, cfg, ds, logs, avisos };
}
// roteiro de fases em laço (cada passo: [fase, minutos]); total em horas
const ROTEIRO = [['None', 20], ['Lobby', 15], ['Matchmaking', 3], ['ReadyCheck', 1], ['ChampSelect', 5], ['InProgress', 35],
  ['WaitingForStats', 1], ['EndOfGame', 5], ['Lobby', 10], ['None', 240]];
async function rodar(m, horas, roteiro = ROTEIRO) {
  const fim = m.rel.agora + horas * H;
  let i = 0;
  while (m.rel.agora < fim) {
    const [f, min] = roteiro[i++ % roteiro.length];
    m.est.fase = f;
    m.v.aoFase(f);
    await flush();
    await m.rel.avancar(Math.min(min * 60000, fim - m.rel.agora));
  }
}

// ---------- (a) 1 consulta por dia ----------
{
  const m = montar();
  await m.v.iniciar();
  await flush();
  await rodar(m, 71.5);
  const c = m.g.chamadas;
  const intervalos = c.slice(1).map((x, i) => x.em - c[i].em);
  caso(`(a) 3 dias de fases variadas e laço de 1 h: ${c.length} consultas (esperado 3)`, c.length === 3, JSON.stringify(c.map(x => [x.fase, new Date(x.em).toISOString()])));
  caso('(a) toda consulta em None ou Lobby', c.every(x => FASES_CONSULTA.includes(x.fase)), JSON.stringify(c.map(x => x.fase)));
  caso('(a) 24 h ou mais entre uma consulta e a seguinte (e no máximo 24 h + 1 ciclo de fases)', intervalos.every(d => d >= DIA_MS && d <= DIA_MS + 6 * H), JSON.stringify(intervalos.map(d => d / H)));
  const u = c[0];
  caso('(a) pedido: GET na api.github.com/repos/<REPO>/releases/latest, sem credencial nem corpo, com prazo (signal)',
    u?.url === `https://api.github.com/repos/${REPO}/releases/latest` && (u.op.method || 'GET') === 'GET' && u.op.credentials === 'omit' && u.op.body === undefined && !!u.op.signal
    && u.op.headers?.Accept === 'application/vnd.github+json', JSON.stringify(u && { url: u.url, op: { ...u.op, signal: !!u.op.signal } }));
  caso('(a) mesma versão: sem aviso e sem log', !m.v.estado().aviso && m.logs.length === 0 && m.avisos.every(e => !e.aviso), JSON.stringify(m.logs));
  m.v.parar();
}
// o laço de 1 h pega o dia vencido com o client parado no lobby (sem virada de fase)
{
  const m = montar({ fase: 'Lobby' });
  await m.v.iniciar();
  await m.rel.avancar(50 * H);
  caso(`(a) parado no Lobby por 50 h sem virada de fase: ${m.g.chamadas.length} consultas (0 h, 24 h e 48 h pelo laço)`, m.g.chamadas.length === 3
    && m.g.chamadas.map(x => (x.em - m.g.chamadas[0].em) / H).join() === '0,24,48', JSON.stringify(m.g.chamadas.map(x => (x.em - m.g.chamadas[0].em) / H)));
  m.v.parar();
}

// ---------- (b) chave desligada ----------
{
  const m = montar({ ligado: false });
  await m.v.iniciar();
  await rodar(m, 72);
  caso('(b) chave desligada: zero consulta em 72 h de fases', m.g.chamadas.length === 0, m.g.chamadas.length);
  m.est.fase = 'None'; m.v.aoFase('None'); await flush();
  const antes = m.g.chamadas.length;
  m.cfg.atualizacao.verificar = true;
  m.v.sincronizar(m.cfg);
  await flush();
  caso('(b) ligar a chave em None consulta na hora (uma vez)', antes === 0 && m.g.chamadas.length === 1, m.g.chamadas.length);
  m.v.sincronizar(m.cfg); m.v.sincronizar(m.cfg); await flush();
  caso('(b) sincronizar de novo sem mudar a chave não consulta', m.g.chamadas.length === 1, m.g.chamadas.length);
  m.v.parar();
}

// ---------- (c) REPO vazio ou inválido ----------
for (const repo of ['', 'dosxnjos', 'a/b/c', 'https://evil.example/x', 'dono/..', '../x', 'dono/nome?x=1', null]) {
  const m = montar({ repo });
  await m.v.iniciar();
  await rodar(m, 30);
  const r = await m.v.procurar();
  caso(`(c) REPO ${JSON.stringify(repo)}: zero fetch (automático e "procurar agora" = falhou)`, m.g.chamadas.length === 0 && r === 'falhou' && !repoValido(repo), m.g.chamadas.length);
  m.v.parar();
}
caso('(c) REPO de versao.js é válido', repoValido(REPO) && REPO === 'dosxnjos/lol-ultra-client' && VERSAO === '0.1.0', `${REPO} ${VERSAO}`);

// ---------- (d) fora de None/Lobby ----------
{
  const SEM = [['Matchmaking', 3], ['ReadyCheck', 1], ['ChampSelect', 5], ['GameStart', 1], ['InProgress', 35], ['WaitingForStats', 1], ['EndOfGame', 20], ['PreEndOfGame', 1], ['Reconnect', 2]];
  const m = montar({ fase: 'InProgress' });
  await m.v.iniciar();
  await rodar(m, 72, SEM);
  caso('(d) 72 h só em fila, seleção, partida e pós-jogo: zero consulta automática', m.g.chamadas.length === 0, JSON.stringify(m.g.chamadas.map(x => x.fase)));
  m.est.fase = 'ChampSelect'; m.v.aoFase('ChampSelect');
  const r = await m.v.procurar();
  caso('(d) "procurar agora" (clique) consulta mesmo fora de None/Lobby e responde "nenhuma"', m.g.chamadas.length === 1 && r === 'nenhuma' && m.v.estado().resultado === 'nenhuma', `${m.g.chamadas.length} ${r}`);
  m.v.parar();
}
{
  // fase desconhecida na carga (LCU sem resposta): espera o socket
  const m = montar({ fase: null });
  await m.v.iniciar();
  caso('(d) fase desconhecida na carga: nenhuma consulta até o socket dizer None/Lobby', m.g.chamadas.length === 0);
  m.v.aoFase('Lobby'); await flush();
  caso('(d) o socket diz Lobby: consulta', m.g.chamadas.length === 1);
  m.v.parar();
}

// ---------- (e) comparação de versão ----------
{
  const t = [['1.10.0', '1.9.3', 1], ['v0.1.1', '0.1.0', 1], ['0.1.0', 'v0.1.0', 0], ['0.10.0', '0.9.9', 1], ['2.0.0', '10.0.0', -1], ['0.1.0', '0.1.1', -1],
    ['1.2', '1.2.0', null], ['1.2.3-beta', '1.2.3', null], ['latest', '0.1.0', null], [1, '0.1.0', null], [null, '0.1.0', null], ['v1.2.3 ', '1.2.3', 0]];
  const errados = t.filter(([a, b, e]) => compararVersoes(a, b) !== e);
  caso(`(e) comparação de versão: ${t.length - errados.length}/${t.length} (1.10.0 > 1.9.3; pré-lançamento e texto inválidos)`, !errados.length, JSON.stringify(errados.map(([a, b, e]) => [a, b, e, compararVersoes(a, b)])));
  caso('(e) lerVersao("v1.10.0") = [1, 10, 0]', JSON.stringify(lerVersao('v1.10.0')) === '[1,10,0]');
  caso('(e) release rascunho, pré-lançamento, tag inválida, corpo não-texto e lista são recusados', [release('v9.0.0', { draft: true }), release('v9.0.0', { prerelease: true }),
    release('nightly'), release('v9.0.0', { body: 42 }), [release('v9.0.0')], 'v9.0.0', null].every(d => lerRelease(d) === null));
}

// ---------- (f) erros calados ----------
for (const [nome, resp] of [['404 (repositório ainda não existe)', () => ({ status: 404, json: { message: 'Not Found' } })],
  ['403 (limite da API)', () => ({ status: 403, json: { message: 'API rate limit exceeded' } })], ['500', () => ({ status: 500, json: null })],
  ['rede fora', () => 'rede'], ['corpo que não é JSON', () => 'naojson'], ['200 com {}', () => ({ status: 200, json: {} })],
  ['200 com lista', () => ({ status: 200, json: [release('v9.9.9')] })], ['200 com tag "latest"', () => ({ status: 200, json: release('latest') })],
  ['200 pré-lançamento mais novo', () => ({ status: 200, json: release('v9.9.9', { prerelease: true }) })],
  ['200 com body objeto', () => ({ status: 200, json: release('v9.9.9', { body: { html: '<b>x</b>' } }) })]]) {
  const m = montar({ resposta: resp });
  const erros = [];
  const erroOrig = console.error;
  console.error = (...a) => erros.push(a.join(' '));
  try {
    await m.v.iniciar();
    await flush();
    const s = m.ds.get(CHAVE_ATUALIZACAO);
    caso(`(f) ${nome}: calado (sem log, sem aviso, sem erro) e só a hora da tentativa anotada`, m.g.chamadas.length === 1 && m.logs.length === 0 && m.avisos.length === 0
      && !m.v.estado().aviso && erros.length === 0 && s && s.em === m.rel.agora && s.versao === undefined && m.v.estado().resultado === '', JSON.stringify({ logs: m.logs, erros, s, av: m.avisos.length }));
    await rodar(m, 20);
    caso(`(f) ${nome}: a falha não repete a consulta no mesmo dia`, m.g.chamadas.length === 1, m.g.chamadas.length);
  } finally { console.error = erroOrig; m.v.parar(); }
}
{
  // prazo: fetch que nunca volta é abortado em 5 s
  const m = montar({ resposta: () => 'nunca' });
  const p = m.v.iniciar();
  await flush();
  let fim = null;
  p.then(r => { fim = r; });
  await m.rel.avancar(PRAZO_MS - 1);
  const antes = fim;
  await m.rel.avancar(1);
  await flush();
  caso('(f) fetch sem resposta: abortado aos 5 s (signal.aborted), calado, nenhuma consulta presa', antes === null && fim === 'falhou' && m.g.chamadas[0]?.op.signal?.aborted === true
    && !m.v.estado().verificando && m.logs.length === 0, JSON.stringify({ antes, fim, ab: m.g.chamadas[0]?.op.signal?.aborted }));
  // "procurar agora" no meio de uma consulta em voo: um fetch só, e o resultado aparece no bloco
  m.ds.set(CHAVE_ATUALIZACAO, { repo: REPO, em: 0 });
  m.g.resposta = () => 'nunca';
  const auto = m.v.consultar('teste');
  await flush();
  const manual = m.v.procurar();
  await flush();
  const durante = m.v.estado().resultado;
  await m.rel.avancar(PRAZO_MS);
  const [ra, rm] = await Promise.all([auto, manual]);
  caso('(f) "procurar agora" com a consulta automática em voo: 1 fetch, "Procurando…" e depois o resultado', m.g.chamadas.length === 2 && durante === 'procurando'
    && ra === 'falhou' && rm === 'falhou' && m.v.estado().resultado === 'falhou', JSON.stringify({ n: m.g.chamadas.length, durante, ra, rm }));
  const r = await Promise.race([m.v.procurar(), m.rel.avancar(PRAZO_MS).then(() => 'x')]);
  caso('(f) "procurar agora" depois do prazo: consulta de novo e diz "não foi possível"', m.g.chamadas.length === 3 && m.v.estado().resultado === 'falhou', `${r} ${m.v.estado().resultado}`);
  m.v.parar();
}

// ---------- (g) versão nova ----------
const CORPO_HTML = '<img src=x onerror="alert(1)"><script>alert(2)</script>\r\n- corrige o aceite\n- <b>negrito</b>';
{
  const m = montar({ resposta: () => ({ status: 200, json: release('v0.2.0', { body: CORPO_HTML }) }) });
  await m.v.iniciar();
  await flush();
  const e = m.v.estado();
  caso('(g) v0.2.0 publicada: aviso com a versão 0.2.0, tag v0.2.0 e o corpo (CRLF vira LF)', e.aviso?.versao === '0.2.0' && e.aviso.tag === 'v0.2.0' && e.aviso.corpo === CORPO_HTML.replace(/\r\n/g, '\n'), JSON.stringify(e.aviso));
  caso('(g) um log e um aviso aos ouvintes', m.logs.length === 1 && /0\.2\.0/.test(m.logs[0]) && m.avisos.length === 1 && m.avisos[0].aviso?.versao === '0.2.0', JSON.stringify(m.logs));
  const s = m.ds.get(CHAVE_ATUALIZACAO);
  caso('(g) DataStore só {repo, em, okEm, versao, tag, corpo}', Object.keys(s).sort().join() === 'corpo,em,okEm,repo,tag,versao' && s.repo === REPO, JSON.stringify(Object.keys(s)));
  // recarga do client no mesmo dia: aviso na hora, sem consultar (o verificador de antes da recarga para: mesmo relógio e DataStore)
  m.v.parar();
  const m2 = montar({ ds: m.ds, rel: m.rel, resposta: () => ({ status: 200, json: release('v0.3.0') }) });
  await m2.v.iniciar();
  await flush();
  caso('(g) recarga no mesmo dia: aviso já na carga (0.2.0) e zero consulta', m2.g.chamadas.length === 0 && m2.v.estado().aviso?.versao === '0.2.0' && m2.avisos.length >= 1, m2.g.chamadas.length);
  await rodar(m2, 30);
  caso('(g) no dia seguinte consulta de novo e vê a 0.3.0', m2.g.chamadas.length === 1 && m2.v.estado().aviso?.versao === '0.3.0', JSON.stringify(m2.v.estado().aviso));
  // desligar a chave: o aviso some (a versão vista fica no bloco)
  m2.cfg.atualizacao.verificar = false; m2.v.sincronizar(m2.cfg);
  caso('(g) chave desligada: o aviso some, a versão vista fica (nova)', !m2.v.estado().aviso && m2.v.estado().nova?.versao === '0.3.0');
  await m2.v.procurar();
  caso('(g) chave desligada e "procurar agora" achou: o aviso volta nesta sessão', m2.v.estado().aviso?.versao === '0.3.0' && m2.v.estado().resultado === 'nova');
  // instalou a 0.3.0: o mesmo DataStore não avisa mais
  const m3 = montar({ ds: m.ds, rel: m.rel, versao: '0.3.0' });
  await m3.v.iniciar();
  caso('(g) instalada a mesma versão vista: sem aviso', !m3.v.estado().aviso && !m3.v.estado().nova);
  // outro REPO no DataStore (repositório renomeado): ignorado
  const m4 = montar({ ds: m.ds, rel: m.rel, repo: 'outro/repo' });
  caso('(g) DataStore de outro REPO é ignorado', !m4.v.estado().nova && !m4.v.estado().salvo);
  // corpo gigante cortado
  const m5 = montar({ resposta: () => ({ status: 200, json: release('v0.2.0', { body: 'x'.repeat(50000) }) }) });
  await m5.v.iniciar(); await flush();
  caso(`(g) corpo de 50 000 caracteres guardado com ${CORPO_MAX}`, m5.ds.get(CHAVE_ATUALIZACAO).corpo.length === CORPO_MAX);
  // relógio que voltou (hora da consulta no futuro): consulta
  const m6 = montar();
  m6.ds.set(CHAVE_ATUALIZACAO, { repo: REPO, em: m6.rel.agora + 30 * DIA_MS });
  await m6.v.iniciar(); await flush();
  caso('(g) hora da última consulta no futuro (relógio voltou): consulta', m6.g.chamadas.length === 1);
  for (const x of [m, m2, m3, m4, m5, m6]) x.v.parar();
}

// ---------- (h) telas: DOM falso ----------
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
  constructor(tag, doc) {
    this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.doc = doc; this.parentNode = null; this.childNodes = [];
    this.classList = new Classes(); this.dataset = {}; this.attrs = new Map(); this.ouvintes = {}; this.id = ''; this.style = {}; this.scrollTop = 0;
    let html = '';
    Object.defineProperty(this, 'innerHTML', { get: () => html, set: v => { html = String(v); this.htmlUsado = true; } });
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { if (k === 'id') this.id = String(v); else if (k === 'class') this.className = v; else this.attrs.set(k, String(v)); }
  getAttribute(k) { return k === 'id' ? this.id : this.attrs.get(k) ?? null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get ownerDocument() { return this.doc; }
  get isConnected() { return true; }
  append(...ns) { for (let n of ns) { if (n === null || n === undefined) continue; if (typeof n !== 'object') n = new Texto(n); if (n.parentNode) n.remove(); n.parentNode = this; this.childNodes.push(n); } }
  appendChild(n) { this.append(n); return n; }
  insertBefore(n, ref) { if (n.parentNode) n.remove(); n.parentNode = this; const i = this.childNodes.indexOf(ref); this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n); return n; }
  remove() { if (this.parentNode) { const l = this.parentNode.childNodes; l.splice(l.indexOf(this), 1); } this.parentNode = null; }
  replaceChildren(...ns) { for (const n of [...this.childNodes]) n.parentNode = null; this.childNodes = []; this.append(...ns); }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this.replaceChildren(new Texto(v)); }
  addEventListener(ev, fn) { (this.ouvintes[ev] ||= []).push(fn); }
  removeEventListener() {}
  clicar() { for (const fn of this.ouvintes.click || []) fn({ isTrusted: true, target: this }); }
  matches(sel) {
    const m = String(sel).trim().match(/^([a-z0-9-]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i);
    if (!m) return false;
    if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
    for (const c of m[2].split('.').filter(Boolean)) if (!this.classList.contains(c)) return false;
    for (const a of m[3].match(/\[[^\]]+\]/g) || []) {
      const [, k, v] = a.match(/^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/) || [];
      const valor = k?.startsWith('data-') ? this.dataset[k.slice(5)] : this.getAttribute(k);
      if (v === undefined ? valor == null : String(valor) !== v) return false;
    }
    return true;
  }
  *desc() { for (const n of this.children) { yield n; yield* n.desc(); } }
  querySelector(sel) { for (const n of this.desc()) if (n.matches(sel)) return n; return null; }
  querySelectorAll(sel) { return [...this.desc()].filter(n => n.matches(sel)); }
}
function novoDoc() {
  const doc = {};
  doc.createElement = tag => new El(tag, doc);
  doc.createElementNS = (_, tag) => new El(tag, doc);
  doc.createTextNode = t => new Texto(t);
  doc.documentElement = new El('html', doc);
  doc.head = new El('head', doc); doc.body = new El('body', doc);
  doc.documentElement.append(doc.head, doc.body);
  doc.getElementById = id => { for (const n of doc.documentElement.desc()) if (n.id === id) return n; return null; };
  doc.querySelector = sel => doc.documentElement.querySelector(sel);
  return doc;
}
const doc = novoDoc();
globalThis.document = doc;
globalThis.requestAnimationFrame = () => 0;
const { ui, montarPainel, usarTopo, registrarBloco } = await import('../pengu/configuracoes.js');
const botoes = n => n.querySelectorAll('lol-uikit-flat-button-secondary');
const porTexto = (n, t) => botoes(n).find(b => b.textContent === t);
{
  const m = montar({ resposta: () => ({ status: 200, json: release('v0.2.0', { body: CORPO_HTML }) }) });
  await m.v.iniciar(); await flush();
  let linha = A.linhaVersaoNova(ui, m.v);
  caso('(h) linha: "Versão 0.2.0 disponível (instalada: 0.1.0)." com "atualizar" e "o que mudou"', linha?.querySelector('.lc-versao-titulo')?.textContent === `Versão 0.2.0 disponível (instalada: ${VERSAO}).`
    && !!porTexto(linha, 'atualizar') && !!porTexto(linha, 'o que mudou') && !linha.querySelector('.lc-versao-notas'), linha?.textContent);
  porTexto(linha, 'o que mudou').clicar();
  linha = A.linhaVersaoNova(ui, m.v);
  const notas = linha.querySelector('.lc-versao-notas');
  const todos = [linha, ...linha.desc()];
  caso('(h) "o que mudou": o corpo do release como texto (HTML plantado = 0 elemento, nenhum innerHTML)', notas && notas.children.length === 0 && notas.textContent === CORPO_HTML.replace(/\r\n/g, '\n')
    && !todos.some(n => n.htmlUsado) && !todos.some(n => ['IMG', 'SCRIPT', 'B'].includes(n.tagName)) && !!porTexto(linha, 'esconder o que mudou'), notas?.textContent);
  porTexto(linha, 'atualizar').clicar();
  await flush();
  linha = A.linhaVersaoNova(ui, m.v);
  caso('(h) "atualizar" sem o atualizador da P3: diz onde baixar (github.com/<REPO>/releases), nada abre', linha.textContent.includes(`Para atualizar, baixe a versão 0.2.0 em github.com/${REPO}/releases.`), linha.textContent);
  const pedidos = [];
  m.v.registrarAtualizador(async p => { pedidos.push(p); return 'Baixando a versão 0.2.0…'; });
  porTexto(A.linhaVersaoNova(ui, m.v), 'atualizar').clicar();
  await flush();
  caso('(h) "atualizar" com o atualizador (gancho da P3): chamado uma vez com {versao, tag, repo}, o texto dele na linha',
    pedidos.length === 1 && JSON.stringify(pedidos[0]) === JSON.stringify({ versao: '0.2.0', tag: 'v0.2.0', repo: REPO }) && A.linhaVersaoNova(ui, m.v).textContent.includes('Baixando a versão 0.2.0…'), JSON.stringify(pedidos));
  m.v.registrarAtualizador(async () => { throw new Error('quebrou'); });
  const erroOrig = console.error; console.error = () => {};
  porTexto(A.linhaVersaoNova(ui, m.v), 'atualizar').clicar(); await flush();
  console.error = erroOrig;
  caso('(h) atualizador que quebra: "Não foi possível atualizar agora…"', A.linhaVersaoNova(ui, m.v).textContent.includes('Não foi possível atualizar agora'));
  // bloco Atualizações
  const definidos = [];
  const corpo = doc.createElement('div');
  A.blocoAtualizacao(corpo, { cfg: m.cfg, definir: (k, x) => definidos.push([k, x]), ui }, m.v);
  const cx = corpo.querySelector('input');
  caso('(h) bloco: chave atualizacao.verificar marcada, versão instalada, última consulta e "procurar agora"', cx?.getAttribute('name') === 'atualizacao.verificar' && cx.checked === true
    && corpo.textContent.includes(`Versão instalada: ${VERSAO}. Última consulta:`) && !!porTexto(corpo, 'procurar agora'), corpo.textContent);
  cx.checked = false; for (const fn of cx.ouvintes.change || []) fn();
  caso('(h) desmarcar a chave grava atualizacao.verificar false', JSON.stringify(definidos) === '[["atualizacao.verificar",false]]', JSON.stringify(definidos));
  // "procurar agora" pelo botão do bloco
  const n0 = m.g.chamadas.length;
  porTexto(corpo, 'procurar agora').clicar(); await flush();
  const corpo2 = doc.createElement('div');
  A.blocoAtualizacao(corpo2, { cfg: m.cfg, definir: () => {}, ui }, m.v);
  caso('(h) "procurar agora" do bloco: 1 consulta e "Versão 0.2.0 disponível."', m.g.chamadas.length === n0 + 1 && corpo2.textContent.includes('Versão 0.2.0 disponível.'), corpo2.textContent);
  // sem versão nova: nada no topo
  const mv = montar();
  await mv.v.iniciar(); await flush();
  caso('(h) sem versão nova: nenhuma linha no topo', A.linhaVersaoNova(ui, mv.v) === null);
  m.v.parar(); mv.v.parar();

  // a linha no topo do painel (client normal) e da ⚙ do compacto: a instância do plugin (iniciarAtualizacao) com fetch falso
  const rel = relogio();
  const est = { fase: 'None' };
  const g = github(rel, est, () => ({ status: 200, json: release('v0.2.0') }));
  const cfgP = { atualizacao: { verificar: true } };
  const dsP = dsMem();
  const inst = A.iniciarAtualizacao(cfgP, { f: g.f, agendar: rel.agendar, cancelar: rel.cancelar, agora: () => rel.agora, ds: dsP, lerFase: async () => 'None', log: () => {} });
  await flush(8);
  caso('(h) instância do plugin: versão nova põe lc-versao-nova no <html> (o ponto do ⚙)', doc.documentElement.classList.contains('lc-versao-nova') && g.chamadas.length === 1, doc.documentElement.className);
  usarTopo(A.linhaVersaoNova);
  const { PADRAO } = await import('../pengu/config.js');
  const cfgCompleto = JSON.parse(JSON.stringify(PADRAO));
  const painel = doc.createElement('div');
  montarPainel(painel, { cfg: cfgCompleto, definir: () => {} });
  caso('(h) painel do client: a linha da versão é o 1º filho, antes de "Interface"', painel.children[0]?.classList.contains('lc-versao-linha') && painel.children[1]?.textContent === 'Interface',
    painel.children.slice(0, 2).map(n => n.className).join(' | '));
  registrarBloco('atualizacao', A.blocoAtualizacao, 'Atualizações');
  const { criarConfigView } = await import('../pengu/compacto/lateral-config.js');
  const view = criarConfigView({ doc, cfg: cfgCompleto, definir: () => {} });
  view.pintar();
  const corpoCfg = view.el.querySelector('.lc-lt-cfgcorpo');
  const cima = corpoCfg?.children[0];
  caso('(h) ⚙ do compacto: a linha fica acima dos blocos recolhíveis (sempre à vista)', cima?.classList.contains('lc-lt-topo') && !!cima.querySelector('.lc-versao-linha')
    && corpoCfg.children.slice(1).every(n => n.classList.contains('lc-lt-bloco')), corpoCfg?.children.map(n => n.className).join(' | '));
  caso('(h) ⚙ do compacto: bloco "Atualizações" entre os recolhíveis', corpoCfg.querySelectorAll('.lc-lt-bcab').some(b => b.dataset.bloco === 'Atualizações'));
  // o ⚙ do compacto: o ponto existe no botão e o CSS só mostra com a classe
  const { botaoConfig, CSS_PONTO } = await import('../pengu/compacto/chat-botao.js');
  const extras = doc.createElement('div');
  const bt = botaoConfig({ extras, servicos: { lateral: { alternarConfig: () => {} } }, seguro: fn => fn });
  caso('(h) ⚙ do compacto: ponto .lc-cp-ponto no botão, mostrado só com html.lc-versao-nova', !!bt?.querySelector('.lc-cp-ponto') && /html\.lc-versao-nova #lc-compacto \[data-a="config"\] > \.lc-cp-ponto \{ display:block; \}/.test(CSS_PONTO)
    && /\.lc-cp-ponto \{ display:none;/.test(CSS_PONTO) && !!doc.getElementById('lc-cp-ponto-estilo'), CSS_PONTO);
  // chave desligada: a classe sai
  cfgP.atualizacao.verificar = false;
  A.sincronizarAtualizacao(cfgP);
  caso('(h) chave desligada: lc-versao-nova sai do <html> e a linha some do painel', !doc.documentElement.classList.contains('lc-versao-nova') && A.linhaVersaoNova(ui) === null);
  inst.parar();
}

// ---------- (r) revisão adversarial da P2 (19/10/2026): cada caso falha no código de antes da correção ----------
const blocoDe = v => { const c = doc.createElement('div'); A.blocoAtualizacao(c, { cfg: { atualizacao: { verificar: v.estado().ligado } }, definir: () => {}, ui }, v); return c; };
{
  // DataStore que não grava (ausente ou set que lança): o limite de 1 por dia vale pela memória da sessão
  const m = montar({ fase: 'Lobby', ds: { get: () => null, set: () => {} } });
  await m.v.iniciar();
  await m.rel.avancar(50 * H);
  caso(`(r) DataStore que não grava, parado no Lobby 50 h: ${m.g.chamadas.length} consultas (0 h, 24 h e 48 h; antes, 1 por volta do laço)`, m.g.chamadas.length === 3
    && m.g.chamadas.map(x => (x.em - m.g.chamadas[0].em) / H).join() === '0,24,48', JSON.stringify(m.g.chamadas.map(x => (x.em - m.g.chamadas[0].em) / H)));
  m.v.parar();
}
{
  // painel montado com a consulta automática em voo: "procurar agora" à vista durante e depois (o fim da automática sem novidade
  // não repinta; o clique no meio cai na consulta em voo, sem 2º fetch)
  const m = montar({ resposta: () => 'nunca' });
  const p = m.v.iniciar();
  await flush();
  const emVoo = m.v.estado().verificando;
  const durante = !!porTexto(blocoDe(m.v), 'procurar agora');
  await m.rel.avancar(PRAZO_MS);
  await p;
  caso('(r) bloco montado durante a consulta automática: "procurar agora" à vista (antes sumia até outro repaint)', emVoo && durante && !!porTexto(blocoDe(m.v), 'procurar agora')
    && m.g.chamadas.length === 1, JSON.stringify({ emVoo, durante }));
  m.v.parar();
}
{
  // "procurar agora": o repaint de "Procurando…" já vê a consulta em voo e esconde o botão
  const m = montar({ ligado: false, resposta: () => ({ status: 200, json: release('v0.2.0') }) });
  await m.v.iniciar();
  const vistos = [];
  m.v.aoMudar(e => vistos.push([e.resultado, e.verificando, !!porTexto(blocoDe(m.v), 'procurar agora')]));
  await m.v.procurar();
  caso('(r) "procurar agora": o repaint de "Procurando…" já está em voo e sem o botão; no fim o botão volta', JSON.stringify(vistos) === '[["procurando",true,false],["nova",false,true]]', JSON.stringify(vistos));
  m.v.parar();
}
{
  // resultado manual antigo não contradiz a consulta automática de depois
  const m = montar();
  await m.v.iniciar(); await flush();
  const r1 = await m.v.procurar();
  m.g.resposta = () => ({ status: 200, json: release('v0.2.0') });
  await rodar(m, 30);
  const e = m.v.estado();
  const txt = blocoDe(m.v).textContent;
  caso('(r) "procurar agora" = nenhuma e no dia seguinte a automática acha 0.2.0: o bloco não diz mais "Nenhuma versão nova."', r1 === 'nenhuma' && e.aviso?.versao === '0.2.0'
    && e.resultado === '' && !txt.includes('Nenhuma versão nova.'), JSON.stringify({ r1, res: e.resultado, txt }));
  // automática que falha depois não apaga o que se sabe
  m.v.parar();
  const m2 = montar({ ligado: false });
  await m2.v.iniciar();
  await m2.v.procurar();
  m2.g.resposta = () => 'rede';
  m2.cfg.atualizacao.verificar = true; m2.v.sincronizar(m2.cfg);
  await rodar(m2, 30);
  caso('(r) automática que falha não apaga o "Nenhuma versão nova." do clique', m2.v.estado().resultado === 'nenhuma' && m2.g.chamadas.length >= 2, `${m2.v.estado().resultado} ${m2.g.chamadas.length}`);
  m2.v.parar();
}
{
  // chave ligada, "procurar agora" acha 0.2.0, depois a chave desliga: a linha e o ponto somem
  const m = montar({ resposta: () => ({ status: 200, json: release('v0.2.0') }) });
  await m.v.iniciar(); await flush();
  await m.v.procurar();
  const antes = m.v.estado().aviso?.versao;
  m.cfg.atualizacao.verificar = false; m.v.sincronizar(m.cfg);
  caso('(r) chave ligada, "procurar agora" achou e a chave desligou: o aviso some (antes ficava até recarregar)', antes === '0.2.0' && !m.v.estado().aviso
    && A.linhaVersaoNova(ui, m.v) === null && m.avisos.at(-1)?.aviso === null && m.v.estado().nova?.versao === '0.2.0', JSON.stringify({ antes, aviso: m.v.estado().aviso }));
  m.v.parar();
}
{
  // a mensagem do "atualizar" é da versão que estava no aviso: versão mais nova depois tira a mensagem velha
  const m = montar({ resposta: () => ({ status: 200, json: release('v0.2.0') }) });
  await m.v.iniciar(); await flush();
  await m.v.atualizar();
  const antes = A.linhaVersaoNova(ui, m.v).textContent;
  m.g.resposta = () => ({ status: 200, json: release('v0.3.0') });
  await rodar(m, 30);
  const depois = A.linhaVersaoNova(ui, m.v).textContent;
  caso('(r) "atualizar" citou 0.2.0 e a automática achou 0.3.0: a linha não mistura as duas versões', antes.includes('baixe a versão 0.2.0') && depois.includes('Versão 0.3.0 disponível')
    && !depois.includes('0.2.0') && m.v.estado().mensagem === '', depois);
  await m.v.atualizar();
  caso('(r) "atualizar" de novo cita a 0.3.0', A.linhaVersaoNova(ui, m.v).textContent.includes('baixe a versão 0.3.0'));
  m.v.parar();
}

// ---------- (i) PADRAO e mescla ----------
{
  const mem = new Map([['lol-client.config', { versao: 4, esconderTft: false, coletor: { ligado: true } }]]);
  globalThis.DataStore = { get: k => (mem.has(k) ? JSON.parse(JSON.stringify(mem.get(k))) : null), set: (k, v) => mem.set(k, v) };
  const C = await import('../pengu/config.js');
  caso('(i) PADRAO.atualizacao.verificar = true', C.PADRAO.atualizacao?.verificar === true);
  C.carregar();
  caso('(i) config salva antes da chave existir: a mescla traz atualizacao.verificar true e mantém o resto', C.cfg.atualizacao?.verificar === true && C.cfg.esconderTft === false && C.cfg.coletor.ligado === true);
}

// ---------- parte 3: servidor HTTP falso local (porta 0) com o fetch de verdade e o relógio de verdade ----------
{
  const pedidos = [];
  const srv = createServer((req, res) => {
    pedidos.push({ url: req.url, metodo: req.method, auth: req.headers.authorization || '', cookie: req.headers.cookie || '' });
    if (req.url.endsWith('/lento/releases/latest')) { setTimeout(() => { try { res.end('{}'); } catch { /* fechado */ } }, 7000); return; }
    if (req.url === `/repos/${REPO}/releases/latest`) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(release('v0.2.0'))); return; }
    res.writeHead(404, { 'Content-Type': 'application/json' }); res.end('{"message":"Not Found"}');
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const local = (url, op) => fetch(String(url).replace('https://api.github.com', base), op);
  const real = (repo, ds = dsMem()) => criarVerificador({ cfg: { atualizacao: { verificar: true } }, repo, f: local, ds, lerFase: async () => 'Lobby', log: () => {} });
  const v1 = real(REPO);
  const r1 = await v1.procurar();
  caso('(3) servidor falso local, fetch de verdade: 200 v0.2.0 = "nova", GET sem Authorization nem cookie', r1 === 'nova' && v1.estado().aviso?.versao === '0.2.0'
    && pedidos[0]?.metodo === 'GET' && !pedidos[0].auth && !pedidos[0].cookie, JSON.stringify({ r1, p: pedidos[0] }));
  const v2 = real('ninguem/inexistente');
  const r2 = await v2.procurar();
  caso('(3) servidor falso local: 404 = "falhou", sem aviso', r2 === 'falhou' && !v2.estado().nova);
  const v3 = real('ninguem/lento');
  const t0 = Date.now();
  const r3 = await v3.procurar();
  const ms = Date.now() - t0;
  caso(`(3) servidor que não responde: desiste em ${ms} ms (prazo ${PRAZO_MS} ms, relógio de verdade) e "falhou"`, r3 === 'falhou' && ms >= PRAZO_MS - 50 && ms < PRAZO_MS + 1500, `${r3} ${ms}`);
  for (const v of [v1, v2, v3]) v.parar();
  srv.closeAllConnections?.();
  await new Promise(r => srv.close(r));
}

caso('(o) nenhum window.open no arquivo inteiro (carga, 1 por dia, laço, viradas de fase, erros, "procurar agora", telas, "atualizar")',
  abertos.length === 0, JSON.stringify(abertos));

relatar(casos);
