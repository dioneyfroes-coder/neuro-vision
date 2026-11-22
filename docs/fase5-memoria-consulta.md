# Fase 5 — Memória e consulta

Esta fase torna o histórico **pesquisável, exportável e verificável**, sem criar um formato concorrente. O contrato canônico continua sendo `EventoTemporal`, persistido em `logs/eventos-temporais.jsonl`; os streams antigos são adaptados na leitura.

## Schema canônico

`src/domain/schema-evento.ts` publica a versão (`VERSAO_ESQUEMA_EVENTO = 1`), o descritor do contrato e o vocabulário de ações. `montarEventoTemporal()` grava `schemaVersion` no servidor e recusa valores inventados em `naturezaInteracao`, `transicaoPosse` e `correcao`. `statusEvidencia` continua **derivado no servidor**, nunca confiado ao cliente.

## Consulta

`GET /api/eventos-temporais` aceita, em interseção:

- `desde`/`ate` — janela de **sobreposição** (`inicioEm..fimEm`), não apenas instante de início; um evento longo ativo na janela continua no resultado. Aceita ISO ou epoch ms.
- `pessoa` (ou `pessoaEntidadeId`) — associação heurística mão↔pessoa da Fase 4, distinta de `entidadeId` (track de pose).
- `acao` — natureza (`proximidade`, `contato`, `manipulacao`), posse (`pego`, `deixado`) ou tipo de evento. Filtro por natureza **não** casa com evento que não mediu natureza: ausência não é preenchida.
- `objeto`, `participante`, `entidadeId`, `sessionId`, `tipo`, `estado`, `segmentoId` — filtros pré-existentes, preservados.

A regra pura em `src/domain/consulta-eventos.ts` é reutilizada pela rota, pela exportação e pelos testes.

## Vínculo com vídeo e linha do tempo

O vínculo é derivado na leitura por `src/domain/vinculo-evento-video.ts`: cada evento recebe referências com `offsetMs`, `ateMs`, `duracaoTrechoMs`, `incompleto` e `lacunas`. A linha do tempo da interface (`public/app.ts`) passou a renderizar **um item por evento**, ordenado por `inicioEm`, e entrega essas referências diretamente ao player — o clique abre o instante do evento, não o começo do segmento. Eventos sem cobertura exibem “Sem vídeo coberto para este intervalo”. Quando não há eventos temporais e nenhum filtro estruturado, a visão anterior por sessão/cena continua disponível como contexto.

O badge de `statusEvidencia` separa visualmente fato observado, inferido e sem confirmação. `estadoAnterior`/`estadoPosterior` só aparecem quando o inventário observou o estado (ponte da Fase 4).

## Memória por sessão

`GET /api/contexto?sessionId=<id>` reidrata `resumo`, `roteiro`, `ultimaDescricao`, `entradas` e `eventos` **daquela sessão**. Sem o parâmetro, o comportamento global permanece, incluindo registros legados sem `sessaoId`. A resposta devolve `sessionId` quando o filtro foi aplicado. O cliente `obterContexto(sessionId?)` expõe o mesmo contrato.

O histórico entre sessões continua assentado nos JSONL append-only e no índice de monitoramento; a filtragem por sessão não apaga nem reescreve registros.

## Exportação

`GET /api/eventos/exportar?formato=jsonl|csv` usa os mesmos filtros da consulta e devolve `Content-Disposition` com nome de arquivo.

- **JSONL:** primeira linha com `{ registro: "metadados", versao, geradoEm, sessaoId, total, filtros }`; uma linha por evento com `{ registro: "evento", fluxo, ...campos }`.
- **CSV:** colunas canônicas em ordem estável, com `versaoEsquema` e `geradoEm` repetidos em cada linha (tabela autocontida) e escaping de vírgulas/aspas/quebras.

Campos não observados viram célula vazia — nunca zero nem texto inventado. O limite de leitura é de 20.000 registros por stream; para históricos maiores, filtre por sessão/período antes de exportar (limitação registrada em `docs/pendencias.md`).

## Correção auditável

`POST /api/eventos-temporais/:eventoId/corrigir` recebe `{ corrigidoPor, motivo, alteracoes }`. Somente `descricao`, `rotuloObjeto`, `pessoaEntidadeId`, `entidadeId`, `naturezaInteracao`, `transicaoPosse`, `estadoAnterior` e `estadoPosterior` podem ser alterados; `null` devolve o campo à ausência. A rota:

1. localiza a versão mais recente do `eventoId` no stream;
2. anexa uma **nova versão** com `correcao: { corrigidoEm, corrigidoPor, motivo, versao, valorOriginal }`;
3. recalcula `statusEvidencia` e `schemaVersion` no servidor, com novo `idempotencyKey` e instante de persistência.

Identidade, tempo, origens, frameIds, `estado` e `statusEvidencia` **nunca** são alterados pela correção. A versão anterior permanece no JSONL e pode ser auditada. A interface oferece o formulário no item do evento; autor e motivo são obrigatórios.

## Evidência determinística

`tests/fase5-eventos.test.ts` cobre as regras puras (consulta, schema, exportação, correção) e `tests/server-fase5.test.ts` cobre as rotas HTTP, a persistência append-only da correção e o contexto por sessão. Os testes pré-existentes de vínculo de vídeo continuam passando.

Isso não prova usabilidade nem correção de dados reais: ver [`pendencias.md`](./pendencias.md#fase-5--limitações-conhecidas).
