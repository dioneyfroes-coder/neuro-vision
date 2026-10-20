# Fluxo orientado a eventos — Neuro Vision

Como o modo **Eventos** funciona: percepção leve a cada tick, o modelo de visão chamado sob demanda pela política, o cancelamento da inferência e a consulta ao histórico ("o que mudou / quando / evidências").

## Como funciona

A percepção leve (detecção + rastreamento + mudança de cena) roda em **todo tick** do agendador; o modelo de visão só é chamado quando a política decide. O motivo é gravado no log como campo `motivo` (por exemplo, `nova_entidade`, `mudanca_de_cena`, `baixa_confianca`, `resumo_periodico`, `manual`) e aparece como "por …" na interface.

Regras da `PoliticaAnalise` (em `src/politica-analise.ts`, configuração `CONFIG_POLITICA_PADRAO`):

- **Primeira análise**: aciona no primeiro tick de cada sessão.
- **Eventos críticos**: `aparicao`, `desaparecimento`, `mudanca_de_cena` acionam por si sós; **movimento** só acima de um mínimo por frame.
- **Baixa confiança**: uma detecção com score menor que `confiancaAlta` (0.6) aciona o modelo de visão para julgar.
- **Resumo periódico**: mesmo sem mudança, re-analisa a cada `resumoPeriodicoMs` (60 s).
- **Cooldown** (10 s) e **teto de chamadas** (4/min, janela deslizante de 60 s) impedem sequências de inferências em cenas instáveis.
- **"Analisar agora"**: botão que força a análise imediata, ignorando cooldown/janela (respeitando o não-sobrepor).
- **Falha da percepção leve nunca vira "sem mudança"**: vira registro operacional e motivo `falha_percepcao` (dentro da janela).

## Temporização correta

O frame é capturado **uma única vez** por ciclo e, no mesmo instante, são lidos: a imagem de análise, o snapshot (thumbnail dos mesmos pixels) e a assinatura de cena. Rastreador, detector de cena e eventos usam o instante da **captura** (`capturadoEm`/`performance.now()`), não o fim da inferência — assim os eventos refletem quando o que aconteceu foi de fato visto.

## Cancelamento

Quando o cliente cancela uma análise, ele encerra a leitura do stream e o servidor **propaga o abort ao `fetch` do backend de visão** (um `AbortController` ligado ao `close` da resposta), derrubando a inferência em vez de deixá-la consumir recursos. O cancelamento é registrado como `visao_cancelada` no log operacional; timeout vira `visao_timeout`.

## Ciclos multiframe (modos `percepcao*`)

Nos modos multiframe (variantes B/C/D da Etapa 9), quem produz eventos é o **motor temporal dentro de cada ciclo de 4 frames** (`public/cycle/ciclo-multiframe.ts` → `RegistroCiclo.eventosTemporais`). A chamada multimodal é feita **a cada ciclo concluído**, sem a política de cooldown/teto do modo Eventos; os ciclos são sequenciais (um em voo por vez) e o próximo só começa após o anterior + `MARGEM_RESERVA_MS` (500 ms). No controlador (`persistirEventosTemporais`), os eventos confirmados do tipo `aparicao`, `desaparecimento` e `mudanca_de_cena` são gravados em `eventos.jsonl` **uma única vez por identidade** — um `EventoTemporal` é atualizado entre ciclos, então a gravação usa o `eventoId` como chave deduplicada e `timestamp = inicioEm` (o instante real do acontecimento, não o fim da confirmação):

- Só estados **`confirmado`/`encerrado`** viram arquivo; `candidato`/`incerto` nunca — a mesma regra de evidência do modo Eventos. Um evento interrompido por **período cego** (lacuna de observação entre ciclos) fica `incerto` e não é gravado: o motor encerra na última evidência positiva sem presumir continuidade (ver `arquitetura.md` → *Semântica temporal*).
- Tipos sem equivalente visual (`gesto_detectado`, `braco_levantado`, `movimento_corporal`) ficam apenas no diagnóstico do ciclo e no contexto da interpretação.
- `origem` = `rastreador`, `frameId` = último frame da evidência; o `RegistroCiclo` relaciona o `cycleId` aos mesmos `frameIds`.
- A variante B **não tem percepção local** e portanto não emite eventos — só interpretação multimodal.

## Consulta ao histórico

`GET /api/eventos` aceita filtros:

- `tipo` — CSV de tipos (ex.: `?tipo=aparicao,movimento`);
- `objetoId` — rastrear um objeto específico;
- `desde`/`ate` — janela temporal (epoch ms ou ISO).

Cada evento traz `confianca` e `snapshot` como evidência, respondendo **o que mudou**, **quando** e com quais **evidências**. Os filtros incidem sobre os eventos mais recentes dentro de `limit`.

## Persistência e idempotência

Cada evento carrega um `idempotencyKey` (gerado por evento) e o `frameId` da captura que o originou. O cliente envia pela fila de persistência (`public/persistencia.ts`), que serializa as requisições e repete falhas transitórias; como a chave é estável entre tentativas, o servidor reconhece o reenvio e responde `{ ok: true, duplicado: true }` **sem** gravar de novo. Perder a resposta do servidor, portanto, não vira evento duplicado.

Vários eventos do mesmo quadro compartilham o mesmo `snapshot`: a imagem é deduplicada por hash do conteúdo em `logs/snapshots/`, então **um quadro = um arquivo**, mesmo que ele gere `aparicao` e `movimento`. Quando uma gravação falha de vez (após as tentativas), o evento entra no aviso de persistência e pode ser exportado no botão **Pendentes** — não é descartado em silêncio. Uma limpeza de histórico (`DELETE`) invalida as chaves de idempotência anteriores, porque o arquivo de eventos fica vazio.

Tipos de evento (`TIPOS_EVENTO` em `src/memoria.ts`): `aparicao`, `desaparecimento`, `movimento`, `mudanca_de_cena`, `resumo`. Origem (`api.ts`): `detector`, `rastreador` ou `visao`. Registros operacionais (falhas/métricas, que **não** são acontecimentos visuais) vão para `operacional.jsonl` via `POST /api/operacional`.