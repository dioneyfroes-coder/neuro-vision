# Modos, motores e modelos — Neuro Vision

Como os 4 modos funcionam e como o modelo é escolhido (detecção no navegador + descrição em um backend de visão local — Ollama ou API OpenAI/LM Studio).

## Modos

| Motor | Onde roda | O que faz |
| --- | --- | --- |
| **Detecção** (transformers.js) | Navegador (WebGPU/CPU) | Detecta objetos (pessoa, carro, celular, ...) com caixas e confiança, usando YOLOS ou DETR (COCO). |
| **Roteiro** (modelo de visão) | Servidor (backend de visão) | Faz **uma análise profunda da cena** (base) e, a cada novo frame, registra **apenas o que mudou** em relação ao que já aconteceu — montando um roteiro cronológico. É o motor padrão da interface. |
| **Descrição** (modelo de visão) | Servidor (backend de visão) | Descreve cada frame em português, comparando com o frame anterior para evitar repetições. |
| **Eventos** (leve + modelo de visão sob demanda) | Navegador + servidor | Roda a detecção a cada tick e só chama o modelo de visão quando a **política de eventos** decide: mudança de cena, nova entidade, desaparecimento, movimento, baixa confiança, resumo periódico ou pedido manual — com cooldown e teto de chamadas por minuto. Detalhes em [`eventos.md`](./eventos.md). |

A troca de motor é centralizada em `public/modos.ts` (registro `MODOS`): cada modo descreve se usa detecção/modelo de visão, o prefixo da mensagem de falha e a fábrica de motor — o resto da aplicação não tem `if (modo === "...")` espalhado. O `<select id="motor">` abre em **Roteiro** (primeira opção) e `MODO_PADRAO = "deteccao"` é apenas o fallback para valores desconhecidos. O seletor de modelo ao lado (`#model`) é o do **navegador** (abaixo).

## Backend de visão

O app fala dois protocolos, escolhidos por `NEURO_PROVIDER`:

- **`ollama`** (padrão) — API nativa (`/api/chat`, `/api/tags`, `/api/ps`).
- **`openai`** (alias `lmstudio`) — API compatível com OpenAI (`/v1/chat/completions`, `/v1/models`), usada pelo **LM Studio**, llama.cpp (`llama-server`) e vLLM.
- **`auto`** — na subida, o servidor sonda o Ollama e, se não responder, a API OpenAI (LM Studio), fixando o detectado.

A URL base vem de `NEURO_BASE_URL` (ou dos defaults por provedor: `OLLAMA_HOST` = `http://localhost:11434`; `http://localhost:1234` no protocolo OpenAI). `NEURO_API_KEY` é enviada como `Authorization: Bearer`. No protocolo OpenAI a imagem vai como `image_url` (data URL); se a versão do LM Studio rejeitar data URL, defina `NEURO_IMG_BASE64_CRU=1` para enviar base64 cru.

## Escolha do modelo do backend de visão

O app usa **um modelo de visão por vez**, definido pelo ambiente (não há seletor na interface):

- **Padrão:** `llama3.2-vision:11b` (`MODELO_PADRAO` em `src/ollama.ts`).
- **Troca:** variável `NEURO_MODEL` (ex.: `NEURO_MODEL=qwen2.5vl:7b npm start`); `OLLAMA_MODEL` ainda é aceito por compatibilidade.
- **Fallback automático:** se o modelo configurado **não estiver disponível**, o app escolhe o melhor encontrado (`melhorModeloDisponivel`), na ordem de `PREFERENCIA_MODELOS` — modelos de visão capazes primeiro (`llama-3.2-11b`, `llama-3.2-vision`, `llama3.2`, `qwen2.5vl`, `minicpm-v`, `gemma3`, `llava`, ...) e `moondream` por último (é só um modelo de legenda, não raciocina sobre mudanças). Sem backend acessível, mantém o configurado.
- **Requisito:** modelo **multimodal (visão) e não-pensante**. No Ollama o servidor chama `/api/chat` com `think:false` e detecta quando o modelo "só pensa" (devolve `content` vazio); no protocolo OpenAI a resposta sem texto também é detectada e reportada.

> **Nota sobre `qwen3-vl`:** o `qwen3-vl` é um modelo "thinking" e, nos builds atuais do Ollama, o `think:false` é **ignorado** — o modelo gasta o `num_predict` raciocinando e devolve `content` vazio (nenhum log sai da descrição). Por isso a integração usa `/api/chat` com detecção desse caso e recomenda um modelo de visão não-pensante (ex.: `llama3.2-vision`/`llama-3.2-11b`) para descrição de frames. O `qwen2.5-coder` (texto puro, sem visão) também não serve. A tradução automática da saída é **desligada por padrão** (`NEURO_TRANSLATE_ENABLED=false`): com um modelo capaz, a descrição já sai em português.

A linha de diagnóstico mostra o **backend em uso** (`Ollama`/`LM Studio`), o **modelo em uso** (o `NEURO_MODEL`/padrão, ou o substituto) e os **modelos carregados** — via `GET /api/health`, que lista o que está instalado (`/api/tags` ou `/v1/models`), informa o `provedor`, o `solicitado` e o `modelo` efetivo e mostra o que está em memória (`/api/ps` ou `/api/v0/models`). Quando há substituição, a linha indica `fallback de <solicitado>`.

## Modelos de detecção (navegador)

O seletor `#model` da interface oferece modelos COCO via Transformers.js:

- `Xenova/yolos-tiny` — rápido (default).
- `Xenova/detr-resnet-50` — mais preciso, mais pesado.

## Repetição na descrição

O motor de descrição costumava repetir/fundir frases. As causas eram do próprio modelo, agravadas por reinjetar a descrição anterior inteira. Mitigações: `repeat_penalty: 1.3`, `repeat_last_n: 128`, `top_p: 0.9`, `num_predict` reduzido no delta do roteiro e pós-processamento (`colapsarRepeticoes` + `cortarFraseIncompleta`) no servidor.