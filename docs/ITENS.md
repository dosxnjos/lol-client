# Itens contra a composição inimiga (tabela curada)

Dona do lembrete de build que o painel da 2ª tela mostra na tela de carregamento (plano v2, passo
15f item 5, e o bloco "Time e objetivos" do passo 10). `coletor/sugestoes.py` lê as duas tabelas
abaixo: mudar o texto ou o limiar é editar aqui, sem código. Nomes de item em pt-BR como a LCU
dá (`/lol-game-data/assets/v1/items.json`, conferidos em 13/10/2026, patch 16.20).

Curadoria do agente em 13/10/2026 (conhecimento geral de build, sem estatística pessoal):
**ajustar à mão** quando a build de quem joga divergir.

## Como a composição é medida

Só com dado da LCU (`champions/{id}.json`), sem raspar site:

| métrica | fórmula |
| --- | --- |
| `ad` | nº de inimigos com `tacticalInfo.damageType` = `kPhysical` |
| `ap` | nº com `kMagic` |
| `misto` | nº com `kMixed` |
| `cura` | nº de inimigos na lista de cura abaixo |
| `controle` | soma de `playstyleInfo.crowdControl` (1 a 3 por campeão; 5 inimigos = 5 a 15) |
| `tanques` | nº com `tank` em `roles` |

`quando` aceita uma condição `<métrica> <op> <número>` (op: `>=`, `>`, `<=`, `<`, `==`); várias
linhas do mesmo campeão podem valer juntas (o painel mostra as 2 primeiras na ordem da tabela).

## Lembretes

| campeão | quando | lembrete |
| --- | --- | --- |
| Renekton | ad >= 3 | armadura: Botas Galvanizadas de Aço e Dança da Morte |
| Renekton | ap >= 3 | resistência mágica: Passos de Mercúrio e Mandíbula de Malmortius |
| Renekton | cura >= 2 | anticura cedo: Chamado do Carrasco (vira Serrespada Quimiopunk) |
| Renekton | controle >= 12 | muito controle: Passos de Mercúrio e Sinal de Sterak |
| Renekton | tanques >= 2 | tanques: Cutelo Negro primeiro |
| Zac | ad >= 3 | armadura: Botas Galvanizadas de Aço e Presságio de Randuin |
| Zac | ap >= 3 | resistência mágica: Passos de Mercúrio e Força da Natureza |
| Zac | cura >= 2 | anticura: Colete Espinhoso cedo (vira Armadura de Espinhos) |
| Zac | controle >= 12 | muito controle: Passos de Mercúrio |
| Zac | misto >= 2 | dano misto: Égide de Fogo Solar e Rookern Lamúrico |

## Cura

Campeões em que cura ou roubo de vida é pilar do kit (alias da LCU, um por linha da lista):

- Aatrox
- Briar
- DrMundo
- FiddleSticks
- Illaoi
- Maokai
- Milio
- Nami
- Olaf
- Sona
- Soraka
- Swain
- Sylas
- Trundle
- Vladimir
- Volibear
- Warwick
- Yuumi
- Zac
