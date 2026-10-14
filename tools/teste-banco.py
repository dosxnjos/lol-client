"""prova do banco do coletor sem credencial (achado de 14/10/2026: o eog guardava a senha e o token da sala do chat
do pós-jogo de cada partida). Banco em pasta temporária; nunca toca em dados/.
uso: python tools/teste-banco.py
- gravar_eog não grava a senha nem o token da sala (nem as mesmas chaves aninhadas), o resto intacto;
- limpar_segredos limpa o que já estava gravado (idempotente) e roda sozinho no abrir();
- a CLI (--limpar-segredos) faz o backup antes e termina com 0 linhas suspeitas;
- banco.SEGREDOS ⊆ chat_janelas.PROIBIDOS (uma lista não esquece o que a outra filtra).
Valores inventados na hora (uuid): nada parecido com credencial fica no arquivo.
"""
import json
import sqlite3
import sys
import tempfile
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
import banco  # noqa: E402

falhas = []
K_SENHA_GERAL, K_SENHA, K_DTO, K_JWT = banco.SEGREDOS   # as chaves reais, sem escrevê-las aqui


def confere(nome, cond, detalhe=""):
    print(f"{'ok' if cond else 'FALHOU'}  {nome}{(' · ' + detalhe) if detalhe else ''}")
    if not cond:
        falhas.append(nome)


def _v():
    return "teste-" + uuid.uuid4().hex


# forma real do eog-stats-block (chaves de 14/10/2026), valores inventados
V = [_v() for _ in range(5)]
EOG = {"gameId": 3293149183, "gameLength": 1597, "multiUserChatId": "pg-3293149183", K_SENHA: V[0],
       "queueType": "RANKED_SOLO_5x5",
       K_DTO: {"channelClaim": V[1], "domain": "lol-post-game", K_JWT: V[2], "targetRegion": "br1"},
       "localPlayer": {"championId": 58, "stats": {"CHAMPIONS_KILLED": 3}, "extra": {K_SENHA_GERAL: V[3]}},
       "teams": [{"players": [{"championId": 54, K_JWT: V[4]}]}]}


def texto_do_banco(db):
    c = sqlite3.connect(db)
    t = "\n".join(r[0] for r in c.execute("select json from eog"))
    c.close()
    return t


def sobra(t):
    return [v for v in V if v in t]


def principal():
    sys.stdout.reconfigure(encoding="utf-8")
    tmp = Path(tempfile.mkdtemp(prefix="teste-banco-"))

    # 1. gravação nova sem segredo
    db = tmp / "novo.db"
    c = banco.abrir(db)
    banco.gravar_eog(c, EOG)
    t = texto_do_banco(db)
    d = json.loads(t)
    confere("gravar_eog: nenhum valor de senha/token no banco", not sobra(t), f"{len(sobra(t))} sobraram")
    confere("gravar_eog: o resto do bloco fica (gameId, multiUserChatId, stats, campeões)",
            d["gameId"] == 3293149183 and d["multiUserChatId"] == "pg-3293149183"
            and d["localPlayer"]["stats"]["CHAMPIONS_KILLED"] == 3 and d["teams"][0]["players"][0]["championId"] == 54)
    confere("gravar_eog: o dict de entrada não é alterado", EOG[K_DTO][K_JWT] == V[2])
    c.close()

    # 2. banco antigo (gravado como até 14/10/2026) limpo pelo limpar_segredos e pelo abrir()
    velho = tmp / "velho.db"
    c = sqlite3.connect(velho)
    c.executescript(banco.ESQUEMA)
    for i in range(3):
        c.execute("insert into eog (ts, game_id, json) values (?,?,?)", (i, i, json.dumps({**EOG, "gameId": i})))
    c.execute("insert into eog (ts, game_id, json) values (?,?,?)", (9, 9, json.dumps({"gameId": 9})))
    c.commit()
    n = banco.limpar_segredos(c)
    confere("limpar_segredos: 3 linhas com segredo limpas, a sem segredo não conta", n == 3, f"{n}")
    confere("limpar_segredos: idempotente (2ª vez = 0)", banco.limpar_segredos(c) == 0)
    c.close()
    t = texto_do_banco(velho)
    confere("limpar_segredos: nenhum valor de senha/token sobra no JSON", not sobra(t))
    wal = Path(str(velho) + "-wal")
    bruto = velho.read_bytes() + (wal.read_bytes() if wal.exists() else b"")
    resto = [v for v in V if v.encode() in bruto]
    confere("limpar_segredos: os bytes antigos não ficam no arquivo (secure_delete + checkpoint)", not resto,
            f"{len(resto)} valores ainda no arquivo")

    velho2 = tmp / "velho2.db"
    c = sqlite3.connect(velho2)
    c.executescript(banco.ESQUEMA)
    c.execute("insert into eog (ts, game_id, json) values (?,?,?)", (1, 1, json.dumps(EOG)))
    c.commit()
    c.close()
    banco.abrir(velho2).close()
    confere("abrir(): limpa o banco antigo sozinho (o coletor reiniciado limpa o real)", not sobra(texto_do_banco(velho2)))

    # 2b. revisão P10: o LIKE casa por acaso (a palavra-chave como VALOR numa lista): 0 linhas e nenhum checkpoint,
    #     que pode esperar o busy_timeout (30 s) a cada abrir() com o MCP lendo
    class Espiao:
        def __init__(self, c):
            self.c, self.sql = c, []

        def execute(self, sql, *a):
            self.sql.append(sql)
            return self.c.execute(sql, *a)

        def __enter__(self):
            return self.c.__enter__()

        def __exit__(self, *a):
            return self.c.__exit__(*a)
    acaso = tmp / "acaso.db"
    c = sqlite3.connect(acaso)
    c.executescript(banco.ESQUEMA)
    c.execute("insert into eog (ts, game_id, json) values (?,?,?)", (1, 1, json.dumps({"gameId": 1, "tags": [K_SENHA]})))
    c.commit()
    esp = Espiao(c)
    n = banco.limpar_segredos(esp)
    confere("limpar_segredos: chave só como valor = 0 linhas e sem checkpoint do WAL",
            n == 0 and not any("checkpoint" in s for s in esp.sql), f"{n}; {esp.sql}")
    c.close()

    # 3. CLI: backup antes, 0 depois
    velho3 = tmp / "lol.db"
    c = sqlite3.connect(velho3)
    c.executescript(banco.ESQUEMA)
    c.execute("insert into eog (ts, game_id, json) values (?,?,?)", (1, 1, json.dumps(EOG)))
    c.commit()
    c.close()
    rc = banco._principal(["--limpar-segredos", "--db", str(velho3)])
    backups = list(tmp.glob("lol-antes-de-limpar-segredos-*.db"))
    confere("CLI: rc 0, backup criado ao lado do banco antes de limpar", rc == 0 and len(backups) == 1,
            f"rc {rc}, {len(backups)} backup(s)")
    confere("CLI: banco limpo", not sobra(texto_do_banco(velho3)))
    confere("CLI: o backup é a cópia de antes (por isso o ARMADILHAS manda apagar depois de conferir)",
            bool(backups) and V[0] in texto_do_banco(backups[0]))

    # 4. uma dona só para a lista
    import chat_janelas
    confere("banco.SEGREDOS ⊆ chat_janelas.PROIBIDOS", set(banco.SEGREDOS) <= set(chat_janelas.PROIBIDOS),
            str(set(banco.SEGREDOS) - set(chat_janelas.PROIBIDOS)))

    print(f"\n{'tudo ok' if not falhas else f'{len(falhas)} falha(s)'}")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(principal())
