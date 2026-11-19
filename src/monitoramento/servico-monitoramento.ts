/**
 * Composição do núcleo de gravação com o índice durável (Fase 3).
 *
 * Fachada: implementação dividida por responsabilidade em `./servico-monitoramento/*`.
 */
export {
  MAX_QUADROS_POR_LOTE,
  LIMITE_INDICE_MONITORAMENTO_PADRAO,
  MAX_BYTES_INDICE_MONITORAMENTO_PADRAO,
  ConflitoMonitoramentoError,
} from "./servico-monitoramento/tipos";
export type {
  ArquivosMonitoramento,
  OpcoesServicoMonitoramento,
  QuadroRejeitadoNoLote,
  ResultadoEnvioQuadros,
} from "./servico-monitoramento/tipos";
export { ServicoMonitoramento } from "./servico-monitoramento/servico";
