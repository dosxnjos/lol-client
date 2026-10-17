// Perfil no compacto (etapa 3 de roadmap/2026-10-16-compacto-chat-amigos-perfil.md; pedido do Gabriel de 16/10/2026: "exibir perfil,
// mostrar histórico, baixar replay das partidas [...] bem como os recursos principais do meu perfil também [...] trocar a foto de
// perfil, por exemplo. A moldura, a bandeira, título, Emblema").
// - perfil de outro jogador (amigo): painel da direita, modo "perfil" da lateral (compacto/lateral.js), com resumo, histórico,
//   detalhe da partida e o replay só quando a Riot oferece;
// - editor do meu perfil: painel da esquerda (o mesmo lugar das ⚙, um dos dois por vez), ícone, moldura, bandeira, emblemas e
//   título; escolher não escreve nada; "salvar" (clique dele) manda só as chamadas que mudaram, cada uma com o corpo inteiro da Riot.
//
// Tudo lido no front da Riot 16.20 com `python tools/ler-wad.py` (16/10/2026), NUNCA enviado ao client real:
// - rcp-fe-lol-shared-components 9cbc81de4b27be2d.js, identity customizer: saveAndExit = _saveIcon + _saveRegalia +
//   _savePreferences (o corpo de cada um está em corpoIcone/corpoRegalia/corpoPreferencias, linha a linha); _setCurrentSelections
//   (a escolha nasce do summary-player-data/local-player); bordas (prestigeBorders, rankedBorder, _getHighestNonFilteredEntry,
//   getEarnedPrestigeLevels, PRESTIGE_LEVELS); bandeiras (defaultBanner, pastRankBanner, BANNER_TYPES); emblemas
//   (filteredChallenges: currentLevel ≠ NONE; MAX_SELECTED_TOKENS 3); ícones (ownedIconsWithBaseSet: 0–28 quando faltam, sem o 29);
//   bannerSkinsEnabled = platformConfig Regalia/BannerSkinsEnabled com default true (ember-data-binding de rcp-fe-ember-libs aplica o
//   default quando a leitura volta null, como o 404 medido aqui: a Riot manda bannerAccent).
// - rcp-fe-lol-profiles 3e7da685a8f3eb46.js: hasPrivateProfile (profile-privacy-enabled + summoners/{id}.privacy), backdropObserver
//   (/lol-collections/v1/inventories/{summonerId}/backdrop); a maestria top 3 é POST (fica fora: não é leitura).
// - rcp-fe-lol-match-history 70f9590985796fa8.js: _loadFriendData (GET /v1/products/lol/{puuid}/matches), detalhe /v1/games/{id},
//   shouldShowReplayButton (na vista de terceiro só fila em platformConfig.Replays.ThirdPersonAccessibleGameQueues).
// - shared-components summary-player-data/player/{puuid} (título e emblemas de outro jogador, ViewRegaliaService): medido em 16/10/2026
//   (GET 200 de um amigo: title {itemId, name, …}, topChallenges [{id, name, currentLevel, levelToIconPath, …}], bannerId, crestId).
// Só funções puras no topo (tools/teste-compacto-perfil.mjs); as views recebem doc e lcu injetados. Texto da LCU só por textContent.
import { h, iconeCampeao, perfilSalvo, icone, comIcone } from './comum.js';
import { FILAS, quandoCurto } from './lateral-chat.js';
import { criarReplay } from '../replay.js';

const enc = v => encodeURIComponent(String(v ?? ''));
export const PRESTIGE_LEVELS = [1, 30, 50, 75, 100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400, 425, 450, 475, 500];
export const CRESTA = { prestigio: '1', ranque: '2' };            // CREST_ID_PRESTIGE / CREST_ID_CURRENT_RANK
export const TIPO_MOLDURA = { prestigio: 'prestige', ranque: 'ranked' };
export const BANDEIRA = { padrao: '1', ranque: '2' };             // BANNER_ID_DEFAULT / BANNER_ID_PAST_RANK
export const TIPO_BANDEIRA = { padrao: 'blank', ranque: 'lastSeasonHighestRank' };
export const MAX_EMBLEMAS = 3;
const FILAS_FORA_DA_MOLDURA = ['JADE_RANKED_SOLO_5x5'];
export const HISTORICO_N = 20;

export const ROTAS_PERFIL = {
  invocador: puuid => `/lol-summoner/v2/summoners/puuid/${enc(puuid)}`,
  invocadorId: id => `/lol-summoner/v1/summoners/${enc(id)}`,
  privacidade: '/lol-summoner/v1/profile-privacy-enabled',
  ranque: puuid => `/lol-ranked/v1/ranked-stats/${enc(puuid)}`,
  fundo: id => `/lol-collections/v1/inventories/${enc(id)}/backdrop`,
  desafiosDe: puuid => `/lol-challenges/v1/summary-player-data/player/${enc(puuid)}`,
  historico: (puuid, n = HISTORICO_N) => `/lol-match-history/v1/products/lol/${enc(puuid)}/matches?begIndex=0&endIndex=${n - 1}`,
  jogo: gid => `/lol-match-history/v1/games/${enc(gid)}`,
  replays: '/lol-platform-config/v1/namespaces/Replays',
  // meu perfil (editor)
  eu: '/lol-summoner/v1/current-summoner',
  regalia: '/lol-regalia/v2/current-summoner/regalia',
  resumoDesafios: '/lol-challenges/v1/summary-player-data/local-player',
  desafios: '/lol-challenges/v1/challenges/local-player',
  titulos: '/lol-challenges/v2/titles/local-player',
  icones: '/lol-inventory/v2/inventory/SUMMONER_ICON',
  catalogoIcones: '/lol-game-data/assets/v1/summoner-icons.json',
  destaqueBandeira: '/lol-platform-config/v1/namespaces/Regalia/BannerSkinsEnabled',
  // escritas: só no "salvar", com o clique dele
  salvarIcone: '/lol-summoner/v1/current-summoner/icon',
  salvarRegalia: '/lol-regalia/v2/current-summoner/regalia',
  salvarPreferencias: '/lol-challenges/v1/update-player-preferences',
};
export const iconePerfil = id => (Number.isInteger(Number(id)) && Number(id) >= 0 && String(id) !== '' ? `/lol-game-data/assets/v1/profile-icons/${Math.trunc(Number(id))}.jpg` : '');
// imagem servida pela LCU (caminho da própria página): só caminho absoluto com caracteres seguros (vai dentro de url("…") no CSS)
export const caminhoSeguro = p => (typeof p === 'string' && /^\/[\w\-./%]+\.(jpe?g|png|webp)$/i.test(p) && !p.includes('..') ? p : '');

// ---------- ranque ----------
const TIER = { IRON: 'Ferro', BRONZE: 'Bronze', SILVER: 'Prata', GOLD: 'Ouro', PLATINUM: 'Platina', EMERALD: 'Esmeralda', DIAMOND: 'Diamante',
  MASTER: 'Mestre', GRANDMASTER: 'Grão-Mestre', CHALLENGER: 'Desafiante' };
export const nomeTier = t => TIER[String(t || '').toUpperCase()] || '';
// GET /lol-ranked/v1/ranked-stats/{puuid} -> [{fila, texto, vd}] para Solo/Duo e Flex
export function ranquesDe(stats) {
  const filas = [['RANKED_SOLO_5x5', 'Solo/Duo'], ['RANKED_FLEX_SR', 'Flex']];
  const lista = Array.isArray(stats?.queues) ? stats.queues : [];
  return filas.map(([q, fila]) => {
    const e = stats?.queueMap?.[q] || lista.find(x => x?.queueType === q) || null;
    const tier = nomeTier(e?.tier);
    if (!e || !tier) return { fila, texto: 'sem ranque', vd: '' };
    const div = ['I', 'II', 'III', 'IV'].includes(e.division) && !['MASTER', 'GRANDMASTER', 'CHALLENGER'].includes(String(e.tier).toUpperCase()) ? ` ${e.division}` : '';
    const pdl = Number.isFinite(Number(e.leaguePoints)) ? ` · ${Number(e.leaguePoints)} PDL` : '';
    const v = Number(e.wins), d = Number(e.losses);
    return { fila, texto: `${tier}${div}${pdl}`, vd: Number.isFinite(v) && Number.isFinite(d) && v + d > 0 ? `${v}V ${d}D` : '' };
  });
}

// ---------- perfil de outro jogador ----------
// hasPrivateProfile do rcp-fe-lol-profiles: privacidade ligada na região E o invocador PRIVATE
export const perfilPrivado = (privacidade, invocador) => privacidade === 'ENABLED' && invocador?.privacy === 'PRIVATE';
// título e emblemas de summary-player-data ([S] para outro jogador; local-player medido: {title, topChallenges, bannerId, crestId, …})
export function desafiosDoResumo(sum) {
  const s = sum && typeof sum === 'object' ? sum : {};
  const t = s.title && typeof s.title === 'object' ? s.title : null;
  const titulo = t && Number(t.itemId) >= 0 && typeof t.name === 'string' ? t.name : '';
  const emblemas = (Array.isArray(s.topChallenges) ? s.topChallenges : []).filter(c => c && typeof c === 'object' && Number.isFinite(Number(c.id))).slice(0, MAX_EMBLEMAS)
    .map(c => ({ id: Number(c.id), nome: String(c.name || ''), nivel: String(c.currentLevel || ''), icone: caminhoSeguro(c.levelToIconPath?.[c.currentLevel]) }));
  return { titulo, emblemas };
}
// resumo da faixa do perfil: invocador (v2 por puuid) + ranque + desafios + fundo + o que se sabe do amigo (presença)
export function resumoJogador({ invocador = null, ranque = null, desafios = null, fundo = null, alvo = {} } = {}) {
  const s = invocador && typeof invocador === 'object' ? invocador : {};
  const d = desafiosDoResumo(desafios);
  return { nome: String(s.gameName || alvo.nome || 'jogador'), tag: String(s.tagLine || alvo.tag || ''), nivel: Number(s.summonerLevel) > 0 ? Number(s.summonerLevel) : null,
    icone: Number.isInteger(Number(s.profileIconId)) && Number(s.profileIconId) >= 0 && s.profileIconId !== null ? Number(s.profileIconId) : null,
    ranques: ranque ? ranquesDe(ranque) : [], titulo: d.titulo, emblemas: d.emblemas, fundo: caminhoSeguro(fundo?.backdropImage) };
}

// GET …/products/lol/{puuid}/matches -> linhas do histórico (o jogo de amigo traz 1 participante, o dono, medido em 16/10/2026)
const minutos = s => (Number(s) > 0 ? `${Math.round(Number(s) / 60)} min` : '');
export function linhasHistorico(json, { puuid = '', agoraMs = Date.now() } = {}) {
  const jogos = Array.isArray(json?.games?.games) ? json.games.games : [];
  return jogos.filter(g => g && typeof g === 'object' && Number(g.gameId) > 0).map(g => {
    const ids = Array.isArray(g.participantIdentities) ? g.participantIdentities : [];
    const meuId = ids.find(i => puuid && i?.player?.puuid === puuid)?.participantId;
    const ps = Array.isArray(g.participants) ? g.participants : [];
    const p = (meuId !== undefined ? ps.find(x => x?.participantId === meuId) : null) || ps[0] || {};
    const st = p.stats || {};
    const remake = !!st.gameEndedInEarlySurrender;
    return { gameId: Number(g.gameId), queueId: Number(g.queueId), fila: FILAS[Number(g.queueId)] || (g.gameMode ? String(g.gameMode) : 'partida'), campeao: Number(p.championId) || 0,
      resultado: remake ? 'remake' : st.win === true ? 'vitória' : st.win === false ? 'derrota' : '', k: Number(st.kills) || 0, d: Number(st.deaths) || 0, a: Number(st.assists) || 0,
      duracao: minutos(g.gameDuration), quando: Number(g.gameCreation) > 0 ? quandoCurto(new Date(Number(g.gameCreation)).toISOString(), agoraMs) : '',
      // o corpo do create do replay (replay.corpoCriar): fila, tipo, versão, criação e duração do jogo
      replay: { gameVersion: g.gameVersion, gameType: g.gameType, queueId: g.queueId, gameCreation: g.gameCreation, gameDuration: g.gameDuration } };
  });
}
// GET /lol-match-history/v1/games/{id} -> {times:[{id, vitoria, jogadores:[{campeao, k, d, a, nome, dono}]}]}. nome = o Riot ID que a
// Riot mostra no detalhe da partida (vai por textContent)
export function detalheJogo(json, puuidDono = '') {
  const ps = Array.isArray(json?.participants) ? json.participants : [];
  const ids = new Map((Array.isArray(json?.participantIdentities) ? json.participantIdentities : []).filter(Boolean).map(i => [i.participantId, i.player || {}]));
  const times = new Map();
  for (const p of ps) {
    if (!p || typeof p !== 'object') continue;
    const t = Number(p.teamId) || 0, pl = ids.get(p.participantId) || {}, st = p.stats || {};
    if (!times.has(t)) times.set(t, { id: t, vitoria: st.win === true, jogadores: [] });
    const nome = pl.gameName ? `${pl.gameName}${pl.tagLine ? `#${pl.tagLine}` : ''}` : '';
    times.get(t).jogadores.push({ campeao: Number(p.championId) || 0, k: Number(st.kills) || 0, d: Number(st.deaths) || 0, a: Number(st.assists) || 0, nome,
      dono: !!puuidDono && pl.puuid === puuidDono });
  }
  return { times: [...times.values()].sort((a, b) => a.id - b.id) };
}
// shouldShowReplayButton do match-history: na vista de terceiro, só fila listada em Replays.ThirdPersonAccessibleGameQueues (texto
// "420,440"); ausente (medido em 16/10/2026) = a Riot não oferece. Primeira pessoa (o próprio histórico) = sempre oferece
export function replayOferecido(cfgReplays, queueId, { terceiro = true } = {}) {
  if (!terceiro) return true;
  const txt = cfgReplays && typeof cfgReplays === 'object' ? cfgReplays.ThirdPersonAccessibleGameQueues : null;
  if (typeof txt !== 'string' || !txt.trim()) return false;
  return txt.split(',').map(x => parseInt(x, 10)).includes(Number(queueId));
}

// ---------- editor do meu perfil (identity customizer da Riot) ----------
// _setCurrentSelections + _fetchRegalia + current-summoner -> a escolha (o mesmo formato do componente da Riot)
export function selecaoInicial({ eu = null, regalia = null, resumo = null } = {}) {
  const r = regalia && typeof regalia === 'object' ? regalia : {};
  const s = resumo && typeof resumo === 'object' ? resumo : {};
  return {
    iconId: Number.isInteger(eu?.profileIconId) ? eu.profileIconId : null,
    crestType: r.preferredCrestType ?? null, prestigeCrest: r.selectedPrestigeCrest, crestId: s.crestId, borderLevel: s.prestigeCrestBorderLevel,
    bannerType: r.preferredBannerType ?? null, bannerId: s.bannerId,
    tokens: Array.isArray(s.topChallenges) ? s.topChallenges.map(c => (c && typeof c === 'object' && c.id !== undefined ? Number(c.id) : undefined)) : [],
    title: s.title && typeof s.title === 'object' ? { itemId: s.title.itemId, name: String(s.title.name || '') } : null,
  };
}
// _saveIcon: só número e diferente do ícone atual
export const corpoIcone = (sel, iconeAtual) => (typeof sel.iconId === 'number' && sel.iconId !== iconeAtual ? { profileIconId: sel.iconId } : null);
// _saveRegalia: sem tipo de moldura ou de bandeira, nada; selectedPrestigeCrest fica de fora quando undefined (moldura de ranque)
export function corpoRegalia(sel) {
  if (!sel.crestType || !sel.bannerType) return null;
  const c = { preferredCrestType: sel.crestType, preferredBannerType: sel.bannerType };
  if (sel.prestigeCrest !== undefined) c.selectedPrestigeCrest = sel.prestigeCrest;
  return c;
}
// _savePreferences, linha a linha: challengeIds (3 posições, vazias = −1) só com algum emblema; title = String(itemId || −1) só se ≥ 0
// (itemId 0 vira −1, como na Riot); bannerAccent = o id da bandeira com o destaque ligado; crestBorder e prestigeCrestBorderLevel
export function corpoPreferencias(sel, { destaqueBandeira = true } = {}) {
  const ids = (sel.tokens || []).map(t => (t === null || t === undefined ? undefined : t));
  const d = {};
  if (ids.length) {
    d.challengeIds = [];
    for (let i = 0; i < MAX_EMBLEMAS; i++) d.challengeIds.push(ids[i] !== undefined ? ids[i] : -1);
  }
  const t = (sel.title && sel.title.itemId) || -1;
  if (t >= 0) d.title = t.toString();
  if (sel.bannerId && destaqueBandeira) d.bannerAccent = sel.bannerId;
  d.crestBorder = sel.crestId || (sel.crestType !== TIPO_MOLDURA.ranque ? CRESTA.prestigio : CRESTA.ranque);
  const c = sel.prestigeCrest || 0;
  d.prestigeCrestBorderLevel = sel.borderLevel || (c > 0 ? PRESTIGE_LEVELS[c - 1] : 0);
  return d;
}
const mesmo = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// "salvar" (decisão 9 do plano): as chamadas do saveAndExit da Riot, na mesma ordem, mas só as que mudaram em relação ao que foi
// lido; cada uma com o corpo inteiro. -> [{metodo, rota, corpo, parte}]
// aceitos = {regalia, prefs}: o último corpo que a Riot aceitou de cada chamada (depois de um "salvar"); sem ele, compara com o lido. Por
// chamada, não pela escolha: regalia recusada e preferências aceitas na mesma moldura deixam SÓ a regalia pendente
export function chamadasSalvar(inicial, sel, { iconeAtual = inicial?.iconId ?? null, destaqueBandeira = true, aceitos = {} } = {}) {
  const out = [];
  const ic = corpoIcone(sel, iconeAtual);
  if (ic) out.push({ metodo: 'PUT', rota: ROTAS_PERFIL.salvarIcone, corpo: ic, parte: 'ícone' });
  const r = corpoRegalia(sel);
  if (r && !mesmo(r, aceitos.regalia ?? corpoRegalia(inicial))) out.push({ metodo: 'PUT', rota: ROTAS_PERFIL.salvarRegalia, corpo: r, parte: 'moldura e bandeira' });
  const p = corpoPreferencias(sel, { destaqueBandeira });
  if (!mesmo(p, aceitos.prefs ?? corpoPreferencias(inicial, { destaqueBandeira }))) out.push({ metodo: 'POST', rota: ROTAS_PERFIL.salvarPreferencias, corpo: p, parte: 'emblemas, título e moldura' });
  return out;
}
// escolhas (o actions do componente da Riot; nenhuma escreve nada)
export const escolherIcone = (sel, id) => ({ ...sel, iconId: Number(id) });
// selectBorder: tipo, prestígio (itemId; undefined na de ranque), nível e crestId da opção
export const escolherMoldura = (sel, op) => (op && !op.off ? { ...sel, crestType: op.crestType, prestigeCrest: op.itemId, borderLevel: op.level, crestId: op.crestId } : sel);
export const escolherBandeira = (sel, op) => (op && !op.off ? { ...sel, bannerType: op.bannerType, bannerId: op.bannerId } : sel);
export const escolherTitulo = (sel, t) => (t ? { ...sel, title: { itemId: t.itemId, name: String(t.name || '') } } : sel);
// _assignToken: o desafio vai para a posição escolhida (só desafio com nível). Desafio já posto noutra posição: nada (o mouseUp do
// identity-customizer-token da Riot só chama o onClick se selectedTokenIds não tem o id; revisão de 16/10/2026: sem isto saía
// challengeIds [X, X, −1], corpo que o front da Riot nunca manda)
export function escolherEmblema(sel, posicao, desafio) {
  if (!desafio || !(posicao >= 0 && posicao < MAX_EMBLEMAS) || String(desafio.currentLevel || 'NONE') === 'NONE') return sel;
  if ((sel.tokens || []).some(t => t !== undefined && t !== null && Number(t) === Number(desafio.id))) return sel;
  const tokens = [...(sel.tokens || [])];
  while (tokens.length < posicao) tokens.push(undefined);
  tokens[posicao] = Number(desafio.id);
  return { ...sel, tokens };
}

// opções de cada aba
// molduras: a de ranque (maior ranque fora do TFT Jade; cinza sem ranque) + as de prestígio que o nível já liberou
export function opcoesMolduras({ nivel = 1, filas = [], maiorRanque = null, sel = {} } = {}) {
  const lista = Array.isArray(filas) ? filas : [];
  let e = lista.find(x => x && !FILAS_FORA_DA_MOLDURA.includes(x.queueType) && x.tier && x.tier !== 'NONE') || null;
  if (!e && maiorRanque && !FILAS_FORA_DA_MOLDURA.includes(maiorRanque.queueType)) e = maiorRanque;
  const tier = e?.tier && e.tier !== 'NONE' ? nomeTier(e.tier) : '';
  const out = [{ chave: 'ranked', crestType: TIPO_MOLDURA.ranque, crestId: CRESTA.ranque, itemId: undefined, level: undefined, rotulo: tier ? `ranque: ${tier}` : 'ranque',
    off: !tier, motivo: tier ? '' : 'sem ranque nesta temporada', marcada: sel.crestType === TIPO_MOLDURA.ranque }];
  const n = Number(nivel) || 1;
  PRESTIGE_LEVELS.forEach((nv, i) => {
    if (n >= nv) out.push({ chave: `prestige-${nv}`, crestType: TIPO_MOLDURA.prestigio, crestId: CRESTA.prestigio, itemId: i + 1, level: nv, rotulo: `prestígio do nível ${nv}`,
      off: false, motivo: '', marcada: sel.crestType === TIPO_MOLDURA.prestigio && Number(sel.prestigeCrest) === i + 1 });
  });
  return out;
}
// bandeiras: padrão e a da temporada passada (cinza sem ranque nela); as de evento vêm de /v3/inventory/REGALIA_BANNER (404 aqui)
export function opcoesBandeiras({ ultimaTemporada = null, sel = {} } = {}) {
  const tier = nomeTier(ultimaTemporada);
  return [
    { chave: 'blank', bannerType: TIPO_BANDEIRA.padrao, bannerId: BANDEIRA.padrao, rotulo: 'padrão', off: false, motivo: '',
      marcada: (sel.bannerType === TIPO_BANDEIRA.padrao && !sel.bannerId) || sel.bannerId === BANDEIRA.padrao },
    { chave: 'pastRank', bannerType: TIPO_BANDEIRA.ranque, bannerId: BANDEIRA.ranque, rotulo: tier ? `temporada passada: ${tier}` : 'temporada passada', off: !ultimaTemporada,
      motivo: ultimaTemporada ? '' : 'sem ranque na temporada passada', marcada: (sel.bannerType === TIPO_BANDEIRA.ranque && !sel.bannerId) || sel.bannerId === BANDEIRA.ranque },
  ];
}
const ORDEM_NIVEL = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
export const NIVEL_PT = { IRON: 'Ferro', BRONZE: 'Bronze', SILVER: 'Prata', GOLD: 'Ouro', PLATINUM: 'Platina', DIAMOND: 'Diamante', MASTER: 'Mestre', GRANDMASTER: 'Grão-Mestre', CHALLENGER: 'Desafiante' };
// emblemas: desafios com nível (GET /lol-challenges/v1/challenges/local-player: objeto id -> desafio, ou lista), nível maior primeiro
export function opcoesEmblemas(desafios) {
  const lista = Array.isArray(desafios) ? desafios : desafios && typeof desafios === 'object' ? Object.values(desafios) : [];
  return lista.filter(c => c && typeof c === 'object' && Number.isFinite(Number(c.id)) && c.currentLevel && c.currentLevel !== 'NONE')
    .map(c => ({ id: Number(c.id), nome: String(c.name || `desafio ${c.id}`), nivel: String(c.currentLevel), icone: caminhoSeguro(c.levelToIconPath?.[c.currentLevel]), currentLevel: c.currentLevel }))
    .sort((a, b) => ORDEM_NIVEL.indexOf(b.nivel) - ORDEM_NIVEL.indexOf(a.nivel) || a.nome.localeCompare(b.nome, 'pt-BR'));
}
export function opcoesTitulos(titulos) {
  return (Array.isArray(titulos) ? titulos : []).filter(t => t && typeof t === 'object' && Number.isFinite(Number(t.itemId)) && typeof t.name === 'string')
    .map(t => ({ itemId: Number(t.itemId), name: t.name })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
// ícones: o inventário (itemId) + o conjunto básico 0–28 quando nenhum dele veio, sem o 29 (ownedIconsWithBaseSet); nome do catálogo
export function opcoesIcones(inventario, catalogo = null) {
  const ids = new Set((Array.isArray(inventario) ? inventario : []).map(i => Number(i?.itemId)).filter(n => Number.isInteger(n) && n >= 0));
  if (![...ids].some(n => n >= 0 && n <= 28)) for (let n = 0; n <= 28; n++) ids.add(n);
  ids.delete(29);
  const nomes = new Map((Array.isArray(catalogo) ? catalogo : []).filter(c => c && Number.isInteger(Number(c.id))).map(c => [Number(c.id), String(c.title || '')]));
  return [...ids].sort((a, b) => b - a).map(id => ({ id, nome: nomes.get(id) || '' }));
}

// ---------- desenho ----------
const tirar = (pai, nos) => pai.replaceChildren(...nos.filter(Boolean));
const fotoPerfil = (doc, id, tam, letra = '?') => {
  const url = iconePerfil(id);
  return h('span', { doc, class: 'lc-pf-ic', style: { width: `${tam}px`, height: `${tam}px`, backgroundImage: url ? `url("${url}")` : '' } }, url ? '' : String(letra || '?').slice(0, 1).toUpperCase());
};
const emblemaEl = (doc, e, extra = {}) => h('span', { doc, class: 'lc-pf-em' + (extra.vazio ? ' lc-pf-vazio' : ''), title: e ? `${e.nome}${e.nivel ? ` · ${NIVEL_PT[e.nivel] || e.nivel}` : ''}` : 'posição vazia',
  style: { backgroundImage: e?.icone ? `url("${e.icone}")` : '' }, ...extra.attrs }, e && !e.icone ? String(e.nome || '?').slice(0, 1) : '');

// Perfil de outro jogador (painel da direita). amb = {doc, lcu, seguro, avisar, campeoes() -> Promise<Map>, agora(),
// acoes: {estado(alvo) -> {convidar, assistir}, convidar(alvo, ev), mensagem(alvo, ev), assistir(alvo, ev)}}
// -> {el, abrir(alvo), relogio(), fechar(), estado()}. alvo = {puuid, summonerId, nome, pid?, eu?}
export function criarPerfilView(amb) {
  const { doc, lcu } = amb;
  const agora = () => (typeof amb.agora === 'function' ? amb.agora() : Date.now());
  const st = { alvo: null, aba: 'resumo', resumo: null, linhas: null, motivo: '', privado: false, jogo: null, detalhe: null, cfgReplays: null, lendo: 0, nomes: new Map() };
  const faixa = h('div', { doc, class: 'lc-pf-faixa', dataset: { a: 'pf-faixa' } });
  const acoes = h('div', { doc, class: 'lc-pf-acoes' });
  const bt = (a, rotulo, fn) => h('button', { doc, class: 'lc-cp-btn lc-pf-bt', dataset: { a: `pf-${a}` }, on: { click: amb.seguro(ev => fn(st.alvo, ev)) } }, rotulo);
  const btConvidar = bt('convidar', 'convidar', (a, ev) => amb.acoes?.convidar?.(a, ev));
  const btMensagem = bt('mensagem', 'mensagem', (a, ev) => amb.acoes?.mensagem?.(a, ev));
  const btAssistir = bt('assistir', 'assistir', (a, ev) => amb.acoes?.assistir?.(a, ev));
  acoes.append(btConvidar, btMensagem, btAssistir);
  const abaBt = (a, rotulo) => h('button', { doc, class: 'lc-pf-aba', dataset: { a: `pf-aba-${a}` }, on: { click: amb.seguro(() => { st.aba = a; st.jogo = null; pintar(); }) } }, rotulo);
  const abas = h('div', { doc, class: 'lc-pf-abas' }, abaBt('resumo', 'resumo'), abaBt('historico', 'histórico'));
  const corpo = h('div', { doc, class: 'lc-pf-corpo', dataset: { a: 'pf-corpo' } });
  const el = h('div', { doc, class: 'lc-pf', dataset: { a: 'perfil' } }, faixa, acoes, abas, corpo);
  // replay da partida aberta no detalhe: uma linha só (criada uma vez; muda o gameId); só aparece quando a Riot oferece
  const replay = criarReplay({ doc, lcu, gameId: () => (st.detalhe?.replayOk ? st.jogo?.gameId : null), fim: () => false, corpo: () => st.jogo?.replay || {},
    avisar: (m, e) => amb.avisar?.(m, e), vivo: () => !!st.jogo && !!st.detalhe?.replayOk, agora, classe: 'lc-rp' });
  let assinatura = '';

  function pintarAcoes() {
    const a = st.alvo;
    const e = a && !a.eu ? amb.acoes?.estado?.(a) || {} : {};
    const um = (b, m) => { const mostra = !!m?.mostra; b.style.display = mostra ? '' : 'none'; b.disabled = !m?.ok; b.setAttribute('title', m?.motivo || ''); };
    um(btConvidar, e.convidar); um(btMensagem, e.mensagem); um(btAssistir, e.assistir);
    acoes.style.display = a && !a.eu && (e.convidar?.mostra || e.mensagem?.mostra || e.assistir?.mostra) ? '' : 'none';
  }
  function pintarFaixa() {
    const r = st.resumo, a = st.alvo || {};
    faixa.style.backgroundImage = r?.fundo ? `linear-gradient(180deg,rgba(1,10,19,.35),rgba(1,10,19,.92)), url("${r.fundo}")` : '';
    const nome = h('b', { doc }, r ? r.nome : a.nome || 'jogador');
    if (r?.tag) nome.append(h('small', { doc }, `#${r.tag}`));
    const linhas = [nome];
    const sub = [r?.nivel ? `nível ${r.nivel}` : '', r?.titulo || ''].filter(Boolean).join(' · ');
    if (sub) linhas.push(h('div', { doc, class: 'lc-pf-sub' }, sub));
    if (r?.ranques?.length) linhas.push(h('div', { doc, class: 'lc-pf-sub' }, r.ranques.map(q => `${q.fila}: ${q.texto}`).join(' · ')));
    const ems = r?.emblemas?.length ? h('div', { doc, class: 'lc-pf-ems' }, ...r.emblemas.map(e => emblemaEl(doc, e))) : null;
    tirar(faixa, [fotoPerfil(doc, r?.icone, 52, r?.nome || a.nome), h('div', { doc, class: 'lc-pf-id' }, ...linhas, ems)]);
  }
  function pintarResumo() {
    const r = st.resumo;
    if (!r) return [h('div', { doc, class: 'lc-lt-vazio' }, st.motivo || 'carregando…')];
    const filhos = [];
    for (const q of r.ranques) filhos.push(h('div', { doc, class: 'lc-pf-linha' }, h('span', { doc }, q.fila), h('b', { doc }, q.texto), h('small', { doc }, q.vd)));
    if (!r.ranques.length) filhos.push(h('div', { doc, class: 'lc-lt-vazio' }, 'ranque indisponível'));
    if (r.titulo) filhos.push(h('div', { doc, class: 'lc-pf-linha' }, h('span', { doc }, 'título'), h('b', { doc }, r.titulo)));
    for (const e of r.emblemas) filhos.push(h('div', { doc, class: 'lc-pf-linha' }, h('span', { doc }, 'emblema'), h('b', { doc }, e.nome), h('small', { doc }, NIVEL_PT[e.nivel] || e.nivel)));
    if (st.alvo?.status) filhos.push(h('div', { doc, class: 'lc-pf-linha' }, h('span', { doc }, 'agora'), h('b', { doc }, st.alvo.status)));
    return filhos;
  }
  const nomeCampeao = id => st.nomes.get?.(Number(id))?.nome || (id ? `campeão ${id}` : '');
  const fotoCamp = (id, tam = 26) => h('span', { doc, class: 'lc-pf-camp', title: nomeCampeao(id), style: { width: `${tam}px`, height: `${tam}px`, backgroundImage: iconeCampeao(id) ? `url("${iconeCampeao(id)}")` : '' } });
  function pintarHistorico() {
    if (st.jogo) return pintarDetalhe();
    if (!st.linhas) return [h('div', { doc, class: 'lc-lt-vazio' }, st.motivoHist || st.motivo || 'carregando o histórico…')];
    if (!st.linhas.length) return [h('div', { doc, class: 'lc-lt-vazio' }, 'nenhuma partida no histórico')];
    return st.linhas.map(l => h('div', { doc, class: `lc-pf-jogo lc-pf-${l.resultado === 'vitória' ? 'v' : l.resultado === 'derrota' ? 'd' : 'r'}`, dataset: { a: 'pf-jogo', gid: String(l.gameId) },
      role: 'button', tabindex: '0', title: 'ver a partida', on: { click: amb.seguro(() => abrirJogo(l)), keydown: amb.seguro(ev => { if (ev.key === 'Enter') abrirJogo(l); }) } },
    fotoCamp(l.campeao), h('div', { doc, class: 'lc-pf-jnm' }, h('b', { doc }, l.resultado || '—'), h('small', { doc }, [l.fila, l.duracao].filter(Boolean).join(' · '))),
    h('div', { doc, class: 'lc-pf-kda' }, `${l.k}/${l.d}/${l.a}`, h('small', { doc }, l.quando))));
  }
  function pintarDetalhe() {
    const j = st.jogo, d = st.detalhe;
    const volta = h('button', { doc, class: 'lc-pf-volta', dataset: { a: 'pf-voltar' }, on: { click: amb.seguro(() => { st.jogo = null; st.detalhe = null; pintar(); }) } }, comIcone('voltar', 'partidas', { doc, tam: 12 }));
    const cab = h('div', { doc, class: 'lc-pf-dcab' }, volta, h('small', { doc }, [j.fila, j.duracao, j.quando].filter(Boolean).join(' · ')));
    if (!d) return [cab, h('div', { doc, class: 'lc-lt-vazio' }, 'carregando a partida…')];
    if (d.motivo) return [cab, h('div', { doc, class: 'lc-lt-vazio' }, d.motivo)];
    const times = d.times.map(t => h('div', { doc, class: 'lc-pf-time' }, h('div', { doc, class: 'lc-cp-rot' }, `${t.id === 100 ? 'time azul' : t.id === 200 ? 'time vermelho' : 'time'} · ${t.vitoria ? 'vitória' : 'derrota'}`),
      ...t.jogadores.map(p => h('div', { doc, class: 'lc-pf-jog' + (p.dono ? ' lc-pf-dono' : '') }, fotoCamp(p.campeao, 20), h('span', { doc }, p.nome || nomeCampeao(p.campeao)), h('small', { doc }, `${p.k}/${p.d}/${p.a}`)))));
    const rp = d.replayOk ? replay.el : h('div', { doc, class: 'lc-pf-nota' }, d.replayMotivo || '');
    return [cab, rp, ...times];
  }
  function pintar() {
    for (const b of abas.children) b.classList.toggle('lc-pf-on', b.dataset.a === `pf-aba-${st.aba}`);
    pintarFaixa();
    pintarAcoes();
    const sig = JSON.stringify([st.alvo?.puuid, st.aba, st.motivo, st.motivoHist, st.resumo, st.linhas?.length, st.jogo?.gameId, st.detalhe ? [st.detalhe.motivo, st.detalhe.replayOk, st.detalhe.times?.length] : null, st.nomes.size]);
    if (sig === assinatura) return;
    assinatura = sig;
    let topo = 0;
    try { topo = corpo.scrollTop || 0; } catch { /* sem layout */ }
    tirar(corpo, st.aba === 'historico' ? pintarHistorico() : pintarResumo());
    try { corpo.scrollTop = st.jogo ? 0 : topo; } catch { /* sem layout */ }
  }
  // abre o perfil (clique dele em "Exibir perfil", na foto do amigo ou no atalho "histórico" do editor): só GET
  async function abrir(alvo, { aba = 'resumo' } = {}) {
    const vez = ++st.lendo;
    st.alvo = alvo; st.aba = aba; st.resumo = null; st.linhas = null; st.motivo = ''; st.motivoHist = ''; st.privado = false; st.jogo = null; st.detalhe = null; assinatura = '';
    pintar();
    if (!alvo?.puuid) { st.motivo = 'jogador sem identificação: abra o perfil pelo client normal'; pintar(); return; }
    amb.campeoes?.().then(m => { if (m?.size) { st.nomes = m; if (vez === st.lendo) pintar(); } }).catch(() => {});
    if (!alvo.eu && Number(alvo.summonerId) > 0) {
      const p = await lcu('GET', ROTAS_PERFIL.privacidade);
      if (vez !== st.lendo) return;
      if (p.ok && p.json === 'ENABLED') {
        const s = await lcu('GET', ROTAS_PERFIL.invocadorId(alvo.summonerId));
        if (vez !== st.lendo) return;
        if (s.ok && perfilPrivado(p.json, s.json)) { st.privado = true; st.motivo = 'perfil privado: este jogador não mostra o perfil'; st.linhas = []; pintar(); return; }
      }
    }
    const [inv, rk, fd, ds, hi, cr] = await Promise.all([lcu('GET', ROTAS_PERFIL.invocador(alvo.puuid)), lcu('GET', ROTAS_PERFIL.ranque(alvo.puuid)),
      Number(alvo.summonerId) > 0 ? lcu('GET', ROTAS_PERFIL.fundo(alvo.summonerId)) : Promise.resolve({ ok: false, status: 0 }),
      lcu('GET', alvo.eu ? ROTAS_PERFIL.resumoDesafios : ROTAS_PERFIL.desafiosDe(alvo.puuid)), lcu('GET', ROTAS_PERFIL.historico(alvo.puuid)), lcu('GET', ROTAS_PERFIL.replays)]);
    if (vez !== st.lendo) return;
    st.resumo = resumoJogador({ invocador: inv.ok ? inv.json : null, ranque: rk.ok ? rk.json : null, desafios: ds.ok ? ds.json : null, fundo: fd.ok ? fd.json : null, alvo });
    if (!inv.ok && !rk.ok) st.motivo = `não foi possível ler o perfil (${inv.status})`;
    st.cfgReplays = cr.ok && cr.json && typeof cr.json === 'object' ? cr.json : {};
    // 404 = sem partidas (como a Riot: _loadFriendData não mostra erro no 404); outro erro = motivo com o status
    st.linhas = hi.ok ? linhasHistorico(hi.json, { puuid: alvo.puuid, agoraMs: agora() }) : hi.status === 404 ? [] : null;
    if (!hi.ok && hi.status !== 404) st.motivoHist = `não foi possível ler o histórico (${hi.status})`;
    pintar();
  }
  async function abrirJogo(l) {
    const vez = st.lendo;
    st.jogo = l; st.detalhe = null; pintar();
    const r = await lcu('GET', ROTAS_PERFIL.jogo(l.gameId));
    if (vez !== st.lendo || st.jogo !== l) return;
    const terceiro = !st.alvo?.eu;
    const replayOk = replayOferecido(st.cfgReplays, l.queueId, { terceiro });
    st.detalhe = r.ok ? { ...detalheJogo(r.json, st.alvo?.puuid), replayOk, replayMotivo: replayOk ? '' : 'replay: a Riot não oferece o replay da partida de outro jogador' }
      : { motivo: `não foi possível ler a partida (${r.status})`, replayOk: false };
    pintar();
    if (replayOk) replay.ler().catch(() => {});
  }
  return {
    el, abrir, pintar,
    // relógio da lateral (1,5 s): só o replay do detalhe se atualiza (estado do download); as ações seguem o estado do amigo
    relogio() { pintarAcoes(); if (st.jogo && st.detalhe?.replayOk) replay.ler().catch(() => {}); },
    fechar() { st.lendo++; st.alvo = null; st.jogo = null; st.detalhe = null; },
    estado: () => ({ alvo: st.alvo ? { ...st.alvo } : null, aba: st.aba, privado: st.privado, linhas: st.linhas?.length ?? null, jogo: st.jogo?.gameId ?? null,
      replayOk: !!st.detalhe?.replayOk, motivo: st.motivo, resumo: st.resumo }),
  };
}

// Editor do meu perfil (painel da esquerda). amb = {doc, lcu, seguro, avisar, aoFechar(), aoHistorico(alvo, ev), agora()}
// -> {el, abrir(), salvar(ev), estado(), fechar()}. Escolher só muda a prévia; "salvar" (clique dele) manda chamadasSalvar
const ABAS_EDITOR = [['icone', 'ícone'], ['moldura', 'moldura'], ['bandeira', 'bandeira'], ['emblemas', 'emblemas'], ['titulo', 'título']];
export const DESCARTAR_MS = 4000;
let catalogoIcones = null; // summoner-icons.json (grande): lido na 1ª vez que a aba ícone abre, guardado para a carga da página
export const _zerarCatalogoIcones = () => { catalogoIcones = null; }; // só teste
export function criarEditorView(amb) {
  const { doc, lcu } = amb;
  const agora = () => (typeof amb.agora === 'function' ? amb.agora() : Date.now());
  const st = { aba: 'icone', dados: null, inicial: null, sel: null, motivo: '', posicao: 0, filtro: '', salvando: false, descartarEm: 0, lendo: 0, iconeAtual: null, aceitos: {} };
  const previa = h('div', { doc, class: 'lc-pf-previa', dataset: { a: 'ed-previa' } });
  const abas = h('div', { doc, class: 'lc-pf-abas' }, ...ABAS_EDITOR.map(([a, r]) => h('button', { doc, class: 'lc-pf-aba', dataset: { a: `ed-aba-${a}` },
    on: { click: amb.seguro(() => { st.aba = a; st.filtro = ''; busca.value = ''; if (a === 'icone') lerCatalogo(); pintar(); }) } }, r)));
  const busca = h('input', { doc, class: 'lc-lt-busca', placeholder: 'buscar', autocomplete: 'off', spellcheck: 'false', dataset: { a: 'ed-busca' } });
  busca.addEventListener('input', () => { st.filtro = String(busca.value || '').trim().toLocaleLowerCase('pt-BR'); pintarCorpo(); });
  busca.addEventListener('keydown', e => e.stopPropagation?.());
  const buscaCx = h('div', { doc, class: 'lc-lt-buscacx' }, busca);
  const corpo = h('div', { doc, class: 'lc-pf-corpo lc-pf-grade', dataset: { a: 'ed-corpo' } });
  const nota = h('small', { doc, class: 'lc-pf-nota', dataset: { a: 'ed-nota' } }, '');
  const btSalvar = h('button', { doc, class: 'lc-cp-btn lc-cp-prim', dataset: { a: 'ed-salvar' }, on: { click: amb.seguro(ev => salvar(ev)) } }, 'salvar');
  const btHist = h('button', { doc, class: 'lc-cp-btn', dataset: { a: 'ed-historico' }, title: 'abrir o seu histórico ao lado', on: { click: amb.seguro(ev => {
    const e = st.dados?.eu;
    if (e?.puuid) amb.aoHistorico?.({ puuid: e.puuid, summonerId: e.summonerId, nome: e.gameName || 'você', tag: e.tagLine || '', eu: true }, ev);
  }) } }, 'histórico');
  const xFechar = h('button', { doc, class: 'lc-lt-x', title: 'fechar o editor', 'aria-label': 'fechar o editor', dataset: { a: 'ed-fechar' }, on: { click: amb.seguro(ev => fechar(ev)) } },
    icone('fechar', { doc, tam: 14 }));
  const el = h('section', { doc, class: 'lc-lt-pn lc-lt-cfg lc-pf-editor', dataset: { painel: 'editor' } },
    h('header', { doc, class: 'lc-lt-cab' }, h('div', { doc, class: 'lc-lt-tit' }, h('b', { doc }, 'seu perfil'), h('small', { doc }, 'escolha e clique em salvar')), xFechar),
    previa, abas, buscaCx, corpo, h('footer', { doc, class: 'lc-lt-rod lc-pf-rod' }, h('div', { doc, class: 'lc-pf-bts' }, btSalvar, btHist), nota));

  const pendentes = () => (st.sel && st.inicial ? chamadasSalvar(st.inicial, st.sel, { iconeAtual: st.iconeAtual, destaqueBandeira: st.dados?.destaque !== false, aceitos: st.aceitos }) : []);
  function pintarRodape() {
    const p = pendentes();
    btSalvar.disabled = !p.length || st.salvando;
    btSalvar.textContent = st.salvando ? 'salvando…' : 'salvar';
    btSalvar.setAttribute('title', p.length ? `salvar: ${p.map(c => c.parte).join(', ')}` : 'nenhuma mudança');
    const t = st.descartarEm && agora() - st.descartarEm < DESCARTAR_MS ? 'mudanças não salvas: clique em fechar de novo para descartar'
      : p.length ? `${p.length === 1 ? '1 alteração' : `${p.length} alterações`} por salvar` : st.motivo || '';
    if (nota.textContent !== t) nota.textContent = t;
  }
  const titulosPorId = () => new Map((st.dados?.titulos || []).map(t => [t.itemId, t.name]));
  const emblemaDe = id => (st.dados?.emblemas || []).find(e => e.id === Number(id)) || null;
  function pintarPrevia() {
    const s = st.sel;
    if (!s) { tirar(previa, [h('small', { doc, class: 'lc-pf-nota' }, st.motivo || 'carregando…')]); return; }
    const mold = opcoesMolduras({ nivel: st.dados.eu?.summonerLevel, filas: st.dados.filas, maiorRanque: st.dados.regalia?.highestRankedEntry, sel: s }).find(o => o.marcada);
    const band = opcoesBandeiras({ ultimaTemporada: st.dados.regalia?.lastSeasonHighestRank, sel: s }).find(o => o.marcada);
    const titulo = s.title && Number(s.title.itemId) >= 0 ? s.title.name || titulosPorId().get(Number(s.title.itemId)) || '' : '';
    const slots = [0, 1, 2].map(i => {
      const e = s.tokens?.[i] !== undefined ? emblemaDe(s.tokens[i]) || { id: s.tokens[i], nome: `desafio ${s.tokens[i]}`, nivel: '', icone: '' } : null;
      return emblemaEl(doc, e, { vazio: !e, attrs: { role: 'button', tabindex: '0', dataset: { a: 'ed-posicao', pos: String(i) }, class: 'lc-pf-em' + (!e ? ' lc-pf-vazio' : '') + (st.aba === 'emblemas' && st.posicao === i ? ' lc-pf-on' : ''),
        on: { click: amb.seguro(() => { st.posicao = i; st.aba = 'emblemas'; pintar(); }) } } });
    });
    tirar(previa, [fotoPerfil(doc, s.iconId, 52, st.dados.eu?.gameName),
      h('div', { doc, class: 'lc-pf-id' }, h('b', { doc }, st.dados.eu?.gameName || 'você'), h('div', { doc, class: 'lc-pf-sub' }, `moldura: ${mold?.rotulo || '—'} · bandeira: ${band?.rotulo || '—'}`),
        h('div', { doc, class: 'lc-pf-sub' }, titulo ? `título: ${titulo}` : 'sem título'), h('div', { doc, class: 'lc-pf-ems' }, ...slots))]);
  }
  const casa = t => !st.filtro || String(t).toLocaleLowerCase('pt-BR').includes(st.filtro);
  const opcao = (a, chave, rotulo, { marcada, off, motivo, foto, fn }) => h('button', { doc, class: 'lc-pf-op' + (marcada ? ' lc-pf-on' : '') + (off ? ' lc-pf-off' : ''), dataset: { a: `ed-${a}`, k: String(chave) },
    title: off ? motivo || '' : rotulo, disabled: off ? true : undefined, on: { click: amb.seguro(fn) } }, foto || null, h('span', { doc }, rotulo));
  function pintarCorpo() {
    const s = st.sel, d = st.dados;
    corpo.classList.toggle('lc-pf-icones', st.aba === 'icone');
    buscaCx.style.display = ['icone', 'emblemas', 'titulo'].includes(st.aba) && s ? '' : 'none';
    if (!s) { tirar(corpo, [h('div', { doc, class: 'lc-lt-vazio' }, st.motivo || 'carregando…')]); return; }
    let filhos = [];
    if (st.aba === 'icone') {
      filhos = opcoesIcones(d.icones, catalogoIcones).filter(i => casa(i.id) || casa(i.nome)).slice(0, 400).map(i => h('button', { doc, class: 'lc-pf-ico' + (s.iconId === i.id ? ' lc-pf-on' : ''),
        dataset: { a: 'ed-icone', k: String(i.id) }, title: i.nome ? `${i.nome} (${i.id})` : `ícone ${i.id}`, style: { backgroundImage: `url("${iconePerfil(i.id)}")` },
        on: { click: amb.seguro(() => { st.sel = escolherIcone(st.sel, i.id); pintar(); }) } }));
      if (!d.icones) filhos = [h('div', { doc, class: 'lc-lt-vazio' }, 'não foi possível ler os seus ícones')];
    } else if (st.aba === 'moldura') {
      filhos = opcoesMolduras({ nivel: d.eu?.summonerLevel, filas: d.filas, maiorRanque: d.regalia?.highestRankedEntry, sel: s })
        .map(o => opcao('moldura', o.chave, o.rotulo, { ...o, fn: () => { st.sel = escolherMoldura(st.sel, o); pintar(); } }));
    } else if (st.aba === 'bandeira') {
      filhos = opcoesBandeiras({ ultimaTemporada: d.regalia?.lastSeasonHighestRank, sel: s })
        .map(o => opcao('bandeira', o.chave, o.rotulo, { ...o, fn: () => { st.sel = escolherBandeira(st.sel, o); pintar(); } }));
    } else if (st.aba === 'emblemas') {
      filhos = [h('div', { doc, class: 'lc-pf-nota lc-pf-larga' }, `posição ${st.posicao + 1} de ${MAX_EMBLEMAS}: clique num emblema para pôr nela (troque a posição na prévia)`),
        ...(d.emblemas || []).filter(e => casa(e.nome)).map(e => opcao('emblema', e.id, `${e.nome} · ${NIVEL_PT[e.nivel] || e.nivel}`, {
          // marcado em qualquer posição (isAssigned da Riot): o clique nele não faz nada (escolherEmblema)
          marcada: (s.tokens || []).includes(e.id), foto: emblemaEl(doc, e), fn: () => { st.sel = escolherEmblema(st.sel, st.posicao, e); pintar(); } }))];
      if (!d.emblemas?.length) filhos.push(h('div', { doc, class: 'lc-lt-vazio' }, d.desafiosOk ? 'nenhum desafio com nível ainda' : 'não foi possível ler os desafios'));
    } else if (st.aba === 'titulo') {
      filhos = (d.titulos || []).filter(t => casa(t.name)).map(t => opcao('titulo', t.itemId, t.name, { marcada: Number(s.title?.itemId) === t.itemId,
        fn: () => { st.sel = escolherTitulo(st.sel, t); pintar(); } }));
      if (!d.titulos?.length) filhos.push(h('div', { doc, class: 'lc-lt-vazio' }, d.titulosOk ? 'nenhum título liberado' : 'não foi possível ler os títulos'));
    }
    if (!filhos.length) filhos = [h('div', { doc, class: 'lc-lt-vazio' }, 'nada com esse texto')];
    let topo = 0;
    try { topo = corpo.scrollTop || 0; } catch { /* sem layout */ }
    tirar(corpo, filhos);
    try { corpo.scrollTop = topo; } catch { /* sem layout */ }
  }
  function pintar() {
    for (const b of abas.children) b.classList.toggle('lc-pf-on', b.dataset.a === `ed-aba-${st.aba}`);
    pintarPrevia(); pintarCorpo(); pintarRodape();
  }
  async function lerCatalogo() {
    if (catalogoIcones) return;
    const r = await lcu('GET', ROTAS_PERFIL.catalogoIcones);
    if (r.ok && Array.isArray(r.json)) { catalogoIcones = r.json.map(c => ({ id: c?.id, title: c?.title })); pintarCorpo(); }
  }
  // lê tudo (só GET) e recomeça a escolha do que está salvo; pendências de antes se perdem (abrir de novo = descartou)
  async function abrir() {
    const vez = ++st.lendo;
    st.sel = null; st.inicial = null; st.dados = null; st.motivo = ''; st.descartarEm = 0; st.posicao = 0; st.aceitos = {};
    pintar();
    const [eu, rg, sm, ds, tt, ic, dq] = await Promise.all([lcu('GET', ROTAS_PERFIL.eu), lcu('GET', ROTAS_PERFIL.regalia), lcu('GET', ROTAS_PERFIL.resumoDesafios),
      lcu('GET', ROTAS_PERFIL.desafios), lcu('GET', ROTAS_PERFIL.titulos), lcu('GET', ROTAS_PERFIL.icones), lcu('GET', ROTAS_PERFIL.destaqueBandeira)]);
    if (vez !== st.lendo) return;
    if (!eu.ok || !eu.json || !rg.ok || !rg.json || !sm.ok || !sm.json) {
      st.motivo = `não foi possível ler o seu perfil (${[eu, rg, sm].find(x => !x.ok)?.status ?? 'resposta vazia'}): use o client normal`;
      pintar(); return;
    }
    const rk = eu.json.puuid ? await lcu('GET', ROTAS_PERFIL.ranque(eu.json.puuid)) : { ok: false };
    if (vez !== st.lendo) return;
    st.dados = { eu: eu.json, regalia: rg.json, resumo: sm.json, filas: rk.ok && Array.isArray(rk.json?.queues) ? rk.json.queues : [],
      emblemas: ds.ok ? opcoesEmblemas(ds.json) : [], desafiosOk: ds.ok, titulos: tt.ok ? opcoesTitulos(tt.json) : [], titulosOk: tt.ok, icones: ic.ok && Array.isArray(ic.json) ? ic.json : null,
      // destaque de bandeira: platformConfig Regalia/BannerSkinsEnabled com default true na Riot (404 = true; só false explícito desliga)
      destaque: !(dq.ok && dq.json === false) };
    st.iconeAtual = Number.isInteger(eu.json.profileIconId) ? eu.json.profileIconId : null;
    st.inicial = selecaoInicial({ eu: eu.json, regalia: rg.json, resumo: sm.json });
    st.sel = { ...st.inicial, tokens: [...st.inicial.tokens] };
    pintar();
    if (st.aba === 'icone') lerCatalogo().catch(() => {});
  }
  // "salvar" (só o clique dele): as chamadas que mudaram, uma por vez; a que falhou fica pendente e avisa com o status
  async function salvar(ev) {
    if (!ev || ev.isTrusted === false || st.salvando || !st.sel) return;
    const chamadas = pendentes();
    if (!chamadas.length) return;
    st.salvando = true; pintarRodape();
    const falhas = [];
    try {
      for (const c of chamadas) {
        const r = await lcu(c.metodo, c.rota, c.corpo);
        if (!r.ok) { falhas.push(`${c.parte} (${r.status})`); continue; }
        // o corpo que a Riot aceitou vira a referência DESSA chamada (a pendência dela some; a das outras fica)
        if (c.rota === ROTAS_PERFIL.salvarIcone) { st.iconeAtual = c.corpo.profileIconId; perfilSalvo.icone = c.corpo.profileIconId; perfilSalvo.em = agora(); }
        else if (c.rota === ROTAS_PERFIL.salvarRegalia) st.aceitos = { ...st.aceitos, regalia: c.corpo };
        else st.aceitos = { ...st.aceitos, prefs: c.corpo };
      }
    } finally { st.salvando = false; }
    if (falhas.length) amb.avisar?.(`não foi possível salvar: ${falhas.join(', ')}`, true);
    else amb.avisar?.('perfil salvo');
    pintar();
  }
  // ✕: sem pendências fecha; com pendências, o 1º clique avisa e o 2º (em até DESCARTAR_MS) descarta. Nada é salvo ao fechar
  function fechar() {
    if (pendentes().length && !(st.descartarEm && agora() - st.descartarEm < DESCARTAR_MS)) { st.descartarEm = agora(); pintarRodape(); return false; }
    st.lendo++; st.descartarEm = 0;
    amb.aoFechar?.();
    return true;
  }
  return { el, abrir, salvar, fechar, pintar, pendentes,
    estado: () => ({ aba: st.aba, sel: st.sel ? JSON.parse(JSON.stringify(st.sel)) : null, inicial: st.inicial, motivo: st.motivo, pendentes: pendentes().map(c => c.rota), salvando: st.salvando, posicao: st.posicao }) };
}

export const CSS_PERFIL = `
#lc-compacto .lc-pf { flex:1; min-height:0; display:flex; flex-direction:column; }
#lc-compacto .lc-pf-faixa { flex:none; display:flex; gap:10px; align-items:center; padding:14px 12px 12px; background:#0b1520 center/cover no-repeat;
  border-bottom:1px solid var(--lc-linha2); min-height:92px; }
#lc-compacto .lc-pf-ic { display:inline-grid; place-items:center; flex:none; border-radius:50%; border:2px solid var(--lc-ouro); background:#151b22 center/cover no-repeat;
  color:var(--lc-ouro2); font-weight:700; }
#lc-compacto .lc-pf-id { min-width:0; display:flex; flex-direction:column; gap:2px; line-height:1.25; }
#lc-compacto .lc-pf-id b { color:var(--lc-ouro2); font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#lc-compacto .lc-pf-id b small { color:var(--lc-mudo); font-weight:400; font-size:12px; margin-left:2px; }
#lc-compacto .lc-pf-sub { color:#d8d0bd; font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
#lc-compacto .lc-pf-ems { display:flex; gap:5px; margin-top:3px; }
#lc-compacto .lc-pf-em { width:26px; height:26px; flex:none; display:inline-grid; place-items:center; border-radius:4px; background:#151b22 center/contain no-repeat;
  border:1px solid var(--lc-ouro-esc); color:var(--lc-mudo); font-size:10px; cursor:default; }
#lc-compacto .lc-pf-previa .lc-pf-em { cursor:pointer; }
#lc-compacto .lc-pf-em.lc-pf-vazio { border-style:dashed; }
#lc-compacto .lc-pf-em.lc-pf-on { border-color:var(--lc-azul); box-shadow:0 0 0 1px var(--lc-azul) inset; }
#lc-compacto .lc-pf-acoes { flex:none; display:flex; gap:6px; padding:8px 10px; border-bottom:1px solid var(--lc-linha2); }
#lc-compacto .lc-pf-bt { flex:1; padding:5px 8px; font-size:12px; }
#lc-compacto .lc-pf-abas { flex:none; display:flex; border-bottom:1px solid var(--lc-linha2); }
#lc-compacto .lc-pf-aba { flex:1; background:none; border:none; border-bottom:2px solid transparent; color:var(--lc-mudo); font:inherit; font-size:12px; padding:7px 4px; cursor:pointer; }
#lc-compacto .lc-pf-aba.lc-pf-on { color:var(--lc-ouro2); border-bottom-color:var(--lc-ouro); }
#lc-compacto .lc-pf-corpo { flex:1; min-height:0; overflow:auto; padding:6px 0 10px; }
#lc-compacto .lc-pf-linha { display:grid; grid-template-columns:76px 1fr auto; gap:8px; align-items:baseline; padding:6px 12px; font-size:12.5px; border-bottom:1px solid rgba(60,60,65,.4); }
#lc-compacto .lc-pf-linha span { color:var(--lc-mudo); font-size:11px; } #lc-compacto .lc-pf-linha b { color:var(--lc-ouro2); font-weight:600; }
#lc-compacto .lc-pf-linha small { color:var(--lc-mudo); font-size:11px; }
#lc-compacto .lc-pf-jogo { display:grid; grid-template-columns:28px 1fr auto; gap:8px; align-items:center; padding:5px 12px; cursor:pointer; border-left:3px solid transparent; }
#lc-compacto .lc-pf-jogo:hover { background:rgba(255,255,255,.03); }
#lc-compacto .lc-pf-jogo.lc-pf-v { border-left-color:#3fbf77; } #lc-compacto .lc-pf-jogo.lc-pf-d { border-left-color:var(--lc-verm); } #lc-compacto .lc-pf-jogo.lc-pf-r { border-left-color:var(--lc-mudo); }
#lc-compacto .lc-pf-jnm { min-width:0; line-height:1.2; } #lc-compacto .lc-pf-jnm b { color:var(--lc-ouro2); font-size:12.5px; font-weight:600; }
#lc-compacto .lc-pf-jnm small, #lc-compacto .lc-pf-kda small { display:block; color:var(--lc-mudo); font-size:11px; }
#lc-compacto .lc-pf-kda { text-align:right; color:#e8e2d0; font-size:12.5px; line-height:1.2; }
#lc-compacto .lc-pf-camp { display:inline-block; flex:none; border-radius:50%; background:#151b22 center/cover no-repeat; border:1px solid var(--lc-ouro-esc); }
#lc-compacto .lc-pf-dcab { display:flex; justify-content:space-between; align-items:center; padding:2px 12px 6px; }
#lc-compacto .lc-pf-dcab small { color:var(--lc-mudo); font-size:11px; }
#lc-compacto .lc-pf-volta { background:none; border:none; color:var(--lc-ouro); font:inherit; font-size:12px; cursor:pointer; padding:4px 0; }
#lc-compacto .lc-pf .lc-rp { padding:4px 12px 8px; }
#lc-compacto .lc-pf-time { padding:4px 12px 6px; }
#lc-compacto .lc-pf-jog { display:grid; grid-template-columns:22px 1fr auto; gap:6px; align-items:center; padding:2px 0; font-size:12px; color:#e8e2d0; }
#lc-compacto .lc-pf-jog span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } #lc-compacto .lc-pf-jog small { color:var(--lc-mudo); font-size:11px; }
#lc-compacto .lc-pf-jog.lc-pf-dono span { color:var(--lc-ouro2); font-weight:600; }
#lc-compacto .lc-pf-nota { color:var(--lc-mudo); font-size:11px; padding:4px 12px; }
#lc-compacto .lc-pf-previa { flex:none; display:flex; gap:10px; align-items:center; padding:10px 12px; border-bottom:1px solid var(--lc-linha2); }
#lc-compacto .lc-pf-grade { display:flex; flex-wrap:wrap; align-content:flex-start; gap:6px; padding:8px 10px 10px; }
#lc-compacto .lc-pf-larga { flex:0 0 100%; padding:0 2px 2px; }
#lc-compacto .lc-pf-ico { width:48px; height:48px; flex:none; border:1px solid var(--lc-linha); border-radius:4px; background:#151b22 center/cover no-repeat; cursor:pointer; padding:0; }
#lc-compacto .lc-pf-ico:hover { border-color:var(--lc-ouro); }
#lc-compacto .lc-pf-ico.lc-pf-on, #lc-compacto .lc-pf-op.lc-pf-on { border-color:var(--lc-azul); box-shadow:0 0 0 1px var(--lc-azul) inset; }
#lc-compacto .lc-pf-op { flex:0 0 100%; display:flex; gap:8px; align-items:center; text-align:left; padding:7px 9px; background:var(--lc-pan2); border:1px solid var(--lc-linha);
  color:var(--lc-ouro2); font:inherit; font-size:12px; cursor:pointer; }
#lc-compacto .lc-pf-op:hover { border-color:var(--lc-ouro); }
#lc-compacto .lc-pf-op.lc-pf-off { color:#6b6f76; cursor:not-allowed; }
#lc-compacto .lc-pf-rod .lc-pf-bts { display:flex; gap:6px; } #lc-compacto .lc-pf-rod .lc-pf-bts .lc-cp-btn { flex:1; padding:6px 8px; }
#lc-compacto .lc-pf-rod .lc-pf-nota { padding:2px 0 0; min-height:15px; }
#lc-compacto [data-a="lt-foto"] { cursor:pointer; } #lc-compacto [data-a="lt-foto"]:hover { border-color:var(--lc-ouro); }
#lc-compacto .lc-cp-avbt { display:flex; flex:none; padding:0; border:none; background:none; border-radius:50%; cursor:pointer; }
#lc-compacto .lc-cp-avbt:hover .lc-cp-av { border-color:var(--lc-ouro2); box-shadow:0 0 0 2px rgba(200,170,110,.35); }
`;
