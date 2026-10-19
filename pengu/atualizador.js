// Botão "atualizar" da linha "Versão x.y.z disponível" (P3 de roadmap/2026-10-19-publicacao-e-complemento-publico.md). O
// atualizacao.js chama o atualizador registrado aqui com ({versao, tag, repo}, {fase, progresso}); dois caminhos:
// - complemento coach anunciando "atualizar" (aperto de mão, coach.js temRecurso): POST /atualizar {versao} (só a versão: a URL
//   o complemento acha sozinho na origem fixa, coletor/atualizar.py) e o progresso por GET /atualizar/estado a cada PASSO_MS. O
//   complemento baixa, confere o hash, troca plugin e complemento e reinicia; aqui "pronto" vira "Atualizado para a versão x." com
//   "recarregar agora" (o atualizacao.js só recarrega em None/Lobby, por clique). Só em None/Lobby (o complemento também recusa).
// - sem ele: o caminho do atualizar.cmd (vem no pacote, na pasta do plugin) e o endereço da página da versão com "copiar link".
//   Nada abre sozinho: window.open fica de fora até a medição P0-a (o client abre o navegador?).
// Nunca: código baixado rodando no client (import de URL, eval). Atualização é arquivo trocado e conferido, num clique dele.
import { FASES_CONSULTA } from './atualizacao.js';

export const PASSO_MS = 1000;
export const PRAZO_TOTAL_MS = 10 * 60 * 1000;
export const SEM_RESPOSTA_MAX = 15;          // consultas seguidas sem resposta (~15 s): o complemento caiu no meio
export const PASTA_PLUGIN = 'lol-ultra-client';
const BARRA = String.fromCharCode(92);

const ETAPAS = {
  baixando: v => `Baixando a versão ${v}…`,
  conferindo: () => 'Conferindo os arquivos…',
  trocando: () => 'Instalando…',
};
// motivo do complemento (coletor/atualizar.py Falha) -> texto da linha
export const TEXTOS = {
  desenvolvimento: () => 'Instalação de desenvolvimento (pasta ligada a um repositório de código): o botão não troca estes arquivos.',
  'sem-plugin': () => `Pasta plugins${BARRA}${PASTA_PLUGIN} do Pengu Loader não encontrada: use o atualizar.cmd do pacote.`,
  partida: () => 'Atualize na tela inicial ou no lobby.',
  versao: v => `A versão ${v} não é mais nova que a instalada.`,
  hash: v => `Os arquivos da versão ${v} não conferem com o release: nada foi trocado.`,
  origem: v => `Os arquivos da versão ${v} não vieram do endereço oficial: nada foi trocado.`,
  pacote: v => `O pacote da versão ${v} está incompleto: nada foi trocado.`,
  release: v => `Versão ${v} não encontrada no GitHub: tente de novo mais tarde.`,
  rede: v => `Não foi possível baixar a versão ${v}: tente de novo mais tarde.`,
  troca: () => 'Não foi possível trocar os arquivos: a versão anterior continua instalada.',
  'troca-incompleta': () => 'A troca dos arquivos parou no meio: instale o pacote da versão pela página abaixo.',
};
export const TEXTO_SEM_RESPOSTA = 'Complemento coach sem resposta: tente de novo mais tarde.';
export const TEXTO_FALHA = 'Não foi possível atualizar agora: tente de novo mais tarde.';
export const TEXTO_DEMORA = 'A atualização ainda não terminou: confira de novo em alguns minutos.';

// pasta do plugin em plugins\ do Pengu (a página carrega de https://plugins/<pasta>/...); fora do client, o nome do pacote
export function pastaDoPlugin(url = import.meta.url) {
  try {
    const u = new URL(url);
    const p = u.hostname === 'plugins' ? decodeURIComponent(u.pathname.split('/')[1] || '') : '';
    return /^[\w .-]{1,64}$/.test(p) ? p : PASTA_PLUGIN;
  } catch { return PASTA_PLUGIN; }
}

export const linkDaVersao = (repo, tag) => `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`;

// sem o complemento: o atualizar.cmd e a página da versão
export const semComplemento = ({ versao, tag, repo }, pasta = PASTA_PLUGIN) => ({
  texto: `Para atualizar para a versão ${versao}: abra o atualizar.cmd da pasta plugins${BARRA}${pasta} do Pengu Loader e depois reinicie o client. Página da versão:`,
  link: linkDaVersao(repo, tag),
});

// estado do complemento -> resultado final da linha, ou null (ainda trabalhando)
export function traduzir(d, versao, link) {
  const e = d?.estado;
  if (e === 'pronto') return { texto: `Atualizado para a versão ${typeof d.versao === 'string' ? d.versao : versao}.`, recarregar: true };
  if (e === 'recusado' || e === 'erro') {
    const f = TEXTOS[d.motivo];
    const texto = f ? f(versao) : TEXTO_FALHA;
    return d.motivo === 'troca-incompleta' ? { texto, link } : texto;
  }
  if (e in ETAPAS) return null;
  return TEXTO_FALHA;
}

// coletor: fetch da ponte (coach.js); temRecurso(nome): recurso do aperto de mão. agendar/agora injetáveis (teste)
export function criarAtualizador({ coletor, temRecurso, agendar = (fn, ms) => setTimeout(fn, ms), agora = () => Date.now(),
  pasta = pastaDoPlugin() } = {}) {
  const esperar = ms => new Promise(r => agendar(r, ms));
  return async ({ versao, tag, repo }, { fase, progresso } = {}) => {
    const link = linkDaVersao(repo, tag);
    if (typeof coletor !== 'function' || !temRecurso?.('atualizar')) return semComplemento({ versao, tag, repo }, pasta);
    if (!FASES_CONSULTA.includes(fase)) return TEXTOS.partida();
    progresso?.(ETAPAS.baixando(versao));
    const r = await coletor('/atualizar', { metodo: 'POST', corpo: { versao } });
    if (!r || r.status === 0) return TEXTO_SEM_RESPOSTA;
    let d = r.dados && typeof r.dados === 'object' ? r.dados : null;
    if (!d) return TEXTO_FALHA;
    const t0 = agora();
    let falhas = 0, etapa = '';
    for (;;) {
      const fim = traduzir(d, versao, link);
      if (fim) return fim;
      if (d.estado !== etapa) { etapa = d.estado; progresso?.(ETAPAS[etapa](versao)); }
      if (agora() - t0 >= PRAZO_TOTAL_MS) return TEXTO_DEMORA;
      await esperar(PASSO_MS);
      const e = await coletor('/atualizar/estado');
      if (e?.status === 200 && e.dados && typeof e.dados === 'object') { d = e.dados; falhas = 0; }
      else if (++falhas >= SEM_RESPOSTA_MAX) return TEXTO_SEM_RESPOSTA;
    }
  };
}
