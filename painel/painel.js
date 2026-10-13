// painel da 2ª tela (plano v2, passo 10): consulta /estado a cada 1 s e redesenha os 4 blocos fixos
// (Tua rota · Ameaça · Teu padrão · Time e objetivos) + a faixa de 1 aviso. Sem build, sem rede externa.
// Dado de inimigo parado na fog chega com atual=false: aparece cinza com "visto há Xs", nunca como atual.
'use strict';

const $ = id => document.getElementById(id);
const ROTA_PT = { TOP: 'topo', JUNGLE: 'selva', MIDDLE: 'meio', BOTTOM: 'atirador', UTILITY: 'suporte' };
// ícones do aviso: os do AvisosBasicos (ao_vivo.py) e os do MotorAvisos (avisos.py, TIPOS[].icone)
const ICONES = {
  dragao: '🐉', anciao: '🐉', barao: '👁', arauto: '🛡', vastilarvas: '🪲', janela: '⚔',
  perigo: '⚠', olho: '👁', seta: '➜', interrogacao: '?', objetivo: '⚔', relogio: '⏱',
  caveira: '💀', espada: '⚔', moeda: '🪙', dica: '💡',
};
const NOMES_OBJ = { dragao: 'Dragão', anciao: 'Ancião', vastilarvas: 'Vastilarvas', arauto: 'Arauto', barao: 'Barão' };

const milhar = n => Math.round(n).toLocaleString('pt-BR');
const sinal = n => (n > 0 ? '+' : n < 0 ? '−' : '') + milhar(Math.abs(n));
const mil = n => n >= 1000 ? (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : milhar(n);
const ha = s => s === null || s === undefined ? '? (sem leitura ainda)' : s >= 60 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;

function el(tag, cls, texto) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (texto !== undefined && texto !== null) e.textContent = texto;
  return e;
}
const chip = (texto, cor = '') => el('span', `chip ${cor}`, texto);

function metrica(rotulo, valor, par, cor = 'neutro') {
  const m = el('div', 'metrica');
  m.append(el('span', 'rotulo', rotulo), el('span', `valor ${cor}`, valor), el('span', 'par', par));
  return m;
}

// ---------- blocos ----------

function desenharRota(e) {
  const r = e.rota, trio = $('rota-trio');
  trio.replaceChildren();
  $('b-rota').classList.remove('alerta', 'destaque');
  $('rota-rodape').className = 'rodape';
  if (!r) { $('rota-quem').textContent = ''; $('rota-rodape').textContent = 'sem jogador ativo'; return; }
  const eu = r.eu, adv = r.adv;
  $('rota-quem').textContent = `${eu.nome} ${ROTA_PT[eu.rota] || ''}` + (adv ? ` x ${adv.nome}` : '');
  if (e.fase === 'carregando') {
    const inimigo = (e.jogadores || []).find(j => adv && j.nome === adv.nome);
    trio.append(
      metrica('contra', adv ? adv.nome : '—', adv ? ROTA_PT[eu.rota] : 'sem adversário de rota'),
      metrica('feitiços dele', '', inimigo ? inimigo.feiticos.filter(Boolean).join(' · ') : '—'),
      metrica('runa dele', '', inimigo?.keystone || '—'));
    trio.querySelectorAll('.valor:empty').forEach(v => v.remove());
    trio.querySelectorAll('.par').forEach(p => p.classList.add('linha-grande'));
    $('rota-rodape').textContent = 'carregando: os números aparecem no início da partida';
    return;
  }
  if (!adv) {
    trio.append(metrica('itens', milhar(eu.ouroEstimado), 'ouro em itens'),
      metrica('farm', eu.cs, 'sem adversário'), metrica('nível', eu.nivel, ''));
    $('rota-rodape').textContent = `bolso ${milhar(r.bolso)}`;
    return;
  }
  // dado do adversário parado na fog: números em cinza (cor "velho") e o rodapé diz há quanto tempo
  const d = r.diff, c = r.cor, velho = !adv.atual;
  trio.append(
    metrica('ouro em itens', sinal(d.ouro), `${milhar(eu.ouroEstimado)} x ${milhar(adv.ouroEstimado)}`, c.ouro),
    metrica('farm', sinal(d.cs), `${eu.cs} x ${adv.cs}`, c.cs),
    metrica('nível', sinal(d.nivel), `${eu.nivel} x ${adv.nivel}`, c.nivel));
  const rod = [`bolso ${milhar(r.bolso)}`];
  if (velho) rod.unshift(`${adv.nome} visto há ${ha(adv.vistoHaS)}: dados dele parados`);
  $('rota-rodape').textContent = rod.join(' · ');
  $('rota-rodape').className = 'rodape' + (velho ? ' amarelo' : '');
  if (!velho && c.ouro === 'vermelho') $('b-rota').classList.add('alerta');
  if (!velho && c.ouro === 'verde') $('b-rota').classList.add('destaque');
}

function desenharAmeaca(e) {
  const chips = $('ameaca-chips');
  chips.replaceChildren();
  $('b-ameaca').classList.remove('alerta');
  if (e.fase === 'carregando') {
    const ob = e.objetivos || {}, comp = ob.composicao || {}, cb = e.composicao;
    // cb = sugestoes.bloco_carregamento (dano pela LCU + cura/controle); sem ele, a contagem do ao_vivo.
    // texto do bloco = "3 AD · 2 AP · cura 1 · controle 11": AD/AP no nome grande, o resto no título
    // (a linha fica livre para os chips caberem: 5 inimigos + as tags do adversário)
    const partes = cb ? cb.texto.split(' · ') : [`${comp.ad ?? 0} AD`, `${comp.ap ?? 0} AP`];
    $('ameaca-sub').textContent = ['composição inimiga', ...partes.slice(2)].join(' · ');
    $('ameaca-nome').textContent = partes.slice(0, 2).join(' · ');
    // com o bloco do carregamento o lembrete de build já está no rodapé de objetivos: aqui sairia repetido
    // e, longo (ITENS.md), empurrava o nome para fora do bloco
    $('ameaca-linha').textContent = !cb && ob.sugestaoItem ? `pensa em ${ob.sugestaoItem.texto}` : '';
    // tags do adversário de rota (Riot API, carregamento.py): no máximo 3, o resto é ruído
    const adv = (e.carregamento?.jogadores || []).find(j => j.lado === 'inimigo' && e.rota?.eu?.rota && j.rota === e.rota.eu.rota);
    for (const t of (adv?.tags || []).slice(0, 3)) chips.append(chip(`${adv.nome || ''} ${t.texto}`.trim(), t.sinal === '+' ? 'vermelho' : t.sinal === '-' ? 'verde' : ''));
    for (const j of (e.jogadores || []).filter(j => !j.aliado))
      chips.append(chip(`${j.nome} ${ROTA_PT[j.rota] || ''}`, j.dano === 'AP' ? 'azul' : j.dano === 'AD' ? 'vermelho' : ''));
    return;
  }
  const a = e.ameaca;
  if (!a) { $('ameaca-nome').textContent = '—'; $('ameaca-linha').textContent = ''; $('ameaca-sub').textContent = ''; return; }
  $('ameaca-sub').textContent = ROTA_PT[a.rota] || '';
  $('ameaca-nome').textContent = a.nome;
  $('ameaca-nome').className = 'nome-grande' + (a.morto ? ' velho' : '');
  $('ameaca-linha').textContent = `${a.k}/${a.d}/${a.a} · ${mil(a.ouroEstimado)} em itens`;
  chips.append(chip(`dano ${a.dano}`, a.dano === 'AP' ? 'azul' : a.dano === 'AD' ? 'vermelho' : ''));
  if (a.minhaRota) { chips.append(chip('tua rota: evita 1x1', 'vermelho')); $('b-ameaca').classList.add('alerta'); }
  if (a.morto) chips.append(chip(`morto: ${a.renascerS} s`, 'verde'));
  else if (!a.atual) chips.append(chip(`visto há ${ha(a.vistoHaS)}`, 'velho'));
  chips.append(chip(`nível ${a.nivel}${a.atual ? '' : '?'}`, a.atual ? '' : 'velho'));
  // jungler inimigo (jungler.py): distribuição honesta, nunca posição certa
  const jg = e.jungler;
  if (jg?.texto) chips.append(chip(jg.texto, jg.status === 'visto' ? 'vermelho' : jg.status === 'morto' ? 'verde' : 'velho'));
}

function desenharPadrao(e) {
  const p = e.padrao, car = e.carregamento;
  $('b-padrao').classList.remove('alerta', 'destaque');
  // tela de carregamento: a previsão em faixa (L4) com os termos que mais pesaram
  if (e.fase === 'carregando' && car?.partida !== false && car?.camada) {
    const prev = car.previsao;
    $('padrao-acao').textContent = prev ? `vitória: ${prev.faixa}` : 'lendo os 10 jogadores…';
    $('padrao-acao').className = 'acao';
    $('padrao-titulo').textContent = prev ? (prev.termos || []).slice(0, 2).map(t => t.texto).join(' · ') : '';
    $('padrao-hist').textContent = `carregamento ${car.camada}`;
    return;
  }
  if (!p) { $('padrao-acao').textContent = '—'; $('padrao-titulo').textContent = ''; $('padrao-hist').textContent = ''; return; }
  $('padrao-acao').textContent = p.detalhe;
  $('padrao-acao').className = `acao ${p.cor || ''}`;
  $('padrao-titulo').textContent = p.titulo;
  $('padrao-hist').textContent = p.historico ? `histórico: ${p.historico}` : '';
  if (p.cor === 'vermelho') $('b-padrao').classList.add('alerta');
}

function desenharObjetivos(e) {
  const ob = e.objetivos || {}, timers = $('obj-timers'), mortos = $('obj-mortos');
  timers.replaceChildren();
  mortos.replaceChildren();
  const ordem = [ob.anciao ? 'anciao' : 'dragao', 'vastilarvas', 'arauto', 'barao'].filter(k => ob[k]).slice(0, 3);
  for (const k of ordem) {
    const t = ob[k], div = el('div', 'timer' + (t.vivo ? ' vivo' : t.emS <= 60 ? ' logo' : ''));
    div.append(el('span', 'rotulo', NOMES_OBJ[k]), el('span', 'valor', t.vivo ? 'VIVO' : t.texto));
    timers.append(div);
  }
  const dr = ob.dragoes;
  let sub = '';
  if (dr) {
    sub = `dragões ${dr.nosso} x ${dr.deles}`;
    if (dr.alma) sub += ` · alma ${dr.alma.tipo} (${dr.alma.time})`;
    else if (dr.fenda) sub += ` · fenda ${dr.fenda}`;
  }
  $('obj-dragoes').textContent = sub;
  $('b-obj').classList.toggle('destaque', !!ob.janela);
  if (ob.janela) mortos.append(chip(`JANELA: ${ob.inimigosMortos.length} mortos`, 'verde'));
  for (const m of ob.inimigosMortos || []) mortos.append(chip(`${m.nome} ${m.renascerS} s`, 'verde'));
  for (const m of ob.aliadosMortos || []) mortos.append(chip(`${m.nome} ${m.renascerS} s`, 'vermelho'));
  // feitiços inimigos em recarga (feiticos.py: chat por OCR ou F9 + 1..5), os que voltam antes
  for (const f of (e.feiticos || []).slice(0, 3)) mortos.append(chip(f.texto, 'amarelo'));
  if (!mortos.childElementCount) mortos.append(chip('ninguém morto', 'velho'));
  // 60 s antes de um objetivo o rodapé vira o preparo (quem está morto, sumido); fora disso, o item
  const prep = (e.preparo || [])[0];
  $('obj-item').textContent = prep ? `preparo: ${prep.texto}`
    : ob.sugestaoItem ? `item: ${ob.sugestaoItem.texto} · ${ob.sugestaoItem.motivo}` : '';
}

function desenharAviso(e) {
  const a = e.aviso, box = $('aviso');
  if (!a) {
    box.className = 'aviso vazio';
    box.querySelector('.aviso-icone').textContent = '';
    box.querySelector('.aviso-texto').textContent = e.fase === 'carregando' ? 'carregando a partida' : 'sem aviso';
    return;
  }
  box.className = `aviso ${a.cor || 'azul'}`;
  box.querySelector('.aviso-icone').textContent = ICONES[a.icone] || '!';
  box.querySelector('.aviso-texto').textContent = a.texto;
}

function desenhar(e) {
  const sem = !e || !e.partida;
  $('espera').hidden = !sem;
  if (sem) return;
  $('relogio').textContent = e.fase === 'carregando' ? '00:00' : e.relogio;
  const fase = $('fase');
  fase.textContent = { carregando: 'carregando', fim: 'partida encerrada', jogo: '' }[e.fase] ?? '';
  fase.className = e.fase;
  const js = e.jogadores || [];
  const nos = js.filter(j => j.aliado).reduce((s, j) => s + j.k, 0);
  const eles = js.filter(j => !j.aliado).reduce((s, j) => s + j.k, 0);
  $('placar').textContent = e.fase === 'carregando' ? '' : `abates ${nos} x ${eles}`;
  for (const f of [desenharAviso, desenharRota, desenharAmeaca, desenharPadrao, desenharObjetivos]) {
    try { f(e); } catch (err) { console.error(f.name, err); }
  }
}

// ---------- laço ----------

let falhas = 0;
async function consultar() {
  try {
    const r = await fetch('/estado', { cache: 'no-store' });
    const e = await r.json();
    falhas = 0;
    $('conexao').textContent = '';
    $('conexao').className = '';
    desenhar(e);
  } catch {
    falhas += 1;
    if (falhas >= 3) {
      $('conexao').textContent = 'coletor fora do ar';
      $('conexao').className = 'erro';
      $('espera-sub').textContent = 'coletor fora do ar: o painel volta sozinho';
    }
  }
}

desenhar(window.__estado || { partida: false });
setInterval(consultar, 1000);
consultar();
