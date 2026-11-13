# Relatório — teste completo da seção NSFW (2026-11-12)

**Objetivo:** rodar o conjunto NSFW inteiro (6 modelos, um worker por modelo) sobre
as fixtures adultas do bench, validar o contrato de saída, medir custo/memória e
rodar o caminho real do app (E2E). Este arquivo mostra **o que cada modelo
detectou**, com score e caixa em pixels da imagem original, para você comparar
com as imagens e julgar o acerto.

**Veredito curto:**

| Dimensão | Resultado |
|---|---|
| Execução dos 6 modelos | **6/6** carregaram e produziram saída válida |
| Contrato (forma, caixas, rótulos) | **passou** em 42 inferências |
| E2E no app (clipe de 60 s) | **passou** em 31,0 s |
| Testes NSFW | **178/178** |
| Suíte completa | **854/854** |
| Acerto semântico | **forte** em corpo (seios/mamilos/vagina) e na foto de casal; **fraco** no strap-on; `penis_yolov8m` **0 nas 4 fixtures, mas 13/130 na varredura pós-60 s** (seção 4.5) |
| Ground truth humano | **não existe** — as contagens são marcações, não precisão/recall |

Leia a seção **“O que acertou e o que não acertou”** antes de concluir qualquer
coisa. O teste prova que o encanamento funciona e que os modelos se complementam;
não prova taxa de acerto.

---

## 1. Comandos executados

```powershell
# 1) Conjunto completo, fixtures adultas, 4 amostras por vídeo, detalhado
node scripts/verificar-yolo-nsfw.mjs --conjunto --fixtures-nsfw --amostras 4 --detalhado

# 2) E2E real do app com o clipe NSFW de 60 s
$env:E2E_WEBCAM_CLIP = "C:\Users\dratz\AppData\Local\Temp\opencode\nsfw-60s.mp4"
npx playwright test e2e/webcam-nsfw.spec.ts --workers=1

# 3) Testes NSFW direcionados
npx vitest run tests/nsfw-onnx.test.ts tests/nsfw-prompt.test.ts `
  tests/nsfw-classifier-adapter.test.ts tests/regras-pose.test.ts `
  tests/motor-temporal.test.ts tests/interpretacao-payload.test.ts `
  tests/local-perception-pipeline.test.ts tests/workers-atender.test.ts `
  tests/motores-remotos.test.ts tests/scripts/verificar-yolo-nsfw.test.mjs

# 4) Suíte completa, lint e typecheck
npm test
npm run lint
npx tsc --noEmit
```

**Ambiente:** Windows, Intel Xeon E5-2660 v3 (10 núcleos / 20 lógicos), 15,8 GB de
RAM, Node v24.19.0, Chromium 156 headless, `onnxruntime-web` em **WASM** (sem
WebGPU), COOP/COEP habilitado (`crossOriginIsolated=true`, `numThreads=4`).

**Pesos:** `modelos/yolonsfw/*.onnx` (gitignored, não versionados).
**Limiar global:** 0,5, com pisos por classe de `public/nsfw-onnx.ts`.

---

## 2. Fixtures usadas

`--fixtures-nsfw` descobre automaticamente os arquivos `nsfw*` de
`bench/imagens/` e `bench/videos/`:

| # | Arquivo | Tipo | Tamanho | Dimensão / duração | Quadros analisados |
|---|---|---|---|---|---|
| 1 | `bench/imagens/nsfw - mulher loira madura de lingerie sexy e strapon sob meia-calça.jpg` | imagem | 81 KB | 721×1085 | 1 |
| 2 | `bench/imagens/nsfw foto 2.png` | imagem | 824 KB | 559×808 | 1 |
| 3 | `bench/imagens/nsfw photo.png` | imagem | 3,8 MB | 2559×1439 | 1 |
| 4 | `bench/videos/nsfw - Mulher jovem e sexy transexual te provoca..mp4` | vídeo | 140 MB | 720×1280, ~709 s | 4 (t = 141,79 / 283,58 / 425,37 / 567,15 s) |

> O E2E usa outro recorte: `nsfw-60s.mp4` (60 s). Os quadros do bench acima vêm
> do vídeo-fonte completo (~11 min 49 s), não do clipe de 60 s. Não misture os
> dois conjuntos de números.
>
> **Confirmado em 2026-11-13:** `nsfw-60s.mp4` é o **primeiro minuto** do
> vídeo-fonte. Extrair 30 quadros do clipe a 1/2 fps e rodar os mesmos modelos
> devolve exatamente as mesmas contagens de `bench/videos/frames-pre60/`
> (`penis` 1, `FEMALE_BREAST_EXPOSED` 36, `FEMALE_GENITALIA_COVERED` 5,
> `FEMALE_GENITALIA_EXPOSED` 2, `vagina` 4).

---

## 3. Resumo por modelo

| Modelo | Carga | Inferência média | Marcações | Memória WASM após inferência |
|---|---:|---:|---:|---:|
| `nudenet_320n` | 1.461 ms | **85 ms/quadro** | 21 | 37,8 MB |
| `nudenet_640m` | 1.907 ms | **1.269 ms/quadro** | 19 | 271,8 MB |
| `erax_nsfw_yolo11n` | 1.468 ms | **195 ms/quadro** | 12 | 61,3 MB |
| `erax_nsfw_yolo11s` | 1.631 ms | **588 ms/quadro** | 11 | 115,8 MB |
| `erax_nsfw_yolo11m` | 1.902 ms | **1.193 ms/quadro** | 19 | 260,1 MB |
| `penis_yolov8m` | 1.923 ms | **1.292 ms/quadro** | **0** (13/130 na varredura pós-60 s; seção 4.5) | 271,8 MB |

- **Total:** 82 marcações em 7 quadros por modelo (42 inferências no total).
- **Soma da memória linear WASM:** 37,8 + 271,8 + 61,3 + 115,8 + 260,1 + 271,8 =
  **~1,02 GB** (piso; não inclui heap JS nem overhead de cada worker).
- **Formas de saída:** `nudenet_320n` = `[1,22,2100]` (4 coordenadas + 18 classes,
  NMS em JS); os demais = `[1,300,6]` (NMS embutido). Nenhum rótulo `classe N`,
  nenhuma caixa fora dos limites, nenhum sigmoid falso no 320n
  (`linhasSigmoid=0`, scores crus entre ~0 e 0,85).

---

## 4. Resultado detalhado por fixture

> **Nota de honestidade:** as descrições de cena abaixo são **inferidas das
> detecções e dos nomes dos arquivos**. Este relatório não faz inspeção visual
> humana; quem julga o acerto é você, comparando as caixas com a imagem.

Caixas em **pixels da imagem original** (`[xmin, ymin, xmax, ymax]`). Scores são
a confiança do próprio modelo, antes da mescla.

### 4.1 Foto 1 — mulher loira de lingerie com strap-on sob meia-calça

**Leitura:** 2 dos 6 modelos reagiram ao objeto fálico, ambos no piso da classe.
Os outros 4 não marcaram nada. É um **acerto parcial e fraco**, não um acerto
limpo.

| Modelo | Rótulo | Score | Caixa |
|---|---|---:|---|
| `nudenet_320n` | `MALE_GENITALIA_EXPOSED` | 0,2700 | [108,3, 688,5, 295,1, 838,7] |
| `erax_nsfw_yolo11s` | `penis` | 0,2540 | [62,2, 584,5, 372,1, 952,5] |
| `nudenet_640m` | — | — | nenhuma |
| `erax_nsfw_yolo11n` | — | — | nenhuma |
| `erax_nsfw_yolo11m` | — | — | nenhuma |
| `penis_yolov8m` | — | — | nenhuma |

Observações:
- As duas caixas cobrem a mesma região inferior do corpo (quadril/entrepernas);
  há concordância de **região**, não de rótulo. `MALE_GENITALIA_EXPOSED` é o
  rótulo errado para um strap-on; `penis` é semanticamente mais próximo.
- Ambos os scores estão logo acima do piso (`MALE_GENITALIA_EXPOSED` = 0,20;
  `penis` = 0,25). O `nudenet_320n` viu a região, mas com confiança baixa.

### 4.2 Foto 2 — detecções compatíveis com cena explícita de casal

**Leitura:** **acordo forte entre os modelos**. Todos os 5 detectores de corpo
acharam a mesma dupla de seios, a mesma genitália feminina e a mesma região
pélvica; os três EraX concordam em `make_love` e `penis`. É o caso mais bem
coberto do teste.

| Modelo | Rótulo | Score | Caixa |
|---|---|---:|---|
| `nudenet_320n` | `FEMALE_BREAST_EXPOSED` | 0,8070 | [212,8, 226,6, 329,4, 341,3] |
| `nudenet_320n` | `MALE_GENITALIA_EXPOSED` | 0,7580 | [121,3, 499,0, 292,2, 783,1] |
| `nudenet_320n` | `FEMALE_BREAST_EXPOSED` | 0,7500 | [375,2, 240,9, 488,9, 344,4] |
| `nudenet_320n` | `FEMALE_GENITALIA_EXPOSED` | 0,6700 | [228,5, 380,0, 310,1, 522,2] |
| `nudenet_320n` | `BUTTOCKS_EXPOSED` | 0,2080 | [128,3, 472,9, 419,1, 658,6] |
| `nudenet_640m` | `FEMALE_BREAST_EXPOSED` | 0,8440 | [211,7, 233,1, 332,5, 335,0] |
| `nudenet_640m` | `FEMALE_BREAST_EXPOSED` | 0,7950 | [374,1, 245,8, 492,9, 339,4] |
| `nudenet_640m` | `FEMALE_GENITALIA_EXPOSED` | 0,7900 | [230,5, 389,7, 310,9, 516,1] |
| `nudenet_640m` | `MALE_GENITALIA_EXPOSED` | 0,7660 | [124,9, 503,1, 291,4, 766,7] |
| `erax_nsfw_yolo11n` | `make_love` | 0,6440 | [0,0, 0,0, 558,6, 803,4] |
| `erax_nsfw_yolo11n` | `nipple` | 0,5640 | [211,7, 220,5, 324,9, 333,3] |
| `erax_nsfw_yolo11n` | `penis` | 0,4450 | [20,8, 440,9, 398,3, 808,0] |
| `erax_nsfw_yolo11n` | `vagina` | 0,4190 | [145,3, 329,8, 396,3, 560,3] |
| `erax_nsfw_yolo11n` | `vagina` | 0,2570 | [171,9, 344,5, 375,6, 536,1] |
| `erax_nsfw_yolo11s` | `make_love` | 0,7800 | [0,3, 2,8, 559,0, 808,0] |
| `erax_nsfw_yolo11s` | `nipple` | 0,6770 | [208,9, 218,9, 331,1, 336,1] |
| `erax_nsfw_yolo11s` | `penis` | 0,6240 | [12,8, 446,1, 405,8, 808,0] |
| `erax_nsfw_yolo11s` | `nipple` | 0,5810 | [390,5, 228,2, 519,3, 355,5] |
| `erax_nsfw_yolo11s` | `vagina` | 0,3500 | [134,9, 350,2, 403,8, 575,7] |
| `erax_nsfw_yolo11m` | `make_love` | 0,7610 | [0,2, 0,9, 559,0, 808,0] |
| `erax_nsfw_yolo11m` | `nipple` | 0,5910 | [213,1, 213,4, 331,3, 342,6] |
| `erax_nsfw_yolo11m` | `penis` | 0,5120 | [29,8, 447,3, 419,4, 808,0] |
| `erax_nsfw_yolo11m` | `nipple` | 0,5090 | [395,2, 225,7, 515,9, 357,9] |
| `erax_nsfw_yolo11m` | `vagina` | 0,4190 | [144,7, 337,7, 408,6, 570,9] |
| `penis_yolov8m` | — | — | nenhuma |

Concordância de região (caixas quase idênticas):
- **Seio esquerdo:** 320n `[212,8…]`, 640m `[211,7…]`, 11n/11s/11m `nipple`
  `[211,7…]`/`[208,9…]`/`[213,1…]`.
- **Seio direito:** 320n `[375,2…]`, 640m `[374,1…]`, 11s/11m `nipple`
  `[390,5…]`/`[395,2…]`.
- **Genitália feminina:** 320n `[228,5,380,310,1,522,2]`, 640m
  `[230,5,389,7,310,9,516,1]`, 11n/11s/11m `vagina` `[145…]/[134…]/[144…]`.
- **Região pélvica/masculina:** 320n `[121,3,499,292,2,783,1]`, 640m
  `[124,9,503,1,291,4,766,7]`, 11n/11s/11m `penis` `[20…]/[12…]/[29…]`.

O `make_love` só existe no EraX e cobre a imagem inteira; é ação, não anatomia.
É exatamente a complementaridade pretendida.

### 4.3 Foto 3 — detecções compatíveis com duas pessoas em close

**Leitura:** acordo forte no lado direito (seios + genitália feminina) e
**conflito de rótulo no lado esquerdo**: o EraX nano/small chama a mesma região de
`vagina`, o EraX medium chama de `penis`, e o NudeNet 640m dá
`MALE_GENITALIA_EXPOSED` com score baixo. O `nudenet_320n` também vê genitália
feminina no lado esquerdo. **Não dá para declarar acerto de rótulo nessa figura
sem olhar a imagem.**

| Modelo | Rótulo | Score | Caixa |
|---|---|---:|---|
| `nudenet_320n` | `FEMALE_BREAST_EXPOSED` | 0,7730 | [90,9, 933,4, 292,8, 1075,8] |
| `nudenet_320n` | `FEMALE_BREAST_EXPOSED` | 0,5850 | [0,5, 952,2, 117,3, 1077,5] |
| `nudenet_320n` | `FEMALE_GENITALIA_EXPOSED` | 0,2370 | [116,3, 1213,5, 238,8, 1294,0] |
| `nudenet_640m` | `FEMALE_BREAST_EXPOSED` | 0,8310 | [100,0, 934,3, 283,4, 1077,9] |
| `nudenet_640m` | `FEMALE_BREAST_EXPOSED` | 0,7900 | [0,0, 949,4, 118,7, 1081,6] |
| `nudenet_640m` | `FEMALE_BREAST_EXPOSED` | 0,7590 | [1803,8, 627,1, 1899,4, 696,9] |
| `nudenet_640m` | `FEMALE_BREAST_EXPOSED` | 0,5900 | [1743,0, 624,4, 1816,9, 686,0] |
| `nudenet_640m` | `FEMALE_GENITALIA_EXPOSED` | 0,5570 | [1777,3, 799,5, 1831,1, 844,2] |
| `nudenet_640m` | `MALE_GENITALIA_EXPOSED` | 0,2550 | [123,6, 1223,2, 245,7, 1363,7] |
| `erax_nsfw_yolo11n` | `vagina` | 0,3080 | [2,2, 1145,5, 382,0, 1379,6] |
| `erax_nsfw_yolo11s` | `vagina` | 0,3160 | [27,7, 1149,4, 351,2, 1352,7] |
| `erax_nsfw_yolo11m` | `penis` | 0,5970 | [20,2, 1173,4, 367,4, 1407,2] |
| `erax_nsfw_yolo11m` | `vagina` | 0,3570 | [1710,2, 745,7, 1930,4, 895,1] |
| `penis_yolov8m` | — | — | nenhuma |

Observações:
- Lado esquerdo: as caixas de `vagina` (11n/11s) e `penis` (11m) são praticamente
  a mesma região (`x ≈ 2–28` até `x ≈ 351–382`, `y ≈ 1145–1173` até
  `y ≈ 1352–1407`). O 640m dá `MALE_GENITALIA_EXPOSED` dentro dessa região
  (`[123,6,1223,2,245,7,1363,7]`, score 0,255). O 320n dá
  `FEMALE_GENITALIA_EXPOSED` nessa mesma faixa (score 0,237). **É conflito de
  rótulo, não de localização.**
- Lado direito: 640m vê seios (`[1743…]`/`[1803…]`) e genitália feminina
  (`[1777,3,799,5,1831,1,844,2]`); o 11m vê `vagina` na mesma faixa
  (`[1710,2,745,7,1930,4,895,1]`). Concordância de região.
- O `penis_yolov8m` não marcou nem a região que o EraX chamou de `penis`.

### 4.4 Vídeo — mulher trans (declarada no título) provocando

**Leitura:** **acordo forte e estável** em seios/mamilos e na região genital
inferior nos 4 quadros. Nenhum modelo marcou `penis` nesses quadros — o que
**não prova ausência**: o `penis_yolov8m` já marcou 0,304 em outro clipe, no
t=1,5 s. O título declara a identidade (mulher trans); os modelos detectam
anatomia, não identidade.

| Quadro | Modelo | Rótulo | Score | Caixa |
|---|---|---|---:|---|
| t=141,79 s | `nudenet_320n` | `FEMALE_BREAST_EXPOSED` | 0,8290 | [364,9, 555,0, 511,6, 754,5] |
| t=141,79 s | `nudenet_320n` | `FEMALE_BREAST_EXPOSED` | 0,8080 | [182,8, 515,5, 345,1, 735,7] |
| t=141,79 s | `nudenet_320n` | `FEMALE_GENITALIA_EXPOSED` | 0,5170 | [262,5, 956,1, 394,2, 1155,0] |
| t=141,79 s | `nudenet_640m` | `FEMALE_BREAST_EXPOSED` | 0,8480 | [366,8, 581,0, 506,0, 731,1] |
| t=141,79 s | `nudenet_640m` | `FEMALE_BREAST_EXPOSED` | 0,8380 | [191,8, 552,2, 344,6, 704,3] |
| t=141,79 s | `erax_nsfw_yolo11n` | `vagina` | 0,4480 | [137,5, 831,0, 519,4, 1277,3] |
| t=141,79 s | `erax_nsfw_yolo11s` | `vagina` | 0,5630 | [137,5, 841,5, 507,8, 1275,2] |
| t=141,79 s | `erax_nsfw_yolo11m` | `nipple` | 0,6360 | [376,3, 567,4, 531,5, 744,8] |
| t=141,79 s | `erax_nsfw_yolo11m` | `nipple` | 0,5550 | [168,3, 525,1, 339,1, 723,9] |
| t=141,79 s | `erax_nsfw_yolo11m` | `vagina` | 0,5090 | [115,7, 822,2, 527,9, 1279,5] |
| t=283,58 s | `nudenet_320n` | `FEMALE_BREAST_EXPOSED` | 0,8060 | [362,9, 563,8, 508,3, 753,9] |
| t=283,58 s | `nudenet_320n` | `FEMALE_BREAST_EXPOSED` | 0,7600 | [187,3, 521,3, 353,6, 724,3] |
| t=283,58 s | `nudenet_320n` | `FEMALE_GENITALIA_EXPOSED` | 0,4290 | [264,0, 975,9, 397,7, 1168,9] |
| t=283,58 s | `nudenet_640m` | `FEMALE_BREAST_EXPOSED` | 0,8560 | [367,7, 588,9, 502,7, 738,6] |
| t=283,58 s | `nudenet_640m` | `FEMALE_BREAST_EXPOSED` | 0,8250 | [197,3, 555,1, 346,4, 696,2] |
| t=283,58 s | `nudenet_640m` | `FEMALE_GENITALIA_EXPOSED` | 0,2690 | [267,4, 989,3, 384,4, 1167,7] |
| t=283,58 s | `erax_nsfw_yolo11n` | `vagina` | 0,5380 | [115,7, 805,8, 539,7, 1277,1] |
| t=283,58 s | `erax_nsfw_yolo11n` | `nipple` | 0,5010 | [376,6, 571,2, 533,7, 752,9] |
| t=283,58 s | `erax_nsfw_yolo11s` | `vagina` | 0,5560 | [135,8, 824,6, 529,8, 1276,5] |
| t=283,58 s | `erax_nsfw_yolo11m` | `nipple` | 0,5670 | [372,6, 575,0, 534,5, 753,8] |
| t=283,58 s | `erax_nsfw_yolo11m` | `nipple` | 0,5380 | [171,4, 526,3, 342,8, 716,2] |
| t=283,58 s | `erax_nsfw_yolo11m` | `vagina` | 0,5230 | [111,0, 820,5, 528,8, 1279,1] |
| t=425,37 s | `nudenet_320n` | `FEMALE_BREAST_EXPOSED` | 0,7930 | [370,2, 566,6, 509,5, 732,1] |
| t=425,37 s | `nudenet_320n` | `FEMALE_BREAST_EXPOSED` | 0,7410 | [190,1, 536,6, 347,1, 696,8] |
| t=425,37 s | `nudenet_320n` | `FEMALE_GENITALIA_EXPOSED` | 0,4090 | [272,6, 979,2, 409,4, 1169,5] |
| t=425,37 s | `nudenet_640m` | `FEMALE_BREAST_EXPOSED` | 0,8550 | [373,7, 578,6, 504,7, 726,3] |
| t=425,37 s | `nudenet_640m` | `FEMALE_BREAST_EXPOSED` | 0,8300 | [195,9, 546,5, 347,7, 691,5] |
| t=425,37 s | `erax_nsfw_yolo11n` | `vagina` | 0,4070 | [128,3, 843,0, 533,2, 1276,3] |
| t=425,37 s | `erax_nsfw_yolo11s` | `vagina` | 0,6130 | [146,4, 846,9, 527,9, 1263,7] |
| t=425,37 s | `erax_nsfw_yolo11m` | `nipple` | 0,6360 | [374,4, 573,0, 539,3, 733,1] |
| t=425,37 s | `erax_nsfw_yolo11m` | `nipple` | 0,5590 | [168,2, 530,8, 347,7, 696,9] |
| t=425,37 s | `erax_nsfw_yolo11m` | `vagina` | 0,5410 | [84,2, 825,7, 573,7, 1279,4] |
| t=567,15 s | `nudenet_320n` | `FEMALE_BREAST_EXPOSED` | 0,8370 | [370,3, 553,3, 520,9, 761,7] |
| t=567,15 s | `nudenet_320n` | `FEMALE_BREAST_EXPOSED` | 0,8020 | [202,7, 504,3, 363,7, 717,7] |
| t=567,15 s | `nudenet_320n` | `FEMALE_GENITALIA_EXPOSED` | 0,3760 | [257,8, 1010,1, 381,4, 1171,4] |
| t=567,15 s | `nudenet_640m` | `FEMALE_BREAST_EXPOSED` | 0,8600 | [376,3, 581,2, 515,6, 743,6] |
| t=567,15 s | `nudenet_640m` | `FEMALE_BREAST_EXPOSED` | 0,8450 | [207,5, 537,9, 360,6, 695,7] |
| t=567,15 s | `erax_nsfw_yolo11n` | `nipple` | 0,5740 | [377,9, 569,2, 549,0, 756,9] |
| t=567,15 s | `erax_nsfw_yolo11n` | `vagina` | 0,4700 | [106,2, 823,3, 529,6, 1278,7] |
| t=567,15 s | `erax_nsfw_yolo11s` | `vagina` | 0,5500 | [93,6, 828,0, 525,8, 1279,3] |
| t=567,15 s | `erax_nsfw_yolo11m` | `nipple` | 0,6020 | [382,1, 574,6, 544,2, 758,0] |
| t=567,15 s | `erax_nsfw_yolo11m` | `nipple` | 0,5630 | [185,2, 516,7, 355,8, 710,1] |
| t=567,15 s | `erax_nsfw_yolo11m` | `vagina` | 0,4960 | [99,9, 841,2, 522,6, 1279,3] |

Concordância de região:
- **Seios:** 320n e 640m dão caixas quase idênticas nos 4 quadros (diferença de
  poucos pixels). O 11m cobre os mesmos seios como `nipple`.
- **Região genital inferior:** 320n/640m dão caixas estreitas (`x ≈ 257–397`,
  `y ≈ 956–1171`); EraX 11n/11s/11m dão caixas largas (`x ≈ 84–574`,
  `y ≈ 805–1279`). É a mesma região, com enquadramentos diferentes.
- **Estabilidade temporal:** os scores de seio ficam em 0,74–0,86 e os de
  vagina em 0,41–0,61 nos 4 quadros; não há oscilação errática.
- **`penis`:** 0 marcações nos 4 quadros amostrados. O `penis_yolov8m` também 0
  **nesses 4 quadros**, mas dispara em outros instantes do mesmo vídeo — ver
  seção 4.5. A ausência aqui era **artefato de amostragem**, não do modelo.

---

### 4.5 Varredura temporal pós-60 s (2026-11-13)

Motivo: o usuário garantiu que há pênis no vídeo. Os 4 quadros da seção 4.4 não
continham o órgão, então a conclusão anterior ("0 `penis`") estava limitada pela
amostra. Esta varredura extrai quadros a **1/5 s** de `t=60 s` até o fim
(~705 s) — 130 quadros — e roda os modelos separadamente.

```powershell
# quadros: bench/videos/frames-pos60/frame-0001..0130.jpg  (t = 60 + (n-1)*5 s)
node scripts/verificar-yolo-nsfw.mjs penis_yolov8m  @frames --detalhado
node scripts/verificar-yolo-nsfw.mjs erax_nsfw_yolo11n @frames --detalhado
node scripts/verificar-yolo-nsfw.mjs nudenet_320n    @frames --detalhado
# os outros três (640m, 11s, 11m) rodaram os mesmos 130 quadros
```

**Resultado: SIM, foi detectado.** Pênis/genitália masculina apareceu em 6 dos 6
modelos, em instantes diferentes:

| Instante | Modelo | Rótulo | Score | Caixa (px) |
|---:|---|---|---:|---|
| **t=250 s** | `nudenet_320n` | `MALE_GENITALIA_EXPOSED` | **0,584** | [361,9, 965,7, 521,4, 1185,4] |
| **t=250 s** | `nudenet_640m` | `MALE_GENITALIA_EXPOSED` | **0,565** | [367,4, 978,7, 509,8, 1175,6] |
| **t=250 s** | `erax_nsfw_yolo11s` | `penis` | **0,475** | [149,9, 811,0, 618,3, 1278,8] |
| **t=250 s** | `erax_nsfw_yolo11m` | `penis` | 0,256 | [204,0, 840,0, 599,6, 1273,0] |
| **t=250 s** | `erax_nsfw_yolo11n` | `penis` | 0,253 | [131,3, 806,1, 621,3, 1279,8] |
| t=145 s | `erax_nsfw_yolo11s` | `penis` | 0,268 | [130,4, 831,0, 515,4, 1276,0] |
| t=310 s | `erax_nsfw_yolo11s` | `penis` | 0,286 | [128,1, 824,2, 509,7, 1269,3] |
| t=380 s | `nudenet_640m` | `MALE_GENITALIA_EXPOSED` | 0,267 | [294,1, 885,4, 449,4, 1089,0] |
| t=595 s | `erax_nsfw_yolo11n` | `penis` | **0,444** | [133,5, 796,9, 551,8, 1270,1] |
| t=595 s | `erax_nsfw_yolo11m` | `penis` | 0,343 | [107,0, 781,8, 550,6, 1274,9] |
| t=615 s | `erax_nsfw_yolo11n` | `penis` | 0,310 | [90,2, 758,5, 565,6, 1275,3] |
| t=655 s | `erax_nsfw_yolo11n` | `penis` | 0,266 | [93,4, 813,0, 558,7, 1277,3] |
| t=80 s | `penis_yolov8m` | `penis` | 0,414 | [0,0, 0,0, 199,2, 1280,0] |
| t=110 s | `penis_yolov8m` | `penis` | 0,371 | [0,0, 90,4, 498,2, 1280,0] |
| t=350 s | `penis_yolov8m` | `penis` | 0,381 | [1,7, 89,2, 554,5, 1248,1] |
| t=490 s | `penis_yolov8m` | `penis` | **0,425** | [0,0, 200,5, 604,8, 1261,7] |
| t=550 s | `penis_yolov8m` | `penis` | 0,324 | [0,0, 166,4, 595,6, 1241,6] |

O `penis_yolov8m` mostra os picos acima; os outros 8 quadros em que marcou são
t=115, 185, 400, 465, 470, 475, 625 e 630 s (13 quadros, 14 detecções).

Contagens da varredura (130 quadros por modelo):

| Modelo | Quadros com `penis`/`MALE_GENITALIA` | Máximo |
|---|---:|---:|
| `penis_yolov8m` | 13 (14 detecções) | 0,425 |
| `erax_nsfw_yolo11n` | 4 | 0,444 |
| `erax_nsfw_yolo11s` | 3 | 0,475 |
| `erax_nsfw_yolo11m` | 2 | 0,343 |
| `nudenet_640m` | 2 | 0,565 |
| `nudenet_320n` | 1 | 0,584 |

**Primeiro minuto** (30 quadros a 1/2 s, `bench/videos/frames-pre60/`):

| Instante | Modelo | Rótulo | Score | Caixa (px) |
|---:|---|---|---:|---|
| **t=2 s** | `penis_yolov8m` | `penis` | **0,511** | [0,0, 529,4, 526,2, 1113,3] |
| t=16–32 s | `nudenet_320n` | `FEMALE_GENITALIA_COVERED` | 0,206–0,405 | região púbica coberta |
| t=12–38 s | `erax_nsfw_yolo11n` | `vagina` | 0,359–0,418 | região pélvica |

Leitura:
- **t=250 s é o quadro-âncora.** Cinco modelos independentes marcam a mesma
  região pélvica como pênis/genitália masculina no mesmo quadro: os dois NudeNet
  em `MALE_GENITALIA_EXPOSED` e os três EraX em `penis`. As caixas dos dois
  NudeNet são quase idênticas (diferença de ~6 px).
- **t=2 s** é a maior confiança de `penis` em todo o vídeo (0,511), já no
  primeiro minuto — compatível com "volume enquanto vestida".
- **Primeiro minuto também tem `make_love`:** o `erax_nsfw_yolo11n` marca
  `make_love` 0,35–0,55 em 7 quadros (t=12, 22, 34, 42, 44, 46, 52 s). É
  indício de ato sexual em cena, não prova — a regra do projeto exige sequência
  multiframe e evidência visual para concluir ação.
- **Rótulo dominante continua feminino:** no NudeNet 320n, `FEMALE_GENITALIA_EXPOSED`
  aparece em 87 quadros (máx. 0,568) contra 1 de `MALE_GENITALIA_EXPOSED`; no
  640m, 30 contra 2. Os modelos localizam a genitália de forma estável, mas a
  **classificação** tende ao rótulo feminino. É o ponto fraco real, não a
  detecção.
- **`penis_yolov8m` não está morto nem inútil:** 13/130 quadros, sempre na região
  pélvica inferior. As caixas, porém, são **muito maiores** que as dos outros
  modelos (chegam a 605×1061 px num quadro 720×1280), o que piora a
  localização — o rótulo é útil, a caixa não.
- **Sem inspeção visual:** não foi possível abrir os JPEGs neste ambiente. A
  conclusão é sobre **o que os detectores marcaram**, com as caixas acima para
  conferência humana.

---

## 5. Complementaridade observada

Os modelos não são redundantes; cada um cobre classes que os outros não têm:

| Classe / papel | Quem cobre | Evidência neste teste |
|---|---|---|
| `make_love` (ação) | **só EraX** | 0,64–0,78 na foto 2 |
| `MALE_GENITALIA_EXPOSED` | **só NudeNet** | 0,76 na foto 2; 0,27 no strap-on; **0,584 em t=250 s do vídeo** |
| `FEMALE_GENITALIA_COVERED` | **só NudeNet** | 0,206–0,405 no primeiro minuto do vídeo (região púbica coberta) |
| `nipple` | **só EraX** | 0,50–0,68 na foto 2 e no vídeo |
| `penis` dedicado | **`penis_yolov8m`** | 0 nas 4 fixtures, **13/130 na varredura pós-60 s** (máx. 0,425); 0,304 em outro clipe |
| `FEMALE_BREAST_EXPOSED` | NudeNet 320n/640m | 0,74–0,86 no vídeo e na foto 2 |
| `vagina` / `FEMALE_GENITALIA_EXPOSED` | EraX + NudeNet | acordo de região nos 3 primeiros casos |

A mescla do app deduplica **mesmo rótulo + IoU ≥ 0,6**, mantém o maior score e
registra os modelos concordantes em `modelos`. Rótulos diferentes nunca são
suprimidos — é por isso que `MALE_GENITALIA_EXPOSED` (NudeNet) e `penis` (EraX)
aparecem juntos na mesma região da foto 2.

---

## 6. Validação no app (E2E)

`e2e/webcam-nsfw.spec.ts` com `nsfw-60s.mp4` (`--workers=1`): **passou em 31,0 s**.

O teste verifica o caminho real do modo `visao`:

- ligar `#nsfw` mostra **“conjunto NSFW”** no status, sem seletor de modelo;
- os **6 `.onnx`** do conjunto são pedidos, um por worker;
- o `POST /api/visao` leva `nsfw` (array) e `modelo === MODELO_NSFW`
  (`gemma-4-e2b-uncensored-hauhaucs-aggressive`);
- o evento `done` persistido pelo servidor carrega o mesmo `nsfw` e o modelo
  efetivo;
- parar a captura reabilita `#start` (workers/sessões encerrados).

A falha de um modelo não derruba o subsistema; só a falha de todos marca NSFW
indisponível. Isso é coberto por `tests/nsfw-classifier-adapter.test.ts`.

---

## 7. Testes automatizados

| Comando | Resultado |
|---|---|
| suíte NSFW direcionada (10 arquivos) | **178/178** |
| `npm test` (suíte completa) | **854/854** em 55 arquivos |
| `npm run lint` | sem erros |
| `npx tsc --noEmit` | sem erros |

Cobertura NSFW inclui: catálogo/limiares/saída ONNX, montagem do prompt,
mescla/dedupe do conjunto, telemetria/fallback, regras de pose sexual, integração
no motor temporal, payload de interpretação e o próprio script de verificação.

---

## 8. O que acertou e o que não acertou

### Acertou

1. **Encanamento completo:** 6/6 modelos carregam, inferem e devolvem caixas
   válidas; nenhuma caixa fora dos limites; nenhum rótulo desconhecido.
2. **Corpo feminino:** seios, mamilos e genitália feminina são encontrados com
   score alto e caixas estáveis nos 4 quadros do vídeo e na foto 2.
3. **Cena de casal (foto 2):** acordo forte de região e rótulo entre NudeNet e
   EraX para seios, genitália feminina e região pélvica; `make_love` só no EraX.
4. **Complementaridade:** as classes são distribuídas entre os modelos como
   projetado; a mescla preserva rótulos diferentes na mesma região.
5. **E2E:** o app liga o conjunto, baixa os 6 pesos, envia as marcações e
   persiste a entrada com o gemma, sem seletor.

### Não acertou / ficou fraco

1. **`penis_yolov8m` — corrigido em 2026-11-13:** deu **0 marcações nas 7
   inferências** deste teste (42 inferências no total: 6 modelos × 7 quadros),
   mas **não está morto nem inútil**: na varredura pós-60 s (130 quadros) marcou
   **13 quadros** (máx. 0,425), e **0,511 em t=2 s** no primeiro minuto. O zero
   anterior era **artefato dos 4 quadros amostrados**. O defeito real é a
   geometria: caixas grandes demais para localizar o órgão.
2. **Strap-on (foto 1):** só 2/6 modelos reagiram, ambos no piso da classe
   (0,270 e 0,254). O NudeNet usou o rótulo errado (`MALE_GENITALIA_EXPOSED`
   para um strap-on); o EraX usou `penis`, mais próximo. **Acerto parcial.**
3. **Conflito de rótulo na foto 3:** a mesma região do lado esquerdo é `vagina`
   para 11n/11s, `penis` para 11m e `MALE_GENITALIA_EXPOSED` para 640m. A
   localização é concordante; o rótulo não. Sem olhar a imagem, não há como
   declarar qual está certo.
4. **Rótulo genital dominante é feminino:** no vídeo, o NudeNet 320n marca
   `FEMALE_GENITALIA_EXPOSED` em **87 dos 130 quadros** e
   `MALE_GENITALIA_EXPOSED` em **1**. A região é encontrada de forma estável; a
   **classificação** é que pende para o rótulo feminino. Um relatório que só
   olha o rótulo mais frequente diria "genitália feminina" mesmo nos instantes
   em que 5 modelos concordam em pênis (t=250 s).
5. **Amostragem periódica perde disparos isolados:** o app analisa no
   `#interval` (padrão **4 s**). O `penis 0,511` do primeiro minuto ocorre em
   **t=2 s**; a próxima análise (t=4 s) já não o vê. O mesmo vale para t=250 s
   (o pico cai entre amostras de 4 s). Detecção esparsa + amostragem periódica =
   evidência perdida. Isso é comportamento de amostragem, não bug do detector.
6. **Sem ground truth:** não há anotação humana de presença/ausência por classe.
   As 82 marcações são **detecções**, não acertos. Precisão/recall não podem ser
   calculados com este teste.

---

## 9. Limitações explícitas

- **Uma máquina, uma passada.** Sem repetição para variância; os tempos e a
  memória são de uma execução.
- **WASM no Chromium headless, sem WebGPU.** Os números não valem para WebGPU.
- **Memória é piso.** A medição cobre só a memória linear WASM por modelo
  (~1,02 GB somados); heap JS, overhead de cada worker e do processo do
  navegador ficam de fora.
- **Paralelo agregado não medido.** O harness roda um modelo por vez; a parede
  real dos 6 workers simultâneos no app é faixa derivada, não medida.
- **Quadros do vídeo-fonte, não do clipe de 60 s.** O bench amostra t = 141,79 /
  283,58 / 425,37 / 567,15 s do vídeo de ~709 s; o E2E usa `nsfw-60s.mp4`
  (confirmado como o primeiro minuto).
- **Sem inspeção visual nesta varredura.** Os JPEGs não foram abertos por um
  humano nem pelo agente; as conclusões da seção 4.5 são sobre marcações e
  caixas, não sobre o conteúdo visto.
- **Amostragem periódica.** A varredura usa 1 quadro a cada 5 s (pós-60 s) e
  1 a cada 2 s (primeiro minuto). Disparos entre esses instantes não são vistos.
  O app usa intervalo padrão de 4 s, ainda mais grosso.
- **Sem anotação humana.** Não há como afirmar ação sexual, identidade de gênero
  ou presença/ausência de órgão a partir das marcações. Identidade “trans” só
  aparece aqui porque o **título do arquivo** a declara; os modelos detectam
  anatomia, não identidade.
- **O conjunto não é moderador.** As marcações são sinal para o prompt; a
  resposta do VLM é descritiva e não censurada.

---

## 10. Como conferir você mesmo

1. Abra as imagens em `bench/imagens/` e compare as caixas acima (coordenadas em
   pixels da imagem original).
2. Para o vídeo, extraia quadros em t = 141,79 / 283,58 / 425,37 / 567,15 s ou
   rode `node scripts/verificar-yolo-nsfw.mjs --conjunto --fixtures-nsfw
   --amostras 4 --detalhado` de novo.
3. Para reproduzir a varredura pós-60 s (seção 4.5):
   ```powershell
   ffmpeg -ss 60 -i "bench/videos/nsfw - Mulher jovem e sexy transexual te provoca..mp4" `
     -vf "fps=1/5" -q:v 2 "bench/videos/frames-pos60/frame-%04d.jpg"
   $frames = Get-ChildItem "bench/videos/frames-pos60" -Filter *.jpg | ForEach-Object FullName
   node scripts/verificar-yolo-nsfw.mjs nudenet_320n   @frames --detalhado
   node scripts/verificar-yolo-nsfw.mjs erax_nsfw_yolo11n @frames --detalhado
   node scripts/verificar-yolo-nsfw.mjs penis_yolov8m  @frames --detalhado
   ```
   Confira o quadro `frame-0039.jpg` (t=250 s) — é onde 5 modelos concordam.
4. O que julgar:
   - a caixa cai sobre a parte certa do corpo?
   - o rótulo descreve o que está visível?
   - o score é compatível com a certeza visual?
   - o modelo que deveria pegar (ex.: `penis_yolov8m`) pegou?

Se a resposta for “não” em algum caso, o próximo passo é calibrar o piso da
classe ou trocar o modelo — não aumentar o número de marcações sem evidência.
