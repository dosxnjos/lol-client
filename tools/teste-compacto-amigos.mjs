// Testa os amigos do compacto (etapa 2 de roadmap/2026-10-16-compacto-chat-amigos-perfil.md; pedido do Gabriel de 16/10/2026: grupos
// da lista de amigos no topo e reordenáveis "da mesma maneira que ocorre no modo expandido", o menu do clique direito com as mesmas
// opções do client, e arrastar o amigo até a janela principal = convite para o lobby já criado).
// Sem o client: lateral de verdade (compacto/lateral.js), DOM mínimo feito aqui, LCU falsa que registra método, rota e corpo de cada
// escrita (tools/lcu-falsa.mjs) e a fixture tests/fixtures/social-amigos.json (formato medido em 16/10/2026, nomes inventados).
// O que segura: ordem e rótulos dos grupos como a Riot; reordenar manda EXATAMENTE os PUTs do saveGroupOrder (priority = length −
// índice, nunca num grupo meta); menu com os itens, a ordem e os estados do roster da Riot; cada saída do diálogo manda só a sua
// rota; convite só no Lobby com lobby criado (botão, menu e soltar na coluna, a mesma regra); nada escreve sem o gesto dele.
// uso: node tools/teste-compacto-amigos.mjs
import { readFileSync } from 'node:fs';
import { relatar, lcuFalsa } from './lcu-falsa.mjs';
import { lcu as lcuReal } from '../pengu/compacto/comum.js';
import { criarLateral } from '../pengu/compacto/lateral.js';
import { verAmigos, lobbyParaConvite } from '../pengu/compacto/lateral-chat.js';
import { ordenarGrupos, secoesAmigos, novaOrdem, corpoRecolher, validarNomePasta, corpoNovaPasta, podeConvidar, itensMenu, itensMenuGrupo, corpoEspectar,
  lerPodeAssistir, recebeuMensagem, vaoDeSoltar, podeReordenar, rotuloGrupo, TEXTOS_RIOT } from '../pengu/compacto/amigos.js';

const FX = JSON.parse(readFileSync(new URL('../tests/fixtures/social-amigos.json', import.meta.url), 'utf8'));
const copia = v => JSON.parse(JSON.stringify(v));
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const amigo = pid => copia(FX.amigos.find(a => a.pid === pid));
const GRUPO = id => copia(FX.grupos.find(g => g.id === id));

// ---------- DOM mínimo (o dos outros testes do compacto; append(null) quebra, como seria "null" na tela) ----------
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
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.doc = doc; this.ownerDocument = doc; this.parentNode = null; this.childNodes = [];
    this.classList = new Classes(); this.dataset = {}; this.attrs = new Map(); this.ouvintes = {}; this.id = '';
    const est = {}; est.setProperty = (k, v) => { est[k] = v; }; this.style = est; this.value = ''; this.scrollTop = 0; this.checked = false; this.disabled = false;
  }
  get className() { return this.classList.toString(); }
  set className(v) { this.classList.s = new Set(String(v).split(/\s+/).filter(Boolean)); }
  setAttribute(k, v) { if (k === 'id') this.id = String(v); else if (k === 'class') this.className = v; else if (k === 'type') this.type = String(v); else this.attrs.set(k, String(v)); }
  getAttribute(k) { return k === 'id' ? this.id : this.attrs.get(k) ?? null; }
  removeAttribute(k) { this.attrs.delete(k); }
  hasAttribute(k) { return this.attrs.has(k); }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  append(...ns) {
    for (let n of ns) {
      if (n === null || n === undefined) throw new Error('append(null): no client isto vira o texto "null"');
      if (typeof n === 'string') n = new Texto(n);
      if (n.parentNode) n.remove();
      n.parentNode = this; this.childNodes.push(n);
    }
  }
  appendChild(n) { this.append(n); return n; }
  insertBefore(n, ref) { if (n.parentNode) n.remove(); n.parentNode = this; const i = this.childNodes.indexOf(ref); this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n); return n; }
  remove() { if (this.parentNode) { const l = this.parentNode.childNodes; l.splice(l.indexOf(this), 1); } this.parentNode = null; }
  replaceChildren(...ns) { for (const n of [...this.childNodes]) n.parentNode = null; this.childNodes = []; this.append(...ns); }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this.replaceChildren(new Texto(v)); }
  get isConnected() { let p = this; while (p.parentNode) p = p.parentNode; return p === this.doc.documentElement; }
  contains(n) { for (let p = n; p; p = p.parentNode) if (p === this) return true; return false; }
  addEventListener(ev, fn) { (this.ouvintes[ev] ||= []).push(fn); }
  // evento que sobe pela árvore; extra = {isTrusted, key, shiftKey, depois, dataTransfer...}; devolve o evento (defaultPrevented)
  disparar(ev, extra = {}) {
    const e = { type: ev, target: this, defaultPrevented: false, stopPropagation() {}, preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (let n = this; n; n = n.parentNode) { e.currentTarget = n; for (const fn of n.ouvintes?.[ev] || []) fn(e); }
    return e;
  }
  click(extra) { return this.disparar('click', extra); }
  focus() { this.doc.ativo = this; }
  select() {}
  matches(sel) {
    const m = String(sel).match(/^([a-z0-9-]*)((?:\.[\w-]+)*)(#[\w-]+)?((?:\[[^\]]+\])*)$/i);
    if (!m) throw new Error('seletor não suportado: ' + sel);
    if (m[1] && m[1].toUpperCase() !== this.tagName) return false;
    for (const c of m[2].split('.').filter(Boolean)) if (!this.classList.contains(c)) return false;
    if (m[3] && this.id !== m[3].slice(1)) return false;
    for (const a of m[4].match(/\[[^\]]+\]/g) || []) {
      const [, k, v] = a.match(/^\[([\w-]+)(?:="?([^"\]]*)"?)?\]$/);
      const dk = k.startsWith('data-') ? k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase()) : null;
      const valor = dk ? this.dataset[dk] : this.getAttribute(k);
      if (v === undefined ? valor === undefined || valor === null : String(valor) !== v) return false;
    }
    return true;
  }
  *desc() { for (const n of this.children) { yield n; yield* n.desc(); } }
  casa(sel) {
    const alts = String(sel).split(',').map(s => s.trim());
    if (alts.length > 1) return alts.some(a => this.casa(a));
    const partes = String(sel).trim().split(/\s+/);
    if (!this.matches(partes.pop())) return false;
    let n = this.parentNode;
    for (let i = partes.length - 1; i >= 0; i--) {
      while (n && n.nodeType === 1 && !n.matches(partes[i])) n = n.parentNode;
      if (!n || n.nodeType !== 1) return false;
      n = n.parentNode;
    }
    return true;
  }
  closest(sel) { for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.matches(sel)) return n; return null; }
  querySelector(sel) { for (const n of this.desc()) if (n.casa(sel)) return n; return null; }
  querySelectorAll(sel) { return [...this.desc()].filter(n => n.casa(sel)); }
}
function novoDoc() {
  const doc = {};
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

// =================== 1. grupos (puros) ===================
{
  const gs = ordenarGrupos(FX.grupos);
  caso('grupos na ordem da Riot (_groupSort: prioridade maior primeiro): Tropa 4, Geral 3, Riot Mobile 2, Offline 1 ("tropa no topo")',
    igual(gs.map(g => g.id), [1, 0, 10001, 10000]) && igual(gs.map(rotuloGrupo), ['Tropa', 'Geral', 'Riot Mobile', 'Offline']), JSON.stringify(gs.map(g => [g.id, g.priority])));
  caso('empate de prioridade: nome em minúsculas decide; lista torta (sem id, sem nome, repetido) não entra; não lista = null',
    igual(ordenarGrupos([{ id: 2, name: 'b', priority: 1 }, { id: 3, name: 'A', priority: 1 }, { id: 2, name: 'x', priority: 9 }, { name: 'sem id' }, null]).map(g => g.id), [3, 2])
      && ordenarGrupos(null) === null && ordenarGrupos({}) === null);
  const v = verAmigos({ amigos: copia(FX.amigos), conversas: [], lobby: lobbyParaConvite({ ok: true, status: 200, json: FX.lobby }), fase: 'Lobby', eu: FX.eu, grupos: gs, agoraMs: 1e12 });
  const sec = Object.fromEntries(v.secoes.map(s => [s.rotulo, s]));
  caso('amigos por displayGroupId (a exibição da Riot): Tropa 2/2, Geral 5/5, Riot Mobile 1/1 recolhido, Offline 0/1 (o amigo offline do Geral fica no Offline)',
    igual(v.secoes.map(s => [s.rotulo, s.online, s.total, s.recolhido]), [['Tropa', 2, 2, false], ['Geral', 5, 5, false], ['Riot Mobile', 1, 1, true], ['Offline', 0, 1, false]])
      && sec.Offline.amigos[0].pid === 'a3@br1.pvp.net' && sec['Riot Mobile'].amigos[0].pid === 'a4@br1.pvp.net', JSON.stringify(v.secoes.map(s => [s.rotulo, s.amigos.map(a => a.pid)])));
  const sem0 = secoesAmigos(gs.filter(g => g.id !== 0), [{ pid: 'x', grupoId: 777, dot: 'chat' }, { pid: 'y', grupoId: 0, dot: 'off' }]);
  caso('grupo desconhecido vai para o Geral; sem o grupo 0 na lista, um Geral só local (virtual: nunca recebe escrita)',
    sem0.find(s => s.id === 0)?.virtual === true && sem0.find(s => s.id === 0).total === 2 && sem0.find(s => s.id === 0).cru === null, JSON.stringify(sem0));
  caso('sem a leitura dos grupos: secoes null (a lista volta ao desenho de antes)', verAmigos({ amigos: copia(FX.amigos), grupos: null }).secoes === null);

  // reordenar: o critério de aceite do plano, ao pé da letra
  const r = novaOrdem(gs, 0, 0);
  caso('arrastar Geral para cima manda EXATAMENTE PUT …/0 {…priority:4} e PUT …/1 {…priority:3} (saveGroupOrder v2, objeto como lido); metas sem PUT',
    igual(r.puts, [{ id: 0, corpo: { ...GRUPO(0), priority: 4 } }, { id: 1, corpo: { ...GRUPO(1), priority: 3 } }]) && igual(r.ordem.map(g => g.id), [0, 1, 10001, 10000]), JSON.stringify(r.puts));
  caso('soltar no mesmo vão não manda nada (guarda r===t || r===t−1 do moveGroup)', novaOrdem(gs, 1, 0).puts.length === 0 && novaOrdem(gs, 1, 1).puts.length === 0 && novaOrdem(gs, 0, 2).puts.length === 0);
  caso('grupo meta não se arrasta; vão fora da faixa não faz nada', novaOrdem(gs, 10000, 0).puts.length === 0 && novaOrdem(gs, 1, 9).puts.length === 0 && novaOrdem(gs, 1, -1).puts.length === 0);
  // com uma pasta criada (prioridade 5): toda combinação de grupo × vão nunca põe PUT num meta e sempre usa length − índice
  const com = ordenarGrupos([...copia(FX.grupos), { id: 7, name: 'Duo', priority: 5, isMetaGroup: false, isLocalized: false, collapsed: false }]);
  let ruins = [];
  for (const g of com) for (let p = 0; p <= 4; p++) {
    const x = novaOrdem(com, g.id, p);
    for (const put of x.puts) {
      const i = x.ordem.findIndex(y => y.id === put.id);
      if (put.corpo.isMetaGroup || put.corpo.priority !== x.ordem.length - i) ruins.push([g.id, p, put]);
    }
  }
  caso('5 pastas × todos os vãos: nenhum PUT em meta, prioridade sempre length − índice (não o 100 − n do módulo velho)', ruins.length === 0, JSON.stringify(ruins.slice(0, 3)));
  // prioridades com buracos (pasta excluída, metas com números da Riot): a ordem nova mudaria a prioridade dos metas, e mesmo assim
  // eles nunca recebem PUT (saveGroupOrder pula isMetaGroup)
  const buracos = ordenarGrupos([{ id: 1, name: 'Tropa', priority: 10, isMetaGroup: false }, { id: 0, name: '**Default', priority: 9, isMetaGroup: false },
    { id: 10001, name: 'MOBILE', priority: 5, isMetaGroup: true }, { id: 10000, name: 'OFFLINE', priority: 4, isMetaGroup: true }]);
  const rb = novaOrdem(buracos, 0, 0);
  caso('prioridades com buracos: Geral para cima = PUT …/0 priority 4 e …/1 priority 3; os metas (5 e 4) ficam sem PUT',
    igual(rb.puts.map(p => [p.id, p.corpo.priority]), [[0, 4], [1, 3]]), JSON.stringify(rb.puts));
  const fim = novaOrdem(com, 7, 3);
  caso('Duo (5) para depois do Geral: Tropa 5, Geral 4, Duo 3 (os metas seguem 2 e 1)', igual(fim.puts.map(p => [p.id, p.corpo.priority]), [[1, 5], [0, 4], [7, 3]]), JSON.stringify(fim.puts));
  caso('vão de soltar: metade de cima do cabeçalho = antes, de baixo = depois (índice entre os não metas)',
    vaoDeSoltar(gs, 1, false) === 0 && vaoDeSoltar(gs, 1, true) === 1 && vaoDeSoltar(gs, 0, true) === 2 && vaoDeSoltar(gs, 10000, true) === -1);
  caso('reordenar: só com 2+ pastas não meta e com os grupos lidos', podeReordenar(gs).ok && !podeReordenar(null).ok && !podeReordenar(gs.filter(g => g.id !== 1)).ok);
  caso('recolher = o grupo como lido com collapsed trocado (toggleCollapse v2)', igual(corpoRecolher(GRUPO(0)), { ...GRUPO(0), collapsed: true }) && corpoRecolher(GRUPO(10001)).collapsed === false);
  caso('nome de pasta (validateGroupName): vazio, já existe (inclui "geral" e o nome do meta), reservado, renomear para o mesmo = nada',
    validarNomePasta('  ', gs) === TEXTOS_RIOT.pastaVazia && validarNomePasta('tropa', gs) === TEXTOS_RIOT.pastaExiste && validarNomePasta('Geral', gs) === TEXTOS_RIOT.pastaExiste
      && validarNomePasta('offline', gs) === TEXTOS_RIOT.pastaExiste && validarNomePasta('Riot Mobile', gs) === TEXTOS_RIOT.pastaReservada && validarNomePasta('Duo', gs) === ''
      && validarNomePasta('TROPA', gs, 1) === 'igual');
  caso('criar pasta (createGroup): {name, priority: maior + 1}', igual(corpoNovaPasta(gs, ' Duo '), { name: 'Duo', priority: 5 }));
}

// =================== 2. convite e menu (puros) ===================
{
  const gs = ordenarGrupos(FX.grupos);
  const lob = (extra = {}) => lobbyParaConvite({ ok: true, status: 200, json: { ...copia(FX.lobby), ...extra } });
  const pc = (pid, fase = 'Lobby', lobby = lob(), more = {}) => podeConvidar({ f: amigo(pid), fase, lobby, eu: FX.eu, agoraMs: 1e12, ...more });
  caso('convite: amigo livre (chat) e ausente no Lobby com lobby criado = ok', pc('a1@br1.pvp.net').ok && pc('a5@br1.pvp.net').ok);
  caso('convite: em partida e na fila ficam cinza com o motivo (a Riot acende e recusa depois: checkIfPlayerAvailable)',
    !pc('a2@br1.pvp.net').ok && /em partida/.test(pc('a2@br1.pvp.net').motivo) && /na fila/.test(pc('a6@br1.pvp.net').motivo) && pc('a2@br1.pvp.net').mostra);
  caso('convite: offline, celular e outro jogo nem aparecem (isInvitableViaLeague)', !pc('a3@br1.pvp.net').mostra && !pc('a4@br1.pvp.net').mostra && !pc('a8@br1.pvp.net').mostra);
  caso('convite só no Lobby com o lobby criado ("o jogo sempre tem que estar no lobby"): fila, seleção, sem lobby e lobby ilegível = cinza',
    /busca está em andamento/.test(pc('a1@br1.pvp.net', 'Matchmaking').motivo) && /abra o lobby/.test(pc('a1@br1.pvp.net', 'ChampSelect').motivo)
      && /abra o lobby/.test(pc('a1@br1.pvp.net', 'None', lobbyParaConvite({ ok: false, status: 404 })).motivo)
      && /não foi possível ler o lobby/.test(pc('a1@br1.pvp.net', 'Lobby', lobbyParaConvite({ ok: false, status: 500 })).motivo)
      && !pc('a1@br1.pvp.net', 'Lobby', lobbyParaConvite({ ok: false, status: 404 })).ok);
  caso('convite: não líder sem convite liberado, grupo cheio, já no grupo e convite recente = cinza',
    /só o líder/.test(pc('a1@br1.pvp.net', 'Lobby', lob({ localMember: { isLeader: false, allowedInviteOthers: false } })).motivo)
      && /cheio/.test(pc('a1@br1.pvp.net', 'Lobby', lob({ members: [1, 2, 3, 4, 5].map(n => ({ puuid: 'm' + n })) })).motivo)
      && /já está no seu grupo/.test(pc('a1@br1.pvp.net', 'Lobby', lob({ members: [{ puuid: 'pa1' }] })).motivo)
      && pc('a1@br1.pvp.net', 'Lobby', lob(), { convidados: new Map([['a1@br1.pvp.net', 1e12 - 1000]]) }).rotulo === 'convidado');

  const rot = it => it.map(i => i.a);
  const m1 = itensMenu(amigo('a1@br1.pvp.net'), { grupos: gs, convite: pc('a1@br1.pvp.net') });
  caso('menu do amigo livre: Convidar, Enviar mensagem, Exibir perfil, Adicionar anotação, Mover, Desfazer amizade/Bloquear (ordem do roster da Riot)',
    igual(rot(m1), ['convidar', 'mensagem', 'perfil', 'nota', 'mover', 'remover']) && m1[0].rotulo === 'Convidar para partida' && !m1[0].off && m1[3].rotulo === 'Adicionar anotação'
      && m1.at(-1).perigo === true, JSON.stringify(m1));
  const mover = m1.find(i => i.a === 'mover');
  caso('Mover ›: todas as pastas em maiúsculas; a atual e os metas cinza (makeMoveToContextMenuItem)',
    igual(mover.sub.map(s => [s.rotulo, s.off]), [['TROPA', true], ['GERAL', false], ['RIOT MOBILE', true], ['OFFLINE', true]]), JSON.stringify(mover.sub));
  const a2 = amigo('a2@br1.pvp.net');
  const m2v = itensMenu(a2, { grupos: gs, convite: pc('a2@br1.pvp.net'), assistir: { estado: 'verificando' } });
  const m2ok = itensMenu(a2, { grupos: gs, convite: pc('a2@br1.pvp.net'), assistir: lerPodeAssistir({ ok: true, json: { availableForWatching: true } }, a2) });
  const m2no = itensMenu(a2, { grupos: gs, convite: pc('a2@br1.pvp.net'), assistir: lerPodeAssistir({ ok: true, json: { availableForWatching: false, reason: 'x' } }, a2) });
  const m2er = itensMenu(a2, { grupos: gs, convite: pc('a2@br1.pvp.net'), assistir: lerPodeAssistir({ ok: false, status: 500 }, a2) });
  const ass = m => m.find(i => i.a === 'assistir');
  caso('amigo em partida: Assistir partida depois de Enviar mensagem; cinza enquanto verifica, aceso com can-spectate true, cinza com o texto da Riot, some no erro',
    igual(rot(m2ok), ['convidar', 'mensagem', 'assistir', 'perfil', 'nota', 'mover', 'remover']) && ass(m2v).off && !ass(m2ok).off && ass(m2no).off
      && ass(m2no).motivo === TEXTOS_RIOT.espectadorFila && !ass(m2er) && m2ok[0].off, JSON.stringify(m2no));
  const a9 = amigo('a9@br1.pvp.net');
  caso('personalizada que não pode ser assistida: a dica da Riot para personalizada', lerPodeAssistir({ ok: true, json: { availableForWatching: false } }, a9).dica === TEXTOS_RIOT.espectadorPersonalizada);
  caso('offline: sem Convidar, sem Assistir e sem Mover (pasta automática), com Desfazer amizade/Bloquear',
    igual(rot(itensMenu(amigo('a3@br1.pvp.net'), { grupos: gs, convite: pc('a3@br1.pvp.net') })), ['mensagem', 'perfil', 'nota', 'remover']));
  caso('celular: sem Convidar e sem Mover', igual(rot(itensMenu(amigo('a4@br1.pvp.net'), { grupos: gs, convite: pc('a4@br1.pvp.net') })), ['mensagem', 'perfil', 'nota', 'remover']));
  caso('com anotação: "Editar anotação"', itensMenu(amigo('a5@br1.pvp.net'), { grupos: gs }).find(i => i.a === 'nota').rotulo === 'Editar anotação');
  caso('sem os grupos lidos: Mover some', !itensMenu(amigo('a1@br1.pvp.net'), { grupos: null }).some(i => i.a === 'mover'));
  const den = d => itensMenu(amigo('a1@br1.pvp.net'), { grupos: gs, denuncia: d }).find(i => i.a === 'denunciar');
  caso('Denunciar: some sem a denúncia de mensagem ligada; cinza sem mensagem recebida ou já denunciado (textos da Riot); aceso com mensagem dele',
    !den({ ligada: false }) && den({ ligada: true, recebeu: false }).off && den({ ligada: true, recebeu: false }).motivo === TEXTOS_RIOT.semMensagem
      && den({ ligada: true, recebeu: true, denunciado: true }).motivo === TEXTOS_RIOT.jaDenunciado && !den({ ligada: true, recebeu: true }).off);
  caso('mensagem recebida = alguma dele que não é de sistema (hasReceivedMessageFromMember)',
    recebeuMensagem([{ fromId: 'eu', type: 'chat' }, { fromId: 'a', type: 'system' }], 'eu') === false && recebeuMensagem([{ fromId: 'a', type: 'chat' }], 'eu') === true);
  caso('espectador (spectateGame): id do jogo = NAME do amigo (≠ gameName), puuid e chave dele',
    igual(corpoEspectar(a2), { dropInSpectateGameId: 'amigo2nome', gameQueueType: 'RANKED_SOLO_5x5', allowObserveMode: 'ALL', puuid: 'pa2', spectatorKey: 'chave-espectador-a2' }));
  caso('espectador de quem está assistindo: o jogo e o puuid de quem ele assiste, a chave dele',
    igual(corpoEspectar(amigo('a7@br1.pvp.net')), { dropInSpectateGameId: 'jogo-assistido-a7', gameQueueType: 'RANKED_FLEX_SR', allowObserveMode: 'ALL', puuid: 'puuid-assistido-a7', spectatorKey: 'chave-espectador-a7' }));
  const secs = secoesAmigos(gs, []);
  caso('menu da pasta: Renomear/Excluir acesos numa pasta criada, cinza no Geral e nas automáticas',
    itensMenuGrupo(secs[0]).every(i => !i.off) && itensMenuGrupo(secs[1]).every(i => i.off) && itensMenuGrupo(secs[2]).every(i => i.off));
}

// =================== 3. lateral de verdade: DOM, LCU falsa, gestos ===================
function cenario({ fase = 'Lobby', dm = false, semGrupos = false } = {}) {
  const doc = novoDoc();
  globalThis.document = doc;
  const est = { grupos: copia(FX.grupos), amigos: copia(FX.amigos), lobby: copia(FX.lobby), falhar: null, dm };
  const MSG_A2 = [{ id: 'm1', type: 'chat', body: 'gg', fromId: 'a2@br1.pvp.net', timestamp: '2026-10-16T12:00:00.000Z' }];
  const ok = (st = 200) => () => (est.falhar ? { status: est.falhar, json: {} } : { status: st, json: {} });
  const rotas = {
    'GET /lol-chat/v1/me': FX.eu, 'GET /lol-chat/v1/friends': () => est.amigos, 'GET /lol-chat/v2/friend-requests': [], 'GET /lol-chat/v1/player-mutes': {},
    'GET /lol-chat/v1/friend-groups': () => (semGrupos ? { status: 500, json: {} } : est.grupos),
    'GET /lol-lobby/v2/lobby': () => (est.lobby ? est.lobby : { status: 404, json: { message: 'sem lobby' } }),
    'GET /lol-chat/v1/conversations': [{ id: 'a2@br1.pvp.net', pid: 'a2@br1.pvp.net', type: 'chat', unreadMessageCount: 0, gameName: 'amigo 2', password: 'NUNCA', lastMessage: MSG_A2[0] }],
    [`GET /lol-chat/v1/conversations/${encodeURIComponent('a2@br1.pvp.net')}/messages`]: MSG_A2,
    'GET /lol-spectator/v3/buddy/can-spectate/pa2/chave-espectador-a2': { availableForWatching: true, reason: '' },
    'GET /lol-spectator/v3/buddy/can-spectate/pa9/chave-espectador-a9': { availableForWatching: false, reason: 'x' },
    'GET /lol-client-config/v3/client-config/lol.client_settings.dm_reporting.enabled': () => (est.dm ? true : { status: 404, json: {} }),
    'GET /lol-player-report-sender/v1/direct-message-reports': [],
    'GET /lol-summoner/v1/profile-privacy-enabled': 'DISABLED',
    'POST /lol-lobby/v2/lobby/invitations': ok(), 'POST /lol-spectator/v1/spectate/launch': ok(204), 'POST /lol-chat/v1/blocked-players': ok(),
    'POST /lol-player-report-sender/v1/direct-message-reports': ok(204), 'POST /lol-chat/v1/friend-groups': ok(),
  };
  // PUT de pasta aceito fica gravado (a próxima leitura devolve o que a Riot guardaria)
  for (const g of FX.grupos) {
    rotas[`PUT /lol-chat/v1/friend-groups/${g.id}`] = c => { if (est.falhar) return { status: est.falhar, json: {} }; est.grupos = est.grupos.map(x => (x.id === g.id ? { ...c } : x)); return { status: 200, json: {} }; };
    rotas[`DELETE /lol-chat/v1/friend-groups/${g.id}`] = ok(204);
  }
  for (const a of FX.amigos) { rotas[`PUT /lol-chat/v1/friends/${encodeURIComponent(a.id)}`] = ok(); rotas[`DELETE /lol-chat/v1/friends/${encodeURIComponent(a.id)}`] = ok(204); }
  const falsa = lcuFalsa(rotas);
  const s = { doc, est, falsa, avisos: [], logs: [], expandiu: 0 };
  const cfg = { compacto: { ligado: true, larg: 420, alt: 680 } };
  const rot = { pedirLateral() {}, medidasJanela: () => ({ col: 420 }), expandir() { s.expandiu++; }, estado: () => ({}) };
  s.lat = criarLateral({ cfg, rot: () => rot, doc, lcu: (m, u, c) => lcuReal(m, u, c, falsa.fetch), avisar: (m, e) => s.avisos.push([m, !!e]), log: (...a) => s.logs.push(a.map(String).join(' ')),
    repetir: () => 1, pararRepetir: () => {}, agora: () => 1e12 });
  const esq = new El('aside', doc), dir = new El('aside', doc), coluna = new El('div', doc), camada = new El('div', doc);
  coluna.classList.add('lc-cp-coluna');
  camada.append(esq, coluna, dir); doc.body.append(camada);
  s.partes = { esq, dir, coluna, camada };
  s.preparar = async () => {
    s.lat.aoFase(fase); s.lat.anexar(s.partes); s.lat.aoEfetivo('compacto'); await tick();
    s.lat.alternarLista(); await tick(12); await s.lat.lerAmigos(); await tick();
  };
  s.lista = () => dir.querySelector('[data-painel="lista"]');
  s.linha = pid => s.lista().querySelectorAll('[data-a="lt-amigo"]').find(n => n.dataset.pid === pid);
  s.cab = gid => s.lista().querySelectorAll('[data-a="lt-grupo"]').find(n => n.dataset.gid === String(gid));
  s.item = a => s.lista().querySelector(`[data-a="lt-m-${a}"]`);
  s.dlg = a => s.lista().querySelector(`[data-a="lt-dlg-${a}"]`);
  s.escritas = () => falsa.escritas().map(c => ({ m: c.metodo, u: c.url, c: c.corpo }));
  s.zerar = () => { falsa.chamadas.length = 0; s.avisos.length = 0; };
  s.menu = async (pid, extra = {}) => { s.linha(pid).disparar('contextmenu', extra); await tick(12); };
  s.dt = () => { const d = { dados: {}, setData(k, v) { this.dados[k] = v; }, getData(k) { return this.dados[k]; }, dropEffect: '', effectAllowed: '' }; return d; };
  return s;
}

{
  const s = cenario();
  await s.preparar();
  const cabs = s.lista().querySelectorAll('[data-a="lt-grupo"]');
  caso('lista com os grupos da Riot no topo e na ordem dela: Tropa, Geral, Riot Mobile, Offline; contagem online/total',
    igual(cabs.map(c => c.dataset.gid), ['1', '0', '10001', '10000']) && /Tropa \(2\/2\)/.test(cabs[0].textContent) && /Geral \(5\/5\)/.test(cabs[1].textContent)
      && /Offline \(0\/1\)/.test(cabs[3].textContent), cabs.map(c => c.textContent).join(' | '));
  caso('Riot Mobile recolhido como a Riot gravou (amigo 4 não aparece); Offline aberto (amigo 3 aparece); Tropa no topo com amigo 1',
    !s.linha('a4@br1.pvp.net') && !!s.linha('a3@br1.pvp.net') && s.lista().querySelectorAll('[data-a="lt-amigo"]')[0].dataset.pid === 'a1@br1.pvp.net');
  caso('só pasta não meta se arrasta (draggable); linhas de amigo arrastáveis e com foco de teclado',
    s.cab(1).getAttribute('draggable') === 'true' && s.cab(0).getAttribute('draggable') === 'true' && s.cab(10000).getAttribute('draggable') === null
      && s.linha('a1@br1.pvp.net').getAttribute('draggable') === 'true' && s.linha('a1@br1.pvp.net').getAttribute('tabindex') === '0');

  // recolher
  s.zerar();
  s.cab(0).click({ isTrusted: false }); await tick();
  caso('recolher com clique sintético: nada sai', s.escritas().length === 0);
  s.cab(0).click(); await tick();
  caso('recolher Geral (clique dele): PUT /lol-chat/v1/friend-groups/0 com o grupo como lido e collapsed true; os amigos dele somem da lista',
    igual(s.escritas(), [{ m: 'PUT', u: '/lol-chat/v1/friend-groups/0', c: { ...GRUPO(0), collapsed: true } }]) && !s.linha('a2@br1.pvp.net') && !!s.cab(0).querySelector('[data-icone="fechado"]'), JSON.stringify(s.escritas()));
  s.zerar(); s.est.falhar = 500;
  s.cab(1).click(); await tick();
  caso('recolher que a Riot recusa: volta como estava e avisa com o status', !!s.linha('a1@br1.pvp.net') && s.avisos.some(([m, e]) => e && /500/.test(m)), JSON.stringify(s.avisos));
  s.est.falhar = null;

  // reordenar arrastando o cabeçalho (o critério de aceite)
  s.est.grupos = copia(FX.grupos); await s.lat.lerAmigos(); await tick();
  s.zerar();
  const dt = s.dt();
  s.cab(0).disparar('dragstart', { dataTransfer: dt });
  const sobre = s.cab(1).disparar('dragover', { dataTransfer: dt, depois: false });
  s.cab(1).disparar('drop', { dataTransfer: dt, depois: false, isTrusted: false }); await tick();
  caso('soltar pasta com evento sintético: nada sai (e a marca de soltar apareceu antes, com o dragover aceito)', s.escritas().length === 0 && sobre.defaultPrevented);
  s.cab(0).disparar('dragstart', { dataTransfer: s.dt() });
  s.cab(1).disparar('dragover', { depois: false });
  s.cab(1).disparar('drop', { depois: false }); await tick(12);
  caso('arrastar Geral para cima da Tropa: exatamente PUT …/0 {…priority:4} e PUT …/1 {…priority:3}, nesta ordem; a lista mostra Geral no topo',
    igual(s.escritas(), [{ m: 'PUT', u: '/lol-chat/v1/friend-groups/0', c: { ...GRUPO(0), priority: 4 } }, { m: 'PUT', u: '/lol-chat/v1/friend-groups/1', c: { ...GRUPO(1), priority: 3 } }])
      && igual(s.lista().querySelectorAll('[data-a="lt-grupo"]').map(c => c.dataset.gid), ['0', '1', '10001', '10000']), JSON.stringify(s.escritas()));
  s.zerar();
  const meta = s.cab(10000).disparar('dragstart', { dataTransfer: s.dt() });
  s.cab(1).disparar('drop', {}); await tick();
  caso('pasta automática (Offline) não começa arrasto; soltar sem arrasto não manda nada', meta.defaultPrevented && s.escritas().length === 0 && s.lat.amigos().arrasto === null);
  s.cab(1).disparar('dragstart', { dataTransfer: s.dt() });
  const sobreMeta = s.cab(10000).disparar('dragover', { depois: true });
  s.cab(10000).disparar('drop', { depois: true }); await tick();
  caso('pasta não se solta entre as automáticas (decisão 7): dragover recusado, nenhum PUT', !sobreMeta.defaultPrevented && s.escritas().length === 0);
  globalThis.document = undefined;
}

{
  // menu do clique direito: itens, sobrevive ao repintar, convidar, mover, anotação
  const s = cenario();
  await s.preparar();
  s.est.grupos = copia(FX.grupos); await s.lat.lerAmigos(); await tick();
  await s.menu('a1@br1.pvp.net');
  const itens = s.lista().querySelectorAll('.lc-lt-mi').map(b => b.textContent);
  caso('clique direito no amigo abre o menu com os itens da Riot', s.lat.amigos().menu === 'a:a1@br1.pvp.net'
    && igual(itens, ['Convidar para partida', 'Enviar mensagem', 'Exibir perfil', 'Adicionar anotação', 'Mover ', 'Desfazer amizade/Bloquear'])
    && !!s.lista().querySelector('.lc-lt-mseta [data-icone="fechado"]'), JSON.stringify(itens));
  const menuEl = s.lista().querySelector('[data-a="lt-menu"]');
  await s.lat.lerAmigos(); await s.lat.lerAmigos(); await tick();
  caso('o menu aberto sobrevive à releitura dos amigos (mora fora do corpo que repinta)', menuEl.isConnected && s.lat.amigos().menu === 'a:a1@br1.pvp.net' && menuEl.style.display !== 'none');
  s.zerar();
  s.item('convidar').click({ isTrusted: false }); await tick();
  caso('Convidar com clique sintético: nada sai', s.escritas().length === 0);
  await s.menu('a1@br1.pvp.net');
  s.item('convidar').click(); await tick(12);
  caso('Convidar para partida (clique dele): POST /lol-lobby/v2/lobby/invitations [{toSummonerId}] (invitePlayer do parties)',
    igual(s.escritas(), [{ m: 'POST', u: '/lol-lobby/v2/lobby/invitations', c: [{ toSummonerId: 201 }] }]) && s.lat.amigos().menu === null, JSON.stringify(s.escritas()));
  // teclado: Shift+F10 na linha abre o mesmo menu
  s.linha('a5@br1.pvp.net').disparar('keydown', { key: 'F10', shiftKey: true }); await tick();
  caso('Shift+F10 na linha abre o mesmo menu', s.lat.amigos().menu === 'a:a5@br1.pvp.net');
  // anotação
  s.zerar();
  s.item('nota').click(); await tick();
  const campo = s.lista().querySelector('[data-a="lt-campo"]');
  caso('Editar anotação abre o campo com a anotação atual', s.lat.amigos().campo && campo.value === 'joga de suporte');
  campo.value = 'main sup';
  campo.disparar('keydown', { key: 'Enter', isTrusted: false }); await tick();
  caso('Enter sintético no campo: nada sai', s.escritas().length === 0);
  s.item('nota')?.click(); // (o menu fechou; reabre pelo menu)
  await s.menu('a5@br1.pvp.net'); s.item('nota').click(); await tick();
  const campo2 = s.lista().querySelector('[data-a="lt-campo"]');
  campo2.value = 'main sup';
  campo2.disparar('keydown', { key: 'Enter' }); await tick(12);
  caso('anotação (saveNote): PUT /lol-chat/v1/friends/{id} com o amigo inteiro como lido e note novo',
    igual(s.escritas(), [{ m: 'PUT', u: `/lol-chat/v1/friends/${encodeURIComponent('a5@br1.pvp.net')}`, c: { ...amigo('a5@br1.pvp.net'), note: 'main sup' } }]), JSON.stringify(s.escritas()));
  // mover
  s.zerar();
  await s.menu('a1@br1.pvp.net');
  s.item('mover').click(); await tick();
  const destinos = s.lista().querySelectorAll('[data-a="lt-m-mover-para"]');
  destinos.find(d => d.dataset.gid === '1').click(); await tick(); // a atual (cinza): nada
  caso('Mover ›: submenu com as 4 pastas; a atual não faz nada', destinos.length === 4 && s.escritas().length === 0);
  s.lista().querySelectorAll('[data-a="lt-m-mover-para"]').find(d => d.dataset.gid === '0').click(); await tick(12);
  caso('Mover › Geral (setGroup): PUT /lol-chat/v1/friends/{id} com o amigo inteiro e groupId 0',
    igual(s.escritas()[0], { m: 'PUT', u: `/lol-chat/v1/friends/${encodeURIComponent('a1@br1.pvp.net')}`, c: { ...amigo('a1@br1.pvp.net'), groupId: 0 } }) && s.escritas().length === 1, JSON.stringify(s.escritas()));
  // perfil (etapa 3): abre ao lado, no painel da direita, sem expandir e sem escrita na LCU (só GET)
  s.zerar();
  await s.menu('a2@br1.pvp.net');
  s.item('perfil').click(); await tick(12);
  const pf = s.lat.estado().perfil;
  caso('Exibir perfil: o perfil dele ao lado (painel "perfil", puuid e summonerId do amigo), sem expandir e sem escrita na LCU',
    s.expandiu === 0 && s.lat.estado().painel === 'perfil' && pf?.puuid === 'pa2' && pf?.summonerId === 202 && s.escritas().length === 0
      && s.falsa.chamadas.some(c => c.url === '/lol-summoner/v2/summoners/puuid/pa2'), JSON.stringify([s.expandiu, s.lat.estado().painel, pf, s.escritas()]));
  s.lat.fecharPainel(); await tick();
  // Esc fecha o menu
  await s.menu('a1@br1.pvp.net');
  s.doc.ativo = null;
  s.lista().querySelector('[data-a="lt-menu"]').disparar('keydown', { key: 'Escape' });
  // revisão de 16/10/2026: o Esc deixava o foco no nada (teclado perdido no meio da lista); volta para a linha que abriu o menu
  caso('Esc fecha o menu sem escrever e devolve o foco à linha do amigo', s.lat.amigos().menu === null && s.doc.ativo === s.linha('a1@br1.pvp.net'), String(s.doc.ativo?.dataset?.pid));
  // clique fora fecha o menu e o campo (senão a lista ficaria congelada com o menu esquecido aberto); dentro do menu, não
  await s.menu('a1@br1.pvp.net');
  s.lista().querySelector('[data-a="lt-menu"]').disparar('pointerdown');
  const fica = s.lat.amigos().menu;
  s.partes.coluna.disparar('pointerdown');
  caso('clique fora fecha o menu (dentro dele, não) e a lista volta a repintar', fica === 'a:a1@br1.pvp.net' && s.lat.amigos().menu === null);
  s.lista().querySelector('[data-a="lt-nova-pasta"]').click(); await tick();
  s.lista().querySelector('[data-a="lt-campo"]').disparar('pointerdown');
  const campoFica = s.lat.amigos().campo;
  s.linha('a1@br1.pvp.net').disparar('pointerdown');
  caso('clique fora fecha o campo da pasta (no próprio campo, não)', campoFica === true && s.lat.amigos().campo === false);
  // a lista fecha: menu, diálogo e campo fecham juntos
  await s.menu('a1@br1.pvp.net');
  s.lat.alternarLista(); await tick();
  caso('fechar a lista fecha o menu aberto', s.lat.amigos().menu === null);
  globalThis.document = undefined;
}

{
  // assistir, desfazer amizade/bloquear e denunciar (com a denúncia de mensagem ligada)
  const s = cenario({ dm: true });
  await s.preparar();
  await s.menu('a2@br1.pvp.net'); await tick(12);
  const it = s.lista().querySelectorAll('.lc-lt-mi').map(b => [b.dataset.a, b.getAttribute('aria-disabled') === 'true']);
  caso('menu do amigo em partida com a denúncia ligada: Convidar cinza, Assistir aceso (can-spectate), Denunciar aceso (ele mandou mensagem)',
    igual(it.map(x => x[0]), ['lt-m-convidar', 'lt-m-mensagem', 'lt-m-assistir', 'lt-m-perfil', 'lt-m-nota', 'lt-m-mover', 'lt-m-remover', 'lt-m-denunciar'])
      && it[0][1] === true && it[2][1] === false && it[7][1] === false, JSON.stringify(it));
  s.zerar();
  s.item('assistir').click(); await tick(12);
  caso('Assistir partida (spectateGame): confere o perfil privado e manda POST /lol-spectator/v1/spectate/launch com o corpo da Riot',
    igual(s.escritas(), [{ m: 'POST', u: '/lol-spectator/v1/spectate/launch', c: { dropInSpectateGameId: 'amigo2nome', gameQueueType: 'RANKED_SOLO_5x5', allowObserveMode: 'ALL', puuid: 'pa2', spectatorKey: 'chave-espectador-a2' } }])
      && s.falsa.chamadas.some(c => c.url === '/lol-summoner/v1/profile-privacy-enabled'), JSON.stringify(s.escritas()));
  caso('nenhum aviso ou log leva a chave do espectador', ![...s.avisos.map(a => a[0]), ...s.logs].some(t => /chave-espectador/.test(t)));
  // caminhos de erro (revisão de 16/10/2026): a chave vai na URL do can-spectate e no corpo do launch; falha nenhum a escreve
  s.est.falhar = 500;
  await s.menu('a2@br1.pvp.net'); await tick(12);
  s.item('assistir').click(); await tick(12);
  s.est.falhar = null;
  await s.menu('a7@br1.pvp.net'); await tick(12); // can-spectate sem rota na LCU falsa: o GET falha e o item some
  caso('launch recusado e can-spectate com erro: avisa sem a chave, nada no log, e o item some no erro',
    s.avisos.some(([m, e]) => e && /não foi possível assistir \(500\)/.test(m)) && !s.item('assistir')
      && ![...s.avisos.map(a => a[0]), ...s.logs].some(t => /chave-espectador/.test(t)), JSON.stringify([s.avisos, s.logs]));
  s.lat.amigos().menu && s.lista().querySelector('[data-a="lt-menu"]').disparar('keydown', { key: 'Escape' });
  await s.menu('a9@br1.pvp.net'); await tick(12);
  const a9 = s.item('assistir');
  caso('personalizada fechada para espectador: Assistir cinza com o texto da Riot', a9.getAttribute('aria-disabled') === 'true' && a9.getAttribute('title') === TEXTOS_RIOT.espectadorPersonalizada);
  s.zerar(); a9.click(); await tick();
  caso('item cinza não faz nada', s.escritas().length === 0);
  await s.menu('a1@br1.pvp.net'); await tick(12);
  caso('Denunciar cinza para quem nunca mandou mensagem (texto da Riot)', s.item('denunciar').getAttribute('aria-disabled') === 'true' && s.item('denunciar').getAttribute('title') === TEXTOS_RIOT.semMensagem);

  // Desfazer amizade/Bloquear: ✕ nada; cada saída só a sua rota
  const abrirRemover = async pid => { await s.menu(pid); await tick(); s.item('remover').click(); await tick(); };
  s.zerar();
  await abrirRemover('a1@br1.pvp.net');
  const txt = s.lista().querySelector('[data-a="lt-dialogo"]').textContent;
  caso('diálogo Desfazer amizade/Bloquear com o texto da Riot, o Riot ID do amigo e a caixa "Também denunciar"',
    s.lat.amigos().dialogo && /Desfazer amizade\/Bloquear jogador/.test(txt) && /amigo 1#BR1/.test(txt) && /Também denunciar/.test(txt), txt);
  s.dlg('fechar').click(); await tick();
  caso('fechar do diálogo: nada sai', s.escritas().length === 0 && !s.lat.amigos().dialogo);
  await abrirRemover('a1@br1.pvp.net');
  s.dlg('desfazer').click({ isTrusted: false }); await tick();
  caso('Desfazer amizade com clique sintético: nada sai', s.escritas().length === 0);
  await abrirRemover('a1@br1.pvp.net');
  s.dlg('desfazer').click(); await tick(12);
  caso('Desfazer amizade: só DELETE /lol-chat/v1/friends/{id}', igual(s.escritas(), [{ m: 'DELETE', u: `/lol-chat/v1/friends/${encodeURIComponent('a1@br1.pvp.net')}`, c: undefined }]), JSON.stringify(s.escritas()));
  s.zerar();
  await abrirRemover('a1@br1.pvp.net');
  s.dlg('bloquear').click(); await tick(12);
  caso('Bloquear: só POST /lol-chat/v1/blocked-players {summonerId, puuid}', igual(s.escritas(), [{ m: 'POST', u: '/lol-chat/v1/blocked-players', c: { summonerId: 201, puuid: 'pa1' } }]), JSON.stringify(s.escritas()));
  s.zerar();
  await abrirRemover('a5@br1.pvp.net');
  s.lista().querySelector('[data-a="lt-dlg-caixa"]').checked = true;
  s.dlg('desfazer').click(); await tick(12);
  caso('Desfazer amizade com "Também denunciar": a denúncia sai DEPOIS do DELETE', igual(s.escritas().map(x => [x.m, x.u, x.c]),
    [['DELETE', `/lol-chat/v1/friends/${encodeURIComponent('a5@br1.pvp.net')}`, undefined], ['POST', '/lol-player-report-sender/v1/direct-message-reports', { offenderPuuid: 'pa5' }]]), JSON.stringify(s.escritas()));
  // Denunciar (a2 mandou mensagem): "Também bloquear" já marcado; bloqueio depois da denúncia
  s.zerar();
  await s.menu('a2@br1.pvp.net'); await tick(12);
  s.item('denunciar').click(); await tick();
  caso('diálogo Denunciar com "Também bloquear" marcado', s.lista().querySelector('[data-a="lt-dlg-caixa"]').checked === true);
  s.dlg('cancelar').click(); await tick();
  caso('Cancelar: nada sai', s.escritas().length === 0);
  await s.menu('a2@br1.pvp.net'); await tick(12);
  s.item('denunciar').click(); await tick();
  s.dlg('denunciar').click(); await tick(12);
  caso('Denunciar: POST direct-message-reports {offenderPuuid} e, depois, POST blocked-players', igual(s.escritas().map(x => [x.m, x.u, x.c]),
    [['POST', '/lol-player-report-sender/v1/direct-message-reports', { offenderPuuid: 'pa2' }], ['POST', '/lol-chat/v1/blocked-players', { summonerId: 202, puuid: 'pa2' }]]), JSON.stringify(s.escritas()));
  globalThis.document = undefined;
}

{
  // pastas: criar, renomear, excluir (com confirmação), menu cinza no Geral
  const s = cenario();
  await s.preparar();
  s.zerar();
  const np = s.lista().querySelector('[data-a="lt-nova-pasta"]');
  np.click({ isTrusted: false }); await tick();
  caso('＋ pasta com clique sintético: nem abre', !s.lat.amigos().campo);
  np.click(); await tick();
  const campo = s.lista().querySelector('[data-a="lt-campo"]');
  campo.value = 'tropa'; campo.disparar('keydown', { key: 'Enter' }); await tick();
  caso('nome repetido: o erro da Riot no campo e nada sai', s.escritas().length === 0 && /Nome da pasta já existente/.test(s.lista().querySelector('[data-a="lt-campo-cx"]').textContent));
  campo.value = 'Duo'; campo.disparar('keydown', { key: 'Enter' }); await tick(12);
  caso('criar pasta: POST /lol-chat/v1/friend-groups {name, priority: maior + 1}', igual(s.escritas()[0], { m: 'POST', u: '/lol-chat/v1/friend-groups', c: { name: 'Duo', priority: 5 } }), JSON.stringify(s.escritas()));
  s.cab(0).disparar('contextmenu'); await tick();
  caso('menu da pasta Geral: Renomear e Excluir cinza', s.lista().querySelectorAll('.lc-lt-mi').every(b => b.getAttribute('aria-disabled') === 'true'));
  s.zerar();
  s.cab(1).disparar('contextmenu'); await tick();
  s.item('renomear').click(); await tick();
  const c2 = s.lista().querySelector('[data-a="lt-campo"]');
  caso('Renomear pasta: o campo nasce com o nome', c2.value === 'Tropa');
  caso('clique direito no campo não abre o menu do navegador (preventDefault)', s.lista().querySelector('[data-a="lt-campo-cx"]').disparar('contextmenu').defaultPrevented);
  c2.value = 'Tropa 2'; c2.disparar('keydown', { key: 'Enter' }); await tick(12);
  caso('renomear (saveGroup): PUT /lol-chat/v1/friend-groups/1 com o grupo como lido e o nome novo', igual(s.escritas()[0], { m: 'PUT', u: '/lol-chat/v1/friend-groups/1', c: { ...GRUPO(1), name: 'Tropa 2' } }), JSON.stringify(s.escritas()));
  s.zerar();
  s.cab(1).disparar('contextmenu'); await tick();
  s.item('excluir').click(); await tick();
  caso('Excluir pasta pede confirmação (nada sai antes)', s.lat.amigos().dialogo && s.escritas().length === 0);
  // revisão de 16/10/2026: o clique direito no diálogo e no campo só parava a subida, e o que suprime o menu do navegador no
  // document nunca rodava (o menu nativo do CEF podia abrir por cima)
  caso('clique direito no diálogo não abre o menu do navegador (preventDefault)', s.lista().querySelector('[data-a="lt-dialogo"]').disparar('contextmenu').defaultPrevented);
  s.dlg('excluir').click(); await tick(12);
  caso('excluir (deleteGroup): DELETE /lol-chat/v1/friend-groups/1', igual(s.escritas()[0], { m: 'DELETE', u: '/lol-chat/v1/friend-groups/1', c: undefined }), JSON.stringify(s.escritas()));
  globalThis.document = undefined;
}

{
  // arrastar o amigo para a coluna principal = convite (só no Lobby com lobby); para uma pasta = mover
  const s = cenario();
  await s.preparar();
  const col = s.partes.coluna;
  const arrastar = async (pid, extraDrop = {}) => {
    const dt = s.dt();
    s.linha(pid).disparar('dragstart', { dataTransfer: dt });
    const sob = col.disparar('dragover', { dataTransfer: dt });
    const marca = { ok: col.classList.contains('lc-lt-solta-ok'), nao: col.classList.contains('lc-lt-solta-nao'), dica: col.querySelector('[data-a="lt-solta-dica"]')?.textContent || '', aceito: sob.defaultPrevented };
    col.disparar('drop', { dataTransfer: dt, ...extraDrop }); await tick(12);
    s.linha(pid)?.disparar('dragend'); await tick();
    return marca;
  };
  s.zerar();
  const m0 = await arrastar('a1@br1.pvp.net', { isTrusted: false });
  caso('soltar na coluna com evento sintético: nada sai (a coluna marcou verde: "solte para convidar")', s.escritas().length === 0 && m0.ok && /solte para convidar amigo 1/.test(m0.dica), JSON.stringify(m0));
  const m1 = await arrastar('a1@br1.pvp.net');
  caso('arrastar amigo livre para a coluna no Lobby: POST /lol-lobby/v2/lobby/invitations [{toSummonerId}] e a marca some',
    igual(s.escritas(), [{ m: 'POST', u: '/lol-lobby/v2/lobby/invitations', c: [{ toSummonerId: 201 }] }]) && m1.aceito && !col.classList.contains('lc-lt-solta-ok')
      && !col.querySelector('[data-a="lt-solta-dica"]'), JSON.stringify(s.escritas()));
  s.zerar();
  const m2 = await arrastar('a2@br1.pvp.net');
  caso('amigo em partida: coluna cinza com o motivo; soltar avisa e não manda nada', m2.nao && m2.aceito && s.escritas().length === 0 && s.avisos.some(([m]) => /em partida/.test(m)), JSON.stringify([m2, s.avisos]));
  s.lat.aoFase('Matchmaking'); s.zerar();
  const m3 = await arrastar('a5@br1.pvp.net');
  caso('na fila (Matchmaking): soltar não convida e diz por quê', s.escritas().length === 0 && m3.nao && s.avisos.some(([m]) => /busca está em andamento/.test(m)), JSON.stringify(s.avisos));
  s.lat.aoFase('None'); s.est.lobby = null; await s.lat.lerAmigos(); s.zerar();
  await arrastar('a5@br1.pvp.net');
  caso('sem lobby criado: soltar não cria lobby nem convida ("abra o lobby para convidar")', s.escritas().length === 0 && s.avisos.some(([m]) => /abra o lobby para convidar/.test(m)), JSON.stringify(s.avisos));
  // amigo -> cabeçalho de pasta = mover (o "dropped" do lol-social-roster-group)
  s.zerar();
  s.linha('a1@br1.pvp.net').disparar('dragstart', { dataTransfer: s.dt() });
  const sobreGeral = s.cab(0).disparar('dragover', {});
  const sobreOff = s.cab(10000).disparar('dragover', {});
  s.cab(0).disparar('drop', {}); await tick(12);
  caso('amigo solto no cabeçalho do Geral: PUT friends/{id} com groupId 0; pasta automática não aceita o soltar',
    sobreGeral.defaultPrevented && !sobreOff.defaultPrevented && igual(s.escritas()[0], { m: 'PUT', u: `/lol-chat/v1/friends/${encodeURIComponent('a1@br1.pvp.net')}`, c: { ...amigo('a1@br1.pvp.net'), groupId: 0 } }),
    JSON.stringify(s.escritas()));
  // arrasto em andamento congela a lista (o elemento arrastado não pode ser recriado no meio)
  s.linha('a5@br1.pvp.net').disparar('dragstart', { dataTransfer: s.dt() });
  const antes = s.linha('a5@br1.pvp.net');
  s.est.amigos = s.est.amigos.map(a => (a.pid === 'a5@br1.pvp.net' ? { ...a, availability: 'chat' } : a)); // o status dele muda no meio do arrasto
  await s.lat.lerAmigos(); await tick();
  caso('arrasto em andamento: a releitura com dado novo não recria as linhas (o elemento arrastado segue vivo)', s.linha('a5@br1.pvp.net') === antes);
  antes.disparar('dragend'); await tick();
  caso('fim do arrasto: a lista repinta com o que chegou durante ele', s.lat.amigos().arrasto === null && s.linha('a5@br1.pvp.net') !== antes
    && /online/.test(s.linha('a5@br1.pvp.net').textContent));
  // revisão de 16/10/2026: dragend perdido (o Chromium não o dispara se a origem sai do documento, e soltar fora da janela pode
  // não chegar) deixava st.arrasto preso e a lista congelada para sempre. Durante um arrasto nativo não há pointerdown: o
  // próximo clique dele em qualquer ponto da camada prova que o arrasto acabou
  const perdida = s.linha('a1@br1.pvp.net');
  perdida.disparar('dragstart', { dataTransfer: s.dt() });
  s.est.amigos = s.est.amigos.map(a => (a.pid === 'a1@br1.pvp.net' ? { ...a, availability: 'away' } : a));
  await s.lat.lerAmigos(); await tick();
  const congelou = s.linha('a1@br1.pvp.net') === perdida;
  s.partes.coluna.disparar('pointerdown'); await tick();
  caso('arrasto sem dragend: o próximo clique na camada solta a lista (arrasto zerado e a linha repinta com o dado novo)',
    congelou && s.lat.amigos().arrasto === null && s.linha('a1@br1.pvp.net') !== perdida && /ausente/.test(s.linha('a1@br1.pvp.net').textContent),
    JSON.stringify([congelou, s.lat.amigos().arrasto]));
  // a marca da coluna não pisca ao passar entre os filhos dela: no Chromium o dragleave chega com relatedTarget null; só some
  // quando o ponteiro sai do retângulo da coluna
  col.getBoundingClientRect = () => ({ left: 0, top: 0, right: 420, bottom: 680, width: 420, height: 680 });
  s.lat.aoFase('Lobby'); s.est.lobby = copia(FX.lobby); await s.lat.lerAmigos();
  s.linha('a1@br1.pvp.net').disparar('dragstart', { dataTransfer: s.dt() });
  col.disparar('dragover', {});
  col.disparar('dragleave', { relatedTarget: null, clientX: 200, clientY: 300 });
  const marcada = () => col.classList.contains('lc-lt-solta-ok') || col.classList.contains('lc-lt-solta-nao');
  const ficou = marcada() && !!col.querySelector('[data-a="lt-solta-dica"]');
  col.disparar('dragleave', { relatedTarget: null, clientX: 430, clientY: 300 });
  const saiu = !marcada() && !col.querySelector('[data-a="lt-solta-dica"]');
  s.linha('a1@br1.pvp.net').disparar('dragend'); await tick();
  caso('dragleave entre filhos (relatedTarget null, ponteiro dentro) mantém a marca; fora do retângulo, ela some', ficou && saiu, JSON.stringify([ficou, saiu]));
  globalThis.document = undefined;
}

{
  // sem a leitura das pastas: a lista de antes, sem ＋ pasta, sem Mover e sem arrastar pasta
  const s = cenario({ semGrupos: true });
  await s.preparar();
  caso('sem /friend-groups: a lista de antes (offline recolhido aqui), ＋ pasta cinza, sem cabeçalho arrastável',
    !s.lista().querySelector('[data-a="lt-grupo"]') && !!s.lista().querySelector('[data-a="lt-offline"]') && s.lista().querySelector('[data-a="lt-nova-pasta"]').disabled === true);
  await s.menu('a1@br1.pvp.net');
  caso('sem as pastas lidas o menu não tem Mover', !s.item('mover') && !!s.item('convidar'));
  globalThis.document = undefined;
}

relatar(casos);
