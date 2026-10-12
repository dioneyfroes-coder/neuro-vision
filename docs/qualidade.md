# Benchmark e qualidade — Neuro Vision

Como medir o desempenho do modelo local, avaliar a qualidade dos eventos e manter a regressão verde.

## Benchmark (`npm run bench`)

Mensura o que o seu modelo local realmente sustenta: geração em tok/s, prefill da imagem, tempo até a 1ª resposta, total, **inferências por minuto** e **uso de RAM/VRAM** — e recomenda o **intervalo mínimo** para o slider da UI (`totalMs × 1.5`). Opções:

```bash
npm run bench                                     # conjunto fixo em bench/imagens/ (ou o snapshot mais recente)
npm run bench -- --model qwen2.5vl:7b --iter 5    # outro modelo, mais amostras
npm run bench -- --image foto.jpg --json          # uma imagem específica + saída JSON
npm run bench -- --images-dir minhas-cenas        # diretório próprio de imagens fixas
```

O benchmark roda sobre o **conjunto fixo de imagens** em [`bench/imagens/`](../bench/imagens) (gerado por `node scripts/gerar-fixtures-bench.mjs`) para ser reproduzível sem depender dos seus snapshots; veja [`bench/README.md`](../bench/README.md) para trocar por cenas reais. Por padrão ele mede cada modelo no conjunto inteiro e reporta a **mediana entre as imagens**.

Cada execução registra o **ambiente** (CPU, núcleos, RAM, plataforma, versão do Node), o host, o modelo e as configurações (`num_predict`, iterações) junto aos números — no modo `--json` sai um objeto `ambiente` + `resultados` pronto para versionar. O `uso de RAM/VRAM` vem de `/api/ps` (memória realmente ocupada pelo modelo carregado).

O cliente **ajusta sozinho** o ritmo: cada análise espera `max(intervalo, duração da análise anterior + 500ms)`, então nunca pede mais rápido que o modelo consegue responder. O status e cada entrada de descrição mostram os **tok/s** medidos.

Medição de referência (`qwen2.5vl:3b`, CPU, snapshot 4K): ~40 tok/s de geração, prefill ~104 tok/s, 1ª resposta ~10,6s, total ~11,5s → **intervalo mínimo recomendado ≥ 18s**.

As especificações da **máquina de referência** e as metas realistas por hardware (com o procedimento para recapturá-las) ficam em [`bench/BASELINE.md`](../bench/BASELINE.md).

## Qualidade de eventos (`npm run qualidade`)

Compara os **eventos que o app gravou** (`logs/eventos.jsonl`) com a **anotação de um clipe** e calcula **precisão**, **recall**, **proporção de mudanças perdidas** e **falsos positivos por minuto**:

```bash
npm run qualidade -- --anotacao bench/videos/sala-com-pessoa.json
npm run qualidade -- --anotacao bench/videos/sala-com-pessoa.json --json > qualidade.json
```

O formato da anotação, o fluxo de captura e as regras de casamento estão em [`bench/videos/README.md`](../bench/videos/README.md). Os vídeos ficam **locais** (não versionados); a anotação `.json` é versionada para a medição ser reproduzível em qualquer máquina que tenha o mesmo clipe. A camada de política/rastreamento, que não depende de vídeo, também é medida em `src/qualidade-eventos.test.ts`.

### Clipe real (ponta a ponta)

Dá para gravar um clipe curto da própria webcam e reproduzi-lo para o app com o modelo de verdade (sem stubs):

```bash
npm run gravar:webcam -- bench/videos/webcam-mudanca.webm 30                       # grava 30 s da webcam
npm run extrair:frames -- bench/videos/webcam-mudanca.webm bench/videos/frames 1,5,10,15,20,25  # quadros para anotar
```

Depois, com estas variáveis de ambiente (no PowerShell, `$env:NOME = "valor"`):

```text
E2E_WEBCAM_CLIP=bench/videos/webcam-mudanca.webm
E2E_WEBCAM_CHANNEL=chrome          # usa o Chrome instalado (WebGPU); sem ele, roda em WASM/CPU
E2E_WEBCAM_EVENTOS=logs/webcam-eventos.jsonl
```

```bash
npx playwright test e2e/webcam.spec.ts --workers=1
npm run qualidade -- --anotacao bench/videos/webcam-mudanca.json --eventos logs/webcam-eventos.jsonl --tolerancia 8000
```

O modelo real é **pesado**: no Chromium do Playwright (WASM/CPU) uma inferência leva ~24 s; com o Chrome instalado (WebGPU) cai para ~5–6 s. Por isso a tolerância precisa acomodar a cadência entre análises (aqui, `--tolerancia 8000`). A medição de referência desta máquina (clipe de 30 s com uma saída de pessoa; 4 análises via WebGPU) deu **precisão 25% · recall 100% · ~6 falsos positivos/min** — os falsos positivos foram rótulos instáveis do detector e uma `mudanca_de_cena` espúria. Os números e a metodologia estão em [`bench/BASELINE.md`](../bench/BASELINE.md).

## Carregamento do modelo

O backend de visão carrega o modelo na memória sob demanda (o primeiro request é o lento). O Neuro Vision espera esse carregamento antes de começar:

- Ao clicar **Iniciar** com o motor **Descrição**, o servidor chama `forcarCarregamento` (probe em `/api/ps`; no LM Studio, `/api/v0/models`) e **só então** o ciclo de análise começa. O status mostra "Carregando modelo... em Ns".
- O badge do backend informa quais modelos estão **em memória** (`/api/health` → `carregados`).
- O benchmark **só mede com o modelo já em memória** (a primeira etapa carrega e reporta o tempo da carga), para que o tok/s não seja contaminado pelo load.

## Regressão

Após mudanças em prompts, modelos, rastreamento ou agendamento, rode `npm test` (unitários/integração) e `npm run test:e2e` (fluxos no navegador) — ambos são a rede de segurança principal. Para desempenho e qualidade, compare os relatórios novos com a linha de base de `bench/BASELINE.md` usando `npm run bench -- --json` e `npm run qualidade -- --json`.