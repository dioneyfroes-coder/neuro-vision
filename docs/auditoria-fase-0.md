# Auditoria e baseline — Fase 0 do plano mestre

Registro reproduzível do estado do repositório **antes** das mudanças do plano mestre. Base: commit `c36d054331b389b6fcacfb4598628822ecc915cd` (`origin/main`), executado em 22/11/2026.

## Ambiente medido

| Item | Valor observado |
| --- | --- |
| Sistema | Windows 11 Pro, build `10.0.26200`, x64 |
| CPU | Intel Xeon E5-2660 v3 @ 2,60 GHz, 10 núcleos / 20 threads |
| RAM | 16.994.934.784 bytes (~15,8 GiB) |
| GPU | AMD Radeon RX 5600 OEM, driver `32.0.21045.16010` |
| Node.js | `v24.19.0` |
| npm | `11.17.0` |
| Playwright | `1.64.0` |
| Chromium | `156.0.8078.4` (`ms-playwright/chromium-1248`) |
| Backend de visão | Não disponível nas portas `1234` e `1235` |
| Versão do modelo multimodal | **Não medida**: backend fora do ar; nenhum modelo carregado |

O ambiente de dependências foi recriado com `npm ci` (178 pacotes instalados). O `npm audit` informou 11 vulnerabilidades moderadas; não houve alteração de dependências nesta fase.

## Verificações executadas

| Comando | Resultado |
| --- | --- |
| `npm run typecheck` | OK |
| `npm run lint` | OK |
| `npm test` | 161 arquivos, 1083 testes, todos aprovados |
| `npm run build` | OK (`dist/server.js` 172,4 kB; `public/app.js` 401,2 kB; workers 24,9 / 9,5 / 7,9 kB) |
| `npm run test:e2e` | 19 aprovados, 7 pulados, 0 falhas |
| `npm run bench -- --json` | Falhou: `backend de visao fora do ar em http://localhost:1234` |

Os 7 testes E2E pulados dependem de clipe real e/ou modelos locais (`E2E_WEBCAM_CLIP`, `E2E_LOCAL_MODELS_CLIP`): `local-models`, `webcam-cadencia`, os três modos multiframe, `webcam` e `webcam-nsfw`. O E2E de troca de `MediaStream` no monitoramento passou.

### Correção de baseline: snapshot com mojibake

A primeira execução de `npm test` escreveu um snapshot novo e marcou um obsoleto. O arquivo `tests/contexto-esquema/__snapshots__/compactacao-evidencia.test.ts.snap` tinha a chave `Fase 3 â€” ...` enquanto o teste usa `Fase 3 — ...`. A chave foi normalizada com `npx vitest run ... -u`; a suíte passou sem avisos de snapshot.

## Baseline de telemetria (diagnóstico, não aceite)

Executado:

```powershell
node --import tsx scripts/soak-monitoramento.mjs `
  --acelerar 100 --permitir-inconclusivo --duracao-ms 120000 `
  --relatorio logs/soak/baseline-fase0-20261122.json
```

| Métrica | Valor |
| --- | --- |
| Duração simulada | 12.000.000 ms (120 quadros, 100×) |
| Quadros contabilizados/esperados | 112 / 112 |
| Segmentos / lacunas | 13 / 3 (todas explicadas) |
| RSS inicial / máximo | 96,3 MB / 109,7 MB |
| Crescimento de RSS | 17,34 MB |
| Pico de CPU | 316,45% (soma entre núcleos; não é erro de arredondamento) |
| Bytes de vídeo no índice | 13.312 bytes (3993,6 bytes/hora simulados) |
| Veredito | `INCONCLUSIVO` — modo acelerado, por definição |

Os números servem apenas como linha de partida de instrumentação. **Não** substituem o soak real de 30 minutos, a medição de FPS/latência com detector real ou o benchmark multimodal (ver [`soak.md`](./soak.md) e [`pendencias.md`](./pendencias.md)).

## Lacunas confirmadas antes de alterar código

1. `capturadoEmMs` tem duas semânticas: monotônico na percepção e epoch em gravação/vídeo.
2. Há `inferidoEm` e `registradoEm`, mas não há contratos persistidos para `processadoEmMs`, `persistidoEmMs`, `desvioRelogioMs` nem ordem de chegada.
3. O vocabulário de evidência está distribuído entre cena, evento temporal e diagnóstico de sinal; não existe um `statusEvidencia` unificado e compatível.
4. Tracks de pose/mãos são robustos, mas objetos do inventário ainda não têm identidade por instância: `construirReferencia()` consolida um item por rótulo.
5. A reidentificação do motor temporal é binária (reassocia ou cria ID novo); falta o estado ambíguo e o histórico leve de observações.
6. `ServicoCena` e as rotas existem, mas não há chamador de produção ligando YOLO/observações ao inventário, nem interface de revisão.

Essas lacunas definem o escopo da Fase 1 (integridade temporal e identidade) e da Fase 2 (inventário automático) do plano mestre.

## Como reproduzir

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
node --import tsx scripts/soak-monitoramento.mjs --acelerar 100 --permitir-inconclusivo --duracao-ms 120000
```

Para o benchmark multimodal é necessário iniciar o backend local (por exemplo, LM Studio em `http://localhost:1234`) com um modelo de visão carregado antes de `npm run bench`.
