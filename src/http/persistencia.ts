/**
 * Repositorios JSONL e persistencia/limpeza de snapshots.
 *
 * Extraido de `src/server.ts` na refatoracao de responsabilidades.
 */

export type { SubsistemaIndisponivel } from "./persistencia/tipos";
export {
  ESTADOS_EVENTO_TEMPORAL_PERSISTIDOS,
  MOTIVOS_ENCERRAMENTO_TEMPORAL,
  ORIGENS_SINAL_TEMPORAL,
  SUBSISTEMAS_VALIDOS,
  TIPOS_EVENTO_TEMPORAL_PERSISTIDOS,
  type ArquivoSnapshot,
  type OpcoesLimpezaSnapshots,
  type ResultadoLimpezaSnapshots,
} from "./persistencia/tipos";
export {
  appendCiclo,
  appendEvento,
  appendEventoTemporal,
  appendLogEntry,
  appendOperacional,
  lerCiclos,
  lerEventos,
  lerEventosTemporais,
  lerLogEntries,
  lerOperacional,
  limparCiclosPersistidos,
  limparEventos,
  limparEventosTemporais,
  limparLog,
} from "./persistencia/repositorios";
export { montarEventoTemporal, montarRegistroCiclo } from "./persistencia/montagem";
export {
  agendarLimpezaSnapshots,
  coletarSnapshotsReferenciados,
  extrairBase64Imagem,
  limparCacheSnapshots,
  limparSnapshots,
  listarSnapshots,
  salvarSnapshot,
  snapshotCache,
  ultimaLimpezaSnapshotsMs,
} from "./persistencia/snapshots";
export {
  campoTipoTexto,
  extrairImagens,
  validarListaFrameIds,
  validarListaImagens,
  validarPayloadLog,
  validarPayloadVisao,
  validarSnapshot,
} from "./persistencia/validacao";
