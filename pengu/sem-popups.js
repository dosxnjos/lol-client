// Cala avisos automáticos do client com resposta falsa estreita: só GET das rotas exatas de ROTAS devolve `false`
// (as duas devolvem bool e o client só mostra o aviso com true). Todo o resto passa intacto, inclusive POST/PUT da mesma
// rota (o client usa para dizer "já vi"). Medido no client 16.20 em 13/10/2026: roadmap/2026-10-13-chat-popups-som.md.
// O dataBinding do client pede por XMLHttpRequest cru (jsonRequest do rcp-fe-common-libs): o embrulho principal é no
// XMLHttpRequest.prototype; o fetch vai junto por garantia. A config é lida na hora do send (desligar vale na hora).
// Nunca entra aqui: /lol-champ-select/v1/session (o coletor lê isAutofilled), /lol-missions, reward-grants, /lol-settings,
// conduta/punição/Vanguard. "Você foi preenchido" ficou de fora: /lol-lobby/v1/autofill-displayed não tem consumidor
// no 16.20 (o aviso sai da sessão do champ select).
// Importável no node (tools/teste-sem-popups.mjs): nada de window/document no topo do módulo.

export const ROTAS = {
  // aviso "as tuas páginas de runa foram modificadas automaticamente" (champ select e botão Jogar)
  '/lol-perks/v1/show-auto-modified-pages-notification': { chave: 'runasAutomaticas', resposta: false },
  // aviso "golpear foi colocado automaticamente" (champ select, fase de planejamento)
  '/lol-lobby-team-builder/champ-select/v1/has-auto-assigned-smite': { chave: 'smiteAutomatico', resposta: false },
};

// caminho sem host, query nem barra final; url relativa ou absoluta (https://127.0.0.1:porta/...)
export function caminho(url) {
  try {
    const p = new URL(String(url), 'https://lcu.invalid/').pathname;
    return p.length > 1 ? p.replace(/\/+$/, '') : p;
  } catch { return ''; }
}

// -> { rota, chave, resposta } quando este pedido deve ser respondido por nós; senão null
export function rotaFalsa(metodo, url, cfg) {
  if (String(metodo || 'GET').toUpperCase() !== 'GET') return null;
  const sp = cfg?.semPopups;
  if (!sp?.ligado) return null;
  const rota = caminho(url);
  const r = Object.prototype.hasOwnProperty.call(ROTAS, rota) ? ROTAS[rota] : null;
  if (!r || !sp[r.chave]) return null;
  return { rota, chave: r.chave, resposta: r.resposta };
}

const MARCA = Symbol.for('lol-client.sem-popups');

// fetch(input, init) com input string, URL ou Request
export function embrulharFetch(fetchOriginal, cfg, Resp = globalThis.Response) {
  if (typeof fetchOriginal !== 'function') return fetchOriginal;
  if (fetchOriginal[MARCA]) return fetchOriginal;
  const embrulhado = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input?.url ?? String(input);
      const metodo = init?.method || (typeof input === 'object' && input?.method) || 'GET';
      const f = rotaFalsa(metodo, url, cfg);
      if (f && typeof Resp === 'function') {
        return Promise.resolve(new Resp(JSON.stringify(f.resposta), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
    } catch { /* qualquer erro: pedido de verdade */ }
    return fetchOriginal.apply(this, arguments);
  };
  embrulhado[MARCA] = true;
  return embrulhado;
}

// Troca open/send do protótipo (uma vez só por protótipo). Pedido falsificado: o send de verdade não sai; no tique
// seguinte o objeto ganha readyState 4, status 200 e o corpo, e recebe readystatechange, load e loadend (o client lê
// status/responseText; o Datadog do client escuta loadend no mesmo objeto).
export function embrulharXhr(XHR, cfg, adiar = fn => setTimeout(fn, 0)) {
  const proto = XHR?.prototype;
  if (!proto || typeof proto.open !== 'function' || typeof proto.send !== 'function') return false;
  if (proto[MARCA]) return true;
  const pedidos = new WeakMap();
  const open = proto.open, send = proto.send;
  proto.open = function (metodo, url) {
    try { pedidos.set(this, { metodo, url }); } catch { /* ignora */ }
    return open.apply(this, arguments);
  };
  proto.send = function () {
    let f = null;
    try { const p = pedidos.get(this); if (p) f = rotaFalsa(p.metodo, p.url, cfg); } catch { f = null; }
    if (!f) return send.apply(this, arguments);
    const xhr = this, corpo = JSON.stringify(f.resposta), url = pedidos.get(this)?.url;
    adiar(() => {
      const fixar = (k, v) => { try { Object.defineProperty(xhr, k, { configurable: true, get: () => v }); } catch { /* ignora */ } };
      fixar('readyState', 4);
      fixar('status', 200);
      fixar('statusText', 'OK');
      fixar('responseText', corpo);
      fixar('response', xhr.responseType === 'json' ? f.resposta : corpo);
      fixar('responseURL', String(url ?? ''));
      try {
        xhr.getResponseHeader = nome => (/^content-type$/i.test(String(nome)) ? 'application/json' : null);
        xhr.getAllResponseHeaders = () => 'content-type: application/json\r\n';
      } catch { /* ignora */ }
      const evento = tipo => (tipo !== 'readystatechange' && typeof ProgressEvent === 'function' ? new ProgressEvent(tipo) : new Event(tipo));
      for (const tipo of ['readystatechange', 'load', 'loadend']) {
        try { xhr.dispatchEvent(evento(tipo)); } catch (e) { console.error('[lol-client] sem-popups', e); }
      }
    });
    return undefined;
  };
  proto[MARCA] = true;
  return true;
}

// liga no init do plugin (antes dos plugins do client começarem a pedir)
export function iniciarSemPopups(cfg) {
  embrulharXhr(window.XMLHttpRequest, cfg);
  window.fetch = embrulharFetch(window.fetch, cfg);
  return { rotaFalsa: (metodo, url) => rotaFalsa(metodo, url, cfg), rotas: Object.keys(ROTAS) };
}

// bloco "Avisos do client" nas Configurações (registrarBloco)
export function blocoSemPopups(corpo, { cfg, definir, ui }) {
  corpo.append(
    ui.caixa('semPopups.ligado', 'Calar avisos automáticos do client', 'Some com os avisos que o client mostra quando o jogo muda algo sozinho. Nada muda no jogo: só o aviso não aparece.',
      cfg.semPopups.ligado, v => definir('semPopups.ligado', v)),
    ui.caixa('semPopups.runasAutomaticas', 'Aviso de runas mudadas pelo jogo', 'Depois de um patch o jogo ajusta páginas de runa sozinho e o client avisa no champ select e no botão Jogar.',
      cfg.semPopups.runasAutomaticas, v => definir('semPopups.runasAutomaticas', v)),
    ui.caixa('semPopups.smiteAutomatico', 'Aviso de golpear colocado sozinho', 'Quando você cai de selva sem golpear, o jogo põe o feitiço e o client avisa no champ select.',
      cfg.semPopups.smiteAutomatico, v => definir('semPopups.smiteAutomatico', v)),
    ui.explica('O aviso de "você foi preenchido" continua: no client atual ele sai do próprio champ select, que o lol-client não toca.'));
}
