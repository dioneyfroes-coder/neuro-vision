/**
 * Proxy/stream do backend de visao e preparacao de modelos.
 *
 * Extraido de `src/server.ts` na refatoracao de responsabilidades.
 */

export { streamVisao } from "./rotas-visao/stream";
export { handleVisao } from "./rotas-visao/handle";
export type { InfoVisao } from "./rotas-visao/consulta-preparar";
export { consultarVisao, handlePreparar } from "./rotas-visao/consulta-preparar";
