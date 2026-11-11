# Relatório — conjunto NSFW automático (6 modelos, um worker por modelo)

**Data:** 2026-11-11
**Harness:** `scripts/verificar-yolo-nsfw.mjs --conjunto` (Chromium headless, `onnxruntime-web` em WASM)
**Clipe:** `nsfw-60s.mp4` (720×1280, 60 s), 5 quadros em t = 10, 20, 30, 40 e 50 s
**Limiar global:** 0,5 · **limiares por classe** de `public/nsfw-onnx.ts`
**Pesos:** `modelos/yolonsfw/` (gitignored; não versionados)

## O que mudou

O toggle **NSFW** não tem mais seletor de modelo. Ao ligar, o app carrega
**todos** os modelos do catálogo, cada um em um `Worker` próprio, e roda todos
sobre o mesmo frame. As marcações são mescladas e complementares
(`AdaptadorNsfwConjunto` em `public/perception/adapters/nsfw-classifier.adapter.ts`).

Ordem do conjunto (`MODELOS_NSFW_CONJUNTO`):

1. `nudenet_320n`
2. `nudenet_640m`
3. `erax_nsfw_yolo11n`
4. `erax_nsfw_yolo11s`
5. `erax_nsfw_yolo11m`
6. `penis_yolov8m`

A mescla deduplica **mesmo rótulo** com IoU ≥ 0,6 (mantém o maior score e
registra os modelos concordantes em `modelos`). Rótulos diferentes nunca são
suprimidos: os modelos são complementares por construção.

## Custo por modelo (5 quadros, execução sequencial)

Cada linha é uma sessão WASM nova (carga fria medida uma vez) e a inferência é
`session.run` puro, sem captura/renderização.

| Modelo | Carga | Inferência/quadro | Marcações no clipe |
|---|---|---|---|
| `nudenet_320n` | 1.567 ms | **176 ms** (308 / 142 / 143 / 143 / 143) | 10: `FEMALE_BREAST_EXPOSED` ×8, `FEMALE_GENITALIA_COVERED` ×2 |
| `nudenet_640m` | 1.977 ms | **4.782 ms** (5.054 / 4.581 / 4.779 / 4.825 / 4.671) | 9: `FEMALE_BREAST_EXPOSED` ×8, `FEMALE_GENITALIA_COVERED` ×1 |
| `erax_nsfw_yolo11n` | 1.588 ms | **547 ms** (827 / 484 / 470 / 470 / 486) | 4: `nipple` ×3, `vagina` ×1 |
| `erax_nsfw_yolo11s` | 1.714 ms | **1.410 ms** (1.585 / 1.356 / 1.347 / 1.385 / 1.379) | 3: `vagina` ×1, `nipple` ×2 |
| `erax_nsfw_yolo11m` | 1.875 ms | **4.134 ms** (4.339 / 4.032 / 4.109 / 4.102 / 4.088) | 8: `nipple` ×6, `vagina` ×2 |
| `penis_yolov8m` | 1.932 ms | **4.637 ms** (4.752 / 4.627 / 4.615 / 4.561 / 4.632) | 0 nos 5 quadros (ver abaixo) |

Saída bruta de referência do `--detalhado`:

- `nudenet_320n`: `[1,22,2100]` (4 caixas + 18 classes), sem linha disparando
  sigmoid falso; scores máximos 0,83–0,86.
- `nudenet_640m`, EraX e `penis_yolov8m`: `[1,300,6]` (NMS embutido).

## Detector dedicado de pênis

`penis_yolov8m` vem de `throaway2854/YOLOv8m-Penis-Detection` (`best.pt`,
52,1 MB), exportado com `node scripts/exportar-yolo-nsfw.mjs
modelos/yolonsfw/penis_yolov8m.pt` para ONNX de 103,7 MB + sidecar
(`classes: ["penis"]`, saída `[1,300,6]`).

- **Custo:** ~1,9 s de carga e ~4,6 s/quadro em WASM — o modelo mais caro do
  conjunto junto do `nudenet_640m`.
- **Detecção observada:** no mesmo clipe, em t = 1,5 s, marcou `penis` a
  **0,3040**, caixa `[0,0, 630,1, 619,3, 1280,0]` (720×1280). O piso da classe
  é **0,25** em `public/nsfw-onnx.ts`, então essa detecção entra no payload.
- **Nos 5 quadros amostrados (t = 10–50 s):** nenhuma marcação acima de 0,5. O
  modelo é especializado e não substitui os demais; ele cobre o caso em que o
  EraX não tem classe e o NudeNet fica abaixo do piso.
- **Fotos estáticas do bench:** nenhuma detecção — coerente com um detector
  treinado em enquadramento de vídeo/close, não em foto de corpo inteiro.

## Custo agregado: o que dá para afirmar

O app roda os 6 modelos **em paralelo, um worker por modelo**. O harness mediu
cada modelo isoladamente porque a tentativa de rodar várias
`InferenceSession.run` concorrentes **na mesma página** trava o backend WASM do
ORT (deadlock reproduzido; a medição paralela in-page foi removida do script).
O caminho do app não tem esse problema: cada sessão vive em um `Worker` separado.

Com os números medidos:

| Cenário | Custo por frame |
|---|---|
| Soma sequencial dos 6 modelos | ~15,7 s |
| Piso do paralelo (modelo mais lento manda) | **~4,8 s** (`nudenet_640m`) |
| Carga sequencial dos 6 | ~10,7 s |
| Carga paralela (piso) | **~2,0 s** (modelo mais lento) |

O valor real do paralelo fica **entre** o piso (~4,8 s) e a soma (~15,7 s):
os 6 workers disputam CPU e o pool WASM do navegador, então a parede não é o
máximo isolado. Esse número **não foi medido diretamente** — é uma faixa
derivada, não uma promessa. A telemetria por frame do app passa a registrar
`modelos` e `telemetriaModelos` (carga, inferência e marcações por modelo), o
que permite fechar a medição agregada em um ciclo real.

Consequência prática: o conjunto **não é tempo real**. O `nudenet_320n` sozinho
custa ~0,18 s/quadro; o conjunto completo paga segundos por quadro. O toggle é
para análise sob demanda, não para vigilância contínua em alta cadência.

## Complementaridade observada

Os modelos não concordam em tudo, e é isso que o conjunto explora:

- **NudeNet** cobre `FEMALE_GENITALIA_COVERED` (calcinha/roupa) e genitália
  masculina — classes que o EraX não tem. O 320n achou `FEMALE_GENITALIA_COVERED`
  a 0,49 e 0,157 no clipe; o 640m achou a 0,462.
- **EraX** é o único com `make_love` (ação) e dá `nipple`/`vagina` com NMS
  estável. O 11m recupera mais `nipple` que o nano, ao custo de ~7,5× a latência.
- **`penis_yolov8m`** é especialista: cobre o caso do strapon/vídeo em que os
  outros ficam abaixo do piso.
- A mescla mantém os rótulos diferentes na mesma região; a concordância de
  mesmo rótulo vira um único registro com `modelos: [...]`, o que serve de
  evidência (dois modelos independentes viram o mesmo objeto).

## Validação no app (E2E)

`e2e/webcam-nsfw.spec.ts` com o clipe NSFW de 60 s (`--workers=1`): **passou em
56,6 s** com o LM Studio online.

- sem seletor: ligar o `#nsfw` mostra `conjunto NSFW` no status;
- a asserção de rede confirma que **todos os 6 `.onnx`** do conjunto são
  pedidos (um por worker);
- o `POST /api/visao` leva as marcações mescladas com `modelo`/`modelos` e
  `erro: null`;
- a falha de um modelo não derruba o subsistema; só a falha de todos marca NSFW
  indisponível.

O primeiro run do E2E falhou de forma transitória com `fetch failed` na
preparação do gemma (LM Studio instável no startup); a repetição passou. Não é
regressão do conjunto.

## Limites explícitos

- **Sem ground truth humano.** As contagens são marcações, não acertos; a
  concordância entre modelos é evidência, não precisão/recall.
- **Uma máquina, uma passada, um clipe.** Sem repetição para variância e sem
  WebGPU (WASM no Chromium headless).
- **Paralelo agregado não medido diretamente.** O deadlock do ORT WASM in-page
  impediu a medição; a faixa acima é derivada do custo isolado.
- **Memória por modelo não medida.** Não afirmar orçamento de threads com base
  neste relatório; 6 workers + ~350 MB de pesos é custo real e precisa de
  medição de memória (Fase 8).
- **`penis_yolov8m` é sensível ao enquadramento.** Ele marcou no vídeo e não em
  fotos estáticas; ausência de marcação não prova ausência.
- **O conjunto não é moderador.** As marcações são sinal para o prompt; a
  resposta é descritiva e não censurada, com identidade de gênero só por
  declaração explícita.

## Decisão

O padrão NSFW é o **conjunto completo**, sem seletor. O `nudenet_320n` continua
sendo o modelo mais barato e o melhor custo/benefício isolado, mas deixá-lo
sozinho perderia genitália coberta e o especialista de pênis. O conjunto é a
única configuração que roda **todos** os modelos na mesma captura e entrega
marcações complementares com origem rastreável.

Próximos passos: medir a parede real do conjunto em um ciclo do app (telemetria
`modelos`), medir memória por worker e calibrar os pisos com anotação humana.
