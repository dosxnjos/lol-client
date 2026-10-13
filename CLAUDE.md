# lol-client

Mod pessoal do client do LoL (plugin Pengu, coletor SQLite, pós-jogo, MCP). Hub:
[cerebro/projetos/lol-client.md](../cerebro/projetos/lol-client.md) · plano vigente em `roadmap/`.

- **Nunca** `POST .../matchmaking/search` em teste automatizado; recarregar a interface só
  em fase `None`/`Lobby`. Detalhe: [docs/ARMADILHAS.md](docs/ARMADILHAS.md).
- Teste em personalizada: sair só por `POST /lol-lobby-team-builder/champ-select/v1/session/quit`,
  com rede de segurança na página; `cancel-champ-select` não cancela e o client põe hover sozinho.
- Credencial do lockfile nunca em arquivo, log ou doc. Heurísticas do pós-jogo: dona é
  [docs/INSIGHTS.md](docs/INSIGHTS.md) (JS e Python seguem ela). Coletor, banco e MCP:
  [docs/COLETOR.md](docs/COLETOR.md).
