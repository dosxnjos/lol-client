// Testa pengu/sem-popups.js com XMLHttpRequest e fetch falsos (nada fala com o client): só GET das 2 rotas exatas
// recebe resposta falsa `false`; POST/PUT da mesma rota, rotas parecidas, a sessão do champ select (o coletor lê
// isAutofilled dela), missões, recompensas e settings passam intactos; chave do aviso ou geral desligada não
// falsifica; a config é lida na hora do send. uso: node tools/teste-sem-popups.mjs
import { ROTAS, caminho, rotaFalsa, embrulharXhr, embrulharFetch } from '../pengu/sem-popups.js';
import { relatar } from './lcu-falsa.mjs';

const RUNAS = '/lol-perks/v1/show-auto-modified-pages-notification';
const SMITE = '/lol-lobby-team-builder/champ-select/v1/has-auto-assigned-smite';
const SESSAO = '/lol-champ-select/v1/session';
const SESSAO_REAL = JSON.stringify({ localPlayerCellId: 0, myTeam: [{ cellId: 0, isAutofilled: true, assignedPosition: 'jungle' }] });
const cfg = { semPopups: { ligado: true, runasAutomaticas: true, smiteAutomatico: true } };
const tique = () => new Promise(r => setTimeout(r, 5));

// XHR falso no formato que o jsonRequest do client usa: open/send, readyState/status/responseText, on* + eventos
const enviados = [];
class XhrFalso extends EventTarget {
  constructor() { super(); this.readyState = 0; this.status = 0; this.responseText = ''; this.responseType = ''; this.eventos = []; }
  open(metodo, url) { this.metodo = metodo; this.url = url; this.readyState = 1; }
  send(corpo) {
    enviados.push(`${String(this.metodo).toUpperCase()} ${this.url}`);
    this.readyState = 4; this.status = 299;
    this.responseText = this.url === SESSAO ? SESSAO_REAL : 'real';
    setTimeout(() => this.dispatchEvent(new Event('load')), 0);
  }
  // como no navegador: dispatchEvent também chama o on<tipo>
  dispatchEvent(e) { this.eventos.push(e.type); const r = super.dispatchEvent(e); this['on' + e.type]?.call(this, e); return r; }
}
const embrulhou = embrulharXhr(XhrFalso, cfg);
const openEmbrulhado = XhrFalso.prototype.open;
const deNovo = embrulharXhr(XhrFalso, cfg);

async function pedir(metodo, url, antesDoSend) {
  const x = new XhrFalso();
  let onload = 0, ouvinteLoadend = 0, onrs = 0;
  x.onload = () => { onload++; };
  x.onreadystatechange = () => { onrs++; };
  x.addEventListener('loadend', () => { ouvinteLoadend++; });
  const antes = enviados.length;
  x.open(metodo, url, true);
  antesDoSend?.();
  x.send(metodo === 'GET' ? undefined : '{}');
  await tique();
  return { saiu: enviados.length > antes, status: x.status, texto: x.responseText, rs: x.readyState, onload, onrs, ouvinteLoadend,
    tipo: x.getResponseHeader?.('Content-Type') ?? null, eventos: x.eventos.join(',') };
}
const falso = r => !r.saiu && r.status === 200 && r.rs === 4 && JSON.parse(r.texto) === false;
const real = r => r.saiu && r.status === 299;

const xRunas = await pedir('GET', RUNAS);
const xSmite = await pedir('GET', SMITE);
const xAbs = await pedir('GET', 'https://127.0.0.1:62151' + RUNAS + '?skipCache=1');
const xMinusculo = await pedir('get', SMITE);
const xPostRunas = await pedir('POST', RUNAS);
const xPutAutofill = await pedir('PUT', '/lol-lobby/v1/autofill-displayed');
const xGetAutofill = await pedir('GET', '/lol-lobby/v1/autofill-displayed');
const xSessao = await pedir('GET', SESSAO);
const xOutras = await Promise.all(['/lol-missions/v1/missions', '/lol-rewards/v1/grants', '/lol-settings/v1/account/lol-tutorial',
  '/lol-summoner/v1/current-summoner/autofill', '/lol-perks/v1/pages', '/lol-challenges/v1/my-updated-challenges/0',
  RUNAS + '/extra', RUNAS + 'X', '/x' + SMITE].map(u => pedir('GET', u)));
cfg.semPopups.smiteAutomatico = false;
const xSmiteOff = await pedir('GET', SMITE);
const xRunasComSmiteOff = await pedir('GET', RUNAS);
cfg.semPopups.smiteAutomatico = true;
cfg.semPopups.ligado = false;
const xGeralOff = [await pedir('GET', RUNAS), await pedir('GET', SMITE)];
cfg.semPopups.ligado = true;
// config lida na hora do send: aberto ligado, desligado antes do send -> passa
const xNaHora = await pedir('GET', RUNAS, () => { cfg.semPopups.runasAutomaticas = false; });
cfg.semPopups.runasAutomaticas = true;

// ---- fetch ----
const chamadasFetch = [];
const fetchFalso = async (input, init) => { chamadasFetch.push(`${init?.method || input?.method || 'GET'} ${input?.url ?? input}`); return new Response('"real"', { status: 299 }); };
const f = embrulharFetch(fetchFalso, cfg);
const lerF = async (input, init) => { const antes = chamadasFetch.length; const r = await f(input, init); return { saiu: chamadasFetch.length > antes, status: r.status, corpo: await r.json() }; };
const fRunas = await lerF(RUNAS);
const fRequest = await lerF(new Request('https://127.0.0.1:62151' + SMITE));
const fPost = await lerF(RUNAS, { method: 'POST', body: '{}' });
const fSessao = await lerF(SESSAO);
cfg.semPopups.ligado = false;
const fOff = await lerF(SMITE);
cfg.semPopups.ligado = true;

relatar([
  ['só 2 rotas no mapa, as duas medidas no /help do 16.20', Object.keys(ROTAS).length === 2 && ROTAS[RUNAS] && ROTAS[SMITE]],
  ['autofill-displayed fora do mapa (rota sem consumidor no 16.20)', !Object.keys(ROTAS).some(r => r.includes('autofill'))],
  ['caminho(): absoluto, query e barra final', caminho('https://127.0.0.1:1/a/b/?x=1') === '/a/b' && caminho('/a/b') === '/a/b' && caminho('/') === '/'],
  ['rotaFalsa: só GET', rotaFalsa('GET', RUNAS, cfg)?.chave === 'runasAutomaticas' && rotaFalsa('POST', RUNAS, cfg) === null && rotaFalsa('PUT', SMITE, cfg) === null],
  ['embrulhar o XHR 2 vezes não embrulha de novo', embrulhou && deNovo && XhrFalso.prototype.open === openEmbrulhado],
  ['XHR GET runas -> false falso, nada sai', falso(xRunas), JSON.stringify(xRunas)],
  ['XHR GET smite -> false falso, nada sai', falso(xSmite), JSON.stringify(xSmite)],
  ['resposta falsa dispara readystatechange, load e loadend (on* e ouvintes)', xRunas.eventos === 'readystatechange,load,loadend'
    && xRunas.onload === 1 && xRunas.onrs === 1 && xRunas.ouvinteLoadend === 1 && xRunas.tipo === 'application/json', JSON.stringify(xRunas)],
  ['url absoluta com query na mesma rota -> falso', falso(xAbs), JSON.stringify(xAbs)],
  ['método em minúsculas (get) -> falso', falso(xMinusculo), JSON.stringify(xMinusculo)],
  ['POST da rota das runas (o "já vi" do client) passa', real(xPostRunas), JSON.stringify(xPostRunas)],
  ['autofill-displayed (GET e PUT) passa', real(xPutAutofill) && real(xGetAutofill)],
  ['sessão do champ select passa intacta (isAutofilled verdadeiro)', real(xSessao) && JSON.parse(xSessao.texto).myTeam[0].isAutofilled === true, JSON.stringify(xSessao)],
  ['missões, recompensas, settings, autofill do invocador, páginas, desafios e rotas parecidas passam', xOutras.every(real), JSON.stringify(xOutras.map(r => r.saiu))],
  ['chave do smite desligada: smite passa, runas seguem caladas', real(xSmiteOff) && falso(xRunasComSmiteOff)],
  ['chave geral desligada: as duas passam', xGeralOff.every(real)],
  ['config lida na hora do send', real(xNaHora), JSON.stringify(xNaHora)],
  ['fetch GET runas -> false sem chamar o fetch de verdade', !fRunas.saiu && fRunas.status === 200 && fRunas.corpo === false],
  ['fetch com Request (url absoluta) -> false', !fRequest.saiu && fRequest.corpo === false],
  ['fetch POST e sessão passam', fPost.saiu && fPost.corpo === 'real' && fSessao.saiu && fSessao.corpo === 'real'],
  ['fetch com a chave geral desligada passa', fOff.saiu && fOff.corpo === 'real'],
  ['embrulharFetch 2 vezes devolve o mesmo', embrulharFetch(f, cfg) === f],
]);
