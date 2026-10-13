// Aceitar partida automático com contagem e botão "não aceitar"; devolve o foco que o client rouba no
// ReadyCheck (criarFoco) e cala o loop pós-aceite (embrulharAudio).
// Importável no node (tools/teste-aceite.mjs): nada de window/document no topo do módulo.

// Decide o que fazer com um payload de /lol-matchmaking/v1/ready-check.
// cfg = { ligado, atrasoS, limiteS }. timer = segundos decorridos desde o início do ready-check (servidor).
// -> { acao: 'esperar', emS } | { acao: 'aceitar' } | { acao: 'parar', motivo }
export function decidir(payload, cfg) {
  if (!cfg?.ligado) return { acao: 'parar', motivo: 'desligado' };
  if (!payload || payload.state !== 'InProgress') return { acao: 'parar', motivo: 'sem ready-check' };
  if (payload.playerResponse === 'Accepted') return { acao: 'parar', motivo: 'aceitou' };
  if (payload.playerResponse === 'Declined') return { acao: 'parar', motivo: 'recusou' };
  if (payload.playerResponse !== 'None') return { acao: 'parar', motivo: 'resposta ' + payload.playerResponse };
  const alvo = Math.max(0, Math.min(cfg.atrasoS, (cfg.limiteS ?? 12) - 2));
  const emS = alvo - (Number(payload.timer) || 0);
  return emS <= 0 ? { acao: 'aceitar' } : { acao: 'esperar', emS };
}

// Overlay com contagem. Recebe callbacks (no teste, no-ops: o overlay sozinho não fala com a LCU).
export function mostrarOverlay({ restanteS, aoAceitar, aoDesligar }) {
  esconderOverlay();
  const el = document.createElement('div');
  el.id = 'lc-aceite';
  el.innerHTML = `<span>partida encontrada: aceito em</span><span class="lc-contagem"></span>
    <button class="lc-primario" data-a="aceitar">aceitar agora</button><button data-a="desligar">não aceitar</button>`;
  const cont = el.querySelector('.lc-contagem');
  const fim = Date.now() + restanteS * 1000;
  const tique = () => { cont.textContent = Math.max(0, Math.ceil((fim - Date.now()) / 1000)) + 's'; };
  tique();
  el._intervalo = setInterval(tique, 200);
  el.addEventListener('click', e => {
    const a = e.target.closest('button')?.dataset.a;
    if (a === 'aceitar') aoAceitar?.();
    if (a === 'desligar') aoDesligar?.();
  });
  document.body.appendChild(el);
  return el;
}

export function esconderOverlay() {
  const el = document.getElementById('lc-aceite');
  if (el) { clearInterval(el._intervalo); el.remove(); }
}

// ---- foco (plano voz/foco, passo 2) ----
// O foco no ReadyCheck é pedido pelo lado NATIVO (ux-state "ShowMain" sem chamada JS; window.riotInvoke não é
// gravável): não dá para impedir, só devolver. Com o aceite automático e trazerClient false: se a página não tinha
// foco antes da fase e ganhou junto com ela, POST /riotclient/ux-minimize (o Windows devolve a janela de antes).
// Resultado: um piscar, não "nunca ganhar foco". No ChampSelect o client volta (ux-show) se fomos nós que minimizamos.
// Estado do foco vem dos eventos focus/blur da página e de uma sonda de document.hasFocus() a cada 250 ms (com o
// foco no iframe do chat a janela de cima não recebe os eventos), registro próprio, não o texto do ux-state, cujo
// significado não está medido: "Quit" no lobby, "MinimizeAll" na partida.
export const FOCO = { antesMs: 1000, janelaMs: 2000, atrasoMs: 100, sondaMs: 250 };

export function criarFoco({ cfg, lcu, agora = Date.now, agendar = setTimeout, focoInicial = true, log = () => {} }) {
  let temFoco = focoInicial, focoGanhoEm = -Infinity;
  let armado = null; // {em}: ReadyCheck começou sem foco; o focus que chegar na janela é o roubo
  let minimizei = false, timer = null;
  let tratado = false; // este ReadyCheck já minimizou (evento de fase repetido não minimiza 2 vezes)
  const ativo = () => !!cfg.aceite?.ligado && !cfg.aceite?.trazerClient;
  const minimizar = motivo => {
    armado = null;
    if (tratado) return;
    tratado = true;
    minimizei = true;
    log(`foco: client pulou na frente (${motivo}), minimizando`);
    timer = agendar(() => { timer = null; lcu('POST', '/riotclient/ux-minimize'); }, FOCO.atrasoMs);
  };
  return {
    aoFoco() {
      const tinha = temFoco;
      temFoco = true;
      if (!tinha) focoGanhoEm = agora();
      if (armado && ativo() && agora() - armado.em <= FOCO.janelaMs) minimizar('focus depois da fase');
    },
    aoBlur() { temFoco = false; },
    // sonda periódica de document.hasFocus(): com o foco dentro do iframe do chat, sair para outro app (e o roubo
    // nativo, que devolve o foco ao iframe) não dispara blur/focus na janela de cima; só a sonda vê
    sondar(tem) {
      if (tem && !temFoco) this.aoFoco();
      else if (!tem && temFoco) this.aoBlur();
    },
    aoFase(fase) {
      if (fase === 'ReadyCheck') {
        armado = null;
        if (!ativo() || tratado) return;
        const t = agora();
        // o focus pode chegar até ~0,2 s antes do evento da fase (sonda de 13/10): ganho no último 1 s = roubo
        if (temFoco && focoGanhoEm >= t - FOCO.antesMs) return minimizar('focus junto da fase');
        if (!temFoco) armado = { em: t }; // espera o focus do pedido nativo
        return; // tinha foco antes: ele estava no client, nada a fazer
      }
      armado = null;
      tratado = false;
      if (fase === 'ChampSelect' && minimizei) {
        minimizei = false;
        log('foco: champ select, trazendo o client de volta');
        lcu('POST', '/riotclient/ux-show');
      } else if (fase === 'None' || fase === 'Lobby') minimizei = false; // saiu da fila: ele volta quando quiser
    },
    estado: () => ({ temFoco, armado: !!armado, minimizei, pendente: !!timer }),
  };
}

// ---- som (plano voz/foco, passo 2c) ----
// Embrulha createSound dos canais do rcp-fe-audio: o som da lista vira um Proxy cujo play() não toca quando
// deveCalar() diz (lido na hora do play: o componente do ready-check cria o som uma vez no init e o uikit
// guarda por url). Qualquer erro no embrulho devolve o som original. Por padrão só o loop pós-aceite.
// Sons do ready-check medidos em 13/10/2026 (rcp-fe-lol-navigation, patch 16.20): intro (sfx-notifications),
// ringmagic-countdown e ringmagic-accepted-loop (sfx-ui, isLoop).
export const SONS_MUDOS = ['sfx-readycheck-ringmagic-accepted-loop.ogg'];

export function somMudo(som, deveCalar) {
  return new Proxy(som, {
    get(alvo, chave) {
      if (chave === 'play') return (...a) => (deveCalar() ? Promise.resolve(null) : alvo.play(...a));
      const v = Reflect.get(alvo, chave);
      return typeof v === 'function' ? v.bind(alvo) : v;
    },
  });
}

const canaisEmbrulhados = new WeakSet(); // módulo inteiro: embrulhar de novo (postInit + whenReady) não duplica
const apisEmbrulhadas = new WeakSet();

export function embrulharAudio(api, deveCalar, sons = SONS_MUDOS) {
  const feitos = canaisEmbrulhados;
  const embrulharCanal = canal => {
    try {
      if (!canal || typeof canal !== 'object' || feitos.has(canal) || typeof canal.createSound !== 'function') return canal;
      const original = canal.createSound;
      canal.createSound = function (url, ...resto) {
        const som = original.call(this, url, ...resto);
        try {
          if (som && typeof url === 'string' && sons.some(s => url.endsWith(s))) return somMudo(som, deveCalar);
        } catch { /* cai no original */ }
        return som;
      };
      feitos.add(canal);
    } catch { /* canal congelado: fica o original */ }
    return canal;
  };
  if (!api || typeof api.getChannel !== 'function') return false;
  if (apisEmbrulhadas.has(api)) return true;
  const getChannel = api.getChannel;
  try {
    api.getChannel = function (...a) { return embrulharCanal(getChannel.apply(this, a)); };
    apisEmbrulhadas.add(api);
  } catch { /* api não gravável: embrulha só os canais que já existem */ }
  for (const nome of ['sfx-ui', 'sfx-notifications']) try { embrulharCanal(getChannel.call(api, nome)); } catch { /* sem o canal */ }
  return true;
}

// no <html> quando o popup nativo precisa aparecer apesar do esconderPopup (estilo.css); fora do config.js de propósito
export const CLASSE_POPUP_LIVRE = 'lc-aceite-manual';

const lcuSimples = (metodo, url) => fetch(url, { method: metodo }).catch(e => console.error('[lol-client] aceite', url, e));

// Liga o observador. cfg = objeto vivo do config.js (lê cfg.aceite a cada evento).
export function iniciarAceite(context, cfg) {
  const foco = criarFoco({ cfg, lcu: lcuSimples, focoInicial: typeof document !== 'undefined' && document.hasFocus?.() !== false,
    log: m => console.log('[lol-client]', m) });
  window.addEventListener('focus', () => foco.aoFoco());
  // foco indo para um iframe da página (chat) também dispara blur na janela: só conta se a página perdeu o foco
  window.addEventListener('blur', () => setTimeout(() => { if (!document.hasFocus()) foco.aoBlur(); }, 0));
  // os eventos acima não veem a ida e a volta do foco quando ele está no iframe do chat: a sonda cobre
  // (250 ms cabem na janela de 1 s antes e 2 s depois da fase)
  setInterval(() => { try { foco.sondar(document.hasFocus()); } catch { /* sem document */ } }, FOCO.sondaMs);
  context.socket.observe('/lol-gameflow/v1/gameflow-phase', msg => foco.aoFase(msg?.data));
  // som: o rcp-fe-audio pode já estar pronto ou ainda não; o embrulho é idempotente por canal
  const calar = () => !!cfg.aceite?.silenciarSom;
  let embrulhado = false;
  const comAudio = api => { if (!embrulhado) embrulhado = embrulharAudio(api, calar); };
  try { context.rcp?.postInit?.('rcp-fe-audio', comAudio); } catch (e) { console.error('[lol-client] som', e); }
  try { context.rcp?.whenReady?.('rcp-fe-audio')?.then?.(comAudio).catch?.(() => {}); } catch { /* sem whenReady */ }

  let agendado = null, desligadoNestaVez = false, aceitando = false;
  const limpar = () => { clearTimeout(agendado); agendado = null; esconderOverlay(); };
  // popup nativo escondido (esconderPopup) só enquanto o aceite desta vez vai mesmo sair: "não aceitar" ou accept
  // que não saiu devolvem o popup (senão não sobra botão no client e o ready check expira). Volta no fim do ready check.
  const popupLivre = livre => { try { document.documentElement.classList.toggle(CLASSE_POPUP_LIVRE, livre); } catch { /* sem DOM */ } };
  const aceitar = async () => {
    if (aceitando) return;
    aceitando = true;
    limpar();
    setTimeout(() => { aceitando = false; }, 3000);
    // confere de novo antes de aceitar: o Gabriel pode ter respondido na mão
    const atual = await fetch('/lol-matchmaking/v1/ready-check').then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (!atual || atual.state !== 'InProgress') return popupLivre(true); // leitura falhou: o popup decide
    if (atual.playerResponse !== 'None') return; // já respondeu na mão
    if (desligadoNestaVez || !cfg.aceite.ligado) return popupLivre(true);
    const r = await fetch('/lol-matchmaking/v1/ready-check/accept', { method: 'POST' }).catch(() => null);
    if (!r?.ok) {
      popupLivre(true);
      try { Toast.error('não consegui aceitar a partida: aceita no popup do client'); } catch { console.error('[lol-client] aceite falhou', r?.status); }
    }
  };
  const avaliar = payload => {
    if (!payload || payload.state !== 'InProgress') { desligadoNestaVez = false; popupLivre(false); } // ready-check acabou: zera
    const d = decidir(payload, cfg.aceite);
    if (d.acao === 'parar' || desligadoNestaVez) return limpar();
    if (aceitando) return; // GET/POST do aceite em voo: não reagenda nem reabre o overlay
    if (d.acao === 'aceitar') return aceitar();
    if (agendado) return; // já contando; o próximo evento só atualiza se mudar a resposta
    agendado = setTimeout(aceitar, d.emS * 1000);
    mostrarOverlay({
      restanteS: d.emS,
      aoAceitar: aceitar,
      aoDesligar: () => { desligadoNestaVez = true; limpar(); popupLivre(true); },
    });
  };
  context.socket.observe('/lol-matchmaking/v1/ready-check', msg => avaliar(msg?.eventType === 'Delete' ? null : msg?.data));
  return { avaliar, foco };
}
