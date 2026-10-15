// janelas do chat fora do client (tela 5 do client compacto; coletor/chat_janelas.py). Duas páginas no mesmo
// arquivo, pelo data-modo do <body>: "amigos" (lista) e "conversa" (uma por janela). Só fala com o coletor
// (/chat/api/*, mesma origem); a LCU e a credencial ficam com ele.
// Escrita só por ação do Gabriel: enviar (Enter ou botão) e convidar exigem evento de verdade (isTrusted); marcar
// como lida (PUT conversations/active [S] no coletor) só depois de um clique ou tecla de verdade NESTA janela, ou
// quando ela foi aberta por clique dele (sem ?auto=1). Janela aberta sozinha (?auto=1, mensagem nova) pode nascer
// com o foco (JanelasEdge.abrir admite) e não marca nada nem põe o cursor no campo até ele interagir: o que ele
// estava digitando em outro lugar não vira mensagem e a conversa não vira a ativa do client sem ele ver.
(() => {
  'use strict';
  const corpo = document.body;
  const MODO = corpo.dataset.modo;
  const K = corpo.dataset.k;
  const AUTO = new URLSearchParams(location.search).get('auto') === '1';
  const MARCA = ' · chat lol'; // fim do título: o coletor acha a janela por ele
  const DOT = { chat: '#3fbf77', jogo: '#58b3ff', fila: '#0ac8b9', away: '#e84057', mobile: '#a09b8c', off: '#5b5a56' };
  const raiz = document.getElementById('raiz');
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hora = ts => { const d = new Date(ts); return ts && !isNaN(d) ? d.toTimeString().slice(0, 5) : ''; };
  const inicial = n => (String(n || '?').trim()[0] || '?').toLocaleUpperCase('pt-BR');

  async function pedir(caminho, dados) {
    const post = dados !== undefined;
    try {
      const r = await fetch(caminho, {
        method: post ? 'POST' : 'GET', cache: 'no-store',
        headers: post ? { 'Content-Type': 'application/json' } : undefined,
        body: post ? JSON.stringify(dados) : undefined,
      });
      let j = null;
      try { j = await r.json(); } catch { /* sem corpo */ }
      return { status: r.status, j };
    } catch {
      return { status: 0, j: null };
    }
  }

  // – e ✕ da barra: o coletor minimiza/fecha a janela do Windows (window.close() não é confiável no modo app)
  async function janela(acao) {
    const r = await pedir(`/chat/${acao}/${MODO === 'amigos' ? 'amigos' : K}`, {});
    if (r.status === 0 && acao === 'fechar') window.close();
  }

  const jbar = (titulo, extra = '') => `<div class="jbar"><span class="tit" id="tit">${titulo}</span>${extra}` +
    '<span class="jb-acoes"><button class="w" data-acao="minimizar" title="minimizar">–</button>' +
    '<button class="x" data-acao="fechar" title="fechar esta janela">✕</button></span></div>';

  // ---------------- lista de amigos ----------------
  function amigos() {
    let dados = window.__chat || null, filtro = '', offAberto = false, aviso = '', avisoErro = false, avisoAte = 0;
    raiz.innerHTML = `<div class="amigos">${jbar('amigos')}` +
      '<div class="am-busca"><input id="busca" placeholder="buscar amigo" autocomplete="off" spellcheck="false"></div>' +
      '<div class="lista" id="lista"></div><div class="nota rodape" id="rodape"></div></div>';
    const lista = document.getElementById('lista'), rodape = document.getElementById('rodape');
    const tit = document.getElementById('tit');

    const botaoConvidar = a => {
      const c = a.convidar;
      if (!c || !c.mostra) return '';
      return `<button class="convidar${c.ok ? '' : ' off'}" data-acao="convidar" data-k="${esc(a.k)}" ` +
        `data-motivo="${esc(c.motivo || '')}" title="${esc(c.motivo || '')}">${esc(c.rotulo || 'convidar')}</button>`;
    };
    const linha = a => `<div class="amigo${a.aberta ? ' on' : ''}" data-acao="amigo" data-k="${esc(a.k)}">` +
      `<span class="av">${esc(inicial(a.nome))}<i style="background:${DOT[a.dot] || DOT.off}"></i></span>` +
      `<div class="nm">${esc(a.nome)}<small class="${esc(a.cls)}">${esc(a.txt)}</small></div>` +
      `<span class="dir">${botaoConvidar(a)}${a.un ? `<span class="un">${a.un > 99 ? '99+' : esc(a.un)}</span>` : ''}</span></div>`;

    function pintar() {
      const d = dados;
      if (!d || !d.ok) {
        tit.textContent = 'amigos';
        lista.innerHTML = `<div class="vazio nota">${esc(d ? d.motivo : 'carregando…')}</div>`;
      } else {
        tit.textContent = `amigos · ${d.online.length} online`;
        const f = filtro.trim().toLocaleLowerCase('pt-BR');
        const casa = a => !f || a.nome.toLocaleLowerCase('pt-BR').includes(f);
        let html = '';
        for (const g of d.grupos) {
          const doGrupo = d.online.filter(a => a.grupo === g);
          html += `<div class="grupo">${esc(g)} (${doGrupo.length})</div>` + doGrupo.filter(casa).map(linha).join('');
        }
        if (!d.online.length) html += '<div class="vazio nota">nenhum amigo online</div>';
        html += `<button class="grupo" data-acao="offline">offline (${d.offline.length})</button>`;
        html += offAberto || f ? d.offline.filter(casa).map(linha).join('') : '<div class="nota" style="padding:4px 10px">recolhido</div>';
        const topo = lista.scrollTop;
        lista.innerHTML = html;
        lista.scrollTop = topo;
      }
      const vale = aviso && Date.now() < avisoAte;
      rodape.textContent = vale ? aviso : 'janela do Windows, fora do client: pode ficar na 2ª tela.';
      rodape.classList.toggle('erro', !!(vale && avisoErro));
    }
    const avisar = (msg, erro = false) => { aviso = msg; avisoErro = erro; avisoAte = Date.now() + 6000; pintar(); };

    async function atualizar() {
      const r = await pedir('/chat/api/amigos');
      dados = r.status === 200 && r.j ? r.j : { ok: false, motivo: r.status === 0 ? 'coletor fora do ar' : 'erro ao ler os amigos' };
      pintar();
    }

    document.getElementById('busca').addEventListener('input', e => { filtro = e.target.value; pintar(); });
    raiz.addEventListener('click', async ev => {
      const el = ev.target.closest('[data-acao]');
      if (!el || !ev.isTrusted) return;
      const acao = el.dataset.acao;
      if (acao === 'minimizar' || acao === 'fechar') return janela(acao);
      if (acao === 'offline') { offAberto = !offAberto; return pintar(); }
      if (acao === 'convidar') {
        if (el.classList.contains('off')) return avisar(el.dataset.motivo || 'convite indisponível agora', true);
        el.classList.add('off');
        const r = await pedir(`/chat/convidar/${el.dataset.k}`, {});
        if (r.j && r.j.ok) avisar('convite enviado: quando ele aceitar, aparece no seu grupo');
        else avisar(`convite não saiu: ${(r.j && r.j.motivo) || 'coletor fora do ar'}`, true);
        return atualizar();
      }
      if (acao === 'amigo') {
        const r = await pedir(`/chat/abrir/${el.dataset.k}`, {});
        if (r.status === 0) avisar('coletor fora do ar', true);
        setTimeout(atualizar, 800);
      }
    });
    pintar();
    if (!dados) atualizar();
    setInterval(() => { if (!document.hidden) atualizar(); }, 3000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) atualizar(); });
  }

  // ---------------- conversa ----------------
  function conversa() {
    let dados = window.__chat || null, enviando = false, ultimaLida = 0;
    const erros = []; // envios recusados, mostrados no fim da conversa até o próximo envio
    raiz.innerHTML = jbar('') + '<div class="msgs" id="msgs"></div>' +
      '<div class="envio"><input id="msg" maxlength="500" autocomplete="off" spellcheck="true">' +
      '<button class="btn prim" id="enviar" title="enviar a mensagem">enviar</button></div>';
    const msgs = document.getElementById('msgs'), campo = document.getElementById('msg');
    const botao = document.getElementById('enviar'), tit = document.getElementById('tit');
    let assinatura = '';

    function pintar() {
      const d = dados;
      if (!d || !d.ok) {
        tit.textContent = 'conversa';
        msgs.innerHTML = `<div class="m sis">${esc(d ? d.motivo : 'carregando…')}</div>`;
        return;
      }
      tit.innerHTML = `${esc(d.nome)}${d.txt ? ` <span class="st">· ${esc(d.txt)}</span>` : ''}`;
      document.title = d.nome + MARCA;
      campo.placeholder = `mensagem para ${d.nome} (Enter envia)`;
      const html = (d.msgs.length ? d.msgs.map(m => m.sis
        ? `<div class="m sis">${esc(m.texto)}</div>`
        : `<div class="m${m.eu ? ' eu' : ''}">${esc(m.texto)}<small>${esc(hora(m.ts))}</small></div>`).join('')
        : '<div class="m sis">sem mensagens ainda</div>') + erros.map(e => `<div class="m erro">${esc(e)}</div>`).join('');
      if (html === assinatura) return;
      const noFim = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 40;
      msgs.innerHTML = html;
      assinatura = html;
      if (noFim || !msgs.dataset.pintou) msgs.scrollTop = msgs.scrollHeight;
      msgs.dataset.pintou = '1';
    }

    async function atualizar() {
      const r = await pedir(`/chat/api/conversa/${K}`);
      dados = r.status === 200 && r.j ? r.j : { ok: false, motivo: r.status === 0 ? 'coletor fora do ar' : 'erro ao ler a conversa' };
      pintar();
      lida();
    }

    // conversa à vista e com o foco: vira a ativa do client (zera as não lidas lá) — só com a janela focada por ele.
    // Um PUT por valor de não lidas: se a rota [S] não zerar o contador, não vira um PUT a cada 5 s.
    // Janela aberta sozinha: só depois de um clique/tecla de verdade nela (o foco sozinho pode ter vindo do Windows)
    let lidaPara = -1, interagiu = !AUTO;
    const marcarInteracao = ev => { if (ev.isTrusted && !interagiu) { interagiu = true; lida(); } };
    document.addEventListener('pointerdown', marcarInteracao, true);
    document.addEventListener('keydown', marcarInteracao, true);
    async function lida() {
      if (!interagiu || !dados || !dados.ok || !dados.naoLidas || !document.hasFocus() || Date.now() - ultimaLida < 5000) return;
      if (dados.naoLidas === lidaPara) return;
      ultimaLida = Date.now();
      lidaPara = dados.naoLidas;
      await pedir(`/chat/lida/${K}`, {});
    }

    async function enviar(ev) {
      if (!ev.isTrusted || enviando) return;
      const texto = campo.value.trim();
      if (!texto) return;
      enviando = true;
      botao.disabled = true;
      campo.readOnly = true;
      const r = await pedir(`/chat/enviar/${K}`, { texto });
      enviando = false;
      botao.disabled = false;
      campo.readOnly = false;
      erros.length = 0;
      if (r.j && r.j.ok) campo.value = '';
      else erros.push(`não enviou: ${(r.j && r.j.motivo) || 'coletor fora do ar'}`);
      await atualizar();
      campo.focus({ preventScroll: true });
    }

    botao.addEventListener('click', enviar);
    campo.addEventListener('keydown', ev => {
      if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); enviar(ev); }
    });
    raiz.addEventListener('click', ev => {
      const el = ev.target.closest('.jbar [data-acao]');
      if (el && ev.isTrusted) janela(el.dataset.acao);
    });
    window.addEventListener('focus', lida);
    pintar();
    if (!dados) atualizar();
    if (!AUTO) campo.focus({ preventScroll: true });
    let ultima = 0;
    setInterval(() => {
      const passo = document.hidden ? 5000 : 1500;
      if (Date.now() - ultima >= passo - 100) { ultima = Date.now(); atualizar(); }
    }, 500);
  }

  if (MODO === 'amigos') amigos();
  else if (MODO === 'conversa') conversa();
})();
