/** Reexporta o schema versionado para consumidores do contexto. */
export * from "./esquema";

export type { LimitesContexto, OpcoesContexto, PayloadContexto } from "./contexto/tipos";
export { LIMITES_CONTEXTO_PADRAO } from "./contexto/tipos";
export { montarContextoCiclo } from "./contexto/montagem";
export { diagnosticarContexto, tamanhoBytesUtf8 } from "./contexto/diagnostico";
