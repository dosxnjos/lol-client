# Travadas de 1–5 s na partida: diagnóstico e medidor (15/10/2026)

- **Data:** 15/10/2026
- **Alvo:**
  - `tools/medir-travadas.py` (novo)
  - `coletor/travadas.py` (novo, gancho)
  - 2 linhas em `coletor/coletor.py` (`Coletor.fase`, `InProgress`)
  - prova `tools/teste-medir-travadas.py`
  - docs: [COLETOR](../docs/COLETOR.md) § Medidor de travadas e [ARMADILHAS](../docs/ARMADILHAS.md) § Windows
- **Fora:** `coletor/avisos.py`, `feiticos.py`, `ao_vivo.py`, `coach_vivo.py` e `pengu/**`, porque outras frentes
  mexiam neles no mesmo dia. Driver, rede do Windows e roteador também ficam fora: são do Gabriel e viram recomendação.

## Pedido

Relato do Gabriel, transcrição do Reco de 15/10, 12:41:

> tenho percebido algumas quedas no jogo [...] às vezes são 5 segundos. E quando isso ocorre no meio de uma luta de
> time, eu morro [...] Caiu por uns dois segundos, ali por volta dos dois minutos e sete [...] quando volta do
> travamento, o ping, que padrão está 35 milissegundos, sobe para 300 e começa a cair.

Hipóteses dele:
- CPU alta, com a central de demandas rodando agentes;
- download de dados do coach ou do mentor;
- Wi-Fi ou roteador.

Objetivo: achar a causa e resolver; se não for nosso, provar.

## Fase 1: diagnóstico (só leitura, feito)

**Veredito:** é a conexão, não o PC nem o código do projeto.

### Conversão do tempo de jogo para hora local

- Partida 3293420970. O r3dlog começa às 12:41:04.196 e o relógio do jogo zera em 85,42 s, ou seja, às
  **12:42:29.6**.
- O "2:07" do relato cai às **12:44:36.6**.
- No `*_netstats.csv`, a coluna `game.time` marca o **fim** da janela de 10 s.

### O que ficou provado

1. **A imagem não travou.** O r3dlog fecha com:
   - `Average FPS 59.84`, `Max Frame Time 145.42`;
   - zero quadros acima de 500 ms no histograma;
   - `app update delayed` = 0 nas 192 linhas do netlog.

2. **Foi latência de rede, sem perda de pacote.** Três janelas, com a linha de base em 15–17 ms:

   | jogo | hora local | RTT | jitter | sem pacote | perdidos |
   | --- | --- | --- | --- | --- | --- |
   | 2:06.6–2:16.6 | 12:44:36–46 | 122 ms | 56 | ~1,7 s | 0 |
   | 18:07–18:17 | 13:00:37–47 | 112 ms | 72 | ~1,3 s | 0 |
   | 23:38–23:48 | 13:06:08–18 | 116 ms | 55 | — | 0 |

   O adaptador era `Wireless`.

3. **Nada do projeto rodava nesses momentos.**
   - **Coletor:** só batimentos. O carregamento da Riot API (101 chamadas) foi às 12:41:10–19, antes da partida.
     Durante a partida, o coletor só fala com localhost e faz 1 chamada spectator.
   - **Voz:** as tarefas rodaram às 11:15 e às 13:15, fora da partida.
   - **Mentor:** começou às 13:14, depois do fim.
   - **Central:** bloqueada a partida inteira (`cinco_h_pct 100`, `n_acoes 0`).
   - **Sessões Claude:** 8 linhas na partida, nenhuma perto dos picos.
   - **Google Drive:** atividade às 12:48, 12:52 e 13:07, também longe dos picos.

4. **Os picos já existiam antes do projeto.** Houve 1–2 picos por partida em 12/10, e o primeiro commit do projeto
   é de 13/10. Eles também não acompanham a carga de agentes:
   - 13/10 00:27: 142 linhas de sessão por minuto e 0 picos;
   - 15/10 12:42: 0,3 linha por minuto e 2% das janelas com pico.

5. **Na madrugada de 15/10 (partida das 01:36) o Wi-Fi caiu de verdade.** A mediana do RTT foi de 122 ms a partida
   inteira. A queda bate em três fontes:
   - pacotes perdidos às 01:49:46, 01:53:06 e 01:55:06;
   - no WLAN-AutoConfig, a sequência 11004 → 11010 → 11005 às 01:49:30, 01:52:51 e 01:54:58;
   - no Google Drive, `OnResponseCompleteFailure` às 01:53:06 e 01:55:02.

### O que é provável, ainda sem prova

- **Fila no Wi-Fi local.** O rádio sai do canal (varredura de roaming ou multicanal) ou retransmite no ar. Isso
  atrasa pacotes sem perder nenhum, que é a assinatura observada. Hoje o adaptador está assim:
  - Realtek 8852BE com driver 6001.15.163.0;
  - 5 GHz no **canal 100, que é DFS**;
  - `Roaming Aggressiveness = Medium`;
  - `Multi-Channel Concurrent = Enabled`;
  - Bluetooth ligado na mesma placa, com o Phone Link rodando;
  - sinal de −53 dBm (100%).
- **Alternativa que ainda não dá para excluir:** congestionamento no provedor ou no roteador.

### Limites do que deu para ver

- O log Operational do Agendador de Tarefas está desligado.
- Os logs do jogo vêm em janelas de 10 s.
- Não existe histórico de bytes de rede por processo.

## Fase 2: medidor (feito)

`tools/medir-travadas.py`. O que mede, como ler e quanto custa está em
[COLETOR](../docs/COLETOR.md) § Medidor de travadas. Ele decide entre Wi-Fi e provedor pingando, a cada 1 s e em
paralelo, quatro destinos:
- o **roteador**;
- o **1º salto do provedor**;
- o **último salto que responde** no caminho até o servidor da partida;
- **1.1.1.1**.

Junto, registra CPU, disco, rede por interface, os 5 processos que mais usam CPU e I/O, e o Wi-Fi pelo netsh. Ao
fim, cruza tudo com os picos do netstats da Riot. A leitura do resultado:
- o roteador sobe junto com o jogo: é o Wi-Fi da casa;
- só os saltos depois do roteador sobem: é o provedor;
- nada sobe e só o jogo sobe: é a Riot.

### Decisões técnicas

| decisão | quem | confiança | o que reverteria |
| --- | --- | --- | --- |
| Pingar o último salto que responde, não o servidor. O servidor 45.7.37.2 não responde a ICMP nem a TCP (medido). | opus | alta | Um servidor da Riot que responda a ping. |
| Tudo por ctypes: ICMP, PDH, `NtQuerySystemInformation`. O psutil não está instalado, e um `ping.exe` por segundo seriam 4 processos/s. | opus | alta | Custo medido acima de 1% na partida. |
| O coletor liga no `InProgress` e o medidor sai sozinho quando o jogo fecha. O gancho tem 2 linhas, e o `coletor/travadas.py` é arquivo novo. | opus | média | Pedido do Gabriel para ligar só à mão; criar `dados/medidor-travadas.desligado` já basta. |
| Só liga com o banco real (`dados/lol.db`). O `ensaio-coach.py` chama `fase("InProgress")` com banco de teste e não pode ligar o medidor. | opus | alta | — |
| O IP do servidor vem do netstats (`peer_address`), nunca da `Command Line` do r3dlog, que tem credencial e chave da partida. | opus | alta | — |
| Os limiares de evento (150 ms, CPU 90%) são os do pedido. Um destino conta como "alto" quando passa de 3× a mediana e também de mediana + 50 ms. | opus | média | Picos reais que a classificação errar. |

### Prova

`python tools/teste-medir-travadas.py`: 38 casos, todos ok. Cobrem:
- o netsh em pt-BR, em utf-8 e em cp850;
- a conversão do relógio do jogo para hora local e a janela marcada pelo fim;
- as quatro classes da classificação;
- os eventos do WLAN;
- o resumo de ponta a ponta;
- o gancho do coletor;
- que nada da `Command Line` chega aos arquivos;
- uma medição real de 8 s, com custo de 0,5% incluindo a partida do processo.

Medição real de 45 s: 0,19% da máquina. Numa rodada com a máquina ocupada por outra sessão, o E10 saiu com 4 amostras
em 9 s. Por isso hoje toda volta atrasada deixa `atraso_s`/`trab_s`, e um atraso de 1,5 s ou mais vira evento "PC
sem folga". O leitor dos logs da Riot também foi conferido na partida 3293420970 real e
achou os mesmos três picos da Fase 1 (12:44:46, 13:00:47, 13:06:17).

## O que o pedido não dizia

- **Fim sozinho e resumo legível.** O medidor fecha quando o jogo fecha e grava o `.txt` em português com um veredito,
  para o Gabriel não precisar ler jsonl.
- **Eventos do WLAN-AutoConfig e troca de BSSID ou canal no resumo.** Foram eles que provaram a queda da madrugada.
- **Custo próprio no `fim` e arquivos com mais de 30 dias apagados.** O medidor não pode virar a causa, nem encher o
  disco.

## Descartado e impraticável

- **Correção técnica no projeto.** A régua da tarefa era: se a causa fosse nossa, aplicar. Não se aplica: nada nosso
  rodou nos picos e eles já existiam antes do projeto. Decidido pelo opus, com a evidência da Fase 1.
- **Bytes de rede por processo.** No Windows isso exige ETW, com sessão de kernel e admin. Fica por interface, mais
  os 5 processos que mais fazem I/O, o que já mostra quem compete pela rede no pico.

## Recomendações (cabem ao Gabriel)

1. **O teste que decide de vez:** 1–2 partidas no cabo. Se as travadas somem, é o Wi-Fi.
2. **Se o cabo não der:**
   - fixar o roteador num canal 5 GHz fora do DFS (36–48);
   - baixar `Roaming Aggressiveness` para o mínimo;
   - desligar `Multi-Channel Concurrent`;
   - testar com Bluetooth e Phone Link desligados;
   - atualizar o driver Realtek;
   - pausar Drive e OneDrive durante o jogo.
3. **Depois da próxima partida:** abrir `dados\travadas-<data>-<HHMM>.txt` e ler o VEREDITO.

## Achado de 21/10/2026: o repetidor do quarto

Partida das 17:26, com o Gabriel sentindo teleporte. Ping a cada 200–250 ms ao roteador, ao 1º salto da operadora
(`100.64.192.1`) e à internet (`1.1.1.1`, `8.8.8.8`); o servidor da partida (`45.7.37.2`) não responde ICMP.

- **Causa:** o PC estava num repetidor TP-Link (BSSID `b0:a7:b9:…`, canal 36), com o mesmo SSID do roteador principal.
  O roteador principal é o BSSID `84:93:b2:…` (canal 100); o MAC do gateway `192.168.1.1` é da mesma família.
- **No repetidor (17:36–17:50):** 0 a 6 perdas por minuto já até o roteador (até 3,6%) e 2 a 8 até a internet.
  Sinal de 100% o tempo todo: o sinal forte era só até o repetidor.
- **No roteador direto (17:51):** 0/200 até o roteador e até a operadora, 1/200 até a internet.
- **O coach ficou descartado:** desligado às 17:44, as perdas continuaram iguais. Rede própria zero, uns 16% de 1 núcleo.
- **O medidor da partida das 13:44 já apontava isso:** 7 de 8 picos do jogo com o "Wi-Fi da casa" como causa.
- **Feito:** `Roaming Aggressiveness` de `4. Medium` para `2. Lowest` (UAC; reverte com o mesmo comando e `4. Medium`).
  Isso não impede o Windows de escolher o repetidor ao reconectar.
- **Recomendado ao Gabriel:** dar ao repetidor um SSID próprio, ou tirá-lo da tomada para jogar.
