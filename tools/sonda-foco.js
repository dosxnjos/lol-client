// sonda do foco ao achar partida (plano 2026-10-13-voz-pregravada-e-foco.md, passo 1). Injetar com
// `node tools/cdp.mjs eval tools/sonda-foco.js`; ler com `node tools/cdp.mjs eval tools/sonda-foco-ler.js`.
// Não fica no plugin: morre quando o client fecha ou recarrega. Só registra mudanças (fase, ux-state,
// foco da página, visibilidade) e toda chamada a /riotclient/* feita pelo JS do client.
(() => {
  if (window.__sondaFoco && window.__sondaFoco.versao === 2) return 'sonda já estava ativa (' + window.__sondaFoco.eventos.length + ' eventos)';
  if (window.__sondaFoco) clearInterval(window.__sondaFoco.timer);   // v1 injetada antes: troca pela v2
  const s = window.__sondaFoco = { versao: 2, inicio: Date.now(), eventos: [], ultimo: {} };
  const reg = (tipo, valor) => {
    s.eventos.push({ t: Date.now(), tipo, valor });
    if (s.eventos.length > 2000) s.eventos.splice(0, 500);
  };
  const mudou = (tipo, valor) => { if (s.ultimo[tipo] !== valor) { s.ultimo[tipo] = valor; reg(tipo, valor); } };
  const pilha = () => (new Error().stack || '').split('\n').slice(2, 6).map(l => l.trim()).join(' <- ');

  const fetchOrig = window.fetch;
  window.fetch = function (url, opts) {
    const u = typeof url === 'string' ? url : (url && url.url) || '';
    if (u.includes('/riotclient/') && !s.lendo) reg('fetch', ((opts && opts.method) || 'GET') + ' ' + u + ' | ' + pilha());
    return fetchOrig.apply(this, arguments);
  };
  const abrirOrig = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (metodo, url) {
    if (String(url).includes('/riotclient/')) reg('xhr', metodo + ' ' + url + ' | ' + pilha());
    return abrirOrig.apply(this, arguments);
  };
  // chamadas nativas do JS do client (Window.Show, Window.Activate, Window.Flash...) passam pelo riotInvoke,
  // não por fetch/XHR: a 1ª sonda (13/10, 14:43) não via esse caminho
  if (typeof window.riotInvoke === 'function') {
    const invOrig = window.riotInvoke;
    window.riotInvoke = function (arg) {
      let nome = '?';
      try { nome = JSON.parse(arg && arg.request).name; } catch (e) {}
      if (!/^Mouse\./.test(nome)) reg('riotInvoke', nome + ' | ' + (arg && arg.request || '').slice(0, 120) + ' | ' + pilha());
      return invOrig.apply(this, arguments);
    };
  }
  // pedido de estado da janela vindo do backend (OnJsonApiEvent_riotclient_ux-state_request) e qualquer
  // mensagem de websocket que fale de ux-state
  const wsSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    if (!this.__sondaFoco) {
      this.__sondaFoco = true;
      this.addEventListener('message', ev => { const t = String(ev.data); if (/ux-state|ux-show|ux-flash/.test(t)) reg('ws<-', t.slice(0, 200)); });
    }
    const t = String(d);
    if (/ux-state|ux-show|ux-flash|ux-minimize/.test(t)) reg('ws->', t.slice(0, 200));
    return wsSend.apply(this, arguments);
  };
  const focoOrig = window.focus;
  window.focus = function () { reg('window.focus', pilha()); return focoOrig.apply(this, arguments); };

  window.addEventListener('focus', () => reg('evento', 'focus'));
  window.addEventListener('blur', () => reg('evento', 'blur'));
  document.addEventListener('visibilitychange', () => reg('evento', 'visibility:' + document.visibilityState));

  const ler = async p => { s.lendo = true; try { return await (await fetchOrig(p)).json(); } catch (e) { return 'erro'; } finally { s.lendo = false; } };
  s.timer = setInterval(async () => {
    mudou('hasFocus', document.hasFocus());
    mudou('fase', await ler('/lol-gameflow/v1/gameflow-phase'));
    mudou('ux-state', await ler('/riotclient/ux-state'));
  }, 250);
  return 'sonda ativa';
})()
