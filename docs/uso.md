# Uso — Neuro Vision

Instalação, execução, configuração, funcionamento offline e diagnóstico. Para a visão geral em ~60 segundos, veja o [`README.md`](../README.md); os modos e a escolha de modelo estão em [`modos.md`](./modos.md).

## Requisitos

- Node.js 20+ (usa `fetch` e `AbortSignal.timeout` nativos).
- (Opcional, para os modos de descrição/roteiro) um backend de visão local: [Ollama](https://ollama.com) com a API nativa, ou um servidor compatível com a API OpenAI (LM Studio, llama.cpp, vLLM).

## Instalação

```bash
npm install
```

Para os modos de descrição/roteiro, garanta um modelo de visão disponível. Com Ollama:

```bash
ollama pull qwen2.5vl:3b
```

Com LM Studio, carregue um modelo de visão (ex.: `qwen2.5-vl-3b-instruct`, o padrão do app) e inicie o servidor local na porta padrão (`1234`).

Sobre qual modelo usar (thinking vs. não-pensante), o fallback automático e a nota do `qwen3-vl`, veja [`modos.md`](./modos.md#escolha-do-modelo-do-backend-de-visão).

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

A configuração fica centralizada em [`src/env.ts`](../src/env.ts). Copie [`.env.example`](../.env.example) para `.env` (na raiz, ignorado pelo Git) para definir tudo em um só lugar:

```bash
cp .env.example .env   # bash
Copy-Item .env.example .env   # PowerShell
```

Variáveis já exportadas no shell têm prioridade sobre o `.env`. Se o arquivo não existir, valem os padrões abaixo.

Variáveis de ambiente lidas pelo servidor:

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP. |
| `HOST` | `127.0.0.1` | Interface de escuta. Um host não-loopback exige `NEURO_ALLOW_REMOTE=1`. |
| `NEURO_PROVIDER` | `auto` | Backend de visão: `ollama` (API nativa), `openai`/`lmstudio` (API compatível com OpenAI) ou `auto` (detecta na subida: Ollama, senão OpenAI). |
| `NEURO_BASE_URL` | (por provedor) | URL base do backend. Padrões: `http://localhost:11434` (Ollama) e `http://localhost:1234` (OpenAI). Tem prioridade sobre `OLLAMA_HOST`/`OPENAI_BASE_URL`. |
| `NEURO_MODEL` | `qwen2.5-vl-3b-instruct` | Modelo de visão usado na descrição. Se não estiver disponível, o app usa o melhor modelo de visão encontrado. |
| `NEURO_API_KEY` | (vazio) | Chave enviada como `Authorization: Bearer` no protocolo OpenAI (o LM Studio ignora). |
| `NEURO_IMG_BASE64_CRU` | (vazio) | `1` envia a imagem como base64 cru em `image_url.url` (workaround para versões do LM Studio que rejeitam data URL). |
| `NEURO_TRANSLATE_ENABLED` | `false` | `1` reativa a tradução da descrição para português (desnecessária com um modelo de visão capaz). |
| `NEURO_TRANSLATE_MODEL` | (mesmo do modelo) | Modelo usado para traduzir quando a tradução está habilitada. |
| `OLLAMA_HOST` | `http://localhost:11434` | URL do Ollama (equivalente a `NEURO_BASE_URL` quando o provedor é `ollama`). |
| `OLLAMA_MODEL` | (vazio) | Nome antigo de `NEURO_MODEL` (mantido por compatibilidade). |
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

Exemplo (Ollama):

```bash
$env:NEURO_MODEL="qwen2.5vl:7b"; npm start   # PowerShell
NEURO_MODEL=qwen2.5vl:7b npm start            # bash
```

Exemplo (LM Studio, API OpenAI):

```bash
$env:NEURO_PROVIDER="openai"; $env:NEURO_MODEL="llama-3.2-11b-vision-instruct"; npm start   # PowerShell
NEURO_PROVIDER=openai NEURO_MODEL=llama-3.2-11b-vision-instruct npm start                    # bash
```

Exemplo (LM Studio com o Qwen2.5-VL 3B Instruct — leve e rápido):

```bash
# 1. No LM Studio: aba "Developer" > "Start Server" e carregue "Qwen2.5-VL-3B-Instruct".
# 2. A URL base é a mesma que o LM Studio mostra ("http://127.0.0.1:<porta>"); o
#    padrão do app é a porta 1234. Se o LM Studio estiver em outra porta, use NEURO_BASE_URL.
$env:NEURO_PROVIDER="openai"; $env:NEURO_BASE_URL="http://127.0.0.1:1234"; $env:NEURO_MODEL="qwen2.5-vl-3b-instruct"; npm start   # PowerShell
NEURO_PROVIDER=openai NEURO_BASE_URL=http://127.0.0.1:1234 NEURO_MODEL=qwen2.5-vl-3b-instruct npm start                           # bash
```

> `NEURO_MODEL` deve ser exatamente o `id` mostrado no LM Studio (o mesmo de `GET /v1/models`). Em `auto` (padrão) o app detecta o backend sozinho, mas se o Ollama também estiver no ar ele tem prioridade — force `NEURO_PROVIDER=openai` para usar o LM Studio.

Teste rápido da integração (sem abrir o navegador), com o LM Studio já rodando:

```bash
$env:LMSTUDIO_URL="http://127.0.0.1:1234"; $env:NEURO_MODEL="qwen2.5-vl-3b-instruct"; npm run integrar:lmstudio   # PowerShell
LMSTUDIO_URL=http://127.0.0.1:1234 NEURO_MODEL=qwen2.5-vl-3b-instruct npm run integrar:lmstudio                     # bash
```

> A respeito de expor o servidor na rede e dos controles de segurança, veja [`seguranca.md`](./seguranca.md).

## Funcionamento offline

**O que roda localmente:** o servidor Node (API + arquivos estáticos), a inferência do backend de visão local e a detecção de objetos no navegador (WebGPU ou CPU via Transformers.js). A imagem da webcam nunca sai da máquina: os modos de detecção rodam no navegador e os de descrição/roteiro conversam apenas com o backend de visão local.

**O que é baixado na primeira execução:**

| Recurso | De onde | Quando | Fica em cache? |
| --- | --- | --- | --- |
| Bibliotecas de desenvolvimento (`esbuild`, `tsx`, `vitest`, `playwright`) | npm | `npm install` | `node_modules/` |
| Transformers.js **3.8.1** (fixado) | CDN (`cdn.jsdelivr.net`) | ao usar um modo de detecção/eventos (import sob demanda) | cache HTTP do navegador |
| Pesos do modelo de detecção (ex.: `Xenova/yolos-tiny`) | Hugging Face Hub | na primeira carga do modelo | cache do navegador (`useBrowserCache`) |
| Modelo de visão (ex.: `qwen2.5vl:3b` no Ollama, `qwen2.5-vl-3b-instruct` no LM Studio) | Ollama (`ollama pull`) ou LM Studio (download na própria interface) | antes de usar | pasta do Ollama / pasta de modelos do LM Studio |

**Como preparar antes de ficar offline:**

1. Baixe o modelo de visão uma vez, com internet: `ollama pull qwen2.5vl:3b` (Ollama) ou baixe/carregue `qwen2.5-vl-3b-instruct` no LM Studio.
2. Subir o app, escolher o motor **Detecção** (ou **Eventos**) e clicar **Iniciar** até o modelo carregar — isso popula o cache do navegador com a biblioteca e os pesos. Repita no mesmo navegador/perfil que será usado offline.

**Comportamento com a rede desconectada (após a preparação):**

- **Roteiro** e **Descrição** funcionam offline — dependem apenas do backend de visão local já instalado.
- **Detecção** e **Eventos** funcionam offline se a biblioteca e os pesos ainda estiverem no cache do navegador.
- Se o CDN estiver inacessível e **não** houver cache, a **página continua carregando normalmente** (a dependência é carregada sob demanda, não no carregamento da página) e apenas a detecção falha, com mensagem clara (`Falha ao carregar modelo: ...`) e a webcam liberada. Os modos de visão seguem utilizáveis.

A versão do Transformers.js é **fixa** (`3.8.1`), em vez do tag flutuante `@3`, para que o comportamento não mude sem aviso.

> **Avaliação (empacotar localmente):** hospedar a biblioteca e os pesos no servidor eliminaria a dependência do CDN e do cache do navegador, mas exigiria embarcar dezenas de MB no repositório/instalação e um passo próprio de download de pesos. A opção escolhida — CDN com versão fixa + cache do navegador + carregamento sob demanda — cobre o uso offline após a preparação com o menor custo e sem inflar o projeto. A decisão pode ser revista se o offline passar a ser requisito primário.

## Diagnóstico

O cabeçalho mostra uma **linha de diagnóstico** com o **motor ativo** (ou “parado”), o **backend em uso** (`Ollama` ou `LM Studio`), o **modelo em uso** (o do navegador nos modos detecção/eventos; o `NEURO_MODEL`/padrão nos modos de visão, ou o substituto quando há fallback) e os **modelos carregados** no backend (via `GET /api/health`, que também informa o `solicitado`, o `modelo` efetivo e o `provedor`). Quando o modelo configurado não está disponível, a linha acrescenta `fallback de <solicitado>`.

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
| `npm run integrar:lmstudio` | Teste prático automático da integração com o LM Studio (lista modelos, prepara o modelo e descreve um frame sintético pela API real do servidor). Configure a URL e o modelo com `LMSTUDIO_URL` e `NEURO_MODEL`. |