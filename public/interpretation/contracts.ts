import type { PacoteCiclo } from "../../src/domain/cycle";
import type { ResultadoInterpretacao } from "../../src/domain/interpretation";

/**
 * Porta do interpretador multimodal (Etapa 4.5/4.6; implementacao na Etapa 7).
 *
 * O interpretador recebe o **pacote do ciclo** — com as imagens ja capturadas e
 * os resultados locais associados — e **nunca** captura a webcam por conta
 * propria. A ausencia de uma referencia de camera na interface e a garantia de
 * tipo de que nao existe nova captura dentro da interpretacao.
 */
export interface InterpretadorMultimodal {
  /** Modelo de visao em uso, quando conhecido. */
  readonly modelo: string | null;
  /** Interpreta o pacote do ciclo; cancelavel por `AbortSignal`. */
  interpretar(
    pacote: PacoteCiclo,
    sinal?: AbortSignal
  ): Promise<ResultadoInterpretacao>;
}
