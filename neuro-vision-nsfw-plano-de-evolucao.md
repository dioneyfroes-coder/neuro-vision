# Neuro Vision — Especialização NSFW: análise e plano de evolução

**Repositório analisado:** `neuro-vision-main(1).zip`  
**Snapshot identificado:** `c36d054331b389b6fcacfb4598628822ecc915cd`  
**Data do snapshot:** 21/11/2026  
**Data desta análise:** 22/11/2026

## Objetivo deste documento

Este documento trata exclusivamente da especialização NSFW do **modo Neuro Vision**. Ela não faz parte do modo Câmera de Segurança e não deve ser integrada automaticamente ao pipeline de vigilância.

A especialização surgiu para melhorar a descrição visual de corpos adultos e situações que o modelo multimodal convencional tende a omitir, suavizar ou recusar descrever — inclusive situações não sexuais, como um homem adulto sem camisa. A partir daí, o subsistema foi ampliado para reconhecer anatomia visível e interpretar sequências adultas em imagens e vídeos.

O objetivo técnico é produzir descrições visuais mais completas, anatômicas, específicas e temporalmente coerentes, sem confundir exposição corporal com atividade sexual e sem transformar uma detecção de modelo em verdade incontestável.

> **Escopo:** modo Neuro Vision com especialização NSFW. O modo Câmera de Segurança permanece separado.

---

# 1. Estado atual encontrado

## 1.1 Arquitetura implementada

O checkbox `#nsfw` habilita o subsistema local de classificação NSFW no início da sessão. O conjunto atual contém seis modelos ONNX, cada um executado em seu próprio adaptador/worker:

| Modelo | Papel no conjunto |
|---|---|
| `nudenet_320n` | Detector geral NudeNet, 18 classes, saída YOLO crua |
| `nudenet_640m` | Variante NudeNet de maior resolução, saída com NMS |
| `erax_nsfw_yolo11n` | Detector EraX nano, cinco classes |
| `erax_nsfw_yolo11s` | Detector EraX small, cinco classes |
| `erax_nsfw_yolo11m` | Detector EraX medium, cinco classes |
| `penis_yolov8m` | Detector especializado de uma classe |

Arquivos principais:
- `public/nsfw-onnx/catalogo.ts`
- `public/nsfw-onnx/detector.ts`
- `public/nsfw-onnx/interpretacao.ts`
- `public/perception/adapters/nsfw-classifier/conjunto.ts`
- `public/perception/adapters/nsfw-classifier/mesclagem.ts`
- `public/perception/adapters/nsfw-classifier/adapter-unitario.ts`

## 1.2 O que o checkbox realmente muda

Quando habilitado, o fluxo:
1. Carrega o conjunto de classificadores locais.
2. Executa os modelos sobre os frames processados pelo pipeline de percepção local.
3. Mescla as marcações.
4. Preserva rótulos, scores, caixas e origem/modelos concordantes.
5. Inclui as marcações no contexto enviado ao modelo multimodal.
6. Injeta instruções especializadas no prompt.
7. Força o modelo multimodal configurado em `MODELO_NSFW`.
8. Mantém as marcações no histórico, nos logs e na interface.

O modelo multimodal configurado no código é:

`gemma-4-e2b-uncensored-hauhaucs-aggressive`

A seleção é aplicada tanto no cliente quanto no servidor:
- `src/nsfw-prompt/instrucoes.ts`
- `public/app.ts`
- `src/http/rotas-visao/handle.ts`

O servidor força esse identificador quando recebe a sinalização NSFW. Isso evita que a seleção normal da interface substitua silenciosamente o modelo especializado.

**Limitação importante:** o identificador é fixo no código. O modelo precisa existir e estar disponível no backend local; o nome configurado não comprova, sozinho, quais pesos ou quantização o backend carregou.

## 1.3 O que já existe na interpretação multimodal

Os prompts atuais já orientam o modelo a:
- Descrever conteúdo adulto visível em português e com termos anatômicos diretos.
- Usar as marcações locais como evidência, não como veredito.
- Não interpretar ausência de marcação como ausência de conteúdo.
- Relacionar marcações a índices e IDs dos frames.
- Descrever continuidade e mudanças em sequências.
- Separar observação de inferência.
- Não deduzir identidade de gênero pela aparência.
- Separar corpo/anatomia visível de ação inferida.

Há instruções específicas para ação multiframe em `INSTRUCAO_ACAO_MULTIFRAME`. Elas só são adicionadas quando há pelo menos duas imagens e o subsistema NSFW participou do ciclo.

Arquivos:
- `src/nsfw-prompt/instrucoes.ts`
- `src/nsfw-prompt/contexto.ts`
- `src/nsfw-prompt/marcacoes.ts`
- `public/interpretation/prompt.ts`
- `public/interpretation/normalizar.ts`

## 1.4 Relatórios existentes

O repositório contém relatórios específicos do subsistema, incluindo:
- `bench/RELATORIO_NSFW_MODELOS_20261109.md`
- `bench/RELATORIO_NSFW_EVENTOS_20261109.md`
- `bench/RELATORIO_NSFW_CONJUNTO_20261111.md`
- `bench/RELATORIO_TESTE_NSFW_20261112.md`

Eles registram execução dos seis modelos, amostras de imagens e vídeos, memória WASM, latência individual, integração E2E e testes direcionados.

**Limite da evidência atual:** os relatórios dizem que não há ground truth humano anotado para os exemplos usados. Concordância entre modelos, caixas visualmente plausíveis e testes automatizados não equivalem a precisão/recall medidos contra anotações humanas.

---

# 2. Separar três capacidades que hoje estão misturadas

A melhoria conceitual mais importante é não tratar toda exposição corporal como conteúdo sexual.

Atualmente, o mesmo checkbox ativa:
- Classificação de anatomia/conteúdo NSFW.
- Troca do modelo multimodal.
- Instruções de descrição explícita.
- Regras geométricas de pose sexual no motor temporal.

Isso é funcional, mas reúne intenções diferentes. Recomenda-se manter o checkbox principal e evoluir gradualmente para perfis internos ou opções subordinadas.

## 2.1 Perfil A — descrição corporal neutra

Finalidade: descrever corpos e roupas com precisão, sem sexualizar a cena.

Exemplos de observações:
- Pessoa adulta sem camisa.
- Homem com tórax e abdômen expostos.
- Pessoa usando roupa de banho.
- Tronco parcialmente coberto.
- Ombros, braços, tórax, abdômen e pernas visíveis.
- Peça de roupa aberta, ausente ou deslocada, quando isso for realmente observável.

Requisitos:
- Preferir linguagem anatômica neutra.
- Não inferir intenção sexual.
- Não classificar uma pessoa como sexualmente excitada por causa da roupa ou pose.
- Não resumir automaticamente um torso exposto como pornografia ou atividade sexual.
- Descrever roupa, postura e regiões corporais efetivamente visíveis.

## 2.2 Perfil B — descrição adulta explícita

Finalidade: quando o conteúdo for efetivamente adulto/sexual, descrever a anatomia e o conteúdo visível sem omissão artificial.

Requisitos:
- Preservar a distinção entre anatomia, nudez, pose e ato sexual.
- Informar quando a região está coberta, parcialmente visível ou exposta.
- Não afirmar anatomia que não esteja visível.
- Não converter uma classificação incerta em afirmação anatômica.
- Não confundir acessórios, roupas ou objetos com anatomia.

## 2.3 Perfil C — análise temporal adulta

Finalidade: interpretar uma sequência de vídeo, sem deduzir atos a partir de uma única fotografia.

Requisitos:
- Usar timestamps reais e ordem cronológica.
- Distinguir pose estática de movimento.
- Distinguir contato aparente de interação confirmada.
- Separar ação observada de ação inferida.
- Informar frames que sustentam cada afirmação.
- Registrar incerteza quando houver oclusão, baixa resolução ou frames insuficientes.

**Direção recomendada:** não implementar três telas ou três sistemas agora. Primeiro separar os prompts e as políticas internas em funções pequenas e testáveis. Depois decidir se a interface precisa de um seletor de perfil.

---

# 3. Primeira melhoria funcional: corpo exposto não significa conteúdo sexual

Este ponto está diretamente ligado à motivação original da especialização.

## 3.1 Classes já disponíveis

O catálogo NudeNet declara classes como:
- `MALE_BREAST_EXPOSED`
- `FEMALE_BREAST_EXPOSED`
- `MALE_GENITALIA_EXPOSED`
- `FEMALE_GENITALIA_EXPOSED`
- `FEMALE_GENITALIA_COVERED`
- `BUTTOCKS_EXPOSED`
- `BELLY_EXPOSED`
- `BELLY_COVERED`

No código atual:
- `MALE_BREAST_EXPOSED` tem limiar de 0,50.
- `FEMALE_BREAST_EXPOSED` tem limiar de 0,50.
- `BELLY_EXPOSED` e `BELLY_COVERED` estão em `CLASSES_NSFW_IGNORADAS`.
- `MALE_BREAST_EXPOSED` não está nessa lista de classes ignoradas.

Portanto, já existe uma base para reconhecer o tórax masculino exposto, mas não encontrei no conjunto de avaliação atual um benchmark específico e anotado para homens adultos sem camisa.

## 3.2 Criar uma avaliação específica

Montar uma pequena coleção local e privada de imagens de adultos, com diversidade de:
- Homem sem camisa em situação cotidiana.
- Homem sem camisa em academia/praia.
- Homem usando regata.
- Homem com camisa aberta.
- Homem com torso parcialmente coberto.
- Pessoas adultas usando roupa de banho.
- Pessoas adultas totalmente vestidas.
- Diferentes iluminação, distância, orientação e resolução.

Anotar:
- `torso_exposto`
- `peitoral_exposto`
- `abdomen_exposto`
- `roupa_sem_manga`
- `roupa_aberta`
- `nudez_parcial`
- `anatomia_intima_visivel`
- `conteudo_sexual_explicito`

Esses rótulos são exemplos de uma taxonomia interna. Não precisam corresponder diretamente às classes brutas dos modelos.

## 3.3 Não usar o detector NSFW como única fonte de descrição corporal

O VLM já consegue descrever roupas e regiões corporais, mas precisa receber uma instrução explícita para não omitir detalhes neutros.

Criar um bloco de prompt corporal neutro, independente de `INSTRUCAO_NSFW`, e avaliar:
- Descrição sem detector especializado.
- Descrição com marcações NudeNet.
- Descrição com conjunto completo.
- Descrição com prompt corporal neutro.
- Descrição com prompt adulto explícito.

O objetivo é descobrir se a melhoria vem dos detectores, do prompt, do Gemma ou da combinação. Não assumir que carregar seis modelos é necessário para descrever corretamente uma pessoa sem camisa.

---

# 4. Correção de prioridade máxima: modelos que falharam no carregamento

Arquivo: `public/perception/adapters/nsfw-classifier/conjunto.ts`.

## Problema observado

Em `carregar()`, o conjunto registra os modelos que carregaram com sucesso em `metricasValor.modelos`.

Entretanto, `avaliar()` usa:

```ts
const ids = [...this.adaptadores.keys()];
```

Isso inclui todos os adaptadores criados, inclusive aqueles cujo carregamento falhou.

Consequência:
- Um modelo pode falhar ao carregar.
- O conjunto continua corretamente com os demais.
- Porém, o modelo indisponível ainda pode ser chamado em todas as inferências seguintes.
- Isso cria falhas repetidas, trabalho inútil e ruído na telemetria.

## Correção solicitada

- Guardar explicitamente os IDs dos modelos carregados com sucesso.
- Em `avaliar()`, executar apenas esses IDs.
- Preservar telemetria dos modelos que falharam no carregamento.
- Permitir uma ação explícita de retry, em vez de repetir automaticamente a falha em todo frame.
- Ao encerrar, limpar a lista de carregados.
- Ao tentar carregar novamente, atualizar a lista e os estados sem duplicar workers.

## Testes obrigatórios

- [x] Um modelo falha no carregamento e os demais continuam.
- [x] A avaliação seguinte não chama o modelo que falhou ao carregar.
- [x] O modelo com falha aparece na telemetria como indisponível.
- [x] Uma falha de inferência não derruba os demais.
- [x] Se todos falharem, o subsistema informa indisponibilidade.
- [x] Um retry explícito pode recuperar o modelo.
- [x] Encerramento libera todos os workers, inclusive os que falharam parcialmente.

Os testes atuais cobrem falha de carregamento e falha de avaliação isoladamente, mas devem incluir a sequência completa: carregar parcialmente, avaliar, verificar quais adaptadores foram chamados.

---

# 5. Melhorar a fusão dos seis modelos

Arquivos:
- `public/perception/adapters/nsfw-classifier/mesclagem.ts`
- `public/perception/adapters/nsfw-classifier/conjunto.ts`
- `public/nsfw-onnx/catalogo.ts`

## 5.1 Limitação atual da fusão

A regra atual mescla somente marcações com:
- Rótulo exatamente igual.
- IoU igual ou superior a 0,6.

Rótulos diferentes permanecem separados, mesmo quando as caixas apontam para praticamente a mesma região.

Isso é útil para preservar desacordos, mas o benchmark já registrou conflitos de rótulo na mesma região entre EraX e NudeNet.

## 5.2 Criar agrupamento espacial com alternativas semânticas

Evoluir a saída para permitir um grupo espacial com:
- Uma região consolidada.
- Rótulos sugeridos por cada modelo.
- Score individual por modelo.
- Caixas originais.
- Modelo de origem.
- Estado de concordância ou conflito.

Exemplo conceitual:

```json
{
  "regiaoId": "r-12",
  "caixaConsolidada": {},
  "hipoteses": [
    {
      "rotulo": "classe_a",
      "modelo": "modelo_1",
      "score": 0.61
    },
    {
      "rotulo": "classe_b",
      "modelo": "modelo_2",
      "score": 0.54
    }
  ],
  "status": "conflito_semantico"
}
```

Não é necessário descartar rótulos conflitantes. O importante é não apresentar duas marcações como se fossem necessariamente duas regiões ou dois objetos diferentes.

## 5.3 Não tratar scores brutos como probabilidades comparáveis

Os modelos foram treinados com conjuntos, classes e objetivos diferentes. Um score 0,70 em um modelo não é automaticamente equivalente a 0,70 em outro.

Implementar:
- Limiares por modelo e classe, não apenas por classe global.
- Calibração com conjunto de validação anotado.
- Relatório de precisão e recall em vários thresholds.
- Registro do threshold usado em cada inferência.
- Separação entre score original, score calibrado e confiança agregada.

A concordância de dois modelos deve ser registrada como evidência adicional, não convertida automaticamente em uma probabilidade maior de acerto.

## 5.4 Comparar métodos de sobreposição

O IoU de 0,6 pode deixar de agrupar duas caixas que cobrem a mesma região quando uma é muito maior que a outra.

Comparar em benchmark:
- IoU tradicional.
- Interseção sobre a menor caixa (IoS).
- Contenção de uma caixa pela outra.
- Distância entre centros normalizada.
- Associação baseada em região e rótulo.

Escolher a regra com base em exemplos anotados, evitando ajustes apenas para um clipe.

---

# 6. Rever o custo e a seleção dos modelos

O conjunto atual carrega todos os seis detectores em workers independentes.

O relatório `RELATORIO_NSFW_CONJUNTO_20261111.md` registra cerca de **1,02 GB de memória linear WASM** para o conjunto, antes de considerar overhead de workers, runtime e navegador.

As medições individuais mostram diferenças relevantes de custo:
- `nudenet_320n` é o modelo mais leve.
- `nudenet_640m` é significativamente mais pesado.
- EraX nano é mais leve que small e medium.
- `penis_yolov8m` é um dos modelos mais caros.
- A medição concorrente real dos seis workers não foi concluída diretamente no harness; parte da estimativa agregada é derivada de execuções individuais.

## 6.1 Criar perfis de execução

Proposta inicial, sujeita a benchmark:

| Perfil | Modelos | Quando usar |
|---|---|---|
| Leve | NudeNet 320n | Análise rápida e descrição corporal inicial |
| Equilibrado | NudeNet 320n + EraX 11n | Maior cobertura com custo intermediário |
| Completo | Os seis modelos | Análise pontual de maior cobertura |
| Diagnóstico | Modelo selecionado individualmente | Comparar saídas e investigar divergências |

O detector dedicado deve continuar opcional e não precisa executar em todos os frames.

Não afirmar que o perfil leve ou equilibrado é mais preciso antes de validar as métricas. O objetivo dos perfis é oferecer diferentes compromissos entre custo, latência e cobertura.

## 6.2 Medir o conjunto em execução real

Executar o aplicativo completo na máquina de referência e registrar:
- Tempo de carga total.
- Tempo de inferência total.
- Latência por modelo.
- Latência P50/P95.
- CPU total.
- RAM total.
- Memória WASM por worker, quando mensurável.
- Frames por minuto.
- Quantidade de marcações por classe.
- Quantidade de falhas.
- Concorrência efetiva dos workers.

Comparar:
1. Cada modelo isolado.
2. Dois modelos simultâneos.
3. Três modelos simultâneos.
4. Conjunto completo.
5. Perfis leves/equilibrados/completos.

Verificar contenção de CPU, pool de threads WASM e escalonamento. Se a concorrência total piorar a latência, limitar o paralelismo ou escalonar modelos em pequenos grupos.

---

# 7. Validar o pré-processamento das imagens

Arquivo: `public/yolo-onnx/imagem.ts`.

O caminho atual redimensiona o frame por **stretch** para um quadrado, sem preservar a proporção original. O comentário e os scripts de verificação descrevem esse mesmo comportamento.

Isso merece uma validação de equivalência com o pré-processamento usado para produzir os pesos.

Uma imagem vertical de 720×1280, por exemplo, sofre uma transformação geométrica considerável ao ser comprimida diretamente para 640×640.

## Trabalho solicitado

- [ ] Conferir o pré-processamento usado no treinamento/origem de cada modelo.
- [ ] Comparar a saída ONNX no navegador com a saída de referência do modelo Python.
- [ ] Testar imagens 16:9, 9:16, 4:3, quadradas e panorâmicas.
- [ ] Verificar caixas em regiões próximas às bordas.
- [ ] Avaliar objetos pequenos e enquadramentos fechados.
- [ ] Comparar stretch e letterbox em um dataset anotado.
- [ ] Ajustar a transformação inversa das caixas se a estratégia mudar.

Não trocar para letterbox sem comparar com a origem dos pesos. A regra correta é reproduzir o pré-processamento esperado pelo modelo, não escolher uma técnica por preferência.

---

# 8. Separar detecção anatômica de classificação de ação

O conjunto contém duas naturezas diferentes de saída:

1. Classes anatômicas/localizadas, como partes do corpo.
2. Uma classe de ação, como `make_love`, que nos relatórios aparece com caixas muito amplas, chegando a cobrir praticamente o quadro inteiro.

Uma marcação de ação com caixa de quadro inteiro não deve ser interpretada como localização anatômica.

## Melhorias

Criar metadados por classe:
- `tipo`: `anatomia`, `regiao_corporal`, `estado_visual` ou `acao`.
- `escopo`: `local` ou `cena`.
- `origem`: modelo e versão.
- `evidencia`: frame e timestamp.
- `usoPermitido`: sinal auxiliar, localização, classificação ou proposta temporal.

Tratar `make_love` como **proposta de ação em nível de cena**, nunca como confirmação do ato.

A confirmação temporal deve depender da sequência, de evidências visuais suficientes e da saída estruturada do VLM. O modelo de detecção sozinho não confirma uma ação.

---

# 9. Melhorar a análise de vídeo e ações

O projeto já tem uma base correta:
- Várias imagens por ciclo.
- Frames identificados.
- Instrução específica de ação multiframe.
- Campos `tipo`, `natureza`, `confianca` e `evidencias`.
- Validação de referências de frames/eventos.

A próxima etapa deve aumentar a qualidade das evidências temporais.

## 9.1 Incluir informação temporal nas marcações

Além do índice e `frameId`, preservar:
- Timestamp real de captura.
- Offset em relação ao início do clipe.
- Intervalo entre frames.
- Ordem cronológica validada.

Não estimar duração de uma ação usando apenas o número de imagens. Usar o tempo real entre os frames.

## 9.2 Amostragem adaptativa de vídeo

Não é necessário analisar todos os frames com os seis YOLO.

Proposta:
1. Fazer uma análise leve para selecionar frames.
2. Identificar mudanças visuais relevantes.
3. Aumentar a densidade de amostragem ao detectar mudança ou possível ação.
4. Executar os detectores complementares nos frames selecionados.
5. Enviar um conjunto compacto ao Gemma.
6. Registrar o intervalo real da conclusão e as imagens que sustentam a ação.

Para vídeos com movimento rápido, quatro snapshots muito espaçados podem não representar a ação. O sistema deve declarar quando a amostragem é insuficiente.

## 9.3 Taxonomia de ações

A instrução atual já limita as categorias principais. Evoluir sem aumentar categorias indiscriminadamente.

Para cada ação:
- Tipo.
- Observada ou inferida.
- Início e fim.
- Confiança.
- Frames de evidência.
- Descrição do movimento visível.
- Incerteza.
- Motivo de encerramento.

Criar casos negativos:
- Pessoas próximas sem interação sexual.
- Mão próxima ao corpo sem ação confirmada.
- Pose estática.
- Movimento de roupa ou câmera.
- Oclusão.
- Corte de cena.
- Movimento fora do campo de visão.

A intenção é reduzir inferências indevidas.

---

# 10. Melhorar os prompts do Gemma

O prompt atual é uma boa base, mas está muito concentrado em instruir a descrição adulta explícita. A especialização também precisa tratar corretamente situações neutras.

## 10.1 Prompt de descrição corporal neutra

Criar um bloco separado que instrua:
- Descrever pessoas adultas com linguagem anatômica neutra.
- Informar regiões do corpo visíveis e roupas.
- Distinguir torso sem camisa, roupa aberta e nudez.
- Não sexualizar automaticamente uma pessoa sem camisa ou em roupa de banho.
- Não inferir atividade sexual a partir de aparência, postura ou roupa.
- Descrever apenas o que o frame realmente mostra.

## 10.2 Prompt NSFW adulto

Manter as instruções específicas, mas organizar em blocos menores:
- Conteúdo anatômico.
- Localização das marcações.
- Divergência entre detectores.
- Continuidade temporal.
- Ações.
- Incertezas.

Evitar duplicar a mesma instrução no prompt principal e nos blocos adicionais. Isso economiza tokens e reduz contradições.

## 10.3 Tratar divergências de modelos explicitamente

Quando dois detectores discordarem sobre o rótulo da mesma região, o Gemma deve receber algo como:
- Região identificada por múltiplos modelos.
- Hipóteses de rótulo conflitantes.
- Scores individuais.
- Caixas originais.
- Instrução para analisar visualmente a região e declarar incerteza se não houver evidência suficiente.

Não pedir que o VLM escolha obrigatoriamente um rótulo.

## 10.4 Não usar identidade ou idade presumida como fato visual

A instrução atual diz para assumir pessoas adultas, exceto quando a imagem indicar claramente menoridade.

Recomenda-se uma regra mais conservadora:
- Não tentar determinar idade exata pela aparência.
- Não usar aparência madura como comprovação de maioridade.
- Usar procedência/contexto adulto declarado apenas como metadado, sem tratá-lo como prova visual.
- Se houver indício de menoridade ou dúvida relevante sobre a idade, não gerar descrição sexual dessa pessoa; limitar a resposta a uma descrição não sexual e registrar a incerteza.
- Não inferir identidade de gênero, orientação sexual ou condição pessoal pela anatomia ou aparência.

Para uma aplicação pessoal, manter o processamento local e trabalhar somente com mídia adulta de origem confiável reduz riscos, mas não elimina a necessidade de tratamento conservador quando houver dúvida.

## 10.5 Orçamento de tokens

A documentação atual registra limite de geração de 768 tokens e casos de resposta encerrada com `finish_reason: "length"`.

A especialização pode gerar prompts maiores e respostas mais detalhadas, principalmente em multiframe.

Implementar:
- Orçamento de tokens específico por perfil.
- Limite de frames por chamada.
- Prompt mais compacto e sem redundância.
- Resposta JSON com campos mínimos obrigatórios.
- Detecção de resposta truncada.
- Erro legível na UI e opção de repetir com menos frames ou teto maior.

Não aumentar o teto indiscriminadamente: medir tempo e RAM no LM Studio.

---

# 11. Melhorias na troca e preparação do Gemma

Arquivo principal: `src/nsfw-prompt/instrucoes.ts`.

Atualmente o identificador do Gemma é constante e o servidor o força quando o NSFW está ativo.

Isso garante consistência, mas dificulta experimentar variantes.

## Direção recomendada

- Centralizar a configuração do modelo NSFW em um único local tipado.
- Permitir escolher o identificador por configuração local/env, sem duplicar strings no cliente e servidor.
- Exibir o modelo solicitado e o modelo efetivamente respondendo.
- Verificar disponibilidade antes da primeira análise.
- Fazer warm-up controlado antes de iniciar uma sessão longa.
- Registrar erro claro se o Gemma não estiver instalado/disponível.
- Não trocar silenciosamente para o modelo SFW quando o modo NSFW exige o Gemma.
- Manter fallback apenas quando o usuário escolher explicitamente essa política.
- Registrar versão, quantização, contexto máximo e template de conversa do modelo usado.

A preparação do Gemma deve ser independente da carga dos seis YOLO: permitir diagnosticar separadamente problema de modelo multimodal e problema de percepção local.

---

# 12. Segurança e privacidade do repositório

O `.gitignore` atual já exclui:
- `modelos/`
- `logs/`
- `bench/videos/`
- `bench/imagens/`
- arquivos `.env`

Isso é positivo e deve ser preservado.

Ainda assim, `.gitignore` não remove arquivos que já tenham entrado no histórico Git.

## Regras de manutenção

- [ ] Manter o repositório privado.
- [ ] Não publicar pesos, imagens, vídeos ou saídas explícitas de uso pessoal.
- [ ] Não inserir imagens pessoais em fixtures versionadas.
- [ ] Manter conjuntos de avaliação locais e ignorados pelo Git.
- [ ] Verificar o histórico Git antes de compartilhar o repositório.
- [ ] Fazer varredura de segredos e arquivos sensíveis.
- [ ] Evitar expor o servidor local à rede sem autenticação.
- [ ] Não criar upload automático de mídia para serviços externos.
- [ ] Registrar origem e licença dos pesos de terceiros.
- [ ] Não presumir que tornar o repositório privado substitui cuidados com dados e acesso.

## Proveniência dos modelos

Para cada modelo local, registrar em um sidecar ou manifesto:
- Nome e identificador.
- URL/repositório de origem.
- Autor/publicador.
- Licença e condições de uso conhecidas.
- SHA-256 do arquivo de pesos.
- Formato e versão do modelo.
- Classes e ordem dos rótulos.
- Resolução de entrada.
- Pré-processamento esperado.
- Versão do exportador.
- Data de download/exportação.

Para o Gemma, registrar também o identificador completo apresentado pelo backend, quantização e configuração relevante. O nome retornado pelo servidor deve ser a fonte da telemetria da execução.

---

# 13. Benchmark real: deixar de medir somente se o modelo roda

Os relatórios atuais são úteis para comparar modelos, mas precisam evoluir para avaliar acurácia.

## 13.1 Dataset de avaliação

Criar um conjunto local de mídia adulta, com origem e licença/uso autorizados, contendo:
- Imagens de corpo adulto sem camisa.
- Roupa de banho e roupas comuns.
- Nudez parcial e total.
- Diferentes tipos de enquadramento.
- Diferentes iluminações.
- Oclusões e regiões fora do quadro.
- Variação de resolução e orientação.
- Conteúdo adulto explícito.
- Vídeos com ações claramente observáveis.
- Vídeos negativos ou ambíguos.

Separar treino/tuning/validação/teste por **fonte de imagem ou vídeo**, não por frames adjacentes. Frames do mesmo clipe não devem vazar para os dois lados da avaliação.

Não incluir mídia de idade desconhecida ou material cuja procedência não possa ser verificada.

## 13.2 Anotação humana

Para cada imagem:
- Rótulos de anatomia/região.
- Caixa delimitadora.
- Grau de visibilidade.
- Estado de roupa/exposição.
- Classe de conteúdo.
- Ambiguidade, se houver.

Para cada vídeo:
- Ação.
- Início/fim.
- Participantes.
- Regiões envolvidas.
- Evidências.
- Incerteza.

## 13.3 Métricas dos detectores

Medir por classe e por modelo:
- Precision.
- Recall.
- F1.
- mAP quando aplicável.
- Falsos positivos por imagem.
- Falsos negativos.
- Matriz de confusão.
- Curva precision/recall por threshold.
- Calibração do score.
- Latência P50/P95.

Medir separadamente:
- Perfil leve.
- Perfil equilibrado.
- Conjunto completo.
- Cada modelo isolado.

## 13.4 Métricas do Gemma

Avaliar:
- Omissão de detalhes visíveis.
- Alucinação de anatomia.
- Alucinação de ação.
- Correção da descrição de roupa/exposição.
- Correção da cronologia.
- Uso de linguagem neutra quando a situação é neutra.
- Cobertura das evidências.
- Resposta truncada.
- Consistência entre repetições.

Fazer avaliação humana cega de respostas, sem mostrar qual modelo produziu cada uma.

**Critério de aceite:** toda melhoria de qualidade deve vir acompanhada de uma comparação controlada, não apenas de uma resposta que parece melhor em um único exemplo.

---

# 14. Interface e experiência de uso

O checkbox atual é simples e útil. Evoluir sem transformar a tela em um painel de configuração excessivo.

Melhorias recomendadas:
- Mostrar que NSFW é uma especialização do modo Neuro Vision e não do monitoramento de segurança.
- Mostrar que o toggle só vale para a próxima sessão.
- Mostrar quais modelos carregaram e quais falharam.
- Mostrar Gemma solicitado e efetivamente utilizado.
- Mostrar perfil de execução: leve, equilibrado ou completo.
- Mostrar latência total e por detector.
- Mostrar caixas e rótulos originais por modelo.
- Permitir visualizar conflitos entre modelos.
- Permitir comparar a descrição SFW e a descrição especializada do mesmo frame.
- Permitir marcar uma detecção como falso positivo ou falso negativo.
- Registrar feedback local para montar o dataset de avaliação.

O feedback precisa guardar a imagem/frame de referência de maneira local e controlada, com opção de excluir o registro.

---

# 15. Testes e regressões a adicionar

## Conjunto de modelos
- [x] Falha parcial de carga seguida de inferência.
- [x] Modelo indisponível não é chamado a cada frame.
- [x] Retry explícito após falha (programático; sem botão na interface).
- [x] Todos indisponíveis.
- [x] Falha individual durante inferência.
- [x] Encerramento e liberação dos workers, inclusive os parciais (teste com 3 adaptadores; a lógica é por adaptador).
- [ ] Concorrência limitada.
- [x] Telemetria correta após retry.

## Pré-processamento e saída
- [x] Retrato, paisagem, quadrado e panorâmico (geometria do stretch e da inversão, não inferência com pesos).
- [ ] Comparação Python x ONNX.
- [x] Caixa nas bordas.
- [x] Caixa muito pequena.
- [x] Saída crua NudeNet (incluindo `22` em qualquer uma das duas últimas dimensões).
- [x] Saída com NMS.
- [ ] Sidecar ausente ou malformado.
- [ ] Rótulo desconhecido.
- [ ] Threshold específico por modelo/classe.

## Fusão
- [ ] Mesmo rótulo e mesma região.
- [ ] Mesmo rótulo e caixas de tamanhos diferentes.
- [ ] Rótulos conflitantes na mesma região.
- [ ] Duas regiões distintas.
- [ ] Modelos correlacionados não contam como evidência independente sem ressalva.
- [ ] Ação de cena não é confundida com anatomia localizada.

## Prompt e Gemma
- [ ] Checkbox desligado não injeta prompt nem troca modelo.
- [ ] Checkbox ligado força o identificador configurado.
- [ ] Gemma indisponível retorna erro claro.
- [ ] Prompt corporal neutro não sexualiza homem sem camisa.
- [ ] Prompt adulto não omite anatomia visível.
- [ ] Uma imagem não dispara inferência de ação multiframe.
- [ ] Multiframe usa IDs e timestamps reais.
- [ ] Resposta com evidência inexistente é rejeitada.
- [ ] Resposta truncada é identificada.
- [ ] Incerteza de idade impede descrição sexual da pessoa ambígua.

## Integração
- [ ] Modos de frame único.
- [ ] Modos multiframe com percepção local.
- [ ] Variante sem percepção local informa claramente que o detector NSFW não foi executado.
- [ ] Troca SFW/NSFW entre sessões.
- [ ] Reinício com pesos ausentes.
- [ ] Backend LM Studio reiniciado durante a preparação.

---

# 16. Plano de implementação recomendado

## Fase 1 — correções pequenas e confiabilidade

- [x] Corrigir a lista de modelos efetivamente carregados usada em `avaliar()`.
- [x] Adicionar teste de falha parcial seguida de inferência.
- [x] Exibir claramente falhas individuais.
- [x] Revisar o descarte/liberação de workers.
- [ ] Verificar pré-processamento dos modelos contra sua referência Python — parcial: o que o cliente faz foi verificado de forma determinística e documentado em `docs/nsfw.md`, mas não existe referência Python/golden output versionada para comparar; segue INCONCLUSIVO.
- [x] Atualizar documentação para separar o NSFW do modo de segurança (`docs/nsfw.md`).

**Resultado esperado:** conjunto mais confiável, com menos inferências inúteis e telemetria correta.
**Estado da Fase 1:** código, testes e documentação entregues; o item de equivalência com Python permanece em aberto por falta de referência anotada — ver `docs/nsfw.md`.

## Fase 2 — resolver a motivação original

- [ ] Criar dataset adulto de corpos sem camisa e roupas de banho — bloqueado: mídia adulta fica local, gitignored e sem ground truth; nenhum dataset anotado foi criado.
- [ ] Avaliar `MALE_BREAST_EXPOSED` — parcial: limite efetivo 0,50 e filtro determinístico em 0,49/0,50 verificados em `tests/filtros-corpo-nsfw.test.ts`; desempenho com imagens reais é N/A sem dataset anotado.
- [ ] Avaliar efeito dos filtros atuais sobre `BELLY_EXPOSED` e outras classes — parcial: `BELLY_EXPOSED`/`BELLY_COVERED` removidos por `CLASSES_NSFW_IGNORADAS` mesmo com score máximo, verificado deterministicamente; impacto em saída real é N/A sem dataset anotado.
- [x] Criar prompt de descrição corporal neutra — módulo puro, opt-in e independente de `INSTRUCAO_NSFW` em `src/nsfw-prompt/perfil-corporal.ts`.
- [x] Comparar SFW, prompt neutro e NSFW com o mesmo conjunto — comparação determinística de blocos em `src/domain/avaliacao-perfis-corpo.ts`; não é medição de modelo.
- [ ] Medir omissões e sexualização indevida — harness determinístico pronto (`compararPerfisCorpo`, exige anotação revisada); sem anotação humana/revisão, o relatório volta `sem_dados` e nenhuma taxa é divulgada.

**Resultado esperado:** descrever melhor corpos adultos em situações cotidianas, sem depender de uma interpretação sexual.

## Fase 3 — fusão e eficiência

- [x] Criar agrupamento espacial com hipóteses conflitantes — módulo puro em
  `src/domain/agrupamento-espacial-nsfw.ts`, integrado como `ResultadoNsfw.grupos`
  sem alterar `marcacoes`; cada grupo preserva caixas/hipóteses por modelo e
  marca `conflito_semantico` sem eleger rótulo correto. Métricas IoU/IoS/contenção/
  centros e limiares são opções de comparação, não escolha validada por precisão.
- [ ] Calibrar thresholds por modelo/classe — parcial: resolvedor com precedência
  (`resolverLimiarNsfw`, `criarResolutorLimiarNsfw`) usado na interpretação e no
  detector; `LIMIARES_NSFW_POR_MODELO` começa vazio de propósito. Números por
  modelo dependem de dataset anotado e revisão humana, portanto são N/A.
- [x] Criar perfis leve, equilibrado e completo — `public/nsfw-onnx/perfis.ts`,
  opt-in via `?perfilModelosNsfw=`; ausência/inválido mantém `completo` (os seis
  modelos atuais). São compromissos de custo/cobertura, não afirmação de precisão.
- [ ] Medir concorrência real dos workers — harness `npm run verificar:concorrencia:nsfw`
  pronto; sem `--amostras` devolve `sem_dados` e nunca zero. A sobreposição
  efetiva de workers reais é INCONCLUSIVO sem execução instrumentada.
- [ ] Limitar paralelismo conforme benchmark — parcial: fila configurável
  `limiteConcorrencia` aplicada em `carregar()` e `avaliar()` do conjunto, sem
  quebrar retry, falha isolada ou telemetria; padrão sem limite preserva o
  paralelismo atual. O valor ótimo depende do benchmark real e não foi escolhido.
- [ ] Medir latência e memória no PC alvo — o harness resume janelas já
  instrumentadas (`AmostraConcorrenciaNsfw`) e reporta memória como N/A; P50/P95
  e RAM do PC alvo são INCONCLUSIVO sem medição na máquina de referência.

**Resultado esperado:** equilíbrio mensurável entre cobertura, qualidade e consumo.
A infraestrutura para medir está entregue; o equilíbrio em si segue sem medição.

## Fase 4 — análise multiframe

- [x] Incluir timestamps nas marcações do prompt — carimbo real do frame
  propagado para cada marcação; ausência vira `tempo_desconhecido`, nunca
  `Date.now()` (`src/domain/nsfw-marcacao-temporal.ts`, `prompt-interpretacao-3`).
- [x] Criar seleção adaptativa de frames — sinal NSFW fraco (0–5) somado à
  seleção existente, com motivos rastreáveis; detector sozinho não vira evento
  validado (`nsfw-evidencia-temporal.ts`, `selecao-frames.ts`).
- [x] Separar classes anatômicas de classes de ação — metadados estruturais
  determinísticos por rótulo do catálogo (`nsfw-classificacao-rotulo.ts`).
- [x] Tratar `make_love` como proposta de cena, não confirmação — `tipo: "acao"`,
  `escopo: "cena"`, `usoPermitido: "proposta_temporal"` e instrução explícita no
  bloco NSFW.
- [ ] Ampliar avaliação de ações com vídeos anotados — infraestrutura entregue
  (`avaliacao-nsfw-anotada.ts`, harness `avaliar:acoes:nsfw`): sem anotação v2
  revisada, `conjunto: "eval"` e resolução melhor que 1 fps o resultado é `N/A`.
  Não existe clipe adulto anotado; precisão/recall reais permanecem N/A.
- [x] Validar cronologia, evidências e incerteza — `inicioEm <= fimEm`, janela
  do ciclo, `frameId` de evidência e avisos de resolução/incerteza
  (`validacao-cronologia.ts`, opcional em `validarRespostaMultimodal`).

**Resultado esperado:** interpretação de ações baseada em sequência, sem deduções
frágeis de frames isolados. A infraestrutura determinística está entregue; a
medição com vídeos adultos anotados segue INCONCLUSIVO por falta de dataset
revisado. O ganho da seleção adaptativa não foi medido — nenhuma precisão,
recall ou latência é afirmada.

## Fase 5 — Gemma, prompt e interface

- [x] Centralizar configuração do Gemma (`src/nsfw-prompt/configuracao-gemma.ts`; padrão inalterado).
- [x] Adicionar verificação de disponibilidade e warm-up (`src/domain/disponibilidade-gemma.ts`,
  `?nsfw=1` em `/api/visao/preparar`, sem fallback silencioso para SFW).
- [x] Mostrar modelo solicitado/efetivo (`InfoVisao` e diagnóstico da interface).
- [x] Reduzir redundância do prompt (dedup de linhas exatas; contrato `prompt-interpretacao-4`).
- [x] Ajustar orçamento de tokens por perfil (`?orcamentoTokens=leve|equilibrado|completo`;
  equilibrado reproduz os limites históricos).
- [x] Adicionar comparação de descrições e feedback local (somente metadados/texto; sem mídia versionada).

**Resultado esperado:** comportamento previsível e fácil de diagnosticar. A infraestrutura é
determinística: disponibilidade real, latência, RAM e superioridade de perfil dependem de
LM Studio e de anotação revisada, então seguem `N/A`/`INCONCLUSIVO` até medição controlada.

## Fase 6 — validação e manutenção

Infraestrutura determinística entregue nesta fase:

- [x] Validar manifesto de dataset com separação treino/tuning/teste, hash
  único e anotação revisada no teste (`src/domain/dataset-nsfw.ts`).
- [x] Calcular métricas por classe/modelo com `N/A` sem anotação revisada
  (`src/domain/metricas-nsfw-por-classe.ts`).
- [x] Preparar avaliação cega A/B com ordem estável e consenso exigindo dois
  revisores (`src/domain/avaliacao-descricoes-humanas.ts`).
- [x] Validar proveniência declarada (origem, licença, revisão, SHA-256) e
  sinalizar `resolve/main` (`src/domain/proveniencia-pesos.ts`).
- [x] Auditar nomes de arquivos versionados e documentar o achado das duas
  fixtures PNG sintéticas (`src/domain/auditoria-privacidade.ts`).
- [x] Documentar protocolo, harness e pendências (`docs/nsfw.md`,
  `docs/pendencias.md`); `npm run verificar:fase6:nsfw` reporta `INCONCLUSIVO`.

Ainda depende de dados/backend reais — nenhum item abaixo foi concluído:

- [ ] Produzir dataset adulto anotado separado em treino/tuning/teste.
- [ ] Publicar métricas reais por classe e por modelo.
- [ ] Coletar revisão humana cega das descrições.
- [ ] Registrar origem, licença e hash dos pesos efetivamente carregados.
- [ ] Fazer varredura de segredos no conteúdo e em todo o histórico Git.
- [ ] Executar benchmark comparativo com clipes anotados.

**Resultado esperado:** qualidade demonstrada, não presumida. Contagens de um
manifesto declarativo e preferências cegas não são precisão, recall ou latência
medidos; até anotação revisada e backend real, tudo segue `N/A`/`INCONCLUSIVO`.

---

# 17. O que evitar

1. Não executar os seis modelos em todos os frames sem medir o custo real.
2. Não tratar scores de modelos diferentes como diretamente comparáveis.
3. Não interpretar concordância entre modelos como garantia de acerto.
4. Não tratar uma classe de ação como evidência suficiente de ato sexual.
5. Não confundir exposição do tórax com conteúdo sexual.
6. Não pedir ao Gemma que adivinhe ações em uma imagem isolada.
7. Não usar um título de arquivo como comprovação visual de anatomia, identidade ou idade.
8. Não aumentar o limite de tokens sem medir latência e consumo.
9. Não misturar a especialização NSFW com o modo Câmera de Segurança.
10. Não adicionar mais modelos até demonstrar que os atuais têm uma lacuna mensurável.
11. Não concluir precisão com base em concordância entre detectores ou em poucos frames do mesmo vídeo.
12. Não versionar imagens, vídeos, logs ou pesos privados.

---

# 18. Diretriz arquitetural final

A arquitetura recomendada para a especialização é:

```text
MODO NEURO VISION
  │
  ├── PERFIL DE DESCRIÇÃO CORPORAL NEUTRA
  │     ├── Observação de roupa e exposição corporal
  │     ├── Anatomia visível
  │     └── Linguagem neutra, sem inferência sexual
  │
  └── ESPECIALIZAÇÃO NSFW
        ├── Detectores locais ONNX
        │     ├── NudeNet
        │     ├── EraX
        │     └── Detector especializado
        │
        ├── Normalização e fusão
        │     ├── Caixas
        │     ├── Rótulos
        │     ├── Scores calibrados
        │     └── Conflitos entre modelos
        │
        ├── Contexto multimodal
        │     ├── Frames e timestamps
        │     ├── Anatomia detectada
        │     ├── Hipóteses e incertezas
        │     └── Histórico multiframe
        │
        ├── GEMMA LOCAL
        │     ├── Descrição adulta
        │     ├── Análise anatômica
        │     └── Ações temporais com evidência
        │
        └── RESULTADO
              ├── Descrição em português
              ├── Ações observadas/inferidas
              ├── Evidências por frame
              ├── Incertezas
              └── Telemetria e feedback
```

O modo Câmera de Segurança não entra nesse fluxo. Ele possui seus próprios objetivos, política de gravação, motor de atenção e memória ambiental.

## Princípio central

**O objetivo não é tornar a descrição mais sexualizada. É tornar a percepção visual mais completa e a interpretação mais fiel ao que realmente aparece.**

A aplicação precisa conseguir descrever um homem adulto sem camisa como um homem sem camisa, reconhecer anatomia quando visível e diferenciar isso de conteúdo sexual. Quando houver conteúdo adulto explícito, a especialização deve descrevê-lo com precisão, preservar a sequência temporal e deixar claro o que foi observado ou apenas inferido.

A qualidade final depende menos da quantidade de modelos e mais de uma combinação consistente de:
- taxonomia correta;
- pré-processamento compatível com os pesos;
- detecção calibrada;
- fusão que preserve divergências;
- prompts separados por objetivo;
- amostragem temporal adequada;
- avaliação humana com dados anotados;
- evidências rastreáveis.
