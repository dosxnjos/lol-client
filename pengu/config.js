// Configuração do plugin: defaults + DataStore + classes no <html> + ações no Ctrl+K (CommandBar).
// Classe: chave booleana em camelCase vira lc-kebab (esconderTft -> lc-esconder-tft);
// <modulo>.ligado vira lc-<modulo> (aceite.ligado -> lc-aceite, filaRapida.ligado -> lc-fila-rapida).

const CHAVE = 'lol-client.config';
const POSICOES = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'];
const FILAS = [420, 440];
const ATRASOS = [3, 5, 7, 8, 9, 10];

export const PADRAO = {
  esconderTft: true,
  colunaLarga: true,
  aceite: { ligado: true, atrasoS: 10, limiteS: 12 },
  filaRapida: { ligado: true, fila: 420, pos1: 'TOP', pos2: 'JUNGLE' },
  posjogo: { ligado: true },
  extras: { esconderEvento: false, esconderClassic: false, esconderLoja: false },
};

const kebab = s => s.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
const clonar = o => JSON.parse(JSON.stringify(o));

// mescla o salvo sobre o padrão (chave nova do padrão aparece; chave velha some)
function mesclar(padrao, salvo) {
  const out = {};
  for (const [k, v] of Object.entries(padrao)) {
    const s = salvo?.[k];
    out[k] = v && typeof v === 'object' ? mesclar(v, s) : (s === undefined || typeof s !== typeof v ? v : s);
  }
  return out;
}

export const cfg = clonar(PADRAO);
const ouvintes = new Set();

export function carregar() {
  let salvo = null;
  try { salvo = DataStore.get(CHAVE); } catch { /* sem DataStore: fica o padrão */ }
  Object.assign(cfg, mesclar(PADRAO, salvo));
  // limiteS não é editável: dono é o PADRAO (ajuste depois de medir a janela chega a quem já salvou)
  cfg.aceite.limiteS = PADRAO.aceite.limiteS;
  aplicarClasses();
  return cfg;
}

export function salvar() {
  try { DataStore.set(CHAVE, clonar(cfg)); } catch { /* ignora */ }
  aplicarClasses();
  for (const fn of ouvintes) try { fn(cfg); } catch (e) { console.error('[lol-client]', e); }
}

export const aoMudar = fn => (ouvintes.add(fn), () => ouvintes.delete(fn));

// lista [classe, ligado] de todas as chaves booleanas
export function classes(c = cfg) {
  const out = [];
  for (const [k, v] of Object.entries(c)) {
    if (typeof v === 'boolean') out.push(['lc-' + kebab(k), v]);
    else if (v && typeof v === 'object') for (const [k2, v2] of Object.entries(v)) {
      if (typeof v2 !== 'boolean') continue;
      out.push([k2 === 'ligado' ? 'lc-' + kebab(k) : 'lc-' + kebab(k2), v2]);
    }
  }
  return out;
}

export function aplicarClasses() {
  const el = document.documentElement;
  for (const [nome, ligado] of classes()) el.classList.toggle(nome, ligado);
}

// caminho 'aceite.ligado' -> get/set
const obter = caminho => caminho.split('.').reduce((o, k) => o[k], cfg);
export function definir(caminho, valor) {
  const partes = caminho.split('.'), ultima = partes.pop();
  partes.reduce((o, k) => o[k], cfg)[ultima] = valor;
  salvar();
}

const proximo = (lista, atual) => lista[(lista.indexOf(atual) + 1) % lista.length];
const avisar = msg => { try { Toast.success(msg); } catch { console.log('[lol-client]', msg); } };

const ALTERNAVEIS = [
  ['esconderTft', 'esconder TFT'],
  ['colunaLarga', 'coluna larga das filas'],
  ['aceite.ligado', 'aceitar partida automático'],
  ['filaRapida.ligado', 'botão fila rápida'],
  ['posjogo.ligado', 'painel pós-jogo'],
  ['extras.esconderEvento', 'esconder aba de evento'],
  ['extras.esconderClassic', 'esconder aba CLASSIC'],
  ['extras.esconderLoja', 'esconder loja'],
];

export function registrarAcoes(extras = []) {
  if (typeof CommandBar === 'undefined') return;
  const grupo = 'lol-client';
  for (const [caminho, rotulo] of ALTERNAVEIS) CommandBar.addAction({
    name: `lol-client: ${rotulo} (liga/desliga)`, group: grupo, tags: ['lol-client', caminho],
    perform: () => { definir(caminho, !obter(caminho)); avisar(`${rotulo}: ${obter(caminho) ? 'ligado' : 'desligado'}`); },
  });
  // evitar: caminho cujo valor o ciclo pula (1ª e 2ª posição nunca iguais)
  const ciclo = (caminho, lista, rotulo, fmt = v => v, evitar) => CommandBar.addAction({
    name: `lol-client: ${rotulo} (próximo valor)`, group: grupo, tags: ['lol-client', caminho],
    perform: () => {
      let v = proximo(lista, obter(caminho));
      if (evitar && v === obter(evitar)) v = proximo(lista, v);
      definir(caminho, v); avisar(`${rotulo}: ${fmt(obter(caminho))}`);
    },
  });
  ciclo('aceite.atrasoS', ATRASOS, 'atraso do aceite', v => `${v} s`);
  ciclo('filaRapida.fila', FILAS, 'fila da fila rápida', v => (v === 420 ? 'solo/duo (420)' : 'flex (440)'));
  ciclo('filaRapida.pos1', POSICOES, '1ª posição da fila rápida', undefined, 'filaRapida.pos2');
  ciclo('filaRapida.pos2', POSICOES, '2ª posição da fila rápida', undefined, 'filaRapida.pos1');
  CommandBar.addAction({
    name: 'lol-client: restaurar configuração padrão', group: grupo, tags: ['lol-client'],
    perform: () => { Object.assign(cfg, clonar(PADRAO)); salvar(); avisar('configuração padrão restaurada'); },
  });
  for (const a of extras) CommandBar.addAction({ group: grupo, ...a });
}
