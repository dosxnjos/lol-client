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
| champ select | selo com winrate e KDA do campeão, matchup contra o adversário de rota provável, "X é trauma", força do draft em faixa (sem o complemento: matchup e trauma das partidas guardadas no plugin, sem a força do draft) | client (plugin) |
| tela de carregamento | os 10 (elo, winrate, tags com número: OTP, morre cedo, sequência…), previsão de vitória em faixa, composição inimiga e lembrete de build ([ITENS](docs/ITENS.md)) | painel da 2ª tela |
| partida | 4 blocos fixos (tua rota, ameaça, teu padrão, time e objetivos) + 1 aviso por vez; voz (1 fala a cada 20 s, gank fura); moldura colorida na borda da tela; área provável do jungler por cima do minimapa; Flash dos inimigos pelo chat ou F7; preparo 60 s antes de cada objetivo; picos de força | 2ª tela, voz, tela do jogo |
| pós-jogo | 6 abas (Resumo com o veredito do mentor no topo e as 3 lições recolhidas, Rota, Mortes, Objetivos, Tendência, Sessão), análise do mentor e caixa de pergunta; não bloqueia o client (clique fora da caixa fecha e vale no client; fechar e Esc também, até no carregamento, sem cancelar a análise); no fim da partida carrega só com o botão "analisando a partida…" no topo e abre sozinho se tu não mexeu no client nesse meio tempo (senão o botão vira "análise pronta"; se a análise falhar, "tentar a análise de novo", sem caixa por cima); fechado, o botão "reabrir análise" abre de novo na hora até o próximo aceite; botão "jogar de novo e buscar"; "baixar replay" e "assistir replay" no topo (só por clique; assistir abre o jogo no 1º clique, com um aviso curto, e a Riot minimiza o client até o replay fechar); 30 s depois, coleta o prêmio da partida; chat da tela de estatísticas com campeão, ícone e cor do time | client (plugin) |
| client compacto (padrão) | janela pequena (420×680) só com a rotina: lobby com JOGAR (freios) e grupo, fila (a partida encontrada fica nela, com a contagem do aceite por cima), seleção de campeões com as 3 trocas (posição, ordem, campeão), intenção dos aliados em foto apagada, skins na roda do mouse (com as bolinhas de chroma da skin escolhida em cima das splash arts) e o selo do teu campeão em hover ou travado (partidas, winrate e KDA, geral e na posição), a tua posição em destaque (ícone e nome grandes no lugar da grade por 3,5 s ao entrar, em amarelo se não é a tua 1ª e em vermelho no preenchimento automático; palavra grande na tua linha a seleção inteira; aviso "Renekton na selva: 1 partida" quando o campeão tem menos de 3 partidas tuas na posição, sem impedir nada), a faixa do chat da sala do time logo acima da busca (nasce recolhida, com a última linha e o contador; abre sozinha quando outro jogador manda mensagem, só a altura: o cursor fica onde estava, nada vira "lida"; com o mouse mexendo no time ou na grade, espera ele parar 1,2 s, para o clique não cair no campeão errado; Enter com a sala trocada no meio não envia para a sala anterior; quem fala só como campeão e posição, nunca nome; quando a faixa não cabe nos 680 px, as linhas do time ficam mais justas e a grade de campeões encolhe até 1 linha, e a faixa cresce só até onde cabe, sempre com a busca e o BANIR/TRAVAR à vista), pós-jogo curto (3 lições do coletor ou, enquanto elas não chegam, do motor do painel; a análise completa já carrega por trás e o "ver análise completa" abre na hora; expandir com ela pronta deixa o botão "análise pronta" no topo, sem o painel por cima); fim de partida compacto: honra (votar, prosseguir), pós-jogo com mentor, lições e os 10 jogadores, chat da sala com a foto do campeão (nome do campeão na cor do lado, como no chat expandido) e a faixa de quem ainda está na sala (ícone de cada campeão no cabeçalho; quem saiu fica apagado), linha do replay (baixar e assistir, só por clique, assistir em 1 clique), IR PARA O LOBBY e JOGAR DE NOVO, e adicionar e denunciar por jogador (só por clique, as rotas do próprio client); avisos do plugin (runa, recompensas, Ctrl+K) saem dentro da janela compacta, o Ctrl+K "analisar última partida" expande antes de abrir e a escolha de 2+ páginas de runa não escolhida volta como popup ao expandir; "expandir" e Ctrl+Shift+M voltam ao client normal, o "modo compacto" no topo volta ao compacto (na seleção da Riot ele flutua no alto à direita); o topo da janela compacta arrasta a janela. Na partida de Summoner's Rift ou ARAM a janela fica compacta atrás do jogo (TFT e Arena abrem o client normal; campeão, fila, tempo de jogo e placar do time pelo coletor, ou o relógio desde o carregamento sem ele; RECONECTAR quando o jogo fecha, só por clique) e nada mexe na janela com o jogo na frente; o relógio e a barra da seleção seguem a conta da tela da Riot. ARAM, celebrações do fim de partida (subir de elo, desafio), falha ao abrir o jogo e qualquer janela própria da Riot abrem o client normal sozinho; erro numa tela compacta também. Os ícones são Lucide embutidos (`pengu/icones.js`, nada de emoji nem de rede); botão só com ícone tem o nome no `title` e no `aria-label`. O botão de chat alarga a própria janela para a direita com o chat (altura fixa: conversas recentes em cima, ~1/3, com foto, nome, trecho da última mensagem, hora e não lidas; embaixo a última conversa que ele abriu desde que o client ligou, com o fechar que fecha só a conversa; na seleção, a sala do time é a 1ª linha dos recentes, com campeão e posição de quem fala, nunca nome) e o de amigos ao lado dele abre a lista de amigos com as pastas da Riot na ordem dela (Tropa no topo, Geral, Riot Mobile, Offline; clique no nome da pasta recolhe, arrastar o nome reordena entre as pastas criadas e o Geral, o "criar pasta" cria e o clique direito na pasta renomeia ou exclui, tudo gravado onde o client grava), o clique direito no amigo (ou Shift+F10) com o menu do client (convidar para partida, enviar mensagem, assistir partida quando a Riot deixa, exibir perfil, anotação, mover de pasta, desfazer amizade/bloquear e denunciar com a confirmação da Riot) e arrastar o amigo até a janela principal convida para o lobby (só com o lobby criado; fora disso a janela mostra o motivo e nada sai); enviar, convidar e "lida" só por clique ou tecla dele; o texto digitado e não enviado fica guardado por conversa enquanto o client está aberto (some ao enviar e ao recarregar o client; nunca vai para disco); mensagem nova nunca abre nada sozinha, em fase nenhuma: só sobe nos recentes com o número e acende a bolha do chat (a única exceção é a faixa da sala do time na coluna, na seleção, na honra e no pós-jogo: chave "Abrir a sala do time com mensagem nova"); "exibir perfil" (ou o clique na foto do amigo) abre o perfil dele ao lado, no lugar do chat (Riot ID, nível, título, emblemas, Solo/Duo e Flex, o fundo de perfil dele na faixa; aba histórico com as últimas 20 partidas e o detalhe dos 10 de cada uma; convidar, mensagem e assistir com a mesma regra do menu; perfil privado só avisa; replay de partida de outro jogador só quando a Riot oferece, como no client); fechar volta ao chat como estava; a foto do topo do lobby abre o editor do seu perfil à esquerda, no lugar das configurações (ícone, moldura, bandeira, 3 emblemas e título; escolher só muda a prévia, "salvar" grava só o que mudou, com as rotas do client; fechar com mudança não salva pede um 2º clique e não grava nada; "histórico" abre o seu histórico ao lado, com baixar/assistir replay); o fundo de perfil vira o fundo da janela compacta (centralizado, cortado nos lados, véu escuro medido para o texto seguir legível até sobre imagem branca; só a imagem, o vídeo fica de fora; chave "Fundo do perfil no compacto"); o botão de configurações abre as do lol-client à esquerda (com a seção Som: o som do client e o do plugin numa casa só; as da Riot pelo rodapé, voltando ao compacto quando fecham); o coach na seleção abre o selo completo ao lado, no lugar do chat (matchup, trauma, draft; fechar volta ao chat como estava, e ele nunca volta sozinho na seleção seguinte); "última partida" no lobby reabre a análise; a coluna fica parada na tela e a janela nunca sai do monitor. O chat é sempre ao lado com o compacto ligado: as janelas do chat fora do client (coletor) foram aposentadas em 19/10/2026 | client (plugin `pengu/compacto/`; lateral em `lateral*.js` e `geometria.js`; amigos em `amigos*.js`; perfil e editor em `perfil.js`; fundo em `fundo.js`) |
| a qualquer hora | `resumo`, `partidas`, `matchups`, `traumas`, `licoes`, `sessao_hoje`, `carregamento_atual`… | Claude Code (MCP; **desinstalado desde 15/10/2026**: subia um Python em toda sessão do Claude. Voltar: passo 4 de Instalar. O mentor do pós-jogo não usa, roda com `--strict-mcp-config`) |

## Como liga sozinho

O client abre → o Windows grava o evento 4688 → a tarefa agendada `lol-client-coletor` roda
`pythonw coletor\coletor.py` → o coletor sobe o servidor local `127.0.0.1:8765` (painel, `/estado`,
`/config`, `/mentor`, `/draft`…) e liga cada parte do coach pela fase do jogo (`coletor\coach_vivo.py`).
Ele sai sozinho 10 min depois do client fechar. Se ele cair com o client aberto, a tarefa `lol-client-vigia`
(a cada 3 min) sobe de novo pela mesma tarefa. Ciclo inteiro e o que liga em cada fase:
[COLETOR](docs/COLETOR.md) § Ciclo de vida, § Vigia e § Coach na partida.

## Instalar (uma vez)

1. Python 3.14 e as bibliotecas: `python -m pip install --user websockets mss opencv-python numpy scipy pillow mcp`
   (Node só para os testes do plugin).
2. Gatilho: `powershell -NoProfile -ExecutionPolicy Bypass -File tools\instalar-gatilho.ps1` (PowerShell elevado).
   Vigia (sobe o coletor que caiu com o client aberto; sem admin): `python tools\vigia-coletor.py instalar`
   (conferir: `... estado`).
3. Plugin: Pengu Loader 1.1.6 em `C:\Program Files\Pengu Loader` + junção
   `cmd /c mklink /J "C:\Program Files\Pengu Loader\plugins\lol-client" "C:\Dev\lol-client\pengu"`;
   recarregar a interface só em `None`/`Lobby`.
   **Semente desta conta** (19/10/2026, Fase 3 do [plano plugin Pengu primeiro](roadmap/2026-10-17-plugin-pengu-primeiro.md)):
   o padrão do plugin não traz regra de runa nem favorito e traz o client para a frente no ready check. Esta máquina tem os
   valores salvos no DataStore (`lol-client.config`) e a mescla mantém; só numa reinstalação com o DataStore vazio, refazer
   as regras em Configurações › Runas e, para o resto, no console do CDP (passo 6; client em `None`/`Lobby`), em qualquer ordem:
   `__lolClient.definir('compacto.favoritos', [58, 154]); __lolClient.definir('aceite.trazerClient', false)`.
   Vale na hora, sem recarregar. Nunca `DataStore.get/set` direto: numa instalação nova a chave só existe depois do 1º
   `salvar()` (o `get` volta `null`) e a próxima mudança nas Configurações regrava o `cfg` da memória por cima (ARMADILHAS
   § Client e Pengu). Regras (ids de `GET /lol-perks/v1/pages`, medidos em 13/10/2026; conferir se as páginas ainda existem):
   `{championId: 58, posicao: '*', paginas: [1409260191, 2147419287]}` (Renekton) e
   `{championId: 154, posicao: '*', paginas: [1540029809]}` (Zac); favoritos 58 e 154; `aceite.trazerClient: false`
   (minimiza o client que pulou na frente no ready check).
4. MCP (opcional, fora desde 15/10/2026): `claude mcp add --scope user lol-client -- python C:\Dev\lol-client\mcp\servidor.py`.
   Só nesta pasta, sem pesar nas outras sessões: `--scope local` rodando de dentro de `C:\Dev\lol-client`.
5. Riot API (só tela de carregamento e `dados\meta.db`): `LOL_RIOT_API_KEY` no Doppler pessoal; o coletor
   lê em memória. Meta: `doppler run --project pessoal --config prd --scope "C:/Users/Gabriel dos Anjos/.doppler-pessoal" -- python tools\coletar-meta.py`.
6. Só para desenvolver: `RemoteDebuggingPort=8888` no `C:\Program Files\Pengu Loader\config` (o `tools\cdp.mjs` usa).

## Ligar e desligar cada parte

No client: **Configurações › LOL-CLIENT** (e o Ctrl+K). O plugin manda as chaves do coach ao coletor
(`POST /config`), que guarda em `dados\config.json` e aplica na hora, até no meio da partida.

**Ponte com o complemento coach** (19/10/2026, Fase 1 do [plano plugin Pengu primeiro](roadmap/2026-10-17-plugin-pengu-primeiro.md)):
o coletor (Python) aparece para o usuário como "complemento coach". O plugin só fala com ele (`127.0.0.1:8765`) com a chave
**Usar o complemento coach** (`coletor.ligado`, bloco "Complemento coach") ligada **e** um aperto de mão bom (`GET /ola`).
Instalação nova nasce com a chave desligada (nenhuma chamada à 8765); a config salva antes da versão 4 (a desta máquina)
ligou uma vez sozinha. "Restaurar padrão" não mexe nela. Cada bloco e chamada do coach só existe com o recurso que o
complemento anuncia (`pengu/coach.js`); sem ele, os blocos somem e fica um bloco "Coach ao vivo" dizendo que precisa do
complemento. Desligar a chave não desliga o coach ao vivo: o complemento segue com a última configuração recebida. A
coluna da direita diz quem precisa dele: chave do coach = só com o complemento; "(plugin…)" = roda sem ele.

**Histórico próprio no plugin** (19/10/2026, Fase 4 do mesmo plano; sem chave, sem tela ainda): o plugin guarda até 500
partidas próprias do Rift no DataStore (`lol-client.historico`, `pengu/historico.js`), uma linha curta cada (campeão, papel,
adversário de rota e os 5 inimigos só por campeão, vitória, diferenças aos 10 e 15 min, mortes cedo, farm). Entra a partida
que acaba (das leituras que o pós-jogo já faz), as que faltam da lista do histórico (1 a cada 5 s, só no lobby, no máximo 40
por abertura do client) e, com o complemento, as do banco dele (`GET /resumos`, uma vez por abertura, só as da conta
logada). É a amostra do
contexto do pós-jogo e da seleção sem o complemento (Fase 5, `pengu/posjogo/contexto.js`, a mesma regra do coletor): com 3
partidas ou mais, as lições, a Tendência e a Sessão do pós-jogo ganham matchup, traumas e winrate por horário e sequência
(também enquanto o complemento não responde), o selo da seleção ganha matchup e trauma (sem a força do draft) e a média de
farm passa a contar as partidas guardadas; os freios usam os números dele (acima). Conferir:
`__lolClient.historico.estado()` no CDP. Apagar: `DataStore.remove('lol-client.historico')` (o contexto local volta a zero).

| parte | bloco nas Configurações | chave do coach (precisa do complemento coach) |
| --- | --- | --- |
| falar com o complemento coach (aperto de mão, recuo 30 s → 2 min → 5 min sem achar; a linha de estado diz desligado / procurando / encontrado e a versão) | Complemento coach (e Ctrl+K) | (plugin: `coletor.ligado`; padrão desligado em instalação nova) |
| aceite, fila rápida, enxugamentos, runas, selo do champ select | blocos do plugin e Ctrl+K | (só o plugin) |
| trazer o client para a frente ao achar partida (desligado = o client pisca e volta para trás; só com o aceite automático). Padrão ligado desde 19/10/2026; a config salva desta máquina segue desligada, e "restaurar padrão" liga | Aceitar partida | (plugin: `aceite.trazerClient`) |
| esconder o popup de partida encontrada (só com o aceite automático; volta se o aceite não vier) | Aceitar partida | (plugin: `aceite.esconderPopup`) |
| silenciar o som em loop depois de aceitar (padrão: ligado; o aviso de partida encontrada continua) | Aceitar partida | (plugin: `aceite.silenciarSom`) |
| janelinha aceitar/recusar fora do client, por cima de tudo e sem roubar a tela (só aparece com o recurso `aceite-flutuante`) | Aceitar partida | `aceiteFlutuante` (+ `aceiteAtrasoS`, que o plugin manda sozinho) |
| botão "jogar de novo e buscar" no pós-jogo | Fila rápida | (plugin: `filaRapida.jogarDeNovo`) |
| freio de tilt: pedir 2º clique depois de N derrotas seguidas na sessão (padrão: 2; 0 = nunca), na fila rápida e no jogar de novo | Fila rápida | (plugin: `filaRapida.freioTilt`) |
| freio de madrugada: pedir 2º clique ao buscar entre 01:00 e 05:59, hora do PC (padrão: ligado), nos mesmos dois botões | Fila rápida | (plugin: `filaRapida.freioMadrugada`) |
| coletar recompensas sozinho / incluir o passe do TFT | Recompensas | (plugin: `recompensas.ligado`, `recompensas.tft`) |
| client compacto (desligado = client normal, sem botão nem atalho) / abrir cada fase no compacto (desligado = começa no normal e o botão "modo compacto" leva ao compacto) | Client compacto (e Ctrl+K) | (plugin: `compacto.ligado`, `compacto.inicioCompacto`; `favoritos` (padrão vazio, "restaurar padrão" mantém), `larg`, `alt` só no DataStore) |
| fundo do perfil como fundo da janela compacta (desligado = o fundo escuro de sempre; o chat e os amigos ao lado não têm chave: sempre com o compacto, desde 19/10/2026) | Client compacto (e Ctrl+K) | (plugin: `compacto.fundoPerfil`) |
| abrir a faixa da sala do time quando outro jogador manda mensagem, na seleção de campeões, na honra e no pós-jogo (padrão: ligado; só a altura da faixa, sem foco nem "lida"; na seleção, quem fala aparece só como campeão e posição; desligado = só o contador sobe) | Client compacto (e Ctrl+K) | (plugin: `compacto.chatSalaCresce`) |
| som do client nas configurações do compacto (seção Som, só no compacto: áudio do client, volume geral, efeitos, volume dos efeitos, ambiente, falas de escolha e banimento, música, volume da música e as 4 músicas, as mesmas da página Som da Riot e gravadas onde ela grava, só por clique ou ao soltar o volume; abrir não grava nada; vale só para o client, o som da partida fica no menu do jogo) junto das chaves de som do plugin (silenciar depois de aceitar e, com o recurso `voz` do complemento, voz do coach, tom, não repetir, avisos com voz). No compacto o bloco Voz mora dentro da Som | Som (configurações do compacto) | (client: `/lol-settings/v1/local/lol-audio`, [ARMADILHAS](docs/ARMADILHAS.md) § LCU; plugin: `aceite.silenciarSom`, `coach.voz`, `coach.tomVoz`, `coach.cortarFalaRepetida`, `coach.avisosDesligados.voz`) |
| chat da tela de estatísticas: campeão junto do nome (ou no lugar), ícone do campeão (do próprio client), cor certa de aliado/inimigo, abre sozinho e fica aberto (o botão do chat recolhe; o Esc também, se o cursor estiver no chat), sem "entrou/deixou o saguão", quem saiu cinza no placar; com o painel do pós-jogo aberto o chat fica por baixo (clicar no client fora da caixa fecha o painel, e o chat volta a abrir sozinho); desligar no meio da tela devolve o chat como o client deixou | Chat do pós-jogo | (plugin: `chatPosjogo.ligado`, `.nomes` = ambos/campeao/jogador, `.iconeCampeao`, `.corTime`, `.abrirSozinho`, `.manterAberto`, `.esconderEntrouSaiu`, `.escurecerSaiu`) |
| calar o aviso de runas mudadas pelo jogo e o de golpear colocado sozinho (resposta falsa só nessas 2 rotas; o "você foi preenchido" fica: sai da sessão do champ select). O de runas logo depois de um patch ainda não foi provado | Avisos do client | (plugin: `semPopups.ligado`, `.runasAutomaticas`, `.smiteAutomatico`) |
| painel na 2ª tela / amostras de 10 s no banco | Painel ao vivo (2ª tela) | `painelAoVivo` / `amostrasAoVivo` |
| voz e tom (sério ou descontraído) | Voz | `voz`, `tomVoz` |
| não repetir na voz a mesma frase em menos de 1 minuto (padrão: ligado; desligado = pode repetir) | Voz | `cortarFalaRepetida` |
| moldura na tela e cada um dos 18 tipos de alerta (com o retorno do F8 e do F7), com voz e tela separadas | Alertas na tela | `alertasTela`, `avisosDesligados` |
| avisar gank nas outras rotas, em amarelo (padrão: ligado; desligado = só o gank onde tu está) | Alertas na tela | `gankOutraRota` |
| jungler inimigo longe de onde tu está: só no painel da 2ª tela (padrão), também falar e piscar a borda, ou não mostrar | Alertas na tela | `junglerLonge` (`painel`/`tudo`/`nada`) |
| "mid sumiu" só quando faz sentido: começo do jogo, sem briga, cerco, tu morto ou na base (padrão: ligado; desligado = toda vez, ainda no máx. 4 por partida, 2 min entre eles) | Alertas na tela | `midSumiuFiltro` |
| leitura do minimapa (jungler, gank, alertas de posição) | Minimapa e jungler | `minimapa` |
| overlay do jungler sobre o minimapa (**F8** na partida liga/desliga; a moldura mostra "overlay ligado/desligado") | Minimapa e jungler | `overlayMinimapa` |
| cor da mancha (vermelho, laranja, roxo), força (sutil, normal, forte) e mudar aos poucos (padrão: vermelho, normal, ligado) | Minimapa e jungler | `overlayCor`, `overlayForca`, `overlaySuave` |
| Flash inimigo: OCR do chat e **F7** na partida = ele acabou de usar o flash. 1 batida = o adversário da tua rota; cada batida a mais passa para a próxima (top, jungler, mid, atirador, suporte, dando a volta), com a borda mostrando quem está escolhido ("flash: mid?"); parado ~1 s, marca e a voz diz "flash do mid marcado". **Segurar F7** 1 s desfaz a última marcação, até 1 min depois, e a borda diz qual ("desfeito: mid"); o que o chat já viu fica ("mid: chat confirmou"). Os números de cima nunca (são itens no LoL); o teclado numérico, para quem tiver, escolhe direto depois do F7 | Minimapa e jungler | `feiticos` |
| os 10 na tela de carregamento (Riot API) | Tela de carregamento | `carregamento` |
| mentor, modelo e esforço (padrão Sonnet + medium) | Mentor | `mentor`, `mentorModelo`, `mentorEffort` |
| traumas no selo e na aba Tendência (o bloco só aparece com uma fonte: o complemento com `draft` ou `contexto`, ou 3 partidas no acumulador do plugin) | Traumas | (plugin: `traumas.ligado`) |

**Jogar de novo:** só busca quando tu clica, nunca sozinho. Volta à mesma fila da partida que acabou, com as tuas
posições; em grupo só volta ao lobby (quem busca é o líder); com penalidade (dodge, leaver) diz o motivo e o prazo e
não busca. Plano: [jogar de novo](roadmap/2026-10-13-jogar-de-novo.md).

**Freios (fila rápida e jogar de novo):** com 2 derrotas seguidas na sessão (pausa < 2 h) ou de madrugada (01:00 a
05:59), o 1º clique só mostra o motivo com o número medido ("de madrugada o seu winrate cai: 47% contra 58% de dia.
Buscar mesmo assim?") e o 2º, entre 0,7 s e 8 s depois, busca (duplo clique rápido é ignorado); sem o 2º clique nada
acontece. Nunca bloqueia de vez, nunca busca sozinho. Em grupo ou sem ser o líder o "jogar de novo" só volta ao lobby
e não pede confirmação. Os números são calculados das partidas guardadas no plugin (acumulador; desde 19/10/2026, Fase 5
do [plano plugin Pengu primeiro](roadmap/2026-10-17-plugin-pengu-primeiro.md)): abaixo de 30 partidas o texto sai sem
número ("2 derrotas seguidas. Buscar mesmo assim?"), cada número precisa de 10 partidas na faixa, e o texto só diz "cai"
quando cai; regra em [INSIGHTS](docs/INSIGHTS.md) § Contexto sem o complemento (`pengu/posjogo/contexto.js`
`medicaoDe`). Com o complemento, o acumulador começa com a importação do `/resumos`. O resultado da partida que acabou
vem do fim de partida (`eog-stats-block`) até o histórico trazê-la: vitória zera na hora. Histórico que não carregou
a tempo = "sequência de derrotas desconhecida" e também pede o 2º clique.

**Recompensas:** ao abrir o client e 30 s depois de cada partida, pega o que não tem escolha (concessões de
recompensa, trilha dos eventos e, se ligado, o passe do TFT). De cada tipo pega uma primeiro e só pega o resto depois
de conferir que ela saiu. **Nunca** abre baú, cria, desencanta, compra na loja de fichas ou no passe, e nunca escolhe
por ti: recompensa "escolha 1 de 3" vira aviso. Plano: [coleta](roadmap/2026-10-13-coleta-automatica-de-recompensas.md).

Textos da voz e das lições: `pengu\posjogo\licoes.md` (lições) e `docs\LICOES.md` § Avisos ao vivo
(falas e rótulos, dois tons); editar o texto muda o coach sem mexer no código.
**Voz pré-gravada (Aoede, do Gemini):** a fala diz a rota ("o jungler", "flash do mid voltou"), nunca o campeão,
e cada fala possível (452, `avisos.catalogo()`) é gravada uma vez em `%LOCALAPPDATA%\lol-client\voz\pacotes\aoede\`;
o coach toca o arquivo e cai na Maria só no que faltar (anotado em `dados\voz-faltou.jsonl`). Gerar ou completar
o pacote, **com o jogo fechado**: `%LOCALAPPDATA%\lol-client\voz\venv\Scripts\python.exe tools\gerar-pacote-voz.py
--voz aoede --tom serio` (retoma de onde parou; a cota grátis do Gemini acaba no dia, ele para dizendo quantas
faltam e renova às ~04:00, meia-noite do Pacífico; `--seco` só conta). Fala editada no `docs\LICOES.md` só vira
áudio depois de rodar o gerador de novo. Fala que o Whisper ouviu errado fica `suspeita` e toca na Maria até a tarefa
`lol-client-voz` refazer no modelo-alvo (1 vez por dia; `--refazer-suspeitas` pede já, com qualquer modelo); áudio que
"diz outra coisa": `python tools\auditar-pacote-voz.py --refazer "frase"` marca na hora. **Regerar** do zero: apagar a pasta `pacotes\aoede\` e rodar de novo.
**Trocar de voz:** outra voz do Gemini entra em `VOZES_GEMINI` (`tools\gerar-pacote-voz.py`), gera com `--voz <id>`
e o coletor usa com `LOL_VOZ_PACOTE=<id>` (reiniciar o coletor fora de partida). Voltar à Maria: apagar a pasta do
pacote ou `LOL_VOZ_PACOTE=` vazio no ambiente do coletor.
Desligar tudo agora: `schtasks /end /tn lol-client-coletor` (volta no próximo client aberto). Rodar o
coletor sem coach: flag `--sem-coach`.

## O que só uma partida real prova

Testado só offline (simulador tocando a partida gravada 3292746609, prints gravados, Claude falso),
nunca numa partida ao vivo com o código novo: voz audível, alerta de gank (na partida gravada ele era o
jungler), minimapa a 6 fps de verdade, moldura e overlay alinhados sobre o jogo, F8 e F7 com o jogo
aberto, OCR do chat com ≥ 10 pings, mentor chamado pela tarefa agendada, selo com inimigo de verdade no
draft. Roteiro e status: topo do [plano v2](roadmap/2026-10-13-lol-client-v2-coach.md).
Também sem prova no client (13/10/2026): o piscar e a volta no champ select, a janelinha aceitar/recusar, popup
escondido, som calado, jogar de novo, a coleta de recompensas, o chat do pós-jogo e os avisos calados; status nos planos de
[chat, avisos e som](roadmap/2026-10-13-chat-popups-som.md),
[voz e foco](roadmap/2026-10-13-voz-pregravada-e-foco.md), [jogar de novo](roadmap/2026-10-13-jogar-de-novo.md) e
[coleta](roadmap/2026-10-13-coleta-automatica-de-recompensas.md).
**Client compacto** (13/10/2026): testado só com LCU e janela falsas (`teste-compacto*.mjs`, 474 checagens) e os 10 módulos
importados sem erro no CEF do client depois da revisão de 13/10 (`node tools\cdp.mjs eval tools\compacto-importar.js`, só
`import()`); as rotas marcadas [S] (trocas, fila, PDL, convite, líder) e a ranqueada inteira no compacto seguem nos
passos 1 e 9 do [plano](roadmap/2026-10-13-client-compacto.md). Vale depois da próxima recarga da interface. Também
só a partida real prova: arrastar a janela compacta pelo topo (unidade do `Window.MoveTo`), a posição do "modo
compacto" flutuante na seleção da Riot e se a Riot devolve a janela a 1280×720 sozinha (o compacto encolhe de novo).
A variação de PDL do bloco "hoje" conta desde a 1ª leitura do ranque no dia (DataStore do Pengu).
**Histórico próprio no plugin** (19/10/2026): testado só com LCU, DataStore e complemento falsos (`teste-historico.mjs`,
`teste-resumos.py`); só o client prova o `set` real com centenas de linhas, o ritmo do backfill na fila da LCU e se a
LCU tem a linha do tempo das partidas antigas ([relatório](roadmap/2026-10-17-plugin-pengu-primeiro.d/2026-10-19-fase-4.md)).
**Print do overlay e da moldura** (o print comum não vê os dois, de propósito): `python tools\vitrine.py ligar`
antes da partida (vale 1 partida; `estado`/`desligar`), prints em `temp\vitrine\<data>\` ([COLETOR](docs/COLETOR.md) § Coach na partida).

## Provas

| o quê | comando |
| --- | --- |
| todas as provas offline (inclui o ensaio a 20x; ~4 min) | `python tools\rodar-testes.py` |
| ensaio ponta a ponta sem o client (banco copiado, portas 8766/2996) | `python tools\ensaio-coach.py` |
| simulador da Live Client (porta 2998) | `python tools\simular-liveclient.py` |
| registro de queda e vigia do coletor (`--real`: pela tarefa agendada, com tarefas de teste de outro nome, removidas no fim) | `python tools\teste-vida.py` · `python tools\teste-vigia.py` |
| quais telas da Riot tiraram o compacto e por quanto tempo (cada saída automática ou pedida, gravada pelo coletor em `dados\expansoes-compacto.jsonl`; [COLETOR](docs/COLETOR.md) § Registro das expansões) | `python tools\relatorio-expansoes.py` |
| auditoria do pacote de voz (cada `.wav` pelo Whisper contra o catálogo inteiro; o que não bate vira suspeita, toca na Maria e a tarefa `lol-client-voz` refaz no modelo-alvo; só com o jogo fechado, retoma) | `python tools\auditar-pacote-voz.py` (`--so-indice`, `--relatorio`, `--refazer "frase"`) |
| medição passiva da próxima ranqueada para o client compacto (só GET, só sinais em `dados\medicao-compacto-<data>.jsonl`; prints do painel por Edge headless em `temp\prints-partida\`; para sozinho 10 min depois do fim da partida) | `python tools\medir-compacto.py` (`--continuo`: todas as partidas até fechar o client; `--ensaio`: 5 s e sai) |

Pegadinhas medidas: [ARMADILHAS](docs/ARMADILHAS.md). Regras do pós-jogo: [INSIGHTS](docs/INSIGHTS.md).

## Desinstalar tudo

1. Vigia: `python tools\vigia-coletor.py remover` (antes de parar o coletor: senão ele sobe de novo em até
   3 min com o client aberto). Parar o coletor: `schtasks /end /tn lol-client-coletor`.
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
