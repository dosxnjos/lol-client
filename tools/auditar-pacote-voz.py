"""Auditoria do pacote de voz pré-gravada (plano voz pré-gravada, passo 6c): cada fala do `indice.json` diz o que devia?

Pedido do Gabriel (15/10/2026): um áudio "dizia outra coisa". A conferência do gerador só comparava o trecho com as frases
do MESMO lote; um corte que caiu numa frase parecida fora do lote passava. Aqui a régua do gerador (`semelhanca`,
`NOTA_MIN`, `GRUDADO`) vale contra o CATÁLOGO INTEIRO:

    suspeita = nota da própria frase < NOTA_MIN, ou outra frase do catálogo soa igual ou melhor (>= NOTA_MIN),
               ou a transcrição tem texto a mais (frases grudadas)

    python tools/auditar-pacote-voz.py --so-indice        passo 0: julga o texto já guardado na conferência (sem Whisper)
    python tools/auditar-pacote-voz.py [--lotes N]        passo 1: transcreve o .wav atual (lotes de --lote, padrão 20),
                                                          retoma de onde parou e marca as suspeitas no índice no fim
    python tools/auditar-pacote-voz.py --relatorio        esperada x ouvida do que já foi transcrito (sem Whisper)
    python tools/auditar-pacote-voz.py --refazer "frase"  marca uma fala suspeita à mão (cai na Maria até ser refeita)
    ... --seco                                            não grava nada no índice

Só com `League of Legends.exe` fechado (o processador é do jogo): confere antes de cada lote e para com rc 3 se ele
abrir (o progresso fica em temp/auditoria-voz/progresso.json e a próxima chamada retoma). O Whisper é o mesmo do gerador
(`py -3.14 tools/conferir-trechos.py`, prioridade baixa). A marcação no índice usa a trava do gerador (`.gerando`) e só
toca a fala cujo `arquivo` ainda é o transcrito (a rodada agendada pode ter trocado). Suspeita no índice: o tocador cai
na Maria e a tarefa lol-client-voz refaz no modelo-alvo (fase b do gerador, 1 tentativa por dia).
Saída: 0 ok, 3 jogo aberto, 4 índice ocupado por um gerador (rode de novo), 1 erro.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
_spec = importlib.util.spec_from_file_location("gerar_pacote_voz", RAIZ / "tools" / "gerar-pacote-voz.py")
G = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(G)
import avisos  # noqa: E402

PROGRESSO = RAIZ / "temp" / "auditoria-voz" / "progresso.json"
ESPERA_TRAVA_S = 120


# o que o Whisper (small, pt) escreve no lugar de palavras do catálogo, medido na conferência guardada de 15/10/2026
# ("no rio top" -> "no Hilltop", "mid" -> "midi"/"médio", "cinco" -> "Simco"). Só no texto ouvido, já normalizado; nenhuma
# frase do catálogo tem estas palavras (teste-pacote-voz.py confere). Sem isto o passo 0 marcava "rio top" como "top".
ALIASES_WHISPER = {"hilltop": "rio top", "reubot": "rio bot", "midi": "mid", "mide": "mid", "medio": "mid", "simco": "5"}


def ouvido(texto):
    t = G._norm(texto).replace("hill top", "hilltop")
    return " ".join(ALIASES_WHISPER.get(p, p) for p in t.split())


def julgar(frase, texto, catalogo):
    """-> (suspeita, motivo, nota, parecida, nota_parecida). Régua do gerador (julgar_lote) contra o catálogo inteiro,
    com uma diferença: empate com outra frase NÃO marca (no lote o empate recusa; no catálogo inteiro o empate quase
    sempre é a palavra que diferencia mal ouvida, e o texto não decide; a nota alta segue valendo)"""
    texto = ouvido(texto)
    nota = G.semelhanca(frase, texto)
    nf = G._norm(frase)
    outra, nota_outra = None, 0.0
    for g in catalogo:
        if g == frase or G._norm(g) == nf:      # mesma frase escrita igual: não dá para separar pelo som
            continue
        n = G.semelhanca(g, texto)
        if n > nota_outra:
            outra, nota_outra = g, n
    if nota < G.NOTA_MIN:
        return True, f"nota {nota:.2f} abaixo de {G.NOTA_MIN}", nota, outra, nota_outra
    if outra is not None and nota_outra >= G.NOTA_MIN and nota_outra > nota:
        return True, f"soa como {outra!r} ({nota_outra:.2f} contra {nota:.2f})", nota, outra, nota_outra
    if len(G._norm(texto)) > G.GRUDADO * len(nf) + 4:
        return True, "texto a mais (frases grudadas)", nota, outra, nota_outra
    return False, "", nota, outra, nota_outra


def ler_progresso(caminho=PROGRESSO):
    try:
        d = json.loads(caminho.read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except (OSError, ValueError):
        return {}


def gravar_progresso(d, caminho=PROGRESSO):
    caminho.parent.mkdir(parents=True, exist_ok=True)
    tmp = caminho.with_suffix(".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    G.substituir(tmp, caminho)


def a_transcrever(frases_idx, progresso):
    """falas com arquivo no índice que ainda não foram transcritas COM esse arquivo"""
    return [f for f, v in frases_idx.items()
            if isinstance(v, dict) and v.get("arquivo") and (progresso.get(f) or {}).get("arquivo") != v["arquivo"]]


def transcrever(pasta, frases_idx, progresso, conferir, lote=20, max_lotes=None, aberto=G.jogo_aberto,
                gravar=gravar_progresso, log=G.log):
    """transcreve em lotes; -> 'completo' | 'jogo_aberto' | 'max_lotes'. Grava o progresso a cada lote"""
    falta = [f for f in a_transcrever(frases_idx, progresso) if (pasta / frases_idx[f]["arquivo"]).is_file()]
    n = 0
    for i in range(0, len(falta), lote):
        if max_lotes is not None and n >= max_lotes:
            return "max_lotes"
        if aberto():
            log("League of Legends.exe aberto: parando (a próxima chamada retoma)")
            return "jogo_aberto"
        grupo = falta[i:i + lote]
        textos = conferir([pasta / frases_idx[f]["arquivo"] for f in grupo])
        em = time.strftime("%Y-%m-%d %H:%M")
        for f, t in zip(grupo, textos):
            progresso[f] = {"arquivo": frases_idx[f]["arquivo"], "texto": t, "em": em}
        gravar(progresso)
        n += 1
        log(f"lote {n}: {len(grupo)} fala(s) transcrita(s); faltam {len(falta) - i - len(grupo)}")
    return "completo"


def avaliar(progresso, frases_idx, catalogo):
    """[{frase, arquivo, modelo, texto, nota, suspeita, motivo, parecida}] do que foi transcrito com o arquivo atual"""
    out = []
    for f, p in progresso.items():
        v = frases_idx.get(f)
        if not isinstance(v, dict) or v.get("arquivo") != p.get("arquivo"):
            continue
        s, motivo, nota, outra, nota_outra = julgar(f, p.get("texto") or "", catalogo)
        out.append({"frase": f, "arquivo": p["arquivo"], "modelo": v.get("modelo"), "texto": p.get("texto") or "",
                    "nota": round(nota, 2), "suspeita": s, "motivo": motivo, "parecida": outra,
                    "nota_parecida": round(nota_outra, 2), "em": p.get("em")})
    return sorted(out, key=lambda r: (not r["suspeita"], r["nota"]))


def marcar(pasta, avaliacao, seco=False, trava=G.travar, espera_s=ESPERA_TRAVA_S, log=G.log):
    """grava `auditoria` em cada fala avaliada e `suspeita` nas que não bateram, com a trava do gerador e só onde o
    `arquivo` ainda é o transcrito. -> (novas_suspeitas, gravadas) ou None (índice ocupado)"""
    if seco:
        return [r["frase"] for r in avaliacao if r["suspeita"]], 0
    t0, f = time.monotonic(), trava(pasta)
    while f is None and time.monotonic() - t0 < espera_s:
        time.sleep(5)
        f = trava(pasta)
    if f is None:
        return None
    try:
        indice = G.ler_indice(pasta)            # relido com a trava
        fs = indice.get("frases") or {}
        novas, n = [], 0
        for r in avaliacao:
            v = fs.get(r["frase"])
            if not isinstance(v, dict) or v.get("arquivo") != r["arquivo"]:
                continue
            v["auditoria"] = {"texto": r["texto"], "nota": r["nota"], "em": r["em"],
                              **({"parecida": r["parecida"], "motivo": r["motivo"]} if r["suspeita"] else {})}
            n += 1
            if r["suspeita"] and not v.get("suspeita"):
                v["suspeita"] = True
                novas.append(r["frase"])
                log(f"suspeita: {r['frase']!r} ouvida como {r['texto']!r} ({r['motivo']}); toca na Maria até ser refeita")
        if n:
            G.gravar_indice(pasta, indice)
        return novas, n
    finally:
        f.close()


def refazer_a_mao(pasta, frase, seco=False, trava=G.travar, log=G.log):
    """marca uma fala `suspeita` (motivo: pedido do Gabriel). -> True se marcou"""
    f = trava(pasta)
    if f is None:
        log("índice ocupado por um gerador: tente de novo em alguns minutos")
        return False
    try:
        indice = G.ler_indice(pasta)
        v = (indice.get("frases") or {}).get(frase)
        if not isinstance(v, dict):
            log(f"{frase!r} não está no pacote")
            return False
        if seco:
            return True
        v["suspeita"] = True
        v["auditoria"] = {**(v.get("auditoria") or {}), "motivo": "refazer pedido à mão", "em": time.strftime("%Y-%m-%d %H:%M")}
        G.gravar_indice(pasta, indice)
        log(f"{frase!r} marcada suspeita ({v.get('arquivo')}, {v.get('modelo')}): Maria até a rodada no alvo refazer")
        return True
    finally:
        f.close()


def imprimir(avaliacao, titulo):
    sus = [r for r in avaliacao if r["suspeita"]]
    print(f"{titulo}: {len(avaliacao)} conferida(s), {len(sus)} suspeita(s)")
    for r in sus:
        print(f"  SUSPEITA  esperada {r['frase']!r}  ouvida {r['texto']!r}  ({r['motivo']}; {r['arquivo']}, {r['modelo']})")
    return sus


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="audita o pacote de voz com o Whisper (plano voz, passo 6c)")
    ap.add_argument("--voz", default="aoede")
    ap.add_argument("--lote", type=int, default=20)
    ap.add_argument("--lotes", type=int, default=None, help="no máximo N lotes nesta chamada (retoma depois)")
    ap.add_argument("--so-indice", action="store_true", help="passo 0: julga o texto da conferência já guardada")
    ap.add_argument("--relatorio", action="store_true", help="esperada x ouvida do que já foi transcrito")
    ap.add_argument("--refazer", help="marca esta fala suspeita à mão")
    ap.add_argument("--frase", action="append", default=[], help="mostra a linha desta fala no relatório")
    ap.add_argument("--json", help="grava a avaliação completa neste arquivo")
    ap.add_argument("--seco", action="store_true", help="não grava nada no índice")
    a = ap.parse_args()
    pasta = G.PACOTES / a.voz
    indice = G.ler_indice(pasta)
    fs = {f: v for f, v in (indice.get("frases") or {}).items() if isinstance(v, dict)}
    if not fs:
        G.log(f"sem pacote em {pasta}")
        return 1
    catalogo = sorted(set(avisos.catalogo(avisos.carregar_textos()[0])) | set(fs))
    if a.refazer:
        return 0 if refazer_a_mao(pasta, a.refazer, a.seco) else 1
    if a.so_indice:
        prog = {f: {"arquivo": v["arquivo"], "texto": (v.get("conferencia") or {}).get("texto") or "", "em": v.get("em")}
                for f, v in fs.items() if (v.get("conferencia") or {}).get("texto")}
        av = avaliar(prog, fs, catalogo)
        imprimir(av, "passo 0 (texto guardado na conferência do gerador, contra o catálogo inteiro)")
    else:
        progresso = ler_progresso()
        if not a.relatorio:
            if G.jogo_aberto():
                G.log("League of Legends.exe aberto: a auditoria só roda com o jogo fechado")
                return 3
            conferir = G.ConferidorSobDemanda()
            try:
                st = transcrever(pasta, fs, progresso, conferir, lote=max(1, a.lote), max_lotes=a.lotes)
            except G.ConferenciaFalhou as e:
                G.log(f"conferência falhou: {e}")
                return 1
            finally:
                conferir.fechar()
            G.log(f"transcrição: {st}; {len(fs) - len(a_transcrever(fs, progresso))} de {len(fs)} falas transcritas")
            av = avaliar(progresso, fs, catalogo)
            r = marcar(pasta, av, a.seco)
            if r is None:
                G.log("índice ocupado por um gerador há mais de 2 min: nada marcado (rode de novo; o progresso ficou)")
                imprimir(av, "auditoria")
                return 4
            G.log(f"índice: {r[1]} fala(s) com auditoria gravada, {len(r[0])} suspeita(s) nova(s)" + (" (seco)" if a.seco else ""))
            if st == "jogo_aberto":
                imprimir(av, "auditoria parcial")
                return 3
        av = avaliar(progresso, fs, catalogo)
        imprimir(av, "auditoria (Whisper sobre o .wav atual, contra o catálogo inteiro)")
    for f in a.frase:
        r = next((x for x in av if x["frase"] == f), None)
        print(f"  {f!r}: " + (f"ouvida {r['texto']!r}, nota {r['nota']}, mais parecida {r['parecida']!r} "
                               f"({r['nota_parecida']}), {'SUSPEITA' if r['suspeita'] else 'bate'}; {r['arquivo']}, {r['modelo']}"
                               if r else "ainda não conferida"))
    if a.json:
        Path(a.json).parent.mkdir(parents=True, exist_ok=True)
        Path(a.json).write_text(json.dumps(av, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
