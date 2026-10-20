# Comparativo arquitetural A × B × C × D — 20261018

- **Clipes (idênticos em todas as variantes):** webcam-mudanca.webm, webcam-atual.webm
- **Modelo multimodal:** (não informado)
- **Ambiente:** Intel(R) Xeon(R) CPU E5-2660 v3 @ 2.60GHz · 20 núcleos · 15.8 GB RAM · win32 10.0.26200 · Node v24.19.0
- Gerado em 2026-10-19T01:22:01.121Z. O `bench/BASELINE.md` permanece intocado.

> **⚠️ Artefato histórico inválido como comparativo (anotado em 2026-10-20, Fase 0).**
> Esta rodada registrou **zero ciclos** em A/B/C/D e aplicou o **mesmo arquivo de
> eventos** (`logs/webcam-eventos.jsonl`) às quatro variantes — por isso as linhas
> de qualidade são idênticas. O campo `modelo` observado (`Xenova/yolos-tiny`) é o
> **detector local**, não o modelo multimodal. Os números abaixo são preservados
> como registro histórico; **não use este arquivo para decidir entre variantes**.
> O harness atual recusa gerar comparativo nesses casos (ver
> [`docs/qualidade.md`](../docs/qualidade.md)).

## Matriz de configuração

| Variante | Modo | Imagens | Percepção local | Dados locais | Temporal | Objetivo |
|----------|------|--------:|:---------------:|:------------:|----------|----------|
| A | `deteccao\|eventos` | 1 | não | não | ausente | referência atual (um frame por análise) |
| B | `percepcao-sequencia` | 4 | não | não | ausente | custo/benefício de mandar só a sequência de imagens |
| C | `percepcao-fundida` | 4 | sim | sim | basico | contexto local estruturado com leitura temporal básica |
| D | `percepcao` | 4 | sim | sim | ampliado | arquitetura-alvo completa |

## Desempenho (mediana / P95 por variante)

| Variante | Ciclos | Total med (ms) | Total P95 (ms) | Multimodal med (ms) | Temporal med (ms) | Deteccão med (ms) | Erros | Cancelados |
|----------|-------:|---------------:|---------------:|--------------------:|------------------:|------------------:|------:|-----------:|
| A | 0 | — | — | — | — | — | 0 | 0 |
| B | 0 | — | — | — | — | — | 0 | 0 |
| C | 0 | — | — | — | — | — | 0 | 0 |
| D | 0 | — | — | — | — | — | 0 | 0 |

## Qualidade (consolidado por variante)

| Variante | Precisão | Recall | F1 | FP/min | Não detectados | Dist. média casamento |
|----------|---------:|-------:|---:|-------:|---------------:|----------------------:|
| A | 50% | 33% | 40% | 1.5 | 2 | 13 ms |
| B | 50% | 33% | 40% | 1.5 | 2 | 13 ms |
| C | 50% | 33% | 40% | 1.5 | 2 | 13 ms |
| D | 50% | 33% | 40% | 1.5 | 2 | 13 ms |

## Líderes por critério (INVÁLIDOS — preservados como registro histórico)

> ⚠️ Não há líderes legítimos: zero ciclos e métricas de qualidade copiadas do
> mesmo arquivo de eventos para as quatro variantes. A lista abaixo é o texto
> original da rodada, mantido apenas para rastreabilidade.

- **Maior F1:** A (40%)
- **Maior recall:** A (33%)
- **Maior precisão:** A (50%)
- **Menos FP/min:** A (1.5)
- **Casamento mais próximo do instante real:** A (13 ms)
_Sem dados de desempenho para comparar._

## Modelo multimodal verificado

Nenhum modelo multimodal foi observado em `visao.jsonl` para os frames dos
ciclos. O valor `Xenova/yolos-tiny` vem dos **eventos** e é o **detector local**,
não o multimodal.

| Variante | Modelo(s) observado(s) em visao.jsonl | Modelo(s) no arquivo de eventos (detector local) |
|----------|--------------------------------------|---------------------------------------------------|
| A | — | Xenova/yolos-tiny |
| B | — | Xenova/yolos-tiny |
| C | — | Xenova/yolos-tiny |
| D | — | Xenova/yolos-tiny |

❌ **Mesmo modelo multimodal NÃO confirmado** — não havia dados multimodais verificáveis.

## Cuidados de comparação

- Todos os números acima derivam do **mesmo conjunto de clipes**; a variação entre execuções vem do modelo e do hardware, não dos clipes.
- ⚠️ O **mesmo arquivo de eventos** foi aplicado às quatro variantes; a qualidade idêntica não é evidência de empate.
- ⚠️ Nenhuma versão de modelo foi registrada (`--modelo-visao`); valide manualmente que todas as variantes usaram o mesmo modelo.
- Avisos desta rodada:
  - ⚠️ A: nenhum ciclo em logs/ciclos.jsonl corresponde a esta variante (use --sessao-A <sessionId> ou grave logs com o modo deteccao|eventos)
  - ⚠️ B: nenhum ciclo em logs/ciclos.jsonl corresponde a esta variante (use --sessao-B <sessionId> ou grave logs com o modo percepcao-sequencia)
  - ⚠️ C: nenhum ciclo em logs/ciclos.jsonl corresponde a esta variante (use --sessao-C <sessionId> ou grave logs com o modo percepcao-fundida)
  - ⚠️ D: nenhum ciclo em logs/ciclos.jsonl corresponde a esta variante (use --sessao-D <sessionId> ou grave logs com o modo percepcao)
- Este comparativo é um artefato novo (`COMPARATIVO_*`); `bench/BASELINE.md` não é alterado por este script.
