# Uso — Neuro Vision

Instalação, execução, configuração, funcionamento offline e diagnóstico. Para a visão geral em ~60 segundos, veja o [`README.md`](../README.md); os modos e a escolha de modelo estão em [`modos.md`](./modos.md).

## Requisitos

- Node.js 20+ (usa `fetch` e `AbortSignal.timeout` nativos).
- (Opcional, para os modos de descrição/roteiro) [Ollama](https://ollama.com) instalado e rodando.

## Instalação

```bash
npm install
```

Para os modos de descrição/roteiro, baixe um modelo de visão:

```bash
ollama pull qwen2.5vl:3b
```

Sobre qual modelo usar (thinking vs. não-pensante) e a nota do `qwen3-vl`, veja [`modos.md`](./modos.md#escolha-do-modelo-do-ollama).

## Execução

Desenvolvimento (servidor com hot-reload + build do cliente em watch):

```bash
npm run dev
```

Depois abra http://localhost:3000 e clique em **Iniciar**. Autorize o acesso à webcam.

Produção:

```bash
npm start
```

## Configuração

Variáveis de ambiente lidas pelo servidor:

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP. |
| `HOST` | `127.0.0.1` | Interface de escuta. Um host não-loopback exige `NEURO_ALLOW_REMOTE=1`. |
| `OLLAMA_HOST` | `http://localhost:11434` | URL do Ollama. |
| `OLLAMA_MODEL` | `qwen2.5vl:3b` | Modelo de visão não-pensante usado na descrição. |
| `LOG_MAX_BYTES` | `5000000` | Tamanho máximo de cada JSONL (`visao.jsonl`, `eventos.jsonl`, `operacional.jsonl`) antes de rotacionar para `.1`. |
| `SNAP_MAX_BYTES` | `200000000` | Tamanho total máximo de `logs/snapshots/` em bytes (`0` desativa). |
| `SNAP_MAX_FILES` | `1000` | Quantidade máxima de snapshots (`0` desativa). |
| `SNAP_MAX_AGE_DAYS` | `30` | Idade máxima de um snapshot em dias (`0` desativa). |
| `SNAP_CLEAN_INTERVAL_MS` | `600000` | Intervalo mínimo entre limpezas automáticas disparadas por novas gravações. |
| `SNAP_UPLOAD_MAX_BYTES` | `5000000` | Limite de um único snapshot (data URL/base64) aceito para gravação. |
| `BODY_MAX_BYTES` | `1000000` | Limite do corpo JSON de `POST /api/log`, `/api/eventos` e `/api/operacional`. |
| `VISAO_BODY_MAX_BYTES` | `12000000` | Limite do corpo JSON de `POST /api/visao`. |
| `NEURO_ALLOW_REMOTE` | (vazio) | `1` permite escutar em host não-loopback (assumindo o risco). |
| `NEURO_ALLOWED_ORIGINS` | (vazio) | CSV de origens extras permitidas além da própria (ex.: `http://host:3000`). |

Exemplo:

```bash
$env:OLLAMA_MODEL="qwen2.5vl:7b"; npm start   # PowerShell
OLLAMA_MODEL=qwen2.5vl:7b npm start            # bash
```

> A respeito de expor o servidor na rede e dos controles de segurança, veja [`seguranca.md`](./seguranca.md).

## Funcionamento offline

**O que roda localmente:** o servidor Node (API + arquivos estáticos), a inferência do Ollama e a detecção de objetos no navegador (WebGPU ou CPU via Transformers.js). A imagem da webcam nunca sai da máquina: os modos de detecção rodam no navegador e os de descrição/roteiro conversam apenas com o Ollama local.

**O que é baixado na primeira execução:**

| Recurso | De onde | Quando | Fica em cache? |
| --- | --- | --- | --- |
| Bibliotecas de desenvolvimento (`esbuild`, `tsx`, `vitest`, `playwright`) | npm | `npm install` | `node_modules/` |
| Transformers.js **3.8.1** (fixado) | CDN (`cdn.jsdelivr.net`) | ao usar um modo de detecção/eventos (import sob demanda) | cache HTTP do navegador |
| Pesos do modelo de detecção (ex.: `Xenova/yolos-tiny`) | Hugging Face Hub | na primeira carga do modelo | cache do navegador (`useBrowserCache`) |
| Modelo de visão (ex.: `qwen2.5vl:3b`) | Ollama | `ollama pull` | pasta do Ollama |

**Como preparar antes de ficar offline:**

1. `ollama pull qwen2.5vl:3b` uma vez, com internet.
2. Subir o app, escolher o motor **Detecção** (ou **Eventos**) e clicar **Iniciar** até o modelo carregar — isso popula o cache do navegador com a biblioteca e os pesos. Repita no mesmo navegador/perfil que será usado offline.

**Comportamento com a rede desconectada (após a preparação):**

- **Roteiro** e **Descrição** funcionam offline — dependem apenas do Ollama local já instalado.
- **Detecção** e **Eventos** funcionam offline se a biblioteca e os pesos ainda estiverem no cache do navegador.
- Se o CDN estiver inacessível e **não** houver cache, a **página continua carregando normalmente** (a dependência é carregada sob demanda, não no carregamento da página) e apenas a detecção falha, com mensagem clara (`Falha ao carregar modelo: ...`) e a webcam liberada. Os modos Ollama seguem utilizáveis.

A versão do Transformers.js é **fixa** (`3.8.1`), em vez do tag flutuante `@3`, para que o comportamento não mude sem aviso.

> **Avaliação (empacotar localmente):** hospedar a biblioteca e os pesos no servidor eliminaria a dependência do CDN e do cache do navegador, mas exigiria embarcar dezenas de MB no repositório/instalação e um passo próprio de download de pesos. A opção escolhida — CDN com versão fixa + cache do navegador + carregamento sob demanda — cobre o uso offline após a preparação com o menor custo e sem inflar o projeto. A decisão pode ser revista se o offline passar a ser requisito primário.

## Diagnóstico

O cabeçalho mostra uma **linha de diagnóstico** com o **motor ativo** (ou “parado”), o **modelo solicitado** (o do navegador nos modos detecção/eventos; o `OLLAMA_MODEL` nos modos Ollama) e os **modelos carregados** no Ollama (via `GET /api/health`, que também informa o `modelo` configurado).

Ela separa três tempos para localizar a lentidão:

- **carga** — quanto o modelo levou para inicializar (`inicializar`);
- **inferência** — `duracaoMs` do resultado da análise;
- **persistência** — quanto levou para gravar a entrada no servidor.

Quando a detecção de objetos **não consegue usar WebGPU** e roda em CPU (WASM), aparece um **aviso persistente** (que só sai ao recarregar a página), com texto específico conforme o navegador ofereça ou não WebGPU.

## Scripts

| Script | Descrição |
| --- | --- |
| `npm run dev` | Servidor + cliente em modo watch. |
| `npm run build` | Build de servidor (`dist/server.js`) e cliente (`public/app.js`). |
| `npm start` | Build e executa o servidor. |
| `npm test` | Testes unitários/integração (vitest). |
| `npm run test:watch` | Testes em watch. |
| `npm run test:e2e` | Testes E2E (Playwright; requer `npx playwright install chromium`). |
| `npm run typecheck` | Checagem de tipos (`tsc --noEmit`). |
| `npm run lint` | ESLint. |
| `npm run lint:fix` | ESLint com correção automática. |
| `npm run bench` | Benchmark de velocidade do modelo local (requer Ollama rodando). |
| `npm run qualidade` | Compara os eventos gravados com a anotação de um clipe (precisão/recall, falsos positivos por minuto). |
| `npm run gravar:webcam` | Grava alguns segundos da webcam em `.webm` (clipe para a avaliação de eventos). |
| `npm run extrair:frames` | Extrai quadros de um clipe `.webm` para conferência/anotação. |