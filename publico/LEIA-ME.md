# lol-ultra-client

Plugin do [Pengu Loader](https://github.com/PenguLoader/PenguLoader) para o client do League of Legends: um modo compacto do client, aceite
automático com botão "não aceitar", fila rápida, runas trocadas ao travar o campeão, coleta das recompensas sem escolha,
avisos calados, chat do pós-jogo melhorado e um pós-jogo com lições tiradas das suas partidas. Tudo em português do Brasil.

Opcional: o **complemento coach**, um programa em Python para Windows que soma ao plugin o coach ao vivo durante a
partida (voz, painel numa 2ª tela, alertas sobre o minimapa) e a janela de aceitar partida fora do client.

O lol-ultra-client não é endossado pela Riot Games e não reflete as opiniões da Riot Games nem de ninguém envolvido
oficialmente na produção ou gestão das propriedades da Riot Games. Riot Games e todas as propriedades associadas são
marcas comerciais ou marcas registradas da Riot Games, Inc.

## Antes de instalar: riscos

- **O Pengu Loader modifica o client da Riot.** A Riot não dá suporte a isso; plugins de client ficam numa zona cinza dos
  Termos de Serviço da Riot Games. O uso é por sua conta e risco, inclusive o
  risco para a sua conta.
- **Automações ligadas por padrão:** aceitar a partida encontrada (com contagem e "não aceitar"), coletar recompensas que
  não pedem escolha e calar dois avisos do client. A Riot pode tratar automação de fila como violação dos termos. Cada uma
  se desliga nas Configurações (abaixo).
- **O coach ao vivo dá orientações durante a partida**, algo que a Riot não aprova em produtos de terceiros. Ele só usa o
  que você já vê: a API oficial da partida (Live Client Data), o histórico das suas partidas e imagens da sua própria tela.
- **O que nunca faz:** ler a memória do jogo, injetar código no jogo, apertar tecla ou clicar por você, mostrar o que está
  na névoa de guerra ou revelar o nome de jogador oculto.

## Requisitos

- Windows 10 ou 11 e o client do League of Legends.
- [Pengu Loader 1.1.6](https://github.com/PenguLoader/PenguLoader/releases/tag/v1.1.6). Outras versões não foram testadas
  (a 1.2 ainda é pré-lançamento).

## Instalar o plugin

1. Instale o Pengu Loader 1.1.6 e ative-o, como explica a página dele.
2. Baixe `lol-ultra-client-plugin-<versão>.zip` da página de versões deste repositório (Releases). Para conferir o
   arquivo: `certutil -hashfile lol-ultra-client-plugin-<versão>.zip SHA256` tem de dar o mesmo valor da linha dele no
   `SHA256SUMS.txt` da mesma versão.
3. Extraia a pasta `lol-ultra-client` do zip para dentro da pasta `plugins` do Pengu Loader (na instalação padrão,
   `C:\Program Files\Pengu Loader\plugins\lol-ultra-client`).
4. Abra o client. Se ele já estava aberto, feche e abra de novo **na tela inicial ou no lobby**: nunca na fila, na seleção
   de campeões ou durante a partida.

## Configurações

No client: **Configurações › LOL-CLIENT** (e a paleta de comandos, Ctrl+K). Cada parte tem a própria chave:

| parte | bloco | padrão |
| --- | --- | --- |
| aceitar a partida encontrada, com contagem e "não aceitar" | Aceitar partida | ligado |
| coletar recompensas que não pedem escolha (nunca abre baú, cria, desencanta ou compra) | Recompensas | ligado |
| calar o aviso de runas mudadas pelo jogo e o de Golpear colocado sozinho | Avisos do client | ligado |
| modo compacto do client (Ctrl+Shift+M alterna) | Client compacto | ligado |
| fila rápida e "jogar de novo" (só buscam com o seu clique; pedem um 2º clique depois de derrotas seguidas e de madrugada) | Fila rápida | ligado |
| runas ao travar o campeão (nada acontece até você criar uma regra) | Runas | ligado |
| procurar versão nova uma vez por dia | Atualizações | ligado |

"Restaurar padrão" volta tudo ao padrão acima.

## O que fica guardado e o que sai da máquina

- O plugin guarda as configurações e um resumo de até 500 partidas suas (campeão, posição, resultado, números aos 10 e 15
  minutos; adversários só pelo campeão, nunca pelo nome) no armazenamento do Pengu Loader, neste computador. Esse
  armazenamento pode ser lido por outros plugins instalados.
- O plugin só fala com o client da Riot neste computador e, uma vez por dia, com a `api.github.com` para saber se há versão
  nova (desligável no bloco Atualizações). Nada é enviado a servidor do projeto: ele não tem servidor.
- O complemento coach fala com o plugin só dentro deste computador (`127.0.0.1`), baixa dados públicos de campeões de
  `ddragon.leagueoflegends.com` e, só quando você pede, as atualizações e o pacote de voz da página de versões deste
  repositório, com o hash conferido antes de usar.

## Complemento coach (opcional)

O que soma ao plugin: coach ao vivo com voz (1 fala por vez, sobre a sua rota, o jungler inimigo e os objetivos), painel
numa 2ª tela, alertas e área provável do jungler sobre o minimapa, Flash dos inimigos pelo chat ou pela tecla F7, a janela
de aceitar partida fora do client e lições do pós-jogo sobre todas as partidas guardadas.

Requisitos a mais: Python 3.12 ou mais novo, de 64 bits ([python.org](https://www.python.org/downloads/windows/); testado
no 3.14), o reconhecimento de texto do Windows com o idioma português (Brasil) instalado e o Microsoft Edge (para o painel).

1. Baixe `lol-ultra-client-complemento-<versão>.zip` da mesma versão do plugin e confira o hash como no plugin.
2. Extraia e rode `instalar.cmd` (duplo clique, sem administrador). Ele:
   - procura o Python (sem um 3.12 ou mais novo, diz onde baixar e não muda nada);
   - cria um ambiente Python só do complemento em `%LOCALAPPDATA%\lol-client\complemento\venv` e instala nele as
     bibliotecas com versão fixa (`requirements-complemento.txt`; na 1ª vez, alguns minutos de download);
   - copia o complemento para `%LOCALAPPDATA%\lol-client\complemento\lol-ultra-client-complemento` (numa reinstalação, as
     partidas e as configurações guardadas ficam);
   - copia o plugin para `plugins\lol-ultra-client` do Pengu Loader (a pasta vem da ativação do Pengu Loader; sem ela, o
     `instalar.cmd` pergunta);
   - cria o atalho "lol-ultra-client" na pasta Inicializar do Windows: o complemento sobe com o Windows, sem janela, espera o
     client abrir e volta sozinho se fechar. Nenhuma tarefa agendada, nada que peça administrador.
3. No client: **Configurações › LOL-CLIENT › Complemento coach**, ligue "Usar o complemento coach".
4. Voz: sem o pacote de voz, o coach fala com a voz do Windows. O botão "baixar vozes" no bloco Voz (na tela inicial ou no
   lobby) baixa o pacote Aoede desta versão (cerca de 36 MB) da página de versões, confere o hash e o instala em
   `%LOCALAPPDATA%\lol-client\voz`; vale a partir da próxima partida. Quando uma versão nova muda as falas, o mesmo botão vira
   "atualizar vozes". O `desinstalar.cmd` apaga o pacote junto.

O coach fica calado em partida assistida (modo espectador). O painel abre no monitor secundário de menor número; para usar
outro, escreva o número dele na chave `"monitorPainel": "DISPLAY3"` do arquivo `dados\config.json` da pasta do complemento
(com o client fechado, mantendo as aspas e as vírgulas do arquivo). Se o arquivo ficar inválido, o complemento usa as
configurações padrão e, ao salvar as configurações de novo, guarda o texto escrito em `dados\config.invalido.json`. A pasta do League of Legends é achada sozinha
(a registrada pelo Riot Client ou a do client aberto).

## Atualizar

Com versão nova, a engrenagem do modo compacto ganha um ponto e as Configurações mostram a versão com o botão Atualizar.
Com o complemento coach, o botão baixa, confere e troca os arquivos do plugin e do complemento; depois, o botão
"Recarregar agora" aparece na tela inicial ou no lobby. Sem o complemento, o `atualizar.cmd` do pacote faz a mesma troca com um duplo clique;
a linha também mostra o endereço da página da versão com "abrir página" (abre no navegador padrão) e "copiar link".
Plugin e complemento sempre saem juntos, na mesma versão.

## Desinstalar

- Com o complemento coach: feche o client e rode `desinstalar.cmd` (na pasta do complemento ou na extraída do zip). Ele
  fecha o complemento, apaga o atalho da pasta Inicializar, a pasta `plugins\lol-ultra-client` do Pengu Loader e a pasta
  `%LOCALAPPDATA%\lol-client\complemento` (com as partidas guardadas por ele).
- Só o plugin: com o client fechado, apague a pasta `plugins\lol-ultra-client` do Pengu Loader.

## Licença

MIT (arquivo `LICENSE`). Código e conteúdo de terceiros: `TERCEIROS.md`. Problemas e sugestões: aba Issues deste
repositório.
