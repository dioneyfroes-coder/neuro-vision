# API — Neuro Vision

Referência completa da API HTTP, formato das entradas, retenção de snapshots e memória persistente.

## Endpoints

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/api/log` | Grava uma entrada de detecção no arquivo de log. Aceita `snapshot` (data URL) e `capturadoEm` (ISO do instante em que o frame foi fotografado, antes da inferência) opcionais. |
| `POST` | `/api/visao` | Envia um frame (base64) e recebe a descrição do Ollama em stream NDJSON; grava no log. |
| `GET` | `/api/visao/preparar` | Carrega o modelo do Ollama na memória (quando necessário) e responde quando estiver pronto: `{ ok, modelo, carregado, carregandoMs }`. |
| `GET` | `/api/logs?limit=100` | Lista as entradas mais recentes (mais nova primeiro, limite máx. 500). |
| `DELETE` | `/api/logs` | Limpa o histórico de log (inclui a rotação `.1`) **e** os eventos estruturados, removendo os snapshots que ficaram órfãos. |
| `POST` | `/api/eventos` | Grava um evento visual estruturado (`EventoVisual`). Aceita `snapshot` (data URL) opcional. |
| `GET` | `/api/eventos?limit=100` | Lista os eventos mais recentes (mais novo primeiro, limite máx. 500). Consultas por `tipo` (CSV, ex. `?tipo=aparicao,movimento`), `objetoId` e janela temporal (`desde`/`ate`, epoch ms ou ISO) respondem **o que mudou**, **quando** e as **evidências** (cada evento traz `confianca` e `snapshot`). Os filtros incidem sobre os eventos mais recentes dentro de `limit`. |
| `DELETE` | `/api/eventos` | Limpa os eventos estruturados e remove os snapshots que ficaram órfãos. |
| `POST` | `/api/operacional` | Grava um registro operacional (falha/métrica) que **não** é acontecimento visual. |
| `GET` | `/api/contexto` | Reidrata um contexto curto do estado recente (`{ resumo, roteiro, ultimaDescricao, entradas, eventos }`) com janela por `maxEntradas`/`maxEventos`/`maxCaracteres`. |
| `GET` | `/api/health` | Status do Ollama (`{ ollama: { online, modelos, carregados, erro } }`). |
| `GET` | `/snapshots/<arquivo>` | Serve os snapshots (thumbnails) gravados. |

As entradas são gravadas em `logs/visao.jsonl`, os eventos em `logs/eventos.jsonl` e os registros operacionais em `logs/operacional.jsonl` (uma linha JSON por registro, própria política de rotação); os snapshots ficam em `logs/snapshots/`.

## `POST /api/visao` — corpo

```json
{ "imagem": "<base64 ou data URL>", "modelo": "qwen2.5vl:3b", "modo": "roteiro", "base": true, "roteiro": "", "anterior": "descrição anterior", "snapshot": "<data URL opcional>", "capturadoEm": "<ISO opcional: instante da captura do frame>" }
```

- `modo`: `"roteiro"` (padrão) ou `"descricao"`.
- `base`: no modo roteiro, `true` no primeiro frame (análise profunda) e `false` nos seguintes (só o que mudou).
- `roteiro`: roteiro acumulado (resumido) enviado como contexto nos deltas.
- `capturadoEm`: instante ISO em que o frame foi fotografado, **antes** da inferência. `timestamp` da entrada é o fim da análise; a diferença entre os dois é o atraso de inferência (a interface exibe o horário da captura como principal e o atraso no tooltip).

Resposta: stream NDJSON (`application/x-ndjson`), uma linha por evento:

```json
{ "type": "chunk", "response": "Uma pessoa" }
{ "type": "done", "descricao": "Uma pessoa no escritorio.", "modelo": "qwen2.5vl:3b", "tokens": 42, "ms": 3120, "snapshot": "/snapshots/123-abc.jpg", "tipo": "roteiro", "papel": "delta", "semMudanca": false }
```

No modo roteiro, quando o modelo responde que **nada mudou** (sentinela `INALTERADO`, tolerante a acentos/variações), o servidor devolve `"semMudanca": true` e **não grava** a entrada no log — assim o roteiro não vira ruído.

Em caso de erro após o início do stream: `{ "type": "erro", "erro": "Ollama: ..." }`.

## Snapshot = frame analisado

Em todos os modos, o snapshot do histórico é o **mesmo frame analisado**: o cliente captura o frame **uma única vez** (`Camera.capturarQuadro`) e a mesma imagem alimenta a análise, o snapshot (thumbnail reduzido dos mesmos pixels) e a assinatura de cena. O instante da captura é registrado em `capturadoEm`. Nos modos de detecção/eventos isso evita o descompasso em que o histórico mostrava um segundo frame, capturado **depois** da inferência.

## Retenção de snapshots

Os snapshots em `logs/snapshots/` são limitados por idade, quantidade e tamanho total (variáveis `SNAP_MAX_AGE_DAYS`, `SNAP_MAX_FILES` e `SNAP_MAX_BYTES`; use `0` para desativar um limite). A limpeza:

- considera **preservadas** as entradas do histórico atual e da última rotação, tanto de `visao.jsonl` (observações) quanto de `eventos.jsonl` (eventos estruturados);
- mantém snapshots ainda referenciados por essas entradas enquanto estiverem dentro dos limites;
- remove snapshots **órfãos** (sem nenhuma entrada preservada apontando para eles);
- remove snapshots **expirados** por idade, referenciados ou não;
- ao exceder os tetos de quantidade/tamanho, descarta primeiro os mais antigos;
- roda em segundo plano (na subida do servidor, após novas gravações e ao limpar o histórico), sem bloquear requisições e tolerando falhas parciais de sistema de arquivos.

`DELETE /api/logs` limpa o histórico e os eventos (atuais e `.1`) e, como as entradas deixam de existir, remove de imediato os snapshots que ficaram órfãos.

## Memória persistente

O armazenamento é **JSONL** (`visao.jsonl`, `eventos.jsonl`, `operacional.jsonl`): escrita sequencial append-only e leitura recente, sem dependências e com inspeção trivial. A decisão foi: manter JSONL enquanto essas forem as necessidades; migrar para **SQLite** apenas quando filtros combinados (data **e** objeto **e** tipo de evento) ou agregações sobre um volume maior virarem requisito recorrente — nesse caso preservando a exportação para JSONL e criando migração com teste de integridade. Busca semântica/embeddings fica adiada até haver uma consulta em linguagem natural com ganho mensurável.

Na inicialização, o cliente usa `GET /api/contexto` para **reidratar** o contexto (roteiro recente, última descrição e um resumo curto separado dos eventos completos), limitado por tamanho e número de itens para nunca enviar todo o histórico ao Ollama.

A consulta ao histórico de eventos (`GET /api/eventos` com filtros) responde **o que mudou**, **quando** e com quais **evidências** — ver [`eventos.md`](./eventos.md).