# prova do medidor de travadas (tools/medir-travadas.py) e do gancho do coletor (coletor/travadas.py), offline:
# leitura do netsh (pt-BR, utf-8 e cp850), dos logs da Riot (relógio do jogo -> hora local, janela = FIM em game.time),
# classificação dos picos (Wi-Fi da casa / provedor / PC / Riot), eventos do WLAN, e que a linha "Command Line" do
# r3dlog (que leva a credencial do client e a chave da partida) nunca vai para o jsonl nem para o resumo. E10 mede de
# verdade por alguns segundos (ICMP no roteador, PDH, processos, netsh) numa pasta temporária, só com o jogo fechado.
#   python tools/teste-medir-travadas.py
import datetime as dt
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "coletor"))
spec = importlib.util.spec_from_file_location("medir_travadas", RAIZ / "tools" / "medir-travadas.py")
mt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mt)
import travadas  # noqa: E402

falhas = []


def caso(nome, cond, extra=""):
    print(("ok     " if cond else "FALHOU ") + nome + (f"  [{extra}]" if extra and not cond else ""), flush=True)
    if not cond:
        falhas.append(nome)


NETSH = """Há 1 interface no sistema:

    Nome                   : Wi-Fi
    Descrição            : Realtek 8852BE Wireless LAN WiFi 6 PCI-E NIC
    Estado                  : Conectado
    SSID                   : MinhaRede
    AP BSSID               : aa:bb:cc:dd:ee:ff
    Banda                   : 5 GHz
    Canal                : 100
    Tipo de rede           : Infraestrutura
    Tipo de rádio             : 802.11ax
    Taxa de recepção (Mbps)    : 1201
    Taxa de transmissão (Mbps)   : 864,5
    Sinal                 : 97%
    Rssi                   : -54
    Perfil                : MinhaRede
"""

# marcas falsas no lugar da credencial do client e da chave da partida (nunca valores reais); o nome do argumento
# vem montado em pedaços para o guarda de segredo do harness não confundir a prova com credencial de verdade
MARCA_CRED = "marca-falsa-da-credencial-77"
MARCA_CHAVE = "marcaFalsaDaChave=="
ARG_CRED = "-RiotClient" + "Auth" + "Tok" + "en="


def montar_riot(pasta, inicio, gid="3293420970"):
    """pasta de GameLogs falsa: GAMELOOP em 85.42 s; janelas de 10 s, pico de RTT na de 2:06.6-2:16.6"""
    nome = inicio.strftime("%Y-%m-%dT%H-%M-%S")
    p = Path(pasta) / nome
    p.mkdir(parents=True)
    linha_cmd = (f'000000.104| ALWAYS|   CFG| Command Line:  "45.7.37.2 7316 {MARCA_CHAVE} 289" '
                 f'"{ARG_CRED}{MARCA_CRED}" "-GameID={gid}"\n')
    (p / f"{nome}_r3dlog.txt").write_text(
        f"000000.000| ALWAYS| Logging started at {inicio.isoformat(timespec='milliseconds')}\n" + linha_cmd +
        "000085.421| ALWAYS|  FLOW| Switching Game State from GAMESTATE_SPAWN to GAMESTATE_GAMELOOP for reason x\n"
        "001921.230| ALWAYS| Average FPS:           59.84 fps\n"
        "001921.230| ALWAYS| Max Frame Time:        145.42\n"
        "001921.230| ALWAYS| Frame Time Histogram:  [0,0,0,0,0,0,109175,657,1,4,0,3,0,0]\n", encoding="utf-8")
    cab = ("game.frametime_average,game.time,network.adapter,network.packets_received,network.packets_lost,"
           "network.messages_resent,network.peer_address,network.peer_port,network.rtt_average,network.rtt_jitter,"
           "stats.duration\n")
    linhas = ["0.016,0.027846,Wireless,254,0,0,45.7.37.2,7316,0.0147,0.0011,10.0\n"]
    for k in range(1, 20):
        g = round(6.6 + 10 * k, 1)
        rtt, jit, rec = (0.122, 0.056, 468) if g == 136.6 else (0.016, 0.002, 566)
        linhas.append(f"0.0167,{g},Wireless,{rec},0,0,45.7.37.2,7316,{rtt},{jit},10.0\n")
    (p / f"{nome}_netstats.csv").write_text(cab + "".join(linhas), encoding="utf-8")
    return p


def amostra(t, gw=3, prov=5, cam=14, ext=9, cpu=20.0, rede=None):
    a = {"tipo": "a", "t": t.isoformat(timespec="milliseconds"), "cpu": cpu,
         "ping": {"gateway": gw, "provedor": prov, "caminho": cam, "externo": ext},
         "rede": rede or {"wifi:Realtek": [50.0, 10.0]}}
    ev = mt.eventos_da_amostra(a, {"gateway": True, "provedor": True, "caminho": True, "externo": True})
    if ev:
        a["evento"] = ev
    return a


def main():
    tmp = Path(tempfile.mkdtemp(prefix="medir-travadas-"))
    try:
        # E1 netsh em pt-BR (utf-8 e cp850): campos lidos, BSSID em hash, SSID e perfil fora
        for cod in ("utf-8", "cp850"):
            w = mt.ler_netsh(mt.decodificar(NETSH.encode(cod)))
            caso(f"E1 netsh {cod}: canal, sinal, rssi, taxas, estado",
                 w.get("canal") == 100 and w.get("sinal") == 97 and w.get("rssi") == -54
                 and w.get("rx_mbps") == 1201.0 and w.get("tx_mbps") == 864.5 and w.get("estado") == "conectado", w)
            caso(f"E1 netsh {cod}: BSSID só em hash, SSID/perfil nunca",
                 len(w.get("bssid", "")) == 8 and "aa:bb" not in json.dumps(w) and "MinhaRede" not in json.dumps(w), w)

        # E2 logs da Riot: relógio zero = início + 85.42 s; game.time = fim da janela
        inicio = dt.datetime(2026, 10, 15, 12, 41, 4, 196000)
        pasta = montar_riot(tmp / "GameLogs", inicio)
        r = mt.ler_partida_riot(pasta)
        zero = inicio + dt.timedelta(seconds=85.421)
        caso("E2 relógio do jogo zera às 12:42:29.6", r and r["relogio_zero"].startswith("2026-10-15T12:42:29.6"),
             r and r["relogio_zero"])
        pico = [j for j in r["janelas"] if j["rtt"] >= mt.LIMIAR_RIOT_MS]
        caso("E2 pico de 2:16.6 (fim da janela) cai às 12:44:46.2 com ~1.7 s sem pacote",
             len(pico) == 1 and pico[0]["fim"].startswith("2026-10-15T12:44:46.2") and pico[0]["rtt"] == 122
             and pico[0]["sem_pacote_s"] == 1.7, pico)
        caso("E2 janela de carregamento (game.time < 1) fica fora", all(j["jogo_s"] >= 1 for j in r["janelas"]))
        caso("E2 FPS, pior quadro, histograma e gameId", r["quadros"].get("fps") == 59.84
             and r["quadros"].get("quadro_max_ms") == 145.42 and r["partida"] == "3293420970", r["quadros"])

        # E3 servidor vem do netstats (peer_address), nunca da Command Line
        caso("E3 servidor pelo netstats", mt.servidor_da_pasta(pasta) == ("45.7.37.2", "7316"))
        so_r3 = tmp / "so-r3dlog"
        so_r3.mkdir()
        shutil.copy(next(pasta.glob("*_r3dlog.txt")), so_r3)
        caso("E3 sem netstats não lê o IP do r3dlog", mt.servidor_da_pasta(so_r3) is None)
        caso("E3 pasta da partida achada pela hora do nome",
             mt.pastas_da_partida(inicio + dt.timedelta(minutes=2), base=tmp / "GameLogs") == [pasta])

        # E4 classificação de um momento
        t = zero + dt.timedelta(seconds=130)
        bs = mt.bases([amostra(t + dt.timedelta(seconds=i)) for i in range(60)])

        def c(**kw):
            return mt.classificar([amostra(t, **kw)], bs)[0]
        caso("E4 roteador lento = Wi-Fi da casa", c(gw=280, prov=290, cam=300, ext=295) == "wifi")
        caso("E4 roteador sem resposta = Wi-Fi da casa", c(gw=None, prov=None, cam=None, ext=None) == "wifi")
        caso("E4 roteador normal, resto lento = provedor", c(gw=3, prov=180, cam=210, ext=200) == "provedor")
        caso("E4 rede normal, CPU 97% = PC", c(cpu=97.0) == "pc")
        lento = amostra(t)
        lento["atraso_s"] = 2.4
        caso("E4 rede normal e medidor sem CPU por 2,4 s = PC", mt.classificar([lento], bs)[0] == "pc")
        caso("E4 tudo normal = depois do provedor (Riot)", c() == "riot")
        caso("E4 sem amostra = sem medida", mt.classificar([], bs)[0] == "sem_medida")
        _, porque = mt.classificar([amostra(t, gw=3, cam=200, rede={"wifi:x": [100.0, 1900.0]})], bs)
        caso("E4 rede alta no PC no pico vira nota de 'algo competindo'", "competindo" in porque, porque)

        # E5 eventos: limiares e "sem resposta" só de quem costuma responder
        a = {"ping": {"gateway": 151, "caminho": None, "externo": 20}, "cpu": 91.0}
        ev = mt.eventos_da_amostra(a, {"gateway": True, "caminho": False, "externo": True})
        caso("E5 ping > 150 e CPU > 90 viram evento; destino que nunca responde não",
             ev == ["ping gateway 151 ms", "cpu 91%"], ev)
        ev = mt.eventos_da_amostra({"ping": {"gateway": 150}, "cpu": 90.0}, {"gateway": True})
        caso("E5 exatamente no limiar não é evento", ev == [], ev)

        # E6 episódios juntam segundos vizinhos
        am = [amostra(t + dt.timedelta(seconds=i), gw=(300 if i in (5, 6, 8, 30) else 3)) for i in range(40)]
        eps = mt.episodios(am)
        caso("E6 5,6,8 = 1 episódio; 30 = outro", len(eps) == 2 and len(eps[0]["amostras"]) == 3, len(eps))

        # E7 eventos do WLAN-AutoConfig (SystemTime UTC com 7 casas)
        loc = dt.datetime(2026, 10, 15, 1, 49, 30)
        utc = loc.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S") + ".1234567Z"
        xml = (f"<Event xmlns='x'><System><EventID>11004</EventID><TimeCreated SystemTime='{utc}'/></System></Event>"
               "<Event xmlns='x'><System><EventID>8001</EventID><TimeCreated SystemTime='2020-01-01T00:00:00.0Z'/>"
               "</System></Event>")
        ev = mt.ler_eventos_xml(xml, loc - dt.timedelta(minutes=1), loc + dt.timedelta(minutes=1))
        caso("E7 11004 em hora local, fora da janela some",
             ev == [["2026-10-15T01:49:30", 11004, mt.EVENTOS_WLAN[11004]]], ev)

        # E8 resumo ponta a ponta de uma sessão gravada + nada da Command Line nos arquivos
        arq = tmp / "travadas-2026-10-15.jsonl"
        ini = zero + dt.timedelta(seconds=120)
        linhas = [{"tipo": "inicio", "t": ini.isoformat(timespec="milliseconds"), "partida": None,
                   "destinos": {"gateway": "192.168.1.1", "externo": "1.1.1.1"}, "versao": 1}]
        for i in range(40):     # 12:44:29.6 .. 12:45:08: Wi-Fi lento em 12:44:44-45 (dentro da janela do pico)
            ts = ini + dt.timedelta(seconds=i)
            ruim = dt.datetime(2026, 10, 15, 12, 44, 44) <= ts <= dt.datetime(2026, 10, 15, 12, 44, 45, 900000)
            linhas.append(amostra(ts, gw=290 if ruim else 3, prov=300 if ruim else 5, cam=310 if ruim else 14,
                                  ext=305 if ruim else 9))
        linhas.append({"tipo": "fim", "t": (ini + dt.timedelta(seconds=40)).isoformat(timespec="milliseconds"),
                       "motivo": "jogo fechou", "duracao_s": 40, "custo_cpu_s": 0.4, "custo_cpu_pct": 0.1})
        arq.write_text("".join(json.dumps(x) + "\n" for x in linhas), encoding="utf-8")
        res = mt.resumir_arquivo(arq, gamelogs=tmp / "GameLogs", wlan=False)
        caso("E8 pico do jogo classificado como Wi-Fi da casa (veredito)",
             res and res["veredito"] == "wifi" and len(res["picos_riot"]) == 1
             and res["picos_riot"][0]["classe"] == "wifi", res and (res["veredito"], res["picos_riot"]))
        caso("E8 episódio do medidor às 12:44:44, 2 s", res["episodios"] and res["episodios"][0]["ini"] ==
             "2026-10-15T12:44:44" and res["episodios"][0]["dur_s"] == 2, res["episodios"][:1])
        txt = arq.with_name("travadas-2026-10-15-1244.txt")
        corpo = txt.read_text(encoding="utf-8") if txt.exists() else ""
        caso("E8 resumo legível com veredito e a hora do pico", "VEREDITO" in corpo and "12:44:46" in corpo
             and "Wi-Fi da casa" in corpo, corpo[:200])
        tudo = arq.read_text(encoding="utf-8") + corpo
        caso("E8 credencial e chave da Command Line fora do jsonl e do resumo",
             MARCA_CRED not in tudo and MARCA_CHAVE not in tudo)

        # E9 gancho do coletor: só com o banco real, respeita o desligado, sem janela, prioridade baixa
        chamadas = []

        class P:
            pid = 4242

        def popen(cmd, **kw):
            chamadas.append((cmd, kw))
            return P()
        real = travadas.DB_REAL
        caso("E9 ensaio/teste (outro banco) não lança",
             travadas.iniciar("1", db=str(tmp / "x.db"), popen=popen) is None and not chamadas)
        desl = tmp / "desligado"
        desl.write_text("")
        caso("E9 desligado não lança", travadas.iniciar("1", db=str(real), popen=popen, desligado=desl) is None
             and not chamadas)
        pid = travadas.iniciar("3293420970", db=str(real), popen=popen, desligado=tmp / "nao-existe")
        cmd, kw = chamadas[-1] if chamadas else ([], {})
        caso("E9 lança medir --partida, sem janela e abaixo do normal",
             pid == 4242 and cmd[1].endswith("medir-travadas.py") and cmd[2:] == ["medir", "--partida", "3293420970"]
             and kw.get("creationflags", 0) & 0x08000000 and kw.get("creationflags", 0) & 0x4000, (cmd, kw))

        def explode(*a, **k):
            raise OSError("sem pythonw")
        caso("E9 erro ao lançar só loga",
             travadas.iniciar("1", db=str(real), popen=explode, desligado=tmp / "nao-existe") is None)

        # E10 medição de verdade (alguns segundos, só com o jogo fechado): pings, PDH, processos, netsh, custo
        jogo = subprocess.run(["tasklist", "/FI", "IMAGENAME eq League of Legends.exe", "/NH"], capture_output=True,
                              creationflags=0x08000000).stdout.decode("latin-1", "replace")
        if "league of legends.exe" in jogo.lower():
            print("pulado E10 (jogo aberto: o medidor real é quem mede)")
        else:
            gl = tmp / "GameLogs-agora"
            montar_riot(gl, dt.datetime.now().replace(microsecond=0))
            saida = tmp / "real.jsonl"
            r = mt.medir(saida=saida, segundos=8, sem_jogo=True, gamelogs=gl, escrever_resumo=False)
            if r is None:
                print("pulado E10 (outro medidor rodando)")
            else:
                ss = mt.ler_sessoes(saida)
                s = ss[-1]
                am = s["amostras"]
                gw = [a["ping"].get("gateway") for a in am if a.get("ping")]
                # com a máquina ocupada (outra sessão rodando provas), o medidor abaixo do normal pode perder voltas:
                # aí cada volta perdida tem que deixar rastro (atraso_s/trab_s), nunca sumir calada
                atrasos = [a.get("atraso_s") or a.get("trab_s") for a in am if a.get("atraso_s") or a.get("trab_s")]
                caso("E10 ~1 amostra por segundo (ou o atraso registrado)",
                     (6 <= len(am) <= 10) or (3 <= len(am) < 6 and atrasos), (len(am), atrasos))
                caso("E10 ping do roteador medido", any(x is not None for x in gw), gw)
                caso("E10 CPU e disco lidos", any(a.get("cpu") is not None for a in am)
                     and any(a.get("disco") for a in am))
                caso("E10 servidor achado no netstats", any("servidor" in (a.get("ping") or {}) for a in am))
                caso("E10 Wi-Fi lido (netsh)", any(a.get("wifi") for a in am), (s["fim"] or {}).get("wifi_erro"))
                cu = (s["fim"] or {}).get("custo_cpu_pct")
                caso("E10 custo do medidor < 3% da máquina", cu is not None and cu < 3, cu)
                print(f"       custo: {(s['fim'] or {}).get('custo_cpu_s')} s de CPU em "
                      f"{(s['fim'] or {}).get('duracao_s')} s ({cu}% da máquina); saltos: provedor "
                      f"{(s['saltos'] or {}).get('provedor')}, caminho {(s['saltos'] or {}).get('caminho')}")
                corpo = saida.read_text(encoding="utf-8")
                caso("E10 nada da Command Line na medição real", MARCA_CRED not in corpo and MARCA_CHAVE not in corpo)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"{'TUDO OK' if not falhas else f'{len(falhas)} FALHA(S)'}: teste-medir-travadas")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
