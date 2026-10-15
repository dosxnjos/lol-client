// Runa certa por campeão e posição: ao travar o campeão no champ select, aplica a página da regra
// (1 candidata) ou abre um popup para escolher (2+). Regras em cfg.runas.regras:
// [{ championId, posicao: '*' | TOP | JUNGLE | MIDDLE | BOTTOM | UTILITY, paginas: [id da página] }].
// Importável no node (tools/teste-runas.mjs): nada de window/document no topo do módulo.
import { avisar as avisarComum, vigiarClasse } from './compacto/comum.js';

const norm = p => (p ? String(p).toUpperCase() : '');

// regra que vale: a da posição atribuída se ainda tem página viva (GET /lol-perks/v1/pages), senão a '*'.
// -> { candidatas: ids vivos da regra que valeu, apagadas: ids que sumiram das regras consultadas }
export function consultarRunas(regras, championId, posicao, paginas) {
  const vivas = new Set((paginas || []).map(p => p.id));
  const doCampeao = (regras || []).filter(r => r.championId === championId);
  const pos = norm(posicao);
  const ordem = [...new Set([pos && doCampeao.find(x => norm(x.posicao) === pos), doCampeao.find(x => x.posicao === '*')])].filter(Boolean);
  const apagadas = [];
  for (const r of ordem) {
    const ids = [...new Set(r.paginas || [])];
    apagadas.push(...ids.filter(id => !vivas.has(id)));
    const candidatas = ids.filter(id => vivas.has(id));
    if (candidatas.length) return { candidatas, apagadas };
  }
  return { candidatas: [], apagadas };
}

export const escolherRunas = (regras, championId, posicao, paginas) => consultarRunas(regras, championId, posicao, paginas).candidatas;

// a página atual pertence à regra de outro campeão? -> championId dele (ou null)
export function donoDaPagina(regras, paginaId, championId) {
  if (!paginaId) return null;
  const r = (regras || []).find(x => x.championId !== championId && (x.paginas || []).includes(paginaId));
  return r ? r.championId : null;
}

// ---- no client ----

const lcu = async (metodo, url, corpo) => {
  const r = await fetch(url, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const texto = await r.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { json = texto; }
  return { ok: r.ok, status: r.status, json };
};
// aviso: dentro da camada compacta quando ela está à vista (o Toast pode ficar embaixo dela), senão o Toast do Pengu
// (compacto/comum.js avisar; plano do compacto, passo 11 b3)
const avisar = (msg, erro) => avisarComum(msg, erro);

let nomes = null, estilos = null;
const carregarNomes = async () => {
  if (!nomes) {
    const r = await lcu('GET', '/lol-game-data/assets/v1/champion-summary.json');
    // ids ≥ 10000 são variantes de modo com o mesmo nome (60103 = Jade_Ahri, medido 13/10/2026)
    nomes = r.ok ? Object.fromEntries(r.json.filter(c => c.id > 0 && c.id < 10000).map(c => [c.id, c.name])) : {};
  }
  return nomes;
};
const nomeEstilo = async id => {
  if (!estilos) {
    const r = await lcu('GET', '/lol-perks/v1/styles');
    estilos = r.ok ? Object.fromEntries(r.json.map(s => [s.id, s.name])) : {};
  }
  return estilos[id] || '';
};

export const campeoes = async () => Object.entries(await carregarNomes()).map(([id, nome]) => ({ id: Number(id), nome }));
export const paginasEditaveis = async () => {
  const r = await lcu('GET', '/lol-perks/v1/pages');
  return r.ok ? r.json.filter(p => p.isEditable) : [];
};

const CLASSE_COMPACTO = 'lc-modo-compacto';
const compactoAVista = () => !!globalThis.document?.documentElement?.classList?.contains?.(CLASSE_COMPACTO);
// "manter a atual (Esc)" é escolha dele; fecharPopup() de fora (tela 3 do compacto, runas desligadas, fim da seleção) não
let aoDispensar = null;
const aoTecla = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); dispensar(); } };
function dispensar() { const f = aoDispensar; fecharPopup(); try { f?.(); } catch { /* segue */ } }
function fecharPopup() {
  document.getElementById('lc-runas')?.remove();
  document.removeEventListener('keydown', aoTecla, true);
  aoDispensar = null;
}

// popup sobre o champ select: um botão por página (nome + estilos), clique aplica e fecha.
// Só a caixa recebe clique (o resto do champ select segue usável); fecha com Esc.
// vivo(): a seleção ainda é a mesma depois dos awaits (sem ela, não abre nada); dispensado(): "manter a atual" ou Esc
async function popup(nomeCampeao, paginas, aplicar, vivo, dispensado = null) {
  const estilos = await Promise.all(paginas.map(async p => [await nomeEstilo(p.primaryStyleId), await nomeEstilo(p.subStyleId)].filter(Boolean).join(' + ')));
  if (!vivo()) return null;
  fecharPopup();
  aoDispensar = dispensado;
  const el = document.createElement('div');
  el.id = 'lc-runas';
  const caixa = document.createElement('div');
  caixa.className = 'lc-runas-caixa';
  const h = document.createElement('div');
  h.className = 'lc-runas-titulo';
  h.textContent = `Runas de ${nomeCampeao}`;
  const sub = document.createElement('div');
  sub.className = 'lc-runas-sub';
  sub.textContent = 'Escolha a página para esta partida';
  caixa.append(h, sub);
  paginas.forEach((p, i) => {
    const b = document.createElement('button');
    b.className = 'lc-runas-pagina';
    b.dataset.id = p.id;
    const nome = document.createElement('span');
    nome.className = 'lc-runas-nome';
    nome.textContent = p.name;
    const est = document.createElement('span');
    est.className = 'lc-runas-estilos';
    est.textContent = estilos[i];
    b.append(nome, est);
    b.addEventListener('click', () => { fecharPopup(); aplicar(p); });
    caixa.append(b);
  });
  const fechar = document.createElement('button');
  fechar.className = 'lc-runas-fechar';
  fechar.textContent = 'manter a atual (Esc)';
  fechar.addEventListener('click', dispensar);
  caixa.append(fechar);
  el.append(caixa);
  document.body.appendChild(el);
  document.addEventListener('keydown', aoTecla, true);
  return el;
}

export function iniciarRunas(context, cfg) {
  let tratado = 0; // championId já tratado nesta seleção (troca e destroca tratam de novo)
  const apagadasAvisadas = new Set(); // página apagada: avisa uma vez por sessão do client

  const aplicar = async p => {
    const r = await lcu('PUT', '/lol-perks/v1/currentpage', p.id); // corpo: o id puro (int32)
    // com a camada compacta à vista o ✓ da tela 3 já confirma: o aviso sairia em dobro (passo 11, decisão ii)
    if (r.ok) { if (compactoAVista()) console.log('[lol-client] runas:', `runa ${p.name} aplicada`); else avisar(`runa ${p.name} aplicada`); }
    else avisar(`não foi possível aplicar a runa ${p.name} (${r.status})`, true);
    return r.ok;
  };

  // escolha de 2+ páginas pendente (plano do compacto, passo 11 b4): travou com a camada compacta à vista (a escolha é da
  // tela 3) ou com o popup aberto, e ainda não escolheu. Se a camada sair (⤢ expandir, regra 7) antes da escolha, o popup
  // aparece no client normal; escolher (popup ou tela 3), "manter a atual" ou o fim da seleção encerram.
  let pendente = null, vigia = null;
  const limparPendente = () => { pendente = null; vigia?.parar(); vigia = null; };
  const marcarPendente = p => { pendente = p; vigia ||= vigiarClasse(CLASSE_COMPACTO, () => retomar().catch(e => console.error('[lol-client] runas', e))); };
  async function retomar() {
    const p = pendente;
    if (!p || compactoAVista()) return;
    if (!p.vivo()) { limparPendente(); return; }
    const atual = await lcu('GET', '/lol-perks/v1/currentpage').catch(() => null);
    if (pendente !== p || !p.vivo() || compactoAVista()) return;
    // a página atual já é uma das candidatas: escolheu na tela 3 (ou já era a dele): nada a perguntar
    if (atual?.ok && p.ids.includes(atual.json?.id)) { limparPendente(); return; }
    if (document.getElementById('lc-runas')) return;
    await aoTravar(p.championId, p.posicao, p.vivo, { piscar: false }); // ele mesmo expandiu: já está olhando o client
  }

  // chamado ao travar o campeão; exportado para teste (window.__lolClient.runas.aoTravar).
  // vivo(): falso se a seleção acabou durante os awaits (Delete ou fase nova): aí não aplica nem abre nada
  // piscar: ux-show/ux-flash junto do popup (o travar pode ter sido com o client atrás de outra janela)
  async function aoTravar(championId, posicao, vivo = () => true, { piscar = true } = {}) {
    if (!cfg.runas.ligado || !championId) { limparPendente(); return { acao: 'nada', motivo: 'desligado' }; }
    const regras = cfg.runas.regras;
    const paginas = await paginasEditaveis();
    const nomes = await carregarNomes();
    if (!vivo()) return { acao: 'nada', motivo: 'seleção acabou' };
    const consulta = consultarRunas(regras, championId, posicao, paginas);
    const candidatas = consulta.candidatas;
    const apagadas = consulta.apagadas.filter(id => !apagadasAvisadas.has(id));
    if (apagadas.length) {
      apagadas.forEach(id => apagadasAvisadas.add(id));
      avisar(`${apagadas.length === 1 ? 'uma página' : apagadas.length + ' páginas'} da regra de ${nomes[championId] || championId} não ${apagadas.length === 1 ? 'existe' : 'existem'} mais no client: ajuste nas configurações do lol-client`, true);
    }
    const porId = Object.fromEntries(paginas.map(p => [p.id, p]));
    // 1 página ou sem regra (as regras mudaram no meio da seleção): não há escolha pendente; sem limpar, cada saída da
    // camada repetiria o PUT e o aviso (achado 6 da revisão do passo 11)
    if (candidatas.length === 1) {
      limparPendente();
      await aplicar(porId[candidatas[0]]);
      return { acao: 'aplicou', id: candidatas[0] };
    }
    if (candidatas.length > 1) {
      marcarPendente({ championId, posicao, ids: candidatas, vivo });
      // client compacto à vista (html.lc-modo-compacto): a escolha é da tela 3 (compacto/tela-champselect.js); o popup
      // nasceria escondido, roubaria o Esc da busca e piscaria a janela (ux-show/ux-flash) à toa
      if (compactoAVista()) return { acao: 'compacto', ids: candidatas };
      const escolher = p => { limparPendente(); return aplicar(p); };
      if (!await popup(nomes[championId] || `campeão ${championId}`, candidatas.map(id => porId[id]), escolher, vivo, limparPendente))
        return { acao: 'nada', motivo: 'seleção acabou' };
      if (piscar) {
        lcu('POST', '/riotclient/ux-show');
        lcu('POST', '/riotclient/ux-flash');
      }
      return { acao: 'popup', ids: candidatas };
    }
    // sem regra: avisa se a página atual é a de outro campeão (o erro que o Gabriel descreveu)
    limparPendente();
    const atual = await lcu('GET', '/lol-perks/v1/currentpage');
    const dono = atual.ok ? donoDaPagina(regras, atual.json?.id, championId) : null;
    if (dono && vivo()) avisar(`a runa atual é a de ${nomes[dono] || dono} (${atual.json.name})`, true);
    return { acao: dono ? 'avisou' : 'nada', dono };
  }

  let geracao = 0; // muda a cada fim de seleção: aoTravar em voo da seleção anterior desiste
  const encerrar = () => { geracao++; tratado = 0; limparPendente(); fecharPopup(); };

  context.socket.observe('/lol-champ-select/v1/session', msg => {
    const s = msg?.eventType === 'Delete' ? null : msg?.data;
    if (!s) return encerrar();
    const eu = s.myTeam?.find(c => c.cellId === s.localPlayerCellId);
    const travou = (s.actions || []).flat().find(a => a.type === 'pick' && a.completed && a.actorCellId === s.localPlayerCellId && a.championId);
    if (!travou) return;
    // troca de campeão depois de travar: myTeam[].championId muda e a ação de pick fica com o id antigo
    const championId = eu?.championId || travou.championId;
    if (championId === tratado) return;
    tratado = championId;
    const g = geracao;
    aoTravar(championId, eu?.assignedPosition, () => g === geracao && tratado === championId).catch(e => console.error('[lol-client] runas', e));
  });
  // rede de segurança: Delete da sessão perdido (dodge, socket reconectado) não deixa o popup sobre o client
  context.socket.observe('/lol-gameflow/v1/gameflow-phase', msg => { if (msg?.data && msg.data !== 'ChampSelect') encerrar(); });

  // escolheu(): a tela 3 do compacto avisa no clique numa página (antes do PUT terminar): um "⤢ expandir" logo depois
  // leria a página antiga e reabriria o popup de uma escolha já feita (achado 5 da revisão do passo 11)
  return { aoTravar, fecharPopup, escolheu: limparPendente };
}
