# varredura do que vai para o repositório público (P0 da publicação, revisão adversarial de 19/10/2026; o P1 usa a mesma
# função dentro do tools/publicar.py). Reprova dado pessoal ou credencial nos arquivos da lista de inclusão do complemento
# (roadmap/2026-10-19-publicacao-e-complemento-publico.d/2026-10-19-p0.md § P0-d). Só leitura: o banco abre mode=ro e a
# saída diz categoria e arquivo:linha, nunca o trecho (um achado pode ser credencial).
#   python -I tools/varrer-publico.py [--raiz R] [--banco dados/lol.db] [--sem-banco]
# Regras (plano § P1.2):
#   credencial       RGAPI-, gho_/ghp_/ghs_/ghu_/ghr_/github_pat_, dp.st. (Doppler), RiotClientAuthToken, as opções
#                    remoting-auth-token e riotclient-auth-token do LeagueClientUx com valor, "riot:" em base64, chave
#                    = valor literal (regex "chave" do guarda-segredo, mesmos filtros de molde)
#   caminho          C:\Dev, C:\Users\ (qualquer letra de disco, barra ou contrabarra, no fim da string também) e
#                    /c/Dev, /c/Users/ do Git Bash
#   (nome)           as mesmas regras sobre o CAMINHO do arquivo ("partida (nome)", "xerek (nome)"...)
#   email            endereço de e-mail
#   nomura, doppler  nome de projeto ou serviço da casa
#   xerek            parte do Riot ID dele, em qualquer lugar (comentário inclusive)
#   riot_id          nome#TAG, e o Riot ID e o puuid gravados no meta do banco (texto exato)
#   puuid            valor com cara de puuid (78 caracteres base64url) ou UUID; a PALAVRA "puuid" passa (é nome de campo)
#   partida          número de 10 dígitos (gameId) com fronteira de dígito (colado em letra, "_" ou ponto final conta;
#                    decimal e hash hexadecimal de 16+ não), PLATAFORMA_<n> (BR1_3293149183, br1_…) e qualquer game_id
#                    do banco
#   nome_literal     "Gabriel" fora de comentário: em Python, comentário e docstring passam, string reprova; em JS/CSS/HTML,
#                    comentário passa; em .md, reprova sempre (é texto que vai junto e se lê)
import argparse
import ast
import io
import re
import sqlite3
import sys
import tokenize
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent

# lista de inclusão do complemento (P0-d): 21 módulos de coletor/ + painel/ + os arquivos que eles leem
MODULOS = ("coletor banco vida servidor_local coach_vivo ao_vivo avisos analise sugestoes voz moldura janela_painel "
           "minimapa overlay_minimapa alcance jungler selva feiticos teclas aviso_partida coach").split()
COMPLEMENTO = ([f"coletor/{m}.py" for m in MODULOS]
               + ["painel/index.html", "painel/painel.css", "painel/painel.js", "pengu/posjogo/licoes.md",
                  "docs/LICOES.md", "docs/ITENS.md", "docs/MOBILIDADE.md", "requirements-complemento.txt"])

SEMPRE = [
    # chave da Riot, token do GitHub (gho_ ghp_ ghs_ ghu_ ghr_ github_pat_), Doppler, token da LCU na linha de comando do
    # LeagueClientUx (o nome da opção sozinho passa; com valor, reprova) e "riot:<senha>" em base64 (o Basic da LCU
    # montado): "riot:" + qualquer caractere imprimível começa por cmlvdDo ou cmlvdDp (o 7º caractere leva 2 bits dele)
    ("credencial", re.compile(r"RGAPI-|\bgh[opsur]_[A-Za-z0-9]{10,}|\bgithub_pat_\w{10,}|\bdp\.st\.|cmlvdD[op]"
                              r"|(?i:riotclientauthtoken|(?:remoting|riotclient)-auth-token=[^\s'\"]{8,})")),
    # letra de disco (C:\Dev, C:/Users/) ou Git Bash (/c/Dev, /c/Users/), com Dev/Users no fim da string também
    ("caminho", re.compile(r"(?:\b[A-Za-z]:|(?<![\w.])/[A-Za-z])[\\/]+(?:Dev|Users)(?:[\\/]|\b)", re.I)),
    ("email", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b")),
    ("nomura", re.compile(r"nomura", re.I)),
    ("doppler", re.compile(r"doppler", re.I)),
    ("xerek", re.compile(r"xerek", re.I)),
    ("riot_id", re.compile(r"[\w.-]#[A-Za-z0-9]{2,5}\b")),
    ("puuid", re.compile(r"(?<![\w-])[A-Za-z0-9_-]{78}(?![\w-])"
                         r"|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I)),
    # "partida" (gameId) não é regex simples: ver _partidas()
]
NOME = re.compile(r"gabriel", re.I)
# gameId = 10 dígitos com fronteira de DÍGITO, não de \w: colado em letra, "_" ou ponto final reprova (partida_3293149183,
# br1_…, jogo…, "… 3293149183."); só o decimal (0.3293149183, 3293149183.5) passa. Revisão do P1, 19/10/2026.
DEZ = re.compile(r"(?<!\d)(?<!\d\.)\d{10}(?!\d)(?!\.\d)")
PLATAFORMA = re.compile(r"(?<![A-Za-z0-9])[A-Za-z]{2,4}\d?_\d{6,}(?!\d)")    # BR1_…, na1_…, em qualquer caixa
NUMERO = re.compile(r"(?<!\d)\d{5,}(?!\d)")                                   # candidato a game_id do banco
_ALNUM = frozenset("0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ")
_HEX = frozenset("0123456789abcdefABCDEF")

# chave = valor literal: o regex "chave" do guarda-segredo (~/.claude/hooks/guarda-segredo.py), com os mesmos filtros de
# molde (variável de ambiente, <placeholder>, None/true...) e a mesma exigência (8+ caracteres, letra e dígito ou símbolo)
CHAVE = re.compile(
    r"(?i)(pass(word|wd)?|senha|secret|token|api[_-]?key|apikey|authtoken|"
    r"client[_-]?secret|access[_-]?key)\b['\"]?\s*[:=]\s*(['\"]?)([^\s'\"]{6,})\3")
_MOLDE = re.compile(r"(os\.environ|getenv|process\.env|\$\{|\$[A-Z]|<[^>]+>|xxx+|\*\*\*|your[_-]|change[_-]?me|"
                    r"placeholder|example|dummy|\.\.\.|None|null|true|false)", re.I)


def _hash_hex(texto, ini, fim):
    """o número está dentro de um hash hexadecimal: o trecho alfanumérico em volta é só [0-9a-f] e tem 16+ caracteres
    (hash de pacote da Riot "70f9590985796fa8.js" em pengu/compacto/perfil.js). "gameId3293149183" não é hash."""
    while ini > 0 and texto[ini - 1] in _ALNUM:
        ini -= 1
    while fim < len(texto) and texto[fim] in _ALNUM:
        fim += 1
    trecho = texto[ini:fim]
    return len(trecho) >= 16 and all(c in _HEX for c in trecho)


def _partidas(texto, ids_banco):
    """posições de gameId: 10 dígitos fora de hash, PLATAFORMA_<n> e qualquer game_id do banco (de qualquer tamanho)"""
    pos = [m.start() for m in DEZ.finditer(texto) if not _hash_hex(texto, m.start(), m.end())]
    pos += [m.start() for m in PLATAFORMA.finditer(texto)]
    if ids_banco:
        pos += [m.start() for m in NUMERO.finditer(texto) if m.group(0) in ids_banco]
    return pos


def _chaves(texto):
    """posições de chave = valor literal (mesma régua do guarda-segredo)"""
    pos = []
    for m in CHAVE.finditer(texto):
        val = m.group(4)
        if not m.group(3) and "(" in val:
            continue                        # sem aspas e com "(" = chamada de código, não literal
        if _MOLDE.search(val) or val.lower() in ("secret", "token", "password", "senha", "apikey"):
            continue
        if len(val) >= 8 and re.search(r"[A-Za-z]", val) and re.search(r"[0-9\W]", val):
            pos.append(m.start())
    return pos


def do_banco(caminho):
    """(game_ids, textos exatos) do banco dele, aberto só para leitura. Sem banco: dois conjuntos vazios."""
    ids, textos = set(), set()
    if not caminho or not Path(caminho).exists():
        return ids, textos
    try:
        con = sqlite3.connect(f"file:{Path(caminho).resolve().as_posix()}?mode=ro", uri=True)
        con.execute("select 1 from sqlite_master limit 1")
    except sqlite3.Error as e:   # WAL sem -shm com o coletor parado, banco travado: segue só com as regras de texto
        print(f"aviso: banco {caminho} ilegível só leitura ({e}); varredura sem os game_ids do banco", file=sys.stderr)
        return ids, textos
    try:
        tabelas = {r[0] for r in con.execute("select name from sqlite_master where type='table'")}
        for t in sorted(tabelas):
            if "game_id" in {r[1] for r in con.execute(f"pragma table_info({t})")}:
                ids |= {str(r[0]) for r in con.execute(f"select distinct game_id from {t}") if r[0]}
        if "meta" in tabelas:
            textos |= {str(v) for c, v in con.execute("select chave, valor from meta where chave in ('jogador', 'puuid')")
                       if v and len(str(v)) >= 4}
    finally:
        con.close()
    return ids, textos


def _linha(texto, pos):
    return texto.count("\n", 0, pos) + 1


def _nome_python(texto):
    """linhas com "Gabriel" em string que não é docstring (comentário nunca é string no tokenize)"""
    arv = ast.parse(texto)
    docs = set()
    for n in ast.walk(arv):
        if isinstance(n, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and n.body:
            b = n.body[0]
            if isinstance(b, ast.Expr) and isinstance(b.value, ast.Constant) and isinstance(b.value.value, str):
                docs.add(b.value.lineno)
    # 3.12+: f-string sai em FSTRING_START/MIDDLE/END e o texto dela no FSTRING_MIDDLE; docstring nunca é f-string
    tipos = {tokenize.STRING, getattr(tokenize, "FSTRING_MIDDLE", tokenize.STRING)}
    return [t.start[0] for t in tokenize.generate_tokens(io.StringIO(texto).readline)
            if t.type in tipos and NOME.search(t.string) and not (t.type == tokenize.STRING and t.start[0] in docs)]


# comentário de JS só com "//" no começo da linha ou depois de espaço ("https://..." numa string não vira comentário)
_JS = re.compile(r"/\*.*?\*/|(?:^|(?<=\s))//[^\n]*", re.S | re.M)
_COMENT = {".js": _JS, ".mjs": _JS, ".css": re.compile(r"/\*.*?\*/", re.S),
           ".html": re.compile(r"<!--.*?-->|/\*.*?\*/|(?:^|(?<=\s))//[^\n]*", re.S | re.M)}


def _nome_outros(texto, sufixo):
    """linhas com "Gabriel" fora de comentário (JS/CSS/HTML); .md e o resto: toda ocorrência"""
    rx = _COMENT.get(sufixo)
    if rx:
        texto = rx.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), texto)
    return [_linha(texto, m.start()) for m in NOME.finditer(texto)]


def varrer_texto(nome, texto, ids_banco=frozenset(), textos_banco=frozenset()):
    """[(categoria, linha)] de um arquivo"""
    achados = []
    for cat, rx in SEMPRE:
        achados += [(cat, _linha(texto, m.start())) for m in rx.finditer(texto)]
    achados += [("partida", _linha(texto, p)) for p in _partidas(texto, ids_banco)]
    achados += [("credencial", _linha(texto, p)) for p in _chaves(texto)]
    for t in textos_banco:
        i = texto.find(t)
        while i >= 0:
            achados.append(("riot_id", _linha(texto, i)))
            i = texto.find(t, i + 1)
    sufixo = Path(nome).suffix.lower()
    if sufixo == ".py":
        achados += [("nome_literal", n) for n in _nome_python(texto)]
    else:
        achados += [("nome_literal", n) for n in _nome_outros(texto, sufixo)]
    return sorted(set(achados), key=lambda a: (a[1], a[0]))


def varrer_nome(caminho, ids_banco=frozenset(), textos_banco=frozenset()):
    """[("<categoria> (nome)", 0)] do próprio caminho do arquivo (pengu/posjogo/xerek-3293149183.md): o nome vai para a
    árvore pública e para o zip como o conteúdo. Sufixo neutro: "Gabriel" no caminho reprova sempre."""
    return sorted({(f"{cat} (nome)", 0) for cat, _ in varrer_texto("nome.txt", caminho, ids_banco, textos_banco)})


def varrer(raiz, arquivos, banco=None):
    """{arquivo: [(categoria, linha)]} só dos que têm achado; arquivo da lista que falta = categoria "falta" """
    ids, textos = do_banco(banco)
    saida = {}
    for rel in arquivos:
        p = Path(raiz) / rel
        a = varrer_nome(rel, ids, textos)
        if not p.exists():
            a.append(("falta", 0))
        else:
            a += varrer_texto(rel, p.read_text(encoding="utf-8"), ids, textos)
        if a:
            saida[rel] = a
    return saida


def contar(saida):
    c = {}
    for achados in saida.values():
        for cat, _ in achados:
            c[cat] = c.get(cat, 0) + 1
    return c


def main(argv=None):
    ap = argparse.ArgumentParser(description="varredura da foto pública (lista de inclusão do complemento)")
    ap.add_argument("--raiz", default=str(RAIZ))
    ap.add_argument("--banco", default=str(RAIZ / "dados" / "lol.db"))
    ap.add_argument("--sem-banco", action="store_true")
    a = ap.parse_args(argv)
    saida = varrer(a.raiz, COMPLEMENTO, None if a.sem_banco else a.banco)
    for rel, achados in saida.items():
        for cat, n in achados:
            print(f"REPROVA {cat:13} {rel}:{n}")
    print(f"{len(COMPLEMENTO)} arquivos, {sum(len(v) for v in saida.values())} achados: {contar(saida)}")
    return 1 if saida else 0


if __name__ == "__main__":
    sys.exit(main())
