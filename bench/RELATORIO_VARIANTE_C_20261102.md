# Relatório da variante C — 20261102

- **Variante:** C · Percepção fundida (dados locais, temporal básico)
- **Modo no app:** `percepcao-fundida`
- **Configuração:** imagens: 4 | percepção local: sim | dados locais no multimodal: sim | temporal: basico
- **Objetivo:** contexto local estruturado com leitura temporal básica
- **Código:** main @ c3c3b527e879 (alterações locais)
- **Backend multimodal:** http://localhost:1234 (padrao do servidor)
- **Janela da execução:** 2026-11-02T20:00:52.987Z → 2026-11-02T20:00:57.292Z (4.3 s)
- **Conjunto reservado:** eval
- **Clipes (mesmos para todas as variantes):** car-detection.mp4 (sha256:d31e0ebf194c…, 2811553 bytes, anotação: bench\clipes\eval\car-detection.json); classroom.mp4 (sha256:a69bd5e39ff0…, 13548133 bytes, anotação: bench\clipes\eval\classroom.json); fruit-and-vegetable-detection.mp4 (sha256:3b3b0ea658f4…, 17760065 bytes, anotação: bench\clipes\eval\fruit-and-vegetable-detection.json); head-pose-face-detection-female.mp4 (sha256:e9290821ac0e…, 15628037 bytes, anotação: bench\clipes\eval\head-pose-face-detection-female.json); webcam-mudanca.webm (sha256:9b514fab31e4…, 5610804 bytes, anotação: bench\clipes\eval\webcam-mudanca.json)
- **Modelo multimodal (registrado):** qwen2.5-vl-3b-instruct
- **Modelo multimodal (observado em visao.jsonl):** visao.jsonl [qwen2.5-vl-3b-instruct]
- **Detector local (observado nos eventos):** onnx-community/yolov10n — não é o modelo multimodal
- **Ciclos:** `logs/fase5-EVAL-ciclos-C.jsonl` · **Eventos:** `car-detection.mp4: logs/fase5-EVAL-car-detection-percepcao-fundida.jsonl`, `classroom.mp4: logs/fase5-EVAL-classroom-percepcao-fundida.jsonl`, `fruit-and-vegetable-detection.mp4: logs/fase5-EVAL-fruit-and-vegetable-detection-percepcao-fundida.jsonl`, `head-pose-face-detection-female.mp4: logs/fase5-EVAL-head-pose-face-detection-female-percepcao-fundida.jsonl`, `webcam-mudanca.webm: logs/fase5-EVAL-webcam-mudanca-percepcao-fundida.jsonl`
- **Tolerância de casamento:** 3000 ms
- **Warm-up:** 0 ciclo(s) concluído(s) excluído(s) das medianas (parâmetro `--warmups`)
- **Ambiente:** Intel(R) Xeon(R) CPU E5-2660 v3 @ 2.60GHz · 20 núcleos · 15.8 GB RAM · win32 10.0.26200 · Node v24.19.0
- Gerado por `scripts/benchmark-variantes.mjs` em 2026-11-02T20:00:52.566Z. Este arquivo não substitui `bench/BASELINE.md`.

## 1. Desempenho (logs/ciclos.jsonl, regime aquecido)

| Etapa | Mediana (ms) | P95 (ms) | Amostras |
|-------|-------------:|---------:|---------:|
| captura | 3018 | 3028 | 5 |
| detecção | 4758 | 5643 | 5 |
| pose | 4745 | 5389 | 5 |
| mãos | 1873 | 2426 | 5 |
| temporal | 2 | 2 | 3 |
| multimodal | 62173 | 178599 | 5 |
| persistência | — | — | 0 |
| percepção total (4 snapshots) | 2853 | 3351 | 5 |
| até resposta multimodal | 68625 | 184551 | 5 |
| entre ciclos | 6011 | 6022 | 5 |
| TOTAL do ciclo | 68625 | 184551 | 5 |

- Ciclos: **5** (mediana de 4 frames/ciclo) · **concluídos: 5** · observações: 20 · eventos temporais: 5
- Ciclos completos: **5** · incompletos: **0** · cancelados: **0** · com subsistema indisponível: **0**
- Ciclos com erro: **0**
- Subsistemas indisponíveis: nenhum

**Custo aquecido de inferência por snapshot:**

| Subsistema | Mediana (ms) | P95 (ms) | Máximo (ms) | Amostras |
|------------|-------------:|---------:|------------:|---------:|
| deteccao | 1190 | 1411 | 1428 | 5 |
| pose | 1186 | 1347 | 1349 | 5 |
| maos | 468 | 607 | 619 | 5 |

- **Memória máxima (heap):** mediana 40.1 MB · P95 49.9 MB · pico 51 MB (5 amostra(s))
- **Carga fria da sessão:** mediana 4963 ms · P95 5196 ms (5 sessão(ões) medida(s))

| Modelo (subsistema) | Carga mediana (ms) | P95 (ms) | Dispositivo | Versão |
|---------------------|-------------------:|---------:|-------------|--------|
| deteccao (onnx-community/yolov10n) | 1560 | 1610 | webgpu | 1.21.0 |
| pose (Xenova/yolov8n-pose) | 2789 | 2910 | wasm | 3.8.1 |
| maos (https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task) | 635 | 683 | GPU | 0.10.21 |

## 1c. Etapas isoladas × ciclo completo

| Etapa | Mediana (ms) | P95 (ms) | Máximo (ms) | Cobertura |
|-------|-------------:|---------:|------------:|----------:|
| captura | 3018 | 3028 | 3030 | 100% |
| detecção | 4758 | 5643 | 5711 | 100% |
| pose | 4745 | 5389 | 5397 | 100% |
| mãos | 1873 | 2426 | 2474 | 100% |
| temporal | 2 | 2 | 2 | 60% |

- **Soma local (mediana por ciclo):** 14396 ms · **ciclo completo (mediana):** 68625 ms · **multimodal (mediana):** 62173 ms
- **Etapas sem amostra (nenhum ciclo registrou):** nenhuma
- Cada etapa local é medida por si só e depois somada no ciclo; a diferença para o ciclo completo é o multimodal e a persistência.

## 2. Qualidade (npm run qualidade por clipe)

| Clipe | Eventos | Precisão | Recall | F1 | FP/min | Não detectados | Sem classificação | Dist. média casamento |
|-------|---------|---------:|-------:|---:|-------:|---------------:|------------------:|----------------------:|
| car-detection.mp4 | `logs/fase5-EVAL-car-detection-percepcao-fundida.jsonl` | 100% | 0% | 0% | 0 | 3 | 0 | — ms |
| classroom.mp4 | `logs/fase5-EVAL-classroom-percepcao-fundida.jsonl` | 100% | 100% | 100% | 0 | 0 | 0 | — ms |
| fruit-and-vegetable-detection.mp4 | `logs/fase5-EVAL-fruit-and-vegetable-detection-percepcao-fundida.jsonl` | 100% | 0% | 0% | 0 | 3 | 0 | — ms |
| head-pose-face-detection-female.mp4 | `logs/fase5-EVAL-head-pose-face-detection-female-percepcao-fundida.jsonl` | 100% | 100% | 100% | 0 | 0 | 0 | — ms |
| webcam-mudanca.webm | `logs/fase5-EVAL-webcam-mudanca-percepcao-fundida.jsonl` | 100% | 100% | 100% | 0 | 0 | 0 | — ms |

**Consolidado (5/5 clipe(s))**: precisão 100% · recall 0% · F1 0% · FP/min 0 · não detectados 6 · movimentos sem classificação de escopo 0 · distância média de casamento — ms

## 2b. Gate de qualidade × latência

Critérios: F1 ≥ 50% · FP/min ≤ 2 · ganho de F1 ≥ 10% sobre a referência · latência ≤ 1.5× a referência.

- **Veredito:** ⚠️ **manter experimental**
- Ganho de F1 sobre a referência: 0.0%
- Latência total: 15.01× a referência
- F1 0.0% abaixo do minimo 50.0%; ganho de F1 (0.0%) abaixo do minimo 10.0%; latencia 15.01x a referencia, acima do teto 1.5x

## 3. Observações

- Nenhuma.
