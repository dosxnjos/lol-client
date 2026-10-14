"""prova do gerador do pacote de voz (plano voz pré-gravada, passo 6) sem a API do Gemini (a cota grátis é
pequena): um sintetizador falso devolve "fala" sintética (tom de 220 Hz com a duração esperada da frase) e
pausas entre as frases do lote, e o tools/gerar-pacote-voz.py de verdade corta, normaliza e grava o índice.
Casos: corte pelo silêncio; lote com pausa faltando recusado e dividido ao meio; frase sozinha absurda fica
fora (falhas); retomável; cota diária para limpo e retoma; jogo aberto para limpo; conferência ruim refaz a
frase sozinha e marca suspeita; corte deslocado (soa como a vizinha) recusa o lote; conferência morta para
sem gravar; suspeita fica fora do tocador e da fila; lotes em rodízio de moldes; o pacote gerado toca no
voz.Voz; --seco conta o catálogo.
uso: python tools/teste-pacote-voz.py
"""
import importlib.util
import json
import math
import struct
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
spec = importlib.util.spec_from_file_location("gerar_pacote_voz", RAIZ / "tools" / "gerar-pacote-voz.py")
G = importlib.util.module_from_spec(spec)
spec.loader.exec_module(G)
import avisos  # noqa: E402
from voz import Pacote, Voz  # noqa: E402

resultados = []
TAXA = 24000


def caso(nome, ok, detalhe=""):
    resultados.append(ok)
    print(f"{'ok' if ok else 'FALHOU'}  {nome}" + (f"  ({detalhe})" if detalhe else ""))


def escrever(destino, partes):
    """partes = [(segundos, tem_som)] -> wav mono 16 bits"""
    amostras = []
    for seg, som in partes:
        n = int(seg * TAXA)
        if som:
            amostras += [int(9000 * math.sin(2 * math.pi * 220 * i / TAXA)) for i in range(n)]
        else:
            amostras += [0] * n
    with wave.open(str(destino), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(TAXA)
        w.writeframes(struct.pack(f"<{len(amostras)}h", *amostras))


class Falso:
    """sintetizador falso: frase = tom com a duração esperada (vírgula = pausa curta de 0,3 s no meio);
    pausa de 0,8 s entre frases. juntar_acima: lote maior que isto vem com as 2 primeiras frases coladas
    (pausa de 0,1 s); absurda: frase que vem 5× mais longa; cota_em: pedido em que a cota acaba."""

    def __init__(self, juntar_acima=99, absurda=None, cota_em=None, pausa_virgula=0.3, lixo_fim=False):
        self.juntar_acima, self.absurda, self.cota_em = juntar_acima, absurda, cota_em
        self.pausa_virgula, self.lixo_fim = pausa_virgula, lixo_fim
        self.pedidos = []
        self.layout = {}     # stem do bruto -> texto de cada pedaço de som (o que o "Whisper" ouve)

    def __call__(self, frases, destino):
        if self.cota_em is not None and len(self.pedidos) >= self.cota_em:
            raise G.CotaEsgotada("cota diária esgotada (falso)")
        self.pedidos.append(list(frases))
        partes, textos = [(0.25, False)], []
        for i, f in enumerate(frases):
            d = G.esperado(f) * (5 if f == self.absurda else 1)
            colado = i > 0 and partes[-1] == (0.1, False)
            if "," in f:
                a, b = f.split(",", 1)
                partes += [(d * 0.45, True), (self.pausa_virgula, False), (d * 0.45, True)]
                novos = [a, b.strip()]
            else:
                partes.append((d, True))
                novos = [f]
            if colado:                        # 0,1 s não é silêncio: o pedaço anterior continua
                textos[-1] += " " + novos.pop(0)
            textos += novos
            if i < len(frases) - 1:
                partes.append((0.1 if (i == 0 and len(frases) > self.juntar_acima) else 0.8, False))
        if self.lixo_fim:                     # o Gemini real põe um "E aí" solto no fim do lote
            partes += [(0.8, False), (0.4, True)]
            textos.append("E aí")
        partes.append((0.3, False))
        escrever(destino, partes)
        self.layout[Path(destino).stem] = textos
        return "falso-tts"

    def ouvir(self, ouvido=None):
        """transcritor falso dos pedaços (<stem>-pNN.wav): o texto do layout, trocado por ouvido[texto]"""
        def transcrever(caminhos):
            out = []
            for c in caminhos:
                stem, _, n = Path(c).stem.rpartition("-p")
                t = self.layout[stem][int(n)]
                out.append((ouvido or {}).get(t, t))
            return out
        return transcrever


def main():
    cat = avisos.catalogo(avisos.TEXTOS)
    frases = ["gank provável no top", "o mid saiu da rota: no rio top", "olha o gank no mid, sai daí",
              "flash do jungler voltou", "ouro guardado, hora de voltar?", "mid sumiu"]
    assert all(f in cat for f in frases)
    p = G.prompt_do_lote(frases[:3])
    caso("prompt: uma frase por parágrafo, sem número nem instrução; dois-pontos e '?' do meio viram vírgula",
         p == "gank provável no top.\n\no mid saiu da rota, no rio top.\n\nolha o gank no mid, sai daí."
         and not any(c.isdigit() for c in p)
         and G.texto_falado("cadê o mid? sumiu") == "cadê o mid, sumiu."
         and G.texto_falado("ouro guardado, hora de voltar?") == "ouro guardado, hora de voltar?", repr(p))
    # revisão 13/10: lotes com moldes diferentes (rodízio), o tom em uso primeiro
    ordem = G.ordem_de_geracao(avisos.TEXTOS, avisos.TONS)
    molde_de = {f: m for m, fs in avisos.catalogo(avisos.TEXTOS, tons=(G.tom_em_uso(),), por_molde=True).items()
                for f in fs}
    primeiro = ordem[:8]
    caso("ordem: o 1º lote de 8 tem 8 moldes diferentes, todos do tom em uso; ordem = catálogo inteiro",
         len({molde_de.get(f) for f in primeiro}) == 8 and all(f in molde_de for f in primeiro)
         and sorted(ordem) == avisos.catalogo(avisos.TEXTOS), str(primeiro))
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        brutos = d / "brutos"
        # 1. corte pelo silêncio
        f = Falso()
        f(frases[:4], d / "lote.wav")
        dur, sil = G.silencios(d / "lote.wav")
        trechos, motivo = G.segmentar(dur, sil, frases[:4])
        caso("corte: 4 frases (uma com vírgula) -> 4 trechos com a duração esperada",
             trechos is not None and len(trechos) == 4
             and all(abs((b - a) - G.esperado(x)) < 0.25 for x, (a, b) in zip(frases[:4], trechos)),
             f"{motivo or [round(b - a, 2) for a, b in trechos]} vs {[round(G.esperado(x), 2) for x in frases[:4]]}")
        tr2, mot2 = G.segmentar(dur, sil, frases[:5])
        caso("corte: 5 frases para 4 trechos -> recusa", tr2 is None, mot2)

        # 2. lote com pausa faltando: recusado, dividido ao meio, tudo gravado; índice e wav no formato
        pasta = d / "pacotes" / "teste"
        falso = Falso(juntar_acima=2)
        meta = {"voz": "teste", "versao_catalogo": avisos.versao_catalogo(cat)}
        r = G.gerar(frases[:4], pasta, falso, lote=4, aberto=lambda: False, meta=meta, brutos=brutos)
        ind = json.loads((pasta / "indice.json").read_text(encoding="utf-8"))
        arqs = [pasta / ind["frases"][x]["arquivo"] for x in frases[:4]]
        with wave.open(str(arqs[0]), "rb") as w:
            formato = (w.getnchannels(), w.getsampwidth(), w.getframerate())
        caso("lote ruim: recusado, dividido ao meio (4 -> 2 + 2), as 4 gravadas",
             r["status"] == "completo" and r["recusados"] == 1 and [len(x) for x in falso.pedidos] == [4, 2, 2]
             and r["geradas"] == 4 and all(a.is_file() for a in arqs) and formato == (1, 2, 24000)
             and ind["versao_catalogo"] == meta["versao_catalogo"] and ind["frases"][frases[0]]["lote"] == 2,
             f"{r}, pedidos {[len(x) for x in falso.pedidos]}, formato {formato}")
        caso("loudnorm: trecho normalizado com duração perto da esperada (+ respiro)",
             all(abs(ind["frases"][x]["dur"] - G.esperado(x) - 2 * G.PAD_S) < 0.3 for x in frases[:4]),
             str([(ind["frases"][x]["dur"], round(G.esperado(x), 2)) for x in frases[:4]]))

        # 3. retomável + frase sozinha absurda fica fora (falhas) + cota para limpo
        falso2 = Falso(absurda=frases[5])
        r2 = G.gerar(frases, pasta, falso2, lote=4, aberto=lambda: False, brutos=brutos)
        ind = json.loads((pasta / "indice.json").read_text(encoding="utf-8"))
        caso("retomável: só as 2 que faltam são pedidas; a absurda vira falha (Maria ao vivo)",
             falso2.pedidos[0] == frases[4:] and r2["geradas"] == 1 and r2["faltam"] == 1 and r2["status"] == "falhas"
             and frases[5] in ind["falhas"] and frases[4] in ind["frases"],
             f"{r2}, pedidos {falso2.pedidos}")
        pasta2 = d / "pacotes" / "cota"
        falso3 = Falso(cota_em=1)
        r3 = G.gerar(frases, pasta2, falso3, lote=2, aberto=lambda: False, brutos=brutos)
        falso4 = Falso()
        r4 = G.gerar(frases, pasta2, falso4, lote=2, aberto=lambda: False, brutos=brutos)
        caso("cota diária: para limpo dizendo quantas faltam; a próxima rodada retoma",
             r3["status"] == "cota" and r3["geradas"] == 2 and r3["faltam"] == 4
             and falso4.pedidos == [frases[2:4], frases[4:6]] and r4["status"] == "completo",
             f"{r3} / {r4}")
        r5 = G.gerar(frases, d / "pacotes" / "jogo", Falso(), lote=2, aberto=lambda: True, brutos=brutos)
        caso("jogo aberto: para antes de pedir", r5["status"] == "jogo_aberto" and r5["pedidos"] == 0, str(r5))

        # 4. conferência: trecho ouvido errado no lote é refeito sozinho; continua errado -> suspeita
        pasta3 = d / "pacotes" / "conf"
        falso5 = Falso()
        conferir = falso5.ouvir({frases[1]: "o banco caiu na rua"})
        r6 = G.gerar(frases[:2], pasta3, falso5, lote=2, conferir=conferir, aberto=lambda: False, brutos=brutos)
        ind3 = json.loads((pasta3 / "indice.json").read_text(encoding="utf-8"))
        caso("conferência: ouvido errado refaz sozinha 1 vez e fica marcada suspeita",
             falso5.pedidos == [frases[:2], [frases[1]]] and ind3["frases"][frases[1]].get("suspeita")
             and not ind3["frases"][frases[0]].get("suspeita") and ind3["frases"][frases[0]]["conferencia"]["nota"] == 1.0
             and r6["suspeitas"] == 1, f"{falso5.pedidos} {r6}")
        # revisão 13/10: corte deslocado (o trecho de uma frase soa como a vizinha do lote) recusa o lote inteiro
        vizinhas = ["gank provável no top", "gank provável no mid"]
        troca = {vizinhas[0]: vizinhas[1], vizinhas[1]: vizinhas[0]}
        pasta4 = d / "pacotes" / "desloc"
        falso6 = Falso()
        normal, trocado = falso6.ouvir(), falso6.ouvir(troca)

        def conferir_trocado(caminhos):   # lote de 2 ouvido trocado; sozinhas, certo
            return trocado(caminhos) if len(falso6.pedidos) == 1 else normal(caminhos)
        r7 = G.gerar(vizinhas, pasta4, falso6, lote=2, conferir=conferir_trocado, aberto=lambda: False, brutos=brutos)
        ind4 = json.loads((pasta4 / "indice.json").read_text(encoding="utf-8"))
        caso("conferência: trecho que soa como a vizinha recusa o lote inteiro e divide; nada sobra de temporário",
             falso6.pedidos == [vizinhas, [vizinhas[0]], [vizinhas[1]]] and r7["recusados"] == 1
             and r7["status"] == "completo" and set(ind4["frases"]) == set(vizinhas)
             and not list(pasta4.glob("_*")), f"{falso6.pedidos} {r7}")
        caso("conferência: duas frases grudadas num trecho -> deslocado",
             G.julgar_lote(["mid sumiu", "gank provável no top"], ["mid sumiu gank provável no top", "gank"])[0]
             is not None)
        # o caso real de 13/10: pausa de vírgula do tamanho da pausa entre frases + "E aí" solto no fim. O corte
        # só pelo silêncio recusa; o guiado pela transcrição acerta e larga o pedaço solto
        lote4 = [frases[4], frases[0], frases[2], frases[5]]   # duas com vírgula
        falso7 = Falso(pausa_virgula=0.8, lixo_fim=True)
        pasta6 = d / "pacotes" / "virgula"
        r10 = G.gerar(lote4, pasta6, falso7, lote=4, conferir=falso7.ouvir(), aberto=lambda: False, brutos=brutos)
        ind6 = json.loads((pasta6 / "indice.json").read_text(encoding="utf-8"))
        bruto7 = brutos / "virgula.wav"
        falso7(lote4, bruto7)
        so_silencio = G.segmentar(*G.silencios(bruto7), lote4)[0]
        caso("corte pela transcrição: vírgula com pausa de 0,8 s e 'E aí' no fim -> 1 pedido, 4 certas",
             r10["status"] == "completo" and r10["pedidos"] == 1 and r10["recusados"] == 0 and so_silencio is None
             and [ind6["frases"][f]["conferencia"]["texto"] for f in lote4] == [
                 "ouro guardado hora de voltar?", "gank provável no top", "olha o gank no mid sai daí", "mid sumiu"]
             and all(abs(ind6["frases"][f]["dur"] - (G.esperado(f) * 0.9 + 0.8 if "," in f else G.esperado(f))
                         - 2 * G.PAD_S) < 0.2 for f in lote4),
             f"{r10} {[(ind6['frases'][f]['dur'], round(G.esperado(f), 2)) for f in lote4]}")
        caso("alinhar: pedaços contíguos por frase, solto no começo/fim largado",
             G.alinhar(["a b c", "d e"], ["xx", "a b", "c", "d e", "E aí"]) == [(1, 3), (3, 4)]
             and G.alinhar(["a b c", "d e"], ["a b c"]) is None)
        # conferência que morre/responde curto: para, nada do lote entra
        pasta5 = d / "pacotes" / "morto"
        r8 = G.gerar(frases[:2], pasta5, Falso(), lote=2, conferir=lambda cs: [], aberto=lambda: False, brutos=brutos)
        ind5 = G.ler_indice(pasta5)
        r9 = G.gerar(frases[:2], d / "pacotes" / "erro", Falso(), lote=2, aberto=lambda: False, brutos=brutos,
                     conferir=lambda cs: ["gank provável no top", "<erro RuntimeError>"])
        caso("conferência: resposta curta ou <erro> para a rodada sem gravar o lote",
             r8["status"] == "conferidor" and r8["geradas"] == 0 and not ind5.get("frases") and not list(pasta5.glob("*.wav"))
             and r9["status"] == "conferidor" and r9["faltam"] == 2, f"{r8} / {r9}")
        # suspeita não volta à fila sozinha (gastaria cota toda rodada); --refazer-suspeitas pede de novo
        caso("suspeita: fora de pendentes por padrão, dentro com refazer_suspeitas; Pacote não toca",
             G.pendentes(frases[:2], pasta3, ind3) == [] and G.pendentes(frases[:2], pasta3, ind3, True) == [frases[1]]
             and G.suspeitas(frases[:2], ind3) == [frases[1]] and r6["suspeitas_total"] == 1
             and Pacote(pasta3).arquivo(frases[1]) is None and Pacote(pasta3).arquivo(frases[0]) is not None)
        caso("semelhança: número por extenso e acento não contam",
             G.semelhanca("2 inimigos mortos: dragão", "Dois inimigos mortos. Dragão!") == 1.0
             and G.semelhanca("dragão em um minuto", "Dragão em 1 minuto.") == 1.0
             and G.semelhanca("gank provável no rio top", "Gang provável no Rio Top.") > 0.9)

        # 5. o pacote gerado toca no voz.Voz (tocador falso: sem som)
        tocados = []
        v = Voz(saida=lambda t: None, pacote=Pacote(pasta), tocar=lambda a, c: tocados.append(a.name), faltou=d / "f.jsonl")
        v.falar(frases[0])
        v.esperar(5)
        v.parar()
        caso("o pacote gerado toca no voz.Voz", tocados == [G.nome_arquivo(frases[0])], str(tocados))

    # 6. --seco: conta o catálogo, sem chave nem rede
    r = subprocess.run([sys.executable, str(RAIZ / "tools" / "gerar-pacote-voz.py"), "--voz", "aoede", "--seco"],
                       capture_output=True, text=True, encoding="utf-8", errors="replace",
                       env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"})
    n = len(avisos.catalogo())
    caso("--seco: conta o catálogo inteiro", r.returncode == 0 and f"{n} falas" in r.stdout, r.stdout.strip()[:200])
    k = sum(resultados)
    print(f"\n{'ok' if k == len(resultados) else 'FALHOU'} ({k}/{len(resultados)})")
    return 0 if k == len(resultados) else 1


if __name__ == "__main__":
    sys.exit(main())
