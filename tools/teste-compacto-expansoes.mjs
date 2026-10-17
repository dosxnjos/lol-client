// Testa o registro das expansões do client compacto (pengu/compacto/expansoes.js + o diff no resolver() de
// pengu/compacto/index.js; plano roadmap/2026-10-13-client-compacto.md, passo 15) sem o client: DOM mínimo (cópia do de
// tools/teste-compacto.mjs), riotInvoke falso, relógio falso, telas falsas e um coletor falso (nenhuma chamada à LCU).
// Pedido de 15/10/2026: "sempre que o modo compacto saísse de maneira automática para o modo estendido, fosse computado e
// logado as informações pertinentes, motivo, janelas etc". Prova: cada saída do compacto (regra 7, fase, celebração, erro
// de tela, janela que volta, sem riotInvoke, tela que expande sozinha, emergência, expansão adiada pelo foco) vira um evento
// com origem, motivo, fase, etapa, fila/mapa, camadas da Riot e janela antes/depois; pedida por ele (⤢, atalho, Ctrl+K,
// botão de tela com clique, Configurações da Riot, compacto desligado) sai marcada porEle; a volta fecha com duração e
// "como"; sem coletor (status 0) ou coletor velho (404) guarda e reenvia; nome de jogador e Riot ID nunca saem.
// uso: node tools/teste-compacto-expansoes.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { relatar } from './lcu-falsa.mjs';
import { criarJanela, invocadorRiot, criarCamada } from '../pengu/compacto/modo.js';
import { criarRoteador, descreverCamadas, CLASSE, SEQ_FIRME_MS, GESTO_MS, MODAIS, gestoDentro, GRACA_VOLTA_MS, ESPERA_SESSAO_MS, ESPERA_SELECAO_MS } from '../pengu/compacto/index.js';
import { criarRegistroExpansoes, textoSeguro, descreverCamada, DEPOIS_MS, REENVIO_MS, ROTA, enviarAoColetor } from '../pengu/compacto/expansoes.js';
import { h } from '../pengu/compacto/comum.js';

// ---------- DOM mínimo ----------
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
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.doc = doc; this.parentNode = null; this.childNodes = [];
    this.classList = new Classes(); this.dataset = {}; this.attrs = new Map(); this.ouvintes = {}; this.id = '';
    const est = {}; est.setProperty = (k, v) => { est[k] = v; }; this.style = est;
    this.offsetWidth = 0; this.offsetLeft = 0;
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { if (k === 'id') this.id = String(v); else if (k === 'class') this.className = v; else this.attrs.set(k, String(v)); }
  getAttribute(k) { return k === 'id' ? this.id : this.attrs.get(k) ?? null; }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  append(...ns) { for (let n of ns) { if (typeof n === 'string') n = new Texto(n); if (n.parentNode) n.remove(); n.parentNode = this; this.childNodes.push(n); } }
  appendChild(n) { this.append(n); return n; }
  insertBefore(n, ref) { if (n.parentNode) n.remove(); n.parentNode = this; const i = this.childNodes.indexOf(ref); this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n); return n; }
  remove() { if (this.parentNode) { const l = this.parentNode.childNodes; l.splice(l.indexOf(this), 1); } this.parentNode = null; }
  replaceChildren(...ns) { for (const n of [...this.childNodes]) n.parentNode = null; this.childNodes = []; this.append(...ns); }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this.replaceChildren(new Texto(v)); }
  get isConnected() { let p = this; while (p.parentNode) p = p.parentNode; return p === this.doc.documentElement; }
  addEventListener(ev, fn) { (this.ouvintes[ev] ||= []).push(fn); }
  disparar(ev, extra = {}) { const e = { target: this, stopPropagation() {}, preventDefault() {}, ...extra }; for (const fn of this.ouvintes[ev] || []) fn(e); }
  click() { this.disparar('click'); }
  matches(sel) {
    const m = String(sel).match(/^([a-z0-9-]*)((?:\.[\w-]+)*)(#[\w-]+)?((?:\[[^\]]+\])*)$/i);
    if (!m) throw new Error('seletor não suportado: ' + sel);
    if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
    for (const c of m[2].split('.').filter(Boolean)) if (!this.classList.contains(c)) return false;
    if (m[3] && this.id !== m[3].slice(1)) return false;
    return true;
  }
  *desc() { for (const n of this.children) { yield n; yield* n.desc(); } }
  querySelector(sel) { for (const n of this.desc()) if (n.matches(sel)) return n; return null; }
  querySelectorAll(sel) { return [...this.desc()].filter(n => n.matches(sel)); }
}
function novoDoc() {
  const doc = { listeners: {} };
  doc.createElement = tag => new El(tag, doc);
  doc.documentElement = new El('html', doc);
  doc.head = new El('head', doc); doc.body = new El('body', doc);
  doc.documentElement.append(doc.head, doc.body);
  doc.getElementById = id => { for (const n of doc.documentElement.desc()) if (n.id === id) return n; return null; };
  doc.querySelector = sel => doc.documentElement.querySelector(sel);
  doc.querySelectorAll = sel => doc.documentElement.querySelectorAll(sel);
  doc.addEventListener = () => {};
  return doc;
}
const el = (doc, tag, cls = '', filhos = [], id = '') => { const e = doc.createElement(tag); if (cls) e.className = cls; if (id) e.id = id; e.append(...filhos); return e; };

// ---------- relógio falso ----------
function relogio() {
  let agora = 0, prox = 1;
  const fila = new Map();
  return {
    agendar: (fn, ms = 0) => { const id = prox++; fila.set(id, { em: agora + ms, fn }); return id; },
    limpar: id => { fila.delete(id); },
    repetir: (fn, ms) => { const id = prox++; fila.set(id, { em: agora + ms, fn, cada: ms }); return id; },
    avancar(ms) {
      const fim = agora + ms;
      for (;;) {
        const [id, t] = [...fila].filter(([, x]) => x.em <= fim).sort((a, b) => a[1].em - b[1].em)[0] || [];
        if (!id) break;
        agora = t.em;
        if (t.cada) t.em += t.cada; else fila.delete(id);
        t.fn();
      }
      agora = fim;
    },
    agoraMs: () => agora,
  };
}
const tick = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

function telaFalsa(nome, { lancar = false } = {}) {
  const t = {
    ctx: null,
    montar(raiz, ctx) {
      t.ctx = ctx;
      if (lancar) throw new Error(`quebrei a ${nome}`);
      raiz.append(h('div', { doc: raiz.doc, class: 'conteudo' }, `tela ${nome}`));
    },
    atualizar() {},
  };
  return t;
}

// coletor falso: status por chamada (fila de respostas; acabou = 200)
function coletorFalso(respostas = []) {
  const c = { chamadas: [], recebidos: [], respostas: [...respostas] };
  c.f = async (caminho, op) => {
    c.chamadas.push([caminho, op.metodo]);
    const status = c.respostas.length ? c.respostas.shift() : 200;
    if (status === 200) c.recebidos.push(...op.corpo.eventos);
    return { status, dados: status === 200 ? { ok: true } : null };
  };
  return c;
}

function cenario({ cfg: cfgOver = {}, telas = {}, foco = true, respostas = [], comGesto = null } = {}) {
  const cfg = { compacto: { ligado: true, inicioCompacto: true, larg: 420, alt: 640 }, aceite: { ligado: true }, ...cfgOver };
  const win = { innerWidth: 1280, innerHeight: 720, riotInvoke: arg => { const p = JSON.parse(arg.request); if (p.name === 'Window.ResizeTo') [win.innerWidth, win.innerHeight] = p.params; } };
  const rel = relogio();
  const janela = criarJanela({ invocar: invocadorRiot(win, () => {}), medir: () => [win.innerWidth, win.innerHeight], agora: rel.agoraMs });
  const doc = novoDoc();
  const wrapper = el(doc, 'div', '', [], 'lol-uikit-layer-manager-wrapper');
  doc.body.append(wrapper);
  const col = coletorFalso(respostas);
  const logs = [];
  const registro = criarRegistroExpansoes({ enviar: enviarAoColetor(col.f), medir: () => ({ larg: win.innerWidth, alt: win.innerHeight, compacta: janela.ehCompacta() }),
    agendar: rel.agendar, limpar: rel.limpar, agora: rel.agoraMs, log: m => logs.push(m) });
  const ts = { lobby: telaFalsa('lobby'), fila: telaFalsa('fila'), champselect: telaFalsa('champselect'), posjogo: telaFalsa('posjogo'),
    honra: telaFalsa('honra'), jogo: telaFalsa('jogo'), ...telas };
  const s = { cfg, win, rel, doc, wrapper, col, registro, logs, modal: null, foco, falharClasse: 0, gesto: comGesto };
  const camada = criarCamada({ doc, aoExpandir: () => s.rot.expandir('botão ⤢'), aoMinimizar: () => {}, aoFechar: () => {}, avisoFechar: () => '' });
  s.rot = criarRoteador({
    cfg, janela, camada, registro, camadasRiot: () => descreverCamadas(doc), gestoHaMs: () => s.gesto,
    carregarTela: async nome => { if (ts[nome]) return ts[nome]; throw new Error('404 ' + nome); },
    avisar: () => {}, log: (...a) => logs.push(a.join(' ')),
    classe: on => { if (s.falharClasse > 0) { s.falharClasse--; throw new Error('classe quebrou'); } doc.documentElement.classList.toggle(CLASSE, on); },
    modalAberto: () => s.modal, temFoco: () => s.foco,
    agendar: rel.agendar, limpar: rel.limpar, repetir: rel.repetir, pararRepetir: rel.limpar, agora: rel.agoraMs,
  });
  s.telas = ts;
  s.ir = async (fase, sessao) => { s.rot.aoFase(fase); if (sessao) s.rot.aoSessao(sessao); await tick(); };
  // espera o "depois" da janela e o envio
  s.passar = async (ms = DEPOIS_MS + 50) => { s.rel.avancar(ms); await tick(); };
  s.eventos = () => col.recebidos;
  s.inicio = () => col.recebidos.filter(e => e.tipo === 'inicio');
  s.fim = () => col.recebidos.filter(e => e.tipo === 'fim');
  return s;
}
const sessao = (fila, mapa = 11) => ({ gameData: { queue: { id: fila, mapId: mapa }, isCustomGame: false }, map: { id: mapa } });
const pronto = async (fase = 'Lobby', op = {}) => { const s = cenario(op); s.rot.marcarPronto(); await s.ir(fase); return s; };

const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);
const J = x => JSON.stringify(x);

// ---------- 1. privacidade: texto e camada ----------
{
  const t1 = textoSeguro('Xerekton#BR1 te convidou para a partida');
  const t2 = textoSeguro('Fulaninho saiu da partida');
  const t3 = textoSeguro('Aceitar');
  caso('texto: Riot ID e nome somem (vira "…"), palavras de interface ficam', !/xerekton|br1|fulaninho/i.test(t1 + t2)
    && t1 === '… para a partida' && t2 === '… saiu da partida' && t3 === 'aceitar', J([t1, t2, t3]));
  caso('texto: só nome/número/símbolo = vazio', textoSeguro('ZéDoLoL 1234 #tag') === '' && textoSeguro('') === '' && textoSeguro(null) === '');
  // etapa 3 de roadmap/2026-10-17-telas-que-expandem.md: os modais de 15/10 (aviso de punição e erro do Vanguard) com nome no registro
  const tv = ['Atualização de feedback', 'Feedback de denúncia', 'GGWP', 'ERRO NO VANGUARD: VAN 152', 'Atualização de Placar!',
    'Aplicamos uma penalidade a Fulaninho em uma das suas partidas recentes'].map(x => textoSeguro(x));
  caso('texto: feedback, denúncia, GGWP, Vanguard e placar entram no vocabulário; o nome do jogador punido segue fora',
    J(tv) === J(['atualização de feedback', 'feedback de denúncia', 'ggwp', 'erro no vanguard …', 'atualização de placar', '… uma penalidade a … em uma das suas partidas …'])
      && !/fulaninho/i.test(J(tv)), J(tv));
  const doc = novoDoc();
  const modal = el(doc, 'div', 'modal lol-uikit-dialog-frame-root', [
    el(doc, 'lol-uikit-dialog-frame', 'dialog-frame', [
      el(doc, 'h3', 'titulo', ['Missão concluída, Fulaninho!']),
      el(doc, 'p', 'corpo', ['gg Fulaninho ez, você jogou com Beltrano#BR1']),
      el(doc, 'lol-uikit-flat-button', 'confirmar', ['Continuar']),
      el(doc, 'button', 'lc-x', ['Fechar']),
    ]),
  ], 'modal-1');
  const d = descreverCamada(modal);
  const tudo = J(d);
  caso('camada: tag, id, classes, filhos de 1º nível; título e botões só com vocabulário; corpo (texto livre) nunca',
    d.tag === 'div' && d.id === 'modal-1' && d.classes === 'modal lol-uikit-dialog-frame-root' && d.filhos[0].tag === 'lol-uikit-dialog-frame'
    && d.titulo === 'missão concluída …', tudo);
  caso('camada: nada de nome, Riot ID nem texto do corpo (gg, ez, Beltrano)', !/fulaninho|beltrano|br1|\bgg\b|\bez\b/i.test(tudo)
    && J(d.botoes) === J(['continuar', 'fechar']), tudo);
  doc.body.append(el(doc, 'div', '', [el(doc, 'lol-social-chat-window', 'chat'), modal, el(doc, 'div', 'tooltip')], 'lol-uikit-layer-manager-wrapper'));
  const cs = descreverCamadas(doc);
  caso('descreverCamadas: filhos do wrapper menos o chat da Riot, com o que a regra 7 diria (expande)',
    cs.length === 2 && cs[0].expande === 'modal' && cs[1].expande === null && !cs.some(c => c.tag === 'lol-social-chat-window'), J(cs));
  caso('camada: elemento nulo ou texto = null; classe/ id esquisitos ficam de fora',
    descreverCamada(null) === null && descreverCamada({ nodeType: 3 }) === null
    && descreverCamada(el(doc, 'div', 'ok <script>', [], 'id com espaço')).id === '');
}

// ---------- 2. regra 7: modal da Riot no lobby ----------
{
  const s = await pronto('Lobby');
  const compactoAntes = s.rot.estado().efetivo;
  s.wrapper.append(el(s.doc, 'div', 'modal', [el(s.doc, 'h4', 'header', ['Nova recompensa'])]));
  s.rel.avancar(5000);
  s.modal = 'modal';   // a vigia vê o modal aberto (desde a etapa 6 de 17/10, modal que some volta ao compacto sozinho)
  s.rot.aoModal('modal');
  await tick();
  caso('regra 7: nada sai antes de ler a janela "depois" (DEPOIS_MS)', s.eventos().length === 0 && s.rot.estado().efetivo === 'expandido', J(s.eventos()));
  await s.passar();
  const [e] = s.inicio();
  caso('regra 7: evento com origem modal, motivo, fase, camada que disparou e as camadas à vista',
    compactoAntes === 'compacto' && e && e.origem === 'modal' && e.porEle === false && e.fase === 'Lobby' && e.gatilhoCamada === 'modal'
    && /janela própria \(modal\)/.test(e.motivo) && e.camadas[0].classes === 'modal' && e.camadas[0].titulo === 'nova recompensa'
    && e.telaAntes === 'lobby', J(e));
  caso('regra 7: janela antes (420, compacta) e depois (1280)', e?.janelaAntes?.larg === 420 && e.janelaAntes.compacta === true
    && e.janelaDepois?.larg === 1280 && e.janelaDepois.compacta === false, J([e?.janelaAntes, e?.janelaDepois]));
  s.rel.avancar(20000);
  s.modal = null;      // fecha junto da virada de fase (antes do prazo da volta da etapa 6)
  await s.ir('Matchmaking');
  await s.passar(10);
  const [f] = s.fim();
  caso('volta: a fase virou e o compacto voltou -> fim com o mesmo id, duração e "automático"',
    s.rot.estado().efetivo === 'compacto' && f && f.id === e.id && f.como === 'automático' && f.fase === 'Matchmaking' && f.tela === 'fila'
    && f.duracaoMs === 20000 + DEPOIS_MS + 50, J(f));
  caso('envio: só a rota do coletor, por POST (nenhuma LCU)', s.col.chamadas.every(([c, m]) => c === ROTA && m === 'POST') && ROTA === '/compacto/expansoes', J(s.col.chamadas));
}

// ---------- 2b. volta ao compacto quando a janela da Riot fecha (etapa 6 do roadmap/2026-10-17-telas-que-expandem.md) ----------
// reconstrução de 15/10/2026 12:35 (registro): EndOfGame compacto, o aviso de punição ("Feedback de denúncia", botão "GGWP") abre
// como div.modal > lol-uikit-full-page-backdrop; antes ele ficava no client normal até o Lobby (61 s) depois do GGWP
{
  const s = await pronto('EndOfGame');
  const aviso = el(s.doc, 'div', 'modal', [el(s.doc, 'lol-uikit-full-page-backdrop', ''), el(s.doc, 'div', 'dialog-alert', [el(s.doc, 'h4', 'header', ['Feedback de denúncia']),
    el(s.doc, 'button', 'button', ['GGWP'])])]);
  s.wrapper.append(aviso);
  s.modal = 'modal';
  s.rot.aoModal('modal');
  await s.passar();
  const e = s.inicio()[0];
  const cam = e?.camadas?.find(c => c.expande);
  caso('aviso de punição (15/10 12:35): expande pela regra 7 e o registro nomeia título e botão (feedback de denúncia, ggwp)',
    e && e.origem === 'modal' && cam?.titulo === 'feedback de denúncia' && J(cam?.botoes) === J(['ggwp']), J(e));
  s.rel.avancar(10000);
  const aindaAberto = s.rot.estado().efetivo;
  aviso.remove(); s.modal = null;       // ele clicou GGWP
  s.rel.avancar(1000); await tick();
  const aos1 = s.rot.estado().efetivo;
  s.rel.avancar(1000); await tick();
  await s.passar(10);
  const f = s.fim()[0];
  caso('GGWP: com o modal aberto segue expandido; 1,5 s depois de fechar volta ao pós-jogo compacto e o fim diz "a janela da Riot fechou"',
    aindaAberto === 'expandido' && aos1 === 'expandido' && s.rot.estado().efetivo === 'compacto' && s.rot.estado().tela === 'posjogo'
      && f && f.id === e.id && f.como === 'a janela da Riot fechou', J([aindaAberto, aos1, s.rot.estado().efetivo, f]));

  // dois modais em sequência (o Vanguard abriu 2 dialog-alert): o 2º em 300 ms não deixa piscar
  const v = await pronto('Lobby');
  v.modal = 'modal'; v.rot.aoModal('modal'); await v.passar();
  v.modal = null; v.rel.avancar(300); await tick();
  v.modal = 'modal'; v.rel.avancar(5000); await tick();
  caso('modal some e outro abre em 300 ms: fica expandido (sem 420 -> 1280 -> 420)', v.rot.estado().efetivo === 'expandido' && !v.fim().length, J(v.eventos()));
  v.modal = null; v.rel.avancar(2000); await tick();
  caso('...e volta quando o segundo também fecha', v.rot.estado().efetivo === 'compacto', J(v.rot.estado()));

  // ele pediu o client normal no meio: não volta sozinho
  const p = await pronto('Lobby');
  p.modal = 'modal'; p.rot.aoModal('modal'); await p.passar();
  p.rot.expandir('Ctrl+K'); await tick();
  p.modal = null; p.rel.avancar(5000); await tick();
  caso('pedido dele de client normal no meio: o modal fechar não devolve o compacto', p.rot.estado().efetivo === 'expandido', J(p.rot.estado()));

  // ready check (regra própria: contagem do aceite / popup da Riot): nunca volta por esta regra
  const r = await pronto('ReadyCheck');
  r.modal = 'modal'; r.rot.aoModal('modal'); r.rel.avancar(1100); await r.passar();
  const rcExp = r.rot.estado().efetivo;
  r.modal = null; r.rel.avancar(5000); await tick();
  caso('ready check: modal desconhecido expande e não volta pela regra da etapa 6', rcExp === 'expandido' && r.rot.estado().efetivo === 'expandido', J([rcExp, r.rot.estado()]));

  // revisão adversarial de 17/10: a janela da Riot que só se escondeu (getClientRects vazio = "fechou" para a etapa 6) e reaparece
  // sem nó novo no wrapper (a vigia só vê filho adicionado, então ninguém chama aoModal): até GRACA_VOLTA_MS depois da volta a
  // releitura segue e expande de novo. Antes da correção a camada ficava por cima da janela da Riot
  const o = await pronto('EndOfGame');
  o.modal = 'modal'; o.rot.aoModal('modal'); await o.passar();
  o.modal = null; o.rel.avancar(2000); await tick();
  const voltouO = o.rot.estado().efetivo;
  o.modal = 'modal'; o.rel.avancar(600); await tick();     // reaparece; nenhum aoModal
  const deNovo = o.rot.estado();
  caso('janela da Riot que volta a aparecer logo depois da volta (sem nó novo): expande de novo pela regra 7',
    voltouO === 'compacto' && deNovo.efetivo === 'expandido' && /janela própria \(modal\)/.test(deNovo.forcado || ''), J([voltouO, deNovo]));
  o.modal = null; o.rel.avancar(4000); await tick();       // some de novo: não volta outra vez (nada de laço 420 -> 1280 -> 420)
  const semLaco = o.rot.estado().efetivo;
  await o.ir('Lobby'); await o.passar(10);
  caso('...e, se some de novo, fica no client normal até a virada de destino (sem laço); a fase nova volta ao compacto',
    semLaco === 'expandido' && o.rot.estado().efetivo === 'compacto', J([semLaco, o.rot.estado()]));
  // depois do prazo a releitura para (a vigia de nó novo segue valendo): nada de leitura do DOM a cada 250 ms para sempre
  const q = await pronto('EndOfGame');
  q.modal = 'modal'; q.rot.aoModal('modal'); await q.passar();
  q.modal = null; q.rel.avancar(2000); await tick();
  q.rel.avancar(GRACA_VOLTA_MS + 500); await tick();
  q.modal = 'modal'; q.rel.avancar(600); await tick();
  caso('passado GRACA_VOLTA_MS, a releitura parou (só a vigia de nó novo expande)', q.rot.estado().efetivo === 'compacto', J(q.rot.estado()));
}

// ---------- 2c. seleção: sessão vazia e prazo da sessão (revisão adversarial de 17/10/2026) ----------
{
  // personalizada no SR (fila 0 = null, mapa 11): a sessão vazia da saída da seleção também não vira "fila desconhecida"
  const s = await pronto('Lobby');
  await s.ir('ChampSelect', { gameData: { queue: { id: 0 }, isCustomGame: true }, map: { id: 11 } });
  s.rot.aoSelecao({ isSpectating: false, localPlayerCellId: 0 }); await tick(); // vinda do Lobby: monta com a sessão da seleção (D1)
  const montou = s.rot.estado().tela;
  s.rot.aoSessao({}); await tick();
  await s.passar();
  caso('personalizada no SR: sessão vazia antes da fase sair não expande ("fila desconhecida")',
    montou === 'champselect' && s.rot.estado().efetivo === 'compacto' && s.rot.estado().tela === 'champselect' && !s.inicio().length, J([montou, s.rot.estado(), s.eventos()]));

  // ChampSelect -> None -> ChampSelect em menos de ESPERA_SESSAO_MS (ex.: duas seleções assistidas seguidas): o prazo da 1ª não
  // encurta o da 2ª (que tem 2 × ESPERA_SESSAO_MS inteiros)
  const t = await pronto('None');
  await t.ir('ChampSelect');
  t.rel.avancar(1500); await tick();
  await t.ir('None');
  t.rel.avancar(300); await tick();
  await t.ir('ChampSelect');
  t.rel.avancar(2 * ESPERA_SESSAO_MS - 300); await tick();
  const noPrazo = t.rot.estado().efetivo;
  t.rel.avancar(500); await tick();
  caso('prazo da sessão da seleção recomeça a cada entrada: segue esperando até 2 × ESPERA_SESSAO_MS e só então expande',
    noPrazo === 'compacto' && t.rot.estado().efetivo === 'expandido' && /desconhecida/.test(t.rot.estado().motivo || ''), J([noPrazo, t.rot.estado()]));
}

// ---------- 3. fase sem tela compacta (ARAM) e trilha enquanto expandido ----------
{
  const s = await pronto('Lobby');
  s.rot.aoModal('modal');
  await s.passar();
  await s.ir('ChampSelect', sessao(450, 12));
  await s.passar();
  s.rot.reavaliar();
  const e = s.inicio()[0];
  caso('trilha: expandido pela regra 7 e a fase virou ARAM (outro motivo) -> sem evento novo, o motivo entra na trilha do fim depois',
    s.inicio().length === 1 && s.fim().length === 0 && e.origem === 'modal', J(s.eventos()));
  await s.ir('GameStart');
  await s.passar(10);
  const f = s.fim()[0];
  caso('trilha: fim leva a mudança (fase ChampSelect, origem fase, motivo do ARAM)',
    f && f.trilha.length >= 1 && f.trilha[0].fase === 'ChampSelect' && f.trilha[0].origem === 'fase' && /Summoner/.test(f.trilha[0].motivo), J(f));
  const s2 = await pronto('Matchmaking');
  await s2.ir('ChampSelect', sessao(450, 12));
  await s2.passar();
  const e2 = s2.inicio()[0];
  caso('fase: seleção do ARAM saindo da fila compacta -> origem fase, fila 450, mapa 12, tela de antes "fila"',
    e2 && e2.origem === 'fase' && !e2.porEle && e2.fila === 450 && e2.mapa === 12 && e2.fase === 'ChampSelect' && e2.telaAntes === 'fila', J(e2));
}

// ---------- 3b. espectador (etapa 2 do roadmap/2026-10-17-telas-que-expandem.md) ----------
// reconstrução de 16/10/2026 20:48:19–20:51:41 (medidor, hora local): ele clicou em "Assistir" no client normal (gesto 771 ms antes)
// e o client entrou em ChampSelect com o gameflow em 420/11 e a sessão da seleção com isSpectating, localPlayerCellId -1,
// GAME_STARTING; a sessão do gameflow esvaziou ~180 ms antes da fase None. Depois a de ARAM Mayhem (2400/12), que foi a InProgress
{
  const assistida = { isSpectating: true, localPlayerCellId: -1, isCustomGame: true, benchEnabled: false, timer: { phase: 'GAME_STARTING', totalTimeInPhase: 170000 } };
  const s = await pronto('None', { comGesto: 771 });
  s.rot.aoFase('ChampSelect');                       // 20:48:19,140: fase None -> ChampSelect (menu inicial, sem ReadyCheck)
  s.rel.avancar(10); s.rot.aoSessao(sessao(420, 11)); await tick(); // 20:48:19,150: o gameflow (420/11) chega antes da seleção
  const montou = s.rot.estado().tela;                // até a decisão D1 de 17/10 a tela da seleção montava aqui e cedia logo depois
  s.rel.avancar(35);
  s.rot.aoSelecao(assistida); await tick();          // 20:48:19,185: a sessão da seleção diz espectador
  await s.passar();
  const e = s.inicio()[0];
  caso('espectador 16/10 20:48 (ranqueada de um amigo, 420/11): expande pela fase, motivo "assistindo", nunca "por-ele" (gesto de 771 ms era o Assistir)',
    e && e.origem === 'fase' && e.porEle === false && /assistindo a uma partida/.test(e.motivo) && e.fila === 420, J([montou, e]));
  // D1 de 17/10/2026: vinda do menu inicial, a seleção espera o isSpectating; a tela compacta da seleção nunca monta (sem piscar)
  caso('espectador 16/10 20:48 (D1): a tela compacta da seleção nunca monta antes de ceder; sai do lobby compacto direto para a tela da Riot',
    montou === 'lobby' && e && e.telaAntes === 'lobby' && s.telas.champselect.ctx === null, J([montou, e && e.telaAntes, !!s.telas.champselect.ctx]));
  s.rot.aoSessao({}); await tick();                  // 20:48:23,57: sessão vazia
  const naoTrilhou = !s.fim().length;
  s.rel.avancar(180);
  await s.ir('None');                                // 20:48:23,75
  await s.passar(10);
  const f = s.fim()[0];
  caso('espectador: a sessão vazia não vira "fila desconhecida" na trilha; a fase None volta ao lobby compacto',
    naoTrilhou && f && f.id === e.id && f.fase === 'None' && f.tela === 'lobby' && !f.trilha.some(t => /desconhecida/.test(t.motivo)), J(f));

  // 20:48:28: ARAM Mayhem assistido até o fim da partida
  await s.ir('ChampSelect', sessao(2400, 12));
  s.rot.aoSelecao({ ...assistida, timer: { phase: 'GAME_STARTING', totalTimeInPhase: 89000 } }); await tick();
  await s.passar();
  const fases = [];
  for (const fase of ['GameStart', 'InProgress', 'WaitingForStats', 'EndOfGame']) { await s.ir(fase); await s.passar(10); fases.push(`${fase}:${s.rot.estado().efetivo}:${s.rot.estado().tela}`); }
  const nada = fases.every(x => /:expandido:null$/.test(x));
  await s.ir('None'); await s.passar(10);
  caso('espectador: GameStart/InProgress/fim da partida assistida ficam no client normal (nada da tela "partida em andamento"); None zera e volta ao lobby',
    nada && s.rot.estado().efetivo === 'compacto' && s.rot.estado().tela === 'lobby', J(fases));

  // ranqueada dele (15/10 13:50): isSpectating false, localPlayerCellId 4 -> compacto do começo ao fim
  const r = await pronto('ReadyCheck');
  r.rot.aoSessao(sessao(420)); await tick();
  await r.ir('ChampSelect');
  r.rot.aoSelecao({ isSpectating: false, localPlayerCellId: 4, isCustomGame: false, timer: { phase: 'PLANNING' } }); await tick();
  const seq = [r.rot.estado().tela];
  for (const fase of ['GameStart', 'InProgress']) { await r.ir(fase); seq.push(r.rot.estado().tela); }
  caso('ranqueada dele (isSpectating false, cellId 4): seleção e partida seguem compactas, nenhuma expansão',
    J(seq) === J(['champselect', 'jogo', 'jogo']) && !r.inicio().length, J([seq, r.eventos()]));
  // localPlayerCellId -1 sozinho (início de seleção real sem a sessão completa) nunca vira espectador
  const c = await pronto('ReadyCheck');
  c.rot.aoSessao(sessao(420)); await tick();
  await c.ir('ChampSelect');
  c.rot.aoSelecao({ localPlayerCellId: -1, myTeam: [] }); await tick();
  caso('localPlayerCellId -1 sem isSpectating não tira a ranqueada do compacto', c.rot.estado().tela === 'champselect' && !c.inicio().length, J(c.eventos()));
}

// ---------- 3c. D1 de 17/10/2026: seleção vinda do menu inicial espera o isSpectating (ESPERA_SELECAO_MS) ----------
// tempos do medidor (14–16/10, hora local): a sessão da seleção chegou 35–91 ms depois da fase nas 8 entradas None/Lobby
{
  // tela da seleção que anota o relógio falso na montagem: mede o atraso da tela compacta
  const comHora = s => { const t = telaFalsa('champselect'); const m = t.montar; t.montar = (r, ctx) => { t.em = s.rel.agoraMs(); return m(r, ctx); }; s.telas.champselect = t; return t; };
  const personalizada = { gameData: { queue: { id: 3140, mapId: 11 }, isCustomGame: true }, map: { id: 11 } };
  // personalizada (treino 15/10 02:23:58,957 -> sessão da seleção em 02:23:59,026: 69 ms; gameflow em +28 ms)
  const p = cenario(); p.rot.marcarPronto(); await p.ir('Lobby');
  const tp = comHora(p);
  const t0 = p.rel.agoraMs();
  p.rot.aoFase('ChampSelect'); p.rel.avancar(28); p.rot.aoSessao(personalizada); await tick();
  const antes = p.rot.estado().tela;
  p.rel.avancar(41); p.rot.aoSelecao({ isSpectating: false, localPlayerCellId: 0, isCustomGame: true, timer: { phase: 'BAN_PICK' } }); await tick();
  await p.passar();
  caso(`personalizada (Lobby -> ChampSelect, isSpectating false em 69 ms): monta a seleção compacta assim que a sessão chega (atraso ${tp.em - t0} ms), sem expansão nem piscada`,
    antes === 'lobby' && p.rot.estado().tela === 'champselect' && tp.em - t0 === 69 && !p.inicio().length, J([antes, p.rot.estado().tela, tp.em - t0, p.eventos()]));
  // prazo esgotado sem a sessão da seleção (client ocupado): segue a regra de antes (personalizada no SR monta), sem expandir
  const q = cenario(); q.rot.marcarPronto(); await q.ir('Lobby');
  const tq = comHora(q);
  q.rot.aoFase('ChampSelect'); q.rot.aoSessao(personalizada); await tick();
  q.rel.avancar(ESPERA_SELECAO_MS - 1); await tick();
  const aindaLobby = q.rot.estado().tela;
  q.rel.avancar(1); await tick(); await q.passar();
  caso(`sem isSpectating no prazo (${ESPERA_SELECAO_MS} ms): segue a regra da fila (personalizada no SR monta a seleção), sem expansão`,
    aindaLobby === 'lobby' && q.rot.estado().tela === 'champselect' && tq.em === ESPERA_SELECAO_MS && !q.inicio().length, J([aindaLobby, q.rot.estado().tela, tq.em, q.eventos()]));
  // ranqueada dele (ReadyCheck -> ChampSelect): nunca espera, nem sem a sessão da seleção chegar
  const r = cenario(); r.rot.marcarPronto(); await r.ir('ReadyCheck');
  r.rot.aoSessao(sessao(420)); await tick();
  const tr = comHora(r);
  const r0 = r.rel.agoraMs();
  await r.ir('ChampSelect');
  caso('ranqueada (ReadyCheck -> ChampSelect) sem sessão da seleção nenhuma: monta a seleção compacta na hora (0 ms), sem espera',
    r.rot.estado().tela === 'champselect' && tr.em === r0 && !r.inicio().length, J([r.rot.estado(), tr.em, r0]));
  // ordem trocada: a sessão da seleção (espectador) chega antes do evento de fase
  const o = cenario(); o.rot.marcarPronto(); await o.ir('None');
  o.rot.aoSelecao({ isSpectating: true, localPlayerCellId: -1 }); await tick();
  await o.ir('ChampSelect', sessao(2400, 12)); await o.passar();
  const eo = o.inicio()[0];
  caso('espectador com a sessão da seleção antes da fase: expande na entrada, motivo "assistindo", sem montar a seleção',
    eo && /assistindo a uma partida/.test(eo.motivo) && o.telas.champselect.ctx === null, J(eo));
  // personalizada que sai da seleção antes do prazo: a espera não vaza para a próxima entrada (Lobby -> ChampSelect -> Lobby -> ReadyCheck -> ChampSelect)
  const v = cenario(); v.rot.marcarPronto(); await v.ir('Lobby');
  await v.ir('ChampSelect', personalizada); await v.ir('Lobby'); await v.ir('ReadyCheck'); v.rot.aoSessao(sessao(420)); await tick();
  await v.ir('ChampSelect');
  caso('espera da seleção não vaza: personalizada desfeita antes do prazo e depois uma ranqueada = seleção compacta na hora',
    v.rot.estado().tela === 'champselect' && !v.inicio().length, J([v.rot.estado(), v.eventos()]));
}

// ---------- 4. celebração do fim de partida (etapa) ----------
{
  const s = await pronto('WaitingForStats');
  await s.ir('PreEndOfGame');
  s.rot.aoSequencia('honor-vote');
  await tick();
  s.rot.aoSequencia('progression-celebration');
  await s.passar(SEQ_FIRME_MS + 100);
  await s.passar();
  const e = s.inicio()[0];
  caso('celebração: etapa do fim de partida (currentSequenceEvent) vai no evento, origem fase, tela de antes honra',
    e && e.origem === 'fase' && e.seq === 'progression-celebration' && e.fase === 'PreEndOfGame' && e.telaAntes === 'honra', J(e));
}

// ---------- 5. erro de tela, janela que volta, sem riotInvoke, emergência ----------
{
  const s = await pronto('Lobby', { telas: { fila: telaFalsa('fila', { lancar: true }) } });
  await s.ir('Matchmaking');
  await s.passar();
  const e = s.inicio()[0];
  // revisão adversarial 15/10: e.message é texto livre (pode trazer dado da LCU): no registro só o vocabulário de interface
  caso('erro de tela: origem erro-tela, motivo sem o texto livre da mensagem (só vocabulário)', e && e.origem === 'erro-tela'
    && /^erro na tela compacta \(/.test(e.motivo) && !/quebrei/.test(e.motivo) && /fila/.test(e.motivo) && e.fase === 'Matchmaking', J(e));

  const s2 = await pronto('Lobby');
  for (let i = 0; i < 3; i++) { s2.win.innerWidth = 1280; s2.win.innerHeight = 720; s2.rel.avancar(2000); s2.rot.reavaliar(); }
  s2.win.innerWidth = 1280; s2.win.innerHeight = 720; s2.rel.avancar(2000); s2.rot.reavaliar();
  await s2.passar();
  const e2 = s2.inicio()[0];
  caso('janela que a Riot devolve a 1280 (3 vezes em 10 s): origem janela-voltou, reencolhidas 3', e2 && e2.origem === 'janela-voltou' && e2.reencolhidas === 3, J(e2));

  const s3 = await pronto('Lobby');
  delete s3.win.riotInvoke;
  s3.rot.reavaliar();
  await s3.passar();
  const e3 = s3.inicio()[0];
  caso('sem riotInvoke com a tela montada: origem sem-riotinvoke', e3 && e3.origem === 'sem-riotinvoke' && !e3.porEle, J(e3));

  const s4 = await pronto('Lobby');
  s4.falharClasse = 1;
  await s4.ir('Matchmaking');
  await s4.passar();
  const e4 = s4.inicio()[0];
  caso('erro no roteador (emergência): origem erro-roteador', e4 && e4.origem === 'erro-roteador' && e4.motivo === 'erro no roteador', J(e4));
}

// ---------- 6. pedida por ele ----------
{
  const s = await pronto('Lobby');
  s.rot.expandir('botão ⤢');
  await s.passar();
  s.rel.avancar(3000);
  s.rot.compactar();
  await s.passar(10);
  const [e] = s.inicio(), [f] = s.fim();
  caso('⤢: porEle, origem por-ele, gatilho "botão ⤢"; volta pelo ▣ = "por ele (botão ▣)" com a duração',
    e && e.porEle && e.origem === 'por-ele' && e.gatilho === 'botão ⤢' && f && f.como === 'por ele (botão ▣)' && f.duracaoMs === DEPOIS_MS + 50 + 3000, J([e, f]));

  const s2 = await pronto('Lobby');
  s2.rot.alternar('atalho Ctrl+Shift+M');
  await s2.passar();
  s2.rot.alternar('atalho Ctrl+Shift+M');
  await s2.passar(10);
  caso('Ctrl+Shift+M: gatilho no início e na volta', s2.inicio()[0]?.gatilho === 'atalho Ctrl+Shift+M' && s2.fim()[0]?.como === 'por ele (atalho Ctrl+Shift+M)', J(s2.eventos()));

  const s3 = await pronto('Lobby');
  s3.rot.abrirConfigRiot();
  await s3.passar();
  s3.rot.configRiotFechou();
  await s3.passar(10);
  caso('Configurações da Riot pelo painel: porEle, origem config-riot; fecharam = volta registrada',
    s3.inicio()[0]?.origem === 'config-riot' && s3.inicio()[0].porEle && s3.fim()[0]?.como === 'as Configurações da Riot fecharam', J(s3.eventos()));

  const s4 = await pronto('Lobby');
  s4.cfg.compacto.ligado = false;
  s4.rot.sincronizar();
  await s4.passar();
  caso('compacto desligado nas Configurações: porEle, origem desligado', s4.inicio()[0]?.origem === 'desligado' && s4.inicio()[0].porEle, J(s4.eventos()));

  // "iniciar no compacto" desligado: o ▣ dele vale até a fase virar; a volta ao normal é a config dele, não tela da Riot
  const s5 = await pronto('Lobby', { cfg: { compacto: { ligado: true, inicioCompacto: false, larg: 420, alt: 640 }, aceite: { ligado: true } } });
  s5.rot.compactar('botão ▣');
  await s5.passar(10);
  const compactou = s5.rot.estado().efetivo;
  await s5.ir('Matchmaking');
  await s5.passar();
  const e5 = s5.inicio()[0];
  caso('"iniciar no compacto" desligado: a volta ao normal na fase nova sai porEle, origem padrao, gatilho da config',
    compactou === 'compacto' && e5 && e5.origem === 'padrao' && e5.porEle === true && /config/.test(e5.gatilho || ''), J([compactou, e5]));
}

// ---------- 7. tela que expande sozinha x botão da tela ----------
{
  const s = await pronto('Lobby');
  const ctx = s.telas.lobby.ctx;
  ctx.expandir();
  ctx.avisar('lobby personalizado: abrindo o client normal');   // o tela-lobby avisa logo DEPOIS de expandir
  await s.passar();
  const e = s.inicio()[0];
  caso('tela sozinha (sem clique dele): origem tela-sozinha, porEle false, gatilho "tela lobby", aviso só com vocabulário',
    e && e.origem === 'tela-sozinha' && e.porEle === false && e.gatilho === 'tela lobby' && e.aviso === 'lobby personalizado abrindo o client normal', J(e));

  const s2 = await pronto('Lobby', { comGesto: GESTO_MS - 200 });
  s2.rel.avancar(5000);   // a tela montou e o clique dele veio depois (etapa 3 de 17/10: clique de antes da tela não conta)
  s2.telas.lobby.ctx.avisar('Fulaninho#BR1: chat indisponível');
  s2.telas.lobby.ctx.expandir();
  await s2.passar();
  const e2 = s2.inicio()[0];
  caso('botão da tela com clique há pouco: porEle, origem por-ele; aviso de antes vai junto sem o nome',
    e2 && e2.porEle && e2.origem === 'por-ele' && e2.gestoHaMs === GESTO_MS - 200 && e2.aviso === 'chat indisponível'
    && !/fulaninho|br1/i.test(J(e2)), J(e2));
  const s3 = await pronto('Lobby', { comGesto: GESTO_MS + 500 });
  s3.telas.lobby.ctx.expandir();
  await s3.passar();
  caso('clique velho (> GESTO_MS) não conta como dele', s3.inicio()[0]?.origem === 'tela-sozinha', J(s3.eventos()));

  // etapa 3 de roadmap/2026-10-17-telas-que-expandem.md: o gesto só conta se for dentro da camada e depois de a tela montar
  // reconstrução de 16/10/2026 20:48:14–20:48:19: ele expandiu pelo ⤢ (client normal), clicou em "Assistir" no client da Riot
  // (fora da camada, que nem existia) ~650 ms antes de a tela da seleção montar; a tela pediu o client normal 771 ms depois do clique
  const s4 = await pronto('None', { comGesto: null });
  await s4.ir('ChampSelect', sessao(420, 11));
  s4.rel.avancar(ESPERA_SELECAO_MS); await tick();  // sem a sessão da seleção, o prazo da D1 (17/10) esgota e a tela monta (o classificador é o que se prova aqui)
  s4.rel.avancar(120);
  s4.gesto = { haMs: 771, dentro: false };
  s4.telas.champselect.ctx.expandir();
  await s4.passar();
  const e4 = s4.inicio()[0];
  caso('16/10 20:48 (Assistir no client normal 771 ms antes, tela montada 120 ms antes): tela-sozinha, porEle false, gesto anotado antes da tela e fora da camada',
    e4 && e4.origem === 'tela-sozinha' && e4.porEle === false && e4.gestoHaMs === 771 && e4.gestoAntesDaTela === true && e4.gestoForaDaCamada === true, J(e4));
  const s5 = await pronto('Lobby');
  s5.rel.avancar(5000);
  s5.gesto = { haMs: 700, dentro: false };    // clique fora da camada há 700 ms (ex.: botão flutuante, outra janela da página)
  s5.telas.lobby.ctx.expandir();
  await s5.passar();
  caso('clique fora da camada há 700 ms + tela que expande = tela-sozinha', s5.inicio()[0]?.origem === 'tela-sozinha' && s5.inicio()[0]?.gestoForaDaCamada === true, J(s5.inicio()));
  const s6 = await pronto('Lobby');
  s6.rel.avancar(5000);
  s6.gesto = { haMs: 120, dentro: true };     // clique no botão da tela
  s6.telas.lobby.ctx.expandir();
  await s6.passar();
  caso('clique no botão da tela (dentro da camada, depois de montar) = por-ele', s6.inicio()[0]?.origem === 'por-ele' && s6.inicio()[0]?.porEle === true
    && !('gestoForaDaCamada' in s6.inicio()[0]) && !('gestoAntesDaTela' in s6.inicio()[0]), J(s6.inicio()));
  // gestoDentro: o alvo do clique dentro do #lc-compacto
  const cam = { contains: x => x === 'botao' };
  const docG = { getElementById: id => (id === 'lc-compacto' ? cam : null) };
  caso('gestoDentro: alvo na camada = true; fora, sem camada ou sem alvo = false',
    gestoDentro(docG, 'botao') === true && gestoDentro(docG, 'assistir') === false && gestoDentro({ getElementById: () => null }, 'botao') === false
      && gestoDentro(docG, null) === false && gestoDentro(docG, cam) === true);
}

// ---------- 8. partida: expansão que esperou o foco ----------
{
  const s = await pronto('InProgress');
  s.foco = false;
  s.rel.avancar(1000);
  s.rot.aoModal('modal');
  await tick();
  const adiou = s.rot.estado().adiado;
  s.rel.avancar(7000);
  s.foco = true;
  s.rot.reavaliar();
  await s.passar();
  const e = s.inicio()[0];
  caso('partida sem foco: a expansão espera e o evento sai na hora certa com esperouFocoMs', adiou === 'expandir' && e && e.origem === 'modal'
    && e.fase === 'InProgress' && e.esperouFocoMs === 7000, J([adiou, e]));

  // botão de uma tela clicado por ele com a expansão adiada pelo foco: o gesto vale no pedido, não 7 s depois
  const s2 = await pronto('InProgress', { comGesto: 200 });
  s2.rel.avancar(1000);   // o clique veio depois de a tela montar
  s2.foco = false;
  s2.telas.jogo.ctx.expandir();
  await tick();
  const adiou2 = s2.rot.estado().adiado;
  s2.rot.reavaliar();   // resolver no meio (tique): o gatilho não se perde
  s2.rel.avancar(7000);
  s2.gesto = 7200;
  s2.foco = true;
  s2.rot.reavaliar();
  await s2.passar();
  const e2 = s2.inicio()[0];
  caso('pedido dele adiado pelo foco: segue porEle, gatilho "tela jogo", gesto medido no pedido', adiou2 === 'expandir' && e2
    && e2.porEle === true && e2.origem === 'por-ele' && e2.gatilho === 'tela jogo' && e2.gestoHaMs === 200, J([adiou2, e2]));
}

// ---------- 9. sem coletor e coletor velho ----------
{
  const s = await pronto('Lobby', { respostas: [0, 404] });
  s.rot.expandir('botão ⤢');
  await s.passar();
  const fila1 = s.registro.estado().fila;
  s.rel.avancar(REENVIO_MS); await tick();
  const fila2 = s.registro.estado().fila;
  s.rel.avancar(REENVIO_MS); await tick();
  const st = s.registro.estado();
  caso('coletor fora (0) e sem a rota (404): guarda, reenvia a cada REENVIO_MS e entrega quando ele responde',
    fila1 === 1 && fila2 === 1 && st.fila === 0 && s.inicio().length === 1 && st.envios.falhas === 2 && st.envios.ok === 1, J([fila1, fila2, st]));
  caso('sem coletor: um log por tipo de falha (não a cada tentativa)', s.logs.filter(l => /expansões:/.test(l)).length === 2, J(s.logs.filter(l => /expansões/.test(l))));

  const col = coletorFalso([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const rel = relogio();
  const r = criarRegistroExpansoes({ enviar: enviarAoColetor(col.f), agendar: rel.agendar, limpar: rel.limpar, agora: rel.agoraMs, maxFila: 3, depoisMs: 0 });
  for (let i = 0; i < 5; i++) { r.abrir({ origem: 'modal', motivo: `m${i}` }); rel.avancar(1); await tick(); }
  const st2 = r.estado();
  col.respostas = [];
  rel.avancar(REENVIO_MS); await tick();
  caso('fila cheia: o mais velho sai e conta em "descartados" (vai junto no próximo envio)', st2.fila === 3 && st2.descartados >= 2
    && r.estado().fila === 0 && r.estado().descartados === 0, J([st2, r.estado()]));
  caso('expansão nova sem a volta da anterior: a anterior fecha como "nova expansão sem volta registrada"',
    col.recebidos.some(e => e.tipo === 'fim' && e.como === 'nova expansão sem volta registrada'), J(col.recebidos.map(e => [e.tipo, e.como])));

  // revisão adversarial 15/10: o servidor do coletor lê só 64 KiB de corpo (o resto corta: JSON torto, 400). Fila cheia com
  // camadas (coletor velho sem a rota até o reinício) não pode virar um lote que volta 400 para sempre
  const camadaGorda = i => ({ tag: 'div', id: '', classes: 'modal lol-uikit-dialog-frame x'.repeat(4).slice(0, 120), expande: i ? null : '.modal',
    filhos: Array.from({ length: 4 }, () => ({ tag: 'lol-uikit-dialog-frame', classes: 'dialog-frame-content-x'.repeat(3).slice(0, 60) })),
    titulo: 'partida encontrada '.repeat(6).slice(0, 120), botoes: ['aceitar', 'recusar', 'fechar', 'ok'] });
  const enc = new TextEncoder();
  const servidor = { recebidos: [], status: [] };
  const fSrv = async (caminho, op) => {
    const bytes = enc.encode(JSON.stringify(op.corpo)).length;
    const st = bytes > 65536 ? 400 : 200;
    servidor.status.push([bytes, st]);
    if (st === 200) servidor.recebidos.push(...op.corpo.eventos);
    return { status: st };
  };
  let fora = true;
  const rel2 = relogio();
  const r2 = criarRegistroExpansoes({ enviar: c => (fora ? Promise.resolve({ status: 404 }) : fSrv(ROTA, { corpo: c })),
    agendar: rel2.agendar, limpar: rel2.limpar, agora: rel2.agoraMs, depoisMs: 0 });
  for (let i = 0; i < 45; i++) {
    r2.abrir({ origem: 'modal', motivo: 'o client abriu uma janela própria (.modal)', camadas: Array.from({ length: 6 }, (_, k) => camadaGorda(k)) });
    rel2.avancar(1); await tick();
    r2.fechar({ como: 'automático' }); await tick();
  }
  const naFila = r2.estado().fila;
  fora = false;
  rel2.avancar(REENVIO_MS); await tick(20);
  for (let i = 0; i < 6 && r2.estado().fila; i++) { rel2.avancar(REENVIO_MS); await tick(20); }
  caso('fila cheia de eventos com camadas: lotes abaixo de 64 KiB, tudo entregue, nenhum 400', naFila === 90
    && servidor.recebidos.length === 90 && servidor.status.every(([b, st]) => st === 200 && b <= 65536) && r2.estado().fila === 0,
    J([naFila, servidor.recebidos.length, servidor.status, r2.estado().fila]));

  // evento sozinho maior que o limite: perde as camadas (fica a da regra 7) e marca camadasCortadas
  const col3 = coletorFalso();
  const rel3 = relogio();
  const r3 = criarRegistroExpansoes({ enviar: enviarAoColetor(col3.f), agendar: rel3.agendar, limpar: rel3.limpar, agora: rel3.agoraMs, depoisMs: 0 });
  r3.abrir({ origem: 'modal', motivo: 'x', camadas: Array.from({ length: 60 }, (_, k) => camadaGorda(k)) });
  rel3.avancar(1); await tick();
  const ev3 = col3.recebidos[0];
  caso('evento maior que o lote: sai com camadasCortadas e só a camada que expande', ev3 && ev3.camadasCortadas === true
    && ev3.camadas.length === 1 && ev3.camadas[0].expande === '.modal', J(ev3 && { n: ev3.camadas.length, c: ev3.camadasCortadas }));

  // 400 do coletor (corpo recusado): o lote sai da fila e conta como descartado; a fila não trava
  const col4 = coletorFalso([400]);
  const rel4 = relogio();
  const logs4 = [];
  const r4 = criarRegistroExpansoes({ enviar: enviarAoColetor(col4.f), agendar: rel4.agendar, limpar: rel4.limpar, agora: rel4.agoraMs, depoisMs: 0, log: m => logs4.push(m) });
  r4.abrir({ origem: 'modal', motivo: 'a' });
  rel4.avancar(1); await tick();
  r4.abrir({ origem: 'modal', motivo: 'b' });
  rel4.avancar(1); await tick();
  rel4.avancar(REENVIO_MS); await tick();
  const st4 = r4.estado();
  caso('coletor responde 400: o lote recusado sai (descartado, avisado no log) e os eventos seguintes chegam', st4.fila === 0 && st4.descartados === 0
    && col4.recebidos.some(e => e.motivo === 'b') && col4.recebidos.some(e => e.tipo === 'fim') && logs4.some(l => /recusou o lote \(400\)/.test(l)),
    J([st4, col4.chamadas.length, col4.recebidos.map(e => [e.tipo, e.motivo]), logs4]));
}

// ---------- 10. guardrails ----------
{
  const fonte = readFileSync(fileURLToPath(new URL('../pengu/compacto/expansoes.js', import.meta.url)), 'utf8');
  caso('expansoes.js: nenhuma chamada à LCU (/lol-) nem ao DOM no topo do módulo', !/['"`]\/lol-/.test(fonte) && !/^\s*(document|window)\./m.test(fonte));
  caso('a regra 7 segue a mesma lista (o registro não muda o que expande)', MODAIS.gatilho.includes('.modal') && MODAIS.conhecidos.includes('.ready-check-root-element'));
  const s = cenario(); // sem marcarPronto: nada muda, nada sai
  s.rot.aoFase('Lobby'); await tick();
  caso('sem expansão, nada sai (início em expandido e entrada no compacto não são eventos)', s.eventos().length === 0 && s.registro.estado().aberta === null);
}

relatar(casos);
