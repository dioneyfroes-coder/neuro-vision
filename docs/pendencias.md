# Pendências de avaliação — Neuro Vision

Este documento registra avaliações **adiadas de propósito**, com protocolo e critério de aceite, para que não se percam entre fases. Pendência aqui não significa ausência de teste: o comportamento determinístico continua coberto por testes unitários e pelo benchmark de cadência. O que falta é a validação com **dados reais anotados**.

## Fase 3 — Validação real do motor de atenção

**Status:** `INCONCLUSIVO` para a cadência adaptativa em campo; o **soak do gravador** passou em 2026-11-22 (`APROVADO`, 30 min reais, ver [`soak.md`](./soak.md)). A implementação determinística está entregue e coberta por testes (`tests/fase3-atencao.test.ts`, `tests/server-atencao.test.ts`). Não marcar a Fase 3 como concluída sem evidência de câmera real: o soak aprovado é server-side e não exercita `MediaRecorder`, os cinco estados nem a cadência adaptativa.

Para aceitar a Fase 3 em campo faltam:

- sessão contínua de 30 min com a **cadência adaptativa ligada em navegador/câmera real**, comparando quedas de FPS e uso de memória nos cinco estados (o soak server-side de 30 min já aprovado cobre apenas servidor, índice de segmentos, lacunas e uploads);
- clipes anotados com entrada/saída de pessoas e mudanças de objeto, verificando se `atencao`/`pos_evento` antecedem o evento sem gerar oscilação;
- conferência das janelas congeladas contra os segmentos de vídeo reais, inclusive quedas de câmera e `naoAmostrado`, para garantir que nenhuma cobertura seja inventada;
- benchmark multimodal com backend local disponível (hoje fora do ar em `http://localhost:1234`), separando custo da detecção COCO da latência do modelo de visão.

O protocolo, o veredito do soak acelerado e o resultado do soak real de 30 min estão em [`soak.md`](./soak.md); o desenho do motor está em [`fase-3-atencao.md`](./fase-3-atencao.md).

## Fase 4 — Validação real de ações

**Status:** implementação determinística entregue; precisão e atraso em clipes reais `N/A` até existir anotação humana. Os itens 1–6 do checklist canônico estão cobertos por testes; os itens 7–8 permanecem em aberto. Ver [`fase4-acoes.md`](./fase4-acoes.md).

Para aceitar a Fase 4 com dados reais faltam:

- clipes anotados com mão↔pessoa (duas ou mais pessoas, punhos visíveis e casos ambíguos), mão↔objeto, aproximação/contato/manipulação e pego/deixado;
- anotação explícita de oclusão, `naoAmostrado` e falha de inferência, verificando que nenhum desses casos vire `deixado` ou ausência observada;
- execução do harness sobre `logs/eventos-temporais.jsonl` com `inicioEm` e sidecar de início do clipe, publicando precisão/recall e `atraso` (média e p95) por gesto/classe;
- conferência do par estado anterior/posterior contra mudanças de estado observadas pelo inventário, sem casamento por rótulo parecido;
- relatório com veredito contra metas e registro do que o sistema não reconhece.

O harness já emite `atraso` como `N/A` quando não há correspondência; isso é ausência de medição, não resultado de precisão. As metas numéricas de gestos continuam propostas em §Fase 1.5–1.6 e só passam a ser aplicadas à Fase 4 depois da primeira linha de base anotada.

## Fase 5 — Limitações conhecidas

**Status:** os sete itens do checklist canônico estão implementados e cobertos por testes determinísticos (`tests/fase5-eventos.test.ts`, `tests/server-fase5.test.ts`). O que segue são limitações reais, não pendências de implementação do checklist:

- `segmentosParaIntervalo()` cruza apenas tempo, não `sessionId`. Sessões com janelas de vídeo sobrepostas podem vincular um evento ao segmento da outra. Não foi alterado porque os testes de integração atuais usam `sessionId` de ciclo distinto do `sessaoId` da gravação; corrigir exige primeiro alinhar essa convenção nos produtores.
- A reidratação do controlador entre sessões é parcial: `GET /api/contexto?sessionId=` reconstrói entradas/eventos, mas o estado interno do motor temporal e do ciclo de percepção não é restaurado por sessão.
- A exportação lê no máximo 20.000 registros por stream. Para históricos maiores, filtre por sessão/período; não há pagamento/streaming de exportação.
- Não há E2E cobrindo a timeline centrada em eventos, os botões de vídeo no `offsetMs`, o formulário de correção nem o download CSV/JSONL. Os contratos HTTP e as regras puras são testados; a interação no navegador não.
- A correção é auditável por append-only, mas a API expõe apenas a versão mais recente por `eventoId`. As versões anteriores continuam no JSONL e podem ser lidas diretamente; ainda não há endpoint de "histórico de correções" de um evento.

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

## Fase 6 — interpretação multimodal

**Status:** código concluído em 2026-11-22; pendências abaixo são de **validação com dados reais**, não de implementação. Detalhes em [`fase6-multimodal.md`](./fase6-multimodal.md).

| Frente | O que existe agora | O que ainda depende de execução/dados |
| --- | --- | --- |
| Política orientada a eventos | `src/domain/politica-multimodal.ts` unifica modos e motivos; `quando_evento_relevante` é o modo desejável, `sob_demanda` continua o padrão operacional. | Rodar monitoramento com o modo orientado a eventos em clipe anotado e registrar se as ativações foram úteis. Sem isso, não se afirma que a política foi validada. |
| Seleção de frames e schema | Seleção por sinais locais com queda para amostragem uniforme; schema `resposta-1` valida a resposta antes de qualquer uso. | Medir se a seleção melhora a narrativa em comparação com a amostragem uniforme, com anotação revisada. |
| Evidência e inferência | Referências inválidas são separadas; afirmações sem suporte não entram nos fatos; `distincaoEvidencia` mantém status local separado da natureza declarada pelo modelo. | Revisar manualmente uma amostra de respostas reais para confirmar que nenhuma afirmação sem evidência vazou para a timeline. |
| Latência e custo por evento | Tokens, duração, latência até resposta e `versaoPrompt` são propagados; `custoMultimodal` registra ausência de preço em vez de inventar valor. | Backend real disponível para medir latência e uma tabela de preços explícita (entrada/saída) para gerar `custoEstimado`. Até então, precisão e custo reais são `N/A`. |
| Comparação com anotações humanas | `npm run avaliar:multimodal` compara respostas já coletadas com afirmações esperadas e só emite taxas para anotação `eval` revisada. | Clipe com consentimento, anotação revisada quadro a quadro e respostas multimodais reais coletadas. Os exemplos atuais são rascunhos e não produzem precisão real. |

**Critério de conclusão da validação:** backend real executando sobre clipe anotado revisado, com respostas coletadas, comparação léxica arquivada, latência medida e custo calculado apenas com preço declarado. Nenhum desses itens pode ser substituído por teste sintético.

## Fase 7 — operação contínua e segurança

**Status:** implementação de código concluída em 2026-11-22 e documentada em [`fase7-operacao-seguranca.md`](./fase7-operacao-seguranca.md). As pendências abaixo são de **execução real/hardware/dados anotados**, não de código. Nenhum resultado sintético é apresentado como medição de campo.

| Item do plano mestre | Situação | O que ainda depende de mundo real |
| --- | --- | --- |
| Recuperar sessão após queda | Recuperação no índice append-only: sessão abandonada → `interrompida`; segmento aberto → `incompleto` com lacuna explícita; `uploadsPendentes` sinalizado. `tests/fase7-operacao-seguranca.test.ts`. | Queda abrupta real do processo durante gravação e reconciliação com o arquivo de vídeo efetivamente gravado. |
| Validar segmento incompleto e upload pendente | Regra pura + aplicação idempotente; a ausência de arquivo nunca é tratada como cobertura. | Interrupção real de rede no upload e disco cheio durante `writeFile`; ver linhas abaixo. |
| Soak real de 30 min | **Concluído em 2026-11-22, `APROVADO`**, relatório arquivado em [`soak.md`](./soak.md). | Nada. |
| Sessão prolongada | Rotação de segmentos e índice durável cobertos por timestamps sintéticos. | Várias horas seguidas no hardware de referência, com métricas de RSS e crescimento do índice. |
| Webcam física e reconexão | `public/camera.ts` e E2E `e2e/monitoramento-camera.spec.ts` cobrem `ended`/`mute`/`error` com stream real do navegador. | Repetir com desconexão física da câmera e em outros navegadores da matriz. |
| Disco cheio / falha de escrita | Escrita atômica com arquivo temporário, limpeza em `catch` e registro operacional; retenção por espaço está habilitada. | Injectar falha real de filesystem/disco cheio e confirmar que nenhum segmento é anunciado como gravado. |
| Retenção | 30 dias / 500 arquivos / 5 GiB por padrão, motivos e IDs preservados auditáveis. | Definir, com o operador, quais IDs de eventos importantes devem ser preservados (`preservarSegmentoIds`). |
| Autenticação remota | `NEURO_API_TOKEN` opcional, Bearer/cookie assinado, login e `401` testados por HTTP real em servidor temporário. | Revisão de segurança independente e integração com o PROXY/IdP do operador, se aplicável. |
| Criptografia em repouso | AES-256-GCM com chave do operador e metadado `cifrado` explícito. | Gestão real de chaves (rotação, backup, revogação) e verificação em dispositivo de armazenamento de produção. |
| Auditoria | `logs/auditoria.jsonl` append-only, detalhes sensíveis removidos, não apagada por `DELETE /api/logs`. | Definir prazo de retenção da própria trilha e política de acesso a ela. |
| Consentimento e privacidade | Diretrizes em [`fase7-operacao-seguranca.md`](./fase7-operacao-seguranca.md) e [`seguranca.md`](./seguranca.md). | Aprovação do responsável/local e registro de consentimento das pessoas filmadas. |

**Iluminação e oclusão:** roteiros sintéticos em `tests/qualidade-eventos.test.ts` provam a regra da política, mas o gate `npm run validar:condicoes` ([protocolo](../bench/clipes/oclusao-iluminacao/README.md)) continua `INCONCLUSIVO` sem clipes anotados e revisados. Não é substituto para avaliação humana.

**Observação sobre o E2E:** o Chromium não emite `ended` quando `track.stop()` é chamado, então o teste para a trilha de vídeo real e dispara o evento `ended` que uma desconexão física emitiria. As streams, o `getUserMedia`, o `MediaRecorder`, a reconexão e as rotas HTTP são reais; a desconexão física da webcam permanece fora da cobertura automatizada.

**Critério de aceite da Fase 7:** sessão prolongada, webcam física/reconexão e disco cheio executados e arquivados, além do gate de condições `APROVADO` com clipes revisados. O soak de 30 min já atendeu sua parte. Até o restante existir, a Fase 7 está **parcial** — os harnesses não são a medição. Precisão, latência e custo reais seguem `N/A`.

## Outras pendências registradas

Novas avaliações adiadas devem entrar neste documento com o mesmo formato da Fase 1.5–1.6: motivação, dados necessários, métricas e critério de aceite. Itens de implementação ainda abertos (como os da Fase 4 acima) ficam registrados com o mesmo nível de detalhe, mas marcados como tal.
