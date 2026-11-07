# Comparativo arquitetural A × B × C × D — 20261102

> **Nota de revisão (2026-11-07):** este é um **artefato histórico** anterior aos
> critérios atuais de comparabilidade e suficiência estatística. O veredito
> "conclusivo" abaixo reflete a regra antiga (ao menos **1 ciclo** por variante),
> insuficiente hoje: o harness passou a exigir `--min-ciclos 2` e
> `--min-amostras-estatisticas 10` para conclusão. Da mesma forma, "Janela da
> execução" é hoje **"janela de geração do relatório"** (wall-clock do harness,
> não a duração das inferências). Os números permanecem como registro histórico;
> não os use como evidência conclusiva. Critérios atuais em
> [`docs/qualidade.md`](../docs/qualidade.md).

- **Veredito:** ✅ **conclusivo** — dados comparáveis
- **Conjunto reservado:** eval
- **Warm-up excluído das medianas:** 0 ciclo(s) concluído(s) por variante
- **Clipes (idênticos em todas as variantes):** car-detection.mp4 (sha256:d31e0ebf194c…, 2811553 bytes, anotação: bench\clipes\eval\car-detection.json); classroom.mp4 (sha256:a69bd5e39ff0…, 13548133 bytes, anotação: bench\clipes\eval\classroom.json); fruit-and-vegetable-detection.mp4 (sha256:3b3b0ea658f4…, 17760065 bytes, anotação: bench\clipes\eval\fruit-and-vegetable-detection.json); head-pose-face-detection-female.mp4 (sha256:e9290821ac0e…, 15628037 bytes, anotação: bench\clipes\eval\head-pose-face-detection-female.json); webcam-mudanca.webm (sha256:9b514fab31e4…, 5610804 bytes, anotação: bench\clipes\eval\webcam-mudanca.json)
- **Modelo multimodal (registrado):** qwen2.5-vl-3b-instruct
- **Código:** main @ c3c3b527e879 (alterações locais)
- **Backend multimodal:** http://localhost:1234 (padrao do servidor)
- **Hardware:** Intel(R) Xeon(R) CPU E5-2660 v3 @ 2.60GHz · 20 núcleos · 15.8 GB RAM · win32 10.0.26200 · Node v24.19.0
- **Janela da execução:** 2026-11-02T20:00:52.987Z → 2026-11-02T20:00:57.292Z (4.3 s)
- **Critério de conclusão:** ao menos 1 ciclo(s) concluído(s) por variante **no regime aquecido**, modelo multimodal verificado em `logs/visao.jsonl` e um arquivo de eventos próprio por variante.
- Gerado em 2026-11-02T20:00:52.566Z. O `bench/BASELINE.md` permanece intocado.

## Matriz de configuração

| Variante | Modo | Imagens | Percepção local | Dados locais | Temporal | Objetivo |
|----------|------|--------:|:---------------:|:------------:|----------|----------|
| A | `deteccao\|eventos` | 1 | não | não | ausente | referência atual (um frame por análise) |
| B | `percepcao-sequencia` | 4 | não | não | ausente | custo/benefício de mandar só a sequência de imagens |
| C | `percepcao-fundida` | 4 | sim | sim | basico | contexto local estruturado com leitura temporal básica |
| D | `percepcao` | 4 | sim | sim | ampliado | arquitetura-alvo completa |

## Desempenho (mediana / P95 por variante, regime aquecido)

| Variante | Ciclos | Concluídos | Warm-ups | Cold start total (ms) | Total med (ms) | Total P95 (ms) | Multimodal med (ms) | Temporal med (ms) | Deteccão med (ms) | Erros | Cancelados |
|----------|-------:|-----------:|---------:|----------------------:|---------------:|---------------:|--------------------:|------------------:|------------------:|------:|-----------:|
| A | 18 | 18 | 0 | — | 4573 | 5751 | 4357 | — | — | 0 | 0 |
| B | 7 | 7 | 0 | — | 33901 | 42231 | 30882 | — | — | 0 | 0 |
| C | 5 | 5 | 0 | — | 68625 | 184551 | 62173 | 2 | 4758 | 0 | 0 |
| D | 5 | 5 | 0 | — | 72067 | 187262 | 65334 | 3 | 5030 | 0 | 0 |

## Custos por regime e cobertura de ciclos (P3.1)

| Variante | Percepção 4 snapshots med (ms) | Até multimodal med (ms) | Entre ciclos med (ms) | Memória pico (MB) | Completos | Incompletos | Cancelados | Subsistema indisponível |
|----------|------------------------------:|------------------------:|----------------------:|------------------:|----------:|------------:|-----------:|-------------------------:|
| A | — | — | — | — | 18 | 0 | 0 | 0 |
| B | — | 33901 | 6006 | 51 | 7 | 0 | 0 | 7 |
| C | 2853 | 68625 | 6011 | 51 | 5 | 0 | 0 | 0 |
| D | 3142 | 72066 | 6008 | 51 | 5 | 0 | 0 | 0 |

### Carga fria por modelo (fora das medianas de inferência)

| Variante | Subsistema | Modelo | Carga mediana (ms) | P95 (ms) | Dispositivo | Versão |
|----------|------------|--------|-------------------:|---------:|-------------|--------|
| C | deteccao | onnx-community/yolov10n | 1560 | 1610 | webgpu | 1.21.0 |
| C | pose | Xenova/yolov8n-pose | 2789 | 2910 | wasm | 3.8.1 |
| C | maos | https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task | 635 | 683 | GPU | 0.10.21 |
| D | deteccao | onnx-community/yolov10n | 1597 | 1719 | webgpu | 1.21.0 |
| D | pose | Xenova/yolov8n-pose | 2828 | 3059 | wasm | 3.8.1 |
| D | maos | https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task | 657 | 800 | GPU | 0.10.21 |

## Etapas isoladas × ciclo completo (mediana por ciclo)

| Variante | Soma local (ms) | Ciclo completo (ms) | Multimodal (ms) | Etapas sem amostra |
|----------|----------------:|--------------------:|----------------:|--------------------|
| A | — | — | — | capturaMs, deteccaoMs, poseMs, maosMs, temporalMs |
| B | 3009 | 33901 | 30882 | deteccaoMs, poseMs, maosMs, temporalMs |
| C | 14396 | 68625 | 62173 | nenhuma |
| D | 15811 | 72067 | 65334 | nenhuma |

## Qualidade (consolidado por variante)

| Variante | Precisão | Recall | F1 | FP/min | Não detectados | Dist. média casamento |
|----------|---------:|-------:|---:|-------:|---------------:|----------------------:|
| A | 0% | 0% | 0% | 0.21 | 6 | — ms |
| B | 100% | 0% | 0% | 0 | 6 | — ms |
| C | 100% | 0% | 0% | 0 | 6 | — ms |
| D | 100% | 0% | 0% | 0 | 6 | — ms |

## Gate de qualidade × latência (decisão de promoção)

Critérios definidos previamente: **F1 ≥ 50%** · **FP/min ≤ 2** · **ganho de F1 ≥ 10%** sobre a referência (A/B) · **latência ≤ 1.5×** a referência.

| Variante | F1 | FP/min | Ganho F1 vs ref | Latência vs ref | Qualidade | Compensa | Recomendação |
|----------|----|-------:|----------------:|----------------:|:---------:|:--------:|--------------|
| A | 0% | 0.21 | 0.0% | 1× | ⚠️ | ⚠️ | manter experimental |
| B | 0% | 0 | 0.0% | 7.41× | ⚠️ | ⚠️ | manter experimental |
| C | 0% | 0 | 0.0% | 15.01× | ⚠️ | ⚠️ | manter experimental |
| D | 0% | 0 | 0.0% | 15.76× | ⚠️ | ⚠️ | manter experimental |

⚠️ **Manter experimentais com estes dados:** A, B, C, D. Não promover a padrão sem nova medição que atenda aos critérios acima.

## Líderes por critério (entre variantes com dados)

- **Maior F1:** A (0%)
- **Maior recall:** A (0%)
- **Maior precisão:** B (100%)
- **Menos FP/min:** B (0)
- **Casamento mais próximo do instante real:** A (— ms)
- **Menor latência total do ciclo (mediana):** A (4573 ms)
- **Menor latência multimodal (mediana):** A (4357 ms)
- **Mais robusta (erros + cancelamentos):** A (0)

## Modelo multimodal verificado

Modelos distintos observados em todas as variantes: `qwen2.5-vl-3b-instruct`

| Variante | Modelo(s) multimodal em visao.jsonl | Detector local nos eventos (não é o multimodal) |
|----------|--------------------------------------|--------------------------------------------------|
| A | qwen2.5-vl-3b-instruct | onnx-community/yolov10n |
| B | qwen2.5-vl-3b-instruct | — |
| C | qwen2.5-vl-3b-instruct | onnx-community/yolov10n |
| D | qwen2.5-vl-3b-instruct | onnx-community/yolov10n |

✅ **Mesmo modelo multimodal confirmado para todas as variantes com dados.**

## Cuidados de comparação

- Todos os números acima derivam do **mesmo conjunto de clipes**; a variação entre execuções vem do modelo e do hardware, não dos clipes.
- **Conjunto reservado:** eval — o conjunto de avaliação final deve ser separado do conjunto de ajuste (tuning).
- **Warm-up:** 0 ciclo(s) concluído(s) por variante foram excluídos das medianas; compare no campo "Cold start" o custo de partida.
- Modelo multimodal registrado: `qwen2.5-vl-3b-instruct`. Confirme no app que **todas** as variantes rodaram com esta versão.
- Este comparativo é um artefato novo (`COMPARATIVO_*`); `bench/BASELINE.md` não é alterado por este script.
