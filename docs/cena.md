# Referência do ambiente e mudanças de cena (Fases 1–2)

Regras puras e determinísticas para descrever um ambiente no início de uma sessão de monitoramento e compará-lo com observações posteriores. O código está em `src/domain/cena.ts` (regras), `src/persistence/repositorio-cena.ts` (índice) e `src/monitoramento/servico-cena.ts` (composição). A ponte real com o YOLO está em `public/monitoramento/inventario/inventario.ts` e na interface `public/ui/inventario.ts`. As rotas HTTP estão em [`api.md`](./api.md), o pipeline completo em [`fase-2-inventario.md`](./fase-2-inventario.md) e o contexto geral em [`monitoramento.md`](./monitoramento.md).

> **Escopo real.** Desde a Fase 2 o inventário é preenchido automaticamente pelas detecções YOLO da câmera. Continua **parcial**: ele cruza rótulos, caixas normalizadas, estados informados e ids de instância — não "entende" a cena. Nenhuma regra pura lê o relógio; os instantes vêm de quem chama.

## Estados de confirmação

| `confirmacao` | Significado | Uso na comparação |
| --- | --- | --- |
| `confirmado` | Detecção direta assumida como correta | Sustenta mudança com a confiança informada. |
| `possivel` | Detecção fraca/ambígua | Sustenta mudança, mas a confiança é limitada a `0,6`; itens novos viram `possivel_mudanca` (`observado: false`). |
| `ocluido` | Região encoberta | Não gera mudança. |
| `nao_confirmado` | Detecção não validada | Não gera mudança. |
| `nao_observado` | Ausência **explícita** | Gera hipótese `objeto_removido` com confiança máxima `0,55` e `statusEvidencia: "nao_observado"`. |

**Falta de menção não é mudança.** Um objeto simplesmente ausente da lista de observações não dispara nada; apenas `nao_observado` é uma afirmação de ausência. Falha do detector, `indisponivel` e `naoAmostrado` produzem lista vazia — nunca uma ausência observada.

O campo aditivo `statusEvidencia` (`observado`, `inferido`, `possivel`, `ocluido`, `nao_observado`, `falha_percepcao`, `desconhecido`) responde a outra pergunta: que tipo de suporte existe para a afirmação. Ele é derivado no servidor; o valor enviado pelo cliente nunca é autoritativo.

## Contratos

```ts
interface RegiaoCena { xmin: number; ymin: number; xmax: number; ymax: number } // [0,1]

interface ItemCena {
  objetoId: string;          // temporário, escopo de sessão
  rotulo: string;            // chave de associação entre referência e observação
  caixa: RegiaoCena;
  confirmacao: ConfirmacaoCena;
  confianca: number;         // [0,1]
  classe?: string;
  estadoObjeto?: string;     // estado físico observável (ex.: "aberto")
  frameId?: string;
  frameIds?: string[];
  observadoEmMs?: number;    // epoch-ms da captura
  primeiraObservacaoEmMs?: number;
  ultimaObservacaoEmMs?: number;
  instanciaId?: string;      // identidade do rastreador/chave espacial
  associacao?: "estavel" | "ambiga";
  confiancaAssociacao?: number;
  statusEvidencia?: StatusEvidencia;
}

type TipoMudancaCena =
  | "objeto_adicionado" | "objeto_removido" | "objeto_movido"
  | "estado_alterado" | "possivel_mudanca";
```

`normalizarCaixaCena(caixa, larguraPx, alturaPx)` converte caixas em pixels para `[0,1]`, corta valores fora da imagem e ordena extremos invertidos. `caixaCenaValida`/`itemCenaValido` recursam coordenadas fora de `[0,1]`, confiança fora de `[0,1]`, estados desconhecidos e ids/rótulos vazios.

`itensCenaDeDeteccoes` é a conversão oficial de `Deteccao`/`ResultadoDeteccaoLocal` (caixas em pixels) para `ItemCena`. Ver [`fase-2-inventario.md`](./fase-2-inventario.md).

## Referência inicial

`construirReferencia({ sessaoId, itens, criadaEmMs, quadros, consolidacao? })` guarda **um item por instância** quando `instanciaId` existe; sem ele, mantém o contrato legado de um item por rótulo. O modo explícito `instancia` força a separação e `rotulo` força a agregação. Prevalece a maior confiança, com desempate determinístico pelo menor `objetoId`; o resultado não depende da ordem do lote. A consolidação reúne `frameIds` e os extremos `primeira/ultimaObservacaoEmMs` de todas as observações do grupo. `quadros` (padrão `1`) registra quantos quadros alimentaram o inventário; `sessaoId` aceita apenas letras, dígitos, `_` e `-`.

## Comparação

`compararCena(referencia, observados, detectadoEmMs, opcoes?)` devolve `MudancaCena[]` ordenadas por confiança (decrescente) e `mudancaId` (ascendente). Só `confirmado`/`possivel` entram como candidatos diretos; `possivel` tem a confiança limitada a `0,6`.

Para cada item da referência:

1. Escolhe, entre os observados do mesmo rótulo ainda não usados, o de maior pontuação — IoU, proximidade do centro e bônus de `instanciaId` igual (`associacaoPorInstancia`, padrão `true`). Duas associações igualmente prováveis sem id de instância viram `associacao: "ambiga"`, `statusEvidencia: "possivel"`, `observado: false` e confiança ≤ `0,6`.
2. **IoU ≥ `iouMinimo` (padrão `0,25`)**: mesmo lugar. Se `estadoObjeto` mudou, gera `estado_alterado` (`observado: true`) com caixas anterior/atual e ambos os estados; se não mudou, não há mudança.
3. **IoU < `iouMinimo`, distância ≤ `distanciaMaxima` (padrão `0,25`)**: gera `objeto_movido` (`observado: true`) com `deslocamento`, caixas anterior/atual e confiança reduzida pela proximidade ao limite.
4. **Sem candidato**: gera `objeto_removido` apenas se o rótulo apareceu como `nao_observado`; a confiança é `min(confianca da referência, 0,55)` e `statusEvidencia: "nao_observado"`.
5. Itens diretos com rótulo fora da referência viram `objeto_adicionado` (`confirmado`, `observado: true`) ou `possivel_mudanca` (`possivel`, `observado: false`, confiança ≤ `0,6`).

Toda mudança carrega, quando disponíveis, os `frameIds` e os extremos temporais do item que a sustentou. Um deslocamento pequeno o bastante para manter IoU ≥ `0,25` é ruído de detecção; um objeto que se move além de `distanciaMaxima` também não vira "removido" sem ausência explícita.

`mudancaId` é `sessaoId|tipo|objetoId|referenciaEmMs`: deriva da **referência**, não do instante da detecção. Comparar a mesma cena em outro quadro não cria outro id.

## Persistência e serviço

- `logs/cena-referencias.jsonl`: append-only; a leitura devolve a versão mais recente por `sessaoId`.
- `logs/cena-mudancas.jsonl`: append-only; a leitura deduplica por `mudancaId` (mantém a versão mais recente) e ordena por `detectadoEmMs`.
- `ServicoCena.comparar` grava mudanças ainda desconhecidas e devolve `{ mudancas, novas, confirmadas }`. Com `confirmarRepeticao`, uma mudança conhecida recebe `confirmacoes` acumuladas; ao atingir `minimoConfirmacoes` (padrão `2` observações), uma hipótese direta é promovida a `observado`. Rejeições manuais não são atropeladas por repetições.
- `ServicoCena.revisar` persiste a decisão (`confirmada`/`rejeitada`) e responde `404` para `mudancaId` desconhecido.
- Mutações são serializadas por fila interna: comparações concorrentes não duplicam a mesma mudança.
- A sessão precisa existir no índice de `ServicoMonitoramento` (`404` se desconhecida); comparar sem referência responde `409`; payload inválido responde `400`.
- A interface de revisão está em `public/ui/inventario.ts` e usa `POST .../cena/confirmar`.

## Limites

- A associação usa rótulo + geometria + id de instância; sem rastro, a identidade entre quadros é inferida pela posição aproximada.
- A referência é estática até ser redefinida; redefinir com outro `referenciaEmMs` pode gerar novos `mudancaId`s para a mesma mudança observada — intencional, pois a afirmação agora se refere a outro baseline.
- Não há ainda ponte entre `MudancaCena` e `VideoSegment`, nem gatilho automático de gravação a partir de mudanças.
- A coleta da referência é manual (botão no painel); o modo de gravação dispara apenas a comparação das observações seguintes.
