# Fase 7 — Operação contínua e segurança

Esta página descreve o que a Fase 7 **implementou** e, separadamente, o que continua dependendo de hardware, tempo de execução ou dados anotados. Nenhum resultado de teste sintético é apresentado como validação real.

## 1. Recuperação após queda do processo

A recuperação acontece **antes** de o servidor abrir as rotas, na inicialização do CLI (`src/server.ts`).

1. O índice append-only é lido (`monitoramento-sessoes.jsonl` e `monitoramento-segmentos.jsonl`).
2. Sessões em `ativa`/`pausada` passam a `interrompida` com `encerradaEmMs` no instante da recuperação.
3. Segmentos em `gravando` passam a `incompleto` com `motivoFim: "lacuna"`. **`fimMs` permanece no último quadro conhecido**: o tempo sem quadros vira uma `LacunaGravacao` explícita (`motivo: "falha"`), nunca cobertura de vídeo inventada.
4. Segmentos já fechados/incompletos **sem arquivo** entram em `uploadsPendentes`. A ausência do arquivo é sinalizada; o plano não afirma se houve upload interrompido ou exclusão intencional.
5. Tudo é registrado em `logs/operacional.jsonl` e na trilha de auditoria (`recuperacao_monitoramento`).

As regras puras estão em `src/monitoramento/recuperacao-monitoramento.ts`; a aplicação idempotente ao índice, em `src/monitoramento/aplicar-recuperacao.ts`. Uma segunda inicialização não encontra sessões ativas nem segmentos abertos e não acrescenta registros. O gravador do cliente continua responsável por reenviar segmentos pendentes quando a rede volta; a recuperação do servidor apenas **identifica** a pendência.

## 2. Retenção de vídeos habilitada

A política principal (`src/domain/retencao-videos.ts`) é determinística: recebe metadados já listados e devolve `remover`, `preservados` e `motivos` (`idade`, `quantidade`, `espaco`). A idade é contada desde o `criadoEmMs` informado no upload — nunca inferida do conteúdo.

Padrões no CLI (`src/env.ts`):

| Variável | Padrão | Critério |
| --- | --- | --- |
| `VIDEO_RETENCAO_MS` | `2592000000` (30 dias) | idade |
| `VIDEO_MAX_ARQUIVOS` | `500` | quantidade (remove os mais antigos primeiro) |
| `VIDEO_MAX_BYTES_TOTAIS` | `5368709120` (5 GiB) | espaço total do diretório |

Cada limite `0` desativa somente aquele critério. A política roda na subida e a cada upload; `POST /api/monitoramento/videos/retencao?agoraMs=` permite aplicá-la manualmente e devolve `removidos`, `preservados` e `motivos`.

`preservarSegmentoIds` protege explicitamente trechos associados a eventos importantes: é uma opção construtiva do `ArmazenadorVideos`/`ServerConfig`, **não** uma derivação automática de "importância" — atribuir importância a um evento continua sendo decisão humana ou de política explícita, não uma inferência inventada pelo sistema.

`DELETE /api/logs` não apaga vídeos nem a trilha de auditoria.

## 3. Autenticação opcional para acesso remoto

- Sem `NEURO_API_TOKEN`, o comportamento é o de sempre: servidor utilizável em loopback, ator `anonimo`.
- Com `NEURO_API_TOKEN`, **toda** rota (API, snapshots, arquivos estáticos e UI) exige `Authorization: Bearer <token>` ou o cookie de sessão assinado. Exceções explícitas: `POST /api/login`, `POST /api/logout`, `GET /login.html` e `GET /api/health`.
- O login usa comparação em tempo constante e emite cookie `HttpOnly; SameSite=Strict; Path=/`, com `Secure` quando `NEURO_HTTPS=1`. O valor do token não é gravado em log, cookie nem auditoria: a trilha registra `token:<sha256-12>`.
- Requisição de API sem sessão recebe `401 { "ok": false, "erro": "nao_autenticado" }`; uma navegação sem sessão recebe a página `public/login.html`, autocontida (sem CSS/JS externo, para não depender de recursos bloqueados pelo próprio gate).

O gate de host permanece: `HOST` não-loopback exige `NEURO_ALLOW_REMOTE=1`. Autenticação embutida **não** substitui firewall/reverse proxy nem a restrição de origens (`NEURO_ALLOWED_ORIGINS`).

## 4. Criptografia em repouso

`src/persistence/criptografia-video.ts` implementa AES-256-GCM com chave de 32 bytes fornecida pelo operador (`NEURO_VIDEO_KEY` em base64/hex, ou `NEURO_VIDEO_KEY_FILE`). Formato aditivo:

```
NVG1 | iv(12) | tag(16) | ciphertext
```

- Cada upload gera um IV aleatório; o AAD é o próprio marcador `NVG1`.
- O metadado do segmento declara `cifrado: "aes-256-gcm:v1"` ou `null`. **Nunca** há afirmação implícita de proteção.
- Sem a chave, a leitura falha com `cifragem_indisponivel` (HTTP 503); com chave errada ou bytes alterados, `cifragem_invalida` (HTTP 409). Chave inválida aborta a subida com mensagem explícita — o servidor não grava dados "protegidos" de forma enganosa.
- Trocar de esquema/chave exige migração explícita: o identificador no metadado impede leitura silenciosa com configuração diferente.

Criptografar os bytes **não** criptografa metadados, índices, logs nem a trilha de auditoria. Esses arquivos podem conter rótulos de ambiente, timestamps e identificadores — continuam tratados como dados sensíveis.

## 5. Trilha de auditoria

`logs/auditoria.jsonl` é append-only, com rotação por tamanho (`src/persistence/repositorio-auditoria.ts`). Cada registro responde quem/acao/alvo/quando/resultado (`schemaVersion: 1`). Ações cobertas:

`acesso_video` (listagem e leitura), `exportacao_eventos`, `exclusao_video`, `exclusao_videos_sessao`, `exclusao_logs`, `limpeza_eventos`, `limpeza_eventos_temporais`, `aplicacao_retencao`, `recuperacao_monitoramento`, `login_sucesso`, `login_falha`, `logout`, `acesso_negado`.

O callback sanitiza detalhes: chaves como `token`, `senha`, `authorization` e `cookie` são descartadas, e apenas escalares são aceitos. A gravação é best-effort; falha gera registro operacional (`auditoria_falhou`) em vez de derrubar a requisição. A trilha não é apagada por `DELETE /api/logs`.

## 6. Consentimento e privacidade

- Vídeos, snapshots e descrições podem conter pessoas e são dados pessoais. `logs/` é ignorado pelo git; nada disso deve ser commitado.
- Antes de capturar, informe as pessoas presentes e obtenha consentimento quando exigido pela jurisdição. Defina finalidade, prazo (alinhado a `VIDEO_RETENCAO_MS`) e responsável pelo acesso.
- Compartilhe exports (`GET /api/eventos/exportar`) e clipes apenas após revisão: descrições são interpretações, não fatos verificados; `statusEvidencia` derivado do servidor não deve ser apresentado como verdade absoluta.
- Para atender exclusão de dados de uma pessoa, use as rotas de exclusão por sessão/segmento e registre a solicitação na trilha (o ator é um resumo irreversível, não uma identidade civil). A política de retenção é o mecanismo de prazo; ela não substitui um processo de titular de dados.
- Não há hoje criptografia de metadados/índices nem segregação por identidade de usuário: todos os atores autenticados compartilham o mesmo token. Para múltiplos operadores com permissões distintas, use reverse proxy com autenticação própria e desative o token embutido.

## 7. Estado da validação

**Implementado e verificado de forma determinística:** `tests/fase7-operacao-seguranca.test.ts` (18 testes) cobre auditoria sanitizada, retenção por idade/quantidade/espaço com preservação, cifragem/autenticação e metadado, recuperação idempotente com lacuna explícita e uploads pendentes, autenticação Bearer/cookie e integração HTTP (401, login, auditoria de exportação/delete/retenção). `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` e `npm run test:e2e` passaram na entrega.

**Validação real já arquivada:** soak de 30 minutos em 2026-11-22, veredito `APROVADO` ([`soak.md`](./soak.md)).

**Ainda pendente — não substituível por teste sintético:** sessão prolongada de várias horas no hardware de referência; webcam física com queda/reconexão reais; falha de disco cheio/escrita; clipes anotados e revisados para iluminação/oclusão e para medir precisão real. Veja [`pendencias.md`](./pendencias.md#fase-7--operação-contínua-e-segurança). Precisão, latência e custo reais permanecem `N/A` até essa medição existir.
