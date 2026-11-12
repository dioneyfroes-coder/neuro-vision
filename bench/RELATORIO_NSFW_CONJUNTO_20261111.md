# Relatório — conjunto NSFW automático (6 modelos, um worker por modelo)

**Data:** 2026-11-11 (revisado em 2026-11-12)
**Harness:** `scripts/verificar-yolo-nsfw.mjs --conjunto` (Chromium headless, `onnxruntime-web` em WASM)
**Clipe:** `nsfw-60s.mp4` (720×1280, 60 s), 5 quadros em t = 10, 20, 30, 40 e 50 s
**Limiar global:** 0,5 · **limiares por classe** de `public/nsfw-onnx.ts`
**Pesos:** `modelos/yolonsfw/` (gitignored; não versionados)
**Ambiente:** 20 núcleos lógicos, 16 GB de RAM, Chromium 156 headless, WASM (sem WebGPU)

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
`session.run` puro, sem captura/renderização. A coluna **1 thread** é o mesmo
harness com `--sem-isolamento` (sem COOP/COEP, `numThreads=1`); a coluna **4
threads** é o default com COOP/COEP. Os números antigos desta tabela eram, na
prática, 1 thread — o servidor do harness ainda não enviava os cabeçalhos de
isolamento.

| Modelo | Carga | Inferência/quadro (1 thread) | Inferência/quadro (4 threads) | WASM após inferência | Marcações no clipe |
|---|---|---|---|---|---|
| `nudenet_320n` | 1.470 ms | **177 ms** | **85 ms** | 37,8 MB | 10: `FEMALE_BREAST_EXPOSED` ×8, `FEMALE_GENITALIA_COVERED` ×2 |
| `nudenet_640m` | 1.902 ms | **4.561 ms** | **1.233 ms** | 271,8 MB | 9: `FEMALE_BREAST_EXPOSED` ×8, `FEMALE_GENITALIA_COVERED` ×1 |
| `erax_nsfw_yolo11n` | 1.441 ms | **781 ms** | **191 ms** | 61,3 MB | 4: `nipple` ×3, `vagina` ×1 |
| `erax_nsfw_yolo11s` | 1.590 ms | **1.406 ms** | **447 ms** | 115,8 MB | 3: `vagina` ×1, `nipple` ×2 |
| `erax_nsfw_yolo11m` | 1.820 ms | **4.111 ms** | **1.162 ms** | 260,1 MB | 8: `nipple` ×6, `vagina` ×2 |
| `penis_yolov8m` | 1.942 ms | **4.592 ms** | **1.222 ms** | 271,8 MB | 0 nos 5 quadros (ver abaixo) |

Saída bruta de referência do `--detalhado`:

- `nudenet_320n`: `[1,22,2100]` (4 caixas + 18 classes), sem linha disparando
  sigmoid falso; scores máximos 0,83–0,86.
- `nudenet_640m`, EraX e `penis_yolov8m`: `[1,300,6]` (NMS embutido).

## Memória por modelo (Fase 8.1)

`performance.memory` mede só o heap JS (~9,5 MB na página) e **não vê** a
memória linear do WASM. `performance.measureUserAgentSpecificMemory` não existe
no Chromium 156 headless usado no harness. Para medir o custo real, o script
envolve o construtor `WebAssembly.Memory` antes de criar a sessão e soma
`buffer.byteLength` de cada memória alocada pelo ORT. O valor inclui pesos,
arena do runtime e ativações; **não** inclui heap JS, overhead do Worker nem o
processo do navegador.

| Modelo | WASM após carga | WASM após inferência | Pico heap JS |
|---|---|---|---|
| `nudenet_320n` | 37,8 MB | 37,8 MB | 9,5 MB |
| `nudenet_640m` | 271,8 MB | 271,8 MB | 9,5 MB |
| `erax_nsfw_yolo11n` | 42,5 MB | 61,3 MB | 9,5 MB |
| `erax_nsfw_yolo11s` | 96,5 MB | 115,8 MB | 9,5 MB |
| `erax_nsfw_yolo11m` | 216,8 MB | 260,1 MB | 9,5 MB |
| `penis_yolov8m` | 271,8 MB | 271,8 MB | 9,5 MB |

**Soma do conjunto:** ~1,02 GB de memória linear WASM (37,8 + 271,8 + 61,3 +
115,8 + 260,1 + 271,8). É um **piso**: cada Worker tem ainda seu heap JS,
estruturas do runtime e overhead do processo. O isolamento COOP/COEP não muda a
memória de forma material (soma sem isolamento: ~1,02 GB; diferenças por modelo
abaixo de 7 MB, ruído de arredondamento de páginas WASM).

## COOP/COEP e `numThreads` WASM (Fase 8.5)

O servidor do harness passou a enviar `Cross-Origin-Opener-Policy: same-origin`
e `Cross-Origin-Embedder-Policy: credentialless` por padrão, como `src/server.ts`.
Com isso `crossOriginIsolated=true` e o script usa
`numThreads = min(4, hardwareConcurrency)` (4 nesta máquina). Sem os cabeçalhos
(`--sem-isolamento`), `crossOriginIsolated=false` e `numThreads=1`.

| Modelo | 1 thread | 4 threads | Ganho |
|---|---|---|---|
| `nudenet_320n` | 177 ms | 85 ms | 2,1× |
| `nudenet_640m` | 4.561 ms | 1.233 ms | 3,7× |
| `erax_nsfw_yolo11n` | 781 ms | 191 ms | 4,1× |
| `erax_nsfw_yolo11s` | 1.406 ms | 447 ms | 3,1× |
| `erax_nsfw_yolo11m` | 4.111 ms | 1.162 ms | 3,5× |
| `penis_yolov8m` | 4.592 ms | 1.222 ms | 3,8× |

O ganho é real e grande, mas **não** é núcleo físico exclusivo: o navegador
continua agendando as threads do pool WASM. Com 6 workers × 4 threads = até 24
threads em 20 núcleos lógicos, há sobrecarga; o número por modelo acima é
medido com um worker por vez.

## Detector dedicado de pênis

`penis_yolov8m` vem de `throaway2854/YOLOv8m-Penis-Detection` (`best.pt`,
52,1 MB), exportado com `node scripts/exportar-yolo-nsfw.mjs
modelos/yolonsfw/penis_yolov8m.pt` para ONNX de 103,7 MB + sidecar
(`classes: ["penis"]`, saída `[1,300,6]`).

- **Custo:** ~1,9 s de carga e ~4,6 s/quadro com 1 thread WASM (~1,2 s com 4
  threads) — o modelo mais caro do conjunto junto do `nudenet_640m`.
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

| Cenário | 1 thread | 4 threads |
|---|---|---|
| Soma sequencial dos 6 modelos | ~15,6 s | **~4,34 s** |
| Piso do paralelo (modelo mais lento manda) | **~4,59 s** (`penis_yolov8m`) | **~1,23 s** (`nudenet_640m`) |
| Carga sequencial dos 6 | ~10,2 s | ~10,2 s |
| Carga paralela (piso) | **~1,95 s** | **~1,95 s** |
| Memória linear WASM do conjunto | ~1,02 GB | ~1,02 GB |

O valor real do paralelo fica **entre** o piso (~1,23 s com 4 threads) e a soma
(~4,34 s): os 6 workers disputam CPU e o pool WASM do navegador, então a parede
não é o máximo isolado. Esse número **não foi medido diretamente** — é uma faixa
derivada, não uma promessa. A telemetria por frame do app registra `modelos` e
`telemetriaModelos` (carga, inferência, memória e marcações por modelo), o que
permite fechar a medição agregada em um ciclo real do app.

Consequência prática: o conjunto **não é tempo real**. O `nudenet_320n` sozinho
custa ~0,09 s/quadro com 4 threads (~0,18 s com 1 thread); o conjunto completo
paga segundos por quadro na faixa derivada. O toggle é para análise sob demanda,
não para vigilância contínua em alta cadência.

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
59,9 s** com o LM Studio online (execução de 2026-11-12).

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

## Fase 7 — ações sexuais

### 7.1 VLM multi-frame

Implementado em `src/nsfw-prompt.ts` (`INSTRUCAO_ACAO_MULTIFRAME` e
`blocoAcaoMultiframe(n)`) e injetado por `public/interpretation/prompt.ts`
**somente** quando o subsistema NSFW rodou e o ciclo tem 2+ imagens. Com uma
imagem, pedir inferência de ação seria convidar o modelo a adivinhar.

- `AcaoInterpretada` ganhou `tipo` (`masturbacao`, `sexo_oral`, `penetracao`,
  `outra`), `natureza` (`observada`/`inferida`) e `confianca` em [0,1].
- `public/interpretation/normalizar.ts` valida os valores fechados, clampa a
  confiança e descarta o que não reconhece — não transforma texto livre em tipo.
- A instrução exige frameIds reais, separa corpo visível de ação inferida e
  trata pose compatível como indício, nunca como prova.
- Testes: `tests/nsfw-prompt.test.ts` e `tests/interpretacao-payload.test.ts`.

Limite: é instrução de prompt + normalização. Sem anotação humana não há como
afirmar acerto de ação; o relatório não deve converter isso em precisão.

### 7.2 Regras geométricas de pose compatível

Implementado em `public/temporal/regras-pose.ts` (`AvaliadorPoseSexual`) e
ligado ao motor temporal (`public/temporal/motor-temporal.ts`):

- mão/punho próximo da região genital estimada pelos quadris;
- pernas/joelhos afastados em relação à largura do quadril;
- movimento rítmico do punho (inversões de direção em janela curta).

O score é uma soma ponderada (0,5 / 0,25 / 0,25; limiar 0,5) e o evento emitido
é `pose_compativel_sexual`, com descrição explícita de "indício geométrico, não
prova". A regra é **gated** por `avaliarPoseSexual`, ligado apenas quando o
toggle NSFW está ativo; em SFW o motor temporal não muda.

Limites: a mão não é associada à pessoa (usa distância), oclusão e enquadramento
afetam os pontos, e a regra nunca deve ser lida como ato sexual. Testes:
`tests/regras-pose.test.ts` e integração em `tests/motor-temporal.test.ts`.

### 7.3 Modelo de ação em vídeo

**Decisão: não integrar.** Não foram encontrados pesos abertos confiáveis e
específicos para masturbação/sexo oral/penetração. Um VideoMAE/X3D/SlowFast
genérico não reconhece a ação e só adiciona custo. Alternativas conhecidas
(`miles-deep`, Caffe antigo, sem conversão para o navegador; APIs comerciais
como Hive AI, pagas e com envio de imagem para fora) conflitam com execução
local. Revisitar apenas com pesos abertos + evidência medida; nunca commitar
pesos (`modelos/` é gitignored).

### 7.4 Bench de ação com anotação humana

**Bloqueado pela ausência de anotação humana** de início/fim de ação em >1 fps.
Sem ground truth, comparar "1 frame", "3 frames" e "6 frames" mediria texto
gerado, não acerto de ação. O que falta: anotar clipes com início/fim de cada
ação e separar, no relatório, acerto de ação de detecção de corpo.

## Fase 8 — threads, memória e fallback

### 8.1 Custo por modelo

Medido neste relatório: carga, latência por quadro (1 e 4 threads) e memória
linear WASM por modelo. Ver as tabelas acima.

### 8.2 Orçamento de workers

Com os números medidos, o conjunto completo custa **~1,02 GB de WASM** (piso,
sem heap/overhead de cada Worker) e, com `numThreads=4`, chega a **24 threads
WASM em 20 núcleos lógicos** — há sobrecarga de agendamento. O orçamento
defensável hoje:

- o conjunto de 6 é **análise sob demanda**, não vigilância contínua;
- para uso contínuo, reduzir o conjunto ou limitar `numThreads` por worker;
- a parede real do app ainda é **faixa derivada** (1,23–4,34 s/quadro), não
  medida em um ciclo real; não prometer tempo real.

### 8.3 Carga sob demanda e liberação

O conjunto só é carregado ao ligar o toggle. Parar a captura executa
`parar() → encerrar() → percepcao.encerrar()`, que encerra cada adaptador e cada
Worker/sessão. O teste `tests/ciclo-percepcao-controller.test.ts` já verifica a
liberação após parar.

### 8.4 Fallback para a thread principal

O motivo do fallback agora é telemetria estruturada:

- `MotorDeteccao.motivoFallback` (opcional) registra a queda do worker;
- `MetricasAdaptador.motivoFallback`, `TelemetriaModeloNsfw.motivoFallback` e
  `TelemetriaSubsistema.motivoFallback` propagam o motivo;
- o conjunto agrega os motivos por modelo e no nível do subsistema.

O fallback é decidido **uma vez por motor** em
`criarMotorDeteccaoComWorker`/`criarMotorNsfwRemoto`; depois de cair para o
local, o worker não é tentado de novo na mesma sessão. Um modelo que cai para a
thread principal continua `ok` — o motivo é separado de `motivoFalha`. Testes em
`tests/nsfw-classifier-adapter.test.ts`.

### 8.5 COOP/COEP e `numThreads`

Medido: isolamento habilitado (`crossOriginIsolated=true`, 4 threads) dá ganho
de **2,1× a 4,1×** por modelo sobre 1 thread. O harness tem `--sem-isolamento`
para reproduzir o cenário sem os cabeçalhos. O navegador continua agendando as
threads; não há núcleo físico exclusivo.

## Limites explícitos

- **Sem ground truth humano.** As contagens são marcações, não acertos; a
  concordância entre modelos é evidência, não precisão/recall.
- **Uma máquina, uma passada, um clipe.** Sem repetição para variância e sem
  WebGPU (WASM no Chromium headless).
- **Paralelo agregado não medido diretamente.** O deadlock do ORT WASM in-page
  impediu a medição; a faixa acima é derivada do custo isolado, não medida em um
  ciclo real do app.
- **Memória é piso, não total.** A memória medida é só a linear WASM por modelo
  (~1,02 GB somados); heap JS, overhead de cada Worker e do processo do navegador
  ficam de fora. O orçamento de 6 workers é um piso, não o consumo observado do
  app.
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
`modelos`, com os 6 workers simultâneos), medir o consumo total do processo do
navegador (não só a memória linear WASM) e calibrar os pisos com anotação humana.
