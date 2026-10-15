// Prova do painel da 2ª tela (painel/painel.js) num DOM falso, sem navegador: o texto dos blocos para um estado dado.
// Partida 3293420970 (15/10/2026): "o inimigo está morto e está constando dados de que ele não foi visto há tanto
// tempo [...] é óbvio que se ele está morto ele não vai ser visto". Morto = "morto, volta em N s", nunca "visto há".
// uso: node tools/teste-painel.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));

class El {
  constructor(tag = 'div') {
    this.tag = tag; this.textContent = ''; this.className = ''; this.hidden = false; this.filhos = []; this.sel = {};
    const cl = new Set();
    this.classList = { add: (...c) => c.forEach(x => cl.add(x)), remove: (...c) => c.forEach(x => cl.delete(x)),
      toggle: (c, v) => (v ?? !cl.has(c)) ? cl.add(c) : cl.delete(c), contains: c => cl.has(c) };
  }
  replaceChildren(...f) { this.filhos = f; }
  append(...f) { this.filhos.push(...f); }
  remove() {}
  querySelector(s) { return (this.sel[s] ??= new El()); }
  querySelectorAll() { return []; }
  get childElementCount() { return this.filhos.length; }
  texto() { return [this.textContent, ...this.filhos.map(f => f.texto())].filter(Boolean).join(' '); }
}

function carregar() {
  const ids = {};
  const ctx = {
    document: { getElementById: id => (ids[id] ??= new El()), createElement: t => new El(t) },
    window: {}, console, setInterval: () => 0, fetch: () => new Promise(() => {}),
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(`${RAIZ}painel/painel.js`, 'utf8'), ctx);
  return { ctx, ids };
}

function estado(adv, ameaca) {
  return {
    partida: true, fase: 'jogo', relogio: '13:50', jogadores: [],
    rota: { eu: { nome: 'Renekton', rota: 'TOP', ouroEstimado: 3000, cs: 110, nivel: 11 }, bolso: 300, adv,
      diff: { ouro: 200, cs: 10, nivel: 0 }, cor: { ouro: 'neutro', cs: 'neutro', nivel: 'neutro' } },
    ameaca, objetivos: {},
  };
}

let falhas = 0;
function caso(nome, ok, detalhe) {
  if (!ok) falhas += 1;
  console.log(`${ok ? 'ok ' : 'FALHOU'} ${nome}${detalhe ? `  (${detalhe})` : ''}`);
}

const base = { nome: 'Malphite', nivel: 11, cs: 100, ouroEstimado: 2800 };
// 1. adversário morto (o coletor manda atual=true desde 15/10): rodapé diz quando ele volta, sem "visto há"
{
  const { ctx, ids } = carregar();
  ctx.desenhar(estado({ ...base, atual: true, vistoHaS: 0, morto: true, renascerS: 22.4 },
    { nome: 'Malphite', rota: 'TOP', k: 1, d: 3, a: 0, ouroEstimado: 2800, dano: 'AP', nivel: 11, atual: true,
      vistoHaS: 0, morto: true, renascerS: 22.4, minhaRota: true }));
  const rod = ids['rota-rodape'].textContent, chips = ids['ameaca-chips'].texto();
  caso('3293420970: adversário morto = "Malphite morto, volta em 23 s" no rodapé da rota, sem amarelo',
    rod.startsWith('Malphite morto, volta em 23 s') && !rod.includes('visto há') && !ids['rota-rodape'].className.includes('amarelo'), rod);
  caso('3293420970: bloco da ameaça: "morto, volta em 23 s" (antes: "morto: 22.4 s")',
    chips.includes('morto, volta em 23 s') && !chips.includes('visto há'), chips);
}
// 2. lado oposto: vivo e sumido há 40 s = "visto há 40 s: dados dele parados" em amarelo (como antes)
{
  const { ctx, ids } = carregar();
  ctx.desenhar(estado({ ...base, atual: false, vistoHaS: 40, morto: false, renascerS: 0 }, null));
  const rod = ids['rota-rodape'].textContent;
  caso('lado oposto: vivo e sumido segue "visto há 40 s: dados dele parados", amarelo',
    rod.startsWith('Malphite visto há 40 s: dados dele parados') && ids['rota-rodape'].className.includes('amarelo'), rod);
}
// 3. morto com o tempo zerado (último segundo): só "morto"
{
  const { ctx, ids } = carregar();
  ctx.desenhar(estado({ ...base, atual: true, vistoHaS: 0, morto: true, renascerS: 0 }, null));
  const rod = ids['rota-rodape'].textContent;
  caso('morto sem tempo de renascer (0 s) = "Malphite morto"', rod.startsWith('Malphite morto ·'), rod);
}
console.log(falhas ? `FALHOU (${falhas})` : 'ok (0 falhas)');
process.exit(falhas ? 1 : 0);
