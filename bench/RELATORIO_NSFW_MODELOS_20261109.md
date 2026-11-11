# Relatório — comparação de modelos NSFW (EraX × NudeNet 320n × NudeNet 640m)

> **Nota (2026-11-11):** este relatório descreve a fase de comparação com um
> modelo por vez e o seletor `#modeloNsfw`. O seletor foi removido: hoje o toggle
> NSFW carrega automaticamente o conjunto completo (incluindo `penis_yolov8m`).
> Para o custo e o comportamento atuais, ver
> [`RELATORIO_NSFW_CONJUNTO_20261111.md`](./RELATORIO_NSFW_CONJUNTO_20261111.md).

**Data:** 2026-11-10
**Harness:** `scripts/verificar-yolo-nsfw.mjs` (Chromium headless, `onnxruntime-web` em WASM, sem servidor de app)
**Limiar global:** 0,5 · **limiares por classe** de `public/nsfw-onnx.ts`
**Classes ignoradas:** `FACE_*`, `FEET_*`, `BELLY_*`, `ARMPITS_*` (filtradas antes do payload)
**Pesos:** `modelos/yolonsfw/` (gitignored; não versionados)

## Como foi medido

O verificador reproduz o pré/pós-processamento do cliente: stretch quadrado,
`/255`, NCHW RGB, `[1,3,lado,lado]`; saída NMS `[1,300,6]` (EraX, 640m) ou crua
`[1,22,N]` (320n) com NMS por rótulo em JS (IoU 0,45) e caixas na resolução
original. Cada execução é uma sessão nova: a latência de carga inclui criação da
sessão WASM, e a latência por quadro inclui só `sessão.run`.

Comando:

```powershell
node scripts/verificar-yolo-nsfw.mjs nudenet_320n "bench/imagens/nsfw foto 2.png" --detalhado
node scripts/verificar-yolo-nsfw.mjs <modelo> <video.mp4> --amostras 12
```

Correções no harness necessárias para os números valerem:

1. **Sigmoid decidido pelo tensor inteiro.** A saída do 320n já é probabilidade,
   mas float32 gera resíduos como `-5,96e-8`. A decisão por linha disparava
   `sigmoid(0) = 0,5` em 37 de 2.100 linhas e criava falsos positivos exatos em
   0,500 (`FACE_MALE`, `ARMPITS_EXPOSED`, `MALE_BREAST_EXPOSED`). Agora a decisão
   é do tensor todo, com tolerância `1e-3` — no cliente e no verificador.
2. **Seek de vídeo com `Range`.** O servidor de fixtures respondia 200 sem
   `accept-ranges`; o Chrome não conseguia reposicionar e todas as amostras
   devolviam o primeiro quadro (6 amostras com assinatura idêntica). Com 206 +
   `content-range`, as amostras passaram a variar.
3. **Frame realmente pintado.** `seeked` resolve antes da composição; o vídeo
   agora fica anexado ao DOM e a espera usa `requestVideoFrameCallback`.
4. **Assinatura de frame** (`--detalhado`) para detectar regressão desse tipo.

## Imagens do bench

Marcações pós-filtro (classes não sensíveis removidas), com o limiar por classe
já aplicado. Entre parênteses, o score.

### `bench/imagens/nsfw foto 2.png` (559×808)

| Modelo | Carga | Inferência | Marcações |
|---|---|---|---|
| EraX nano | 1.525 ms | 753 ms | `make_love` 0,644 (imagem inteira), `nipple` 0,564, `penis` 0,445, `vagina` 0,419 e 0,257 |
| NudeNet 320n | 1.475 ms | 365 ms | `FEMALE_BREAST_EXPOSED` 0,807 e 0,750, `MALE_GENITALIA_EXPOSED` 0,758, `FEMALE_GENITALIA_EXPOSED` 0,670, `BUTTOCKS_EXPOSED` 0,208 |
| NudeNet 640m | 1.903 ms | 4.726 ms | `FEMALE_BREAST_EXPOSED` 0,844 e 0,795, `FEMALE_GENITALIA_EXPOSED` 0,790, `MALE_GENITALIA_EXPOSED` 0,766 |

Os três concordam em seios e genitália. O EraX chama a cena inteira de
`make_love` a 0,644 — o rótulo de ação dispara em quadro estático e não deve ser
lido como certeza.

### `bench/imagens/nsfw photo.png` (2559×1439, duas pessoas)

| Modelo | Carga | Inferência | Marcações |
|---|---|---|---|
| EraX nano | 1.525 ms | 482 ms | `vagina` 0,308 (uma pessoa) |
| NudeNet 320n | 1.475 ms | 142 ms | `FEMALE_BREAST_EXPOSED` 0,773 e 0,585, `FEMALE_GENITALIA_EXPOSED` 0,237 |
| NudeNet 640m | 1.903 ms | 4.628 ms | 4× `FEMALE_BREAST_EXPOSED` (0,831/0,790/0,759/0,590), `FEMALE_GENITALIA_EXPOSED` 0,557, `MALE_GENITALIA_EXPOSED` 0,255 |

O 640m é o único que recupera a segunda pessoa (seios a 0,759 e 0,590 e
genitália a 0,557 no canto direito, x ≈ 1743–1899); o 320n fica só na pessoa da
esquerda (seios 0,773 e 0,585, genitália 0,237) e o EraX só vê uma `vagina` na
mesma pessoa da esquerda.

### `bench/imagens/nsfw - mulher loira ... strapon sob meia-calça.jpg` (721×1085)

| Modelo | Carga | Inferência | Marcações |
|---|---|---|---|
| EraX nano | 1.525 ms | 473 ms | nenhuma |
| NudeNet 320n | 1.475 ms | 143 ms | `MALE_GENITALIA_EXPOSED` 0,270 |
| NudeNet 640m | 1.903 ms | 4.757 ms | nenhuma |

Caso que motivou o catálogo: o EraX não tem classe para o objeto fálico sob a
meia-calça e devolve zero; o 320n marca a região a 0,270 (acima do piso 0,20 da
classe). O 640m, com NMS de 300 caixas, perde o objeto.

## Vídeo de referência

`bench/videos/nsfw - Mulher jovem e sexy transexual te provoca..mp4`
(720×1280, ~11 min). Amostragem uniforme, 12 quadros em t = 54,5 s … 654,4 s.

| Modelo | Carga | Inferência/quadro | Marcações em 12 quadros |
|---|---|---|---|
| EraX nano | 1.465 ms | 458–676 ms | 20: `vagina` 11/12, `nipple` 7/12, `make_love` 2/12 (um deles na imagem inteira a 0,367) |
| NudeNet 320n | 1.554 ms | 141–314 ms | 31 pós-filtro: `FEMALE_BREAST_EXPOSED` 22, `FEMALE_GENITALIA_EXPOSED` 9/12 |
| NudeNet 640m | — | 4,6–4,9 s | avaliado em 5 quadros (t = 250–270 s) por custo; ver abaixo |

### Janela t = 250–270 s (mesmos 5 quadros nos três modelos)

| t | EraX nano | NudeNet 320n | NudeNet 640m |
|---|---|---|---|
| 250 s | `make_love` 0,463 (imagem inteira) | — | `FEMALE_BREAST_EXPOSED` 0,723 |
| 255 s | `vagina` 0,467 | `FEMALE_BREAST_EXPOSED` 0,784 e 0,730, **`MALE_GENITALIA_EXPOSED` 0,501** | `FEMALE_BREAST_EXPOSED` 0,851 e 0,782, **`MALE_GENITALIA_EXPOSED` 0,479** |
| 260 s | `nipple` 0,602 e 0,528, `vagina` 0,505 | `FEMALE_BREAST_EXPOSED` 0,834 e 0,726 | `FEMALE_BREAST_EXPOSED` 0,869 e 0,837, `FEMALE_GENITALIA_COVERED` 0,265 |
| 265 s | — | `FEMALE_BREAST_EXPOSED` 0,848 e 0,824 | `FEMALE_BREAST_EXPOSED` 0,856 e 0,829 |
| 270 s | `nipple` 0,586 e 0,524, `vagina` 0,423 | `FEMALE_BREAST_EXPOSED` 0,794 e 0,765 | `FEMALE_BREAST_EXPOSED` 0,836 e 0,744 |

Em t = 255 s o 320n e o 640m marcam a **mesma caixa** de genitália masculina
(320n: `[357,7, 952,8, 500,1, 1152,9]` a 0,501; 640m: `[362,1, 970,9, 496,4,
1132,5]` a 0,479). O EraX não tem essa classe e, no quadro, só devolve `vagina`.
Essa concordância entre dois modelos independentes é a evidência mais forte do
conjunto de que o achado é real — e é exatamente a lacuna registrada no plano.

O `FEMALE_GENITALIA_COVERED` 0,265 do 640m em t = 260 s não aparece no 320n
(abaixo do piso 0,15 da classe). O 320n também não marca calcinha em nenhum dos
12 quadros amostrados.

## Leitura dos números

- **Latência:** o 320n é 3–5× mais rápido por quadro que o EraX nano e ~30× mais
  rápido que o 640m. Em 4 quadros por ciclo, 320n ≈ 0,6 s; EraX ≈ 2,4 s; 640m
  ≈ 19 s.
- **Carga:** os três ficam entre 1,5 s e 2,1 s (sessão WASM nova por execução).
  O 640m tem 104 MB de pesos contra 12,2 MB do 320n.
- **Cobertura de classes:** só o NudeNet tem genitália masculina, genitália
  coberta, ânus coberto, nádegas e seios cobertos. O EraX tem `make_love`, que
  na prática dispara em imagem estática e serve apenas como indício.
- **Recall aparente:** 320n ≥ EraX nos três casos difíceis (pênis no vídeo,
  strapon, segunda pessoa). 640m ganha em imagem ampla com pessoas pequenas,
  mas perde o strapon e é inviável em tempo real.

## Limites explícitos

- **Não há anotação humana de ground truth nesta rodada.** Recall e falso
  positivo aqui são concordância entre modelos e inspeção das caixas, não
  precisão/recall medidos. O caso de t = 255 s é o único com concordância
  espacial entre dois modelos independentes.
- Uma passada, um vídeo, uma máquina (Windows, Chromium, CPU/WASM). Não há
  repetição para variância nem comparação com WebGPU.
- Limiares (0,15–0,5) vêm do plano, não de curva precisão-recall calibrada.
  O piso 0,20 de genitália é o que produz `FEMALE_GENITALIA_EXPOSED` 0,237 em
  `nsfw photo.png` e `MALE_GENITALIA_EXPOSED` 0,270 no strapon; ambos precisam
  de anotação para virar acerto ou falso positivo.
- Contagens são **marcações**, não pessoas: o NMS por rótulo mantém caixas
  sobrepostas de classes diferentes e o mesmo corpo pode gerar 2–3 caixas.
- 640m avaliado em 5 quadros, não em 12: 4,7 s/quadro inviabiliza a amostragem
  completa neste harness.
- **Memória por modelo não foi medida** (Fase 8.1). Não afirmar orçamento de
  threads com base neste relatório.
- O modo `eventos` usa o limiar global da interface; os pisos por classe
  continuam valendo dentro de `avaliar`. Um limiar global alto não esconde
  genitália a 0,20–0,25.

## Validação no app (E2E)

Além do harness isolado, o caminho real do app foi exercitado com o padrão novo
(`e2e/webcam-nsfw.spec.ts`, `--workers=1`):

- o seletor `#modeloNsfw` abre em `nudenet_320n` e o status confirma o modelo;
- o worker pede `/yolonsfw/nudenet_320n.onnx` e o sidecar de classes (asserção
  de rede no teste, não só presença do campo `nsfw`);
- com o clipe NSFW de 60 s, o `POST /api/visao` levou
  `FEMALE_BREAST_COVERED` 0,638 e 0,625 com caixas normalizadas
  (`xmin/ymin/xmax/ymax` em [0,1]), `modelo` =
  `gemma-4-e2b-uncensored-hauhaucs-aggressive`, `erro: null`, 17,2 s;
- com o clipe de webcam sem nudez, `nsfw: []` e nenhum erro de página.

Limite do harness: usar o `.mp4` de 140 MB como `data:` URL estoura o buffer do
pipe do CDP (`Too large read data is pending`, 100 MB). Não é bug do app; para
E2E, recodificar um recorte curto.

## Decisão

Padrão NSFW passa de `erax_nsfw_yolo11n` para **`nudenet_320n`**
(`MODELO_NSFW_PADRAO` em `public/nsfw-onnx.ts` e primeira opção do seletor):

- é mais rápido por quadro, então não degrada o ciclo;
- tem as classes que o caso de uso exige (genitália masculina, genital coberto);
- foi o único a achar o strapon e o único, junto do 640m, a achar pênis no vídeo.

O EraX nano continua selecionável (5 classes, saída NMS, útil como contraponto
rápido). O 640m fica como opção offline de alta resolução, não para tempo real.

## Próximos passos

1. Anotar 30–50 quadros do vídeo e as 3 imagens para medir precisão/recall reais
   por classe e calibrar os pisos.
2. Medir memória e custo de carga por worker (Fase 8.1/8.5).
3. Rodar o 640m só em quadros-chave (evento) para aproveitar o recall em imagem
   ampla sem pagar 4,7 s por quadro.
4. Testar `FEMALE_GENITALIA_COVERED` do 320n com piso mais baixo em quadros
   anotados como "calcinha" antes de mexer no limiar 0,15.
