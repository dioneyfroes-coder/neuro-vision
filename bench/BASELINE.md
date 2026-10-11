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

## Metas iniciais

Enquanto o conjunto de vídeos reais não é incluído, as metas abaixo são o
**ponto de partida conservador** para esta máquina; ajuste-as com os primeiros
números medidos, sem piorar o que já é aceitável:

- **Latência de descrição (Ollama, visão):** manter a mediana dentro de uma
  faixa utilizável para webcam (ordem de poucos segundos por frame analisado).
- **Chamadas ao Ollama em cena estática:** próximas de zero — a política deve
  absorver a ausência de mudança sem inferência.
- **Falsos positivos por minuto em cena estática:** 0 (a camada de política já é
  coberta por `src/qualidade-eventos.test.ts`).
- **Recall de mudanças relevantes:** alto (nenhuma mudança anotada deve passar
  batido) depois que o conjunto real estiver disponível.
- **Detecção no navegador:** preferir WebGPU; registrar quando estiver em CPU.

## Limitações da linha de base

- Esta máquina **não tem CUDA**; o ganho de WebGPU é medido no próprio navegador.
- Os números do Ollama dependem do modelo carregado e do estado do servidor;
  um servidor instável contamina a medição.
- Sem os clipes reais, as metas de qualidade são qualitativas; só a camada de
  política/rastreamento é medida de forma reproduzível hoje.
