# Comparativo final — Etapa 10 do ROTEIRO de modularização (2026-10-20)

Fecha os itens **[5.4]** (verificação final) e **[5.5]** (relatório comparativo
final) da Etapa 10, e a fase "Menu multiframe padrão + YOLO ONNX + NSFW
experimental". A **decisão arquitetural** (item 7 da Etapa 9) está registrada em
[`DECISAO_ARQUITETURAL_2026-10-19.md`](./DECISAO_ARQUITETURAL_2026-10-19.md) —
este relatório consolida o estado final e aponta para lá; não a repete.

Não altera `bench/BASELINE.md`. Relatórios de apoio:
`bench/COMPARATIVO_A_B_C_D_20261018.md`, `bench/RELATORIO_VARIANTE_*_20261018.md`,
`bench/RELATORIO_SMOKE_MULTIFRAME_2026-10-19.md`.

> **Nota de correção (Fase 0, 2026-10-20):** a tabela da seção 3 e o resumo da
> seção 5 foram corrigidos para refletir o **código real**: as mãos são
> tentadas por padrão nos modos C/D (sem opção de desligar só elas) e o
> multimodal é chamado **a cada ciclo concluído** nesses modos, não pela
> política de eventos. Onde a decisão registrada difere da implementação, o
> texto indica o estado pendente.

> **Nota da Fase 5 (2026-10-21):** este relatório é o estado **anterior** ao
> protocolo reproduzível da Fase 5 (warm-up separado do cold start, etapas
> isoladas e gate de qualidade × latência). O protocolo, os critérios do gate e
> a decisão com base neles estão em
> [`DECISAO_ARQUITETURAL_2026-10-21.md`](./DECISAO_ARQUITETURAL_2026-10-21.md).
> Os números de latência/qualidade deste arquivo continuam válidos como
> registro histórico.

## 1. O que mudou desde o comparativo A–D (2026-10-18)

| Frente | Antes | Depois |
| --- | --- | --- |
| Menu de modos | 7 opções, nenhum multiframe como padrão | **"Percepção multi-frame" é a primeira opção e o modo padrão** (`public/modos.ts`, `MODO_PADRAO = "percepcao"`); B/C seguem registrados para o harness e o E2E |
| Detecção de objetos | Transformers.js (`DetectorTransformers`), carga fria de ~95 s dentro do ciclo | **YOLOv10 em ONNX** (`public/yolo-onnx.ts`, `onnxruntime-web@1.21.0` WASM, catálogo `yolov10n|s`, saída `[1,300,6]`, cache de sessão por URL). Validação empírica com frames reais: `person` 0.937, caixas dentro dos limites (`scripts/verificar-yolo-onnx.mjs`) |
| Percepção local | 3 subsistemas (detecção, pose, mãos) | **4º subsistema NSFW experimental** (`public/nsfw-onnx.ts`): YOLO11 exportado para ONNX, rótulos via sidecar `<modelo>.onnx.json`, **opt-in** (toggle `#nsfw`, desligado por padrão, bloqueado durante captura); contexto vai ao gemma **somente quando o toggle está ligado**, junto dos dados locais |
| Infra ONNX | inexistente | Runtime compartilhado e cache de sessões reutilizados entre detecção e NSFW; rota `GET /yolonsfw/` serve apenas `.onnx`/`.json`; pesos `modelos/yolonsfw/*.pt|*.onnx` **gitignored, nunca commitados** |

## 2. Verificação final [5.4] — 2026-10-20

Sem novos testes nesta rodada (conforme pedido); apenas execução das suítes
existentes sobre o código final:

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Typecheck | `npm run typecheck` | ✅ sem erros |
| Lint | `npm run lint` | ✅ sem erros (após ignorar `modelos/**` — o venv Python não é código) |
| Testes | `npm test` | ✅ **487 passed** (34 arquivos) |
| Build | `npm run build` | ✅ `public/app.js` regenerado (154,0 kB) |
| E2E padrão | `npx playwright test` | ✅ **15 passed, 4 skipped** (os skips são os E2E opt-in de webcam/clipes, por design) |

## 3. Estado dos subsistemas (referência rápida)

| Subsistema | Status | Como desligar |
| --- | --- | --- |
| Deteccão (YOLOv10 ONNX) | ativa nos modos C/D; modelos carregados no `configurar()` da sessão, mas **sem warm-up de inferência** (1ª inferência ainda paga a compilação) | modo `percepcao-sequencia` (variante B) pula percepção local |
| Pose (YOLO Pose) | ativa nos modos C/D | ver `docs/limites.md` |
| Mãos/gestos (MediaPipe) | **tentada por padrão nos modos C/D** (sem toggle próprio; não executou nos runs medidos) | desligar a percepção local inteira (B/`Visão`/`Roteiro`); opção só para as mãos ainda **não existe** |
| NSFW (YOLO11 ONNX) | **experimental, opt-in, off por padrão** | toggle `#nsfw` desmarcado (padrão) |
| Multimodal (LM Studio) | **a cada ciclo concluído nos modos C/D**; sob demanda (política) no modo Eventos | não aumentar a frequência; no multiframe o próximo ciclo só começa após o anterior (+500 ms) |

## 4. Números que sustentam a decisão (do hardware de referência)

Consolidados de `bench/DECISAO_ARQUITETURAL_2026-10-19.md` (medidos em
`logs/ciclos.jsonl`, Xeon E5-2660 v3, sem aceleração):

- Multimodal domina o ciclo: **~34–57 s/chamada** (~92% do ciclo B) — gargalo
  real; nenhum ciclo C/D concluiu num clipe de 30 s pós-reset.
- Deteccão **fria** (compilação + carga dentro do ciclo): ~95 s; com o YOLO ONNX
  e cache de sessão esse custo migra para o pré-aquecimento (fora do ciclo).
- Pose (~2,5 s) e temporal (~5 ms) são econômicas; mãos nunca executou.
- Qualidade (clipe `webcam-mudanca`, anotação verificada): precisão 50%,
  recall 33%, FP/min 1,5 — comparabilidade 1:1 com o baseline antigo NÃO vale
  (conjuntos de anotação diferentes).

## 5. Decisão vigente e estado da implementação (resumo — detalhe no documento de decisão)

1. Deteccão e pose **sempre ativas** nos modos C/D; os modelos são carregados na inicialização da sessão, mas o **warm-up de inferência** ainda não existe (condição pendente da decisão).
2. **Mãos:** a decisão registrada é **sob demanda**, mas a implementação atual
   ainda as **tenta por padrão** nos modos C/D, sem opção de desligar só as
   mãos. Alinhar o default e expor a configuração é a **Fase 2** das correções.
3. **Multimodal:** no modo Eventos vale a política de análise (cooldown/teto);
   nos modos C/D é **uma chamada por ciclo concluído**, sem essa política. Não
   aumentar a frequência neste hardware; o próximo ciclo só começa após o
   anterior (`MARGEM_RESERVA_MS` = 500 ms).
4. Captura **1 frame/s, 4 frames/ciclo** mantida.
5. NSFW é **experimental e opt-in** — fora da decisão de defaults, por ser
   sensível a conteúdo e ter custo adicional (~0,8 s/frame WASM no modelo nano).

Condições de revisão (reexecutar E2E com `E2E_WEBCAM_CHANNEL="chrome"`,
multimodal < 10 s/chamada, detecção quente < 1 s/frame) continuam valendo e
estão no documento de decisão.

## 6. Como reproduzir

```bash
npm run build && npm test && npm run lint && npm run typecheck
npx playwright test                     # suíte padrão (webcam opt-in fica de fora)
node scripts/verificar-yolo-onnx.mjs    # validação empírica da detecção ONNX
node scripts/verificar-yolo-nsfw.mjs    # validação empírica do NSFW ONNX
node scripts/benchmark-variantes.mjs --help   # harness A–D sobre bench/videos
```

Exportação do modelo NSFW (requer venv Python local em `modelos/yolonsfw/.venv`):
`node scripts/exportar-yolo-nsfw.mjs` — gera `modelos/yolonsfw/*.onnx` + sidecar de
rótulos; nunca versionar os pesos.
