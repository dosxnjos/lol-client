"""prova do OCR do chat (plano v2, passo 15e): lê os prints de tela inteira de uma gravação, calibra o
recorte do chat sozinho, roda o OCR do Windows e confere os pings de feitiço contra o gabarito anotado
à mão (tests/fixtures/chat-pings-*.json, sem nome de jogador).
uso: python tools/teste-ocr-chat.py [temp/gravacao/<pasta>] [--gabarito tests/fixtures/chat-pings-20261013.json]
(aceita também .../chat/ ou .../telas/: o chat/ do gravador antigo está no lugar errado, então usa telas/)
saída: uma linha por print anotado + resumo; não imprime nome de jogador nem texto de conversa.
"""
import argparse
import glob
import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import feiticos as F  # noqa: E402

FAIXA = ((2193, 890), (2194, 800), (2370, 712), (2545, 890))   # faixa (16, 28, 27) em volta do minimapa, 2560x1080


def tela_de_jogo(im):
    """filtro barato para print gravado (sem janela em primeiro plano para olhar): faixa do minimapa"""
    if im.size != (2560, 1080):
        return False
    return all(max(abs(a - b) for a, b in zip(im.getpixel(p)[:3], (16, 28, 27))) <= 6 for p in FAIXA)


def inimigos_da_gravacao(pasta, meu="Zac"):
    """os 5 inimigos (nome da Live Client) da 1ª amostra com os 10 jogadores; o gravador troca o nome
    do jogador pelo campeão, então o 'eu' sai do activePlayer"""
    live = pasta / "live.jsonl"
    with open(live, encoding="utf-8") as f:
        for linha in f:
            d = json.loads(linha).get("dados") or {}
            ps = d.get("allPlayers") or []
            if len(ps) == 10:
                eu = F._eu(d)
                return [p["championName"] for p in ps if p.get("team") != eu.get("team")]
    raise SystemExit(f"sem amostra com 10 jogadores em {live}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pasta", nargs="?", default=str(RAIZ / "temp" / "gravacao" / "20261013-071040"))
    ap.add_argument("--gabarito", default=str(RAIZ / "tests" / "fixtures" / "chat-pings-20261013.json"))
    a = ap.parse_args()
    pastas = [Path(p) for p in glob.glob(a.pasta)] or [Path(a.pasta)]
    pasta = pastas[0]
    if pasta.name in ("chat", "telas"):
        if pasta.name == "chat":
            print("aviso: chat/ do gravador antigo é o canto errado da tela (MEDICAO § 4); usando telas/")
        pasta = pasta.parent
    telas = pasta / "telas"
    gab = json.loads(Path(a.gabarito).read_text(encoding="utf-8"))["telas"]
    inimigos = inimigos_da_gravacao(pasta)
    print(f"gravação {pasta.name}: {len(list(telas.glob('*.png')))} telas, {len(gab)} anotadas; inimigos: {', '.join(inimigos)}")

    from PIL import Image
    ocr = F.OcrChat().iniciar()
    caixa = None
    falhas, n_print, ok_print, n_ping, ok_ping, fp, filtro_erros, sem_usou_ok, sem_usou_n = [], 0, 0, 0, 0, 0, 0, 0, 0
    try:
        for nome in sorted(gab):
            g = gab[nome]
            im = Image.open(telas / f"{nome}.png").convert("RGB")
            jogo = tela_de_jogo(im)
            if jogo != g["jogo"]:
                filtro_erros += 1
                falhas.append(f"{nome}: filtro 'jogo na tela' = {jogo}, gabarito {g['jogo']}")
            if not jogo:
                print(f"{nome}: fora do jogo (pulado)")
                continue
            if caixa is None:
                caixa = F.calibrar_chat(im, ocr)
                if caixa is None:
                    print(f"{nome}: calibração sem linha de chat, tenta no próximo")
                    continue
                print(f"calibrado em {nome}: chat {caixa}")
            linhas = [ln["t"] for ln in ocr.ler(im.crop(caixa), escala=3)]
            lidos = [p for p in (F.ler_ping(e, inimigos) for e in F.juntar_linhas(linhas)) if p]
            usados = {(F.mmss(p["ts"]).zfill(5), p["inimigo"], p["feitico"]) for p in lidos if p["usou"]}
            esperados = {(x["ts"], x["inimigo"], x["feitico"]) for x in g["pings"] if x["tipo"] == "feitico"}
            sem = {(x["ts"], x["inimigo"], x["feitico"]) for x in g["pings"] if x["tipo"] == "sem_usou"}
            sem_lidos = {(F.mmss(p["ts"]).zfill(5), p["inimigo"], p["feitico"]) for p in lidos if not p["usou"]}
            sem_usou_n += len(sem)
            sem_usou_ok += len(sem & sem_lidos)
            certos = esperados & usados
            extras = usados - esperados
            fp += len(extras)
            n_ping += len(esperados)
            ok_ping += len(certos)
            if esperados:
                n_print += 1
                ok_print += certos == esperados
            marca = "" if not (esperados or extras) else (
                f" pings {len(certos)}/{len(esperados)}" + (f" FALSO POSITIVO {sorted(extras)}" if extras else "")
                + (f" faltou {sorted(esperados - certos)}" if esperados - certos else ""))
            print(f"{nome}: {len(linhas)} linhas de OCR{marca}")
            if extras:
                falhas.append(f"{nome}: falso positivo {sorted(extras)}")
    finally:
        ocr.parar()

    pc = 100 * ok_print / n_print if n_print else 0
    com_ping = sum(1 for g in gab.values() if g["pings"])
    print(f"anotados: {len(gab)} prints ({sum(g['chat'] for g in gab.values())} com chat, {com_ping} com ping,"
          f" {n_print} com ping de feitiço)")
    print(f"prints com ping de feitiço reconhecidos inteiros: {ok_print}/{n_print} ({pc:.0f}%) · pings: {ok_ping}/{n_ping}"
          f" · variante sem 'usou': {sem_usou_ok}/{sem_usou_n} · falsos positivos: {fp} · erros do filtro de tela: {filtro_erros}")
    for f in falhas:
        print("  " + f)
    passou = n_print > 0 and pc >= 80 and fp == 0
    if not passou:
        print("FALHOU")
        return 1
    if com_ping < 10:
        # a prova pede >= 10 prints com ping anotados: a régua passou, mas a amostra não basta
        print(f"PARCIAL: só {com_ping} prints com ping ({n_print} de feitiço), < 10; gravar outra partida com o chat certo")
        return 2
    print("ok")
    return 0


if __name__ == "__main__":
    for f in (sys.stdout, sys.stderr):
        f.reconfigure(encoding="utf-8")
    sys.exit(main())
