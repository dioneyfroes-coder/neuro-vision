# Neuro Vision

Base open-source de visão computacional local: a webcam enxerga e registra o que vê.

Todo o processamento roda na sua máquina. A imagem capturada nunca sai do seu computador — nem para modelos de detecção (rodam no navegador) nem para descrição (rodam em um Ollama local).

## Modos

| Motor | Onde roda | O que faz |
| --- | --- | --- |
| **Detecção** (transformers.js) | Navegador (WebGPU/CPU) | Detecta objetos (pessoa, carro, celular, ...) com caixas e confiança, usando YOLOS ou DETR (COCO). |
| **Roteiro** (Ollama local) | Servidor (Ollama local) | Faz **uma análise profunda da cena** (base) e, a cada novo frame, registra **apenas o que mudou** em relação ao que já aconteceu — montando um roteiro cronológico. É o motor padrão. |
| **Descrição** (Ollama local) | Servidor (Ollama local) | Descreve cada frame em português, comparando com o frame anterior para evitar repetições. |
| **Eventos** (leve + Ollama sob demanda) | Navegador + servidor | Roda a detecção a cada tick e só chama o Ollama quando a **política de eventos** decide: mudança de cena, nova entidade, desaparecimento, movimento, baixa confiança, resumo periódico ou pedido manual — com cooldown e teto de chamadas por minuto.

## Requisitos

- Node.js 20+ (usa `fetch` e `AbortSignal.timeout` nativos).
- (Opcional, para o modo descrição) [Ollama](https://ollama.com) instalado e rodando.

## Instalação

```bash
npm install
```

Para o modo descrição, baixe um modelo de visão:

```bash
ollama pull qwen2.5vl:3b
```

> **Nota sobre `qwen3-vl`:** o `qwen3-vl` é um modelo "thinking" e, nos builds atuais do Ollama, o `think:false` é **ignorado** — o modelo gasta o `num_predict` raciocinando e devolve `content` vazio (nenhum log sai da descrição). Por isso a integração usa `/api/chat` com detecção desse caso e recomenda o `qwen2.5vl` (não-pensante) para descrição de frames.

> **Repetição:** o motor de descrição costumava repetir/fundir frases. As causas eram do próprio modelo, agravadas por reinjetar a descrição anterior inteira. Mitigações: `repeat_penalty: 1.3`, `repeat_last_n: 128`, `top_p: 0.9`, `num_predict` reduzido no delta do roteiro e pós-processamento (`colapsarRepeticoes` + `cortarFraseIncompleta`) no servidor.

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

## Uso

Desenvolvimento (servidor com hot-reload + build do cliente em watch):

```bash
npm run dev
```

Depois abra http://localhost:3000 e clique em **Iniciar**. Autorize o acesso à webcam.

Produção:

```bash
npm start
```

### Configuração

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

## API

| Método | Rota | Descrição |
| --- | --- | --- |
| `POST` | `/api/log` | Grava uma entrada de detecção no arquivo de log. Aceita `snapshot` (data URL) opcional. |
| `POST` | `/api/visao` | Envia um frame (base64) e recebe a descrição do Ollama em stream NDJSON; grava no log. |
| `GET` | `/api/visao/preparar` | Carrega o modelo do Ollama na memória (quando necessário) e responde quando estiver pronto: `{ ok, modelo, carregado, carregandoMs }`. |
| `GET` | `/api/logs?limit=100` | Lista as entradas mais recentes (mais nova primeiro, limite máx. 500). |
| `DELETE` | `/api/logs` | Limpa o histórico de log (inclui a rotação `.1`) **e** os eventos estruturados, removendo os snapshots que ficaram órfãos. |
| `POST` | `/api/eventos` | Grava um evento visual estruturado (`EventoVisual`). Aceita `snapshot` (data URL) opcional. |
| `GET` | `/api/eventos?limit=100` | Lista os eventos mais recentes (mais novo primeiro, limite máx. 500). |
| `DELETE` | `/api/eventos` | Limpa os eventos estruturados e remove os snapshots que ficaram órfãos. |
| `POST` | `/api/operacional` | Grava um registro operacional (falha/métrica) que **não** é acontecimento visual. |
| `GET` | `/api/contexto` | Reidrata um contexto curto do estado recente (`{ resumo, roteiro, ultimaDescricao, entradas, eventos }`) com janela por `maxEntradas`/`maxEventos`/`maxCaracteres`. |
| `GET` | `/api/health` | Status do Ollama (`{ ollama: { online, modelos, carregados, erro } }`). |
| `GET` | `/snapshots/<arquivo>` | Serve os snapshots (thumbnails) gravados. |

As entradas são gravadas em `logs/visao.jsonl`, os eventos em `logs/eventos.jsonl` e os registros operacionais em `logs/operacional.jsonl` (uma linha JSON por registro, própria política de rotação); os snapshots ficam em `logs/snapshots/`.

`POST /api/visao` — corpo:

```json
{ "imagem": "<base64 ou data URL>", "modelo": "qwen2.5vl:3b", "modo": "roteiro", "base": true, "roteiro": "", "anterior": "descrição anterior", "snapshot": "<data URL opcional>" }
```

- `modo`: `"roteiro"` (padrão) ou `"descricao"`.
- `base`: no modo roteiro, `true` no primeiro frame (análise profunda) e `false` nos seguintes (só o que mudou).
- `roteiro`: roteiro acumulado (resumido) enviado como contexto nos deltas.

Resposta: stream NDJSON (`application/x-ndjson`), uma linha por evento:

```json
{ "type": "chunk", "response": "Uma pessoa" }
{ "type": "done", "descricao": "Uma pessoa no escritorio.", "modelo": "qwen2.5vl:3b", "tokens": 42, "ms": 3120, "snapshot": "/snapshots/123-abc.jpg", "tipo": "roteiro", "papel": "delta", "semMudanca": false }
```

No modo roteiro, quando o modelo responde que **nada mudou** (sentinela `INALTERADO`, tolerante a acentos/variações), o servidor devolve `"semMudanca": true` e **não grava** a entrada no log — assim o roteiro não vira ruído.

Em caso de erro após o início do stream: `{ "type": "erro", "erro": "Ollama: ..." }`.

### Retenção de snapshots

Os snapshots em `logs/snapshots/` são limitados por idade, quantidade e tamanho total (variáveis `SNAP_MAX_AGE_DAYS`, `SNAP_MAX_FILES` e `SNAP_MAX_BYTES`; use `0` para desativar um limite). A limpeza:

- considera **preservadas** as entradas do histórico atual e da última rotação, tanto de `visao.jsonl` (observações) quanto de `eventos.jsonl` (eventos estruturados);
- mantém snapshots ainda referenciados por essas entradas enquanto estiverem dentro dos limites;
- remove snapshots **órfãos** (sem nenhuma entrada preservada apontando para eles);
- remove snapshots **expirados** por idade, referenciados ou não;
- ao exceder os tetos de quantidade/tamanho, descarta primeiro os mais antigos;
- roda em segundo plano (na subida do servidor, após novas gravações e ao limpar o histórico), sem bloquear requisições e tolerando falhas parciais de sistema de arquivos.

`DELETE /api/logs` limpa o histórico e os eventos (atuais e `.1`) e, como as entradas deixam de existir, remove de imediato os snapshots que ficaram órfãos.

### Memória persistente

O armazenamento é **JSONL** (`visao.jsonl`, `eventos.jsonl`, `operacional.jsonl`): escrita sequencial append-only e leitura recente, sem dependências e com inspeção trivial. A decisão foi: manter JSONL enquanto essas forem as necessidades; migrar para **SQLite** apenas quando filtros combinados (data **e** objeto **e** tipo de evento) ou agregações sobre um volume maior virarem requisito recorrente — nesse caso preservando a exportação para JSONL e criando migração com teste de integridade. Busca semântica/embeddings fica adiada até haver uma consulta em linguagem natural com ganho mensurável.

Na inicialização, o cliente usa `GET /api/contexto` para **reidratar** o contexto (roteiro recente, última descrição e um resumo curto separado dos eventos completos), limitado por tamanho e número de itens para nunca enviar todo o histórico ao Ollama.

### Fluxo orientado a eventos (modo **Eventos**)

A percepção leve (detecção + rastreamento + mudança de cena) roda em **todo tick** do agendador; o Ollama só é chamado quando a política decide — o motivo é gravado no log como campo `motivo` (por exemplo, `nova_entidade`, `mudanca_de_cena`, `baixa_confianca`, `resumo_periodico`, `manual`) e aparece como “por …” na interface.

Regras da `PoliticaAnalise` (em `src/politica-analise.ts`, configuração `CONFIG_POLITICA_PADRAO`):

- **Primeira análise**: aciona no primeiro tick de cada sessão.
- **Eventos críticos**: `aparicao`, `desaparecimento`, `mudanca_de_cena` acionam por si sós; **movimento** só acima de um mínimo por frame.
- **Baixa confiança**: uma detecção com score menor que `confiancaAlta` (0.6) aciona o Ollama para julgar.
- **Resumo periódico**: mesmo sem mudança, re-analisa a cada `resumoPeriodicoMs` (60 s).
- **Cooldown** (10 s) e **teto de chamadas** (4/min, janela deslizante de 60 s) impedem sequências de inferências em cenas instáveis.
- **“Analisar agora”**: botão que força a análise imediata, ignorando cooldown/janela (respeitando o não-sobrepor).
- **Falha da percepção leve nunca vira “sem mudança”**: vira registro operacional e motivo `falha_percepcao` (dentro da janela).

Cancelamento: quando o cliente cancela uma análise, ele encerra a leitura do stream e o servidor **propaga o abort ao `fetch` do Ollama** (um `AbortController` ligado ao `close` da resposta), derrubando a inferência em vez de deixá-la consumir recursos. O cancelamento é registrado como `visao_cancelada` no log operacional; timeout vira `visao_timeout`.

### Diagnóstico

O cabeçalho mostra uma **linha de diagnóstico** com o **motor ativo** (ou “parado”), o **modelo solicitado** (o do navegador nos modos detecção/eventos; o `OLLAMA_MODEL` nos modos Ollama) e os **modelos carregados** no Ollama (via `GET /api/health`, que também informa o `modelo` configurado).

Ela separa três tempos para localizar a lentidão:

- **carga** — quanto o modelo levou para inicializar (`inicializar`);
- **inferência** — `duracaoMs` do resultado da análise;
- **persistência** — quanto levou para gravar a entrada no servidor.

Quando a detecção de objetos **não consegue usar WebGPU** e roda em CPU (WASM), aparece um **aviso persistente** (que só sai ao recarregar a página), com texto específico conforme o navegador ofereça ou não WebGPU.

### Segurança e exposição na rede

Por padrão o servidor escuta apenas em `127.0.0.1` (loopback), sem autenticação. **Execução local e execução acessível pela rede têm riscos diferentes:**

- **Local (`HOST=127.0.0.1`)**: só processos da máquina alcançam a interface e a API.
- **Expõe na rede (`HOST=0.0.0.0` ou um IP concreto)**: qualquer host da rede local (e, conforme o firewall, além dele) alcança a interface, a API e os snapshots — ou seja, câmera, descrições e histórico. Não há autenticação embutida.

Para deixar esse limite explícito, o servidor **recusa** escutar em host não-loopback sem um opt-in deliberado:

```bash
HOST=0.0.0.0 NEURO_ALLOW_REMOTE=1 npm start   # assume o risco
```

Antes de recomendar exposição na rede, é necessário **implementar autenticação ou outro controle de acesso adequado** (por exemplo, um reverse proxy com autenticação na frente), restringir o firewall à rede confiável e limitar as origens dos navegadores. Enquanto isso não existir, prefira `HOST=127.0.0.1`.

Controles já aplicados:

- Rejeição de **origem cruzada**: requisição com cabeçalho `Origin` só é aceita se bater com o host da requisição ou estiver em `NEURO_ALLOWED_ORIGINS` (resposta `403` caso contrário).
- **Limites de tamanho**: corpo JSON de `/api/log` (`BODY_MAX_BYTES`), de `/api/visao` (`VISAO_BODY_MAX_BYTES`) e de cada snapshot (`SNAP_UPLOAD_MAX_BYTES`).
- **Validação de tipos**: payloads com campos de tipo inválido (ex.: `objetos` não-lista, `resumo`/`imagem` não-texto, `snapshot` não-texto ou acima do limite, `motivo` fora da lista conhecida) são recusados com `400`.

## Estrutura

```
src/
  server.ts            servidor HTTP (estático + API) e persistência (memória + snapshots)
  memoria.ts           armazenamento JSONL genérico, eventos, registros operacionais e reidratação de contexto
  politica-analise.ts  política de análise orientada a eventos (cooldown, janela, motivos)
  percepcao.ts         interface de motor de percepção e resultado normalizado
  erros.ts             taxonomia de erros (origem, cancelamento)
  rastreamento.ts      rastreador de objetos (IDs estáveis, aparição/desaparecimento/movimento)
  cena.ts              detecção de mudança de cena (sinal)
  ollama.ts            cliente do Ollama e montagem dos prompts (descrição e roteiro)
  texto.ts             pós-processamento: colapsa repetições, detecta "sem mudança", corta frase incompleta
  types.ts             tipos compartilhados (EntradaLog, ObjetoVisto, EventoVisual, ...)
  *.test.ts            testes (vitest)
  transformers-cdn.d.ts  tipos para o transformers.js via CDN
public/
  index.html           interface
  app.ts               coordenação da interface (captura, motores, rastreamento, eventos)
  api.ts               cliente HTTP (histórico, eventos, contexto, Ollama)
  detector.ts          detecção de objetos (Transformers.js/CDN)
  camera.ts            controle da webcam e assinatura de cena
  motores.ts           adaptadores para o motor de percepção
  style.css            estilos
logs/
  visao.jsonl          observações gravadas (ignorado no git)
  eventos.jsonl        eventos estruturados (ignorado no git)
  operacional.jsonl    registros operacionais (ignorado no git)
bench/
  imagens/             conjunto fixo de imagens do benchmark (reproduzível)
  videos/              anotações dos clipes de avaliação de eventos (vídeos ficam locais)
  BASELINE.md          máquina de referência e metas realistas por hardware
scripts/
  benchmark.mjs        benchmark do Ollama (latência, tok/s, RAM/VRAM, inferências/min)
  gerar-fixtures-bench.mjs  gera o conjunto fixo de imagens sintéticas
  avaliar-qualidade.mjs     compara eventos gravados com a anotação (precisão/recall/FP por minuto)
```

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

### Benchmark

`npm run bench` mede o que o seu modelo local realmente sustenta (geração em tok/s, prefill da imagem, tempo até a 1ª resposta, total, **inferências por minuto** e **uso de RAM/VRAM**) e recomenda o **intervalo mínimo** para o slider da UI (`totalMs × 1.5`). Opções:

```bash
npm run bench                                     # conjunto fixo em bench/imagens/ (ou o snapshot mais recente)
npm run bench -- --model qwen2.5vl:7b --iter 5    # outro modelo, mais amostras
npm run bench -- --image foto.jpg --json          # uma imagem específica + saída JSON
npm run bench -- --images-dir minhas-cenas        # diretório próprio de imagens fixas
```

O benchmark roda sobre o **conjunto fixo de imagens** em [`bench/imagens/`](./bench/imagens) (gerado por `node scripts/gerar-fixtures-bench.mjs`) para ser reproduzível sem depender dos seus snapshots; veja [`bench/README.md`](./bench/README.md) para trocar por cenas reais. Por padrão ele mede cada modelo no conjunto inteiro e reporta a **mediana entre as imagens**.

Cada execução registra o **ambiente** (CPU, núcleos, RAM, plataforma, versão do Node), o host, o modelo e as configurações (`num_predict`, iterações) junto aos números — no modo `--json` sai um objeto `ambiente` + `resultados` pronto para versionar. O `uso de RAM/VRAM` vem de `/api/ps` (memória realmente ocupada pelo modelo carregado).

O cliente **ajusta sozinho** o ritmo: cada análise espera `max(intervalo, duração da análise anterior + 500ms)`, então nunca pede mais rápido que o modelo consegue responder. O status e cada entrada de descrição mostram os **tok/s** medidos.

Medição de referência (`qwen2.5vl:3b`, CPU, snapshot 4K): ~40 tok/s de geração, prefill ~104 tok/s, 1ª resposta ~10,6s, total ~11,5s → **intervalo mínimo recomendado ≥ 18s**.

As especificações da **máquina de referência** e as metas realistas por hardware (com o procedimento para recapturá-las) ficam em [`bench/BASELINE.md`](./bench/BASELINE.md).

### Qualidade de eventos

`npm run qualidade` compara os **eventos que o app gravou** (`logs/eventos.jsonl`) com a **anotação de um clipe** e calcula **precisão**, **recall**, **proporção de mudanças perdidas** e **falsos positivos por minuto**:

```bash
npm run qualidade -- --anotacao bench/videos/sala-com-pessoa.json
npm run qualidade -- --anotacao bench/videos/sala-com-pessoa.json --json > qualidade.json
```

O formato da anotação, o fluxo de captura e as regras de casamento estão em [`bench/videos/README.md`](./bench/videos/README.md). Os vídeos ficam **locais** (não versionados); a anotação `.json` é versionada para a medição ser reproduzível em qualquer máquina que tenha o mesmo clipe. A camada de política/rastreamento, que não depende de vídeo, também é medida em `src/qualidade-eventos.test.ts`.

**Regressão:** após mudanças em prompts, modelos, rastreamento ou agendamento, rode `npm test` (unitários/integração) e `npm run test:e2e` (fluxos no navegador) — ambos são a rede de segurança principal. Para desempenho e qualidade, compare os relatórios novos com a linha de base de `bench/BASELINE.md` usando `npm run bench -- --json` e `npm run qualidade -- --json`.

### Carregamento do modelo

O Ollama carrega o modelo na memória sob demanda (o primeiro request é o lento). O Neuro Vision espera esse carregamento antes de começar:

- Ao clicar **Iniciar** com o motor **Descrição**, o servidor chama `forcarCarregamento` (probe em `/api/ps`) e **só então** o ciclo de análise começa. O status mostra "Carregando modelo... em Ns".
- O badge do Ollama informa quais modelos estão **em memória** (`/api/health` → `carregados`).
- O benchmark **só mede com o modelo já em memória** (a primeira etapa carrega e reporta o tempo da carga), para que o tok/s não seja contaminado pelo load.

## Limitações conhecidas

- **Classes não treinadas:** a detecção usa modelos COCO (YOLOS/DETR). Objetos fora dessas classes simplesmente não são vistos — não é uma falha de configuração.
- **Oclusão:** objetos parcialmente escondidos podem oscilar entre aparecer/desaparecer, gerando eventos espúrios.
- **Iluminação:** cenas escuras, estouro de luz ou contraluz reduzem confiança e aumentam mudanças perdidas.
- **Alucinações do modelo de visão:** o Ollama pode descrever coisas que não estão na cena. O texto é tratado como relato do modelo, não como verdade.
- **Identificação incerta de objetos:** o mesmo objeto pode ser rotulado de formas diferentes entre frames; o rastreamento usa IoU e movimento, não reidentificação de longo prazo.
- **Cenas estáticas:** a política evita chamar o Ollama sem mudança, mas ruído de sensor/compressão ainda pode disparar `mudanca_de_cena`.
- **WebSub/WebGPU:** sem WebGPU a detecção roda em CPU (aviso persistente na interface) e fica mais lenta.
- **`HOST` e dados sensíveis:** o servidor escuta em `127.0.0.1` por padrão; subir para `0.0.0.0` expõe a webcam e os logs. Snapshots e logs podem conter pessoas — trate-os como dados sensíveis.

## Licença

MIT.
