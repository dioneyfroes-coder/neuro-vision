# Segurança e exposição na rede — Neuro Vision

Por padrão o servidor escuta apenas em `127.0.0.1` (loopback), sem autenticação. **Execução local e execução acessível pela rede têm riscos diferentes:**

- **Local (`HOST=127.0.0.1`)**: só processos da máquina alcançam a interface e a API.
- **Expõe na rede (`HOST=0.0.0.0` ou um IP concreto)**: qualquer host da rede local (e, conforme o firewall, além dele) alcança a interface, a API e os snapshots — ou seja, câmera, descrições e histórico. Não há autenticação embutida.

Para deixar esse limite explícito, o servidor **recusa** escutar em host não-loopback sem um opt-in deliberado:

```bash
HOST=0.0.0.0 NEURO_ALLOW_REMOTE=1 npm start   # assume o risco
```

Antes de recomendar exposição na rede, é necessário **implementar autenticação ou outro controle de acesso adequado** (por exemplo, um reverse proxy com autenticação na frente), restringir o firewall à rede confiável e limitar as origens dos navegadores. Enquanto isso não existir, prefira `HOST=127.0.0.1`.

Controles já aplicados:

- Rejeição de **origem cruzada**: requisição com cabeçalho `Origin` só é aceita se bater com o host da requisição ou estiver em `NEURO_ALLOWED_ORIGINS` (resposta `403` caso contrário).
- **Limites de tamanho**: corpo JSON de `/api/log` (`BODY_MAX_BYTES`), de `/api/visao` (`VISAO_BODY_MAX_BYTES`) e de cada snapshot (`SNAP_UPLOAD_MAX_BYTES`).
- **Validação de tipos**: payloads com campos de tipo inválido (ex.: `objetos` não-lista, `resumo`/`imagem` não-texto, `snapshot` não-texto ou acima do limite, `motivo` fora da lista conhecida) são recusados com `400`.

- **Retenção e exclusão:** vídeos em `logs/videos/` podem ser removidos por idade/quantidade (`VIDEO_RETENCAO_MS`/`VIDEO_MAX_ARQUIVOS`, desligados por padrão) ou explicitamente pelas rotas `/api/monitoramento/videos/*`, hoje ligadas aos botões **Aplicar retenção** e **Excluir vídeos da sessão**. A política também é aplicada na subida do servidor, e exclusões são auditadas em `logs/operacional.jsonl`. `DELETE /api/logs` não apaga vídeos nem esse arquivo.

> **Dados sensíveis:** snapshots, logs e vídeos podem conter pessoas. Trate-os como dados sensíveis — não os inclua em commits (a pasta `logs/` é ignorada no git). Não há criptografia em repouso nem autenticação embutida; para exposição em rede use reverse proxy com autenticação.