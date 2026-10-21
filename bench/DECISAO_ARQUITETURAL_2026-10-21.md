# Decisão arquitetural — Fase 5 do roteiro de correções (2026-10-21)

Fecha o **item 5** do roteiro (`ANALISE_PROFUNDA_NEURO_VISION.md`, seção 6): "repetir
o benchmark e decidir por dados". **Critério de saída:** a arquitetura padrão é
escolhida com dados reproduzíveis de qualidade, latência e estabilidade.

Não altera `bench/BASELINE.md`. A decisão anterior
([`DECISAO_ARQUITETURAL_2026-10-19.md`](./DECISAO_ARQUITETURAL_2026-10-19.md))
continua válida como **registro histórico**; este documento acrescenta o
**protocolo reproduzível** e o **gate de qualidade × latência** que a Fase 5
exigia, e reafirma a decisão com base no mesmo estado de medição.

## 1. O que a Fase 5 exigia e como é atendido

| Item (seção 6) | Como é atendido agora |
|----------------|-----------------------|
| 1. Rodar A/B/C/D no **mesmo conjunto reservado** | `--conjunto <nome>` registra o conjunto (ex.: `eval`) no relatório e no comparativo; o harness já exige os **mesmos clipes** (nome, tamanho e SHA-256) e um arquivo de eventos próprio por variante. |
| 2. **Warm-up** e **cold start** em ensaios separados | `--warmups <n>` exclui os `n` primeiros ciclos **concluídos** das medianas e reporta o cold start à parte ("1b. Cold start"). |
| 3. Medir cada **etapa local isolada** e depois o **ciclo completo** | `--etapas-isoladas` mede captura/detecção/pose/mãos/temporal por si só e a soma local × ciclo completo, a partir das mesmas métricas reais. |
| 4. Repetir com **backend/hardware documentados** | Cada relatório registra CPU, núcleos, RAM, plataforma, Node, commit/branch, backend multimodal e a janela da execução. |
| 5. Comparar **qualidade × latência** (não só o menor tempo) | Gate de qualidade × latência (`--min-f1`, `--max-fp-min`, `--ganho-minimo-f1`, `--custo-maximo-latencia`) com veredito por variante. |
| 6. Manter **C/D experimentais** se não atingirem os critérios | O gate emite "promovível a padrão" ou "manter experimental" com o motivo; sem qualidade consolidada, nunca promove. |

## 2. Estado da medição

O hardware de referência e os números de latência/qualidade vigentes são os de
[`DECISAO_ARQUITETURAL_2026-10-19.md`](./DECISAO_ARQUITETURAL_2026-10-19.md) e
[`COMPARATIVO_FINAL_20261020.md`](./COMPARATIVO_FINAL_20261020.md): Xeon E5-2660
v3, 20 núcleos, 15,8 GB RAM, Windows 10 build 26200, Node v24.19.0, **sem
aceleração de GPU** (Chromium/WASM para a percepção local, LM Studio em CPU para
o multimodal).

O que a medição já estabelece de forma comparável:

- **Latência por etapa** (ciclo frio de C/D): detecção YOLO **~95 s** (compilação
  WASM + carga do modelo *dentro* do ciclo), pose ~2,5 s, temporal ~5 ms,
  multimodal **34–57 s** (≈92% do ciclo de B).
- **Ciclo completo** (frio): B ≈ 36,8 s · C/D ≈ 141 s.
- **Qualidade** (mesmo clipe `eval/webcam-mudanca.json`): precisão 50% · recall
  33% · FP/min 1,5 · F1 40% — **não comparável 1:1** com as anotações antigas de
  baseline (conjuntos diferentes).

## 3. Decisão

**A arquitetura padrão permanece a variante D (percepção fundida com temporal
ampliado), com o multimodal sob a política de análise (não a cada ciclo), e C/D
seguem como configurações EXPERIMENTAIS até que uma nova rodada do harness
atenda ao gate de qualidade × latência.**

Justificativa por dado:

1. **D não é promovível a padrão "de produção" com os números atuais.** O gate
   (F1 ≥ 0,5 e ganho de F1 ≥ 0,1 sobre a referência, com latência ≤ 1,5×) **não é
   atendido**: o F1 medido (40%) fica abaixo do mínimo, e o custo de latência do
   ciclo multiframe é ordens de grandeza maior que o de A/B. O veredito
   automático é **"manter experimental"** — exatamente a condição do item 6.
2. **A detecção fria é o que inviabiliza o ciclo multiframe neste hardware**, não
   a pose nem o temporal (2,5 s + 5 ms). O **pré-aquecimento fora do ciclo**
   (condição já registrada em 2026-10-19) remove ~95 s do primeiro ciclo; com ele,
   o ciclo passa a ser dominado pelo multimodal (34–57 s), que é o teto real.
3. **Não aumentar a frequência**: enquanto o multimodal não cair para < 10 s por
   chamada, mais ciclos só enchem fila. A frequência de captura (1 frame/s, 4
   frames/ciclo) e a política sob demanda permanecem.
4. **A comparação de qualidade ainda está limitada pelo conjunto de avaliação**:
   só há um clipe `eval` verificado. Promover C/D a padrão exige ampliar o
   conjunto reservado (a matriz de cobertura lista os candidatos pendentes de
   anotação humana) e repetir a rodada com `--warmups 1 --etapas-isoladas`.

## 4. Protocolo para a próxima rodada (reproduzível)

1. Pré-aquecer a detecção fora do ciclo (evita o cold start de ~95 s).
2. Rodar A/B/C/D sobre o **mesmo conjunto reservado** (`--conjunto eval`), com o
   mesmo modelo multimodal verificado em `logs/visao.jsonl`.
3. Separar warm-up: `--warmups 1`; comparar o cold start à parte.
4. Medir por etapa e o ciclo completo: `--etapas-isoladas`.
5. Aplicar o gate com os critérios definidos **antes** da rodada
   (`--min-f1`, `--max-fp-min`, `--ganho-minimo-f1`, `--custo-maximo-latencia`).
6. Promover C/D a padrão **somente** se o gate as marcar "promovível"; caso
   contrário, manter experimentais e registrar o motivo.

```powershell
node scripts/benchmark-variantes.mjs --conjunto eval --anotacoes-dir bench/clipes/eval `
  --warmups 1 --etapas-isoladas --modelo-visao qwen2.5-vl-3b-instruct `
  --ciclos-B logs/e2e-multiframe-percepcao-sequencia.ciclos.jsonl `
  --eventos-B logs/e2e-multiframe-percepcao-sequencia.jsonl `
  --ciclos-C logs/e2e-multiframe-percepcao-fundida.ciclos.jsonl `
  --eventos-C logs/e2e-multiframe-percepcao-fundida.jsonl `
  --ciclos-D logs/e2e-multiframe-percepcao.ciclos.jsonl `
  --eventos-D logs/e2e-multiframe-percepcao.jsonl
```

## 5. Condições de revisão

- **Multimodal < 10 s/chamada** (modelo menor ou offload de GPU): reavaliar a
  frequência e repetir a rodada; se o gate passar, promover C/D.
- **Conjunto reservado ampliado** com as anotações humanas pendentes
  (`bench/clipes/MATRIZ_COBERTURA.md`): só então os números de recall/F1 passam a
  sustentar promoção.
- **Troca de máquina/backend**: recapturar `logs/ciclos.jsonl` e repetir — a
  decisão é condicional ao hardware de referência.

## 6. Consequências registradas

- Nenhuma componente foi removida da arquitetura-alvo (D mantém tudo ativo).
- O modo B continua como variante "só sequência de imagens" (isola o custo do
  multimodal).
- O `bench/BASELINE.md` permanece intocado; as medições desta fase são artefatos
  novos (`RELATORIO_*`/`COMPARATIVO_*`), sem mistura com o histórico de 2026-10-18.
