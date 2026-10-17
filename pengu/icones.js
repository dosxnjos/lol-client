/*
 * Ícones do plugin: Lucide (lucide-static 1.49.0, https://lucide.dev), embutidos aqui só os usados. Nenhuma requisição
 * externa em tempo de execução. Etapa C de roadmap/2026-10-16-chat-da-sala-som-icones.md ("ícones lucide no lugar de
 * emojis", pedido do Gabriel de 16/10/2026).
 *
 * ISC License
 *
 * Copyright (c) 2026 Lucide Icons and Contributors
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * ---
 *
 * Os ícones x, check, minus, plus, maximize-2, minimize-2, arrow-left, chevron-down, chevron-right e chevron-up
 * derivam do projeto Feather:
 *
 * The MIT License (MIT)
 *
 * Copyright (c) 2013-present Cole Bemis
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
// Módulo sem import e sem DOM no topo: importável no node (tools/teste-icones.mjs) e por qualquer parte do plugin.
// O SVG nasce por createElementNS com os dados fixos abaixo (nunca texto vindo de fora); o DOM falso dos testes, sem
// createElementNS, recebe createElement (o mesmo setAttribute/append). Cor por currentColor (segue o color do botão);
// sem CSS carregado o tamanho vem dos atributos width/height. O ícone é decorativo (aria-hidden): botão só com ícone
// leva title e aria-label (o nome do botão), e os testes acham o ícone por data-icone, nunca pelo glifo.
//
// ICONES: nome no produto -> {lucide, partes}. Gerado por `python -I tools/icones-lucide.py <pasta>/icons` a partir do
// pacote lucide-static@1.49.0 do npm (sha512 conferido; cada SVG passa por lista branca: só path/circle e atributos
// geométricos). Ícone novo: acrescentar no NOMES do gerador, gerar de novo e colar o bloco.
export const ICONES = {
  chat: { lucide: 'message-circle', partes: [['path', {d: 'M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719'}]] },
  amigos: { lucide: 'users', partes: [['path', {d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2'}], ['path', {d: 'M16 3.128a4 4 0 0 1 0 7.744'}], ['path', {d: 'M22 21v-2a4 4 0 0 0-3-3.87'}], ['circle', {cx: '9', cy: '7', r: '4'}]] },
  configuracoes: { lucide: 'settings', partes: [['path', {d: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915'}], ['circle', {cx: '12', cy: '12', r: '3'}]] },
  coach: { lucide: 'chart-column', partes: [['path', {d: 'M3 3v16a2 2 0 0 0 2 2h16'}], ['path', {d: 'M18 17V9'}], ['path', {d: 'M13 17V5'}], ['path', {d: 'M8 17v-3'}]] },
  salaTime: { lucide: 'messages-square', partes: [['path', {d: 'M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'}], ['path', {d: 'M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1'}]] },
  replay: { lucide: 'clapperboard', partes: [['path', {d: 'm12.296 3.464 3.02 3.956'}], ['path', {d: 'M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z'}], ['path', {d: 'M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'}], ['path', {d: 'm6.18 5.276 3.1 3.899'}]] },
  bloqueado: { lucide: 'ban', partes: [['circle', {cx: '12', cy: '12', r: '10'}], ['path', {d: 'M4.929 4.929 19.07 19.071'}]] },
  espera: { lucide: 'hourglass', partes: [['path', {d: 'M5 22h14'}], ['path', {d: 'M5 2h14'}], ['path', {d: 'M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22'}], ['path', {d: 'M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2'}]] },
  aviso: { lucide: 'triangle-alert', partes: [['path', {d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3'}], ['path', {d: 'M12 9v4'}], ['path', {d: 'M12 17h.01'}]] },
  denunciar: { lucide: 'flag', partes: [['path', {d: 'M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528'}]] },
  honrar: { lucide: 'heart', partes: [['path', {d: 'M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5'}]] },
  favorito: { lucide: 'star', partes: [['path', {d: 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z'}]] },
  ok: { lucide: 'check', partes: [['path', {d: 'M20 6 9 17l-5-5'}]] },
  fechar: { lucide: 'x', partes: [['path', {d: 'M18 6 6 18'}], ['path', {d: 'm6 6 12 12'}]] },
  minimizar: { lucide: 'minus', partes: [['path', {d: 'M5 12h14'}]] },
  expandir: { lucide: 'maximize-2', partes: [['path', {d: 'M15 3h6v6'}], ['path', {d: 'm21 3-7 7'}], ['path', {d: 'm3 21 7-7'}], ['path', {d: 'M9 21H3v-6'}]] },
  compacto: { lucide: 'minimize-2', partes: [['path', {d: 'm14 10 7-7'}], ['path', {d: 'M20 10h-6V4'}], ['path', {d: 'm3 21 7-7'}], ['path', {d: 'M4 14h6v6'}]] },
  voltar: { lucide: 'arrow-left', partes: [['path', {d: 'm12 19-7-7 7-7'}], ['path', {d: 'M19 12H5'}]] },
  trocaPosicao: { lucide: 'arrow-left-right', partes: [['path', {d: 'M8 3 4 7l4 4'}], ['path', {d: 'M4 7h16'}], ['path', {d: 'm16 21 4-4-4-4'}], ['path', {d: 'M20 17H4'}]] },
  trocaOrdem: { lucide: 'arrow-up-down', partes: [['path', {d: 'm21 16-4 4-4-4'}], ['path', {d: 'M17 20V4'}], ['path', {d: 'm3 8 4-4 4 4'}], ['path', {d: 'M7 4v16'}]] },
  trocaCampeao: { lucide: 'rotate-ccw', partes: [['path', {d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8'}], ['path', {d: 'M3 3v5h5'}]] },
  aberto: { lucide: 'chevron-down', partes: [['path', {d: 'm6 9 6 6 6-6'}]] },
  fechado: { lucide: 'chevron-right', partes: [['path', {d: 'm9 18 6-6-6-6'}]] },
  aumentar: { lucide: 'chevron-up', partes: [['path', {d: 'm18 15-6-6-6 6'}]] },
  adicionar: { lucide: 'plus', partes: [['path', {d: 'M5 12h14'}], ['path', {d: 'M12 5v14'}]] },
};

const NS = 'http://www.w3.org/2000/svg';
const RAIZ = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
const CLASSE_OK = /^[\w -]*$/;

// opções -> atributos da raiz (nome já conferido). tam em px CSS; cheio = preenchido com a cor do texto (♥ do voto dado)
function raiz(nome, { tam = 16, cheio = false, classe = '' } = {}) {
  const n = Math.max(8, Math.min(48, Math.round(Number(tam) || 16)));
  if (!CLASSE_OK.test(String(classe))) throw new Error(`classe de ícone inválida: ${classe}`);
  return { ...RAIZ, ...(cheio ? { fill: 'currentColor' } : {}), width: String(n), height: String(n),
    'aria-hidden': 'true', focusable: 'false', class: `lc-ic lc-ic-${nome}${classe ? ` ${classe}` : ''}` };
}
const conferir = nome => {
  const ic = Object.prototype.hasOwnProperty.call(ICONES, nome) ? ICONES[nome] : null;
  if (!ic) throw new Error(`ícone desconhecido: ${nome}`);
  return ic;
};

// icone('chat', {doc, tam, cheio, classe}) -> <svg> (elemento). data-icone = o nome no produto (testes e CSS)
export function icone(nome, opcoes = {}) {
  const ic = conferir(nome);
  const doc = opcoes.doc || globalThis.document;
  const criar = tag => (typeof doc.createElementNS === 'function' ? doc.createElementNS(NS, tag) : doc.createElement(tag));
  const svg = criar('svg');
  for (const [k, v] of Object.entries(raiz(nome, opcoes))) svg.setAttribute(k, v);
  if (svg.dataset) svg.dataset.icone = nome; else svg.setAttribute('data-icone', nome);
  for (const [tag, attrs] of ic.partes) {
    const p = criar(tag);
    for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v);
    svg.append(p);
  }
  return svg;
}

// a mesma coisa em string, para quem monta HTML (posjogo/index.js). Só dados deste módulo (nunca texto de fora)
export function iconeHtml(nome, opcoes = {}) {
  const ic = conferir(nome);
  const at = o => Object.entries(o).map(([k, v]) => `${k}="${v}"`).join(' ');
  return `<svg ${at(raiz(nome, opcoes))} data-icone="${nome}">${ic.partes.map(([t, a]) => `<${t} ${at(a)}/>`).join('')}</svg>`;
}
