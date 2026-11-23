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

## Limites que seguem em aberto

As fases 2–6 do plano permanecem pendentes: dataset anotado de corpos sem camisa,
prompt de descrição corporal neutra, agrupamento espacial com hipóteses
conflitantes, calibração por modelo/classe, perfis de execução, timestamps nas
marcações, seleção adaptativa de frames, separação entre anatomia e ação,
configuração centralizada do Gemma e avaliação humana. Nenhuma precisão, recall
ou ganho de latência é afirmado sem medição com dados anotados.

Este subsistema continua **experimental** e separado do modo de segurança.
