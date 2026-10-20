# Documentação — Neuro Vision

Índice da documentação do projeto. O [`README.md`](../README.md) na raiz é o guia rápido — deve ser legível em ~60 segundos. **Regra dos 60 segundos:** se um assunto não cabe em uma leitura rápida do README, ele mora aqui, em `docs/` — nunca se perde documentação por falta de espaço no guia rápido.

| Documento | Conteúdo |
| --- | --- |
| [`uso.md`](./uso.md) | Instalação, execução (dev/prod), variáveis de ambiente, funcionamento offline e diagnóstico da interface. |
| [`modos.md`](./modos.md) | Os 7 modos (Detecção, Roteiro, Descrição, Eventos + os 3 multiframe B/C/D), como os motores funcionam e como o modelo é escolhido (detecção no navegador + backend de visão: LM Studio, llama.cpp ou vLLM). |
| [`api.md`](./api.md) | Referência completa da API HTTP, formato das entradas, retenção de snapshots e memória persistente (JSONL + contexto). |
| [`eventos.md`](./eventos.md) | Fluxo orientado a eventos: política de análise (cooldown, janela, motivos), cancelamento de inferência, ciclos multiframe e consulta ao histórico. |
| [`arquitetura.md`](./arquitetura.md) | Estrutura de arquivos e como as partes conversam (servidor, cliente, motores, memória, variantes A–D). |
| [`seguranca.md`](./seguranca.md) | Exposição na rede, origem cruzada, limites de corpo e validação de payloads. |
| [`qualidade.md`](./qualidade.md) | Benchmark do modelo, avaliação de eventos (precisão/recall), benchmark das variantes A–D, carregamento do modelo e fluxo de regressão. |
| [`limites.md`](./limites.md) | Limitações conhecidas (classes COCO, oclusão, iluminação, alucinações, CPU/WASM, latência multiframe, dados sensíveis) e **como desligar cada componente**. |

Documentação correlata fora de `docs/`:

- [`bench/README.md`](../bench/README.md) — como trocar o conjunto fixo de imagens do benchmark por cenas reais.
- [`bench/BASELINE.md`](../bench/BASELINE.md) — máquina de referência, números e metas realistas por hardware.
- [`bench/videos/README.md`](../bench/videos/README.md) — anotação de clipes, fluxo de captura e regras de casamento da avaliação de eventos.
- [`bench/clipes/MATRIZ_COBERTURA.md`](../bench/clipes/MATRIZ_COBERTURA.md) — separação dos clipes em `tuning/` e `eval/` com a cobertura mínima de cenários.
- [`bench/DECISAO_ARQUITETURAL_2026-10-19.md`](../bench/DECISAO_ARQUITETURAL_2026-10-19.md) — decisão da Etapa 9 (sempre ativos × sob demanda × frequência) com as métricas medidas.
- [`PLANO_DE_EVOLUCAO_NEURO_VISION.md`](../PLANO_DE_EVOLUCAO_NEURO_VISION.md) — roadmap do projeto (fases cumpridas e decisões registradas).