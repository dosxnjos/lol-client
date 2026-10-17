// Replay da partida (baixar e assistir) no pós-jogo: tela compacta (compacto/tela-posjogo.js) e painel grande (posjogo/index.js).
// Pedido do Gabriel (15/10/2026 ~03:40): "quero o botão de baixar/assistir replay no pós-jogo".
// Rotas e corpos do front da Riot (rcp-fe-lol-shared-components 16.20, ReplayButton, lido no assets.wad em 15/10/2026 com
// tools/ler-wad.py; nada enviado ao client real por teste):
// - metadata: GET /lol-replays/v1/metadata/{gameId} -> {gameId, state, downloadProgress}; 404 ("Try using the POST metadata create
//   endpoint first", medido) até alguém criar: POST /lol-replays/v2/metadata/{gameId}/create {gameVersion, gameType, queueId[, gameEnd]}
//   (o botão da Riot cria ao aparecer; no fim de partida ela manda gameVersion "unknown_version" e o gameflow.queue.type/id).
// - estados (_updateButton): checking, found, download, downloading, retryDownload, watch, incompatible, missingOrExpired, lost,
//   error, unsupported. Medido em 15/10: "watch" (downloadProgress 100) e "download" (downloadProgress com lixo: só 0–100 vale).
// - disponibilidade: GET /lol-replays/v1/configuration {isReplaysEnabled, isReplaysForEndOfGameEnabled,
//   isReplaysForMatchHistoryEnabled, isPatching, isPlayingGame, isPlayingReplay, isInTournament} (medido).
// - baixar: POST /lol-replays/v1/rofls/{gameId}/download/graceful (fim de partida) ou .../download (histórico), corpo
//   {componentType}; assistir: POST /lol-replays/v1/rofls/{gameId}/watch {componentType}.
// Só por clique dele (isTrusted): nada baixa nem abre sozinho; o create também só sai do clique em "baixar". Assistir abre o jogo
// e a Riot minimiza o client (LeagueClient.log de 15/10: "Ux state set to MinimizeAll", a fase segue EndOfGame, e no fim do
// replay "ShowMain"): 1 clique abre, com um aviso curto (pedido de 15/10/2026 ~12:45: "se eu clicar para assistir o replay, é
// porque eu já cliquei antes para baixar [...] iniciar o replay de primeira"; antes eram 2 cliques em 8 s). Clique de reflexo
// logo depois de abrir não manda o watch de novo (REPLAY.reflexoMs). A janela não é mexida aqui:
// quem devolve o tamanho compacto depois do ShowMain é o roteador (compacto/index.js, "a janela voltou a 1280 sozinha").
// Textos: docs/TEXTOS-DA-INTERFACE.md. Importável no node (tools/teste-replay.mjs): nada de DOM no topo.
import { h, lcu as lcuPadrao, icone } from './compacto/comum.js';

export const COMPONENTE = { fim: 'replay-button_end-of-game', historico: 'replay-button_match-history' };
export const REPLAY = { cadaMs: 2000, reflexoMs: 4000 };
const MOTIVOS = {
  incompatible: 'replay de outra versão do jogo: não abre nesta',
  missingOrExpired: 'o replay desta partida não existe ou expirou',
  lost: 'o replay se perdeu no servidor da Riot',
  error: 'erro no replay (a Riot não informou o motivo)',
  unsupported: 'esta partida não tem replay',
};

export const rotas = gid => {
  const g = encodeURIComponent(String(gid));
  return { metadata: `/lol-replays/v1/metadata/${g}`, criar: `/lol-replays/v2/metadata/${g}/create`, configuracao: '/lol-replays/v1/configuration',
    baixar: fim => `/lol-replays/v1/rofls/${g}/download${fim ? '/graceful' : ''}`, assistir: `/lol-replays/v1/rofls/${g}/watch` };
};

// corpo do create, igual ao build() da Riot: gameVersion (ou "unknown_version"), gameType, queueId e gameEnd = criação + duração
// quando as duas vierem > 0. Sem gameType ou queueId a Riot recusa (lança) -> null (botão cinza com motivo)
export function corpoCriar({ gameVersion, gameType, queueId, gameCreation = 0, gameDuration = 0 } = {}) {
  if (!gameType || !(Number(queueId) >= 0) || queueId === null || queueId === '') return null;
  const c = { gameVersion: gameVersion ? String(gameVersion) : 'unknown_version', gameType: String(gameType), queueId: Number(queueId) };
  if (Number(gameCreation) > 0 && Number(gameDuration) > 0) c.gameEnd = Number(gameCreation) + Number(gameDuration);
  return c;
}

// por que o assistir não pode agora (a ordem da Riot: atualizando > partida > replay > torneio) | ''
export function motivoAssistir(cfg) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  if (c.isPatching) return 'o client está atualizando';
  if (c.isPlayingGame) return 'tem uma partida rodando';
  if (c.isPlayingReplay) return 'já tem um replay aberto';
  if (c.isInTournament) return 'em torneio a Riot não deixa abrir replay';
  return '';
}

// {gid, meta: {ok, status, json}, cfg: {ok, status, json} | null, fim} -> o que a linha do replay mostra:
// {estado, texto, baixar: {mostra, ok, rotulo, motivo}, assistir: {mostra, ok, rotulo, motivo}}
export function modeloReplay({ gid, meta, cfg = null, fim = true, temCorpo = true }) {
  const nada = { mostra: false, ok: false, rotulo: '', motivo: '' };
  const cinza = (rotulo, motivo) => ({ mostra: true, ok: false, rotulo, motivo });
  const pode = (rotulo, motivo = '') => ({ mostra: true, ok: true, rotulo, motivo });
  const out = (estado, texto, baixar, assistir = nada) => ({ estado, texto, baixar, assistir });
  if (!(Number(gid) > 0)) return out('sem-partida', 'replay: esperando saber qual é a partida', cinza('baixar replay', 'partida ainda não identificada'));
  const c = cfg?.ok && cfg.json && typeof cfg.json === 'object' ? cfg.json : null;
  if (c && (c.isReplaysEnabled === false || (fim ? c.isReplaysForEndOfGameEnabled === false : c.isReplaysForMatchHistoryEnabled === false)))
    return out('desligado', 'replay desligado pela Riot', cinza('baixar replay', 'a Riot desligou o replay aqui'));
  if (!meta) return out('lendo', 'replay: conferindo…', cinza('baixar replay', 'conferindo o replay'));
  if (meta.status === 404) {
    // ninguém criou o registro do replay ainda (o botão da Riot cria ao aparecer): o clique em "baixar" cria e baixa
    if (!temCorpo) return out('sem-registro', 'replay: sem a fila da partida', cinza('baixar replay', 'sem a fila da partida: baixe pelo client normal'));
    if (c?.isPatching) return out('sem-registro', 'replay: o client está atualizando', cinza('baixar replay', 'o client está atualizando'));
    return out('sem-registro', 'replay desta partida', pode('baixar replay', 'registrar o replay na Riot e baixar'));
  }
  if (!meta.ok || !meta.json || typeof meta.json !== 'object') return out('falha', `replay: estado sem leitura (${meta.status})`, cinza('baixar replay', `o client não respondeu o replay (${meta.status})`));
  const st = String(meta.json.state || '');
  const pct = Number(meta.json.downloadProgress);
  const atualizando = !!c?.isPatching;
  switch (st) {
    case 'checking': case 'found': return out(st, 'replay: verificando…', cinza('baixar replay', 'a Riot está verificando o replay'));
    case 'download': return out(st, 'replay disponível', atualizando ? cinza('baixar replay', 'o client está atualizando') : pode('baixar replay', 'baixar o replay desta partida'));
    case 'retryDownload': return out(st, 'o download do replay falhou', atualizando ? cinza('baixar de novo', 'o client está atualizando') : pode('baixar de novo', 'tentar o download de novo'));
    case 'downloading': {
      const p = Number.isFinite(pct) && pct >= 0 && pct <= 100 ? ` ${Math.round(pct)}%` : '';
      return out(st, `baixando o replay…${p}`, cinza(`baixando…${p}`, 'baixando o replay'));
    }
    case 'watch': {
      const m = motivoAssistir(c);
      return out(st, 'replay baixado', nada, m ? cinza('assistir replay', m) : pode('assistir replay', 'abrir o jogo com o replay (o client minimiza e volta no fim)'));
    }
    default: {
      const m = MOTIVOS[st] || `estado do replay desconhecido (${st || 'vazio'})`;
      return out(st || 'desconhecido', `replay indisponível: ${m}`, cinza('baixar replay', m));
    }
  }
}

// baixar (clique dele): sem registro, cria antes; baixa só se o estado lido depois for download/retryDownload. A Riot fica em
// "checking" uns segundos depois do create (RemoteMetadataFetcher ~5 s no LeagueClient.log de 15/10): o mesmo clique espera até
// `tentativas` leituras de 1 s em vez de pedir um 2º clique. -> {ok, motivo, espera?}
export async function baixarReplay(lcu, { gid, fim = true, corpo = null, tentativas = 6, esperar = ms => new Promise(res => setTimeout(res, ms)) }) {
  const r = rotas(gid);
  let m = await lcu('GET', r.metadata);
  if (m.status === 404) {
    if (!corpo) return { ok: false, motivo: 'sem a fila da partida para registrar o replay' };
    const c = await lcu('POST', r.criar, corpo);
    if (!c.ok) return { ok: false, motivo: `a Riot não registrou o replay (${c.status})` };
    m = await lcu('GET', r.metadata);
  }
  const verificando = x => x.ok && ['checking', 'found'].includes(String(x.json?.state || ''));
  for (let i = 0; i < tentativas && verificando(m); i++) { await esperar(1000); m = await lcu('GET', r.metadata); }
  const st = m.ok ? String(m.json?.state || '') : '';
  if (st === 'checking' || st === 'found') return { ok: false, espera: true, motivo: 'a Riot ainda está verificando o replay: tente em alguns segundos' };
  if (st !== 'download' && st !== 'retryDownload') return { ok: false, motivo: m.ok ? (MOTIVOS[st] || `o replay está em "${st}"`) : `o client não respondeu o replay (${m.status})` };
  const b = await lcu('POST', r.baixar(fim), { componentType: fim ? COMPONENTE.fim : COMPONENTE.historico });
  return b.ok ? { ok: true } : { ok: false, motivo: `a Riot recusou o download (${b.status})` };
}

export async function assistirReplay(lcu, { gid, fim = true }) {
  const w = await lcu('POST', rotas(gid).assistir, { componentType: fim ? COMPONENTE.fim : COMPONENTE.historico });
  return w.ok ? { ok: true } : { ok: false, motivo: `a Riot não abriu o replay (${w.status})` };
}

// Linha do replay (status + baixar + assistir). Botões nascem uma vez e só mudam texto/disabled/title (ARMADILHAS: botão recriado
// engole o clique). amb: {doc, lcu, gameId(), fim(), corpo() -> dados do corpoCriar, avisar(msg, erro), vivo(), agora(),
// esperar(ms) (teste), classe}
// -> {el, ler(), pintar(), estado()}. Quem chama faz ler() no relógio (REPLAY.cadaMs) com a tela à vista.
export function criarReplay(amb) {
  const { doc } = amb;
  const lcu = amb.lcu || lcuPadrao;
  const vivo = () => (typeof amb.vivo === 'function' ? amb.vivo() : true);
  const avisar = (m, e) => { try { amb.avisar?.(m, e); } catch { /* segue */ } };
  const st = { meta: null, cfg: null, lendo: false, ocupado: false, lidoGid: null, abriuEm: 0 };
  const agora = () => (typeof amb.agora === 'function' ? amb.agora() : Date.now());
  const corpoAgora = () => corpoCriar(amb.corpo?.() || {});
  const pref = amb.classe || 'lc-rp';
  const texto = h('span', { doc, class: `${pref}-tx`, dataset: { a: 'replay-estado' } }, 'replay');
  const btB = h('button', { doc, class: `${pref}-bt`, dataset: { a: 'replay-baixar', acao: 'replay-baixar' } }, 'baixar replay');
  const btA = h('button', { doc, class: `${pref}-bt`, dataset: { a: 'replay-assistir', acao: 'replay-assistir' } }, 'assistir replay');
  const el = h('div', { doc, class: `${pref}`, dataset: { a: 'replay' } }, h('span', { doc, class: `${pref}-ic` }, icone('replay', { doc, tam: 14 })), texto, btB, btA);
  let modelo = null;

  const fim = () => (typeof amb.fim === 'function' ? !!amb.fim() : amb.fim !== false);
  function pintar() {
    if (!vivo()) return;
    const gid = amb.gameId?.();
    modelo = modeloReplay({ gid, meta: st.lidoGid === gid ? st.meta : null, cfg: st.cfg, fim: fim(), temCorpo: !!corpoAgora() });
    texto.textContent = modelo.texto;
    const um = (bt, m, rotulo) => {
      bt.hidden = !m.mostra;
      bt.style.display = m.mostra ? '' : 'none';
      bt.textContent = rotulo;
      bt.disabled = !m.ok || st.ocupado;
      bt.setAttribute('title', m.motivo || '');
    };
    um(btB, modelo.baixar, st.ocupado && modelo.baixar.mostra ? 'um instante…' : modelo.baixar.rotulo);
    um(btA, modelo.assistir, modelo.assistir.rotulo);
  }

  async function ler() {
    const gid = amb.gameId?.();
    if (st.lendo || !vivo() || !(Number(gid) > 0)) { pintar(); return; }
    st.lendo = true;
    try {
      const r = rotas(gid);
      const [m, c] = await Promise.all([lcu('GET', r.metadata), lcu('GET', r.configuracao)]);
      if (!vivo()) return;
      st.meta = { ok: m.ok, status: m.status, json: m.ok && m.json && typeof m.json === 'object' ? { state: m.json.state, downloadProgress: m.json.downloadProgress } : null };
      st.lidoGid = gid;
      if (c.ok) st.cfg = { ok: true, status: c.status, json: c.json };
    } finally { st.lendo = false; pintar(); }
  }

  // gesto dele: sem evento ou evento sintético não escreve (revisão de 16/10/2026: chamada sem evento passava; o deEle da lateral exige)
  async function baixar(e) {
    if (!e || e.isTrusted === false || st.ocupado) return;
    const gid = amb.gameId?.();
    if (!modelo?.baixar?.ok || !(Number(gid) > 0)) { if (modelo?.baixar?.motivo) avisar(`replay: ${modelo.baixar.motivo}`, true); return; }
    st.ocupado = true; pintar();
    let r;
    try { r = await baixarReplay(lcu, { gid, fim: fim(), corpo: corpoAgora(), ...(amb.esperar ? { esperar: amb.esperar } : {}) }); } catch (err) { r = { ok: false, motivo: err?.message || String(err) }; }
    finally { st.ocupado = false; }
    if (!vivo()) return;
    if (r.ok) avisar('baixando o replay');
    else avisar(`replay: ${r.motivo}`, !r.espera);
    await ler();
  }

  async function assistir(e) {
    if (!e || e.isTrusted === false || st.ocupado) return;
    const gid = amb.gameId?.();
    if (!modelo?.assistir?.ok || !(Number(gid) > 0)) { if (modelo?.assistir?.motivo) avisar(`replay: ${modelo.assistir.motivo}`, true); return; }
    // clique de reflexo logo depois de abrir: o jogo já está subindo, não manda o watch de novo
    if (st.abriuEm && agora() - st.abriuEm < REPLAY.reflexoMs) return;
    st.ocupado = true; pintar();
    let r;
    try { r = await assistirReplay(lcu, { gid, fim: fim() }); } catch (err) { r = { ok: false, motivo: err?.message || String(err) }; }
    finally { st.ocupado = false; }
    if (r.ok) st.abriuEm = agora();
    if (!vivo()) return;
    if (r.ok) avisar('abrindo o replay: o jogo vai abrir e o client volta quando ele fechar');
    else avisar(`replay: ${r.motivo}`, true);
    await ler();
  }

  btB.addEventListener('click', e => { baixar(e).catch(err => avisar(`replay: ${err?.message || err}`, true)); });
  btA.addEventListener('click', e => { assistir(e).catch(err => avisar(`replay: ${err?.message || err}`, true)); });
  pintar();
  return { el, ler, pintar, baixar, assistir, estado: () => ({ ...st, modelo }) };
}

export const CSS_REPLAY = `
.lc-rp { display:flex; align-items:center; gap:6px; min-width:0; font-size:11.5px; color:#a09b8c; }
.lc-rp-ic { flex:none; }
.lc-rp-tx { flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.lc-rp-bt { flex:none; height:24px; padding:0 10px; cursor:pointer; background:linear-gradient(180deg,#1e2328,#0f1317); border:1px solid #c8aa6e;
  color:#f0e6d2; font:inherit; font-size:11.5px; }
.lc-rp-bt:hover { filter:brightness(1.15); }
.lc-rp-bt[disabled] { border-color:#3c3c41; color:#6b6f76; cursor:not-allowed; filter:none; }
`;
