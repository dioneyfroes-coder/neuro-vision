# Revisão técnica do Neuro Vision

**Data da revisão:** 24/10/2026  
**Material analisado:** `neuro-vision-main(1).zip`  
**Tipo de revisão:** inspeção estática de arquitetura, fluxo de dados, motor temporal, ciclo multi-frame, integração de modelos, benchmark e testes.  
**Limitação:** não foi possível concluir a instalação das dependências e executar a suíte automatizada neste ambiente. Os comandos de validação são registrados ao final.

## 1. Resumo executivo

O projeto evoluiu de forma significativa. A separação entre captura, pipeline local, workers, motor temporal, interpretação e persistência está mais clara. Há contratos explícitos para resultados indisponíveis, snapshots são preservados ao longo do ciclo e a etapa multimodal trabalha com o pacote capturado, sem realizar uma segunda captura. Também foram corrigidos problemas anteriores de duração dos eventos e de tratamento de falhas de inferência.

**Não recomendo reescrever o projeto nem fazer outra grande reorganização de pastas.** O próximo ganho deve vir da integração real entre os módulos, da correção semântica dos dados e de um benchmark válido.

O principal problema de integração encontrado é este: **o rastreador cria IDs estáveis para pessoas e mãos, mas esses IDs não são associados aos resultados de pose/mão que são serializados para o modelo multimodal.** Como consequência, o cálculo de movimento no contexto não consegue acompanhar essas entidades entre snapshots e tende a produzir uma lista `movimento` vazia, apesar de existir código para calcular deslocamento.

Outros pontos importantes:

1. O ciclo padrão captura quatro snapshots a cada **500 ms**. Isso cobre aproximadamente 1,5 segundo entre o primeiro e o último snapshot, e não uma sequência de aproximadamente quatro segundos com um snapshot por segundo.
2. O modo padrão chama a interpretação multimodal em todo ciclo, embora a decisão arquitetural documentada diga que a chamada deve obedecer a uma política e não ocorrer sempre. É preciso assumir explicitamente qual comportamento está sendo testado.
3. O motor temporal reconhece alguns gestos predefinidos e o sinal simples de braço levantado, mas ainda não implementa uma leitura geral de movimento corporal, flexão muscular ou estados individuais dos dedos.
4. O benchmark documentado tem apenas um clipe EVAL cuja anotação é descrita como verificada. Ele é insuficiente para afirmar que a arquitetura de percepção completa é mais precisa.
5. A configuração completa é cara no hardware medido pelos relatórios antigos, sobretudo devido ao primeiro carregamento do detector e ao modelo multimodal. Esses números são históricos e devem ser re-medidos no ambiente atual.

## 2. O que melhorou de forma concreta

### 2.1 Arquitetura mais modular

A separação está bem encaminhada:

- `public/capture/`: captura e armazenamento dos snapshots;
- `public/perception/`: detecção de objetos, pose, mãos, workers e pipeline local;
- `public/temporal/`: rastreamento, suavização, máquinas de estado e motor temporal;
- `public/interpretation/`: contexto, serialização, prompt e transporte ao modelo;
- `public/cycle/`: orquestração, política de interpretação e persistência do ciclo;
- `src/domain/`: tipos e contratos compartilhados.

Essa estrutura reduz o acoplamento e permite trocar uma implementação sem reescrever todo o fluxo. Não vejo benefício imediato em mover novamente todos esses arquivos. Priorize contratos e testes de integração entre os módulos.

### 2.2 O mesmo snapshot percorre o ciclo inteiro

`public/cycle/ciclo-multiframe.ts` captura e registra os snapshots antes de executar a percepção local. Os resultados são associados às observações correspondentes, e o pacote do ciclo segue para o interpretador sem uma nova captura de webcam. Isso evita a inconsistência de analisar um frame para detectar um evento e outro frame para descrevê-lo.

### 2.3 Falha de inferência não é tratada como ausência de detecção

O pipeline tem um estado explícito de subsistema indisponível. Uma falha do detector, da pose ou das mãos pode ser registrada sem invalidar automaticamente os resultados dos outros subsistemas. O motor temporal recebe esse estado e evita tratar toda falha como evidência de que a pessoa ou o gesto desapareceu.

Essa distinção é essencial para não criar desaparecimentos ou encerramentos falsos em momentos de lentidão, falha do worker ou carregamento de modelo.

### 2.4 Correção do encerramento temporal

A máquina de sinais agora encerra o evento usando a última evidência positiva, em vez de reutilizar indiscriminadamente o instante de início. Também protege a ordem temporal para que o fim não seja anterior ao início. Os testes existentes cobrem esse cenário.

### 2.5 Workers e paralelismo controlado

A percepção local executa os subsistemas por frame de maneira concorrente e limita quantos frames ficam em processamento ao mesmo tempo. Isso é uma estratégia razoável para controlar memória e latência. O paralelismo não garante que todos os modelos usem a GPU ou acelerem o processamento; isso depende do runtime, do dispositivo efetivo e da implementação de cada modelo.

### 2.6 Contexto multimodal mais estruturado

O esquema de contexto tem versão, timestamps, status por subsistema, detecções, keypoints, gestos, eventos temporais, referências a frames e limites de tamanho. Há ainda uma etapa para limitar payloads muito grandes. Isso é melhor do que enviar apenas imagens sem associação explícita às observações locais.

### 2.7 Outros pontos positivos

- Os IDs de sessão, ciclo e frame estão explícitos no fluxo.
- O ciclo registra métricas por etapa e erros de persistência.
- O classificador NSFW está desligado por padrão e marcado como experimental.
- Existem testes unitários para rastreamento, máquina de sinais, ciclo multi-frame e serialização.
- A configuração de CI descreve typecheck, lint, testes, build e E2E.

## 3. Achados por prioridade

## P1 — Corrigir antes de confiar na interpretação temporal

### P1.1 IDs do rastreamento não chegam ao contexto serializado

**Arquivos principais:**

- `public/temporal/motor-temporal.ts`
- `public/temporal/rastreador-entidades.ts`
- `src/domain/perception.ts`
- `public/interpretation/esquema.ts`
- `public/interpretation/contexto.ts`

**Problema observado:**

O motor chama `this.pessoas.atualizar(...)` e `this.maos.atualizar(...)`, que devolvem as entidades rastreadas, mas ignora o retorno e não preenche `entidadeId` nos objetos de pose e mão usados posteriormente. Entretanto, `calcularMovimento()` depende justamente de `pessoa.entidadeId` e `mao.entidadeId` para localizar a mesma entidade em dois snapshots. A serialização também só grava `trackId` quando esse campo existe.

**Impacto:**

O código de cálculo de movimento existe, mas não está conectado corretamente ao fluxo de dados normal. O modelo multimodal pode receber poses e landmarks individuais, porém não recebe uma identidade consistente para relacionar as observações da mesma pessoa/mão ao longo da sequência; consequentemente, o campo `movimento` pode ficar vazio. Isso compromete uma das finalidades centrais do motor temporal.

**Correção recomendada:**

1. Fazer o rastreador retornar associações explícitas entre o índice/ID da detecção atual e o `entidadeId` estável.
2. Criar observações enriquecidas por cópia, por exemplo `poseComTrackId` e `maosComTrackId`, sem alterar objetos compartilhados por efeitos colaterais.
3. Usar essas observações enriquecidas tanto para o motor de sinais como para serialização do contexto.
4. Adicionar um teste de integração com pelo menos três snapshots: mesma pessoa/mão em posições diferentes, IDs persistentes e `movimento` não vazio no contexto serializado.
5. Testar também o cenário em que uma entidade sai do campo e outra aparece no mesmo local, para evitar reaproveitamento incorreto de ID.

**Critério de aceite:** um movimento simulado entre dois frames válidos deve produzir um registro de movimento com `trackId`, direção, deslocamento e intervalo, e esse mesmo `trackId` deve estar presente nas observações serializadas.

### P1.2 Confusão entre movimento de objeto e movimento corporal

**Arquivo principal:** `public/temporal/motor-temporal.ts`

O mapa de eventos transforma o evento genérico `movimento` do rastreamento visual de objetos em `movimento_corporal`. O evento é convertido com origem `objetos`, portanto não necessariamente representa movimento de uma pessoa.

**Impacto:**

Um objeto que se desloca pode receber o rótulo semântico de movimento corporal. Ao mesmo tempo, não há um mecanismo geral que derive eventos de movimento corporal das trajetórias de keypoints da pose. Isso é especialmente importante se o modelo multimodal usar o tipo de evento como evidência de que uma pessoa se moveu.

**Correção recomendada:**

- Separar `movimento_objeto` de `movimento_corporal` no domínio, no resumo temporal e no contexto multimodal.
- Produzir eventos corporais usando mudanças de keypoints/ângulos articulares ou deslocamentos de entidades de pose rastreadas.
- Preservar uma origem semântica correta (`objetos`, `pose`, `maos`) e testar cada tipo independentemente.

### P1.3 O intervalo entre snapshots não corresponde ao plano original de um snapshot por segundo

**Arquivos principais:**

- `public/cycle/politica-ciclo.ts`
- `public/capture/webcam-capture.ts`
- `public/app.ts`

A política padrão usa `intervaloEntreSnapshotsMs: 500`, quatro snapshots por ciclo. Assim, os instantes aproximados são 0 ms, 500 ms, 1000 ms e 1500 ms — uma janela entre primeiro e último snapshot de aproximadamente 1,5 segundo.

Essa mudança parece deliberada, mas não corresponde ao plano discutido anteriormente de um snapshot por segundo durante quatro capturas.

**Impacto:**

A amostragem mais rápida pode ser melhor para certas transições, mas pode mudar o comportamento que você pretendia avaliar. Não compare resultados de testes diferentes como se a janela temporal fosse igual.

**Correção recomendada:**

Escolher e registrar explicitamente uma configuração de benchmark. Para testar o plano inicial, usar 1000 ms entre snapshots e quatro snapshots. Manter a configuração de 500 ms como variante adicional, se for útil comparar a latência e a capacidade de reconhecer movimentos.

### P1.4 Política de interpretação está divergente da decisão documentada

**Arquivos principais:**

- `public/cycle/politica-ciclo.ts`
- `public/app.ts`
- `public/modos.ts`
- `bench/DECISAO_ARQUITETURAL_2026-10-21.md`

O padrão atual usa `interpretacao: "a_cada_ciclo"`, e o modo padrão da interface é `percepcao`, que executa o pipeline completo. Já a decisão arquitetural documentada diz que o multimodal deve seguir uma política de análise e não ser chamado em todo ciclo.

**Isso não é necessariamente um bug:** chamar o multimodal em todos os ciclos faz sentido como variante experimental para medir a arquitetura completa que você deseja. A inconsistência é que o código e o documento descrevem comportamentos diferentes.

**Correção recomendada:**

- Se o objetivo atual é medir a arquitetura completa, manter `a_cada_ciclo` no modo de benchmark, mas identificá-lo explicitamente como experimental e caro.
- Definir separadamente a política do modo operacional, por exemplo `quando_evento_relevante` ou `sob_demanda`, depois de validar que os eventos locais são confiáveis.
- Incluir a política efetivamente usada em cada relatório e arquivo de ciclo para tornar os resultados reproduzíveis.

### P1.5 A sequência curta é interrompida entre ciclos; não é rastreamento temporal contínuo

**Arquivos principais:**

- `public/temporal/motor-temporal.ts`
- `public/temporal/maquina-sinais.ts`
- `public/cycle/politica-ciclo.ts`
- `public/scheduler.ts`

O motor identifica um período cego quando o tempo desde a última observação ultrapassa o limiar configurado, e interrompe sinais ativos como incertos. Como o ciclo só reinicia depois de terminar o processamento e cumprir a pausa pós-ciclo, a distância real entre sequências pode ser muito maior que o intervalo entre snapshots. Os relatórios antigos registraram dezenas de segundos na interpretação multimodal em algumas configurações; esses tempos precisam ser medidos novamente.

**Impacto:**

O sistema pode analisar movimentos ocorridos dentro de um bloco de quatro snapshots, mas não pode afirmar que um gesto permaneceu ativo durante o intervalo em que não observou a webcam. Essa interrupção conservadora é melhor do que inventar continuidade, mas limita a compreensão de ações longas e sequências distribuídas por vários ciclos.

**Correção recomendada:**

- Manter estados em pausa como desconhecidos/incertos, sem extrapolar ausência de observação como ausência física.
- Distinguir claramente `última evidência`, `última observação` e `tempo sem observação` nos eventos.
- Considerar no futuro um modo de percepção local leve durante a pausa, ou intervalos adaptativos quando houver movimento. Só adotar isso depois de medir seu custo no hardware.

## P2 — Importantes para qualidade, robustez e desempenho

### P2.1 Reconhecimento de gestos é limitado às classes predefinidas

**Arquivo principal:** `public/gestos.ts`

O MediaPipe Gesture Recognizer reconhece classes prontas como punho fechado, mão aberta, indicador apontado, polegar para cima/baixo, `Victory` e `ILoveYou`. Isso não equivale a um classificador geral de qualquer combinação de dedos.

O contexto compacta as mãos para poucos landmarks (por padrão, pulso e pontas dos dedos). Essa representação é econômica, mas deixa de fora articulações intermediárias relevantes para distinguir com mais rigor dedos dobrados/estendidos.

**Impacto:**

A arquitetura ainda não cobre plenamente ações como elevar e baixar seletivamente dedos, contrair músculos ou reconhecer poses musculares com confiança. O modelo multimodal pode inferir algumas delas pelas imagens, mas não se deve presumir que os dados estruturados atuais as codifiquem.

**Correção recomendada:**

1. Preservar o modo compacto para a operação normal.
2. Na configuração experimental, enviar os 21 landmarks da mão, as pontuações e o estado do subsistema.
3. Acrescentar features geométricas — ângulos de articulações e estado estendido/dobrado de cada dedo — antes de treinar ou integrar um classificador customizado.
4. Criar um conjunto anotado específico para gestos, incluindo mão espelhada, oclusão, iluminação ruim e diferentes distâncias da webcam.

### P2.2 Rastreamento de entidades é guloso e baseado em centroide

**Arquivo:** `public/temporal/rastreador-entidades.ts`

O rastreador associa cada entidade viva à sonda mais próxima que não ultrapassa `distanciaMaxima`. O centro de uma pose é calculado a partir dos pontos válidos; a alteração de pose pode mudar bastante esse centroide, mesmo quando a pessoa não se desloca. O algoritmo também não é uma associação global ótima para múltiplas pessoas próximas.

A expiração atual é contada em frames ausentes, não diretamente pelo tempo decorrido. Como resultado, uma entidade pode ficar viva por muito tempo em cenários com lacunas e poucas observações válidas.

**Correção recomendada:**

- Guardar `ultimaObservacaoMs` e aplicar expiração temporal explícita em cada início de ciclo.
- Para pose, preferir um ponto de referência mais estável (torso/ombros/quadris) em vez do centroide de todos os keypoints.
- Testar cruzamento de pessoas, oclusões e mudanças bruscas de postura.
- Só adotar IoU/Hungarian ou outro método mais sofisticado se os dados demonstrarem que a associação atual falha com frequência.

### P2.3 Limite de contexto é contado em caracteres, não bytes

**Arquivo:** `public/interpretation/contexto.ts`

A função que mede o contexto usa `JSON.stringify(valor).length`, apesar do limite estar nomeado `maxBytesContexto`. `length` mede unidades de string, não o tamanho real de uma representação UTF-8.

**Correção recomendada:**

Calcular o tamanho UTF-8 com `new TextEncoder().encode(JSON.stringify(valor)).length`, depois de cada redução do contexto. Garantir também que a versão final sempre respeite o limite ou registre explicitamente que não foi possível encaixar o payload.

### P2.4 Falta uma validação real do parser de YOLO Pose contra a saída do modelo

**Arquivo:** `public/pose.ts`

O parsing assume um formato de tensor associado ao YOLOv8 Pose. Os testes unitários com motores falsos podem validar contratos e lógica, mas não provam que o tensor real, a ordem dos pontos, o cálculo de escala, o mapeamento de coordenadas e os scores estão corretos para o artefato/modelo utilizado no navegador.

**Correção recomendada:**

- Salvar uma amostra pequena de tensor de saída real como fixture versionada e não sensível, junto da identificação exata do modelo.
- Testar parsing, confidências, escala e coordenadas contra valores esperados.
- Fazer um teste de integração no navegador com a webcam e registrar o dispositivo efetivamente escolhido (WebGPU ou WASM), modelo carregado e latência fria/aquecida.

### P2.5 Contagem de entidades ativas tem semântica ambígua

**Arquivo:** `public/temporal/motor-temporal.ts`

`entidadesAtivas` soma pessoas rastreadas por pose, mãos rastreadas e objetos. Uma pessoa pode, portanto, contribuir com mais de uma entidade. O valor representa tracks ativos, e não quantidade de pessoas ou entidades físicas distintas.

**Correção recomendada:** renomear para `tracksAtivos` ou separar métricas: `pessoasAtivas`, `maosAtivas`, `objetosAtivos`.

### P2.6 Eventos de gesto e postura não são persistidos no stream genérico de eventos

**Arquivo:** `public/cycle/ciclo-percepcao-controller.ts`

O código documenta que eventos como gesto detectado, braço levantado e movimento corporal ficam no diagnóstico/registro do ciclo e no contexto interpretativo, mas não são gravados no stream `/api/eventos`, que está focado em aparição, desaparecimento e mudança de cena.

**Impacto:**

A informação não é necessariamente perdida se o registro do ciclo é preservado, mas ferramentas que consultam somente `eventos.jsonl` não terão a história dos gestos e posturas.

**Correção recomendada:**

Decidir se o produto precisa de uma memória pesquisável de gestos. Se sim, criar um repositório/stream de eventos temporais com identidade, início, atualizações, estado final, frames de evidência e incerteza. Não misturar isso com a persistência antiga sem um contrato explícito de migração.

## P3 — Melhorias de manutenção e observabilidade

### P3.1 Melhorar a semântica das métricas

Registrar separadamente:

- custo frio de inicialização por modelo;
- custo aquecido de inferência por snapshot;
- custo do conjunto completo de quatro snapshots;
- duração total até resposta multimodal;
- latência entre ciclos;
- memória máxima e uso do dispositivo/runtime;
- ciclos completos, incompletos, cancelados e com subsistema indisponível.

Não compare apenas uma média total. Para latência, use mediana e percentil 95, separando cold start de regime aquecido.

### P3.2 Incluir política e capacidades reais nos logs

Cada registro de ciclo deveria guardar, no mínimo, variante do pipeline, versões dos modelos, runtime/dispositivo utilizado, número de snapshots, intervalo configurado, política de interpretação, limites de contexto e motivo de eventual supressão. Isso evita misturar resultados de configurações diferentes.

### P3.3 Revisar o rótulo semântico dos eventos

Evitar usar o mesmo evento para objetos, mãos e corpo sem registrar a origem. Tipos, descrições e métricas devem dizer exatamente o que foi detectado e qual componente produziu a evidência.

## 4. Benchmark: o que os resultados permitem concluir

### 4.1 Cobertura insuficiente para avaliar gestos e ações

`bench/clipes/MATRIZ_COBERTURA.md` informa que apenas `webcam-mudanca.webm` está verificado no conjunto EVAL; é um clipe de 30 segundos com cena estática e um desaparecimento. Os demais vídeos listados incluem anotações pendentes ou rascunhos.

Esse material pode ajudar a validar um evento de aparição/desaparecimento e falsos positivos de cena, mas não permite concluir se o projeto reconhece bem:

- polegar para cima versus polegar para baixo;
- dedos individuais estendidos/dobrados;
- braço levantado em movimentos rápidos e lentos;
- pose muscular;
- movimentos contínuos entre observações;
- mãos parcialmente ocultas;
- diferentes distâncias e iluminações.

### 4.2 Resultados antigos não são uma comparação concluída de A/B/C/D

Os relatórios registram uma execução anterior na qual B concluiu um ciclo, enquanto C/D foram canceladas ou não concluíram os quatro frames. Outro comparativo histórico registra zero ciclos válidos. Esses resultados descrevem tentativas incompletas; não podem ser interpretados como uma vitória da variante B nem como prova de que C/D são inviáveis.

Os números antigos de aproximadamente 95 segundos para detecção fria, 2,5 segundos para pose e 34–57 segundos para multimodal pertencem às medições documentadas, não a uma nova medição desta revisão. A instalação dos modelos, o runtime e o backend local alteram o resultado.

### 4.3 O nome “etapas isoladas” pode criar uma expectativa errada

O harness `scripts/benchmark-variantes.mjs` agrega métricas de etapas a partir de registros de ciclo já existentes. Isso é útil para decompor o custo observado, mas não equivale a executar cada componente de forma completamente independente e controlada. Na documentação, convém distinguir “decomposição por etapa a partir de ciclos reais” de “benchmark isolado de componente”.

## 5. Sequência de correção sugerida

### Fase 1 — Corrigir a ligação entre rastreamento e contexto

1. Fazer as associações de entidades retornadas pelo rastreador chegarem às observações por frame.
2. Preencher `trackId` para pessoas e mãos de modo estável.
3. Fazer o contexto calcular deslocamento entre snapshots usando os mesmos IDs.
4. Separar movimento de objeto de movimento corporal.
5. Criar testes de integração do detector até o JSON enviado ao multimodal.

**Gate:** o teste precisa mostrar ao menos um movimento real/simulado não vazio no contexto, com timestamps e ID estável.

### Fase 2 — Fixar o contrato temporal do ciclo

1. Escolher a configuração de referência: 500 ms ou 1000 ms por snapshot.
2. Registrar a janela temporal real com timestamps, não apenas valores de configuração.
3. Confirmar que a pausa de seis segundos é contada depois de toda a interpretação e persistência, como documentado.
4. Registrar períodos cegos e garantir que nenhum evento alegue continuidade sem evidência.
5. Manter a chamada multimodal por ciclo como variante experimental, se esse for o objetivo do próximo benchmark, e criar uma política econômica separada para uso normal.

**Gate:** um teste de relógio falso deve verificar o momento de cada captura, início/fim do ciclo e próximo início; outro deve confirmar a política de interpretação efetiva.

### Fase 3 — Validar os modelos locais reais

1. Confirmar carregamento do YOLO de objetos e do modelo Pose no navegador.
2. Confirmar saída real do MediaPipe, incluindo os 21 landmarks quando solicitado.
3. Registrar se cada subsistema está usando WebGPU, WASM ou outro backend.
4. Testar fallback e descarte/encerramento de recursos quando a inicialização falha ou expira.
5. Medir latência fria e aquecida por modelo.

**Gate:** nenhum adaptador é considerado validado somente porque um mock passa no teste.

### Fase 4 — Ampliar o conjunto EVAL

Preparar clipes anotados por humanos, com pelo menos várias ocorrências de cada classe que se deseja reconhecer e clipes negativos equivalentes. Separar os vídeos de tuning dos vídeos finais de avaliação; evitar que o mesmo vídeo usado para ajustar limiares também defina o resultado final.

As anotações devem incluir início/fim, tipo de ação, qualidade da visibilidade, mão/corpo envolvido e se o evento é impossível de determinar. Avaliar separadamente gestos, postura, movimento de objeto, aparição/desaparecimento e interpretação textual.

### Fase 5 — Comparar A/B/C/D sem alterar outras variáveis

- Usar as mesmas gravações, anotações, modelo multimodal, prompt e hardware para todas as variantes.
- Fazer warm-up separado e reportar cold start separadamente.
- Medir ciclos completados; variantes canceladas não devem fornecer métricas de qualidade como se tivessem executado o ciclo inteiro.
- Relatar precisão, recall, F1, falsos positivos por minuto, latência mediana/P95, RAM, uso de GPU e falhas por subsistema.
- Aplicar os critérios de promoção antes da rodada; não ajustá-los depois de ver o resultado.

## 6. Testes de regressão que eu adicionaria

1. **Associação por frame:** pessoa/mão recebe o mesmo `trackId` nos frames em que a associação é válida.
2. **Movimento no payload:** deslocamento entre duas observações gera `movimento` serializado e o ID coincide com o dos landmarks.
3. **Falha versus vazio:** falha de MediaPipe não encerra gesto como se fosse uma detecção válida sem mão; frame válido sem mão segue a política de ausência.
4. **Movimento semântico:** mover uma caneca não produz `movimento_corporal`; mover o braço pode produzir evento corporal após confirmação.
5. **Janela temporal:** quatro snapshots a 1000 ms produzem timestamps aproximados de 0, 1000, 2000 e 3000 ms; a variante de 500 ms é testada separadamente.
6. **Lacuna entre ciclos:** um gesto ativo antes de uma grande lacuna vira incerto e não é descrito como continuamente observado.
7. **Política multimodal:** cada política (`a_cada_ciclo`, `sob_demanda`, `quando_evento_relevante`) é testada e gravada no diagnóstico.
8. **Tamanho de contexto UTF-8:** payloads com acentos e caracteres multibyte respeitam o limite real em bytes.
9. **Parser de Pose real:** fixture versionada com tensor do modelo real, incluindo coordenadas e confidências esperadas.
10. **Cancelamento e fallback:** cancelar um ciclo ou uma inicialização não deixa workers/instâncias pendentes nem corrompe o próximo ciclo.

## 7. Validação executada nesta revisão

Tentei validar o projeto localmente, mas a instalação das dependências não estava completa:

- `npm run typecheck` terminou com `TS2688: Cannot find type definition file for 'node'`.
- `npm test` terminou com `sh: vitest: not found`.
- A instalação de dependências no ambiente de análise havia excedido o tempo permitido e deixado `node_modules` incompleto.

Essas mensagens **não demonstram que o projeto ou os testes falham numa instalação correta**. Demonstram que não foi possível executar uma validação automatizada confiável nesta sessão. A revisão técnica acima baseia-se na inspeção estática dos arquivos e deve ser confirmada com `npm ci`, `npm run typecheck`, `npm test`, `npm run lint`, build e E2E no ambiente do projeto.

## 8. Veredito

A modularização e o desenho do ciclo estão significativamente melhores. A preservação dos snapshots, a separação entre detecções locais e interpretação multimodal, o paralelismo limitado, o tratamento explícito de falhas e a correção dos timestamps são avanços concretos.

Ainda não considero o motor temporal pronto para cumprir toda a ambição do Neuro Vision. A falha de propagação de IDs faz com que as observações de pessoa/mão não sejam conectadas ao cálculo de movimento no contexto; a semântica de movimento mistura objetos e corpo; as classes de gesto são limitadas; e a avaliação atual não cobre suficientemente as ações desejadas.

**Prioridade máxima:** fechar a cadeia `percepção local → rastreamento com IDs estáveis → movimento/eventos → contexto serializado → interpretação multimodal`, com um teste de integração automatizado. Depois disso, alinhar a janela temporal, validar os modelos reais e executar um benchmark EVAL com cobertura suficiente. Não adicionaria mais modelos nem reescreveria módulos antes de fechar essa cadeia.
