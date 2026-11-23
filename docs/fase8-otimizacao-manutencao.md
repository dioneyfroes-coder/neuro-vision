# Fase 8 — Otimização e manutenção

Esta fase entrega **mecanismos e automação determinísticos**. Ela não inventa ganho de desempenho, não troca validação em hardware por teste sintético e não transforma ausência de evidência em medição.

## O que mudou

### Backpressure e filas explícitas

`FilaPersistencia` (`public/persistencia.ts`) agora limita também a lista de gravações falhas mantidas em memória (`maxFalhasGuardadas`, padrão 200). O descarte por limite — fila cheia ou teto de falhas — é contado em `estado.descartes` **separadamente** de `estado.falhas` e nunca é reportado como gravação bem-sucedida. O diagnóstico da interface foi extraído para `public/ui/diagnostico-persistencia.ts` e mostra `fila`, `falhas` e `descartes` como fatos distintos; um descarte sem falhas restantes ainda gera aviso visível.

Isso reduz o crescimento de RAM em sessões longas com o servidor fora do ar e torna a perda auditável no cliente. A política de retenção/exclusão de vídeos da Fase 7 permanece intacta.

### Perfil de inicialização `?perfil=leve`

`public/ui/perfil-inicializacao.ts` introduz um perfil **opt-in**: `?perfil=leve` desliga pose e maos **antes** da composição/carga dos modelos (`montarHabilitacao()` em `public/app.ts`), mantendo deteccao ligada e NSFW sob o toggle existente. O padrão continua `completo`.

O objetivo é reduzir tempo de partida e memória residente em hardware limitado. **Nenhum número de ganho é afirmado sem medição.** A telemetria de subsistemas continua registrando `desativado`, e frames sem dado continuam `indisponivel` — nunca ausência observada. `?benchmark=5fps`, `?benchmark=adaptativa` e `?benchmark=alvo` seguem com a mesma semântica; perfil e política de cadência são independentes.

### Refatoração de controladores

A transformação `EstadoFila -> texto` e a leitura do perfil saíram do controlador grande `public/app.ts` para módulos puros em `public/ui/`. As regras de aviso podem ser testadas sem montar a página, e a decisão de inicialização pode ser testada sem instanciar motores.

### Relatório consolidado de benchmark

`npm run bench:relatorio` (`scripts/relatorio-fase8.mjs`) lê um JSONL de `RegistroCiclo`, reaproveita `agregarMetricasCiclos`/`separarWarmupCiclos` (variantes A–D) e `resumirBenchmark` (cadência) e grava `bench/RELATORIO_FASE8_YYYYMMDD.md` — ou imprime `--json`.

- Compara as quatro variantes **sobre os mesmos registros**, separando ciclos concluídos, aquecidos e warm-ups.
- Reporta cadência efetiva por subsistema e distingue `ATINGIU` de `NAO_ATINGIU` **medido**.
- Sem dados suficientes, emite `INCONCLUSIVO` e mantém células `N/A`; nunca converte falta de amostra em zero.
- Aceita `--soak` opcional; sem ele, declara explicitamente que nenhum veredito de soak foi inferido.
- Nunca escreve `bench/BASELINE.md` — o nome de saída é validado contra `RELATORIO_FASE8_\d{8}.md`.
- Código de saída: `0` com dados suficientes, `2` quando inconclusivo, `1` em erro de execução.

`npm run bench:variantes` continua sendo a entrave de A/B/C/D com anotações; o novo comando é uma **consolidação dos logs**, não uma substituição das medições de variante/cadência já existentes. Nenhum relatório de Fase 8 é gerado automaticamente em CI sem dados reais versionados: a automação é o comando, não a fabricação de números.

### Política de compatibilidade

`npm run verificar:compatibilidade` (`scripts/verificar-compatibilidade.mjs`, núcleo puro em `scripts/verificar-compatibilidade/nucleo.mjs`) exige que as versões fixadas coincidam entre:

- `public/offline.ts` (fonte canonical de `VERSAO_MEDIAPIPE`, `VERSAO_TRANSFORMERS`, `VERSAO_ONNXRUNTIME`);
- `scripts/offline-manifest.mjs`;
- imports de CDN em `public/gestos.ts`, `public/pose.ts` e declarações de tipo em `src/*-cdn.d.ts`;
- alias do Transformers em `vitest.config.ts`;
- `onnxruntime-web` e `engines.node` em `package.json`, com `.nvmrc` e `.node-version` coerentes e dentro da faixa aceita.

A verificação roda no CI (`npm run verificar:compatibilidade`). Divergência ou declaração ausente falha o job; nada é corrigido automaticamente. A política também vale para o versionamento de pesos: os IDs de modelo e revisões precisam ser registrados na telemetria antes de qualquer comparativo de modelos; hoje os downloads do Hugging Face usam `resolve/main`, portanto **a revisão exata ainda não é fixada** e isso segue documentado como limitação em [`compatibilidade.md`](./compatibilidade.md).

## O que **não** foi feito nesta fase

- Não há medição real de inicialização, RAM, FPS ou custo em hardware alvo; a otimização entregue é estrutural (limites e opção de perfil), não um número de ganho.
- Não foram coletados `logs/ciclos.jsonl`, `logs/eventos.jsonl`, anotações de clipes ou relatórios de soak novos. `bench/RELATORIO_FASE8_*.md` só terá veredito conclusivo quando esses dados existirem.
- A validação em campo da Fase 7 (sessão prolongada, webcam física/reconexão, disco cheio, clipes degradados anotados e precisão multimodal real) continua pendente em [`pendencias.md`](./pendencias.md#fase-7--operação-contínua-e-segurança).

## Verificação determinística

Foram executados: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e` e os testes focados da Fase 8 (`tests/persistencia.test.ts`, `tests/diagnostico-persistencia.test.ts`, `tests/perfil-inicializacao.test.ts`, `tests/scripts/verificar-compatibilidade.test.mjs`, `tests/scripts/relatorio-fase8.test.mjs`). Testes sintéticos provam as regras de código — não substituem a medição em campo.

## Checklist da Fase 8 no plano mestre

| Item | Situação |
| --- | --- |
| Comparar variantes de modelos e cadência | Automação consolidada entregue; comparativo conclusivo depende de logs/anotações reais. |
| Reduzir inicialização e consumo de RAM | Limite de memória da fila + perfil `leve` opt-in; ganho real não medido. |
| Ajustar backpressure e filas | Contadores, limite e aviso de descarte implementados e testados. |
| Refatorar controladores grandes | Regras puras extraídas de `app.ts`. |
| Atualizar documentação | Este documento, `compatibilidade.md`, índices e correções das contradições de Fase 7. |
| Automatizar relatórios de benchmark | `bench:relatorio` com veredito explícito e proteção do baseline. |
| Definir política de compatibilidade | `compatibilidade.md` + verificação no CI. |
