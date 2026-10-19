// Blocos "Champ select" e "Runas por campeão" na seção lol-client das Configurações (registrarBloco
// do configuracoes.js). O painel inteiro é remontado a cada mudança do cfg: o que é carregado da LCU
// (campeões, páginas) e o rascunho da regra nova ficam aqui no módulo, não no DOM.
import { campeoes, paginasEditaveis } from './runas.js';
import { JUNGLER_LONGE, OVERLAY_CORES, OVERLAY_FORCAS } from './config.js';
import { TEXTO_SILENCIAR, recursoVisivel } from './configuracoes.js';
import { icone } from './icones.js';

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
    corpo.append(ui.caixa('champSelect.ligado', 'Winrate com o campeão', 'No champ select, mostra partidas, winrate e KDA com o campeão em hover ou escolhido, no geral e na posição da partida; com o complemento coach, também o histórico contra o adversário de rota provável, o trauma e a força do draft em faixa. Só dados da sua conta.',
      cfg.champSelect.ligado, v => definir('champSelect.ligado', v)));
    const e = champ?.estado?.();
    corpo.append(ui.explica(!e ? '' : e.carregando && !e.partidas ? 'Lendo o histórico do client (leva até 40 s)…'
      : !e.ultimaLeitura ? 'Histórico ainda não lido: nova tentativa no próximo champ select.'
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
      if (corpo.isConnected) corpo.append(ui.explica('Não foi possível ler campeões e páginas do client.'));
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
      const x = el('span', 'lc-ficha-x');
      x.append(icone('fechar', { tam: 11 }));
      x.title = 'tirar da regra';
      x.setAttribute('role', 'button');
      x.setAttribute('aria-label', 'tirar da regra');
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
// As chaves moram em cfg.coach (mesmos nomes do servidor_local.CONFIG_PADRAO) e vão ao complemento coach em
// POST 127.0.0.1:8765/config no aperto de mão bom e a cada mudança (coach.js). Traumas é só do plugin. Cada bloco só aparece
// com o recurso anunciado pelo complemento (index.js registrarBloco visivel; roadmap/2026-10-17-plugin-pengu-primeiro.md,
// "Como o plugin se comporta sem o complemento"). Texto visível nunca diz "coletor", a porta nem "MCP": o nome para o
// usuário é "complemento coach" (docs/TEXTOS-DA-INTERFACE.md).

// avisos.TIPOS_LIGAVEIS do coletor: tipo -> rótulo. Duas caixas por tipo: voz e tela (painel + moldura)
const AVISOS = [
  ['gank', 'Gank provável'], ['intruso_grupo', '2+ inimigos chegando'], ['intruso', 'Intruso na sua rota'],
  ['jungler_apareceu', 'Jungler inimigo apareceu'], ['mid_indo', 'Mid inimigo saiu da rota'], ['mid_sumiu', 'Mid inimigo sumiu'],
  ['adversario_voltou', 'Adversário de rota voltou'], ['janela_objetivo', 'Janela de objetivo (inimigos mortos)'],
  ['objetivo_60s', 'Objetivo em 60 s'], ['mortes_cedo', 'Mortes antes dos 10'], ['inimigo_fed', 'Inimigo forte na sua rota'],
  ['ouro_guardado', 'Ouro guardado (hora de voltar?)'], ['feitico_voltou', 'Feitiço inimigo voltou (Flash...)'],
  ['pico_nivel', 'Inimigo no nível de pico'], ['pico_item', 'Inimigo fechou item'], ['regra', 'Outras dicas do coach'],
  ['feitico_marcado', 'Retorno do F7 (Flash marcado)'], ['overlay_f8', 'Retorno do F8 (overlay ligado/desligado)', ['tela']],
];
const MODELOS = [['sonnet', 'Sonnet (padrão)'], ['haiku', 'Haiku'], ['opus', 'Opus']];
const EFFORTS = [['low', 'Baixo'], ['medium', 'Médio (padrão)'], ['high', 'Alto']];
const TONS = [['serio', 'Sério'], ['descontraido', 'Descontraído']];

const caixaCoach = ({ cfg, definir, ui }, chave, rotulo, explicacao) =>
  ui.caixa('coach.' + chave, rotulo, explicacao, cfg.coach[chave], v => definir('coach.' + chave, v));

// estado da ponte (coach.js estadoPonte) -> linha de estado do bloco "Complemento coach" (desligado / procurando / encontrado)
export function textoPonte(e, agora = Date.now()) {
  if (!e?.ligado) return 'Desligado: o plugin não se comunica com o complemento coach.';
  if (e.visto) return `Complemento coach encontrado${e.versao != null ? ` (versão ${e.versao})` : ''}${e.enviadoEm ? ': configuração aplicada' : ''}.`;
  const s = e.proximaEm ? Math.max(1, Math.ceil((e.proximaEm - agora) / 1000)) : 0;
  return `Procurando o complemento coach${s ? `: nova tentativa em ${s} s` : ''}. As opções abaixo ficam salvas e vão quando ele responder.`;
}

// bloco "Complemento coach": a chave da ponte (coletor.ligado) e a linha de estado. procurar() = aperto de mão agora (só GET)
export const blocoConexao = (estado, procurar = null) => (corpo, { cfg, definir, ui }) => {
  const e = estado();
  corpo.append(ui.caixa('coletor.ligado', 'Usar o complemento coach', 'Programa opcional que roda fora do client: voz, painel na 2ª tela e alertas durante a partida. Ligado, o plugin procura o complemento neste computador; desligado, não se comunica com ele.',
    !!cfg.coletor?.ligado, v => definir('coletor.ligado', v)),
  ui.explica(textoPonte(e)));
  if (e?.ligado && !e.visto && typeof procurar === 'function') corpo.append(ui.linha(botao('procurar agora', 'lc-procurar', () => { procurar(); })));
  // desligar a ponte não para o Python: ele segue com a última configuração que recebeu
  if (e?.ligado || e?.salva) corpo.append(ui.explica('Desligar esta opção não desliga o coach ao vivo: o complemento segue com a última configuração recebida.'));
};

// sem o complemento: um bloco só, curto, no lugar dos blocos do coach (que somem sem o recurso anunciado)
export const blocoCoachAusente = (corpo, { ui }) => corpo.append(
  ui.explica('Voz com os avisos da partida, painel na 2ª tela e alertas no minimapa.'),
  ui.explica('Precisa do complemento coach (bloco "Complemento coach").'));

export const blocoPainel = (corpo, ctx) => corpo.append(
  caixaCoach(ctx, 'painelAoVivo', 'Painel ao vivo na 2ª tela', 'Na partida, abre o painel no monitor secundário (sua rota, ameaça, seu padrão, time e objetivos) e fecha no fim.'),
  caixaCoach(ctx, 'amostrasAoVivo', 'Gravar amostras da partida', 'A cada 10 s guarda nível, itens, ouro estimado e KDA dos 10 no banco: deixa o pós-jogo mais fino.'));

// voz: pacote Aoede gravado antes (coletor/voz.py), Maria do Windows só para a frase que falta no pacote
export const blocoVoz = (corpo, ctx) => corpo.append(
  caixaCoach(ctx, 'voz', 'Voz do coach', 'Fala os avisos em português com a voz Aoede, gravada antes; frase que ainda não foi gravada sai na voz Maria do Windows. No máximo 1 fala a cada 20 s, fora o gank.'),
  ctx.ui.linha(ctx.ui.lista('coach.tomVoz', 'Tom', TONS, ctx.cfg.coach.tomVoz, v => ctx.definir('coach.tomVoz', v))),
  caixaCoach(ctx, 'cortarFalaRepetida', 'Não repetir a mesma frase em menos de 1 minuto', 'Se a voz acabou de dizer a mesma coisa, pula (aviso de perigo igual só é pulado nos primeiros 10 s). A borda e o painel mostram do mesmo jeito.'));

// liga/desliga um tipo de aviso num destino ('voz' | 'tela'); lê o valor vivo: duas caixas seguidas sem remontar o painel
export function trocarAviso(cfg, definir, destino, tipo, ligado) {
  const atual = cfg.coach.avisosDesligados, resto = atual[destino].filter(t => t !== tipo);
  definir('coach.avisosDesligados', { ...atual, [destino]: ligado ? resto : [...resto, tipo] });
}

// seção "Som" da ⚙ do compacto (compacto/lateral-config.js, etapa B de roadmap/2026-10-16-chat-da-sala-som-icones.md): as chaves de
// som do plugin numa casa só, com os mesmos controles e chaves de "Aceitar partida", "Voz" e "Alertas na tela" (a dona segue o config.js)
export function blocoSomPlugin(corpo, ctx) {
  const { cfg, definir, ui } = ctx;
  corpo.append(ui.caixa('aceite.silenciarSom', ...TEXTO_SILENCIAR, cfg.aceite.silenciarSom, v => definir('aceite.silenciarSom', v)));
  // a voz é do complemento coach: sem o recurso "voz", a seção Som fica só com o som do plugin (Fase 1 do plano plugin Pengu primeiro)
  if (!recursoVisivel('voz')) return;
  blocoVoz(corpo, ctx);
  const titulo = document.createElement('div');
  titulo.className = 'lol-settings-window-size-text';
  titulo.textContent = 'Avisos com voz';
  const grade = document.createElement('div');
  grade.className = 'lc-som-avisos';
  for (const [tipo, rotulo, destinos = ['voz', 'tela']] of AVISOS) {
    if (!destinos.includes('voz')) continue;
    grade.append(ui.caixa(`coach.aviso.voz.${tipo}`, rotulo, '', !cfg.coach.avisosDesligados.voz.includes(tipo), v => trocarAviso(cfg, definir, 'voz', tipo, v)));
  }
  corpo.append(titulo, grade, ui.explica('Desmarcar cala só a voz do aviso: a borda e o painel continuam (bloco "Alertas na tela").'));
}

export function blocoAlertas(corpo, ctx) {
  const { cfg, definir, ui } = ctx;
  corpo.append(caixaCoach(ctx, 'alertasTela', 'Moldura de alertas na tela', 'Borda colorida pulsando + rótulo curto por ~2 s, só com o jogo em primeiro plano.'),
    // regras da calibração de 14/10/2026 (roadmap/2026-10-14-calibrar-avisos.md, passo 7): padrão = como ficou nela
    caixaCoach(ctx, 'gankOutraRota', 'Avisar gank nas outras rotas', 'Quando o jungler deles parece ir pegar um aliado em outra rota, avisa em amarelo, sem pressa, para você avisar o time. O gank na sua rota não muda com esta caixa.'),
    ui.linha(ui.lista('coach.junglerLonge', 'Jungler inimigo longe de você', JUNGLER_LONGE, cfg.coach.junglerLonge, v => definir('coach.junglerLonge', v))),
    ui.explica('Longe = longe de onde você está agora (não da rota escolhida). Jogando de jungler, tudo conta como perto. "Só no painel" precisa do painel da 2ª tela ligado. A linha "Jungler inimigo apareceu" abaixo cala ele perto e longe.'),
    caixaCoach(ctx, 'midSumiuFiltro', 'Avisar "mid sumiu" só quando faz sentido', 'Ligado: só no começo do jogo (de 1:30 a 14:00, antes de cair a 1ª torre do meio) e calado quando você está morto ou na base, quando atacam a sua base ou no meio de uma briga. Desligado: avisa toda vez que o mid some. Nos dois casos, no máximo 4 vezes por partida, com 2 minutos entre um e outro.'),
    ui.explica('Por tipo: "voz" fala o aviso; "tela" mostra no painel e na moldura. Desmarcar os dois cala o aviso.'));
  const desl = cfg.coach.avisosDesligados;
  const trocar = (destino, tipo, ligado) => trocarAviso(cfg, definir, destino, tipo, ligado);
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
  ctx.ui.linha(
    ctx.ui.lista('coach.overlayCor', 'Cor da mancha', OVERLAY_CORES, ctx.cfg.coach.overlayCor, v => ctx.definir('coach.overlayCor', v)),
    ctx.ui.lista('coach.overlayForca', 'Força da cor', OVERLAY_FORCAS, ctx.cfg.coach.overlayForca, v => ctx.definir('coach.overlayForca', v))),
  caixaCoach(ctx, 'overlaySuave', 'Mancha muda aos poucos', 'Ligado: a mancha cresce e some devagar. Desligado: muda na hora, aos saltos.'),
  ctx.ui.explica('Como ler: a mancha é onde o jungler deles pode estar agora; quanto mais forte a cor, mais provável. Ela não pinta onde o seu time tem visão e some uns 30 s depois da última pista dele.'),
  caixaCoach(ctx, 'feiticos', 'Flash e feitiços inimigos', 'Lê os pings de feitiço do chat (OCR) e conta a recarga. Na partida, F7 marca na mão o flash do inimigo: uma batida escolhe o adversário da sua rota, cada batida a mais passa para a próxima (top, jungler, mid, atirador, suporte) e a borda mostra quem está escolhido; parado cerca de 1 segundo, marca. Segurar F7 desfaz a última marcação.'));

export const blocoMentor = (corpo, ctx) => corpo.append(
  caixaCoach(ctx, 'mentor', 'Mentor no pós-jogo', 'No fim da partida, o Claude lê os números e escreve a análise; no pós-jogo, também responde perguntas.'),
  ctx.ui.linha(
    ctx.ui.lista('coach.mentorModelo', 'Modelo', MODELOS, ctx.cfg.coach.mentorModelo, v => ctx.definir('coach.mentorModelo', v)),
    ctx.ui.lista('coach.mentorEffort', 'Esforço', EFFORTS, ctx.cfg.coach.mentorEffort, v => ctx.definir('coach.mentorEffort', v))),
  ctx.ui.explica('Padrão Sonnet + médio: venceu a comparação com a partida real (mais específico, nenhum número inventado, ~17 s).'));

export const blocoCarregamento = (corpo, ctx) => corpo.append(
  caixaCoach(ctx, 'carregamento', 'Os 10 na tela de carregamento', 'Elo, winrate e tags com número dos 10 jogadores (sequência, fora da rota, OTP, primeira vez, experiência, KDA, morre cedo, domina a rota) no painel da 2ª tela, pela Riot API. Identidade dos outros só em memória.'));

export const blocoTraumas = (corpo, { cfg, definir, ui }) => corpo.append(
  ui.caixa('traumas.ligado', 'Mostrar traumas', 'Campeão inimigo que mais aparece nas suas derrotas (lift ≥ 1,2 com n ≥ 3, sempre com V/D ao lado): linha no selo do champ select e bloco na aba Tendência do pós-jogo.',
    cfg.traumas.ligado, v => definir('traumas.ligado', v)));

// client compacto (pengu/compacto/, roadmap/2026-10-13-client-compacto.md): vale na hora (index.js aoMudar -> sincronizar)
export const blocoCompacto = (corpo, { cfg, definir, ui }) => corpo.append(...[
  ui.caixa('compacto.ligado', 'Client compacto', 'Janela pequena só com a rotina (lobby, fila, seleção com as trocas, pós-jogo), o botão "modo compacto" no topo e o atalho Ctrl+Shift+M. Desligado: client normal, sem botão.',
    !!cfg.compacto?.ligado, v => definir('compacto.ligado', v)),
  ui.caixa('compacto.inicioCompacto', 'Abrir cada fase no compacto', 'Desligado: cada fase começa no client normal e o botão "modo compacto" leva ao compacto. ARAM, reconectar, celebrações e janelas próprias da Riot abrem o client normal de qualquer jeito.',
    !!cfg.compacto?.inicioCompacto, v => definir('compacto.inicioCompacto', v)),
  // a escolha entre o chat ao lado e as janelas próprias só existe com as janelas do complemento coach (recurso chat-janelas);
  // sem elas o chat é sempre ao lado (compacto/lateral.js lateralLigada)
  recursoVisivel('chat-janelas') ? ui.caixa('compacto.chatLateral', 'Chat e amigos ao lado do compacto', 'O botão de chat alarga o client para a direita com as conversas recentes e a última conversa aberta; o de amigos mostra a lista de amigos. Mensagem nova só aparece nos recentes e no contador: nada abre sozinho. Substitui as janelas do chat do complemento coach (elas deixam de abrir conversa sozinhas). Desligado: o botão de chat volta a abrir as janelas próprias.',
    cfg.compacto?.chatLateral !== false, v => definir('compacto.chatLateral', v)) : null,
  ui.caixa('compacto.fundoPerfil', 'Fundo do perfil no compacto', 'O fundo do seu perfil vira o fundo da janela compacta, centralizado e cortado nas laterais, com um véu escuro para o texto continuar legível. Só a imagem (o vídeo do fundo fica de fora). Desligado: o fundo escuro de sempre.',
    cfg.compacto?.fundoPerfil !== false, v => definir('compacto.fundoPerfil', v)),
  ui.caixa('compacto.chatSalaCresce', 'Abrir a sala do time com mensagem nova', 'Na seleção de campeões, na honra e no pós-jogo, a faixa do chat da sala abre sozinha quando outro jogador manda mensagem. Só a faixa cresce: o cursor continua onde estava e a mensagem não é marcada como lida. Desligado: a faixa só abre pelo clique, e a mensagem nova aparece no contador.',
    cfg.compacto?.chatSalaCresce !== false, v => definir('compacto.chatSalaCresce', v)),
].filter(Boolean));
