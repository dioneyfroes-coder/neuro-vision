# Roteiro de modularização e evolução do Neuro Vision

> **Objetivo:** transformar o Neuro Vision em uma arquitetura modular na qual captura, percepção local, motor temporal, interpretação multimodal, ciclo de análise e persistência sejam responsabilidades separadas, testáveis e substituíveis.
>
> **Estratégia:** refatoração incremental, mantendo o sistema funcional entre etapas. Não trocar vários modelos nem reescrever o servidor e o cliente de uma vez.

## 1. Princípios de arquitetura

1. **Separar responsabilidades antes de otimizar.** Primeiro definir contratos claros; depois extrair módulos; por último avaliar modelos e desempenho.
2. **Uma observação tem evidência rastreável.** Cada resultado deve indicar exatamente qual frame originou a detecção, os landmarks e a interpretação.
3. **O motor temporal não é o modelo multimodal.** O motor temporal transforma observações datadas em trajetórias, transições e eventos. O modelo multimodal interpreta imagens, dados estruturados e contexto.
4. **O interpretador recebe o pacote do ciclo, não captura a webcam.** Não deve obter uma imagem nova por conta própria.
5. **Nenhum modelo deve ser obrigatório para todos os demais.** YOLO, MediaPipe e o modelo multimodal entram por interfaces; um deles pode falhar ou ser desativado sem quebrar toda a aplicação.
6. **Sem sobreposição de ciclos.** No máximo um ciclo completo ativo por sessão, a menos que um benchmark futuro justifique outra estratégia.
7. **Medir qualidade e custo juntos.** Uma arquitetura mais lenta só é uma melhoria se elevar a qualidade o suficiente para justificar latência, memória e consumo de CPU/GPU.
8. **Falha não significa ausência.** Se um detector falhar, registrar `desconhecido/indisponível`, nunca converter a falha em “nada aconteceu”.
9. **Dados temporais usam tempos corretos.** Separar instante de captura, instante de inferência e instante de conclusão. Usar relógio monotônico para intervalos e ISO timestamp para logs.
10. **Não depender de nomes de modelos nos tipos de domínio.** O núcleo conhece `DetectorObjetos`, `EstimadorPose` e `ReconhecedorGestos`, não APIs de YOLO, Transformers.js ou MediaPipe.

## 2. Diagnóstico da arquitetura atual

A versão de `neuro-vision-feat-temporal-perception` revisada para este roteiro já tem fundamentos úteis:

- `public/camera.ts`: webcam, captura e assinatura de cena.
- `public/detector.ts`: detecção de objetos no navegador.
- `public/scheduler.ts`: agendamento encadeado e prevenção de sobreposição de inferências.
- `public/app.ts`: atualmente concentra a coordenação da interface e boa parte do fluxo de análise.
- `src/percepcao.ts`: contrato `MotorPercepcao` e `ResultadoPercepcao`.
- `src/rastreamento.ts`: associação temporal de objetos e eventos de aparição, desaparecimento e movimento.
- `src/cena.ts`: sinal de mudança de cena.
- `src/politica-analise.ts`: decide quando acionar uma análise cara e limita a frequência.
- `src/ollama.ts` e `src/provedor.ts`: prompts, cliente de visão e integração com Ollama/API compatível com OpenAI.
- `src/memoria.ts` e `src/server.ts`: persistência JSONL, eventos, snapshots, API HTTP e parte da lógica do servidor.
- `bench/` e `scripts/`: há uma base para medir latência e qualidade dos eventos.

### Lacunas que a nova arquitetura deve resolver

1. **O ciclo de várias imagens ainda precisa ser formalizado.** O fluxo atual de interpretação multimodal recebe uma imagem por chamada. O novo ciclo precisa guardar e encaminhar quatro snapshots associados aos respectivos resultados locais.
2. **A captura precisa ser única por evidência.** No código revisado, o fluxo local captura um frame e o caminho de `analisarComOllama()` pode capturar outro frame. No desenho novo, o modelo multimodal deve receber os snapshots já coletados pelo ciclo, e não capturar uma imagem posterior.
3. **O `public/app.ts` está fazendo trabalho demais.** Interface, agendamento, coordenação dos motores, estado temporal, política, chamadas de API e atualização de status estão acoplados.
4. **O rastreamento atual não equivale à compreensão de ações.** Seguir caixas de objetos e detectar mudanças de cena é uma base temporal, mas não é suficiente para descrever sequências como “levantou o braço”, “abriu a mão” ou “mostrou o polegar”.
5. **O contrato de percepção é estreito para os novos dados.** `ResultadoPercepcao` centra-se em objetos e descrição textual. Pose, landmarks de mãos, eventos temporais, confiança por subsistema e identificadores de frame precisam de contratos próprios.
6. **O contrato do provedor multimodal precisa aceitar múltiplas imagens.** Na versão revisada, a construção de requisição está organizada em torno de uma `imagem` singular. A nova interface deve suportar `imagens[]` e texto estruturado nos dois formatos de provedor.
7. **A memória precisa distinguir sessão, ciclo, frame, observação e evento.** IDs como `obj-1` ou `evt-1` não devem colidir entre sessões quando forem persistidos.
8. **O intervalo entre ciclos cria períodos sem observação.** Se houver quatro segundos de captura e uma pausa de seis segundos após o processamento, o motor não pode afirmar o que ocorreu durante o intervalo cego.

> **Nota sobre o detector instalado:** a documentação do ZIP revisado menciona Transformers.js com YOLOS/DETR. Se a branch de trabalho já usa YOLO Tiny, mantenha essa implementação e encaixe-a no adaptador proposto. Este roteiro não depende de trocar o modelo de detecção atual.

## 3. Arquitetura-alvo

O princípio é manter os módulos que rodam no navegador separados dos que rodam no servidor Node, compartilhando contratos e lógica pura quando fizer sentido.

```text
public/
  app.ts                         # ponto de composição da interface; sem lógica de domínio
  ui/
    status-view.ts               # status, progresso e diagnóstico visual
    history-view.ts              # renderização do histórico e eventos
    controls.ts                  # botões, seletores e configurações
  capture/
    webcam-capture.ts            # abre câmera e captura um frame identificado
    snapshot-store.ts            # snapshots em memória do ciclo; limites de tamanho
  perception/
    contracts.ts                 # portas/adaptadores disponíveis no navegador
    local-perception-pipeline.ts # executa detectores sobre um frame
    adapters/
      object-detector.adapter.ts # adaptador do detector atual/YOLO Tiny
      pose-estimator.adapter.ts  # adaptador de YOLO Pose
      hand-gesture.adapter.ts    # adaptador do MediaPipe
  cycle/
    cycle-controller.ts          # coordena o ciclo de ponta a ponta
    cycle-scheduler.ts           # intervalo, pausa, cancelamento e exclusão mútua
    cycle-config.ts              # número de frames, intervalo, timeout e flags
    cycle-state.ts               # estados explícitos e transições válidas
  temporal/
    temporal-engine-client.ts    # integra o núcleo temporal à aplicação
  api/
    api-client.ts                # chamadas HTTP; sem lógica da interface

src/
  domain/
    ids.ts                       # IDs de sessão, ciclo, frame e evento
    observation.ts               # contratos normalizados de observação
    perception.ts                # objetos, pose, mãos e metadados de confiança
    temporal-event.ts            # eventos de domínio e evidências
    cycle.ts                     # pacote completo do ciclo
    interpretation.ts            # resultado textual multimodal
  temporal/
    temporal-engine.ts           # entrada única para observações sequenciais
    object-tracker.ts            # associação de objetos entre frames
    body-tracker.ts              # associação de pessoas/poses
    hand-tracker.ts              # associação temporal de mãos
    movement-analyzer.ts         # deslocamentos, velocidades e mudanças de pose
    gesture-state-machine.ts     # estabilidade, início, manutenção e fim de gestos
    scene-change-detector.ts     # mudança global de cena
    event-aggregator.ts          # agrupa sinais em eventos menos ruidosos
    temporal-window.ts           # janela de observações e limites de memória
  multimodal/
    multimodal-interpreter.ts    # porta para interpretar o pacote do ciclo
    build-context.ts             # monta texto, imagens e dados estruturados
    prompt-builder.ts            # instruções e formato de saída esperado
    result-normalizer.ts         # normaliza e valida a saída textual
    providers/
      ollama-provider.ts         # adaptador do endpoint nativo Ollama
      openai-compatible-provider.ts # LM Studio e APIs compatíveis
  policy/
    analysis-policy.ts           # política para decidir quando interpretar
  persistence/
    jsonl-store.ts               # primitives de persistência
    observation-repository.ts    # grava/leitura das observações
    event-repository.ts          # eventos, snapshots e referências
    cycle-repository.ts          # métricas e resultado de cada ciclo
  http/
    server.ts                    # composição do servidor
    routes/
      health-routes.ts
      perception-routes.ts
      history-routes.ts
      event-routes.ts
  config/
    env.ts

bench/
  datasets/                      # metadados e instruções dos conjuntos
  annotations/                   # anotações humanas versionáveis
  reports/                       # relatórios de benchmark versionados
scripts/
  benchmark-pipeline.mjs         # benchmark ponta a ponta
  evaluate-events.mjs            # precisão, recall, falsos positivos etc.
```

Esta é uma **estrutura-alvo**, não uma exigência para mover todos os arquivos de uma vez. A nomenclatura final pode respeitar os nomes atuais em português. O ganho está nos limites de responsabilidade e nas interfaces, não no idioma dos nomes.

## 4. Contratos centrais antes de mover arquivos

Antes de criar todos os diretórios, definir os tipos que atravessam módulos. Os tipos devem ser pequenos, explícitos e independentes dos SDKs dos modelos.

### 4.1 Identificadores e tempo

Toda entidade deve carregar os identificadores necessários para rastrear sua origem:

- `sessionId`: sessão de execução atual.
- `cycleId`: ciclo de captura/interpretação.
- `frameId`: frame específico dentro do ciclo.
- `capturadoEm`: timestamp ISO da captura.
- `capturadoEmMs`: tempo monotônico para cálculo de intervalos.
- `inferidoEm` e `duracaoInferenciaMs`: quando a análise local terminou e quanto custou.
- `eventoId`: ID globalmente único para persistência e referências.

Não gerar IDs apenas com contadores reiniciados a cada execução quando os registros forem mantidos historicamente. Um UUID por sessão combinado com contadores locais é suficiente.

### 4.2 Observação de um frame

Conceitualmente, cada frame deve produzir um objeto semelhante a:

```ts
interface ObservacaoFrame {
  sessionId: string;
  cycleId: string;
  frameId: string;
  capturadoEm: string;
  capturadoEmMs: number;
  imagem: string; // evidência exata usada na percepção e depois no multimodal
  deteccoes: ResultadoDeteccaoLocal;
  pose: ResultadoPose | ResultadoIndisponivel;
  maos: ResultadoGestos | ResultadoIndisponivel;
  metricas: {
    duracaoDeteccaoMs?: number;
    duracaoPoseMs?: number;
    duracaoMaosMs?: number;
  };
}
```

`ResultadoIndisponivel` deve registrar motivo e subsistema; não deve ser convertido em uma lista vazia indistinguível de uma inferência válida sem resultados.

### 4.3 Pacote do ciclo

```ts
interface PacoteCiclo {
  sessionId: string;
  cycleId: string;
  iniciadoEm: string;
  concluidoEm?: string;
  observacoes: ObservacaoFrame[];
  eventosTemporais: EventoTemporal[];
  resumoTemporal: ResumoTemporal;
  metricas: MetricasCiclo;
}
```

O pacote é a fronteira entre análise local e interpretação multimodal. Ele contém as imagens originais do ciclo e os resultados que pertencem a cada uma, mais a leitura temporal consolidada.

### 4.4 Evento temporal

Cada evento deve declarar:

- tipo normalizado, por exemplo `gesto_detectado`, `braco_levantado`, `movimento_corporal`, `aparicao`, `desaparecimento` ou `mudanca_de_cena`;
- `inicioEm` e, quando aplicável, `fimEm` ou duração;
- entidade associada, se houver;
- confiança e origem dos sinais;
- `frameIds` ou referências aos snapshots que sustentam o evento;
- estado: `candidato`, `confirmado`, `encerrado` ou `incerto`.

Evite produzir uma sequência de eventos duplicados em todos os frames. Um evento contínuo deve poder ser atualizado até encerrar, mantendo uma única identidade.

## 5. Responsabilidades de cada módulo

### 5.1 Captura

Responsabilidades:

- abrir/fechar a webcam e expor as dimensões reais;
- capturar um snapshot e atribuir `frameId` e timestamp;
- controlar resolução e qualidade de imagem;
- não executar inferência e não chamar o Ollama;
- não decidir se um evento ocorreu.

Regra principal: **o frame armazenado é exatamente o frame usado pelos detectores e enviado depois ao modelo multimodal**. Não recapturar a câmera durante a interpretação.

### 5.2 Percepção local

Executa inferência nos snapshots e transforma a saída específica de cada SDK em contratos normalizados.

- **Detector de objetos / YOLO Tiny:** caixas, classe, confiança e dimensões da imagem.
- **Estimador de pose / YOLO Pose:** pontos-chave corporais, confiança por ponto quando disponível e pessoa associada.
- **Reconhecedor de mãos / MediaPipe:** landmarks normalizados, lateralidade, classificação de gesto e confiança quando o modelo disponibilizar.

Cada adaptador deve ter ciclo de vida claro (`inicializar`, `analisar`, `encerrar`), timeout/erro tipado e métricas de inferência. Começar executando os modelos **sequencialmente** por frame, para reduzir disputa por GPU/memória; só testar paralelismo depois de medir.

O pipeline local não deve gerar a descrição final da cena. Ele produz evidências estruturadas.

### 5.3 Motor temporal

O motor temporal recebe observações ordenadas por tempo, independentemente de quem as produziu. Não captura frames, não chama APIs HTTP e não constrói prompts.

Responsabilidades:

1. associar objetos, pessoas, poses e mãos ao longo de observações;
2. filtrar pequenas oscilações de caixas e landmarks;
3. derivar deslocamento, direção, velocidade aproximada e mudanças de pose;
4. reconhecer estados e transições, e não apenas poses isoladas;
5. confirmar gestos com uma regra de estabilidade configurável;
6. tolerar falhas pontuais sem declarar desaparecimento prematuro;
7. emitir eventos com timestamps, confiança e referências às evidências;
8. manter uma janela temporal limitada e permitir reinicialização explícita de sessão.

Assinatura conceitual sugerida:

```ts
interface MotorTemporal {
  iniciarSessao(sessionId: string): void;
  processar(observacao: ObservacaoFrame): ResultadoTemporal;
  encerrarSessao(): ResumoSessaoTemporal;
  reiniciar(): void;
}
```

O motor deve processar frames na ordem dos timestamps de captura, não na ordem em que terminou cada inferência. Se um frame demorar mais que outro, ordenar ou rejeitar explicitamente observações fora de ordem.

#### Detecção de movimento corporal

A primeira versão pode calcular distância entre pontos-chave normalizados pela largura/altura do frame. Normalizar coordenadas evita que os limiares dependam exclusivamente da resolução da webcam. Para evitar falsos movimentos, aplicar suavização leve e um limiar mínimo.

#### Reconhecimento temporal de gestos

Não depender de uma única classificação de gesto. Manter uma máquina de estados com, por exemplo:

- `ausente`;
- `candidato`;
- `confirmado`;
- `mantido`;
- `encerrando`.

Confirmar quando o gesto estiver consistente em uma quantidade configurável de observações próximas. A janela e os limiares devem ser ajustáveis pelo benchmark. Um gesto que aparece em apenas um snapshot pode ser reportado com confiança inferior ou como evento incerto, em vez de ser promovido sempre a evento confirmado.

#### Desaparecimento e intervalos sem observação

O motor deve distinguir “não detectado num frame” de “desapareceu da cena”. Os intervalos entre ciclos são observações ausentes por desenho. Nesses períodos, reduzir a certeza, mas não inventar trajetórias nem concluir quando uma pessoa saiu. Usar timeout e tolerância em milissegundos, calibrados para a cadência real.

#### Continuidade entre ciclos

O motor mantém estado curto entre ciclos, com limites claros de memória. Um novo ciclo não deve zerar os rastreadores automaticamente. A sessão só é reinicializada quando o usuário parar/reiniciar ou limpar explicitamente o estado. Ao limpar o histórico persistido, decidir separadamente se a sessão temporal também deve ser reiniciada.

### 5.4 Interpretação multimodal

O interpretador recebe `PacoteCiclo`; ele não acessa a câmera nem executa os detectores.

O contexto enviado deve incluir:

1. instrução curta sobre a tarefa e o período observado;
2. quatro imagens, cada uma identificada por `frameId` e timestamp;
3. deteções do YOLO correspondentes a cada imagem;
4. pontos-chave corporais e dados de gestos das mãos correspondentes a cada imagem;
5. eventos e transições sugeridos pelo motor temporal;
6. confiança/indisponibilidade dos subsistemas;
7. pedido para distinguir o que está visível do que é inferência, reconhecer incerteza e não contradizer a cronologia.

O modelo deve poder corrigir ou contextualizar os sinais locais, mas não deve tratar a confiança dos detectores como certeza absoluta. Também não deve inventar um movimento que não esteja sustentado pela sequência.

**Suporte a várias imagens:** ampliar os contratos dos provedores de `imagem?: string` para um formato de múltiplas imagens, preservando a implementação existente como compatibilidade temporária. Adaptar e testar tanto o protocolo nativo do Ollama quanto a API compatível com OpenAI. Controlar tamanho total do payload e número de imagens por requisição.

A resposta deve ser validada e normalizada. Se possível, solicitar campos estruturados como:

- `resumo`: descrição textual em português;
- `acoes`: ações interpretadas com intervalo temporal;
- `evidencias`: IDs de frames/eventos que dão suporte;
- `incertezas`: o que não foi possível verificar;
- `contradicoes`: conflitos entre a interpretação e os dados locais.

Se o modelo não suportar saída estruturada de maneira confiável, manter texto normalizado e armazenar os eventos locais separadamente.

### 5.5 Controlador do ciclo

O controlador coordena as etapas e conhece as políticas de execução, mas não implementa algoritmos de rastreamento nem sabe como cada SDK funciona.

Estados sugeridos:

`parado → capturando → inferencia_local → analise_temporal → interpretacao_multimodal → persistindo → pausa → capturando`

Estados de erro/cancelamento devem ter transições explícitas. Ao parar o projeto, cancelar a captura e as etapas canceláveis; uma chamada que não aceite cancelamento não pode permitir um segundo ciclo simultâneo.

O ciclo deve ser uma função única e observável, conceitualmente:

```ts
executarCiclo(): Promise<ResultadoCiclo>
```

Ela retorna métricas e resultado mesmo quando uma etapa parcial falha. O `app.ts` chama o controlador e atualiza a interface com eventos de progresso; não contém o fluxo de negócios inteiro.

### 5.6 Política e agendamento

Separar conceitos que hoje podem parecer um único “intervalo”:

- intervalo entre snapshots dentro da janela de captura;
- duração/janela de aquisição de observações;
- tempo de inferência local;
- tempo de interpretação multimodal;
- pausa entre ciclos;
- intervalo mínimo/rate limit de chamadas ao backend.

Para o experimento inicial, usar valores explícitos e configuráveis:

```text
quantidade de snapshots: 4
intervalo entre capturas: aproximadamente 1.000 ms
pausa entre ciclos: 6.000 ms após terminar o ciclo
ciclos simultâneos: 1
execução local dos modelos: sequencial na primeira versão
```

Definir com precisão se a primeira captura ocorre em `t=0` e as seguintes em `t=1s`, `t=2s` e `t=3s`, ou se a janela precisa cobrir quatro segundos completos. Criar um teste de relógio/fake timers para fixar a semântica.

A pausa de seis segundos deve começar **depois** da conclusão da interpretação e da persistência, conforme a intenção atual. Assim, a duração completa não será exatamente dez segundos: será a janela de captura + inferências locais + interpretação + persistência + pausa. Não iniciar novo ciclo enquanto o anterior estiver ativo.

### 5.7 Persistência e memória

Persistir informação suficiente para depurar o raciocínio do sistema sem armazenar dados redundantes indiscriminadamente:

- resumo textual final;
- `sessionId`, `cycleId`, `frameId` e timestamps;
- resultado local normalizado e confiança;
- eventos temporais e suas evidências;
- latência por etapa e duração total;
- erro ou subsistema indisponível, quando houver;
- referências de snapshot, com política de retenção.

Guardar quatro snapshots por ciclo pode aumentar rapidamente o espaço em disco. Definir limite de bytes, arquivos e idade; evitar duplicar as mesmas imagens em cada registro JSONL. Eventos devem referenciar snapshots por ID/URL, não incorporar grandes data URLs repetidas.

Separar em arquivos/repositórios diferentes a persistência técnica da memória semântica. A primeira registra observações e resultados verificáveis; a segunda pode manter resumos consolidados para contexto futuro.

## 6. Plano de migração em etapas

Cada etapa deve terminar com testes passando e o app podendo ser executado. Evitar misturar a mudança arquitetural com uma mudança de modelo na mesma etapa.

### Etapa 0 — Congelar a referência e registrar o baseline

1. Criar uma branch de trabalho para a modularização.
2. Salvar o commit atual e os resultados existentes do benchmark.
3. Executar `npm test`, `npm run typecheck`, `npm run lint` e os testes E2E viáveis no ambiente.
4. Exportar um relatório JSON com versão do Node, navegador, CPU/RAM, GPU disponível, modelo local e configuração da câmera.
5. Guardar os clipes e anotações utilizados. Não usar os mesmos clipes de ajuste como único teste final.

**Aceite:** [CONCLUÍDO] há uma referência reproduzível e a lista de falhas ambientais está documentada.

### Etapa 1 — Definir contratos sem alterar comportamento

1. Criar tipos separados de `ObservacaoFrame`, resultados de cada subsistema, `EventoTemporal`, `PacoteCiclo`, `ResultadoInterpretacao` e `MetricasCiclo`.
2. Adicionar IDs de sessão/ciclo/frame e separar timestamps de captura e de processamento.
3. Manter adaptadores temporários de/para os tipos atuais `EntradaLog`, `ResultadoPercepcao`, `ObjetoVisto` e `EventoVisual`.
4. Proibir importações de APIs específicas dos modelos dentro dos tipos de domínio.

**Aceite:** [CONCLUÍDO] testes de tipo e testes unitários validam o contrato sem mudar a experiência atual.

### Etapa 2 — Extrair o controlador do ciclo atual de frame único

1. Criar `CycleController` com captura, inferência, atualização temporal, persistência e progresso.
2. Mover a lógica de negócio de `public/app.ts` para o controlador aos poucos.
3. Deixar no `app.ts` a ligação dos botões/seletores, criação das dependências e renderização do progresso.
4. Injetar câmera, detectores, motor temporal, interpretador e repositórios; não criar dependências escondidas dentro do controlador.
5. Preservar os modos antigos como adaptadores para não exigir a migração de todos ao mesmo tempo.

**Aceite:** [CONCLUÍDO] o ciclo atual de uma imagem funciona pelo novo controlador e os testes de interface continuam passando.

### Etapa 3 — Criar os limites dos adaptadores de percepção

1. Extrair uma interface `DetectorObjetos`/`ObjectDetector` independente do SDK atual.
2. Implementar o adaptador usando o detector já instalado.
3. Criar interfaces vazias e testes de contrato para `EstimadorPose` e `ReconhecedorGestos` antes de integrar os novos pacotes.
4. Padronizar coordenadas, dimensões e confiança.
5. Medir individualmente tempo de carga, inferência e memória de cada adaptador.

**Aceite:** [CONCLUÍDO] o controlador usa a interface, e não importa diretamente classes concretas de modelos.

### Etapa 4 — Implementar o ciclo de quatro snapshots

1. Atualizar `WebcamCapture` para capturar e identificar snapshots sem inferência.
2. Coletar quatro frames com intervalo aproximadamente de um segundo; limitar resolução, qualidade e retenção em memória.
3. Guardar imagem, `frameId` e timestamp num objeto imutável da observação.
4. Processar o conjunto localmente **depois da captura**, sequencialmente na primeira versão. Isso preserva a cadência de captura e reduz concorrência entre modelos.
5. Enviar exatamente as mesmas imagens guardadas à interpretação multimodal.
6. Proibir nova captura de webcam dentro do interpretador.
7. Adicionar cancelamento e limpeza do buffer ao parar a sessão ou ao falhar o ciclo.

**Aceite:** [CONCLUÍDO] um teste comprova que as imagens, IDs e timestamps usados na detecção são os mesmos registrados e enviados para a interpretação.

### Etapa 5 — Implementar o pipeline local com os três componentes

1. Manter o detector atual/YOLO Tiny por trás do adaptador de objetos.
2. Adicionar YOLO Pose por meio de um adaptador que normalize keypoints e confiança.
3. Adicionar MediaPipe Gesture Recognizer por meio de um adaptador de mãos.
4. Executar cada modelo em cada snapshot, conforme a política de execução escolhida; a primeira configuração de referência deve ser simples e previsível.
5. Registrar resultados e latências por subsistema, inclusive falhas e fallback.
6. Só experimentar execução paralela ou acionamento condicional depois do primeiro benchmark sequencial.

**Aceite:** [CONCLUÍDO] cada frame gera observações estruturadas associadas corretamente ao seu timestamp; falha de um modelo não apaga os resultados dos demais.

### Etapa 6 — Evoluir o motor temporal para ações

1. Encapsular a lógica atual de `rastreamento.ts` e `cena.ts` no novo motor temporal, sem reescrever os algoritmos antes de cobri-los com testes.
2. Adicionar rastreadores de pose e mão com IDs estáveis dentro da sessão.
3. Adicionar suavização e métricas de movimento em coordenadas normalizadas.
4. Criar a máquina de estados de gestos com confirmação temporal e encerramento.
5. Emitir eventos com duração, confiança, timestamps e IDs dos frames de evidência.
6. Tratar frames ausentes, inferências falhas, mudanças de resolução e períodos cegos entre ciclos.
7. Criar testes sintéticos determinísticos para sequências conhecidas: braço parado, braço subindo, mão aberta, polegar para cima, gesto instável e mão ocultada.
8. Reutilizar o estado entre ciclos; resetar apenas em evento explícito de sessão.

**Aceite:** [CONCLUÍDO] o motor reconhece transições básicas usando observações de teste sem depender do Ollama.

### Etapa 7 — Tornar o interpretador multimodal realmente multimodal por ciclo

1. Criar `MultimodalInterpreter.interpretar(pacoteCiclo)`.
2. Separar montagem do contexto, construção do prompt, transporte pelo provedor e normalização da resposta.
3. Adicionar suporte a `imagens[]` no provedor Ollama e no provedor compatível com OpenAI/LM Studio.
4. Associar cada imagem ao timestamp e às saídas locais correspondentes.
5. Enviar dados temporais junto das imagens, com confiança e sinalização clara de resultados indisponíveis.
6. Limitar o tamanho total do payload e o tamanho dos dados numéricos. Não enviar todos os landmarks em texto sem necessidade: preferir um resumo por frame mais os pontos relevantes.
7. Pedir ao modelo uma narrativa cronológica, evidências e incertezas; não solicitar que “adivinhe” ações não vistas.
8. Cobrir com testes de payload a quantidade de imagens, sua ordem e as diferenças entre provedores.

**Aceite:** [CONCLUÍDO] o backend recebe as quatro imagens na ordem correta e o contexto estruturado; o texto gerado refere-se à janela real observada.

### Etapa 8 — Persistência, diagnóstico e recuperação

1. Extrair rotas e persistência de `src/server.ts` gradualmente, mantendo-o como ponto de composição.
2. Criar repositórios de observações, eventos e ciclos.
3. Usar IDs únicos de sessão/ciclo e evitar colisão com registros históricos.
4. Verificar `response.ok` nas chamadas do cliente e tratar falhas HTTP como erros de persistência.
5. Garantir que falha de logging não seja confundida com falha de inferência.
6. Adicionar métricas por ciclo: captura, detecção, pose, mãos, motor temporal, chamada multimodal, persistência e total.
7. Definir o comportamento de “limpar histórico”: separar apagar dados persistidos de reiniciar o estado temporal em memória, e informar claramente o que a operação faz.

**Aceite:** ciclos incompletos e falhas ficam diagnosticáveis; registros preservam as relações entre sessão, imagens e eventos.

### Etapa 9 — Benchmark completo e decisão arquitetural

1. Comparar a versão atual com o pipeline de quatro snapshots.
2. Testar quatro variantes: baseline atual; sequência de imagens sem metadados locais; imagens + metadados locais; imagens + metadados + motor temporal aprimorado.
3. Usar o mesmo conjunto de clipes em todas as variantes e a mesma versão do modelo multimodal.
4. Incluir ações lentas e rápidas, gestos diferentes, oclusões, iluminação ruim, cena estática e ausência de pessoa.
5. Separar vídeos de ajuste e vídeos reservados para avaliação final.
6. Registrar os relatórios sem substituir o baseline anterior.
7. Só depois decidir se mantém os três componentes sempre ativos, executa algum sob demanda ou reduz a frequência.

**Aceite:** a decisão se baseia em precisão/recall, falsos positivos, latência e consumo medidos, e não apenas em exemplos que funcionaram.

### Etapa 10 — Limpeza final

1. Remover duplicações antigas após os novos módulos terem cobertura equivalente.
2. Atualizar `docs/arquitetura.md`, `docs/eventos.md`, `docs/qualidade.md`, README e variáveis de ambiente.
3. Documentar limites conhecidos e como desligar cada componente por configuração.
4. Confirmar build, testes, lint e fluxo E2E.
5. Gerar um relatório comparativo final com regressões, ganhos e compromissos.

## 7. Benchmark: o que registrar

### Qualidade

- precisão, recall e F1 de cada classe de ação/gesto;
- falsos positivos por minuto;
- eventos esperados que não foram detectados;
- erro de classificação por gesto;
- qualidade da ordem temporal e da duração dos eventos;
- consistência entre texto final e evidências dos snapshots;
- taxa de respostas indevidas quando nenhum evento relevante ocorreu.

### Desempenho

- tempo de captura dos quatro frames;
- latência mediana e percentil 95 de cada modelo local;
- tempo do motor temporal;
- tempo até a primeira resposta e tempo total do modelo multimodal;
- duração total do ciclo;
- CPU, RAM e memória de GPU quando mensurável;
- tamanho do payload e espaço ocupado pelos snapshots;
- ciclos cancelados, falhos ou sobrepostos.

### Matriz mínima de comparação

| Variante | Imagens enviadas ao multimodal | Dados locais enviados | Motor temporal ampliado | Objetivo |
|---|---:|---:|---:|---|
| A. Baseline | 1 por chamada conforme o sistema atual | Existentes | Não | Ponto de referência |
| B. Sequência | 4 | Não | Não | Medir o valor de contexto entre imagens |
| C. Percepção fundida | 4 | YOLO Tiny + Pose + MediaPipe | Básico | Medir o ganho dos dados estruturados |
| D. Arquitetura-alvo | 4 | YOLO Tiny + Pose + MediaPipe | Sim | Medir o ganho da interpretação temporal explícita |

A variante C deve definir claramente o que significa “motor temporal básico” para evitar comparação ambígua. Todos os testes devem usar as mesmas anotações humanas.

## 8. Regras importantes para evitar regressões

- Não mover todos os arquivos e trocar os modelos no mesmo commit.
- Não manter lógica de domínio em `app.ts`, HTML ou handlers HTTP.
- Não permitir que o interpretador capture frames fora do ciclo.
- Não enviar uma imagem sem os metadados que pertencem a ela.
- Não considerar falha de modelo como ausência de objeto/gesto.
- Não concluir desaparecimento ou ausência de movimento durante uma pausa sem observações.
- Não resetar rastreadores a cada ciclo por conveniência.
- Não armazenar imagens base64 repetidas em vários eventos se uma referência for suficiente.
- Não fazer benchmark apenas com imagens sintéticas ou apenas com o mesmo clipe usado para ajustar limiares.
- Não paralelizar os modelos até haver números de referência e teste de estabilidade.
- Não promover evento incerto a fato na descrição textual.

## 9. Checklist de conclusão de cada etapa

Antes de seguir para a próxima etapa, verificar:

- [ ] TypeScript compila (`npm run typecheck`).
- [ ] Testes unitários passam (`npm test`).
- [ ] Lint passa (`npm run lint`).
- [ ] Testes E2E aplicáveis passam (`npm run test:e2e`).
- [ ] Há testes para erros, cancelamento e dados ausentes.
- [ ] As métricas novas não quebraram o baseline sem explicação.
- [ ] Os logs permitem relacionar um evento aos frames e inferências que o originaram.
- [ ] A interface continua responsiva e não permite ciclos sobrepostos.
- [ ] O README e os documentos afetados refletem o comportamento real.

Se uma etapa não puder cumprir algum item por indisponibilidade de ambiente ou dependência, registrar isso explicitamente e não marcar o item como aprovado.

## 10. Ordem de prioridade recomendada

A ordem com melhor relação entre risco e benefício é:

1. **Contratos e IDs** — sem isso, os dados locais, os frames e eventos podem se misturar.
2. **Controlador de ciclo separado de `app.ts`** — estabelece uma fronteira para as próximas mudanças.
3. **Captura única dos quatro snapshots** — garante evidência consistente e cronologia.
4. **Adapters de percepção local** — permite trocar ou adicionar modelos sem acoplar o núcleo.
5. **Motor temporal com testes sintéticos** — transforma resultados por frame em eventos de ação.
6. **Entrada multimodal com múltiplas imagens e dados estruturados** — fornece ao modelo todo o contexto do ciclo.
7. **Persistência e telemetria por etapa** — viabiliza depuração e benchmark.
8. **Benchmark comparativo e ajustes de execução** — decide se modelos devem operar sempre ou sob demanda.

### Definição de pronto da arquitetura-alvo

O Neuro Vision estará modularizado o suficiente quando um ciclo completo puder ser testado sem abrir a webcam nem executar Ollama real; quando cada detector puder ser substituído por um stub ou outro modelo; quando o motor temporal puder ser testado com sequências artificiais; quando o interpretador aceitar um pacote completo de snapshots e dados estruturados; e quando o benchmark conseguir explicar tanto a qualidade da percepção quanto o custo de produzi-la.
