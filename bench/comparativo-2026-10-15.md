# Comparativo de modelos de visão (2026-10-15)

Registro de evidência por trás da escolha do modelo de visão do Neuro Vision.
Mede **dois modelos instalados** na mesma máquina, no mesmo conjunto de imagens
e com o mesmo `max_tokens`, e documenta **os problemas encontrados e como foram
resolvidos** — inclusive os que invalidaram medições anteriores.

## Como reproduzir

```bash
node scripts/benchmark.mjs --base-url http://127.0.0.1:1235 \
  --model qwen2.5-vl-3b-instruct \
  --model gemma-4-e2b-uncensored-hauhaucs-aggressive
```

Qualidade (frames reais, uma chamada por frame): ver a sonda descrita em
[Qualidade](#qualidade) — mesma URL base e os mesmos prompts do app
(`montarPromptDescricao`).

## Ambiente

- **Backend:** LM Studio em `http://127.0.0.1:1235` (o padrão do código é a porta
  `1234`; o `.env` local aponta para `1235`).
- **Imagens:** `bench/imagens/` (2 cenas sintéticas: 1280×720 e 640×480).
- **Iterações:** 3 · **`max_tokens`:** 1024
- **Máquina:** Intel(R) Xeon(R) CPU E5-2660 v3 @ 2.60GHz (20 núcleos lógicos),
  15,8 GB RAM, Windows 10 (10.0.26200), Node v24.19.0.
- **Memória:** o LM Studio mantém **um único modelo carregado por vez**
  (`GET /api/v0/models` mostra `state=loaded` em um e `not-loaded` nos outros).
  O benchmark carrega os modelos em sequência; não há dois modelos residentes.
  Cada troca de modelo custa ~20–30 s (aparece na 1ª chamada de cada bloco).

## Desempenho

| Modelo | Carga | Responde? | Texto (tok/s) | Visão (tok/s) | Prefill (tok/s) | 1ª resposta (ms) | Total (ms) | Inferências/min | Intervalo mínimo (s) |
|---|---|---|---|---|---|---|---|---|---|
| `qwen2.5-vl-3b-instruct` | 27,7 s | sim (6/6) | 64,6 | 61,8 | 9606,5 | 84 | 737 | 30 | 2 |
| `gemma-4-e2b-uncensored-hauhaucs-aggressive` | 20,3 s | sim (6/6) | 47,7 | 46,9 | 1467,0 | 6316 | 7184 | 5,5 | 9 |

Leitura:

- **`qwen2.5-vl-3b-instruct`** sustenta o fluxo de webcam: responde em todas as
  tentativas, gera a ~62 tok/s e fecha uma análise em ~0,7 s. Com o intervalo
  mínimo de 2 s o cliente roda a ~30 inferências/min.
- **`gemma-4-e2b-uncensored-hauhaucs-aggressive`** também responde em todas as
  tentativas — mas gasta ~250–300 tokens **raciocinando** antes de escrever a
  resposta. Isso não reduz a velocidade de geração (~47 tok/s), e sim o **tempo
  até a primeira resposta** (~6,3 s) e o total (~7,2 s): ~5,5 inferências/min.
  É viável, porém ~10× mais lento por análise que o qwen.

## Qualidade

Verdade-base obtida sem o modelo: as fixtures são geradas por
`scripts/gerar-fixtures-bench.mjs` (fundo gradiente azul-escuro + retângulo bege
central + faixa marrom na base — **nenhuma pessoa**) e o clipe real tem sidecar
(`bench/videos/webcam-mudanca.json`: **a pessoa fica no quadro até ~19,5 s e
sai**; de ~20 s ao fim o quadro fica vazio).

Prompts iguais aos do app (`PROMPT_DESCRICAO`), uma chamada por frame:

| Frame | Verdade-base | `qwen2.5-vl-3b` | `gemma-4-e2b` |
|---|---|---|---|
| Fixture abstrata | só blocos de cor | **alucinou** "uma pessoa sentada em frente a uma mesa com vários livros... segurando um tablet" | correto: "área de cor bege ou dourada no centro... composição abstrata ou teste de visualização" |
| Webcam 2 s | pessoa presente | "homem sem camisa está segurando um spray nas mãos"; "cama de madeira e janela com cortinas" | "close-up de um homem que está segurando ou consumindo algo na boca"; "parede clara atrás do sujeito" |
| Webcam 10 s | pessoa presente | "pessoa beber água de uma **caneca**... sem camisa e tem um barba... janela com grades" | "homem com barba... segurando ou olhando para um objeto que parece ser um **copo ou recipiente**" |
| Webcam 25 s | quadro vazio | "cadeira preta à frente de uma janela com persiana branca... armário de madeira com caixas" | "quadro de madeira... parede branca e um objeto escuro em primeiro plano" |

Conclusões de qualidade:

- Na mesma cena real, **os dois acertam** (pessoa presente / quadro vazio, sem
  recusa — inclusive para um homem sem camisa). O qwen é mais detalhado; o gemma
  é mais cauteloso ("possivelmente", "parece ser").
- O qwen é **menos estável entre frames** da mesma cena (chamou o objeto de
  "spray" aos 2 s e de "caneca" aos 10 s) — o mesmo sintoma dos rótulos
  instáveis já registrado em `bench/videos/README.md`.
- Na fixture abstrata, **só o gemma foi fiel**: o qwen inventou uma cena de
  escritório. É o indício mais forte de que o qwen "completa" o que espera ver,
  enquanto o gemma descreve o que está lá.

## Problemas encontrados e soluções

| # | Problema | Como foi detectado | Solução |
|---|---|---|---|
| 1 | `geracao (tok/s)` saía absurdo (~256.000 tok/s) | divisão por um intervalo ≈ 0 quando o backend entrega tudo em um chunk | `segundosDeGeracao` usa o tempo total quando não há 2ª amostra |
| 2 | "gemma nunca devolve `content`" (parecia só-pensante) | sonda variando `max_tokens` | era **truncamento**: com `max_tokens=256` o raciocínio consumia o teto inteiro (`finish_reason=length`, `content` vazio). Com 1024 o gemma responde (`finish_reason=stop`) |
| 3 | Raciocínio entrava no `tok/s` como "velocidade do modelo" | comparação com o tempo até o 1º `content` | `tok/s` continua contando todos os tokens (é a velocidade real de geração) e a coluna `1ª resposta` expõe o custo do raciocínio |
| 4 | `RAM/VRAM` saem como `-` | introspecção do LM Studio | documento/saída já explicam: o backend não expõe uso por modelo |
| 4 | Raciocínio não é o mesmo que resposta | leitura do stream | `interpretarChat` expõe `pensou` e `motivoFim`; o app usa só o `content` final |
| 5 | Teto pequeno derrubava modelos de raciocínio **no app**, não só no bench | teste de integração (`scripts/testar-lmstudio.mjs`) com o gemma: `POST /api/visao` dava `502` "raciocínio sempre ativo" | teto do app subiu para `NUM_PREDICT_PADRAO = NUM_PREDICT_BASE = 768` e `NUM_PREDICT_DELTA = 512`; o erro `502` agora distingue truncamento (`finish_reason: "length"`) e aponta o limite |

O item 2 invalidou a **primeira** versão deste documento, que concluía "gemma não
serve". A conclusão correta está abaixo.

## Decisão

- O app **aceita modelos pensantes**: ignora `reasoning_content` e usa só o
  `content` final; o teto de geração (768/512) é dimensionado para caber
  raciocínio **e** resposta. É um *teto*, não uma meta — modelos que terminam
  antes param no fim de frase.
- **Padrão do app:** `qwen2.5-vl-3b-instruct` — ~10× mais rápido por análise, o
  que importa para o laço de webcam.
- **Alternativa pronta:** `NEURO_MODEL=gemma-4-e2b-uncensored-hauhaucs-aggressive`
  quando a fidelidade da descrição valer mais que a frequência (o gemma foi fiel
  onde o qwen alucinou, e é mais cauteloso). O custo é ~7 s por análise e ~5,5
  inferências/min.
- Com `NEURO_MODEL` apontando para um modelo de texto puro ou inexistente, o app
  cai no melhor modelo de visão disponível (`PREFERENCIA_MODELOS`).

## Observações sobre a medição

- `geracao (tok/s)` é medida do **primeiro token gerado** (conteúdo ou
  raciocínio) até o fim da resposta; quando o backend entrega tudo em um único
  chunk, usa-se o tempo total para não inflar o valor.
- Para modelos de raciocínio, os tokens contados incluem os de raciocínio — é a
  velocidade real de geração, mas a 1ª resposta demora mais.
- RAM/VRAM aparecem como `-` porque este LM Studio não expõe o uso por modelo via
  `/api/v0/models`.
- Os tempos de carregamento variam entre execuções (cache do sistema); compare
  sempre a mediana por imagem.
- A 1ª inferência de cada imagem inclui prefill/carregamento (~3–19 s) e não
  entra na mediana.
