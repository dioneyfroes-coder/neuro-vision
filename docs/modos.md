# Modos, motores e modelos — Neuro Vision

Como os 4 modos funcionam e como o modelo é escolhido (detecção no navegador + descrição em um backend de visão local compatível com a API de chat completions — LM Studio, llama.cpp ou vLLM).

## Modos

| Motor | Onde roda | O que faz |
| --- | --- | --- |
| **Detecção** (transformers.js) | Navegador (WebGPU/CPU) | Detecta objetos (pessoa, carro, celular, ...) com caixas e confiança, usando YOLOS ou DETR (COCO). |
| **Roteiro** (modelo de visão) | Servidor (backend de visão) | Faz **uma análise profunda da cena** (base) e, a cada novo frame, registra **apenas o que mudou** em relação ao que já aconteceu — montando um roteiro cronológico. É o motor padrão da interface. |
| **Descrição** (modelo de visão) | Servidor (backend de visão) | Descreve cada frame em português, do zero (sem reenviar a descrição anterior). |
| **Eventos** (leve + modelo de visão sob demanda) | Navegador + servidor | Roda a detecção a cada tick e só chama o modelo de visão quando a **política de eventos** decide: mudança de cena, nova entidade, desaparecimento, movimento, baixa confiança, resumo periódico ou pedido manual — com cooldown e teto de chamadas por minuto. Detalhes em [`eventos.md`](./eventos.md). |

A troca de motor é centralizada em `public/modos.ts` (registro `MODOS`): cada modo descreve se usa detecção/modelo de visão, o prefixo da mensagem de falha e a fábrica de motor — o resto da aplicação não tem `if (modo === "...")` espalhado. O `<select id="motor">` abre em **Roteiro** (primeira opção) e `MODO_PADRAO = "deteccao"` é apenas o fallback para valores desconhecidos. O seletor de modelo ao lado (`#model`) é o do **navegador** (abaixo).

## Backend de visão

O app fala **um único protocolo**, a API de "chat completions":

- `POST /v1/chat/completions` para gerar a descrição;
- `GET /v1/models` para listar os modelos instalados.

É o protocolo exposto pelo **LM Studio**, pelo llama.cpp (`llama-server`) e pelo vLLM. A URL base vem de `NEURO_BASE_URL` (padrão `http://localhost:1234`, a porta do LM Studio) e `NEURO_API_KEY` é enviada como `Authorization: Bearer` (o LM Studio ignora). Se o backend não expuser `/api/v0/models` (introspecção do LM Studio), a confirmação de "modelo em memória" é simplesmente ignorada — o app continua funcionando. A imagem vai como `image_url` (data URL); se a versão do backend rejeitar data URL, defina `NEURO_IMG_BASE64_CRU=1` para enviar base64 cru.

## Escolha do modelo do backend de visão

O app usa **um modelo de visão por vez**, definido pelo ambiente (não há seletor na interface):

- **Padrão:** `qwen2.5-vl-3b-instruct` (`MODELO_PADRAO` em `src/visao.ts`).
- **Troca:** variável `NEURO_MODEL` (ex.: `NEURO_MODEL=Qwen2.5-VL-7B-Instruct npm start`). Use exatamente o id mostrado em `GET /v1/models`.
- **Fallback automático:** se o modelo configurado **não estiver disponível**, o app escolhe o melhor encontrado (`melhorModeloDisponivel`), na ordem de `PREFERENCIA_MODELOS` — modelos de visão capazes primeiro (`qwen2.5-vl`, `qwen2.5vl`, `qwen3-vl`, `qwen2-vl`, `llama-3.2-vision`, `minicpm-v`, `gemma-4`, `llava`, ...). Sem backend acessível, mantém o configurado.
- **Requisito:** modelo **multimodal (visão) e não-pensante**. O servidor detecta quando o modelo "só pensa" (devolve `reasoning_content`/`content` vazio) e reporta isso com uma orientação.

> **Nota sobre modelos "thinking":** modelos como o `qwen3-vl` gastam o `max_tokens` raciocinando e devolvem `content` vazio (nenhum log sai da descrição). Por isso a integração detecta esse caso e recomenda um modelo de visão não-pensante (ex.: `qwen2.5-vl-3b-instruct` ou `llama-3.2-vision`) para descrição de frames. Um modelo de texto puro (sem visão) também não serve. A tradução automática da saída é **desligada por padrão** (`NEURO_TRANSLATE_ENABLED=false`): com um modelo capaz, a descrição já sai em português.

A linha de diagnóstico mostra o **backend em uso** (`LM Studio`), o **modelo em uso** (o `NEURO_MODEL`/padrão, ou o substituto) e os **modelos carregados** — via `GET /api/health`, que lista o que está instalado (`/v1/models`), informa o `solicitado` e o `modelo` efetivo e, quando o backend permite (`/api/v0/models`), o que está em memória. Quando há substituição, a linha indica `fallback de <solicitado>`.

## Modelos de detecção (navegador)

O seletor `#model` da interface oferece modelos COCO via Transformers.js:

- `Xenova/yolos-tiny` — rápido (default).
- `Xenova/detr-resnet-50` — mais preciso, mais pesado.

## Repetição na descrição

O motor de descrição costumava repetir/fundir frases. As causas eram do próprio modelo, agravadas por reinjetar a descrição anterior inteira. Mitigações atuais: cada frame é descrito **do zero** (a descrição anterior não é reenviada), amostragem com `temperature: 0.2`, `top_p: 0.9`, `max_tokens` reduzido no delta do roteiro (`NUM_PREDICT_DELTA`) e pós-processamento (`colapsarRepeticoes` + `cortarFraseIncompleta`) no servidor.