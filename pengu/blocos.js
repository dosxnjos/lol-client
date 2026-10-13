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
    corpo.append(ui.caixa('champSelect.ligado', 'Winrate com o campeão', 'No champ select, mostra partidas, winrate e KDA com o campeão em hover ou escolhido, no geral e na tua posição. Só os teus dados.',
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
