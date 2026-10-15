"""prova do gerador do pacote de voz (plano voz pré-gravada, passo 6) sem a API do Gemini (a cota grátis é
pequena): um sintetizador falso devolve "fala" sintética (tom de 220 Hz com a duração esperada da frase) e
pausas entre as frases do lote, e o tools/gerar-pacote-voz.py de verdade corta, normaliza e grava o índice.
Casos: corte pelo silêncio; lote com pausa faltando recusado e dividido ao meio; frase sozinha absurda fica
fora (falhas); retomável; cota diária para limpo e retoma; jogo aberto para limpo; conferência ruim refaz a
frase sozinha e marca suspeita; corte deslocado (soa como a vizinha) recusa o lote; conferência morta para
sem gravar; suspeita fica fora do tocador e da fila; lotes em rodízio de moldes; o pacote gerado toca no
voz.Voz; --seco conta o catálogo. Passo 6b (agendamento e convergência): faltam primeiro e convergência só no
alvo; cota do alvo morta na fase (a) não pede mais nada; substituição atômica (recusada mantém a antiga, arquivo
novo por versão); presas e suspeitas fora; alvo fixo no índice; queda de rede tenta de novo e para limpo; o
tocador relê o índice trocado; o agendador recusa com o jogo aberto ou fora do lobby, desativa a tarefa ao
concluir, pede parada quando o client entra em fila e não deixa chave no log (sem tarefa real, rede, cota nem som).
Revisão do 6b: alvo inválido fora do índice, jogo aberto mata na hora, espera da API para, índice ocupado tenta de
novo, 1 tentativa por dia (recusa e falha), alvo novo zera recusas, órfãos com o índice da hora, Whisper sob demanda.
Passo 6c (15/10/2026): suspeita entra na convergência primeiro (qualquer modelo) e impede concluir até refeita ou presa;
auditoria (tools/auditar-pacote-voz.py): régua contra o catálogo inteiro, aliases do Whisper, para com o jogo aberto e
retoma, marca com a trava e só onde o arquivo não mudou, --refazer à mão.
uso: python tools/teste-pacote-voz.py
"""
import importlib.util
import json
import math
import os
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


class FalsoFila(Falso):
    """sintetizador falso com fila de modelos e cota diária por modelo (pedidos), como o Gemini: o primeiro da
    fila até a cota dele acabar, depois o próximo; priorizar/so são os do Gemini de verdade"""

    def __init__(self, cotas, **kw):
        super().__init__(**kw)
        self.fila, self.cotas = list(cotas), dict(cotas)
        self.modelo, self.esgotados, self.por_modelo = self.fila[0], [], []

    priorizar = G.Gemini.priorizar
    so = G.Gemini.so

    def __call__(self, frases, destino):
        while self.cotas[self.modelo] <= 0:
            self.esgotados.append(self.modelo)
            if self.modelo in self.fila[:-1]:
                self.modelo = self.fila[self.fila.index(self.modelo) + 1]
            else:
                raise G.CotaEsgotada(f"cota diária esgotada em {self.esgotados}")
        self.cotas[self.modelo] -= 1
        super().__call__(frases, destino)
        self.por_modelo.append((self.modelo, list(frases)))
        return self.modelo


def casos_convergencia(d, frases):
    """passo 6b: faltam primeiro (fila inteira, alvo na frente), depois a convergência só no alvo; troca atômica"""
    brutos = d / "brutos"
    seis = frases[:6]

    # (1) pacote velho com 4 falas de outro modelo; rodada: as 2 que faltam primeiro (no alvo), depois converge
    # só no alvo até a cota dele acabar; o "outro" (com cota sobrando) nunca é usado na convergência
    pasta = d / "ordem"
    G.gerar(seis[:4], pasta, Falso(), lote=2, aberto=lambda: False, brutos=brutos)        # modelo "falso-tts"
    velhos = {f: v["arquivo"] for f, v in G.ler_indice(pasta)["frases"].items()}
    tts = FalsoFila({"alvo": 2, "outro": 9})
    out = G.rodada(seis, pasta, tts, "alvo", lote=2, aberto=lambda: False, brutos=brutos, conferir=tts.ouvir())
    ind = G.ler_indice(pasta)
    fs = ind["frases"]
    caso("rodada: faltam primeiro, depois convergência só no alvo; cota do alvo acabou = para (o outro tinha cota)",
         tts.por_modelo == [("alvo", seis[4:6]), ("alvo", seis[:2])] and out["status"] == "cota"
         and out["a"]["geradas"] == 2 and out["b"]["geradas"] == 2 and out["b"]["fora_do_alvo"] == 2
         and [fs[f]["modelo"] for f in seis] == ["alvo", "alvo", "falso-tts", "falso-tts", "alvo", "alvo"],
         f"{tts.por_modelo} {out['status']}")
    caso("convergência: arquivo novo por versão, o antigo some do disco depois do índice; as não refeitas intactas",
         all(fs[f]["arquivo"] != velhos[f] and fs[f]["arquivo"].endswith("-2.wav") and (pasta / fs[f]["arquivo"]).is_file()
             and not (pasta / velhos[f]).exists() for f in seis[:2])
         and all(fs[f]["arquivo"] == velhos[f] and (pasta / velhos[f]).is_file() for f in seis[2:4])
         and not list(pasta.glob("_*")), str({f: fs[f]["arquivo"] for f in seis}))

    # (2) cota do alvo morre na fase (a): a fila segue no outro e a convergência nem começa (nenhum pedido a mais)
    pasta2 = d / "sem-cota"
    tts2 = FalsoFila({"alvo": 1, "outro": 9})
    out2 = G.rodada(seis, pasta2, tts2, "alvo", lote=2, aberto=lambda: False, brutos=brutos, conferir=tts2.ouvir())
    caso("rodada: cota do alvo acaba nas que faltam -> segue no outro; convergência fica para amanhã sem pedir",
         [m for m, _ in tts2.por_modelo] == ["alvo", "outro", "outro"] and out2["a"]["faltam"] == 0
         and out2["b"] is None and out2["status"] == "cota" and "já acabou" in (out2["motivo_b"] or ""),
         f"{tts2.por_modelo} {out2['status']} {out2['motivo_b']}")

    # (3) substituição atômica: a gravação nova ouvida errado (mesmo sozinha) é recusada e a antiga fica
    pasta3 = d / "atomica"
    G.gerar(seis[:2], pasta3, Falso(), lote=2, aberto=lambda: False, brutos=brutos)
    antes = json.loads((pasta3 / "indice.json").read_text(encoding="utf-8"))["frases"]
    tts3 = FalsoFila({"alvo": 9})
    out3 = G.rodada(seis[:2], pasta3, tts3, "alvo", lote=2, aberto=lambda: False, brutos=brutos,
                    conferir=tts3.ouvir({seis[1]: "o banco caiu na rua"}))
    fs3 = G.ler_indice(pasta3)["frases"]
    caso("convergência recusada (ouvida errado 2 vezes): a antiga fica no índice e no disco, sem suspeita, +1 tentativa",
         [len(x) for _, x in tts3.por_modelo] == [2, 1] and out3["b"]["mantidas"] == 1
         and fs3[seis[1]]["arquivo"] == antes[seis[1]]["arquivo"] and fs3[seis[1]]["modelo"] == "falso-tts"
         and fs3[seis[1]].get("tentativas_alvo") == 1 and not fs3[seis[1]].get("suspeita")
         and (pasta3 / antes[seis[1]]["arquivo"]).is_file() and fs3[seis[0]]["modelo"] == "alvo"
         and not list(pasta3.glob("_*")) and sorted(p.name for p in pasta3.glob("*.wav")) == sorted(
             [fs3[seis[0]]["arquivo"], fs3[seis[1]]["arquivo"]]), f"{tts3.por_modelo} {fs3[seis[1]]}")
    # duração absurda na convergência também mantém a antiga (nunca vira `falhas`, que tiraria a fala do pacote)
    tts4 = FalsoFila({"alvo": 9}, absurda=seis[1])
    out4 = G.rodada(seis[:2], pasta3, tts4, "alvo", lote=1, aberto=lambda: False, brutos=brutos, conferir=tts4.ouvir(),
                    hoje="2099-01-01")     # outro dia: a recusa de hoje só volta amanhã
    ind4 = G.ler_indice(pasta3)
    caso("convergência recusada (duração absurda): antiga fica, sem entrar em falhas",
         out4["b"]["mantidas"] == 1 and seis[1] not in ind4.get("falhas", {})
         and ind4["frases"][seis[1]]["arquivo"] == antes[seis[1]]["arquivo"]
         and ind4["frases"][seis[1]]["tentativas_alvo"] == 2, f"{out4['b']} {ind4['frases'][seis[1]]}")
    # 3 recusas: presa (sai da convergência); o progresso conclui sem ela e sem as suspeitas
    ind4["frases"][seis[1]]["tentativas_alvo"] = G.MAX_TENTATIVAS_ALVO
    prog = G.progresso(seis[:2], pasta3, ind4, "alvo")
    caso("presa (3 recusas no alvo) sai da convergência; progresso conclui",
         G.para_convergir(seis[:2], pasta3, ind4, "alvo") == [] and prog["presas"] == 1 and prog["no_alvo"] == 1
         and prog["concluido"] and prog["faltam"] == 0, str(prog))
    # passo 6c (15/10/2026): suspeita entra na convergência, de qualquer modelo (inclusive o alvo), PRIMEIRO na fila, e
    # impede concluir até ser refeita ou ficar presa (antes: ficava fora e a tarefa desligava com ela na Maria)
    velha = G.ler_indice(pasta)["frases"][seis[2]]           # ainda "falso-tts", arquivo no disco
    ind_s = {"frases": {seis[2]: {**velha, "suspeita": True}}}
    prog_s = G.progresso([seis[2]], pasta, ind_s, "alvo")
    no_alvo_s = {"frases": {seis[0]: {**fs[seis[0]], "suspeita": True}, seis[2]: velha, seis[3]: {**fs[seis[3]], "suspeita": True}}}
    presa_s = {"frases": {seis[2]: {**velha, "suspeita": True, "tentativas_alvo": G.MAX_TENTATIVAS_ALVO, "alvo_tentado": "alvo"}}}
    prog_p = G.progresso([seis[2]], pasta, presa_s, "alvo")
    caso("6c: suspeita (de outro modelo ou do alvo) entra na convergência antes das outras e não deixa concluir; presa sai",
         velha["modelo"] == "falso-tts" and G.para_convergir([seis[2]], pasta, ind_s, "alvo") == [seis[2]]
         and G.para_convergir([seis[0], seis[2], seis[3]], pasta, no_alvo_s, "alvo") == [seis[0], seis[3], seis[2]]
         and prog_s["suspeitas"] == 1 and prog_s["no_alvo"] == 0 and not prog_s["concluido"] and prog_s["fora_do_alvo"] == 1
         and G.para_convergir([seis[2]], pasta, presa_s, "alvo") == [] and prog_p["presas"] == 1 and prog_p["concluido"],
         f"{prog_s} {prog_p}")
    # 15/10/2026: depois das suspeitas, o modelo que destoa (MODELOS_PRIMEIRO) passa à frente dos outros fora do alvo
    destoa = {"frases": {seis[0]: {**fs[seis[0]], "modelo": "outro-tts"}, seis[2]: velha,
                         seis[3]: {**fs[seis[3]], "modelo": G.MODELOS_PRIMEIRO[0]}}}
    caso("ordem: suspeita, depois o modelo que destoa (3.1 preview), depois os outros fora do alvo",
         G.para_convergir([seis[0], seis[2], seis[3]], pasta, destoa, "alvo") == [seis[3], seis[0], seis[2]]
         and G.para_convergir([seis[0], seis[2], seis[3]], pasta, no_alvo_s, "alvo") == [seis[0], seis[3], seis[2]],
         G.para_convergir([seis[0], seis[2], seis[3]], pasta, destoa, "alvo"))

    # 6c ponta a ponta: pacote completo com 2 suspeitas (uma já no alvo) e 1 boa fora do alvo; a rodada (sem nada faltando)
    # refaz as suspeitas primeiro, só no alvo. Ouvida certo = sai da Maria; ouvida errado = fica suspeita, +1 tentativa
    pasta_s = d / "suspeitas"
    G.gerar(seis[:3], pasta_s, Falso(), lote=3, aberto=lambda: False, brutos=brutos)
    ind_x = G.ler_indice(pasta_s)
    ind_x["frases"][seis[0]].update(modelo="alvo", suspeita=True)
    ind_x["frases"][seis[1]]["suspeita"] = True
    G.gravar_indice(pasta_s, ind_x)
    tts_s = FalsoFila({"alvo": 9, "outro": 9})
    out_s = G.rodada(seis[:3], pasta_s, tts_s, "alvo", lote=2, aberto=lambda: False, brutos=brutos,
                     conferir=tts_s.ouvir({seis[1]: "o banco caiu na rua"}))
    fx = G.ler_indice(pasta_s)["frases"]
    caso("6c: rodada refaz as suspeitas primeiro, só no alvo; certa sai da Maria, errada fica suspeita com +1 tentativa",
         out_s["a"]["pedidos"] == 0 and tts_s.por_modelo[0] == ("alvo", [seis[0], seis[1]])
         and all(m == "alvo" for m, _ in tts_s.por_modelo)
         and not fx[seis[0]].get("suspeita") and fx[seis[0]]["modelo"] == "alvo"
         and fx[seis[1]].get("suspeita") and fx[seis[1]].get("tentativas_alvo") == 1
         and fx[seis[2]]["modelo"] == "alvo" and not fx[seis[2]].get("suspeita"),
         f"{tts_s.por_modelo} {out_s['status']} {[(f, fx[f].get('modelo'), fx[f].get('suspeita')) for f in seis[:3]]}")

    # (4) modelo-alvo fixo no índice: 1ª rodada = 1º da fila; depois o do índice, mesmo com a lista mudada
    pasta5 = d / "alvo"
    a1 = G.escolher_alvo(G.ler_indice(pasta5), ["melhor", "lite"])
    G.atualizar_progresso(pasta5, seis, a1[0])
    a2 = G.escolher_alvo(G.ler_indice(pasta5), ["novo-melhor", "melhor", "lite"])
    a3 = G.escolher_alvo(G.ler_indice(pasta5), ["novo-melhor", "melhor"], forcado="novo-melhor")
    ind5 = G.ler_indice(pasta5)
    caso("modelo-alvo: 1º da fila na 1ª vez, fixo no índice depois (lista mudou), --modelo-alvo troca",
         a1 == ("melhor", "1º da fila") and a2 == ("melhor", "índice") and a3 == ("novo-melhor", "--modelo-alvo")
         and ind5["modelo_alvo"] == "melhor" and ind5["progresso_alvo"]["total"] == 6
         and ind5["progresso_alvo"]["faltam"] == 6 and not ind5["progresso_alvo"]["concluido"], f"{a1} {a2} {a3}")
    # alvo fora da lista da API: completa o que falta e não converge
    pasta6 = d / "alvo-sumiu"
    tts6 = FalsoFila({"outro": 9})
    out6 = G.rodada(seis[:2], pasta6, tts6, "sumiu", lote=2, aberto=lambda: False, brutos=brutos, conferir=tts6.ouvir())
    caso("alvo fora da lista da API: completa com a fila e não converge",
         out6["a"]["geradas"] == 2 and out6["b"] is None and "fora da lista" in out6["motivo_b"], str(out6["motivo_b"]))
    # Gemini.so/priorizar sem rede (objeto sem __init__)
    g = G.Gemini.__new__(G.Gemini)
    g.fila, g.esgotados, g.modelo = ["a", "b", "c"], ["b"], "a"
    ok_p = g.priorizar("b") and g.fila == ["b", "a", "c"] and g.modelo == "a"
    caso("Gemini: priorizar põe o alvo na frente (pulando esgotado); so() recusa alvo esgotado e fixa a fila",
         ok_p and g.so("b") is False and g.so("c") and g.fila == ["c"] and g.modelo == "c" and g.priorizar("x") is False)

    # falha passageira (a 1ª rodada agendada, 13/10/2026, caiu com "Server disconnected without sending a
    # response"): tenta de novo; persistente -> RedeFalhou e a rodada para limpo; 400 sobe na hora
    class Cli:
        def __init__(self, erros):
            self.erros, self.pedidos = list(erros), []
            self.models = self

        def generate_content(self, model, contents, config):
            self.pedidos.append(model)
            if self.erros:
                raise self.erros.pop(0)
            return "resposta"

    def gem(erros, fila=("alvo", "outro")):
        x = G.Gemini.__new__(G.Gemini)
        x.fila, x.esgotados, x.modelo, x.ultima, x.intervalo = list(fila), [], fila[0], 0.0, 0
        x.cli = Cli(erros)
        return x
    dormiu = []
    g1 = gem([RuntimeError("Server disconnected without sending a response."), TimeoutError("timed out")])
    r1 = g1._pedir("p", None, dormir=dormiu.append)
    g2 = gem([RuntimeError("Server disconnected without sending a response.")] * 9)
    try:
        g2._pedir("p", None, dormir=dormiu.append)
        e2 = None
    except G.RedeFalhou as e:
        e2 = e
    g3 = gem([RuntimeError("400 INVALID_ARGUMENT")])
    try:
        g3._pedir("p", None, dormir=dormiu.append)
        e3 = None
    except Exception as e:
        e3 = e
    dia = "429 RESOURCE_EXHAUSTED {'quotaId': 'GenerateRequestsPerDayPerProjectPerModel-FreeTier'}"
    g4 = gem([RuntimeError(dia), RuntimeError(dia)])
    try:
        g4._pedir("p", None, dormir=dormiu.append)
        e4 = None
    except G.CotaEsgotada as e:
        e4 = e
    caso("Gemini: rede caiu -> tenta de novo; 4 quedas -> RedeFalhou; 400 sobe; 429 diário passa de modelo e acaba",
         r1 == "resposta" and len(g1.cli.pedidos) == 3 and isinstance(e2, G.RedeFalhou)
         and len(g2.cli.pedidos) == len(G.ESPERAS_REDE) + 1 and type(e3) is RuntimeError
         and g4.cli.pedidos == ["alvo", "outro"] and e4 is not None and g4.esgotados == ["alvo", "outro"],
         f"{g1.cli.pedidos} {e2!r} {e3!r} {g4.cli.pedidos}")

    class RedeCaiu(Falso):
        def __call__(self, frases, destino):
            raise G.RedeFalhou("ServerError: 503")
    pasta7 = d / "rede"
    r7 = G.gerar(seis[:2], pasta7, RedeCaiu(), lote=2, aberto=lambda: False, brutos=brutos)
    caso("gerar: RedeFalhou para a rodada limpo (status rede), nada gravado, as falas seguem faltando",
         r7["status"] == "rede" and r7["faltam"] == 2 and r7["geradas"] == 0, str(r7))


def casos_auditoria(d, frases):
    """passo 6c: tools/auditar-pacote-voz.py (régua do gerador contra o catálogo inteiro; marca com a trava e só onde o
    arquivo ainda é o transcrito; para com o jogo aberto e retoma)"""
    spec_a = importlib.util.spec_from_file_location("auditar_pacote_voz", RAIZ / "tools" / "auditar-pacote-voz.py")
    A = importlib.util.module_from_spec(spec_a)
    spec_a.loader.exec_module(A)
    cat = ["o mid chegando no top", "o mid chegando no bot", "o top chegando no mid", "o atirador chegou no nível 11",
           "o atirador chegou no nível 11, respeita", "jungler no rio top", "jungler no top", "5 vindo no top, recua",
           "2 vindo no top, recua"]
    j = lambda f, t: A.julgar(f, t, cat)[0]  # noqa: E731
    caso("auditoria: certa passa; outra frase do catálogo (fora do lote) marca; sem o 'respeita' marca; nota baixa marca",
         not j("o mid chegando no top", "o mid chegando no top.") and j("o mid chegando no top", "o mid chegando no bot.")
         and j("o atirador chegou no nível 11, respeita", "O atirador chegou no nível 11.")
         and j("o mid chegando no top", "o banco caiu na rua"))
    caso("auditoria: o que o Whisper erra sempre não marca ('Hilltop' = rio top, 'midi', 'Simco' = 5); empate não marca",
         not j("jungler no rio top", "Jungler no Hilltop.") and not j("o top chegando no mid", "o top chegando no midi.")
         and not j("5 vindo no top, recua", "Simco vindo no top, recua.")
         and A.julgar("5 vindo no top, recua", "vindo no top, recua", cat)[0] is False)
    todas = avisos.catalogo()
    caso("auditoria: nenhuma frase do catálogo tem as palavras trocadas pelos aliases do Whisper",
         not [f for f in todas if set(G._norm(f).split()) & (set(A.ALIASES_WHISPER) | {"hill"})])

    # pacote real em miniatura (gerador falso) + Whisper falso; a 2ª fala diz outra frase do pacote
    pasta = d / "pacote"
    tres = frases[:3]
    G.gerar(tres, pasta, Falso(), lote=3, aberto=lambda: False, brutos=d / "brutos")
    fs = G.ler_indice(pasta)["frases"]
    pelo_arquivo = {fs[f]["arquivo"]: (tres[0] if f == tres[1] else f) for f in tres}
    ouvidos = []

    def whisper(caminhos):
        ouvidos.append(len(caminhos))
        return [pelo_arquivo[Path(c).name] for c in caminhos]
    prog, abre = {}, iter([False, True])
    st1 = A.transcrever(pasta, fs, prog, whisper, lote=2, aberto=lambda: next(abre), gravar=lambda p: None, log=lambda m: None)
    st2 = A.transcrever(pasta, fs, prog, whisper, lote=2, aberto=lambda: False, gravar=lambda p: None, log=lambda m: None)
    caso("auditoria: jogo abre entre lotes = para (jogo_aberto) e a chamada seguinte retoma só o que faltou",
         st1 == "jogo_aberto" and st2 == "completo" and ouvidos == [2, 1] and sorted(prog) == sorted(tres), f"{st1} {st2} {ouvidos}")
    av = A.avaliar(prog, fs, tres)
    # o gerador troca o arquivo da 3ª no meio (rodada agendada): a auditoria não marca nada nela
    ind = G.ler_indice(pasta)
    ind["frases"][tres[2]]["arquivo"] = "trocado-2.wav"
    G.gravar_indice(pasta, ind)
    novas, n = A.marcar(pasta, av, log=lambda m: None)
    fx = G.ler_indice(pasta)["frases"]
    caso("auditoria: marca suspeita só a que não bate, grava a auditoria e pula a fala cujo arquivo mudou",
         novas == [tres[1]] and n == 2 and fx[tres[1]].get("suspeita") and fx[tres[1]]["auditoria"]["parecida"] == tres[0]
         and not fx[tres[0]].get("suspeita") and "auditoria" in fx[tres[0]] and "auditoria" not in fx[tres[2]],
         f"{novas} {n}")
    trava = G.travar(pasta)
    r_ocupado = A.marcar(pasta, av, espera_s=0, log=lambda m: None)
    trava.close()
    caso("auditoria: índice com a trava de um gerador -> não grava (None) e o progresso fica",
         r_ocupado is None or os.name != "nt", str(r_ocupado))
    caso("auditoria: --refazer marca à mão (Maria até a fase b refazer no alvo)",
         A.refazer_a_mao(pasta, tres[0], log=lambda m: None) and G.ler_indice(pasta)["frases"][tres[0]].get("suspeita")
         and not A.refazer_a_mao(pasta, "frase que não existe", log=lambda m: None))


def casos_tocador_relido(d):
    """o Pacote se relê quando o indice.json muda (antes de uma fala, nunca durante): fala trocada pelo gerador
    toca o arquivo novo sem reiniciar o coletor; índice ilegível no meio fica no que estava"""
    d.mkdir(parents=True)
    for n in ("a.wav", "b.wav"):
        escrever(d / n, [(0.2, True)])

    def indice(arq):
        (d / "indice.json").write_text(json.dumps({"voz": "t", "frases": {"mid sumiu": {"arquivo": arq}}}),
                                       encoding="utf-8")
    indice("a.wav")
    tocados = []
    p = Pacote(d)
    v = Voz(saida=lambda t: None, pacote=p, tocar=lambda a, c: tocados.append(a.name), faltou=d / "f.jsonl")
    v.falar("mid sumiu")
    v.esperar(5)
    mesmo = p.relido() is p
    indice("b.wav")
    import os
    os.utime(d / "indice.json", ns=(p.mtime + 2_000_000_000, p.mtime + 2_000_000_000))
    v.falar("mid sumiu")
    v.esperar(5)
    (d / "indice.json").write_text("{quebrado", encoding="utf-8")
    os.utime(d / "indice.json", ns=(p.mtime + 4_000_000_000, p.mtime + 4_000_000_000))
    v.falar("mid sumiu")
    v.esperar(5)
    v.parar()
    caso("tocador: índice mudou -> relê antes da próxima fala e toca o arquivo novo; ilegível = fica no que estava",
         tocados == ["a.wav", "b.wav", "b.wav"] and mesmo and not (d / "f.jsonl").exists(), str(tocados))


def casos_agendador(d):
    """tools/voz-agendada.py sem tarefa de verdade: recusa com o jogo aberto ou fora do lobby, desativa ao
    concluir, vigia pede parada quando o client entra em fila, log sem chave"""
    import logging
    spec_w = importlib.util.spec_from_file_location("voz_agendada", RAIZ / "tools" / "voz-agendada.py")
    W = importlib.util.module_from_spec(spec_w)
    spec_w.loader.exec_module(W)
    d.mkdir(parents=True)
    W.ULTIMA, W.PARAR, W.DADOS = d / "ultima.json", d / "parar", d
    linhas = []

    class Lista(logging.Handler):
        def emit(self, r):
            linhas.append(r.getMessage())
    log = logging.getLogger("teste-voz-agendada")
    log.handlers, log.propagate = [Lista()], False
    log.setLevel(logging.INFO)
    chamadas = {"executar": 0, "desativar": 0}

    def executar_falso(rc=0, status="completo"):
        def f(log_, aberto=None, fase=None):
            chamadas["executar"] += 1
            return rc, {"status": status}
        return f

    def desativar_falso():
        chamadas["desativar"] += 1
        return True, "ok"
    r1 = W.rodar(log, aberto=lambda: True, fase=lambda: None, executar_fn=executar_falso(),
                 progresso_fn=lambda: {"concluido": True}, desativar_fn=desativar_falso)
    u1 = json.loads(W.ULTIMA.read_text(encoding="utf-8"))
    r2 = W.rodar(log, aberto=lambda: False, fase=lambda: "ChampSelect", executar_fn=executar_falso(),
                 progresso_fn=lambda: {"concluido": True}, desativar_fn=desativar_falso)
    r2b = W.rodar(log, aberto=lambda: False, fase=lambda: "?", executar_fn=executar_falso(),
                  progresso_fn=lambda: {"concluido": True}, desativar_fn=desativar_falso)
    caso("agendador: jogo aberto ou client em fila/seleção (ou fase ilegível) -> sai sem rodar o gerador",
         r1 == W.RC["jogo"] and r2 == W.RC["fase"] and r2b == W.RC["fase"] and chamadas == {"executar": 0, "desativar": 0}
         and u1["resultado"] == "pulada: jogo aberto", f"{r1} {r2} {r2b} {chamadas}")
    r3 = W.rodar(log, aberto=lambda: False, fase=lambda: None, executar_fn=executar_falso(0),
                 progresso_fn=lambda: {"concluido": False, "faltam": 3}, desativar_fn=desativar_falso)
    r4 = W.rodar(log, aberto=lambda: False, fase=lambda: "Lobby", executar_fn=executar_falso(2, "cota"),
                 progresso_fn=lambda: {"concluido": True}, desativar_fn=desativar_falso)
    sem = chamadas["desativar"]
    r5 = W.rodar(log, aberto=lambda: False, fase=lambda: "EndOfGame", executar_fn=executar_falso(0),
                 progresso_fn=lambda: {"concluido": True, "modelo_alvo": "alvo"}, desativar_fn=desativar_falso)
    u5 = json.loads(W.ULTIMA.read_text(encoding="utf-8"))
    caso("agendador: concluído (completo e 100% no alvo, rc 0) -> desativa a tarefa e registra; senão não",
         sem == 0 and chamadas["desativar"] == 1 and r3 == r4 == r5 == 0 and u5["desativada"] is True
         and any("desativada" in l for l in linhas), f"{chamadas} {u5}")
    # vigia: filho (python de verdade, console oculto) espera o arquivo de parada; o client entra em fila
    fases = iter(["Lobby", "Matchmaking"])
    chave = "AIza" + "x" * 35
    filho = ("import os,sys,time\n"
             f"print('pedido com {chave}', flush=True)\n"
             f"while not os.path.exists(r'{W.PARAR}'): time.sleep(0.05)\n"
             "print('RESUMO {\"status\": \"jogo_aberto\", \"pedidos\": 0}', flush=True)\n"
             "sys.exit(3)\n")
    rc, resumo = W.executar(log, aberto=lambda: False, fase=lambda: next(fases, "Matchmaking"),
                            cmd=[sys.executable, "-c", filho], parar=W.PARAR, vigia_s=0.2)
    caso("agendador: client entra em fila no meio -> arquivo de parada, o gerador sai limpo; log sem a chave",
         rc == 3 and resumo == {"status": "jogo_aberto", "pedidos": 0} and not W.PARAR.exists()
         and any("client em Matchmaking" in l for l in linhas) and not any(chave in l for l in linhas)
         and any("(cortada)" in l for l in linhas), f"rc {rc} {resumo}")
    x = W.xml_tarefa(Path(r"C:\Python314\pythonw.exe"), "S-1-5-21-1", W.proximo_inicio())
    caso("agendador: XML da tarefa diária 05:15 a cada 2 h até 23:15, oculta, só logado, uma por vez",
         "<StartBoundary>" in x and "T05:15:00" in x and "<Interval>PT2H</Interval>" in x
         and "<Duration>PT18H1M</Duration>" in x and "<Hidden>true</Hidden>" in x
         and "InteractiveToken" in x and "IgnoreNew" in x and "pythonw.exe" in x and "rodar" in x)


def casos_revisao(d, frases):
    """achados da revisão adversarial do passo 6b (13/10/2026): cada caso falhava antes da correção"""
    import io
    import os
    import time
    d.mkdir(parents=True)
    brutos = d / "brutos"

    # (1) --modelo-alvo digitado errado (ou Gemini que nem sobe) nunca vai para o índice
    class GeminiSemAlvo:
        def __init__(self, voz_api, deve_parar=None):
            self.fila, self.voz_api = ["melhor", "lite"], voz_api

    class GeminiCaiu:
        def __init__(self, voz_api, deve_parar=None):
            raise RuntimeError("GEMINI_API_KEY não veio do Doppler (harness/dev)")
    velhos = (G.PACOTES, G.Gemini, G.log, sys.argv, G.jogo_aberto)
    G.PACOTES, G.log, G.jogo_aberto = d / "pacotes-main", (lambda m: None), (lambda: False)
    pasta = G.PACOTES / "aoede"
    pasta.mkdir(parents=True)
    G.gravar_indice(pasta, {"frases": {}, "modelo_alvo": "melhor"})
    rcs = []
    try:
        for fab in (GeminiSemAlvo, GeminiCaiu):
            G.Gemini = fab
            sys.argv = ["gerar-pacote-voz.py", "--voz", "aoede", "--sem-conferir", "--modelo-alvo", "melhro"]
            try:
                rcs.append(G.main())
            except RuntimeError as e:
                rcs.append(type(e).__name__)
    finally:
        G.PACOTES, G.Gemini, G.log, sys.argv, G.jogo_aberto = velhos
        sys.stdout.reconfigure(encoding="utf-8")
    caso("revisão 1: --modelo-alvo fora da API (ou Gemini que caiu) não estraga o modelo_alvo do índice",
         rcs == [1, "RuntimeError"] and G.ler_indice(pasta).get("modelo_alvo") == "melhor",
         f"{rcs} {G.ler_indice(pasta).get('modelo_alvo')}")

    # (2) jogo abre no meio: o vigia mata na hora (antes esperava 120 s); espera do 429 olha o arquivo de parada
    import logging
    spec_w = importlib.util.spec_from_file_location("voz_agendada_r", RAIZ / "tools" / "voz-agendada.py")
    W = importlib.util.module_from_spec(spec_w)
    spec_w.loader.exec_module(W)
    log = logging.getLogger("teste-revisao")
    linhas = []

    class Lista(logging.Handler):
        def emit(self, r):
            linhas.append(r.getMessage())
    log.handlers, log.propagate = [Lista()], False
    log.setLevel(logging.INFO)
    t0 = time.monotonic()
    rc, _ = W.executar(log, aberto=lambda: True, fase=lambda: "Lobby", parar=d / "parar", vigia_s=0.2,
                       cmd=[sys.executable, "-c", "import time\nwhile True: time.sleep(0.05)"])
    caso("revisão 2: League of Legends.exe abriu no meio -> o vigia mata o gerador na hora (não espera 120 s)",
         rc not in (0, None) and time.monotonic() - t0 < 10 and any("matando" in l for l in linhas),
         f"rc {rc} em {time.monotonic() - t0:.1f} s")
    # (11) uma leitura "?" da LCU não para a rodada; duas seguidas param
    import itertools
    espera = (f"import os,sys,time\nt=time.time()\nwhile time.time()-t<{{s}} and not os.path.exists(r'{d / 'parar'}'): "
              "time.sleep(0.05)\nsys.exit(3 if os.path.exists(r'" + str(d / "parar") + "') else 0)")
    linhas.clear()
    rc_a, _ = W.executar(log, aberto=lambda: False, fase=itertools.cycle(["?", "Lobby"]).__next__, parar=d / "parar",
                         vigia_s=0.2, cmd=[sys.executable, "-c", espera.format(s=1.5)])
    rc_b, _ = W.executar(log, aberto=lambda: False, fase=itertools.cycle(["?"]).__next__, parar=d / "parar",
                         vigia_s=0.2, cmd=[sys.executable, "-c", espera.format(s=8)])
    caso("revisão 11: fase '?' uma vez não para a rodada; duas leituras '?' seguidas param",
         rc_a == 0 and rc_b == 3 and sum("client em ?" in l for l in linhas) == 1, f"{rc_a} {rc_b} {linhas}")
    # (4) o "100%" do log de desligar é honesto com presas e suspeitas
    d1 = W.descrever_conclusao({"modelo_alvo": "alvo", "no_alvo": 450, "total": 452, "presas": 1, "suspeitas": 1})
    d2 = W.descrever_conclusao({"modelo_alvo": "alvo", "no_alvo": 452, "total": 452, "presas": 0, "suspeitas": 0})
    caso("revisão 4: log de desligar diz '100% do que o alvo aceitou' com presas e suspeitas, '100%' sem elas",
         "100% do que o alvo aceitou" in d1 and "1 presa" in d1 and "1 suspeita" in d1 and d2.endswith("100% no "
                                                                                                        "modelo-alvo alvo"),
         f"{d1} | {d2}")
    g = G.Gemini.__new__(G.Gemini)
    g.fila, g.esgotados, g.modelo, g.ultima, g.intervalo = ["alvo"], [], "alvo", 0.0, 0
    g.deve_parar = lambda: True

    class Cli429:
        models = None

        def generate_content(self, model, contents, config):
            raise RuntimeError("429 RESOURCE_EXHAUSTED {'quotaId': 'GenerateRequestsPerMinutePerProjectPerModel'}")
    g.cli = Cli429()
    g.cli.models = g.cli
    t0 = time.monotonic()
    try:
        g._pedir("p", None)
        e = None
    except Exception as x:
        e = x
    caso("revisão 2: espera do 429 por minuto para na hora quando pedem parada (Parado, não 60 s de sono)",
         type(e).__name__ == "Parado" and time.monotonic() - t0 < 5, f"{e!r} {time.monotonic() - t0:.1f} s")

    # (3) indice.json aberto por outro processo (PermissionError no os.replace): tenta de novo
    pasta3 = d / "replace"
    pasta3.mkdir()
    falhas = [PermissionError(13, "em uso"), PermissionError(13, "em uso")]
    real = os.replace

    def replace_ocupado(a, b):
        if falhas:
            raise falhas.pop(0)
        return real(a, b)
    velho_r = getattr(G, "_replace", None)
    G._replace = replace_ocupado
    try:
        G.gravar_indice(pasta3, {"frases": {"x": {"arquivo": "x.wav"}}})
        e3 = None
    except Exception as x:
        e3 = x
    finally:
        G._replace = velho_r if velho_r is not None else real
    caso("revisão 3: indice.json aberto por outro (PermissionError 2 vezes) -> grava na 3ª tentativa",
         e3 is None and G.ler_indice(pasta3).get("frases") == {"x": {"arquivo": "x.wav"}}, repr(e3))

    # (4)/(5)/(6) uma tentativa por dia: recusa no alvo e falha de duração não voltam no mesmo dia, mas contam no
    # critério de concluir; trocar o alvo zera as recusas do alvo antigo
    pasta4 = d / "um-por-dia"
    G.gerar(frases[:2], pasta4, Falso(), lote=2, aberto=lambda: False, brutos=brutos)        # "falso-tts"
    tts = FalsoFila({"alvo": 9}, absurda=frases[1])
    out = G.rodada(frases[:2], pasta4, tts, "alvo", lote=1, aberto=lambda: False, brutos=brutos, conferir=tts.ouvir())
    ind = G.ler_indice(pasta4)
    hoje = time.strftime("%Y-%m-%d")
    caso("revisão 4: recusada no alvo hoje -> fora da fila de hoje, dentro do critério (não conclui)",
         out["b"]["mantidas"] == 1 and G.para_convergir(frases[:2], pasta4, ind, "alvo", hoje=hoje) == []
         and G.para_convergir(frases[:2], pasta4, ind, "alvo") == [frases[1]]
         and not G.progresso(frases[:2], pasta4, ind, "alvo")["concluido"], f"{out['b']} {ind['frases'][frases[1]]}")
    tts2 = FalsoFila({"alvo": 9}, absurda=frases[1])
    out2 = G.rodada(frases[:2], pasta4, tts2, "alvo", lote=1, aberto=lambda: False, brutos=brutos, conferir=tts2.ouvir())
    caso("revisão 4: 2ª rodada no mesmo dia não gasta pedido na fala já recusada hoje",
         tts2.por_modelo == [] and out2["b"] is None, f"{tts2.por_modelo} {out2['motivo_b']}")
    v = ind["frases"][frases[1]]
    v.update(tentativas_alvo=G.MAX_TENTATIVAS_ALVO, alvo_tentado="alvo")
    caso("revisão 6: presa no alvo antigo volta à convergência quando o alvo muda",
         G.para_convergir(frases[:2], pasta4, ind, "alvo") == []
         and G.para_convergir(frases[:2], pasta4, ind, "novo") == frases[:2], str(v))
    pasta5 = d / "falha-dia"
    f5 = Falso(absurda=frases[1])
    G.gerar(frases[:2], pasta5, f5, lote=1, aberto=lambda: False, brutos=brutos)
    f6 = Falso()
    r6 = G.gerar(frases[:2], pasta5, f6, lote=1, aberto=lambda: False, brutos=brutos)
    ind5 = G.ler_indice(pasta5)
    caso("revisão 5: fala com duração absurda é pedida no máximo 1 vez por dia e continua contando em 'faltam'",
         f6.pedidos == [] and r6["faltam"] == 1 and r6["status"] == "falhas"
         and G.pendentes(frases[:2], pasta5, ind5, hoje="2099-01-01") == [frases[1]]
         and ind5["falhas"][frases[1]].get("tentativas") == 1, f"{f6.pedidos} {r6}")

    # (8) órfãos limpos com o índice lido depois da trava: o .wav que outro gerador acabou de pôr no índice fica
    pasta8 = d / "orfaos"
    pasta8.mkdir()
    escrever(pasta8 / "novo.wav", [(0.1, True)])
    escrever(pasta8 / "lixo.wav", [(0.1, True)])
    antigo = time.time() - 3600
    for n in ("novo.wav", "lixo.wav"):
        os.utime(pasta8 / n, (antigo, antigo))
    G.gravar_indice(pasta8, {"frases": {"f": {"arquivo": "novo.wav"}}})
    n8 = G.limpar_orfaos(pasta8)
    caso("revisão 8: limpar_orfaos lê o índice na hora (o .wav citado fica, o órfão sai)",
         n8 == 1 and (pasta8 / "novo.wav").is_file() and not (pasta8 / "lixo.wav").exists(), str(n8))

    # (9) Whisper só sobe no 1º áudio: rodada com a cota morta não carrega o modelo
    subiu = []

    class ConfFalso:
        def __init__(self):
            subiu.append(1)

        def __call__(self, cs):
            return []

        def fechar(self):
            pass
    lazy = G.ConferidorSobDemanda(ConfFalso)
    r9 = G.gerar(frases[:2], d / "lazy", Falso(cota_em=0), lote=2, conferir=lazy, aberto=lambda: False, brutos=brutos)
    caso("revisão 9: conferidor sob demanda não sobe quando o 1º pedido já leva 429",
         r9["status"] == "cota" and subiu == [], f"{r9['status']} {subiu}")


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

        casos_convergencia(d / "conv", frases)
        casos_auditoria(d / "auditoria", frases)
        casos_tocador_relido(d / "relido")
        casos_agendador(d / "agendador")
        casos_revisao(d / "revisao", frases)

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
