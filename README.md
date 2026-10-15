# Neuro Vision

Visão computacional 100% local: a webcam enxerga e registra o que vê. A imagem capturada nunca sai do seu computador — a detecção roda no navegador (transformers.js) e a descrição roda em um backend local compatível com a API de chat completions (LM Studio, llama.cpp/`llama-server` ou vLLM).


## Modos

| Motor | Onde roda | O que faz |
| --- | --- | --- |
| **Detecção** (transformers.js) | Navegador (WebGPU/CPU) | Detecta objetos (pessoa, carro, celular, ...) com caixas e confiança, usando YOLOS ou DETR (COCO). |
| **Roteiro** (modelo de visão) | Servidor | Uma análise profunda da cena (base) e, depois, **apenas o que mudou** — um roteiro cronológico. |
| **Descrição** (modelo de visão) | Servidor | Descreve cada frame em português, do zero (cada foto é analisada sem reenviar a descrição anterior). |
| **Eventos** (leve + modelo de visão sob demanda) | Navegador + servidor | Detecção a cada tick; o modelo de visão só roda quando a política decide (novidade, mudança, baixa confiança, resumo periódico...). |

## Início rápido

Requisitos: **Node.js 20+** e, para os modos de descrição/roteiro, um **modelo de visão** servido localmente por um backend compatível com a API de chat completions:

- **LM Studio** — carregue um modelo de visão (ex.: `Qwen2.5-VL-3B-Instruct`, leve e rápido — é o padrão do app) e inicie o servidor local (padrão `http://localhost:1234`).
- **llama.cpp (`llama-server`)** ou **vLLM** — com um modelo de visão e o endpoint `/v1/chat/completions` habilitado.

```bash
npm install
npm run dev                       # desenvolvimento (abre http://localhost:3000)
npm start                         # produção (build + servidor)
```

> O app fala sempre o mesmo protocolo (`/v1/chat/completions` e `/v1/models`). Aponte `NEURO_BASE_URL` para o backend; sem essa variável, o padrão é `http://localhost:1234` (LM Studio).

Clique em **Iniciar** e autorize a webcam.

Configuração essencial (veja a tabela completa em [`docs/uso.md`](./docs/uso.md)):

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP. |
| `NEURO_BASE_URL` | `http://localhost:1234` | URL base do backend de visão (LM Studio, llama.cpp, vLLM). |
| `NEURO_MODEL` | `qwen2.5-vl-3b-instruct` | Modelo de visão usado na descrição (quando o seletor **Modelo de visão** da interface está em "Padrão do servidor"). Se não estiver disponível, o app usa o melhor modelo de visão encontrado. |
| `NEURO_API_KEY` | (vazio) | Chave enviada como `Authorization: Bearer` (o LM Studio ignora). |

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