# Segurança e exposição na rede — Neuro Vision

Por padrão o servidor escuta apenas em `127.0.0.1`. Desde a Fase 7 existe **autenticação embutida opcional** (`NEURO_API_TOKEN`) e **criptografia em repouso opcional** dos vídeos, mas nada disso elimina a necessidade de decidir onde e para quem o serviço é exposto.

- **Local (`HOST=127.0.0.1`, sem token)**: só processos da máquina alcançam a interface e a API. É o modo padrão e o recomendado para uso casual.
- **Com token (`NEURO_API_TOKEN`)**: API, snapshots, arquivos estáticos e UI exigem `Authorization: Bearer <token>` ou cookie de sessão assinado. Exceções: `POST /api/login`, `POST /api/logout`, `GET /login.html` e `GET /api/health`.
- **Expõe na rede (`HOST=0.0.0.0` ou IP concreto)**: exige `NEURO_ALLOW_REMOTE=1`. Mesmo com token, mantenha firewall, reverse proxy e `NEURO_ALLOWED_ORIGINS` restritos — a trilha de auditoria e os metadados não são cifrados.

```bash
HOST=0.0.0.0 NEURO_ALLOW_REMOTE=1 NEURO_API_TOKEN="$(openssl rand -base64 32)" npm start
```

Controles aplicados:

- **Origem cruzada**: requisição com `Origin` só é aceita se bater com o host ou estiver em `NEURO_ALLOWED_ORIGINS` (senão `403`).
- **Limites de tamanho**: `/api/log` (`BODY_MAX_BYTES`), `/api/visao` (`VISAO_BODY_MAX_BYTES`), snapshots (`SNAP_UPLOAD_MAX_BYTES`) e upload de vídeo (`VIDEO_MAX_BYTES`).
- **Validação de tipos**: payloads inválidos são recusados com `400`.
- **Segredos**: comparação de token em tempo constante; cookie `HttpOnly; SameSite=Strict` (com `Secure` quando `NEURO_HTTPS=1`); a trilha registra apenas `token:<sha256-12>`, nunca o valor.
- **Retenção de vídeos**: 30 dias / 500 arquivos / 5 GiB por padrão (`VIDEO_RETENCAO_MS`, `VIDEO_MAX_ARQUIVOS`, `VIDEO_MAX_BYTES_TOTAIS`), aplicada na subida e a cada upload. Cada limite `0` desativa apenas aquele critério.
- **Criptografia em repouso**: AES-256-GCM via `NEURO_VIDEO_KEY` ou `NEURO_VIDEO_KEY_FILE`; o metadado declara `cifrado: "aes-256-gcm:v1"` ou `null`. Sem chave, a leitura falha com `cifragem_indisponivel` em vez de devolver bytes cifrados como se fossem válidos.
- **Auditoria**: `logs/auditoria.jsonl` registra acesso/exportação/exclusão de vídeos e eventos, login/logout, negações, retenção e recuperação. É append-only e não é apagado por `DELETE /api/logs`.
- **Recuperação**: na subida, sessões abandonadas são fechadas e segmentos abertos viram `incompleto` com lacuna explícita; o tempo sem quadros nunca é apresentado como gravação.

> **Dados sensíveis:** snapshots, vídeos, descrições, logs, índices e a própria trilha de auditoria podem conter informações sobre pessoas. `logs/` é ignorado pelo git. Cifrar os bytes do vídeo não cifra metadados, índices nem logs. Defina consentimento, finalidade e prazo de retenção antes de capturar; veja [`fase7-operacao-seguranca.md`](./fase7-operacao-seguranca.md#6-consentimento-e-privacidade).

Limitações honestas: há um único token compartilhado por todos os operadores autenticados (sem perfis/permissões por pessoa), e não há rotação automática de chave nem criptografia de metadados. Para múltiplos operadores com permissões distintas, use um reverse proxy com autenticação própria e mantenha `NEURO_API_TOKEN` vazio.
