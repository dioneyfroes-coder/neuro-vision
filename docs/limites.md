# Limitações conhecidas — Neuro Vision

- **Classes não treinadas:** a detecção usa modelos COCO (YOLOS/DETR). Objetos fora dessas classes simplesmente não são vistos — não é uma falha de configuração.
- **Oclusão:** objetos parcialmente escondidos podem oscilar entre aparecer/desaparecer, gerando eventos espúrios.
- **Iluminação:** cenas escuras, estouro de luz ou contraluz reduzem confiança e aumentam mudanças perdidas.
- **Alucinações do modelo de visão:** o Ollama pode descrever coisas que não estão na cena. O texto é tratado como relato do modelo, não como verdade.
- **Identificação incerta de objetos:** o mesmo objeto pode ser rotulado de formas diferentes entre frames; o rastreamento usa IoU e movimento, não reidentificação de longo prazo.
- **Cenas estáticas:** a política evita chamar o Ollama sem mudança, mas ruído de sensor/compressão ainda pode disparar `mudanca_de_cena`.
- **WebGPU/CPU:** a detecção prefere WebGPU; sem ele roda em CPU (aviso persistente na interface) e fica bem mais lenta — nesta máquina, ~24 s por inferência em WASM/CPU contra ~5–6 s em WebGPU. Isso limita a cadência de análise, e a janela entre amostras vira a tolerância natural da avaliação de eventos.
- **`HOST` e dados sensíveis:** o servidor escuta em `127.0.0.1` por padrão; subir para `0.0.0.0` expõe a webcam e os logs. Snapshots e logs podem conter pessoas — trate-os como dados sensíveis. Ver [`seguranca.md`](./seguranca.md).