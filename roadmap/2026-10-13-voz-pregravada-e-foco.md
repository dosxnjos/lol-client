# Voz pré-gravada do coach + foco do client ao achar partida

- **Data:** 13/10/2026 · **Alvo:** `coletor/avisos.py`, `coletor/voz.py`, `pengu/aceite.js`, `pengu/blocos.js`,
  ferramentas novas em `tools/` · **Depende de:** v2 entregue (`0d1f1db`, plano
  [2026-10-13-lol-client-v2-coach.md](2026-10-13-lol-client-v2-coach.md))

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

1. [ ] **Sonda** (`tools/sonda-foco.js`, injetada por `node tools/cdp.mjs eval`, sem ficar no plugin):
   grava em `window.__sondaFoco` a cada 100 ms `document.hasFocus()`, `document.visibilityState`,
   `GET /riotclient/ux-state` e a fase do gameflow, e embrulha `fetch`/`XMLHttpRequest` para registrar
   toda chamada a `/riotclient/*`. Ler depois de um ready check real com o client atrás de outra janela.
   **prova:** o registro mostra quem pediu o foco (chamada JS ou mudança do `ux-state` sem chamada JS).
   ⚠️ A sonda injetada morre quando o client fecha ou recarrega: reinjetar antes de cada fila de teste.
   Se o foco for nativo, a rota `ux-minimize` dá um **piscar** (o client aparece e some), não "nunca
   ganhar foco"; dizer isso ao Gabriel antes de fechar o passo 2.
2. [ ] **Chave `focoNaPartida`** em `pengu/aceite.js` + `pengu/config.js` + `pengu/blocos.js`
   ("trazer o client para a frente ao achar partida", padrão **desligado**, só vale com o aceite
   automático ligado):
   - se o foco vem do JS: bloquear a chamada no embrulho de `fetch`/XHR durante o `ReadyCheck`;
   - se vem do nativo: guardar se o client tinha foco antes do `ReadyCheck` (eventos `focus`/`blur`
     da página); se não tinha e ganhou, `POST /riotclient/ux-minimize` (o Windows devolve o foco à
     janela anterior);
   - no `ChampSelect`, trazer o client de volta (`ux-show`), porque aí ele precisa escolher.
   **prova:** teste em `tools/teste-aceite.mjs` com LCU falsa (minimiza só quando não tinha foco; não
   minimiza com a chave ligada; `ux-show` no champ select) + uma fila real com o Gabriel olhando.

### Fase B: voz pré-gravada

3. [ ] **Catálogo genérico** (`coletor/avisos.py`): moldes de fala por rota (`{rota}` = "o top", "o
   jungler", "o mid", "o atirador", "o suporte") no lugar de `{campeao}`; rótulo da tela mantém
   `{campeao}`. Número de ouro sai da fala ("ouro guardado, hora de voltar"). `feitico_voltou`: "flash
   do mid voltou", "mid sem flash" (9 feitiços × 5 rotas). `pico_nivel`/`pico_item` e regras do
   `coach.py` com moldes próprios. Função `catalogo()` → todas as frases (tipo × tom × valores finitos
   de `{zona}`, `{n}` 2–5, `{objetivo}`, `{rota}`, `{feitico}`).
   **prova:** o ensaio da partida gravada (`tools/ensaio-coach.py`) produz falas 100% dentro do
   `catalogo()`, exceto as regras de texto livre, listadas.
3b. [ ] **Tamanho do catálogo:** contar as frases (zonas de `analise.regiao` e das falas de `avisos.py:603`,
   faixa real de `{n}` em `janela_objetivo`/`intruso_grupo`/`mortes_cedo`, 9 feitiços × 5 rotas, × 2 tons).
   Estimativa de 13/10: ~500 frases. Com o tempo por frase da bancada, decide: pacote completo na voz
   escolhida, ou só os tipos urgentes nela e o resto numa voz rápida. **prova:** contagem impressa por
   `python -c "from coletor.avisos import catalogo; print(len(catalogo()))"`.
4. [ ] **Bancada de vozes** (`tools/bancada-vozes.py`, venv isolado em
   `%LOCALAPPDATA%\lol-client\voz\venv` com Python 3.11 do `uv`, nunca no Python do coletor): as
   mesmas 6 frases do catálogo em cada candidata, com o tempo de geração por frase:
   - Coqui XTTS-v2 (`coqui-tts`, licença CPML, uso pessoal): 4 locutores masculinos e 4 femininos
     embutidos, idioma `pt`;
   - Piper pt-BR (todas as vozes publicadas: faber e as que houver);
   - Kyutai Pocket TTS, se tiver voz em português;
   - Gemini TTS: Aoede + 2 masculinas (chave do Doppler, só texto das frases sai da máquina);
   - Microsoft neurais pt-BR (`edge-tts`: Antonio, Francisca, Thalita; grátis, sem chave, serviço de
     leitura em voz alta do Edge, não oficial para uso por código);
   - Daniel (OneCore, já instalado) e Maria do Windows (controle).
   Conferir antes se o `coqui-tts` aceita Python 3.11; o XTTS baixa ~2 GB na primeira rodada.
   Saída: `temp/vozes/` + **`temp/vozes/2026-10-13-vozes.html` standalone** (áudio em data URI
   Opus via `ffmpeg`, lado a lado, com o tempo de geração). Só roda com o jogo fechado.
   **prova:** o HTML abre sem rede e toca todas; tabela de tempos no § Relatório.
5. [ ] **Escolha (dono: Gabriel):** voz e tom, ouvindo o HTML.
6. [ ] **Gerador do pacote** (`tools/gerar-pacote-voz.py --voz <id> [--tom serio|descontraido|ambos]`):
   gera o catálogo inteiro, retomável (pula o que já existe), normaliza volume (`ffmpeg loudnorm`),
   grava `indice.json` com a versão do catálogo. Recusa rodar com o jogo aberto.
   **prova:** contagem de arquivos = tamanho do catálogo; tempo total e tamanho em disco no relatório.
7. [ ] **Tocador** (`coletor/voz.py`): frase no pacote → toca o arquivo na mesma fila com prioridade
   (urgente fura, validade vale igual); fora do pacote → Maria ao vivo + `dados/voz-faltou.jsonl`.
   Configuração `coach.vozPacote` (lista os pacotes instalados pelo `servidor_local`; "Maria ao vivo"
   sempre disponível). **prova:** `tools/teste-coach.py` com pacote falso (3 wav) cobre: toca do
   pacote, cai na Maria, registra a falta, urgente fura a fila; ensaio completo passa.

### Fase C: tipos ligáveis por destino

8. [ ] Configuração lista **todos** os tipos publicados (os 12 + `feitico_voltou`, `pico_nivel`,
   `pico_item`, `regra`), cada um com duas caixas: **voz** e **tela**. `avisosDesligados` vira
   `{voz: [...], tela: [...]}` com migração da lista antiga (lista antiga = desligado nos dois).
   **prova:** `tools/teste-alertas.py` (desligar só a voz de `gank` mantém a moldura) + teste do plugin.

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

(preencher)
