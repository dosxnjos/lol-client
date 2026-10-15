// Registro das expansões do client compacto (roadmap/2026-10-13-client-compacto.md, passo 15; pedido de 15/10/2026): cada
// vez que o roteador sai do compacto para o client normal (sozinho ou por clique dele) vira um evento com o motivo, a fase, a
// camada da Riot que estava aberta e a janela antes e depois; a volta ao compacto fecha o mesmo evento com a duração. O
// coletor grava em dados/expansoes-compacto.jsonl (POST /compacto/expansoes) e `python tools/relatorio-expansoes.py` agrupa,
// para decidir quais telas da Riot merecem tela compacta.
// Sem DOM no topo (importável no node: tools/teste-compacto-expansoes.mjs). Nada aqui chama a LCU.
// Privacidade: nome de jogador, Riot ID e texto de chat nunca saem. Da camada da Riot vão tag, id, classes e os filhos de
// 1º nível; texto só de título e botão, e só com palavras do VOCABULARIO de interface abaixo (o resto vira "…"): um nome
// não passa por construção (decisão técnica xvii do plano: reverte ampliando a lista, nunca mandando texto livre).

// palavras de interface (minúsculas, sem acento) que podem sair no título/botão de uma camada da Riot
export const VOCABULARIO = new Set(`
a o as os um uma uns umas de do da dos das no na nos nas em ao aos e ou para pra por com sem que se seu sua seus suas teu tua
meu minha nosso nossa este esta esse essa isso isto mais menos muito ja agora novo nova novos novas ultimo ultima proximo
aceitar recusar ok sim nao cancelar confirmar continuar fechar sair voltar jogar entrar abrir ver salvar aplicar enviar
pular prosseguir concluir reconectar tentar denunciar adicionar convidar remover desativar ativar comprar resgatar coletar
abrir desbloquear escolher selecionar trocar mudar editar reiniciar atualizar baixar instalar assistir sobre
erro aviso atencao alerta falha problema conexao servidor servidores manutencao atualizacao versao reinicie reiniciado
partida partidas fila filas jogo jogos ranqueada ranqueadas personalizada treino normal escolha alternada aram arena tft
lobby sala grupo time equipe aliado aliados inimigo inimigos jogador jogadores amigo amigos convite convites solicitacao
missao missoes concluida concluido desafio desafios conquista conquistas recompensa recompensas premio premios presente presentes bau baus
nivel niveis subiu subiu elo divisao liga pdl pontos promocao rebaixamento serie vitoria vitorias derrota derrotas
honra honrar honrou maestria campeao campeoes skin skins essencia essencias loja itens item fragmento fragmentos
evento eventos passe temporada temporadas anuncio noticia noticias novidade novidades bem vindo vinda parabens
configuracoes configuracao som video jogabilidade interface atalhos idioma conta perfil privacidade termos politica
penalidade penalidades restricao restricoes banimento suspensao alerta comportamento chat mensagem mensagens
replay replays download tempo minutos minuto segundos segundo hora horas dias dia
clash torneio torneios ingresso equipe inscricao dodge abandonou abandono saiu desconectado
voce sua seu esta estao foi foram sera ser ter tem tens pode podem deve precisa precisam quer deseja tens
personalizado personalizada banco espectador cliente client abri normal selecao indisponivel coletor fora consegui
deixou inicio painel analise desconhecida janela propria tela compacta compacto modo expandido daqui aqui la
abrindo indo possivel permitiu aguarde use clique tente confira busque cancele escolha identificada identificado desconhecido
accept decline ok yes no cancel confirm continue close exit back play join open view save apply send skip
error warning failed failure connection server update version match game queue ranked custom lobby party team
mission missions challenge challenges reward rewards gift level up rank honor mastery champion settings
`.trim().split(/\s+/));

const RIOT_ID = /[^\s#]{1,24}#[A-Za-z0-9]{2,6}/g;
const semAcento = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

// texto de título/botão -> só palavras do VOCABULARIO; o resto vira "…" (seguidos viram um). '' se nada sobrou
export function textoSeguro(t, max = 80) {
  const partes = [];
  for (const bruto of String(t ?? '').replace(RIOT_ID, ' ').split(/[\s.,;:!?()[\]{}"'«»“”/\\|<>+=*_~^`@#$%&-]+/)) {
    if (!bruto) continue;
    const ok = /^[\p{L}]{1,20}$/u.test(bruto) && VOCABULARIO.has(semAcento(bruto));
    const p = ok ? bruto.toLowerCase() : '…';
    if (p === '…' && partes.at(-1) === '…') continue;
    partes.push(p);
  }
  const s = partes.join(' ').slice(0, max);
  return /[\p{L}]/u.test(s) ? s : '';
}

const classesDe = (el, max = 120) => String(el?.className?.baseVal ?? el?.className ?? '').split(/\s+/)
  .filter(c => /^[\w-]{1,60}$/.test(c)).join(' ').slice(0, max);
const tagDe = el => String(el?.tagName || '').toLowerCase().slice(0, 40);
const TITULO = /(^|[-_\s])(title|titulo|header|heading|headline)([-_\s]|$)/i;
const BOTAO = /(^|[-_\s])(button|btn|botao)([-_\s]|$)/i;

// camada da Riot (filho do #lol-uikit-layer-manager-wrapper) -> descrição sem identidade
export function descreverCamada(el, { maxNos = 300 } = {}) {
  if (!el || el.nodeType !== 1) return null;
  const id = String(el.id || '');
  const filhos = Array.from(el.children || []).slice(0, 4).map(c => ({ tag: tagDe(c), classes: classesDe(c, 60) }));
  const titulos = [], botoes = [];
  // percorre no máximo maxNos elementos (camada grande, como a da loja, não trava o roteador)
  const pilha = [...Array.from(el.children || [])].reverse();
  let n = 0;
  while (pilha.length && n++ < maxNos && (titulos.length < 3 || botoes.length < 4)) {
    const c = pilha.pop();
    const tag = tagDe(c), cls = classesDe(c, 200);
    const ehBotao = tag === 'button' || tag.startsWith('lol-uikit-flat-button') || BOTAO.test(cls);
    const ehTitulo = /^h[1-4]$/.test(tag) || TITULO.test(cls);
    if (ehBotao || ehTitulo) {
      const t = textoSeguro(c.textContent, 60);
      if (t && ehBotao && botoes.length < 4 && !botoes.includes(t)) botoes.push(t);
      else if (t && ehTitulo && titulos.length < 3 && !titulos.includes(t)) titulos.push(t);
      if (ehBotao) continue;   // texto do botão já lido: não desce
    }
    for (const f of Array.from(c.children || []).reverse()) pilha.push(f);
  }
  return { tag: tagDe(el), id: /^[\w-]{1,40}$/.test(id) ? id : '', classes: classesDe(el), filhos, titulo: titulos.join(' | ').slice(0, 120), botoes };
}

export const DEPOIS_MS = 1100;      // a janela "depois" é lida isto depois da expansão (o ResizeTo leva até GRACA_MEDIDA_MS)
export const REENVIO_MS = 60000;    // coletor fora ou sem a rota: tenta de novo
export const MAX_FILA = 100;        // eventos guardados em memória sem coletor (o mais velho sai e conta em `descartados`)
export const LOTE = 50;
// o servidor do coletor lê no máximo 64 KiB de corpo (servidor_local.do_POST corta o resto: JSON torto, 400). O lote vai
// até LOTE_BYTES (bytes UTF-8 do corpo); um evento sozinho maior que isso perde as camadas e, se ainda não couber, é
// descartado (conta em `descartados`). Revisão adversarial de 15/10: 50 eventos com camadas passavam de 64 KiB e o lote
// voltava 400 para sempre, travando a fila
export const LOTE_BYTES = 40000;
export const ROTA = '/compacto/expansoes';

const _enc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
export const bytesDe = x => { const s = JSON.stringify(x); return _enc ? _enc.encode(s).length : s.length * 3; };

// envio ao COLETOR (127.0.0.1:8765, nunca a LCU): coletor = fetch do coach.js (caminho, {metodo, corpo, prazoMs}) -> {status}
export const enviarAoColetor = coletor => corpo => coletor(ROTA, { metodo: 'POST', corpo, prazoMs: 3000 });

// registro: abrir(dados) na saída do compacto, trocou(dados) a cada motivo novo enquanto expandido, fechar(dados) na volta.
// enviar({eventos, descartados}) -> Promise<{status}> (status 0 = coletor fora); medir() -> janela {larg, alt, x, y, ...}
export function criarRegistroExpansoes({ enviar, medir = () => null, agendar = setTimeout, limpar = clearTimeout,
  agora = () => Date.now(), carimbo = () => new Date().toISOString(), log = () => {}, depoisMs = DEPOIS_MS,
  reenvioMs = REENVIO_MS, maxFila = MAX_FILA }) {
  let aberta = null, fila = [], descartados = 0, enviando = false, timerReenvio = null, seq = 0;
  const envios = { ok: 0, falhas: 0, ultimo: null };
  const recentes = [];
  const falhasVistas = new Set();
  const medirSeguro = () => { try { return medir() || null; } catch { return null; } };

  function enfileirar(ev) {
    fila.push(ev);
    recentes.push({ tipo: ev.tipo, id: ev.id, em: ev.em, origem: ev.origem ?? null, motivo: ev.motivo ?? null, como: ev.como ?? null });
    if (recentes.length > 10) recentes.shift();
    while (fila.length > maxFila) { fila.shift(); descartados++; }
    despachar();
  }

  function agendarReenvio() {
    if (timerReenvio || !fila.length) return;
    timerReenvio = agendar(() => { timerReenvio = null; despachar(); }, reenvioMs);
  }

  // lote pelo tamanho do corpo (LOTE_BYTES) e por LOTE; evento gordo demais perde as camadas ou sai da fila
  function montarLote() {
    const lote = [];
    let total = 64;
    for (let i = 0; i < fila.length && lote.length < LOTE; i++) {
      let ev = fila[i], n = bytesDe(ev);
      if (n > LOTE_BYTES && ev.camadas) {
        ev = fila[i] = { ...ev, camadas: (ev.camadas || []).filter(c => c?.expande).slice(0, 1), camadasCortadas: true };
        n = bytesDe(ev);
      }
      if (n > LOTE_BYTES) { fila.splice(i--, 1); descartados++; continue; }
      if (lote.length && total + n + 1 > LOTE_BYTES) break;
      lote.push(ev); total += n + 1;
    }
    return lote;
  }

  function despachar() {
    if (enviando || !fila.length || typeof enviar !== 'function') return;
    const lote = montarLote(), desc = descartados;
    if (!lote.length) return;
    enviando = true;
    let ok = false;
    Promise.resolve().then(() => enviar({ eventos: lote, descartados: desc })).then(r => {
      const status = Number(r?.status) || 0;
      envios.ultimo = { status, em: carimbo(), n: lote.length };
      ok = status >= 200 && status < 300;
      if (ok) {
        envios.ok++;
        fila = fila.filter(e => !lote.includes(e));
        descartados = Math.max(0, descartados - desc);
      } else if (status === 400 || status === 413) {
        // o coletor recusou o corpo: reenviar o mesmo lote travaria a fila para sempre. Sai e conta como descartado
        envios.falhas++;
        fila = fila.filter(e => !lote.includes(e));
        descartados += lote.length;
        ok = true;   // segue com o resto da fila agora
        if (!falhasVistas.has(status)) { falhasVistas.add(status); log(`expansões: o coletor recusou o lote (${status}); ${lote.length} evento(s) descartado(s)`); }
      } else {
        envios.falhas++;
        const chave = status === 404 ? 404 : status === 0 ? 0 : 'outro';
        if (!falhasVistas.has(chave)) {
          falhasVistas.add(chave);
          log(status === 404 ? 'expansões: o coletor de pé não tem a rota /compacto/expansoes (reiniciar o coletor); guardando'
            : status === 0 ? 'expansões: coletor fora do ar; guardando e reenviando' : `expansões: o coletor respondeu ${status}; guardando`);
        }
      }
    }, () => { envios.falhas++; envios.ultimo = { status: 0, em: carimbo(), n: lote.length }; })
      .catch(() => { /* log quebrado não pode deixar `enviando` preso */ })
      .then(() => { enviando = false; if (ok && fila.length) despachar(); else agendarReenvio(); });
  }

  function mandarInicio(a) {
    if (a.inicioEnviado) return;
    a.inicioEnviado = true;
    if (a.timer) { limpar(a.timer); a.timer = null; }
    enfileirar({ ...a.evento, janelaDepois: medirSeguro() });
  }

  function fechar({ como = 'automático', fase = null, tela = null } = {}) {
    const a = aberta;
    if (!a) return null;
    aberta = null;
    mandarInicio(a);
    const ev = { tipo: 'fim', id: a.evento.id, em: carimbo(), duracaoMs: Math.max(0, Math.round(agora() - a.desde)), como, fase, tela,
      trilha: a.trilha, janela: medirSeguro() };
    enfileirar(ev);
    return ev;
  }

  function abrir(dados = {}) {
    if (aberta) fechar({ como: 'nova expansão sem volta registrada' });
    const evento = { tipo: 'inicio', id: `${Math.round(agora()).toString(36)}-${++seq}`, em: carimbo(), versao: 1, ...dados, janelaAntes: dados.janelaAntes ?? medirSeguro() };
    const a = { evento, desde: agora(), trilha: [], ultimoMotivo: dados.motivo ?? null, inicioEnviado: false, timer: null };
    aberta = a;
    a.timer = agendar(() => { a.timer = null; mandarInicio(a); }, depoisMs);
    return evento;
  }

  // motivo mudou com o client normal ainda à vista (ex.: regra 7 no lobby e a fase virou ARAM): entra na trilha do evento
  function trocou({ fase = null, motivo = null, origem = null } = {}) {
    const a = aberta;
    if (!a || motivo === a.ultimoMotivo) return;
    a.ultimoMotivo = motivo;
    if (a.trilha.length < 10) a.trilha.push({ aposMs: Math.max(0, Math.round(agora() - a.desde)), fase, motivo, origem });
  }

  // completa a expansão recém-aberta que ainda não saiu (ex.: o aviso que a tela deu logo depois do ctx.expandir()). Só
  // campos que ainda não existem; depois de mandado o início, nada muda
  function anotar(campos = {}) {
    const a = aberta;
    if (!a || a.inicioEnviado) return false;
    for (const [k, v] of Object.entries(campos)) if (a.evento[k] == null && v != null && v !== '') a.evento[k] = v;
    return true;
  }

  return {
    abrir, fechar, trocou, anotar, despachar, medirAgora: medirSeguro,
    estado: () => ({ aberta: aberta ? { id: aberta.evento.id, origem: aberta.evento.origem ?? null, motivo: aberta.evento.motivo ?? null,
      haMs: Math.round(agora() - aberta.desde) } : null, fila: fila.length, descartados, envios: { ...envios }, recentes: [...recentes] }),
  };
}
