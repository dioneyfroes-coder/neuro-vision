# Limitações conhecidas — Neuro Vision

- **Classes não treinadas:** a detecção usa o YOLOv10 treinado em COCO (em ONNX). Objetos fora das 80 classes simplesmente não são vistos — não é uma falha de configuração.
- **Oclusão:** objetos parcialmente escondidos podem oscilar entre aparecer/desaparecer, gerando eventos espúrios.
- **Iluminação:** cenas escuras, estouro de luz ou contraluz reduzem confiança e aumentam mudanças perdidas.
- **Alucinações do modelo de visão:** o modelo pode descrever coisas que não estão na cena. O texto é tratado como relato do modelo, não como verdade.
- **Identificação incerta de objetos:** o mesmo objeto pode ser rotulado de formas diferentes entre frames; o rastreamento usa IoU e movimento, não reidentificação de longo prazo.
- **Cenas estáticas:** a política evita chamar o modelo de visão sem mudança, mas ruído de sensor/compressão ainda pode disparar `mudanca_de_cena`.
- **WASM por decisão:** a detecção (YOLOv10 em ONNX com `onnxruntime-web`) roda em WASM/CPU **em qualquer navegador**, por decisão de compatibilidade — não há mais fallback de WebGPU nem aviso de interface; a linha de diagnóstico reporta `dispositivo wasm`. Medido nesta máquina no Chromium do Playwright: ~0,7–1,5 s por inferência (640×640, `yolov10n`). Essa latência limita a cadência de análise, e a janela entre amostras vira a tolerância natural da avaliação de eventos.
- **Persistência do cliente:** as gravações (entradas e eventos) passam por uma fila serial (`public/persistencia.ts`). Ela mantém a ordem, limita a **uma** requisição simultânea, faz no máximo 3 tentativas com atraso progressivo (0,4 s e 0,8 s; teto 4 s) e tem teto de 200 itens aguardando — acima disso o mais antigo é descartado e contado como falha. Falhas definitivas ficam visíveis (aviso no cabeçalho, item marcado no log, contagem no diagnóstico) e podem ser exportadas no botão **Pendentes**. Não há fila persistente em disco: fechar a página com pendências perde o que não chegou ao servidor.
- **`HOST` e dados sensíveis:** o servidor escuta em `127.0.0.1` por padrão; subir para `0.0.0.0` expõe a webcam e os logs. Snapshots e logs podem conter pessoas — trate-os como dados sensíveis. Ver [`seguranca.md`](./seguranca.md).
- **Latência multimodal em CPU (modos multiframe):** uma chamada com 4 imagens ao LM Studio em CPU leva **34–57 s** neste hardware — ela domina o ciclo (~92% na variante B) e, enquanto está em voo, nenhum ciclo novo avança. Em CPU/WASM um ciclo completo mede ~37 s (B) e ~95–141 s (C/D, incluindo detecção fria); um clipe de 30 s comporta poucos ciclos e um clipe curto de avaliação pode não gerar o evento esperado dentro da tolerância. Medição e condições de revisão em [`bench/DECISAO_ARQUITETURAL_2026-10-19.md`](../bench/DECISAO_ARQUITETURAL_2026-10-19.md) e [`bench/RELATORIO_SMOKE_MULTIFRAME_2026-10-19.md`](../bench/RELATORIO_SMOKE_MULTIFRAME_2026-10-19.md). Com `E2E_WEBCAM_CHANNEL=chrome` (WebGPU) os tempos caem bastante.
- **Deteccão fria dentro do ciclo:** nos modos C/D a primeira inferência do YOLO paga compilação do WASM + carga do modelo **dentro do ciclo** (~95 s medidos). O pré-aquecimento na inicialização é a condição 1 da decisão arquitetural (link acima) para o primeiro ciclo não consumir a janela toda.
- **Mãos/gestos:** o reconhecedor de mãos não carregou em nenhum run medido (sempre em `subsistemasIndisponiveis`) — custo/benefício não medido; é o único componente que pode ficar desligado sem impacto observado.
- **Ciclos cancelados:** o registro de um ciclo cancelado em voo pode gravar `metricas: {}` e `concluidoEm` inconsistente com `totalMs` (diagnóstico em melhoria); eventos temporais de um ciclo cancelado só chegam ao `eventos.jsonl` se a mesma identidade reaparecer num ciclo concluído.
- **NSFW experimental:** o classificador (`erax_nsfw_yolo11n.onnx`, 5 classes anatômicas) é experimental e **desligado por padrão**. Dependente de pesos locais exportados (`yolonsfw/`, gitignored — `scripts/exportar-yolo-nsfw.mjs`); sem export o toggle falha com instrução. Rótulos são do próprio modelo (inglês, anatômicos) — não há tradução nem agrupamento em "NSFW/safe", e modelos maiores (`s`/`m`) dobram/triplicam a latência WASM (~0,8 s do nano por frame).

## Como desligar cada componente

| Componente | Como desligar / limitar | Onde se documenta |
| --- | --- | --- |
| Percepção local (YOLO + pose + mãos) | Seletor **Motor** → `percepcao-sequencia` (variante B), ou os modos `Visão`/`Roteiro`, que não carregam o detector | [`modos.md`](./modos.md) |
| Classificador NSFW experimental | Checkbox **NSFW (experimental)** desligado (padrão); sem pesos exportados em `yolonsfw/` ele também não carrega | [`modos.md`](./modos.md) |
| Leitura temporal | Variante B (temporal ausente); C = básica, D = ampliada — pela mesma escolha de modo | [`arquitetura.md`](./arquitetura.md) |
| Modelo de detecção no navegador | Modos `Visão`/`Roteiro` (sem detecção); nos modos `Eventos`/`Detecção`, troque o modelo no seletor de detecção | [`modos.md`](./modos.md) |
| Chamadas multimodais | Modo `Detecção` não usa backend; nos demais, a política de análise limita a frequência (cooldown 10 s, teto 4/min, resumo a cada 60 s) | [`eventos.md`](./eventos.md) |
| Backend de visão | `NEURO_BASE_URL`/`NEURO_MODEL`/`NEURO_API_KEY` no `.env` (vazio = `http://localhost:1234`) | [`uso.md`](./uso.md) |
| Tradução | `NEURO_TRANSLATE_ENABLED=0` (padrão) | [`uso.md`](./uso.md) |
| Exposição na rede | `HOST=127.0.0.1` + `NEURO_ALLOW_REMOTE=0` (padrões) | [`seguranca.md`](./seguranca.md) |