# Modos, motores e modelos — Neuro Vision

Como os 4 modos funcionam e como o modelo é escolhido (detecção no navegador + descrição no Ollama local).

## Modos

| Motor | Onde roda | O que faz |
| --- | --- | --- |
| **Detecção** (transformers.js) | Navegador (WebGPU/CPU) | Detecta objetos (pessoa, carro, celular, ...) com caixas e confiança, usando YOLOS ou DETR (COCO). |
| **Roteiro** (Ollama local) | Servidor (Ollama local) | Faz **uma análise profunda da cena** (base) e, a cada novo frame, registra **apenas o que mudou** em relação ao que já aconteceu — montando um roteiro cronológico. É o motor padrão da interface. |
| **Descrição** (Ollama local) | Servidor (Ollama local) | Descreve cada frame em português, comparando com o frame anterior para evitar repetições. |
| **Eventos** (leve + Ollama sob demanda) | Navegador + servidor | Roda a detecção a cada tick e só chama o Ollama quando a **política de eventos** decide: mudança de cena, nova entidade, desaparecimento, movimento, baixa confiança, resumo periódico ou pedido manual — com cooldown e teto de chamadas por minuto. Detalhes em [`eventos.md`](./eventos.md). |

A troca de motor é centralizada em `public/modos.ts` (registro `MODOS`): cada modo descreve se usa detecção/Ollama, o prefixo da mensagem de falha e a fábrica de motor — o resto da aplicação não tem `if (modo === "...")` espalhado. O `<select id="motor">` abre em **Roteiro** (primeira opção) e `MODO_PADRAO = "deteccao"` é apenas o fallback para valores desconhecidos. O seletor de modelo ao lado (`#model`) é o do **navegador** (abaixo).

## Escolha do modelo do Ollama

O app usa **um modelo de visão por vez**, definido pelo ambiente (não há seletor na interface):

- **Padrão:** `qwen2.5vl:3b` (`MODELO_PADRAO` em `src/ollama.ts`).
- **Troca:** variável `OLLAMA_MODEL` (ex.: `OLLAMA_MODEL=qwen2.5vl:7b npm start`).
- **Requisito:** modelo **multimodal (visão) e não-pensante**. O servidor chama `/api/chat` com `think:false` e detecta quando o modelo "só pensa" (devolve `content` vazio).

> **Nota sobre `qwen3-vl`:** o `qwen3-vl` é um modelo "thinking" e, nos builds atuais do Ollama, o `think:false` é **ignorado** — o modelo gasta o `num_predict` raciocinando e devolve `content` vazio (nenhum log sai da descrição). Por isso a integração usa `/api/chat` com detecção desse caso e recomenda o `qwen2.5vl` (não-pensante) para descrição de frames. O `qwen2.5-coder` (texto puro, sem visão) também não serve.

A linha de diagnóstico mostra o **modelo solicitado** (o `OLLAMA_MODEL`/padrão) e os **modelos carregados** — via `GET /api/health`, que lista o que está instalado (`/api/tags`) e em memória (`/api/ps`). Modelos instalados no Ollama além do configurado aparecem lá, mas **não são selecionáveis**: descrição/roteiro sempre usam o `OLLAMA_MODEL`.

## Modelos de detecção (navegador)

O seletor `#model` da interface oferece modelos COCO via Transformers.js:

- `Xenova/yolos-tiny` — rápido (default).
- `Xenova/detr-resnet-50` — mais preciso, mais pesado.

## Repetição na descrição

O motor de descrição costumava repetir/fundir frases. As causas eram do próprio modelo, agravadas por reinjetar a descrição anterior inteira. Mitigações: `repeat_penalty: 1.3`, `repeat_last_n: 128`, `top_p: 0.9`, `num_predict` reduzido no delta do roteiro e pós-processamento (`colapsarRepeticoes` + `cortarFraseIncompleta`) no servidor.