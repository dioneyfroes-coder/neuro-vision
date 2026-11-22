# Fase 2 — Inventário automático

A Fase 2 fecha a ponte que faltava entre o YOLO local e o inventário de cena introduzido na Fase 1. O sistema agora **coleta quadros**, converte detecções em itens de cena, consolida uma referência por instância, compara cada observação relevante da análise de segurança e mantém um painel de revisão. O inventário continua **parcial e rastreável**: ele não "entende" a cena, apenas registra o que foi detectado, com quadro, instante e tipo de evidência.

## Pipeline

```
câmera → capturarQuadro(640, …) ─┬─→ AdaptadorDetectorObjetos (YOLO COCO padrão)
                                 │        │
                                 │        ├─→ descreverDeteccoes → log de segurança
                                 │        └─→ itensCenaDeDeteccoes
                                 │                 │
                                 └─→ dimensoesQuadro(640) ─┤
                                                          ├─→ construirReferencia → POST .../cena/referencia
                                                          └─→ compararCena → POST .../cena/comparar
```

O módulo puro `public/monitoramento/inventario/inventario.ts` não conhece câmera, DOM nem `fetch`: câmera, detector e API são injetados. A interface em `public/ui/inventario.ts` faz essa ligação.

### 1. Coleta da referência

- `coletarReferenciaInventario` captura **3 quadros** (500 ms entre eles) ao clicar em "Capturar inventário".
- `Date.now()` é lido **antes** da captura e da inferência; o mesmo valor vira `capturadoEmMs` do quadro e, depois, `observadoEmMs` dos itens. Não há terceira leitura de relógio.
- `Camera.dimensoesQuadro(640)` usa a **mesma escala** de `capturarFrame`, evitando que caixas em pixels sejam normalizadas pelas dimensões nativas de um vídeo reduzido.
- `frameId` é `${sessaoId}-inv-${sequencia}`; cada item carrega `frameId`, `frameIds`, `primeiraObservacaoEmMs` e `ultimaObservacaoEmMs`.
- Quadro sem câmera, detector indisponível ou erro de conversão é **ignorado e avisado**. `quadros` conta só a evidência que entrou no inventário. Se nenhum quadro servir, a coleta falha explicitamente — nunca gera um inventário vazio silencioso.

### 2. Conversão YOLO → `ItemCena`

`itensCenaDeDeteccoes` (`src/domain/cena/deteccoes.ts`):

| Entrada (`Deteccao`) | Saída (`ItemCena`) |
| --- | --- |
| `caixa` em pixels + dimensões da imagem | `caixa` normalizada em `[0,1]` (cortada e ordenada) |
| `score` | `confianca` (limitada a `[0,1]`) |
| `entidadeId` do rastreador | `instanciaId` e `objetoId` |
| sem `entidadeId` | chave espacial `rotulo@cX:cY`, com sufixo se duas caixas caírem na mesma célula |
| `score >= 0,45` | `confirmacao: "confirmado"`, `statusEvidencia: "observado"` |
| `score < 0,45` | `confirmacao: "possivel"`, `statusEvidencia: "possivel"` |

`indisponivel`, `naoAmostrado` e resultado ausente devolvem `[]`. Converter detecções sem dimensões lança erro. Em nenhum caminho uma falha de percepção vira `nao_observado`.

### 3. Consolidação

`construirReferencia` agrupa por `instanciaId` quando ele existe (modo `automatica`) ou sempre no modo `instancia`. Dentro do grupo vence a maior confiança, com desempate determinístico por `objetoId`; a referência reúne `frameIds`, `primeiraObservacaoEmMs` e `ultimaObservacaoEmMs` de todas as observações. O modo `rotulo` e lotes sem `instanciaId` preservam o comportamento legado.

### 4. Comparação automática

A análise de segurança do modo de gravação já captura um quadro e roda YOLO a cada 5 s. O **mesmo** quadro e o **mesmo** resultado agora alimentam `compararObservacaoInventario`, que chama `POST .../cena/comparar` com `associacaoPorInstancia: true` e `confirmarRepeticao: true`. Não há segunda captura nem segunda inferência. A supressão de resumo repetido da interface de segurança continua valendo apenas para o log textual; a comparação do inventário roda antes dela.

`MudancaCena` passou a carregar `frameIds`, `primeiraObservacaoEmMs`, `ultimaObservacaoEmMs`, `confirmacoes`, `confirmadoEmMs` e `revisao` (todos opcionais). Ausência informada (`nao_observado`) pode virar hipótese, mas nunca é promovida a evidência direta.

### 5. Confirmação e revisão

- `CONFIRMACOES_MINIMAS_PADRAO = 2` é o **total** de observações: a primeira detecção já nasce com `confirmacoes: 1`; uma repetição promove `possivel` → `observado`, aumenta a confiança para pelo menos `0,61` e fixa `confirmadoEmMs`.
- Depois de promovida ou rejeitada, novas repetições não escrevem mais nada: `mudancaId` e a linha do tempo permanecem estáveis.
- `POST .../cena/confirmar` recebe `{ mudancaId, decisao: "confirmada" | "rejeitada", agoraMs? }` e persiste a decisão. Revisão manual vence repetição automática.
- O painel "Inventário do ambiente" lista itens e mudanças com rótulo, instância, confiança, `statusEvidencia`, número de quadros e confirmações, e oferece **Aprovar**/**Rejeitar** por mudança.

## Rotas novas/estendidas

| Rota | Novidade |
| --- | --- |
| `POST .../cena/referencia` | aceita `consolidacao: automatica | instancia | rotulo` |
| `POST .../cena/comparar` | aceita `associacaoPorInstancia`, `confirmarRepeticao`, `minimoConfirmacoes`; devolve `confirmadas` |
| `POST .../cena/confirmar` | revisão manual; `404` para `mudancaId` desconhecido |
| `GET .../cena/mudancas` | devolve os campos novos quando presentes |

Todos os campos são aditivos: clientes que enviam só `itens` continuam com o comportamento da Fase 1.

## Validação

Executadas com a árvore limpa, antes do commit da fase:

- `npm run typecheck`
- `npm run lint`
- `npm test` — 163 arquivos, 1114 testes
- `npm run build`
- `npm run test:e2e`

Regressões adicionadas em `tests/fase2-inventario.test.ts` (ponte YOLO, consolidação multi-instância, evidência temporal, confirmação, coleta com quadro perdido, serviço e validação) e em `tests/server-cena.test.ts` (rotas de consolidação, confirmação e revisão).

## Limites

- O inventário cobre somente as classes do detector COCO padrão carregado no navegador (`MODELO_YOLO_PADRAO = "onnx-community/yolov10n"`); objetos fora dessas classes não existem para ele. "YOLO SFW" nas versões anteriores deste documento era apenas esse detector padrão — o conjunto NSFW é experimental, opt-in e não participa do inventário.
- `entidadeId` é estável apenas dentro do rastreador/sessão. Sem ele, a chave espacial separa instâncias no lote, mas não prova identidade entre sessões.
- A referência é estática até nova captura manual; não há ainda gatilho automático de gravação a partir de `MudancaCena`.
- A revisão manual é persistida por `mudancaId`. Redefinir a referência cria novos ids e, portanto, novas revisões pendentes.
- A validação com câmera real e anotações humanas continua pendente; os testes determinísticos cobrem as regras, não a qualidade das detecções.
