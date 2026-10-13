# Plano de correções — Neuro Vision

> **Base analisada:** `neuro-vision-feat-temporal-perception`  
> **Commit do ZIP:** `e55aeefe12494856b9479c19d50ee5a21e9475bc`  
> **Objetivo:** tornar a percepção temporal previsível, associar cada evento à evidência correta, reduzir falsos positivos e garantir que o histórico reflita o que realmente aconteceu.

Este documento é um roteiro de implementação. Marque cada tarefa somente depois de alterar o código e executar os testes relacionados. As mudanças estão ordenadas por dependência: evite otimizar modelos ou adicionar memória semântica antes de concluir as fases críticas.

## Regras de execução

- [x] Trabalhar em uma branch própria, por exemplo `fix/percepcao-temporal`.
- [x] Fazer uma alteração lógica por commit, com mensagem que descreva o comportamento corrigido.
- [ ] Antes de mudar uma métrica, registrar o valor atual e a configuração usada.
- [ ] Não considerar os testes sintéticos como prova suficiente de desempenho com uma webcam real.
- [ ] Preservar compatibilidade com entradas antigas do JSONL: novos campos devem ser opcionais ou migrados de forma explícita.

---

## Fase 0 — registrar uma linha de base reproduzível

**Arquivos principais:** `package.json`, `bench/BASELINE.md`, `bench/videos/README.md`, `docs/qualidade.md`.

### Passo a passo

- [x] Instalar exatamente as dependências do lockfile:

  ```bash
  npm ci
  ```

- [x] Executar as verificações iniciais separadamente e guardar a saída:

  ```bash
  npm run typecheck
  npm run lint
  npm test
  npm run build
  ```

- [x] Registrar quais comandos passam e quais falham antes de alterar o código. Não atribuir uma falha de dependência ao código da aplicação sem investigar.
- [x] Registrar a configuração de benchmark: modelo, backend (WebGPU/WASM e Ollama/LM Studio), resolução, intervalo configurado e hardware.
- [x] Preservar como referência o resultado já documentado em `bench/BASELINE.md`: precisão de 25%, recall de 100%, cerca de 6 falsos positivos por minuto e atraso observado de 3,4 s. É um resultado de um clipe específico, não uma estimativa universal.

### Critério para concluir

- [x] Existe um registro claro do estado inicial e é possível repetir os comandos e a medição no mesmo ambiente.

---

## Fase 1 — corrigir a semântica do agendador

**Arquivos:** `public/scheduler.ts`, `src/agendador.test.ts`, `public/app.ts`, `docs/modos.md`, `docs/uso.md`.

### Problema

O agendador calcula `max(intervaloMs, ultimaDuracaoMs + 500)` **depois** que `executar()` terminou. Assim, o intervalo configurado vira um tempo de espera adicional após a análise. Além disso, `ultimaDuracaoMs` representa a duração reportada pela última inferência, não necessariamente a duração total do ciclo — que, no modo Eventos, pode incluir detecção, chamada ao Ollama e outros passos.

### Passo a passo

- [x] Definir explicitamente o significado do campo de intervalo. **Recomendação:** tratá-lo como o intervalo mínimo desejado entre os inícios dos ciclos, sem permitir ciclos sobrepostos.
- [x] Medir a duração real de todo o ciclo dentro de `AgendadorAnalise`, envolvendo a execução completa com `performance.now()`; não usar a duração de uma única inferência como substituto.
- [x] Calcular o atraso após o ciclo usando o tempo que falta para atingir o intervalo configurado, mantendo uma margem mínima entre inferências. Para intervalo entre inícios, a regra sugerida é:

  ```ts
  espera = Math.max(margemMinimaMs, intervaloConfiguradoMs - duracaoCicloMs);
  ```

  Com essa regra, o intervalo real entre inícios fica aproximadamente em `max(intervaloConfiguradoMs, duracaoCicloMs + margemMinimaMs)`, sem adicionar novamente a duração inteira depois do término.

- [x] Atualizar comentários e nomes das funções para não confundir “intervalo entre inícios” com “espera após término”.
- [x] Garantir que um erro inesperado em `executar()` não deixe o agendador permanentemente sem novos ciclos nem produza uma rejeição não tratada. Registrar o erro, limpar o estado de execução e reagendar apenas se o agendador continuar ativo.
- [x] Preservar a garantia de que `disparar()` não inicia uma segunda análise concorrente.
- [x] Atualizar os testes atuais de `src/agendador.test.ts`, que hoje codificam a espera adicional após a duração da análise.

### Testes obrigatórios

- [x] Ciclo rápido: o intervalo entre inícios respeita a configuração.
- [x] Ciclo mais lento que o intervalo: o próximo ciclo começa depois do término mais a margem mínima.
- [x] Alterar o intervalo enquanto o timer está pendente aplica a configuração nova.
- [x] Parar durante uma análise impede novos ciclos.
- [x] Um erro inesperado não deixa o agendador em estado inconsistente.
- [x] O botão “analisar agora” não causa sobreposição.

### Critério para concluir

- [x] A cadência é previsível e a documentação corresponde ao comportamento testado.

---

## Fase 2 — manter a mesma evidência do evento à interpretação

**Arquivos:** `public/app.ts`, `public/camera.ts`, `public/motores.ts`, `src/percepcao.ts`, testes E2E se necessário.

### Problema

No modo Eventos, `analisarEventos()` captura um quadro, executa a percepção leve e detecta a mudança. Se a política acionar o Ollama, `analisarComOllama()` faz uma **nova captura** da webcam. Como a inferência pode demorar segundos, o modelo pode descrever outra cena, não aquela que disparou o evento.

O caminho `analisarDeteccao()` já usa uma captura única para detecção, snapshot e assinatura da cena; o fluxo Eventos precisa aplicar o mesmo princípio à chamada subsequente ao Ollama.

### Passo a passo

- [x] Criar um objeto de captura tipado que carregue, no mínimo, o instante `capturadoEm`, a imagem usada pela percepção e o snapshot correspondente.
- [x] Fazer `analisarComOllama()` aceitar uma captura existente como parâmetro opcional, em vez de sempre chamar `camera.capturarFrame()`.
- [x] Quando `analisarEventos()` decidir chamar o Ollama, passar a captura que gerou a decisão e manter o mesmo `capturadoEm`.
- [x] Se for necessário reduzir a imagem para o Ollama (por exemplo, largura máxima de 512 px), gerar essa versão a partir dos pixels já capturados. Não ler a webcam novamente para criar a versão reduzida.
- [x] Vincular os eventos derivados ao mesmo identificador de quadro, snapshot e horário de captura.
- [x] Se no futuro existir um modo que deliberadamente analise a cena mais recente, diferenciá-lo explicitamente: guardar tanto a evidência que disparou a decisão quanto o frame efetivamente analisado.
- [x] Atualizar a documentação de eventos para definir a diferença entre `capturadoEm` e o horário de conclusão da inferência.

### Testes obrigatórios

- [x] Stub de câmera devolve uma captura identificável; o detector e o Ollama recebem a mesma captura.
- [x] O horário salvo no evento corresponde ao instante de captura, não ao momento posterior da inferência.
- [x] A versão reduzida enviada ao Ollama é derivada do mesmo quadro, sem uma segunda leitura do vídeo.

### Critério para concluir

- [x] É possível rastrear cada interpretação até a imagem e o instante que a motivaram.

---

## Fase 3 — estabilizar o rastreamento de objetos

**Arquivos:** `src/rastreamento.ts`, `src/rastreamento.test.ts`, `public/app.ts`, `docs/eventos.md`, `docs/limites.md`.

### Problema A: expiração incompatível com o intervalo real

A configuração padrão usa `expiracaoMs: 2000`, mas a detecção pode ocorrer com intervalos de vários segundos. Como o rastreador expira um objeto se o limite temporal **ou** o limite por frames for ultrapassado, um único frame sem detecção pode bastar para emitir desaparecimento quando a próxima observação chega depois de 2 segundos.

### Passo a passo — expiração e confirmação

- [x] Medir a cadência real entre quadros observados, usando o tempo do ciclo completo; não estimá-la apenas pelo valor do controle da interface.
- [x] Definir o que significa `maxFramesAusente`: quantos quadros consecutivos sem detecção são tolerados antes de confirmar desaparecimento.
- [x] Ajustar `expiracaoMs` para que não seja menor que a cadência normal de observação. Como ponto inicial, considerar um timeout com base no percentil 95 do intervalo entre observações e no número de quadros ausentes tolerados; calibrar com vídeos anotados.
- [ ] Tornar a confirmação de aparição configurável. Comparar a configuração de um único quadro com a confirmação em observações consecutivas; medir o custo em atraso versus a redução de falsos positivos.
- [x] Evitar que uma única falha transitória de detecção seja interpretada como desaparecimento quando a cadência real for lenta.
- [x] Registrar nos comentários e na documentação como os limites por tempo e por frames interagem; testar a condição combinada para que um limite não anule silenciosamente o outro.

### Problema B: associação gulosa de detecções

O algoritmo percorre as detecções na ordem recebida e escolhe a melhor associação disponível para cada uma. Em situações com objetos da mesma classe próximos ou que cruzam trajetórias, a ordem de entrada pode alterar a associação e trocar IDs.

### Passo a passo — associação

- [x] Construir uma lista de pares plausíveis entre objetos existentes e novas detecções, usando classe/rótulo, IoU e distância dos centros.
- [x] Ordenar as associações candidatas pela pontuação, do melhor para o pior, atribuindo cada objeto e cada detecção no máximo uma vez. Isso é uma melhoria inicial em relação à associação dependente da ordem das detecções.
- [x] Criar testes em que duas pessoas se aproximam, cruzam trajetórias, ficam parcialmente ocluídas e reaparecem após uma ausência curta.
- [x] Embarcar num algoritmo global de atribuição (por exemplo, húngaro) somente se os testes mostrarem que a associação inicial ainda falha de forma relevante.

### Testes obrigatórios

- [x] Objeto estático durante vários ciclos lentos não gera eventos de desaparecimento e reaparição espúrios.
- [x] Uma ausência curta é tolerada conforme a configuração.
- [x] Uma ausência prolongada gera um único desaparecimento.
- [x] A ordem das detecções não troca a identidade em cenários controlados.
- [ ] Baixa confiança, caixa com ruído e oclusão não criam eventos duplicados sem justificativa.

### Critério para concluir

- [x] Os identificadores permanecem estáveis em cenários representativos, e a expiração é coerente com a cadência observada.

---

## Fase 4 — impedir colisões de IDs entre sessões

**Arquivos:** `src/types.ts`, `src/rastreamento.ts`, `src/cena.ts`, `public/app.ts`, `src/server.ts`, `src/api.test.ts`, `src/rastreamento.test.ts`, `src/cena.test.ts`.

### Problema

O rastreador reinicia seus contadores em `obj-1` e `evt-1`; o detector de cenas também começa em `cena-1`. Como os eventos ficam em JSONL entre reinicializações, IDs locais podem se repetir e uma consulta pelo `objetoId` pode misturar entidades de sessões diferentes.

### Passo a passo

- [x] Definir uma `sessaoId` única para cada execução de percepção iniciada pelo usuário, gerada com `crypto.randomUUID()` ou mecanismo equivalente suportado.
- [x] Associar `sessaoId` aos eventos e, quando pertinente, às entradas do histórico.
- [x] Tornar o `objetoId` único entre sessões — por exemplo, incluir o ID da sessão no valor — ou usar IDs globais únicos para objetos. Não depender apenas do contador reiniciado.
- [x] Gerar IDs de evento globalmente únicos ou combinar `sessaoId` e contador. Manter uma convenção documentada para eventos do rastreador e do detector de cena.
- [x] Atualizar o esquema e a validação da API para preservar os novos campos sem rejeitar entradas JSONL antigas que não os possuem.
- [ ] Atualizar filtros, exportação e testes para que consultas por objeto não misturem sessões diferentes.

### Testes obrigatórios

- [ ] Dois rastreadores em sessões diferentes podem produzir o primeiro objeto sem compartilhar o mesmo identificador persistido.
- [ ] Eventos de rastreador e de cena de sessões diferentes não colidem.
- [ ] Histórico legado sem `sessaoId` continua legível.

### Critério para concluir

- [ ] Os IDs continuam inequívocos mesmo após parar, reiniciar e consultar o histórico antigo.

---

## Fase 5 — alinhar cooldown da política e limpeza de estado

**Arquivos:** `src/politica-analise.ts`, `src/politica-analise.test.ts`, `public/app.ts`, `docs/modos.md`.

### Problema A: falhas de percepção podem acionar o modelo sem respeitar o cooldown

Quando `percepcaoValida` é `false`, a política verifica a capacidade da janela, mas não aplica o mesmo cooldown que usa nos eventos normais. Uma sequência de falhas pode, portanto, provocar tentativas ao Ollama mais frequentes do que o intervalo mínimo documentado.

### Passo a passo — política

- [ ] Definir explicitamente quais motivos respeitam o cooldown. Recomendação: todas as chamadas automáticas — inclusive `falha_percepcao` — respeitam o cooldown e o limite por janela; apenas a ação manual pode ignorar o cooldown se esse for o comportamento desejado.
- [ ] Implementar essa regra em um único ponto, para não haver caminhos automáticos com políticas diferentes sem intenção.
- [ ] Esclarecer se uma tentativa que falha ou é cancelada conta no limite. Recomendação: contar chamadas iniciadas de verdade, registrar resultado/sucesso separadamente e evitar repetir imediatamente um backend indisponível.
- [ ] Adicionar testes com falhas consecutivas de percepção antes e depois do cooldown, limite de chamadas esgotado e acionamento manual.

### Problema B: limpar o histórico não reinicia toda a percepção temporal

O servidor limpa os arquivos de entradas, eventos e snapshots. No cliente, a função `limparHistorico()` limpa a lista, `ultimaDescricao` e `roteiroBeats`, mas não reinicia o rastreador, o detector de cenas ou a política de análise.

### Passo a passo — limpeza

- [ ] Definir a operação de limpar histórico como um limite consistente de contexto: depois da limpeza, nenhum evento novo deve depender de objetos/estado anterior que não está mais no histórico.
- [ ] Reiniciar `rastreador`, `detectorCena` e `politica`; limpar também `manualSolicitado`, `ultimaDescricao`, `roteiroBeats` e restaurar `roteiroPrimeiro`.
- [ ] Evitar corrida com gravações pendentes. Enquanto o histórico for apagado, pause o agendador e aguarde a conclusão/cancelamento das gravações em andamento, ou desabilite a ação até que o ciclo esteja quiescente.
- [ ] Se a aplicação estava rodando, definir e testar se retoma automaticamente depois da limpeza. Não deixar um ciclo antigo gravar de volta um evento logo após a API responder que apagou tudo.

### Testes obrigatórios

- [ ] Falhas automáticas respeitam a regra de cooldown escolhida.
- [ ] A análise manual segue a exceção documentada.
- [ ] Limpar o histórico remove entradas, eventos e snapshots no servidor e reseta o estado temporal no cliente.
- [ ] Uma gravação iniciada antes da limpeza não reaparece depois dela.

### Critério para concluir

- [ ] A política é previsível e limpar o histórico não deixa estado oculto nem corridas com gravações pendentes.

---

## Fase 6 — tornar a persistência confiável e evitar snapshots duplicados

**Arquivos:** `public/api.ts`, `public/app.ts`, `src/server.ts`, `src/api.test.ts`, `docs/api.md`, `docs/eventos.md`.

### Problema A: `fetch()` não rejeita por respostas HTTP de erro

`gravarEntrada()` e `gravarEvento()` capturam erros de rede, mas não verificam `resposta.ok`. Uma resposta HTTP `400` ou `500` pode ser tratada como sucesso mesmo que o servidor não tenha gravado o conteúdo.

### Passo a passo — resposta HTTP

- [ ] Depois de cada `fetch()` de gravação, verificar `response.ok`.
- [ ] Quando não for `ok`, tentar ler `{ erro }` do corpo da resposta e lançar `ErroPercepcao` com status HTTP e mensagem úteis.
- [ ] Evitar duplicar o mesmo tratamento em cada função: criar um helper local para verificar respostas, se isso simplificar o módulo.
- [ ] Adicionar testes em `src/api.test.ts` para resolução HTTP com status `400`/`500`, não apenas falhas de rede.
- [ ] Garantir que a interface e o diagnóstico operacional indiquem a falha de persistência sem declarar o evento como salvo.

### Problema B: múltiplos eventos da mesma captura podem gravar cópias do mesmo snapshot

Um único quadro pode gerar vários eventos. Cada `POST /api/eventos` envia o mesmo snapshot, e o servidor pode salvar uma cópia física diferente para cada requisição.

### Passo a passo — reutilização do snapshot

- [ ] Associar uma chave `frameId` à captura e aos eventos derivados dela.
- [ ] Escolher uma solução de persistência única: (a) salvar a imagem uma vez e devolver uma referência reutilizável, ou (b) deduplicar no servidor por hash do conteúdo.
- [ ] Se usar uma referência `/snapshots/...`, atualizar a validação do servidor para aceitar e verificar referências existentes com segurança; não mandar uma URL para uma função que espera dados base64 sem alterar o contrato.
- [ ] Fazer todos os eventos da mesma captura referenciar o mesmo arquivo de snapshot.
- [ ] Adicionar teste: N eventos oriundos de um mesmo quadro resultam em uma única imagem persistida; eventos de quadros diferentes não compartilham a imagem incorretamente.

### Problema C: gravações concorrentes e possíveis perdas

O cliente dispara persistências com `void api.gravarEvento(...)`. Os erros são tratados superficialmente, e várias gravações podem correr em paralelo.

### Passo a passo — fila de gravação

- [ ] Introduzir uma fila pequena de persistência para manter a ordem dos eventos e limitar requisições simultâneas.
- [ ] Usar IDs de evento idempotentes no servidor para que uma repetição de requisição não acrescente eventos duplicados.
- [ ] Implementar no máximo algumas tentativas com atraso progressivo para falhas transitórias; não repetir indefinidamente nem bloquear o processamento visual.
- [ ] Expor falhas persistentes na interface/diagnóstico e permitir exportar eventos não enviados, se houver fila pendente.
- [ ] Testar queda do servidor, recuperação, resposta `500`, repetição da mesma requisição e encerramento da aplicação com fila pendente.

### Critério para concluir

- [ ] Falhas de gravação são detectáveis, reenvios não duplicam eventos e várias ocorrências do mesmo frame não multiplicam snapshots no disco.

---

## Fase 7 — reduzir falsos positivos com uma avaliação mais representativa

**Arquivos:** `src/rastreamento.test.ts`, `src/cena.test.ts`, `src/politica-analise.test.ts`, `src/qualidade-eventos.test.ts`, `scripts/avaliar-qualidade.mjs`, `bench/videos/`, `bench/BASELINE.md`.

### Problema

O detector de cena usa uma assinatura muito pequena — grade padrão de 4 × 4 pixels de luminância. Isso é barato, mas pode reagir a mudanças amplas de iluminação. O rastreador confirma aparição com um único frame por padrão. Além disso, testes sintéticos não reproduzem integralmente rótulos instáveis, oclusões, jitter das caixas ou a latência real do detector.

### Passo a passo

- [ ] Manter os testes sintéticos rápidos na CI, mas não usá-los como única validação de qualidade.
- [ ] Montar um conjunto de vídeos curtos anotados com: cena estática, pessoa entrando e saindo, pessoa parada, movimento, cruzamento de duas pessoas, oclusão parcial, objeto momentaneamente não detectado e alteração de iluminação sem mudança semântica.
- [ ] Garantir que cada anotação especifique a duração do clipe, o tipo do evento esperado e seu instante aproximado.
- [ ] Medir e acompanhar precisão, recall, mudanças perdidas, falsos positivos por minuto e atraso de detecção.
- [ ] Alterar um limiar por vez e registrar o resultado no mesmo conjunto de vídeos. Não ajustar parâmetros e trocar de dataset simultaneamente.
- [ ] Comparar aparição confirmada em um quadro com confirmação em observações consecutivas. Escolher o padrão com base no equilíbrio entre falsos positivos e atraso.
- [ ] Testar a assinatura de cena sob variações de iluminação e cenas estáticas. Experimentar grades maiores (por exemplo, 8 × 8) ou normalização de luminância como hipóteses a medir — não presumir que a grade maior é automaticamente melhor.
- [ ] Testar associação com ruído de caixas e ordem das detecções alterada.
- [ ] Atualizar `bench/BASELINE.md` somente com medições reproduzíveis, descrevendo modelo, configuração, máquina e clipes usados.

### Comandos documentados para o conjunto de vídeos

```bash
npm run gravar:webcam -- bench/videos/webcam-mudanca.webm 30
npm run extrair:frames -- bench/videos/webcam-mudanca.webm bench/videos/frames 1,5,10,15,20,25
npx playwright test e2e/webcam.spec.ts --workers=1
npm run qualidade -- --anotacao bench/videos/webcam-mudanca.json --eventos logs/webcam-eventos.jsonl --tolerancia 8000
```

Esses comandos dependem de ter o vídeo gravado, a anotação preparada, o backend/modelo disponível e as variáveis E2E configuradas conforme `bench/videos/README.md`.

### Critério para concluir

- [ ] Existe comparação antes/depois usando os mesmos clipes e métricas; a melhoria não é baseada apenas em impressão visual.

---

## Fase 8 — fallback de WASM quando a inferência WebGPU falhar

**Arquivos:** `public/detector.ts`, testes do detector e E2E.

O detector já tenta WASM quando o carregamento do pipeline WebGPU falha. Porém, se o pipeline WebGPU carrega e uma inferência posterior falha, `executar()` apenas propaga o erro.

### Passo a passo

- [ ] Distinguir falha de carregamento de falha durante inferência.
- [ ] Se WebGPU falhar durante a execução por erro compatível com dispositivo/contexto, descartar ou invalidar a instância em cache e tentar recriá-la em WASM uma única vez.
- [ ] Não aplicar fallback silenciosamente a erros de entrada inválida ou bugs do processamento que também falhariam em WASM.
- [ ] Atualizar o diagnóstico para mostrar o dispositivo efetivo após fallback.
- [ ] Testar: falha WebGPU seguida de sucesso WASM, falha em ambos e erro de entrada que não deve ser mascarado pelo fallback.

### Critério para concluir

- [ ] Uma falha específica do dispositivo GPU pode ser recuperada sem iniciar inferências concorrentes nem esconder a causa original.

---

## Fase 9 — validação final e documentação

**Arquivos:** `README.md`, `docs/arquitetura.md`, `docs/eventos.md`, `docs/api.md`, `docs/qualidade.md`, `bench/BASELINE.md`.

### Passo a passo

- [ ] Executar a suíte completa depois de todas as alterações:

  ```bash
  npm run typecheck
  npm run lint
  npm test
  npm run build
  ```

- [ ] Executar E2E com stubs para fluxos de interface e câmera.
- [ ] Executar o teste com vídeo anotado e o modelo real, registrando o ambiente e o resultado.
- [ ] Verificar start/stop/restart, pedido manual, falha de câmera, falha do detector, Ollama indisponível, falha HTTP de gravação, limpeza de histórico e recuperação após falha.
- [ ] Verificar que não existem IDs duplicados em várias sessões nem snapshots duplicados para a mesma captura.
- [ ] Atualizar documentos para refletir o comportamento real, a semântica do intervalo, os campos de evento, as limitações e os passos de benchmark.
- [ ] Fazer uma última revisão do diff e confirmar que nenhum arquivo de vídeo pessoal, segredo ou snapshot local foi incluído no repositório.

### Critérios finais de aceitação

- [ ] O agendador respeita a cadência documentada e não sobrepõe ciclos.
- [ ] O evento e a interpretação apontam para a evidência temporal correta.
- [ ] O rastreamento tolera falhas transitórias de detecção e mantém IDs estáveis nos cenários testados.
- [ ] Os IDs são únicos entre sessões.
- [ ] A política de análise respeita cooldown e limite de chamadas conforme regra documentada.
- [ ] Falhas HTTP de persistência são detectadas; reenvios são controlados e não duplicam eventos.
- [ ] A medição com vídeos anotados mostra o efeito das alterações nos falsos positivos, recall e atraso.
- [ ] Typecheck, lint, testes e build terminam sem erros no ambiente limpo.

---

## Sequência curta recomendada

Para evitar abrir muitas frentes ao mesmo tempo, implemente nesta ordem:

1. [ ] Fase 0 — linha de base.
2. [ ] Fase 1 — semântica e medição do agendador.
3. [ ] Fase 2 — mesma captura até o Ollama.
4. [ ] Fase 3 — expiração, confirmação e associação temporal.
5. [ ] Fase 4 — IDs por sessão.
6. [ ] Fase 5 — cooldown e limpeza de estado.
7. [ ] Fase 6 — persistência HTTP, fila e deduplicação de snapshots.
8. [ ] Fase 7 — validação com vídeos anotados.
9. [ ] Fase 8 — fallback de inferência WebGPU, se confirmado necessário.
10. [ ] Fase 9 — regressão completa e documentação.

**Não avance para memória vetorial, embeddings ou modelos maiores antes de cumprir os critérios finais.** Uma memória mais sofisticada não compensa eventos temporalmente incorretos nem persistência que parece ter funcionado quando falhou.
