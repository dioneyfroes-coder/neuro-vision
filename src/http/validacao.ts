/**
 * Normalizadores e validadores puros de payloads e parametros.
 *
 * Fachada: implementação dividida por responsabilidade em `./validacao/*`.
 */
export {
  normalizarCaixa,
  normalizarObjetos,
  normalizarMarcacoesNsfw,
  MOTIVOS_VALIDOS,
  normalizarMotivo,
  TIPOS_ENTRADA,
  normalizarTipoEntrada,
  campoNumero,
  normalizarPapel,
  montarEntrada,
  validarPayloadEvento,
  inteiroLimitado,
  parsearInstante,
  parsearTiposEvento,
} from "./validacao/comum";
export type { OpcoesInicioMonitoramento } from "./validacao/monitoramento";
export {
  lerInstanteDoCorpo,
  numeroPositivoOuErro,
  montarInicioMonitoramento,
  montarAgoraMonitoramento,
  montarQuadrosMonitoramento,
} from "./validacao/monitoramento";
export { montarItensCena, montarComparacaoCena } from "./validacao/cena";
