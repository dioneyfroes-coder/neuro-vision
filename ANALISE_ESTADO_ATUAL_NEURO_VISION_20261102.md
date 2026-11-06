# Análise do estado atual — Neuro Vision
**Data da revisão:** 02/11/2026  
**Base analisada:** `neuro-vision-main (1)(1).zip`  
**Escopo:** arquitetura, percepção local, rastreamento e motor temporal, contexto multimodal, ciclo/agendamento, benchmark, testes e documentação.

---

## 1. Resumo executivo

O Neuro Vision evoluiu de forma consistente. A estrutura modular está mais madura, os três componentes de percepção local estão integrados ao ciclo, os resultados de cada snapshot são associados às imagens correspondentes e o motor temporal já consegue manter IDs de pessoas e mãos ao longo dos quadros de um ciclo. Também foram adicionadas proteções importantes contra inferências indisponíveis e lacunas longas entre observações.

**Não recomendo reescrever o projeto.** A base atual merece ser preservada.

O maior problema agora não é falta de modelos. É fechar a cadeia de evidências: garantir que detecções, IDs, geometria, movimento e eventos cheguem ao interpretador com semântica clara, e que o benchmark realmente avalie os comportamentos que o projeto pretende reconhecer.

### Avaliação por área

| Área | Estado | Avaliação |
|---|---|---|
| Modularização | Implementada | Boa separação de responsabilidades |
| YOLO de objetos + YOLO Pose + MediaPipe | Integrados | Arquitetura funcionalmente conectada; custo alto |
| Associação temporal de pessoas/mãos | Melhorou | IDs agora chegam às observações serializadas |
| Reconhecimento temporal de gestos | Parcial | Usa classes prontas do MediaPipe; geometria ainda não vira sinais próprios |
| Movimento corporal | Parcial | Mede deslocamento do centro da pessoa, não ações detalhadas dos membros |
| Contexto multimodal | Integrado | Imagens e dados estruturados são enviados juntos |
| Política do ciclo | Implementada | Política operacional e de benchmark diferem intencionalmente |
| Benchmark | Executa e gera relatórios | Escopo de qualidade atual não valida gestos nem ações humanas |
| Testes automatizados | Não executados nesta revisão | Ambiente sem dependências instaladas e cache offline incompleto |

---

## 2. O que melhorou desde a revisão anterior

### 2.1 Associação entre rastreamento e observações

A correção mais importante da revisão anterior foi implementada. O `MotorTemporalImpl` agora associa `entidadeId` às observações de pose e mãos antes de alimentar os sinais e serializar o contexto.

Arquivos principais:
- `public/temporal/motor-temporal.ts`
- `public/temporal/rastreador-entidades.ts`
- `public/interpretation/esquema.ts`

Isso corrige o problema em que o sistema sabia rastrear entidades internamente, mas perdia essa identidade ao montar os dados destinados ao modelo multimodal.

### 2.2 Tratamento de falhas separado de ausência

A máquina de sinais distingue uma inferência indisponível de uma inferência válida sem detecção. Quando um subsistema falha, o motor não deve interpretar a falha como prova de que a mão ou o gesto desapareceu.

Arquivos:
- `public/temporal/maquina-sinais.ts`
- `public/perception/contracts.ts`
- `public/perception/local-perception-pipeline.ts`

Essa distinção é essencial: “não detectei” e “não consegui analisar” são estados diferentes.

### 2.3 Eventos e lacunas temporais

O motor interrompe sinais quando encontra um período longo sem observação, marcando a transição como incerta em vez de fingir continuidade. Os testes também cobrem falhas e lacunas.

Isso evita concluir que um gesto permaneceu ativo durante dezenas de segundos em que o sistema não observou a pessoa.

### 2.4 Ciclo multimodal coerente

O pipeline captura os snapshots, analisa localmente esses mesmos frames e usa as mesmas imagens e timestamps na interpretação multimodal. Não há uma segunda captura para a etapa de descrição, o que evita associar uma detecção a uma imagem diferente.

O interpretador recebe:
- imagens dos snapshots;
- IDs e timestamps dos frames;
- detecções de objetos;
- pontos-chave corporais;
- mãos e landmarks;
- geometria básica dos dedos;
- leituras de movimento;
- eventos temporais;
- estado e indisponibilidade dos subsistemas.

Essa é a direção arquitetural correta para o experimento que você descreveu.

---

## 3. Arquitetura atual

A separação em módulos está adequada e não precisa de uma reorganização ampla.

| Camada | Localização | Responsabilidade |
|---|---|---|
| Captura | `public/capture/` | Capturar, identificar e armazenar snapshots |
| Ciclo | `public/cycle/` | Coordenar captura, percepção, temporal e interpretação |
| Percepção | `public/perception/` | Orquestrar detectores e workers |
| YOLO objetos | `public/yolo-onnx.ts` e adaptador | Detectar objetos com YOLOv10n/ONNX |
| YOLO Pose | adaptador de pose | Estimar keypoints corporais com YOLOv8n-pose |
| Mãos | adaptador MediaPipe | Detectar mãos, landmarks e gestos predefinidos |
| Temporal | `public/temporal/` | Rastrear entidades, sinais, transições e movimento |
| Interpretação | `public/interpretation/` | Preparar contexto, prompt, schema e chamada multimodal |
| Domínio | `src/domain/` | Tipos e regras independentes da interface |
| Persistência | `src/persistence/` | Registrar eventos e histórico |

### 3.1 Os três componentes de percepção estão conectados

A implementação não é apenas documentação ou código isolado:

- **Objetos:** YOLOv10n via ONNX Runtime Web.
- **Corpo:** YOLOv8n-pose via Transformers.js.
- **Mãos:** MediaPipe Gesture Recognizer Tasks.

O pipeline executa os três adaptadores em paralelo por frame e isola falhas individuais. Os workers retiram parte do trabalho da thread principal, mas não garantem núcleos físicos exclusivos; o navegador continua gerenciando CPU, GPU e memória.

O processamento também limita a concorrência entre frames. Com dois frames em processamento simultâneo e três adaptadores paralelos em cada frame, pode haver várias inferências disputando recursos ao mesmo tempo. Isso precisa ser medido no hardware real.

### 3.2 Uma ressalva de nomenclatura

O detector de objetos é `onnx-community/yolov10n`, ou seja, YOLOv10 nano. Chamá-lo de “YOLO Tiny” é uma simplificação informal; não é necessariamente o mesmo modelo Tiny de outras famílias YOLO.

---

## 4. Problemas e limitações prioritários

### P1 — O motor temporal ainda não transforma a geometria dos dedos em sinais próprios

**Arquivos:** `src/domain/hand-geometry.ts`, `public/temporal/motor-temporal.ts`, `public/interpretation/esquema.ts`.

O projeto já calcula:
- ângulos das articulações;
- dedos considerados estendidos;
- total de dedos estendidos;
- uma configuração geométrica resumida.

Esses dados são serializados para o contexto multimodal. Entretanto, a máquina temporal ainda usa principalmente `mao.gesto?.nome`, isto é, as classes prontas do MediaPipe, como `Thumb_Up`, `Open_Palm`, `Victory` etc.

Consequência: a geometria calculada não é usada pelo motor para produzir sinais temporais próprios. Gestos personalizados ou configurações fora das classes pré-treinadas ficam dependentes da interpretação do VLM.

**Próximo passo recomendado:**
1. Definir uma representação estável da mão: polegar estendido, indicador estendido, médio estendido, anelar estendido e mínimo estendido.
2. Criar regras iniciais configuráveis para alguns gestos desejados.
3. Usar histerese e confirmação por múltiplas observações para evitar oscilações.
4. Emitir eventos com confiança e evidências, sem transformar uma heurística em certeza.
5. Comparar esses sinais com a classe do MediaPipe e com a interpretação humana dos vídeos.

Não implemente dezenas de gestos de uma vez. Comece com polegar para cima, mão aberta, punho fechado, um dedo e dois dedos.

### P1 — O cálculo de movimento depende da distância por frame, não da velocidade

**Arquivos:** `public/temporal/motor-temporal.ts`, `public/temporal/contracts.ts`.

O limiar de movimento corporal usa deslocamento normalizado por frame (`deslocamento >= 0.015`). A mesma velocidade real pode gerar deslocamentos diferentes quando o intervalo entre snapshots muda de 500 ms para 1 segundo.

Isso torna os resultados sensíveis à cadência de captura e dificulta comparar variantes do benchmark.

**Correção recomendada:** calcular velocidade normalizada por segundo:

`velocidade = deslocamento_normalizado / delta_tempo_segundos`

O motor deve guardar o timestamp da observação anterior e rejeitar intervalos inválidos ou excessivamente longos. Para ações, além da velocidade, pode usar ângulos articulares e mudanças de configuração ao longo do tempo.

### P1 — “Braço levantado” ainda é principalmente uma pose estática

**Arquivo:** `public/temporal/motor-temporal.ts` (função `punhoErguido`).

A regra verifica a posição do pulso em relação ao ombro e ao cotovelo e confirma a condição ao longo de vários frames. Isso é útil para reconhecer uma postura mantida, mas não equivale a reconhecer a ação “levantou o braço”.

Para identificar a transição, o sistema precisa comparar a trajetória do pulso e as mudanças dos ângulos do ombro/cotovelo. Para flexão de bíceps, keypoints 2D não bastam para confirmar contração muscular: no máximo indicam uma pose compatível. A descrição deve preservar essa incerteza.

### P1 — Rastreamento de objetos não chega às detecções por frame

**Arquivos:** `src/rastreamento.ts`, `public/interpretation/esquema.ts`.

O rastreador de objetos mantém IDs, mas `serializarDeteccoes()` atualmente entrega rótulo, score e caixa, sem anexar o ID rastreado a cada detecção. O comentário da função menciona `trackId`, mas a saída não o inclui.

Com isso, o interpretador vê as caixas de cada snapshot, mas não recebe uma associação explícita e estável entre a mesma instância de objeto nos quatro frames. Os eventos de objeto podem ter IDs; as detecções brutas por frame não carregam necessariamente essa associação.

**Correção recomendada:** enriquecer cada detecção com o ID retornado pelo rastreador, preservando o índice/frame de origem. Não confundir o ID de uma classe (“carro”) com o ID de uma instância específica (“carro-3”).

### P2 — Rastreador de pessoas e mãos é guloso e pode trocar IDs

**Arquivo:** `public/temporal/rastreador-entidades.ts`.

A associação escolhe a entidade viva mais próxima por distância. É uma estratégia simples e adequada para cenas com uma pessoa e poucos movimentos, mas pode trocar IDs quando:
- as mãos se cruzam;
- a mão sai e retorna perto da outra;
- há mais de uma pessoa;
- ocorre oclusão ou movimento rápido.

O código preserva metadados como lateralidade, mas o critério de associação não os utiliza como restrição forte.

**Correção recomendada:** antes de adotar um algoritmo complexo, adicionar restrições por tipo de entidade e lateralidade (mão esquerda não deve virar mão direita). Se o projeto passar a suportar várias pessoas, avaliar associação global por custo, em vez de escolher cada par isoladamente.

### P2 — O prompt não explica os campos semânticos da geometria da mão

**Arquivo:** `public/interpretation/prompt.ts`.

O prompt inclui o JSON das mãos, mas não explica explicitamente o significado de `dedosEstendidos`, `totalEstendidos` e `configuracao`, nem que os ângulos são heurísticas 2D.

O VLM pode receber esses dados sem saber como interpretá-los ou dar peso excessivo a uma estimativa imperfeita.

**Correção recomendada:** documentar no prompt:
- quais valores representam cada dedo;
- como interpretar o total/configuração;
- que os valores são estimativas locais;
- que divergência entre imagem e estimativa deve ser relatada como incerteza;
- que não deve inventar gestos quando imagem e landmarks forem inconclusivos.

### P2 — O limite de contexto pode remover justamente os dados mais úteis

**Arquivo:** `public/interpretation/contexto.ts`.

O JSON estruturado tem limite padrão de 16 KB. Quando ultrapassa esse limite, o redutor primeiro diminui landmarks das mãos e depois pode reduzir keypoints, remover movimento e remover eventos temporais.

Há um comentário dizendo que a ordem preserva evidências, mas a poda de keypoints para apenas seis pontos não garante manter sempre ombros, cotovelos e pulsos — justamente os pontos necessários para interpretar braços. Remover movimento e eventos também enfraquece o contexto temporal.

**Correção recomendada:**
1. Preservar sempre os keypoints semanticamente essenciais (ombros, cotovelos, pulsos e quadris).
2. Priorizar configuração/contagem de dedos e classe/score do gesto.
3. Preservar eventos temporais confirmados antes de detalhes redundantes de objetos.
4. Informar no payload quando houve truncamento e quais grupos foram removidos.
5. Medir a frequência de truncamento nos ciclos reais.

As imagens são enviadas separadamente; o limite de 16 KB se aplica ao contexto JSON, não ao tamanho total das imagens.

### P2 — Ocultação de mão e fim de gesto exigem política explícita

**Arquivo:** `public/temporal/maquina-sinais.ts`.

A máquina conta leituras sem sinal enquanto a entidade ainda está dentro da tolerância, e pode encerrar o gesto após o número configurado de observações ausentes. Isso é uma escolha de política, não necessariamente um bug.

Para mãos parcialmente ocultas, uma ausência de detecção pode significar “mão escondida”, e não “gesto terminou”. O estado deveria distinguir, conforme a evidência disponível:
- gesto ainda confirmado;
- gesto terminou;
- mão ocluída;
- inferência indisponível;
- observação insuficiente.

A falha de inferência já é tratada separadamente; o próximo refinamento é não equiparar automaticamente toda ausência visual a fim real de gesto.

### P2 — Fallback do detector após falha durante inferência

**Arquivo:** `public/yolo-onnx.ts` e adaptador de objetos.

O fallback WebGPU → WASM ocorre durante a criação da sessão. Se o WebGPU criar a sessão normalmente, mas falhar em uma inferência posterior, o adaptador registra a indisponibilidade; não há necessariamente uma recriação automática em WASM.

Não é prioridade se não houver falhas reais, mas deve existir telemetria para diferenciar falha de inicialização e falha durante inferência. Só implemente retry/fallback automático depois de reproduzir o problema, para não mascarar erros.

---

## 5. Ciclo de captura e política de interpretação

Há duas políticas distintas, o que é correto para separar operação normal de experimento.

| Configuração | Operacional | Benchmark-alvo |
|---|---:|---:|
| Snapshots por ciclo | 4 | 4 |
| Intervalo entre snapshots | 500 ms | 1000 ms |
| Tempo entre primeiro e último snapshot | ~1,5 s | ~3 s |
| Pausa após concluir o ciclo | 6000 ms | 6000 ms |
| Interpretação multimodal | Sob demanda | A cada ciclo |

A interface usa a política operacional por padrão. A política de benchmark-alvo é ativada pelo modo `?benchmark=eval`.

**Implicações:**
- No modo normal, o modelo multimodal não é chamado automaticamente a cada ciclo; a interpretação é sob demanda. Isso economiza recursos.
- No benchmark-alvo, a interpretação acontece em todo ciclo, para medir o custo da arquitetura completa.
- A pausa de seis segundos é calculada a partir do fim do ciclo, como desejado.
- O ciclo real dura mais que os 6 segundos de pausa: soma captura, inferência local, interpretação e pausa.

Há divergência entre código e documentação: `README.md` descreve quatro frames a 1/s como se fosse o comportamento geral, mas a política operacional atual usa 500 ms. O comentário em `public/capture/webcam-capture.ts` também menciona um default de 1000 ms, enquanto o valor configurado é 500 ms. Atualize a documentação para distinguir explicitamente o modo operacional do modo de avaliação.

**Minha sugestão:** mantenha a política operacional econômica e use a política de 1 s + interpretação a cada ciclo no benchmark. Não misture resultados dos dois regimes.

---

## 6. Benchmark A/B/C/D — leitura correta dos resultados

O relatório `bench/COMPARATIVO_A_B_C_D_20261102.md` apresenta:

| Variante | O que envia/usa | Ciclos | Ciclo mediano | VLM mediano |
|---|---|---:|---:|---:|
| A | Um frame, referência atual | 18 | 4,57 s | 4,36 s |
| B | Quatro imagens, sem dados locais | 7 | 33,90 s | 30,88 s |
| C | Quatro imagens + percepção local + temporal básico | 5 | 68,63 s | 62,17 s |
| D | Quatro imagens + percepção local + temporal ampliado | 5 | 72,07 s | 65,33 s |

### 6.1 O que os números sugerem

- O custo local de percepção de C e D é aproximadamente 2,85 s e 3,14 s por ciclo, respectivamente, segundo o relatório.
- A chamada multimodal domina a latência: aproximadamente 62–65 s nas variantes C/D.
- C e D não demonstraram ganho de qualidade no alvo avaliado.
- B, C e D são muito mais lentas que A, mas isso não prova que os dados locais sejam inúteis. Prova que o caminho multimodal medido está caro e que a qualidade não melhorou no teste atual.

Os componentes locais registram custos individuais de inferência que somados são superiores ao tempo de parede da etapa local, porque rodam em paralelo. Não trate a soma das durações de YOLO, Pose e MediaPipe como latência total do ciclo; use o tempo de parede medido para isso.

### 6.2 A qualidade atual não valida os objetivos do projeto

O conjunto EVAL avalia apenas `movimento_objeto.objeto_deslocado`. A matriz de cobertura exclui explicitamente aceno e interpretação textual.

No resultado agregado:
- todas as variantes têm recall 0%;
- todas deixam de detectar os seis eventos anotados;
- B/C/D exibem precisão 100% porque não produziram falsos positivos, mas isso não é sucesso quando também não detectaram nenhum positivo;
- todas permanecem abaixo do gate de qualidade.

A função `taxa()` em `scripts/avaliar-qualidade.mjs` retorna 1 quando o denominador é zero. Em clips sem positivos esperados, isso pode aparecer como recall de 100% por clip, embora a métrica seja indefinida. O correto é representar como `N/A`/`null` e excluir esses casos do cálculo médio daquela métrica.

### 6.3 “Conclusivo” está sendo usado em sentido estreito

O relatório marca o comparativo como “conclusivo — dados comparáveis”, mas recomenda manter todas as variantes experimentais. A função de comparabilidade verifica pré-requisitos mínimos, inclusive pelo menos um ciclo por variante; isso não significa que a evidência seja estatisticamente suficiente nem que o objetivo funcional tenha sido validado.

O próprio relatório tem apenas 5 ciclos para C e D, zero ciclos de warm-up excluídos e P95 calculado sobre amostras muito pequenas. Além disso, a janela de 4,3 segundos apresentada é a janela de geração do relatório: no script, os timestamps são capturados dentro de `main()` enquanto ele lê e agrega logs existentes. O campo deveria chamar-se “janela de geração do relatório”, e não “janela da execução”. Não é correto comparar esse intervalo com a duração das inferências.

### 6.4 Dados necessários para auditoria

O ZIP contém anotações e relatórios, mas não contém:
- `logs/*.jsonl` usados para montar o comparativo;
- sidecars `.inicio`;
- vídeos binários de `bench/videos/`.

Os arquivos são ignorados pelo `.gitignore`, aparentemente para evitar versionar logs e vídeos locais. Isso é razoável para tamanho e privacidade, mas impede reproduzir e auditar esta rodada somente com o ZIP. O relatório registra hashes e tamanhos dos vídeos, o que ajuda a identificar os arquivos corretos, mas não substitui os artefatos.

**Conclusão do benchmark:** no teste atual, A é muito mais rápida e nenhuma variante reconheceu os eventos positivos do conjunto. Não há evidência para promover C ou D como padrão; tampouco há evidência suficiente para descartar a percepção local, porque o EVAL não testa o que você mais quer que o Neuro Vision faça: gestos, dedos, movimentos corporais e ações humanas.

---

## 7. Testes e reprodutibilidade

A base inclui aproximadamente 50 arquivos de teste em `tests/`, incluindo testes para:
- motor temporal;
- rastreamento de pessoas/mãos;
- geometria das mãos;
- adaptadores de detecção, pose e gestos;
- serialização/contexto multimodal;
- ciclo multi-frame;
- políticas e scheduler;
- integração/E2E.

A existência desses testes é positiva, mas **não consegui executá-los nesta revisão**.

Tentativa de instalação offline:
- `npm ci --ignore-scripts --offline --no-audit --no-fund`
- falhou porque o pacote `yocto-queue@0.1.0` não estava no cache local.
- sem `node_modules`, `vitest`, typecheck, lint, build e E2E não puderam ser executados.

Verificações que foram possíveis:
- 19 arquivos `.mjs` passaram em `node --check`.
- Não encontrei erros de sintaxe nesses scripts.
- Isso não substitui testes TypeScript, Vitest ou Playwright.

### Incompatibilidade da CI com a versão de Vitest

O workflow `.github/workflows/ci.yml` configura Node 20. O `package-lock.json` declara Vitest 5.0.3 com engine `^22.12.0 || ^24.0.0 || >=26.0.0`. Portanto, a CI em Node 20 está fora da faixa declarada pelo pacote.

O README ainda diz Node 20+. Padronize em Node 22.12+ (preferencialmente Node 22 LTS atual ou 24) para desenvolvimento e CI, ou fixe versões de dependências compatíveis com Node 20. Não deixe a versão de Node implícita.

---

## 8. Plano de correção recomendado

### Fase 1 — Fechar a cadeia de evidências

1. Acrescentar `trackId` às detecções de objetos serializadas, usando o rastreador já existente.
2. Confirmar por teste que os IDs de pessoas, mãos e objetos permanecem associados ao frame correto.
3. Incluir timestamps e intervalos efetivos entre observações em todos os cálculos temporais.
4. Adicionar teste de integração que valide o payload final enviado ao VLM, incluindo imagens, frameIds, detecções, pose, mãos e eventos.

**Critério de aceite:** um objeto, uma pessoa e uma mão acompanhados em quatro snapshots têm IDs estáveis sempre que a associação é válida; quando não for possível associar, o sistema deve indicar nova entidade/incerteza, não inventar continuidade.

### Fase 2 — Melhorar o motor temporal para ações humanas

1. Alterar deslocamento por frame para velocidade normalizada por segundo.
2. Separar eventos de pose mantida de eventos de transição (por exemplo, `braco_erguido` versus `levantou_braco`).
3. Acrescentar sinais baseados na geometria dos dedos.
4. Usar lateralidade como restrição do rastreador de mãos.
5. Definir estados explícitos para oclusão, ausência e inferência indisponível.
6. Registrar confiança e evidências de cada evento.

**Critério de aceite:** para cada evento, o registro contém entidade, timestamp inicial/final, evidência de origem, confiança, continuidade válida e motivo de encerramento.

### Fase 3 — Melhorar o contrato multimodal

1. Explicar os campos de geometria da mão no prompt.
2. Dizer ao VLM que dados locais são estimativas e podem falhar.
3. Preservar keypoints essenciais ao truncar o contexto.
4. Priorizar eventos temporais relevantes e informar quais campos foram podados.
5. Manter imagens e resultados estruturados vinculados pelo mesmo `frameId`.

**Critério de aceite:** um teste de snapshot do payload demonstra que todos os campos necessários chegaram ao interpretador, e que truncamento nunca remove silenciosamente as únicas evidências de um evento.

### Fase 4 — Validar benchmark de forma compatível com o objetivo

Crie conjuntos EVAL separados por capacidade:
- `movimento_objeto`;
- `gestos_mao` (polegar, punho, mão aberta, dedos);
- `postura_corporal` (braço elevado, braços cruzados, inclinação);
- `transicao_acao` (levantar/abaixar braço, aproximar/afastar mão);
- `oclusao_iluminacao`.

Para movimentos rápidos, anotar início e fim temporal com resolução maior que 1 fps; amostrar apenas uma imagem por segundo pode perder gestos inteiros.

Faça pelo menos várias rodadas independentes, separe warm-up, use os mesmos vídeos e parâmetros, guarde logs brutos fora do repositório e publique hashes/manifesto. Reporte mediana, P95 com tamanho de amostra, falhas e intervalo de confiança quando houver amostra suficiente.

**Critério de aceite:** o relatório não chama o resultado de conclusivo apenas por haver um ciclo. “Comparável” e “estatisticamente suficiente” devem ser estados distintos.

### Fase 5 — Corrigir ambiente de desenvolvimento

1. Alinhar CI e documentação com Node 22.12+ ou 24.
2. Executar `npm ci`, `npm run typecheck`, `npm run lint`, `npm test` e E2E.
3. Anexar os resultados da execução ao relatório da versão.
4. Registrar a configuração do backend, versão do modelo multimodal e dispositivos reais dos três adaptadores.

---

## 9. O que eu não faria agora

- Não substituiria YOLOv10n só por ser chamado de Tiny.
- Não adicionaria um quarto modelo antes de demonstrar lacuna funcional.
- Não tentaria rodar inferência a 30 FPS no hardware atual sem benchmark.
- Não aumentaria indiscriminadamente os timeouts do rastreador para manter eventos artificialmente contínuos durante pausas longas.
- Não usaria o resultado atual de movimento de objetos como evidência de que o sistema reconhece gestos ou postura humana.
- Não reescreveria o motor temporal inteiro: a estrutura atual serve como base para evoluir.

---

## 10. Veredito

O projeto está em um estágio melhor e mais coerente do que nas revisões anteriores. A arquitetura de três percepções está conectada, a associação temporal de pessoas/mãos foi corrigida, o ciclo usa as mesmas imagens para percepção e interpretação e o tratamento de indisponibilidade está mais correto.

As limitações centrais agora são de **semântica e validação**:

1. a geometria dos dedos ainda não alimenta diretamente o reconhecimento temporal;
2. o movimento corporal é simples e sensível à cadência;
3. as detecções de objetos não carregam o ID do rastreador no payload por frame;
4. o prompt não explica suficientemente as evidências geométricas;
5. o contexto pode descartar keypoints/eventos importantes quando excede o limite;
6. o benchmark mede movimento de objetos, não os gestos e ações humanas que motivam o projeto;
7. testes automatizados ainda precisam ser executados em ambiente com dependências instaladas.

**Minha recomendação:** preserve a arquitetura atual e implemente primeiro as Fases 1 e 2. Depois ajuste o contexto multimodal e só então faça o benchmark específico de gestos e ações humanas. O projeto já tem os componentes principais; o ganho mais provável agora vem de conectá-los melhor e medir a capacidade que realmente interessa.

---

## Apêndice — arquivos de referência

- `public/cycle/politica-ciclo.ts`
- `public/cycle/ciclo-multiframe.ts`
- `public/perception/local-perception-pipeline.ts`
- `public/temporal/motor-temporal.ts`
- `public/temporal/maquina-sinais.ts`
- `public/temporal/rastreador-entidades.ts`
- `src/domain/hand-geometry.ts`
- `public/interpretation/contexto.ts`
- `public/interpretation/prompt.ts`
- `public/interpretation/esquema.ts`
- `scripts/benchmark-variantes.mjs`
- `scripts/avaliar-qualidade.mjs`
- `bench/COMPARATIVO_A_B_C_D_20261102.md`
- `bench/clipes/MATRIZ_COBERTURA.md`
- `.github/workflows/ci.yml`
- `package-lock.json`
