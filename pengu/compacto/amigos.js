// Amigos do compacto: grupos como no client da Riot, menu do clique direito, convite e o que cada clique escreve (etapa 2 de
// roadmap/2026-10-16-compacto-chat-amigos-perfil.md; pedido do Gabriel de 16/10/2026: "os grupos da lista de amigos aparecem no
// topo [...] tenho que conseguir reordenar dentre os grupos existentes (criados + geral). Tem que funcionar da mesma maneira que
// ocorre no modo expandido"; "no clique do direito, nos usuários, também tem que ter as mesmas opções"; "arrastar essa pessoa
// para dentro da janela principal do modo compacto para [...] o meu lobby, caso o lobby já esteja criado").
// Só funções puras (tools/teste-compacto-amigos.mjs): quem lê, desenha e escreve é compacto/lateral.js (+ amigos-menu.js).
//
// Tudo lido no front da Riot 16.20 (rcp-fe-lol-social 34f2d9061fb95af6.js, roster v2 em Ember; rcp-fe-lol-parties
// 63033b1005ac2ae0.js; rcp-fe-lol-profiles 3e7da685a8f3eb46.js; `python tools/ler-wad.py`), NUNCA enviado ao client real:
// - grupos: serviço "friend-groups" (_calculateFriendGroups: _groupSort = priority decrescente, empate pelo nome), roster
//   (_generateRosterModel: amigos por displayGroupId, grupo desconhecido vai para o 0), recolher = toggleCollapse do
//   lol-social-roster-group (saveGroupCollapsed({...grupo, collapsed: !collapsed}) = PUT /lol-chat/v1/friend-groups/{id}),
//   reordenar = moveGroup + saveGroupOrder (priority = length − índice; PUT só nos não meta que mudaram), criar = createGroup
//   (POST {name, priority: max+1}), renomear = saveGroup (PUT do grupo com o nome novo), excluir = deleteGroup (DELETE), nome
//   validado por validateGroupName.
// - amigo: contextMenuModel do lol-social-roster-member (ordem e critérios de some/cinza), setGroup (PUT /lol-chat/v1/friends/
//   {id} com o amigo inteiro e groupId novo), saveNote (updateFriend({...amigo, note})), tryRemoveOrBlockFriend +
//   confirmUnfriendOrBlockFriendHelper (DELETE /lol-chat/v1/friends/{id} | POST /lol-chat/v1/blocked-players {summonerId,
//   puuid}), confirmReportFriendForAbusiveTextHelper (POST /lol-player-report-sender/v1/direct-message-reports {offenderPuuid}),
//   spectateGame (POST /lol-spectator/v1/spectate/launch), canInviteToGame (_availableForGame + parties.canInvitePlayer) e o
//   invitePlayer do parties (checkIfPlayerAvailable: só amigo "chat"/"away" no mesmo jogo e servidor).
import { statusAmigo } from './lateral-chat.js';

// ---------- textos da Riot (trans.json pt-BR do rcp-fe-lol-social, b6fd06e0027281c0.bin; exceção nomeada em teste-textos) ----------
export const TEXTOS_RIOT = {
  convidar: 'Convidar para partida', mensagem: 'Enviar mensagem', assistir: 'Assistir partida', perfil: 'Exibir perfil',
  notaNova: 'Adicionar anotação', notaEditar: 'Editar anotação', mover: 'Mover', remover: 'Desfazer amizade/Bloquear', denunciar: 'Denunciar',
  renomearPasta: 'Renomear pasta', excluirPasta: 'Excluir pasta', nomePasta: 'Nome da pasta',
  removerTitulo: 'Desfazer amizade/Bloquear jogador',
  removerTexto: 'Desfazer a amizade com {{name}} remove o usuário da sua lista de amigos e o impede de entrar em contato com você. Também bloqueia convites de jogo e solicitações de amizade futuras.',
  removerSim: 'Desfazer amizade', bloquear: 'Bloquear', tambemDenunciar: 'Também denunciar',
  denunciaTitulo: 'Denunciar jogador',
  denunciaTexto: 'Denunciar {{name}} enviará esta conversa para análise da nossa equipe de moderação. Sua denúncia é confidencial, e tomaremos as medidas cabíveis caso nossas políticas tenham sido violadas.',
  tambemBloquear: 'Também bloquear', cancelar: 'Cancelar',
  denunciaEnviada: 'Agradecemos sua denúncia de {{player}}. Analisaremos a conversa enviada em breve.',
  denunciaFalhou: 'Falha ao enviar a denúncia de {{player}}. Tente novamente mais tarde.',
  jaDenunciado: 'Denúncia enviada', semMensagem: 'A denúncia ficará disponível depois que esta pessoa enviar uma mensagem para você.',
  espectadorFila: 'Este tipo de partida não pode ser assistida agora.', espectadorPersonalizada: 'A partida personalizada está indisponível para ser assistida.',
  pastaVazia: 'Nome da pasta não pode ser em branco', pastaExiste: 'Nome da pasta já existente', pastaReservada: 'Escolha um nome de pasta diferente',
};
// rótulos dos grupos (group_label_*): "**Default" é o Geral (não é meta, medido em 16/10/2026); meta pelo nome em minúsculas
export const ROTULOS_GRUPO = { default: 'Geral', mobile: 'Riot Mobile', offline: 'Offline', discord: 'Amigos do Discord', other: 'Outros jogos', other_shards: 'Outros servidores' };
const RESERVADOS = ['Riot Mobile', 'Amigos do Discord', 'Offline', 'Outros servidores', 'Outros jogos'];
export const comNome = (modelo, nome, chave = 'name') => String(modelo).replace(`{{${chave}}}`, String(nome ?? ''));

export const ROTAS = {
  grupos: '/lol-chat/v1/friend-groups', grupo: id => `/lol-chat/v1/friend-groups/${encodeURIComponent(id)}`,
  amigo: id => `/lol-chat/v1/friends/${encodeURIComponent(id)}`, bloqueados: '/lol-chat/v1/blocked-players',
  convite: '/lol-lobby/v2/lobby/invitations', espectar: '/lol-spectator/v1/spectate/launch',
  podeAssistir: (puuid, chave) => `/lol-spectator/v3/buddy/can-spectate/${puuid}/${encodeURIComponent(chave)}`,
  denuncias: '/lol-player-report-sender/v1/direct-message-reports',
  denunciaLigada: '/lol-client-config/v3/client-config/lol.client_settings.dm_reporting.enabled',
  privacidade: '/lol-summoner/v1/profile-privacy-enabled', invocador: id => `/lol-summoner/v1/summoners/${encodeURIComponent(id)}`,
};

// ---------- grupos ----------
const ehDefault = g => String(g?.name || '').toUpperCase() === '**DEFAULT';
export function rotuloGrupo(g) {
  if (ehDefault(g)) return ROTULOS_GRUPO.default;
  const n = String(g?.name || '');
  if (g?.isMetaGroup) return ROTULOS_GRUPO[n.toLowerCase().replace(/^\*+/, '')] || n;
  return n;
}
// _groupSort do serviço friend-groups (prioridade maior primeiro; empate: nome em minúsculas)
export const cmpGrupo = (a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0) || (String(a.name).toLowerCase() < String(b.name).toLowerCase() ? -1 : 1);
// GET /lol-chat/v1/friend-groups -> grupos na ordem da Riot (cópia de cada objeto COMO LIDO: é o corpo dos PUTs) | null
export function ordenarGrupos(lista) {
  if (!Array.isArray(lista)) return null;
  const vistos = new Set();
  const gs = [];
  for (const g of lista) {
    if (!g || typeof g !== 'object' || !Number.isFinite(Number(g.id)) || typeof g.name !== 'string' || vistos.has(Number(g.id))) continue;
    vistos.add(Number(g.id));
    gs.push({ ...g });
  }
  return gs.sort(cmpGrupo);
}
export const naoMeta = gs => (gs || []).filter(g => !g.isMetaGroup && !g.virtual);

// itens de verAmigos (com grupoId = displayGroupId) + grupos ordenados -> [{id, rotulo, meta, padrao, recolhido, virtual, cru,
// amigos, online, total}]. Amigo num grupo desconhecido vai para o Geral (id 0); sem o 0 na lista, um Geral só local (virtual:
// nunca recebe escrita), na posição que a prioridade 0 dá (a Riot faz o mesmo: getConstDefaultGroup)
export function secoesAmigos(grupos, itens) {
  if (!Array.isArray(grupos)) return null;
  const gs = grupos.map(g => ({ ...g }));
  const ids = new Set(gs.map(g => Number(g.id)));
  const por = new Map();
  for (const a of itens || []) {
    let gid = Number(a.grupoId);
    if (!Number.isFinite(gid) || !ids.has(gid)) gid = 0;
    if (!por.has(gid)) por.set(gid, []);
    por.get(gid).push(a);
  }
  if (por.has(0) && !ids.has(0)) { gs.push({ id: 0, name: '**Default', priority: 0, isMetaGroup: false, collapsed: false, virtual: true }); gs.sort(cmpGrupo); }
  return gs.map(g => {
    const amigos = por.get(Number(g.id)) || [];
    return { id: Number(g.id), rotulo: rotuloGrupo(g), meta: !!g.isMetaGroup, padrao: ehDefault(g) || Number(g.id) === 0, recolhido: !!g.collapsed, virtual: !!g.virtual,
      cru: g.virtual ? null : grupos.find(x => Number(x.id) === Number(g.id)) || null, amigos, online: amigos.filter(a => a.dot !== 'off').length, total: amigos.length };
  });
}

// pode reordenar? (decisão 7 do plano: só entre não metas, como "criados + geral"; sem grupos lidos ou com 1 só, não)
export function podeReordenar(grupos) {
  if (!Array.isArray(grupos)) return { ok: false, motivo: 'não foi possível ler as pastas: reordene pelo client normal' };
  if (naoMeta(grupos).length < 2) return { ok: false, motivo: 'só existe uma pasta' };
  return { ok: true, motivo: '' };
}
// moveGroup(id, posição) + saveGroupOrder do serviço friend-groups (v2). pos = vão entre os NÃO metas (0 = antes do 1º, n = depois
// do último), convertido para o índice na lista inteira. -> {ordem, puts:[{id, corpo}]} (puts vazio = nada muda)
export function novaOrdem(grupos, id, pos) {
  const lista = (grupos || []).map(g => ({ ...g }));
  const nm = lista.filter(g => !g.isMetaGroup && !g.virtual);
  const r = lista.findIndex(g => Number(g.id) === Number(id));
  if (r < 0 || lista[r].isMetaGroup || lista[r].virtual || !Number.isInteger(pos) || pos < 0 || pos > nm.length) return { ordem: lista, puts: [] };
  const t = pos < nm.length ? lista.indexOf(nm[pos]) : lista.indexOf(nm[nm.length - 1]) + 1;
  if (r === t || r === t - 1) return { ordem: lista, puts: [] }; // o mesmo vão (guarda do moveGroup da Riot)
  const [g] = lista.splice(r, 1);
  lista.splice(t > r ? t - 1 : t, 0, g);
  const puts = [];
  lista.forEach((x, n) => {
    const p = lista.length - n;
    if (Number(x.priority) === p || x.isMetaGroup || x.virtual) return;
    const antes = (grupos || []).find(y => Number(y.id) === Number(x.id));
    x.priority = p;
    puts.push({ id: Number(x.id), corpo: { ...antes, priority: p } });
  });
  return { ordem: lista, puts };
}
// recolher/abrir: o grupo como lido com collapsed trocado (toggleCollapse do lol-social-roster-group)
export const corpoRecolher = g => ({ ...g, collapsed: !g.collapsed });
// validateGroupName (v2) -> '' (ok) | texto da Riot. idAtual: renomear (mesmo nome de antes = nada a fazer, devolve 'igual')
export function validarNomePasta(nome, grupos, idAtual = null) {
  const n = String(nome ?? '');
  if (!n.trim()) return TEXTOS_RIOT.pastaVazia;
  const N = n.trim().toUpperCase();
  if (idAtual !== null && idAtual !== undefined) {
    const atual = (grupos || []).find(g => Number(g.id) === Number(idAtual));
    if (atual && String(atual.name).toUpperCase() === N) return 'igual';
  }
  if ((grupos || []).some(g => String(g.name || '').toUpperCase() === N) || N === ROTULOS_GRUPO.default.toUpperCase()) return TEXTOS_RIOT.pastaExiste;
  if (RESERVADOS.some(r => r.toUpperCase() === N)) return TEXTOS_RIOT.pastaReservada;
  return '';
}
// createGroup: {name, priority: maior + 1}
export function corpoNovaPasta(grupos, nome) {
  const ps = (grupos || []).map(g => Number(g.priority)).filter(Number.isFinite);
  return { name: String(nome).trim(), priority: (ps.length ? Math.max(...ps) : 0) + 1 };
}
// vão de soltar sobre o cabeçalho de um grupo não meta: metade de cima = antes dele, de baixo = depois -> índice do vão (0..n)
export function vaoDeSoltar(grupos, alvoId, metadeDeBaixo) {
  const nm = naoMeta(grupos);
  const i = nm.findIndex(g => Number(g.id) === Number(alvoId));
  return i < 0 ? -1 : i + (metadeDeBaixo ? 1 : 0);
}

// ---------- amigo ----------
// remoto (outro jogo ou outro servidor: isFriendRemote) e só-Discord (relationshipOnRiot NONE)
export function remoto(f, eu = null) {
  const prod = String(f?.product || '').toLowerCase();
  const meu = String(eu?.product || '').toLowerCase();
  if (prod && (meu ? prod !== meu : prod !== 'league_of_legends' && prod !== 'lol')) return true;
  return !!(f?.platformId && eu?.platformId && String(f.platformId).toLowerCase() !== String(eu.platformId).toLowerCase());
}
export const soDiscord = f => String(f?.relationshipOnRiot || '').toUpperCase() === 'NONE';
const desligado = f => ['mobile', 'offline', ''].includes(String(f?.availability || '').toLowerCase());

// lobby (GET /lol-lobby/v2/lobby, lobbyParaConvite) + fase -> o que a Riot exige para convidar (currentPlayerCanInvite =
// allowedInviteOthers, sem busca, grupo não cheio) e a decisão 8 do plano: só com o lobby criado, na fase Lobby ("o jogo
// sempre tem que estar no lobby para que possibilite convidar alguém para o lobby"). A coluna de amigos nunca cria lobby.
function lobbyPermite(lobby, fase) {
  if (fase === 'Matchmaking' || fase === 'ReadyCheck') return 'a busca está em andamento: cancele para convidar';
  if (fase !== 'Lobby') return 'abra o lobby para convidar';
  if (!lobby || lobby.tem === null) return lobby?.motivo || 'não foi possível ler o lobby';
  if (!lobby.tem) return 'abra o lobby para convidar';
  if (!lobby.pode) return lobby.motivo || 'só o líder do grupo convida';
  if (lobby.cheio) return 'o grupo está cheio';
  return '';
}
// convite (botão da linha, menu e soltar na coluna: a mesma regra) -> {mostra, ok, motivo, rotulo}. mostra = o item existe no
// menu (isInvitableViaLeague: nem só-Discord, nem celular/offline, nem remoto); ok = canInviteToGame + checkIfPlayerAvailable +
// decisão 8. A Riot acende o item para amigo em partida e recusa depois com um aviso; aqui ele fica cinza com o motivo.
export function podeConvidar({ f, fase = null, lobby = null, eu = null, convidados = new Map(), agoraMs = Date.now(), valeMs = 60000 } = {}) {
  const nao = (motivo, rotulo = 'convidar') => ({ mostra: true, ok: false, motivo, rotulo });
  if (!f || soDiscord(f) || desligado(f) || remoto(f, eu)) return { mostra: false, ok: false, motivo: '', rotulo: 'convidar' };
  const pid = String(f.pid || f.id || '');
  const membro = [f.puuid, f.summonerId].filter(v => v !== undefined && v !== null && v !== '').some(v => lobby?.membros?.has?.(String(v)));
  if (membro) return nao('já está no seu grupo');
  const quando = convidados.get(pid);
  if (quando !== undefined && agoraMs - quando < valeMs) return nao('convite enviado', 'convidado');
  const porLobby = lobbyPermite(lobby, fase);
  if (porLobby) return nao(porLobby);
  if (!(Number(f.summonerId) > 0)) return nao('sem o id do amigo para convidar');
  const g = String(f.lol?.gameStatus || '');
  const disp = String(f.availability || '').toLowerCase();
  if (g === 'inQueue') return nao('amigo na fila: convide quando ele sair');
  if (disp !== 'chat' && disp !== 'away') {
    const st = statusAmigo(f, agoraMs);
    const onde = g === 'championSelect' ? 'na seleção de campeões' : g === 'spectating' ? 'assistindo uma partida' : g === 'inGame' || disp === 'dnd' ? 'em partida' : st.txt;
    return nao(`amigo ${onde}: convide quando ele estiver disponível`);
  }
  return { mostra: true, ok: true, motivo: 'convidar para o seu grupo', rotulo: 'convidar' };
}
// POST /lol-lobby/v2/lobby/invitations (lobbiesService.invitePlayer do parties)
export const corpoConvite = f => [{ toSummonerId: Number(f.summonerId) }];

// espectador (spectateGame do roster v2): o id do jogo é o NAME do amigo (≠ gameName, medido) ou, se ele está assistindo
// alguém, o dropInSpectateGameId; o puuid é o dele ou o de quem ele assiste; a chave é sempre a dele
export function corpoEspectar(f) {
  const lol = f?.lol || {};
  const assistindo = String(lol.gameStatus || '') === 'spectating';
  return { dropInSpectateGameId: assistindo ? lol.dropInSpectateGameId : f.name, gameQueueType: lol.gameQueueType, allowObserveMode: lol.isObservable,
    puuid: assistindo ? lol.spectatingTargetPuuid : lol.puuid, spectatorKey: lol.spectatorKey };
}
// GET can-spectate -> {estado: 'ok'|'nao'|'erro', dica}
export function lerPodeAssistir(r, f) {
  if (!r || !r.ok || !r.json || typeof r.json !== 'object') return { estado: 'erro', dica: '' };
  if (r.json.availableForWatching === true) return { estado: 'ok', dica: '' };
  const tipo = String(f?.lol?.gameQueueType || '');
  return { estado: 'nao', dica: ['NONE', 'PRACTICE_GAME'].includes(tipo) ? TEXTOS_RIOT.espectadorPersonalizada : TEXTOS_RIOT.espectadorFila };
}
export const corpoNota = (f, texto) => ({ ...f, note: String(texto ?? '').trim() });
export const corpoMover = (f, gid) => ({ ...f, groupId: Number(gid) });
export const corpoBloqueio = f => ({ summonerId: f.summonerId, puuid: f.puuid });
export const corpoDenuncia = f => ({ offenderPuuid: f.puuid });
// hasReceivedMessageFromMember: alguma mensagem da conversa com ele vinda de outro (fromId ≠ o meu) e que não é de sistema
export function recebeuMensagem(msgs, meuId) {
  return (Array.isArray(msgs) ? msgs : []).some(m => m && typeof m === 'object' && String(m.fromId ?? '') !== String(meuId ?? '') && String(m.type || '') !== 'system');
}
export const nomeCompleto = f => (f?.gameName && f?.gameTag ? `${f.gameName}#${f.gameTag}` : '');

// menu do clique direito (contextMenuModel do lol-social-roster-member), nesta ordem. -> [{a, rotulo, off, motivo, perigo, sub}]
// ctx: {grupos (ordenados) | null, convite (podeConvidar), assistir: {estado:'verificando'|'ok'|'nao'|'erro', dica},
// denuncia: {ligada, denunciado, recebeu}}. Fora (fica de fora no plano): Dar presente, Silenciar, convites pelo Discord/Riot.
export function itensMenu(f, { grupos = null, convite = null, assistir = null, denuncia = null } = {}) {
  if (!f) return [];
  const discord = soDiscord(f);
  const itens = [];
  const c = convite || { mostra: false };
  if (c.mostra) itens.push({ a: 'convidar', rotulo: TEXTOS_RIOT.convidar, off: !c.ok, motivo: c.ok ? '' : c.motivo || '' });
  if (!discord) itens.push({ a: 'mensagem', rotulo: TEXTOS_RIOT.mensagem, off: false, motivo: '' });
  const temChave = !!(f.puuid && String(f.puuid).length && f.lol?.spectatorKey && String(f.lol.spectatorKey).length);
  if (temChave && !discord && Number(f.summonerId) > 0) {
    const s = assistir || { estado: 'verificando' };
    if (s.estado !== 'erro') itens.push({ a: 'assistir', rotulo: TEXTOS_RIOT.assistir, off: s.estado !== 'ok', motivo: s.estado === 'verificando' ? 'verificando se a partida pode ser assistida' : s.dica || '' });
  }
  itens.push({ a: 'perfil', rotulo: TEXTOS_RIOT.perfil, off: false, motivo: 'abrir o perfil ao lado (resumo e histórico)' });
  if (!discord) itens.push({ a: 'nota', rotulo: f.note ? TEXTOS_RIOT.notaEditar : TEXTOS_RIOT.notaNova, off: false, motivo: '' });
  // Mover: some se o grupo à vista do amigo é meta (offline, celular), se não há grupos lidos ou se só há 1
  const gs = Array.isArray(grupos) ? grupos.filter(g => !g.virtual) : null;
  const atual = gs?.find(g => Number(g.id) === Number(f.displayGroupId));
  if (gs && atual && !atual.isMetaGroup && gs.length > 1 && !discord) {
    itens.push({ a: 'mover', rotulo: TEXTOS_RIOT.mover, off: false, motivo: '',
      sub: gs.map(g => ({ id: Number(g.id), rotulo: rotuloGrupo(g).toLocaleUpperCase('pt-BR'), off: Number(f.groupId) === Number(g.id) || !!g.isMetaGroup })) });
  }
  if (!discord) itens.push({ a: 'remover', rotulo: TEXTOS_RIOT.remover, off: false, motivo: '', perigo: true });
  const d = denuncia || {};
  if (d.ligada) {
    const off = !!d.denunciado || !d.recebeu;
    itens.push({ a: 'denunciar', rotulo: TEXTOS_RIOT.denunciar, off, motivo: d.denunciado ? TEXTOS_RIOT.jaDenunciado : !d.recebeu ? TEXTOS_RIOT.semMensagem : '', perigo: true });
  }
  return itens;
}
// menu do cabeçalho do grupo (contextMenu do lol-social-roster-group): Renomear e Excluir, cinza no Geral e nos metas
export function itensMenuGrupo(sec) {
  const off = !sec || sec.padrao || sec.meta || sec.virtual;
  const motivo = off ? (sec?.meta ? 'pasta automática do client' : 'a pasta Geral não muda') : '';
  return [{ a: 'renomear', rotulo: TEXTOS_RIOT.renomearPasta, off, motivo }, { a: 'excluir', rotulo: TEXTOS_RIOT.excluirPasta, off, motivo, perigo: true }];
}
