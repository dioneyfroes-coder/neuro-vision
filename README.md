# Neuro Vision

Base open-source de visão computacional local: a webcam enxerga e registra o que vê.

Todo o processamento roda na sua máquina. A imagem capturada nunca sai do seu computador — nem para modelos de detecção (rodam no navegador) nem para descrição (rodam em um Ollama local).

## Modos

| Motor | Onde roda | O que faz |
| --- | --- | --- |
| **Detecção** (transformers.js) | Navegador (WebGPU/CPU) | Detecta objetos (pessoa, carro, celular, ...) com caixas e confiança, usando YOLOS ou DETR (COCO). |
| **Roteiro** (Ollama local) | Servidor (Ollama local) | Faz **uma análise profunda da cena** (base) e, a cada novo frame, registra **apenas o que mudou** em relação ao que já aconteceu — montando um roteiro cronológico. É o motor padrão. |
| **Descrição** (Ollama local) | Servidor (Ollama local) | Descreve cada frame em português, comparando com o frame anterior para evitar repetições. |

## Requisitos

- Node.js 20+ (usa `fetch` e `AbortSignal.timeout` nativos).
- (Opcional, para o modo descrição) [Ollama](https://ollama.com) instalado e rodando.

## Instalação

```bash
npm install
```

Para o modo descrição, baixe um modelo de visão:

```bash
ollama pull qwen2.5vl:3b
```

> **Nota sobre `qwen3-vl`:** o `qwen3-vl` é um modelo "thinking" e, nos builds atuais do Ollama, o `think:false` é **ignorado** — o modelo gasta o `num_predict` raciocinando e devolve `content` vazio (nenhum log sai da descrição). Por isso a integração usa `/api/chat` com detecção desse caso e recomenda o `qwen2.5vl` (não-pensante) para descrição de frames.

> **Repetição:** o motor de descrição costumava repetir/fundir frases. As causas eram do próprio modelo, agravadas por reinjetar a descrição anterior inteira. Mitigações: `repeat_penalty: 1.3`, `repeat_last_n: 128`, `top_p: 0.9`, `num_predict` reduzido no delta do roteiro e pós-processamento (`colapsarRepeticoes` + `cortarFraseIncompleta`) no servidor.

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
| `OLLAMA_MODEL` | `qwen2.5vl:3b` | Modelo de visão não-pensante usado na descrição. |
| `LOG_MAX_BYTES` | `5000000` | Tamanho máximo de `visao.jsonl` antes de rotacionar para `.1`. |
| `SNAP_MAX_BYTES` | `200000000` | Tamanho total máximo de `logs/snapshots/` em bytes (`0` desativa). |
| `SNAP_MAX_FILES` | `1000` | Quantidade máxima de snapshots (`0` desativa). |
| `SNAP_MAX_AGE_DAYS` | `30` | Idade máxima de um snapshot em dias (`0` desativa). |
| `SNAP_CLEAN_INTERVAL_MS` | `600000` | Intervalo mínimo entre limpezas automáticas disparadas por novas gravações. |

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
| `GET` | `/api/visao/preparar` | Carrega o modelo do Ollama na memória (quando necessário) e responde quando estiver pronto: `{ ok, modelo, carregado, carregandoMs }`. |
| `GET` | `/api/logs?limit=100` | Lista as entradas mais recentes (mais nova primeiro, limite máx. 500). |
| `DELETE` | `/api/logs` | Limpa o histórico de log (inclui a rotação `.1`) e remove os snapshots que ficaram órfãos. |
| `GET` | `/api/health` | Status do Ollama (`{ ollama: { online, modelos, carregados, erro } }`). |
| `GET` | `/snapshots/<arquivo>` | Serve os snapshots (thumbnails) gravados. |

As entradas são gravadas em `logs/visao.jsonl` (uma linha JSON por entrada) e os snapshots em `logs/snapshots/`.

`POST /api/visao` — corpo:

```json
{ "imagem": "<base64 ou data URL>", "modelo": "qwen2.5vl:3b", "modo": "roteiro", "base": true, "roteiro": "", "anterior": "descrição anterior", "snapshot": "<data URL opcional>" }
```

- `modo`: `"roteiro"` (padrão) ou `"descricao"`.
- `base`: no modo roteiro, `true` no primeiro frame (análise profunda) e `false` nos seguintes (só o que mudou).
- `roteiro`: roteiro acumulado (resumido) enviado como contexto nos deltas.

Resposta: stream NDJSON (`application/x-ndjson`), uma linha por evento:

```json
{ "type": "chunk", "response": "Uma pessoa" }
{ "type": "done", "descricao": "Uma pessoa no escritorio.", "modelo": "qwen2.5vl:3b", "tokens": 42, "ms": 3120, "snapshot": "/snapshots/123-abc.jpg", "tipo": "roteiro", "papel": "delta", "semMudanca": false }
```

No modo roteiro, quando o modelo responde que **nada mudou** (sentinela `INALTERADO`, tolerante a acentos/variações), o servidor devolve `"semMudanca": true` e **não grava** a entrada no log — assim o roteiro não vira ruído.

Em caso de erro após o início do stream: `{ "type": "erro", "erro": "Ollama: ..." }`.

### Retenção de snapshots

Os snapshots em `logs/snapshots/` são limitados por idade, quantidade e tamanho total (variáveis `SNAP_MAX_AGE_DAYS`, `SNAP_MAX_FILES` e `SNAP_MAX_BYTES`; use `0` para desativar um limite). A limpeza:

- considera **preservadas** as entradas do histórico atual e da última rotação (`visao.jsonl` e `visao.jsonl.1`);
- mantém snapshots ainda referenciados por essas entradas enquanto estiverem dentro dos limites;
- remove snapshots **órfãos** (sem nenhuma entrada preservada apontando para eles);
- remove snapshots **expirados** por idade, referenciados ou não;
- ao exceder os tetos de quantidade/tamanho, descarta primeiro os mais antigos;
- roda em segundo plano (na subida do servidor, após novas gravações e ao limpar o histórico), sem bloquear requisições e tolerando falhas parciais de sistema de arquivos.

`DELETE /api/logs` limpa o histórico (atual e `.1`) e, como as entradas deixam de existir, remove de imediato os snapshots que ficaram órfãos.

## Estrutura

```
src/
  server.ts            servidor HTTP (estático + API) e persistência do log
  ollama.ts            cliente do Ollama e montagem dos prompts (descrição e roteiro)
  texto.ts             pós-processamento: colapsa repetições, detecta "sem mudança", corta frase incompleta
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
| `npm test` | Testes unitários/integração (vitest). |
| `npm run test:watch` | Testes em watch. |
| `npm run test:e2e` | Testes E2E (Playwright; requer `npx playwright install chromium`). |
| `npm run typecheck` | Checagem de tipos (`tsc --noEmit`). |
| `npm run lint` | ESLint. |
| `npm run lint:fix` | ESLint com correção automática. |
| `npm run bench` | Benchmark de velocidade do modelo local (requer Ollama rodando). |

### Benchmark

`npm run bench` mede o que o seu modelo local realmente sustenta (geração em tok/s, prefill da imagem, tempo até a 1ª resposta e total) e recomenda o **intervalo mínimo** para o slider da UI (`totalMs × 1.5`). Opções:

```bash
npm run bench                                    # usa qwen2.5vl:3b (OLLAMA_MODEL) e um snapshot em logs/snapshots
npm run bench -- --model qwen2.5vl:7b --iter 5   # outro modelo, mais amostras
npm run bench -- --image foto.jpg --json         # imagem específica + saída JSON
```

O cliente **ajusta sozinho** o ritmo: cada análise espera `max(intervalo, duração da análise anterior + 500ms)`, então nunca pede mais rápido que o modelo consegue responder. O status e cada entrada de descrição mostram os **tok/s** medidos.

Medição de referência (`qwen2.5vl:3b`, CPU, snapshot 4K): ~40 tok/s de geração, prefill ~104 tok/s, 1ª resposta ~10,6s, total ~11,5s → **intervalo mínimo recomendado ≥ 18s**.

### Carregamento do modelo

O Ollama carrega o modelo na memória sob demanda (o primeiro request é o lento). O Neuro Vision espera esse carregamento antes de começar:

- Ao clicar **Iniciar** com o motor **Descrição**, o servidor chama `forcarCarregamento` (probe em `/api/ps`) e **só então** o ciclo de análise começa. O status mostra "Carregando modelo... em Ns".
- O badge do Ollama informa quais modelos estão **em memória** (`/api/health` → `carregados`).
- O benchmark **só mede com o modelo já em memória** (a primeira etapa carrega e reporta o tempo da carga), para que o tok/s não seja contaminado pelo load.

## Licença

MIT.
