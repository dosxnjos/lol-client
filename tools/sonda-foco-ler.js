// lê o registro da sonda-foco.js (tempo relativo ao 1º evento de ReadyCheck, se houver)
(() => {
  const s = window.__sondaFoco;
  if (!s) return 'sonda não está ativa (client recarregou?)';
  const rc = s.eventos.find(e => e.tipo === 'fase' && e.valor === 'ReadyCheck');
  const zero = rc ? rc.t : s.inicio;
  return (rc ? 't=0 no ReadyCheck\n' : 'sem ReadyCheck ainda; t=0 na injeção\n') +
    s.eventos.map(e => ((e.t - zero) / 1000).toFixed(2).padStart(9) + 's  ' + e.tipo.padEnd(13) + ' ' + JSON.stringify(e.valor)).join('\n');
})()
