// Versão do pacote público (lol-ultra-client) e o repositório onde ele sai. Decisão técnica 2 de
// roadmap/2026-10-19-publicacao-e-complemento-publico.md: uma constante só, lida pelo plugin (aviso de versão nova, P2), pelo
// complemento (GET /ola devolve a mesma, P4) e pelo tools/publicar.py (nome dos zips e tag vX.Y.Z). Plugin e complemento saem
// sempre juntos na mesma versão. Subir a versão = mudar só esta linha e commitar antes de publicar.
export const VERSAO = '0.1.0';
export const REPO = 'dosxnjos/lol-ultra-client';
