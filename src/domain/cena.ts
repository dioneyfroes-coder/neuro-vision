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
export type { OpcoesItensCenaDeDeteccoes } from "./cena/deteccoes";
export type { DecisaoRevisaoMudanca } from "./cena/confirmacao";
export {
  normalizarCaixaCena,
  caixaCenaValida,
  itemCenaValido,
  mesmoItem,
  finito,
} from "./cena/validacao";
export { construirReferencia } from "./cena/referencia";
export { itensCenaDeDeteccoes, LIMITE_CONFIANCA_INVENTARIO_PADRAO } from "./cena/deteccoes";
export {
  CONFIRMACOES_MINIMAS_PADRAO,
  registrarConfirmacaoMudanca,
  revisarMudanca,
} from "./cena/confirmacao";
export { idMudancaCena, compararCena } from "./cena/comparacao";
