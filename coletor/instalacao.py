# O que muda de uma instalação do complemento coach para outra, sem nada fixo da máquina do mantenedor (P4 de
# roadmap/2026-10-19-publicacao-e-complemento-publico.md). Só biblioteca padrão; nenhum IO no import além de ler o EDICAO.
#   edição       "publica" quando existe o arquivo EDICAO na raiz do complemento (o tools/publicar.py põe publico/EDICAO lá,
#                no zip e na foto do repositório público); sem ele, "completa": a pasta de trabalho do mantenedor (o EDICAO
#                mora em publico/, nunca na raiz) segue anunciando e ligando tudo, sem config nova. A pública não anuncia nem
#                liga o que fica só na instalação do mantenedor (SO_COMPLETA: mentor, Riot API na tela de carregamento, draft,
#                importação do histórico, registro das expansões) e não lança o medidor de travadas.
#   pasta do LoL  a que o coletor achou com o client aberto (aprender), as do RiotClientInstalls.json da Riot
#                (associated_client) e a padrão da Riot (C:\Riot Games\League of Legends): o lockfile e o Config\ (game.cfg,
#                input.ini) moram nela. Antes era C:\Games\Riot Games fixo (a desta máquina) em coletor.py, teclas.py e
#                minimapa.py: na instalação padrão da Riot o game.cfg e o input.ini nunca eram achados (P0-d).
# Prova: tools/teste-instalacao.py.
import json
import os
from pathlib import Path

RAIZ = Path(os.path.abspath(__file__)).parent.parent
ARQ_EDICAO = "EDICAO"
SO_COMPLETA = frozenset({"mentor", "carregamento", "draft", "resumos", "expansoes"})
INSTALACOES_RIOT = Path(os.environ.get("ProgramData") or r"C:\ProgramData") / "Riot Games" / "RiotClientInstalls.json"
PASTA_LOL_RIOT = Path(r"C:\Riot Games\League of Legends")


def edicao(raiz=RAIZ):
    """publica com <raiz>/EDICAO (qualquer conteúdo: arquivo torto não liga o que não vai junto), senão completa"""
    return "publica" if (Path(raiz) / ARQ_EDICAO).is_file() else "completa"


EDICAO = edicao()
PUBLICA = EDICAO == "publica"   # lido na hora por quem decide (os testes trocam instalacao.PUBLICA)


def ocultos():
    """recursos do aperto de mão (GET /ola) que esta edição nunca anuncia"""
    return SO_COMPLETA if PUBLICA else frozenset()


def versao(raiz=RAIZ):
    """VERSAO de <raiz>/pengu/versao.js (a mesma do plugin e do tools/publicar.py, decisão 2 do plano), ou None"""
    import re
    try:
        t = (Path(raiz) / "pengu" / "versao.js").read_text(encoding="utf-8")
    except OSError:
        return None
    m = re.search(r"\bVERSAO\s*=\s*'(\d+\.\d+\.\d+)'", t)
    return m.group(1) if m else None


# ---------- pasta do League of Legends ----------

_aprendida = [None]


def aprender(pasta):
    """a pasta do client aberto (a do lockfile achado): vale antes de todas as outras"""
    _aprendida[0] = Path(pasta) if pasta else None


def _da_riot(arq=None):
    """pastas do LoL que o Riot Client registrou (RiotClientInstalls.json, associated_client); [] sem o arquivo"""
    try:
        d = json.loads(Path(arq or INSTALACOES_RIOT).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    assoc = d.get("associated_client") if isinstance(d, dict) else None
    if not isinstance(assoc, dict):
        return []
    out = []
    for k in assoc:
        p = Path(str(k))
        # o mesmo arquivo lista outros jogos da Riot (VALORANT): só a pasta que é do LoL
        if "league of legends" in str(k).lower() or (p / "LeagueClient.exe").exists():
            out.append(p)
    return out


def pastas_lol(arq_riot=None, padrao=None):
    """candidatas em ordem, sem repetição: a aprendida, as do Riot Client, a padrão da Riot"""
    vistas, out = set(), []
    for p in [_aprendida[0], *_da_riot(arq_riot), padrao or PASTA_LOL_RIOT]:
        if p is None:
            continue
        chave = os.path.normcase(os.path.normpath(str(p)))
        if chave not in vistas:
            vistas.add(chave)
            out.append(Path(p))
    return out


def arquivo_lol(*partes, arq_riot=None, padrao=None):
    """o 1º <pasta do LoL>/<partes> que existe (ex.: "Config", "game.cfg"), ou None"""
    for p in pastas_lol(arq_riot, padrao):
        alvo = p.joinpath(*partes)
        if alvo.exists():
            return alvo
    return None


def processo_existe(nome):
    """True se há um processo com este nome de executável (Toolhelp32, sem abrir processo nem lançar programa: custa
    milissegundos). None se a consulta falhou (quem chama decide; o coletor trata como "talvez")"""
    try:
        import ctypes
        import ctypes.wintypes as wt

        class PE32(ctypes.Structure):
            _fields_ = [("dwSize", wt.DWORD), ("cntUsage", wt.DWORD), ("th32ProcessID", wt.DWORD),
                        ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wt.DWORD), ("cntThreads", wt.DWORD),
                        ("th32ParentProcessID", wt.DWORD), ("pcPriClassBase", ctypes.c_long), ("dwFlags", wt.DWORD),
                        ("szExeFile", ctypes.c_wchar * 260)]
        k = ctypes.WinDLL("kernel32", use_last_error=True)
        k.CreateToolhelp32Snapshot.restype = wt.HANDLE
        k.CreateToolhelp32Snapshot.argtypes = [wt.DWORD, wt.DWORD]
        k.Process32FirstW.argtypes = k.Process32NextW.argtypes = [wt.HANDLE, ctypes.POINTER(PE32)]
        k.CloseHandle.argtypes = [wt.HANDLE]
        h = k.CreateToolhelp32Snapshot(0x2, 0)   # TH32CS_SNAPPROCESS
        if not h or h == wt.HANDLE(-1).value:
            return None
        try:
            e = PE32()
            e.dwSize = ctypes.sizeof(PE32)
            ok = k.Process32FirstW(h, ctypes.byref(e))
            alvo = nome.lower()
            while ok:
                if e.szExeFile.lower() == alvo:
                    return True
                ok = k.Process32NextW(h, ctypes.byref(e))
            return False
        finally:
            k.CloseHandle(h)
    except Exception:
        return None
