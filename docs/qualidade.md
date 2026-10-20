# Benchmark e qualidade — Neuro Vision

Como medir o desempenho do modelo local, avaliar a qualidade dos eventos e manter a regressão verde.

## Benchmark (`npm run bench`)

Mensura o que o seu modelo local realmente sustenta: geração em tok/s, prefill da imagem, tempo até a 1ª resposta, total, **inferências por minuto** e **uso de RAM/VRAM** (quando o backend informa) — e recomenda o **intervalo mínimo** para o slider da UI (`totalMs × 1.5`). Repetindo `--model`, compara vários modelos lado a lado na tabela final. Opções:

```bash
npm run bench                                            # todos os modelos instalados
npm run bench -- --model qwen2.5-vl-3b-instruct --iter 5 # um modelo específico, mais amostras
npm run bench -- --model qwen2.5-vl-3b-instruct --model gemma-4-2b  # comparativo
npm run bench -- --base-url http://127.0.0.1:1235 --image foto.jpg --json  # outra porta + JSON
npm run bench -- --images-dir minhas-cenas               # diretório próprio de imagens fixas
```

O benchmark roda sobre o **conjunto fixo de imagens** em [`bench/imagens/`](../bench/imagens) (gerado por `node scripts/gerar-fixtures-bench.mjs`) para ser reproduzível sem depender dos seus snapshots; veja [`bench/README.md`](../bench/README.md) para trocar por cenas reais. Por padrão ele mede cada modelo no conjunto inteiro e reporta a **mediana entre as imagens**.

Cada execução registra o **ambiente** (CPU, núcleos, RAM, plataforma, versão do Node e commit/branch do código), o host, o modelo e as configurações (`max_tokens`, iterações) junto aos números — no modo `--json` sai um objeto `ambiente` + `resultados` pronto para versionar. O `uso de RAM/VRAM` vem de `/api/v0/models` (introspecção do LM Studio), quando o backend a expõe; caso contrário sai como `-`.

O cliente **ajusta sozinho** o ritmo: cada análise espera `max(intervalo, duração da análise anterior + 500ms)`, então nunca pede mais rápido que o modelo consegue responder. O status e cada entrada de descrição mostram os **tok/s** medidos.

Medição de referência (`qwen2.5-vl-3b-instruct`, CPU, snapshot 4K): ~40 tok/s de geração, prefill ~104 tok/s, 1ª resposta ~10,6s, total ~11,5s → **intervalo mínimo recomendado ≥ 18s**.

As especificações da **máquina de referência** e as metas realistas por hardware (com o procedimento para recapturá-las) ficam em [`bench/BASELINE.md`](../bench/BASELINE.md).

## Qualidade de eventos (`npm run qualidade`)

Compara os **eventos que o app gravou** (`logs/eventos.jsonl`) com a **anotação de um clipe** e calcula **precisão**, **recall**, **proporção de mudanças perdidas** e **falsos positivos por minuto**:

```bash
npm run qualidade -- --anotacao bench/videos/webcam-mudanca.json
npm run qualidade -- --anotacao bench/videos/webcam-mudanca.json --json > qualidade.json
```

O formato da anotação, o fluxo de captura e as regras de casamento estão em [`bench/videos/README.md`](../bench/videos/README.md). Os vídeos ficam **locais** (não versionados); a anotação `.json` é versionada para a medição ser reproduzível em qualquer máquina que tenha o mesmo clipe. A camada de política/rastreamento, que não depende de vídeo, também é medida em `tests/qualidade-eventos.test.ts`.

### Clipes separados em tuning e eval

`bench/clipes/` separa os clipes de **ajuste** (`bench/clipes/tuning/`) dos
reservados para **avaliação final** (`bench/clipes/eval/`), com o mapeamento de
cenários × clipes e a cobertura mínima (ações lentas/rápidas, gestos, oclusões,
iluminação ruim, cena estática, ausência de pessoa) em
[`bench/clipes/MATRIZ_COBERTURA.md`](../bench/clipes/MATRIZ_COBERTURA.md).
Passe o conjunto ao avaliador:

```bash
npm run qualidade -- --anotacao bench/clipes/eval/webcam-mudanca.json --eventos logs/eventos.jsonl
```

### Clipe real (ponta a ponta)

Dá para gravar um clipe curto da própria webcam e reproduzi-lo para o app com o modelo de verdade (sem stubs):

```bash
npm run gravar:webcam -- bench/videos/webcam-mudanca.webm 30                       # grava 30 s da webcam
npm run extrair:frames -- bench/videos/webcam-mudanca.webm bench/videos/frames 1,5,10,15,20,25  # quadros para anotar
```

Depois, com estas variáveis de ambiente (no PowerShell, `$env:NOME = "valor"`):

```text
E2E_WEBCAM_CLIP=bench/videos/webcam-mudanca.webm
E2E_WEBCAM_CHANNEL=chrome          # opcional: usa o Chrome instalado; por padrão roda no Chromium do Playwright
E2E_WEBCAM_EVENTOS=logs/webcam-eventos.jsonl
```

```bash
npx playwright test e2e/webcam.spec.ts --workers=1
npm run qualidade -- --anotacao bench/videos/webcam-mudanca.json --eventos logs/webcam-eventos.jsonl --tolerancia 8000
```

O modelo real é **pesado**: no Chromium do Playwright (WASM/CPU) uma inferência leva ~24 s; com o Chrome instalado (WebGPU) cai para ~5–6 s. Por isso a tolerância precisa acomodar a cadência entre análises (aqui, `--tolerancia 8000`). A medição de referência desta máquina (clipe de 30 s com uma saída de pessoa; 4 análises via WebGPU) deu **precisão 25% · recall 100% · ~6 falsos positivos/min** — os falsos positivos foram rótulos instáveis do detector e uma `mudanca_de_cena` espúria. Os números e a metodologia estão em [`bench/BASELINE.md`](../bench/BASELINE.md).

### Smoke multiframe (3 modos, pipeline real)

`e2e/webcam-multiframe.spec.ts` roda os modos `percepcao-sequencia` (variante B), `percepcao-fundida` (C) e `percepcao` (D) com o **mesmo clipe no lugar da webcam** (4 frames a 1 frame/s), e grava por modo:

- `logs/e2e-multiframe-<modo>.jsonl` — eventos (`POST /api/eventos`);
- `logs/e2e-multiframe-<modo>.log.jsonl` — entradas da IA local (`POST /api/log`);
- `logs/e2e-multiframe-<modo>.ciclos.jsonl` — `RegistroCiclo` com métricas por etapa;
- `logs/e2e-multiframe-<modo>.inicio` — base temporal para a avaliação.

```bash
$env:E2E_WEBCAM_CLIP = "bench/videos/webcam-mudanca.webm"
$env:E2E_WEBCAM_EVENTOS = "logs/e2e-multiframe"
npx playwright test e2e/webcam-multiframe.spec.ts --workers=1
npm run qualidade -- --anotacao bench/clipes/eval/webcam-mudanca.json --eventos logs/e2e-multiframe-percepcao.jsonl --tolerancia 8000
```

O E2E só passa se houver **ciclo concluído** (não cancelado) com os 4 frames, `interpretacao` multimodal não vazia e `totalMs`/`multimodalMs`; nos modos C/D exige também as métricas de detecção/pose/mãos/temporal. Um `stop` que cancela o único ciclo em voo agora **falha** o teste, em vez de passar com zero ciclos concluídos.

O resultado de referência (ciclos, latências por etapa, texto da IA) está em [`bench/RELATORIO_SMOKE_MULTIFRAME_2026-10-19.md`](../bench/RELATORIO_SMOKE_MULTIFRAME_2026-10-19.md). Em CPU/WASM um ciclo multiframe leva dezenas de segundos (ver limites em [`limites.md`](./limites.md)), então o teste espera janelas longas antes de encerrar.

## Benchmark de variantes (A–D) — Etapa 9

`scripts/benchmark-variantes.mjs` compara as quatro variantes sobre o **mesmo conjunto de clipes** e **verifica a versão do modelo multimodal** usada por todas **somente em `logs/visao.jsonl`** (campo `modelo` das entradas ligadas aos ciclos pelo `frameId`). O campo `modelo` dos arquivos de eventos é o **detector local** (ex.: `Xenova/yolos-tiny`), não o multimodal, e por isso não entra nessa prova. O `--modelo-visao` apenas registra a intenção; divergências e ausência de dados viram impedimento de conclusão (não apenas aviso).

```bash
node scripts/benchmark-variantes.mjs --help
node scripts/benchmark-variantes.mjs --anotacoes-dir bench/clipes/eval `
  --ciclos-B logs/e2e-multiframe-percepcao-sequencia.ciclos.jsonl `
  --eventos-C logs/e2e-multiframe-percepcao-fundida.jsonl `
  --modelo-visao qwen2.5-vl-3b-instruct
```

- **Conjuntos:** `bench/clipes/tuning/` (ajuste de limiares) e `bench/clipes/eval/` (avaliação final); mapeamento e cobertura mínima em [`bench/clipes/MATRIZ_COBERTURA.md`](../bench/clipes/MATRIZ_COBERTURA.md).
- **Critério de conclusão:** no mínimo `--min-ciclos <n>` (padrão 1) ciclo(s) **concluído(s)** por variante — não cancelado, com frames, `concluidoEm` e interpretação —, modelo multimodal verificado em `logs/visao.jsonl` e um arquivo de eventos **próprio** por variante (o mesmo arquivo aplicado a duas variantes repetiria a qualidade). Sem isso, o harness **não grava o comparativo** e termina com código não zero; `--permitir-inconclusivo` grava o diagnóstico com veredito **INCONCLUSIVO**. Com `--sem-qualidade`, a qualidade não entra na conclusão: o comparativo fica restrito ao desempenho e não exige arquivo de eventos.
- **Saídas:** `bench/RELATORIO_VARIANTE_{A,B,C,D}_<data>.md` e `bench/COMPARATIVO_A_B_C_D_<data>.md`. Cada relatório registra commit/branch, backend, janela da execução, clipes com tamanho e SHA-256, modelo multimodal observado, detector local e a contagem de ciclos concluídos. O script **se recusa a escrever em `bench/BASELINE.md`** (proteção coberta por teste).
- **Histórico:** o comparativo de 2026-10-18 (`bench/COMPARATIVO_A_B_C_D_20261018.md`) é um artefato **inválido como comparação** (zero ciclos e o mesmo arquivo de eventos para A/B/C/D); ele é preservado apenas como registro histórico. Não o misture com o conjunto de avaliação atual.
- **Decisão arquitetural** (sempre ativos × sob demanda × reduzir frequência) com as métricas que a sustentam: [`bench/DECISAO_ARQUITETURAL_2026-10-19.md`](../bench/DECISAO_ARQUITETURAL_2026-10-19.md).

## Carregamento do modelo

O backend de visão carrega o modelo na memória sob demanda (o primeiro request é o lento). O Neuro Vision espera esse carregamento antes de começar:

- Ao clicar **Iniciar** com o motor **Descrição**, o servidor chama `forcarCarregamento` (confirma via `/api/v0/models` quando o backend a expõe; senão, um probe mínimo dispara a carga) e **só então** o ciclo de análise começa. O status mostra "Carregando modelo... em Ns".
- O badge do backend informa quais modelos estão **em memória** (`/api/health` → `carregados`).
- O benchmark **só mede com o modelo já em memória** (a primeira etapa carrega e reporta o tempo da carga), para que o tok/s não seja contaminado pelo load.

## Regressão

Após mudanças em prompts, modelos, rastreamento ou agendamento, rode `npm test` (unitários/integração) e `npm run test:e2e` (fluxos no navegador) — ambos são a rede de segurança principal. Para desempenho e qualidade, compare os relatórios novos com a linha de base de `bench/BASELINE.md` usando `npm run bench -- --json` e `npm run qualidade -- --json`.