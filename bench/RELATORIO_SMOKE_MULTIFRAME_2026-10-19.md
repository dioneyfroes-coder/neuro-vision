# Relatório de smoke E2E multiframe — 2026-10-19

Resultado da primeira execução real dos modos multiframe com clipe rodando no
lugar da webcam (`e2e/webcam-multiframe.spec.ts` — pipeline REAL, sem mocks).
Não substitui `bench/BASELINE.md` nem os relatórios do harness de variantes.

## Configuração da execução

- **Clipe:** `bench/videos/webcam-mudanca.webm` (30 s, 640×480) — pessoa em um
  quarto segurando bebida; sai do quadro por volta dos ~19,5 s.
- **App:** `#motor` alternado entre os 3 modos multiframe; intervalo 1 frame/s
  (4 frames por ciclo).
- **IA local:** LM Studio online (`qwen2.5-vl-3b-instruct` entre os modelos
  instalados); Chromium do Playwright **sem WebGPU** (WASM/CPU).
- **Máquina:** Intel Xeon E5-2660 v3 @ 2,60 GHz — 20 núcleos — 15,8 GB RAM —
  win32 10.0.26200 — Node v24.19.0.
- **Comando:** `E2E_WEBCAM_CLIP=bench/videos/webcam-mudanca.webm`
  `E2E_WEBCAM_EVENTOS=logs/e2e-multiframe`
  `npx playwright test e2e/webcam-multiframe.spec.ts --workers=1`
- **Resultado dos testes:** 3 passed em 11,2 min (B 3,5 min · C 3,8 min · D 3,8 min).

## Interpretação recebida da IA local (variante B)

A aplicação capturou 4 frames (1/s), montou o contexto e enviou ao modelo, que
respondeu (`logs/e2e-multiframe-percepcao-sequencia.log.jsonl`):

> "Na sessão, um indivíduo sem camisa está em uma área interna com uma cama de
> madeira e uma janela com cortinas. Ele está segurando e beberá uma bebida de
> um copo transparente."

Correto quanto ao conteúdo do clipe. **Este é o fim a fim desejado:** vídeo no
lugar da webcam → 4 imagens → IA local → explicação exibida e persistida.

## Ciclos persistidos (`RegistroCiclo`)

| Modo (variante) | Ciclo | Frames | Concluído | Métricas | Situação |
|-----------------|-------|-------:|-----------|----------|----------|
| `percepcao-sequencia` (B) | `c9f0f359-c3` | 4 | sim | captura 3.032 ms · **multimodal 33.717 ms** · **total 36.769 ms** | interpretação gravada |
| `percepcao-sequencia` (B) | `c9f0f359-c4` | 4 | não | captura 3.023 ms | cancelado (parou o teste com ciclo em voo) |
| `percepcao-fundida` (C) | `e80f0be7-c2` | 2 | não | (vazio) | em voo 75 s, cancelado; percepção local ativa (indisponível só `maos`) |
| `percepcao` (D) | `e3a82e49-c2` | 2 | não | (vazio) | em voo 77 s, cancelado; percepção local ativa (indisponível só `maos`) |

Em B, `subsistemasIndisponiveis: [deteccao, pose, maos]` — correto para a
variante B (sem percepção local). Em C/D a detecção e a pose passaram a rodar.

## Achados

1. **Latência do LM Studio domina o ciclo (~34 s por chamada de 4 imagens em
   CPU/WASM).** Enquanto a chamada multimodal está em voo, o ciclo seguinte não
   avança: um clipe de 30 s rendeu apenas 1 ciclo concluído em B e nenhum em
   C/D (>75 s em voo, cancelados ao parar o teste). Para comparativas
   representativas, rodar com `E2E_WEBCAM_CHANNEL="chrome"` (WebGPU) ou modelo
   de visão menor.
2. **`visao_timeout` no servidor** (1 ocorrência, durante o carregamento do
   modo B): o backend abortou uma chamada de visão por timeout.
3. **Bug corrigido durante o run:** o campo `modelo` das entradas registrava
   `"multiframe"` (fallback) porque o interpretador congelava o nome do modelo
   na criação da sessão, antes do `#modeloVisao` estar populado. Corrigido em
   `public/interpretation/interpretador-ciclo.ts` (`modelo` agora é getter,
   resolvido a cada ciclo — trocar o modelo na interface vale no próximo
   ciclo); coberto por teste novo (`tests/interpretacao-payload.test.ts`).
4. **Inconsistência observada nos registros cancelados:** `concluidoEm` não
   bate com `totalMs` (ex.: B-c3: `concluidoEm` 3 s após `iniciadoEm`, mas
   `totalMs` 36.769 ms) e C/D cancelados gravam `metricas: {}` sem nem mesmo
   `capturaMs`. Ajustar a semântica de `concluidoEm`/métricas em registros
   cancelados no diagnóstico (Etapa 10).

## Artefatos gerados

- `logs/e2e-multiframe-percepcao-sequencia.jsonl` — eventos (0 no run; sem
  eventos de rastreamento: em B não há percepção local).
- `logs/e2e-multiframe-percepcao-sequencia.log.jsonl` — entradas da IA local
  (1, com o texto acima).
- `logs/e2e-multiframe-<modo>.ciclos.jsonl` — `RegistroCiclo` por modo,
  entrada direta do harness:
  `node scripts/benchmark-variantes.mjs --ciclos-B logs/e2e-multiframe-percepcao-sequencia.ciclos.jsonl --variantes B`

## Próximos passos

- Reexecutar com Chrome/WebGPU e clipe mais longo (`worker-zone-detection.mp4`,
  76 s) para ver múltiplos ciclos consecutivos e alimentar o comparativo A–D
  com desempenho real (item [4] do `todo.txt`).
- Corrigir a semântica de `concluidoEm`/métricas em ciclos cancelados.
