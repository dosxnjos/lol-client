# Plano — plugin Pengu primeiro: edição só-plugin e o Python só para o coach ao vivo (2026-10-17)

Plano para um executor que nunca viu a conversa. Projeto `C:\Dev\lol-client`: plugin Pengu em `pengu/` (compacto em
`pengu/compacto/`), coletor Python em `coletor/`, painel da 2ª tela em `painel/`. Antes do 1º Edit: hub
`C:\Dev\cerebro\projetos\lol-client.md` (§ Fronteira), `CLAUDE.md`, `docs/ARMADILHAS.md` (§ Client e Pengu, § LCU,
§ Live Client), `docs/TEXTOS-DA-INTERFACE.md`, `docs/INSIGHTS.md` (dona das heurísticas do pós-jogo) e `docs/COLETOR.md`
§ Quem aceita.

**Portão:** nenhuma fase que edita `pengu/**` **ou `coletor/**`** começa antes de o plano
[telas que tiram o compacto](2026-10-17-telas-que-expandem.md) fechar (ele mexe em `compacto/index.js`, `expansoes.js`,
`tela-champselect.js` e `aceite.js`, os mesmos arquivos daqui, e no coletor: em 17/10 a árvore tem `coletor/coletor.py`,
`coach_vivo.py` e `ao_vivo.py` alterados por ele, partida assistida, e a Fase 1 daqui mexe no `coletor.py` e no
`servidor_local.py`; revisão 17/10). "Fechar" = as três coisas: (1) o § Estado daquele plano
registra as provas da lista "O que só o client real prova" do
[relatório dele](2026-10-17-telas-que-expandem.d/2026-10-17-relatorio-de-execucao.md), ou o Gabriel declara o plano fechado
sem elas; (2) os commits dele estão na `main`; (3) `git status -- pengu/ coletor/ tools/` limpo e nenhuma sessão viva com aquele plano
(`mcp__central__sessoes`). A Fase 0 (só medição) pode correr antes.

**Portão revisto (agente, 19/10/2026):** as condições (2) e (3) valem para começar a Fase 1 (os commits das telas,
`4f86026`, `b2b7cdb`, `f6d3717`, estão na `main`); a condição (1), provas no client real, passa a travar só a **publicação**
(Fase 8, passo do release): nada vai a público antes de o Gabriel jogar com a correção das telas e com a edição nova. Motivo:
desde 16/10 12:44 não houve ranqueada (`dados/lol.db`), e esperar a prova travaria fases que não mudam o comportamento da
instalação dele. Reverte: voltar a esperar a prova antes da Fase 1.

Estado (19/10/2026): decisões do Gabriel tomadas (§ Decisões do Gabriel, abaixo); medição C feita; Fases 1 em diante em
execução. Revisão adversarial de 17/10 conferida contra o código (correções marcadas "revisão 17/10" no corpo). Relatório de
execução de cada fase no sidecar `roadmap/2026-10-17-plugin-pengu-primeiro.d/`, nunca no corpo.
- **Fase 1 feita em 19/10/2026** (código e provas offline: `teste-ponte.mjs` 35/35, `teste-aviso-partida.py` 101/101,
  `teste-config.mjs` 59/59, bateria node verde); falta aplicar na instalação dele e as provas do client real:
  [relatório](2026-10-17-plugin-pengu-primeiro.d/2026-10-19-fase-1.md).

## Decisões do Gabriel (19/10/2026)

Palavras dele: "janelas antigas pode ser removida do código. Pode colocar o aceite automático habilitado, por padrão.
Recompensas, avisos calados também. Pode criar um repositório público. Aí dá para deixar o aviso quando tiver versão nova. Se
possível, com botão para update. update automatizado ao clicar no botão, se possível. Se possível, também com o coach de voz.
Com o botão que faz baixar os áudios. Pode sim apagar as amostras de partida de outra pessoa com as minhas. O resto segue como
você recomendou."

| decisão | resolução |
| --- | --- |
| licença | MIT |
| onde publicar | **repositório público novo** (não o `dosxnjos/lol-client` privado, que tem mentor, MCP, roadmaps e dados dele); sem a etapa do zip para amigos. Conta e nome: perguntados (regra "repo novo → conta dona"); recomendação `dosxnjos/lol-compacto` |
| aceite automático | **ligado por padrão** (como hoje), listado no aviso da 1ª execução |
| recompensas, avisos calados | **ligados por padrão** (como hoje), listados no aviso da 1ª execução |
| runas | ligadas (sem regra, nada acontece) |
| minimizar no ready check | desligado para instalação nova: `PADRAO.aceite.trazerClient = true` (a config salva dele fica com `false` pela mescla) |
| janelas antigas do chat | **aposentar** (Fase 2 roda) |
| força do draft | fora da 1ª versão (Fase 6 sem o snapshot) |
| versão nova | **sim**: aviso de versão nova pela `api.github.com`, 1 vez por dia, chave para desligar, **com botão Atualizar**; detalhe no plano da publicação |
| complemento coach público | **sim, com a voz Aoede** e botão que baixa os áudios; sai do "Fase 9: não executar" para o plano da publicação |
| idioma | só pt-BR |
| nome nos comentários | publicar como está |
| amostras das partidas assistidas | apagadas em 19/10 (510 `ao_vivo`, 35 `eventos_ao_vivo`, 18 `previsoes_jungler`), cópia antes em `dados/backup/lol-antes-limpeza-assistidas.db` |

Atualização e complemento público: plano próprio
[publicação, atualização e complemento público](2026-10-19-publicacao-e-complemento-publico.md) (substitui a Fase 8 passo 3 e
a Fase 9 daqui).

## Pedido (Gabriel, 17/10/2026, palavras dele)

"como assim, "janelas antigas"? por que a janela da análise está escrita duas vezes? eu quero preparar um plugin pengu que
tenha o máximo de recursos possível, pra que a dependência de python seja só pro mínimo possível, como coach ao vivo e tal.
fica bem menos preocupante pra quem baixaria. e não precisariam se preocupar com token claude, api etc. e sim seria um modo
compacto cheio de tweaks."

### As duas perguntas, respondidas

- **"Janelas antigas"** são o chat e a lista de amigos em janelas próprias do Edge (modo app, perfil `dados/edge-chat`) que
  o coletor abre (`coletor/chat_janelas.py`, rotas `/chat/*`). Só entram com o compacto ligado **e** a chave "Chat e amigos
  ao lado do compacto" (`compacto.chatLateral`) desligada (`pengu/compacto/chat-botao.js:14-27`). O padrão é ligada
  (`pengu/config.js:78`), e aí o chat roda inteiro no plugin: `compacto/lateral-chat.js` é porta 1:1 do `chat_janelas.py`
  (cabeçalho do arquivo) e lê a LCU direto. O texto da opção já diz "substitui as janelas do chat do coletor"
  (`pengu/blocos.js:256`). Hoje o coletor só aparece no chat por um aviso a cada 60 s (`POST /chat/plugin`,
  `compacto/chat-ponte.js:37-43`) que serve para as janelas do Edge não abrirem conversa em dobro.
- **"Análise escrita duas vezes"**: a análise e as lições do pós-jogo existem em JS (`pengu/posjogo/analise.js` +
  `licoes.js`) e em Python (`coletor/analise.py` + `coach.py`), seguindo a mesma spec (`docs/INSIGHTS.md`) e o mesmo
  `pengu/posjogo/licoes.md` (o Python lê o mesmo arquivo, `coach.py:17`). O JS desenha o painel e já roda sozinho sem o
  coletor (`posjogo/index.js:399-401`, `compacto/tela-posjogo.js:389-404`), mas só enxerga o cache do client (20 a 200
  partidas, sem paginar). O Python existe por três motivos: o motor ao vivo usa as regiões (`avisos.py:657` e `:870` chamam
  `analise.regiao`), o MCP e o prompt do mentor leem o banco SQLite, e é ele que tem o histórico inteiro com adversário e
  linha do tempo, de onde saem matchup, traumas e tilt por horário (`GET /contexto` e `/licoes`, `coach.py:441-514`). A
  duplicação foi de propósito (o pós-jogo não podia depender do coletor) e é guardada por testes cruzados
  (`tools/teste-matchup.mjs` e `.py`, `teste-licoes.mjs` e `.py`).

## Objetivo

Três camadas, do mesmo código:

1. **Edição Pengu** (pública): o plugin sozinho. Modo compacto cheio de tweaks, pós-jogo com análise e lições, selo da
   seleção com winrate, matchup, trauma e força do draft, chat e amigos ao lado, fila rápida com freios. Instala com o
   Pengu Loader e uma pasta copiada. **Sem Python, sem token do Claude, sem chave de API, sem admin** (medido em 17/10: o
   instalador do Pengu dá controle total a "Todos" em `C:\Program Files\Pengu Loader\plugins`, `icacls`; copiar a pasta
   não pede elevação). Nada fica cinza sem motivo e nada bate na porta 8765.
2. **Complemento coach** (Python, opcional, distribuível depois de decisão): só o que precisa de fora do client. Coach ao
   vivo (painel da 2ª tela, voz, moldura, minimapa e overlay do jungler, feitiços por OCR, F7/F8), reserva do aceite e a
   janelinha "aceitar/recusar" fora do client, revisão da previsão do jungler, tela de carregamento.
3. **Instalação do Gabriel**: as duas acima mais o que depende das credenciais dele e nunca se distribui: mentor
   (`claude -p` no plano dele), MCP sobre o SQLite, Riot API (`riotapi.py`, `tools/coletar-meta.py` pelo Doppler),
   registro das expansões e medidores (vitrine, travadas, `medir-compacto`).

## Tabela: recurso → camada

Edição = **P** (Pengu), **C** (complemento coach), **G** (só a instalação do Gabriel). "Hoje" diz onde roda agora.

| recurso | hoje | camada | porquê |
| --- | --- | --- | --- |
| Compacto inteiro: lobby, fila, seleção (banir, travar, trocas, skins), honra, pós-jogo curto, fim de partida | plugin | P | já não chama a 8765 em `modo.js`, `geometria.js`, `tela-fila.js`, `tela-champselect.js`, `tela-honra.js` |
| Lateral: chat (recentes, conversa, sala do time), amigos (pastas, menu, arrastar), perfil, fundo, som, ⚙ ao lado | plugin | P | tudo pela LCU; a ⚙ ao lado reaproveita os blocos de `blocos.js`, inclusive os do coach (esconder junto) |
| Janelas antigas do chat (Edge `--app`) | coletor | sai (ver [[DECISAO]]) | substituídas pela lateral; só existem com `chatLateral` desligado |
| Fila rápida, jogar de novo, freios | plugin | P | `MEDICAO` fixa com os números dele (`freios.js:11`) vira cálculo sobre o histórico de quem usa (Fase 3/5) |
| Runa por campeão ao travar | plugin | P (regras vazias) | ids de página são por conta; as regras dele ficam no DataStore dele |
| Coleta de recompensas, avisos calados, chat do pós-jogo, replay, extras de interface | plugin | P (padrões por [[DECISAO]]) | rodam sem Python; os que escrevem sem clique têm risco de Termos |
| Aceite automático (contagem, "não aceitar", releitura por GET) | plugin | P (padrão por [[DECISAO]]) | o núcleo é JS (`aceite.js`); "o aceite não depende do coletor" (`aceite.js:198-202`) |
| Reserva do aceite e janelinha fora do client | coletor | C | janela Win32 e processo independente; o CEF não abre janela fora do client |
| Selo da seleção: partidas, winrate, KDA | plugin | P | histórico pela LCU, já está |
| Selo: matchup e trauma | coletor (`/draft`) | P (Fase 5), C/G mais rico | aritmética sobre o resumo por partida; falta o acumulador local (Fase 4) |
| Selo: rota provável do inimigo e força do draft | coletor (`draft.py` + `meta.db`) | P (Fase 6, se a [[DECISAO]] do meta deixar) | modelo aditivo puro; o `meta.db` vira módulo embutido gerado pelo mantenedor, quem baixa não precisa de chave |
| Pós-jogo grande (6 abas, análise, 3 lições) | plugin | P | já roda sozinho |
| Pós-jogo: contexto (matchup, traumas, tilt por horário e sequência, farm média) | coletor (`/contexto`, `/licoes`) | P (Fase 5), C/G preferido quando responde | o motor JS já aceita o mesmo contexto (`licoes.js:231-287`); falta gerar em JS |
| Mentor do pós-jogo | coletor (`claude -p`) | G | depende do plano do Claude dele; ferramenta que autentica pelo plano não se distribui (`C:\Dev\CLAUDE.md`, Invioláveis) |
| Revisão da previsão do jungler (aba Tendência) | coletor | C | só existe se o coach ao vivo rodou na partida |
| Tela da partida no compacto: campeão, fila, RECONECTAR | plugin | P | já está |
| Tela da partida: tempo exato e placar do time | coletor (`/estado`, lê a 2999) | P se a medição A passar, senão C | não medido se o CEF lê `https://127.0.0.1:2999` (outra origem, certificado próprio) |
| Coach ao vivo: painel 2ª tela, voz, moldura, overlay, minimapa, jungler, feitiços, F7/F8, amostras | coletor | C | print de tela, janela por cima do jogo, OCR, teclado com o jogo em foco: o CEF fica atrás do jogo e não faz nada disso |
| Tela de carregamento (os 10, elo, maestria, morre cedo, previsão) | coletor (Riot API) | C, pela LCU (plano próprio) | medido em 17/10: a LCU dá ranked, maestria, alias e histórico de terceiros sem chave; a tela só aparece na 2ª tela |
| Lobby: dica do coach, resumo e PDL do dia | plugin | P | o `GET /dica` é chamada morta: o coletor não tem a rota (sai na Fase 1) |
| Registro das expansões do compacto | plugin coleta, coletor grava | G | medição de desenvolvimento (tarefa #37); nada sai sem o complemento anunciar `expansoes` |
| Config do plugin e espelho do `cfg.coach` | DataStore + `POST /config` | P (config), C (espelho) | o dono já é o DataStore; o espelho só vai a quem anuncia `coach` |
| Banco SQLite `dados/lol.db` | coletor | G (e C, se o coach gravar) | MCP e mentor leem; o plugin passa a ter o próprio resumo no DataStore |
| MCP, `riotapi.py`, `coletar-meta.py`, vitrine, travadas, vida/vigia | coletor | G | credencial, diagnóstico ou ferramenta do Claude dele |

## Linhas que não se cruzam (valem para todas as fases)

- **Nada em `pengu/**` fala com a 8765 sem `cfg.coletor.ligado` e sem aperto de mão válido** (`GET /ola` com
  `app: "lol-client-coletor"`). Porta que responde sem isso = outro programa: tratar como ausente.
- **Reserva do aceite só arma se o plugin falou com o complemento desde a última entrada em `Matchmaking`** (aperto de
  mão ou `POST /aceite/plugin`, com Origin do client ou do Pengu, regra de `origem_aceite_ok`; pedido sem Origin, como
  curl ou o painel, não conta), conferido na hora em que a reserva vai agir. "Nesta sessão do client" não basta (revisão
  17/10): o plugin visto uma vez e a chave desligada depois deixariam a reserva armada sem o "não aceitar". Hoje ela arma com a rota
  `/aceite/plugin` no ar no próprio coletor (`coletor/coletor.py:476-493`, `:677`), sem saber se o plugin fala com ele: com
  `coletor.ligado` desligado e o complemento rodando, o "não aceitar" do plugin não chegaria e a reserva aceitaria contra a
  vontade dele. Com o complemento visto, o "não aceitar" e o diagnóstico (`aceite.js:204-215`, `:283`) nunca entram no
  recuo da ponte: são por evento, não sondagem.
- **Acumulador guarda só agregado próprio**: gameId, hora, fila, duração, meu campeão, papel, campeão adversário (id),
  vitória, números aos 10 min, mortes cedo, ids dos campeões inimigos. Nunca nome, Riot ID nem puuid de outro jogador: o
  DataStore é um namespace comum, legível e apagável por qualquer plugin e pelo "Dump DataStore" do Pengu
  (fonte do 1.1.6: `v8_datastore.cc:3-14`, só XOR de chave fixa).
- Inimigo só por campeão, nunca nome; jogador oculto nunca se consulta; nada da fog (hub § Fronteira).
- O pacote nunca exige `DisableWebSecurity` nem o Pengu 1.2 (pré-lançamento): roda no 1.1.6 e usa `context.fs` só se
  `typeof context.fs` existir.
- Rota `[S]` sem medição nunca é premissa (`CLAUDE.md`). Contra o client real só GET; escrita na LCU só na
  `tools/lcu-falsa.mjs`. Credencial do lockfile nunca em arquivo.
- Chave da Riot API nunca no plugin (vazaria). Rede externa nova no plugin só com [[DECISAO]] (hoje o plugin não faz
  nenhuma: só LCU, `/lol-game-data` e a 8765).
- Texto de interface no tom do guia (`node tools/teste-textos.mjs`); o nome do Python para o usuário é um termo só,
  **"complemento coach"**, registrado em `docs/TEXTOS-DA-INTERFACE.md` na Fase 1. "coletor", "8765" e "MCP" nunca aparecem
  na edição sem complemento.
- Documentação fecha cada fase (README, `ARMADILHAS.md`, `CLAUDE.md` do projeto em 1 linha + caminho).

## Decisões técnicas (confiança e o que reverteria)

1. **Um código só, sem build que reescreve código.** O que muda entre as camadas é decidido em tempo de execução: a chave
   `cfg.coletor.ligado` e a lista `recursos` do aperto de mão. O pacote (Fase 8) só copia `pengu/` sem os arquivos de
   desenvolvimento. Confiança alta (dois códigos divergem; já aconteceu com JS e Python). Reverte: uma diferença que não dá
   para expressar por recurso anunciado (aí, um `pengu/edicao.js` gerado pelo empacotador).
2. **`coletor.ligado` padrão `false`; migração `VERSAO 4` liga para quem já tinha config salva.** Instalação nova (quem
   baixa) não toca a 8765. A config do Gabriel (salva antes da versão 4) ganha `coletor.ligado: true` uma vez só, pela
   mesma regra das migrações 2 e 3 (`migrar`, `config.js:110`, marca em `lol-client.versao`). Confiança alta. Reverte: padrão
   `true` (o comportamento de hoje).
3. **Aperto de mão `GET /ola`** → `{app: "lol-client-coletor", versao, recursos: [...]}`, com `recursos` entre `coach`,
   `painel`, `voz`, `alertas`, `minimapa`, `feiticos`, `carregamento`, `aceite-reserva`, `aceite-flutuante`, `revisao`,
   `estado-partida`, `mentor`, `contexto`, `draft`, `chat-janelas`, `expansoes`, `resumos`. O plugin mostra bloco, chave e
   chamada só do recurso anunciado. A instalação do Gabriel anuncia tudo; um complemento público anuncia só o que leva.
   Confiança alta. Reverte: voltar a sondar cada rota (hoje).
4. **Onde guardar o histórico: DataStore**, chave `lol-client.historico`, com teto e gravação agrupada. Medido em 17/10:
   a origem da página é `https://127.0.0.1:<porta da LCU>` e a porta muda a cada abertura; a pasta
   `Cache\IndexedDB` tem 6 pastas `https_127.0.0.1_<porta>.indexeddb.leveldb` diferentes, então localStorage e IndexedDB
   não sobrevivem ao próximo client. O DataStore sobrevive, mas é um JSON só, lido inteiro na carga e regravado inteiro a
   cada `set`, de forma síncrona (`plugins/src/preload/api/DataStore.ts:17-20` e `37-48` do 1.1.6), sem teto no código.
   Por isso: formato compacto (lista de listas, sem nomes de campo repetidos), teto de 500 partidas, no máximo 1 `set` por
   partida nova e 1 por lote do backfill. Confiança média (custo do `set` grande não medido: medição C). Reverte: `set` de
   300 KB acima de ~50 ms no client real (aí, teto menor ou `context.fs` do 1.2 quando existir) ou o iframe com origem fixa
   `https://plugins/...` provado persistente.
5. **Dona da análise do pós-jogo.** Edição Pengu: o JS (`analise.js`, `licoes.js` e o `contexto.js` novo da Fase 5) é o
   único motor. Instalação do Gabriel: o painel continua JS; o contexto vem do complemento quando ele responde e anuncia
   `contexto` (o SQLite dele tem centenas de partidas e o acumulador começa vazio ou com a importação), senão do JS local.
   `coletor/analise.py` e `coach.py` ficam para o coach ao vivo (`regiao`), o MCP e o prompt do mentor, que seguem lendo o
   SQLite sem mudança. A spec continua uma só (`docs/INSIGHTS.md`); a paridade é guardada por fixture comum (Fase 5).
   Confiança alta. Reverte: retirar `contexto` do `/ola` deixa o Gabriel no motor local, sem código novo.
6. **Força do draft por snapshot embutido**, não por fonte de terceiros em tempo de execução: `pengu/meta-draft.js`
   (módulo ES) gerado do `dados/meta.db` pelo mantenedor, com data, patch, elo e n no próprio arquivo e mostrados no selo.
   Caminho fora de `dados/` de propósito (revisão 17/10): o `.gitignore` tem `dados/` sem barra, que pega qualquer pasta
   `dados` (`git check-ignore -v pengu/dados/meta.js` → `.gitignore:1`); `pengu/meta-draft.js` não é ignorado. Confiança
   média (amostra de 309 partidas Esmeralda, 13/10). O técnico (snapshot ou nada) é decisão daqui; **distribuir** um dado
   coletado com a chave pessoal da Riot API dele é do Gabriel ([[DECISAO]] do meta). Reverte: a decisão dele dizer não
   (a Fase 6 não roda e o selo fica sem força do draft na edição Pengu).

## Como o plugin se comporta sem o complemento

Regra: o que precisa do complemento **some**; onde o usuário procuraria por ele, uma linha diz o que é e que precisa do
complemento coach. Nunca chave cinza, nunca "coletor fora do ar", nunca chamada à 8765.

- **Configurações (e a ⚙ ao lado do compacto):** o bloco "Coach: coletor" vira "Complemento coach" com uma linha de
  estado (desligado / procurando / encontrado, versão) e a chave `coletor.ligado`. Painel, Voz, Alertas na tela,
  Minimapa e jungler, Mentor, Tela de carregamento e a chave `coach.aceiteFlutuante` (`configuracoes.js:111`) só aparecem com o recurso
  anunciado. Com `coletor.ligado` e o complemento ainda não visto (o coletor sobe depois do client, `coach.js:41-42`), os
  blocos dos recursos do último aperto de mão bom (guardados em `lol-client.ponte`) continuam à mostra com a linha
  "procurando o complemento coach", e a mudança feita nesse meio vai no próximo aperto de mão (revisão 17/10: sem isso o
  Gabriel perderia as chaves do coach a cada abertura do client até o 1º aperto de mão). A linha de estado diz também que
  desligar a ponte **não** desliga o coach ao vivo: o complemento segue com a última config que recebeu. Sem complemento, um único bloco recolhido "Coach ao vivo" com 2 linhas: o que ele faz (voz, painel na 2ª tela,
  alertas no minimapa) e que precisa do complemento coach. Os atalhos `coach.*` do Ctrl+K (`config.js:205`, `:225-229`)
  saem da lista.
- **Lobby:** igual a hoje; a dica do coach é a local (o `GET /dica` sai).
- **Seleção:** selo com winrate e KDA; matchup, trauma e draft locais depois das Fases 5 e 6. Antes delas, a linha do
  coach (`champselect.js:187`, `lateral-coach.js:75`) some em vez de dizer "coletor fora do ar". O 📊 do compacto só
  existe quando há o que mostrar.
- **Partida:** tela compacta com campeão, fila, relógio local (ou o da 2999, se a medição A passar) e RECONECTAR; sem
  placar quando não há fonte, sem texto de erro.
- **Pós-jogo:** abas e 3 lições locais; a caixa do mentor e o bloco da revisão do jungler (`abas.js:390-395`) somem; os
  textos "coletor fora do ar: lições sem matchup…" (`abas.js:148-153`), "MCP sessao_hoje" (`abas.js:420`) e
  "lições do coach · sem o coletor" (`tela-posjogo.js:697-709`) saem.
- **Chave "Mostrar traumas":** só aparece quando há fonte de traumas (complemento ou acumulador com amostra).
- **Chat:** sempre ao lado; a chave `chatLateral` e o `POST /chat/plugin` só existem com `chat-janelas` anunciado.

## Fase 0 — medições (só leitura; pode correr antes do portão)

Nenhum arquivo de código. Resultados no § Estado deste md e em `docs/ARMADILHAS.md` (Edit ancorado). Scripts no
scratchpad, nunca no repo; credencial só em memória.

- **A. A 2999 de dentro do client.** Numa partida real dele (fase `InProgress`, depois do carregamento), um único
  `node tools/cdp.mjs eval` com `fetch('https://127.0.0.1:2999/liveclientdata/gamestats')` e, se ok,
  `.../allgamedata`. Anotar: status, tempo, ou o texto do erro (`Failed to fetch` = certificado ou CORS; ver no console do
  CDP qual). Decide a Fase 7.
- **B. puuid dos 10 no carregamento.** No mesmo `InProgress`, `GET /lol-gameflow/v1/session` e anotar só **quais campos**
  existem em `gameData.teamOne/teamTwo` (puuid presente? nome oculto como vem?), nunca os valores. Decide o plano próprio
  do carregamento pela LCU.
- **C. Custo do DataStore.** Com o client em `None`/`Lobby`: copiar antes o arquivo `C:\Program Files\Pengu Loader\datastore`
  para o scratchpad (reserva da config dele), e pelo `cdp.mjs eval` medir `DataStore.set('lol-client.teste-medida', x)` e
  `get` com x de 50, 150 e 300 KB (5 vezes cada, `performance.now()`), depois `DataStore.remove('lol-client.teste-medida')`
  e conferir que `lol-client.config` lê igual. Anotar também o tamanho do arquivo depois de cada `set`. Decide o teto da
  Fase 4.
  **Feita em 19/10/2026** (client em `None`, cópia do `datastore` no scratchpad antes): `set` de 54 KB 1,5–3,6 ms, de 155 KB
  3,1–3,8 ms, de 310 KB 5,5–9,9 ms (5 vezes cada; a 1ª é a mais lenta); `get` ≤ 0,1 ms; depois do `remove` o arquivo
  voltou a 1.698 bytes e `lol-client.config` leu igual. Teto de 500 partidas confirmado (bem abaixo dos ~50 ms da decisão 4).

## Fase 1 — ponte com interruptor e aperto de mão; nada some sem motivo

Arquivos: `pengu/coach.js`, `pengu/config.js`, `pengu/index.js`, `pengu/blocos.js`, `pengu/configuracoes.js`,
`pengu/champselect.js`, `pengu/aceite.js`, `pengu/posjogo/index.js`, `pengu/posjogo/abas.js`,
`pengu/compacto/{index,chat-botao,chat-ponte,expansoes,lateral-coach,lateral-config,tela-jogo,tela-lobby,tela-posjogo}.js`,
`coletor/servidor_local.py`, `coletor/coletor.py`, `docs/TEXTOS-DA-INTERFACE.md`, README, ARMADILHAS, `CLAUDE.md`.

1. `coletor/servidor_local.py`: `GET /ola` → `{app, versao, recursos}`. `recursos` se **calcula na hora** a partir do
   que está pendurado, nunca lista fixa (revisão 17/10): as rotas são montadas por módulos diferentes e podem faltar
   (`/draft` e `/revisao/` pelo `coach_vivo.py:787` no commit `4f86026`, `/chat/` pelo `chat_janelas.py:397`, `/aceite/` só quando
   `_sinal_aceite` arma, `coletor.py:476-493`, `/compacto/` pelo `coletor.py:502`, mentor só com `srv.mentor` ou
   `mentor_http`). Anunciar `aceite-reserva` com a reserva desarmada ou `draft` com `--sem-coach` faria o plugin chamar
   rota que não existe. Teste Python junto dos que já sobem o servidor em porta de teste (com e sem cada módulo).
2. `coletor/coletor.py`: a reserva do aceite arma só com contato do plugin desde a última entrada em `Matchmaking`
   (regra em "Linhas que não se cruzam"), conferido quando a reserva vai agir. Log: "reserva do aceite desarmada: o
   plugin não falou nesta fila". Prova com `teste-aviso-partida.py`, casos novos: rota no ar e plugin mudo = desarmada;
   plugin visto na fila anterior e mudo nesta = desarmada; `GET /ola` sem Origin = desarmada; `POST /aceite/plugin`
   do diagnóstico no início do ready check (`aceite.js:268`, `diag('evento')`) = armada.
3. `pengu/config.js`: `coletor: { ligado: false }` no `PADRAO`; `VERSAO = 4` com a migração "config salva de versão < 4 →
   `coletor.ligado = true`", uma vez só, igual às 2 e 3. `restaurar()` (`config.js:156`) mantém `coletor.ligado` como já
   mantém `runas.regras`: é instalação, não preferência (sem isso, "restaurar padrões" desliga a ponte do Gabriel calado).
4. `pengu/coach.js`: estado da ponte `{ligado, visto, recursos, versao}`; `coletor()` devolve `status 0` na hora, sem
   `fetch`, com a chave desligada ou sem aperto de mão; aperto de mão na carga, na virada para `None`/`Lobby`/`EndOfGame`
   e com recuo 30 s → 2 min → 5 min enquanto não acha; **fora do recuo**, uma tentativa imediata ao entrar em
   `Matchmaking` e outra em `ReadyCheck` (o complemento que subiu no meio do recuo tem de ser visto antes do ready check,
   senão a reserva fica desarmada: o caso de 14/10); `temRecurso(nome)` exportado. `sincronizarConfig` só com `coach`
   anunciado e sem o laço eterno de 30 s; no lugar dele, **todo aperto de mão bom com `coach` manda a config uma vez**
   (revisão 17/10: o laço de 30 s é hoje o que entrega a config ao coletor que subiu depois do client, `coach.js:40-52`;
   tirar o laço sem isto deixa o coach ao vivo do Gabriel com a config velha). Último aperto de mão bom gravado em
   `lol-client.ponte` (`{versao, recursos, em}`), para os blocos da seção "Como o plugin se comporta".
5. Cada chamador passa por `temRecurso`: `/estado` (`tela-jogo.js:172-187`) com `estado-partida`; `/draft`
   (`champselect.js:115-126`, `lateral-coach.js`) com `draft`; `/contexto` e `/licoes` (`posjogo/index.js:271-299`,
   `tela-posjogo.js:347-385`) com `contexto`; `/mentor` com `mentor`; `/revisao` (`posjogo/index.js:473`) com `revisao`;
   `/aceite/plugin` com `aceite-reserva`; `/chat/*` com `chat-janelas`; `/compacto/expansoes` com `expansoes`. Registro
   das expansões: com `coletor.ligado` e o aperto de mão ainda pendente, `expansoes.js` segue guardando na fila em memória
   como hoje (as saídas da abertura do client acontecem antes do coletor subir); descarta só com a chave desligada ou
   com aperto de mão bom sem `expansoes` (revisão 17/10: descartar já no "pendente" apagaria do registro da tarefa #37
   justamente as saídas da carga).
6. Remover as chamadas mortas: `GET /dica` (`tela-lobby.js:376-381`, fica a `dicaLocal`) e `estadoChat`/`abrirAmigos`
   (`chat-ponte.js:14-31`, sem chamador no plugin). **Correção (revisão 17/10):** o `tools/teste-chat-janelas.py:584-591`
   importa e testa as duas funções direto do `chat-ponte.js`: o mesmo commit tira esses casos do teste (os de
   `avisarModo` e `naoLidasDaLcu` ficam). Prova: `python tools/teste-chat-janelas.py` verde.
7. Interface sem complemento: o § "Como o plugin se comporta" acima, bloco a bloco (`index.js` registra os blocos do coach
   só com recurso; `blocos.js:140-245`, `configuracoes.js:111`, Ctrl+K). Os blocos reagem quando o aperto de mão muda
   (complemento que sobe depois do client aparece sem recarregar).
8. Textos: "complemento coach" no guia; trocar todo texto visível que cita coletor, `127.0.0.1:8765` ou MCP
   (`blocos.js:165`, `abas.js:148-153`, `:390-395`, `:420`, `tela-posjogo.js:675-709`, `champselect.js:187`,
   `lateral-coach.js:75`). `teste-textos.mjs` ganha a regra "sem complemento, nenhum texto visível com coletor/8765/MCP".
9. Docs: README § Ligar e desligar (coluna "precisa do complemento"); ARMADILHAS § Client e Pengu ("origem leva a porta da
   LCU: localStorage e IndexedDB morrem a cada abertura" e "DataStore é namespace comum e legível"); `CLAUDE.md`: **editar** a linha que já existe da reserva ("só com a rota do
   plugin no ar…") para "…só com o plugin visto (aperto de mão nesta sessão do client)" e acrescentar nela "o plugin só fala
   com a 8765 com `coletor.ligado` e aperto de mão (`pengu/coach.js`)"; nada de linha nova (teto do `gate-claude-md`:
   quem acrescenta, corta). COLETOR.md § Quem aceita com a regra nova.

**Provas.** `tools/teste-ponte.mjs` novo (fetch espião, relógio falso, `lcuFalsa`): (a) `ligado:false` → zero `fetch` à
8765 em 30 min simulados passando por todas as fases, com compacto, seleção, partida e pós-jogo montados; (b) `ligado:true`
e porta fechada → recuo medido (contagem de chamadas por fase); (c) porta respondendo 200 sem `app` → ausente, nenhuma
outra rota chamada; (d) `/ola` com recursos parciais → só as rotas desses recursos; (e) complemento que sobe no meio do recuo
de 5 min e fase `Lobby → Matchmaking → ReadyCheck` → aperto de mão feito antes do `ReadyCheck` e o "não aceitar" chega.
`teste-config.mjs`: instalação nova
= `false`; config v3 salva = `true` uma vez; `false` escolhido depois fica `false`. Bateria node inteira do plugin e
`teste-textos`/`teste-icones` verdes. Mutação: tirar o `temRecurso` de uma chamada deixa (d) vermelho.
**Aplicar na instalação dele (revisão 17/10):** o coletor novo exige contato do plugin na fila; o plugin velho já manda
o `POST /aceite/plugin` do diagnóstico no início de cada ready check, então a ordem não abre buraco, mas a de menor
risco é: recarregar o plugin só em `None`/`Lobby` (CLAUDE.md), conferir na ⚙ o "complemento coach encontrado", e só
então `python tools/vigia-coletor.py pausar`, reiniciar o coletor e religar o vigia. A 1ª fila depois disso confere no
`dados/coletor.log` a linha "reserva … armada".
**Reverte:** `git revert` do commit; ou só `coletor.ligado` = `true` e `/ola` anunciando tudo (comportamento de hoje).

## Fase 2 — aposentar as janelas antigas do chat (só depois da [[DECISAO]])

Se o Gabriel aprovar: antes de apagar, mover `naoLidasDaLcu` (só LCU, sem coletor) de `chat-ponte.js` para
`chat-botao.js`, que a importa (`chat-botao.js:9`), e tirar `compacto/chat-ponte.js` da lista do
`tools/compacto-importar.js:9` (revisão 17/10: apagar o arquivo direto quebra o 💬 da lateral). Depois sair
`coletor/chat_janelas.py`, as rotas `/chat/*` do `servidor_local.py`, `compacto/chat-ponte.js`,
o caminho desligado de `chat-botao.js` (fica o fallback "expandir para o chat da Riot", `chat-botao.js:55-57`), o aviso de
60 s (`compacto/index.js` ~1181 e ~1220-1232, linhas aproximadas: a outra sessão mexeu nelas), a chave `chatLateral`
(o valor salvo some na mescla, `config.js:93-101`), `tools/teste-chat-janelas.py` e o perfil `dados/edge-chat` (só depois do
commit, com o Edge fechado). Docs: README (linha do 💬), COLETOR.md. **Prova:** bateria node e Python verdes;
`grep -rn "chat/plugin\|chat_janelas\|chatLateral" pengu coletor tools` vazio. **Reverte:** `git revert`.
Se ele não aprovar: nada a fazer, a Fase 1 já esconde o caminho de quem não tem o recurso `chat-janelas`.

## Fase 3 — o que é pessoal vira configuração

1. `PADRAO` público: `runas.regras: []`, `compacto.favoritos: []`. A config salva dele não muda (a mescla mantém a lista
   salva, `config.js:98`; `restaurar()` mantém as regras, `:156`). Anotar a semente dele (ids das páginas do Renekton e do
   Zac, favoritos 58 e 154) no README § Instalar, para uma reinstalação.
2. `filaRapida.fila/pos1/pos2` ficam (qualquer par válido serve; a tela do lobby grava a escolha).
3. Freios sem os números de outra pessoa: **sai desta fase e vai para a Fase 5, passo 3** (revisão 17/10). Feito aqui,
   o mesmo código tiraria os números dele também (não há build por edição, decisão 1) e ele ficaria sem eles até a Fase
   5; o pacote só sai na Fase 8, então nada se perde esperando. Todos os lugares que citam `MEDICAO` (a lista do plano
   original esquecia os dois últimos): `freios.js:11` e textos em `:54-58`, `compacto/tela-lobby.js:169-175`,
   `configuracoes.js:120-121` (texto visível das Configurações), e o teste `tools/teste-compacto-lobby.mjs:17`.
4. Texto visível e valor padrão não citam o Gabriel. Os comentários (39 linhas em `pengu/` citam "Gabriel", nenhuma o
   Riot ID, conferido em 17/10) seguem para o pacote como estão, porque o empacotador não mexe em código (decisão 1), a
   menos que a [[DECISAO]] "nome nos comentários" diga outra coisa (revisão 17/10: publicar o primeiro nome dele junto
   do código é escolha dele, não técnica). A prova do pacote (Fase 8) olha texto visível e literais, não comentários.

**Prova:** `teste-config.mjs` (instalação nova sem regras nem favoritos; config salva do Gabriel igual antes e depois),
`teste-runas.mjs`.
**Reverte:** `git revert`; a config dele não depende disto.

## Fase 4 — acumulador do histórico no plugin

Arquivos novos: `pengu/historico.js`, `tools/teste-historico.mjs`. Toca `pengu/posjogo/index.js`, `pengu/champselect.js`,
`coletor/servidor_local.py` (`/resumos`).

1. **Formato** (`lol-client.historico`): `{v: 1, campos: [...], linhas: [[...], ...]}`, uma linha por partida própria com os
   campos que `analise.matchups`/`traumas` (`coletor/analise.py:222`, `:272`), `coach.historico_tilt`/`_traumas`/
   `contexto_partida` (`coletor/coach.py:448-516`), a média de farm por campeão (`analise.py:205`) e
   `draft.indices_pessoais` (`draft.py:144`) leem. O
   executor lista os campos lendo essas funções; regra de corte: só agregado próprio (Linhas que não se cruzam). Teto de
   500 linhas (ou o da medição C), mais recentes ficam.
2. **Alimentação:** a partida nova entra no `EndOfGame` a partir das GET que o pós-jogo já faz (`games/{id}` +
   `game-timelines/{id}`, `posjogo/index.js:16-29`), sem GET a mais.
3. **Backfill espaçado:** com a lista do histórico já lida pelo `champselect.js` (cache), 1 partida que falta a cada 5 s,
   só em `None`/`Lobby`, para na hora em qualquer outra fase, no máximo 40 por abertura do client, 1 `set` por lote de 10.
   A lista de partidas pode levar 25–60 s no 1º acesso e é atendida em fila pela LCU (ARMADILHAS § LCU): nunca disparar em
   paralelo com o pós-jogo. `endIndex` não é confiável (medido: 19 devolveu 100): usar o que vier.
4. **Importação do complemento** (instalação do Gabriel): com `resumos` anunciado, `GET /resumos?desde=<gameId>` devolve
   as linhas no mesmo formato a partir do SQLite (rota nova, só leitura, só campos próprios); mescla por gameId, uma vez por
   abertura.
5. Docs: ARMADILHAS § Client e Pengu (formato, teto, quem escreve); COLETOR.md (`/resumos`).

**Prova:** `teste-historico.mjs` com `lcuFalsa` e DataStore falso (Map que conta `set` e bytes): sem duplicata, teto
respeitado, backfill para ao entrar em `Matchmaking`/`ChampSelect`, 1 `set` por lote, linha com no máximo N bytes, e
varredura do JSON salvo sem `gameName`, `tagLine`, `summonerName` nem puuid que não seja o dele. Teste Python do
`/resumos` sobre banco de teste. **Reverte:** `git revert` e `DataStore.remove('lol-client.historico')` (nada mais lê a
chave antes da Fase 5).

## Fase 5 — contexto do pós-jogo e da seleção em JS

Arquivos novos: `pengu/posjogo/contexto.js`, `tools/fixtures/historico-1.json` (inventado ou exportado só com ids de
campeão, sem nome nem puuid), `tools/teste-contexto.mjs`, `tools/teste-contexto.py`.

1. Portar para JS, sobre as linhas do acumulador: `matchups`, `traumas`, `historico_tilt`, `_traumas`,
   `contexto_partida`. Mesma assinatura de saída que o `/contexto` devolve hoje, para o `licoes.js`
   (`:231-287`) e as abas não mudarem. **Farm média não se porta** (revisão 17/10: `farm_media` não é função do
   `coach.py`; o `analise.js:143-158` já calcula `farm {valor, media, n, diferenca}` sobre o histórico da LCU, e o
   `posjogo/index.js:284-285` só troca pelo do coletor quando a local é null): basta o `analise.js` também aceitar as
   linhas do acumulador como amostra, para passar de 20–200 partidas.
2. Ordem da fonte: complemento com `contexto` → `/contexto`; senão `contexto.js` local. O selo da seleção usa o mesmo
   para matchup e trauma.
3. `MEDICAO` dos freios (vindo da Fase 3, todos os lugares listados lá) vira parâmetro `medicao` calculado do
   acumulador (winrate depois de 2 derrotas, de madrugada e de dia), com piso de amostra (abaixo de 30 partidas, texto
   sem número). Na instalação dele o acumulador começa com a importação do `/resumos` (Fase 4), então os números dele
   seguem aparecendo sem intervalo. Prova a mais: `teste-jogar-de-novo.mjs` e `teste-compacto-lobby.mjs` (freio com
   `medicao` null tem texto sem número e passa no `teste-textos`).
4. Chave "Mostrar traumas" aparece quando há fonte.
5. Docs: `docs/INSIGHTS.md` (a terceira implementação é a mesma spec; quem muda uma muda as duas, como já é com o
   `analise.js`); ARMADILHAS (a amostra local começa pequena).

**Prova:** `teste-contexto.mjs` e `teste-contexto.py` sobre a mesma fixture dão a mesma saída (comparada campo a campo,
gravada em `tools/fixtures/contexto-esperado.json`); `teste-licoes.mjs`, `teste-matchup.mjs`, `teste-posjogo.mjs`,
`teste-abas.mjs` verdes; `teste-traumas.py` verde. Com o fetch espião da Fase 1 e `ligado:false`, o pós-jogo mostra matchup
e trauma sem nenhuma chamada à 8765. **Reverte:** `git revert`; o complemento continua servindo o Gabriel.

## Fase 6 — draft em JS com snapshot do meta (só com a [[DECISAO]] do meta dizendo sim)

Sem a decisão: a porta do modelo (passo 2) pode rodar sem o snapshot, com rotas e índices pessoais só do acumulador, e
o selo mostra a força do draft só quando o complemento anuncia `draft`. O passo 1 e o arquivo gerado esperam a decisão.

1. `tools/exportar-meta.py` (mantenedor; lê `dados/meta.db`, sem rede, sem chave) → `pengu/meta-draft.js` com
   `export default {data, patch, elo, partidas, campeoes: {id: {rota: [jogos, vitorias]}}}`. Nunca em `pengu/dados/`:
   o `.gitignore` (`dados/`) ignora a pasta e o arquivo nunca entraria no commit (decisão 6). A prova confere com
   `git ls-files pengu/meta-draft.js` não vazio.
2. `pengu/draft.js`: porta de `rotas_provaveis` (`draft.py:88`), `indices_pessoais` (`:144`) e `forca_draft` (`:154`),
   lendo o snapshot e o acumulador. O snapshot sai do `exportar-meta.py` como módulo ES (`pengu/meta-draft.js`,
   `export default {...}`) importado direto: sem `fetch` e sem depender do nome da pasta do plugin (o caminho
   `https://plugins/<nome>/` não está fixo no código hoje e o nome público é [[DECISAO]]).
3. Selo da seleção e 📊: draft local quando o complemento não anuncia `draft`; mostra a data e o elo da amostra.
4. Docs: COLETOR.md (gerar o snapshot a cada patch, depois do `coletar-meta.py`).

**Prova:** `teste-draft.mjs` contra `teste-draft.py` na mesma fixture (mesma faixa e mesmas rotas prováveis);
`teste-compacto-selecao.mjs` verde; inimigo continua só campeão. **Reverte:** `git revert`.

## Fase 7 — tempo e placar da partida direto da 2999 (só se a medição A passou)

`tela-jogo.js` lê `gamestats` (tempo) e `allgamedata` (abates do time) da 2999 a cada 2 s, só em `InProgress`, com prazo
1,5 s; o `/estado` do complemento vira reserva. Tempo do jogo pelo evento `GameStart` ou `gameTime > 0,1`, nunca "resposta
ok" (ARMADILHAS § Live Client: a 2999 responde na tela de carregamento com `gameTime` parado). Nada mexe na janela
(`podeMexer`). **Prova:** `teste-compacto-jogo.mjs` com 2999 falsa (`tools/simular-liveclient.py` ou rota no harness):
carregamento, jogo, reconexão, porta fechada. **Reverte:** `git revert`. Se a medição A falhar: registrar no § Estado e
pular; o relógio local continua.

## Fase 8 — empacotar a edição Pengu (depois das [[DECISAO]] de licença, conta e padrões)

1. `pengu/versao.js` (versão do pacote, 1 constante). `tools/empacotar.py` → `dist/lol-client-pengu-<versao>.zip`
   (`dist/` no `.gitignore`): `pengu/` sem arquivo de desenvolvimento, `LICENSE`, `TERCEIROS.md` (better-lol-chat MIT,
   `chat-posjogo.js:1-20`; Lucide ISC, `icones.js:1-14`) e `LEIA-ME.md` (o que faz, instalar o Pengu Loader 1.1.6, copiar
   a pasta para `plugins\lol-client`, recarregar só no lobby, riscos de conta, "não endossado pela Riot Games", o que é o
   complemento coach e que é opcional).
2. Aviso na 1ª execução (DataStore `lol-client.aviso-visto`): o que o plugin escreve na conta sem clique (as automações
   que o Gabriel decidir deixar ligadas) e como desligar.
3. Verificação de versão nova: só com a [[DECISAO]] de repositório e de rede; nunca auto-update (o 1.1.6 não escreve nos
   próprios arquivos).
4. Docs: README dividido em "edição Pengu" e "instalação completa"; hub com o link do pacote.

**Prova:** `tools/teste-pacote.py`: o zip tem só arquivos servíveis, todos os `import` resolvem dentro dele, nenhum `.py`,
pasta `dados/` nem symlink (o `pengu/meta-draft.js` vai, se a Fase 6 rodou); em literais de string e texto visível (não em comentário,
ver Fase 3 passo 4), nenhum "Gabriel", "Xerekton", id de página de runa nem caminho `C:\Dev`; `LICENSE` e `TERCEIROS.md`
presentes. O zip sai de `git ls-files pengu/` (arquivo ignorado ou não commitado não entra calado).
Prova no client: só numa instalação limpa (2ª máquina, ou o Gabriel trocando a junção por uma cópia, decisão dele), com o
complemento parado (`python tools/vigia-coletor.py pausar` antes, CLAUDE.md). **Na troca da junção, o DataStore dele
continua lá** (é um arquivo só do Pengu, `C:\Program Files\Pengu Loader\datastore`, e a config dele já está na versão 4
com a ponte ligada): o teste não seria de instalação nova. Antes: client fechado, copiar o `datastore` para o scratchpad
e deixar o do Pengu vazio; depois: client fechado, devolver a cópia e conferir que `lol-client.config` lê igual
(revisão 17/10). **Reverte:** apagar `dist/` e devolver o `datastore`; nada no client dele muda.

## Fase 9 — complemento coach público (plano próprio, depois de decisão)

Não executar daqui. Escopo para o plano: instalação sem admin (o gatilho pelo evento 4688 exige PowerShell elevado,
`tools/instalar-gatilho.ps1`; alternativa: atalho na inicialização do Windows que espera o client), `requirements.txt` com
as bibliotecas do coach ao vivo, `/ola` sem `mentor`/`expansoes`/`resumos`, monitor da 2ª tela configurável
(`janela_painel.py:25-26` fixo na máquina dele), tela de carregamento pela LCU no lugar da Riot API (medição B; orçamento
apertado nos ~100 s do carregamento), pacote de voz (decisão), e a etapa 7 do plano das telas (coach calado em partida
assistida), que é dependência.

## Riscos e rotas sem medição [S]

- A 2999 de dentro do CEF (medição A). Sem ela, tempo exato e placar ficam no complemento.
- Custo de `DataStore.set` grande e o carregamento do client com o arquivo maior (medição C).
- Persistência de IndexedDB num iframe de origem fixa `https://plugins/...`: hipótese, não medida, não usada.
- Timers do plugin com o client atrás do jogo quando o usuário desliga o `OptimizeClient` do Pengu.
- Vazão da LCU no backfill (lista de partidas lenta no 1º acesso, fila única).
- Snapshot do meta envelhece a cada patch e reflete o elo Esmeralda.

## Fica de fora (e por quê)

- Mentor, MCP, Riot API, `coletar-meta.py`: credencial do Gabriel (camada G).
- Vitrine, medidor de travadas, `medir-compacto`, registro das expansões, vida e vigia: diagnóstico de desenvolvimento ou
  do coach dele; a tarefa #37 decide quando o medidor desliga.
- Voz sintetizada no plugin (`speechSynthesis` tem Maria e Daniel pt-BR, medido): sem gatilho no plugin (o motor de avisos é
  Python e a partida acontece com o client atrás); volta à mesa se a medição A passar e alguém quiser avisos só da Live
  Client no plugin.
- Tradução da interface: o pacote sai em pt-BR (ver [[DECISAO]]).

## [[DECISAO]] — só o Gabriel

- [[DECISAO]] licença do projeto (não há `LICENSE` no repo; publicar sem ela = todos os direitos reservados) | opções: MIT /
  outra permissiva / fechada | recomendo: MIT (compatível com o trecho MIT do better-lol-chat e o ISC do Lucide que o pacote
  já carrega) | dono: gabriel
- [[DECISAO]] onde publicar (repo público novo, release do `dosxnjos/lol-client` privado como zip, ou só mandar o zip para
  amigos), **em qual conta do GitHub** (repo novo pede a conta dona, `C:\Dev\CLAUDE.md` § Invioláveis) e com que nome público (o prefixo `lol-client.` do DataStore é comum a todos os plugins) | recomendo: começar
  mandando o zip para 2–3 amigos, repo público só depois | dono: gabriel
- [[DECISAO]] aceite automático na edição pública (aceite automático é automação de fila que a Riot pode punir;
  a citação de uma "política do Pengu" que o plano trazia não tem fonte no repo e saiu na revisão 17/10) | opções: ligado como hoje / desligado por padrão com aviso / fora do pacote | recomendo: desligado por padrão,
  com o aviso da 1ª execução | dono: gabriel
- [[DECISAO]] coleta automática de recompensas, avisos calados por resposta falsa (`sem-popups.js`), runas aplicadas ao
  travar e minimizar o client no ready check, na edição pública | recomendo: recompensas e avisos calados desligados por
  padrão; runas ligadas (sem regra, nada acontece até o usuário criar uma); minimizar desligado | dono: gabriel
- [[DECISAO]] aposentar as janelas antigas do chat (Fase 2; perde o chat em janela solta fora do client) | recomendo:
  aposentar (a lateral é o padrão e substitui) | dono: gabriel
- [[DECISAO]] força do draft para quem baixa. O snapshot sai do `dados/meta.db`, que o `tools/coletar-meta.py` junta com
  a chave **pessoal** dele da Riot API (Doppler) e no elo dele: distribuir esse agregado num pacote público é questão das
  regras de desenvolvedor da Riot (chave pessoal, não de produto) e expõe o elo dele, não questão técnica (revisão 17/10) |
  opções: snapshot embutido gerado por ele a cada patch / fonte de terceiros em tempo de execução (Lolalytics, U.GG:
  termos e endpoint próprios) / sem força do draft na edição Pengu | recomendo: sem força do draft na primeira versão
  (o selo segue com winrate, matchup e trauma do próprio histórico); snapshot só depois de ele conferir as regras da chave
  que usa | dono: gabriel
- [[DECISAO]] verificar versão nova pela `api.github.com` (dado de uso saindo da máquina de quem instala; CORS medido ok) |
  recomendo: só depois de existir repo público, 1 vez por dia, com chave para desligar | dono: gabriel
- [[DECISAO]] distribuir o complemento coach a terceiros (coach que "dá ordem" é risco de conta de quem usa; hub
  § Fronteira) e o pacote de voz gerado pelo Gemini (termos do Google) | recomendo: primeira versão só com a edição Pengu;
  complemento depois, sem a voz Aoede (fica a voz Maria do Windows) | dono: gabriel
- [[DECISAO]] idioma do pacote | recomendo: só pt-BR na primeira versão | dono: gabriel
- [[DECISAO]] nome dele nos comentários do código (39 linhas de `pengu/` citam "Gabriel" em comentário, com datas e
  decisões; nenhuma o Riot ID) | opções: publicar como está / trocar por "o mantenedor" antes do 1º pacote (um commit só de
  comentários) | recomendo: publicar como está se o repo e a conta forem dele com o próprio nome; trocar se ele quiser o
  pacote sem ligação com a pessoa | dono: gabriel

## O que o pedido não dizia

- Reserva do aceite e "não aceitar": com o plugin desligado da ponte e o complemento rodando, a reserva aceitaria contra o
  "não aceitar"; a Fase 1 amarra a reserva ao aperto de mão (sem isso, o interruptor novo abriria o buraco).
- Porta 8765 de outro programa: quem baixa pode ter algo nela; o aperto de mão com `app` evita falar com estranho.
- Chamadas mortas: `GET /dica` (o coletor nunca teve a rota) e `estadoChat`/`abrirAmigos` sem chamador.
- Sondagem eterna com a porta fechada (30 s config, 3 s do `/draft` na seleção, `champselect.js:113-122` e
  `lateral.js:1005`, 2 s em partida, 10–15 s mentor e lições, 60 s chat): some com a ponte
  desligada e vira recuo com ela ligada.
- Números do Gabriel em texto que outro usuário leria como dele (`MEDICAO`) e regras de runa com ids da conta dele.
- Telemetria (registro das expansões) não pode sair num pacote alheio: fica presa ao recurso `expansoes`.
- Licenças de terceiros que o pacote já carrega (better-lol-chat MIT, Lucide ISC) precisam ir junto.
- localStorage e IndexedDB parecem banco mas morrem a cada abertura do client (porta na origem, medido): a escolha do
  DataStore vem disso, não de preferência.
- O pós-jogo do Gabriel não perde nada: enquanto o complemento dele responde, o contexto continua vindo do SQLite inteiro.
- (revisão 17/10) A versão dele não perde nada no meio do caminho: a config do coach chega no aperto de mão (substitui o
  laço de 30 s), as chaves do coach não somem enquanto o coletor sobe, o registro das expansões não descarta as saídas da
  carga, os números dos freios só mudam quando o acumulador dele já tem a importação, e `/ola` anuncia só a rota que está
  de fato pendurada.
- (revisão 17/10) Desligar a ponte não desliga o coach ao vivo: o complemento segue com a última config; a linha de estado
  diz isso para ninguém achar que desligou o Python.
