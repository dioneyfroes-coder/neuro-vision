# Arquitetura — Neuro Vision

Estrutura de arquivos e como as partes conversam.

## Visão geral

- **Servidor Node** (`src/server.ts`) — arquivos estáticos + API REST + persistência JSONL + snapshots + proxy para o backend de visão local.
- **Domínio** (`src/domain/`) — contratos puros (IDs de sessão/ciclo/frame, observação, resultados de percepção, evento temporal, pacote de ciclo, resultado de interpretação e métricas) sem dependência de SDK de modelo.
- **Controlador do ciclo** (`public/cycle/cycle-controller.ts`) — regra de negócio do ciclo de frame único (captura, inferência, rastreamento, persistência e progresso) com dependências injetadas; emite `EventoUi` em vez de tocar o DOM.
- **Ciclo multiframe** (`public/cycle/ciclo-multiframe.ts`) — captura 4 snapshots identificados (~1 s), guarda-os sem inferência, processa-os em sequência e envia o `PacoteCiclo` à interpretação multimodal. As imagens que chegam ao interpretador são as mesmas capturadas (sem recaptura). Ainda não está ligado à interface: a ligação acontece nas Etapas 5–7.
- **Pipeline local de percepcao** (`public/perception/local-perception-pipeline.ts`) — executa detector, pose (YOLO Pose) e maos/gestos (MediaPipe) por snapshot em sequencia, com isolamento de falhas: um subsistema quebrado vira `ResultadoIndisponivel` e nao apaga os demais. Usa portas em `public/perception/contracts.ts`.
- **Adaptadores de percepção** (`public/perception/`) — portas `DetectorObjetos`, `EstimadorPose` e `ReconhecedorGestos` independentes do SDK; o núcleo conhece apenas essas interfaces, e cada SDK entra por um adaptador em `public/perception/adapters/` (`object-detector.adapter.ts`, `pose-estimator.adapter.ts`, `hand-gesture.adapter.ts`). Motores SDK concretos: `public/detector.ts` (Transformers.js), `public/pose.ts` (YOLO Pose via Transformers.js) e `public/gestos.ts` (MediaPipe Gesture Recognizer).
- **Composicao da percepcao** (`public/perception/percepcao-local.ts`) — cria os adaptadores concretos, coordena o carregamento isolado (`configurarSubsistemas`) e expõe `processarFrame` pronto para o ciclo multiframe; ainda nao esta ligada a UI.

## Estrutura

```
src/
  server.ts            servidor HTTP (estático + API) e persistência (memória + snapshots)
  memoria.ts           armazenamento JSONL genérico, eventos, registros operacionais e reidratação de contexto
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
  domain/              contratos puros do domínio (sem SDK de modelo)
    ids.ts             IDs de sessão/ciclo/frame e timestamps de captura x processamento
    perception.ts      caixas, detecções, pose, mãos e indisponibilidade (contratos de percepção)
    observation.ts     observação do frame (imagem, IDs e resultado de cada subsistema)
    temporal-event.ts  evento temporal (transições, IDs de frames de evidência)
    cycle.ts           pacote do ciclo e métricas por etapa
    interpretation.ts  resultado de interpretação (narrativa, evidências, incertezas)
    adapters.ts        pontes explícitas entre domínio e tipos legados
    index.ts           reexporta os contratos
public/
  index.html           interface
  app.ts               ponto de composição: liga botões/seletores, cria dependências e renderiza os `EventoUi`
  cycle/
    cycle-controller.ts  controlador do ciclo de frame único (captura, inferência, rastreamento, persistência, progresso)
    ciclo-multiframe.ts  ciclo de 4 snapshots: captura → processamento local sequencial → pacote → interpretação
  capture/
    webcam-capture.ts    coleta snapshots identificados em intervalo (sem inferência; cancelável)
    snapshot-store.ts    buffer de snapshots com retenção limitada e limpeza
  perception/
    contracts.ts       portas `DetectorObjetos`, `EstimadorPose` e `ReconhecedorGestos` (sem SDK de modelo)
    local-perception-pipeline.ts  pipeline sequencial por snapshot com isolamento de falhas
    percepcao-local.ts  composicao concreta (adaptadores + motor SDK + configuracao isolada)
    adapters/
      object-detector.adapter.ts  adaptador do detector instalado (Transformers.js) para a porta
      pose-estimator.adapter.ts   adaptador do estimador de pose (YOLO Pose) para a porta
      hand-gesture.adapter.ts    adaptador do reconhecedor de maos/gestos (MediaPipe) para a porta
  interpretation/
    contracts.ts       porta `InterpretadorMultimodal` (recebe o pacote; nunca captura a câmera)
  api.ts               cliente HTTP (histórico, eventos, contexto, backend de visão)
  detector.ts          módulo do SDK Transformers.js/CDN (classe `DetectorTransformers`)
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
tests/
  *.test.ts            testes unitários/integração (vitest)
  scripts/*.test.mjs   testes dos scripts de benchmark/qualidade
logs/
  visao.jsonl          observações gravadas (ignorado no git)
  eventos.jsonl        eventos estruturados (ignorado no git)
  operacional.jsonl    registros operacionais (ignorado no git)
bench/
  imagens/             conjunto fixo de imagens do benchmark (reproduzível)
  videos/              anotações dos clipes de avaliação de eventos (vídeos ficam locais)
  BASELINE.md          máquina de referência e metas realistas por hardware
scripts/
  benchmark.mjs        benchmark comparativo dos modelos do backend de visão (latência, tok/s, inferências/min)
  gerar-fixtures-bench.mjs  gera o conjunto fixo de imagens sintéticas
  avaliar-qualidade.mjs     compara eventos gravados com a anotação (precisão/recall/FP por minuto)
  gravar-webcam.mjs         grava alguns segundos da webcam em .webm (clipe de avaliação)
  extrair-frames.mjs        extrai quadros de um clipe para anotação
```

## Fluxo de uma análise

1. O `CycleController` (`public/cycle/cycle-controller.ts`) comanda o ciclo; o agendador dispara um ciclo no ritmo `max(intervalo, duração da análise anterior + 500 ms)`. As dependências (câmera, fábrica de motores, rastreador, política e fila de persistência) são **injetadas** por `app.ts`, não criadas dentro do controlador.
2. A webcam **captura o frame uma única vez** (`Camera.capturarQuadro`): a mesma imagem vira entrada da análise, snapshot (thumbnail dos mesmos pixels) e assinatura de cena; o instante vira `capturadoEm`.
3. O motor escolhido pelo `MODOS` roda: detecção no navegador (Transformers.js, atrás da porta `DetectorObjetos`) ou descrição/roteiro via `POST /api/visao` → backend de visão local (stream NDJSON). O adaptador normaliza a saída do SDK (rótulos, caixas em pixels, confiança em [0,1], dimensões) e mede carga, inferência e memória.
4. O resultado normalizado (`ResultadoPercepcao`) vira uma `EntradaLog` (`entradaDeResultado`), exibida no histórico e gravada via `POST /api/log`.
5. Nos modos com rastreamento, o `RastreadorObjetos` associa detecções entre frames e emite eventos (`aparicao`/`desaparecimento`/`movimento`); o `DetectorMudancaDeCena` emite `mudanca_de_cena` como sinal.
6. A política de análise decide se o modelo de visão deve ser chamado, registrando o motivo — ver [`eventos.md`](./eventos.md).
7. Entradas e eventos entram na fila de persistência (`public/persistencia.ts`): gravação serial em ordem, com retentativas e `idempotencyKey` (o servidor deduplica reenvios). Falhas persistentes aparecem no aviso/diagnóstico e podem ser exportadas pelo botão **Pendentes**.
8. Em vez de tocar o DOM, o controlador emite `EventoUi` (status, spinner, entrada, caixas, canvas, pronto, falha, parado); `app.ts` traduz cada evento na renderização da interface.

## Testes e regressão

- Unitários/integração: `npm test` (vitest, incluindo `percepcao`, `motores`, `rastreamento`, `cena`, `memoria`, `server`, `politica-analise`, `provedor`, `visao`).
- E2E: `npm run test:e2e` (Playwright; o transformers.js é substituído por stubs em `e2e/app.spec.ts`; `e2e/webcam.spec.ts` é opt-in com modelo real).
- Desempenho/qualidade: ver [`qualidade.md`](./qualidade.md).