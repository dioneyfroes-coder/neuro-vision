import type { DiagnosticoContextoMultimodal } from "../../../src/domain";
import type { ContextoCicloSerializavel } from "../esquema";

/**
 * Diagnostico de compactacao do contexto enviado, derivado do proprio payload.
 *
 * Usado pelas metricas do ciclo para medir a frequencia real de truncamento
 * (Fase 3, item 5) sem depender de logs internos do montador.
 */
export function diagnosticarContexto(
  contexto: ContextoCicloSerializavel,
  maxBytesConfigurado?: number
): DiagnosticoContextoMultimodal {
  const truncamento = contexto.truncamento;
  const limite = contexto.limiteContexto;
  return {
    bytes: tamanhoBytesUtf8(contexto),
    maxBytes: truncamento?.maxBytes ?? limite?.maxBytes ?? maxBytesConfigurado ?? 0,
    truncado: Boolean(truncamento?.ocorreu),
    excedeuTeto: Boolean(truncamento?.excedeuTeto ?? limite?.excedeu),
    gruposRemovidos: truncamento?.gruposRemovidos.map((grupo) => ({ ...grupo })) ?? [],
  };
}

/**
 * Tamanho em **bytes UTF-8** da representacao JSON do valor.
 *
 * `String.length` conta unidades UTF-16: um acento ou emoji ocupa 1 unidade mas
 * 2-4 bytes. O limite do contexto e de transporte, portanto precisa da
 * codificacao real.
 */
export function tamanhoBytesUtf8(valor: unknown): number {
  const texto = JSON.stringify(valor) ?? "";
  return new TextEncoder().encode(texto).length;
}
