// Som do client na ⚙ do compacto (etapa B de roadmap/2026-10-16-chat-da-sala-som-icones.md; pedido do Gabriel de 16/10/2026:
// "deve haver configurações de som no modo compacto"). A seção "Som" da compacto/lateral-config.js junta este pedaço (o som do client,
// o mesmo da página Som das Configurações da Riot) com as chaves de som do plugin (aceite.silenciarSom, coach.voz, avisos com voz),
// que seguem com a dona de sempre (pengu/config.js) e o desenho de sempre (pengu/blocos.js blocoSomPlugin).
//
// Lido no front da Riot 16.20 com `python tools/ler-wad.py` (16/10/2026):
// - rcp-fe-lol-settings 064ffa45e442e12a.js, controller da página Som: 13 bindSetting {model:"soundSettings", namespace:"lol-audio",
//   schemaVersion: LOL_SOUND_SCHEMA_VERSION (5), scope:"local", property, defaultValue}; o mixin grava com doSaveSetting ->
//   persistence.saveDefaultSetting -> saveSetting = i.patch(_getEndpointUrl) {schemaVersion, data: {<property>: valor}}, uma
//   propriedade por PATCH; scope "local" = /lol-settings/v1/local/lol-audio. onSaveSetting manda um 2º PATCH: sfxEnabled -> voiceEnabled
//   (o mesmo valor), sfxVolume -> voiceVolume (0,5 × valor, sem arredondar). Volume grava no slideEnd do settings-slider (soltar).
//   Template: master desligado = efeitos, música e volume geral cinza; efeitos desligados = volume dos efeitos, ambiente e falas cinza;
//   música desligada = volume da música e as 4 músicas cinza. O init da Riot volta tudo ao padrão se schemaVersion < 5 (escreve ao
//   abrir): aqui nunca; versão diferente de 5 = só leitura, com o motivo.
// - rcp-fe-audio 93b2b851e3644d46.js: observa a mesma rota e aplica nos canais do CEF (music, sfx, voice e filhos). sfx-notifications
//   (o aviso de partida encontrada, ARMADILHAS § Client "Sons do ready-check") é filho de sfx: efeitos desligados calam o aviso.
// - Medido no client real (GET, 16/10/2026, fase None): GET /lol-settings/v1/local/lol-audio = {data: {musicEnabled: false},
//   schemaVersion: 5}: só vem o que difere do padrão (o resto é o defaultValue, como o lodash.get da Riot). /help:
//   GetLolSettingsV1LocalByCategory e PatchLolSettingsV1LocalByCategory. Nenhum PATCH enviado ao client real.
// - O som DENTRO da partida é outra rota e outro lugar (GET /lol-game-settings/v1/game-settings, seção Volume, float 0–1, o
//   componente lol-settings-game-sound grava pela GamePreferences da conta): esta seção não mexe nele.
// Só funções puras no topo (tools/teste-compacto-som.mjs); a view recebe doc, lcu e relógio injetados.
import { h } from './comum.js';

export const ROTA_SOM = '/lol-settings/v1/local/lol-audio';
export const VERSAO_SOM = 5;      // LOL_SOUND_SCHEMA_VERSION do rcp-fe-lol-settings 16.20
export const ESPERA_VOLUME_MS = 400; // seta do teclado no controle de volume dispara change a cada passo: grava só o último

// a página Som da Riot, na ordem do template; cinza: 'som' (áudio desligado), 'efeitos' (som ou efeitos), 'musica' (som ou música)
export const OPCOES_SOM = [
  { chave: 'masterSoundEnabled', tipo: 'caixa', padrao: true, rotulo: 'Habilitar áudio do client', explica: 'Desligado, o client fica mudo, inclusive o aviso de partida encontrada.' },
  { chave: 'masterVolume', tipo: 'volume', padrao: 100, rotulo: 'Volume geral', cinza: 'som' },
  { chave: 'sfxEnabled', tipo: 'caixa', padrao: true, rotulo: 'Habilitar efeitos sonoros', cinza: 'som', alias: { chave: 'voiceEnabled', fator: null },
    explica: 'Inclui o aviso de partida encontrada e a voz dos campeões.' },
  { chave: 'sfxVolume', tipo: 'volume', padrao: 100, rotulo: 'Volume dos efeitos sonoros', cinza: 'efeitos', alias: { chave: 'voiceVolume', fator: 0.5 } },
  { chave: 'ambientSfxEnabled', tipo: 'caixa', padrao: true, rotulo: 'Habilitar sons do ambiente', cinza: 'efeitos' },
  { chave: 'pickChampVoEnabled', tipo: 'caixa', padrao: true, rotulo: 'Habilitar falas de escolha', cinza: 'efeitos' },
  { chave: 'banChampVoEnabled', tipo: 'caixa', padrao: true, rotulo: 'Habilitar falas de banimento', cinza: 'efeitos' },
  { chave: 'musicEnabled', tipo: 'caixa', padrao: true, rotulo: 'Habilitar música', cinza: 'som' },
  { chave: 'musicVolume', tipo: 'volume', padrao: 100, rotulo: 'Volume da música', cinza: 'musica' },
  { chave: 'championSelectionMusicEnabled', tipo: 'caixa', padrao: true, rotulo: 'Música da seleção de campeões', cinza: 'musica' },
  { chave: 'ambienceMusicEnabled', tipo: 'caixa', padrao: true, rotulo: 'Música no saguão e no pós-jogo', cinza: 'musica' },
  { chave: 'clientAmbienceMusicEnabled', tipo: 'caixa', padrao: true, rotulo: 'Música da página inicial', cinza: 'musica' },
  { chave: 'loginMusicEnabled', tipo: 'caixa', padrao: true, rotulo: 'Música do início de sessão', cinza: 'musica' },
];
const POR_CHAVE = new Map(OPCOES_SOM.map(o => [o.chave, o]));

export const volumeValido = v => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100;
// valor do controle (texto do <input type=range>) -> inteiro 0–100 | null
export function volumeDe(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && String(v ?? '').trim() !== '' ? Math.min(100, Math.max(0, n)) : null;
}
const valorValido = (op, v) => (op.tipo === 'caixa' ? typeof v === 'boolean' : volumeValido(v));

// resposta do GET -> {ok, valores, versao, motivo}. Só vem o que difere do padrão: o resto é o defaultValue (lodash.get da Riot);
// valor de tipo errado também cai no padrão (a Riot faz o mesmo no rótulo do volume, Number.isInteger)
export function lerSom(r) {
  if (!r?.ok) return { ok: false, valores: null, versao: null, motivo: `não foi possível ler o som do client (${r?.status || r?.erro || 'sem resposta'}): use as Configurações da Riot` };
  const j = r.json;
  if (!j || typeof j !== 'object' || Array.isArray(j) || (j.data !== undefined && (typeof j.data !== 'object' || j.data === null || Array.isArray(j.data)))) {
    return { ok: false, valores: null, versao: null, motivo: 'resposta inesperada do som do client: use as Configurações da Riot' };
  }
  const versao = j.schemaVersion ?? null;
  const dados = j.data || {};
  const valores = {};
  for (const op of OPCOES_SOM) valores[op.chave] = valorValido(op, dados[op.chave]) ? dados[op.chave] : op.padrao;
  // sem versão = nada salvo ainda (a Riot grava a versão no 1º PATCH); versão diferente de 5 = a Riot zeraria tudo ao abrir: só leitura
  if (versao !== null && versao !== VERSAO_SOM) return { ok: false, valores, versao, motivo: `versão das configurações de som não reconhecida (${versao}): use as Configurações da Riot` };
  return { ok: true, valores, versao, motivo: '' };
}

// cinza de cada opção, a mesma conta do template (soundDisabled, sfxDisabled, musicDisabled)
export function cinzaDe(valores) {
  const v = valores || {};
  const som = v.masterSoundEnabled === false;
  const grupos = { som, efeitos: som || v.sfxEnabled === false, musica: som || v.musicEnabled === false };
  const r = {};
  for (const op of OPCOES_SOM) r[op.chave] = op.cinza ? grupos[op.cinza] : false;
  return r;
}

// chave + valor -> PATCHes na ordem da Riot (doSaveSetting, depois onSaveSetting) | [] se a chave ou o valor não valem
export function corposSom(chave, valor) {
  const op = POR_CHAVE.get(chave);
  if (!op || !valorValido(op, valor)) return [];
  const um = data => ({ metodo: 'PATCH', rota: ROTA_SOM, corpo: { schemaVersion: VERSAO_SOM, data } });
  const lista = [um({ [chave]: valor })];
  if (op.alias) lista.push(um({ [op.alias.chave]: op.alias.fator === null ? valor : op.alias.fator * valor }));
  return lista;
}

// ---------- view: o pedaço da Riot na seção Som (nasce uma vez; pintar só muda valor, texto e disabled) ----------
// amb = {doc, lcu, avisar, esperar, cancelar, aoSoltar()} -> {el, ler(), velho(), arrastando(), estado()}
export function criarSomView(amb) {
  const { doc } = amb;
  const esperar = amb.esperar || ((fn, ms) => setTimeout(fn, ms));
  const cancelar = amb.cancelar || (t => clearTimeout(t));
  // fila: um gesto grava depois do anterior terminar (os 2 PATCHes de um clique nunca se misturam com os do próximo: a ordem do front);
  // seq: só o último gesto de cada chave consolida o valor na tela
  const st = { lido: false, lendo: false, velho: true, ok: false, valores: null, motivo: '', versao: null, arrastando: null, timers: new Map(), gravando: 0,
    fila: Promise.resolve(), seq: new Map() };
  const linhas = new Map();
  const nota = h('p', { doc, class: 'lc-explica lc-som-nota', dataset: { a: 'som-nota' } }, 'lendo o som do client…');
  const deEle = ev => !!ev && ev.isTrusted !== false;
  // soltou o arrasto: a repintura pendente da ⚙ espera o fim do evento do mouse (pointerup -> mouseup -> change no mesmo evento; tirar o
  // controle do DOM antes do change perderia a gravação)
  function soltar() {
    if (st.arrastando === null) return;
    st.arrastando = null;
    esperar(() => amb.aoSoltar?.(), 0);
  }
  // soltou fora do controle (o pointerup cai noutro elemento ou fora da página): o documento solta, na captura
  try { doc.addEventListener?.('pointerup', soltar, true); doc.addEventListener?.('pointercancel', soltar, true); } catch { /* sem DOM */ }

  const textoVolume = (op, v) => `${op.rotulo}: ${v}`;
  for (const op of OPCOES_SOM) {
    if (op.tipo === 'caixa') {
      const input = h('input', { doc, type: 'checkbox', dataset: { a: 'som-caixa', som: op.chave } });
      input.disabled = true;
      input.addEventListener('change', ev => {
        if (!deEle(ev) || !st.ok || cinzaDe(st.valores)[op.chave]) { pintar(); return; } // sintético, sem leitura ou cinza: volta ao lido, nada sai
        st.valores[op.chave] = !!input.checked;
        pintar();
        gravar(op.chave, !!input.checked);
      });
      const rot = h('label', { doc, class: 'lc-som-rot' }, input, h('span', { doc }, op.rotulo));
      linhas.set(op.chave, { op, input, el: h('div', { doc, class: 'lol-settings-general-row lc-som-linha' }, rot, op.explica ? h('p', { doc, class: 'lc-explica' }, op.explica) : null) });
    } else {
      const input = h('input', { doc, type: 'range', min: '0', max: '100', step: '1', class: 'lc-som-vol', dataset: { a: 'som-volume', som: op.chave } });
      input.disabled = true;
      const txt = h('div', { doc, class: 'lol-settings-window-size-text lc-som-voltxt' }, textoVolume(op, op.padrao));
      // arrastando: a lateral-config não repinta (o controle sairia do lugar no meio do arrasto); input só muda o número
      // cinza não arrasta (o Chromium manda pointerdown em input disabled, e sem arrasto nunca viria o pointerup: a ⚙ ficaria parada)
      input.addEventListener('pointerdown', () => { st.arrastando = input.disabled ? null : op.chave; });
      const soltou = () => { if (st.arrastando === op.chave) soltar(); };
      input.addEventListener('pointerup', soltou);
      input.addEventListener('pointercancel', soltou);
      input.addEventListener('input', () => { const v = volumeDe(input.value); if (v !== null) txt.textContent = textoVolume(op, v); });
      input.addEventListener('change', ev => {
        soltou();
        const v = volumeDe(input.value);
        if (!deEle(ev) || !st.ok || v === null || cinzaDe(st.valores)[op.chave]) { pintar(); return; }
        st.valores[op.chave] = v;
        pintar();
        // só o último valor sai: o soltar do mouse dispara 1 change; a seta do teclado, 1 por passo
        const t = st.timers.get(op.chave);
        if (t !== undefined) cancelar(t);
        st.timers.set(op.chave, esperar(() => { st.timers.delete(op.chave); gravar(op.chave, v); }, ESPERA_VOLUME_MS));
      });
      linhas.set(op.chave, { op, input, txt, el: h('div', { doc, class: 'lol-settings-general-row lc-som-linha lc-som-linhavol' }, txt, input) });
    }
  }
  // arrasto preso (sem pointerup nenhum): o próximo clique fora de um volume solta. Quem chama é a ⚙ inteira (lateral-config.js), não só
  // a seção: o clique no cabeçalho de outro bloco ou na busca também solta (revisão de 16/10/2026: a ⚙ ficava parada)
  const soltarSeFora = ev => { if (st.arrastando !== null && ev?.target?.dataset?.a !== 'som-volume') soltar(); };
  const el = h('div', { doc, class: 'lc-som', dataset: { a: 'som-client' } },
    h('div', { doc, class: 'lc-lt-subtit' }, 'Som do client'), nota, ...[...linhas.values()].map(l => l.el),
    h('p', { doc, class: 'lc-explica' }, 'O som dentro da partida fica no menu do jogo (Esc) e nas Configurações da Riot.'));

  function pintar() {
    const cinza = cinzaDe(st.valores);
    for (const [chave, l] of linhas) {
      const pendente = st.timers.has(chave) || st.arrastando === chave; // o valor que ele escolheu ainda não saiu: não volta o controle
      const v = st.valores ? st.valores[chave] : l.op.padrao;
      l.input.disabled = !st.ok || cinza[chave];
      if (l.op.tipo === 'caixa') l.input.checked = !!v;
      else if (!pendente) { l.input.value = String(v); l.txt.textContent = textoVolume(l.op, v); }
    }
    nota.textContent = st.lendo && !st.lido ? 'lendo o som do client…' : st.ok ? 'Grava na hora, como nas Configurações da Riot.' : st.motivo;
  }

  async function ler() {
    if (st.lendo) return;
    st.lendo = true; st.velho = false;
    pintar();
    try {
      const r = lerSom(await amb.lcu('GET', ROTA_SOM));
      st.lido = true; st.ok = r.ok; st.valores = r.valores; st.motivo = r.motivo; st.versao = r.versao;
    } finally { st.lendo = false; pintar(); }
  }

  // gesto dele -> entra na fila (nunca lança: um erro não trava os gestos seguintes)
  function gravar(chave, valor) {
    if (!corposSom(chave, valor).length) return st.fila;
    const n = (st.seq.get(chave) || 0) + 1;
    st.seq.set(chave, n);
    st.gravando++;
    st.fila = st.fila.then(() => gravarAgora(chave, valor, n)).catch(() => {}).finally(() => { st.gravando--; });
    return st.fila;
  }

  async function gravarAgora(chave, valor, n) {
    for (const c of corposSom(chave, valor)) {
      const r = await amb.lcu(c.metodo, c.rota, c.corpo);
      if (!r?.ok) {
        try { amb.avisar?.(`não foi possível gravar o som (${r?.status || r?.erro || 'sem resposta'}): tente de novo`, true); } catch { /* segue */ }
        await ler(); // devolve os controles ao que o client tem
        return;
      }
    }
    // gravado: uma releitura que chegou durante a espera (outra chave falhou, ⚙ reaberta) não volta o controle para trás; um gesto
    // mais novo da mesma chave na fila é quem manda (este não pinta o valor velho por cima)
    if (st.valores && st.seq.get(chave) === n) { st.valores[chave] = valor; pintar(); }
  }

  pintar();
  return {
    el, ler, pintar,
    // a ⚙ reabriu: a próxima vez que a seção estiver à vista, lê de novo (ele pode ter mexido nas Configurações da Riot)
    velho: () => { st.velho = true; },
    precisaLer: () => st.velho && !st.lendo,
    arrastando: () => st.arrastando !== null,
    soltarSeFora,
    estado: () => ({ lido: st.lido, lendo: st.lendo, ok: st.ok, motivo: st.motivo, versao: st.versao, valores: st.valores ? { ...st.valores } : null,
      pendentes: [...st.timers.keys()], gravando: st.gravando }),
  };
}

export const CSS_SOM = `
#lc-compacto .lc-lt-subtit { margin:8px 0 2px; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--lc-ouro2); }
#lc-compacto .lc-som-rot { display:flex; gap:6px; align-items:center; color:var(--lc-ouro2); cursor:pointer; }
#lc-compacto .lc-som-rot input { margin:0; accent-color:#c8aa6e; }
#lc-compacto .lc-som-rot input:disabled + span { color:var(--lc-mudo); }
#lc-compacto .lc-som-linhavol { display:flex; flex-direction:column; gap:3px; }
#lc-compacto .lc-som-vol { width:100%; margin:0; accent-color:#c8aa6e; cursor:pointer; }
#lc-compacto .lc-som-vol:disabled { opacity:.45; cursor:default; }
#lc-compacto .lc-lt-bcorpo .lc-som-nota { margin-left:0; }
#lc-compacto .lc-som-avisos { display:flex; flex-wrap:wrap; }
#lc-compacto .lc-som-avisos > .lol-settings-general-row { flex:1 1 48%; margin:3px 0; }
`;
