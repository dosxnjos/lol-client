// Painel pós-jogo v2 (plano v2, passo 7): busca partida e linha do tempo na LCU, roda analise.js (spec:
// docs/INSIGHTS.md), as lições (licoes.js sobre licoes.md, o mesmo arquivo do coletor) e desenha 6 abas
// (abas.js). Do coletor (127.0.0.1:8765, opcional): contexto das lições, mentor e revisão do jungler.
import { analisar, trajeto, FORA_DAS_CONTAS } from './analise.js';
import { licoes as calcularLicoes } from './licoes.js';
import { ABAS, esc, htmlTopo, curvas, objetivosDaPartida, tendencia, sessaoDaPartida, htmlMentor, htmlVeredito, partesMentor,
  abaResumo, abaRota, abaMortes, abaObjetivos, abaTendencia, abaSessao } from './abas.js';
import regrasMd from './licoes.md?raw';
import { jogarDeNovo } from '../fila-rapida.js';
import { criarConfirmacao, cliqueComFreio, JANELA_MS } from '../freios.js';

const esperar = ms => new Promise(r => setTimeout(r, ms));
const json = async url => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); };

// partida + linha do tempo com retentativa (logo no EndOfGame a LCU ainda não tem)
// vivo(): false quando o painel foi fechado; para de tentar
async function buscarComRetentativa(gameId, aoEsperar, vivo = () => true) {
  for (const espera of [0, 5000, 10000, 20000, 40000]) {
    if (espera) { aoEsperar?.(espera); await esperar(espera); }
    if (!vivo()) throw new Error('painel fechado');
    try {
      return await Promise.all([json(`/lol-match-history/v1/games/${gameId}`), json(`/lol-match-history/v1/game-timelines/${gameId}`)]);
    } catch { /* tenta de novo */ }
  }
  throw new Error('a LCU ainda não tem esta partida');
}

let nomes = null;
async function carregarNomes() {
  if (!nomes) {
    try { nomes = Object.fromEntries((await json('/lol-game-data/assets/v1/champion-summary.json')).map(c => [c.id, c.name])); }
    catch { nomes = {}; }
  }
  return nomes;
}
const nome = id => nomes?.[id] || `campeão ${id}`;

// o endpoint ignora os índices e devolve o cache do client (20 ou 200 partidas, conforme o dia): ARMADILHAS.
// Acumula por gameId na sessão do plugin, para uma leitura de 20 não apagar a de 200 (como o selo do champ select)
// A leitura de 200 leva até 40 s: com prazo, o painel abre com o que já tem e repinta quando ela chega.
const cacheHist = new Map();
let histEmVoo = null;
const lerHistorico = () => (histEmVoo ||= json('/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=199')
  .then(d => { for (const g of d.games.games) cacheHist.set(g.gameId, g); return [...cacheHist.values()]; })
  .finally(() => { histEmVoo = null; }));
// prazoMs: devolve null se a leitura não terminou a tempo (ela segue e enche o cache)
const historico = (prazoMs = 0) => (prazoMs ? Promise.race([lerHistorico(), esperar(prazoMs).then(() => null)]) : lerHistorico());

export async function analisarPartida(gameId, { aoEsperar, vivo } = {}) {
  // histórico alimenta média de farm, lições (sessão), tendência e sessão: falha nele não derruba o painel
  // partida e linha do tempo ANTES do histórico: com uma leitura lenta de 200 partidas em voo o painel levou
  // ~50 s para abrir (13/10/2026; provável fila do match-history na LCU). Com cache, o histórico tem 1,5 s; sem, 8 s.
  const [eu] = await Promise.all([json('/lol-summoner/v1/current-summoner'), carregarNomes()]);
  const [partida, linha] = await buscarComRetentativa(gameId, aoEsperar, vivo);
  const lido = await historico(cacheHist.size ? 1500 : 8000).catch(() => null);
  const hist = lido || [...cacheHist.values()];
  const r = analisar(partida, linha, eu.puuid, hist);
  if (r.erro) return r;
  r.historicoIncompleto = !lido;
  const meu = partida.participants.find(p => p.participantId === r.participantId);
  r.esta = {
    gameId: partida.gameId, criacao: partida.gameCreation, duracao: partida.gameDuration, vitoria: r.vitoria,
    campeao: meu.championId, k: meu.stats.kills, d: meu.stats.deaths, a: meu.stats.assists, fila: partida.queueId,
  };
  r.trajeto = trajeto(linha, r.participantId);
  r.campeoes = Object.fromEntries(partida.participants.map(p => [p.participantId, p.championId]));
  r.curva = curvas(linha, r.participantId, r.adversario?.participantId);
  r.objetivos = objetivosDaPartida(partida, linha, r.time);
  r.stats = meu.stats;
  r.criacao = partida.gameCreation;
  r.historico = hist;
  r.tendencia = tendencia(meu.stats, partida.gameDuration, hist, partida.gameId, partida.gameCreation);
  r.sessao = sessaoDaPartida(hist, r.esta);
  return r;
}

// ---- análise em cache (roadmap/2026-10-14-posjogo-livre-e-mentor-enxuto.md, D3) ----
// A leitura da LCU não depende do painel: fechar (até no carregamento) não cancela, e reabrir mostra o resultado na
// hora. Só a fase de aceite/seleção/partida cancela (esquecerAnalises). Fica em memória só a última partida pedida.
let geracao = 0;
const analises = new Map(); // gameId -> { promessa, pronta, r, erro, esperaMs }
function obterAnalise(gameId) {
  const velha = analises.get(gameId);
  if (velha && !(velha.pronta && velha.erro)) return velha; // em voo ou pronta; com erro, tenta de novo
  const minha = geracao;
  const a = { pronta: false, r: null, erro: null, esperaMs: null };
  analises.clear();
  analises.set(gameId, a);
  a.promessa = analisarPartida(gameId, {
    vivo: () => minha === geracao,
    aoEsperar: ms => { a.esperaMs = ms; aoMudarAnalise(gameId); },
  }).then(r => { a.r = r; if (r?.erro) a.erro = r.erro; return r; },
    e => { a.erro = e?.message || String(e); return null; })
    .finally(() => { a.pronta = true; aoMudarAnalise(gameId); });
  return a;
}
function esquecerAnalises() { geracao++; analises.clear(); }

// lições do motor daqui (licoes.md, docs/INSIGHTS.md) sobre a análise em cache, as mesmas do painel sem coletor (montar
// e pintar 'licoes' com ctx null). Para a tela 4 do compacto quando o coletor está fora (plano do compacto, passo 11
// b5). -> {licoes: [{id, tipo, prioridade, texto}]} | null (sem gameId, análise com erro). Nunca lança.
export async function licoesLocais(gameId) {
  if (!(Number(gameId) > 0)) return null;
  try {
    const r = await obterAnalise(Number(gameId)).promessa;
    if (!r || r.erro) return null;
    return { licoes: calcularLicoes(regrasMd, r, r.historico, r.criacao, null, nomes).licoes };
  } catch { return null; }
}
const textoCarregando = a => (a?.esperaMs ? `processando a partida (nova tentativa em ${a.esperaMs / 1000} s)…` : 'analisando a partida…');
function aoMudarAnalise(gameId) {
  if (ultimaAberta?.gameId !== gameId) return;
  const t = document.getElementById('lc-posjogo')?.querySelector('.lc-carregando-texto');
  if (t) t.textContent = textoCarregando(analises.get(gameId));
  if (document.getElementById('lc-posjogo-reabrir')) mostrarReabrir(); // o botão troca "analisando" por "pronta"
}

// ---- painel ----

// abertura: cada abertura ganha um número; fechar() o invalida, e análise em voo não reabre o painel
let abertura = 0, painel = null;
const dentroDoPainel = el => { for (let n = el; n; n = n.parentNode) if (n.id === 'lc-posjogo' || n.id === 'lc-posjogo-reabrir') return true; return false; };
function remover() {
  document.getElementById('lc-posjogo')?.remove();
  window.removeEventListener('keydown', aoTecla, true);
  window.removeEventListener('pointerdown', aoClicarFora, true);
  painel = null;
}
function fechar() { abertura++; remover(); vigiarInteracao(false); }

// "reabrir análise" (Gabriel, 14/10/2026): fechar pelo ✕, Esc ou clique fora deixa um botão no topo do pós-jogo da
// Riot; some quando o painel abre de novo e nas fases em que o painel também fecha (aceite, seleção, partida).
// Com a análise ainda em voo ele diz "analisando a partida…"; pronta, "análise pronta" (nunca vista) ou "reabrir".
let ultimaAberta = null; // {gameId, fimDePartida, vista} da última abertura
export function esconderReabrir() { document.getElementById('lc-posjogo-reabrir')?.remove(); }
export function mostrarReabrir() {
  if (!ultimaAberta || !document.body) { esconderReabrir(); return null; }
  const { gameId, fimDePartida, vista } = ultimaAberta;
  const a = analises.get(gameId);
  const [texto, dica] = a && !a.pronta ? ['⏳ analisando a partida…', 'a análise segue aqui atrás; clica para ver o carregamento']
    : a?.erro ? ['📊 tentar a análise de novo', `a última tentativa falhou: ${a.erro}`]
    : vista ? ['📊 reabrir análise', 'abre de novo o painel do pós-jogo (mentor, lições, rota)']
      : ['📊 análise pronta', 'abre o painel do pós-jogo (mentor, lições, rota)'];
  let bt = document.getElementById('lc-posjogo-reabrir');
  if (!bt) {
    bt = document.createElement('button');
    bt.id = 'lc-posjogo-reabrir';
    bt.addEventListener('click', () => {
      esconderReabrir();
      abrirPainel(gameId, padrao.cfg, padrao.coletor, { fimDePartida }).catch(e => console.error('[lol-client] pós-jogo', e));
    });
    document.body.appendChild(bt);
  }
  bt.textContent = texto;
  bt.title = dica;
  return bt;
}
function fecharPeloUsuario() { fechar(); mostrarReabrir(); }
function aoTecla(e) { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); fecharPeloUsuario(); } }
// o painel não bloqueia o client (D1): o fundo não recebe clique, e um clique fora da caixa fecha o painel e segue
// para o client (o "jogar novamente" ou o chat da Riot reagem no mesmo clique)
function aoClicarFora(e) { if (!dentroDoPainel(e.target)) fecharPeloUsuario(); }

function moldura(conteudo) {
  esconderReabrir();
  remover();
  const el = document.createElement('div');
  el.id = 'lc-posjogo';
  el.innerHTML = conteudo;
  el.addEventListener('click', e => { if (e.target.closest?.('.lc-fechar')) fecharPeloUsuario(); });
  document.body.appendChild(el);
  window.addEventListener('keydown', aoTecla, true);
  window.addEventListener('pointerdown', aoClicarFora, true);
  return el;
}
const htmlCarregando = texto => `<div class="lc-carregando"><span class="lc-carregando-texto">${esc(texto)}</span>
  <button class="lc-fechar" title="fechar (Esc): a análise segue e o botão no topo reabre">✕</button>
  <div class="lc-nota">dá para fechar: a análise segue e o botão no topo reabre.</div></div>`;
const htmlErro = msg => `<div class="lc-carregando">pós-jogo: ${esc(msg)} <button class="lc-fechar" title="fechar (Esc)">✕</button></div>`;

// abertura automática (D4): enquanto carrega, só o botão do topo; se ele clicou ou digitou no client nesse meio
// tempo, o painel não cai por cima: o botão vira "análise pronta" e espera o clique dele
let interagiu = false;
const marcarInteracao = e => { if (!dentroDoPainel(e.target)) interagiu = true; };
function vigiarInteracao(sim) {
  window.removeEventListener('pointerdown', marcarInteracao, true);
  window.removeEventListener('keydown', marcarInteracao, true);
  interagiu = false; // sempre: um "mexeu" de uma abertura anterior não pode segurar a próxima (lido antes desta chamada)
  if (!sim) return;
  window.addEventListener('pointerdown', marcarInteracao, true);
  window.addEventListener('keydown', marcarInteracao, true);
}

// lições do motor (D7, docs/INSIGHTS.md § Resumo): recolhidas só com o veredito na faixa do topo; sem ele (mentor
// ainda sem resposta, "nada", pensando, desligado, erro, coletor fora) as lições são o resumo e ficam abertas.
// Abrir ou fechar na mão vale até o painel fechar (p.licoesAbertas !== null).
export const licoesAuto = p => !(p.mentor?.status === 'pronto' && partesMentor(p.mentor.texto).veredito);
const licoesAbertas = p => (p.licoesAbertas === null ? licoesAuto(p) : p.licoesAbertas);

// estado do painel aberto; as partes que chegam do coletor repintam só o seu pedaço
function pintar(p, partes) {
  const q = s => p.el.querySelector(s);
  const ctx = p.ctxEstado === 'ok' ? p.ctx : null;
  for (const parte of partes) {
    if (parte === 'licoes') {
      // com o coletor, as lições dele (mesmo licoes.md e mesmo motor, sobre o banco inteiro); sem ele, o motor
      // daqui com o histórico do client (que às vezes só tem 20 partidas: média de farm sem amostra)
      p.licoes = p.licoesColetor || calcularLicoes(regrasMd, p.r, p.r.historico, p.r.criacao, ctx, nomes).licoes;
      const sec = q('[data-painel="resumo"] .lc-res-esq');
      const novo = document.createElement('div');
      novo.innerHTML = abaResumo(p.r, p.licoes, p.licoesColetor ? 'coletor' : p.ctxEstado, { licoesAbertas: licoesAbertas(p) });
      sec?.replaceWith(novo.querySelector('.lc-res-esq'));
    } else if (parte === 'mentor') {
      // veredito do mentor na faixa do topo (D7); as lições do motor abrem sozinhas só quando não há mentor
      const v = q('[data-veredito]'), hv = htmlVeredito(p.mentor);
      if (v && hv !== p.vereditoHtml) { v.innerHTML = hv; v.hidden = !hv; p.vereditoHtml = hv; }
      const det = q('[data-licoes]');
      if (det && det.open !== licoesAbertas(p)) det.open = licoesAbertas(p);
      // repinta só se mudou (a leitura a cada 15 s não pode jogar a rolagem para o topo); conversa nova desce ao fim
      const m = q('[data-mentor]'), html = htmlMentor(p.mentor);
      const conv = p.mentor?.conversa || [];
      const chave = `${conv.length}:${conv[conv.length - 1]?.status}`;
      if (m && html !== p.mentorHtml) {
        const topo = m.scrollTop;
        m.innerHTML = html;
        m.scrollTop = p.mentorChave !== undefined && chave !== p.mentorChave && conv.length > 1 ? m.scrollHeight : topo;
        p.mentorHtml = html;
        if (p.mentor?.conversa) p.mentorChave = chave; // a 1ª leitura de verdade abre no topo
      }
      const pronto = p.mentor?.status === 'pronto';
      const f = q('[data-pergunta]');
      f?.classList.toggle('lc-desligado', !pronto);
      if (f) for (const c of f.elements) c.disabled = !pronto;
    } else if (parte === 'tendencia') {
      const sec = q('[data-painel="tendencia"]');
      if (sec) sec.innerHTML = abaTendencia(p.r, nome, ctx, p.ctxEstado, p.revisao, !!p.cfg.traumas?.ligado);
    } else if (parte === 'sessao') {
      const sec = q('[data-painel="sessao"]');
      if (sec) sec.innerHTML = abaSessao(p.r, nome, p.r.sessao, p.ranked, ctx, p.ctxEstado, new Date().getHours());
    }
  }
}

function trocarAba(p, aba) {
  if (!ABAS.some(([id]) => id === aba)) return false;
  p.aba = aba;
  for (const b of p.el.querySelectorAll('[data-aba]')) b.classList.toggle('lc-ativa', b.dataset.aba === aba);
  for (const s of p.el.querySelectorAll('[data-painel]')) s.hidden = s.dataset.painel !== aba;
  return true;
}

// contexto das lições (matchup, traumas, histórico): o coletor busca a partida na LCU se o backfill não gravou
async function cicloContexto(p) {
  const inicio = Date.now();
  while (p.vivo()) {
    const r = await p.coletor(`/contexto/${p.r.gameId}`, { prazoMs: 30000 });
    if (!p.vivo()) return;
    if (r.status === 200 && r.dados) {
      p.ctx = r.dados;
      p.ctxEstado = 'ok';
      const l = await p.coletor(`/licoes/${p.r.gameId}`, { prazoMs: 30000 });
      if (l.status === 200 && Array.isArray(l.dados?.licoes)) {
        p.licoesColetor = l.dados.licoes;
        // farm contra a média: a do banco (20 partidas com o campeão) vale mais que a do cache do client
        const m = l.dados.metricas || {};
        if (p.r.farm.media === null && m.farm_media !== null && m.farm_media !== undefined) {
          p.r.farm = { valor: m.farm_min, media: m.farm_media, n: m.farm_n, diferenca: m.farm_dif };
          const sec = p.el.querySelector('[data-painel="rota"]');
          if (sec) sec.innerHTML = abaRota(p.r, nome);
        }
      }
      break;
    }
    p.ctxEstado = r.status === 0 ? 'fora' : r.dados?.tentarDeNovoS ? 'esperando' : 'erro';
    pintar(p, ['licoes', 'tendencia', 'sessao']);
    if (p.ctxEstado === 'erro' || Date.now() - inicio > 300000) return;
    await esperar(r.status === 0 ? 15000 : (r.dados.tentarDeNovoS || 5) * 1000);
  }
  if (p.vivo()) pintar(p, ['licoes', 'tendencia', 'sessao']);
}

// mentor: lê o estado a cada 3 s enquanto pensa (5 s sem nada, 15 s pronto: o coletor pode gerar de novo)
async function cicloMentor(p) {
  while (p.vivo()) {
    const r = await p.coletor(`/mentor/${p.r.gameId}`, { prazoMs: 5000 });
    if (!p.vivo()) return;
    p.mentor = r.status === 200 && r.dados?.status ? r.dados : { status: r.status === 0 ? 'fora' : 'indisponivel' };
    pintar(p, ['mentor']);
    const pensando = p.mentor.status === 'pensando' || (p.mentor.conversa || []).some(c => c.status === 'pensando');
    await esperar(pensando ? 3000 : p.mentor.status === 'nada' ? 5000 : 15000);
  }
}

async function acaoMentor(p, caminho, corpo) {
  const aviso = p.el.querySelector('[data-mentor-aviso]');
  const r = await p.coletor(caminho, { metodo: 'POST', corpo, prazoMs: 8000 });
  if (aviso) aviso.textContent = r.status === 202 ? '' : r.status === 429 ? 'mentor ocupado com outra chamada: tenta de novo em alguns segundos.'
    : r.status === 0 ? 'coletor fora do ar.' : `não deu: ${r.dados?.erro || r.status}`;
  if (r.status === 202) {
    const m = await p.coletor(`/mentor/${p.r.gameId}`);
    if (m.status === 200 && p.vivo()) { p.mentor = m.dados; pintar(p, ['mentor']); }
  }
  return r.status;
}

// "jogar de novo e buscar": só o clique chama (fila-rapida.js jogarDeNovo). Freios (freios.js, os mesmos da fila
// rápida): com N derrotas seguidas na sessão (pausa < 2 h) ou de madrugada, o 1º clique só pede confirmação e o 2º,
// em até 8 s, busca. Sem o 2º clique nada acontece.
const avisarToast = (msg, erro) => { try { (erro ? Toast.error : Toast.success)(msg); } catch { console.log('[lol-client]', msg); } };
async function acaoJogarDeNovo(p, botao) {
  p.confirmacao ||= criarConfirmacao();
  // duplo clique de reflexo (2º clique em menos de 700 ms depois de armar): ignorado, a confirmação segue na tela
  if (botao.disabled || p.confirmacao.cedo()) return;
  const textoOriginal = 'jogar de novo e buscar';
  botao.disabled = true;
  botao.textContent = 'voltando ao lobby…';
  let r;
  try {
    r = await cliqueComFreio(p.confirmacao, confirmado => {
      // histórico que não carregou: a sequência é incerta (null) e o freio pede confirmação em vez de chutar 1
      const seq = p.r.vitoria ? 0 : (p.r.historicoIncompleto || !p.r.sessao ? null : p.r.sessao.seq);
      return jogarDeNovo(p.cfg, { derrotasSeguidas: seq, confirmado, queueIdEsperado: p.r.esta?.fila });
    });
  } catch (e) { r = { status: 'recusa', motivo: e?.message || String(e) }; }
  clearTimeout(p.timerFreio);
  botao.disabled = false;
  botao.classList.remove('lc-confirmar');
  botao.textContent = textoOriginal;
  botao.title = 'volta ao lobby da mesma fila e busca partida';
  if (r.status === 'confirmar') {
    botao.classList.add('lc-confirmar');
    botao.textContent = r.texto;
    botao.title = `clica de novo em até ${JANELA_MS / 1000} s para buscar`;
    p.timerFreio = setTimeout(() => { botao.classList.remove('lc-confirmar'); botao.textContent = textoOriginal; }, JANELA_MS + 50);
    return;
  }
  if (r.status === 'buscando') { avisarToast('de volta à fila'); fechar(); return; }
  if (r.status === 'grupo') { avisarToast(r.motivo); return; }
  avisarToast(`jogar de novo: ${r.motivo}`, true);
}

function ligarEventos(p) {
  p.el.addEventListener('click', e => {
    const aba = e.target.closest?.('[data-aba]');
    if (aba) return trocarAba(p, aba.dataset.aba);
    if (e.target.closest?.('[data-acao="mentor-gerar"]')) acaoMentor(p, `/mentor/${p.r.gameId}`, {});
    const jd = e.target.closest?.('[data-acao="jogar-de-novo"]');
    if (jd) acaoJogarDeNovo(p, jd);
  });
  p.el.addEventListener('submit', e => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const texto = input?.value.trim();
    if (!texto) return;
    acaoMentor(p, `/mentor/${p.r.gameId}/pergunta`, { pergunta: texto }).then(st => { if (st === 202) input.value = ''; });
  });
  // abrir/fechar as lições na mão: vale até o painel fechar. O toggle também dispara quando o código muda o `open`
  // (sempre para o valor automático): só conta como escolha dele o que diverge do automático
  p.el.addEventListener('toggle', e => {
    if (!e.target?.matches?.('[data-licoes]')) return;
    if (p.licoesAbertas !== null || e.target.open !== licoesAuto(p)) p.licoesAbertas = e.target.open;
  }, true);
}

// fimDePartida: painel aberto pelo EndOfGame (só ele tem o "jogar de novo": o do Ctrl+K pode ser de partida antiga)
function montar(r, cfg, coletor, vivo, fimDePartida = false) {
  const p = { r, cfg, coletor: coletor || (async () => ({ status: 0, dados: null })), temColetor: !!coletor, vivo, aba: 'resumo',
    ctx: null, ctxEstado: coletor ? 'carregando' : 'fora', mentor: null, revisao: null, ranked: null, licoesAbertas: null };
  p.licoes = calcularLicoes(regrasMd, r, r.historico, r.criacao, null, nomes).licoes;
  const html = {
    resumo: abaResumo(r, p.licoes, p.ctxEstado, { licoesAbertas: licoesAbertas(p) }),
    rota: abaRota(r, nome),
    mortes: abaMortes(r, nome),
    objetivos: abaObjetivos(r),
    tendencia: abaTendencia(r, nome, null, p.ctxEstado, null, !!cfg.traumas?.ligado),
    sessao: abaSessao(r, nome, r.sessao, null, null, p.ctxEstado, new Date().getHours()),
  };
  p.el = moldura(`<div class="lc-caixa lc-v2">${htmlTopo(r, nome, { jogarDeNovo: fimDePartida && !!cfg.filaRapida?.jogarDeNovo })}
    <div class="lc-paineis">${ABAS.map(([id]) => `<section class="lc-painel lc-painel-${id}" data-painel="${id}">${html[id]}</section>`).join('')}</div></div>`);
  trocarAba(p, 'resumo');
  ligarEventos(p);
  pintar(p, ['mentor']);
  return p;
}

// cfg e coletor do plugin (iniciarPosjogo); abrirPainel(id) do Ctrl+K e dos testes usa os mesmos
let padrao = { cfg: { traumas: { ligado: true } }, coletor: null };

// automatico: aberto pelo EndOfGame (ou pela camada compacta que caiu sozinha), não por clique dele. Carrega só com o
// botão do topo e, pronta a análise, abre se ele não mexeu no client nesse meio tempo (D4). Sem `automatico` (botão,
// Ctrl+K, "ver análise completa"): caixa de carregamento com ✕ na hora. Fechar no carregamento não cancela a análise.
export async function abrirPainel(gameId, cfg = padrao.cfg, coletor = padrao.coletor, { fimDePartida = false, automatico = false } = {}) {
  // 2º EndOfGame da mesma partida com o painel dela aberto: fica como está (o ++abertura abaixo mataria o `vivo` dele:
  // mentor, ranked e revisão parariam de pintar; e a saída "análise pronta" poria o botão ao lado do painel)
  if (automatico && painel?.r?.gameId === gameId && document.getElementById('lc-posjogo')) return painel.r;
  const minha = ++abertura;
  // 2º EndOfGame da mesma partida com a análise em voo: segue a espera que já existe (não apaga a caixa de carregamento
  // que ele abriu pelo botão nem zera o "ele mexeu" desta partida)
  const repetida = automatico && ultimaAberta?.gameId === gameId && analises.get(gameId)?.pronta === false;
  // painel com erro também reabre (a análise pode sair na 2ª); "vista" = o painel já apareceu para esta partida
  if (ultimaAberta?.gameId !== gameId) ultimaAberta = { gameId, fimDePartida, vista: false };
  else ultimaAberta.fimDePartida ||= fimDePartida;
  const ana = obterAnalise(gameId);
  // abertura automática com a análise JÁ pronta (camada compacta que cai no EndOfGame depois do pré-carregamento do
  // passo 11 b1: o "⤢ expandir" dele, a regra 7 de um modal da Riot): abrir na hora cobriria o que ele foi ver, sem a
  // janela do "mexeu" (D4). Fica o botão do topo ("análise pronta"). pronta aqui = sem erro (obterAnalise refaz com erro)
  if (automatico && ana.pronta) { vigiarInteracao(false); mostrarReabrir(); return ana.r; }
  if (!ana.pronta) {
    if (repetida) { if (!document.getElementById('lc-posjogo')) mostrarReabrir(); }
    else if (automatico) { remover(); vigiarInteracao(true); mostrarReabrir(); }
    else moldura(htmlCarregando(textoCarregando(ana)));
  } else vigiarInteracao(false);
  const r = await ana.promessa;
  const mexeu = automatico && interagiu;
  if (minha !== abertura) return r; // fechou ou outra abertura tomou a frente: nada abre sozinho
  vigiarInteracao(false);
  if (mexeu) { mostrarReabrir(); return r; } // ele estava clicando no client: a análise espera no botão
  // erro na abertura automática (LCU sem a partida depois de ~75 s, remake): nenhuma caixa sozinha por cima do client;
  // o botão do topo vira "tentar a análise de novo" (D4). Com a caixa de carregamento que ele abriu, o erro vai nela.
  if (automatico && (!r || r.erro) && !document.getElementById('lc-posjogo')) { mostrarReabrir(); return r; }
  if (!r || r.erro) { moldura(htmlErro(r?.erro || ana.erro || 'falhou')); return r; }
  {
    const vivo = () => minha === abertura && !!document.getElementById('lc-posjogo');
    ultimaAberta.vista = true;
    const p = montar(r, cfg, coletor, vivo, ultimaAberta.fimDePartida);
    painel = p;
    json('/lol-ranked/v1/current-ranked-stats').then(d => { p.ranked = d; if (vivo()) pintar(p, ['sessao']); }).catch(() => {});
    // histórico lento (200 partidas): o painel abriu com o cache; quando a leitura chega, refaz tendência e sessão
    if (r.historicoIncompleto) historico().then(h => {
      if (!vivo()) return;
      r.historico = h;
      r.historicoIncompleto = false; // o freio do "jogar de novo" passa a confiar na sequência
      r.tendencia = tendencia(r.stats, r.duracaoS, h, r.gameId, r.criacao);
      r.sessao = sessaoDaPartida(h, r.esta);
      pintar(p, ['licoes', 'tendencia', 'sessao']);
    }).catch(() => {});
    if (coletor) {
      cicloContexto(p);
      cicloMentor(p);
      coletor(`/revisao/${gameId}`).then(rv => { p.revisao = rv.status === 200 ? rv.dados : { status: rv.status }; if (vivo()) pintar(p, ['tendencia']); });
    } else pintar(p, ['licoes']);
    return r;
  }
}

// troca a aba do painel aberto (teste e prints): aba('rota') -> true
export const aba = id => (painel ? trocarAba(painel, id) : false);
export const estadoPainel = () => painel && { aba: painel.aba, ctxEstado: painel.ctxEstado, mentor: painel.mentor?.status, licoes: painel.licoes?.map(l => l.id), revisao: !!painel.revisao?.revisao };

// última partida do Rift no histórico (sem treino, personalizada nem remake: docs/INSIGHTS.md)
// A leitura do histórico leva até ~40 s: a caixa de carregamento aparece antes (com ✕), e nada abre se ele a fechou ou se a
// camada compacta voltou nesse meio tempo (o painel nasceria escondido embaixo dela; passo 11 b2, achado 2 da revisão).
export async function analisarUltima() {
  const minha = abertura;
  moldura(htmlCarregando('procurando a última partida…'));
  let hist = null;
  try { hist = await historico(); } catch (e) { console.error('[lol-client] pós-jogo: histórico', e); }
  if (minha !== abertura) return null; // fechou a caixa (✕, Esc, clique fora)
  if (compactoAVista()) { remover(); console.log('[lol-client] pós-jogo: a camada compacta voltou; a análise não abre por baixo dela'); return null; }
  if (!hist) { moldura(htmlErro('não consegui ler o histórico do client: tenta de novo pelo Ctrl+K')); return null; }
  const ultima = hist
    .filter(g => g.mapId === 11 && g.gameDuration >= 300 && !FORA_DAS_CONTAS.includes(g.queueId)).sort((a, b) => b.gameCreation - a.gameCreation)[0];
  if (!ultima) { moldura(htmlErro('nenhuma partida de Summoner\'s Rift no histórico')); return null; }
  return abrirPainel(ultima.gameId, padrao.cfg, padrao.coletor);
}

export { fechar as fecharPainel };

// Client compacto (roadmap/2026-10-13-client-compacto.md, passo 7): com a camada compacta à vista no EndOfGame o painel
// NÃO abre sozinho; abre pelo "ver análise completa" da tela 4 (compacto/tela-posjogo.js), que expande antes e chama o
// abrirPainel devolvido abaixo. A classe é a da camada à vista (lc-modo-compacto), nunca lc-compacto (só "chave ligada").
// O roteador observa a fase depois deste módulo (e depois da honra remonta a camada só no EndOfGame): espera um instante.
export const ESPERA_COMPACTO_MS = 400;
export const compactoAVista = () => !!globalThis.document?.documentElement?.classList?.contains('lc-modo-compacto');

// Camada compacta que cai DEPOIS da decisão (celebração de nível/maestria que chega depois dos 400 ms e a regra 7
// expande, erro da tela 4, ou o ⤢ expandir/Ctrl+Shift+M dele): o client normal segue "como hoje" (plano § Decisões),
// com o painel. Vigia a classe do <html> até a camada sair ou a fase mudar. Decisão (13/10/2026, revista em 14/10 no
// passo 11): com a análise ainda em voo, o expandir no EndOfGame abre o painel quando ela chega se ele não mexeu (D4);
// com ela já pronta (pré-carregada desde o EndOfGame, b1), fica o botão "análise pronta" no topo, sem cobrir o que ele
// foi ver. O "ver análise completa" e o Ctrl+K param a vigia antes de expandir (abrir/analisarAgora) e não duplicam.
// -> {parar()}. doc/MO injetáveis (teste).
export function vigiarSaidaDoCompacto({ aoSair, doc = globalThis.document, MO = globalThis.MutationObserver }) {
  if (typeof MO !== 'function' || !doc?.documentElement) return { parar() {} };
  let vivo = true;
  const obs = new MO(() => {
    if (!vivo || doc.documentElement.classList.contains('lc-modo-compacto')) return;
    vivo = false; obs.disconnect();
    try { aoSair(); } catch (e) { console.error('[lol-client] pós-jogo', e); }
  });
  obs.observe(doc.documentElement, { attributes: true, attributeFilter: ['class'] });
  return { parar() { if (vivo) { vivo = false; obs.disconnect(); } } };
}

// abre sozinho no fim da partida (gameId guardado enquanto a partida rolava)
export function iniciarPosjogo(context, cfg, coletor = null) {
  padrao = { cfg, coletor };
  let gameId = null, mapa = null, faseAtual = null, vigiaCompacto = null;
  context.socket.observe('/lol-gameflow/v1/session', msg => {
    const s = msg?.data;
    if (s?.gameData?.gameId) gameId = s.gameData.gameId;
    if (s?.map?.id) mapa = s.map.id;
  });
  context.socket.observe('/lol-gameflow/v1/gameflow-phase', async msg => {
    const fase = msg?.data;
    faseAtual = fase;
    if (vigiaCompacto && fase !== 'EndOfGame') { vigiaCompacto.parar(); vigiaCompacto = null; }
    // o painel (tela cheia) não pode cobrir o aceite nem a seleção: fecha e cancela análise em voo
    if (['ReadyCheck', 'ChampSelect', 'GameStart', 'InProgress'].includes(fase)) {
      fechar(); esconderReabrir(); ultimaAberta = null; vigiarInteracao(false); esquecerAnalises();
    }
    // novo ciclo: o id da partida anterior não vale mais (Lobby traz gameId 0)
    if (['None', 'Lobby', 'Matchmaking'].includes(fase)) gameId = null;
    if (fase !== 'EndOfGame' || !cfg.posjogo.ligado) return;
    if (mapa && mapa !== 11) return; // ARAM, Arena etc.: sem painel automático
    if (!gameId) gameId = (await json('/lol-end-of-game/v1/eog-stats-block').catch(() => null))?.gameId;
    if (!gameId) return;
    if (cfg.compacto?.ligado) {
      await esperar(ESPERA_COMPACTO_MS);
      if (faseAtual !== 'EndOfGame') return;
      if (compactoAVista()) {
        console.log('[lol-client] pós-jogo: tela compacta à vista; o painel abre no "ver análise completa"');
        const gid = gameId;
        // a análise começa já, como no client normal (plano do compacto, passo 11 b1): o "ver análise completa" abre na
        // hora em vez de esperar até ~75 s. Nada se desenha: aoMudarAnalise só pinta com ultimaAberta desta partida
        obterAnalise(gid);
        vigiaCompacto?.parar();
        vigiaCompacto = vigiarSaidaDoCompacto({ aoSair: () => {
          vigiaCompacto = null;
          if (faseAtual !== 'EndOfGame' || document.getElementById('lc-posjogo')) return;
          abrirPainel(gid, cfg, coletor, { fimDePartida: true, automatico: true }).catch(e => console.error('[lol-client] pós-jogo', e));
        } });
        return;
      }
    }
    abrirPainel(gameId, cfg, coletor, { fimDePartida: true, automatico: true }).catch(e => console.error('[lol-client] pós-jogo', e));
  });
  // abrirPainel(id, {fimDePartida}): o "ver análise completa" da tela compacta; já aberto na mesma partida = fica
  // A vigia da camada para antes: quem chama já expande (o 2º abrirPainel automático derrubaria este pela `abertura`)
  const pararVigia = () => { vigiaCompacto?.parar(); vigiaCompacto = null; };
  const abrir = (id, opcoes = {}) => {
    pararVigia();
    return painel?.r?.gameId === id && document.getElementById('lc-posjogo') ? Promise.resolve(painel.r) : abrirPainel(id, cfg, coletor, opcoes);
  };
  // Ctrl+K "analisar última partida" (passo 11 b2, achado 2 da revisão): no fim de partida do Rift, a partida que acabou
  // (o mesmo abrir do "ver análise completa", com o cache do b1 e o "jogar de novo"); fora dele, a última do histórico.
  // Para a vigia antes: o expandirAntes tira a camada e a vigia abriria um 2º painel, talvez de outra partida
  const analisarAgora = () => {
    pararVigia();
    return faseAtual === 'EndOfGame' && gameId && (!mapa || mapa === 11) ? abrir(gameId, { fimDePartida: true }) : analisarUltima();
  };
  // licoesLocais(id): as lições do motor daqui para a tela 4 do compacto sem o coletor (passo 11 b5); painel desligado
  // nas configurações = sem motor local, como no client normal
  const locais = id => (cfg.posjogo?.ligado === false ? Promise.resolve(null) : licoesLocais(id));
  return { aba, estado: estadoPainel, abrirPainel: abrir, licoesLocais: locais, analisarAgora };
}
