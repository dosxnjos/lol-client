# Plano — publicação, aviso de versão com botão Atualizar e complemento coach público com a voz (2026-10-19)

Plano para um executor que nunca viu a conversa. Projeto `C:\Dev\lol-client`. Continua o
[plugin Pengu primeiro](2026-10-17-plugin-pengu-primeiro.md): substitui o passo 3 da Fase 8 dele (verificação de versão) e
a Fase 9 (complemento público). As Fases 1 a 7 e os passos 1, 2 e 4 da Fase 8 de lá continuam lá. Antes do 1º Edit: hub
`C:\Dev\cerebro\projetos\lol-client.md` (§ Fronteira), `CLAUDE.md`, `docs/ARMADILHAS.md`, `docs/COLETOR.md`,
`docs/TEXTOS-DA-INTERFACE.md`.

Estado (19/10/2026): plano escrito; nada executado. Depende da Fase 1 do plano Pengu (aperto de mão `GET /ola` com
`recursos`). Relatórios no sidecar `roadmap/2026-10-19-publicacao-e-complemento-publico.d/`.
P0-b, c e d medidos em 19/10 ([relatório](2026-10-19-publicacao-e-complemento-publico.d/2026-10-19-p0.md)); P0-a pendente
(orquestrador, com o Gabriel). Achados que mudam fases: `dados/` dentro da pasta trocada (P3/P4), `travadas` sem proteção,
`/ola` sem chave de edição, `ddragon` fora da origem fixa.
Revisão adversarial do P0 (19/10, 7 achados reais, tabela no relatório): o código da lista leva 31 citações de 8 gameIds
dele nos comentários (varredura nova `tools/varrer-publico.py` reprova; P4 tira), `coletor.py` sai ocioso em 10 min sem
o gatilho e o vigia (P4.3), faixas de calibração do chat fixas em 1080 de altura (P4.2), `ensaio-coach.py` não roda na
lista (P4.5), `vida.py` vai junto; nome tirado do `docs/ITENS.md` e de 1 string do `aviso_partida.py`.
**P1 feita em 19/10** (`71c2744`, `7c18f98`, `2e56520`, `8016795`; `teste-publicar.py` 43/43, `teste-varrer-publico.py` 39/39):
`tools/publicar.py` em ensaio sobre o HEAD = plugin 50 arquivos limpo, complemento 32 e foto 78 reprovados só por 28 gameIds
(P4.1) e pelos `.cmd` (P3.3, P4.3); `pengu/versao.js` 0.1.0 já existe; voz fica no P5
([relatório](2026-10-19-publicacao-e-complemento-publico.d/2026-10-19-p1.md)).
Revisão adversarial do P1 (19/10, `f419daf`, `fd33373`; 9 achados = 7 distintos, todos reais e corrigidos, tabela no
relatório): gameId com fronteira de dígito, credencial e caminho mais largos, nome do arquivo e `--notas` varridos,
complemento leva `pengu/`, release que cai depois do push se retoma; `teste-varrer-publico.py` 72/72, `teste-publicar.py` 52/52.
**P2 feita em 19/10** (`64f87aa`, `a0ff36f`, `6b15d98`; `teste-atualizacao.mjs` 79/79, 31 `.mjs` verdes): `pengu/atualizacao.js`
(1 GET por dia só em None/Lobby, 5 s, erro calado), linha no topo da ⚙, ponto no ⚙ do compacto, bloco Atualizações; o
"atualizar" chama `registrarAtualizador` (P3) ([relatório](2026-10-19-publicacao-e-complemento-publico.d/2026-10-19-p2.md)).
Revisão adversarial da P2 (19/10, `ef59f7a`; 6 achados, todos reais e corrigidos, tabela no relatório): limite diário também em
memória, "procurar agora" some só durante o clique, resultado velho do clique e mensagem de versão antiga apagados, desligar a
chave tira a linha; `teste-atualizacao.mjs` 87/87 (81/87 no código de antes).
**P3 feita em 19/10** (`8877043`, `9d66dac`, `43a1aaa`, `dd07d37`, `ea814f8`, docs `fb18e65`; `teste-atualizar.py` 84/84, `teste-atualizador.mjs`
46/46): `POST /atualizar` (`coletor/atualizar.py`) e `publico/atualizar.cmd` com origem fixa, sha256 = SHA256SUMS = digest, troca
**item a item** em `<pasta>\.atualizacao` (o `dados\` fica; desvio da decisão 5), recusa de junção e `.git`; reinício só em
None/Lobby; sem complemento, `atualizar.cmd` e "copiar link" ([relatório](2026-10-19-publicacao-e-complemento-publico.d/2026-10-19-p3.md)).
Revisão adversarial da P3 (19/10, `a60a7c0`, `4b34912`, `163bc67`, `0d6183f`; 11 achados, todos reais e corrigidos, tabela no
relatório): fase conferida de novo antes de trocar e reinício logo depois do "pronto", junção vista sem `resolve()`, `.git` até a
pasta do usuário, marca de troca incompleta, POST sem Origin = 403, `!` no `.cmd`; `teste-atualizar.py` 101/101 (84/101 antes).
**P4 feita em 19/10** (`cd4a7d7` a `bbbae08` + docs; `teste-instalacao.py` 40/40, `teste-instalar.py` 31/31 com o `ensaio-coach.py
--publico --porta 8833 --porta-sim 8834` 38/38 no python do venv com `-I`, `teste-atualizar.py` 102/102, `teste-publicar.py` 53/53,
`publicar.py` ensaio **APROVADO** com 0 achados): edição pública pelo arquivo `EDICAO` (a instalação dele segue completa), pasta
do LoL e monitor sem fixo, calibração do chat por resolução, `instalar.cmd`/`desinstalar.cmd`, `coletor/relancador.py`; os `.cmd`
fazem tudo na 1ª linha (na página UTF-8 o cmd rodava pedaços do PowerShell como lote, o `atualizar.cmd` da P3 inclusive). `dados\`
fica dentro da pasta do complemento (desvio do P0 achado 1). Python 3.12/3.13 não provados (só há 3.14 e 3.11 aqui)
([relatório](2026-10-19-publicacao-e-complemento-publico.d/2026-10-19-p4.md)).
Revisão adversarial da P4 (19/10, `257d60b`, `124686b`, `e613a49`; 5 achados, todos reais e corrigidos, tabela no relatório):
`monitorPainel` do LEIA-ME era JSON inválido, `instalar.cmd` de dentro da pasta instalada, acento no caminho do Python, venv sem
pip, complemento parado e venv apagado na falha; `teste-instalacao.py` 47/47 (41 antes), `teste-instalar.py` 35/35 (30/34 antes).

## Pedido (Gabriel, 19/10/2026, palavras dele)

"Pode criar um repositório público. Aí dá para deixar o aviso quando tiver versão nova. Se possível, com botão para update.
update automatizado ao clicar no botão, se possível. Se possível, também com o coach de voz. Com o botão que faz baixar os
áudios."

## O que dá e o que não dá (correção da premissa)

- **Atualizar com 1 clique só existe com o complemento coach instalado.** O Pengu Loader 1.1.6 não deixa o plugin escrever
  nos próprios arquivos (`context.fs` só no 1.2, pré-lançamento). O complemento (Python) escreve: a pasta
  `C:\Program Files\Pengu Loader\plugins` dá controle total a "Todos" (medido em 17/10, `icacls`). Então:
  - **com o complemento:** o botão Atualizar pede ao complemento, que baixa, confere e troca os arquivos do plugin e os dele;
    o plugin pede para recarregar a interface (só no menu, por clique);
  - **sem o complemento:** o botão abre a página da versão no navegador, se a medição P0-a provar que o client abre o
    navegador; senão mostra o caminho do `atualizar.cmd`, que vem no pacote e faz a mesma troca com um duplo clique.
- **O botão que baixa os áudios também é do complemento:** a voz toca no Python (`coletor/voz.py`), o plugin só tem o botão.
- Nunca: o plugin carregar código remoto em tempo de execução (`import` de URL, `eval` de texto baixado). Isso seria
  "atualização automática" sem escrever arquivo, mas daria a qualquer um que tomasse o repositório ou a CDN o controle do
  client de quem instalou, com a LCU na mão. Atualização é sempre arquivo trocado, conferido por hash, num clique dele.

## Decisões (Gabriel; ver o plano Pengu § Decisões do Gabriel)

- Repositório público **novo**, só com o que se distribui. O privado `dosxnjos/lol-client` continua sendo onde se trabalha.
- MIT; só pt-BR; nome nos comentários fica.
- Complemento público **com** o pacote de voz Aoede (gerado pelo Gemini; termos do Google: decisão dele, 19/10).
- Aviso de versão nova pela `api.github.com`, 1 vez por dia, com chave para desligar (ligada por padrão).
- **Nome: `lol-ultra-client`** (Gabriel, 19/10: "lol minimal client, algo assim", e logo depois "pode ser na verdade lol
  ultra client"). Conta: `dosxnjos`, a pessoal, a mesma
  do privado; ele respondeu o nome e não contestou a conta recomendada, e o Grupo Nomura não tem relação com o projeto
  (confirmar em 1 linha no P6, antes do `gh repo create`). `REPO = 'dosxnjos/lol-ultra-client'` em `pengu/versao.js`;
  enquanto o repositório não existe, a consulta dá 404 e fica calada (P2).

## Decisões técnicas (agente; confiança e o que reverteria)

1. **Repositório público = foto do que se distribui, um commit por versão**, nunca a história do privado (roadmaps, dados,
   mentor, MCP e nomes de partidas ficam fora). `tools/publicar.py` monta a foto a partir de uma lista do que entra
   (lista de inclusão, nunca de exclusão), roda a varredura (P1) e commita num clone em `dist/publico/` (ignorado pelo
   `.gitignore` do privado). Confiança alta. Reverte: publicar a história filtrada (`git filter-repo`), que expõe mais.
2. **Versão = `pengu/versao.js`** (`VERSAO = 'x.y.z'`, `REPO`), uma constante lida pelo plugin, pelo complemento (`/ola`
   devolve a mesma) e pelo `publicar.py` (tag `vx.y.z`). Plugin e complemento saem sempre juntos na mesma versão.
3. **Assets do release:** `lol-ultra-client-plugin-x.y.z.zip`, `lol-ultra-client-complemento-x.y.z.zip`,
   `voz-aoede-<versao_catalogo>.zip` (só quando o catálogo muda; ~42 MB de `.wav`) e `SHA256SUMS.txt`. Quem baixa confere o
   hash do `SHA256SUMS.txt` **e** o `digest` que a API do GitHub devolve por asset; os dois têm de bater. Confiança média
   (o `digest` por asset é recente na API: medir no P0-b; sem ele, só o `SHA256SUMS.txt`).
4. **Origem fixa:** o complemento e o `atualizar.cmd` só baixam de `https://api.github.com/repos/<REPO>/releases/...` e
   dos `browser_download_url` desse release (host `github.com` ou `objects.githubusercontent.com`, redirecionamento
   conferido). Nada de URL vinda do plugin: o `POST /atualizar` leva só a versão; o complemento acha a URL sozinho.
5. **Troca com volta:** extrai para `<pasta>.nova`, confere que todo arquivo da lista do zip chegou, renomeia a atual para
   `<pasta>.anterior` (guarda 1) e a nova para o lugar. Falha no meio → devolve a anterior. **Nunca troca uma junção nem
   uma pasta com `.git`** (é a instalação de desenvolvimento do Gabriel: `plugins\lol-client` é junção para
   `C:\Dev\lol-client\pengu`); nesse caso o botão diz que a instalação é de desenvolvimento e não faz nada.
6. **Nomes internos não mudam** (`lol-client.` no DataStore, `%LOCALAPPDATA%\lol-client`), para a instalação dele não
   migrar nada. Só o nome público e a pasta do plugin na instalação nova mudam. Confiança alta.

## Fases

### P0 — medições (só leitura; com o Gabriel por perto para a a)

- **a. O client abre o navegador?** Em `None`, `window.open('https://github.com', '_blank')` pelo `tools/cdp.mjs eval`.
  Anotar se abriu o navegador padrão, uma janela do CEF ou nada. Decide o botão sem complemento.
- **b. Release da API do GitHub de dentro do client:** `fetch('https://api.github.com/repos/<um repo público qualquer com
  release>/releases/latest')` em `None`: status, CORS, se cada asset traz `digest`. (CORS já medido ok em 17/10 para a raiz.)
  **Medido 19/10:** 200 e `type: cors` (Pengu e `cli/cli`), 213–1066 ms, `x-ratelimit-*` legíveis (60/h sem login).
  `digest` existe no esquema: `null` nos 2 assets do Pengu `v1.1.6` (2024), `sha256:` em 22/22 do `gh v2.102.0` (09/2026).
  Release nosso é novo: `digest` nulo = falha, não recuo para só o `SHA256SUMS.txt`.
- **c. Catálogo da voz sem nada pessoal:** varrer as frases do pacote Aoede (`indice.json`) por "Gabriel", "Xerek",
  nome de jogador, Riot ID. Frase pessoal sai do catálogo público (o pacote público pode ser um subconjunto).
  **Medido 19/10:** 476 falas (~42 MB), 7.440 textos do índice e 476 falas + 104 moldes do repo, **0 achados**; a varredura
  acha 6/6 plantados. Sem nome por construção (fala = molde × valores finitos). O pacote público é o pacote inteiro; o
  `indice.json` público pode sair enxuto (o `voz.py` lê só `arquivo` e `suspeita` por fala).
- **d. Dependências do coach ao vivo:** listar o que o caminho do coach importa (`coach_vivo.py`, `avisos.py`, `voz.py`,
  `janela_painel.py`, overlay, minimapa, OCR dos feitiços, `teclas.py`, aceite) e o que é só da instalação dele (mentor,
  MCP, `riotapi.py`, vitrine, travadas, medidores, expansões). Sai a lista de inclusão do complemento e o
  `requirements.txt` com versão fixa.
  **Medido 19/10:** entrada é o `coletor.py`; inclui 21 módulos de `coletor/` + `painel/` + 4 `.md`; fora `mentor`,
  `riotapi`, `carregamento`, `draft`, `vitrine`, `travadas`, `expansoes` (7 cortes tardios; `coletor.py:740` → `travadas`
  sem `try` derruba o coach em `InProgress`). Versões em `requirements-complemento.txt` (6 libs, 6/6 = instaladas).
  Fixo da máquina: `DISPLAY1`, `C:\Games\Riot Games` (sem reserva em `teclas.py:27` e `minimapa.py:27`), gatilho com
  admin. Detalhe e tabela de cortes no relatório.

### P1 — `tools/publicar.py` e a varredura

1. Lista de inclusão do plugin (`git ls-files pengu/` menos os arquivos de desenvolvimento) e do complemento (saída do
   P0-d), mais `LICENSE` (MIT), `TERCEIROS.md`, `LEIA-ME.md`, `instalar.cmd`, `atualizar.cmd`.
2. Varredura que reprova a foto: credencial (padrões do `guarda-segredo`, `RGAPI-`, `gho_`, token, `-RiotClientAuthToken`),
   "Xerekton", puuid, `C:\Dev`, `C:\Users\`, e-mail, nome de projeto Nomura, chave do Doppler. "Gabriel" em comentário
   passa (decisão dele); em texto visível ou literal reprova (Fase 8 do plano Pengu).
   **Já existe (revisão do P0, 19/10):** `tools/varrer-publico.py` (`varrer(raiz, arquivos, banco)`; prova
   `tools/teste-varrer-publico.py`); o `publicar.py` chama ela sobre a foto montada, nunca sobre o privado. Regras que a
   revisão fixou: **partida** = número de 10 dígitos, `PLATAFORMA_<n>` e qualquer `game_id` do `dados/lol.db` (aberto
   `mode=ro`); **puuid** = o valor (78 caracteres ou UUID) e o puuid e o Riot ID do `meta` do banco, nunca a palavra
   `puuid` (é nome de campo em 7 módulos); Python: comentário **e docstring** passam, string e f-string reprovam; JS, CSS,
   HTML: comentário passa; `.md` da lista reprova sempre. Varre os 21 módulos, `painel/` e os 4 `.md` (não só a voz).
3. Zips e `SHA256SUMS.txt` em `dist/`; commit da foto em `dist/publico/` e `gh release create` **só com `--publicar`**;
   sem a opção, é ensaio (monta, varre, mostra o que entraria).
4. Prova: `tools/teste-publicar.py` com uma árvore falsa (arquivo com segredo plantado reprova; `# partida 3293149183`
   plantado num módulo reprova; arquivo fora da lista não entra; zip reabre e todo `import` do plugin resolve dentro dele).

### P2 — aviso de versão nova no plugin

1. `pengu/versao.js` e `pengu/atualizacao.js`: com `REPO` preenchido e a chave `atualizacao.verificar` ligada, 1 consulta
   por dia (`lol-client.atualizacao` no DataStore guarda a hora e a última versão vista), só em `None`/`Lobby`, prazo 5 s,
   erro calado (sem aviso de falha).
2. Versão mais nova → uma linha na ⚙ ("Versão x.y.z disponível") com o botão Atualizar e o link "O que mudou" (corpo do
   release, como texto, nunca HTML), e um ponto discreto no botão ⚙ do compacto. Nada abre sozinho.
3. Bloco "Atualizações" nas Configurações: chave "Procurar versão nova uma vez por dia", versão instalada, "Procurar agora".
4. Textos no guia (`teste-textos.mjs`); ícone do `icones.js`.
5. Prova: `tools/teste-atualizacao.mjs` (fetch espião, relógio falso): 1 consulta por dia, nenhuma com a chave desligada ou
   `REPO` vazio, nenhuma fora de `None`/`Lobby`, comparação de versão (`1.10.0` > `1.9.3`), resposta malformada calada.

### P3 — botão Atualizar

1. **Com o complemento anunciando `atualizar`:** `POST /atualizar {versao}` (Origin do client ou do Pengu, como o
   `/aceite/plugin`) → o complemento baixa os dois zips, confere hash (decisão 3), troca o plugin e a si mesmo (decisão 5),
   responde `{ok, recarregar: true}` e reinicia; o plugin mostra "Atualizado. Recarregar agora" (recarrega só em
   `None`/`Lobby`, por clique). Estado por `GET /atualizar/estado` (baixando, conferindo, trocando, pronto, erro com motivo).
2. **Sem o complemento:** botão "Baixar" abre a página do release (se o P0-a passou) ou mostra o caminho do
   `atualizar.cmd`.
3. `atualizar.cmd` (PowerShell sem admin): mesma origem fixa, mesmo hash, mesma troca com volta, mesma recusa de junção.
4. Prova: `tools/teste-atualizar.py` com servidor de release falso em porta de teste (8831–8840): hash errado não troca;
   queda no meio devolve a anterior; junção e pasta com `.git` recusadas; URL fora da origem recusada; reinício pedido.
   Nunca rodar contra a pasta real de plugins.

### P4 — complemento coach público

1. Pasta do complemento montada pela lista do P0-d; `/ola` sem `mentor`, `expansoes`, `resumos`; nada da Riot API
   (tela de carregamento fica fora da 1ª versão, até a medição B do plano Pengu).
   **gameIds nos comentários (revisão do P0):** 28 linhas em 9 módulos citam 8 partidas (6 dele no banco); pela
   match-v5 qualquer um chega à conta dele. Decisão técnica: **editar os comentários no próprio privado** (o número vira
   "partida de 15/10/2026"; o número continua nos roadmaps e na ARMADILHAS, que não vão), não transformar o código na
   hora de publicar (a foto fica igual ao privado byte a byte). Confiança média-alta. Reverte: tirar só na cópia do
   `publicar.py`, com a varredura rodando depois da troca. Pronto quando `python -I tools/varrer-publico.py` sai 0.
2. Config por usuário no lugar do que é fixo da máquina dele (monitor da 2ª tela, `janela_painel.py:25-26`; caminhos).
   **Faixas de calibração do chat** (`feiticos.FAIXAS_CALIBRAR`, revisão do P0): coordenadas absolutas de 2560×1080,
   `calibrar_chat` só corta na borda; em 1440 ou 2160 de altura o chat padrão fica abaixo de y=1080, a calibração devolve
   `None` para sempre (só "não achou o chat na tela" no log) e o `/ola` segue anunciando `feiticos`. Derivar as faixas da
   proporção do monitor do jogo, com a escala do OCR baixando para a faixa × escala ficar abaixo de 2600 px
   (`Windows.Media.Ocr`); prova com print falso de 2560×1440 e 3840×2160, e a leitura em 2560×1080 igual à de hoje.
3. `instalar.cmd` sem admin: confere Python (3.12+; sem ele, diz onde baixar), cria o venv em
   `%LOCALAPPDATA%\lol-client\complemento\venv`, `pip install -r requirements.txt` (versões fixas), copia o plugin (a pasta
   `pengu\` do próprio zip do complemento, que o `publicar.py` já põe lá desde a revisão do P1) para a pasta de plugins do
   Pengu como `lol-ultra-client` (achada pelo registro de instalação ou perguntada), cria o atalho na pasta Inicializar do
   Windows (`pythonw`, sem janela) que espera o client. Nada de tarefa agendada nem gatilho que pede admin.
   **Esperar o client (revisão do P0):** o `coletor.py` sai sozinho com `--ocioso-min` padrão 10 ("ocioso 10 min sem
   client"); na máquina dele o gatilho 4688 relança quando o client abre e o vigia relança se cair, e os dois ficam fora.
   O atalho passa `--ocioso-min inf` (medido em 19/10: `inf` espera para sempre, `0` sai na hora, 10 sai em 10 min).
   **No lugar do vigia:** decisão técnica, um relançador no próprio atalho (laço Python que sobe o `coletor.py` e o sobe
   de novo se sair, espera crescente de 5 s a 5 min, sem duplicar: a trava do coletor já recusa a 2ª instância). Confiança
   média. Reverte: a tarefa do vigia (`tools/vigia-coletor.py`, já sem admin) entra no pacote.
4. Coach calado em partida assistida já vem pronto (`Coletor.assistindo`).
5. Prova: instalação limpa numa pasta de teste com `LOCALAPPDATA` apontado para o scratchpad; `ensaio-coach.py` contra o
   complemento montado. **O ensaio de hoje não roda na lista (revisão do P0):** importa `riotapi`, `carregamento` e
   `mentor` sem proteção (linhas 97, 265-266), exige a chave `carregamento` no `/estado` (398), lê a gravação local
   `temp/gravacao/20261013-071040` e usa a porta 8766. Fazer uma variante `--publico` sem esses imports nem a chave,
   com as fábricas `carregamento`, `mentor` e `vitrine` ausentes (o caminho real do complemento), porta de teste
   8831–8840, rodada com `python -I` e `sys.path` só na pasta montada (senão enxerga o `coletor/` inteiro do repo e não
   prova a lista); a mesma variante num Python 3.12 prova o "3.12+" do `instalar.cmd`.

### P5 — voz: botão que baixa os áudios

1. Bloco Voz da ⚙ (só com `voz` anunciado): estado do pacote (sem pacote: voz do Windows; com pacote: Aoede, versão) e o
   botão "Baixar vozes (42 MB)" → `POST /voz/baixar` → o complemento baixa o asset `voz-aoede-*.zip` do release, confere o
   hash, extrai em `%LOCALAPPDATA%\lol-client\voz\pacotes\aoede.nova` e troca (decisão 5); progresso por
   `GET /voz/estado`. Pacote mais novo no release → o mesmo botão vira "Atualizar vozes".
2. A geração continua só na máquina dele (`tools/gerar-pacote-voz.py`, chave dele); quem baixa nunca precisa de chave.
3. Prova: `teste-voz-baixar.py` com release falso (hash errado, zip com caminho `..\`, queda no meio).

### P6 — publicar (portão)

Só com: (1) nome respondido (`lol-ultra-client`, 19/10) e a conta `dosxnjos` confirmada por ele em 1 linha; (2) as provas no client real do plano das telas e uma partida dele
com a edição nova; (3) `publicar.py` em ensaio sem reprovação. Sequência da regra de contas
(`C:\Dev\cerebro\temas\harness\git-contas-e-repos.md`): `gh auth switch --user <conta>` → `gh repo create <conta>/<nome>
--public` → remote em SSH → `publicar.py --publicar` → `gh auth switch` de volta para a conta que estava ativa, no mesmo
turno. Depois: README do privado com o link, hub com o link.

## Linhas que não se cruzam

As do plano Pengu, mais: código remoto nunca roda no client; download só da origem fixa e só com hash conferido; troca
nunca em junção ou pasta com `.git`; nenhum dado do Gabriel (banco, config, Riot ID, prints) na foto pública; nada
publicado sem `--publicar` e sem o portão do P6.

## O que o pedido não dizia

- A instalação dele é uma junção para a pasta de trabalho: o atualizador tem de recusar, senão apagaria o código.
- Atualização sem conferência de hash é porta de entrada para quem tomar o repositório; por isso hash e origem fixa.
- O pacote de voz é grande e muda pouco: asset separado, baixado só quando muda.
- O repositório público não leva a história: roadmaps e diários citam partidas, horários e decisões dele.
- Frases do catálogo de voz podem citar algo pessoal: varredura antes (P0-c).
