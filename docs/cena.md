# Referência do ambiente e mudanças de cena (Fase 3)

Regras puras e determinísticas para descrever um ambiente no início de uma sessão de monitoramento e compará-lo com observações posteriores. O código está em `src/domain/cena.ts` (regras), `src/persistence/repositorio-cena.ts` (índice) e `src/monitoramento/servico-cena.ts` (composição). As rotas HTTP estão em [`api.md`](./api.md) e o contexto geral em [`monitoramento.md`](./monitoramento.md).

> **Escopo real.** O inventário é **parcial**: os itens são injetados pela API (`itens`) — a integração com detecções reais ainda não existe. A comparação não "entende" a cena: ela cruza rótulos, caixas normalizadas e estados informados. Nenhuma função lê o relógio; os instantes vêm de quem chama.

## Estados de confirmação

| `confirmacao` | Significado | Uso na comparação |
| --- | --- | --- |
| `confirmado` | Detecção direta assumida como correta | Sustenta mudança com a confiança informada. |
| `possivel` | Detecção fraca/ambígua | Sustenta mudança, mas a confiança é limitada a `0,6`; itens novos viram `possivel_mudanca` (`observado: false`). |
| `ocluido` | Região encoberta | Não gera mudança. |
| `nao_confirmado` | Detecção não validada | Não gera mudança. |
| `nao_observado` | Ausência **explícita** | Gera hipótese `objeto_removido` com confiança máxima `0,55` e `observado: false`. |

**Falta de menção não é mudança.** Um objeto simplesmente ausente da lista de observações não dispara nada; apenas `nao_observado` é uma afirmação de ausência.

## Contratos

```ts
interface ItemCena {
  objetoId: string;          // temporário, escopo de sessão
  rotulo: string;            // chave de associação entre referência e observação
  caixa: { xmin; ymin; xmax; ymax }; // normalizada em [0,1]
  confirmacao: ConfirmacaoCena;
  confianca: number;         // [0,1]
  estadoObjeto?: string;     // estado físico observável (ex.: "aberto")
  frameId?: string;
  observadoEmMs?: number;
}

type TipoMudancaCena =
  | "objeto_adicionado" | "objeto_removido" | "objeto_movido"
  | "estado_alterado" | "possivel_mudanca";
```

`normalizarCaixaCena(caixa, larguraPx, alturaPx)` converte caixas em pixels para `[0,1]`, corta valores fora da imagem e ordena extremos invertidos. `caixaCenaValida`/`itemCenaValido` recursam coordenadas fora de `[0,1]`, confiança fora de `[0,1]`, estados desconhecidos e ids/rótulos vazios.

## Referência inicial

`construirReferencia({ sessaoId, itens, criadaEmMs, quadros })` guarda **um item por rótulo**: prevalece o de maior confiança; em empate, o menor `objetoId`. O resultado não depende da ordem do lote. `quadros` (padrão `1`) registra quantos quadros alimentaram o inventário; `sessaoId` aceita apenas letras, dígitos, `_` e `-`.

## Comparação

`compararCena(referencia, observados, detectadoEmMs, opcoes?)` devolve `MudancaCena[]` ordenadas por confiança (decrescente) e `mudancaId` (ascendente). Só `confirmado`/`possivel` entram como candidatos diretos; `possivel` tem a confiança limitada a `0,6`.

Para cada item da referência:

1. Escolhe, entre os observados do mesmo rótulo ainda não usados, o de maior IoU com a caixa de referência (desempate por menor distância entre centros).
2. **IoU ≥ `iouMinimo` (padrão `0,25`)**: mesmo lugar. Se `estadoObjeto` mudou, gera `estado_alterado` (`observado: true`) com caixas anterior/atual e ambos os estados; se não mudou, não há mudança.
3. **IoU < `iouMinimo`, distância ≤ `distanciaMaxima` (padrão `0,25`)**: gera `objeto_movido` (`observado: true`) com `deslocamento`, caixas anterior/atual e confiança reduzida pela proximidade ao limite.
4. **Sem candidato**: gera `objeto_removido` apenas se o rótulo apareceu como `nao_observado`; a confiança é `min(confianca da referência, 0,55)` e `observado: false`.
5. Itens diretos com rótulo fora da referência viram `objeto_adicionado` (`confirmado`, `observado: true`) ou `possivel_mudanca` (`possivel`, `observado: false`, confiança ≤ `0,6`).

Um deslocamento pequeno o bastante para manter IoU ≥ `0,25` é tratado como ruído de detecção — não vira `objeto_movido`. Um objeto que se move além de `distanciaMaxima` também não vira "removido" sem uma ausência explícita.

`mudancaId` é `sessaoId|tipo|objetoId|referenciaEmMs`: deriva da **referência**, não do instante da detecção. Comparar a mesma cena em outro quadro não cria outro id.

## Persistência e serviço

- `logs/cena-referencias.jsonl`: append-only; a leitura devolve a versão mais recente por `sessaoId`.
- `logs/cena-mudancas.jsonl`: append-only; a leitura deduplica por `mudancaId` (mantém a versão mais recente) e ordena por `detectadoEmMs`.
- `ServicoCena.comparar` grava **apenas** mudanças ainda desconhecidas e devolve `{ mudancas, novas }`: `mudancas` é o resultado completo da comparação, `novas` contém as que entraram no índice naquela chamada.
- Mutações são serializadas por fila interna: comparações concorrentes não duplicam a mesma mudança.
- A sessão precisa existir no índice de `ServicoMonitoramento` (`404` se desconhecida); comparar sem referência responde `409`; payload inválido responde `400`.

## Limites

- A associação usa rótulo + geometria; não há reconhecimento de identidade entre objetos do mesmo rótulo quando a referência tem apenas um deles.
- A referência é estática até ser redefinida; redefinir com outro `referenciaEmMs` pode gerar novos `mudancaId`s para a mesma mudança observada — isso é intencional, pois a afirmação agora se refere a outro baseline.
- Não há ainda ponte entre `MudancaCena` e `VideoSegment`, nem gatilho automático de gravação a partir de mudanças.
