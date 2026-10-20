# Linha de base (hardware de referência)

Este documento registra a **máquina de referência** usada para definir metas de
desempenho antes de otimizar (Fase 7 do plano). As metas são relativas a este
hardware; ao trocar de máquina, recapture os números e revise os alvos.

## Máquina de referência

| Item | Valor |
|------|-------|
| CPU | Intel(R) Xeon(R) CPU E5-2660 v3 @ 2.60GHz |
| Núcleos lógicos | 20 |
| RAM | ~15,8 GB |
| GPU | AMD Radeon RX 5600 OEM |
| Sistema | Windows 10 (build 10.0.26200), x64 |
| Node | v24.19.0 |

Ao tempo desta linha de base (Fase 7), a detecção no navegador tentava **WebGPU
quando disponível** e caía para **WASM (CPU)** caso contrário, com aviso na
aplicação. Hoje a detecção roda **em WASM por decisão de compatibilidade**, sem
fallback de WebGPU (ver [`docs/limites.md`](../docs/limites.md)); os números
abaixo continuam válidos como registro do hardware, mas o caminho de execução é
sempre WASM. Meça sempre com o mesmo caminho de execução para que os números
sejam comparáveis.

## Como capturar a linha de base

1. Com o backend de visão rodando (ex.: LM Studio) e o modelo de visão
   carregado, gere o relatório do benchmark em JSON:

   ```bash
   npm run bench -- --json > bench/baseline-<data>.json
   ```

   O arquivo inclui o cabeçalho `ambiente` (CPU, núcleos, RAM, plataforma e
   versão do Node), a RAM/VRAM do modelo carregado (quando o backend a expõe,
   via `/api/v0/models`) e, por
   imagem, latência, tokens e inferências por minuto.

2. Meça a qualidade dos eventos com o conjunto anotado
   (`bench/videos/README.md`):

   ```bash
   npm run qualidade -- --anotacao bench/videos/<clipe>.json --json
   ```

3. Guarde os dois relatórios e a data. Compare sempre com a mesma carga.

## Medição com clipe real (Fase 7)

Fluxo em `bench/videos/README.md`. Clipe `webcam-mudanca.webm` (640×480, ~30 s; a
pessoa sai do quadro por volta de 19,5 s). O spec `e2e/webcam.spec.ts` reproduz o
clipe como câmera e roda o modelo real — à época desta medição, `Xenova/yolos-tiny`;
hoje, YOLOv10n em ONNX (`onnx-community/yolov10n`).

Custo por inferência (medido nesta máquina):

| Caminho | Carga do modelo | Por inferência |
|---------|-----------------|----------------|
| WASM/CPU (Chromium do Playwright) | ~4 s | ~23–25 s |
| WebGPU (Chrome instalado) | ~5 s | ~4–8 s |

Resultado da avaliação (WebGPU, 4 análises sobre os 30 s):

| Métrica | Valor |
|---------|-------|
| Precisão | 25% |
| Recall | 100% |
| Mudanças perdidas | 0 |
| Falsos positivos/min | 6 |

**Clipe: webcam-atual.webm (640×480, 10 s) — WebGPU, cadência ~2,5 s/quadro (observada)**

| Métrica | Valor |
|---------|-------|
| Precisão | 100% |
| Recall | 50% |
| Mudanças perdidas | 1 (movimento @ 4,5 s) |
| Falsos positivos/min | 0 |
| Latência da saída detectada | ~3,4 s (após o instante real) |

Os falsos positivos foram rótulos instáveis do detector (`gravata`, `forno`) e uma
`mudanca_de_cena` espúria. A variância entre execuções é alta (em 640×480 o
detector troca de rótulo), então trate estes números como ordem de grandeza.

## Metas iniciais

As metas abaixo são o **ponto de partida conservador** para esta máquina (o
conjunto real ainda tem um único clipe); ajuste-as com os primeiros números
medidos, sem piorar o que já é aceitável:

- **Latência de descrição (backend de visão):** manter a mediana dentro de uma
  faixa utilizável para webcam (ordem de poucos segundos por frame analisado).
- **Chamadas ao modelo de visão em cena estática:** próximas de zero — a política deve
  absorver a ausência de mudança sem inferência.
- **Falsos positivos por minuto em cena estática:** 0 (a camada de política já é
  coberta por `tests/qualidade-eventos.test.ts`).
- **Recall de mudanças relevantes:** alto, com tolerância compatível com a
  cadência de amostragem (a `mudanca_de_cena`/`desaparecimento` pode chegar
  segundos depois do instante real).
- **Detecção no navegador:** rodar sempre em WASM (YOLOv10 em ONNX; ~0,7–1,5 s/quadro
  nesta máquina) e registrar o caminho — a linha de diagnóstico mostra `dispositivo wasm`.

## Limitações da linha de base

- Esta máquina **não tem CUDA**; à época, o ganho de WebGPU era medido no próprio
  navegador (caminho hoje não usado: a detecção roda em WASM).
- Os números do backend de visão dependem do modelo carregado e do estado do servidor;
  um servidor instável contamina a medição.
- A cadência de análise é o principal limitador da qualidade de eventos: com a
  cadência da época (~5 s/quadro em WebGPU ou ~24 s em CPU no `yolos-tiny`), a
  tolerância precisa acomodar essa janela e a detecção de uma mudança tende a
  atrasar alguns segundos.
- O detector usado nas medições (`YOLOS-tiny`) troca de rótulo com frequência em
  webcam 640×480 — daí os falsos positivos de `gravata`/`forno`; a variância
  entre execuções é alta.
