# Relatório da variante B — 20261102

- **Variante:** B · Sequência (4 imagens, sem dados locais)
- **Modo no app:** `percepcao-sequencia`
- **Configuração:** imagens: 4 | percepção local: não | dados locais no multimodal: não | temporal: ausente
- **Objetivo:** custo/benefício de mandar só a sequência de imagens
- **Código:** main @ c3c3b527e879 (alterações locais)
- **Backend multimodal:** http://localhost:1234 (padrao do servidor)
- **Janela da execução:** 2026-11-02T20:00:52.987Z → 2026-11-02T20:00:57.292Z (4.3 s)
- **Conjunto reservado:** eval
- **Clipes (mesmos para todas as variantes):** car-detection.mp4 (sha256:d31e0ebf194c…, 2811553 bytes, anotação: bench\clipes\eval\car-detection.json); classroom.mp4 (sha256:a69bd5e39ff0…, 13548133 bytes, anotação: bench\clipes\eval\classroom.json); fruit-and-vegetable-detection.mp4 (sha256:3b3b0ea658f4…, 17760065 bytes, anotação: bench\clipes\eval\fruit-and-vegetable-detection.json); head-pose-face-detection-female.mp4 (sha256:e9290821ac0e…, 15628037 bytes, anotação: bench\clipes\eval\head-pose-face-detection-female.json); webcam-mudanca.webm (sha256:9b514fab31e4…, 5610804 bytes, anotação: bench\clipes\eval\webcam-mudanca.json)
- **Modelo multimodal (registrado):** qwen2.5-vl-3b-instruct
- **Modelo multimodal (observado em visao.jsonl):** visao.jsonl [qwen2.5-vl-3b-instruct]
- **Detector local (observado nos eventos):** (sem campo `modelo` nos eventos) — não é o modelo multimodal
- **Ciclos:** `logs/fase5-EVAL-ciclos-B.jsonl` · **Eventos:** `car-detection.mp4: logs/fase5-EVAL-car-detection-percepcao-sequencia.jsonl`, `classroom.mp4: logs/fase5-EVAL-classroom-percepcao-sequencia.jsonl`, `fruit-and-vegetable-detection.mp4: logs/fase5-EVAL-fruit-and-vegetable-detection-percepcao-sequencia.jsonl`, `head-pose-face-detection-female.mp4: logs/fase5-EVAL-head-pose-face-detection-female-percepcao-sequencia.jsonl`, `webcam-mudanca.webm: logs/fase5-EVAL-webcam-mudanca-percepcao-sequencia.jsonl`
- **Tolerância de casamento:** 3000 ms
- **Warm-up:** 0 ciclo(s) concluído(s) excluído(s) das medianas (parâmetro `--warmups`)
- **Ambiente:** Intel(R) Xeon(R) CPU E5-2660 v3 @ 2.60GHz · 20 núcleos · 15.8 GB RAM · win32 10.0.26200 · Node v24.19.0
- Gerado por `scripts/benchmark-variantes.mjs` em 2026-11-02T20:00:52.566Z. Este arquivo não substitui `bench/BASELINE.md`.

## 1. Desempenho (logs/ciclos.jsonl, regime aquecido)

| Etapa | Mediana (ms) | P95 (ms) | Amostras |
|-------|-------------:|---------:|---------:|
| captura | 3009 | 3023 | 7 |
| detecção | — | — | 0 |
| pose | — | — | 0 |
| mãos | — | — | 0 |
| temporal | — | — | 0 |
| multimodal | 30882 | 39196 | 7 |
| persistência | — | — | 0 |
| percepção total (4 snapshots) | — | — | 0 |
| até resposta multimodal | 33901 | 42231 | 7 |
| entre ciclos | 6006 | 6010 | 7 |
| TOTAL do ciclo | 33901 | 42231 | 7 |

- Ciclos: **7** (mediana de 4 frames/ciclo) · **concluídos: 7** · observações: 28 · eventos temporais: 0
- Ciclos completos: **7** · incompletos: **0** · cancelados: **0** · com subsistema indisponível: **7**
- Ciclos com erro: **0**
- Subsistemas indisponíveis: deteccao: 7, pose: 7, maos: 7

- **Memória máxima (heap):** mediana 45.2 MB · P95 49.3 MB · pico 51 MB (7 amostra(s))
## 1c. Etapas isoladas × ciclo completo

| Etapa | Mediana (ms) | P95 (ms) | Máximo (ms) | Cobertura |
|-------|-------------:|---------:|------------:|----------:|
| captura | 3009 | 3023 | 3024 | 100% |
| detecção | — | — | — | 0% |
| pose | — | — | — | 0% |
| mãos | — | — | — | 0% |
| temporal | — | — | — | 0% |

- **Soma local (mediana por ciclo):** 3009 ms · **ciclo completo (mediana):** 33901 ms · **multimodal (mediana):** 30882 ms
- **Etapas sem amostra (nenhum ciclo registrou):** deteccaoMs, poseMs, maosMs, temporalMs
- Cada etapa local é medida por si só e depois somada no ciclo; a diferença para o ciclo completo é o multimodal e a persistência.

## 2. Qualidade (npm run qualidade por clipe)

| Clipe | Eventos | Precisão | Recall | F1 | FP/min | Não detectados | Sem classificação | Dist. média casamento |
|-------|---------|---------:|-------:|---:|-------:|---------------:|------------------:|----------------------:|
| car-detection.mp4 | `logs/fase5-EVAL-car-detection-percepcao-sequencia.jsonl` | 100% | 0% | 0% | 0 | 3 | 0 | — ms |
| classroom.mp4 | `logs/fase5-EVAL-classroom-percepcao-sequencia.jsonl` | 100% | 100% | 100% | 0 | 0 | 0 | — ms |
| fruit-and-vegetable-detection.mp4 | `logs/fase5-EVAL-fruit-and-vegetable-detection-percepcao-sequencia.jsonl` | 100% | 0% | 0% | 0 | 3 | 0 | — ms |
| head-pose-face-detection-female.mp4 | `logs/fase5-EVAL-head-pose-face-detection-female-percepcao-sequencia.jsonl` | 100% | 100% | 100% | 0 | 0 | 0 | — ms |
| webcam-mudanca.webm | `logs/fase5-EVAL-webcam-mudanca-percepcao-sequencia.jsonl` | 100% | 100% | 100% | 0 | 0 | 0 | — ms |

**Consolidado (5/5 clipe(s))**: precisão 100% · recall 0% · F1 0% · FP/min 0 · não detectados 6 · movimentos sem classificação de escopo 0 · distância média de casamento — ms

## 2b. Gate de qualidade × latência

Critérios: F1 ≥ 50% · FP/min ≤ 2 · ganho de F1 ≥ 10% sobre a referência · latência ≤ 1.5× a referência.

- **Veredito:** ⚠️ **manter experimental**
- Ganho de F1 sobre a referência: 0.0%
- Latência total: 7.41× a referência
- F1 0.0% abaixo do minimo 50.0%; ganho de F1 (0.0%) abaixo do minimo 10.0%; latencia 7.41x a referencia, acima do teto 1.5x

## 3. Observações

- Nenhuma.
