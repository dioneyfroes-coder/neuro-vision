# Neuro Vision

Visão computacional 100% local: a webcam enxerga e registra o que vê. A imagem capturada nunca sai do seu computador — a detecção roda no navegador (transformers.js) e a descrição roda em um Ollama local.

> **Regra de documentação (60 segundos):** este README é o guia rápido — deve ser lido em ~60 s. Todo detalhe mora em [`docs/`](./docs/README.md). Se um assunto não cabe numa leitura rápida, ele vai para `docs/`, para nunca perdermos documentação.

## Modos

| Motor | Onde roda | O que faz |
| --- | --- | --- |
| **Detecção** (transformers.js) | Navegador (WebGPU/CPU) | Detecta objetos (pessoa, carro, celular, ...) com caixas e confiança, usando YOLOS ou DETR (COCO). |
| **Roteiro** (Ollama local) | Servidor | Uma análise profunda da cena (base) e, depois, **apenas o que mudou** — um roteiro cronológico. |
| **Descrição** (Ollama local) | Servidor | Descreve cada frame em português, comparando com o anterior para evitar repetições. |
| **Eventos** (leve + Ollama sob demanda) | Navegador + servidor | Detecção a cada tick; o Ollama só roda quando a política decide (novidade, mudança, baixa confiança, resumo periódico...). |

## Início rápido

Requisitos: **Node.js 20+** e, para os modos de descrição/roteiro, **Ollama** com um modelo de visão não-pensante.

```bash
npm install
ollama pull qwen2.5vl:3b     # modelo de visão (padrão do app)
npm run dev                  # desenvolvimento (abre http://localhost:3000)
npm start                    # produção (build + servidor)
```

Clique em **Iniciar** e autorize a webcam.

Configuração essencial (veja a tabela completa em [`docs/uso.md`](./docs/uso.md)):

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP. |
| `OLLAMA_HOST` | `http://localhost:11434` | URL do Ollama. |
| `OLLAMA_MODEL` | `qwen2.5vl:3b` | Modelo de visão não-pensante usado na descrição (`qwen3-vl` funciona só no chat manual: é "thinking" e o `think:false` é ignorado). |

## Documentação (`docs/`)

| Documento | Conteúdo |
| --- | --- |
| [`docs/uso.md`](./docs/uso.md) | Instalação, execução, variáveis de ambiente, offline, diagnóstico e scripts. |
| [`docs/modos.md`](./docs/modos.md) | Modos/motores e escolha do modelo (navegador + Ollama). |
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