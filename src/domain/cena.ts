/**
 * Contratos da referência do ambiente e da comparação de cenas (Fase 3).
 *
 * O inventário é sempre **parcial**: o que não foi detectado não vira fato. Os
 * estados de confirmação distinguem uma detecção direta (`confirmado`) de uma
 * hipótese (`possivel`), de uma região encoberta (`ocluido`) e de uma ausência
 * explícita (`nao_observado`). A comparação usa apenas detecções diretas para
 * afirmar mudança; ausência gera no máximo uma hipótese com confiança reduzida.
 */

export type {
  RegiaoCena,
  ConfirmacaoCena,
  AssociacaoInstanciaCena,
  ConsolidacaoReferenciaCena,
  ItemCena,
  ReferenciaCena,
  TipoMudancaCena,
  MudancaCena,
  OpcoesComparacaoCena,
} from "./cena/tipos";
export type { OpcoesConstruirReferencia } from "./cena/referencia";
export { normalizarCaixaCena, caixaCenaValida, itemCenaValido, mesmoItem } from "./cena/validacao";
export { construirReferencia } from "./cena/referencia";
export { idMudancaCena, compararCena } from "./cena/comparacao";
