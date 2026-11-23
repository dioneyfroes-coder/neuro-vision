# Especialização NSFW — escopo, estado e limites

Este documento descreve a especialização NSFW **do modo Neuro Vision**. Ela é
opt-in, local e independente da **Câmera de Segurança**. O plano de evolução
completo está em [`neuro-vision-nsfw-plano-de-evolucao.md`](../neuro-vision-nsfw-plano-de-evolucao.md).

## Escopo: dois modos, duas finalidades

| | Neuro Vision (com NSFW) | Câmera de Segurança |
| --- | --- | --- |
| Objetivo | Descrever corpos, anatomia visível, nudez e ações adultas com fidelidade ao que aparece. | Detectar pessoas/objetos, gerar eventos, gravar segmentos e manter memória ambiental. |
| Ativação | Checkbox **NSFW (experimental)** (`#nsfw`), desligado por padrão, vale para a próxima sessão. | Motor de monitoramento próprio, com política de gravação e atenção. |
| Detectores | Conjunto ONNX local de 6 modelos, um worker por modelo. | YOLO COCO padrão; o conjunto NSFW **nunca** é habilitado pelo motor de atenção. |
| Prompt/backend | Bloco NSFW no prompt e modelo multimodal configurado para `MODELO_NSFW`. | Prompt e modelo do modo de segurança; sem bloco NSFW. |
| Dados | Snapshots, marcações e telemetria locais; mídia e pesos nunca versionados. | Segmentos de vídeo com retenção/criptografia opcionais. |

O toggle NSFW não altera o modo de segurança, não entra no inventário e não é
ativado por mudanças de cena. Ver [`fase-3-atencao.md`](./fase-3-atencao.md) e
[`fase-2-inventario.md`](./fase-2-inventario.md).

## O que o toggle muda no Neuro Vision

Quando ligado, o conjunto carrega os seis modelos do catálogo
(`nudenet_320n`, `nudenet_640m`, `erax_nsfw_yolo11n/s/m`, `penis_yolov8m`),
executa todos sobre o frame, mescla as marcações e:

- preserva rótulo, score, caixa e modelos de origem no contexto, no prompt, nos
  logs e na interface;
- mantém a distinção entre "não rodou" (`undefined`), "rodou e não marcou" (lista
  vazia) e "rodou e falhou" (`indisponivel` com motivo);
- usa o modelo multimodal `MODELO_NSFW`; o identificador é fixo no código e
  **não comprova, sozinho, quais pesos/quantização o backend carregou**.

Detalhes operacionais em [`modos.md`](./modos.md#nsfw-experimental-toggle-da-interface)
e [`uso.md`](./uso.md#nsfw-experimental).

## Fase 1 — confiabilidade do conjunto

Entregue nesta fase:

1. **`avaliar()` usa só os modelos que carregaram.** Antes, percorria todos os
   adaptadores criados e voltava a chamar, a cada frame, um modelo que já havia
   falhado na carga. A lista efetiva de carregados é mantida à parte da lista de
   adaptadores (que permanece para telemetria e retry).
2. **Falhas individuais ficam visíveis.** Cada modelo indisponível aparece por
   nome e motivo na linha de diagnóstico (`nsfw falhas k/n: modelo: motivo`) e no
   aviso operacional, inclusive em carga parcial. Falha de carga deixa de ser
   apagada pela primeira inferência bem-sucedida.
3. **Retry sem duplicar workers.** Uma nova chamada a `carregar()` reaproveita os
   adaptadores existentes e tenta novamente os que falharam; nada é repetido
   automaticamente por frame. Ainda não há botão de retry na interface: a ação é
   explícita no código, não na tela.
4. **Descarte revisado.** `encerrar()` libera inclusive adaptadores que falharam
   na carga, é idempotente e não deixa que a exceção de um impeça a liberação dos
   demais. Se a fábrica falhar no meio da criação, os adaptadores já criados são
   liberados antes de propagar o erro.

Implementação: [`public/perception/adapters/nsfw-classifier/conjunto.ts`](../public/perception/adapters/nsfw-classifier/conjunto.ts),
[`public/ui/diagnostico-nsfw.ts`](../public/ui/diagnostico-nsfw.ts),
[`public/cycle/cycle-controller/base.ts`](../public/cycle/cycle-controller/base.ts) e
[`public/perception/local-perception-pipeline/configuracao.ts`](../public/perception/local-perception-pipeline/configuracao.ts).

Testes: `tests/nsfw-classifier-adapter/conjunto.test.ts`,
`tests/diagnostico-nsfw.test.ts`, `tests/cycle-controller/nsfw.test.ts` e
`tests/local-perception-pipeline/configuracao-e-inativo.test.ts`.

## Fase 2 — descrição corporal neutra e avaliação de filtros

Entregue nesta fase:

1. **Perfil corporal neutro, opt-in e separado do NSFW.**
   `src/nsfw-prompt/perfil-corporal.ts` expõe `INSTRUCAO_CORPO_NEUTRO`,
   `blocoCorpoNeutro()` e `blocoPerfilCorporal()`. O bloco neutro descreve
   roupa/torso/abdomen com linguagem anatômica, distingue torso exposto de
   nudez e **não** herda a instrução adulta, o pedido de explicitude nem a
   política do classificador. Um perfil explícito vence o toggle, para que o
   mesmo conjunto de detectores possa ser comparado sob prompts diferentes.
2. **Default preservado.** Sem `?descricaoCorporal=neutro` e sem perfil no
   payload, o prompt SFW continua intacto; com NSFW ligado, o bloco adulto e o
   `MODELO_NSFW` continuam exatamente como antes. O perfil neutro **não** força
   o modelo adulto — pelo contrário, o servidor não sinaliza `nsfwAtivo` quando
   ele é pedido. No multiframe, a instrução de ação sexual e a linha "sem
   eufemismos" entram somente no perfil `nsfw`.
3. **Filtros verificados de forma determinística.** `MALE_BREAST_EXPOSED` usa o
   mesmo piso de `0,50` de `FEMALE_BREAST_EXPOSED`: `0,49` é descartado, `0,50`
   passa. `BELLY_EXPOSED` e `BELLY_COVERED` são removidos por
   `CLASSES_NSFW_IGNORADAS` mesmo com score máximo, assim como rosto, pés e
   axilas. Isso é verificação de configuração/limiar, **não** medição de acerto.
4. **Comparação honesta de perfis.** `compararPromptsCorpo()` compara os três
   blocos gerado das mesmas marcações (contrato dos prompts, sem modelo).
   `compararPerfisCorpo()` conta omissões e sexualizações indevidas **apenas**
   quando há anotação humana com `revisao.status === "revisada"`; sem respostas
   ou sem anotação revisada, devolve `sem_dados` com motivo e não publica taxa.
   Os números, quando existem, são léxicos (sinônimos declarados), nunca
   precisão/recall.

Uso opt-in: `?descricaoCorporal=neutro` na URL (ou `perfilCorporal: "neutro"` no
`POST /api/visao`). Não há botão na interface: o toggle NSFW continua
independente e bloqueado durante a captura. `VERSAO_PROMPT_INTERPRETACAO`
passou para `prompt-interpretacao-4`: o contrato multiframe ganhou o perfil e,
na Fase 4, o carimbo de tempo por marcação e a distinção anatomia/ação/proposta;
na Fase 5, a deduplicação de linhas exatas (sem alterar o texto sem repetição).

O harness `npm run avaliar:corpo` imprime a comparação dos três blocos e
`Acurácia: N/A` com o motivo; com `--anotacao <json> --respostas <jsonl>` ele
também aplica `compararPerfisCorpo()`. Não executa modelo e não lê imagem.

Implementação: [`src/nsfw-prompt/perfil-corporal.ts`](../src/nsfw-prompt/perfil-corporal.ts),
[`src/domain/avaliacao-perfis-corpo.ts`](../src/domain/avaliacao-perfis-corpo.ts),
[`public/interpretation/prompt.ts`](../public/interpretation/prompt.ts),
[`src/http/rotas-visao/handle.ts`](../src/http/rotas-visao/handle.ts) e
[`scripts/avaliar-perfis-corpo.mjs`](../scripts/avaliar-perfis-corpo.mjs).
Testes: `tests/perfil-corporal.test.ts`, `tests/filtros-corpo-nsfw.test.ts`,
`tests/avaliacao-perfis-corpo.test.ts` e `tests/server-visao/perfil-corporal.test.ts`.

**Não entregue / N/A:** dataset adulto anotado de corpos sem camisa e roupas de
banho; comparação da saída real do Gemma nos três perfis; omissões/sexualização
medidas em imagens reais. Sem ground truth revisado, qualquer número de acerto
seria inventado.

## Pré-processamento: o que foi verificado e o que não foi

**Verificado de forma determinística nesta fase** (sem pesos e sem Python):

- o cliente faz **stretch** quadrado (`drawImage(bitmap, 0, 0, lado, lado)`), sem
  letterbox/padding, em 320 para `nudenet_320n` e 640 para os demais;
- a conversão é RGBA → float32 NCHW em `[0,1]`, sem mean/std;
- a transformação inversa das caixas usa `ex = larguraOriginal/lado` e
  `ey = alturaOriginal/lado`, consistente com o stretch (sem compensação de
  padding), com clamp nas bordas e descarte de caixas degeneradas;
- retrato, paisagem, 4:3, quadrado e panorâmico são exercitados por
  `tests/pre-processamento-nsfw.test.ts`, incluindo caixa pequena e caixa na borda;
- a forma crua do NudeNet com `22` em qualquer uma das duas últimas dimensões é
  reconhecida corretamente — antes, um export `[1,N,22]` seria lido como NMS.

**Permanece INCONCLUSIVO — não foi validado nesta fase:**

- se stretch é de fato o pré-processamento esperado pelos pesos de origem;
- interpolação do resize (bilinear/bicubic/lanczos) e equivalência numérica
  entre a saída ONNX no navegador e uma referência Python;
- comparação stretch × letterbox em dataset anotado, inclusive em 9:16;
- proveniência completa: URLs usam `resolve/main`, sidecars locais não registram
  SHA-256, licença, autor, versão do exportador nem pré-processamento esperado.

Não existe código Python de referência nem golden output versionado no
repositório. Os únicos metadados de pré-processamento encontrados pertencem ao
modelo de **pose** (`preprocessor_config.json`), não aos modelos NSFW, e não
podem ser usados como evidência para eles. Ver
[`pendencias.md`](./pendencias.md#fase-8) e os relatórios em
[`bench/README.md`](../bench/README.md).

> Regra do plano: não trocar stretch por letterbox sem comparar com a origem dos
> pesos. A mudança de formato de saída acima é uma correção de decodificação, não
> uma troca de pré-processamento.

## Fase 3 — infraestrutura de fusão e eficiência

A Fase 3 entregou **mecanismos determinísticos**, não medições de modelo:

- `src/domain/agrupamento-espacial-nsfw.ts` agrupa por geometria antes de
  comparar rótulos. `ResultadoNsfw.grupos` preserva as caixas originais, as
  hipóteses por modelo e o estado `concordancia`/`conflito_semantico` sem
  descartar rótulos conflitantes nem eleger um vencedor. As marcações mescladas
  antigas continuam em `marcacoes`, intactas.
- `public/nsfw-onnx/perfis.ts` define `leve`, `equilibrado` e `completo`,
  selecionáveis por `?perfilModelosNsfw=`. É um perfil de **execução**, distinto
  de `?perfil=leve` (pose/mãos) e de `?descricaoCorporal=` (prompt). O padrão
  continua `completo`.
- `resolverLimiarNsfw` aplica a precedência modelo/classe > classe > global na
  interpretação da saída; `LIMIARES_NSFW_POR_MODELO` começa vazio porque não
  existe calibração anotada que justifique overrides numéricos. `score` bruto
  não é alterado — o limiar usado é registrado em `limiarUsado`.
- `limiteConcorrencia` em `OpcoesConjuntoNsfw` limita modelos em voo em
  `carregar()` e `avaliar()`. Sem ele, o comportamento é o paralelismo total de
  antes. A telemetria registra `limiteConcorrencia` e
  `concorrenciaMaximaObservada` — contagem da fila local, não prova de
  escalonamento dos workers.
- `npm run verificar:concorrencia:nsfw` resume janelas instrumentadas já
  coletadas. Sem `--amostras`, o relatório volta `sem_dados` com `N/A` em
  concorrência e latência; memória é sempre `N/A`.

## Fase 4 — tempo, ações e cronologia

A Fase 4 entregou **infraestrutura determinística**, não medição de modelo:

- `src/domain/nsfw-marcacao-temporal.ts` carimba cada marcação com o `frameId`,
  o índice, `capturadoEm`/`offsetMs` do frame que a produziu. Sem carimbo
  confiável o prompt diz `tempo_desconhecido` — nunca `Date.now()`, nunca
  duração inferida da quantidade de imagens.
- `src/domain/nsfw-classificacao-rotulo.ts` separa anatomia local, estado visual
  e ação em nível de cena. `make_love` é `tipo: "acao"`, `escopo: "cena"`,
  `usoPermitido: "proposta_temporal"`: proposta de cena, não confirmação do ato.
  Rótulos fora do vocabulário viram sinal auxiliar (`confiavel: false`).
- `src/domain/nsfw-evidencia-temporal.ts` resume sinais por frame e alimenta
  `sinaisNsfw` na seleção adaptativa. O sinal é fraco (0–5, ação=1,
  concordância entre modelos=2, teto 5) e registrado com motivos; detector
  sozinho não se torna evento temporal validado.
- `src/domain/validacao-cronologia.ts` checa `inicioEm <= fimEm`, janela do
  ciclo e `frameId` citado como evidência. Passou a ser opcional em
  `validarRespostaMultimodal(valor, contexto)`; sem contexto o comportamento
  é o anterior. Intervalos curtos e evidências fora do intervalo geram aviso
  e incerteza explícita.
- `avaliarAcoesNsfwAnotadas()` e `npm run avaliar:acoes:nsfw` comparam
  intervalos por sobreposição determinística. Sem anotação v2 revisada,
  `conjunto: "eval"` e resolução melhor que 1 fps, o relatório volta `N/A`
  com motivo e taxas `null` — nunca `0`, nunca "aprovado".

Implementação: [`src/domain/nsfw-marcacao-temporal.ts`](../src/domain/nsfw-marcacao-temporal.ts),
[`src/domain/nsfw-classificacao-rotulo.ts`](../src/domain/nsfw-classificacao-rotulo.ts),
[`src/domain/nsfw-evidencia-temporal.ts`](../src/domain/nsfw-evidencia-temporal.ts),
[`src/domain/validacao-cronologia.ts`](../src/domain/validacao-cronologia.ts),
[`src/domain/avaliacao-nsfw-anotada.ts`](../src/domain/avaliacao-nsfw-anotada.ts),
[`scripts/avaliar-nsfw-acoes.mjs`](../scripts/avaliar-nsfw-acoes.mjs) e
[`public/interpretation/prompt.ts`](../public/interpretation/prompt.ts).
Testes: `tests/nsfw-marcacao-temporal.test.ts`,
`tests/nsfw-classificacao-rotulo.test.ts`, `tests/nsfw-evidencia-temporal.test.ts`,
`tests/validacao-cronologia.test.ts`, `tests/avaliacao-nsfw-anotada.test.ts`,
`tests/nsfw-prompt-temporal.test.ts` e `tests/scripts/avaliar-nsfw-acoes.test.mjs`.

## Fase 5 — Gemma, prompt e interface

A Fase 5 entregou **configuração e diagnóstico determinísticos**, não medição de
modelo:

- `src/nsfw-prompt/configuracao-gemma.ts` é a fonte única do identificador, com
  padrão `gemma-4-e2b-uncensored-hauhaucs-aggressive`. Sobrescrita local via
  `NEURO_MODELO_NSFW`, `NEURO_GEMMA_VERSAO`, `NEURO_GEMMA_QUANTIZACAO`,
  `NEURO_GEMMA_CONTEXTO_MAXIMO` e `NEURO_GEMMA_TEMPLATE_CONVERSA`. Versão,
  quantização, contexto e template são **declarados**, nunca inferidos.
- `src/domain/disponibilidade-gemma.ts` separa `nao_verificado` (backend não
  consultado), `indisponivel` (modelo não instalado) e `disponivel` (com `pronto`
  somente se confirmado em memória). `/api/health` reporta `modeloNsfw` e
  `gemma` ao lado do modelo SFW solicitado/efetivo.
- `GET /api/visao/preparar?nsfw=1` executa o warm-up do Gemma isoladamente. Se
  outro modelo for pedido, responde `400` com o modelo solicitado e o efetivo —
  não há fallback silencioso para `qwen2.5-vl-3b-instruct`. O fallback comum
  continua disponível apenas fora do modo NSFW.
- `?orcamentoTokens=leve|equilibrado|completo` ajusta frames, eventos e bytes do
  contexto antes da serialização. O perfil `equilibrado` é o padrão e reproduz
  os limites antigos (4 imagens, 20 eventos, 16 KB). É distinto de `?perfil=`
  (pose/mãos), `?perfilModelosNsfw=` (detectores) e `?descricaoCorporal=`
  (linguagem). Tokens exatos continuam sendo contados pelo backend.
- O prompt interpretativo passou a remover apenas linhas duplicadas exatas; sem
  duplicata o texto é idêntico ao anterior (`prompt-interpretacao-4`).
- A interface tem um painel de revisão local: comparação **lexical** SFW ×
  especializada e feedback com tipo, `frameId`/`cicloId`, rótulo e comentário.
  O repositório guarda só metadados e texto no `localStorage`; campos de mídia
  ou peso são descartados e cada registro pode ser removido. A comparação
  imprime `N/A` quando falta uma descrição, nunca `0%`.

Implementação: [`src/configuracao-gemma-servidor.ts`](../src/configuracao-gemma-servidor.ts),
[`src/nsfw-prompt/orcamento-tokens.ts`](../src/nsfw-prompt/orcamento-tokens.ts),
[`src/nsfw-prompt/composicao.ts`](../src/nsfw-prompt/composicao.ts),
[`public/ui/revisao-local.ts`](../public/ui/revisao-local.ts) e
[`scripts/verificar-gemma-fase5.mjs`](../scripts/verificar-gemma-fase5.mjs).
Testes: `tests/fase5-nsfw-configuracao-e-orcamento.test.ts`,
`tests/fase5-nsfw-comparacao-e-feedback.test.ts`,
`tests/server-visao/fase5-nsfw-preparar.test.ts` e
`tests/scripts/verificar-gemma-fase5.test.mjs`.

**Não entregue / N/A:** disponibilidade real no LM Studio, warmer em sessão
longa, latência, RAM, contagem real de tokens, ganho de qualquer perfil e
comparação semântica entre descrições. `npm run verificar:gemma:nsfw` sem
`--health` imprime `INCONCLUSIVO` e deixa latência/RAM/precisão/recall em `N/A`.

## Fase 6 — validação e manutenção

A Fase 6 entregou **protocolo e validadores**, não resultado de medição:

- `src/domain/dataset-nsfw.ts` valida um manifesto declarativo de separação
  treino/tuning/teste. Exige nome de arquivo relativo, SHA-256 de 64 hex e
  anotação revisada/esquema v2 no split de teste; detecta repetição de hash
  entre splits. Não lê mídia e não verifica se o hash bate com os bytes.
- `src/domain/metricas-nsfw-por-classe.ts` conta `tp`/`fp`/`fn` por
  `(clip, modelo, classe)` e só publica precisão/recall/f1 quando a anotação é
  revisada e do conjunto de teste/eval. Sem isso, os três campos são `null`.
- `src/domain/avaliacao-descricoes-humanas.ts` monta pares cegos A/B com ordem
  estável derivada do id (sem aleatoriedade) e exige no mínimo dois revisores
  distintos por amostra antes de registrar consenso. Preferência cega não é
  taxa de acerto.
- `src/domain/proveniencia-pesos.ts` valida origem, licença, revisão e SHA-256
  **declarados** dos pesos e sinaliza fontes `resolve/main`, cujo conteúdo pode
  mudar sem trocar de ID. Não baixa nem inspeciona arquivos de peso.
- `src/domain/auditoria-privacidade.ts` classifica uma lista de caminhos
  versionados (mídia, peso, log, segredo, texto) a partir de nomes/extensões.
  Não lê conteúdo: ausência de caminho suspeito **não** é varredura de segredos.
- `src/domain/varredura-segredos.ts` procura padrões conhecidos em trechos de
  texto e **redige** o valor suspeito antes de relatá-lo. Placeholders de
  documentação são ignorados; o resultado é candidato a revisão, nunca prova.
- `npm run verificar:fase6:nsfw` aceita manifestos opcionais e imprime
  `INCONCLUSIVO` com precisão/recall/f1/latência/RAM em `N/A` quando não há
  anotação revisada. `git ls-files` é usado apenas para a auditoria de nomes.
- `npm run verificar:segredos:nsfw` varre o conteúdo dos arquivos versionados e
  as linhas adicionadas em todo o histórico Git, além de auditar os caminhos que
  já passaram pelo repositório. Na execução desta fase (309 commits) houve
  **0 candidatos de conteúdo**; os dois PNGs sintéticos continuam sinalizados.
  Isso é resultado heurístico, não certificado de ausência de segredos.

**Achado da auditoria executada nesta fase:** dois PNGs sintéticos
(`bench/imagens/cena-640x480.png`, `bench/imagens/cena-1280x720.png`) continuam
versionados — são fixtures geradas por `scripts/gerar-fixtures-bench.mjs` e
descritas em `bench/README.md`, sem conteúdo adulto ou privado. Foram
sinalizados, não removidos: a decisão de desenrastreá-los exige regeneração
pelo script antes de qualquer benchmark. `.env.example` é tratado como modelo,
não como segredo.

Implementação: [`src/domain/dataset-nsfw.ts`](../src/domain/dataset-nsfw.ts),
[`src/domain/metricas-nsfw-por-classe.ts`](../src/domain/metricas-nsfw-por-classe.ts),
[`src/domain/avaliacao-descricoes-humanas.ts`](../src/domain/avaliacao-descricoes-humanas.ts),
[`src/domain/proveniencia-pesos.ts`](../src/domain/proveniencia-pesos.ts),
[`src/domain/auditoria-privacidade.ts`](../src/domain/auditoria-privacidade.ts),
[`src/domain/varredura-segredos.ts`](../src/domain/varredura-segredos.ts),
[`scripts/verificar-fase6-nsfw.mjs`](../scripts/verificar-fase6-nsfw.mjs) e
[`scripts/varrer-segredos-nsfw.mjs`](../scripts/varrer-segredos-nsfw.mjs).
Testes: `tests/fase6-nsfw-dataset-metricas.test.ts`,
`tests/fase6-nsfw-revisao-proveniencia.test.ts`,
`tests/fase6-nsfw-varredura-segredos.test.ts`,
`tests/scripts/verificar-fase6-nsfw.test.mjs` e
`tests/scripts/varrer-segredos-nsfw.test.mjs`.

**Não entregue / N/A:** dataset adulto anotado, métricas reais por classe/modelo,
revisão humana cega coletada, proveniência dos pesos efetivamente carregados no
LM Studio, revisão humana dos candidatos de segurança e benchmark comparativo.
A varredura cobre padrões conhecidos em texto: formatos novos, segredos em
binários e vazamentos fora do Git não são detectados por ela. Nenhum número
destes harnesses é uma taxa de acerto.

## E2E com clipe adulto real — conferência humana

`npm run test:e2e:nsfw:video` (ou `npx playwright test
e2e/nsfw-video-real.spec.ts --workers=1`) reproduz um arquivo `nsfw*` de
`bench/videos/` como se fosse webcam. O teste é **opt-in**: defina
`E2E_WEBCAM_CLIP` com o caminho do arquivo; `E2E_WEBCAM_DURATION_MS` limita a
janela medida e `E2E_WEBCAM_EVENTOS` escolhe o prefixo dos artefatos.

Durante a execução os seis pesos locais de `modelos/yolonsfw/` são requisitados
e as marcações de cada frame são gravadas **antes** da chamada ao backend. Por
isso o classificador continua produzindo resultado mesmo com o LM Studio
desligado: nesse caso a descrição multimodal fica `N/A` e o erro é registrado à
parte. O teste falha se nenhum frame com campo `nsfw` chegar ao servidor ou se
algum dos seis modelos não for carregado.

Tudo é escrito em `logs/` (gitignored): `.deteccoes.jsonl`, `.eventos.jsonl`,
`.respostas.jsonl`, `.erros-backend.jsonl` e, principalmente,
`.revisao.md`. A folha de revisão traz offset desde o início da reprodução,
SHA-256 do clipe, resolução, limiar, rótulo, score, caixa normalizada e caixa em
pixels, além de colunas vazias para `Acerto?`, observação, revisor e data. Ela
**não** calcula precisão/recall/F1: não há anotação revisada nem denominador.
`make_love` é apresentado como indício temporal, nunca confirmação do ato.

Implementação: [`e2e/nsfw-video-real.spec.ts`](../e2e/nsfw-video-real.spec.ts),
[`src/domain/relatorio-revisao-nsfw-video.ts`](../src/domain/relatorio-revisao-nsfw-video.ts).
Teste do formatador: `tests/nsfw-video-revisao.test.ts`.

## Limites que seguem em aberto

O dataset anotado e a medição real seguem pendentes. Permanece INCONCLUSIVO:
a calibração numérica por modelo/classe, a concorrência efetiva dos workers
reais, o valor ótimo de paralelismo, P50/P95 de latência e RAM/heap/WASM no
PC alvo, a precisão/recall de ações NSFW, a cronologia e as evidências do
modelo revisadas por humano, e a equivalência Python × ONNX do
pré-processamento. Não existe clipe adulto anotado com início/fim de ação em
resolução melhor que 1 fps; `bench/clipes/eval/manifest.json` cobre apenas
`movimento_objeto.objeto_deslocado`. As fases 5–6 do plano também seguem
pendentes: configuração centralizada do Gemma e avaliação humana. Nenhuma
precisão, recall ou ganho de latência é afirmado sem medição com dados anotados.

Este subsistema continua **experimental** e separado do modo de segurança.
