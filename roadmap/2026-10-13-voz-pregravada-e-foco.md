# Voz pré-gravada do coach + foco do client ao achar partida

- **Data:** 13/10/2026 · **Alvo:** `coletor/avisos.py`, `coletor/voz.py`, `pengu/aceite.js`, `pengu/blocos.js`,
  ferramentas novas em `tools/` · **Depende de:** v2 entregue (`0d1f1db`, plano
  [2026-10-13-lol-client-v2-coach.md](2026-10-13-lol-client-v2-coach.md))
- **Continuação (14/10/2026):** [calibrar os avisos e o overlay](2026-10-14-calibrar-avisos.md) (relevância do
  "mid sumiu" e do jungler, gank nas 3 rotas, overlay suave); o catálogo de falas daqui não muda

## Pedido (palavras do Gabriel, 13/10/2026)

> quando o LoL encontra uma partida para eu aceitar, ele ganha foco na tela. Mas já que eu tenho
> auto-accept, esse foco é meio que inútil. Tem como a gente desabilitar esse foco […]?
> Não dá para a gente pré-gravar as opções disponíveis de áudio? […] acho que não precisa ser geração ao
> vivo […] são sempre as mesmas situações […] Eu lembro do coqui, porque eu lembro de ter gostado de
> algumas vozes. Eu tinha testado algumas vozes masculinas e tinha gostado muito. A ideia era botar ele
> pra ler livros. Então, acho que faria sentido a gente testar as vozes deles, tanto masculinas quanto
> femininas. […] frases mais genéricas, como gank do mid laner, flash do mid voltou, etc. E os tipos de
> cada informação também poderiam ser marcados ou desmarcados nas configurações.

## Entendimento

1. **Foco:** na fila, o client vem para a frente quando a partida é encontrada. Com o aceite automático
   (aos 10 s), esse foco só atrapalha. Ele quer que o client fique onde está.
2. **Voz:** os avisos ao vivo são moldes finitos. Gerar o áudio de todas as frases **uma vez, fora da
   partida**, e só tocar o arquivo durante o jogo. Isso tira o atraso e o peso no processador, e libera
   vozes lentas e boas (Coqui XTTS), que ao vivo não serviriam.
3. **Frases genéricas:** a fala diz a **rota** ("o jungler", "o mid"), não o campeão. Assim o conjunto
   de frases fica finito e cabe num pacote gravado.
4. **Tipos ligáveis:** já existe (12 tipos em Configurações › LOL-CLIENT, `coach.avisosDesligados`).
   Faltam tipos novos da v2 (abaixo) e a separação voz/tela.

## Fatos levantados (13/10/2026)

| fato | evidência |
| --- | --- |
| Nenhum script do client carregado tem `ux-show`, `ux-flash`, `bringToFront` ou `allow-foreground` (42 scripts lidos pelo CDP, durante uma partida). O foco pode vir do lado nativo do client ou de um script que só carrega na fila | `tools/cdp.mjs eval` com busca nos `script[src]` |
| Configurações conhecidas do client (`lol-general`, `lol-user-experience`) não têm opção de foco | `GET /lol-settings/v1/{local,account}/...` |
| `GET /riotclient/ux-state` existe (durante a partida: `"MinimizeAll"`); `POST /riotclient/ux-minimize`, `ux-show` e `ux-flash` existem (o `pengu/runas.js` usa `ux-show` + `ux-flash`) | chamada direta |
| A fala de 6 dos 12 tipos usa `{campeao}`; o rótulo da tela também | `coletor/avisos.py` `TEXTOS` |
| Tipos publicados fora dos 12 da configuração: `feitico_voltou` (`feiticos.py`), `pico_nivel` e `pico_item` (`sugestoes.py`), regras do `coach.py` | `grep Aviso(` |
| Desligar um tipo hoje corta voz, painel e moldura juntos | `MotorAvisos.publicar` |
| Máquina: Intel Core Ultra 5 225H, Intel Arc 130T (sem NVIDIA), 47 GB de RAM; `uv` e `ffmpeg` instalados; Python 3.14 + CPython 3.11 do `uv` | `py -0`, CIM |
| Coqui: a empresa fechou em 2024, o fork `idiap/coqui-tts` segue vivo; XTTS-v2 fala português com os locutores embutidos (masculinos e femininos) e roda no processador, devagar | plano do Jarvis (`central/roadmap/2026-08-28-jarvis-voz-e-notebook.md` § Descartado) |
| No Jarvis o Gabriel escolheu a voz **Aoede** (Gemini) em 25/09 | mesmo plano, card `c0bd9ddbb196b` |

## Decisões e trade-offs

- **Fala genérica, tela com nome.** O áudio diz "o jungler apareceu no rio top"; o painel e a moldura
  continuam com o nome do campeão (texto não precisa ser gravado). Quem: agente (técnico).
- **Pacote fora do git.** Áudio gerado vai para `%LOCALAPPDATA%\lol-client\voz\<voz>\` com `indice.json`
  (frase → arquivo, versão do catálogo). Tamanho e regerável. Quem: agente.
- **Gerar só com o jogo fechado.** O gerador recusa rodar com `League of Legends.exe` aberto e com o
  client em fila ou partida: o processador é do jogo. Quem: agente.
- **Frase fora do pacote cai na Maria ao vivo** e fica registrada em `dados/voz-faltou.jsonl` para a
  próxima geração completar. Nenhum aviso fica mudo por falta de áudio. Quem: agente.
- **Foco: sondar antes de mexer.** Não se sabe se o foco vem do JS ou do lado nativo; a sonda da fase A
  decide o mecanismo. Reversão: desligar a chave na configuração.
- **A escolha da voz é do Gabriel, ouvindo.** A sessão não escolhe voz por ele.

## Passos

### Fase A: foco ao achar partida

1. [x] **Resultado (13/10/2026, 14:43, fila real recusada pelo Gabriel):** o foco vem do **lado nativo**.
   Sem nenhuma chamada JS a `/riotclient/*` no ReadyCheck; o `ux-state` vai a `"ShowMain"` 0,06 s depois da
   fase mudar e a página recebe `focus` junto (−0,20 s no registro de 250 ms). A janela "League of Legends"
   foi para a frente por cima do navegador (vigia de `GetForegroundWindow` a cada 50 ms,
   `tools/sonda-foco.js` + vigia em `%TEMP%`). Antes: último `blur` 32 s antes. Logo: bloquear no JS não
   serve; o passo 2 segue pela rota nativa (`ux-minimize` ao detectar o roubo, com o piscar).
   **Segunda leitura (13/10, ~15:00, Gabriel: "tenho certeza que dá para desabilitar o autofoco, já
   instalei algum plugin no passado que fazia isso"):** as chamadas nativas do JS do client passam por
   `window.riotInvoke` (`Window.Show`, `Window.Activate`, `Window.Flash`…), que a 1ª sonda não via. Mas
   `riotInvoke` é **não gravável e não configurável** (não dá para embrulhar), e nenhum script carregado
   trata `ux-state`: o backend manda `OnJsonApiEvent_riotclient_ux-state_request` e quem mostra a janela é
   o executável nativo, que confirma por `PUT /riotclient/ux-state/ack`. Pesquisa na web (13/10) não achou
   o plugin antigo. Sem rota para impedir o pedido, segue `ux-minimize` logo depois do roubo.
   **Pedido novo do Gabriel na mesma mensagem:** "esses botões para aceitar ou não nem precisam ficar no
   cliente, sim fora dele, no meio da minha tela, no canto" → passo 2b.
   Texto original do passo:
   **Sonda** (`tools/sonda-foco.js`, injetada por `node tools/cdp.mjs eval`, sem ficar no plugin):
   grava em `window.__sondaFoco` a cada 100 ms `document.hasFocus()`, `document.visibilityState`,
   `GET /riotclient/ux-state` e a fase do gameflow, e embrulha `fetch`/`XMLHttpRequest` para registrar
   toda chamada a `/riotclient/*`. Ler depois de um ready check real com o client atrás de outra janela.
   **prova:** o registro mostra quem pediu o foco (chamada JS ou mudança do `ux-state` sem chamada JS).
   ⚠️ A sonda injetada morre quando o client fecha ou recarrega: reinjetar antes de cada fila de teste.
   Se o foco for nativo, a rota `ux-minimize` dá um **piscar** (o client aparece e some), não "nunca
   ganhar foco"; dizer isso ao Gabriel antes de fechar o passo 2.
2. [ ] **Código pronto (13/10/2026), falta prova no client.** Chave `focoNaPartida` (virou `aceite.trazerClient`) em `pengu/aceite.js` + `pengu/config.js` + `pengu/blocos.js`
   ("trazer o client para a frente ao achar partida", padrão **desligado**, só vale com o aceite
   automático ligado):
   - se o foco vem do JS: bloquear a chamada no embrulho de `fetch`/XHR durante o `ReadyCheck`;
   - se vem do nativo: guardar se o client tinha foco antes do `ReadyCheck` (eventos `focus`/`blur`
     da página); se não tinha e ganhou, `POST /riotclient/ux-minimize` (o Windows devolve o foco à
     janela anterior);
   - no `ChampSelect`, trazer o client de volta (`ux-show`), porque aí ele precisa escolher.
   **prova:** teste em `tools/teste-aceite.mjs` com LCU falsa (minimiza só quando não tinha foco; não
   minimiza com a chave ligada; `ux-show` no champ select) + uma fila real com o Gabriel olhando.

2b. [ ] **Código pronto (13/10/2026), falta prova no client.** **Aceitar/recusar fora do client** (`coletor/aviso_partida.py`; previsto em Tk, saiu em Win32 por ctypes, ver abaixo): no
   `ReadyCheck`, janelinha **sempre por cima e que não rouba o foco** (`WS_EX_NOACTIVATE | WS_EX_TOPMOST`)
   no canto da tela principal, com a contagem do aceite automático (10 s) e dois botões: **aceitar agora**
   (`POST /lol-matchmaking/v1/ready-check/accept`) e **recusar** (`.../decline`, que também cancela o aceite
   automático). Some quando a fase sai do `ReadyCheck`. Chave `aceiteFlutuante` no plugin. Junto, chave
   `esconderPopupPartida`: CSS `#lol-uikit-layer-manager-wrapper .modal:has(.ready-check-root-element)
   { display: none !important }` (o que os auto-accept antigos do Gabriel faziam: "Xerekton-AutoAccept",
   variante do AutoAccept do MTZ, e o AutoAcceptEnhanced de asherathegod/penguplugins; nenhum dos dois
   mexe no foco da janela, lidos em 13/10; o SimpleAccept de Ku-Tadao/IPostWeirdStuffHere dá 404). **prova:**
   teste com LCU falsa (botões chamam a rota certa, recusar cancela o aceite automático, a janela não muda
   o `GetForegroundWindow`) + uma fila real com o Gabriel.
   **Plugin feito em 13/10/2026** (sem o client): chaves com os nomes do contrato da leva, `aceite.trazerClient`
   (passo 2, no lugar de `focoNaPartida`), `aceite.esconderPopup` (CSS só com o aceite ligado:
   `html.lc-aceite.lc-esconder-popup`, popup escondido sem aceite = partida perdida) e `coach.aceiteFlutuante` +
   `coach.aceiteAtrasoS` (derivado, `null` com o aceite desligado) no `POST /config` (`coach.corpoConfig`).
   `node tools/teste-aceite.mjs` 27/27 (12 de foco). Falta: a janelinha do coletor e a prova numa fila real.
   **Revisão do plugin (13/10/2026):** o foco no iframe do chat esconde `focus`/`blur` da página de cima, então
   entrou uma sonda de `document.hasFocus()` a cada 250 ms (`FOCO.sondaMs`); o popup volta (`html.lc-aceite-manual`)
   no "não aceitar", no accept que falhou e no GET do ready-check que falhou. `teste-aceite.mjs` 35/35.
   **Janelinha do coletor feita em 13/10/2026:** Win32 por ctypes, **não Tk**: medido, o Tk ativa a própria janela
   ao nascer mesmo com `WS_EX_NOACTIVATE` (também embutido por `tk.Tk(use=)`), e o E9 do teste falhava sempre. A
   nova nasce escondida (`NOACTIVATE|TOPMOST|TOOLWINDOW`), aparece por `SetWindowPos(SWP_NOACTIVATE)` e responde
   `MA_NOACTIVATE`; contagem igual à do plugin (`coach.aceiteAtrasoS`, `null` = "expira em N s"); fecha sozinha em
   20 s; `LCU.post` é a única escrita do coletor, só no clique. Voltar a Tk é trocar a classe. Detalhe:
   [COLETOR](../docs/COLETOR.md) § Aviso de partida. `python tools/teste-aviso-partida.py` 53/53 (janela real,
   jogo fechado). Falta: a prova numa fila real com o Gabriel.
2c. [ ] **Código pronto (13/10/2026), falta prova no client.** **Silenciar o som de partida encontrada** (`aceite.silenciarSom`, padrão desligado; referência de
   terceiro sem licença, reescrita do zero): embrulho do `createSound` dos canais do `rcp-fe-audio`
   (`context.rcp.postInit`/`whenReady`), o som vira Proxy com `play()` mudo, decidido na hora do play; erro cai no
   original. Por padrão só o loop pós-aceite (`sfx-readycheck-ringmagic-accepted-loop.ogg`); o aviso de partida
   encontrada segue. **Feito no plugin em 13/10/2026** (`aceite.embrulharAudio`, 8 casos no `teste-aceite.mjs`).
   **prova:** fila real com a chave ligada: o loop não toca depois do aceite e a intro toca.
2d. [ ] **"Jogar de novo e buscar" no pós-jogo, freio de tilt e guarda de penalidade da fila rápida:** plano
   próprio, [2026-10-13-jogar-de-novo.md](2026-10-13-jogar-de-novo.md) (código pronto, falta prova no client).

### Fase B: voz pré-gravada

3. [x] **Feito em 13/10/2026** (relatório abaixo). **Catálogo genérico** (`coletor/avisos.py`): moldes de fala por rota (`{rota}` = "o top", "o
   jungler", "o mid", "o atirador", "o suporte") no lugar de `{campeao}`; rótulo da tela mantém
   `{campeao}`. Número de ouro sai da fala ("ouro guardado, hora de voltar"). `feitico_voltou`: "flash
   do mid voltou", "mid sem flash" (9 feitiços × 5 rotas). `pico_nivel`/`pico_item` e regras do
   `coach.py` com moldes próprios. Função `catalogo()` → todas as frases (tipo × tom × valores finitos
   de `{zona}`, `{n}` 2–5, `{objetivo}`, `{rota}`, `{feitico}`).
   **prova:** o ensaio da partida gravada (`tools/ensaio-coach.py`) produz falas 100% dentro do
   `catalogo()`, exceto as regras de texto livre, listadas.
3b. [x] **452 falas** (226 por tom; 13/10/2026, versão `b7043050b0b7`): pacote completo na Aoede (ver
   relatório). **Tamanho do catálogo:** contar as frases (zonas de `analise.regiao` e das falas de `avisos.py:603`,
   faixa real de `{n}` em `janela_objetivo`/`intruso_grupo`/`mortes_cedo`, 9 feitiços × 5 rotas, × 2 tons).
   Estimativa de 13/10: ~500 frases. Com o tempo por frase da bancada, decide: pacote completo na voz
   escolhida, ou só os tipos urgentes nela e o resto numa voz rápida. **prova:** contagem impressa por
   `python -c "from coletor.avisos import catalogo; print(len(catalogo()))"`.
4a. [ ] **Opcional desde a escolha da Aoede (13/10, noite).** O que importa em 14/10 é **terminar o pacote** (passo 6):
   a cota do dia vai primeiro para ele; só a sobra para a bancada. Pedido original do Gabriel ("pode completar o
   gemini amanhã, não esquece"): rodar `python tools/bancada-vozes.py --motores gemini` (Puck 4 de 6, Orus 6 de 6) e
   regerar o HTML. Bark: modelo de 13 GB **apagado em 13/10** com autorização do Gabriel (clipes das frases 1 e 6
   ficam no HTML; não serve ao pacote: RTF 32,5 e inventa áudio) — não retomar `--motores bark`.
4. [x] **Bancada de vozes** (`tools/bancada-vozes.py`, venv isolado em
   `%LOCALAPPDATA%\lol-client\voz\venv` com Python 3.11 do `uv`, nunca no Python do coletor): as
   mesmas 6 frases do catálogo em cada candidata, com o tempo de geração por frase:
   - **Coqui inteiro em português** (Gabriel, 13/10: "todas as vozes disponíveis pelo app, não só 4
     ou 8"): XTTS-v2 com **todos** os locutores embutidos (`pt`), YourTTS com todos os locutores
     (`pt-br`), `tts_models/pt/cv/vits` e Bark com os 10 presets `pt_speaker_*`; os outros modelos do
     catálogo ficam listados no HTML com o motivo (outro idioma, vocoder, conversão de voz, XTTS v1.1
     sem locutor embutido);
   - Piper (todas as vozes `pt_*` publicadas: faber, cadu, jeff, edresson + tugão pt-PT);
   - Kyutai Pocket TTS (tem `portuguese`: voz rafael, modelo 6 e 24 camadas, + 2 vozes de outro idioma);
   - Gemini TTS: Aoede + 5 variadas (chave `GEMINI_API_KEY` no Doppler `harness/dev`, não no `pessoal`;
     só o texto das frases sai da máquina);
   - Microsoft neurais (`edge-tts`: todas as `pt-*`; grátis, sem chave, serviço de leitura em voz alta
     do Edge, não oficial para uso por código);
   - Windows (controle): Maria Desktop (SAPI), Maria e Daniel (OneCore).
   Conferir antes se o `coqui-tts` aceita Python 3.11; o XTTS baixa ~2 GB na primeira rodada.
   Saída: `temp/vozes/` + **`temp/vozes/2026-10-13-vozes.html` standalone** (áudio em data URI
   Opus via `ffmpeg`, lado a lado, com o tempo de geração). Só roda com o jogo fechado.
   **prova:** o HTML abre sem rede e toca todas; tabela de tempos no § Relatório.
   **Feito em 13/10/2026 (14:00–17:28):** `temp/vozes/2026-10-13-vozes.html`, 11,1 MB, 540 clipes de 97 vozes;
   `grep -c "https\?://"` = 0; Edge headless em `file://` monta os 97 cartões; no navegador, 4 clipes de 4 motores
   carregam (`loadedmetadata`) e tocam, "tocar as 6", estrela, filtro e "copiar favoritas" conferidos. Escolha
   da voz: passo 5 (Gabriel).
5. [x] **Escolha (dono: Gabriel):** voz e tom, ouvindo o HTML. **13/10/2026:** "quero a aoede do gemini
   (coincidentemente a mesma que eu também gostei pro jarvis na central rs)". Tom: o da config (`tomVoz`
   "serio" hoje); o pacote grava os dois, o tom em uso primeiro.
6. [ ] **Parcial (13/10/2026, 21:00): 19 de 226 falas do tom sério no pacote, faltam 207** (+ 226 do descontraído);
   a cota grátis de todos os modelos de TTS acabou. **Desde o passo 6b a tarefa `lol-client-voz` retoma sozinha**
   (estado: `python tools/voz-agendada.py estado`). À mão: depois das ~04:00 de 14/10 (meia-noite do Pacífico),
   com o jogo fechado: `%LOCALAPPDATA%\lol-client\voz\venv\Scripts\python.exe tools\gerar-pacote-voz.py --voz aoede
   --tom serio` (~26 pedidos de 8; depois `--tom descontraido`). Prova até aqui: `teste-pacote-voz.py` 19/19; os 3
   lotes reais recusados pelo corte antigo alinharam 3/3 pelo corte guiado pela transcrição (detalhe no relatório).
   **Gerador do pacote** (`tools/gerar-pacote-voz.py --voz <id> [--tom serio|descontraido|ambos]`):
   gera o catálogo inteiro, retomável (pula o que já existe), normaliza volume (`ffmpeg loudnorm`),
   grava `indice.json` com a versão do catálogo. Recusa rodar com o jogo aberto.
   **prova:** contagem de arquivos = tamanho do catálogo; tempo total e tamanho em disco no relatório.
6b. [x] **Agendamento diário: completar o pacote e convergir para um modelo só** (pedido do Gabriel, 13/10/2026,
   ~21h, depois de saber que a cota grátis, ~10 pedidos/dia por modelo, fez o pacote misturar 4 modelos do Gemini
   TTS na mesma voz Aoede: "vamos misturando mas baixando o modelo completo ao longo dos dias. deixa o agendamento
   aí").
   **Entendimento:** hoje o gerador (passo 6) só roda à mão e, quando a cota do melhor modelo acaba, segue com o
   próximo; o pacote fica misturado (19 falas: 3.8-flash-lite 8, 3.1-flash-preview 4, 2.5-flash-preview 4,
   3.8-flash 3). O Gabriel aceita a mistura agora, desde que o pacote **vá sendo refeito no modelo melhor**, dia
   após dia, sem ninguém lembrar de rodar. A cota renova à meia-noite do Pacífico (04:00 BRT; 05:00 depois de
   01/11, fim do horário de verão americano).
   **Decisões (agente, técnicas; confiança alta salvo onde dito):**
   - **Modelo-alvo fixo no índice:** o primeiro da fila do `Gemini` (melhor: não-pro, não-lite, mais novo; hoje
     `gemini-3.8-flash-tts`) vira `modelo_alvo` no `indice.json` na 1ª rodada e não muda sozinho se a lista da API
     mudar; `--modelo-alvo <nome>` troca. Alvo fora da lista da API: completa o que falta com a fila e não converge.
   - **Rodada em duas fases:** (a) as falas que faltam, com a fila inteira (alvo primeiro, depois os outros); (b)
     só se (a) esvaziou a fila: refazer no alvo as falas com `modelo != alvo`, **só com o alvo** (cota do alvo
     acabou = para; nunca gasta outro modelo na convergência). Fase (b) não começa se a cota do alvo já morreu na (a).
   - **Substituição atômica:** a fala refeita ganha arquivo novo (`<hash>-<n>.wav`, nunca sobrescreve o que pode
     estar tocando); o índice troca só depois que a nova passou na mesma conferência (duração + Whisper +
     alinhamento) e o arquivo antigo é apagado depois do índice. Recusada (duração absurda, lote deslocado, ou
     ouvida errado mesmo refeita sozinha), a antiga fica intacta e a fala ganha `tentativas_alvo` (no máximo 1 por
     dia); com 3 recusas ela sai da convergência ("presa" no modelo antigo, listada no estado). Nunca troca uma fala
     boa por uma `suspeita`.
   - **Suspeitas seguem a regra atual:** o tocador pula, o gerador não refaz sozinho (`--refazer-suspeitas`); ficam
     fora da convergência e do denominador do "100% no alvo" (senão uma suspeita antiga impediria a tarefa de
     desligar). Confiança média: se o Gabriel quiser as suspeitas refeitas no alvo, é incluir na lista da fase (b).
   - **Meta no índice:** `progresso_alvo` = falas no alvo / total (catálogo dos dois tons), faltam, fora do alvo,
     presas, suspeitas; regravado a cada rodada, lido pelo estado e pelo agendador.
   - **Tocador:** o `coach_vivo._Partida` cria um `voz.Voz` novo por partida, que abre o `Pacote` de novo: falas
     novas entram na partida seguinte sem reiniciar o coletor. Além disso, o `Pacote` se relê quando o mtime do
     `indice.json` muda, sempre antes de uma fala (nunca no meio). O gerador recusa e para com o jogo aberto.
   - **Agendador** (`tools/voz-agendada.py`, Python do coletor via `pythonw`): tarefa `lol-client-voz` (XML pelo
     `schtasks /create /xml`, usuário atual, só logado, `InteractiveToken`, oculta), diária às 05:15 com repetição a
     cada 2 h até 23:15, uma instância por vez. Sai na hora com `League of Legends.exe` aberto ou o client fora de
     `None`/`Lobby`/`EndOfGame` (fase pela LCU como o coletor: credencial do lockfile só em memória); roda o gerador
     no venv do TTS com `--tom ambos`, prioridade abaixo do normal, **console oculto** (`CREATE_NO_WINDOW`: os filhos
     `doppler`/`ffmpeg`/`py` herdam e não abrem janela); para o gerador se o client entrar em fila no meio. Log com
     rotação em `dados/voz-agendada.log`. Pacote completo e 100% no alvo → `schtasks /change /disable` e registra.
   **Subpassos:** 1. gerador: alvo, duas fases, substituição atômica, progresso, trava de instância única;
   2. tocador: releitura por mtime; 3. `tools/voz-agendada.py` (`rodar`, `estado`, `instalar`, `remover`);
   4. testes em `tools/teste-pacote-voz.py` (sem rede, cota nem som); 5. registrar a tarefa e rodá-la uma vez com
   `schtasks /run` (só com o jogo fechado e o client em `None`/`Lobby`/`EndOfGame`; a cota do dia acabou, então ela
   para limpo no 429: prova Doppler, venv, log e saída sem janela); 6. COLETOR.md, ARMADILHAS.md.
   **prova:** `python tools/teste-pacote-voz.py` verde; log da execução agendada; `python tools/voz-agendada.py estado`.
   **Revisão adversarial (13/10/2026, 23:00–23:30), 12 achados, todos corrigidos com caso de teste** (`teste-pacote-voz.py`
   48/48, `teste-coach.py` 26/26; os casos 1 e 2 falharam antes da correção): (1) `--modelo-alvo` errado ou Gemini que
   não sobe não grava mais o nome no índice; (2) jogo abre no meio → o vigia mata o gerador na hora (antes 120 s) e as
   esperas da API (429 por minuto, rede) olham o arquivo de parada; (3) `os.replace` do índice tenta de novo no
   `PermissionError`; (4) recusa no alvo volta 1 vez por dia (3 recusas = 3 dias, não um dia ruim) e o log de desligar
   diz "100% do que o alvo aceitou" com presas/suspeitas; (5) falha de duração volta 1 vez por dia e segue contando em
   "faltam"; (6) trocar o alvo zera as recusas do antigo; (7) `estado` avisa tarefa desativada com fala faltando;
   (8) órfãos limpos e "nada a fazer" só com a trava; (9) Gemini antes do Whisper, Whisper sob demanda; (10) doc do
   nome de arquivo; (11) uma leitura "?" da LCU não para a rodada; (12) `sys.path` uma vez. **Decisão (agente, confiança
   média):** suspeitas seguem fora da convergência e do critério de desligar, como pedido ("seguem a regra atual"); o
   que muda é o log honesto. Reverter: incluir as suspeitas na lista da fase (b).
   **Feito em 13/10/2026 (22:00–22:45), commitado depois da revisão:** `teste-pacote-voz.py` 36/36 (17 casos novos), `teste-coach.py`
   26/26; tarefa registrada (próxima 14/10 05:15, `PT2H`/`PT18H1M`, oculta, `IgnoreNew`, `Interactive`/`Limited`);
   `/disable` e `/enable` reais sem senha. **Prova agendada (`schtasks /run`, 22:35, jogo fechado, fase `None`):**
   Doppler achado no contexto da tarefa, venv e log ok, alvo fixado (`gemini-3.8-flash-tts`, 1º da fila da API).
   `correção:` a cota do alvo **não** tinha acabado: 1 lote de 8 aceito (notas 0,88–1,0; pacote 27 de 452, 11 no
   alvo); o 2º pedido caiu com "Server disconnected without sending a response" (traceback, rc 1). Corrigido depois:
   falha passageira tenta de novo e para limpo (rc 2), progresso regravado num `finally`; provado só no teste (a
   rodada real seguinte é a das 05:15). Console oculto medido à parte: `GetConsoleWindow()` = 0 no filho e nos netos.
7. [x] **Feito e provado em 13/10/2026** (`teste-coach.py` 26/26 com pacote falso: toca do pacote, cai na Maria,
   registra a falta, urgente corta e fura, validade, `suspeita` fica na Maria, `.wav` que falha cai na Maria;
   `ensaio-coach.py` a 20x: 0 falhas, 26 de 26 falas no catálogo). Pendente fora do passo: reiniciar o coletor fora
   de partida (o de pé roda o código antigo); a escolha pelo plugin (`coach.vozPacote`) ficou para depois
   (plugin e `servidor_local` estavam com outra frente):
   hoje o pacote ativo é `voz.PACOTE_PADRAO` = `aoede` (`LOL_VOZ_PACOTE` troca). **Tocador** (`coletor/voz.py`): frase no pacote → toca o arquivo na mesma fila com prioridade
   (urgente fura, validade vale igual); fora do pacote → Maria ao vivo + `dados/voz-faltou.jsonl`.
   Configuração `coach.vozPacote` (lista os pacotes instalados pelo `servidor_local`; "Maria ao vivo"
   sempre disponível). **prova:** `tools/teste-coach.py` com pacote falso (3 wav) cobre: toca do
   pacote, cai na Maria, registra a falta, urgente fura a fila; ensaio completo passa.

### Fase C: tipos ligáveis por destino

8. [x] Configuração lista **todos** os tipos publicados (os 12 + `feitico_voltou`, `pico_nivel`,
   `pico_item`, `regra`), cada um com duas caixas: **voz** e **tela**. `avisosDesligados` vira
   `{voz: [...], tela: [...]}` com migração da lista antiga (lista antiga = desligado nos dois).
   **prova:** `tools/teste-alertas.py` (desligar só a voz de `gank` mantém a moldura) + teste do plugin.
   **Feito em 13/10/2026:** `python tools/teste-alertas.py --sem-janela` → ok (16/16, 5 casos novos de
   destino e migração); `python tools/teste-coach.py` → ok (13/13); `node tools/teste-config.mjs` (novo) →
   6/6; `node tools/teste-abas.mjs` → ok; render do `blocoAlertas` com UI falsa → 33 caixas (1 + 16 × 2).
   Não rodado (o Gabriel estava em partida): `tools/ensaio-coach.py` (a conferência do `POST /config` foi
   ajustada para o formato novo) e a janela real do `teste-alertas.py`.

### Fase D: fechamento

9. [ ] `docs/COLETOR.md` § Avisos ao vivo (catálogo, pacote, fallback), `docs/ARMADILHAS.md` (o que a
   sonda achou do foco), README (como trocar de voz e regerar o pacote), `CLAUDE.md` (regra: gerar
   pacote só com o jogo fechado). `tools/teste-minimapa.py` passo 5 pula sozinho quando o jogo está em
   primeiro plano (13/10 falhou por isso, com o Gabriel jogando). `python tools/rodar-testes.py` verde. Commit por pathspec, push,
   reiniciar o coletor fora de partida.

## O que o pedido não dizia

- **Nome na tela continua:** o genérico vale só para o áudio; na tela o nome não custa nada.
- **Frase que faltar não emudece o aviso:** cai na Maria e entra na lista do próximo pacote.
- **Gerar com o jogo fechado:** XTTS no processador disputaria quadro com o LoL.
- **Champ select traz o client de volta:** sem isso, minimizar no aceite deixaria ele sem ver a escolha.
- **Separar voz e tela por tipo:** hoje desligar um tipo apaga tudo; o pedido ("marcar ou desmarcar")
  fica mais útil se der para calar só a voz.
- **Tipos novos da v2 entram na lista:** Flash, picos e regras do coach não tinham chave.

## Descartado e impraticável

- **Coqui ao vivo durante a partida:** segundos por frase no processador, tarde demais para gank;
  pré-gravado resolve · agente.
- **Gemini TTS ao vivo:** atraso de rede no aviso de gank · agente (fica como gerador de pacote).

## Relatório de execução

- **Fase C (13/10/2026):** `avisos.normalizar_desligados` + `TIPOS_LIGAVEIS` (16 tipos; desconhecido = `regra`);
  o motor corta só o destino calado. `servidor_local` e `pengu/config.js` (`migrar`) convertem a lista antiga.
- Configurações › Alertas: uma linha por tipo com caixas "voz" e "tela". Provas no passo 8.
- Pendente: o coletor de pé roda o código antigo até reiniciar (fora de partida); ensaio completo idem.
- **Fase A, passos 2, 2b e 2c (13/10/2026, sem client):** código pronto no plugin (`aceite.js`, `config.js`,
  `coach.js`, `configuracoes.js`, `estilo.css`) e no coletor (`aviso_partida.py`, `coletor.py`, `servidor_local.py`).
  `python tools/rodar-testes.py` com o jogo fechado: 30/31 na rodada inteira; a falha foi o caso "moldura real: fora
  do print" do `teste-alertas.py` (código não tocado nesta leva), que passou 3/3 sozinho e 2/2 pelo `rodar-testes.py
  alertas aviso`: intermitente. Ensaio a 20x: 0 falhas. Nada provado no client real: falta uma fila com o Gabriel
  olhando (piscar e volta no champ select, janelinha aceitar/recusar, popup escondido, loop calado).
- **Passo 4, bancada de vozes (13/10/2026):** `tools/bancada-vozes.py` no venv
  `%LOCALAPPDATA%\lol-client\voz\venv` (CPython 3.11, `coqui-tts` 0.27.5, torch 2.11 CPU, `transformers` 4.57),
  prioridade BELOW_NORMAL, 1 subprocesso por motor. "s/frase" = só a síntese (sem carga do modelo); RTF = tempo
  de geração ÷ duração do áudio (acima de 1 = mais lento que a fala).

  | motor | vozes | s/frase | RTF | falhas / observação |
  | --- | --- | --- | --- | --- |
  | Coqui XTTS-v2 | 58 de 58 (26 M, 28 F, 4 "?") | 13,3 | 3,58 | 0 |
  | Coqui YourTTS (`pt-br`) | 6 de 6 | 1,2 | 0,28 | 0 |
  | Coqui VITS `pt/cv` | 1 de 1 | 1,5 | 0,48 | 0 |
  | Coqui Bark (presets `pt_speaker_*`) | 10 de 10, só frases 1 e 6 (+ 2 em 2 vozes) | 249 | 32,5 | teto de 90 min |
  | Piper (`pt_BR` ×4 + tugão `pt_PT`) | 5 de 5 | 0,39 | 0,13 | 0 |
  | Microsoft neurais (`edge-tts`, `pt-*`) | 5 de 5 | 1,7 | 0,48 | 0 |
  | Gemini TTS | 4 completas + Puck 2/6, Orus 0 | 4,2 | 1,22 | cota grátis diária de 4 modelos esgotada |
  | Kyutai Pocket TTS (`portuguese`) | 4 de 4 | 2,8 | 0,93 | 0 |
  | Windows (Maria SAPI, Maria e Daniel OneCore) | 3 de 3 | 0,03 | 0,01 | 0 |

  - Fora do Coqui (listados no HTML com o motivo): 90 modelos do catálogo (outras línguas, vocoders, conversão
    de voz; XTTS v1.1 fala `pt` mas não tem locutor embutido). Zira (en-US) fora do Windows.
  - Pausas pelo jogo: 2 (14:00, 210 s; 17:24, 60 s), registradas em `temp/vozes/pausas.jsonl`.
  - Para o 3b/6: pacote de ~500 frases no XTTS ≈ 500 × 13 s ≈ 1 h 50 min no processador (cabe, fora da partida);
    Bark (~4 min por frase e às vezes inventa: 14 s de áudio para "gank provável no rio top") não serve.
  - Retomar o que faltou: `...\venv\Scripts\python.exe tools\bancada-vozes.py --motores gemini` (amanhã, cota
    renovada) ou `--motores bark` (mais 90 min); clipe existente não é refeito.
  - Modelos em disco (fora do repo): `%LOCALAPPDATA%\tts` 15 GB (Bark 13 GB, XTTS ~2 GB), cache do Hugging Face
    (Pocket), `%LOCALAPPDATA%\lol-client\voz\` (venv, Piper, presets do Bark). Limpeza: decisão do Gabriel.
- **Fase B, passos 3, 3b, 6 e 7 (13/10/2026, noite; sem gerar o pacote, sem reiniciar o coletor):**
  - **Catálogo** (`avisos.py`): fala genérica (`{rota}` de `ROTA_FALA` + "inimigo", sem `{campeao}` nem `{ouro}`);
    rótulo mantém o nome. Moldes novos `feitico_voltou`, `pico_nivel`, `pico_nivel_visto`, `pico_item`
    (feiticos/sugestoes mandam `dados` + `molde`; `coach_vivo` publica por `avisos.aviso_de`). `ROTA_FALA` mudou de
    dono para o `avisos.py`. `docs/LICOES.md` § Avisos ao vivo reescrita junto (ela vence o `TEXTOS`).
    `catalogo()` = **452 falas** (226 por tom): gank 6, intruso_grupo 24, intruso 36, jungler_apareceu 22,
    mid_indo 18, mid_sumiu 2, janela_objetivo 48, objetivo_60s 10, mortes_cedo 2, adversario_voltou 8,
    inimigo_fed 10, ouro_guardado 2, feitico_marcado 96, feitico_desfeito 2, feitico_voltou 96, pico_nivel 30,
    pico_nivel_visto 30, pico_item 10. Feitiços com cronômetro são **8** (não 9: Golpear não tem cronômetro).
    Texto livre: `avisos.LIVRES = ("regra",)`; nenhuma regra do coach.py chega ao motor hoje.
  - **Decisões (agente, técnicas):** "talvez" do Flash incerto saiu da fala (dobraria 96 → 192; o ± segue no painel);
    pico fala o nível cruzado (6/11/16), não o real; `{n}` em algarismo (o TTS lê, a conferência normaliza);
    3b: pacote completo na Aoede (~57 pedidos de 8 frases; o tom em uso e os tipos urgentes primeiro, se a cota
    acabar no meio). Reverter: voltar a fala no `TEXTOS` + `LICOES.md` (fica fora do pacote, cai na Maria).
  - **Gerador** (`tools/gerar-pacote-voz.py`, venv do TTS): lotes de frases por parágrafo (sem número nem
    instrução), corte pelo `silencedetect` nas n-1 maiores pausas (≥ 0,45 s e ≥ 1,3× a maior de dentro), duração
    0,5–2× da esperada (calibrada nos clipes da Aoede: 0,35 + 0,075 s/caractere), senão divide ao meio; frase
    sozinha absurda vai para `falhas`. `loudnorm` 2 passadas → PCM 24 kHz. Conferência pelo Whisper do Reco
    (`tools/conferir-trechos.py`, `py -3.14` com `openvino_genai` já instalado, modelo local small int8, CPU, ~2,3 s
    por trecho; nos 5 clipes da bancada notas 0,96–1,0): nota < 0,6 refaz sozinha 1 vez, depois `suspeita`.
    Retomável, índice atômico por lote, para limpo na cota diária (rc 2) e com o jogo aberto (rc 3).
    **14/10: calibrar antes** com `--lote 3 --max-pedidos 1` (o comportamento de pausa do Gemini entre parágrafos
    não foi medido: cota zerada), depois `--lote 8`.
  - **Tocador** (`voz.py`): `Pacote` + `.wav` por `winsound` na mesma fila; corte por `Event` (urgente,
    desligar, parar); fora do pacote → Maria + `dados/voz-faltou.jsonl` (1 vez por frase por processo). Teste seco
    nunca abre o pacote padrão. Conferido à mão: `.wav` de silêncio real, corte em 0,31 s e inteiro em 2,05 s.
  - **Provas:** `teste-coach.py` 25/25 (catálogo, zonas, fontes, molde com `{campeao}` fica fora, pacote falso
    com 3 wav: toca do pacote, cai na Maria, registra a falta, urgente corta e fura, validade); `teste-pacote-voz.py`
    12/12 (novo, no `rodar-testes.py`); `teste-alertas.py --sem-janela` 33/33; `teste-feiticos.py` e
    `teste-sugestoes.py` ok; `ensaio-coach.py` a 20x: 0 falhas, **25 de 25 falas dentro do catálogo**, texto livre
    nenhum. ⚠️ O ensaio rodou com `League of Legends.exe` aberto (o Gabriel entrou em partida durante a sessão; a
    conferência do processo saiu na mesma linha e não barrou): ~2 min de processador durante o jogo dele.
  - Pendente: gerar o pacote (14/10), reiniciar o coletor fora de partida (o de pé roda o código antigo),
    `rodar-testes.py` inteiro com o jogo fechado, escolha do pacote pelo plugin (`coach.vozPacote`).
- **Revisão do pacote de voz e 1ª geração real (13/10/2026, 20:30–21:00, jogo fechado):**
  - **Achados corrigidos (revisão adversarial):** (1) corte deslocado passava pela nota do Whisper (vizinhas do mesmo
    molde: 0,82–0,85) → o trecho tem de soar mais como a própria frase do que como qualquer vizinha, senão o lote
    inteiro sai; texto 1,4× maior = frases grudadas; lotes em rodízio de moldes; `DUR_MAX` 2 → 1,5. (2) `suspeita`
    tocava no jogo → `voz.Pacote` pula (Maria); não volta à fila sozinha (`--refazer-suspeitas`). (3) Whisper morto ou
    resposta curta deixava lotes sem conferência → `ConferenciaFalhou` para a rodada sem gravar (saída 1). (4)
    divisão ao meio gastava a cota → ver abaixo. (5) `.wav` que falha ao tocar perdia a fala e deixava o PowerShell
    órfão → cai na Maria; o processo é morto antes de reabrir.
  - **Medido na 1ª rodada real:** calibração `--lote 3 --max-pedidos 1` aceita (notas 0,95–1,0); com `--lote 8`, 3 de
    6 pedidos recusados por "pausas ambíguas": pausa entre frases 0,41–0,88 s, de vírgula/dois-pontos 0,39–0,53 s
    (trocar dois-pontos por vírgula não muda), e um pedaço solto "E aí" no fim de todo lote. **Decisão (agente,
    técnica, confiança alta):** corte guiado pela transcrição (`cortar_por_transcricao` + `alinhar`): o silêncio só
    separa pedaços, o Whisper transcreve cada um e o alinhamento junta pedaços por frase, largando até 2 soltos nas
    pontas. Os 3 lotes recusados alinharam 3/3 sem gastar cota; o lote de 8 recusado já pago entrou no pacote assim.
    Reverter: `--sem-conferir` volta ao corte só pelo silêncio.
  - **Pacote:** 19 de 226 falas do tom sério (1,8 MB), faltam 207; 0 suspeitas; notas 0,74–1,0 (a menor: "mid
    sumiu" ouvido "Me desumiu"). A cota grátis acabou em 5 modelos (3.8-flash, 3.1-flash-preview, 2.5-flash-preview,
    3.8-flash-lite, 2.5-pro-preview): **o pacote mistura modelos** da mesma voz Aoede; se o Gabriel ouvir diferença,
    regerar as falas de um modelo (o `indice.json` grava o modelo de cada uma).
  - **Provas:** `teste-pacote-voz.py` 19/19, `teste-coach.py` 26/26, `rodar-testes.py` 36/37 com o jogo fechado (a
    falha é `teste-compacto.mjs` 82/83, da frente do client compacto, fora desta); `ensaio-coach.py` a 20x: 0 falhas,
    26 de 26 falas no catálogo. Catálogo inalterado: 452 falas, versão `b7043050b0b7`.
