// Ponte do plugin com o servidor local do coletor (coletor/servidor_local.py, 127.0.0.1:8765): config do coach,
// draft do champ select, contexto e mentor do pós-jogo. O coletor pode estar fora (client aberto há pouco,
// coletor antigo, porta ocupada): toda chamada falha rápido e quem chama mostra "coletor fora", nunca trava.
// CORS: o servidor só aceita origem local (a página do client é https://127.0.0.1:<porta da LCU>).

export const URL_COLETOR = 'http://127.0.0.1:8765';

const conexao = { ok: null, em: 0, erro: '', enviadoEm: 0 }; // ok null = nunca tentou
export const estadoConexao = () => ({ ...conexao });

// fetch com prazo; devolve {status, dados} (status 0 = coletor fora do ar)
export async function coletor(caminho, { metodo = 'GET', corpo, prazoMs = 8000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), prazoMs);
  try {
    const r = await fetch(URL_COLETOR + caminho, {
      method: metodo, signal: ctl.signal, cache: 'no-store',
      headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    let dados = null;
    try { dados = await r.json(); } catch { /* corpo vazio */ }
    Object.assign(conexao, { ok: true, em: Date.now(), erro: '' });
    return { status: r.status, dados };
  } catch (e) {
    Object.assign(conexao, { ok: false, em: Date.now(), erro: e?.name === 'AbortError' ? 'sem resposta' : 'fora do ar' });
    return { status: 0, dados: null };
  } finally { clearTimeout(t); }
}

// manda as chaves do coach (cfg.coach) ao coletor: na carga, a cada mudança e, enquanto ele estiver fora,
// de novo a cada 30 s (o coletor sobe depois do client: a config tem de chegar sem o Gabriel mexer)
let pendente = null, espera = null;
export function sincronizarConfig(cfg) {
  clearTimeout(espera);
  // várias mudanças seguidas (lista de tipos) viram um POST só
  espera = setTimeout(async () => {
    if (pendente) await pendente;
    pendente = coletor('/config', { metodo: 'POST', corpo: { coach: cfg.coach } }).then(r => {
      if (r.status === 200) conexao.enviadoEm = Date.now();
      else espera = setTimeout(() => sincronizarConfig(cfg), 30000);
      return r;
    }).finally(() => { pendente = null; });
  }, 250);
}
