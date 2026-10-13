# modo vitrine: prints do overlay do minimapa e da moldura funcionando numa partida de verdade
# (coletor/vitrine.py; docs/COLETOR.md § Coach na partida). Liga para UMA partida.
#   python tools/vitrine.py ligar [--horas 3]   a próxima partida grava (até 25 prints, 1 a cada 20 s por tipo)
#   python tools/vitrine.py estado
#   python tools/vitrine.py desligar
# Só grava com o jogo já em primeiro plano; nunca mexe no foco. Prints em temp/vitrine/<data>/, com
# revisão de privacidade pendente. O coletor precisa ter sido iniciado com este código (ganchos novos).
import argparse
import datetime
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import vitrine  # noqa: E402


def principal():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="modo vitrine (prints do overlay e da moldura) para 1 partida")
    ap.add_argument("acao", choices=("ligar", "estado", "desligar"))
    ap.add_argument("--horas", type=float, default=vitrine.VALIDADE_H, help="validade até a partida começar")
    ap.add_argument("--marca", type=Path, default=vitrine.MARCA_PADRAO, help=argparse.SUPPRESS)
    a = ap.parse_args()
    if a.acao == "ligar":
        m = vitrine.ligar(a.marca, horas=a.horas)
        if m is None:
            gid = vitrine.em_uso(vitrine.ler(a.marca))
            print(f"vitrine em uso na partida {gid}: ela segue gravando e desliga no fim; ligue de novo depois "
                  "(sobrescrever agora faria o fim dela apagar a marca nova).")
            return 1
        ate = datetime.datetime.fromtimestamp(m["expira_em"]).strftime("%H:%M")
        print(f"vitrine ligada: a próxima partida (começando até {ate}) grava até {vitrine.MAXIMO} prints "
              f"em {vitrine.PASTA_PADRAO}\\<data>\\ e desliga sozinha no fim dela.")
        print("só grava com o jogo em primeiro plano; prints passam por revisão de privacidade antes de uso.")
    elif a.acao == "estado":
        e = vitrine.estado(a.marca)
        print(("ligada: " if e["ligada"] else "desligada: ") + e["motivo"])
    else:
        print("vitrine desligada" if vitrine.desligar(a.marca) else "vitrine já estava desligada")
    return 0


if __name__ == "__main__":
    sys.exit(principal())
