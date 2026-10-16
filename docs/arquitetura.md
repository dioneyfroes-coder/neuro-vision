# Arquitetura — Neuro Vision

Estrutura de arquivos e como as partes conversam.

## Visão geral

- **Servidor Node** (`src/server.ts`) — arquivos estáticos + API REST + persistência JSONL + snapshots + proxy para o backend de visão local.
- **Cliente** (`public/`) — interface, captura da webcam, detecção no navegador (Transformers.js) e cliente HTTP.
- **Motores de percepção** — interface única `MotorPercepcao` (`inicializar`/`analisar`/`encerrar`); o app escolhe o motor pelo registro `MODOS` (`public/modos.ts`), sem `if (modo === ...)` espalhado.

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
public/
  index.html           interface
  app.ts               coordenação da interface (captura, motores, rastreamento, eventos)
  api.ts               cliente HTTP (histórico, eventos, contexto, backend de visão)
  detector.ts          detecção de objetos (Transformers.js/CDN)
  camera.ts            controle da webcam e assinatura de cena
  modos.ts             registro de modos/motores (Item do roadmap: trocar motor sem espalhar condições)
  motores.ts           adaptadores para o motor de percepção
  persistencia.ts      fila de gravação (ordem, retentativas, falhas expostas)
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

1. O agendador do cliente dispara um ciclo no ritmo `max(intervalo, duração da análise anterior + 500 ms)`.
2. A webcam **captura o frame uma única vez** (`Camera.capturarQuadro`): a mesma imagem vira entrada da análise, snapshot (thumbnail dos mesmos pixels) e assinatura de cena; o instante vira `capturadoEm`.
3. O motor escolhido pelo `MODOS` roda: detecção no navegador (Transformers.js) ou descrição/roteiro via `POST /api/visao` → backend de visão local (stream NDJSON).
4. O resultado normalizado (`ResultadoPercepcao`) vira uma `EntradaLog` (`entradaDeResultado`), exibida no histórico e gravada via `POST /api/log`.
5. Nos modos com rastreamento, o `RastreadorObjetos` associa detecções entre frames e emite eventos (`aparicao`/`desaparecimento`/`movimento`); o `DetectorMudancaDeCena` emite `mudanca_de_cena` como sinal.
6. A política de análise decide se o modelo de visão deve ser chamado, registrando o motivo — ver [`eventos.md`](./eventos.md).
7. Entradas e eventos entram na fila de persistência (`public/persistencia.ts`): gravação serial em ordem, com retentativas e `idempotencyKey` (o servidor deduplica reenvios). Falhas persistentes aparecem no aviso/diagnóstico e podem ser exportadas pelo botão **Pendentes**.

## Testes e regressão

- Unitários/integração: `npm test` (vitest, incluindo `percepcao`, `motores`, `rastreamento`, `cena`, `memoria`, `server`, `politica-analise`, `provedor`, `visao`).
- E2E: `npm run test:e2e` (Playwright; o transformers.js é substituído por stubs em `e2e/app.spec.ts`; `e2e/webcam.spec.ts` é opt-in com modelo real).
- Desempenho/qualidade: ver [`qualidade.md`](./qualidade.md).