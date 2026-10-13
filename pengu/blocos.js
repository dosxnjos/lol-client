// Blocos "Champ select" e "Runas por campeão" na seção lol-client das Configurações (registrarBloco
// do configuracoes.js). O painel inteiro é remontado a cada mudança do cfg: o que é carregado da LCU
// (campeões, páginas) e o rascunho da regra nova ficam aqui no módulo, não no DOM.
import { campeoes, paginasEditaveis } from './runas.js';

const POSICOES = [['*', 'Qualquer posição'], ['TOP', 'Topo'], ['JUNGLE', 'Selva'], ['MIDDLE', 'Meio'], ['BOTTOM', 'Atirador'], ['UTILITY', 'Suporte']];
const clonar = o => JSON.parse(JSON.stringify(o));
const el = (tag, className, texto) => { const e = document.createElement(tag); if (className) e.className = className; if (texto !== undefined) e.textContent = texto; return e; };
const botao = (texto, classe, aoClicar) => {
  const b = el('lol-uikit-flat-button-secondary', classe, texto);
  b.addEventListener('click', aoClicar);
  return b;
};

export function blocoChampSelect(champ) {
  return (corpo, { cfg, definir, ui }) => {
    corpo.append(ui.caixa('champSelect.ligado', 'Winrate com o campeão', 'No champ select, mostra partidas, winrate e KDA com o campeão em hover ou escolhido, no geral e na tua posição; com o coletor ligado, também o teu histórico contra o adversário de rota provável, o trauma e a força do draft em faixa. Só os teus dados.',
      cfg.champSelect.ligado, v => definir('champSelect.ligado', v)));
    const e = champ?.estado?.();
    corpo.append(ui.explica(!e ? '' : e.carregando && !e.partidas ? 'Lendo o histórico do client (leva até 40 s)…'
      : !e.ultimaLeitura ? 'Histórico ainda não lido: tento de novo no próximo champ select.'
      : `Histórico lido: ${e.partidas} partidas (o client guarda 20 ou 200, conforme o dia; personalizada, treino e remake ficam fora da conta).`));
  };
}

const dados = { campeoes: null, paginas: null, carregando: null };
const rascunho = { championId: 0, busca: '', posicao: '*', erro: '' };

const carregar = () => (dados.carregando ||= Promise.all([campeoes(), paginasEditaveis()]).then(([c, p]) => {
  dados.campeoes = c.sort((a, b) => a.nome.localeCompare(b.nome));
  dados.paginas = p;
  dados.lidoEm = Date.now();
}).finally(() => { dados.carregando = null; }));

export function blocoRunas(corpo, ctx) {
  const { cfg, definir, ui } = ctx;
  corpo.replaceChildren(ui.caixa('runas.ligado', 'Trocar a runa ao travar o campeão',
    'Uma página na regra: aplica sozinho. Duas ou mais: abre a escolha sobre o champ select. Sem regra e com a página de outro campeão: avisa.',
    cfg.runas.ligado, v => definir('runas.ligado', v)));
  if (!dados.campeoes || !dados.paginas) {
    corpo.append(ui.explica('Carregando campeões e páginas de runas…'));
    carregar().then(() => { if (corpo.isConnected) blocoRunas(corpo, ctx); }).catch(() => {
      if (corpo.isConnected) corpo.append(ui.explica('Não consegui ler campeões e páginas do client.'));
    });
    return;
  }
  // página criada ou apagada no client depois da leitura: relê (no máximo a cada 30 s) e redesenha
  if (Date.now() - dados.lidoEm > 30000 && !dados.carregando)
    carregar().then(() => { if (corpo.isConnected) blocoRunas(corpo, ctx); }).catch(() => {});
  const nomeCampeao = id => dados.campeoes.find(c => c.id === id)?.nome || `campeão ${id}`;
  const paginaPorId = Object.fromEntries(dados.paginas.map(p => [p.id, p]));
  const regras = cfg.runas.regras;
  const salvar = novas => definir('runas.regras', novas);
  const redesenharBloco = () => blocoRunas(corpo, ctx);

  const lista = el('div', 'lc-regras');
  if (!regras.length) lista.append(ui.explica('Nenhuma regra. Adicione abaixo.'));
  regras.forEach((r, i) => {
    const linha = el('div', 'lc-regra');
    const cab = el('div', 'lc-regra-cab');
    cab.append(el('span', 'lc-regra-campeao', nomeCampeao(r.championId)));
    const pos = ui.lista(`runas.regras.${i}.posicao`, '', POSICOES, r.posicao, v => {
      // já existe essa posição para o campeão: recusa e volta a lista ao valor salvo
      if (regras.some((x, j) => j !== i && x.championId === r.championId && x.posicao === v)) return redesenharBloco();
      const n = clonar(regras); n[i].posicao = v; salvar(n);
    });
    pos.classList.add('lc-regra-pos');
    cab.append(pos, botao('remover', 'lc-regra-remover', () => salvar(regras.filter((_, j) => j !== i))));
    linha.append(cab);

    const fichas = el('div', 'lc-fichas');
    for (const id of r.paginas) {
      const p = paginaPorId[id];
      const f = el('span', 'lc-ficha' + (p ? '' : ' lc-apagada'), p ? p.name : `página ${id} (apagada)`);
      const x = el('span', 'lc-ficha-x', '×');
      x.title = 'tirar da regra';
      x.addEventListener('click', () => { const n = clonar(regras); n[i].paginas = n[i].paginas.filter(v => v !== id); salvar(n); });
      f.append(x);
      fichas.append(f);
    }
    const livres = dados.paginas.filter(p => !r.paginas.includes(p.id));
    if (livres.length) {
      const add = ui.lista(`runas.regras.${i}.add`, '', [[0, '+ adicionar página'], ...livres.map(p => [p.id, p.name])], 0, v => {
        const n = clonar(regras); n[i].paginas.push(v); salvar(n);
      });
      add.classList.add('lc-ficha-add');
      fichas.append(add);
    }
    if (!r.paginas.some(id => paginaPorId[id])) fichas.append(ui.explica(r.posicao === '*'
      ? 'Sem página: a regra não faz nada.' : 'Sem página: vale a regra de qualquer posição do campeão.'));
    linha.append(fichas);
    lista.append(linha);
  });
  corpo.append(lista);

  // regra nova: campeão por nome (busca simples) + posição
  const nova = el('div', 'lc-regra lc-regra-nova');
  const cab = el('div', 'lc-regra-cab');
  const caixaBusca = el('lol-uikit-flat-input', 'lc-busca');
  const input = el('input');
  input.type = 'text';
  input.placeholder = 'Buscar campeão';
  input.value = rascunho.championId ? nomeCampeao(rascunho.championId) : rascunho.busca;
  caixaBusca.append(input);
  const sugestoes = el('div', 'lc-sugestoes');
  const sugerir = () => {
    const t = input.value.trim().toLowerCase();
    sugestoes.replaceChildren();
    if (!t || (rascunho.championId && nomeCampeao(rascunho.championId).toLowerCase() === t)) return;
    for (const c of dados.campeoes.filter(c => c.nome.toLowerCase().includes(t)).slice(0, 6)) {
      const s = el('div', 'lc-sugestao', c.nome);
      s.addEventListener('click', () => { rascunho.championId = c.id; rascunho.busca = c.nome; rascunho.erro = ''; redesenharBloco(); });
      sugestoes.append(s);
    }
  };
  input.addEventListener('input', () => { rascunho.busca = input.value; rascunho.championId = 0; sugerir(); });
  const pos = ui.lista('runas.nova.posicao', '', POSICOES, rascunho.posicao, v => { rascunho.posicao = v; redesenharBloco(); });
  pos.classList.add('lc-regra-pos');
  const adicionar = botao('adicionar regra', 'lc-regra-adicionar', () => {
    if (!rascunho.championId) { rascunho.erro = 'Escolha o campeão na lista de sugestões.'; return redesenharBloco(); }
    if (regras.some(x => x.championId === rascunho.championId && x.posicao === rascunho.posicao)) {
      rascunho.erro = 'Já existe regra para esse campeão nessa posição.'; return redesenharBloco();
    }
    const n = [...clonar(regras), { championId: rascunho.championId, posicao: rascunho.posicao, paginas: [] }];
    Object.assign(rascunho, { championId: 0, busca: '', posicao: '*', erro: '' });
    salvar(n);
  });
  cab.append(caixaBusca, pos, adicionar);
  nova.append(cab, sugestoes);
  if (rascunho.erro) nova.append(ui.explica(rascunho.erro));
  corpo.append(nova, ui.explica('Posição específica com página vence a "qualquer posição". O "restaurar padrão" não apaga as regras.'));
}

// ---- coach (plano v2: painel, voz, alertas, minimapa, mentor, carregamento, traumas) ----
// As chaves moram em cfg.coach (mesmos nomes do servidor_local.CONFIG_PADRAO) e vão ao coletor em
// POST 127.0.0.1:8765/config na carga e a cada mudança (coach.js). Traumas é só do plugin.

// avisos.TIPOS_LIGAVEIS do coletor: tipo -> rótulo. Duas caixas por tipo: voz e tela (painel + moldura)
const AVISOS = [
  ['gank', 'Gank provável'], ['intruso_grupo', '2+ inimigos chegando'], ['intruso', 'Intruso na tua rota'],
  ['jungler_apareceu', 'Jungler inimigo apareceu'], ['mid_indo', 'Mid inimigo saiu da rota'], ['mid_sumiu', 'Mid inimigo sumiu'],
  ['adversario_voltou', 'Adversário de rota voltou'], ['janela_objetivo', 'Janela de objetivo (inimigos mortos)'],
  ['objetivo_60s', 'Objetivo em 60 s'], ['mortes_cedo', 'Mortes antes dos 10'], ['inimigo_fed', 'Inimigo forte na tua rota'],
  ['ouro_guardado', 'Ouro guardado (hora de voltar?)'], ['feitico_voltou', 'Feitiço inimigo voltou (Flash...)'],
  ['pico_nivel', 'Inimigo no nível de pico'], ['pico_item', 'Inimigo fechou item'], ['regra', 'Outras dicas do coach'],
  ['feitico_marcado', 'Retorno do F9 (Flash marcado)'], ['overlay_f8', 'Retorno do F8 (overlay ligado/desligado)', ['tela']],
];
const MODELOS = [['sonnet', 'Sonnet (padrão)'], ['haiku', 'Haiku'], ['opus', 'Opus']];
const EFFORTS = [['low', 'Baixo'], ['medium', 'Médio (padrão)'], ['high', 'Alto']];
const TONS = [['serio', 'Sério'], ['descontraido', 'Descontraído']];

const caixaCoach = ({ cfg, definir, ui }, chave, rotulo, explicacao) =>
  ui.caixa('coach.' + chave, rotulo, explicacao, cfg.coach[chave], v => definir('coach.' + chave, v));

// estado da ligação com o coletor, no topo do 1º bloco
export const blocoConexao = estado => (corpo, { ui }) => {
  const e = estado();
  corpo.append(ui.explica(e.ok === null ? 'Coletor: ainda sem contato (a config vai quando ele responder).'
    : e.ok ? `Coletor ligado em 127.0.0.1:8765${e.enviadoEm ? ': config aplicada' : ''}.`
      : 'Coletor fora do ar agora: a config fica salva aqui e vai sozinha quando ele subir (tento a cada 30 s).'));
};

export const blocoPainel = (corpo, ctx) => corpo.append(
  caixaCoach(ctx, 'painelAoVivo', 'Painel ao vivo na 2ª tela', 'Na partida, abre o painel no monitor secundário (tua rota, ameaça, teu padrão, time e objetivos) e fecha no fim.'),
  caixaCoach(ctx, 'amostrasAoVivo', 'Gravar amostras da partida', 'A cada 10 s guarda nível, itens, ouro estimado e KDA dos 10 no banco: deixa o pós-jogo mais fino.'));

export const blocoVoz = (corpo, ctx) => corpo.append(
  caixaCoach(ctx, 'voz', 'Voz do coach', 'Fala os avisos em pt-BR (voz Maria do Windows), no máximo 1 a cada 20 s fora o de gank.'),
  ctx.ui.linha(ctx.ui.lista('coach.tomVoz', 'Tom', TONS, ctx.cfg.coach.tomVoz, v => ctx.definir('coach.tomVoz', v))));

export function blocoAlertas(corpo, ctx) {
  const { cfg, definir, ui } = ctx;
  corpo.append(caixaCoach(ctx, 'alertasTela', 'Moldura de alertas na tela', 'Borda colorida pulsando + rótulo curto por ~2 s, só com o jogo em primeiro plano.'),
    ui.explica('Por tipo: "voz" fala o aviso; "tela" mostra no painel e na moldura. Desmarcar os dois cala o aviso.'));
  const desl = cfg.coach.avisosDesligados;
  const trocar = (destino, tipo, ligado) => {  // lê o valor vivo: duas caixas seguidas sem remontar o painel
    const atual = cfg.coach.avisosDesligados, resto = atual[destino].filter(t => t !== tipo);
    definir('coach.avisosDesligados', { ...atual, [destino]: ligado ? resto : [...resto, tipo] });
  };
  const coluna = (...filhos) => { const d = document.createElement('div'); d.className = 'lc-campo'; d.append(...filhos); return d; };
  // 3º campo opcional: destinos que o tipo tem (o retorno do F8 só pinta a moldura, não fala: sem caixa "voz")
  for (const [tipo, rotulo, destinos = ['voz', 'tela']] of AVISOS) {
    const nome = document.createElement('div');
    nome.className = 'lol-settings-window-size-text';
    nome.textContent = rotulo;
    corpo.append(ui.linha(coluna(nome),
      ...['voz', 'tela'].map(d => coluna(...(destinos.includes(d)
        ? [ui.caixa(`coach.aviso.${d}.${tipo}`, d, '', !desl[d].includes(tipo), v => trocar(d, tipo, v))] : [])))));
  }
}

export const blocoMinimapa = (corpo, ctx) => corpo.append(
  caixaCoach(ctx, 'minimapa', 'Ler o minimapa', 'Print só do minimapa (~6 por segundo) para achar os ícones vistos: alimenta jungler, gank e alertas de posição. Nada do que está na fog.'),
  caixaCoach(ctx, 'overlayMinimapa', 'Overlay do jungler no minimapa', 'Área provável do jungler inimigo desde a última vez visto, por cima do minimapa; não recebe clique. Atalho: F8 liga e desliga durante a partida.'),
  caixaCoach(ctx, 'feiticos', 'Flash e feitiços inimigos', 'Lê os pings de feitiço do chat (OCR) e conta a recarga; F9 + 1 a 5 marca na mão o flash do inimigo.'));

export const blocoMentor = (corpo, ctx) => corpo.append(
  caixaCoach(ctx, 'mentor', 'Mentor no pós-jogo', 'No fim da partida, o teu Claude lê os números e escreve a análise; dá para perguntar no pós-jogo.'),
  ctx.ui.linha(
    ctx.ui.lista('coach.mentorModelo', 'Modelo', MODELOS, ctx.cfg.coach.mentorModelo, v => ctx.definir('coach.mentorModelo', v)),
    ctx.ui.lista('coach.mentorEffort', 'Esforço', EFFORTS, ctx.cfg.coach.mentorEffort, v => ctx.definir('coach.mentorEffort', v))),
  ctx.ui.explica('Padrão Sonnet + médio: venceu a comparação com a partida real (mais específico, nenhum número inventado, ~17 s).'));

export const blocoCarregamento = (corpo, ctx) => corpo.append(
  caixaCoach(ctx, 'carregamento', 'Os 10 na tela de carregamento', 'Elo, winrate e tags com número dos 10 jogadores (sequência, fora da rota, OTP, primeira vez, experiência, KDA, morre cedo, domina a rota) no painel da 2ª tela, pela Riot API. Identidade dos outros só em memória.'));

export const blocoTraumas = (corpo, { cfg, definir, ui }) => corpo.append(
  ui.caixa('traumas.ligado', 'Mostrar traumas', 'Campeão inimigo que mais aparece nas tuas derrotas (lift ≥ 1,2 com n ≥ 3, sempre com V/D ao lado): linha no selo do champ select e bloco na aba Tendência do pós-jogo.',
    cfg.traumas.ligado, v => definir('traumas.ligado', v)));
