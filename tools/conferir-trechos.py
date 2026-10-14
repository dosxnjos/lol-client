"""Confere trechos de áudio transcrevendo com o Whisper do Reco (plano voz pré-gravada, passo 6).

Roda no Python 3.14 do sistema (`py -3.14`), que já tem `openvino_genai` (o mesmo do C:\\Dev\\Reco), com o
modelo local `C:\\Dev\\Reco\\models\\whisper-small-int8-ov` no processador (CPU: o NPU leva minutos para
compilar na 1ª vez). Nada instalado, nada sai da máquina. O gerador do pacote
(`tools/gerar-pacote-voz.py`, no venv do TTS) abre este processo uma vez e conversa por linha:

    entrada (stdin):  ["c:/.../a.wav", "c:/.../b.wav"]      uma lista JSON por linha
    saída (stdout):   ["gank provável no top", "..."]       os textos, na mesma ordem

1ª linha da saída: {"pronto": true} ou {"pronto": false, "erro": "..."} (sem openvino ou sem modelo).
Também serve avulso: `py -3.14 tools/conferir-trechos.py a.wav b.wav` imprime um texto por linha.
"""
import json
import os
import subprocess
import sys

MODELO = os.environ.get("LOL_WHISPER_MODELO", r"C:\Dev\Reco\models\whisper-small-int8-ov")


def carregar():
    import openvino_genai as og
    pipe = og.WhisperPipeline(MODELO, "CPU")
    cfg = pipe.get_generation_config()
    cfg.language = "<|pt|>"
    cfg.task = "transcribe"
    return pipe, cfg


def transcrever(pipe, cfg, caminho):
    import numpy as np
    raw = subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-i", str(caminho), "-f", "f32le", "-ac", "1",
                          "-ar", "16000", "-"], capture_output=True, check=True).stdout
    a = np.frombuffer(raw, dtype=np.float32)
    if not len(a):
        return ""
    return pipe.generate(a.tolist(), cfg).texts[0].strip()


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        pipe, cfg = carregar()
    except Exception as e:  # sem openvino_genai, sem modelo: o gerador segue sem conferir e registra
        print(json.dumps({"pronto": False, "erro": f"{type(e).__name__}: {e}"[:300]}), flush=True)
        return 1
    if len(sys.argv) > 1:
        for c in sys.argv[1:]:
            print(transcrever(pipe, cfg, c), flush=True)
        return 0
    print(json.dumps({"pronto": True}), flush=True)
    sys.stdin.reconfigure(encoding="utf-8")
    for linha in sys.stdin:
        linha = linha.strip()
        if not linha:
            continue
        try:
            caminhos = json.loads(linha)
            textos = []
            for c in caminhos:
                try:
                    textos.append(transcrever(pipe, cfg, c))
                except Exception as e:
                    textos.append(f"<erro {type(e).__name__}>")
        except ValueError:
            textos = []
        print(json.dumps(textos, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
