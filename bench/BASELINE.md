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

A detecção no navegador usa **WebGPU quando disponível** e cai para **WASM
(CPU)** caso contrário; o cabeçalho da aplicação mostra um aviso persistente
quando o fallback de CPU está em uso. Meça sempre com o mesmo caminho de
execução para que os números sejam comparáveis.

## Como capturar a linha de base

1. Com o Ollama rodando e o modelo de visão carregado, gere o relatório do
   benchmark em JSON:

   ```bash
   npm run bench -- --json > bench/baseline-<data>.json
   ```

   O arquivo inclui o cabeçalho `ambiente` (CPU, núcleos, RAM, plataforma e
   versão do Node), a RAM/VRAM do modelo carregado (via `/api/ps`) e, por
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
clipe como câmera e roda o modelo real (`Xenova/yolos-tiny`).

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
| Latência da saída detectada | ~3,4 s (após o instante real) |

Os falsos positivos foram rótulos instáveis do detector (`gravata`, `forno`) e uma
`mudanca_de_cena` espúria. A variância entre execuções é alta (em 640×480 o
detector troca de rótulo), então trate estes números como ordem de grandeza.

## Metas iniciais

As metas abaixo são o **ponto de partida conservador** para esta máquina (o
conjunto real ainda tem um único clipe); ajuste-as com os primeiros números
medidos, sem piorar o que já é aceitável:

- **Latência de descrição (Ollama, visão):** manter a mediana dentro de uma
  faixa utilizável para webcam (ordem de poucos segundos por frame analisado).
- **Chamadas ao Ollama em cena estática:** próximas de zero — a política deve
  absorver a ausência de mudança sem inferência.
- **Falsos positivos por minuto em cena estática:** 0 (a camada de política já é
  coberta por `src/qualidade-eventos.test.ts`).
- **Recall de mudanças relevantes:** alto, com tolerância compatível com a
  cadência de amostragem (a `mudanca_de_cena`/`desaparecimento` pode chegar
  segundos depois do instante real).
- **Detecção no navegador:** preferir WebGPU (~5–6 s/quadro); em CPU/WASM cai
  para ~24 s/quadro e a qualidade de eventos piora muito. Registrar o caminho.

## Limitações da linha de base

- Esta máquina **não tem CUDA**; o ganho de WebGPU é medido no próprio navegador.
- Os números do Ollama dependem do modelo carregado e do estado do servidor;
  um servidor instável contamina a medição.
- A cadência de análise é o principal limitador da qualidade de eventos: com
  ~5 s/quadro em WebGPU (ou ~24 s em CPU), a tolerância precisa acomodar essa
  janela e a detecção de uma mudança tende a atrasar alguns segundos.
- O detector (YOLOS-tiny) troca de rótulo com frequência em webcam 640×480 —
  daí os falsos positivos de `gravata`/`forno`; a variância entre execuções é
  alta.
