"""Gera o bloco ICONES de pengu/icones.js a partir dos SVGs do lucide-static (etapa C de
roadmap/2026-10-16-chat-da-sala-som-icones.md). Os SVGs baixados são conteúdo externo: dado, nunca código.

Uso (o pacote fica fora do repo, numa pasta nova e vazia; rodar com python -I):
  python -I tools/icones-lucide.py <pasta>/icons

Confere cada SVG por lista branca (raiz <svg> 24x24 com os atributos do Lucide; filhos só path/circle/rect/line/
polyline/polygon/ellipse; atributos só geométricos; valores só número, letra de comando de path, espaço, vírgula,
ponto e sinal) e recusa DOCTYPE/ENTITY, <script>, on*, href, style e foreignObject antes de ler. Imprime o objeto
JS para colar em pengu/icones.js (o nome do produto -> o nome do Lucide fica no mapa NOMES abaixo).
"""
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

# nome no produto -> nome do ícone no lucide-static 1.49.0
NOMES = {
    'chat': 'message-circle',
    'amigos': 'users',
    'configuracoes': 'settings',
    'coach': 'chart-column',
    'salaTime': 'messages-square',
    'replay': 'clapperboard',
    'bloqueado': 'ban',
    'espera': 'hourglass',
    'aviso': 'triangle-alert',
    'denunciar': 'flag',
    'honrar': 'heart',
    'favorito': 'star',
    'ok': 'check',
    'fechar': 'x',
    'minimizar': 'minus',
    'expandir': 'maximize-2',
    'compacto': 'minimize-2',
    'voltar': 'arrow-left',
    'trocaPosicao': 'arrow-left-right',
    'trocaOrdem': 'arrow-up-down',
    'trocaCampeao': 'rotate-ccw',
    'aberto': 'chevron-down',
    'fechado': 'chevron-right',
    'aumentar': 'chevron-up',
    'adicionar': 'plus',
}

FILHOS = {'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse'}
ATRIBUTOS = {'d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points'}
RAIZ = {'class', 'width', 'height', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'}
VALOR = re.compile(r'^[0-9A-Za-z .,\-]*$')
PROIBIDO = re.compile(r'<!DOCTYPE|<!ENTITY|<script|<style|foreignObject|\son[a-z]+\s*=|href|javascript:', re.I)
NS = '{http://www.w3.org/2000/svg}'


def ler(arq: Path):
    bruto = arq.read_text(encoding='utf-8')
    if PROIBIDO.search(bruto):
        raise SystemExit(f'{arq.name}: conteúdo proibido')
    raiz = ET.fromstring(bruto)
    if raiz.tag != NS + 'svg':
        raise SystemExit(f'{arq.name}: raiz não é svg')
    if set(raiz.attrib) - RAIZ or raiz.get('viewBox') != '0 0 24 24' or raiz.get('fill') != 'none' \
            or raiz.get('stroke') != 'currentColor':
        raise SystemExit(f'{arq.name}: atributos da raiz fora do padrão: {raiz.attrib}')
    partes = []
    for f in raiz:
        tag = f.tag.removeprefix(NS)
        if tag not in FILHOS or len(f):
            raise SystemExit(f'{arq.name}: filho não permitido {tag}')
        if set(f.attrib) - ATRIBUTOS:
            raise SystemExit(f'{arq.name}: atributo não permitido {set(f.attrib) - ATRIBUTOS}')
        for v in f.attrib.values():
            if not VALOR.match(v):
                raise SystemExit(f'{arq.name}: valor não permitido {v!r}')
        partes.append((tag, dict(f.attrib)))
    return partes


def js(v):
    return "'" + v + "'"  # valores já passaram pela lista branca (sem aspas nem barra)


def main():
    pasta = Path(sys.argv[1])
    linhas = ['export const ICONES = {']
    for nome, lucide in NOMES.items():
        partes = ler(pasta / f'{lucide}.svg')
        corpo = ', '.join('[' + js(t) + ', {' + ', '.join(f'{k if k.isidentifier() else js(k)}: {js(v)}' for k, v in a.items())
                          + '}]' for t, a in partes)
        linhas.append(f'  {nome}: {{ lucide: {js(lucide)}, partes: [{corpo}] }},')
    linhas.append('};')
    sys.stdout.reconfigure(encoding='utf-8')
    print('\n'.join(linhas))


if __name__ == '__main__':
    main()
