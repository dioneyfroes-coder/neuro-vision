import type { ModoMotorTemporal } from "../temporal/contracts";

/**
 * Variantes do benchmark arquitetural (Etapa 9 do roteiro).
 *
 * As variantes B, C e D compartilham o mesmo ciclo multiframe (quatro snapshots
 * identificados, uma interpretacao multimodal por ciclo); o que muda entre elas
 * sao tres eixos, declarados aqui em vez de espalhar condicoes pela aplicacao:
 *
 * - `percepcaoLocal`: roda o pipeline local (YOLO Tiny + Pose + MediaPipe) em
 *   cada snapshot;
 * - `dadosLocais`: envia ao multimodal o contexto estruturado derivado dessa
 *   percepcao (deteccoes, pose, maos e eventos temporais);
 * - `temporal`: leitura temporal aplicada — `ausente` (nenhuma), `basico`
 *   (apenas objetos + cena) ou `ampliado` (pose/maos + maquinas de estado).
 *
 * A variante A (baseline) nao aparece aqui porque nao usa o ciclo multiframe: e
 * o sistema de frame unico dos modos existentes (`deteccao`/`eventos`/`visao`).
 *
 * A definicao de "motor temporal basico" da variante C e explicita: rastreamento
 * de objetos + mudanca de cena (a logica de frame unico pre-existente), sem
 * rastreamento de pose/maos nem maquinas de estado de gesto/braco. Ver
 * `public/temporal/contracts.ts` (`ModoMotorTemporal`).
 */

/** Leitura temporal de uma variante: ausente, basica ou ampliada. */
export type NivelTemporal = "ausente" | ModoMotorTemporal;

export interface VariantePercepcao {
  /** Identificador curto da variante (`sequencia`, `fundida`, `completa`). */
  id: string;
  /** Rotulo legivel (aparece no seletor/diagnostico). */
  rotulo: string;
  /** Roda deteccao + pose + maos em cada frame. */
  percepcaoLocal: boolean;
  /** Inclui os dados locais estruturados no payload multimodal. */
  dadosLocais: boolean;
  /** Nivel da leitura temporal aplicada ao ciclo. */
  temporal: NivelTemporal;
}

/**
 * Matriz minima de comparacao do roteiro (§7). A variante A (baseline) e o
 * fluxo de frame unico dos modos existentes e nao entra neste registro.
 */
export const VARIANTES_PERCEPCAO: Record<string, VariantePercepcao> = {
  /** B. Sequencia: 4 imagens, sem dados locais e sem leitura temporal. */
  sequencia: {
    id: "sequencia",
    rotulo: "B · Sequência (4 imagens, sem dados locais)",
    percepcaoLocal: false,
    dadosLocais: false,
    temporal: "ausente",
  },
  /** C. Percepcao fundida: imagens + dados locais, com motor temporal basico. */
  fundida: {
    id: "fundida",
    rotulo: "C · Percepção fundida (dados locais, temporal básico)",
    percepcaoLocal: true,
    dadosLocais: true,
    temporal: "basico",
  },
  /** D. Arquitetura-alvo: dados locais + motor temporal ampliado. */
  completa: {
    id: "completa",
    rotulo: "D · Arquitetura-alvo (dados locais, temporal ampliado)",
    percepcaoLocal: true,
    dadosLocais: true,
    temporal: "ampliado",
  },
};

/** Variante usada quando o modo nao declara uma explicitamente (fluxo atual). */
export const VARIANTE_PADRAO: VariantePercepcao = VARIANTES_PERCEPCAO.completa;

/** Resolve uma variante pelo id ou pela propria definicao (tolerante a ausencia). */
export function obterVariante(
  idOuVariante: string | VariantePercepcao | undefined
): VariantePercepcao {
  if (!idOuVariante) return VARIANTE_PADRAO;
  if (typeof idOuVariante === "string") {
    return VARIANTES_PERCEPCAO[idOuVariante] ?? VARIANTE_PADRAO;
  }
  return idOuVariante;
}
