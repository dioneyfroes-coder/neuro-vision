# Decisão arquitetural — Etapa 9 do ROTEIRO de modularização (2026-10-19)

Fecha o **item 7** do roteiro: "só depois decidir se mantém os três componentes
sempre ativos, executa algum sob demanda ou reduz a frequência" — com base em
precisão/recall, falsos positivos, latência e consumo **medidos**.

Não altera `bench/BASELINE.md`. Relatórios de apoio:
`bench/RELATORIO_SMOKE_MULTIFRAME_2026-10-19.md`,
`bench/COMPARATIVO_A_B_C_D_20261018.md`, `bench/RELATORIO_VARIANTE_*_20261018.md`.

## 1. O que foi medido

Hardware idêntico ao de referência (`bench/BASELINE.md`): Xeon E5-2660 v3,
20 núcleos, 15,8 GB RAM, Windows 10 build 26200, Node v24.19.0.
**Caminho sem aceleração**: Chromium do Playwright sem WebGPU (WASM/CPU) e
LM Studio em CPU. 4 frames por ciclo, 1 frame/s.

### Latência por etapa (mediana / máx por ciclo, reais)

| Etapa | Origem dos números | Mediana | Máx | Participação no ciclo |
|-------|--------------------|--------:|----:|-----------------------|
| Captura (4 frames @ 1/s) | `logs/ciclos.jsonl` (8 ciclos) | 3.025 ms | 3.044 ms | ~2–8% |
| Deteccão YOLO (WASM, **frio**: compilação + carga dentro do ciclo) | ciclos C e D (`c1`) | 95.463 ms | 95.542 ms | ~68% do ciclo frio |
| Pose (MediaPipe) | ciclos C e D | 2.532 ms | 2.536 ms | ~2% |
| Mãos (MediaPipe Hands) | — | não executou (indisponível) | — | 0% |
| Temporal (motor) | ciclos C e D | 5 ms | 5 ms | <0,01% |
| Multimodal (LM Studio, 4 imagens) | B `c2/c3`, C/D `c1` | ~39,9 s (33,7–56,6 s) | 56.610 ms | **~92%** do ciclo de B; ~28% do ciclo frio de C/D |
| **Total por ciclo** | | **B: 36,8 s** · **C/D: ~141 s** (frio) | 141.324 ms | |

### Qualidade (mesmo clipe `webcam-mudanca.webm`, anotação verificada `bench/clipes/eval/webcam-mudanca.json`)

| Métrica | Baseline (2026-10-16) | Medido agora (2026-10-18) |
|---------|----------------------:|--------------------------:|
| Precisão | 25% | **50%** |
| Recall | 100% | 33% |
| FP/min | ~6 | **1,5** |
| F1 | — | 40% |
| Dist. média de casamento | ~3,4 s latência | 13 ms |

⚠️ Cuidado de comparação: as anotações de baseline (`bench/videos/*.json`) e o
conjunto eval novo não são o mesmo conjunto — os números melhoram em precisão e
FP/min, mas o recall caiu; **não é comparável 1:1** e não sustenta, sozinho,
mudança de qualidade. O que é comparável com segurança é a latência por etapa.

### Contexto do gargalo

- Uma chamada multimodal de 4 imagens leva **34–57 s** neste hardware.
- Enquanto a chamada está em voo, **nenhum ciclo novo avança** (o pipeline não
  acumula ciclos concorrentes — comportamento desejado de sobrecarga).
- Resultado prático (smoke E2E com clipe de 30 s): **1 ciclo concluído** na
  variante B e **0** concluídos em C/D pós-reset (cancelados em voo aos ~47–75 s).
- O primeiro ciclo de C/D pagou **95 s de detecção fria** (compilação WASM +
  carga do `yolos-tiny` acontecendo *dentro* do ciclo).

## 2. Decisão

**Os três componentes de percepção local (YOLO, pose, mãos) ficam ATIVOS como
padrão nos modos C/D — não se desliga nenhum — com duas condições; o componente
multimodal continua SOB DEMANDA (política de análise existente) e a frequência
de captura permanece em 1 frame/s.** Detalhe:

1. **Deteccão (YOLO Tiny): permanecer ativa nos modos C/D, com
   pré-aquecimento fora do ciclo.**
   *Custo medido:* 95 s frios dentro do ciclo (68% do ciclo); pose e temporal
   somados valem 2,5 s — insignificantes perto dos 34–57 s do multimodal.
   *Ação:* carregar/compilar o modelo na inicialização (antes do primeiro
   ciclo), de modo que o primeiro ciclo C/D pague só a inferência quente.
   Desligar a detecção não reduz o gargalo (multimodal) e destrói a
   estruturação de eventos que sustenta a qualidade.

2. **Pose: permanecer ativa.** 2,5 s por ciclo (≈1,8% do ciclo frio, ≈7% do
   ciclo de B) — o benefício de evidência estruturada não tem contra-indicação
   econômica medida.

3. **Mãos (MediaPipe Hands): permanece SOB DEMANDA / opcional.**
   *Medido:* não executou em nenhum run (sempre `subsistemasIndisponiveis:
   ["maos"]`), custo/benefício **não medido**. Manter desligado por
   configuração até que haja pipeline revalidado; é o único componente que
   pode ser ligado/desligado sem impacto observado.

4. **Multimodal: NÃO aumentar a frequência neste hardware.** Continua sob a
   política de análise (rate limit) já existente. Medição: domina ~92% do
   ciclo completo (33,7 s / 36,8 s na variante B) e é a razão de nenhum ciclo
   C/D ter concluído num clipe de 30 s. Captura mais rápida só encheria fila.

5. **Frequência de captura (1 frame/s, 4 frames/ciclo): manter.** Custa ~3 s
   por ciclo (8% de B) e é o que viabiliza o contexto sequencial (4 imagens)
   que define as variantes B/C/D.

### Condições de revisão

- Reexecutar o E2E multiframe com `E2E_WEBCAM_CHANNEL="chrome"` (WebGPU) para
  medir detecção **quente** e comparar B/C/D em pé de igualdade.
- Meta para mudar a política: multimodal < 10 s/chamada (modelo menor ou
  offload de GPU) → aí 2+ ciclos por clipe de 30 s passam a caber no orçamento
  e a frequência sob demanda pode ser reavaliada.
- Se a detecção quente for < 1 s/frame, pré-aquecimento deixa de ser
  obrigatório (mantê-lo de qualquer forma: custo de memória ~100 MB).

## 3. Consequências registradas

- Modo B continua como variante "só sequência de imagens" — serves para
  isolar o custo do multimodal (medido: 33,7–56,6 s sem percepção local).
- Nenhuma componente foi removida da arquitetura-alvo (D mantém tudo ativo).
- A decisão é **condicional ao hardware de referência**; ao trocar de máquina
  ou backend, recapturar `logs/ciclos.jsonl` e repetir a comparação
  (`node scripts/benchmark-variantes.mjs --ciclos-D logs/ciclos.jsonl --variantes D`).
