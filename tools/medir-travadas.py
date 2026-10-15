# medidor de travadas (15/10/2026): o Gabriel sente quedas de 1-5 s na partida, com o ping do jogo indo a ~300 ms e
# caindo. Os logs da Riot mostraram latência sem perda de pacote e imagem a 60 fps (diagnóstico em
# roadmap/2026-10-15-travadas-na-partida.md), mas não dizem ONDE a latência nasce. Este medidor responde isso: a cada
# 1 s pinga, em paralelo, o roteador (Wi-Fi da casa), o 1º salto do provedor, o último salto que responde no caminho
# até o servidor da partida e uma referência externa (1.1.1.1); lê CPU total, disco, bytes por interface de rede e,
# a cada 2 s, os 5 processos que mais usam CPU e I/O; a cada 3 s o estado do Wi-Fi (netsh: sinal, RSSI, canal, taxas,
# troca de BSSID só em hash). Ping > 150 ms, Wi-Fi que some ou CPU > 90% vira "evento". Ao fim junta os logs da Riot
# (netstats/r3dlog: RTT de 10 em 10 s, FPS, quadros) e os eventos do WLAN-AutoConfig, e escreve o veredito.
#   python tools/medir-travadas.py medir [--partida GID] [--segundos N] [--sem-jogo] [--saida ARQ]
#   python tools/medir-travadas.py parar            # pede ao medidor em curso para fechar e resumir
#   python tools/medir-travadas.py resumo [--jsonl ARQ] [--sessao N]   # refaz o resumo de uma medição gravada
# O coletor liga sozinho no InProgress (coletor/travadas.py); ele sai quando o jogo fecha. Desligar:
# criar dados/medidor-travadas.desligado. Docs: docs/COLETOR.md § Medidor de travadas.
# Peso: só ctypes (ICMP do iphlpapi, PDH, NtQuerySystemInformation), prioridade abaixo do normal, sem tocar na LCU,
# na Live Client nem na Riot API; o único processo filho recorrente é o netsh (3 s, sem janela). Nunca grava a linha
# "Command Line" do r3dlog (leva token e chave da partida): o IP do servidor vem do netstats (peer_address).
# Prova: python tools/teste-medir-travadas.py
from __future__ import annotations

import argparse
import csv
import ctypes
import ctypes.wintypes as wt
import datetime as dt
import hashlib
import json
import os
import re
import socket
import statistics
import struct
import subprocess
import sys
import threading
import time
import unicodedata
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DADOS = RAIZ / "dados"
GAMELOGS = Path(r"C:\Games\Riot Games\League of Legends\Logs\GameLogs")
JOGO_EXE = "league of legends.exe"
EXTERNO = "1.1.1.1"
LIMIAR_PING_MS = 150          # evento: ping acima disso
LIMIAR_CPU = 90.0             # evento: CPU total acima disso
LIMIAR_RIOT_MS = 60           # janela de 10 s do netstats com RTT médio acima disso = pico (base dele: 15-17 ms)
UPLOAD_ALTO_KBS = 1000        # bytes de rede no PC acima disso (KB/s) num pico = "algo competindo pela rede"
WIFI_CADA_S = 3.0
TOP_CADA_S = 2.0
FIM_SEM_JOGO_S = 10.0         # jogo fechado há isso: mede mais nada e resume
ESPERA_JOGO_S = 300.0         # sem jogo em 5 min (coletor ligou e o jogo não abriu): sai
TETO_S = 2 * 3600.0           # nunca mais que 2 h
GUARDAR_DIAS = 30
CREATE_NO_WINDOW = 0x08000000
MUTEX = "Local\\lol-client-medir-travadas"
NOMES = {"gateway": "roteador (Wi-Fi da casa)", "provedor": "1º salto do provedor",
         "caminho": "último salto até o servidor da Riot", "externo": "referência externa (1.1.1.1)",
         "servidor": "servidor da partida"}


def agora_iso(t=None):
    return (dt.datetime.fromtimestamp(t) if t else dt.datetime.now()).isoformat(timespec="milliseconds")


def _iso(s):
    return dt.datetime.fromisoformat(s)


# ---------------------------------------------------------------- ICMP (iphlpapi, sem processo filho)

class _OpcoesIP(ctypes.Structure):
    _fields_ = [("Ttl", ctypes.c_ubyte), ("Tos", ctypes.c_ubyte), ("Flags", ctypes.c_ubyte),
                ("OptionsSize", ctypes.c_ubyte), ("OptionsData", ctypes.c_void_p)]


class _Resposta(ctypes.Structure):
    _fields_ = [("Address", ctypes.c_uint32), ("Status", ctypes.c_uint32), ("RoundTripTime", ctypes.c_uint32),
                ("DataSize", ctypes.c_ushort), ("Reserved", ctypes.c_ushort), ("Data", ctypes.c_void_p),
                ("Options", _OpcoesIP)]


IP_SUCESSO, IP_TTL_EXPIRADO = 0, 11013


class Icmp:
    """um handle ICMP por fio (IcmpSendEcho bloqueia até a resposta ou o tempo)"""

    def __init__(self):
        self.ip = ctypes.WinDLL("iphlpapi", use_last_error=True)
        self.ip.IcmpCreateFile.restype = wt.HANDLE
        self.ip.IcmpSendEcho.argtypes = [wt.HANDLE, ctypes.c_uint32, ctypes.c_void_p, wt.WORD, ctypes.c_void_p,
                                         ctypes.c_void_p, wt.DWORD, wt.DWORD]
        self.ip.IcmpSendEcho.restype = wt.DWORD
        self.ip.IcmpCloseHandle.argtypes = [wt.HANDLE]
        self.h = self.ip.IcmpCreateFile()
        self.dados = ctypes.create_string_buffer(b"lol-client", 10)
        self.buf = ctypes.create_string_buffer(ctypes.sizeof(_Resposta) + 64)

    def eco(self, ip, timeout_ms=1000, ttl=None):
        """(status, rtt_ms, endereço que respondeu) ou (None, None, None) sem resposta"""
        alvo = struct.unpack("<I", socket.inet_aton(ip))[0]
        op = None
        if ttl:
            op = _OpcoesIP(Ttl=ttl)
        n = self.ip.IcmpSendEcho(self.h, alvo, self.dados, len(self.dados), ctypes.byref(op) if op else None,
                                 self.buf, len(self.buf), timeout_ms)
        r = _Resposta.from_buffer(self.buf)
        if n == 0 and r.Status != IP_TTL_EXPIRADO:
            return None, None, None
        return r.Status, r.RoundTripTime, socket.inet_ntoa(struct.pack("<I", r.Address))

    def fechar(self):
        if self.h:
            self.ip.IcmpCloseHandle(self.h)
            self.h = None


class Pinger(threading.Thread):
    """pinga um destino 1 vez por segundo; `ultimo` = (ts, ms ou None)"""

    def __init__(self, nome, ip, parar):
        super().__init__(daemon=True, name=f"ping-{nome}")
        self.nome, self.ip, self.parar = nome, ip, parar
        self.ultimo = None
        self.respostas = []      # últimos 30: True/False (taxa de resposta, para não chamar de evento o que nunca responde)

    def run(self):
        icmp = Icmp()
        try:
            while not self.parar.is_set():
                t0 = time.monotonic()
                try:
                    st, ms, _ = icmp.eco(self.ip, 1000)
                    ok = st == IP_SUCESSO
                except OSError:
                    ok, ms = False, None
                self.ultimo = (time.time(), ms if ok else None)
                self.respostas = (self.respostas + [ok])[-30:]
                if self.nome == "servidor" and len(self.respostas) >= 20 and not any(self.respostas):
                    return      # o servidor da Riot não responde ping (medido): para de mandar à toa
                self.parar.wait(max(0.05, 1.0 - (time.monotonic() - t0)))
        finally:
            icmp.fechar()

    def responde(self):
        return len(self.respostas) >= 5 and sum(self.respostas) / len(self.respostas) >= 0.9


def gateway_padrao():
    """IP do roteador pela rota padrão (route print; a saída é a mesma em qualquer idioma)"""
    try:
        out = subprocess.run(["route", "print", "-4", "0.0.0.0"], capture_output=True, timeout=10,
                             creationflags=CREATE_NO_WINDOW).stdout.decode("latin-1", "replace")
    except Exception:
        return None
    melhor = None
    for linha in out.splitlines():
        p = linha.split()
        if len(p) >= 5 and p[0] == "0.0.0.0" and p[1] == "0.0.0.0" and re.match(r"\d+\.\d+\.\d+\.\d+$", p[2]):
            m = int(p[4]) if p[4].isdigit() else 9999
            if melhor is None or m < melhor[0]:
                melhor = (m, p[2])
    return melhor[1] if melhor else None


def tracar(ip, max_saltos=16, timeout_ms=700):
    """saltos até `ip` (TTL crescente, 1 sonda cada): [(ttl, endereço ou None)]; para no destino"""
    icmp, saltos = Icmp(), []
    try:
        for ttl in range(1, max_saltos + 1):
            st, _, end = icmp.eco(ip, timeout_ms, ttl=ttl)
            saltos.append((ttl, end if st in (IP_SUCESSO, IP_TTL_EXPIRADO) else None))
            if st == IP_SUCESSO:
                break
    finally:
        icmp.fechar()
    return saltos


def escolher_saltos(saltos, gateway, responde=None):
    """provedor = 1º salto depois do roteador; caminho = último salto que também responde ping direto"""
    responde = responde or (lambda end: _responde(end))
    vistos = [e for _, e in saltos if e and e != gateway]
    provedor = next((e for e in vistos if responde(e)), None)
    caminho = next((e for e in reversed(vistos) if e != provedor and responde(e)), None)
    return provedor, caminho


def _responde(ip):
    icmp = Icmp()
    try:
        return sum(icmp.eco(ip, 700)[0] == IP_SUCESSO for _ in range(2)) >= 1
    finally:
        icmp.fechar()


# ---------------------------------------------------------------- PDH (CPU, disco, rede; contadores em inglês)

class _ValorPdh(ctypes.Structure):
    _fields_ = [("CStatus", wt.DWORD), ("_pad", wt.DWORD), ("doubleValue", ctypes.c_double)]


class _ItemPdh(ctypes.Structure):
    _fields_ = [("szName", ctypes.c_wchar_p), ("FmtValue", _ValorPdh)]


PDH_FMT_DOUBLE, PDH_FMT_NOCAP100, PDH_MORE_DATA = 0x200, 0x8000, 0x800007D2


class Pdh:
    SIMPLES = {"cpu": r"\Processor(_Total)\% Processor Time",
               "disco_ocioso": r"\PhysicalDisk(_Total)\% Idle Time",
               "disco_bs": r"\PhysicalDisk(_Total)\Disk Bytes/sec",
               "disco_lat": r"\PhysicalDisk(_Total)\Avg. Disk sec/Transfer"}
    ARRAYS = {"rx": r"\Network Interface(*)\Bytes Received/sec", "tx": r"\Network Interface(*)\Bytes Sent/sec"}

    def __init__(self):
        self.p = ctypes.WinDLL("pdh")
        self.q = wt.HANDLE()
        if self.p.PdhOpenQueryW(None, None, ctypes.byref(self.q)):
            raise OSError("PdhOpenQuery falhou")
        self.c = {}
        for nome, cam in {**self.SIMPLES, **self.ARRAYS}.items():
            h = wt.HANDLE()
            if self.p.PdhAddEnglishCounterW(self.q, cam, None, ctypes.byref(h)) == 0:
                self.c[nome] = h
        self.p.PdhCollectQueryData(self.q)

    def _um(self, h):
        v = _ValorPdh()
        if self.p.PdhGetFormattedCounterValue(h, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, None, ctypes.byref(v)):
            return None
        return v.doubleValue if v.CStatus in (0, 1) else None

    def _array(self, h):
        tam, n = wt.DWORD(0), wt.DWORD(0)
        r = self.p.PdhGetFormattedCounterArrayW(h, PDH_FMT_DOUBLE, ctypes.byref(tam), ctypes.byref(n), None)
        if (r & 0xFFFFFFFF) != PDH_MORE_DATA or not tam.value:     # PDH_STATUS volta como int com sinal
            return {}
        buf = ctypes.create_string_buffer(tam.value)
        if self.p.PdhGetFormattedCounterArrayW(h, PDH_FMT_DOUBLE, ctypes.byref(tam), ctypes.byref(n), buf):
            return {}
        itens = ctypes.cast(buf, ctypes.POINTER(_ItemPdh))
        return {itens[i].szName: itens[i].FmtValue.doubleValue for i in range(n.value)
                if itens[i].FmtValue.CStatus in (0, 1)}

    def ler(self):
        self.p.PdhCollectQueryData(self.q)
        v = {k: self._um(self.c[k]) for k in self.SIMPLES if k in self.c}
        rx = self._array(self.c["rx"]) if "rx" in self.c else {}
        tx = self._array(self.c["tx"]) if "tx" in self.c else {}
        rede = {}
        for nome in sorted(set(rx) | set(tx)):
            a, b = rx.get(nome, 0.0) / 1024, tx.get(nome, 0.0) / 1024
            if a >= 1 or b >= 1 or _eh_wifi(nome):
                rede[_curto(nome)] = [round(a, 1), round(b, 1)]
        disco = None
        if v.get("disco_ocioso") is not None:
            disco = {"ocupado": round(max(0.0, 100 - v["disco_ocioso"]), 1),
                     "mbs": round((v.get("disco_bs") or 0) / 1048576, 2),
                     "ms": round((v.get("disco_lat") or 0) * 1000, 1)}
        cpu = v.get("cpu")
        return (round(cpu, 1) if cpu is not None else None), disco, rede

    def fechar(self):
        self.p.PdhCloseQuery(self.q)


def _eh_wifi(nome):
    n = nome.lower()
    return any(x in n for x in ("wireless", "wi-fi", "wifi", "802.11", "wlan"))


def _curto(nome):
    return ("wifi:" if _eh_wifi(nome) else "") + re.sub(r"\s+", " ", nome)[:28].strip()


# ---------------------------------------------------------------- processos (uma chamada só: NtQuerySystemInformation)

# SYSTEM_PROCESS_INFORMATION (x64): UserTime 40, KernelTime 48, ImageName (len 56, ptr 64), pid 80,
# Read/Write/OtherTransferCount 232/240/248
_OFF = {"user": 40, "kernel": 48, "nome_len": 56, "nome_ptr": 64, "pid": 80, "criado": 32, "io": (232, 240, 248)}


def processos_brutos():
    nt = ctypes.WinDLL("ntdll")
    tam = 1 << 20
    while True:
        buf = ctypes.create_string_buffer(tam)
        ret = wt.ULONG()
        st = nt.NtQuerySystemInformation(5, buf, tam, ctypes.byref(ret)) & 0xFFFFFFFF
        if st == 0xC0000004:
            tam = max(tam * 2, ret.value + 65536)
            continue
        if st:
            raise OSError(f"NtQuerySystemInformation 0x{st:08x}")
        break
    base, out = ctypes.addressof(buf), {}
    off = 0
    while True:
        def u64(o):
            return ctypes.c_uint64.from_address(base + off + o).value
        prox = ctypes.c_uint32.from_address(base + off).value
        pid = u64(_OFF["pid"])
        n = ctypes.c_ushort.from_address(base + off + _OFF["nome_len"]).value
        p = ctypes.c_void_p.from_address(base + off + _OFF["nome_ptr"]).value
        nome = ctypes.wstring_at(p, n // 2) if p and n else ("Idle" if pid == 0 else "System")
        out[(pid, u64(_OFF["criado"]))] = (nome, u64(_OFF["user"]) + u64(_OFF["kernel"]),
                                           sum(u64(o) for o in _OFF["io"]))
        if not prox:
            break
        off += prox
    return out


class Processos:
    def __init__(self):
        self.ncpu = os.cpu_count() or 1
        self.antes, self.t = processos_brutos(), time.monotonic()
        self.jogo_visto = None

    def ler(self):
        """(top CPU [(nome, %)], top I/O [(nome, KB/s)], jogo aberto?, CPU% do jogo)"""
        agora, t = processos_brutos(), time.monotonic()
        dt_s = max(0.2, t - self.t)
        cpu, io, jogo, cpu_jogo = {}, {}, False, None
        for k, (nome, tempo, by) in agora.items():
            if k[0] == 0:
                continue
            a = self.antes.get(k)
            low = nome.lower()
            if low == JOGO_EXE:
                jogo = True
            if not a:
                continue
            c = (tempo - a[1]) / (dt_s * 1e7 * self.ncpu) * 100
            b = (by - a[2]) / dt_s / 1024
            cpu[nome] = cpu.get(nome, 0.0) + c       # somado por nome: 30 chrome.exe = 1 linha
            io[nome] = io.get(nome, 0.0) + b
            if low == JOGO_EXE:
                cpu_jogo = round(c, 1)
        self.antes, self.t = agora, t
        top_c = [[n, round(v, 1)] for n, v in sorted(cpu.items(), key=lambda x: -x[1])[:5] if v >= 0.5]
        top_i = [[n, round(v)] for n, v in sorted(io.items(), key=lambda x: -x[1])[:5] if v >= 50]
        return top_c, top_i, jogo, cpu_jogo


# ---------------------------------------------------------------- Wi-Fi (netsh, só leitura)

_CHAVES_WIFI = {"estado": "estado", "state": "estado", "ap bssid": "bssid", "bssid": "bssid", "banda": "banda",
                "band": "banda", "canal": "canal", "channel": "canal", "tipo de radio": "radio",
                "radio type": "radio", "taxa de recepcao (mbps)": "rx_mbps", "receive rate (mbps)": "rx_mbps",
                "taxa de transmissao (mbps)": "tx_mbps", "transmit rate (mbps)": "tx_mbps", "sinal": "sinal",
                "signal": "sinal", "rssi": "rssi"}


def _sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)).lower().strip()


def decodificar(b):
    try:
        return b.decode("utf-8")
    except UnicodeDecodeError:
        try:
            return b.decode("oem")
        except (LookupError, UnicodeDecodeError):
            return b.decode("cp850", "replace")


def ler_netsh(texto):
    """1ª interface do `netsh wlan show interfaces` -> dict curto (BSSID só em hash; SSID e perfil nunca)"""
    d = {}
    for linha in texto.splitlines():
        if ":" not in linha:
            continue
        k, v = linha.split(":", 1)
        chave = _CHAVES_WIFI.get(_sem_acento(k))
        if not chave or chave in d:
            continue
        v = v.strip()
        if chave == "bssid":
            v = hashlib.sha256(v.lower().encode()).hexdigest()[:8]
        elif chave in ("canal", "rssi"):
            m = re.search(r"-?\d+", v)
            v = int(m.group()) if m else None
        elif chave in ("rx_mbps", "tx_mbps"):
            m = re.search(r"[\d.,]+", v)
            v = float(m.group().replace(",", ".")) if m else None
        elif chave == "sinal":
            m = re.search(r"\d+", v)
            v = int(m.group()) if m else None
        elif chave == "estado":
            v = _sem_acento(v)
        d[chave] = v
    return d


class Wifi(threading.Thread):
    def __init__(self, parar):
        super().__init__(daemon=True, name="wifi")
        self.parar, self.ultimo, self.erro = parar, None, None

    def run(self):
        while not self.parar.is_set():
            try:
                out = subprocess.run(["netsh", "wlan", "show", "interfaces"], capture_output=True, timeout=8,
                                     creationflags=CREATE_NO_WINDOW).stdout
                self.ultimo = ler_netsh(decodificar(out)) or None
            except Exception as e:
                self.erro = f"{type(e).__name__}: {e}"
            self.parar.wait(WIFI_CADA_S)


# ---------------------------------------------------------------- servidor da partida (logs da Riot)

def pastas_da_partida(desde, ate=None, base=None, margem_min=90):
    """pastas do GameLogs com nome (hora de início) entre desde-margem e ate, da mais velha para a mais nova
    (margem larga: o medidor à mão pode começar no meio da partida; quem usa fica com a MAIS NOVA)"""
    base = Path(base or GAMELOGS)
    if not base.is_dir():
        return []
    out = []
    for p in base.iterdir():
        try:
            t = dt.datetime.strptime(p.name[:19], "%Y-%m-%dT%H-%M-%S")
        except ValueError:
            continue
        if t >= desde - dt.timedelta(minutes=margem_min) and (ate is None or t <= ate):
            out.append((t, p))
    return [p for _, p in sorted(out)]


def servidor_da_pasta(pasta):
    """(ip, porta) do servidor pela coluna network.peer_address do netstats (nunca pela Command Line do r3dlog)"""
    for f in Path(pasta).glob("*_netstats.csv"):
        try:
            with open(f, encoding="utf-8", errors="replace", newline="") as fh:
                for r in csv.DictReader(fh):
                    ip = (r.get("network.peer_address") or "").strip()
                    if re.match(r"\d+\.\d+\.\d+\.\d+$", ip):
                        return ip, (r.get("network.peer_port") or "").strip()
        except OSError:
            pass
    return None


def ler_partida_riot(pasta):
    """r3dlog + netstats de uma partida: início do relógio do jogo em hora local, janelas de 10 s com RTT, quadros"""
    pasta = Path(pasta)
    r3 = next(iter(sorted(pasta.glob("*_r3dlog.txt"))), None)
    ns = next(iter(sorted(pasta.glob("*_netstats.csv"))), None)
    if not r3 or not ns:
        return None
    txt = r3.read_text(encoding="utf-8", errors="replace")
    m = re.search(r"Logging started at (\S+)", txt)
    g = re.search(r"^(\d+\.\d+)\|.*GAMESTATE_SPAWN to GAMESTATE_GAMELOOP", txt, re.M)
    if not m or not g:
        return None
    t0 = _iso(m.group(1))
    relogio = t0 + dt.timedelta(seconds=float(g.group(1)))
    gid = re.search(r"-GameID=(\d+)", txt)
    q = {}
    for chave, rx in (("fps", r"Average FPS:\s+([\d.]+)"), ("quadro_max_ms", r"Max Frame Time:\s+([\d.]+)"),
                      ("histograma", r"Frame Time Histogram:\s+(\[[\d,]+\])")):
        mm = re.search(rx, txt)
        if mm:
            q[chave] = json.loads(mm.group(1)) if chave == "histograma" else float(mm.group(1))
    janelas = []
    with open(ns, encoding="utf-8", errors="replace", newline="") as fh:
        for r in csv.DictReader(fh):
            try:
                gt = float(r["game.time"])
                if gt < 1:
                    continue          # tela de carregamento
                fim = relogio + dt.timedelta(seconds=gt)    # game.time = FIM da janela (medido em 15/10/2026)
                dur = float(r.get("stats.duration") or 10)
                janelas.append({"fim": fim.isoformat(timespec="milliseconds"), "jogo_s": round(gt, 1),
                                "dur": round(dur, 2), "rtt": round(float(r["network.rtt_average"]) * 1000),
                                "jitter": round(float(r["network.rtt_jitter"]) * 1000),
                                "perdidos": int(float(r.get("network.packets_lost") or 0)),
                                "reenviados": int(float(r.get("network.messages_resent") or 0)),
                                "recebidos": int(float(r.get("network.packets_received") or 0)),
                                "adaptador": r.get("network.adapter") or ""})
            except (KeyError, ValueError):
                continue
    if janelas:
        med = statistics.median(j["recebidos"] for j in janelas) or 1
        for j in janelas:
            j["sem_pacote_s"] = round(max(0.0, (med - j["recebidos"]) / med * j["dur"]), 1)
    return {"pasta": str(pasta), "partida": gid.group(1) if gid else None,
            "relogio_zero": relogio.isoformat(timespec="milliseconds"), "quadros": q, "janelas": janelas}


EVENTOS_WLAN = {8001: "Wi-Fi conectou", 8003: "Wi-Fi desconectou", 11004: "Wi-Fi: segurança do link interrompida",
                11005: "Wi-Fi: segurança refeita", 11010: "Wi-Fi: segurança reiniciando"}


def eventos_wlan(desde, ate):
    """eventos do WLAN-AutoConfig entre `desde` e `ate` (hora local) -> [(iso, id, texto)]"""
    ms = int((dt.datetime.now() - desde).total_seconds() * 1000) + 60000
    ids = " or ".join(f"EventID={i}" for i in EVENTOS_WLAN)
    q = f"*[System[({ids}) and TimeCreated[timediff(@SystemTime) <= {ms}]]]"
    try:
        out = subprocess.run(["wevtutil", "qe", "Microsoft-Windows-WLAN-AutoConfig/Operational", f"/q:{q}",
                              "/f:xml", "/c:500"], capture_output=True, timeout=30,
                             creationflags=CREATE_NO_WINDOW).stdout.decode("utf-8", "replace")
    except Exception:
        return []
    return ler_eventos_xml(out, desde, ate)


def ler_eventos_xml(xml, desde, ate):
    out = []
    for ev in re.findall(r"<Event .*?</Event>", xml, re.S):
        i = re.search(r"<EventID[^>]*>(\d+)</EventID>", ev)
        t = re.search(r"SystemTime='([^']+)'", ev)
        if not i or not t:
            continue
        utc = dt.datetime.fromisoformat(t.group(1)[:19] + "+00:00")     # 7 casas decimais: corta no segundo
        local = utc.astimezone().replace(tzinfo=None)
        if desde <= local <= ate:
            out.append([local.isoformat(timespec="seconds"), int(i.group(1)), EVENTOS_WLAN.get(int(i.group(1)), "")])
    return sorted(out)


# ---------------------------------------------------------------- medição

def eventos_da_amostra(a, pingers_respondem):
    ev = []
    for nome, ms in (a.get("ping") or {}).items():
        if ms is not None and ms > LIMIAR_PING_MS:
            ev.append(f"ping {nome} {ms} ms")
        elif ms is None and pingers_respondem.get(nome):
            ev.append(f"ping {nome} sem resposta")
    if a.get("cpu") is not None and a["cpu"] > LIMIAR_CPU:
        ev.append(f"cpu {a['cpu']:.0f}%")
    return ev


def _arquivo_padrao():
    return DADOS / f"travadas-{dt.date.today().isoformat()}.jsonl"


def _limpar_antigos(pasta=DADOS):
    limite = time.time() - GUARDAR_DIAS * 86400
    for f in list(pasta.glob("travadas-*.jsonl")) + list(pasta.glob("travadas-*.txt")):
        try:
            if f.stat().st_mtime < limite:
                f.unlink()
        except OSError:
            pass


def _prioridade_baixa():
    try:
        k = ctypes.windll.kernel32
        k.SetPriorityClass(k.GetCurrentProcess(), 0x4000)    # BELOW_NORMAL_PRIORITY_CLASS
    except Exception:
        pass


def _cpu_propria_s():
    c, e, k, u = (wt.FILETIME() for _ in range(4))
    k32 = ctypes.windll.kernel32
    k32.GetCurrentProcess.restype = wt.HANDLE
    if not k32.GetProcessTimes(wt.HANDLE(k32.GetCurrentProcess()), ctypes.byref(c), ctypes.byref(e),
                               ctypes.byref(k), ctypes.byref(u)):
        return None

    def ft(f):
        return (f.dwHighDateTime << 32 | f.dwLowDateTime) / 1e7
    return ft(k) + ft(u)


def medir(saida=None, partida=None, segundos=None, sem_jogo=False, gamelogs=None, escrever_resumo=True):
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateMutexW.restype = wt.HANDLE
    k32.CreateMutexW.argtypes = [ctypes.c_void_p, wt.BOOL, wt.LPCWSTR]
    k32.CloseHandle.argtypes = [wt.HANDLE]
    mutex = k32.CreateMutexW(None, False, MUTEX)
    if ctypes.get_last_error() == 183:      # ERROR_ALREADY_EXISTS: um medidor por vez (Reconnect -> InProgress de novo)
        k32.CloseHandle(mutex)
        print("medidor já rodando: saindo")
        return None
    _prioridade_baixa()
    DADOS.mkdir(exist_ok=True)
    _limpar_antigos()
    saida = Path(saida or _arquivo_padrao())
    sinal_parar = DADOS / "medidor-travadas.parar"
    try:
        sinal_parar.unlink()
    except OSError:
        pass
    parar = threading.Event()
    inicio = time.time()
    gw = gateway_padrao()
    pingers = {}

    def ligar(nome, ip):
        if ip and nome not in pingers:
            pingers[nome] = Pinger(nome, ip, parar)
            pingers[nome].start()

    ligar("gateway", gw)
    ligar("externo", EXTERNO)
    wifi = Wifi(parar)
    wifi.start()
    pdh = Pdh()
    procs = Processos()
    destinos = {"gateway": gw, "externo": EXTERNO}
    fh = open(saida, "a", encoding="utf-8")

    trava = threading.Lock()      # o fio do traçado também grava (linha "saltos")

    def gravar(d):
        with trava:
            fh.write(json.dumps(d, ensure_ascii=False, separators=(",", ":")) + "\n")
            fh.flush()

    gravar({"tipo": "inicio", "t": agora_iso(), "partida": partida, "destinos": destinos, "versao": 1,
            "limiares": {"ping_ms": LIMIAR_PING_MS, "cpu": LIMIAR_CPU}})
    servidor, proxima_busca, tracando = None, 0.0, None
    jogo_visto, sem_jogo_desde, ult_top, wifi_ant = False, None, 0.0, None
    motivo = "?"
    proximo = time.monotonic()
    try:
        while True:
            proximo += 1.0
            espera = proximo - time.monotonic()
            atraso = 0.0
            if espera > 0:
                time.sleep(espera)
                atraso = time.monotonic() - proximo      # acordou tarde: o Windows não deu CPU ao medidor
            else:
                atraso = -espera                          # a volta anterior passou de 1 s
                proximo = time.monotonic()
            t_volta = time.monotonic()
            agora = time.time()
            # servidor da partida: pelo netstats da pasta nova; depois, os saltos até ele (1 vez, em outro fio)
            if servidor is None and agora >= proxima_busca:
                proxima_busca = agora + 10
                # só a pasta MAIS NOVA: sem o netstats dela ainda, espera (a anterior é de outra partida/servidor)
                for p in pastas_da_partida(dt.datetime.fromtimestamp(inicio), base=gamelogs)[-1:]:
                    s = servidor_da_pasta(p)
                    if s:
                        servidor = s
                        destinos["servidor"] = f"{s[0]}:{s[1]}"
                        ligar("servidor", s[0])

                        def _tracar(ip=s[0]):
                            sal = tracar(ip)
                            prov, cam = escolher_saltos(sal, gw)
                            ligar("provedor", prov)
                            ligar("caminho", cam)
                            destinos.update({"provedor": prov, "caminho": cam})
                            gravar({"tipo": "saltos", "t": agora_iso(), "saltos": sal, "provedor": prov,
                                    "caminho": cam, "servidor": destinos["servidor"]})
                        tracando = threading.Thread(target=_tracar, daemon=True, name="tracar")
                        tracando.start()
                        break
            cpu, disco, rede = pdh.ler()
            a = {"tipo": "a", "t": agora_iso(agora), "cpu": cpu, "disco": disco, "rede": rede,
                 "ping": {n: (p.ultimo[1] if p.ultimo and agora - p.ultimo[0] < 2.5 else None)
                          for n, p in list(pingers.items())}}     # list: o fio do traçado liga pingers
            if agora - ult_top >= TOP_CADA_S or not jogo_visto:
                top_c, top_i, jogo, cpu_jogo = procs.ler()
                ult_top = agora
                a.update({"top_cpu": top_c, "top_io": top_i, "jogo_cpu": cpu_jogo})
                if jogo:
                    jogo_visto, sem_jogo_desde = True, None
                elif jogo_visto and sem_jogo_desde is None:
                    sem_jogo_desde = agora
            w = wifi.ultimo
            if w and w != wifi_ant:
                a["wifi"] = w
                if wifi_ant and w.get("bssid") != wifi_ant.get("bssid"):
                    a.setdefault("marcas", []).append("Wi-Fi trocou de ponto de acesso (BSSID)")
                if wifi_ant and w.get("canal") != wifi_ant.get("canal"):
                    a.setdefault("marcas", []).append(f"Wi-Fi trocou de canal ({wifi_ant.get('canal')} -> {w.get('canal')})")
                wifi_ant = w
            trab = time.monotonic() - t_volta
            if atraso >= 0.3:
                a["atraso_s"] = round(atraso, 2)
            if trab >= 0.3:
                a["trab_s"] = round(trab, 2)
            ev = eventos_da_amostra(a, {n: p.responde() for n, p in list(pingers.items())})
            if atraso >= 1.5:     # prioridade abaixo do normal: atraso grande = CPU sem folga (o próprio sinal)
                ev.append(f"medidor atrasado {atraso:.1f} s (PC sem folga)")
            if ev:
                a["evento"] = ev
            gravar(a)
            if sinal_parar.exists():
                motivo = "pedido de parar"
                break
            if segundos is not None and agora - inicio >= segundos:
                motivo = f"{segundos:g} s"
                break
            if not sem_jogo and segundos is None:
                if sem_jogo_desde and agora - sem_jogo_desde >= FIM_SEM_JOGO_S:
                    motivo = "jogo fechou"
                    break
                if not jogo_visto and agora - inicio >= ESPERA_JOGO_S:
                    motivo = "o jogo não abriu em 5 min"
                    break
            if agora - inicio >= TETO_S:
                motivo = "teto de 2 h"
                break
    except KeyboardInterrupt:
        motivo = "interrompido"
    finally:
        parar.set()
        try:
            pdh.fechar()
        except Exception:
            pass
        cpu_s = _cpu_propria_s()
        dur = time.time() - inicio
        gravar({"tipo": "fim", "t": agora_iso(), "motivo": motivo, "duracao_s": round(dur),
                "custo_cpu_s": round(cpu_s, 1) if cpu_s is not None else None,
                "custo_cpu_pct": round(cpu_s / dur / (os.cpu_count() or 1) * 100, 2) if cpu_s and dur else None,
                "wifi_erro": wifi.erro})
        fh.close()
        try:
            sinal_parar.unlink()
        except OSError:
            pass
        k32.CloseHandle(mutex)
    if escrever_resumo:
        if motivo == "jogo fechou":
            time.sleep(5)        # o r3dlog escreve FPS e quadros ao fechar
        return resumir_arquivo(saida, gamelogs=gamelogs)
    return saida


# ---------------------------------------------------------------- resumo

def ler_sessoes(arq):
    sessoes, atual = [], None
    with open(arq, encoding="utf-8") as fh:
        for linha in fh:
            try:
                d = json.loads(linha)
            except ValueError:
                continue
            if d.get("tipo") == "inicio":
                atual = {"inicio": d, "amostras": [], "saltos": None, "fim": None}
                sessoes.append(atual)
            elif atual is not None:
                if d.get("tipo") == "a":
                    atual["amostras"].append(d)
                elif d.get("tipo") == "saltos":
                    atual["saltos"] = d
                elif d.get("tipo") == "fim":
                    atual["fim"] = d
    return sessoes


def _pct(v, p):
    v = sorted(v)
    return v[min(len(v) - 1, int(round(p / 100 * (len(v) - 1))))] if v else None


def bases(amostras):
    """mediana de cada destino de ping (a "linha de base" para dizer o que é alto)"""
    vals = {}
    for a in amostras:
        for n, ms in (a.get("ping") or {}).items():
            vals.setdefault(n, []).append(ms)
    out = {}
    for n, v in vals.items():
        ok = [x for x in v if x is not None]
        out[n] = {"mediana": statistics.median(ok) if ok else None, "p95": _pct(ok, 95), "max": max(ok) if ok else None,
                  "sem_resposta_pct": round(100 * (len(v) - len(ok)) / len(v), 1) if v else None, "n": len(v)}
    return out


def _alto(ms, base, respondia=True):
    if ms is None:
        return respondia
    b = base if base is not None else 10
    return ms >= max(b * 3, b + 50)


def _amostras_entre(amostras, ini, fim):
    return [a for a in amostras if ini <= _iso(a["t"]) <= fim]


def _rede_kbs(a):
    return sum(rx + tx for rx, tx in (a.get("rede") or {}).values())


def classificar(trecho, bs):
    """trecho = amostras do momento -> (classe, explicação curta). Ordem: Wi-Fi da casa, provedor, PC, Riot"""
    if not trecho:
        return "sem_medida", "sem amostra do medidor nesse momento"
    def pior(nome):
        v = [a["ping"].get(nome) for a in trecho if nome in (a.get("ping") or {})]
        if not v:
            return None, False
        resp = bs.get(nome, {}).get("sem_resposta_pct")
        respondia = resp is not None and resp < 10
        altos = [x for x in v if _alto(x, bs.get(nome, {}).get("mediana"), respondia)]
        ok = [x for x in v if x is not None]
        return (max(ok) if ok else None), bool(altos)
    gw, gw_alto = pior("gateway")
    prov, prov_alto = pior("provedor")
    cam, cam_alto = pior("caminho")
    ext, ext_alto = pior("externo")
    cpu = max((a.get("cpu") or 0) for a in trecho)
    rede = max(_rede_kbs(a) for a in trecho)
    extra = f"; havia {rede / 1024:.1f} MB/s de rede no PC (algo competindo)" if rede >= UPLOAD_ALTO_KBS else ""
    if gw_alto:
        return "wifi", f"o roteador já respondeu devagar ({gw if gw is not None else 'sem resposta'} ms): Wi-Fi da casa{extra}"
    if prov_alto or cam_alto or ext_alto:
        return "provedor", (f"roteador normal ({gw} ms), atraso depois dele (provedor {prov}, caminho {cam}, "
                            f"externo {ext} ms): internet/provedor{extra}")
    if cpu > LIMIAR_CPU:
        return "pc", f"rede normal e CPU em {cpu:.0f}%: PC sobrecarregado"
    atraso = max((a.get("atraso_s") or 0) for a in trecho)
    if atraso >= 1.5:
        return "pc", f"rede normal e o medidor ficou {atraso:.1f} s sem CPU: PC sem folga"
    return "riot", (f"roteador ({gw}), provedor ({prov}) e caminho ({cam} ms) normais: o atraso ficou depois do "
                    f"provedor ou no servidor da Riot{extra}")


def episodios(amostras, juntar_s=2):
    """amostras com evento, juntas quando a distância é <= juntar_s"""
    eps, atual = [], None
    for a in amostras:
        if not a.get("evento"):
            continue
        t = _iso(a["t"])
        if atual and (t - atual["fim"]).total_seconds() <= juntar_s + 1:
            atual["fim"] = t
            atual["amostras"].append(a)
        else:
            atual = {"ini": t, "fim": t, "amostras": [a]}
            eps.append(atual)
    return eps


TEXTO_CLASSE = {"wifi": "Wi-Fi da casa (entre o PC e o roteador)",
                "provedor": "internet/provedor (depois do roteador)",
                "pc": "o PC (CPU alta com a rede normal)",
                "riot": "trecho depois do provedor ou servidor da Riot",
                "sem_medida": "sem medida do medidor no momento"}


def resumir(sessao, riot=None, wlan=None):
    am = sessao["amostras"]
    bs = bases(am)
    eps = []
    for e in episodios(am):
        ctx = _amostras_entre(am, e["ini"] - dt.timedelta(seconds=1), e["fim"] + dt.timedelta(seconds=1))
        cls, porque = classificar(ctx, bs)
        pico = max(e["amostras"], key=lambda a: max([x for x in (a.get("ping") or {}).values() if x] or [0]))
        eps.append({"ini": e["ini"].isoformat(timespec="seconds"),
                    "dur_s": int((e["fim"] - e["ini"]).total_seconds()) + 1,
                    "eventos": sorted({x for a in e["amostras"] for x in a["evento"]})[:6],
                    "classe": cls, "porque": porque, "ping_no_pico": pico.get("ping"),
                    "cpu_max": max((a.get("cpu") or 0) for a in ctx),
                    "wifi": next((a["wifi"] for a in reversed(_amostras_entre(am, e["ini"] - dt.timedelta(seconds=10),
                                                                              e["fim"])) if a.get("wifi")), None),
                    "top_cpu": next((a["top_cpu"] for a in ctx if a.get("top_cpu")), None),
                    "top_io": next((a["top_io"] for a in ctx if a.get("top_io")), None)})
    picos_riot = []
    if riot:
        for j in riot["janelas"]:
            if j["rtt"] < LIMIAR_RIOT_MS and not j["perdidos"]:
                continue
            fim = _iso(j["fim"])
            ctx = _amostras_entre(am, fim - dt.timedelta(seconds=j["dur"]), fim)
            cls, porque = classificar(ctx, bs)
            picos_riot.append({**j, "classe": cls, "porque": porque})
    classes = [p["classe"] for p in picos_riot if p["classe"] != "sem_medida"] or \
              [e["classe"] for e in eps if e["classe"] != "sem_medida"]
    contagem = {c: classes.count(c) for c in sorted(set(classes), key=lambda c: -classes.count(c))}
    cpus = [a["cpu"] for a in am if a.get("cpu") is not None]
    trocas = [(a["t"], m) for a in am for m in a.get("marcas", [])]
    sinais = [a["wifi"].get("sinal") for a in am if a.get("wifi") and a["wifi"].get("sinal") is not None]
    return {"tipo": "resumo", "t": agora_iso(), "inicio": sessao["inicio"]["t"],
            "fim": (sessao["fim"] or {}).get("t") or (am[-1]["t"] if am else None),
            "partida": sessao["inicio"].get("partida") or (riot or {}).get("partida"),
            "destinos": {**sessao["inicio"].get("destinos", {}), **{k: v for k, v in (sessao.get("saltos") or {}).items()
                                                                   if k in ("provedor", "caminho", "servidor")}},
            "amostras": len(am), "pings": bs,
            "cpu": {"p95": _pct(cpus, 95), "max": max(cpus) if cpus else None},
            "wifi_sinal_min": min(sinais) if sinais else None, "wifi_trocas": trocas,
            "episodios": eps, "picos_riot": picos_riot, "contagem": contagem,
            "veredito": next(iter(contagem), None),
            "quadros": (riot or {}).get("quadros"), "wlan": wlan or [],
            "custo": {k: (sessao["fim"] or {}).get(k) for k in ("duracao_s", "custo_cpu_s", "custo_cpu_pct")}}


def _hora(iso):
    return iso[11:19] if iso else "?"


def texto_resumo(r):
    L = [f"Medidor de travadas: {_hora(r['inicio'])} a {_hora(r['fim'])} de {r['inicio'][:10]}"
         f" (partida {r.get('partida') or '?'}, {r['amostras']} amostras de 1 s)", ""]
    v = r.get("veredito")
    if v:
        L.append(f"VEREDITO: a maior parte dos picos veio de {TEXTO_CLASSE[v]}.")
        L.append("  contagem: " + ", ".join(f"{TEXTO_CLASSE[c]} = {n}" for c, n in r["contagem"].items()))
    else:
        L.append("VEREDITO: nenhum pico nesta medição (ping e CPU dentro do normal).")
    L += ["", "Linha de base (mediana / p95 / pior, ms; % sem resposta):"]
    for n, b in r["pings"].items():
        L.append(f"  {NOMES.get(n, n)}: {b['mediana']} / {b['p95']} / {b['max']}  ({b['sem_resposta_pct']}%)")
    c = r["cpu"]
    L.append(f"  CPU total: p95 {c['p95']}%, pior {c['max']}%; sinal do Wi-Fi mais baixo: {r['wifi_sinal_min']}%")
    q = r.get("quadros") or {}
    if q:
        L.append(f"  jogo: {q.get('fps')} fps de média, pior quadro {q.get('quadro_max_ms')} ms"
                 " (imagem travada de verdade = quadros de centenas de ms)")
    if r["picos_riot"]:
        L += ["", f"Picos que o JOGO viu (janelas de 10 s com RTT >= {LIMIAR_RIOT_MS} ms ou pacote perdido):"]
        for p in r["picos_riot"]:
            L.append(f"  {_hora(p['fim'])} (jogo {int(p['jogo_s'] // 60)}:{int(p['jogo_s'] % 60):02d}): RTT {p['rtt']} ms,"
                     f" ~{p['sem_pacote_s']} s sem pacote, perdidos {p['perdidos']} -> {TEXTO_CLASSE[p['classe']]}:"
                     f" {p['porque']}")
    if r["episodios"]:
        L += ["", "Momentos que o medidor marcou (ping > 150 ms, sem resposta ou CPU > 90%):"]
        for e in r["episodios"][:40]:
            L.append(f"  {_hora(e['ini'])} por {e['dur_s']} s: {', '.join(e['eventos'])} -> {TEXTO_CLASSE[e['classe']]}")
            if e.get("top_cpu"):
                L.append("      CPU: " + ", ".join(f"{n} {p}%" for n, p in e["top_cpu"][:3]))
            if e.get("top_io"):
                L.append("      I/O (arquivo+rede): " + ", ".join(f"{n} {k} KB/s" for n, k in e["top_io"][:3]))
    if r["wlan"] or r["wifi_trocas"]:
        L += ["", "Wi-Fi no Windows:"]
        L += [f"  {_hora(t)} {txt} ({i})" for t, i, txt in r["wlan"]]
        L += [f"  {_hora(t)} {m}" for t, m in r["wifi_trocas"]]
    cu = r.get("custo") or {}
    if cu.get("custo_cpu_s") is not None:
        L += ["", f"Custo do medidor: {cu['custo_cpu_s']} s de CPU em {cu['duracao_s']} s ({cu['custo_cpu_pct']}% da máquina)."]
    L += ["", "Como ler: roteador lento junto = Wi-Fi da casa; roteador normal e o resto lento = internet/provedor;"
          " tudo normal e só o jogo lento = depois do provedor (Riot). Docs: docs/COLETOR.md § Medidor de travadas."]
    return "\n".join(L) + "\n"


def resumir_arquivo(arq, sessao=-1, gamelogs=None, wlan=True):
    arq = Path(arq)
    ss = ler_sessoes(arq)
    if not ss:
        print(f"nenhuma medição em {arq}")
        return None
    s = ss[sessao]
    ini = _iso(s["inicio"]["t"])
    fim = _iso((s["fim"] or {}).get("t") or (s["amostras"][-1]["t"] if s["amostras"] else s["inicio"]["t"]))
    riot = None
    for p in reversed(pastas_da_partida(ini, fim, base=gamelogs)):
        x = ler_partida_riot(p)
        if x and any(ini <= _iso(j["fim"]) <= fim + dt.timedelta(seconds=15) for j in x["janelas"]):
            riot = x      # a partida que de fato cruzou a medição (pasta velha de outra partida fica fora)
            break
    ev = eventos_wlan(ini, fim) if wlan else []
    r = resumir(s, riot, ev)
    with open(arq, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n")
    txt = arq.with_name(f"{arq.stem}-{ini.strftime('%H%M')}.txt")
    txt.write_text(texto_resumo(r), encoding="utf-8")
    print(f"resumo: {txt}")
    return r


def main(argv=None):
    ap = argparse.ArgumentParser(description="medidor de travadas na partida (rede, Wi-Fi, CPU, disco)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    m = sub.add_parser("medir")
    m.add_argument("--partida")
    m.add_argument("--segundos", type=float)
    m.add_argument("--sem-jogo", action="store_true", help="não espera nem segue o processo do jogo")
    m.add_argument("--saida")
    m.add_argument("--gamelogs")
    sub.add_parser("parar")
    r = sub.add_parser("resumo")
    r.add_argument("--jsonl")
    r.add_argument("--sessao", type=int, default=-1)
    r.add_argument("--gamelogs")
    a = ap.parse_args(argv)
    if sys.stdout is None or sys.stderr is None:     # pythonw: print sem console
        sys.stdout = sys.stderr = open(os.devnull, "w")
    if a.cmd == "medir":
        try:
            medir(a.saida, a.partida, a.segundos, a.sem_jogo, a.gamelogs)
        except Exception:      # no pythonw não há stderr: o erro fica num arquivo (sem segredo: só a pilha)
            import traceback
            DADOS.mkdir(exist_ok=True)
            with open(DADOS / "medidor-travadas-erro.log", "a", encoding="utf-8") as fh:
                fh.write(f"{agora_iso()}\n{traceback.format_exc()}\n")
            return 1
    elif a.cmd == "parar":
        DADOS.mkdir(exist_ok=True)
        (DADOS / "medidor-travadas.parar").write_text(agora_iso(), encoding="utf-8")
        print("pedido de parar gravado: o medidor fecha em até 1 s e escreve o resumo")
    else:
        arq = a.jsonl or max(DADOS.glob("travadas-*.jsonl"), default=None, key=lambda f: f.stat().st_mtime)
        if not arq:
            print("nenhuma medição em dados/")
            return 1
        resumir_arquivo(arq, a.sessao, a.gamelogs)
    return 0


if __name__ == "__main__":
    sys.exit(main())
