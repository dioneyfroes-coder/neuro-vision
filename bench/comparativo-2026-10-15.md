# Comparativo de modelos (2026-10-15)

Primeira execução do benchmark comparativo (`npm run bench` com dois `--model`)
contra o LM Studio local, medindo **dois modelos instalados** na mesma máquina e
no mesmo conjunto fixo de imagens.

```bash
node scripts/benchmark.mjs --base-url http://127.0.0.1:1235 \
  --model qwen2.5-vl-3b-instruct \
  --model gemma-4-e2b-uncensored-hauhaucs-aggressive
```

- **Backend:** LM Studio em `http://127.0.0.1:1235`
- **Imagens:** `bench/imagens/` (2 cenas sintéticas: 1280×720 e 640×480)
- **Iterações:** 3 · **`max_tokens`:** 256
- **Máquina:** Intel(R) Xeon(R) CPU E5-2660 v3 @ 2.60GHz (20 núcleos lógicos),
  15,8 GB RAM, Windows 10 (10.0.26200), Node v24.19.0

## Resumo

| Modelo | Responde? | Texto (tok/s) | Visão (tok/s) | Prefill (tok/s) | 1ª resposta (ms) | Total (ms) | Inferências/min | Intervalo mínimo (s) |
|---|---|---|---|---|---|---|---|---|
| `qwen2.5-vl-3b-instruct` | sim | 61,6 | 55,2 | 8661,6 | 93 | 1114 | 30 | 2 |
| `gemma-4-e2b-uncensored-hauhaucs-aggressive` | parcial 3/6 | 0 | 46,8 | 957,2 | 5647 | 5679 | 6,7 | 9 |

## Leitura dos números

- **`qwen2.5-vl-3b-instruct`** sustenta o fluxo de webcam: responde a texto e a
  imagem em todas as tentativas, gera a ~55–62 tok/s e fecha uma análise de
  imagem em ~1,1 s (a 1ª inferência de cada imagem inclui o carregamento/prefill
  do cache, ~3–19 s, e não entra na mediana). Com o intervalo mínimo de 2 s o
  cliente roda confortavelmente a ~30 inferências/min.
- **`gemma-4-e2b-uncensored-hauhaucs-aggressive`** é um modelo de **raciocínio
  sempre ativo**: produz `reasoning_content` e, em texto, **nunca** devolve
  `content` (0/3); com imagem devolveu conteúdo em 3 de 6 tentativas. A geração
  medida (~47 tok/s) é a velocidade real de tokens gerados, mas o tempo até a
  primeira resposta (~5,6 s) e o total (~5,7 s) inviabilizam o modo Descrição —
  o app responde `502` com a orientação de "raciocínio sempre ativo". Com o
  intervalo mínimo de 9 s ele renderia ~6,7 inferências/min.

Conclusão: para o modo Descrição use o **qwen2.5-vl-3b-instruct**; o gemma
uncensored não serve como modelo de visão do app por depender de raciocínio.

## Observações sobre a medição

- `geracao (tok/s)` é medida do **primeiro token gerado** (conteúdo ou
  raciocínio) até o fim da resposta; quando o backend entrega tudo em um único
  chunk, usa-se o tempo total para não inflar o valor.
- Para modelos de raciocínio, os tokens contados incluem os de raciocínio.
- RAM/VRAM aparecem como `-` porque este LM Studio não expõe o uso por modelo
  via `/api/v0/models`.
- Os tempos de carregamento do modelo variam entre execuções (cache do sistema);
  compare sempre a mediana por imagem.
