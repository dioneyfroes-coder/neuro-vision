import type { ConfirmacaoCena } from "./cena/tipos";
import type {
  EstadoEventoTemporal,
  MotivoEncerramentoEvento,
  OrigemSinalTemporal,
} from "./temporal-event";

/**
 * Vocabulário canônico de evidência do plano mestre.
 *
 * Não substitui os estados de ciclo de vida já existentes (`provavel`,
 * `confirmado`, ...): ele responde a uma pergunta diferente — "que tipo de
 * suporte existe para esta afirmação?". Eventos antigos sem o campo continuam
 * válidos; a derivação abaixo é aditiva e reversível.
 */
export type StatusEvidencia =
  | "observado"
  | "inferido"
  | "possivel"
  | "ocluido"
  | "nao_observado"
  | "falha_percepcao"
  | "desconhecido";

/**
 * Adapta o vocabulário legado de confirmação de cena ao vocabulário canônico.
 * A conversão é explícita para evitar que `nao_confirmado` vire "ausência" e
 * que `possivel` vire fato observado.
 */
export function statusEvidenciaCena(confirmacao: ConfirmacaoCena): StatusEvidencia {
  switch (confirmacao) {
    case "confirmado":
      return "observado";
    case "possivel":
      return "possivel";
    case "ocluido":
      return "ocluido";
    case "nao_observado":
      return "nao_observado";
    default:
      return "desconhecido";
  }
}

export const STATUS_EVIDENCIA_VALIDOS: readonly StatusEvidencia[] = [
  "observado",
  "inferido",
  "possivel",
  "ocluido",
  "nao_observado",
  "falha_percepcao",
  "desconhecido",
];

/** Entrada mínima para derivar o status sem depender de um evento completo. */
export interface EntradaStatusEvidencia {
  estado: EstadoEventoTemporal;
  tipo?: string;
  motivoEncerramento?: MotivoEncerramentoEvento;
  origens?: OrigemSinalTemporal[];
  frameIds?: string[];
  evidencias?: string[];
  intervaloSemObservacaoMs?: number;
}

/**
 * Deriva um `StatusEvidencia` a partir dos contratos existentes.
 *
 * Regras importantes (plano mestre, §3.3):
 * - falha de inferência nunca vira desaparecimento;
 * - oclusão nunca vira remoção;
 * - proximidade/contato/posse continuam separados — um evento `provavel` é
 *   sempre `possivel`, nunca `observado`;
 * - uma conclusão apoiada em várias observações de interação é `inferido`.
 */
export function statusEvidenciaEvento(entrada: EntradaStatusEvidencia): StatusEvidencia {
  const evidencias = entrada.evidencias ?? [];
  if (evidencias.some((e) => /inferencia_indisponivel|falha_percepcao/.test(e))) {
    return "falha_percepcao";
  }
  if (entrada.motivoEncerramento === "oclusao" || evidencias.includes("ocluido")) {
    return "ocluido";
  }
  if (
    entrada.motivoEncerramento === "periodo_cego" ||
    (entrada.intervaloSemObservacaoMs !== undefined && entrada.intervaloSemObservacaoMs > 0)
  ) {
    return "desconhecido";
  }
  if (
    entrada.estado === "candidato" ||
    entrada.estado === "provavel" ||
    entrada.estado === "incerto"
  ) {
    return "possivel";
  }
  if (entrada.estado === "confirmado" || entrada.estado === "encerrado") {
    if ((entrada.frameIds?.length ?? 0) === 0) return "nao_observado";
    const derivadoDeVariasObservacoes =
      (entrada.tipo === "interacao_objeto" || entrada.tipo === "mudanca_de_cena") &&
      (entrada.frameIds?.length ?? 0) >= 2;
    return derivadoDeVariasObservacoes ? "inferido" : "observado";
  }
  return "desconhecido";
}
