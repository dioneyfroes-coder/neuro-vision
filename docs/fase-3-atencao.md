# Fase 3 — Motor de atenção da segurança

A Fase 3 tornou a análise da câmera de segurança **adaptativa** sem tornar a gravação dependente da análise. O `MediaRecorder`, os segmentos de 5 minutos e o índice de quadros continuam funcionando mesmo quando a inferência falha, a câmera cai ou o backend de visão está fora do ar.

## O que mudou

### 1. Máquina de estados pura

`src/domain/seguranca-atencao.ts` define:

| Estado | Significado |
| --- | --- |
| `passivo` | sem atividade observada |
| `atividade_detectada` | uma amostra com atividade; ainda não é mudança de cena |
| `atencao` | presença/mudança repetida; cadência intermediária |
| `interacao` | interação repetida ou entrada em zona com presença |
| `pos_evento` | calma confirmada por tempo **e** quadros |

As transições usam histerese: uma oclusão curta não derruba a cadência e `pos_evento` só volta a `passivo` depois de um segundo período de calma. `percepcaoIndisponivel` **congela** o estado: falha, `indisponivel` e `naoAmostrado` nunca são contados como ausência de pessoa.

### 2. Zonas de entrada/saída

`ZonaAtencao` é um retângulo em coordenadas normalizadas `[0,1]`, avaliado pelo **centro** da caixa normalizada da pessoa (YOLO COCO `person`). Não há biometria, reconhecimento facial ou identidade nominal. Entrada tem prioridade sobre saída quando zonas se sobrepõem.

No painel **Atenção da segurança** é possível informar `xmin,ymin,xmax,ymax` para entrada e saída. As zonas ficam no `localStorage` do navegador e também são publicadas na telemetria. Sem configuração, o comportamento é o legado: nenhuma zona é inferida.

### 3. Cadência por estado e subsistema

`CADENCIAS_ATENCAO_PADRAO` define intervalos alvo para `deteccao`, `pose` e `maos`:

| Estado | detecção | pose | mãos |
| --- | ---: | ---: | ---: |
| `passivo` | 10 s | 10 s | 20 s |
| `atividade_detectada` | 5 s | 5 s | 10 s |
| `atencao` | 2 s | 1 s | 1 s |
| `interacao` | 1 s | 500 ms | 250 ms |
| `pos_evento` | 5 s | 5 s | 10 s |

`nsfw` fica fora da tabela: o conjunto experimental continua opt-in e não é habilitado pelo motor de atenção. No laço atual da câmera de segurança apenas a detecção é executada; as demais linhas descrevem a cadência canônica para os subsistemas quando forem ligados. O laço usa `setTimeout` reprogramado a cada análise, em vez do intervalo fixo de 5 s.

### 4. Buffer pré-evento e janelas congeladas

`BufferCircularQuadros` agora recebe as miniaturas dos quadros **realmente capturados** pela análise. Quando o inventário confirma uma mudança observada, `criarJanelaEvidencia()` congela o que já estava no buffer (pré-evento), acrescenta quadros até 2 s depois do gatilho e grava lacunas entre capturas. Depois de congelada, a janela não aceita novos quadros.

A correlação com vídeo usa `GET /api/monitoramento/segmentos?inicio=&fim=`, que chama `segmentosParaIntervalo()` no servidor. Apenas segmentos que de fato cobrem o intervalo entram no registro; nenhum quadro ou cobertura é sintetizada. Queda de câmera, `semSinal` e captura suspensa continuam sem produzir quadros.

### 5. Custo por estado e telemetria

`src/domain/custo-atencao.ts` agrega, por estado:

- amostras, duração e FPS efetivo;
- falhas de percepção;
- amostras executadas e não amostradas por subsistema;
- inferência média por subsistema e pico de memória quando medidos;
- mudanças de cena, quadros/bytes correlatos e quadros sem cobertura confirmada.

Campos não medidos ficam ausentes, nunca zerados. A UI mostra estado, cadência, custo do estado e quantidade de janelas congeladas. A telemetria é publicada em `POST /api/monitoramento/seguranca/atencao` e consultável em `GET /api/monitoramento/seguranca/atencao?sessaoId=...`. São rotas aditivas: não alteram sessão, quadros, segmentos nem o contrato do gravador.

## Limites desta fase

- Não há modelo novo: a presença vem de `person` do YOLO COCO padrão (`onnx-community/yolov10n`), não de classificador NSFW.
- Interação é sinal booleano explícito ou presença em zona de entrada; gestos finos pertencem à Fase 4.
- `mudanca_de_cena` do motor temporal (assinatura de imagem) **não** é usada como confirmação do inventário.
- `fpsEfetivo` é derivado das amostras que o cliente mediu; não substitui benchmark nem medição de hardware.
- O soak real de 30 min do **gravador** passou em 2026-11-22 (`APROVADO`; 1792/1792 quadros, 180 segmentos, 3 lacunas, 180 uploads, RSS +15,58 MB, zero erros HTTP — ver [`soak.md`](./soak.md)). Ele é server-side: **não** mede a cadência adaptativa nem `MediaRecorder`. O soak da Fase 3 com câmera real, o benchmark multimodal com backend local e a validação com dados anotados continuam pendentes em [`pendencias.md`](./pendencias.md).
