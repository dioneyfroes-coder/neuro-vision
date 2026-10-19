# Relatório da variante A — 20261018

- **Variante:** A · Baseline (frame único)
- **Modo no app:** `deteccao|eventos`
- **Configuração:** imagens: 1 | percepção local: não | dados locais no multimodal: não | temporal: ausente
- **Objetivo:** referência atual (um frame por análise)
- **Clipes (mesmos para todas as variantes):** webcam-mudanca.webm, webcam-atual.webm
- **Modelo multimodal (registrado):** (não informado — use --modelo-visao para registrar a versão usada)
- **Modelo multimodal (observado nos logs):** eventos [Xenova/yolos-tiny]
- **Ciclos:** `logs/ciclos.jsonl` · **Eventos:** `logs/webcam-eventos.jsonl`
- **Tolerância de casamento:** 3000 ms
- **Ambiente:** Intel(R) Xeon(R) CPU E5-2660 v3 @ 2.60GHz · 20 núcleos · 15.8 GB RAM · win32 10.0.26200 · Node v24.19.0
- Gerado por `scripts/benchmark-variantes.mjs` em 2026-10-19T01:22:01.121Z. Este arquivo não substitui `bench/BASELINE.md`.

## 1. Desempenho (logs/ciclos.jsonl)

_Sem registros em `logs/ciclos.jsonl` para esta variante._

## 2. Qualidade (npm run qualidade por clipe)

| Clipe | Precisão | Recall | F1 | FP/min | Não detectados | Dist. média casamento |
|-------|---------:|-------:|---:|-------:|---------------:|----------------------:|
| webcam-mudanca.webm | 0% | 0% | 0% | 2 | 1 | — ms |
| webcam-atual.webm | 100% | 50% | 67% | 0 | 1 | 13 ms |

**Consolidado (2 clipe(s))**: precisão 50% · recall 33% · F1 40% · FP/min 1.5 · não detectados 2 · distância média de casamento 13 ms

## 3. Observações

- ⚠️ A: nenhum ciclo em logs/ciclos.jsonl corresponde a esta variante (use --sessao-A <sessionId> ou grave logs com o modo deteccao|eventos)
