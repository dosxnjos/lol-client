// prova de carga do client compacto no CEF do client real, SÓ import() (nada é montado, lido da LCU ou escrito):
//   node tools/cdp.mjs eval tools/compacto-importar.js
// esperado: cada módulo com o número de exports (e " montar" nas telas); "ERRO ..." = o módulo não sobe no CEF 108.
// "does not provide an export named" com export novo em módulo importado por dentro = cópia do boot (o ?v só vale no topo):
// rodar de novo depois de recarregar a interface (ARMADILHAS § Client e Pengu).
(async () => {
  const v = Date.now();
  const base = 'https://plugins/lol-client/';
  const mods = ['compacto/comum.js', 'compacto/modo.js', 'compacto/chat-ponte.js', 'compacto/chat-botao.js', 'compacto/index.js',
    'compacto/tela-lobby.js', 'compacto/tela-fila.js', 'compacto/tela-champselect.js', 'compacto/tela-posjogo.js', 'posjogo/index.js',
    // passo 13 (lateral): chat ao lado, configurações à esquerda, coach da seleção, geometria da janela
    'compacto/geometria.js', 'compacto/lateral.js', 'compacto/lateral-chat.js', 'compacto/lateral-coach.js', 'compacto/lateral-config.js',
    // passo 12 (fim de partida) e passo 14 (partida em andamento)
    'compacto/tela-honra.js', 'compacto/chat-sala.js', 'compacto/jogador-acoes.js', 'compacto/tela-jogo.js',
    // passo 15 (registro das expansões) e plano de 16/10/2026 (amigos com pastas e menu, perfil e editor, fundo da coluna)
    'compacto/expansoes.js', 'compacto/amigos.js', 'compacto/amigos-menu.js', 'compacto/perfil.js', 'compacto/fundo.js',
    // etapa B de roadmap/2026-10-16-chat-da-sala-som-icones.md (som do client na ⚙)
    'compacto/som.js'];
  const out = {};
  for (const m of mods) {
    try { const mod = await import(`${base}${m}?v=${v}`); out[m] = Object.keys(mod).length + (typeof mod.montar === 'function' ? ' montar' : ''); }
    catch (e) { out[m] = 'ERRO ' + (e?.message || e); }
  }
  return out;
})()
