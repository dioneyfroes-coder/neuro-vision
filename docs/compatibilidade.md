# Política de compatibilidade de modelos e dependências (Fase 8)

Este documento define o que precisa casar para uma instalação ser considerada **compatível** e, quando algo muda, o que precisa ser registrado para que um comparativo seja cientificamente válido.

## 1. Versões fixadas (fonte única)

A fonte canonical das versões dos runtimes carregados do CDN é `public/offline.ts`:

| Runtime | Constante | Versão atual |
| --- | --- | --- |
| MediaPipe Tasks Vision | `VERSAO_MEDIAPIPE` | `0.10.21` |
| Hugging Face Transformers | `VERSAO_TRANSFORMERS` | `3.8.1` |
| ONNX Runtime Web | `VERSAO_ONNXRUNTIME` | `1.21.0` |

Esses valores **precisam** coincidir com:

- `scripts/offline-manifest.mjs` (`VERSOES`), usado por `npm run preparar:offline`;
- as URLs de import em `public/gestos.ts`, `public/pose.ts`, `src/mediapipe-cdn.d.ts` e `src/transformers-cdn.d.ts`;
- o alias de teste em `vitest.config.ts`;
- `devDependencies["onnxruntime-web"]` em `package.json` (o intervalo `^1.21.0` resolve para `1.21.0`; a verificação compara a versão base sem `^`/`~`).

A verificação é executada por `npm run verificar:compatibilidade` e no CI. Ela compara textos, não instala nada, não consulta a rede e não corrige divergências: uma versão ausente é um problema explícito, nunca uma suposição.

## 2. Node e ambiente

- `.nvmrc` e `.node-version`: `22.12.0` (devem ser iguais).
- `engines.node` em `package.json`: `^22.12.0 || ^24.0.0 || >=26.0.0`.
- A verificação checa se a versão de `.nvmrc` está dentro da faixa declarada. Node 20, por exemplo, falha.
- O lockfile `package-lock.json` é o registro das versões instaladas; `npm ci` no CI garante que ele seja respeitado.

Trocar uma versão de runtime exige, no **mesmo commit**: atualizar a constante em `public/offline.ts`, todas as ocorrências listadas acima, a documentação e — se houver pesos atrelados — a revisão/modelo registrados na telemetria.

## 3. IDs de modelo e revisão de pesos

A política de modelo é **explícita por ID e por revisão**:

- O ID do modelo usado no backend é o valor efetivo reportado por `GET /api/health` (`modelo` após resolução de fallback), não apenas `NEURO_MODEL`/solicitado;
- modelos locais do navegador são identificados pelo arquivo/pasta em `modelos/` e pelo runtime fixado na seção 1;
- os repositórios de pose e seus arquivos são listados em `REPOS_POSE` em `scripts/offline-manifest.mjs`;
- o conjunto NSFW experimental usa `MODELO_NSFW_CONJUNTO`/`MODELOS_NSFW_CONJUNTO` em `public/nsfw-onnx.ts`, com pesos em `modelos/yolonsfw/`.

**Limitação conhecida:** os downloads do Hugging Face em `scripts/offline-manifest.mjs` usam `resolve/main`. Isso significa que o conteúdo pode mudar sem mudança de ID. Para que um benchmark de modelos seja comparável, a revisão (commit SHA) ou hash dos arquivos precisa ser registrada na telemetria do ciclo e no relatório. Enquanto isso não existir, qualquer comparativo que mude de pesos entre execuções deve ser marcado `INCONCLUSIVO` — ausência de revisão não é presunção de estabilidade.

## 4. O que a telemetria já registra e o que falta

Os registros de ciclo incluem `configuracao` (variante/parâmetros efetivos), `politica` (cadência) e métricas por etapa/carga de modelos; `GET /api/health` reporta modelo solicitado, efetivo e fallback. Isso permite identificar **qual configuração** produziu um número.

Ainda **não** há campo canonical para:

- revisão/hash dos pesos Hugging Face (item 3);
- fingerprint completo do backend (versão/build do LM Studio/llama.cpp/vLLM);
- medição de RAM em hardware alvo fora do que o backend expõe em `/api/v0/models`.

Enquanto esses campos não existirem, [`qualidade.md`](./qualidade.md) e [`fase8-otimizacao-manutencao.md`](./fase8-otimizacao-manutencao.md) devem tratar comparativos entre execuções distintas como dependentes de contexto declarado, não como prova de regressão ou melhoria.

## 5. Matriz de fallback

Os fallbacks precisam permanecer explícitos e auditáveis; nenhum deles pode ser interpretado como evidência observada:

| Subsistema | Caminho preferido | Fallback | Registro |
| --- | --- | --- | --- |
| Detecção de objetos | ONNX WebGPU | WASM (1–4 threads conforme COOP/COEP) | EP efetivo na linha de diagnóstico e telemetria |
| Pose | Transformers `@huggingface/transformers` | nenhum modelo alternativo automático | `subsistemasIndisponiveis` / `indisponivel` |
| Mãos/gestos | MediaPipe Tasks Vision | nenhum modelo alternativo automático | `subsistemasIndisponiveis` / `indisponivel` |
| NSFW | conjunto de 6 modelos ONNX locais | desligado (opt-in) | aviso operacional, bloco ausente |
| Visão multimodal | modelo configurado | substituto reportado por `/api/health` | `fallback de <solicitado>` na interface |

Perfil `?perfil=leve` (Fase 8) desliga pose e mãos **antes** da carga: isso é uma decisão de configuração registrada como `desativado`, nunca uma falha e nunca ausência observada na cena.

## 6. Atualizando a política

1. Mude a versão/revisão em um único commit atômico, incluindo todas as ocorrências verificadas.
2. Rode `npm run verificar:compatibilidade`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` e `npm run test:e2e`.
3. Se mudou modelo/pesos, gere novo `logs/ciclos.jsonl` e novo `bench/RELATORIO_FASE8_YYYYMMDD.md`; não reutilize veredito de configuração anterior.
4. Atualize este documento e `docs/qualidade.md` com o contexto da nova configuração.
