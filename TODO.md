# TODO — Neuro Vision

Lista de melhorias e pendências. `[ ]` = aberto, `[x]` = concluído.

---

## 🟠 Nova rodada — modo Roteiro + repetição

**Objetivo:** corrigir o novo bug de descrição repetida/"fundida" no motor Descrição e adicionar um **modo Roteiro** (padrão): 1 análise profunda da cena (base) e, nas capturas seguintes, registrar **só o que mudou**, formando um roteiro cronológico.

- [x] `src/texto.ts`: `separarFrases`, `colapsarRepeticoes` (dedupe + colapso de sufixo periódico via KMP), `normalizarTexto`, `ehSemMudanca`, `cortarFraseIncompleta`.
- [x] `src/ollama.ts`: `ModoAnalise = "descricao" | "roteiro"`; `PROMPT_ROTEIRO_BASE`/`PROMPT_ROTEIRO_DELTA` + `montarPromptRoteiro`; `NUM_PREDICT_BASE=320`/`NUM_PREDICT_DELTA=160`; `repeat_penalty`/`repeat_last_n`/`top_p` no `montarCorpo`.
- [x] `src/server.ts`: `streamVisao`/`handleVisao` aceitam `modo`/`roteiro`/`base`; colapsa e corta frase incompleta; grava `tipo:"roteiro"` + `papel:"base"|"delta"`; **não grava** delta quando `semMudanca` (sentinela `INALTERADO`); evento `done` com `tipo`/`papel`/`semMudanca`.
- [x] `src/types.ts`: `TipoEntrada` inclui `"roteiro"`; `EntradaLog.papel`.
- [x] Cliente (`public/index.html`/`app.ts`): motor **Roteiro (Ollama)** como padrão; estado do roteiro; envio de `modo`/`roteiro`/`base`; respeita `semMudanca` (mostra "Sem mudancas neste intervalo" e não adiciona entrada); badge `roteiro base`/`roteiro +`.
- [x] Testes: `texto.test.ts` (colapsar, sem-mudança, cortar-frase), `ollama.test.ts` (prompt roteiro, num_predict), `server.test.ts` (base+delta+sem-mudança, não grava quando sem mudança). 68 testes passando; typecheck/lint/build ok.
- [x] Validado end-to-end com `qwen2.5vl:3b`: base grava análise completa (termina em frase completa), delta produz 1 frase curta sem repetição.
- [x] Docs (`README.md`/`TODO.md`) atualizadas.

## 🔴 Bug anterior (resolvido) — alta prioridade

**Sintoma:** nenhum log de descrição (motor Ollama) aparece. As detecções saem, mas os logs `descricao` nunca surgem e o status mostra erro.

**Diagnóstico final (raiz):**

1. **`think: false` dentro de `options` era ignorado pelo Ollama.** `src/ollama.ts` enviava `options: { think: false }`. O Ollama ignora silenciosamente `think` dentro de `options`; num modelo thinking (qwen3-vl) os tokens de raciocínio consomem todo o `num_predict` e o campo `response` sai **vazio** → o stream não rende nenhum chunk → `servidor` lança "stream vazio" → 500 → **nenhuma entrada é gravada**.
2. **Evento `{"error": ...}` no stream era ignorado.** Quando o Ollama falha no meio do NDJSON (HTTP 200), o parser descartava a linha e terminava o gerador sem `yield` → mesmo sintoma de stream vazio e log vazio.
3. **Fila/latência como sintoma agravante** (já endereçado antes): sem guarda de concorrência e sem cancelamento o intervalo menor que a inferência acumulava atraso.

**Correções aplicadas (esta rodada):**

- [x] `think: false` movido para o **nível topo** do body do `/api/chat` (o único lugar que o Ollama obedece em modelos thinking; no `/api/generate` o `think` é silenciosamente ignorado).
- [x] Cliente Ollama migrado para `/api/chat` (`message.content`), pois o `/api/generate` com `think:false` é ignorado em modelos Qwen thinking.
- [x] Detecção de **"always-thinking"**: quando o modelo deriva/raciocina sem produzir `content` (caso real do `qwen3-vl:4b`, que o Ollama não consegue colocar em modo não-pensante), a API devolve 502 com orientação acionável (sugere `ollama pull qwen2.5vl:3b`). Nada é gravado em silêncio.
- [x] `gerarDescricaoStream` e `gerarDescricao` lançam erro ao receber `{"error": ...}` → API retorna 502.
- [x] Agendamento **adaptativo**: `agendarAnalise` aguarda `max(intervalo, duração_última + 500ms)`.
- [x] Entradas de log com `ms`/`tokens`; UI mostra **tok/s**.
- [x] Benchmark `npm run bench` espera o modelo em memória antes de medir e **detecta/avisa** quando o modelo não produz resposta (thinking ativo) ou não suporta visão (texto puro).
- [x] Modelo padrão trocado para `qwen2.5vl:3b` (não-pensante; `qwen2.5vl:4b` não existe no registry — tags: 3b/7b/32b/72b). Validado end-to-end: `POST /api/visao` retorna 200 e grava `descricao` com `ms`/`tokens`.
- [x] Erro do Ollama padronizado numa classe `ErroOllama` → sempre mapeado para 502 (sem prefixo "Ollama:" duplicado).

## Carga do modelo em memória

- [x] `forcarCarregamento`/`modelosEmMemoria` no cliente Ollama (probe em `/api/ps`).
- [x] `GET /api/visao/preparar` carrega o modelo e só responde quando pronto; o cliente só inicia o motor Descrição após esse passo.
- [x] `/api/health` retorna `carregados` (modelos em memória) e o badge da UI exibe.
- [x] Benchmark espera o modelo estar em memória antes de medir (reporta o tempo da carga) — tok/s não contaminado pelo load.

## Benchmark / expectativa

- [x] Script `scripts/benchmark.mjs` (gera tabela resumo e `--json`).
- [x] Ajuste automático do intervalo no cliente baseado na duração real das análises.

---

## Correções e robustez

- [x] `public/app.ts:83` — teste de WebGPU (`"gpu" in navigator`) não é confiável; checar `navigator.gpu` + `requestAdapter()`.
- [x] `src/server.ts` — `listen(PORT)` escuta em `0.0.0.0`. Bind em `127.0.0.1` por padrão (configurável via `HOST`).
- [x] `src/server.ts:77` — `lerLogEntries` lia e fazia parse do arquivo inteiro; agora lê do fim em blocos de 64KB.
- [x] Validar `score` e `caixa` em `normalizarObjetos` (agora preenche `rotulo`, `score` e `caixa` seguros).
- [x] Rotação/tamanho máximo do log (`LOG_MAX_BYTES`, backup `.1`).

## Performance

- [x] Reutilizar um único `<canvas>` de captura em vez de criar um por frame (`capturarFrame`).
- [x] Reduzir o frame antes de enviar ao Ollama (512px de largura).
- [x] `stream:true` no Ollama para exibir a descrição progressivamente (endpoint NDJSON).
- [x] Cache de modelo de detecção por id (não recarrega ao alternar).

## Produto / UX

- [x] Salvar *snapshot* (thumbnail JPEG) por entrada de detecção/descrição para uma linha do tempo visual.
- [x] Endpoint `/api/health` verificando o Ollama (acessível? qual modelo carregado?).
- [x] Indicador visual de "analisando…" sobre o vídeo (spinner) e descrição em tempo real.
- [x] Filtro/busca no histórico e opção de exportar o log.
- [x] Ampliar o dicionário `COCO_PT`.

## Qualidade / testes

- [x] Testes E2E do cliente (Playwright): histórico, filtro e status do Ollama (`e2e/app.spec.ts`).
- [x] Testes para os endpoints de log/snapshot/health (servidor e cliente).
- [x] Log estruturado no servidor (`logEvent`, JSON com `ts`/`nivel`/`evento`).
- [x] Pipeline de CI (typecheck + lint + test + build + E2E).
