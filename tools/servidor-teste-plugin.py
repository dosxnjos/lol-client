# servidor local de TESTE para o plugin (plano v2, passos 4, 7, 17 e seção do 7b): um coach_vivo.Coach de
# verdade (servidor_local + Mentor real + draft) na porta 8765, com o banco = cópia (backup) do dados/lol.db em
# temp/pengu/ e a config em temp/pengu/config.json: dados/ fica intocado. Lê a sessão do champ select da LCU
# (só GET, credencial só em memória) e alimenta coach.champ_select, como o coletor faz.
# Só com a porta 8765 livre (o coletor real com o código novo a ocupa; o antigo não). Ctrl+C para sair.
#   python tools/servidor-teste-plugin.py [--fixture] [--novo-banco]
#     --fixture     draft fixo da sessão real gravada (tests/fixtures/champselect-real.json): Zac x Ekko
#     --novo-banco  refaz a cópia do banco (senão reaproveita a de temp/pengu/)
# O mentor chama o Claude de verdade quando o pós-jogo pede (botão "pedir a análise agora" ou pergunta).
import json
import logging
import sqlite3
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import banco  # noqa: E402
import coach_vivo  # noqa: E402
import coletor  # noqa: E402

PASTA = RAIZ / "temp" / "pengu"
DB = PASTA / "lol.db"


class JanelaFalsa:
    """o painel da 2ª tela não abre no teste"""
    def fase(self, f):
        pass

    def fechar(self):
        pass


def copiar_banco():
    """backup do SQLite (o dados/lol.db está em WAL com o coletor real aberto: cópia de arquivo sai inconsistente)"""
    if DB.exists():
        DB.unlink()
    src = sqlite3.connect(f"file:{banco.DB_PADRAO.as_posix()}?mode=ro", uri=True)
    dst = sqlite3.connect(DB)
    src.backup(dst)
    dst.close()
    src.close()


def principal():
    PASTA.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=PASTA / "servidor.log", level=logging.INFO, encoding="utf-8",
                        format="%(asctime)s %(name)s %(message)s")
    if "--novo-banco" in sys.argv or not DB.exists():
        copiar_banco()
    coach = coach_vivo.Coach(db=DB, porta=8765, config=PASTA / "config.json",
                             fabricas={"janela": lambda url, ligado: JanelaFalsa()})
    if not coach.iniciar():
        print("porta 8765 ocupada: o coletor real já serve o plugin")
        return 1
    print("servidor de teste em http://127.0.0.1:8765 (banco temp/pengu/lol.db, log temp/pengu/servidor.log)", flush=True)
    fixture = "--fixture" in sys.argv
    if fixture:
        f = json.loads((RAIZ / "tests" / "fixtures" / "champselect-real.json").read_text(encoding="utf-8"))
        coach.champ_select([e for e in f["eventos"] if "session" in e][-1]["session"])
        print("draft fixo:", coach.draft_atual and coach.draft_atual.get("faixa"), flush=True)
    lcu = coletor.conectar()
    coach.lcu = lcu   # /contexto de partida fora do banco busca na LCU (só GET)
    print("LCU:", "conectada" if lcu else "fora (client fechado?)", flush=True)
    em_selecao = False
    try:
        while True:
            time.sleep(1)
            if fixture or lcu is None:
                continue
            try:
                s = lcu.get("/lol-champ-select/v1/session", timeout=5)
            except Exception:
                s = None
            if isinstance(s, dict) and s.get("myTeam"):
                coach.champ_select(s)
                em_selecao = True
            elif em_selecao:
                coach.fim_champ_select()
                em_selecao = False
    except KeyboardInterrupt:
        pass
    finally:
        coach.encerrar()
    return 0


if __name__ == "__main__":
    sys.exit(principal())
