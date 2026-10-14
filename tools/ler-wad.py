"""Lê o JS e os textos de um plugin da Riot (assets.wad, formato RW 3.x) para conferir rota e corpo que o front dela usa.

Só leitura: abre o .wad do disco e grava os arquivos soltos numa pasta fora do repo. Nada fala com o client.
Plugins em C:\\Games\\Riot Games\\League of Legends\\Plugins\\rcp-fe-lol-<nome>\\assets.wad (16.20). Os nomes dentro do
.wad são hashes: o JS vira <hash>.js, o resto <hash>.bin (os trans.json de cada idioma ficam nos .bin).
Usado no passo 12 do client compacto (honra, pedido de amizade, denúncia: roadmap/2026-10-13-client-compacto.md).

uso: python tools/ler-wad.py <assets.wad> <pasta_de_saida>
     depois: grep -l "end-of-game-reports" <pasta>/*  (e ler o trecho com dd/grep -o)
"""
import gzip
import os
import struct
import sys
from compression import zstd  # Python 3.14+


def extrair(wad, saida):
    os.makedirs(saida, exist_ok=True)
    d = open(wad, 'rb').read()
    if d[:2] != b'RW' or d[2] != 3:
        raise SystemExit(f'não é um WAD 3.x: {d[:4]!r}')
    off = 4 + 256 + 8  # assinatura e checksum do cabeçalho 3.x
    n = struct.unpack_from('<I', d, off)[0]
    off += 4
    feitos = 0
    for i in range(n):
        h, o, cs, _us, t, _dup, _sub, _ck = struct.unpack_from('<QIIIBBHQ', d, off + i * 32)
        tipo, bruto = t & 0xF, d[o:o + cs]
        if tipo == 0:
            dado = bruto
        elif tipo == 1:
            dado = gzip.decompress(bruto)
        elif tipo in (3, 4):
            dado = zstd.decompress(bruto)
        else:
            continue  # tipo 2 = referência a outro arquivo
        js = b'webpackJsonp' in dado[:2000] or dado[:200].lstrip().startswith((b'(', b'!', b'"use', b'/*', b'var', b'define', b'function'))
        with open(os.path.join(saida, f'{h:016x}.{"js" if js else "bin"}'), 'wb') as f:
            f.write(dado)
        feitos += 1
    return n, feitos


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    total, ok = extrair(sys.argv[1], sys.argv[2])
    print(f'{ok} de {total} arquivos em {sys.argv[2]}')
