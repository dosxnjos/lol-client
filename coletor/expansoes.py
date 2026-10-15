# registro das expansões do client compacto (roadmap/2026-10-13-client-compacto.md, passo 15; pedido do Gabriel de
# 15/10/2026): o plugin (pengu/compacto/expansoes.js) manda POST /compacto/expansoes {eventos: [...], descartados} a cada
# saída do compacto para o client normal (evento "inicio") e a cada volta (evento "fim", mesmo id). Aqui só se saneia
# de novo e grava uma linha JSON por evento em dados/expansoes-compacto.jsonl (rotação 1 MB × 3). Quem lê:
# `python tools/relatorio-expansoes.py`. Origem: servidor_local.origem_aceite_ok (só o Pengu e a página do client).
# Nada aqui fala com a LCU. Nome de jogador e Riot ID não entram: o plugin já só manda vocabulário de interface; aqui
# corta texto, tira qualquer "nome#TAG" e descarta chave desconhecida.
import json
import logging
import re
import threading
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path

import banco

ARQUIVO = banco.RAIZ / "dados" / "expansoes-compacto.jsonl"
MAX_BYTES, BACKUPS = 1_000_000, 3
MAX_EVENTOS = 100
log = logging.getLogger("coletor.expansoes")
RIOT_ID = re.compile(r"[^\s#]{1,24}#[A-Za-z0-9]{2,6}")
_ID = re.compile(r"^[\w-]{1,40}$")

TEXTO = {"em": 40, "fase": 40, "seq": 60, "motivo": 200, "origem": 30, "gatilho": 60, "telaAntes": 30, "tela": 30, "como": 80,
         "gatilhoCamada": 60, "aviso": 140}
NUMERO = ("fila", "mapa", "duracaoMs", "esperouFocoMs", "reencolhidas", "versao", "gestoHaMs")
BOOL = ("porEle", "custom", "camadasCortadas")
JANELA = {"larg", "alt", "x", "y", "telaX", "telaY", "zoom", "compacta", "minimizada", "monitor"}


def _texto(v, n):
    if not isinstance(v, str):
        return None
    v = RIOT_ID.sub("…", v.replace("\r", " ").replace("\n", " "))
    return "".join(c for c in v if c.isprintable())[:n]


def _numero(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or v != v or abs(v) > 1e12:
        return None
    return round(v, 2) if isinstance(v, float) else v


def _janela(j):
    if not isinstance(j, dict):
        return None
    out = {}
    for k in JANELA & set(j):
        v = j[k]
        if k in ("compacta", "minimizada"):
            if isinstance(v, bool):
                out[k] = v
        elif k == "monitor":
            if isinstance(v, list) and len(v) == 4 and all(_numero(x) is not None for x in v):
                out[k] = [_numero(x) for x in v]
        elif _numero(v) is not None:
            out[k] = _numero(v)
    return out


def _camada(c):
    if not isinstance(c, dict):
        return None
    filhos = [{"tag": _texto(f.get("tag"), 40) or "", "classes": _texto(f.get("classes"), 60) or ""}
              for f in (c.get("filhos") or [])[:4] if isinstance(f, dict)]
    botoes = [b for b in (_texto(x, 60) for x in (c.get("botoes") or [])[:4]) if b]
    ident = c.get("id") if isinstance(c.get("id"), str) and _ID.match(c.get("id")) else ""
    return {"tag": _texto(c.get("tag"), 40) or "", "id": ident, "classes": _texto(c.get("classes"), 120) or "",
            "filhos": filhos, "titulo": _texto(c.get("titulo"), 120) or "", "botoes": botoes,
            "expande": _texto(c.get("expande"), 40)}


def sanear(ev):
    """evento do plugin -> dict só com as chaves conhecidas (tipos conferidos, texto cortado) ou None"""
    if not isinstance(ev, dict) or ev.get("tipo") not in ("inicio", "fim"):
        return None
    ident = ev.get("id")
    if not isinstance(ident, str) or not _ID.match(ident):
        return None
    out = {"tipo": ev["tipo"], "id": ident}
    for k, n in TEXTO.items():
        v = _texto(ev.get(k), n)
        if v is not None:
            out[k] = v
    for k in NUMERO:
        v = _numero(ev.get(k))
        if v is not None:
            out[k] = v
    for k in BOOL:
        if isinstance(ev.get(k), bool):
            out[k] = ev[k]
    for k in ("janelaAntes", "janelaDepois", "janela"):
        j = _janela(ev.get(k))
        if j is not None:
            out[k] = j
    if isinstance(ev.get("lateral"), dict):
        out["lateral"] = {k: _numero(ev["lateral"].get(k)) for k in ("esq", "dir") if _numero(ev["lateral"].get(k)) is not None}
    if isinstance(ev.get("camadas"), list):
        out["camadas"] = [c for c in (_camada(x) for x in ev["camadas"][:6]) if c]
    if isinstance(ev.get("trilha"), list):
        out["trilha"] = [{"aposMs": _numero(t.get("aposMs")), "fase": _texto(t.get("fase"), 40),
                          "motivo": _texto(t.get("motivo"), 200), "origem": _texto(t.get("origem"), 30)}
                         for t in ev["trilha"][:10] if isinstance(t, dict)]
    return out


class Gravador:
    """uma linha JSON por evento, com rotação (RotatingFileHandler: zero código de rotação próprio). Logger próprio,
    sem propagar (não vai para o coletor.log)."""

    def __init__(self, arquivo=ARQUIVO, max_bytes=MAX_BYTES, backups=BACKUPS):
        self.arquivo = Path(arquivo)
        self.arquivo.parent.mkdir(parents=True, exist_ok=True)
        self.lg = logging.getLogger(f"coletor.expansoes.arquivo.{self.arquivo}")
        self.lg.propagate = False
        self.lg.setLevel(logging.INFO)
        for h in list(self.lg.handlers):    # outro Gravador no mesmo arquivo (teste, recarga): um handler só
            self.lg.removeHandler(h)
            h.close()
        # delay: o arquivo só nasce na 1ª linha (um Coletor de teste com servidor não cria dados/expansoes-compacto.jsonl)
        h = RotatingFileHandler(self.arquivo, maxBytes=max_bytes, backupCount=backups, encoding="utf-8", delay=True)
        h.setFormatter(logging.Formatter("%(message)s"))
        self.lg.addHandler(h)
        self.trava = threading.Lock()

    def gravar(self, eventos):
        with self.trava:
            for ev in eventos:
                self.lg.info(json.dumps(ev, ensure_ascii=False, separators=(",", ":")))

    def fechar(self):
        for h in list(self.lg.handlers):
            self.lg.removeHandler(h)
            h.close()


def rota_expansoes(gravador=None):
    """POST /compacto/expansoes {eventos: [...], descartados} -> (status, dict). Pendurada em
    ServidorLocal.rotas_post["/compacto/"] (coletor.py); origem: servidor_local.origem_aceite_ok."""
    g = gravador or Gravador()

    def f(rota, bruto):
        if rota != "/compacto/expansoes":
            return 404, {"erro": "não existe"}
        try:
            corpo = json.loads(bruto or b"{}")
        except ValueError:
            return 400, {"erro": "json inválido"}
        if not isinstance(corpo, dict) or not isinstance(corpo.get("eventos"), list):
            return 400, {"erro": "corpo sem eventos"}
        recebido = time.strftime("%Y-%m-%dT%H:%M:%S")
        bons = []
        for ev in corpo["eventos"][:MAX_EVENTOS]:
            s = sanear(ev)
            if s:
                s["recebido_em"] = recebido
                bons.append(s)
        desc = _numero(corpo.get("descartados"))
        if desc:
            bons.append({"tipo": "descartados", "id": f"d-{int(time.time())}", "n": desc, "recebido_em": recebido})
        g.gravar(bons)
        for s in bons:
            if s["tipo"] == "inicio":
                log.info("compacto expandiu: %s%s (%s) %s", s.get("origem"), " por ele" if s.get("porEle") else "",
                         s.get("fase"), s.get("motivo") or "")
        return 200, {"ok": True, "gravados": len(bons)}
    return f
