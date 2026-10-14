# prova do anti-spam da voz (plano v2, passos 10 e 12): motor de avisos (coletor/avisos.py) com
# consumidores falsos, tempo simulado, nada de som. Casos:
#   1. 30 s simulados com avisos chegando a cada 0,5 s → no máximo 1 fala e nenhuma chave repetida
#   2. gank fura o intervalo de 20 s; o mesmo gank em 10 s não repete
#   3. aviso que esperou além da validade não é falado
#   4. tom descontraído troca o texto; tipo desligado não sai
#   5. textos lidos da seção "Avisos ao vivo" de um md (formato do arquivo de lições)
#   6. fila da voz (Voz com saída falsa): urgente/prioridade maior fala antes
#   7. replay da partida real 3292746609 (live.jsonl) pelos GatilhosLive: falas a ≥ 20 s, sem
#      repetição, e o gabarito (dragões, mortes antes dos 10) bate com os eventos gravados
# uso: python tools/teste-coach.py [--live temp/gravacao/<pasta>/live.jsonl]
import argparse
import json
import sys
import tempfile
import time
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import avisos  # noqa: E402
from avisos import TEXTOS, Aviso, GatilhosLive, MotorAvisos, RelogioJogo, carregar_textos, catalogo  # noqa: E402
from voz import Voz  # noqa: E402

LIVE_PADRAO = RAIZ / "temp" / "gravacao" / "20261013-071040" / "live.jsonl"
resultados = []


def caso(nome, ok, detalhe=""):
    resultados.append(ok)
    print(f"{'ok' if ok else 'FALHOU'}  {nome}" + (f"  ({detalhe})" if detalhe else ""))


def falas(m):
    return [(t, a) for t, d, a in m.emitidos if d == "voz"]


def sem_repeticao(m, janela):
    vistos = {}
    for t, d, a in m.emitidos:
        if d != "voz":
            continue
        if a.chave in vistos and t - vistos[a.chave] < janela:
            return False
        vistos[a.chave] = t
    return True


def _inundar(m, avisos, dur=30.0, passo=0.5):
    t = 0.0
    while t < dur:
        for a in avisos():
            m.publicar(a, t)
        m.tick(t)
        t += passo


def caso_30s():
    # a régua do plano é "1 fala a cada 20 s, fora o gank": o mesmo aviso chegando 2×/s por 30 s
    # sai 1 vez; 5 avisos diferentes por 30 s saem no máximo 2 (t=0 e t=20), nunca repetidos
    m = MotorAvisos(textos=TEXTOS)
    _inundar(m, lambda: [Aviso("ouro_guardado", {"ouro": 2100}, "ouro")])
    f1 = falas(m)
    m = MotorAvisos(textos=TEXTOS)
    _inundar(m, lambda: [Aviso("objetivo_60s", {"objetivo": "dragão"}, "dragão:300"),
                         Aviso("ouro_guardado", {"ouro": 2100}, "ouro"),
                         Aviso("inimigo_fed", {"campeao": "Riven", "rota": "top"}, "Riven:3"),
                         Aviso("mid_sumiu", {"campeao": "Yasuo"}, "m1"),
                         Aviso("janela_objetivo", {"n": 2, "objetivo": "dragão"}, "j")])
    f5 = falas(m)
    tempos = [t for t, _ in f5]
    caso("30 s simulados: mesmo aviso 60× → 1 fala; 5 avisos → falas a ≥ 20 s, nenhuma repetida",
         len(f1) == 1 and len(f5) <= 2 and all(b - a >= 20 for a, b in zip(tempos, tempos[1:])) and sem_repeticao(m, 30),
         f"1 aviso: {len(f1)} fala; 5 avisos: {[(t, a.fala) for t, a in f5]}; suprimidos {dict(m.suprimidos)}")


def caso_gank():
    m = MotorAvisos(textos=TEXTOS)
    m.publicar(Aviso("ouro_guardado", {"ouro": 2000}, "o"), 0.0)
    m.publicar(Aviso("gank", {"zona": "no top", "zc": "top"}, "top"), 5.0)
    m.publicar(Aviso("gank", {"zona": "no top", "zc": "top"}, "top"), 12.0)
    m.publicar(Aviso("mid_sumiu", {"campeao": "Yasuo"}, "m"), 13.0)
    m.tick(19.0)
    f = [(t, a.tipo) for t, a in falas(m)]
    caso("gank fura os 20 s, não repete em 10 s, e o comum espera", f == [(0.0, "ouro_guardado"), (5.0, "gank")],
         f"falas {f}")


def caso_fura_informativo():
    # revisão 13/10/2026: "Tristana com Flash" (informativo, prio 20) em 241 não cala "jungler rio top"
    # (prio 80) em 250; o comum seguinte volta a esperar 20 s da última fala
    m = MotorAvisos(textos=TEXTOS)
    m.publicar(Aviso("feitico_voltou", chave="Tristana:Flash",
                     textos={"serio": ("Tristana com Flash", "Tristana com Flash")}), 241.0)
    m.publicar(Aviso("jungler_apareceu", {"campeao": "Ekko", "zona": "no rio top", "zc": "rio top", "zt": "rio"},
                     "rio top"), 250.0)
    m.publicar(Aviso("ouro_guardado", {"ouro": 2000}, "o"), 252.0)
    m.publicar(Aviso("intruso", {"campeao": "Yasuo", "zona": "no top", "zc": "top", "zt": "top"}, "Yasuo:top"), 256.0)
    for t in range(250, 275):
        m.tick(float(t))
    f = [(t, a.tipo, a.furou) for t, a in falas(m)]
    caso("alerta de posição passa à frente de fala informativa (≥ 5 s); o resto espera 20 s",
         f == [(241.0, "feitico_voltou", False), (250.0, "jungler_apareceu", True), (270.0, "ouro_guardado", False)]
         and m.suprimidos["vencido"] == 1, f"falas {f}, vencidos {m.suprimidos['vencido']}")


def caso_repetidos():
    # calibração 14/10/2026: a mesma fala não volta em 60 s (chave diferente, mesma frase), gank da mesma rota
    # não volta em 60 s, feitiço que voltou e pico de nível não repetem, e teto/intervalo do tipo independem da chave
    m = MotorAvisos(textos=TEXTOS)
    g = lambda: Aviso("gank", {"zona": "no top", "zc": "top"}, "top")  # noqa: E731
    m.publicar(g(), 0.0)
    m.publicar(g(), 31.0)                                                   # o caso de 11:54:30 → 11:55:01
    m.publicar(Aviso("gank", {"zona": "no top", "zc": "top"}, "top-de-novo"), 5.0)    # outra chave, eco em 5 s
    for t in range(6, 100):
        m.tick(float(t))
    m.publicar(g(), 100.0)
    fg = [t for t, a in falas(m) if a.tipo == "gank"]
    caso("gank: a mesma rota não repete em 60 s; o eco da mesma frase urgente em < 10 s também não",
         fg == [0.0, 100.0] and m.suprimidos["repetido"] == 1 and m.suprimidos["fala_repetida"] == 1,
         f"ganks em {fg}; suprimidos {dict(m.suprimidos)}")

    # revisão 14/10/2026 (P1): "gank provável no bot" de OUTRA rota (não urgente) e, 30 s depois, eu no bot e o
    # gank urgente com a mesma frase: a voz fala os dois (o 2º é outro perigo, agora em mim)
    m = MotorAvisos(textos=TEXTOS)
    m.publicar(Aviso("gank", {"zona": "no bot", "zc": "bot", "zt": "bot"}, "outra:bot", prio=75, urgente=False,
                     cor="amarelo", tom="serio", validade=avisos.VALIDADE_GANK_OUTRA), 100.0)
    m.publicar(Aviso("gank", {"zona": "no bot", "zc": "bot", "zt": "bot"}, "bot"), 130.0)
    # e a frase NÃO urgente repetida em < 60 s continua calada (jungler apareceu: mesma frase, chave nova)
    ja = lambda k: Aviso("jungler_apareceu", {"campeao": "Ekko", "zona": "no rio top", "zc": "rio top",  # noqa: E731
                                              "zt": "rio", "rota": "jungler"}, k)
    m.publicar(ja("a"), 200.0)
    m.publicar(ja("b"), 230.0)
    for t in range(131, 260):
        m.tick(float(t))
    fv = [(t, a.chave) for t, a in falas(m)]
    caso("fala repetida: urgente com a mesma frase de um não urgente fala; não urgente repetido em < 60 s não",
         fv == [(100.0, "gank:outra:bot"), (130.0, "gank:bot"), (200.0, "jungler_apareceu:a")]
         and m.suprimidos["fala_repetida"] == 1, f"falas {fv}; suprimidos {dict(m.suprimidos)}")

    # revisão 14/10/2026 (P2): gank de outra rota 5 s depois de um "jungler apareceu" (prio 80) espera a voz
    # (20 s) em vez de vencer mudo na fila (validade do tipo era 6 s)
    m = MotorAvisos(textos=TEXTOS)
    m.publicar(ja("x"), 200.0)
    m.publicar(Aviso("gank", {"zona": "no bot", "zc": "bot", "zt": "bot"}, "outra:bot", prio=75, urgente=False,
                     cor="amarelo", tom="serio", validade=avisos.VALIDADE_GANK_OUTRA), 205.0)
    for t in range(206, 240):
        m.tick(float(t))
    fv = [(t, a.tipo) for t, a in falas(m)]
    caso("gank de outra rota com a voz ocupada espera a vez e é falado (validade ≥ intervalo da voz)",
         fv == [(200.0, "jungler_apareceu"), (220.0, "gank")] and not m.suprimidos["vencido"],
         f"falas {fv}; suprimidos {dict(m.suprimidos)}")

    # tom descontraído: o gank de outra rota sai no tom sério ("sai daí" é para quem está na rota)
    m = MotorAvisos(tom="descontraido", textos=TEXTOS)
    a_outra = Aviso("gank", {"zona": "no bot", "zc": "bot", "zt": "bot"}, "outra:bot", urgente=False, tom="serio")
    a_minha = Aviso("gank", {"zona": "no top", "zc": "top", "zt": "top"}, "top")
    m.publicar(a_outra, 0.0)
    m.publicar(a_minha, 1.0)
    caso("gank de outra rota no tom sério mesmo com o motor descontraído; o da minha rota segue o tom",
         a_outra.fala == TEXTOS["gank"]["serio"][0].format(zona="no bot")
         and a_minha.fala == TEXTOS["gank"]["descontraido"][0].format(zona="no top"),
         f"outra {a_outra.fala!r}; minha {a_minha.fala!r}")

    m = MotorAvisos(textos=TEXTOS)
    d = {"rota": "suporte", "feitico": "curar", "feitico_nome": "Curar", "campeao": "Janna"}
    for i, t in enumerate((0.0, 3.0, 25.0)):            # 3 leituras do chat com horários diferentes do mesmo gasto
        m.publicar(avisos.aviso_de({"tipo": "feitico_voltou", "chave": f"Janna:Curar:{i}", "dados": d}), t)
        m.tick(t)
    for t in range(26, 60):
        m.tick(float(t))
    pv = {"campeao": "Jax", "rota": "top", "nivel": 16, "pico": 16}
    m.publicar(avisos.aviso_de({"tipo": "pico_nivel", "chave": "Jax:16", "dados": pv, "molde": "pico_nivel"}), 60.0)
    m.publicar(avisos.aviso_de({"tipo": "pico_nivel", "chave": "Jax:16", "dados": pv, "molde": "pico_nivel"}), 85.0)
    for t in range(61, 110):
        m.tick(float(t))
    ff = [a.fala for _, a in falas(m)]
    caso("feitiço que voltou e nível não repetem", ff == ["curar do suporte voltou", "o top chegou no nível 16"],
         f"falas {ff}")

    m = MotorAvisos(textos=TEXTOS)
    aceitos = [t for t in range(0, 900, 30)
               if m.publicar(Aviso("mid_sumiu", {"campeao": "Yasuo"}, f"m{t}"), float(t))]
    caso("teto (4) e intervalo (120 s) do mid_sumiu valem com chave nova a cada vez",
         aceitos == [0, 120, 240, 360], f"aceitos em {aceitos}; suprimidos {dict(m.suprimidos)}")


def caso_validade():
    m = MotorAvisos(textos=TEXTOS)
    m.publicar(Aviso("ouro_guardado", {"ouro": 2000}, "o"), 0.0)
    m.publicar(Aviso("mid_sumiu", {"campeao": "Yasuo"}, "m"), 1.0)        # validade 8 s
    m.publicar(Aviso("objetivo_60s", {"objetivo": "barão"}, "b"), 2.0)    # validade 20 s
    for t in range(3, 25):
        m.tick(float(t))
    f = [(t, a.tipo) for t, a in falas(m)]
    caso("aviso vencido não fala; o válido fala quando abre a vez", f == [(0.0, "ouro_guardado"), (20.0, "objetivo_60s")]
         and m.suprimidos["vencido"] == 1, f"falas {f}, vencidos {m.suprimidos['vencido']}")


def caso_tom():
    m = MotorAvisos(tom="descontraido", textos=TEXTOS)
    m.publicar(Aviso("inimigo_fed", {"campeao": "Darius", "rota": "top"}, "d"), 0.0)
    m2 = MotorAvisos(textos=TEXTOS)
    m2.configurar(desligados={"inimigo_fed"})
    aceito = m2.publicar(Aviso("inimigo_fed", {"campeao": "Darius", "rota": "top"}, "d"), 0.0)
    fala = falas(m)[0][1].fala
    caso("tom descontraído e tipo desligado", fala == "o top tá fed, nada de um contra um" and not aceito
         and falas(m)[0][1].rotulo == "evita 1x1", f"fala {fala!r}, desligado aceito={aceito}")


def caso_textos_md():
    with tempfile.TemporaryDirectory() as d:
        p = Path(d) / "licoes.md"
        p.write_text("# Lições\n\n## Avisos ao vivo\n\n"
                     "- `ouro_guardado` | sério: volta pra base com {ouro} / volta já | descontraído: bora gastar {ouro} / gasta\n"
                     "- mid_sumiu | sério: o mid sumiu / mid sumiu\n\n## Outra seção\n- gank | sério: nao / nao\n",
                     encoding="utf-8")
        textos, fonte = carregar_textos([p])
    m = MotorAvisos(textos=textos)
    m.publicar(Aviso("ouro_guardado", {"ouro": 2300}, "o"), 0.0)
    a = falas(m)[0][1]
    caso("textos da seção 'Avisos ao vivo' do md", fonte.endswith("licoes.md") and a.fala == "volta pra base com 2300"
         and a.rotulo == "volta já" and textos["gank"]["serio"][0] == "gank provável {zona}"
         and textos["mid_sumiu"]["descontraido"][0].startswith("cadê"), f"fonte {Path(fonte).name}, fala {a.fala!r}")


def caso_ouro_rota():
    # 14/10/2026: começo da partida mostrava "+500" (item inicial do Gabriel contra o inventário vazio do adversário,
    # que só chega quando ele é visto). Itens dele não vistos = ouro desconhecido, sem cor
    import ao_vivo
    eu = {"nome": "eu", "campeao": "Renekton", "rota": "TOP", "nivel": 1, "cs": 0, "ouroEstimado": 500, "itens": [1055, 2003]}
    adv = {"nome": "ele", "campeao": "Jax", "nivel": 1, "cs": 0, "ouroEstimado": 0, "vistoHaS": None, "atual": False,
           "vistoGt": None, "itens": []}
    r = ao_vivo.EstadoPartida._rota(eu, adv, 0)
    visto = dict(adv, vistoGt=95.0, vistoHaS=1, atual=True, itens=[1054], ouroEstimado=450)
    r2 = ao_vivo.EstadoPartida._rota(eu, visto, 0)
    caso("rota: adversário ainda não visto/sem item = ouro desconhecido (nada de +500 na largada)",
         r["diff"]["ouro"] is None and r["cor"]["ouro"] == "velho" and r2["diff"]["ouro"] == 50
         and r2["cor"]["ouro"] == "neutro", f"{r['diff']} {r['cor']} | {r2['diff']} {r2['cor']}")

def caso_catalogo():
    # plano voz pré-gravada, passos 3 e 3b: fala genérica e finita; o catálogo cobre todo molde falado
    import ao_vivo
    import sugestoes
    cat = catalogo()
    grupos = catalogo(por_molde=True)
    falados = {t for t, p in avisos.TIPOS.items() if "v" in p["destinos"] and not p.get("retorno")}
    falados |= {m for m, d, _ in avisos._RETORNO_F9.values() if "v" in d}
    falados |= {"feitico_voltou", "pico_nivel", "pico_nivel_visto", "pico_item"}
    sujas = [f for f in cat if "?" in f.replace("cadê o mid?", "").replace("voltar?", "") or "{" in f]
    caso("catálogo: cobre todo molde com voz, sem placeholder solto nem fala com campeão",
         set(avisos.valores_catalogo()) == falados and not avisos.moldes_fora_do_catalogo()
         and not avisos.moldes_fora_do_catalogo(TEXTOS) and not sujas and len(cat) == len(set(cat)),
         f"{len(cat)} falas, versão {avisos.versao_catalogo(cat)}; por molde "
         f"{ {m: len(f) for m, f in grupos.items()} }; faltam {falados ^ set(avisos.valores_catalogo())}; sujas {sujas[:3]}")
    pontos = [(x, y) for x in range(0, 15001, 500) for y in range(0, 15001, 500)]
    zonas = {avisos.zona(x, y, t)[1][2] for x, y in pontos for t in (100, 200)}
    caso("catálogo: toda {zona} que zona() devolve está nos valores", zonas <= set(avisos.zonas_fala()),
         f"fora {zonas - set(avisos.zonas_fala())}")
    caso("catálogo: valores batem com as fontes (picos, objetivos)",
         avisos.PICOS == tuple(sugestoes.NIVEIS_PICO) and set(avisos.OBJETIVOS_FALA) == set(ao_vivo._OBJ_AVISOS.values())
         and set(avisos.OBJETIVOS) <= set(avisos.OBJETIVOS_FALA))
    # md com {campeao} na fala: o molde sai do pacote (cai na Maria), o resto segue
    t2 = {k: dict(v) for k, v in TEXTOS.items()}
    t2["intruso"]["serio"] = ("{campeao} chegando {zona}", "intruso {zc}")
    fora = avisos.moldes_fora_do_catalogo(t2)
    caso("catálogo: fala com placeholder de rótulo é listada e fica fora do pacote",
         fora == [("intruso", "serio", "campeao")] and "o top chegando no mid" not in catalogo(t2)
         and "visita: o top no mid" in catalogo(t2), str(fora))


def caso_fila_voz():
    ditas = []
    v = Voz(saida=lambda t: (ditas.append(t), time.sleep(0.2)))
    v.falar("primeira", prioridade=10)
    time.sleep(0.05)                       # o fio já pegou a primeira e está "falando"
    v.falar("comum", prioridade=30)
    v.falar("gank", urgente=True, prioridade=100)
    v.falar("mais importante que comum", prioridade=60)
    v.esperar(5)
    v.parar()
    caso("fila da voz por prioridade (urgente antes)", ditas == ["primeira", "gank", "mais importante que comum", "comum"],
         f"ordem {ditas}")


def _wav(caminho, seg=0.3, taxa=16000):
    import wave
    with wave.open(str(caminho), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(taxa)
        w.writeframes(b"\x00\x00" * int(seg * taxa))


def caso_pacote_voz():
    # plano voz pré-gravada, passo 7: pacote falso com 3 wav; frase do pacote toca o arquivo, fora dele cai
    # na Maria (saída falsa) e entra no voz-faltou.jsonl; urgente corta o .wav em curso e fura a fila
    from voz import Pacote
    with tempfile.TemporaryDirectory() as d:
        d = Path(d)
        pasta = d / "pacotes" / "falso"
        pasta.mkdir(parents=True)
        frases = ["mid sumiu", "gank provável no top", "ouro guardado, hora de voltar?"]
        for i, f in enumerate(frases):
            _wav(pasta / f"{i}.wav")
        indice = {"voz": "falso", "modelo": "teste", "versao_catalogo": "x",
                  "frases": {f: {"arquivo": f"{i}.wav"} for i, f in enumerate(frases)} | {"jungler no top": "sumiu.wav"}}
        (pasta / "indice.json").write_text(json.dumps(indice, ensure_ascii=False), encoding="utf-8")
        faltou = d / "voz-faltou.jsonl"
        tocados, maria, cortes = [], [], []

        def tocar(arq, corte, dur=0.4):
            tocados.append(arq.name)
            if corte.wait(dur):
                cortes.append(arq.name)

        v = Voz(saida=lambda t: (maria.append(t), time.sleep(0.05)), pacote=pasta, tocar=tocar, faltou=faltou)
        v.falar("mid  sumiu", prioridade=60)                 # espaços extras: mesma chave do pacote
        v.esperar(5)
        v.falar("o top tá forte, evita o um contra um", prioridade=35)
        v.falar("o top tá forte, evita o um contra um", prioridade=35)
        v.falar("jungler no top", prioridade=80)            # no índice, mas o .wav sumiu: Maria
        v.esperar(5)
        linhas = [json.loads(l) for l in faltou.read_text(encoding="utf-8").splitlines()] if faltou.exists() else []
        caso("pacote: frase do pacote toca o .wav; fora dele, Maria + 1 linha por frase no voz-faltou",
             tocados == ["0.wav"] and sorted(maria) == ["jungler no top", "o top tá forte, evita o um contra um",
                                                        "o top tá forte, evita o um contra um"]
             and sorted(x["fala"] for x in linhas) == ["jungler no top", "o top tá forte, evita o um contra um"]
             and all(x["pacote"] == "falso" for x in linhas)
             and v.fontes[0] == ("mid sumiu", "pacote") and sorted(f for _, f in v.fontes[1:]) == ["maria"] * 3,
             f"tocados {tocados}, maria {maria}, faltou {[x['fala'] for x in linhas]}, fontes {v.fontes}")
        # urgente fura: o comum do pacote é cortado, o gank toca antes do que esperava na fila
        tocados.clear()
        v.falar("ouro guardado, hora de voltar?", prioridade=30)
        time.sleep(0.1)                                      # o fio já pegou o ouro e está "tocando"
        v.falar("mid sumiu", prioridade=60)
        v.falar("gank provável no top", urgente=True, prioridade=100)
        v.esperar(5)
        caso("pacote: urgente corta o .wav em curso e fura a fila", tocados == ["2.wav", "1.wav", "0.wav"]
             and cortes == ["2.wav"], f"tocados {tocados}, cortados {cortes}")
        # validade vale igual: frase do pacote que esperou demais não toca
        v2 = Voz(saida=maria.append, pacote=pasta, tocar=lambda a, c: (tocados.append(a.name), time.sleep(0.5)),
                 faltou=faltou, validade_s=0.2)
        tocados.clear()
        v2.falar("gank provável no top", prioridade=100)
        time.sleep(0.05)
        v2.falar("mid sumiu", prioridade=60)
        v2.esperar(5)
        v.parar()
        v2.parar()
        caso("pacote: validade vale para o .wav (esperou demais, não toca)", tocados == ["1.wav"], f"tocados {tocados}")
        sem = Pacote.abrir("nao-existe", raiz=d / "pacotes")
        seco = Voz(saida=maria.append)
        caso("pacote: pasta ausente = Maria; teste seco não abre o pacote padrão",
             sem is None and seco.pacote is None and Pacote.abrir("falso", raiz=d / "pacotes").nome == "falso")
        # revisão 13/10: fala `suspeita` (Whisper ouviu outra coisa) não toca do pacote; .wav que falha ao tocar
        # cai na Maria (a fala não se perde) e não conta como falta
        pasta2 = d / "pacotes" / "suspeito"
        pasta2.mkdir(parents=True)
        _wav(pasta2 / "a.wav")
        _wav(pasta2 / "b.wav")
        (pasta2 / "indice.json").write_text(json.dumps({"voz": "suspeito", "frases": {
            "mid sumiu": {"arquivo": "a.wav", "suspeita": True}, "gank provável no top": {"arquivo": "b.wav"}}},
            ensure_ascii=False), encoding="utf-8")
        p2 = Pacote(pasta2)
        maria.clear()
        faltou2 = d / "faltou2.jsonl"

        def quebrado(arq, corte):
            raise RuntimeError("Failed to play sound")
        v3 = Voz(saida=maria.append, pacote=p2, tocar=quebrado, faltou=faltou2)
        v3.falar("gank provável no top", prioridade=100)
        v3.esperar(5)
        v3.parar()
        caso("pacote: suspeita fica fora (Maria); .wav que não toca cai na Maria sem virar falta",
             p2.arquivo("mid sumiu") is None and p2.suspeitas == 1 and p2.arquivo("gank provável no top") is not None
             and maria == ["gank provável no top"] and v3.fontes == [("gank provável no top", "maria")]
             and not faltou2.exists(), f"maria {maria}, fontes {v3.fontes}")


def caso_relogio():
    r = RelogioJogo()
    zero = r()
    r.atualizar(100.0)
    time.sleep(0.2)
    agora = r()
    caso("relógio do jogo extrapola entre leituras", zero == 0.0 and 100.15 < agora < 100.5, f"{agora:.2f}")


def caso_replay(caminho):
    if not caminho.exists():
        caso("replay da partida real", False, f"sem {caminho}")
        return
    m = MotorAvisos(textos=TEXTOS)
    g = GatilhosLive(m)
    publicados, carregando, ultimo = [], 0, None
    with open(caminho, encoding="utf-8") as f:
        for linha in f:
            d = json.loads(linha).get("dados")
            if not isinstance(d, dict):
                continue
            gt = float((d.get("gameData") or {}).get("gameTime") or 0)
            antes = len(publicados)
            publicados += [(gt, a) for a in g.atualizar(d)]
            if not any(e.get("EventName") == "GameStart" for e in g.eventos.values()):
                carregando += 1
                assert len(publicados) == antes
            m.tick(gt)
            ultimo = d
    f = falas(m)
    gaps = [b[0] - a[0] for a, b in zip(f, f[1:]) if not b[1].urgente]
    dragoes = [round(e["EventTime"]) for e in sorted(g.eventos.values(), key=lambda e: e["EventID"])
               if e["EventName"] == "DragonKill"]
    fim = g.game_time
    esperado_dragao = [t for t in [240] + [x + 300 - 60 for x in dragoes] if t < fim]
    obj_drag = [round(t) for t, a in publicados if a.tipo == "objetivo_60s" and a.dados["objetivo"] == "dragão"]
    eu = ultimo and next(p for p in ultimo["allPlayers"] if p["championName"] == g.eu)
    mortes_antes_10 = sum(1 for e in g.eventos.values() if e.get("EventName") == "ChampionKill"
                          and e.get("VictimName") == g.eu and e["EventTime"] < 600)
    tipos = sorted({a.tipo for _, a in publicados})
    print(f"     replay: eu={g.eu} ({eu and eu['position']}), {carregando} amostras de carregamento sem aviso,"
          f" {len(publicados)} avisos aceitos, {len(f)} falas; tipos {tipos}")
    for t, a in f:
        print(f"       {int(t) // 60:02d}:{int(t) % 60:02d}  [{a.tipo}] {a.fala}")
    caso("replay: falas a ≥ 20 s uma da outra e nenhuma chave repetida", all(x >= 20 for x in gaps) and sem_repeticao(m, 60),
         f"menor intervalo {min(gaps):.1f} s" if gaps else "")
    cat = set(catalogo(TEXTOS))
    fora = [a.fala for _, a in f if a.fala not in cat]
    caso("replay: toda fala está no catálogo do pacote de voz", f and not fora, f"fora {fora}")
    caso("replay: aviso de dragão 60 s antes de cada nascimento (gabarito = DragonKill gravados)",
         len(obj_drag) == len(esperado_dragao) and all(abs(o - e) <= 1 for o, e in zip(obj_drag, esperado_dragao)),
         f"esperado ~{esperado_dragao}, obtido {obj_drag}")
    sai_mortes = any(a.tipo == "mortes_cedo" for _, a in publicados)
    caso("replay: '2 mortes antes dos 10' só se houve 2 mortes antes dos 10",
         sai_mortes == (mortes_antes_10 >= 2), f"mortes antes dos 10 = {mortes_antes_10}, aviso = {sai_mortes}")
    # o mesmo momento real (gt ~400) com 2 mortes e 2500 de ouro → os dois avisos saem uma vez só
    amostra = None
    with open(caminho, encoding="utf-8") as f:
        for linha in f:
            d = json.loads(linha).get("dados")
            if isinstance(d, dict) and float((d.get("gameData") or {}).get("gameTime") or 0) >= 400:
                amostra = d
                break
    m2 = MotorAvisos(textos=TEXTOS)
    g2 = GatilhosLive(m2)
    for p in amostra["allPlayers"]:
        if p["championName"] == g.eu:
            p["scores"]["deaths"], p["isDead"] = 2, False
    amostra["activePlayer"]["currentGold"] = 2500
    tipos2 = [a.tipo for a in g2.atualizar(amostra)] + [a.tipo for a in g2.atualizar(amostra)]
    caso("amostra real alterada: 2 mortes aos 6:40 e 2500 de ouro → 1 aviso de cada",
         tipos2.count("mortes_cedo") == 1 and tipos2.count("ouro_guardado") == 1, f"{tipos2}")
    # timers vindos de fora (EstadoPartida do ao_vivo.py, que modela o ancião) trocam a tabela própria
    gt = float(amostra["gameData"]["gameTime"])
    g3 = GatilhosLive(MotorAvisos(textos=TEXTOS))
    fora = g3.atualizar(amostra, objetivos=[{"objetivo": "ancião", "nasce_em": gt + 30, "vivo": False}])
    caso("objetivos de fora: 'ancião em um minuto' e nada da tabela própria",
         [a.fala for a in fora if a.tipo == "objetivo_60s"] == ["ancião em um minuto"], f"{[a.fala for a in fora]}")


def caso_cache_estatico():
    """dado estático montado na 1ª fase com client, antes da partida (13/10/2026: a 1ª partida do coach
    rodou 'sem cache (FileNotFoundError)', o cache só nascia 3,5 s depois do InProgress)"""
    import asyncio
    import coach_vivo
    import sugestoes

    class LCU:
        def __init__(self, quebra=False):
            self.gets, self.quebra = [], quebra

        def get(self, caminho, timeout=None):
            self.gets.append(caminho)
            if self.quebra:
                raise ConnectionError("client fechando")
            return {"/lol-patch/v1/game-version": "16.20.1+teste",
                    "/lol-game-data/assets/v1/summoner-spells.json": [{"name": "Flash", "cooldown": 300, "gameModes": ["CLASSIC"]}],
                    "/lol-game-data/assets/v1/items.json": [{"id": 3031, "from": [1038], "to": [], "priceTotal": 3400,
                                                             "inStore": True, "categories": []}],
                    "/lol-game-data/assets/v1/champion-summary.json": [{"id": 1}, {"id": 60001}],
                    "/lol-game-data/assets/v1/champions/1.json": {"alias": "Annie", "id": 1, "name": "Annie",
                                                                  "tacticalInfo": {"damageType": "kMagic"}, "roles": ["mage"]},
                    }[caminho]

    class Janela:
        def fase(self, f):
            pass

        def fechar(self):
            pass

    def sem_mentor(*a):
        raise RuntimeError("sem mentor no teste")

    import logging
    log_coach = logging.getLogger("coletor.coach")   # avisos esperados (sem mentor, LCU quebrada) fora do stderr
    log_coach.propagate = False
    log_coach.addHandler(logging.NullHandler())
    with tempfile.TemporaryDirectory() as tmp:
        cache = Path(tmp) / "cache" / "jogo-estatico.json"
        fab = {"estatico": lambda lcu: sugestoes.carregar_estatico(cache, lcu=lcu), "mentor": sem_mentor,
               "janela": lambda url, ligado: Janela()}
        c = coach_vivo.Coach(db=Path(tmp) / "lol.db", config=Path(tmp) / "config.json", fabricas=fab)
        sem_antes = not cache.exists()
        lcu = LCU()
        asyncio.run(c.fase("Lobby", lcu=lcu))
        pronto = c.estatico_pronto.wait(10)
        lido = sugestoes.carregar_estatico(cache) if cache.exists() else None   # o que o _Partida lê no InProgress
        n = len(lcu.gets)
        asyncio.run(c.fase("ChampSelect", lcu=lcu))
        caso("cache do dado estático montado no Lobby, antes da 1ª partida (e só 1 vez)",
             sem_antes and pronto and lido and lido["versao"] == "16.20.1+teste" and lido["feiticos"] == {"Flash": 300}
             and list(lido["campeoes"]) == ["Annie"] and len(lcu.gets) == n and not cache.with_name(cache.name + ".tmp").exists(),
             f"GETs {n}, campeões {list((lido or {}).get('campeoes') or {})}")
        # client reaberto (atualizou de patch: porta nova) → confere de novo; mesma versão = só 1 GET
        lcu2 = LCU()
        c.lcu = lcu2
        t2 = c.aquecer_estatico()
        if t2:
            t2.join(5)
        caso("client reaberto (outra LCU): aquece de novo, 1 GET da versão com o cache em dia",
             t2 is not None and lcu2.gets == ["/lol-patch/v1/game-version"] and c.estatico_pronto.is_set(),
             f"GETs {lcu2.gets}")
        # LCU falhando: não marca pronto e tenta de novo depois da espera (não a cada fase)
        c2 = coach_vivo.Coach(db=Path(tmp) / "lol.db", config=Path(tmp) / "config.json",
                              fabricas={**fab, "estatico": lambda lcu: sugestoes.carregar_estatico(Path(tmp) / "x.json", lcu=lcu)})
        ruim = LCU(quebra=True)
        c2.lcu = ruim
        t = c2.aquecer_estatico()
        t.join(5)
        de_novo_ja = c2.aquecer_estatico()
        depois = c2.aquecer_estatico(espera_s=0)
        if depois:
            depois.join(5)
        caso("LCU falhando: não marca pronto, não repete a cada fase, tenta de novo depois da espera",
             not c2.estatico_pronto.is_set() and de_novo_ja is None and depois is not None and len(ruim.gets) == 2,
             f"GETs {len(ruim.gets)}")
    log_coach.propagate = True


def caso_escolhas_config():
    """as escolhas das regras de aviso (roadmap/2026-10-14-calibrar-avisos.md, passo 7) chegam às peças da partida:
    na largada (config.json), no AlertasPosicao que nasce depois e a cada POST /config (Coach.configurar)"""
    import logging

    import coach_vivo
    import overlay_minimapa
    import servidor_local
    log_coach = logging.getLogger("coletor.coach")
    log_coach.propagate = False
    log_coach.addHandler(logging.NullHandler())

    class Peca:
        ligado = True
        ao_mostrar = ao_desenhar = ao_alternar = _thread = None

        def __init__(self, *a, **k):
            pass

        def __getattr__(self, nome):
            return lambda *a, **k: None

    class OverlayFalso(Peca):
        def __init__(self, *a, **k):
            self.estilos = []

        def aplicar_estilo(self, e):
            self.estilos.append(e)

    class Janela:
        def fase(self, f):
            pass

        def fechar(self):
            pass

    def sem(*a):
        raise RuntimeError("fora do teste")
    with tempfile.TemporaryDirectory() as tmp:
        arq = Path(tmp) / "config.json"
        arq.write_text(json.dumps({"voz": False, "minimapa": True, "feiticos": False, "carregamento": False, "mentor": False,
                                   "amostrasAoVivo": False, "painelAoVivo": False, "cortarFalaRepetida": False,
                                   "midSumiuFiltro": False, "junglerLonge": "nada", "overlayCor": "roxo",
                                   "overlayForca": "sutil", "overlaySuave": False}), encoding="utf-8")
        # minimapa ligado como na vida real, mas a captura de verdade fica fora: a fábrica falha (cap None) e o
        # overlay nasce à mão em cima de uma captura falsa
        fab = {"voz": Peca, "moldura": Peca, "overlay": OverlayFalso, "estatico": sem, "mentor": sem, "captura": sem,
               "janela": lambda url, ligado: Janela()}
        c = coach_vivo.Coach(db=Path(tmp) / "lol.db", config=arq, liveclient="http://127.0.0.1:9", fabricas=fab)
        p = c.iniciar_partida(9001, 420)
        corte_largada = p.motor.cortar_repetida
        # o AlertasPosicao nasce no 1º allgamedata com GameStart, depois do configurar da largada: pelo caminho real
        # (Coach._ao_ler -> _Partida.passo), não à mão (revisão de 14/10/2026)
        pos_antes = p.pos
        jogo = {"activePlayer": {"riotId": "Eu#BR1"}, "gameData": {"gameTime": 100.0},
                "events": {"Events": [{"EventID": 0, "EventName": "GameStart", "EventTime": 0.0}]},
                "allPlayers": [{"championName": "Illaoi", "team": "ORDER", "position": "TOP", "riotId": "Eu#BR1"},
                               {"championName": "Yasuo", "team": "CHAOS", "position": "MIDDLE", "riotId": "Ele#BR1"}]}
        c._ao_ler(jogo, jogo, {"gt": 100.0, "fase": "jogo", "jogadores": []})
        pos_largada = (p.pos.filtro_mid, p.pos.jungler_longe) if p.pos is not None else None
        p.cap = Peca()
        p._ligar_overlay()
        est_largada = p.ov.estilos[-1] if p.ov.estilos else None
        # POST /config: o plugin volta tudo ao padrão
        c.configurar(servidor_local.salvar_config({"coach": {k: servidor_local.CONFIG_PADRAO[k] for k in (
            "cortarFalaRepetida", "midSumiuFiltro", "junglerLonge", "overlayCor", "overlayForca", "overlaySuave")}}, arq))
        depois = (p.motor.cortar_repetida, p.pos.filtro_mid, p.pos.jungler_longe, p.ov.estilos[-1])
        c.encerrar_partida()
    log_coach.propagate = True
    caso("escolhas da config chegam à partida: largada (motor, AlertasPosicao tardio, overlay) e POST /config",
         corte_largada is False and pos_antes is None and pos_largada == (False, "nada")
         and est_largada == overlay_minimapa.estilo("roxo", "sutil", False)
         and depois == (True, True, "painel", overlay_minimapa.estilo()),
         f"largada corte {corte_largada}, pos {pos_largada}, overlay {est_largada}; depois do POST {depois}")


def principal():
    ap = argparse.ArgumentParser()
    ap.add_argument("--live", type=Path, default=LIVE_PADRAO)
    a = ap.parse_args()
    caso_30s()
    caso_gank()
    caso_fura_informativo()
    caso_validade()
    caso_repetidos()
    caso_tom()
    caso_textos_md()
    caso_ouro_rota()
    caso_catalogo()
    caso_fila_voz()
    caso_pacote_voz()
    caso_relogio()
    caso_cache_estatico()
    caso_escolhas_config()
    caso_replay(a.live)
    n = sum(resultados)
    print(f"\n{'ok' if n == len(resultados) else 'FALHOU'} ({n}/{len(resultados)})")
    return 0 if n == len(resultados) else 1


if __name__ == "__main__":
    sys.exit(principal())
