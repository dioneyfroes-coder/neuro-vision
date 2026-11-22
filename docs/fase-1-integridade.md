# Fase 1 — Integridade temporal e identidade

Implementação da Fase 1 do plano mestre, em cima do baseline da [Fase 0](./auditoria-fase-0.md). Commit atômico da fase, sem depender de backend multimodal ou clipe real.

## O que mudou

### 1. Timestamp no instante da captura

`WebcamCapture` agora distingue `solicitadoEmMs` (pedido ao dispositivo) de `capturadoEmMs` (instante em que os pixels válidos foram devolvidos). A cadência do ciclo é contada a partir do pedido, sem uma terceira leitura de relógio — isso preservou os testes de janela de captura e cadência que existiam antes.

O `SnapshotCapturado` e o `ObservacaoFrame` carregam os dois instantes; `processarQuadros` acrescenta `processadoEmMs` na mesma base monotônica. Nenhum timestamp de captura é substituído pelo término da inferência.

### 2. Captura, processamento e persistência separados

`EventoTemporal` ganhou campos opcionais e compatíveis:

| Campo | Origem |
| --- | --- |
| `capturadoEmMs` | epoch ms derivado de `ultimaEvidenciaEm`/`inicioEm` (frame de origem) |
| `processadoEmMs` | `Date.now()` no cliente, ao converter o sinal em evento |
| `inferidoEmMs` | conclusão da inferência no cliente |
| `persistidoEmMs` | **servidor**, no recebimento — cliente não pode forjar |
| `registradoEmMs`, `desvioRelogioMs`, `ordemChegada` | metadados de chegada/ordem |
| `statusEvidencia` | derivado no servidor a partir dos sinais brutos |

O `EventoTemporalPersistido` existente continua válido: todos os campos novos são opcionais. `montarEventoTemporal()` ignora um `statusEvidencia` enviado pelo cliente e recalcula a classificação, evitando que falha de percepção vire desaparecimento.

### 3. Vocabulário canônico de evidência

`src/domain/evidencia.ts` define `StatusEvidencia` com os sete valores do plano e duas funções puras:

- `statusEvidenciaEvento()`: falha > oclusão > lacuna > hipótese > conclusão. Interação confirmada com duas ou mais evidências é `inferido`; proximidade (`provavel`) continua `possivel`.
- `statusEvidenciaCena()`: adapta `confirmacao` sem transformar `nao_confirmado` em ausência.

Itens e mudanças de cena passaram a carregar `statusEvidencia` de forma aditiva.

### 4. Identidade individual e reidentificação

`RastreadorEntidades` passou a expor:

- `estadoIdentidade`: `confirmada | provavel | ambiga | perdida`, separado do ciclo de vida do track (`ativa | ausente | perdida`);
- `historicoObservacoes`: até 10 observações leves por entidade, com tempo, posição, confiança e `frameId`;
- reassociação após lacuna com `raioAmbiguidadeReassociacao`: distâncias dentro do raio confiável preservam o ID como `confirmada`; distâncias maiores preservam o ID, mas marcam `ambiga`.

### 5. Inventário multi-instância

`construirReferencia()` aceita `consolidacao: "automatica" | "instancia" | "rotulo"`.

- `automatica` (padrão): usa `instanciaId` quando presente e mantém o comportamento legado (um item por rótulo) para lotes antigos sem identidade;
- `instancia`: agrupa por `instanciaId`/`objetoId`, mantendo duas cadeiras separadas;
- `rotulo`: força a consolidação antiga.

A comparação prioriza `instanciaId` sobre proximidade espacial, reúne evidências por instância e marca `associacao: "ambiga"` quando duas caixas são igualmente prováveis — nesse caso a mudança deixa de ser `observado` e vira `possivel`, com confiança limitada a 0,6. Um novo objeto de uma classe já presente só é anunciado quando não há referência livre da mesma classe.

## Validação executada

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | OK |
| `npm run lint` | OK |
| `npm test` | 162 arquivos, 1094 testes, todos aprovados |
| `npm run build` | OK (`dist/server.js` 179,2 kB; `public/app.js` 404,6 kB) |
| `npm run test:e2e` | 19 aprovados, 7 pulados, 0 falhas |

Os 11 testes novos cobrem: derivação de status, não conversão de falha/oclusão em remoção, evento ligado ao frame de origem, separação pedido/captura, duas instâncias da mesma classe, compatibilidade do contrato legado, associação ambígua e reidentificação após oclusão, e autoridade do servidor sobre `statusEvidencia`/`persistidoEmMs`.

## Limites desta fase

- A ponte de produção `YOLO/ObservacaoFrame[] → ServicoCena` continua na Fase 2; aqui foi preparado o contrato de dados para ela.
- Não há desvio de relógio calculado de verdade (seria preciso trocar hora com o servidor); o campo existe, mas permanece opcional e não preenchido.
- A interface de revisão do inventário e a confirmação automática de mudanças pertencem à Fase 2.
- Nenhum teste com detector real ou câmera física foi acrescentado nesta fase, pelos mesmos motivos do baseline (backend/clipe indisponíveis).
