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
passou para `prompt-interpretacao-2` porque o contrato do prompt multiframe
ganhou o perfil.

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

## Limites que seguem em aberto

O dataset anotado e a medição real seguem pendentes. Permanece INCONCLUSIVO:
a calibração numérica por modelo/classe, a concorrência efetiva dos workers
reais, o valor ótimo de paralelismo, P50/P95 de latência e RAM/heap/WASM no
PC alvo. As fases 4–6 do plano também seguem pendentes: timestamps nas
marcações, seleção adaptativa de frames, separação entre anatomia e ação,
configuração centralizada do Gemma e avaliação humana. Nenhuma precisão, recall
ou ganho de latência é afirmado sem medição com dados anotados.

Este subsistema continua **experimental** e separado do modo de segurança.
