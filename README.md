# lol-client

Coach pessoal do League of Legends do Gabriel (conta Xerekton, BR): plugin do Pengu Loader na
interface do client, coletor Python que liga sozinho com o client, painel ao vivo na 2ª tela, voz,
alertas sobre o minimapa, pós-jogo com lições e mentor (o Claude do Gabriel), e um MCP para perguntar
ao Claude Code sobre as próprias partidas. Plano vigente: [v2 coach](roadmap/2026-10-13-lol-client-v2-coach.md)
(o que falta validar está no topo dele).

**Fronteira** (não muda nem com autorização): nada lê memória do jogo, injeta no processo, aperta
tecla ou clica por ele, ou mostra o que está na fog. Tudo sai da LCU, da Live Client Data API, da Riot
API, do histórico e de print da tela que ele já vê (só onde não há API). O coach "dá ordem" (voz,
painel, overlay), coisa que a Riot não aprova para produtos: risco da conta assumido pelo Gabriel em
13/10/2026.

## O que faz, em cada momento

| momento | o que aparece | onde |
| --- | --- | --- |
| client aberto | enxuga a interface (TFT, coluna larga), aceita a partida sozinho com contagem (e botão "não aceitar"), botão de fila rápida, troca a página de runa ao travar o campeão, coleta as recompensas sem escolha | client (plugin) |
| partida encontrada | o client pisca e volta para trás (não rouba a tela; volta sozinho no champ select), janelinha "aceitar agora / recusar" no canto da tela, popup e som opcionais | client (plugin) e janelinha (coletor) |
| champ select | selo com winrate e KDA do campeão, matchup contra o adversário de rota provável, "X é trauma", força do draft em faixa | client (plugin) |
| tela de carregamento | os 10 (elo, winrate, tags com número: OTP, morre cedo, sequência…), previsão de vitória em faixa, composição inimiga e lembrete de build ([ITENS](docs/ITENS.md)) | painel da 2ª tela |
| partida | 4 blocos fixos (tua rota, ameaça, teu padrão, time e objetivos) + 1 aviso por vez; voz (1 fala a cada 20 s, gank fura); moldura colorida na borda da tela; área provável do jungler por cima do minimapa; Flash dos inimigos pelo chat ou F9; preparo 60 s antes de cada objetivo; picos de força | 2ª tela, voz, tela do jogo |
| pós-jogo | 6 abas (Resumo com 3 lições, Rota, Mortes, Objetivos, Tendência, Sessão), análise do mentor e caixa de pergunta; botão "jogar de novo e buscar"; 30 s depois, coleta o prêmio da partida; chat da tela de estatísticas com campeão, ícone e cor do time | client (plugin) |
| a qualquer hora | `resumo`, `partidas`, `matchups`, `traumas`, `licoes`, `sessao_hoje`, `carregamento_atual`… | Claude Code (MCP) |

## Como liga sozinho

O client abre → o Windows grava o evento 4688 → a tarefa agendada `lol-client-coletor` roda
`pythonw coletor\coletor.py` → o coletor sobe o servidor local `127.0.0.1:8765` (painel, `/estado`,
`/config`, `/mentor`, `/draft`…) e liga cada parte do coach pela fase do jogo (`coletor\coach_vivo.py`).
Ele sai sozinho 10 min depois do client fechar. Ciclo inteiro e o que liga em cada fase:
[COLETOR](docs/COLETOR.md) § Ciclo de vida e § Coach na partida.

## Instalar (uma vez)

1. Python 3.14 e as bibliotecas: `python -m pip install --user websockets mss opencv-python numpy scipy pillow mcp`
   (Node só para os testes do plugin).
2. Gatilho: `powershell -NoProfile -ExecutionPolicy Bypass -File tools\instalar-gatilho.ps1` (PowerShell elevado).
3. Plugin: Pengu Loader 1.1.6 em `C:\Program Files\Pengu Loader` + junção
   `cmd /c mklink /J "C:\Program Files\Pengu Loader\plugins\lol-client" "C:\Dev\lol-client\pengu"`;
   recarregar a interface só em `None`/`Lobby`.
4. MCP: `claude mcp add --scope user lol-client -- python C:\Dev\lol-client\mcp\servidor.py`.
5. Riot API (só tela de carregamento e `dados\meta.db`): `LOL_RIOT_API_KEY` no Doppler pessoal; o coletor
   lê em memória. Meta: `doppler run --project pessoal --config prd --scope "C:/Users/Gabriel dos Anjos/.doppler-pessoal" -- python tools\coletar-meta.py`.
6. Só para desenvolver: `RemoteDebuggingPort=8888` no `C:\Program Files\Pengu Loader\config` (o `tools\cdp.mjs` usa).

## Ligar e desligar cada parte

No client: **Configurações › LOL-CLIENT** (e o Ctrl+K). O plugin manda as chaves do coach ao coletor
(`POST /config`), que guarda em `dados\config.json` e aplica na hora, até no meio da partida.

| parte | bloco nas Configurações | chave do coach |
| --- | --- | --- |
| aceite, fila rápida, enxugamentos, runas, selo do champ select | blocos do plugin e Ctrl+K | (só o plugin) |
| trazer o client para a frente ao achar partida (desligado = o client pisca e volta para trás; só com o aceite automático) | Aceitar partida | (plugin: `aceite.trazerClient`) |
| esconder o popup de partida encontrada (só com o aceite automático; volta se o aceite não vier) | Aceitar partida | (plugin: `aceite.esconderPopup`) |
| silenciar o som em loop depois de aceitar (padrão: ligado; o aviso de partida encontrada continua) | Aceitar partida | (plugin: `aceite.silenciarSom`) |
| janelinha aceitar/recusar fora do client, por cima de tudo e sem roubar a tela (precisa do coletor) | Aceitar partida | `aceiteFlutuante` (+ `aceiteAtrasoS`, que o plugin manda sozinho) |
| botão "jogar de novo e buscar" no pós-jogo | Fila rápida | (plugin: `filaRapida.jogarDeNovo`) |
| freio de tilt: pedir 2º clique depois de N derrotas seguidas na sessão (padrão: 2; 0 = nunca), na fila rápida e no jogar de novo | Fila rápida | (plugin: `filaRapida.freioTilt`) |
| freio de madrugada: pedir 2º clique ao buscar entre 01:00 e 05:59, hora do PC (padrão: ligado), nos mesmos dois botões | Fila rápida | (plugin: `filaRapida.freioMadrugada`) |
| coletar recompensas sozinho / incluir o passe do TFT | Recompensas | (plugin: `recompensas.ligado`, `recompensas.tft`) |
| chat da tela de estatísticas: campeão junto do nome (ou no lugar), ícone do campeão (do próprio client), cor certa de aliado/inimigo, abre sozinho e fica aberto (o botão do chat recolhe; o Esc também, se o cursor estiver no chat), sem "entrou/deixou o saguão", quem saiu cinza no placar; com o painel do pós-jogo aberto o chat fica por baixo; desligar no meio da tela devolve o chat como o client deixou | Chat do pós-jogo | (plugin: `chatPosjogo.ligado`, `.nomes` = ambos/campeao/jogador, `.iconeCampeao`, `.corTime`, `.abrirSozinho`, `.manterAberto`, `.esconderEntrouSaiu`, `.escurecerSaiu`) |
| calar o aviso de runas mudadas pelo jogo e o de golpear colocado sozinho (resposta falsa só nessas 2 rotas; o "você foi preenchido" fica: sai da sessão do champ select). O de runas logo depois de um patch ainda não foi provado | Avisos do client | (plugin: `semPopups.ligado`, `.runasAutomaticas`, `.smiteAutomatico`) |
| painel na 2ª tela / amostras de 10 s no banco | Painel ao vivo (2ª tela) | `painelAoVivo` / `amostrasAoVivo` |
| voz e tom (sério ou descontraído) | Voz | `voz`, `tomVoz` |
| moldura na tela e cada um dos 18 tipos de alerta (com o retorno do F8 e do F9), com voz e tela separadas | Alertas na tela | `alertasTela`, `avisosDesligados` |
| leitura do minimapa (jungler, gank, alertas de posição) | Minimapa e jungler | `minimapa` |
| overlay do jungler sobre o minimapa (**F8** na partida liga/desliga; a moldura mostra "overlay ligado/desligado") | Minimapa e jungler | `overlayMinimapa` |
| Flash inimigo: OCR do chat e **F9 e logo depois 1 a 5** (1 top, 2 jungler, 3 mid, 4 atirador, 5 suporte) = ele acabou de usar o flash; repetir em 10 s desfaz. O F9 mostra "flash: 1-5" na borda por 2 s; marcado, a voz diz "flash do mid marcado" | Minimapa e jungler | `feiticos` |
| os 10 na tela de carregamento (Riot API) | Tela de carregamento | `carregamento` |
| mentor, modelo e esforço (padrão Sonnet + medium) | Mentor | `mentor`, `mentorModelo`, `mentorEffort` |
| traumas no selo e na aba Tendência | Traumas | (só o plugin) |

**Jogar de novo:** só busca quando tu clica, nunca sozinho. Volta à mesma fila da partida que acabou, com as tuas
posições; em grupo só volta ao lobby (quem busca é o líder); com penalidade (dodge, leaver) diz o motivo e o prazo e
não busca. Plano: [jogar de novo](roadmap/2026-10-13-jogar-de-novo.md).

**Freios (fila rápida e jogar de novo):** com 2 derrotas seguidas na sessão (pausa < 2 h) ou de madrugada (01:00 a
05:59), o 1º clique só mostra o motivo com o número medido ("de madrugada teu winrate cai: 47% contra 58% de dia.
buscar mesmo assim?") e o 2º, entre 0,7 s e 8 s depois, busca (duplo clique rápido é ignorado); sem o 2º clique nada
acontece. Nunca bloqueia de vez, nunca busca sozinho. Em grupo ou sem ser o líder o "jogar de novo" só volta ao lobby
e não pede confirmação. Números e data da medição: `pengu/freios.js` (`MEDICAO`). O resultado da partida que acabou
vem do fim de partida (`eog-stats-block`) até o histórico trazê-la: vitória zera na hora. Histórico que não carregou
a tempo = "não sei quantas derrotas" e também pede o 2º clique.

**Recompensas:** ao abrir o client e 30 s depois de cada partida, pega o que não tem escolha (concessões de
recompensa, trilha dos eventos e, se ligado, o passe do TFT). De cada tipo pega uma primeiro e só pega o resto depois
de conferir que ela saiu. **Nunca** abre baú, cria, desencanta, compra na loja de fichas ou no passe, e nunca escolhe
por ti: recompensa "escolha 1 de 3" vira aviso. Plano: [coleta](roadmap/2026-10-13-coleta-automatica-de-recompensas.md).

Textos da voz e das lições: `pengu\posjogo\licoes.md` (lições) e `docs\LICOES.md` § Avisos ao vivo
(falas e rótulos, dois tons); editar o texto muda o coach sem mexer no código.
Desligar tudo agora: `schtasks /end /tn lol-client-coletor` (volta no próximo client aberto). Rodar o
coletor sem coach: flag `--sem-coach`.

## O que só uma partida real prova

Testado só offline (simulador tocando a partida gravada 3292746609, prints gravados, Claude falso),
nunca numa partida ao vivo com o código novo: voz audível, alerta de gank (na partida gravada ele era o
jungler), minimapa a 6 fps de verdade, moldura e overlay alinhados sobre o jogo, F8 e F9 com o jogo
aberto, OCR do chat com ≥ 10 pings, mentor chamado pela tarefa agendada, selo com inimigo de verdade no
draft. Roteiro e status: topo do [plano v2](roadmap/2026-10-13-lol-client-v2-coach.md).
Também sem prova no client (13/10/2026): o piscar e a volta no champ select, a janelinha aceitar/recusar, popup
escondido, som calado, jogar de novo, a coleta de recompensas, o chat do pós-jogo e os avisos calados; status nos planos de
[chat, avisos e som](roadmap/2026-10-13-chat-popups-som.md),
[voz e foco](roadmap/2026-10-13-voz-pregravada-e-foco.md), [jogar de novo](roadmap/2026-10-13-jogar-de-novo.md) e
[coleta](roadmap/2026-10-13-coleta-automatica-de-recompensas.md).
**Print do overlay e da moldura** (o print comum não vê os dois, de propósito): `python tools\vitrine.py ligar`
antes da partida (vale 1 partida; `estado`/`desligar`), prints em `temp\vitrine\<data>\` ([COLETOR](docs/COLETOR.md) § Coach na partida).

## Provas

| o quê | comando |
| --- | --- |
| todas as provas offline (inclui o ensaio a 20x; ~4 min) | `python tools\rodar-testes.py` |
| ensaio ponta a ponta sem o client (banco copiado, portas 8766/2996) | `python tools\ensaio-coach.py` |
| simulador da Live Client (porta 2998) | `python tools\simular-liveclient.py` |

Pegadinhas medidas: [ARMADILHAS](docs/ARMADILHAS.md). Regras do pós-jogo: [INSIGHTS](docs/INSIGHTS.md).

## Desinstalar tudo

1. Parar o coletor: `schtasks /end /tn lol-client-coletor`.
2. Gatilho: `tools\remover-gatilho.ps1` (PowerShell elevado): apaga a tarefa e devolve a auditoria de
   criação de processo ao estado salvo.
3. Plugin: `cmd /c rmdir "C:\Program Files\Pengu Loader\plugins\lol-client"` (é junção: `rmdir` apaga
   só o link; `del /s` ou `rm -r` apagaria `pengu\` do repo). Recarregar a interface.
4. Porta 8888: tirar a linha `RemoteDebuggingPort=8888` do `C:\Program Files\Pengu Loader\config`
   (editor elevado). A 8765 não fica instalada: some com o coletor.
5. MCP: `claude mcp remove --scope user lol-client`.
6. Dados: apagar `dados\` (banco, `meta.db`, config, log, cache, ícones, perfil do Edge do painel). Ele
   guarda Riot ID e puuid dos 10 de cada partida: não vai para o git.
7. Mentor: apagar `%LOCALAPPDATA%\lol-client-mentor` e as sessões dele em
   `%USERPROFILE%\.claude\projects\C--Users-Gabriel-dos-Anjos-AppData-Local-lol-client-mentor` (e a
   `C--Dev-lol-client-dados-mentor`: 1 sessão de 13/10 às 08:06 com cwd dentro do repo, que o código
   atual não usa mais).
8. Não é do projeto: a chave que grava a linha de comando no log Security (com o token da LCU) já estava
   ligada pelo harness; como desligar: [COLETOR](docs/COLETOR.md) § Segurança.
