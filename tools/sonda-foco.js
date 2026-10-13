// sonda do foco ao achar partida (plano 2026-10-13-voz-pregravada-e-foco.md, passo 1). Injetar com
// `node tools/cdp.mjs eval tools/sonda-foco.js`; ler com `node tools/cdp.mjs eval tools/sonda-foco-ler.js`.
// Não fica no plugin: morre quando o client fecha ou recarrega. Só registra mudanças (fase, ux-state,
// foco da página, visibilidade) e toda chamada a /riotclient/* feita pelo JS do client.
(() => {
  if (window.__sondaFoco) return 'sonda já estava ativa (' + window.__sondaFoco.eventos.length + ' eventos)';
  const s = window.__sondaFoco = { inicio: Date.now(), eventos: [], ultimo: {} };
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
