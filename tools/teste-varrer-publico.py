# prova da varredura da foto pública (tools/varrer-publico.py; P0 da publicação, revisão adversarial de 19/10/2026).
# Árvore e banco falsos numa pasta temporária: cada dado pessoal plantado reprova na categoria certa, o que é permitido
# (nome em comentário e docstring, a palavra "puuid", constante FILETIME) passa. Por último, a lista de inclusão real:
# o único achado que pode sobrar é "partida" (gameId nos comentários: o P4 tira antes da 1ª foto); nome em texto
# literal, credencial, caminho, e-mail ou Riot ID reprovam aqui. Banco real só mode=ro.
#   python -I tools/teste-varrer-publico.py
import importlib.util
import sqlite3
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
_s = importlib.util.spec_from_file_location("varrer_publico", RAIZ / "tools" / "varrer-publico.py")
V = importlib.util.module_from_spec(_s)
_s.loader.exec_module(V)
falhas = []


def caso(nome, cond, detalhe=""):
    print(("ok   " if cond else "FALHA") + f" {nome}" + (f": {detalhe}" if detalhe and not cond else ""))
    if not cond:
        falhas.append(nome)


def cats(achados):
    return sorted({c for c, _ in achados})


tmp = Path(tempfile.mkdtemp(prefix="varrer-publico-"))
db = tmp / "lol.db"
con = sqlite3.connect(db)
con.execute("create table meta (chave text primary key, valor text)")
con.execute("create table partidas (game_id integer primary key)")
con.execute("create table ao_vivo (game_id integer, gt real)")
con.executemany("insert into meta values (?, ?)", [("jogador", "Fulano Teste#ZZ9"), ("puuid", "abc-puuid-plantado-123")])
con.execute("insert into partidas values (1234567)")
con.execute("insert into ao_vivo values (7654321, 1.0)")
con.commit()
con.close()
ids, textos = V.do_banco(db)
caso("banco: game_id de todas as tabelas e Riot ID/puuid do meta", ids == {"1234567", "7654321"}
     and textos == {"Fulano Teste#ZZ9", "abc-puuid-plantado-123"}, (ids, textos))

PLANTADOS = {
    "partida_comentario": ("x.py", "# medido na partida 3293149183 (15/10)\nA = 1\n", "partida"),
    "partida_plataforma": ("x.py", "# match-v5 BR1_3293420970\n", "partida"),
    "partida_do_banco_curta": ("x.py", "# jogo 1234567 do banco\n", "partida"),
    "partida_do_banco_ao_vivo": ("x.md", "ver 7654321\n", "partida"),
    "gabriel_literal": ("x.py", "motivo = 'clique do Gabriel em voo'\n", "nome_literal"),
    "gabriel_fstring": ("x.py", "n = 2\nm = f'o Gabriel {n}'\n", "nome_literal"),
    "gabriel_md": ("x.md", "Curadoria sem estatística do Gabriel.\n", "nome_literal"),
    "gabriel_js_string": ("x.js", "const t = 'olá, Gabriel'; // ok\n", "nome_literal"),
    "gabriel_html": ("x.html", "<p>coach do Gabriel</p>\n", "nome_literal"),
    "xerek_em_comentario": ("x.py", "# conta Xerekton\n", "xerek"),
    "riot_id": ("x.js", "// Alguem#BR1\n", "riot_id"),
    "riot_id_do_banco": ("x.py", "# Fulano Teste#ZZ9\n", "riot_id"),
    "puuid_do_banco": ("x.py", "P = 'abc-puuid-plantado-123'\n", "riot_id"),
    "puuid_valor": ("x.py", "P = '" + "a1B2-c3_D" * 8 + "abcdef'\n", "puuid"),
    "uuid": ("x.py", "U = '0f8fad5b-d9cb-469f-a165-70867728950e'\n", "puuid"),
    "chave_riot": ("x.py", "K = 'RGAPI-00000000'\n", "credencial"),
    "token_github": ("x.py", "T = 'gho_abcdefghijklmnop'\n", "credencial"),
    "doppler_token": ("x.py", "T = 'dp.st.dev.xyz'\n", "credencial"),
    "caminho_dev": ("x.py", "# C:\\Dev\\lol-client\n", "caminho"),
    "caminho_users": ("x.py", "P = 'C:/Users/fulano/x'\n", "caminho"),
    "email": ("x.md", "fale com alguem@exemplo.com.br\n", "email"),
    "nomura": ("x.py", "# projeto do Grupo Nomura\n", "nomura"),
}
for nome, (arq, texto, esperado) in PLANTADOS.items():
    a = V.varrer_texto(arq, texto, ids, textos)
    caso(f"reprova {nome} ({esperado})", esperado in cats(a), a)

PASSAM = {
    "gabriel_em_comentario_py": ("x.py", "# o Gabriel pediu isto\nA = 1\n"),
    "gabriel_em_docstring": ("x.py", 'def f():\n    """clique do Gabriel"""\n    return 1\n'),
    "gabriel_docstring_modulo": ("x.py", '"""coach do Gabriel"""\nA = 1\n'),
    "gabriel_em_comentario_js": ("x.js", "/* do Gabriel */\nconst a = 1; // Gabriel\n"),
    "gabriel_em_comentario_css": ("x.css", "/* Gabriel */ a { color: #fff }\n"),
    "gabriel_em_comentario_html": ("x.html", "<!-- Gabriel -->\n<p>ok</p>\n"),
    "palavra_puuid": ("x.py", "puuid = eu['puuid']  # puuid do jogador\n"),
    "filetime": ("x.py", "EPOCA = 116444736000000000\n"),
    "url_em_string_js": ("x.js", "const u = 'https://ddragon.leagueoflegends.com/x';\n"),
    "cor_css": ("x.css", "a{color:#ffcc00}\n"),
    "tempo_ms": ("x.py", "PRAZO_MS = 120000\n"),
}
for nome, (arq, texto) in PASSAM.items():
    a = V.varrer_texto(arq, texto, ids, textos)
    caso(f"passa {nome}", a == [], a)

# árvore falsa: a lista de inclusão inteira presente e limpa = 0; um arquivo faltando = "falta"; um plantado reprova
arv = tmp / "arvore"
for rel in V.COMPLEMENTO:
    (arv / rel).parent.mkdir(parents=True, exist_ok=True)
    (arv / rel).write_text("# limpo\n" if rel.endswith(".py") else "limpo\n", encoding="utf-8")
caso("árvore limpa: nenhum achado", V.varrer(arv, V.COMPLEMENTO, db) == {})
(arv / "coletor/avisos.py").write_text("# partida 3293149183\n", encoding="utf-8")
(arv / "docs/ITENS.md").unlink()
s = V.varrer(arv, V.COMPLEMENTO, db)
caso("árvore com plantado e arquivo faltando", cats(s.get("coletor/avisos.py", [])) == ["partida"]
     and s.get("docs/ITENS.md") == [("falta", 0)] and len(s) == 2, s)
caso("main devolve 1 quando reprova", V.main(["--raiz", str(arv), "--banco", str(db)]) == 1)

# lista de inclusão real (banco real só leitura, se existir): só "partida" pode sobrar, e é trabalho do P4
real = V.varrer(RAIZ, V.COMPLEMENTO, RAIZ / "dados" / "lol.db")
fora = {rel: [a for a in ach if a[0] != "partida"] for rel, ach in real.items()}
fora = {rel: ach for rel, ach in fora.items() if ach}
caso("lista real: nenhum nome em texto literal, credencial, caminho, e-mail ou Riot ID", not fora, fora)
gid = {rel: sum(c == "partida" for c, _ in ach) for rel, ach in real.items()}
print(f"lista real: {sum(gid.values())} linhas com gameId em {sum(1 for n in gid.values() if n)} arquivos "
      "(o P4 tira antes da 1ª foto; nada disso é texto visível)")

print(f"\n{len(falhas)} falha(s)" if falhas else "\ntudo ok")
sys.exit(1 if falhas else 0)
