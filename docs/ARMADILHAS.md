# Armadilhas — lol-client

Sintoma → causa → o que fazer. Datas = quando foi medido.

## Client e Pengu

- **Plugin não aparece depois de editar** → o client só lê o plugin no carregamento da
  interface. Recarregar com `window.restartClient()` ou `POST /riotclient/kill-and-restart-ux`,
  **só em fase `None`/`Lobby`** (`GET /lol-gameflow/v1/gameflow-phase`). O login e o lobby
  sobrevivem ao recarregamento (testado 13/10/2026).
- **Porta 8888 não responde** → `RemoteDebuggingPort=8888` vive em
  `C:\Program Files\Pengu Loader\config` (adicionada 13/10/2026; backup do original em
  `%TEMP%\pengu-config.bak`). Só vale depois de recarregar a interface.
- **Clique por coordenada erra o alvo** → a janela tem `devicePixelRatio` 1,25; print em
  1600×900, CSS em 1280×720. Coordenada do print ÷ 1,25.
- **`el.click()` em botão do Ember não faz nada** → alguns componentes do uikit só reagem a
  evento de mouse real. Usar `node tools/cdp.mjs click <x> <y>` (Input.dispatchMouseEvent).
- **Seletores medidos em 13/10/2026 (patch 16.20)**: `menu_item_navbar_tft`,
  `.game-type-card`, `.parties-game-type-icon.map-22`, `.parties-game-type-lower-half`,
  `.play-button-component`. Patch novo pode renomear; conferir aqui primeiro.

## LCU API

- **`/help` não tem URL** → `GET /help?format=Full` lista funções por nome
  (`PutLolLobbyV2LobbyMembersLocalMemberPositionPreferences` = `PUT /lol-lobby/v2/lobby/members/localMember/position-preferences`).
- **`GET /lol-matchmaking/v1/ready-check` dá 404** fora da fila ("Not attached to a matchmaking queue"): é o normal.
- **Timeline sem wards nem compras** → a versão da LCU só traz `CHAMPION_KILL`,
  `ELITE_MONSTER_KILL`, `BUILDING_KILL` e 1 frame por minuto.

## Windows

- **`auditpol /subcategory:"Process Creation"` dá "Parâmetro incorreto"** → o Windows é pt-BR
  e o nome é localizado; usar o GUID `{0CCE922B-69AE-11D9-BED3-00C04FD9BE6E}`. No Git Bash,
  `/get` vira caminho; rodar pelo PowerShell.
