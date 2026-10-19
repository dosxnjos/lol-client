// Pacote de vozes no bloco Voz da ⚙ (P5 de roadmap/2026-10-19-publicacao-e-complemento-publico.md): o estado do pacote (sem ele,
// a voz do Windows; com ele, Aoede e a versão) e o botão "baixar vozes (36 MB)" / "atualizar vozes (36 MB)". Só com o complemento
// coach anunciando "voz-pacote" (coach.js temRecurso: a rota está pendurada nele). O plugin nunca baixa nada nem fala com o
// GitHub: GET /voz/estado ao abrir o bloco (no máximo 1 a cada CONSULTA_MS; o complemento consulta a lista de releases para o
// tamanho) e, no clique, POST /voz/baixar {} com o progresso por GET /voz/estado a cada PASSO_MS. O complemento acha o pacote do
// catálogo dele no release, confere o hash e troca a pasta (coletor/voz_pacote.py); recusa fora de None/Lobby, na instalação de
// desenvolvimento e com pacote gerado no próprio computador.
import { TEXTO_SEM_RESPOSTA } from './atualizador.js';

export const RECURSO = 'voz-pacote';
export const PASSO_MS = 1000;
export const CONSULTA_MS = 30000;
export const RECONSULTA_MS = 2000;       // o complemento ainda consultando o release: pergunta de novo
export const RECONSULTAS_MAX = 10;
export const PRAZO_TOTAL_MS = 15 * 60 * 1000;
export const SEM_RESPOSTA_MAX = 15;
const NOMES = { aoede: 'Aoede' };
const nomeDe = p => NOMES[p] || (typeof p === 'string' && /^[\w-]{1,32}$/.test(p) ? p : 'Aoede');
const versaoDe = v => (typeof v === 'string' && /^[0-9a-f]{12}$/.test(v) ? v : '?');

// bytes -> "36 MB" (decimal, como o Explorer mostra o tamanho do download)
export const mb = b => `${Math.max(1, Math.round((Number(b) || 0) / 1e6))} MB`;

// motivo do complemento (coletor/voz_pacote.py) -> texto
export const TEXTOS = {
  desenvolvimento: 'Instalação de desenvolvimento: o botão não troca este pacote de vozes.',
  'gerado-aqui': 'Pacote de vozes gerado neste computador: o botão não troca este pacote.',
  partida: 'Baixe as vozes na tela inicial ou no lobby.',
  'em-dia': 'O pacote de vozes já está na versão desta instalação.',
  versao: 'Não foi possível identificar a versão das vozes desta instalação.',
  hash: 'As vozes baixadas não conferem com o release: nada foi trocado.',
  origem: 'As vozes não vieram do endereço oficial: nada foi trocado.',
  pacote: 'O pacote de vozes baixado está incompleto: nada foi trocado.',
  release: 'Pacote de vozes desta versão não encontrado no GitHub: tente de novo mais tarde.',
  rede: 'Não foi possível baixar as vozes: tente de novo mais tarde.',
  troca: 'Não foi possível trocar as vozes: o pacote anterior continua instalado.',
  'troca-nova': 'Não foi possível instalar as vozes: os avisos seguem na voz Maria do Windows.',
  'troca-incompleta': 'A troca das vozes parou no meio: o pacote anterior volta quando o complemento coach reiniciar.',
};
const RECUSAS_DA_LINHA = ['desenvolvimento', 'gerado-aqui', 'versao'];   // voz_pacote.PacoteVoz.recusa()
export const TEXTO_FALHA ='Não foi possível baixar as vozes agora: tente de novo mais tarde.';
export const TEXTO_DEMORA = 'O download das vozes ainda não terminou: confira de novo em alguns minutos.';
export const TEXTO_CONSULTANDO = 'Consultando o pacote de vozes…';

const obj = d => (d && typeof d === 'object' && !Array.isArray(d) ? d : null);
// download em curso no complemento ('consultando' fica de fora: pelo GET é a consulta do tamanho, não um download)
const emEtapa = d => ['baixando', 'conferindo', 'trocando'].includes(obj(d)?.estado);

// estado do complemento -> a linha do bloco
export function textoEstado(d) {
  if (!obj(d)) return TEXTO_CONSULTANDO;
  const nome = nomeDe(d.pacote), ins = obj(d.instalada);
  let t = ins
    ? `Pacote de vozes ${nome} instalado (versão ${versaoDe(ins.versao)}, ${Number(ins.falas) || 0} falas).`
    : `Sem o pacote de vozes ${nome}: os avisos saem na voz Maria do Windows.`;
  if (ins && d.acao === 'atualizar') t += ` Versão nova do pacote: ${versaoDe(d.esperada)}.`;
  if (d.acao === 'baixar' || d.acao === 'atualizar') {
    if (!obj(d.disponivel) && d.estado === 'consultando') t += ' Procurando o pacote desta versão…';
    else if (!obj(d.disponivel) && d.motivo === 'release') t += ' O pacote desta versão ainda não foi publicado.';
  }
  // recusa do complemento (sem botão): o motivo na linha, senão o texto dele só sairia num clique que não existe
  if (RECUSAS_DA_LINHA.includes(d.recusa)) t += ` ${TEXTOS[d.recusa]}`;
  return t;
}

// rótulo do botão, ou null (em dia, recusa, ainda procurando, pacote não publicado)
export function rotuloBotao(d) {
  if (!obj(d) || (d.acao !== 'baixar' && d.acao !== 'atualizar')) return null;
  const disp = obj(d.disponivel);
  if (!disp && (d.estado === 'consultando' || d.motivo === 'release')) return null;
  const suf = disp && Number(disp.tamanho) > 0 ? ` (${mb(disp.tamanho)})` : '';
  return `${d.acao === 'baixar' ? 'baixar' : 'atualizar'} vozes${suf}`;
}

// etapa em curso -> texto de progresso; null se não é etapa
export function textoProgresso(d) {
  const e = obj(d)?.estado;
  if (e === 'baixando') {
    const total = Number(d.total) || 0, lidos = Number(d.baixados) || 0;
    return total > 0 ? `Baixando as vozes… ${Math.round(lidos / 1e6)} de ${mb(total)}` : 'Baixando as vozes…';
  }
  if (e === 'conferindo') return 'Conferindo as vozes…';
  if (e === 'trocando') return 'Instalando as vozes…';
  if (e === 'consultando') return 'Baixando as vozes…';
  return null;
}

// estado -> texto final, ou null (ainda trabalhando). 'parado' com a versão do código instalada = sucesso (o 'pronto' pode ter
// passado sem ser lido, como no atualizador da P3)
export function traduzir(d) {
  const e = obj(d)?.estado;
  const ins = obj(d?.instalada);
  if (e === 'pronto' || (e === 'parado' && ins && ins.versao === d.esperada && ins.release)) {
    return `Vozes instaladas (versão ${versaoDe(ins?.versao ?? d.esperada)}): valem a partir da próxima partida.`;
  }
  if (e === 'recusado' || e === 'erro') return TEXTOS[d.motivo] || TEXTO_FALHA;
  if (textoProgresso(d)) return null;
  return TEXTO_FALHA;
}

const el = (tag, classe, texto) => {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined) e.textContent = texto;
  return e;
};

// coletor: fetch da ponte (coach.js); temRecurso(nome): recurso do aperto de mão; aoMudar(): repinta as Configurações.
// agendar/agora injetáveis (teste)
export function criarVozes({ coletor, temRecurso, aoMudar = () => {}, agendar = (fn, ms) => setTimeout(fn, ms), agora = () => Date.now() } = {}) {
  let dados = null, consultadoEm = -Infinity, emVoo = null, trabalhando = false, mensagem = '', progresso = '', reconsultas = 0;
  let acompanhaDesde = 0;   // download que esta instância não pediu (plugin recarregado no meio dele): acompanhado pelo GET
  const esperar = ms => new Promise(r => agendar(r, ms));
  const avisar = () => { try { aoMudar(); } catch (e) { console.error('[lol-client] vozes', e); } };
  const pode = () => typeof coletor === 'function' && !!temRecurso?.(RECURSO);

  // GET /voz/estado; o complemento ainda procurando no release: de novo em RECONSULTA_MS (até RECONSULTAS_MAX vezes seguidas)
  function consultar() {
    if (!pode() || trabalhando) return Promise.resolve(null);
    if (emVoo) return emVoo;
    consultadoEm = agora();
    emVoo = coletor('/voz/estado').then(r => {
      const d = r?.status === 200 ? obj(r.dados) : null;
      if (d) dados = d;
      if (d?.estado === 'consultando' && reconsultas < RECONSULTAS_MAX) {
        reconsultas++;
        agendar(() => { consultadoEm = -Infinity; avisar(); }, RECONSULTA_MS);
      } else if (emEtapa(d)) {
        // o complemento já está baixando (o clique foi de antes de um recarregamento): progresso a cada PASSO_MS, até o fim
        reconsultas = 0;
        if (!acompanhaDesde) { acompanhaDesde = agora(); mensagem = ''; }
        if (agora() - acompanhaDesde < PRAZO_TOTAL_MS) agendar(() => { consultadoEm = -Infinity; avisar(); }, PASSO_MS);
      } else {
        reconsultas = 0;
        if (acompanhaDesde && d) { mensagem = traduzir(d) || ''; acompanhaDesde = 0; }
      }
      return d;
    }).catch(() => null).finally(() => { emVoo = null; avisar(); });
    return emVoo;
  }

  const fim = texto => {
    trabalhando = false;
    progresso = '';
    mensagem = texto;
    consultadoEm = -Infinity;   // o bloco pergunta de novo e mostra o pacote novo
    avisar();
    return texto;
  };

  async function baixar() {
    if (trabalhando || !pode()) return null;
    trabalhando = true;
    mensagem = '';
    progresso = 'Baixando as vozes…';
    avisar();
    try {
      const r = await coletor('/voz/baixar', { metodo: 'POST', corpo: {} });
      if (!r || r.status === 0) return fim(TEXTO_SEM_RESPOSTA);
      let d = obj(r.dados);
      if (!d) return fim(TEXTO_FALHA);
      const t0 = agora();
      let falhas = 0;
      for (;;) {
        dados = d;
        const final = traduzir(d);
        if (final) return fim(final);
        const p = textoProgresso(d);
        if (p !== progresso) { progresso = p; avisar(); }
        if (agora() - t0 >= PRAZO_TOTAL_MS) return fim(TEXTO_DEMORA);
        await esperar(PASSO_MS);
        const e = await coletor('/voz/estado');
        if (e?.status === 200 && obj(e.dados)) { d = e.dados; falhas = 0; } else if (++falhas >= SEM_RESPOSTA_MAX) return fim(TEXTO_SEM_RESPOSTA);
      }
    } catch (e) {
      console.error('[lol-client] vozes', e);
      return fim(TEXTO_FALHA);
    }
  }

  // dentro do bloco Voz (blocos.js blocoVoz): nada sem o recurso
  function bloco(corpo, ui) {
    if (!pode()) return;
    if (!trabalhando && !emVoo && agora() - consultadoEm >= CONSULTA_MS) consultar();
    const etapa = !trabalhando && emEtapa(dados) ? textoProgresso(dados) : '';
    corpo.append(ui.explica(progresso || etapa || textoEstado(dados)));
    const rotulo = trabalhando || etapa ? null : rotuloBotao(dados);
    if (rotulo) {
      const b = el('lol-uikit-flat-button-secondary', 'lc-vozes-baixar', rotulo);
      b.addEventListener('click', () => { baixar(); });
      corpo.append(ui.linha(b));
    }
    if (mensagem && !trabalhando) corpo.append(ui.explica(mensagem));
  }

  return { consultar, baixar, bloco, estado: () => ({ dados, trabalhando, mensagem, progresso }) };
}
