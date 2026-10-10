# TODO — Neuro Vision

Lista de melhorias e pendências. `[ ]` = aberto, `[x]` = concluído.

---

## 🔴 Bug atual (reportado) — alta prioridade

**Sintoma:** nenhum log aparece enquanto se usa o motor **Descrição (Ollama qwen3-vl)** e/ou **Detecção (YOLOS tiny)**. As entradas demoram muito para surgir e **continuam surgindo mesmo depois de clicar em Parar**.

**Causas prováveis (diagnóstico):**

1. **Sem guarda de concorrência.** `agendarAnalise()` (`public/app.ts:268`) usa `setInterval` sem checar se a análise anterior terminou. O Ollama pode levar dezenas de segundos, então as chamadas se acumulam a cada `interval` (padrão 4s) e cada uma vira um log quando (e se) completar.
2. **Sem cancelamento ao parar.** `stop()` (`public/app.ts`) não aborta requisições em voo; `descreverViaOllama()` faz `fetch` sem `AbortController`. Resultado: ao clicar em Parar, os pedidos pendentes seguem e "soltam logs" depois.
3. **Log só aparece no fim da resposta.** No motor Ollama, `addLogEntry()` só é chamado depois que `/api/visao` responde (`public/app.ts:190-203`). No servidor, o log também só é gravado ao final de `gerarDescricao()` (`handleVisao`, `src/server.ts`). Enquanto processa, a UI fica vazia.
4. **Fila acumulada = atraso crescente.** Com intervalo menor que o tempo de inferência, a latência percebida só aumenta, dando a sensação de que "nada sai" e depois "sai tudo de uma vez".
5. **Timeout longo sem feedback.** `timeoutMs` padrão 90s (`src/ollama.ts:56`); ao estourar, retorna erro e **não** grava log.

**Correções propostas:**

- [x] Adicionar flag `analisando` em `analisar()` e ignorar tick se já houver análise em andamento.
- [x] Usar `AbortController`: abortar requisições em `stop()` e ao trocar de motor; passar `signal` aos `fetch` (`/api/visao` e inferência).
- [x] Feedback imediato na UI: mostrar "analisando…" enquanto processa.
- [x] Avaliar log otimista/`stream:true` no Ollama para exibir texto progressivamente.

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

- [ ] Testes E2E do cliente (Playwright): fluxo webcam → detecção/descrição → log.
- [ ] Testes para os novos endpoints `GET`/`DELETE /api/logs` (já cobertos no servidor; falta no fluxo do cliente).
- [ ] Log estruturado e padronização de mensagens/erros no servidor.
- [ ] Pipeline de CI (typecheck + lint + test + build).
