// Aviso de versão nova do pacote público (P2 de roadmap/2026-10-19-publicacao-e-complemento-publico.md; decisão do Gabriel de
// 19/10/2026: "aviso quando tiver versão nova", 1 vez por dia, chave para desligar, ligada por padrão).
// Consulta GET https://api.github.com/repos/<REPO>/releases/latest (REPO e VERSAO de ./versao.js; CORS da api.github.com medido de
// dentro do client no P0-b). Travas antes de qualquer fetch automático: cfg.atualizacao.verificar ligado, REPO no formato dono/nome,
// fase do gameflow None ou Lobby (nunca fila, seleção ou partida) e 24 h desde a última consulta. "procurar agora" é clique dele:
// pula só as 24 h e a fase. Prazo de 5 s (o fetch do CEF não tem prazo, ARMADILHAS § LCU); erro, 404 (repositório ainda não
// criado), 403 (limite da API) e resposta malformada ficam calados: nenhum aviso de falha, só a hora da tentativa anotada.
// Estado no DataStore 'lol-client.atualizacao' ({repo, em, okEm, versao, tag, corpo}): nada pessoal, o corpo do release cortado
// em CORPO_MAX (o DataStore é um JSON só, regravado inteiro a cada set). O corpo é sempre texto (textContent), nunca HTML.
// Versão nova: a linha "Versão x.y.z disponível" no topo das Configurações (o client normal e a ⚙ do compacto, pelo usarTopo
// do configuracoes.js) com "atualizar" e "o que mudou", e a classe lc-versao-nova no <html> (o ponto no ⚙ do compacto,
// compacto/chat-botao.js). Nada abre sozinho. O "atualizar" chama o atualizador registrado (registrarAtualizador; P3,
// pengu/atualizador.js: complemento coach ou atualizar.cmd); sem ele, diz onde baixar. O atualizador recebe ({versao, tag, repo},
// {fase, progresso}) e devolve texto ou {texto, link, recarregar}: link = endereço da página da versão com "abrir página" e
// "copiar link", recarregar = "recarregar agora", que só recarrega em None/Lobby e por clique. "abrir página" (medição P0-a,
// 20/10/2026: window.open no client abre uma aba no navegador padrão e devolve null) chama window.open(url, '_blank') só dentro
// do clique dele (evento com isTrusted === true) e só com um endereço de linkAbrivel (página de releases do REPO); o null não
// diz se abriu, então "copiar link" e o endereço selecionável ficam de reserva.
import { VERSAO, REPO } from './versao.js';

export const CHAVE_ATUALIZACAO = 'lol-client.atualizacao';
export const DIA_MS = 24 * 3600 * 1000;
export const PRAZO_MS = 5000;
export const LACO_MS = 3600 * 1000;      // o client parado no lobby por dias: confere a cada hora se a consulta do dia venceu
export const FASES_CONSULTA = ['None', 'Lobby'];
export const CORPO_MAX = 4000;
export const CLASSE_NOVA = 'lc-versao-nova';

// 'v1.10.0' | '1.10.0' -> [1, 10, 0]; outra coisa (pré-lançamento, texto, número) -> null
export function lerVersao(v) {
  const m = typeof v === 'string' ? v.trim().match(/^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/) : null;
  return m ? m.slice(1).map(Number) : null;
}
// a > b -> 1, igual 0, menor -1; versão inválida -> null
export function compararVersoes(a, b) {
  const x = lerVersao(a), y = lerVersao(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
  return 0;
}
export const repoValido = r => typeof r === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/.test(r) && !/\/\.\.?$/.test(r);
export const urlConsulta = repo => `https://api.github.com/repos/${repo}/releases/latest`;
export const enderecoReleases = repo => `github.com/${repo}/releases`;
// endereço que "abrir página" aceita: só https://github.com/<repo>/releases ou .../releases/tag/vX.Y.Z do REPO, inteiro (o
// link já nasce do REPO e de uma tag x.y.z conferida em lerRelease; isto é a 2ª trava) -> o link ou ''
const escRegex = s => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
export function linkAbrivel(link, repo) {
  if (typeof link !== 'string' || !repoValido(repo)) return '';
  const ok = new RegExp(`^https://github\\.com/${escRegex(repo)}/releases(?:/tag/v?\\d{1,6}\\.\\d{1,6}\\.\\d{1,6})?$`).test(link);
  return ok ? link : '';
}

// corpo da API -> {versao, tag, corpo} ou null (rascunho, pré-lançamento, tag fora de x.y.z, corpo que não é texto)
export function lerRelease(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d) || d.draft === true || d.prerelease === true) return null;
  const v = lerVersao(d.tag_name);
  if (!v) return null;
  const corpo = typeof d.body === 'string' ? d.body : d.body == null ? '' : null;
  if (corpo === null) return null;
  return { versao: v.join('.'), tag: String(d.tag_name).trim(), corpo: corpo.replace(/\r\n?/g, '\n').slice(0, CORPO_MAX) };
}

const dsPadrao = {
  get: k => { try { return typeof DataStore === 'undefined' ? null : DataStore.get(k); } catch { return null; } },
  set: (k, v) => { try { if (typeof DataStore !== 'undefined') DataStore.set(k, v); } catch { /* ignora */ } },
};
// fase atual pela LCU (só GET; o socket só avisa na virada, e o plugin pode carregar já em None)
const lerFasePadrao = async () => {
  try { const r = await fetch('/lol-gameflow/v1/gameflow-phase'); return r.ok ? await r.json() : null; } catch { return null; }
};
// recarrega a interface do client (o plugin novo só vale depois disso); quem chama confere a fase antes
const recarregarPadrao = () => { try { globalThis.location?.reload(); } catch { /* sem página */ } };
// área de transferência: a API nova e, se o CEF negar, o execCommand de um textarea escondido
const copiarPadrao = async texto => {
  try { await navigator.clipboard.writeText(texto); return true; } catch { /* sem permissão no CEF: recuo abaixo */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = texto; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return !!ok;
  } catch { return false; }
};
// a página no navegador padrão (P0-a: o client manda o window.open para o navegador do Windows e devolve null mesmo abrindo;
// a chamada medida, sem 3º argumento). O retorno não diz nada: nunca vira erro. Quem chama confere o clique dele antes
const abrirPadrao = url => { try { globalThis.window?.open?.(url, '_blank'); } catch { /* sem janela */ } };
export const TEXTO_RECARREGAR_FORA = 'Recarregue na tela inicial ou no lobby.';
export const TEXTO_ABRINDO = 'A página abre no navegador padrão. Se ela não aparecer, use "copiar link".';

// cfg: objeto vivo do config.js. Tudo injetável (tools/teste-atualizacao.mjs): f = fetch, agendar/cancelar, agora, ds, lerFase,
// recarregarPagina, copiar, abrir
export function criarVerificador({ cfg = null, versao = VERSAO, repo = REPO, f = (...a) => fetch(...a), agendar = (fn, ms) => setTimeout(fn, ms),
  cancelar = t => clearTimeout(t), agora = () => Date.now(), ds = dsPadrao, lerFase = lerFasePadrao, ouvintes = new Set(),
  log = m => console.log('[lol-client]', m), recarregarPagina = recarregarPadrao, copiar = copiarPadrao, abrir = abrirPadrao } = {}) {
  // ultimaEm: a hora da última tentativa também em memória (DataStore ausente ou que não grava não vira 1 GET por virada de fase)
  let cfgVivo = cfg, fase = null, emVoo = null, laco = null, ligadoAntes = null, ultimaEm = 0;
  // só da sessão: o resultado do último "procurar agora" e o que a linha mostra (sobrevive à remontagem do painel); a mensagem do
  // "atualizar" vale só para a versão em mensagemDe (versão mais nova vista depois apaga a mensagem velha). P3: atualizando = o
  // atualizador em curso (o botão some), acao = {link, recarregar} da resposta dele, copiado = 'ok' | 'falhou' do "copiar link",
  // abriu = o "abrir página" foi clicado (só a dica de reserva: o window.open não diz se abriu)
  const tela = { resultado: '', notas: false, mensagem: '', mensagemDe: '', atualizando: false, acao: null, copiado: '', abriu: false };
  let atualizador = null;

  const ligado = () => !!cfgVivo?.atualizacao?.verificar;
  const salvo = () => {
    const s = ds.get(CHAVE_ATUALIZACAO);
    return s && typeof s === 'object' && !Array.isArray(s) && s.repo === repo ? s : null;
  };
  const nova = () => {
    const s = salvo();
    return s && compararVersoes(s.versao, versao) === 1 ? { versao: lerVersao(s.versao).join('.'), tag: String(s.tag || ''), corpo: typeof s.corpo === 'string' ? s.corpo : '' } : null;
  };
  // a linha e o ponto: com a chave ligada, ou depois de um "procurar agora" feito com a chave já desligada que achou versão nova
  // nesta sessão (desligar a chave apaga o resultado 'nova' de antes: sincronizar)
  const aviso = () => (ligado() || tela.resultado === 'nova' ? nova() : null);
  const vencida = () => {
    const em = Math.max(ultimaEm, Number(salvo()?.em) || 0);
    const t = agora();
    return !em || t - em >= DIA_MS || em > t + 60000;   // relógio que voltou não trava a consulta para sempre
  };
  const podeAuto = () => ligado() && repoValido(repo) && FASES_CONSULTA.includes(fase) && vencida();

  const daVersao = () => tela.mensagemDe === (nova()?.versao || '');
  const mensagem = () => (tela.mensagem && daVersao() ? tela.mensagem : '');
  const acao = () => (tela.acao && daVersao() ? { ...tela.acao } : null);
  const estado = () => ({ ligado: ligado(), versao, repo, fase, verificando: !!emVoo, salvo: salvo(), nova: nova(), aviso: aviso(),
    resultado: tela.resultado, notas: tela.notas, mensagem: mensagem(), atualizador: typeof atualizador === 'function',
    atualizando: tela.atualizando, acao: acao(), copiado: acao()?.link ? tela.copiado : '',
    abrivel: !!linkAbrivel(acao()?.link, repo), abriu: !!linkAbrivel(acao()?.link, repo) && tela.abriu });
  const avisar = () => { const e = estado(); for (const fn of ouvintes) try { fn(e); } catch (err) { console.error('[lol-client] atualização', err); } };

  // GET com prazo -> {status, dados}; status 0 = sem resposta (rede, prazo, CORS)
  async function pedir() {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    let estourou = false, t = null;
    const prazo = new Promise(res => { t = agendar(() => { estourou = true; ctl?.abort(); res({ status: 0, dados: null }); }, PRAZO_MS); });
    const pedido = (async () => {
      try {
        const r = await f(urlConsulta(repo), { method: 'GET', signal: ctl?.signal, cache: 'no-store', credentials: 'omit',
          headers: { Accept: 'application/vnd.github+json' } });
        const status = Number(r?.status) || 0;
        let dados = null;
        if (status === 200) try { dados = await r.json(); } catch { /* corpo que não é JSON */ }
        return { status: estourou ? 0 : status, dados: estourou ? null : dados };
      } catch { return { status: 0, dados: null }; }
    })();
    try { return await Promise.race([pedido, prazo]); } finally { cancelar(t); }
  }

  // uma consulta (um por vez). manual = clique em "procurar agora" -> 'nova' | 'nenhuma' | 'falhou'
  function consultar(motivo, manual = false) {
    if (emVoo) {
      // "procurar agora" com a consulta automática em voo: espera ela e mostra o resultado (sem 2º fetch)
      if (!manual) return emVoo;
      tela.resultado = 'procurando'; avisar();
      return emVoo.then(res => { tela.resultado = res; avisar(); return res; });
    }
    if (!repoValido(repo)) { if (manual) { tela.resultado = 'falhou'; avisar(); } return Promise.resolve('falhou'); }
    const antes = salvo() || {};
    const t0 = agora();
    // a hora da tentativa vai antes do fetch: erro ou recarga no meio não fazem a consulta repetir no mesmo dia
    ultimaEm = t0;
    ds.set(CHAVE_ATUALIZACAO, { ...antes, repo, em: t0 });
    const tinhaAviso = aviso()?.versao || '';
    const tinhaResultado = tela.resultado;
    emVoo = pedir().then(r => {
      const rel = r.status === 200 ? lerRelease(r.dados) : null;
      if (!rel) return 'falhou';   // calado: 404 (repositório ainda não existe), 403, rede, prazo, resposta malformada
      ds.set(CHAVE_ATUALIZACAO, { repo, em: t0, okEm: agora(), versao: rel.versao, tag: rel.tag, corpo: rel.corpo });
      const cmp = compararVersoes(rel.versao, versao);
      if (cmp === 1 && rel.versao !== tinhaAviso) log(`versão ${rel.versao} disponível (instalada ${versao}; ${motivo})`);
      return cmp === 1 ? 'nova' : 'nenhuma';
    }).catch(() => 'falhou').then(res => {
      emVoo = null;
      // a automática que respondeu apaga o resultado de um clique antigo ("Nenhuma versão nova." com a linha dizendo 0.2.0);
      // a que falhou não apaga o que se sabe
      if (manual) tela.resultado = res;
      else if (res !== 'falhou' && tela.resultado !== 'procurando') tela.resultado = '';
      if (manual || tela.resultado !== tinhaResultado || (aviso()?.versao || '') !== tinhaAviso) avisar();
      return res;
    });
    // o repaint de "Procurando…" já vê a consulta em voo (o botão some só durante o clique dele)
    if (manual) { tela.resultado = 'procurando'; avisar(); }
    return emVoo;
  }

  const tentar = motivo => (podeAuto() ? consultar(motivo) : null);

  function agendarLaco() {
    cancelar(laco);
    laco = agendar(() => { laco = null; tentar('laço'); agendarLaco(); }, LACO_MS);
  }

  // fase do gameflow (index.js assina o socket)
  function aoFase(f) {
    if (typeof f !== 'string' || f === fase) return null;
    fase = f;
    return tentar(`fase ${f}`);
  }

  // cfg mudou: a chave ligou agora -> consulta se o dia venceu; desligou -> a linha e o ponto somem
  function sincronizar(c) {
    if (c) cfgVivo = c;
    const agoraLigado = ligado();
    if (agoraLigado === ligadoAntes) return null;
    // desligou: o 'nova' de um "procurar agora" feito com a chave ligada não segura a linha nem o ponto
    if (ligadoAntes && !agoraLigado && tela.resultado === 'nova') tela.resultado = '';
    ligadoAntes = agoraLigado;
    avisar();
    return agoraLigado ? tentar('chave ligada') : null;
  }

  async function iniciar() {
    ligadoAntes = ligado();
    agendarLaco();
    if (aviso()) avisar();   // versão nova vista ontem: o ponto aparece já na carga
    let f = null;
    try { f = await lerFase(); } catch { /* sem fase: espera o socket */ }
    if (fase === null && typeof f === 'string') fase = f;
    return tentar('carga');
  }

  // resposta do atualizador: texto, ou {texto, link, recarregar}
  function aplicar(r) {
    tela.copiado = '';
    tela.abriu = false;
    if (r && typeof r === 'object') {
      tela.mensagem = typeof r.texto === 'string' ? r.texto : '';
      const link = typeof r.link === 'string' && /^https:\/\/github\.com\//.test(r.link) ? r.link : '';
      tela.acao = link || r.recarregar === true ? { link, recarregar: r.recarregar === true } : null;
    } else { tela.mensagem = typeof r === 'string' ? r : ''; tela.acao = null; }
  }

  // "atualizar": o atualizador da P3 (pengu/atualizador.js: complemento coach ou atualizar.cmd) -> texto ou {texto, link,
  // recarregar} para a linha; sem ele, onde baixar. Um por vez: o botão some enquanto ele trabalha
  async function atualizar() {
    const n = nova();
    if (!n || tela.atualizando) return '';
    tela.mensagemDe = n.versao;
    tela.acao = null;
    tela.copiado = '';
    tela.abriu = false;
    if (typeof atualizador === 'function') {
      tela.atualizando = true;
      // progresso: o texto da etapa ("Baixando…") repinta a linha enquanto o atualizador trabalha
      const progresso = t => { if (typeof t === 'string' && t && tela.atualizando) { tela.mensagem = t; tela.mensagemDe = n.versao; avisar(); } };
      avisar();
      try { aplicar(await atualizador({ versao: n.versao, tag: n.tag, repo }, { fase, progresso })); }
      catch (e) { aplicar('Não foi possível atualizar agora: tente de novo mais tarde.'); console.error('[lol-client] atualizar', e); }
      finally { tela.atualizando = false; tela.mensagemDe = n.versao; }
    } else aplicar(`Para atualizar, baixe a versão ${n.versao} em ${enderecoReleases(repo)}.`);
    avisar();
    return tela.mensagem;
  }

  // "recarregar agora" (depois de atualizado): só por clique e só em None/Lobby (CLAUDE.md); fase desconhecida = lê agora (GET)
  async function recarregar() {
    let f = fase;
    try { const lida = await lerFase(); if (typeof lida === 'string') f = lida; } catch { /* fica a do socket */ }
    if (!FASES_CONSULTA.includes(f)) {
      tela.mensagem = TEXTO_RECARREGAR_FORA;
      avisar();
      return false;
    }
    recarregarPagina();
    return true;
  }

  // "copiar link": o endereço da página da versão na área de transferência
  async function copiarLink() {
    const link = acao()?.link;
    if (!link) return false;
    let ok = false;
    try { ok = !!(await copiar(link)); } catch { ok = false; }
    tela.copiado = ok ? 'ok' : 'falhou';
    tela.abriu = false;
    avisar();
    return ok;
  }

  // "abrir página": só com o evento do clique DELE (isTrusted === true; sem evento, sintético ou chamada pelo console = nada) e
  // só com o endereço da página de releases do REPO. Nunca em carga, consulta, laço ou virada de fase: ninguém além do botão
  // chama isto. O null do window.open não é erro (P0-a): a dica de reserva aparece sempre depois do clique
  function abrirPagina(ev) {
    if (ev?.isTrusted !== true) return false;
    const url = linkAbrivel(acao()?.link, repo);
    if (!url) return false;
    abrir(url);
    tela.abriu = true;
    tela.copiado = '';
    avisar();
    return true;
  }

  return { estado, consultar, procurar: () => consultar('procurar agora', true), aoFase, sincronizar, iniciar, atualizar, recarregar, copiarLink, abrirPagina,
    alternarNotas: () => { tela.notas = !tela.notas; avisar(); return tela.notas; },
    registrarAtualizador: fn => { atualizador = typeof fn === 'function' ? fn : null; avisar(); },
    parar: () => { cancelar(laco); laco = null; },
    aoMudar: fn => (ouvintes.add(fn), () => ouvintes.delete(fn)) };
}

// ---- instância do plugin (index.js chama iniciarAtualizacao). Antes dela (e nos testes que só importam módulos): sem cfg, a
// chave conta como desligada e nada consulta sozinho. Os ouvintes moram aqui para sobreviver à troca da instância ----
const ouvintesAtualizacao = new Set();
let verificador = criarVerificador({ ouvintes: ouvintesAtualizacao });

const marcarHtml = e => { try { globalThis.document?.documentElement?.classList?.toggle(CLASSE_NOVA, !!e?.aviso); } catch { /* sem DOM */ } };
ouvintesAtualizacao.add(marcarHtml);

export function iniciarAtualizacao(cfg, opcoes = {}) {
  verificador.parar();
  verificador = criarVerificador({ cfg, ouvintes: ouvintesAtualizacao, ...opcoes });
  verificador.iniciar().catch(() => {});
  return verificador;
}
export const aoFaseAtualizacao = fase => verificador.aoFase(fase);
export const sincronizarAtualizacao = cfg => verificador.sincronizar(cfg);
export const aoMudarAtualizacao = fn => (ouvintesAtualizacao.add(fn), () => ouvintesAtualizacao.delete(fn));
export const estadoAtualizacao = () => verificador.estado();
export const procurarAtualizacao = () => verificador.procurar();
// P3: o botão "atualizar" chama fn({versao, tag, repo}) -> texto para a linha (ou nada)
export const registrarAtualizador = fn => verificador.registrarAtualizador(fn);

// ---- telas: a linha do topo das Configurações e o bloco "Atualizações" (configuracoes.js; DOM do document global) ----
const el = (tag, classe, texto) => { const e = document.createElement(tag); if (classe) e.className = classe; if (texto !== undefined) e.textContent = texto; return e; };
const botao = (texto, classe, aoClicar) => { const b = el('lol-uikit-flat-button-secondary', classe, texto); b.addEventListener('click', aoClicar); return b; };
const quando = ms => { try { return new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

// linha "Versão x.y.z disponível" (só com a chave ligada e versão nova vista) -> nó ou null
export function linhaVersaoNova(ui, v = verificador) {
  const e = v.estado();
  if (!e.aviso) return null;
  const linha = el('div', 'lol-settings-general-row lc-versao-linha');
  linha.dataset.a = 'versao-nova';
  linha.append(el('p', 'lc-versao-titulo', `Versão ${e.aviso.versao} disponível (instalada: ${e.versao}).`));
  const acoes = el('div', 'lc-versao-acoes');
  // "atualizar" some enquanto o atualizador trabalha e depois de atualizado (aí fica "recarregar agora")
  if (e.acao?.recarregar) acoes.append(botao('recarregar agora', 'lc-versao-recarregar', () => { v.recarregar(); }));
  else if (!e.atualizando) acoes.append(botao('atualizar', 'lc-versao-atualizar', () => { v.atualizar(); }));
  acoes.append(botao(e.notas ? 'esconder o que mudou' : 'o que mudou', 'lc-versao-notas-bt', () => { v.alternarNotas(); }));
  linha.append(acoes);
  // corpo do release: só texto (textContent); nunca innerHTML
  if (e.notas) linha.append(el('div', 'lc-versao-notas', e.aviso.corpo.trim() || 'Sem notas nesta versão.'));
  const explica = t => (ui?.explica ? ui.explica(t) : el('p', 'lc-explica', t));
  if (e.mensagem) linha.append(explica(e.mensagem));
  // sem o complemento (e na troca incompleta): o endereço da página da versão como texto selecionável, "abrir página" (só com
  // endereço da página de releases do REPO; abre no navegador padrão, P0-a) e "copiar link" de reserva
  if (e.acao?.link) {
    const end = explica(e.acao.link);
    end.classList?.add('lc-versao-link');
    const botoes = el('div', 'lc-versao-acoes');
    if (e.abrivel) botoes.append(botao('abrir página', 'lc-versao-abrir', ev => { v.abrirPagina(ev); }));
    botoes.append(botao('copiar link', 'lc-versao-copiar', () => { v.copiarLink(); }));
    linha.append(end, botoes);
    if (e.abriu) linha.append(explica(TEXTO_ABRINDO));
    if (e.copiado) linha.append(explica(e.copiado === 'ok' ? 'Link copiado.' : 'Não foi possível copiar: selecione o endereço acima.'));
  }
  return linha;
}

const TEXTO_RESULTADO = { procurando: 'Procurando…', nenhuma: 'Nenhuma versão nova.', falhou: 'Não foi possível consultar agora: tente mais tarde.' };

// bloco "Atualizações": a chave, a versão instalada, a última consulta e "procurar agora"
export const blocoAtualizacao = (corpo, { cfg, definir, ui }, v = verificador) => {
  const e = v.estado();
  corpo.append(ui.caixa('atualizacao.verificar', 'Procurar versão nova uma vez por dia',
    'Ligado (padrão): uma consulta por dia ao GitHub, só com o client na tela inicial ou no lobby. Versão nova aparece no topo destas configurações e com um ponto na engrenagem do client compacto; nada é baixado sem o seu clique.',
    !!cfg.atualizacao?.verificar, x => definir('atualizacao.verificar', x)));
  const okEm = Number(e.salvo?.okEm) || 0;
  corpo.append(ui.explica(`Versão instalada: ${e.versao}.${okEm ? ` Última consulta: ${quando(okEm)}.` : ''}`));
  const res = e.resultado === 'nova' && e.nova ? `Versão ${e.nova.versao} disponível.` : TEXTO_RESULTADO[e.resultado] || '';
  if (res) corpo.append(ui.explica(res));
  // some só durante o clique dele ("Procurando…"); com a automática em voo fica (o clique espera ela, sem 2º fetch): o fim da
  // automática sem novidade não repinta, e um botão escondido nela não voltaria
  if (e.resultado !== 'procurando') corpo.append(ui.linha(botao('procurar agora', 'lc-versao-procurar', () => { v.procurar(); })));
};
