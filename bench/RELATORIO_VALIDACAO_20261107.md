# Relatório de validação — versão 0.1.0 (2026-11-07)

Registro das validações executadas para as Fases 4 e 5 do plano.
Este relatório cobre **código, ambiente e testes automatizados**; os números de
benchmark com o modelo local só entram em uma rodada real do harness.

## Ambiente

| Item | Valor |
|------|-------|
| Versão do pacote | `0.1.0` |
| Commit base | `1549dc4` (`fase 3`) + alterações não commitadas das Fases 4/5 |
| Node.js | `v24.19.0` (compatível com `engines`: `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`) |
| npm | `11.17.0` |
| Instalação reproduzível | `npm ci` sobre `package-lock.json` (lockfile v3); `npm ci --dry-run` confirmou "up to date" |
| Arquivos de versão | `.nvmrc` e `.node-version` fixam `22.12.0` |

## Validações executadas

| Comando | Resultado |
|---------|-----------|
| `npm run typecheck` | ✅ passou (`tsc --noEmit`) |
| `npm run lint` | ✅ passou (`eslint src tests public`) |
| `npm test` | ✅ **52 arquivos / 776 testes** passaram |
| `npx playwright test e2e/app.spec.ts --workers=1` | ✅ **15 testes** passaram |

Os testes específicos dos scripts das Fases 4/5 (`tests/scripts/*.test.mjs`)
passaram com **118 testes**, incluindo:

- `--min-ciclos` padrão **2** e rejeição de rodada com um único ciclo;
- distinção entre `comparavel`, `estatisticamenteSuficiente` e `conclusivo`;
- IC95% da mediana por ordem estatística apenas com amostra suficiente;
- métricas sem denominador como `N/A`/`null` (recall, precisão, FP/min, perdidas);
- janela renomeada para "janela de geração do relatório";
- gate EVAL rejeitando evento rápido anotado a 1 fps.

## Backend, modelo multimodal e adaptadores

Esta validação **não executou o backend multimodal local** nem os E2E com vídeo
real (ver limitações abaixo), portanto não há valores efetivos para registrar
aqui. O harness agora sempre imprime, por variante, a tabela:

| Adaptador | Modelo local | Dispositivo efetivo | Versão |
|-----------|--------------|---------------------|--------|
| `deteccao` | valor de `metricas.cargaModelos` | idem | idem |
| `pose` | idem | idem | idem |
| `maos` | idem | idem | idem |

Quando a telemetria de carga não registra um adaptador, a célula sai como
**"não registrado"** — nunca um dispositivo suposto. A próxima rodada real
(`node scripts/benchmark-variantes.mjs ...`) deve ser anexada a este relatório
com backend, modelo multimodal observado em `logs/visao.jsonl` e os três
dispositivos efetivos.

## Limitações explícitas

- **EVAL incompleto para as capacidades humanas:** o EVAL atual valida apenas
  `movimento_objeto.objeto_deslocado`. Gestos, postura, transição de ação e
  oclusão/iluminação exigem vídeos novos e anotação humana revisada; não há
  resultado para esses alvos.
- **Sem rodadas independentes reais:** o harness suporta warm-up separado e
  suficiência estatística, mas nenhuma rodada com o backend local foi executada
  nesta validação. Não há conclusão arquitetural nova.
- **E2E com modelo/vídeo real não executado:** `webcam.spec.ts`,
  `webcam-multiframe.spec.ts` e `webcam-nsfw.spec.ts` dependem de clipe,
  modelo local e/ou backend; apenas o fluxo de interface com stubs
  (`app.spec.ts`) é aplicável neste ambiente.
- **Logs brutos:** `logs/` agora é integralmente ignorado pelo Git; os relatórios
  do harness registram `sha256` dos clipes e o commit do código para rastrear a
  origem dos dados.
