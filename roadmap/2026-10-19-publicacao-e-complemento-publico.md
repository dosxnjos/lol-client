# Plano — publicação, aviso de versão com botão Atualizar e complemento coach público com a voz (2026-10-19)

Plano para um executor que nunca viu a conversa. Projeto `C:\Dev\lol-client`. Continua o
[plugin Pengu primeiro](2026-10-17-plugin-pengu-primeiro.md): substitui o passo 3 da Fase 8 dele (verificação de versão) e
a Fase 9 (complemento público). As Fases 1 a 7 e os passos 1, 2 e 4 da Fase 8 de lá continuam lá. Antes do 1º Edit: hub
`C:\Dev\cerebro\projetos\lol-client.md` (§ Fronteira), `CLAUDE.md`, `docs/ARMADILHAS.md`, `docs/COLETOR.md`,
`docs/TEXTOS-DA-INTERFACE.md`.

Estado (19/10/2026): plano escrito; nada executado. Depende da Fase 1 do plano Pengu (aperto de mão `GET /ola` com
`recursos`). Relatórios no sidecar `roadmap/2026-10-19-publicacao-e-complemento-publico.d/`.

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
- **Pendente (pergunta ao Gabriel):** conta dona e nome do repositório. Recomendação: `dosxnjos/lol-compacto`. Até a resposta,
  o nome mora numa constante só (`pengu/versao.js`, `REPO`), vazia: com `REPO` vazio nenhum aviso nem botão aparece.

## Decisões técnicas (agente; confiança e o que reverteria)

1. **Repositório público = foto do que se distribui, um commit por versão**, nunca a história do privado (roadmaps, dados,
   mentor, MCP e nomes de partidas ficam fora). `tools/publicar.py` monta a foto a partir de uma lista do que entra
   (lista de inclusão, nunca de exclusão), roda a varredura (P1) e commita num clone em `dist/publico/` (ignorado pelo
   `.gitignore` do privado). Confiança alta. Reverte: publicar a história filtrada (`git filter-repo`), que expõe mais.
2. **Versão = `pengu/versao.js`** (`VERSAO = 'x.y.z'`, `REPO`), uma constante lida pelo plugin, pelo complemento (`/ola`
   devolve a mesma) e pelo `publicar.py` (tag `vx.y.z`). Plugin e complemento saem sempre juntos na mesma versão.
3. **Assets do release:** `lol-compacto-plugin-x.y.z.zip`, `lol-compacto-complemento-x.y.z.zip`,
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
- **c. Catálogo da voz sem nada pessoal:** varrer as frases do pacote Aoede (`indice.json`) por "Gabriel", "Xerek",
  nome de jogador, Riot ID. Frase pessoal sai do catálogo público (o pacote público pode ser um subconjunto).
- **d. Dependências do coach ao vivo:** listar o que o caminho do coach importa (`coach_vivo.py`, `avisos.py`, `voz.py`,
  `janela_painel.py`, overlay, minimapa, OCR dos feitiços, `teclas.py`, aceite) e o que é só da instalação dele (mentor,
  MCP, `riotapi.py`, vitrine, travadas, medidores, expansões). Sai a lista de inclusão do complemento e o
  `requirements.txt` com versão fixa.

### P1 — `tools/publicar.py` e a varredura

1. Lista de inclusão do plugin (`git ls-files pengu/` menos os arquivos de desenvolvimento) e do complemento (saída do
   P0-d), mais `LICENSE` (MIT), `TERCEIROS.md`, `LEIA-ME.md`, `instalar.cmd`, `atualizar.cmd`.
2. Varredura que reprova a foto: credencial (padrões do `guarda-segredo`, `RGAPI-`, `gho_`, token, `-RiotClientAuthToken`),
   "Xerekton", puuid, `C:\Dev`, `C:\Users\`, e-mail, nome de projeto Nomura, chave do Doppler. "Gabriel" em comentário
   passa (decisão dele); em texto visível ou literal reprova (Fase 8 do plano Pengu).
3. Zips e `SHA256SUMS.txt` em `dist/`; commit da foto em `dist/publico/` e `gh release create` **só com `--publicar`**;
   sem a opção, é ensaio (monta, varre, mostra o que entraria).
4. Prova: `tools/teste-publicar.py` com uma árvore falsa (arquivo com segredo plantado reprova; arquivo fora da lista não
   entra; zip reabre e todo `import` do plugin resolve dentro dele).

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
2. Config por usuário no lugar do que é fixo da máquina dele (monitor da 2ª tela, `janela_painel.py:25-26`; caminhos).
3. `instalar.cmd` sem admin: confere Python (3.12+; sem ele, diz onde baixar), cria o venv em
   `%LOCALAPPDATA%\lol-client\complemento\venv`, `pip install -r requirements.txt` (versões fixas), copia o plugin para a
   pasta de plugins do Pengu (achada pelo registro de instalação ou perguntada), cria o atalho na pasta Inicializar do
   Windows (`pythonw`, sem janela) que espera o client. Nada de tarefa agendada nem gatilho que pede admin.
4. Coach calado em partida assistida já vem pronto (`Coletor.assistindo`).
5. Prova: instalação limpa numa pasta de teste com `LOCALAPPDATA` apontado para o scratchpad; `ensaio-coach.py` contra o
   complemento montado.

### P5 — voz: botão que baixa os áudios

1. Bloco Voz da ⚙ (só com `voz` anunciado): estado do pacote (sem pacote: voz do Windows; com pacote: Aoede, versão) e o
   botão "Baixar vozes (42 MB)" → `POST /voz/baixar` → o complemento baixa o asset `voz-aoede-*.zip` do release, confere o
   hash, extrai em `%LOCALAPPDATA%\lol-client\voz\pacotes\aoede.nova` e troca (decisão 5); progresso por
   `GET /voz/estado`. Pacote mais novo no release → o mesmo botão vira "Atualizar vozes".
2. A geração continua só na máquina dele (`tools/gerar-pacote-voz.py`, chave dele); quem baixa nunca precisa de chave.
3. Prova: `teste-voz-baixar.py` com release falso (hash errado, zip com caminho `..\`, queda no meio).

### P6 — publicar (portão)

Só com: (1) a conta e o nome respondidos pelo Gabriel; (2) as provas no client real do plano das telas e uma partida dele
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
