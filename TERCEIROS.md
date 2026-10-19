# Código e conteúdo de terceiros

O lol-ultra-client é distribuído sob a licença MIT (arquivo `LICENSE`). Partes dele vêm de outros projetos, cada uma com a
própria licença, reproduzida no cabeçalho do arquivo que a usa.

| o quê | onde | origem | licença |
| --- | --- | --- | --- |
| trechos do chat da tela de estatísticas do pós-jogo | `chat-posjogo.js` (plugin) | [better-lol-chat](https://github.com/rdavis0/better-lol-chat) v0.8, Copyright (c) 2026 wryguy | MIT |
| ícones | `icones.js` (plugin) | [Lucide](https://lucide.dev) (lucide-static 1.49.0), Copyright (c) 2026 Lucide Icons and Contributors | ISC |

## Fora do pacote

- **Bibliotecas Python do complemento coach** (`requirements-complemento.txt`: websockets, numpy, scipy,
  opencv-python-headless, mss, Pillow): não vêm no pacote. A instalação baixa cada uma do PyPI, com a licença do próprio
  projeto.
- **Pacote de voz Aoede** (download opcional, separado): áudios gerados pela voz Aoede do Google Gemini a partir das falas
  do complemento coach; o uso segue os termos do Google para o conteúdo gerado.
- **Pengu Loader**, **League of Legends** e os dados que o client da Riot Games fornece (nomes, ícones e imagens de
  campeões) não são distribuídos aqui: pertencem aos respectivos donos.
