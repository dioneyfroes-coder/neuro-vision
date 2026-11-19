/**
 * Rotas de observacoes, eventos, eventos temporais, ciclos e operacional.
 *
 * Extraido de `src/server.ts` na refatoracao de responsabilidades.
 */

export { handleLog, handleListLogs, handleClearLogs } from "./rotas-memoria/logs";
export {
  handleEventos,
  handleListEventos,
  handleClearEventos,
  handleContexto,
  handleOperacional,
} from "./rotas-memoria/eventos";
export {
  handleCiclos,
  handleListCiclos,
  handleClearCiclos,
  handleEventosTemporais,
  handleListEventosTemporais,
  handleClearEventosTemporais,
} from "./rotas-memoria/temporais";
export { anexarTrechosDeVideo } from "./rotas-memoria/video";
