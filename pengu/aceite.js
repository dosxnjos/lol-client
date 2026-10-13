// Aceitar partida automático com contagem e botão "não aceitar".
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

// Liga o observador. cfg = objeto vivo do config.js (lê cfg.aceite a cada evento).
export function iniciarAceite(context, cfg) {
  let agendado = null, desligadoNestaVez = false, aceitando = false;
  const limpar = () => { clearTimeout(agendado); agendado = null; esconderOverlay(); };
  const aceitar = async () => {
    if (aceitando) return;
    aceitando = true;
    limpar();
    setTimeout(() => { aceitando = false; }, 3000);
    // confere de novo antes de aceitar: o Gabriel pode ter respondido na mão
    const atual = await fetch('/lol-matchmaking/v1/ready-check').then(r => (r.ok ? r.json() : null)).catch(() => null);
    if (atual?.state === 'InProgress' && atual.playerResponse === 'None' && !desligadoNestaVez && cfg.aceite.ligado)
      await fetch('/lol-matchmaking/v1/ready-check/accept', { method: 'POST' });
  };
  const avaliar = payload => {
    if (!payload || payload.state !== 'InProgress') desligadoNestaVez = false; // ready-check acabou: zera
    const d = decidir(payload, cfg.aceite);
    if (d.acao === 'parar' || desligadoNestaVez) return limpar();
    if (aceitando) return; // GET/POST do aceite em voo: não reagenda nem reabre o overlay
    if (d.acao === 'aceitar') return aceitar();
    if (agendado) return; // já contando; o próximo evento só atualiza se mudar a resposta
    agendado = setTimeout(aceitar, d.emS * 1000);
    mostrarOverlay({
      restanteS: d.emS,
      aoAceitar: aceitar,
      aoDesligar: () => { desligadoNestaVez = true; limpar(); },
    });
  };
  context.socket.observe('/lol-matchmaking/v1/ready-check', msg => avaliar(msg?.eventType === 'Delete' ? null : msg?.data));
  return { avaliar };
}
