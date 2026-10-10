# Neuro Vision

Base open-source de visão computacional local: a webcam enxerga e registra o que vê.

Todo o processamento roda na sua máquina. A imagem capturada nunca sai do seu computador — nem para modelos de detecção (rodam no navegador) nem para descrição (rodam em um Ollama local).

## Modos

| Motor | Onde roda | O que faz |
| --- | --- | --- |
| **Detecção** (transformers.js) | Navegador (WebGPU/CPU) | Detecta objetos (pessoa, carro, celular, ...) com caixas e confiança, usando YOLOS ou DETR (COCO). |
| **Descrição** (Ollama `qwen3-vl`) | Servidor (Ollama local) | Descreve o frame em português, comparando com o frame anterior para evitar repetições. |

## Requisitos

- Node.js 20+ (usa `fetch` e `AbortSignal.timeout` nativos).
- (Opcional, para o modo descrição) [Ollama](https://ollama.com) instalado e rodando.

## Instalação

```bash
npm install
```

Para o modo descrição, baixe o modelo de visão:

```bash
ollama pull qwen3-vl:4b
```

## Uso

Desenvolvimento (servidor com hot-reload + build do cliente em watch):

```bash
npm run dev
```

Depois abra http://localhost:3000 e clique em **Iniciar**. Autorize o acesso à webcam.

Produção:

```bash
npm start
```

### Configuração

Variáveis de ambiente lidas pelo servidor:

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP. |
| `HOST` | `127.0.0.1` | Interface de escuta (use `0.0.0.0` para expor na rede). |
| `OLLAMA_HOST` | `http://localhost:11434` | URL do Ollama. |
| `OLLAMA_MODEL` | `qwen3-vl:4b` | Modelo de visão usado na descrição. |
| `LOG_MAX_BYTES` | `5000000` | Tamanho máximo de `visao.jsonl` antes de rotacionar para `.1`. |

Exemplo:

```bash
$env:OLLAMA_MODEL="qwen2.5vl:7b"; npm start   # PowerShell
OLLAMA_MODEL=qwen2.5vl:7b npm start            # bash
```

## API

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/api/log` | Grava uma entrada de detecção no arquivo de log. Aceita `snapshot` (data URL) opcional. |
| `POST` | `/api/visao` | Envia um frame (base64) e recebe a descrição do Ollama em stream NDJSON; grava no log. |
| `GET` | `/api/logs?limit=100` | Lista as entradas mais recentes (mais nova primeiro, limite máx. 500). |
| `DELETE` | `/api/logs` | Limpa o histórico de log. |
| `GET` | `/api/health` | Status do Ollama (`{ ollama: { online, modelos, erro } }`). |
| `GET` | `/snapshots/<arquivo>` | Serve os snapshots (thumbnails) gravados. |

As entradas são gravadas em `logs/visao.jsonl` (uma linha JSON por entrada) e os snapshots em `logs/snapshots/`.

`POST /api/visao` — corpo:

```json
{ "imagem": "<base64 ou data URL>", "modelo": "qwen3-vl:4b", "anterior": "descrição anterior", "snapshot": "<data URL opcional>" }
```

Resposta: stream NDJSON (`application/x-ndjson`), uma linha por evento:

```json
{ "type": "chunk", "response": "Uma pessoa" }
{ "type": "done", "descricao": "Uma pessoa no escritorio.", "modelo": "qwen3-vl:4b", "tokens": 42, "ms": 3120, "snapshot": "/snapshots/123-abc.jpg" }
```

Em caso de erro após o início do stream: `{ "type": "erro", "erro": "Ollama: ..." }`.

## Estrutura

```
src/
  server.ts            servidor HTTP (estático + API) e persistência do log
  ollama.ts            cliente do Ollama e montagem do prompt de descrição
  types.ts             tipos compartilhados (EntradaLog, ObjetoVisto, ...)
  *.test.ts            testes (vitest)
  transformers-cdn.d.ts  tipos para o transformers.js via CDN
public/
  index.html           interface
  app.ts               lógica do cliente (captura, detecção, descrição)
  style.css            estilos
logs/
  visao.jsonl          histórico gravado (ignorado no git)
```

## Scripts

| Script | Descrição |
| --- | --- |
| `npm run dev` | Servidor + cliente em modo watch. |
| `npm run build` | Build de servidor (`dist/server.js`) e cliente (`public/app.js`). |
| `npm start` | Build e executa o servidor. |
| `npm test` | Testes (vitest). |
| `npm run test:watch` | Testes em watch. |
| `npm run typecheck` | Checagem de tipos (`tsc --noEmit`). |
| `npm run lint` | ESLint. |
| `npm run lint:fix` | ESLint com correção automática. |

## Licença

MIT.
