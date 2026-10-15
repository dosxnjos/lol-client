// Selo completo do champ select no painel da direita (roadmap/2026-10-13-client-compacto.md, passo 13, tela B2; paridade 11.d2).
// 📊 no topo da seleção (compacto/tela-champselect.js) abre/fecha; o campeão é o MEU em hover ou travado. Mesmos textos do selo do
// client normal (pengu/champselect.js: textoSelo, linhaMatchup, linhaTrauma, linhasDraft, adversarioDoDraft); nenhuma leitura
// nova: histórico pelo cache do champselect.js (servicos.champ.estatisticas) e o coletor (/draft/<id>) pelo lerCoach exportado,
// que roda mesmo com "Winrate com o campeão" desligado (decisão técnica iv do passo 13). Só GET.
// Inimigo: só campeão, e só com o pick dele travado (o coletor dá a rota provável; aqui ainda confere que o campeão está
// travado no theirTeam da sessão). Nome de jogador nunca. Importável no node: nada de DOM no topo.
import { h, fotoCampeao } from './comum.js';
import { textoSelo, linhaMatchup, linhaTrauma, linhasDraft, adversarioDoDraft, normalizarPosicao } from '../champselect.js';

const POS_PT = { TOP: 'Topo', JUNGLE: 'Selva', MIDDLE: 'Meio', BOTTOM: 'Atirador', UTILITY: 'Suporte' };
const FILA_PT = { 420: 'Solo/Duo', 440: 'Flex', 400: 'Normal' };
export const COACH_CADA_MS = 3000;

// meu campeão na sessão: travado (pick completed ou myTeam.championId), senão hover na ação, senão intenção
export function meuNaSessao(s) {
  if (!s || typeof s !== 'object') return null;
  const eu = (s.myTeam || []).find(c => c && c.cellId === s.localPlayerCellId);
  if (!eu) return null;
  const acao = (s.actions || []).flat().find(a => a && a.type === 'pick' && a.actorCellId === s.localPlayerCellId && Number(a.championId) > 0);
  const travado = !!(acao?.completed && Number(acao.championId) > 0) || Number(eu.championId) > 0;
  const id = Number(eu.championId) || Number(acao?.championId) || Number(eu.championPickIntent) || 0;
  return id ? { championId: id, posicao: normalizarPosicao(eu.assignedPosition), travado } : null;
}

// inimigos travados na sessão (theirTeam com championId > 0: a Riot só mostra depois do pick)
export const inimigosTravados = s => new Set((s?.theirTeam || []).map(c => Number(c?.championId) || 0).filter(id => id > 0));

// sessão + estatísticas + coach -> modelo do painel (puro). est = estatisticasCampeao(...) | null (histórico não lido);
// coach = {dados, campeao, fora}; nome(id) -> nome do campeão; traumas: chave "Mostrar traumas"; fila = id da fila
export function modeloSelo({ sessao, est = null, histN = 0, histErro = false, coach = null, nome = id => `campeão ${id}`, traumas = true, fila = null, temColetor = true }) {
  const eu = meuNaSessao(sessao);
  if (!eu) return { vazio: 'passa o mouse num campeão (ou trava) para ver o selo' };
  const m = { campeao: { id: eu.championId, nome: nome(eu.championId) }, travado: eu.travado, posicao: eu.posicao,
    sub: ['tu', POS_PT[eu.posicao], FILA_PT[fila]].filter(Boolean).join(' · '), linhas: [], amostra: '', rota: null, trauma: null, draft: null, fora: false };
  if (est) {
    const t = textoSelo(est, m.campeao.nome);
    m.linhas = t.linhas;
    m.amostra = histN ? `histórico: ${histN} partidas` : '';
  } else m.linhas = [histErro ? 'histórico indisponível agora (tento de novo)' : 'carregando histórico…'];
  const d = coach && coach.campeao === eu.championId ? coach.dados : null;
  if (d) {
    const adv = adversarioDoDraft(d.draft, eu.posicao);
    const travados = inimigosTravados(sessao);
    if (adv && travados.has(Number(adv.campeao))) {
      m.rota = { adv: { id: Number(adv.campeao), nome: nome(Number(adv.campeao)) }, texto: linhaMatchup(d.matchups, eu.championId, Number(adv.campeao), nome(Number(adv.campeao)), eu.posicao),
        rota: `rota provável pelo draft: ${String(POS_PT[eu.posicao] || eu.posicao || '?').toLowerCase()}` };
    }
    m.trauma = traumas ? linhaTrauma(d.traumas, nome) : null;
    const dl = linhasDraft(d.draft);
    if (dl.length) m.draft = { faixa: dl[0], termos: dl[1] || '', p: Number.isFinite(Number(d.draft?.p)) ? Math.min(Math.max(Number(d.draft.p), 0), 1) : null };
  } else if (temColetor && coach?.fora) m.fora = true;
  else if (!temColetor) m.fora = true;
  return m;
}

// painel. amb = {doc}. -> {el, pintar(modelo)}
export function criarCoachView({ doc }) {
  const el = h('div', { doc, class: 'lc-lt-coach', dataset: { a: 'lt-coach' } });
  let assinatura = '';
  function pintar(m) {
    const sig = JSON.stringify(m);
    if (sig === assinatura) return;
    assinatura = sig;
    if (!m || m.vazio) { el.replaceChildren(h('div', { doc, class: 'lc-lt-vazio' }, m?.vazio || 'lendo a seleção…')); return; }
    const cartao = h('div', { doc, class: 'lc-lt-cx' },
      h('div', { doc, class: 'lc-lt-sh' }, fotoCampeao(m.campeao.id, { tam: 40, nome: m.campeao.nome, doc }),
        h('div', { doc, class: 'lc-lt-shn' }, h('b', { doc }, m.campeao.nome), h('small', { doc }, m.sub)),
        h('span', { doc, class: 'lc-lt-tag' + (m.travado ? ' lc-lt-trav' : '') }, m.travado ? 'travado' : 'hover')),
      ...m.linhas.map(l => h('div', { doc, class: 'lc-lt-sl' }, l)),
      m.amostra ? h('div', { doc, class: 'lc-lt-sl lc-lt-mudo' }, m.amostra) : null);
    const rota = h('div', { doc, class: 'lc-lt-cx' }, h('div', { doc, class: 'lc-cp-rot' }, 'na tua rota'),
      m.rota ? h('div', { doc, class: 'lc-lt-mu' }, fotoCampeao(m.campeao.id, { tam: 28, doc }), h('span', { doc, class: 'lc-lt-mudo' }, '×'),
        fotoCampeao(m.rota.adv.id, { tam: 28, nome: m.rota.adv.nome, doc }), h('div', { doc }, h('div', { doc, class: 'lc-lt-az' }, m.rota.texto), h('small', { doc, class: 'lc-lt-mudo' }, m.rota.rota)))
        : h('div', { doc, class: 'lc-lt-sl lc-lt-mudo' }, m.fora ? 'coach: coletor fora do ar (sem matchup e draft)' : 'adversário da tua rota ainda não travou'),
      m.trauma ? h('div', { doc, class: 'lc-lt-sl lc-lt-trauma' }, m.trauma) : null);
    const draft = m.draft ? h('div', { doc, class: 'lc-lt-cx' }, h('div', { doc, class: 'lc-cp-rot' }, 'draft'),
      h('div', { doc, class: 'lc-lt-sl lc-lt-az' }, m.draft.faixa),
      m.draft.p !== null ? h('div', { doc, class: 'lc-lt-barra' }, h('i', { doc, style: { left: `${(m.draft.p * 100).toFixed(1)}%` } })) : null,
      m.draft.termos ? h('div', { doc, class: 'lc-lt-sl lc-lt-mudo' }, m.draft.termos) : null) : null;
    el.replaceChildren(...[cartao, rota, draft, h('div', { doc, class: 'lc-lt-nota' }, 'mesmas linhas do selo do client normal; só campeão, nunca nome.')].filter(Boolean));
  }
  return { el, pintar };
}

export const CSS_COACH = `
#lc-compacto .lc-lt-coach { flex:1; min-height:0; overflow:auto; padding:10px; display:flex; flex-direction:column; gap:8px; }
#lc-compacto .lc-lt-cx { border:1px solid var(--lc-linha); background:rgba(9,20,40,.55); padding:9px 10px; display:flex; flex-direction:column; gap:5px; }
#lc-compacto .lc-lt-sh { display:flex; gap:9px; align-items:center; }
#lc-compacto .lc-lt-shn { flex:1; min-width:0; display:flex; flex-direction:column; color:var(--lc-ouro2); }
#lc-compacto .lc-lt-shn small { color:var(--lc-mudo); font-size:11px; }
#lc-compacto .lc-lt-tag { font-size:10px; letter-spacing:.1em; text-transform:uppercase; padding:2px 6px; border:1px dashed var(--lc-ouro-esc); color:var(--lc-ouro); }
#lc-compacto .lc-lt-tag.lc-lt-trav { border-style:solid; border-color:#3fbf77; color:#7fe0a8; }
#lc-compacto .lc-lt-sl { font-size:12.5px; color:#e8e2d0; border-top:1px solid rgba(60,60,65,.5); padding-top:4px; }
#lc-compacto .lc-lt-mudo { color:var(--lc-mudo); font-size:11.5px; }
#lc-compacto .lc-lt-az { color:var(--lc-azul); }
#lc-compacto .lc-lt-trauma { color:#ffb3bd; }
#lc-compacto .lc-lt-mu { display:flex; gap:7px; align-items:center; font-size:12.5px; }
#lc-compacto .lc-lt-barra { position:relative; height:8px; border-radius:4px; background:linear-gradient(90deg,#8a2a38,#2a3440 50%,#1e6a7b); margin:4px 0; }
#lc-compacto .lc-lt-barra i { position:absolute; top:-3px; width:3px; height:14px; background:#f0e6d2; transform:translateX(-1px); }
#lc-compacto .lc-lt-nota { font-size:11px; color:var(--lc-mudo); padding:0 2px; }
`;
