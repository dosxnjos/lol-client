# P0-a — botão "abrir página" sem o complemento (20/10/2026)

Relatório do fechamento do P0-a do [plano da publicação](../2026-10-19-publicacao-e-complemento-publico.md) (§ P0 item a,
§ P3 passo 2). Nada tocou o client real, a LCU real, o coletor real (8765) nem recarregou a interface: o Gabriel estava jogando.
Nenhuma porta aberta além da 0 do `teste-atualizacao.mjs` (servidor falso local que já existia).

## O fato medido (orquestrador, com o Gabriel, 20/10/2026)

`window.open('https://github.com', '_blank')` executado no client (CDP `eval`, fase `None`) abre uma aba no navegador padrão do
Windows (Chrome dele), devolve `null` e nenhum alvo novo aparece no CEF. Consequência: o botão pode abrir a página da versão, mas
não dá para saber se abriu; `null` não é erro e "copiar link" segue de reserva.

## O que fez

| commit | o quê |
| --- | --- |
| `9e6becd` | `pengu/atualizacao.js`: `linkAbrivel(link, repo)` (só `https://github.com/<REPO>/releases` ou `.../releases/tag/vX.Y.Z`, inteiro, com o nome do repositório escapado na regex), `abrirPadrao` (`globalThis.window?.open?.(url, '_blank')`, a chamada medida, sem 3º argumento, retorno descartado, exceção calada), `abrirPagina(ev)` no verificador (`ev?.isTrusted !== true` = nada; sem link abrível = nada), botão "abrir página" antes de "copiar link" só com `estado().abrivel`, dica depois do clique; comentários que diziam "nada de window.open até a medição P0-a" reescritos (`atualizacao.js` e `atualizador.js`). Provas novas em `tools/teste-atualizador.mjs` (e) e (f) e `tools/teste-atualizacao.mjs` (o); comentário do `rodar-testes.py` |
| (docs) | `docs/TEXTOS-DA-INTERFACE.md` (botão e dica), `docs/ARMADILHAS.md` § Client e Pengu (`null` mesmo abrindo; só por clique), `README.md` (§ atualização, § O que só o client prova, tabela de provas), `publico/LEIA-ME.md` § Atualizar, `CLAUDE.md` (cláusula na linha da rede externa), § Estado do plano, este relatório |

**Como funciona:** o atualizador sem o complemento (`atualizador.js` `semComplemento`) segue devolvendo `{texto, link}`; a linha
"Versão x.y.z disponível" mostra o endereço selecionável, **abrir página** e **copiar link**. O clique dele chama
`v.abrirPagina(evento)`, que confere `isTrusted === true` e `linkAbrivel`, chama `window.open(url, '_blank')` uma vez e mostra
'A página abre no navegador padrão. Se ela não aparecer, use "copiar link".' (uma dica por vez: "copiar link" troca pela dele; o
"atualizar" de novo apaga). Nada abre em carga, consulta diária, laço de 1 h, virada de fase ou chave: só o ouvinte do botão chama
`abrirPagina`, e ela não fica exposta no `__lolClient`.

## Provas

| prova | resultado |
| --- | --- |
| `node tools/teste-atualizador.mjs` | **69/69** (49 antes; 20 casos novos ou ampliados) |
| (b) e (d): com o complemento | "abrir página" nunca aparece no progresso, no "Atualizado", nas 4 recusas nem nos 7 erros; aparece na troca incompleta (ver Desvios) |
| (e) guardas | `atualizador.js` sem `window.open`; `atualizacao.js` com **uma** linha de `window.open` (qualquer grafia: `window.open`, `window?.open`, `globalThis.open`, `['open']`), a do `abrirPadrao`, com `(url, '_blank')`; `abrir()` chamado num lugar só, dentro do `abrirPagina`, depois de `if (ev?.isTrusted !== true) return false;`; nos 48 módulos de `pengu/**`, `window.open` só no `atualizacao.js`. A guarda antiga (`/window\.open/`) não pegava `window?.open`: foi trocada |
| (f) clique | antes do "atualizar" sem botão e sem abrir; mostrar o botão não abre; clique sintético pelo ouvinte do botão (`isTrusted: false`) = 0; `abrirPagina` com `undefined`, `null`, `{}`, `isTrusted` `"true"`, `1`, `false` = 0 e `false`; clique dele = **1** `window.open` com `https://github.com/<REPO>/releases/tag/v0.2.0` e `'_blank'` (2 argumentos); `null` devolvido = dica, botões e endereço seguem, nenhum "Não foi possível"; 2º clique = 2º open |
| (f) nada sozinho | com o botão na tela: 10 viradas de fase (`Lobby` a `EndOfGame` e `None`), `iniciar`, `procurar`, `consultar`, chave desligada e ligada = 0 open |
| (f) URL fora | 13 endereços (outro repositório, `<REPO>-x`, `../`, `releases/download`, query, `#`, quebra de linha, `%2e%2e`, tag `v0.2`, raiz do repositório, `github.com.evil.example`, `http://`, `javascript:`): sem botão, `abrirPagina` com clique dele = `false`, 0 open; `linkAbrivel` aceita a tag com e sem `v` e `/releases`, e o `.` do nome do repositório não é curinga (`dono/lolXclient` ≠ `dono/lol.client`) |
| (f) falhas | `window.open` que lança e `window` ausente: nada quebra, a dica aparece |
| (f) total | no arquivo inteiro, o espião viu exatamente os 2 cliques dele |
| `node tools/teste-atualizacao.mjs` | **88/88** (87 antes): (o) espião de `window.open` instalado antes do import, 0 chamadas no arquivo inteiro (carga, 1 por dia em 3 dias, laço, fases, erros calados, "procurar agora", telas, "atualizar" sem atualizador, servidor falso local) |
| mutação 1: sem a linha do `isTrusted` | **63/69**: falham (e) trava, (f) sintético, (f) sem evento/`{}`, (f) "1 vez", (f) 2º clique, (f) total (9 opens). Revertida: 69/69 |
| mutação 2: trava fraca `ev?.isTrusted === false` (o padrão do `compacto/`) | **64/69**: falham (e) trava, (f) sem evento/`{}` (5 de 6 abriam), (f) "1 vez", (f) 2º clique, (f) total. Revertida: 69/69 |
| `node tools/teste-textos.mjs` · `teste-icones.mjs` · `teste-vozes.mjs` | 11/11 · 14/14 · 48/48 |
| `python tools/rodar-testes.py ".mjs"` | **30/33**; as 3 que falham não importam nada da atualização e falham por falta de dado nesta worktree: `teste-licoes.mjs` e `teste-abas.mjs` pedem `temp/licoes/3292712362.json` (gerado por `teste-licoes.py`), `teste-matchup.mjs` chama `teste-matchup.py`, que abre o banco de `dados/` (não existe na worktree). Não rodei os `.py` que gerariam isso: leem ou criam banco, fora do escopo e com o coletor real de pé |

## Bloco Voz

`pengu/vozes.js` `bloco()` sai antes de pintar qualquer coisa sem o recurso `voz-pacote` (`if (!pode()) return;`), e sem o
complemento o bloco Voz mostra só "Precisa do complemento coach" (`blocos.js`). Não há caminho sem complemento que mostre
endereço: nada a aplicar (o `teste-vozes.mjs` segue com o `window.open` que lança e a guarda "sem window.open" no `vozes.js`).

## Desvios e porquê

- **"abrir página" também na troca incompleta** (o pedido dizia "no caminho sem o complemento"): a troca incompleta é o único
  caso do complemento que devolve `{texto, link}`, e o texto manda instalar "pela página abaixo"; o botão segue o link (mesma
  trava `linkAbrivel`), sem regra especial. Confiança alta. Reverte: `semComplemento` devolver `abrir: true` e o botão exigir isso.
- **Trava estrita `isTrusted === true`**, não o `!== false` do `compacto/`: lá o teste node manda evento sem `isTrusted`; aqui
  chamada sem evento (console, outro módulo) não pode abrir nada. A mutação 2 prova a diferença.
- **A trava fica no `abrirPagina`, não só no ouvinte do botão:** quem chamar o método sem o evento do clique não abre nada.
- **`linkAbrivel` é a 2ª trava, não a única:** o link já nasce de `REPO` (constante) e de uma tag que passou no `lerRelease`
  (`v?\d+.\d+.\d+`); o `aplicar()` segue aceitando qualquer `https://github.com/` para mostrar e copiar, mas só a página de
  releases do `REPO` ganha o botão.
- **Dica depois do clique** (não pedida): sem ela, o clique que não abre nada (navegador padrão ausente, política do Windows)
  deixaria a pessoa sem saber da reserva. A frase não afirma que abriu.
- **`COLETOR.md` não mudou:** a § Atualização pelo botão do plugin não cita "copiar link" (o pedido condicionava a isso).
- **Sem `'noopener'` nem outro 3º argumento:** o P0-a mediu `(url, '_blank')`; outra forma pode cair noutro caminho do CEF.

## O que o pedido não dizia (completei)

- Guarda de `window.open` no plugin inteiro (48 módulos) e em qualquer grafia: a antiga só via `window.open` literal.
- Espião de `window.open` no `teste-atualizacao.mjs` inteiro (carga, laço, fases, servidor falso), não só no do atualizador.
- `window.open` que lança ou `window` ausente: calado (try/catch), provado.
- Linha no `CLAUDE.md` (cláusula na regra da rede externa): é regra nova de onde `window.open` pode existir.

## O que só o client real prova

- Um clique de verdade no botão "abrir página" chegando ao ouvinte com `isTrusted: true` e o `window.open` disparado de dentro
  do clique (o P0-a mediu pelo CDP `eval`, não por clique; o CEF pode tratar gesto do usuário diferente).
- O navegador padrão vindo para a frente com o client aberto, inclusive na ⚙ do compacto (a linha no topo da lateral).
- Os dois botões lado a lado na ⚙ do client normal (`.lc-versao-acoes` sem quebra, `min-width: 140px`) e na do compacto (com
  quebra), e a dica abaixo.
- A página do release existir de verdade: só depois do P6 (sem o repositório público, o GitHub responde 404 na aba aberta).
