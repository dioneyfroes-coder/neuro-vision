# Neuro Vision

Visão computacional 100% local: a webcam enxerga e registra o que vê. A imagem capturada nunca sai do seu computador — a detecção roda no navegador (transformers.js) e a descrição roda em um backend local (Ollama ou um servidor compatível com a API OpenAI, como o LM Studio).


## Modos

| Motor | Onde roda | O que faz |
| --- | --- | --- |
| **Detecção** (transformers.js) | Navegador (WebGPU/CPU) | Detecta objetos (pessoa, carro, celular, ...) com caixas e confiança, usando YOLOS ou DETR (COCO). |
| **Roteiro** (modelo de visão) | Servidor | Uma análise profunda da cena (base) e, depois, **apenas o que mudou** — um roteiro cronológico. |
| **Descrição** (modelo de visão) | Servidor | Descreve cada frame em português, comparando com o anterior para evitar repetições. |
| **Eventos** (leve + modelo de visão sob demanda) | Navegador + servidor | Detecção a cada tick; o modelo de visão só roda quando a política decide (novidade, mudança, baixa confiança, resumo periódico...). |

## Início rápido

Requisitos: **Node.js 20+** e, para os modos de descrição/roteiro, um **modelo de visão** servido localmente. Duas opções:

- **Ollama** (API nativa) — `ollama pull llama3.2-vision:11b`.
- **LM Studio / llama.cpp / vLLM** (API compatível com OpenAI) — carregue um modelo de visão (ex.: `Qwen2.5-VL-3B-Instruct`, leve e rápido, ou `llama-3.2-11b-vision-instruct`) e inicie o servidor local (padrão `http://localhost:1234`).

```bash
npm install
ollama pull llama3.2-vision:11b   # opção A: Ollama
npm run dev                       # desenvolvimento (abre http://localhost:3000)
npm start                         # produção (build + servidor)
```

> Em modo `auto` (padrão), o servidor detecta o backend na subida: usa o Ollama se estiver no ar, senão cai para a API OpenAI (LM Studio). Force com `NEURO_PROVIDER=ollama` ou `NEURO_PROVIDER=openai`.

Clique em **Iniciar** e autorize a webcam.

Configuração essencial (veja a tabela completa em [`docs/uso.md`](./docs/uso.md)):

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP. |
| `NEURO_PROVIDER` | `auto` | Backend: `ollama` (nativo), `openai`/`lmstudio` (LM Studio/llama.cpp) ou `auto` (detecta na subida). |
| `NEURO_BASE_URL` | (por provedor) | URL base do backend. Padrões: `http://localhost:11434` (Ollama) e `http://localhost:1234` (OpenAI). |
| `NEURO_MODEL` | `llama3.2-vision:11b` | Modelo de visão usado na descrição. Se não estiver disponível, o app usa o melhor modelo de visão encontrado. |
| `NEURO_API_KEY` | (vazio) | Chave enviada como `Authorization: Bearer` no protocolo OpenAI. |

> A configuração fica centralizada em [`src/env.ts`](./src/env.ts). Copie [`.env.example`](./.env.example) para `.env` (não versionado) para definir os valores de uma vez; variáveis já exportadas no shell têm prioridade. Sem `.env`, valem os padrões da tabela.

## Documentação (`docs/`)

| Documento | Conteúdo |
| --- | --- |
| [`docs/uso.md`](./docs/uso.md) | Instalação, execução, variáveis de ambiente, offline, diagnóstico e scripts. |
| [`docs/modos.md`](./docs/modos.md) | Modos/motores e escolha do modelo (navegador + backend de visão). |
| [`docs/api.md`](./docs/api.md) | API HTTP completa, snapshot = frame analisado, retenção de snapshots, memória JSONL. |
| [`docs/eventos.md`](./docs/eventos.md) | Fluxo orientado a eventos: política, motivos, cancelamento e consulta ao histórico. |
| [`docs/arquitetura.md`](./docs/arquitetura.md) | Estrutura de arquivos e como as partes conversam. |
| [`docs/seguranca.md`](./docs/seguranca.md) | Exposição na rede e controles aplicados. |
| [`docs/qualidade.md`](./docs/qualidade.md) | Benchmark, avaliação de eventos (precisão/recall) e regressão. |
| [`docs/limites.md`](./docs/limites.md) | Limitações conhecidas. |

Índice completo e "como manter a documentação" em [`docs/README.md`](./docs/README.md).

## Testes

```bash
npm test          # unitários/integração (vitest)
npm run test:e2e  # fluxos no navegador (Playwright)
npm run typecheck && npm run lint
```

Detalhes de benchmark e qualidade de eventos em [`docs/qualidade.md`](./docs/qualidade.md).

## Licença

MIT.