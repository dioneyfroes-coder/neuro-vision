/**
 * Motor temporal (Etapa 6 do roteiro de modularizacao).
 *
 * Encapsula rastreamento de objetos e mudanca de cena (sem reescrever os
 * algoritmos) e adiciona rastreadores de pose/maos com IDs estaveis, suavizacao
 * e metricas de movimento, e maquina de estados de gestos/braco com confirmacao
 * e encerramento temporais.
 */
export * from "./contracts";
export * from "./suavizador";
export * from "./rastreador-entidades";
export * from "./maquina-sinais";
export { MotorTemporalImpl } from "./motor-temporal";
