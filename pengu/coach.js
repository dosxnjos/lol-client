// Ponte do plugin com o complemento coach (coletor/servidor_local.py, 127.0.0.1:8765): config do coach ao vivo, draft da
// seleção, contexto e mentor do pós-jogo, reserva do aceite. Plano: roadmap/2026-10-17-plugin-pengu-primeiro.md, Fase 1.
// Duas travas antes de qualquer fetch: (1) cfg.coletor.ligado (padrão false: instalação nova nunca toca a 8765; a config
// salva antes da VERSAO 4 ligou uma vez, config.js migrar) e (2) aperto de mão GET /ola que responde app
// "lol-client-coletor" (porta que responde sem isso = outro programa: ausente). Sem as duas, coletor() devolve status 0 na
// hora, sem fetch. E cada chamador confere o próprio recurso (temRecurso) antes de chamar: o complemento anuncia só o que
// está pendurado nele (servidor_local.recursos).
// Aperto de mão: na carga, na virada para None/Lobby/EndOfGame e, sem achar, com recuo RECUO_MS (30 s -> 2 min -> 5 min);
// fora do recuo, uma tentativa na hora ao entrar em Matchmaking e outra em ReadyCheck (a reserva do aceite do complemento
// só age com contato do plugin durante o próprio ready check, revisão de 19/10: o aperto de mão do ReadyCheck e o diagnóstico
// de cada evento do aceite são esse contato). Todo aperto de mão bom com "coach" manda a config uma vez (substitui o laço de 30 s de antes: é ele que entrega a
// config ao complemento que subiu depois do client). Último aperto de mão bom no DataStore 'lol-client.ponte'
// ({versao, recursos, em}): as Configurações mostram os blocos do coach enquanto procuram, sem perder as chaves a cada
// abertura do client.
// O "não aceitar" e o diagnóstico do aceite (aceite.js, POST /aceite/plugin) são por evento: com o recurso visto no último
// aperto de mão bom, vão na hora mesmo no meio de um recuo de porta fechada (opção evento), e a falha deles não derruba a
// ponte. A sessão se esquece do complemento quando a porta responde sem ser ele (outro programa) e quando a chave desliga.
// CORS: o servidor só aceita origem local (a página do client é https://127.0.0.1:<porta da LCU>).

export const URL_COLETOR = 'http://127.0.0.1:8765';
export const APP = 'lol-client-coletor';
export const RECUO_MS = [30000, 120000, 300000];
export const OLA_PRAZO_MS = 3000;
export const CHAVE_PONTE = 'lol-client.ponte';
// fases que pedem aperto de mão na virada (as duas da fila: fora do recuo, para o complemento ser visto antes do ready check)
export const FASES_APERTO = ['None', 'Lobby', 'EndOfGame', 'Matchmaking', 'ReadyCheck'];

// corpo do POST /config: as chaves do coach + aceiteAtrasoS espelhado do aceite do plugin (a janelinha
// flutuante do coletor conta o mesmo tempo): o atraso efetivo, min(atrasoS, limiteS − 2), ou null com o aceite
// automático desligado. Derivado na hora: não fica salvo no cfg.coach (dono é cfg.aceite).
export function corpoConfig(cfg) {
  const a = cfg.aceite || {};
  const atraso = a.ligado ? Math.max(0, Math.min(Number(a.atrasoS) || 0, (a.limiteS ?? 12) - 2)) : null;
  return { coach: { ...cfg.coach, aceiteAtrasoS: atraso } };
}

// recurso do complemento por um coletor injetado: o da ponte tem .temRecurso; um coletor falso (teste antigo) sem ele conta
// como complemento que anuncia tudo
export const recursoDe = (col, nome) => typeof col === 'function' && (typeof col.temRecurso === 'function' ? !!col.temRecurso(nome) : true);
// o mesmo para o registro das expansões: 'enviar' | 'guardar' | 'descartar' (coletor falso sem .destino: 'enviar')
export const destinoDe = (col, nome) => (typeof col?.destino === 'function' ? col.destino(nome) : typeof col === 'function' ? 'enviar' : 'descartar');

const dsPadrao = {
  get: k => { try { return typeof DataStore === 'undefined' ? null : DataStore.get(k); } catch { return null; } },
  set: (k, v) => { try { if (typeof DataStore !== 'undefined') DataStore.set(k, v); } catch { /* ignora */ } },
};

// cfg: objeto vivo do config.js (lê cfg.coletor.ligado a cada uso). Tudo injetável para o teste (tools/teste-ponte.mjs):
// f = fetch, agendar/cancelar = setTimeout/clearTimeout, agora = relógio, ds = DataStore, ouvintes = Set de f(estado)
export function criarPonte({ cfg = null, f = (...a) => fetch(...a), agendar = (fn, ms) => setTimeout(fn, ms), cancelar = t => clearTimeout(t),
  agora = () => Date.now(), ds = dsPadrao, ouvintes = new Set(), log = m => console.log('[lol-client]', m) } = {}) {
  const est = { visto: false, versao: null, recursos: [], em: 0, tentativas: 0, falhas: 0, proximaEm: null, erro: '', enviadoEm: 0 };
  const sessao = new Set();   // recursos do último aperto de mão bom (eventos do aceite; destino das expansões); esquecerSessao zera
  let vistoNaSessao = false, timer = null, emVoo = null, cfgVivo = cfg, ultimaFase = null, ligadoAntes = null;
  let esperaCfg = null, pendenteCfg = null;

  const ligado = () => !!cfgVivo?.coletor?.ligado;
  const salva = () => { const s = ds.get(CHAVE_PONTE); return s && typeof s === 'object' && Array.isArray(s.recursos) ? s : null; };
  const estado = () => ({ ligado: ligado(), visto: est.visto, procurando: ligado() && !est.visto, versao: est.versao, recursos: [...est.recursos],
    em: est.em, tentativas: est.tentativas, falhas: est.falhas, proximaEm: est.proximaEm, erro: est.erro, enviadoEm: est.enviadoEm,
    salva: salva(), sessao: [...sessao] });
  const avisar = () => { const e = estado(); for (const fn of ouvintes) try { fn(e); } catch (err) { console.error('[lol-client] ponte', err); } };

  // fetch com prazo -> {status, dados, erro}; status 0 = nada respondeu (fora do ar) ou estourou o prazo (sem resposta)
  async function bruto(caminho, { metodo = 'GET', corpo, prazoMs = 8000 } = {}) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    let estourou = false;
    const t = agendar(() => { estourou = true; ctl?.abort(); }, prazoMs);
    try {
      const r = await f(URL_COLETOR + caminho, {
        method: metodo, signal: ctl?.signal, cache: 'no-store',
        headers: corpo === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
      let dados = null;
      try { dados = await r.json(); } catch { /* corpo vazio */ }
      return { status: Number(r.status) || 0, dados, erro: '' };
    } catch (e) {
      return { status: 0, dados: null, erro: estourou || e?.name === 'AbortError' ? 'sem resposta' : 'fora do ar' };
    } finally { cancelar(t); }
  }

  const temRecurso = nome => ligado() && est.visto && est.recursos.includes(nome);
  // recurso do último aperto de mão bom (o "não aceitar" vai mesmo durante um recuo de porta fechada)
  const naSessao = nome => ligado() && sessao.has(nome);
  // para os blocos das Configurações: anunciado agora, ou, procurando, o do último aperto de mão bom gravado
  const mostraRecurso = nome => ligado() && (est.visto ? est.recursos.includes(nome) : !!salva()?.recursos?.includes(nome));
  // registro das expansões (expansoes.js): 'enviar' | 'guardar' (aperto de mão pendente: a fila em memória espera, as saídas
  // da abertura do client acontecem antes do complemento subir) | 'descartar' (chave desligada, ou aperto de mão bom sem o recurso)
  const destino = nome => (!ligado() ? 'descartar' : est.visto ? (est.recursos.includes(nome) ? 'enviar' : 'descartar')
    : vistoNaSessao && !sessao.has(nome) ? 'descartar' : 'guardar');

  function agendarRecuo() {
    cancelar(timer);
    const ms = RECUO_MS[Math.min(est.falhas, RECUO_MS.length - 1)];
    est.falhas++;
    est.proximaEm = agora() + ms;
    timer = agendar(() => { timer = null; apertar('recuo'); }, ms);
  }

  // respondeu = a porta atendeu sem ser o complemento (200 sem app, outro status): ausente de verdade, então a sessão também
  // se esquece dele (nada por evento vai a um programa estranho). Porta fechada ou sem resposta (status 0) mantém a sessão:
  // o "não aceitar" segue indo durante o recuo (complemento reiniciando)
  function esquecerSessao() { sessao.clear(); vistoNaSessao = false; }

  function perder(erro, respondeu = false) {
    const antes = est.visto;
    est.visto = false;
    est.erro = erro;
    if (respondeu) esquecerSessao();
    agendarRecuo();
    if (antes) { log(`complemento coach perdido (${erro}); procurando`); avisar(); }
  }

  // GET /ola -> true se achou o complemento. Um por vez (pedido em voo é reaproveitado)
  function apertar(motivo = '') {
    if (!ligado()) return Promise.resolve(false);
    if (emVoo) return emVoo;
    cancelar(timer);
    timer = null;
    est.tentativas++;
    emVoo = bruto('/ola', { prazoMs: OLA_PRAZO_MS }).then(r => {
      if (!ligado()) return false;   // desligou no meio do pedido
      const d = r.dados;
      if (r.status === 200 && d && typeof d === 'object' && d.app === APP && Array.isArray(d.recursos)) {
        const recursos = [...new Set(d.recursos.filter(x => typeof x === 'string'))].sort();
        const mudou = !est.visto || est.versao !== (d.versao ?? null) || est.recursos.join() !== recursos.join();
        Object.assign(est, { visto: true, versao: d.versao ?? null, recursos, em: agora(), falhas: 0, proximaEm: null, erro: '' });
        // a sessão vale o último aperto de mão bom, não a soma: complemento que voltou sem um recurso não recebe a rota dele
        esquecerSessao();
        vistoNaSessao = true;
        for (const x of recursos) sessao.add(x);
        ds.set(CHAVE_PONTE, { versao: est.versao, recursos, em: est.em });
        if (mudou) { log(`complemento coach encontrado (versão ${est.versao ?? '?'}; ${recursos.join(', ') || 'sem recursos'}; ${motivo})`); avisar(); }
        // todo aperto de mão bom com coach manda a config (o complemento pode ter subido ou reiniciado agora)
        if (recursos.includes('coach')) sincronizarConfig();
        return true;
      }
      // porta respondendo sem o app (outro programa) ou erro: ausente
      perder(r.status === 0 ? r.erro : r.status === 200 ? 'outro programa na porta' : `respondeu ${r.status}`, r.status !== 0);
      return false;
    }).finally(() => { emVoo = null; });
    return emVoo;
  }

  // chamada ao complemento -> {status, dados}; status 0 sem fetch com a ponte desligada ou sem aperto de mão.
  // evento: true (aceite.js) = vale com o complemento visto nesta sessão mesmo durante um recuo, e a falha não derruba a ponte
  async function coletor(caminho, opcoes = {}) {
    const evento = !!opcoes.evento;
    if (!ligado() || !(est.visto || (evento && vistoNaSessao))) return { status: 0, dados: null };
    const r = await bruto(caminho, opcoes);
    // a porta não atende mais (complemento parou): volta a procurar. "sem resposta" (ocupado) não derruba
    if (r.status === 0 && r.erro === 'fora do ar' && !evento && est.visto && ligado()) perder(r.erro);
    return { status: r.status, dados: r.dados };
  }
  coletor.temRecurso = temRecurso;
  coletor.destino = destino;

  // config do coach (POST /config): na mudança do cfg e a cada aperto de mão bom; só com "coach" anunciado. Várias mudanças
  // seguidas (lista de tipos) viram um POST só. Sem o complemento visto, nada: o próximo aperto de mão bom manda
  function sincronizarConfig() {
    if (!temRecurso('coach')) return false;
    cancelar(esperaCfg);
    esperaCfg = agendar(async () => {
      esperaCfg = null;
      if (pendenteCfg) await pendenteCfg;
      if (!temRecurso('coach')) return;
      pendenteCfg = coletor('/config', { metodo: 'POST', corpo: corpoConfig(cfgVivo) }).then(r => {
        if (r.status === 200) est.enviadoEm = agora();
        return r;
      }).finally(() => { pendenteCfg = null; });
    }, 250);
    return true;
  }

  // cfg mudou (index.js aoMudar): a chave da ponte ligou/desligou e a config do coach
  function sincronizar(c) {
    if (c) cfgVivo = c;
    const agoraLigado = ligado();
    if (agoraLigado !== ligadoAntes) {
      ligadoAntes = agoraLigado;
      if (!agoraLigado) {
        cancelar(timer); timer = null;
        cancelar(esperaCfg); esperaCfg = null;
        esquecerSessao();   // religar começa do zero: nada por evento antes de um aperto de mão novo
        Object.assign(est, { visto: false, recursos: [], versao: null, falhas: 0, proximaEm: null, erro: '' });
        avisar();
        return false;
      }
      avisar();
      apertar('ponte ligada');
      return true;
    }
    return sincronizarConfig();
  }

  // fase do gameflow (index.js assina o socket): aperto de mão na virada para as FASES_APERTO
  function aoFase(fase) {
    if (fase === ultimaFase) return null;
    ultimaFase = fase;
    if (!FASES_APERTO.includes(fase) || !ligado()) return null;
    return apertar(`fase ${fase}`);
  }

  function iniciar() {
    ligadoAntes = ligado();
    return ligadoAntes ? apertar('carga') : Promise.resolve(false);
  }

  return { coletor, temRecurso, naSessao, mostraRecurso, destino, apertar, aoFase, sincronizar, sincronizarConfig, iniciar, estado,
    aoMudar: fn => (ouvintes.add(fn), () => ouvintes.delete(fn)) };
}

// ---- instância do plugin (index.js chama iniciarPonte). Antes dela (e nos testes que só importam módulos): ponte sem cfg,
// desligada, nenhum fetch. Os ouvintes moram aqui para sobreviver à troca da instância ----
const ouvintesPonte = new Set();
let ponte = criarPonte({ ouvintes: ouvintesPonte });

export function iniciarPonte(cfg, opcoes = {}) {
  ponte = criarPonte({ cfg, ouvintes: ouvintesPonte, ...opcoes });
  ponte.iniciar();
  return ponte;
}

export const coletor = (caminho, opcoes) => ponte.coletor(caminho, opcoes);
coletor.temRecurso = nome => ponte.temRecurso(nome);
coletor.destino = nome => ponte.destino(nome);
export const temRecurso = nome => ponte.temRecurso(nome);
export const naSessao = nome => ponte.naSessao(nome);
export const mostraRecurso = nome => ponte.mostraRecurso(nome);
export const destinoRecurso = nome => ponte.destino(nome);
export const estadoPonte = () => ponte.estado();
export const aoFasePonte = fase => ponte.aoFase(fase);
export const aoMudarPonte = fn => (ouvintesPonte.add(fn), () => ouvintesPonte.delete(fn));
export const sincronizarConfig = cfg => ponte.sincronizar(cfg);
export const apertarMao = motivo => ponte.apertar(motivo);
