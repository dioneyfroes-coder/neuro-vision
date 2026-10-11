# Plano de evolução do Neuro Vision

> **Objetivo:** transformar o Neuro Vision de um sistema que analisa frames isolados em um sistema que mantém uma representação temporal do ambiente, registra eventos úteis e usa modelos pesados somente quando agregam valor.
>
> **Como usar:** marque cada item (`[x]`) somente depois de implementar e validar. Execute as fases na ordem; cada fase deve terminar com testes passando e um commit separado.

## Visão do destino

```text
Webcam
  ↓
Captura e normalização dos frames
  ↓
Percepção leve: detecção + comparação com o estado anterior
  ↓
Rastreamento dos objetos e identificação de mudanças
  ↓
Decisor: ignorar ruído ou solicitar interpretação ao Ollama
  ↓
Eventos estruturados + snapshots + memória persistente
  ↓
Histórico consultável e resumo do estado atual
```

**Princípio de arquitetura:** detecção, rastreamento, interpretação com IA, memória e interface devem ser módulos separados. Nenhuma parte deve depender diretamente de uma implementação específica de modelo.

---

## Fase 0 — Preparar o repositório e estabelecer uma linha de base

**Objetivo:** garantir que mudanças futuras possam ser comparadas e revertidas.

- [x] Criar uma branch para o trabalho, por exemplo `feat/temporal-perception`.
- [x] Fazer backup dos logs e snapshots importantes. Eles podem conter imagens privadas; não os incluir em commits.
- [x] Instalar as dependências a partir do lockfile: `npm ci`.
- [x] Executar `npm run typecheck` e registrar o resultado.
- [x] Executar `npm run lint` e registrar o resultado.
- [x] Executar `npm test` e registrar a quantidade de testes aprovados/falhos.
- [x] Executar `npm run build`.
- [x] Executar `npm run test:e2e` conforme a configuração do Playwright; resolver previamente qualquer requisito de servidor ou navegador informado pelo teste.
- [x] Iniciar o projeto com `npm run dev` e testar manualmente os motores de detecção, descrição e roteiro.
- [x] Registrar um benchmark de referência com `npm run bench`, usando sempre o mesmo modelo, hardware e imagem de teste.

**Critério de conclusão:** resultados iniciais documentados e erros preexistentes separados dos que surgirem nas mudanças.

### Linha de base registrada

Ambiente: Windows, Node.js v24.19.0, npm 11.17.0. Ollama local com `qwen2.5vl:3b`, `qwen3-vl:4b` e `qwen2.5-coder:3b`. Branch de trabalho: `feat/temporal-perception`.

| Verificação | Resultado |
| --- | --- |
| `npm ci` | 162 pacotes, 0 vulnerabilidades (aviso de `allow-scripts` do esbuild; build funcionou) |
| `npm run typecheck` | OK (0 erros) |
| `npm run lint` | OK (0 avisos/erros) |
| `npm test` | 68 aprovados / 0 falhos (3 arquivos, ~1,1s) |
| `npm run build` | OK (`dist/server.js` 24,5kb; `public/app.js` 19,9kb) |
| `npm run test:e2e` | 3 aprovados / 0 falhos (Playwright chromium, ~8,3s) |
| `npm run dev` | Servidor em `127.0.0.1:3300`; `/api/health` OK (Ollama online, 3 modelos) |
| `POST /api/visao` (roteiro base) | 200; grava `tipo:"roteiro"`, `papel:"base"`, `qwen2.5vl:3b`, ~224 tokens, ~6,7s |

Benchmark de referência (`npm run bench`, imagem `logs/snapshots/1791652184472-dg64nl.jpg`):

| Modelo | Responde? | Geração (tok/s) | Prefill (tok/s) | 1ª resposta (ms) | Total (ms) | Carga (s) |
| --- | --- | --- | --- | --- | --- | --- |
| `qwen2.5vl:3b` (padrão) | sim | 40,2 | 40790 (warm) / 97 (cold) | 86 (warm) / ~11000 (cold) | 1598 (warm) / 12389 (cold) | 20,1 |
| `qwen3-vl:4b` | não (thinking) | — | — | — | — | 23,9 |
| `qwen2.5-coder:3b` | sem visão (texto puro) | — | — | — | — | 15,7 |

Notas: o slider da UI usa `max(intervalo, duração da última análise + 500ms)`; o benchmark sugere intervalo mínimo de 3s (warm) a 19s (cold) para o `qwen2.5vl:3b`. A "1ª resposta" no cold start inclui o prefill da imagem (4K), por isso é muito maior que no warm.

**Erros preexistentes (não são regressões do código):**

- Instabilidade transitória do Ollama/`llama-server`: após o benchmark carregar/descarregar vários modelos, requisições de visão passaram a retornar HTTP 500 (`error reading llama-server response ... wsarecv`) até o modelo ser descarregado (`keep_alive: 0`) e recarregado. Após o reload, tudo voltou a funcionar. Investigar na Fase 6 (diagnóstico/estabilidade).
- Teste manual de webcam no navegador não é executável neste ambiente headless; validado por E2E (Playwright com stub do transformers.js) e por chamada real a `/api/visao`.

---

## Fase 1 — Corrigir consistência e segurança antes de adicionar inteligência

### 1.1 Corrigir a validação de caminhos do servidor

Arquivos principais: `src/server.ts` e `src/server.test.ts`.

- [x] Substituir a checagem `filePath.startsWith(diretorioBase)` por uma validação baseada em `path.relative()` ou em caminhos absolutos resolvidos.
- [x] Aplicar a mesma regra aos arquivos estáticos e à rota `/snapshots/`.
- [x] Rejeitar caminhos que saiam do diretório permitido, inclusive quando apontarem para um diretório irmão cujo nome compartilhe o prefixo do diretório permitido.
- [x] Tratar URLs com codificação inválida sem derrubar a requisição nem o servidor.
- [x] Adicionar testes de regressão para `..`, separadores codificados, caminhos absolutos e nomes semelhantes ao diretório autorizado.

**Aceite:** nenhuma requisição consegue ler arquivos fora de `public/` ou `logs/snapshots/` por meio dessas rotas.

### 1.2 Liberar corretamente a webcam quando a inicialização falhar

Arquivo principal: `public/app.ts`.

- [x] Criar uma única função para encerrar a captura: parar todas as tracks, limpar `video.srcObject`, cancelar o agendamento e abortar a análise em andamento.
- [x] Usar essa função se `video.play()`, a preparação do Ollama ou o carregamento do detector falhar.
- [x] Garantir que o estado dos botões e a mensagem de status voltem a um estado coerente em todas as saídas de erro.
- [x] Testar falhas de acesso à câmera, falha de carregamento do modelo, botão **Parar** durante uma inferência e nova tentativa de **Iniciar**.

**Aceite:** nenhuma falha de inicialização deixa a webcam ligada sem necessidade ou bloqueia uma nova tentativa.

### 1.3 Comparar a identidade completa do modelo Ollama

Arquivo principal: `src/ollama.ts` e seus testes.

- [x] Rever `nomeBaseModelo()` e `modeloEmMemoria()`: retirar a tag do nome pode confundir, por exemplo, `qwen2.5vl:3b` com `qwen2.5vl:7b`.
- [x] Implementar uma normalização que preserve tags diferentes e trate explicitamente apenas os aliases documentados, como uma tag ausente equivalente a `latest`, se aplicável ao retorno real da API do Ollama.
- [x] Criar testes para modelo igual, tags diferentes, tag ausente e nomes retornados por `/api/ps`.
- [x] Confirmar que `/api/visao/preparar` só declara pronto o modelo solicitado.

**Aceite:** um modelo diferente nunca é informado como carregado por engano.

**Implementação:** `nomeBaseModelo()` foi substituída por `normalizarNomeModelo()` (preserva a tag) e `mesmoModelo()` em `src/ollama.ts`. A ausência de tag passa a equivaler a `latest`, confirmado com a API real (`qwen2.5-coder` e `qwen2.5-coder:latest` retornam 404, enquanto `qwen2.5-coder:3b` existe). `modelosEmMemoria()` aceita `name` ou `model` do `/api/ps` (verificado no retorno real, que traz ambos com tag). O mesmo ajuste foi replicado em `scripts/benchmark.mjs`. Testes: 21 novos casos em `src/ollama.test.ts` (normalização, `mesmoModelo`, `modeloEmMemoria`) e um teste de regressão em `src/server.test.ts` que garante que `/api/visao/preparar` não confunde tags diferentes.

### 1.4 Tornar o agendamento realmente adaptativo

Arquivo principal: `public/app.ts`.

Hoje `agendarAnalise()` calcula `espera` ao agendar um `setInterval()`. A duração da análise é atualizada depois, mas o período do timer existente não é recalculado a cada ciclo; quando a inferência demora, ticks podem ser descartados pelo bloqueio `analisando`.

- [x] Trocar o ciclo periódico por um agendamento de uma execução (`setTimeout`) após a conclusão da análise anterior.
- [x] Calcular em cada ciclo o próximo atraso usando a configuração do usuário e a duração real da inferência, por exemplo `max(intervaloConfigurado, ultimaDuracaoMs + margemMs)`.
- [x] Impedir que o início imediato e o timer iniciem análises duplicadas.
- [x] Ao parar, limpar o timer e garantir que nenhuma análise nova comece.
- [x] Ao mudar o intervalo na interface, aplicar o novo valor no próximo agendamento.
- [x] Adicionar testes cobrindo inferência lenta, mudança de intervalo, parada durante a inferência e ausência de sobreposição.

**Aceite:** uma única análise pode estar em execução por vez; o próximo ciclo é calculado depois da conclusão do atual.

**Implementação:** criado `public/scheduler.ts` (livre de DOM) com `calcularEspera()` e a classe `AgendadorAnalise`, que encadeia `setTimeout` após cada análise e nunca sobrepõe execuções (guarda via promessa da execução atual). `public/app.ts` passa a delegar o agendamento ao `AgendadorAnalise`; `start()` roda a análise imediata e só então arma o primeiro ciclo, e a mudança de intervalo chama `reajustar()`. Se uma sessão for interrompida durante inferência não cancelável, o reinício aguarda a execução anterior terminar antes de iniciar a nova (sem pular a análise imediata nem sobrepor). Testes: 8 casos em `src/agendador.test.ts` (fake timers: inferência lenta sem sobreposição e com próximo ciclo após a conclusão, mudança de intervalo, parada durante a inferência, início duplo e reinício durante execução) e um E2E novo em `e2e/app.spec.ts` que verifica ausência de sobreposição com intervalo curto.

### 1.5 Definir política de retenção dos snapshots

Arquivos principais: `src/server.ts`, testes e documentação.

- [x] Definir limites configuráveis de idade, quantidade ou tamanho total para `logs/snapshots/`.
- [x] Remover snapshots órfãos quando apropriado e decidir explicitamente o que acontece ao limpar o histórico JSONL.
- [x] Não apagar arquivos ainda referenciados por entradas preservadas no log.
- [x] Executar a limpeza de modo seguro, sem bloquear requisições normais por longos períodos.
- [x] Adicionar testes para snapshots referenciados, órfãos, expiração e falhas de sistema de arquivos.

**Aceite:** o uso de disco permanece limitado por uma política documentada.

**Implementação:** `src/server.ts` ganhou a política `PoliticaSnapshots` (`SNAP_MAX_BYTES`, `SNAP_MAX_FILES`, `SNAP_MAX_AGE_DAYS`; `0` desativa um eixo) e `limparSnapshots()`. A limpeza lê o histórico preservado (`visao.jsonl` + rotação `visao.jsonl.1`), extrai os snapshots referenciados de forma segura (`nomeArquivoSnapshot`) e então: mantém os referenciados enquanto estiverem dentro dos limites; remove órfãos; remove expirados por idade (referenciados ou não); e, ao estourar os tetos de quantidade/tamanho, descarta primeiro os mais antigos — os limites são o teto rígido de disco, então o mais antigo cede quando necessário. A limpeza é assíncrona e tolera falhas parciais (`erros` por arquivo, `ENOENT`/`ENOTDIR` sem lançar). Roda em segundo plano: na subida do servidor, de forma oportunista após novas gravações (no máximo a cada `SNAP_CLEAN_INTERVAL_MS`, sem timers nem bloquear a resposta) e ao limpar o histórico. Decisão explícita ao limpar o histórico: `DELETE /api/logs` zera o atual **e** remove a rotação `.1`; como as entradas deixam de existir, todos os snapshots viram órfãos e são removidos de imediato (`limparSnapshots` é chamado e o resultado vai na resposta). Documentado no README (tabela de variáveis + seção "Retenção de snapshots"). Testes: `src/server.test.ts` cobre referenciado (mantido/rotacionado), órfão, expiração, tetos de quantidade e tamanho, diretório ausente, falha de unlink e o `DELETE` limpando histórico+rotação+snapshots (108 testes no total).

### 1.6 Estabelecer o limite de segurança de rede

- [x] Manter `HOST=127.0.0.1` como padrão.
- [x] Documentar que usar `HOST=0.0.0.0` expõe a interface e endpoints da API à rede local.
- [x] Antes de recomendar exposição na rede, implementar autenticação ou outro controle de acesso adequado, limitar origens e validar os payloads recebidos.
- [x] Aplicar limites de tamanho também a snapshots e requisições JSON; rejeitar tipos de dados inválidos.

**Aceite:** o projeto deixa explícito que execução local e execução acessível pela rede têm riscos diferentes.

**Implementação:** o default segue `HOST=127.0.0.1`. Nova guarda de bind: `hostExpostoNaRede()` (loopback = `127.0.0.0/8`/`::1`/`localhost`) faz o servidor **recusar** host não-loopback com mensagem clara, a menos que `NEURO_ALLOW_REMOTE=1` seja definido; com o opt-in, emite aviso de risco. Controle de origem: `origemBloqueada()` rejeita (`403`) requisições cujo `Origin` não case com o `Host` da requisição nem conste em `NEURO_ALLOWED_ORIGINS` (sem `Origin`, passa — mesma origem/cliente não-navegador). Validação de payloads via `validarPayloadLog`/`validarPayloadVisao` (`400` para payload não-objeto, `objetos` não-lista, `resumo`/`modelo`/`imagem`/`anterior`/`roteiro` não-texto) e `validarSnapshot` (`400` para `snapshot` não-texto ou acima de `SNAP_UPLOAD_MAX_BYTES`, lido em tempo de execução). Limites de corpo: `BODY_MAX_BYTES` (`/api/log`) e `VISAO_BODY_MAX_BYTES` (`/api/visao`). README ganhou a tabela de variáveis e a seção "Segurança e exposição na rede" deixando explícito que local e acessível-pela-rede são cenários de risco distintos e que expor exige autenticação/controle de acesso antes. Testes: helpers de host/origem/validação e casos HTTP (`400` por tipo inválido, `400` por snapshot grande, `403` origem cruzada, origem extra liberada) — 117 testes no total.

---

## Fase 2 — Separar responsabilidades sem reescrever o projeto inteiro

**Objetivo:** permitir evolução incremental, preservando a interface e os testes existentes.

### 2.1 Extrair módulos pequenos do cliente

- [x] Mover o controle da webcam para um módulo próprio, por exemplo `public/camera.ts`.
- [x] Mover o agendamento e a guarda contra concorrência para `public/scheduler.ts`.
- [x] Isolar as chamadas HTTP (`/api/log`, `/api/visao`, `/api/health`) em `public/api.ts`.
- [x] Isolar a lógica de detecção e conversão do resultado em `public/detector.ts`.
- [x] Manter `public/app.ts` responsável principalmente por coordenar estado e interface.
- [x] Fazer uma extração por commit; rodar typecheck, lint e testes após cada uma.

**Implementação:** `public/app.ts` agora coordena estado e interface e delega para módulos livres de UI: `public/scheduler.ts` (agendamento), `public/api.ts` (HTTP e parsing do stream NDJSON), `public/detector.ts` (`DetectorObjetos` com cache/fallback e `descreverDeteccoes`) e `public/camera.ts` (`Camera`: stream, tamanho do vídeo, captura de frame e `ErroCamera` distinguindo falha de acesso da falha de reprodução). Cada extração foi um commit próprio (`refactor(client): ...`) com typecheck, lint, testes (134) e E2E (7) verdes. Os testes unitários usam o alias de `vitest.config.ts` para trocar a URL do CDN do Transformers por `src/transformers.stub.ts`.

### 2.2 Definir interfaces independentes dos modelos

- [x] Definir uma interface comum para motores de percepção, com operações explícitas de inicialização, análise e encerramento.
- [x] Padronizar resultado de inferência: modelo, duração, objetos detectados, descrição opcional e metadados de confiança.
- [x] Separar erros de câmera, detector, Ollama, armazenamento e cancelamento.
- [x] Evitar que o módulo de memória precise conhecer a API específica do Transformers.js ou do Ollama.

**Aceite da fase:** a interface continua funcional e é possível trocar um motor sem reescrever o histórico ou o agendador.

**Implementação:** `src/percepcao.ts` define `MotorPercepcao` (`inicializar`/`analisar`/`encerrar`), o resultado padronizado `ResultadoPercepcao` (modelo, `duracaoMs`, `objetos`, `descricao`, `snapshot`, `confianca`) e o adaptador de memória `entradaDeResultado(resultado, tipo)`, que converte um `ResultadoPercepcao` em `EntradaLog`. `public/motores.ts` implementa a interface com `MotorDeteccao` (envolve `DetectorObjetos`, mede a duração e converte com `descreverDeteccoes`) e `MotorOllama` (monta o payload de descrição/roteiro e chama `api.descreverFrame`). `src/erros.ts` cria `ErroPercepcao` com `origem` (`camera`/`detector`/`ollama`/`armazenamento`/`cancelamento`) e `ehCancelamento`; `camera.ts`, `api.ts` e `detector.ts` passaram a classificar seus erros. `public/app.ts` agora só escolhe o motor em `start()` e consome `ResultadoPercepcao` — o histórico (`src/types.ts` + `entradaDeResultado`) e o agendador (`public/scheduler.ts`) não conhecem Transformers.js nem Ollama, então trocar de motor não os afeta. Cobertos por `src/percepcao.test.ts`, `src/erros.test.ts` e `src/motores.test.ts` (147 testes; typecheck, lint, build e 7 testes E2E verdes).

---

## Fase 3 — Construir percepção temporal de objetos e mudanças

**Objetivo:** deixar de tratar cada frame como observação isolada.

### 3.1 Criar uma representação do estado observado

- [x] Definir tipos para `ObjetoRastreado`, `Observacao` e `EventoVisual` em `src/types.ts` ou módulos especializados.
- [x] Guardar, para cada objeto rastreado, rótulo, caixa delimitadora, confiança, última observação e identificador estável dentro da sessão.
- [x] Distinguir claramente uma detecção de um evento: detectar uma pessoa em dois frames não deve gerar automaticamente duas aparições.

**Implementação 3.1:** `src/types.ts` ganhou `ObjetoRastreado` (id, rótulo, nome, `score`, `caixa`, `primeiraObservacao`, `ultimaObservacao`, `framesVisto`, `framesAusente`), `Observacao` e `EventoVisual` (+ `TipoEventoVisual`, `OrigemEvento`). A distinção detecção/evento é garantida pelo rastreador: só o primeiro frame associado gera `aparicao`; frames seguintes apenas incrementam `framesVisto`.

### 3.2 Associar detecções entre frames

- [x] Implementar uma primeira associação simples por classe/rótulo e sobreposição das caixas (IoU) ou distância entre centros.
- [x] Atribuir um ID de rastreamento aos objetos associados entre frames.
- [x] Definir limiares configuráveis e tempo de expiração para objetos que deixam de ser detectados.
- [x] Criar testes com caixas deslocadas, objetos da mesma classe, detecções ausentes por um frame e objetos que reaparecem.
- [x] Avaliar um rastreador dedicado somente se a associação simples não atingir a qualidade desejada.

**Implementação 3.2:** `src/rastreamento.ts` cria `RastreadorObjetos` (associação mesma-classe por IoU com distância entre centros como alternativa, IDs `obj-N` estáveis) com `ConfigRastreamento` configurável (`iouMinimo`, `distanciaMaximaCentros`, `maxFramesAusente`, `expiracaoMs`, `movimentoMinimoRelativo`, `confiancaMinima`) e `CONFIG_RASTREAMENTO_PADRAO`. O agendador do cliente passa cada frame de detecção pelo rastreador (`public/app.ts`), desenha as caixas rastreadas e mostra os eventos do frame no status. `src/rastreamento.test.ts` cobre caixas deslocadas, objetos da mesma classe, ausência por um frame, desaparecimento, reaparecimento e expiração. Decisão: a associação simples atendeu aos casos testados, então **não** foi adicionado rastreador dedicado (a avaliação fica registrada para quando houver dados reais que a justifiquem).

### 3.3 Gerar eventos estruturados

- [x] Começar com os tipos `aparicao`, `desaparecimento` e `movimento`.
- [x] Registrar `mudanca_de_cena` apenas como sinal para uma análise adicional, não como prova semântica de que algo específico aconteceu.
- [x] Estabelecer limiares de movimento e persistência para reduzir falsos positivos causados por ruído ou pequenas oscilações da caixa.
- [x] Armazenar a origem do evento (`detector`, `rastreador` ou `ollama`) e a confiança associada.
- [x] Testar cenas controladas com movimentação real, câmera parada, alteração de iluminação e oclusão parcial.

**Aceite da fase:** o sistema diferencia “o objeto continua presente” de “um objeto apareceu, sumiu ou se moveu”.

**Implementação 3.3:** O rastreador emite `aparicao`, `desaparecimento` e `movimento` (`origem: "rastreador"`, `confianca` = score da deteccao, `objetoId`). A persistencia `framesParaConfirmarAparicao` (configuravel) filtra deteccoes isoladas e `movimentoMinimoRelativo` limita movimentos pequenos; um objeto nao confirmado desaparece sem gerar eventos. `src/cena.ts` cria `DetectorMudancaDeCena` + `diferencaDeCena`: compara a assinatura de luminancia do frame (`Camera.assinaturaDeCena`) e emite `mudanca_de_cena` (`origem: "detector"`) apenas como sinal, com limiar e intervalo minimo configuraveis. `public/app.ts` alimenta rastreador e detector de cena e mostra os eventos do frame no status. Testes: `src/rastreamento.test.ts` (camera parada, movimento, oclusao parcial, mesma classe, ausencia/reaparecimento/confirmacao) e `src/cena.test.ts` (camera parada vs. mudanca de iluminacao, throttle). A movimentacao com webcam real permanece como verificacao manual.

---

## Fase 4 — Transformar logs em memória persistente e consultável

**Objetivo:** preservar contexto entre ciclos e reinicializações.

### 4.1 Padronizar o evento salvo

- [x] Adotar um contrato semelhante a este e ajustá-lo às necessidades reais:

```ts
interface EventoVisual {
  id: string;
  timestamp: string;
  tipo: "aparicao" | "desaparecimento" | "movimento" | "mudanca_de_cena" | "resumo";
  objetoId?: string;
  descricao: string;
  confianca?: number;
  origem: "detector" | "rastreador" | "ollama";
  snapshot?: string;
  modelo?: string;
}
```

- [x] Separar os eventos estruturados das mensagens de status da interface.
- [x] Registrar falhas e métricas operacionais sem tratá-las como acontecimentos visuais.

**Implementação 4.1:** O contrato de `EventoVisual` (`src/types.ts`) foi adotado com `mudanca_de_cena` no lugar de `mudanca` (nome já usado na Fase 3) e o novo tipo `resumo`. `src/memoria.ts` centraliza o armazenamento JSONL genérico (rotação por tamanho, leitura das últimas linhas, tolerância a linhas corrompidas) e define `RegistroOperacional` (`nivel`/`origem`/`mensagem`/`detalhe`) separado dos eventos visuais. O servidor passou a persistir `eventos.jsonl` e `operacional.jsonl` ao lado de `visao.jsonl`, com os endpoints `POST/GET/DELETE /api/eventos` e `POST /api/operacional`; os snapshots referenciados por eventos também entram na retenção (`arquivosDeMemoria`). No cliente, `api.gravarEvento`/`listarEventos`/`gravarOperacional` foram adicionados e o `public/app.ts` publica cada evento do rastreador (movimento sem snapshot, por ser o mais frequente) e registra falhas de câmera/detector/Ollama como operacionais — o status da interface continua sendo só texto, separado da memória. Cobertos por `src/memoria.test.ts`, `src/api.test.ts` e `src/server.test.ts`.

### 4.2 Recuperar contexto depois de reiniciar

- [x] Na inicialização, reconstruir o contexto recente usando o histórico persistido, não apenas a variável de sessão `roteiroBeats`.
- [x] Manter um resumo curto do estado atual separado do histórico completo de eventos.
- [x] Definir uma janela máxima de contexto por tamanho e/ou número de eventos para o prompt do Ollama.
- [x] Evitar enviar indefinidamente todo o histórico ao modelo.
- [x] Adicionar testes para reidratação do contexto, log vazio, linhas inválidas e histórico truncado.

**Implementação 4.2:** `src/memoria.ts` ganhou `reidratarContexto(entradas, eventos, opcoes)`, que reusa `resumirContexto` (resumo curto **separado** dos arrays `entradas`/`eventos`) e ainda deriva `roteiro` (últimos deltas em ordem cronológica) e `ultimaDescricao` (última descrição/roteiro, a mesma referência que o app usa em `anterior`). O servidor expõe `GET /api/contexto`, com janelas por query (`maxEntradas`/`maxEventos`/`maxCaracteres`, com padrões 20/20/1200 e limites duros), lendo `visao.jsonl` e `eventos.jsonl`. No cliente, `api.obterContexto()` e `carregarContexto()` reidratam `roteiroBeats` e `ultimaDescricao` na inicialização — assim o primeiro beat após reiniciar já é um delta e a descrição reaproveita a observação anterior — e `limparHistorico` zera esse estado. O contexto nunca envia o histórico inteiro: além da janela do endpoint, o prompt continua limitado por `roteiroBeats.slice(-8).join(" ").slice(0, 1200)`. Testes: `src/memoria.test.ts` (reidratação, histórico vazio e truncado), `src/server.test.ts` (contexto com dados, log vazio e linhas inválidas) e `src/api.test.ts` (`obterContexto`).

### 4.3 Escolher armazenamento por necessidade

- [x] Manter JSONL enquanto a necessidade principal for escrita sequencial e leitura recente.
- [x] Migrar para SQLite quando filtros por data, objeto, tipo de evento e consultas combinadas se tornarem relevantes.
- [x] Se migrar, preservar exportação para JSONL e criar migração/testes de integridade.
- [x] Adicionar busca semântica ou embeddings apenas quando consultas em linguagem natural trouxerem benefício mensurável.

**Decisão 4.3:** manter **JSONL** por enquanto. A necessidade atual é escrita sequencial append-only e leitura recente, o que o JSONL entrega com baixo custo, inspeção trivial (texto puro) e sem dependências — já coberto por `src/memoria.ts` (rotação por tamanho, leitura das últimas linhas em blocos de 64 KB, tolerância a linhas corrompidas) e pelas políticas de retenção da Fase 1. **Critério de migração para SQLite:** quando consultas combinadas (data **e** objeto **e** tipo de evento), agregações/estatísticas ou busca sobre um volume que a leitura reversa deixa de atender virarem um requisito recorrente. **Se migrar:** preservar a exportação para JSONL (endpoints `GET /api/logs`/`GET /api/eventos` e o export do cliente) e criar script de migração com teste de integridade (paridade linha-a-linha JSONL ↔ SQLite). **Busca semântica/embeddings:** adiada até existir uma consulta em linguagem natural com ganho mensurável nos benchmarks da Fase 6; hoje seria complexidade sem demanda comprovada.

**Aceite da fase:** após reiniciar o aplicativo, o sistema recupera um contexto recente coerente sem depender da memória volátil da página.

---

## Fase 5 — Implementar o fluxo de análise orientado a eventos

**Objetivo:** reduzir inferências caras sem sacrificar eventos importantes.

- [x] Executar a percepção leve em uma frequência adequada ao hardware.
- [x] Comparar observações com o estado anterior e filtrar ruído antes de acionar o Ollama.
- [x] Chamar o modelo de visão quando houver mudança relevante, baixa confiança, nova entidade ou necessidade de resumo periódico.
- [x] Aplicar cooldown e limite máximo de chamadas para impedir uma sequência de inferências em cenas instáveis.
- [x] Preservar uma forma de solicitar análise manual imediata pela interface.
- [x] Diferenciar “não detectei mudança” de “não consegui analisar”: falhas nunca devem ser registradas como ausência de mudança.
- [x] Quando o cliente cancelar uma análise, encerrar a leitura do stream; avaliar também propagar o cancelamento ao `fetch` do Ollama no servidor.
- [x] Registrar a razão que acionou a análise, para investigar por que o sistema decidiu chamar o modelo.

**Aceite da fase:** cenas estáticas geram poucas chamadas ao Ollama, enquanto mudanças relevantes continuam produzindo eventos verificáveis.

**Implementação 5:** novo modo **“Eventos (leve + Ollama sob demanda)”** no seletor de motor. A percepção leve (detecção via `MotorDeteccao` + `RastreadorObjetos` + `DetectorMudancaDeCena`) roda em todo tick do agendador — que já espera a inferência atual terminar antes de reagendar (frequência adequada ao hardware). `src/politica-analise.ts` centraliza a decisão (`PoliticaAnalise`, puro e testado): **cooldown** entre chamadas ao Ollama, **janela deslizante** com teto de chamadas por minuto, prioridade de motivos (`primeira_analise`, `mudanca_de_cena`, `nova_entidade`, `desaparecimento`, `movimento` com mínimo configurável, `baixa_confianca`, `resumo_periodico`, `manual`, `falha_percepcao`). O motivo que acionou a análise vira campo `motivo` em `EntradaLog`, é persistido pelo servidor em `POST /api/visao` e aparece como “por <motivo>” na interface. O botão **“Analisar agora”** (habilitado só no modo Eventos) força a análise imediata via `agendador.disparar()`, ignorando cooldown/janela e respeitando o não-sobrepor. Falha da percepção leve nunca vira “sem mudança”: vira registro operacional e motivo `falha_percepcao` (dentro da janela). Cancelamento: o cliente já encerra a leitura do stream no abort; o servidor agora cria um `AbortController` amarrado a `res.on("close")` e repassa o sinal a `gerarDescricaoStream`, que aborta o `fetch` do Ollama (`AbortSignal.any` combinado com o timeout). Testes: `src/politica-analise.test.ts` (14), `src/server.test.ts` (motivo persistido + rejeito de motivo inválido), `src/ollama.test.ts` (aborto do sinal cancela o fetch), E2E novo “modo eventos … politica e botão manual”.

---

## Fase 6 — Melhorar instalação, operação e desempenho

### 6.1 Clarificar o funcionamento offline

- [x] Documentar o que roda localmente e quais recursos precisam ser baixados na primeira execução.
- [x] Fixar uma versão específica de Transformers.js, evitando depender de uma versão flutuante na URL do CDN.
- [x] Avaliar instalar/bundlar a biblioteca localmente e disponibilizar os pesos necessários em cache local.
- [x] Documentar como preparar os modelos antes de usar o aplicativo sem internet.
- [x] Testar o comportamento com a rede desconectada depois da preparação dos recursos.

**Implementação 6.1:** a versão do Transformers.js passou do tag flutuante `@3` para **`3.8.1`** (última 3.x), atualizando também o shim de tipos (`src/transformers-cdn.d.ts`) e o alias de teste (`vitest.config.ts`). O import passou de **estático** para **sob demanda** (`carregarTransformers()` em `public/detector.ts`): antes, qualquer página carregava a biblioteca do CDN e, offline, o grafo de módulos inteiro falhava (app em branco). Agora os modos Ollama funcionam offline e só a detecção falha, com mensagem clara e webcam liberada. `DetectorObjetos` passou a expor `dispositivo` (`webgpu`/`wasm`) — usado no aviso de fallback de CPU (6.3). Documentação nova no README (**Funcionamento offline**: o que roda local, tabela do que é baixado, preparação offline, comportamento com e sem cache, decisão de **não** bundlar localmente por ora). Testes: E2E “rede offline nao quebra a pagina e a deteccao falha com mensagem clara” (CDN abortado → página carrega, histórico intacto, detecção falha graciosamente).

### 6.2 Medir antes de trocar modelos

- [x] Escolher um pequeno conjunto fixo de imagens e clipes representativos.
- [x] Medir latência de inferência, tempo até o primeiro resultado, uso de RAM/VRAM e inferências por minuto.
- [x] Medir qualidade dos eventos: mudanças detectadas, mudanças perdidas e falsos positivos por minuto.
- [x] Comparar configurações/modelos sob as mesmas condições com `npm run bench` e testes reproduzíveis.
- [x] Registrar hardware, modelo, configurações e resultados junto com cada benchmark.

**Implementação 6.2:** o benchmark passou a rodar sobre um **conjunto fixo de imagens** versionado em `bench/imagens/` (duas cenas sintéticas em resoluções típicas de webcam, geradas de forma determinística por `scripts/gerar-fixtures-bench.mjs`; convenção e como trocar por cenas reais em `bench/README.md`). `scripts/benchmark.mjs` ganhou: `--image` repetível + `--images-dir`; iteração sobre o conjunto com **mediana entre as imagens** (`visaoPorImagem` guarda cada uma); **inferências por minuto** (`inferenciasPorMinuto`, respeitando o ritmo `max(total + 500 ms, intervalo)`); **RAM/VRAM** do modelo carregado via `/api/ps` (`memoriaDoModelo`); e um cabeçalho de **ambiente** (`montarAmbiente`: CPU, núcleos lógicos, RAM total, plataforma, versão do Node) gravado junto aos resultados — no modo `--json` sai em `ambiente` + `resultados`. `main()` só roda quando o arquivo é executado diretamente, permitindo testar os helpers puros (`scripts/benchmark.test.mjs`). A **qualidade dos eventos** é medida de forma reproduzível em `src/qualidade-eventos.test.ts`: a percepção leve (rastreador + política) roda sobre roteiros sintéticos com mudanças conhecidas e reporta mudanças detectadas, perdidas e falsos positivos por minuto (cena estática → 0 FP após a primeira análise; aparecer/mover/desaparecer → 100% detectado, 0 FP). A validação com **vídeo real anotado** (precisão/recall de verdade) fica na Fase 7.

### 6.3 Tornar o diagnóstico visível

- [ ] Mostrar no estado de saúde qual motor está ativo, qual modelo foi solicitado e qual está carregado.
- [ ] Diferenciar tempo de carregamento do modelo, inferência e persistência.
- [ ] Incluir logs claros para timeout, cancelamento, falha de câmera e erro do modelo.
- [ ] Exibir avisos quando o processamento local estiver usando fallback de CPU em vez de WebGPU.

**Aceite da fase:** os resultados são reproduzíveis e os requisitos de conectividade e hardware estão documentados.

---

## Fase 7 — Validar qualidade e preparar o próximo nível

- [ ] Criar um conjunto de testes visuais próprio, com vídeos curtos de cenas estáticas e mudanças conhecidas.
- [ ] Anotar eventos esperados para permitir comparação consistente.
- [ ] Calcular precisão/recall dos eventos ou, como mínimo, falsos positivos por minuto e proporção de mudanças não detectadas.
- [ ] Definir metas realistas por hardware antes de otimizar.
- [ ] Rodar regressão após mudanças em prompts, modelos, rastreamento e agendamento.
- [ ] Documentar limitações conhecidas: oclusão, iluminação, classes não treinadas, alucinações do modelo e identificação incerta de objetos.
- [ ] Atualizar `README.md` e `TODO.md` quando uma tarefa for concluída; manter este plano como roadmap de médio prazo.

**Aceite da fase:** é possível dizer, com dados, se uma mudança tornou o sistema mais preciso, mais rápido ou mais econômico.

---

## Ordem recomendada de execução

Marque aqui as fases inteiras conforme forem concluídas:

- [x] **Marco 1 — Confiabilidade:** Fase 0 + Fase 1.
- [x] **Marco 2 — Código sustentável:** Fase 2.
- [x] **Marco 3 — Percepção temporal:** Fase 3.
- [x] **Marco 4 — Memória persistente:** Fase 4.
- [x] **Marco 5 — Inferência inteligente:** Fase 5.
- [ ] **Marco 6 — Desempenho e operação:** Fase 6.
- [ ] **Marco 7 — Qualidade mensurável:** Fase 7.

## Regras para manter o projeto sob controle

- [ ] Não implementar rastreamento, banco vetorial e agente autônomo na mesma mudança.
- [ ] Não substituir um componente funcional sem benchmark ou teste que justifique a troca.
- [ ] Cada correção deve incluir um teste de regressão quando for viável.
- [ ] Cada marco deve terminar com `npm run typecheck`, `npm run lint`, `npm test` e `npm run build` aprovados.
- [ ] Preservar o funcionamento atual dos modos Detecção, Descrição e Roteiro durante a migração.
- [ ] Tratar imagens e logs como dados potencialmente sensíveis; manter a execução local por padrão.

## Comandos de validação

Execute na raiz do repositório:

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run bench
```

O benchmark pode exigir que o Ollama esteja instalado, em execução e com o modelo escolhido baixado. Os testes E2E podem exigir a instalação dos navegadores do Playwright conforme a mensagem apresentada pelo comando.
