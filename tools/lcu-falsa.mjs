// LCU falsa para os testes do plugin (tools/teste-*.mjs): nenhum teste fala com o client de verdade.
// rotas: { 'GET /caminho': resposta | (corpo, chamada) => resposta }, resposta = valor JSON (200) ou
// { status, json }. Rota que não existe devolve 404. chamadas: [{metodo, url, corpo}] na ordem.
export function lcuFalsa(rotas = {}) {
  const chamadas = [];
  const fetch = async (url, opts = {}) => {
    const metodo = (opts.method || 'GET').toUpperCase();
    const corpo = opts.body === undefined ? undefined : JSON.parse(opts.body);
    const chamada = { metodo, url, corpo };
    chamadas.push(chamada);
    let h = rotas[`${metodo} ${url}`];
    if (typeof h === 'function') h = await h(corpo, chamada);
    const resp = h === undefined ? { status: 404, json: { message: 'not found' } }
      : h && typeof h === 'object' && 'status' in h && Object.keys(h).every(k => k === 'status' || k === 'json') ? h : { status: 200, json: h };
    const texto = resp.json === undefined || resp.json === null ? '' : JSON.stringify(resp.json);
    return { ok: resp.status >= 200 && resp.status < 300, status: resp.status, text: async () => texto, json: async () => JSON.parse(texto) };
  };
  return { fetch, chamadas, escritas: () => chamadas.filter(c => c.metodo !== 'GET') };
}

// relatório padrão dos testes: [nome, passou] -> imprime e sai com 0/1
export function relatar(casos) {
  let ok = 0;
  for (const [nome, passou, detalhe] of casos) { ok += !!passou; console.log(passou ? 'ok' : 'FALHOU', nome, passou ? '' : (detalhe ?? '')); }
  console.log(`${ok}/${casos.length} ok`);
  process.exit(ok === casos.length ? 0 : 1);
}
