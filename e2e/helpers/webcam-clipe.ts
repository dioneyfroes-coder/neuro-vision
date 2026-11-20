export type { ServidorClipe, PayloadAnalise } from "./webcam-clipe/ambiente";
export {
  CLIP,
  CANAL,
  DEBUG,
  MODO,
  MODELO_VISAO,
  NSFW_ATIVO,
  LIMIAR,
  VARIANTE_BASELINE,
} from "./webcam-clipe/ambiente";
export { mimeDoClipe, criarServidorClipe, escutarServidorClipe } from "./webcam-clipe/servidor";
export { instalarReplayClipe } from "./webcam-clipe/replay";
export { configurarInterface, prepararEAquecer } from "./webcam-clipe/fluxo";
export { validarResultados, salvarArtefatos, imprimirResumo } from "./webcam-clipe/resultado";
