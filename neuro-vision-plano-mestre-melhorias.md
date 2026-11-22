# Neuro Vision — Plano Mestre de Melhorias e Implementação

**Base analisada:** `neuro-vision-main(1).zip`  
**Snapshot do repositório:** commit `c36d054331b389b6fcacfb4598628822ecc915cd`  
**Data da análise:** 22/11/2026  
**Objetivo:** consolidar o que já existe, registrar as lacunas reais e definir o que precisa ser corrigido, integrado, desenvolvido e validado para o Neuro Vision evoluir para uma plataforma de percepção, memória visual e monitoramento inteligente.

> Este documento separa três coisas: **implementado** (há código e/ou testes determinísticos), **pendente de validação** (há implementação, mas faltam dados reais ou execução no hardware) e **a implementar/integrar** (a capacidade ainda não está ligada ao fluxo de produção). Testes sintéticos não são tratados como prova de precisão no mundo real.

---

# 1. Visão do produto

O Neuro Vision deve evoluir para um sistema que não apenas detecta o que aparece em uma imagem, mas que mantém uma representação temporal do ambiente e consegue responder, com evidências:

- O que existe no ambiente?
- Onde cada objeto costuma ficar?
- O que mudou desde a última observação?
- Quem entrou ou saiu?
- O que uma pessoa fez?
- Com quais objetos interagiu?
- Qual era o estado do objeto antes e depois?
- Quando aconteceu?
- Em qual vídeo e em quais frames está a evidência?
- O que o sistema sabe, o que apenas suspeita e o que não conseguiu observar?

O diferencial do projeto deve ser a **memória visual estruturada e verificável**, não a quantidade de modelos carregados.

## 1.1 Modos de funcionamento desejados

### Modo de percepção geral
- Capturar snapshots em ciclos.
- Detectar objetos, pessoas, mãos e posturas.
- Acompanhar movimentos e gestos.
- Construir contexto temporal.
- Acionar interpretação multimodal quando necessário.

### Modo Câmera de Segurança
- Gravar continuamente em segmentos de cinco minutos.
- Fazer análise econômica do ambiente em segundo plano.
- Construir um inventário inicial.
- Detectar entrada, saída, movimentação e interação.
- Aumentar a frequência de análise quando houver atividade.
- Investigar objetos com os quais a pessoa interage.
- Registrar eventos, estados, ações e evidências.
- Permitir consultar a linha do tempo e abrir o trecho de vídeo correspondente.

A gravação deve permanecer independente da inferência. Se a IA travar, ficar lenta ou cair, o vídeo continua sendo gravado sempre que a câmera e o gravador estiverem operacionais.

---

# 2. Estado atual confirmado no repositório

## 2.1 Componentes implementados

| Área | Estado no código |
|---|---|
| Captura de webcam e snapshots | Implementada |
| Workers de percepção | Implementados |
| Detecção YOLO/ONNX | Implementada |
| YOLO Pose | Implementado |
| MediaPipe Hands | Implementado |
| Geometria dos dedos com correção X/Y | Implementada |
| Processamento multiframe | Implementado |
| Rastreamento temporal | Implementado |
| Eventos de aparição/desaparecimento de pessoas | Implementados |
| Frequência adaptativa | Implementada |
| Priorização de objetos próximos a punho/torso | Implementada |
| Interação mão↔objeto por regras | Implementada |
| Gravação segmentada de cinco minutos | Implementada |
| Índice de sessões e segmentos | Implementado |
| Registro de lacunas e falhas operacionais | Implementado |
| Buffer circular pré-evento | Implementado como componente; integração de produção precisa ser conferida |
| Persistência de vídeos e retenção | Implementada |
| Serviço de referência/comparação de cena | Implementado |
| Rotas HTTP para referência e comparação de cena | Implementadas |
| Associação de eventos a vídeos na consulta | Implementada em nível de infraestrutura |
| Avaliação automatizada de qualidade | Infraestrutura implementada |
| Validação de gestos com vídeos reais anotados | Pendente |
| Inventário alimentado automaticamente por detecções reais | Pendente |
| Ações complexas compreendidas semanticamente | Pendente |
| Associação persistente de mão, pessoa e objeto em cenários reais | Requer validação e evolução |
| Recuperação automática de sessão ativa após queda do processo | Pendente |
| Autenticação e criptografia em repouso | Pendentes |

## 2.2 Distinção importante sobre o modo de segurança

O projeto já possui gravação, sessões, segmentos, índice, rotas de consulta e serviço de cena. Porém, a documentação `docs/monitoramento.md` e `docs/cena.md` registra explicitamente que os itens da referência de cena ainda são **injetados pela API**.

A ponte que deve transformar as detecções reais da câmera em itens de inventário e alimentar continuamente `ServicoCena` ainda precisa ser implementada.

O serviço de cena atual:
- Compara rótulos e caixas normalizadas.
- Usa confirmação e confiança.
- Reconhece adição, remoção hipotética, movimento e mudança de estado informada.
- Não realiza reconhecimento semântico completo da cena.
- Não identifica sozinho objetos individuais semelhantes em uma sala.
- Não atualiza automaticamente o inventário a partir do detector.

A referência atual guarda um item por rótulo. Isso é insuficiente para ambientes com várias instâncias da mesma classe, como várias cadeiras, copos ou controles remotos. A identidade por instância precisa ser resolvida antes de confiar no inventário.

---

# 3. Prioridade zero — confiabilidade e integridade dos dados

Estas melhorias devem preceder a expansão de funcionalidades. Um sistema de memória visual que registra horários incorretos, perde segmentos ou transforma hipóteses em fatos não é confiável.

## 3.1 Corrigir a semântica dos timestamps

**Problema documentado:** em alguns fluxos o timestamp `capturadoEm` é criado depois da inferência, em vez de no instante da captura.

Implementar:
- Registrar `capturadoEmMs` imediatamente quando o frame é obtido.
- Preservar o timestamp original em todos os workers, filas, eventos e chamadas multimodais.
- Separar `capturadoEmMs`, `processadoEmMs`, `inferidoEmMs` e `persistidoEmMs`.
- Usar relógio monotônico para medir durações e latências.
- Usar timestamp de parede para a linha do tempo e correlação com vídeo.
- Registrar desvio de relógio e eventos fora de ordem.
- Não substituir timestamp de captura por horário de conclusão da inferência.

**Aceite:**
- Um evento deve apontar para o instante do frame que o originou.
- A latência de processamento deve ser mensurável separadamente.
- Eventos processados fora de ordem devem continuar ordenáveis cronologicamente.

## 3.2 Garantir identidade individual de objetos

Implementar um modelo de entidade por instância:
- `entidadeId` estável durante a vida do track.
- `classe` ou rótulo detectado.
- `primeiraObservacaoEmMs` e `ultimaObservacaoEmMs`.
- Histórico de caixas e posições.
- Confiança por observação.
- Estado atual e histórico de estados.
- Relação com pessoa, mão ou evento quando houver evidência.
- Estado de identidade: confirmada, provável, ambígua ou perdida.

Não usar apenas o nome da classe como chave. Duas cadeiras precisam ser duas entidades diferentes.

Quando o rastreador perder uma entidade, não reutilizar imediatamente seu ID para outro objeto. Usar janela de reidentificação e critérios de continuidade.

**Aceite:**
- Duas ou mais instâncias da mesma classe coexistem sem serem fundidas.
- O sistema não declara remoção apenas porque o detector falhou em um frame.
- Reidentificação incerta deve produzir ambiguidade, não certeza artificial.

## 3.3 Preservar a diferença entre fato, hipótese e ausência

Padronizar estados de evidência em todo o projeto:
- `observado`: evidência visual direta.
- `inferido`: conclusão derivada de múltiplas observações.
- `possivel`: hipótese com evidência insuficiente.
- `ocluido`: região/entidade encoberta.
- `nao_observado`: ausência efetivamente avaliada.
- `falha_percepcao`: detector/worker falhou.
- `desconhecido`: não há informação suficiente.

Não transformar:
- Falha de inferência em desaparecimento.
- Oclusão em remoção.
- Proximidade em contato.
- Contato em posse.
- Mudança de posição em intenção.
- Descrição de IA em fato sem evidência.

Toda conclusão deve carregar confiança, origem e evidências.

## 3.4 Recuperação após falhas e integridade da gravação

Implementar:
- Recuperação de sessão que ficou `ativa` no índice após encerramento abrupto.
- Reconciliação entre índice, arquivos existentes e uploads pendentes.
- Verificação de integridade e tamanho dos vídeos.
- Registro de segmentos incompletos ou corrompidos.
- Escrita atômica/segura do índice quando aplicável.
- Reenvio com idempotência para evitar duplicar segmentos.
- Política explícita para falta de espaço em disco.
- Alerta antes de o armazenamento atingir limite crítico.
- Testes de encerramento forçado do processo e reinicialização.

**Aceite:** depois de reiniciar, o sistema deve explicar quais segmentos estão íntegros, incompletos, ausentes ou pendentes. Nunca deve fingir que houve gravação durante uma lacuna.

---

# 4. Prioridade alta — transformar a Câmera de Segurança em percepção ambiental

## 4.1 Inventário inicial automático do ambiente

**Estado:** o serviço de referência existe, mas a integração com detecções reais ainda está pendente.

Implementar um fluxo de calibração inicial:
1. Iniciar a sessão de monitoramento.
2. Capturar vários frames distribuídos ao longo de uma janela inicial.
3. Executar detecção de objetos.
4. Associar detecções repetidas entre frames.
5. Remover duplicatas e falsos positivos por consistência temporal.
6. Criar entidades individuais.
7. Consolidar posição aproximada, classe, confiança e evidências.
8. Opcionalmente solicitar ao modelo multimodal uma descrição geral do cômodo.
9. Persistir a referência inicial.
10. Permitir revisão manual do inventário.

A descrição multimodal deve complementar os dados estruturados, não substituí-los.

O inventário deve conter:
- Identificador da sessão e do ambiente.
- Entidade/objeto individual.
- Classe e rótulo.
- Caixa delimitadora e posição normalizada.
- Região aproximada do ambiente.
- Confiança.
- Frames de evidência.
- Primeira e última observação.
- Estado físico observável, quando suportado.
- Status de confirmação.
- Histórico de alterações.

Não prometer detectar literalmente todos os itens: objetos pequenos, escondidos, transparentes, parcialmente ocluídos ou fora do campo de visão podem não ser detectados. O sistema deve registrar cobertura e incerteza.

## 4.2 Inventário com múltiplos objetos da mesma classe

Corrigir `construirReferencia()` e o contrato de cena para aceitar múltiplas instâncias por rótulo.

Substituir a lógica de um item por rótulo por associação entre instâncias baseada em:
- ID do rastreador.
- IoU e distância entre caixas.
- Continuidade temporal.
- Aparência/embedding, se houver modelo adequado.
- Região e contexto.
- Janela de oclusão e reidentificação.

O rótulo da classe não deve ser a identidade do objeto.

**Aceite:**
- Um cômodo com várias cadeiras mantém todas as cadeiras como entidades separadas.
- Uma cadeira movida continua sendo a mesma entidade quando a associação é confiável.
- Se não for possível determinar se é a mesma cadeira, o sistema registra uma associação ambígua.

## 4.3 Atualização contínua da referência

A referência não deve permanecer congelada para sempre, mas também não deve ser atualizada automaticamente a cada detecção.

Implementar:
- Referência inicial.
- Observações recentes.
- Estado atual estimado.
- Histórico de mudanças.
- Confirmação de mudança após persistência temporal.
- Revisão de mudanças ambíguas.
- Atualização controlada do baseline.
- Possibilidade de marcar uma alteração como permanente ou temporária.

Exemplo: uma cadeira deslocada por uma pessoa deve gerar um evento. O novo posicionamento só deve virar referência estável depois de confirmação ou regra definida.

## 4.4 Estados físicos dos objetos

Criar suporte gradual a estados visíveis, apenas para classes em que isso seja viável.

Exemplos:
- Porta: aberta/fechada.
- Gaveta: aberta/fechada.
- Luz: acesa/apagada, quando a imagem permitir.
- Monitor/TV: ligado/desligado, quando distinguível.
- Recipiente: tampa aberta/fechada.
- Objeto: em posição habitual/deslocado.

Não criar um estado para uma classe sem detector ou evidência adequada.

Cada estado precisa ter:
- Valor anterior.
- Valor atual.
- Horário da observação.
- Confiança.
- Frames de evidência.
- Duração estimada.
- Regra/modelo responsável.

## 4.5 Detecção de entrada e saída no ambiente

O detector de presença de pessoas já existe no motor temporal. Integrar seus eventos ao modo de monitoramento.

Implementar:
- Definição de regiões de entrada/saída.
- Linha ou zona virtual configurável.
- Diferenciar entrada, saída e simples aparição por oclusão.
- Manter ID temporário da pessoa durante o track.
- Tratar múltiplas pessoas.
- Preservar evento mesmo quando a pessoa sai do quadro.
- Associar os eventos aos segmentos de vídeo.
- Registrar falhas e períodos sem observação.

Não realizar identificação biométrica ou reconhecimento nominal de pessoas como requisito do sistema. A identidade necessária ao histórico pode ser temporária e anônima, limitada à sessão.

---

# 5. Prioridade alta — atenção orientada a eventos

A frequência adaptativa já existe para percepção geral e a documentação registra aumento de 2,5 para 5 FPS em determinadas condições. O modo de segurança precisa utilizar a mesma ideia de forma explícita e configurável.

## 5.1 Estados de atenção

Implementar uma máquina de estados própria para monitoramento:

1. `passivo`: cena estável, análise econômica.
2. `atividade_detectada`: movimento ou presença suspeita de atividade.
3. `atencao`: aumentar cadência e executar modelos adicionais.
4. `interacao`: acompanhar pessoa e objetos próximos.
5. `evento_em_confirmacao`: acumular evidências antes de registrar.
6. `pos_evento`: acompanhar saída e mudanças resultantes.
7. `retorno_passivo`: reduzir processamento após período estável.

Usar histerese para evitar alternância constante entre estados.

## 5.2 Política de frequência por subsistema

Não obrigar todos os modelos a executar na mesma frequência.

Criar configurações independentes:
- Captura/gravação: contínua.
- Detector leve de pessoa/objeto: frequência econômica.
- Mãos: frequência maior durante interação.
- Pose: frequência maior durante presença/atividade.
- Rastreamento: atualizar conforme observações disponíveis.
- Modelo multimodal: acionamento sob demanda ou por evento.
- Comparação de cena: após mudança relevante e em verificações periódicas.

As taxas finais devem ser escolhidas por benchmark no hardware real. Não fixar números sem medir CPU, GPU, RAM, latência e estabilidade.

## 5.3 Priorização de regiões

Usar a priorização por proximidade ao punho/torso já existente, mas estender para o modo de segurança:
- Pessoa detectada.
- Mãos e braços.
- Objetos próximos às mãos.
- Objetos que mudaram de posição.
- Regiões de entrada/saída.
- Regiões com mudança visual persistente.

A poda de contexto nunca deve descartar silenciosamente evidências. Manter contagem e motivo dos itens removidos do contexto.

## 5.4 Buffer pré-evento efetivamente integrado

O componente `BufferCircularQuadros` existe, mas a documentação pede confirmar sua integração real no fluxo de produção.

Integrar:
- Buffer de frames anteriores ao evento.
- Janela durante o evento.
- Janela posterior ao evento.
- Referência aos frames originais.
- Associação ao segmento de vídeo.
- Política de memória limitada.

O buffer de frames para análise não deve ser confundido com o vídeo contínuo gravado pelo `MediaRecorder`.

**Aceite:** ao detectar uma interação, o sistema consegue recuperar evidências anteriores ao primeiro instante de confirmação, sem inventar cobertura.

---

# 6. Prioridade alta — interação pessoa↔mão↔objeto

O projeto já possui regras de interação mão↔objeto. A próxima etapa é validar e ampliar a associação.

## 6.1 Associação mão e pessoa

Implementar e validar associação entre:
- Track da pessoa.
- Keypoints de ombro, cotovelo e punho do Pose.
- Track da mão do MediaPipe.
- Lateralidade esquerda/direita.
- Continuidade temporal.
- Proximidade e coerência de movimento.

Se houver duas pessoas ou mãos cruzadas, permitir `sem_atribuicao` ou `ambiguo`. É preferível não atribuir a mão a ninguém do que associá-la à pessoa errada.

## 6.2 Interações com objetos

Evoluir os eventos:
- Aproximou-se de um objeto.
- Tocou/possível contato.
- Contato confirmado por evidências.
- Pegou/levantou.
- Moveu.
- Colocou/deixou.
- Abriu/fechou.
- Empurrou/puxou.
- Manipulou por determinado período.

Nem todas essas ações podem ser inferidas apenas por proximidade. Cada classe de ação precisa de evidências e critérios próprios.

## 6.3 Estado antes e depois

Cada interação deve guardar:
- Pessoa/track envolvido.
- Mão envolvida, se identificável.
- Objeto/entidade.
- Posição anterior.
- Posição posterior.
- Estado anterior e posterior.
- Início e fim.
- Frames que sustentam a conclusão.
- Confiança e tipo de evidência.

## 6.4 Gestos e ações corporais

A avaliação real de gestos continua pendente na documentação `docs/pendencias.md`.

Executar o protocolo existente:
- Clipes de 10–20 segundos.
- Pelo menos duas pessoas.
- Gestos estáticos e dinâmicos.
- Condições de iluminação, oclusão e movimento rápido.
- Clipes negativos.
- Anotação temporal manual.
- Precisão, recall, falsos positivos/minuto, falsos negativos e atraso.
- Continuidade do track e associação mão↔pessoa.
- Relatório com resultado contra as metas propostas.

Não declarar gesto como suportado apenas porque existe uma regra e um teste sintético.

---

# 7. Prioridade alta — motor de eventos e memória visual

## 7.1 Modelo canônico de evento

Consolidar um esquema único para todos os acontecimentos.

Campos recomendados:
- `eventoId`
- `sessaoId`
- `tipo`
- `inicioEmMs`
- `fimEmMs`
- `capturadoEmMs`
- `registradoEmMs`
- `entidadesEnvolvidas[]`
- `objetoIds[]`
- `pessoaTrackIds[]`
- `acao`
- `estadoAnterior`
- `estadoPosterior`
- `confianca`
- `statusEvidencia`
- `frameIds[]`
- `segmentoIds[]`
- `posicoesNoVideo[]`
- `origem` (modelo/regra/subsistema)
- `versaoModelo`
- `observacoes`
- `correlacaoId`

Os campos exatos devem respeitar os contratos existentes e evoluir com migração compatível, não criar um segundo formato concorrente.

## 7.2 Tipos de evento

Organizar eventos em categorias:

**Ambiente**
- inventário criado/atualizado;
- objeto adicionado/removido;
- objeto movido;
- estado alterado;
- mudança de cena.

**Pessoas**
- aparição;
- entrada em região;
- saída de região;
- desaparecimento;
- oclusão;
- retorno após oclusão.

**Ações**
- braço levantado;
- gesto detectado;
- aproximação;
- interação;
- manipulação;
- objeto pego/deixado;
- abertura/fechamento.

**Operação**
- câmera desconectada;
- câmera reconectada;
- gravação iniciada/pausada/retomada;
- segmento incompleto;
- worker indisponível;
- inferência falhou;
- armazenamento crítico.

## 7.3 Memória de curto, médio e longo prazo

Separar:
- **Curto prazo:** frames, tracks e eventos em andamento.
- **Sessão:** inventário, pessoas temporárias, objetos e acontecimentos da sessão.
- **Longo prazo:** histórico de sessões, mudanças persistentes e consultas agregadas.

Não armazenar todos os frames indefinidamente. Preservar vídeo conforme retenção, e manter metadados e evidências selecionadas conforme política configurável.

## 7.4 Consultas ao histórico

Criar consultas que permitam:
- O que aconteceu entre dois horários?
- Quais objetos mudaram de lugar?
- Quando uma pessoa entrou/saiu?
- Quais objetos foram manipulados?
- Qual foi o estado anterior de determinado objeto?
- Mostrar eventos com baixa confiança.
- Abrir o vídeo no instante do evento.
- Comparar inventário atual com referência anterior.

A resposta deve diferenciar eventos confirmados de hipóteses e permitir abrir a evidência.

---

# 8. Interpretação multimodal

O modelo multimodal deve atuar como interpretador e sintetizador de evidências, não como substituto do rastreamento local.

## 8.1 Política de acionamento

Manter modos explícitos:
- Sob demanda.
- Orientado a eventos.
- Contínuo para benchmark/diagnóstico.

O modo orientado a eventos deve ser o padrão desejável para monitoramento, após validação.

## 8.2 Contexto enviado ao modelo

Enviar:
- Frames selecionados antes, durante e depois.
- Detecções estruturadas.
- Tracks e IDs temporários.
- Pose e landmarks relevantes.
- Eventos locais já detectados.
- Estado dos objetos antes/depois.
- Linha do tempo com timestamps.
- Incertezas e falhas de percepção.

Não enviar todos os frames por padrão. Selecionar evidências representativas e limitar contexto.

## 8.3 Resposta estruturada

Exigir saída estruturada:
- descrição curta do acontecimento;
- entidades envolvidas;
- ação observada;
- ação inferida;
- objetos relacionados;
- mudanças de estado;
- intervalo temporal;
- evidências citadas;
- confiança;
- incertezas;
- afirmações que não puderam ser verificadas.

Validar a saída contra schema. Rejeitar referências a frames ou entidades inexistentes.

## 8.4 Proteção contra alucinação

- Não aceitar afirmação sem frame ou evento de suporte.
- Não converter interpretação provável em fato confirmado.
- Exigir linguagem de incerteza quando a evidência for parcial.
- Manter texto original da IA separado dos eventos estruturados.
- Registrar modelo, versão, prompt e parâmetros.
- Comparar interpretações com anotações humanas nos benchmarks.

---

# 9. Gravação, armazenamento e operação contínua

## 9.1 Segmentação de vídeo

A segmentação de cinco minutos já está implementada em nível de domínio e gravação. Ainda falta validar no mundo real:
- Limite exato entre bytes de segmentos.
- Continuidade entre segmentos.
- Sincronização de timestamp de vídeo e timestamp dos eventos.
- Comportamento em pausa e retomada.
- Queda de processo durante segmento ativo.
- Falha de disco.
- Upload interrompido.
- Arquivo incompleto/corrompido.

## 9.2 Retenção

Configurar política de retenção realista:
- Quantidade máxima de dias.
- Limite máximo de armazenamento.
- Limite de arquivos.
- Exclusão por idade.
- Exclusão por espaço disponível.
- Preservação opcional de trechos associados a eventos importantes.
- Auditoria de exclusões.

A retenção deve estar habilitada e documentada para uso contínuo; os padrões atuais de retenção estão desligados por padrão.

## 9.3 Estimativa e monitoramento de espaço

Expor:
- Bytes gravados.
- Taxa média por hora.
- Espaço livre.
- Projeção de dias restantes.
- Segmentos pendentes.
- Segmentos incompletos.
- Crescimento de logs.
- Tamanho do índice.

Alertar antes de faltar espaço.

## 9.4 Robustez

Executar:
- Soak real de 30 minutos no hardware de referência.
- Sessão de várias horas.
- Queda e retorno da webcam física.
- Reinício abrupto do processo.
- Indisponibilidade do LM Studio/modelo remoto.
- Falha de worker.
- Falha de upload.
- Disco cheio.
- Alteração de resolução e dispositivo da câmera.

O harness `npm run validar:soak` existe, mas a execução real de 30 minutos com relatório arquivado continua pendente conforme `docs/pendencias.md`.

## 9.5 Recuperação automática

Na inicialização:
1. Ler sessões e segmentos.
2. Identificar sessão ativa abandonada.
3. Conferir arquivos presentes.
4. Marcar segmentos incompletos.
5. Reconciliar uploads pendentes.
6. Fechar ou recuperar a sessão de forma explícita.
7. Registrar a recuperação no log operacional.

---

# 10. Segurança, privacidade e controle

O servidor escuta em `127.0.0.1` por padrão e não possui autenticação embutida. Exposição remota exige opt-in e proteção externa. Não expor a câmera diretamente na rede sem controle de acesso.

Implementar ou definir:
- Autenticação para acesso remoto.
- Controle de sessão e autorização.
- HTTPS quando houver acesso pela rede.
- Proteção contra acesso a vídeos por URL previsível.
- Criptografia em repouso para vídeos e dados sensíveis.
- Gestão de chaves fora do repositório.
- Política de retenção e exclusão verificável.
- Auditoria de acesso e exclusão.
- Limites de upload e download.
- Proteção contra requisições de origem não autorizada.
- Separação entre logs operacionais e dados visuais.
- Consentimento e sinalização quando houver gravação de pessoas.
- Procedimento para exportar e apagar dados de uma sessão.

Vídeos, snapshots e logs podem conter dados pessoais. Não versionar gravações reais nem enviar clipes sensíveis a serviços externos sem decisão explícita.

---

# 11. Desempenho no hardware disponível

O hardware de referência é próximo do PC do projeto: Xeon E5 v3, 16 GB de RAM e Radeon RX 5600 OEM. A capacidade real precisa ser medida no ambiente instalado.

## 11.1 Medir antes de otimizar

Registrar por subsistema:
- CPU total e por processo.
- RAM e pico de memória.
- GPU e memória de GPU, quando API real estiver disponível.
- FPS de captura.
- FPS de inferência por modelo.
- Latência mediana e P95.
- Tempo de inicialização.
- Tempo de fila.
- Frames descartados.
- Temperatura, quando disponível.
- Armazenamento e taxa de escrita.

Não apresentar GPU como disponível quando a telemetria não consegue medi-la; manter `null` e motivo, como já previsto no health.

## 11.2 Política de recursos

- Evitar executar todos os modelos em todos os frames.
- Limitar concorrência por worker.
- Aplicar backpressure quando a fila crescer.
- Descartar frames antigos quando não forem mais úteis para o objetivo, registrando a perda.
- Priorizar captura e gravação sobre inferência.
- Suspender tarefas opcionais quando CPU/RAM estiverem críticas.
- Carregar modelos sob demanda quando isso reduzir consumo sem causar latência inaceitável.
- Medir custo de inicialização e aquecimento.
- Evitar carregar modelos NSFW durante testes de percepção geral, salvo quando a avaliação exigir.

## 11.3 Benchmark comparativo

Comparar variantes com:
- Mesmo conjunto de vídeos.
- Mesma máquina.
- Mesma resolução.
- Mesma cadência.
- Mesmos thresholds.
- Mesma versão de modelo.
- Warm-up separado.
- Repetições suficientes.
- Mediana e P95.
- Precisão/recall junto do custo computacional.

Não escolher arquitetura apenas pela maior quantidade de detecções ou FPS.

---

# 12. Avaliação com dados reais

A maior lacuna de validação continua sendo a ausência de clipes reais anotados para gestos, ações, oclusão, iluminação e monitoramento ambiental.

## 12.1 Gestos

Seguir o protocolo já escrito em `docs/pendencias.md`:
- Clipes de 10–20 s.
- Duas ou mais pessoas.
- Gestos estáticos e dinâmicos.
- Condições adversas.
- Clipes negativos.
- Anotação de início/fim e identidade temporária.
- Precisão, recall, falsos positivos/minuto, falsos negativos e atraso.
- Continuidade do track e associação mão↔pessoa.

As metas do documento atual são metas iniciais a confirmar com a primeira linha de base, não resultados já alcançados.

## 12.2 Câmera de Segurança

Criar dataset controlado de cômodos:
- Cena vazia inicial.
- Inventário com objetos únicos e repetidos.
- Pessoa entrando e saindo.
- Pessoa passando sem tocar em nada.
- Pessoa tocando e movendo objetos.
- Objeto ocultado e revelado.
- Mudança de iluminação.
- Oclusão parcial.
- Objeto retirado e devolvido.
- Duas pessoas interagindo.
- Mudança permanente de posição.

Anotar:
- Entidades reais.
- Posições.
- Entrada/saída.
- Ações.
- Interações.
- Estado anterior/posterior.
- Intervalo temporal.
- Evidência visual.

## 12.3 Métricas ambientais

Medir:
- Precisão/recall de objetos por classe.
- Erro de contagem de instâncias.
- Precisão de associação de identidade.
- Falsos objetos adicionados/removidos.
- Precisão de mudança de posição.
- Precisão de estado físico.
- Precisão/recall de entrada e saída.
- Precisão de interação mão↔objeto.
- Atraso de detecção e confirmação.
- Percentual de eventos com vídeo/frame recuperável.

## 12.4 Gate de aceite

Não marcar uma fase como concluída apenas porque:
- Compila.
- Tem testes unitários.
- Passa em dados sintéticos.
- A IA produziu uma descrição convincente.

Uma fase só deve ser aceita quando:
1. O comportamento está implementado.
2. Os testes determinísticos passam.
3. Existe avaliação com dados reais anotados quando a capacidade depende de visão.
4. As métricas são publicadas.
5. As limitações conhecidas estão registradas.
6. O hardware de referência mantém estabilidade.

---

# 13. Interface e experiência de uso

Melhorias recomendadas:
- Painel de estado da câmera, gravação e análise separados.
- Indicador claro de gravação ativa, pausada ou interrompida.
- Estado atual da atenção: passivo, atividade, interação ou pós-evento.
- Inventário visual editável.
- Linha do tempo de eventos.
- Filtros por pessoa temporária, objeto, tipo de evento e horário.
- Clique em evento abre vídeo no instante correspondente.
- Mostrar confiança e status da evidência.
- Diferenciar fato observado de interpretação da IA.
- Mostrar lacunas de gravação e falhas de percepção.
- Mostrar consumo de CPU/RAM, FPS e espaço em disco.
- Permitir corrigir inventário e eventos, registrando a correção humana.
- Permitir exportar histórico em JSONL/CSV e metadados de sessão.

Não esconder incerteza em uma descrição textual simplificada.

---

# 14. Organização e manutenção do código

A estrutura atual já possui separação funcional. Evitar uma refatoração ampla antes de integrar o fluxo de segurança.

Refatorar gradualmente:
- Controladores grandes de ciclo.
- Servidor HTTP.
- Orquestração do monitoramento.
- Construção do contexto multimodal.
- Persistência e consultas de eventos.

Criar fronteiras claras:
- Captura.
- Percepção.
- Tracking.
- Motor temporal.
- Modelo de cena.
- Motor de atenção.
- Interpretação multimodal.
- Persistência.
- API.
- Interface.

Regras:
- Domínio sem dependência de relógio global.
- Timestamps injetados.
- Contratos tipados e validados.
- Persistência atrás de repositórios/serviços.
- Workers sem estado compartilhado implícito.
- Testes de contrato para comunicação entre módulos.
- Migrações de schema versionadas.
- Documentação atualizada junto com mudanças de comportamento.

---

# 15. Plano de execução recomendado

A ordem abaixo prioriza valor funcional e redução de risco. Não é necessário executar tudo em uma única entrega.

## Fase 0 — Auditoria e baseline

- [x] Instalar dependências em ambiente limpo.
- [x] Executar `npm run typecheck`.
- [x] Executar `npm run lint`.
- [x] Executar `npm test`.
- [x] Executar `npm run build`.
- [x] Executar E2E de monitoramento.
- [x] Registrar versões de Node, navegador, modelos e hardware (modelo indisponível registrado como não medido).
- [ ] Gerar baseline de FPS, latência, CPU, RAM e armazenamento — telemetria acelerada registrada; medição real com detector/clipe permanece pendente.
- [x] Registrar falhas atuais antes de alterar código.

**Saída:** relatório de estado reproduzível em [`docs/auditoria-fase-0.md`](docs/auditoria-fase-0.md).

## Fase 1 — Integridade temporal e identidade

- [x] Corrigir timestamp no instante da captura.
- [x] Separar captura, processamento e persistência.
- [x] Padronizar estados de evidência.
- [x] Implementar identidade individual de objetos.
- [x] Corrigir inventário para múltiplas instâncias da mesma classe.
- [x] Melhorar reidentificação após oclusão.
- [x] Adicionar testes de regressão.

**Saída:** entidades e eventos temporalmente confiáveis; detalhes em [`docs/fase-1-integridade.md`](docs/fase-1-integridade.md).

## Fase 2 — Inventário automático

- [ ] Integrar detecções YOLO ao `ServicoCena`.
- [ ] Criar pipeline de coleta de frames para referência inicial.
- [ ] Consolidar detecções repetidas.
- [ ] Criar inventário com instâncias distintas.
- [ ] Associar evidências e timestamps.
- [ ] Integrar comparação automática em cada observação relevante.
- [ ] Implementar confirmação de mudança.
- [ ] Criar interface de revisão do inventário.

**Saída:** o sistema constrói e mantém uma representação parcial, mas rastreável, do ambiente.

## Fase 3 — Motor de atenção da segurança

- [ ] Criar estados passivo/atividade/atenção/interação/pós-evento.
- [ ] Integrar detector de presença ao modo de segurança.
- [ ] Definir zonas de entrada e saída.
- [ ] Ajustar frequência por subsistema.
- [ ] Integrar buffer pré-evento ao fluxo real.
- [ ] Aumentar análise quando houver pessoa ou mudança relevante.
- [ ] Reduzir processamento após estabilidade.
- [ ] Medir custo de cada estado.

**Saída:** processamento adaptativo sem interromper gravação.

## Fase 4 — Interações e ações

- [ ] Associar mão a pessoa por pose e continuidade.
- [ ] Associar mão a objeto.
- [ ] Distinguir proximidade, contato e manipulação.
- [ ] Detectar objeto pego/deixado quando houver evidência.
- [ ] Detectar mudanças de estado suportadas.
- [ ] Criar eventos com estado anterior/posterior.
- [ ] Validar gestos com clipes reais anotados.
- [ ] Publicar métricas de precisão e atraso.

**Saída:** histórico de ações observáveis, com incerteza explícita.

## Fase 5 — Memória e consulta

- [ ] Consolidar schema canônico de eventos.
- [ ] Implementar consultas por horário, pessoa temporária, objeto e ação.
- [ ] Vincular evento a segmento e posição no vídeo.
- [ ] Criar linha do tempo visual.
- [ ] Implementar memória por sessão e histórico entre sessões.
- [ ] Criar exportação de eventos.
- [ ] Permitir correção humana auditável.

**Saída:** histórico pesquisável e verificável.

## Fase 6 — Interpretação multimodal

- [ ] Consolidar política orientada a eventos.
- [ ] Selecionar frames relevantes automaticamente.
- [ ] Enviar contexto temporal estruturado.
- [ ] Validar resposta contra schema.
- [ ] Exigir referências a evidências.
- [ ] Separar observação de inferência.
- [ ] Medir latência e custo por evento.
- [ ] Comparar respostas com anotações humanas.

**Saída:** descrições úteis sem transformar alucinações em registros factuais.

## Fase 7 — Operação contínua e segurança

- [ ] Recuperar sessão após queda do processo.
- [ ] Validar segmento incompleto e upload pendente.
- [ ] Executar soak real de 30 minutos.
- [ ] Executar sessão prolongada.
- [ ] Testar webcam física e reconexão.
- [ ] Testar disco cheio e falha de escrita.
- [ ] Habilitar política de retenção.
- [ ] Implementar autenticação para acesso remoto.
- [ ] Implementar criptografia em repouso.
- [ ] Auditar acesso, exportação e exclusão.
- [ ] Documentar consentimento e privacidade.

**Saída:** operação previsível e segura.

## Fase 8 — Otimização e manutenção

- [ ] Comparar variantes de modelos e cadência.
- [ ] Reduzir inicialização e consumo de RAM.
- [ ] Ajustar backpressure e filas.
- [ ] Refatorar controladores grandes.
- [ ] Atualizar documentação.
- [ ] Automatizar relatórios de benchmark.
- [ ] Definir política de compatibilidade de modelos e dependências.

**Saída:** sistema sustentável para evolução.

---

# 16. Critérios gerais de conclusão do projeto

O Neuro Vision estará próximo do objetivo quando conseguir:

- [ ] Gravar continuamente em segmentos de cinco minutos.
- [ ] Recuperar-se de falhas sem inventar períodos gravados.
- [ ] Criar inventário inicial a partir da câmera.
- [ ] Manter várias instâncias da mesma classe separadas.
- [ ] Detectar mudanças de posição e estado com métricas conhecidas.
- [ ] Detectar entrada e saída de pessoas.
- [ ] Acompanhar pessoas e objetos durante interações.
- [ ] Registrar ações com timestamps de captura.
- [ ] Preservar evidências em frames e vídeos.
- [ ] Diferenciar fatos, inferências e hipóteses.
- [ ] Consultar acontecimentos por linguagem estruturada ou filtros.
- [ ] Operar por períodos prolongados no hardware alvo.
- [ ] Manter retenção e proteção dos dados.
- [ ] Publicar métricas reais de precisão, recall, atraso e estabilidade.

---

# 17. O que NÃO recomendo fazer agora

1. **Não adicionar mais modelos sem uma lacuna mensurável.** Primeiro integrar e avaliar os que já existem.
2. **Não aumentar a frequência de todos os subsistemas indiscriminadamente.** Usar atenção adaptativa.
3. **Não enviar todos os frames ao modelo multimodal.** Selecionar evidências e resumir localmente.
4. **Não tratar descrição da IA como verdade.** A IA interpreta; o registro precisa preservar evidência e incerteza.
5. **Não fazer refatoração geral agora.** Integrar inventário e motor de atenção primeiro.
6. **Não prometer reconhecimento de qualquer ação.** Definir ações suportadas e medir cada uma.
7. **Não confiar em testes sintéticos como validação de campo.**
8. **Não expor a câmera na rede sem autenticação e proteção adequadas.**
9. **Não armazenar indefinidamente vídeos sem política de retenção.**
10. **Não confundir detecção de objeto com identidade persistente do objeto.**

---

# 18. Diretriz arquitetural final

A arquitetura que deve orientar as próximas decisões é:

```text
CÂMERA
  ├── GRAVAÇÃO CONTÍNUA
  │     ├── Segmentos de 5 minutos
  │     ├── Índice e retenção
  │     └── Recuperação e integridade
  │
  └── PERCEPÇÃO
        ├── Detecção de objetos/pessoas
        ├── Pose e mãos
        ├── Rastreamento de entidades
        └── Observações com timestamps
              │
              ▼
        MOTOR TEMPORAL
              ├── Presença e movimento
              ├── Identidade temporária
              ├── Interação pessoa/mão/objeto
              └── Mudanças de cena
                    │
                    ▼
              MOTOR DE ATENÇÃO
                    ├── Passivo
                    ├── Atividade
                    ├── Atenção
                    ├── Interação
                    └── Pós-evento
                          │
                          ▼
                 INTERPRETAÇÃO MULTIMODAL
                          ├── Frames selecionados
                          ├── Contexto temporal
                          ├── Hipóteses e descrição
                          └── Evidências referenciadas
                                │
                                ▼
                       MEMÓRIA VISUAL
                                ├── Inventário
                                ├── Entidades
                                ├── Estados
                                ├── Acontecimentos
                                ├── Vídeos e frames
                                └── Consultas e histórico
```

A gravação e a percepção são linhas independentes, mas compartilham timestamps e identificadores de sessão. O motor temporal transforma observações em eventos; o motor de atenção decide onde gastar processamento; o modelo multimodal interpreta casos relevantes; a memória persiste somente afirmações com origem, confiança e evidência.

**Princípio central:** o Neuro Vision deve saber o que viu, quando viu, o que mudou, por que chegou a determinada conclusão e qual evidência permite verificar essa conclusão.
