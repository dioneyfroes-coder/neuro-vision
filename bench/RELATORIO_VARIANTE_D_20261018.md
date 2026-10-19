# Relatório da variante D — 20261018

- **Variante:** D · Arquitetura-alvo (dados locais, temporal ampliado)
- **Modo no app:** `percepcao`
- **Configuração:** imagens: 4 | percepção local: sim | dados locais no multimodal: sim | temporal: ampliado
- **Objetivo:** arquitetura-alvo completa
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

- ⚠️ D: nenhum ciclo em logs/ciclos.jsonl corresponde a esta variante (use --sessao-D <sessionId> ou grave logs com o modo percepcao)
