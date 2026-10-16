// Testa o perfil do compacto (etapa 3 de roadmap/2026-10-16-compacto-chat-amigos-perfil.md; pedido do Gabriel de 16/10/2026: "exibir
// perfil, mostrar histórico, baixar replay das partidas", "trocar a foto de perfil [...] a moldura, a bandeira, título, Emblema" e
// "o meu background do perfil [...] o background na janela principal").
// Sem o client: lateral de verdade (compacto/lateral.js) com perfil.js e fundo.js, DOM mínimo feito aqui, LCU falsa que registra
// método, rota e corpo (tools/lcu-falsa.mjs) e a fixture inventada tests/fixtures/perfil.json (formato medido em 16/10/2026).
// O que segura: os corpos do identity customizer da Riot (_saveIcon, _saveRegalia, _savePreferences) ao pé da letra, só as chamadas
// que mudaram, só no "salvar" com o clique dele; escolher não escreve; o perfil de amigo só lê (GET), respeita o perfil privado e
// só oferece o replay de terceiro quando a Riot oferece; o fundo usa a imagem (nunca o vídeo) e some com a chave desligada.
// Seção 6 (revisão de 16/10/2026): emblema nunca repete, "assistir" do perfil segue a chave de espectador, o 📊 volta quando o chat ao
// lado desliga, o rascunho sobrevive ao perfil; e a "colheita" (seção 4) reprova cor de texto da coluna abaixo de 4,5:1 sobre o véu.
// uso: node tools/teste-compacto-perfil.mjs
import { readFileSync } from 'node:fs';
import { relatar, lcuFalsa } from './lcu-falsa.mjs';
import { lcu as lcuReal, perfilSalvo } from '../pengu/compacto/comum.js';
import { criarLateral, layout } from '../pengu/compacto/lateral.js';
import { selecaoInicial, chamadasSalvar, corpoPreferencias, corpoRegalia, corpoIcone, escolherIcone, escolherMoldura, escolherBandeira, escolherTitulo, escolherEmblema,
  opcoesMolduras, opcoesBandeiras, opcoesEmblemas, opcoesTitulos, opcoesIcones, linhasHistorico, detalheJogo, replayOferecido, perfilPrivado, resumoJogador, ranquesDe,
  caminhoSeguro, PRESTIGE_LEVELS, ROTAS_PERFIL, _zerarCatalogoIcones } from '../pengu/compacto/perfil.js';
import { criarFundo, urlFundo, contraste, compor, alfaVeu, minimoWcag, luminancia, CLASSE_FUNDO, VAR_FUNDO, VEU, VEU_COR, TONS_FUNDO, CSS_FUNDO, RETENTATIVAS } from '../pengu/compacto/fundo.js';
import { cabecalho, CSS_LOBBY } from '../pengu/compacto/tela-lobby.js';
import { CSS_BASE } from '../pengu/compacto/comum.js';
import { CSS_MODO } from '../pengu/compacto/modo.js';
import { CSS_FILA } from '../pengu/compacto/tela-fila.js';
import { CSS as CSS_SELECAO } from '../pengu/compacto/tela-champselect.js';
import { CSS_POSJOGO } from '../pengu/compacto/tela-posjogo.js';
import { CSS_HONRA } from '../pengu/compacto/tela-honra.js';
import { CSS_JOGO } from '../pengu/compacto/tela-jogo.js';
import { CSS_CHAT } from '../pengu/compacto/chat-botao.js';
import { CSS_SALA } from '../pengu/compacto/chat-sala.js';
import { CSS_REPLAY } from '../pengu/replay.js';

const FX = JSON.parse(readFileSync(new URL('../tests/fixtures/perfil.json', import.meta.url), 'utf8'));
const SOC = JSON.parse(readFileSync(new URL('../tests/fixtures/social-amigos.json', import.meta.url), 'utf8'));
const copia = v => JSON.parse(JSON.stringify(v));
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };

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
    const est = {}; est.setProperty = (k, v) => { est[k] = v; }; est.removeProperty = k => { delete est[k]; }; this.style = est; this.value = ''; this.scrollTop = 0; this.checked = false; this.disabled = false;
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
  disparar(ev, extra = {}) {
    const e = { type: ev, target: this, defaultPrevented: false, propagou: true, stopPropagation() { this.propagou = false; }, preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (let n = this; n && e.propagou; n = n.parentNode) { e.currentTarget = n; for (const fn of n.ouvintes?.[ev] || []) fn(e); }
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

// =================== 1. editor: corpos da Riot (puros) ===================
const INI = selecaoInicial({ eu: FX.eu, regalia: FX.regalia, resumo: FX.resumo });
const salvar = sel => chamadasSalvar(INI, sel).map(c => [c.metodo, c.rota, c.corpo]);
{
  caso('escolha inicial = a do _setCurrentSelections + regalia + ícone (prestígio 9 ↔ nível 200, como medido)',
    igual(INI, { iconId: 4567, crestType: 'prestige', prestigeCrest: 9, crestId: '1', borderLevel: 200, bannerType: 'blank', bannerId: '1', tokens: [101000, 202000],
      title: { itemId: 50101, name: 'Título A' } }) && PRESTIGE_LEVELS[9 - 1] === 200, JSON.stringify(INI));
  caso('sem mudança: nenhuma chamada (a Riot mandaria regalia e preferências ao sair; aqui o "salvar" só manda o que mudou)', chamadasSalvar(INI, copia(INI)).length === 0);
  caso('só o ícone: PUT /lol-summoner/v1/current-summoner/icon {profileIconId} e mais nada (_saveIcon)',
    igual(salvar(escolherIcone(INI, 5000)), [['PUT', '/lol-summoner/v1/current-summoner/icon', { profileIconId: 5000 }]]));
  caso('ícone igual ao atual não sai (_saveIcon: t !== e)', corpoIcone(escolherIcone(INI, 4567), 4567) === null);
  const ops = opcoesMolduras({ nivel: FX.eu.summonerLevel, filas: FX.ranqueEu.queues, maiorRanque: FX.regalia.highestRankedEntry, sel: INI });
  const p300 = ops.find(o => o.level === 300);
  caso('moldura de prestígio do nível 300: regalia {prestige, blank, selectedPrestigeCrest 13} + preferências crestBorder "1", prestigeCrestBorderLevel 300 (corpos inteiros)',
    igual(salvar(escolherMoldura(INI, p300)), [
      ['PUT', '/lol-regalia/v2/current-summoner/regalia', { preferredCrestType: 'prestige', preferredBannerType: 'blank', selectedPrestigeCrest: 13 }],
      ['POST', '/lol-challenges/v1/update-player-preferences', { challengeIds: [101000, 202000, -1], title: '50101', bannerAccent: '1', crestBorder: '1', prestigeCrestBorderLevel: 300 }]]),
    JSON.stringify(salvar(escolherMoldura(INI, p300))));
  const rk = ops.find(o => o.crestType === 'ranked');
  caso('moldura de ranque: regalia SEM selectedPrestigeCrest (undefined na opção da Riot), preferências crestBorder "2" e nível 0',
    igual(salvar(escolherMoldura(INI, rk)), [
      ['PUT', '/lol-regalia/v2/current-summoner/regalia', { preferredCrestType: 'ranked', preferredBannerType: 'blank' }],
      ['POST', '/lol-challenges/v1/update-player-preferences', { challengeIds: [101000, 202000, -1], title: '50101', bannerAccent: '1', crestBorder: '2', prestigeCrestBorderLevel: 0 }]]),
    JSON.stringify(salvar(escolherMoldura(INI, rk))));
  caso('título: só as preferências, com title em TEXTO ("50202"; a Riot faz t.toString())',
    igual(salvar(escolherTitulo(INI, { itemId: 50202, name: 'Título B' })), [['POST', '/lol-challenges/v1/update-player-preferences',
      { challengeIds: [101000, 202000, -1], title: '50202', bannerAccent: '1', crestBorder: '1', prestigeCrestBorderLevel: 200 }]]));
  caso('título de itemId 0: o corpo vai sem title (itemId || −1 da Riot) [S: como a Riot tira o título]',
    !('title' in corpoPreferencias(escolherTitulo(INI, { itemId: 0, name: 'Título Zero' }))) && salvar(escolherTitulo(INI, { itemId: 0, name: 'x' })).length === 1);
  const d3 = opcoesEmblemas(FX.desafios).find(e => e.id === 303000);
  caso('emblema na 3ª posição: challengeIds [101000, 202000, 303000]; posição vazia vira −1 (MAX_SELECTED_TOKENS 3)',
    igual(corpoPreferencias(escolherEmblema(INI, 2, d3)).challengeIds, [101000, 202000, 303000]) && igual(corpoPreferencias(INI).challengeIds, [101000, 202000, -1]));
  caso('emblema de desafio sem nível (NONE) não entra; posição fora de 0..2 também não',
    escolherEmblema(INI, 2, FX.desafios['404000']) === INI && escolherEmblema(INI, 3, d3) === INI);
  caso('sem nenhum emblema escolhido: o corpo vai sem challengeIds (if (e.length) da Riot)', !('challengeIds' in corpoPreferencias({ ...INI, tokens: [] })));
  const bands = opcoesBandeiras({ ultimaTemporada: FX.regalia.lastSeasonHighestRank, sel: INI });
  caso('bandeira da temporada passada: regalia preferredBannerType "lastSeasonHighestRank" + bannerAccent "2" (destaque de bandeira com o default true da Riot)',
    igual(salvar(escolherBandeira(INI, bands[1])), [
      ['PUT', '/lol-regalia/v2/current-summoner/regalia', { preferredCrestType: 'prestige', preferredBannerType: 'lastSeasonHighestRank', selectedPrestigeCrest: 9 }],
      ['POST', '/lol-challenges/v1/update-player-preferences', { challengeIds: [101000, 202000, -1], title: '50101', bannerAccent: '2', crestBorder: '1', prestigeCrestBorderLevel: 200 }]]),
    JSON.stringify(salvar(escolherBandeira(INI, bands[1]))));
  caso('destaque de bandeira desligado (false explícito): sem bannerAccent', !('bannerAccent' in corpoPreferencias(INI, { destaqueBandeira: false })));
  caso('regalia sem tipo de moldura ou de bandeira: nada (_saveRegalia: if (!e || !t) return)', corpoRegalia({ ...INI, crestType: null }) === null && corpoRegalia({ ...INI, bannerType: null }) === null);
  caso('tudo junto, na ordem do saveAndExit: ícone, regalia, preferências',
    igual(chamadasSalvar(INI, escolherTitulo(escolherMoldura(escolherIcone(INI, 6001), p300), { itemId: 50202 })).map(c => c.rota),
      [ROTAS_PERFIL.salvarIcone, ROTAS_PERFIL.salvarRegalia, ROTAS_PERFIL.salvarPreferencias]));
}

// =================== 2. opções das abas (puros) ===================
{
  const ops = opcoesMolduras({ nivel: 412, filas: FX.ranqueEu.queues, sel: INI });
  caso('molduras: a de ranque (Esmeralda) + prestígio liberado até o nível 400 (17 níveis); a marcada é a do prestígio 9 (nível 200)',
    ops[0].crestType === 'ranked' && !ops[0].off && /Esmeralda/.test(ops[0].rotulo) && ops.length === 1 + 17 && ops.find(o => o.marcada)?.level === 200 && ops.at(-1).level === 400);
  caso('molduras: sem ranque a de ranque fica cinza; nível 1 só tem o prestígio 1; TFT Jade não conta como ranque',
    opcoesMolduras({ nivel: 1, filas: [] })[0].off && opcoesMolduras({ nivel: 1 }).length === 2
      && opcoesMolduras({ nivel: 30, filas: [{ queueType: 'JADE_RANKED_SOLO_5x5', tier: 'GOLD' }] })[0].off);
  caso('bandeiras: padrão e temporada passada (Platina); sem ranque passado, a 2ª fica cinza',
    igual(opcoesBandeiras({ ultimaTemporada: 'PLATINUM', sel: INI }).map(b => [b.bannerType, b.bannerId, b.off, b.marcada]), [['blank', '1', false, true], ['lastSeasonHighestRank', '2', false, false]])
      && opcoesBandeiras({ ultimaTemporada: null })[1].off);
  const ems = opcoesEmblemas(FX.desafios);
  caso('emblemas: só desafios com nível (o NONE fica de fora), nível maior primeiro, ícone do nível atual',
    igual(ems.map(e => e.id), [303000, 101000, 202000]) && ems[0].icone.endsWith('/PLATINUM.png'));
  caso('títulos: os dele, por nome', igual(opcoesTitulos(FX.titulos).map(t => t.itemId), [50101, 50202, 0]));
  const ics = opcoesIcones(FX.icones, FX.catalogoIcones);
  caso('ícones: os do inventário + o básico 0–28 quando nenhum veio, sem o 29 (ownedIconsWithBaseSet); nome do catálogo',
    ics.some(i => i.id === 0) && ics.some(i => i.id === 28) && !ics.some(i => i.id === 29) && ics[0].id === 6001 && ics.find(i => i.id === 4567).nome === 'Ícone A'
      && !opcoesIcones([{ itemId: 3 }, { itemId: 4567 }]).some(i => i.id === 0));
}

// =================== 3. perfil de outro jogador (puros) ===================
{
  const r = resumoJogador({ invocador: FX.invocadorAmigo, ranque: FX.ranqueAmigo, desafios: FX.desafiosAmigo, fundo: FX.fundoAmigo, alvo: { nome: 'x' } });
  caso('resumo: Riot ID, nível, ícone, Solo/Duo e Flex, título e emblema do summary-player-data; fundo = a imagem (nunca o vídeo)',
    r.nome === 'amigo 2' && r.tag === 'BR1' && r.nivel === 180 && r.icone === 5000 && igual(r.ranques.map(q => q.texto), ['Diamante II · 41 PDL', 'sem ranque'])
      && r.titulo === 'Título do amigo' && r.emblemas[0].id === 303000 && r.fundo === FX.fundoAmigo.backdropImage && !r.fundo.includes('webm'), JSON.stringify(r));
  caso('caminho de imagem só da própria página e sem caracteres que fecham o url("…") do CSS',
    caminhoSeguro('/lol-game-data/assets/x/y.jpg') && !caminhoSeguro('https://x/y.jpg') && !caminhoSeguro('/a/../b.jpg') && !caminhoSeguro('/a")b.jpg') && !caminhoSeguro('/a/b.webm')
      && !caminhoSeguro(null));
  const hs = linhasHistorico(FX.historicoAmigo, { puuid: 'pa2', agoraMs: 1760600000000 + 3600e3 });
  caso('histórico: vitória, derrota e remake (gameEndedInEarlySurrender), K/D/A, fila e duração',
    igual(hs.map(l => [l.gameId, l.resultado, `${l.k}/${l.d}/${l.a}`, l.fila, l.duracao]), [[3001, 'vitória', '7/2/11', 'Solo/Duo', '31 min'], [3002, 'derrota', '1/6/9', 'Flex', '25 min'],
      [3003, 'remake', '0/0/0', 'Solo/Duo', '3 min']]) && hs[0].replay.gameType === 'MATCHED_GAME', JSON.stringify(hs));
  caso('histórico sem jogos ou torto: lista vazia', linhasHistorico(null).length === 0 && linhasHistorico({ games: { games: [{}] } }).length === 0);
  const dj = detalheJogo(FX.jogo, 'pa2');
  caso('detalhe: time azul (vitória) e vermelho, 5 cada, Riot ID que a Riot mostra no histórico, o dono do perfil marcado',
    dj.times.length === 2 && dj.times[0].vitoria && !dj.times[1].vitoria && dj.times.every(t => t.jogadores.length === 5) && dj.times[0].jogadores[0].dono
      && dj.times[0].jogadores[0].nome === 'amigo 2#BR1' && dj.times[1].jogadores.filter(j => j.dono).length === 0);
  caso('replay de terceiro: sem ThirdPersonAccessibleGameQueues (medido) a Riot não oferece; com "420,440" oferece só nessas filas; o próprio histórico sempre',
    !replayOferecido({ MinutesUntilReplayConsideredLost: 1 }, 420) && replayOferecido({ ThirdPersonAccessibleGameQueues: '420,440' }, 440)
      && !replayOferecido({ ThirdPersonAccessibleGameQueues: '420,440' }, 450) && replayOferecido(null, 420, { terceiro: false }));
  caso('perfil privado (hasPrivateProfile): só com a privacidade ligada na região e o invocador PRIVATE',
    perfilPrivado('ENABLED', { privacy: 'PRIVATE' }) && !perfilPrivado('DISABLED', { privacy: 'PRIVATE' }) && !perfilPrivado('ENABLED', { privacy: 'PUBLIC' }));
  caso('ranque: Mestre sem divisão; sem fila = "sem ranque"', ranquesDe({ queues: [{ queueType: 'RANKED_SOLO_5x5', tier: 'MASTER', division: 'I', leaguePoints: 120 }] })[0].texto === 'Mestre · 120 PDL'
    && ranquesDe({})[1].texto === 'sem ranque');
}

// =================== 4. fundo da coluna (puros e controlador) ===================
{
  caso('fundo: só a backdropImage (o backdropVideo nunca); sem imagem ou caminho torto = sem fundo',
    urlFundo(FX.fundoEu) === FX.fundoEu.backdropImage && urlFundo({ backdropVideo: FX.fundoEu.backdropVideo }) === '' && urlFundo({ backdropImage: 'javascript:x' }) === '' && urlFundo(null) === '');
  caso('contraste WCAG: branco × preto = 21; mesma cor = 1; composição rgba', Math.abs(contraste([255, 255, 255], [0, 0, 0]) - 21) < 1e-9 && contraste([9, 9, 9], [9, 9, 9]) === 1
    && igual(compor([255, 255, 255], [0, 0, 0, 0.5]), [127.5, 127.5, 127.5]));
  const g = [{ pos: 0, a: 0.5 }, { pos: 0.5, a: 0.7 }, { pos: 1, a: 0.9 }];
  caso('véu: opacidade interpolada como o linear-gradient; o mínimo do WCAG separa texto grande',
    alfaVeu(0, g) === 0.5 && Math.abs(alfaVeu(0.25, g) - 0.6) < 1e-9 && alfaVeu(1, g) === 0.9 && alfaVeu(0.5) === VEU[0].a && minimoWcag(12, 400) === 4.5 && minimoWcag(24, 400) === 3 && minimoWcag(19, 700) === 3);
  // a garantia do véu, sem harness: sobre BRANCO PURO (o pior caso de qualquer imagem), com o véu em todas as alturas, cada cor de texto
  // da coluna (as do CSS_BASE e os tons do modo fundo) passa 4,5:1. Véu mais leve ou tom de volta ao original = vermelho
  const hex = s => [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16));
  const cores = { txt: '#cdbe91', ouro: '#c8aa6e', ouro2: '#f0e6d2', azul: '#0ac8b9', mudo: TONS_FUNDO.mudo, verm: TONS_FUNDO.verm, cinza: TONS_FUNDO.cinza };
  const pior = Object.entries(cores).map(([k, c]) => [k, Math.min(...[0, 0.25, 0.5, 0.75, 1].map(y => contraste(hex(c), compor([255, 255, 255], [...VEU_COR, alfaVeu(y)]))))]);
  caso('véu: sobre branco puro, toda cor de texto da coluna fica ≥ 4,5:1 (o fundo nunca deixa texto ilegível, qualquer splash)', pior.every(([, r]) => r >= 4.5), JSON.stringify(pior));
  // colheita (revisão de 16/10/2026): a lista acima é escrita à mão; aqui saem TODAS as cores de texto do CSS das telas da coluna (var()
  // resolvida com os tons do modo fundo; regra que o CSS_FUNDO sobrescreve vale com a cor dele). Abaixo de 4,5:1 sobre o véu com splash
  // branca só passa o que o WCAG isenta (botão/campo desligado) ou o que tem fundo opaco próprio (OPACOS). Cor nova reprovada = vermelho
  const OPACOS = ['.lc-cp-sel-vazio']; // background:#151b22 na própria regra
  const varsFundo = {};
  for (const m of (CSS_BASE + CSS_FUNDO()).matchAll(/--(lc-[\w-]+):\s*([^;}]+)/g)) varsFundo[m[1]] = m[2].trim();
  const sobrescritas = new Map([...CSS_FUNDO().matchAll(/\.lc-cp-coluna\s+([^{]+)\{\s*color:([^;]+);/g)].map(m => [m[1].trim(), m[2].trim()]));
  const fundoBranco = compor([255, 255, 255], [...VEU_COR, alfaVeu(0)]);
  const corDe = v => {
    const vm = String(v).match(/^var\(--(lc-[\w-]+)\)/); if (vm) v = varsFundo[vm[1]] || v;
    if (/^#[0-9a-f]{6}$/i.test(v)) return hex(v);
    if (/^#[0-9a-f]{3}$/i.test(v)) return hex('#' + [...v.slice(1)].map(c => c + c).join(''));
    const m = String(v).match(/^rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(',').map(Number); return compor(fundoBranco, [p[0], p[1], p[2], p[3] ?? 1]); }
    return null;
  };
  const colhidas = [], reprovadas = [], semCor = [];
  for (const [nome, css] of Object.entries({ CSS_BASE, CSS_MODO, CSS_LOBBY, CSS_FILA, CSS_SELECAO, CSS_POSJOGO, CSS_HONRA, CSS_JOGO, CSS_CHAT, CSS_SALA, CSS_REPLAY })) {
    for (const r of String(css).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = r[1].trim();
      for (const d of r[2].matchAll(/(?:^|[;\s])color:\s*([^;]+)/g)) {
        const bruto = d[1].replace(/!important/, '').trim();
        if (/^(inherit|transparent|currentcolor)$/i.test(bruto)) continue;
        const chave = [...sobrescritas.keys()].find(k => sel.endsWith(k));
        const rgb = corDe(chave ? sobrescritas.get(chave) : bruto);
        if (!rgb) { semCor.push(`${nome} ${sel}: ${bruto}`); continue; }
        const r2 = contraste(rgb, fundoBranco);
        colhidas.push(sel);
        const isenta = /\[disabled\]|:disabled/.test(sel) || OPACOS.some(o => sel.includes(o));
        if (r2 < 4.5 && !isenta) reprovadas.push(`${nome} ${sel}: ${chave ? sobrescritas.get(chave) : bruto} ${r2.toFixed(2)}:1`);
      }
    }
  }
  caso('véu: colheita de TODAS as cores de texto do CSS da coluna (telas, chat da sala, replay): nenhuma abaixo de 4,5:1 sobre splash branca fora das isentas',
    colhidas.length > 100 && !reprovadas.length && !semCor.length, JSON.stringify({ n: colhidas.length, reprovadas, semCor }));
  // a dica do destaque da posição fica num painel com centro dourado (rgba(200,170,110,.18)) por cima do véu: o tom dela passa ali também
  caso('dica do destaque da posição: o tom do modo fundo passa 4,5:1 no centro dourado do painel dela (sobre splash branca)',
    contraste(hex(TONS_FUNDO.dica), compor(fundoBranco, [200, 170, 110, 0.18])) >= 4.5);
  caso('modo fundo: os tons mais apagados sobem (mudo, vermelho, cinza da intenção) e entram no CSS do fundo',
    luminancia(hex(TONS_FUNDO.mudo)) > luminancia(hex('#a09b8c')) && luminancia(hex(TONS_FUNDO.verm)) > luminancia(hex('#e84057')) && CSS_FUNDO().includes(TONS_FUNDO.mudo) && CSS_FUNDO().includes(VAR_FUNDO));
  // controlador com LCU falsa e carregador de imagem falso
  const montar = ({ rotas = {}, carrega = () => true, cfg = { compacto: { ligado: true, fundoPerfil: true } } } = {}) => {
    const doc = novoDoc();
    const falsa = lcuFalsa({ 'GET /lol-summoner/v1/current-summoner': FX.eu, 'GET /lol-collections/v1/inventories/111/backdrop': FX.fundoEu, ...rotas });
    const pedidas = [], agendados = [];
    const f = criarFundo({ cfg, doc, lcu: (m, u, c) => lcuReal(m, u, c, falsa.fetch), carregarImagem: async u => { pedidas.push(u); return carrega(u); },
      repetir: () => 1, pararRepetir: () => {}, agendar: fn => { agendados.push(fn); return 1; } });
    return { f, doc, falsa, pedidas, agendados, cfg, html: doc.documentElement };
  };
  const a = montar();
  await a.f.ler();
  caso('fundo ligado: variável e classe no <html> com a imagem do perfil; só GET; o vídeo nunca é pedido',
    a.html.classList.contains(CLASSE_FUNDO) && a.html.style[VAR_FUNDO] === `url("${FX.fundoEu.backdropImage}")` && a.falsa.escritas().length === 0
      && igual(a.pedidas, [FX.fundoEu.backdropImage]) && !a.falsa.chamadas.some(c => /webm/.test(c.url)), JSON.stringify([a.html.style, a.pedidas]));
  a.cfg.compacto.fundoPerfil = false; a.f.sincronizar();
  caso('chave desligada: o fundo some na hora (classe e variável)', !a.html.classList.contains(CLASSE_FUNDO) && a.html.style[VAR_FUNDO] === undefined);
  a.cfg.compacto.fundoPerfil = true; a.f.sincronizar(); await tick();
  caso('chave religada: volta a ler e aplica', a.html.classList.contains(CLASSE_FUNDO));
  const b = montar({ carrega: () => false });
  await b.f.ler();
  caso('imagem que não carrega: sem fundo (o de sempre), e tenta de novo depois', !b.html.classList.contains(CLASSE_FUNDO) && b.f.estado().erro === 'imagem não carregou' && b.agendados.length === 1);
  const c = montar({ rotas: { 'GET /lol-summoner/v1/current-summoner': { status: 0, json: null } } });
  for (let i = 0; i < 10; i++) { await c.f.ler(); }
  caso(`client sem resposta no boot: tenta de novo em 30 s, no máximo ${RETENTATIVAS} vezes`, c.agendados.length === RETENTATIVAS && !c.html.classList.contains(CLASSE_FUNDO));
  const d = montar({ rotas: { 'GET /lol-collections/v1/inventories/111/backdrop': { ...FX.fundoEu, backdropImage: '' } } });
  await d.f.ler();
  caso('perfil sem imagem de fundo: sem fundo e sem novas tentativas', !d.html.classList.contains(CLASSE_FUNDO) && d.agendados.length === 0 && d.pedidas.length === 0);
  const e = montar({ cfg: { compacto: { ligado: false, fundoPerfil: true } } });
  await e.f.ler();
  caso('compacto desligado: nada é lido', e.falsa.chamadas.length === 0 && !e.html.classList.contains(CLASSE_FUNDO));
}

// =================== 5. lateral de verdade: editor e perfil com gestos ===================
function cenario({ fase = 'Lobby', rotasExtra = {}, falharPrefs = 0 } = {}) {
  const doc = novoDoc();
  globalThis.document = doc;
  _zerarCatalogoIcones();
  const est = { falharPrefs };
  const rotas = {
    // editor
    'GET /lol-summoner/v1/current-summoner': FX.eu, 'GET /lol-regalia/v2/current-summoner/regalia': FX.regalia,
    'GET /lol-challenges/v1/summary-player-data/local-player': FX.resumo, 'GET /lol-challenges/v1/challenges/local-player': FX.desafios,
    'GET /lol-challenges/v2/titles/local-player': FX.titulos, 'GET /lol-inventory/v2/inventory/SUMMONER_ICON': FX.icones,
    'GET /lol-game-data/assets/v1/summoner-icons.json': FX.catalogoIcones, 'GET /lol-ranked/v1/ranked-stats/p-eu': FX.ranqueEu,
    'PUT /lol-summoner/v1/current-summoner/icon': () => ({ status: 204, json: null }), 'PUT /lol-regalia/v2/current-summoner/regalia': () => (est.falharRegalia ? { status: est.falharRegalia, json: {} } : { status: 200, json: {} }),
    'POST /lol-challenges/v1/update-player-preferences': () => (est.falharPrefs ? { status: est.falharPrefs, json: {} } : { status: 204, json: null }),
    // amigos e perfil de amigo
    'GET /lol-chat/v1/me': SOC.eu, 'GET /lol-chat/v1/friends': copia(SOC.amigos), 'GET /lol-chat/v2/friend-requests': [], 'GET /lol-chat/v1/player-mutes': {},
    'GET /lol-chat/v1/friend-groups': copia(SOC.grupos), 'GET /lol-lobby/v2/lobby': copia(SOC.lobby), 'GET /lol-chat/v1/conversations': [],
    'GET /lol-summoner/v1/profile-privacy-enabled': 'DISABLED',
    'GET /lol-summoner/v2/summoners/puuid/pa2': FX.invocadorAmigo, 'GET /lol-ranked/v1/ranked-stats/pa2': FX.ranqueAmigo,
    'GET /lol-collections/v1/inventories/202/backdrop': FX.fundoAmigo, 'GET /lol-challenges/v1/summary-player-data/player/pa2': FX.desafiosAmigo,
    [`GET ${ROTAS_PERFIL.historico('pa2')}`]: FX.historicoAmigo, 'GET /lol-match-history/v1/games/3001': FX.jogo,
    'GET /lol-platform-config/v1/namespaces/Replays': { MinutesUntilReplayConsideredLost: 30 },
    'GET /lol-spectator/v3/buddy/can-spectate/pa2/chave-espectador-a2': { availableForWatching: true, reason: '' },
    'POST /lol-spectator/v1/spectate/launch': () => ({ status: 204, json: null }), 'POST /lol-lobby/v2/lobby/invitations': () => ({ status: 200, json: {} }),
    // meu histórico (primeira pessoa)
    'GET /lol-summoner/v2/summoners/puuid/p-eu': { ...FX.eu, privacy: 'PUBLIC' }, 'GET /lol-collections/v1/inventories/111/backdrop': FX.fundoEu,
    [`GET ${ROTAS_PERFIL.historico('p-eu')}`]: FX.historicoAmigo,
    'GET /lol-replays/v1/metadata/3001': { gameId: 3001, state: 'download', downloadProgress: 0 }, 'GET /lol-replays/v1/configuration': { isReplaysEnabled: true },
    ...rotasExtra,
  };
  const falsa = lcuFalsa(rotas);
  const s = { doc, est, falsa, rotas, avisos: [], expandiu: 0, relogio: null };
  const cfg = { compacto: { ligado: true, chatLateral: true, larg: 420, alt: 680 } };
  s.cfg = cfg;
  const rot = { pedirLateral(l) { s.lateralPedida = l; }, medidasJanela: () => ({ col: 420 }), expandir() { s.expandiu++; }, estado: () => ({}) };
  // o relógio da lateral (1,5 s) fica guardado: o teste dá as voltas com s.relogio()
  s.lat = criarLateral({ cfg, rot: () => rot, doc, lcu: (m, u, c) => lcuReal(m, u, c, falsa.fetch), avisar: (m, e) => s.avisos.push([m, !!e]), log: () => {},
    repetir: fn => { s.relogio = fn; return 1; }, pararRepetir: () => {}, agora: () => 1e12, campeoes: async () => new Map([[99, { nome: 'Lux' }], [40, { nome: 'Janna' }]]) });
  const esq = new El('aside', doc), dir = new El('aside', doc), coluna = new El('div', doc), camada = new El('div', doc);
  coluna.classList.add('lc-cp-coluna');
  camada.append(esq, coluna, dir); doc.body.append(camada);
  s.partes = { esq, dir, coluna, camada };
  s.preparar = async () => { s.lat.aoFase(fase); s.lat.anexar(s.partes); s.lat.aoEfetivo('compacto'); await tick(); };
  s.ed = () => esq.querySelector('[data-painel="editor"]');
  s.edq = (a, k) => { const l = s.ed().querySelectorAll(`[data-a="${a}"]`); return k === undefined ? l[0] : l.find(n => n.dataset.k === String(k)); };
  s.pf = () => dir.querySelector('[data-a="perfil"]');
  s.escritas = () => falsa.escritas().map(c => [c.metodo, c.url, c.corpo]);
  s.zerar = () => { falsa.chamadas.length = 0; s.avisos.length = 0; };
  return s;
}

{
  const s = cenario();
  await s.preparar();
  s.lat.alternarEditor(); await tick(16);
  caso('foto do topo → editor à esquerda (largura 360, no lugar da ⚙); abrir só lê (GET)',
    s.lat.estado().editor === true && s.lat.layout().esq === 360 && s.lateralPedida?.esq === 360 && !!s.ed() && s.escritas().length === 0
      && s.falsa.chamadas.some(c => c.url === '/lol-regalia/v2/current-summoner/regalia') && s.falsa.chamadas.some(c => c.url === '/lol-game-data/assets/v1/summoner-icons.json'));
  caso('prévia com o ícone atual, a moldura de prestígio 200 e o título A; aba ícone com a grade do inventário',
    /prestígio do nível 200/.test(s.ed().textContent) && /Título A/.test(s.ed().textContent) && !!s.edq('ed-icone', 5000) && s.edq('ed-icone', 4567).classList.contains('lc-pf-on'));
  s.edq('ed-icone', 5000).click({ isTrusted: false }); await tick();
  s.edq('ed-icone', 6001).click(); await tick();
  caso('escolher ícone (clique dele ou não) não escreve nada; o "salvar" acende com 1 alteração',
    s.escritas().length === 0 && s.lat.editor().sel.iconId === 6001 && s.edq('ed-salvar').disabled === false && /1 alteração/.test(s.ed().textContent));
  s.edq('ed-salvar').click({ isTrusted: false }); await tick(12);
  caso('salvar com clique sintético: nada sai', s.escritas().length === 0);
  s.ed().querySelector('[data-a="ed-aba-moldura"]').click(); await tick();
  s.edq('ed-moldura', 'prestige-300').click(); await tick();
  s.ed().querySelector('[data-a="ed-aba-titulo"]').click(); await tick();
  s.edq('ed-titulo', 50202).click(); await tick();
  s.edq('ed-salvar').click(); await tick(16);
  caso('salvar (clique dele): exatamente ícone, regalia e preferências, nessa ordem, com os corpos da Riot',
    igual(s.escritas(), [['PUT', '/lol-summoner/v1/current-summoner/icon', { profileIconId: 6001 }],
      ['PUT', '/lol-regalia/v2/current-summoner/regalia', { preferredCrestType: 'prestige', preferredBannerType: 'blank', selectedPrestigeCrest: 13 }],
      ['POST', '/lol-challenges/v1/update-player-preferences', { challengeIds: [101000, 202000, -1], title: '50202', bannerAccent: '1', crestBorder: '1', prestigeCrestBorderLevel: 300 }]])
      && s.avisos.some(([m, e]) => !e && /perfil salvo/.test(m)) && s.lat.editor().pendentes.length === 0, JSON.stringify(s.escritas()));
  caso('ícone salvo chega ao topo do lobby (perfilSalvo) sem esperar a releitura', perfilSalvo.icone === 6001 && perfilSalvo.em > 0);
  s.zerar();
  s.edq('ed-salvar').click(); await tick(8);
  caso('salvar de novo sem mudança: nada sai', s.escritas().length === 0);
  // emblema na 3ª posição pela prévia; falha da Riot fica pendente e avisa com o status
  s.est.falharPrefs = 500;
  s.ed().querySelectorAll('[data-a="ed-posicao"]').find(n => n.dataset.pos === '2').click(); await tick();
  s.edq('ed-emblema', 303000).click(); await tick();
  s.edq('ed-salvar').click(); await tick(12);
  caso('emblema na 3ª posição: POST com challengeIds [101000, 202000, 303000]; recusa (500) avisa com o status e a mudança segue pendente',
    igual(s.escritas()[0]?.[2]?.challengeIds, [101000, 202000, 303000]) && s.escritas().length === 1 && s.avisos.some(([m, e]) => e && /500/.test(m)) && s.lat.editor().pendentes.length === 1,
    JSON.stringify([s.escritas(), s.avisos]));
  s.est.falharPrefs = 0; s.zerar();
  // ⚙ com mudança não salva: espera; ✕ pede o 2º clique e não salva nada
  s.lat.alternarConfig(); await tick();
  caso('⚙ com mudança não salva no perfil: as configurações esperam (aviso) e o editor fica', s.lat.estado().config === false && s.lat.estado().editor === true && s.avisos.some(([m]) => /não salvas/.test(m)));
  s.ed().querySelector('[data-a="ed-fechar"]').click(); await tick();
  const ficou = s.lat.estado().editor === true && /de novo para descartar/.test(s.ed().textContent);
  s.ed().querySelector('[data-a="ed-fechar"]').click(); await tick();
  caso('✕ com mudança não salva: o 1º clique avisa, o 2º descarta e fecha; nada é escrito ao fechar (decisão 9: a Riot salvaria)',
    ficou && s.lat.estado().editor === false && s.lat.layout().esq === 0 && s.escritas().length === 0);
  s.lat.alternarEditor(); await tick(16);
  // regalia recusada e preferências aceitas no mesmo "salvar": só a regalia fica pendente (revisão: antes a moldura sumia das pendências)
  s.zerar(); s.est.falharRegalia = 500;
  s.ed().querySelector('[data-a="ed-aba-moldura"]').click(); await tick();
  s.edq('ed-moldura', 'prestige-300').click(); await tick();
  s.edq('ed-salvar').click(); await tick(16);
  const pend = s.lat.editor().pendentes;
  caso('regalia 500 + preferências 204: aviso com 500 e SÓ a regalia segue pendente (o "salvar" segue aceso)',
    igual(pend, [ROTAS_PERFIL.salvarRegalia]) && s.avisos.some(([m, e]) => e && /moldura e bandeira \(500\)/.test(m)) && s.edq('ed-salvar').disabled === false, JSON.stringify([pend, s.avisos]));
  s.zerar(); s.est.falharRegalia = 0;
  s.edq('ed-salvar').click(); await tick(16);
  caso('salvar de novo: só o PUT da regalia sai (as preferências já aceitas não se repetem); depois nada pendente',
    igual(s.escritas(), [['PUT', '/lol-regalia/v2/current-summoner/regalia', { preferredCrestType: 'prestige', preferredBannerType: 'blank', selectedPrestigeCrest: 13 }]])
      && s.lat.editor().pendentes.length === 0, JSON.stringify(s.escritas()));
  s.lat.alternarEditor(); await tick(); // fecha (nada pendente)
  s.lat.alternarEditor(); await tick(16);
  s.lat.alternarConfig(); await tick();
  caso('sem pendência a ⚙ troca o editor de lugar (um dos dois à esquerda)', s.lat.estado().config === true && s.lat.layout().editor === false && s.lat.layout().esq === 360);
  globalThis.document = undefined;
}

{
  // perfil de amigo: menu "Exibir perfil" e a foto na lista; só GET; ações = as do menu; replay só quando a Riot oferece
  const s = cenario();
  await s.preparar();
  s.lat.alternarLista(); await tick(12); await s.lat.lerAmigos(); await tick();
  const linhaA2 = () => s.partes.dir.querySelectorAll('[data-a="lt-amigo"]').find(n => n.dataset.pid === 'a2@br1.pvp.net');
  s.zerar();
  linhaA2().querySelector('[data-a="lt-foto"]').click({ isTrusted: false }); await tick(12);
  caso('foto do amigo com clique sintético: nada abre', s.lat.estado().painel === null);
  linhaA2().querySelector('[data-a="lt-foto"]').click(); await tick(16);
  caso('foto do amigo (clique dele): o perfil abre ao lado (não a conversa), só com GET',
    s.lat.estado().painel === 'perfil' && s.lat.estado().perfil.puuid === 'pa2' && s.lat.estado().conversa === null && s.escritas().length === 0
      && ['/lol-summoner/v2/summoners/puuid/pa2', '/lol-ranked/v1/ranked-stats/pa2', '/lol-collections/v1/inventories/202/backdrop', '/lol-challenges/v1/summary-player-data/player/pa2',
        ROTAS_PERFIL.historico('pa2'), '/lol-platform-config/v1/namespaces/Replays', '/lol-summoner/v1/profile-privacy-enabled'].every(u => s.falsa.chamadas.some(c => c.url === u)),
    JSON.stringify(s.falsa.chamadas.map(c => c.url)));
  const faixa = s.pf().querySelector('[data-a="pf-faixa"]');
  caso('faixa: Riot ID, nível, título, ranque e o fundo de perfil dele (imagem, não o vídeo)',
    /amigo 2/.test(faixa.textContent) && /nível 180/.test(faixa.textContent) && /Título do amigo/.test(faixa.textContent) && /Diamante II/.test(faixa.textContent)
      && String(faixa.style.backgroundImage).includes(FX.fundoAmigo.backdropImage) && !String(faixa.style.backgroundImage).includes('webm'));
  const btConv = s.pf().querySelector('[data-a="pf-convidar"]'), btAss = s.pf().querySelector('[data-a="pf-assistir"]');
  caso('ações do perfil = regra do menu: amigo em partida → convidar cinza com motivo; assistir aceso (can-spectate true)',
    btConv.disabled === true && /em partida/.test(btConv.getAttribute('title')) && btAss.disabled === false && btAss.style.display === '');
  btAss.click({ isTrusted: false }); await tick(8);
  caso('assistir com clique sintético: nada sai', s.escritas().length === 0);
  btAss.click(); await tick(12);
  caso('assistir (clique dele): POST /lol-spectator/v1/spectate/launch com o corpo do roster da Riot',
    igual(s.escritas(), [['POST', '/lol-spectator/v1/spectate/launch', { dropInSpectateGameId: 'amigo2nome', gameQueueType: 'RANKED_SOLO_5x5', allowObserveMode: 'ALL', puuid: 'pa2', spectatorKey: 'chave-espectador-a2' }]]),
    JSON.stringify(s.escritas()));
  s.zerar();
  s.pf().querySelector('[data-a="pf-aba-historico"]').click(); await tick();
  const jogos = s.pf().querySelectorAll('[data-a="pf-jogo"]');
  caso('histórico: as 3 partidas (vitória, derrota, remake) com campeão, K/D/A e fila', jogos.length === 3 && /vitória/.test(jogos[0].textContent) && /7\/2\/11/.test(jogos[0].textContent)
    && /remake/.test(jogos[2].textContent));
  jogos[0].click(); await tick(12);
  caso('detalhe da partida: os 10 com campeão e K/D/A; replay de amigo NÃO oferecido (a Riot não oferece sem ThirdPersonAccessibleGameQueues); só GET',
    s.pf().querySelectorAll('.lc-pf-jog').length === 10 && /amigo 2#BR1/.test(s.pf().querySelectorAll('.lc-pf-jog')[0].textContent)
      && /jogador y6#BR1.*3\/6\/2/.test(s.pf().querySelectorAll('.lc-pf-jog')[5].textContent) && !s.pf().querySelector('[data-a="replay"]')
      && /não oferece o replay/.test(s.pf().textContent) && s.escritas().length === 0 && !s.falsa.chamadas.some(c => c.url.startsWith('/lol-replays/')));
  s.lat.fecharPainel(); await tick();
  caso('✕ do perfil: fecha (nada estava aberto antes, o painel some)', s.lat.estado().painel === null && s.lat.layout().painel === false);
  globalThis.document = undefined;
}

{
  // região com replay de terceiro liberado para a fila: aparece a linha do replay; o perfil cobre o chat e volta para ele ao fechar
  const s = cenario({ rotasExtra: { 'GET /lol-platform-config/v1/namespaces/Replays': { ThirdPersonAccessibleGameQueues: '420' } } });
  await s.preparar();
  s.lat.alternarLista(); await tick(12); await s.lat.lerAmigos(); await tick();
  s.lat.abrirConversa({ pid: 'a1@br1.pvp.net', nome: 'amigo 1' }, { isTrusted: false }); await tick(12);
  const conversa = s.lat.estado().conversa?.pid;
  s.lat.verPerfil('a2@br1.pvp.net', {}); await tick(16);
  caso('perfil por cima do chat: anterior = chat', s.lat.estado().painel === 'perfil' && s.lat.estado().anterior === 'chat');
  s.pf().querySelector('[data-a="pf-aba-historico"]').click(); await tick();
  s.zerar();
  s.pf().querySelectorAll('[data-a="pf-jogo"]')[0].click(); await tick(16);
  caso('fila liberada pela Riot (ThirdPersonAccessibleGameQueues "420"): a linha do replay aparece e só lê (GET metadata/configuração)',
    !!s.pf().querySelector('[data-a="replay"]') && s.falsa.chamadas.some(c => c.url === '/lol-replays/v1/metadata/3001') && s.escritas().length === 0);
  s.lat.fecharPainel(); await tick();
  caso('✕ do perfil volta ao chat com a mesma conversa', s.lat.estado().painel === 'chat' && s.lat.estado().conversa?.pid === conversa && conversa === 'a1@br1.pvp.net');
  // convite pelo perfil: amigo livre no Lobby com lobby criado
  s.lat.verPerfil('a1@br1.pvp.net', {}); await tick(16);
  s.zerar();
  s.pf().querySelector('[data-a="pf-convidar"]').click({ isTrusted: false }); await tick(8);
  const nadaSintetico = s.escritas().length === 0;
  s.pf().querySelector('[data-a="pf-convidar"]').click(); await tick(12);
  caso('convidar pelo perfil: sintético não sai; clique dele = POST invitations [{toSummonerId}] (mesma regra do menu)',
    nadaSintetico && igual(s.escritas(), [['POST', '/lol-lobby/v2/lobby/invitations', [{ toSummonerId: 201 }]]]), JSON.stringify(s.escritas()));
  globalThis.document = undefined;
}

{
  // perfil privado: aviso no painel, nada do histórico é lido
  const s = cenario({ rotasExtra: { 'GET /lol-summoner/v1/profile-privacy-enabled': 'ENABLED', 'GET /lol-summoner/v1/summoners/202': { privacy: 'PRIVATE' } } });
  await s.preparar();
  s.lat.alternarLista(); await tick(12); await s.lat.lerAmigos(); await tick();
  s.zerar();
  s.lat.verPerfil('a2@br1.pvp.net', {}); await tick(16);
  caso('perfil privado (hasPrivateProfile da Riot): o painel diz "perfil privado" e o histórico não é lido',
    s.lat.perfil().privado === true && /perfil privado/.test(s.pf().textContent) && !s.falsa.chamadas.some(c => c.url.startsWith('/lol-match-history/')));
  globalThis.document = undefined;
}

{
  // meu histórico pelo atalho do editor: primeira pessoa, o replay é oferecido; sem ações de amigo
  const s = cenario();
  await s.preparar();
  s.lat.alternarEditor(); await tick(16);
  s.zerar();
  s.ed().querySelector('[data-a="ed-historico"]').click({ isTrusted: false }); await tick(12);
  caso('"histórico" do editor com clique sintético: nada abre', s.lat.estado().painel === null);
  s.ed().querySelector('[data-a="ed-historico"]').click(); await tick(16);
  caso('"histórico" do editor: o meu perfil ao lado, aba histórico, sem convidar/mensagem/assistir',
    s.lat.estado().painel === 'perfil' && s.lat.estado().perfil.eu === true && s.lat.perfil().aba === 'historico' && s.pf().querySelector('.lc-pf-acoes').style.display === 'none'
      && s.lat.estado().editor === true);
  s.pf().querySelectorAll('[data-a="pf-jogo"]')[0].click(); await tick(16);
  const rp = s.pf().querySelector('[data-a="replay"]');
  caso('meu histórico: o replay da minha partida é oferecido (primeira pessoa, como o match-history da Riot); ler não escreve',
    !!rp && /baixar replay/.test(rp.textContent) && s.escritas().length === 0);
  rp.querySelector('[data-a="replay-baixar"]').click(); await tick(16);
  caso('baixar (clique dele): POST …/rofls/3001/download {componentType: replay-button_match-history} (o do histórico, não o do fim de partida)',
    igual(s.escritas(), [['POST', '/lol-replays/v1/rofls/3001/download', { componentType: 'replay-button_match-history' }]]), JSON.stringify(s.escritas()));
  globalThis.document = undefined;
}

{
  // topo do lobby: a foto é o botão do editor (data-a: o arrasto da janela ignora) e troca sozinha quando o ícone é salvo
  const doc = novoDoc();
  globalThis.document = doc;
  let abriu = 0;
  const titulo = new El('div', doc), extras = new El('div', doc);
  const intervalos = [];
  const ctx = { titulo, extras, vivo: () => true, seguro: fn => fn, lcu: async () => ({ ok: false, status: 0 }), observar: () => {}, intervalo: fn => intervalos.push(fn),
    servicos: { lateral: { alternarEditor: () => { abriu++; }, ligada: () => false } } };
  cabecalho(ctx);
  const bt = titulo.querySelector('[data-a="meu-perfil"]');
  bt.click(); await tick();
  perfilSalvo.icone = 777; perfilSalvo.em = Date.now() + 1;
  for (const fn of intervalos) fn();
  caso('topo: a foto é botão [data-a="meu-perfil"] que abre o editor; ícone salvo troca a foto na hora',
    !!bt && bt.tagName === 'BUTTON' && abriu === 1 && String(bt.querySelector('.lc-cp-av')?.style.backgroundImage || '').includes('/profile-icons/777.jpg'));
  const ctx2 = { ...ctx, titulo: new El('div', doc), extras: new El('div', doc), servicos: {} };
  cabecalho(ctx2);
  caso('topo sem a lateral (teste antigo, quebra no init): a foto segue sem botão', !ctx2.titulo.querySelector('[data-a="meu-perfil"]'));
  globalThis.document = undefined;
}

// =================== 6. revisão adversarial de 16/10/2026 (cada caso falhava antes da correção) ===================
{
  // emblema repetido: o mouseUp do identity-customizer-token da Riot só chama o onClick se o desafio não está em selectedTokenIds
  const ini = selecaoInicial({ eu: FX.eu, regalia: FX.regalia, resumo: FX.resumo });
  const ja = ini.tokens.find(t => t !== undefined);
  const outra = ini.tokens.length < 3 ? ini.tokens.length : 0;
  const rep = escolherEmblema(ini, outra, { id: ja, currentLevel: 'GOLD' });
  caso('emblema já posto noutra posição não entra de novo (como a Riot): nada muda e nada fica pendente; challengeIds nunca repete',
    ja !== undefined && rep === ini && chamadasSalvar(ini, rep).length === 0, JSON.stringify([ini.tokens, rep.tokens]));
}

{
  // "assistir" no perfil: o amigo entra em partida com o perfil aberto -> o can-spectate sai para a chave nova (antes: "verificando"
  // para sempre); a chave muda de novo e a Riot nega -> o botão segue a resposta nova (antes: valia o "pode" da partida anterior)
  const s = cenario();
  await s.preparar();
  s.lat.alternarLista(); await tick(12); await s.lat.lerAmigos(); await tick();
  s.lat.verPerfil('a1@br1.pvp.net', {}); await tick(16);
  const bt = () => s.pf().querySelector('[data-a="pf-assistir"]');
  const semPartida = bt().style.display === 'none';
  const emJogo = chave => copia(SOC.amigos).map(a => (a.id === 'a1@br1.pvp.net' ? { ...a, availability: 'dnd', lol: { ...SOC.amigos.find(x => x.id === 'a2@br1.pvp.net').lol, puuid: 'pa1', spectatorKey: chave } } : a));
  s.rotas['GET /lol-chat/v1/friends'] = emJogo('chave-a1-1');
  s.rotas['GET /lol-spectator/v3/buddy/can-spectate/pa1/chave-a1-1'] = { availableForWatching: true, reason: '' };
  s.zerar();
  await s.lat.lerAmigos(); s.relogio(); await tick(20);
  const pediu1 = s.falsa.chamadas.some(c => c.url === '/lol-spectator/v3/buddy/can-spectate/pa1/chave-a1-1');
  caso('perfil aberto e o amigo entra em partida: o relógio pede o can-spectate da chave nova (só GET) e o "assistir" acende',
    semPartida && pediu1 && bt().style.display === '' && bt().disabled === false && s.escritas().length === 0,
    JSON.stringify([semPartida, pediu1, bt().style.display, bt().disabled, bt().getAttribute('title')]));
  s.rotas['GET /lol-chat/v1/friends'] = emJogo('chave-a1-2');
  s.rotas['GET /lol-spectator/v3/buddy/can-spectate/pa1/chave-a1-2'] = { availableForWatching: false, reason: 'notAvailable' };
  await s.lat.lerAmigos(); s.relogio(); await tick(20);
  caso('a chave muda e a Riot nega: o "assistir" apaga (a resposta da partida anterior não vale mais)', bt().disabled === true,
    JSON.stringify([bt().style.display, bt().disabled, bt().getAttribute('title')]));
  const n = s.falsa.chamadas.filter(c => c.url.startsWith('/lol-spectator/v3/buddy/can-spectate/')).length;
  s.relogio(); await tick(20); s.relogio(); await tick(20);
  caso('mesma chave: o can-spectate não se repete a cada volta do relógio',
    s.falsa.chamadas.filter(c => c.url.startsWith('/lol-spectator/v3/buddy/can-spectate/')).length === n);
  globalThis.document = undefined;
}

{
  // "chat ao lado" desligado com o perfil de amigo por cima do 📊 na seleção: o perfil fecha e o 📊 volta (antes: sumia junto)
  const s = cenario({ fase: 'ChampSelect' });
  await s.preparar();
  s.lat.alternarLista(); await tick(12); await s.lat.lerAmigos(); await tick();
  s.lat.alternarCoach(); await tick(12);
  s.lat.verPerfil('a2@br1.pvp.net', {}); await tick(16);
  const cobriu = s.lat.estado().painel === 'perfil' && s.lat.estado().anterior === 'coach';
  s.cfg.compacto.chatLateral = false; s.lat.sincronizar(); await tick();
  caso('chat ao lado desligado com o perfil por cima do 📊: o perfil fecha e o 📊 volta',
    cobriu && s.lat.estado().painel === 'coach' && s.lat.estado().perfil === null && s.lat.estado().anterior === null, JSON.stringify(s.lat.estado()));
  globalThis.document = undefined;
}

{
  // rascunho: o perfil por cima do chat não perde o texto digitado (✕ do perfil, 💬 no lugar do perfil, "mensagem" do perfil)
  const s = cenario();
  await s.preparar();
  s.lat.alternarLista(); await tick(12); await s.lat.lerAmigos(); await tick();
  s.lat.abrirConversa({ pid: 'a1@br1.pvp.net', nome: 'amigo 1' }, { isTrusted: false }); await tick(12);
  const campo = () => s.partes.dir.querySelector('[data-a="lt-texto"]');
  campo().value = 'texto pro a1'; campo().disparar('input');
  s.lat.verPerfil('a2@br1.pvp.net', {}); await tick(16);
  s.lat.fecharPainel(); await tick(12);
  const depoisX = campo()?.value;
  s.lat.verPerfil('a2@br1.pvp.net', {}); await tick(16);
  s.lat.alternarChat(); await tick(12);
  const depoisChat = campo()?.value;
  const semEscrita = s.escritas().length === 0;
  s.lat.verPerfil('a1@br1.pvp.net', {}); await tick(16);
  s.pf().querySelector('[data-a="pf-mensagem"]').click(); await tick(12);
  const depoisMensagem = campo()?.value;
  caso('rascunho: perfil por cima do chat e de volta (✕, 💬, "mensagem" do perfil) mantém o texto da conversa; abrir e fechar o perfil não escreve',
    depoisX === 'texto pro a1' && depoisChat === 'texto pro a1' && depoisMensagem === 'texto pro a1' && s.lat.estado().conversa?.pid === 'a1@br1.pvp.net' && semEscrita,
    JSON.stringify([depoisX, depoisChat, depoisMensagem, s.escritas()]));
  globalThis.document = undefined;
}

caso('layout pela lateral: perfil e editor nas larguras de sempre (direita 360, esquerda 360)', layout({ painel: 'perfil', editor: true }).dir === 360 && layout({ painel: 'perfil', editor: true }).esq === 360);
relatar(casos);
