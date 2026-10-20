# Arquitetura — Neuro Vision

Estrutura de arquivos e como as partes conversam.

## Visão geral

- **Servidor Node** (`src/server.ts`) — arquivos estáticos + API REST + snapshots + proxy para o backend de visão local. É o **ponto de composição** da persistência: expõe as rotas e delega a leitura/escrita aos repositórios.
- **Camada de persistência** (`src/persistence/`) — primitivas JSONL (`armazenamento-jsonl.ts`) e um repositório por tipo de registro (observações, eventos, registros operacionais e ciclos). Cada repositório só conhece o seu arquivo; o servidor HTTP não carrega detalhes de armazenamento.
- **Domínio** (`src/domain/`) — contratos puros (IDs de sessão/ciclo/frame, observação, resultados de percepção, evento temporal, pacote de ciclo, resultado de interpretação e métricas) sem dependência de SDK de modelo.
- **Controlador do ciclo** (`public/cycle/cycle-controller.ts`) — regra de negócio do ciclo de frame único (captura, inferência, rastreamento, persistência e progresso) com dependências injetadas; emite `EventoUi` em vez de tocar o DOM.
- **Ciclo multiframe** (`public/cycle/ciclo-multiframe.ts`) — captura 4 snapshots identificados (~1 s), guarda-os sem inferência, processa-os em sequência, roda a leitura temporal e envia o `PacoteCiclo` à interpretação multimodal. As imagens que chegam ao interpretador são as mesmas capturadas (sem recaptura). Sem frame disponível o ciclo retorna vazio, sem interpretar nem persistir (não é falha).
- **Controlador multiframe** (`public/cycle/ciclo-percepcao-controller.ts`) — liga o pipeline completo (captura + percepção local + motor temporal + interpretação) à interface, como `ControladorCiclo` do modo `percepcao`; emite `EventoUi`, persiste o diagnóstico do ciclo (best-effort) e grava os **eventos temporais confirmados** em `eventos.jsonl` (uma gravação por identidade, `timestamp` = início real — ver [`eventos.md`](./eventos.md)).
- **Pipeline local de percepcao** (`public/perception/local-perception-pipeline.ts`) — executa detector, pose (YOLO Pose) e maos/gestos (MediaPipe) por snapshot em sequencia, com isolamento de falhas: um subsistema quebrado vira `ResultadoIndisponivel` e nao apaga os demais. Usa portas em `public/perception/contracts.ts`.
- **Adaptadores de percepção** (`public/perception/`) — portas `DetectorObjetos`, `EstimadorPose` e `ReconhecedorGestos` independentes do SDK; o núcleo conhece apenas essas interfaces, e cada SDK entra por um adaptador em `public/perception/adapters/` (`object-detector.adapter.ts`, `pose-estimator.adapter.ts`, `hand-gesture.adapter.ts`). Motores SDK concretos: `public/detector.ts` (Transformers.js), `public/pose.ts` (YOLO Pose via Transformers.js) e `public/gestos.ts` (MediaPipe Gesture Recognizer).
- **Composicao da percepcao** (`public/perception/percepcao-local.ts`) — cria os adaptadores concretos (reaproveitando o detector já carregado), coordena o carregamento isolado (`configurarSubsistemas`, com override de modelos por sessão) e expõe `processarFrame` pronto para o ciclo multiframe.
- **Motor temporal** (`public/temporal/`) — encapsula o rastreamento de objetos (`rastreamento.ts`) e a mudança de cena (`cena.ts`) **sem reescrever os algoritmos** e adiciona rastreadores de pose (pessoas) e mãos com IDs estáveis na sessão, suavização e métricas de movimento em coordenadas normalizadas, além de máquinas de estado de gestos e de braço levantado com confirmação/encerramento temporais. Emite `EventoTemporal` (identidade única, duração, confiança, timestamps e IDs dos frames de evidência) e trata frames ausentes, inferências falhas, mudanças de resolução (coordenadas normalizadas) e períodos cegos. O estado é reutilizado entre ciclos; `resetar()` só é chamado em evento explícito de sessão.
- **Variantes do benchmark** (`public/perception/variantes.ts`) — a matriz A–D da Etapa 9 num único registro (`percepcaoLocal` × `dadosLocais` × `temporal`): B = só sequência de imagens, C = dados locais + temporal básico, D = arquitetura-alvo completa; A é o fluxo de frame único dos modos existentes. O modo (seletor `#motor`) declara a variante, em vez de condições espalhadas pelo código. A decisão arquitetural que usa essa matriz está em `bench/DECISAO_ARQUITETURAL_2026-10-19.md`.

## Estrutura

```
src/
  server.ts            servidor HTTP (estático + API) e composição da persistência (memória + snapshots)
  memoria.ts           reidratação de contexto e montagem de entradas/eventos (reexporta as primitivas JSONL de `persistence/`)
  politica-analise.ts  política de análise orientada a eventos (cooldown, janela, motivos)
  percepcao.ts         interface de motor de percepção e resultado normalizado
  erros.ts             taxonomia de erros (origem, cancelamento)
  rastreamento.ts      rastreador de objetos (IDs estáveis, aparição/desaparecimento/movimento)
  cena.ts              detecção de mudança de cena (sinal)
  provedor.ts          camada de protocolo do backend de visão (chat completions / LM Studio)
  visao.ts             cliente de visão (modelos, prompts de descrição/roteiro, geração e tradução)
  texto.ts             pós-processamento: colapsa repetições, detecta "sem mudança", corta frase incompleta
  types.ts             tipos compartilhados (EntradaLog, ObjetoVisto, EventoVisual, ...)
  env.ts               variáveis de ambiente (carrega o .env e expõe os padrões)
  transformers-cdn.d.ts  tipos para o transformers.js via CDN
  mediapipe-cdn.d.ts    tipos para o MediaPipe (Tasks Vision) via CDN
  domain/              contratos puros do domínio (sem SDK de modelo)
    ids.ts             IDs de sessão/ciclo/frame e timestamps de captura x processamento
    perception.ts      caixas, detecções, pose, mãos e indisponibilidade (contratos de percepção)
    observation.ts     observação do frame (imagem, IDs e resultado de cada subsistema)
    temporal-event.ts  evento temporal (transições, IDs de frames de evidência)
    cycle.ts           pacote do ciclo e métricas por etapa
    interpretation.ts  resultado de interpretação (narrativa, evidências, incertezas)
    index.ts           reexporta os contratos
  persistence/         camada de persistência (Etapa 8): primitivas JSONL + repositórios por registro
    armazenamento-jsonl.ts      append com rotação, leitura das últimas linhas e limpeza de arquivos JSONL
    repositorio-observacoes.ts  histórico de observações (`EntradaLog`)
    repositorio-eventos.ts      eventos estruturados (`EventoVisual`) + idempotência por arquivo
    repositorio-operacional.ts  registros operacionais (falhas/métricas que não são eventos)
    repositorio-ciclos.ts       registros de ciclo (`RegistroCiclo`) para diagnóstico
public/
  index.html           interface
  app.ts               ponto de composição: liga botões/seletores, cria dependências e renderiza os `EventoUi`
  cycle/
    cycle-controller.ts  controlador do ciclo de frame único (captura, inferência, rastreamento, persistência, progresso)
    ciclo-multiframe.ts  ciclo de 4 snapshots: captura → processamento local sequencial → temporal → pacote → interpretação
    ciclo-percepcao-controller.ts  controlador do modo multiframe (liga pipeline + temporal + interpretação à interface)
  capture/
    webcam-capture.ts    coleta snapshots identificados em intervalo (sem inferência; cancelável)
    snapshot-store.ts    buffer de snapshots com retenção limitada e limpeza
  perception/
    contracts.ts       portas `DetectorObjetos`, `EstimadorPose` e `ReconhecedorGestos` (sem SDK de modelo)
    local-perception-pipeline.ts  pipeline sequencial por snapshot com isolamento de falhas
    percepcao-local.ts  composicao concreta (adaptadores + motor SDK + configuracao isolada)
    variantes.ts       matriz de variantes do benchmark A–D (Etapa 9)
    adapters/
      object-detector.adapter.ts  adaptador do detector instalado (Transformers.js) para a porta
      pose-estimator.adapter.ts   adaptador do estimador de pose (YOLO Pose) para a porta
      hand-gesture.adapter.ts    adaptador do reconhecedor de maos/gestos (MediaPipe) para a porta
  interpretation/
    contracts.ts       porta `InterpretadorMultimodal` (recebe o pacote; nunca captura a câmera)
    interpretador-ciclo.ts  interpretador do ciclo multiframe (monta a mensagem do `PacoteCiclo`)
    contexto.ts        montagem do contexto estruturado (dados locais + resumo temporal)
    prompt.ts          instruções do prompt (orientação a eventos, resposta em PT-BR)
    normalizar.ts      normalização da resposta (JSON estruturado; falha vira texto bruto, sem mascarar erros)
    transporte-servidor.ts  transporte `POST /api/visao` (stream NDJSON)
  temporal/
    contracts.ts       config do motor/rastreadores/máquinas e a porta `MotorTemporal`
    suavizador.ts      suavização exponencial e métricas de movimento (coordenadas normalizadas)
    rastreador-entidades.ts  rastreador genérico (pose/mãos) com IDs estáveis na sessão
    maquina-sinais.ts  máquina de estados com confirmação/encerramento temporais (gestos e braço)
    motor-temporal.ts  fachada: objetos + cena + pose + mãos + máquinas → `ResumoTemporal`
  api.ts               cliente HTTP (histórico, eventos, contexto, backend de visão)
  detector.ts          helpers da detecção (COCO → português, resumo do log; sem SDK)
  yolo-onnx.ts         detector de objetos YOLOv10 em ONNX (`onnxruntime-web`, WASM; catálogo COCO + inferência)
  pose.ts              motor SDK para YOLO Pose (Transformers.js) usado pelo adaptador
  gestos.ts            motor SDK para MediaPipe Gesture Recognizer (Tasks Vision) usado pelo adaptador
  camera.ts            controle da webcam e assinatura de cena
  modos.ts             registro de modos/motores (Item do roadmap: trocar motor sem espalhar condições)
  motores.ts           adaptadores para o motor de percepção (deteccao usa a porta `DetectorObjetos`)
  persistencia.ts      fila de gravação (ordem, retentativas, falhas expostas)
  scheduler.ts         agendador do próximo ciclo (ritmo `max(intervalo, duração + 500 ms)`)
  style.css            estilos
e2e/
  app.spec.ts          fluxos de interface (com o transformers.js substituído)
  webcam.spec.ts       avaliação com clipe real de webcam (opt-in; modelo real)
  webcam-multiframe.spec.ts  3 modos multiframe com clipe na webcam (opt-in; grava eventos/entradas/ciclos em `logs/e2e-multiframe-*`)
tests/
  *.test.ts            testes unitários/integração (vitest)
  scripts/*.test.mjs   testes dos scripts de benchmark/qualidade
logs/
  visao.jsonl          observações gravadas (ignorado no git)
  eventos.jsonl        eventos estruturados (ignorado no git)
  operacional.jsonl    registros operacionais (ignorado no git)
  ciclos.jsonl         diagnósticos por ciclo (ignorado no git)
bench/
  imagens/             conjunto fixo de imagens do benchmark (reproduzível)
  videos/              anotações dos clipes de avaliação de eventos (vídeos ficam locais)
  clipes/              clipes do benchmark A–D separados em tuning/ e eval/ (+ MATRIZ_COBERTURA.md)
  BASELINE.md          máquina de referência e metas realistas por hardware (imutável; relatórios novos vão para RELATORIO_*/COMPARATIVO_*)
scripts/
  benchmark.mjs        benchmark comparativo dos modelos do backend de visão (latência, tok/s, inferências/min)
  benchmark-variantes.mjs  compara as variantes A–D sobre os mesmos clipes (desempenho + qualidade + verificação de modelo)
  gerar-fixtures-bench.mjs  gera o conjunto fixo de imagens sintéticas
  avaliar-qualidade.mjs     compara eventos gravados com a anotação (precisão/recall/FP por minuto)
  gravar-webcam.mjs         grava alguns segundos da webcam em .webm (clipe de avaliação)
  extrair-frames.mjs        extrai quadros de um clipe para anotação
```

## Modos multiframe (variantes B/C/D)

Os modos `percepcao`, `percepcao-fundida` e `percepcao-sequencia` (opções **Percepção**, **Percepção fundida** e **Percepção sequência** no seletor de motor) trocam o `CycleController` de frame único por um `CicloPercepcaoController`. Os dois implementam `ControladorCiclo`, e `app.ts` escolhe a implementação por `obterModo(motor).multiframe` — a interface usa sempre a mesma superfície (`iniciar`, `parar`, `solicitarManual`, …). O que muda entre eles é apenas a `VariantePercepcao` (`public/perception/variantes.ts`):

| Variante | Modo | Percepção local | Dados locais no payload | Temporal |
| --- | --- | --- | --- | --- |
| **B** | `percepcao-sequencia` | não | não | ausente |
| **C** | `percepcao-fundida` | sim | sim | básico (objetos + cena) |
| **D** | `percepcao` | sim | sim | ampliado (pose/mãos + máquinas de estado) |

A variante **A** (referência) é o fluxo de frame único dos modos existentes (`deteccao`/`eventos`/`visao`) e não usa este ciclo. Comparação e decisão em `bench/COMPARATIVO_A_B_C_D_*.md` e `bench/DECISAO_ARQUITETURAL_2026-10-19.md`; execução reproduzível em [`qualidade.md`](./qualidade.md).

1. A cada ciclo o `WebcamCapture` coleta 4 snapshots identificados (~1 s) **sem inferência** e os guarda no `SnapshotStore`.
2. O `PercepcaoLocal` processa os snapshots em sequência: detecção (porta `DetectorObjetos`, reaproveitando o modelo já carregado), pose (YOLO Pose) e mãos/gestos (MediaPipe) — nos modos C/D; a variante B pula esta etapa. Cada subsistema é isolado: uma falha vira `ResultadoIndisponivel` para aquele frame e não apaga os demais. Se **nenhum** subsistema carregar, a sessão não inicia.
3. O `MotorTemporalImpl` consome as observações e devolve um `ResumoTemporal` (eventos com identidade e continuidade entre ciclos) que entra no `PacoteCiclo`. No fim do ciclo, eventos `confirmado`/`encerrado` de tipo `aparicao`/`desaparecimento`/`mudanca_de_cena` são gravados **uma única vez por `eventoId`** em `eventos.jsonl` (`origem: "rastreador"`, `timestamp` = início real — ver [`eventos.md`](./eventos.md)).
4. O `InterpretadorCiclo` interpreta o pacote pelo transporte do servidor (`POST /api/visao` via `transporte-servidor.ts`) e devolve a narrativa. O campo `modelo` vem de um getter dinâmico: a seleção atual do seletor, ou o modelo efetivo do backend (`/api/health`) — nunca um placeholder.
5. O diagnóstico do ciclo é gravado em `POST /api/ciclos`; a entrada do histórico entra na `FilaPersistencia` como nos demais modos. A troca de modo/início de sessão reseta o estado temporal (`MotorTemporal.resetar()`) e o dedupe de eventos da sessão.

A ausência de frames (câmera sem imagem) não é tratada como falha: o ciclo retorna vazio, sem interpretação e sem persistência.

## Fluxo de uma análise

1. O `CycleController` (`public/cycle/cycle-controller.ts`) comanda o ciclo; o agendador dispara um ciclo no ritmo `max(intervalo, duração da análise anterior + 500 ms)`. As dependências (câmera, fábrica de motores, rastreador, política e fila de persistência) são **injetadas** por `app.ts`, não criadas dentro do controlador.
2. A webcam **captura o frame uma única vez** (`Camera.capturarQuadro`): a mesma imagem vira entrada da análise, snapshot (thumbnail dos mesmos pixels) e assinatura de cena; o instante vira `capturadoEm`.
3. O motor escolhido pelo `MODOS` roda: detecção no navegador (Transformers.js, atrás da porta `DetectorObjetos`) ou descrição/roteiro via `POST /api/visao` → backend de visão local (stream NDJSON). O adaptador normaliza a saída do SDK (rótulos, caixas em pixels, confiança em [0,1], dimensões) e mede carga, inferência e memória.
4. O resultado normalizado (`ResultadoPercepcao`) vira uma `EntradaLog` (`entradaDeResultado`), exibida no histórico e gravada via `POST /api/log`.
5. Nos modos com rastreamento, o `RastreadorObjetos` associa detecções entre frames e emite eventos (`aparicao`/`desaparecimento`/`movimento`); o `DetectorMudancaDeCena` emite `mudanca_de_cena` como sinal. O `MotorTemporal` (`public/temporal/`) encapsula esses dois algoritmos e acrescenta rastreamento de pose/mãos com IDs estáveis, suavização e métricas de movimento, e máquinas de estado de gestos/braço com confirmação temporal; a saída é um `ResumoTemporal` de `EventoTemporal` de identidade única, com frames de evidência e duração.
6. A política de análise decide se o modelo de visão deve ser chamado, registrando o motivo — ver [`eventos.md`](./eventos.md).
7. Entradas e eventos entram na fila de persistência (`public/persistencia.ts`): gravação serial em ordem, com retentativas e `idempotencyKey` (o servidor deduplica reenvios). Falhas persistentes aparecem no aviso/diagnóstico e podem ser exportadas pelo botão **Pendentes**.
8. Em vez de tocar o DOM, o controlador emite `EventoUi` (status, spinner, entrada, caixas, canvas, pronto, falha, parado); `app.ts` traduz cada evento na renderização da interface.

## Persistência, diagnóstico e recuperação

A persistência é separada do servidor HTTP (`src/persistence/`), com uma primitiva JSONL e um repositório por tipo de registro. Cada arquivo tem rotação por tamanho (`LOG_MAX_BYTES`):

| Registro | Arquivo | Repositório | Rota de escrita/leitura | Limpeza |
| --- | --- | --- | --- | --- |
| Observações (`EntradaLog`) | `visao.jsonl` | `repositorio-observacoes.ts` | `POST /api/log`, `GET /api/logs` | `DELETE /api/logs` |
| Eventos (`EventoVisual`) | `eventos.jsonl` | `repositorio-eventos.ts` | `POST /api/eventos`, `GET /api/eventos` | `DELETE /api/eventos` |
| Operacionais (`RegistroOperacional`) | `operacional.jsonl` | `repositorio-operacional.ts` | `POST /api/operacional` | `DELETE /api/logs` |
| Ciclos (`RegistroCiclo`) | `ciclos.jsonl` | `repositorio-ciclos.ts` | `POST /api/ciclos`, `GET /api/ciclos` | `DELETE /api/ciclos` |

- **Diagnóstico por ciclo.** `RegistroCiclo` (derivado de `ResultadoCiclo` por `criarRegistroCiclo`, em `src/domain/cycle.ts`) reúne métricas por etapa (`capturaMs`, `deteccaoMs`, `poseMs`, `maosMs`, `temporalMs`, `multimodalMs`, `persistenciaMs`, `totalMs`), os `erros` por etapa, os `subsistemasIndisponiveis` e a **relação** entre sessão, ciclo e imagens (`sessionId`, `cycleId`, `frameIds`). As imagens não são copiadas: vivem nos snapshots, referenciados por `frameId`.
- **Ciclos incompletos continuam diagnosticáveis.** O `executarCicloMultiframe` aceita um `persistirCiclo` opcional. Ao final do ciclo envia o registro; em falha/cancelamento, registra um **registro parcial** (frames já observados, erros e a flag `cancelado`) antes de propagar o erro. A falha de **gravação** nunca derruba o ciclo: vira um `ErroEtapa` de etapa `persistencia` e o resultado da inferência segue válido (falha de logging ≠ falha de inferência).
- **IDs únicos.** `sessionId`, `cycleId` e `frameId` são gerados em `src/domain/ids.ts` com um componente aleatório/sequencial de sessão, o que evita colisão com o histórico de execuções anteriores.
- **Idempotência.** Os eventos guardam uma `idempotencyKey` por arquivo (`repositorio-eventos.ts`), de modo que o reenvio da fila de persistência do cliente após uma falha transitória não duplica o evento. Limpar o arquivo invalida as chaves antigas.
- **Idempotência de leitura/`response.ok`.** O cliente (`public/api.ts`) só trata uma operação como concluída após `response.ok`; `gravarCiclo`/`listarCiclos` seguem o mesmo contrato das demais rotas.
- **Semântica de "limpar histórico".** `DELETE /api/logs` apaga os **dados persistidos** (observações, eventos, registros de ciclo e os snapshots que ficaram órfãos) — não é o mesmo que **resetar o estado temporal em memória** do cliente, que é uma ação separada. `DELETE /api/eventos` e `DELETE /api/ciclos` limpam apenas o seu próprio arquivo.

## Testes e regressão

- Unitários/integração: `npm test` (vitest, incluindo `percepcao`, `motores`, `rastreamento`, `cena`, `motor-temporal`, `memoria`, `persistence`, `server`, `politica-analise`, `provedor`, `visao`, ciclos multiframe e os testes dos scripts `tests/scripts/*.test.mjs`).
- E2E: `npm run test:e2e` (Playwright; o transformers.js é substituído por stubs em `e2e/app.spec.ts`; `e2e/webcam.spec.ts` e `e2e/webcam-multiframe.spec.ts` são **opt-in** com modelo real e clipe via `E2E_WEBCAM_*`).
- Desempenho/qualidade: ver [`qualidade.md`](./qualidade.md).