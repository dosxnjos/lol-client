// Testa a seção Som da área de configurações do compacto (etapa B de roadmap/2026-10-16-chat-da-sala-som-icones.md; pedido do Gabriel de 16/10/2026: "deve
// haver configurações de som no modo compacto").
// Sem o client: compacto/som.js e compacto/lateral-config.js de verdade, DOM mínimo feito aqui, LCU falsa que registra método, rota e corpo
// (tools/lcu-falsa.mjs), relógio do debounce injetado. Resposta do GET = a medida no client real em 16/10/2026 ({data: {musicEnabled:
// false}, schemaVersion: 5}).
// O que segura: os corpos do front da Riot (rcp-fe-lol-settings 16.20: um PATCH por propriedade em /lol-settings/v1/local/lol-audio
// {schemaVersion: 5, data}, e o 2º PATCH do onSaveSetting para sfxEnabled -> voiceEnabled e sfxVolume -> voiceVolume × 0,5); abrir a área de configurações,
// abrir a seção, buscar e repintar nunca gravam (só GET); nada sai sem isTrusted; o volume grava só no change (soltar), com debounce
// e só o último valor; arrastando, a área de configurações não repinta; GET que falha = só as chaves do plugin e o motivo; o bloco Voz vira parte da Som.
// uso: node tools/teste-compacto-som.mjs
import { relatar, lcuFalsa } from './lcu-falsa.mjs';
import { lcu as lcuReal } from '../pengu/compacto/comum.js';
import { OPCOES_SOM, ROTA_SOM, VERSAO_SOM, ESPERA_VOLUME_MS, lerSom, cinzaDe, corposSom, volumeDe, volumeValido } from '../pengu/compacto/som.js';
import { criarConfigView, BLOCO_SOM, BLOCO_INICIAL } from '../pengu/compacto/lateral-config.js';
import { registrarBloco } from '../pengu/configuracoes.js';
import { blocoVoz, blocoAlertas, blocoCompacto } from '../pengu/blocos.js';
import { PADRAO } from '../pengu/config.js';

const copia = v => JSON.parse(JSON.stringify(v));
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const casos = [];
const caso = (nome, passou, detalhe) => casos.push([nome, !!passou, detalhe]);
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
const MEDIDO = { data: { musicEnabled: false }, schemaVersion: 5 }; // GET do client real, 16/10/2026

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
    this.style = {}; this.value = ''; this.scrollTop = 0; this.checked = false; this.disabled = false;
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
  prepend(...ns) { const velhos = this.childNodes; this.childNodes = []; this.append(...ns); for (const v of velhos) { v.parentNode = this; this.childNodes.push(v); } }
  remove() { if (this.parentNode) { const l = this.parentNode.childNodes; l.splice(l.indexOf(this), 1); } this.parentNode = null; }
  replaceChildren(...ns) { for (const n of [...this.childNodes]) n.parentNode = null; this.childNodes = []; this.append(...ns); }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { this.replaceChildren(new Texto(v)); }
  contains(n) { for (let p = n; p; p = p.parentNode) if (p === this) return true; return false; }
  addEventListener(ev, fn) { (this.ouvintes[ev] ||= []).push(fn); }
  disparar(ev, extra = {}) {
    const e = { type: ev, target: this, defaultPrevented: false, propagou: true, stopPropagation() { this.propagou = false; }, preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (let n = this; n && e.propagou; n = n.parentNode) { e.currentTarget = n; for (const fn of n.ouvintes?.[ev] || []) fn(e); }
    return e;
  }
  click(extra) { return this.disparar('click', extra); }
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
  // ouvintes do documento (o soltar do volume fora do controle chega aqui, na captura)
  doc.ouvintes = {};
  doc.addEventListener = (ev, fn) => { (doc.ouvintes[ev] ||= []).push(fn); };
  doc.disparar = (ev, extra = {}) => { for (const fn of doc.ouvintes[ev] || []) fn({ type: ev, target: doc.body, ...extra }); };
  return doc;
}

// =================== 1. puros: leitura, cinza e corpos da Riot ===================
{
  caso('as 13 opções da página Som da Riot, na ordem do template, com os defaultValue do controller (rcp-fe-lol-settings 16.20)',
    igual(OPCOES_SOM.map(o => [o.chave, o.padrao]), [['masterSoundEnabled', true], ['masterVolume', 100], ['sfxEnabled', true], ['sfxVolume', 100], ['ambientSfxEnabled', true],
      ['pickChampVoEnabled', true], ['banChampVoEnabled', true], ['musicEnabled', true], ['musicVolume', 100], ['championSelectionMusicEnabled', true],
      ['ambienceMusicEnabled', true], ['clientAmbienceMusicEnabled', true], ['loginMusicEnabled', true]]) && ROTA_SOM === '/lol-settings/v1/local/lol-audio' && VERSAO_SOM === 5);
  const m = lerSom({ ok: true, status: 200, json: MEDIDO });
  caso('GET medido (só musicEnabled false): o resto vem do padrão, como o lodash.get da Riot',
    m.ok && m.versao === 5 && m.valores.musicEnabled === false && m.valores.masterSoundEnabled === true && m.valores.masterVolume === 100 && m.valores.sfxVolume === 100, JSON.stringify(m));
  const torto = lerSom({ ok: true, status: 200, json: { schemaVersion: 5, data: { masterVolume: 150, sfxVolume: 37.5, musicVolume: '20', sfxEnabled: 0, musicEnabled: null, loginMusicEnabled: false } } });
  caso('valor de tipo errado ou fora de 0–100 cai no padrão (Number.isInteger da Riot); o válido fica',
    torto.ok && torto.valores.masterVolume === 100 && torto.valores.sfxVolume === 100 && torto.valores.musicVolume === 100 && torto.valores.sfxEnabled === true
      && torto.valores.musicEnabled === true && torto.valores.loginMusicEnabled === false, JSON.stringify(torto));
  const vazio = lerSom({ ok: true, status: 200, json: {} });
  caso('nada salvo ainda (sem versão, sem data): tudo no padrão e editável', vazio.ok && vazio.valores.masterVolume === 100 && vazio.versao === null);
  const v4 = lerSom({ ok: true, status: 200, json: { schemaVersion: 4, data: { masterVolume: 30 } } });
  caso('versão 4: só leitura com o motivo (o init da Riot zeraria tudo ao abrir; aqui nunca)', !v4.ok && v4.valores.masterVolume === 30 && /versão/.test(v4.motivo) && /Configurações da Riot/.test(v4.motivo), JSON.stringify(v4));
  const r404 = lerSom({ ok: false, status: 404, json: null });
  caso('GET 404: sem valores, motivo com o status e a saída', !r404.ok && r404.valores === null && /404/.test(r404.motivo) && /Configurações da Riot/.test(r404.motivo), r404.motivo);
  caso('resposta inesperada (lista, data que não é objeto): sem valores', !lerSom({ ok: true, json: [] }).ok && !lerSom({ ok: true, json: { data: [1] } }).ok && !lerSom({ ok: true, json: { data: 'x' } }).ok);
  caso('sem rede (status 0): motivo com o erro', /sem LCU/.test(lerSom({ ok: false, status: 0, erro: 'sem LCU' }).motivo));

  const base = lerSom({ ok: true, json: {} }).valores;
  const cz = v => Object.entries(cinzaDe(v)).filter(([, c]) => c).map(([k]) => k).sort();
  caso('cinza com tudo ligado: nada', cz(base).length === 0);
  caso('áudio desligado: tudo cinza, menos a própria caixa (soundDisabled do template)', igual(cz({ ...base, masterSoundEnabled: false }), OPCOES_SOM.map(o => o.chave).filter(k => k !== 'masterSoundEnabled').sort()));
  caso('efeitos desligados: volume dos efeitos, ambiente e falas cinza; música não (sfxDisabled)',
    igual(cz({ ...base, sfxEnabled: false }), ['ambientSfxEnabled', 'banChampVoEnabled', 'pickChampVoEnabled', 'sfxVolume']));
  caso('música desligada: volume da música e as 4 músicas cinza (musicDisabled)',
    igual(cz({ ...base, musicEnabled: false }), ['ambienceMusicEnabled', 'championSelectionMusicEnabled', 'clientAmbienceMusicEnabled', 'loginMusicEnabled', 'musicVolume']));

  const pc = (k, v) => corposSom(k, v).map(c => [c.metodo, c.rota, c.corpo]);
  caso('volume geral: 1 PATCH, uma propriedade, corpo do saveSetting da Riot', igual(pc('masterVolume', 40), [['PATCH', ROTA_SOM, { schemaVersion: 5, data: { masterVolume: 40 } }]]));
  caso('efeitos sonoros: 2 PATCHes na ordem do front (sfxEnabled, depois o alias voiceEnabled)',
    igual(pc('sfxEnabled', false), [['PATCH', ROTA_SOM, { schemaVersion: 5, data: { sfxEnabled: false } }], ['PATCH', ROTA_SOM, { schemaVersion: 5, data: { voiceEnabled: false } }]]));
  caso('volume dos efeitos: 2º PATCH voiceVolume = 0,5 × valor, sem arredondar (75 -> 37.5)',
    igual(pc('sfxVolume', 75), [['PATCH', ROTA_SOM, { schemaVersion: 5, data: { sfxVolume: 75 } }], ['PATCH', ROTA_SOM, { schemaVersion: 5, data: { voiceVolume: 37.5 } }]]));
  caso('música e as outras caixas: 1 PATCH sem alias', igual(pc('musicEnabled', true), [['PATCH', ROTA_SOM, { schemaVersion: 5, data: { musicEnabled: true } }]]) && pc('loginMusicEnabled', false).length === 1);
  caso('chave desconhecida, volume fora de 0–100, fracionado ou caixa sem booleano: nenhum PATCH',
    pc('voiceEnabled', true).length === 0 && pc('masterVolume', 101).length === 0 && pc('masterVolume', 40.5).length === 0 && pc('musicEnabled', 'false').length === 0 && pc('masterVolume', -1).length === 0);
  caso('valor do controle: inteiro 0–100 (40.6 -> 41, -3 -> 0, 130 -> 100, vazio -> nada)',
    volumeDe('40') === 40 && volumeDe('40.6') === 41 && volumeDe('-3') === 0 && volumeDe('130') === 100 && volumeDe('') === null && volumeDe('x') === null && volumeValido(0) && !volumeValido(true));
}

// =================== 2. a área de configurações do compacto: seção Som com LCU falsa ===================
registrarBloco('voz', blocoVoz, 'Voz');
registrarBloco('alertas', blocoAlertas, 'Alertas na tela');
registrarBloco('compacto', blocoCompacto, 'Client compacto');

function cenario({ rotas = {}, semLcu = false } = {}) {
  const doc = novoDoc();
  globalThis.document = doc;
  const cfg = copia(PADRAO);
  const definidos = [];
  const definir = (caminho, v) => {
    definidos.push([caminho, copia(v)]);
    const ks = caminho.split('.'); let o = cfg;
    for (const k of ks.slice(0, -1)) o = o[k];
    o[ks.at(-1)] = v;
  };
  const falsa = lcuFalsa({ [`GET ${ROTA_SOM}`]: MEDIDO, [`PATCH ${ROTA_SOM}`]: () => ({ status: 204 }), ...rotas });
  const timers = [];
  const esperar = (fn, ms) => { timers.push({ fn, ms, vivo: true }); return timers.length - 1; };
  const cancelar = i => { if (timers[i]) timers[i].vivo = false; };
  const correr = () => { for (const t of timers) if (t.vivo) { t.vivo = false; t.fn(); } };
  const avisos = [];
  const v = criarConfigView({ doc, cfg, definir, lcu: semLcu ? undefined : (m, u, c) => lcuReal(m, u, c, falsa.fetch), avisar: (msg, erro) => avisos.push([msg, erro]),
    esperar, cancelar, aoConfigRiot: () => {}, aoFechar: () => {} });
  doc.body.append(v.el);
  const corpo = () => v.el.querySelector('[data-a="cfg-corpo"]');
  const cabs = () => corpo().querySelectorAll('[data-a="cfg-bloco"]');
  const abrir = titulo => cabs().find(b => b.dataset.bloco === titulo)?.click();
  const caixa = k => v.el.querySelector(`[data-a="som-caixa"][data-som="${k}"]`);
  const vol = k => v.el.querySelector(`[data-a="som-volume"][data-som="${k}"]`);
  const gets = () => falsa.chamadas.filter(c => c.metodo === 'GET').length;
  const doPlugin = nome => [...corpo().querySelectorAll('input')].find(i => i.getAttribute('name') === nome);
  const abrirSom = () => { v.aoAbrir(); v.pintar(); abrir(BLOCO_SOM); }; // a área de configurações abre (lateral.js render) e ele clica em "Som"
  return { doc, cfg, definidos, falsa, v, corpo, cabs, abrir, abrirSom, caixa, vol, gets, timers, correr, avisos, doPlugin };
}

{
  const s = cenario();
  s.v.aoAbrir(); s.v.pintar();
  await tick();
  const titulos = s.cabs().map(b => b.dataset.bloco);
  caso('área de configurações aberta: Client compacto primeiro, Som em 2º, o bloco Voz sai do compacto (os controles dele estão na Som)',
    titulos[0] === BLOCO_INICIAL && titulos[1] === BLOCO_SOM && !titulos.includes('Voz') && titulos.includes('Alertas na tela'), JSON.stringify(titulos));
  caso('abrir a área de configurações com a Som recolhida: nenhum pedido à LCU (nem GET)', s.falsa.chamadas.length === 0, JSON.stringify(s.falsa.chamadas));
  s.abrir(BLOCO_SOM);
  await tick();
  caso('abrir a seção Som: 1 GET da rota da Riot e nenhuma escrita', s.gets() === 1 && s.falsa.escritas().length === 0 && s.falsa.chamadas[0].url === ROTA_SOM, JSON.stringify(s.falsa.chamadas));
  caso('valores lidos nos controles: música desmarcada, volume da música e as músicas cinza; volume geral 100 e livre',
    s.caixa('musicEnabled').checked === false && s.vol('musicVolume').disabled === true && s.caixa('loginMusicEnabled').disabled === true
      && s.vol('masterVolume').value === '100' && s.vol('masterVolume').disabled === false && s.caixa('sfxEnabled').checked === true && /Volume geral: 100/.test(s.corpo().textContent));
  const tc = s.corpo().textContent;
  caso('a Som junta as chaves do plugin: silenciar depois de aceitar, voz do coach, tom, não repetir e os avisos com voz',
    /Som do client/.test(tc) && /Som do lol-client/.test(tc) && /Silenciar o som depois de aceitar/.test(tc) && /Voz do coach/.test(tc) && /Avisos com voz/.test(tc)
      && !!s.doPlugin('aceite.silenciarSom') && !!s.doPlugin('coach.voz') && !!s.doPlugin('coach.aviso.voz.gank') && !s.doPlugin('coach.aviso.voz.overlay_f8') && !s.doPlugin('coach.aviso.tela.gank'), tc.slice(0, 400));
  caso('o som dentro da partida não é desta rota: a seção diz onde fica', /dentro da partida fica no menu do jogo/.test(tc));
  // repintar (mudança de cfg vinda de outro lugar, busca) não lê de novo nem grava
  s.v.pintar(); s.v.pintar();
  await tick();
  caso('repintar a área de configurações com a Som aberta: nem GET novo nem escrita (o nó do som é o mesmo)', s.gets() === 1 && s.falsa.escritas().length === 0);
  // a área de configurações reabriu: relê na próxima vez que a Som estiver à vista
  s.v.aoAbrir(); s.v.pintar();
  await tick();
  caso('área de configurações reaberta com a Som aberta: lê de novo (ele pode ter mexido nas Configurações da Riot), ainda sem escrita', s.gets() === 2 && s.falsa.escritas().length === 0);

  // caixa: sintética não grava e volta ao valor lido
  const mus = s.caixa('musicEnabled');
  mus.checked = true; mus.disparar('change', { isTrusted: false });
  await tick();
  caso('caixa com evento sintético (isTrusted false): nada sai e a caixa volta ao lido', s.falsa.escritas().length === 0 && mus.checked === false);
  // caixa: clique dele grava na hora, com o alias da Riot
  const sfx = s.caixa('sfxEnabled');
  sfx.checked = false; sfx.disparar('change');
  await tick();
  caso('desmarcar efeitos sonoros (clique dele): 2 PATCHes na ordem, corpos exatos do front', igual(s.falsa.escritas().map(c => [c.metodo, c.url, c.corpo]),
    [['PATCH', ROTA_SOM, { schemaVersion: 5, data: { sfxEnabled: false } }], ['PATCH', ROTA_SOM, { schemaVersion: 5, data: { voiceEnabled: false } }]]), JSON.stringify(s.falsa.escritas()));
  caso('efeitos desligados: volume dos efeitos e falas ficam cinza na hora', s.vol('sfxVolume').disabled === true && s.caixa('pickChampVoEnabled').disabled === true && s.vol('masterVolume').disabled === false);
  // caixa cinza (efeitos desligados) não grava mesmo com o change
  const n0 = s.falsa.escritas().length;
  const fala = s.caixa('pickChampVoEnabled');
  fala.checked = false; fala.disparar('change');
  await tick();
  caso('caixa cinza (falas de escolha com os efeitos desligados): change dele não grava e a caixa volta ao lido',
    s.falsa.escritas().length === n0 && fala.checked === true, JSON.stringify(s.falsa.escritas().slice(n0)));

  // volume: input só muda o número; change sintético não grava; change dele grava depois da espera, só o último
  const mv = s.vol('masterVolume');
  mv.disparar('pointerdown');
  mv.value = '30'; mv.disparar('input');
  caso('arrastando o volume: o número muda ("Volume geral: 30") e nada sai', /Volume geral: 30/.test(s.corpo().textContent) && s.falsa.escritas().length === n0);
  const corpoAntes = s.corpo().children[0];
  s.cfg.coach.voz = false; s.v.pintar(); // cfg mudou no meio do arrasto
  caso('arrastando: a área de configurações não repinta (o controle não sai do lugar)', s.corpo().children[0] === corpoAntes && s.vol('masterVolume') === mv);
  mv.disparar('pointerup');
  // o change do soltar vem depois do pointerup, no mesmo evento do mouse: mover o controle no DOM antes dele perderia a gravação
  caso('soltou: a repintura pendente espera o fim do evento (o controle não sai do lugar antes do change)', s.corpo().children[0] === corpoAntes && !s.v.som.arrastando());
  s.correr();
  caso('soltou: a repintura pendente acontece logo depois', s.corpo().children[0] !== corpoAntes && s.vol('masterVolume') === mv, '');
  mv.value = '35'; mv.disparar('change', { isTrusted: false });
  await tick();
  caso('volume com change sintético: nada sai, nada agendado, o controle volta ao lido', s.falsa.escritas().length === n0 && s.timers.every(t => !t.vivo) && mv.value === '100');
  mv.value = '30'; mv.disparar('change');
  mv.value = '35'; mv.disparar('change');
  mv.value = '40'; mv.disparar('change');
  await tick();
  caso('3 changes seguidos (seta do teclado): nada sai antes da espera', s.falsa.escritas().length === n0 && s.timers.filter(t => t.vivo).length === 1 && s.timers.at(-1).ms === ESPERA_VOLUME_MS);
  caso('durante a espera o controle fica no valor escolhido (a repintura não volta para o lido)', (s.v.pintar(), s.vol('masterVolume').value === '40'));
  s.correr();
  await tick();
  caso('fim da espera: 1 PATCH só, com o último valor', igual(s.falsa.escritas().slice(n0).map(c => c.corpo), [{ schemaVersion: 5, data: { masterVolume: 40 } }]), JSON.stringify(s.falsa.escritas().slice(n0)));
  // volume dos efeitos com alias (religa os efeitos antes, pelo clique dele)
  sfx.checked = true; sfx.disparar('change');
  await tick();
  const n1 = s.falsa.escritas().length;
  const sv = s.vol('sfxVolume');
  sv.value = '75'; sv.disparar('change');
  s.correr();
  await tick();
  caso('volume dos efeitos: sfxVolume 75 e o alias voiceVolume 37.5, na ordem', igual(s.falsa.escritas().slice(n1).map(c => c.corpo), [{ schemaVersion: 5, data: { sfxVolume: 75 } }, { schemaVersion: 5, data: { voiceVolume: 37.5 } }]),
    JSON.stringify(s.falsa.escritas().slice(n1)));
  // caixa do plugin dentro da Som: grava na config do plugin (a dona é o config.js), nunca na LCU
  const n2 = s.falsa.escritas().length, d0 = s.definidos.length;
  const voz = s.doPlugin('coach.voz');
  voz.checked = true; voz.disparar('change');
  const gank = s.doPlugin('coach.aviso.voz.gank');
  gank.checked = false; gank.disparar('change');
  caso('caixas do plugin na Som: definir no cfg do plugin (coach.voz; aviso gank só na voz), nada na LCU',
    igual(s.definidos.slice(d0), [['coach.voz', true], ['coach.avisosDesligados', { voz: ['adversario_voltou', 'gank'], tela: [] }]]) && s.falsa.escritas().length === n2, JSON.stringify(s.definidos.slice(d0)));
  // busca: achar "volume" abre a Som (sem gravar)
  const busca = s.v.el.querySelector('[data-a="cfg-busca"]');
  busca.value = 'volume da música'; busca.disparar('input');
  caso('busca "volume da música": a Som aparece; nada grava', /Volume da música/.test(s.corpo().textContent) && s.falsa.escritas().length === n2);
}

{
  // arrasto que nunca começa ou fica preso não congela a área de configurações (revisão de 16/10/2026)
  const s = cenario();
  s.abrirSom();
  await tick();
  const cinza = s.vol('musicVolume'); // música desligada no GET medido: o volume da música é cinza
  cinza.disparar('pointerdown');
  const a0 = s.corpo().children[0];
  s.v.pintar();
  caso('pointerdown no volume cinza: não conta como arrasto e a área de configurações segue repintando', cinza.disabled && !s.v.som.arrastando() && s.corpo().children[0] !== a0);
  s.vol('masterVolume').disparar('pointerdown');
  const a1 = s.corpo().children[0];
  s.v.pintar();
  const parado = s.corpo().children[0] === a1;
  s.caixa('ambientSfxEnabled').disparar('pointerdown'); // soltou fora do controle (sem pointerup) e clicou noutra linha da seção
  s.correr();
  caso('arrasto preso: o próximo clique na seção fora de um volume solta e a repintura pendente sai', parado && !s.v.som.arrastando() && s.corpo().children[0] !== a1);
  // gravado com uma releitura no meio da espera: o controle fica no valor gravado
  const mv = s.vol('masterVolume');
  mv.value = '20'; mv.disparar('change');
  s.v.aoAbrir(); s.v.pintar(); // área de configurações reaberta durante a espera: GET devolve 100
  await tick();
  s.correr();
  await tick();
  caso('releitura no meio da espera: o PATCH sai com 20 e o controle termina em 20', igual(s.falsa.escritas().at(-1)?.corpo, { schemaVersion: 5, data: { masterVolume: 20 } })
    && s.vol('masterVolume').value === '20' && s.v.som.estado().valores.masterVolume === 20, JSON.stringify([s.vol('masterVolume').value, s.falsa.escritas()]));
}

{
  // revisão do fechamento da etapa B (16/10/2026, noite): furos que os casos acima deixavam passar
  // (a) arrasto preso e o clique seguinte no cabeçalho de outro bloco (fora da seção Som): a área de configurações ficava parada para sempre
  const s = cenario();
  s.abrirSom();
  await tick();
  s.vol('masterVolume').disparar('pointerdown');
  s.v.pintar(); // pendente
  const cab = s.cabs().find(b => b.dataset.bloco === BLOCO_INICIAL);
  cab.disparar('pointerdown'); cab.click(); s.correr();
  caso('arrasto preso + clique no cabeçalho de outro bloco: solta e o bloco abre (a área de configurações não fica parada)',
    !s.v.som.arrastando() && s.corpo().querySelector('.lc-lt-aberto')?.dataset.bloco === BLOCO_INICIAL, s.corpo().querySelector('.lc-lt-aberto')?.dataset.bloco);
  // (b) soltou o mouse fora do controle (o pointerup cai em outro elemento): o documento solta, na captura
  s.abrir(BLOCO_SOM);
  await tick();
  s.vol('masterVolume').disparar('pointerdown');
  const b0 = s.corpo().children[0];
  s.v.pintar();
  s.doc.disparar('pointerup');
  s.correr();
  caso('soltou fora do controle: o pointerup do documento solta e a repintura sai', !s.v.som.arrastando() && s.corpo().children[0] !== b0);
  // (c) dois cliques seguidos na mesma caixa: os PATCHes saem na ordem da Riot (cada clique manda os dois dele, um clique depois do outro)
  const lenta = cenario({ rotas: { [`PATCH ${ROTA_SOM}`]: async () => { await new Promise(r => setImmediate(r)); return { status: 204 }; } } });
  lenta.abrirSom();
  await tick();
  const sfx = lenta.caixa('sfxEnabled');
  sfx.checked = false; sfx.disparar('change');
  sfx.checked = true; sfx.disparar('change');
  await tick(30);
  caso('dois cliques seguidos em "efeitos sonoros": sfx false, voice false, sfx true, voice true (a ordem do front); termina marcada',
    igual(lenta.falsa.escritas().map(c => c.corpo.data), [{ sfxEnabled: false }, { voiceEnabled: false }, { sfxEnabled: true }, { voiceEnabled: true }])
      && sfx.checked === true && lenta.v.som.estado().valores.sfxEnabled === true, JSON.stringify(lenta.falsa.escritas().map(c => c.corpo.data)));
}

{
  // PATCH falha: aviso com o status e releitura (o controle volta ao que o client tem)
  const s = cenario({ rotas: { [`PATCH ${ROTA_SOM}`]: () => ({ status: 500, json: { message: 'x' } }) } });
  s.abrirSom();
  await tick();
  const mus = s.caixa('musicEnabled');
  mus.checked = true; mus.disparar('change');
  await tick(12);
  caso('PATCH 500: aviso com o status e GET de novo; a caixa volta ao lido (desmarcada)',
    s.avisos.length === 1 && /500/.test(s.avisos[0][0]) && s.avisos[0][1] === true && s.gets() === 2 && mus.checked === false, JSON.stringify([s.avisos, s.gets(), mus.checked]));
  // alias falha depois do 1º PATCH ok: para no 1º erro (não manda nada depois dele)
  let n = 0;
  const s2 = cenario({ rotas: { [`PATCH ${ROTA_SOM}`]: () => (++n === 2 ? { status: 500 } : { status: 204 }) } });
  s2.abrirSom();
  await tick();
  const sfx = s2.caixa('sfxEnabled');
  sfx.checked = false; sfx.disparar('change');
  await tick(12);
  caso('alias falhou: 2 PATCHes, 1 aviso e a releitura', s2.falsa.escritas().length === 2 && s2.avisos.length === 1 && s2.gets() === 2);
}

{
  // GET falha: só as chaves do plugin e o motivo; nenhum controle da Riot grava
  const s = cenario({ rotas: { [`GET ${ROTA_SOM}`]: { status: 404, json: { message: 'not found' } } } });
  s.abrirSom();
  await tick();
  const sfx = s.caixa('sfxEnabled');
  sfx.checked = false; sfx.disparar('change');
  const mv = s.vol('masterVolume');
  mv.value = '10'; mv.disparar('change');
  s.correr();
  await tick();
  caso('GET 404: motivo à vista, controles da Riot cinza, nada grava; as chaves do plugin seguem',
    /não foi possível ler o som do client \(404\)/.test(s.corpo().textContent) && OPCOES_SOM.every(o => (o.tipo === 'caixa' ? s.caixa(o.chave) : s.vol(o.chave)).disabled)
      && s.falsa.escritas().length === 0 && sfx.checked === true && !!s.doPlugin('coach.voz') && !!s.doPlugin('aceite.silenciarSom'), s.corpo().textContent.slice(0, 300));
  // versão desconhecida: mostra os valores, só leitura
  const s4 = cenario({ rotas: { [`GET ${ROTA_SOM}`]: { schemaVersion: 4, data: { masterVolume: 30 } } } });
  s4.abrirSom();
  await tick();
  caso('versão 4: valores à vista (volume 30), tudo cinza, motivo; nada grava', s4.vol('masterVolume').value === '30' && s4.vol('masterVolume').disabled && /versão das configurações de som/.test(s4.corpo().textContent)
    && s4.falsa.escritas().length === 0);
  // sem LCU injetada (montagem antiga): a Som mostra o motivo e as chaves do plugin
  const s0 = cenario({ semLcu: true });
  s0.abrirSom();
  await tick();
  caso('sem LCU: motivo "sem LCU" e as chaves do plugin', /sem LCU/.test(s0.corpo().textContent) && /Voz do coach/.test(s0.corpo().textContent));
}

relatar(casos);
