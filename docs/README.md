# Documentação — Neuro Vision

Índice da documentação do projeto. O [`README.md`](../README.md) na raiz é o guia rápido — deve ser legível em ~60 segundos. **Regra dos 60 segundos:** se um assunto não cabe em uma leitura rápida do README, ele mora aqui, em `docs/` — nunca se perde documentação por falta de espaço no guia rápido.

| Documento | Conteúdo |
| --- | --- |
| [`uso.md`](./uso.md) | Instalação, execução (dev/prod), variáveis de ambiente, funcionamento offline e diagnóstico da interface. |
| [`modos.md`](./modos.md) | Os 7 modos (Detecção, Roteiro, Descrição, Eventos + os 3 multiframe B/C/D), como os motores funcionam e como o modelo é escolhido (detecção no navegador + backend de visão: LM Studio, llama.cpp ou vLLM). |
| [`api.md`](./api.md) | Referência completa da API HTTP, formato das entradas, retenção de snapshots e memória persistente (JSONL + contexto). |
| [`eventos.md`](./eventos.md) | Fluxo orientado a eventos: política de análise (cooldown, janela, motivos), cancelamento de inferência, ciclos multiframe, interação mão↔objeto (graus `provavel`/`confirmado`/`incerto`) e consulta ao histórico. |
| [`monitoramento.md`](./monitoramento.md) | Sessões, segmentos de vídeo de 5 minutos sem perda/sobreposição, lacunas explícitas, buffer circular pré-evento, gravação no cliente, queda/retorno da câmera, retenção/exclusão e o que ainda falta. |
| [`cena.md`](./cena.md) | Referência do ambiente, estados de confirmação e regras de detecção de mudanças com `mudancaId` estável. |
| [`fase-2-inventario.md`](./fase-2-inventario.md) | Pipeline YOLO → inventário: coleta de quadros, consolidação por instância, evidência temporal, confirmação de mudanças e painel de revisão. |
| [`fase-3-atencao.md`](./fase-3-atencao.md) | Estados de atenção, zonas de entrada/saída, cadência por subsistema, buffer pré-evento, custo por estado e telemetria aditiva. |
| [`fase6-multimodal.md`](./fase6-multimodal.md) | Política orientada a eventos, seleção de frames, schema da resposta, exigência de evidência, separação observação/inferência, latência/custo e comparação com anotações humanas da Fase 6. |
| [`fase7-operacao-seguranca.md`](./fase7-operacao-seguranca.md) | Recuperação após queda, retenção habilitada, autenticação opcional, criptografia em repouso, auditoria e diretrizes de consentimento/privacidade da Fase 7. |
| [`fase8-otimizacao-manutencao.md`](./fase8-otimizacao-manutencao.md) | Fase 8: filas com descarte explícito, perfil `leve` opt-in, refatoração de regras de UI, relatório consolidado de benchmark e o que ainda depende de medição real. |
| [`nsfw.md`](./nsfw.md) | Especialização NSFW do modo Neuro Vision: separação do modo Câmera de Segurança, confiabilidade do conjunto, pré-processamento verificável e pendências. |
| [`compatibilidade.md`](./compatibilidade.md) | Política de versões fixadas (CDN/Node), IDs e revisão de modelos, telemetria necessária e matriz de fallback. |
| [`arquitetura.md`](./arquitetura.md) | Estrutura de arquivos e como as partes conversam (servidor, cliente, motores, memória, variantes A–D). |
| [`seguranca.md`](./seguranca.md) | Exposição na rede, token opcional, origem cruzada, limites de corpo, criptografia em repouso e auditoria. |
| [`qualidade.md`](./qualidade.md) | Benchmark do modelo, avaliação de eventos (precisão/recall), benchmark das variantes A–D, benchmark da cadência independente (5 FPS), carregamento do modelo e fluxo de regressão. |
| [`pendencias.md`](./pendencias.md) | Avaliações adiadas de propósito, com protocolo e critério de aceite — gestos (Fase 1.5–1.6), interpretação multimodal (Fase 6), operação contínua (Fase 7: sessão prolongada, webcam física, disco cheio, iluminação/oclusão anotadas; soak de 30 min já aprovado) e medição de inicialização/RAM/cadência com revisão de pesos (Fase 8). |
| [`soak.md`](./soak.md) | Soak test do servidor de monitoramento com telemetria: como rodar em tempo real ou acelerado, invariantes verificados e interpretação do veredito. |
| [`limites.md`](./limites.md) | Limitações conhecidas (classes COCO, oclusão, iluminação, alucinações, CPU/WASM, latência multiframe, dados sensíveis) e **como desligar cada componente**. |
| [`auditoria-fase-0.md`](./auditoria-fase-0.md) | Baseline reproduzível do plano mestre: ambiente, verificações, telemetria diagnóstica e lacunas confirmadas antes das mudanças. |
| [`fase-1-integridade.md`](./fase-1-integridade.md) | Timestamps separados, vocabulário de evidência, identidade por instância, reidentificação ambígua e inventário multi-instância da Fase 1. |

Documentação correlata fora de `docs/`:

- [`bench/README.md`](../bench/README.md) — como trocar o conjunto fixo de imagens do benchmark por cenas reais.
- [`bench/BASELINE.md`](../bench/BASELINE.md) — máquina de referência, números e metas realistas por hardware.
- [`bench/videos/README.md`](../bench/videos/README.md) — anotação de clipes, fluxo de captura e regras de casamento da avaliação de eventos.
- [`bench/clipes/MATRIZ_COBERTURA.md`](../bench/clipes/MATRIZ_COBERTURA.md) — separação dos clipes em `tuning/` e `eval/` com a cobertura mínima de cenários.
- [`bench/clipes/oclusao-iluminacao/README.md`](../bench/clipes/oclusao-iluminacao/README.md) — protocolo e gate de iluminação/oclusão (ainda sem clipes revisados, portanto `INCONCLUSIVO`).
- [`bench/RELATORIO_TESTE_NSFW_20261112.md`](../bench/RELATORIO_TESTE_NSFW_20261112.md) — teste completo do conjunto NSFW: execução dos 6 modelos, contrato, E2E e varredura temporal.
