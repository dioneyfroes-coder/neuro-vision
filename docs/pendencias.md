# Pendências de avaliação — Neuro Vision

Este documento registra avaliações **adiadas de propósito**, com protocolo e critério de aceite, para que não se percam entre fases. Pendência aqui não significa ausência de teste: o comportamento determinístico continua coberto por testes unitários e pelo benchmark de cadência. O que falta é a validação com **dados reais anotados**.

## Fase 3 — Validação real do motor de atenção

**Status:** `INCONCLUSIVO`. A implementação determinística está entregue e coberta por testes (`tests/fase3-atencao.test.ts`), mas nenhuma medição real foi feita com hardware/câmera/dados anotados. Não marcar como concluída sem evidência.

Para aceitar a Fase 3 em campo faltam:

- sessão contínua de 30 min (soak real) com a cadência adaptativa ligada, comparando quedas de FPS e uso de memória nos cinco estados;
- clipes anotados com entrada/saída de pessoas e mudanças de objeto, verificando se `atencao`/`pos_evento` antecedem o evento sem gerar oscilação;
- conferência das janelas congeladas contra os segmentos de vídeo reais, inclusive quedas de câmera e `naoAmostrado`, para garantir que nenhuma cobertura seja inventada;
- benchmark multimodal com backend local disponível (hoje fora do ar em `http://localhost:1234`), separando custo da detecção COCO da latência do modelo de visão.

O protocolo de soak acelerado e o veredito atual estão em [`soak.md`](./soak.md); o desenho do motor está em [`fase-3-atencao.md`](./fase-3-atencao.md).

## Fase 1.5–1.6 — Avaliação real de gestos

**Status:** adiada em 2026-11-15. **Não bloqueia a Fase 2** (fortalecimento do motor temporal).

A Fase 1 já entregou:

- 1.1–1.2 — correção da geometria X/Y e testes com landmarks sintéticos em diferentes proporções de imagem;
- 1.3–1.4 — cadência independente por subsistema e benchmark de 5 FPS (`npm run bench:cadencia`, `e2e/webcam-cadencia.spec.ts`).

Faltam os itens que dependem de gravação e anotação de clipes reais:

- 1.5 — pequenos vídeos anotados com gestos **estáticos e dinâmicos**;
- 1.6 — medição de **precisão, recall, falsos positivos, falsos negativos e atraso de detecção**.

### Por que foi adiada

A gravação exige pessoas reais, consentimento e anotação manual; não é pré-requisito técnico para o motor temporal. Adiar permite avançar na Fase 2 sem confundir “regra implementada e testada” com “regra validada em campo”. O critério da Fase 1 (“demonstrar, com vídeos de teste, que as correções melhoram a detecção sem tornar o sistema instável no hardware de referência”) continua **aberto** e precisa ser cumprido antes da aceitação final do projeto.

### O que gravar

Clipes de **10–20 s**, na mesma enquadragem do uso alvo (webcam a ~0,5–1,5 m), com o vídeo-fonte em 720p/30 fps. Gravar pelo menos **duas pessoas** e as duas mãos, com o dorso e a palma voltados para a câmera.

**Gestos estáticos** (mínimo de 5 repetições por gesto):

- mão aberta, punho fechado, polegar para cima e polegar para baixo;
- um dedo (indicador), dois dedos (V), três e quatro dedos;
- combinações arbitrárias de dedos estendidos/dobrados;
- pinça (polegar + indicador), se a geometria for avaliada para esse gesto.

**Gestos dinâmicos e transições:**

- aceno (mão indo e voltando);
- transição polegar para cima ↔ polegar para baixo;
- braço subindo e descendo (`transicao_acao`) e postura mantida (`braco_levantado`);
- movimento repetido de dedos;
- mão entrando e saindo do quadro;
- mão cruzando o corpo ou outra mão (teste de lateralidade e de associação).

**Condições adversas:**

- oclusão parcial (mão atrás de um objeto ou da outra mão);
- movimento rápido entre snapshots;
- iluminação frontal, contraluz e ambiente escuro;
- diferentes distâncias e proporções de imagem (16:9, 4:3 e retrato).

**Clipes negativos, sem o gesto alvo**, para medir falsos positivos: pessoa parada, braços ao lado do corpo, conversa com as mãos fora do quadro e objetos em movimento sem gesto.

### Como anotar

Seguir o formato de [`bench/videos/README.md`](../bench/videos/README.md). Para cada evento anotado, registrar:

- rótulo do gesto ou tipo de evento (`gesto_detectado`, `braco_levantado`, `transicao_acao`);
- início e fim reais (timestamp ou número do frame de origem);
- identidade temporária do rastro da mão e da pessoa, quando aplicável;
- estado esperado (`confirmado`/`encerrado`) e evidências esperadas;
- classificação do trecho: postura estática, transição ou gesto dinâmico;
- observações de oclusão, iluminação e movimento rápido.

O casamento entre anotação e evento detectado usa **rótulo igual + sobreposição temporal** (IoU ≥ 0,5). Um evento sem anotação correspondente é falso positivo; uma anotação sem evento é falso negativo. Para o atraso, medir duas coisas separadas:

- **erro de início:** `inicioEm` do evento menos o início anotado;
- **atraso de confirmação:** instante do primeiro registro com estado `confirmado` (em `logs/eventos-temporais.jsonl` ou no diagnóstico do ciclo) menos o início anotado.

### Métricas obrigatórias

- precisão e recall por gesto (matriz de confusão quando houver mais de um rótulo);
- falsos positivos por minuto em clipes negativos;
- falsos negativos por minuto e por gesto;
- atraso de início e de confirmação (média e p95);
- continuidade do rastro após oclusão curta (o ID é preservado?);
- associação mão↔pessoa: percentual de mãos atribuídas à pessoa correta em clipes com duas ou mais pessoas, e quantas ficaram sem atribuição quando ambíguas;
- FPS efetivo e estabilidade no hardware de referência.

### Critério de aceite (meta inicial, a confirmar com a primeira linha de base)

| Métrica | Meta |
| --- | --- |
| Gestos estáticos — precisão | ≥ 0,90 |
| Gestos estáticos — recall | ≥ 0,80 |
| Gestos dinâmicos/transições — precisão | ≥ 0,85 |
| Gestos dinâmicos/transições — recall | ≥ 0,70 |
| Falsos positivos em clipes negativos | ≤ 1 evento/min |
| Atraso de confirmação — média | ≤ 400 ms |
| Atraso de confirmação — p95 | ≤ 800 ms |
| Continuidade de ID em oclusão curta (≤ 3 frames / ≤ 600 ms) | ≥ 90% |
| Associação mão↔pessoa correta (duas pessoas, punhos visíveis) | ≥ 95% |
| Cadência no hardware de referência | `fpsEfetivo >= 4.5` para mãos, sem instabilidade |

As metas são **proposta inicial**: quando a primeira linha de base for medida, o número real pode ser mantido, ajustado ou rejeitado. Qualquer revisão precisa ser registrada neste documento com data e justificativa — nunca reduzir a meta em silêncio. Abstenção (não atribuir a mão a nenhuma pessoa) é preferível a uma associação errada; abstenções não contam como falso positivo de associação.

### Roteiro de execução

1. Gravar os clipes com `npm run gravar:webcam` (`scripts/gravar-webcam.mjs`) ou outro capturador, mantendo os vídeos **fora do versionamento** quando houver pessoas.
2. Anotar conforme [`bench/videos/README.md`](../bench/videos/README.md).
3. Rodar a avaliação com `npm run qualidade` e, para cadência, com a política `?benchmark=5fps` + `npm run bench:cadencia`.
4. Publicar um relatório `bench/RELATORIO_GESTOS_<AAAAMMDD>.md` com conjunto, hardware, métricas, matriz de confusão, falhas e limitações.
5. Atualizar esta página com o resultado, o link do relatório e a decisão sobre quais gestos são suportados.

### Concluída quando

- as anotações estiverem versionadas e os vídeos identificados (locais, quando sensíveis);
- houver relatório com as métricas acima e veredito explícito contra o critério de aceite;
- estiver registrado o que o sistema **não** reconhece, em vez de deixar a limitação implícita.

> **Cobertura determinística já existente (Fase 2.6):** o motor temporal tem testes sintéticos para oclusão curta, movimento rápido, queda de confiança/iluminação e troca de gesto — listados em [`qualidade.md`](./qualidade.md#testes-de-estresse-do-motor-temporal-fase-26). Eles validam a **regra** (não duplicar, não encerrar sem substituto confirmado, não herdar track após salto); não substituem a medição de precisão e recall em vídeo real descrita acima.

## Fase 4 — Itens de atenção orientada a eventos

**Status:** concluída em 2026-11-18. Os itens 1, 3 e 4, que permaneciam abertos, foram implementados e cobertos por testes determinísticos; o item 2 (IDs temporários de rastreamento) veio da Fase 2 e o slice de **interação mão↔objeto** (itens 5–7) já estava concluído.

| Item do roteiro | Implementação | Verificação determinística |
| --- | --- | --- |
| 1 — Entrada e saída de pessoas | `DetectorPresencaPessoas` (`public/temporal/presenca-pessoas.ts`) emite `aparicao`/`desaparecimento` a partir do track de pose, com `entidadeId` estável, histerese de entrada/saída, preservação da última evidência e supressão da duplicata `person` do detector de objetos. | `tests/presenca-pessoas.test.ts` e `tests/motor-temporal.test.ts` cobrem o par entrada/saída, `frameIds`/timestamps, oclusão curta, período cego, pose não amostrada e estabilidade do ID. |
| 3 — Frequência adaptativa na entrada de pessoas | `src/domain/frequencia-adaptativa.ts` reduz o estado por timestamps, sem relógio de parede. `politicaCiclo.frequenciaAdaptativa` e `POLITICA_CICLO_BENCHMARK_ADAPTATIVA` (`?benchmark=adaptativa`) aplicam a cadência efetiva antes de `planejarAmostragem`; a histerese combina `framesParaSair` e `manterAposUltimaEvidenciaMs`. | `tests/frequencia-adaptativa.test.ts` cobre entrada, oclusão, saída com histerese e determinismo; `tests/ciclo-percepcao-controller.test.ts` confere `fpsEfetivo` 2,5 → 5 no intervalo da entrada e a volta à base. |
| 4 — Priorização de objetos próximos | `public/interpretation/proximidade-objetos.ts` ordena detecções por distância ao punho/torso (`proximidade`), mantém as demais e registra o excedente compactado em `deteccoesReduzidas` e `truncamento.gruposRemovidos`. NSFW e frames de evidência nunca entram na poda. | `tests/proximidade-objetos.test.ts` e `tests/contexto-esquema.test.ts` cobrem ordem, não descarte silencioso, poda declarada e preservação de NSFW/evidência. |

A documentação do comportamento implementado está em [`eventos.md`](./eventos.md#entrada-e-saída-de-pessoas-fase-4), [`eventos.md`](./eventos.md#interação-mãoobjeto-fase-4) e [`arquitetura.md`](./arquitetura.md#frequência-adaptativa-na-entrada-de-pessoas-fase-4). O critério geral da Fase 4 — “registrar sequências simples de interação sem transformar proximidade em contato confirmado” — continua atendido. A validação com vídeos reais anotados da Fase 1.5–1.6 segue adiada e **não** é pré-requisito para esta conclusão técnica.

## Fase 6 — robustez, desempenho e operação contínua

**Status:** implementada em 2026-11-18; pendências abaixo são de **validação com dados reais**, não de código.

| Item do roteiro | Implementação | Verificação determinística |
| --- | --- | --- |
| 1 — Medir CPU, GPU, RAM e armazenamento | `/api/health` expõe `sistema` (CPU/RAM do processo, núcleos, bytes de vídeo e taxa horária estimada) e `monitoramento` (sessão, segmentos, quadros, lacunas). GPU fica `null` com `motivo` quando não há API real. | `tests/server.test.ts` e `tests/api.test.ts` cobrem o contrato do health e `saudeSistema`. |
| 2 — Sessões prolongadas | Gravação contínua com rotação de segmentos e índice durável; 30 min em `tests/monitoramento.test.ts`/`tests/monitoramento-persistencia.test.ts` e sessão longa com rotações no gravador cliente. | Sem relógio de parede: timestamps sintéticos. O harness `npm run validar:soak` ([`soak.md`](./soak.md)) verifica telemetria real, mas a execução de 30 min em tempo real no hardware de referência ainda precisa ser arquivada. |
| 3 — Queda e retorno da câmera | `public/camera.ts` detecta `ended`/`mute`/`error` e reconecta com backoff injetável; o controlador suspende apenas metadados e renova o gravador no retorno, fechando o segmento anterior como `pausa` (não como `lacuna`). | `tests/camera.test.ts`, `tests/gravador-cliente.test.ts` e o E2E `e2e/monitoramento-camera.spec.ts`, que para a trilha real e verifica reconexão, fechamento como `pausa`, retomada com quadros e registro operacional. |
| 4 — Workers/IA indisponíveis | Fallback local e erros de visão já viram registro operacional; a gravação segue independente. | `tests/motores-remotos.test.ts`, `tests/workers-atender.test.ts` e `tests/local-perception-pipeline.test.ts`. Faltam clipes anotados para medir degradação de qualidade. |
| 5 — Gravação contínua durante falhas | `aoErro` do monitoramento e falhas do servidor gravam em `operacional.jsonl`; `MediaRecorder` trata erro com segmento ativo e renova sem encerrar; uploads falhados ficam pendentes. | `tests/gravador-cliente.test.ts`, `tests/server.test.ts` (registrarFalha) e `tests/api.test.ts` (HTTP não-OK). |
| 6 — Retenção, exclusão e proteção | Rotas existentes ligadas à UI (**Aplicar retenção** / **Excluir vídeos da sessão**), retenção também na subida, exclusões auditadas, bind em loopback por padrão. | `tests/server-videos.test.ts` e `tests/armazenamento-videos.test.ts`. Sem autenticação/criptografia embutidas: exposição exige reverse proxy. |
| 7 — Iluminação e oclusão | Roteiros sintéticos de contraluz e oclusão parcial em `tests/qualidade-eventos.test.ts`, documentados em [`qualidade.md`](./qualidade.md#robustez-sob-condições-degradadas-fase-6). | Prova a regra da política. O gate `npm run validar:condicoes` ([protocolo](../bench/clipes/oclusao-iluminacao/README.md)) ainda não tem clipes revisados e termina `INCONCLUSIVO`; não substitui a avaliação com anotações humanas. |

**Critério de conclusão:** "o monitoramento deve continuar gravando e registrando falhas mesmo quando a análise inteligente estiver degradada" — atendido no código e em testes determinísticos. A E2E de troca de `MediaStream` passou a existir na Fase 7; seguem pendentes a execução do soak de 30 min em tempo real e a avaliação de iluminação/oclusão com clipes anotados e revisados (ver protocolo nas seções Fase 1.5–1.6 acima e `bench/clipes/MATRIZ_COBERTURA.md`).

## Fase 7 — validação real

**Status:** harnesses implementados em 2026-11-18; a **coleta de dados reais ainda não foi feita**. Nenhum veredito de aceite foi inventado.

| Frente | O que existe agora | O que ainda depende de execução/dados |
| --- | --- | --- |
| Soak com telemetria | `npm run validar:soak` ([`soak.md`](./soak.md)): servidor real em diretório temporário, quadros com timestamps simulados, lacunas injetadas, upload de bytes, amostras de CPU/RAM/armazenamento do `/api/health`, invariantes de cobertura e relatório JSON. Regra pura em `src/monitoramento/validacao-soak.ts`, coberta por `tests/soak-validacao.test.ts`. | Rodar `--duracao-ms 1800000` (30 min reais) no hardware de referência e arquivar o relatório. O modo `--acelerar` é diagnóstico e termina `INCONCLUSIVO`. |
| Queda/retorno de câmera | `e2e/monitoramento-camera.spec.ts`: para a trilha de vídeo da stream real do navegador, espera reconexão, verifica renovação de segmento (fechado como `pausa`), retomada com quadros e registro operacional via rotas/API. | Repetir no Chrome com webcam física e no Firefox/WebKit, se esses navegadores entrarem na matriz de suporte. |
| Iluminação/oclusão | Regra pura em `src/domain/avaliacao-condicoes.ts`, gate `npm run validar:condicoes`, relatório em `logs/condicoes/` e protocolo em [`bench/clipes/oclusao-iluminacao/README.md`](../bench/clipes/oclusao-iluminacao/README.md). A regra distingue `baixa_confianca` de `movimento`/`nova_entidade`/`desaparecimento` e exige anotação revisada. | Gravar clipes com consentimento, conferir intervalos quadro a quadro e anotar três ocorrências por condição mais dois negativos. Sem isso, o gate termina `INCONCLUSIVO` com código não zero. |

**Observação sobre o E2E:** o Chromium não emite `ended` quando `track.stop()` é chamado, então o teste para a trilha de vídeo real e dispara o evento `ended` que uma desconexão física emitiria. As streams, o `getUserMedia`, o `MediaRecorder`, a reconexão e as rotas HTTP são reais; a desconexão física da webcam permanece fora da cobertura automatizada.

**Critério de aceite da Fase 7:** soak de 30 min sem sobreposição/perda de quadros, com lacunas injetadas explicadas e crescimento de RSS dentro do limite; E2E de troca de stream verde; e gate de condições `APROVADO` com clipes revisados. Até o último item existir, a Fase 7 está **parcial** — os harnesses não são a medição.

## Outras pendências registradas

Novas avaliações adiadas devem entrar neste documento com o mesmo formato da Fase 1.5–1.6: motivação, dados necessários, métricas e critério de aceite. Itens de implementação ainda abertos (como os da Fase 4 acima) ficam registrados com o mesmo nível de detalhe, mas marcados como tal.
