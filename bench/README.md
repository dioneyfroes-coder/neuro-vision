# Conjunto fixo de imagens do benchmark

Este diretório guarda o **conjunto fixo de imagens** usado por `npm run bench`
(`scripts/benchmark.mjs`) para medir latência, throughput e uso de memória do
Ollama de forma **reproduzível** — sem depender dos snapshots da sua máquina.

## Como funciona

1. O benchmark procura imagens, nesta ordem de prioridade:
   1. caminhos passados em `--image` (pode repetir);
   2. o diretório de `--images-dir`;
   3. `bench/imagens/` (este diretório);
   4. o snapshot mais recente em `logs/snapshots/`;
   5. uma imagem sintética 1×1 (fallback).
2. Todas as imagens do conjunto são medidas para o modelo, e o resultado de
   visão é a **mediana entre as imagens** (`visaoPorImagem` guarda cada uma).

## Imagens incluidas

As duas imagens (`cena-640x480.png`, `cena-1280x720.png`) são cenas sintéticas
geradas por `scripts/gerar-fixtures-bench.mjs`. Elas cobrem duas resoluções
típicas de webcam e são determinísticas (rodar o gerador de novo reescreve os
mesmos bytes):

```bash
node scripts/gerar-fixtures-bench.mjs
```

## Substituindo pelo seu conjunto

Para medir com cenas reais e representativas do seu uso, coloque arquivos
`.jpg`/`.png` em `bench/imagens/` (ou aponte `--images-dir outro/diretorio`) e
remova as fixtures sintéticas. O ideal é um conjunto **pequeno e fixo**
(3–6 imagens) mantido sob controle de versão, para que execuções passadas e
futuras sejam comparáveis.

## Reprodutibilidade

Cada execução registra, junto aos números, o **ambiente** (CPU, núcleos, RAM,
plataforma, versão do Node), o **host/modelo**, as **configurações**
(`num_predict`, iterações) e as **imagens usadas**. No modo `--json`, tudo isso
sai em um objeto `ambiente` + `resultados`, pronto para versionar ao lado do
hardware testado.
